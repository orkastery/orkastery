/**
 * RM-059 (fatia F6, T6.4; DD5 do plano dos mods): a conducao pela Sentinela do Condutor.
 *
 * A Sentinela (`adapters/claude-code/mods/ork-sentinela`) roda na sessao do dono no Claude Code e despacha a fase
 * seguinte das threads #Auto pelo proprio nucleo (`ork phase run`, que toma o lease `exec:<thread>` e e idempotente).
 * Dois fatos moram aqui, e so aqui:
 *
 * - a PRESENCA dela nesta maquina, com prazo curto renovado pela batida: enquanto ela vale, o condutor externo cede
 *   o despacho e o retry, menos a retomada por cota (RM-064 T5, `passosDaBatida`); vencida (a sessao do dono fechou),
 *   ele volta a conduzir sozinho, como reserva;
 * - o PASSO DO CONDUTOR de cada thread aberta, calculado com as mesmas leituras do pulse (`entregasDoProjeto`,
 *   `esperaDoCondutor`), sem o limiar de 30 min e sem ler a forja. No #Auto, depois de uma fase concluida, sai a
 *   fase seguinte a prova mais adiantada que a sessao do bloco deixou (artefato gravado depois do despacho, produto
 *   na branch, `ship_done`, `master_done`), e nada sai quando o bloco ja passou do CHECK: a sessao que fez o bloco
 *   inteiro nao ganha um PLAN repetido. A pendencia do dono (thread pausada, pergunta aberta) segura tudo.
 *
 * Nada aqui despacha nem toma conducao: quem despacha e o `ork phase run`, e a Sentinela nunca assume a conducao.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CANAL_DA_SENTINELA, CONTRATO_DA_SENTINELA, PRAZO_DA_PRESENCA_MS } from './conducao';
import { raizDoEstado } from './estado-thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { dirEstado, ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { CasoParado, entregasDoProjeto, EstadoDaEntrega, pendenciaDoDono } from './parado-no-condutor';
import { dirThread, lerThread, pedidoDaThread } from './thread';
import { EventoLedger, Fase, Thread } from './types';
import { msg } from './locale';

export { CANAL_DA_SENTINELA, CONTRATO_DA_SENTINELA, PRAZO_DA_PRESENCA_MS } from './conducao';

/** O id da sessao do Claude Code que conduz pela Sentinela (o UUID dela, ou outro id curto sem espaco). */
const SESSAO_VALIDA = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
/** Uma trava de presenca mais velha que isto e de um processo que morreu no meio da escrita. */
const TRAVA_VELHA_MS = 10 * 1000;
const ESPERA_DA_TRAVA_MS = 3 * 1000;

// ---------------------------------------------------------------------------
// A presenca da Sentinela nesta maquina.
// ---------------------------------------------------------------------------

export interface PresencaDaSentinela {
  contrato: typeof CONTRATO_DA_SENTINELA;
  canal: typeof CANAL_DA_SENTINELA;
  maquina: string;
  sessao: string;
  desde: string;
  batidaEm: string;
  expiraEm: string;
}

/** A presenca como a leitura a ve: `ativa` enquanto o prazo da ultima batida nao venceu. */
export interface LeituraDaPresenca extends PresencaDaSentinela {
  ativa: boolean;
}

export interface BatidaDaSentinela {
  /** `false` quando outra sessao desta maquina conduz pela Sentinela agora: a batida nao toma o lugar dela. */
  ok: boolean;
  /** A batida comecou uma presenca (nao havia uma viva): `sentinela_ligada` foi ao ledger do projeto. */
  ligou: boolean;
  presenca: LeituraDaPresenca;
}

export interface DesligamentoDaSentinela {
  desligada: boolean;
  /** A presenca que ficou: a de outra sessao, ou `null`. */
  presenca: LeituraDaPresenca | null;
}

/** O nome da maquina como pedaco de nome de arquivo. */
function nomeSeguro(maquina: string): string {
  return maquina.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 64) || 'maquina';
}

function exigirSessao(sessao: unknown): string {
  if (typeof sessao !== 'string' || !SESSAO_VALIDA.test(sessao)) {
    throw new Error('conducao.sentinela.sessao: --sessao exige o id da sessao do Claude Code (letras, digitos, ponto, hifen ou dois-pontos, ate 128)');
  }
  return sessao;
}

/** O ledger do projeto e o da raiz do estado, chamado da raiz ou de qualquer worktree (como o do setup). */
function dirDoLedgerDoProjeto(raiz: string): string {
  return dirEstado(raizDoEstado(raiz));
}

/** O arquivo da presenca desta maquina, no estado canonico do projeto. */
export function caminhoDaPresenca(raiz: string, maquina: string = nomeDaMaquina()): string {
  return path.join(dirDoLedgerDoProjeto(raiz), 'conducao', `sentinela-${nomeSeguro(maquina)}.json`);
}

function lerPresencaGravada(arquivo: string): PresencaDaSentinela | null {
  let bruto: unknown;
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
  const p = bruto as Partial<PresencaDaSentinela> | null;
  if (!p || p.contrato !== CONTRATO_DA_SENTINELA || p.canal !== CANAL_DA_SENTINELA) return null;
  for (const campo of ['maquina', 'sessao', 'desde', 'batidaEm', 'expiraEm'] as const) {
    if (typeof p[campo] !== 'string' || p[campo] === '') return null;
  }
  if (!Number.isFinite(Date.parse(p.expiraEm as string))) return null;
  return p as PresencaDaSentinela;
}

function comoLeitura(p: PresencaDaSentinela, agora: Date): LeituraDaPresenca {
  return { ...p, ativa: Date.parse(p.expiraEm) > agora.getTime() };
}

function dormirSincrono(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Uma escrita da presenca por vez: a trava e um arquivo criado com O_EXCL ao lado dela. */
function comTrava<T>(arquivo: string, fn: () => T): T {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const trava = `${arquivo}.trava`;
  const limite = Date.now() + ESPERA_DA_TRAVA_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(trava, 'wx'));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const st = fs.statSync(trava, { throwIfNoEntry: false });
      if (st && Date.now() - st.mtimeMs > TRAVA_VELHA_MS) {
        // So a mesma trava velha sai: se outra sessao a trocou no meio (outro inode ou outro mtime), ela fica.
        const deNovo = fs.statSync(trava, { throwIfNoEntry: false });
        if (deNovo && deNovo.ino === st.ino && deNovo.mtimeMs === st.mtimeMs) fs.rmSync(trava, { force: true });
        continue;
      }
      if (Date.now() > limite) throw new Error('conducao.sentinela.trava: outra escrita da presenca nao terminou; tente de novo');
      dormirSincrono(25);
    }
  }
  try { return fn(); } finally { fs.rmSync(trava, { force: true }); }
}

function gravarPresenca(arquivo: string, p: PresencaDaSentinela): void {
  const temporario = `${arquivo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(p, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporario, arquivo);
}

/** A presenca da Sentinela nesta maquina, viva ou vencida; `null` quando nao ha uma valida gravada. */
export function presencaDaSentinela(raiz: string, opcoes: { agora?: Date; maquina?: string } = {}): LeituraDaPresenca | null {
  const gravada = lerPresencaGravada(caminhoDaPresenca(raiz, opcoes.maquina));
  return gravada ? comoLeitura(gravada, opcoes.agora ?? new Date()) : null;
}

/**
 * A batida da Sentinela: renova a presenca da propria sessao, ou a toma quando nao ha outra viva. Com outra
 * sessao viva nesta maquina, devolve `ok: false` e a presenca dela, sem tocar em nada: uma Sentinela por maquina.
 * So a troca (presenca nova, inclusive depois de uma vencida) vai ao ledger do projeto.
 */
export function baterSentinela(raiz: string, opcoes: { sessao: string; agora?: Date; maquina?: string }): BatidaDaSentinela {
  const sessao = exigirSessao(opcoes.sessao);
  const agora = opcoes.agora ?? new Date();
  const maquina = opcoes.maquina ?? nomeDaMaquina();
  const arquivo = caminhoDaPresenca(raiz, maquina);
  return comTrava(arquivo, () => {
    const atual = lerPresencaGravada(arquivo);
    const viva = !!atual && Date.parse(atual.expiraEm) > agora.getTime();
    if (atual && viva && atual.sessao !== sessao) return { ok: false, ligou: false, presenca: comoLeitura(atual, agora) };
    const quando = agora.toISOString();
    const nova: PresencaDaSentinela = {
      contrato: CONTRATO_DA_SENTINELA, canal: CANAL_DA_SENTINELA, maquina, sessao,
      desde: atual && viva ? atual.desde : quando, batidaEm: quando,
      expiraEm: new Date(agora.getTime() + PRAZO_DA_PRESENCA_MS).toISOString(),
    };
    gravarPresenca(arquivo, nova);
    const ligou = !(atual && viva);
    if (ligou) {
      registrar(dirDoLedgerDoProjeto(raiz), 'projeto', TIPOS_DE_EVENTO.sentinelaLigada, {
        canal: CANAL_DA_SENTINELA, sessao, maquina, prazoMs: PRAZO_DA_PRESENCA_MS,
        ...(atual ? { anterior: { sessao: atual.sessao, expiraEm: atual.expiraEm } } : {}),
      });
    }
    return { ok: true, ligou, presenca: comoLeitura(nova, agora) };
  });
}

/** Tira a presenca da propria sessao; a de outra sessao fica como esta. */
export function desligarSentinela(raiz: string, opcoes: { sessao: string; motivo?: string; agora?: Date; maquina?: string }): DesligamentoDaSentinela {
  const sessao = exigirSessao(opcoes.sessao);
  const agora = opcoes.agora ?? new Date();
  const maquina = opcoes.maquina ?? nomeDaMaquina();
  const arquivo = caminhoDaPresenca(raiz, maquina);
  return comTrava(arquivo, () => {
    const atual = lerPresencaGravada(arquivo);
    if (!atual || atual.sessao !== sessao) return { desligada: false, presenca: atual ? comoLeitura(atual, agora) : null };
    fs.rmSync(arquivo, { force: true });
    registrar(dirDoLedgerDoProjeto(raiz), 'projeto', TIPOS_DE_EVENTO.sentinelaDesligada, {
      canal: CANAL_DA_SENTINELA, sessao, maquina, motivo: (opcoes.motivo ?? 'pedido da sessao').slice(0, 200),
      vivaAte: atual.expiraEm,
    });
    return { desligada: true, presenca: null };
  });
}

// ---------------------------------------------------------------------------
// O passo do condutor, por thread aberta.
// ---------------------------------------------------------------------------

/** O que o condutor faz agora numa thread: despachar uma fase, consultar o retry, avisar ou nada. */
export type AcaoDoCondutor = 'despachar' | 'retomar' | 'avisar' | 'nada';

export interface PassoDoCondutor {
  thread: string;
  modo: Thread['modo'];
  faseAtual: Fase;
  /** Alguem conduz a thread agora (a mesma leitura do pulse: a sessao que encerrou o turno nao conduz mais). */
  conduzida: boolean;
  acao: AcaoDoCondutor;
  /** A fase do despacho, so com `acao: despachar`. */
  fase: Fase | null;
  /** O caso do nucleo para a thread, sem o limiar de 30 min do pulse e sem a forja. */
  caso: CasoParado | null;
  proximoPasso: string | null;
  /** A regra que decidiu, em uma frase. */
  porque: string;
  /** Desde quando o passo vale: o fim do turno do despacho, ou o bloqueio. E a chave do despacho na Sentinela. */
  desdeEm: string | null;
  /**
   * O ultimo `gate_blocked` ou `phase_dispatch_failed` depois do ultimo despacho, quando ha; `deDespacho` quando ele
   * veio de um despacho que nao abriu sessao (e nao do observador, no fim do turno).
   */
  bloqueio: { motivo: string; em: string; deDespacho: boolean } | null;
  /** A thread tem o pedido guardado na criacao (T6.0): sem ele, o render cai no texto de exemplo. */
  pedidoGuardado: boolean;
}

/** As fases que, com produto ja na branch, a sessao do bloco ja fez (ha produto, entao houve GO). */
const FASES_ANTES_DO_PRODUTO: readonly Fase[] = ['PLAN', 'GO'];
/** O artefato de cada fase que tem um, na pasta `docs/` da thread. */
const ARTEFATO_DA_FASE: Partial<Record<Fase, string>> = { GOAL: 'goal.md', PLAN: 'plan.md', CHECK: 'check.md' };
/** O evento que prova a fase sem artefato. */
const EVENTO_DA_FASE: Partial<Record<Fase, string>> = { SHIP: 'ship_done', MASTER: 'master_done' };
const BLOQUEIOS: readonly string[] = [TIPOS_DE_EVENTO.gateBloqueado, TIPOS_DE_EVENTO.despachoFalhou];

/**
 * Por que a sessao do ultimo despacho ja fez a fase, quando fez: no #Auto ela roda o bloco inteiro, e o
 * artefato da fase gravado depois do despacho, o produto na branch (PLAN e GO) ou o evento da fase (SHIP e
 * MASTER) depois dele provam que a fase seguinte ja aconteceu. `null`: nada prova, e a fase pode sair.
 */
export function faseJaFeita(raiz: string, t: Thread, fase: Fase, estado: EstadoDaEntrega, eventos: readonly EventoLedger[]): string | null {
  const despacho = [...eventos].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada);
  const desde = despacho ? Date.parse(despacho.ts) : Number.NEGATIVE_INFINITY;
  const artefato = ARTEFATO_DA_FASE[fase];
  if (artefato) {
    const st = fs.statSync(path.join(dirThread(raiz, t.id), 'docs', artefato), { throwIfNoEntry: false });
    if (st && st.mtimeMs >= desde) return `o ${artefato} foi gravado depois do despacho`;
  }
  if (FASES_ANTES_DO_PRODUTO.includes(fase) && estado.comProduto) return `a branch ja tem produto, e o ${fase} vem antes dele`;
  const evento = EVENTO_DA_FASE[fase];
  if (evento && eventos.some((e) => e.tipo === evento && Date.parse(e.ts) >= desde)) return `o ${evento} ja esta no ledger depois do despacho`;
  return null;
}

/** O bloqueio que sobrou do ultimo despacho: o ultimo evento de gate depois dele, quando reprova. */
export function bloqueioDepoisDoDespacho(eventos: readonly EventoLedger[]): { motivo: string; em: string; deDespacho: boolean } | null {
  let inicio = -1;
  for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].tipo === TIPOS_DE_EVENTO.faseDespachada) { inicio = i; break; }
  for (let i = eventos.length - 1; i > inicio; i--) {
    const e = eventos[i];
    if (e.tipo === TIPOS_DE_EVENTO.gateLiberado) return null;
    if (BLOQUEIOS.includes(e.tipo)) {
      return { motivo: typeof e.motivo === 'string' && e.motivo ? e.motivo : e.tipo, em: e.ts,
        deDespacho: e.tipo === TIPOS_DE_EVENTO.despachoFalhou || e.gate === 'phase.dispatch' };
    }
  }
  return null;
}

/** As fases da entrega: depois de um bloco que ja passou do CHECK, quem publica e entrega e o condutor externo e o dono. */
const FASES_DA_ENTREGA: readonly Fase[] = ['SHIP', 'MASTER'];

/**
 * O passo de uma thread, pelas leituras que o pulse ja faz dela (`EstadoDaEntrega`). `jaFeita` diz por que a
 * sessao do bloco ja fez uma fase (`faseJaFeita`), ou `null`; `doDono` e a pendencia do dono (`pendenciaDoDono`:
 * thread pausada, pergunta aberta, escalacao), que segura qualquer passo automatico.
 *
 * No #Auto, depois de uma fase concluida, vale a prova mais adiantada que a sessao do bloco deixou: a fase seguinte a
 * ela sai, e as do meio sem prova contam como feitas (nao ha CHECK sem GO). Se o bloco ja passou do CHECK, o passo e o
 * da entrega (SHIP e MASTER ficam com o condutor externo e o dono) e vira aviso.
 */
export function passoDaThread(t: Thread, estado: EstadoDaEntrega, eventos: readonly EventoLedger[], pedidoGuardado: boolean,
  jaFeita: (fase: Fase) => string | null = () => null, doDono: string | null = null): PassoDoCondutor {
  const espera = estado.espera;
  const base: Omit<PassoDoCondutor, 'acao' | 'porque'> = {
    thread: t.id, modo: t.modo, faseAtual: t.faseAtual, conduzida: estado.conduzidaAgora, fase: null,
    caso: estado.parado?.caso ?? null, proximoPasso: estado.parado?.proximoPasso ?? null,
    desdeEm: estado.parado?.desdeEm ?? espera?.fimDoTurnoEm ?? null,
    bloqueio: bloqueioDepoisDoDespacho(eventos), pedidoGuardado,
  };
  const avisarOuNada = (porque: string): PassoDoCondutor => ({ ...base, acao: base.caso ? 'avisar' : 'nada', porque });
  if (estado.conduzidaAgora) return { ...base, acao: 'nada', porque: 'conduzida agora: quem conduz segue' };
  if (doDono) return avisarOuNada(`o passo e do dono (${doDono}): nada sai sozinho`);
  // Como o cron: so o #Auto anda sem o dono. Nos outros modos o caso do nucleo vira aviso.
  if (t.modo !== 'auto') return avisarOuNada(`modo ${t.modo}: so o #Auto e conduzido sem o dono`);
  // Um despacho tentado depois do fim do turno falhou (a sessao nem abriu): quem decide o proximo passo e o retry plan,
  // com a ordem de fallback do runtime, e nao um despacho repetido.
  if (espera && base.bloqueio?.deDespacho && Date.parse(base.bloqueio.em) > Date.parse(espera.fimDoTurnoEm)) {
    return { ...base, acao: 'retomar', desdeEm: base.bloqueio.em,
      porque: `o despacho depois do fim do turno falhou (${base.bloqueio.motivo}): o retry plan diz se a retomada e automatica` };
  }
  if (espera?.tipo === 'check-sem-veredito') {
    return { ...base, acao: 'despachar', fase: 'CHECK', desdeEm: espera.fimDoTurnoEm,
      porque: 'CHECK em done sem exatamente um veredito: o passo do nucleo e redespachar o CHECK' };
  }
  if (espera?.tipo === 'concluida' && espera.comProva !== false) {
    const rodou = espera.fase as Fase | null;
    const i = rodou ? t.fases.indexOf(rodou) : -1;
    if (i < 0 || i + 1 >= t.fases.length) return avisarOuNada(`fase ${rodou ?? '-'} concluida e nao ha fase depois dela no ciclo`);
    // A prova mais adiantada que a sessao deixou depois da fase do resultado.
    let maisAdiantada = -1;
    let prova: string | null = null;
    for (let k = i + 1; k < t.fases.length; k++) {
      const feita = jaFeita(t.fases[k]);
      if (feita) { maisAdiantada = k; prova = `${t.fases[k]}: ${feita}`; }
    }
    const proxima = t.fases[maisAdiantada >= 0 ? maisAdiantada + 1 : i + 1] ?? null;
    if (!proxima) return avisarOuNada(`fase ${rodou} concluida, e a sessao do bloco ja fez ate o fim do ciclo (${prova})`);
    if (maisAdiantada >= 0 && FASES_DA_ENTREGA.includes(proxima)) {
      return avisarOuNada(`fase ${rodou} concluida, e a sessao do bloco ja passou do CHECK (${prova}): o passo e o da entrega`);
    }
    return { ...base, acao: 'despachar', fase: proxima, desdeEm: espera.fimDoTurnoEm,
      porque: prova ? `fase ${rodou} concluida, e a sessao do bloco ja fez ate ${prova}: a seguinte e ${proxima}`
        : `fase ${rodou} concluida: a seguinte e ${proxima}` };
  }
  if (!espera && base.bloqueio) {
    return { ...base, acao: 'retomar', desdeEm: base.bloqueio.em,
      porque: `bloqueio ${base.bloqueio.motivo} depois do ultimo despacho: o retry plan diz se a retomada e automatica` };
  }
  return avisarOuNada(espera ? `fim do turno ${espera.tipo}: o passo e do dono ou da entrega` : 'nada a conduzir agora');
}

function temPedidoGuardado(raiz: string, t: Thread): boolean {
  try { return pedidoDaThread(raiz, t) !== null; } catch { return false; }
}

/** O passo do condutor em cada thread aberta deste checkout, em ordem de id. */
export function passosDoCondutor(carregado: ManifestoCarregado, opcoes: { quando?: string } = {}): PassoDoCondutor[] {
  const quando = opcoes.quando ?? new Date().toISOString();
  const entregas = entregasDoProjeto(carregado, { quando, limiarMin: 0 });
  const passos: PassoDoCondutor[] = [];
  for (const estado of entregas.estados) {
    let t: Thread;
    try { t = lerThread(carregado.raiz, estado.thread); } catch { continue; }
    let eventos: EventoLedger[] = [];
    try { eventos = lerLedger(dirThread(carregado.raiz, t.id)); } catch { /* ledger ilegivel: sem bloqueio */ }
    passos.push(passoDaThread(t, estado, eventos, temPedidoGuardado(carregado.raiz, t),
      (fase) => faseJaFeita(carregado.raiz, t, fase, estado, eventos), pendenciaDoDono(t, eventos, quando)));
  }
  return passos.sort((a, b) => (a.thread < b.thread ? -1 : a.thread > b.thread ? 1 : 0));
}

export interface StatusDaSentinela {
  contrato: typeof CONTRATO_DA_SENTINELA;
  consultadoEm: string;
  maquina: string;
  presenca: LeituraDaPresenca | null;
  threads: PassoDoCondutor[];
}

/** O `ork conducao sentinela status`: a presenca desta maquina e o passo do condutor em cada thread aberta. */
export function statusDaSentinela(carregado: ManifestoCarregado, opcoes: { agora?: Date; maquina?: string } = {}): StatusDaSentinela {
  const agora = opcoes.agora ?? new Date();
  const maquina = opcoes.maquina ?? nomeDaMaquina();
  return {
    contrato: CONTRATO_DA_SENTINELA, consultadoEm: agora.toISOString(), maquina,
    presenca: presencaDaSentinela(carregado.raiz, { agora, maquina }),
    threads: passosDoCondutor(carregado, { quando: agora.toISOString() }),
  };
}

/** O status em texto, para o terminal. */
export function textoDoStatusDaSentinela(s: StatusDaSentinela): string {
  const m = msg().conducao.sentinela;
  const linhas: string[] = [];
  const p = s.presenca;
  linhas.push(!p ? m.desligada(s.maquina) : p.ativa ? m.ligada(s.maquina, p.canal, p.sessao.slice(0, 8)) : m.vencida(p.sessao.slice(0, 8)));
  if (s.threads.length === 0) linhas.push(m.nenhuma);
  for (const t of s.threads) {
    const acao = t.acao === 'despachar' ? m.despachar(t.fase) : t.acao;
    linhas.push(`  ${t.thread.padEnd(20)} ${t.modo.padEnd(8)} ${acao.padEnd(16)} ${t.porque}`);
  }
  return linhas.join('\n');
}

/**
 * RM-058, integração (T8 da ork-rm058integra, D12): o aceite do piloto. `aceiteDoPiloto` lê o log do arco, a supervisão, o
 * registro do relatório, os ledgers das threads do arco, o remoto (a ponta da base pelo `git ls-remote` e a ancestralidade
 * de cada merge) e a forja (os PRs da branch, quando o remoto é do GitHub), e dá o contrato `ork.noctum-piloto/v1`: as
 * medidas M1 a M10 (valor, unidade, fonte e lacunas), os critérios A1 a A8 e I1 a I6 com o limiar e a origem dele (`dono`
 * ou `proposta`), e o veredito (`aprovado`, `reprovado`, `incompleto` ou `simulado`).
 *
 * Medida que não se lê é lacuna, nunca zero, e o critério com lacuna fica incompleto. Qualquer marca de simulação (a máquina
 * do ensaio, o remoto de fixture, evento marcado `simulado`, o canal que grava num arquivo local) dá `simulado`, e o veredito
 * nunca é `aprovado`: o ensaio não vale como piloto. O resultado não traz o instante de quem roda: o mesmo arco dá o mesmo
 * hash. `publicavel` troca caminho absoluto, e-mail, id de sessão, conta, máquina e o dono do repositório por rótulos
 * estáveis; o arquivo completo fica no estado, ao lado do log do arco.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { repositorioGitHub } from './ci';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { autoriaHumana } from './master';
import { EstadoDoArco, lerArco } from './noctum-arco';
import { ConteudoDoEnvelope, RecusaDoArco, Unidade } from './noctum-envelope';
import { CADENCIA_MS } from './noctum-fila';
import { consumoDoEscopoNaUnidade, MedicaoDoArco, medirArco } from './noctum-medicao';
import { lerRegistro, RecusaDoRegistro } from './noctum-registro';
import { ARQUIVO_DO_TRANSPORTE, vencimentoDoRelatorio } from './noctum-relatorio';
import { ConteudoV2, correlacaoDoArco, dirDaSupervisao, EventoDaSupervisao, eventosDaSupervisao, RecusaDaSupervisao, threadsDoArco }
  from './noctum-supervisao';
import { ExecutorDoGh, ghPadrao } from './parado-no-condutor';
import { dirThread, lerThread } from './thread';
import { EventoLedger } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';

export const CONTRATO_PILOTO = 'ork.noctum-piloto/v1' as const;
export const CONTRATO_LIMIARES = 'ork.noctum-limiares/v1' as const;
/** A máquina do ensaio (`core/scripts/ensaio-noctum.cjs`): o arco que ela conduziu é simulado. */
export const MAQUINA_DO_ENSAIO = 'maquina-do-ensaio';
/** O arquivo completo do aceite, no estado, ao lado do log do arco. */
export const ARQUIVO_DO_ACEITE = 'aceite-piloto.json';

export type IdDaMedida = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9' | 'M10';
export type IdDoCriterio = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6';
export type VereditoDoPiloto = 'aprovado' | 'reprovado' | 'incompleto' | 'simulado';
/** `do-dono`: o núcleo não mede (a confirmação do dono, a escrita fora do repositório); o critério não muda o veredito. */
export type VereditoDoCriterio = 'aprovado' | 'reprovado' | 'incompleto' | 'do-dono';

export interface MedidaDoPiloto {
  id: IdDaMedida;
  nome: string;
  /** `null` é lacuna: a medida não se leu, e nunca vale zero. */
  valor: number | null;
  unidade: string;
  fonte: string;
  lacunas: string[];
  evidencia: Record<string, unknown>;
}

export interface CriterioDoPiloto {
  id: IdDoCriterio;
  texto: string;
  limiar: Record<string, number> | null;
  origemDoLimiar: 'dono' | 'proposta' | null;
  veredito: VereditoDoCriterio;
  detalhe: string;
}

export interface ResultadoDoAceite {
  contrato: typeof CONTRATO_PILOTO;
  arco: string;
  envelope: { contrato: string | null; versao: number | null; sha256: string | null };
  janela: { inicio: string; fim: string; fuso: string; horas: number } | null;
  encerramento: { motivo: string; em: string } | null;
  simulacao: { simulado: boolean; marcas: string[] };
  medidas: MedidaDoPiloto[];
  criterios: CriterioDoPiloto[];
  veredito: VereditoDoPiloto;
  lacunas: string[];
}

/** Os limiares dos critérios: os do dono (`--limiares`) e, no que ele não disse, a proposta do plano, marcada como proposta. */
export interface Limiares {
  /** A1: horas de condução sem intervenção; a proposta é a janela inteira do piloto. */
  m1MinimoHoras: number;
  /** A4: o tempo máximo de recuperação, em minutos (três cadências). */
  m5MaximoMin: number;
  /** A5: as entregas provadas mínimas; a proposta é 2 no piloto de até 6 h e 4 no de 12 h. */
  entregasMinimas: number;
  /** I4: a margem além do teto, em fração do teto (0: nada além dele). */
  margemDoTeto: number;
  /** A7: o atraso máximo da versão 1 do relatório depois do vencimento, em minutos (um tique). */
  atrasoDoRelatorioMin: number;
}

/** Uma falha da agenda: o tipo (F1 a F11), o instante em que foi injetada e, quando há, o alvo. */
export interface Injecao { falha: string; instante: string; alvo?: string }

/** O git que o aceite lê; em produção, o da raiz do projeto. Os testes o trocam. */
export interface LeitorDoGit {
  url(remoto: string): string | null;
  ponta(remoto: string, base: string): string | null;
  /** O sha é ancestral da ponta nesta cópia? `null` quando o git não sabe (o objeto não está aqui). */
  ancestral(sha: string, ponta: string): boolean | null;
}

export interface OpcoesDoAceite {
  injecoes?: Injecao[] | null;
  limiares?: Partial<Limiares> | null;
  remoto?: string;
  git?: LeitorDoGit;
  executorGh?: ExecutorDoGh;
  medir?: (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco;
}

export class RecusaDoAceite extends Error {
  constructor(readonly motivo: 'noctum.aceite.sem-arco' | 'noctum.aceite.limiares-invalidos' | 'noctum.aceite.injecoes-invalidas', detalhe: string) {
    super(`${motivo}: ${detalhe}`);
    this.name = 'RecusaDoAceite';
  }
}

const HORA = 3_600_000;
const MIN = 60_000;
const arred = (x: number, casas = 2): number => Math.round(x * 10 ** casas) / 10 ** casas;
const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** O git da raiz: a URL do remoto, a ponta da base pelo `ls-remote` e a ancestralidade pelo `merge-base`. */
export function gitDaRaiz(raiz: string): LeitorDoGit {
  return {
    url: (remoto) => { const r = exec('git', ['remote', 'get-url', '--', remoto], raiz, 15_000); return r.ok ? r.stdout.trim() : null; },
    ponta: (remoto, base) => {
      const r = exec('git', ['ls-remote', '--', remoto, `refs/heads/${base}`], raiz, 60_000);
      return r.ok ? r.stdout.trim().split(/\s+/)[0] || null : null;
    },
    ancestral: (sha, ponta) => {
      const r = exec('git', ['merge-base', '--is-ancestor', sha, ponta], raiz, 30_000);
      return r.code === 0 ? true : r.code === 1 ? false : null;
    },
  };
}

/** O remoto que não é um endereço de rede: caminho local ou `file://`. É o remoto de fixture do ensaio. */
export function remotoLocal(url: string): boolean {
  return /^file:/i.test(url) || /^(\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(url) || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[^@\s]+@[^:\s]+:/.test(url));
}

/** Os limiares da proposta, pela janela do piloto. */
export function limiaresDaProposta(horas: number): Limiares {
  return { m1MinimoHoras: arred(horas), m5MaximoMin: 15, entregasMinimas: horas < 12 ? 2 : 4, margemDoTeto: 0, atrasoDoRelatorioMin: CADENCIA_MS / MIN };
}

/** Confere os limiares do dono (`--limiares`): o contrato e números não negativos; o que falta fica com a proposta. */
export function lerLimiares(bruto: unknown): Partial<Limiares> {
  if (!objeto(bruto) || bruto.contrato !== CONTRATO_LIMIARES) {
    throw new RecusaDoAceite('noctum.aceite.limiares-invalidos', `os limiares do dono são um JSON com contrato ${CONTRATO_LIMIARES}`);
  }
  const saida: Partial<Limiares> = {};
  for (const chave of ['m1MinimoHoras', 'm5MaximoMin', 'entregasMinimas', 'margemDoTeto', 'atrasoDoRelatorioMin'] as const) {
    const v = bruto[chave];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RecusaDoAceite('noctum.aceite.limiares-invalidos', `${chave} não é um número não negativo`);
    saida[chave] = v;
  }
  return saida;
}

/** Lê a agenda de injeções: uma linha JSON por falha, com `falha` (F1 a F11) e `instante` (ISO). */
export function lerInjecoes(texto: string): Injecao[] {
  const saida: Injecao[] = [];
  for (const [i, linha] of texto.split('\n').entries()) {
    if (!linha.trim()) continue;
    let v: unknown;
    try { v = JSON.parse(linha); } catch { throw new RecusaDoAceite('noctum.aceite.injecoes-invalidas', `a linha ${i + 1} da agenda não é JSON`); }
    if (!objeto(v) || typeof v.falha !== 'string' || !/^F([1-9]|1[01])$/.test(v.falha) || typeof v.instante !== 'string' || !Number.isFinite(Date.parse(v.instante))) {
      throw new RecusaDoAceite('noctum.aceite.injecoes-invalidas', `a linha ${i + 1} da agenda precisa de falha (F1 a F11) e instante (ISO)`);
    }
    saida.push({ falha: v.falha, instante: new Date(v.instante).toISOString(), ...(typeof v.alvo === 'string' ? { alvo: v.alvo } : {}) });
  }
  return saida;
}

interface LedgerDaThread { trabalho: string; thread: string; eventos: EventoLedger[] | null; erro: string | null }

interface Entrega {
  trabalho: string; thread: string; ship: EventoLedger; provada: boolean | null; motivo: string; master: boolean; duplicadas: number;
}

/** O primeiro instante, depois da injeção, de um evento que a falha deve provocar; e o evento, como fonte. */
function sinalDe(eventos: ReadonlyArray<{ em: string; fonte: string }>, desde: number): { em: string; fonte: string } | null {
  return eventos.filter(e => Date.parse(e.em) >= desde).sort((a, b) => Date.parse(a.em) - Date.parse(b.em))[0] ?? null;
}

/**
 * O aceite de um arco, pelos registros do núcleo. Recusa só o arco que não existe; toda leitura que falha vira lacuna da
 * medida que dependia dela.
 */
export function aceiteDoPiloto(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoAceite = {}): ResultadoDoAceite {
  const { raiz } = carregado;
  let estado: EstadoDoArco | null;
  try { estado = lerArco(raiz, arco); }
  catch (e) {
    if (e instanceof RecusaDoArco) throw new RecusaDoAceite('noctum.aceite.sem-arco', `o log do arco ${arco} não se lê (${e.motivo})`);
    throw e;
  }
  if (!estado?.conteudo || !estado.autorizadoPor) throw new RecusaDoAceite('noctum.aceite.sem-arco', `o arco ${arco} nunca foi autorizado pelo dono`);
  const conteudo: ConteudoDoEnvelope = estado.conteudo;
  const lacunasGerais: string[] = [];
  const janela = conteudo.janela;
  const inicioMs = Math.max(Date.parse(janela.inicio), Date.parse(estado.autorizadoPor.recebidoEm));
  const fim = estado.encerramento?.em ?? janela.fim;
  const fimMs = Date.parse(fim);
  const horasDaJanela = (Date.parse(janela.fim) - Date.parse(janela.inicio)) / HORA;
  if (!estado.encerramento) lacunasGerais.push('o arco ainda não fechou: as medidas valem até o fim da janela');
  const git = opcoes.git ?? gitDaRaiz(raiz);
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica?.remoto ?? 'origin';

  // As leituras: a supervisão, o relatório e os ledgers das threads do arco.
  let supervisao: Array<{ em: string; evento: EventoDaSupervisao }> | null = null;
  let erroDaSupervisao: string | null = null;
  try { supervisao = eventosDaSupervisao(raiz, arco); }
  catch (e) { if (!(e instanceof RecusaDaSupervisao)) throw e; erroDaSupervisao = `o log da supervisão não se lê (${e.motivo})`; }
  let relatorio: ReturnType<typeof lerRegistro<Record<string, unknown>>> | null = null;
  let erroDoRelatorio: string | null = null;
  try { relatorio = lerRegistro<Record<string, unknown>>(raiz, arco, 'relatorio'); }
  catch (e) { if (!(e instanceof RecusaDoRegistro)) throw e; erroDoRelatorio = `o registro do relatório não se lê (${e.motivo})`; }
  const comTrabalhos = 'trabalhos' in conteudo && Array.isArray((conteudo as ConteudoV2).trabalhos);
  const porTrabalho = comTrabalhos ? threadsDoArco(raiz, conteudo as ConteudoV2, estado) : new Map<string, string>();
  const ledgers: LedgerDaThread[] = [...porTrabalho].map(([trabalho, thread]) => {
    try { return { trabalho, thread, eventos: lerLedger(dirThread(raiz, thread)), erro: null }; }
    catch (e) { return { trabalho, thread, eventos: null, erro: `o ledger da thread ${thread} não se lê (${(e as Error).message.slice(0, 120)})` }; }
  });
  const ilegiveis = ledgers.filter(l => l.erro).map(l => l.erro!);
  const eventosDasThreads: Array<EventoLedger & { threadDoArco: string }> = ledgers.flatMap(l => (l.eventos ?? []).map(e => ({ ...e, threadDoArco: l.thread })));

  // As marcas de simulação.
  const marcas: string[] = [];
  const urlDoRemoto = git.url(remoto);
  if (urlDoRemoto && remotoLocal(urlDoRemoto)) marcas.push(`o remoto ${remoto} é de fixture (caminho local), não um endereço de rede`);
  const maquinas = new Set((supervisao ?? []).map(l => objeto(l.evento) && 'quem' in l.evento ? l.evento.quem.maquina : null).filter((x): x is string => !!x));
  if (maquinas.has(MAQUINA_DO_ENSAIO)) marcas.push(`a máquina do ensaio (${MAQUINA_DO_ENSAIO}) conduziu o arco`);
  const simulados = eventosDasThreads.filter(e => e.simulado === true).length;
  if (simulados) marcas.push(`${simulados} evento(s) marcado(s) simulado nos ledgers das threads do arco`);
  try {
    const transporte = fs.readFileSync(path.join(raiz, '.orkastery', 'monitor', ARQUIVO_DO_TRANSPORTE), 'utf8');
    if (/simulad/i.test(transporte)) marcas.push('o transporte do canal do relatório é simulado (grava num arquivo local)');
  } catch { /* sem transporte configurado: o relatório diz a lacuna */ }

  const medidas: MedidaDoPiloto[] = [];
  const medida = (m: MedidaDoPiloto) => { medidas.push(m); return m; };

  // M1: condução sem intervenção.
  const atos: Array<{ em: string; ato: string }> = [];
  if (estado.revogadoPor) atos.push({ em: estado.revogadoPor.recebidoEm, ato: 'revogação do envelope pelo dono' });
  if ((estado.versao ?? 1) > 1 && Date.parse(estado.autorizadoPor.recebidoEm) > Date.parse(janela.inicio)) {
    atos.push({ em: estado.autorizadoPor.recebidoEm, ato: `emenda do envelope (versão ${estado.versao}) durante a janela` });
  }
  for (const e of eventosDasThreads) {
    const t = Date.parse(e.ts);
    if (!(t >= inicioMs && t <= fimMs)) continue;
    if (e.tipo === 'human_gate' && e.source === 'human') atos.push({ em: e.ts, ato: `gate respondido pelo dono na thread ${e.threadDoArco}` });
    else if (e.tipo === 'session_answered') atos.push({ em: e.ts, ato: `sessão respondida pelo dono na thread ${e.threadDoArco}` });
    else if (e.tipo === TIPOS_DE_EVENTO.threadFechadaAdmin) atos.push({ em: e.ts, ato: `thread ${e.threadDoArco} fechada à mão` });
    else if (e.tipo === TIPOS_DE_EVENTO.masterConcluido && autoriaHumana(e.por) && e.regime !== 'omissao') {
      atos.push({ em: e.ts, ato: `MASTER do dono na thread ${e.threadDoArco}` });
    } else if (e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.correlacao !== correlacaoDoArco(arco)) {
      atos.push({ em: e.ts, ato: `despacho de fora do arco na thread ${e.threadDoArco}` });
    }
  }
  atos.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  const primeiroAto = atos[0] ?? null;
  const ateOAto = primeiroAto ? Math.max(inicioMs, Date.parse(primeiroAto.em)) : fimMs;
  medida({ id: 'M1', nome: 'Condução sem intervenção', valor: ilegiveis.length ? null : arred(Math.max(0, ateOAto - inicioMs) / HORA), unidade: 'h',
    fonte: 'log do arco e ledgers das threads do arco', lacunas: [...ilegiveis], evidencia: { inicio: new Date(inicioMs).toISOString(), fim, atos } });

  // M2 e M3: as entregas com prova e o MASTER delas.
  const ponta = new Map<string, string | null>();
  const pontaDa = (base: string) => { if (!ponta.has(base)) ponta.set(base, git.ponta(remoto, base)); return ponta.get(base)!; };
  const entregas: Entrega[] = [];
  const lacunasDaEntrega: string[] = [...ilegiveis];
  for (const l of ledgers) {
    const ships = (l.eventos ?? []).filter(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
    if (!ships.length) continue;
    const ship = ships[0];
    const sha = typeof ship.mergeSha === 'string' && ship.mergeSha ? ship.mergeSha : typeof ship.shaRemoto === 'string' ? ship.shaRemoto : null;
    const base = typeof ship.para === 'string' && ship.para ? ship.para : comTrabalhos ? conteudo.destinos[0]?.base ?? 'main' : 'main';
    let provada: boolean | null = false, motivo = '';
    if (ship.pushVerificado !== true || !sha) motivo = 'ship_done sem a prova do push';
    else {
      const p = pontaDa(base);
      const anc = p ? git.ancestral(sha, p) : null;
      if (!p) { provada = null; motivo = `a ponta de ${base} no remoto ${remoto} não se leu`; lacunasDaEntrega.push(`${l.thread}: ${motivo}`); }
      else if (anc === null) { provada = null; motivo = `o merge ${sha.slice(0, 12)} não está nesta cópia`; lacunasDaEntrega.push(`${l.thread}: ${motivo}`); }
      else { provada = anc; motivo = anc ? `merge ${sha.slice(0, 12)} na ponta de ${base}` : `o merge ${sha.slice(0, 12)} não está na base do remoto`; }
    }
    let fechada = false;
    try { fechada = lerThread(raiz, l.thread).status === 'fechada'; } catch { /* a thread ilegível não tem MASTER provado */ }
    const master = fechada && (l.eventos ?? []).some(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido || e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao);
    entregas.push({ trabalho: l.trabalho, thread: l.thread, ship, provada, motivo, master, duplicadas: ships.length - 1 });
  }
  const provadas = entregas.filter(e => e.provada === true);
  const semLeitura = entregas.some(e => e.provada === null) || ilegiveis.length > 0;
  medida({ id: 'M2', nome: 'Entregas com prova', valor: semLeitura ? null : provadas.length, unidade: `entregas provadas de ${entregas.length} alegadas`,
    fonte: 'ship_done dos ledgers, ponta da base pelo git ls-remote e ancestralidade do merge', lacunas: lacunasDaEntrega,
    evidencia: { alegadas: entregas.length, entregas: entregas.map(e => ({ trabalho: e.trabalho, thread: e.thread, provada: e.provada, motivo: e.motivo })) } });
  medida({ id: 'M3', nome: 'MASTER por omissão', valor: semLeitura ? null : provadas.filter(e => e.master).length, unidade: `entregas com MASTER de ${provadas.length} provadas`,
    fonte: 'master_done e aceite_por_omissao dos ledgers, e a thread fechada', lacunas: semLeitura ? ['as entregas não se provaram todas'] : [],
    evidencia: { semMaster: provadas.filter(e => !e.master).map(e => e.thread) } });

  // M4 e M5: as falhas injetadas e a recuperação delas.
  const sup = supervisao ?? [];
  const daSupervisao = (tipos: string[]) => sup.filter(l => tipos.includes(l.evento.tipo)).map(l => ({ em: l.em, fonte: `supervisão: ${l.evento.tipo}` }));
  const doRelatorio = (tipos: string[]) => (relatorio ?? []).filter(l => tipos.includes(String(l.evento.tipo))).map(l => ({ em: l.em, fonte: `relatório: ${String(l.evento.tipo)}` }));
  const dosLedgers = (tipos: string[]) => eventosDasThreads.filter(e => tipos.includes(e.tipo)).map(e => ({ em: e.ts, fonte: `ledger da ${e.threadDoArco}: ${e.tipo}` }));
  const SINAIS: Record<string, () => Array<{ em: string; fonte: string }> | string> = {
    F1: () => erroDaSupervisao ?? daSupervisao(['retomada_autorizada']),
    F2: () => erroDaSupervisao ?? daSupervisao(['conducao_assumida']),
    F3: () => erroDaSupervisao ?? daSupervisao(['vigia_interrompido']),
    F4: () => dosLedgers([TIPOS_DE_EVENTO.verificacao, TIPOS_DE_EVENTO.shipPublicado, TIPOS_DE_EVENTO.shipConcluido]),
    F5: () => dosLedgers([TIPOS_DE_EVENTO.shipConcluido]),
    F6: () => erroDaSupervisao ?? daSupervisao(['conta_fora']),
    F7: () => erroDoRelatorio ?? doRelatorio(['envio_confirmado']),
    F8: () => erroDaSupervisao ?? daSupervisao(['efeito_reconciliado']),
    F9: () => erroDaSupervisao ?? daSupervisao(['tique_concluido']),
    F10: () => 'a partição entre máquinas é medida com a coordenação da N3 (bloco B)',
    F11: () => 'a máquina perdida é medida com a coordenação da N3 (bloco B)',
  };
  const injecoes = opcoes.injecoes ?? null;
  const recuperacoes = (injecoes ?? []).map(i => {
    const fontes = SINAIS[i.falha]?.() ?? `falha desconhecida: ${i.falha}`;
    if (typeof fontes === 'string') return { ...i, lacuna: fontes, sinal: null as { em: string; fonte: string } | null };
    return { ...i, lacuna: null as string | null, sinal: sinalDe(fontes, Date.parse(i.instante)) };
  });
  const lacunasDaAgenda = injecoes === null ? ['sem a agenda de injeções (--injecoes)'] : recuperacoes.filter(r => r.lacuna).map(r => `${r.falha}: ${r.lacuna}`);
  const recuperadas = recuperacoes.filter(r => r.sinal);
  medida({ id: 'M4', nome: 'Falhas recuperadas', valor: lacunasDaAgenda.length ? null : recuperadas.length, unidade: `recuperadas de ${recuperacoes.length} injetadas`,
    fonte: 'agenda de injeções, log da supervisão, registro do relatório e ledgers', lacunas: lacunasDaAgenda,
    evidencia: { injecoes: recuperacoes.map(r => ({ falha: r.falha, instante: r.instante, sinal: r.sinal, lacuna: r.lacuna })) } });
  const tempos = recuperadas.map(r => (Date.parse(r.sinal!.em) - Date.parse(r.instante)) / MIN).sort((a, b) => a - b);
  const mediana = tempos.length ? (tempos.length % 2 ? tempos[(tempos.length - 1) / 2] : (tempos[tempos.length / 2 - 1] + tempos[tempos.length / 2]) / 2) : null;
  medida({ id: 'M5', nome: 'Tempo de recuperação', valor: lacunasDaAgenda.length || !tempos.length ? null : arred(tempos.at(-1)!), unidade: 'min (máximo)',
    fonte: 'da injeção ao primeiro sinal de retomada no log', lacunas: lacunasDaAgenda.length ? lacunasDaAgenda : tempos.length ? [] : ['nenhuma falha recuperada para medir'],
    evidencia: { mediana: mediana === null ? null : arred(mediana), maximo: tempos.length ? arred(tempos.at(-1)!) : null } });

  // M6: violações do envelope.
  const contas = new Set([...conteudo.orcamento.porConta.map(c => c.conta), ...(comTrabalhos ? (conteudo as ConteudoV2).capacidade.porConta.map(c => c.conta) : [])]);
  const bases = new Set(conteudo.destinos.map(d => d.base));
  const violacoes: string[] = [];
  for (const d of estado.despachos) {
    const t = Date.parse(d.reservadoEm);
    if (t < Date.parse(janela.inicio) || t > fimMs) violacoes.push(`despacho ${d.seq} (${d.trabalho}) fora da janela vigente`);
    if (!contas.has(d.conta)) violacoes.push(`despacho ${d.seq} (${d.trabalho}) pela conta fora do envelope`);
  }
  for (const e of entregas) {
    if (typeof e.ship.para === 'string' && e.ship.para && !bases.has(e.ship.para)) violacoes.push(`a entrega de ${e.trabalho} foi para uma base fora do destino`);
    if (Date.parse(e.ship.ts) > fimMs) violacoes.push(`a entrega de ${e.trabalho} saiu depois da janela`);
  }
  medida({ id: 'M6', nome: 'Violações do envelope', valor: violacoes.length, unidade: 'violações', fonte: 'log do arco e ship_done dos ledgers', lacunas: [],
    evidencia: { violacoes } });

  // M7: efeitos duplicados.
  const duplicados: string[] = [];
  for (const e of entregas) if (e.duplicadas) duplicados.push(`${e.duplicadas} ship_done a mais na thread ${e.thread}`);
  const pushes = new Map<string, number>();
  for (const e of eventosDasThreads) {
    if (e.tipo !== TIPOS_DE_EVENTO.shipPublicado || e.pushFeito !== true || typeof e.head !== 'string') continue;
    const chave = `${e.threadDoArco} ${e.head}`;
    pushes.set(chave, (pushes.get(chave) ?? 0) + 1);
  }
  for (const [chave, n] of pushes) if (n > 1) duplicados.push(`${n} pushes do mesmo SHA (${chave})`);
  const porSessao = new Map<string, number>();
  for (const d of estado.despachos) if (d.sessionId) porSessao.set(d.sessionId, (porSessao.get(d.sessionId) ?? 0) + 1);
  for (const [s, n] of porSessao) if (n > 1) duplicados.push(`${n} despachos para a mesma sessão ${s}`);
  const paginas = new Map<string, number>();
  for (const l of relatorio ?? []) {
    if (l.evento.tipo !== 'envio_confirmado') continue;
    const chave = `versão ${String(l.evento.versao)}, página ${String(l.evento.pagina)}, canal ${String(l.evento.canal)}`;
    paginas.set(chave, (paginas.get(chave) ?? 0) + 1);
  }
  for (const [chave, n] of paginas) if (n > 1) duplicados.push(`${n} envios confirmados da ${chave}`);
  const lacunasDaForja: string[] = [];
  const repositorio = urlDoRemoto && !remotoLocal(urlDoRemoto) ? repositorioGitHub(urlDoRemoto) : null;
  if (repositorio) {
    const gh = opcoes.executorGh ?? ghPadrao;
    for (const e of entregas) {
      let branch: string | null = null;
      try { branch = branchDaWorktree(lerThread(raiz, e.thread)); } catch { branch = null; }
      if (!branch) continue;
      const r = gh(['pr', 'list', `--repo=${repositorio}`, `--head=${branch}`, '--state=all', '--json=number,state,headRefOid'], 30_000);
      let prs: Array<{ number: number; state: string }> | null = null;
      try { prs = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { prs = null; }
      if (!Array.isArray(prs)) { lacunasDaForja.push(`os PRs da branch ${branch} não se leram na forja`); continue; }
      const validos = prs.filter(x => x.state !== 'CLOSED');
      if (validos.length > 1) duplicados.push(`${validos.length} PRs da mesma branch ${branch}`);
    }
  }
  const lacunasDoM7 = [...(erroDoRelatorio ? [erroDoRelatorio] : []), ...lacunasDaForja, ...ilegiveis];
  medida({ id: 'M7', nome: 'Efeitos duplicados', valor: lacunasDoM7.length && !duplicados.length ? null : duplicados.length, unidade: 'efeitos duplicados',
    fonte: 'ledgers (ship_done e ship_published), log do arco, registro do relatório e PRs da forja', lacunas: lacunasDoM7, evidencia: { duplicados } });

  // M8: evidência perdida.
  const perdidas: string[] = [...ilegiveis, ...(erroDaSupervisao ? [erroDaSupervisao] : []), ...(erroDoRelatorio ? [erroDoRelatorio] : [])];
  for (const e of entregas) if (e.motivo === 'ship_done sem a prova do push') perdidas.push(`a entrega de ${e.trabalho} (${e.thread}) não tem a prova do push`);
  medida({ id: 'M8', nome: 'Evidência perdida', valor: perdidas.length, unidade: 'evidências perdidas', fonte: 'ledgers, log da supervisão e registro do relatório',
    lacunas: [], evidencia: { perdidas } });

  // M9: consumo contra o teto, por escopo e unidade.
  let medicao: MedicaoDoArco | null = null;
  let erroDaMedicao: string | null = null;
  const tetos: Array<{ escopo: string; unidade: Unidade; teto: number; consumo: number | null; lacuna: string | null }> = [];
  const consumoDe = (escopo: 'arco' | { conta: string } | { runtime: string }, unidade: Unidade): { valor: number | null; lacuna: string | null } => {
    if (unidade === 'sessoes') {
      const v = escopo === 'arco' ? estado!.consumo.arco : 'conta' in escopo ? estado!.consumo.porConta[escopo.conta] ?? 0 : estado!.consumo.porRuntime[escopo.runtime] ?? 0;
      return { valor: v, lacuna: null };
    }
    if (!medicao && !erroDaMedicao) {
      try { medicao = (opcoes.medir ?? ((r, e, q) => medirArco(r, e, { quando: q })))(raiz, estado!, fim); }
      catch (e) { erroDaMedicao = `a medição falhou (${(e as Error).message.slice(0, 120)})`; }
    }
    if (!medicao) return { valor: null, lacuna: erroDaMedicao };
    const c = consumoDoEscopoNaUnidade(medicao, escopo, unidade);
    return { valor: c.valor, lacuna: c.valor === null ? c.lacunas.join('; ') || 'consumo desconhecido' : null };
  };
  const o = conteudo.orcamento;
  const listaDeTetos: Array<[string, 'arco' | { conta: string } | { runtime: string }, { valor: number; unidade: Unidade }]> = [
    ['arco', 'arco', o.arco], ...o.porConta.map(c => [`conta ${c.conta}`, { conta: c.conta }, c.teto] as [string, { conta: string }, typeof c.teto]),
    ...o.porRuntime.map(r => [`runtime ${r.runtime}`, { runtime: r.runtime }, r.teto] as [string, { runtime: string }, typeof r.teto])];
  for (const [nome, escopo, teto] of listaDeTetos) {
    const c = consumoDe(escopo, teto.unidade);
    tetos.push({ escopo: nome, unidade: teto.unidade, teto: teto.valor, consumo: c.valor, lacuna: c.lacuna });
  }
  const lacunasDoTeto = tetos.filter(t => t.lacuna).map(t => `${t.escopo}: ${t.lacuna}`);
  const acima = tetos.filter(t => t.consumo !== null && t.consumo > t.teto);
  medida({ id: 'M9', nome: 'Consumo contra o teto', valor: lacunasDoTeto.length ? null : acima.length, unidade: 'escopos acima do teto',
    fonte: 'consumo do log do arco e a medição das unidades', lacunas: lacunasDoTeto, evidencia: { tetos } });

  // M10: o relatório da manhã.
  const lacunasDoRelatorio: string[] = erroDoRelatorio ? [erroDoRelatorio] : [];
  const vencimento = vencimentoDoRelatorio(conteudo);
  const composicoes = (relatorio ?? []).filter(l => l.evento.tipo === 'composto');
  const v1 = composicoes.find(l => l.evento.versao === 1) ?? null;
  const paginasDaV1 = v1 && Array.isArray(v1.evento.paginas) ? v1.evento.paginas.length : 0;
  const confirmadasDaV1 = (relatorio ?? []).filter(l => l.evento.tipo === 'envio_confirmado' && l.evento.versao === 1);
  const recibos = new Set(confirmadasDaV1.map(l => l.evento.pagina));
  const ultimoRecibo = confirmadasDaV1.map(l => Date.parse(l.em)).sort((a, b) => a - b).at(-1) ?? null;
  const revertidas = eventosDasThreads.filter(e => e.tipo === TIPOS_DE_EVENTO.rollbackConcluido && v1 && Date.parse(e.ts) >= Date.parse(v1.em));
  const corrigida = composicoes.some(l => l.evento.motivo === 'correcao');
  const falhasDoRelatorio: string[] = [];
  if (!v1) falhasDoRelatorio.push('a versão 1 não foi composta');
  else {
    if (recibos.size < paginasDaV1) falhasDoRelatorio.push(`${paginasDaV1 - recibos.size} página(s) da versão 1 sem recibo`);
    if (ultimoRecibo !== null && ultimoRecibo > Date.parse(vencimento) + (opcoes.limiares?.atrasoDoRelatorioMin ?? CADENCIA_MS / MIN) * MIN) {
      falhasDoRelatorio.push('o último recibo da versão 1 chegou depois do vencimento e de um tique');
    }
  }
  if (revertidas.length && !corrigida) falhasDoRelatorio.push(`${revertidas.length} entrega(s) revertida(s) sem a correção explícita`);
  if ([...paginas.values()].some(n => n > 1)) falhasDoRelatorio.push('página enviada duas vezes ao mesmo canal');
  medida({ id: 'M10', nome: 'Relatório da manhã', valor: lacunasDoRelatorio.length ? null : falhasDoRelatorio.length ? 0 : 1, unidade: '1 no horário com recibo, 0 fora',
    fonte: 'registro do relatório do arco', lacunas: lacunasDoRelatorio,
    evidencia: { vencimento, versao1: v1 ? { compostoEm: v1.em, paginas: paginasDaV1, recibos: recibos.size } : null, falhas: falhasDoRelatorio } });

  // Os critérios.
  const proposta = limiaresDaProposta(horasDaJanela);
  const doDono = opcoes.limiares ?? {};
  const limiar = <K extends keyof Limiares>(k: K): { valor: number; origem: 'dono' | 'proposta' } =>
    doDono[k] !== undefined ? { valor: doDono[k]!, origem: 'dono' } : { valor: proposta[k], origem: 'proposta' };
  const m = (id: IdDaMedida) => medidas.find(x => x.id === id)!;
  const criterios: CriterioDoPiloto[] = [];
  const criterio = (id: IdDoCriterio, texto: string, usados: Array<keyof Limiares>, lacuna: boolean, ok: boolean, detalhe: string) => {
    const ls = usados.map(k => [k, limiar(k)] as const);
    criterios.push({ id, texto, limiar: ls.length ? Object.fromEntries(ls.map(([k, l]) => [k, l.valor])) : null,
      origemDoLimiar: ls.length ? (ls.every(([, l]) => l.origem === 'dono') ? 'dono' : 'proposta') : null,
      veredito: lacuna ? 'incompleto' : ok ? 'aprovado' : 'reprovado', detalhe });
  };
  const nulo = (...ids: IdDaMedida[]) => ids.some(id => m(id).valor === null);
  criterio('A1', 'M1 de ao menos a janela do piloto', ['m1MinimoHoras'], nulo('M1'), (m('M1').valor ?? 0) >= limiar('m1MinimoHoras').valor,
    `${m('M1').valor ?? 'lacuna'} h sem ato do dono`);
  criterio('A2', 'M6, M7 e M8 em zero', [], nulo('M6', 'M7', 'M8'), m('M6').valor === 0 && m('M7').valor === 0 && m('M8').valor === 0,
    `violações ${m('M6').valor ?? 'lacuna'}, duplicados ${m('M7').valor ?? 'lacuna'}, evidências perdidas ${m('M8').valor ?? 'lacuna'}`);
  criterio('A3', 'M9 dentro do teto em todo escopo', [], nulo('M9'), m('M9').valor === 0, `${m('M9').valor ?? 'lacuna'} escopo(s) acima do teto`);
  criterio('A4', 'M4 em todas as injeções e M5 com máximo dentro do limiar', ['m5MaximoMin'], nulo('M4') || (recuperadas.length > 0 && nulo('M5')),
    m('M4').valor === recuperacoes.length && (m('M5').valor === null || m('M5').valor! <= limiar('m5MaximoMin').valor),
    `${m('M4').valor ?? 'lacuna'} de ${recuperacoes.length} recuperadas; máximo ${m('M5').valor ?? '-'} min`);
  criterio('A5', 'M2 com toda entrega alegada provada e o mínimo de entregas', ['entregasMinimas'], nulo('M2'),
    m('M2').valor === entregas.length && (m('M2').valor ?? 0) >= limiar('entregasMinimas').valor, `${m('M2').valor ?? 'lacuna'} provadas de ${entregas.length} alegadas`);
  criterio('A6', 'M3 em todas as entregas provadas', [], nulo('M3'), m('M3').valor === provadas.length, `${m('M3').valor ?? 'lacuna'} de ${provadas.length} com MASTER`);
  criterio('A7', 'M10 entregue no horário, com recibo, sem duplicação', ['atrasoDoRelatorioMin'], nulo('M10'), m('M10').valor === 1,
    falhasDoRelatorio.join('; ') || 'a versão 1 saiu no horário com recibo de todas as páginas');
  criterios.push({ id: 'A8', texto: 'o dono confirma o aceite pelo ingresso tipado', limiar: null, origemDoLimiar: null, veredito: 'do-dono',
    detalhe: 'a ratificação do dono vai no aceite.json, com a referência do recibo do ingresso' });
  criterio('I1', 'nenhuma violação do envelope (M6)', [], nulo('M6'), m('M6').valor === 0, violacoes.join('; ') || 'nenhuma');
  criterio('I2', 'nenhum efeito duplicado (M7)', [], nulo('M7'), m('M7').valor === 0, duplicados.join('; ') || 'nenhum');
  criterio('I3', 'nenhuma evidência perdida (M8)', [], nulo('M8'), m('M8').valor === 0, perdidas.join('; ') || 'nenhuma');
  const alemDaMargem = tetos.filter(t => t.consumo !== null && t.consumo > t.teto * (1 + limiar('margemDoTeto').valor));
  criterio('I4', 'nenhum teto excedido além da margem (M9)', ['margemDoTeto'], nulo('M9'), alemDaMargem.length === 0,
    alemDaMargem.map(t => `${t.escopo}: ${t.consumo} de ${t.teto} ${t.unidade}`).join('; ') || 'nenhum');
  criterios.push({ id: 'I5', texto: 'nenhuma escrita fora do repositório do piloto ou da raiz de estado dele', limiar: null, origemDoLimiar: null,
    veredito: 'do-dono', detalhe: 'o núcleo não mede a escrita fora do repositório: o dono confere' });
  criterio('I6', 'o dono não revogou o envelope', [], false, !estado.revogadoPor && estado.encerramento?.motivo !== 'revogado',
    estado.revogadoPor ? `revogado em ${estado.revogadoPor.recebidoEm}` : 'sem revogação');

  const veredito: VereditoDoPiloto = marcas.length ? 'simulado' : criterios.some(c => c.veredito === 'reprovado') ? 'reprovado'
    : criterios.some(c => c.veredito === 'incompleto') ? 'incompleto' : 'aprovado';
  return {
    contrato: CONTRATO_PILOTO, arco,
    envelope: { contrato: conteudo.contrato ?? null, versao: estado.versao, sha256: estado.envelopeSha256 },
    janela: { inicio: janela.inicio, fim: janela.fim, fuso: janela.fuso, horas: arred(horasDaJanela) },
    encerramento: estado.encerramento ? { motivo: estado.encerramento.motivo, em: estado.encerramento.em } : null,
    simulacao: { simulado: marcas.length > 0, marcas },
    medidas, criterios, veredito,
    lacunas: [...lacunasGerais, ...medidas.flatMap(x => x.lacunas.map(l => `${x.id}: ${l}`))],
  };
}

/** O texto canônico do resultado e o sha256 dele: o mesmo arco dá o mesmo hash. */
export function hashDoAceite(r: ResultadoDoAceite): { texto: string; sha256: string } {
  const texto = `${JSON.stringify(r, null, 2)}\n`;
  return { texto, sha256: sha256(texto) };
}

/** Grava o arquivo completo no estado, ao lado do log do arco; devolve o caminho e o sha256. */
export function gravarAceite(raiz: string, r: ResultadoDoAceite): { arquivo: string; sha256: string } {
  const { texto, sha256: hash } = hashDoAceite(r);
  const arquivo = path.join(dirDaSupervisao(raiz, r.arco), ARQUIVO_DO_ACEITE);
  fs.writeFileSync(arquivo, texto, { mode: 0o600 });
  fs.chmodSync(arquivo, 0o600);
  return { arquivo, sha256: hash };
}

/**
 * A versão publicável: o mesmo resultado com caminho absoluto, e-mail, id de sessão, conta, máquina e o dono do repositório
 * trocados por rótulos estáveis (`caminho-1`, `email-1`, `sessao-1`, `conta-1`, `maquina-1`, `repositorio-do-piloto`), e o
 * sha256 do arquivo completo, que fica no estado. `sensiveis` são as contas e máquinas que o arco conhece.
 */
export function publicavel(r: ResultadoDoAceite, sha256DoCompleto: string, sensiveis: { contas: string[]; maquinas: string[]; repositorios: string[] }):
  ResultadoDoAceite & { publicavel: true; sha256DoCompleto: string } {
  const rotulos = new Map<string, string>();
  const contagem = new Map<string, number>();
  const rotulo = (tipo: string, valor: string): string => {
    const chave = `${tipo}\u0000${valor}`;
    if (!rotulos.has(chave)) { const n = (contagem.get(tipo) ?? 0) + 1; contagem.set(tipo, n); rotulos.set(chave, `${tipo}-${n}`); }
    return rotulos.get(chave)!;
  };
  const fixos: Array<[string, string]> = [
    ...sensiveis.repositorios.filter(Boolean).map(x => [x, 'repositorio-do-piloto'] as [string, string]),
    ...sensiveis.contas.filter(Boolean).map(x => [x, rotulo('conta', x)] as [string, string]),
    ...sensiveis.maquinas.filter(Boolean).map(x => [x, rotulo('maquina', x)] as [string, string]),
  ].sort((a, b) => b[0].length - a[0].length);
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const limpar = (s: string): string => {
    let x = s;
    x = x.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (e) => rotulo('email', e));
    x = x.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (e) => rotulo('sessao', e.toLowerCase()));
    x = x.replace(/(^|[\s(`'"=:,])((?:\/[^\s/`'"),:]+)+\/?)/g, (_m, antes: string, c: string) => `${antes}${rotulo('caminho', c)}`);
    for (const [valor, novo] of fixos) x = x.replace(new RegExp(`(?<![A-Za-z0-9_-])${escapar(valor)}(?![A-Za-z0-9_-])`, 'g'), novo);
    return x;
  };
  const andar = (v: unknown): unknown => typeof v === 'string' ? limpar(v) : Array.isArray(v) ? v.map(andar)
    : objeto(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, andar(x)])) : v;
  return { ...(andar(r) as ResultadoDoAceite), publicavel: true, sha256DoCompleto };
}

/** As contas, as máquinas e os repositórios que o arco conhece: o que o publicável troca por rótulos. */
export function sensiveisDoArco(carregado: ManifestoCarregado, arco: string): { contas: string[]; maquinas: string[]; repositorios: string[] } {
  const estado = lerArco(carregado.raiz, arco);
  const conteudo = estado?.conteudo;
  const contas = new Set<string>();
  const maquinas = new Set<string>();
  const repositorios = new Set<string>();
  for (const c of conteudo?.orcamento.porConta ?? []) contas.add(c.conta);
  for (const d of estado?.despachos ?? []) contas.add(d.conta);
  for (const d of conteudo?.destinos ?? []) { repositorios.add(d.repositorio); repositorios.add(d.repositorio.split('/')[0]); }
  try {
    for (const l of eventosDaSupervisao(carregado.raiz, arco)) {
      const e = l.evento as Record<string, unknown>;
      const quem = e.quem as { maquina?: unknown; instancia?: unknown } | undefined;
      if (typeof quem?.maquina === 'string') maquinas.add(quem.maquina);
      if (typeof e.conta === 'string') contas.add(e.conta);
    }
  } catch { /* o log ilegível já é lacuna no aceite */ }
  return { contas: [...contas], maquinas: [...maquinas], repositorios: [...repositorios] };
}

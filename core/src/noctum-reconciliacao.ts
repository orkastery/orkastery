/**
 * RM-058, fatia N4 (D7 a D12, D15 e D16 da ork-rm058n4): a reconciliação do que ficou no meio.
 *
 * Aqui só se DECIDE, com a prova de cada decisão; quem grava é o vigia (`noctum-vigia.ts`), sob as travas dele. Toda
 * decisão relê o disco (o log do arco, a supervisão e o ledger das threads) e a leitura do runtime que o vigia passa:
 *
 * - a reserva pendente de um passo morto no meio (D7): a prova no ledger decide entre concluída (o despacho com a
 *   correlação do arco veio), devolvida (nada foi lançado: nenhum prompt gravado com a correlação depois da reserva) e
 *   incerta (o runtime pode ter aberto a sessão); a incerta só se resolve pelo runtime e, sem prova, fica contada e o
 *   trabalho é isolado depois da carência;
 * - a sessão sem resultado (D10 a D12): morta pelo runtime, ou parada pelo controle dele com confirmação, vira
 *   `sessao_morta` no ledger da thread (o que solta condução e vaga) e uma retomada autorizada, que o passo da N2 despacha
 *   com a conferência do envelope e a reserva (D8); a fase é a seguinte à prova mais adiantada que a sessão deixou (D9);
 * - o despacho de fora do arco numa thread dele isola o trabalho (D16), e a recusa de ambiente repetida para o arco (D15).
 *
 * "Pouca saída, sozinha, não prova travamento": só evento de produto conta como avanço, heartbeat não; e parar uma sessão
 * exige o prazo vencido, o runtime dizendo o estado e a confirmação depois.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { lerLedger } from './ledger';
import { ManifestoCarregado } from './manifest';
import { DespachoDoArco, EstadoDoArco } from './noctum-arco';
import { LeituraDeSessoes } from './noctum-capacidade';
import { ConteudoV2, correlacaoDoArco, DesfechoDoEfeito, EfeitoIncerto, EstadoDaSupervisao, EventoDaSupervisao, gravarNaSupervisao,
  lerSupervisao, MotivoDaRetomada, ParametrosDaSupervisao, RecusaDaSupervisao, retomadasDe, threadsDoArco } from './noctum-supervisao';
import { esperaDoCondutor, pendenciaDoDono } from './parado-no-condutor';
import { lerFilaDeRetomada, PedidoComPerfil } from './ratelimit';
import { SessaoDaConta } from './sessoes-contas';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, Fase, Thread } from './types';
import { exec } from './util';

const TERMINAIS = ['done', 'completed', 'exited', 'stopped', 'failed'];
/** O runtime mostra a sessão trabalhando agora (o claude-bg diz `running` ou `busy`; o watcher, `working`). */
const TRABALHANDO = ['running', 'busy', 'working'];
const estadoDe = (s: SessaoDaConta): string => String(s.state ?? s.status ?? '').trim().toLowerCase();
const texto = (v: unknown): string | null => typeof v === 'string' && v ? v : null;

/** O que o runtime prova sobre uma sessão: viva (com o estado), morta (com a prova) ou desconhecida (lacuna). */
export type ProvaDaSessao = { estado: 'viva'; trabalhando: boolean; detalhe: string } | { estado: 'morta' | 'desconhecida'; detalhe: string };

/**
 * D10: a prova do runtime. Vista com estado terminal ou fantasma (sem processo), morta; vista em outro estado, viva.
 * Ausente, só o claude-bg prova a morte, e só com todas as fontes lidas e a conta da sessão entre as consultadas (a
 * listagem com `--all` traz as paradas); o codex lista só rollouts recentes, e ausência lá não prova nada.
 */
export function provaDaSessao(leitura: LeituraDeSessoes, sessionId: string, conta: string | null, runtime: string): ProvaDaSessao {
  const vista = leitura.sessoes.find(s => s.sessionId === sessionId);
  if (vista) {
    if (vista.fantasma) return { estado: 'morta', detalhe: `o runtime ${runtime} lista a sessão sem processo (fantasma)` };
    const estado = estadoDe(vista);
    if (TERMINAIS.includes(estado)) return { estado: 'morta', detalhe: `o runtime ${runtime} lista a sessão em ${estado}` };
    return { estado: 'viva', trabalhando: TRABALHANDO.includes(estado), detalhe: `o runtime ${runtime} lista a sessão em ${estado || 'estado sem nome'}` };
  }
  const completa = leitura.fontes.every(f => f.ok);
  const consultada = leitura.contas.some(c => c.runtime === runtime && (c.perfil?.id ?? null) === conta);
  if (runtime === 'claude-bg' && completa && consultada) {
    return { estado: 'morta', detalhe: `a listagem completa do claude-bg na conta ${conta ?? 'do processo'} não tem a sessão` };
  }
  return { estado: 'desconhecida', detalhe: !completa ? 'o runtime não respondeu em todas as contas' : runtime !== 'claude-bg'
    ? `ausência no ${runtime} não prova o fim da sessão` : `a conta ${conta ?? 'do processo'} não foi consultada` };
}

/** As sessões da thread no runtime: pela pasta da worktree ou pelo nome do despacho (o slug). */
function sessoesDaThread(leitura: LeituraDeSessoes, t: Thread, slug: string | null): SessaoDaConta[] {
  const pasta = t.worktree ? path.resolve(t.worktree) : null;
  return leitura.sessoes.filter(s => (pasta && s.cwd && path.resolve(s.cwd) === pasta) || (slug && s.name === slug));
}

const depoisDe = (e: EventoLedger, desde: number): boolean => Date.parse(e.ts) >= desde;
const perfilDe = (e: EventoLedger | undefined): string | null => {
  const p = e?.perfil as unknown;
  if (typeof p === 'string') return p;
  return p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string' ? (p as { id: string }).id : null;
};

// ---------------------------------------------------------------------------
// D9: a fase da retomada.
// ---------------------------------------------------------------------------

/** O artefato de cada fase que tem um, na pasta `docs/` da thread (a mesma regra da Sentinela). */
const ARTEFATO_DA_FASE: Partial<Record<Fase, string>> = { GOAL: 'goal.md', PLAN: 'plan.md', CHECK: 'check.md' };
const FASES_DA_ENTREGA: readonly Fase[] = ['SHIP', 'MASTER'];
/** Eventos de produto: o que só uma sessão que trabalha deixa. Heartbeat não é avanço. */
const EVENTOS_DE_AVANCO = ['mcp_git_committed', 'commit', 'claim_added', 'verify_run', 'baseline_recorded', 'autonomous_decision',
  'phase_result', 'hitl_requested', 'ship_started', 'ship_done', 'ship_blocked', 'go_fix_opened', 'check_reverify', 'artifact_delivered'];

/**
 * A fase da retomada (D9): a seguinte à prova mais adiantada que a sessão deixou depois do despacho (o artefato da fase
 * gravado depois dele, ou o `ship_done`), ou a própria fase do despacho sem prova. Diferente da Sentinela, que lê um turno
 * concluído, aqui o turno não concluiu: produto na branch prova o PLAN (o GO começou), mas não prova o GO; só o
 * `check.md` depois dele prova. `null` quando a seguinte é SHIP ou MASTER: a entrega é da N5, e o arco não a retoma.
 */
export function faseDaRetomada(raiz: string, t: Thread, eventos: readonly EventoLedger[], fase: Fase, despachoEm: string): Fase | null {
  const desde = Date.parse(despachoEm);
  const i = t.fases.indexOf(fase);
  if (i < 0) return null;
  const comProduto = eventos.some(e => (e.tipo === 'mcp_git_committed' || e.tipo === 'commit') && depoisDe(e, desde));
  const feita = (f: Fase): boolean => {
    const artefato = ARTEFATO_DA_FASE[f];
    if (artefato) {
      const st = fs.statSync(path.join(dirThread(raiz, t.id), 'docs', artefato), { throwIfNoEntry: false });
      if (st && st.mtimeMs >= desde) return true;
    }
    if (f === 'PLAN' && comProduto) return true;
    return f === 'SHIP' && eventos.some(e => e.tipo === 'ship_done' && depoisDe(e, desde));
  };
  let maisAdiantada = -1;
  for (let k = i; k < t.fases.length; k++) if (feita(t.fases[k])) maisAdiantada = k;
  const proxima = maisAdiantada >= 0 ? t.fases[maisAdiantada + 1] ?? null : fase;
  return proxima && !FASES_DA_ENTREGA.includes(proxima) ? proxima : null;
}

// ---------------------------------------------------------------------------
// D7: a reserva pendente de um passo morto no meio.
// ---------------------------------------------------------------------------

export interface DecisaoDaReserva {
  seq: number;
  trabalho: string;
  thread: string | null;
  /** `concluir` com a sessão; `devolver` à conta do orçamento; `aguardar` a prova; `isolar` o trabalho com a reserva contada. */
  acao: 'concluir' | 'devolver' | 'aguardar' | 'isolar';
  sessionId: string | null;
  idempotente: boolean;
  /** O motivo que vai ao `concluirDespacho` quando a sessão volta ao orçamento. */
  motivo: string | null;
  /** A sessão que o runtime provou morta: vai ao ledger da thread como `sessao_morta`, e a fase dela para a retomada. */
  morta: { sessionId: string; fase: Fase; runtime: string; perfil: string | null } | null;
  /** O trabalho isolado: a sessão do runtime fora do registro do núcleo, ou a prova que não veio. */
  isolamento: { motivo: 'reserva-incerta' | 'sessao-fora-do-registro'; detalhe: string } | null;
  prova: string;
}

/**
 * D7: o que fazer com cada reserva pendente. Só vale com a trava de despacho na mão de quem chama (nenhum passo no meio).
 * Os eventos que contam são os da thread depois da reserva e antes da reserva seguinte do mesmo trabalho.
 */
export function decidirReservas(raiz: string, arco: string, conteudo: ConteudoV2, estado: EstadoDoArco, leitura: LeituraDeSessoes,
  parametros: ParametrosDaSupervisao, quando: string): DecisaoDaReserva[] {
  const correlacao = correlacaoDoArco(arco);
  const threads = threadsDoArco(raiz, conteudo, estado);
  let ilegivel = false;
  for (const id of listarIds(raiz)) { try { lerThread(raiz, id); } catch { ilegivel = true; break; } }
  const decisoes: DecisaoDaReserva[] = [];
  for (const d of estado.despachos.filter(x => x.desfecho === 'pendente')) {
    const base = { seq: d.seq, trabalho: d.trabalho, sessionId: null, idempotente: false, motivo: null, morta: null, isolamento: null };
    const desde = Date.parse(d.reservadoEm);
    const vencida = Date.parse(quando) - desde >= parametros.carenciaDaReservaMs;
    const thread = d.thread ?? threads.get(d.trabalho) ?? null;
    if (!thread) {
      // Sem thread do trabalho de pedido: o passo morreu antes de abrir. Com thread ilegível no projeto, ela pode ser a dele.
      decisoes.push(ilegivel
        ? { ...base, thread: null, acao: 'aguardar', prova: 'há thread ilegível no projeto, e ela pode ser a do trabalho: sem prova de que nada foi lançado' }
        : { ...base, thread: null, acao: 'devolver', motivo: 'noctum.reconciliacao.sem-lancamento: nenhuma thread do trabalho existe depois da reserva',
          prova: 'nenhuma thread casa com o item e o sha256 do pedido' });
      continue;
    }
    let eventos: EventoLedger[], t: Thread;
    try { t = lerThread(raiz, thread); eventos = lerLedger(dirThread(raiz, thread)); }
    catch { decisoes.push({ ...base, thread, acao: 'aguardar', prova: `a thread ${thread} não pôde ser lida` }); continue; }
    // A janela desta reserva: até a reserva seguinte do mesmo trabalho, se houver.
    const proxima = estado.despachos.filter(x => x.trabalho === d.trabalho && x.seq > d.seq).map(x => Date.parse(x.reservadoEm))[0] ?? Infinity;
    const janela = eventos.filter(e => depoisDe(e, desde) && Date.parse(e.ts) < proxima);
    const doArco = (e: EventoLedger) => e.correlacao === correlacao && e.fase === d.fase;
    const despacho = janela.find(e => e.tipo === 'phase_dispatch' && doArco(e));
    if (despacho) {
      decisoes.push({ ...base, thread, acao: 'concluir', sessionId: texto(despacho.sessionId),
        prova: `${thread}: phase_dispatch ${String(despacho.eventId ?? '')} com a correlação do arco depois da reserva` });
      continue;
    }
    const idempotente = janela.find(e => e.tipo === 'despacho_idempotente' && e.fase === d.fase);
    if (idempotente) {
      decisoes.push({ ...base, thread, acao: 'concluir', sessionId: texto(idempotente.sessionId), idempotente: true,
        prova: `${thread}: despacho_idempotente ${String(idempotente.eventId ?? '')} depois da reserva` });
      continue;
    }
    const prompt = janela.find(e => e.tipo === 'phase_prompt_recorded' && doArco(e));
    const falha = janela.filter(e => e.tipo === 'phase_dispatch_failed' && doArco(e)).at(-1);
    if (!prompt && !falha) {
      // O prompt vai ao disco e ao ledger antes do adaptador (RM-063, F3): sem ele, o runtime não foi chamado.
      decisoes.push({ ...base, thread, acao: 'devolver',
        motivo: 'noctum.reconciliacao.sem-lancamento: nenhum phase_prompt_recorded do arco depois da reserva',
        prova: `${thread}: nenhum prompt gravado com a correlação do arco depois da reserva` });
      continue;
    }
    const conta = perfilDe(falha) ?? perfilDe(prompt) ?? d.conta;
    const runtime = texto(falha?.runtime) ?? texto(prompt?.runtime) ?? d.runtime;
    const idDaFalha = texto(falha?.sessionId);
    if (idDaFalha) {
      const p = provaDaSessao(leitura, idDaFalha, conta, runtime);
      if (p.estado === 'viva') {
        decisoes.push({ ...base, thread, acao: 'concluir', sessionId: idDaFalha, prova: `a sessão ${idDaFalha} dita na falha está viva: ${p.detalhe}` });
      } else if (p.estado === 'morta') {
        decisoes.push({ ...base, thread, acao: 'concluir', sessionId: idDaFalha, morta: { sessionId: idDaFalha, fase: d.fase, runtime, perfil: conta },
          prova: `a sessão ${idDaFalha} dita na falha acabou: ${p.detalhe}` });
      } else {
        decisoes.push({ ...base, thread, acao: vencida ? 'isolar' : 'aguardar',
          isolamento: vencida ? { motivo: 'reserva-incerta', detalhe: `a sessão ${idDaFalha} pode estar aberta e o runtime não prova: ${p.detalhe}` } : null,
          prova: `sessão ${idDaFalha} sem prova do runtime: ${p.detalhe}` });
      }
      continue;
    }
    // Prompt gravado sem despacho nem id: o runtime pode ter aberto a sessão sem que o núcleo soubesse dela.
    const achadas = sessoesDaThread(leitura, t, texto(prompt?.slug) ?? texto(falha?.slug));
    const viva = achadas.find(s => !s.fantasma && !TERMINAIS.includes(estadoDe(s)));
    if (viva) {
      decisoes.push({ ...base, thread, acao: 'concluir', sessionId: viva.sessionId,
        isolamento: { motivo: 'sessao-fora-do-registro', detalhe: `a sessão ${viva.sessionId} trabalha na thread sem o registro do núcleo; o arco não despacha por cima` },
        prova: `o runtime lista a sessão ${viva.sessionId} na thread ${thread} (${estadoDe(viva) || 'estado sem nome'})` });
      continue;
    }
    if (achadas.length) {
      const morta = achadas[0];
      decisoes.push({ ...base, thread, acao: 'concluir', sessionId: morta.sessionId,
        morta: { sessionId: morta.sessionId, fase: d.fase, runtime, perfil: conta }, prova: `a sessão ${morta.sessionId} da thread acabou no runtime` });
      continue;
    }
    const completa = leitura.fontes.every(f => f.ok) && leitura.contas.some(c => c.runtime === runtime && (c.perfil?.id ?? null) === conta);
    if (runtime === 'claude-bg' && completa && vencida) {
      decisoes.push({ ...base, thread, acao: 'devolver',
        motivo: 'noctum.reconciliacao.sem-sessao: a listagem completa do claude-bg não tem sessão da thread depois da carência',
        prova: `nenhuma sessão da thread ${thread} na conta ${conta} depois de ${Math.round(parametros.carenciaDaReservaMs / 60000)} min` });
      continue;
    }
    decisoes.push({ ...base, thread, acao: vencida ? 'isolar' : 'aguardar',
      isolamento: vencida ? { motivo: 'reserva-incerta', detalhe: 'o lançamento ficou incerto e o runtime não prova nada: a reserva segue contada' } : null,
      prova: completa ? 'ainda na carência da reserva' : 'o runtime não prova a ausência da sessão (fonte sem leitura, conta não consultada ou codex)' });
  }
  return decisoes;
}

// ---------------------------------------------------------------------------
// D10 a D12 e D16: as sessões das threads do arco.
// ---------------------------------------------------------------------------

/** Um pedido de parada ao runtime: quem e por quê. */
export interface ParadaDeSessao { sessionId: string; runtime: string; perfil: string | null; thread: string }

/** O que o vigia faz numa thread do arco, com a prova. */
export type DecisaoDeSessao =
  | { acao: 'retomar'; trabalho: string; thread: string; fase: Fase; tentativa: number; motivo: MotivoDaRetomada; sessao: string | null;
    /** A sessão a encerrar antes (pelo controle do runtime, com confirmação), quando ela ainda está viva e parada. */
    parar: ParadaDeSessao | null;
    /** A sessão que o runtime provou morta, a registrar como `sessao_morta`. */
    morta: { sessionId: string; fase: Fase; runtime: string; perfil: string | null } | null; prova: string }
  | { acao: 'isolar'; trabalho: string; thread: string; motivo: 'retomadas-esgotadas' | 'sem-primeiro-turno' | 'sessao-presa' | 'condutor-externo';
    parar: ParadaDeSessao | null; detalhe: string }
  | { acao: 'aguardar'; trabalho: string; thread: string; detalhe: string };

/** Atividade da própria sessão depois do despacho: o que mostra que o turno começou. */
const ATIVIDADE = ['runtime_event', 'runtime_heartbeat', 'commit', 'runtime_stop', 'runtime_subagent_stop', 'sessao_destravada', 'phase_result'];

/** O último instante de avanço da thread desde o despacho: evento de produto no ledger ou artefato de fase gravado. */
function ultimoAvanco(raiz: string, thread: string, eventos: readonly EventoLedger[], desde: number): number {
  let ultimo = desde;
  for (const e of eventos) if (EVENTOS_DE_AVANCO.includes(e.tipo) && Date.parse(e.ts) > ultimo) ultimo = Date.parse(e.ts);
  for (const arquivo of Object.values(ARTEFATO_DA_FASE)) {
    const st = fs.statSync(path.join(dirThread(raiz, thread), 'docs', arquivo!), { throwIfNoEntry: false });
    if (st && st.mtimeMs > ultimo) ultimo = st.mtimeMs;
  }
  return ultimo;
}

/**
 * D10 a D12 e D16: o que fazer em cada thread do arco. Despacho de fora isola; sessão morta sem resultado, fim de turno
 * sem resultado depois da carência, sessão sem avanço e sessão sem primeiro turno viram retomada (com a parada pelo
 * runtime antes, quando a sessão está viva), até o teto; no teto, isolamento. Trabalho isolado, entregue, fechado,
 * esperando o dono ou com reserva pendente fica de fora. A retomada já autorizada e ainda não atendida não se repete.
 */
export function decidirSessoes(raiz: string, arco: string, conteudo: ConteudoV2, estado: EstadoDoArco, sup: EstadoDaSupervisao,
  leitura: LeituraDeSessoes, quando: string): DecisaoDeSessao[] {
  const parametros = sup.parametros;
  if (!parametros) return [];
  const agora = Date.parse(quando);
  const correlacao = correlacaoDoArco(arco);
  const autorizadoEm = Date.parse(estado.autorizadoPor?.recebidoEm ?? conteudo.janela.inicio);
  const pendentes = new Set(estado.despachos.filter((d: DespachoDoArco) => d.desfecho === 'pendente').map(d => d.trabalho));
  const decisoes: DecisaoDeSessao[] = [];
  for (const [trabalho, thread] of threadsDoArco(raiz, conteudo, estado)) {
    if (sup.isolados.has(trabalho) || pendentes.has(trabalho)) continue;
    let t: Thread, eventos: EventoLedger[];
    try { t = lerThread(raiz, thread); eventos = lerLedger(dirThread(raiz, thread)); } catch { continue; }
    if (t.status === 'fechada' || eventos.some(e => e.tipo === 'ship_done')) continue;
    // D16: um despacho de fora do arco, depois da autorização, isola o trabalho.
    const deFora = eventos.find(e => e.tipo === 'phase_dispatch' && Date.parse(e.ts) >= autorizadoEm && e.correlacao !== correlacao);
    if (deFora) {
      decisoes.push({ acao: 'isolar', trabalho, thread, motivo: 'condutor-externo', parar: null,
        detalhe: `a thread ${thread} recebeu despacho de fora do arco (${String(deFora.fase)}, canal ${String(deFora.canal ?? 'desconhecido')}, ` +
          `origem ${String(deFora.origem ?? 'desconhecida')}): o arco não conduz junto com outro condutor` });
      continue;
    }
    if (pendenciaDoDono(t, eventos, quando)) continue;
    const despachos = eventos.filter(e => e.tipo === 'phase_dispatch' && e.correlacao === correlacao);
    const d = despachos.at(-1);
    // A retomada já autorizada depois do último despacho espera o passo da N2 atendê-la.
    const ultimoDespachoEm = Math.max(...eventos.filter(e => e.tipo === 'phase_dispatch').map(e => Date.parse(e.ts)), -Infinity);
    if (sup.retomadas.some(r => r.trabalho === trabalho && Date.parse(r.em) > ultimoDespachoEm)) continue;
    const retomar = (fase: Fase | null, motivo: MotivoDaRetomada, sessao: { sessionId: string; runtime: string; perfil: string | null } | null,
      prova: string, viva: boolean): DecisaoDeSessao => {
      const parar = sessao && viva ? { ...sessao, thread } : null;
      const morta = sessao && !viva ? { sessionId: sessao.sessionId, fase: (fase ?? 'GOAL'), runtime: sessao.runtime, perfil: sessao.perfil } : null;
      if (!fase) return { acao: 'aguardar', trabalho, thread, detalhe: `${prova}; a fase seguinte é da entrega (N5)` };
      const feitas = retomadasDe(sup, trabalho, fase);
      const semTurno = motivo === 'sem-primeiro-turno'
        ? sup.retomadas.filter(r => r.trabalho === trabalho && r.motivo === 'sem-primeiro-turno').length : 0;
      if (motivo === 'sem-primeiro-turno' && semTurno >= parametros.retomadasSemPrimeiroTurno) {
        return { acao: 'isolar', trabalho, thread, motivo: 'sem-primeiro-turno', parar,
          detalhe: `${prova}; a sessão não começou o turno ${semTurno + 1} vez(es): a causa costuma ser de ambiente (diálogo de servidor MCP novo, ` +
            'credencial) e o dono resolve' };
      }
      if (feitas >= parametros.tetoDeRetomadas) {
        return { acao: 'isolar', trabalho, thread, motivo: 'retomadas-esgotadas', parar,
          detalhe: `${prova}; ${feitas} retomada(s) da fase ${fase} já autorizadas, e o teto é ${parametros.tetoDeRetomadas}` };
      }
      return { acao: 'retomar', trabalho, thread, fase, tentativa: feitas + 1, motivo, sessao: sessao?.sessionId ?? null, parar, morta, prova };
    };
    if (!d) {
      // Nunca despachada pelo arco: a falha que disse o id (o `claude --bg` que diz o id e sai com erro) e a sessão dela.
      const falha = eventos.filter(e => e.tipo === 'phase_dispatch_failed' && e.correlacao === correlacao && texto(e.sessionId)).at(-1);
      if (!falha || eventos.some(e => e.tipo === 'phase_dispatch')) continue;
      const sid = texto(falha.sessionId)!, runtime = texto(falha.runtime) ?? 'claude-bg', conta = perfilDe(falha);
      const p = provaDaSessao(leitura, sid, conta, runtime);
      if (p.estado !== 'morta') continue;
      const fase = (texto(falha.fase) ?? t.faseAtual) as Fase;
      decisoes.push(retomar(faseDaRetomada(raiz, t, eventos, fase, falha.ts), 'despacho-falho', { sessionId: sid, runtime, perfil: conta },
        `a sessão ${sid} dita na falha do despacho acabou: ${p.detalhe}`, false));
      continue;
    }
    const sid = texto(d.sessionId);
    const runtime = texto(d.runtime) ?? 'claude-bg', conta = perfilDe(d), fase = (texto(d.fase) ?? t.faseAtual) as Fase;
    if (!sid) continue;
    const desde = Date.parse(d.ts);
    const fim = eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === sid && Date.parse(e.ts) >= desde);
    const espera = esperaDoCondutor(t, eventos, quando);
    const p = provaDaSessao(leitura, sid, conta, runtime);
    const sessao = { sessionId: sid, runtime, perfil: conta };
    if (fim || p.estado === 'morta') {
      // Sessão morta sem resultado (D10): o resultado de fase concluída ou a espera do dono não chegam aqui.
      if (espera?.tipo === 'concluida' || eventos.some(e => e.tipo === 'phase_result' && e.sessionId === sid && Date.parse(e.ts) >= desde)) continue;
      decisoes.push(retomar(faseDaRetomada(raiz, t, eventos, fase, d.ts), 'sessao-morta', fim ? null : sessao,
        fim ? `a sessão ${sid} já tem sessao_morta no ledger` : `a sessão ${sid} acabou sem resultado: ${p.detalhe}`, false));
      continue;
    }
    if (p.estado === 'desconhecida') {
      decisoes.push({ acao: 'aguardar', trabalho, thread, detalhe: `a sessão ${sid} sem prova do runtime: ${p.detalhe}` });
      continue;
    }
    const trabalhando = p.estado === 'viva' && p.trabalhando;
    if (trabalhando && espera?.tipo !== 'stop-sem-resultado') {
      // D12: a sessão que trabalha só é presa sem avanço nenhum além do prazo, ou sem nenhuma atividade desde o despacho.
      const ativa = eventos.some(e => Date.parse(e.ts) > desde && ((ATIVIDADE.includes(e.tipo) && e.sessionId === sid) || EVENTOS_DE_AVANCO.includes(e.tipo)));
      if (!ativa && agora - desde >= parametros.primeiroTurnoMs) {
        decisoes.push(retomar(fase, 'sem-primeiro-turno', sessao,
          `a sessão ${sid} não deu sinal nenhum em ${Math.round((agora - desde) / 60000)} min depois do despacho`, true));
        continue;
      }
      const parado = agora - ultimoAvanco(raiz, thread, eventos, desde);
      if (ativa && parado >= parametros.semAvancoMs) {
        decisoes.push(retomar(faseDaRetomada(raiz, t, eventos, fase, d.ts), 'sem-avanco', sessao,
          `a sessão ${sid} trabalha sem evento de produto há ${Math.round(parado / 60000)} min (prazo ${Math.round(parametros.semAvancoMs / 60000)} min)`, true));
      }
      continue;
    }
    // D11: o fim de turno sem resultado, depois da carência, com a sessão parada no runtime.
    if (espera?.tipo === 'stop-sem-resultado' && agora - Date.parse(espera.fimDoTurnoEm) >= parametros.carenciaMs && !trabalhando) {
      decisoes.push(retomar(faseDaRetomada(raiz, t, eventos, fase, d.ts), 'fim-de-turno-sem-resultado', sessao,
        `o turno da sessão ${sid} acabou sem resultado em ${espera.fimDoTurnoEm} e ela não trabalha: ${p.detalhe}`, true));
    }
  }
  return decisoes;
}

/** As linhas da supervisão de uma decisão de sessão, depois que a parada (quando havia) foi confirmada. */
export function eventosDaDecisao(d: Extract<DecisaoDeSessao, { acao: 'retomar' }>, provaDaParada: string | null): EventoDaSupervisao[] {
  const linhas: EventoDaSupervisao[] = [];
  if (d.parar) {
    linhas.push({ tipo: 'sessao_parada', trabalho: d.trabalho, thread: d.thread, sessionId: d.parar.sessionId, motivo: d.motivo, confirmada: true,
      prova: provaDaParada ?? d.prova });
  }
  linhas.push({ tipo: 'retomada_autorizada', trabalho: d.trabalho, thread: d.thread, fase: d.fase, tentativa: d.tentativa, motivo: d.motivo,
    sessao: d.sessao, prova: d.prova });
  return linhas;
}

/** D15: as recusas de ambiente seguidas desde o último despacho concluído do arco, e se elas param o arco. */
export function paradaPorAmbiente(sup: EstadoDaSupervisao, estado: EstadoDoArco): { motivo: 'ambiente-do-despacho'; detalhe: string } | null {
  const parametros = sup.parametros;
  if (!parametros) return null;
  const ultimo = Math.max(...estado.despachos.filter(d => d.desfecho === 'concluido' && d.concluidoEm).map(d => Date.parse(d.concluidoEm!)), -Infinity);
  const seguidas = sup.recusasDeAmbiente.filter(r => Date.parse(r.em) > ultimo);
  if (seguidas.length < parametros.recusasDeAmbienteQueParam) return null;
  return { motivo: 'ambiente-do-despacho', detalhe: `${seguidas.length} despachos seguidos recusados pelo ambiente de quem despacha ` +
    `(${seguidas.at(-1)!.detalhe.slice(0, 160)}): o dono confere o ambiente (o node no PATH, a instalação do MCP) antes de outro arco` };
}

/** A recusa do núcleo que vem do ambiente de quem despacha, e não do trabalho (o MCP divergente com outro `node` no PATH). */
export function recusaDeAmbiente(detalhe: string): boolean {
  return /runtime\.context\.conflict/.test(detalhe);
}

// ---------------------------------------------------------------------------
// D17: o pedido da fila durável do despacho do arco que caiu no limite de uso.
// ---------------------------------------------------------------------------

export type DecisaoDePedido =
  | { acao: 'retomar'; pedido: string; trabalho: string; thread: string; fase: Fase; tentativa: number; prova: string }
  | { acao: 'cancelar'; pedido: string; thread: string; motivo: string };

/**
 * D17: o que fazer com cada pedido aguardando na fila durável que é do arco (a correlação dele). Com o arco encerrado, o
 * pedido sai da fila com o motivo (retomar exige o dono); com um despacho do arco na thread depois do pedido, ele sai
 * como retomado; senão, a retomada da fase é autorizada uma vez, e o passo do arco a despacha quando houver conta do
 * envelope (a conta do limite de uso fica fora até o `liberaEm`, D13). O `ork retry resume` nunca redespacha esse pedido.
 */
export function decidirPedidos(raiz: string, arco: string, conteudo: ConteudoV2, estado: EstadoDoArco, sup: EstadoDaSupervisao): DecisaoDePedido[] {
  const correlacao = correlacaoDoArco(arco);
  const porThread = new Map([...threadsDoArco(raiz, conteudo, estado)].map(([trabalho, thread]) => [thread, trabalho] as const));
  const ultimos = new Map<string, PedidoComPerfil>();
  for (const p of lerFilaDeRetomada(raiz)) ultimos.set(p.id, p as PedidoComPerfil);
  const encerrado = estado.situacao === 'revogado' || estado.situacao === 'expirado';
  const decisoes: DecisaoDePedido[] = [];
  for (const p of ultimos.values()) {
    if (p.estado !== 'aguardando' || p.correlacao !== correlacao) continue;
    if (encerrado) {
      decisoes.push({ acao: 'cancelar', pedido: p.id, thread: p.thread,
        motivo: `o arco ${arco} terminou (${estado.situacao}): retomar a fase ${p.fase} da thread ${p.thread} exige o dono` });
      continue;
    }
    let eventos: EventoLedger[];
    try { eventos = lerLedger(dirThread(raiz, p.thread)); } catch { continue; }
    const retomado = eventos.find(e => e.tipo === 'phase_dispatch' && e.correlacao === correlacao && Date.parse(e.ts) > Date.parse(p.criadoEm));
    if (retomado) {
      decisoes.push({ acao: 'cancelar', pedido: p.id, thread: p.thread,
        motivo: `retomado pelo arco ${arco} no despacho ${String(retomado.eventId ?? retomado.ts)} (${String(retomado.fase)})` });
      continue;
    }
    const trabalho = porThread.get(p.thread);
    if (!trabalho || sup.pedidos.has(p.id)) continue;
    decisoes.push({ acao: 'retomar', pedido: p.id, trabalho, thread: p.thread, fase: p.fase, tentativa: retomadasDe(sup, trabalho, p.fase) + 1,
      prova: `pedido ${p.id} da fila durável (libera em ${p.liberaEm}${p.janelaEstimada ? ', janela estimada' : ', hora dita pelo runtime'})` });
  }
  return decisoes;
}

// ---------------------------------------------------------------------------
// D18: o efeito externo de resultado incerto (o push).
// ---------------------------------------------------------------------------

/** A leitura do remoto: o sha da branch, `null` sem a branch, ou a falta de leitura. */
export type LeituraDoRemoto = { ok: true; sha: string | null } | { ok: false; detalhe: string };
export type LeitorDoRemoto = (remoto: string, branch: string, cwd: string) => LeituraDoRemoto;

/** O `git ls-remote` da branch exata, com prazo e sem pedir credencial no terminal. */
export const lerRemotoPadrao: LeitorDoRemoto = (remoto, branch, cwd) => {
  const r = exec('git', ['ls-remote', '--heads', remoto, `refs/heads/${branch}`], cwd, 30_000, { ...process.env, GIT_TERMINAL_PROMPT: '0' });
  if (!r.ok) return { ok: false, detalhe: `git ls-remote saiu ${r.code}: ${(r.stderr.trim().split('\n')[0] ?? '').slice(0, 160)}` };
  const linha = r.stdout.split('\n').find(l => l.endsWith(`\trefs/heads/${branch}`));
  const sha = linha?.split('\t')[0] ?? null;
  return { ok: true, sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null };
};

export interface ReconciliacaoDoEfeito {
  id: string;
  desfecho: DesfechoDoEfeito;
  /** Quem chama pode repetir o efeito, conferindo o envelope de novo antes (`conferirAntesDoEfeito`); nunca às cegas. */
  podeRepetir: boolean;
  /** O trabalho foi isolado: remoto divergente, sem leitura no teto ou tentativas esgotadas. */
  isolado: boolean;
  prova: string;
}

const chaveDoEfeito = (e: EfeitoIncerto): string => JSON.stringify([e.acao, e.repositorio, e.remoto, e.branch, e.sha, e.trabalho]);

/** D18: registra o efeito de resultado incerto (o push que estourou o prazo ou caiu sem resposta) e devolve o id dele. */
export function registrarEfeitoIncerto(carregado: ManifestoCarregado, arco: string, efeito: EfeitoIncerto, quando = new Date().toISOString()): string {
  if (!/^[0-9a-f]{40}$/.test(efeito.sha) || !efeito.branch || !efeito.remoto) {
    throw new RecusaDaSupervisao('noctum.supervisao.invalida', 'efeito incerto exige o sha completo, a branch e o remoto');
  }
  const id = 'E-' + createHash('sha256').update(JSON.stringify([arco, chaveDoEfeito(efeito), quando])).digest('hex').slice(0, 12);
  gravarNaSupervisao(carregado, arco, [{ tipo: 'efeito_incerto', id, efeito: { ...efeito, detalhe: efeito.detalhe.slice(0, 200) } }], quando);
  return id;
}

/**
 * D18: o remoto decide o efeito incerto, e o desfecho vai ao log. Igual ao sha: confirmado, e nunca se repete. Branch
 * ausente: a repetição é permitida enquanto os efeitos do mesmo push não passam do teto, e quem repete confere o envelope
 * de novo; no teto, o trabalho é isolado. Outro sha na branch: divergente, isolado (alguém escreveu ali). Sem leitura:
 * lacuna, lida de novo no tique seguinte, e isolada no teto. Desfecho final não é relido.
 */
export function reconciliarEfeito(carregado: ManifestoCarregado, arco: string, id: string,
  opcoes: { lerRemoto?: LeitorDoRemoto; cwd?: string; quando?: string } = {}): ReconciliacaoDoEfeito {
  const quando = opcoes.quando ?? new Date().toISOString();
  const sup = lerSupervisao(carregado.raiz, arco);
  const ef = sup.efeitos.get(id);
  if (!ef) throw new RecusaDaSupervisao('noctum.supervisao.invalida', `efeito ${id} sem registro neste arco`);
  const teto = sup.parametros?.leiturasDoEfeito ?? 2;
  const ultimo = ef.desfechos.at(-1);
  if (ultimo && ultimo.desfecho !== 'sem-leitura') {
    return { id, desfecho: ultimo.desfecho, podeRepetir: false, isolado: sup.isolados.has(ef.efeito.trabalho), prova: ultimo.prova };
  }
  const r = (opcoes.lerRemoto ?? lerRemotoPadrao)(ef.efeito.remoto, ef.efeito.branch, opcoes.cwd ?? carregado.raiz);
  const desfecho: DesfechoDoEfeito = !r.ok ? 'sem-leitura' : r.sha === ef.efeito.sha ? 'confirmado' : r.sha === null ? 'ausente' : 'divergente';
  const prova = !r.ok ? r.detalhe : r.sha === null ? `a branch ${ef.efeito.branch} não existe no remoto ${ef.efeito.remoto}`
    : `o remoto ${ef.efeito.remoto} tem ${r.sha} na branch ${ef.efeito.branch}`;
  // As tentativas do mesmo push (a mesma chave) contam juntas: um efeito novo não zera o teto.
  const mesmas = [...sup.efeitos.values()].filter(x => chaveDoEfeito(x.efeito) === chaveDoEfeito(ef.efeito)).length;
  const leituras = ef.desfechos.filter(d => d.desfecho === 'sem-leitura').length + 1;
  const podeRepetir = desfecho === 'ausente' && mesmas < teto;
  const motivo = desfecho === 'divergente' ? 'efeito-divergente' as const : desfecho === 'sem-leitura' && leituras >= teto ? 'efeito-sem-leitura' as const
    : desfecho === 'ausente' && !podeRepetir ? 'efeito-esgotado' as const : null;
  const linhas: EventoDaSupervisao[] = [{ tipo: 'efeito_reconciliado', id, desfecho, prova: prova.slice(0, 300) }];
  if (motivo) linhas.push({ tipo: 'isolado', trabalho: ef.efeito.trabalho, thread: ef.efeito.thread, motivo,
    detalhe: `${ef.efeito.acao} de ${ef.efeito.sha.slice(0, 12)} em ${ef.efeito.branch}: ${prova}`.slice(0, 300) });
  gravarNaSupervisao(carregado, arco, linhas, quando);
  return { id, desfecho, podeRepetir, isolado: motivo !== null || sup.isolados.has(ef.efeito.trabalho), prova };
}

/** Os efeitos incertos ainda sem desfecho final: o vigia os relê a cada tique. */
export function efeitosAbertos(sup: EstadoDaSupervisao): string[] {
  return [...sup.efeitos.values()].filter(e => {
    const ultimo = e.desfechos.at(-1);
    return (!ultimo || ultimo.desfecho === 'sem-leitura') && !sup.isolados.has(e.efeito.trabalho);
  }).map(e => e.id);
}

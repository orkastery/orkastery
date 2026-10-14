/**
 * RM-058, fatia N6 (D4, D5 e D9 da ork-rm058n6): a medição do consumo do arco nas unidades do orçamento.
 *
 * A N2 mediu só `sessoes` (as reservas não recusadas). Aqui entram as outras três, sempre a partir do que o núcleo e o
 * runtime gravaram, nunca de estimativa:
 *
 *  - `minutos-de-sessao`: do `phase_dispatch` da sessão ao primeiro resultado dela no ledger da thread (`phase_result`,
 *    `sessao_morta` ou `session_superseded`), arredondado para cima por sessão. A latência do observador fica dentro:
 *    a medida é sempre a maior. A sessão em voo conta até o instante da leitura e sai marcada como parcial.
 *  - `tokens`: o que o runtime diz ter processado, sem conversão. No Claude Code, o `message.usage` da transcrição da
 *    sessão e dos subagentes, uma vez por `message.id` (a transcrição repete o mesmo uso em cada bloco da resposta):
 *    entrada, criação de cache, leitura de cache e saída. No codex, o `total_tokens` do último `token_count` do rollout.
 *  - `percentual-da-cota`: só o codex grava a cota fora da sessão (`rate_limits` do rollout). O valor é o `used_percent`
 *    mais alto da janela, que inclui o uso de antes do arco e o de outros projetos na mesma janela: teto superior, nunca
 *    menos que o consumo real. Janela que renovou no meio do arco perde o uso de antes da renovação, e vira lacuna. O
 *    Claude Code só mostra a cota aos mods dentro da sessão: conta claude-bg em percentual é sempre lacuna.
 *
 * Consumo desconhecido nunca é zero: reserva pendente (a sessão pode ter aberto sem id), ledger ilegível, transcrição ou
 * rollout ausente, linha ilegível no meio do arquivo e sessão sem leitura ainda viram lacuna tipada, e a lacuna de uma
 * sessão contamina o escopo inteiro dela. Zero só é medido quando nenhuma sessão do arco caiu no escopo.
 *
 * Nada aqui grava. `fontes` é dependência dos testes; em produção, o ledger, o store de perfis, a transcrição e o rollout.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acharRollout, casaDoCodex } from './adapters/codex';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ConsumoMedidoDoDespacho, EstadoDoArco, ValorMedido } from './noctum-arco';
import { ConteudoDoEnvelope, Unidade, UNIDADES } from './noctum-envelope';
import { lerPerfis, perfilDeDespacho, PerfilDeDespacho } from './runtime-profiles';
import { arquivoDaTranscricao } from './session-watcher-claude';
import { dirThread, lerThread } from './thread';
import { EventoLedger } from './types';

export const CONTRATO_MEDICAO = 'ork.noctum-medicao/v1' as const;

export type UnidadeMedida = Exclude<Unidade, 'sessoes'>;
export const UNIDADES_MEDIDAS: readonly UnidadeMedida[] = ['minutos-de-sessao', 'tokens', 'percentual-da-cota'];

/** Uma medida: o valor com a fonte, ou a lacuna com o motivo. Nunca um número inventado. */
export type Medida = { valor: number; parcial: boolean; tetoSuperior: boolean; fonte: string } | { lacuna: string };

/** Uma leitura da cota do codex: a janela (em minutos), o percentual usado, quando renova e quando foi lida. */
export interface LeituraDeCota { janelaMin: number; usado: number; renovaEm: number | null; lidaEm: string }

export interface MedicaoDeSessao {
  /** O `seq` da reserva no log do arco. */
  seq: number;
  trabalho: string;
  thread: string | null;
  sessionId: string | null;
  runtime: string;
  conta: string;
  inicio: string | null;
  fim: string | null;
  emVoo: boolean;
  minutos: Medida;
  tokens: Medida;
  /** As leituras da cota no rollout (codex), ou a lacuna da cota desta sessão. */
  cota: LeituraDeCota[] | { lacuna: string };
}

export interface ConsumoNaUnidade {
  unidade: Unidade;
  /** `null` é lacuna: o consumo não é conhecido, e quem decide não o trata como zero. */
  valor: number | null;
  lacunas: string[];
  /** Alguma sessão do escopo ainda corre: o valor cresce até ela acabar. */
  parcial: boolean;
  /** O valor inclui uso de fora do arco (a cota do codex): é teto superior do consumo do arco. */
  tetoSuperior: boolean;
  /** Sessões do arco que caíram no escopo. */
  sessoes: number;
}

export type ConsumoPorUnidade = Record<Unidade, ConsumoNaUnidade>;

export interface MedicaoDoArco {
  contrato: typeof CONTRATO_MEDICAO;
  arco: string;
  quando: string;
  sessoes: MedicaoDeSessao[];
  doArco: ConsumoPorUnidade;
  porConta: Record<string, ConsumoPorUnidade>;
  porRuntime: Record<string, ConsumoPorUnidade>;
}

/** As fontes da medição. Em produção, o disco; nos testes, o que eles injetam. */
export interface FontesDeMedicao {
  /** Os eventos do ledger da thread, ou `null` quando ele não se lê. */
  eventos(thread: string): EventoLedger[] | null;
  /** O diretório onde a sessão da thread rodou (a worktree), ou `null`. */
  cwd(thread: string): string | null;
  /** O perfil de despacho da conta; `null` sem o perfil; `undefined` com o store ilegível. */
  perfil(conta: string): PerfilDeDespacho | null | undefined;
  /** A transcrição da sessão e as dos subagentes; `null` sem a principal. */
  transcricoes(perfil: PerfilDeDespacho | null, cwd: string, sessionId: string): string[] | null;
  /** O rollout da sessão do codex; `null` sem ele. */
  rollout(perfil: PerfilDeDespacho | null, sessionId: string): string | null;
  /** O conteúdo de um arquivo, ou `null` quando ele não se lê. */
  ler(arquivo: string): Buffer | null;
}

/** Arquivo de transcrição ou rollout acima disto não é lido inteiro: vira lacuna, nunca leitura parcial. */
export const TETO_DO_ARQUIVO_MEDIDO = 256 * 1024 * 1024;
/** Duas leituras da mesma janela com renovações a menos disto são a mesma janela (o arredondamento do runtime). */
const TOLERANCIA_DA_RENOVACAO_MS = 120_000;

function lerArquivoLimitado(arquivo: string): Buffer | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > TETO_DO_ARQUIVO_MEDIDO) return null;
    return fs.readFileSync(fd);
  } catch { return null; } finally { fs.closeSync(fd); }
}

/** As fontes de produção para a raiz de estado dada. */
export function fontesDoDisco(raiz: string): FontesDeMedicao {
  let perfis: ReturnType<typeof lerPerfis> | null | undefined;
  return {
    eventos: (thread) => { try { return lerLedger(dirThread(raiz, thread)); } catch { return null; } },
    cwd: (thread) => { try { return lerThread(raiz, thread).worktree ?? null; } catch { return null; } },
    perfil: (conta) => {
      if (perfis === undefined) { try { perfis = lerPerfis(raiz); } catch { perfis = null; } }
      if (perfis === null) return undefined;
      const p = perfis.perfis.find(x => x.id === conta);
      return p ? perfilDeDespacho(p) : null;
    },
    transcricoes: (perfil, cwd, sessionId) => {
      const principal = arquivoDaTranscricao(perfil, cwd, sessionId);
      if (!principal) return null;
      try { if (!fs.lstatSync(principal).isFile()) return null; } catch { return null; }
      const dir = path.join(path.dirname(principal), sessionId, 'subagents');
      let subagentes: string[] = [];
      try { subagentes = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().map(f => path.join(dir, f)); } catch { subagentes = []; }
      return [principal, ...subagentes];
    },
    rollout: (perfil, sessionId) => { try { return acharRollout(sessionId, 3, casaDoCodex(perfil)); } catch { return null; } },
    ler: lerArquivoLimitado,
  };
}

/** O primeiro destes eventos da sessão no ledger da thread é o fim dela. */
const FIM_DA_SESSAO: readonly string[] = ['phase_result', 'sessao_morta', 'session_superseded'];

const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** As linhas JSON de um arquivo de acréscimo; a última sem quebra está sendo gravada e fica de fora. */
function linhasJson(bruto: Buffer): { linhas: unknown[]; ilegivel: number } | null {
  const fim = bruto.lastIndexOf(0x0a) + 1;
  const textos = bruto.subarray(0, fim).toString('utf8').split('\n').slice(0, -1);
  const linhas: unknown[] = [];
  let ilegivel = 0;
  for (const t of textos) {
    if (!t.trim()) continue;
    try { linhas.push(JSON.parse(t)); } catch { ilegivel += 1; }
  }
  return { linhas, ilegivel };
}

/**
 * Os tokens das transcrições do Claude Code: um uso por `message.id`, somando entrada, criação de cache, leitura de
 * cache e saída. Linha ilegível no meio (não a cauda em gravação) é lacuna: ela poderia esconder uso.
 */
export function tokensDasTranscricoes(conteudos: Iterable<Buffer>): Medida {
  const vistos = new Set<string>();
  let total = 0;
  for (const bruto of conteudos) {
    const lido = linhasJson(bruto);
    if (!lido) return { lacuna: 'transcrição ilegível' };
    if (lido.ilegivel) return { lacuna: `transcrição com ${lido.ilegivel} linha(s) ilegível(is) no meio` };
    for (const l of lido.linhas) {
      const e = l as { type?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> }; uuid?: unknown };
      if (e?.type !== 'assistant' || !e.message || typeof e.message !== 'object' || !e.message.usage) continue;
      const u = e.message.usage;
      const partes = [u.input_tokens, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.output_tokens];
      if (!partes.every(numero)) return { lacuna: 'transcrição com uso de tokens fora do formato' };
      // Sem id, a linha conta sozinha: duplicar superestima, nunca subestima.
      const chave = typeof e.message.id === 'string' && e.message.id ? e.message.id : `linha:${vistos.size}:${String(e.uuid)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      total += (partes as number[]).reduce((a, b) => a + b, 0);
    }
  }
  return { valor: total, parcial: false, tetoSuperior: false, fonte: 'message.usage da transcrição do Claude Code' };
}

/** Os tokens e as leituras da cota do rollout do codex: o último `token_count` e cada `rate_limits` dele. */
export function leituraDoRollout(bruto: Buffer): { tokens: Medida; cota: LeituraDeCota[] | { lacuna: string } } {
  const lido = linhasJson(bruto);
  if (!lido || lido.ilegivel) return { tokens: { lacuna: 'rollout com linha ilegível no meio' }, cota: { lacuna: 'rollout com linha ilegível no meio' } };
  let total: number | null = null;
  const cota: LeituraDeCota[] = [];
  for (const l of lido.linhas) {
    const e = l as { type?: unknown; timestamp?: unknown; payload?: Record<string, unknown> };
    const p = e?.type === 'event_msg' ? e.payload : e as Record<string, unknown>;
    if (!p || p.type !== 'token_count') continue;
    const info = p.info as { total_token_usage?: Record<string, unknown> } | null | undefined;
    const uso = info?.total_token_usage;
    if (uso && typeof uso === 'object') {
      const t = uso.total_tokens ?? (numero(uso.input_tokens) && numero(uso.output_tokens) ? Number(uso.input_tokens) + Number(uso.output_tokens) : undefined);
      if (numero(t)) total = t;
    }
    const limites = p.rate_limits as Record<string, unknown> | null | undefined;
    const lidaEm = typeof e.timestamp === 'string' && Number.isFinite(Date.parse(e.timestamp)) ? new Date(Date.parse(e.timestamp)).toISOString() : null;
    if (!limites || typeof limites !== 'object' || !lidaEm) continue;
    for (const nome of ['primary', 'secondary']) {
      const j = limites[nome] as Record<string, unknown> | null | undefined;
      if (!j || typeof j !== 'object' || !numero(j.used_percent) || !numero(j.window_minutes)) continue;
      const renovaEm = numero(j.resets_at) ? Number(j.resets_at) * 1000
        : numero(j.resets_in_seconds) ? Date.parse(lidaEm) + Number(j.resets_in_seconds) * 1000 : null;
      cota.push({ janelaMin: Number(j.window_minutes), usado: Number(j.used_percent), renovaEm, lidaEm });
    }
  }
  return { tokens: total === null ? { lacuna: 'rollout sem contagem de tokens ainda' }
    : { valor: total, parcial: false, tetoSuperior: false, fonte: 'token_count do rollout do codex' }, cota };
}

/**
 * A cota do codex de uma conta pelas leituras das sessões do arco: o `used_percent` mais alto de cada janela, e a janela
 * que mais subiu manda. A janela que renovou entre leituras é lacuna (o uso de antes da renovação não se prova).
 */
export function cotaDasLeituras(leituras: readonly LeituraDeCota[]): Medida {
  if (!leituras.length) return { lacuna: 'nenhuma leitura da cota no rollout das sessões do arco' };
  let maior = 0;
  const porJanela = new Map<number, LeituraDeCota[]>();
  for (const l of leituras) porJanela.set(l.janelaMin, [...(porJanela.get(l.janelaMin) ?? []), l]);
  for (const [janela, lista] of porJanela) {
    const renovacoes = lista.map(l => l.renovaEm).filter((x): x is number => x !== null);
    if (renovacoes.length && Math.max(...renovacoes) - Math.min(...renovacoes) > TOLERANCIA_DA_RENOVACAO_MS) {
      return { lacuna: `a janela de ${janela} min renovou no meio do arco; o uso de antes da renovação não se prova` };
    }
    maior = Math.max(maior, ...lista.map(l => l.usado));
  }
  return { valor: maior, parcial: false, tetoSuperior: true,
    fonte: 'rate_limits do rollout do codex (inclui o uso de antes do arco e de outros projetos na janela)' };
}

function medirSessao(d: EstadoDoArco['despachos'][number], quando: string, fontes: FontesDeMedicao): MedicaoDeSessao {
  const base = { seq: d.seq, trabalho: d.trabalho, thread: d.threadDespachada ?? d.thread, sessionId: d.sessionId, runtime: d.runtime,
    conta: d.conta, inicio: null as string | null, fim: null as string | null, emVoo: false };
  const lacuna = (motivo: string): MedicaoDeSessao => ({ ...base, emVoo: true, minutos: { lacuna: motivo }, tokens: { lacuna: motivo },
    cota: { lacuna: motivo } });
  if (d.desfecho === 'pendente') return lacuna('reserva pendente: a sessão pode ter aberto sem id, e o consumo fica desconhecido até a reconciliação');
  if (!d.sessionId || !base.thread) {
    // O despacho idempotente sem sessão nova não abriu nada: zero provado para esta reserva.
    const zero: Medida = { valor: 0, parcial: false, tetoSuperior: false, fonte: 'despacho idempotente: a sessão em curso já atendia' };
    return { ...base, minutos: zero, tokens: zero, cota: [] };
  }
  const thread = base.thread, sessionId = d.sessionId;
  const eventos = fontes.eventos(thread);
  if (eventos === null) return lacuna(`o ledger da thread ${thread} não se lê`);
  const inicio = eventos.find(e => e.tipo === TIPOS_DE_EVENTO.faseDespachada && e.sessionId === sessionId)?.ts ?? null;
  const fim = inicio ? eventos.find(e => FIM_DA_SESSAO.includes(e.tipo) && e.sessionId === sessionId && e.ts >= inicio)?.ts ?? null : null;
  const emVoo = fim === null;
  const duracao = inicio ? Math.ceil((Date.parse(fim ?? quando) - Date.parse(inicio)) / 60_000) : Number.NaN;
  const minutos: Medida = !inicio ? { lacuna: `sem o phase_dispatch da sessão ${sessionId} no ledger da thread ${thread}` }
    // Instante que não é data (linha emendada à mão) não vira NaN abaixo do teto: é lacuna.
    : !Number.isFinite(duracao) ? { lacuna: `instante ilegível no ledger da thread ${thread} para a sessão ${sessionId}` }
    : { valor: Math.max(0, duracao), parcial: emVoo, tetoSuperior: false,
      fonte: emVoo ? 'do phase_dispatch até a leitura (sessão em voo)' : 'do phase_dispatch ao resultado gravado no ledger' };
  const perfil = fontes.perfil(d.conta);
  let tokens: Medida;
  let cota: MedicaoDeSessao['cota'];
  if (perfil === undefined) {
    tokens = { lacuna: 'o store de perfis não se lê' };
    cota = { lacuna: 'o store de perfis não se lê' };
  } else if (d.runtime === 'claude-bg') {
    cota = { lacuna: 'o Claude Code só mostra a cota aos mods dentro da sessão, fora do alcance do núcleo' };
    const cwd = fontes.cwd(thread);
    const arquivos = cwd ? fontes.transcricoes(perfil, cwd, sessionId) : null;
    if (!cwd) tokens = { lacuna: `a thread ${thread} não diz onde a sessão rodou` };
    else if (!arquivos) tokens = { lacuna: `sem a transcrição da sessão ${sessionId}` };
    else {
      // Um arquivo por vez na memória: a sessão com muitos subagentes não junta todas as transcrições de uma vez.
      let ilegivel = false;
      const lidas = function* (): Generator<Buffer> {
        for (const a of arquivos) { const c = fontes.ler(a); if (c === null) { ilegivel = true; return; } yield c; }
      };
      const medida = tokensDasTranscricoes(lidas());
      tokens = ilegivel ? { lacuna: 'transcrição que não se lê' } : medida;
    }
  } else if (d.runtime === 'codex') {
    const arquivo = fontes.rollout(perfil, sessionId);
    const bruto = arquivo ? fontes.ler(arquivo) : null;
    if (!bruto) {
      tokens = { lacuna: `sem o rollout da sessão ${sessionId}` };
      cota = { lacuna: `sem o rollout da sessão ${sessionId}` };
    } else {
      const r = leituraDoRollout(bruto);
      tokens = r.tokens;
      cota = r.cota;
    }
  } else {
    tokens = { lacuna: `runtime ${d.runtime} sem fonte de medição` };
    cota = { lacuna: `runtime ${d.runtime} sem fonte de medição` };
  }
  if ('valor' in tokens) tokens = { ...tokens, parcial: emVoo };
  return { ...base, inicio, fim, emVoo, minutos, tokens, cota };
}

function vazio(unidade: Unidade): ConsumoNaUnidade {
  return { unidade, valor: 0, lacunas: [], parcial: false, tetoSuperior: false, sessoes: 0 };
}

function somar(alvo: ConsumoNaUnidade, m: Medida, origem: string): void {
  alvo.sessoes += 1;
  if ('lacuna' in m || !Number.isFinite(m.valor)) {
    alvo.lacunas.push(`${origem}: ${'lacuna' in m ? m.lacuna : 'medida que não é número'}`);
    alvo.valor = null;
    return;
  }
  if (alvo.valor !== null) alvo.valor += m.valor;
  alvo.parcial = alvo.parcial || m.parcial;
  alvo.tetoSuperior = alvo.tetoSuperior || m.tetoSuperior;
}

/** As sessões do escopo, somadas em cada unidade; a cota é somada por conta (cada conta com a medida da cota dela). */
function consumoDoEscopo(sessoes: MedicaoDeSessao[], sessoesNaUnidade: number): ConsumoPorUnidade {
  const r = Object.fromEntries(UNIDADES.map(u => [u, vazio(u)])) as ConsumoPorUnidade;
  r.sessoes.valor = sessoesNaUnidade;
  r.sessoes.sessoes = sessoesNaUnidade;
  for (const s of sessoes) {
    const origem = `sessão ${s.sessionId ?? `da reserva ${s.seq}`} (${s.trabalho})`;
    somar(r['minutos-de-sessao'], s.minutos, origem);
    somar(r.tokens, s.tokens, origem);
  }
  for (const conta of [...new Set(sessoes.map(s => s.conta))].sort()) {
    const daConta = sessoes.filter(s => s.conta === conta);
    const comLacuna = daConta.find(s => !Array.isArray(s.cota));
    const medida: Medida = comLacuna ? { lacuna: (comLacuna.cota as { lacuna: string }).lacuna }
      : cotaDasLeituras(daConta.flatMap(s => s.cota as LeituraDeCota[]));
    somar(r['percentual-da-cota'], medida, `conta ${conta}`);
  }
  r['percentual-da-cota'].sessoes = sessoes.length;
  return r;
}

/** Mede o consumo do arco no instante dado. Sem gravar nada; a sessão repetida (o mesmo id) conta uma vez. */
export function medirArco(raiz: string, estado: EstadoDoArco, opcoes: { quando?: string; fontes?: Partial<FontesDeMedicao> } = {}): MedicaoDoArco {
  const quando = opcoes.quando ?? new Date().toISOString();
  const base: FontesDeMedicao = { ...fontesDoDisco(raiz), ...opcoes.fontes };
  // O ledger de cada thread é lido uma vez por medição, e não uma vez por sessão.
  const ledgers = new Map<string, EventoLedger[] | null>();
  const fontes: FontesDeMedicao = { ...base, eventos: (thread) => {
    if (!ledgers.has(thread)) ledgers.set(thread, base.eventos(thread));
    return ledgers.get(thread)!;
  } };
  const vistas = new Set<string>();
  const sessoes: MedicaoDeSessao[] = [];
  for (const d of estado.despachos) {
    if (d.desfecho === 'recusado') continue;
    if (d.sessionId) {
      if (vistas.has(d.sessionId)) continue;
      vistas.add(d.sessionId);
    }
    sessoes.push(medirSessao(d, quando, fontes));
  }
  const contas = [...new Set(sessoes.map(s => s.conta))].sort(), runtimes = [...new Set(sessoes.map(s => s.runtime))].sort();
  return {
    contrato: CONTRATO_MEDICAO, arco: estado.arco, quando, sessoes,
    doArco: consumoDoEscopo(sessoes, estado.consumo.arco),
    porConta: Object.fromEntries(contas.map(c => [c, consumoDoEscopo(sessoes.filter(s => s.conta === c), estado.consumo.porConta[c] ?? 0)])),
    porRuntime: Object.fromEntries(runtimes.map(r => [r, consumoDoEscopo(sessoes.filter(s => s.runtime === r), estado.consumo.porRuntime[r] ?? 0)])),
  };
}

/** O consumo de um escopo numa unidade; escopo sem sessão do arco mede zero (provado: nenhuma sessão caiu nele). */
export function consumoDoEscopoNaUnidade(medicao: MedicaoDoArco, escopo: 'arco' | { conta: string } | { runtime: string },
  unidade: Unidade): ConsumoNaUnidade {
  const porUnidade = escopo === 'arco' ? medicao.doArco : 'conta' in escopo ? medicao.porConta[escopo.conta] : medicao.porRuntime[escopo.runtime];
  return porUnidade?.[unidade] ?? vazio(unidade);
}

/** Algum teto do envelope está numa unidade que não é `sessoes`? Só então o passo precisa medir. */
export function precisaMedir(conteudo: ConteudoDoEnvelope): boolean {
  const o = conteudo.orcamento;
  return [o.arco, ...o.porConta.map(s => s.teto), ...o.porRuntime.map(s => s.teto)].some(t => t.unidade !== 'sessoes');
}


const valorMedido = (c: ConsumoNaUnidade): ValorMedido => c.valor === null
  ? { unidade: c.unidade, lacuna: c.lacunas.join('; ') || 'consumo desconhecido' }
  : { unidade: c.unidade, valor: c.valor, ...(c.tetoSuperior ? { tetoSuperior: true } : {}) };

/** O consumo medido dos três tetos de um despacho (arco, conta e runtime), cada um na unidade dele. */
export function medidoParaReserva(medicao: MedicaoDoArco, conteudo: ConteudoDoEnvelope, conta: string, runtime: string): ConsumoMedidoDoDespacho {
  const o = conteudo.orcamento;
  const daConta = o.porConta.find(s => s.conta === conta)?.teto, doRuntime = o.porRuntime.find(s => s.runtime === runtime)?.teto;
  // A sessão do claude-bg nunca terá a cota medida fora dela: o teto em percentual não se garante para ela, nem com o
  // zero provado de um escopo ainda sem sessão (runtime sem medição suficiente não é elegível para o regime).
  const medido = (c: ConsumoNaUnidade): ValorMedido => c.unidade === 'percentual-da-cota' && runtime === 'claude-bg'
    ? { unidade: c.unidade, lacuna: 'o Claude Code só mostra a cota dentro da sessão, e o teto em percentual não se garante para ele' }
    : valorMedido(c);
  return {
    arco: medido(consumoDoEscopoNaUnidade(medicao, 'arco', o.arco.unidade)),
    ...(daConta ? { conta: medido(consumoDoEscopoNaUnidade(medicao, { conta }, daConta.unidade)) } : {}),
    ...(doRuntime ? { runtime: medido(consumoDoEscopoNaUnidade(medicao, { runtime }, doRuntime.unidade)) } : {}),
  };
}

/** Uma medida em texto para pessoa: o valor com a unidade e o rótulo, ou a lacuna. */
export function textoDoConsumo(c: ConsumoNaUnidade): string {
  if (c.valor === null) return `lacuna (${c.lacunas.join('; ') || 'consumo desconhecido'})`;
  const valor = c.unidade === 'percentual-da-cota' ? `${Math.round(c.valor * 10) / 10}%` : `${c.valor} ${c.unidade}`;
  return `${c.tetoSuperior ? 'até ' : ''}${valor}${c.parcial ? ' até agora (sessão em voo)' : ''}${c.tetoSuperior ? ' (teto superior)' : ''}`;
}

/**
 * RM-032: conferência da prova de ativação por host, sem host.
 *
 * O roteiro `core/scripts/prova-ativacao.cjs` abre uma sessão nova e não interativa no host
 * (Claude Code ou OpenClaw), diz `orkastery maestro` e entrega aqui o transcript. Esta
 * conferência olha só o que é determinístico: qual ferramenta o modelo chamou, o resultado que
 * ela devolveu (contra `ork.maestro-snapshot/v1`) e o projeto lido. Da resposta final em texto
 * livre, exige apenas que cite o projeto e não repita o incidente de 29/09 ("roadmap vazio").
 */
import * as path from 'node:path';
import { MaestroSnapshot, validateMaestroSnapshot } from './maestro-contract';

export type HostProva = 'claude-code' | 'openclaw';
export const HOSTS_DA_PROVA: readonly HostProva[] = ['claude-code', 'openclaw'];

/**
 * A entrada contratada de cada host (MAESTRO_HOST_SURFACES em hosts.ts): no Claude, a tool MCP
 * do servidor `orkastery` fixado no projeto; no OpenClaw, a tool `ork_maestro` da extensão.
 * `ork maestro` pelo shell do host é desvio: o CLI resolve o projeto pelo diretório atual, a
 * classe de erro do incidente.
 */
export const ENTRADA_CONTRATADA: Readonly<Record<HostProva, string>> = {
  'claude-code': 'mcp__orkastery__ork_maestro',
  openclaw: 'ork_maestro',
};
const SHELL_DO_HOST: Readonly<Record<HostProva, string>> = { 'claude-code': 'Bash', openclaw: 'exec' };

export interface ChamadaMaestro {
  ferramenta: string;
  /** `entrada`: a ferramenta contratada; `shell`: `ork maestro` pelo shell do host. */
  via: 'entrada' | 'shell';
  argumentos: unknown;
  resultado: string | null;
  erro: boolean;
}
export interface TranscriptExtraido {
  /** Ferramentas que o host expôs ao modelo; null quando o transcript não diz. */
  ferramentasExpostas: string[] | null;
  chamadas: ChamadaMaestro[];
  respostaFinal: string | null;
}
export interface ConferenciaProva { id: string; ok: boolean; detalhe: string }
export interface EsperadoDaProva {
  /**
   * `fingerprint` é o de `discoverMaestro` para a raiz esperada: identifica a cópia lida mesmo
   * quando o snapshot mascara a raiz (`[caminho privado]` para caminhos sob /tmp e /home).
   */
  projeto: { nome: string; id: string; raiz: string; fingerprint: string };
  /** Home de quem rodou: o snapshot exibe a raiz com `~` (RM-052). */
  home: string;
}
export interface ResultadoDaConferencia {
  ok: boolean;
  conferencias: ConferenciaProva[];
  /** Resumo do snapshot lido, para o recibo; null quando não houve snapshot válido. */
  snapshot: { schema: string; projeto: MaestroSnapshot['project']; secoes: Record<string, string>; notConsulted: string[] } | null;
}

const ORK_MAESTRO_NO_SHELL = /(^|[\s;&|(])ork(\s+--projeto\s+\S+)?\s+maestro\b/;

function linhasJson(texto: string): Record<string, unknown>[] {
  const eventos: Record<string, unknown>[] = [];
  for (const linha of texto.split('\n')) {
    const limpa = linha.trim();
    if (!limpa.startsWith('{')) continue;
    try { eventos.push(JSON.parse(limpa)); } catch { /* linha de log do host, não evento */ }
  }
  return eventos;
}

function textoDoConteudo(conteudo: unknown): string | null {
  if (typeof conteudo === 'string') return conteudo;
  if (!Array.isArray(conteudo)) return null;
  const partes = conteudo.filter((c): c is { type: string; text: string } =>
    !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string');
  return partes.length ? partes.map(p => p.text).join('\n') : null;
}

function classificar(host: HostProva, ferramenta: string, argumentos: unknown): ChamadaMaestro['via'] | null {
  if (ferramenta === ENTRADA_CONTRATADA[host]) return 'entrada';
  const comando = (argumentos as { command?: unknown } | null)?.command;
  if (ferramenta === SHELL_DO_HOST[host] && typeof comando === 'string' && ORK_MAESTRO_NO_SHELL.test(comando)) return 'shell';
  return null;
}

/** Transcript `claude -p --output-format stream-json --verbose`. */
export function transcriptDoClaude(streamJson: string): TranscriptExtraido {
  const eventos = linhasJson(streamJson);
  let ferramentasExpostas: string[] | null = null;
  let respostaFinal: string | null = null;
  const pedidas = new Map<string, ChamadaMaestro>();
  const chamadas: ChamadaMaestro[] = [];
  for (const e of eventos) {
    if (e.type === 'system' && e.subtype === 'init' && Array.isArray(e.tools)) ferramentasExpostas = e.tools.filter((t): t is string => typeof t === 'string');
    const mensagem = e.message as { content?: unknown } | undefined;
    const blocos = Array.isArray(mensagem?.content) ? mensagem!.content as Record<string, unknown>[] : [];
    if (e.type === 'assistant') {
      for (const b of blocos) {
        if (b?.type !== 'tool_use' || typeof b.name !== 'string' || typeof b.id !== 'string') continue;
        const via = classificar('claude-code', b.name, b.input);
        if (!via) continue;
        const chamada: ChamadaMaestro = { ferramenta: b.name, via, argumentos: b.input ?? null, resultado: null, erro: false };
        pedidas.set(b.id, chamada); chamadas.push(chamada);
      }
    } else if (e.type === 'user') {
      for (const b of blocos) {
        if (b?.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
        const chamada = pedidas.get(b.tool_use_id);
        if (!chamada) continue;
        chamada.resultado = textoDoConteudo(b.content);
        chamada.erro = b.is_error === true;
      }
    } else if (e.type === 'result' && typeof e.result === 'string') respostaFinal = e.result;
  }
  return { ferramentasExpostas, chamadas, respostaFinal };
}

/**
 * Trajetória do OpenClaw (`openclaw sessions export-trajectory`, `events.jsonl`): eventos
 * `tool.call`/`tool.result` da origem `runtime`. As ferramentas expostas e a resposta final vêm
 * do `openclaw agent --json` (`meta.systemPromptReport.tools.entries`, `payloads[].text`).
 */
export function transcriptDoOpenclaw(eventsJsonl: string, agenteJson: unknown): TranscriptExtraido {
  const pedidas = new Map<string, ChamadaMaestro>();
  const chamadas: ChamadaMaestro[] = [];
  for (const e of linhasJson(eventsJsonl)) {
    if (e.source !== 'runtime') continue;
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (typeof d.toolCallId !== 'string' || typeof d.name !== 'string') continue;
    if (e.type === 'tool.call') {
      const via = classificar('openclaw', d.name, d.args);
      if (!via) continue;
      const chamada: ChamadaMaestro = { ferramenta: d.name, via, argumentos: d.args ?? null, resultado: null, erro: false };
      pedidas.set(d.toolCallId, chamada); chamadas.push(chamada);
    } else if (e.type === 'tool.result') {
      const chamada = pedidas.get(d.toolCallId);
      if (!chamada) continue;
      chamada.resultado = textoDoConteudo((d.result as { content?: unknown } | undefined)?.content);
      chamada.erro = d.success !== true;
    }
  }
  const agente = (agenteJson ?? {}) as { payloads?: { text?: unknown }[]; meta?: { systemPromptReport?: { tools?: { entries?: { name?: unknown }[] } } } };
  const entradas = agente.meta?.systemPromptReport?.tools?.entries;
  const ferramentasExpostas = Array.isArray(entradas) ? entradas.map(t => t?.name).filter((n): n is string => typeof n === 'string') : null;
  const textos = (agente.payloads ?? []).map(p => p?.text).filter((t): t is string => typeof t === 'string');
  return { ferramentasExpostas, chamadas, respostaFinal: textos.length ? textos.join('\n') : null };
}

/** O primeiro objeto `ork.maestro-snapshot/v1` do texto (o host pode juntar stderr ao stdout). */
export function extrairSnapshot(texto: string): unknown {
  const inicio = texto.indexOf('{"schema":"ork.maestro-snapshot/v1"');
  if (inicio < 0) return null;
  let profundidade = 0, emTexto = false, escape = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emTexto = false;
    } else if (c === '"') emTexto = true;
    else if (c === '{') profundidade++;
    else if (c === '}' && --profundidade === 0) {
      try { return JSON.parse(texto.slice(inicio, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function expandirHome(raiz: string, home: string): string {
  return raiz === '~' ? home : raiz.startsWith('~/') ? path.join(home, raiz.slice(2)) : raiz;
}

const ROADMAP_VAZIO = /roadmap\s+(est[aá]\s+|is\s+)?(vazio|empty)/i;
const NEGACAO = /\b(n[ãa]o|nunca|not|never|isn't|doesn't)\b/i;
/** A frase que conclui "roadmap vazio"; a que nega ("zero threads não quer dizer roadmap vazio") é a resposta certa. */
function concluiRoadmapVazio(texto: string): string | null {
  return texto.split(/(?<=[.!?\n])\s+/).find(frase => ROADMAP_VAZIO.test(frase) && !NEGACAO.test(frase))?.trim() ?? null;
}

export function conferirProva(host: HostProva, t: TranscriptExtraido, esperado: EsperadoDaProva): ResultadoDaConferencia {
  const conferencias: ConferenciaProva[] = [];
  const conferir = (id: string, ok: boolean, detalhe: string) => { conferencias.push({ id, ok, detalhe }); return ok; };
  const entrada = ENTRADA_CONTRATADA[host];
  conferir('entrada.exposta', t.ferramentasExpostas?.includes(entrada) ?? false,
    t.ferramentasExpostas === null ? 'o transcript não lista as ferramentas expostas'
      : t.ferramentasExpostas.includes(entrada) ? `${entrada} exposta ao modelo`
        : `${entrada} ausente entre ${t.ferramentasExpostas.length} ferramentas expostas`);
  const contratada = t.chamadas.find(c => c.via === 'entrada');
  const desvio = t.chamadas.find(c => c.via === 'shell');
  conferir('entrada.chamada', !!contratada,
    contratada ? `${entrada} chamada`
      : desvio ? `desvio: ${desvio.ferramenta} ${JSON.stringify((desvio.argumentos as { command?: unknown })?.command)} em vez de ${entrada}`
        : `${entrada} não foi chamada`);
  let snapshot: MaestroSnapshot | null = null;
  if (contratada) {
    if (conferir('resultado.sem-erro', contratada.resultado !== null && !contratada.erro,
      contratada.resultado === null ? 'a chamada não teve resultado' : contratada.erro ? `erro: ${contratada.resultado.slice(0, 300)}` : 'resultado sem erro')) {
      try {
        snapshot = validateMaestroSnapshot(extrairSnapshot(contratada.resultado!));
        conferir('resultado.contrato', true, `${snapshot.schema} validado`);
      } catch (e) {
        conferir('resultado.contrato', false, `fora do contrato: ${(e as Error).message.slice(0, 300)}`);
      }
    }
  }
  if (snapshot) {
    const p = snapshot.project;
    const exibida = p.root === undefined || p.root.includes('[caminho privado]') ? null : path.resolve(expandirHome(p.root, esperado.home));
    const mesmaCopia = p.fingerprint === esperado.projeto.fingerprint && (exibida === null || exibida === path.resolve(esperado.projeto.raiz));
    conferir('resultado.projeto', p.name === esperado.projeto.nome && mesmaCopia,
      `leu ${p.name} (${p.origin}) em ${p.root ?? 'raiz não exibida'}, impressão ${p.fingerprint.slice(0, 12)}; ` +
      `esperado ${esperado.projeto.nome}, impressão ${esperado.projeto.fingerprint.slice(0, 12)}`);
    const lacunas = snapshot.notConsulted ?? [];
    conferir('resultado.nao-consultado', lacunas.length > 0,
      lacunas.length ? `declara o que não leu: ${lacunas.length} item(ns)` : 'notConsulted ausente: zero threads pode virar "roadmap vazio"');
  }
  const resposta = t.respostaFinal ?? '';
  const citaProjeto = [esperado.projeto.nome, esperado.projeto.id].some(n => resposta.toLowerCase().includes(n.toLowerCase()));
  conferir('resposta.cita-projeto', citaProjeto,
    t.respostaFinal === null ? 'sem resposta final' : citaProjeto ? 'a resposta nomeia o projeto lido' : 'a resposta não nomeia o projeto lido');
  const vazio = concluiRoadmapVazio(resposta);
  conferir('resposta.sem-roadmap-vazio', vazio === null,
    vazio ? `a resposta conclui "roadmap vazio" a partir do panorama (incidente de 29/09): ${vazio.slice(0, 200)}` : 'sem concluir "roadmap vazio" a partir do panorama');
  return {
    ok: conferencias.every(c => c.ok),
    conferencias,
    snapshot: snapshot && {
      schema: snapshot.schema, projeto: snapshot.project,
      secoes: Object.fromEntries(Object.entries(snapshot.sections).map(([nome, s]) => [nome, s.state])),
      notConsulted: snapshot.notConsulted ?? [],
    },
  };
}

/**
 * Redação antes de qualquer gravação: o recibo vai ao repositório. Cobre tokens com prefixo
 * conhecido, `Bearer`, e valores de chaves JSON com nome de segredo.
 */
export function redigir(texto: string): string {
  return texto
    .replace(/\b(sk-ant-[A-Za-z0-9_-]+|sk-or-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,})/g, '[REDIGIDO]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, '[REDIGIDO]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDIGIDO]')
    .replace(/("[^"]*(?:token|secret|password|passwd|api[_-]?key|apikey|credential)[^"]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDIGIDO]"');
}

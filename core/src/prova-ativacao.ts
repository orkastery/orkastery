/**
 * RM-032: conferência da prova de ativação por host, sem host.
 *
 * O roteiro `core/scripts/prova-ativacao.cjs` abre uma sessão nova e não interativa no host
 * (Claude Code ou OpenClaw), diz `orkastery maestro` e entrega aqui o transcript. Esta
 * conferência olha só o que é determinístico: qual ferramenta o modelo chamou, o resultado que
 * ela devolveu (contra o contrato da entrada) e o projeto lido. Da resposta final em texto
 * livre, exige apenas que cite o projeto e não repita o incidente de 29/09 ("roadmap vazio").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MaestroSnapshot, validateMaestroSnapshot } from './maestro-contract';

export type HostProva = 'claude-code' | 'openclaw';
export const HOSTS_DA_PROVA: readonly HostProva[] = ['claude-code', 'openclaw'];

/** `maestro`: JSON `ork.maestro-snapshot/v1`; `rede`: texto de `ork network roadmap` (`ork.network-roadmap/v1`). */
export type ContratoDaEntrada = 'maestro' | 'rede';
export interface EntradaDoHost { ferramenta: string; contrato: ContratoDaEntrada }
/**
 * As entradas da frase em cada host. No Claude, a tool MCP do servidor `orkastery` fixado no
 * projeto (MAESTRO_HOST_SURFACES em hosts.ts). No OpenClaw 0.5.0 (RM-054, fatia 2), a frase sem
 * projeto vai a `ork_network_roadmap`, a única tool da extensão no perfil `coding`; com projeto
 * nomeado, a `ork_maestro`. `ork maestro` pelo shell do host é desvio: o CLI resolve o projeto
 * pelo diretório atual, a classe de erro do incidente.
 */
export const ENTRADAS: Readonly<Record<HostProva, readonly EntradaDoHost[]>> = {
  'claude-code': [{ ferramenta: 'mcp__orkastery__ork_maestro', contrato: 'maestro' }],
  openclaw: [{ ferramenta: 'ork_network_roadmap', contrato: 'rede' }, { ferramenta: 'ork_maestro', contrato: 'maestro' }],
};
const SHELL_DO_HOST: Readonly<Record<HostProva, string>> = { 'claude-code': 'Bash', openclaw: 'exec' };

export interface ChamadaMaestro {
  ferramenta: string;
  /** `entrada`: a ferramenta contratada; `shell`: `ork maestro` pelo shell do host. */
  via: 'entrada' | 'shell';
  /** O contrato do resultado, quando a chamada é por uma entrada do host. */
  contrato: ContratoDaEntrada | null;
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
  /** Resumo do panorama da rede lido (entrada `rede`); null nas outras. */
  rede: { cabecalho: string; consultado: string; naoConsultado: string[] } | null;
}

const ORK_MAESTRO_NO_SHELL = /(^|[\s;&|(/])ork(\s+--(projeto|project)(\s+|=)\S+)?\s+maestro\b/;

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

function classificar(host: HostProva, ferramenta: string, argumentos: unknown): Pick<ChamadaMaestro, 'via' | 'contrato'> | null {
  const entrada = ENTRADAS[host].find(e => e.ferramenta === ferramenta);
  if (entrada) return { via: 'entrada', contrato: entrada.contrato };
  const comando = (argumentos as { command?: unknown } | null)?.command;
  if (ferramenta === SHELL_DO_HOST[host] && typeof comando === 'string' && ORK_MAESTRO_NO_SHELL.test(comando)) return { via: 'shell', contrato: null };
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
        const tipo = classificar('claude-code', b.name, b.input);
        if (!tipo) continue;
        const chamada: ChamadaMaestro = { ferramenta: b.name, ...tipo, argumentos: b.input ?? null, resultado: null, erro: false };
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
      const tipo = classificar('openclaw', d.name, d.args);
      if (!tipo) continue;
      const chamada: ChamadaMaestro = { ferramenta: d.name, ...tipo, argumentos: d.args ?? null, resultado: null, erro: false };
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

const ROADMAP_VAZIO = /\broadmap\b((?:\s+[^\s.!?:;,]+){0,4}?)\s+(vazio|empty)\b/giu;
const NEGACAO = /(^|[^\p{L}])(n[ãa]o|nunca|jamais|not|never|isn't|doesn't|nem)([^\p{L}]|$)/iu;
/**
 * A frase que conclui "roadmap vazio". A negação só conta quando governa a conclusão: dentro do
 * trecho ("the roadmap is not empty") ou nas até quatro palavras antes dele, sem atravessar
 * pontuação ("zero threads não quer dizer roadmap vazio"). "O roadmap está vazio e não há
 * threads" e "Não há itens: o roadmap está vazio" concluem.
 */
function concluiRoadmapVazio(texto: string): string | null {
  for (const m of texto.matchAll(ROADMAP_VAZIO)) {
    const antes = texto.slice(0, m.index).split(/[.!?:;,\n]/).pop()!.trim().split(/\s+/).slice(-4).join(' ');
    if (!NEGACAO.test(antes) && !NEGACAO.test(m[1])) return `${antes} ${m[0]}`.trim();
  }
  return null;
}
const canonica = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
/** Nome inteiro, não pedaço de palavra: a abreviação `pav` não casa com "pavimento". */
const nomeia = (texto: string, nome: string): boolean =>
  new RegExp(`(^|[^\\p{L}\\p{N}_-])${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}_-]|$)`, 'iu').test(texto);

/**
 * O texto de `ork network roadmap` (`textoDoPanoramaDaRede`): a primeira linha diz de onde foi
 * lido, a segunda quais projetos foram consultados (`<nome> (clone em <raiz>)`) e o bloco
 * "Não consultado:" o que ficou de fora.
 */
function lerPanoramaDaRede(texto: string): ResultadoDaConferencia['rede'] {
  const linhas = texto.split('\n');
  const i = linhas.findIndex(l => /^Panorama da rede lido de /.test(l));
  if (i < 0 || !/^Consultado: /.test(linhas[i + 1] ?? '') || linhas[i + 2] !== 'Não consultado:') return null;
  const naoConsultado: string[] = [];
  for (const l of linhas.slice(i + 3)) { if (!l.startsWith('• ')) break; naoConsultado.push(l.slice(2)); }
  return { cabecalho: linhas[i], consultado: linhas[i + 1], naoConsultado };
}

export function conferirProva(host: HostProva, t: TranscriptExtraido, esperado: EsperadoDaProva): ResultadoDaConferencia {
  const conferencias: ConferenciaProva[] = [];
  const conferir = (id: string, ok: boolean, detalhe: string) => { conferencias.push({ id, ok, detalhe }); return ok; };
  const nomes = ENTRADAS[host].map(e => e.ferramenta);
  const expostas = nomes.filter(n => t.ferramentasExpostas?.includes(n));
  conferir('entrada.exposta', expostas.length > 0,
    t.ferramentasExpostas === null ? 'o transcript não lista as ferramentas expostas'
      : expostas.length ? `${expostas.join(', ')} exposta(s) ao modelo`
        : `${nomes.join(' e ')} ausente(s) entre ${t.ferramentasExpostas.length} ferramentas expostas`);
  // A última chamada contratada com resultado é a que vale (uma nova tentativa depois de erro não
  // reprova); qualquer `ork maestro` pelo shell reprova, mesmo ao lado da chamada contratada.
  const contratadas = t.chamadas.filter(c => c.via === 'entrada');
  const contratada = [...contratadas].reverse().find(c => c.resultado !== null && !c.erro) ?? contratadas.at(-1);
  const desvio = t.chamadas.find(c => c.via === 'shell');
  const comando = desvio && JSON.stringify((desvio.argumentos as { command?: unknown })?.command);
  conferir('entrada.chamada', !!contratada && !desvio,
    contratada && desvio ? `${contratada.ferramenta} chamada, mas também desvio: ${desvio.ferramenta} ${comando}`
      : contratada ? `${contratada.ferramenta} chamada`
        : desvio ? `desvio: ${desvio.ferramenta} ${comando} em vez de ${nomes.join(' ou ')}`
          : `${nomes.join(' ou ')} não foi chamada`);
  let snapshot: MaestroSnapshot | null = null;
  let rede: ResultadoDaConferencia['rede'] = null;
  if (contratada && conferir('resultado.sem-erro', contratada.resultado !== null && !contratada.erro,
    contratada.resultado === null ? 'a chamada não teve resultado' : contratada.erro ? `erro: ${contratada.resultado.slice(0, 300)}` : 'resultado sem erro')) {
    if (contratada.contrato === 'maestro') {
      try {
        snapshot = validateMaestroSnapshot(extrairSnapshot(contratada.resultado!));
        conferir('resultado.contrato', true, `${snapshot.schema} validado`);
      } catch (e) {
        conferir('resultado.contrato', false, `fora do contrato: ${(e as Error).message.slice(0, 300)}`);
      }
    } else {
      rede = lerPanoramaDaRede(contratada.resultado!);
      conferir('resultado.contrato', rede !== null, rede ? 'texto do ork.network-roadmap/v1: cabeçalho, Consultado e Não consultado'
        : 'fora do contrato: sem o cabeçalho "Panorama da rede lido de", "Consultado:" e "Não consultado:"');
    }
  }
  if (snapshot) {
    const p = snapshot.project;
    const exibida = p.root === undefined || p.root.includes('[caminho privado]') ? null : canonica(expandirHome(p.root, esperado.home));
    const mesmaCopia = p.fingerprint === esperado.projeto.fingerprint && (exibida === null || exibida === canonica(esperado.projeto.raiz));
    conferir('resultado.projeto', p.name === esperado.projeto.nome && mesmaCopia,
      `leu ${p.name} (${p.origin}) em ${p.root ?? 'raiz não exibida'}, impressão ${p.fingerprint.slice(0, 12)}; ` +
      `esperado ${esperado.projeto.nome}, impressão ${esperado.projeto.fingerprint.slice(0, 12)}`);
    const lacunas = snapshot.notConsulted ?? [];
    conferir('resultado.nao-consultado', lacunas.length > 0,
      lacunas.length ? `declara o que não leu: ${lacunas.length} item(ns)` : 'notConsulted ausente: zero threads pode virar "roadmap vazio"');
  }
  if (rede) {
    // "Consultado: a (clone em X); b (clone em Y)": vale o projeto esperado na raiz esperada.
    const lidos = [...rede.consultado.replace(/^Consultado: /, '').matchAll(/(?:^|; )(.+?) \(clone em ([^)]+)\)/g)];
    const leu = lidos.some(([, nome, raiz]) => nome === esperado.projeto.nome &&
      canonica(expandirHome(raiz, esperado.home)) === canonica(esperado.projeto.raiz));
    conferir('resultado.projeto', leu, `${rede.consultado.slice(0, 300)}; esperado ${esperado.projeto.nome} (clone em ${esperado.projeto.raiz})`);
    conferir('resultado.nao-consultado', rede.naoConsultado.length > 0,
      rede.naoConsultado.length ? `declara o que não leu: ${rede.naoConsultado.length} item(ns)` : 'sem o bloco do que não foi consultado');
  }
  const resposta = t.respostaFinal ?? '';
  const citaProjeto = [esperado.projeto.nome, esperado.projeto.id].some(n => nomeia(resposta, n));
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
    rede,
  };
}

/**
 * Redação antes de qualquer gravação: o recibo vai ao repositório. Cobre tokens com prefixo
 * conhecido, `Bearer`/`Basic`, variáveis de ambiente com nome de segredo e valores de chaves JSON
 * com nome de segredo. Para objetos, use `redigirObjeto`, que aplica a regra a cada texto antes
 * da serialização (JSON dentro de stdout escaparia depois dela).
 */
const CHAVE_DE_SEGREDO = /token|secret|password|passwd|api[_-]?key|apikey|credential|authorization|cookie/i;
export function redigir(texto: string): string {
  return texto
    .replace(/\b(sk-ant-[A-Za-z0-9_-]+|sk-or-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,}|[sr]k_live_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,})/g, '[REDIGIDO]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, '[REDIGIDO]')
    .replace(/\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1$2[REDIGIDO]')
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|\S+)/g, '$1[REDIGIDO]')
    .replace(/("[^"]*(?:token|secret|password|passwd|api[_-]?key|apikey|credential|authorization|cookie)[^"]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDIGIDO]"');
}
export function redigirObjeto<T>(valor: T): T {
  if (typeof valor === 'string') return redigir(valor) as T;
  if (Array.isArray(valor)) return valor.map(v => redigirObjeto(v)) as T;
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) =>
      [k, typeof v === 'string' && CHAVE_DE_SEGREDO.test(k) ? '[REDIGIDO]' : redigirObjeto(v)])) as T;
  }
  return valor;
}

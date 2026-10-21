/**
 * RM-057 (resposta curta, D5 e D6 da ork-rm057respost): o ingresso do terminal do Claude Code.
 *
 * O dono decidiu que aprova onde estiver. No terminal do Claude Code, o hook `UserPromptSubmit` do plugin do `ork` leva
 * ao núcleo o que ele digitou numa sessão interativa; quando o texto é uma resposta curta a uma pergunta do arco #Noctum,
 * o núcleo confere a ORIGEM da sessão, nunca o texto, e grava o ato com o recibo.
 *
 * A origem (D5), conferida nesta ordem, cada passo com o motivo tipado de quando falha:
 *  - presença: o Claude Code marca os filhos de uma sessão com `CLAUDE_CODE_SESSION_ATTENDED=1` só quando há alguém
 *    nela; em segundo plano, em `daemon` e na execução por `-p` aninhada, vale `0`;
 *  - id: o `CLAUDE_CODE_SESSION_ID` do ambiente é o `session_id` do evento;
 *  - sem despacho: nem a identidade de despacho do `ork` (`ORK_DISPATCH_ID`, `ORK_DISPATCH_THREAD`) nem a pasta de job
 *    de segundo plano (`CLAUDE_JOB_DIR`) no ambiente;
 *  - ponto de entrada: não é o do SDK (`sdk-*`);
 *  - registro: o id não é de sessão que o `ork` despachou ou adotou em thread nenhuma deste projeto;
 *  - worktree: o `cwd` não está em worktree de thread;
 *  - ancestralidade (Linux, pelo `/proc`): a sessão do Claude Code (`CLAUDE_PID`) é ancestral deste processo, o ambiente
 *    dela não é de segundo plano (`CLAUDE_CODE_SESSION_KIND`) e nenhuma outra sessão do Claude Code está acima dela.
 *
 * O limite que sobra, dito como o do diálogo nativo (A21 e NP14): um processo do mesmo usuário do sistema que monte esse
 * ambiente e essa cadeia de processos à mão passa, porque o núcleo e os agentes dividem a conta. O que fica de fora é o
 * engano comum: a sessão despachada pelo `ork`, a de segundo plano, a de worktree de thread e a aninhada não respondem
 * pelo dono, nem digitando "sim". Separar de verdade é rodar os agentes em outra conta ou sandbox.
 *
 * A palavra solta (D6) só vale para a pergunta do arco cujo código apareceu no fim da transcrição desta sessão; o código
 * digitado vale sempre; com mais de uma, o núcleo pergunta qual. A resposta a um gate não é gravada aqui (D1): ela vai ao
 * condutor como contexto, para ele abrir o diálogo nativo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { lerTrecho, TrechoLivre } from './hitl-texto-livre';
import { exigirManifesto } from './manifest';
import { AtestadoDoTerminal, PerguntaNoLog } from './noctum-arco';
import { DesfechoDaRespostaAoArco, perguntasPendentes, perguntasPorCodigo, responderPerguntaDoArco, rotuloDaPergunta } from './noctum-resposta';
import { interpretarRespostaDoPulse, lerLoteServido, pedidosComCodigo, PerguntaServida, restoDoCodigo } from './pulse-resposta';
import { lerThread, listarIds } from './thread';

export const CONTRATO_DO_TERMINAL = 'ork.noctum-terminal/v1' as const;

/** O que o hook `UserPromptSubmit` entrega, como o Claude Code o monta. */
export interface EntradaDoHook {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: string;
  prompt: string;
}

/** Um processo da cadeia, do atual até o topo, com o ambiente de quando ele começou (`null`: não se lê). */
export interface Ancestral { pid: number; ppid: number; ambiente: Record<string, string> | null }

export interface AmbienteDoTerminal {
  env: NodeJS.ProcessEnv;
  quando?: string;
  /** A cadeia de processos deste até o topo; `null` quando a plataforma não a expõe. O teste troca. */
  ancestrais?: () => Ancestral[] | null;
  /** O fim da transcrição da sessão; `null` quando não se lê. O teste troca. */
  transcricao?: (arquivo: string) => string | null;
  /** O estado da conversa do pulse (o lote servido), quando não é o da raiz. */
  estadoDir?: string;
}

/** O corpo da decisão, sem o contrato. */
export type CorpoDaDecisaoDoTerminal =
  /** Não é com o Orkastery: o prompt segue ao modelo, sem nada. */
  | { acao: 'ignorar'; motivo: string }
  /** A origem não prova o dono: nada é gravado, e o prompt segue ao modelo; com presença, o dono vê o aviso. */
  | { acao: 'recusada'; motivo: string; mensagem: string; presenca: boolean }
  /** O ato foi gravado (ou já valia): a confirmação substitui o prompt. */
  | { acao: 'registrada'; mensagem: string; arco: string; ato: 'autorizar' | 'revogar'; codigo: string; repetida: boolean }
  /** Adiar, mudar algo, o detalhe, ou a pergunta de volta (ambígua, vencida, a que mudou): substitui o prompt, sem efeito. */
  | { acao: 'sem-efeito' | 'detalhe' | 'pergunta'; mensagem: string }
  /** A resposta a um gate (D1): vai ao condutor como contexto, para ele abrir o diálogo nativo. Nada é gravado. */
  | { acao: 'encaminhar'; contexto: string };

export type DecisaoDoTerminal = { contrato: typeof CONTRATO_DO_TERMINAL } & CorpoDaDecisaoDoTerminal;

const TETO_DO_PROMPT = 300;
const TETO_DA_TRANSCRICAO = 512 * 1024;
const ID_DE_SESSAO = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const KINDS_DE_FUNDO = ['bg', 'daemon', 'daemon-worker'];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const decisao = (d: CorpoDaDecisaoDoTerminal): DecisaoDoTerminal => ({ contrato: CONTRATO_DO_TERMINAL, ...d });

/** A cadeia de processos pelo `/proc`, do atual até o topo (Linux). Fora do Linux, `null`. */
export function ancestraisPeloProc(): Ancestral[] | null {
  if (!fs.existsSync('/proc/self/stat')) return null;
  const cadeia: Ancestral[] = [];
  let pid = process.pid;
  for (let i = 0; i < 64 && pid > 0; i++) {
    let stat: string;
    try { stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { break; }
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    let ambiente: Record<string, string> | null = null;
    try {
      ambiente = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`).toString('utf8').split('\0').filter(Boolean)
        .map(l => { const k = l.indexOf('='); return [l.slice(0, k), l.slice(k + 1)]; }));
    } catch { ambiente = null; }
    cadeia.push({ pid, ppid, ambiente });
    if (!Number.isInteger(ppid) || ppid <= 1) break;
    pid = ppid;
  }
  return cadeia;
}

/** O fim da transcrição da sessão: um `.jsonl` comum do próprio usuário, lido só nos últimos 512 KB. */
export function fimDaTranscricao(arquivo: string): string | null {
  try {
    if (!path.isAbsolute(arquivo) || !arquivo.endsWith('.jsonl')) return null;
    const fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.uid !== process.getuid?.()) return null;
      const tamanho = Math.min(st.size, TETO_DA_TRANSCRICAO), buf = Buffer.alloc(tamanho);
      fs.readSync(fd, buf, 0, tamanho, st.size - tamanho);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

/** As sessões que o `ork` despachou ou adotou em alguma thread deste projeto, e as worktrees das threads. */
function registroDoOrk(raiz: string): { sessoes: Set<string>; worktrees: string[] } {
  const sessoes = new Set<string>(), worktrees: string[] = [];
  for (const id of listarIds(raiz)) {
    try {
      const t = lerThread(raiz, id);
      for (const s of t.sessoes ?? []) if (typeof s.sessionId === 'string') sessoes.add(s.sessionId);
      if (typeof t.worktree === 'string' && t.worktree) worktrees.push(t.worktree);
    } catch { /* thread ilegível não tira nem põe ninguém no registro */ }
  }
  return { sessoes, worktrees };
}

const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const dentro = (pai: string, filho: string): boolean => {
  const rel = path.relative(real(pai), real(filho));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const MOTIVOS: Readonly<Record<string, string>> = Object.freeze({
  'noctum.terminal.sem-presenca': 'a sessão não tem alguém presente (segundo plano ou execução por programa)',
  'noctum.terminal.sessao-divergente': 'o id da sessão do evento não é o do ambiente',
  'noctum.terminal.sessao-despachada': 'a sessão foi despachada pelo ork ou roda como job de segundo plano',
  'noctum.terminal.sessao-programatica': 'a sessão é do SDK, não do terminal',
  'noctum.terminal.sessao-do-ork': 'a sessão foi despachada ou adotada pelo ork numa thread',
  'noctum.terminal.worktree-de-thread': 'a sessão roda numa worktree de thread',
  'noctum.terminal.ancestral-divergente': 'a sessão do Claude Code não é ancestral deste processo',
  'noctum.terminal.ancestral-ilegivel': 'o ambiente da sessão do Claude Code não se lê',
  'noctum.terminal.sessao-em-segundo-plano': 'a sessão do Claude Code roda em segundo plano',
  'noctum.terminal.sessao-aninhada': 'a sessão está aninhada em outra sessão do Claude Code',
});

/**
 * D5: a origem da sessão, nesta ordem. Devolve as conferências que passaram, para o recibo, ou o primeiro motivo que
 * falhou. Nada aqui lê o texto do dono.
 */
export function origemDoDono(raiz: string, entrada: EntradaDoHook, amb: AmbienteDoTerminal):
  { ok: true; atestado: Omit<AtestadoDoTerminal, 'recebidoEm'> } | { ok: false; motivo: string } {
  const env = amb.env, conferencias: string[] = [];
  const falha = (motivo: string) => ({ ok: false as const, motivo });
  if (env.CLAUDE_CODE_SESSION_ATTENDED !== '1') return falha('noctum.terminal.sem-presenca');
  conferencias.push('presenca');
  if (env.CLAUDE_CODE_SESSION_ID !== entrada.session_id) return falha('noctum.terminal.sessao-divergente');
  conferencias.push('id-da-sessao');
  if (env.ORK_DISPATCH_ID || env.ORK_DISPATCH_THREAD || env.CLAUDE_JOB_DIR) return falha('noctum.terminal.sessao-despachada');
  conferencias.push('sem-despacho');
  if (/^sdk/i.test(env.CLAUDE_CODE_ENTRYPOINT ?? '')) return falha('noctum.terminal.sessao-programatica');
  conferencias.push('ponto-de-entrada');
  const registro = registroDoOrk(raiz);
  if (registro.sessoes.has(entrada.session_id)) return falha('noctum.terminal.sessao-do-ork');
  conferencias.push('fora-do-registro');
  let dirDasWorktrees = '.claude/worktrees';
  try { dirDasWorktrees = exigirManifesto(raizDoEstado(raiz)).manifesto.worktree.dir || dirDasWorktrees; } catch { /* o padrão do manifesto */ }
  const raizes = [...registro.worktrees, path.join(raizDoEstado(raiz), dirDasWorktrees)];
  if (raizes.some(w => dentro(w, entrada.cwd))) return falha('noctum.terminal.worktree-de-thread');
  conferencias.push('fora-de-worktree');
  const cadeia = (amb.ancestrais ?? ancestraisPeloProc)();
  if (cadeia === null) conferencias.push('ancestralidade-nao-conferida');
  else {
    const claudePid = Number(env.CLAUDE_PID);
    const i = Number.isInteger(claudePid) ? cadeia.findIndex(a => a.pid === claudePid) : -1;
    if (i < 0) return falha('noctum.terminal.ancestral-divergente');
    const sessao = cadeia[i];
    if (!sessao.ambiente) return falha('noctum.terminal.ancestral-ilegivel');
    if (KINDS_DE_FUNDO.includes(sessao.ambiente.CLAUDE_CODE_SESSION_KIND ?? '')) return falha('noctum.terminal.sessao-em-segundo-plano');
    if (cadeia.slice(i + 1).some(a => a.ambiente?.CLAUDECODE === '1')) return falha('noctum.terminal.sessao-aninhada');
    conferencias.push('ancestralidade');
  }
  const entrypoint = typeof env.CLAUDE_CODE_ENTRYPOINT === 'string' && env.CLAUDE_CODE_ENTRYPOINT ? env.CLAUDE_CODE_ENTRYPOINT.slice(0, 64) : null;
  return { ok: true, atestado: { host: 'claude-code', sessao: entrada.session_id, entrypoint, conferencias } };
}

/** A entrada do hook, ou `null` quando ela não tem a forma do `UserPromptSubmit`. */
export function lerEntradaDoHook(v: unknown): EntradaDoHook | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (e.hook_event_name !== 'UserPromptSubmit' || typeof e.session_id !== 'string' || !ID_DE_SESSAO.test(e.session_id) ||
      typeof e.cwd !== 'string' || !path.isAbsolute(e.cwd) || typeof e.prompt !== 'string' ||
      (e.transcript_path !== undefined && typeof e.transcript_path !== 'string')) return null;
  return { session_id: e.session_id, cwd: e.cwd, hook_event_name: e.hook_event_name, prompt: e.prompt,
    ...(typeof e.transcript_path === 'string' ? { transcript_path: e.transcript_path } : {}) };
}

/** O código aparece no fim da transcrição desta sessão, como palavra inteira? */
function mostradaNestaSessao(fim: string | null, codigo: string): boolean {
  return fim !== null && new RegExp(`(?<![A-Za-z0-9])${codigo}(?![A-Za-z0-9])`).test(fim);
}

/** A decisão para o desfecho da resposta à pergunta do arco. */
function decisaoDoDesfecho(p: PerguntaNoLog, d: DesfechoDaRespostaAoArco): DecisaoDoTerminal {
  if (d.tipo === 'registrada') {
    return decisao({ acao: 'registrada', mensagem: d.mensagem, arco: p.arco, ato: d.ato, codigo: p.codigo, repetida: d.repetida });
  }
  if (d.tipo === 'sem-efeito' || d.tipo === 'detalhe') return decisao({ acao: d.tipo, mensagem: d.mensagem });
  return decisao({ acao: 'pergunta', mensagem: d.mensagem });
}

/** O contexto ao condutor quando o dono respondeu a um gate no terminal (D1): o que abrir, sem resposta nos argumentos. */
function contextoDoGate(codigo: string, thread: string, pedidoId: string, texto: string): string {
  return `Orkastery: o dono digitou "${texto.slice(0, 40)}" e isso parece a resposta à pergunta ${codigo} (gate da thread ${thread}). ` +
    'O terminal não grava resposta de gate: abra o diálogo nativo com ork_request_decision ' +
    `(threadId ${thread}, pedidoId ${pedidoId}) para o dono escolher lá; nunca passe a resposta nos argumentos.`;
}

/**
 * O ingresso do terminal: lê o evento do hook, reconhece só a resposta curta, acha a pergunta (o código, o número servido
 * ou a única mostrada nesta sessão), confere a origem (D5) e responde pela via do terminal. Nunca adivinha.
 */
export function responderPeloTerminal(raiz: string | null, bruto: unknown, amb: AmbienteDoTerminal): DecisaoDoTerminal {
  const quando = amb.quando ?? new Date().toISOString();
  const entrada = lerEntradaDoHook(bruto);
  if (!entrada) return decisao({ acao: 'ignorar', motivo: 'entrada' });
  const texto = entrada.prompt.trim();
  if (!texto || texto.length > TETO_DO_PROMPT || /[\r\n]/.test(texto)) return decisao({ acao: 'ignorar', motivo: 'nao-e-resposta-curta' });
  const lido = interpretarRespostaDoPulse(texto);
  if (!['consentimento', 'lote', 'livre'].includes(lido.forma) || (lido.forma === 'lote' && lido.escolhas.length !== 1)) {
    return decisao({ acao: 'ignorar', motivo: 'nao-e-resposta-curta' });
  }
  if (raiz === null) return decisao({ acao: 'ignorar', motivo: 'sem-projeto' });

  // A pergunta: pelo código digitado, pelo número servido ou pela única mostrada nesta sessão.
  let pergunta: PerguntaNoLog | null = null, trecho: TrechoLivre | null = null;
  if (lido.forma === 'consentimento') {
    const doArco = perguntasPorCodigo(raiz, lido.codigo, quando);
    const gates = pedidosComCodigo(raiz, lido.codigo);
    if (doArco.length + gates.length > 1) {
      return decisao({ acao: 'pergunta', mensagem: `O código ${lido.codigo} está em mais de uma pergunta; nada foi registrado. Responda pelo número da pergunta.` });
    }
    if (gates.length === 1) return decisao({ acao: 'encaminhar', contexto: contextoDoGate(lido.codigo, gates[0].thread, gates[0].pedido.id, texto) });
    if (!doArco.length) return decisao({ acao: 'ignorar', motivo: 'codigo-desconhecido' });
    pergunta = doArco[0];
    const resto = restoDoCodigo(texto, lido.codigo);
    trecho = lerTrecho(resto) ?? (resto === '?' ? lerTrecho('detalhes') : null);
    if (!trecho) {
      return decisao({ acao: 'pergunta', mensagem: `Não entendi "${resto.slice(0, 40)}" para ${pergunta.codigo}; nada foi registrado. Responda a, b ou c.` });
    }
  } else if (lido.forma === 'lote') {
    const { numero, letra } = lido.escolhas[0];
    let servida: PerguntaServida | undefined;
    try { servida = lerLoteServido(raiz, amb.estadoDir).perguntas.find(q => q.numero === numero); } catch { servida = undefined; }
    if (!servida) return decisao({ acao: 'ignorar', motivo: 'numero-desconhecido' });
    if (!servida.arco) {
      return decisao({ acao: 'encaminhar', contexto: contextoDoGate(String(numero), servida.thread, servida.pedidoId, texto) });
    }
    pergunta = perguntasPorCodigo(raiz, servida.arco.codigo, quando).find(q => q.arco === servida!.arco!.arco) ?? null;
    if (!pergunta) return decisao({ acao: 'ignorar', motivo: 'numero-desconhecido' });
    trecho = { tipo: 'letra', letra };
  } else if (lido.forma === 'livre') {
    const fim = entrada.transcript_path ? (amb.transcricao ?? fimDaTranscricao)(entrada.transcript_path) : null;
    const mostradas = perguntasPendentes(raiz, quando).filter(q => mostradaNestaSessao(fim, q.codigo));
    if (mostradas.length > 1) {
      return decisao({ acao: 'pergunta', mensagem: `Há ${mostradas.length} perguntas do arco nesta conversa, e "${texto.slice(0, 40)}" não diz qual; ` +
        `nada foi registrado. Responda pelo código: ${mostradas.map(rotuloDaPergunta).join('; ')}.` });
    }
    if (!mostradas.length) return decisao({ acao: 'ignorar', motivo: 'nenhuma-pergunta-nesta-sessao' });
    pergunta = mostradas[0];
    trecho = lido.trecho;
  }
  if (!pergunta || !trecho) return decisao({ acao: 'ignorar', motivo: 'nao-e-resposta-curta' });

  // D5: a origem da sessão, antes de qualquer gravação. A palavra do dono não prova nada sozinha.
  const origem = origemDoDono(raiz, entrada, amb);
  if (!origem.ok) {
    const presenca = amb.env.CLAUDE_CODE_SESSION_ATTENDED === '1';
    return decisao({ acao: 'recusada', motivo: origem.motivo, presenca,
      mensagem: `O Orkastery não registrou "${texto.slice(0, 40)}" para a pergunta ${pergunta.codigo}: ${MOTIVOS[origem.motivo] ?? origem.motivo}. ` +
        'Responda pelo Telegram ou pelo diálogo do host.' });
  }
  const atestado: AtestadoDoTerminal = { ...origem.atestado, recebidoEm: quando };
  const d = responderPerguntaDoArco(raiz, pergunta, trecho, { quando, canal: 'terminal',
    provar: r => ({ via: 'terminal', atestado, pergunta: { ...r, respostaSha256: sha(entrada.prompt) } }) });
  return decisaoDoDesfecho(pergunta, d);
}

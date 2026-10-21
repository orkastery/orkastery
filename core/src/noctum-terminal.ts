/**
 * RM-057 (resposta curta, D5 e D6 da ork-rm057respost): o ingresso do terminal do Claude Code.
 *
 * O dono decidiu que aprova onde estiver. No terminal do Claude Code, o hook `UserPromptSubmit` do plugin do `ork` leva
 * ao núcleo o que ele digitou numa sessão interativa; quando o texto é uma resposta curta a uma pergunta do arco #Noctum,
 * o núcleo confere a ORIGEM do prompt e da sessão, nunca o texto, e grava o ato com o recibo.
 *
 * A origem (D5; GO-FIX 1, achados 1 e 5), conferida nesta ordem, cada passo com o motivo tipado de quando falha:
 *  - prompt digitado: o evento diz quem escreveu o prompt (`source`), e só `user`, o compositor interativo, vale. A tarefa
 *    agendada, a volta do `/loop`, a mensagem de canal ou de outra sessão, o SDK e o evento de sondagem são recusados, e o
 *    evento sem o campo também: sem como provar que o dono digitou, nada é gravado;
 *  - presença: o Claude Code marca os filhos de uma sessão com `CLAUDE_CODE_SESSION_ATTENDED=1` só quando há alguém
 *    nela; em segundo plano, em `daemon` e na execução por `-p` aninhada, vale `0`;
 *  - id: o `CLAUDE_CODE_SESSION_ID` do ambiente é o `session_id` do evento;
 *  - sem despacho: nem a identidade de despacho do `ork` (`ORK_DISPATCH_ID`, `ORK_DISPATCH_THREAD`) nem a pasta de job
 *    de segundo plano (`CLAUDE_JOB_DIR`) no ambiente;
 *  - ponto de entrada: não é o do SDK (`sdk-*`);
 *  - registro: o id não é de sessão que o `ork` despachou ou adotou em thread nenhuma deste projeto;
 *  - worktree: o `cwd` não está em worktree de thread;
 *  - ancestralidade (Linux, pelo `/proc`): a sessão do Claude Code (`CLAUDE_PID`) é ancestral deste processo, e TODO
 *    processo entre este e ela nasceu com o ambiente que o Claude Code dá ao hook dela: o mesmo id de sessão, o mesmo
 *    `CLAUDE_PID`, a presença e nenhuma marca `AI_AGENT`, que o Claude Code põe no shell das ferramentas do agente e não
 *    no hook. O ambiente de quando cada ancestral nasceu não se reescreve de baixo. O ambiente da sessão não é de segundo
 *    plano (`CLAUDE_CODE_SESSION_KIND`) e nenhuma outra sessão do Claude Code está acima dela. Sem `/proc`, nada é gravado.
 *
 * O limite que sobra, dito como o do diálogo nativo (A21 e NP14): a fronteira é a conta do sistema. Um processo do mesmo
 * usuário que abra uma sessão interativa nova do Claude Code fora da árvore de processos do agente (com `setsid` e um
 * terminal virtual, por exemplo) e digite nela passa, porque o núcleo e os agentes dividem a conta; o agente pela
 * ferramenta Bash da própria sessão, não. Separar de verdade é rodar os agentes em outra conta ou sandbox.
 *
 * A pergunta (D6; GO-FIX 1, achado 3): o código digitado ("K7QX a") vale sempre que a origem prova o dono. A palavra
 * solta, a letra e o número com a letra só valem logo depois da pergunta mostrada: a última linha da última mensagem do
 * assistente, que é a última coisa da transcrição, traz o código dela (saída de ferramenta não conta). Só a alternativa
 * "a" age por esse caminho: "b", "c", "não" e o resto seguem ao modelo, sem efeito, e nunca são engolidos. A pergunta já
 * respondida, a que já ouviu "b" ou "c" e a que mudou (a proposta trocada) não aceitam a palavra solta: a primeira e a
 * segunda deixam o prompt seguir ao modelo, e a terceira volta dizendo a pergunta de agora. A resposta a um gate não é
 * gravada aqui (D1): ela vai ao condutor como contexto, para ele abrir o diálogo nativo, só com a origem provada.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { lerTrecho, TrechoLivre } from './hitl-texto-livre';
import { exigirManifesto } from './manifest';
import { AtestadoDoTerminal, PerguntaNoLog } from './noctum-arco';
import { DesfechoDaRespostaAoArco, perguntasComRespostaSemEfeito, perguntasPorCodigo, responderPerguntaDoArco,
  rotuloDaPergunta } from './noctum-resposta';
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
  /**
   * GO-FIX 1 (achado 1): quem escreveu o prompt, no esquema do evento: `user` (o compositor interativo), `sdk`, `system`
   * (canal, outra sessão, aviso de tarefa), `loop_wakeup`, `schedule_wakeup` ou `poll_event`. O Claude Code ainda está
   * liberando o campo: sem ele, o terminal não grava.
   */
  source?: string;
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
/** O código curto como palavra inteira, em maiúsculas: hash e identificador em minúsculas nunca casam. */
const CODIGO_NA_LINHA = /(?<![A-Za-z0-9])(?=[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{0,2}[2-9])[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{3}(?![A-Za-z0-9])/g;
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

/**
 * GO-FIX 1 (achado 3): os códigos que o dono viu por último. A última entrada da conversa principal na transcrição (sem a
 * de subagente e sem os registros que não são mensagem) tem de ser uma mensagem do assistente com texto, e os códigos são
 * os da última linha desse texto (cerca de código não conta como linha). Se a última entrada é o resultado de uma
 * ferramenta, um prompt (do dono ou injetado) ou uma mensagem sem texto, nada foi mostrado por último: a lista vem vazia.
 */
export function codigosMostradosPorUltimo(fim: string | null): string[] {
  if (fim === null) return [];
  const linhas = fim.split('\n');
  for (let i = linhas.length - 1; i >= 0; i--) {
    let e: unknown;
    try { e = JSON.parse(linhas[i]); } catch { continue; }
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const entrada = e as { type?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
    if ((entrada.type !== 'assistant' && entrada.type !== 'user') || entrada.isSidechain === true) continue;
    if (entrada.type === 'user') return [];
    const blocos = Array.isArray(entrada.message?.content) ? entrada.message!.content as unknown[] : [];
    const texto = blocos.filter((b): b is { type: 'text'; text: string } => !!b && typeof b === 'object' &&
      (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string').map(b => b.text).join('\n');
    const ultima = texto.split('\n').map(l => l.trim()).filter(l => l && !/^(```|~~~)/.test(l)).at(-1) ?? '';
    return [...new Set(ultima.match(CODIGO_NA_LINHA) ?? [])];
  }
  return [];
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
  'noctum.terminal.origem-do-prompt-desconhecida': 'o evento do Claude Code não diz que foi você quem digitou (sem o campo source, o terminal não grava)',
  'noctum.terminal.prompt-injetado': 'o prompt não foi digitado por você (veio de tarefa agendada, /loop, canal, outra sessão ou programa)',
  'noctum.terminal.sem-presenca': 'a sessão não tem alguém presente (segundo plano ou execução por programa)',
  'noctum.terminal.sessao-divergente': 'o id da sessão do evento não é o do ambiente',
  'noctum.terminal.sessao-despachada': 'a sessão foi despachada pelo ork ou roda como job de segundo plano',
  'noctum.terminal.sessao-programatica': 'a sessão é do SDK, não do terminal',
  'noctum.terminal.sessao-do-ork': 'a sessão foi despachada ou adotada pelo ork numa thread',
  'noctum.terminal.worktree-de-thread': 'a sessão roda numa worktree de thread',
  'noctum.terminal.sem-cadeia': 'a cadeia de processos não se lê nesta plataforma',
  'noctum.terminal.ancestral-divergente': 'a sessão do Claude Code não é ancestral deste processo',
  'noctum.terminal.ancestral-ilegivel': 'o ambiente de um processo da cadeia não se lê',
  'noctum.terminal.cadeia-fora-do-hook': 'um processo entre este e a sessão não nasceu do hook dela',
  'noctum.terminal.cadeia-do-agente': 'a chamada saiu de uma ferramenta do agente, não do hook',
  'noctum.terminal.sessao-em-segundo-plano': 'a sessão do Claude Code roda em segundo plano',
  'noctum.terminal.sessao-aninhada': 'a sessão está aninhada em outra sessão do Claude Code',
});

/**
 * D5: a origem do prompt e da sessão, nesta ordem. Devolve as conferências que passaram, para o recibo, ou o primeiro
 * motivo que falhou. Nada aqui lê o texto do dono.
 */
export function origemDoDono(raiz: string, entrada: EntradaDoHook, amb: AmbienteDoTerminal):
  { ok: true; atestado: Omit<AtestadoDoTerminal, 'recebidoEm'> } | { ok: false; motivo: string } {
  const env = amb.env, conferencias: string[] = [];
  const falha = (motivo: string) => ({ ok: false as const, motivo });
  // GO-FIX 1 (achado 1): o prompt que a máquina injeta na sessão do dono não é o dono, e sem o campo não há como provar.
  if (entrada.source === undefined) return falha('noctum.terminal.origem-do-prompt-desconhecida');
  if (entrada.source !== 'user') return falha('noctum.terminal.prompt-injetado');
  conferencias.push('prompt-digitado');
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
  // GO-FIX 1 (achado 5): `CLAUDE_PID` não vale de qualquer ancestral. Cada processo entre este e a sessão tem de ter nascido
  // do hook dela, e o agente não reescreve o ambiente de um ancestral que já está de pé.
  const cadeia = (amb.ancestrais ?? ancestraisPeloProc)();
  if (cadeia === null) return falha('noctum.terminal.sem-cadeia');
  const claudePid = Number(env.CLAUDE_PID);
  const i = Number.isInteger(claudePid) && claudePid > 1 ? cadeia.findIndex(a => a.pid === claudePid) : -1;
  if (i < 1) return falha('noctum.terminal.ancestral-divergente');
  for (const a of cadeia.slice(0, i)) {
    if (!a.ambiente) return falha('noctum.terminal.ancestral-ilegivel');
    if (a.ambiente.CLAUDE_CODE_SESSION_ID !== entrada.session_id || a.ambiente.CLAUDE_PID !== String(claudePid) ||
        a.ambiente.CLAUDE_CODE_SESSION_ATTENDED !== '1') return falha('noctum.terminal.cadeia-fora-do-hook');
    if (Object.prototype.hasOwnProperty.call(a.ambiente, 'AI_AGENT')) return falha('noctum.terminal.cadeia-do-agente');
  }
  const sessao = cadeia[i];
  if (!sessao.ambiente) return falha('noctum.terminal.ancestral-ilegivel');
  if (KINDS_DE_FUNDO.includes(sessao.ambiente.CLAUDE_CODE_SESSION_KIND ?? '')) return falha('noctum.terminal.sessao-em-segundo-plano');
  if (cadeia.slice(i + 1).some(a => a.ambiente?.CLAUDECODE === '1')) return falha('noctum.terminal.sessao-aninhada');
  conferencias.push('ancestralidade');
  const entrypoint = typeof env.CLAUDE_CODE_ENTRYPOINT === 'string' && env.CLAUDE_CODE_ENTRYPOINT ? env.CLAUDE_CODE_ENTRYPOINT.slice(0, 64) : null;
  return { ok: true, atestado: { host: 'claude-code', sessao: entrada.session_id, entrypoint, conferencias } };
}

/** A entrada do hook, ou `null` quando ela não tem a forma do `UserPromptSubmit`. */
export function lerEntradaDoHook(v: unknown): EntradaDoHook | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (e.hook_event_name !== 'UserPromptSubmit' || typeof e.session_id !== 'string' || !ID_DE_SESSAO.test(e.session_id) ||
      typeof e.cwd !== 'string' || !path.isAbsolute(e.cwd) || typeof e.prompt !== 'string' ||
      (e.transcript_path !== undefined && typeof e.transcript_path !== 'string') ||
      (e.source !== undefined && (typeof e.source !== 'string' || !/^[a-z_]{1,40}$/.test(e.source)))) return null;
  return { session_id: e.session_id, cwd: e.cwd, hook_event_name: e.hook_event_name, prompt: e.prompt,
    ...(typeof e.transcript_path === 'string' ? { transcript_path: e.transcript_path } : {}),
    ...(typeof e.source === 'string' ? { source: e.source } : {}) };
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

/** A palavra solta, a letra ou o número com a letra que diz "a": só ela age sem o código (GO-FIX 1, achado 3). */
function dizA(trecho: TrechoLivre): boolean {
  return (trecho.tipo === 'letra' && trecho.letra === 'a') || (trecho.tipo === 'intencao' && trecho.intencao === 'afirmar');
}

/** O alvo da resposta antes da origem: nada, o que dizer de volta, o gate a encaminhar ou a pergunta do arco com a escolha. */
type Alvo =
  | { tipo: 'nada'; motivo: string }
  | { tipo: 'pergunta-de-volta'; mensagem: string }
  | { tipo: 'gate'; contexto: string }
  | { tipo: 'arco'; pergunta: PerguntaNoLog; trecho: TrechoLivre };

/**
 * GO-FIX 1 (achado 3): a palavra solta e o número com a letra só valem para a pergunta que o dono viu por último, e só
 * para dizer "a". Respondida, já com "b" ou "c", ou sem estar na última linha mostrada: o prompt segue ao modelo.
 */
function alvoMostradoPorUltimo(raiz: string, entrada: EntradaDoHook, amb: AmbienteDoTerminal, quando: string, trecho: TrechoLivre,
  numero: number | null): Alvo {
  const fim = entrada.transcript_path ? (amb.transcricao ?? fimDaTranscricao)(entrada.transcript_path) : null;
  const doArco = codigosMostradosPorUltimo(fim).flatMap(c => perguntasPorCodigo(raiz, c, quando));
  if (!doArco.length) return { tipo: 'nada', motivo: 'nenhuma-pergunta-mostrada-por-ultimo' };
  if (doArco.length > 1) {
    return { tipo: 'pergunta-de-volta', mensagem: `A última mensagem mostra ${doArco.length} perguntas do arco, e "${entrada.prompt.trim().slice(0, 40)}" ` +
      `não diz qual; nada foi registrado. Responda pelo código: ${doArco.map(rotuloDaPergunta).join('; ')}.` };
  }
  const [p] = doArco;
  if (numero !== null) {
    let servida: PerguntaServida | undefined;
    try { servida = lerLoteServido(raiz, amb.estadoDir).perguntas.find(q => q.numero === numero); } catch { servida = undefined; }
    if (servida?.arco?.codigo !== p.codigo) return { tipo: 'nada', motivo: 'numero-de-outra-pergunta' };
  }
  if (!dizA(trecho)) return { tipo: 'nada', motivo: 'nao-diz-a' };
  if (p.situacao === 'respondida') return { tipo: 'nada', motivo: 'pergunta-ja-respondida' };
  const semEfeito = perguntasComRespostaSemEfeito(raiz);
  if (semEfeito === null || semEfeito.has(p.codigo)) return { tipo: 'nada', motivo: 'pergunta-ja-ouviu-b-ou-c' };
  return { tipo: 'arco', pergunta: p, trecho };
}

/**
 * O ingresso do terminal: lê o evento do hook, reconhece só a resposta curta, acha a pergunta (o código, ou a mostrada por
 * último para a palavra solta e o número), confere a origem (D5) e responde pela via do terminal. Nunca adivinha.
 */
export function responderPeloTerminal(raiz: string | null, bruto: unknown, amb: AmbienteDoTerminal): DecisaoDoTerminal {
  const quando = amb.quando ?? new Date().toISOString();
  const entrada = lerEntradaDoHook(bruto);
  if (!entrada) return decisao({ acao: 'ignorar', motivo: 'entrada' });
  const texto = entrada.prompt.trim();
  // Uma linha só, conferida no prompt cru: a mensagem que a máquina embrulha (outra sessão, canal) vem em várias linhas, e
  // nem a quebra no fim passa.
  if (!texto || texto.length > TETO_DO_PROMPT || /[\r\n]/.test(entrada.prompt)) return decisao({ acao: 'ignorar', motivo: 'nao-e-resposta-curta' });
  const lido = interpretarRespostaDoPulse(texto);
  if (!['consentimento', 'lote', 'livre'].includes(lido.forma) || (lido.forma === 'lote' && lido.escolhas.length !== 1)) {
    return decisao({ acao: 'ignorar', motivo: 'nao-e-resposta-curta' });
  }
  if (raiz === null) return decisao({ acao: 'ignorar', motivo: 'sem-projeto' });

  // O alvo: pelo código digitado, ou pela pergunta mostrada por último (a palavra solta e o número com a letra).
  let alvo: Alvo;
  if (lido.forma === 'consentimento') {
    const doArco = perguntasPorCodigo(raiz, lido.codigo, quando);
    const gates = pedidosComCodigo(raiz, lido.codigo);
    const resto = restoDoCodigo(texto, lido.codigo);
    const trecho = lerTrecho(resto) ?? (resto === '?' ? lerTrecho('detalhes') : null);
    alvo = doArco.length + gates.length > 1
      ? { tipo: 'pergunta-de-volta', mensagem: `O código ${lido.codigo} está em mais de uma pergunta; nada foi registrado. Responda pelo número da pergunta.` }
      : gates.length === 1 ? { tipo: 'gate', contexto: contextoDoGate(lido.codigo, gates[0].thread, gates[0].pedido.id, texto) }
        : !doArco.length ? { tipo: 'nada', motivo: 'codigo-desconhecido' }
          : !trecho ? { tipo: 'pergunta-de-volta', mensagem: `Não entendi "${resto.slice(0, 40)}" para ${doArco[0].codigo}; nada foi registrado. Responda a, b ou c.` }
            : { tipo: 'arco', pergunta: doArco[0], trecho };
  } else if (lido.forma === 'lote') {
    const { numero, letra } = lido.escolhas[0];
    alvo = alvoMostradoPorUltimo(raiz, entrada, amb, quando, { tipo: 'letra', letra }, numero);
  } else {
    alvo = lido.forma === 'livre' ? alvoMostradoPorUltimo(raiz, entrada, amb, quando, lido.trecho, null)
      : { tipo: 'nada', motivo: 'nao-e-resposta-curta' };
  }
  if (alvo.tipo === 'nada') return decisao({ acao: 'ignorar', motivo: alvo.motivo });

  // D5: a origem do prompt e da sessão, antes de qualquer gravação ou encaminhamento. A palavra do dono não prova nada.
  const origem = origemDoDono(raiz, entrada, amb);
  if (!origem.ok) {
    const presenca = amb.env.CLAUDE_CODE_SESSION_ATTENDED === '1';
    const sobre = alvo.tipo === 'arco' ? ` para a pergunta ${alvo.pergunta.codigo}` : '';
    return decisao({ acao: 'recusada', motivo: origem.motivo, presenca,
      mensagem: `O Orkastery não registrou "${texto.slice(0, 40)}"${sobre}: ${MOTIVOS[origem.motivo] ?? origem.motivo}. ` +
        'Responda pelo Telegram ou pelo diálogo do host.' });
  }
  if (alvo.tipo === 'pergunta-de-volta') return decisao({ acao: 'pergunta', mensagem: alvo.mensagem });
  if (alvo.tipo === 'gate') return decisao({ acao: 'encaminhar', contexto: alvo.contexto });
  const atestado: AtestadoDoTerminal = { ...origem.atestado, recebidoEm: quando };
  const pergunta = alvo.pergunta;
  const d = responderPerguntaDoArco(raiz, pergunta, alvo.trecho, { quando, canal: 'terminal',
    provar: r => ({ via: 'terminal', atestado, pergunta: { ...r, respostaSha256: sha(entrada.prompt) } }) });
  return decisaoDoDesfecho(pergunta, d);
}

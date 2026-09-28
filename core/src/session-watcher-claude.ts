/**
 * I-34: conclusão de sessões claude-bg. O turno termina pelo Stop ingerido dos hooks do plugin,
 * correlacionado ao despacho; o `done` do `claude agents --json --all` é a leitura que o Claude
 * Code faz do texto final do agente (D12), então é condição necessária e nunca suficiente: a
 * fase só conclui com prova gravada pelo próprio `ork` no intervalo do despacho. Silêncio, Stop
 * isolado e encerramento externo não provam conclusão; lacuna vira motivo tipado já existente.
 * O lock, a pasta de sensores e o processo destacado continuam no `session-watcher`; este
 * módulo não o importa, para não criar ciclo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ambienteDoPerfil, consultarAgentesNativos, ConsultaAgentesNativos, parseFalhaDeConta, RegistroAgenteClaude } from './adapters/claude-bg';
import { ManifestoCarregado } from './manifest';
import { marcarContaDaFalha } from './ratelimit';
import { diretorioEfetivo, PerfilDeDespacho, perfilDoRegistro } from './runtime-profiles';
import { estadoProcesso, gravarAtomico, identidadeProcesso, IdentidadeProcesso } from './adapters/codex-runner';
import { comLockDeSessao, SessaoDespachada } from './session-events';
import { lerLedger, registrarSeExiste, threadPresente } from './ledger';
import { dirThread, pausaNaThread } from './thread';
import { EventoLedger, MotivoGate, SinalDeFalhaDeConta, Thread } from './types';
import { exec } from './util';
import { redigirSegredos } from './hitl';

/** Uma consulta nativa custa cerca de 0,3 s; cinco segundos mantém o custo abaixo de 10%. */
export const INTERVALO_WATCH_CLAUDE_MS = 5000;
const LIMITE_EVIDENCIA_BYTES = 4096;
/** D15 (5): teto dos textos nativos (`state`, `status`, `id`, `kind`) e do erro do diagnóstico. */
const LIMITE_TEXTO_NATIVO = 64;
const LIMITE_ERRO_DIAGNOSTICO = 512;
const LIMITE_PLANO_BYTES = 1024 * 1024;
const ARQUIVO_PLANO = 'docs/plan.md';
/** D12: artefato de cada fase que entrega documento; sem ele o PLAN mantém `artifact.missing` (D2). */
export const ARTEFATO_DA_FASE: Readonly<Partial<Record<string, string>>> =
  { GOAL: 'docs/goal.md', PLAN: ARQUIVO_PLANO, CHECK: 'docs/check.md' };
const SHA_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
/** Motivo de encerramento quando a thread some do disco durante a observação (achado 1). */
export const THREAD_REMOVIDA = 'thread removida do disco; observação encerrada sem recriar a pasta';

/** Variante nativa do `session_sensor_registered`: nenhuma fonte em arquivo, só o cwd do despacho. */
export interface FonteClaude {
  nativo: 'claude-agents';
  cwd: string;
  /** GOAL, PLAN e CHECK: sha do artefato da fase no instante do registro (D12). */
  artefato?: { arquivo: string; sha256: string | null };
  /** GO: HEAD da worktree no instante do registro (D16); `null` quando o cwd não tem git legível. */
  head?: string | null;
  origem?: string;
}

export interface CursorClaude {
  schema: 'ork.session-cursor-claude/v1'; sessionId: string; despachoEm: string;
  ausenteDesde?: number; doneDesde?: number; mortoDesde?: number; desconhecidoDesde?: number; consultaFalhaDesde?: number;
  pid?: number; identidade?: IdentidadeProcesso | null;
}

export type ClassificacaoClaude =
  /** `inconclusivo`: passou o limite sem prova para concluir nem para bloquear; o observador encerra sem gate. */
  | { terminal: false; espera: string; stop: EventoLedger | null; inconclusivo?: boolean }
  | { terminal: true; classificacao: 'fase_concluida' | 'gate_blocked'; motivo: MotivoGate | null;
      fonte: string; conclusaoNativa: boolean; stop: EventoLedger | null;
      /** A decisão veio do Stop correlacionado: reconferida sob o lock antes de gravar. */
      dependeDoStop?: boolean;
      /** D18: por que o turno encerrado não virou conclusão (falta de prova, ou `failed` depois do Stop). */
      diagnostico?: string };
type TerminalClaude = Extract<ClassificacaoClaude, { terminal: true }>;

export interface EntradaClassificacao {
  sessao: Pick<SessaoDespachada, 'sessionId' | 'fase' | 'despachadaEm'>;
  eventos: readonly EventoLedger[];
  consulta: ConsultaAgentesNativos;
  registro: RegistroAgenteClaude | null;
  cursor: CursorClaude;
  agoraMs: number;
  /** Prazo de estabilidade para ausência, `done` sem Stop e estado desconhecido. */
  limiteMs: number;
  pausaAoFim: boolean;
  /** D12: prova do lado do `ork`, avaliada só quando os sinais nativos já dizem que o turno terminou. */
  prova: () => ProvaOrk;
  /** Prova de vida do processo nativo; `ausente` só com evidência de morte. */
  processo: (pid: number | undefined, cursor: CursorClaude) => 'vivo' | 'ausente';
}

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * D15 (5): texto vindo do `claude agents` ou derivado dele entra no ledger sem caracteres de
 * controle e com teto em caracteres, sem partir par substituto. Não string ou vazio vira `null`.
 * A classificação continua comparando o valor exato; isto vale só para o que é gravado.
 */
export function normalizarNativo(v: unknown, limite = LIMITE_TEXTO_NATIVO): string | null {
  if (typeof v !== 'string') return null;
  const limpo = Array.from(v.replace(/\p{Cc}/gu, '').trim()).slice(0, limite).join('');
  return limpo === '' ? null : limpo;
}

/** D12: prova do lado do `ork` no intervalo do despacho. `done` nativo é necessário, nunca suficiente. */
export interface ProvaOrk {
  ok: boolean;
  /** Diagnóstico curto: o que provou ou o que faltou. */
  fonte: string;
  /** Sem prova: `artifact.missing` só no PLAN (D2); nas demais fases, `human.pending`. */
  motivo?: 'artifact.missing' | 'human.pending';
  veredito?: string | null;
  verify?: { eventId: string; commit: string; ts: string } | null;
  /** GO (D16): SHAs conferidos no git da worktree; `recusados`, os registrados que não conferiram. */
  commits?: string[];
  recusados?: string[];
  worktreeLimpa?: boolean;
  evento?: { tipo: string; eventId: string; ts: string };
}

/**
 * Atividade que supera um Stop. A notificação de ociosidade não é atividade, e o SubagentStop
 * também não: ele marca o fim de um subagente (medido na sessão b8fa6f86 da i32, 2 s depois do
 * Stop). Se o agente principal retomar, vêm heartbeats e o estado nativo deixa de ser `done`.
 */
function atividade(e: EventoLedger): boolean {
  if (e.tipo === 'runtime_event') return !(e.sensor === 'notification' && e.notificationType === 'idle_prompt');
  return ['commit', 'sessao_bloqueada', 'runtime_stop'].includes(e.tipo);
}

/** Último Stop do despacho, emitido pelos hooks, sem atividade posterior. */
export function stopCorrelacionado(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'fase' | 'despachadaEm'>): EventoLedger | null {
  const inicio = Date.parse(sessao.despachadaEm);
  if (!Number.isFinite(inicio)) return null;
  const correlacionados = eventos.filter(e => e.sessionId === sessao.sessionId && e.despachoEm === sessao.despachadaEm &&
    e.fase === sessao.fase && e.runtime === 'claude-bg' && Number.isFinite(Date.parse(e.ts)) && Date.parse(e.ts) >= inicio);
  let ultimo = -1;
  correlacionados.forEach((e, i) => {
    if (e.tipo === 'runtime_stop' && e.sensor === 'stop' && e.fonte === 'ork sessions event' &&
        typeof e.sensorEventId === 'string' && SHA256.test(e.sensorEventId)) ultimo = i;
  });
  if (ultimo < 0 || correlacionados.slice(ultimo + 1).some(atividade)) return null;
  return correlacionados[ultimo];
}

/**
 * O último entre bloqueio, destravamento e Stop da sessão, depois do despacho, é bloqueio?
 * O Stop resolve o bloqueio anterior: o turno só termina depois que o prompt de permissão
 * foi respondido (aprovado ou negado), e o estado nativo `done` confirma que não há espera.
 */
export function bloqueioPendente(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'despachadaEm'>): boolean {
  const inicio = Date.parse(sessao.despachadaEm);
  const ultimo = eventos.filter(e => e.sessionId === sessao.sessionId &&
    ['sessao_bloqueada', 'sessao_destravada', 'runtime_stop'].includes(e.tipo) && !(Date.parse(e.ts) < inicio)).at(-1);
  return ultimo?.tipo === 'sessao_bloqueada';
}

/**
 * D2: tabela de classificação. Pura sobre as entradas, exceto o cursor, que carrega os
 * instantes de primeira observação entre chamadas. Sem cursor persistido (leitura única do
 * MCP), os prazos nunca vencem e só as classificações imediatas aparecem.
 */
export function classificarSessaoClaude(e: EntradaClassificacao): ClassificacaoClaude {
  const { cursor, agoraMs: agora } = e;
  const stop = stopCorrelacionado(e.eventos, e.sessao);
  const espera = (motivo: string): ClassificacaoClaude => ({ terminal: false, espera: motivo, stop });
  const bloqueio = (fonte: string, motivo: MotivoGate = 'runtime.unavailable', conclusaoNativa = false): TerminalClaude =>
    ({ terminal: true, classificacao: 'gate_blocked', motivo, fonte, conclusaoNativa, stop });
  // D12: o `done` classifica o texto final do agente; a fase só conclui com a prova do `ork`.
  const concluir = (sinal: string, conclusaoNativa: boolean): ClassificacaoClaude => {
    const prova = e.prova();
    const c: TerminalClaude = !prova.ok
      ? { ...bloqueio(`${sinal}; sem prova do ork: ${prova.fonte}`, prova.motivo ?? 'human.pending', conclusaoNativa),
          diagnostico: `sem prova do ork: ${prova.fonte}` }
      : e.pausaAoFim ? bloqueio(`${sinal}; ${prova.fonte}; pausa prevista ao fim do bloco`, 'human.pending', conclusaoNativa)
      : { terminal: true, classificacao: 'fase_concluida', motivo: null, fonte: `${sinal}; ${prova.fonte}`, conclusaoNativa, stop };
    return { ...c, dependeDoStop: true };
  };
  const venceu = (desde: number) => agora - desde >= e.limiteMs;
  // Sem prova para concluir nem para bloquear: `runtime.unavailable` reexecutaria o mesmo prompt
  // sobre uma fase que pode ter terminado. O observador encerra sem gate e o radar de liveness
  // decide com o humano (`done` não é terminal de retry automático).
  const inconclusivo = (motivo: string, desde: number): ClassificacaoClaude => venceu(desde)
    ? { terminal: false, espera: `${motivo} além do limite de estabilidade; conclusão não inferida`, stop, inconclusivo: true }
    : espera(motivo);
  if (!e.consulta.ok) {
    cursor.consultaFalhaDesde ??= agora;
    return inconclusivo(`consulta nativa indisponível: ${e.consulta.detalhe}`, cursor.consultaFalhaDesde);
  }
  delete cursor.consultaFalhaDesde;
  const r = e.registro;
  if (!r) {
    cursor.ausenteDesde ??= agora;
    return venceu(cursor.ausenteDesde) ? bloqueio('sessão ausente do claude agents além do limite de estabilidade')
      : espera('sessão ausente da consulta nativa');
  }
  delete cursor.ausenteDesde;
  // Sinônimos que o `ork_observe` já tratava como trabalho.
  const estado = r.state === 'running' || r.state === 'busy' ? 'working' : r.state;
  if (estado !== 'done') delete cursor.doneDesde;
  if (estado !== 'working' && estado !== 'blocked') delete cursor.mortoDesde;
  if (['done', 'failed', 'stopped', 'working', 'blocked'].includes(estado ?? '')) delete cursor.desconhecidoDesde;
  switch (estado) {
    case 'done': {
      const pendente = bloqueioPendente(e.eventos, e.sessao);
      if (stop && !pendente) return concluir('terminal nativo done com Stop correlacionado', true);
      const falta = stop ? 'terminal nativo done com sessao_bloqueada pendente' : 'terminal nativo done sem Stop correlacionado';
      cursor.doneDesde ??= agora;
      return inconclusivo(falta, cursor.doneDesde);
    }
    // D17: depois de um Stop correlacionado, nem `failed` nem `stopped` reexecutam a fase, que pode
    // ter terminado sobre a worktree já alterada. `stopped` segue a prova, como o processo morto
    // (D13); `failed` não conclui nem reexecuta: o humano decide. Sem Stop, falha de execução.
    case 'failed':
      if (stop) return { ...bloqueio('terminal nativo failed depois de Stop correlacionado; a sessão falhou depois de ' +
        'encerrar o turno e o humano decide', 'human.pending'), dependeDoStop: true,
        diagnostico: 'a sessão falhou (failed) depois de encerrar o turno; conclusão não provada' };
      return bloqueio('terminal nativo failed sem Stop correlacionado');
    case 'stopped':
      if (stop) return concluir('Stop correlacionado e sessão encerrada externamente (stopped) sem done', false);
      return bloqueio('sessão encerrada externamente (stopped) sem terminal done nem Stop correlacionado');
    case 'working':
    case 'blocked': {
      if (e.processo(r.pid, cursor) === 'ausente') {
        cursor.mortoDesde ??= agora;
        if (agora - cursor.mortoDesde < INTERVALO_WATCH_CLAUDE_MS) return espera('processo sem prova de vida; aguardando a segunda observação');
        // D13: turno encerrado pelo Stop e processo morto não é falha de infraestrutura. Reexecutar
        // redespacharia uma fase que pode ter terminado sobre a worktree já alterada: vale a prova (D12).
        if (stop) return concluir(`Stop correlacionado e processo encerrado sem done (estado ${estado})`, false);
        return bloqueio(`processo da sessão morreu sem terminal nativo nem Stop correlacionado (estado ${estado})`);
      }
      delete cursor.mortoDesde;
      return espera(estado === 'blocked' ? 'sessão bloqueada à espera humana' : 'sessão trabalhando');
    }
    default:
      cursor.desconhecidoDesde ??= agora;
      return inconclusivo(`estado nativo desconhecido (${normalizarNativo(estado) ?? 'ausente'})`, cursor.desconhecidoDesde);
  }
}

const LIMITE_CAUDA_TRANSCRICAO = 65536;

/**
 * I-33 (N4): o texto de um erro de API da transcricao e o codigo do erro e o texto que o Claude Code
 * mostrou (`message.content[].text`), com segredos redigidos. Os metadados do `message` (id, modelo,
 * `stop_*`, uso) ficam fora: sem eles, o trecho gravado no ledger e a frase que classificou.
 */
function textoDoErroDeApi(e: Record<string, unknown>): string {
  const m = e.message as { content?: unknown } | string | null | undefined;
  const conteudo = typeof m === 'string' ? m : m && typeof m === 'object' ? m.content : undefined;
  const textos = typeof conteudo === 'string' ? [conteudo] : Array.isArray(conteudo)
    ? conteudo.map(c => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
    : [];
  const codigo = typeof e.error === 'string' ? e.error : '';
  return redigirSegredos([codigo, textos.filter(Boolean).join(' ')].filter(Boolean).join(': ')).slice(0, 4096);
}

/**
 * I-33 (D11b): falha de conta registrada pelo proprio Claude Code na transcricao da sessao, no
 * diretorio do perfil (ou no implicito, sem perfil). So entram linhas marcadas como erro de API
 * (`isApiErrorMessage` ou campo `error`): texto do agente nunca vira motivo. Leitura limitada
 * da cauda, sem seguir link; ausencia de transcricao e ausencia de evidencia. Vale o ULTIMO erro de API
 * (N3), o que encerrou a sessao. O codigo `rate_limit`
 * do Claude Code cobre tanto o limite do plano quanto o 429 transitorio ("Request rejected (429)",
 * "not your usage limit"): quem separa e o criterio unico da D16 (`naturezaDoLimite`), pela frase.
 */
export function falhaDeContaDaTranscricao(perfil: PerfilDeDespacho | null, cwd: string, sessionId: string,
  agoraMs = Date.now()): SinalDeFalhaDeConta | null {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const arquivo = path.join(diretorioEfetivo('claude-bg', perfil), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-'),
    `${sessionId}.jsonl`);
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch { return null; }
  let cauda: string;
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    const n = Math.min(st.size, LIMITE_CAUDA_TRANSCRICAO), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, st.size - n);
    cauda = buf.toString('utf8');
  } finally { fs.closeSync(fd); }
  const erros: string[] = [];
  for (const linha of cauda.split('\n')) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(linha); } catch { continue; }
    if (!e || typeof e !== 'object' || (e.isApiErrorMessage !== true && e.error === undefined)) continue;
    erros.push(textoDoErroDeApi(e));
  }
  if (!erros.length) return null;
  // I-33 (N3): o criterio roda sobre o erro que encerrou a sessao (o ultimo erro de API), nunca sobre os
  // anteriores juntos: um 429 transitorio do meio nao esconde o limite que matou a sessao, e um
  // esgotamento ja superado nao tira o perfil do rodizio por causa de um 429 transitorio no fim.
  return parseFalhaDeConta(erros[erros.length - 1], agoraMs);
}

/**
 * I-33 (D11): precedencia entre a prova da I-34 e a falha de conta. Com Stop correlacionado vale
 * a prova (a); sem Stop, `runtime.unavailable` cede ao motivo mais especifico quando a
 * transcricao traz a evidencia (b). Nenhum outro motivo e reclassificado.
 */
export function comFalhaDeConta(c: ClassificacaoClaude, evidencia: () => SinalDeFalhaDeConta | null):
    { c: ClassificacaoClaude; falha: SinalDeFalhaDeConta | null } {
  if (!c.terminal || c.stop || c.dependeDoStop || c.classificacao !== 'gate_blocked' || c.motivo !== 'runtime.unavailable')
    return { c, falha: null };
  const falha = evidencia();
  if (!falha) return { c, falha: null };
  return { c: { ...c, motivo: falha.motivo, fonte: `${c.fonte}; ${falha.motivo} na transcricao do perfil: ${falha.trecho}` }, falha };
}

/** Prova de vida pela identidade fixada na primeira observação do pid. */
export function processoNativo(pid: number | undefined, cursor: CursorClaude): 'vivo' | 'ausente' {
  if (pid === undefined) return 'ausente';
  if (cursor.pid !== pid || !cursor.identidade) { cursor.pid = pid; cursor.identidade = identidadeProcesso(pid); }
  if (cursor.identidade) return estadoProcesso(cursor.identidade) === 'ausente' ? 'ausente' : 'vivo';
  try { process.kill(pid, 0); return 'vivo'; }
  catch (erro) { return (erro as NodeJS.ErrnoException).code === 'ESRCH' ? 'ausente' : 'vivo'; }
}

/**
 * sha, mtime e texto de um artefato da thread, lido sem seguir link simbólico. Link, diretório,
 * arquivo vazio ou grande demais não são saída de fase: devolvem `invalido` em vez de lançar,
 * para o observador e o `ork_observe` classificarem a falta de prova sem morrer.
 */
export function estadoDoArtefato(raiz: string, threadId: string, arquivo: string):
    { sha256: string | null; mtimeMs: number | null; texto: string | null; invalido?: boolean } {
  const file = path.join(dirThread(raiz, threadId), arquivo);
  const vazio = { sha256: null, mtimeMs: null, texto: null };
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (erro) { return (erro as NodeJS.ErrnoException).code === 'ENOENT' ? vazio : { ...vazio, invalido: true }; }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > LIMITE_PLANO_BYTES) return { ...vazio, invalido: true };
    const bytes = Buffer.alloc(stat.size);
    fs.readSync(fd, bytes, 0, stat.size, 0);
    return { sha256: createHash('sha256').update(bytes).digest('hex'), mtimeMs: stat.mtimeMs, texto: bytes.toString('utf8') };
  } finally { fs.closeSync(fd); }
}

/**
 * Saída do artefato da fase (GOAL, PLAN, CHECK): sha diferente da base registrada no despacho;
 * sem base (fonte retroativa), arquivo com mtime não anterior ao despacho. D16 (nota P3): o
 * intervalo tem fim, e arquivo com mtime no próximo despacho ou depois é da sessão seguinte.
 * Outras fases: `null`.
 */
export function saidaDoArtefato(raiz: string, threadId: string, sessao: Pick<SessaoDespachada, 'sessionId' | 'fase' | 'despachadaEm'>,
    fonte: Pick<FonteClaude, 'artefato'> | undefined, eventos: readonly EventoLedger[]):
    { arquivo: string; produzido: boolean; sha256: string | null; sha256Base: string | null; texto: string | null } | null {
  const arquivo = ARTEFATO_DA_FASE[sessao.fase];
  if (!arquivo) return null;
  const atual = estadoDoArtefato(raiz, threadId, arquivo);
  const base = fonte?.artefato?.arquivo === arquivo ? fonte.artefato : undefined;
  const noIntervalo = atual.mtimeMs !== null && atual.mtimeMs < fimDoIntervalo(eventos, sessao);
  const produzido = atual.sha256 === null || !noIntervalo ? false : base ? atual.sha256 !== base.sha256
    : atual.mtimeMs !== null && atual.mtimeMs >= Date.parse(sessao.despachadaEm);
  return { arquivo, produzido, sha256: atual.sha256, sha256Base: base?.sha256 ?? null, texto: atual.texto };
}

/** Exatamente um veredito legível numa linha `Veredito: ...` (PASSOU, PRECISA DE MUDANCA ou BLOQUEADO). */
export function vereditoDoParecer(texto: string): string | null {
  const achados = new Set<string>();
  for (const linha of texto.split('\n')) {
    const m = /^[#>*_`\s-]*veredito[*_`\s]*:[*_`\s]*(passou|precisa de mudan[cç]a|bloqueado)(?![\p{L}\p{N}])/iu.exec(linha);
    if (m) achados.add(m[1].toUpperCase().replace('Ç', 'C'));
  }
  return achados.size === 1 ? [...achados][0] : null;
}

/** Fim do intervalo do despacho: o próximo `phase_dispatch` de outra sessão da thread, ou `Infinity`. */
export function fimDoIntervalo(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'despachadaEm'>): number {
  const inicio = Date.parse(sessao.despachadaEm);
  const proximo = eventos.find(e => e.tipo === 'phase_dispatch' && e.sessionId !== sessao.sessionId && Date.parse(e.ts) > inicio);
  return proximo ? Date.parse(proximo.ts) : Infinity;
}

/** Eventos do despacho: do `despachoEm` até o próximo `phase_dispatch` de outra sessão da thread. */
export function eventosDoIntervalo(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'despachadaEm'>): EventoLedger[] {
  const inicio = Date.parse(sessao.despachadaEm);
  if (!Number.isFinite(inicio)) return [];
  const fim = fimDoIntervalo(eventos, sessao);
  return eventos.filter(e => Date.parse(e.ts) >= inicio && Date.parse(e.ts) < fim);
}

/** D16: HEAD da worktree lido pelo `ork`; `null` quando o cwd não tem git legível. */
export function headDaWorktree(cwd: string): string | null {
  const r = exec('git', ['rev-parse', '--verify', 'HEAD^{commit}'], cwd, 30000);
  const sha = r.stdout.trim();
  return r.ok && SHA_COMMIT.test(sha) ? sha : null;
}

/**
 * D16: um SHA registrado só prova o GO se existir na worktree do despacho, estiver no HEAD atual
 * (ancestral ou igual) e não estiver no HEAD que a worktree tinha no despacho. O
 * `--is-ancestor` sai 0 (é ancestral ou igual), 1 (não é) ou outro código (erro): só 1 serve.
 */
export function commitConferido(cwd: string, sha: string, headNoDespacho: string): boolean {
  const git = (...args: string[]) => exec('git', args, cwd, 30000);
  if (!git('cat-file', '-e', `${sha}^{commit}`).ok) return false;
  if (!git('merge-base', '--is-ancestor', sha, 'HEAD').ok) return false;
  return git('merge-base', '--is-ancestor', sha, headNoDespacho).code === 1;
}

/**
 * D12: prova do lado do `ork` no intervalo do despacho, por fase. GOAL e PLAN: artefato gravado;
 * GO: commit conferido no git da worktree (D16) e worktree limpa; CHECK: parecer gravado com
 * exatamente um veredito legível (guarda também o último `verify_run`); MASTER:
 * `score_proposto`; SHIP: `ship_done`. Leitura de disco e do git, sem gravar nada.
 */
export function provaDoOrk(raiz: string, threadId: string, sessao: Pick<SessaoDespachada, 'sessionId' | 'fase' | 'despachadaEm'>,
    eventos: readonly EventoLedger[], fonte: Partial<Pick<FonteClaude, 'artefato' | 'cwd' | 'head'>> | undefined): ProvaOrk {
  const intervalo = eventosDoIntervalo(eventos, sessao);
  const falta = (texto: string, extra: Partial<ProvaOrk> = {}): ProvaOrk =>
    ({ ok: false, fonte: texto, motivo: sessao.fase === 'PLAN' ? 'artifact.missing' : 'human.pending', ...extra });
  const saida = saidaDoArtefato(raiz, threadId, sessao, fonte, eventos);
  if (saida) {
    if (!saida.produzido) return falta(`${saida.arquivo} não foi gravado no intervalo do despacho`);
    if (sessao.fase !== 'CHECK') return { ok: true, fonte: `${saida.arquivo} gravado no intervalo do despacho` };
    const v = intervalo.filter(e => e.tipo === 'verify_run' && typeof e.commit === 'string').at(-1);
    const verify = v ? { eventId: String(v.eventId), commit: String(v.commit), ts: v.ts } : null;
    const veredito = saida.texto === null ? null : vereditoDoParecer(saida.texto);
    if (!veredito) return falta(`${saida.arquivo} gravado sem exatamente um veredito legível`, { veredito: null, verify });
    return { ok: true, fonte: `${saida.arquivo} gravado com veredito ${veredito}`, veredito, verify };
  }
  if (sessao.fase === 'GO') {
    // D16: SHA registrado não é prova até ser conferido no git; o sensor `commit` só vale da sessão.
    const registrados = [...new Set(intervalo.filter(e => (e.tipo === 'mcp_git_committed' ||
      (e.tipo === 'commit' && e.sessionId === sessao.sessionId)) &&
      typeof e.commit === 'string' && SHA_COMMIT.test(e.commit)).map(e => String(e.commit)))].slice(-20);
    if (!registrados.length) return falta('nenhum commit registrado pelo núcleo no intervalo do despacho', { commits: [] });
    const cwd = fonte?.cwd, headNoDespacho = fonte?.head;
    if (!cwd || typeof headNoDespacho !== 'string')
      return falta('HEAD da worktree no despacho não registrado; commit não conferível', { commits: [], recusados: registrados });
    const commits = registrados.filter(sha => commitConferido(cwd, sha, headNoDespacho));
    const recusados = registrados.filter(sha => !commits.includes(sha));
    if (!commits.length) return falta(`nenhum commit conferido no git da worktree: ${registrados.length} SHA(s) registrado(s) ` +
      'inexistente(s), fora do HEAD atual ou já no HEAD do despacho', { commits, recusados });
    const status = exec('git', ['status', '--porcelain'], cwd, 30000);
    if (!status.ok) return falta('git status da worktree do despacho falhou', { commits, recusados, worktreeLimpa: false });
    if (status.stdout.trim() !== '') return falta('worktree com alterações não commitadas', { commits, recusados, worktreeLimpa: false });
    return { ok: true, fonte: `${commits.length} commit(s) conferido(s) no git da worktree depois do HEAD do despacho e worktree limpa`,
      commits, recusados, worktreeLimpa: true };
  }
  const exigido = sessao.fase === 'MASTER' ? 'score_proposto' : sessao.fase === 'SHIP' ? 'ship_done' : null;
  if (!exigido) return falta(`fase ${sessao.fase} sem prova do ork definida`);
  const evento = intervalo.filter(e => e.tipo === exigido).at(-1);
  if (!evento) return falta(`nenhum ${exigido} registrado no intervalo do despacho`);
  return { ok: true, fonte: `${exigido} registrado no intervalo do despacho`,
    evento: { tipo: exigido, eventId: String(evento.eventId), ts: evento.ts } };
}

/** Último registro de fonte nativa do despacho, se houver. Leitura pura do ledger. */
export function fonteRegistrada(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'despachadaEm'>): FonteClaude | undefined {
  const r = eventos.filter(e => e.tipo === 'session_sensor_registered' && e.sessionId === sessao.sessionId &&
    e.despachoEm === sessao.despachadaEm).at(-1);
  return r?.nativo === 'claude-agents' ? r as unknown as FonteClaude : undefined;
}

/**
 * D4: a fonte registrada no despacho. GOAL, PLAN e CHECK guardam o sha de base do artefato (D12);
 * o GO guarda o HEAD da worktree (D16), lido no mesmo instante do `despachoEm`.
 */
export function fonteClaudeDoDespacho(raiz: string, threadId: string, fase: string, cwd: string): FonteClaude {
  if (!path.isAbsolute(cwd)) throw new Error('despacho claude-bg sem cwd absoluto');
  const arquivo = ARTEFATO_DA_FASE[fase];
  return { nativo: 'claude-agents', cwd,
    ...(arquivo ? { artefato: { arquivo, sha256: estadoDoArtefato(raiz, threadId, arquivo).sha256 } } : {}),
    ...(fase === 'GO' ? { head: headDaWorktree(cwd) } : {}) };
}

function ultimoRegistro(eventos: readonly EventoLedger[], sessao: SessaoDespachada): (FonteClaude & EventoLedger) | undefined {
  return eventos.filter(e => e.tipo === 'session_sensor_registered' && e.sessionId === sessao.sessionId &&
    e.despachoEm === sessao.despachadaEm).at(-1) as (FonteClaude & EventoLedger) | undefined;
}

/** Confere a variante nativa contra o despacho; usada também pela validação do watcher. */
export function validarFonteClaude(eventos: readonly EventoLedger[], sessionId: string, registro: Partial<FonteClaude>): void {
  if (registro.nativo !== 'claude-agents' || typeof registro.cwd !== 'string' || !path.isAbsolute(registro.cwd))
    throw new Error('registro de sensor nativo claude-agents inválido');
  const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessionId).at(-1);
  if (registro.artefato !== undefined && (!Object.values(ARTEFATO_DA_FASE).includes(registro.artefato.arquivo) ||
      (typeof despacho?.fase === 'string' && ARTEFATO_DA_FASE[despacho.fase] !== registro.artefato.arquivo) ||
      (registro.artefato.sha256 !== null && !SHA256.test(String(registro.artefato.sha256)))))
    throw new Error('base de artefato do registro nativo inválida');
  if (registro.head !== undefined && ((registro.head !== null && !SHA_COMMIT.test(String(registro.head))) ||
      (typeof despacho?.fase === 'string' && despacho.fase !== 'GO')))
    throw new Error('HEAD de despacho do registro nativo inválido');
  if (despacho?.cwd !== undefined && despacho.cwd !== registro.cwd) throw new Error('cwd registrado divergente do despacho');
}

/**
 * D4 retroativa: sessão despachada antes da I-34 não tem registro. A fonte é derivável do
 * `phase_dispatch` e não é segredo; sem base de artefato, a prova do PLAN passa a ser o mtime.
 */
export function garantirFonteClaude(raiz: string, thread: Thread, sessao: SessaoDespachada): FonteClaude {
  const dir = dirThread(raiz, thread.id);
  const existente = ultimoRegistro(lerLedger(dir), sessao);
  if (existente) return existente;
  // Ledger apagado não ganha registro retroativo: o watcher destacado não recria a thread.
  if (!threadPresente(dir)) throw new Error(THREAD_REMOVIDA);
  return comLockDeSessao(dir, () => {
    const eventos = lerLedger(dir), atual = ultimoRegistro(eventos, sessao);
    if (atual) return atual;
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId).at(-1);
    const cwd = typeof despacho?.cwd === 'string' ? despacho.cwd : thread.worktree ?? raiz;
    const fonte: FonteClaude = { nativo: 'claude-agents', cwd, origem: 'sessions.watch' };
    validarFonteClaude(eventos, sessao.sessionId, fonte);
    if (!registrarSeExiste(dir, thread.id, 'session_sensor_registered', { fase: sessao.fase, sessionId: sessao.sessionId,
      despachoEm: sessao.despachadaEm, ...fonte })) throw new Error(THREAD_REMOVIDA);
    return fonte;
  });
}

/**
 * Evidência limitada: só campos do schema. O `name` vira hash, porque sessão despachada sem
 * `--name` recebe o começo do prompt como nome (medido em 19/09/2026 com 1438 caracteres).
 */
function evidenciaDoRegistro(r: RegistroAgenteClaude | null): Record<string, unknown> | null {
  if (!r) return null;
  const { sessionId, cwd, pid, startedAt } = r;
  const [id, kind, state, status] = [r.id, r.kind, r.state, r.status].map(v => normalizarNativo(v) ?? undefined);
  const base = { id, sessionId, cwd, kind, state, status, pid, startedAt,
    nameSha256: r.name === undefined ? undefined : createHash('sha256').update(r.name).digest('hex') };
  return Buffer.byteLength(JSON.stringify(base)) > LIMITE_EVIDENCIA_BYTES ? { sessionId, state, status, pid } : base;
}

export interface ContextoObservacaoClaude {
  raiz: string; thread: Thread; sessao: SessaoDespachada; dir: string; pasta: string; chave: string;
  agoraMs: number; limiteMs: number; consulta?: () => ConsultaAgentesNativos;
  /** I-33 (D12): com o manifesto, a falha de conta marca o perfil (janela padrao quando sem horario). */
  carregado?: ManifestoCarregado;
}
export interface ResultadoObservacaoClaude {
  sessionId: string; thread: string; concluido: boolean; bytesLidos: number; classificacao?: string; espera?: string;
  /** Observação inconclusiva além do limite: o processo destacado para, sem gate nem `phase_result`. */
  encerrado?: boolean;
}

/** Corpo da observação claude-bg, chamado pelo `session-watcher` já dentro do lock do watcher. */
export function observarClaudeSobLock(ctx: ContextoObservacaoClaude): ResultadoObservacaoClaude {
  const { raiz, thread, sessao, dir } = ctx;
  const base: ResultadoObservacaoClaude = { sessionId: sessao.sessionId, thread: thread.id, concluido: false, bytesLidos: 0 };
  const resultadoId = `claude-bg:${ctx.chave}`;
  const pronto = lerLedger(dir).find(e => e.tipo === 'phase_result' && e.sensorResultId === resultadoId);
  if (pronto) return { ...base, concluido: true, classificacao: String(pronto.classificacao) };
  const fonte = garantirFonteClaude(raiz, thread, sessao);
  // Todas as gravações do observador anexam só a ledger existente (achado 1).
  const gravar = (tipo: string, dados: Record<string, unknown>) => {
    if (!registrarSeExiste(dir, thread.id, tipo, dados)) throw new Error(THREAD_REMOVIDA);
  };
  const eventos = lerLedger(dir);
  validarFonteClaude(eventos, sessao.sessionId, fonte);
  const arquivoCursor = path.join(ctx.pasta, 'cursor-claude.json');
  let cursor: CursorClaude = { schema: 'ork.session-cursor-claude/v1', sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm };
  if (fs.existsSync(arquivoCursor)) {
    if (fs.statSync(arquivoCursor).size > 65536) throw new Error('metadado de sensor excessivo');
    const lido = JSON.parse(fs.readFileSync(arquivoCursor, 'utf8')) as CursorClaude;
    if (lido.schema !== cursor.schema || lido.sessionId !== sessao.sessionId || lido.despachoEm !== sessao.despachadaEm)
      throw new Error('cursor de outra sessão/despacho');
    cursor = lido;
  }
  // I-33 (D4): o registro nativo e da conta que despachou; perfil invalido lanca, nunca cai para o env do processo.
  const perfil = perfilDoRegistro(eventos, sessao);
  const consulta = (ctx.consulta ?? (() => consultarAgentesNativos(ctx.agoraMs, ambienteDoPerfil(perfil))))();
  const registro = consulta.ok ? consulta.registros.find(s => s.sessionId === sessao.sessionId && s.cwd === fonte.cwd) ?? null : null;
  const artefato = saidaDoArtefato(raiz, thread.id, sessao, fonte, eventos);
  let prova: ProvaOrk | undefined;
  const { c, falha } = comFalhaDeConta(classificarSessaoClaude({ sessao, eventos, consulta, registro, cursor, agoraMs: ctx.agoraMs,
    limiteMs: ctx.limiteMs, pausaAoFim: pausaNaThread(thread, sessao.fase),
    prova: () => prova ??= provaDoOrk(raiz, thread.id, sessao, eventos, fonte), processo: processoNativo }),
    () => falhaDeContaDaTranscricao(perfil, fonte.cwd, sessao.sessionId, ctx.agoraMs));
  gravarAtomico(arquivoCursor, cursor);
  // GO-FIX 3 (achado 1): cursor gravado numa thread que sumiu durante a consulta é desfeito aqui;
  // as pastas criadas pela observação, pelo `session-watcher`.
  if (!threadPresente(dir)) { fs.rmSync(arquivoCursor, { force: true }); throw new Error(THREAD_REMOVIDA); }
  if (!c.terminal && c.inconclusivo) return comLockDeSessao(dir, () => {
    const diagnosticoId = `${resultadoId}:inconclusivo`;
    if (!lerLedger(dir).some(e => e.sensorEventId === diagnosticoId)) gravar('session_watcher_error', {
      fase: sessao.fase, sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm, sensorEventId: diagnosticoId,
      motivo: 'runtime.unavailable', erro: normalizarNativo(c.espera, LIMITE_ERRO_DIAGNOSTICO), origem: 'sessions.watch',
      runtime: 'claude-bg', estadoNativo: normalizarNativo(registro?.state), evidencia: { fonte: 'claude agents --json --all', consultadoEm: consulta.consultadoEm,
        registro: evidenciaDoRegistro(registro) } });
    return { ...base, espera: c.espera, encerrado: true };
  });
  if (!c.terminal) return { ...base, espera: c.espera };
  return comLockDeSessao(dir, () => {
    const atuais = lerLedger(dir);
    // A decisão que depende do Stop é reconferida sobre o ledger atual, sob o lock de ingestão.
    // Heartbeat ou bloqueio ingerido depois da primeira leitura adia a decisão para a próxima volta.
    if (c.dependeDoStop && (!stopCorrelacionado(atuais, sessao) || bloqueioPendente(atuais, sessao)))
      return { ...base, espera: 'atividade ingerida durante a observação; reavaliar na próxima volta' };
    const observadoEm = new Date(ctx.agoraMs).toISOString();
    const dados = { fase: sessao.fase, sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm, sensorResultId: resultadoId,
      classificacao: c.classificacao, motivo: c.motivo, runtime: 'claude-bg', fonte: c.fonte,
      estadoNativo: normalizarNativo(registro?.state), statusNativo: normalizarNativo(registro?.status), pidNativo: registro?.pid ?? null,
      exitCode: null, exitCodeFonte: 'unavailable', signal: null, duracaoMs: null, duracaoFonte: 'unavailable',
      ok: c.classificacao === 'fase_concluida', estado: c.classificacao === 'fase_concluida' ? 'concluida' : 'bloqueada',
      stop: c.stop ? { ts: c.stop.ts, sensorEventId: c.stop.sensorEventId } : null,
      evidencia: { fonte: 'claude agents --json --all', consultadoEm: consulta.consultadoEm, registro: evidenciaDoRegistro(registro) },
      ...(artefato ? { artefato: { arquivo: artefato.arquivo, sha256Base: artefato.sha256Base, sha256Atual: artefato.sha256 } } : {}),
      ...(prova ? { provaOrk: prova } : {}),
      conclusaoNativa: c.conclusaoNativa, conclusaoNativaAusente: c.conclusaoNativa ? null : c.fonte,
      ...(perfil ? { perfil } : {}),
      ...(falha ? { falhaDeConta: { motivo: falha.motivo, resetEm: falha.resetEm, fonte: falha.fonte, trecho: falha.trecho } } : {}),
      // D18: o diagnóstico vai ao pedido HITL (`ork gate request`) e, como `detalhe` do
      // `gate_blocked`, ao `ork monitor` e ao `ork pulse`.
      diagnostico: c.diagnostico ?? null, ...(c.diagnostico ? { detalhe: c.diagnostico } : {}),
      observadoEm, gate: 'phase.dispatch', origem: 'sessions.watch' };
    if (!atuais.some(e => e.tipo === c.classificacao && e.sensorResultId === resultadoId)) gravar(c.classificacao, dados);
    // I-33 (D12): o perfil sai do rodizio na primeira gravacao do resultado, onde a evidencia esta.
    if (falha && perfil && ctx.carregado && !atuais.some(e => e.tipo === 'phase_result' && e.sensorResultId === resultadoId)) {
      try { marcarContaDaFalha(ctx.carregado, perfil, falha, ctx.agoraMs); }
      catch { /* store ocupado ou invalido: o retry marca de novo pelo gate tipado */ }
    }
    if (!atuais.some(e => e.tipo === 'phase_result' && e.sensorResultId === resultadoId)) gravar('phase_result', dados);
    return { ...base, concluido: true, classificacao: c.classificacao };
  });
}

/** Controller criado pelo despacho, nunca descoberto por PID ou resume de outra sessão. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { DespachoCodexPedido, DespachoCodexResultado } from './codex';
import type { ControleSessao, ConfirmacaoSessao, IdentidadeSessao } from '../hitl-sessions';

import type { PerguntaNativa } from './codex-question';
import { validarSchemaPlaybook } from '../playbook-contracts';

export interface VinculoController { thread: string; fase: string; promptSha256: string }
export interface IdentidadeProcesso { pid: number; uid: number; inicio: string; bootId: string; executavel: string; cwd: string }
/** Só captura PIDs obtidos do spawn próprio ou do próprio worker, nunca descoberta por nome. */
export function identidadeDoProcesso(pid: number): IdentidadeProcesso {
  const base = `/proc/${pid}`, st = fs.readFileSync(`${base}/stat`, 'utf8');
  return { pid, uid: fs.statSync(base).uid, inicio: st.slice(st.lastIndexOf(')') + 2).split(' ')[19],
    bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), executavel: fs.readlinkSync(`${base}/exe`), cwd: fs.readlinkSync(`${base}/cwd`) };
}
export function processoTerminou(p: IdentidadeProcesso | undefined): boolean {
  if (!p) return false;
  try {
    const st = fs.readFileSync(`/proc/${p.pid}/stat`, 'utf8'), campos = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    // Zombie é terminal, embora /proc ainda espere o reaper; não existe sinalização aqui.
    return boot !== p.bootId || campos[19] !== p.inicio || campos[0] === 'Z';
  } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT'; }
}
export interface BootstrapController { pedido: DespachoCodexPedido; instancia: string; prazoInicial: string; duracaoMaximaMs: number }
export interface EstadoController {
  instancia: string; vinculo: VinculoController; cwd: string; sessionId: string;
  pid: number; runtimePid?: number; runtimeInicio?: string; turno?: string; rollout?: string;
  processoController?: IdentidadeProcesso; processoRuntime?: IdentidadeProcesso;
  processoEncerrado?: { em: string; code: number | null; signal: string | null };
  encerramentoSolicitado?: string; runtimeNaoIniciado?: boolean;
  estado: string; bloqueio?: string; perguntaNativa?: PerguntaNativa; pronto?: boolean; erro?: string;
  limitacao?: { motivo: 'runtime.unavailable'; codigo: string; metodo: string };
  terminal?: { metodo: 'turn/completed'; threadId: string; turnId: string; status: string; erro?: ErroNativoDoTurno };
}
/** I-33 (D12): erro nativo de turno `failed` (`turn.error` do app-server), reduzido a codigo e mensagem curtos. */
export interface ErroNativoDoTurno { codigo: string | null; mensagem: string }
export const LIMITE_MENSAGEM_ERRO_NATIVO = 300;
const CODIGO_ERRO_NATIVO = /^[A-Za-z0-9_]{1,64}$/;
export function erroNativoDoTurno(v: unknown): ErroNativoDoTurno | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const info = o.codexErrorInfo;
  const bruto = typeof info === 'string' ? info : info && typeof info === 'object' && !Array.isArray(info) ? Object.keys(info)[0] ?? '' : '';
  const codigo = bruto.replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) || null;
  const mensagem = typeof o.message === 'string'
    ? Array.from(o.message.replace(/\p{Cc}/gu, ' ')).slice(0, LIMITE_MENSAGEM_ERRO_NATIVO).join('').trim() : '';
  return codigo || mensagem ? { codigo, mensagem } : null;
}
/** Forma exata gravada pelo worker; qualquer outra coisa no `state.json` e recusada pelo sensor. */
export function erroNativoValido(v: unknown): v is ErroNativoDoTurno {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.keys(o).every(k => k === 'codigo' || k === 'mensagem') &&
    (o.codigo === null || (typeof o.codigo === 'string' && CODIGO_ERRO_NATIVO.test(o.codigo))) &&
    typeof o.mensagem === 'string' && Array.from(o.mensagem).length <= LIMITE_MENSAGEM_ERRO_NATIVO && !/\p{Cc}/u.test(o.mensagem) &&
    (o.codigo !== null || o.mensagem !== '');
}
const worker = () => path.join(__dirname, 'codex-controller-worker.js');
export function conferirDiretorio(dir: string): void {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077)) {
    throw new Error('runtime.unavailable: IPC exige diretório privado 0700 do uid autenticado');
  }
}
export function lerEstadoController(dir: string): EstadoController {
  conferirDiretorio(dir);
  return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as EstadoController;
}
function rpcController(dir: string, instancia: string, operacao: string, dados?: unknown, timeout = 12000): any {
  conferirDiretorio(dir);
  const r = spawnSync(process.execPath, [worker(), '--rpc'], { cwd: dir, encoding: 'utf8', timeout: Math.max(1, Math.floor(timeout)),
    input: JSON.stringify({ instancia, operacao, dados }), maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw new Error('runtime.unavailable: controller não respondeu; não reenviar');
  const out = JSON.parse(r.stdout);
  if (!out.ok) throw new Error(out.erro ?? 'runtime.unavailable: controller recusou');
  return out.resultado;
}
export function controleDoController(dir: string, vinculo: VinculoController, sessionId: string, cwd: string): ControleSessao {
  const inicial = lerEstadoController(dir);
  if (inicial.sessionId !== sessionId || inicial.cwd !== cwd ||
      JSON.stringify(inicial.vinculo) !== JSON.stringify(vinculo)) throw new Error('runtime.unavailable: vínculo de despacho divergente');
  const consultar = (orcamentoMs = 12000): { ok: boolean; sessoes: IdentidadeSessao[] } => {
    try {
      const salvo = lerEstadoController(dir);
      if (!salvo.terminal && !salvo.processoEncerrado && orcamentoMs <= 0) return { ok: false, sessoes: [] };
      const s: EstadoController = salvo.terminal || salvo.processoEncerrado ? salvo : rpcController(dir, inicial.instancia, 'consultar', undefined, Math.min(12000, orcamentoMs));
      if (s.instancia !== inicial.instancia || s.sessionId !== sessionId || s.cwd !== cwd) return { ok: false, sessoes: [] };
      return { ok: true, sessoes: [{ sessionId, runtime: 'codex', cwd, instancia: s.instancia,
        estado: s.estado, bloqueio: s.bloqueio, ...{ perguntaNativa: s.perguntaNativa, limitacao: s.limitacao } }] };
    } catch { return { ok: false, sessoes: [] }; }
  };
  return { consultar,
    enviar: e => { rpcController(dir, inicial.instancia, 'enviar', e); },
    confirmar: e => {
      if (!/^[a-f0-9-]{36}$/.test(e.envioId)) return null;
      const file = path.join(dir, `receipt-${e.envioId}.json`);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as ConfirmacaoSessao : null;
    },
    parar: s => { try { rpcController(dir, inicial.instancia, 'parar', s); return consultar().sessoes[0]?.estado === 'stopped'; } catch { return false; } },
  };
}
export function despacharComController(pedido: DespachoCodexPedido, env: NodeJS.ProcessEnv): DespachoCodexResultado {
  const comando = ['codex', 'app-server', '--listen', 'stdio://'];
  const vazio = { comando, sessionId: null, verificada: false, stdout: '', stderr: '' };
  if (!pedido.vinculo || createHash('sha256').update(pedido.prompt).digest('hex') !== pedido.vinculo.promptSha256) {
    return { ...vazio, ok: false, erro: 'runtime.unavailable: prompt não corresponde ao vínculo do despacho' };
  }
  // I-33 (D2): o worker herda este env inteiro; ele precisa carregar o CODEX_HOME do perfil do
  // pedido, senao o turno rodaria e seria reverificado por outra conta.
  if (pedido.perfil && env.CODEX_HOME !== pedido.perfil.codexHome)
    return { ...vazio, ok: false, erro: 'runtime.unavailable: CODEX_HOME do despacho diverge do perfil do pedido' };
  if (pedido.outputSchema !== undefined) {
    try { validarSchemaPlaybook(pedido.outputSchema); }
    catch { return { ...vazio, ok: false, erro: 'runtime.unavailable: output schema invalido' }; }
  }
  if (pedido.dryRun) return { ...vazio, ok: true };
  const duracaoMaximaMs = pedido.duracaoMaximaMs ?? 6 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(duracaoMaximaMs) || duracaoMaximaMs < 1 || duracaoMaximaMs > 24 * 60 * 60 * 1000) return { ...vazio, ok: false, erro: 'runtime.unavailable: duração máxima inválida' };
  const instancia = randomUUID();
  const limite = Date.now() + (pedido.esperaMs ?? 30000);
  const dir = path.join(pedido.logDir ?? pedido.cwd, `controller-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bootstrap = path.join(dir, 'bootstrap.json');
  fs.writeFileSync(path.join(dir, 'launch.json'), JSON.stringify({ contrato: 'ork.controller-launch/v1', instancia, vinculo: pedido.vinculo, cwd: pedido.cwd, criadoEm: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(bootstrap, JSON.stringify({ pedido, instancia, prazoInicial: new Date(limite).toISOString(), duracaoMaximaMs } satisfies BootstrapController), { mode: 0o600, flag: 'wx' });
  const fd = fs.openSync(bootstrap, 'r');
  try {
    const child = spawn(process.execPath, [worker()], { cwd: dir, env, detached: true, stdio: [fd, 'ignore', 'ignore'] });
    child.on('error', () => {});
    if (child.pid) {
      let processoController: IdentidadeProcesso | undefined;
      try { processoController = identidadeDoProcesso(child.pid); } catch { /* worker pode ter saído; referência nunca é perdida */ }
      fs.writeFileSync(path.join(dir, 'process-launch.json'), JSON.stringify({ instancia, pid: child.pid, processoController }), { mode: 0o600, flag: 'wx' });
    }
    child.unref();
  } finally { fs.closeSync(fd); fs.unlinkSync(bootstrap); }
  while (Date.now() < limite) {
    if (fs.existsSync(path.join(dir, 'state.json'))) {
      const s = lerEstadoController(dir);
      if (s.erro) return { ...vazio, ok: false, erro: s.erro, controlador: dir };
      if (s.pronto) return { ...vazio, ok: true, sessionId: s.sessionId, verificada: true, controlador: dir };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  solicitarEncerramento(dir, instancia);
  return { ...vazio, ok: false, erro: 'runtime.unavailable: controller sem confirmação do despacho; encerramento solicitado, referência preservada', controlador: dir };
}

function solicitarEncerramento(dir: string, instancia: string): void {
  const file = path.join(dir, 'stop-request.json'), value = { instancia, solicitadoEm: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    if (JSON.parse(fs.readFileSync(file, 'utf8')).instancia !== instancia) throw new Error('runtime.unavailable: pedido de encerramento divergente'); }
}
/** Recuperação exata por referência do despacho. Nunca signal/resume/descoberta de sessão. */
export function encerrarController(dir: string, vinculo: VinculoController, instancia: string, esperaMs = 10000) {
  conferirDiretorio(dir);
  const launch = JSON.parse(fs.readFileSync(path.join(dir, 'launch.json'), 'utf8'));
  if (launch.instancia !== instancia || JSON.stringify(launch.vinculo) !== JSON.stringify(vinculo)) throw new Error('runtime.unavailable: vínculo do encerramento divergente');
  solicitarEncerramento(dir, instancia);
  const fim = performance.now() + esperaMs;
  let state: EstadoController | undefined;
  do {
    try { state = lerEstadoController(dir); } catch { /* bootstrap ainda não observado */ }
    if (state && state.instancia !== instancia) throw new Error('runtime.unavailable: instância do encerramento divergente');
    if (state && processoTerminou(state.processoController) && (processoTerminou(state.processoRuntime) || state.runtimeNaoIniciado === true && state.runtimePid === undefined && !!state.processoEncerrado)) {
      const result = { ok: true, instancia, sessionId: state.sessionId, processoController: state.processoController,
        processoRuntime: state.processoRuntime, runtimeNaoIniciado: state.runtimeNaoIniciado === true,
        evidencia: state.runtimeNaoIniciado ? 'worker capturado terminal; ChildProcess confirmou falha de spawn sem PID de runtime' : 'ambas identidades capturadas no spawn estão terminais; sem sinal genérico', observadoEm: new Date().toISOString() };
      fs.writeFileSync(path.join(dir, 'processes-ended.json'), JSON.stringify(result), { mode: 0o600 }); return result;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  } while (performance.now() < fim);
  return { ok: false, instancia, sessionId: state?.sessionId ?? null, controlador: dir,
    evidencia: 'runtime.unavailable: encerramento pendente; referência preservada para inspeção, nenhum sinal ou resume' };
}

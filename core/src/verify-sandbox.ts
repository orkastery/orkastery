/** VERIFY interno sob sandbox Codex local, sem modelo e sem fallback não confinado.
 * Contrato de escrita/rede, não de confidencialidade de leitura do filesystem.
 * API síncrona: timeout rígido; não promete cancelamento reativo por AbortSignal.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ResultadoDeComando } from './types';
import { ExecutorVerify, TIMEOUT_VERIFY_MS } from './verify';

const MAX_OUTPUT = 1024 * 1024;
/** Supervisor Linux fixo: subreaper recolhe também daemons/setsid.
 * Nunca executa código de claim fora do sandbox. Python é infraestrutura local, sem pacotes. */
const SUPERVISOR = String.raw`
import ctypes, errno, json, os, selectors, signal, subprocess, sys, time
p = json.load(sys.stdin)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER falhou')
state = {'failure': None}
def interrupted(_sig, _frame): state['failure'] = 'supervisor interrompido'
signal.signal(signal.SIGTERM, interrupted)
def cleanup():
    deadline = time.monotonic() + 3
    while True:
        with open('/proc/self/task/' + str(os.getpid()) + '/children') as f:
            children = [int(x) for x in f.read().split()]
        # Filhos vivos ou zombies ainda não reaped: seus PIDs não podem ser reutilizados.
        for pid in children:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
        try:
            while True:
                pid, _status = os.waitpid(-1, os.WNOHANG)
                if pid == 0: break
        except ChildProcessError: return True
        if time.monotonic() >= deadline: return False
        time.sleep(.005)
stdout = bytearray(); stderr = bytearray(); code = -1
try:
    child = subprocess.Popen([p['bin'], *p['args']], cwd=p['cwd'], env=p['env'],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, stdout)
    selector.register(child.stderr, selectors.EVENT_READ, stderr)
    deadline = time.monotonic() + p['timeoutMs']/1000
    while True:
        if state['failure']: break
        if time.monotonic() >= deadline:
            state['failure'] = 'timeout do sandbox'; break
        if child.poll() is not None and not selector.get_map():
            code = child.returncode; break
        for key, _ in selector.select(.025):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data: selector.unregister(key.fileobj); continue
            if len(stdout)+len(stderr)+len(data) > p['maxOutput']:
                state['failure'] = 'limite de saída excedido'; break
            key.data.extend(data)
except Exception as e: state['failure'] = 'sandbox indisponível: ' + str(e)
finally:
    cleanup_complete = cleanup()
    if not cleanup_complete: state['failure'] = 'descendente do sandbox não encerrou no prazo'
print(json.dumps({'code': -1 if state['failure'] else code,
    'stdout': stdout.decode(errors='replace'), 'stderr': stderr.decode(errors='replace'), 'failure': state['failure'], 'cleanupComplete': cleanup_complete}))
`;

export interface OpcoesExecutorSandbox {
  worktree: string;
  /** Somente configuração interna. Nunca argumentos de ferramenta. */
  timeoutMs?: number;
}
export interface ResultadoSandbox extends ResultadoDeComando {
  stdout: string;
  stderr: string;
  executor: 'codex-sandbox';
}

/** Somente WT e leaf scratch privado são graváveis; configuração e parent continuam readonly. */
function estadoSandbox(worktree: string, scratch: string): object {
  const entries: object[] = [
    { path: { type: 'special', value: { kind: 'root' } }, access: 'read' },
    { path: { type: 'path', path: worktree }, access: 'write' },
    { path: { type: 'path', path: scratch }, access: 'write' },
  ];
  // Metadados/configuração de host e estado canônico não pertencem ao comando testado.
  for (const nome of ['.git', '.orkastery', '.codex', '.claude', '.agents']) {
    const alvo = path.join(worktree, nome);
    entries.push({ path: { type: 'path', path: alvo }, access: 'read' });
  }
  return {
    permissionProfile: { type: 'managed', file_system: { type: 'restricted', entries }, network: 'restricted' },
    sandboxCwd: pathToFileURL(worktree).href,
    useLegacyLandlock: false,
  };
}

export function criarExecutorSandbox(opcoes: OpcoesExecutorSandbox): { executar: ExecutorVerify; fechar: () => void } {
  if (process.platform !== 'linux') throw new Error('executor VERIFY sandbox disponível somente em Linux');
  if (!path.isAbsolute(opcoes.worktree)) throw new Error('worktree deve ser absoluta');
  const worktree = fs.realpathSync(opcoes.worktree);
  if (!fs.statSync(worktree).isDirectory() || worktree === path.parse(worktree).root) throw new Error('worktree inválida');
  const original = fs.statSync(worktree);
  const timeoutMs = opcoes.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > TIMEOUT_VERIFY_MS) throw new Error('timeout sandbox fora do limite');
  // Binário local aprovado da instalação; não procuramos executável fornecido pela claim.
  const bin = fs.realpathSync('/usr/bin/codex');
  const binStat = fs.statSync(bin);
  const isolamento = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-verify-config-'));
  if (fs.realpathSync(isolamento) === worktree || fs.realpathSync(isolamento).startsWith(worktree + path.sep)) {
    fs.rmdirSync(isolamento);throw Error('scratch VERIFY deve ficar fora da worktree');
  }
  const isolamentoStat=fs.lstatSync(isolamento);
  const identidadeIgual=(file:string,original:fs.Stats):boolean=>{
    const st=fs.lstatSync(file,{throwIfNoEntry:false});
    return !!st && st.isDirectory() && !st.isSymbolicLink() && st.dev===original.dev && st.ino===original.ino && st.uid===original.uid;
  };
  const codexHome = path.join(isolamento, 'codex');
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '');
  let fechado = false, consumidoresEncerrados = true, erroCleanup = '';
  const fechar = () => {
    if (fechado) {if(erroCleanup)throw Error(erroCleanup);return;}
    if(erroCleanup)throw Error(erroCleanup);
    if(!consumidoresEncerrados)throw Error('cleanup incompleto: consumidores não comprovadamente encerrados; isolamento preservado: '+isolamento);
    if(!identidadeIgual(isolamento,isolamentoStat))throw Error('cleanup incompleto: isolamento substituído; preservado');
    fechado = true;
    fs.rmSync(isolamento, { recursive: true, force: false });
  };
  const executar: ExecutorVerify = (nome, comando, cwd): ResultadoSandbox => {
    if (fechado) throw new Error('executor sandbox fechado');
    if(erroCleanup || !consumidoresEncerrados)throw Error(erroCleanup || 'cleanup incompleto: consumidor pendente');
    const atual = fs.statSync(worktree);
    const atualBin = fs.statSync(bin);
    if (fs.realpathSync(cwd) !== worktree || atual.dev !== original.dev || atual.ino !== original.ino ||
        atualBin.dev !== binStat.dev || atualBin.ino !== binStat.ino) throw new Error('escopo/binário do executor sandbox mudou');
    if(!identidadeIgual(isolamento,isolamentoStat))throw Error('isolamento sandbox mudou');
    const scratch = fs.mkdtempSync(path.join(isolamento, 'scratch-'));
    const scratchStat=fs.lstatSync(scratch);
    const criados:Array<{file:string;stat:fs.Stats}>=[];
    const home = path.join(scratch, 'home');
    const tmp = path.join(scratch, 'tmp');
    fs.mkdirSync(home); fs.mkdirSync(tmp);
    try {
      // Diretórios vazios não aparecem no Git. Não criar arquivos sintéticos nem esconder untracked.
      for(const nome of ['.git','.orkastery','.codex','.claude','.agents']) {
        const file=path.join(worktree,nome);let st=fs.lstatSync(file,{throwIfNoEntry:false});
        if(!st) {
          fs.mkdirSync(file,{mode:0o700});st=fs.lstatSync(file);
          criados.push({file,stat:st});
        }
        if(st.isSymbolicLink() || !(st.isDirectory() || (nome==='.git' && st.isFile() && st.nlink===1)))
          throw Error('metadado protegido inesperado; objeto preservado: '+nome);
      }
      for(const item of criados)if(!identidadeIgual(item.file,item.stat))throw Error('metadado temporário mudou antes do lançamento');
      const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, CODEX_HOME: codexHome,
        TMPDIR: tmp, TMP: tmp, TEMP: tmp, LANG: 'C.UTF-8', CI: '1',
        XDG_CACHE_HOME: path.join(home, '.cache'), npm_config_cache: path.join(home, '.npm') };
      const args = ['sandbox', '--sandbox-state-json', JSON.stringify(estadoSandbox(worktree,scratch)),
        '--sandbox-state-disable-network', '/bin/bash', '-c', comando];
      consumidoresEncerrados=false;
      const r = spawnSync('/usr/bin/python3', ['-c', SUPERVISOR], {
        input: JSON.stringify({ bin, args, cwd: worktree, env, timeoutMs, maxOutput: MAX_OUTPUT }),
        cwd: isolamento, env, encoding: 'utf8', maxBuffer: 4 * MAX_OUTPUT,
        timeout: timeoutMs + 5_000, killSignal: 'SIGTERM',
      });
      let resultado: { code: number; stdout: string; stderr: string; failure: string | null; cleanupComplete:boolean };
      try {
        if (r.error || r.status !== 0) throw new Error(r.error?.message ?? `supervisor saiu ${r.status}`);
        const v: unknown = JSON.parse(r.stdout);
        if (!v || typeof v !== 'object') throw new Error('resposta inválida');
        const x = v as Record<string, unknown>;
        if (!Number.isInteger(x.code) || typeof x.stdout !== 'string' || typeof x.stderr !== 'string' ||
            !(x.failure === null || typeof x.failure === 'string') || typeof x.cleanupComplete!=='boolean') throw new Error('resposta inválida');
        resultado = x as typeof resultado;
        consumidoresEncerrados=resultado.cleanupComplete;
      } catch (e) {
        resultado = { code: -1, stdout: '', stderr: r.stderr ?? '', failure: `falha fechada do sandbox: ${String(e)}`,cleanupComplete:false };
      }
      const stderr = resultado.stderr + (resultado.failure ? '\n' + resultado.failure : '');
      const resumo = (resultado.stdout + '\n' + stderr).trim().split('\n').slice(-10).join('\n').slice(-800);
      return { nome, comando, ok: resultado.code === 0 && !resultado.failure, code: resultado.code,
        resumo, stdout: resultado.stdout, stderr, executor: 'codex-sandbox' };
    } finally {
      if(!consumidoresEncerrados) {
        erroCleanup='cleanup incompleto: consumidores não comprovadamente encerrados; temporários preservados: '+isolamento;
      } else {
        const erros:string[]=[];
        for(const item of criados.reverse()) {
          try {
            if(!identidadeIgual(item.file,item.stat))throw Error('identidade mudou');
            // rmdir é a checagem atômica de vazio. Nunca recursive/force nos paths da WT.
            fs.rmdirSync(item.file);
          } catch {erros.push(path.basename(item.file));}
        }
        try {
          if(!identidadeIgual(isolamento,isolamentoStat) || !identidadeIgual(scratch,scratchStat))throw Error('scratch mudou');
          fs.rmSync(scratch,{recursive:true,force:false});
        } catch {erros.push('scratch');}
        if(erros.length)erroCleanup='cleanup incompleto: objetos substituídos ou não vazios preservados: '+erros.join(', ')+'; isolamento preservado: '+isolamento;
      }
      if(erroCleanup)throw Error(erroCleanup);
    }
  };
  return { executar, fechar };
}

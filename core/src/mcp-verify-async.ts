/**
 * Verify assíncrono do MCP: o transporte inicia uma rodada curta e um worker do próprio servidor
 * executa o mesmo `verificar` do CLI. O estado fica no domínio canônico da thread; o modelo nunca
 * escolhe raiz, comando, PID ou lease.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { comLockHitl } from './hitl-gates';
import { exigirManifesto } from './manifest';
import { validarArquivosEstadoMcp } from './mcp-artifacts';
import { adquirirRegiao, lerLease, leasesColidentes, liberar, podarRegioesDeThreadsFechadas } from './leases';
import { dirThread, lerThread } from './thread';
import { Lease } from './types';
import { ESPERA_DA_FILA_PESADA_MS, ResultadoVerify, textoDoVerify, verificar } from './verify';
import { PRAZO_DE_SESSAO_PADRAO_MS, prazoDaVerificacao } from './conducao';
import { comandosDoManifesto } from './verify';
import { lerClaims } from './claims';
import { comLocale, resolverLocale } from './locale';
import type { HostMcp } from './mcp-install';

export const CONTRATO_VERIFY_MCP = 'ork.verify-mcp/v1' as const;
const ESTADOS_VIVOS = new Set(['na-fila', 'rodando']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LIMITE_ESTADO = 16 * 1024 * 1024;

export interface FalhaVerifyMcp {
  motivo: 'verify.processo-morto' | 'verify.worker-failed' | 'verify.lease-perdida';
  detalhe: string;
}

export interface VereditoVerifyMcp {
  ok: boolean;
  commit: string;
  motivos: ResultadoVerify['motivos'];
  check: ResultadoVerify['check'];
  texto: string;
  resultado: ResultadoVerify;
}

export interface EstadoVerifyMcpPublico {
  contrato: typeof CONTRATO_VERIFY_MCP;
  rodadaId: string;
  threadId: string;
  despacho: string | null;
  estado: 'na-fila' | 'rodando' | 'concluido' | 'falhou';
  lane: string | null;
  criadaEm: string;
  atualizadaEm: string;
  reutilizada?: boolean;
  ocupantes?: Array<{ operacao: string; thread: string | null }>;
  veredito?: VereditoVerifyMcp;
  falha?: FalhaVerifyMcp;
}

interface ProcessoDaRodada { pid: number; inicio: string | null }
interface EstadoVerifyMcp extends Omit<EstadoVerifyMcpPublico, 'reutilizada'> {
  host: HostMcp;
  processo: ProcessoDaRodada | null;
  lease: Lease;
}

export interface DependenciasVerifyMcp {
  agora?: () => Date;
  inicioDoProcesso?: (pid: number) => string | null;
  processoVivo?: (processo: ProcessoDaRodada) => boolean;
  lancar?: (pedido: { worker: string; raiz: string; threadId: string; rodadaId: string }) => ProcessoDaRodada;
}

function agora(dep?: DependenciasVerifyMcp): string { return (dep?.agora?.() ?? new Date()).toISOString(); }

function inicioDoProcesso(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch { return null; }
}

function processoVivo(processo: ProcessoDaRodada): boolean {
  try { process.kill(processo.pid, 0); } catch { return false; }
  return processo.inicio === null || inicioDoProcesso(processo.pid) === processo.inicio;
}

function mesmoLease(a: Lease | null, b: Lease): boolean {
  return !!a && a.nome === b.nome && a.thread === b.thread && a.pid === b.pid &&
    a.adquiridoEm === b.adquiridoEm && a.expiraEm === b.expiraEm && a.motivo === b.motivo;
}

function diretorioDasRodadas(raiz: string, threadId: string, criar: boolean): string {
  validarArquivosEstadoMcp(raiz, threadId);
  const threadDir = fs.realpathSync(dirThread(raiz, threadId));
  const estadoReal = fs.realpathSync(path.join(raiz, '.orkastery'));
  if (!threadDir.startsWith(estadoReal + path.sep)) throw Error('mcp.verify.async.scope');
  const dir = path.join(threadDir, 'verify-mcp');
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st) {
    if (!criar) throw Error('mcp.verify.round.not-found');
    fs.mkdirSync(dir, { mode: 0o700 });
  }
  const atual = fs.lstatSync(dir);
  if (!atual.isDirectory() || atual.isSymbolicLink() || fs.realpathSync(dir) !== dir ||
      (process.getuid && atual.uid !== process.getuid())) throw Error('mcp.verify.async.scope');
  return dir;
}

function lerArquivoSeguro(file: string, ausente: boolean): Buffer | null {
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) {
    if (ausente && (e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > LIMITE_ESTADO || (process.getuid && st.uid !== process.getuid()))
      throw Error('mcp.verify.async.unsafe');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > LIMITE_ESTADO) throw Error('mcp.verify.async.too-large');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function validarEstado(v: unknown, threadId: string, rodadaId: string): EstadoVerifyMcp {
  const e = v as Partial<EstadoVerifyMcp>;
  if (!e || e.contrato !== CONTRATO_VERIFY_MCP || e.threadId !== threadId || e.rodadaId !== rodadaId ||
      !UUID.test(rodadaId) || !['na-fila', 'rodando', 'concluido', 'falhou'].includes(String(e.estado)) ||
      typeof e.criadaEm !== 'string' || typeof e.atualizadaEm !== 'string' ||
      !e.lease || e.lease.thread !== threadId || typeof e.host !== 'string') throw Error('mcp.verify.async.invalid');
  return e as EstadoVerifyMcp;
}

function lerEstado(dir: string, threadId: string, rodadaId: string): EstadoVerifyMcp {
  if (!UUID.test(rodadaId)) throw Error('mcp.verify.round.invalid');
  const bytes = lerArquivoSeguro(path.join(dir, `${rodadaId}.json`), false)!;
  try { return validarEstado(JSON.parse(bytes.toString('utf8')), threadId, rodadaId); }
  catch (e) { if ((e as Error).message.startsWith('mcp.')) throw e; throw Error('mcp.verify.async.invalid'); }
}

function gravarAtomico(dir: string, nome: string, valor: unknown): void {
  const destino = path.join(dir, nome);
  const temp = path.join(dir, `.${nome}.${process.pid}.${randomUUID()}.tmp`);
  const bytes = JSON.stringify(valor) + '\n';
  if (Buffer.byteLength(bytes) > LIMITE_ESTADO) throw Error('mcp.verify.async.too-large');
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, destino);
  } finally { fs.rmSync(temp, { force: true }); }
}

function gravarEstado(dir: string, estado: EstadoVerifyMcp): void {
  gravarAtomico(dir, `${estado.rodadaId}.json`, estado);
}

function lerAtiva(dir: string, threadId: string): EstadoVerifyMcp | null {
  const bytes = lerArquivoSeguro(path.join(dir, 'active.json'), true);
  if (!bytes) return null;
  let id: unknown;
  try { id = (JSON.parse(bytes.toString('utf8')) as { rodadaId?: unknown }).rodadaId; } catch { throw Error('mcp.verify.async.invalid'); }
  if (typeof id !== 'string' || !UUID.test(id)) throw Error('mcp.verify.async.invalid');
  return lerEstado(dir, threadId, id);
}

function publico(estado: EstadoVerifyMcp, reutilizada?: boolean): EstadoVerifyMcpPublico {
  const { host: _host, processo: _processo, lease: _lease, ...visivel } = estado;
  return { ...visivel, ...(reutilizada === undefined ? {} : { reutilizada }) };
}

function vivo(estado: EstadoVerifyMcp, dep?: DependenciasVerifyMcp): boolean {
  return !!estado.processo && (dep?.processoVivo ?? processoVivo)(estado.processo);
}

function liberarLeaseExata(raiz: string, estado: EstadoVerifyMcp): void {
  if (mesmoLease(lerLease(raiz, estado.lease.nome), estado.lease)) liberar(raiz, estado.lease.nome, estado.threadId);
}

function falhaDeProcesso(estado: EstadoVerifyMcp, instante: string): EstadoVerifyMcp {
  return { ...estado, estado: 'falhou', lane: null, atualizadaEm: instante,
    falha: { motivo: 'verify.processo-morto', detalhe: 'o worker terminou sem gravar um veredito completo' } };
}

function prazoDaLease(raiz: string, threadId: string): number {
  const carregado = exigirManifesto(raiz);
  const claims = lerClaims(raiz, threadId).filter((c) => c.estado !== 'retirada');
  const quantidade = claims.reduce((n, c) => n + c.verificar.length, 0) + comandosDoManifesto(carregado.manifesto).length + 2;
  const prazos = [carregado.manifesto.verify.timeout_ms ?? 600_000,
    ...Object.values(carregado.manifesto.verify.timeout_ms_por_comando ?? {}).filter((n): n is number => typeof n === 'number')];
  return ESPERA_DA_FILA_PESADA_MS + Math.max(PRAZO_DE_SESSAO_PADRAO_MS, prazoDaVerificacao(Math.max(...prazos), quantidade));
}

function lancarWorker(pedido: { worker: string; raiz: string; threadId: string; rodadaId: string }): ProcessoDaRodada {
  const child = spawn(process.execPath, [pedido.worker, pedido.raiz, pedido.threadId, pedido.rodadaId], {
    cwd: pedido.raiz, detached: true, stdio: 'ignore', env: process.env,
  });
  if (!child.pid) throw Error('mcp.verify.worker.spawn');
  child.unref();
  let inicio: string | null = null;
  for (let i = 0; i < 20 && inicio === null; i++) {
    inicio = inicioDoProcesso(child.pid);
    if (inicio === null) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  return { pid: child.pid, inicio };
}

export function iniciarVerifyMcp(raiz: string, threadId: string,
  vinculo: { host: HostMcp; despacho: string | null }, dep: DependenciasVerifyMcp = {}): EstadoVerifyMcpPublico {
  const carregado = exigirManifesto(raiz);
  if (fs.realpathSync(carregado.raiz) !== fs.realpathSync(raiz)) throw Error('mcp.verify.project');
  validarArquivosEstadoMcp(raiz, threadId);
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada' || !thread.worktree) throw Error('mcp.verify.thread');
  return comLockHitl(raiz, threadId, () => {
    const dir = diretorioDasRodadas(raiz, threadId, true);
    const ativa = lerAtiva(dir, threadId);
    if (ativa && ESTADOS_VIVOS.has(ativa.estado) && vivo(ativa, dep)) return publico(ativa, true);
    if (ativa) {
      const reconciliada = ESTADOS_VIVOS.has(ativa.estado) ? falhaDeProcesso(ativa, agora(dep)) : ativa;
      if (reconciliada !== ativa) gravarEstado(dir, reconciliada);
      liberarLeaseExata(raiz, reconciliada);
    }

    const nomeLease = `worktree-write:${threadId}`;
    podarRegioesDeThreadsFechadas(raiz, [nomeLease, 'main-tree'], threadId);
    if (lerLease(raiz, nomeLease) || leasesColidentes(raiz, nomeLease).length || leasesColidentes(raiz, 'main-tree').length)
      throw Error('lease.busy: verify assíncrono exige a worktree livre');
    const rodadaId = randomUUID();
    const instante = agora(dep);
    const regiao = adquirirRegiao(raiz, nomeLease, { thread: threadId, motivo: `MCP VERIFY ASYNC ${rodadaId}`,
      ttlMs: prazoDaLease(raiz, threadId), retomarVencido: false });
    if (!regiao.ok || !regiao.lease) throw Error('lease.busy: verify assíncrono não adquiriu a worktree');
    let estado: EstadoVerifyMcp = { contrato: CONTRATO_VERIFY_MCP, rodadaId, threadId, despacho: vinculo.despacho,
      host: vinculo.host, estado: 'na-fila', lane: null, criadaEm: instante, atualizadaEm: instante,
      processo: null, lease: regiao.lease };
    gravarEstado(dir, estado);
    gravarAtomico(dir, 'active.json', { contrato: CONTRATO_VERIFY_MCP, rodadaId });
    try {
      const worker = path.resolve(__dirname, 'mcp-verify-worker.js');
      const processo = (dep.lancar ?? lancarWorker)({ worker, raiz: fs.realpathSync(raiz), threadId, rodadaId });
      estado = { ...estado, processo, atualizadaEm: agora(dep) };
      gravarEstado(dir, estado);
      return publico(estado, false);
    } catch (e) {
      estado = { ...estado, estado: 'falhou', atualizadaEm: agora(dep),
        falha: { motivo: 'verify.worker-failed', detalhe: (e as Error).message } };
      gravarEstado(dir, estado);
      liberarLeaseExata(raiz, estado);
      return publico(estado, false);
    }
  });
}

export function consultarVerifyMcp(raiz: string, threadId: string, rodadaId: string,
  dep: DependenciasVerifyMcp = {}): EstadoVerifyMcpPublico {
  lerThread(raiz, threadId); validarArquivosEstadoMcp(raiz, threadId);
  const estado = lerEstado(diretorioDasRodadas(raiz, threadId, false), threadId, rodadaId);
  return publico(ESTADOS_VIVOS.has(estado.estado) && !vivo(estado, dep) ? falhaDeProcesso(estado, agora(dep)) : estado);
}

function atualizarRodada(raiz: string, threadId: string, rodadaId: string,
  mudar: (atual: EstadoVerifyMcp) => EstadoVerifyMcp): EstadoVerifyMcp {
  return comLockHitl(raiz, threadId, () => {
    const dir = diretorioDasRodadas(raiz, threadId, false);
    const atual = lerEstado(dir, threadId, rodadaId);
    const proximo = mudar(atual);
    gravarEstado(dir, proximo);
    return proximo;
  });
}

/** Entrada do processo destacado; exportada para o teste hermético executar a mesma rodada sem transporte. */
export function executarVerifyMcpWorker(raiz: string, threadId: string, rodadaId: string): EstadoVerifyMcpPublico {
  const dir = diretorioDasRodadas(raiz, threadId, false);
  let inicial = lerEstado(dir, threadId, rodadaId);
  const inicioAtual = inicioDoProcesso(process.pid);
  if (!inicial.processo || inicial.processo.pid !== process.pid ||
      (inicial.processo.inicio !== null && inicial.processo.inicio !== inicioAtual)) throw Error('mcp.verify.worker.identity');
  if (!mesmoLease(lerLease(raiz, inicial.lease.nome), inicial.lease)) throw Error('mcp.verify.worker.lease');
  const atualizar = (mudanca: Partial<EstadoVerifyMcp>) => {
    inicial = atualizarRodada(raiz, threadId, rodadaId, (atual) => {
      if (!mesmoLease(lerLease(raiz, atual.lease.nome), atual.lease))
        return { ...atual, estado: 'falhou', lane: null, atualizadaEm: new Date().toISOString(),
          falha: { motivo: 'verify.lease-perdida', detalhe: 'a lease da worktree mudou durante a rodada' } };
      return { ...atual, ...mudanca, atualizadaEm: new Date().toISOString() };
    });
    if (inicial.estado === 'falhou') throw Error(inicial.falha?.motivo ?? 'verify.worker-failed');
  };
  try {
    atualizar({ estado: 'na-fila', lane: 'fila-pesada' });
    const carregado = exigirManifesto(raiz);
    const resultado = comLocale('pt-BR', () => verificar(carregado, threadId, {
      operacao: 'mcp.verify',
      conducao: { canal: inicial.host, identidade: inicial.despacho,
        filaPesada: { esperarMs: ESPERA_DA_FILA_PESADA_MS, aoEsperar: (ocupantes) => atualizar({ estado: 'na-fila',
          lane: 'fila-pesada', ocupantes: ocupantes.map((o) => ({ operacao: o.operacao, thread: o.thread })) }) } },
      progresso: (lane) => atualizar({ estado: 'rodando', lane, ocupantes: undefined }),
    }));
    const locale = resolverLocale(carregado.manifesto.owner?.language).locale;
    const veredito: VereditoVerifyMcp = { ok: resultado.ok, commit: resultado.commit, motivos: resultado.motivos,
      check: resultado.check, texto: comLocale(locale, () => textoDoVerify(resultado)), resultado };
    atualizar({ estado: 'concluido', lane: null, veredito, falha: undefined, ocupantes: undefined });
  } catch (e) {
    try { atualizar({ estado: 'falhou', lane: null, falha: { motivo: 'verify.worker-failed', detalhe: (e as Error).message }, ocupantes: undefined }); }
    catch { /* a leitura abaixo projeta morte/falha; nunca inventa verde */ }
  } finally {
    inicial = lerEstado(dir, threadId, rodadaId);
    liberarLeaseExata(raiz, inicial);
  }
  return consultarVerifyMcp(raiz, threadId, rodadaId);
}

/**
 * Exclusão mútua entre processos sem depender de um utilitário do sistema.
 *
 * Cada aquisição publica um candidato de nome único. O ticket só ordena os
 * candidatos; idade nunca transfere propriedade. Um candidato alheio só é
 * removido quando a identidade do processo não existe mais ou pertence a
 * outra encarnação do PID.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null || !('code' in erro)) return undefined;
  const codigo = (erro as { code?: unknown }).code;
  return typeof codigo === 'string' ? codigo : undefined;
}
const interpretarJson = (texto: string): unknown => JSON.parse(texto) as unknown;

const CONTRATO = 'ork.trava-portatil/v1';
const MAX_BYTES = 4096;
const ESPERA_PADRAO_MS = 5000;
const PASSO_DE_ESPERA_MS = 20;
const MAX_RELEITURAS_INCONSISTENTES = 4;

interface Candidato {
  contrato: typeof CONTRATO;
  token: string;
  pid: number;
  uid: number | null;
  identidade: string;
  ticket: number;
  operacao: string;
  criadoEm: string;
}

export interface DonoDaTravaPortatil {
  pid: number;
  operacao: string;
  ticket: number;
}

export interface OpcoesDaTravaPortatil {
  esperarMs?: number;
  identidadeDoProcesso?: (pid: number) => string | null | undefined;
  agoraMonotonico?: () => number;
  dormir?: (ms: number) => void;
}

export interface TravaPortatil {
  readonly dono: DonoDaTravaPortatil;
  liberar(): void;
}

export class ErroDaTravaPortatil extends Error {
  constructor(readonly codigo: 'trava.portatil.ocupada' | 'trava.portatil.insegura' | 'trava.portatil.indisponivel', detalhe: string) {
    super(`${codigo}: ${detalhe}`);
    this.name = 'ErroDaTravaPortatil';
  }
}

function uidAtual(): number | null { return process.getuid?.() ?? null; }

function dormir(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function garantirDiretorio(dir: string): void {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  catch (e) { if (codigoDoErro(e) !== 'EEXIST') throw e; }
  const st = fs.lstatSync(dir);
  const uid = uidAtual();
  if (!st.isDirectory() || st.isSymbolicLink() || (uid !== null && st.uid !== uid) || (st.mode & 0o077) !== 0) {
    throw new ErroDaTravaPortatil('trava.portatil.insegura', 'diretório de candidatos não é privado');
  }
}

function sincronizarDiretorio(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function validarCandidato(valor: unknown): Candidato {
  const v = valor as Partial<Candidato> | null;
  if (!v || v.contrato !== CONTRATO || typeof v.token !== 'string' || !/^[a-f0-9-]{36}$/.test(v.token) ||
      !Number.isSafeInteger(v.pid) || (v.pid ?? 0) <= 0 ||
      !(v.uid === null || Number.isSafeInteger(v.uid)) || typeof v.identidade !== 'string' || v.identidade.length < 1 || v.identidade.length > 512 ||
      !Number.isSafeInteger(v.ticket) || (v.ticket ?? -1) < 0 || typeof v.operacao !== 'string' || v.operacao.length < 1 || v.operacao.length > 160 ||
      typeof v.criadoEm !== 'string' || !Number.isFinite(Date.parse(v.criadoEm))) {
    throw new ErroDaTravaPortatil('trava.portatil.insegura', 'candidato inválido');
  }
  return v as Candidato;
}

function lerCandidato(arquivo: string): { valor: Candidato; stat: fs.Stats } {
  let releiturasInconsistentes = 0;
  for (;;) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      const uid = uidAtual();
      // nlink=0 descreve o descritor que foi aberto, não o nome atual: o dono pode
      // ter publicado outro ticket por rename entre open e fstat. Conteúdo vazio
      // tem a mesma leitura conservadora para versões que ainda publicavam antes
      // de escrever. Fechar e reabrir o nome separa candidato removido de trocado.
      if (stat.nlink === 0 || stat.size === 0) {
        fs.closeSync(fd);
        fd = undefined;
        fs.lstatSync(arquivo);
        releiturasInconsistentes++;
        if (releiturasInconsistentes >= MAX_RELEITURAS_INCONSISTENTES) {
          throw new ErroDaTravaPortatil('trava.portatil.insegura', 'candidato permaneceu vazio ou instável');
        }
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES || (uid !== null && stat.uid !== uid) || (stat.mode & 0o077) !== 0) {
        throw new ErroDaTravaPortatil('trava.portatil.insegura', 'arquivo de candidato não é privado');
      }
      return { valor: validarCandidato(interpretarJson(fs.readFileSync(fd, 'utf8'))), stat };
    } catch (e) {
      if (codigoDoErro(e) === 'ENOENT') throw e;
      if (e instanceof ErroDaTravaPortatil) throw e;
      throw new ErroDaTravaPortatil('trava.portatil.insegura', 'candidato não pôde ser lido');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}

function gravarNovo(arquivo: string, valor: Candidato): void {
  const fd = fs.openSync(arquivo, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(valor)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function substituir(arquivo: string, valor: Candidato): void {
  const dir = path.dirname(arquivo);
  const temporario = path.join(dir, `.${path.basename(arquivo)}.${randomUUID()}.tmp`);
  try {
    gravarNovo(temporario, valor);
    fs.renameSync(temporario, arquivo);
    sincronizarDiretorio(dir);
  } finally {
    try { fs.unlinkSync(temporario); } catch (e) { if (codigoDoErro(e) !== 'ENOENT') throw e; }
  }
}

function identidadeLinux(pid: number): string | null | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const inicio = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    if (!inicio) return undefined;
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return `linux:${boot}:${inicio}`;
  } catch (e) {
    const codigo = codigoDoErro(e);
    if (codigo === 'ENOENT' || codigo === 'ESRCH') return null;
    return undefined;
  }
}

function identidadePorPs(pid: number): string | null | undefined {
  if (!fs.existsSync('/bin/ps')) return undefined;
  const existe = processoExiste(pid);
  if (existe === false) return null;
  const r = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC0' },
  });
  if (r.error || r.status !== 0) return processoExiste(pid) === false ? null : undefined;
  const inicio = r.status === 0 ? r.stdout.trim().replace(/\s+/g, ' ') : '';
  if (inicio) return `ps:${inicio}`;
  return processoExiste(pid) === false ? null : undefined;
}

/** `false` prova ESRCH; falta de permissão prova que o PID existe. */
function processoExiste(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (e) {
    const codigo = codigoDoErro(e);
    if (codigo === 'ESRCH') return false;
    if (codigo === 'EPERM') return true;
    return undefined;
  }
}

/** Identidade da encarnação do PID; `null` prova ausência, `undefined` não prova nada. */
export function identidadeDoProcesso(pid: number): string | null | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') return identidadeLinux(pid);
  if (process.platform === 'darwin') return identidadePorPs(pid);
  return undefined;
}

function listar(dir: string): Array<{ arquivo: string; valor: Candidato; stat: fs.Stats }> {
  const nomes = fs.readdirSync(dir).filter((nome) => /^[a-f0-9-]{36}\.json$/.test(nome)).sort();
  const itens: Array<{ arquivo: string; valor: Candidato; stat: fs.Stats }> = [];
  for (const nome of nomes) {
    const arquivo = path.join(dir, nome);
    try { itens.push({ arquivo, ...lerCandidato(arquivo) }); }
    catch (e) { if (codigoDoErro(e) !== 'ENOENT') throw e; }
  }
  return itens;
}

function removerSeMorto(arquivo: string, esperado: Candidato, statEsperado: fs.Stats,
  consultar: (pid: number) => string | null | undefined): boolean {
  const identidade = consultar(esperado.pid);
  if (identidade === undefined || identidade === esperado.identidade) return false;
  try {
    const atual = lerCandidato(arquivo);
    if (atual.valor.token !== esperado.token || atual.stat.dev !== statEsperado.dev || atual.stat.ino !== statEsperado.ino) return false;
    fs.unlinkSync(arquivo);
    sincronizarDiretorio(path.dirname(arquivo));
    return true;
  } catch (e) {
    if (codigoDoErro(e) === 'ENOENT') return true;
    throw e;
  }
}

function limparMortos(dir: string, proprioToken: string,
  consultar: (pid: number) => string | null | undefined): Array<{ arquivo: string; valor: Candidato; stat: fs.Stats }> {
  for (const item of listar(dir)) {
    if (item.valor.token !== proprioToken) removerSeMorto(item.arquivo, item.valor, item.stat, consultar);
  }
  return listar(dir);
}

function apagarProprio(arquivo: string, token: string): void {
  try {
    if (lerCandidato(arquivo).valor.token !== token) return;
    fs.unlinkSync(arquivo);
    sincronizarDiretorio(path.dirname(arquivo));
  } catch (e) { if (codigoDoErro(e) !== 'ENOENT') throw e; }
}

/** Adquire a trava ou devolve `null` quando o prazo termina sem transferir propriedade. */
export function adquirirTravaPortatil(alvo: string, operacao: string,
  opcoes: OpcoesDaTravaPortatil = {}): TravaPortatil | null {
  if (!path.isAbsolute(alvo) || !operacao.trim() || operacao.length > 160) {
    throw new ErroDaTravaPortatil('trava.portatil.insegura', 'alvo absoluto e operação válida são obrigatórios');
  }
  const consultar = opcoes.identidadeDoProcesso ?? identidadeDoProcesso;
  const identidade = consultar(process.pid);
  if (!identidade) throw new ErroDaTravaPortatil('trava.portatil.indisponivel', 'identidade do processo dono não pôde ser provada');
  const dir = `${alvo}.ork-lock`;
  garantirDiretorio(dir);
  const token = randomUUID();
  const arquivo = path.join(dir, `${token}.json`);
  let candidato: Candidato = {
    contrato: CONTRATO, token, pid: process.pid, uid: uidAtual(), identidade,
    ticket: 0, operacao: operacao.trim(), criadoEm: new Date().toISOString(),
  };
  // O nome final só aparece depois de conteúdo, fsync e fechamento. Leitores
  // nunca observam o intervalo normal entre O_EXCL e a primeira escrita.
  substituir(arquivo, candidato);
  let publicado = true;
  try {
    const existentes = limparMortos(dir, token, consultar);
    const maior = existentes.reduce((n, item) => Math.max(n, item.valor.ticket), 0);
    if (maior >= Number.MAX_SAFE_INTEGER) throw new ErroDaTravaPortatil('trava.portatil.insegura', 'espaço de tickets esgotado');
    candidato = { ...candidato, ticket: maior + 1 };
    substituir(arquivo, candidato);

    const agora = opcoes.agoraMonotonico ?? (() => performance.now());
    const pausa = opcoes.dormir ?? dormir;
    const esperarMs = Math.max(0, opcoes.esperarMs ?? ESPERA_PADRAO_MS);
    const prazo = agora() + esperarMs;
    for (;;) {
      const ativos = limparMortos(dir, token, consultar);
      const algumEscolhendo = ativos.some((item) => item.valor.token !== token && item.valor.ticket === 0);
      const ordenados = ativos.filter((item) => item.valor.ticket > 0)
        .sort((a, b) => a.valor.ticket - b.valor.ticket || a.valor.token.localeCompare(b.valor.token));
      if (!algumEscolhendo && ordenados[0]?.valor.token === token) {
        publicado = false;
        let liberada = false;
        return {
          dono: { pid: candidato.pid, operacao: candidato.operacao, ticket: candidato.ticket },
          liberar: () => { if (!liberada) { liberada = true; apagarProprio(arquivo, token); } },
        };
      }
      const restante = prazo - agora();
      if (restante <= 0) return null;
      pausa(Math.min(PASSO_DE_ESPERA_MS, restante));
    }
  } finally { if (publicado) apagarProprio(arquivo, token); }
}

export function comTravaPortatil<T>(alvo: string, operacao: string, executar: () => T,
  opcoes: OpcoesDaTravaPortatil = {}): T {
  const trava = adquirirTravaPortatil(alvo, operacao, opcoes);
  if (!trava) throw new ErroDaTravaPortatil('trava.portatil.ocupada', `prazo esgotado em ${operacao}`);
  try { return executar(); } finally { trava.liberar(); }
}

/** Consulta para diagnóstico; não altera candidatos vivos nem expõe identidade. */
export function donosDaTravaPortatil(alvo: string,
  consultar: (pid: number) => string | null | undefined = identidadeDoProcesso): DonoDaTravaPortatil[] {
  const dir = `${alvo}.ork-lock`;
  if (!fs.existsSync(dir)) return [];
  return limparMortos(dir, '', consultar).filter((item) => item.valor.ticket > 0)
    .map((item) => ({ pid: item.valor.pid, operacao: item.valor.operacao, ticket: item.valor.ticket }));
}

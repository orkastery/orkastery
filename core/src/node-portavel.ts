/**
 * Superfície tipada mínima do runtime Node usada pelo núcleo portátil.
 *
 * O security scan analisa um worktree destacado, sem `node_modules`. Por isso
 * estes módulos não podem depender da descoberta incidental de `@types/node`
 * para que os valores importados deixem de ser `any`. A fachada descreve só as
 * operações realmente usadas e preserva os imports de runtime do próprio Node.
 */
import * as fsSemTipo from 'node:fs';
import * as pathSemTipo from 'node:path';
import { createHash as createHashSemTipo, randomUUID as randomUUIDSemTipo } from 'node:crypto';
import { spawnSync as spawnSyncSemTipo } from 'node:child_process';
import { performance as performanceSemTipo } from 'node:perf_hooks';
import { Worker as WorkerSemTipo } from 'node:worker_threads';

export type PlataformaNode = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' |
  'netbsd' | 'openbsd' | 'sunos' | 'win32' | 'cygwin';

export interface EstatisticaDeArquivo {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly nlink: number;
  readonly uid: number;
  readonly size: number;
  readonly mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface ConstantesDeArquivo {
  readonly O_RDONLY: number;
  readonly O_WRONLY: number;
  readonly O_CREAT: number;
  readonly O_EXCL: number;
  readonly O_NOFOLLOW: number;
  readonly O_NONBLOCK: number;
  readonly O_RDWR: number;
}

interface SistemaDeArquivos {
  readonly constants: ConstantesDeArquivo;
  closeSync(fd: number): void;
  existsSync(caminho: string): boolean;
  fstatSync(fd: number): EstatisticaDeArquivo;
  fsyncSync(fd: number): void;
  ftruncateSync(fd: number, tamanho?: number): void;
  lstatSync(caminho: string): EstatisticaDeArquivo;
  mkdirSync(caminho: string, opcoes: { recursive: true; mode: number }): string | undefined;
  openSync(caminho: string, flags: string | number, mode?: number): number;
  readFileSync(caminho: string | number, codificacao: 'utf8'): string;
  readdirSync(caminho: string): string[];
  readlinkSync(caminho: string): string;
  realpathSync(caminho: string): string;
  renameSync(origem: string, destino: string): void;
  rmSync(caminho: string, opcoes: { force: true }): void;
  statSync(caminho: string, opcoes: { throwIfNoEntry: false }): EstatisticaDeArquivo | undefined;
  unlinkSync(caminho: string): void;
  writeFileSync(caminho: string | number, dados: string | Uint8Array, opcoes?: unknown): void;
  writeSync(fd: number, dados: string, posicao?: number | null, codificacao?: string): number;
  writeSync(fd: number, dados: Uint8Array, deslocamento: number, tamanho: number, posicao: number | null): number;
}

interface Caminhos {
  basename(caminho: string): string;
  dirname(caminho: string): string;
  isAbsolute(caminho: string): boolean;
  join(...partes: string[]): string;
  resolve(...partes: string[]): string;
}

type EntradaStdio = 'ignore' | 'pipe' | 'inherit' | number;

interface OpcoesDeProcessoFilho {
  encoding?: 'utf8';
  timeout?: number;
  stdio?: EntradaStdio | readonly EntradaStdio[];
  env?: Record<string, string | undefined>;
}

interface ResultadoDeProcessoFilho {
  readonly error?: Error;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface HashTipado {
  update(valor: string): HashTipado;
  digest(codificacao: 'hex'): string;
}

interface PerformanceTipada { now(): number }

export interface WorkerTipado {
  postMessage(valor: unknown): void;
  terminate(): Promise<number>;
  unref(): void;
}

interface ConstrutorDeWorker {
  new(codigo: string, opcoes: { eval: true; workerData: Record<string, string | number> }): WorkerTipado;
}

export interface ProcessoTipado {
  readonly pid: number;
  readonly ppid: number;
  readonly platform: PlataformaNode;
  readonly env: Record<string, string | undefined>;
  cwd(): string;
  getuid?: () => number;
  kill(pid: number, sinal: 0): boolean;
}

interface BufferTipado { from(valor: string, codificacao: 'utf8'): Uint8Array }

export const fs = fsSemTipo as unknown as SistemaDeArquivos;
export const path = pathSemTipo as unknown as Caminhos;
export const randomUUID = randomUUIDSemTipo as unknown as () => string;
export const createHash = createHashSemTipo as unknown as (algoritmo: 'sha256') => HashTipado;
export const spawnSync = spawnSyncSemTipo as unknown as
  (comando: string, argumentos: string[], opcoes: OpcoesDeProcessoFilho) => ResultadoDeProcessoFilho;
export const performance = performanceSemTipo as unknown as PerformanceTipada;
export const Worker = WorkerSemTipo as unknown as ConstrutorDeWorker;
export const processo = (globalThis as unknown as { process: ProcessoTipado }).process;
export const buffer = (globalThis as unknown as { Buffer: BufferTipado }).Buffer;

export function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null || !('code' in erro)) return undefined;
  const codigo = (erro as { code?: unknown }).code;
  return typeof codigo === 'string' ? codigo : undefined;
}

export function interpretarJson(texto: string): unknown {
  return JSON.parse(texto) as unknown;
}

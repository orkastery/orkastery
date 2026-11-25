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
import * as osSemTipo from 'node:os';
import { createHash as createHashSemTipo, randomUUID as randomUUIDSemTipo } from 'node:crypto';
import { spawn as spawnSemTipo, spawnSync as spawnSyncSemTipo } from 'node:child_process';
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
  readonly gid: number;
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
  appendFileSync(caminho: string, dados: string, opcoes?: unknown): void;
  closeSync(fd: number): void;
  existsSync(caminho: string): boolean;
  fstatSync(fd: number): EstatisticaDeArquivo;
  fsyncSync(fd: number): void;
  ftruncateSync(fd: number, tamanho?: number): void;
  lstatSync(caminho: string): EstatisticaDeArquivo;
  lstatSync(caminho: string, opcoes: { throwIfNoEntry: false }): EstatisticaDeArquivo | undefined;
  mkdirSync(caminho: string, opcoes: { recursive: true; mode: number }): string | undefined;
  mkdtempSync(prefixo: string): string;
  openSync(caminho: string, flags: string | number, mode?: number): number;
  readFileSync(caminho: string | number, codificacao: 'utf8'): string;
  readdirSync(caminho: string): string[];
  readlinkSync(caminho: string): string;
  realpathSync(caminho: string): string;
  renameSync(origem: string, destino: string): void;
  rmdirSync(caminho: string): void;
  rmSync(caminho: string, opcoes: { recursive?: boolean; force: boolean }): void;
  statSync(caminho: string): EstatisticaDeArquivo;
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
  parse(caminho: string): { root: string };
  relative(de: string, para: string): string;
  resolve(...partes: string[]): string;
  readonly sep: string;
}

interface SistemaOperacional {
  availableParallelism(): number;
  tmpdir(): string;
}

type EntradaStdio = 'ignore' | 'pipe' | 'inherit' | number;

interface OpcoesDeProcessoFilho {
  cwd?: string;
  encoding?: 'utf8';
  input?: string;
  killSignal?: string;
  maxBuffer?: number;
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

export interface ErroDeProcessoFilho extends Error { readonly code?: string }

interface ProcessoFilhoTipado {
  readonly pid?: number;
  on(evento: 'error', listener: (erro: ErroDeProcessoFilho) => void): ProcessoFilhoTipado;
  on(evento: 'close', listener: (codigo: number | null, sinal: string | null) => void): ProcessoFilhoTipado;
}

interface OpcoesDeSpawn {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: readonly EntradaStdio[];
  timeout?: number;
  killSignal?: string;
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
  readonly execPath: string;
  cwd(): string;
  getuid?: () => number;
  kill(pid: number, sinal: 0): boolean;
}

interface BufferTipado { from(valor: string, codificacao: 'utf8'): Uint8Array }

export const fs = fsSemTipo as unknown as SistemaDeArquivos;
export const path = pathSemTipo as unknown as Caminhos;
export const os = osSemTipo as unknown as SistemaOperacional;
export const randomUUID = randomUUIDSemTipo as unknown as () => string;
export const createHash = createHashSemTipo as unknown as (algoritmo: 'sha256') => HashTipado;
export const spawnSync = spawnSyncSemTipo as unknown as
  (comando: string, argumentos: string[], opcoes: OpcoesDeProcessoFilho) => ResultadoDeProcessoFilho;
export const spawn = spawnSemTipo as unknown as
  (comando: string, argumentos: string[], opcoes: OpcoesDeSpawn) => ProcessoFilhoTipado;
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

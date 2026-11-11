/** RM-090 F2: leitura do prompt carimbado e remoção local antes do mapeamento OTLP. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { redigirRepresentacoesDeSegredo } from './policies';

export const MAXIMO_DO_PROMPT_TELEMETRIA = 4 * 1024 * 1024;
export const VERSAO_DA_REMOCAO_DO_PROMPT = 'ork.telemetria-redacao/v1' as const;

export type MotivoDaLacunaDoPrompt = 'metadata_missing' | 'file_missing' | 'unsafe_path' |
  'invalid_type' | 'too_large' | 'invalid_encoding' | 'hash_mismatch';
export type MotivoRetentavelDoPrompt = 'prompt_io_transient' | 'prompt_redaction_failed';

export type ResultadoDoPrompt =
  | { estado: 'conteudo'; texto: string; tamanhoOriginal: number; tamanhoExportado: number;
      versaoDaRemocao: typeof VERSAO_DA_REMOCAO_DO_PROMPT }
  | { estado: 'lacuna'; motivo: MotivoDaLacunaDoPrompt }
  | { estado: 'bloqueio'; motivo: MotivoRetentavelDoPrompt };

export interface RedacaoPrivadaDoPrompt { ok: boolean; texto?: string; erro?: string }
export type RedatorPrivadoDoPrompt = (texto: string) => RedacaoPrivadaDoPrompt;

export interface ArquivosDoPrompt {
  realpath(caminho: string): string;
  realpathDoDescritor(fd: number): string;
  lstat(caminho: string): fs.Stats;
  abrir(caminho: string, flags: number): number;
  fstat(fd: number): fs.Stats;
  ler(fd: number, buffer: Buffer, offset: number, tamanho: number, posicao: number): number;
  fechar(fd: number): void;
}

export const arquivosDoPromptNoNode: ArquivosDoPrompt = {
  realpath: (caminho) => fs.realpathSync.native(caminho),
  // O caminho do descritor prende a contenção ao objeto que foi realmente aberto, não ao nome
  // que pode ser trocado entre lstat e open. Sem /proc, a preparação recusa de forma segura.
  realpathDoDescritor: (fd) => fs.realpathSync.native(`/proc/self/fd/${fd}`),
  lstat: (caminho) => fs.lstatSync(caminho),
  abrir: (caminho, flags) => fs.openSync(caminho, flags),
  fstat: (fd) => fs.fstatSync(fd),
  ler: (fd, buffer, offset, tamanho, posicao) => fs.readSync(fd, buffer, offset, tamanho, posicao),
  fechar: (fd) => fs.closeSync(fd),
};

function contido(raiz: string, candidato: string): boolean {
  const relativo = path.relative(raiz, candidato);
  return relativo === '' || (!relativo.startsWith(`..${path.sep}`) && relativo !== '..' && !path.isAbsolute(relativo));
}

function codigoDoErro(erro: unknown): string {
  return typeof (erro as NodeJS.ErrnoException | undefined)?.code === 'string'
    ? String((erro as NodeJS.ErrnoException).code) : '';
}

function falhaDeArquivo(erro: unknown): ResultadoDoPrompt {
  const codigo = codigoDoErro(erro);
  if (codigo === 'ENOENT') return { estado: 'lacuna', motivo: 'file_missing' };
  if (codigo === 'ELOOP' || codigo === 'ENOTDIR') return { estado: 'lacuna', motivo: 'unsafe_path' };
  return { estado: 'bloqueio', motivo: 'prompt_io_transient' };
}

function ancestraisSemLink(raiz: string, arquivo: string, io: ArquivosDoPrompt): ResultadoDoPrompt | null {
  const relativo = path.relative(raiz, arquivo);
  const partes = relativo.split(path.sep).filter(Boolean);
  let atual = raiz;
  for (const parte of partes.slice(0, -1)) {
    atual = path.join(atual, parte);
    try {
      const st = io.lstat(atual);
      if (st.isSymbolicLink() || !st.isDirectory()) return { estado: 'lacuna', motivo: 'unsafe_path' };
    } catch (erro) { return falhaDeArquivo(erro); }
  }
  return null;
}

function lerAteOTeto(fd: number, io: ArquivosDoPrompt, teto: number): Buffer {
  const buffer = Buffer.alloc(teto + 1);
  let total = 0;
  while (total < buffer.length) {
    const lidos = io.ler(fd, buffer, total, buffer.length - total, total);
    if (lidos === 0) break;
    total += lidos;
  }
  return buffer.subarray(0, total);
}

function decodificarUtf8(bytes: Buffer): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
}

export interface EntradaDoPrompt {
  raizProjeto: string;
  raizPrompts: string;
  promptPath?: unknown;
  promptSha256?: unknown;
  redigirPrivado: RedatorPrivadoDoPrompt;
  arquivos?: ArquivosDoPrompt;
  teto?: number;
}

/**
 * Toda decisão sobre tipo, limite, bytes e hash vem do mesmo descritor. O retorno contém somente
 * conteúdo já removido ou enums seguros; caminho, hash, termo e valor encontrado nunca saem daqui.
 */
export function prepararPrompt(entrada: EntradaDoPrompt): ResultadoDoPrompt {
  if (typeof entrada.promptPath !== 'string' || !entrada.promptPath.trim() ||
      typeof entrada.promptSha256 !== 'string' || !/^[0-9a-f]{64}$/iu.test(entrada.promptSha256)) {
    return { estado: 'lacuna', motivo: 'metadata_missing' };
  }
  const io = entrada.arquivos ?? arquivosDoPromptNoNode;
  const teto = entrada.teto ?? MAXIMO_DO_PROMPT_TELEMETRIA;
  const raizLexica = path.resolve(entrada.raizPrompts);
  const arquivo = path.isAbsolute(entrada.promptPath)
    ? path.resolve(entrada.promptPath) : path.resolve(entrada.raizProjeto, entrada.promptPath);
  if (!contido(raizLexica, arquivo)) return { estado: 'lacuna', motivo: 'unsafe_path' };

  let raizCanonica: string;
  try { raizCanonica = io.realpath(raizLexica); }
  catch (erro) { return falhaDeArquivo(erro); }
  const ancestral = ancestraisSemLink(raizLexica, arquivo, io);
  if (ancestral) return ancestral;

  let fd: number;
  try { fd = io.abrir(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (erro) { return falhaDeArquivo(erro); }
  try {
    let aberto: string, stat: fs.Stats;
    try { aberto = io.realpathDoDescritor(fd); stat = io.fstat(fd); }
    catch (erro) { return falhaDeArquivo(erro); }
    const esperado = path.resolve(raizCanonica, path.relative(raizLexica, arquivo));
    if (!contido(raizCanonica, aberto) || aberto !== esperado) return { estado: 'lacuna', motivo: 'unsafe_path' };
    if (!stat.isFile()) return { estado: 'lacuna', motivo: 'invalid_type' };
    if (stat.size > teto) return { estado: 'lacuna', motivo: 'too_large' };

    let bytes: Buffer;
    try { bytes = lerAteOTeto(fd, io, teto); }
    catch (erro) { return falhaDeArquivo(erro); }
    if (bytes.length > teto) return { estado: 'lacuna', motivo: 'too_large' };
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha.toLowerCase() !== entrada.promptSha256.toLowerCase()) {
      return { estado: 'lacuna', motivo: 'hash_mismatch' };
    }
    const texto = decodificarUtf8(bytes);
    if (texto === null) return { estado: 'lacuna', motivo: 'invalid_encoding' };

    const semSegredo = redigirRepresentacoesDeSegredo(texto, '[segredo omitido]', teto);
    if (!semSegredo.ok) return { estado: 'bloqueio', motivo: 'prompt_redaction_failed' };
    let privado: RedacaoPrivadaDoPrompt;
    try { privado = entrada.redigirPrivado(semSegredo.texto); }
    catch { return { estado: 'bloqueio', motivo: 'prompt_redaction_failed' }; }
    if (!privado.ok || typeof privado.texto !== 'string') {
      return { estado: 'bloqueio', motivo: 'prompt_redaction_failed' };
    }
    const posCondicao = redigirRepresentacoesDeSegredo(privado.texto, '[segredo omitido]', teto);
    if (!posCondicao.ok || posCondicao.total > 0) {
      return { estado: 'bloqueio', motivo: 'prompt_redaction_failed' };
    }
    return { estado: 'conteudo', texto: privado.texto, tamanhoOriginal: bytes.length,
      tamanhoExportado: Buffer.byteLength(privado.texto), versaoDaRemocao: VERSAO_DA_REMOCAO_DO_PROMPT };
  } finally {
    try { io.fechar(fd); } catch { /* descritor já fechado: nenhum dado entra no retorno */ }
  }
}

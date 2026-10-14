/** RM-064 T4: o trabalho pequeno da sessão acompanha a thread entre contas. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirThread } from './thread';

export const LIMITE_DE_ARQUIVO_DO_TRABALHO = 256 * 1024;
export const LIMITE_TOTAL_DO_TRABALHO = 512 * 1024;
export const LIMITE_DE_ARQUIVOS_DO_TRABALHO = 24;
const LIMITE_DE_ENTRADAS = 256;
const PROFUNDIDADE_MAXIMA = 4;

export interface ArquivoDoTrabalho {
  arquivo: string;
  bytes: number;
  sha256: string;
}

export interface ResumoDoTrabalho {
  caminho: string;
  arquivos: ArquivoDoTrabalho[];
  ignorados: { grandes: number; links: number; excedentes: number; outros: number };
}

export interface OpcoesDoResumoDoTrabalho {
  /** Ponto de sincronização usado só por provas de troca da entrada entre inspeção e abertura. */
  antesDeAbrir?: (arquivo: string) => void;
}

/** Caminho real no estado canônico. O prompt usa a forma relativa e portátil de `caminhoDoTrabalho`. */
export function diretorioDoTrabalho(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), 'trabalho');
}

export function caminhoDoTrabalho(threadId: string): string {
  return `.orkastery/threads/${threadId}/trabalho/`;
}

interface DiretorioDoTrabalhoAberto { diretorio: string; real: string; fd: number }

function abrirDiretorioDoTrabalho(raiz: string, threadId: string): DiretorioDoTrabalhoAberto {
  const diretorio = diretorioDoTrabalho(raiz, threadId);
  fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 });
  let fd: number;
  try { fd = fs.openSync(diretorio, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY); }
  catch { throw new Error('trabalho da thread precisa ser diretorio real, nunca link'); }
  try {
    const aberto = fs.fstatSync(fd);
    if (!aberto.isDirectory()) throw new Error('trabalho da thread precisa ser diretorio real, nunca link');
    // `mode` de mkdir só vale na criação. Pelo descritor, uma troca de caminho não aplica modo em outro alvo.
    fs.fchmodSync(fd, 0o700);
    const real = fs.realpathSync(diretorio), peloCaminho = fs.statSync(real);
    if (aberto.dev !== peloCaminho.dev || aberto.ino !== peloCaminho.ino)
      throw new Error('trabalho da thread mudou durante a abertura');
    return { diretorio, real, fd };
  } catch (erro) { fs.closeSync(fd); throw erro; }
}

export function garantirDiretorioDoTrabalho(raiz: string, threadId: string): string {
  const aberto = abrirDiretorioDoTrabalho(raiz, threadId);
  fs.closeSync(aberto.fd);
  const { diretorio } = aberto;
  return diretorio;
}

function nomeSeguro(nome: string): string {
  return nome.replace(/[\u0000-\u001f\u007f]/g, '?');
}

const contido = (base: string, alvo: string): boolean => alvo === base || alvo.startsWith(base + path.sep);

type LeituraSegura = { estado: 'ok'; conteudo: Buffer } | { estado: 'grande' | 'link' | 'outro' };

/** Abre a entrada sem seguir o componente final e nunca lê mais que o teto mais um byte. */
function lerArquivoSeguro(baseReal: string, absoluto: string, opcoes: OpcoesDoResumoDoTrabalho): LeituraSegura {
  try {
    const antes = fs.realpathSync(absoluto);
    if (!contido(baseReal, antes)) return { estado: 'link' };
  } catch { return { estado: 'outro' }; }
  opcoes.antesDeAbrir?.(absoluto);
  let fd: number;
  try {
    fd = fs.openSync(absoluto, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (erro) {
    return { estado: (erro as NodeJS.ErrnoException).code === 'ELOOP' ? 'link' : 'outro' };
  }
  try {
    const inicial = fs.fstatSync(fd);
    if (!inicial.isFile()) return { estado: 'outro' };
    if (inicial.size > LIMITE_DE_ARQUIVO_DO_TRABALHO) return { estado: 'grande' };
    const buffer = Buffer.alloc(LIMITE_DE_ARQUIVO_DO_TRABALHO + 1);
    let lidos = 0;
    while (lidos < buffer.length) {
      const n = fs.readSync(fd, buffer, lidos, buffer.length - lidos, null);
      if (n === 0) break;
      lidos += n;
    }
    const final = fs.fstatSync(fd);
    if (lidos > LIMITE_DE_ARQUIVO_DO_TRABALHO || final.size > LIMITE_DE_ARQUIVO_DO_TRABALHO)
      return { estado: 'grande' };
    // Confere que o caminho ainda aponta para o mesmo inode aberto e continua dentro da pasta.
    let peloCaminho: fs.Stats, realDepois: string;
    try { realDepois = fs.realpathSync(absoluto); peloCaminho = fs.statSync(realDepois); }
    catch { return { estado: 'outro' }; }
    if (!contido(baseReal, realDepois) || peloCaminho.dev !== final.dev || peloCaminho.ino !== final.ino)
      return { estado: 'link' };
    // Mudança durante a leitura não produz hash de estado híbrido.
    if (lidos !== final.size || inicial.size !== final.size || inicial.mtimeMs !== final.mtimeMs || inicial.ctimeMs !== final.ctimeMs)
      return { estado: 'outro' };
    return { estado: 'ok', conteudo: buffer.subarray(0, lidos) };
  } finally { fs.closeSync(fd); }
}

/**
 * Inventário deliberadamente limitado: não segue links, lê cada arquivo por descritor limitado e não deixa uma árvore
 * de job dominar o prompt. A sessão sucessora recebe nomes, tamanhos e hashes; lê o arquivo pelo caminho se precisar.
 */
export function resumirTrabalhoDaThread(raiz: string, threadId: string,
  opcoes: OpcoesDoResumoDoTrabalho = {}): ResumoDoTrabalho {
  const aberto = abrirDiretorioDoTrabalho(raiz, threadId);
  const base = aberto.diretorio, baseReal = aberto.real;
  const arquivos: ArquivoDoTrabalho[] = [];
  const ignorados = { grandes: 0, links: 0, excedentes: 0, outros: 0 };
  let bytes = 0;
  let entradas = 0;

  const visitar = (diretorio: string, relativo: string, profundidade: number): void => {
    if (profundidade > PROFUNDIDADE_MAXIMA || entradas >= LIMITE_DE_ENTRADAS) {
      ignorados.excedentes += 1;
      return;
    }
    let dir: fs.Dir;
    try {
      const real = fs.realpathSync(diretorio);
      if (!contido(baseReal, real) || !fs.lstatSync(diretorio).isDirectory()) { ignorados.links += 1; return; }
      dir = fs.opendirSync(diretorio);
    } catch { ignorados.outros += 1; return; }
    const itens: fs.Dirent[] = [];
    try {
      while (entradas + itens.length < LIMITE_DE_ENTRADAS) {
        const item = dir.readSync();
        if (!item) break;
        itens.push(item);
      }
      if (entradas + itens.length >= LIMITE_DE_ENTRADAS && dir.readSync()) ignorados.excedentes += 1;
    } finally { dir.closeSync(); }
    entradas += itens.length;
    itens.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const item of itens) {
      const absoluto = path.join(diretorio, item.name);
      const nome = path.posix.join(relativo, nomeSeguro(item.name));
      if (item.isSymbolicLink()) { ignorados.links += 1; continue; }
      if (item.isDirectory()) { visitar(absoluto, nome, profundidade + 1); continue; }
      if (!item.isFile()) { ignorados.outros += 1; continue; }
      const leitura = lerArquivoSeguro(baseReal, absoluto, opcoes);
      if (leitura.estado !== 'ok') {
        if (leitura.estado === 'grande') ignorados.grandes += 1;
        else if (leitura.estado === 'link') ignorados.links += 1;
        else ignorados.outros += 1;
        continue;
      }
      if (arquivos.length >= LIMITE_DE_ARQUIVOS_DO_TRABALHO || bytes + leitura.conteudo.byteLength > LIMITE_TOTAL_DO_TRABALHO) {
        ignorados.excedentes += 1;
        continue;
      }
      arquivos.push({ arquivo: nome, bytes: leitura.conteudo.byteLength,
        sha256: createHash('sha256').update(leitura.conteudo).digest('hex') });
      bytes += leitura.conteudo.byteLength;
    }
  };

  try {
    visitar(base, '', 0);
    return { caminho: caminhoDoTrabalho(threadId), arquivos, ignorados };
  } finally { fs.closeSync(aberto.fd); }
}

export function formatarResumoDoTrabalho(resumo: ResumoDoTrabalho): string {
  const linhas = resumo.arquivos.length
    ? resumo.arquivos.map((a) => `  - \`${a.arquivo.replace(/`/g, '\\`')}\` (${a.bytes} bytes, sha256 \`${a.sha256}\`)`)
    : ['  - (nenhum arquivo pequeno)'];
  const totalIgnorado = Object.values(resumo.ignorados).reduce((soma, n) => soma + n, 0);
  if (totalIgnorado > 0) {
    linhas.push(`  - Ignorados pelos limites: ${resumo.ignorados.grandes} grandes, ${resumo.ignorados.links} links, ` +
      `${resumo.ignorados.excedentes} excedentes, ${resumo.ignorados.outros} outros.`);
  }
  return linhas.join('\n');
}

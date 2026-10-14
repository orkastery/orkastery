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

/** Caminho real no estado canônico. O prompt usa a forma relativa e portátil de `caminhoDoTrabalho`. */
export function diretorioDoTrabalho(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), 'trabalho');
}

export function caminhoDoTrabalho(threadId: string): string {
  return `.orkastery/threads/${threadId}/trabalho/`;
}

export function garantirDiretorioDoTrabalho(raiz: string, threadId: string): string {
  const diretorio = diretorioDoTrabalho(raiz, threadId);
  fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 });
  return diretorio;
}

function nomeSeguro(nome: string): string {
  return nome.replace(/[\u0000-\u001f\u007f]/g, '?');
}

/**
 * Inventário deliberadamente limitado: não segue links, não lê conteúdo e não deixa uma árvore de job dominar
 * o prompt. A sessão sucessora recebe nomes, tamanhos e hashes; lê o arquivo pelo caminho apenas se precisar.
 */
export function resumirTrabalhoDaThread(raiz: string, threadId: string): ResumoDoTrabalho {
  const base = garantirDiretorioDoTrabalho(raiz, threadId);
  const arquivos: ArquivoDoTrabalho[] = [];
  const ignorados = { grandes: 0, links: 0, excedentes: 0, outros: 0 };
  let bytes = 0;
  let entradas = 0;

  const visitar = (diretorio: string, relativo: string, profundidade: number): void => {
    if (profundidade > PROFUNDIDADE_MAXIMA || entradas >= LIMITE_DE_ENTRADAS) {
      ignorados.excedentes += 1;
      return;
    }
    let itens: fs.Dirent[];
    try { itens = fs.readdirSync(diretorio, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { ignorados.outros += 1; return; }
    for (const item of itens) {
      entradas += 1;
      if (entradas > LIMITE_DE_ENTRADAS) { ignorados.excedentes += 1; break; }
      const absoluto = path.join(diretorio, item.name);
      const nome = path.posix.join(relativo, nomeSeguro(item.name));
      if (item.isSymbolicLink()) { ignorados.links += 1; continue; }
      if (item.isDirectory()) { visitar(absoluto, nome, profundidade + 1); continue; }
      if (!item.isFile()) { ignorados.outros += 1; continue; }
      let stat: fs.Stats;
      try { stat = fs.statSync(absoluto); } catch { ignorados.outros += 1; continue; }
      if (stat.size > LIMITE_DE_ARQUIVO_DO_TRABALHO) { ignorados.grandes += 1; continue; }
      if (arquivos.length >= LIMITE_DE_ARQUIVOS_DO_TRABALHO || bytes + stat.size > LIMITE_TOTAL_DO_TRABALHO) {
        ignorados.excedentes += 1;
        continue;
      }
      let conteudo: Buffer;
      try { conteudo = fs.readFileSync(absoluto); } catch { ignorados.outros += 1; continue; }
      arquivos.push({ arquivo: nome, bytes: conteudo.byteLength, sha256: createHash('sha256').update(conteudo).digest('hex') });
      bytes += conteudo.byteLength;
    }
  };

  visitar(base, '', 0);
  return { caminho: caminhoDoTrabalho(threadId), arquivos, ignorados };
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

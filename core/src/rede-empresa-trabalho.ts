/** RM-089 F3: caminhos públicos de um trabalho coletivo. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAX_CAMINHOS_POR_TRABALHO_EMPRESA, type CaminhoPublicado,
  type FonteDoCaminhoPublicado } from './rede-empresa-contrato';
import { dirThread, lerThread } from './thread';
import { exec } from './util';

export interface CaminhoDoTrabalho {
  padrao: string;
  fontes: readonly FonteDoCaminhoPublicado[];
}

export type CaminhosPorThread = Readonly<Record<string, readonly CaminhoDoTrabalho[]>>;

const ORDEM_DA_FONTE: readonly FonteDoCaminhoPublicado[] = ['plan', 'lease', 'diff'];

/** Normaliza somente metadados relativos. Conteúdo, home, worktree e identificadores locais não entram no contrato. */
export function normalizarCaminhosDoTrabalho(entradas: readonly CaminhoDoTrabalho[]): CaminhoPublicado[] | null {
  const porPadrao = new Map<string, Set<FonteDoCaminhoPublicado>>();
  for (const entrada of entradas) {
    const padrao = entrada.padrao.trim().replace(/^\.\//, '');
    const segmentos = padrao.split('/');
    if (!padrao || padrao.length > 400 || padrao.startsWith('/') || padrao.includes('\\')
      || segmentos.some((s) => !s || s === '.' || s === '..') || /[\x00-\x1f\x7f]/.test(padrao)
      || entrada.fontes.length === 0 || entrada.fontes.some((f) => !ORDEM_DA_FONTE.includes(f))) return null;
    const fontes = porPadrao.get(padrao) ?? new Set<FonteDoCaminhoPublicado>();
    for (const fonte of entrada.fontes) fontes.add(fonte);
    porPadrao.set(padrao, fontes);
  }
  if (porPadrao.size > MAX_CAMINHOS_POR_TRABALHO_EMPRESA) return null;
  return [...porPadrao].sort(([a], [b]) => a.localeCompare(b)).map(([padrao, fontes]) => ({ padrao,
    fontes: ORDEM_DA_FONTE.filter((f) => fontes.has(f)) }));
}

export function caminhoDaPublicacaoV3(inscricaoId: string, projetoRef: string): string {
  const seguro = (v: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
  if (!seguro(inscricaoId) || !seguro(projetoRef)) throw new Error('rede-empresa.caminho-invalido');
  return `publicacoes-v3/${inscricaoId}/${projetoRef}.json`;
}

export interface FontesDosCaminhosDoTrabalho {
  plano?: string | null;
  leases?: readonly string[];
  diff?: readonly string[];
}

/** Une as três fontes públicas sem inferir caminho fora dos rótulos `touch_paths`. */
export function combinarCaminhosDoTrabalho(fontes: FontesDosCaminhosDoTrabalho): CaminhoDoTrabalho[] {
  const entradas: CaminhoDoTrabalho[] = [];
  const linhas = (fontes.plano ?? '').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < linhas.length; i++) {
    if (!/^\s*(?:[-*]\s+)?(?:\*\*touch_paths(?:\s*\([^)]*\))?:\*\*|\*\*touch_paths\*\*\s*:|`touch_paths`(?:\s*\([^)]*\))?\s*:|touch_paths(?:\s*\([^)]*\))?\s*:)/i.test(linhas[i])) continue;
    let bloco = linhas[i];
    for (let j = i + 1; j < linhas.length; j++) {
      if (/^#{1,6}\s/.test(linhas[j]) || /^\s*[-*]\s+(?:\*\*|`)?(?:verify|touch_paths)\b/i.test(linhas[j])) break;
      if (!linhas[j].trim()) continue;
      bloco += `\n${linhas[j]}`;
    }
    for (const trecho of bloco.matchAll(/`([^`]+)`/g)) entradas.push({ padrao: trecho[1], fontes: ['plan'] });
  }
  for (const lease of fontes.leases ?? []) {
    const padrao = lease.startsWith('path:') ? lease.slice('path:'.length) : null;
    if (padrao) entradas.push({ padrao, fontes: ['lease'] });
  }
  for (const padrao of fontes.diff ?? []) entradas.push({ padrao, fontes: ['diff'] });
  return normalizarCaminhosDoTrabalho(entradas)?.map((c) => ({ padrao: c.padrao, fontes: c.fontes })) ?? entradas;
}

function planoDaThread(raiz: string, threadId: string): string | null {
  const arquivo = path.join(dirThread(raiz, threadId), 'docs', 'plan.md');
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    return st.isFile() && st.size <= 128 * 1024 ? fs.readFileSync(fd, 'utf8') : null;
  } finally { fs.closeSync(fd); }
}

/** Produz os caminhos das threads publicadas no panorama sem expor worktree ou conteúdo. */
export function caminhosPublicadosPorThread(raiz: string,
  trabalhos: readonly { id: string; branch: string }[]): CaminhosPorThread {
  return Object.fromEntries(trabalhos.map((trabalho) => {
    const thread = lerThread(raiz, trabalho.id);
    const diff = exec('git', ['diff', '--name-only', '--no-renames', '-z', `${thread.base.commit}...${trabalho.branch}`, '--'], raiz);
    return [trabalho.id, combinarCaminhosDoTrabalho({ plano: planoDaThread(raiz, trabalho.id),
      leases: thread.leases.filter((l) => l.liberadoEm === null).map((l) => l.nome),
      diff: diff.ok ? diff.stdout.split('\0').filter(Boolean) : [] })];
  }));
}

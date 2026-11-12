/** RM-089 F3: caminhos públicos de um trabalho coletivo. */
import { MAX_CAMINHOS_POR_TRABALHO_EMPRESA, type CaminhoPublicado,
  type FonteDoCaminhoPublicado } from './rede-empresa-contrato';

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

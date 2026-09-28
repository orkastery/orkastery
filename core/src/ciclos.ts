/**
 * Variantes de ciclo (`ork thread new --ciclo`), portadas do Devmaster (bloco B2).
 *
 * A variante NAO muda a verificacao nem os gates: ela muda como a thread NASCE.
 * Ou o desenho dos blocos de loop (`goal-plan` funde GOAL e PLAN; `gap` publica a
 * lacuna sem GO e sem SHIP), ou a arvore de onde ela parte (`merge-branch` parte de
 * uma branch que ja existe; `greenfield` exige worktree isolada).
 */

import { slugDasFases } from './modos';
import { BlocoDeLoop, Fase, VarianteDeCiclo } from './types';

export interface DefinicaoDeVariante {
  variante: VarianteDeCiclo;
  descricao: string;
  /** A variante exige `--branch <existente>`? */
  exigeBranch: boolean;
  /** A variante exige worktree isolada da thread? */
  exigeWorktree: boolean;
  /** A variante muda o desenho dos blocos de loop do modo? */
  mudaBlocos: boolean;
}

/** As 5 variantes de ciclo, com o que cada uma muda na criacao da thread. */
export const VARIANTES: Readonly<Record<VarianteDeCiclo, DefinicaoDeVariante>> = {
  greenfield: {
    variante: 'greenfield',
    descricao: 'Comeco do zero: worktree isolada obrigatoria, partindo da base do manifesto',
    exigeBranch: false,
    exigeWorktree: true,
    mudaBlocos: false,
  },
  'merge-branch': {
    variante: 'merge-branch',
    descricao: 'Parte de uma branch que ja existe (`--branch`), sem criar branch nova',
    exigeBranch: true,
    exigeWorktree: true,
    mudaBlocos: false,
  },
  'goal-plan': {
    variante: 'goal-plan',
    descricao: 'Funde GOAL e PLAN num bloco so: uma pausa a menos quando o modo os separava',
    exigeBranch: false,
    exigeWorktree: false,
    mudaBlocos: true,
  },
  gap: {
    variante: 'gap',
    descricao: 'Analise de lacuna: sem GO e sem SHIP, a lacuna e publicada como lacuna',
    exigeBranch: false,
    exigeWorktree: false,
    mudaBlocos: true,
  },
  'feature-xl-faseada': {
    variante: 'feature-xl-faseada',
    descricao: 'Feature grande em fatias: o PLAN se compromete com N fatias verificaveis',
    exigeBranch: false,
    exigeWorktree: true,
    mudaBlocos: false,
  },
};

/** Ordem de apresentacao das variantes no CLI. */
export const ORDEM_DAS_VARIANTES: readonly VarianteDeCiclo[] = [
  'greenfield',
  'merge-branch',
  'goal-plan',
  'gap',
  'feature-xl-faseada',
];

/** Parseia `--ciclo`. Retorna null quando a variante nao existe. */
export function parseVariante(bruto: string | undefined | null): VarianteDeCiclo | null {
  if (!bruto) return null;
  const limpo = bruto.trim().toLowerCase();
  return (ORDEM_DAS_VARIANTES as readonly string[]).includes(limpo)
    ? (limpo as VarianteDeCiclo)
    : null;
}

/** Definicao de uma variante, com erro claro quando ela nao existe. */
export function definicaoDaVariante(variante: VarianteDeCiclo): DefinicaoDeVariante {
  const def = VARIANTES[variante];
  if (!def) throw new Error(`variante de ciclo desconhecida: ${variante}`);
  return def;
}

function refazerBloco(fases: Fase[], pausa: boolean, pausaSobre: string): BlocoDeLoop {
  return { fases, pausa, pausaSobre, slugFases: slugDasFases(fases) };
}

/**
 * Funde os blocos que conduzem GOAL e PLAN num bloco unico.
 *
 * Idempotente: em `#Default`, `#Maestro` e `#Auto` o GOAL e o PLAN ja vivem no mesmo
 * bloco e nada muda. Em `#Classic`, que abre GOAL e PLAN em blocos separados, a fusao
 * economiza exatamente uma pausa.
 */
export function fundirGoalPlan(blocos: BlocoDeLoop[]): BlocoDeLoop[] {
  const envolvidos = blocos.filter((b) => b.fases.includes('GOAL') || b.fases.includes('PLAN'));
  if (envolvidos.length <= 1) return blocos.map((b) => ({ ...b }));

  const fases = envolvidos.flatMap((b) => b.fases);
  const pausa = envolvidos.some((b) => b.pausa);
  const pausaSobre = pausa ? 'premissas' : '';
  const fundido = refazerBloco(fases, pausa, pausaSobre);

  const saida: BlocoDeLoop[] = [];
  let inserido = false;
  for (const b of blocos) {
    if (envolvidos.includes(b)) {
      if (!inserido) {
        saida.push(fundido);
        inserido = true;
      }
      continue;
    }
    saida.push({ ...b });
  }
  return saida;
}

/** Tira GO e SHIP do ciclo: a thread de gap analisa e publica, nao implementa nem entrega. */
export function somenteAnalise(blocos: BlocoDeLoop[]): BlocoDeLoop[] {
  const fora: Fase[] = ['GO', 'SHIP'];
  const saida: BlocoDeLoop[] = [];
  for (const b of blocos) {
    const fases = b.fases.filter((f) => !fora.includes(f));
    if (fases.length === 0) continue;
    // A pausa sobrevive so quando a fase que a motivava sobreviveu.
    const ultima = b.fases[b.fases.length - 1];
    const pausa = b.pausa && fases.includes(ultima);
    saida.push(refazerBloco(fases, pausa, pausa ? b.pausaSobre : ''));
  }
  if (saida.length === 0) throw new Error('a variante gap removeu todas as fases do ciclo');
  return saida;
}

/** Aplica a variante ao desenho de blocos do modo. Variante nula devolve os blocos como estao. */
export function aplicarVariante(
  blocos: BlocoDeLoop[],
  variante: VarianteDeCiclo | null
): BlocoDeLoop[] {
  if (!variante) return blocos.map((b) => ({ ...b }));
  if (variante === 'goal-plan') return fundirGoalPlan(blocos);
  if (variante === 'gap') return somenteAnalise(blocos);
  return blocos.map((b) => ({ ...b }));
}

/** Tabela das variantes de ciclo, usada por `ork ciclos`. */
export function tabelaDeVariantes(): string {
  const linhas: string[] = ['Variantes de ciclo (`ork thread new --ciclo <variante>`)', ''];
  for (const v of ORDEM_DAS_VARIANTES) {
    const def = VARIANTES[v];
    const exige: string[] = [];
    if (def.exigeBranch) exige.push('--branch <existente>');
    if (def.exigeWorktree) exige.push('worktree isolada');
    linhas.push(`  ${v.padEnd(20)} ${def.descricao}`);
    linhas.push(
      `  ${''.padEnd(20)} exige: ${exige.join(', ') || 'nada'} | ` +
        `muda os blocos do modo: ${def.mudaBlocos ? 'sim' : 'nao'}`
    );
  }
  linhas.push('');
  linhas.push('A variante muda como a thread NASCE. Verificacao e gates nao mudam.');
  return linhas.join('\n');
}

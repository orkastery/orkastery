/**
 * RM-037 (fatia 6): o steal da CPU durante o `ork verify`, medido em `/proc/stat`.
 *
 * Em 23 e 24/09/2026 a VPS perdeu de 67% a 92% da CPU para o hipervisor (sar), e a mesma suite que
 * leva 3,4 min com CPU livre levou de 24 a 30 min. Teste que mede relogio reprova nessa hora sem que
 * o codigo tenha mudado. O verify passa a medir o steal na janela de cada comando e da rodada e a
 * gravar a medida no `verify_run`; a reprovacao de teste com relogio sob steal acima de 40% vira
 * `verify.timeout` (o retry reexecuta), nunca regressao.
 *
 * A linha agregada `cpu` do `/proc/stat` traz, em jiffies desde o boot: user, nice, system, idle,
 * iowait, irq, softirq, steal, guest e guest_nice. guest e guest_nice ja estao contados em user e
 * nice, entao o total da janela soma so os oito primeiros.
 */

import { readFileSync } from 'node:fs';
import { FalhaDeTeste } from './redacao-saida';

/** Limiar da recomendada da RM-037: acima dele, o relogio do teste nao julga o codigo. */
export const LIMIAR_STEAL_PCT = 40;

export const FONTE_STEAL = '/proc/stat';

/** Uma leitura da linha agregada `cpu`. */
export interface AmostraCpu {
  steal: number;
  total: number;
}

/** Le o conteudo do `/proc/stat`; `null` onde ele nao existe (macOS, Windows, container sem /proc). */
export type LeitorProcStat = () => string | null;

export const lerProcStat: LeitorProcStat = () => {
  try {
    return readFileSync(FONTE_STEAL, 'utf8');
  } catch {
    return null;
  }
};

/** A linha `cpu ` (agregada) do `/proc/stat`. Kernel antigo, sem a coluna de steal, nao tem medida. */
export function amostraDoProcStat(conteudo: string | null): AmostraCpu | null {
  if (!conteudo) return null;
  const linha = conteudo.split('\n').find((l) => /^cpu\s/.test(l));
  if (!linha) return null;
  const campos = linha.trim().split(/\s+/).slice(1).map(Number);
  if (campos.length < 8 || campos.slice(0, 8).some((n) => !Number.isFinite(n) || n < 0)) return null;
  const total = campos.slice(0, 8).reduce((s, n) => s + n, 0);
  return { steal: campos[7], total };
}

/** Steal da janela entre duas amostras, em porcentagem com uma casa. Janela vazia nao tem medida. */
export function stealDaJanela(inicio: AmostraCpu | null, fim: AmostraCpu | null): number | null {
  if (!inicio || !fim) return null;
  const total = fim.total - inicio.total;
  const steal = fim.steal - inicio.steal;
  if (total <= 0 || steal < 0) return null;
  return Math.round((steal / total) * 1000) / 10;
}

/** Abre a janela agora; `fechar()` devolve o steal dela (ou `null` sem medida). */
export function abrirJanela(leitor: LeitorProcStat = lerProcStat): { fechar: () => number | null } {
  const inicio = amostraDoProcStat(leitor());
  return { fechar: () => stealDaJanela(inicio, amostraDoProcStat(leitor())) };
}

/** Entrada de relogio do registro de instabilidade, so as validas e nao vencidas. */
export type TestesDeRelogio = ReadonlySet<string>;

/**
 * A reprovacao do comando e so de teste com relogio? Todo teste que caiu precisa ser de relogio:
 * pela assinatura de prazo do runner (estouro do teste ou cancelado pelo pai que estourou) ou pelo
 * registro de instabilidade. Comando sem teste nomeado (build, tsc, script) nunca entra.
 */
export function reprovacaoSoDeRelogio(falhas: readonly FalhaDeTeste[] | undefined,
  registro: TestesDeRelogio = new Set()): string[] | null {
  if (!falhas || falhas.length === 0) return null;
  const todas = falhas.every((f) => f.relogio || registro.has(f.nome));
  return todas ? falhas.map((f) => f.nome) : null;
}

/** Steal acima do limiar? A medida ausente nunca atenua nada. */
export function stealAlto(pct: number | null | undefined): boolean {
  return typeof pct === 'number' && pct > LIMIAR_STEAL_PCT;
}

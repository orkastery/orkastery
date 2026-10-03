/**
 * O indice automatico de qualidade da entrega (I-43, D3).
 *
 * Ele existe para substituir a fila de ratificacao de score, e o problema que a fila
 * tinha nao era falta de lembrete: eram 13 entradas esperando nota humana justamente
 * porque lembrete nao converte em nota. A saida e ACEITACAO POR DEFAULT com registro:
 * entregue e aceito, a menos que o dono diga o contrario, e a nota humana passa a
 * existir so quando ele reclamar, e ai vale.
 *
 * DUAS REGRAS DURAS, e elas explicam quase todo o resto deste arquivo.
 *
 * 1. So entra fato que tem ESCRITOR no nucleo e entrada no catalogo `TIPOS_DE_EVENTO`.
 *    A medida que motivou isso: os 137 ledgers do projeto trazem mais de 200 valores
 *    distintos de `tipo`, muitos com uma ocorrencia so, com variantes do mesmo fato
 *    (`lease_acquire` x `lease_acquired`, `claim_novo` x `claim_added`) e ate lixo
 *    literal (`B`, `path`, `commit`). Um indice que case string livre no ledger e um
 *    indice que mente: `verify_result` tem 122 ocorrencias e ZERO escritor no nucleo.
 *
 * 2. O indice e DERIVADO, nunca digitado. Nao existe caminho que aceite um numero de
 *    fora. E a diferenca entre este campo e o `score`, que hoje mistura tres coisas:
 *    das 19 notas em disco, 9 nao sao juizo humano de qualidade (3 sao carimbo cujo
 *    proprio texto diz "ratificacao pendente", 3 comecam com "Proponho" e sao proposta
 *    de agente, e 3 sao `valor: 0` de encerramento administrativo).
 *
 * RESERVA HONESTA, que precisa estar escrita aqui e nao so no PLAN: o indice NAO
 * classifica o passado. Com os insumos que hoje tem escritor, 23 das 29 threads
 * entregues ficariam coladas no teto, porque `rollback_done` tinha ZERO ocorrencias.
 * Ele comeca a discriminar a partir do momento em que o escritor de reversao existir
 * (T7, em `ship.ts`). Cobrar do indice um veredito sobre o historico seria cobrar um
 * numero que ele nao tem como produzir.
 */

import { TIPOS_DE_EVENTO } from './ledger';
import { EventoLedger } from './types';

/** Nota maxima, e o ponto de partida: entregue e aceito ate prova em contrario. */
export const INDICE_BASE = 5;
export const INDICE_MINIMO = 0;

/**
 * Um insumo do indice: o evento canonico, o peso por ocorrencia e o piso do desconto.
 *
 * O piso existe para o indice nao virar contador: tres rodadas de GO-FIX dizem "esta
 * thread custou correcao", e a decima nao diz dez vezes mais. Sem piso, uma thread
 * longa e sadia afundaria por acumulo.
 */
export interface InsumoDoIndice {
  /** Evento do catalogo do nucleo. Nunca string livre. */
  evento: string;
  /** Desconto por ocorrencia (negativo). */
  peso: number;
  /** Desconto maximo deste insumo, por mais que ele se repita (negativo). */
  piso: number;
  /** O que ele mede, em uma linha, para o texto do `ork master`. */
  sobre: string;
}

/**
 * Os pesos de D3. Reversao pesa sozinha mais que tudo junto, e e de proposito:
 * ela e o unico fato que diz, sem interpretacao, que a entrega nao servia.
 */
export const INSUMOS_DO_INDICE: readonly InsumoDoIndice[] = [
  { evento: TIPOS_DE_EVENTO.rollbackConcluido, peso: -3, piso: -3,
    sobre: 'a entrega foi revertida depois do ship' },
  { evento: TIPOS_DE_EVENTO.fixAberto, peso: -0.5, piso: -1.5,
    sobre: 'rodadas de GO-FIX: o CHECK reprovou e a entrega precisou de correcao' },
  { evento: TIPOS_DE_EVENTO.reverifyConcluido, peso: -0.5, piso: -1,
    sobre: 'CHECK refeito: a verificacao precisou de uma segunda rodada' },
  { evento: TIPOS_DE_EVENTO.shipBloqueado, peso: -0.25, piso: -0.5,
    sobre: 'ship barrado antes de entregar' },
];

/** O quanto um insumo pesou nesta thread, com a contagem que o produziu. */
export interface ParcelaDoIndice {
  evento: string;
  sobre: string;
  ocorrencias: number;
  desconto: number;
  /** O piso cortou o desconto? E o que impede o indice de virar contador. */
  noPiso: boolean;
}

export interface Indice {
  valor: number;
  base: number;
  /** Uma parcela por insumo que de fato ocorreu. Vazio = entrega sem nenhum tropeco. */
  parcelas: ParcelaDoIndice[];
  /**
   * `derivado` e sempre true e esta aqui para o leitor do MASTER log nao precisar
   * confiar na prosa: este numero nao foi digitado por ninguem.
   */
  derivado: true;
}

/**
 * Calcula o indice de uma thread a partir do ledger dela.
 *
 * PURA: le eventos, devolve numero, nao escreve nada e nao toca em git. Quem detecta
 * reversao e `ship.ts`, que e quem sabe de merge e de base; aqui so se conta o evento
 * que ele gravou.
 */
export function calcularIndice(eventos: readonly EventoLedger[]): Indice {
  const parcelas: ParcelaDoIndice[] = [];
  let valor = INDICE_BASE;

  for (const insumo of INSUMOS_DO_INDICE) {
    // Ensaio de 03/10/2026 (RM-049): o `ork ship --dry-run` barrado grava `ship_blocked` com `dryRun: true`;
    // ensaio nao e tropeco da entrega, como ja nao e pausa no board (fatia 2 do ensaio da 0.5.0, P2).
    const ocorrencias = eventos.filter((e) => e.tipo === insumo.evento && e.dryRun !== true).length;
    if (ocorrencias === 0) continue;
    const bruto = insumo.peso * ocorrencias;
    const desconto = Math.max(bruto, insumo.piso);
    parcelas.push({
      evento: insumo.evento,
      sobre: insumo.sobre,
      ocorrencias,
      desconto,
      noPiso: bruto < insumo.piso,
    });
    valor += desconto;
  }

  return {
    valor: Math.max(INDICE_MINIMO, Math.min(INDICE_BASE, Number(valor.toFixed(2)))),
    base: INDICE_BASE,
    parcelas,
    derivado: true,
  };
}

/** Texto de uma linha por parcela, para `ork master` mostrar de onde o numero veio. */
export function textoDoIndice(indice: Indice): string {
  const linhas = [`indice ${indice.valor} de ${indice.base} (derivado do ledger, nunca digitado)`];
  if (indice.parcelas.length === 0) {
    linhas.push('  nenhum insumo: a entrega nao registrou reversao, GO-FIX, CHECK refeito nem ship barrado');
    return linhas.join('\n');
  }
  for (const p of indice.parcelas) {
    linhas.push(`  ${p.desconto.toFixed(2).padStart(6)}  ${p.evento} x${p.ocorrencias}${p.noPiso ? ' (no piso)' : ''}`);
    linhas.push(`          ${p.sobre}`);
  }
  return linhas.join('\n');
}

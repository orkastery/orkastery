/**
 * RM-037 (rm037noite): o que sai quando a thread fecha, pelo MASTER ou pelo `ork thread close`.
 *
 * Domicilio unico do "ao fechar". Antes, as duas saidas gravavam `status: fechada` e paravam ali:
 * a thread fechada seguia na frente da fila de regiao (defeito 2) e com o item do roadmap reservado
 * (defeito 3). Tudo aqui e de melhor esforco: o fechamento ja aconteceu, e nada daqui o desfaz nem o
 * derruba. Cada parte roda isolada (achado A1 do CHECK 1): erro de E/S numa nao impede a outra, e o
 * que nao saiu agora sai na poda do proximo pedido de regiao ou no `ork roadmap reservas --soltar-orfas`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { soltarThreadFechada } from './leases';
import { ResultadoDaSoltura, soltarReservaDaThread } from './roadmap-reservas';
import { lerThread } from './thread';

export interface SolturaAoFechar {
  /** Leases de escrita soltos (o `exec:` fica com a conducao). */
  leases: string[];
  /** Entradas da fila que sairam. */
  fila: string[];
  /** As reservas do roadmap soltas, reapontadas ou pendentes; vazio quando a thread nao tinha reserva. */
  reservas: ResultadoDaSoltura[];
  /** As partes que falharam, com o erro; o fechamento segue valendo. */
  falhas: string[];
}

export function liberarAoFechar(raiz: string, threadId: string): SolturaAoFechar {
  const saida: SolturaAoFechar = { leases: [], fila: [], reservas: [], falhas: [] };
  const falhou = (parte: string, e: unknown) => saida.falhas.push(`${parte}: ${(e as Error)?.message ?? String(e)}`);
  // Os leases de regiao sao por checkout: os da raiz e, quando a thread tem worktree, os pegos de la.
  const checkouts = [raiz];
  try {
    const wt = lerThread(raiz, threadId).worktree;
    if (wt && fs.existsSync(wt) && path.resolve(wt) !== path.resolve(raiz)) checkouts.push(wt);
  } catch (e) { falhou('thread', e); }
  for (const checkout of checkouts) {
    try {
      const solto = soltarThreadFechada(checkout, threadId, 'fechamento');
      saida.leases.push(...solto.leases);
      saida.fila.push(...solto.fila);
    } catch (e) { falhou(`leases em ${checkout}`, e); }
  }
  try {
    const reserva = soltarReservaDaThread(raiz, threadId);
    saida.reservas = reserva ? [reserva] : [];
  } catch (e) { falhou('reserva', e); }
  return saida;
}

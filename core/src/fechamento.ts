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
import { raizDoEstado } from './estado-thread';
import { registrarSeExiste, TIPOS_DE_EVENTO } from './ledger';
import { soltarThreadFechada } from './leases';
import { ResultadoDaSoltura, soltarReservaDaThread } from './roadmap-reservas';
import { dirThread, lerThread } from './thread';
import { cwdLocalOuNulo } from './procedencia';

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
  // Os leases de regiao sao por checkout: o de quem fecha, a raiz do projeto e, quando a thread tem
  // worktree, os pegos de la (sugestao 6 do CHECK 2: fechar da worktree tambem solta os da raiz).
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const candidatos = [raiz];
  try { candidatos.push(raizDoEstado(raiz)); } catch (e) { falhou('raiz', e); }
  try {
    const wt = lerThread(raiz, threadId).worktree;
    // RM-047 (P2): so a worktree registrada no git recebe a soltura; outro diretorio do thread.json fica de fora.
    if (wt && fs.existsSync(wt) && cwdLocalOuNulo(raiz, threadId, wt, 'thread') !== null) candidatos.push(wt);
  } catch (e) { falhou('thread', e); }
  const checkouts = candidatos.filter((c, i) => candidatos.findIndex((x) => real(x) === real(c)) === i);
  for (const checkout of checkouts) {
    try {
      const solto = soltarThreadFechada(checkout, threadId, 'fechamento');
      saida.leases.push(...solto.leases);
      saida.fila.push(...solto.fila);
    } catch (e) { falhou(`leases em ${checkout}`, e); }
  }
  try { saida.reservas = soltarReservaDaThread(raiz, threadId); } catch (e) { falhou('reserva', e); }
  // Sugestao 2 do CHECK 2: a falha tambem vai ao ledger da thread, de melhor esforco.
  if (saida.falhas.length > 0) {
    try {
      registrarSeExiste(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.solturaFalhou, { falhas: saida.falhas,
        correcao: 'a poda do proximo pedido de regiao solta o que ficou; reserva: ork roadmap reservas --soltar-orfas' });
    } catch { /* o ledger que nao grava ja esta nas falhas */ }
  }
  return saida;
}

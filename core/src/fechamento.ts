/**
 * RM-037 (rm037noite): o que sai quando a thread fecha, pelo MASTER ou pelo `ork thread close`.
 *
 * Domicilio unico do "ao fechar". Antes, as duas saidas gravavam `status: fechada` e paravam ali:
 * a thread fechada seguia na frente da fila de regiao (defeito 2) e com o item do roadmap reservado
 * (defeito 3). Tudo aqui e de melhor esforco: o fechamento ja aconteceu, e nada daqui o desfaz.
 */
import { soltarThreadFechada } from './leases';

export interface SolturaAoFechar {
  /** Leases de escrita soltos (o `exec:` fica com a conducao). */
  leases: string[];
  /** Entradas da fila que sairam. */
  fila: string[];
}

export function liberarAoFechar(raiz: string, threadId: string): SolturaAoFechar {
  return soltarThreadFechada(raiz, threadId, 'fechamento');
}

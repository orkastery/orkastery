import { setImmediate as pausarAssincrono } from 'node:timers/promises';

type Ausente = false | null | undefined;

interface OpcoesComuns {
  /** Evidência de que o produtor terminou sem publicar o evento esperado. */
  falhaTerminal?: () => string | null;
}

export interface OpcoesEsperaEvento extends OpcoesComuns {
  /** Pausa injetável entre leituras; não decide o veredito. */
  pausar?: () => void;
}

export interface OpcoesEsperaEventoAssincrono extends OpcoesComuns {
  /** Yield injetável entre leituras; não decide o veredito. */
  pausar?: () => Promise<void>;
}

const PAUSA = new Int32Array(new SharedArrayBuffer(4));

/**
 * Espera síncrona por um evento de fixture. O helper não tem relógio: o teto do comando que
 * executa a suíte é a contenção externa e, no verify, seu vencimento fica sem veredito.
 */
export function esperarEvento<T>(ler: () => T | Ausente, descricao: string,
  opcoes: OpcoesEsperaEvento = {}): T {
  for (;;) {
    const evento = ler();
    if (evento !== false && evento !== null && evento !== undefined) return evento;
    const falha = opcoes.falhaTerminal?.() ?? null;
    if (falha !== null) throw new Error(`${descricao}: ${falha}`);
    (opcoes.pausar ?? (() => { Atomics.wait(PAUSA, 0, 0, 30); }))();
  }
}

/** A mesma espera para fixtures que precisam manter o event loop livre para receber o evento. */
export async function esperarEventoAssincrono<T>(ler: () => T | Ausente, descricao: string,
  opcoes: OpcoesEsperaEventoAssincrono = {}): Promise<T> {
  for (;;) {
    const evento = ler();
    if (evento !== false && evento !== null && evento !== undefined) return evento;
    const falha = opcoes.falhaTerminal?.() ?? null;
    if (falha !== null) throw new Error(`${descricao}: ${falha}`);
    await (opcoes.pausar ?? (async () => { await pausarAssincrono(); }))();
  }
}

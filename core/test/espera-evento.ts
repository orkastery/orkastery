import { setTimeout as pausarAssincrono } from 'node:timers/promises';

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
  /** Pausa injetável entre leituras; recebe o intervalo corrente e não decide o veredito. */
  pausar?: (intervaloMs: number) => Promise<void>;
  /** Primeiro intervalo de polling. */
  intervaloInicialMs?: number;
  /** Maior intervalo de polling; depois dele a espera segue no mesmo ritmo. */
  intervaloMaximoMs?: number;
}

const PAUSA = new Int32Array(new SharedArrayBuffer(4));
const ausente = (valor: unknown): valor is Ausente => valor === false || valor === null || valor === undefined;

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
export async function esperarEventoAssincrono<T>(ler: () => T | Ausente | Promise<T | Ausente>, descricao: string,
  opcoes: OpcoesEsperaEventoAssincrono = {}): Promise<T> {
  const intervaloInicialMs = opcoes.intervaloInicialMs ?? 10;
  const intervaloMaximoMs = opcoes.intervaloMaximoMs ?? 250;
  if (!Number.isFinite(intervaloInicialMs) || intervaloInicialMs <= 0 || !Number.isFinite(intervaloMaximoMs) ||
      intervaloMaximoMs < intervaloInicialMs) throw new Error(`${descricao}: intervalos inválidos para a espera`);
  const pausar = opcoes.pausar ?? (async (intervaloMs: number) => { await pausarAssincrono(intervaloMs); });
  let intervaloMs = intervaloInicialMs;
  for (;;) {
    const evento = await ler();
    if (evento !== false && evento !== null && evento !== undefined) return evento;
    const falha = opcoes.falhaTerminal?.() ?? null;
    if (falha !== null) throw new Error(`${descricao}: ${falha}`);
    await pausar(intervaloMs);
    intervaloMs = Math.min(intervaloMaximoMs, intervaloMs * 2);
  }
}

/**
 * Exercita o produtor real, mas retém o primeiro evento até o relógio injetado atravessar a fronteira anterior.
 * O mesmo valor lido do produtor é devolvido; a fronteira nunca vira deadline do helper.
 */
export function esperarEventoDepoisDaFronteira<T>(ler: () => T | Ausente, descricao: string,
  fronteiraAnteriorMs: number, opcoes: OpcoesEsperaEvento = {}): T {
  if (!Number.isFinite(fronteiraAnteriorMs) || fronteiraAnteriorMs < 0)
    throw new Error(`${descricao}: fronteira anterior inválida`);
  let relogio = 0;
  let temEvento = false;
  let retido: T | undefined;
  const pausar = opcoes.pausar ?? (() => { Atomics.wait(PAUSA, 0, 0, 30); });
  return esperarEvento(() => {
    if (!temEvento) {
      const evento = ler();
      if (!ausente(evento)) { retido = evento; temEvento = true; }
    }
    return temEvento && relogio > fronteiraAnteriorMs ? retido : null;
  }, descricao, { ...opcoes, pausar: () => {
    relogio = Math.max(relogio + 1, fronteiraAnteriorMs + 1);
    pausar();
  } });
}

/** Versão assíncrona da retenção pelo relógio injetado. */
export async function esperarEventoAssincronoDepoisDaFronteira<T>(
  ler: () => T | Ausente | Promise<T | Ausente>, descricao: string, fronteiraAnteriorMs: number,
  opcoes: OpcoesEsperaEventoAssincrono = {}): Promise<T> {
  if (!Number.isFinite(fronteiraAnteriorMs) || fronteiraAnteriorMs < 0)
    throw new Error(`${descricao}: fronteira anterior inválida`);
  let relogio = 0;
  let temEvento = false;
  let retido: T | undefined;
  const pausar = opcoes.pausar ?? (async (intervaloMs: number) => { await pausarAssincrono(intervaloMs); });
  return esperarEventoAssincrono(async () => {
    if (!temEvento) {
      const evento = await ler();
      if (!ausente(evento)) { retido = evento; temEvento = true; }
    }
    return temEvento && relogio > fronteiraAnteriorMs ? retido : null;
  }, descricao, { ...opcoes, pausar: async (intervaloMs) => {
    relogio = Math.max(relogio + intervaloMs, fronteiraAnteriorMs + 1);
    await pausar(intervaloMs);
  } });
}

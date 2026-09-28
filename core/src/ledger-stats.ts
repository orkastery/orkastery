import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirThread, lerThread, listarIds } from './thread';
import { lerLedger, registrar } from './ledger';
import { EventoLedger } from './types';
import { exec } from './util';
import { formatarDataHora, formatarDataHoraRotulada } from './horario';

interface TarifaModelo { product: string; input: number; cachedInput: number; output: number; source: string }
interface Tarifas { schema: string; verifiedAt: string; currency: 'USD'; unitTokens: number; nature: 'estimated_reference'; models: Record<string, TarifaModelo> }

export interface FiltrosLedgerStats {
  desde: string | number;
  ate?: string | number;
  thread?: string;
  modo?: string;
  runtime?: string;
  agoraMs?: number;
}

export interface LedgerStats {
  schema: 'ork.ledger-stats/v1';
  periodo: { desde: string; ate: string; intervalo: '[desde,ate)' };
  filtros: { thread: string | null; modo: string | null; runtime: string | null };
  threads: number;
  sessoes: { despachadas: number; concluidas: number; retries: number };
  throughput: { ships: number };
  execucao: { milissegundos: number; horas: number; cobertura: { medidas: number; semMedida: number } };
  tokens: { input: number; cachedInput: number; uncachedInput: number; output: number; total: number; cobertura: { medidas: number; semMedida: number } };
  custoReferencia: { natureza: 'estimated_reference'; moeda: 'USD'; valor: number | null; sessoesPrecificadas: number; sessoesSemTarifa: number; tarifasVerificadasEm: string; fontes: string[] };
  leadTime: { mediaMs: number | null; amostras: number };
  esperaHumana: { milissegundos: number; fechadas: number; abertas: number };
  riscosPreventivos: { total: number; porMotivo: Record<string, number> };
  estimativasPlano: { amostras: number; semIaHoras: number; iaSemOrkHoras: number };
  qualidade: { ledgersCorrompidos: number; observacoes: string[] };
}

const MOTIVOS_PREVENTIVOS = new Set([
  'policy.violation', 'cost.violation', 'verify.regression', 'claims.failed', 'claims.unverifiable',
]);

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

export function parsePeriodo(valor: string | number, agoraMs = Date.now()): number {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw Error('ledger.period.invalid');
    return valor;
  }
  const relativo = /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(valor.trim());
  if (relativo) {
    const fator = relativo[2] === 'm' ? 60_000 : relativo[2] === 'h' ? 3_600_000 : 86_400_000;
    return agoraMs - Number(relativo[1]) * fator;
  }
  const absoluto = Date.parse(valor);
  if (!Number.isFinite(absoluto)) throw Error(`ledger.period.invalid: ${valor}`);
  return absoluto;
}

function lerTarifas(): Tarifas {
  const candidatos = [
    path.resolve(__dirname, '..', 'assets', 'reference-tariffs-i07.json'),
    path.resolve(__dirname, '..', '..', 'assets', 'reference-tariffs-i07.json'),
  ];
  const arquivo = candidatos.find(fs.existsSync);
  if (!arquivo) throw Error('ledger.tariffs.unavailable');
  return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Tarifas;
}

function instante(evento: EventoLedger): number | null {
  const valor = Date.parse(evento.ts);
  return Number.isFinite(valor) ? valor : null;
}

function chaveResultado(e: EventoLedger, indice: number): string {
  const sensor = typeof e.sensorResultId === 'string' ? e.sensorResultId : null;
  const sessao = typeof e.sessionId === 'string' ? e.sessionId : null;
  return sensor ?? (sessao ? `${sessao}:${String(e.fase ?? '')}` : `linha:${indice}`);
}

function modeloDoEvento(e: EventoLedger, despachos: Map<string, EventoLedger>): string | null {
  if (typeof e.model === 'string') return e.model;
  const sessao = typeof e.sessionId === 'string' ? e.sessionId : '';
  const d = despachos.get(sessao);
  return typeof d?.model === 'string' ? d.model : null;
}

/** Agrega somente fatos observados no ledger; ausencia aparece como cobertura, nunca como zero inventado. */
export function coletarEstatisticas(raiz: string, filtros: FiltrosLedgerStats): LedgerStats {
  const agoraMs = filtros.agoraMs ?? Date.now();
  const desdeMs = parsePeriodo(filtros.desde, agoraMs);
  const ateMs = filtros.ate === undefined ? agoraMs : parsePeriodo(filtros.ate, agoraMs);
  if (desdeMs >= ateMs) throw Error('ledger.period.order');
  if (filtros.thread && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(filtros.thread)) throw Error('ledger.thread.invalid');

  const tarifas = lerTarifas();
  const candidatas = listarIds(raiz).map(id => lerThread(raiz, id)).filter(t => !filtros.thread || t.id === filtros.thread);
  if (filtros.thread && candidatas.length === 0) throw Error(`thread nao encontrada: ${filtros.thread}`);
  const eventosPorThread = candidatas.map(t => ({ thread: t, eventos: lerLedger(dirThread(raiz, t.id)) }));
  const selecionadas = eventosPorThread.filter(({ thread, eventos }) => {
    const criada = eventos.find(e => e.tipo === 'thread_created');
    const modo = typeof criada?.modo === 'string' ? criada.modo : thread.modo;
    return !filtros.modo || modo === filtros.modo;
  });

  let despachadas = 0, concluidas = 0, retries = 0, ships = 0, duracao = 0;
  let duracaoMedida = 0, duracaoAusente = 0, tokenMedido = 0, tokenAusente = 0;
  let input = 0, cachedInput = 0, output = 0, total = 0, custo = 0, precificadas = 0, semTarifa = 0;
  let esperaMs = 0, esperasFechadas = 0, esperasAbertas = 0, corrompidos = 0;
  let estimativas = 0, semIaHoras = 0, iaSemOrkHoras = 0;
  const riscos: Record<string, number> = {};
  const leads: number[] = [];
  const fontes = new Set<string>();

  for (const { eventos } of selecionadas) {
    corrompidos += eventos.filter(e => e.tipo === 'ledger_corrupted').length;
    const despachos = new Map<string, EventoLedger>();
    for (const e of eventos) if (e.tipo === 'phase_dispatch' && typeof e.sessionId === 'string') despachos.set(e.sessionId, e);
    const dentro = (e: EventoLedger) => { const t = instante(e); return t !== null && t >= desdeMs && t < ateMs; };
    const runtimeOk = (e: EventoLedger) => {
      if (!filtros.runtime) return true;
      if (e.runtime === filtros.runtime) return true;
      const sessao = typeof e.sessionId === 'string' ? e.sessionId : '';
      return despachos.get(sessao)?.runtime === filtros.runtime;
    };
    despachadas += eventos.filter(e => e.tipo === 'phase_dispatch' && dentro(e) && runtimeOk(e)).length;
    retries += eventos.filter(e => e.tipo === 'retry_attempt' && dentro(e)).length;
    ships += eventos.filter(e => e.tipo === 'ship_done' && dentro(e)).length;

    const resultados = new Map<string, EventoLedger>();
    eventos.forEach((e, i) => {
      if (e.tipo === 'phase_result' && dentro(e) && runtimeOk(e)) resultados.set(chaveResultado(e, i), e);
    });
    for (const e of resultados.values()) {
      concluidas++;
      const ms = numero(e.duracaoMs);
      if (ms === null) duracaoAusente++; else { duracao += ms; duracaoMedida++; }
      const t = e.tokens && typeof e.tokens === 'object' ? e.tokens as Record<string, unknown> : null;
      const tin = numero(t?.input), tcached = numero(t?.cachedInput), tout = numero(t?.output), ttotal = numero(t?.total);
      if (!t || t.disponivel === false || tin === null || tcached === null || tout === null) { tokenAusente++; continue; }
      tokenMedido++;
      input += tin; cachedInput += Math.min(tcached, tin); output += tout; total += ttotal ?? tin + tout;
      const modelo = modeloDoEvento(e, despachos);
      const tarifa = modelo ? tarifas.models[modelo] : undefined;
      if (!tarifa) { semTarifa++; continue; }
      custo += ((tin - Math.min(tcached, tin)) * tarifa.input + Math.min(tcached, tin) * tarifa.cachedInput + tout * tarifa.output) / tarifas.unitTokens;
      precificadas++; fontes.add(tarifa.source);
    }

    const criada = eventos.find(e => e.tipo === 'thread_created');
    const criadaMs = criada ? instante(criada) : null;
    for (const e of eventos.filter(e => e.tipo === 'ship_done' && dentro(e))) {
      const fim = instante(e); if (criadaMs !== null && fim !== null && fim >= criadaMs) leads.push(fim - criadaMs);
    }

    const pedidos = new Map<string, number[]>();
    for (const e of eventos) {
      if (e.tipo === 'gate_blocked' && e.motivo === 'human.pending') {
        const chave = typeof e.pedidoId === 'string' ? e.pedidoId : `${String(e.fase ?? '')}:legacy`;
        const t = instante(e); if (t !== null) (pedidos.get(chave) ?? (pedidos.set(chave, []), pedidos.get(chave)!)).push(t);
      }
      if (e.tipo === 'human_gate') {
        const chave = typeof e.pedidoId === 'string' ? e.pedidoId : `${String(e.fase ?? '')}:legacy`;
        const inicio = pedidos.get(chave)?.shift(); const fim = instante(e);
        if (inicio !== undefined && fim !== null && fim >= inicio) {
          const a = Math.max(inicio, desdeMs), b = Math.min(fim, ateMs);
          if (b > a) esperaMs += b - a;
          if (fim >= desdeMs && fim < ateMs) esperasFechadas++;
        }
      }
    }
    for (const aberturas of pedidos.values()) for (const inicio of aberturas) {
      const a = Math.max(inicio, desdeMs); if (ateMs > a) esperaMs += ateMs - a;
      if (inicio < ateMs) esperasAbertas++;
    }
    for (const e of eventos.filter(e => e.tipo === 'gate_blocked' && dentro(e))) {
      const motivo = typeof e.motivo === 'string' ? e.motivo : '';
      if (MOTIVOS_PREVENTIVOS.has(motivo)) riscos[motivo] = (riscos[motivo] ?? 0) + 1;
    }
    for (const e of eventos.filter(e => e.tipo === 'plan_estimate' && dentro(e))) {
      const a = numero(e.semIaHoras), b = numero(e.iaSemOrkHoras);
      if (a !== null && b !== null) { estimativas++; semIaHoras += a; iaSemOrkHoras += b; }
    }
  }

  const observacoes: string[] = [];
  if (tokenAusente) observacoes.push(`${tokenAusente} sessao(oes) sem medicao de tokens`);
  if (semTarifa) observacoes.push(`${semTarifa} sessao(oes) com tokens, mas sem tarifa de referencia`);
  if (corrompidos) observacoes.push(`${corrompidos} linha(s) de ledger corrompida(s) ignorada(s)`);
  return {
    schema: 'ork.ledger-stats/v1', periodo: { desde: new Date(desdeMs).toISOString(), ate: new Date(ateMs).toISOString(), intervalo: '[desde,ate)' },
    filtros: { thread: filtros.thread ?? null, modo: filtros.modo ?? null, runtime: filtros.runtime ?? null }, threads: selecionadas.length,
    sessoes: { despachadas, concluidas, retries }, throughput: { ships },
    execucao: { milissegundos: duracao, horas: duracao / 3_600_000, cobertura: { medidas: duracaoMedida, semMedida: duracaoAusente } },
    tokens: { input, cachedInput, uncachedInput: input - cachedInput, output, total, cobertura: { medidas: tokenMedido, semMedida: tokenAusente } },
    custoReferencia: { natureza: tarifas.nature, moeda: tarifas.currency, valor: precificadas ? Number(custo.toFixed(6)) : null, sessoesPrecificadas: precificadas, sessoesSemTarifa: semTarifa, tarifasVerificadasEm: tarifas.verifiedAt, fontes: [...fontes].sort() },
    leadTime: { mediaMs: leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null, amostras: leads.length },
    esperaHumana: { milissegundos: esperaMs, fechadas: esperasFechadas, abertas: esperasAbertas },
    riscosPreventivos: { total: Object.values(riscos).reduce((a, b) => a + b, 0), porMotivo: riscos },
    estimativasPlano: { amostras: estimativas, semIaHoras, iaSemOrkHoras },
    qualidade: { ledgersCorrompidos: corrompidos, observacoes },
  };
}

export function registrarEstimativaPlano(raiz: string, threadId: string, dados: { semIaHoras: number; iaSemOrkHoras: number; por: string; metodo: string; premissas: string; incerteza?: string }): EventoLedger {
  if (![dados.semIaHoras, dados.iaSemOrkHoras].every(v => Number.isFinite(v) && v > 0)) throw Error('ledger.estimate.hours-positive');
  if (![dados.por, dados.metodo, dados.premissas].every(v => v.trim() !== '')) throw Error('ledger.estimate.provenance-required');
  const thread = listarIds(raiz).map(id => lerThread(raiz, id)).find(t => t.id === threadId);
  if (!thread) throw Error(`thread nao encontrada: ${threadId}`);
  const head = exec('git', ['rev-parse', 'HEAD'], raiz);
  if (!head.ok) throw Error('ledger.estimate.head-unavailable');
  return registrar(dirThread(raiz, threadId), threadId, 'plan_estimate', { fase: 'PLAN', unidade: 'hours', semIaHoras: dados.semIaHoras, iaSemOrkHoras: dados.iaSemOrkHoras, por: dados.por, metodo: dados.metodo, premissas: dados.premissas, incerteza: dados.incerteza ?? 'nao informada', head: head.stdout.trim() });
}

export function textoDasEstatisticas(r: LedgerStats): string {
  const dinheiro = r.custoReferencia.valor === null ? 'sem cobertura' : `USD ${r.custoReferencia.valor.toFixed(6)}`;
  return [
    `Ledger stats  ${formatarDataHora(r.periodo.desde)} ate ${formatarDataHoraRotulada(r.periodo.ate)} ${r.periodo.intervalo}`,
    `  threads/sessoes  ${r.threads} / ${r.sessoes.concluidas} concluidas (${r.sessoes.despachadas} despachos)`,
    `  throughput       ${r.throughput.ships} ship(s); ${r.sessoes.retries} retry(ies)`,
    `  execucao         ${r.execucao.horas.toFixed(2)} h (${r.execucao.cobertura.medidas} medidas; ${r.execucao.cobertura.semMedida} ausentes)`,
    `  tokens           ${r.tokens.total} total; input ${r.tokens.input} (cached ${r.tokens.cachedInput}); output ${r.tokens.output}`,
    `  custo referencia ${dinheiro} — estimativa por tarifa publica, nao gasto/fatura`,
    `  espera humana    ${(r.esperaHumana.milissegundos / 3_600_000).toFixed(2)} h; ${r.esperaHumana.abertas} aberta(s)`,
    `  riscos evitados  ${r.riscosPreventivos.total} gate(s) preventivo(s)`,
    `  estimativas PLAN ${r.estimativasPlano.amostras} amostra(s)`,
    ...r.qualidade.observacoes.map(o => `  cobertura         ${o}`),
  ].join('\n');
}

/** RM-090 F5: avaliador local, puro e de passagem única dos seis indicadores agênticos. */
import { REGISTRO_DE_INDICADORES_AGENTICOS, TipoDeAgregacao } from './telemetria-maturidade-registro';

export interface EventoAnalitico {
  tipo: string;
  ts: string;
  thread?: string;
  fase?: string;
  eventId?: string;
  sequence?: number;
  [campo: string]: unknown;
}

export interface JanelaAnalitica { desde: string; ate: string }

export interface SerieAnalitica { id: string; valor: number | Record<string, number> | null }

export interface ResultadoDeIndicador {
  id: string;
  versao: 'v1';
  tipo: TipoDeAgregacao;
  populacao: number;
  cobertura: { confirmados: number; total: number; razao: number | null };
  series: SerieAnalitica[];
  lacunas: Record<string, number>;
  fontes: readonly string[];
}

export interface ResultadoDaMaturidade {
  contrato: 'ork.sdlc-analytics-result/v1';
  janela: JanelaAnalitica;
  indicadores: ResultadoDeIndicador[];
}

interface EventoOrdenado extends EventoAnalitico { ordem: number }
interface Entrega { evento: EventoOrdenado; thread: string; mergeSha: string | null; push: boolean }

const MODOS = new Set(['classic', 'maestro', 'auto', 'fast']);

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Record<string, unknown> : null;
}

function primeiro(evento: EventoAnalitico, ...campos: string[]): unknown {
  for (const campo of campos) if (evento[campo] !== undefined) return evento[campo];
  return undefined;
}

function aninhado(evento: EventoAnalitico, campo: string, subcampo: string): unknown {
  return objeto(evento[campo])?.[subcampo];
}

function dentro(ts: string, janela: JanelaAnalitica): boolean {
  const instante = Date.parse(ts), desde = Date.parse(janela.desde), ate = Date.parse(janela.ate);
  return Number.isFinite(instante) && Number.isFinite(desde) && Number.isFinite(ate)
    && instante >= desde && instante < ate;
}

function incrementar(mapa: Record<string, number>, chave: string, quantidade = 1): void {
  mapa[chave] = (mapa[chave] ?? 0) + quantidade;
}

function modo(evento: EventoAnalitico): string | null {
  const bruto = texto(primeiro(evento, 'modo', 'mode', 'tag'))?.replace(/^#/, '').toLowerCase() ?? null;
  return bruto && MODOS.has(bruto) ? bruto : null;
}

function reciboValido(evento: EventoAnalitico, mergeSha: string): boolean | null {
  const recibo = objeto(evento.recibo) ?? objeto(evento.receipt);
  const veredito = texto(primeiro(evento, 'veredito', 'resultado', 'estado'))?.toLowerCase();
  const parcial = evento.parcial === true || recibo?.parcial === true;
  const contrato = texto(recibo?.contrato ?? recibo?.schema);
  const head = texto(primeiro(evento, 'head', 'sha', 'commit') ?? recibo?.head ?? recibo?.commit);
  if (!recibo && !veredito) return null;
  return contrato === 'ork.recibo-prova/v1' && !parcial && veredito === 'verde' && head === mergeSha;
}

function achados(evento: EventoAnalitico): string[] {
  const diretos = Array.isArray(evento.achadoIds) ? evento.achadoIds : [];
  const parecer = objeto(evento.parecer);
  const estruturados = Array.isArray(parecer?.achados) ? parecer.achados : [];
  return [...diretos, ...estruturados].map((item) => typeof item === 'string' ? item : texto(objeto(item)?.id))
    .filter((item): item is string => Boolean(item));
}

function resultadoBase(id: string, populacao: number, confirmados: number, series: SerieAnalitica[],
  lacunas: Record<string, number>): ResultadoDeIndicador {
  const definicao = REGISTRO_DE_INDICADORES_AGENTICOS.find((item) => item.id === id)!;
  return { id, versao: definicao.versao, tipo: definicao.tipo, populacao,
    cobertura: { confirmados, total: populacao, razao: populacao ? confirmados / populacao : null },
    series, lacunas, fontes: definicao.fontes };
}

/**
 * Lê cada evento no máximo uma vez. A finalização percorre somente mapas e conjuntos acumulados.
 */
export function calcularMaturidade(eventos: readonly EventoAnalitico[], janela: JanelaAnalitica): ResultadoDaMaturidade {
  const vistos = new Set<string>(), lacunasGlobais: Record<string, number> = {};
  const entregas = new Map<string, Entrega>(), verifies = new Map<string, EventoOrdenado[]>();
  const goFixPorThread = new Map<string, EventoOrdenado[]>(), checks = new Set<string>();
  const achadosDistintos = new Set<string>(), rodadasDistintas = new Set<string>();
  const threadsA3 = new Set<string>(), decisoes = new Set<string>(), perguntas = new Set<string>();
  const reversoes = new Set<string>(), threadsA4 = new Set<string>();
  const excecoes = new Set<string>(), lacunasA5: Record<string, number> = {};
  const modosCriacao: Record<string, number> = {}, modosMerge: Record<string, number> = {};
  let populacaoA5 = 0, populacaoCriacao = 0, populacaoMerge = 0, confirmadosA6 = 0;

  eventos.forEach((evento, indice) => {
    if (!dentro(evento.ts, janela)) return;
    const uid = texto(evento.eventId);
    if (!uid) { incrementar(lacunasGlobais, 'event_id_ausente'); return; }
    if (vistos.has(uid)) return;
    vistos.add(uid);
    const thread = texto(evento.thread);
    const ordem = typeof evento.sequence === 'number' ? evento.sequence : indice;
    const ordenado: EventoOrdenado = { ...evento, ordem };

    if (evento.tipo === 'ship_done' && thread) {
      const mergeSha = texto(primeiro(evento, 'mergeSha', 'sha', 'head'));
      entregas.set(thread, { evento: ordenado, thread, mergeSha,
        push: evento.pushVerificado === true || aninhado(evento, 'evidencia', 'pushVerificado') === true });
      populacaoMerge += 1;
      const m = modo(evento);
      if (m) { incrementar(modosMerge, m); confirmadosA6 += 1; }
    }
    if (evento.tipo === 'verify_run' && thread) {
      const lista = verifies.get(thread) ?? []; lista.push(ordenado); verifies.set(thread, lista);
    }
    if (evento.tipo === 'go_fix_opened' && thread) {
      const lista = goFixPorThread.get(thread) ?? []; lista.push(ordenado); goFixPorThread.set(thread, lista);
      threadsA3.add(thread);
      const rodada = texto(primeiro(evento, 'rodada', 'roundId', 'rodadaId'));
      if (rodada) rodadasDistintas.add(`${thread}:${rodada}`);
      for (const id of achados(evento)) achadosDistintos.add(`${thread}:${id}`);
    }
    if ((evento.tipo === 'check_reverify' || (evento.tipo === 'phase_result' && evento.fase === 'CHECK')) && thread) {
      checks.add(thread); threadsA3.add(thread);
    }
    if (evento.tipo === 'autonomous_decision' && thread) {
      threadsA4.add(thread);
      const id = texto(primeiro(evento, 'decisionId', 'decisaoId', 'eventId'));
      if (id) decisoes.add(id);
      const reverte = texto(evento.reverte);
      if (reverte) reversoes.add(reverte);
    }
    if (evento.tipo === 'hitl_requested' && thread) {
      threadsA4.add(thread);
      const id = texto(primeiro(evento, 'requestId', 'pedidoId', 'eventId'));
      const alvo = texto(primeiro(evento, 'alvo', 'target', 'decisionId'));
      if (id && alvo) perguntas.add(id);
    }
    if (evento.tipo === 'ship_unscanned_authorized') {
      populacaoA5 += 1;
      const politica = texto(primeiro(evento, 'politica', 'policy'));
      const motivo = texto(primeiro(evento, 'motivo', 'reason'));
      const recibo = texto(primeiro(evento, 'reciboId', 'receiptId'));
      const escritor = texto(primeiro(evento, 'writer', 'escritor'));
      if (!politica) incrementar(lacunasA5, 'politica_ausente');
      if (!motivo) incrementar(lacunasA5, 'motivo_ausente');
      if (!recibo) incrementar(lacunasA5, 'recibo_ausente');
      if (escritor !== 'ork.ship') incrementar(lacunasA5, 'escritor_desconhecido');
      if (politica && motivo && recibo && escritor === 'ork.ship') excecoes.add(uid);
    }
    if (evento.tipo === 'thread_created') {
      populacaoCriacao += 1;
      const m = modo(evento);
      if (m && thread) { incrementar(modosCriacao, m); confirmadosA6 += 1; }
    }
  });

  const lacunasA1 = { ...lacunasGlobais }, lacunasA2 = { ...lacunasGlobais };
  let positivosA1 = 0, negativosA1 = 0, positivosA2 = 0, negativosA2 = 0;
  for (const entrega of entregas.values()) {
    const politica = texto(primeiro(entrega.evento, 'receiptPolicyVersion', 'politicaReciboVersao'));
    if (!politica) { incrementar(lacunasA1, 'politica_historica_ausente'); incrementar(lacunasA2, 'recibo_final_ausente'); continue; }
    if (!entrega.mergeSha) { incrementar(lacunasA1, 'merge_ausente'); incrementar(lacunasA2, 'recibo_final_ausente'); continue; }
    if (!entrega.push) { incrementar(lacunasA1, 'push_nao_provado'); incrementar(lacunasA2, 'recibo_final_ausente'); continue; }
    const daThread = (verifies.get(entrega.thread) ?? []).filter((item) => item.ordem < entrega.evento.ordem)
      .sort((a, b) => a.ordem - b.ordem);
    const final = [...daThread].reverse().find((item) => item.parcial !== true);
    const finalValido = final ? reciboValido(final, entrega.mergeSha) : null;
    if (finalValido === true) positivosA1 += 1;
    else if (finalValido === false) negativosA1 += 1;
    else incrementar(lacunasA1, 'recibo_ausente');

    const primeira = daThread.find((item) => item.parcial !== true && texto(primeiro(item, 'veredito', 'resultado', 'estado')));
    if (!primeira || finalValido === null) { incrementar(lacunasA2, 'primeira_rodada_ausente'); continue; }
    const primeiroVeredito = texto(primeiro(primeira, 'veredito', 'resultado', 'estado'))?.toLowerCase();
    const vermelhoPosterior = daThread.some((item) => item.ordem >= primeira.ordem
      && texto(primeiro(item, 'veredito', 'resultado', 'estado'))?.toLowerCase() === 'vermelho');
    const houveFix = (goFixPorThread.get(entrega.thread) ?? []).some((item) => item.ordem < entrega.evento.ordem);
    if (primeiroVeredito === 'verde' && !vermelhoPosterior && !houveFix && finalValido) positivosA2 += 1;
    else negativosA2 += 1;
  }

  const populacaoA1 = entregas.size, confirmadosA1 = positivosA1 + negativosA1;
  const populacaoA2 = entregas.size, confirmadosA2 = positivosA2 + negativosA2;
  const lacunasA3: Record<string, number> = { ...lacunasGlobais };
  for (const thread of threadsA3) {
    const fixes = goFixPorThread.get(thread) ?? [];
    if (fixes.some((item) => !texto(primeiro(item, 'rodada', 'roundId', 'rodadaId')))) incrementar(lacunasA3, 'rodada_ausente');
    if (fixes.some((item) => achados(item).length === 0)) incrementar(lacunasA3, 'achado_estruturado_ausente');
    if (checks.has(thread) && fixes.length === 0) incrementar(lacunasA3, 'achado_estruturado_ausente');
  }
  const confirmadosA3 = [...threadsA3].filter((thread) => (goFixPorThread.get(thread) ?? [])
    .some((item) => achados(item).length > 0 && texto(primeiro(item, 'rodada', 'roundId', 'rodadaId')))).length;
  const lacunasA4: Record<string, number> = { ...lacunasGlobais };
  const confirmadosA4 = decisoes.size + perguntas.size + reversoes.size;
  const populacaoA4 = threadsA4.size;
  const confirmadosA5 = excecoes.size;
  const populacaoA6 = populacaoCriacao + populacaoMerge;
  const indicadores = [
    resultadoBase('agent.merge_receipt_coverage', populacaoA1, confirmadosA1,
      [{ id: 'taxa', valor: confirmadosA1 ? positivosA1 / confirmadosA1 : null },
        { id: 'positivos', valor: positivosA1 }, { id: 'negativos', valor: negativosA1 }], lacunasA1),
    resultadoBase('agent.first_truth_sustained', populacaoA2, confirmadosA2,
      [{ id: 'taxa', valor: confirmadosA2 ? positivosA2 / confirmadosA2 : null },
        { id: 'positivos', valor: positivosA2 }, { id: 'negativos', valor: negativosA2 }], lacunasA2),
    resultadoBase('agent.check_rework', threadsA3.size, confirmadosA3,
      [{ id: 'achados', valor: achadosDistintos.size }, { id: 'rodadas', valor: rodadasDistintas.size }], lacunasA3),
    resultadoBase('agent.decisions_questions_reversals', populacaoA4, confirmadosA4,
      [{ id: 'decisoes', valor: decisoes.size }, { id: 'perguntas', valor: perguntas.size },
        { id: 'reversoes', valor: reversoes.size }], lacunasA4),
    resultadoBase('agent.policy_exceptions', populacaoA5, confirmadosA5,
      [{ id: 'excecoes', valor: excecoes.size }], lacunasA5),
    resultadoBase('agent.mode_usage', populacaoA6, confirmadosA6,
      [{ id: 'threads_criadas', valor: modosCriacao }, { id: 'merges', valor: modosMerge }],
      { ...lacunasGlobais, ...(confirmadosA6 < populacaoA6 ? { modo_ou_thread_ausente: populacaoA6 - confirmadosA6 } : {}) }),
  ];
  return { contrato: 'ork.sdlc-analytics-result/v1', janela, indicadores };
}

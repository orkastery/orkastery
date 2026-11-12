/** RM-090 F5: avaliador local, puro e de passagem única dos seis indicadores agênticos. */
import { CONTRATO_DO_RECIBO_DE_PROVA } from './recibo-prova';
import { AcumuladorDoIndicador, DefinicaoDeIndicador, REGISTRO_DE_INDICADORES_AGENTICOS,
  TipoDeAgregacao } from './telemetria-maturidade-registro';

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

interface VerifyNormalizado {
  evento: EventoAnalitico;
  integral: boolean;
  veredito: 'verde' | 'vermelho' | null;
  recibo: Record<string, unknown> | null;
}

interface EstadoDaThread {
  primeiroTerminal: VerifyNormalizado | null;
  ultimoReciboIntegral: VerifyNormalizado | null;
  invalidado: boolean;
  teveFix: boolean;
  fixValido: boolean;
  fixInvalido: boolean;
}

const MODOS = new Set(['classic', 'maestro', 'auto', 'fast']);
const HASH = /^[a-f0-9]{64}$/;

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function textoEscalar(valor: unknown): string | null {
  return typeof valor === 'number' && Number.isSafeInteger(valor) ? String(valor) : texto(valor);
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

function vereditoNormalizado(valor: unknown): 'verde' | 'vermelho' | null {
  const bruto = texto(valor)?.toLowerCase();
  if (bruto === 'verdade sustentada' || bruto === 'verde') return 'verde';
  if (bruto === 'reprovado' || bruto === 'vermelho') return 'vermelho';
  return null;
}

function normalizarVerify(evento: EventoAnalitico): VerifyNormalizado {
  const recibo = objeto(evento.recibo) ?? objeto(evento.receipt);
  const parcial = evento.parcial === true || recibo?.parcial === true;
  return { evento, integral: !parcial,
    veredito: vereditoNormalizado(primeiro(evento, 'veredito', 'resultado', 'estado') ?? recibo?.veredito),
    recibo };
}

function reciboValido(verify: VerifyNormalizado | null, headEsperado: string): boolean | null {
  if (!verify?.recibo) return null;
  const recibo = verify.recibo;
  const dependencias = recibo.dependenciasExternas;
  const formaIntegra = recibo.contrato === CONTRATO_DO_RECIBO_DE_PROVA
    && texto(recibo.head) === headEsperado
    && HASH.test(texto(recibo.claimsSha256) ?? '')
    && HASH.test(texto(recibo.planoSha256) ?? '')
    && Array.isArray(dependencias)
    && dependencias.every((item) => item === 'rede' || item === 'relogio')
    && HASH.test(texto(recibo.sha256) ?? '');
  return verify.integral && verify.veredito === 'verde' && formaIntegra;
}

function achados(evento: EventoAnalitico): string[] {
  const colecoes = [evento.correcoes, evento.achadoIds, objeto(evento.parecer)?.achados];
  const ids: string[] = [];
  for (const colecao of colecoes) {
    if (!Array.isArray(colecao)) continue;
    for (const item of colecao) {
      const id = typeof item === 'string' ? texto(item) : texto(objeto(item)?.id);
      if (id) ids.push(id);
    }
  }
  return ids;
}

function estadoDaThread(estados: Map<string, EstadoDaThread>, thread: string): EstadoDaThread {
  let estado = estados.get(thread);
  if (!estado) {
    estado = { primeiroTerminal: null, ultimoReciboIntegral: null, invalidado: false,
      teveFix: false, fixValido: false, fixInvalido: false };
    estados.set(thread, estado);
  }
  return estado;
}

function alvoTipado(valor: unknown): boolean {
  const alvo = objeto(valor);
  return Boolean(alvo && texto(alvo.tipo)
    && (texto(alvo.id) || texto(alvo.sobre) || texto(alvo.sessionId)));
}

export interface AcumuladoExecutavel {
  populacao: number;
  confirmados: number;
  valores: Record<string, number | Record<string, number>>;
  lacunas: Record<string, number>;
}

/** Interpreta fórmula, séries e cobertura diretamente da definição versionada. */
export function interpretarDefinicao(definicao: DefinicaoDeIndicador,
  acumulado: AcumuladoExecutavel): ResultadoDeIndicador {
  let confirmados = acumulado.confirmados;
  let series: SerieAnalitica[];
  if (definicao.formula.operador === 'razao') {
    const positivos = Number(acumulado.valores[definicao.formula.positivo] ?? 0);
    const negativos = Number(acumulado.valores[definicao.formula.negativo] ?? 0);
    confirmados = positivos + negativos;
    series = [{ id: 'taxa', valor: confirmados ? positivos / confirmados : null },
      { id: definicao.formula.positivo, valor: positivos },
      { id: definicao.formula.negativo, valor: negativos }];
  } else {
    series = definicao.formula.series.map((serie) =>
      ({ id: serie.id, valor: acumulado.valores[serie.chave] ?? 0 }));
  }
  return { id: definicao.id, versao: definicao.versao, tipo: definicao.tipo,
    populacao: acumulado.populacao,
    cobertura: { confirmados, total: acumulado.populacao,
      razao: acumulado.populacao ? confirmados / acumulado.populacao : null },
    series, lacunas: acumulado.lacunas, fontes: definicao.fontes };
}

/**
 * Lê cada evento no máximo uma vez. Durante essa passagem retém os terminais integrais e os
 * contadores necessários; a finalização percorre somente mapas e conjuntos, sem reordenar eventos.
 */
export function calcularMaturidade(eventos: readonly EventoAnalitico[], janela: JanelaAnalitica): ResultadoDaMaturidade {
  const vistos = new Set<string>(), lacunasGlobais: Record<string, number> = {};
  const estados = new Map<string, EstadoDaThread>();
  const mergesA1 = new Set<string>(), threadsEntreguesA2 = new Set<string>();
  const threadsA3 = new Set<string>(), checksA3 = new Set<string>();
  const achadosDistintos = new Set<string>(), rodadasDistintas = new Set<string>();
  const decisoes = new Set<string>(), perguntas = new Set<string>(), reversoes = new Set<string>();
  const threadsA4 = new Set<string>(), decisoesVistas = new Set<string>();
  const excecoes = new Set<string>(), lacunasA4: Record<string, number> = {}, lacunasA5: Record<string, number> = {};
  const modosCriacao: Record<string, number> = {}, modosMerge: Record<string, number> = {};
  const lacunasA1: Record<string, number> = {}, lacunasA2: Record<string, number> = {};
  let positivosA1 = 0, negativosA1 = 0, positivosA2 = 0, negativosA2 = 0;
  let populacaoA5 = 0, populacaoCriacao = 0, populacaoMerge = 0, confirmadosA6 = 0;

  for (let indice = 0; indice < eventos.length; indice += 1) {
    const evento = eventos[indice];
    if (!dentro(evento.ts, janela)) continue;
    const uid = texto(evento.eventId);
    if (!uid) { incrementar(lacunasGlobais, 'event_id_ausente'); continue; }
    if (vistos.has(uid)) continue;
    vistos.add(uid);
    const thread = texto(evento.thread);
    const estado = thread ? estadoDaThread(estados, thread) : null;

    if (evento.tipo === 'verify_run' && estado) {
      const verify = normalizarVerify(evento);
      if (verify.integral && verify.recibo) estado.ultimoReciboIntegral = verify;
      if (verify.integral && verify.veredito && !estado.primeiroTerminal) estado.primeiroTerminal = verify;
      if (verify.integral && verify.veredito === 'vermelho') estado.invalidado = true;
    }

    if (evento.tipo === 'go_fix_opened' && thread && estado) {
      threadsA3.add(thread);
      estado.teveFix = true;
      estado.invalidado = true;
      const rodada = textoEscalar(primeiro(evento, 'rodada', 'roundId', 'rodadaId'));
      const ids = achados(evento);
      if (rodada) rodadasDistintas.add(`${thread}:${rodada}`);
      if (ids.length) for (const id of ids) achadosDistintos.add(`${thread}:${id}`);
      estado.fixValido ||= Boolean(rodada && ids.length);
      estado.fixInvalido ||= !rodada || ids.length === 0;
    }

    if ((evento.tipo === 'check_reverify' || (evento.tipo === 'phase_result' && evento.fase === 'CHECK')) && thread) {
      checksA3.add(thread);
      threadsA3.add(thread);
    }

    if (evento.tipo === 'autonomous_decision' && thread) {
      threadsA4.add(thread);
      const pedido = objeto(evento.pedido);
      const id = texto(pedido?.id);
      const rastroCompleto = Boolean(texto(evento.quemDecidiu) && texto(evento.evidencia) && texto(evento.razao));
      if (!id) incrementar(lacunasA4, 'id_ausente');
      if (!rastroCompleto) incrementar(lacunasA4, 'rastro_ausente');
      if (id && rastroCompleto) {
        decisoes.add(id);
        decisoesVistas.add(id);
        const reverte = texto(evento.reverte);
        if (reverte && decisoesVistas.has(reverte)) reversoes.add(reverte);
        else if (reverte) incrementar(lacunasA4, 'reversao_sem_decisao');
      }
    }

    if (evento.tipo === 'hitl_requested' && thread) {
      threadsA4.add(thread);
      const pedido = objeto(evento.pedido);
      const id = texto(pedido?.id);
      if (!id) incrementar(lacunasA4, 'id_ausente');
      if (!alvoTipado(pedido?.alvo)) incrementar(lacunasA4, 'alvo_tipado_ausente');
      if (id && alvoTipado(pedido?.alvo)) perguntas.add(id);
    }

    if (evento.tipo === 'ship_unscanned_authorized') {
      populacaoA5 += 1;
      const por = texto(evento.por), sha = texto(evento.sha);
      const categorias = Array.isArray(evento.categorias)
        ? evento.categorias.filter((item): item is string => Boolean(texto(item))) : [];
      if (!por) incrementar(lacunasA5, 'autorizador_ausente');
      if (!sha) incrementar(lacunasA5, 'sha_ausente');
      if (!categorias.length) incrementar(lacunasA5, 'categorias_ausentes');
      if (por && sha && categorias.length) excecoes.add(uid);
    }

    if (evento.tipo === 'thread_created') {
      populacaoCriacao += 1;
      const m = modo(evento);
      if (m && thread) { incrementar(modosCriacao, m); confirmadosA6 += 1; }
    }

    if (evento.tipo === 'ship_done') {
      populacaoMerge += 1;
      const m = modo(evento);
      if (m && thread) { incrementar(modosMerge, m); confirmadosA6 += 1; }
      const mergeSha = texto(primeiro(evento, 'mergeSha', 'merge'));
      const chaveMerge = mergeSha ?? uid;
      if (!mergesA1.has(chaveMerge)) {
        mergesA1.add(chaveMerge);
        const politica = texto(primeiro(evento, 'politicaReciboVersao', 'receiptPolicyVersion'));
        const headVerificado = texto(aninhado(evento, 'evidencia', 'verificadoNoCommit')
          ?? primeiro(evento, 'shaDe', 'sourceSha'));
        const push = evento.pushVerificado === true || aninhado(evento, 'evidencia', 'pushVerificado') === true;
        if (!mergeSha) incrementar(lacunasA1, 'merge_ausente');
        else if (!politica) incrementar(lacunasA1, 'politica_historica_ausente');
        else if (politica !== CONTRATO_DO_RECIBO_DE_PROVA) incrementar(lacunasA1, 'politica_historica_desconhecida');
        else if (!headVerificado) incrementar(lacunasA1, 'head_ausente');
        else if (!push) incrementar(lacunasA1, 'push_nao_provado');
        else {
          const valido = reciboValido(estado?.ultimoReciboIntegral ?? null, headVerificado);
          if (valido === true) positivosA1 += 1;
          else if (valido === false) negativosA1 += 1;
          else incrementar(lacunasA1, 'recibo_ausente');
        }
      }

      if (thread && !threadsEntreguesA2.has(thread)) {
        threadsEntreguesA2.add(thread);
        const headVerificado = texto(aninhado(evento, 'evidencia', 'verificadoNoCommit')
          ?? primeiro(evento, 'shaDe', 'sourceSha'));
        const push = evento.pushVerificado === true || aninhado(evento, 'evidencia', 'pushVerificado') === true;
        const primeiroTerminal = estado?.primeiroTerminal ?? null;
        if (!headVerificado || !push || !primeiroTerminal) {
          incrementar(lacunasA2, primeiroTerminal ? 'recibo_final_ausente' : 'primeira_rodada_ausente');
        } else {
          const finalValido = reciboValido(estado?.ultimoReciboIntegral ?? null, headVerificado);
          if (finalValido === null) incrementar(lacunasA2, 'recibo_final_ausente');
          else if (primeiroTerminal.veredito === 'verde' && !estado?.invalidado && !estado?.teveFix && finalValido) {
            positivosA2 += 1;
          } else negativosA2 += 1;
        }
      }
    }
  }

  const lacunasComunsA1 = { ...lacunasGlobais, ...lacunasA1 };
  const lacunasComunsA2 = { ...lacunasGlobais, ...lacunasA2 };
  const lacunasA3: Record<string, number> = { ...lacunasGlobais };
  let confirmadosA3 = 0;
  for (const thread of threadsA3) {
    const estado = estados.get(thread);
    if (estado?.fixInvalido) incrementar(lacunasA3, 'achado_ou_rodada_ausente');
    if (checksA3.has(thread) && !estado?.teveFix) incrementar(lacunasA3, 'achado_estruturado_ausente');
    if (estado?.fixValido) confirmadosA3 += 1;
  }

  const populacaoA1 = mergesA1.size, confirmadosA1 = positivosA1 + negativosA1;
  const populacaoA2 = threadsEntreguesA2.size, confirmadosA2 = positivosA2 + negativosA2;
  const confirmadosA4 = decisoes.size + perguntas.size + reversoes.size;
  const confirmadosA5 = excecoes.size;
  const populacaoA6 = populacaoCriacao + populacaoMerge;
  const acumulados: Record<AcumuladorDoIndicador, AcumuladoExecutavel> = {
    merge_receipt: { populacao: populacaoA1, confirmados: confirmadosA1,
      valores: { positivos: positivosA1, negativos: negativosA1 }, lacunas: lacunasComunsA1 },
    first_truth: { populacao: populacaoA2, confirmados: confirmadosA2,
      valores: { positivos: positivosA2, negativos: negativosA2 }, lacunas: lacunasComunsA2 },
    check_rework: { populacao: threadsA3.size, confirmados: confirmadosA3,
      valores: { achados: achadosDistintos.size, rodadas: rodadasDistintas.size }, lacunas: lacunasA3 },
    decisions_questions_reversals: { populacao: threadsA4.size, confirmados: confirmadosA4,
      valores: { decisoes: decisoes.size, perguntas: perguntas.size, reversoes: reversoes.size },
      lacunas: { ...lacunasGlobais, ...lacunasA4 } },
    policy_exceptions: { populacao: populacaoA5, confirmados: confirmadosA5,
      valores: { excecoes: excecoes.size }, lacunas: { ...lacunasGlobais, ...lacunasA5 } },
    mode_usage: { populacao: populacaoA6, confirmados: confirmadosA6,
      valores: { threads_criadas: modosCriacao, merges: modosMerge },
      lacunas: { ...lacunasGlobais,
        ...(confirmadosA6 < populacaoA6 ? { modo_ou_thread_ausente: populacaoA6 - confirmadosA6 } : {}) } },
  };
  const indicadores = REGISTRO_DE_INDICADORES_AGENTICOS.map((definicao) =>
    interpretarDefinicao(definicao, acumulados[definicao.formula.acumulador]));
  return { contrato: 'ork.sdlc-analytics-result/v1', janela, indicadores };
}

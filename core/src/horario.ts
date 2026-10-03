/**
 * I-35: horário do dono em toda superfície humana (domicílio único).
 *
 * Ordem do dono em 19/09/2026: nunca mais horário UTC para se comunicar com ele. Todo
 * horário que o Orkastery mostra a uma pessoa passa por aqui. O fuso sai do manifesto
 * (`owner.timezone`, nome IANA), com o fuso do sistema como default e UTC como piso; o
 * formato é o brasileiro (`19/09 15:16`) e o fuso aparece uma vez por mensagem.
 *
 * Dado de máquina (ledger, JSON, recibos, hashes) continua em UTC ISO: este módulo só
 * formata na saída, nunca reescreve o que é gravado. Ele também não importa o manifesto
 * (sem ciclo): quem conhece o projeto registra a fonte com `registrarFonteDoFuso`.
 */

import { Locale, localeAtivo, msg } from './locale';

export const CHAVE_DO_FUSO = 'owner.timezone';
/** Único fuso com nome próprio no rótulo; exemplo da documentação e do `ork init`. */
export const FUSO_DE_BRASILIA = 'America/Sao_Paulo';

export interface FusoDoDono {
  fuso: string;
  origem: 'manifesto' | 'sistema';
  /** Presente quando o manifesto trouxe um valor que o Intl recusou. */
  aviso?: string;
}

export interface OpcoesDeFormato {
  /** Fuso explícito; sem ele vale `fusoDoDono()`. */
  fuso?: string;
  /** Referência de "hoje", do ano corrente e do relativo; sem ela vale o relógio. */
  agora?: string | number | Date;
  /**
   * Prova de conceito do CLI por locale (EN6): pt-BR escreve `19/09 15:16`; `en` escreve a data ISO,
   * `2026-09-19 15:16`, que um leitor dos EUA nao le como mes/dia. Sem ela vale o locale ativo, que so
   * os comandos de `COMANDOS_COM_LOCALE` trocam.
   */
  locale?: Locale;
}

/** Forma canônica do Intl (`america/sao_paulo` vira `America/Sao_Paulo`) ou undefined. */
export function normalizarFuso(bruto: unknown): string | undefined {
  if (typeof bruto !== 'string' || bruto.trim() === '') return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: bruto.trim() }).resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Fuso do sistema (`TZ` ou configuração do SO), com piso UTC quando nada resolve. */
export function fusoDoSistema(): string {
  try {
    return normalizarFuso(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Valor bruto de `owner.timezone`: válido vale; ausente cai no sistema; inválido avisa. */
export function lerFusoDoDono(bruto: unknown): FusoDoDono {
  const fuso = normalizarFuso(bruto);
  if (fuso) return { fuso, origem: 'manifesto' };
  const sistema = fusoDoSistema();
  if (bruto === undefined || bruto === null || bruto === '') return { fuso: sistema, origem: 'sistema' };
  return {
    fuso: sistema,
    origem: 'sistema',
    aviso: `${CHAVE_DO_FUSO} invalido (${JSON.stringify(bruto).slice(0, 80)}): usando o fuso do sistema ` +
      `(${sistema}); informe um nome IANA, ex.: ${FUSO_DE_BRASILIA}`,
  };
}

/** Fuso de um manifesto já carregado; o aviso de valor inválido vem de `avisos`. */
export function fusoDoManifesto(carregado: {
  manifesto: { owner?: { timezone?: string } };
  avisos?: readonly string[];
} | null | undefined): FusoDoDono {
  const configurado = carregado?.manifesto.owner?.timezone;
  if (configurado) return lerFusoDoDono(configurado);
  const aviso = carregado?.avisos?.find(a => a.startsWith(`${CHAVE_DO_FUSO} `));
  return { fuso: fusoDoSistema(), origem: 'sistema', ...(aviso ? { aviso } : {}) };
}

let fonte: (() => FusoDoDono) | undefined;
let resolvido: FusoDoDono | undefined;
let fixo = false;
let avisado = false;

/**
 * O ponto de entrada (CLI no cwd, MCP no `--project`) diz de onde vem o fuso. A leitura é
 * preguiçosa: comando que não mostra horário não carrega nada a mais. Um fuso fixado por
 * `definirFusoDoDono` prevalece.
 */
export function registrarFonteDoFuso(f: () => FusoDoDono): void {
  if (fixo) return;
  fonte = f;
  resolvido = undefined;
  avisado = false;
}

/** Fixa o fuso do processo (testes, host que já resolveu); undefined volta ao default. */
export function definirFusoDoDono(fuso: string | undefined): void {
  fonte = undefined;
  avisado = false;
  fixo = fuso !== undefined;
  resolvido = fuso === undefined ? undefined : lerFusoDoDono(fuso);
}

/** Fuso do dono deste processo; o aviso de valor inválido sai no stderr uma única vez. */
export function fusoDoDono(): FusoDoDono {
  if (!resolvido) {
    try {
      resolvido = fonte ? fonte() : { fuso: fusoDoSistema(), origem: 'sistema' };
    } catch {
      resolvido = { fuso: fusoDoSistema(), origem: 'sistema' };
    }
  }
  if (resolvido.aviso && !avisado) {
    avisado = true;
    process.stderr.write(`aviso: ${resolvido.aviso}\n`);
  }
  return resolvido;
}

// ---------------------------------------------------------------------------
// Partes de data no fuso
// ---------------------------------------------------------------------------

export interface PartesLocais { ano: string; mes: string; dia: string; hora: string; minuto: string; segundo: string }

const formatadores = new Map<string, Intl.DateTimeFormat>();
const ISO_SEM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** Milissegundos do instante; data-hora sem fuso é ambígua e vira NaN (sem chute). */
function instante(v: string | number | Date | undefined | null): number {
  if (v === undefined) return Date.now();
  if (v === null) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || ISO_SEM_FUSO.test(v.trim())) return NaN;
  return Date.parse(v);
}

/** Ano, mês, dia, hora, minuto e segundo do instante no fuso pedido (relógio de 24 h). */
export function partesLocais(quando: string | number | Date, fuso: string = fusoDoDono().fuso): PartesLocais {
  const ms = instante(quando);
  if (!Number.isFinite(ms)) throw new Error('data inválida');
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatadores.set(fuso, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second };
}

/** Data local `AAAA-MM-DD` do instante no fuso (chave de dia, não texto para pessoa). */
export function dataLocal(quando: string | number | Date, fuso: string = fusoDoDono().fuso): string {
  const p = partesLocais(quando, fuso);
  return `${p.ano}-${p.mes}-${p.dia}`;
}

/** Quanto o relógio do fuso está à frente do UTC no instante, em milissegundos. */
function desvioDoFuso(ms: number, fuso: string): number {
  const p = partesLocais(ms, fuso);
  return Date.UTC(Number(p.ano), Number(p.mes) - 1, Number(p.dia), Number(p.hora), Number(p.minuto), Number(p.segundo)) -
    Math.floor(ms / 1000) * 1000;
}

/**
 * RM-037 (fatia 5): o instante de um relógio num fuso IANA (mês de 1 a 12). O runtime diz a hora de
 * volta da cota no fuso dele (`resets 4:40am (<fuso>)`), e lê-la no relógio desta máquina errava o
 * prazo em quem roda noutro fuso. Fuso que o Intl recusa e data que não existe voltam NaN, sem chute.
 * Na volta do horário de verão vale o primeiro dos dois instantes; o relógio que o salto pula cai
 * depois do salto.
 */
export function instanteNoFuso(ano: number, mes: number, dia: number, hora: number, minuto: number, fuso: string): number {
  const nome = normalizarFuso(fuso);
  const base = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (!nome || !Number.isFinite(base) || data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 ||
      data.getUTCDate() !== dia) return NaN;
  // Os desvios de um dia antes e de um dia depois cobrem os dois lados de qualquer mudança de horário.
  const candidatos = [...new Set([base - 86400000, base, base + 86400000].map((ms) => base - desvioDoFuso(ms, nome)))]
    .sort((a, b) => a - b);
  const exatos = candidatos.filter((ms) => ms + desvioDoFuso(ms, nome) === base);
  return exatos[0] ?? base - desvioDoFuso(base - 86400000, nome);
}

// ---------------------------------------------------------------------------
// Texto para pessoa
// ---------------------------------------------------------------------------

/** Duração curta de minutos inteiros: `45min`, `1h00`, `2d 16h`. */
export function duracaoCurta(minutos: number): string {
  if (minutos < 60) return `${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h${String(minutos % 60).padStart(2, '0')}`;
  return `${Math.floor(horas / 24)}d ${String(horas % 24).padStart(2, '0')}h`;
}

/** Duração até ou desde agora: abaixo de 1 min diz `menos de 1 min`, nunca `0min`. */
export function duracaoRelativa(minutos: number): string {
  return minutos < 1 ? 'menos de 1 min' : duracaoCurta(minutos);
}

function sigla(fuso: string, ms: number, locale: Locale = localeAtivo()): string {
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'pt-BR', { timeZone: fuso, timeZoneName: 'short' })
      .formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** Como o fuso aparece entre parênteses: `horário de Brasília`, `UTC`, `Europe/Lisbon, GMT+1`. */
export function rotuloDoFuso(fuso: string = fusoDoDono().fuso, quando?: string | number | Date): string {
  if (fuso === FUSO_DE_BRASILIA) return msg().horario.brasilia;
  if (fuso === 'UTC') return 'UTC';
  const ms = instante(quando);
  const s = sigla(fuso, Number.isFinite(ms) ? ms : Date.now());
  return s && s !== fuso ? `${fuso}, ${s}` : fuso;
}

/** Legenda de mensagem com vários horários: `Horários de Brasília.` */
export function legendaDoFuso(fuso: string = fusoDoDono().fuso, quando?: string | number | Date): string {
  if (fuso === FUSO_DE_BRASILIA) return msg().horario.legendaBrasilia;
  return msg().horario.legenda(rotuloDoFuso(fuso, quando));
}

/**
 * `19/09 15:16`; `19/09/2025 15:16` quando o ano não é o corrente do dono. Em `en`, sempre
 * `2026-09-19 15:16` (EN6). Inválido volta como veio.
 */
export function formatarDataHora(quando: string | number | Date | null | undefined,
  opcoes: OpcoesDeFormato & { segundos?: boolean } = {}): string {
  const ms = instante(quando ?? null);
  if (!Number.isFinite(ms)) return quando === null || quando === undefined ? '' : String(quando);
  const fuso = opcoes.fuso ?? fusoDoDono().fuso;
  const p = partesLocais(ms, fuso), a = partesLocais(instante(opcoes.agora), fuso);
  if ((opcoes.locale ?? localeAtivo()) === 'en') {
    return `${p.ano}-${p.mes}-${p.dia} ${p.hora}:${p.minuto}` + (opcoes.segundos ? `:${p.segundo}` : '');
  }
  return `${p.dia}/${p.mes}${p.ano !== a.ano ? `/${p.ano}` : ''} ${p.hora}:${p.minuto}` +
    (opcoes.segundos ? `:${p.segundo}` : '');
}

/** Só `15:16` quando é hoje no fuso do dono; senão a data-hora completa. */
export function formatarHora(quando: string | number | Date | null | undefined,
  opcoes: OpcoesDeFormato & { segundos?: boolean } = {}): string {
  const ms = instante(quando ?? null);
  if (!Number.isFinite(ms)) return formatarDataHora(quando, opcoes);
  const fuso = opcoes.fuso ?? fusoDoDono().fuso;
  const p = partesLocais(ms, fuso), a = partesLocais(instante(opcoes.agora), fuso);
  if (p.ano !== a.ano || p.mes !== a.mes || p.dia !== a.dia) return formatarDataHora(ms, { ...opcoes, fuso });
  return `${p.hora}:${p.minuto}${opcoes.segundos ? `:${p.segundo}` : ''}`;
}

/** Data-hora absoluta com o fuso entre parênteses: estável para JSON de exibição. */
export function formatarDataHoraRotulada(quando: string | number | Date | null | undefined,
  opcoes: OpcoesDeFormato = {}): string {
  const ms = instante(quando ?? null);
  if (!Number.isFinite(ms)) return formatarDataHora(quando, opcoes);
  const fuso = opcoes.fuso ?? fusoDoDono().fuso;
  return `${formatarDataHora(ms, { ...opcoes, fuso })} (${rotuloDoFuso(fuso, ms)})`;
}

/**
 * Prazo: `19/09 16:16, em 1h00` ou `19/09 14:00, venceu há 5min`; a menos de 1 min, `em menos de
 * 1 min` ou `venceu há menos de 1 min`. `rotulo` põe o fuso.
 */
export function formatarPrazo(quando: string | number | Date | null | undefined,
  opcoes: OpcoesDeFormato & { rotulo?: boolean } = {}): string {
  const ms = instante(quando ?? null);
  if (!Number.isFinite(ms)) return formatarDataHora(quando, opcoes);
  const fuso = opcoes.fuso ?? fusoDoDono().fuso;
  const base = opcoes.rotulo ? formatarDataHoraRotulada(ms, { ...opcoes, fuso }) : formatarDataHora(ms, { ...opcoes, fuso });
  const diferenca = ms - instante(opcoes.agora);
  return diferenca >= 0
    ? `${base}, em ${duracaoRelativa(diferenca < 60000 ? 0 : Math.ceil(diferenca / 60000))}`
    : `${base}, venceu há ${duracaoRelativa(Math.floor(-diferenca / 60000))}`;
}

/**
 * Desde: `11:00 (há 4h16)` hoje, `16/09 22:53 (há 2d 16h)` em outro dia, `(há menos de 1 min)`
 * no limite. Instante 1 min ou mais à frente do relógio diz `relógio adiantado`. `rotulo` põe o fuso.
 */
export function formatarDesde(quando: string | number | Date | null | undefined,
  opcoes: OpcoesDeFormato & { rotulo?: boolean } = {}): string {
  const ms = instante(quando ?? null);
  if (!Number.isFinite(ms)) return formatarDataHora(quando, opcoes);
  const fuso = opcoes.fuso ?? fusoDoDono().fuso;
  const diferenca = instante(opcoes.agora) - ms;
  const prefixo = `${formatarHora(ms, { ...opcoes, fuso })} (${opcoes.rotulo ? `${rotuloDoFuso(fuso, ms)}, ` : ''}`;
  if (diferenca <= -60000) return `${prefixo}relógio adiantado: ${duracaoCurta(Math.floor(-diferenca / 60000))} no futuro)`;
  return `${prefixo}há ${duracaoRelativa(Math.max(0, Math.floor(diferenca / 60000)))})`;
}

/** ISO completo com `Z` ou offset; sem fuso fica como está (ambíguo, sem chute). */
const ISO_EM_TEXTO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;

/**
 * Localiza os instantes ISO de um texto já composto (detalhe, evidência, correção) na hora
 * de exibir. O dado gravado continua com o ISO; quem exibe põe a legenda uma vez.
 */
export function localizarTexto(texto: string, opcoes: OpcoesDeFormato & { segundos?: boolean } = {}): string {
  return texto.replace(ISO_EM_TEXTO, iso => formatarDataHora(iso, opcoes));
}

/** Como `localizarTexto`, e rotula o fuso no fim quando algum horário foi trocado (campo de uma linha). */
export function localizarTextoRotulado(texto: string, opcoes: OpcoesDeFormato & { segundos?: boolean } = {}): string {
  const local = localizarTexto(texto, opcoes);
  return local === texto ? texto : `${local} (${rotuloDoFuso(opcoes.fuso ?? fusoDoDono().fuso, opcoes.agora)})`;
}

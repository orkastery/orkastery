/**
 * RM-067 (F2 da ork-grokbuild, D7): o stream `streaming-json` do Grok Build (`grok -p ... --output-format
 * streaming-json`), lido por linha.
 *
 * Formato do guia `14-headless-mode` do repositório `xai-org/grok-build`, lido em 25/10/2026: NDJSON com `type`. O `end`
 * é sempre o último evento e traz `stopReason` em snake_case (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`,
 * `cancelled`), `sessionId`, `requestId`, `usage`, `num_turns`, `modelUsage` e, só quando o servidor informa o custo
 * inteiro, `total_cost_usd`; o `error` traz `message`. A lista de tipos não é exaustiva (`max_turns_reached`,
 * `auto_compact_*`): tipo desconhecido é ignorado. O texto do agente (`text`, `thought`) nunca classifica nada; só o
 * `end` e o `error`, que o próprio runtime grava, entram no resultado.
 */
import * as fs from 'node:fs';
import { redigirSegredos } from '../hitl';
import { SinalDeFalhaDeConta } from '../types';
import { parseFalhaDeConta } from './claude-bg';
import { TokensCodex } from './codex-events';

/** O `stopReason` do fim normal do turno. */
export const STOP_FIM_NORMAL = 'end_turn';
/** O `stopReason` do turno cancelado: interrupção, como a saída 130 e a 143. */
export const STOP_CANCELADO = 'cancelled';
/** Linha maior que isto não é evento: invalida o stream sem reter a memória. */
export const LIMITE_LINHA_GROK = 1024 * 1024;
/** Teto da mensagem de erro do runtime que vai ao ledger. */
export const LIMITE_ERRO_GROK = 300;

export interface FimGrok {
  /** `stopReason` do `end`; fora do formato, `desconhecido`. */
  stopReason: string;
  sessionId: string | null;
  requestId: string | null;
  numTurnos: number | null;
  tokens: TokensCodex;
  /** Só quando o runtime informa o custo inteiro (`total_cost_usd`); ausente nunca é zero. */
  custoUsd: number | null;
}

/** O último `error` do stream, com a mensagem já redigida e limitada. */
export interface ErroGrok { mensagem: string }

export interface EstadoParserGrok {
  /** O id da sessão despachada: o `end` com outro id não é desta sessão. */
  sessaoEsperada: string;
  fim: FimGrok | null;
  erro: ErroGrok | null;
  /** Linha que não é evento (JSON inválido, sem `type`, longa demais) ou evento depois do `end`. */
  invalido: boolean;
  /** O `end` veio sem o id ou com o id de outra sessão. */
  sessaoDivergente: boolean;
  /** Eventos válidos lidos desde o início do stream. */
  eventos: number;
}

const STOP = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/**
 * D7: um texto do runtime pronto para o ledger, sem corte: os segredos que o núcleo já conhece, a chave da xAI
 * (`xai-...`) e sem controle. GO-FIX 1 (A4): quem corta, corta depois de redigir, para nenhum segredo perder o prefixo.
 */
export function redigirTextoGrok(texto: unknown): string {
  if (typeof texto !== 'string') return '';
  return redigirSegredos(texto)
    .replace(/\bxai-[A-Za-z0-9_-]{16,}/g, '[redigido]')
    .replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** D7: a mensagem de erro do runtime, redigida e até `LIMITE_ERRO_GROK` caracteres, sem partir par substituto. */
export function redigirErroGrok(texto: unknown): string {
  return Array.from(redigirTextoGrok(texto)).slice(0, LIMITE_ERRO_GROK).join('');
}

const tokensIndisponiveis = (): TokensCodex => ({ disponivel: false, input: null, cachedInput: null, output: null,
  total: null, unidade: 'tokens', escopo: 'sessao', fonte: 'unavailable' });

/** O `usage` do `end`, só com inteiros não negativos e total que cobre entrada e saída; fora disso, indisponível. */
export function tokensDoFim(v: unknown): TokensCodex {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return tokensIndisponiveis();
  const u = v as Record<string, unknown>;
  const inteiro = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  const input = u.input_tokens, output = u.output_tokens, cache = u.cache_read_input_tokens;
  if (!inteiro(input) || !inteiro(output) || (cache !== undefined && !inteiro(cache))) return tokensIndisponiveis();
  const total = u.total_tokens === undefined ? input + output : u.total_tokens;
  if (!inteiro(total) || total < input + output) return tokensIndisponiveis();
  return { disponivel: true, input, cachedInput: cache === undefined ? null : cache, output, total, unidade: 'tokens',
    escopo: 'sessao', fonte: 'grok.end.usage' };
}

export class ParserGrok {
  private pendente = Buffer.alloc(0);
  private descartando = false;
  readonly estado: EstadoParserGrok;
  /** Eventos válidos lidos por esta instância: o progresso de uma leitura. */
  eventosValidos = 0;
  constructor(sessaoEsperada: string, estado?: EstadoParserGrok) {
    if (estado && estado.sessaoEsperada !== sessaoEsperada) throw new Error('estado do parser do grok de outra sessão');
    this.estado = estado ? structuredClone(estado)
      : { sessaoEsperada, fim: null, erro: null, invalido: false, sessaoDivergente: false, eventos: 0 };
  }

  /** Lê as linhas completas do bloco; o resto fica pendente para o próximo. */
  push(chunk: Buffer | string): void {
    const dados = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    let inicio = 0;
    for (let i = 0; i < dados.length; i++) {
      if (dados[i] !== 10) continue;
      const linha = Buffer.concat([this.pendente, dados.subarray(inicio, i)]);
      if (!this.descartando && linha.length <= LIMITE_LINHA_GROK) {
        if (linha.length) {
          try { this.evento(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(linha))); }
          catch { this.estado.invalido = true; }
        }
      } else this.estado.invalido = true;
      this.pendente = Buffer.alloc(0); this.descartando = false; inicio = i + 1;
    }
    const resto = dados.subarray(inicio);
    if (this.pendente.length + resto.length > LIMITE_LINHA_GROK) {
      this.descartando = true; this.estado.invalido = true; this.pendente = Buffer.alloc(0);
    } else if (!this.descartando) this.pendente = Buffer.concat([this.pendente, resto]);
  }

  private evento(bruto: unknown): void {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) { this.estado.invalido = true; return; }
    const e = bruto as Record<string, unknown>;
    if (typeof e.type !== 'string' || e.type === '') { this.estado.invalido = true; return; }
    // O guia diz que o `end` é sempre o último: outro `end` ou um `error` depois dele é contrato quebrado.
    if (this.estado.fim && (e.type === 'end' || e.type === 'error')) { this.estado.invalido = true; return; }
    this.eventosValidos++; this.estado.eventos++;
    if (e.type === 'error') {
      this.estado.erro = { mensagem: redigirErroGrok(e.message) || 'erro do grok sem mensagem' };
      return;
    }
    if (e.type !== 'end') return;
    const sessionId = typeof e.sessionId === 'string' && ID.test(e.sessionId) ? e.sessionId : null;
    if (sessionId !== this.estado.sessaoEsperada) this.estado.sessaoDivergente = true;
    this.estado.fim = {
      stopReason: typeof e.stopReason === 'string' && STOP.test(e.stopReason) ? e.stopReason : 'desconhecido',
      sessionId,
      requestId: typeof e.requestId === 'string' && ID.test(e.requestId) ? e.requestId : null,
      numTurnos: Number.isSafeInteger(e.num_turns) && (e.num_turns as number) >= 0 ? e.num_turns as number : null,
      tokens: tokensDoFim(e.usage),
      custoUsd: typeof e.total_cost_usd === 'number' && Number.isFinite(e.total_cost_usd) && e.total_cost_usd >= 0
        ? e.total_cost_usd : null,
    };
  }
}

/**
 * D7: a falha da CONTA dita pelo próprio runtime no objeto `error` do stream (login, cota, modelo), pelo critério
 * único da D16 (`parseFalhaDeConta`). O formato do erro de cota do `grok` não é documentado: o que a frase não diz
 * fica `null`, e a parada segue tipada como `runtime.unavailable`.
 */
export function falhaDoErroGrok(erro: ErroGrok | null, agoraMs = Date.now()): SinalDeFalhaDeConta | null {
  return erro ? parseFalhaDeConta(erro.mensagem, agoraMs) : null;
}

/**
 * O stream inteiro de um despacho curto (a falha antes da sessão), lido sem seguir link e até `limiteBytes`; `null`
 * quando o arquivo não existe, não é arquivo comum ou passa do limite.
 */
export function lerStreamGrok(arquivo: string, sessaoEsperada: string, limiteBytes = 8 * 1024 * 1024): EstadoParserGrok | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > limiteBytes) return null;
    const bytes = Buffer.alloc(st.size);
    fs.readSync(fd, bytes, 0, st.size, 0);
    const parser = new ParserGrok(sessaoEsperada);
    // A última linha sem quebra também é evento: o processo terminou e não vai completá-la.
    parser.push(bytes.length && bytes[bytes.length - 1] !== 10 ? Buffer.concat([bytes, Buffer.from('\n')]) : bytes);
    return parser.estado;
  } finally { fs.closeSync(fd); }
}

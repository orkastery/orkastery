/** D4/D5: stream e rollout são observações de turno, nunca aprovação de CHECK. */
import { DESCRICAO_DO_MOTIVO } from '../gates';
import { MotivoGate, SinalDeFalhaDeConta } from '../types';
import { parseFalhaDeConta } from './claude-bg';

export interface ClassificacaoCodex {
  classificacao: 'fase_concluida' | 'human.pending' | 'gate_blocked';
  motivo: MotivoGate | null;
}
export interface TokensCodex {
  disponivel: boolean; input: number | null; cachedInput: number | null;
  output: number | null; total: number | null; unidade: 'tokens';
  escopo: 'turno' | 'sessao'; fonte: string;
}
/** Proveniencia estrutural do id de turno. Nunca inferida do texto nem de prefixo. */
export type OrigemTurnId = 'explicito' | 'gerado';
export interface TerminalCodex extends ClassificacaoCodex {
  turnId: string | null; timestamp: string; fonte: string;
  /** Sempre presente nos terminais do parser; opcional so para terminais tipados por consumidores. */
  turnIdOrigem?: OrigemTurnId | null;
  tokens: TokensCodex; duracaoMs: number | null;
  numeroTurno?: number; timestampFonte?: 'evento' | 'observacao';
  /** I-33 (D12): falha da CONTA no erro estruturado do proprio runtime, nunca no texto do agente. */
  falhaDeConta?: SinalDeFalhaDeConta;
}
export interface EstadoParserCodex {
  turnId: string | null; turnIdOrigem?: OrigemTurnId | null; mensagem: ClassificacaoCodex | null;
  tokens: TokensCodex; invalido: boolean; turnos: number;
  turnoAberto?: boolean;
  turnoIniciadoEm?: string | null;
}
const indisponivel = (): TokensCodex => ({ disponivel: false, input: null, cachedInput: null,
  output: null, total: null, unidade: 'tokens', escopo: 'turno', fonte: 'unavailable' });
const falha = (): ClassificacaoCodex => ({ classificacao: 'gate_blocked', motivo: 'runtime.unavailable' });
const sucesso = (): ClassificacaoCodex => ({ classificacao: 'fase_concluida', motivo: null });
const humano = (): ClassificacaoCodex => ({ classificacao: 'human.pending', motivo: 'human.pending' });
/** I-33 (D12): motivos da conta so saem de erro estruturado do runtime (`falhaDeContaDoErroCodex`). */
const MOTIVOS_DA_CONTA: readonly string[] = ['runtime.quota-exhausted', 'runtime.auth-missing'];
function motivo(v: unknown): ClassificacaoCodex | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !Object.hasOwn(DESCRICAO_DO_MOTIVO, v)) return falha();
  // Texto do agente declarando cota ou login nao e evidencia da conta: vira falha comum.
  if (MOTIVOS_DA_CONTA.includes(v)) return falha();
  return v === 'human.pending' ? humano() : { classificacao: 'gate_blocked', motivo: v as MotivoGate };
}

const LIMITE_ERRO_CODEX = 300;

/**
 * I-33 (D12): falha da conta no erro ESTRUTURADO do turno codex. O rollout grava
 * `task_complete.error` com `codex_error_info` em snake_case (`usage_limit_exceeded`, a linha real
 * do incidente de 18/09); o app-server manda `turn.error.codexErrorInfo` em camelCase
 * (`usageLimitExceeded`, `unauthorized`). As duas formas viram o mesmo codigo; `unauthorized` e
 * login perdido, o resto passa pelos padroes da D1 junto com a mensagem do runtime.
 */
export function falhaDeContaDoErroCodex(erro: unknown, agoraMs = Date.now()): SinalDeFalhaDeConta | null {
  if (!erro || typeof erro !== 'object' || Array.isArray(erro)) return null;
  const e = erro as Record<string, unknown>;
  const info = e.codex_error_info ?? e.codexErrorInfo ?? e.codigo;
  const bruto = typeof info === 'string' ? info
    : info && typeof info === 'object' && !Array.isArray(info) ? Object.keys(info)[0] ?? '' : '';
  const codigo = bruto.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64);
  const mensagem = typeof (e.message ?? e.mensagem) === 'string'
    ? String(e.message ?? e.mensagem).replace(/\p{Cc}/gu, ' ').trim().slice(0, LIMITE_ERRO_CODEX) : '';
  const trecho = [codigo, mensagem].filter(Boolean).join(': ').slice(0, 200);
  if (codigo === 'unauthorized') return { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho };
  const sinal = parseFalhaDeConta(trecho, agoraMs);
  return sinal ? { ...sinal, trecho } : null;
}

export function classificarMensagem(texto: unknown): ClassificacaoCodex {
  if (typeof texto !== 'string') return sucesso();
  // Trechos citados e exemplos de comandos não descrevem o estado deste turno.
  const linhas = texto.replace(/```[\s\S]*?```/g, '').split('\n')
    .filter(l => !/^\s*(?:>|["“])/.test(l));
  const final = linhas.join('\n').trim().split(/\n\s*\n/).at(-1) ?? '';
  const estado = /(?:^|\n)\s*(?:motivo|gate_blocked|bloquead[oa](?:\s+por)?|blocked(?:\s+by)?)\s*[:=]?\s*`?([a-z]+[._][a-z_.-]+)`?/i.exec(final);
  if (estado) return motivo(estado[1]) ?? falha();
  const pergunta = final.replace(/`[^`]*`/g, '').trim();
  if (/(?:preciso|aguardo|aguardando|waiting for|need)\s+(?:da?\s+)?(?:sua|your|confirmação|resposta|autorização|approval|confirmation)/i.test(pergunta)) return humano();
  if (/\?\s*$/.test(pergunta) &&
      /(?:\b(?:você|voce|you|confirma|confirme|deseja|prefere|autoriza|posso|can you|could you|should I)\b|(?:qual|which|what)\s+(?:é\s+o\s+|is\s+the\s+)?(?:diretório|diretorio|caminho|arquivo|opção|opcao|directory|path|file|option))/i.test(pergunta)) return humano();
  return sucesso();
}

function tokens(v: unknown, fonte: string, escopo: TokensCodex['escopo']): TokensCodex {
  if (!v || typeof v !== 'object') return indisponivel();
  const p = v as Record<string, unknown>;
  const input = p.input_tokens ?? p.total_input_tokens;
  const cached = p.cached_input_tokens ?? p.cache_read_input_tokens;
  const output = p.output_tokens ?? p.total_output_tokens;
  if (![input, output].every(n => Number.isSafeInteger(n) && Number(n) >= 0) ||
      (cached !== undefined && (!Number.isSafeInteger(cached) || Number(cached) < 0 || Number(cached) > Number(input)))) return indisponivel();
  const total = p.total_tokens ?? Number(input) + Number(output);
  if (!Number.isSafeInteger(total) || Number(total) < Number(input) + Number(output)) return indisponivel();
  return { disponivel: true, input: Number(input), cachedInput: cached === undefined ? null : Number(cached),
    output: Number(output), total: Number(total), unidade: 'tokens', escopo, fonte };
}

export const LIMITE_LINHA_CODEX = 1024 * 1024;
export class ParserCodex {
  private pendente = Buffer.alloc(0);
  private descartando = false;
  readonly estado: EstadoParserCodex;
  eventosValidos = 0;
  constructor(estado?: EstadoParserCodex) {
    this.estado = estado ? structuredClone(estado) : { turnId: null, turnIdOrigem: null, mensagem: null,
      tokens: indisponivel(), invalido: false, turnos: 0 };
    // Cursor antigo sem o campo nao vira proveniencia explicita por omissao.
    this.estado.turnIdOrigem = this.estado.turnIdOrigem ?? null;
  }
  get bytesPendentes(): number { return this.pendente.length; }
  push(chunk: Buffer | string, agoraMs = Date.now()): TerminalCodex[] {
    const dados = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    const saida: TerminalCodex[] = [];
    let inicio = 0;
    for (let i = 0; i < dados.length; i++) {
      if (dados[i] !== 10) continue;
      const linha = Buffer.concat([this.pendente, dados.subarray(inicio, i)]);
      if (!this.descartando && linha.length <= LIMITE_LINHA_CODEX) {
        try {
          if (linha.length) {
            const e: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(linha));
            const terminal = this.evento(e, agoraMs);
            if (terminal) saida.push(terminal);
          }
        } catch { this.estado.invalido = true; }
      } else this.estado.invalido = true;
      this.pendente = Buffer.alloc(0); this.descartando = false; inicio = i + 1;
    }
    const resto = dados.subarray(inicio);
    if (this.pendente.length + resto.length > LIMITE_LINHA_CODEX) {
      this.descartando = true; this.estado.invalido = true; this.pendente = Buffer.alloc(0);
    } else if (!this.descartando) this.pendente = Buffer.concat([this.pendente, resto]);
    return saida;
  }
  private evento(bruto: unknown, agoraMs: number): TerminalCodex | null {
    if (!bruto || typeof bruto !== 'object') return null;
    const e = bruto as Record<string, any>; // fronteira JSON validada campo a campo abaixo
    const p = e.type === 'event_msg' ? e.payload : e;
    if (!p || typeof p !== 'object' || typeof p.type !== 'string') return null;
    if (e.timestamp !== undefined && (typeof e.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(e.timestamp)) || Date.parse(e.timestamp) > agoraMs)) {
      this.estado.invalido = true; return null;
    }
    if (p.type === 'turn.started' || p.type === 'task_started') {
      this.estado.turnos++;
      this.estado.turnoAberto = true;
      this.estado.turnoIniciadoEm = e.timestamp ?? null;
      // A origem vem da presenca do campo na fonte, jamais do formato do valor.
      const daFonte = typeof p.turn_id === 'string' && p.turn_id ? p.turn_id : null;
      this.estado.turnId = daFonte ?? `stream-${this.estado.turnos}`;
      this.estado.turnIdOrigem = daFonte === null ? 'gerado' : 'explicito';
      this.estado.mensagem = null; this.estado.tokens = indisponivel();
      this.eventosValidos++; return null;
    }
    const turnId = e.type === 'token_usage_record' ? e.payload?.turn_id : p.turn_id;
    if (typeof turnId === 'string' && this.estado.turnId && turnId !== this.estado.turnId) return null;
    if (p.type === 'token_count') {
      this.estado.tokens = tokens(p.info?.total_token_usage, 'rollout.token_count', 'sessao');
      this.eventosValidos++; return null;
    }
    if (e.type === 'token_usage_record') {
      this.estado.tokens = tokens(e.payload?.turn_token_usage ?? e.payload?.usage, 'rollout.token_usage_record', 'turno');
      this.eventosValidos++; return null;
    }
    const resposta = e.type === 'response_item' && e.payload?.type === 'message' && e.payload?.role === 'assistant'
      && Array.isArray(e.payload.content) ? e.payload.content.filter((c: Record<string, unknown>) =>
        c.type === 'output_text' && typeof c.text === 'string').map((c: { text: string }) => c.text).join('\n') : undefined;
    const mensagem = resposta ?? (p.type === 'item.completed' && p.item?.type === 'agent_message' ? p.item.text :
      p.type === 'agent_message' ? p.message : undefined);
    if (mensagem !== undefined) {
      this.estado.mensagem = classificarMensagem(mensagem); this.eventosValidos++; return null;
    }
    if (!['turn.completed', 'turn.failed', 'task_complete', 'task_failed'].includes(p.type)) return null;
    this.eventosValidos++;
    this.estado.turnoAberto = false;
    // I-33 (D12): turno com `error` estruturado nunca e conclusao, mesmo sem mensagem final.
    const comErro = p.error !== undefined && p.error !== null;
    const falhou = p.type === 'turn.failed' || p.type === 'task_failed' || comErro;
    const conta = comErro ? falhaDeContaDoErroCodex(p.error, agoraMs) : null;
    const explicito = motivo(p.motivo ?? p.reason);
    const mensagemFinal = typeof p.last_agent_message === 'string' && p.last_agent_message.trim()
      ? classificarMensagem(p.last_agent_message) : this.estado.mensagem ?? sucesso();
    const classificacao: ClassificacaoCodex = this.estado.invalido ? falha()
      : conta ? { classificacao: 'gate_blocked', motivo: conta.motivo } : explicito ??
      (mensagemFinal.classificacao !== 'fase_concluida' ? mensagemFinal : falhou ? falha() : sucesso());
    if (p.usage !== undefined) this.estado.tokens = tokens(p.usage, 'stream.turn.completed', 'turno');
    return { ...classificacao, ...(conta && !this.estado.invalido ? { falhaDeConta: conta } : {}), turnId: this.estado.turnId,
      turnIdOrigem: this.estado.turnId === null ? null : this.estado.turnIdOrigem ?? null, timestamp: e.timestamp ?? new Date(agoraMs).toISOString(),
      numeroTurno: this.estado.turnos, timestampFonte: e.timestamp ? 'evento' : 'observacao',
      fonte: e.type === 'event_msg' ? `rollout.${p.type}` : `stream.${p.type}`,
      tokens: structuredClone(this.estado.tokens),
      duracaoMs: Number.isFinite(p.duration_ms) && p.duration_ms >= 0 ? p.duration_ms : null };
  }
}

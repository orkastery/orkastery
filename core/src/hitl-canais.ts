/**
 * D12: domicilio unico dos canais HITL homologados.
 *
 * Um CANAL nao e um transporte. `telegram` e `mcp-local` sao dois transportes, e cada um
 * serve dois hosts; o canal e o par host + ingresso, porque e ele que o humano escolhe e e
 * ele que precisa aparecer no recibo. Antes deste registro, uma decisao que entrava pelo
 * Telegram gravava `origem: 'telegram'` e nada mais: depois, ninguem sabia se ela tinha
 * vindo do Hermes ou do OpenClaw. O `mcp-local` ja distinguia (`mcp-local:claude-code` e
 * `mcp-local:codex`); metade dos canais homologados era anonima no proprio recibo.
 *
 * Tres regras estruturais moram aqui, e so aqui:
 *
 *  1. **Sao quatro canais, e a lista e fechada.** Reduzir a lista e mudanca de contrato, nao
 *     configuracao: `CANAIS` cobre `Host` inteiro, entao um host novo sem canal nao compila,
 *     e um canal removido reprova em `conferirRegistro`.
 *  2. **Canal sem os tres atributos nao entra.** Identidade, correlacao e recibo sao o que
 *     torna dois canais equivalentes. Um canal que so tenha dois deles nao e um canal mais
 *     fraco: e um canal que nao pode responder, e `conferirRegistro` diz isso com nome.
 *  3. **Transcrito nativo entra por adaptador, nunca como texto de tool.** O conteudo que o
 *     humano escreveu chega assinado pelo evento nativo do host (Telegram) ou pelo
 *     `elicitInput` da propria conexao MCP. Texto que um agente cole num argumento de
 *     ferramenta e autoaprovacao com outro nome, e `recusarIngressoNaoHomologado` recusa.
 */

import { createHash } from 'node:crypto';
import { Host, ORDEM_DOS_HOSTS, parseHost } from './hosts';
import { nativeBinding, nativeKey } from './hitl-native';
import type { EventoLedger } from './types';

export function selecaoDeCanal(eventos: EventoLedger[], pedidoId: string): EventoLedger | undefined {
  const last = eventos.filter(e => ['hitl_channel_selected', 'hitl_channel_released'].includes(e.tipo) && e.pedidoId === pedidoId).at(-1);
  return last?.tipo === 'hitl_channel_selected' ? last : undefined;
}
/**
 * Leitura para a oferta native: o que impede um ingresso native novo deste pedido agora.
 * Ingresso native nunca seleciona canal, então toda seleção vigente é reserva de outro canal
 * (MCP), e `conferirCanalSelecionado` recusaria a resposta. Não reserva, não libera e não
 * prova abandono: devolve motivo curto ou vazio.
 */
export function reservaDoPedido(eventos: EventoLedger[], pedidoId: string): string {
  if (eventos.some(e => ['human_gate', 'session_answered'].includes(e.tipo) && e.pedidoId === pedidoId)) return 'hitl.channel.answered';
  if (eventos.some(e => e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId)) return 'hitl.channel.delivery-uncertain';
  return selecaoDeCanal(eventos, pedidoId) ? 'hitl.channel.in-use' : '';
}
/** Consulta de oferta não autoriza efeito. A seleção vigente amarra o ingresso real. */
export function conferirCanalSelecionado(eventos: EventoLedger[], pedidoId: string, canal: string | undefined,
  transporte: Transporte, connectionId?: string, requestId?: string): void {
  if (!eventos.some(e => e.tipo === 'hitl_channel_selected' && e.pedidoId === pedidoId)) return; // legado
  const s = selecaoDeCanal(eventos, pedidoId);
  // Release devolve o pedido ao ingresso autenticado. Um callback MCP antigo
  // ainda exige sua seleção exata; envio incerto nunca permite trocar de canal.
  if (!s && transporte !== 'mcp-local' && !eventos.some(e =>
      e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId)) return;
  if (!s || s.canal !== canal || s.transporte !== transporte || s.connectionId !== connectionId || s.requestId !== requestId)
    throw Error('hitl.channel.selection-mismatch');
}

export const CONTRATO_CANAIS = 'ork.hitl-canais/v1' as const;

/** Um canal homologado e exatamente um host homologado. Os dois conjuntos nao divergem. */
export type Canal = Host;

/** O meio fisico. Dois canais podem compartilhar transporte sem deixar de ser dois canais. */
export type Transporte = 'telegram' | 'mcp-local' | 'native';

/** O adaptador que entrega conteudo humano ao nucleo. A lista e fechada de proposito. */
export type Ingresso = 'evento-nativo-openclaw' | 'evento-nativo-hermes' | 'elicitation-mcp';

/**
 * FX1: a chave de ingresso e do CANAL, nao do transporte.
 *
 * Hermes e OpenClaw compartilhavam `ORK_HITL_INGRESS_KEY`. Poe-los no mesmo segredo e o
 * mesmo defeito que D12 conserta no recibo, so que em criptografia: quem vaza a chave de um
 * host assina envelopes do outro, e nenhuma conferencia posterior percebe, porque a
 * assinatura confere. Cada canal de telegram passa a ter a sua variavel, e a global fica
 * EXCLUSIVAMENTE para o envelope v1, que nao declara canal e nao pode ganhar um por
 * inferencia. Um v1 continua valendo byte a byte; o risco legado dele esta documentado.
 */
export const VARIAVEL_DA_CHAVE_V1 = 'ORK_HITL_INGRESS_KEY' as const;

/** `null` no canal MCP local: ali a prova vem da conexao, nunca de chave de ambiente. */
export const VARIAVEL_DA_CHAVE: Readonly<Record<Canal, string | null>> = {
  openclaw: 'ORK_HITL_INGRESS_KEY_OPENCLAW',
  hermes: 'ORK_HITL_INGRESS_KEY_HERMES',
  'claude-code': null,
  codex: null,
};

/**
 * FX5: a CONTA homologada do canal, quando ele tem uma.
 *
 * O OpenClaw ja conferia `accountId` contra `ORK_HITL_OPENCLAW_ACCOUNT`, mas so no
 * adaptador, de forma transiente: nada disso entrava no corpo assinado nem no recibo
 * duravel, entao o recibo provava transporte telegram generico, nunca a conta autorizada.
 * Quem lesse o recibo depois nao tinha como reconferir de qual conta a decisao entrou.
 * Hermes nao tem conta propria (a allowlist dele e de usuario e chat), e por isso declara
 * `null`: um envelope que traga conta num canal sem conta e recusado, e nao ignorado.
 */
export const VARIAVEL_DA_CONTA: Readonly<Record<Canal, string | null>> = {
  openclaw: 'ORK_HITL_OPENCLAW_ACCOUNT',
  hermes: null,
  'claude-code': null,
  codex: null,
};

/** Nome da variavel que autentica este canal. `null` (v1 legado) usa a chave global. */
export function variavelDaChaveDoCanal(canal: Canal | null): string {
  if (canal === null) return VARIAVEL_DA_CHAVE_V1;
  const nome = VARIAVEL_DA_CHAVE[canal];
  if (!nome) throw new Error(`hitl.canal.sem-chave-de-ingresso: ${canal} autentica pela conexao`);
  return nome;
}

export interface DefinicaoDeCanal {
  canal: Canal;
  transporte: Transporte;
  ingresso: Ingresso;
  /** Onde o ingresso mora no produto, relativo a raiz. E o que o CHECK vai ler. */
  adaptador: string;
  /** Como a pessoa fica identificada no recibo. Prefixo real de `autorizadoPor`. */
  identidade: string;
  /** O que amarra a resposta a UM pedido, e so a ele. */
  correlacao: string;
  /** O que fica gravado como prova. Nunca o corpo da resposta. */
  recibo: string;
  /** Variaveis de ambiente sem as quais o canal nao aceita resposta. */
  exigencias: readonly string[];
}

/**
 * Os quatro canais. `Record<Canal, ...>` e o que impede a lista de encolher em silencio:
 * apagar uma entrada aqui e erro de tipo, nao um canal a menos descoberto em producao.
 */
export const CANAIS: Readonly<Record<Canal, DefinicaoDeCanal>> = {
  openclaw: {
    canal: 'openclaw',
    transporte: 'telegram',
    ingresso: 'evento-nativo-openclaw',
    adaptador: 'adapters/openclaw/src/hitl-ingress.ts',
    identidade: 'telegram:<userId> da allowlist, com canal=openclaw e conta autorizada assinados no corpo do envelope',
    correlacao: 'pedidoId e mensagem telegram:<chatId>:<messageId>, ambos dentro do HMAC',
    recibo: 'ingresso duravel em .orkastery/threads/<t>/hitl-ingress/<sha>.json, com conta e canal dentro do MAC e sha256 no ledger',
    exigencias: ['ORK_HITL_ROOT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_INGRESS_KEY_OPENCLAW',
      'ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'],
  },
  hermes: {
    canal: 'hermes',
    transporte: 'telegram',
    ingresso: 'evento-nativo-hermes',
    adaptador: 'adapters/hermes/hitl-ingress/__init__.py',
    identidade: 'telegram:<userId> da allowlist, com canal=hermes assinado no corpo do envelope',
    correlacao: 'pedidoId e mensagem telegram:<chatId>:<messageId>, ambos dentro do HMAC',
    recibo: 'ingresso duravel em .orkastery/threads/<t>/hitl-ingress/<sha>.json, com MAC proprio e sha256 no ledger',
    exigencias: ['ORK_HITL_ROOT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_INGRESS_KEY_HERMES',
      'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'],
  },
  'claude-code': {
    canal: 'claude-code',
    transporte: 'mcp-local',
    ingresso: 'elicitation-mcp',
    adaptador: 'core/src/mcp-server.ts',
    identidade: 'mcp-local:claude-code, com o connectionId da conexao que elicitou',
    correlacao: 'requestId da elicitation, contexto da thread e pedidoSha256 conferidos sob lock',
    recibo: 'evidencia local em .orkastery/threads/<t>/hitl-ingress-local/<sha>.json, com sha256 no ledger',
    exigencias: [],
  },
  codex: {
    canal: 'codex',
    transporte: 'mcp-local',
    ingresso: 'elicitation-mcp',
    adaptador: 'core/src/mcp-server.ts',
    identidade: 'mcp-local:codex, com o connectionId da conexao que elicitou',
    correlacao: 'requestId da elicitation, contexto da thread e pedidoSha256 conferidos sob lock',
    recibo: 'evidencia local em .orkastery/threads/<t>/hitl-ingress-local/<sha>.json, com sha256 no ledger',
    exigencias: [],
  },
};

/** A ordem de apresentacao e a mesma dos hosts: o humano ve sempre a mesma fila. */
export const ORDEM_DOS_CANAIS: readonly Canal[] = ORDEM_DOS_HOSTS;

export function canaisHomologados(): readonly DefinicaoDeCanal[] {
  return ORDEM_DOS_CANAIS.map((c) => CANAIS[c]);
}

/** Reconhece o canal com os mesmos apelidos que o builder ja digita para o host. */
export function parseCanal(bruto: string | undefined | null): Canal | null {
  return parseHost(bruto);
}

export function definicaoDoCanal(bruto: string | undefined | null): DefinicaoDeCanal {
  const canal = parseCanal(bruto);
  if (!canal) throw new Error('hitl.canal.desconhecido');
  return CANAIS[canal];
}

/** Os canais de um transporte. Preserva a ordem canonica. */
export function canaisDoTransporte(transporte: Transporte): readonly Canal[] {
  return ORDEM_DOS_CANAIS.filter((c) => CANAIS[c].transporte === transporte);
}

export function transporteDoCanal(bruto: string | undefined | null): Transporte {
  return definicaoDoCanal(bruto).transporte;
}

/**
 * Os tres atributos que tornam dois canais equivalentes. Vazio em qualquer um deles nao e
 * um canal pior: e um canal que nao responde, e `conferirRegistro` o nomeia.
 */
export function equivalenciaDoCanal(bruto: string | undefined | null): {
  identidade: string; correlacao: string; recibo: string;
} {
  const d = definicaoDoCanal(bruto);
  return { identidade: d.identidade, correlacao: d.correlacao, recibo: d.recibo };
}

/**
 * Recusa qualquer ingresso que nao seja um dos adaptadores homologados. O nome do erro e
 * proposital: quem le o ledger precisa distinguir "canal errado" de "texto de agente".
 */
export function recusarIngressoNaoHomologado(ingresso: unknown): Ingresso {
  const homologados = new Set<string>(canaisHomologados().map((c) => c.ingresso));
  if (typeof ingresso !== 'string' || !homologados.has(ingresso)) {
    throw new Error('hitl.canal.transcrito-de-tool: ingresso nao homologado nao entrega resposta humana');
  }
  return ingresso as Ingresso;
}

/** Invariantes do registro. O teste chama isto; o produto tambem, no canario. */
export function conferirRegistro(): { contrato: typeof CONTRATO_CANAIS; canais: number; transportes: number; chaves: number } {
  const canais = canaisHomologados();
  if (canais.length !== ORDEM_DOS_HOSTS.length || canais.length !== 4) {
    throw new Error('hitl.canal.registro-incompleto: os quatro canais homologados sao obrigatorios');
  }
  const vistos = new Set<string>(), chaves = new Set<string>();
  for (const d of canais) {
    if (d.canal !== ORDEM_DOS_CANAIS[canais.indexOf(d)]) throw new Error('hitl.canal.ordem-divergente');
    for (const [nome, valor] of Object.entries(equivalenciaDoCanal(d.canal))) {
      if (!valor.trim()) throw new Error(`hitl.canal.sem-${nome}: ${d.canal}`);
    }
    if (!d.adaptador.trim()) throw new Error(`hitl.canal.sem-adaptador: ${d.canal}`);
    recusarIngressoNaoHomologado(d.ingresso);
    // Identidade repetida entre canais e o defeito que D12 conserta: dois canais
    // indistinguiveis no recibo sao, na pratica, um canal so com dois nomes.
    if (vistos.has(d.identidade)) throw new Error(`hitl.canal.identidade-ambigua: ${d.canal}`);
    vistos.add(d.identidade);
    // FX1: chave compartilhada e identidade ambigua em criptografia. Dois canais que
    // assinam com o mesmo segredo podem assinar um pelo outro, e a conferencia aprova.
    const chave = VARIAVEL_DA_CHAVE[d.canal];
    if (chave !== null) {
      if (chave === VARIAVEL_DA_CHAVE_V1) throw new Error(`hitl.canal.chave-global: ${d.canal}`);
      if (chaves.has(chave)) throw new Error(`hitl.canal.chave-ambigua: ${d.canal}`);
      chaves.add(chave);
      if (!d.exigencias.includes(chave)) throw new Error(`hitl.canal.chave-fora-das-exigencias: ${d.canal}`);
    }
    const conta = VARIAVEL_DA_CONTA[d.canal];
    if (conta !== null && !d.exigencias.includes(conta)) throw new Error(`hitl.canal.conta-fora-das-exigencias: ${d.canal}`);
  }
  return { contrato: CONTRATO_CANAIS, canais: canais.length,
    transportes: new Set(canais.map((c) => c.transporte)).size, chaves: chaves.size };
}

export interface CanalOferecido {
  canal: Canal;
  transporte: Transporte;
  estado: 'disponivel' | 'indisponivel';
  /** Vazio quando disponivel; motivo tipado quando nao. */
  motivo: string;
}

export interface AmbienteDeCanais {
  /** Variaveis observadas. Nao le `process.env` aqui: oferta e funcao pura. */
  env?: Record<string, string | undefined>;
  /** Canais com conexao MCP viva neste instante, informados pelo servidor. */
  conexoesMcp?: readonly Canal[];
}

/** Oferta adicional; disponibilidade exige vínculo privado e callback homologado pelo host. */
export function ofertaNativa(canal: 'hermes' | 'openclaw', callbackProved: boolean,
  env: NodeJS.ProcessEnv = process.env): CanalOferecido {
  try {
    if (!callbackProved) throw Error('hitl.native.capability-unavailable');
    nativeBinding(canal, env); nativeKey(canal, env);
    return { canal, transporte: 'native', estado: 'disponivel', motivo: '' };
  } catch { return { canal, transporte: 'native', estado: 'indisponivel', motivo: 'hitl.native.capability-unavailable' }; }
}

/**
 * A oferta que o humano ve. Nao autoriza nada e nao abre pedido: diz, para um pedido ja
 * aberto, por quais canais da para responder e por que os outros nao servem agora. Sem
 * oferta nao existe escolha de canal, e sem escolha D12 seria so uma tabela bonita.
 */
export function ofertaDeCanais(ambiente: AmbienteDeCanais = {}): readonly CanalOferecido[] {
  const env = ambiente.env ?? {};
  const conexoes = new Set(ambiente.conexoesMcp ?? []);
  const chaveHermes = env.ORK_HITL_INGRESS_KEY_HERMES ?? '';
  const chaveOpenClaw = env.ORK_HITL_INGRESS_KEY_OPENCLAW ?? '';
  const chavesTelegramIguais = chaveHermes.length > 0 && chaveOpenClaw.length > 0 &&
    createHash('sha256').update(chaveHermes).digest('hex') ===
      createHash('sha256').update(chaveOpenClaw).digest('hex');
  return canaisHomologados().map((d) => {
    const faltando = d.exigencias.filter((nome) => !(env[nome] ?? '').trim());
    if (faltando.length) {
      return { canal: d.canal, transporte: d.transporte, estado: 'indisponivel' as const,
        motivo: `hitl.credencial: ausente ${faltando.join(', ')}` };
    }
    if (d.transporte === 'telegram') {
      const raiz = env.ORK_HITL_ROOT ?? '';
      const bot = env.ORK_HITL_TELEGRAM_BOT_ID ?? '';
      const usuarios = (env.ORK_HITL_TELEGRAM_USERS ?? '').split(',').map(v => v.trim()).filter(Boolean);
      const chats = (env.ORK_HITL_TELEGRAM_CHATS ?? '').split(',').map(v => v.trim()).filter(Boolean);
      const nomeChave = VARIAVEL_DA_CHAVE[d.canal];
      const chave = nomeChave ? env[nomeChave] ?? '' : '';
      const invalidas = [
        !pathAbsoluto(raiz) ? 'ORK_HITL_ROOT deve ser absoluto' : '',
        !/^\d+$/.test(bot) ? 'ORK_HITL_TELEGRAM_BOT_ID deve ser numerico' : '',
        usuarios.length === 0 || usuarios.some(v => !/^\d+$/.test(v))
          ? 'ORK_HITL_TELEGRAM_USERS deve ser allowlist numerica' : '',
        chats.length === 0 || chats.some(v => !/^-?\d+$/.test(v))
          ? 'ORK_HITL_TELEGRAM_CHATS deve ser allowlist numerica' : '',
        Buffer.byteLength(chave) < 32 ? `${nomeChave} deve ter ao menos 32 bytes` : '',
        chavesTelegramIguais ? 'chaves de Hermes e OpenClaw devem ser distintas' : '',
      ].filter(Boolean);
      if (invalidas.length) {
        return { canal: d.canal, transporte: d.transporte, estado: 'indisponivel' as const,
          motivo: `hitl.credencial: invalida (${invalidas.join('; ')})` };
      }
    }
    if (d.transporte === 'mcp-local' && !conexoes.has(d.canal)) {
      return { canal: d.canal, transporte: d.transporte, estado: 'indisponivel' as const,
        motivo: 'hitl.canal.sem-conexao: nenhuma sessao MCP deste host esta ligada a esta thread' };
    }
    return { canal: d.canal, transporte: d.transporte, estado: 'disponivel' as const, motivo: '' };
  });
}

/** Equivalente sintatico de `path.isAbsolute`, sem tocar no filesystem nem no cwd. */
function pathAbsoluto(valor: string): boolean {
  return valor.startsWith('/') || /^[A-Za-z]:[\\/]/.test(valor);
}

/**
 * Le o canal de um `human_gate` ja gravado. Recibo anterior a D12 nao ganha canal por
 * inferencia: `telegram` sem canal assinado poderia ser Hermes ou OpenClaw, e chutar qual
 * foi e pior do que admitir que o recibo daquela epoca nao guardava a informacao.
 */
export function canalDaResposta(evento: Record<string, unknown>): {
  canal: Canal | null; equivalencia: 'completa' | 'legado'; motivo: string;
} {
  const declarado = parseCanal(typeof evento.canal === 'string' ? evento.canal : null);
  if (declarado) return { canal: declarado, equivalencia: 'completa', motivo: '' };
  const origem = typeof evento.origem === 'string' ? evento.origem : '';
  if (origem === 'telegram') {
    return { canal: null, equivalencia: 'legado',
      motivo: 'recibo ork.hitl-answer/v1: transporte telegram sem canal assinado' };
  }
  const porMcp = /^mcp-local:(.+)$/.exec(String(evento.autorizadoPor ?? ''));
  const canal = porMcp ? parseCanal(porMcp[1]) : null;
  if (canal && CANAIS[canal].transporte === 'mcp-local') {
    return { canal, equivalencia: 'completa', motivo: '' };
  }
  return { canal: null, equivalencia: 'legado', motivo: 'recibo sem canal homologado' };
}

/**
 * RM-048 (item 8, D8): a nota do MASTER com prova de origem humana.
 *
 * Ate aqui toda nota gravava o nome que viesse em `--por`: a `ork_master` do OpenClaw repassava o
 * parametro `quem` do modelo, e `master ratificar`, `batch --aceitar` e `digest responder` idem.
 * `autoriaHumana` so recusa nome de agente; ela mesma diz que nao e autenticacao. O dono pediu que
 * a nota dada por ferramenta de host passe pela MESMA prova de canal que o gate ja exige.
 *
 * O caminho com prova e este, e ele nao cria autenticacao nova:
 *
 *   1. `ork master pedir <thread>` guarda um pedido de nota com codigo curto e devolve a linha
 *      "<codigo> <0 a 5> <porque>" para o canal mostrar ao dono;
 *   2. o dono responde no Telegram; o ingresso (Hermes ou OpenClaw) assina o texto dele no
 *      endereco do pulse, com a chave do proprio canal, e o nucleo confere com a mesma
 *      `autenticarResposta` de sempre, ANTES de ler o conteudo;
 *   3. a nota e gravada com `por` = o remetente autenticado (`telegram:<id>`) e com o recibo:
 *      canal, conta, mensagem, instante, o sha da prova e o envelope assinado guardado para a
 *      auditoria reconferir o HMAC depois.
 *
 * O teclado do digest semanal ("ratificar <thread> <assinatura> <classe>") passa pelo mesmo
 * endereco. E o processo de host (Claude Code, Codex, Hermes, OpenClaw, sessao despachada) que
 * tenta gravar nota com `--por` recebe `master.prova-de-canal`.
 *
 * LIMITE DITO: o canal do processo e declarado pelo ambiente (`canalDoProcesso`). Ele serve para
 * RECUSAR, nunca para autorizar, e um agente que apague as variaveis do proprio host de proposito
 * passa como terminal. Essa e a mesma fronteira do `humano-no-cli` do SHIP; fecha-la de vez exige o
 * dialogo nativo do host para a nota, que fica fora desta entrega.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { dirThread, lerThread } from './thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { exigirEntrega } from './thread-close';
import { canalDoProcesso } from './conducao';
import { gerarCodigo } from './pulse-consentimento';
import { comLockDaConversa } from './monitor-lock';
import type { RespostaHumana } from './hitl-gates';
import { CanalDeConducao } from './types';

export const CONTRATO_PEDIDO_DE_NOTA = 'ork.master-nota/v1' as const;
export const ERRO_PROVA_DE_CANAL = 'master.prova-de-canal';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * D8: nota em nome de pessoa, vinda de processo de host, e recusada. O canal e lido SO do
 * ambiente: `--canal` em argv nao conta, porque quem escreve argv e justamente quem chama.
 */
export function exigirNotaSemHost(ambiente: NodeJS.ProcessEnv = process.env): void {
  let canal: CanalDeConducao;
  try { canal = canalDoProcesso(undefined, ambiente); } catch { canal = 'mcp'; }
  // B2 do CHECK: `ORK_CANAL=cli` NAO absolve. A sessao despachada herda `ORK_CANAL=cli` quando a
  // thread e conduzida do terminal, e o Claude Code e o Codex marcam os proprios processos. Qualquer
  // marca de host ou de despacho recusa, mesmo com o canal declarado como terminal.
  const marca = canal !== 'cli' ? canal
    : ambiente.ORK_DISPATCH_ID ? 'sessão despachada (ORK_DISPATCH_ID)'
      : ambiente.CLAUDECODE === '1' ? 'claude-code (CLAUDECODE)'
        : ambiente.CODEX_SANDBOX || ambiente.CODEX_SANDBOX_NETWORK_DISABLED ? 'codex (CODEX_SANDBOX)'
          : (ambiente.HERMES_HOME ?? '').trim() ? 'hermes (HERMES_HOME)' : undefined;
  if (marca) {
    throw new Error(`${ERRO_PROVA_DE_CANAL}: nota em nome de pessoa vinda de ${marca} exige a prova de canal do ingresso. ` +
      'Peça a nota com ork master pedir <thread>: o dono responde pelo Telegram com o código, e a nota é gravada com o recibo.');
  }
}

export interface PedidoDeNota {
  contrato: typeof CONTRATO_PEDIDO_DE_NOTA;
  pedidoId: string;
  thread: string;
  codigo: string;
  criadoEm: string;
}

export function arquivoDasNotas(raiz: string, estadoDir?: string): string {
  return path.join(estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor'), 'master-notas.json');
}

function lerNotas(raiz: string, estadoDir?: string): Record<string, PedidoDeNota> {
  const arquivo = arquivoDasNotas(raiz, estadoDir);
  if (!fs.existsSync(arquivo)) return {};
  const v = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { contrato?: string; notas?: Record<string, PedidoDeNota> };
  if (v.contrato !== CONTRATO_PEDIDO_DE_NOTA || !v.notas || typeof v.notas !== 'object') throw new Error('pedidos de nota: estado inválido; exige inspeção');
  return v.notas;
}

function gravarNotas(raiz: string, notas: Record<string, PedidoDeNota>, estadoDir?: string): void {
  const arquivo = arquivoDasNotas(raiz, estadoDir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ contrato: CONTRATO_PEDIDO_DE_NOTA, notas }) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
}

/**
 * Pede a nota ao dono. Idempotente: a mesma entrega sem nota devolve o MESMO codigo, para a
 * linha que o dono recebeu nao vencer. So entrega provada recebe pedido de nota.
 */
export function pedirNota(raiz: string, thread: string, opcoes: { quando?: string; estadoDir?: string; codigosEmUso?: readonly string[] } = {}): PedidoDeNota {
  const quando = opcoes.quando ?? new Date().toISOString();
  exigirEntrega(raiz, thread);
  const estadoDir = opcoes.estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor');
  // A4 do CHECK: o registro dos pedidos de nota tem dois escritores (pedir e o receptor do pulse);
  // um de cada vez, pelo mesmo lock da conversa.
  return comLockDaConversa(estadoDir, () => {
    const notas = lerNotas(raiz, estadoDir);
    const existente = Object.values(notas).find(n => n.thread === thread);
    if (existente && !notaDada(raiz, existente)) return existente;
    // A1 do CHECK: o codigo da nota nao repete o de gate aberto nem o do resumo (quem chama passa).
    const codigo = gerarCodigo([...Object.keys(notas), ...(opcoes.codigosEmUso ?? [])]);
    const pedido: PedidoDeNota = { contrato: CONTRATO_PEDIDO_DE_NOTA, pedidoId: randomUUID(), thread, codigo, criadoEm: quando };
    registrar(dirThread(raiz, thread), thread, TIPOS_DE_EVENTO.notaPedida, { fase: 'MASTER', pedidoId: pedido.pedidoId, codigo });
    gravarNotas(raiz, { ...Object.fromEntries(Object.entries(notas).filter(([, n]) => n.thread !== thread)), [codigo]: pedido }, estadoDir);
    return pedido;
  });
}

/** A nota deste pedido ja foi dada pelo canal. */
function notaDada(raiz: string, p: PedidoDeNota): boolean {
  return lerLedger(dirThread(raiz, p.thread)).some(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido &&
    (e.notaPedida as { pedidoId?: string } | undefined)?.pedidoId === p.pedidoId);
}

/** O pedido de nota que usa este codigo, quando ha um. */
export function pedidoDeNotaDoCodigo(raiz: string, codigo: string, estadoDir?: string): PedidoDeNota | undefined {
  try { return lerNotas(raiz, estadoDir)[codigo.trim().toUpperCase()]; } catch { return undefined; }
}

/** A linha que o canal mostra ao dono. Uma linha de contexto e uma de resposta. */
export function textoDoPedidoDeNota(raiz: string, p: PedidoDeNota, canal: 'telegram' | 'terminal'): string {
  const t = lerThread(raiz, p.thread);
  const tg = canal === 'telegram';
  return [
    `${tg ? '🧾 ' : ''}Nota da entrega ${p.thread} (${t.nome.slice(0, 80)})`,
    `${tg ? '• ' : '- '}Sem nota, vale a aceita por omissão, com o índice derivado do ledger ao lado.`,
    `${tg ? '↩️ ' : ''}Responda: ${p.codigo} <0 a 5> <porquê>, por exemplo: ${p.codigo} 4 entregou o que pedi.`,
  ].join('\n');
}

/** "4 entregou o que pedi" vira nota e justificativa; o resto e devolvido como pergunta. */
export function lerNota(resto: string): { score: number; justificativa: string } | undefined {
  const m = /^\s*([0-5])(?:\s*\/\s*5)?\s*[-:,.]?\s+(\S[\s\S]{2,})$/.exec(resto);
  return m ? { score: Number(m[1]), justificativa: m[2].trim() } : undefined;
}

/**
 * O recibo que acompanha a nota no `master_done`. O envelope assinado inteiro fica guardado, para
 * que a auditoria reconfira o HMAC do canal depois (`autenticarResposta` no instante recebido). Um
 * arquivo por mensagem: a mesma mensagem nunca vira duas notas.
 */
export function reciboDoCanal(raiz: string, envelope: RespostaHumana, vinculo: Record<string, unknown>, estadoDir?: string): Record<string, unknown> {
  const dir = path.join(estadoDir ?? path.join(raizDoEstado(raiz), '.orkastery', 'monitor'), 'master-nota');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const arquivo = path.join(dir, `${sha(envelope.mensagem)}.json`);
  const corpo = JSON.stringify({ contrato: CONTRATO_PEDIDO_DE_NOTA, vinculo, envelope }) + '\n';
  if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, corpo, { mode: 0o600, flag: 'wx' });
  return {
    origem: envelope.origem, canal: envelope.canal ?? null, conta: envelope.conta ?? null, mensagem: envelope.mensagem,
    recebidoEm: envelope.recebidoEm, recibo: sha(envelope.prova), contratoResposta: envelope.canal === undefined ? 'ork.hitl-answer/v1' : 'ork.hitl-answer/v2',
    evidencia: path.relative(raizDoEstado(raiz), arquivo), evidenciaSha256: sha(fs.readFileSync(arquivo, 'utf8')), ...vinculo,
  };
}

/** Mensagem ja usada numa nota desta thread nao vale de novo, igual ao gate. */
export function mensagemJaUsadaEmNota(raiz: string, thread: string, mensagem: string): boolean {
  return lerLedger(dirThread(raiz, thread)).some(e => e.tipo === TIPOS_DE_EVENTO.masterConcluido && e.mensagem === mensagem);
}

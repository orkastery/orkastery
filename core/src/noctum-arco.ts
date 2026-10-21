/**
 * RM-058, fatia N1: o estado do arco #Noctum e o ingresso do envelope.
 *
 * O estado mora num log append-only em `.orkastery/noctum/arcos/<arco>/arco.jsonl`, na raiz do
 * estado. Cada linha leva o sha256 da anterior e um MAC de subchave derivada da chave local do
 * núcleo (`.orkastery/private`, a mesma fronteira do recibo local do HITL), e linha trocada reprova
 * toda leitura. Essa chave fica legível para qualquer processo com o mesmo usuário do sistema, que é
 * o caso dos agentes da fábrica: o MAC do log não os impede de escrever uma linha. Uma linha que se diz
 * do Telegram ou do callback nativo ainda precisa do recibo do canal, que a conferência antes do efeito
 * relê e que a chave local não produz. Uma linha que se diz do diálogo do host não tem recibo do canal:
 * a fronteira dela é a conta do sistema, como no recibo local do HITL, e com a chave local ela passa.
 * Truncar o log também segue possível, como no ledger (D5 da ork-rm058n1, limites ditos na página).
 *
 * Proposta não autoriza nada. O envelope só passa a valer por ingresso com prova de origem do
 * dono, pelo mesmo caminho do HITL: o envelope assinado do Telegram ou do callback nativo, que
 * `autenticarResposta` confere no endereço `noctum` / `arco:<arco>` (D1), ou o diálogo nativo
 * do host, por callback de elicitação que o servidor fornece. Argumento de ferramenta nunca é
 * resposta.
 *
 * Nada aqui guarda estado em memória: toda leitura relê o disco e todo veredito usa o instante
 * dado. Por isso revogação e expiração valem na chamada seguinte, e restart não renova nada.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { formatarDataHora } from './horario';
import { Canal, parseCanal, variavelDaChaveDoCanal } from './hitl-canais';
import { autenticarResposta, RespostaHumana } from './hitl-gates';
import { chaveDoIngresso, contaDoEnvelope } from './hitl-ingress-receipt';
import { LETRAS_DE_ALTERNATIVA, LetraDeAlternativa, MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO,
  MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO, TETOS_HITL_V2 } from './hitl-contract';
import { comLockInspecionavel } from './hitl-lock';
import { chaveLocal } from './hitl-local-receipt';
import { nativeBinding, nativeContextSchema, nativeKey } from './hitl-native';
import { publicBindingMatches, publicReceiptAuthority, signPublicReceipt, verifyPublicReceipt } from './hitl-public-receipt';
import { avaliarEfeito, avaliarJanela, canonico, ConteudoDoEnvelope, CONTRATO_ENVELOPE_V3, envelopeComTrabalhos, hashDoEnvelope, ID_DO_ARCO,
  PedidoDeEfeito, RecusaDoArco, recusaDeExclusao, resumoDoEnvelope, shaDoPedido, Teto, validarPedidoDeAbertura } from './noctum-envelope';
import { alternativasDaPergunta, AtoDaPergunta, CONTRATO_PERGUNTA_DO_ARCO, LetraDaPergunta, PerguntaDoArco,
  textoDoDialogoDoArco } from './noctum-pergunta';
import { ALVO_DO_PULSE, CODIGO_CURTO, enderecoDoPulseValido, gerarCodigo } from './pulse-consentimento';
import { lerThread, listarIds, pedidoDaThread } from './thread';
import { Fase, Thread } from './types';

export const CONTRATO_ARCO = 'ork.noctum-arco/v1' as const;

/**
 * D1 da ork-rm058n1: o endereço que o ingresso assina, nas posições de thread e de pedido. O
 * `:` não cabe no identificador que `/ork gate` e `/ork session` aceitam, e o pulse assina outro
 * alvo: nenhum envelope de gate, de sessão ou do pulse serve de prova aqui, nem o contrário.
 */
export const ALVO_DO_NOCTUM = 'noctum';
export const enderecoDoArco = (arco: string): string => `arco:${arco}`;

/** O texto que o dono assina. Fechado: qualquer outro não autoriza nem revoga. */
export const textoDeAutorizacao = (envelopeSha256: string): string => `autorizar ${envelopeSha256}`;
export const TEXTO_DE_REVOGACAO = 'revogar';

/** Uma hora para autorizar a proposta, como o pedido HITL. Vencida, ela não autoriza mais nada. */
export const PRAZO_PARA_AUTORIZAR_MIN = 60;

/** O diálogo do host espera no máximo isto, e nunca além do prazo da proposta. */
const ESPERA_DO_DIALOGO_MS = 300000;

/**
 * RM-057 (resposta curta, ork-rm057respost): a pergunta que a resposta curta respondeu. O texto que o dono digitou
 * nunca entra no log: só o hash dele, e a letra que o núcleo leu.
 */
export interface RespostaAPergunta {
  codigo: string;
  letra: LetraDaPergunta;
  /** O número do lote servido, quando o dono respondeu por ele ("1a"). */
  numero?: number;
  respostaSha256: string;
}

/** A resposta curta pelo canal: a pergunta e o endereço do pulse que o gateway assinou (`resposta` ou `resposta:<código>`). */
type PerguntaRespondida = RespostaAPergunta & { enderecoAssinado: { alvo: string; endereco: string } };

/** O que o envelope assinado provou. O corpo assinado nunca entra: só o hash da prova. */
type IngressoAssinado =
  | { origem: 'telegram'; canal: string | null; conta: string | null; por: string; mensagem: string;
    recebidoEm: string; recibo: string; pergunta?: PerguntaRespondida }
  | { origem: 'native'; canal: string | null; conta: string | null; por: string; mensagem: string;
    recebidoEm: string; recibo: string; native: Record<string, string> };

/**
 * RM-057 (resposta curta, D5 da ork-rm057respost): o que o ingresso do terminal provou sobre a origem da sessão
 * interativa do Claude Code em que o dono digitou. Quem confere é `noctum-terminal.ts`; aqui ele só é guardado.
 */
export interface AtestadoDoTerminal {
  host: 'claude-code';
  /** O id da sessão interativa, que o hook entregou e o ambiente da sessão confirmou. */
  sessao: string;
  entrypoint: string | null;
  /** As conferências da origem que passaram, na ordem em que rodaram. */
  conferencias: string[];
  recebidoEm: string;
}

type IngressoDoTerminal = AtestadoDoTerminal & { origem: 'terminal'; solicitacao: string; por: string; pergunta: RespostaAPergunta };

/** O ingresso do Telegram, o único que a resposta curta pelo canal produz. */
type IngressoDoTelegram = Extract<IngressoAssinado, { origem: 'telegram' }>;

/**
 * Quem autorizou ou revogou, e por qual ingresso. O envelope assinado aponta o recibo durável que a
 * conferência antes do efeito relê; o diálogo do host fica atestado pela linha do log, com a chave
 * local, como o recibo local do HITL. RM-057: o terminal deixa um recibo com a subchave local, que a
 * conferência relê; a fronteira dele é a conta do sistema, como a do diálogo.
 */
export type IngressoDoDono =
  | (IngressoAssinado & { evidencia: string; evidenciaSha256: string; semRecibo?: string })
  | { origem: 'mcp-local'; host: 'claude-code' | 'codex'; conexao: string; solicitacao: string; por: string;
    recebidoEm: string; respostaSha256: string }
  | (IngressoDoTerminal & { evidencia: string; evidenciaSha256: string; semRecibo?: string });

/**
 * RM-057 (resposta curta): a prova que acompanha a resposta curta. Pelo canal, o envelope assinado no endereço do pulse,
 * com o texto que o dono digitou; pelo terminal, o atestado da origem da sessão. Em nenhuma das duas o hash do envelope
 * vem da resposta: ele mora na pergunta.
 */
export type ProvaDaRespostaCurta =
  | { via: 'pulse'; envelope: RespostaHumana; endereco: string; pergunta: RespostaAPergunta }
  | { via: 'terminal'; atestado: AtestadoDoTerminal; pergunta: RespostaAPergunta };

type Ato = 'autorizar' | 'revogar';

export interface AlternativaDoLote {
  letra: LetraDeAlternativa;
  texto: string;
  consequencia: string;
  recomendada?: true;
  porque?: string;
}

/** O que só o dono resolve, guardado para o relatório da manhã (RM-048 e RM-057). */
export interface PedidoDeDecisaoEmLote {
  thread: string;
  acaoImpedida: string;
  dependentes: string[];
  impacto: string;
  pergunta: string;
  alternativas: AlternativaDoLote[];
}

/** D9 da ork-rm058n1: sem campo de resposta. A N1 guarda a pergunta; quem responde é o dono, depois. */
export interface DecisaoEmLote extends PedidoDeDecisaoEmLote {
  id: string;
  arco: string;
  enfileiradaEm: string;
  estado: 'pendente';
}

/**
 * RM-058 N2 (D11 e D12 da ork-rm058n2): a reserva de um despacho do arco, gravada sob o lock do arco junto com a
 * conferência do envelope e ANTES do efeito. Ela consome uma sessão do orçamento até ser recusada.
 */
export interface ReservaDeDespacho {
  /** O id do trabalho na lista do envelope `v2`. */
  trabalho: string;
  /** A thread despachada; `null` quando o despacho abre a thread do trabalho. */
  thread: string | null;
  fase: Fase;
  runtime: string;
  conta: string;
  revisao: boolean;
  versao: number;
  envelopeSha256: string;
}

/** Um despacho do arco como o log o conta: a reserva e o desfecho dela. */
export interface DespachoDoArco extends ReservaDeDespacho {
  /** O `seq` da linha da reserva: o id dela no log. */
  seq: number;
  reservadoEm: string;
  desfecho: 'pendente' | 'concluido' | 'recusado';
  /** A thread de fato despachada, depois da abertura. */
  threadDespachada: string | null;
  sessionId: string | null;
  idempotente: boolean;
  motivo: string | null;
  concluidoEm: string | null;
}

/** Sessões consumidas (reservadas e não recusadas), no arco e por conta e runtime. As outras unidades: `noctum-medicao.ts` (N6). */
export interface ConsumoDoArco { arco: number; porConta: Record<string, number>; porRuntime: Record<string, number> }

/**
 * RM-058 N6 (D2 e D8 da ork-rm058n6): por que o arco fechou. O fechamento é ato do núcleo, não do dono: ele só registra que
 * a hora, o teto ou a fila acabaram, e que a revogação do dono já foi tratada. RM-058, integração (D7 da ork-rm058integra):
 * `supervisao` é a parada da supervisão da N4 (o supervisor que falhou, o teto, a violação de custo ou o ambiente do
 * despacho), que o fechamento lê do log dela depois do revogado e da hora e antes do custo.
 */
export const MOTIVOS_DE_ENCERRAMENTO = ['revogado', 'hora', 'custo', 'fila-vazia', 'supervisao'] as const;
export type MotivoDeEncerramento = typeof MOTIVOS_DE_ENCERRAMENTO[number];

/** O encerramento do arco como o log o conta: terminal, com a versão que valia quando ele fechou. */
export interface EncerramentoDoArco {
  motivo: MotivoDeEncerramento;
  detalhe: string;
  em: string;
  versao: number;
  envelopeSha256: string;
}

type EventoDoArco =
  // RM-057 (resposta curta, D2 da ork-rm057respost): o código curto da pergunta nasce com a proposta. Proposta gravada
  // antes dele não tem código, e só se autoriza pelo caminho assinado de antes.
  | { tipo: 'proposto'; versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope; prazo: string; codigo?: string }
  | { tipo: 'autorizado'; versao: number; envelopeSha256: string; ingresso: IngressoDoDono }
  | { tipo: 'revogado'; ingresso: IngressoDoDono }
  | { tipo: 'decisao_enfileirada'; decisao: DecisaoEmLote }
  | { tipo: 'despacho_reservado'; reserva: ReservaDeDespacho }
  | { tipo: 'despacho_concluido'; reserva: number; thread: string; sessionId: string | null; idempotente: boolean }
  | { tipo: 'despacho_recusado'; reserva: number; motivo: string }
  | { tipo: 'encerrado'; motivo: MotivoDeEncerramento; detalhe: string }
  // RM-057 (resposta curta, D10): a pergunta de revogação ao dono. Não revoga nada: quem revoga é a resposta dele.
  | { tipo: 'revogacao_pedida'; codigo: string; prazo: string };

interface DadosDaLinha {
  contrato: typeof CONTRATO_ARCO;
  arco: string;
  seq: number;
  /** sha256 do texto da linha anterior; a primeira aponta para zeros. */
  anterior: string;
  em: string;
  evento: EventoDoArco;
}

export type SituacaoDoArco = 'proposto' | 'agendado' | 'vigente' | 'expirado' | 'revogado' | 'encerrado';

export interface EstadoDoArco {
  contrato: typeof CONTRATO_ARCO;
  arco: string;
  situacao: SituacaoDoArco;
  /** A versão autorizada que vale agora, quando há uma. */
  versao: number | null;
  envelopeSha256: string | null;
  conteudo: ConteudoDoEnvelope | null;
  autorizadoPor: IngressoDoDono | null;
  revogadoPor: IngressoDoDono | null;
  /** Proposta mais nova que ainda espera o dono, quando há uma. */
  propostaPendente: { versao: number; envelopeSha256: string; prazo: string; codigo?: string } | null;
  decisoes: DecisaoEmLote[];
  /** RM-058 N2: os despachos do arco, na ordem do log, e o consumo que eles reservaram. */
  despachos: DespachoDoArco[];
  consumo: ConsumoDoArco;
  /** RM-058 N6: o fechamento, quando o arco já fechou. Terminal: nada reabre o arco. */
  encerramento: EncerramentoDoArco | null;
  /** RM-057 (resposta curta, D10): a pergunta de revogação que ainda espera o dono, quando há uma. */
  revogacaoPedida?: { codigo: string; prazo: string; pedidaEm: string } | null;
}

export interface ConferenciaDoEfeito {
  ok: true;
  arco: string;
  versao: number;
  envelopeSha256: string;
  acao: string;
  repositorio: string;
  branch: string;
  conferidoEm: string;
  /** Quando a janela fecha. Nada prorroga este instante. */
  fim: string;
}

const ZERO = '0'.repeat(64);
const ARQUIVO = 'arco.jsonl';
const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
const adulterado = (detalhe: string) => new RecusaDoArco('noctum.estado.adulterado', `${detalhe}; o estado do arco exige inspeção`);
const semProva = (detalhe: string) => new RecusaDoArco('noctum.origem.sem-prova', detalhe);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

/** Subchave própria do arco: o mesmo segredo do recibo local, separado por domínio. */
function chaveDoArco(raiz: string, criar: boolean): Buffer {
  return createHmac('sha256', chaveLocal(raiz, criar)).update(CONTRATO_ARCO).digest();
}

function dirDoArco(raiz: string, arco: string): string {
  if (typeof arco !== 'string' || !ID_DO_ARCO.test(arco)) throw new RecusaDoArco('noctum.envelope.invalido', 'identificador de arco inválido');
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum', 'arcos', arco]);
  return path.join(principal, '.orkastery', 'noctum', 'arcos', arco);
}

/** O contexto que o callback nativo amarra, por arco e versão (ou zero, na revogação). */
export function contextoDoArco(arco: string, versao: number): string {
  return sha(JSON.stringify([CONTRATO_ARCO, arco, versao]));
}

/** O `pedidoSha256` que o callback nativo assina para revogar: não é hash de envelope nenhum. */
export function hashDaRevogacao(arco: string): string {
  return sha(JSON.stringify(['ork.noctum-revogacao/v1', arco]));
}

interface LogDoArco {
  linhas: DadosDaLinha[];
  ultimaLinha: string | null;
  terminaEmQuebra: boolean;
  /** Bytes até a última linha completa, e o tamanho lido. Diferentes, há cauda incompleta. */
  bytesCompletos: number;
  bytesLidos: number;
}

/**
 * Lê e confere o log inteiro. Linha sem quebra no fim está sendo gravada: fica de fora e não
 * dá autoridade a ninguém. Qualquer outra divergência (MAC, cadeia, sequência, arco) reprova.
 */
function lerLog(raiz: string, arco: string): LogDoArco {
  const file = path.join(dirDoArco(raiz, arco), ARQUIVO);
  let bruto: Buffer;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
        throw adulterado('log do arco não é arquivo privado do núcleo');
      }
      bruto = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { linhas: [], ultimaLinha: null, terminaEmQuebra: true, bytesCompletos: 0, bytesLidos: 0 };
    }
    if (e instanceof RecusaDoArco) throw e;
    throw adulterado('log do arco ilegível');
  }
  // Em bytes, não em caracteres: cauda que corta um caractere de vários bytes não desalinha os tamanhos.
  const fim = bruto.lastIndexOf(0x0a) + 1;
  const textos = bruto.subarray(0, fim).toString('utf8').split('\n').slice(0, -1);
  const tamanhos = { terminaEmQuebra: fim === bruto.length, bytesCompletos: fim, bytesLidos: bruto.length };
  if (!textos.length) return { linhas: [], ultimaLinha: null, ...tamanhos };
  let chave: Buffer;
  try { chave = chaveDoArco(raiz, false); } catch { throw adulterado('chave do núcleo ausente para conferir o log'); }
  let anterior = ZERO;
  const linhas = textos.map((texto, i) => {
    let l: unknown;
    try { l = JSON.parse(texto); } catch { throw adulterado(`linha ${i + 1} não é JSON`); }
    if (!objeto(l) || Object.keys(l).sort().join(',') !== 'dados,mac' || typeof l.mac !== 'string' || !/^[a-f0-9]{64}$/.test(l.mac)) {
      throw adulterado(`linha ${i + 1} fora do formato`);
    }
    const esperado = createHmac('sha256', chave).update(JSON.stringify(l.dados)).digest();
    if (!timingSafeEqual(Buffer.from(l.mac, 'hex'), esperado)) throw adulterado(`linha ${i + 1} com MAC que não confere`);
    const d = l.dados as DadosDaLinha;
    if (d.contrato !== CONTRATO_ARCO || d.arco !== arco || d.seq !== i + 1 || d.anterior !== anterior) {
      throw adulterado(`linha ${i + 1} fora da cadeia`);
    }
    anterior = sha(texto);
    return d;
  });
  return { linhas, ultimaLinha: textos.at(-1)!, ...tamanhos };
}

/**
 * Grava uma linha. Só roda sob o lock do arco, depois de `lerLog`.
 *
 * Sob o lock, cauda sem quebra de linha é escrita abortada (queda, disco cheio) ou lixo: nunca deu
 * autoridade a ninguém, e é descartada antes da linha nova. Sem isso, uma cauda rasgada impediria a
 * revogação do dono. Escrita curta volta o arquivo ao tamanho de antes e é acusada: o chamador nunca
 * recebe sucesso de uma linha que não ficou inteira no disco.
 */
function anexar(raiz: string, arco: string, log: LogDoArco, evento: EventoDoArco, quando: string): void {
  const dados: DadosDaLinha = { contrato: CONTRATO_ARCO, arco, seq: log.linhas.length + 1,
    anterior: log.ultimaLinha === null ? ZERO : sha(log.ultimaLinha), em: quando, evento };
  const mac = createHmac('sha256', chaveDoArco(raiz, true)).update(JSON.stringify(dados)).digest('hex');
  const linha = Buffer.from(JSON.stringify({ dados, mac }) + '\n', 'utf8');
  const file = path.join(dirDoArco(raiz, arco), ARQUIVO);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    if (fs.fstatSync(fd).size !== log.bytesLidos) throw adulterado('o log mudou entre a leitura e a escrita sob o lock');
    if (log.bytesLidos !== log.bytesCompletos) fs.ftruncateSync(fd, log.bytesCompletos);
    const escritos = fs.writeSync(fd, linha);
    if (escritos !== linha.length) {
      fs.ftruncateSync(fd, log.bytesCompletos);
      fs.fsyncSync(fd);
      throw adulterado(`escrita curta no log (${escritos} de ${linha.length} bytes); nada foi gravado`);
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

/** Tentativas de 100 ms pelo lock: a revogação não perde para um escritor que segura o arco por um instante. */
const TENTATIVAS_DO_LOCK = 30;

function dirParaLock(raiz: string, arco: string, criar: boolean): string {
  const dir = dirDoArco(raiz, arco);
  if (criar) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  else if (!fs.existsSync(dir)) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `arco ${arco} sem proposta`);
  return dir;
}

/** Só a disputa pelo kernel espera; qualquer outra falha, inclusive a recusa de dentro, sobe na hora. */
const disputaDoLock = (e: unknown): boolean => e instanceof Error && e.message.startsWith('HITL ocupado; exclusão do kernel');

/**
 * `esperar` na revogação, o ato de segurança, e na reserva e no desfecho do despacho (N2), que são passos curtos de quem
 * já tem a vez de despachar; o resto falha na hora, sem prender o processo.
 */
function comLockDoArco<T>(raiz: string, arco: string, criar: boolean, executar: () => T, esperar = false): T {
  const dir = dirParaLock(raiz, arco, criar);
  for (let tentativa = 1; ; tentativa++) {
    try { return comLockInspecionavel(dir, 'noctum-arco', executar); }
    catch (e) {
      if (!esperar || tentativa >= TENTATIVAS_DO_LOCK || !disputaDoLock(e)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/** A mesma espera, sem prender o event loop: é a que o diálogo usa dentro do servidor MCP. */
async function comLockDoArcoAssincrono<T>(raiz: string, arco: string, executar: () => T): Promise<T> {
  const dir = dirParaLock(raiz, arco, false);
  for (let tentativa = 1; ; tentativa++) {
    try { return comLockInspecionavel(dir, 'noctum-arco', executar); }
    catch (e) {
      if (tentativa >= TENTATIVAS_DO_LOCK || !disputaDoLock(e)) throw e;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

interface Proposta { versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope; prazo: string; codigo?: string; em: string }
interface Derivado {
  propostas: Map<number, Proposta>;
  ultima: Proposta | null;
  autorizacao: { versao: number; envelopeSha256: string; ingresso: IngressoDoDono } | null;
  revogacao: IngressoDoDono | null;
  decisoes: DecisaoEmLote[];
  /** Mensagens e solicitações que já provaram um ato: nenhuma prova serve duas vezes. */
  usadas: Set<string>;
  /** RM-058 N2: os despachos pelo `seq` da reserva. */
  despachos: Map<number, DespachoDoArco>;
  /** RM-058 N6: o fechamento do arco. */
  encerramento: EncerramentoDoArco | null;
  /** RM-057 (resposta curta): as perguntas de revogação, na ordem do log; só a última pode estar pendente. */
  revogacoesPedidas: Array<{ codigo: string; prazo: string; em: string }>;
}

/** A identidade de uma prova do dono: cada uma vale para um ato só. */
function chaveDaProva(i: IngressoDoDono | IngressoAssinado | IngressoDoTerminal): string {
  if (i.origem === 'mcp-local') return `mcp-local:${i.solicitacao}`;
  if (i.origem === 'terminal') return `terminal:${i.solicitacao}`;
  return `${i.origem}:${i.mensagem}`;
}

function derivar(linhas: DadosDaLinha[]): Derivado {
  const d: Derivado = { propostas: new Map(), ultima: null, autorizacao: null, revogacao: null, decisoes: [], usadas: new Set(),
    despachos: new Map(), encerramento: null, revogacoesPedidas: [] };
  const usar = (i: IngressoDoDono) => {
    const prova = chaveDaProva(i);
    // Uma prova do dono vale para um ato só: reaproveitada noutra linha, o log foi emendado à mão.
    if (d.usadas.has(prova)) throw adulterado('a mesma prova do dono aparece em dois atos do log');
    d.usadas.add(prova);
  };
  for (const { evento: e, seq, em } of linhas) {
    if (e.tipo === 'despacho_reservado') {
      d.despachos.set(seq, { ...e.reserva, seq, reservadoEm: em, desfecho: 'pendente', threadDespachada: null, sessionId: null,
        idempotente: false, motivo: null, concluidoEm: null });
      continue;
    }
    if (e.tipo === 'despacho_concluido' || e.tipo === 'despacho_recusado') {
      const r = d.despachos.get(e.reserva);
      // Desfecho sem reserva, ou um segundo desfecho, só existe num log emendado à mão.
      if (!r || r.desfecho !== 'pendente') throw adulterado(`desfecho da reserva ${e.reserva} sem reserva pendente`);
      if (e.tipo === 'despacho_concluido') Object.assign(r, { desfecho: 'concluido', threadDespachada: e.thread, sessionId: e.sessionId,
        idempotente: e.idempotente, concluidoEm: em });
      else Object.assign(r, { desfecho: 'recusado', motivo: e.motivo, concluidoEm: em });
      continue;
    }
    if (e.tipo === 'encerrado') {
      // O fechamento é um só e vem depois da autorização: outra linha assim só existe num log emendado à mão.
      if (!d.autorizacao || d.encerramento) throw adulterado('encerramento sem autorização ou repetido');
      d.encerramento = { motivo: e.motivo, detalhe: e.detalhe, em, versao: d.autorizacao.versao, envelopeSha256: d.autorizacao.envelopeSha256 };
      continue;
    }
    if (e.tipo === 'revogacao_pedida') {
      // Pergunta de revogação sem autorização antes dela só existe num log emendado à mão.
      if (!d.autorizacao) throw adulterado('pergunta de revogação sem autorização');
      d.revogacoesPedidas.push({ codigo: e.codigo, prazo: e.prazo, em });
      continue;
    }
    if (e.tipo === 'proposto') {
      const p: Proposta = { versao: e.versao, envelopeSha256: e.envelopeSha256, conteudo: e.conteudo, prazo: e.prazo, em,
        ...(typeof e.codigo === 'string' ? { codigo: e.codigo } : {}) };
      if (hashDoEnvelope(p.conteudo) !== p.envelopeSha256) throw adulterado(`proposta ${p.versao} com hash que não confere`);
      d.propostas.set(p.versao, p);
      d.ultima = p;
    } else if (e.tipo === 'autorizado') {
      if (d.propostas.get(e.versao)?.envelopeSha256 !== e.envelopeSha256) throw adulterado(`autorização da versão ${e.versao} sem proposta`);
      if (d.encerramento) throw adulterado(`autorização da versão ${e.versao} depois do encerramento`);
      d.autorizacao = { versao: e.versao, envelopeSha256: e.envelopeSha256, ingresso: e.ingresso };
      usar(e.ingresso);
    } else if (e.tipo === 'revogado') {
      d.revogacao = e.ingresso;
      usar(e.ingresso);
    } else if (e.tipo === 'decisao_enfileirada') d.decisoes.push(e.decisao);
  }
  return d;
}

function situacao(d: Derivado, quando: string): SituacaoDoArco {
  if (d.revogacao) return 'revogado';
  if (!d.autorizacao) return 'proposto';
  if (d.encerramento) return 'encerrado';
  const janela = d.propostas.get(d.autorizacao.versao)!.conteudo.janela;
  const agora = Date.parse(quando);
  if (agora < Date.parse(janela.inicio)) return 'agendado';
  return agora >= Date.parse(janela.fim) ? 'expirado' : 'vigente';
}

function estadoDe(arco: string, d: Derivado, quando: string): EstadoDoArco {
  const vigente = d.autorizacao ? d.propostas.get(d.autorizacao.versao)! : null;
  const pendente = d.ultima && !d.revogacao && !d.encerramento && d.ultima.versao !== d.autorizacao?.versao &&
    Date.parse(quando) < Date.parse(d.ultima.prazo) ? d.ultima : null;
  const sit = situacao(d, quando);
  // RM-057 (resposta curta): só a última pergunta de revogação espera o dono, e só com o arco ainda de pé.
  const rev = d.revogacoesPedidas.at(-1);
  const revogacaoPedida = rev && (sit === 'vigente' || sit === 'agendado') && Date.parse(quando) < Date.parse(rev.prazo)
    ? { codigo: rev.codigo, prazo: rev.prazo, pedidaEm: rev.em } : null;
  return { contrato: CONTRATO_ARCO, arco, situacao: sit, versao: vigente?.versao ?? null,
    envelopeSha256: vigente?.envelopeSha256 ?? null, conteudo: vigente?.conteudo ?? null,
    autorizadoPor: d.autorizacao?.ingresso ?? null, revogadoPor: d.revogacao,
    propostaPendente: pendente ? { versao: pendente.versao, envelopeSha256: pendente.envelopeSha256, prazo: pendente.prazo,
      ...(pendente.codigo ? { codigo: pendente.codigo } : {}) } : null,
    decisoes: d.decisoes, despachos: [...d.despachos.values()], consumo: consumoDe(d), encerramento: d.encerramento, revogacaoPedida };
}

/** D12 da ork-rm058n2: a reserva consome uma sessão até ser recusada; a concluída e a pendente contam. */
function consumoDe(d: Derivado): ConsumoDoArco {
  const c: ConsumoDoArco = { arco: 0, porConta: {}, porRuntime: {} };
  for (const r of d.despachos.values()) {
    if (r.desfecho === 'recusado') continue;
    c.arco += 1;
    c.porConta[r.conta] = (c.porConta[r.conta] ?? 0) + 1;
    c.porRuntime[r.runtime] = (c.porRuntime[r.runtime] ?? 0) + 1;
  }
  return c;
}

/**
 * Grava a proposta de um envelope. Não autoriza nada: quem autoriza é o dono, pelo ingresso.
 *
 * A mesma proposta repetida devolve a que está pendente. Proposta nova sobre um envelope já
 * autorizado é emenda: o vigente continua valendo até o dono autorizar a nova versão.
 */
export function proporEnvelope(raiz: string, pedido: unknown, quando = new Date().toISOString(), emUso: readonly string[] = []):
  { arco: string; versao: number; envelopeSha256: string; prazo: string; resumo: string[]; codigo?: string } {
  const conteudo = validarPedidoDeAbertura(pedido);
  const envelopeSha256 = hashDoEnvelope(conteudo);
  if (!(Date.parse(quando) < Date.parse(conteudo.janela.fim))) {
    throw new RecusaDoArco('noctum.envelope.invalido', `a janela pedida terminou em ${conteudo.janela.fim}`);
  }
  return comLockDoArco(raiz, conteudo.arco, true, () => {
    const log = lerLog(raiz, conteudo.arco), d = derivar(log.linhas);
    if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', 'arco revogado é terminal; abra outro arco');
    if (d.encerramento) throw new RecusaDoArco('noctum.efeito.encerrado', `arco encerrado (${d.encerramento.motivo}) é terminal; abra outro arco`);
    const resumo = resumoDoEnvelope(conteudo, envelopeSha256);
    const pendente = estadoDe(conteudo.arco, d, quando).propostaPendente;
    if (pendente?.envelopeSha256 === envelopeSha256) return { arco: conteudo.arco, ...pendente, resumo };
    if (d.autorizacao?.envelopeSha256 === envelopeSha256) {
      const vigente = d.propostas.get(d.autorizacao.versao)!;
      return { arco: conteudo.arco, versao: vigente.versao, envelopeSha256, prazo: vigente.prazo, resumo };
    }
    exigirEmendaSemProrrogar(d, conteudo, quando);
    const versao = (d.ultima?.versao ?? 0) + 1;
    const prazo = new Date(Date.parse(quando) + PRAZO_PARA_AUTORIZAR_MIN * 60000).toISOString();
    // RM-057 (resposta curta, D2): a pergunta nasce com a proposta, com um código que nenhuma outra pergunta usa agora.
    const codigo = gerarCodigo([...emUso, ...codigosDosArcos(raiz)]);
    anexar(raiz, conteudo.arco, log, { tipo: 'proposto', versao, envelopeSha256, conteudo, prazo, codigo }, quando);
    return { arco: conteudo.arco, versao, envelopeSha256, prazo, resumo, codigo };
  });
}

/**
 * RM-057 (resposta curta): os códigos das perguntas de todos os arcos desta raiz, para um código novo nunca repetir um
 * deles. Arco que não se lê não contribui (a resolução por código recusa o ambíguo de qualquer jeito).
 */
export function codigosDosArcos(raiz: string): string[] {
  let nomes: string[];
  try { nomes = fs.readdirSync(path.join(raizDoEstado(raiz), '.orkastery', 'noctum', 'arcos')).filter(n => ID_DO_ARCO.test(n)); }
  catch { return []; }
  const codigos: string[] = [];
  for (const arco of nomes) {
    try {
      const d = derivar(lerLog(raiz, arco).linhas);
      for (const p of d.propostas.values()) if (p.codigo) codigos.push(p.codigo);
      for (const r of d.revogacoesPedidas) codigos.push(r.codigo);
    } catch { /* arco ilegível não empresta código */ }
  }
  return codigos;
}

/**
 * RM-057 (resposta curta, D10 da ork-rm057respost): abre a pergunta de revogação ao dono. Não revoga nada: quem revoga é
 * a resposta dele, pela prova do canal ou do terminal. A pergunta que ainda espera o dono é devolvida, em vez de outra.
 */
export function pedirRevogacao(raiz: string, arco: string, quando = new Date().toISOString(), emUso: readonly string[] = []):
  { arco: string; codigo: string; prazo: string; versao: number; envelopeSha256: string; nova: boolean } {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', `o arco ${arco} já foi revogado`);
    if (d.encerramento) throw new RecusaDoArco('noctum.efeito.encerrado', `arco ${arco} encerrado (${d.encerramento.motivo}) é terminal`);
    if (!d.autorizacao) {
      throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `o arco ${arco} nunca foi autorizado: não há o que revogar, e a proposta vence sozinha`);
    }
    const estado = estadoDe(arco, d, quando);
    if (estado.situacao === 'expirado') throw new RecusaDoArco('noctum.efeito.expirado', `o arco ${arco} já terminou; não há o que revogar`);
    const base = { arco, versao: d.autorizacao.versao, envelopeSha256: d.autorizacao.envelopeSha256 };
    if (estado.revogacaoPedida) return { ...base, codigo: estado.revogacaoPedida.codigo, prazo: estado.revogacaoPedida.prazo, nova: false };
    const codigo = gerarCodigo([...emUso, ...codigosDosArcos(raiz)]);
    const prazo = new Date(Date.parse(quando) + PRAZO_PARA_AUTORIZAR_MIN * 60000).toISOString();
    anexar(raiz, arco, log, { tipo: 'revogacao_pedida', codigo, prazo }, quando);
    return { ...base, codigo, prazo, nova: true };
  });
}

/** RM-057 (resposta curta): a situação de uma pergunta do arco no instante dado. */
export type SituacaoDaPergunta = 'pendente' | 'respondida' | 'vencida' | 'substituida' | 'arco-terminal';

export interface PerguntaNoLog extends PerguntaDoArco { situacao: SituacaoDaPergunta }

/**
 * RM-057 (resposta curta): as perguntas do arco ao dono, derivadas do log a cada leitura, com a situação de cada uma.
 * Só a `pendente` aceita resposta; as outras existem para a resposta atrasada ouvir o porquê, nunca para valer.
 */
export function perguntasDoArco(raiz: string, arco: string, quando = new Date().toISOString()): PerguntaNoLog[] {
  const d = derivar(lerLog(raiz, arco).linhas);
  const estado = estadoDe(arco, d, quando);
  const terminal = d.revogacao !== null || d.encerramento !== null;
  const perguntas: PerguntaNoLog[] = [];
  for (const p of d.propostas.values()) {
    if (!p.codigo) continue;
    const situacao: SituacaoDaPergunta = d.autorizacao?.versao === p.versao ? 'respondida'
      : d.ultima?.versao !== p.versao ? 'substituida' : terminal ? 'arco-terminal'
        : estado.propostaPendente?.versao === p.versao && Date.parse(quando) < Date.parse(p.conteudo.janela.fim) ? 'pendente' : 'vencida';
    perguntas.push({ contrato: CONTRATO_PERGUNTA_DO_ARCO, arco, ato: 'autorizar', codigo: p.codigo, versao: p.versao,
      envelopeSha256: p.envelopeSha256, criadaEm: p.em, prazo: p.prazo, conteudo: p.conteudo, situacao });
  }
  const vigente = d.autorizacao ? d.propostas.get(d.autorizacao.versao) ?? null : null;
  d.revogacoesPedidas.forEach((r, i) => {
    const situacao: SituacaoDaPergunta = d.revogacao ? 'respondida' : i < d.revogacoesPedidas.length - 1 ? 'substituida'
      : d.encerramento ? 'arco-terminal' : estado.revogacaoPedida?.codigo === r.codigo ? 'pendente' : 'vencida';
    perguntas.push({ contrato: CONTRATO_PERGUNTA_DO_ARCO, arco, ato: 'revogar', codigo: r.codigo, versao: vigente?.versao ?? null,
      envelopeSha256: vigente?.envelopeSha256 ?? null, criadaEm: r.em, prazo: r.prazo, conteudo: vigente?.conteudo ?? null, situacao });
  });
  return perguntas;
}

/**
 * D7: emenda é versão nova com prova nova, mas não prorroga nada. Ela mantém o início, não passa do
 * fim do envelope autorizado e não reabre arco que já terminou: arco novo é outro arco.
 */
function exigirEmendaSemProrrogar(d: Derivado, conteudo: ConteudoDoEnvelope, quando: string): void {
  if (!d.autorizacao) return;
  const janela = d.propostas.get(d.autorizacao.versao)!.conteudo.janela;
  if (!(Date.parse(quando) < Date.parse(janela.fim))) {
    throw new RecusaDoArco('noctum.efeito.expirado', `o arco terminou em ${janela.fim}; emenda não reabre arco, abra outro`);
  }
  if (Date.parse(conteudo.janela.inicio) !== Date.parse(janela.inicio) || Date.parse(conteudo.janela.fim) > Date.parse(janela.fim)) {
    throw new RecusaDoArco('noctum.envelope.invalido', 'emenda mantém o início e não prorroga o fim do envelope autorizado');
  }
  // RM-058 N3 (A4 da revisão da ork-rm058n3): a emenda não troca o contrato entre a `v3` e as outras. O consumo e as sessões de
  // uma máquina só não estão no ramo de coordenação, e a soma entre máquinas os perderia; o arco entre máquinas nasce assim.
  const antes = d.propostas.get(d.autorizacao.versao)!.conteudo.contrato;
  if ((antes === CONTRATO_ENVELOPE_V3) !== (conteudo.contrato === CONTRATO_ENVELOPE_V3)) {
    throw new RecusaDoArco('noctum.envelope.invalido', `a emenda não troca o contrato de ${antes} para ${conteudo.contrato}: ` +
      'o arco entre máquinas começa como tal, e o de uma máquina segue assim; abra outro arco');
  }
}

/** A proposta que o dono pode autorizar agora, ou a recusa tipada de por que não. */
function propostaAutorizavel(d: Derivado, envelopeSha256: string, quando: string): Proposta {
  if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', 'arco revogado é terminal; abra outro arco');
  if (d.encerramento) throw new RecusaDoArco('noctum.efeito.encerrado', `arco encerrado (${d.encerramento.motivo}) é terminal; abra outro arco`);
  if (!d.ultima) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', 'arco sem proposta');
  if (d.ultima.envelopeSha256 !== envelopeSha256) {
    const conhecida = [...d.propostas.values()].some(p => p.envelopeSha256 === envelopeSha256);
    throw new RecusaDoArco(conhecida ? 'noctum.efeito.hash-antigo' : 'noctum.envelope.invalido',
      conhecida ? `a proposta mais nova é ${d.ultima.envelopeSha256}` : 'hash sem proposta neste arco');
  }
  if (!(Date.parse(quando) < Date.parse(d.ultima.prazo))) {
    throw new RecusaDoArco('noctum.envelope.invalido', `proposta vencida em ${formatarDataHora(d.ultima.prazo)}; proponha de novo`);
  }
  if (!(Date.parse(quando) < Date.parse(d.ultima.conteudo.janela.fim))) {
    throw new RecusaDoArco('noctum.efeito.expirado', `a janela terminou em ${d.ultima.conteudo.janela.fim}`);
  }
  if (d.autorizacao?.versao !== d.ultima.versao) exigirEmendaSemProrrogar(d, d.ultima.conteudo, quando);
  return d.ultima;
}

/**
 * A prova de origem do envelope assinado, pela mesma `autenticarResposta` do HITL: chave do canal,
 * allowlists, conta homologada e janela de 60 s. O texto assinado precisa ser exatamente o ato.
 * O callback nativo ainda amarra o hash do pedido, o contexto e o prazo no próprio corpo.
 */
function provarEnvelope(arco: string, texto: string, envelope: RespostaHumana, quando: string,
  amarra: { pedidoSha256: string; contexto: string; prazo?: string }): IngressoAssinado {
  if (!objeto(envelope) || (envelope.origem !== 'telegram' && envelope.origem !== 'native')) {
    throw semProva('o ingresso precisa ser o envelope assinado do Telegram ou do callback nativo do host');
  }
  try { autenticarResposta(ALVO_DO_NOCTUM, enderecoDoArco(arco), envelope, quando); }
  catch (e) { throw semProva(`ingresso não autenticado (${(e as Error).message})`); }
  if (typeof envelope.resposta !== 'string' || envelope.resposta.trim() !== texto) {
    throw semProva(`o texto assinado não é "${texto}"`);
  }
  const base = { canal: envelope.canal ?? null, conta: envelope.conta ?? null, por: envelope.por,
    mensagem: envelope.mensagem, recebidoEm: envelope.recebidoEm, recibo: sha(envelope.prova) };
  if (envelope.origem === 'telegram') return { origem: 'telegram', ...base };
  const native = nativeContextSchema.parse(envelope.native);
  if (native.pedidoSha256 !== amarra.pedidoSha256 || native.context !== amarra.contexto ||
      (amarra.prazo !== undefined && native.expiresAt !== amarra.prazo)) {
    throw semProva('o callback nativo assinou outro pedido, contexto ou prazo');
  }
  return { origem: 'native', ...base, native: { ...native } };
}

/** O corpo do recibo durável: o que o ingresso provou e para qual ato, sem o texto assinado. */
function dadosDoRecibo(arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  i: IngressoAssinado): Record<string, unknown> {
  return { contrato: 'ork.noctum-ingresso/v1', arco, endereco: enderecoDoArco(arco), ato, envelopeSha256, versao,
    origem: i.origem, canal: i.canal, conta: i.conta, por: i.por, mensagem: i.mensagem, recebidoEm: i.recebidoEm,
    recibo: i.recibo, ...(i.origem === 'native' ? { native: i.native } : {}),
    // RM-057 (resposta curta, D7): a pergunta e o endereço que o gateway assinou entram no MAC do canal.
    ...(i.origem === 'telegram' && i.pergunta ? { pergunta: i.pergunta } : {}) };
}

function lerPrivado(file: string): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
      throw adulterado('recibo do ingresso não é arquivo privado do núcleo');
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

const nomeDoRecibo = (i: { mensagem: string }): string => `${sha(i.mensagem)}.json`;

/**
 * O recibo durável do envelope assinado, no formato que o HITL assina e publica: `dados` com o MAC
 * da chave do canal e, ao lado, o `.public` que deixa reconferir sem a chave. É ele que a conferência
 * antes do efeito relê (como o FX2 faz no gate): quem tem só a chave local do núcleo não o forja.
 */
function gravarRecibo(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  i: IngressoAssinado): { evidencia: string; evidenciaSha256: string } {
  const dir = path.join(dirDoArco(raiz, arco), 'ingresso');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nome = nomeDoRecibo(i), file = path.join(dir, nome);
  const canal: Canal | null = i.canal === null ? null : parseCanal(i.canal);
  const dados = dadosDoRecibo(arco, ato, envelopeSha256, versao, i);
  const chave = i.origem === 'native' ? nativeKey(String(canal)) : chaveDoIngresso(canal);
  const bytes = JSON.stringify({ dados, assinatura: createHmac('sha256', chave).update(JSON.stringify(dados)).digest('hex') });
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  finally { fs.unlinkSync(temp); }
  if (lerPrivado(file).toString('utf8') !== bytes) throw adulterado('recibo do ingresso já existe com outro conteúdo');
  signPublicReceipt(file, canal, i.origem === 'native');
  return { evidencia: `.orkastery/noctum/arcos/${arco}/ingresso/${nome}`, evidenciaSha256: sha(bytes) };
}

/**
 * Reconfere o recibo durável do envelope assinado, com a chave do canal quando o processo a tem, ou
 * com o verificador público herdado (`ORK_RECEIPT_VERIFIERS`). Chave presente e inválida reprova; sem
 * chave e sem verificador, a prova não pode ser reconferida aqui.
 */
function reciboConfere(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  i: IngressoDoDono): 'ok' | 'sem-verificador' | 'falhou' {
  if (i.origem === 'mcp-local') return 'ok';
  if (i.origem === 'terminal') return reciboDoTerminalConfere(raiz, arco, ato, envelopeSha256, versao, i);
  try {
    const nome = nomeDoRecibo(i);
    if (i.evidencia !== `.orkastery/noctum/arcos/${arco}/ingresso/${nome}`) return 'falhou';
    const file = path.join(dirDoArco(raiz, arco), 'ingresso', nome);
    const bytes = lerPrivado(file);
    if (sha(bytes) !== i.evidenciaSha256) return 'falhou';
    const v = JSON.parse(bytes.toString('utf8')) as unknown;
    const { evidencia: _evidencia, evidenciaSha256: _sha, ...assinado } = i;
    if (!objeto(v) || Object.keys(v).sort().join(',') !== 'assinatura,dados' || typeof v.assinatura !== 'string' ||
        !/^[a-f0-9]{64}$/.test(v.assinatura) || canonico(v.dados) !== canonico(dadosDoRecibo(arco, ato, envelopeSha256, versao, assinado))) {
      return 'falhou';
    }
    const native = i.origem === 'native';
    const canal: Canal | null = i.canal === null ? null : parseCanal(i.canal);
    if (i.canal !== null && canal !== i.canal) return 'falhou';
    const variavel = native ? `ORK_HITL_NATIVE_KEY_${String(canal).toUpperCase()}` : variavelDaChaveDoCanal(canal);
    if (process.env[variavel] !== undefined) {
      // A conta e o vínculo de agora, como no gate: depois de uma troca, o que a conta antiga autorizou não vale.
      if (i.origem === 'native') {
        if (Object.entries(nativeBinding(String(canal))).some(([k, v]) => i.native[k] !== v)) return 'falhou';
      } else contaDoEnvelope(canal, i.conta ?? undefined);
      const chave = native ? nativeKey(String(canal)) : chaveDoIngresso(canal);
      return timingSafeEqual(Buffer.from(v.assinatura, 'hex'), createHmac('sha256', chave).update(JSON.stringify(v.dados)).digest())
        ? 'ok' : 'falhou';
    }
    const autoridade = publicReceiptAuthority(canal, native);
    if (!autoridade) return 'sem-verificador';
    let vinculo: unknown = i.conta;
    if (i.origem === 'native') {
      const { messageId: _m, context: _c, pedidoSha256: _p, expiresAt: _e, ...identidade } = i.native;
      vinculo = identidade;
    }
    return publicBindingMatches(autoridade, vinculo) && verifyPublicReceipt(file, bytes, autoridade) ? 'ok' : 'falhou';
  } catch { return 'falhou'; }
}

/** Relê o disco depois de gravar: o ato só volta com sucesso quando está no log, inteiro. */
function confirmado(raiz: string, arco: string, quando: string, vale: (e: EstadoDoArco) => boolean, ato: string): EstadoDoArco {
  const log = lerLog(raiz, arco), estado = estadoDe(arco, derivar(log.linhas), quando);
  if (!log.terminaEmQuebra || !vale(estado)) throw adulterado(`a ${ato} não ficou gravada no log`);
  return estado;
}

/**
 * Autoriza a proposta pendente pelo envelope assinado do dono. Sem prova, nada muda. `info.repetida` diz, decidido sob
 * o lock do arco, que o ato já valia antes desta mensagem (o gateway não confirma de novo ao dono).
 */
export function autorizarPeloIngresso(raiz: string, arco: string, envelopeSha256: string, envelope: RespostaHumana,
  quando = new Date().toISOString(), info?: { repetida: boolean }): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const versao = d.ultima?.envelopeSha256 === envelopeSha256 ? d.ultima.versao : 0;
    const provado = provarEnvelope(arco, textoDeAutorizacao(envelopeSha256), envelope, quando,
      { pedidoSha256: envelopeSha256, contexto: contextoDoArco(arco, versao), prazo: d.ultima?.prazo });
    // A mesma autorização repetida devolve o que já vale; no arco que já acabou, a recusa tipada chega ao gateway, que
    // responde ao dono, em vez de um ok mudo (RM-058 N6).
    if (d.autorizacao?.envelopeSha256 === envelopeSha256 && !d.revogacao) {
      const atual = estadoDe(arco, d, quando);
      if (atual.situacao === 'encerrado') {
        throw new RecusaDoArco('noctum.efeito.encerrado', `arco ${arco} encerrado (${d.encerramento?.motivo ?? 'fechado'}) é terminal; abra outro arco`);
      }
      if (atual.situacao === 'expirado') {
        throw new RecusaDoArco('noctum.efeito.expirado', `o arco ${arco} terminou em ${atual.conteudo?.janela.fim ?? 'o fim da janela'}; abra outro arco`);
      }
      if (info) info.repetida = true;
      return atual;
    }
    if (d.usadas.has(`${provado.origem}:${provado.mensagem}`)) throw semProva('esta mensagem já provou outro ato neste arco');
    const proposta = propostaAutorizavel(d, envelopeSha256, quando);
    const ingresso = { ...provado, ...gravarRecibo(raiz, arco, 'autorizar', envelopeSha256, proposta.versao, provado) };
    anexar(raiz, arco, log, { tipo: 'autorizado', versao: proposta.versao, envelopeSha256, ingresso }, quando);
    return confirmado(raiz, arco, quando, e => e.envelopeSha256 === envelopeSha256 && e.situacao !== 'revogado', 'autorização');
  });
}

/** Revoga o arco pelo envelope assinado do dono. Terminal: nenhum efeito passa depois (D7). `info.repetida`: já valia. */
export function revogarPeloIngresso(raiz: string, arco: string, envelope: RespostaHumana,
  quando = new Date().toISOString(), info?: { repetida: boolean }): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const provado = provarEnvelope(arco, TEXTO_DE_REVOGACAO, envelope, quando,
      { pedidoSha256: hashDaRevogacao(arco), contexto: contextoDoArco(arco, 0) });
    if (d.revogacao) {
      if (info) info.repetida = true;
      return estadoDe(arco, d, quando);
    }
    if (d.usadas.has(`${provado.origem}:${provado.mensagem}`)) throw semProva('esta mensagem já provou outro ato neste arco');
    // O recibo da revogação é auditoria e nunca é reconferido: falha nele não segura o ato de segurança, e o motivo fica na linha.
    let recibo: { evidencia: string; evidenciaSha256: string; semRecibo?: string };
    try { recibo = gravarRecibo(raiz, arco, 'revogar', null, null, provado); }
    // Só o motivo tipado: a mensagem crua do erro pode trazer caminho da máquina, e o relatório da manhã lê esta linha.
    catch (e) { recibo = { evidencia: '', evidenciaSha256: '', semRecibo: e instanceof RecusaDoArco ? e.motivo : 'noctum.recibo.nao-gravado' }; }
    const ingresso = { ...provado, ...recibo };
    anexar(raiz, arco, log, { tipo: 'revogado', ingresso }, quando);
    return confirmado(raiz, arco, quando, e => e.situacao === 'revogado', 'revogação');
  }, true);
}

// ---------------------------------------------------------------------------
// RM-057 (resposta curta, ork-rm057respost): os atos do dono pela resposta curta à pergunta do arco.
// ---------------------------------------------------------------------------

/** O domínio da subchave local que assina o recibo do terminal: o mesmo segredo do recibo local, separado por domínio. */
const DOMINIO_DO_RECIBO_DO_TERMINAL = 'ork.noctum-terminal/v1';

/** A resposta curta já lida pelo núcleo: o código da pergunta, a letra e o hash do texto do dono. */
function validarRespostaAPergunta(r: unknown): RespostaAPergunta {
  if (!objeto(r) || typeof r.codigo !== 'string' || !CODIGO_CURTO.test(r.codigo) || !['a', 'b', 'c'].includes(String(r.letra)) ||
      typeof r.respostaSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.respostaSha256) ||
      (r.numero !== undefined && (!Number.isInteger(r.numero) || (r.numero as number) < 1 || (r.numero as number) > 99))) {
    throw semProva('a resposta curta chegou malformada');
  }
  return { codigo: r.codigo, letra: r.letra as LetraDaPergunta, respostaSha256: r.respostaSha256,
    ...(r.numero !== undefined ? { numero: r.numero as number } : {}) };
}

/**
 * A prova da resposta curta. Pelo canal, a MESMA `autenticarResposta` do HITL, no endereço do pulse que o gateway assinou
 * (`resposta`, ou `resposta:<código>` no reply), no instante do envelope e no de agora, com o texto assinado igual ao que o
 * núcleo leu. Pelo terminal, o atestado da origem da sessão, conferido por `noctum-terminal.ts` (D5): a fronteira dele é
 * a conta do sistema, como a do diálogo nativo.
 */
function provarRespostaCurta(prova: ProvaDaRespostaCurta, quando: string): IngressoDoTelegram | IngressoDoTerminal {
  if (!objeto(prova)) throw semProva('a resposta curta precisa de prova');
  const pergunta = validarRespostaAPergunta(prova.pergunta);
  if (prova.via === 'pulse') {
    const e = prova.envelope;
    if (!objeto(e) || e.origem !== 'telegram') throw semProva('a resposta curta pelo canal precisa do envelope assinado do Telegram');
    if (typeof prova.endereco !== 'string' || !enderecoDoPulseValido(prova.endereco)) throw semProva('endereço assinado fora do pulse');
    try {
      autenticarResposta(ALVO_DO_PULSE, prova.endereco, e, e.recebidoEm);
      autenticarResposta(ALVO_DO_PULSE, prova.endereco, e, quando);
    } catch (x) { throw semProva(`ingresso não autenticado (${(x as Error).message})`); }
    if (typeof e.resposta !== 'string' || sha(e.resposta) !== pergunta.respostaSha256) {
      throw semProva('o texto assinado não é a resposta que o núcleo leu');
    }
    return { origem: 'telegram', canal: e.canal ?? null, conta: e.conta ?? null, por: e.por, mensagem: e.mensagem,
      recebidoEm: e.recebidoEm, recibo: sha(e.prova), pergunta: { ...pergunta, enderecoAssinado: { alvo: ALVO_DO_PULSE, endereco: prova.endereco } } };
  }
  if (prova.via === 'terminal') {
    const a = prova.atestado;
    const idade = objeto(a) ? Date.parse(quando) - Date.parse(String(a.recebidoEm)) : NaN;
    if (!objeto(a) || a.host !== 'claude-code' || typeof a.sessao !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(a.sessao) ||
        (a.entrypoint !== null && (typeof a.entrypoint !== 'string' || a.entrypoint.length > 64)) || !Array.isArray(a.conferencias) ||
        !a.conferencias.length || a.conferencias.some(c => typeof c !== 'string' || c.length > 80) ||
        !Number.isFinite(idade) || idade < 0 || idade > 60000) {
      throw semProva('o atestado do terminal chegou malformado ou fora da janela de 60 s');
    }
    return { origem: 'terminal', host: 'claude-code', sessao: a.sessao, entrypoint: a.entrypoint, conferencias: [...a.conferencias],
      recebidoEm: a.recebidoEm, solicitacao: randomUUID(), por: 'terminal:claude-code', pergunta };
  }
  throw semProva('a resposta curta chegou por uma via desconhecida');
}

/** A subchave do recibo do terminal. */
function chaveDoTerminal(raiz: string, criar: boolean): Buffer {
  return createHmac('sha256', chaveLocal(raiz, criar)).update(DOMINIO_DO_RECIBO_DO_TERMINAL).digest();
}

const nomeDoReciboDoTerminal = (i: { solicitacao: string }): string => `${sha(`terminal:${i.solicitacao}`)}.json`;

function dadosDoReciboDoTerminal(arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  i: IngressoDoTerminal): Record<string, unknown> {
  return { contrato: 'ork.noctum-ingresso/v1', arco, endereco: enderecoDoArco(arco), ato, envelopeSha256, versao, origem: 'terminal',
    host: i.host, sessao: i.sessao, entrypoint: i.entrypoint, conferencias: i.conferencias, solicitacao: i.solicitacao, por: i.por,
    recebidoEm: i.recebidoEm, pergunta: i.pergunta };
}

/** O recibo do terminal, com a subchave local: a conferência antes do efeito o relê, como relê o do canal. */
function gravarReciboDoTerminal(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  i: IngressoDoTerminal): { evidencia: string; evidenciaSha256: string } {
  const dir = path.join(dirDoArco(raiz, arco), 'ingresso');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nome = nomeDoReciboDoTerminal(i), file = path.join(dir, nome);
  const dados = dadosDoReciboDoTerminal(arco, ato, envelopeSha256, versao, i);
  const bytes = JSON.stringify({ dados, assinatura: createHmac('sha256', chaveDoTerminal(raiz, true)).update(JSON.stringify(dados)).digest('hex') });
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  finally { fs.unlinkSync(temp); }
  if (lerPrivado(file).toString('utf8') !== bytes) throw adulterado('recibo do terminal já existe com outro conteúdo');
  return { evidencia: `.orkastery/noctum/arcos/${arco}/ingresso/${nome}`, evidenciaSha256: sha(bytes) };
}

/** Reconfere o recibo do terminal: o arquivo privado, o hash, os dados iguais aos da linha e o MAC da subchave local. */
function reciboDoTerminalConfere(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  i: IngressoDoTerminal & { evidencia: string; evidenciaSha256: string; semRecibo?: string }): 'ok' | 'falhou' {
  try {
    const nome = nomeDoReciboDoTerminal(i);
    if (i.evidencia !== `.orkastery/noctum/arcos/${arco}/ingresso/${nome}`) return 'falhou';
    const bytes = lerPrivado(path.join(dirDoArco(raiz, arco), 'ingresso', nome));
    if (sha(bytes) !== i.evidenciaSha256) return 'falhou';
    const v = JSON.parse(bytes.toString('utf8')) as unknown;
    const { evidencia: _evidencia, evidenciaSha256: _sha, semRecibo: _sem, ...atestado } = i;
    if (!objeto(v) || Object.keys(v).sort().join(',') !== 'assinatura,dados' || typeof v.assinatura !== 'string' ||
        !/^[a-f0-9]{64}$/.test(v.assinatura) || canonico(v.dados) !== canonico(dadosDoReciboDoTerminal(arco, ato, envelopeSha256, versao, atestado))) {
      return 'falhou';
    }
    return timingSafeEqual(Buffer.from(v.assinatura, 'hex'), createHmac('sha256', chaveDoTerminal(raiz, false)).update(JSON.stringify(v.dados)).digest())
      ? 'ok' : 'falhou';
  } catch { return 'falhou'; }
}

/** O ingresso do dono com o recibo durável da via (o do canal ou o do terminal). */
function comRecibo(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, versao: number | null,
  provado: IngressoDoTelegram | IngressoDoTerminal): IngressoDoDono {
  return provado.origem === 'terminal'
    ? { ...provado, ...gravarReciboDoTerminal(raiz, arco, ato, envelopeSha256, versao, provado) }
    : { ...provado, ...gravarRecibo(raiz, arco, ato, envelopeSha256, versao, provado) };
}

/** O que a resposta curta encontrou: se o ato já valia e se foi esta mesma prova que o fez valer. */
export interface InfoDaRespostaCurta { repetida: boolean; mesmaProva: boolean }

/**
 * RM-057 (resposta curta): autoriza a proposta pela resposta curta do dono à pergunta dela. O hash vem da pergunta (a
 * proposta com este código), nunca da resposta. Sob o lock do arco: a pergunta tem de ser a de agora (a proposta mais
 * nova, no prazo e na janela), a prova não pode ter servido a outro ato, e o ato só volta com sucesso relido do disco.
 */
export function autorizarPelaResposta(raiz: string, arco: string, codigo: string, prova: ProvaDaRespostaCurta,
  quando = new Date().toISOString(), info?: InfoDaRespostaCurta): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const proposta = [...d.propostas.values()].find(p => p.codigo === codigo);
    if (!proposta) throw new RecusaDoArco('noctum.pergunta.desconhecida', `o arco ${arco} não tem a pergunta ${codigo}`);
    const provado = provarRespostaCurta(prova, quando);
    if (provado.pergunta?.codigo !== codigo) throw semProva('a prova responde a outra pergunta');
    if (d.autorizacao?.envelopeSha256 === proposta.envelopeSha256 && d.autorizacao.versao === proposta.versao && !d.revogacao) {
      const atual = estadoDe(arco, d, quando);
      if (atual.situacao === 'encerrado') {
        throw new RecusaDoArco('noctum.efeito.encerrado', `arco ${arco} encerrado (${d.encerramento?.motivo ?? 'fechado'}) é terminal; abra outro arco`);
      }
      if (atual.situacao === 'expirado') {
        throw new RecusaDoArco('noctum.efeito.expirado', `o arco ${arco} terminou em ${atual.conteudo?.janela.fim ?? 'o fim da janela'}; abra outro arco`);
      }
      if (info) { info.repetida = true; info.mesmaProva = chaveDaProva(d.autorizacao.ingresso) === chaveDaProva(provado); }
      return atual;
    }
    if (d.usadas.has(chaveDaProva(provado))) throw semProva('esta mensagem já provou outro ato neste arco');
    // A pergunta respondida é a de agora: a proposta mais nova, no prazo e na janela (a recusa diz por que não).
    const autorizavel = propostaAutorizavel(d, proposta.envelopeSha256, quando);
    const ingresso = comRecibo(raiz, arco, 'autorizar', autorizavel.envelopeSha256, autorizavel.versao, provado);
    anexar(raiz, arco, log, { tipo: 'autorizado', versao: autorizavel.versao, envelopeSha256: autorizavel.envelopeSha256, ingresso }, quando);
    return confirmado(raiz, arco, quando, e => e.envelopeSha256 === autorizavel.envelopeSha256 && e.situacao !== 'revogado', 'autorização');
  });
}

/**
 * RM-057 (resposta curta, D10): revoga o arco pela resposta curta do dono à pergunta de revogação. Terminal, como a
 * revogação assinada. A pergunta tem de ser a última de revogação, no prazo; o recibo é auditoria e nunca segura o ato.
 */
export function revogarPelaResposta(raiz: string, arco: string, codigo: string, prova: ProvaDaRespostaCurta,
  quando = new Date().toISOString(), info?: InfoDaRespostaCurta): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const pedida = d.revogacoesPedidas.find(r => r.codigo === codigo);
    if (!pedida) throw new RecusaDoArco('noctum.pergunta.desconhecida', `o arco ${arco} não tem a pergunta ${codigo}`);
    const provado = provarRespostaCurta(prova, quando);
    if (provado.pergunta?.codigo !== codigo) throw semProva('a prova responde a outra pergunta');
    if (d.revogacao) {
      if (info) { info.repetida = true; info.mesmaProva = chaveDaProva(d.revogacao) === chaveDaProva(provado); }
      return estadoDe(arco, d, quando);
    }
    if (d.revogacoesPedidas.at(-1)?.codigo !== codigo) {
      throw new RecusaDoArco('noctum.pergunta.substituida', `a pergunta ${codigo} foi substituída por outra de revogação`);
    }
    if (!(Date.parse(quando) < Date.parse(pedida.prazo))) {
      throw new RecusaDoArco('noctum.pergunta.vencida', `a pergunta ${codigo} venceu em ${formatarDataHora(pedida.prazo)}; peça a revogação de novo`);
    }
    if (d.usadas.has(chaveDaProva(provado))) throw semProva('esta mensagem já provou outro ato neste arco');
    let recibo: { evidencia: string; evidenciaSha256: string; semRecibo?: string };
    try {
      const comProva = comRecibo(raiz, arco, 'revogar', null, null, provado) as { evidencia: string; evidenciaSha256: string };
      recibo = { evidencia: comProva.evidencia, evidenciaSha256: comProva.evidenciaSha256 };
    } catch (e) { recibo = { evidencia: '', evidenciaSha256: '', semRecibo: e instanceof RecusaDoArco ? e.motivo : 'noctum.recibo.nao-gravado' }; }
    anexar(raiz, arco, log, { tipo: 'revogado', ingresso: { ...provado, ...recibo } as IngressoDoDono }, quando);
    return confirmado(raiz, arco, quando, e => e.situacao === 'revogado', 'revogação');
  }, true);
}

/**
 * O que o diálogo nativo do host mostra ao dono. Só identificadores, a pergunta e o resumo; nenhuma resposta. RM-057
 * (resposta curta, D7 da ork-rm057respost): a pergunta no contrato curto, com as três alternativas e a recomendada, e o
 * envelope inteiro logo abaixo dela (o dono autoriza só o que leu).
 */
export interface ApresentacaoDoArco {
  contrato: 'ork.noctum-dialogo/v1';
  arco: string;
  ato: 'autorizar' | 'revogar';
  envelopeSha256: string | null;
  resumo: string[];
  /** A mensagem do diálogo: a pergunta no padrão RM-057 e o resumo do envelope. */
  mensagem: string;
  /** Uma por alternativa, na ordem: só a primeira (a recomendada) executa o ato; as outras não fazem nada. */
  opcoes: string[];
}

/** As opções do diálogo, uma por alternativa da pergunta, com o selo na recomendada. */
function opcoesDoDialogo(ato: AtoDaPergunta): string[] {
  return alternativasDaPergunta({ ato }).map(a => `${a.letra}) ${a.texto}${a.porque ? ' (Recomendação)' : ''}`);
}

export interface RespostaDoDialogo {
  action: 'accept' | 'decline' | 'cancel';
  content?: { opcao: string };
}

/**
 * O diálogo nativo do host para autorizar ou revogar, com o callback de elicitação fornecido pelo
 * servidor, nunca pelos argumentos de uma ferramenta. É a mesma fronteira de `criarIngressoLocal`:
 * a instalação do cliente MCP é confiável; o modelo não responde por ela. A N1 entrega o contrato;
 * a ferramenta do MCP que o expõe fica para a fatia que liga o transporte (D1).
 */
export function criarDialogoDoArco(raiz: string, origem: { host: 'claude-code' | 'codex'; connectionId: string },
  elicitar: (a: ApresentacaoDoArco, signal: AbortSignal) => Promise<RespostaDoDialogo>) {
  if (!['claude-code', 'codex'].includes(origem.host) || !ID_DE_THREAD.test(origem.connectionId)) {
    throw semProva('diálogo de origem desconhecida');
  }
  const conexao = { ...origem };
  const perguntar = async (a: ApresentacaoDoArco, prazo: string | undefined): Promise<{ requestId: string; recebidoEm: string }> => {
    const controller = new AbortController(), requestId = randomUUID();
    const espera = Math.min(ESPERA_DO_DIALOGO_MS, prazo === undefined ? ESPERA_DO_DIALOGO_MS : Date.parse(prazo) - Date.now());
    if (!(espera > 0)) throw new RecusaDoArco('noctum.envelope.invalido', 'proposta vencida; proponha de novo');
    const timer = setTimeout(() => controller.abort(), espera);
    try {
      const cancelar = new Promise<RespostaDoDialogo>(r => controller.signal.addEventListener('abort', () => r({ action: 'cancel' }), { once: true }));
      const r = await Promise.race([elicitar(JSON.parse(JSON.stringify(a)), controller.signal), cancelar]);
      // Só a primeira alternativa (a recomendada) age; adiar e mudar algo não fazem nada (D13 da ork-rm057respost).
      if (!objeto(r) || r.action !== 'accept' || !objeto(r.content) || Object.keys(r.content).length !== 1 ||
          r.content.opcao !== a.opcoes[0]) throw semProva('o dono não confirmou pelo diálogo nativo do host');
      return { requestId, recebidoEm: new Date().toISOString() };
    } finally { clearTimeout(timer); controller.abort(); }
  };
  const ingressoDoDialogo = (requestId: string, recebidoEm: string, opcao: string): IngressoDoDono => ({
    origem: 'mcp-local', host: conexao.host, conexao: conexao.connectionId, solicitacao: requestId,
    por: `mcp-local:${conexao.host}`, recebidoEm, respostaSha256: sha(opcao) });
  return {
    async autorizar(arco: string, envelopeSha256: string): Promise<EstadoDoArco> {
      const antes = comLockDoArco(raiz, arco, false, () => {
        const d = derivar(lerLog(raiz, arco).linhas);
        return propostaAutorizavel(d, envelopeSha256, new Date().toISOString());
      });
      const resumo = resumoDoEnvelope(antes.conteudo, envelopeSha256), quando = new Date().toISOString();
      const pergunta: PerguntaDoArco = { contrato: CONTRATO_PERGUNTA_DO_ARCO, arco, ato: 'autorizar', codigo: antes.codigo ?? '',
        versao: antes.versao, envelopeSha256, criadaEm: antes.em, prazo: antes.prazo, conteudo: antes.conteudo };
      const a: ApresentacaoDoArco = { contrato: 'ork.noctum-dialogo/v1', arco, ato: 'autorizar', envelopeSha256, resumo,
        mensagem: [textoDoDialogoDoArco(pergunta, quando), '', ...resumo].join('\n'), opcoes: opcoesDoDialogo('autorizar') };
      const { requestId, recebidoEm } = await perguntar(a, antes.prazo);
      // O mundo pode ter mudado enquanto o dono lia: tudo é conferido de novo sob o lock.
      return comLockDoArcoAssincrono(raiz, arco, () => {
        const log = lerLog(raiz, arco), d = derivar(log.linhas);
        if (d.autorizacao?.envelopeSha256 === envelopeSha256 && !d.revogacao) return estadoDe(arco, d, recebidoEm);
        const proposta = propostaAutorizavel(d, envelopeSha256, recebidoEm);
        anexar(raiz, arco, log, { tipo: 'autorizado', versao: proposta.versao, envelopeSha256,
          ingresso: ingressoDoDialogo(requestId, recebidoEm, a.opcoes[0]) }, recebidoEm);
        return confirmado(raiz, arco, recebidoEm, e => e.envelopeSha256 === envelopeSha256 && e.situacao !== 'revogado', 'autorização');
      });
    },
    async revogar(arco: string): Promise<EstadoDoArco> {
      // Leitura sem lock (o log é lido inteiro e conferido): revogar não pode falhar antes de perguntar ao dono.
      const atual = lerArco(raiz, arco);
      if (!atual) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `arco ${arco} sem proposta`);
      const resumo = [`Revogar o arco ${arco}: nenhum efeito novo passa depois disto, e o arco não reabre`];
      const quando = new Date().toISOString();
      const pergunta: PerguntaDoArco = { contrato: CONTRATO_PERGUNTA_DO_ARCO, arco, ato: 'revogar', codigo: atual.revogacaoPedida?.codigo ?? '',
        versao: atual.versao, envelopeSha256: atual.envelopeSha256, criadaEm: quando,
        prazo: atual.revogacaoPedida?.prazo ?? new Date(Date.parse(quando) + ESPERA_DO_DIALOGO_MS).toISOString(), conteudo: atual.conteudo };
      const a: ApresentacaoDoArco = { contrato: 'ork.noctum-dialogo/v1', arco, ato: 'revogar', envelopeSha256: atual.envelopeSha256, resumo,
        mensagem: [textoDoDialogoDoArco(pergunta, quando), '', ...resumo].join('\n'), opcoes: opcoesDoDialogo('revogar') };
      const { requestId, recebidoEm } = await perguntar(a, undefined);
      return comLockDoArcoAssincrono(raiz, arco, () => {
        const log = lerLog(raiz, arco), d = derivar(log.linhas);
        if (!d.revogacao) anexar(raiz, arco, log, { tipo: 'revogado', ingresso: ingressoDoDialogo(requestId, recebidoEm, a.opcoes[0]) }, recebidoEm);
        return confirmado(raiz, arco, recebidoEm, e => e.situacao === 'revogado', 'revogação');
      });
    },
  };
}

const linhaCurta = (v: unknown, teto: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= teto && !/[\r\n]/.test(v);

/** RM-057: 3 a 5 alternativas, letras em sequência, exatamente uma recomendada com o porquê. */
function validarDecisao(v: unknown): PedidoDeDecisaoEmLote {
  const invalido = (detalhe: string) => new RecusaDoArco('noctum.envelope.invalido', `decisão em lote: ${detalhe}`);
  if (!objeto(v)) throw invalido('precisa ser objeto');
  const chaves = ['thread', 'acaoImpedida', 'dependentes', 'impacto', 'pergunta', 'alternativas'];
  const sobra = Object.keys(v).filter(k => !chaves.includes(k));
  if (sobra.length) throw invalido(`campo fora do contrato: ${sobra.join(', ')} (a resposta é do dono, depois)`);
  if (typeof v.thread !== 'string' || !ID_DE_THREAD.test(v.thread)) throw invalido('thread inválida');
  for (const campo of ['acaoImpedida', 'impacto', 'pergunta'] as const) {
    if (!linhaCurta(v[campo], TETOS_HITL_V2.pergunta)) throw invalido(`${campo} em uma linha, até ${TETOS_HITL_V2.pergunta}`);
  }
  if (!Array.isArray(v.dependentes) || v.dependentes.length > 50 || v.dependentes.some(x => typeof x !== 'string' || !ID_DE_THREAD.test(x))) {
    throw invalido('dependentes é lista de identificadores');
  }
  const alternativas = v.alternativas;
  if (!Array.isArray(alternativas) || alternativas.length < MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO ||
      alternativas.length > MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO) {
    throw invalido(`de ${MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO} a ${MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO} alternativas`);
  }
  const lidas = alternativas.map((a, i): AlternativaDoLote => {
    if (!objeto(a) || a.letra !== LETRAS_DE_ALTERNATIVA[i] || !linhaCurta(a.texto, TETOS_HITL_V2.alternativaTexto) ||
        !linhaCurta(a.consequencia, TETOS_HITL_V2.consequencia) || Object.keys(a).some(k => !['letra', 'texto', 'consequencia', 'recomendada', 'porque'].includes(k))) {
      throw invalido(`alternativa ${i + 1} fora do contrato`);
    }
    if (a.recomendada !== undefined && a.recomendada !== true) throw invalido(`alternativa ${i + 1}: recomendada é true ou ausente`);
    if (a.recomendada === true && !linhaCurta(a.porque, TETOS_HITL_V2.porque)) throw invalido('a recomendada diz o porquê em uma linha');
    if (a.recomendada !== true && a.porque !== undefined) throw invalido('só a recomendada traz porquê');
    return { letra: a.letra as LetraDeAlternativa, texto: a.texto as string, consequencia: a.consequencia as string,
      ...(a.recomendada === true ? { recomendada: true as const, porque: a.porque as string } : {}) };
  });
  if (lidas.filter(a => a.recomendada).length !== 1) throw invalido('exatamente uma alternativa recomendada');
  return { thread: v.thread, acaoImpedida: v.acaoImpedida as string, dependentes: [...v.dependentes as string[]],
    impacto: v.impacto as string, pergunta: v.pergunta as string, alternativas: lidas };
}

/** Id estável: o mesmo arco, thread e ação impedida dão o mesmo id, em qualquer processo. */
export function idDaDecisao(arco: string, thread: string, acaoImpedida: string): string {
  return 'L-' + sha(canonico([arco, thread, acaoImpedida])).slice(0, 12);
}

/**
 * Guarda na fila do lote o que só o dono resolve. A recomendada não é aplicada e nenhum campo de
 * resposta existe: a decisão fica pendente até o dono responder pelo ingresso, numa fatia futura.
 * Vale também depois de revogação ou expiração, porque o lote vai no relatório de qualquer jeito.
 */
export function enfileirarDecisao(raiz: string, arco: string, pedido: unknown, quando = new Date().toISOString()): DecisaoEmLote {
  const lido = validarDecisao(pedido);
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    if (!d.autorizacao) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', 'arco nunca autorizado não tem lote');
    const id = idDaDecisao(arco, lido.thread, lido.acaoImpedida);
    const existente = d.decisoes.find(x => x.id === id);
    if (existente) return existente;
    const decisao: DecisaoEmLote = { id, arco, enfileiradaEm: quando, estado: 'pendente', ...lido };
    anexar(raiz, arco, log, { tipo: 'decisao_enfileirada', decisao }, quando);
    return decisao;
  });
}

/** O estado do arco, relido do disco e julgado no instante dado. `null` quando o arco não existe. */
export function lerArco(raiz: string, arco: string, quando = new Date().toISOString()): EstadoDoArco | null {
  const log = lerLog(raiz, arco);
  return log.linhas.length ? estadoDe(arco, derivar(log.linhas), quando) : null;
}

/** O estado do arco e o conteúdo da proposta que ainda espera o dono no prazo, de uma leitura só do log. */
export interface ArcoComProposta { estado: EstadoDoArco; proposta: ConteudoDoEnvelope | null }

/**
 * RM-058, integração (D3 da ork-rm058integra): a guarda das threads do arco (`noctum-guarda.ts`) lê a lista de trabalhos
 * do envelope vigente e a da proposta no prazo; o estado só traz o hash e o prazo dela. `null` quando o arco não existe.
 */
export function lerArcoComProposta(raiz: string, arco: string, quando = new Date().toISOString()): ArcoComProposta | null {
  const log = lerLog(raiz, arco);
  if (!log.linhas.length) return null;
  const d = derivar(log.linhas), estado = estadoDe(arco, d, quando);
  return { estado, proposta: estado.propostaPendente ? d.propostas.get(estado.propostaPendente.versao)!.conteudo : null };
}

/**
 * A conferência imediatamente antes de um efeito. Relê o disco, sem cache, e recusa na ordem:
 * ação excluída, estado adulterado (inclusive cauda incompleta), revogação, falta de autorização,
 * recibo do dono que não confere, hash diferente do vigente, janela e destino. Passar aqui é necessário
 * e não suficiente: as provas do merge são da N5 e o consumo do orçamento é da N2 e da N6 (D8). O
 * instante é parâmetro para os testes; o executor chama sem ele, com o relógio do processo.
 */
export function conferirAntesDoEfeito(raiz: string, efeito: PedidoDeEfeito, quando = new Date().toISOString()): ConferenciaDoEfeito {
  const excluida = recusaDeExclusao(efeito?.acao);
  if (excluida) throw excluida;
  const { vigente } = vigenteConferido(raiz, efeito.arco, efeito.envelopeSha256, lerLog(raiz, efeito.arco));
  avaliarEfeito(vigente.conteudo, efeito, quando);
  return { ok: true, arco: efeito.arco, versao: vigente.versao, envelopeSha256: vigente.envelopeSha256,
    acao: efeito.acao, repositorio: efeito.repositorio, branch: efeito.branch, conferidoEm: quando, fim: vigente.conteudo.janela.fim };
}

/**
 * A cadeia comum da conferência antes de um efeito (N1) e antes de um despacho (N2), na ordem da N1: cauda incompleta,
 * linha adulterada, revogação, falta de autorização, recibo do dono que não confere ou não pode ser reconferido,
 * conteúdo que diverge do hash e hash diferente do vigente. Relê só o que já foi lido do disco.
 */
function vigenteConferido(raiz: string, arco: string, envelopeSha256: unknown, log: LogDoArco): { d: Derivado; vigente: Proposta } {
  // Cauda sem quebra pode ser a revogação que está sendo gravada: na dúvida, nenhum efeito passa.
  if (!log.terminaEmQuebra) throw adulterado('linha incompleta no fim do log (gravação abortada ou em curso); repita a conferência');
  const d = derivar(log.linhas);
  if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', `arco ${arco} revogado pelo dono`);
  if (!d.autorizacao) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `arco ${arco} sem envelope autorizado`);
  // RM-058 N6 (D2): encerrado é terminal como o revogado; reserva devolvida depois do teto não o reabre.
  if (d.encerramento) {
    throw new RecusaDoArco('noctum.efeito.encerrado', `arco ${arco} encerrado (${d.encerramento.motivo}) em ${formatarDataHora(d.encerramento.em)}; ` +
      'nenhum despacho ou efeito novo passa, e o arco não reabre');
  }
  // A prova do dono é reconferida aqui, pelo recibo do canal, e não lida da linha do log (FX2 no gate).
  const prova = reciboConfere(raiz, arco, 'autorizar', d.autorizacao.envelopeSha256, d.autorizacao.versao, d.autorizacao.ingresso);
  if (prova === 'sem-verificador') {
    throw new RecusaDoArco('noctum.origem.sem-prova', 'a prova do dono não pode ser reconferida neste processo: falta a chave ou o verificador público do canal');
  }
  if (prova === 'falhou') throw adulterado('o recibo do ingresso que autorizou o envelope não confere');
  const vigente = d.propostas.get(d.autorizacao.versao)!;
  if (hashDoEnvelope(vigente.conteudo) !== d.autorizacao.envelopeSha256) throw adulterado('conteúdo vigente diverge do hash autorizado');
  if (envelopeSha256 !== d.autorizacao.envelopeSha256) {
    // Hash de uma emenda que o dono ainda não autorizou não é antigo: é envelope sem autorização.
    const naoAutorizado = d.ultima !== null && d.ultima.versao > d.autorizacao.versao && d.ultima.envelopeSha256 === envelopeSha256;
    throw new RecusaDoArco(naoAutorizado ? 'noctum.efeito.sem-autorizacao' : 'noctum.efeito.hash-antigo',
      `o envelope vigente é ${d.autorizacao.envelopeSha256}; o efeito trouxe ${String(envelopeSha256)}`);
  }
  return { d, vigente };
}

/** RM-058 N6 (D5 da ork-rm058n6): o consumo medido de um teto, na unidade dele, ou a lacuna que impede medir. */
export type ValorMedido = { unidade: Teto['unidade']; valor: number; tetoSuperior?: boolean } | { unidade: Teto['unidade']; lacuna: string };
/** O consumo medido dos três tetos de um despacho, lido fora do lock do arco (`medidoParaReserva`, em `noctum-medicao.ts`). */
export interface ConsumoMedidoDoDespacho { arco?: ValorMedido; conta?: ValorMedido; runtime?: ValorMedido }

/** O que o executor do arco pede para despachar, imediatamente antes do efeito (RM-058 N2). */
export interface PedidoDeDespacho {
  arco: string;
  /** O hash que o executor leu no início do passo. Diferente do vigente é hash antigo, como no efeito. */
  envelopeSha256: string;
  trabalho: string;
  thread: string | null;
  fase: Fase;
  runtime: string;
  conta: string;
  revisao: boolean;
  /** RM-058 N6: o consumo medido dos tetos que não estão em `sessoes`. Sem ele, esses tetos recusam (`sem-medicao`). */
  medido?: ConsumoMedidoDoDespacho;
}

export interface DespachoReservado {
  arco: string;
  /** O `seq` da reserva: o executor o devolve em `concluirDespacho`. */
  seq: number;
  versao: number;
  envelopeSha256: string;
  /** Quando a janela fecha. Nada prorroga este instante. */
  fim: string;
  consumo: ConsumoDoArco;
}

/** As fases que o arco da N2 nunca despacha: a entrega fica com a condutora (A2 do CHECK da ork-rm058n2). */
const FASES_DA_ENTREGA: readonly Fase[] = ['SHIP', 'MASTER'];

/** A thread é a do trabalho de pedido? O item dela mais o sha256 do pedido guardado na criação. Ilegível não é. */
function threadDoPedido(raiz: string, id: string, item: string, texto: string): boolean {
  try {
    const t = lerThread(raiz, id);
    return t.roadmap === item && pedidoDaThread(raiz, t)?.sha256 === shaDoPedido(texto);
  } catch { return false; }
}

/** As threads que já casam com o trabalho de pedido (o item mais o sha256 do pedido); `null` com thread ilegível. */
function threadsDoTrabalho(raiz: string, item: string, texto: string): string[] | null {
  const sha = shaDoPedido(texto);
  const achadas: string[] = [];
  for (const id of listarIds(raiz)) {
    let t: Thread;
    try { t = lerThread(raiz, id); } catch { return null; }
    if (t.roadmap === item && t.pedido?.sha256 === sha) achadas.push(id);
  }
  return achadas;
}

/**
 * D11 e D12 da ork-rm058n2: confere o envelope e reserva o despacho, as duas coisas sob o lock do arco, imediatamente
 * antes do efeito. A cadeia da N1 (`vigenteConferido`) mais a janela, o trabalho na lista `v2`, a conta e o runtime do
 * envelope e o orçamento: cada despacho reserva uma sessão no teto do arco e nos subtetos da conta e do runtime; teto em
 * outra unidade confere o consumo medido que o passo traz (`pedido.medido`, D5 da ork-rm058n6) e, sem ele ou com lacuna,
 * recusa (`sem-medicao`). O trabalho de pedido só despacha a thread que o arco abriu
 * para ele, e só abre uma pelo GOAL quando nenhuma casa ainda; SHIP e MASTER nunca saem do arco da N2. A revogação usa o
 * mesmo lock: ou ela vem antes e nada é reservado, ou vem depois e vale para o despacho seguinte.
 */
export function reservarDespacho(raiz: string, pedido: PedidoDeDespacho, quando = new Date().toISOString()): DespachoReservado {
  return comLockDoArco(raiz, pedido.arco, false, () => {
    const log = lerLog(raiz, pedido.arco);
    const { d, vigente } = vigenteConferido(raiz, pedido.arco, pedido.envelopeSha256, log);
    const c = vigente.conteudo;
    avaliarJanela(c, quando);
    const fora = (detalhe: string) => new RecusaDoArco('noctum.despacho.fora-do-envelope', detalhe);
    if (!envelopeComTrabalhos(c)) throw fora('o envelope vigente é v1, sem lista de trabalhos: só uma emenda v2 autorizada pelo dono despacha');
    const t = c.trabalhos.find(x => x.id === pedido.trabalho);
    if (!t) throw fora(`o trabalho ${String(pedido.trabalho)} não está na lista do envelope`);
    if (t.thread !== undefined && pedido.thread !== t.thread) throw fora(`o trabalho ${t.id} é a thread ${t.thread}, não ${String(pedido.thread)}`);
    // A2 do CHECK: a thread de um trabalho de pedido é a que o arco abriu para ele, nunca outra qualquer.
    if (t.pedido !== undefined && pedido.thread !== null && !threadDoPedido(raiz, pedido.thread, t.item, t.pedido)) {
      throw fora(`a thread ${String(pedido.thread)} não é a do trabalho ${t.id}: o vínculo é o item ${t.item} mais o sha256 do pedido do envelope`);
    }
    if (FASES_DA_ENTREGA.includes(pedido.fase)) {
      throw fora(`a fase ${String(pedido.fase)} é entrega: a N2 não despacha SHIP nem MASTER, que ficam com a condutora`);
    }
    // S3 da rodada 2: abrir a thread de um trabalho de pedido é pelo GOAL, e só quando nenhuma casa com ele ainda.
    if (t.pedido !== undefined && pedido.thread === null) {
      if (pedido.fase !== 'GOAL') throw fora(`o trabalho ${t.id} abre a thread pelo GOAL, não pelo ${String(pedido.fase)}`);
      const ja = threadsDoTrabalho(raiz, t.item, t.pedido);
      if (ja === null) throw fora(`há thread ilegível no projeto, e ela pode ser a do trabalho ${t.id}: abrir outra a duplicaria`);
      if (ja.length) throw fora(`o trabalho ${t.id} já tem a thread ${ja.join(', ')}: o despacho vai por ela`);
    }
    const tetoDoRuntime = c.orcamento.porRuntime.find(x => x.runtime === pedido.runtime)?.teto;
    if (!tetoDoRuntime || !c.capacidade.porRuntime.some(x => x.runtime === pedido.runtime)) {
      throw fora(`o runtime ${String(pedido.runtime)} não está no envelope`);
    }
    const tetoDaConta = c.orcamento.porConta.find(x => x.conta === pedido.conta)?.teto;
    if (!tetoDaConta || !c.capacidade.porConta.some(x => x.conta === pedido.conta)) {
      throw fora(`a conta ${String(pedido.conta)} não está no envelope`);
    }
    const consumo = consumoDe(d);
    const tetos: Array<[string, Teto, number, keyof ConsumoMedidoDoDespacho]> = [['do arco', c.orcamento.arco, consumo.arco, 'arco'],
      [`da conta ${pedido.conta}`, tetoDaConta, consumo.porConta[pedido.conta] ?? 0, 'conta'],
      [`do runtime ${pedido.runtime}`, tetoDoRuntime, consumo.porRuntime[pedido.runtime] ?? 0, 'runtime']];
    for (const [nome, teto, usado, chave] of tetos) {
      if (teto.unidade !== 'sessoes') {
        // RM-058 N6 (D5): fora de `sessoes`, o consumo medido fora do lock decide; sem medida, ou com lacuna, recusa.
        const medido = pedido.medido?.[chave];
        if (!medido || medido.unidade !== teto.unidade || 'lacuna' in medido || !Number.isFinite(medido.valor)) {
          throw new RecusaDoArco('noctum.orcamento.sem-medicao', `o teto ${nome} está em ${teto.unidade}, e o consumo nessa unidade não foi ` +
            `medido para esta reserva${medido && 'lacuna' in medido ? ` (${medido.lacuna})` : ''}: sem medir, o teto não é garantido, e ` +
            'consumo desconhecido nunca vale zero');
        }
        if (medido.valor >= teto.valor) {
          const valor = teto.unidade === 'percentual-da-cota' ? `${Math.round(medido.valor * 10) / 10}%` : String(medido.valor);
          throw new RecusaDoArco('noctum.orcamento.esgotado', `o teto ${nome} é de ${teto.valor} ${teto.unidade} e o consumo medido é ` +
            (medido.tetoSuperior ? `até ${valor} (teto superior: inclui uso de fora do arco)` : valor));
        }
        continue;
      }
      if (usado + 1 > teto.valor) {
        throw new RecusaDoArco('noctum.orcamento.esgotado', `o teto ${nome} é de ${teto.valor} sessoes e ${usado} já foram reservadas`);
      }
    }
    const reserva: ReservaDeDespacho = { trabalho: t.id, thread: pedido.thread, fase: pedido.fase, runtime: pedido.runtime,
      conta: pedido.conta, revisao: pedido.revisao === true, versao: vigente.versao, envelopeSha256: vigente.envelopeSha256 };
    anexar(raiz, pedido.arco, log, { tipo: 'despacho_reservado', reserva }, quando);
    const seq = log.linhas.length + 1;
    const estado = confirmado(raiz, pedido.arco, quando, e => e.despachos.some(x => x.seq === seq && x.desfecho === 'pendente'), 'reserva do despacho');
    return { arco: pedido.arco, seq, versao: vigente.versao, envelopeSha256: vigente.envelopeSha256, fim: c.janela.fim, consumo: estado.consumo };
  }, true);
}

/**
 * RM-058 N6 (D2 e D8 da ork-rm058n6): fecha o arco, uma vez, sob o lock do arco (espera como a revogação, porque é ato de
 * segurança). Depois disto `vigenteConferido` recusa todo despacho e efeito com `noctum.efeito.encerrado`, a emenda é
 * recusada e a fila encerra. O segundo fechamento devolve o primeiro. Só fecha arco que o dono autorizou; o revogado
 * também fecha, para o registro do fechamento (a situação continua `revogado`).
 */
export function encerrarArco(raiz: string, arco: string, fechamento: { motivo: MotivoDeEncerramento; detalhe: string },
  quando = new Date().toISOString()): EstadoDoArco {
  if (!(MOTIVOS_DE_ENCERRAMENTO as readonly string[]).includes(fechamento?.motivo)) {
    throw new RecusaDoArco('noctum.envelope.invalido', `motivo de encerramento fora de ${MOTIVOS_DE_ENCERRAMENTO.join(', ')}`);
  }
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    if (!d.autorizacao) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `arco ${arco} nunca autorizado não encerra`);
    if (d.encerramento) return estadoDe(arco, d, quando);
    anexar(raiz, arco, log, { tipo: 'encerrado', motivo: fechamento.motivo, detalhe: String(fechamento.detalhe ?? '').slice(0, 500) }, quando);
    return confirmado(raiz, arco, quando, e => e.encerramento !== null, 'encerramento');
  }, true);
}

/**
 * O desfecho da reserva, uma vez só: o despacho que abriu sessão (ou que a sessão em andamento já atendia), ou o que o
 * núcleo recusou, que devolve a sessão ao orçamento. Vale também depois de revogação ou expiração: é a contabilidade do
 * que já estava em voo, não um efeito novo.
 */
export function concluirDespacho(raiz: string, arco: string, seq: number,
  desfecho: { thread: string; sessionId: string | null; idempotente: boolean } | { motivo: string }, quando = new Date().toISOString()): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const r = d.despachos.get(seq);
    if (!r) throw new RecusaDoArco('noctum.envelope.invalido', `reserva ${seq} inexistente neste arco`);
    if (r.desfecho !== 'pendente') return estadoDe(arco, d, quando);
    const evento: EventoDoArco = 'motivo' in desfecho
      ? { tipo: 'despacho_recusado', reserva: seq, motivo: String(desfecho.motivo).slice(0, 200) }
      : { tipo: 'despacho_concluido', reserva: seq, thread: desfecho.thread, sessionId: desfecho.sessionId, idempotente: desfecho.idempotente };
    anexar(raiz, arco, log, evento, quando);
    return confirmado(raiz, arco, quando, e => e.despachos.some(x => x.seq === seq && x.desfecho !== 'pendente'), 'conclusão do despacho');
  }, true);
}

/**
 * RM-058 N3 (D6 da ork-rm058n3): as versões do envelope que o dono autorizou neste arco, na ordem do log. O ramo de
 * coordenação guarda registros assinados sob versões anteriores (a vaga tomada antes de uma emenda continua contando), e a
 * leitura confere cada um com as máquinas da versão que ele diz. A vigente é a última; o recibo do dono continua conferido
 * por `vigenteConferido`, antes de cada efeito.
 */
export function versoesAutorizadas(raiz: string, arco: string):
  Array<{ versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope; autorizadoEm: string }> {
  const log = lerLog(raiz, arco), d = derivar(log.linhas);
  const vistas = new Set<number>();
  const versoes: Array<{ versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope; autorizadoEm: string }> = [];
  for (const { evento: e } of log.linhas) {
    if (e.tipo !== 'autorizado' || vistas.has(e.versao)) continue;
    vistas.add(e.versao);
    const p = d.propostas.get(e.versao)!;
    // RM-058, integração (T8, D12): o instante do ingresso de cada autorização, que o aceite do piloto lê.
    versoes.push({ versao: p.versao, envelopeSha256: p.envelopeSha256, conteudo: p.conteudo, autorizadoEm: e.ingresso.recebidoEm });
  }
  return versoes;
}

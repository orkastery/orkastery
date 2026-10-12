/**
 * RM-058, fatia N1: o estado do arco #Noctum e o ingresso do envelope.
 *
 * O estado mora num log append-only em `.orkastery/noctum/arcos/<arco>/arco.jsonl`, na raiz do
 * estado. Cada linha leva o sha256 da anterior e um MAC de subchave derivada da chave local do
 * núcleo (`.orkastery/private`, a mesma fronteira do recibo local do HITL), e linha trocada reprova
 * toda leitura. Essa chave fica legível para qualquer processo com o mesmo usuário do sistema, que é
 * o caso dos agentes da fábrica: o MAC do log não os impede de forjar uma linha. O que eles não forjam
 * é o recibo do canal que a autorização assinada deixa e que a conferência antes do efeito relê. A
 * autorização pelo diálogo do host não tem esse recibo e fica na fronteira do recibo local do HITL.
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
import { chaveDoIngresso } from './hitl-ingress-receipt';
import { LETRAS_DE_ALTERNATIVA, LetraDeAlternativa, MAXIMO_DE_ALTERNATIVAS_DE_CONDUCAO,
  MINIMO_DE_ALTERNATIVAS_DE_CONDUCAO, TETOS_HITL_V2 } from './hitl-contract';
import { comLockInspecionavel } from './hitl-lock';
import { chaveLocal } from './hitl-local-receipt';
import { nativeContextSchema, nativeKey } from './hitl-native';
import { publicBindingMatches, publicReceiptAuthority, signPublicReceipt, verifyPublicReceipt } from './hitl-public-receipt';
import { avaliarEfeito, canonico, ConteudoDoEnvelope, hashDoEnvelope, ID_DO_ARCO, PedidoDeEfeito, RecusaDoArco,
  recusaDeExclusao, resumoDoEnvelope, validarPedidoDeAbertura } from './noctum-envelope';

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

/** O que o envelope assinado provou. O corpo assinado nunca entra: só o hash da prova. */
type IngressoAssinado =
  | { origem: 'telegram'; canal: string | null; conta: string | null; por: string; mensagem: string;
    recebidoEm: string; recibo: string }
  | { origem: 'native'; canal: string | null; conta: string | null; por: string; mensagem: string;
    recebidoEm: string; recibo: string; native: Record<string, string> };

/**
 * Quem autorizou ou revogou, e por qual ingresso. O envelope assinado aponta o recibo durável que a
 * conferência antes do efeito relê; o diálogo do host fica atestado pela linha do log, com a chave
 * local, como o recibo local do HITL.
 */
export type IngressoDoDono =
  | (IngressoAssinado & { evidencia: string; evidenciaSha256: string })
  | { origem: 'mcp-local'; host: 'claude-code' | 'codex'; conexao: string; solicitacao: string; por: string;
    recebidoEm: string; respostaSha256: string };

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

type EventoDoArco =
  | { tipo: 'proposto'; versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope; prazo: string }
  | { tipo: 'autorizado'; versao: number; envelopeSha256: string; ingresso: IngressoDoDono }
  | { tipo: 'revogado'; ingresso: IngressoDoDono }
  | { tipo: 'decisao_enfileirada'; decisao: DecisaoEmLote };

interface DadosDaLinha {
  contrato: typeof CONTRATO_ARCO;
  arco: string;
  seq: number;
  /** sha256 do texto da linha anterior; a primeira aponta para zeros. */
  anterior: string;
  em: string;
  evento: EventoDoArco;
}

export type SituacaoDoArco = 'proposto' | 'agendado' | 'vigente' | 'expirado' | 'revogado';

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
  propostaPendente: { versao: number; envelopeSha256: string; prazo: string } | null;
  decisoes: DecisaoEmLote[];
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
  let bruto: string;
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
        throw adulterado('log do arco não é arquivo privado do núcleo');
      }
      bruto = fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { linhas: [], ultimaLinha: null, terminaEmQuebra: true, bytesCompletos: 0, bytesLidos: 0 };
    }
    if (e instanceof RecusaDoArco) throw e;
    throw adulterado('log do arco ilegível');
  }
  const completas = bruto.slice(0, bruto.lastIndexOf('\n') + 1);
  const textos = completas.split('\n').slice(0, -1);
  const tamanhos = { terminaEmQuebra: completas.length === bruto.length, bytesCompletos: Buffer.byteLength(completas),
    bytesLidos: Buffer.byteLength(bruto) };
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

function comLockDoArco<T>(raiz: string, arco: string, criar: boolean, executar: () => T): T {
  const dir = dirDoArco(raiz, arco);
  if (criar) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  else if (!fs.existsSync(dir)) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `arco ${arco} sem proposta`);
  for (let tentativa = 1; ; tentativa++) {
    try { return comLockInspecionavel(dir, 'noctum-arco', executar); }
    catch (e) {
      // Só a disputa pelo kernel espera; qualquer outra falha, inclusive a recusa de dentro, sobe na hora.
      if (tentativa >= TENTATIVAS_DO_LOCK || !(e instanceof Error) || !e.message.startsWith('HITL ocupado; exclusão do kernel')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

interface Proposta { versao: number; envelopeSha256: string; conteudo: ConteudoDoEnvelope; prazo: string }
interface Derivado {
  propostas: Map<number, Proposta>;
  ultima: Proposta | null;
  autorizacao: { versao: number; envelopeSha256: string; ingresso: IngressoDoDono } | null;
  revogacao: IngressoDoDono | null;
  decisoes: DecisaoEmLote[];
  /** Mensagens e solicitações que já provaram um ato: nenhuma prova serve duas vezes. */
  usadas: Set<string>;
}

function derivar(linhas: DadosDaLinha[]): Derivado {
  const d: Derivado = { propostas: new Map(), ultima: null, autorizacao: null, revogacao: null, decisoes: [], usadas: new Set() };
  const usar = (i: IngressoDoDono) => d.usadas.add(i.origem === 'mcp-local' ? `mcp-local:${i.solicitacao}` : `${i.origem}:${i.mensagem}`);
  for (const { evento: e } of linhas) {
    if (e.tipo === 'proposto') {
      const p = { versao: e.versao, envelopeSha256: e.envelopeSha256, conteudo: e.conteudo, prazo: e.prazo };
      if (hashDoEnvelope(p.conteudo) !== p.envelopeSha256) throw adulterado(`proposta ${p.versao} com hash que não confere`);
      d.propostas.set(p.versao, p);
      d.ultima = p;
    } else if (e.tipo === 'autorizado') {
      if (d.propostas.get(e.versao)?.envelopeSha256 !== e.envelopeSha256) throw adulterado(`autorização da versão ${e.versao} sem proposta`);
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
  const janela = d.propostas.get(d.autorizacao.versao)!.conteudo.janela;
  const agora = Date.parse(quando);
  if (agora < Date.parse(janela.inicio)) return 'agendado';
  return agora >= Date.parse(janela.fim) ? 'expirado' : 'vigente';
}

function estadoDe(arco: string, d: Derivado, quando: string): EstadoDoArco {
  const vigente = d.autorizacao ? d.propostas.get(d.autorizacao.versao)! : null;
  const pendente = d.ultima && !d.revogacao && d.ultima.versao !== d.autorizacao?.versao &&
    Date.parse(quando) < Date.parse(d.ultima.prazo) ? d.ultima : null;
  return { contrato: CONTRATO_ARCO, arco, situacao: situacao(d, quando), versao: vigente?.versao ?? null,
    envelopeSha256: vigente?.envelopeSha256 ?? null, conteudo: vigente?.conteudo ?? null,
    autorizadoPor: d.autorizacao?.ingresso ?? null, revogadoPor: d.revogacao,
    propostaPendente: pendente ? { versao: pendente.versao, envelopeSha256: pendente.envelopeSha256, prazo: pendente.prazo } : null,
    decisoes: d.decisoes };
}

/**
 * Grava a proposta de um envelope. Não autoriza nada: quem autoriza é o dono, pelo ingresso.
 *
 * A mesma proposta repetida devolve a que está pendente. Proposta nova sobre um envelope já
 * autorizado é emenda: o vigente continua valendo até o dono autorizar a nova versão.
 */
export function proporEnvelope(raiz: string, pedido: unknown, quando = new Date().toISOString()):
  { arco: string; versao: number; envelopeSha256: string; prazo: string; resumo: string[] } {
  const conteudo = validarPedidoDeAbertura(pedido);
  const envelopeSha256 = hashDoEnvelope(conteudo);
  if (!(Date.parse(quando) < Date.parse(conteudo.janela.fim))) {
    throw new RecusaDoArco('noctum.envelope.invalido', `a janela pedida terminou em ${conteudo.janela.fim}`);
  }
  return comLockDoArco(raiz, conteudo.arco, true, () => {
    const log = lerLog(raiz, conteudo.arco), d = derivar(log.linhas);
    if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', 'arco revogado é terminal; abra outro arco');
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
    anexar(raiz, conteudo.arco, log, { tipo: 'proposto', versao, envelopeSha256, conteudo, prazo }, quando);
    return { arco: conteudo.arco, versao, envelopeSha256, prazo, resumo };
  });
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
  if (conteudo.janela.inicio !== janela.inicio || Date.parse(conteudo.janela.fim) > Date.parse(janela.fim)) {
    throw new RecusaDoArco('noctum.envelope.invalido', 'emenda mantém o início e não prorroga o fim do envelope autorizado');
  }
}

/** A proposta que o dono pode autorizar agora, ou a recusa tipada de por que não. */
function propostaAutorizavel(d: Derivado, envelopeSha256: string, quando: string): Proposta {
  if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', 'arco revogado é terminal; abra outro arco');
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
function dadosDoRecibo(arco: string, ato: Ato, envelopeSha256: string | null, i: IngressoAssinado): Record<string, unknown> {
  return { contrato: 'ork.noctum-ingresso/v1', arco, endereco: enderecoDoArco(arco), ato, envelopeSha256,
    origem: i.origem, canal: i.canal, conta: i.conta, por: i.por, mensagem: i.mensagem, recebidoEm: i.recebidoEm,
    recibo: i.recibo, ...(i.origem === 'native' ? { native: i.native } : {}) };
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
function gravarRecibo(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, i: IngressoAssinado):
  { evidencia: string; evidenciaSha256: string } {
  const dir = path.join(dirDoArco(raiz, arco), 'ingresso');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nome = nomeDoRecibo(i), file = path.join(dir, nome);
  const canal: Canal | null = i.canal === null ? null : parseCanal(i.canal);
  const dados = dadosDoRecibo(arco, ato, envelopeSha256, i);
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
function reciboConfere(raiz: string, arco: string, ato: Ato, envelopeSha256: string | null, i: IngressoDoDono):
  'ok' | 'sem-verificador' | 'falhou' {
  if (i.origem === 'mcp-local') return 'ok';
  try {
    const nome = nomeDoRecibo(i);
    if (i.evidencia !== `.orkastery/noctum/arcos/${arco}/ingresso/${nome}`) return 'falhou';
    const file = path.join(dirDoArco(raiz, arco), 'ingresso', nome);
    const bytes = lerPrivado(file);
    if (sha(bytes) !== i.evidenciaSha256) return 'falhou';
    const v = JSON.parse(bytes.toString('utf8')) as unknown;
    const { evidencia: _evidencia, evidenciaSha256: _sha, ...assinado } = i;
    if (!objeto(v) || Object.keys(v).sort().join(',') !== 'assinatura,dados' || typeof v.assinatura !== 'string' ||
        !/^[a-f0-9]{64}$/.test(v.assinatura) || canonico(v.dados) !== canonico(dadosDoRecibo(arco, ato, envelopeSha256, assinado))) {
      return 'falhou';
    }
    const native = i.origem === 'native';
    const canal: Canal | null = i.canal === null ? null : parseCanal(i.canal);
    if (i.canal !== null && canal !== i.canal) return 'falhou';
    const variavel = native ? `ORK_HITL_NATIVE_KEY_${String(canal).toUpperCase()}` : variavelDaChaveDoCanal(canal);
    if (process.env[variavel] !== undefined) {
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

/** Autoriza a proposta pendente pelo envelope assinado do dono. Sem prova, nada muda. */
export function autorizarPeloIngresso(raiz: string, arco: string, envelopeSha256: string, envelope: RespostaHumana,
  quando = new Date().toISOString()): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const versao = d.ultima?.envelopeSha256 === envelopeSha256 ? d.ultima.versao : 0;
    const provado = provarEnvelope(arco, textoDeAutorizacao(envelopeSha256), envelope, quando,
      { pedidoSha256: envelopeSha256, contexto: contextoDoArco(arco, versao), prazo: d.ultima?.prazo });
    // A mesma autorização repetida, pela mesma mensagem, devolve o que já vale.
    if (d.autorizacao?.envelopeSha256 === envelopeSha256 && !d.revogacao) return estadoDe(arco, d, quando);
    if (d.usadas.has(`${provado.origem}:${provado.mensagem}`)) throw semProva('esta mensagem já provou outro ato neste arco');
    const proposta = propostaAutorizavel(d, envelopeSha256, quando);
    const ingresso = { ...provado, ...gravarRecibo(raiz, arco, 'autorizar', envelopeSha256, provado) };
    anexar(raiz, arco, log, { tipo: 'autorizado', versao: proposta.versao, envelopeSha256, ingresso }, quando);
    return confirmado(raiz, arco, quando, e => e.envelopeSha256 === envelopeSha256 && e.situacao !== 'revogado', 'autorização');
  });
}

/** Revoga o arco pelo envelope assinado do dono. Terminal: nenhum efeito passa depois (D7). */
export function revogarPeloIngresso(raiz: string, arco: string, envelope: RespostaHumana,
  quando = new Date().toISOString()): EstadoDoArco {
  return comLockDoArco(raiz, arco, false, () => {
    const log = lerLog(raiz, arco), d = derivar(log.linhas);
    const provado = provarEnvelope(arco, TEXTO_DE_REVOGACAO, envelope, quando,
      { pedidoSha256: hashDaRevogacao(arco), contexto: contextoDoArco(arco, 0) });
    if (d.revogacao) return estadoDe(arco, d, quando);
    if (d.usadas.has(`${provado.origem}:${provado.mensagem}`)) throw semProva('esta mensagem já provou outro ato neste arco');
    const ingresso = { ...provado, ...gravarRecibo(raiz, arco, 'revogar', null, provado) };
    anexar(raiz, arco, log, { tipo: 'revogado', ingresso }, quando);
    return confirmado(raiz, arco, quando, e => e.situacao === 'revogado', 'revogação');
  });
}

/** O que o diálogo nativo do host mostra ao dono. Só identificadores e o resumo; nenhuma resposta. */
export interface ApresentacaoDoArco {
  contrato: 'ork.noctum-dialogo/v1';
  arco: string;
  ato: 'autorizar' | 'revogar';
  envelopeSha256: string | null;
  resumo: string[];
  /** A primeira opção executa o ato; a segunda não faz nada. */
  opcoes: [string, string];
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
      const a: ApresentacaoDoArco = { contrato: 'ork.noctum-dialogo/v1', arco, ato: 'autorizar', envelopeSha256,
        resumo: resumoDoEnvelope(antes.conteudo, envelopeSha256), opcoes: ['Autorizar este envelope', 'Não autorizar'] };
      const { requestId, recebidoEm } = await perguntar(a, antes.prazo);
      // O mundo pode ter mudado enquanto o dono lia: tudo é conferido de novo sob o lock.
      return comLockDoArco(raiz, arco, false, () => {
        const log = lerLog(raiz, arco), d = derivar(log.linhas);
        if (d.autorizacao?.envelopeSha256 === envelopeSha256 && !d.revogacao) return estadoDe(arco, d, recebidoEm);
        const proposta = propostaAutorizavel(d, envelopeSha256, recebidoEm);
        anexar(raiz, arco, log, { tipo: 'autorizado', versao: proposta.versao, envelopeSha256,
          ingresso: ingressoDoDialogo(requestId, recebidoEm, a.opcoes[0]) }, recebidoEm);
        return confirmado(raiz, arco, recebidoEm, e => e.envelopeSha256 === envelopeSha256 && e.situacao !== 'revogado', 'autorização');
      });
    },
    async revogar(arco: string): Promise<EstadoDoArco> {
      const atual = comLockDoArco(raiz, arco, false, () => estadoDe(arco, derivar(lerLog(raiz, arco).linhas), new Date().toISOString()));
      const a: ApresentacaoDoArco = { contrato: 'ork.noctum-dialogo/v1', arco, ato: 'revogar', envelopeSha256: atual.envelopeSha256,
        resumo: [`Revogar o arco ${arco}: nenhum efeito novo passa depois disto, e o arco não reabre`],
        opcoes: ['Revogar o arco', 'Manter o arco'] };
      const { requestId, recebidoEm } = await perguntar(a, undefined);
      return comLockDoArco(raiz, arco, false, () => {
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
  const log = lerLog(raiz, efeito.arco);
  // Cauda sem quebra pode ser a revogação que está sendo gravada: na dúvida, nenhum efeito passa.
  if (!log.terminaEmQuebra) throw adulterado('linha incompleta no fim do log (gravação abortada ou em curso); repita a conferência');
  const d = derivar(log.linhas);
  if (d.revogacao) throw new RecusaDoArco('noctum.efeito.revogado', `arco ${efeito.arco} revogado pelo dono`);
  if (!d.autorizacao) throw new RecusaDoArco('noctum.efeito.sem-autorizacao', `arco ${efeito.arco} sem envelope autorizado`);
  // A prova do dono é reconferida aqui, pelo recibo do canal, e não lida da linha do log (FX2 no gate).
  const prova = reciboConfere(raiz, efeito.arco, 'autorizar', d.autorizacao.envelopeSha256, d.autorizacao.ingresso);
  if (prova === 'sem-verificador') {
    throw new RecusaDoArco('noctum.origem.sem-prova', 'a prova do dono não pode ser reconferida neste processo: falta a chave ou o verificador público do canal');
  }
  if (prova === 'falhou') throw adulterado('o recibo do ingresso que autorizou o envelope não confere');
  const vigente = d.propostas.get(d.autorizacao.versao)!;
  if (hashDoEnvelope(vigente.conteudo) !== d.autorizacao.envelopeSha256) throw adulterado('conteúdo vigente diverge do hash autorizado');
  if (efeito.envelopeSha256 !== d.autorizacao.envelopeSha256) {
    // Hash de uma emenda que o dono ainda não autorizou não é antigo: é envelope sem autorização.
    const naoAutorizado = d.ultima !== null && d.ultima.versao > d.autorizacao.versao && d.ultima.envelopeSha256 === efeito.envelopeSha256;
    throw new RecusaDoArco(naoAutorizado ? 'noctum.efeito.sem-autorizacao' : 'noctum.efeito.hash-antigo',
      `o envelope vigente é ${d.autorizacao.envelopeSha256}; o efeito trouxe ${String(efeito.envelopeSha256)}`);
  }
  avaliarEfeito(vigente.conteudo, efeito, quando);
  return { ok: true, arco: efeito.arco, versao: vigente.versao, envelopeSha256: d.autorizacao.envelopeSha256,
    acao: efeito.acao, repositorio: efeito.repositorio, branch: efeito.branch, conferidoEm: quando, fim: vigente.conteudo.janela.fim };
}

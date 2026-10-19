/**
 * RM-058, fatia N3 (D3, D4 e D8 a D12 da ork-rm058n3): a coordenação entre as máquinas de um arco #Noctum.
 *
 * Tudo aqui é regra sobre o ramo de coordenação que o transporte (`noctum-transporte.ts`) lê conferido e grava por troca
 * atômica. O estado é derivado dos registros a cada leitura, nada fica em memória:
 *
 * - **autoridade por geração** (D8, D15): a primeira máquina que assume fica com a geração 1; a troca vem por cessão
 *   assinada da autoridade vigente ou por tomada forçada, com motivo, quando ela não dá sinal há 15 min ou saiu do
 *   envelope. A geração nova sela os registros da anterior, e o que a autoridade vencida gravar depois reprova a leitura;
 * - **ordens, recibos e cancelamento** (D9, D10): uma ordem viva por trabalho, emitida só pela autoridade vigente, com a
 *   reserva do item lida agora (D19); o executor não age antes do aceite gravado no remoto, e o aceite e o cancelamento
 *   disputam a mesma troca atômica;
 * - **transferência só com prova** (D4, D20): cancelada antes do aceite, recusada, concluída ou encerrada pelo executor, a
 *   ordem libera o trabalho; aceita e cancelada sem o fim confirmado, o trabalho fica isolado. Falta de sinal nunca solta
 *   ordem, vaga nem reserva; a vez de integrar de quem não dá sinal é abandonada pela autoridade, sem transferir nada;
 * - **revogação em todas as máquinas** (D21): a revogação do dono numa máquina vai ao ramo, e nada novo começa em nenhuma;
 * - **vagas e orçamento somando as máquinas** (D3, D12): cada despacho toma uma vaga global, que é também o consumo do
 *   arco, da conta e do runtime; a recusa antes do lançamento devolve. A conta vai ao remoto pela posição dela na lista do
 *   envelope (D14), nunca pelo nome;
 * - **reserva do item** (D11, D19): a da RM-047, tomada depois do aceite, sem forçar, e revalidada com leitura nova; o
 *   motivo gravado leva só o item, nunca quem reservou.
 *
 * Ninguém chama estas funções ainda: o passo da máquina (`noctum-maquinas.ts`) as junta, e quem chama o passo é o vigia
 * da N4. A N4 usa a mesma interface para a retomada em outra máquina (seção N3 da página da RM-058).
 */
import { lerArco } from './noctum-arco';
import { ConteudoDoEnvelope, envelopeMultimaquina, ID_DO_TRABALHO, MaquinaDoArco, RecusaDoArco, Teto, Trabalho } from './noctum-envelope';
import { CADENCIA_MS } from './noctum-fila';
import { createHash } from 'node:crypto';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import {
  CamposDoRegistro, CHAVE_DO_DESTINO, DadosDoRegistro, euNaVersaoVigente, gravarNoRamo, ID_DA_ORDEM, ID_DA_VAGA, identidadeDaMaquina, LeituraDoRamo, lerRamo,
  NOME_DE_MAQUINA, OpcoesDoTransporte, RECIBOS, ResultadoDaGravacao, TipoDeRecibo, VersaoDoEnvelope,
} from './noctum-transporte';
import { listarReservas, pegarItem, quemSouEu, soltarItem } from './roadmap-reservas';

/** D8: a batida de outra máquina vence depois de três cadências do vigia (D3 do dono), 15 min. */
export const BATIDA_VENCIDA_MS = 3 * CADENCIA_MS;
/** A nota da reserva da RM-047 que o arco toma: é por ela que a reconciliação sabe qual reserva é do arco. */
export const notaDaReserva = (arco: string): string => `noctum:${arco}`;

export type ModoDaAutoridade = 'primeira' | 'cessao' | 'forcada';
export type EstadoDaOrdem = 'emitida' | 'aceita' | 'isolada' | 'cancelada-antes' | 'recusada' | 'concluida' | 'encerrada';
export type ResultadoDaConclusao = 'entregue' | 'encerrado-sem-entrega';
export type EstadoDoTrabalhoNaRede = 'livre' | 'ordenado' | 'em-execucao' | 'isolado' | 'entregue' | 'encerrado';
/** `sem-prova`: a fonte chegou à base por um merge fora da base provada (B-R2A-1 da rodada 2); o trabalho espera a inspeção. */
export type DesfechoDaVez = 'entregue' | 'invalidado' | 'desistiu' | 'abandonada' | 'sem-prova';
const DESFECHOS: readonly DesfechoDaVez[] = ['entregue', 'invalidado', 'desistiu', 'abandonada', 'sem-prova'];

const VIVAS: readonly EstadoDaOrdem[] = ['emitida', 'aceita', 'isolada'];
export const ordemViva = (o: { estado: EstadoDaOrdem }): boolean => VIVAS.includes(o.estado);

export interface AutoridadeDerivada { geracao: number; maquina: string; desde: string; modo: ModoDaAutoridade; motivo: string }

export interface OrdemDerivada {
  ordem: string;
  trabalho: string;
  item: string;
  /** O executor. */
  maquina: string;
  /** A geração da autoridade que emitiu. */
  geracao: number;
  n: number;
  envelopeSha256: string;
  emitidaEm: string;
  cancelada: { em: string; motivo: string; por: string } | null;
  recibos: Partial<Record<TipoDeRecibo, DadosDoRegistro>>;
  estado: EstadoDaOrdem;
  resultado: ResultadoDaConclusao | null;
}

export interface SituacaoDoTrabalho {
  trabalho: string;
  estado: EstadoDoTrabalhoNaRede;
  /** A ordem mais nova do trabalho, quando há uma. */
  ordem: OrdemDerivada | null;
  entregueEm: string | null;
}

export interface VagaDerivada {
  vaga: string;
  maquina: string;
  /** O nome da conta, resolvido pela versão do envelope do registro. */
  conta: string;
  runtime: string;
  ordem: string;
  trabalho: string;
  /** O `seq` da reserva local do despacho, no log do arco da máquina que segura. */
  reserva: number;
  /** A chave que tomou a vaga, pela versão do envelope do registro (G8-6): só a raiz dela tem o despacho no log local. */
  chave: string;
  desde: string;
  solta: { em: string; consumiu: boolean; motivo: string } | null;
}

export interface CandidatoDeIntegracao { branch: string; fonte: string; base: string; provas: string }

export interface VezDerivada {
  chave: string;
  n: number;
  maquina: string;
  ordem: string;
  trabalho: string;
  destino: { repositorio: string; base: string };
  candidato: CandidatoDeIntegracao;
  desde: string;
  /** O fim da vez: pela máquina que a tomou ou, `abandonada`, pela autoridade, quando ela não dá sinal (A7 da revisão). */
  fim: { em: string; desfecho: DesfechoDaVez; motivo: string; merge: string | null; por: string } | null;
}

export interface EstadoDaCoordenacao {
  arco: string;
  remoto: string;
  ponta: string | null;
  lidoEm: string;
  versoes: VersaoDoEnvelope[];
  /** A versão vigente nesta máquina: a última que o dono autorizou aqui. */
  vigente: VersaoDoEnvelope;
  autoridade: AutoridadeDerivada | null;
  autoridades: AutoridadeDerivada[];
  cessoes: Map<number, { para: string; em: string; motivo: string }>;
  ordens: Map<string, OrdemDerivada>;
  /** A situação de cada trabalho do envelope vigente. */
  trabalhos: Map<string, SituacaoDoTrabalho>;
  vagas: VagaDerivada[];
  /** O consumo somando as máquinas: vagas ativas e soltas que consumiram (D3). */
  consumo: { arco: number; porConta: Record<string, number>; porRuntime: Record<string, number> };
  vezes: Map<string, VezDerivada[]>;
  entregas: Map<string, DadosDoRegistro>;
  /** A última batida de cada máquina. */
  batidas: Map<string, string>;
  /**
   * O último sinal de vida de cada máquina: o `em` do registro mais novo que ela assinou (batida, autoridade, ordem, recibo,
   * vaga ou vez). É por ele que a batida vence (S2 da revisão: a autoridade recém-assumida não parece morta).
   */
  sinais: Map<string, string>;
  /** A revogação do arco gravada por uma máquina dele (A8 da revisão): vale em todas, e nada novo começa. */
  revogada: { por: string; em: string; motivo: string } | null;
  /** Os ids que a autoridade de cada geração assinou (ordens, cancelamentos e abandonos), para o selo da geração seguinte. */
  daGeracao: Map<number, string[]>;
}

export type OpcoesDaCoordenacao = OpcoesDoTransporte;

const adulterado = (detalhe: string) => new RecusaDoArco('noctum.coordenacao.adulterado', `${detalhe}; o ramo de coordenação exige inspeção`);
const recusa = (motivo: ConstructorParameters<typeof RecusaDoArco>[0], detalhe: string) => new RecusaDoArco(motivo, detalhe);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inteiro = (v: unknown, minimo = 1): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= minimo;
const linha = (v: unknown, teto = 300): v is string => typeof v === 'string' && v.length <= teto && !/[\r\n]/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v);

/**
 * A3 da rodada 3: o motivo de quem chama a interface vai ao ramo de coordenação, que mora no remoto do projeto e pode ser
 * público. Ele vai numa linha de até 300 caracteres e sem caminho absoluto, e-mail, id de sessão nem segredo nomeado; quem
 * chama manda um motivo tipado, como os que a N3 grava (`noctum.*` e um detalhe só com ids).
 */
const FORA_DO_RAMO: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[\s"'(=:,;])~?\/[\w.-]/, 'um caminho absoluto'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'um e-mail'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'um id de sessão'],
  [/\b(token|secret|senha|password|passwd|api[_-]?key)\b\s*[=:]|\bbearer\s+\S{8,}/i, 'um segredo'],
];

export function motivoPublico(motivo: unknown, oQue: string): string {
  const m = String(motivo ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  if (!m) throw recusa('noctum.envelope.invalido', `${oQue} exige motivo`);
  const fora = FORA_DO_RAMO.find(([re]) => re.test(m));
  if (fora) {
    throw recusa('noctum.envelope.invalido', `${oQue}: o motivo vai ao ramo de coordenação, que pode ser público, e traz ${fora[1]}; ` +
      'mande um motivo tipado, só com ids');
  }
  return m;
}
const COMUNS = ['contrato', 'tipo', 'arco', 'envelopeSha256', 'por', 'em'];

/** A chave do destino de integração no ramo: o repositório sem caixa e a base. */
export function chaveDoDestino(destino: { repositorio: string; base: string }): string {
  return createHash('sha256').update(`ork.noctum-destino/v1|${destino.repositorio.toLowerCase()}|${destino.base}`).digest('hex').slice(0, 16);
}

/** Os campos do registro são exatamente os comuns, os obrigatórios e os opcionais presentes; cada um confere. */
function campos(d: DadosDoRegistro, caminho: string, obrigatorios: Record<string, (v: unknown) => boolean>,
  opcionais: Record<string, (v: unknown) => boolean> = {}): void {
  for (const k of Object.keys(d)) {
    if (COMUNS.includes(k)) continue;
    const regra = obrigatorios[k] ?? opcionais[k];
    if (!regra) throw adulterado(`${caminho} com campo fora do contrato (${k.slice(0, 40)})`);
    if (!regra(d[k])) throw adulterado(`${caminho} com ${k} fora do formato`);
  }
  for (const k of Object.keys(obrigatorios)) if (!(k in d)) throw adulterado(`${caminho} sem ${k}`);
}

const maquinasDe = (c: ConteudoDoEnvelope): MaquinaDoArco[] => envelopeMultimaquina(c) ? c.maquinas : [];
const trabalhoDe = (c: ConteudoDoEnvelope, id: string): Trabalho | undefined => c.trabalhos?.find(t => t.id === id);

/** O selo de uma geração: quantos e quais registros a autoridade dela assinou, pelo sha256 da lista ordenada (B1 da revisão). */
export function seloDaGeracao(ids: readonly string[]): { registros: number; sha256: string } {
  const lista = [...ids].sort();
  return { registros: lista.length, sha256: createHash('sha256').update(JSON.stringify(lista)).digest('hex') };
}
const seloValido = (v: unknown): boolean => objeto(v) && Object.keys(v).sort().join(',') === 'registros,sha256' &&
  inteiro(v.registros, 0) && typeof v.sha256 === 'string' && /^[0-9a-f]{64}$/.test(v.sha256);

/** O checkpoint do recibo de fim: só a thread local e as vagas que o fim soltou (B1 da rodada 2), nunca sessão nem texto livre. */
export interface CheckpointDoFim { thread?: string | null; vagasSoltas?: string[] }
export const TETO_DE_VAGAS_NO_CHECKPOINT = 64;
const checkpointValido = (v: unknown): v is CheckpointDoFim => objeto(v) && Object.keys(v).every(k => k === 'thread' || k === 'vagasSoltas') &&
  (v.thread === undefined || v.thread === null || linha(v.thread, 80)) &&
  (v.vagasSoltas === undefined || (Array.isArray(v.vagasSoltas) && v.vagasSoltas.length <= TETO_DE_VAGAS_NO_CHECKPOINT &&
    v.vagasSoltas.every(x => typeof x === 'string' && ID_DA_VAGA.test(x))));

/**
 * G8-6 do CHECK de 15/10: a continuidade da chave nos registros presos a uma ordem (recibo, vaga, vaga solta, vez, fim da vez
 * e entrega). Assinado sob uma versão anterior à da ordem, o registro só vale com a chave que a versão da ordem dá ao executor:
 * a chave que uma emenda aposentou ainda fecha o que é dela sob a versão antiga (D18), mas não fecha, solta nem entrega a
 * ordem emitida depois da troca. Sob a versão da ordem ou uma posterior vale a sucessão: a raiz que a emenda pôs no lugar
 * fecha o que a chave antiga deixou. A ordem das versões é a das autorizações, a mesma que dá a vigente.
 */
function chaveContinua(versoes: readonly VersaoDoEnvelope[], registro: { envelopeSha256: string; por: string },
  ordem: { envelopeSha256: string; maquina: string }): boolean {
  const i = versoes.findIndex(v => v.envelopeSha256 === registro.envelopeSha256);
  const j = versoes.findIndex(v => v.envelopeSha256 === ordem.envelopeSha256);
  if (i < 0 || j < 0) return false;
  if (i >= j) return true;
  const chave = maquinasDe(versoes[i].conteudo).find(m => m.nome === registro.por)?.chave;
  return chave !== undefined && chave === maquinasDe(versoes[j].conteudo).find(m => m.nome === ordem.maquina)?.chave;
}

/**
 * A ordem é desta raiz, que assina como `eu`? A máquina dela tem o mesmo nome, e o que esta raiz assinar sobre ela passa na
 * continuidade da chave (G8-6): a raiz assina sob a última versão em que está com a mesma chave, a vigente ou, depois de uma
 * emenda que a tirou, a anterior (D18). A raiz antiga que volta depois de uma troca de chave deixa a ordem da nova para ela.
 */
export function ordemDaRaiz(estado: EstadoDaCoordenacao, o: OrdemDerivada, eu: { nome: string; chave: string }): boolean {
  if (o.maquina !== eu.nome) return false;
  const assina = [...estado.versoes].reverse().find(v => maquinasDe(v.conteudo).some(m => m.nome === eu.nome && m.chave === eu.chave));
  return !!assina && chaveContinua(estado.versoes, { envelopeSha256: assina.envelopeSha256, por: eu.nome }, o);
}

/**
 * O estado da coordenação, derivado da leitura conferida. Confere o contrato de cada tipo e a coerência entre eles (quem
 * assina o quê, gerações contíguas e seladas, uma ordem viva por trabalho, uma vez ativa por destino, recibos que não se
 * contradizem); qualquer falha é `noctum.coordenacao.adulterado`. A mesma leitura deriva uma vez só.
 */
export function derivarCoordenacao(leitura: LeituraDoRamo): EstadoDaCoordenacao {
  const ja = derivadas.get(leitura);
  if (ja) return ja;
  const estado = derivar(leitura);
  derivadas.set(leitura, estado);
  return estado;
}
const derivadas = new WeakMap<LeituraDoRamo, EstadoDaCoordenacao>();

function derivar(leitura: LeituraDoRamo): EstadoDaCoordenacao {
  const versoes = new Map(leitura.versoes.map(v => [v.envelopeSha256, v]));
  const vigente = leitura.versoes.at(-1)!;
  const daVersao = (d: DadosDoRegistro) => versoes.get(d.envelopeSha256)!.conteudo;
  const exigirChaveDaOrdem = (d: DadosDoRegistro, caminho: string, o: OrdemDerivada): void => {
    if (!chaveContinua(leitura.versoes, d, o)) {
      throw adulterado(`${caminho} assinado sob uma versão anterior à da ordem ${o.ordem}, por uma chave diferente da que o envelope ` +
        `dela dá ao executor ${o.maquina}`);
    }
  };
  const porTipo = (tipo: string) => leitura.registros.filter(r => r.dados.tipo === tipo);
  const daGeracao = new Map<number, string[]>();
  const selar = (g: number, id: string) => daGeracao.set(g, [...(daGeracao.get(g) ?? []), id]);

  // Autoridade e cessões.
  const cessoes = new Map<number, { para: string; em: string; motivo: string; por: string }>();
  for (const { caminho, dados: d } of porTipo('cessao')) {
    campos(d, caminho, { geracao: v => inteiro(v), para: v => typeof v === 'string' && NOME_DE_MAQUINA.test(v), motivo: v => linha(v) });
    cessoes.set(d.geracao as number, { para: d.para as string, em: d.em, motivo: d.motivo as string, por: d.por });
  }
  const brutas = porTipo('autoridade').map(({ caminho, dados: d }) => {
    campos(d, caminho, { geracao: v => inteiro(v), modo: v => v === 'primeira' || v === 'cessao' || v === 'forcada', motivo: v => linha(v),
      anterior: v => v === null || (objeto(v) && inteiro(v.geracao) && typeof v.maquina === 'string' && Object.keys(v).length === 2),
      selo: v => v === null || seloValido(v) },
    { batidaDaAnterior: v => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v))) });
    return d;
  }).sort((a, b) => (a.geracao as number) - (b.geracao as number));
  const autoridades: AutoridadeDerivada[] = [];
  brutas.forEach((d, i) => {
    const g = d.geracao as number, anterior = d.anterior as { geracao: number; maquina: string } | null;
    if (g !== i + 1) throw adulterado(`as gerações da autoridade não são contíguas (falta a ${i + 1})`);
    if (g === 1 ? d.modo !== 'primeira' || anterior !== null : anterior?.geracao !== g - 1 || anterior.maquina !== autoridades[g - 2].maquina) {
      throw adulterado(`a geração ${g} da autoridade não aponta a anterior`);
    }
    if ((g === 1) !== (d.selo === null)) throw adulterado(`a geração ${g} da autoridade ${g === 1 ? 'traz selo' : 'não traz o selo da anterior'}`);
    if (d.modo === 'cessao' && cessoes.get(g - 1)?.para !== d.por) throw adulterado(`a geração ${g} diz cessão sem a cessão da ${g - 1} para ${d.por}`);
    if (d.modo === 'forcada' && !(d.motivo as string).trim()) throw adulterado(`a geração ${g} foi tomada à força sem motivo`);
    autoridades.push({ geracao: g, maquina: d.por, desde: d.em, modo: d.modo as ModoDaAutoridade, motivo: d.motivo as string });
  });
  for (const [g, c] of cessoes) {
    if (!autoridades[g - 1] || autoridades[g - 1].maquina !== c.por) throw adulterado(`cessão da geração ${g} assinada por quem não era a autoridade`);
  }
  const autoridadeDa = (g: number) => autoridades[g - 1];
  const daAutoridade = (d: DadosDoRegistro, caminho: string, oque: string) => {
    if (!autoridadeDa(d.geracao as number) || autoridadeDa(d.geracao as number).maquina !== d.por) {
      throw adulterado(`${caminho} ${oque} por quem não era a autoridade da geração ${String(d.geracao)}`);
    }
  };

  // Ordens, cancelamentos e recibos.
  const ordens = new Map<string, OrdemDerivada>();
  for (const { caminho, dados: d } of porTipo('ordem')) {
    campos(d, caminho, { ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), trabalho: v => typeof v === 'string' && ID_DO_TRABALHO.test(v),
      item: v => typeof v === 'string' && /^RM-\d{3}$/.test(v), maquina: v => typeof v === 'string' && NOME_DE_MAQUINA.test(v),
      geracao: v => inteiro(v), n: v => inteiro(v) });
    if (d.ordem !== `O-${String(d.trabalho)}-${String(d.n)}`) throw adulterado(`${caminho} com id que não é o do trabalho e do número`);
    daAutoridade(d, caminho, 'assinada');
    selar(d.geracao as number, `ordem:${String(d.ordem)}`);
    const conteudo = daVersao(d), t = trabalhoDe(conteudo, d.trabalho as string);
    if (!t || t.item !== d.item) throw adulterado(`${caminho} para um trabalho fora do envelope dela`);
    if (!maquinasDe(conteudo).some(m => m.nome === d.maquina) || (t.maquina && t.maquina !== d.maquina)) {
      throw adulterado(`${caminho} para uma máquina que o envelope dela não admite nesse trabalho`);
    }
    ordens.set(d.ordem as string, { ordem: d.ordem as string, trabalho: d.trabalho as string, item: d.item as string, maquina: d.maquina as string,
      geracao: d.geracao as number, n: d.n as number, envelopeSha256: d.envelopeSha256, emitidaEm: d.em, cancelada: null, recibos: {},
      estado: 'emitida', resultado: null });
  }
  for (const { caminho, dados: d } of porTipo('cancelamento')) {
    campos(d, caminho, { ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), motivo: v => linha(v), geracao: v => inteiro(v) });
    const o = ordens.get(d.ordem as string);
    if (!o) throw adulterado(`${caminho} de uma ordem que não existe`);
    daAutoridade(d, caminho, 'assinado');
    selar(d.geracao as number, `cancelamento:${String(d.ordem)}`);
    o.cancelada = { em: d.em, motivo: d.motivo as string, por: d.por };
  }
  for (const { caminho, dados: d } of porTipo('recibo')) {
    campos(d, caminho, { ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), recibo: v => (RECIBOS as readonly unknown[]).includes(v),
      motivo: v => linha(v) }, { resultado: v => v === 'entregue' || v === 'encerrado-sem-entrega', thread: v => v === null || linha(v, 80),
      checkpoint: v => checkpointValido(v) });
    const o = ordens.get(d.ordem as string);
    if (!o) throw adulterado(`${caminho} de uma ordem que não existe`);
    if (o.maquina !== d.por) throw adulterado(`${caminho} assinado por quem não é o executor da ordem`);
    exigirChaveDaOrdem(d, caminho, o);
    if ((d.recibo === 'concluida') !== (d.resultado !== undefined)) throw adulterado(`${caminho}: só a conclusão traz resultado, e sempre`);
    o.recibos[d.recibo as TipoDeRecibo] = d;
  }
  for (const o of ordens.values()) {
    const r = o.recibos;
    if ((r.aceita && r.recusada) || (r.concluida && r.encerrada) || ((r.concluida || r.encerrada) && !r.aceita)) {
      throw adulterado(`os recibos da ordem ${o.ordem} se contradizem`);
    }
    o.estado = r.concluida ? 'concluida' : r.encerrada ? 'encerrada' : r.recusada ? 'recusada'
      : r.aceita ? (o.cancelada ? 'isolada' : 'aceita') : o.cancelada ? 'cancelada-antes' : 'emitida';
    o.resultado = (r.concluida?.resultado as ResultadoDaConclusao | undefined) ?? null;
  }
  // Uma ordem viva por trabalho, e os números de cada trabalho contíguos (D9).
  const doTrabalho = new Map<string, OrdemDerivada[]>();
  for (const o of ordens.values()) doTrabalho.set(o.trabalho, [...(doTrabalho.get(o.trabalho) ?? []), o]);
  for (const [trabalho, lista] of doTrabalho) {
    lista.sort((a, b) => a.n - b.n);
    if (lista.some((o, i) => o.n !== i + 1)) throw adulterado(`as ordens do trabalho ${trabalho} não são contíguas`);
    if (lista.filter(ordemViva).length > 1) throw adulterado(`o trabalho ${trabalho} tem duas ordens vivas`);
  }

  // Entregas.
  const entregas = new Map<string, DadosDoRegistro>();
  for (const { caminho, dados: d } of porTipo('entrega')) {
    campos(d, caminho, { trabalho: v => typeof v === 'string' && ID_DO_TRABALHO.test(v), ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v),
      destino: v => objeto(v) && typeof v.repositorio === 'string' && typeof v.base === 'string' && Object.keys(v).length === 2,
      fonte: v => sha(v), base: v => sha(v), merge: v => sha(v) });
    const o = ordens.get(d.ordem as string);
    if (!o || o.maquina !== d.por || o.trabalho !== d.trabalho || !o.recibos.aceita) {
      throw adulterado(`${caminho} de outra máquina, de outro trabalho ou de uma ordem que ela não aceitou`);
    }
    exigirChaveDaOrdem(d, caminho, o);
    entregas.set(d.trabalho as string, d);
  }

  // Vagas.
  const vagas: VagaDerivada[] = [];
  const porVaga = new Map<string, VagaDerivada>();
  for (const { caminho, dados: d } of porTipo('vaga')) {
    campos(d, caminho, { vaga: v => typeof v === 'string' && ID_DA_VAGA.test(v), conta: v => inteiro(v, 0), runtime: v => linha(v, 40),
      ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), trabalho: v => typeof v === 'string' && ID_DO_TRABALHO.test(v), reserva: v => inteiro(v) });
    if (d.vaga !== `V-${d.por}-${String(d.reserva)}`) throw adulterado(`${caminho} com id que não é o da máquina e da reserva`);
    const o = ordens.get(d.ordem as string);
    // Nenhum efeito antes do aceite (D10): vaga de ordem que o executor não aceitou só existe num ramo escrito à mão.
    if (!o || o.maquina !== d.por || o.trabalho !== d.trabalho || !o.recibos.aceita) {
      throw adulterado(`${caminho} de quem não é o executor da ordem, ou de uma ordem que ele não aceitou`);
    }
    exigirChaveDaOrdem(d, caminho, o);
    const conteudo = daVersao(d);
    const conta = envelopeMultimaquina(conteudo) ? conteudo.capacidadeGlobal.porConta[d.conta as number]?.conta : undefined;
    if (!conta || !conteudo.orcamento.porRuntime.some(r => r.runtime === d.runtime)) throw adulterado(`${caminho} com conta ou runtime fora do envelope dela`);
    const v: VagaDerivada = { vaga: d.vaga as string, maquina: d.por, conta, runtime: d.runtime as string, ordem: d.ordem as string,
      trabalho: d.trabalho as string, reserva: d.reserva as number, chave: maquinasDe(conteudo).find(m => m.nome === d.por)!.chave, desde: d.em,
      solta: null };
    vagas.push(v);
    porVaga.set(v.vaga, v);
  }
  for (const { caminho, dados: d } of porTipo('vaga-solta')) {
    campos(d, caminho, { vaga: v => typeof v === 'string' && ID_DA_VAGA.test(v), consumiu: v => typeof v === 'boolean', motivo: v => linha(v) });
    const v = porVaga.get(d.vaga as string);
    if (!v || v.maquina !== d.por) throw adulterado(`${caminho} de uma vaga que não existe ou não é de quem solta`);
    exigirChaveDaOrdem(d, caminho, ordens.get(v.ordem)!);
    v.solta = { em: d.em, consumiu: d.consumiu as boolean, motivo: d.motivo as string };
  }
  const consumo = { arco: 0, porConta: {} as Record<string, number>, porRuntime: {} as Record<string, number> };
  for (const v of vagas) {
    if (v.solta && !v.solta.consumiu) continue;
    consumo.arco += 1;
    consumo.porConta[v.conta] = (consumo.porConta[v.conta] ?? 0) + 1;
    consumo.porRuntime[v.runtime] = (consumo.porRuntime[v.runtime] ?? 0) + 1;
  }

  // Vezes de integrar.
  const vezes = new Map<string, VezDerivada[]>();
  for (const { caminho, dados: d } of porTipo('vez')) {
    campos(d, caminho, { chave: v => typeof v === 'string' && CHAVE_DO_DESTINO.test(v), n: v => inteiro(v),
      destino: v => objeto(v) && typeof v.repositorio === 'string' && typeof v.base === 'string' && Object.keys(v).length === 2,
      ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), trabalho: v => typeof v === 'string' && ID_DO_TRABALHO.test(v),
      candidato: v => objeto(v) && typeof v.branch === 'string' && sha(v.fonte) && sha(v.base) && typeof v.provas === 'string' &&
        /^[0-9a-f]{64}$/.test(v.provas) && Object.keys(v).length === 4 });
    const destino = d.destino as { repositorio: string; base: string };
    if (chaveDoDestino(destino) !== d.chave) throw adulterado(`${caminho} com chave que não é a do destino`);
    const o = ordens.get(d.ordem as string);
    if (!o || o.maquina !== d.por || o.trabalho !== d.trabalho || !o.recibos.aceita) {
      throw adulterado(`${caminho} de quem não é o executor da ordem, ou de uma ordem que ele não aceitou`);
    }
    exigirChaveDaOrdem(d, caminho, o);
    vezes.set(d.chave as string, [...(vezes.get(d.chave as string) ?? []), { chave: d.chave as string, n: d.n as number, maquina: d.por,
      ordem: d.ordem as string, trabalho: d.trabalho as string, destino, candidato: d.candidato as CandidatoDeIntegracao, desde: d.em, fim: null }]);
  }
  for (const { caminho, dados: d } of porTipo('vez-fim')) {
    campos(d, caminho, { chave: v => typeof v === 'string' && CHAVE_DO_DESTINO.test(v), n: v => inteiro(v),
      desfecho: v => (DESFECHOS as readonly unknown[]).includes(v), motivo: v => linha(v) },
    { merge: v => v === null || sha(v), geracao: v => inteiro(v), sinalDoDono: v => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v))) });
    const vez = vezes.get(d.chave as string)?.find(x => x.n === d.n);
    if (!vez) throw adulterado(`${caminho} de uma vez que não existe`);
    if (d.desfecho === 'abandonada') {
      // A7 da revisão: só a autoridade da geração abandona a vez de outra máquina, e o abandono entra no selo da geração.
      daAutoridade(d, caminho, 'assinado');
      if (vez.maquina === d.por || d.merge !== undefined) throw adulterado(`${caminho}: o abandono é da vez de outra máquina, sem merge`);
      selar(d.geracao as number, `abandono:${String(d.chave)}/${String(d.n)}`);
    } else if (vez.maquina !== d.por || d.geracao !== undefined || d.sinalDoDono !== undefined) {
      throw adulterado(`${caminho} de uma vez que não é de quem a encerra`);
    } else {
      exigirChaveDaOrdem(d, caminho, ordens.get(vez.ordem)!);
    }
    vez.fim = { em: d.em, desfecho: d.desfecho as DesfechoDaVez, motivo: d.motivo as string, merge: (d.merge as string | null | undefined) ?? null, por: d.por };
  }
  for (const [chave, lista] of vezes) {
    lista.sort((a, b) => a.n - b.n);
    if (lista.some((v, i) => v.n !== i + 1)) throw adulterado(`as vezes do destino ${chave} não são contíguas`);
    if (lista.filter(v => !v.fim).length > 1) throw adulterado(`o destino ${chave} tem duas vezes ativas`);
  }

  // B1 da revisão: cada geração vencida tem exatamente os registros que a autoridade seguinte selou ao assumir. A
  // autoridade antiga que grava depois de perder a vez (um núcleo divergente, um agente com a chave dela) reprova a leitura.
  for (let g = 1; g < autoridades.length; g++) {
    const esperado = brutas[g].selo as { registros: number; sha256: string };
    const visto = seloDaGeracao(daGeracao.get(g) ?? []);
    if (visto.registros !== esperado.registros || visto.sha256 !== esperado.sha256) {
      throw adulterado(`a geração ${g} tem ${visto.registros} registro(s) da autoridade, e a geração ${g + 1} selou ${esperado.registros}: ` +
        'a autoridade vencida gravou depois de perder a vez');
    }
  }

  // Batidas, sinais de vida e revogação.
  const batidas = new Map<string, string>();
  for (const { caminho, dados: d } of porTipo('batida')) {
    campos(d, caminho, {});
    batidas.set(d.por, d.em);
  }
  const sinais = new Map<string, string>();
  for (const { dados: d } of leitura.registros) {
    const antes = sinais.get(d.por);
    if (!antes || Date.parse(d.em) > Date.parse(antes)) sinais.set(d.por, d.em);
  }
  let revogada: EstadoDaCoordenacao['revogada'] = null;
  for (const { caminho, dados: d } of porTipo('revogacao')) {
    campos(d, caminho, { motivo: v => linha(v) });
    if (!revogada || Date.parse(d.em) < Date.parse(revogada.em)) revogada = { por: d.por, em: d.em, motivo: d.motivo as string };
  }

  // A situação de cada trabalho do envelope vigente.
  const trabalhos = new Map<string, SituacaoDoTrabalho>();
  for (const t of vigente.conteudo.trabalhos ?? []) {
    const lista = doTrabalho.get(t.id) ?? [];
    const ultima = lista.at(-1) ?? null;
    const entregue = entregas.get(t.id)?.em ?? lista.find(o => o.resultado === 'entregue')?.recibos.concluida?.em ?? null;
    const estado: EstadoDoTrabalhoNaRede = entregue ? 'entregue' : lista.some(o => o.resultado === 'encerrado-sem-entrega') ? 'encerrado'
      : !ultima || !ordemViva(ultima) ? 'livre' : ultima.estado === 'emitida' ? 'ordenado' : ultima.estado === 'aceita' ? 'em-execucao' : 'isolado';
    trabalhos.set(t.id, { trabalho: t.id, estado, ordem: ultima, entregueEm: entregue });
  }

  return { arco: leitura.arco, remoto: leitura.remoto, ponta: leitura.ponta, lidoEm: leitura.lidoEm, versoes: leitura.versoes, vigente,
    autoridade: autoridades.at(-1) ?? null, autoridades,
    cessoes: new Map([...cessoes].map(([g, c]) => [g, { para: c.para, em: c.em, motivo: c.motivo }])),
    ordens, trabalhos, vagas, consumo, vezes, entregas, batidas, sinais, revogada, daGeracao };
}

/** A2 da revisão: a coerência inteira confere antes de a leitura avançar a última ponta vista desta máquina. */
export const conferirCoordenacao = (leitura: LeituraDoRamo): void => { derivarCoordenacao(leitura); };

/** A leitura conferida e derivada, nova do remoto. */
export function lerCoordenacao(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): EstadoDaCoordenacao {
  return derivarCoordenacao(lerRamo(carregado, arco, opcoes, conferirCoordenacao));
}

/** A gravação no ramo com a coerência conferida em toda leitura: é a única que a coordenação, a integração e o passo usam. */
export function gravarNaCoordenacao<T>(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao,
  regra: (leitura: LeituraDoRamo) => { novos: CamposDoRegistro[]; resultado: T }): ResultadoDaGravacao<T> {
  return gravarNoRamo(carregado, arco, opcoes, regra, conferirCoordenacao);
}

/** A situação de um trabalho na rede: é por ela que a N4 sabe se pode transferir (só `livre`). */
export function situacaoDoTrabalho(estado: EstadoDaCoordenacao, trabalho: string): SituacaoDoTrabalho | null {
  return estado.trabalhos.get(trabalho) ?? null;
}

/** Os trabalhos entregues em qualquer máquina, com o instante: a N2 os conta como entregues nas dependências. */
export function entreguesNaRede(estado: EstadoDaCoordenacao): Map<string, string> {
  return new Map([...estado.trabalhos.values()].filter(s => s.estado === 'entregue').map(s => [s.trabalho, s.entregueEm!]));
}

/** Os trabalhos encerrados sem entrega em alguma máquina do arco (S1 da rodada 3): terminais em todas, como os entregues. */
export function encerradosNaRede(estado: EstadoDaCoordenacao): Set<string> {
  return new Set([...estado.trabalhos.values()].filter(s => s.estado === 'encerrado').map(s => s.trabalho));
}

/**
 * A máquina deu sinal de vida há pouco, no instante dado? O sinal é o registro mais novo que ela assinou, inclusive a
 * autoridade que ela acabou de assumir e a vez que ela tomou (S2 da revisão). A própria máquina, rodando agora, sempre deu.
 */
export function batidaRecente(estado: EstadoDaCoordenacao, maquina: string, eu: string, quando: string): boolean {
  if (maquina === eu) return true;
  const em = estado.sinais.get(maquina);
  return !!em && Date.parse(quando) - Date.parse(em) <= BATIDA_VENCIDA_MS;
}

// ---------------------------------------------------------------------------
// As conferências comuns.
// ---------------------------------------------------------------------------

/** O arco está vigente aqui (autorizado, na janela, não revogado)? Senão, a recusa da N1 que diz por quê. */
function exigirArcoVigente(carregado: ManifestoCarregado, arco: string, quando: string): void {
  const e = lerArco(carregado.raiz, arco, quando);
  if (!e || !e.conteudo) throw recusa('noctum.efeito.sem-autorizacao', `arco ${arco} sem envelope autorizado nesta máquina`);
  if (e.situacao === 'revogado') throw recusa('noctum.efeito.revogado', `arco ${arco} revogado pelo dono`);
  // RM-058 N6: o arco que o fechamento encerrou nesta máquina é terminal, como o revogado; nada novo começa aqui.
  if (e.situacao === 'encerrado') {
    throw recusa('noctum.efeito.encerrado', `arco ${arco} encerrado nesta máquina (${e.encerramento?.motivo ?? 'fechado'}); nada novo começa aqui`);
  }
  if (e.situacao === 'expirado') throw recusa('noctum.efeito.expirado', `a janela do arco ${arco} terminou em ${e.conteudo.janela.fim}`);
  if (e.situacao !== 'vigente') throw recusa('noctum.efeito.fora-da-janela', `a janela do arco ${arco} só começa em ${e.conteudo.janela.inicio}`);
}

/** A8 da revisão: a revogação gravada no ramo por uma máquina do arco vale aqui também; nada novo começa. */
function exigirNaoRevogada(estado: EstadoDaCoordenacao): void {
  if (estado.revogada) {
    throw recusa('noctum.coordenacao.revogada', `o arco ${estado.arco} foi revogado na máquina ${estado.revogada.por} em ${estado.revogada.em}; ` +
      'nenhuma ordem, vaga ou vez nova sai, e cada máquina só fecha o que é dela');
  }
}

/** Esta máquina é a autoridade vigente? Senão, `geracao-vencida` (já foi) ou `autoridade-ativa`. */
function exigirAutoridade(estado: EstadoDaCoordenacao, eu: string): AutoridadeDerivada {
  const a = estado.autoridade;
  if (a?.maquina === eu) return a;
  if (estado.autoridades.some(x => x.maquina === eu)) {
    throw recusa('noctum.coordenacao.geracao-vencida', `esta máquina já foi a autoridade; a vigente é ${a!.maquina}, geração ${a!.geracao}`);
  }
  throw recusa('noctum.coordenacao.autoridade-ativa', a ? `a autoridade vigente é ${a.maquina}, geração ${a.geracao}` : 'o arco ainda não tem autoridade: assuma antes');
}

function exigirOrdem(estado: EstadoDaCoordenacao, ordem: string): OrdemDerivada {
  const o = estado.ordens.get(ordem);
  if (!o) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} não existe neste arco`);
  return o;
}

const nomeDe = (opcoes: OpcoesDaCoordenacao): string => nomeDaMaquina(opcoes.maquina);

// ---------------------------------------------------------------------------
// Autoridade por geração (D8).
// ---------------------------------------------------------------------------

/**
 * Assume a autoridade do arco. Sem autoridade, a geração 1 (dois que disputam: um vence pela troca atômica). A própria é
 * idempotente. A de outra máquina só com a cessão dela para esta, ou com `forcar` e motivo quando ela não dá sinal há
 * mais de 15 min ou saiu do envelope vigente; senão, `noctum.coordenacao.autoridade-ativa`. A geração nova sela os
 * registros da anterior (B1 da revisão): o que a autoridade antiga gravar depois reprova a leitura de todos.
 */
export function assumirAutoridade(carregado: ManifestoCarregado, arco: string,
  opcoes: OpcoesDaCoordenacao & { forcar?: { motivo: string } } = {}): AutoridadeDerivada {
  const quando = opcoes.quando ?? new Date().toISOString();
  const motivoForcado = opcoes.forcar ? motivoPublico(opcoes.forcar.motivo, 'a tomada forçada da autoridade') : null;
  exigirArcoVigente(carregado, arco, quando);
  const r = gravarNaCoordenacao<AutoridadeDerivada>(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = estado.autoridade;
    const nova = (geracao: number, modo: ModoDaAutoridade, motivo: string): AutoridadeDerivada => ({ geracao, maquina: eu.nome, desde: quando, modo, motivo });
    if (!a) {
      return { novos: [{ tipo: 'autoridade', geracao: 1, modo: 'primeira', motivo: 'primeira autoridade do arco', anterior: null, selo: null }],
        resultado: nova(1, 'primeira', 'primeira autoridade do arco') };
    }
    if (a.maquina === eu.nome) return { novos: [], resultado: a };
    const anterior = { geracao: a.geracao, maquina: a.maquina };
    const selo = seloDaGeracao(estado.daGeracao.get(a.geracao) ?? []);
    if (estado.cessoes.get(a.geracao)?.para === eu.nome) {
      const motivo = estado.cessoes.get(a.geracao)!.motivo;
      return { novos: [{ tipo: 'autoridade', geracao: a.geracao + 1, modo: 'cessao', motivo, anterior, selo }], resultado: nova(a.geracao + 1, 'cessao', motivo) };
    }
    if (motivoForcado) {
      const motivo = motivoForcado;
      const fora = !envelopeMultimaquina(vigente.conteudo) || !vigente.conteudo.maquinas.some(m => m.nome === a.maquina);
      if (!fora && batidaRecente(estado, a.maquina, eu.nome, quando)) {
        throw recusa('noctum.coordenacao.autoridade-ativa', `a autoridade ${a.maquina} deu sinal há menos de ${BATIDA_VENCIDA_MS / 60000} min; tomar à força exige o sinal vencido`);
      }
      return { novos: [{ tipo: 'autoridade', geracao: a.geracao + 1, modo: 'forcada', motivo, anterior, selo,
        batidaDaAnterior: estado.sinais.get(a.maquina) ?? null }], resultado: nova(a.geracao + 1, 'forcada', motivo) };
    }
    throw recusa('noctum.coordenacao.autoridade-ativa', `a autoridade vigente é ${a.maquina}, geração ${a.geracao}; troca só por cessão dela ou tomada forçada`);
  });
  return r.resultado;
}

/** A autoridade vigente cede a vez a outra máquina do envelope; a outra assume com `assumirAutoridade`. */
export function cederAutoridade(carregado: ManifestoCarregado, arco: string, para: string, motivo: string, opcoes: OpcoesDaCoordenacao = {}): void {
  const doCedente = motivoPublico(motivo, 'a cessão');
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = exigirAutoridade(estado, eu.nome);
    if (para === eu.nome || !maquinasDe(vigente.conteudo).some(m => m.nome === para)) {
      throw recusa('noctum.coordenacao.fora-do-envelope', `a cessão vai a outra máquina do envelope vigente, não a ${para}`);
    }
    if (estado.cessoes.get(a.geracao)?.para === para) return { novos: [], resultado: null };
    if (estado.cessoes.has(a.geracao)) throw recusa('noctum.coordenacao.concorrencia', `a geração ${a.geracao} já foi cedida`);
    return { novos: [{ tipo: 'cessao', geracao: a.geracao, para, motivo: doCedente }], resultado: null };
  });
}

// ---------------------------------------------------------------------------
// A reserva do item na branch da RM-047, vista pela coordenação (D11 e A1 da revisão).
// ---------------------------------------------------------------------------

/** Com qual máquina está a reserva de um item, e desde quando ela está como está (a última atualização). */
export interface DonoDaReserva { maquina: string; atualizadaEm: string }
/** As reservas lidas agora do remoto, por item; o item que não está no mapa está livre. */
export type ReservasVistas = ReadonlyMap<string, DonoDaReserva>;

/**
 * As reservas da branch da RM-047 lidas agora do remoto, vistas pela coordenação; `null` quando a leitura não veio. A
 * reserva de uma máquina do envelope (a do arco ou a que o dono tomou à mão nela, como na N2) leva a ordem só para ela; a
 * de fora do arco segura a ordem até ser solta. Só o item, a máquina e o instante saem daqui: o nome de quem reservou nunca
 * vai ao ramo de coordenação.
 */
export function reservasDoArco(carregado: ManifestoCarregado, opcoes: OpcoesDaCoordenacao = {}): ReservasVistas | null {
  let painel;
  try { painel = listarReservas(carregado.raiz, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, rede: opcoes.rede }); }
  catch { return null; }
  return painel.atualizado ? vistasDasReservas(painel.reservas) : null;
}

/** As reservas de um painel lido agora, vistas pela coordenação (a mesma de `reservasDoArco`, sem ler de novo). */
export function vistasDasReservas(reservas: ReadonlyArray<{ item: string; maquina: string; atualizadaEm: string }>): ReservasVistas {
  return new Map(reservas.map(r => [r.item, { maquina: r.maquina, atualizadaEm: r.atualizadaEm }]));
}

// ---------------------------------------------------------------------------
// Ordens, cancelamento e recibos (D9 e D10).
// ---------------------------------------------------------------------------

/** As vagas de execução de uma máquina: as da máquina menos as que só o CHECK usa. */
const vagasDeExecucao = (c: ConteudoDoEnvelope): number => (c.capacidade?.maquina ?? 0) - (c.capacidade?.revisao ?? 0);

const comMotivo = (r: DadosDoRegistro | undefined, motivo: string): boolean => String(r?.motivo ?? '').startsWith(motivo);

/**
 * A máquina já recusou este trabalho nesta versão do envelope, ou o encerrou porque o roadmap dela não tem o item? Ela não
 * recebe a mesma ordem de novo: sem isso, a ordem iria e voltaria a cada passo. A recusa e o fim pela reserva não contam
 * aqui (A1 da revisão): solta ou trocada a reserva, o trabalho sai de novo (`recusouPelaReserva`).
 */
function recusou(estado: EstadoDaCoordenacao, trabalho: string, maquina: string): boolean {
  return [...estado.ordens.values()].some(o => o.trabalho === trabalho && o.maquina === maquina &&
    o.envelopeSha256 === estado.vigente.envelopeSha256 &&
    ((o.estado === 'recusada' && !comMotivo(o.recibos.recusada, 'noctum.reserva.de-outra-maquina')) ||
      (o.estado === 'encerrada' && comMotivo(o.recibos.encerrada, 'noctum.reserva.item-invalido'))));
}

/**
 * A2 da rodada 3: a autoridade cancelou a ordem deste trabalho nesta máquina, nesta versão do envelope? A distribuição
 * automática não a devolve à mesma máquina (a retomada é em outra); a emissão explícita (`emitirOrdem`, da N4) escolhe.
 */
function canceladaNela(estado: EstadoDaCoordenacao, trabalho: string, maquina: string): boolean {
  return [...estado.ordens.values()].some(o => o.trabalho === trabalho && o.maquina === maquina && !!o.cancelada &&
    o.envelopeSha256 === estado.vigente.envelopeSha256);
}

/**
 * A máquina recusou ou encerrou este trabalho pela reserva do item, e a reserva continua a mesma desde então (nem solta,
 * nem trocada)? A mesma ordem voltaria a cair nela: espera a reserva mudar.
 */
function recusouPelaReserva(estado: EstadoDaCoordenacao, trabalho: string, maquina: string, dono: DonoDaReserva): boolean {
  return [...estado.ordens.values()].some(o => {
    if (o.trabalho !== trabalho || o.maquina !== maquina || o.envelopeSha256 !== estado.vigente.envelopeSha256) return false;
    const fim = o.estado === 'recusada' ? o.recibos.recusada : o.estado === 'encerrada' ? o.recibos.encerrada : undefined;
    return !!fim && comMotivo(fim, 'noctum.reserva.de-outra-maquina') && Date.parse(fim.em) >= Date.parse(dono.atualizadaEm);
  });
}

/** Por que a ordem do trabalho para a máquina não sai agora; `null` quando ela pode sair. */
function porQueNaoOrdenar(estado: EstadoDaCoordenacao, trabalho: string, maquina: string, eu: string, quando: string,
  reservas: ReservasVistas, emitidasAgora: ReadonlyArray<{ trabalho: string; item: string; maquina: string }> = []): RecusaDoArco | null {
  if (estado.revogada) return recusa('noctum.coordenacao.revogada', `o arco foi revogado na máquina ${estado.revogada.por}`);
  const c = estado.vigente.conteudo;
  const t = trabalhoDe(c, trabalho);
  if (!t) return recusa('noctum.despacho.fora-do-envelope', `o trabalho ${trabalho} não está no envelope vigente`);
  if (!maquinasDe(c).some(m => m.nome === maquina)) return recusa('noctum.coordenacao.fora-do-envelope', `a máquina ${maquina} não está no envelope vigente`);
  if (t.maquina && t.maquina !== maquina) return recusa('noctum.coordenacao.fora-do-envelope', `o trabalho ${trabalho} está preso à máquina ${t.maquina}`);
  const s = estado.trabalhos.get(trabalho)!;
  if (s.estado !== 'livre') return recusa('noctum.coordenacao.ordem-viva', `o trabalho ${trabalho} está ${s.estado}${s.ordem ? ` (ordem ${s.ordem.ordem})` : ''}`);
  if (emitidasAgora.some(x => x.trabalho === trabalho)) return recusa('noctum.coordenacao.ordem-viva', `o trabalho ${trabalho} acabou de receber ordem`);
  const faltam = t.dependeDe.filter(d => estado.trabalhos.get(d)?.estado !== 'entregue');
  if (faltam.length) return recusa('noctum.coordenacao.dependencia-pendente', `o trabalho ${trabalho} depende de ${faltam.join(', ')}, ainda não entregue(s)`);
  const doItem = [...[...estado.ordens.values()].filter(ordemViva).map(o => ({ trabalho: o.trabalho, item: o.item, maquina: o.maquina })),
    ...emitidasAgora].find(o => o.item === t.item && o.trabalho !== trabalho);
  if (doItem && doItem.maquina !== maquina) {
    return recusa('noctum.coordenacao.ordem-viva', `o item ${t.item} está com a máquina ${doItem.maquina} (trabalho ${doItem.trabalho}); a reserva é de uma máquina só`);
  }
  // A1 da revisão: a reserva da RM-047, lida agora, decide para onde a ordem vai, ou se ela espera.
  const dono = reservas.get(t.item);
  if (dono && !maquinasDe(c).some(m => m.nome === dono.maquina)) {
    return recusa('noctum.reserva.de-outra-maquina', `o item ${t.item} está reservado fora do arco; a ordem espera a reserva ser solta`);
  }
  if (dono && dono.maquina !== maquina) {
    return recusa('noctum.reserva.de-outra-maquina', `o item ${t.item} está reservado pela máquina ${dono.maquina} do arco; a ordem vai para ela`);
  }
  if (dono && recusouPelaReserva(estado, trabalho, maquina, dono)) {
    return recusa('noctum.reserva.de-outra-maquina', `a máquina ${maquina} não pôde usar a reserva do item ${t.item}; a ordem espera a reserva mudar`);
  }
  if (!batidaRecente(estado, maquina, eu, quando)) {
    return recusa('noctum.coordenacao.maquina-sem-batida', `a máquina ${maquina} não dá sinal há mais de ${BATIDA_VENCIDA_MS / 60000} min; ela não recebe ordem nova`);
  }
  if (recusou(estado, trabalho, maquina)) {
    return recusa('noctum.coordenacao.maquina-recusou', `a máquina ${maquina} já recusou o trabalho ${trabalho} nesta versão do envelope`);
  }
  return null;
}

function camposDaOrdem(estado: EstadoDaCoordenacao, trabalho: string, maquina: string, geracao: number): CamposDoRegistro {
  const t = trabalhoDe(estado.vigente.conteudo, trabalho)!;
  const n = [...estado.ordens.values()].filter(o => o.trabalho === trabalho).length + 1;
  return { tipo: 'ordem', ordem: `O-${trabalho}-${n}`, trabalho, item: t.item, maquina, geracao, n };
}

/**
 * Emite a ordem de um trabalho para uma máquina; só a autoridade vigente, com o arco vigente aqui e as reservas lidas agora
 * (o item reservado fora do arco, ou por outra máquina dele, segura a ordem).
 */
export function emitirOrdem(carregado: ManifestoCarregado, arco: string, pedido: { trabalho: string; maquina: string },
  opcoes: OpcoesDaCoordenacao = {}): string {
  const quando = opcoes.quando ?? new Date().toISOString();
  exigirArcoVigente(carregado, arco, quando);
  return gravarNaCoordenacao(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = exigirAutoridade(estado, eu.nome);
    // S3 da rodada 2: a ordem viva deste trabalho para a mesma máquina, emitida por esta geração e não cancelada, é a mesma
    // ordem: repetir depois de um push de resultado incerto devolve o id dela, sem gravar de novo.
    const ja = estado.trabalhos.get(pedido.trabalho)?.ordem;
    if (ja && (ja.estado === 'emitida' || ja.estado === 'aceita') && ja.maquina === pedido.maquina && ja.geracao === a.geracao &&
        ja.envelopeSha256 === estado.vigente.envelopeSha256) {
      return { novos: [], resultado: ja.ordem };
    }
    const reservas = reservasDoArco(carregado, opcoes);
    if (!reservas) throw recusa('noctum.coordenacao.sem-remoto', 'as reservas não se leram agora; sem elas, nenhuma ordem sai');
    const nao = porQueNaoOrdenar(estado, pedido.trabalho, pedido.maquina, eu.nome, quando, reservas);
    if (nao) throw nao;
    const campos = camposDaOrdem(estado, pedido.trabalho, pedido.maquina, a.geracao);
    return { novos: [campos], resultado: campos.ordem as string };
  }).resultado;
}

/**
 * D9: a política da autoridade, pura. Na ordem do dono (prioridade e posição no envelope), cada trabalho `livre` com as
 * dependências entregues vai à máquina presa, à do mesmo item (pela ordem viva ou pela reserva lida agora) ou à máquina
 * com sinal recente e menos ordens vivas, até as vagas de execução dela; desempate pela ordem das máquinas no envelope. O
 * item reservado fora do arco espera, e nada sai com o arco revogado (A1 e A8 da revisão, em `porQueNaoOrdenar`).
 */
export function distribuirOrdens(estado: EstadoDaCoordenacao, eu: string, quando: string, reservas: ReservasVistas):
  Array<{ trabalho: string; maquina: string }> {
  const a = estado.autoridade;
  if (!a || a.maquina !== eu) return [];
  const c = estado.vigente.conteudo;
  if (!envelopeMultimaquina(c)) return [];
  const limite = vagasDeExecucao(c);
  const vivas = new Map(c.maquinas.map(m => [m.nome, [...estado.ordens.values()].filter(o => ordemViva(o) && o.maquina === m.nome).length]));
  const emitidas: Array<{ trabalho: string; item: string; maquina: string }> = [];
  const fila = c.trabalhos.map((t, i) => ({ t, i })).sort((x, y) => x.t.prioridade - y.t.prioridade || x.i - y.i);
  for (const { t } of fila) {
    if (estado.trabalhos.get(t.id)?.estado !== 'livre') continue;
    const doItem = [...[...estado.ordens.values()].filter(ordemViva).map(o => ({ item: o.item, maquina: o.maquina })), ...emitidas]
      .find(o => o.item === t.item)?.maquina;
    const candidatas = t.maquina ? [t.maquina] : doItem ? [doItem]
      : c.maquinas.map(m => m.nome).sort((x, y) => vivas.get(x)! - vivas.get(y)! || c.maquinas.findIndex(m => m.nome === x) - c.maquinas.findIndex(m => m.nome === y));
    const alvo = candidatas.find(m => !canceladaNela(estado, t.id, m) && (vivas.get(m) ?? limite) < limite &&
      porQueNaoOrdenar(estado, t.id, m, eu, quando, reservas, emitidas) === null);
    if (!alvo) continue;
    emitidas.push({ trabalho: t.id, item: t.item, maquina: alvo });
    vivas.set(alvo, vivas.get(alvo)! + 1);
  }
  return emitidas.map(({ trabalho, maquina }) => ({ trabalho, maquina }));
}

/** Os registros das ordens que a política distribui agora, com os números certos mesmo para vários do mesmo trabalho. */
export function registrosDaDistribuicao(estado: EstadoDaCoordenacao, eu: string, quando: string, reservas: ReservasVistas): CamposDoRegistro[] {
  const a = estado.autoridade;
  if (!a || a.maquina !== eu) return [];
  return distribuirOrdens(estado, eu, quando, reservas).map(({ trabalho, maquina }) => camposDaOrdem(estado, trabalho, maquina, a.geracao));
}

/**
 * A7 da revisão: a autoridade abandona a vez de integrar da máquina que não dá sinal há mais de 15 min, para o destino
 * voltar a andar. O trabalho dela não muda de máquina sem prova; na volta, a reconciliação dela registra a entrega se o
 * merge tiver chegado à base.
 */
export function registrosDosAbandonos(estado: EstadoDaCoordenacao, eu: string, quando: string): CamposDoRegistro[] {
  const a = estado.autoridade;
  if (!a || a.maquina !== eu) return [];
  return [...estado.vezes.values()].flat().filter(v => !v.fim && v.maquina !== eu && !batidaRecente(estado, v.maquina, eu, quando))
    .map(v => ({ tipo: 'vez-fim', chave: v.chave, n: v.n, desfecho: 'abandonada', geracao: a.geracao, sinalDoDono: estado.sinais.get(v.maquina) ?? null,
      motivo: `a máquina ${v.maquina} não dá sinal há mais de ${BATIDA_VENCIDA_MS / 60000} min; o destino volta a andar, e o trabalho dela não muda de máquina sem prova` }));
}

/** Cancela uma ordem viva; só a autoridade vigente. Antes do aceite, o trabalho fica livre na hora; depois, isolado. */
export function cancelarOrdem(carregado: ManifestoCarregado, arco: string, ordem: string, motivo: string, opcoes: OpcoesDaCoordenacao = {}): EstadoDaOrdem {
  const doCancelamento = motivoPublico(motivo, 'o cancelamento');
  return gravarNaCoordenacao<EstadoDaOrdem>(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = exigirAutoridade(estado, eu.nome);
    const o = exigirOrdem(estado, ordem);
    if (o.cancelada) return { novos: [], resultado: o.estado };
    if (!ordemViva(o)) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} já terminou (${o.estado})`);
    return { novos: [{ tipo: 'cancelamento', ordem, motivo: doCancelamento, geracao: a.geracao }],
      resultado: o.estado === 'emitida' ? 'cancelada-antes' : 'isolada' };
  }).resultado;
}

/**
 * O que esta máquina sabe de si para responder uma ordem: a janela do arco, as threads desta raiz (com o item e o modo) e,
 * quando a leitura das reservas veio, os itens reservados fora do arco ou por outra máquina dele.
 */
export interface FatosDaResposta {
  arcoVigente: boolean;
  /** RM-058 N6: o fechamento encerrou o arco nesta máquina; ela não vai aceitar, então recusa o que chegar. */
  arcoEncerrado?: boolean;
  threadsLocais: ReadonlyMap<string, { roadmap: string | null; modo: string }>;
  itensDeOutros?: ReadonlySet<string>;
}

/** O motivo tipado da reserva de fora, igual em todo registro: só o item, nunca quem reservou (A1 da revisão). */
export const motivoDaReservaDeFora = (item: string): string => `noctum.reserva.de-outra-maquina: o item ${item} está reservado por outra máquina ou pessoa`;

/** A resposta desta máquina a uma ordem emitida para ela: aceita ou recusada com o motivo (D10). */
export function respostaAOrdem(estado: EstadoDaCoordenacao, o: OrdemDerivada, eu: string, fatos: FatosDaResposta):
  { recibo: 'aceita' | 'recusada'; motivo: string } {
  if (o.envelopeSha256 !== estado.vigente.envelopeSha256) return { recibo: 'recusada', motivo: 'noctum.efeito.hash-antigo: a ordem é de outra versão do envelope' };
  if (estado.revogada) return { recibo: 'recusada', motivo: `noctum.coordenacao.revogada: o arco foi revogado na máquina ${estado.revogada.por}` };
  if (fatos.arcoEncerrado) return { recibo: 'recusada', motivo: 'noctum.efeito.encerrado: o arco encerrou nesta máquina' };
  if (!fatos.arcoVigente) return { recibo: 'recusada', motivo: 'noctum.efeito.fora-da-janela: o arco não está vigente nesta máquina' };
  const t = trabalhoDe(estado.vigente.conteudo, o.trabalho);
  if (!t) return { recibo: 'recusada', motivo: 'noctum.despacho.fora-do-envelope: o trabalho não está no envelope vigente' };
  if (t.maquina && t.maquina !== eu) return { recibo: 'recusada', motivo: `noctum.coordenacao.fora-do-envelope: o trabalho está preso à máquina ${t.maquina}` };
  if (fatos.itensDeOutros?.has(t.item)) return { recibo: 'recusada', motivo: motivoDaReservaDeFora(t.item) };
  if (t.thread) {
    // A thread que o trabalho nomeia precisa morar aqui, ser do item dele e de #Auto: senão a fila da N2 nunca a despacharia.
    const th = fatos.threadsLocais.get(t.thread);
    if (!th) return { recibo: 'recusada', motivo: `noctum.despacho.fora-do-envelope: a thread ${t.thread} não existe nesta máquina` };
    if (th.roadmap !== t.item) return { recibo: 'recusada', motivo: `noctum.despacho.fora-do-envelope: a thread ${t.thread} é do item ${th.roadmap ?? 'nenhum'}, não do ${t.item}` };
    if (th.modo !== 'auto') return { recibo: 'recusada', motivo: `noctum.despacho.fora-do-envelope: a thread ${t.thread} está em ${th.modo}; o arco só conduz #Auto` };
  }
  return { recibo: 'aceita', motivo: 'ordem aceita' };
}

/** Os recibos de aceite ou recusa das ordens emitidas para esta máquina que ainda não têm resposta. */
export function registrosDasRespostas(estado: EstadoDaCoordenacao, eu: string, fatos: FatosDaResposta): CamposDoRegistro[] {
  return [...estado.ordens.values()].filter(o => o.maquina === eu && o.estado === 'emitida')
    .map(o => ({ tipo: 'recibo', ordem: o.ordem, ...respostaAOrdem(estado, o, eu, fatos) }));
}

/** Responde uma ordem desta máquina. Só a ordem dela, emitida e não cancelada; o aceite exige o arco vigente aqui e na rede. */
export function responderOrdem(carregado: ManifestoCarregado, arco: string, ordem: string, resposta: 'aceita' | 'recusada', motivo: string,
  opcoes: OpcoesDaCoordenacao = {}): EstadoDaOrdem {
  const quando = opcoes.quando ?? new Date().toISOString();
  const doRecibo = motivo ? motivoPublico(motivo, 'o recibo') : '';
  if (resposta === 'aceita') exigirArcoVigente(carregado, arco, quando);
  return gravarNaCoordenacao<EstadoDaOrdem>(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const o = exigirOrdem(estado, ordem);
    if (o.maquina !== eu.nome) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} é da máquina ${o.maquina}`);
    if (o.recibos[resposta]) return { novos: [], resultado: o.estado };
    if (o.estado !== 'emitida') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} está ${o.estado}`);
    if (resposta === 'aceita' && o.envelopeSha256 !== estado.vigente.envelopeSha256) {
      throw recusa('noctum.efeito.hash-antigo', `a ordem ${ordem} é de outra versão do envelope`);
    }
    if (resposta === 'aceita') exigirNaoRevogada(estado);
    return { novos: [{ tipo: 'recibo', ordem, recibo: resposta, motivo: doRecibo }], resultado: resposta === 'aceita' ? 'aceita' : 'recusada' };
  }).resultado;
}

/**
 * O executor conclui a ordem pela thread local: entregue ou fechada sem entrega. Vale também depois do cancelamento e
 * depois de uma emenda que tirou esta máquina do arco (A4 da revisão: o fim sai sob a versão em que ela estava).
 */
export function concluirOrdem(carregado: ManifestoCarregado, arco: string, ordem: string,
  conclusao: { resultado: ResultadoDaConclusao; thread: string | null }, opcoes: OpcoesDaCoordenacao = {}): void {
  if (conclusao.resultado !== 'entregue' && conclusao.resultado !== 'encerrado-sem-entrega') {
    throw recusa('noctum.envelope.invalido', 'a conclusão é entregue ou encerrado-sem-entrega');
  }
  if (conclusao.thread !== null && !linha(conclusao.thread, 80)) throw recusa('noctum.envelope.invalido', 'a thread da conclusão vai em uma linha de até 80 caracteres');
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const eu = nomeDe(opcoes);
    const o = exigirOrdem(estado, ordem);
    if (o.maquina !== eu) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} é da máquina ${o.maquina}`);
    if (o.estado === 'concluida') return { novos: [], resultado: null };
    if (o.estado !== 'aceita' && o.estado !== 'isolada') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} está ${o.estado}`);
    return { novos: [{ tipo: 'recibo', ordem, recibo: 'concluida', motivo: 'thread local ' + conclusao.resultado, resultado: conclusao.resultado,
      thread: conclusao.thread }], resultado: null };
  });
}

/**
 * O executor confirma o fim da ordem (cancelada, de outra versão, com o arco fora da janela ou revogado, ou sem a reserva
 * do item) com o checkpoint do que soltou. Só depois de nenhuma sessão dela viver nesta máquina: é este recibo que prova
 * que o executor antigo parou.
 */
export function encerrarOrdem(carregado: ManifestoCarregado, arco: string, ordem: string,
  fim: { motivo: string; checkpoint: CheckpointDoFim }, opcoes: OpcoesDaCoordenacao = {}): void {
  if (!checkpointValido(fim.checkpoint)) {
    throw recusa('noctum.envelope.invalido', `o checkpoint do fim leva só a thread (uma linha de até 80 caracteres) e as vagas soltas (até ${TETO_DE_VAGAS_NO_CHECKPOINT}); ` +
      'sessão, caminho e texto livre não vão ao ramo');
  }
  const checkpoint = { thread: fim.checkpoint.thread ?? null, vagasSoltas: fim.checkpoint.vagasSoltas ?? [] };
  const doFim = motivoPublico(fim.motivo, 'o fim da ordem');
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const eu = nomeDe(opcoes);
    const o = exigirOrdem(estado, ordem);
    if (o.maquina !== eu) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} é da máquina ${o.maquina}`);
    if (o.estado === 'encerrada') return { novos: [], resultado: null };
    if (o.estado !== 'aceita' && o.estado !== 'isolada') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} está ${o.estado}`);
    const vezes = [...estado.vezes.values()].flat().filter(v => v.ordem === o.ordem);
    if (vezes.some(v => !v.fim)) {
      throw recusa('noctum.integracao.nao-provada', `a ordem ${ordem} tem uma vez de integrar ativa; o merge pode ter chegado à base, e a reconciliação decide antes do fim`);
    }
    if (!estado.entregas.has(o.trabalho) && vezes.some(v => v.fim?.desfecho === 'sem-prova')) {
      throw recusa('noctum.integracao.base-nao-provada', `a ordem ${ordem} tem uma fonte que chegou à base fora da cerca; o trabalho espera a inspeção do dono`);
    }
    if (!estado.entregas.has(o.trabalho) && vezes.some(v => v.fim?.desfecho === 'abandonada')) {
      throw recusa('noctum.integracao.nao-provada', `a ordem ${ordem} tem uma vez abandonada cuja base ainda precisa ser conferida pela reconciliação`);
    }
    return { novos: [{ tipo: 'recibo', ordem, recibo: 'encerrada', motivo: doFim, checkpoint }], resultado: null };
  });
}

/** A batida desta máquina: é ela que diz à autoridade que a máquina está viva para receber ordem nova. */
export function bater(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): void {
  gravarNaCoordenacao(carregado, arco, opcoes, () => ({ novos: [{ tipo: 'batida' }], resultado: null }));
}

/**
 * A8 da revisão: o dono revogou o arco nesta máquina, e a revogação vai ao ramo para valer em todas. Só com o arco revogado
 * aqui pela N1; uma vez por máquina. Vale para sempre: nenhuma ordem, aceite, vaga ou vez nova sai depois dela.
 */
export function revogarNaRede(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): boolean {
  const quando = opcoes.quando ?? new Date().toISOString();
  if (lerArco(carregado.raiz, arco, quando)?.situacao !== 'revogado') {
    throw recusa('noctum.envelope.invalido', `o arco ${arco} não foi revogado pelo dono nesta máquina; a revogação na rede sai só depois da dela`);
  }
  return gravarNaCoordenacao(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const eu = nomeDe(opcoes);
    if (leitura.registros.some(r => r.dados.tipo === 'revogacao' && r.dados.por === eu)) return { novos: [], resultado: false };
    return { novos: [{ tipo: 'revogacao', motivo: 'o dono revogou o arco nesta máquina' }], resultado: true };
  }).resultado;
}

// ---------------------------------------------------------------------------
// Vagas e orçamento somando as máquinas (D3 e D12).
// ---------------------------------------------------------------------------

export interface PedidoDeVagaGlobal { ordem: string; conta: string; runtime: string; reserva: number }

/** Por que a vaga não cabe agora, somando as máquinas; `null` quando cabe. */
function porQueSemVaga(estado: EstadoDaCoordenacao, p: PedidoDeVagaGlobal): RecusaDoArco | null {
  const c = estado.vigente.conteudo;
  if (!envelopeMultimaquina(c)) return recusa('noctum.coordenacao.fora-do-envelope', 'o envelope vigente não é de várias máquinas');
  const limite = c.capacidadeGlobal.porConta.find(x => x.conta === p.conta)?.sessoes;
  if (limite === undefined) return recusa('noctum.coordenacao.fora-do-envelope', `a conta ${p.conta} não está no envelope vigente`);
  if (!c.orcamento.porRuntime.some(r => r.runtime === p.runtime)) return recusa('noctum.coordenacao.fora-do-envelope', `o runtime ${p.runtime} não está no envelope vigente`);
  const ativas = estado.vagas.filter(v => !v.solta && v.conta === p.conta);
  if (ativas.length >= limite) {
    return recusa('noctum.coordenacao.vaga-global', `${ativas.length} sessão(ões) na conta ${p.conta} somando as máquinas, e o limite é ${limite}` +
      ` (${[...new Set(ativas.map(v => v.maquina))].join(', ')})`);
  }
  const tetos: Array<[string, Teto | undefined, number]> = [['do arco', c.orcamento.arco, estado.consumo.arco],
    [`da conta ${p.conta}`, c.orcamento.porConta.find(x => x.conta === p.conta)?.teto, estado.consumo.porConta[p.conta] ?? 0],
    [`do runtime ${p.runtime}`, c.orcamento.porRuntime.find(x => x.runtime === p.runtime)?.teto, estado.consumo.porRuntime[p.runtime] ?? 0]];
  for (const [nome, teto, usado] of tetos) {
    if (!teto) return recusa('noctum.coordenacao.fora-do-envelope', `sem teto ${nome} no envelope vigente`);
    if (teto.unidade !== 'sessoes') {
      // RM-058 N6: a medição das outras unidades é desta máquina; somar as máquinas só sabe contar sessões.
      return recusa('noctum.orcamento.sem-medicao',
        `o teto ${nome} está em ${teto.unidade}, e a soma entre máquinas só mede sessoes: consumo desconhecido nunca vale zero`);
    }
    if (usado + 1 > teto.valor) return recusa('noctum.orcamento.esgotado', `o teto ${nome} é de ${teto.valor} sessoes e ${usado} já foram reservadas somando as máquinas`);
  }
  return null;
}

/** As contas sem vaga global agora, somando as máquinas: o passo da máquina as tira da escolha da N2. */
export function contasSemVagaGlobal(estado: EstadoDaCoordenacao): Set<string> {
  const c = estado.vigente.conteudo;
  if (!envelopeMultimaquina(c)) return new Set();
  return new Set(c.capacidadeGlobal.porConta.filter(x => estado.vagas.filter(v => !v.solta && v.conta === x.conta).length >= x.sessoes).map(x => x.conta));
}

/**
 * Toma a vaga global de um despacho desta máquina, depois da reserva local (o `seq` dela) e antes do lançamento: a ordem é
 * desta máquina, aceita e não cancelada, o arco está vigente aqui e não revogado na rede, a conta tem vaga somando as
 * máquinas e os tetos do arco, da conta e do runtime cabem mais uma sessão. Idempotente pela reserva local.
 */
export function tomarVagaGlobal(carregado: ManifestoCarregado, arco: string, p: PedidoDeVagaGlobal, opcoes: OpcoesDaCoordenacao = {}): string {
  const quando = opcoes.quando ?? new Date().toISOString();
  exigirArcoVigente(carregado, arco, quando);
  return gravarNaCoordenacao(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const vaga = `V-${eu.nome}-${p.reserva}`;
    const ja = estado.vagas.find(v => v.vaga === vaga);
    if (ja) {
      if (ja.ordem !== p.ordem || ja.conta !== p.conta || ja.runtime !== p.runtime) {
        throw recusa('noctum.coordenacao.concorrencia', `a vaga ${vaga} já existe para outro despacho`);
      }
      // S2 da rodada 2: a vaga já solta com o mesmo `seq` é um `seq` local repetido (raiz de estado nova), não esta reserva.
      if (ja.solta) throw recusa('noctum.coordenacao.concorrencia', `a vaga ${vaga} já foi tomada e solta; o seq local ${p.reserva} se repetiu`);
      return { novos: [], resultado: vaga };
    }
    exigirNaoRevogada(estado);
    const o = exigirOrdem(estado, p.ordem);
    if (o.maquina !== eu.nome || o.estado !== 'aceita') {
      throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${p.ordem} não é uma ordem aceita e viva desta máquina (${o.estado})`);
    }
    if (o.envelopeSha256 !== vigente.envelopeSha256) throw recusa('noctum.efeito.hash-antigo', `a ordem ${p.ordem} é de outra versão do envelope`);
    const nao = porQueSemVaga(estado, p);
    if (nao) throw nao;
    const c = vigente.conteudo as ConteudoDoEnvelope & { capacidadeGlobal: { porConta: Array<{ conta: string }> } };
    return { novos: [{ tipo: 'vaga', vaga, conta: c.capacidadeGlobal.porConta.findIndex(x => x.conta === p.conta), runtime: p.runtime,
      ordem: p.ordem, trabalho: o.trabalho, reserva: p.reserva }], resultado: vaga };
  }).resultado;
}

/** Solta a vaga global desta máquina, dizendo se a sessão consumiu (a recusa antes do lançamento não consome). */
export function soltarVagaGlobal(carregado: ManifestoCarregado, arco: string, vaga: string, soltura: { consumiu: boolean; motivo: string },
  opcoes: OpcoesDaCoordenacao = {}): void {
  const daSoltura = motivoPublico(soltura.motivo, 'a soltura da vaga');
  gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const eu = nomeDe(opcoes);
    const v = estado.vagas.find(x => x.vaga === vaga);
    if (!v || v.maquina !== eu) throw recusa('noctum.coordenacao.ordem-vencida', `a vaga ${vaga} não é desta máquina`);
    if (v.solta) return { novos: [], resultado: null };
    return { novos: [{ tipo: 'vaga-solta', vaga, consumiu: soltura.consumiu, motivo: daSoltura }], resultado: null };
  });
}

// ---------------------------------------------------------------------------
// A reserva do item na branch da RM-047 (D11).
// ---------------------------------------------------------------------------

export type MotivoDaReserva = 'noctum.reserva.de-outra-maquina' | 'noctum.reserva.item-invalido' | 'noctum.coordenacao.sem-remoto';
/** O `detalhe` fica nesta máquina (relatório do passo); ao ramo vai só o motivo tipado e o item. */
export type ReservaDoTrabalho = { ok: true; acao: string } | { ok: false; motivo: MotivoDaReserva; detalhe: string };

/**
 * A reserva do item, lida do remoto agora: livre, desta máquina e de quem a usa (`minha`, com qualquer nota, como na N2:
 * a que o dono tomou à mão aqui também vale para o arco daqui), e se é a do arco (`doArco`, pela nota). `null` quando a
 * leitura não veio.
 */
export function reservaDoItem(carregado: ManifestoCarregado, arco: string, item: string, opcoes: OpcoesDaCoordenacao = {}):
  { livre: boolean; minha: boolean; doArco: boolean } | null {
  const { raiz } = carregado;
  const eu = quemSouEu(raiz, { maquina: opcoes.maquina });
  let painel;
  try { painel = listarReservas(raiz, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, rede: opcoes.rede }); }
  catch { return null; }
  if (!painel.atualizado) return null;
  const r = painel.reservas.find(x => x.item === item);
  const minha = !!r && r.maquina === eu.maquina && r.por === eu.por;
  return { livre: !r, minha, doArco: minha && r!.nota === notaDaReserva(arco) };
}

/** O erro do `pegarItem`, tipado (A6 da revisão): reserva de fora, item que o roadmap daqui não tem, ou rede. */
function motivoDoPegar(e: unknown): { motivo: MotivoDaReserva; detalhe: string } {
  const msg = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);
  if (msg.startsWith('roadmap.reservado')) return { motivo: 'noctum.reserva.de-outra-maquina', detalhe: 'o item está com outra máquina ou pessoa' };
  if (msg.startsWith('roadmap.item')) return { motivo: 'noctum.reserva.item-invalido', detalhe: msg };
  return { motivo: 'noctum.coordenacao.sem-remoto', detalhe: msg };
}

/**
 * Toma a reserva do item da ordem aceita desta máquina e a revalida com leitura nova. Nunca força: a reserva de outra
 * máquina ou pessoa volta `noctum.reserva.de-outra-maquina`, e quem chama encerra a ordem que nunca despachou. A que já é
 * desta máquina vale como está, sem regravar (a nota do dono fica, e a reconciliação não a solta). O item que o roadmap
 * desta máquina não tem volta `noctum.reserva.item-invalido`.
 */
export function tomarReservaDoTrabalho(carregado: ManifestoCarregado, arco: string, ordem: string, thread: string | null,
  opcoes: OpcoesDaCoordenacao = {}): ReservaDoTrabalho {
  const estado = lerCoordenacao(carregado, arco, opcoes);
  const eu = nomeDe(opcoes);
  const o = exigirOrdem(estado, ordem);
  if (o.maquina !== eu || o.estado !== 'aceita') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} não é uma ordem aceita e viva desta máquina`);
  const antes = reservaDoItem(carregado, arco, o.item, opcoes);
  if (antes === null) return { ok: false, motivo: 'noctum.coordenacao.sem-remoto', detalhe: 'as reservas não se leram agora' };
  let acao = 'revalidada';
  if (!antes.minha) {
    if (!antes.livre) return { ok: false, motivo: 'noctum.reserva.de-outra-maquina', detalhe: `o item ${o.item} está com outra máquina ou pessoa` };
    try {
      // `threadEsperada: null`: quem tomou o item com thread entre a leitura e a gravação faz o pegar voltar sem gravar.
      acao = pegarItem(carregado.raiz, o.item, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, maquina: eu, thread,
        nota: notaDaReserva(arco), rede: opcoes.rede, threadEsperada: null }).acao;
    } catch (e) { return { ok: false, ...motivoDoPegar(e) }; }
  }
  const agora = reservaDoItem(carregado, arco, o.item, opcoes);
  if (agora === null) return { ok: false, motivo: 'noctum.coordenacao.sem-remoto', detalhe: 'a revalidação da reserva não leu o remoto' };
  if (!agora.minha) return { ok: false, motivo: 'noctum.reserva.de-outra-maquina', detalhe: `o item ${o.item} está com outra máquina ou pessoa depois de tomar` };
  return { ok: true, acao };
}

/** Solta a reserva do item quando ela é desta máquina e do arco (pela nota); a de outra máquina ou do dono fica. */
export function soltarReservaDoArco(carregado: ManifestoCarregado, arco: string, item: string, opcoes: OpcoesDaCoordenacao = {}): boolean {
  const agora = reservaDoItem(carregado, arco, item, opcoes);
  if (!agora?.doArco) return false;
  const eu = nomeDe(opcoes);
  return soltarItem(carregado.raiz, item, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, maquina: eu, rede: opcoes.rede }).acao === 'soltou';
}

// ---------------------------------------------------------------------------
// A reconciliação da coordenação (D4, D10 e D12): o que a máquina que volta faz com os registros dela.
// ---------------------------------------------------------------------------

/** O que esta máquina sabe de si, para reconciliar: o log local do arco, as sessões que ocupam agora e as threads. */
export interface FatosLocaisDaMaquina {
  arcoVigente: boolean;
  /** O desfecho local de cada reserva de despacho do arco, pelo `seq`. */
  despachos: ReadonlyMap<number, { desfecho: 'pendente' | 'concluido' | 'recusado'; sessionId: string | null; idempotente?: boolean }>;
  /** As sessões que ocupam agora (a leitura de capacidade da N2); `null` quando ela teve lacuna. */
  sessoesVivas: ReadonlySet<string> | null;
  /** A thread local de cada trabalho, quando há uma só: se foi entregue ou fechou. */
  threads: ReadonlyMap<string, { id: string; entregue: boolean; fechada: boolean }>;
  /**
   * As vezes desta máquina abandonadas pela autoridade que a reconciliação da integração conferiu agora, com a base lida e
   * sem a fonte (`chave/n`). A ordem com vez abandonada fora daqui espera: o merge pode ter chegado à base (A7 da revisão).
   */
  vezesConferidas?: ReadonlySet<string>;
  /** As vezes desta máquina cuja fonte a reconciliação achou na base por um merge fora da base provada (`chave/n`). */
  vezesSemProva?: ReadonlySet<string>;
  /**
   * A chave desta raiz (G8-6): com ela, a ordem que só outra chave da máquina pode fechar (a da raiz nova, para a raiz antiga
   * que volta depois de uma troca de chave) fica fora do plano, e as vagas dela também. Sem ela, vale o nome.
   */
  chave?: string;
}

export interface PlanoDeReconciliacao {
  novos: CamposDoRegistro[];
  /** As ordens desta máquina que viram fim confirmado agora. */
  encerradas: string[];
  concluidas: string[];
  /** As vagas soltas agora. */
  soltas: string[];
  /** Ordens vencidas que ainda têm sessão viva nesta máquina: ficam isoladas até ela terminar (a N4 a para). */
  aguardando: Array<{ ordem: string; porque: string }>;
  /** Os itens sem ordem viva desta máquina: a reserva do arco neles pode ser solta. */
  itensSemOrdemViva: string[];
}

/** A vaga ainda tem sessão viva (ou incerta) nesta máquina? */
function vagaViva(v: VagaDerivada, fatos: FatosLocaisDaMaquina): boolean {
  const d = fatos.despachos.get(v.reserva);
  if (!d || d.desfecho === 'pendente') return true;
  if (d.desfecho === 'recusado') return false;
  // A2 da rodada 2: o despacho idempotente não abriu sessão (a fase já corria); a vaga dele não espera sessão nenhuma e é
  // solta com consumo, como a N2 conta a reserva concluída.
  if (d.idempotente) return false;
  return fatos.sessoesVivas === null || d.sessionId === null || fatos.sessoesVivas.has(d.sessionId);
}

/**
 * O plano puro da reconciliação desta máquina: conclui as ordens cuja thread local terminou, encerra as vencidas sem sessão
 * viva (soltando as vagas delas) e solta as vagas cujo despacho local foi recusado ou cuja sessão acabou. A pendente fica,
 * contada, até a N4. Os itens para soltar a reserva são os das ordens desta máquina, de qualquer versão do envelope.
 */
export function planejarReconciliacao(estado: EstadoDaCoordenacao, eu: string, fatos: FatosLocaisDaMaquina): PlanoDeReconciliacao {
  const plano: PlanoDeReconciliacao = { novos: [], encerradas: [], concluidas: [], soltas: [], aguardando: [], itensSemOrdemViva: [] };
  const daRaiz = (o: OrdemDerivada): boolean => o.maquina === eu && (fatos.chave === undefined || ordemDaRaiz(estado, o, { nome: eu, chave: fatos.chave }));
  // G8-6: a vaga que outra chave da máquina tomou (a da raiz antiga, depois de uma troca de chave) tem o despacho no log de
  // outra raiz: aqui ela conta como viva, e só a raiz dela a solta.
  const daChave = (v: VagaDerivada): boolean => v.maquina === eu && (fatos.chave === undefined || v.chave === fatos.chave);
  const minhas = estado.vagas.filter(v => daChave(v) && !v.solta);
  const soltar = (v: VagaDerivada, motivo: string) => {
    if (plano.soltas.includes(v.vaga)) return;
    const d = fatos.despachos.get(v.reserva);
    plano.novos.push({ tipo: 'vaga-solta', vaga: v.vaga, consumiu: d?.desfecho !== 'recusado', motivo });
    plano.soltas.push(v.vaga);
  };
  for (const o of estado.ordens.values()) {
    if (!daRaiz(o) || (o.estado !== 'aceita' && o.estado !== 'isolada')) continue;
    const th = fatos.threads.get(o.trabalho);
    if (th && (th.entregue || th.fechada)) {
      plano.novos.push({ tipo: 'recibo', ordem: o.ordem, recibo: 'concluida', motivo: `thread local ${th.entregue ? 'entregue' : 'fechada sem entrega'}`,
        resultado: th.entregue ? 'entregue' : 'encerrado-sem-entrega', thread: th.id });
      plano.concluidas.push(o.ordem);
      continue;
    }
    const porque = o.cancelada ? `cancelada pela autoridade: ${o.cancelada.motivo}`
      : o.envelopeSha256 !== estado.vigente.envelopeSha256 ? 'a ordem é de uma versão anterior do envelope'
        : estado.revogada ? `o arco foi revogado na máquina ${estado.revogada.por}`
          : !fatos.arcoVigente ? 'o arco não está vigente nesta máquina' : null;
    if (!porque) continue;
    // Uma vez de integrar ativa é um merge que pode ter acontecido: a reconciliação da integração decide antes (D13).
    const dasVezes = [...estado.vezes.values()].flat().filter(v => v.ordem === o.ordem);
    if (dasVezes.some(v => !v.fim)) {
      plano.aguardando.push({ ordem: o.ordem, porque: `${porque}; a vez de integrar dela está ativa, e o merge pode ter chegado à base` });
      continue;
    }
    // B-R2A-1 da rodada 2: a fonte que chegou à base sem prova sobre a base provada não é refeita em outra máquina: a ordem
    // fica, e o trabalho espera a inspeção do dono.
    if (!estado.entregas.has(o.trabalho) && dasVezes.some(v => v.fim?.desfecho === 'sem-prova' || fatos.vezesSemProva?.has(`${v.chave}/${v.n}`))) {
      plano.aguardando.push({ ordem: o.ordem, porque: `${porque}; a fonte dela chegou à base por um merge fora da base provada, e o trabalho espera a inspeção` });
      continue;
    }
    if (!estado.entregas.has(o.trabalho) &&
        dasVezes.some(v => v.fim?.desfecho === 'abandonada' && !fatos.vezesConferidas?.has(`${v.chave}/${v.n}`))) {
      plano.aguardando.push({ ordem: o.ordem, porque: `${porque}; a vez de integrar dela foi abandonada pela autoridade, e o merge pode ter chegado à base` });
      continue;
    }
    const dela = estado.vagas.filter(v => v.ordem === o.ordem && !v.solta);
    const vivas = dela.filter(v => !daChave(v) || vagaViva(v, fatos));
    if (vivas.length) {
      plano.aguardando.push({ ordem: o.ordem, porque: `${porque}; ${vivas.length} sessão(ões) dela ainda viva(s) ou incerta(s) nesta máquina` });
      continue;
    }
    for (const v of dela) soltar(v, 'fim da ordem');
    plano.novos.push({ tipo: 'recibo', ordem: o.ordem, recibo: 'encerrada', motivo: porque.slice(0, 300),
      checkpoint: { thread: th?.id ?? null, vagasSoltas: dela.map(v => v.vaga).slice(0, TETO_DE_VAGAS_NO_CHECKPOINT) } });
    plano.encerradas.push(o.ordem);
  }
  for (const v of minhas) {
    const d = fatos.despachos.get(v.reserva);
    if (d && !vagaViva(v, fatos)) soltar(v, d.desfecho === 'recusado' ? 'o despacho local foi recusado antes do lançamento' : 'a sessão do despacho acabou');
  }
  const fim = new Set([...plano.concluidas, ...plano.encerradas]);
  // A5 da revisão: os itens de todas as ordens desta máquina, de qualquer versão do envelope (a reserva do arco só nasce de
  // uma ordem aceita dela); o item que uma emenda tirou do envelope também é solto.
  const minhasOrdens = [...estado.ordens.values()].filter(o => o.maquina === eu);
  const itensVivos = new Set(minhasOrdens.filter(o => ordemViva(o) && !fim.has(o.ordem)).map(o => o.item));
  plano.itensSemOrdemViva = [...new Set(minhasOrdens.map(o => o.item))].filter(i => !itensVivos.has(i)).sort();
  return plano;
}

/** Grava o plano da reconciliação, refeito sobre a leitura nova a cada tentativa. */
export function reconciliarCoordenacao(carregado: ManifestoCarregado, arco: string, fatos: FatosLocaisDaMaquina,
  opcoes: OpcoesDaCoordenacao = {}): PlanoDeReconciliacao {
  const chave = fatos.chave ?? identidadeDaMaquina(carregado.raiz, opcoes.maquina).chave;
  return gravarNaCoordenacao(carregado, arco, opcoes, (leitura) => {
    const plano = planejarReconciliacao(derivarCoordenacao(leitura), nomeDe(opcoes), { ...fatos, chave });
    return { novos: plano.novos, resultado: plano };
  }).resultado;
}

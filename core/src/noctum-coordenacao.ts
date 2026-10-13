/**
 * RM-058, fatia N3 (D3, D4 e D8 a D12 da ork-rm058n3): a coordenação entre as máquinas de um arco #Noctum.
 *
 * Tudo aqui é regra sobre o ramo de coordenação que o transporte (`noctum-transporte.ts`) lê conferido e grava por troca
 * atômica. O estado é derivado dos registros a cada leitura, nada fica em memória:
 *
 * - **autoridade por geração** (D8): a primeira máquina que assume fica com a geração 1; a troca vem por cessão assinada
 *   da autoridade vigente ou por tomada forçada, com motivo, quando a batida dela venceu ou ela saiu do envelope. Cada
 *   gravação passa pela troca atômica com a geração lida, então a autoridade antiga que volta não grava nada;
 * - **ordens, recibos e cancelamento** (D9, D10): uma ordem viva por trabalho, emitida só pela autoridade vigente; o
 *   executor não age antes do aceite gravado no remoto, e o aceite e o cancelamento disputam a mesma troca atômica;
 * - **transferência só com prova** (D4): cancelada antes do aceite, recusada, concluída ou encerrada pelo executor, a
 *   ordem libera o trabalho; aceita e cancelada sem o fim confirmado, o trabalho fica isolado. Falta de batida nunca solta
 *   ordem, vaga, vez nem reserva;
 * - **vagas e orçamento somando as máquinas** (D3, D12): cada despacho toma uma vaga global, que é também o consumo do
 *   arco, da conta e do runtime; a recusa antes do lançamento devolve. A conta vai ao remoto pela posição dela na lista do
 *   envelope (D14), nunca pelo nome;
 * - **reserva do item** (D11): a da RM-047, tomada depois do aceite, sem forçar, e revalidada com leitura nova.
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
  CamposDoRegistro, CHAVE_DO_DESTINO, DadosDoRegistro, euNaVersaoVigente, gravarNoRamo, ID_DA_ORDEM, ID_DA_VAGA, LeituraDoRamo, lerRamo,
  NOME_DE_MAQUINA, OpcoesDoTransporte, RECIBOS, TipoDeRecibo, VersaoDoEnvelope,
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
export type DesfechoDaVez = 'entregue' | 'invalidado' | 'desistiu';

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
  fim: { em: string; desfecho: DesfechoDaVez; motivo: string; merge: string | null } | null;
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
}

export type OpcoesDaCoordenacao = OpcoesDoTransporte;

const adulterado = (detalhe: string) => new RecusaDoArco('noctum.coordenacao.adulterado', `${detalhe}; o ramo de coordenação exige inspeção`);
const recusa = (motivo: ConstructorParameters<typeof RecusaDoArco>[0], detalhe: string) => new RecusaDoArco(motivo, detalhe);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inteiro = (v: unknown, minimo = 1): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= minimo;
const linha = (v: unknown, teto = 300): v is string => typeof v === 'string' && v.length <= teto && !/[\r\n]/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v);
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

/**
 * O estado da coordenação, derivado da leitura conferida. Confere o contrato de cada tipo e a coerência entre eles (quem
 * assina o quê, gerações contíguas, uma ordem viva por trabalho, uma vez ativa por destino, recibos que não se
 * contradizem); qualquer falha é `noctum.coordenacao.adulterado`.
 */
export function derivarCoordenacao(leitura: LeituraDoRamo): EstadoDaCoordenacao {
  const versoes = new Map(leitura.versoes.map(v => [v.envelopeSha256, v]));
  const vigente = leitura.versoes.at(-1)!;
  const daVersao = (d: DadosDoRegistro) => versoes.get(d.envelopeSha256)!.conteudo;
  const porTipo = (tipo: string) => leitura.registros.filter(r => r.dados.tipo === tipo);

  // Autoridade e cessões.
  const cessoes = new Map<number, { para: string; em: string; motivo: string; por: string }>();
  for (const { caminho, dados: d } of porTipo('cessao')) {
    campos(d, caminho, { geracao: v => inteiro(v), para: v => typeof v === 'string' && NOME_DE_MAQUINA.test(v), motivo: v => linha(v) });
    cessoes.set(d.geracao as number, { para: d.para as string, em: d.em, motivo: d.motivo as string, por: d.por });
  }
  const brutas = porTipo('autoridade').map(({ caminho, dados: d }) => {
    campos(d, caminho, { geracao: v => inteiro(v), modo: v => v === 'primeira' || v === 'cessao' || v === 'forcada', motivo: v => linha(v),
      anterior: v => v === null || (objeto(v) && inteiro(v.geracao) && typeof v.maquina === 'string' && Object.keys(v).length === 2) },
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
    if (d.modo === 'cessao' && cessoes.get(g - 1)?.para !== d.por) throw adulterado(`a geração ${g} diz cessão sem a cessão da ${g - 1} para ${d.por}`);
    if (d.modo === 'forcada' && !(d.motivo as string).trim()) throw adulterado(`a geração ${g} foi tomada à força sem motivo`);
    autoridades.push({ geracao: g, maquina: d.por, desde: d.em, modo: d.modo as ModoDaAutoridade, motivo: d.motivo as string });
  });
  for (const [g, c] of cessoes) {
    if (!autoridades[g - 1] || autoridades[g - 1].maquina !== c.por) throw adulterado(`cessão da geração ${g} assinada por quem não era a autoridade`);
  }
  const autoridadeDa = (g: number) => autoridades[g - 1];

  // Ordens, cancelamentos e recibos.
  const ordens = new Map<string, OrdemDerivada>();
  for (const { caminho, dados: d } of porTipo('ordem')) {
    campos(d, caminho, { ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), trabalho: v => typeof v === 'string' && ID_DO_TRABALHO.test(v),
      item: v => typeof v === 'string' && /^RM-\d{3}$/.test(v), maquina: v => typeof v === 'string' && NOME_DE_MAQUINA.test(v),
      geracao: v => inteiro(v), n: v => inteiro(v) });
    if (d.ordem !== `O-${String(d.trabalho)}-${String(d.n)}`) throw adulterado(`${caminho} com id que não é o do trabalho e do número`);
    if (!autoridadeDa(d.geracao as number) || autoridadeDa(d.geracao as number).maquina !== d.por) {
      throw adulterado(`${caminho} assinada por quem não era a autoridade da geração ${String(d.geracao)}`);
    }
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
    if (!autoridadeDa(d.geracao as number) || autoridadeDa(d.geracao as number).maquina !== d.por) {
      throw adulterado(`${caminho} assinado por quem não era a autoridade da geração ${String(d.geracao)}`);
    }
    o.cancelada = { em: d.em, motivo: d.motivo as string, por: d.por };
  }
  for (const { caminho, dados: d } of porTipo('recibo')) {
    campos(d, caminho, { ordem: v => typeof v === 'string' && ID_DA_ORDEM.test(v), recibo: v => (RECIBOS as readonly unknown[]).includes(v),
      motivo: v => linha(v) }, { resultado: v => v === 'entregue' || v === 'encerrado-sem-entrega', thread: v => v === null || linha(v, 80),
      checkpoint: v => objeto(v) && JSON.stringify(v).length <= 2048 });
    const o = ordens.get(d.ordem as string);
    if (!o) throw adulterado(`${caminho} de uma ordem que não existe`);
    if (o.maquina !== d.por) throw adulterado(`${caminho} assinado por quem não é o executor da ordem`);
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
    const conteudo = daVersao(d);
    const conta = envelopeMultimaquina(conteudo) ? conteudo.capacidadeGlobal.porConta[d.conta as number]?.conta : undefined;
    if (!conta || !conteudo.orcamento.porRuntime.some(r => r.runtime === d.runtime)) throw adulterado(`${caminho} com conta ou runtime fora do envelope dela`);
    const v: VagaDerivada = { vaga: d.vaga as string, maquina: d.por, conta, runtime: d.runtime as string, ordem: d.ordem as string,
      trabalho: d.trabalho as string, reserva: d.reserva as number, desde: d.em, solta: null };
    vagas.push(v);
    porVaga.set(v.vaga, v);
  }
  for (const { caminho, dados: d } of porTipo('vaga-solta')) {
    campos(d, caminho, { vaga: v => typeof v === 'string' && ID_DA_VAGA.test(v), consumiu: v => typeof v === 'boolean', motivo: v => linha(v) });
    const v = porVaga.get(d.vaga as string);
    if (!v || v.maquina !== d.por) throw adulterado(`${caminho} de uma vaga que não existe ou não é de quem solta`);
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
    vezes.set(d.chave as string, [...(vezes.get(d.chave as string) ?? []), { chave: d.chave as string, n: d.n as number, maquina: d.por,
      ordem: d.ordem as string, trabalho: d.trabalho as string, destino, candidato: d.candidato as CandidatoDeIntegracao, desde: d.em, fim: null }]);
  }
  for (const { caminho, dados: d } of porTipo('vez-fim')) {
    campos(d, caminho, { chave: v => typeof v === 'string' && CHAVE_DO_DESTINO.test(v), n: v => inteiro(v),
      desfecho: v => v === 'entregue' || v === 'invalidado' || v === 'desistiu', motivo: v => linha(v) }, { merge: v => v === null || sha(v) });
    const vez = vezes.get(d.chave as string)?.find(x => x.n === d.n);
    if (!vez || vez.maquina !== d.por) throw adulterado(`${caminho} de uma vez que não existe ou não é de quem a encerra`);
    vez.fim = { em: d.em, desfecho: d.desfecho as DesfechoDaVez, motivo: d.motivo as string, merge: (d.merge as string | null | undefined) ?? null };
  }
  for (const [chave, lista] of vezes) {
    lista.sort((a, b) => a.n - b.n);
    if (lista.some((v, i) => v.n !== i + 1)) throw adulterado(`as vezes do destino ${chave} não são contíguas`);
    if (lista.filter(v => !v.fim).length > 1) throw adulterado(`o destino ${chave} tem duas vezes ativas`);
  }

  // Batidas.
  const batidas = new Map<string, string>();
  for (const { caminho, dados: d } of porTipo('batida')) {
    campos(d, caminho, {});
    batidas.set(d.por, d.em);
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
    ordens, trabalhos, vagas, consumo, vezes, entregas, batidas };
}

/** A leitura conferida e derivada, nova do remoto. */
export function lerCoordenacao(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): EstadoDaCoordenacao {
  return derivarCoordenacao(lerRamo(carregado, arco, opcoes));
}

/** A situação de um trabalho na rede: é por ela que a N4 sabe se pode transferir (só `livre`). */
export function situacaoDoTrabalho(estado: EstadoDaCoordenacao, trabalho: string): SituacaoDoTrabalho | null {
  return estado.trabalhos.get(trabalho) ?? null;
}

/** Os trabalhos entregues em qualquer máquina, com o instante: a N2 os conta como entregues nas dependências. */
export function entreguesNaRede(estado: EstadoDaCoordenacao): Map<string, string> {
  return new Map([...estado.trabalhos.values()].filter(s => s.estado === 'entregue').map(s => [s.trabalho, s.entregueEm!]));
}

/** A batida da máquina é recente no instante dado? A própria máquina, que está rodando agora, sempre é. */
export function batidaRecente(estado: EstadoDaCoordenacao, maquina: string, eu: string, quando: string): boolean {
  if (maquina === eu) return true;
  const em = estado.batidas.get(maquina);
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
  if (e.situacao === 'expirado') throw recusa('noctum.efeito.expirado', `a janela do arco ${arco} terminou em ${e.conteudo.janela.fim}`);
  if (e.situacao !== 'vigente') throw recusa('noctum.efeito.fora-da-janela', `a janela do arco ${arco} só começa em ${e.conteudo.janela.inicio}`);
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
 * idempotente. A de outra máquina só com a cessão dela para esta, ou com `forcar` e motivo quando a batida dela venceu
 * ou ela saiu do envelope vigente; senão, `noctum.coordenacao.autoridade-ativa`.
 */
export function assumirAutoridade(carregado: ManifestoCarregado, arco: string,
  opcoes: OpcoesDaCoordenacao & { forcar?: { motivo: string } } = {}): AutoridadeDerivada {
  const quando = opcoes.quando ?? new Date().toISOString();
  exigirArcoVigente(carregado, arco, quando);
  const r = gravarNoRamo<AutoridadeDerivada>(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = estado.autoridade;
    const nova = (geracao: number, modo: ModoDaAutoridade, motivo: string): AutoridadeDerivada => ({ geracao, maquina: eu.nome, desde: quando, modo, motivo });
    if (!a) {
      return { novos: [{ tipo: 'autoridade', geracao: 1, modo: 'primeira', motivo: 'primeira autoridade do arco', anterior: null }],
        resultado: nova(1, 'primeira', 'primeira autoridade do arco') };
    }
    if (a.maquina === eu.nome) return { novos: [], resultado: a };
    const anterior = { geracao: a.geracao, maquina: a.maquina };
    if (estado.cessoes.get(a.geracao)?.para === eu.nome) {
      const motivo = estado.cessoes.get(a.geracao)!.motivo;
      return { novos: [{ tipo: 'autoridade', geracao: a.geracao + 1, modo: 'cessao', motivo, anterior }], resultado: nova(a.geracao + 1, 'cessao', motivo) };
    }
    if (opcoes.forcar) {
      const motivo = String(opcoes.forcar.motivo ?? '').trim();
      if (!linha(motivo) || !motivo) throw recusa('noctum.envelope.invalido', 'a tomada forçada da autoridade exige motivo em uma linha');
      const fora = !envelopeMultimaquina(vigente.conteudo) || !vigente.conteudo.maquinas.some(m => m.nome === a.maquina);
      if (!fora && batidaRecente(estado, a.maquina, eu.nome, quando)) {
        throw recusa('noctum.coordenacao.autoridade-ativa', `a autoridade ${a.maquina} bateu há menos de ${BATIDA_VENCIDA_MS / 60000} min; tomar à força exige a batida vencida`);
      }
      return { novos: [{ tipo: 'autoridade', geracao: a.geracao + 1, modo: 'forcada', motivo, anterior,
        batidaDaAnterior: estado.batidas.get(a.maquina) ?? null }], resultado: nova(a.geracao + 1, 'forcada', motivo) };
    }
    throw recusa('noctum.coordenacao.autoridade-ativa', `a autoridade vigente é ${a.maquina}, geração ${a.geracao}; troca só por cessão dela ou tomada forçada`);
  });
  return r.resultado;
}

/** A autoridade vigente cede a vez a outra máquina do envelope; a outra assume com `assumirAutoridade`. */
export function cederAutoridade(carregado: ManifestoCarregado, arco: string, para: string, motivo: string, opcoes: OpcoesDaCoordenacao = {}): void {
  gravarNoRamo(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = exigirAutoridade(estado, eu.nome);
    if (para === eu.nome || !maquinasDe(vigente.conteudo).some(m => m.nome === para)) {
      throw recusa('noctum.coordenacao.fora-do-envelope', `a cessão vai a outra máquina do envelope vigente, não a ${para}`);
    }
    if (!linha(motivo) || !motivo.trim()) throw recusa('noctum.envelope.invalido', 'a cessão exige motivo em uma linha');
    if (estado.cessoes.get(a.geracao)?.para === para) return { novos: [], resultado: null };
    if (estado.cessoes.has(a.geracao)) throw recusa('noctum.coordenacao.concorrencia', `a geração ${a.geracao} já foi cedida`);
    return { novos: [{ tipo: 'cessao', geracao: a.geracao, para, motivo: motivo.trim() }], resultado: null };
  });
}

// ---------------------------------------------------------------------------
// Ordens, cancelamento e recibos (D9 e D10).
// ---------------------------------------------------------------------------

/** As vagas de execução de uma máquina: as da máquina menos as que só o CHECK usa. */
const vagasDeExecucao = (c: ConteudoDoEnvelope): number => (c.capacidade?.maquina ?? 0) - (c.capacidade?.revisao ?? 0);

/**
 * A máquina já recusou este trabalho nesta versão do envelope, ou o encerrou porque a reserva do item está com outra
 * máquina ou pessoa? Ela não recebe a mesma ordem de novo: sem isso, a ordem iria e voltaria a cada passo.
 */
function recusou(estado: EstadoDaCoordenacao, trabalho: string, maquina: string): boolean {
  return [...estado.ordens.values()].some(o => o.trabalho === trabalho && o.maquina === maquina &&
    o.envelopeSha256 === estado.vigente.envelopeSha256 && (o.estado === 'recusada' ||
      (o.estado === 'encerrada' && String(o.recibos.encerrada?.motivo ?? '').startsWith('noctum.reserva.de-outra-maquina'))));
}

/** Por que a ordem do trabalho para a máquina não sai agora; `null` quando ela pode sair. */
function porQueNaoOrdenar(estado: EstadoDaCoordenacao, trabalho: string, maquina: string, eu: string, quando: string,
  emitidasAgora: ReadonlyArray<{ trabalho: string; item: string; maquina: string }> = []): RecusaDoArco | null {
  const c = estado.vigente.conteudo;
  const t = trabalhoDe(c, trabalho);
  if (!t) return recusa('noctum.despacho.fora-do-envelope', `o trabalho ${trabalho} não está no envelope vigente`);
  if (!maquinasDe(c).some(m => m.nome === maquina)) return recusa('noctum.coordenacao.fora-do-envelope', `a máquina ${maquina} não está no envelope vigente`);
  if (t.maquina && t.maquina !== maquina) return recusa('noctum.coordenacao.fora-do-envelope', `o trabalho ${trabalho} está preso à máquina ${t.maquina}`);
  const s = estado.trabalhos.get(trabalho)!;
  if (s.estado !== 'livre') return recusa('noctum.coordenacao.ordem-viva', `o trabalho ${trabalho} está ${s.estado}${s.ordem ? ` (ordem ${s.ordem.ordem})` : ''}`);
  if (emitidasAgora.some(x => x.trabalho === trabalho)) return recusa('noctum.coordenacao.ordem-viva', `o trabalho ${trabalho} acabou de receber ordem`);
  const faltam = t.dependeDe.filter(d => estado.trabalhos.get(d)?.estado !== 'entregue');
  if (faltam.length) return recusa('noctum.coordenacao.ordem-viva', `o trabalho ${trabalho} depende de ${faltam.join(', ')}, ainda não entregue(s)`);
  const doItem = [...[...estado.ordens.values()].filter(ordemViva).map(o => ({ trabalho: o.trabalho, item: o.item, maquina: o.maquina })),
    ...emitidasAgora].find(o => o.item === t.item && o.trabalho !== trabalho);
  if (doItem && doItem.maquina !== maquina) {
    return recusa('noctum.coordenacao.ordem-viva', `o item ${t.item} está com a máquina ${doItem.maquina} (trabalho ${doItem.trabalho}); a reserva é de uma máquina só`);
  }
  if (!batidaRecente(estado, maquina, eu, quando)) {
    return recusa('noctum.coordenacao.maquina-sem-batida', `a máquina ${maquina} não bate há mais de ${BATIDA_VENCIDA_MS / 60000} min; ela não recebe ordem nova`);
  }
  if (recusou(estado, trabalho, maquina)) return recusa('noctum.coordenacao.ordem-viva', `a máquina ${maquina} já recusou o trabalho ${trabalho} nesta versão do envelope`);
  return null;
}

function camposDaOrdem(estado: EstadoDaCoordenacao, trabalho: string, maquina: string, geracao: number): CamposDoRegistro {
  const t = trabalhoDe(estado.vigente.conteudo, trabalho)!;
  const n = [...estado.ordens.values()].filter(o => o.trabalho === trabalho).length + 1;
  return { tipo: 'ordem', ordem: `O-${trabalho}-${n}`, trabalho, item: t.item, maquina, geracao, n };
}

/** Emite a ordem de um trabalho para uma máquina; só a autoridade vigente, com o arco vigente aqui. */
export function emitirOrdem(carregado: ManifestoCarregado, arco: string, pedido: { trabalho: string; maquina: string },
  opcoes: OpcoesDaCoordenacao = {}): string {
  const quando = opcoes.quando ?? new Date().toISOString();
  exigirArcoVigente(carregado, arco, quando);
  return gravarNoRamo(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = exigirAutoridade(estado, eu.nome);
    const nao = porQueNaoOrdenar(estado, pedido.trabalho, pedido.maquina, eu.nome, quando);
    if (nao) throw nao;
    const campos = camposDaOrdem(estado, pedido.trabalho, pedido.maquina, a.geracao);
    return { novos: [campos], resultado: campos.ordem as string };
  }).resultado;
}

/**
 * D9: a política da autoridade, pura. Na ordem do dono (prioridade e posição no envelope), cada trabalho `livre` com as
 * dependências entregues vai à máquina presa, à do mesmo item ou à máquina com batida recente e menos ordens vivas, até as
 * vagas de execução dela; desempate pela ordem das máquinas no envelope.
 */
export function distribuirOrdens(estado: EstadoDaCoordenacao, eu: string, quando: string): Array<{ trabalho: string; maquina: string }> {
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
    const alvo = candidatas.find(m => vivas.get(m)! < limite && porQueNaoOrdenar(estado, t.id, m, eu, quando, emitidas) === null);
    if (!alvo) continue;
    emitidas.push({ trabalho: t.id, item: t.item, maquina: alvo });
    vivas.set(alvo, vivas.get(alvo)! + 1);
  }
  return emitidas.map(({ trabalho, maquina }) => ({ trabalho, maquina }));
}

/** Os registros das ordens que a política distribui agora, com os números certos mesmo para vários do mesmo trabalho. */
export function registrosDaDistribuicao(estado: EstadoDaCoordenacao, eu: string, quando: string): CamposDoRegistro[] {
  const a = estado.autoridade;
  if (!a || a.maquina !== eu) return [];
  return distribuirOrdens(estado, eu, quando).map(({ trabalho, maquina }) => camposDaOrdem(estado, trabalho, maquina, a.geracao));
}

/** Cancela uma ordem viva; só a autoridade vigente. Antes do aceite, o trabalho fica livre na hora; depois, isolado. */
export function cancelarOrdem(carregado: ManifestoCarregado, arco: string, ordem: string, motivo: string, opcoes: OpcoesDaCoordenacao = {}): EstadoDaOrdem {
  return gravarNoRamo<EstadoDaOrdem>(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const a = exigirAutoridade(estado, eu.nome);
    const o = exigirOrdem(estado, ordem);
    if (o.cancelada) return { novos: [], resultado: o.estado };
    if (!ordemViva(o)) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} já terminou (${o.estado})`);
    if (!linha(motivo) || !motivo.trim()) throw recusa('noctum.envelope.invalido', 'o cancelamento exige motivo em uma linha');
    return { novos: [{ tipo: 'cancelamento', ordem, motivo: motivo.trim(), geracao: a.geracao }],
      resultado: o.estado === 'emitida' ? 'cancelada-antes' : 'isolada' };
  }).resultado;
}

/**
 * O que esta máquina sabe de si para responder uma ordem: a janela do arco, as threads desta raiz (com o item e o modo) e,
 * quando a leitura das reservas veio, os itens que outra máquina ou pessoa já reservou.
 */
export interface FatosDaResposta {
  arcoVigente: boolean;
  threadsLocais: ReadonlyMap<string, { roadmap: string | null; modo: string }>;
  itensDeOutros?: ReadonlySet<string>;
}

/** A resposta desta máquina a uma ordem emitida para ela: aceita ou recusada com o motivo (D10). */
export function respostaAOrdem(estado: EstadoDaCoordenacao, o: OrdemDerivada, eu: string, fatos: FatosDaResposta):
  { recibo: 'aceita' | 'recusada'; motivo: string } {
  if (o.envelopeSha256 !== estado.vigente.envelopeSha256) return { recibo: 'recusada', motivo: 'noctum.efeito.hash-antigo: a ordem é de outra versão do envelope' };
  if (!fatos.arcoVigente) return { recibo: 'recusada', motivo: 'noctum.efeito.fora-da-janela: o arco não está vigente nesta máquina' };
  const t = trabalhoDe(estado.vigente.conteudo, o.trabalho);
  if (!t) return { recibo: 'recusada', motivo: 'noctum.despacho.fora-do-envelope: o trabalho não está no envelope vigente' };
  if (t.maquina && t.maquina !== eu) return { recibo: 'recusada', motivo: `noctum.coordenacao.fora-do-envelope: o trabalho está preso à máquina ${t.maquina}` };
  if (fatos.itensDeOutros?.has(t.item)) {
    return { recibo: 'recusada', motivo: `noctum.reserva.de-outra-maquina: o item ${t.item} está reservado por outra máquina ou pessoa` };
  }
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

/** Responde uma ordem desta máquina. Só a ordem dela, emitida e não cancelada; o aceite exige o arco vigente aqui. */
export function responderOrdem(carregado: ManifestoCarregado, arco: string, ordem: string, resposta: 'aceita' | 'recusada', motivo: string,
  opcoes: OpcoesDaCoordenacao = {}): EstadoDaOrdem {
  const quando = opcoes.quando ?? new Date().toISOString();
  if (resposta === 'aceita') exigirArcoVigente(carregado, arco, quando);
  return gravarNoRamo<EstadoDaOrdem>(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const o = exigirOrdem(estado, ordem);
    if (o.maquina !== eu.nome) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} é da máquina ${o.maquina}`);
    if (o.recibos[resposta]) return { novos: [], resultado: o.estado };
    if (o.estado !== 'emitida') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} está ${o.estado}`);
    if (resposta === 'aceita' && o.envelopeSha256 !== estado.vigente.envelopeSha256) {
      throw recusa('noctum.efeito.hash-antigo', `a ordem ${ordem} é de outra versão do envelope`);
    }
    if (!linha(motivo)) throw recusa('noctum.envelope.invalido', 'o motivo do recibo vai em uma linha');
    return { novos: [{ tipo: 'recibo', ordem, recibo: resposta, motivo }], resultado: resposta === 'aceita' ? 'aceita' : 'recusada' };
  }).resultado;
}

/** O executor conclui a ordem pela thread local: entregue ou fechada sem entrega. Vale também depois do cancelamento. */
export function concluirOrdem(carregado: ManifestoCarregado, arco: string, ordem: string,
  conclusao: { resultado: ResultadoDaConclusao; thread: string | null }, opcoes: OpcoesDaCoordenacao = {}): void {
  gravarNoRamo(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const o = exigirOrdem(estado, ordem);
    if (o.maquina !== eu.nome) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} é da máquina ${o.maquina}`);
    if (o.estado === 'concluida') return { novos: [], resultado: null };
    if (o.estado !== 'aceita' && o.estado !== 'isolada') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} está ${o.estado}`);
    return { novos: [{ tipo: 'recibo', ordem, recibo: 'concluida', motivo: 'thread local ' + conclusao.resultado, resultado: conclusao.resultado,
      thread: conclusao.thread }], resultado: null };
  });
}

/**
 * O executor confirma o fim da ordem (cancelada, de outra versão ou com o arco fora da janela) com o checkpoint do que
 * soltou. Só depois de nenhuma sessão dela viver nesta máquina: é este recibo que prova que o executor antigo parou.
 */
export function encerrarOrdem(carregado: ManifestoCarregado, arco: string, ordem: string,
  fim: { motivo: string; checkpoint: Record<string, unknown> }, opcoes: OpcoesDaCoordenacao = {}): void {
  gravarNoRamo(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const o = exigirOrdem(estado, ordem);
    if (o.maquina !== eu.nome) throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} é da máquina ${o.maquina}`);
    if (o.estado === 'encerrada') return { novos: [], resultado: null };
    if (o.estado !== 'aceita' && o.estado !== 'isolada') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} está ${o.estado}`);
    return { novos: [{ tipo: 'recibo', ordem, recibo: 'encerrada', motivo: fim.motivo.slice(0, 300).replace(/[\r\n]+/g, ' '),
      checkpoint: fim.checkpoint }], resultado: null };
  });
}

/** A batida desta máquina: é ela que diz à autoridade que a máquina está viva para receber ordem nova. */
export function bater(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDaCoordenacao = {}): void {
  gravarNoRamo(carregado, arco, opcoes, () => ({ novos: [{ tipo: 'batida' }], resultado: null }));
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
      return recusa('noctum.orcamento.sem-medicao', `o teto ${nome} está em ${teto.unidade}, e só sessoes é medido: consumo desconhecido nunca vale zero`);
    }
    if (usado + 1 > teto.valor) return recusa('noctum.orcamento.esgotado', `o teto ${nome} é de ${teto.valor} sessoes e ${usado} já foram reservadas somando as máquinas`);
  }
  return null;
}

/**
 * Toma a vaga global de um despacho desta máquina, depois da reserva local (o `seq` dela) e antes do lançamento: a ordem é
 * desta máquina, aceita e não cancelada, o arco está vigente aqui, a conta tem vaga somando as máquinas e os tetos do arco,
 * da conta e do runtime cabem mais uma sessão. Idempotente pela reserva local.
 */
export function tomarVagaGlobal(carregado: ManifestoCarregado, arco: string, p: PedidoDeVagaGlobal, opcoes: OpcoesDaCoordenacao = {}): string {
  const quando = opcoes.quando ?? new Date().toISOString();
  exigirArcoVigente(carregado, arco, quando);
  return gravarNoRamo(carregado, arco, { ...opcoes, quando }, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu, vigente } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const vaga = `V-${eu.nome}-${p.reserva}`;
    const ja = estado.vagas.find(v => v.vaga === vaga);
    if (ja) {
      if (ja.ordem !== p.ordem || ja.conta !== p.conta || ja.runtime !== p.runtime) {
        throw recusa('noctum.coordenacao.concorrencia', `a vaga ${vaga} já existe para outro despacho`);
      }
      return { novos: [], resultado: vaga };
    }
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
  gravarNoRamo(carregado, arco, opcoes, (leitura) => {
    const estado = derivarCoordenacao(leitura);
    const { eu } = euNaVersaoVigente(carregado.raiz, leitura, opcoes);
    const v = estado.vagas.find(x => x.vaga === vaga);
    if (!v || v.maquina !== eu.nome) throw recusa('noctum.coordenacao.ordem-vencida', `a vaga ${vaga} não é desta máquina`);
    if (v.solta) return { novos: [], resultado: null };
    return { novos: [{ tipo: 'vaga-solta', vaga, consumiu: soltura.consumiu, motivo: soltura.motivo.slice(0, 300).replace(/[\r\n]+/g, ' ') }], resultado: null };
  });
}

// ---------------------------------------------------------------------------
// A reserva do item na branch da RM-047 (D11).
// ---------------------------------------------------------------------------

export type ReservaDoTrabalho = { ok: true; acao: string } | { ok: false; motivo: 'noctum.reserva.de-outra-maquina' | 'noctum.coordenacao.sem-remoto'; detalhe: string };

/** A reserva do item está com esta máquina agora, lida do remoto? `null` quando a leitura não veio. */
export function reservaDestaMaquina(carregado: ManifestoCarregado, item: string, opcoes: OpcoesDaCoordenacao = {}):
  { minha: boolean; com: string | null; nota: string | null } | null {
  const { raiz } = carregado;
  const eu = quemSouEu(raiz, { maquina: opcoes.maquina });
  let painel;
  try { painel = listarReservas(raiz, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, rede: opcoes.rede }); }
  catch { return null; }
  if (!painel.atualizado) return null;
  const r = painel.reservas.find(x => x.item === item);
  return { minha: !!r && r.maquina === eu.maquina && r.por === eu.por, com: r ? `${r.por} em ${r.maquina}` : null, nota: r?.nota ?? null };
}

/**
 * Toma a reserva do item da ordem aceita desta máquina e a revalida com leitura nova. Nunca força: a reserva de outra
 * máquina ou pessoa volta `noctum.reserva.de-outra-maquina`, e quem chama encerra a ordem com o motivo.
 */
export function tomarReservaDoTrabalho(carregado: ManifestoCarregado, arco: string, ordem: string, thread: string | null,
  opcoes: OpcoesDaCoordenacao = {}): ReservaDoTrabalho {
  const estado = lerCoordenacao(carregado, arco, opcoes);
  const eu = nomeDe(opcoes);
  const o = exigirOrdem(estado, ordem);
  if (o.maquina !== eu || o.estado !== 'aceita') throw recusa('noctum.coordenacao.ordem-vencida', `a ordem ${ordem} não é uma ordem aceita e viva desta máquina`);
  let acao: string;
  try {
    acao = pegarItem(carregado.raiz, o.item, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, maquina: eu, thread,
      nota: notaDaReserva(arco), rede: opcoes.rede }).acao;
  } catch (e) {
    const msg = String((e as Error).message ?? e).split('\n')[0].slice(0, 300);
    if (msg.startsWith('roadmap.reservado')) return { ok: false, motivo: 'noctum.reserva.de-outra-maquina', detalhe: msg };
    return { ok: false, motivo: 'noctum.coordenacao.sem-remoto', detalhe: msg };
  }
  const agora = reservaDestaMaquina(carregado, o.item, opcoes);
  if (agora === null) return { ok: false, motivo: 'noctum.coordenacao.sem-remoto', detalhe: 'a revalidação da reserva não leu o remoto' };
  if (!agora.minha) return { ok: false, motivo: 'noctum.reserva.de-outra-maquina', detalhe: `o item ${o.item} está com ${agora.com ?? 'ninguém'} depois de tomar` };
  return { ok: true, acao };
}

/** Solta a reserva do item quando ela é desta máquina e do arco (pela nota); a de outra máquina ou do dono fica. */
export function soltarReservaDoArco(carregado: ManifestoCarregado, arco: string, item: string, opcoes: OpcoesDaCoordenacao = {}): boolean {
  const agora = reservaDestaMaquina(carregado, item, opcoes);
  if (!agora?.minha || agora.nota !== notaDaReserva(arco)) return false;
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
  despachos: ReadonlyMap<number, { desfecho: 'pendente' | 'concluido' | 'recusado'; sessionId: string | null }>;
  /** As sessões que ocupam agora (a leitura de capacidade da N2); `null` quando ela teve lacuna. */
  sessoesVivas: ReadonlySet<string> | null;
  /** A thread local de cada trabalho, quando há uma só: se foi entregue ou fechou. */
  threads: ReadonlyMap<string, { id: string; entregue: boolean; fechada: boolean }>;
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
  return fatos.sessoesVivas === null || d.sessionId === null || fatos.sessoesVivas.has(d.sessionId);
}

/**
 * O plano puro da reconciliação desta máquina: conclui as ordens cuja thread local terminou, encerra as vencidas sem sessão
 * viva (soltando as vagas delas) e solta as vagas cujo despacho local foi recusado ou cuja sessão acabou. A pendente fica,
 * contada, até a N4.
 */
export function planejarReconciliacao(estado: EstadoDaCoordenacao, eu: string, fatos: FatosLocaisDaMaquina): PlanoDeReconciliacao {
  const plano: PlanoDeReconciliacao = { novos: [], encerradas: [], concluidas: [], soltas: [], aguardando: [], itensSemOrdemViva: [] };
  const minhas = estado.vagas.filter(v => v.maquina === eu && !v.solta);
  const soltar = (v: VagaDerivada, motivo: string) => {
    if (plano.soltas.includes(v.vaga)) return;
    const d = fatos.despachos.get(v.reserva);
    plano.novos.push({ tipo: 'vaga-solta', vaga: v.vaga, consumiu: d?.desfecho !== 'recusado', motivo });
    plano.soltas.push(v.vaga);
  };
  for (const o of estado.ordens.values()) {
    if (o.maquina !== eu || (o.estado !== 'aceita' && o.estado !== 'isolada')) continue;
    const th = fatos.threads.get(o.trabalho);
    if (th && (th.entregue || th.fechada)) {
      plano.novos.push({ tipo: 'recibo', ordem: o.ordem, recibo: 'concluida', motivo: `thread local ${th.entregue ? 'entregue' : 'fechada sem entrega'}`,
        resultado: th.entregue ? 'entregue' : 'encerrado-sem-entrega', thread: th.id });
      plano.concluidas.push(o.ordem);
      continue;
    }
    const porque = o.cancelada ? `cancelada pela autoridade: ${o.cancelada.motivo}`
      : o.envelopeSha256 !== estado.vigente.envelopeSha256 ? 'a ordem é de uma versão anterior do envelope'
        : !fatos.arcoVigente ? 'o arco não está vigente nesta máquina' : null;
    if (!porque) continue;
    // Uma vez de integrar ativa é um merge que pode ter acontecido: a reconciliação da integração decide antes (D13).
    if ([...estado.vezes.values()].flat().some(v => v.ordem === o.ordem && !v.fim)) {
      plano.aguardando.push({ ordem: o.ordem, porque: `${porque}; a vez de integrar dela está ativa, e o merge pode ter chegado à base` });
      continue;
    }
    const dela = minhas.filter(v => v.ordem === o.ordem);
    const vivas = dela.filter(v => vagaViva(v, fatos));
    if (vivas.length) {
      plano.aguardando.push({ ordem: o.ordem, porque: `${porque}; ${vivas.length} sessão(ões) dela ainda viva(s) ou incerta(s) nesta máquina` });
      continue;
    }
    for (const v of dela) soltar(v, 'fim da ordem');
    plano.novos.push({ tipo: 'recibo', ordem: o.ordem, recibo: 'encerrada', motivo: porque.slice(0, 300),
      checkpoint: { thread: th?.id ?? null, vagasSoltas: dela.map(v => v.vaga) } });
    plano.encerradas.push(o.ordem);
  }
  for (const v of minhas) {
    const d = fatos.despachos.get(v.reserva);
    if (d && !vagaViva(v, fatos)) soltar(v, d.desfecho === 'recusado' ? 'o despacho local foi recusado antes do lançamento' : 'a sessão do despacho acabou');
  }
  const fim = new Set([...plano.concluidas, ...plano.encerradas]);
  const itensVivos = new Set([...estado.ordens.values()].filter(o => o.maquina === eu && ordemViva(o) && !fim.has(o.ordem)).map(o => o.item));
  const itens = new Set((estado.vigente.conteudo.trabalhos ?? []).map(t => t.item));
  plano.itensSemOrdemViva = [...itens].filter(i => !itensVivos.has(i)).sort();
  return plano;
}

/** Grava o plano da reconciliação, refeito sobre a leitura nova a cada tentativa. */
export function reconciliarCoordenacao(carregado: ManifestoCarregado, arco: string, fatos: FatosLocaisDaMaquina,
  opcoes: OpcoesDaCoordenacao = {}): PlanoDeReconciliacao {
  return gravarNoRamo(carregado, arco, opcoes, (leitura) => {
    const plano = planejarReconciliacao(derivarCoordenacao(leitura), nomeDe(opcoes), fatos);
    return { novos: plano.novos, resultado: plano };
  }).resultado;
}

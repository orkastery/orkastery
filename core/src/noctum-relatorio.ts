/**
 * RM-058, fatia N6 (D3, D6, D10 e D11 da ork-rm058n6): o relatório da manhã do arco.
 *
 * O formato é o da seção "Relatório da manhã" da página: sete grupos, cada fato tirado do núcleo (o log do arco, a fila,
 * a medição, os ledgers das threads e o fechamento), nunca de texto de agente nem de número inventado:
 *
 *   ✅ Entregue (só com a prova do push; commit local fica em curso), 🔄 Em curso (checkpoint, quem retoma, próximo passo e
 *   reserva ativa), ⏸️ Impedido (causa, alcance e tentativas; `#HITL` só no que depende do dono), 🧭 Decidi no envelope, 💰
 *   Custo e duração (consumo medido contra o teto, com lacuna e teto superior ditos), 📝 Correções ("foi informado" e "fato
 *   confirmado agora") e 👤 O que precisa de você (o lote do dono com as alternativas, e o próximo trabalho elegível).
 *
 * O texto é o mesmo nos três canais (terminal, Telegram e OpenClaw), em páginas de até 3.900 caracteres, cada uma com o
 * arco, a versão e a página no cabeçalho: o envio tem o id do arco, e uma repetição se reconhece.
 *
 * Horário: vence no primeiro `HH:MM` do fuso da janela no instante do início ou depois (D10), pelo `instanteNoFuso`, que
 * trata o horário de verão; o fechamento antecipado não antecipa nada. Entregas são tentadas até 24 h depois do vencimento.
 *
 * Versões: a 1 é composta no vencimento e não muda mais. Versão nova só quando um item que uma versão entregue deu como
 * entregue deixa de valer (a entrega revertida na base): a correção vai explícita, sem apagar o rastro, até 3 versões.
 *
 * Envio (D11): o canal sai pelo transporte local `.orkastery/monitor/noctum-host.json` (fora do git, como o do pulse),
 * uma entrada por canal com o executável e os argumentos com `{{mensagem}}`; a mensagem também vai pela entrada. Código 0
 * é o recibo da página. A tentativa é gravada antes de chamar o transporte e o desfecho depois, sob a trava do registro do
 * relatório. Falha explícita (código diferente de 0, executável ausente) se repete até 5 vezes, com 5 min entre elas;
 * tentativa sem desfecho (prazo estourado, sinal, processo que morreu no meio) nunca se repete sozinha, porque a mensagem
 * pode ter chegado: o dono força com `ork noctum relatorio <arco> --reenviar <canal>`. O terminal tem recibo só quando o
 * relatório é mostrado num terminal interativo pelo `ork noctum relatorio`. Sem recibo, a lacuna aparece no retrato do arco
 * (`retratoDoRelatorio`) e nas correções da versão seguinte.
 *
 * Interfaces para as fatias que correm em paralelo (D6): a supervisão da N4 entra por `supervisao`; desde a integração
 * (T3 da ork-rm058integra), sem ela vale a leitura do log da supervisão do arco (`fatosDaSupervisao`), e o log que não se
 * lê vira lacuna com o motivo. A entrega da N5 é lida dos fatos que o ledger da thread já guarda (`ship_done`,
 * `rollback_done`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { raizDoEstado } from './estado-thread';
import { redigirSegredos } from './hitl';
import { duracaoRelativa, formatarDataHora, formatarHora, instanteNoFuso, partesLocais } from './horario';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { AlternativaDoLote, EstadoDoArco, lerArco, SituacaoDoArco } from './noctum-arco';
import { CanalDoRelatorio, ConteudoDoEnvelope, RecusaDoArco, Unidade } from './noctum-envelope';
import { lerFechamento, textoDaParada, trabalhosDoArco } from './noctum-fechamento';
import { fatosDaFila, FilaDoArco, LeitorDeReservas } from './noctum-fila';
import { ConsumoNaUnidade, consumoDoEscopoNaUnidade, MedicaoDoArco, medirArco, precisaMedir, textoDoConsumo } from './noctum-medicao';
import { comRegistro, lerRegistro, LinhaDoRegistro, RecusaDoRegistro } from './noctum-registro';
import { contaForaAgora, EsperaDoPasso, lerSupervisao, RecusaDaSupervisao, RecusaDoPasso } from './noctum-supervisao';
import { exigirHostLocal } from './procedencia';
import { dirThread } from './thread';
import { EventoLedger } from './types';

export const CONTRATO_RELATORIO = 'ork.noctum-relatorio/v1' as const;
/** O teto de uma mensagem do Telegram é 4.096; a página fica abaixo, com folga, como o digest do MASTER. */
export const TETO_DA_PAGINA = 3900;
export const MAXIMO_DE_TENTATIVAS = 5;
export const INTERVALO_ENTRE_TENTATIVAS_MS = 5 * 60_000;
export const JANELA_DE_ENTREGA_MS = 24 * 3600_000;
export const MAXIMO_DE_VERSOES = 3;
const PRAZO_DO_TRANSPORTE_MS = 30_000;
/** O arquivo local dos transportes do relatório, ao lado do `pulse-host.json`. */
export const ARQUIVO_DO_TRANSPORTE = 'noctum-host.json';

export type CanalComTransporte = Exclude<CanalDoRelatorio, 'terminal'>;
export interface TransporteDoCanal { executavel: string; argumentos: string[] }

export interface ItemEntregue { trabalho: string; item: string; thread: string; pr: number | null; merge: string | null; push: string; master: string }
export interface ItemEmCurso { trabalho: string; item: string; thread: string | null; estado: string; checkpoint: string; retomada: string;
  proximo: string; reserva: string | null }
export interface ItemImpedido { trabalho: string; item: string; thread: string | null; causa: string; detalhe: string;
  alcance: 'trabalho' | 'conta' | 'arco'; tentativas: string; hitl: string | null }
export interface DecisaoNoEnvelope { thread: string; em: string; decidido: string; porque: string; comoMudar: string; evidencia: string }
export interface LinhaDeCusto { escopo: string; unidade: Unidade; teto: number; consumo: ConsumoNaUnidade }
export interface Correcao { trabalho: string | null; informado: string; confirmado: string; fonte: string; impacto: string }
export interface PedidoAoDono { id: string; thread: string; pergunta: string; alternativas: AlternativaDoLote[] }

/**
 * A supervisão da N4, por interface (D6): os trabalhos isolados e as contas que o arco tirou. RM-058, integração (T3): as
 * retomadas que ela autorizou, as sessões que ela parou e a parada do arco, quando a leitura vem do log dela.
 */
export interface FatosDaSupervisao {
  isolados: Array<{ trabalho: string; motivo: string }>;
  contasFora: Array<{ conta: string; motivo: string }>;
  retomadas?: string[];
  sessoesParadas?: string[];
  parada?: string | null;
  espera?: EsperaDoPasso | null;
  recusaDoPasso?: RecusaDoPasso | null;
}

/** As contas fora, em palavras: o motivo tipado da supervisão vira o que aconteceu com a conta. */
const CONTA_FORA_EM_TEXTO: Readonly<Record<string, string>> = Object.freeze({ 'cota': 'cota esgotada', 'cota-sem-reset': 'cota esgotada, sem reset dito',
  'limite-de-uso': 'limite de uso', 'auth': 'login perdido' });

/**
 * RM-058, integração (T3, D7 da ork-rm058integra): os fatos da supervisão do arco, lidos do log dela no instante dado: os
 * isolados com o motivo, as contas ainda fora, as retomadas autorizadas, as sessões paradas e a parada. Sem log, nada a
 * dizer; o log que não se lê lança a recusa tipada (`RecusaDaSupervisao`), que quem chama diz como lacuna.
 */
export function fatosDaSupervisao(raiz: string, arco: string, quando = new Date().toISOString()): FatosDaSupervisao {
  const s = lerSupervisao(raiz, arco);
  return {
    isolados: [...s.isolados.values()].map(i => ({ trabalho: i.trabalho, motivo: `${i.motivo}: ${i.detalhe}` })),
    contasFora: [...s.contasFora.values()].filter(c => contaForaAgora(s, c.conta, quando))
      .map(c => ({ conta: c.conta, motivo: CONTA_FORA_EM_TEXTO[c.motivo] ?? c.motivo })),
    retomadas: s.retomadas.map(r => `${r.trabalho} (thread ${r.thread}): retomada ${r.tentativa} na fase ${r.fase} (${r.motivo})`),
    sessoesParadas: s.sessoesParadas.map(x => `sessão ${x.sessionId} (${x.trabalho}): ${x.confirmada ? 'parada confirmada' : 'parada não confirmada'} ` +
      `(${x.motivo})`),
    parada: s.parada ? `${s.parada.motivo}: ${s.parada.detalhe}` : null,
    espera: s.espera,
    recusaDoPasso: s.recusaDoPasso,
  };
}

export interface FatosDoRelatorio {
  arco: string;
  quando: string;
  fuso: string;
  vencimentoEm: string;
  janela: { inicio: string; fim: string };
  situacao: SituacaoDoArco;
  envelopeSha256: string | null;
  encerramento: { motivo: string; detalhe: string; em: string } | null;
  entregues: ItemEntregue[];
  emCurso: ItemEmCurso[];
  impedidos: ItemImpedido[];
  decisoes: DecisaoNoEnvelope[];
  custo: LinhaDeCusto[];
  /** Sessões que o arco abriu (o despacho concluído com sessão nova). */
  sessoesDespachadas: number;
  /** Reservas pendentes: o runtime pode ter aberto a sessão, e o consumo fica desconhecido até a reconciliação. */
  reservasPendentes: number;
  paradas: string[];
  contasFora: string[];
  /** RM-058, integração (T3): as retomadas que a supervisão autorizou, as sessões que ela parou e a parada do arco. */
  retomadas: string[];
  sessoesParadas: string[];
  paradaDaSupervisao: string | null;
  esperaDoPasso: EsperaDoPasso | null;
  recusaDoPasso: RecusaDoPasso | null;
  correcoes: Correcao[];
  precisaDeVoce: PedidoAoDono[];
  /** O trabalho que espera o dono fora do lote do arco (a pendência da própria thread): sem id do lote, sem `#HITL`. */
  foraDoLote: Array<{ trabalho: string; thread: string; detalhe: string }>;
  proximo: string | null;
  /** Fontes que não foram lidas: o relatório diz o que não sabe, em vez de chamar de vazio. */
  lacunas: string[];
}

/** O que uma versão afirmou e que pode precisar de correção depois. */
export interface InformadoNaVersao { entregues: Array<{ trabalho: string; thread: string; merge: string | null }>; corrigidos: string[] }

type EventoDoRelatorio =
  | { tipo: 'composto'; versao: number; motivo: 'horario' | 'correcao'; vencimentoEm: string; canal: CanalDoRelatorio; sha256: string;
    paginas: string[]; informados: InformadoNaVersao }
  | { tipo: 'envio_tentado'; versao: number; pagina: number; canal: CanalComTransporte; tentativa: number; forcado: boolean }
  | { tipo: 'envio_confirmado'; versao: number; pagina: number; canal: CanalComTransporte; referencia: string | null }
  | { tipo: 'envio_falhou'; versao: number; pagina: number; canal: CanalComTransporte; motivo: string }
  | { tipo: 'envio_incerto'; versao: number; pagina: number; canal: CanalComTransporte; motivo: string }
  | { tipo: 'exibido_no_terminal'; versao: number };

type Linha = LinhaDoRegistro<EventoDoRelatorio>;

export type ResultadoDoEnvio = { estado: 'confirmado'; referencia: string | null } | { estado: 'falhou' | 'incerto'; motivo: string };

export interface OpcoesDoRelatorio {
  quando?: string;
  maquina?: string;
  lerReservas?: LeitorDeReservas;
  /** A medição; em produção, `medirArco` sobre o disco. */
  medir?: (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco;
  /** A supervisão da N4; sem ela, a leitura do log da supervisão do arco (`fatosDaSupervisao`). */
  supervisao?: (raiz: string, arco: string) => FatosDaSupervisao | null;
  /** O envio por canal; em produção, o transporte local do `noctum-host.json`. */
  enviar?: (canal: CanalComTransporte, texto: string) => ResultadoDoEnvio;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** O texto como frase: sem espaço sobrando e com um ponto só no fim. */
const frase = (s: string): string => `${s.trim().replace(/[.\s]+$/u, '')}.`;
const MOTIVO_EM_TEXTO: Readonly<Record<string, string>> = Object.freeze({ revogado: 'revogação do dono', hora: 'hora final',
  custo: 'teto do arco', 'fila-vazia': 'fila vazia', supervisao: 'parada da supervisão' });
/** Os dois fatos que desmentem uma entrega já informada; o resto (lacuna, thread ilegível) nunca vira correção. */
const CAUSA_REVERTIDA = 'entrega revertida na base';
const CHECKPOINT_SEM_PROVA = 'entrega registrada sem a prova do push no remoto';
/** Os bloqueios que valem para o arco inteiro nesta máquina, e não só para o trabalho. */
const BLOQUEIOS_DO_ARCO: readonly string[] = ['reserva-sem-leitura'];

/** D10: o primeiro `HH:MM` do fuso da janela no instante do início ou depois. */
export function vencimentoDoRelatorio(conteudo: Pick<ConteudoDoEnvelope, 'janela' | 'relatorio'>): string {
  const fuso = conteudo.janela.fuso;
  const [hora, minuto] = conteudo.relatorio.horario.split(':').map(Number);
  const inicio = Date.parse(conteudo.janela.inicio);
  const p = partesLocais(inicio, fuso);
  let ms = instanteNoFuso(Number(p.ano), Number(p.mes), Number(p.dia), hora, minuto, fuso);
  if (!(ms >= inicio)) {
    const seguinte = new Date(Date.UTC(Number(p.ano), Number(p.mes) - 1, Number(p.dia) + 1));
    ms = instanteNoFuso(seguinte.getUTCFullYear(), seguinte.getUTCMonth() + 1, seguinte.getUTCDate(), hora, minuto, fuso);
  }
  if (!Number.isFinite(ms)) throw new RecusaDoArco('noctum.envelope.invalido', 'horário do relatório sem instante no fuso da janela');
  return new Date(ms).toISOString();
}

function eventosDe(raiz: string, thread: string, cache: Map<string, EventoLedger[] | null>): EventoLedger[] | null {
  if (!cache.has(thread)) {
    let e: EventoLedger[] | null;
    try { e = lerLedger(dirThread(raiz, thread)); } catch { e = null; }
    cache.set(thread, e);
  }
  return cache.get(thread)!;
}

/** A entrega provada: o último `ship_done` com o push verificado no remoto e sem `rollback_done` depois. */
function entregaDaThread(eventos: EventoLedger[]): { ship: EventoLedger | null; revertida: EventoLedger | null; provada: boolean } {
  const ship = [...eventos].reverse().find(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido) ?? null;
  if (!ship) return { ship: null, revertida: null, provada: false };
  const revertida = eventos.find(e => e.tipo === TIPOS_DE_EVENTO.rollbackConcluido && e.ts >= ship.ts) ?? null;
  return { ship, revertida, provada: ship.pushVerificado === true && !revertida };
}

function ultimaFaseConcluida(eventos: EventoLedger[]): { fase: string; ts: string } | null {
  const r = [...eventos].reverse().find(e => e.tipo === 'phase_result' && e.classificacao === 'fase_concluida' && typeof e.fase === 'string');
  return r ? { fase: String(r.fase), ts: r.ts } : null;
}

function tentativasDo(trabalho: string, estado: EstadoDoArco): string {
  const ds = estado.despachos.filter(d => d.trabalho === trabalho);
  if (!ds.length) return 'nenhum despacho';
  const recusados = ds.filter(d => d.desfecho === 'recusado');
  const motivos = [...new Set(recusados.map(d => d.motivo).filter(Boolean))];
  return `${ds.length} despacho(s)${recusados.length ? `, ${recusados.length} recusado(s) (${motivos.join(', ')})` : ''}`;
}

/**
 * A medição do relatório e do retrato: o relatório só mostra as unidades dos tetos, e com todos em `sessoes` nenhuma
 * transcrição nem rollout precisa ser lido (as sessões vêm do log do arco).
 */
export function medidorDoRelatorio(opcoes: Pick<OpcoesDoRelatorio, 'medir'>, conteudo: ConteudoDoEnvelope):
  (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco {
  if (opcoes.medir) return opcoes.medir;
  if (precisaMedir(conteudo)) return (r, e, q) => medirArco(r, e, { quando: q });
  return (r, e, q) => medirArco(r, e, { quando: q, fontes: { transcricoes: () => null, rollout: () => null } });
}

/** As linhas de custo: o teto do arco, de cada conta e de cada runtime, contra o consumo medido na unidade de cada um. */
function linhasDeCusto(conteudo: ConteudoDoEnvelope, medicao: MedicaoDoArco): LinhaDeCusto[] {
  const o = conteudo.orcamento;
  return [
    { escopo: 'do arco', unidade: o.arco.unidade, teto: o.arco.valor, consumo: consumoDoEscopoNaUnidade(medicao, 'arco', o.arco.unidade) },
    ...o.porConta.map(s => ({ escopo: `da conta ${s.conta}`, unidade: s.teto.unidade, teto: s.teto.valor,
      consumo: consumoDoEscopoNaUnidade(medicao, { conta: s.conta }, s.teto.unidade) })),
    ...o.porRuntime.map(s => ({ escopo: `do runtime ${s.runtime}`, unidade: s.teto.unidade, teto: s.teto.valor,
      consumo: consumoDoEscopoNaUnidade(medicao, { runtime: s.runtime }, s.teto.unidade) })),
  ];
}

/**
 * Os fatos do relatório no instante dado, relidos do disco. `null` sem envelope autorizado. Com `semCusto`, o custo fica
 * vazio e nada é medido: quem compõe mede depois, só quando uma versão vai mesmo ser composta.
 */
export function fatosDoRelatorio(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoRelatorio = {},
  modo: { semCusto?: boolean } = {}): FatosDoRelatorio | null {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  let estado: EstadoDoArco | null;
  try { estado = lerArco(raiz, arco, quando); } catch (e) { if (e instanceof RecusaDoArco) return null; throw e; }
  if (!estado?.conteudo || !estado.autorizadoPor) return null;
  const conteudo = estado.conteudo;
  const fuso = conteudo.janela.fuso;
  const lacunas: string[] = [];
  let fila: FilaDoArco | null = null;
  try { fila = trabalhosDoArco(fatosDaFila(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas })); }
  catch (e) { if (!(e instanceof RecusaDoArco)) throw e; lacunas.push(`a fila do arco não pôde ser lida (${e.motivo})`); }
  if (fila) lacunas.push(...fila.lacunas);
  let fechamento: ReturnType<typeof lerFechamento> | null = null;
  try { fechamento = lerFechamento(raiz, arco); } catch (e) {
    if (!(e instanceof RecusaDoRegistro)) throw e;
    lacunas.push(`o registro do fechamento não se lê (${e.motivo})`);
  }
  // RM-058, integração (T3): sem a interface, o log da supervisão do arco; o que não se lê vira lacuna com o motivo.
  let supervisao: FatosDaSupervisao | null = null;
  try { supervisao = (opcoes.supervisao ?? ((r: string, a: string) => fatosDaSupervisao(r, a, quando)))(raiz, arco); }
  catch (e) { if (!(e instanceof RecusaDaSupervisao)) throw e; lacunas.push(`a supervisão do arco não se lê (${e.motivo})`); }
  if (opcoes.supervisao && !supervisao) lacunas.push('a supervisão da N4 não respondeu');
  const cache = new Map<string, EventoLedger[] | null>();
  const fechado = estado.encerramento !== null || ['revogado', 'expirado', 'encerrado'].includes(estado.situacao);
  const entregues: ItemEntregue[] = [], emCurso: ItemEmCurso[] = [], impedidos: ItemImpedido[] = [];
  const foraDoLote: FatosDoRelatorio['foraDoLote'] = [];
  for (const t of fila?.trabalhos ?? []) {
    const eventos = t.thread ? eventosDe(raiz, t.thread, cache) : null;
    if (t.thread && eventos === null) lacunas.push(`o ledger da thread ${t.thread} (${t.id}) não se lê`);
    const pendente = estado.despachos.find(d => d.trabalho === t.id && d.desfecho === 'pendente');
    const base = { trabalho: t.id, item: t.item, thread: t.thread };
    const isolado = supervisao?.isolados.find(i => i.trabalho === t.id);
    if (t.estado === 'entregue' && t.thread && eventos) {
      const e = entregaDaThread(eventos);
      if (e.provada && e.ship) {
        const master = [...eventos].reverse().find(x => x.tipo === TIPOS_DE_EVENTO.masterConcluido);
        entregues.push({ ...base, thread: t.thread, pr: typeof e.ship.pr === 'number' ? e.ship.pr : null,
          merge: typeof e.ship.mergeSha === 'string' ? e.ship.mergeSha : null,
          push: typeof e.ship.fonteDaProva === 'string' && e.ship.fonteDaProva ? e.ship.fonteDaProva : 'push verificado no remoto',
          master: master && typeof master.score === 'number' ? `MASTER ${master.score}/5` : 'MASTER pendente' });
        continue;
      }
      if (e.revertida) {
        impedidos.push({ ...base, causa: CAUSA_REVERTIDA, alcance: 'trabalho', tentativas: tentativasDo(t.id, estado), hitl: null,
          detalhe: `rollback_done às ${formatarHora(e.revertida.ts, { fuso, agora: quando, locale: 'pt-BR' })}, depois do ship_done` });
        continue;
      }
      emCurso.push({ ...base, estado: t.estado, checkpoint: CHECKPOINT_SEM_PROVA,
        retomada: 'a entrega (N5), com a prova no SHA exato', proximo: 'provar o push e o merge', reserva: null });
      continue;
    }
    if (isolado || t.estado === 'bloqueado' || t.estado === 'encerrado-sem-entrega') {
      const doDono = t.motivo === 'decisao-no-lote' || t.motivo === 'dono';
      const lote = doDono && t.thread ? estado.decisoes.find(d => d.thread === t.thread || d.dependentes.includes(t.thread!))?.id ?? null : null;
      // `#HITL` só com o id estável do lote; a pendência da própria thread vai ao grupo do dono sem ele.
      if (doDono && !lote && t.thread) foraDoLote.push({ trabalho: t.id, thread: t.thread, detalhe: t.detalhe });
      impedidos.push({ ...base, causa: isolado ? 'isolado pela supervisão' : t.estado === 'encerrado-sem-entrega' ? 'fechou sem entrega' : String(t.motivo),
        detalhe: isolado ? isolado.motivo : t.detalhe, alcance: !isolado && t.motivo && BLOQUEIOS_DO_ARCO.includes(t.motivo) ? 'arco' : 'trabalho',
        tentativas: tentativasDo(t.id, estado), hitl: lote });
      continue;
    }
    const concluida = eventos ? ultimaFaseConcluida(eventos) : null;
    // No arco fechado, a sessão em curso recebeu o pedido de parada: "conduzida agora" seria o lease, não o trabalho.
    const proximo = t.fase ? `fase ${t.fase}` : fechado && t.estado === 'em-curso'
      ? 'conferir a sessão que o fechamento mandou parar e retomar pela prova mais adiantada' : t.detalhe;
    emCurso.push({ ...base, estado: t.estado,
      checkpoint: t.estado === 'abrir' ? 'não começou' : concluida
        ? `fase ${concluida.fase} concluída às ${formatarHora(concluida.ts, { fuso, agora: quando, locale: 'pt-BR' })}` : 'sem fase concluída ainda',
      retomada: t.estado === 'aguardando-entrega' ? 'a entrega (N5, com a condutora)' : fechado ? 'um arco novo, com envelope vigente' : 'o passo do arco',
      proximo, reserva: pendente ? `reserva ${pendente.seq} pendente` : null });
  }
  // O piso das decisões: a primeira reserva do arco ou a autorização vigente, a mais antiga. A emenda troca a
  // autorização vigente, e as decisões da versão anterior continuam do envelope.
  const autorizadoEm = [estado.autorizadoPor.recebidoEm, estado.despachos[0]?.reservadoEm]
    .filter((x): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x)))
    .reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
  const decisoes: DecisaoNoEnvelope[] = [];
  for (const thread of [...new Set((fila?.trabalhos ?? []).map(t => t.thread).filter((x): x is string => !!x))]) {
    for (const e of eventosDe(raiz, thread, cache) ?? []) {
      const p = e.pedido as { classe?: unknown; decidido?: unknown; porque?: unknown; comoMudar?: unknown } | undefined;
      if (e.tipo !== TIPOS_DE_EVENTO.decisaoAutonoma || p?.classe !== 'decidido' || e.ts < autorizadoEm) continue;
      decisoes.push({ thread, em: e.ts, decidido: String(p.decidido ?? ''), porque: String(p.porque ?? ''), comoMudar: String(p.comoMudar ?? ''),
        evidencia: String(e.evidencia ?? '') });
    }
  }
  decisoes.sort((a, b) => a.em.localeCompare(b.em));
  const custo = modo.semCusto ? [] : linhasDeCusto(conteudo, medidorDoRelatorio(opcoes, conteudo)(raiz, estado, quando));
  const candidato = fila?.candidatos[0];
  return {
    arco, quando, fuso, vencimentoEm: vencimentoDoRelatorio(conteudo), janela: { inicio: conteudo.janela.inicio, fim: conteudo.janela.fim },
    situacao: estado.situacao, envelopeSha256: estado.envelopeSha256,
    encerramento: estado.encerramento ? { motivo: estado.encerramento.motivo, detalhe: estado.encerramento.detalhe, em: estado.encerramento.em } : null,
    entregues, emCurso, impedidos, decisoes, custo,
    sessoesDespachadas: estado.despachos.filter(d => d.desfecho === 'concluido' && !d.idempotente).length,
    reservasPendentes: estado.despachos.filter(d => d.desfecho === 'pendente').length,
    paradas: (fechamento?.paradas ?? []).map(p => textoDaParada(p, fechamento!.conferencias)),
    contasFora: (supervisao?.contasFora ?? []).map(c => `a conta ${c.conta} saiu do arco: ${c.motivo}`),
    retomadas: supervisao?.retomadas ?? [], sessoesParadas: supervisao?.sessoesParadas ?? [], paradaDaSupervisao: supervisao?.parada ?? null,
    esperaDoPasso: supervisao?.espera ?? null, recusaDoPasso: supervisao?.recusaDoPasso ?? null,
    correcoes: [],
    precisaDeVoce: estado.decisoes.map(d => ({ id: d.id, thread: d.thread, pergunta: d.pergunta, alternativas: d.alternativas })), foraDoLote,
    proximo: candidato ? `${candidato.id} (${candidato.item}), ${candidato.estado === 'abrir' ? 'abre a thread pelo GOAL' : `fase ${candidato.fase}`}` +
      (fechado ? ', num arco novo' : '') : null,
    lacunas,
  };
}

/** As linhas do relatório: os sete grupos, na ordem e com os ícones da página, iguais em todo canal. */
export function linhasDoRelatorio(f: FatosDoRelatorio, versao: number): string[] {
  const hora = (iso: string) => formatarHora(iso, { fuso: f.fuso, agora: f.quando, locale: 'pt-BR' });
  const ha = (iso: string) => duracaoRelativa(Math.max(0, Math.floor((Date.parse(f.quando) - Date.parse(iso)) / 60_000)));
  const ocupante = (o: EsperaDoPasso['ocupantes'][number]): string => `${o.origem === 'runtime' ? 'sessão do runtime sem vínculo' :
    o.origem === 'conducao' ? 'condução desta raiz' : 'despacho desta raiz'}${o.runtime ? ` no ${o.runtime}` : ''} ` +
    `(${o.revisao ? 'revisão' : 'execução'})`;
  const espera = f.esperaDoPasso;
  const recusa = f.recusaDoPasso;
  const textoDaEspera = espera ? `o passo do arco espera há ${ha(espera.desde)} por ${espera.motivo}; ocupação: ` +
    (espera.ocupantes.length ? espera.ocupantes.map(ocupante).join(', ') : 'nenhum ocupante identificado') : null;
  const textoDaRecusa = recusa ? `${recusa.trabalho}: o passo foi recusado há ${ha(recusa.desde)} por ${recusa.motivo} (${recusa.detalhe})` : null;
  const nada = ['• nada'];
  const l: string[] = [`Relatório da manhã do arco ${f.arco}, versão ${versao} (${formatarDataHora(f.quando, { fuso: f.fuso, agora: f.quando, locale: 'pt-BR' })})`,
    `Horários em ${f.fuso}.`];
  if (f.encerramento) l.push(`O arco fechou às ${hora(f.encerramento.em)} (${MOTIVO_EM_TEXTO[f.encerramento.motivo] ?? f.encerramento.motivo}): ${frase(f.encerramento.detalhe)}`);
  else if (f.situacao === 'vigente') l.push(`O arco segue até ${hora(f.janela.fim)}.`);
  else l.push(`O arco está ${f.situacao}.`);
  if (f.lacunas.length) l.push(`Não lido: ${f.lacunas.join('; ')}.`);
  l.push('', '✅ Entregue', ...(f.entregues.length ? f.entregues.map(e => `• ${e.trabalho} (${e.item}): thread ${e.thread}` +
    `${e.pr !== null ? `, PR #${e.pr}` : ''}${e.merge ? `, merge ${e.merge.slice(0, 8)}` : ''}, push provado (${e.push}), ${e.master}`) : nada));
  const daSupervisao = [...f.retomadas.map(r => `• retomada autorizada pela supervisão: ${r}`),
    ...f.sessoesParadas.map(s => `• pela supervisão, ${s}`)];
  l.push('', '🔄 Em curso', ...(f.emCurso.length || f.paradas.length || daSupervisao.length ? [...f.emCurso.map(e => `• ${e.trabalho} (${e.item}): ` +
    `${e.thread ? `thread ${e.thread}, ` : ''}checkpoint: ${e.checkpoint}; retoma: ${e.retomada}; próximo passo: ${e.proximo}` +
    `${e.reserva ? `; ${e.reserva}` : ''}`), ...f.paradas.map(p => `• no fechamento, ${p}`), ...daSupervisao] : nada));
  // A parada da supervisão que ainda não fechou o arco (o fechamento a lê no tique seguinte) vai ao Impedido, com alcance do arco.
  const parada = f.paradaDaSupervisao && f.encerramento?.motivo !== 'supervisao'
    ? [`• o arco: parado pela supervisão (${f.paradaDaSupervisao}); alcance: arco`] : [];
  const linhaDaEspera = textoDaEspera ? [`• ${textoDaEspera}; alcance: arco`] : [];
  const linhaDaRecusa = textoDaRecusa ? [`• ${textoDaRecusa}; alcance: trabalho`] : [];
  l.push('', '⏸️ Impedido', ...(f.impedidos.length || parada.length || linhaDaEspera.length || linhaDaRecusa.length ? [...parada, ...linhaDaEspera, ...linhaDaRecusa,
    ...f.impedidos.map(i => `• ${i.trabalho} (${i.item}): ${i.causa} (${i.detalhe}); ` +
    `alcance: ${i.alcance}; tentativas: ${i.tentativas}${i.hitl ? `; ${i.hitl} #HITL` : ''}`)] : nada));
  const decisoes = f.decisoes.slice(0, 10);
  l.push('', '🧭 Decidi no envelope', ...(decisoes.length ? [...decisoes.map(d => `• ${d.thread}: ${frase(d.decidido)} Porque: ${frase(d.porque)} ` +
    `Como reverter: ${frase(d.comoMudar)} Evidência: ${frase(d.evidencia)}`), ...(f.decisoes.length > decisoes.length
      ? [`• e mais ${f.decisoes.length - decisoes.length}, no ledger de cada thread (ork decisao placar)`] : [])] : nada));
  l.push('', '💰 Custo e duração', ...f.custo.map(c => `• Teto ${c.escopo}: ${textoDoConsumo(c.consumo)} de ${c.teto} ${c.unidade}`),
    `• Sessões abertas pelo arco: ${f.sessoesDespachadas}` +
      (f.reservasPendentes ? `; reservas pendentes: ${f.reservasPendentes} (o runtime pode ter aberto a sessão, e o consumo dela fica desconhecido)` : ''),
    `• Janela de ${hora(f.janela.inicio)} a ${hora(f.janela.fim)}` +
      (f.encerramento ? `; fechou às ${hora(f.encerramento.em)} (${MOTIVO_EM_TEXTO[f.encerramento.motivo] ?? f.encerramento.motivo})` : ''),
    ...f.contasFora.map(c => `• ${c}`),
    '• Assinatura não é uso ilimitado: o teto vale também para a conta de assinatura.');
  l.push('', '📝 Correções', ...(f.correcoes.length ? f.correcoes.map(c => `• Foi informado: ${c.informado}. Fato confirmado agora: ` +
    `${c.confirmado}. Fonte: ${c.fonte}. Impacto: ${c.impacto}.`) : nada));
  const acaoDoDono: Readonly<Record<string, string>> = Object.freeze({
    'capacidade.revisao': 'encerre uma sessão de execução que esteja trabalhando ou emende a capacidade do envelope',
    'capacidade.maquina': 'encerre uma sessão que esteja trabalhando ou emende a capacidade do envelope',
    'capacidade.conta': 'libere a conta ocupada ou emende seu limite no envelope',
    'capacidade.runtime': 'libere o runtime ocupado ou emende seu limite no envelope',
    'capacidade.projeto': 'libere uma condução do projeto ou ajuste a concorrência do projeto',
    'capacidade.conta-nao-autorizada': 'corrija o login/perfil da conta ou emende as contas do envelope',
    'capacidade.runtime-nao-autorizado': 'corrija o runtime da fase ou emende os runtimes do envelope',
    'capacidade.fonte-indisponivel': 'restabeleça a leitura das sessões do runtime',
    'fonte-indisponivel': 'restabeleça a fonte que o passo não conseguiu ler',
    'vigia-ausente': 'restabeleça o tique do vigia do arco',
    'sem-trava-do-kernel': 'instale ou restabeleça a trava flock exigida pelo núcleo',
    'sem-autorizacao': 'autorize o envelope do arco pela pergunta pendente',
    'noctum.coordenacao.exige-passo-da-maquina': 'restabeleça o passo da máquina que coordena este arco',
  });
  const esperaDoDono = espera && acaoDoDono[espera.motivo]
    ? [`• O passo não despacha por ${espera.motivo} há ${ha(espera.desde)}. Para destravar: ${acaoDoDono[espera.motivo]}.`] : [];
  const acaoDaRecusaDoDono = (motivo: string): string | null => {
    if (motivo === 'noctum.origem.sem-prova') {
      return 'configure no cron do condutor e do tique o ORK_RECEIPT_VERIFIERS com o material público gerado por publicHitlVerifiers; ' +
        'nunca coloque a chave de ingresso no ambiente dos agentes';
    }
    if (['noctum.efeito.sem-autorizacao', 'noctum.efeito.hash-antigo', 'noctum.coordenacao.versao-nao-autorizada'].includes(motivo)) {
      return 'responda à pergunta pendente para autorizar o envelope vigente';
    }
    if (motivo.startsWith('noctum.envelope.') || ['noctum.modo.sem-envelope', 'noctum.modo.lista-fechada',
      'noctum.despacho.fora-do-envelope', 'noctum.coordenacao.fora-do-envelope'].includes(motivo)) {
      return 'corrija o envelope, proponha a nova versão e autorize-a pela pergunta';
    }
    return null;
  };
  const acaoDaRecusa = recusa ? acaoDaRecusaDoDono(recusa.motivo) : null;
  const recusaDoDono = recusa && acaoDaRecusa
    ? [`• ${recusa.trabalho}: o passo não despacha por ${recusa.motivo} há ${ha(recusa.desde)}. Motivo: ${frase(recusa.detalhe)} ` +
      `Para destravar: ${acaoDaRecusa}.`] : [];
  const doDono = [...f.precisaDeVoce.flatMap(p => [`• ${p.id} (${p.thread}): ${p.pergunta} #HITL`,
    ...p.alternativas.map(a => `  ${a.letra}) ${a.texto}: ${a.consequencia}${a.recomendada ? ` (Recomendação: ${a.porque})` : ''}`)]),
    ...f.foraDoLote.map(x => `• ${x.trabalho} (thread ${x.thread}) espera o dono fora do lote do arco: ${frase(x.detalhe)} A resposta vai pela pendência da própria thread.`),
    ...esperaDoDono, ...recusaDoDono];
  l.push('', '👤 O que precisa de você', ...(doDono.length ? doDono : nada),
    ...(f.proximo ? [`• Próximo trabalho elegível: ${f.proximo}`] : []));
  return l.map(x => redigirSegredos(x));
}

/** As páginas de até `TETO_DA_PAGINA` caracteres, cada uma com o arco, a versão e a página no cabeçalho. */
export function paginar(arco: string, versao: number, linhas: readonly string[]): string[] {
  const cabecalho = (i: number, n: number) => `Arco ${arco}, relatório v${versao}, página ${i}/${n}`;
  const espaco = TETO_DA_PAGINA - cabecalho(99, 99).length - 1;
  const blocos: string[][] = [[]];
  let tamanho = 0;
  for (const bruta of linhas) {
    const linha = bruta.length > espaco ? `${bruta.slice(0, espaco - 1)}…` : bruta;
    if (tamanho + linha.length + 1 > espaco && blocos.at(-1)!.length) { blocos.push([]); tamanho = 0; }
    blocos.at(-1)!.push(linha);
    tamanho += linha.length + 1;
  }
  return blocos.map((b, i) => [cabecalho(i + 1, blocos.length), ...b].join('\n'));
}

/** O transporte do canal no arquivo local desta máquina, ou o motivo de não haver. */
export function transporteDoCanal(raiz: string, canal: CanalComTransporte): TransporteDoCanal | { ausente: string } {
  const arquivo = path.join(raizDoEstado(raiz), '.orkastery', 'monitor', ARQUIVO_DO_TRANSPORTE);
  try { exigirHostLocal(raiz, arquivo); }
  catch (e) { return { ausente: (e as Error).message.slice(0, 300) }; }
  let bruto: unknown;
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
  catch { return { ausente: `transporte do canal ${canal} não configurado em .orkastery/monitor/${ARQUIVO_DO_TRANSPORTE}` }; }
  const t = (bruto as Record<string, unknown> | null)?.[canal] as Record<string, unknown> | undefined;
  if (!t || typeof t.executavel !== 'string' || !t.executavel || !Array.isArray(t.argumentos) ||
      !t.argumentos.every(a => typeof a === 'string') || !t.argumentos.some(a => (a as string).includes('{{mensagem}}'))) {
    return { ausente: `transporte do canal ${canal} sem executável e argumentos com {{mensagem}} em .orkastery/monitor/${ARQUIVO_DO_TRANSPORTE}` };
  }
  return { executavel: t.executavel, argumentos: t.argumentos as string[] };
}

/** Envia uma página pelo transporte: código 0 é recibo; prazo ou sinal é incerto; o resto é falha explícita. */
export function enviarPeloTransporte(raiz: string, t: TransporteDoCanal, texto: string): ResultadoDoEnvio {
  // A mensagem entra como texto: `$&` e `$'` nela não são padrão de substituição (CHECK da RM-037, fatia 4).
  const r = spawnSync(t.executavel, t.argumentos.map(a => a.replaceAll('{{mensagem}}', () => texto)),
    { cwd: raizDoEstado(raiz), encoding: 'utf8', input: texto, timeout: PRAZO_DO_TRANSPORTE_MS, maxBuffer: 1024 * 1024 });
  const codigo = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (codigo === 'ENOENT' || codigo === 'EACCES') return { estado: 'falhou', motivo: `o executável do transporte não roda (${codigo})` };
  // O processo que nem subiu (EAGAIN, ENOMEM, E2BIG) não entregou nada: é falha explícita, que se repete, e não incerto.
  if (r.error && !r.pid) return { estado: 'falhou', motivo: `o transporte não subiu (${codigo ?? 'sem código'})` };
  if (r.status === 0) {
    let referencia: string | null = null;
    try {
      const j = JSON.parse(String(r.stdout ?? '')) as Record<string, unknown>;
      const id = j.message_id ?? j.messageId ?? j.id;
      if ((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && /^[\w:-]{1,80}$/.test(id))) referencia = String(id);
    } catch { referencia = null; }
    return { estado: 'confirmado', referencia };
  }
  if (r.status !== null && !r.signal) return { estado: 'falhou', motivo: `o transporte saiu com o código ${r.status}` };
  return { estado: 'incerto', motivo: `o transporte não terminou (${r.signal ?? codigo ?? 'sem código'}): a mensagem pode ter chegado` };
}

/** O estado de envio de uma página de uma versão num canal, pelo registro. */
interface EstadoDaPagina { confirmada: boolean; referencia: string | null; incerta: boolean; falhas: number; ultimaFalhaEm: string | null;
  tentativas: number }

function estadoDaPagina(linhas: readonly Linha[], versao: number, pagina: number, canal: CanalComTransporte): EstadoDaPagina {
  const st: EstadoDaPagina = { confirmada: false, referencia: null, incerta: false, falhas: 0, ultimaFalhaEm: null, tentativas: 0 };
  let aberta = false;
  for (const { evento: e, em } of linhas) {
    if (!('pagina' in e) || e.versao !== versao || e.pagina !== pagina || e.canal !== canal) continue;
    if (e.tipo === 'envio_tentado') { st.tentativas += 1; aberta = true; if (e.forcado) st.incerta = false; continue; }
    aberta = false;
    if (e.tipo === 'envio_confirmado') { st.confirmada = true; st.referencia = e.referencia; st.incerta = false; }
    else if (e.tipo === 'envio_falhou') { st.falhas += 1; st.ultimaFalhaEm = em; }
    else if (e.tipo === 'envio_incerto') st.incerta = true;
  }
  // A tentativa sem desfecho, lida sob a trava do registro, é de um envio que morreu no meio: pode ter chegado.
  if (aberta && !st.confirmada) st.incerta = true;
  return st;
}

const versoesDe = (linhas: readonly Linha[]) => linhas.map(l => l.evento).filter((e): e is Extract<EventoDoRelatorio, { tipo: 'composto' }> =>
  e.tipo === 'composto');

/** A versão chegou ao dono: recibo de todas as páginas no canal, ou exibida num terminal interativo. */
function versaoEntregue(linhas: readonly Linha[], v: Extract<EventoDoRelatorio, { tipo: 'composto' }>): boolean {
  if (linhas.some(l => l.evento.tipo === 'exibido_no_terminal' && l.evento.versao === v.versao)) return true;
  if (v.canal === 'terminal') return false;
  return v.paginas.every((_p, i) => estadoDaPagina(linhas, v.versao, i + 1, v.canal as CanalComTransporte).confirmada);
}

/**
 * As correções: o que uma versão entregue deu como entregue e os fatos de agora desmentem, e a versão anterior que ficou
 * sem recibo. Cada correção diz o que foi informado, o fato confirmado agora, a fonte e o impacto, sem apagar o rastro.
 */
export function correcoesDoRelatorio(linhas: readonly Linha[], fatos: FatosDoRelatorio): Correcao[] {
  const correcoes: Correcao[] = [];
  const hora = (iso: string) => formatarHora(iso, { fuso: fatos.fuso, agora: fatos.quando, locale: 'pt-BR' });
  const entregaDita = new Map<string, { versao: number; canal: string; em: string }>();
  for (const v of versoesDe(linhas)) {
    const compostoEm = linhas.find(l => l.evento === v)?.em ?? fatos.quando;
    if (!versaoEntregue(linhas, v)) {
      correcoes.push({ trabalho: null, informado: `o relatório versão ${v.versao}, composto às ${hora(compostoEm)}`,
        confirmado: `sem recibo de entrega no canal ${v.canal}`, fonte: 'o registro do relatório do arco',
        impacto: 'o dono pode não ter recebido aquela versão; esta a substitui, e o terminal guarda todas' });
      continue;
    }
    for (const e of v.informados.entregues) if (!entregaDita.has(e.trabalho)) entregaDita.set(e.trabalho, { versao: v.versao, canal: v.canal, em: compostoEm });
  }
  for (const [trabalho, dita] of entregaDita) {
    if (fatos.entregues.some(e => e.trabalho === trabalho)) continue;
    // Só o fato que desmente a entrega vira correção: a entrega revertida, ou a que passou a não ter a prova do push.
    // Lacuna (thread ilegível ou ambígua, ledger que não se lê, trabalho fora da lista) fica no cabeçalho do não lido.
    const agora = fatos.impedidos.find(i => i.trabalho === trabalho && i.causa === CAUSA_REVERTIDA) ??
      fatos.emCurso.find(i => i.trabalho === trabalho && i.checkpoint === CHECKPOINT_SEM_PROVA);
    if (!agora) continue;
    const confirmado = 'causa' in agora ? `${agora.causa} (${agora.detalhe})` : `em curso: ${agora.checkpoint}`;
    correcoes.push({ trabalho, informado: `${trabalho} entregue (versão ${dita.versao}, ${dita.canal}, ${hora(dita.em)})`, confirmado,
      fonte: 'o ledger da thread do trabalho (ship_done e rollback_done)',
      impacto: 'o trabalho não conta como entregue, e nada foi entregue de novo; ele volta para um arco novo' });
  }
  return correcoes;
}

export interface ResultadoDaEntrega {
  acao: 'sem-relatorio' | 'aguardar' | 'fora-da-janela' | 'entregue' | 'pendente' | 'ocupado';
  vencimentoEm: string | null;
  versao: number | null;
  canal: CanalDoRelatorio | null;
  enviadas: number;
  detalhe: string;
}

function compor(fatos: FatosDoRelatorio, versao: number, motivo: 'horario' | 'correcao', canal: CanalDoRelatorio,
  corrigidos: string[]): Extract<EventoDoRelatorio, { tipo: 'composto' }> {
  const paginas = paginar(fatos.arco, versao, linhasDoRelatorio(fatos, versao));
  return { tipo: 'composto', versao, motivo, vencimentoEm: fatos.vencimentoEm, canal, sha256: sha(paginas.join('\n')), paginas,
    informados: { entregues: fatos.entregues.map(e => ({ trabalho: e.trabalho, thread: e.thread, merge: e.merge })), corrigidos } };
}

/**
 * Compõe e entrega o relatório quando ele vence, sob a trava do registro do relatório. Até o vencimento, espera; depois
 * de 24 h, não tenta mais (a lacuna fica no retrato). Uma página com recibo nunca é enviada de novo, e a tentativa sem
 * desfecho só se repete com `reenviar`, do dono.
 */
export function entregarRelatorioSeDevido(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoRelatorio = {}): ResultadoDaEntrega {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const sem = (acao: ResultadoDaEntrega['acao'], detalhe: string, o: Partial<ResultadoDaEntrega> = {}): ResultadoDaEntrega =>
    ({ acao, vencimentoEm: null, versao: null, canal: null, enviadas: 0, detalhe, ...o });
  let estado: EstadoDoArco | null;
  try { estado = lerArco(raiz, arco, quando); } catch (e) { if (e instanceof RecusaDoArco) return sem('sem-relatorio', e.message); throw e; }
  if (!estado?.conteudo || !estado.autorizadoPor) return sem('sem-relatorio', `o arco ${arco} não tem envelope autorizado`);
  const conteudo = estado.conteudo;
  const vencimentoEm = vencimentoDoRelatorio(conteudo), canal = conteudo.relatorio.canal;
  if (Date.parse(quando) < Date.parse(vencimentoEm)) {
    return sem('aguardar', `o relatório vence às ${formatarDataHora(vencimentoEm, { fuso: conteudo.janela.fuso, agora: quando, locale: 'pt-BR' })}`,
      { vencimentoEm, canal });
  }
  if (Date.parse(quando) >= Date.parse(vencimentoEm) + JANELA_DE_ENTREGA_MS) {
    return sem('fora-da-janela', 'a janela de entrega de 24 h depois do vencimento acabou; o que ficou sem recibo segue no retrato do arco',
      { vencimentoEm, canal });
  }
  // Os fatos sem o custo: medir (transcrições e rollouts) só quando uma versão vai mesmo ser composta, nunca a cada tique.
  const fatos = fatosDoRelatorio(carregado, arco, { ...opcoes, quando }, { semCusto: true });
  if (!fatos) return sem('sem-relatorio', `o arco ${arco} não tem envelope autorizado`);
  const comCusto = (f: FatosDoRelatorio): FatosDoRelatorio =>
    ({ ...f, custo: linhasDeCusto(conteudo, medidorDoRelatorio(opcoes, conteudo)(raiz, estado!, quando)) });
  try {
    return comRegistro<EventoDoRelatorio, ResultadoDaEntrega>(raiz, arco, 'relatorio', (linhas, anexar) => {
      const todas: Linha[] = [...linhas];
      const gravar = (e: EventoDoRelatorio) => { todas.push(anexar(e, quando)); };
      const versoes = versoesDe(todas);
      if (!versoes.length) gravar(compor(comCusto(fatos), 1, 'horario', canal, []));
      else {
        const correcoes = correcoesDoRelatorio(todas, fatos);
        const jaCorrigidos = new Set(versoes.flatMap(v => v.informados.corrigidos));
        const novas = correcoes.filter(c => c.trabalho && !jaCorrigidos.has(c.trabalho));
        if (novas.length && versoes.length < MAXIMO_DE_VERSOES) {
          gravar(compor({ ...comCusto(fatos), correcoes }, versoes.length + 1, 'correcao', canal, novas.map(c => c.trabalho!)));
        }
      }
      const atual = versoesDe(todas).at(-1)!;
      // O canal é o da versão: a emenda que troca o canal compõe a versão seguinte nele, e a já composta segue no dela,
      // com os recibos dela (nunca mandada de novo por outro canal).
      const doCanal = atual.canal;
      if (doCanal === 'terminal') {
        return { acao: versaoEntregue(todas, atual) ? 'entregue' : 'pendente', vencimentoEm, versao: atual.versao, canal: doCanal, enviadas: 0,
          detalhe: 'o relatório fica para consulta no terminal; o recibo vem quando o ork noctum relatorio o mostra num terminal interativo' };
      }
      const enviar = opcoes.enviar ?? ((c: CanalComTransporte, texto: string): ResultadoDoEnvio => {
        const t = transporteDoCanal(raiz, c);
        return 'ausente' in t ? { estado: 'falhou', motivo: `transporte.ausente: ${t.ausente}` } : enviarPeloTransporte(raiz, t, texto);
      });
      if (!opcoes.enviar) {
        const t = transporteDoCanal(raiz, doCanal);
        // Sem transporte, nada é tentado nem contado: a lacuna fica no retrato até o dono configurar o canal.
        if ('ausente' in t) return { acao: 'pendente', vencimentoEm, versao: atual.versao, canal: doCanal, enviadas: 0, detalhe: t.ausente };
      }
      let enviadas = 0;
      for (const [i, texto] of atual.paginas.entries()) {
        const pagina = i + 1;
        const st = estadoDaPagina(todas, atual.versao, pagina, doCanal);
        if (st.confirmada) continue;
        if (st.incerta || st.falhas >= MAXIMO_DE_TENTATIVAS) break;
        if (st.ultimaFalhaEm && Date.parse(quando) - Date.parse(st.ultimaFalhaEm) < INTERVALO_ENTRE_TENTATIVAS_MS) break;
        gravar({ tipo: 'envio_tentado', versao: atual.versao, pagina, canal: doCanal, tentativa: st.tentativas + 1, forcado: false });
        let r: ResultadoDoEnvio;
        try { r = enviar(doCanal, texto); } catch (e) { r = { estado: 'incerto', motivo: (e as Error).message.slice(0, 200) }; }
        if (r.estado === 'confirmado') {
          gravar({ tipo: 'envio_confirmado', versao: atual.versao, pagina, canal: doCanal, referencia: r.referencia });
          enviadas += 1;
          continue;
        }
        gravar(r.estado === 'falhou' ? { tipo: 'envio_falhou', versao: atual.versao, pagina, canal: doCanal, motivo: r.motivo.slice(0, 300) }
          : { tipo: 'envio_incerto', versao: atual.versao, pagina, canal: doCanal, motivo: r.motivo.slice(0, 300) });
        break;
      }
      const entregue = versaoEntregue(todas, atual);
      const todasComRecibo = atual.paginas.every((_p, i) => estadoDaPagina(todas, atual.versao, i + 1, doCanal).confirmada);
      return { acao: entregue ? 'entregue' : 'pendente', vencimentoEm, versao: atual.versao, canal: doCanal, enviadas,
        detalhe: !entregue ? 'há página sem recibo; veja o retrato do arco'
          : todasComRecibo ? `versão ${atual.versao} com recibo de todas as páginas no canal ${doCanal}`
          : `versão ${atual.versao} mostrada num terminal interativo; o canal ${doCanal} ainda não tem recibo de todas as páginas` };
    });
  } catch (e) {
    if (e instanceof RecusaDoRegistro && e.motivo === 'noctum.registro.ocupado') {
      return sem('ocupado', 'outro processo entrega o relatório deste arco agora', { vencimentoEm, canal });
    }
    throw e;
  }
}

/**
 * O reenvio que o dono pede para um canal: cada página da versão atual sem recibo vai uma vez, mesmo a incerta e a de
 * reenvio esgotado. A página com recibo nunca vai de novo.
 */
export function reenviarRelatorio(carregado: ManifestoCarregado, arco: string, canal: CanalComTransporte,
  opcoes: Pick<OpcoesDoRelatorio, 'quando' | 'enviar'> = {}): ResultadoDaEntrega {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  return comRegistro<EventoDoRelatorio, ResultadoDaEntrega>(raiz, arco, 'relatorio', (linhas, anexar) => {
    const todas: Linha[] = [...linhas];
    const atual = versoesDe(todas).at(-1);
    const base = { vencimentoEm: atual?.vencimentoEm ?? null, versao: atual?.versao ?? null, canal };
    if (!atual) return { acao: 'sem-relatorio', ...base, enviadas: 0, detalhe: 'nenhuma versão composta ainda' };
    if (atual.canal !== canal) return { acao: 'sem-relatorio', ...base, enviadas: 0, detalhe: `o canal do envelope é ${atual.canal}, não ${canal}` };
    const enviar = opcoes.enviar ?? ((c: CanalComTransporte, texto: string): ResultadoDoEnvio => {
      const t = transporteDoCanal(raiz, c);
      return 'ausente' in t ? { estado: 'falhou', motivo: `transporte.ausente: ${t.ausente}` } : enviarPeloTransporte(raiz, t, texto);
    });
    let enviadas = 0;
    for (const [i, texto] of atual.paginas.entries()) {
      const pagina = i + 1;
      const st = estadoDaPagina(todas, atual.versao, pagina, canal);
      if (st.confirmada) continue;
      todas.push(anexar({ tipo: 'envio_tentado', versao: atual.versao, pagina, canal, tentativa: st.tentativas + 1, forcado: true }, quando));
      let r: ResultadoDoEnvio;
      try { r = enviar(canal, texto); } catch (e) { r = { estado: 'incerto', motivo: (e as Error).message.slice(0, 200) }; }
      if (r.estado === 'confirmado') {
        todas.push(anexar({ tipo: 'envio_confirmado', versao: atual.versao, pagina, canal, referencia: r.referencia }, quando));
        enviadas += 1;
        continue;
      }
      todas.push(anexar(r.estado === 'falhou' ? { tipo: 'envio_falhou', versao: atual.versao, pagina, canal, motivo: r.motivo.slice(0, 300) }
        : { tipo: 'envio_incerto', versao: atual.versao, pagina, canal, motivo: r.motivo.slice(0, 300) }, quando));
      break;
    }
    const entregue = versaoEntregue(todas, atual);
    return { acao: entregue ? 'entregue' : 'pendente', ...base, enviadas,
      detalhe: entregue ? `versão ${atual.versao} com recibo de todas as páginas` : 'o reenvio não confirmou todas as páginas' };
  }, { esperarMs: 10_000 });
}

/**
 * O relatório para o terminal: a versão atual, ou uma prévia dos fatos de agora quando nenhuma versão foi composta (a
 * prévia não é registrada nem vale como entrega). Mostrado num terminal interativo, vira o recibo do canal `terminal`.
 */
export function relatorioNoTerminal(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoRelatorio & { interativo?: boolean } = {}):
  { versao: number | null; previa: boolean; paginas: string[] } | null {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const atual = versoesDe(lerRegistro<EventoDoRelatorio>(raiz, arco, 'relatorio')).at(-1);
  if (!atual) {
    const fatos = fatosDoRelatorio(carregado, arco, { ...opcoes, quando });
    if (!fatos) return null;
    return { versao: null, previa: true, paginas: paginar(arco, 0, ['Prévia: nenhuma versão foi composta ainda; isto não é a entrega.',
      ...linhasDoRelatorio(fatos, 0)]) };
  }
  if (opcoes.interativo) {
    // Com a trava ocupada (o tique enviando), o dono vê as páginas assim mesmo; o recibo do terminal fica para a vez seguinte.
    try {
      comRegistro<EventoDoRelatorio, void>(raiz, arco, 'relatorio', (linhas, anexar) => {
        if (!linhas.some(l => l.evento.tipo === 'exibido_no_terminal' && l.evento.versao === atual.versao)) {
          anexar({ tipo: 'exibido_no_terminal', versao: atual.versao }, quando);
        }
      }, { esperarMs: 10_000 });
    } catch (e) { if (!(e instanceof RecusaDoRegistro && e.motivo === 'noctum.registro.ocupado')) throw e; }
  }
  return { versao: atual.versao, previa: false, paginas: atual.paginas };
}

export interface RetratoDoRelatorio {
  vencimentoEm: string | null;
  canal: CanalDoRelatorio | null;
  versoes: Array<{ versao: number; motivo: string; compostoEm: string; paginas: number; recibos: Array<{ pagina: number; referencia: string | null }>;
    entregue: boolean }>;
  /** O que falta: página sem recibo, envio incerto, reenvio esgotado, transporte ausente, terminal não mostrado. */
  lacunas: string[];
}

/** O retrato do relatório para o `ork noctum status`: as versões, os recibos e as lacunas, sem gravar nada. */
export function retratoDoRelatorio(raiz: string, arco: string, conteudo: ConteudoDoEnvelope | null, quando = new Date().toISOString()):
  RetratoDoRelatorio {
  let linhas: Linha[];
  try { linhas = lerRegistro<EventoDoRelatorio>(raiz, arco, 'relatorio'); }
  catch (e) {
    if (!(e instanceof RecusaDoRegistro)) throw e;
    return { vencimentoEm: null, canal: null, versoes: [], lacunas: [`o registro do relatório não se lê (${e.motivo})`] };
  }
  const vencimentoEm = conteudo ? vencimentoDoRelatorio(conteudo) : null;
  const canal = conteudo?.relatorio.canal ?? null;
  const fuso = conteudo?.janela.fuso;
  const hora = (iso: string) => formatarDataHora(iso, { fuso, agora: quando, locale: 'pt-BR' });
  const versoes = versoesDe(linhas).map(v => ({ versao: v.versao, motivo: v.motivo, compostoEm: linhas.find(l => l.evento === v)!.em,
    paginas: v.paginas.length, entregue: versaoEntregue(linhas, v),
    recibos: v.canal === 'terminal' ? [] : v.paginas.map((_p, i) => ({ pagina: i + 1, st: estadoDaPagina(linhas, v.versao, i + 1, v.canal as CanalComTransporte) }))
      .filter(x => x.st.confirmada).map(x => ({ pagina: x.pagina, referencia: x.st.referencia })) }));
  const lacunas: string[] = [];
  const atual = versoesDe(linhas).at(-1);
  if (!atual) {
    if (vencimentoEm && Date.parse(quando) >= Date.parse(vencimentoEm)) lacunas.push(`o relatório venceu às ${hora(vencimentoEm)} e não foi composto`);
  } else if (atual.canal === 'terminal') {
    if (!versaoEntregue(linhas, atual)) lacunas.push(`o relatório versão ${atual.versao} não foi mostrado num terminal interativo: rode ork noctum relatorio ${arco}`);
  } else {
    const c = atual.canal as CanalComTransporte;
    for (const [i] of atual.paginas.entries()) {
      const st = estadoDaPagina(linhas, atual.versao, i + 1, c);
      if (st.confirmada) continue;
      const pagina = `página ${i + 1} da versão ${atual.versao} no canal ${c}`;
      if (st.incerta) lacunas.push(`envio incerto da ${pagina}: confira o canal e reenvie com ork noctum relatorio ${arco} --reenviar ${c}`);
      else if (st.falhas >= MAXIMO_DE_TENTATIVAS) lacunas.push(`reenvio esgotado da ${pagina} (${st.falhas} tentativas): reenvie com ork noctum relatorio ${arco} --reenviar ${c}`);
      else lacunas.push(`sem recibo da ${pagina}${st.falhas ? ` (${st.falhas} tentativa(s) falharam)` : ''}`);
    }
    if (vencimentoEm && Date.parse(quando) >= Date.parse(vencimentoEm) + JANELA_DE_ENTREGA_MS && !versaoEntregue(linhas, atual)) {
      lacunas.push('a janela de entrega de 24 h acabou sem recibo de todas as páginas');
    }
    const t = transporteDoCanal(raiz, c);
    if ('ausente' in t && !versaoEntregue(linhas, atual)) lacunas.push(t.ausente);
  }
  return { vencimentoEm, canal, versoes, lacunas };
}

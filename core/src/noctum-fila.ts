/**
 * RM-058, fatia N2 (D2 a D6 da ork-rm058n2): a fila do arco.
 *
 * O que entra: os trabalhos do envelope `v2` vigente, cada um uma thread (a que já existe, ou a que o arco abre com o
 * pedido do dono), com o item reservado por esta máquina e trabalho possível. A ordem: só com as dependências entregues,
 * depois a prioridade do dono, a prova mais adiantada (a fase a despachar mais adiante primeiro; abrir thread por último),
 * a posição no envelope e o id. O passo de cada thread aberta é o da Sentinela (`passoDaThread`, pela prova mais adiantada
 * que a sessão do bloco deixou): o bloco inteiro numa sessão só, cujo `phase_result` sai com a fase do despacho, não ganha
 * um PLAN repetido (aprendizado 3 de 12/10).
 *
 * Quando a fila acaba: vazia (todo trabalho entregue, encerrado ou preso a uma dependência que fechou sem entrega)
 * encerra cedo; só bloqueada, ou com fonte que não foi lida, espera com backoff até o fim da janela; com sessão em curso,
 * espera a cadência de 5 min. Lacuna nunca vira fila vazia. O trabalho cujo despacho falhou no núcleo, antes de lançar,
 * três vezes seguidas fica bloqueado (`erro-repetido`), e o que pode ter uma sessão aberta (reserva pendente no log do arco,
 * ou thread nunca despachada cuja falha disse o id da sessão) vai para a retomada da N4: o passo não insiste no mesmo erro a
 * noite toda nem abre outra sessão por cima de uma que pode estar aberta. A falha que não abriu nada (a conta sem cota, sem
 * id) deixa o trabalho na fila, e o despacho seguinte sai por outra conta. Fechar o arco e o relatório são da N6.
 *
 * `fatosDaFila` relê o disco a cada chamada; `montarFila` é pura sobre os fatos e o instante. Nada aqui despacha nem grava.
 *
 * RM-058, fatia N4 (D8 e D21 da ork-rm058n4): a fila respeita, quando vem, o que a supervisão do arco decidiu. O trabalho
 * isolado não sai sozinho neste arco; o trabalho bloqueado para a N4 sem reserva pendente (a falha com id antes do primeiro
 * despacho, o passo de retomar, o fim de turno sem resultado e o que ficou sem passo depois da sessão morta) volta à fila
 * na fase da retomada que o vigia autorizou. A reserva pendente nunca é sobreposta. Sem a supervisão, nada muda.
 */
import { BRANCH_DE_RESERVAS, REMOTO_PADRAO, reservasLocais } from './roadmap-reservas';
import { pontaLocal } from './branch-de-estado';
import { esperaDoCondutor, EsperaDoCondutor, pendenciaDoDono } from './parado-no-condutor';
import { passosDoCondutor, PassoDoCondutor } from './conducao-sentinela';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { EstadoDoArco, lerArco } from './noctum-arco';
import { ConteudoDoEnvelope, envelopeComTrabalhos, envelopeMultimaquina, shaDoPedido, Trabalho } from './noctum-envelope';
import { dirThread, lerThread, listarIds, pedidoDaThread } from './thread';
import { Fase, FASES, Thread } from './types';

export const CONTRATO_FILA = 'ork.noctum-fila/v1' as const;
/** A cadência do vigia (D3 do dono): a espera da fila em curso e o menor passo do backoff. */
export const CADENCIA_MS = 5 * 60 * 1000;
/** O maior passo do backoff da fila bloqueada. */
export const BACKOFF_MAXIMO_MS = 60 * 60 * 1000;

export type EstadoDoTrabalho = 'entregue' | 'encerrado-sem-entrega' | 'em-curso' | 'despachavel' | 'abrir' | 'aguardando-entrega' | 'bloqueado';

export type MotivoDoBloqueio =
  | 'dependencia' | 'reserva-ausente' | 'reserva-de-outra-maquina' | 'reserva-sem-leitura' | 'decisao-no-lote' | 'dono'
  | 'retomada' | 'fim-de-turno-sem-resultado' | 'sem-passo' | 'modo' | 'pedido-ausente' | 'thread-ausente' | 'thread-ambigua'
  | 'thread-ilegivel' | 'item-divergente' | 'erro-repetido' | 'dependencia-encerrada' | 'sem-ordem' | 'em-outra-maquina' | 'isolado';

/** Quantas falhas seguidas do núcleo no despacho de um trabalho o bloqueiam (A4 do CHECK da ork-rm058n2). */
export const ERROS_SEGUIDOS_QUE_BLOQUEIAM = 3;
/** O motivo que o passo grava no log do arco quando o despacho de um candidato falha antes de lançar a sessão. */
export const MOTIVO_DO_ERRO_NO_DESPACHO = 'noctum.despacho.erro';

/** Bloqueio que vem de fonte não lida, e não de um fato: vira lacuna, nunca trabalho a menos. */
const DE_LACUNA: readonly MotivoDoBloqueio[] = ['reserva-sem-leitura', 'thread-ilegivel', 'thread-ambigua'];

export interface TrabalhoNaFila {
  id: string;
  item: string;
  prioridade: number;
  /** Posição na lista do envelope, a partir de 0. */
  posicao: number;
  /** A thread ligada ao trabalho; `null` quando ainda não existe. */
  thread: string | null;
  estado: EstadoDoTrabalho;
  /** A fase a despachar: o passo da thread, ou GOAL na thread que o arco abre. */
  fase: Fase | null;
  motivo: MotivoDoBloqueio | null;
  detalhe: string;
  /** O instante do `ship_done` da thread, quando entregue. */
  entregueEm: string | null;
}

export type SituacaoDaFila = 'com-trabalho' | 'em-curso' | 'fonte-indisponivel' | 'bloqueada' | 'vazia';

export type DecisaoDaFila =
  | { acao: 'despachar' }
  | { acao: 'aguardar'; ate: string; motivo: 'em-curso' | 'bloqueada' | 'fonte-indisponivel' | 'agendado' | 'sem-autorizacao' }
  | { acao: 'encerrar'; motivo: 'fila-vazia' | 'arco-encerrado' };

export interface FilaDoArco {
  contrato: typeof CONTRATO_FILA;
  arco: string;
  envelopeSha256: string | null;
  quando: string;
  situacao: SituacaoDaFila;
  /** Todos os trabalhos, na ordem do envelope. */
  trabalhos: TrabalhoNaFila[];
  /** Os despacháveis (`despachavel` e `abrir`), na ordem da D3. */
  candidatos: TrabalhoNaFila[];
  /** Fontes que não foram lidas: a fila diz o que não sabe, em vez de chamar de vazio. */
  lacunas: string[];
  decisao: DecisaoDaFila;
}

/** O que a fila sabe de um trabalho, lido do disco. */
export interface FatosDoTrabalho {
  /** As threads que casam com o trabalho: pelo id, ou pelo item mais o sha256 do pedido. Mais de uma é ambígua. */
  threads: Thread[];
  /** Thread pedida pelo id que não pôde ser lida. */
  ilegivel: string | null;
  /** `ship_done` no ledger da thread ligada. */
  entregueEm: string | null;
  /** A thread ligada já teve algum despacho de fase. */
  despachada: boolean;
  /** Nunca despachada, mas com um `phase_dispatch_failed` que diz o id da sessão: o runtime pode tê-la deixado aberta. */
  despachoFalho: boolean;
  pedidoGuardado: boolean;
  passo: PassoDoCondutor | null;
  espera: EsperaDoCondutor | null;
  doDono: string | null;
}

/**
 * RM-058 N3 (D14 da ork-rm058n3): o que o ramo de coordenação diz a esta máquina num arco entre máquinas. Os trabalhos
 * com ordem aceita dela são os únicos que ela despacha, os entregues em qualquer máquina contam como entregues aqui, e os
 * encerrados sem entrega em outra máquina, como encerrados aqui (B1 e S1 da rodada 3).
 */
export interface CoordenacaoDaFila {
  trabalhos: ReadonlySet<string>;
  entregues: ReadonlyMap<string, string>;
  encerrados?: ReadonlySet<string>;
  /** Trabalhos com uma ordem viva de outra máquina: a thread local antiga nunca os libera. */
  emOutraMaquina?: ReadonlySet<string>;
  /** A ordem aceita desta máquina, usada para distinguir a thread de uma retomada. */
  ordens?: ReadonlyMap<string, { ordem: string; numero: number }>;
}

/** RM-058 N4 (D8 e D16 da ork-rm058n4): o que a supervisão do arco decidiu e a fila respeita. */
export interface DecisoesDaSupervisao {
  /** Trabalhos isolados, com o porquê: não saem da fila sozinhos neste arco. */
  isolados: ReadonlyMap<string, string>;
  /** Retomadas autorizadas e ainda não atendidas: o trabalho bloqueado para a N4 volta à fila nesta fase. */
  retomadas: ReadonlyMap<string, { fase: Fase; tentativa: number; motivo: string }>;
}

/** A leitura das reservas: a última cópia local da branch de reservas, ou a falta dela. */
export type LeitorDeReservas = () => { leitura: 'copia-local' | 'sem-copia'; reservas: Array<{ item: string; maquina: string; thread: string | null }> };

export interface FatosDaFila {
  arco: string;
  quando: string;
  maquina: string;
  estado: EstadoDoArco | null;
  /** `sem-copia`: esta máquina nunca leu a branch de reservas; nenhuma reserva é provada. */
  reservas: { leitura: 'copia-local' | 'sem-copia'; porItem: Map<string, { maquina: string; thread: string | null }> };
  porTrabalho: Map<string, FatosDoTrabalho>;
  /** Threads do projeto que não puderam ser lidas: uma delas pode ser a de um trabalho a abrir. */
  threadsIlegiveis: string[];
  /** Os modos que o manifesto deixa criar (`conduction.allowed_modes`): sem `auto`, o arco não abre thread. */
  modosPermitidos: readonly string[];
  /** Só no arco entre máquinas (N3), pelo passo da máquina. */
  coordenacao?: CoordenacaoDaFila;
  /** RM-058 N4: as decisões da supervisão; ausente, a fila é a da N2. */
  supervisao?: DecisoesDaSupervisao;
}

const adiante = (t: TrabalhoNaFila): number => t.estado === 'abrir' ? -1 : t.fase ? FASES.indexOf(t.fase) : -1;

/** D3: prioridade do dono, prova mais adiantada, posição no envelope e id. */
function antes(a: TrabalhoNaFila, b: TrabalhoNaFila): number {
  return a.prioridade - b.prioridade || adiante(b) - adiante(a) || a.posicao - b.posicao || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const FASES_DA_ENTREGA: readonly Fase[] = ['SHIP', 'MASTER'];

/** As falhas seguidas do núcleo antes de lançar, nos despachos mais recentes do trabalho, contadas do último para trás. */
function errosSeguidos(trabalho: string, despachos: EstadoDoArco['despachos']): number {
  let n = 0;
  for (const d of despachos.filter(x => x.trabalho === trabalho).sort((a, b) => b.seq - a.seq)) {
    if (d.desfecho !== 'recusado' || d.motivo !== MOTIVO_DO_ERRO_NO_DESPACHO) break;
    n += 1;
  }
  return n;
}

/**
 * O estado de um trabalho do envelope pelos fatos; `entregues` são os ids já entregues (para as dependências) e
 * `semSaida` os que nunca mais entregam neste arco (fecharam sem entrega, ou dependem de quem fechou).
 */
function classificar(t: Trabalho, posicao: number, f: FatosDoTrabalho | undefined, fatos: FatosDaFila, entregues: ReadonlySet<string>,
  semSaida: ReadonlySet<string>, estado: EstadoDoArco): TrabalhoNaFila {
  const decisoes = estado.decisoes;
  const base = { id: t.id, item: t.item, prioridade: t.prioridade, posicao, thread: null as string | null, fase: null as Fase | null,
    motivo: null as MotivoDoBloqueio | null, entregueEm: null as string | null };
  const bloqueado = (motivo: MotivoDoBloqueio, detalhe: string): TrabalhoNaFila => ({ ...base, estado: 'bloqueado', motivo, detalhe });
  // N3: a entrega em outra máquina do arco vale aqui, até sem thread nesta raiz.
  const naRede = fatos.coordenacao?.entregues.get(t.id);
  if (naRede) return { ...base, thread: f?.threads[0]?.id ?? null, estado: 'entregue', entregueEm: naRede, detalhe: 'entregue em outra máquina do arco' };
  if (fatos.coordenacao?.encerrados?.has(t.id)) {
    return { ...base, thread: f?.threads[0]?.id ?? null, estado: 'encerrado-sem-entrega', detalhe: 'encerrado sem entrega em outra máquina do arco' };
  }
  if (envelopeMultimaquina(estado.conteudo!) && fatos.coordenacao?.emOutraMaquina?.has(t.id)) {
    return bloqueado('em-outra-maquina', 'o trabalho tem ordem viva em outra máquina do arco');
  }
  if (!f) return bloqueado('thread-ilegivel', 'o trabalho não foi lido');
  if (f.ilegivel) return bloqueado('thread-ilegivel', `a thread ${f.ilegivel} não pôde ser lida`);
  if (f.threads.length > 1) {
    return bloqueado('thread-ambigua', `${f.threads.map(x => x.id).join(', ')} casam com o item e o pedido; o arco não escolhe por ninguém`);
  }
  const th = f.threads[0] ?? null;
  base.thread = th?.id ?? null;
  if (t.thread !== undefined && !th) return bloqueado('thread-ausente', `a thread ${t.thread} não existe neste projeto`);
  if (th && th.roadmap !== t.item) return bloqueado('item-divergente', `a thread ${th.id} é do item ${th.roadmap ?? 'nenhum'}, não do ${t.item}`);
  if (th && f.entregueEm) return { ...base, estado: 'entregue', entregueEm: f.entregueEm, detalhe: `ship_done da thread ${th.id}` };
  if (th && th.status === 'fechada') return { ...base, estado: 'encerrado-sem-entrega', detalhe: `a thread ${th.id} fechou sem ship_done` };
  // RM-058 N4 (D16): o trabalho isolado pela supervisão não sai sozinho neste arco, nem com uma sessão de fora rodando nele.
  const isolado = fatos.supervisao?.isolados.get(t.id);
  if (isolado !== undefined) return bloqueado('isolado', isolado);
  if (th && f.passo?.conduzida) return { ...base, estado: 'em-curso', detalhe: `a thread ${th.id} está sendo conduzida agora` };
  const mortas = t.dependeDe.filter(d => semSaida.has(d));
  if (mortas.length) {
    return bloqueado('dependencia-encerrada', `depende de ${mortas.join(', ')}, que não entrega mais neste arco (fechou sem entrega)`);
  }
  const faltam = t.dependeDe.filter(d => !entregues.has(d));
  if (faltam.length) return bloqueado('dependencia', `depende de ${faltam.join(', ')}, ainda não entregue(s)`);
  if (fatos.coordenacao && !fatos.coordenacao.trabalhos.has(t.id)) {
    return bloqueado('sem-ordem', 'o trabalho não tem ordem aceita desta máquina no ramo de coordenação do arco');
  }
  if (fatos.reservas.leitura === 'sem-copia') return bloqueado('reserva-sem-leitura', 'esta máquina não tem cópia da branch de reservas');
  const reserva = fatos.reservas.porItem.get(t.item);
  if (!reserva) return bloqueado('reserva-ausente', `o item ${t.item} não está reservado; tomar reserva é da N3`);
  if (reserva.maquina !== fatos.maquina) return bloqueado('reserva-de-outra-maquina', `o item ${t.item} está com a máquina ${reserva.maquina}`);
  if (th && decisoes.some(d => d.thread === th.id || d.dependentes.includes(th.id))) {
    return bloqueado('decisao-no-lote', `a thread ${th.id} espera uma decisão do dono no lote do arco`);
  }
  // B1 da rodada 2 e A1 da rodada 3: a reserva pendente é um lançamento incerto; despachar de novo abriria outra sessão.
  if (estado.despachos.some(d => d.trabalho === t.id && d.desfecho === 'pendente')) {
    return bloqueado('retomada', 'um despacho deste trabalho ficou pendente, e o runtime pode ter aberto a sessão; a retomada é da N4');
  }
  const erros = errosSeguidos(t.id, estado.despachos);
  if (erros >= ERROS_SEGUIDOS_QUE_BLOQUEIAM) {
    return bloqueado('erro-repetido', `os ${erros} últimos despachos falharam no núcleo antes de lançar; quem decide é a N4 ou o dono`);
  }
  // RM-058 N4 (D8): o bloqueio que a N2 deixou para a N4 vira a retomada que o vigia autorizou, na fase dela.
  const retomada = fatos.supervisao?.retomadas.get(t.id);
  const paraAN4 = (motivo: MotivoDoBloqueio, detalhe: string): TrabalhoNaFila => retomada
    ? { ...base, estado: 'despachavel', fase: retomada.fase,
      detalhe: `retomada autorizada pela supervisão (tentativa ${retomada.tentativa}, ${retomada.motivo}) no lugar de: ${detalhe}` }
    : bloqueado(motivo, detalhe);
  if (!th) {
    // A4 do CHECK: abrir a thread num projeto que não deixa criar #Auto falharia toda noite; o arco nem tenta.
    if (!fatos.modosPermitidos.includes('auto')) return bloqueado('modo', 'o projeto não deixa criar thread #Auto (conduction.allowed_modes)');
    return { ...base, estado: 'abrir', fase: 'GOAL', detalhe: `abre a thread do item ${t.item} com o pedido do dono` };
  }
  if (th.modo !== 'auto') return bloqueado('modo', `a thread ${th.id} está em ${th.modo}; o arco só conduz #Auto`);
  if (f.doDono) return bloqueado('dono', `a thread ${th.id} espera o dono (${f.doDono})`);
  if (!f.pedidoGuardado) return bloqueado('pedido-ausente', `a thread ${th.id} não guardou o pedido na criação; o arco não inventa um`);
  if (!f.despachada) {
    // B1 da rodada 2: a falha disse o id da sessão, que pode estar aberta; despachar de novo abriria outra.
    if (f.despachoFalho) return paraAN4('retomada', `o despacho da thread ${th.id} falhou depois de o runtime dizer o id da sessão; a retomada é da N4`);
    return { ...base, estado: 'despachavel', fase: th.faseAtual, detalhe: `a thread ${th.id} nunca foi despachada` };
  }
  const passo = f.passo;
  if (passo?.acao === 'despachar' && passo.fase) {
    if (FASES_DA_ENTREGA.includes(passo.fase)) return { ...base, estado: 'aguardando-entrega', detalhe: `${passo.porque}; a entrega é da N5` };
    return { ...base, estado: 'despachavel', fase: passo.fase, detalhe: passo.porque };
  }
  if (passo?.acao === 'retomar') return paraAN4('retomada', `${passo.porque}; a retomada é da N4`);
  if (f.espera?.tipo === 'stop-sem-resultado') return paraAN4('fim-de-turno-sem-resultado', 'o turno acabou sem o resultado da fase; quem decide é a N4');
  if (f.espera?.tipo === 'concluida') return { ...base, estado: 'aguardando-entrega', detalhe: `${passo?.porque ?? 'fase concluída'}; a entrega é da N5` };
  return paraAN4('sem-passo', passo?.porque ?? 'nenhum passo do condutor para a thread');
}

/** O último progresso do arco: a autorização, um despacho ou uma entrega. O backoff conta a partir dele. */
function ultimoProgresso(estado: EstadoDoArco, trabalhos: TrabalhoNaFila[]): number {
  const instantes = [estado.autorizadoPor?.recebidoEm, ...estado.despachos.flatMap(d => [d.reservadoEm, d.concluidoEm]),
    ...trabalhos.map(t => t.entregueEm)].map(x => typeof x === 'string' ? Date.parse(x) : NaN).filter(Number.isFinite);
  return instantes.length ? Math.max(...instantes) : Date.parse(estado.conteudo?.janela.inicio ?? '');
}

/**
 * A fila e a decisão no instante dos fatos. Fora da janela, ou sem envelope `v2` autorizado, nada é candidato; o
 * resto segue a D6 da ork-rm058n2.
 */
export function montarFila(fatos: FatosDaFila): FilaDoArco {
  const { arco, quando, estado } = fatos;
  const agora = Date.parse(quando);
  const vazia = (situacao: SituacaoDaFila, decisao: DecisaoDaFila, lacunas: string[] = []): FilaDoArco =>
    ({ contrato: CONTRATO_FILA, arco, envelopeSha256: estado?.envelopeSha256 ?? null, quando, situacao, trabalhos: [], candidatos: [],
      lacunas, decisao });
  const daqui = (ms: number, limite?: string): string =>
    new Date(Math.min(agora + ms, limite ? Date.parse(limite) : Number.POSITIVE_INFINITY)).toISOString();
  if (!estado || !estado.conteudo || estado.situacao === 'proposto') {
    return vazia('fonte-indisponivel', { acao: 'aguardar', motivo: 'sem-autorizacao', ate: daqui(CADENCIA_MS) }, ['o arco não tem envelope autorizado']);
  }
  const conteudo: ConteudoDoEnvelope = estado.conteudo;
  // RM-058 N6: o arco encerrado (hora, custo ou fila vazia) também acabou: nada é candidato.
  if (estado.situacao === 'revogado' || estado.situacao === 'expirado' || estado.situacao === 'encerrado') {
    return vazia('vazia', { acao: 'encerrar', motivo: 'arco-encerrado' });
  }
  if (estado.situacao === 'agendado') return vazia('bloqueada', { acao: 'aguardar', motivo: 'agendado', ate: conteudo.janela.inicio });
  if (!envelopeComTrabalhos(conteudo)) {
    return vazia('fonte-indisponivel', { acao: 'aguardar', motivo: 'fonte-indisponivel', ate: daqui(CADENCIA_MS, conteudo.janela.fim) },
      ['o envelope vigente é v1, sem lista de trabalhos']);
  }
  // Primeiro quem já foi entregue, para as dependências (aqui ou, no arco entre máquinas, em outra); depois cada trabalho.
  const entregues = new Set(conteudo.trabalhos.filter(t => {
    const f = fatos.porTrabalho.get(t.id);
    return fatos.coordenacao?.entregues.has(t.id) || (!!f && f.threads.length === 1 && !!f.entregueEm && f.threads[0].roadmap === t.item);
  }).map(t => t.id));
  // S7 do CHECK: quem fechou sem entrega nunca mais entrega neste arco, nem quem depende dele, de qualquer distância. No arco
  // entre máquinas (B1 e S1 da rodada 3 da ork-rm058n3), a rede decide antes da thread local: o entregue lá nunca fica sem
  // saída por uma thread antiga fechada aqui, e o encerrado lá fica sem saída aqui também.
  const semSaida = new Set(conteudo.trabalhos.filter(t => {
    if (fatos.coordenacao?.entregues.has(t.id)) return false;
    if (fatos.coordenacao?.encerrados?.has(t.id)) return true;
    const f = fatos.porTrabalho.get(t.id);
    return !!f && f.threads.length === 1 && !f.entregueEm && f.threads[0].status === 'fechada' && f.threads[0].roadmap === t.item;
  }).map(t => t.id));
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const t of conteudo.trabalhos) {
      if (!semSaida.has(t.id) && !entregues.has(t.id) && t.dependeDe.some(d => semSaida.has(d))) { semSaida.add(t.id); mudou = true; }
    }
  }
  const trabalhos = conteudo.trabalhos.map((t, i) => classificar(t, i, fatos.porTrabalho.get(t.id), fatos, entregues, semSaida, estado));
  const candidatos = trabalhos.filter(t => t.estado === 'despachavel' || t.estado === 'abrir').sort(antes);
  // Thread ilegível só é lacuna quando pode ser a de um trabalho (S7 do CHECK): a classificação já a pôs no trabalho.
  const lacunas = trabalhos.filter(t => t.motivo && DE_LACUNA.includes(t.motivo)).map(t => `trabalho ${t.id}: ${t.detalhe}`);
  const terminal = (t: TrabalhoNaFila) => t.estado === 'entregue' || t.estado === 'encerrado-sem-entrega' ||
    t.motivo === 'dependencia-encerrada';
  const situacao: SituacaoDaFila = candidatos.length ? 'com-trabalho' : trabalhos.some(t => t.estado === 'em-curso') ? 'em-curso'
    : lacunas.length ? 'fonte-indisponivel' : trabalhos.every(terminal) ? 'vazia' : 'bloqueada';
  const fim = conteudo.janela.fim;
  const backoff = Math.min(BACKOFF_MAXIMO_MS, Math.max(CADENCIA_MS, Math.floor((agora - ultimoProgresso(estado, trabalhos)) / 2)));
  const decisao: DecisaoDaFila = situacao === 'com-trabalho' ? { acao: 'despachar' }
    : situacao === 'vazia' ? { acao: 'encerrar', motivo: 'fila-vazia' }
    : situacao === 'em-curso' ? { acao: 'aguardar', motivo: 'em-curso', ate: daqui(CADENCIA_MS, fim) }
    : { acao: 'aguardar', motivo: situacao, ate: daqui(backoff, fim) };
  return { contrato: CONTRATO_FILA, arco, envelopeSha256: estado.envelopeSha256, quando, situacao, trabalhos, candidatos, lacunas, decisao };
}

/**
 * Os fatos da fila, relidos do disco: o arco, as threads de cada trabalho, o passo do condutor delas, as reservas da
 * última cópia local (sem rede) e o lote. `lerReservas` é dependência dos testes.
 */
export function fatosDaFila(carregado: ManifestoCarregado, arco: string, opcoes: { quando?: string; maquina?: string;
  lerReservas?: LeitorDeReservas; coordenacao?: CoordenacaoDaFila; supervisao?: DecisoesDaSupervisao } = {}): FatosDaFila {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const estado = lerArco(raiz, arco, quando);
  const maquina = nomeDaMaquina(opcoes.maquina);
  const lidas = (opcoes.lerReservas ?? (() => pontaLocal(raiz, REMOTO_PADRAO, BRANCH_DE_RESERVAS) === null
    ? { leitura: 'sem-copia' as const, reservas: [] }
    : { leitura: 'copia-local' as const, reservas: reservasLocais(raiz) }) as LeitorDeReservas)();
  const fatos: FatosDaFila = { arco, quando, maquina, estado, porTrabalho: new Map(), threadsIlegiveis: [],
    modosPermitidos: carregado.manifesto.conduction.allowed_modes, ...(opcoes.coordenacao ? { coordenacao: opcoes.coordenacao } : {}),
    ...(opcoes.supervisao ? { supervisao: opcoes.supervisao } : {}),
    reservas: { leitura: lidas.leitura, porItem: new Map(lidas.reservas.map(r => [r.item, { maquina: r.maquina, thread: r.thread }])) } };
  if (!estado?.conteudo || !envelopeComTrabalhos(estado.conteudo)) return fatos;
  const threads: Thread[] = [];
  for (const id of listarIds(raiz)) {
    try { threads.push(lerThread(raiz, id)); } catch { fatos.threadsIlegiveis.push(id); }
  }
  const passos = new Map(passosDoCondutor(carregado, { quando }).map(p => [p.thread, p]));
  for (const t of estado.conteudo.trabalhos) {
    let casam: Thread[];
    let ilegivel: string | null = null;
    if (t.thread !== undefined) {
      casam = threads.filter(x => x.id === t.thread);
      if (!casam.length && fatos.threadsIlegiveis.includes(t.thread)) ilegivel = t.thread;
    } else {
      const alvo = shaDoPedido(t.pedido!);
      const ordem = opcoes.coordenacao?.ordens?.get(t.id);
      casam = threads.filter(x => x.roadmap === t.item && x.pedido?.sha256 === alvo &&
        (!ordem || x.assunto.endsWith(`o${ordem.numero}`)));
      // Sem casar e com thread ilegível, ela pode ser a do trabalho: abrir outra duplicaria a thread.
      if (!casam.length && fatos.threadsIlegiveis.length) ilegivel = fatos.threadsIlegiveis[0];
    }
    const th = casam.length === 1 ? casam[0] : null;
    let eventos: ReturnType<typeof lerLedger> = [];
    try { eventos = th ? lerLedger(dirThread(raiz, th.id)) : []; } catch { ilegivel = th!.id; }
    let pedidoGuardado = false;
    try { pedidoGuardado = !!th && pedidoDaThread(raiz, th) !== null; } catch { pedidoGuardado = false; }
    fatos.porTrabalho.set(t.id, {
      threads: casam, ilegivel,
      entregueEm: eventos.find(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido)?.ts ?? null,
      despachada: eventos.some(e => e.tipo === TIPOS_DE_EVENTO.faseDespachada),
      despachoFalho: !eventos.some(e => e.tipo === TIPOS_DE_EVENTO.faseDespachada) &&
        eventos.some(e => e.tipo === TIPOS_DE_EVENTO.despachoFalhou && typeof e.sessionId === 'string'),
      pedidoGuardado,
      passo: th ? passos.get(th.id) ?? null : null,
      espera: th && th.status !== 'fechada' ? esperaDoCondutor(th, eventos, quando) : null,
      doDono: th && th.status !== 'fechada' ? pendenciaDoDono(th, eventos, quando) : null,
    });
  }
  return fatos;
}

/**
 * RM-058, fatia N6 (D2, D6 e D8 da ork-rm058n6): o fechamento do arco por hora, por custo e por fila vazia.
 *
 * A tabela "Condição / Comportamento / Estado deixado para retomar" da página manda:
 *
 *  - hora final, ou envelope expirado ou revogado: parar admissões e efeitos novos e encerrar as sessões em voo de modo
 *    controlado, deixando checkpoints, motivos de interrupção e as operações em voo para reconciliar;
 *  - fila vazia confirmada: encerrar cedo, sem abrir escopo novo, com o retrato das fontes e dos itens concluídos;
 *  - teto do arco: parar globalmente, sem retry nem troca de conta para contornar, com o consumo, as reservas em voo e a
 *    reconciliação pendente identificados.
 *
 * O teto em `sessoes` conta cada sessão na reserva: alcançado, nenhuma reserva nova passa (`noctum.orcamento.esgotado`, em
 * qualquer conta), e o arco fecha quando a última sessão admitida acaba, porque pará-las não protege o teto, só joga
 * trabalho fora (a hora final para as que passarem do fim). Em unidade contínua, o consumo segue enquanto a sessão roda:
 * a leitura que alcança o teto fecha o arco e para as sessões em voo.
 *
 * As condições valem nesta ordem: revogado, hora, a parada da supervisão da N4 (RM-058, integração, D7 da
 * ork-rm058integra; a parada pelo teto do arco fica com a regra do custo e, sem sessão admitida em voo e com o consumo
 * abaixo do teto, fecha pela supervisão: N2 do CHECK 2), custo, fila vazia (D8). Revogado, hora, a parada e o teto em sessões não dependem da fila nem da
 * medição, e nenhuma falha delas segura esse fechamento. Com uma condição, o fechamento grava primeiro o
 * `encerrado` no log do arco (`encerrarArco`): dali em diante nenhuma reserva de despacho nem efeito passa, e nenhuma
 * reserva devolvida reabre o arco. Só depois vêm o retrato do fechamento e o pedido de parada de cada sessão em voo, no
 * registro próprio da N6 (`fechamento.jsonl`). A parada é pedida uma vez por sessão, pelo controle da conta dela (o
 * `pararSessao` do núcleo no claude-bg); o codex fica `sem-controle`, porque parar uma sessão dele exige o controller
 * vinculado (limite da N4). A reserva pendente para pelo id que a falha do runtime disse no ledger da thread, quando
 * disse; sem ele, não há o que parar. No tique seguinte, a listagem do runtime confirma a parada, ou a deixa
 * `nao-confirmada`. O retrato é gravado uma vez; se o processo cair entre o `encerrado` e o registro, o tique seguinte o
 * grava.
 *
 * Subteto de conta ou runtime esgotado não fecha o arco: a reserva por aquela conta ou runtime é recusada, e trocar para
 * outra conta admitida é da N4. Consumo com lacuna também não fecha por custo (o teto não se prova alcançado); a admissão
 * já recusa por falta de medida.
 *
 * Interfaces para as fatias que correm em paralelo (D6): a parada (`parar`) e a listagem das sessões (`listarSessoes`)
 * são injetáveis; a N4 pluga o controle dela aí. Nada aqui despacha.
 */
import { formatarDataHora } from './horario';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { masterRatificado } from './master';
import { encerrarArco, EncerramentoDoArco, EstadoDoArco, lerArco, MotivoDeEncerramento } from './noctum-arco';
import { envelopeMultimaquina, RecusaDoArco, Unidade, UNIDADES } from './noctum-envelope';
import { FatosDaFila, fatosDaFila, FilaDoArco, LeitorDeReservas, montarFila } from './noctum-fila';
import { coordenacaoDaFila, lerRede, RedeDoArco } from './noctum-rede';
import { ConsumoNaUnidade, consumoDoEscopoNaUnidade, MedicaoDoArco, medirArco, textoDoConsumo } from './noctum-medicao';
import { comRegistro, lerRegistro } from './noctum-registro';
import { EstadoDaSupervisao, lerSupervisao, RecusaDaSupervisao } from './noctum-supervisao';
import { SessaoEmVoo, sessoesEmVooDoArco } from './noctum-sessoes-em-voo';
import { consultarContas, encerradaNaLista } from './sessoes-contas';
import { pararSessao } from './sessoes';
import { dirThread, lerThread } from './thread';
import { Fase } from './types';
import { exec } from './util';

export const CONTRATO_FECHAMENTO = 'ork.noctum-fechamento/v1' as const;

export type ResultadoDaParada = 'pedida' | 'falhou' | 'sem-controle' | 'sem-id';

export interface ParadaDeSessao {
  /** O `seq` da reserva no log do arco. */
  seq: number;
  sessionId: string | null;
  trabalho: string;
  thread: string | null;
  runtime: string;
  conta: string;
  resultado: ResultadoDaParada;
  detalhe: string;
}

export interface ConferenciaDaParada { sessionId: string; confirmada: boolean; detalhe: string }

export interface TrabalhoNaRetomada {
  id: string;
  item: string;
  thread: string | null;
  /** O estado do trabalho na fila no instante do fechamento. */
  estado: string;
  /** A fase a despachar no arco seguinte (o passo pela prova mais adiantada), quando há. */
  fase: Fase | null;
  motivo: string | null;
  detalhe: string;
  entregueEm: string | null;
  /** A branch e a ponta local da worktree da thread, e se a árvore está limpa; `null` sem worktree legível. */
  branch: string | null;
  ponta: string | null;
  arvoreLimpa: boolean | null;
}

export interface RetratoDoFechamento {
  contrato: typeof CONTRATO_FECHAMENTO;
  arco: string;
  motivo: MotivoDeEncerramento;
  detalhe: string;
  em: string;
  versao: number;
  envelopeSha256: string;
  /** O consumo medido no fechamento, por unidade, no arco inteiro; lacuna é `valor: null` com o motivo. */
  consumo: Record<Unidade, ConsumoNaUnidade>;
  /** A fila no fechamento: a situação, as lacunas (fontes não lidas) e cada trabalho. */
  fila: { situacao: string | null; lacunas: string[]; lida: boolean };
  retomada: {
    trabalhos: TrabalhoNaRetomada[];
    /** Reservas do log do arco ainda pendentes: o runtime pode ter aberto a sessão, sem id. */
    reservasEmVoo: Array<{ seq: number; trabalho: string; thread: string | null }>;
    reconciliacaoPendente: string[];
    instrucao: string[];
  };
}

// N4 do CHECK 2: as sessões em voo moram num módulo sem dependência pesada, que a guarda também lê sem ciclo de import.
export { sessoesEmVooDoArco };
export type { SessaoEmVoo };

type EventoDoFechamento =
  | { tipo: 'fechado'; retrato: RetratoDoFechamento }
  | { tipo: 'parada_pedida'; parada: ParadaDeSessao }
  | { tipo: 'parada_conferida'; conferencia: ConferenciaDaParada };

export interface OpcoesDoFechamento {
  quando?: string;
  maquina?: string;
  lerReservas?: LeitorDeReservas;
  /** A medição; em produção, `medirArco` sobre o disco. */
  medir?: (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco;
  /** O controle do runtime que para a sessão; em produção, `pararSessao` do núcleo no claude-bg. */
  parar?: (s: SessaoEmVoo) => { ok: boolean; detalhe: string };
  /** As sessões vivas no runtime, para confirmar a parada; `lidas: false` quando alguma fonte não respondeu. */
  listarSessoes?: () => { lidas: boolean; vivas: ReadonlySet<string> };
  /** A leitura do git da worktree (branch, ponta, árvore); em produção, o `git` local, sem rede. */
  git?: (cwd: string, args: string[]) => string | null;
  /** Projeção lida uma vez pelo tique; sem ela, o fechamento lê a rede quando o envelope é v3. */
  projecaoDaRede?: RedeDoArco;
  remoto?: string;
  redeDaCoordenacao?: import('./branch-de-estado').OpcoesDeGit;
}

export interface ResultadoDoFechamento {
  fechado: boolean;
  /** O arco fechou nesta chamada (e não antes). */
  agora: boolean;
  motivo: MotivoDeEncerramento | null;
  detalhe: string;
  retrato: RetratoDoFechamento | null;
  paradas: ParadaDeSessao[];
  conferencias: ConferenciaDaParada[];
}

/**
 * A condição de fechamento no instante dado, pura, na ordem da D8. `null` quando o arco segue (ou nunca foi autorizado).
 * O custo só fecha com o teto do arco provado alcançado: em `sessoes`, pelas reservas não recusadas e sem sessão admitida
 * em voo (`emVoo`, as sessões e reservas pendentes que ainda podem rodar); em outra unidade, pelo consumo medido sem
 * lacuna. A parada pelo teto do arco espera as sessões admitidas e, sem nenhuma em voo, fecha pelo custo com o consumo no
 * teto, ou pela supervisão abaixo dele (a reserva devolvida, a emenda que subiu o teto depois da parada).
 */
export function condicaoDeFechamento(estado: EstadoDoArco | null, fila: FilaDoArco | null, medicao: MedicaoDoArco | null,
  quando: string, emVoo = 0, parada: { motivo: string; detalhe: string } | null = null): { motivo: MotivoDeEncerramento; detalhe: string } | null {
  if (!estado || !estado.autorizadoPor || !estado.conteudo) return null;
  if (estado.encerramento) return { motivo: estado.encerramento.motivo, detalhe: estado.encerramento.detalhe };
  if (estado.situacao === 'revogado') return { motivo: 'revogado', detalhe: 'o dono revogou o arco pelo ingresso autenticado' };
  const fim = estado.conteudo.janela.fim;
  if (Date.parse(quando) >= Date.parse(fim)) {
    return { motivo: 'hora', detalhe: `o fim do envelope chegou (${formatarDataHora(fim, { fuso: estado.conteudo.janela.fuso, locale: 'pt-BR' })}, ` +
      `${estado.conteudo.janela.fuso}); nada o prorroga` };
  }
  // RM-058, integração (D7): a supervisão parou o arco (o vigia nunca encerra; quem encerra é o fechamento, por ela). A
  // parada pelo teto do arco em sessões é a regra do custo logo abaixo: as sessões admitidas terminam, e o arco fecha
  // quando a última acaba (A1 do CHECK); fechar por ela pediria a parada de trabalho já contado no teto.
  if (parada && parada.motivo !== 'teto-do-arco') return { motivo: 'supervisao', detalhe: `a supervisão parou o arco (${parada.motivo}): ${parada.detalhe}` };
  const teto = estado.conteudo.orcamento.arco;
  if (teto.unidade === 'sessoes') {
    // Cada sessão admitida já está contada no teto: o arco fecha quando a última acaba, não por cima dela.
    if (estado.consumo.arco >= teto.valor && emVoo === 0) {
      return { motivo: 'custo', detalhe: `o teto do arco é de ${teto.valor} sessoes e ${estado.consumo.arco} foram reservadas; nenhuma segue em voo` };
    }
  } else if (medicao) {
    const c = consumoDoEscopoNaUnidade(medicao, 'arco', teto.unidade);
    if (c.valor !== null && Number.isFinite(c.valor) && c.valor >= teto.valor) {
      return { motivo: 'custo', detalhe: `o teto do arco é de ${teto.valor} ${teto.unidade} e o consumo medido é ${textoDoConsumo(c)}` };
    }
  }
  // N2 do CHECK 2: a parada pelo teto segue terminal com o consumo abaixo dele (a reserva devolvida, a emenda que subiu o teto
  // depois da parada): sem sessão admitida em voo, o arco fecha pela supervisão, em vez de ficar parado e aberto até a hora.
  if (parada && emVoo === 0) {
    return { motivo: 'supervisao', detalhe: `a supervisão parou o arco (${parada.motivo}): ${parada.detalhe}; nenhuma sessão admitida segue em voo` };
  }
  if (estado.situacao === 'agendado') return null;
  if (fila?.situacao === 'vazia' && fila.decisao.acao === 'encerrar' && fila.decisao.motivo === 'fila-vazia') {
    // A entrega registrada (`ship_done`) pode vir sem a prova do push; o relatório diz qual tem prova.
    return { motivo: 'fila-vazia', detalhe: 'todo trabalho do envelope tem a entrega registrada (ship_done), fechou sem entrega ou depende ' +
      'de um que fechou sem entrega; nada sobra para este arco' };
  }
  return null;
}

/**
 * RM-058, integração (T4, D8): as threads que este arco entregou (o `ship_done` da entrega dele, com o arco na evidência) e
 * cujo MASTER por omissão a entrega dele ainda faz, como em `noctum-entrega.ts`: o envelope `v2`, o trabalho sem isolamento,
 * a thread aberta e sem MASTER ratificado. A thread que não se lê não segura o fechamento: a fila já a mostra.
 */
function mastersDevidos(raiz: string, estado: EstadoDoArco, fila: FilaDoArco, sup: EstadoDaSupervisao): string[] {
  const devidos: string[] = [];
  for (const t of fila.trabalhos) {
    if (t.estado !== 'entregue' || !t.thread || sup.isolados.has(t.id)) continue;
    try {
      const doArco = lerLedger(dirThread(raiz, t.thread)).some(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido &&
        (e.evidencia as { arco?: unknown } | undefined)?.arco === estado.arco);
      if (doArco && lerThread(raiz, t.thread).status !== 'fechada' && !masterRatificado(raiz, t.thread)) devidos.push(t.thread);
    } catch { /* a leitura que falhou não prende o arco aberto */ }
  }
  return devidos;
}

const gitDoDisco = (cwd: string, args: string[]): string | null => {
  const r = exec('git', ['-C', cwd, ...args], undefined, 15_000);
  return r.ok ? r.stdout.trim() : null;
};

/** As sessões vivas pelo `claude agents` e pelos rollouts de todas as contas que o `ork` conhece. */
function sessoesDoRuntime(raiz: string): { lidas: boolean; vivas: ReadonlySet<string> } {
  try {
    const l = consultarContas(raiz);
    return { lidas: l.fontes.every(f => f.ok), vivas: new Set(l.sessoes.filter(s => s.viva && !encerradaNaLista(s)).map(s => s.sessionId)) };
  } catch { return { lidas: false, vivas: new Set() }; }
}

/** O controle de produção: o claude-bg para pela conta dele; o codex não tem controle sem o controller vinculado. */
function pararPeloNucleo(raiz: string): (s: SessaoEmVoo) => { ok: boolean; detalhe: string } {
  return (s) => {
    if (!s.sessionId) return { ok: false, detalhe: 'sem id de sessão' };
    const r = pararSessao(s.sessionId, raiz);
    return { ok: r.codigo === 0, detalhe: r.texto.slice(0, 300) };
  };
}

function trabalhosNaRetomada(raiz: string, fila: FilaDoArco | null, git: (cwd: string, args: string[]) => string | null): TrabalhoNaRetomada[] {
  return (fila?.trabalhos ?? []).map(t => {
    let branch: string | null = null, ponta: string | null = null, arvoreLimpa: boolean | null = null;
    if (t.thread) {
      let wt: string | null = null;
      try { wt = lerThread(raiz, t.thread).worktree ?? null; } catch { wt = null; }
      if (wt) {
        branch = git(wt, ['rev-parse', '--abbrev-ref', 'HEAD']);
        ponta = git(wt, ['rev-parse', 'HEAD']);
        const status = git(wt, ['status', '--porcelain']);
        arvoreLimpa = status === null ? null : status.length === 0;
      }
    }
    return { id: t.id, item: t.item, thread: t.thread, estado: t.estado, fase: t.fase, motivo: t.motivo, detalhe: t.detalhe,
      entregueEm: t.entregueEm, branch, ponta, arvoreLimpa };
  });
}

function instrucaoDeRetomada(arco: string, trabalhos: TrabalhoNaRetomada[], reservas: RetratoDoFechamento['retomada']['reservasEmVoo'],
  emVoo: SessaoEmVoo[]): string[] {
  const linhas = [`O arco ${arco} não reabre: o trabalho que sobrou volta num arco novo, com envelope vigente proposto por ` +
    '`ork noctum propor` e autorizado pelo dono por ingresso autenticado.'];
  if (reservas.length) {
    linhas.push(`As reservas pendentes (${reservas.map(r => r.seq).join(', ')}) precisam ser reconciliadas antes do primeiro despacho do arco ` +
      'novo, pela N4 ou pelo dono: o runtime pode ter aberto a sessão, e nada deve ser despachado por cima dela.');
  }
  for (const t of trabalhos.filter(x => x.thread && x.estado !== 'entregue' && x.estado !== 'encerrado-sem-entrega')) {
    linhas.push(`A thread ${t.thread} (${t.id}) retoma pelo passo do arco novo${t.fase ? `, na fase ${t.fase}` : ''}, pela prova mais adiantada` +
      `${t.arvoreLimpa === false ? '; a árvore tem mudanças não commitadas, que a sessão seguinte confere' : ''}.`);
  }
  if (emVoo.some(s => s.runtime === 'codex' && s.sessionId)) {
    linhas.push('A sessão do codex em voo não tem controle de parada sem o controller vinculado: confira-a antes do arco novo.');
  }
  linhas.push('Commit, push ou merge de resultado incerto nunca se repete às cegas: quem retoma reconcilia antes de agir.');
  return linhas;
}

/**
 * A classificação de cada trabalho como se o arco estivesse vigente. `montarFila` não classifica nada num arco expirado,
 * revogado ou encerrado (nada é candidato), e o retrato do fechamento e o relatório precisam saber onde cada trabalho
 * parou justamente nesses arcos. A decisão desta fila não vale para despachar: só a classificação é lida.
 */
export function trabalhosDoArco(fatos: FatosDaFila): FilaDoArco {
  const e = fatos.estado;
  if (!e || !e.conteudo || !e.autorizadoPor || e.situacao === 'vigente') return montarFila(fatos);
  return montarFila({ ...fatos, estado: { ...e, situacao: 'vigente' } });
}

/** O retrato gravado e as paradas e conferências do registro do fechamento. */
export function lerFechamento(raiz: string, arco: string): { retrato: RetratoDoFechamento | null; paradas: ParadaDeSessao[];
  conferencias: ConferenciaDaParada[] } {
  const linhas = lerRegistro<EventoDoFechamento>(raiz, arco, 'fechamento');
  const fechado = linhas.find(l => l.evento.tipo === 'fechado')?.evento;
  return {
    retrato: fechado?.tipo === 'fechado' ? fechado.retrato : null,
    paradas: linhas.filter(l => l.evento.tipo === 'parada_pedida').map(l => (l.evento as { parada: ParadaDeSessao }).parada),
    conferencias: linhas.filter(l => l.evento.tipo === 'parada_conferida').map(l => (l.evento as { conferencia: ConferenciaDaParada }).conferencia),
  };
}

/** O retrato do fechamento: o consumo, a fila e o estado de retomada, lidos no instante dado e gravados uma vez. */
function gravarRetrato(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, encerramento: EncerramentoDoArco, quando: string,
  o: OpcoesDoFechamento & Required<Pick<OpcoesDoFechamento, 'medir' | 'git'>>): void {
  const { raiz } = carregado;
  let trabalhosDaFila: FilaDoArco | null = null;
  try {
    const rede = estado.conteudo && envelopeMultimaquina(estado.conteudo)
      ? o.projecaoDaRede ?? lerRede(carregado, arco, { quando, maquina: o.maquina, remoto: o.remoto, rede: o.redeDaCoordenacao }) : null;
    const coordenacao = rede ? coordenacaoDaFila(rede) : null;
    trabalhosDaFila = rede?.lacuna ? null : trabalhosDoArco(fatosDaFila(carregado, arco,
      { quando, maquina: o.maquina, lerReservas: o.lerReservas, ...(coordenacao ? { coordenacao } : {}) }));
  }
  catch (e) { if (!(e instanceof RecusaDoArco)) throw e; }
  let consumo: Record<Unidade, ConsumoNaUnidade>;
  try {
    const medicao = o.medir(raiz, estado, quando);
    consumo = Object.fromEntries(UNIDADES.map(u => [u, consumoDoEscopoNaUnidade(medicao, 'arco', u)])) as Record<Unidade, ConsumoNaUnidade>;
  } catch (e) {
    const lacuna = `a medição falhou no fechamento (${(e as Error).message.slice(0, 200)})`;
    consumo = Object.fromEntries(UNIDADES.map(u => [u, { unidade: u, valor: null, lacunas: [lacuna], parcial: false, tetoSuperior: false,
      sessoes: 0 }])) as Record<Unidade, ConsumoNaUnidade>;
  }
  const emVoo = sessoesEmVooDoArco(raiz, estado);
  const trabalhos = trabalhosNaRetomada(raiz, trabalhosDaFila, o.git);
  const reservasEmVoo = estado.despachos.filter(d => d.desfecho === 'pendente')
    .map(d => ({ seq: d.seq, trabalho: d.trabalho, thread: d.threadDespachada ?? d.thread }));
  const ditaNaFalha = new Map(emVoo.filter(s => s.daReservaPendente && s.sessionId).map(s => [s.seq, s.sessionId!]));
  const retrato: RetratoDoFechamento = {
    contrato: CONTRATO_FECHAMENTO, arco, motivo: encerramento.motivo, detalhe: encerramento.detalhe, em: encerramento.em,
    versao: encerramento.versao, envelopeSha256: encerramento.envelopeSha256, consumo,
    // A situação da fila como se o arco seguisse: a do arco encerrado é sempre vazia, e não diz onde o trabalho parou.
    fila: { situacao: trabalhosDaFila?.situacao ?? null,
      lacunas: trabalhosDaFila ? trabalhosDaFila.lacunas : ['a fila do arco não pôde ser lida no fechamento'], lida: !!trabalhosDaFila },
    retomada: { trabalhos, reservasEmVoo,
      reconciliacaoPendente: [...reservasEmVoo.map(r => ditaNaFalha.has(r.seq)
        ? `reserva ${r.seq} (${r.trabalho}): pendente, com a sessão ${ditaNaFalha.get(r.seq)} dita na falha do runtime`
        : `reserva ${r.seq} (${r.trabalho}): pendente, sem id de sessão`),
        ...emVoo.filter(s => s.sessionId && !s.daReservaPendente).map(s => `sessão ${s.sessionId} (${s.trabalho}): em voo no fechamento`)],
      instrucao: instrucaoDeRetomada(arco, trabalhos, reservasEmVoo, emVoo) },
  };
  comRegistro<EventoDoFechamento, void>(raiz, arco, 'fechamento', (linhas, anexar) => {
    if (!linhas.some(l => l.evento.tipo === 'fechado')) anexar({ tipo: 'fechado', retrato }, quando);
  }, { esperarMs: 5_000 });
}

/**
 * Fecha o arco se alguma condição vale, e confirma as paradas pendentes de um arco já fechado. Idempotente: o segundo
 * chamado não grava outro retrato nem pede a mesma parada de novo. Lança só o erro que não é recusa tipada do arco.
 */
export function fecharSeDevido(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoFechamento = {}): ResultadoDoFechamento {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const nada = (detalhe: string): ResultadoDoFechamento =>
    ({ fechado: false, agora: false, motivo: null, detalhe, retrato: null, paradas: [], conferencias: [] });
  let estado: EstadoDoArco | null;
  try { estado = lerArco(raiz, arco, quando); }
  catch (e) { if (e instanceof RecusaDoArco) return nada(e.message); throw e; }
  if (!estado) return nada(`o arco ${arco} não tem proposta`);
  if (!estado.autorizadoPor || !estado.conteudo) return nada(`o arco ${arco} nunca foi autorizado pelo dono`);
  const medir = opcoes.medir ?? ((r, e, q) => medirArco(r, e, { quando: q }));
  const git = opcoes.git ?? gitDoDisco;
  const parar = opcoes.parar ?? pararPeloNucleo(raiz);
  const listar = opcoes.listarSessoes ?? (() => sessoesDoRuntime(raiz));
  let agora = false;
  if (!estado.encerramento) {
    const emVooAgora = sessoesEmVooDoArco(raiz, estado).length;
    const multimaquina = envelopeMultimaquina(estado.conteudo);
    const rede = multimaquina
      ? opcoes.projecaoDaRede ?? lerRede(carregado, arco, { quando, maquina: opcoes.maquina, remoto: opcoes.remoto, rede: opcoes.redeDaCoordenacao })
      : null;
    // Com rede íntegra, o teto em sessões é global. Sem leitura, o consumo local ainda pode provar sozinho que o teto caiu.
    const estadoDoCusto = rede && !rede.lacuna
      ? { ...estado, consumo: { ...estado.consumo, arco: rede.consumo.arco } }
      : estado;
    // RM-058, integração (D7): a parada da supervisão; o log dela que não se lê não segura o fechamento pelas outras condições.
    let sup: EstadoDaSupervisao | null = null;
    try { sup = lerSupervisao(raiz, arco); } catch (e) { if (!(e instanceof RecusaDaSupervisao)) throw e; }
    const parada = sup?.parada ?? null;
    // Revogado, hora, a parada e o teto em sessões vêm primeiro e sem a fila nem a medição: nenhuma falha delas segura esse fechamento.
    let condicao = condicaoDeFechamento(estadoDoCusto, null, null, quando, emVooAgora, parada);
    let falhaDaMedicao = '';
    if (!condicao) {
      let fila: FilaDoArco | null = null;
      try {
        const coordenacao = rede ? coordenacaoDaFila(rede) : null;
        fila = rede?.lacuna ? null : montarFila(fatosDaFila(carregado, arco,
          { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, ...(coordenacao ? { coordenacao } : {}) }));
      }
      catch (e) { if (!(e instanceof RecusaDoArco)) throw e; }
      let medicao: MedicaoDoArco | null = null;
      if (estado.conteudo.orcamento.arco.unidade !== 'sessoes' && !rede?.lacuna) {
        // A medição que falha não prova o teto alcançado: o custo não fecha, e a fila vazia ainda pode fechar.
        try { medicao = medir(raiz, estado, quando); }
        catch (e) { falhaDaMedicao = `; a medição falhou (${(e as Error).message.slice(0, 200)})`; }
      }
      condicao = condicaoDeFechamento(estadoDoCusto, fila, medicao, quando, emVooAgora, parada);
      // RM-058, integração (T4, D8): a fila vazia não fecha o arco por cima do MASTER por omissão que a entrega dele ainda
      // deve; o passo seguinte o faz, e o fechamento vem depois. A hora, a parada e o teto fecharam antes, sem esperar.
      const devidos = condicao?.motivo === 'fila-vazia' && fila && sup ? mastersDevidos(raiz, estado, fila, sup) : [];
      if (devidos.length) {
        return nada(`o arco segue: a fila está vazia, mas a entrega do arco ainda faz o MASTER por omissão de ${devidos.join(', ')}`);
      }
    }
    if (!condicao) return nada(`o arco segue: nenhuma condição de fechamento vale agora${falhaDaMedicao}`);
    // O terminal primeiro: daqui em diante nenhum despacho nem efeito passa.
    estado = encerrarArco(raiz, arco, condicao, quando);
    agora = true;
  }
  const encerramento: EncerramentoDoArco = estado.encerramento!;
  // O retrato do fechamento, uma vez: se o processo caiu entre o encerrado e o registro, o tique seguinte o grava.
  if (!lerFechamento(raiz, arco).retrato) gravarRetrato(carregado, arco, estado, encerramento, quando, { ...opcoes, medir, git });
  // Pede a parada de cada sessão em voo uma vez, e confere as pedidas antes; tudo sob a trava do registro do fechamento.
  const atual = lerArco(raiz, arco, quando) ?? estado;
  const emVoo = sessoesEmVooDoArco(raiz, atual);
  const novas: ParadaDeSessao[] = [], conferidas: ConferenciaDaParada[] = [];
  comRegistro<EventoDoFechamento, void>(raiz, arco, 'fechamento', (linhas, anexar) => {
    const pedidas = linhas.filter(l => l.evento.tipo === 'parada_pedida').map(l => (l.evento as { parada: ParadaDeSessao }).parada);
    const jaConferidas = new Set(linhas.filter(l => l.evento.tipo === 'parada_conferida')
      .map(l => (l.evento as { conferencia: ConferenciaDaParada }).conferencia.sessionId));
    const aConferir = pedidas.filter(p => p.resultado === 'pedida' && p.sessionId && !jaConferidas.has(p.sessionId));
    if (aConferir.length && !agora) {
      const lista = listar();
      if (lista.lidas) {
        for (const p of aConferir) {
          const conferencia: ConferenciaDaParada = { sessionId: p.sessionId!, confirmada: !lista.vivas.has(p.sessionId!),
            detalhe: lista.vivas.has(p.sessionId!) ? 'a sessão segue viva na listagem do runtime depois do pedido de parada'
              : 'a sessão não aparece viva na listagem do runtime' };
          anexar({ tipo: 'parada_conferida', conferencia }, quando);
          conferidas.push(conferencia);
        }
      }
    }
    const chave = (s: { seq: number; sessionId: string | null }) => s.sessionId ?? `reserva:${s.seq}`;
    const jaPedidas = new Set(pedidas.map(chave));
    for (const s of emVoo.filter(x => !jaPedidas.has(chave(x)))) {
      let resultado: ResultadoDaParada, detalhe: string;
      if (!s.sessionId) { resultado = 'sem-id'; detalhe = 'reserva pendente: a sessão pode ter aberto sem id, e não há o que parar'; }
      else if (s.runtime !== 'claude-bg') { resultado = 'sem-controle'; detalhe = 'parar a sessão do codex exige o controller vinculado'; }
      else {
        let r: { ok: boolean; detalhe: string };
        try { r = parar(s); } catch (e) { r = { ok: false, detalhe: (e as Error).message.slice(0, 300) }; }
        resultado = r.ok ? 'pedida' : 'falhou';
        detalhe = r.detalhe || (r.ok ? 'o runtime aceitou o pedido de parada' : 'o runtime não aceitou o pedido de parada');
      }
      const parada: ParadaDeSessao = { seq: s.seq, sessionId: s.sessionId, trabalho: s.trabalho, thread: s.thread, runtime: s.runtime,
        conta: s.conta, resultado, detalhe };
      anexar({ tipo: 'parada_pedida', parada }, quando);
      novas.push(parada);
    }
  }, { esperarMs: 5_000 });
  const registro = lerFechamento(raiz, arco);
  return { fechado: true, agora, motivo: encerramento.motivo, detalhe: encerramento.detalhe, retrato: registro.retrato,
    paradas: registro.paradas, conferencias: registro.conferencias };
}

/** O que cada desfecho da parada quer dizer para o dono, sem o código. */
const PARADA_EM_TEXTO: Readonly<Record<Exclude<ResultadoDaParada, 'pedida'>, (p: ParadaDeSessao) => string>> = Object.freeze({
  'sem-id': () => 'reserva pendente sem id de sessão, nada a parar; reconciliar antes do arco novo',
  'sem-controle': (p: ParadaDeSessao) => `sem controle de parada no ${p.runtime}; conferir a sessão antes do arco novo`,
  falhou: (p: ParadaDeSessao) => `o pedido de parada falhou (${p.detalhe})`,
});

/** Uma linha por parada, para o retrato e o relatório. */
export function textoDaParada(p: ParadaDeSessao, conferencias: readonly ConferenciaDaParada[]): string {
  const c = p.sessionId ? conferencias.find(x => x.sessionId === p.sessionId) : undefined;
  const situacao = p.resultado !== 'pedida' ? PARADA_EM_TEXTO[p.resultado](p) : !c ? 'parada pedida, sem conferência ainda'
    : c.confirmada ? 'parada confirmada' : 'parada não confirmada';
  return `${p.sessionId ?? `reserva ${p.seq}`} (${p.trabalho}, ${p.runtime}): ${situacao}`;
}

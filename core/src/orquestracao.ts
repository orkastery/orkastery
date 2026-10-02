/**
 * `ork orquestracao status` (alias `ork monitor`): quem esta parado, esperando o que.
 *
 * O problema que este arquivo resolve e de CONDUCAO, nao de execucao: uma thread que
 * fecha um bloco com pausa humana fica esperando veredito e ninguem e avisado; uma
 * thread que perde a corrida do lease fica na fila e ninguem e avisado. O orquestrador
 * so descobre quando o humano pergunta, e ate la o roadmap ja atrasou.
 *
 * O comando e a resposta deterministica a essa pergunta, de UMA chamada:
 *   - quais threads estao paradas em PAUSA HUMANA (HITL), esperando veredito;
 *   - quais estao em IMPEDIMENTO (lease em colisao, gate tipado reprovado, limite de uso
 *     do runtime, limite de paralelismo da maquina);
 *   - o que cada pausa exige do humano (`pausaSobre` do bloco), com evidencia e correcao;
 *   - ha quanto tempo cada uma esta parada.
 *
 * Tres regras que mandam aqui:
 *
 *   1. **Nada de estado novo.** Toda parada e DERIVADA do que ja existe em disco:
 *      `thread.json`, `ledger.jsonl`, `.orkastery/leases/fila.json` e
 *      `.orkastery/retry/fila.jsonl`. O monitor le, nunca grava. Por isso ele e seguro
 *      de rodar em laco, e por isso ele funciona em thread criada antes deste comando.
 *   2. **O `ork` entrega o estado, nao manda mensagem.** Notificar o humano e do
 *      orquestrador (Camada 1), que consome o `--json`. O nucleo continua sem LLM.
 *   3. **Fonte declarada.** Quando o runtime nao pode ser consultado para saber se a
 *      sessao do bloco ainda esta viva, o monitor diz isso (`sessaoViva: null`) e avisa
 *      A MAIS. Perder uma pausa custa roadmap; avisar de uma pausa que ainda nao chegou
 *      custa uma linha de tabela.
 */

import * as adapter from './adapters/claude-bg';
import { planejar, threadsDeTodosOsPerfis, perfisDetectados } from './board';
import { DESCRICAO_DO_MOTIVO } from './gates';
import { ehEnsaio, lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import {
  ehAprovacaoHumana,
  ehPausaPrevista,
  faseTemPausaPrevista,
  EVENTOS_QUE_DESTRAVAM,
  PAUSA_PREVISTA,
} from './ocupacao';
import { faltaPara, lerFilaDeRetomada } from './ratelimit';
import { estadoBruto } from './hitl';
import { blocoDaThread, dirThread } from './thread';
import {
  EventoLedger,
  Fase,
  FonteDaParada,
  LinhaDoMonitor,
  MonitorDeOrquestracao,
  MotivoGate,
  ParadaDaThread,
  SituacaoNoEscalonador,
  Thread,
  ThreadNoBoard,
  VagaDaThread,
} from './types';
import { agora, tabela } from './util';
import { duracaoCurta, duracaoRelativa, formatarHora, legendaDoFuso, localizarTexto } from './horario';
import { conducaoDaThread } from './conducao';
import { linhaDeConducao } from './conducao-texto';


/** Limite de atencao padrao, em minutos: parada mais velha que isso e destacada. */
export const ATENCAO_PADRAO_MIN = 30;

/** Minutos inteiros entre dois carimbos ISO (nunca negativo). */
export function minutosEntre(desdeEm: string, ateEm: string): number {
  const inicio = Date.parse(desdeEm);
  const fim = Date.parse(ateEm);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 0;
  return Math.max(0, Math.floor((fim - inicio) / 60000));
}

/** Duracao curta para a tabela (`12min`, `3h05`, `2d 04h`): mora em `horario.ts` (I-35). */
export { duracaoCurta };

/** Indice da fase no ciclo REAL da thread (a variante de ciclo pode encurtar o ciclo). */
function indiceDaFase(thread: Thread, fase: unknown): number {
  return typeof fase === 'string' ? thread.fases.indexOf(fase as Fase) : -1;
}

/** Fase valida do ciclo da thread, ou null quando o evento nao carrega fase util. */
function faseDoEvento(thread: Thread, e: EventoLedger): Fase | null {
  const i = indiceDaFase(thread, e.fase);
  return i >= 0 ? thread.fases[i] : null;
}

/** Texto do bloco de uma fase (`GOAL-PLAN`), vazio quando a fase nao pertence a bloco. */
function blocoDaFase(thread: Thread, fase: Fase | null): { bloco: string; pausaSobre: string } {
  if (!fase) return { bloco: '', pausaSobre: '' };
  try {
    const b = blocoDaThread(thread, fase);
    return { bloco: b.fases.join('-'), pausaSobre: b.pausa ? b.pausaSobre : '' };
  } catch {
    return { bloco: '', pausaSobre: '' };
  }
}

/** Comando que o humano roda para liberar uma pausa da thread. */
function comandoDeAprovacao(threadId: string, _sobre: string): string {
  return `ork gate request ${threadId}`;
}

interface MontarParada {
  natureza: ParadaDaThread['natureza'];
  motivo: ParadaDaThread['motivo'];
  fase: Fase | null;
  bloco: string;
  pausaSobre: string;
  detalhe: string;
  evidencia: string;
  correcao: string;
  desdeEm: string;
  sessaoViva: boolean | null;
  sessaoEstado?: string | null;
  fonte: FonteDaParada;
}

function parada(dados: MontarParada, quando: string): ParadaDaThread {
  return { ...dados, paradaHaMin: minutosEntre(dados.desdeEm, quando) };
}

/**
 * As pausas humanas ABERTAS da thread.
 *
 * Tres fontes, na ordem de confianca. A mesma fase nunca vira duas linhas: a primeira
 * fonte que a reivindica fica com ela, e as demais so acrescentam evidencia.
 */
function pausasAbertas(
  thread: Thread,
  eventos: EventoLedger[],
  estados: Map<string, string> | null,
  quando: string
): ParadaDaThread[] {
  const porFase = new Map<string, ParadaDaThread>();
  if (thread.status === 'fechada') return [];

  // Fonte 1: o ledger, que e onde a pausa prevista pelo modo fica registrada com a
  // sessao que a produziu. Aberta enquanto ninguem aprovou e a conducao nao passou
  // para uma fase POSTERIOR (redespachar a mesma fase nao resolve pausa nenhuma).
  eventos.forEach((e, i) => {
    if (!ehPausaPrevista(e)) return;
    const fase = faseDoEvento(thread, e);
    // A previsão antiga não substitui o modo corrente nem cria pausa intermediária.
    if (!fase) return;
    const previsto = blocoDaThread(thread, fase);
    if (!previsto.pausa || previsto.fases.at(-1) !== fase) return;
    const iFase = fase ? thread.fases.indexOf(fase) : -1;
    const resolvida = eventos.slice(i + 1).some((p) => {
      if (ehAprovacaoHumana(p)) return true;
      if (p.tipo === TIPOS_DE_EVENTO.masterConcluido) return true;
      return p.tipo === TIPOS_DE_EVENTO.faseDespachada && indiceDaFase(thread, p.fase) > iFase;
    });
    if (resolvida) return;

    const sessionId = typeof e.sessionId === 'string' ? e.sessionId : '';
    // "Viva" aqui quer dizer TRABALHANDO, e nao "aparece na lista do runtime". Foi essa
    // confusao que deixou passar o incidente de 05/09/2026: a sessao travada em HITL
    // continua listada, e o monitor a lia como uma sessao que ainda ia terminar. Uma
    // sessao `blocked` e o contrario disso -- ela e a pausa, ja chegada.
    const sessaoEstado = estados === null ? null : estados.get(sessionId) ?? null;
    const sessaoViva =
      estados === null ? null : sessaoEstado === 'working' || sessaoEstado === '';
    const sobre = typeof e.previstaSobre === 'string' && e.previstaSobre !== ''
      ? e.previstaSobre
      : blocoDaFase(thread, fase).pausaSobre;
    const chave = fase ?? `evento-${i}`;
    porFase.set(
      chave,
      parada(
        {
          natureza: 'pausa-humana',
          motivo: 'human.pending',
          fase,
          bloco: blocoDaFase(thread, fase).bloco,
          pausaSobre: sobre,
          detalhe:
            sessaoViva === true
              ? `a sessao ${sessionId.slice(0, 8)} do bloco ainda esta trabalhando no runtime: a pausa chega quando ela terminar`
              : sessaoEstado === 'blocked'
                ? `a sessao ${sessionId.slice(0, 8)} do bloco esta BLOQUEADA no runtime esperando acao humana (prompt, permissao ou credencial): veja \`ork sessions hitl\``
                : `bloco fechado em ${fase ?? '?'}: espera o veredito humano sobre ${sobre || 'a pausa do bloco'}`,
          evidencia:
            `ledger ${TIPOS_DE_EVENTO.pausaHumana} (${PAUSA_PREVISTA})` +
            `${sessionId ? `, sessao ${sessionId.slice(0, 8)}` : ''}` +
            `${sessaoEstado ? ` em state=${sessaoEstado}` : ''}`,
          correcao:
            sessaoEstado === 'blocked'
              ? `ork sessions logs ${sessionId.slice(0, 8)} para ver o que a sessao pede, e claude attach ${sessionId} para responder`
              : comandoDeAprovacao(thread.id, sobre),
          desdeEm: e.ts,
          sessaoViva,
          sessaoEstado,
          fonte: 'ledger',
        },
        quando
      )
    );
  });

  // Fonte 2: `gate_blocked` com motivo `human.pending`. E por aqui que aparece a
  // ESCALADA do bloco B3 (limite de tentativas estourado), que pausa qualquer modo,
  // inclusive `#Auto` -- que por definicao nao tem pausa prevista no ledger.
  eventos.forEach((e, i) => {
    if (e.tipo !== TIPOS_DE_EVENTO.gateBloqueado || e.motivo !== 'human.pending') return;
    const resolvido = eventos
      .slice(i + 1)
      .some((p) => EVENTOS_QUE_DESTRAVAM.includes(p.tipo) || ehAprovacaoHumana(p));
    if (resolvido) return;
    const fase = faseDoEvento(thread, e);
    const chave = fase ?? `gate-${i}`;
    if (porFase.has(chave)) return;
    const { bloco, pausaSobre } = blocoDaFase(thread, fase);
    porFase.set(
      chave,
      parada(
        {
          natureza: 'pausa-humana',
          motivo: 'human.pending',
          fase,
          bloco,
          pausaSobre: pausaSobre || 'autorizacao da retomada',
          detalhe: typeof e.detalhe === 'string' && e.detalhe !== ''
            ? e.detalhe
            : DESCRICAO_DO_MOTIVO['human.pending'],
          evidencia: `ledger ${TIPOS_DE_EVENTO.gateBloqueado} (gate ${String(e.gate ?? '?')})`,
          correcao: typeof e.correcao === 'string' && e.correcao !== ''
            ? e.correcao
            : comandoDeAprovacao(thread.id, pausaSobre),
          desdeEm: e.ts,
          sessaoViva: null,
          fonte: 'ledger',
        },
        quando
      )
    );
  });

  // Fonte 3: `status: pausada` carimbado no proprio `thread.json`. E a fonte mais fraca
  // (nao diz sobre o que) e a mais duravel (sobrevive a ledger truncado), entao ela so
  // entra quando a fase atual ainda nao virou linha.
  if (thread.status === 'pausada' && faseTemPausaPrevista(thread) && !porFase.has(thread.faseAtual)) {
    const { bloco, pausaSobre } = blocoDaFase(thread, thread.faseAtual);
    porFase.set(
      thread.faseAtual,
      parada(
        {
          natureza: 'pausa-humana',
          motivo: 'human.pending',
          fase: thread.faseAtual,
          bloco,
          pausaSobre: pausaSobre || 'veredito do bloco',
          detalhe: `thread carimbada como pausada na fase ${thread.faseAtual}`,
          evidencia: 'thread.json (status: pausada)',
          correcao: comandoDeAprovacao(thread.id, pausaSobre),
          desdeEm: thread.atualizadaEm,
          sessaoViva: null,
          fonte: 'thread.json',
        },
        quando
      )
    );
  }

  return [...porFase.values()];
}

/** Os impedimentos ABERTOS da thread: o que trava sem ser veredito humano. */
function impedimentosAbertos(
  item: ThreadNoBoard,
  eventos: EventoLedger[],
  raizDoProjeto: string,
  quando: string
): ParadaDaThread[] {
  const { thread } = item;
  if (thread.status === 'fechada') return [];
  const saida: ParadaDaThread[] = [];

  // 1. Fila por colisao de regiao: o lease nao foi adquirido porque outra thread esta
  // na mesma regiao. A fila e FIFO e diz quem bloqueia quem.
  for (const p of item.naFila) {
    saida.push(
      parada(
        {
          natureza: 'impedimento',
          motivo: 'lease.busy',
          fase: thread.faseAtual,
          bloco: blocoDaFase(thread, thread.faseAtual).bloco,
          pausaSobre: '',
          detalhe: `na fila de ${p.nome}, atras da thread ${p.bloqueadaPor} (colide com ${p.colidiuCom})`,
          evidencia: `.orkastery/leases/fila.json (${p.tipo})`,
          correcao: `espere a thread ${p.bloqueadaPor} liberar (ork lease release ${p.colidiuCom} --thread ${p.bloqueadaPor}), ou reduza a regiao pedida`,
          desdeEm: p.desdeEm,
          sessaoViva: null,
          fonte: 'fila-de-lease',
        },
        quando
      )
    );
  }

  // 2. Fila DURAVEL de rate limit: a fase morreu no limite de uso da assinatura e espera
  // a janela seguinte. O impedimento e real, mas tem hora para acabar.
  for (const p of lerFilaDeRetomada(raizDoProjeto)) {
    if (p.thread !== thread.id || p.estado !== 'aguardando') continue;
    saida.push(
      parada(
        {
          natureza: 'impedimento',
          motivo: 'runtime.rate-limited',
          fase: p.fase,
          bloco: blocoDaFase(thread, p.fase).bloco,
          pausaSobre: '',
          detalhe:
            `pedido ${p.id} na fila de rate limit, libera ${faltaPara(p, quando)} ` +
            `(${p.liberaEm}, ${p.janelaEstimada ? 'janela estimada' : 'hora dita pelo runtime'})`,
          evidencia: `.orkastery/retry/fila.jsonl (${p.id}, ${p.sinal.fonte})`,
          correcao: `ork retry resume --id ${p.id}`,
          desdeEm: p.criadoEm,
          sessaoViva: null,
          fonte: 'fila-de-rate-limit',
        },
        quando
      )
    );
  }

  // 3. Gates tipados reprovados que ninguem destravou. `human.pending` sai daqui porque
  // ele ja e pausa humana, e `claims.unverifiable` avisa mas nao bloqueia.
  eventos.forEach((e, i) => {
    if (e.tipo !== TIPOS_DE_EVENTO.gateBloqueado && e.tipo !== 'phase_wait') return;
    const motivo = e.motivo as MotivoGate;
    if (motivo === 'human.pending' || motivo === 'claims.unverifiable') return;
    if (!(motivo in DESCRICAO_DO_MOTIVO)) return;
    // Lease e rate limit ja tem fila propria em disco, que e a fonte mais fresca.
    if ((motivo === 'lease.busy' || motivo === 'runtime.rate-limited') &&
      saida.some(p => p.motivo === motivo)) return;
    const resolvido = eventos
      .slice(i + 1)
      .some((p) => EVENTOS_QUE_DESTRAVAM.includes(p.tipo) || ehAprovacaoHumana(p));
    if (resolvido) return;
    const fase = faseDoEvento(thread, e);
    saida.push(
      parada(
        {
          natureza: 'impedimento',
          motivo,
          fase,
          bloco: blocoDaFase(thread, fase).bloco,
          pausaSobre: '',
          detalhe: typeof e.detalhe === 'string' && e.detalhe !== ''
            ? e.detalhe
            : DESCRICAO_DO_MOTIVO[motivo],
          evidencia: `ledger ${e.tipo} (gate ${String(e.gate ?? '?')})`,
          correcao: typeof e.correcao === 'string' && e.correcao !== ''
            ? e.correcao
            : `ork retry plan ${thread.id} --motivo ${motivo}`,
          desdeEm: e.ts,
          sessaoViva: null,
          fonte: 'ledger',
        },
        quando
      )
    );
  });

  return saida;
}

/** Situacao da thread quando o escalonador do perfil principal nao a cobre. */
function situacaoDerivada(item: ThreadNoBoard, temPausa: boolean): SituacaoNoEscalonador {
  if (item.thread.status === 'fechada') return 'fechada';
  if ((item.thread.status === 'pausada' && faseTemPausaPrevista(item.thread)) || temPausa) return 'pausada';
  if (item.leases.length > 0) return 'em-andamento';
  if (item.naFila.length > 0) return 'espera';
  return 'pode-avancar';
}

/**
 * Situacao final da thread na visao do monitor.
 *
 * O escalonador (`ork board plan`) so olha `thread.status` e os leases, entao ele nao ve
 * a pausa que ainda nao foi carimbada no `thread.json` nem o gate reprovado no ledger.
 * O monitor sabe mais, e corrige a situacao para o que esta acontecendo de fato.
 */
function situacaoDaLinha(
  item: ThreadNoBoard,
  vaga: VagaDaThread | undefined,
  precisaDeHumano: boolean,
  temImpedimento: boolean
): SituacaoNoEscalonador {
  if (item.thread.status === 'fechada') return 'fechada';
  if (precisaDeHumano) return 'pausada';
  const base = vaga ? vaga.situacao : situacaoDerivada(item, false);
  // Rate limit e gate tipado reprovado nao passam pelo escalonador, mas seguram a thread
  // do mesmo jeito: `pode-avancar` com impedimento aberto seria mentira.
  return temImpedimento && base === 'pode-avancar' ? 'espera' : base;
}

export interface OpcoesDoMonitor {
  /** Consulta já feita pelo pulse, para compartilhar o mesmo retrato do runtime. */
  estados?: Map<string, string> | null;
  /** Le todos os perfis do board, e nao so o do manifesto. */
  todos?: boolean;
  /** Minutos a partir dos quais a parada e destacada. */
  atencaoMin?: number;
  /** Deixa de fora as threads que nao estao paradas. */
  soParadas?: boolean;
  /** Nao consulta o runtime para saber se a sessao do bloco ainda esta viva. */
  semRuntime?: boolean;
  /** Instante da consulta (os testes fixam; o CLI usa o relogio). */
  agora?: string;
}

/**
 * Monta a visao agregada de pausas e impedimentos do projeto.
 *
 * Custo de leitura: um `thread.json` e um `ledger.jsonl` por thread, mais as duas filas
 * do projeto, mais no maximo uma chamada ao runtime para a lista de sessoes vivas.
 */
export function montarMonitor(
  carregado: ManifestoCarregado,
  opcoes: OpcoesDoMonitor = {}
): MonitorDeOrquestracao {
  const quando = opcoes.agora ?? agora();
  const atencaoMin = opcoes.atencaoMin ?? ATENCAO_PADRAO_MIN;
  const todos = opcoes.todos === true;
  const itens = threadsDeTodosOsPerfis(carregado, todos);

  // O runtime e a unica fonte que sabe se a sessao do bloco ainda trabalha. Sem ele, a
  // pausa prevista e reportada como valendo: avisar a mais e a postura correta aqui.
  let estados: Map<string, string> | null = null;
  let runtimeDetalhe = 'runtime nao consultado por --sem-runtime';
  if (opcoes.estados !== undefined) {
    estados = opcoes.estados;
    runtimeDetalhe = estados === null ? 'consulta de runtime indisponível' : '';
  } else if (opcoes.semRuntime !== true) {
    if (adapter.disponivel()) {
      estados = new Map(
        adapter
          .listarSessoes()
          .filter((s) => !!s.sessionId)
          .map((s) => [s.sessionId, estadoBruto(s)] as const)
      );
      runtimeDetalhe = '';
    } else {
      runtimeDetalhe = 'runtime adapter indisponivel nesta maquina (`claude` fora do PATH)';
    }
  }

  // O escalonador so conhece o perfil do manifesto; os demais caem na situacao derivada.
  // Os estados de sessao ja consultados vao junto: uma chamada ao runtime, nao duas.
  const vagas = new Map(
    planejar(carregado, { agora: quando, estados }).vagas.map((v) => [v.thread, v])
  );

  const linhas: LinhaDoMonitor[] = [];
  for (const item of itens) {
    const { thread } = item;
    // Fatia 2 do ensaio da 0.5.0 (P2): o evento de `--dry-run` nao abre parada no monitor nem no pulse.
    const eventos = lerLedger(dirThread(item.raiz, thread.id)).filter((e) => !ehEnsaio(e));
    const pausas = pausasAbertas(thread, eventos, estados, quando);
    const impedimentos = impedimentosAbertos(item, eventos, item.raiz, quando);

    // O limite de paralelismo da maquina tambem trava, e o escalonador ja o calculou.
    const vaga = item.raiz === carregado.raiz ? vagas.get(thread.id) : undefined;
    if (vaga && vaga.motivo === 'vaga.stale') {
      impedimentos.push(
        parada(
          {
            natureza: 'impedimento',
            motivo: 'vaga.stale',
            fase: thread.faseAtual,
            bloco: blocoDaFase(thread, thread.faseAtual).bloco,
            pausaSobre: '',
            detalhe: vaga.detalhe,
            evidencia: 'ork board plan (concurrency.stale_after_min)',
            correcao: vaga.correcao,
            desdeEm: thread.atualizadaEm,
            sessaoViva: null,
            fonte: 'escalonador',
          },
          quando
        )
      );
    }
    if (vaga && vaga.motivo === 'concurrency.limite') {
      impedimentos.push(
        parada(
          {
            natureza: 'impedimento',
            motivo: 'concurrency.limite',
            fase: thread.faseAtual,
            bloco: blocoDaFase(thread, thread.faseAtual).bloco,
            pausaSobre: '',
            detalhe: vaga.detalhe,
            evidencia: 'ork board plan (concurrency.max_parallel_threads)',
            correcao: vaga.correcao,
            desdeEm: thread.atualizadaEm,
            sessaoViva: null,
            fonte: 'escalonador',
          },
          quando
        )
      );
    }

    const paradas = [...pausas, ...impedimentos].sort((a, b) => a.desdeEm.localeCompare(b.desdeEm));
    const ultimo = eventos.length > 0 ? eventos[eventos.length - 1] : null;
    const precisaDeHumano = pausas.some((p) => p.sessaoViva !== true);
    const paradaHaMin = paradas.length > 0 ? Math.max(...paradas.map((p) => p.paradaHaMin)) : null;

    linhas.push({
      perfil: item.perfil,
      thread: thread.id,
      slug: thread.slug,
      nome: thread.nome,
      modo: thread.modo,
      tag: tagDoModo(thread.modo),
      faseAtual: thread.faseAtual,
      status: thread.status,
      situacao: situacaoDaLinha(item, vaga, precisaDeHumano, impedimentos.length > 0),
      pausas,
      impedimentos,
      paradas,
      ultimoEvento: ultimo
        ? { tipo: ultimo.tipo, ts: ultimo.ts, fase: typeof ultimo.fase === 'string' ? ultimo.fase : null }
        : null,
      paradaHaMin,
      precisaDeHumano,
      temImpedimento: impedimentos.length > 0,
      acimaDoLimite: paradaHaMin !== null && paradaHaMin >= atencaoMin,
      conducao: conducaoDaThread(item.raiz, thread.id),
    });
  }

  // Ordem da tabela: quem espera humano primeiro, depois quem tem impedimento, e dentro
  // de cada grupo a parada mais VELHA no topo. E a ordem em que o humano deve atacar.
  linhas.sort((a, b) => {
    const peso = (l: LinhaDoMonitor) => (l.precisaDeHumano ? 0 : l.temImpedimento ? 1 : 2);
    if (peso(a) !== peso(b)) return peso(a) - peso(b);
    if ((b.paradaHaMin ?? -1) !== (a.paradaHaMin ?? -1)) {
      return (b.paradaHaMin ?? -1) - (a.paradaHaMin ?? -1);
    }
    return a.thread.localeCompare(b.thread);
  });

  const visiveis = opcoes.soParadas === true
    ? linhas.filter((l) => l.precisaDeHumano || l.temImpedimento)
    : linhas;

  const perfis = (todos ? perfisDetectados(carregado) : perfisDetectados(carregado).slice(0, 1)).map(
    (p) => p.nome
  );

  return {
    projeto: carregado.manifesto.project.name,
    consultadoEm: quando,
    atencaoMin,
    runtimeConsultado: estados !== null,
    runtimeDetalhe,
    perfis,
    linhas: visiveis,
    resumo: {
      threads: linhas.length,
      aguardandoHumano: linhas.filter((l) => l.precisaDeHumano).length,
      comImpedimento: linhas.filter((l) => l.temImpedimento).length,
      emAndamento: linhas.filter((l) => l.situacao === 'em-andamento').length,
      podemAvancar: linhas.filter((l) => l.situacao === 'pode-avancar').length,
      fechadas: linhas.filter((l) => l.situacao === 'fechada').length,
      acimaDoLimite: linhas.filter((l) => l.acimaDoLimite).length,
    },
  };
}

/**
 * Uma parada em uma linha, para os blocos de detalhe abaixo da tabela. I-35: o dado guarda
 * ISO (o `--json` e o ledger nao mudam); aqui o horario sai no fuso do dono.
 */
function linhaDaParada(p: ParadaDaThread, agora: string): string[] {
  const local = (texto: string) => localizarTexto(texto, { agora });
  const L: string[] = [];
  L.push(
    `      [${p.motivo}] parada ha ${duracaoRelativa(p.paradaHaMin)} (desde ${formatarHora(p.desdeEm, { agora })})`
  );
  if (p.pausaSobre) L.push(`      o humano decide: ${p.pausaSobre}`);
  L.push(`      detalhe  : ${local(p.detalhe)}`);
  L.push(`      evidencia: ${local(p.evidencia)}`);
  L.push(`      correcao : ${local(p.correcao)}`);
  return L;
}

/** Texto de `ork orquestracao status`. */
export function textoDoMonitor(m: MonitorDeOrquestracao): string {
  const L: string[] = [];
  L.push(
    `Monitor de orquestracao, projeto ${m.projeto} ` +
      `(${m.resumo.threads} thread(s) em ${m.perfis.length} perfil(is): ${m.perfis.join(', ')})`
  );
  L.push(
    `  aguardando humano: ${m.resumo.aguardandoHumano} | com impedimento: ${m.resumo.comImpedimento} | ` +
      `em andamento: ${m.resumo.emAndamento} | podem avancar: ${m.resumo.podemAvancar} | ` +
      `fechadas: ${m.resumo.fechadas}`
  );
  L.push(
    `  limite de atencao: ${m.atencaoMin} min (${m.resumo.acimaDoLimite} parada(s) acima, marcadas com !)`
  );
  L.push(`  ${legendaDoFuso(undefined, m.consultadoEm)}`);
  if (!m.runtimeConsultado) {
    L.push(`  [warn] ${m.runtimeDetalhe}: pausa prevista e reportada como valendo`);
  }
  L.push('');

  // I-36 (T17): conducao em andamento nao e parada; ela aparece antes, com a linha unica.
  const conduzidas = m.linhas.filter((l) => l.conducao);
  if (conduzidas.length > 0) {
    L.push('Conduzidas agora:');
    for (const l of conduzidas) L.push(`  ${l.thread}: ${linhaDeConducao(l.conducao!, { agora: m.consultadoEm })}`);
    L.push('');
  }

  if (m.linhas.length === 0) {
    L.push('  Nenhuma thread parada: ninguem esperando veredito humano nem impedido.');
    return L.join('\n');
  }

  L.push(
    tabela(
      [
        'PERFIL',
        'THREAD',
        'FASE',
        'STATUS',
        'BLOCO QUE PAUSA',
        'AGUARDA DO HUMANO',
        'IMPEDIMENTO',
        'ULTIMO EVENTO',
        'PARADA HA',
      ],
      m.linhas.map((l) => [
        l.perfil,
        l.thread,
        l.faseAtual,
        l.situacao,
        l.pausas.map((p) => p.bloco || '?').join(' ') || '-',
        l.pausas.map((p) => p.pausaSobre).filter((s) => s !== '').join('; ') || '-',
        l.impedimentos.map((p) => p.motivo).join(' ') || 'nao',
        l.ultimoEvento ? l.ultimoEvento.tipo : '(sem ledger)',
        l.paradaHaMin === null
          ? '-'
          : `${duracaoRelativa(l.paradaHaMin)}${l.acimaDoLimite ? ' !' : ''}`,
      ])
    )
  );

  const hitl = m.linhas.filter((l) => l.precisaDeHumano);
  if (hitl.length > 0) {
    L.push('');
    L.push('Esperando VEREDITO HUMANO agora (o orquestrador deve avisar o humano):');
    for (const l of hitl) {
      L.push(`  ${l.thread} (${l.tag}, ${l.nome})`);
      for (const p of l.pausas.filter((x) => x.sessaoViva !== true)) L.push(...linhaDaParada(p, m.consultadoEm));
    }
  }

  const impedidas = m.linhas.filter((l) => l.temImpedimento);
  if (impedidas.length > 0) {
    L.push('');
    L.push('Com IMPEDIMENTO (nao e veredito humano: e colisao, gate, limite ou janela):');
    for (const l of impedidas) {
      L.push(`  ${l.thread} (${l.tag}, ${l.nome})`);
      for (const p of l.impedimentos) L.push(...linhaDaParada(p, m.consultadoEm));
    }
  }

  const emCurso = m.linhas.filter((l) => l.pausas.some((p) => p.sessaoViva === true));
  if (emCurso.length > 0) {
    L.push('');
    L.push('Pausa PREVISTA, sessao ainda viva (nao avise ainda, mas ja e a proxima fila):');
    for (const l of emCurso) {
      for (const p of l.pausas.filter((x) => x.sessaoViva === true)) {
        L.push(`  ${l.thread}: ${p.bloco || '?'} vai pausar sobre "${p.pausaSobre}"`);
      }
    }
  }

  if (m.resumo.aguardandoHumano === 0 && m.resumo.comImpedimento === 0) {
    L.push('');
    L.push('  Nenhuma thread parada: ninguem esperando veredito humano nem impedido.');
  }
  return L.join('\n');
}

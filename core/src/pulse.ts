import { exigirEscopoDeEscrita } from './escopo-escrita';
/** D4: uma fila para quem precisa de humano, com fontes e espera observada. */
import { consultarSessoes, ConsultaDeSessoes } from './adapters/claude-bg';
import { estadoBruto, redigirSegredos, varrerSessoes } from './hitl';
import type { FilaDoDono } from './roadmap-status';
import { detectarFasesOrfas, FaseOrfa, FontesDeVida } from './liveness';
import { ManifestoCarregado } from './manifest';
import { pendentesDeScore, PendenteDeScore, ORDEM_DAS_CLASSES } from './master';
import { assinaturaProposta } from './master-batch';
import { montarMonitor } from './orquestracao';
import { pedidoCurtoDoImpedimento } from './impedimento';
import { pedidoCurtoDaEscada } from './runtime-escada';
import { autorizada, LeituraDaAutorizacao, lerAutorizacao } from './autorizacao-duravel';
import { AcaoPendente, acoesFeitasDesde, acoesPendentes } from './varredura-acoes';
import { pendentesDaUltimaBatida } from './conducao-batida';
import type { FantasmaTratado } from './sessoes';
import { maquinaOciosa, MaquinaOciosa } from './maquina-ociosa';
import { dirThread, lerThread } from './thread';
import { ehRegistroDeAdocao } from './sessoes-adopt';
import type { RodarCli } from './forja/api';
import type { SondasDaForja } from './forja/resolver';
import { lerLedger } from './ledger';
import { FASES, MonitorDeOrquestracao, RadarDeSessoes, Thread, EventoLedger } from './types';
import { agora, noPath } from './util';
import { formatarDataHoraRotulada, localizarTexto } from './horario';
import { msg, remontar, textoDoCatalogo } from './locale';
import { apresentarHitl, ApresentacaoHitl, ofertaDoPedido, pedidoHitlAberto } from './hitl-presentation';
import { alvoDoPedido, chaveDaEscolha, ehV2, escolhasDoPedido, PedidoHitlQualquer,
  recomendacaoDoPedido, textoDoPedido } from './hitl-contract';
import { entradaDoPedido, montarPedidoCurto, textoDoPedidoCurto } from './hitl-curto';
import { CanalOferecido } from './hitl-canais';
import { DecisaoParaODono, decisoesParaODono, FaseAcimaDoLimiar } from './decisao-autonoma';
import { mergeDaThread, resolverBase } from './docs';
import { liberarSeOrfa } from './conducao';
import { linhaDeConducao } from './conducao-texto';
import { linhaDoParadoNoCondutor } from './hitl-resumo';
import { HitlDeConducaoAgora, linhaDaPerguntaParada, lerHitlDeConducaoAgora, textoDaMediana } from './hitl-tempo-parado';
import { avisarForjaSemLeitura, EntregasDoProjeto, entregasDoProjeto, esquecerForjaSemLeitura, ExecutorDoGh, gravarRetratoDePrs,
  LeituraDePrs, lerPrsDaForja, ParadoNoCondutor, sessaoSemPergunta } from './parado-no-condutor';

export const CONTRATO_PULSE = 'ork.pulse/v1';
export interface ItemPulse {
  id: string; classe: string; motivo: string; thread: string | null; fase: string | null;
  sessionId: string | null; desdeEm: string | null; paradaHaMin: number | null; impacto: number;
  pergunta: string; opcoes: string[]; recomendacao: string; comandoResposta: string;
  evidencia: string[]; fontes: string[]; contextoLogs: string[];
  /** I-41: as duas versoes do contrato. O item do pulse nao escolhe qual delas o nucleo emitiu. */
  pedido?: PedidoHitlQualquer; apresentacao?: ApresentacaoHitl;
  /** FX6: por quais canais homologados da para responder este pedido agora, e por que nao. */
  canais?: readonly CanalOferecido[];
  /** RM-048 (D1): o pedido no contrato curto, pronto para o canal. So pergunta v2 de gate com codigo. */
  apresentacaoCurta?: { telegram: string; terminal: string };
  /**
   * RM-055 (continuacao, D3): o impedimento do despacho que so o dono resolve, tipado: o comando que ele roda
   * no terminal e o retry que devolve a fase ao runtime. E o que o resumo entregue leva ao dono.
   */
  impedimento?: { motivo: string; comando: string; retry: string };
}
export interface Pulse {
  contrato: typeof CONTRATO_PULSE; consultadoEm: string;
  runtime: { ok: boolean; detalhe: string };
  precisaDeHumanoAgora: ItemPulse[]; acoesAutomaticas: ItemPulse[];
  resumo: { humanos: number; automaticas: number; scores: number; fasesOrfas: number };
  /**
   * I-41 (GO-FIX 1, B4): as decisoes que a fabrica tomou sem perguntar, na janela do pulse. Elas
   * NAO estao em `precisaDeHumanoAgora`: nao seguram fase e nao pedem resposta. Viajam no resumo
   * para o dono saber e poder ajustar. Campo aditivo: pulse de antes continua valido sem ele.
   */
  decisoes?: DecisaoParaODono[];
  /** As fases que passaram do limiar de revisao de decisoes autonomas (13 por fase, M7). */
  acimaDoLimiar?: FaseAcimaDoLimiar[];
  /** I-36 (T17): as threads conduzidas agora, com a linha unica. Conducao nao e parada nem pergunta. */
  conducoes?: { thread: string; linha: string }[];
  /**
   * RM-037 (fatia 4): o trabalho parado no condutor depois da entrega, uma linha por thread. Nao e
   * pergunta ao dono nem conta em "Esperando voce". Campo aditivo: pulse de antes continua valido sem ele.
   */
  paradoNoCondutor?: ParadoNoCondutor[];
  /**
   * RM-057 (fatia 3): o tempo parado por HITL de conducao, as perguntas abertas agora e a mediana dos
   * ultimos 7 dias, na forma do `hitlDeConducao` do `ork ledger stats`. Campo aditivo: so sai quando
   * ha pergunta aberta ou resposta medida na semana, e pulse de antes continua valido sem ele.
   */
  hitlDeConducao?: HitlDeConducaoAgora;
  /**
   * RM-063 (F5): a varredura que age. A autorizacao duravel desta maquina, as acoes que a varredura faria agora (cada
   * uma com quem a faz: ela, pela autorizacao, ou o dono, com o comando pronto) e as que ela fez nos ultimos 7 dias.
   * Campo aditivo: so sai com acao pendente ou feita, ou com uma autorizacao gravada.
   */
  varredura?: VarreduraDoPulse;
  /**
   * RM-063 (F6): a maquina esta ociosa: vaga livre no projeto e item do roadmap reservado para ela sem ninguem
   * trabalhando, com as proximas threads sugeridas. Campo aditivo: so sai quando ela esta ociosa.
   */
  maquinaOciosa?: MaquinaOciosa;
}

/** RM-063 (F5): a varredura que age, como o pulse a mostra. */
export interface VarreduraDoPulse {
  autorizacao: { estado: 'valida' | 'ausente' | 'invalida'; motivo: string | null; detalhe: string | null;
    por: string | null; ate: string | null; pode: string[] };
  pendentes: (AcaoPendente & { quemFaz: 'varredura' | 'dono' })[];
  feitas: { acao: string; thread: string; detalhe: string; em: string; eventId: string }[];
}

/** Uma semana: o resumo cita a decisao uma vez, e ela continua lida ate sair da janela. */
export const JANELA_DAS_DECISOES_MS = 7 * 24 * 60 * 60 * 1000;
const impacto = (fase: string | null): number => FASES.indexOf(fase as typeof FASES[number]) + 1;
const ordenar = (a: ItemPulse,b: ItemPulse): number =>
  (b.paradaHaMin ?? -1)-(a.paradaHaMin ?? -1) || b.impacto-a.impacto || a.id.localeCompare(b.id);
const minutos = (desde: string | null, quando: string): number | null =>
  desde && Number.isFinite(Date.parse(desde)) ? Math.max(0,Math.floor((Date.parse(quando)-Date.parse(desde))/60000)) : null;

/**
 * RM-048 (D1 e D4): o texto curto de uma pergunta v2 de gate e a linha com o codigo estavel.
 * Pedido sem codigo (v1, sessao) continua com o comando de antes: nada e inventado para ele.
 */
export function apresentacaoCurtaDoItem(pedido: PedidoHitlQualquer, desde: string | null, quando: string):
  { textos: { telegram: string; terminal: string }; comando: string } | undefined {
  if (!ehV2(pedido) || pedido.classe !== 'pergunta' || pedido.alvo.tipo !== 'gate') return undefined;
  const curto = montarPedidoCurto(entradaDoPedido(pedido, desde ?? pedido.criadoEm),
    { quando, responder: { tipo: 'codigo', codigo: pedido.codigo } });
  const recomendada = pedido.alternativas.find(a => a.recomendada)?.letra ?? 'a';
  return { textos: { telegram: textoDoPedidoCurto(curto, 'telegram'), terminal: textoDoPedidoCurto(curto, 'terminal') },
    comando: `${pedido.codigo} ${recomendada}` };
}

export function comporPulse(carregado: ManifestoCarregado, entrada: {
  radar: RadarDeSessoes; monitor: MonitorDeOrquestracao; batch: PendenteDeScore[]; orfas: FaseOrfa[];
  /** RM-037 (fatia 4): o estado das entregas ja lido (com a forja); sem ele, so o git local e o ledger. */
  entregas?: EntregasDoProjeto;
  /** RM-063 (F5): as acoes da varredura que age, ja lidas; cada uma vira item da fila do dono ou acao automatica. */
  varredura?: VarreduraDoPulse;
}): Pulse {
  const {radar,monitor,batch,orfas}=entrada, quando=radar.consultadoEm;
  const humanos: ItemPulse[]=[], automaticas: ItemPulse[]=[];
  // RM-037 (fatia 4): o fim de turno sem pergunta e do condutor. Ele sai da fila do dono aqui e volta
  // como linha propria (`paradoNoCondutor`); leitura que falha nao esconde nada do dono.
  let entregas: EntregasDoProjeto | undefined = entrada.entregas;
  if (!entregas) {
    try { entregas = entregasDoProjeto(carregado, { quando, sessoes: radar.sessoes }); } catch { entregas = undefined; }
  }
  const registros = new Map<string, boolean>();
  const ehRegistro = (id: string | null): boolean => {
    if (!id) return false;
    if (!registros.has(id)) {
      try { registros.set(id, ehRegistroDeAdocao(lerThread(carregado.raiz, id))); }
      catch { registros.set(id, false); } // Não esconder atenção sem confirmar proveniência.
    }
    return registros.get(id)!;
  };
  // I-45: so pede o dono quem pode receber resposta. Em 24/09/2026 a fila tinha 92 itens e 2 eram
  // do dono: o resto era sessao morta, de thread fechada ou sem thread, que ninguem pode responder.
  const statusDaThread = new Map<string, string | null>();
  const threadAberta = (id: string | null): boolean => {
    if (!id) return false;
    if (!statusDaThread.has(id)) {
      try { statusDaThread.set(id, lerThread(carregado.raiz, id).status); }
      catch { statusDaThread.set(id, null); } // Thread ilegivel nao prova fechamento: fica visivel.
    }
    return statusDaThread.get(id) !== 'fechada';
  };
  const TERMINAIS = ['failed', 'done', 'stopped', 'completed'];
  for (const s of radar.sessoes.filter(s=>s.precisaDeHumano)) {
    // RM-037 (fatia 4): sessao `blocked` de quem o turno acabou sem pergunta e do condutor: a que o ledger provou
    // (Stop sem atividade depois; a lista numerada da mensagem final nao e menu) e a sobra sem menu na tela.
    if (entregas?.doCondutor.sessoes.has(s.sessionId) &&
        (sessaoSemPergunta(s) || entregas.doCondutor.turnosEncerrados.has(s.sessionId))) continue;
    // Job morto ou estado terminal é história. Bloqueio vivo ou desconhecido continua visível.
    if (ehRegistro(s.thread?.id ?? null) && s.jobVivo !== true &&
        (s.jobVivo === false || TERMINAIS.includes(s.estadoBruto))) continue;
    const semThread = !s.thread?.id, aberta = threadAberta(s.thread?.id ?? null);
    const encerrada = s.jobVivo !== true && (s.jobVivo === false || TERMINAIS.includes(s.estadoBruto));
    // Morta ou terminal, sem thread ou de thread fechada: historia, ninguem para responder.
    if (encerrada && !aberta) continue;
    // Incerta de thread fechada tambem e historia. Incerta SEM thread continua visivel: pode ser
    // uma sessao do proprio dono esperando resposta (o alerta I-01, fixado no fx-hitl-latency).
    if (s.jobVivo !== true && !encerrada && !aberta && !semThread) continue;
    // Thread aberta com sessao morta ou terminal: quem resolve e o retry de orfas, nao o dono.
    const destino = encerrada ? automaticas : humanos;
    destino.push({id:`sessao:${s.sessionId || s.id}`,classe:s.classe,motivo:s.tipoDeHitl??s.classe,
      thread:s.thread?.id??null,fase:s.thread?.fase??null,sessionId:s.sessionId,
      desdeEm:s.bloqueadaDesdeEm??null,paradaHaMin:s.paradaHaMin??null,impacto:impacto(s.thread?.fase??null),
      pergunta:s.pergunta||s.detalhe,opcoes:s.alternativas,recomendacao:s.recomendacao,
      comandoResposta:s.classe==='abandonada'?s.comandos.logs:s.comandos.attach,
      evidencia:[`claude agents: state=${s.estadoBruto}`,s.comandos.logs],fontes:['sessions hitl'],contextoLogs:s.contextoLogs??[]});
  }
  // I-45: verificacao reprovada de uma candidata cujo codigo ja esta na base nao e pendencia do
  // dono: o CHECK independente decidiu e o merge aconteceu. Vale o primeiro merge (regra do `ork docs`).
  const base = resolverBase(carregado.raiz, carregado.manifesto.worktree?.base_branch ?? 'main');
  const mesclada = new Map<string, boolean>();
  const jaMesclada = (thread: string): boolean => {
    if (!base) return false;
    if (!mesclada.has(thread)) {
      try { mesclada.set(thread, mergeDaThread(carregado.raiz, thread, base) !== null); }
      catch { mesclada.set(thread, false); }
    }
    return mesclada.get(thread)!;
  };
  const VERIFICACAO = ['claims.failed', 'claims.unverifiable', 'verify.failed', 'verify.regression', 'verify.timeout', 'verify.sem-veredito', 'ci.failed'];
  for (const l of monitor.linhas) for (const p of l.paradas) {
    if (VERIFICACAO.includes(p.motivo) && jaMesclada(l.thread)) continue;
    // RM-037 (fatia 4): o `human.pending` que o observador grava no fim de turno sem pergunta nao e do dono.
    if (p.motivo === 'human.pending' && p.fonte === 'ledger' && entregas?.doCondutor.gates.has(`${l.thread}|${p.fase}`)) continue;
    if (ehRegistro(l.thread)) {
      if (p.fonte === 'escalonador' || ['lease.busy', 'conducao.em-andamento', 'concurrency.limite', 'vaga.stale',
        'runtime.silencio', 'concurrency.lease-indeterminado', 'conducao.acao-necessaria'].includes(p.motivo)) continue;
      const sessoes = radar.sessoes.filter(s => s.thread?.id === l.thread && s.thread.fase === p.fase);
      // Escalada explícita de ledger não é apagada pela conclusão de uma sessão.
      if (p.fonte !== 'ledger' && sessoes.length > 0 && sessoes.every(s => s.jobVivo !== true &&
          (s.jobVivo === false || ['failed', 'done', 'stopped', 'completed'].includes(s.estadoBruto)))) continue;
    }
    if (p.sessaoViva===true) continue;
    if (orfas.some(o=>o.thread===l.thread && o.fase===p.fase) &&
        ['runtime.silencio','vaga.stale'].includes(p.motivo)) continue;
    const mesmaEspera=humanos.find(s=>s.thread===l.thread && s.fase===p.fase &&
      p.sessaoEstado==='blocked' && !!s.sessionId && p.evidencia.includes(s.sessionId.slice(0,8)));
    if(mesmaEspera) {mesmaEspera.fontes.push('monitor');mesmaEspera.evidencia.push(p.evidencia);continue;}
    const item: ItemPulse={id:`thread:${l.thread}:${p.fase}:${p.motivo}:${p.fonte}`,classe:'thread',motivo:p.motivo,
      thread:l.thread,fase:p.fase,sessionId:null,desdeEm:p.desdeEm,paradaHaMin:p.paradaHaMin,impacto:impacto(p.fase),
      pergunta:p.detalhe,opcoes:[],recomendacao:p.correcao,comandoResposta:p.correcao,evidencia:[p.evidencia],
      fontes:['monitor'],contextoLogs:[]};
    // RM-055: o impedimento do despacho sai no contrato curto, com o comando exato e o re-despacho depois.
    if (p.impedimento) {
      item.impedimento = { motivo: p.motivo, comando: p.impedimento.comando, retry: `ork retry run ${l.thread}` };
      try {
        const curto = pedidoCurtoDoImpedimento({ thread: l.thread, fase: p.fase, motivo: p.motivo, detalhe: p.detalhe,
          desdeEm: p.desdeEm, impedimento: p.impedimento }, quando);
        item.apresentacaoCurta = { telegram: textoDoPedidoCurto(curto, 'telegram'), terminal: textoDoPedidoCurto(curto, 'terminal') };
        item.opcoes = curto.alternativas.map(a => textoDoCatalogo((m) => `${a.chave}. ${m.pulse.alternativaDoImpedimento(a.texto)}`));
        item.comandoResposta = item.impedimento.retry;
      } catch { item.evidencia.push('Pedido curto do impedimento indisponível; a correção acima vale.'); }
    }
    // RM-063 (F4): a escada de recuperacao do runtime que acabou sai como o impedimento, com o comando que confere o
    // runtime, o que retoma a fase com o mesmo prompt e o pedido curto com as tres alternativas (RM-057).
    if (p.escada) {
      item.impedimento = { motivo: p.motivo, comando: p.escada.conferir, retry: p.escada.retomar };
      item.comandoResposta = p.escada.retomar;
      try {
        const curto = pedidoCurtoDaEscada({ thread: l.thread, fase: p.fase, desdeEm: p.desdeEm, escada: p.escada }, quando);
        item.apresentacaoCurta = { telegram: textoDoPedidoCurto(curto, 'telegram'), terminal: textoDoPedidoCurto(curto, 'terminal') };
        item.opcoes = curto.alternativas.map(a => textoDoCatalogo((m) => `${a.chave}. ${m.pulse.alternativaDoImpedimento(a.texto)}`));
        const recomendada = curto.alternativas.find(a => a.recomendada);
        if (recomendada) item.recomendacao = `${recomendada.chave}. ${recomendada.texto}: ${recomendada.recomendada!.porque}`;
      } catch { item.evidencia.push('Pedido curto da escada indisponível; a correção acima vale.'); }
    }
    // I-45: vaga parada e sinal do escalonador (`ork board reap` devolve a vaga), nao pergunta ao dono.
    const esperaAutomatica=['lease.busy','conducao.em-andamento','concurrency.limite','runtime.rate-limited','vaga.stale',
      'concurrency.lease-indeterminado','conducao.acao-necessaria'].includes(p.motivo);
    (esperaAutomatica?automaticas:humanos).push(item);
  }
  // RM-063 (F5): o MASTER por omissao da varredura nao vira item do dono (I-45: a entrega sem nota fica na faixa
  // automatica). Ele completa o item da entrega com o comando desta thread so (RM-008) e com quem o faz agora.
  const v = entrada.varredura;
  const recomendacaoDaVarredura = (a: VarreduraDoPulse['pendentes'][number]): string =>
    a.quemFaz === 'varredura' && v!.autorizacao.por && v!.autorizacao.ate
      ? textoDoCatalogo((m) => m.pulse.varredura.daVarredura(v!.autorizacao.por!,
        formatarDataHoraRotulada(v!.autorizacao.ate!, { agora: quando })))
      : a.bloqueio ? textoDoCatalogo((m) => m.pulse.varredura.comBloqueioRecomendacao(a.thread, a.comando))
        : textoDoCatalogo((m) => m.pulse.varredura.doDono(a.acao));
  const masterDaVarredura = new Map((v?.pendentes ?? []).filter(a => a.acao === 'master').map(a => [a.thread, a] as const));
  for(const b of batch) {
    const eventos=lerLedger(dirThread(carregado.raiz,b.thread.id));
    const desde=eventos.filter(e=>e.tipo==='ship_done').at(-1)?.ts ??
      eventos.filter(e=>e.tipo==='phase_result'&&e.fase==='MASTER').at(-1)?.ts ?? b.thread.atualizadaEm;
    const proposta = b.thread.score_proposto;
    const respostas = proposta && b.entregou ? ORDEM_DAS_CLASSES.map(c => `ratificar ${b.thread.id} ${assinaturaProposta(proposta)} ${c}`) : [];
    // I-45: a fila de nota foi aposentada na I-43. A entrega sem nota e aceita por padrao, com
    // registro; ela sai da atencao do dono e fica na faixa automatica. A nota humana, quando vier,
    // continua sobrescrevendo, e as respostas de ratificacao seguem no item.
    automaticas.push({id:`score:${b.thread.id}`,classe:'score_pendente',motivo:'master.score-pendente',thread:b.thread.id,
      fase:'MASTER',sessionId:null,desdeEm:desde,paradaHaMin:minutos(desde,quando),impacto:impacto('MASTER'),
      pergunta: proposta ? `Proposta para ${b.thread.nome}: ${proposta.valor}/5. ${proposta.justificativa}` : `Entrega ${b.thread.nome} sem nota: aceita por padrão, com registro.`,
      opcoes: respostas.length ? respostas : ['0','1','2','3','4','5'],
      recomendacao:'Aceitar por padrão com registro; a nota humana, quando vier, sobrescreve.',
      comandoResposta:'ork master --aceitar-omissao',
      evidencia:[`ork master; regime ${b.regime}`],fontes:['master'],contextoLogs:[]});
    const daVarredura = masterDaVarredura.get(b.thread.id);
    if (daVarredura) {
      const item = automaticas[automaticas.length - 1];
      item.comandoResposta = comandoDaAcaoDaVarredura(daVarredura);
      item.recomendacao = recomendacaoDaVarredura(daVarredura);
      if (daVarredura.bloqueio || daVarredura.recusa) item.pergunta = `${item.pergunta} ${textoDaAcaoDaVarredura(daVarredura)}`;
      item.evidencia.push(daVarredura.evidencia);
      if (!item.fontes.includes('varredura')) item.fontes.push('varredura');
      masterDaVarredura.delete(b.thread.id);
    }
  }
  for(const o of orfas) {
    if (ehRegistro(o.thread)) continue;
    const item: ItemPulse={id:`orfa:${o.thread}:${o.fase}:${o.sessionId}`,classe:o.classe,motivo:o.motivo,
      thread:o.thread,fase:o.fase,sessionId:o.sessionId,desdeEm:o.desdeEm,paradaHaMin:minutos(o.desdeEm,quando),
      impacto:impacto(o.fase),pergunta:textoDoCatalogo((m) => m.pulse.semHeartbeat(o.fase, o.ultimoHeartbeatEm)),
      opcoes:[],recomendacao:o.retry.razao,
      comandoResposta:o.retry.automatica?`ork retry run ${o.thread} --motivo runtime.silencio --fase ${o.fase}`:
        `ork retry plan ${o.thread} --motivo runtime.silencio --fase ${o.fase}`,
      evidencia:[...o.evidencia,`retry ${o.retry.tentativas}/${o.retry.limite}`],fontes:['liveness'],contextoLogs:[]};
    (o.retry.automatica?automaticas:humanos).push(item);
  }
  // RM-063 (F5): cada acao da varredura e um item. Sem a autorizacao do dono para ela (ou com bloqueio, ou com a tentativa
  // recusada), e do dono, com o comando pronto; autorizada, e acao automatica da proxima batida. O MASTER ja foi no item
  // da entrega sem nota; so o que sobrou dele (sem item de entrega) entra aqui, na faixa automatica.
  for (const a of v?.pendentes ?? []) {
    if (a.acao === 'master' && !masterDaVarredura.has(a.thread)) continue;
    const daVarredura = a.quemFaz === 'varredura' || a.acao === 'master';
    const item: ItemPulse = { id: `varredura:${a.acao}:${a.thread}${a.sessionId ? `:${a.sessionId.slice(0, 8)}` : ''}`,
      classe: 'varredura', motivo: `varredura.${a.acao}`, thread: a.thread, fase: a.fase, sessionId: null, desdeEm: a.desdeEm,
      paradaHaMin: minutos(a.desdeEm, quando), impacto: impacto(a.fase), pergunta: textoDaAcaoDaVarredura(a), opcoes: [],
      recomendacao: recomendacaoDaVarredura(a), comandoResposta: comandoDaAcaoDaVarredura(a), evidencia: [a.evidencia],
      fontes: ['varredura'], contextoLogs: [] };
    (daVarredura ? automaticas : humanos).push(item);
  }
  const unicos=(items:ItemPulse[])=>[...new Map(items.map(i=>[i.id,i])).values()].sort(ordenar);
  const h=unicos(humanos),a=unicos(automaticas);
  for (const item of h) {
    if (!item.thread || item.classe === 'score_pendente') continue;
    try {
      // T6: o pedido vem primeiro, porque e ele quem diz quanta evidencia esta pergunta merece.
      // Sem pedido aberto, `apresentarHitl` cai no default do modo, como sempre fez.
      const pedido = pedidoHitlAberto(carregado.raiz, item.thread, item.fase, item.sessionId);
      item.apresentacao = apresentarHitl(carregado.raiz, item.thread, pedido?.profundidade);
      if (pedido) {
        // I-41 (T4b): o pulse le o pedido pelos leitores uniformes, e o que muda para o dono e a
        // CHAVE que ele digita: numero no v1, letra no v2. `pedidoHitlAberto` ja descartou
        // `decidido`, que nao tem alvo; e por isso que existe alvo para ler aqui.
        item.pedido = pedido; item.pergunta = textoDoPedido(pedido);
        item.opcoes = escolhasDoPedido(pedido).map(o => `${chaveDaEscolha(pedido, o.numero)}. ${o.texto}`);
        item.recomendacao = recomendacaoDoPedido(pedido);
        item.comandoResposta = `/ork ${alvoDoPedido(pedido)?.tipo === 'session' ? 'session' : 'gate'} ${pedido.thread} ${pedido.id} <resposta>`;
        // RM-048 (D1 e D4): a pergunta v2 de gate sai pelo contrato curto, e a linha que o dono
        // recebe e o codigo estavel ("DE6H a"), nao o identificador que muda a cada renovacao.
        const curta = apresentacaoCurtaDoItem(pedido, item.desdeEm, quando);
        if (curta) { item.apresentacaoCurta = curta.textos; item.comandoResposta = curta.comando; }
        // O Pulse nao e uma conexao MCP: nenhum canal mcp-local sai `disponivel` daqui.
        item.canais = ofertaDoPedido(pedido);
      }
    } catch { item.evidencia.push('Apresentação indisponível; conferir estado canônico da thread.'); }
  }
  return {contrato:CONTRATO_PULSE,consultadoEm:quando,runtime:{ok:radar.runtimeConsultado,detalhe:radar.runtimeDetalhe},
    precisaDeHumanoAgora:h,acoesAutomaticas:a,resumo:{humanos:h.length,automaticas:a.length,scores:batch.length,fasesOrfas:orfas.length},
    ...(entregas?.parados.length ? { paradoNoCondutor: entregas.parados } : {}),
    ...(v && (v.pendentes.length || v.feitas.length || v.autorizacao.estado !== 'ausente') ? { varredura: v } : {})};
}

/** RM-063 (F5): com bloqueio, o comando do dono e olhar a thread: a acao iria por cima do trabalho que esta nela. */
export function comandoDaAcaoDaVarredura(a: AcaoPendente): string {
  return a.bloqueio ? `ork thread status ${a.thread}` : a.comando;
}

/** RM-063 (F5): o que a acao faz, com o motivo da ultima recusa ou do bloqueio quando ha. */
export function textoDaAcaoDaVarredura(a: AcaoPendente): string {
  return a.recusa ? textoDoCatalogo((m) => m.pulse.varredura.comRecusa(a.oQue, a.recusa!.detalhe))
    : a.bloqueio ? textoDoCatalogo((m) => m.pulse.varredura.comBloqueio(a.oQue, a.bloqueio!)) : a.oQue;
}

/** RM-063 (F5): os estados em que a sessao da consulta ja nao trabalha na worktree. */
const TERMINAIS_DA_CONSULTA = ['failed', 'done', 'stopped', 'completed', 'exited'];

/** RM-063 (F5): a autorizacao e as acoes como o pulse as leva: cada acao com quem a faz agora. */
export function varreduraDoPulse(leitura: LeituraDaAutorizacao, pendentes: readonly AcaoPendente[],
  feitas: readonly { acao: string; thread: string; detalhe: string; em: string; eventId: string }[]): VarreduraDoPulse {
  const a = leitura.valida ? leitura.autorizacao : null;
  return {
    autorizacao: { estado: leitura.valida ? 'valida' : leitura.motivo === 'autorizacao.ausente' ? 'ausente' : 'invalida',
      motivo: leitura.valida ? null : leitura.motivo, detalhe: leitura.valida ? null : leitura.detalhe,
      por: a?.por ?? null, ate: a?.ate ?? null, pode: a ? [...a.pode] : [] },
    pendentes: pendentes.map((p) => ({ ...p, quemFaz: autorizada(leitura, p.acao) && !p.bloqueio && !p.recusa ? 'varredura' : 'dono' })),
    feitas: feitas.map((f) => ({ acao: f.acao, thread: f.thread, detalhe: f.detalhe, em: f.em, eventId: f.eventId })),
  };
}

export function montarPulse(carregado: ManifestoCarregado, opcoes: {
  fontes?: (thread: Thread, despacho: EventoLedger) => FontesDeVida;
  registrar?: boolean; escopo?: readonly string[]; quando?: string; linhasLogs?: number; semRuntime?: boolean; consulta?: ConsultaDeSessoes;
  /** RM-037 (fatia 4): quem roda o `gh` na leitura dos PRs; os testes trocam por resposta gravada. */
  executorDoGh?: ExecutorDoGh;
  /** Quem roda a CLI da API da forja (o `glab`, a sondagem); os testes trocam por uma CLI falsa. */
  rodarDaForja?: RodarCli;
  /** As sondas da resolucao da forja; os testes trocam. */
  sondasDaForja?: SondasDaForja;
  /**
   * RM-063 (F2): sem tocar a forja. A fila do dono nao depende dos PRs; quem so le a fila (o status do roadmap)
   * nao espera a rede nem grava o retrato dos PRs.
   */
  semForja?: boolean;
  /**
   * RM-063 (F5): as sessoes fantasmas que o `limpar` soltaria. Sem a opcao, o inventario de todas as contas (o mesmo do
   * `ork sessions limpar-fantasmas --dry-run`); com a consulta injetada ou sem o runtime, nenhuma (nada se afirma).
   */
  fantasmas?: () => FantasmaTratado[] | null;
} = {}): Pulse {
  if (opcoes.registrar) exigirEscopoDeEscrita(opcoes.escopo);
  const diagnosticos: string[] = [];
  const quando=opcoes.quando??agora();
  const consulta=opcoes.consulta??(opcoes.semRuntime
    ? {ok:false,sessoes:[],detalhe:textoDoCatalogo((m) => m.pulse.semRuntime)} : consultarSessoes(undefined,true));
  const estados=consulta.ok?new Map(consulta.sessoes.map(s=>[s.sessionId??'',estadoBruto(s)])):null;
  const radar=varrerSessoes({raiz:carregado.raiz,consulta,agora:quando,registrar:opcoes.registrar,escopo:opcoes.escopo,linhasLogs:opcoes.linhasLogs});
  const telasAdiadas = radar.telasAdiadas;
  if (telasAdiadas) diagnosticos.push(textoDoCatalogo((m) => m.pulse.telasAdiadas(telasAdiadas)));
  // Falha de observação não prova silêncio: Claude indisponível preserva sua guarda de HITL e Codex mantém sua coleta independente.
  const orfas=detectarFasesOrfas(carregado,{quando,registrar:opcoes.registrar,escopo:opcoes.escopo,diagnosticos,
    fontes:opcoes.fontes,estados:estados??undefined,runtimes:consulta.ok?undefined:['codex']});
  // I-36 (T16): conducao sem dono vivo sai aqui, com prova no ledger, so dentro do escopo de escrita.
  if (opcoes.registrar) for (const id of opcoes.escopo ?? []) {
    try { liberarSeOrfa(carregado.raiz, id); }
    catch (e) { diagnosticos.push(`conducao.recuperacao: ${id}: ${(e as Error).message.slice(0, 120)}`); }
  }
  const monitor=montarMonitor(carregado,{agora:quando,estados});
  // RM-037 (fatia 4, D2): a forja so e lida quando alguma thread tem branch publicada; a leitura boa vira o
  // retrato que o status do roadmap le sem rede. Falha de leitura e diagnostico, nunca "sem PR".
  let entregas: EntregasDoProjeto | undefined;
  try {
    entregas = entregasDoProjeto(carregado, { quando, sessoes: radar.sessoes, lerPrs: opcoes.semForja ? () => null : (candidatas): LeituraDePrs => {
      const leitura = lerPrsDaForja(carregado, { quando, executor: opcoes.executorDoGh, candidatas, rodar: opcoes.rodarDaForja,
        sondas: opcoes.sondasDaForja });
      if (leitura.ok) {
        try { gravarRetratoDePrs(carregado.raiz, leitura.retrato); } catch { /* o retrato e economia do status */ }
        try { esquecerForjaSemLeitura(carregado.raiz); } catch { /* sem a marca, a proxima perda de leitura e dita de novo */ }
      }
      return leitura;
    } });
    const leitura = entregas.prs;
    if (leitura && !leitura.ok && leitura.semLeitura) {
      // RM-037 (fatia 5, A5): a forja sem leitura de PR e dita uma vez por remoto e host; as batidas seguintes nao repetem.
      let novidade = true;
      try { novidade = avisarForjaSemLeitura(carregado.raiz, leitura.semLeitura, leitura.erro, quando); } catch { /* sem marca, diz de novo */ }
      if (novidade) diagnosticos.push(`prs.sem-leitura: ${leitura.erro.slice(0, 160)}`);
    } else if (leitura && !leitura.ok) diagnosticos.push(`prs.nao-lidos: ${leitura.erro.slice(0, 160)}`);
  } catch (e) { diagnosticos.push(`entregas.indisponiveis: ${(e as Error).message.slice(0, 120)}`); }
  // RM-063 (F5): o que a varredura faria sozinha, com a autorizacao duravel desta maquina. Leitura; falhar aqui nunca
  // derruba a fila de atencao.
  let varredura: VarreduraDoPulse | undefined;
  try {
    const leitura = lerAutorizacao(carregado.raiz, { projeto: carregado.manifesto.project.name, agora: new Date(quando) });
    // Com a consulta injetada (os testes) ou sem o runtime, as sessoes vem dela: sem a leitura, nada se afirma, e o
    // registro e o MASTER ficam com o dono (`sessoes-sem-leitura`).
    const injetada = opcoes.fantasmas || opcoes.consulta || opcoes.semRuntime;
    const consultada = consulta;
    const pendentes = acoesPendentes(carregado, { quando, ...(injetada ? {
      fantasmas: opcoes.fantasmas ?? (() => null),
      vivas: () => consultada.ok ? consultada.sessoes.filter((s) => typeof s.cwd === 'string' && !TERMINAIS_DA_CONSULTA.includes(estadoBruto(s)))
        .map((s) => ({ sessionId: s.sessionId, cwd: s.cwd as string })) : null,
    } : {}) });
    // RM-063 (F7): o merge e o despacho que a ultima batida da conducao deixou pendentes (check pendente, sem autorizacao,
    // conflito em codigo, PR em rascunho, fase sem prompt gravado), do retrato dela, enquanto ele vale.
    pendentes.push(...pendentesDaUltimaBatida(carregado.raiz, quando));
    const feitas = acoesFeitasDesde(carregado.raiz, new Date(Date.parse(quando) - JANELA_DAS_DECISOES_MS).toISOString());
    varredura = varreduraDoPulse(leitura, pendentes, feitas);
  } catch (e) { diagnosticos.push(`varredura.indisponivel: ${(e as Error).message.slice(0, 120)}`); }
  const pulse = comporPulse(carregado,{radar,monitor,orfas,batch:pendentesDeScore(carregado.raiz),...(entregas?{entregas}:{}),
    ...(varredura?{varredura}:{})});
  // RM-061 (F2b, G2): a linha de conducao e da familia `thread` e segue o locale ativo; o JSON a guarda em pt-BR.
  const conducoes = monitor.linhas.filter((l) => l.conducao)
    .map((l) => ({ thread: l.thread, linha: textoDoCatalogo(() => linhaDeConducao(l.conducao!, { agora: quando })) }));
  if (conducoes.length > 0) pulse.conducoes = conducoes;
  // B4: a metade que presta contas. Leitura pura; falhar aqui nunca derruba a fila de atencao.
  try {
    const { decisoes, acimaDoLimiar } = decisoesParaODono(carregado.raiz, new Date(Date.parse(quando) - JANELA_DAS_DECISOES_MS).toISOString());
    pulse.decisoes = decisoes; pulse.acimaDoLimiar = acimaDoLimiar;
  } catch (e) { diagnosticos.push(`decisoes.indisponiveis: ${(e as Error).message.slice(0, 120)}`); }
  // RM-057 (fatia 3): leitura pura do ledger; falhar aqui nunca derruba a fila de atencao.
  try {
    const hitl = lerHitlDeConducaoAgora(carregado.raiz, quando);
    if (hitl.abertas.length || hitl.seteDias.pedidos || hitl.seteDias.respondidos) pulse.hitlDeConducao = hitl;
  } catch (e) { diagnosticos.push(`hitl-conducao.indisponivel: ${(e as Error).message.slice(0, 120)}`); }
  // RM-063 (F6): a maquina ociosa, leitura pura das vagas, das reservas locais e do passo do condutor.
  try {
    const ociosa = maquinaOciosa(carregado, { quando });
    if (ociosa) pulse.maquinaOciosa = ociosa;
  } catch (e) { diagnosticos.push(`ociosidade.indisponivel: ${(e as Error).message.slice(0, 120)}`); }
  if (diagnosticos.length) pulse.runtime.detalhe = [pulse.runtime.detalhe, ...diagnosticos].filter(Boolean).join('; ');
  return pulse;
}

/**
 * RM-063 (F2): a fila do dono que o `ork roadmap status` le, a MESMA do `ork pulse` (`precisaDeHumanoAgora`). Em 12/10/2026
 * o status disse "Nada agora" com o pulse contando 3: as duas superficies montavam a fila cada uma do seu jeito. Sem
 * forja e sem registrar; o texto de cada item sai numa linha, redigido.
 */
export function filaDoDono(carregado: ManifestoCarregado, opcoes: { quando?: string } = {}): FilaDoDono {
  const linha = (texto: string, teto: number) => {
    const limpo = redigirSegredos(texto).replace(/[\p{Cc}\s]+/gu, ' ').trim();
    return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
  };
  try {
    const p = montarPulse(carregado, { quando: opcoes.quando, semForja: true });
    // Sem o `claude` nesta maquina nao ha sessao dele a perder: a fila do monitor e do ledger esta inteira.
    const lida = p.runtime.ok || !noPath('claude');
    return { lida, detalhe: lida ? null : linha(p.runtime.detalhe, 160),
      itens: p.precisaDeHumanoAgora.map(i => ({ id: i.id, thread: i.thread, sessionId: i.sessionId, fase: i.fase, classe: i.classe,
        motivo: i.motivo, pergunta: linha(i.pergunta || i.motivo, 200), comando: linha(i.comandoResposta, 160), paradaHaMin: i.paradaHaMin })) };
  } catch (e) {
    return { lida: false, detalhe: linha((e as Error).message, 160), itens: [] };
  }
}

export function textoDoPulse(p: Pulse): string {
  const m = msg().pulse;
  // I-35: o pulse guarda ISO; o texto ao dono sai no fuso dele, rotulado no cabeçalho.
  // RM-061 (F2b, G2): o que o pulse montou pelo catalogo sai remontado; o resto (pedido HITL, ledger) como veio.
  const local = (texto: string) => localizarTexto(remontar(texto), { agora: p.consultadoEm });
  // O detalhe do runtime junta partes separadas por "; ": cada uma e remontada.
  const detalhe = (texto: string) => localizarTexto(texto.split('; ').map(remontar).join('; '), { agora: p.consultadoEm });
  const linhas=[m.cabecalho(p.contrato, formatarDataHoraRotulada(p.consultadoEm, { agora: p.consultadoEm })),m.precisaDeHumano(p.resumo.humanos), m.semNota(p.resumo.scores)];
  // RM-037 (fatia 4): PR nao lido tambem e dito, para a falta de linha do condutor nao parecer "nada parado".
  if(p.runtime.ok && ['liveness.snapshot.invalid', 'prs.nao-lidos', 'prs.sem-leitura', 'entregas.indisponiveis'].some(d => p.runtime.detalhe.includes(d))) {
    linhas.push(m.diagnostico(detalhe(p.runtime.detalhe)));
  }
  if(!p.runtime.ok) linhas.push(m.consultaIncompleta(detalhe(p.runtime.detalhe)));
  for(const i of p.precisaDeHumanoAgora) {
    linhas.push('',m.item(String(i.thread??i.sessionId), m.classe(i.classe), i.paradaHaMin==null?m.desconhecido:i.paradaHaMin<1?m.menosDeUm:String(i.paradaHaMin)),local(i.pergunta),
      ...i.opcoes.map(o=>m.opcao(remontar(o))),m.recomendacao(remontar(i.recomendacao)),m.responder(remontar(i.comandoResposta)),
      ...i.contextoLogs.map(l=>m.log(l)));
  }
  if (p.conducoes?.length) {
    linhas.push('',m.conduzidas(p.conducoes.length));
    for (const c of p.conducoes) linhas.push(m.conducao(c.thread, remontar(c.linha)));
  }
  // RM-037 (fatia 4): o que espera o condutor, uma linha por thread; nao e pergunta ao dono.
  if (p.paradoNoCondutor?.length) {
    linhas.push('',m.paradoNoCondutor(p.paradoNoCondutor.length));
    for (const x of p.paradoNoCondutor) linhas.push(linhaDoParadoNoCondutor(x, { agora: p.consultadoEm }));
  }
  // RM-057 (fatia 3): quanto tempo cada pergunta de conducao aberta ja parou a thread, e a mediana da semana.
  if (p.hitlDeConducao) {
    const h = p.hitlDeConducao;
    linhas.push('',m.hitlDeConducao(h.abertas.length, textoDaMediana(h)));
    for (const a of h.abertas) linhas.push(linhaDaPerguntaParada(a, { agora: p.consultadoEm }));
  }
  linhas.push('',m.automaticas(p.resumo.automaticas));
  // RM-061 (F2b, D4): o item do radar sem tipo de HITL usa a classe como motivo; ela sai pelo id, o motivo tipado fica.
  for(const i of p.acoesAutomaticas) linhas.push(m.automatica(String(i.thread), i.motivo === i.classe ? m.classe(i.motivo) : i.motivo,
    remontar(i.comandoResposta)));
  // RM-063 (F5): a autorizacao da varredura e o que ela fez sozinha na semana.
  if (p.varredura) {
    const v = p.varredura, a = v.autorizacao;
    linhas.push('', a.estado === 'valida' ? m.varredura.autorizacaoValida(String(a.por), formatarDataHoraRotulada(String(a.ate), { agora: p.consultadoEm }),
      a.pode.join(', ')) : a.estado === 'ausente' ? m.varredura.autorizacaoAusente : m.varredura.autorizacaoInvalida(String(a.motivo), String(a.detalhe)));
    if (v.feitas.length) {
      linhas.push(m.varredura.feitas(v.feitas.length));
      for (const f of v.feitas) linhas.push(m.varredura.feita(f.thread, f.acao, f.detalhe));
    }
  }
  // RM-063 (F6): a maquina ociosa e as proximas threads sugeridas.
  if (p.maquinaOciosa) {
    const o = p.maquinaOciosa;
    linhas.push('', m.ociosa.linha(o.maquina, o.livres, o.limite, o.reservados));
    for (const s of o.sugeridas) linhas.push(m.ociosa.sugerida(s.item, s.thread ? `${s.thread}, ${s.fase}` : m.ociosa.semThread,
      remontar(s.passo), s.comando));
  }
  return linhas.join('\n');
}

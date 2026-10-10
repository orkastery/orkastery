import { exigirEscopoDeEscrita } from './escopo-escrita';
/** D4: uma fila para quem precisa de humano, com fontes e espera observada. */
import { consultarSessoes, ConsultaDeSessoes } from './adapters/claude-bg';
import { estadoBruto, varrerSessoes } from './hitl';
import { detectarFasesOrfas, FaseOrfa, FontesDeVida } from './liveness';
import { ManifestoCarregado } from './manifest';
import { pendentesDeScore, PendenteDeScore, ORDEM_DAS_CLASSES } from './master';
import { assinaturaProposta } from './master-batch';
import { montarMonitor } from './orquestracao';
import { pedidoCurtoDoImpedimento } from './impedimento';
import { dirThread, lerThread } from './thread';
import { ehRegistroDeAdocao } from './sessoes-adopt';
import { lerLedger } from './ledger';
import { FASES, MonitorDeOrquestracao, RadarDeSessoes, Thread, EventoLedger } from './types';
import { agora } from './util';
import { formatarDataHoraRotulada, localizarTexto } from './horario';
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
      if (p.fonte === 'escalonador' || ['lease.busy', 'conducao.em-andamento', 'concurrency.limite', 'vaga.stale', 'runtime.silencio'].includes(p.motivo)) continue;
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
        item.opcoes = curto.alternativas.map(a => `${a.chave}. ${a.texto}`);
        item.comandoResposta = item.impedimento.retry;
      } catch { item.evidencia.push('Pedido curto do impedimento indisponível; a correção acima vale.'); }
    }
    // I-45: vaga parada e sinal do escalonador (`ork board reap` devolve a vaga), nao pergunta ao dono.
    const esperaAutomatica=['lease.busy','conducao.em-andamento','concurrency.limite','runtime.rate-limited','vaga.stale'].includes(p.motivo);
    (esperaAutomatica?automaticas:humanos).push(item);
  }
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
  }
  for(const o of orfas) {
    if (ehRegistro(o.thread)) continue;
    const item: ItemPulse={id:`orfa:${o.thread}:${o.fase}:${o.sessionId}`,classe:o.classe,motivo:o.motivo,
      thread:o.thread,fase:o.fase,sessionId:o.sessionId,desdeEm:o.desdeEm,paradaHaMin:minutos(o.desdeEm,quando),
      impacto:impacto(o.fase),pergunta:`Fase ${o.fase} sem heartbeat desde ${o.ultimoHeartbeatEm}.`,
      opcoes:[],recomendacao:o.retry.razao,
      comandoResposta:o.retry.automatica?`ork retry run ${o.thread} --motivo runtime.silencio --fase ${o.fase}`:
        `ork retry plan ${o.thread} --motivo runtime.silencio --fase ${o.fase}`,
      evidencia:[...o.evidencia,`retry ${o.retry.tentativas}/${o.retry.limite}`],fontes:['liveness'],contextoLogs:[]};
    (o.retry.automatica?automaticas:humanos).push(item);
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
    ...(entregas?.parados.length ? { paradoNoCondutor: entregas.parados } : {})};
}

export function montarPulse(carregado: ManifestoCarregado, opcoes: {
  fontes?: (thread: Thread, despacho: EventoLedger) => FontesDeVida;
  registrar?: boolean; escopo?: readonly string[]; quando?: string; linhasLogs?: number; semRuntime?: boolean; consulta?: ConsultaDeSessoes;
  /** RM-037 (fatia 4): quem roda o `gh` na leitura dos PRs; os testes trocam por resposta gravada. */
  executorDoGh?: ExecutorDoGh;
} = {}): Pulse {
  if (opcoes.registrar) exigirEscopoDeEscrita(opcoes.escopo);
  const diagnosticos: string[] = [];
  const quando=opcoes.quando??agora();
  const consulta=opcoes.consulta??(opcoes.semRuntime
    ? {ok:false,sessoes:[],detalhe:'runtime não consultado por --sem-runtime'} : consultarSessoes(undefined,true));
  const estados=consulta.ok?new Map(consulta.sessoes.map(s=>[s.sessionId??'',estadoBruto(s)])):null;
  const radar=varrerSessoes({raiz:carregado.raiz,consulta,agora:quando,registrar:opcoes.registrar,escopo:opcoes.escopo,linhasLogs:opcoes.linhasLogs});
  if (radar.telasAdiadas) diagnosticos.push(`radar.orcamento: ${radar.telasAdiadas} tela(s) de sessão ficaram para a próxima varredura`);
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
    entregas = entregasDoProjeto(carregado, { quando, sessoes: radar.sessoes, lerPrs: (candidatas): LeituraDePrs => {
      const leitura = lerPrsDaForja(carregado, { quando, executor: opcoes.executorDoGh, candidatas });
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
  const pulse = comporPulse(carregado,{radar,monitor,orfas,batch:pendentesDeScore(carregado.raiz),...(entregas?{entregas}:{})});
  const conducoes = monitor.linhas.filter((l) => l.conducao).map((l) => ({ thread: l.thread, linha: linhaDeConducao(l.conducao!, { agora: quando }) }));
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
  if (diagnosticos.length) pulse.runtime.detalhe = [pulse.runtime.detalhe, ...diagnosticos].filter(Boolean).join('; ');
  return pulse;
}

export function textoDoPulse(p: Pulse): string {
  // I-35: o pulse guarda ISO; o texto ao dono sai no fuso dele, rotulado no cabeçalho.
  const local = (texto: string) => localizarTexto(texto, { agora: p.consultadoEm });
  const linhas=[`Pulse (${p.contrato}) ${formatarDataHoraRotulada(p.consultadoEm, { agora: p.consultadoEm })}`,`Precisa de humano agora: ${p.resumo.humanos}`, `${p.resumo.scores} entrega(s) sem nota, aceitas por padrão com registro`];
  // RM-037 (fatia 4): PR nao lido tambem e dito, para a falta de linha do condutor nao parecer "nada parado".
  if(p.runtime.ok && ['liveness.snapshot.invalid', 'prs.nao-lidos', 'prs.sem-leitura', 'entregas.indisponiveis'].some(d => p.runtime.detalhe.includes(d))) {
    linhas.push(`[diagnostico] ${local(p.runtime.detalhe)}`);
  }
  if(!p.runtime.ok) linhas.push(`[consulta incompleta] ${local(p.runtime.detalhe)}`);
  for(const i of p.precisaDeHumanoAgora) {
    linhas.push('',`${i.thread??i.sessionId} [${i.classe}] ${i.paradaHaMin==null?'desconhecido':i.paradaHaMin<1?'menos de 1':i.paradaHaMin} min`,local(i.pergunta),
      ...i.opcoes.map(o=>`  opção: ${o}`),`Recomendação: ${i.recomendacao}`,`Responder: ${i.comandoResposta}`,
      ...i.contextoLogs.map(l=>`  log: ${l}`));
  }
  if (p.conducoes?.length) {
    linhas.push('',`Conduzidas agora: ${p.conducoes.length}`);
    for (const c of p.conducoes) linhas.push(`${c.thread}: ${c.linha}`);
  }
  // RM-037 (fatia 4): o que espera o condutor, uma linha por thread; nao e pergunta ao dono.
  if (p.paradoNoCondutor?.length) {
    linhas.push('',`Parado no condutor: ${p.paradoNoCondutor.length}`);
    for (const x of p.paradoNoCondutor) linhas.push(linhaDoParadoNoCondutor(x, { agora: p.consultadoEm }));
  }
  // RM-057 (fatia 3): quanto tempo cada pergunta de conducao aberta ja parou a thread, e a mediana da semana.
  if (p.hitlDeConducao) {
    const h = p.hitlDeConducao;
    linhas.push('',`HITL de condução: ${h.abertas.length} aberta(s); ${textoDaMediana(h)}`);
    for (const a of h.abertas) linhas.push(linhaDaPerguntaParada(a, { agora: p.consultadoEm }));
  }
  linhas.push('',`Ações automáticas pendentes: ${p.resumo.automaticas}`);
  for(const i of p.acoesAutomaticas) linhas.push(`${i.thread}: ${i.motivo}; ${i.comandoResposta}`);
  return linhas.join('\n');
}

/**
 * RM-048 (item 7, D7): o status report UNICO do roadmap, no formato aprovado pelo dono.
 *
 * Ate aqui cada canal escrevia o proprio relatorio de roadmap, e o dono lia uma coisa no Telegram
 * e outra no terminal. O formato que ele aprovou (27/09 e 28/09):
 *
 *   titulo "Roadmap do <Projeto> (DD/MM, HH:MM)", no fuso do dono;
 *   grupos com icones, nesta ordem: Concluidos, Disponiveis com algo em aberto, Entregue hoje,
 *   Piloto, Em desenvolvimento, Refinamento, Proposto, Descontinuado;
 *   um item por linha, com #HITL no que depende do dono;
 *   fecho com "O que precisa de voce" e "O que eu faco em seguida".
 *
 * Tudo sai de FATO: o frontmatter do item (`ork docs`), o ledger das threads ligadas a ele e o gate
 * que o nucleo confere sem escrever (`prepararPedidoGate`). E leitura pura: nao abre pedido, nao
 * grava ledger, nao toca a rede. Os canais chamam `ork roadmap status` e transportam o texto.
 *
 * RM-054: o montador recebe FATOS de thread (`FatoDeThread`), nao so as threads deste disco. O
 * relatorio local continua com os fatos locais; o panorama da rede soma os retratos das outras
 * maquinas, e so ai o fecho diz entre parenteses em que maquina a thread anda.
 */
import { carregarDocs, Documento } from './docs';
import { ValorYaml } from './yaml';
import { lerLedger } from './ledger';
import { dirThread, lerThread, listarIds } from './thread';
import { alvoDoPedido, ehV2, estadoDoPedido, PedidoHitlQualquer, textoDoPedido } from './hitl-contract';
import { contextoHitlDosEventos, MOTIVOS_DE_ESCALACAO_HUMANA, prepararPedidoGate } from './hitl-gates';
import { quemDecide } from './hitl-classificacao';
import { dataLocal, duracaoCurta, formatarDataHora, formatarHora, partesLocais } from './horario';
import { ConsultaDoProjeto, linhasDaConsulta } from './projeto-alvo';
import { Thread } from './types';
import { BRANCH_DA_FABRICA, LIMIAR_SEM_BATIDA_MS, lerFabrica } from './fabrica-estado';
import { linhaDoParadoNoCondutor } from './hitl-resumo';
import { exigirManifesto, ManifestoCarregado } from './manifest';
import { fabricaCompartilhada, nomeDaMaquina } from './maquina';
import { EntregasDoProjeto, entregasDoProjeto, esperaDoCondutor, EstadoDaEntrega, lerRetratoDePrs } from './parado-no-condutor';
import { exec } from './util';

export const CONTRATO_STATUS_DO_ROADMAP = 'ork.roadmap-status/v1' as const;

export type GrupoDoRoadmap = 'concluidos' | 'disponiveis' | 'hoje' | 'piloto' | 'desenvolvimento' | 'refinamento' | 'proposto' | 'descontinuado';

/** Os grupos, na ordem e com os icones que o dono aprovou. */
export const GRUPOS_DO_ROADMAP: readonly { id: GrupoDoRoadmap; icone: string; titulo: string }[] = Object.freeze([
  { id: 'concluidos', icone: '✅', titulo: 'Concluídos' },
  { id: 'disponiveis', icone: '🟢', titulo: 'Disponíveis com algo em aberto' },
  { id: 'hoje', icone: '🚀', titulo: 'Entregue hoje' },
  { id: 'piloto', icone: '🧪', titulo: 'Piloto' },
  { id: 'desenvolvimento', icone: '🔨', titulo: 'Em desenvolvimento' },
  { id: 'refinamento', icone: '🔍', titulo: 'Refinamento' },
  { id: 'proposto', icone: '🆕', titulo: 'Proposto' },
  { id: 'descontinuado', icone: '⛔', titulo: 'Descontinuado' },
]);

/**
 * D7: o grupo de cada ciclo do padrao de roadmap (`docs/padroes/roadmap-de-produto.md`). Mapa
 * TOTAL sobre os doze ciclos; ciclo fora dele cai em "Proposto" e o texto o mostra como e.
 */
export const GRUPO_DO_CICLO: Readonly<Record<string, GrupoDoRoadmap>> = Object.freeze({
  'Concluído': 'concluidos',
  'Disponível': 'disponiveis',
  'Piloto': 'piloto',
  'Em desenvolvimento': 'desenvolvimento', 'Em validação': 'desenvolvimento', 'Bloqueado': 'desenvolvimento',
  'Refinamento': 'refinamento', 'Pronto para desenvolvimento': 'refinamento',
  'Discovery': 'proposto', 'Backlog': 'proposto',
  'Cancelado': 'descontinuado', 'Descontinuado': 'descontinuado',
});

/** Quantas linhas cada parte do fecho mostra antes de contar o resto. */
export const TETO_DO_FECHO = 5;

/** `maquina` so vem na visao da rede (RM-054): no relatorio local todas as threads sao daqui. */
export interface EsperaDoDono { thread: string; pergunta: string; codigo?: string; recomendada?: string; maquina?: string }

/** A letra recomendada de uma pergunta v2, para o fecho dizer exatamente o que digitar. */
const recomendadaDe = (p: PedidoHitlQualquer): string | undefined =>
  ehV2(p) && p.classe === 'pergunta' ? p.alternativas.find(a => a.recomendada)?.letra : undefined;

/**
 * RM-037 (fatia 4): o estado real da entrega da thread que conduz o item, lido do git local e do ultimo
 * retrato de PRs do pulse (nunca da rede). `parado`: o condutor deixou a entrega parada alem do limiar.
 */
export interface EntregaNoStatus {
  estado: string | null;
  /** Alguem conduz a thread agora (sessao trabalhando, processo do condutor): o "sigo" continua valendo. */
  conduzida?: boolean;
  /** `prLidoEm`: a hora da leitura do PR, quando a parada depende dela. */
  parado?: { desdeEm: string; proximoPasso: string; prLidoEm?: string };
  /** A hora da leitura dos PRs que sustenta o estado, quando ele veio do retrato. */
  prLidoEm?: string;
}

/** RM-037 (fatia 4): as maquinas da fabrica sem batida, pela copia local de `ork/fabrica-estado`. */
export interface BatidaDaFabrica {
  /** `false`: nada foi lido (sem copia local, ou copia ilegivel: `motivo`). */
  lido: boolean;
  motivo?: string;
  /**
   * A copia local esta velha: esta maquina nao publicou nela dentro do limiar (o fetch daqui pode estar
   * falhando), e ninguem pode ser dito sem batida. `ultimoDestaMaquina` e null quando ela nem aparece.
   */
  copiaVelha?: { ultimoDestaMaquina: string | null };
  semBatida: { maquina: string; publicadoEm: string; idadeMin: number }[];
}

export interface ItemDoStatus {
  id: string;
  titulo: string;
  ciclo: string;
  grupo: GrupoDoRoadmap;
  /** O que ainda esta aberto num item disponivel (exposicao, habilitacao). */
  emAberto: string[];
  /** As threads ligadas ao item (`sdlc.thread` e `thread.json.roadmap`). */
  threads: string[];
  /** A thread aberta que conduz o item agora, com a fase (e a maquina, na visao da rede). */
  conduzindo?: { thread: string; fase: string; maquina?: string; entrega?: EntregaNoStatus };
  /** O que espera o dono, quando espera: e isto que acende o #HITL. */
  hitl?: EsperaDoDono;
}

export interface StatusDoRoadmap {
  contrato: typeof CONTRATO_STATUS_DO_ROADMAP;
  consultadoEm: string;
  projeto: string;
  grupos: { id: GrupoDoRoadmap; icone: string; titulo: string; itens: ItemDoStatus[] }[];
  precisaDeVoce: { item: string; espera: EsperaDoDono }[];
  emSeguida: { item: string; thread: string; fase: string; maquina?: string; entrega?: EntregaNoStatus }[];
  /** RM-037 (fatia 4): so com fabrica compartilhada; sem copia local, `lido: false`. */
  fabrica?: BatidaDaFabrica;
  /**
   * RM-052: qual projeto foi lido (nome, raiz, remoto, origem) e o que nao foi. O CLI e o MCP sempre
   * preenchem; sem ele o titulo sozinho deixava um canal relatar o projeto errado como o pedido.
   */
  consulta?: ConsultaDoProjeto;
}

/**
 * RM-054: o que o relatorio precisa saber de uma thread, venha ela deste disco ou do retrato de
 * outra maquina. Entrega do dia e espera do dono sao lidas sob demanda, na mesma ordem de antes:
 * so a thread ligada a um item paga a leitura do ledger e do gate. Ids unicos.
 */
export interface FatoDeThread {
  id: string;
  /** O item do roadmap da thread, quando ela o declara. */
  roadmap: string | null;
  aberta: boolean;
  fase: string;
  entregueHoje: () => boolean;
  espera: () => EsperaDoDono | undefined;
  /** A maquina que conduz, so na visao da rede. */
  maquina?: string;
  /** RM-037 (fatia 4): o estado da entrega, so das threads deste disco. */
  entrega?: () => EntregaNoStatus | undefined;
}

type Mapa = { [k: string]: ValorYaml };
const mapa = (v: ValorYaml | undefined): Mapa => (!!v && typeof v === 'object' && !Array.isArray(v) ? v as Mapa : {});
const texto = (v: ValorYaml | undefined): string => (v === undefined || v === null ? '' : String(v));

/** O nome curto do item: o titulo ate o primeiro ":" ou 60 caracteres. */
function nomeCurto(titulo: string): string {
  const antes = titulo.split(/:\s/)[0].trim();
  return antes.length > 60 ? `${antes.slice(0, 57)}...` : antes;
}

/**
 * O que espera o dono nesta thread, lido sem escrever: um gate que ainda espera (pausa do modo ou
 * escalacao tipada do dono) ou uma pergunta de sessao aberta. Impedimento tecnico nao conta (D6).
 */
export function esperaDoDono(raiz: string, t: Thread, quando: string): EsperaDoDono | undefined {
  const eventos = lerLedger(dirThread(raiz, t.id));
  const escalacoes = [...new Set(eventos.filter(e => e.tipo === 'gate_blocked' && e.fase === t.faseAtual &&
    (MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(String(e.motivo)) && quemDecide(String(e.motivo)) === 'dono')
    .map(e => String(e.motivo)))];
  // RM-037 (fatia 4): o fim de turno sem pergunta e do condutor, nunca "O que precisa de voce".
  const doCondutor = esperaDoCondutor(t, eventos, quando) !== null;
  for (const motivo of [...(doCondutor ? [] : ['human.pending']), ...escalacoes]) {
    try {
      const preparado = prepararPedidoGate(raiz, t.id, motivo, quando);
      const pedido = 'aberto' in preparado ? preparado.aberto : preparado.novo;
      const codigo = 'aberto' in preparado ? (pedido as { codigo?: unknown }).codigo : undefined;
      const recomendada = recomendadaDe(pedido);
      return { thread: t.id, pergunta: textoDoPedido(pedido), ...(typeof codigo === 'string' ? { codigo } : {}),
        ...(recomendada ? { recomendada } : {}) };
    } catch { /* este motivo nao espera o dono agora */ }
  }
  const contexto = contextoHitlDosEventos(t, eventos);
  const respondidos = new Set(eventos.filter(e => ['human_gate', 'session_answered'].includes(e.tipo)).map(e => String(e.pedidoId)));
  for (const e of [...eventos].reverse()) {
    if (e.tipo !== 'hitl_requested' || e.contexto !== contexto) continue;
    const pedido = e.pedido as PedidoHitlQualquer;
    try {
      if (alvoDoPedido(pedido)?.tipo !== 'session' || respondidos.has(pedido.id) || estadoDoPedido(pedido, quando) !== 'aberto') continue;
      const codigo = ehV2(pedido) && pedido.classe === 'pergunta' ? pedido.codigo : undefined;
      const recomendada = recomendadaDe(pedido);
      return { thread: t.id, pergunta: textoDoPedido(pedido), ...(codigo ? { codigo } : {}), ...(recomendada ? { recomendada } : {}) };
    } catch { /* pedido invalido nao e espera */ }
  }
  return undefined;
}

/**
 * Os fatos das threads deste disco: `ship_done` do dia e espera do dono lidos do ledger local.
 * `fuso`: o do projeto consultado, na visao da rede; sem ele, o do dono deste processo.
 */
export function fatosLocais(raiz: string, quando: string, fuso?: string): FatoDeThread[] {
  const hoje = dataLocal(quando, fuso);
  const fatos: FatoDeThread[] = [];
  // RM-037 (fatia 4): o estado das entregas sai uma vez, sob demanda, do git local e do retrato de PRs do pulse.
  let entregas: EntregasDoProjeto | null | undefined;
  const lerEntregas = (): EntregasDoProjeto | null => {
    if (entregas !== undefined) return entregas;
    try {
      const retrato = lerRetratoDePrs(raiz);
      entregas = entregasDoProjeto(exigirManifesto(raiz), { quando, lerPrs: () => (retrato ? { ok: true, retrato } : null) });
    } catch { entregas = null; }
    return entregas;
  };
  // A leitura que falhou e dita, e nao vira o "sigo" de sempre.
  const entrega = (id: string): EntregaNoStatus | undefined => {
    const lidas = lerEntregas();
    return lidas ? entregaNoStatus(lidas.estados.find(e => e.thread === id)) : { estado: 'estado da entrega não lido' };
  };
  for (const id of listarIds(raiz)) {
    let t: Thread;
    try { t = lerThread(raiz, id); } catch { continue; /* thread ilegivel fica de fora */ }
    fatos.push({
      id: t.id, roadmap: t.roadmap ?? null, aberta: t.status !== 'fechada', fase: t.faseAtual,
      entregueHoje: () => lerLedger(dirThread(raiz, t.id)).some(e => e.tipo === 'ship_done' && dataLocal(e.ts, fuso) === hoje),
      espera: () => esperaDoDono(raiz, t, quando),
      entrega: () => (t.status === 'fechada' ? undefined : entrega(t.id)),
    });
  }
  return fatos;
}

/** O estado da entrega como o status o diz: so quando ha o que dizer. */
function entregaNoStatus(e: EstadoDaEntrega | undefined): EntregaNoStatus | undefined {
  if (!e || (!e.resumo && !e.parado)) return undefined;
  return { estado: e.resumo, ...(e.conduzidaAgora ? { conduzida: true } : {}),
    ...(e.parado ? { parado: { desdeEm: e.parado.desdeEm, proximoPasso: e.parado.proximoPasso,
      ...(e.parado.prLidoEm ? { prLidoEm: e.parado.prLidoEm } : {}) } } : {}),
    ...(e.prLidoEm ? { prLidoEm: e.prLidoEm } : {}) };
}

/**
 * RM-037 (fatia 4, D8): as outras maquinas da fabrica sem batida alem do limiar da rede, lidas da copia
 * local de `ork/fabrica-estado`, sem fetch. Sem fabrica compartilhada, nada; sem copia local, "nao lido".
 */
export function batidaDaFabrica(carregado: ManifestoCarregado, quando: string): BatidaDaFabrica | undefined {
  if (!fabricaCompartilhada(carregado.manifesto)) return undefined;
  // Sem rede escondida: num clone parcial, o `git show` dos retratos buscaria o objeto no remoto. O git anterior
  // a 2.45 ignora o GIT_NO_LAZY_FETCH, entao o clone parcial nem e lido aqui (N4 da seguranca, rodada 2).
  if (exec('git', ['config', '--get', 'extensions.partialclone'], carregado.raiz).stdout.trim()) {
    return { lido: false, motivo: `clone parcial: a cópia local de ${BRANCH_DA_FABRICA} não é lida sem rede`, semBatida: [] };
  }
  const antes = process.env.GIT_NO_LAZY_FETCH;
  process.env.GIT_NO_LAZY_FETCH = '1';
  let painel: ReturnType<typeof lerFabrica>;
  try { painel = lerFabrica(carregado.raiz, { remoto: carregado.manifesto.fabrica.remoto, semRemoto: true }); }
  catch { return { lido: false, motivo: `a cópia local de ${BRANCH_DA_FABRICA} está ilegível`, semBatida: [] }; }
  finally { if (antes === undefined) delete process.env.GIT_NO_LAZY_FETCH; else process.env.GIT_NO_LAZY_FETCH = antes; }
  if (!painel.ponta) return { lido: false, semBatida: [] };
  const eu = nomeDaMaquina(), agora = Date.parse(quando);
  // A copia so diz quem esta sem batida quando esta maquina publicou nela ha pouco: e o fetch daqui que a atualiza.
  const { publicadoEm: minha } = painel.maquinas.find(m => m.maquina === eu) ?? { publicadoEm: null };
  if (!minha || !(agora - Date.parse(minha) <= LIMIAR_SEM_BATIDA_MS)) {
    return { lido: true, copiaVelha: { ultimoDestaMaquina: minha }, semBatida: [] };
  }
  const semBatida = painel.maquinas.filter(m => m.maquina !== eu).map(m => {
    const { publicadoEm: publicado } = m;
    return { maquina: m.maquina, publicadoEm: publicado, idadeMs: agora - Date.parse(publicado) };
  }).filter(m => Number.isFinite(m.idadeMs) && m.idadeMs > LIMIAR_SEM_BATIDA_MS)
    .map(m => ({ maquina: m.maquina, publicadoEm: m.publicadoEm, idadeMin: Math.floor(m.idadeMs / 60000) }));
  return { lido: true, semBatida };
}

/** Monta o relatorio. Leitura pura: nada e escrito, nenhum pedido e aberto. */
export function montarStatusDoRoadmap(raiz: string,
    opcoes: { quando?: string; projeto?: string; consulta?: ConsultaDoProjeto } = {}): StatusDoRoadmap {
  const quando = opcoes.quando ?? new Date().toISOString();
  let fabrica: BatidaDaFabrica | undefined;
  try { fabrica = batidaDaFabrica(exigirManifesto(raiz), quando); } catch { fabrica = undefined; }
  return montarStatusDeFatos(carregarDocs(raiz).docs, fatosLocais(raiz, quando), { quando, projeto: opcoes.projeto, consulta: opcoes.consulta,
    ...(fabrica ? { fabrica } : {}) });
}

/** O relatorio a partir das paginas do roadmap e dos fatos das threads, de onde quer que venham. */
export function montarStatusDeFatos(docs: readonly Documento[], fatos: readonly FatoDeThread[],
  opcoes: { quando: string; projeto?: string; consulta?: ConsultaDoProjeto; fabrica?: BatidaDaFabrica }): StatusDoRoadmap {
  const quando = opcoes.quando;
  const porId = new Map(fatos.map(f => [f.id, f]));
  const porItem = new Map<string, Set<string>>();
  for (const f of fatos) if (f.roadmap) porItem.set(f.roadmap, new Set([...(porItem.get(f.roadmap) ?? []), f.id]));

  const itens: ItemDoStatus[] = [];
  for (const d of docs.filter(x => x.tipo === 'roadmap')) {
    const estado = mapa(d.dados.estado), sdlc = mapa(d.dados.sdlc);
    const ciclo = texto(estado.ciclo);
    const ligadas = [...new Set([...(porItem.get(d.id) ?? []), ...(texto(sdlc.thread) ? [texto(sdlc.thread)] : [])])]
      .filter(id => porId.has(id)).sort();
    const entregueHoje = ligadas.some(id => porId.get(id)!.entregueHoje());
    const abertas = ligadas.map(id => porId.get(id)!).filter(f => f.aberta);
    let hitl: EsperaDoDono | undefined;
    for (const f of abertas) { hitl = f.espera(); if (hitl) break; }
    // RM-037 (fatia 4): a thread que diz o estado real vem primeiro: a parada no condutor, depois a entrega em curso.
    const entregas = new Map(abertas.map(f => [f.id, f.entrega?.()]));
    const conduz = abertas.find(f => entregas.get(f.id)?.parado) ?? abertas.find(f => entregas.get(f.id)?.estado) ?? abertas[0];
    const entrega = conduz ? entregas.get(conduz.id) : undefined;
    const emAberto = GRUPO_DO_CICLO[ciclo] === 'disponiveis' ? [
      ...(texto(estado.exposicao) && texto(estado.exposicao) !== 'Geral' ? [`exposição ${texto(estado.exposicao)}`] : []),
      ...(texto(estado.habilitacao) && texto(estado.habilitacao) !== 'Concluída' ? [`habilitação ${texto(estado.habilitacao)}`] : []),
    ] : [];
    itens.push({
      id: d.id, titulo: nomeCurto(texto(d.dados.titulo) || d.id), ciclo,
      grupo: entregueHoje ? 'hoje' : GRUPO_DO_CICLO[ciclo] ?? 'proposto',
      emAberto, threads: ligadas,
      ...(conduz ? { conduzindo: { thread: conduz.id, fase: conduz.fase, ...(conduz.maquina ? { maquina: conduz.maquina } : {}),
        ...(entrega ? { entrega } : {}) } } : {}),
      ...(hitl ? { hitl } : {}),
    });
  }
  const grupos = GRUPOS_DO_ROADMAP.map(g => ({ ...g, itens: itens.filter(i => i.grupo === g.id) }));
  return {
    contrato: CONTRATO_STATUS_DO_ROADMAP, consultadoEm: quando,
    projeto: opcoes.projeto ?? 'projeto', grupos,
    precisaDeVoce: itens.filter(i => i.hitl).map(i => ({ item: i.id, espera: i.hitl! })),
    emSeguida: itens.filter(i => i.conduzindo && !i.hitl).map(i => ({ item: i.id, ...i.conduzindo! })),
    ...(opcoes.consulta ? { consulta: opcoes.consulta } : {}),
    ...(opcoes.fabrica ? { fabrica: opcoes.fabrica } : {}),
  };
}

/** "orkastery" vira "Orkastery": o titulo diz o nome do projeto como gente escreve. */
const capitalizar = (s: string): string => s ? s[0].toUpperCase() + s.slice(1) : s;

/** A maquina entre parenteses, so quando o fato a traz (visao da rede, D7 da RM-054). */
const naMaquina = (maquina?: string): string => maquina ? ` (${maquina})` : '';

/**
 * RM-037 (fatia 4): a linha do que vem a seguir diz o estado real. Parada no condutor sai com o desde e o
 * proximo passo; entrega em curso, com o estado do PR e a hora em que ele foi lido; sem nada disso, a fase.
 */
function linhaDoQueVem(x: StatusDoRoadmap['emSeguida'][number], agora: string, fuso?: string): string {
  const e = x.entrega;
  if (e?.parado) {
    const { prLidoEm: lido } = e.parado;
    return `• ${x.item}: ${linhaDoParadoNoCondutor({ thread: x.thread, ...e.parado }, { agora, fuso })}${naMaquina(x.maquina)}` +
      `${lido ? ` (PR lido às ${formatarHora(lido, { agora, fuso })})` : ''}.`;
  }
  if (e?.estado) {
    const { prLidoEm: lido } = e;
    const daLeitura = lido ? ` (PR lido às ${formatarHora(lido, { agora, fuso })})` : '';
    return e.conduzida ? `• ${x.item}: sigo ${x.thread} na fase ${x.fase}${naMaquina(x.maquina)}; ${e.estado}${daLeitura}.`
      : `• ${x.item}: ${x.thread} na fase ${x.fase}${naMaquina(x.maquina)}, ${e.estado}${daLeitura}.`;
  }
  return `• ${x.item}: sigo ${x.thread} na fase ${x.fase}${naMaquina(x.maquina)}.`;
}

/** RM-037 (fatia 4, D8): uma linha so para a fabrica, e so quando ha o que avisar. */
function linhaDaFabrica(f: BatidaDaFabrica | undefined, agora: string, fuso?: string): string[] {
  if (!f) return [];
  if (!f.lido) return [`Fábrica: não lido (${f.motivo ?? `esta máquina não tem cópia local de ${BRANCH_DA_FABRICA}`}).`];
  if (f.copiaVelha) {
    const { ultimoDestaMaquina: ultimo } = f.copiaVelha;
    return [`Fábrica: a cópia local de ${BRANCH_DA_FABRICA} está velha (${ultimo ? `esta máquina publicou nela por último em ` +
      `${formatarDataHora(ultimo, { agora, fuso })}` : 'esta máquina não aparece nela'}); não dá para dizer quem está sem batida.`];
  }
  if (!f.semBatida.length) return [];
  return [`Fábrica: ${f.semBatida.map(m => `${m.maquina} sem batida há ${duracaoCurta(m.idadeMin)} ` +
    `(último retrato ${formatarDataHora(m.publicadoEm, { agora, fuso })})`).join('; ')}, pela cópia local de ${BRANCH_DA_FABRICA}.`];
}

/**
 * O texto do relatorio, igual em todo canal: os icones sao parte do formato aprovado. `fuso`: o do
 * projeto consultado, na visao da rede; sem ele, o do dono deste processo.
 */
export function textoDoStatusDoRoadmap(s: StatusDoRoadmap, fuso?: string): string {
  if (s.contrato !== CONTRATO_STATUS_DO_ROADMAP) throw new Error('status do roadmap: contrato inválido');
  const p = partesLocais(s.consultadoEm, fuso);
  const linhaDoItem = (i: ItemDoStatus): string => {
    const detalhe = i.emAberto.length ? `: ${i.emAberto.join(', ')}` : i.conduzindo && i.grupo !== 'concluidos' && i.grupo !== 'hoje'
      ? ` (${i.conduzindo.fase}${i.conduzindo.maquina ? `, ${i.conduzindo.maquina}` : ''})` : '';
    return `• ${i.id} ${i.titulo}${detalhe}${i.hitl ? ' #HITL' : ''}`;
  };
  const cortar = <T>(lista: T[], f: (x: T) => string): string[] =>
    [...lista.slice(0, TETO_DO_FECHO).map(f), ...(lista.length > TETO_DO_FECHO ? [`• e mais ${lista.length - TETO_DO_FECHO}`] : [])];
  return [
    `Roadmap do ${capitalizar(s.projeto)} (${p.dia}/${p.mes}, ${p.hora}:${p.minuto})`,
    // RM-052: logo abaixo do titulo aprovado, qual projeto foi lido e o que nao foi.
    ...(s.consulta ? linhasDaConsulta(s.consulta) : []),
    ...linhaDaFabrica(s.fabrica, s.consultadoEm, fuso),
    ...s.grupos.filter(g => g.itens.length).flatMap(g => ['', `${g.icone} ${g.titulo}`, ...g.itens.map(linhaDoItem)]),
    '', 'O que precisa de você',
    ...(s.precisaDeVoce.length ? cortar(s.precisaDeVoce, x => `• ${x.item}${naMaquina(x.espera.maquina)}: ${x.espera.pergunta}` +
      (x.espera.codigo ? ` Responda ${x.espera.codigo} ${x.espera.recomendada ?? 'a'} (ou outra letra).` : ' A pergunta chega no próximo resumo.'))
      : ['• Nada agora.']),
    '', 'O que eu faço em seguida',
    ...(s.emSeguida.length ? cortar(s.emSeguida, x => linhaDoQueVem(x, s.consultadoEm, fuso))
      : ['• Nada em andamento; sigo o que você priorizar.']),
  ].join('\n');
}

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
 */
import { carregarDocs } from './docs';
import { ValorYaml } from './yaml';
import { lerLedger } from './ledger';
import { dirThread, lerThread, listarIds } from './thread';
import { alvoDoPedido, ehV2, estadoDoPedido, PedidoHitlQualquer, textoDoPedido } from './hitl-contract';
import { contextoHitlDosEventos, MOTIVOS_DE_ESCALACAO_HUMANA, prepararPedidoGate } from './hitl-gates';
import { quemDecide } from './hitl-classificacao';
import { dataLocal, partesLocais } from './horario';
import { ConsultaDoProjeto, linhasDaConsulta } from './projeto-alvo';
import { Thread } from './types';

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

export interface EsperaDoDono { thread: string; pergunta: string; codigo?: string; recomendada?: string }

/** A letra recomendada de uma pergunta v2, para o fecho dizer exatamente o que digitar. */
const recomendadaDe = (p: PedidoHitlQualquer): string | undefined =>
  ehV2(p) && p.classe === 'pergunta' ? p.alternativas.find(a => a.recomendada)?.letra : undefined;

export interface ItemDoStatus {
  id: string;
  titulo: string;
  ciclo: string;
  grupo: GrupoDoRoadmap;
  /** O que ainda esta aberto num item disponivel (exposicao, habilitacao). */
  emAberto: string[];
  /** As threads ligadas ao item (`sdlc.thread` e `thread.json.roadmap`). */
  threads: string[];
  /** A thread aberta que conduz o item agora, com a fase. */
  conduzindo?: { thread: string; fase: string };
  /** O que espera o dono, quando espera: e isto que acende o #HITL. */
  hitl?: EsperaDoDono;
}

export interface StatusDoRoadmap {
  contrato: typeof CONTRATO_STATUS_DO_ROADMAP;
  consultadoEm: string;
  projeto: string;
  grupos: { id: GrupoDoRoadmap; icone: string; titulo: string; itens: ItemDoStatus[] }[];
  precisaDeVoce: { item: string; espera: EsperaDoDono }[];
  emSeguida: { item: string; thread: string; fase: string }[];
  /**
   * RM-052: qual projeto foi lido (nome, raiz, remoto, origem) e o que nao foi. O CLI e o MCP sempre
   * preenchem; sem ele o titulo sozinho deixava um canal relatar o projeto errado como o pedido.
   */
  consulta?: ConsultaDoProjeto;
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
  for (const motivo of ['human.pending', ...escalacoes]) {
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

/** Monta o relatorio. Leitura pura: nada e escrito, nenhum pedido e aberto. */
export function montarStatusDoRoadmap(raiz: string,
    opcoes: { quando?: string; projeto?: string; consulta?: ConsultaDoProjeto } = {}): StatusDoRoadmap {
  const quando = opcoes.quando ?? new Date().toISOString();
  const hoje = dataLocal(quando);
  const threads = new Map<string, Thread>();
  for (const id of listarIds(raiz)) { try { threads.set(id, lerThread(raiz, id)); } catch { /* thread ilegivel fica de fora */ } }
  const porItem = new Map<string, Set<string>>();
  for (const t of threads.values()) if (t.roadmap) porItem.set(t.roadmap, new Set([...(porItem.get(t.roadmap) ?? []), t.id]));

  const itens: ItemDoStatus[] = [];
  for (const d of carregarDocs(raiz).docs.filter(x => x.tipo === 'roadmap')) {
    const estado = mapa(d.dados.estado), sdlc = mapa(d.dados.sdlc);
    const ciclo = texto(estado.ciclo);
    const ligadas = [...new Set([...(porItem.get(d.id) ?? []), ...(texto(sdlc.thread) ? [texto(sdlc.thread)] : [])])]
      .filter(id => threads.has(id)).sort();
    const entregueHoje = ligadas.some(id => lerLedger(dirThread(raiz, id)).some(e => e.tipo === 'ship_done' && dataLocal(e.ts) === hoje));
    const abertas = ligadas.map(id => threads.get(id)!).filter(t => t.status !== 'fechada');
    let hitl: EsperaDoDono | undefined;
    for (const t of abertas) { hitl = esperaDoDono(raiz, t, quando); if (hitl) break; }
    const conduz = abertas[0];
    const emAberto = GRUPO_DO_CICLO[ciclo] === 'disponiveis' ? [
      ...(texto(estado.exposicao) && texto(estado.exposicao) !== 'Geral' ? [`exposição ${texto(estado.exposicao)}`] : []),
      ...(texto(estado.habilitacao) && texto(estado.habilitacao) !== 'Concluída' ? [`habilitação ${texto(estado.habilitacao)}`] : []),
    ] : [];
    itens.push({
      id: d.id, titulo: nomeCurto(texto(d.dados.titulo) || d.id), ciclo,
      grupo: entregueHoje ? 'hoje' : GRUPO_DO_CICLO[ciclo] ?? 'proposto',
      emAberto, threads: ligadas,
      ...(conduz ? { conduzindo: { thread: conduz.id, fase: conduz.faseAtual } } : {}),
      ...(hitl ? { hitl } : {}),
    });
  }
  const grupos = GRUPOS_DO_ROADMAP.map(g => ({ ...g, itens: itens.filter(i => i.grupo === g.id) }));
  return {
    contrato: CONTRATO_STATUS_DO_ROADMAP, consultadoEm: quando,
    projeto: opcoes.projeto ?? 'projeto', grupos,
    precisaDeVoce: itens.filter(i => i.hitl).map(i => ({ item: i.id, espera: i.hitl! })),
    emSeguida: itens.filter(i => i.conduzindo && !i.hitl).map(i => ({ item: i.id, thread: i.conduzindo!.thread, fase: i.conduzindo!.fase })),
    ...(opcoes.consulta ? { consulta: opcoes.consulta } : {}),
  };
}

/** "orkastery" vira "Orkastery": o titulo diz o nome do projeto como gente escreve. */
const capitalizar = (s: string): string => s ? s[0].toUpperCase() + s.slice(1) : s;

/** O texto do relatorio, igual em todo canal: os icones sao parte do formato aprovado. */
export function textoDoStatusDoRoadmap(s: StatusDoRoadmap): string {
  if (s.contrato !== CONTRATO_STATUS_DO_ROADMAP) throw new Error('status do roadmap: contrato inválido');
  const p = partesLocais(s.consultadoEm);
  const linhaDoItem = (i: ItemDoStatus): string => {
    const detalhe = i.emAberto.length ? `: ${i.emAberto.join(', ')}` : i.conduzindo && i.grupo !== 'concluidos' && i.grupo !== 'hoje'
      ? ` (${i.conduzindo.fase})` : '';
    return `• ${i.id} ${i.titulo}${detalhe}${i.hitl ? ' #HITL' : ''}`;
  };
  const cortar = <T>(lista: T[], f: (x: T) => string): string[] =>
    [...lista.slice(0, TETO_DO_FECHO).map(f), ...(lista.length > TETO_DO_FECHO ? [`• e mais ${lista.length - TETO_DO_FECHO}`] : [])];
  return [
    `Roadmap do ${capitalizar(s.projeto)} (${p.dia}/${p.mes}, ${p.hora}:${p.minuto})`,
    // RM-052: logo abaixo do titulo aprovado, qual projeto foi lido e o que nao foi.
    ...(s.consulta ? linhasDaConsulta(s.consulta) : []),
    ...s.grupos.filter(g => g.itens.length).flatMap(g => ['', `${g.icone} ${g.titulo}`, ...g.itens.map(linhaDoItem)]),
    '', 'O que precisa de você',
    ...(s.precisaDeVoce.length ? cortar(s.precisaDeVoce, x => `• ${x.item}: ${x.espera.pergunta}` +
      (x.espera.codigo ? ` Responda ${x.espera.codigo} ${x.espera.recomendada ?? 'a'} (ou outra letra).` : ' A pergunta chega no próximo resumo.'))
      : ['• Nada agora.']),
    '', 'O que eu faço em seguida',
    ...(s.emSeguida.length ? cortar(s.emSeguida, x => `• ${x.item}: sigo ${x.thread} na fase ${x.fase}.`)
      : ['• Nada em andamento; sigo o que você priorizar.']),
  ].join('\n');
}

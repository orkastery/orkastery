/**
 * RM-058, integração das fatias N1 a N6 (T1.1 da ork-rm058integra, D3 e D5): quem é thread de um arco #Noctum.
 *
 * O arco entrega as threads dele pelo passo da entrega da N5: a revisão independente, o verify no SHA, o envelope conferido
 * antes de cada efeito e o MASTER por omissão. Os caminhos de fora do arco não sabiam disso: a sessão do bloco chegava ao
 * SHIP e mesclava pelo `ork ship`, sem a revisão, e nada impedia o `ork ship registrar-pr` de gravar a entrega dela.
 *
 * A regra (D3) mora aqui, e os chamadores só leem as funções. É thread de um arco a que está:
 *
 * - na lista do envelope vigente ou na da proposta que espera o dono no prazo: a thread fixada no trabalho, ou a que casa
 *   com o item e o sha256 do pedido do trabalho (a regra da fila e da supervisão);
 * - no log de despachos do arco (a thread reservada e a que o despacho abriu);
 * - ou cujo último `phase_dispatch` tem a correlação `noctum:<arco>`.
 *
 * Nos caminhos manuais (`ork ship`, o `ork_ship` do MCP, `ork ship publicar`, `ork ship registrar-pr` e
 * `ork conducao atualizar`), guardam o arco agendado, o vigente e o proposto com a proposta no prazo. O proposto sem
 * proposta no prazo (o nunca autorizado fica `proposto` para sempre), o expirado, o revogado e o encerrado não guardam. O
 * arco que não se lê recusa só a thread cujo último despacho tem a correlação dele (`noctum.guarda.arco-ilegivel`); as
 * outras seguem. Sem nenhum arco nesta raiz, nada é lido além da pasta dos arcos: quem não usa o #Noctum não paga nada.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { Mensagens, textoDoCatalogo } from './locale';
import { ArcoComProposta, lerArcoComProposta, SituacaoDoArco } from './noctum-arco';
import { ConteudoDoEnvelope, ID_DO_ARCO, RecusaDoArco, shaDoPedido } from './noctum-envelope';
import { dirThread, lerThread } from './thread';

export const MOTIVO_DA_GUARDA = 'noctum.guarda.thread-do-arco' as const;
export const MOTIVO_DO_ARCO_ILEGIVEL = 'noctum.guarda.arco-ilegivel' as const;
export type MotivoDaGuarda = typeof MOTIVO_DA_GUARDA | typeof MOTIVO_DO_ARCO_ILEGIVEL;

/** De onde vem o vínculo da thread com o arco; um arco dá um vínculo só, o primeiro desta ordem. */
export type OrigemDoVinculo = 'envelope' | 'proposta' | 'despacho' | 'correlacao';

export interface VinculoDoArco { arco: string; situacao: SituacaoDoArco; origem: OrigemDoVinculo }

/** Os arcos desta raiz, cada um lido uma vez no instante dado, e os que não se leram, com o motivo. */
export interface ArcosDaRaiz { quando: string; lidos: Map<string, ArcoComProposta>; ilegiveis: Map<string, string> }

/** A recusa tipada da guarda: o arco, a situação dele (`null` no arco que não se lê), a origem do vínculo e o que fazer. */
export interface RecusaDaGuarda {
  motivo: MotivoDaGuarda;
  thread: string;
  arco: string;
  situacao: SituacaoDoArco | null;
  origem: OrigemDoVinculo;
  detalhe: string;
  correcao: string;
  /** O detalhe e a correção numa linha, para quem guarda um texto só (o motivo do `registrar-pr`, o da atualização). */
  texto: string;
}

/** A recusa com os três textos do catálogo, cada um remontável no locale de quem imprime. */
function recusa(motivo: MotivoDaGuarda, thread: string, arco: string, situacao: SituacaoDoArco | null, origem: OrigemDoVinculo,
  detalhe: (m: Mensagens) => string, correcao: (m: Mensagens) => string): RecusaDaGuarda {
  return { motivo, thread, arco, situacao, origem, detalhe: textoDoCatalogo(detalhe), correcao: textoDoCatalogo(correcao),
    texto: textoDoCatalogo((m) => `${detalhe(m)}; ${correcao(m)}`) };
}

/** Os nomes das pastas de arco desta raiz de estado (o `listarArcos` do modo, sem puxar o passo, a entrega e o relatório). */
function nomesDosArcos(raiz: string): string[] {
  try {
    return fs.readdirSync(path.join(raizDoEstado(raiz), '.orkastery', 'noctum', 'arcos')).filter(n => ID_DO_ARCO.test(n)).sort();
  } catch { return []; }
}

/** Lê cada arco desta raiz uma vez. O arco que não se lê fica com o motivo, e os outros seguem. */
export function lerArcosDaRaiz(raiz: string, quando = new Date().toISOString()): ArcosDaRaiz {
  const arcos: ArcosDaRaiz = { quando, lidos: new Map(), ilegiveis: new Map() };
  for (const arco of nomesDosArcos(raiz)) {
    try {
      const lido = lerArcoComProposta(raiz, arco, quando);
      if (lido) arcos.lidos.set(arco, lido);
    } catch (e) {
      arcos.ilegiveis.set(arco, e instanceof RecusaDoArco ? e.motivo : (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 160));
    }
  }
  return arcos;
}

/** O arco da correlação `noctum:<arco>` do último `phase_dispatch` da thread; `null` sem despacho ou com outra correlação. */
export function arcoDoUltimoDespacho(raiz: string, thread: string): string | null {
  let eventos: ReturnType<typeof lerLedger>;
  try { eventos = lerLedger(dirThread(raiz, thread)); } catch { return null; }
  for (let i = eventos.length - 1; i >= 0; i--) {
    if (eventos[i].tipo !== TIPOS_DE_EVENTO.faseDespachada) continue;
    const c = eventos[i].correlacao;
    const arco = typeof c === 'string' && c.startsWith('noctum:') ? c.slice('noctum:'.length) : '';
    return ID_DO_ARCO.test(arco) ? arco : null;
  }
  return null;
}

/** O item e o sha256 do pedido da thread, para o trabalho de pedido; a thread que não se lê não casa com nenhum. */
type DadosDaThread = { roadmap: string | null; pedido: string | null };

/** A thread está na lista? A fixada no trabalho, ou a que casa com o item e o sha256 do pedido dele. */
function naLista(conteudo: ConteudoDoEnvelope | null, thread: string, dados: () => DadosDaThread): boolean {
  return !!conteudo?.trabalhos?.some(w => w.thread !== undefined ? w.thread === thread
    : w.pedido !== undefined && dados().roadmap === w.item && dados().pedido === shaDoPedido(w.pedido));
}

/**
 * Os vínculos da thread com os arcos lidos, um por arco, na ordem das origens: a lista do envelope vigente, a da proposta
 * no prazo, o log de despachos e a correlação do último despacho (`ultimo`, quando o chamador já a leu).
 */
export function vinculosDaThread(raiz: string, arcos: ArcosDaRaiz, thread: string, ultimo?: string | null): VinculoDoArco[] {
  if (!arcos.lidos.size) return [];
  const doUltimo = ultimo === undefined ? arcoDoUltimoDespacho(raiz, thread) : ultimo;
  let lidos: DadosDaThread | null = null;
  const dados = (): DadosDaThread => {
    if (!lidos) {
      try { const t = lerThread(raiz, thread); lidos = { roadmap: t.roadmap ?? null, pedido: t.pedido?.sha256 ?? null }; }
      catch { lidos = { roadmap: null, pedido: null }; }
    }
    return lidos;
  };
  const vinculos: VinculoDoArco[] = [];
  for (const [arco, { estado, proposta }] of arcos.lidos) {
    const origem: OrigemDoVinculo | null = naLista(estado.conteudo, thread, dados) ? 'envelope'
      : naLista(proposta, thread, dados) ? 'proposta'
      : estado.despachos.some(d => d.thread === thread || d.threadDespachada === thread) ? 'despacho'
      : doUltimo === arco ? 'correlacao' : null;
    if (origem) vinculos.push({ arco, situacao: estado.situacao, origem });
  }
  return vinculos;
}

/** D3: guardam os caminhos manuais o arco agendado, o vigente e o proposto pela proposta no prazo (a única que dá vínculo). */
export function guardaOsCaminhosManuais(v: VinculoDoArco): boolean {
  return v.situacao === 'agendado' || v.situacao === 'vigente' || (v.situacao === 'proposto' && v.origem === 'proposta');
}

/**
 * A guarda dos caminhos manuais: a recusa tipada quando a thread é trabalho de um arco que a guarda agora, ou `null`. O
 * `doArco` é o arco que entrega pelo próprio passo (o da entrega da N5 publica com ele): a guarda dele não o recusa, e a de
 * outro arco recusa. `arcos` reaproveita a leitura de quem confere várias threads de uma vez (o `registrar-pr --todas`).
 */
export function guardaDaThread(raiz: string, thread: string, quando = new Date().toISOString(),
  opcoes: { doArco?: string; arcos?: ArcosDaRaiz } = {}): RecusaDaGuarda | null {
  const arcos = opcoes.arcos ?? lerArcosDaRaiz(raiz, quando);
  if (!arcos.lidos.size && !arcos.ilegiveis.size) return null;
  const ultimo = arcoDoUltimoDespacho(raiz, thread);
  const ilegivel = ultimo !== null && ultimo !== opcoes.doArco ? arcos.ilegiveis.get(ultimo) : undefined;
  if (ultimo !== null && ilegivel !== undefined) {
    return recusa(MOTIVO_DO_ARCO_ILEGIVEL, thread, ultimo, null, 'correlacao', (m) => m.ship.guarda.arcoIlegivel(thread, ultimo, ilegivel),
      (m) => m.ship.guarda.arcoIlegivelCorrecao(ultimo));
  }
  const v = vinculosDaThread(raiz, arcos, thread, ultimo).find(x => x.arco !== opcoes.doArco && guardaOsCaminhosManuais(x));
  if (!v) return null;
  return recusa(MOTIVO_DA_GUARDA, thread, v.arco, v.situacao, v.origem,
    (m) => m.ship.guarda.doArco(thread, v.arco, m.ship.guarda.situacoes[v.situacao] ?? v.situacao, m.ship.guarda.origens[v.origem] ?? v.origem),
    (m) => m.ship.guarda.doArcoCorrecao(v.arco));
}

/**
 * D5: a linha que o passo do arco anexa ao pedido de toda sessão que ele despacha. Fixa e determinística: o mesmo arco dá
 * o mesmo texto em toda chamada, e o `rodarFase` segue idempotente para a mesma fase e o mesmo prompt.
 */
export const linhaDoArco = (arco: string): string =>
  `Esta thread é trabalho do arco \`${arco}\` do #Noctum: o SHIP e o MASTER dela são do arco; não faça push, não abra PR e não mescle.`;

/** O pedido da sessão do arco: o do dono e, no fim, a linha do arco. */
export const pedidoDoArco = (pedido: string, arco: string): string => `${pedido.trimEnd()}\n\n${linhaDoArco(arco)}`;

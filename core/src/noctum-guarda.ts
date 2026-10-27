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
 *
 * Nos caminhos automáticos (T1.2, D4), a batida, a varredura, a Sentinela e a máquina ociosa leem o campo `arco` do passo
 * do condutor (`arcoDoPasso`): a guarda segura toda ação; a retenção, a do arco terminal que despachou a thread por último,
 * segura o despacho, a retomada e o merge até um despacho fora do arco ou um arco novo, autorizado depois, que a liste.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { Mensagens, textoDoCatalogo } from './locale';
import { exigirManifesto } from './manifest';
import { ArcoComProposta, EstadoDoArco, lerArcoComProposta, SituacaoDoArco } from './noctum-arco';
import { sessoesEmVooDoArco } from './noctum-sessoes-em-voo';
import { ConteudoDoEnvelope, envelopeMultimaquina, ID_DO_ARCO, RecusaDoArco, shaDoPedido, Trabalho } from './noctum-envelope';
import type { RedeDoArco } from './noctum-rede';
import { dirThread, lerThread } from './thread';
import { EventoLedger } from './types';

export const MOTIVO_DA_GUARDA = 'noctum.guarda.thread-do-arco' as const;
export const MOTIVO_DO_ARCO_ILEGIVEL = 'noctum.guarda.arco-ilegivel' as const;
export const MOTIVO_DA_REDE_ILEGIVEL = 'noctum.guarda.rede-ilegivel' as const;
export type MotivoDaGuarda = typeof MOTIVO_DA_GUARDA | typeof MOTIVO_DO_ARCO_ILEGIVEL | typeof MOTIVO_DA_REDE_ILEGIVEL;

/** De onde vem o vínculo da thread com o arco; um arco dá um vínculo só, o primeiro desta ordem. */
export type OrigemDoVinculo = 'envelope' | 'proposta' | 'despacho' | 'correlacao' | 'rede';

export interface VinculoDoArco { arco: string; situacao: SituacaoDoArco; origem: OrigemDoVinculo }

/** Os arcos desta raiz, cada um lido uma vez no instante dado, e os que não se leram, com o motivo. */
export interface ArcosDaRaiz {
  quando: string;
  lidos: Map<string, ArcoComProposta>;
  ilegiveis: Map<string, string>;
  /** Cache preguiçoso da rede: só um arco v3 encerrado e vinculado chega a consultá-lo. */
  redes: Map<string, RedeDoArco>;
  redesIlegiveis: Map<string, string>;
}

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
  const arcos: ArcosDaRaiz = { quando, lidos: new Map(), ilegiveis: new Map(), redes: new Map(), redesIlegiveis: new Map() };
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

/** O arco da correlação `noctum:<arco>` do último `phase_dispatch` entre os eventos dados; `null` sem ele. */
export function arcoDosEventos(eventos: readonly EventoLedger[]): string | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    if (eventos[i].tipo !== TIPOS_DE_EVENTO.faseDespachada) continue;
    const c = eventos[i].correlacao;
    const arco = typeof c === 'string' && c.startsWith('noctum:') ? c.slice('noctum:'.length) : '';
    return ID_DO_ARCO.test(arco) ? arco : null;
  }
  return null;
}

/** O arco da correlação `noctum:<arco>` do último `phase_dispatch` da thread; `null` sem despacho ou com outra correlação. */
export function arcoDoUltimoDespacho(raiz: string, thread: string): string | null {
  try { return arcoDosEventos(lerLedger(dirThread(raiz, thread))); } catch { return null; }
}

/** O item e o sha256 do pedido da thread, para o trabalho de pedido; a thread que não se lê não casa com nenhum. */
type DadosDaThread = { roadmap: string | null; pedido: string | null };

/** A thread está na lista? A fixada no trabalho, ou a que casa com o item e o sha256 do pedido dele. */
function naLista(conteudo: ConteudoDoEnvelope | null, thread: string, dados: () => DadosDaThread): boolean {
  return !!trabalhoNaLista(conteudo, thread, dados);
}

/** O trabalho da thread na lista, pela fixação ou pelo pedido, quando existe. */
function trabalhoNaLista(conteudo: ConteudoDoEnvelope | null, thread: string, dados: () => DadosDaThread): Trabalho | null {
  return conteudo?.trabalhos?.find(w => w.thread !== undefined ? w.thread === thread
    : w.pedido !== undefined && dados().roadmap === w.item && dados().pedido === shaDoPedido(w.pedido)) ?? null;
}

/** O id do trabalho que liga esta thread ao arco, na lista vigente ou no despacho mais recente. */
function trabalhoDaThread(estado: EstadoDoArco, thread: string, dados: () => DadosDaThread): string | null {
  const listado = trabalhoNaLista(estado.conteudo, thread, dados);
  if (listado) return listado.id;
  for (let i = estado.despachos.length - 1; i >= 0; i--) {
    const d = estado.despachos[i];
    if (d.thread === thread || d.threadDespachada === thread) return d.trabalho;
  }
  return null;
}

/** A rede do arco, uma vez por `ArcosDaRaiz`; falha inesperada também fica cacheada e falha fechada. */
function redeDoArco(arco: string, arcos: ArcosDaRaiz, ler: (arco: string) => RedeDoArco): RedeDoArco | string {
  const pronta = arcos.redes.get(arco);
  if (pronta) return pronta;
  const falha = arcos.redesIlegiveis.get(arco);
  if (falha !== undefined) return falha;
  try {
    const rede = ler(arco);
    arcos.redes.set(arco, rede);
    return rede;
  } catch (e) {
    const detalhe = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
    arcos.redesIlegiveis.set(arco, detalhe);
    return detalhe;
  }
}

/**
 * A fila carrega a Sentinela, que carrega esta guarda. Resolver a projeção só quando uma thread de arco v3 encerrado
 * realmente precisar dela evita o ciclo de inicialização fila -> guarda -> rede -> coordenação -> fila.
 */
function lerRedePadrao(raiz: string, arco: string, quando: string): RedeDoArco {
  const { lerRede } = require('./noctum-rede') as typeof import('./noctum-rede');
  return lerRede(exigirManifesto(raiz), arco, { quando });
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
  opcoes: { doArco?: string; arcos?: ArcosDaRaiz; lerRede?: (arco: string) => RedeDoArco } = {}): RecusaDaGuarda | null {
  const arcos = opcoes.arcos ?? lerArcosDaRaiz(raiz, quando);
  if (!arcos.lidos.size && !arcos.ilegiveis.size) return null;
  const ultimo = arcoDoUltimoDespacho(raiz, thread);
  const ilegivel = ultimo !== null && ultimo !== opcoes.doArco ? arcos.ilegiveis.get(ultimo) : undefined;
  if (ultimo !== null && ilegivel !== undefined) {
    return recusa(MOTIVO_DO_ARCO_ILEGIVEL, thread, ultimo, null, 'correlacao', (m) => m.ship.guarda.arcoIlegivel(thread, ultimo, ilegivel),
      (m) => m.ship.guarda.arcoIlegivelCorrecao(ultimo));
  }
  const vinculos = vinculosDaThread(raiz, arcos, thread, ultimo);
  const v = vinculos.find(x => x.arco !== opcoes.doArco && guardaOsCaminhosManuais(x));
  if (!v) {
    let dadosLidos: DadosDaThread | null = null;
    const dados = (): DadosDaThread => {
      if (dadosLidos) return dadosLidos;
      try { const t = lerThread(raiz, thread); dadosLidos = { roadmap: t.roadmap ?? null, pedido: t.pedido?.sha256 ?? null }; }
      catch { dadosLidos = { roadmap: null, pedido: null }; }
      return dadosLidos;
    };
    // Num v3 encerrado localmente, o trabalho pode seguir em outra máquina. A rede só é lida depois de provar o vínculo,
    // e a leitura fica no `ArcosDaRaiz` para o registrar-pr --todas não consultar o mesmo arco de novo.
    for (const t of vinculos.filter(x => x.arco !== opcoes.doArco && x.situacao === 'encerrado')) {
      const lido = arcos.lidos.get(t.arco);
      if (!lido?.estado.conteudo || !envelopeMultimaquina(lido.estado.conteudo)) continue;
      const trabalho = trabalhoDaThread(lido.estado, thread, dados);
      if (!trabalho) continue;
      const rede = redeDoArco(t.arco, arcos, opcoes.lerRede ?? ((arco) => lerRedePadrao(raiz, arco, arcos.quando)));
      if (typeof rede === 'string' || rede.lacuna) {
        const falha = typeof rede === 'string' ? rede : `${rede.lacuna!.motivo}: ${rede.lacuna!.detalhe}`;
        return recusa(MOTIVO_DA_REDE_ILEGIVEL, thread, t.arco, t.situacao, 'rede',
          (m) => m.ship.guarda.redeIlegivel(thread, t.arco, falha), (m) => m.ship.guarda.redeIlegivelCorrecao(t.arco));
      }
      const naRede = rede.trabalhos.find(x => x.id === trabalho);
      if (!rede.revogada && naRede && naRede.estado !== 'entregue' && naRede.estado !== 'encerrado') {
        return recusa(MOTIVO_DA_GUARDA, thread, t.arco, t.situacao, 'rede',
          (m) => m.ship.guarda.redeDoArco(thread, t.arco, naRede.estado, trabalho),
          (m) => m.ship.guarda.redeDoArcoCorrecao(t.arco));
      }
    }
    // A2 do CHECK: no arco que terminou (revogado, expirado ou encerrado), a sessão que ele despachou e que ainda conduz a
    // thread não entrega fora dele; sem sessão dele em voo, a thread se entrega à mão, como antes.
    for (const t of vinculos.filter(x => x.arco !== opcoes.doArco && TERMINAIS.includes(x.situacao))) {
      const lido = arcos.lidos.get(t.arco);
      const sessao = lido ? sessaoDoArcoEmVoo(raiz, thread, lido.estado) : null;
      if (!sessao) continue;
      if ('seq' in sessao) {
        return recusa(MOTIVO_DA_GUARDA, thread, t.arco, t.situacao, t.origem,
          (m) => m.ship.guarda.reservaDoArco(thread, t.arco, m.ship.guarda.situacoes[t.situacao] ?? t.situacao, sessao.seq),
          (m) => m.ship.guarda.reservaDoArcoCorrecao(t.arco));
      }
      return recusa(MOTIVO_DA_GUARDA, thread, t.arco, t.situacao, t.origem,
        (m) => m.ship.guarda.sessaoDoArco(thread, t.arco, m.ship.guarda.situacoes[t.situacao] ?? t.situacao, sessao.sessionId),
        (m) => m.ship.guarda.sessaoDoArcoCorrecao(t.arco));
    }
    return null;
  }
  return recusa(MOTIVO_DA_GUARDA, thread, v.arco, v.situacao, v.origem,
    (m) => m.ship.guarda.doArco(thread, v.arco, m.ship.guarda.situacoes[v.situacao] ?? v.situacao, m.ship.guarda.origens[v.origem] ?? v.origem),
    (m) => m.ship.guarda.doArcoCorrecao(v.arco));
}

/** As situações do arco que já terminou: nada novo sai dele, e a retenção vale (D4). */
const TERMINAIS: readonly SituacaoDoArco[] = ['expirado', 'revogado', 'encerrado'];

/**
 * A2 do CHECK: a sessão que o arco despachou nesta thread e que ainda não acabou, ou `null`. É a conta do fechamento
 * (`sessoesEmVooDoArco`): a sessão concluída sem resultado, morte nem superação no ledger, e a da reserva pendente, que o
 * runtime abriu antes de o condutor morrer (N4 do CHECK 2), com o id que ele disse ou, sem id, a reserva (M3 do CHECK 3).
 * O ledger que não se lê não prova o fim: a guarda falha fechada. Só os despachos desta thread entram, e a reserva pendente
 * ainda sem thread gravada (M2 do CHECK 3): a guarda não lê os ledgers do arco inteiro a cada consulta.
 */
function sessaoDoArcoEmVoo(raiz: string, thread: string, estado: EstadoDoArco): { sessionId: string } | { seq: number } | null {
  const despachos = estado.despachos.filter(d => (d.threadDespachada ?? d.thread) === thread || (d.desfecho === 'pendente' && !(d.threadDespachada ?? d.thread)));
  const s = sessoesEmVooDoArco(raiz, { ...estado, despachos }).find(x => x.thread === thread);
  return !s ? null : s.sessionId ? { sessionId: s.sessionId } : { seq: s.seq };
}

/** O vínculo da thread com um arco, como os caminhos automáticos o leem no passo do condutor (T1.2, D3 e D4). */
export interface ArcoDoPasso {
  arco: string;
  /** `null` no arco que não se lê. */
  situacao: SituacaoDoArco | null;
  /**
   * `guarda`: o arco agendado, vigente ou com a proposta no prazo (ou o que não se lê) segura toda ação automática.
   * `retencao`: o arco terminal despachou a thread por último; o despacho, a retomada e o merge esperam um despacho fora do
   * arco ou um arco novo, autorizado depois dele, que a liste; registrar, master e limpar seguem.
   */
  efeito: 'guarda' | 'retencao';
  motivo: MotivoDaGuarda;
  detalhe: string;
}

/**
 * O arco que segura ou retém a thread nos caminhos automáticos, ou `null`. `eventos` é o ledger da thread que o chamador
 * já leu (o passo do condutor lê todos), e `arcos` é a leitura única desta raiz.
 */
export function arcoDoPasso(raiz: string, arcos: ArcosDaRaiz, thread: string, eventos: readonly EventoLedger[]): ArcoDoPasso | null {
  if (!arcos.lidos.size && !arcos.ilegiveis.size) return null;
  const ultimo = arcoDosEventos(eventos);
  const ilegivel = ultimo === null ? undefined : arcos.ilegiveis.get(ultimo);
  if (ultimo !== null && ilegivel !== undefined) {
    return { arco: ultimo, situacao: null, efeito: 'guarda', motivo: MOTIVO_DO_ARCO_ILEGIVEL,
      detalhe: textoDoCatalogo((m) => m.ship.guarda.arcoIlegivel(thread, ultimo, ilegivel)) };
  }
  const vinculos = vinculosDaThread(raiz, arcos, thread, ultimo);
  const g = vinculos.find(guardaOsCaminhosManuais);
  if (g) {
    return { arco: g.arco, situacao: g.situacao, efeito: 'guarda', motivo: MOTIVO_DA_GUARDA,
      detalhe: textoDoCatalogo((m) => m.ship.guarda.doArco(thread, g.arco, m.ship.guarda.situacoes[g.situacao] ?? g.situacao,
        m.ship.guarda.origens[g.origem] ?? g.origem)) };
  }
  const doUltimo = ultimo === null ? undefined : arcos.lidos.get(ultimo);
  if (ultimo === null || !doUltimo || !TERMINAIS.includes(doUltimo.estado.situacao)) return null;
  // Um arco novo, autorizado depois deste, que lista a thread (na lista dele ou no log de despachos) acaba a retenção.
  const desde = Date.parse(doUltimo.estado.autorizadoPor?.recebidoEm ?? '');
  const novo = vinculos.some(v => v.arco !== ultimo && (v.origem === 'envelope' || v.origem === 'despacho') &&
    Date.parse(arcos.lidos.get(v.arco)?.estado.autorizadoPor?.recebidoEm ?? '') > desde);
  if (novo) return null;
  const situacao = doUltimo.estado.situacao;
  return { arco: ultimo, situacao, efeito: 'retencao', motivo: MOTIVO_DA_GUARDA,
    detalhe: textoDoCatalogo((m) => m.ship.guarda.retencao(thread, ultimo, m.ship.guarda.situacoes[situacao] ?? situacao)) };
}

/**
 * D5: a linha que o passo do arco anexa ao pedido de toda sessão que ele despacha. Fixa e determinística: o mesmo arco dá
 * o mesmo texto em toda chamada, e o `rodarFase` segue idempotente para a mesma fase e o mesmo prompt.
 */
export const linhaDoArco = (arco: string): string =>
  `Esta thread é trabalho do arco \`${arco}\` do #Noctum: o SHIP e o MASTER dela são do arco; não faça push, não abra PR e não mescle.`;

/** O pedido da sessão do arco: o do dono e, no fim, a linha do arco. */
export const pedidoDoArco = (pedido: string, arco: string): string => `${pedido.trimEnd()}\n\n${linhaDoArco(arco)}`;

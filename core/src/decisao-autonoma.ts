/**
 * I-41 (GO-FIX 1, B4): a metade que presta contas.
 *
 * Das cinco camadas que o GOAL prometeu contra "obvia virar desculpa para decidir tudo em
 * silencio" (R1), tres estavam de pe (criterio resolvivel, preco declarado e porta fechada para o
 * irreversivel) e duas nao existiam: o RASTRO TIPADO e o PLACAR. E nada emitia `classe: decidido`.
 * A fabrica ja decide sessenta vezes para cada vez que pergunta (M7 do PLAN), e o dono nao via
 * nenhuma dessas decisoes. A cobranca dele foi literal: "eu devo ser informado da decisao pra
 * poder ajustar". Trocar burocracia por silencio seria pior que o problema original.
 *
 * Este modulo e o domicilio das duas camadas que faltavam, e do emissor:
 *
 *   RASTRO (D11). Toda `autonomous_decision` nova carrega `quemDecidiu`, `evidencia` e `razao`, e
 *   o registro recusa o evento sem os tres (`ledger.ts`). Os nomes historicos continuam lidos,
 *   normalizados na leitura; nenhuma linha do ledger e reescrita.
 *
 *   EMISSOR. `registrarDecisao` grava a decisao informada, `classe: decidido` com os quatro campos
 *   (o que, o porque, como mudar, custo de reverter agora e depois) e o criterio que RESOLVE, no
 *   mesmo evento do rastro. Ela nao segura fase, nao tem prazo e nao pede resposta: chega ao dono
 *   no resumo do pulse, para ele saber e poder ajustar.
 *
 *   PLACAR. Por fase: decididas contra perguntas, quantas decisoes o dono mandou reverter, e
 *   quantas vieram sem rastro. O limiar de revisao e 13 decisoes por fase, o p90 das 155 fases
 *   medidas no PLAN (M7). Ele dispara revisao no CHECK, nunca recusa: ha fases legitimas com 81.
 *   A taxa de reversao e o sinal que o limiar sozinho nao ve: trinta decisoes certas e trinta
 *   erradas fazem o mesmo placar, e so a reversao diz qual das duas "obvia" era para quem le.
 */
import { randomUUID } from 'node:crypto';
import { CONTRATO_HITL_V2, DecisaoInformada, profundidadeDoPedido, TipoDeCriterio, validarPedidoHitlV2,
  alvoDoPedido, PedidoHitlQualquer } from './hitl-contract';
import { comLockHitl, resolverCriterio } from './hitl-gates';
import { exigirRastroDeDecisaoAutonoma, lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { dirThread, listarIds, lerThread } from './thread';
import { EventoLedger } from './types';
import { exigirModoVivo } from './modos';

export const CONTRATO_DECISAO_AUTONOMA = 'ork.decisao-autonoma/v1' as const;

/** D3/M7: o p90 das 155 fases ja medidas. Acima disso a fase esta no decil mais alto do projeto. */
export const LIMIAR_DE_DECISOES_POR_FASE = 13;

/** Os nomes que o rastro teve antes de ser tipado (M6), na ordem em que valem na leitura. */
export const NOMES_HISTORICOS_DE_QUEM = ['quemDecidiu', 'autorizadoPor', 'quem', 'por', 'decididoPor', 'decisor',
  'decididaPor', 'decidiuQuem'] as const;
export const NOMES_HISTORICOS_DE_RAZAO = ['razao', 'porque', 'motivo', 'justificativa'] as const;
export const NOMES_HISTORICOS_DE_EVIDENCIA = ['evidencia', 'evidencias', 'evidenciaSha256', 'comandos', 'sha256'] as const;

export interface RastroDaDecisao { quemDecidiu: string; evidencia: string; razao: string }

const valor = (e: Record<string, unknown>, nomes: readonly string[]): string | undefined => {
  for (const nome of nomes) {
    const v = e[nome];
    const texto = Array.isArray(v) ? v.join('; ') : typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    if (texto.trim()) return texto.trim();
  }
  return undefined;
};

/**
 * O rastro de uma decisao, com os nomes historicos normalizados. `tipada` diz se o evento ja nasceu
 * com os tres campos de nome unico; um evento antigo pode ser completo pelos nomes velhos sem ser
 * tipado, e a auditoria precisa enxergar as duas coisas.
 */
export function rastroDaDecisao(e: EventoLedger): Partial<RastroDaDecisao> & { tipada: boolean; completa: boolean } {
  const bruto = e as unknown as Record<string, unknown>;
  const quemDecidiu = valor(bruto, NOMES_HISTORICOS_DE_QUEM);
  const razao = valor(bruto, NOMES_HISTORICOS_DE_RAZAO);
  const evidencia = valor(bruto, NOMES_HISTORICOS_DE_EVIDENCIA);
  const tipada = ['quemDecidiu', 'evidencia', 'razao'].every(c => typeof bruto[c] === 'string' && !!String(bruto[c]).trim());
  return { quemDecidiu, razao, evidencia, tipada, completa: !!(quemDecidiu && razao && evidencia) };
}

export interface EntradaDaDecisao {
  decidido: string;
  porque: string;
  comoMudar: string;
  custoDeReverter: { agora: string; depois: string };
  criterio: { tipo: TipoDeCriterio; referencia: string };
  quemDecidiu: string;
  evidencia: string;
  /** A razao do rastro. Sem ela, vale o porque que o dono le. */
  razao?: string;
  /** O pedido de uma decisao anterior desta thread que esta desfaz. E o que conta a reversao. */
  reverte?: string;
  quando?: string;
}

/**
 * O emissor de `classe: decidido`.
 *
 * A decisao so existe se passar pelo contrato v2 (os quatro campos, sem campo de gate, nunca
 * irreversivel) e se o criterio RESOLVER: manifesto e ledger sao lidos de verdade, medicao tem a
 * forma conferida e a execucao fica com o CHECK. O rastro e gravado no mesmo evento, sob o lock da
 * thread: nao existe decisao informada sem rastro, nem rastro de uma decisao que nao chegou ao dono.
 */
export function registrarDecisao(raiz: string, threadId: string, entrada: EntradaDaDecisao): { pedido: DecisaoInformada; evento: EventoLedger } {
  const t = lerThread(raiz, threadId);
  if (t.status === 'fechada') throw new Error('decisão informada: thread fechada não decide mais nada');
  const quando = entrada.quando ?? new Date().toISOString();
  // I-43: thread em modo aposentado e lida para sempre, mas nao escreve pedido novo.
  const modo = exigirModoVivo(t.modo);
  const pedido: DecisaoInformada = {
    contrato: CONTRATO_HITL_V2, classe: 'decidido', id: randomUUID(), thread: t.id, fase: t.faseAtual, modo,
    criadoEm: quando, profundidade: profundidadeDoPedido(t.faseAtual, modo),
    decidido: entrada.decidido, porque: entrada.porque, comoMudar: entrada.comoMudar,
    custoDeReverter: { agora: entrada.custoDeReverter.agora, depois: entrada.custoDeReverter.depois },
    criterio: { tipo: entrada.criterio.tipo, referencia: entrada.criterio.referencia },
  };
  validarPedidoHitlV2(pedido);
  // R1, camada 1: criterio que aponta para nada vale o mesmo que criterio ausente.
  const { resolve, detalhe } = resolverCriterio(raiz, pedido);
  if (!resolve) throw new Error(`decisão informada: critério não resolve (${detalhe})`);
  const rastro: RastroDaDecisao = { quemDecidiu: entrada.quemDecidiu, evidencia: entrada.evidencia, razao: entrada.razao ?? entrada.porque };
  // O registro confere os tres de novo; conferir aqui evita tomar o lock para recusar.
  exigirRastroDeDecisaoAutonoma(rastro as unknown as Record<string, unknown>);
  return comLockHitl(raiz, t.id, () => {
    const agora = lerThread(raiz, t.id), dir = dirThread(raiz, t.id);
    if (agora.status === 'fechada' || agora.faseAtual !== pedido.fase) throw new Error('decisão informada: a fase mudou enquanto ela era registrada');
    if (entrada.reverte && !lerLedger(dir).some(e => e.tipo === TIPOS_DE_EVENTO.decisaoAutonoma &&
        (e.pedido as { id?: string } | undefined)?.id === entrada.reverte)) {
      throw new Error('decisão informada: a decisão revertida não existe nesta thread');
    }
    const evento = registrar(dir, t.id, TIPOS_DE_EVENTO.decisaoAutonoma, {
      contratoDecisao: CONTRATO_DECISAO_AUTONOMA, fase: pedido.fase, decisao: pedido.decidido, ...rastro,
      pedido, ...(entrada.reverte ? { reverte: entrada.reverte } : {}),
    });
    return { pedido, evento };
  });
}

// ---------------------------------------------------------------------------
// O placar.
// ---------------------------------------------------------------------------

export interface PlacarDaFase {
  fase: string;
  /** Todas as decisoes autonomas da fase, com ou sem conteudo, como a serie que deu o limiar. */
  decididas: number;
  /** As que chegaram ao dono como decisao informada, com os quatro campos. */
  informadas: number;
  /** Pedidos de resposta ao dono na fase (as duas versoes; decisao informada nao conta). */
  perguntas: number;
  /** Decisoes da fase que uma decisao posterior desfez. */
  revertidas: number;
  /** Decisoes sem os tres campos do rastro, mesmo lidas pelos nomes historicos. */
  semRastro: number;
  acimaDoLimiar: boolean;
}

export function placarDaThread(eventos: readonly EventoLedger[]): PlacarDaFase[] {
  const fases = new Map<string, PlacarDaFase>();
  const da = (fase: unknown): PlacarDaFase => {
    const chave = typeof fase === 'string' && fase ? fase : 'sem-fase';
    if (!fases.has(chave)) fases.set(chave, { fase: chave, decididas: 0, informadas: 0, perguntas: 0, revertidas: 0, semRastro: 0, acimaDoLimiar: false });
    return fases.get(chave)!;
  };
  const revertidos = new Set(eventos.filter(e => e.tipo === TIPOS_DE_EVENTO.decisaoAutonoma && typeof e.reverte === 'string')
    .map(e => String(e.reverte)));
  for (const e of eventos) {
    if (e.tipo === TIPOS_DE_EVENTO.decisaoAutonoma) {
      const p = da(e.fase);
      p.decididas++;
      const id = (e.pedido as { id?: string } | undefined)?.id;
      if (id) p.informadas++;
      if (id && revertidos.has(id)) p.revertidas++;
      if (!rastroDaDecisao(e).completa) p.semRastro++;
    } else if (e.tipo === 'hitl_requested' && e.pedido && alvoDoPedido(e.pedido as PedidoHitlQualquer)) {
      da(e.fase ?? (e.pedido as { fase?: string }).fase).perguntas++;
    }
  }
  for (const p of fases.values()) p.acimaDoLimiar = p.decididas > LIMIAR_DE_DECISOES_POR_FASE;
  return [...fases.values()];
}

/** A taxa de reversao das decisoes informadas: o sinal de "obvia" que nao era obvia para o dono. */
export function taxaDeReversao(placar: readonly PlacarDaFase[]): number | null {
  const informadas = placar.reduce((n, p) => n + p.informadas, 0);
  return informadas ? placar.reduce((n, p) => n + p.revertidas, 0) / informadas : null;
}

// ---------------------------------------------------------------------------
// O que chega ao dono.
// ---------------------------------------------------------------------------

export interface DecisaoParaODono {
  id: string;
  thread: string;
  fase: string;
  em: string;
  decidido: string;
  porque: string;
  comoMudar: string;
  custoDeReverter: { agora: string; depois: string };
  quemDecidiu: string;
  reverte?: string;
}

export interface FaseAcimaDoLimiar { thread: string; fase: string; decididas: number }

/**
 * As decisoes informadas recentes de todas as threads abertas, e as fases que passaram do
 * limiar. Somente leitura. Thread fechada nao registra decisao nova, entao nao precisa ser lida.
 */
export function decisoesParaODono(raiz: string, desde: string): { decisoes: DecisaoParaODono[]; acimaDoLimiar: FaseAcimaDoLimiar[] } {
  const decisoes: DecisaoParaODono[] = [], acimaDoLimiar: FaseAcimaDoLimiar[] = [];
  for (const id of listarIds(raiz)) {
    let t;
    try { t = lerThread(raiz, id); } catch { continue; }
    if (t.status === 'fechada') continue;
    const eventos = lerLedger(dirThread(raiz, id));
    for (const e of eventos) {
      const p = e.pedido as DecisaoInformada | undefined;
      if (e.tipo !== TIPOS_DE_EVENTO.decisaoAutonoma || p?.classe !== 'decidido' || e.ts < desde) continue;
      decisoes.push({ id: p.id, thread: id, fase: p.fase, em: e.ts, decidido: p.decidido, porque: p.porque,
        comoMudar: p.comoMudar, custoDeReverter: p.custoDeReverter, quemDecidiu: String(e.quemDecidiu ?? ''),
        ...(typeof e.reverte === 'string' ? { reverte: e.reverte } : {}) });
    }
    const atual = placarDaThread(eventos).find(f => f.fase === t.faseAtual);
    if (atual?.acimaDoLimiar) acimaDoLimiar.push({ thread: id, fase: atual.fase, decididas: atual.decididas });
  }
  decisoes.sort((a, b) => a.em.localeCompare(b.em));
  return { decisoes, acimaDoLimiar };
}

/**
 * Gates tipados (bloco B1).
 *
 * O gate do B0 era por FASE e por MODO: decidia se o bloco pausa para o humano.
 * O gate do B1 acrescenta o MOTIVO TIPADO da reprovacao: `claims.failed`,
 * `policy.violation`, `verify.regression` e companhia, sempre do catalogo,
 * nunca por contagem de bytes ou grep no artefato.
 *
 * Regra central que atravessa o espectro de modos: o modo afrouxa a PAUSA, nunca a
 * VERIFICACAO. Por isso todo motivo tipado deste catalogo reprova em qualquer modo,
 * inclusive `#Auto`; o que o modo decide e apenas se a AUTORIZACAO espera o humano.
 */

import { EventoLedger, ModoLegado, MotivoGate } from './types';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { MODOS } from './modos';
import { dirThread } from './thread';
import { validarEvidenciaDoIngresso } from './hitl-ingress-receipt';
import { validarEvidenciaLocal } from './hitl-local-receipt';
import { ehContratoDePedido } from './hitl-contract';

/** Onde um gate acontece. Uma policy declara em quais gates ela vale. */
/** RM-008 (B8): `claims.add` so avalia policy em warn; nenhum gate bloqueia o registro de claim. */
export type PontoDeGate = 'phase.dispatch' | 'verify' | 'ship' | 'claims.add';

/** O que cada motivo tipado significa, em uma linha, para a saida do CLI. */
export const DESCRICAO_DO_MOTIVO: Readonly<Record<MotivoGate, string>> = {
  'artifact.missing': 'artefato exigido pela fase nao existe no disco',
  'claims.failed': 'alegacao verificavel reprovou na reexecucao no HEAD real',
  'claims.unverifiable': 'alegacao sem comando de verificacao declarado',
  'policy.violation': 'policy do manifesto com severidade block foi violada',
  'runtime.autoconferencia': 'o CHECK foi despachado no mesmo runtime que fez o GO, e a thread exige validacao cruzada',
  'verify.regression': 'comando que passava na baseline falha agora',
  'verify.failed': 'comando de verificacao falhou (sem baseline para separar divida pre-existente)',
  'verify.timeout': 'comando de verificacao estourou o prazo antes de terminar: nao ha veredito sobre ele',
  'verify.sem-veredito': 'a rodada nao produziu veredito valido: comando que nao chegou a rodar, ou produto alterado entre o preparo e o fim',
  'ci.failed': 'CHECK independente ausente, pendente ou reprovado no commit candidato',
  'runtime.unavailable': 'runtime adapter indisponivel para o despacho',
  'runtime.silencio': 'fase despachada sem heartbeat dentro do limite de liveness',
  'runtime.rate-limited':
    'o runtime bateu o limite de uso da assinatura e a fase morreu antes de terminar (bloco B3: entra na fila duravel e e retomada na janela seguinte)',
  'runtime.quota-exhausted':
    'a cota ou os creditos da conta do runtime acabaram (I-33: o perfil sai do rodizio e a fase segue em outro perfil, outro runtime ou na fila)',
  'runtime.auth-missing':
    'a conta do runtime nao esta autenticada (I-33: o perfil nunca recebe despacho ate o login ser refeito pelo proprio CLI)',
  'runtime.model-unavailable':
    'o modelo pedido nao existe ou a conta nao tem acesso a ele (RM-037: o perfil segue no rodizio e a fase vai a outro perfil com o mesmo modelo ou ao fallback do bloco)',
  'runtime.profile-invalid':
    'o perfil pedido no despacho (--perfil) nao existe no store ou e de outro runtime (RM-056: o despacho nunca troca de perfil sozinho)',
  'runtime.workspace-untrusted':
    'o runtime nao confia no diretorio da worktree e recusou o despacho (RM-055: so o dono aceita a confianca no terminal; depois o ork re-despacha o mesmo prompt)',
  'runtime.consent-pending':
    'o runtime espera o dono aceitar termos novos e recusou o despacho (RM-055: so o dono aceita no terminal; depois o ork re-despacha o mesmo prompt)',
  'cost.violation':
    'o despacho seria redirecionado para provider pago (violacao de custo: e o unico motivo que NUNCA recebe retry automatico)',
  'tree.blocked':
    'a arvore de destino nao esta disponivel para o merge (branch em check-out com alteracao nao commitada, ou worktree que nao pode ser montada)',
  'lease.busy': 'lease ocupado por outra thread',
  'conducao.em-andamento':
    'outra conducao ja executa na worktree da thread (I-36): o pedido foi recusado com quem conduz e as tres acoes (esperar, acompanhar, assumir)',
  'hitl.formato':
    'o pedido HITL saiu fora do formato obrigatorio (pergunta em uma frase, de 3 a 5 alternativas rotuladas com consequencia, exatamente uma com o selo Recomendacao e o porque, corpo em lista; texto livre so com dependencia tecnica tipada)',
  'human.pending': 'gate humano do modo de conducao ainda nao autorizou',
};

/**
 * Motivos que reprovam em QUALQUER modo, inclusive `#Auto`.
 *
 * Sao todos os motivos de verificacao e de policy: o modo nunca afrouxa verificacao.
 * `human.pending` e a excecao de natureza: nao e reprovacao de verdade, e espera de
 * autorizacao, e por isso existe so nos modos que pausam.
 */
export function reprovaEmTodoModo(motivo: MotivoGate): boolean {
  return motivo !== 'human.pending';
}

/** Motivos que bloqueiam a entrega. `claims.unverifiable` avisa, mas nao bloqueia. */
export function bloqueia(motivo: MotivoGate): boolean {
  return motivo !== 'claims.unverifiable';
}

export interface DadosDeGate {
  gate: PontoDeGate;
  motivo: MotivoGate;
  detalhe: string;
  /** Leitor: thread aposentada tambem reprova gate, e a tag dela sai no ledger. */
  modo: ModoLegado;
  /** Comando, arquivo ou hash que comprova a decisao. */
  evidencia?: string;
  correcao?: string;
  [extra: string]: unknown;
}

/** Registra a reprovacao tipada no ledger da thread. */
export function registrarGateBloqueado(
  dirDaThread: string,
  threadId: string,
  dados: DadosDeGate
): EventoLedger {
  return registrar(dirDaThread, threadId, TIPOS_DE_EVENTO.gateBloqueado, {
    ...dados,
    tag: MODOS[dados.modo].tag,
    significado: DESCRICAO_DO_MOTIVO[dados.motivo],
    reprovaEmTodoModo: reprovaEmTodoModo(dados.motivo),
  });
}

/** Registra a liberacao do gate, com quem autorizou e com que evidencia. */
export function registrarGateLiberado(
  dirDaThread: string,
  threadId: string,
  dados: {
    gate: PontoDeGate;
    /** Leitor: idem `DadosDeGate`. */
    modo: ModoLegado;
    autorizadoPor: string;
    evidencia: string;
    [extra: string]: unknown;
  }
): EventoLedger {
  return registrar(dirDaThread, threadId, TIPOS_DE_EVENTO.gateLiberado, {
    ...dados,
    tag: MODOS[dados.modo].tag,
  });
}

/** Linha de saida do CLI para um motivo tipado. */
export function descreverMotivo(motivo: MotivoGate, detalhe: string): string {
  return `motivo tipado: ${motivo} (${DESCRICAO_DO_MOTIVO[motivo]})\n  detalhe: ${detalhe}`;
}

/**
 * `ork gate approve`, APOSENTADO: aprovacao sem pedido e recusada. A pausa se libera pela
 * resposta ao `ork gate request`, que chega pelo ingresso humano autenticado.
 *
 * Antes da aposentadoria, era o que tornava verificavel a "autorizacao antecipada de push"
 * do `#Classic`: ela virava um evento no ledger com quem autorizou e quando, em vez de
 * memoria de conversa.
 */
export function aprovarGateHumano(
  _raiz: string,
  _threadId: string,
  _sobre: string,
  _por: string,
  _observacao?: string
): EventoLedger {
  throw new Error('aprovação cega aposentada: use ork gate request e responda ao pedido pelo ingresso humano autenticado');
}

/**
 * FX2: a FORMA do evento. Sozinha ela nunca autorizou nada de verdade.
 *
 * Esta era a checagem inteira: campos presentes e `recibo` com cara de sha256. Quem
 * conseguisse escrever uma linha no `ledger.jsonl` fabricava uma aprovacao humana que
 * `retry` e `ship` aceitavam, porque nenhum dos dois reconferia o MAC do ingresso. A forma
 * continua valendo como primeiro filtro barato; ela so nao decide mais.
 */
function formaDeAprovacao(e: EventoLedger): boolean {
  return e.tipo === TIPOS_DE_EVENTO.pausaHumana && e.estado === 'aprovado' &&
    // I-41 (T4c): as duas versoes do pedido, por lista fechada. Um `human_gate` copia o contrato
    // do pedido que respondeu; recusar v2 aqui faria a aprovacao do dono parar de valer para
    // `retry` e `ship` no dia em que o nucleo passasse a emitir v2. Contrato fora da lista
    // continua recusado, e a prova do recibo, que e quem de fato autoriza, nao muda.
    ehContratoDePedido(e.contrato) && typeof e.pedidoId === 'string' && typeof e.recibo === 'string' &&
    ((e.origem === 'telegram' || e.origem === 'native') && typeof e.mensagem === 'string' ||
      e.origem === 'mcp-local' && e.proveniencia === 'ork.mcp-elicitation/v1' && e.source === 'human' &&
      ['mcp-local:codex', 'mcp-local:claude-code'].includes(String(e.autorizadoPor)) &&
      typeof e.conexao === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(e.conexao) &&
      typeof e.solicitacao === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(e.solicitacao) &&
      /^[a-f0-9]{64}$/.test(e.recibo));
}

/**
 * FX2: a PROVA do evento, reconferida no momento em que ela autoriza.
 *
 * Cada canal ja sabia revalidar o proprio recibo durável; ninguem chamava essas funcoes no
 * caminho de `retry` e `ship`. Aqui elas passam a ser chamadas, e o custo e o certo: uma
 * aprovacao com `recibo` adulterado no ledger deixa de autorizar, mesmo com a forma
 * perfeita. As duas funcoes ja recusam por si so evento sem arquivo, sem MAC, com bytes
 * trocados no disco ou com canal trocado no ledger.
 */
export function aprovacaoHumanaProvada(raiz: string, threadId: string, e: EventoLedger): boolean {
  return formaDeAprovacao(e) && reciboHumanoConfere(raiz, threadId, e);
}

/**
 * K3.1: a mesma prova, para qualquer veredito do gate. O dossiê de decisão mostra a resposta do
 * dono só quando o recibo do ingresso confere; aprovar ou recusar não muda o que se reconfere.
 */
export function reciboHumanoConfere(raiz: string, threadId: string, e: EventoLedger): boolean {
  if (e.tipo !== TIPOS_DE_EVENTO.pausaHumana) return false;
  if (e.origem === 'telegram' || e.origem === 'native') return validarEvidenciaDoIngresso(raiz, threadId, e);
  return validarEvidenciaLocal(raiz, threadId, e);
}

/** Aprovacoes humanas ja registradas no ledger da thread, para os gates consultarem. */
export function aprovacoesHumanas(raiz: string, threadId: string): EventoLedger[] {
  return lerLedger(dirThread(raiz, threadId)).filter((e) => aprovacaoHumanaProvada(raiz, threadId, e));
}

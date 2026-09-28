/**
 * I-57 (RM-008, fatia 2): a entrega feita por PR tambem prova entrega para o MASTER.
 *
 * O fluxo de entrega desta fabrica e o PR: CI independente verde no SHA exato, merge com
 * `--match-head-commit` e o assunto `ship(<thread>): ...`. So que o MASTER exigia o `ship_done`
 * do `ork ship`, e a thread entregue por PR ficava aberta para sempre: nao fechava, nao virava
 * licao para o loop de aprendizado, e o board a mostrava como trabalho em curso.
 *
 * Aqui a mesma prova vira `ship_done`, com o que a sustenta de verdade: o merge dentro da base
 * remota (ancestralidade conferida contra a ponta que o `ls-remote` devolve) e o check do CI no
 * head do PR. Sem CI verde, nao registra: merge sem prova independente nao e entrega.
 */
import { consultarCi, ExecutorCi, ResultadoCi } from './ci';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import { dirThread, gravarThread, lerThread, listarIds } from './thread';
import { exec } from './util';

export interface EntregaPorPr {
  thread: string;
  acao: 'registrou' | 'ja-registrada' | 'sem-merge' | 'recusada';
  mergeSha: string | null;
  headSha: string | null;
  ci: ResultadoCi | null;
  motivo: string;
}

/** O merge `ship(<thread>)` mais recente na base remota, com o head do PR (segundo pai). */
export function mergeDaEntrega(raiz: string, thread: string, remoto: string, base: string): { mergeSha: string; headSha: string | null } | null {
  const r = exec('git', ['log', `refs/remotes/${remoto}/${base}`, '--first-parent', '--format=%H%x09%P%x09%s', `--grep=^ship(${thread})`], raiz);
  if (!r.ok) return null;
  for (const linha of r.stdout.split('\n')) {
    const [sha, pais, assunto] = linha.split('\t');
    if (!sha || !assunto || !assunto.startsWith(`ship(${thread})`)) continue;
    const segundo = (pais ?? '').split(' ')[1] ?? null;
    return { mergeSha: sha, headSha: segundo };
  }
  return null;
}

function resultado(thread: string, acao: EntregaPorPr['acao'], motivo: string, extra: Partial<EntregaPorPr> = {}): EntregaPorPr {
  return { thread, acao, motivo, mergeSha: null, headSha: null, ci: null, ...extra };
}

/**
 * `ork ship registrar-pr <thread>`: grava o `ship_done` da entrega feita por PR. Idempotente:
 * a mesma entrega nao e registrada duas vezes.
 */
export function registrarEntregaPorPr(carregado: ManifestoCarregado, threadId: string,
  opcoes: { remoto?: string; executorCi?: ExecutorCi; buscar?: boolean; publicar?: boolean } = {}): EntregaPorPr {
  const raiz = carregado.raiz;
  const remoto = opcoes.remoto ?? 'origin';
  const base = carregado.manifesto.worktree.base_branch;
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada') return resultado(threadId, 'ja-registrada', 'thread ja fechada');
  if (opcoes.buscar !== false) exec('git', ['fetch', '-q', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], raiz);
  const merge = mergeDaEntrega(raiz, threadId, remoto, base);
  if (!merge) return resultado(threadId, 'sem-merge', `nenhum merge ship(${threadId}) em ${remoto}/${base}`);

  const dir = dirThread(raiz, threadId);
  const jaTem = lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido && e.mergeSha === merge.mergeSha);
  if (jaTem) return resultado(threadId, 'ja-registrada', 'esta entrega ja tem ship_done', merge);

  // A ponta do remoto AGORA, e o merge dentro dela: e o que torna o push provado, nao presumido.
  const remotoAgora = exec('git', ['ls-remote', remoto, `refs/heads/${base}`], raiz);
  const ponta = remotoAgora.ok ? remotoAgora.stdout.split('\t')[0].trim() : '';
  if (!ponta || !exec('git', ['merge-base', '--is-ancestor', merge.mergeSha, ponta], raiz).ok) {
    return resultado(threadId, 'recusada', `o merge ${merge.mergeSha.slice(0, 7)} nao esta na ponta de ${remoto}/${base}`, merge);
  }
  const ci = consultarCi(carregado, merge.headSha ?? merge.mergeSha, remoto, opcoes.executorCi);
  if (ci.required && !ci.ok) {
    return resultado(threadId, 'recusada', `sem CI verde no head do PR: ${ci.detail}`, { ...merge, ci });
  }

  registrar(dir, threadId, TIPOS_DE_EVENTO.shipConcluido, {
    de: thread.base?.branch ?? null,
    para: base,
    shaDe: merge.headSha,
    mergeSha: merge.mergeSha,
    jaIncorporado: true,
    remoto,
    shaRemoto: ponta,
    pushVerificado: true,
    fonteDaProva: `git merge-base --is-ancestor ${merge.mergeSha} ${ponta} (ls-remote ${remoto} refs/heads/${base})`,
    autorizadoPor: 'merge de PR com o CI independente verde no SHA exato',
    tipoDeAutorizacao: 'pr',
    modo: thread.modo,
    tag: tagDoModo(thread.modo),
    evidencia: { viaPr: true, ci: { state: ci.state, context: ci.context, url: ci.url, sha: ci.sha } },
  });
  // Como no `ork ship`: a thread chega ao SHIP quando o ciclo dela tem SHIP.
  const atualizada = lerThread(raiz, threadId);
  if (atualizada.fases?.includes('SHIP')) {
    atualizada.faseAtual = 'SHIP';
    gravarThread(raiz, atualizada);
  }
  if (opcoes.publicar !== false) publicarEmSegundoPlano(raiz);
  return resultado(threadId, 'registrou', `ship_done pelo merge ${merge.mergeSha.slice(0, 7)} do PR`, { ...merge, ci });
}

/** `ork ship registrar-pr --todas`: toda thread aberta que ja tem merge `ship(<thread>)` na base. */
export function registrarEntregasPorPr(carregado: ManifestoCarregado, opcoes: { remoto?: string; executorCi?: ExecutorCi } = {}): EntregaPorPr[] {
  const remoto = opcoes.remoto ?? 'origin';
  const base = carregado.manifesto.worktree.base_branch;
  exec('git', ['fetch', '-q', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], carregado.raiz);
  const r = listarIds(carregado.raiz)
    .filter((id) => lerThread(carregado.raiz, id).status !== 'fechada')
    .filter((id) => mergeDaEntrega(carregado.raiz, id, remoto, base) !== null)
    .map((id) => {
      try { return registrarEntregaPorPr(carregado, id, { ...opcoes, buscar: false, publicar: false }); }
      catch (e) { return resultado(id, 'recusada', (e as Error).message); }
    });
  // Uma publicacao so para o lote inteiro, nao uma por thread.
  if (r.some((x) => x.acao === 'registrou')) publicarEmSegundoPlano(carregado.raiz);
  return r;
}

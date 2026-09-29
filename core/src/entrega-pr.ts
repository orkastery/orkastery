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
import { consultarCi, consultarCiDoRepositorio, ExecutorCi, ResultadoCi } from './ci';
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

// ---------------------------------------------------------------------------
// RM-037 (rm037defeito, defeito 5): PR mesclado em repositorio EXTERNO declarado.
// ---------------------------------------------------------------------------

/** O `gh api <caminho>` da entrega externa; os testes injetam as respostas. */
export type ExecutorGitHub = (caminho: string) => { ok: boolean; stdout: string; stderr: string; code: number };
const ghApi: ExecutorGitHub = (caminho) => exec('gh', ['api', caminho, '-H', 'Accept: application/vnd.github+json'], process.cwd(), 120000);

function lerJson<T>(r: ReturnType<ExecutorGitHub>): T | null {
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout) as T; } catch { return null; }
}

export interface OpcoesDaEntregaExterna {
  /** `dono/nome` declarado em `ci.external_repositories`. */
  repositorio: string;
  pr: number;
  executorGitHub?: ExecutorGitHub;
  executorCi?: ExecutorCi;
  publicar?: boolean;
}

/**
 * `ork ship registrar-pr <thread> --repo <dono/nome> --pr <n>`: a thread que entrega por PR em outro
 * repositorio (os sites, por exemplo) nao tinha como virar `ship_done`, e a entrega virava decisao. A
 * exigencia e a mesma do caminho local: o merge dentro da ponta da base (pela API do GitHub, porque o
 * repositorio nao e remoto deste checkout) e o check declarado verde no head do PR. O repositorio precisa
 * estar declarado no manifesto; e o dono que diz onde, e com que check, a entrega vale. Idempotente.
 */
export function registrarEntregaExternaPorPr(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDaEntregaExterna): EntregaPorPr {
  const raiz = carregado.raiz, repo = opcoes.repositorio, n = opcoes.pr;
  const gh = opcoes.executorGitHub ?? ghApi;
  const declarados = carregado.manifesto.ci.external_repositories;
  if (!Object.hasOwn(declarados, repo)) {
    return resultado(threadId, 'recusada', `o repositorio ${repo} nao esta declarado em ci.external_repositories do orkastery.yaml`);
  }
  if (!Number.isSafeInteger(n) || n < 1) return resultado(threadId, 'recusada', `--pr precisa ser o numero do PR, recebido ${String(n)}`);
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada') return resultado(threadId, 'ja-registrada', 'thread ja fechada');
  const dir = dirThread(raiz, threadId);
  if (lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido && e.repositorio === repo && e.pr === n)) {
    return resultado(threadId, 'ja-registrada', `o PR #${n} de ${repo} ja tem ship_done`);
  }

  const pr = lerJson<{ merged?: boolean; merge_commit_sha?: string | null; html_url?: string; base?: { ref?: string }; head?: { sha?: string } }>(
    gh(`repos/${repo}/pulls/${n}`));
  if (!pr) return resultado(threadId, 'recusada', `a consulta do PR #${n} de ${repo} ao GitHub falhou`);
  const mergeSha = typeof pr.merge_commit_sha === 'string' && /^[0-9a-f]{40}$/.test(pr.merge_commit_sha) ? pr.merge_commit_sha : null;
  const headSha = typeof pr.head?.sha === 'string' && /^[0-9a-f]{40}$/.test(pr.head.sha) ? pr.head.sha : null;
  const base = typeof pr.base?.ref === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(pr.base.ref) ? pr.base.ref : null;
  if (pr.merged !== true || !mergeSha || !headSha || !base) {
    return resultado(threadId, 'sem-merge', `o PR #${n} de ${repo} nao esta mesclado`);
  }

  // A ponta da base AGORA, e o merge dentro dela: o push provado, pela mesma pergunta do ls-remote.
  const ramo = lerJson<{ commit?: { sha?: string } }>(gh(`repos/${repo}/branches/${encodeURIComponent(base)}`));
  const ponta = typeof ramo?.commit?.sha === 'string' && /^[0-9a-f]{40}$/.test(ramo.commit.sha) ? ramo.commit.sha : '';
  const comparacao = ponta ? lerJson<{ status?: string }>(gh(`repos/${repo}/compare/${mergeSha}...${ponta}`)) : null;
  if (!ponta || !comparacao || !['ahead', 'identical'].includes(String(comparacao.status))) {
    return resultado(threadId, 'recusada', `o merge ${mergeSha.slice(0, 7)} nao esta na ponta de ${repo}:${base}`, { mergeSha, headSha });
  }

  const check = declarados[repo];
  const ci = check ? consultarCiDoRepositorio(repo, headSha, check, opcoes.executorCi) : null;
  if (ci && !ci.ok) {
    return resultado(threadId, 'recusada', `sem CI verde no head do PR: ${ci.detail}`, { mergeSha, headSha, ci });
  }

  registrar(dir, threadId, TIPOS_DE_EVENTO.shipConcluido, {
    de: thread.base?.branch ?? null,
    para: `${repo}:${base}`,
    repositorio: repo,
    pr: n,
    url: pr.html_url ?? `https://github.com/${repo}/pull/${n}`,
    shaDe: headSha,
    mergeSha,
    jaIncorporado: true,
    remoto: `github:${repo}`,
    shaRemoto: ponta,
    pushVerificado: true,
    fonteDaProva: `gh api repos/${repo}/compare/${mergeSha}...${ponta} (status ${String(comparacao.status)}; ponta de ${base} por gh api repos/${repo}/branches/${base})`,
    autorizadoPor: ci ? 'merge de PR com o CI independente verde no SHA exato' : 'merge de PR em repositorio externo declarado sem CI no manifesto',
    tipoDeAutorizacao: 'pr-externo',
    modo: thread.modo,
    tag: tagDoModo(thread.modo),
    evidencia: { viaPr: true, externo: true, ciExigido: !!ci, ci: ci ? { state: ci.state, context: ci.context, url: ci.url, sha: ci.sha } : null },
  });
  const atualizada = lerThread(raiz, threadId);
  if (atualizada.fases?.includes('SHIP')) {
    atualizada.faseAtual = 'SHIP';
    gravarThread(raiz, atualizada);
  }
  if (opcoes.publicar !== false) publicarEmSegundoPlano(raiz);
  return resultado(threadId, 'registrou', `ship_done pelo merge ${mergeSha.slice(0, 7)} do PR #${n} de ${repo}`, { mergeSha, headSha, ci });
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

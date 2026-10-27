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
import { exigirRemoto } from './branch-de-estado';
import { produtoresAceitos } from './forja/produtor';
import { ciNaoExigida, consultarCi, consultarCiDoRepositorio, consultarCiNaForja, ExecutorCi, ResultadoCi } from './ci';
import { chamadorDaApi, OpcoesDaApi } from './forja/api';
import { hostDaApi } from './forja/cli';
import type { ErroDaForja, ForjaResolvida } from './forja/contrato';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { projetoNaApi } from './forja/gitlab/pedidos';
import { dirDoCacheDaForja } from './forja/cache';
import { resolverForja, SONDAS_PADRAO, SondasDaForja } from './forja/resolver';
import { DocPendente, docsPendentesDoMerge } from './docs';
import { publicarEmSegundoPlano } from './fabrica-publicar';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import { ArcosDaRaiz, guardaDaThread, lerArcosDaRaiz, MotivoDaGuarda } from './noctum-guarda';
import { dirThread, gravarThread, lerThread, listarIds } from './thread';
import { exec } from './util';
import { rodarCli } from './forja/executor';
import { adaptadorDaForja, exigirCapacidade } from './forja/registro';
import { ErroDoCatalogo, remontar, textoDoCatalogo } from './locale';
import { mergesDasEntregasNaBase } from './merge-da-entrega';
import { branchDaWorktree } from './worktree';

export interface EntregaPorPr {
  thread: string;
  /**
   * RM-037 (fatia 3, defeito 6): `registraria` e o ensaio (`--dry-run`) que passou em tudo e nada gravou. RM-058, integracao
   * (T1.1): `pulada` e a thread de um arco #Noctum que o `--todas` deixa para o passo da entrega do arco.
   */
  acao: 'registrou' | 'registraria' | 'ja-registrada' | 'sem-merge' | 'recusada' | 'pulada';
  mergeSha: string | null;
  headSha: string | null;
  ci: ResultadoCi | null;
  motivo: string;
  /** O porque estavel das recusas de entrega sem prova (so nelas) e da guarda das threads do arco #Noctum (RM-058). */
  codigo?: 'entrega.sem-vinculo' | 'entrega.sem-leitura' | 'entrega.sem-head' | 'entrega.forja-mista' | MotivoDaGuarda;
  /**
   * RM-044 (A3): as paginas do roadmap desta thread que o push da base vai reprovar em
   * `docs.paridade.merge` (merge ship(<thread>) na base com o `estado.codigo` fora de `Mesclado`).
   * So aviso: nao grava, nao bloqueia o registro e nao muda o veredito do `docs verificar`.
   */
  docsPendentes: DocPendente[];
}

/** O merge da entrega mais recente na base remota, com o head do PR (segundo pai). */
export function mergeDaEntrega(raiz: string, thread: string, remoto: string, base: string): { mergeSha: string; headSha: string | null } | null {
  let branch: string;
  try { branch = branchDaWorktree(lerThread(raiz, thread)); } catch { return null; }
  const merge = mergesDasEntregasNaBase(raiz, `refs/remotes/${remoto}/${base}`, base, [{ thread, branch }]).get(thread)?.[0];
  return merge ? { mergeSha: merge.mergeSha, headSha: merge.headSha } : null;
}

/**
 * A thread chega ao SHIP quando o ciclo dela tem SHIP, e so AVANCA: o segundo PR da mesma entrega (os
 * dois sites da ork-siteshomesco, por exemplo) com a thread ja no MASTER nao a devolve ao SHIP (achado S9).
 */
function avancarParaShip(raiz: string, threadId: string): void {
  const atualizada = lerThread(raiz, threadId);
  const fases = atualizada.fases ?? [];
  if (!fases.includes('SHIP') || fases.indexOf(atualizada.faseAtual) >= fases.indexOf('SHIP')) return;
  atualizada.faseAtual = 'SHIP';
  gravarThread(raiz, atualizada);
}

/** O endereco do remoto, de UM parse da URL; `null` quando o remoto nao existe ou nao tem host de forja. */
export function enderecoDoRemotoDaRaiz(raiz: string, remoto: string) {
  // Git local sem rede escondida nem pergunta de credencial no terminal.
  const url = exec('git', ['remote', 'get-url', '--', remoto], raiz, 60000, { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
  return url.ok ? lerEnderecoDoRemoto(url.stdout.trim()) : null;
}

/**
 * A forja do remoto, de UM parse da URL e do resolver (o bloco `forja:`, o host conhecido ou a sondagem pela CLI com
 * login no host): o nome do host nao decide o tipo. `erro` nulo: o remoto nao existe, nao tem host de forja (caminho
 * local) ou aponta um caminho que a forja dele nao tem (subgrupo no GitHub).
 */
export function forjaDaEntrega(carregado: ManifestoCarregado, remoto: string, sondas: SondasDaForja = SONDAS_PADRAO):
  { ok: true; valor: ForjaResolvida } | { ok: false; erro: ErroDaForja | null } {
  const endereco = enderecoDoRemotoDaRaiz(carregado.raiz, remoto);
  if (!endereco) return { ok: false, erro: null };
  const r = resolverForja({ endereco, manifesto: carregado.manifesto.forja, sondas, cache: dirDoCacheDaForja(carregado.raiz) });
  if (!r.ok) return { ok: false, erro: r.erro };
  if (r.valor.tipo === 'github' && r.valor.repo.split('/').length !== 2) return { ok: false, erro: null };
  return { ok: true, valor: r.valor };
}

function resultado(thread: string, acao: EntregaPorPr['acao'], motivo: string, extra: Partial<EntregaPorPr> = {}): EntregaPorPr {
  return { thread, acao, motivo, mergeSha: null, headSha: null, ci: null, docsPendentes: [], ...extra };
}

/**
 * `ork ship registrar-pr <thread>`: grava o `ship_done` da entrega feita por PR. Idempotente:
 * a mesma entrega nao e registrada duas vezes.
 */
export function registrarEntregaPorPr(carregado: ManifestoCarregado, threadId: string,
  opcoes: { remoto?: string; executorCi?: ExecutorCi; buscar?: boolean; publicar?: boolean; dryRun?: boolean;
    /** RM-058, integracao: os arcos ja lidos pelo `--todas`; nunca vem da CLI. */
    arcos?: ArcosDaRaiz } = {}): EntregaPorPr {
  const raiz = carregado.raiz;
  // RM-047: o `--remoto` vem da linha de comando; so nome de remoto chega ao git, e depois do `--`.
  const remoto = exigirRemoto(opcoes.remoto ?? 'origin', 'ship');
  const base = carregado.manifesto.worktree.base_branch;
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada') return resultado(threadId, 'ja-registrada', textoDoCatalogo((m) => m.ship.prThreadFechada));
  // RM-058, integracao (T1.1, D3 da ork-rm058integra): a entrega da thread de um arco #Noctum e do passo da entrega dele,
  // com as provas dele; antes de qualquer git, e sem ledger.
  const guarda = guardaDaThread(raiz, threadId, opcoes.arcos?.quando, { arcos: opcoes.arcos });
  if (guarda) return resultado(threadId, 'recusada', guarda.texto, { codigo: guarda.motivo });
  if (opcoes.buscar !== false) {
    const busca = exec('git', ['fetch', '-q', '--', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], raiz);
    if (!busca.ok) {
      return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prSemLeitura(remoto, base)), { codigo: 'entrega.sem-leitura' });
    }
  }
  const encontrado = mergeDaEntrega(raiz, threadId, remoto, base);
  if (!encontrado) return resultado(threadId, 'sem-merge', textoDoCatalogo((m) => m.ship.prSemMerge(threadId, remoto, base)));
  // Squash ou rebase: sem segundo pai o merge nao se liga ao head que a CI verificou. Com a CI exigida, a CI do commit
  // da base nao prova o head, e a entrega e recusada antes de qualquer consulta. Sem CI exigida, registra como sempre.
  const exigeCi = carregado.manifesto.ci.required_for_ship;
  if (encontrado.headSha === null && exigeCi) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prSemVinculo(threadId, encontrado.mergeSha.slice(0, 7))),
      { mergeSha: encontrado.mergeSha, codigo: 'entrega.sem-vinculo' });
  }
  // RM-044 (A3): o condutor roda o registrar-pr logo depois do merge; e aqui que ele fica sabendo da pagina que
  // vai deixar o push da base vermelho, lida da base remota que o fetch acabou de trazer.
  const merge = { ...encontrado, docsPendentes: docsPendentesDoMerge(raiz, threadId, `refs/remotes/${remoto}/${base}`) };

  const dir = dirThread(raiz, threadId);
  const jaTem = lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido && e.mergeSha === merge.mergeSha);
  if (jaTem) return resultado(threadId, 'ja-registrada', textoDoCatalogo((m) => m.ship.prJaTemShipDone), merge);

  // A ponta do remoto AGORA, e o merge dentro dela: e o que torna o push provado, nao presumido.
  const remotoAgora = exec('git', ['ls-remote', '--', remoto, `refs/heads/${base}`], raiz);
  const ponta = remotoAgora.ok ? remotoAgora.stdout.split('\t')[0].trim() : '';
  if (!ponta || !exec('git', ['merge-base', '--is-ancestor', merge.mergeSha, ponta], raiz).ok) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prForaDaPonta(merge.mergeSha.slice(0, 7), remoto, base)), merge);
  }
  // A CI so e consultada no head do PR; sem head (squash ou rebase), so chega aqui sem CI exigida, e nada e consultado.
  const ci = encontrado.headSha !== null
    ? consultarCi(carregado, encontrado.headSha, remoto, opcoes.executorCi)
    : ciNaoExigida(carregado, encontrado.mergeSha);
  if (ci.required && !ci.ok) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prSemCiVerde(remontar(ci.detail))), { ...merge, ci });
  }
  // RM-037 (fatia 3, defeito 6): o ensaio confere tudo e para aqui, sem ledger, fase nem fabrica.
  if (opcoes.dryRun) {
    return resultado(threadId, 'registraria', textoDoCatalogo((m) => m.ship.prRegistraria(merge.mergeSha.slice(0, 7))), { ...merge, ci });
  }

  registrar(dir, threadId, TIPOS_DE_EVENTO.shipConcluido, {
    de: thread.base?.branch ?? null,
    para: base,
    shaDe: merge.headSha,
    mergeSha: merge.mergeSha,
    // RM-037 (fatia 5, A1): a ponta que o ls-remote provou vai em campo proprio; o recibo do Maestro confere o push
    // contra ela quando a base andou depois do merge.
    pontaDaBase: ponta,
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
  avancarParaShip(raiz, threadId);
  if (opcoes.publicar !== false) publicarEmSegundoPlano(raiz);
  return resultado(threadId, 'registrou', textoDoCatalogo((m) => m.ship.prRegistrou(merge.mergeSha.slice(0, 7))), { ...merge, ci });
}

// ---------------------------------------------------------------------------
// RM-037 (rm037defeito, defeito 5): PR mesclado em repositorio EXTERNO declarado.
// ---------------------------------------------------------------------------

/** O `gh api <caminho>` da entrega externa; os testes injetam as respostas. */
export type ExecutorGitHub = (caminho: string) => { ok: boolean; stdout: string; stderr: string; code: number };
const ghApi: ExecutorGitHub = (caminho) => {
  const r = rodarCli({ cmd: 'gh', args: ['api', '--hostname', 'github.com', caminho, '-H', 'Accept: application/vnd.github+json'], prazoMs: 120000,
    maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
};

export interface OpcoesDaEntregaExterna {
  /** `dono/nome` (GitHub) ou `grupo/subgrupo/projeto` (GitLab) declarado em `ci.external_repositories`. */
  repositorio: string;
  pr: number;
  executorGitHub?: ExecutorGitHub;
  executorCi?: ExecutorCi;
  publicar?: boolean;
  /** RM-037 (fatia 3, defeito 6): ensaio, sem gravar nada. */
  dryRun?: boolean;
  /** O remoto do projeto, de onde vem a forja do repositorio externo; padrao 'origin'. */
  remoto?: string;
  sondas?: SondasDaForja;
  /** A forja do projeto; os testes a fixam. Nunca vem da CLI. */
  forja?: ForjaResolvida;
  api?: OpcoesDaApi;
  /** A CI do repositorio externo no GitLab; padrao: `consultarCiNaForja`. Nunca vem da CLI. */
  ciDaForja?: (f: ForjaResolvida, sha: string, contexto: string) => ResultadoCi;
}

/**
 * A forja do repositorio externo: a do projeto quando ela e um GitLab (o mesmo host, a mesma porta, o mesmo caminho
 * base, outro projeto); o github.com quando a forja do projeto e o GitHub ou quando o projeto nao tem remoto de forja
 * (sem remoto ou caminho local), como sempre. Nao ha host de reserva: o remoto que nomeia um host de forja que nao se
 * resolve, e o projeto que declara `forja.tipo: gitlab` sem a forja resolvida, nunca caem no github.com.
 */
function forjaDoExterno(carregado: ManifestoCarregado, repo: string, opcoes: OpcoesDaEntregaExterna):
  { ok: true; gitlab: ForjaResolvida | null } | { ok: false; erro: ErroDaForja; remoto: string; declarada: boolean } {
  const remoto = opcoes.remoto ?? 'origin';
  const doProjeto = opcoes.forja ? { ok: true as const, valor: opcoes.forja } : forjaDaEntrega(carregado, exigirRemoto(remoto, 'ship'), opcoes.sondas);
  if (doProjeto.ok && doProjeto.valor.tipo === 'gitlab') return { ok: true, gitlab: { ...doProjeto.valor, repo } };
  if (carregado.manifesto.forja?.tipo === 'gitlab') {
    return { ok: false, remoto, declarada: true,
      erro: !doProjeto.ok && doProjeto.erro ? doProjeto.erro : { codigo: 'forja.desconhecida', detalhe: remoto } };
  }
  if (!doProjeto.ok && doProjeto.erro) return { ok: false, erro: doProjeto.erro, remoto, declarada: false };
  return { ok: true, gitlab: null };
}

/**
 * `ork ship registrar-pr <thread> --repo <dono/nome> --pr <n>`: a thread que entrega por PR em outro
 * repositorio (os sites, por exemplo) nao tinha como virar `ship_done`, e a entrega virava decisao. A
 * exigencia e a mesma do caminho local: o merge dentro da ponta da base (pela API da forja do repositorio, o GitHub
 * ou o GitLab do projeto, porque o repositorio nao e remoto deste checkout) e o check declarado verde no head do PR.
 * O repositorio precisa estar declarado no manifesto; e o dono que diz onde, e com que check, a entrega vale.
 * Idempotente.
 */
export function registrarEntregaExternaPorPr(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDaEntregaExterna): EntregaPorPr {
  const raiz = carregado.raiz, repo = opcoes.repositorio, n = opcoes.pr;
  const gh = opcoes.executorGitHub ?? ghApi;
  const declarados = carregado.manifesto.ci.external_repositories;
  if (!Object.hasOwn(declarados, repo)) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prRepoNaoDeclarado(repo)));
  }
  if (!Number.isSafeInteger(n) || n < 1) return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prNumeroInvalido(String(n))));
  const thread = lerThread(raiz, threadId);
  if (thread.status === 'fechada') return resultado(threadId, 'ja-registrada', textoDoCatalogo((m) => m.ship.prThreadFechada));
  // RM-058, integracao (T1.1): a mesma guarda do PR local, antes de consultar a forja.
  const guarda = guardaDaThread(raiz, threadId);
  if (guarda) return resultado(threadId, 'recusada', guarda.texto, { codigo: guarda.motivo });
  const dir = dirThread(raiz, threadId);
  if (lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido && e.repositorio === repo && e.pr === n)) {
    return resultado(threadId, 'ja-registrada', textoDoCatalogo((m) => m.ship.prExternoJaTem(n, repo)));
  }

  const daForja = forjaDoExterno(carregado, repo, opcoes);
  if (!daForja.ok) {
    const { erro, remoto, declarada } = daForja;
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => declarada ? m.ship.prForjaDoExterno(repo, m.forja.motivo(erro, 'gitlab'))
      : m.ship.prForjaDoProjetoNaoResolvida(repo, remoto, m.forja.motivo(erro, null))), { codigo: 'entrega.sem-leitura' });
  }
  const gitlab = daForja.gitlab;
  // O GitHub so tem dono/nome: o caminho com subgrupo e recusado antes de qualquer consulta.
  if (!gitlab && repo.split('/').length !== 2) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prRepoComSubgrupoNoGithub(repo)), { codigo: 'entrega.forja-mista' });
  }
  const nomeDaForja = gitlab ? 'GitLab' : undefined;
  const forja = adaptadorDaForja(gitlab ? 'gitlab' : 'github');
  const api = gitlab ? chamadorDaApi(gitlab, opcoes.api ?? {}) : undefined;
  const pr = exigirCapacidade(forja, 'pedidoMesclado')({ repo, numero: n, executor: gh, api });
  if (!pr) return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prConsultaFalhou(n, repo, nomeDaForja)));
  const { mergeSha, headSha, base } = pr;
  if (pr.mesclado && mergeSha && base && !headSha) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prSemHead(n, repo, nomeDaForja)), { mergeSha, codigo: 'entrega.sem-head' });
  }
  if (!pr.mesclado || !mergeSha || !headSha || !base) {
    return resultado(threadId, 'sem-merge', textoDoCatalogo((m) => m.ship.prNaoMesclado(n, repo, !!gitlab)));
  }
  // Achado A4 do CHECK: o PR precisa ser DESTA thread e ter entrado na branch padrao do repositorio. Sem o
  // vinculo, qualquer PR mesclado do repositorio viraria entrega de qualquer thread; sem a base, um PR
  // empilhado numa branch de feature contaria como entrega.
  const vinculo = [pr.titulo, pr.corpo, pr.branch].filter((x): x is string => typeof x === 'string')
    // N4 do CHECK 2: a branch do proprio ork e `ork/<thread>-<variante>`, entao o hifen depois do id vale;
    // letra ou digito colado nao (outro id). Sem diferenciar maiusculas.
    .some((x) => new RegExp(`(^|[^a-z0-9-])${threadId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(x));
  if (!vinculo) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prNaoCitaThread(n, repo, threadId, !!gitlab)), { mergeSha, headSha });
  }
  const branchPadrao = exigirCapacidade(forja, 'branchPadrao')({ repo, executor: gh, api });
  if (branchPadrao === null) return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prRepoFalhou(repo, nomeDaForja)), { mergeSha, headSha });
  if (branchPadrao !== base) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prOutraBase(n, base, repo, branchPadrao || undefined, !!gitlab)),
      { mergeSha, headSha });
  }

  // A ponta da base AGORA, e o merge dentro dela: o push provado, pela mesma pergunta do ls-remote.
  const ponta = exigirCapacidade(forja, 'pontaDaBranch')({ repo, branch: base, executor: gh, api }) ?? '';
  const comparacao = ponta ? exigirCapacidade(forja, 'comparar')({ repo, de: mergeSha, ate: ponta, executor: gh, api }) : null;
  if (!ponta || comparacao === null || !['ahead', 'identical'].includes(comparacao)) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prExternoForaDaPonta(mergeSha.slice(0, 7), repo, base)), { mergeSha, headSha });
  }

  const check = declarados[repo];
  const ciDaForja = opcoes.ciDaForja ?? ((f: ForjaResolvida, sha: string, contexto: string) =>
    consultarCiNaForja(f, sha, contexto, produtoresAceitos(carregado.manifesto, 'gitlab'), { api: opcoes.api }));
  const ci = !check ? null : gitlab ? ciDaForja(gitlab, headSha, check)
    : consultarCiDoRepositorio(repo, headSha, check, opcoes.executorCi, 'github.com', produtoresAceitos(carregado.manifesto, 'github'));
  if (ci && !ci.ok) {
    return resultado(threadId, 'recusada', textoDoCatalogo((m) => m.ship.prSemCiVerde(remontar(ci.detail))), { mergeSha, headSha, ci });
  }
  if (opcoes.dryRun) {
    return resultado(threadId, 'registraria', textoDoCatalogo((m) => m.ship.prExternoRegistraria(mergeSha.slice(0, 7), n, repo, !!gitlab)),
      { mergeSha, headSha, ci });
  }

  registrar(dir, threadId, TIPOS_DE_EVENTO.shipConcluido, {
    de: thread.base?.branch ?? null,
    para: `${repo}:${base}`,
    repositorio: repo,
    pr: n,
    url: pr.url ?? (gitlab ? `https://${hostDaApi(gitlab)}${gitlab.caminhoBase}/${repo}/-/merge_requests/${n}` : `https://github.com/${repo}/pull/${n}`),
    shaDe: headSha,
    mergeSha,
    // RM-037 (fatia 5, A1; aviso da rodada 1 do CHECK): a ponta conferida vai em campo proprio, como no PR local; a
    // comparacao aceita `ahead`, e o recibo do Maestro confere o push contra ela.
    pontaDaBase: ponta,
    jaIncorporado: true,
    remoto: `${gitlab ? 'gitlab' : 'github'}:${repo}`,
    shaRemoto: ponta,
    pushVerificado: true,
    // `identical`: o merge e a propria ponta, e a comparacao nem e consultada.
    fonteDaProva: gitlab && comparacao === 'identical'
      ? `merge = ponta de ${base} por glab api ${projetoNaApi(repo)}/repository/branches/${encodeURIComponent(base)}`
      : gitlab
      ? `glab api ${projetoNaApi(repo)}/repository/compare?from=${ponta}&to=${mergeSha}&straight=false (status ${comparacao}; ponta de ${base} por glab api ${projetoNaApi(repo)}/repository/branches/${encodeURIComponent(base)})`
      : `gh api repos/${repo}/compare/${mergeSha}...${ponta} (status ${comparacao}; ponta de ${base} por gh api repos/${repo}/branches/${base})`,
    autorizadoPor: ci ? 'merge de PR com o CI independente verde no SHA exato' : 'merge de PR em repositorio externo declarado sem CI no manifesto',
    tipoDeAutorizacao: 'pr-externo',
    modo: thread.modo,
    tag: tagDoModo(thread.modo),
    evidencia: { viaPr: true, externo: true, ciExigido: !!ci, ci: ci ? { state: ci.state, context: ci.context, url: ci.url, sha: ci.sha } : null },
  });
  avancarParaShip(raiz, threadId);
  if (opcoes.publicar !== false) publicarEmSegundoPlano(raiz);
  return resultado(threadId, 'registrou', textoDoCatalogo((m) => m.ship.prExternoRegistrou(mergeSha.slice(0, 7), n, repo, !!gitlab)), { mergeSha, headSha, ci });
}

/** `ork ship registrar-pr --todas`: toda thread aberta que ja tem merge `ship(<thread>)` na base. */
export function registrarEntregasPorPr(carregado: ManifestoCarregado,
  opcoes: { remoto?: string; executorCi?: ExecutorCi; dryRun?: boolean } = {}): EntregaPorPr[] {
  const remoto = exigirRemoto(opcoes.remoto ?? 'origin', 'ship');
  const base = carregado.manifesto.worktree.base_branch;
  const busca = exec('git', ['fetch', '-q', '--', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], carregado.raiz);
  const abertas = listarIds(carregado.raiz).filter((id) => lerThread(carregado.raiz, id).status !== 'fechada');
  // Sem leitura do remoto nao ha como saber quais threads tem merge: uma recusa por thread aberta, nunca lista vazia.
  if (!busca.ok) {
    return abertas.map((id) => resultado(id, 'recusada', textoDoCatalogo((m) => m.ship.prSemLeitura(remoto, base)), { codigo: 'entrega.sem-leitura' }));
  }
  // RM-058, integracao (T1.1): os arcos lidos uma vez para o lote; a thread do arco e pulada com o motivo, e as outras seguem.
  const arcos = lerArcosDaRaiz(carregado.raiz);
  const r = abertas
    .filter((id) => mergeDaEntrega(carregado.raiz, id, remoto, base) !== null)
    .map((id) => {
      try {
        const guarda = guardaDaThread(carregado.raiz, id, arcos.quando, { arcos });
        if (guarda) return resultado(id, 'pulada', guarda.texto, { codigo: guarda.motivo });
        return registrarEntregaPorPr(carregado, id, { ...opcoes, buscar: false, publicar: false, arcos });
      }
      catch (e) { return resultado(id, 'recusada', e instanceof ErroDoCatalogo ? textoDoCatalogo(e.montar) : (e as Error).message); }
    });
  // Uma publicacao so para o lote inteiro, nao uma por thread.
  if (r.some((x) => x.acao === 'registrou')) publicarEmSegundoPlano(carregado.raiz);
  return r;
}

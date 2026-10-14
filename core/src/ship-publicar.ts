/**
 * RM-059 (fatia F7, T7.1; DD4 do plano dos mods): a publicacao provada da branch e do PR, e a pista da entrega.
 *
 * Ate aqui, quem publicava a branch de uma thread #Auto e abria o PR era o script do condutor externo, fora do
 * nucleo e sem prova pelo remoto. O `ork ship publicar` faz o mesmo pelo nucleo, e so no modo que ja autoriza o
 * push pela #TAG (#Auto e #Maestro, a mesma lista do `ork ship`):
 *
 *  1. confere, antes de qualquer efeito, a thread, o modo, a conducao, a branch, o CHECK, o verify e o bundle no
 *     HEAD, o remoto, a ponta da branch nele e os PRs da branch; a recusa volta tipada e nada vai ao ledger (D2 da
 *     thread ork-rm059pista);
 *  2. empurra sem forca o sha conferido, e nao a ref, com refspec explicito, e prova pelo `git ls-remote` (a prova do
 *     `ork ship`);
 *  3. reaproveita o PR (MR no GitLab) aberto da branch ou abre um com o texto do `pr-body.md` da thread, e prova pela releitura da
 *     lista;
 *  4. grava `ship_published` com a prova, so quando houve efeito; o push sem prova tambem vai. Repetido, ou com o PR
 *     ja mesclado no HEAD, devolve `ja-publicada`.
 *
 * A pista (`ork ship pista`) e a leitura que a Pista de Entrega do Claude Code desenha: por thread aberta que ja
 * esta na entrega, as etapas do CHECK ao `ship_done` e o proximo passo que o nucleo declara disponivel. Ela nao
 * grava nada: uma leitura do remoto (`git ls-remote --heads`) e uma da forja (`lerPrsDaForja`) por chamada.
 *
 * Merge, tag e promocao de site continuam fora daqui: o merge e do dono ou do condutor, e o `ship_done` do PR e do
 * `ork ship registrar-pr`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { branchValida, exigirRemoto } from './branch-de-estado';
import { BundleCi, comandosDoBundle } from './ci';
import { chamadorDaApi, OpcoesDaApi } from './forja/api';
import { hostDaApi } from './forja/cli';
import type { ErroDaForja, ForjaResolvida, TipoDeForja } from './forja/contrato';
import { lerEnderecoDoRemoto } from './forja/endereco';
import { projetoNaApi } from './forja/gitlab/pedidos';
import { adaptadorDaForja, exigirCapacidade } from './forja/registro';
import { hostConhecido, resolverForja, SONDAS_PADRAO, SondasDaForja } from './forja/resolver';
import { deFora, umaLinha } from './forja/texto';
import { lerClaims } from './claims';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { comandosDoTextoDoManifesto, ManifestoCarregado, NOME_MANIFESTO, NOME_MANIFESTO_LEGADO } from './manifest';
import { tagDoModo } from './modos';
import {
  conducaoAgora, ExecutorDoGh, ghPadrao, LIMITE_DE_PRS, lerPrsDaForja, PrDaForja, refsLocais,
} from './parado-no-condutor';
import { mergeDaEntrega } from './entrega-pr';
import { MODOS_QUE_AUTORIZAM_PUSH } from './ship';
import { estadoDoArtefato, vereditoDoParecer } from './session-watcher-claude';
import { dirThread, lerThread, listarIds } from './thread';
import { Claim, ConducaoAtual, EventoLedger, MotivoGate, Thread } from './types';
import { exec, ResultadoExec } from './util';
import { comandosDoManifesto } from './verify';
import { branchDaWorktree } from './worktree';
import { Mensagens, msg, remontar, textoDoCatalogo } from './locale';

export const CONTRATO_DA_PUBLICACAO = 'ork.ship-publicar/v1' as const;
export const CONTRATO_DA_PISTA = 'ork.ship-pista/v1' as const;

/** Os modos em que a #TAG ja autoriza o push: a mesma lista do `ork ship` (`autorizacaoDePush`); o `publicar` so age neles. */
export const MODOS_QUE_PUBLICAM: readonly Thread['modo'][] = MODOS_QUE_AUTORIZAM_PUSH;

const SHA = /^[0-9a-f]{40}$/;
/** O `pr-body.md` maior que isto nao e corpo de PR: o `publicar` usa o corpo padrao. */
const TETO_DO_CORPO = 64 * 1024;
/**
 * Prazos de cada chamada de rede. No pior caso, ls-remote, lista de PRs, push, ls-remote, criacao e releitura somam
 * 435 s, abaixo dos 10 min que o motor do Claude Code da a um processo de mod (a Pista espera 9 min pelo publicar).
 */
const PRAZO_DO_GH_MS = 45000;
const PRAZO_DO_PUSH_MS = 180000;
const PRAZO_DO_LS_REMOTE_MS = 60000;

/** Git local sem rede escondida nem pergunta de credencial no terminal. */
function git(raiz: string, args: string[], prazoMs = 60000) {
  return exec('git', args, raiz, prazoMs, { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
}

const curto = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : '-');

// ---------------------------------------------------------------------------
// As etapas e os fatos de uma thread.
// ---------------------------------------------------------------------------

export type IdDaEtapa = 'check' | 'verify' | 'bundle' | 'branch' | 'pr' | 'ci' | 'conflito' | 'entrega';
export type EstadoDaEtapa = 'feita' | 'pendente' | 'falhou' | 'nao-lida' | 'nao-se-aplica';
export const ETAPAS: readonly IdDaEtapa[] = ['check', 'verify', 'bundle', 'branch', 'pr', 'ci', 'conflito', 'entrega'];

export interface EtapaDaPista {
  id: IdDaEtapa;
  estado: EstadoDaEtapa;
  texto: string;
}

const etapa = (id: IdDaEtapa, estado: EstadoDaEtapa, texto: string): EtapaDaPista => ({ id, estado, texto });

/** O que o nucleo le da thread sem rede: a branch, o CHECK, o verify, o bundle e quem conduz. */
interface FatosDaThread {
  t: Thread;
  eventos: EventoLedger[];
  branch: string;
  head: string | null;
  comProduto: boolean;
  conducao: ConducaoAtual | null;
  check: EtapaDaPista;
  /** O `docs/check.md` tem o veredito PASSOU, novo ou velho: a thread ja passou do CHECK uma vez. */
  checkPassou: boolean;
  verify: EtapaDaPista;
  bundle: EtapaDaPista;
}

/** Os caminhos mudados so cabem no bundle (`.ork-ci/`)? Lista vazia tambem nao e produto. */
function soOBundle(caminhos: string): boolean {
  return caminhos.split('\n').map((l) => l.trim()).filter(Boolean).every((l) => l.startsWith('.ork-ci/'));
}

/**
 * O ultimo commit de produto da branch, com a hora do commit. Merge nao conta, nem o commit que so mexe em `.ork-ci/`
 * (o bundle): decide o conteudo do commit, e nao o assunto, porque `ci(` tambem e o tipo de commit de workflow.
 */
function ultimoCommitDeProduto(raiz: string, baseRef: string | null, head: string): { sha: string; em: number } | null {
  const r = git(raiz, ['log', '--no-merges', '--format=%H%x09%ct', baseRef ? `${baseRef}..${head}` : head, '-n', '200']);
  if (!r.ok) return null;
  for (const linha of r.stdout.split('\n')) {
    const [sha, ct] = linha.split('\t');
    if (!sha || !SHA.test(sha)) continue;
    const mudou = git(raiz, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha]);
    if (mudou.ok && soOBundle(mudou.stdout)) continue;
    const em = Number(ct) * 1000;
    if (Number.isFinite(em)) return { sha, em };
  }
  return null;
}

/**
 * O CHECK: exatamente um veredito, PASSOU, gravado depois do ultimo commit de produto. RM-063 (F7): a batida da conducao
 * tambem o le antes do merge do PR, para nada entrar na base sem ter passado pelo CHECK.
 */
export function conferirCheck(raiz: string, t: Thread, baseRef: string | null, head: string | null): { etapa: EtapaDaPista; passou: boolean } {
  if (!(t.fases ?? []).includes('CHECK')) {
    return { etapa: etapa('check', 'nao-se-aplica', textoDoCatalogo((m) => m.ship.publicar.checkSemCiclo(tagDoModo(t.modo)))), passou: true };
  }
  const artefato = estadoDoArtefato(raiz, t.id, 'docs/check.md');
  if (artefato.texto === null || artefato.mtimeMs === null) {
    return { etapa: etapa('check', 'pendente', textoDoCatalogo((m) => m.ship.publicar.checkAusente)), passou: false };
  }
  const veredito = vereditoDoParecer(artefato.texto);
  if (veredito === null) return { etapa: etapa('check', 'pendente', textoDoCatalogo((m) => m.ship.publicar.checkSemVeredito)), passou: false };
  if (veredito !== 'PASSOU') {
    return { etapa: etapa('check', 'pendente', textoDoCatalogo((m) => m.ship.publicar.checkOutroVeredito(veredito))), passou: false };
  }
  const ultimo = head ? ultimoCommitDeProduto(raiz, baseRef, head) : null;
  if (ultimo && artefato.mtimeMs < ultimo.em) {
    return { etapa: etapa('check', 'pendente', textoDoCatalogo((m) => m.ship.publicar.checkVelho(curto(ultimo.sha)))), passou: true };
  }
  return { etapa: etapa('check', 'feita', textoDoCatalogo((m) => m.ship.publicar.checkFeito)), passou: true };
}

/**
 * O verify: o ultimo `verify_run` passou, com os comandos do manifesto (`esperados`, o build e o test), no HEAD ou num
 * ancestral dele com so `.ork-ci/` mudando depois.
 */
function conferirVerify(raiz: string, eventos: readonly EventoLedger[], head: string | null, esperados: number): EtapaDaPista {
  const ultimo = [...eventos].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.verificacao);
  if (!ultimo) return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyAusente));
  const commit = typeof ultimo.commit === 'string' && SHA.test(ultimo.commit) ? ultimo.commit : null;
  if (ultimo.veredito !== 'verdade sustentada') {
    const motivos = Array.isArray(ultimo.motivos) ? ultimo.motivos.map(String).join(', ') : '';
    return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyReprovou(curto(commit), motivos || '-')));
  }
  // S2 da revisao: o `ork verify --so-claims` nao roda o build nem o test do manifesto; nao vale como verify do HEAD.
  if (esperados > 0 && (!Array.isArray(ultimo.comandos) || ultimo.comandos.length === 0)) {
    return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifySoClaims(curto(commit))));
  }
  if (!commit || !head) return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyAntigo(curto(commit))));
  if (commit === head) return etapa('verify', 'feita', textoDoCatalogo((m) => m.ship.publicar.verifyNoHead(curto(head))));
  const ancestral = git(raiz, ['merge-base', '--is-ancestor', commit, head]).ok;
  const diff = ancestral ? git(raiz, ['diff', '--name-only', '--no-renames', commit, head]) : null;
  const soBundle = !!diff?.ok && soOBundle(diff.stdout);
  return soBundle ? etapa('verify', 'feita', textoDoCatalogo((m) => m.ship.publicar.verifySoBundle(curto(commit))))
    : etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyAntigo(curto(commit))));
}

/**
 * O bundle no HEAD: desta thread, desta branch, com exatamente as claims ativas (sem claim retirada nem faltando), o
 * comando de cada uma como esta agora e os comandos do manifesto que o runner roda.
 */
function conferirBundle(raiz: string, t: Thread, branch: string, head: string | null,
  comandos: readonly { name: string; command: string }[]): EtapaDaPista {
  const arquivo = `.ork-ci/${t.id}.json`;
  if (!head) return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleAusente(arquivo)));
  const r = git(raiz, ['show', `${head}:${arquivo}`]);
  if (!r.ok) return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleAusente(arquivo)));
  let bundle: BundleCi;
  try {
    bundle = JSON.parse(r.stdout) as BundleCi;
    if (bundle.schema !== 'ork.ci-bundle/v1' || bundle.thread !== t.id || !Array.isArray(bundle.claims)) throw new Error('formato');
  } catch {
    return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleInvalido(arquivo)));
  }
  if (typeof bundle.branch === 'string' && bundle.branch !== branch) {
    return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleOutraBranch(arquivo, String(bundle.branch))));
  }
  const noBundle = new Set([...bundle.claims.map((c) => c.id), ...(bundle.deferredClaims ?? []).map((c) => c.id)]);
  let claimsAtivas: Claim[] = [];
  try { claimsAtivas = lerClaims(raiz, t.id).filter((c) => c.estado !== 'retirada'); } catch { /* sem claims: lista vazia */ }
  const ativas = claimsAtivas.map((c) => c.id);
  const faltam = ativas.filter((id) => !noBundle.has(id));
  const sobram = [...noBundle].filter((id) => !ativas.includes(id));
  if (faltam.length || sobram.length) {
    return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleVelho(faltam.join(', '), sobram.join(', '))));
  }
  // A14 da revisao (rodada 2): a claim que mudou de comando sem mudar de id (o `ork claims anexar`) deixa o bundle velho,
  // e o runner rodaria o comando antigo; o mesmo vale para os comandos do manifesto que o bundle leva.
  const comandoDe = new Map(claimsAtivas.map((c) => [c.id, JSON.stringify(c.verificar)]));
  const mudaram = bundle.claims.filter((c) => comandoDe.has(c.id) && comandoDe.get(c.id) !== JSON.stringify(c.verificar)).map((c) => c.id);
  if (mudaram.length) return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleMudou(mudaram.join(', '))));
  if (JSON.stringify(bundle.commands ?? []) !== JSON.stringify(comandos)) {
    return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleManifestoMudou));
  }
  return etapa('bundle', 'feita', textoDoCatalogo((m) => m.ship.publicar.bundleFeito(ativas.length)));
}

/**
 * O manifesto que vale para o verify e o bundle de uma branch: o do HEAD dela (A15 da revisao, rodada 3). O `ork verify`
 * e o `ork ci prepare` rodam na worktree, com o `orkastery.yaml` da branch, e o runner do CI roda o codigo dela; quem
 * chama o publicar (a Pista, o condutor) pode estar noutro checkout, com outro manifesto. Sem manifesto versionado no
 * HEAD, ou ilegivel, vale o de quem chama.
 */
function manifestoDaBranch(carregado: ManifestoCarregado, head: string | null): ManifestoCarregado {
  if (!head) return carregado;
  for (const nome of [NOME_MANIFESTO, NOME_MANIFESTO_LEGADO]) {
    const r = git(carregado.raiz, ['show', `${head}:./${nome}`]);
    if (!r.ok) continue;
    const doHead = comandosDoTextoDoManifesto(r.stdout);
    if (!doHead) return carregado;
    return { ...carregado, manifesto: { ...carregado.manifesto,
      verify: { ...carregado.manifesto.verify, typecheck: doHead.typecheck, build: doHead.build, test: doHead.test },
      ci: { ...carregado.manifesto.ci, command: doHead.ciCommand } } };
  }
  return carregado;
}

function fatosDaThread(carregado: ManifestoCarregado, t: Thread, refs: Map<string, string>, baseRef: string | null,
  quando: string): FatosDaThread {
  const raiz = carregado.raiz;
  let eventos: EventoLedger[] = [];
  try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { /* ledger ilegivel: sem verify nem conducao provada */ }
  const branch = branchDaWorktree(t);
  const head = branchValida(branch) ? refs.get(`refs/heads/${branch}`) ?? null : null;
  const daBranch = manifestoDaBranch(carregado, head);
  const esperados = comandosDoManifesto(daBranch.manifesto).length;
  const contagem = head && baseRef ? git(raiz, ['rev-list', '--count', `${baseRef}..${head}`]) : null;
  const comProduto = !!contagem?.ok && Number(contagem.stdout.trim()) > 0;
  const check = conferirCheck(raiz, t, baseRef, head);
  return {
    t, eventos, branch, head, comProduto, conducao: conducaoAgora(raiz, t, eventos, quando),
    check: check.etapa, checkPassou: check.passou, verify: conferirVerify(raiz, eventos, head, esperados),
    bundle: conferirBundle(raiz, t, branch, head, comandosDoBundle(daBranch)),
  };
}

/** A base de comparacao: a copia do remoto primeiro (a base local desta maquina pode estar parada). */
function refDaBase(refs: Map<string, string>, remoto: string, base: string): string | null {
  return [`refs/remotes/${remoto}/${base}`, `refs/heads/${base}`].find((r) => refs.has(r)) ?? null;
}

// ---------------------------------------------------------------------------
// O remoto e a forja.
// ---------------------------------------------------------------------------

/**
 * A ponta da branch no remoto pelo `ls-remote`: `null` quando ela nao existe la; `erro` quando o git nao respondeu. Vale
 * so a linha da ref exata: o padrao do `ls-remote` casa por sufixo (`refs/heads/a/refs/heads/<branch>` tambem casaria).
 */
function pontaNoRemoto(raiz: string, remoto: string, branch: string): { sha: string | null; erro: string | null } {
  const r = git(raiz, ['ls-remote', '--', remoto, `refs/heads/${branch}`], PRAZO_DO_LS_REMOTE_MS);
  if (!r.ok) return { sha: null, erro: deFora(r.stderr || r.stdout || `codigo ${r.code}`) };
  const alvo = `refs/heads/${branch}`;
  const linha = r.stdout.split('\n').map((l) => l.trim().split(/\s+/)).find((partes) => partes[1] === alvo);
  const sha = linha?.[0] ?? '';
  return { sha: SHA.test(sha) ? sha : null, erro: null };
}

/**
 * O sha do remoto esta contido no HEAD local? Sem o objeto nesta copia, a resposta tambem e nao: se ele fosse ancestral
 * do HEAD, a copia o teria (A3 da revisao). `null` so quando o git nao respondeu.
 */
function remotoContido(raiz: string, remota: string, head: string): boolean | null {
  if (!git(raiz, ['cat-file', '-e', `${remota}^{commit}`]).ok) return false;
  const r = git(raiz, ['merge-base', '--is-ancestor', remota, head]);
  return r.code === 0 ? true : r.code === 1 ? false : null;
}

/** As pontas de todas as branches do remoto numa chamada so. */
function pontasNoRemoto(raiz: string, remoto: string): Map<string, string> | null {
  const r = git(raiz, ['ls-remote', '--heads', '--', remoto], PRAZO_DO_LS_REMOTE_MS);
  if (!r.ok) return null;
  const mapa = new Map<string, string>();
  for (const linha of r.stdout.split('\n')) {
    const [sha, ref] = linha.trim().split(/\s+/);
    if (sha && ref && SHA.test(sha) && ref.startsWith('refs/heads/')) mapa.set(ref.slice('refs/heads/'.length), sha);
  }
  return mapa;
}

export interface Forja { host: string; repositorio: string }

/** O endereco do remoto, de UM parse da URL; `null` quando o remoto nao existe ou nao tem host de forja. */
function enderecoDoRemotoDaRaiz(raiz: string, remoto: string) {
  const url = git(raiz, ['remote', 'get-url', '--', remoto]);
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
  const r = resolverForja({ endereco, manifesto: carregado.manifesto.forja, sondas });
  if (!r.ok) return { ok: false, erro: r.erro };
  if (r.valor.tipo === 'github' && r.valor.repo.split('/').length !== 2) return { ok: false, erro: null };
  return { ok: true, valor: r.valor };
}

/** O tipo da forja sem rede nem CLI (o fixado, o bloco `forja:` ou o host conhecido), para o comando que o dono roda. */
function tipoSemRede(carregado: ManifestoCarregado, remoto: string, fixado?: TipoDeForja): TipoDeForja {
  if (fixado) return fixado;
  if (carregado.manifesto.forja?.tipo) return carregado.manifesto.forja.tipo;
  const endereco = enderecoDoRemotoDaRaiz(carregado.raiz, remoto);
  return (endereco ? hostConhecido(endereco.host)?.tipo : null) ?? 'github';
}

/**
 * Onde os pedidos da branch sao lidos e abertos: PR no GitHub, MR no GitLab. Os `passo*` sao a evidencia em `passos`
 * e no ledger; no GitHub, os textos de sempre.
 */
interface PedidosDaEntrega {
  tipo: TipoDeForja;
  listar(base: string, branch: string): { prs: PrDaForja[]; erro: string | null };
  abrir(base: string, branch: string, titulo: string, corpo: string): { status: number | null; stdout: string; stderr: string };
  passoDaLista(branch: string): string;
  passoDaCriacao(base: string, branch: string): string;
  /** O comando do ensaio; `corpo` e o nome da fonte (`pr-body.md` ou `padrao`), nunca o texto. */
  ensaioDaCriacao(base: string, branch: string, titulo: string, corpo: string): string;
}

function pedidosDoGithub(forja: Forja, executor: ExecutorDoGh): PedidosDaEntrega {
  const gh = adaptadorDaForja('github');
  return {
    tipo: 'github',
    listar: (base, branch) => exigirCapacidade(gh, 'pedidosDaBranch')({ ...forja, base, branch, executor, prazoMs: PRAZO_DO_GH_MS }),
    abrir: (base, branch, titulo, corpo) => exigirCapacidade(gh, 'abrirPedido')({ ...forja, base, branch, titulo, corpo, executor,
      prazoMs: PRAZO_DO_GH_MS }),
    passoDaLista: (branch) => `gh pr list --head ${branch} --state all`,
    passoDaCriacao: (base, branch) => `gh pr create --base ${base} --head ${branch}`,
    ensaioDaCriacao: (base, branch, titulo, corpo) => `gh pr create --base ${base} --head ${branch} --title "${titulo}" --body-file <${corpo}>`,
  };
}

/** O GitLab pela API com a CLI logada; o gh nunca roda aqui. */
function pedidosDoGitlab(f: ForjaResolvida, opcoes: OpcoesDaApi): PedidosDaEntrega {
  const gl = adaptadorDaForja('gitlab');
  const semGh: ExecutorDoGh = () => ({ status: 1, stdout: '', stderr: 'o gh não fala com o GitLab' });
  const comum = { host: hostDaApi(f), repositorio: f.repo, executor: semGh, prazoMs: PRAZO_DO_GH_MS, api: chamadorDaApi(f, opcoes) };
  const projeto = projetoNaApi(f.repo);
  return {
    tipo: 'gitlab',
    listar: (base, branch) => exigirCapacidade(gl, 'pedidosDaBranch')({ ...comum, base, branch }),
    abrir: (base, branch, titulo, corpo) => exigirCapacidade(gl, 'abrirPedido')({ ...comum, base, branch, titulo, corpo }),
    passoDaLista: (branch) => `glab api ${projeto}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all`,
    passoDaCriacao: (base, branch) => `glab api --method POST ${projeto}/merge_requests (source_branch=${branch}, target_branch=${base})`,
    ensaioDaCriacao: (base, branch, titulo, corpo) =>
      `glab api --method POST ${projeto}/merge_requests (source_branch=${branch}, target_branch=${base}, title="${titulo}", description <${corpo}>)`,
  };
}

/** Os pedidos da entrega: o GitHub fixo dos testes, a forja fixada, ou a resolvida do remoto. */
function pedidosDaEntrega(carregado: ManifestoCarregado, remoto: string,
  opcoes: { forja?: Forja; forjaResolvida?: ForjaResolvida; sondas?: SondasDaForja; api?: OpcoesDaApi; executorGh?: ExecutorDoGh }):
  { ok: true; pedidos: PedidosDaEntrega } | { ok: false; erro: ErroDaForja | null } {
  const executor = opcoes.executorGh ?? ghPadrao;
  if (opcoes.forja) return { ok: true, pedidos: pedidosDoGithub(opcoes.forja, executor) };
  const r = opcoes.forjaResolvida ? { ok: true as const, valor: opcoes.forjaResolvida } : forjaDaEntrega(carregado, remoto, opcoes.sondas);
  if (!r.ok) return r;
  return { ok: true, pedidos: r.valor.tipo === 'gitlab' ? pedidosDoGitlab(r.valor, opcoes.api ?? {})
    : pedidosDoGithub({ host: hostDaApi(r.valor), repositorio: r.valor.repo }, executor) };
}

// ---------------------------------------------------------------------------
// O corpo e o titulo do PR.
// ---------------------------------------------------------------------------

/** O `pr-body.md` da thread, quando e arquivo comum e cabe no teto. */
function corpoDaThread(raiz: string, threadId: string): { arquivo: string; texto: string } | null {
  const arquivo = path.join(dirThread(raiz, threadId), 'pr-body.md');
  try {
    const st = fs.lstatSync(arquivo);
    if (!st.isFile() || st.size === 0 || st.size > TETO_DO_CORPO) return null;
    const texto = fs.readFileSync(arquivo, 'utf8');
    // O corpo vai ao gh por um arquivo temporario 600, nunca pelo argv; com NUL ele nao e texto de PR, e vale o corpo padrao.
    return texto.includes('\0') ? null : { arquivo, texto };
  } catch { return null; }
}

/** O titulo do PR: `ship(<thread>): ` e o primeiro cabecalho do corpo, ou o nome da thread. */
export function tituloDoPr(t: Pick<Thread, 'id' | 'nome'>, corpo: string | null): string {
  let titulo: string | null = null;
  for (const linha of (corpo ?? '').split('\n')) {
    const l = linha.trim();
    if (!l) continue;
    const m = /^#{1,6}\s+(.+)$/.exec(l);
    titulo = m ? umaLinha(m[1], 120) : null;
    break;
  }
  const prefixo = `ship(${t.id})`;
  if (titulo?.startsWith(prefixo)) return titulo;
  return `${prefixo}: ${titulo ?? umaLinha(t.nome || t.id, 120)}`;
}

/** Uma palavra do shell entre aspas simples: nada dentro dela vira comando, nem `;`, `$`, crase ou barra. */
export function entreAspas(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * O que o dono roda no proprio terminal quando o modo da thread nao autoriza o push. A branch e a base vem do estado e do
 * manifesto, que podem ser do clone: cada parte vai entre aspas simples (A4 da revisao). No GitLab, o `glab` nao le a
 * descricao de arquivo, e quem a le e o shell do dono; o `glab mr create` nao arma merge.
 */
export function comandoDoDono(remoto: string, base: string, branch: string, titulo: string, comCorpo: string | null,
  tipo: TipoDeForja = 'github'): string {
  const push = `git push -u ${entreAspas(remoto)} ${entreAspas(branch)}`;
  if (tipo === 'gitlab') {
    return `${push} && glab mr create --source-branch ${entreAspas(branch)} --target-branch ${entreAspas(base)} --title ${entreAspas(titulo)} ` +
      `${comCorpo ? `--description "$(cat ${entreAspas(comCorpo)})"` : '--fill'} --yes`;
  }
  return `${push} && gh pr create --base ${entreAspas(base)} --head ${entreAspas(branch)} ` +
    `--title ${entreAspas(titulo)} ${comCorpo ? `--body-file ${entreAspas(comCorpo)}` : '--fill'}`;
}

// ---------------------------------------------------------------------------
// `ork ship publicar`.
// ---------------------------------------------------------------------------

export type AcaoDaPublicacao = 'publicou' | 'publicaria' | 'ja-publicada' | 'recusada';

export interface PrDaPublicacao {
  numero: number;
  url: string | null;
  /** O PR foi aberto agora por este comando. */
  criado: boolean;
  /** O head do PR como a forja o devolveu: um push de outro depois do nosso aparece aqui (S10 da revisao). */
  head: string | null;
}

export interface Publicacao {
  contrato: typeof CONTRATO_DA_PUBLICACAO;
  thread: string;
  modo: string | null;
  tag: string | null;
  acao: AcaoDaPublicacao;
  motivo: MotivoGate | null;
  detalhe: string;
  correcao: string;
  branch: string | null;
  base: string;
  remoto: string;
  head: string | null;
  /** A ponta da branch no remoto antes do push, pelo `ls-remote`. */
  remotaAntes: string | null;
  /** A ponta da branch no remoto depois (ou agora, no ensaio), pelo `ls-remote`. */
  remota: string | null;
  /** `true` so quando o `ls-remote` devolveu o mesmo sha do HEAD local. */
  pushVerificado: boolean;
  pr: PrDaPublicacao | null;
  corpo: 'pr-body.md' | 'padrao' | null;
  /** Os comandos realmente executados, na ordem (no ensaio, os que o real executaria). */
  passos: string[];
  dryRun: boolean;
}

export interface OpcoesDaPublicacao {
  remoto?: string;
  dryRun?: boolean;
  quando?: string;
  /** Quem roda o `gh`; os testes trocam por um falso. Nunca vem da CLI. */
  executorGh?: ExecutorDoGh;
  /** O GitHub do remoto; os testes o fixam, porque o remoto deles e um repositorio bare local. Nunca vem da CLI. */
  forja?: Forja;
  /** A forja resolvida do remoto; os testes do GitLab a fixam, porque o remoto deles e um repositorio bare local. Nunca vem da CLI. */
  forjaResolvida?: ForjaResolvida;
  /** Como a API da forja roda (a CLI falsa dos testes). Nunca vem da CLI. */
  api?: OpcoesDaApi;
  /** As sondas do resolver; os testes as trocam. Nunca vem da CLI. */
  sondas?: SondasDaForja;
  /** Quem roda o `git push`; os testes trocam para simular o push que sai com erro depois de chegar. Nunca vem da CLI. */
  executorGit?: (args: string[], prazoMs: number) => ResultadoExec;
}

/**
 * `ork ship publicar <thread>`: publica a branch da thread e abre (ou reaproveita) o PR, com prova, so no modo que
 * ja autoriza push. Nunca lanca por reprovacao: a recusa antes de qualquer efeito volta tipada e nada vai ao ledger; o
 * push que aconteceu vai sempre ao ledger, provado ou nao (B1 da revisao).
 */
export function publicarEntrega(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDaPublicacao = {}): Publicacao {
  const raiz = carregado.raiz, base = carregado.manifesto.worktree.base_branch;
  const remoto = exigirRemoto(opcoes.remoto ?? 'origin', 'ship');
  const quando = opcoes.quando ?? new Date().toISOString();
  const dryRun = opcoes.dryRun === true;
  const p = (m: Mensagens) => m.ship.publicar;
  const r: Publicacao = {
    contrato: CONTRATO_DA_PUBLICACAO, thread: threadId, modo: null, tag: null, acao: 'recusada', motivo: null,
    detalhe: '', correcao: '', branch: null, base, remoto, head: null, remotaAntes: null, remota: null, pushVerificado: false,
    pr: null, corpo: null, passos: [], dryRun,
  };
  const recusar = (motivo: MotivoGate, detalhe: string, correcao: string): Publicacao =>
    ({ ...r, acao: 'recusada', motivo, detalhe, correcao });

  // 1. A thread que existe e esta aberta. S3 da revisao: a que nao se le tambem volta como recusa tipada, no contrato.
  let lida: Thread;
  try {
    lida = lerThread(raiz, threadId);
  } catch (e) {
    return recusar('artifact.missing', textoDoCatalogo((m) => p(m).threadInexistente(umaLinha(threadId, 80), deFora((e as Error).message))),
      textoDoCatalogo((m) => p(m).threadInexistenteCorrecao));
  }
  const t = lida;
  r.thread = t.id;
  r.modo = t.modo;
  r.tag = tagDoModo(t.modo);
  if (t.status === 'fechada') {
    return recusar('artifact.missing', textoDoCatalogo((m) => p(m).threadFechada(t.id)), textoDoCatalogo((m) => p(m).threadFechadaCorrecao));
  }
  const refs = refsLocais(raiz, remoto);
  const baseRef = refDaBase(refs, remoto, base);
  const f = fatosDaThread(carregado, t, refs, baseRef, quando);
  r.branch = f.branch;
  r.head = f.head;
  const corpo = corpoDaThread(raiz, t.id);

  // 2. O modo que ja autoriza push (D1): fora dele, o push e do dono, e a correcao diz o comando dele.
  if (!MODOS_QUE_PUBLICAM.includes(t.modo)) {
    const comando = comandoDoDono(remoto, base, f.branch, tituloDoPr(t, corpo?.texto ?? null),
      corpo ? path.relative(raiz, corpo.arquivo) : null, tipoSemRede(carregado, remoto, opcoes.forja ? 'github' : opcoes.forjaResolvida?.tipo));
    return recusar('human.pending', textoDoCatalogo((m) => p(m).modoSemPush(tagDoModo(t.modo))),
      textoDoCatalogo((m) => p(m).modoSemPushCorrecao(comando)));
  }
  // 3. Ninguem conduz a thread agora: a branch pode mudar no meio da publicacao.
  if (f.conducao) {
    const sessao = f.conducao.sessao ? f.conducao.sessao.slice(0, 8) : f.conducao.canal;
    return recusar('conducao.em-andamento', textoDoCatalogo((m) => p(m).conduzida(sessao, f.conducao?.fase ?? '-')),
      textoDoCatalogo((m) => p(m).conduzidaCorrecao(t.id)));
  }
  // 4. A branch com produto, que nao e a base.
  if (!branchValida(f.branch) || !f.head) {
    return recusar('artifact.missing', textoDoCatalogo((m) => p(m).semBranch(f.branch)), textoDoCatalogo((m) => p(m).semBranchCorrecao(t.id)));
  }
  const head = f.head;
  if (f.branch === base) {
    return recusar('policy.violation', textoDoCatalogo((m) => p(m).branchEBase(base)), textoDoCatalogo((m) => p(m).branchEBaseCorrecao));
  }
  if (!f.comProduto) {
    return recusar('artifact.missing', textoDoCatalogo((m) => p(m).semProduto(f.branch, base)), textoDoCatalogo((m) => p(m).semProdutoCorrecao));
  }
  // 5 a 7. O CHECK, o verify e o bundle no HEAD.
  if (f.check.estado === 'pendente') return recusar('artifact.missing', f.check.texto, textoDoCatalogo((m) => p(m).checkCorrecao(t.id)));
  if (f.verify.estado === 'pendente') return recusar('verify.failed', f.verify.texto, textoDoCatalogo((m) => p(m).verifyCorrecao(t.id)));
  if (f.bundle.estado === 'pendente') return recusar('artifact.missing', f.bundle.texto, textoDoCatalogo((m) => p(m).bundleCorrecao(t.id)));
  // 8. O remoto e a forja. S3 da revisao: sem o remoto, a publicacao nao tem para onde ir (runtime.unavailable).
  if (!git(raiz, ['remote', 'get-url', '--', remoto]).ok) {
    return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).semRemoto(remoto)), textoDoCatalogo((m) => p(m).semRemotoCorrecao));
  }
  const daForja = pedidosDaEntrega(carregado, remoto, opcoes);
  if (!daForja.ok) {
    const erro = daForja.erro;
    return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).semForja(remoto, erro ? m.forja.motivo(erro, null) : null)),
      textoDoCatalogo((m) => p(m).semForjaCorrecao));
  }
  const pedidos = daForja.pedidos;
  const noGitlab = pedidos.tipo === 'gitlab';
  const rede = (m: Mensagens) => (noGitlab ? p(m).redeCorrecaoGitlab : p(m).redeCorrecao);
  // 9. A ponta no remoto e os PRs da branch, antes de qualquer efeito.
  const provaDoPush = `git ls-remote ${remoto} refs/heads/${f.branch}`;
  const antes = pontaNoRemoto(raiz, remoto, f.branch);
  r.passos.push(provaDoPush);
  if (antes.erro !== null) {
    return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).lsRemoteFalhou(remoto, antes.erro ?? '-')), textoDoCatalogo(rede));
  }
  r.remotaAntes = antes.sha;
  r.remota = antes.sha;
  const lidos = pedidos.listar(base, f.branch);
  r.passos.push(pedidos.passoDaLista(f.branch));
  if (lidos.erro !== null) {
    const erro = lidos.erro;
    return recusar('runtime.unavailable', textoDoCatalogo((m) => noGitlab ? p(m).prsFalharamGitlab(erro) : p(m).prsFalharam(erro)),
      textoDoCatalogo(rede));
  }
  const aberto = lidos.prs.find((x) => x.estado === 'aberto') ?? null;
  const mesclado = lidos.prs.find((x) => x.estado === 'mesclado' && x.head === head) ?? null;
  const noRemoto = antes.sha === head;
  r.pushVerificado = noRemoto;
  // A2 da revisao: o PR mesclado no HEAD ja e a entrega, com ou sem a branch no remoto (o GitHub pode te-la apagado).
  if (mesclado && !aberto) {
    return { ...r, acao: 'ja-publicada', pr: { numero: mesclado.numero, url: mesclado.url, criado: false, head: mesclado.head },
      detalhe: textoDoCatalogo((m) => p(m).jaMesclado(mesclado.numero)), correcao: textoDoCatalogo((m) => p(m).registreAEntrega(t.id)) };
  }
  if (noRemoto && aberto) {
    return { ...r, acao: 'ja-publicada', pr: { numero: aberto.numero, url: aberto.url, criado: false, head: aberto.head },
      detalhe: textoDoCatalogo((m) => p(m).jaPublicada(aberto.numero)) };
  }
  // O remoto com commit que a branch local nao tem, ou que esta copia nem conhece (A3 da revisao): o push sem forca
  // seria recusado. Nunca forcar.
  if (antes.sha && !noRemoto && remotoContido(raiz, antes.sha, head) === false) {
    return recusar('tree.blocked', textoDoCatalogo((m) => p(m).remotoDivergiu(remoto, f.branch, curto(antes.sha))),
      textoDoCatalogo((m) => p(m).remotoDivergiuCorrecao(remoto, f.branch)));
  }
  r.corpo = corpo ? 'pr-body.md' : 'padrao';
  const titulo = tituloDoPr(t, corpo?.texto ?? null);
  // A5 da revisao: o corpo e o texto lido agora, gravado num arquivo temporario 600 so para o `gh pr create`
  // (`--body-file`); o gh nunca reabre o `pr-body.md`.
  const textoDoCorpo = corpo?.texto ?? textoDoCatalogo((m) => p(m).corpoPadrao(tagDoModo(t.modo), f.branch, curto(head),
    carregado.manifesto.ci.context || 'ork-verify'));
  // B1 da revisao: o push leva o sha conferido, e nao a ref: o commit que chegue a branch depois das conferencias fica
  // fora desta publicacao.
  const refspec = `${head}:refs/heads/${f.branch}`;

  if (dryRun) {
    const passos = [...r.passos];
    if (!noRemoto) passos.push(`git push -- ${remoto} ${refspec}`, provaDoPush);
    passos.push(aberto ? textoDoCatalogo((m) => p(m).passoReaproveita(aberto.numero))
      : pedidos.ensaioDaCriacao(base, f.branch, titulo, corpo ? 'pr-body.md' : 'padrao'));
    return { ...r, acao: 'publicaria', passos, pr: aberto ? { numero: aberto.numero, url: aberto.url, criado: false, head: aberto.head } : null,
      detalhe: textoDoCatalogo((m) => p(m).publicaria(curto(head), aberto?.numero ?? null)) };
  }

  // A evidencia de cada efeito, com a prova ou a falta dela.
  let pushFeito = false;
  const gravar = (extra: Record<string, unknown>) => registrar(dirThread(raiz, t.id), t.id, TIPOS_DE_EVENTO.shipPublicado, {
    branch: f.branch, base, remoto, head, remotaAntes: r.remotaAntes, shaRemoto: r.remota, pushFeito, pushVerificado: r.pushVerificado,
    fonteDaProva: provaDoPush, corpo: r.corpo, modo: t.modo, tag: tagDoModo(t.modo),
    autorizadoPor: textoDoCatalogo((m) => m.ship.porTag(tagDoModo(t.modo))), tipoDeAutorizacao: 'modo', passos: r.passos, ...extra,
  });

  // Efeito 1: o push sem forca do sha conferido, provado pelo ls-remote.
  if (!noRemoto) {
    const argv = ['push', '--', remoto, refspec];
    const push = (opcoes.executorGit ?? ((args: string[], prazoMs: number) => git(raiz, args, prazoMs)))(argv, PRAZO_DO_PUSH_MS);
    r.passos.push(`git ${argv.join(' ')}`);
    const depois = pontaNoRemoto(raiz, remoto, f.branch);
    r.passos.push(provaDoPush);
    r.remota = depois.sha;
    r.pushVerificado = depois.sha === head;
    // O push que saiu com erro mas chegou (o prazo venceu depois da escrita no remoto) conta: quem decide e o ls-remote.
    pushFeito = push.ok || r.pushVerificado;
    if (!pushFeito) {
      const erro = deFora(push.stderr || push.stdout || `codigo ${push.code}`, 300);
      const recusado = /rejected|non-fast-forward|fetch first|stale info|failed to update ref/i.test(erro);
      return recusar(recusado ? 'tree.blocked' : 'runtime.unavailable', textoDoCatalogo((m) => p(m).pushFalhou(remoto, f.branch, erro)),
        textoDoCatalogo((m) => recusado ? p(m).remotoDivergiuCorrecao(remoto, f.branch) : rede(m)));
    }
    if (!r.pushVerificado) {
      // B1 da revisao: o push aconteceu e o remoto nao mostra o HEAD; a tentativa vai ao ledger com o que ele respondeu.
      gravar({ pr: null, ...(depois.erro !== null ? { erroDaProva: depois.erro } : {}) });
      return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).pushSemProva(depois.sha ? curto(depois.sha) : null, curto(head))),
        textoDoCatalogo((m) => p(m).pushSemProvaCorrecao(t.id)));
    }
  }

  // Efeito 2: o PR aberto da branch, ou um novo, provado pela releitura da lista.
  let pr: PrDaPublicacao | null = aberto ? { numero: aberto.numero, url: aberto.url, criado: false, head: aberto.head } : null;
  let erroDoPr: string | null = null;
  if (!pr) {
    const criado = pedidos.abrir(base, f.branch, titulo, textoDoCorpo);
    r.passos.push(pedidos.passoDaCriacao(base, f.branch));
    const relidos = pedidos.listar(base, f.branch);
    r.passos.push(`${pedidos.passoDaLista(f.branch)}   (prova do PR)`);
    const achado = relidos.prs.find((x) => x.estado === 'aberto') ?? null;
    if (achado) pr = { numero: achado.numero, url: achado.url, criado: criado.status === 0, head: achado.head };
    else {
      erroDoPr = criado.status !== 0 ? deFora(criado.stderr || criado.stdout || `codigo ${criado.status ?? '-'}`)
        : relidos.erro ?? textoDoCatalogo((m) => noGitlab ? p(m).prSemReleituraGitlab : p(m).prSemReleitura);
    }
  }
  r.pr = pr;

  // A evidencia: so com efeito (push ou PR novo), com a prova.
  if (pushFeito || pr?.criado || erroDoPr) {
    gravar({ pr: pr ? { numero: pr.numero, url: pr.url, criado: pr.criado, head: pr.head } : null,
      ...(pr ? { provaDoPr: pedidos.passoDaLista(f.branch) } : {}), ...(erroDoPr ? { erroDoPr } : {}) });
  }
  if (erroDoPr) {
    const erro = erroDoPr;
    return recusar('runtime.unavailable', textoDoCatalogo((m) => noGitlab ? p(m).prFalhouGitlab(curto(head), erro) : p(m).prFalhou(curto(head), erro)),
      textoDoCatalogo((m) => noGitlab ? p(m).prFalhouCorrecaoGitlab(t.id) : p(m).prFalhouCorrecao(t.id)));
  }
  // S7 da revisao: sem push e sem PR aberto por este processo, quem publicou foi outro; a entrega ja estava publicada.
  if (!pushFeito && !pr?.criado) {
    return { ...r, acao: 'ja-publicada', motivo: null, correcao: '', detalhe: textoDoCatalogo((m) => p(m).jaPublicada(pr?.numero ?? 0)) };
  }
  return { ...r, acao: 'publicou', motivo: null, correcao: '',
    detalhe: textoDoCatalogo((m) => p(m).publicou(curto(head), pr?.numero ?? 0, pr?.criado === true)) };
}

/** As linhas da saida de texto do `ork ship publicar`, no locale ativo. */
export function linhasDaPublicacao(r: Publicacao): string[] {
  const m = msg().ship;
  const p = m.publicar;
  const curtoOuTraco = (sha: string | null) => (sha ? sha.slice(0, 7) : '-');
  const linhas = [p.cabecalho(r.dryRun, r.thread, r.tag ?? '-')];
  if (r.branch) linhas.push(p.linhaBranch(r.branch, curtoOuTraco(r.head)));
  if (r.passos.length) {
    linhas.push(p.linhaRemoto(r.remoto, curtoOuTraco(r.remotaAntes), curtoOuTraco(r.remota)));
    // O PR ja mesclado no HEAD com a branch apagada no remoto nao tem push a provar: a linha some.
    if (!r.dryRun && r.acao !== 'recusada' && (r.pushVerificado || r.remota !== null)) {
      linhas.push(r.pushVerificado ? p.linhaPushProvado : p.linhaPushSemProva);
    }
  }
  if (r.pr) linhas.push(p.linhaPr(r.pr.numero, r.pr.criado, r.pr.url ?? ''));
  if (r.corpo) linhas.push(p.linhaCorpo(r.corpo));
  if (r.acao === 'recusada') linhas.push(m.bloqueado(r.motivo ?? '-'), m.detalhe(remontar(r.detalhe)));
  else {
    linhas.push(p.resultado(p.acoes[r.acao] ?? r.acao));
    if (r.detalhe) linhas.push(m.detalhe(remontar(r.detalhe)));
  }
  if (r.correcao) linhas.push(m.correcao(remontar(r.correcao)));
  if (r.passos.length) {
    linhas.push(m.evidencia);
    for (const passo of r.passos) linhas.push(`  ${remontar(passo)}`);
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// `ork ship pista`.
// ---------------------------------------------------------------------------

export interface ProximoPasso {
  /** A acao que o nucleo declara para a Pista: so `publicar` e `registrar` viram botao (D6). */
  acao: 'publicar' | 'registrar' | null;
  disponivel: boolean;
  texto: string;
  /** O comando do nucleo que resolve, ou o que o dono roda no terminal dele; `null` quando nao ha um. */
  comando: string | null;
}

export interface PrDaPista {
  numero: number;
  url: string | null;
  estado: PrDaForja['estado'];
  rascunho: boolean;
  head: string;
}

export interface PistaDaThread {
  thread: string;
  nome: string;
  modo: string;
  tag: string;
  /** O modo da thread ja autoriza o push (#Auto e #Maestro). */
  publicavel: boolean;
  conduzida: boolean;
  branch: string;
  head: string | null;
  remota: string | null;
  pr: PrDaPista | null;
  etapas: EtapaDaPista[];
  proximo: ProximoPasso;
}

export interface PistaDeEntrega {
  contrato: typeof CONTRATO_DA_PISTA;
  lidoEm: string;
  base: string;
  remoto: string;
  remotoLido: boolean;
  prsLidos: boolean;
  prsNaoLidos: string | null;
  ciExigido: boolean;
  contextoDoCi: string;
  pistas: PistaDaThread[];
}

export interface OpcoesDaPista {
  remoto?: string;
  quando?: string;
  /** So a pista desta thread. */
  thread?: string;
  executorGh?: ExecutorDoGh;
  forja?: Forja;
}

/**
 * O PR que vale para a pista: o aberto mais novo, senao o mesclado no HEAD, senao o mais novo da branch quando ele foi
 * fechado sem merge. O mesclado de outro head e de uma entrega anterior (A1 da revisao): nao vale para a ponta nova.
 */
function prDaBranchNaLista(prs: readonly PrDaForja[], branch: string, head: string | null): PrDaForja | null {
  const daBranch = prs.filter((x) => x.branch === branch).sort((a, b) => b.numero - a.numero);
  const aberto = daBranch.find((x) => x.estado === 'aberto');
  if (aberto) return aberto;
  const mesclado = daBranch.find((x) => x.estado === 'mesclado' && x.head === head);
  if (mesclado) return mesclado;
  return daBranch[0]?.estado === 'fechado' ? daBranch[0] : null;
}

/** O que a pista le de uma thread sem a forja: a branch no remoto, o registro da entrega e o merge na base. */
interface EntregaLocal {
  remota: string | null;
  entregue: boolean;
  merge: ReturnType<typeof mergeDaEntrega>;
  mergeSemRegistro: boolean;
  /** Ja esta na entrega pelo que se le sem a forja; o PR da lista so acrescenta. */
  naEntrega: boolean;
}

function entregaLocal(raiz: string, f: FatosDaThread, remotas: Map<string, string> | null, remoto: string, base: string): EntregaLocal {
  const remota = remotas?.get(f.branch) ?? null;
  const ships = f.eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
  const entregue = (!!f.head && ships.some((e) => e.shaDe === f.head || e.mergeSha === f.head)) || (!f.comProduto && ships.length > 0);
  const merge = f.head ? mergeDaEntrega(raiz, f.t.id, remoto, base) : null;
  const mergeSemRegistro = !!merge && !ships.some((e) => e.mergeSha === merge.mergeSha);
  // So entra na pista quem ja esta na entrega: passou do CHECK (ciclo sem CHECK: o turno acabou) com produto, publicou,
  // tem merge sem registro ou ja foi entregue e espera o MASTER.
  const passouDoCheck = f.check.estado === 'nao-se-aplica' ? !f.conducao : f.checkPassou;
  const naEntrega = (passouDoCheck && f.comProduto) || (!!remota && f.comProduto) || mergeSemRegistro || entregue;
  return { remota, entregue, merge, mergeSemRegistro, naEntrega };
}

/** Por que o PR de uma branch nao veio numa leitura que deu certo: a lista dos abertos cortada ou a branch sem conferir. */
type CorteDaLeitura = 'parcial' | 'sem-conferir' | null;

/** O que a pista de uma thread diz, das leituras ja feitas. */
function pistaDaThread(carregado: ManifestoCarregado, f: FatosDaThread, local: EntregaLocal, leitura: {
  remoto: string; base: string; remotasLidas: boolean; prs: PrDaForja[] | null; prsNaoLidos: string | null;
  corte: (branch: string) => CorteDaLeitura; ciExigido: boolean; contexto: string;
}): PistaDaThread | null {
  const { t } = f;
  const raiz = carregado.raiz;
  const { remota, entregue, merge, mergeSemRegistro } = local;
  const pr = leitura.prs ? prDaBranchNaLista(leitura.prs, f.branch, f.head) : null;
  const prMesclado = pr?.estado === 'mesclado' && pr.head === f.head;
  if (!(local.naEntrega || !!pr) || !f.head) return null;

  const c = (m: Mensagens) => m.ship.publicar;
  const publicavel = MODOS_QUE_PUBLICAM.includes(t.modo);
  // A branch no remoto. A3 da revisao: o sha do remoto que esta copia nem conhece tambem e divergencia.
  let branchEtapa: EtapaDaPista;
  if (!leitura.remotasLidas) branchEtapa = etapa('branch', 'nao-lida', textoDoCatalogo((m) => c(m).remotoNaoLido(leitura.remoto)));
  else if (remota === f.head) branchEtapa = etapa('branch', 'feita', textoDoCatalogo((m) => c(m).branchPublicada(curto(f.head))));
  else if (!remota) branchEtapa = etapa('branch', 'pendente', textoDoCatalogo((m) => c(m).branchNaoPublicada));
  else if (remotoContido(raiz, remota, f.head) === false) {
    branchEtapa = etapa('branch', 'falhou', textoDoCatalogo((m) => c(m).remotoDivergiu(leitura.remoto, f.branch, curto(remota))));
  } else branchEtapa = etapa('branch', 'pendente', textoDoCatalogo((m) => c(m).commitsSemPush(curto(remota), curto(f.head))));
  // O PR, o CI e o conflito.
  const corte = leitura.corte(f.branch);
  let prEtapa: EtapaDaPista, ciEtapa: EtapaDaPista, conflitoEtapa: EtapaDaPista;
  if (!leitura.prs) {
    prEtapa = etapa('pr', 'nao-lida', textoDoCatalogo((m) => c(m).prsNaoLidos(leitura.prsNaoLidos ?? '-')));
    ciEtapa = etapa('ci', 'nao-lida', textoDoCatalogo((m) => c(m).prsNaoLidos(leitura.prsNaoLidos ?? '-')));
    conflitoEtapa = etapa('conflito', 'nao-lida', textoDoCatalogo((m) => c(m).prsNaoLidos(leitura.prsNaoLidos ?? '-')));
  } else if ((!pr || pr.estado === 'fechado') && corte) {
    // A7 da revisao: a lista dos abertos cortada, ou a branch sem conferir nesta leitura, nao diz "sem PR" (a R1 do pulse).
    const texto = textoDoCatalogo((m) => corte === 'parcial' ? c(m).prsCortados(LIMITE_DE_PRS) : c(m).branchSemConferir);
    prEtapa = etapa('pr', 'nao-lida', texto);
    ciEtapa = etapa('ci', 'nao-lida', texto);
    conflitoEtapa = etapa('conflito', 'nao-lida', texto);
  } else if (!pr || pr.estado === 'fechado') {
    prEtapa = etapa('pr', 'pendente', pr ? textoDoCatalogo((m) => c(m).prFechado(pr.numero)) : textoDoCatalogo((m) => c(m).semPr));
    ciEtapa = etapa('ci', leitura.ciExigido ? 'pendente' : 'nao-se-aplica',
      textoDoCatalogo((m) => leitura.ciExigido ? c(m).ciSemPr : c(m).ciNaoExigido));
    conflitoEtapa = etapa('conflito', 'nao-se-aplica', textoDoCatalogo((m) => c(m).conflitoSemPr));
  } else if (pr.estado === 'mesclado') {
    prEtapa = etapa('pr', 'feita', textoDoCatalogo((m) => c(m).prMesclado(pr.numero)));
    ciEtapa = etapa('ci', 'nao-se-aplica', textoDoCatalogo((m) => c(m).ciDoMesclado));
    conflitoEtapa = etapa('conflito', 'feita', textoDoCatalogo((m) => c(m).prMesclado(pr.numero)));
  } else {
    prEtapa = etapa('pr', 'feita', textoDoCatalogo((m) => pr.rascunho ? c(m).prRascunho(pr.numero) : c(m).prAberto(pr.numero)));
    const check = pr.checks.find((k) => k.nome === leitura.contexto);
    ciEtapa = !leitura.ciExigido ? etapa('ci', 'nao-se-aplica', textoDoCatalogo((m) => c(m).ciNaoExigido))
      : !check ? etapa('ci', 'pendente', textoDoCatalogo((m) => c(m).ciSemCheck(leitura.contexto, pr.numero)))
      : check.situacao === 'verde' ? etapa('ci', 'feita', textoDoCatalogo((m) => c(m).ciVerde(leitura.contexto, curto(pr.head))))
      : check.situacao === 'vermelho' ? etapa('ci', 'falhou', textoDoCatalogo((m) => c(m).ciVermelho(leitura.contexto, pr.numero)))
      : etapa('ci', 'pendente', textoDoCatalogo((m) => c(m).ciEsperando(leitura.contexto, pr.numero)));
    conflitoEtapa = pr.conflito === true ? etapa('conflito', 'falhou', textoDoCatalogo((m) => c(m).conflito(pr.numero)))
      : pr.conflito === false ? etapa('conflito', 'feita', textoDoCatalogo((m) => c(m).semConflito))
      : etapa('conflito', 'nao-lida', textoDoCatalogo((m) => c(m).conflitoNaoCalculado));
  }
  const entregaEtapa = entregue ? etapa('entrega', 'feita', textoDoCatalogo((m) => c(m).entregue))
    : etapa('entrega', 'pendente', textoDoCatalogo((m) => mergeSemRegistro ? c(m).mergeSemRegistro(curto(merge?.mergeSha)) : c(m).semShipDone));

  // O proximo passo, a primeira regra que vale.
  const corpo = corpoDaThread(raiz, t.id);
  const nada = (texto: string, comando: string | null = null): ProximoPasso => ({ acao: null, disponivel: false, texto, comando });
  let proximo: ProximoPasso;
  if (entregue) proximo = nada(textoDoCatalogo((m) => c(m).proximoEntregue));
  else if (mergeSemRegistro || prMesclado) {
    proximo = { acao: 'registrar', disponivel: true, texto: textoDoCatalogo((m) => c(m).proximoRegistrar), comando: `ork ship registrar-pr ${t.id}` };
  } else if (f.conducao) {
    const sessao = f.conducao.sessao ? f.conducao.sessao.slice(0, 8) : f.conducao.canal;
    proximo = nada(textoDoCatalogo((m) => c(m).proximoConduzida(sessao)), `ork conducao status ${t.id}`);
  } else if (f.check.estado === 'pendente') proximo = nada(f.check.texto, textoDoCatalogo((m) => c(m).comandoDoCheck(t.id)));
  else if (f.verify.estado === 'pendente') proximo = nada(f.verify.texto, `ork verify ${t.id}`);
  else if (f.bundle.estado === 'pendente') proximo = nada(f.bundle.texto, `ork ci prepare ${t.id}`);
  else if (branchEtapa.estado === 'falhou') proximo = nada(branchEtapa.texto, null);
  else if (branchEtapa.estado === 'nao-lida') proximo = nada(branchEtapa.texto, `ork ship pista ${t.id}`);
  else if (branchEtapa.estado === 'pendente' || (prEtapa.estado === 'pendente')) {
    proximo = publicavel
      ? { acao: 'publicar', disponivel: true, comando: `ork ship publicar ${t.id}`,
          texto: textoDoCatalogo((m) => pr?.estado === 'aberto' ? c(m).proximoPublicarNoPr(pr.numero) : c(m).proximoPublicar) }
      : { acao: 'publicar', disponivel: false, texto: textoDoCatalogo((m) => c(m).proximoDoDono(t.id, tagDoModo(t.modo))),
          comando: comandoDoDono(leitura.remoto, leitura.base, f.branch, tituloDoPr(t, corpo?.texto ?? null),
            corpo ? path.relative(raiz, corpo.arquivo) : null) };
  } else if (prEtapa.estado === 'nao-lida') proximo = nada(prEtapa.texto, `ork ship pista ${t.id}`);
  else if (conflitoEtapa.estado === 'falhou') proximo = nada(textoDoCatalogo((m) => c(m).proximoConflito(pr?.numero ?? 0)));
  else if (ciEtapa.estado === 'falhou') proximo = nada(textoDoCatalogo((m) => c(m).proximoCiVermelho(leitura.contexto, pr?.numero ?? 0)));
  else if (ciEtapa.estado === 'pendente' || ciEtapa.estado === 'nao-lida') {
    proximo = nada(textoDoCatalogo((m) => c(m).proximoEsperandoCi(leitura.contexto, pr?.numero ?? 0)),
      pr ? `ork ci status --sha ${pr.head}` : null);
  } else proximo = nada(textoDoCatalogo((m) => pr?.rascunho ? c(m).proximoRascunho(pr.numero) : c(m).proximoMerge(pr?.numero ?? 0)));

  return {
    thread: t.id, nome: t.nome, modo: t.modo, tag: tagDoModo(t.modo), publicavel, conduzida: !!f.conducao, branch: f.branch, head: f.head,
    remota, pr: pr ? { numero: pr.numero, url: pr.url, estado: pr.estado, rascunho: pr.rascunho, head: pr.head } : null,
    etapas: [f.check, f.verify, f.bundle, branchEtapa, prEtapa, ciEtapa, conflitoEtapa, entregaEtapa], proximo,
  };
}

/** `ork ship pista [<thread>]`: as etapas e o proximo passo de cada thread aberta que ja esta na entrega. Nao grava nada. */
export function pistaDeEntrega(carregado: ManifestoCarregado, opcoes: OpcoesDaPista = {}): PistaDeEntrega {
  const raiz = carregado.raiz, base = carregado.manifesto.worktree.base_branch;
  const remoto = exigirRemoto(opcoes.remoto ?? 'origin', 'ship');
  const lidoEm = opcoes.quando ?? new Date().toISOString();
  const contexto = carregado.manifesto.ci.context || 'ork-verify';
  const ciExigido = carregado.manifesto.ci.required_for_ship === true;
  const refs = refsLocais(raiz, remoto);
  const baseRef = refDaBase(refs, remoto, base);
  const ids = opcoes.thread ? [opcoes.thread] : listarIds(raiz);
  const fatos: FatosDaThread[] = [];
  for (const id of ids) {
    let t: Thread;
    try { t = lerThread(raiz, id); } catch { if (opcoes.thread) throw new Error(`ship.pista: a thread ${id} nao existe`); continue; }
    if (t.status === 'fechada') continue;
    fatos.push(fatosDaThread(carregado, t, refs, baseRef, lidoEm));
  }
  const comBranch = fatos.filter((f) => f.head && branchValida(f.branch));
  const remotas = comBranch.length ? pontasNoRemoto(raiz, remoto) : new Map<string, string>();
  const locais = new Map(fatos.map((f) => [f.t.id, entregaLocal(raiz, f, remotas, remoto, base)] as const));
  // A7 da revisao: so a branch da thread que ja esta na entrega pelo que se le sem a forja vai a leitura dos PRs, que
  // confere uma a uma a que nao aparece nas listas; sem nenhuma, a forja nem e lida.
  const candidatas = comBranch.filter((f) => locais.get(f.t.id)?.naEntrega === true).map((f) => f.branch);
  let prs: PrDaForja[] | null = [];
  let prsNaoLidos: string | null = null;
  let parcial = false;
  let semConferir: ReadonlySet<string> = new Set<string>();
  if (candidatas.length) {
    const leitura = lerPrsDaForja(carregado, { quando: lidoEm, executor: opcoes.executorGh, remoto, candidatas, forja: opcoes.forja });
    if (leitura.ok) {
      prs = leitura.retrato.prs;
      parcial = leitura.retrato.parcial;
      semConferir = new Set(leitura.retrato.semConferir ?? []);
    } else {
      prs = null;
      prsNaoLidos = deFora(leitura.erro);
    }
  }
  // S8 da revisao (rodada 2): a candidata sem nenhum PR na leitura foi conferida uma a uma pelo `--head`, que a lista
  // cortada nao limita; so a que nao foi conferida, ou que so tem PR achado na lista cortada, fica em duvida.
  const comPrNaLeitura = new Set((prs ?? []).map((x) => x.branch));
  const conferida = (branch: string) => candidatas.includes(branch) && !comPrNaLeitura.has(branch);
  const corte = (branch: string): CorteDaLeitura => (semConferir.has(branch) ? 'sem-conferir'
    : parcial && !conferida(branch) ? 'parcial' : null);
  const pistas = fatos.flatMap((f) => {
    const local = locais.get(f.t.id);
    const x = local ? pistaDaThread(carregado, f, local, { remoto, base, remotasLidas: remotas !== null, prs, prsNaoLidos, corte, ciExigido, contexto })
      : null;
    return x ? [x] : [];
  });
  return { contrato: CONTRATO_DA_PISTA, lidoEm, base, remoto, remotoLido: remotas !== null, prsLidos: prs !== null, prsNaoLidos,
    ciExigido, contextoDoCi: contexto, pistas };
}

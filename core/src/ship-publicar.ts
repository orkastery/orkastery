/**
 * RM-059 (fatia F7, T7.1; DD4 do plano dos mods): a publicacao provada da branch e do PR, e a pista da entrega.
 *
 * Ate aqui, quem publicava a branch de uma thread #Auto e abria o PR era o script do condutor externo, fora do
 * nucleo e sem prova pelo remoto. O `ork ship publicar` faz o mesmo pelo nucleo, e so no modo que ja autoriza o
 * push pela #TAG (#Auto e #Maestro, a mesma lista do `ork ship`):
 *
 *  1. confere, antes de qualquer efeito, a thread, o modo, a conducao, a branch, o CHECK, o verify e o bundle no
 *     HEAD, o remoto e os PRs da branch; a recusa volta tipada e nada vai ao ledger (D2 da thread ork-rm059pista);
 *  2. empurra a branch sem forca, com refspec explicito, e prova pelo `git ls-remote` (a prova do `ork ship`);
 *  3. reaproveita o PR aberto da branch ou abre um com o `pr-body.md` da thread, e prova pela releitura da lista;
 *  4. grava `ship_published` com a prova, so quando houve efeito. Repetido, devolve `ja-publicada`.
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
import { BundleCi } from './ci';
import { lerClaims } from './claims';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import {
  conducaoAgora, ExecutorDoGh, ghPadrao, githubDoRemoto, lerPrsDaForja, PrDaForja, prDaForja, refsLocais,
} from './parado-no-condutor';
import { mergeDaEntrega } from './entrega-pr';
import { estadoDoArtefato, vereditoDoParecer } from './session-watcher-claude';
import { dirThread, lerThread, listarIds } from './thread';
import { ConducaoAtual, EventoLedger, MotivoGate, Thread } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';
import { Mensagens, textoDoCatalogo } from './locale';

export const CONTRATO_DA_PUBLICACAO = 'ork.ship-publicar/v1' as const;
export const CONTRATO_DA_PISTA = 'ork.ship-pista/v1' as const;

/** Os modos em que a #TAG ja autoriza o push (`autorizacaoDePush`, `core/src/ship.ts`): o `publicar` so age neles. */
export const MODOS_QUE_PUBLICAM: readonly Thread['modo'][] = ['auto', 'maestro'];

const SHA = /^[0-9a-f]{40}$/;
/** O `pr-body.md` maior que isto nao e corpo de PR: o `publicar` usa o corpo padrao. */
const TETO_DO_CORPO = 64 * 1024;
const PRAZO_DO_GH_MS = 60000;
const PRAZO_DO_PUSH_MS = 300000;
const PRAZO_DO_LS_REMOTE_MS = 120000;
/** Os campos do `gh pr list` de uma branch: os do `prDaForja`, com o estado de merge do PR aberto. */
const CAMPOS_DA_BRANCH = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt,mergeable';

/** Git local sem rede escondida nem pergunta de credencial no terminal. */
function git(raiz: string, args: string[], prazoMs = 60000) {
  return exec('git', args, raiz, prazoMs, { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
}

const curto = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : '-');

/** Texto curto de fora (stderr do git ou do gh): uma linha, sem controle, com teto. */
function umaLinha(texto: string, teto = 200): string {
  return Array.from(texto.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('') || '-';
}

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

/** O ultimo commit de produto da branch (merge e `ci(` nao contam), com a hora do commit. */
function ultimoCommitDeProduto(raiz: string, baseRef: string | null, head: string): { sha: string; em: number } | null {
  const r = git(raiz, ['log', '--no-merges', '--format=%H%x09%ct%x09%s', baseRef ? `${baseRef}..${head}` : head, '-n', '200']);
  if (!r.ok) return null;
  for (const linha of r.stdout.split('\n')) {
    const [sha, ct, assunto] = linha.split('\t');
    if (!sha || !SHA.test(sha) || (assunto ?? '').startsWith('ci(')) continue;
    const em = Number(ct) * 1000;
    if (Number.isFinite(em)) return { sha, em };
  }
  return null;
}

/** O CHECK: exatamente um veredito, PASSOU, gravado depois do ultimo commit de produto. */
function conferirCheck(raiz: string, t: Thread, baseRef: string | null, head: string | null): { etapa: EtapaDaPista; passou: boolean } {
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

/** O verify: o ultimo `verify_run` passou, no HEAD ou num ancestral dele com so `.ork-ci/` mudando depois. */
function conferirVerify(raiz: string, eventos: readonly EventoLedger[], head: string | null): EtapaDaPista {
  const ultimo = [...eventos].reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.verificacao);
  if (!ultimo) return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyAusente));
  const commit = typeof ultimo.commit === 'string' && SHA.test(ultimo.commit) ? ultimo.commit : null;
  if (ultimo.veredito !== 'verdade sustentada') {
    const motivos = Array.isArray(ultimo.motivos) ? ultimo.motivos.map(String).join(', ') : '';
    return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyReprovou(curto(commit), motivos || '-')));
  }
  if (!commit || !head) return etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyAntigo(curto(commit))));
  if (commit === head) return etapa('verify', 'feita', textoDoCatalogo((m) => m.ship.publicar.verifyNoHead(curto(head))));
  const ancestral = git(raiz, ['merge-base', '--is-ancestor', commit, head]).ok;
  const diff = ancestral ? git(raiz, ['diff', '--name-only', '--no-renames', commit, head]) : null;
  const soBundle = !!diff?.ok && diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean).every((l) => l.startsWith('.ork-ci/'));
  return soBundle ? etapa('verify', 'feita', textoDoCatalogo((m) => m.ship.publicar.verifySoBundle(curto(commit))))
    : etapa('verify', 'pendente', textoDoCatalogo((m) => m.ship.publicar.verifyAntigo(curto(commit))));
}

/** O bundle no HEAD: desta thread, desta branch e com exatamente as claims ativas (sem claim retirada nem faltando). */
function conferirBundle(raiz: string, t: Thread, branch: string, head: string | null): EtapaDaPista {
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
  let ativas: string[] = [];
  try { ativas = lerClaims(raiz, t.id).filter((c) => c.estado !== 'retirada').map((c) => c.id); } catch { /* sem claims: lista vazia */ }
  const faltam = ativas.filter((id) => !noBundle.has(id));
  const sobram = [...noBundle].filter((id) => !ativas.includes(id));
  if (faltam.length || sobram.length) {
    return etapa('bundle', 'pendente', textoDoCatalogo((m) => m.ship.publicar.bundleVelho(faltam.join(', '), sobram.join(', '))));
  }
  return etapa('bundle', 'feita', textoDoCatalogo((m) => m.ship.publicar.bundleFeito(ativas.length)));
}

function fatosDaThread(raiz: string, t: Thread, refs: Map<string, string>, baseRef: string | null, quando: string): FatosDaThread {
  let eventos: EventoLedger[] = [];
  try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { /* ledger ilegivel: sem verify nem conducao provada */ }
  const branch = branchDaWorktree(t);
  const head = branchValida(branch) ? refs.get(`refs/heads/${branch}`) ?? null : null;
  const contagem = head && baseRef ? git(raiz, ['rev-list', '--count', `${baseRef}..${head}`]) : null;
  const comProduto = !!contagem?.ok && Number(contagem.stdout.trim()) > 0;
  const check = conferirCheck(raiz, t, baseRef, head);
  return {
    t, eventos, branch, head, comProduto, conducao: conducaoAgora(raiz, t, eventos, quando),
    check: check.etapa, checkPassou: check.passou, verify: conferirVerify(raiz, eventos, head), bundle: conferirBundle(raiz, t, branch, head),
  };
}

/** A base de comparacao: a copia do remoto primeiro (a base local desta maquina pode estar parada). */
function refDaBase(refs: Map<string, string>, remoto: string, base: string): string | null {
  return [`refs/remotes/${remoto}/${base}`, `refs/heads/${base}`].find((r) => refs.has(r)) ?? null;
}

// ---------------------------------------------------------------------------
// O remoto e a forja.
// ---------------------------------------------------------------------------

/** A ponta da branch no remoto pelo `ls-remote`: `null` quando ela nao exista la; `erro` quando o git nao respondeu. */
function pontaNoRemoto(raiz: string, remoto: string, branch: string): { sha: string | null; erro: string | null } {
  const r = git(raiz, ['ls-remote', '--', remoto, `refs/heads/${branch}`], PRAZO_DO_LS_REMOTE_MS);
  if (!r.ok) return { sha: null, erro: umaLinha(r.stderr || r.stdout || `codigo ${r.code}`) };
  const linha = r.stdout.split('\n').find((l) => l.trim() !== '');
  const sha = linha ? linha.split(/\s+/)[0] : '';
  return { sha: SHA.test(sha) ? sha : null, erro: null };
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

/** Os PRs de uma branch, da base do projeto, do mais novo para o mais velho. */
function prsDaBranch(executor: ExecutorDoGh, forja: Forja, base: string, branch: string): { prs: PrDaForja[]; erro: string | null } {
  const r = executor(['pr', 'list', `--repo=${forja.host}/${forja.repositorio}`, `--head=${branch}`, '--state=all', '--limit=10',
    `--json=${CAMPOS_DA_BRANCH}`], PRAZO_DO_GH_MS);
  if (r.status !== 0) return { prs: [], erro: umaLinha(r.stderr || r.stdout || `codigo ${r.status ?? '-'}`) };
  try {
    const lista = JSON.parse(r.stdout) as unknown;
    if (!Array.isArray(lista)) throw new Error('a resposta nao e uma lista');
    const prs = lista.map((p) => prDaForja(p, base)).filter((p): p is PrDaForja => !!p && p.branch === branch);
    return { prs: prs.sort((a, b) => b.numero - a.numero), erro: null };
  } catch (e) {
    return { prs: [], erro: umaLinha((e as Error).message) };
  }
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
    return { arquivo, texto: fs.readFileSync(arquivo, 'utf8') };
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

/** O que o dono roda no proprio terminal quando o modo da thread nao autoriza o push. */
export function comandoDoDono(remoto: string, base: string, branch: string, titulo: string, comCorpo: string | null): string {
  const aspas = (s: string) => `"${s.replace(/["$`]/g, '')}"`;
  return `git push -u ${remoto} ${branch} && gh pr create --base ${base} --head ${branch} --title ${aspas(titulo)} ` +
    (comCorpo ? `--body-file ${comCorpo}` : '--fill');
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
}

/**
 * `ork ship publicar <thread>`: publica a branch da thread e abre (ou reaproveita) o PR, com prova, so no modo que
 * ja autoriza push. Nunca lanca por reprovacao: a recusa volta tipada e nada vai ao ledger.
 */
export function publicarEntrega(carregado: ManifestoCarregado, threadId: string, opcoes: OpcoesDaPublicacao = {}): Publicacao {
  const raiz = carregado.raiz, base = carregado.manifesto.worktree.base_branch;
  const remoto = exigirRemoto(opcoes.remoto ?? 'origin', 'ship');
  const quando = opcoes.quando ?? new Date().toISOString();
  const dryRun = opcoes.dryRun === true;
  const executor = opcoes.executorGh ?? ghPadrao;
  const t = lerThread(raiz, threadId);
  const r: Publicacao = {
    contrato: CONTRATO_DA_PUBLICACAO, thread: t.id, modo: t.modo, tag: tagDoModo(t.modo), acao: 'recusada', motivo: null,
    detalhe: '', correcao: '', branch: null, base, remoto, head: null, remotaAntes: null, remota: null, pushVerificado: false,
    pr: null, corpo: null, passos: [], dryRun,
  };
  const recusar = (motivo: MotivoGate, detalhe: string, correcao: string): Publicacao =>
    ({ ...r, acao: 'recusada', motivo, detalhe, correcao });
  const p = (m: Mensagens) => m.ship.publicar;

  // 1. A thread aberta.
  if (t.status === 'fechada') {
    return recusar('artifact.missing', textoDoCatalogo((m) => p(m).threadFechada(t.id)), textoDoCatalogo((m) => p(m).threadFechadaCorrecao));
  }
  const refs = refsLocais(raiz, remoto);
  const baseRef = refDaBase(refs, remoto, base);
  const f = fatosDaThread(raiz, t, refs, baseRef, quando);
  r.branch = f.branch;
  r.head = f.head;
  const corpo = corpoDaThread(raiz, t.id);

  // 2. O modo que ja autoriza push (D1): fora dele, o push e do dono, e a correcao diz o comando dele.
  if (!MODOS_QUE_PUBLICAM.includes(t.modo)) {
    const comando = comandoDoDono(remoto, base, f.branch, tituloDoPr(t, corpo?.texto ?? null),
      corpo ? path.relative(raiz, corpo.arquivo) : null);
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
  // 8. O remoto e a forja.
  if (!git(raiz, ['remote', 'get-url', '--', remoto]).ok) {
    return recusar('artifact.missing', textoDoCatalogo((m) => p(m).semRemoto(remoto)), textoDoCatalogo((m) => p(m).semRemotoCorrecao));
  }
  const forja = opcoes.forja ?? githubDoRemoto(raiz, remoto);
  if (!forja) return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).semForja(remoto)), textoDoCatalogo((m) => p(m).semForjaCorrecao));
  // 9. A ponta no remoto e os PRs da branch, antes de qualquer efeito.
  const antes = pontaNoRemoto(raiz, remoto, f.branch);
  r.passos.push(`git ls-remote ${remoto} refs/heads/${f.branch}`);
  if (antes.erro !== null) {
    return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).lsRemoteFalhou(remoto, antes.erro ?? '-')), textoDoCatalogo((m) => p(m).redeCorrecao));
  }
  r.remotaAntes = antes.sha;
  r.remota = antes.sha;
  const lidos = prsDaBranch(executor, forja, base, f.branch);
  r.passos.push(`gh pr list --head ${f.branch} --state all`);
  if (lidos.erro !== null) {
    return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).prsFalharam(lidos.erro ?? '-')), textoDoCatalogo((m) => p(m).redeCorrecao));
  }
  const aberto = lidos.prs.find((x) => x.estado === 'aberto') ?? null;
  const mesclado = lidos.prs.find((x) => x.estado === 'mesclado' && x.head === f.head) ?? null;
  const noRemoto = antes.sha === f.head;
  r.pushVerificado = noRemoto;
  const prExistente = aberto ?? mesclado;
  if (noRemoto && prExistente) {
    return { ...r, acao: 'ja-publicada', pr: { numero: prExistente.numero, url: prExistente.url, criado: false },
      detalhe: textoDoCatalogo((m) => prExistente === aberto ? p(m).jaPublicada(prExistente.numero) : p(m).jaMesclado(prExistente.numero)),
      correcao: prExistente === aberto ? '' : textoDoCatalogo((m) => p(m).registreAEntrega(t.id)) };
  }
  // O remoto com commit que a branch local nao tem: o push sem forca seria recusado. Nunca forcar.
  if (antes.sha && !noRemoto && git(raiz, ['merge-base', '--is-ancestor', antes.sha, f.head]).code === 1) {
    return recusar('tree.blocked', textoDoCatalogo((m) => p(m).remotoDivergiu(remoto, f.branch, curto(antes.sha))),
      textoDoCatalogo((m) => p(m).remotoDivergiuCorrecao(remoto, f.branch)));
  }
  r.corpo = corpo ? 'pr-body.md' : 'padrao';
  const titulo = tituloDoPr(t, corpo?.texto ?? null);

  if (dryRun) {
    const passos = [...r.passos];
    if (!noRemoto) passos.push(`git push -- ${remoto} refs/heads/${f.branch}:refs/heads/${f.branch}`, `git ls-remote ${remoto} refs/heads/${f.branch}`);
    passos.push(aberto ? textoDoCatalogo((m) => p(m).passoReaproveita(aberto.numero))
      : `gh pr create --base ${base} --head ${f.branch} --title "${titulo}" ${corpo ? '--body-file pr-body.md' : '--body <padrao>'}`);
    return { ...r, acao: 'publicaria', passos, pr: aberto ? { numero: aberto.numero, url: aberto.url, criado: false } : null,
      detalhe: textoDoCatalogo((m) => p(m).publicaria(curto(f.head), aberto?.numero ?? null)) };
  }

  // Efeito 1: o push sem forca, provado pelo ls-remote.
  let pushFeito = false;
  if (!noRemoto) {
    const argv = ['push', '--', remoto, `refs/heads/${f.branch}:refs/heads/${f.branch}`];
    const push = git(raiz, argv, PRAZO_DO_PUSH_MS);
    r.passos.push(`git ${argv.join(' ')}`);
    if (!push.ok) {
      const erro = umaLinha(push.stderr || push.stdout || `codigo ${push.code}`, 300);
      const recusado = /rejected|non-fast-forward|fetch first|stale info|failed to update ref/i.test(erro);
      return recusar(recusado ? 'tree.blocked' : 'runtime.unavailable', textoDoCatalogo((m) => p(m).pushFalhou(remoto, f.branch, erro)),
        textoDoCatalogo((m) => recusado ? p(m).remotoDivergiuCorrecao(remoto, f.branch) : p(m).redeCorrecao));
    }
    pushFeito = true;
    const depois = pontaNoRemoto(raiz, remoto, f.branch);
    r.passos.push(`git ls-remote ${remoto} refs/heads/${f.branch}`);
    r.remota = depois.sha;
    r.pushVerificado = depois.sha === f.head;
    if (!r.pushVerificado) {
      return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).pushSemProva(depois.sha ? curto(depois.sha) : null, curto(f.head))),
        textoDoCatalogo((m) => p(m).pushSemProvaCorrecao(t.id)));
    }
  }

  // Efeito 2: o PR aberto da branch, ou um novo, provado pela releitura da lista.
  let pr: PrDaPublicacao | null = aberto ? { numero: aberto.numero, url: aberto.url, criado: false } : null;
  let erroDoPr: string | null = null;
  if (!pr) {
    const argv = ['pr', 'create', `--repo=${forja.host}/${forja.repositorio}`, `--base=${base}`, `--head=${f.branch}`, `--title=${titulo}`,
      ...(corpo ? [`--body-file=${corpo.arquivo}`] : [`--body=${textoDoCatalogo((m) => p(m).corpoPadrao(tagDoModo(t.modo), f.branch, curto(f.head),
        carregado.manifesto.ci.context || 'ork-verify'))}`])];
    const criado = executor(argv, PRAZO_DO_GH_MS);
    r.passos.push(`gh pr create --base ${base} --head ${f.branch}`);
    const relidos = prsDaBranch(executor, forja, base, f.branch);
    r.passos.push(`gh pr list --head ${f.branch} --state all   (prova do PR)`);
    const achado = relidos.prs.find((x) => x.estado === 'aberto') ?? null;
    if (achado) pr = { numero: achado.numero, url: achado.url, criado: criado.status === 0 };
    else {
      erroDoPr = criado.status !== 0 ? umaLinha(criado.stderr || criado.stdout || `codigo ${criado.status ?? '-'}`)
        : relidos.erro ?? textoDoCatalogo((m) => p(m).prSemReleitura);
    }
  }
  r.pr = pr;

  // A evidencia: so com efeito (push ou PR novo), com a prova.
  if (pushFeito || pr?.criado || erroDoPr) {
    registrar(dirThread(raiz, t.id), t.id, TIPOS_DE_EVENTO.shipPublicado, {
      branch: f.branch, base, remoto, head: f.head, remotaAntes: r.remotaAntes, shaRemoto: r.remota, pushFeito,
      pushVerificado: r.pushVerificado, fonteDaProva: `git ls-remote ${remoto} refs/heads/${f.branch}`,
      pr: pr ? { numero: pr.numero, url: pr.url, criado: pr.criado } : null,
      ...(pr ? { provaDoPr: `gh pr list --head ${f.branch} --state all` } : {}),
      ...(erroDoPr ? { erroDoPr } : {}),
      corpo: r.corpo, modo: t.modo, tag: tagDoModo(t.modo),
      autorizadoPor: textoDoCatalogo((m) => m.ship.porTag(tagDoModo(t.modo))), tipoDeAutorizacao: 'modo', passos: r.passos,
    });
  }
  if (erroDoPr) {
    return recusar('runtime.unavailable', textoDoCatalogo((m) => p(m).prFalhou(curto(f.head), erroDoPr ?? '-')),
      textoDoCatalogo((m) => p(m).prFalhouCorrecao(t.id)));
  }
  return { ...r, acao: 'publicou', motivo: null, correcao: '',
    detalhe: textoDoCatalogo((m) => p(m).publicou(curto(f.head), pr?.numero ?? 0, pr?.criado === true)) };
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

/** O PR que vale para a pista: o aberto mais novo, senao o mesclado na ponta, senao o mais novo de todos. */
function prDaBranchNaLista(prs: readonly PrDaForja[], branch: string, head: string | null): PrDaForja | null {
  const daBranch = prs.filter((x) => x.branch === branch).sort((a, b) => b.numero - a.numero);
  return daBranch.find((x) => x.estado === 'aberto') ?? daBranch.find((x) => x.estado === 'mesclado' && x.head === head) ??
    daBranch[0] ?? null;
}

/** O que a pista de uma thread diz, das leituras ja feitas. */
function pistaDaThread(carregado: ManifestoCarregado, f: FatosDaThread, leitura: {
  remoto: string; base: string; remotas: Map<string, string> | null; prs: PrDaForja[] | null; prsNaoLidos: string | null;
  ciExigido: boolean; contexto: string;
}): PistaDaThread | null {
  const { t } = f;
  const raiz = carregado.raiz;
  const remota = leitura.remotas?.get(f.branch) ?? null;
  const pr = leitura.prs ? prDaBranchNaLista(leitura.prs, f.branch, f.head) : null;
  const ships = f.eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
  const entregue = !!f.head && ships.some((e) => e.shaDe === f.head || e.mergeSha === f.head) || (!f.comProduto && ships.length > 0);
  const merge = f.head ? mergeDaEntrega(raiz, t.id, leitura.remoto, leitura.base) : null;
  const mergeSemRegistro = !!merge && !ships.some((e) => e.mergeSha === merge.mergeSha);
  const prMesclado = pr?.estado === 'mesclado' && pr.head === f.head;
  // So entra na pista quem ja esta na entrega: passou do CHECK (ciclo sem CHECK: o turno acabou) com produto, publicou,
  // tem PR, tem merge sem registro ou ja foi entregue e espera o MASTER.
  const passouDoCheck = f.check.estado === 'nao-se-aplica' ? !f.conducao : f.checkPassou;
  const naEntrega = (passouDoCheck && f.comProduto) || (!!remota && f.comProduto) || !!pr || mergeSemRegistro || entregue;
  if (!naEntrega || !f.head) return null;

  const c = (m: Mensagens) => m.ship.publicar;
  const publicavel = MODOS_QUE_PUBLICAM.includes(t.modo);
  // A branch no remoto.
  let branchEtapa: EtapaDaPista;
  if (!leitura.remotas) branchEtapa = etapa('branch', 'nao-lida', textoDoCatalogo((m) => c(m).remotoNaoLido(leitura.remoto)));
  else if (remota === f.head) branchEtapa = etapa('branch', 'feita', textoDoCatalogo((m) => c(m).branchPublicada(curto(f.head))));
  else if (!remota) branchEtapa = etapa('branch', 'pendente', textoDoCatalogo((m) => c(m).branchNaoPublicada));
  else if (git(raiz, ['merge-base', '--is-ancestor', remota, f.head]).code === 1) {
    branchEtapa = etapa('branch', 'falhou', textoDoCatalogo((m) => c(m).remotoDivergiu(leitura.remoto, f.branch, curto(remota))));
  } else branchEtapa = etapa('branch', 'pendente', textoDoCatalogo((m) => c(m).commitsSemPush(curto(remota), curto(f.head))));
  // O PR, o CI e o conflito.
  let prEtapa: EtapaDaPista, ciEtapa: EtapaDaPista, conflitoEtapa: EtapaDaPista;
  if (!leitura.prs) {
    prEtapa = etapa('pr', 'nao-lida', textoDoCatalogo((m) => c(m).prsNaoLidos(leitura.prsNaoLidos ?? '-')));
    ciEtapa = etapa('ci', 'nao-lida', textoDoCatalogo((m) => c(m).prsNaoLidos(leitura.prsNaoLidos ?? '-')));
    conflitoEtapa = etapa('conflito', 'nao-lida', textoDoCatalogo((m) => c(m).prsNaoLidos(leitura.prsNaoLidos ?? '-')));
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
  } else if (f.check.estado === 'pendente') proximo = nada(f.check.texto, `ork phase run ${t.id} CHECK`);
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
    fatos.push(fatosDaThread(raiz, t, refs, baseRef, lidoEm));
  }
  const candidatas = fatos.filter((f) => f.head && branchValida(f.branch)).map((f) => f.branch);
  const remotas = candidatas.length ? pontasNoRemoto(raiz, remoto) : new Map<string, string>();
  let prs: PrDaForja[] | null = [];
  let prsNaoLidos: string | null = null;
  if (candidatas.length) {
    const leitura = lerPrsDaForja(carregado, { quando: lidoEm, executor: opcoes.executorGh, remoto, candidatas, forja: opcoes.forja });
    if (leitura.ok) prs = leitura.retrato.prs;
    else { prs = null; prsNaoLidos = umaLinha(leitura.erro); }
  }
  const pistas = fatos.map((f) => pistaDaThread(carregado, f, { remoto, base, remotas, prs, prsNaoLidos, ciExigido, contexto }))
    .filter((x): x is PistaDaThread => x !== null);
  return { contrato: CONTRATO_DA_PISTA, lidoEm, base, remoto, remotoLido: remotas !== null, prsLidos: prs !== null, prsNaoLidos,
    ciExigido, contextoDoCi: contexto, pistas };
}

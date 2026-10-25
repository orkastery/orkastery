/**
 * `ork thread new|list|status`: o estado da thread em disco.
 *
 * O `thread.json` e a fonte unica da verdade da thread: fases, modo de conducao, base
 * carimbada pelo `ork` (nunca escolhida pelo executor), worktree e sessoes despachadas.
 */

import { exigirPastaDasWorktrees } from './worktree-local';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { aplicarVariante, definicaoDaVariante } from './ciclos';
import { definicaoDoModo, MODOS, ORDEM_DOS_MODOS, tagDoModo } from './modos';
import { dirEstado, ManifestoCarregado } from './manifest';
import { montarSlug, normalizarAssunto, REGEX_SLUG, slugValido } from './slug';
import { createHash } from 'node:crypto';
import {
  BlocoDeLoop, CanalDeConducao, ConducaoAtual, CriterioDePronto, DefinicaoDeModo, EventoLedger, Fase, FASES, Manifesto, Modo, PedidoDaThread,
  SessaoDaThread, Thread, VarianteDeCiclo,
} from './types';
import { agora, COMMIT_DESCONHECIDO, exec, ignorarPastaNoGit, lerJson, shaCurto, tabela } from './util';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { estadoCanonico, raizDoEstado, vincularEstado } from './estado-thread';
import { readCreationOperation, withCreationLock, writeCreationJson } from './creation-operation-store';
import { formatarDataHoraRotulada } from './horario';
import { NOME_DO_MODO } from './check-modo';
import { nomeDaMaquina } from './maquina';
import { linhaDeConducao } from './conducao-texto';
import { ErroDoCatalogo, msg } from './locale';
import { CasoSemWorktree } from './locale-thread';
import { exigirRemoto, refRemota } from './branch-de-estado';
import { eventoDoPreparo, ExecutorDoPreparo, PreparoDasDependencias, prepararDependencias } from './dependencias-da-worktree';

/** Diretorio de threads do projeto. */
export function dirThreads(raiz: string): string {
  return path.join(dirEstado(raizDoEstado(raiz)), 'threads');
}

/** Diretorio de uma thread. */
export function dirThread(raiz: string, id: string): string {
  return estadoCanonico(raiz, id);
}

/** Caminho do `thread.json`. */
export function caminhoThread(raiz: string, id: string): string {
  return path.join(dirThread(raiz, id), 'thread.json');
}

/** Ids das threads existentes, em ordem alfabetica. */
export function listarIds(raiz: string): string[] {
  const dir = dirThreads(raiz);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(caminhoThread(raiz, e.name)))
    .map((e) => e.name)
    .sort();
}

/** Le uma thread do disco. */
export function lerThread(raiz: string, id: string): Thread {
  const caminho = caminhoThread(raiz, id);
  if (!fs.existsSync(caminho)) {
    throw new ErroDoCatalogo((m) => m.thread.naoEncontrada(id, dirThreads(raiz)));
  }
  return lerJson<Thread>(caminho);
}

/** Grava a thread, sempre atualizando o carimbo de alteracao. */
export function gravarThread(raiz: string, thread: Thread): void {
  thread.atualizadaEm = agora();
  writeCreationJson(caminhoThread(raiz, thread.id), thread);
}

/** Carimba a base da thread: branch e commit reais no momento da criacao. */
function carimbarBase(raiz: string): { branch: string; commit: string } {
  const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], raiz);
  const commit = exec('git', ['rev-parse', 'HEAD'], raiz);
  return {
    branch: branch.ok ? branch.stdout.trim() : 'desconhecida',
    commit: commit.ok ? commit.stdout.trim() : COMMIT_DESCONHECIDO,
  };
}

/**
 * Ensaio da 0.5.0: a thread aberta antes do primeiro commit nascia sem base, e nada avisava; o
 * ship depois nao tem de onde partir. O aviso vai ao stderr e nao muda a saida do comando.
 */
export function avisoDeThreadSemBase(thread: Thread, gravada: boolean): string | null {
  if (thread.base.commit !== COMMIT_DESCONHECIDO) return null;
  return msg().thread.semBase(thread.id, gravada);
}

/** Resolve um id livre a partir do assunto normalizado (`<abbrev>-<assunto>`). */
export function idDisponivel(raiz: string, abbrev: string, assunto: string): { id: string; assunto: string } {
  let candidato = assunto;
  let n = 1;
  while (fs.existsSync(dirThread(raiz, `${abbrev}-${candidato}`))) {
    n += 1;
    const sufixo = String(n);
    candidato = assunto.slice(0, 12 - sufixo.length) + sufixo;
  }
  return { id: `${abbrev}-${candidato}`, assunto: candidato };
}

/** Uma worktree isolada por thread, criada e VERIFICADA pelo `ork`. */
export interface WorktreeDaThread {
  dir: string;
  branch: string;
  /** Commit exato de onde a branch da worktree nasceu. */
  commit: string;
}

/** Ajustes da criacao da worktree usados pelas variantes de ciclo do bloco B2. */
export interface OpcoesDeWorktree {
  /** Parte de uma branch que ja existe (ciclo `merge-branch`) em vez de criar uma nova. */
  branchExistente?: string;
  /** Base alternativa a `worktree.base_branch` do manifesto. */
  base?: string;
}

/**
 * Pasta da worktree de uma thread: `worktree.dir` resolvido na arvore principal, nunca na worktree de onde o comando
 * roda. P4 do ensaio da 0.5.0 (CHECK): com a chave valendo, o `ork thread new` rodado de dentro da worktree de outra
 * thread aninhava a nova na pasta da mae, e o release da mae levava a da filha junto.
 */
export function pastaDaWorktree(carregado: ManifestoCarregado, id: string): string {
  return path.resolve(raizDoEstado(carregado.raiz), carregado.manifesto.worktree.dir, id);
}

/** Pasta e branch da worktree de uma thread: o que `criarWorktree` cria e o `--dry-run` preve. */
export function alvoDaWorktree(
  carregado: ManifestoCarregado,
  id: string,
  slug: string,
  opcoes: OpcoesDeWorktree = {}
): Omit<WorktreeDaThread, 'commit'> {
  return { dir: pastaDaWorktree(carregado, id), branch: opcoes.branchExistente ?? `ork/${slug}` };
}

/** P4 do ensaio da 0.5.0: por que a criacao de verdade recusaria a worktree prevista. */
export type FalhaDaWorktree = 'pasta-existe' | 'sem-commit' | 'branch-existe';

export interface WorktreePrevista extends Omit<WorktreeDaThread, 'commit'> {
  /** Commit de onde a worktree partiria; `null` sem commit. */
  commit: string | null;
  /** O que faria a criacao recusar, na ordem em que `criarWorktree` e o git conferem; `null` quando ela nasce. */
  falha: FalhaDaWorktree | null;
}

/**
 * P4 do ensaio da 0.5.0: a worktree que `criarWorktree` criaria para este id, sem criar nada. Mesma pasta, mesma
 * branch e o commit de onde ela partiria: a branch existente (ciclo `merge-branch`), senao a base do manifesto,
 * senao o HEAD. Diz tambem o que faria a criacao recusar: a pasta que ja existe, o repositorio sem commit ou a
 * branch nova que ja existe.
 */
export function worktreePrevista(
  carregado: ManifestoCarregado,
  id: string,
  slug: string,
  opcoes: OpcoesDeWorktree = {}
): WorktreePrevista {
  const alvo = alvoDaWorktree(carregado, id, slug, opcoes);
  const base = opcoes.base ?? carregado.manifesto.worktree.base_branch;
  const remoto = exigirRemoto(carregado.manifesto.fabrica.remoto, 'worktree');
  const refs = opcoes.branchExistente
    ? [opcoes.branchExistente]
    : [refRemota(remoto, base), base, 'HEAD'];
  let commit: string | null = null;
  for (const ref of refs) {
    const r = exec('git', ['rev-parse', '--verify', ref], carregado.raiz);
    if (r.ok) { commit = r.stdout.trim(); break; }
  }
  const branchJaExiste = !opcoes.branchExistente &&
    exec('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${alvo.branch}`], carregado.raiz).ok;
  const falha: FalhaDaWorktree | null = fs.existsSync(alvo.dir) ? 'pasta-existe'
    : commit === null ? 'sem-commit' : branchJaExiste ? 'branch-existe' : null;
  return { ...alvo, commit, falha };
}

/**
 * Resolve a base de uma worktree nova. Com remoto configurado e presente, a fonte e sempre
 * `refs/remotes/<remoto>/<base>` atualizada por um fetch explicito; a branch local pode pertencer a
 * outra worktree e ficar parada indefinidamente. Repositorio sem esse remoto preserva o caso local.
 */
function baseAtualDaWorktree(carregado: ManifestoCarregado, base: string): { ref: string; commit: string } {
  const { raiz, manifesto } = carregado;
  const remoto = exigirRemoto(manifesto.fabrica.remoto, 'worktree');
  const temRemoto = exec('git', ['remote', 'get-url', '--', remoto], raiz).ok;
  let ref = base;
  if (temRemoto) {
    ref = refRemota(remoto, base);
    const ambiente = { ...process.env, GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };
    const fetch = exec('git', ['fetch', '-q', '--no-tags', '--', remoto,
      `+refs/heads/${base}:${ref}`], raiz, 120000, ambiente);
    if (!fetch.ok) {
      const saida = (fetch.stderr || fetch.stdout).trim().split('\n').slice(-2).join(' | ');
      throw new ErroDoCatalogo((m) => m.worktree.baseRemotaFalhou(remoto, base, saida));
    }
  }
  const resolvida = exec('git', ['rev-parse', '--verify', ref], raiz);
  if (!resolvida.ok) {
    // Repositorio local ainda sem a branch do manifesto conserva a recusa historica do
    // `git worktree add ... HEAD`; com remoto presente, o fetch acima ja teria recusado.
    const head = exec('git', ['rev-parse', '--verify', 'HEAD'], raiz);
    return { ref: 'HEAD', commit: head.ok ? head.stdout.trim() : COMMIT_DESCONHECIDO };
  }
  return { ref, commit: resolvida.stdout.trim() };
}

/**
 * Cria a worktree isolada da thread (paralelismo sem colisao entre threads).
 *
 * A base vem de `worktree.base_branch` do manifesto e e resolvida em commit antes do
 * `git worktree add`; depois de criar, o `ork` confere em `git worktree list --porcelain`
 * que a worktree existe de fato, em vez de confiar no codigo de saida do git.
 */
export function criarWorktree(
  carregado: ManifestoCarregado,
  id: string,
  slug: string,
  opcoes: OpcoesDeWorktree = {}
): WorktreeDaThread {
  const { raiz, manifesto } = carregado;
  // RM-047 (P3): worktree.dir do manifesto fora da raiz só cria checkout com a confirmação desta máquina.
  exigirPastaDasWorktrees(raiz, manifesto);
  const { dir, branch } = alvoDaWorktree(carregado, id, slug, opcoes);

  if (fs.existsSync(dir)) {
    throw new ErroDoCatalogo((m) => m.worktree.worktreeJaExisteEm(dir));
  }
  const base = opcoes.base ?? manifesto.worktree.base_branch;
  const resolvida = opcoes.branchExistente
    ? (() => {
        const r = exec('git', ['rev-parse', '--verify', opcoes.branchExistente!], raiz);
        if (!r.ok) throw new ErroDoCatalogo((m) => m.worktree.baseInexistente(opcoes.branchExistente!));
        return { ref: opcoes.branchExistente!, commit: r.stdout.trim() };
      })()
    : baseAtualDaWorktree(carregado, base);
  // Fatia 2 do ensaio da 0.5.0 (P3): a pasta das worktrees que o ork cria agora nasce fora do git.
  const pastaDasWorktrees = path.dirname(dir);
  const pastaNova = !fs.existsSync(pastaDasWorktrees);

  // Branch nova (`-b`) no caso comum; branch que ja existe no ciclo `merge-branch`.
  const argumentos = opcoes.branchExistente
    ? ['worktree', 'add', dir, opcoes.branchExistente]
    : ['worktree', 'add', '-b', branch, dir, resolvida.ref];
  const r = exec('git', argumentos, raiz);
  if (!r.ok) {
    const saida = (r.stderr || r.stdout).trim();
    throw new ErroDoCatalogo((m) => m.worktree.worktreeAddFalhou(saida));
  }
  if (pastaNova) ignorarPastaNoGit(pastaDasWorktrees, raizDoEstado(raiz));
  const lista = exec('git', ['worktree', 'list', '--porcelain'], raiz);
  const criada = lista.ok && lista.stdout.split('\n').some((l) => l.trim() === `worktree ${dir}`);
  if (!criada) {
    throw new ErroDoCatalogo((m) => m.worktree.worktreeNaoApareceu(dir));
  }
  vincularEstado(raiz, id, dir);
  return { dir, branch, commit: resolvida.commit };
}

/**
 * P4 do ensaio da 0.5.0: o que o `ork thread new` pede sobre a worktree. `flag` e `chave` criam a worktree da
 * thread; `diretorio` reusa um que ja existe; `sem-worktree` e `nenhuma` deixam a thread na raiz do projeto.
 */
export type OrigemDoPedidoDeWorktree = 'flag' | 'chave' | 'diretorio' | 'sem-worktree' | 'nenhuma';

/** Por que a thread nova ganhou a worktree (ou ganharia, no `--dry-run`). */
export type OrigemDaWorktree = 'flag' | 'chave' | 'ciclo';

export interface PedidoDeWorktree {
  /** Cria a worktree da thread. */
  criar: boolean;
  /** Diretorio que ja existe (`--worktree DIR`); `null` nos outros casos. */
  dir: string | null;
  origem: OrigemDoPedidoDeWorktree;
}

/**
 * Resolve `--worktree`, `--sem-worktree` e `worktree.por_thread`. As flags vencem a chave; as duas juntas, ou
 * `--sem-worktree` com valor (o parser leva o argumento seguinte), sao erro de uso. `--worktree` sozinho ou `auto`
 * cria a worktree; outro texto e um diretorio que ja existe, como antes.
 */
export function pedidoDeWorktree(
  flags: { worktree?: string | boolean; semWorktree?: string | boolean },
  porThread: boolean
): PedidoDeWorktree {
  const worktree = flags.worktree === false ? undefined : flags.worktree;
  if (typeof worktree === 'string' && !worktree.trim()) throw new Error(msg().thread.worktreeVazia);
  if (typeof flags.semWorktree === 'string') throw new Error(msg().thread.semWorktreeComValor(flags.semWorktree));
  const semWorktree = flags.semWorktree === true;
  if (semWorktree && worktree !== undefined) throw new Error(msg().thread.worktreeESemWorktree);
  if (semWorktree) return { criar: false, dir: null, origem: 'sem-worktree' };
  if (worktree === true || worktree === 'auto') return { criar: true, dir: null, origem: 'flag' };
  if (typeof worktree === 'string') return { criar: false, dir: worktree, origem: 'diretorio' };
  return porThread ? { criar: true, dir: null, origem: 'chave' } : { criar: false, dir: null, origem: 'nenhuma' };
}

/**
 * P4 do ensaio da 0.5.0: a linha que diz de onde veio a worktree da thread nova. Na criacao, so quando ela veio da
 * chave (quem passou `--worktree auto` sabe de onde ela veio); no `--dry-run`, para qualquer origem.
 */
export function linhaDaWorktree(
  por: OrigemDaWorktree | null | undefined,
  gravada: boolean,
  variante?: VarianteDeCiclo | null
): string | null {
  if (!por || (gravada && por !== 'chave')) return null;
  const m = msg().thread;
  if (por === 'chave') return m.worktreeChave(gravada);
  if (por === 'flag') return m.worktreeFlag(gravada);
  return m.worktreeCiclo(gravada, variante ?? null);
}

/**
 * P4 do ensaio da 0.5.0: o que acontece no SHIP com a thread criada por `--sem-worktree`. O `ork ship` entrega a
 * branch em que a raiz estava na criacao (`thread.base.branch`), e a policy `push_direto_na_base` do manifesto barra
 * (`block`), avisa (outro valor) ou deixa passar (sem ela, ou `off`) a entrega de uma branch para ela mesma ou da
 * base. Raiz fora de branch (HEAD destacado ou repositorio sem commit) nao tem branch de origem.
 */
export function avisoDeThreadSemWorktree(thread: Thread, manifesto: Manifesto, gravada = true): string {
  const base = manifesto.worktree.base_branch;
  const branch = thread.base.branch;
  const aviso = (c: CasoSemWorktree) => msg().thread.avisoSemWorktree(thread.id, gravada, c);
  // Sem commit, nem o `ork worktree ensure` tem de onde partir: o caminho e o do aviso de thread sem base.
  if (thread.base.commit === COMMIT_DESCONHECIDO) return aviso({ caso: 'sem-commit' });
  if (branch === 'HEAD') return aviso({ caso: 'head' });
  if (branch !== base) return aviso({ caso: 'outra', branch });
  const policy = manifesto.policies?.push_direto_na_base;
  return aviso({ caso: 'base', base, policy: policy === undefined ? undefined : String(policy) });
}

/**
 * P4 do ensaio da 0.5.0 (CHECK): no `--dry-run`, por que a criacao de verdade recusaria a worktree, em vez de preve-la.
 * O ciclo que exige worktree nao aceita `--sem-worktree`, entao a saida so e sugerida para a chave e a flag.
 */
export function avisoDeWorktreeQueFalharia(f: { motivo: FalhaDaWorktree; dir: string; branch: string; por: OrigemDaWorktree }): string {
  return msg().thread.worktreeFalharia(f.motivo, f.dir, f.branch, f.por === 'ciclo');
}

/** P4 do ensaio da 0.5.0: a worktree que a chave pede nao tem de onde partir num repositorio sem commit. */
export function avisoDeChaveSemCommit(gravada: boolean): string {
  return msg().thread.chaveSemCommit(gravada);
}

/** P4: o aviso de worktree do `ork thread new`, para o stderr, ou `null` quando nao ha o que avisar. */
export function avisoDaWorktree(
  origem: OrigemDoPedidoDeWorktree,
  resultado: { thread: Thread; gravada: boolean; worktreePor?: OrigemDaWorktree | null },
  manifesto: Manifesto
): string | null {
  if (origem === 'sem-worktree') return avisoDeThreadSemWorktree(resultado.thread, manifesto, resultado.gravada);
  if (origem === 'chave' && !resultado.worktreePor) return avisoDeChaveSemCommit(resultado.gravada);
  return null;
}

export interface OpcoesNovaThread {
  /** Somente identidades já persistidas no journal de criação. */
  reservation?: { operationId: string; principal: string; threadId: string };
  nome: string;
  modo: Modo;
  slug?: string;
  assunto?: string;
  worktree?: string | null;
  /** Cria a worktree isolada da thread em vez de reusar um diretorio existente. */
  criarWorktree?: boolean;
  /**
   * P4 do ensaio da 0.5.0: de onde veio o pedido de worktree (`pedidoDeWorktree`). `chave` cria como a flag, mas
   * espera o primeiro commit; `sem-worktree` recusa o ciclo que exige worktree. Ausente, `criarWorktree` vale como flag.
   */
  origemDaWorktree?: OrigemDoPedidoDeWorktree;
  dryRun?: boolean;
  /** Variante de ciclo (`--ciclo greenfield|merge-branch|goal-plan|gap|feature-xl-faseada`). */
  variante?: VarianteDeCiclo | null;
  /** Branch existente de onde a thread parte (obrigatorio no ciclo `merge-branch`). */
  branch?: string;
  /** Fatias previstas no ciclo `feature-xl-faseada`. */
  fatias?: number;
  /**
   * I-43 (D4, viga a): o CHECK desta thread exige runtime diferente do GO.
   *
   * E a viga que sai viva do Objective Envelope. Dentro dele, a regra valia so na
   * criacao e para tres threads que nunca rodaram nada; aqui ela vira propriedade de
   * thread comum, cobrada no portao de despacho.
   */
  exigeRuntimeDiferente?: boolean;
  /** I-43 (D4, viga b): criterios de pronto executaveis, cada um com o comando. */
  doneWhen?: CriterioDePronto[];
  /** I-51 (RM-047): o item do roadmap reservado para esta thread (`--roadmap RM-NNN`). */
  roadmap?: string;
  /** RM-059 (T6.0): o pedido do builder, guardado para o render da fase quando falta `--pedido`. */
  pedido?: string;
  /**
   * RM-037 (CHECK 3 da ork-rm037defeit2): quem abre a thread segurando uma trava (o passo do arco #Noctum, sob o
   * `despacho.lock` e com a reserva feita) não roda o `worktree.dependencias`, que leva até 10 min: a criação grava
   * `worktree_dependencias_pendentes`, e a baseline ou o verify rodam o preparo antes do primeiro comando, já na fila de
   * recursos pesados (`prepararDependenciasPendentes`).
   */
  adiarDependencias?: boolean;
}

/** RM-059 (T6.0): o arquivo do pedido guardado, na pasta da thread. */
export const ARQUIVO_DO_PEDIDO = 'pedido.md';
/**
 * O prompt da fase vai inteiro como UM argumento do `claude --bg`, e o Linux recusa argumento acima de
 * 128 KiB (MAX_ARG_STRLEN); o pedido fica com a metade, para o template caber junto.
 */
export const TETO_DO_PEDIDO = 64 * 1024;

/** O pedido como ele vai ser guardado: sem espaco nas pontas, nao vazio e dentro do teto. */
export function prepararPedido(bruto: string): { texto: string; meta: PedidoDaThread } {
  const texto = bruto.trim();
  if (!texto) throw new ErroDoCatalogo((m) => m.thread.pedidoVazio);
  const bytes = Buffer.byteLength(texto, 'utf8');
  if (bytes > TETO_DO_PEDIDO) throw new ErroDoCatalogo((m) => m.thread.pedidoGrande(bytes, TETO_DO_PEDIDO));
  return { texto, meta: { arquivo: ARQUIVO_DO_PEDIDO, sha256: createHash('sha256').update(texto, 'utf8').digest('hex'), bytes } };
}

/**
 * RM-059 (T6.0): o pedido guardado na criacao da thread, conferido contra o sha256 gravado; `null` na
 * thread criada sem pedido. Arquivo que falta ou que nao bate com o sha256 (editado fora do nucleo) e
 * erro tipado: o render nunca usa um pedido sem a prova de que e o da criacao.
 */
export function pedidoDaThread(raiz: string, thread: Thread): { texto: string; sha256: string } | null {
  const meta = thread.pedido;
  if (!meta) return null;
  const restaurar = 'passe --pedido no render ou restaure o arquivo';
  // O nome do arquivo e fixo: um thread.json editado nao aponta o render para outro arquivo do projeto.
  if (meta.arquivo !== ARQUIVO_DO_PEDIDO || !/^[a-f0-9]{64}$/.test(String(meta.sha256))) {
    throw new Error(`thread.pedido.divergente: o pedido da thread ${thread.id} no thread.json nao e o que a criacao grava; ${restaurar}`);
  }
  const arquivo = path.join(dirThread(raiz, thread.id), ARQUIVO_DO_PEDIDO);
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`thread.pedido.ausente: a thread ${thread.id} guardou o pedido em ${meta.arquivo} e ele sumiu; ${restaurar}`);
    throw new Error(`thread.pedido.divergente: ${meta.arquivo} da thread ${thread.id} nao abre como arquivo comum; ${restaurar}`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > TETO_DO_PEDIDO) throw new Error(`thread.pedido.divergente: ${meta.arquivo} da thread ${thread.id} nao e o arquivo guardado; ${restaurar}`);
    const bytes = fs.readFileSync(fd);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== meta.sha256) {
      throw new Error(`thread.pedido.divergente: ${meta.arquivo} da thread ${thread.id} nao bate com o sha256 gravado na criacao ` +
        `(${shaCurto(meta.sha256)}): foi editado fora do nucleo; ${restaurar}`);
    }
    return { texto: bytes.toString('utf8'), sha256 };
  } finally { fs.closeSync(fd); }
}

/**
 * Grava o pedido sem meio-termo: escreve num temporario com fsync e o liga ao nome final, que nao pode existir
 * (o `link` recusa sobrescrever). Uma falha no meio nao deixa `pedido.md` pela metade.
 */
function gravarPedido(dir: string, texto: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const alvo = path.join(dir, ARQUIVO_DO_PEDIDO);
  const temporario = path.join(dir, `.${ARQUIVO_DO_PEDIDO}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(temporario, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, texto, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(temporario, alvo);
  } finally { fs.rmSync(temporario, { force: true }); }
}

export interface ResultadoNovaThread {
  thread: Thread;
  gravada: boolean;
  /** P4 do ensaio da 0.5.0: por que a thread ganhou a worktree (ou ganharia, no `--dry-run`); `null` sem ela. */
  worktreePor?: OrigemDaWorktree | null;
  /** P4 (CHECK): no `--dry-run`, a worktree pedida que a criacao de verdade recusaria, e por que. */
  worktreeFalharia?: { motivo: FalhaDaWorktree; dir: string; branch: string; por: OrigemDaWorktree } | null;
  /** RM-037 (defeito 2 de 19 e 20/10/2026): o preparo de `worktree.dependencias` na worktree nova; `null` sem ele. */
  dependencias?: PreparoDasDependencias | null;
}

/** Cria a thread: valida modo contra o manifesto, gera o slug e carimba a base. */
export function novaThread(
  carregado: ManifestoCarregado,
  opcoes: OpcoesNovaThread
): ResultadoNovaThread {
  if (opcoes.dryRun) return criarThreadSerializada(carregado, opcoes);
  const criada = withCreationLock(raizDoEstado(carregado.raiz), 'threads', () => criarThreadSerializada(carregado, opcoes));
  // RM-037 (defeito 2 de 19 e 20/10/2026): o preparo das dependencias roda depois da trava de criacao, que espera
  // segundos, e nao os minutos de um `npm ci`.
  if (!criada.gravada || !criada.worktreePor || !criada.thread.worktree) return criada;
  if (opcoes.adiarDependencias) {
    adiarDependenciasDaThread(carregado, criada.thread.id, criada.thread.worktree);
    return { ...criada, dependencias: null };
  }
  return { ...criada, dependencias: prepararDependenciasDaThread(carregado, criada.thread.id, criada.thread.worktree) };
}

/** RM-037 (CHECK 3 da ork-rm037defeit2): a criacao que nao pode esperar o preparo so o anota como pendente. */
function adiarDependenciasDaThread(carregado: ManifestoCarregado, id: string, dir: string): void {
  const { dependencias } = carregado.manifesto.worktree;
  if (!dependencias) return;
  registrar(dirThread(carregado.raiz, id), id, TIPOS_DE_EVENTO.worktreeDependenciasPendentes,
    { dir, comando: dependencias, fonte: 'worktree.dependencias do manifesto' });
}

/**
 * RM-037 (CHECK 3 da ork-rm037defeit2): a worktree `dir` tem o preparo adiado na criacao sem um preparo ok depois dele? O
 * preparo que falhou nao cobre: a baseline e o verify o repetem e recusam seguir enquanto ele falhar.
 */
export function dependenciasPendentes(eventos: readonly EventoLedger[], dir: string): boolean {
  let pendente = false;
  for (const e of eventos) {
    if (typeof e.dir !== 'string' || path.resolve(e.dir) !== path.resolve(dir)) continue;
    if (e.tipo === TIPOS_DE_EVENTO.worktreeDependenciasPendentes) pendente = true;
    else if (e.tipo === TIPOS_DE_EVENTO.worktreeDependencias && e.ok === true) pendente = false;
  }
  return pendente;
}

/**
 * RM-037 (CHECK 3 da ork-rm037defeit2): roda o preparo que a criacao adiou, antes de a baseline ou o verify rodarem um
 * comando, com a vez na fila pesada que eles ja seguram; `antes` so e chamado quando ha preparo a rodar (a renovacao da
 * conducao pelo prazo dele), e o `executor` da operacao, quando ela traz um (o do sandbox do MCP), roda o preparo no lugar
 * do executor do verify. Devolve o preparo rodado agora, ou `null` sem nada pendente; quem chama recusa a falha.
 */
export function prepararDependenciasPendentes(carregado: ManifestoCarregado, id: string, dir: string,
  opcoes: { antes?: () => void; executor?: ExecutorDoPreparo } = {}): PreparoDasDependencias | null {
  if (!dependenciasPendentes(lerLedger(dirThread(carregado.raiz, id)), dir)) return null;
  opcoes.antes?.();
  return prepararDependenciasDaThread(carregado, id, dir, opcoes.executor);
}

/**
 * RM-037 (defeito 2 de 19 e 20/10/2026): roda `worktree.dependencias` na worktree que acabou de nascer e grava o
 * resultado no ledger da thread. Sem a chave no manifesto, nada roda e nada se grava. A falha nao desfaz nada.
 */
export function prepararDependenciasDaThread(carregado: ManifestoCarregado, id: string, dir: string,
  executor?: ExecutorDoPreparo): PreparoDasDependencias | null {
  const comando = carregado.manifesto.worktree.dependencias;
  if (!comando) return null;
  const preparo = prepararDependencias(dir, comando, undefined, executor);
  registrar(dirThread(carregado.raiz, id), id, TIPOS_DE_EVENTO.worktreeDependencias, eventoDoPreparo(dir, preparo));
  return preparo;
}

/**
 * I-42 (D12): variante que redesenha blocos nao cabe num modo de bloco unico e parcial.
 *
 * Regra por desenho, nao por nome: `#Fast` tem um bloco so, com uma fase, e `gap` sobre ele
 * apagaria o ciclo inteiro, enquanto `goal-plan` seria um no-op silencioso. A recusa sai antes
 * de aplicar a variante, com o par variante-modo na mensagem. O `#Auto`, que tambem tem um bloco
 * so mas percorre as seis fases, continua aceitando as duas, porque nelas ha o que redesenhar.
 */
export function exigirVarianteCompativel(variante: VarianteDeCiclo, def: DefinicaoDeModo): void {
  if (!definicaoDaVariante(variante).mudaBlocos) return;
  const [unico, ...resto] = def.blocos;
  if (unico && resto.length === 0 && unico.fases.length < FASES.length) {
    throw new ErroDoCatalogo((m) => m.thread.varianteIncompativel(variante, def.tag, unico.fases.join('-')));
  }
}

function criarThreadSerializada(carregado: ManifestoCarregado, opcoes: OpcoesNovaThread): ResultadoNovaThread {
  const { raiz, manifesto } = carregado;
  const permitidos = manifesto.conduction.allowed_modes;
  if (!permitidos.includes(opcoes.modo)) {
    const tag = MODOS[opcoes.modo].tag, lista = permitidos.map((p) => MODOS[p].tag).join(', ');
    throw new ErroDoCatalogo((m) => m.thread.modoNaoPermitido(tag, lista));
  }

  const assuntoBruto = normalizarAssunto(opcoes.assunto ?? opcoes.nome);
  if (!assuntoBruto) {
    const nome = opcoes.nome;
    throw new ErroDoCatalogo((m) => m.thread.nomeSemAssunto(nome));
  }
  // RM-059 (T6.0): o pedido e conferido antes de qualquer gravacao, tambem no ensaio.
  const pedido = opcoes.pedido !== undefined ? prepararPedido(opcoes.pedido) : null;
  const abbrev = manifesto.project.abbrev;
  const def = definicaoDoModo(opcoes.modo);
  const variante = opcoes.variante ?? null;

  // A variante muda o desenho dos blocos ANTES do slug: a parte 3 do slug vem do
  // primeiro bloco, entao um ciclo `goal-plan` ja nasce com o slug `f12`.
  if (variante) exigirVarianteCompativel(variante, def);
  const blocos = aplicarVariante(def.blocos, variante);
  if (variante) {
    const dv = definicaoDaVariante(variante);
    if (dv.exigeBranch && !opcoes.branch) {
      throw new ErroDoCatalogo((m) => m.thread.cicloExigeBranch(variante));
    }
    const branch = opcoes.branch;
    if (branch) {
      const existe = exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`], raiz);
      if (!existe.ok) {
        throw new ErroDoCatalogo((m) => m.thread.branchInexistente(branch));
      }
    }
  } else if (opcoes.branch) {
    throw new ErroDoCatalogo((m) => m.thread.branchSemCiclo);
  }
  // `greenfield`, `merge-branch` e `feature-xl-faseada` exigem worktree isolada: sao os
  // ciclos que escrevem codigo em paralelo com outras threads.
  const exigeWorktree = variante ? definicaoDaVariante(variante).exigeWorktree : false;
  // P4 do ensaio da 0.5.0 (D4): o ciclo que exige worktree nao nasce sem ela, e a recusa sai antes de gravar.
  if (exigeWorktree && opcoes.origemDaWorktree === 'sem-worktree') {
    throw new Error(`o ciclo ${variante} exige worktree isolada: crie a thread sem --sem-worktree ou escolha outro ciclo`);
  }

  const reservation = opcoes.reservation;
  const operation = reservation ? readCreationOperation(raiz, reservation.operationId, reservation.principal) : null;
  if (operation && (!operation.reserved.threadIds.includes(reservation!.threadId)
    || !reservation!.threadId.startsWith(abbrev + '-') || !operation.reserved.ticketId
    || operation.request.mode !== opcoes.modo || ['compensating', 'compensated', 'compensation_failed'].includes(operation.state)
    || opcoes.criarWorktree || opcoes.worktree || opcoes.variante || opcoes.slug || opcoes.dryRun)) {
    throw new Error('creation.conflict: reserva de thread incompatível');
  }
  const origin = operation ? { operationId: operation.operationId, ticketId: operation.reserved.ticketId!, requestHash: operation.requestHash } : undefined;
  if (reservation && fs.existsSync(caminhoThread(raiz, reservation.threadId))) {
    const existing = lerThread(raiz, reservation.threadId);
    if (existing.creationOrigin?.operationId !== origin!.operationId || existing.creationOrigin?.ticketId !== origin!.ticketId
      || existing.creationOrigin?.requestHash !== origin!.requestHash || existing.modo !== opcoes.modo || existing.nome !== opcoes.nome) {
      throw new Error('creation.conflict: thread reservada pertence a outra intenção');
    }
    if (!lerLedger(dirThread(raiz, existing.id)).some((event) => event.tipo === TIPOS_DE_EVENTO.threadCriada)) {
      registrar(dirThread(raiz, existing.id), existing.id, TIPOS_DE_EVENTO.threadCriada, { creationOrigin: origin, recovered: true });
    }
    return { thread: existing, gravada: false };
  }
  if (reservation && fs.existsSync(dirThread(raiz, reservation.threadId))
    && fs.readdirSync(dirThread(raiz, reservation.threadId)).some((name) => !/^\.thread\.json\..+\.tmp$/.test(name))) {
    throw new Error('creation.conflict: diretório reservado sem origem confirmada');
  }
  // P4 do ensaio da 0.5.0 (CHECK): o ensaio usa o mesmo id livre da criacao (o `idDisponivel` so le o disco), para a
  // worktree que ele mostra ser a que a criacao usaria.
  const { id, assunto } = reservation
    ? { id: reservation.threadId, assunto: reservation.threadId.slice(abbrev.length + 1) }
    : idDisponivel(raiz, abbrev, assuntoBruto);

  const slug = opcoes.slug ?? montarSlug(abbrev, assunto, blocos[0].slugFases);
  // O override `--slug` do builder tambem passa pela regex canonica.
  if (!slugValido(slug)) {
    throw new ErroDoCatalogo((m) => m.thread.slugInvalido(slug, REGEX_SLUG.source));
  }

  const thread: Thread = {
    ...(origin ? { creationOrigin: origin } : {}),
    id,
    slug,
    nome: opcoes.nome,
    assunto,
    modo: opcoes.modo,
    fases: blocos.flatMap((b) => b.fases),
    blocos,
    faseAtual: blocos[0].fases[0],
    status: 'aberta',
    criadaEm: agora(),
    atualizadaEm: agora(),
    projeto: { name: manifesto.project.name, abbrev },
    maquina: nomeDaMaquina(),
    ...(opcoes.roadmap ? { roadmap: opcoes.roadmap } : {}),
    base: carimbarBase(raiz),
    worktree: opcoes.worktree ?? null,
    sessoes: [],
    ...(opcoes.exigeRuntimeDiferente === true ? { exigeRuntimeDiferente: true } : {}),
    ...(opcoes.doneWhen && opcoes.doneWhen.length > 0 ? { doneWhen: opcoes.doneWhen } : {}),
    ...(pedido ? { pedido: pedido.meta } : {}),
    decisoes: [],
    claims: [],
    leases: [],
    baseline: null,
    variante,
    score: null,
  };
  if (variante === 'feature-xl-faseada') thread.fatias = opcoes.fatias ?? 3;

  // P4 do ensaio da 0.5.0: por que a thread ganha a worktree. O ensaio e a chave preveem a worktree antes; a pedida
  // por flag ou por ciclo segue direto ao git, como era. A pedida so pela chave espera o primeiro commit (D3): sem
  // commit, a thread fica na raiz, como antes. O ciclo que exige worktree vence a chave e a flag na origem: a worktree
  // e dele, e o `--sem-worktree` que a linha da chave sugeriria ele recusa (CHECK, rodada 2).
  const pedeWorktree = opcoes.criarWorktree === true || exigeWorktree;
  const pelaChave = opcoes.criarWorktree === true && opcoes.origemDaWorktree === 'chave';
  const prevista = pedeWorktree && (opcoes.dryRun || pelaChave)
    ? worktreePrevista(carregado, id, slug, { branchExistente: opcoes.branch }) : null;
  const worktreePor: OrigemDaWorktree | null =
    !pedeWorktree || (pelaChave && !exigeWorktree && prevista?.falha === 'sem-commit') ? null
      : exigeWorktree ? 'ciclo' : pelaChave ? 'chave' : 'flag';

  if (opcoes.dryRun) {
    // P4 (D8): o ensaio mostra a worktree que a criacao usaria; quando ela recusaria, diz por que, em vez de preve-la.
    if (worktreePor && prevista?.falha) {
      return { thread, gravada: false, worktreePor: null,
        worktreeFalharia: { motivo: prevista.falha, dir: prevista.dir, branch: prevista.branch, por: worktreePor } };
    }
    if (worktreePor && prevista?.commit) {
      thread.worktree = prevista.dir;
      thread.base = { branch: prevista.branch, commit: prevista.commit };
    }
    return { thread, gravada: false, worktreePor };
  }

  // P4 (CHECK): a worktree pedida so pela chave, com a pasta ou a branch ja ocupadas, recusa dizendo de onde veio o
  // pedido e qual e a saida.
  const ocupadaPelaChave = pelaChave && !exigeWorktree && prevista &&
    (prevista.falha === 'pasta-existe' || prevista.falha === 'branch-existe') ? prevista : null;
  if (ocupadaPelaChave) {
    const pasta = ocupadaPelaChave.falha === 'pasta-existe';
    const alvo = pasta ? ocupadaPelaChave.dir : ocupadaPelaChave.branch;
    throw new ErroDoCatalogo((m) => m.thread.ocupadaPelaChave(pasta, alvo));
  }

  let worktreeCriada: WorktreeDaThread | null = null;
  if (worktreePor) {
    worktreeCriada = criarWorktree(carregado, id, slug, {
      branchExistente: opcoes.branch,
    });
    thread.worktree = worktreeCriada.dir;
    thread.base = {
      branch: worktreeCriada.branch,
      commit: worktreeCriada.commit,
    };
  }

  // RM-059 (T6.0): o pedido vai ao lado do thread.json, so com permissao do dono, como ele, e antes dele: o
  // thread.json nunca aponta para um pedido que nao foi gravado.
  if (pedido) gravarPedido(dirThread(raiz, id), pedido.texto);
  gravarThread(raiz, thread);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.threadCriada, {
    ...(origin ? { creationOrigin: origin } : {}),
    slug,
    modo: opcoes.modo,
    tag: def.tag,
    blocos: def.blocos.map((b) => ({ fases: b.fases, pausa: b.pausa, slug: b.slugFases })),
    pausas: blocos.filter((b) => b.pausa).length,
    base: thread.base,
    projeto: manifesto.project.name,
    worktree: thread.worktree,
    // P4 do ensaio da 0.5.0 (D9): quem abriu a thread sem worktree de proposito fica no rastro.
    ...(opcoes.origemDaWorktree === 'sem-worktree' ? { semWorktree: true } : {}),
    variante,
    branchDeOrigem: opcoes.branch ?? null,
    maquina: thread.maquina,
    ...(thread.roadmap ? { roadmap: thread.roadmap } : {}),
    ...(pedido ? { pedido: pedido.meta } : {}),
  });
  if (worktreeCriada) {
    registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeCriada, {
      dir: worktreeCriada.dir,
      branch: worktreeCriada.branch,
      base: manifesto.worktree.base_branch,
      origem: worktreePor,
      fonte: 'git worktree list --porcelain',
    });
  }
  return { thread, gravada: true, worktreePor };
}

/**
 * O bloco de loop que conduz a fase DESTA thread.
 *
 * Le `thread.blocos`, nao a matriz do modo: uma variante de ciclo (`--ciclo goal-plan`,
 * `--ciclo gap`) redesenha os blocos da thread, e o prompt e o slug precisam seguir o
 * desenho que a thread realmente tem.
 */
export function blocoDaThread(thread: Thread, fase: Fase): BlocoDeLoop {
  const achado = thread.blocos.find((b) => b.fases.includes(fase));
  if (!achado) {
    throw new Error(`fase ${fase} nao pertence a nenhum bloco da thread ${thread.id}`);
  }
  return achado;
}

/** A fase pausa para o humano ao fechar seu bloco NESTA thread? */
export function pausaNaThread(thread: Thread, fase: Fase): boolean {
  const b = blocoDaThread(thread, fase);
  return b.pausa && b.fases[b.fases.length - 1] === fase;
}

/** Pausas humanas do ciclo real da thread (modo + variante). */
export function pausasDaThread(thread: Thread): number {
  return thread.blocos.filter((b) => b.pausa).length;
}

/** Texto do resumo de uma thread recem-criada ou consultada. */
/** I-36 (T10): o canal de origem de uma sessao; a de antes do campo le como `desconhecido`, nunca `cli`. */
export function canalDaSessao(s: SessaoDaThread): CanalDeConducao | 'desconhecido' {
  return s.canal ?? 'desconhecido';
}

export function resumoDaThread(thread: Thread, conducao?: ConducaoAtual | null): string {
  const def = definicaoDoModo(thread.modo);
  const m = msg().thread, r = m.rotulos;
  // RM-061 (F2a): o rotulo vem do catalogo, na largura do locale; o valor gravado (nome, criterio) sai como esta.
  const campo = (rotulo: string, valor: string) => `  ${rotulo.padEnd(m.largura)} ${valor}`;
  const linhas: string[] = [];
  linhas.push(campo(r.id, thread.id));
  linhas.push(campo(r.slug, thread.slug));
  linhas.push(campo(r.nome, thread.nome));
  linhas.push(campo(r.modo, m.modo(def.tag, pausasDaThread(thread))));
  linhas.push(campo(r.ciclo, thread.variante ?? m.cicloPadrao));
  linhas.push(campo(r.fase, thread.faseAtual));
  linhas.push(campo(r.status, m.status(thread.status)));
  linhas.push(campo(r.base, `${thread.base.branch} @ ${shaCurto(thread.base.commit)}`));
  linhas.push(campo(r.worktree, thread.worktree ?? m.raizDoProjeto));
  // I-36 (T17): quem passa a leitura da conducao ve a linha unica; sem ela o resumo fica como era.
  if (conducao !== undefined) linhas.push(campo(r.conducao, conducao ? linhaDeConducao(conducao) : m.ninguemConduz));
  // I-43 (D4, viga a): a exigencia so aparece quando existe, para nao poluir o resumo
  // das threads que nao a declararam.
  if (thread.exigeRuntimeDiferente === true) linhas.push(m.validacao);
  // I-43 (D4, viga b): o criterio aparece COM o comando. Mostrar so o criterio seria
  // reproduzir a prosa do envelope numa tela nova.
  if (thread.doneWhen && thread.doneWhen.length > 0) {
    linhas.push(m.prontoQuando(thread.doneWhen.length));
    for (const d of thread.doneWhen) linhas.push(`    ${d.criterio}\n      $ ${d.comando}`);
  }
  if (thread.score) {
    linhas.push(campo(r.score, m.score(thread.score.valor, thread.score.avaliadoPor, thread.score.regime,
      formatarDataHoraRotulada(thread.score.avaliadoEm))));
  }
  // RM-072 (D17): o modo do ultimo CHECK, so quando a thread ja teve verify.
  if (thread.check) {
    linhas.push(campo(r.check, m.check(NOME_DO_MODO[thread.check.modo], thread.check.origem, formatarDataHoraRotulada(thread.check.em),
      shaCurto(thread.check.commit))));
  }
  linhas.push(m.blocosPrevistos);
  for (const b of thread.blocos) {
    const marca = b.pausa ? m.pausaPrevista(m.pausaSobre(b.pausaSobre)) : m.semPausa;
    linhas.push(`    ${b.slugFases.padEnd(6)} ${b.fases.join('-').padEnd(18)} ${marca}`);
  }
  return linhas.join('\n');
}

/** Uma linha de `ork thread list`, tambem usada pelo `--json`. */
export interface LinhaDaListagem {
  id: string;
  slug: string;
  modo: string;
  tag: string;
  fase: Fase;
  status: Thread['status'];
  pausas: number;
  sessoes: number;
}

export interface OpcoesListagem {
  /** `--todas`: inclui as fechadas. O default mostra so o que ainda pede atencao. */
  todas?: boolean;
}

/**
 * As threads de `ork thread list`, ja filtradas.
 *
 * I-43 (D8): o DEFAULT mostra o que NAO esta fechado, e nao "so as abertas".
 * O GOAL pediu "so abertas", e a medida corrigiu o pedido: existe thread `pausada`
 * em disco, e um default que a esconde esconde justamente a que mais pede atencao.
 *
 * O custo medido era o default: 137 linhas para as 31 que interessavam, e 71 delas
 * (52 por cento) eram `Sessao adotada claude-bg <uuid>`, lixo do mecanismo de adocao.
 * Quem pagava era quem nao sabia que existia flag.
 */
export function threadsDaListagem(raiz: string, opcoes: OpcoesListagem = {}): LinhaDaListagem[] {
  return listarIds(raiz)
    .map((id) => lerThread(raiz, id))
    .filter((t) => opcoes.todas === true || t.status !== 'fechada')
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      modo: String(t.modo),
      tag: tagDoModo(t.modo),
      fase: t.faseAtual,
      status: t.status,
      pausas: pausasDaThread(t),
      sessoes: t.sessoes.length,
    }));
}

/** Tabela de `ork thread list`. */
export function tabelaDeThreads(raiz: string, opcoes: OpcoesListagem = {}): string {
  const linhas = threadsDaListagem(raiz, opcoes);
  // RM-061 (F3b): o texto pelo catalogo; o status (dado do `--json`) so se traduz na impressao, pelo id.
  const mt = msg().thread;
  if (linhas.length === 0) {
    // A divida paga aqui: a mensagem sugeria `--modo default`, um modo que
    // `parseModo` recusa, e e a origem provavel das 3 threads com `modo: default`
    // gravadas em disco. A sugestao agora e um modo que existe.
    return mt.listaVazia(opcoes.todas === true, ORDEM_DOS_MODOS[0]);
  }
  const corpo = linhas.map((l) => [
    l.id, l.slug, l.tag, l.fase, mt.status(l.status), String(l.pausas), String(l.sessoes),
  ]);
  const t = tabela([...mt.colunasDaLista], corpo);
  if (opcoes.todas === true) return t;
  const fechadas = listarIds(raiz).length - linhas.length;
  return fechadas > 0 ? `${t}\n\n${mt.fechadasOmitidas(fechadas)}` : t;
}

/** Fase valida e pertencente ao ciclo da thread. */
export function exigirFase(thread: Thread, bruto: string): Fase {
  const fase = bruto.toUpperCase() as Fase;
  if (!thread.fases.includes(fase)) {
    throw new Error(msg().phase.faseInvalida(bruto, thread.fases.join(', ')));
  }
  return fase;
}

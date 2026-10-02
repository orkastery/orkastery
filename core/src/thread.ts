/**
 * `ork thread new|list|status`: o estado da thread em disco.
 *
 * O `thread.json` e a fonte unica da verdade da thread: fases, modo de conducao, base
 * carimbada pelo `ork` (nunca escolhida pelo executor), worktree e sessoes despachadas.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { aplicarVariante, definicaoDaVariante } from './ciclos';
import { definicaoDoModo, MODOS, ORDEM_DOS_MODOS, tagDoModo } from './modos';
import { dirEstado, ManifestoCarregado } from './manifest';
import { montarSlug, normalizarAssunto, REGEX_SLUG, slugValido } from './slug';
import {
  BlocoDeLoop, CanalDeConducao, ConducaoAtual, CriterioDePronto, DefinicaoDeModo, Fase, FASES, Modo, SessaoDaThread, Thread, VarianteDeCiclo,
} from './types';
import { agora, COMMIT_DESCONHECIDO, exec, ignorarPastaNoGit, lerJson, shaCurto, tabela } from './util';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { estadoCanonico, raizDoEstado, vincularEstado } from './estado-thread';
import { readCreationOperation, withCreationLock, writeCreationJson } from './creation-operation-store';
import { formatarDataHoraRotulada } from './horario';
import { nomeDaMaquina } from './maquina';
import { linhaDeConducao } from './conducao-texto';

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
    throw new Error(`thread "${id}" nao encontrada em ${dirThreads(raiz)}`);
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
  return gravada
    ? `Aviso: o repositório ainda não tem commit, e a thread ${thread.id} nasceu sem base: o ship não tem de onde partir. ` +
      `Faça o primeiro commit, feche esta com ork thread close ${thread.id} --motivo engano --por <quem> ` +
      '--justificativa "aberta antes do primeiro commit" e abra outra.'
    : 'Aviso: o repositório ainda não tem commit, e a thread nasceria sem base: faça o primeiro commit antes de abrir a primeira thread.';
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
}

/** Ajustes da criacao da worktree usados pelas variantes de ciclo do bloco B2. */
export interface OpcoesDeWorktree {
  /** Parte de uma branch que ja existe (ciclo `merge-branch`) em vez de criar uma nova. */
  branchExistente?: string;
  /** Base alternativa a `worktree.base_branch` do manifesto. */
  base?: string;
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
  const dir = path.resolve(raiz, manifesto.worktree.dir, id);
  const branch = opcoes.branchExistente ?? `ork/${slug}`;

  if (fs.existsSync(dir)) {
    throw new Error(`worktree ja existe em ${dir}`);
  }
  const base = opcoes.base ?? manifesto.worktree.base_branch;
  const commitBase = exec('git', ['rev-parse', '--verify', base], raiz);
  const ref = commitBase.ok ? commitBase.stdout.trim() : 'HEAD';
  // Fatia 2 do ensaio da 0.5.0 (P3): a pasta das worktrees que o ork cria agora nasce fora do git.
  const pastaDasWorktrees = path.dirname(dir);
  const pastaNova = !fs.existsSync(pastaDasWorktrees);

  // Branch nova (`-b`) no caso comum; branch que ja existe no ciclo `merge-branch`.
  const argumentos = opcoes.branchExistente
    ? ['worktree', 'add', dir, opcoes.branchExistente]
    : ['worktree', 'add', '-b', branch, dir, ref];
  const r = exec('git', argumentos, raiz);
  if (!r.ok) {
    throw new Error(`git worktree add falhou: ${(r.stderr || r.stdout).trim()}`);
  }
  if (pastaNova) ignorarPastaNoGit(pastaDasWorktrees, raiz);
  const lista = exec('git', ['worktree', 'list', '--porcelain'], raiz);
  const criada = lista.ok && lista.stdout.split('\n').some((l) => l.trim() === `worktree ${dir}`);
  if (!criada) {
    throw new Error(`worktree nao apareceu em \`git worktree list\` apos a criacao: ${dir}`);
  }
  vincularEstado(raiz, id, dir);
  return { dir, branch };
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
}

export interface ResultadoNovaThread {
  thread: Thread;
  gravada: boolean;
}

/** Cria a thread: valida modo contra o manifesto, gera o slug e carimba a base. */
export function novaThread(
  carregado: ManifestoCarregado,
  opcoes: OpcoesNovaThread
): ResultadoNovaThread {
  if (opcoes.dryRun) return criarThreadSerializada(carregado, opcoes);
  return withCreationLock(raizDoEstado(carregado.raiz), 'threads', () => criarThreadSerializada(carregado, opcoes));
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
    throw new Error(
      `o ciclo ${variante} redesenha os blocos e o modo ${def.tag} tem um bloco so ` +
        `(${unico.fases.join('-')}): crie a thread sem --ciclo ou escolha um modo de ciclo completo`
    );
  }
}

function criarThreadSerializada(carregado: ManifestoCarregado, opcoes: OpcoesNovaThread): ResultadoNovaThread {
  const { raiz, manifesto } = carregado;
  const permitidos = manifesto.conduction.allowed_modes;
  if (!permitidos.includes(opcoes.modo)) {
    throw new Error(
      `modo ${MODOS[opcoes.modo].tag} fora de conduction.allowed_modes ` +
        `(permitidos: ${permitidos.map((m) => MODOS[m].tag).join(', ')})`
    );
  }

  const assuntoBruto = normalizarAssunto(opcoes.assunto ?? opcoes.nome);
  if (!assuntoBruto) {
    throw new Error(`nome "${opcoes.nome}" nao produz assunto valido (esperado [a-z0-9])`);
  }
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
      throw new Error(
        `o ciclo ${variante} parte de uma branch que ja existe: informe --branch <branch>`
      );
    }
    if (opcoes.branch) {
      const existe = exec('git', ['rev-parse', '--verify', `refs/heads/${opcoes.branch}`], raiz);
      if (!existe.ok) {
        throw new Error(`branch "${opcoes.branch}" nao existe neste repositorio`);
      }
    }
  } else if (opcoes.branch) {
    throw new Error('--branch so vale com --ciclo merge-branch');
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
  const { id, assunto } = reservation
    ? { id: reservation.threadId, assunto: reservation.threadId.slice(abbrev.length + 1) }
    : opcoes.dryRun
    ? { id: `${abbrev}-${assuntoBruto}`, assunto: assuntoBruto }
    : idDisponivel(raiz, abbrev, assuntoBruto);

  const slug = opcoes.slug ?? montarSlug(abbrev, assunto, blocos[0].slugFases);
  // O override `--slug` do builder tambem passa pela regex canonica.
  if (!slugValido(slug)) {
    throw new Error(`slug invalido: "${slug}" (regex canonica: ${REGEX_SLUG.source})`);
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
    decisoes: [],
    claims: [],
    leases: [],
    baseline: null,
    variante,
    score: null,
  };
  if (variante === 'feature-xl-faseada') thread.fatias = opcoes.fatias ?? 3;

  if (opcoes.dryRun) return { thread, gravada: false };

  let worktreeCriada: WorktreeDaThread | null = null;
  // `greenfield`, `merge-branch` e `feature-xl-faseada` exigem worktree isolada: sao os
  // ciclos que escrevem codigo em paralelo com outras threads.
  const exigeWorktree = variante ? definicaoDaVariante(variante).exigeWorktree : false;
  if (opcoes.criarWorktree || exigeWorktree) {
    worktreeCriada = criarWorktree(carregado, id, slug, {
      branchExistente: opcoes.branch,
    });
    thread.worktree = worktreeCriada.dir;
    const commitDaBranch = exec('git', ['rev-parse', worktreeCriada.branch], raiz);
    thread.base = {
      branch: worktreeCriada.branch,
      commit: commitDaBranch.ok ? commitDaBranch.stdout.trim() : thread.base.commit,
    };
  }

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
    variante,
    branchDeOrigem: opcoes.branch ?? null,
    maquina: thread.maquina,
    ...(thread.roadmap ? { roadmap: thread.roadmap } : {}),
  });
  if (worktreeCriada) {
    registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeCriada, {
      dir: worktreeCriada.dir,
      branch: worktreeCriada.branch,
      base: manifesto.worktree.base_branch,
      fonte: 'git worktree list --porcelain',
    });
  }
  return { thread, gravada: true };
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
  const linhas: string[] = [];
  linhas.push(`  id        ${thread.id}`);
  linhas.push(`  slug      ${thread.slug}`);
  linhas.push(`  nome      ${thread.nome}`);
  linhas.push(`  modo      ${def.tag} (${pausasDaThread(thread)} pausas humanas previstas)`);
  linhas.push(`  ciclo     ${thread.variante ?? 'padrao do modo'}`);
  linhas.push(`  fase      ${thread.faseAtual}`);
  linhas.push(`  status    ${thread.status}`);
  linhas.push(`  base      ${thread.base.branch} @ ${shaCurto(thread.base.commit)}`);
  linhas.push(`  worktree  ${thread.worktree ?? '(raiz do projeto)'}`);
  // I-36 (T17): quem passa a leitura da conducao ve a linha unica; sem ela o resumo fica como era.
  if (conducao !== undefined) linhas.push(`  conducao  ${conducao ? linhaDeConducao(conducao) : 'ninguem conduz agora'}`);
  // I-43 (D4, viga a): a exigencia so aparece quando existe, para nao poluir o resumo
  // das threads que nao a declararam.
  if (thread.exigeRuntimeDiferente === true) {
    linhas.push('  validacao CHECK em runtime diferente do GO (exigido pela thread)');
  }
  // I-43 (D4, viga b): o criterio aparece COM o comando. Mostrar so o criterio seria
  // reproduzir a prosa do envelope numa tela nova.
  if (thread.doneWhen && thread.doneWhen.length > 0) {
    linhas.push(`  pronto quando (${thread.doneWhen.length} criterio(s) executaveis)`);
    for (const d of thread.doneWhen) linhas.push(`    ${d.criterio}\n      $ ${d.comando}`);
  }
  if (thread.score) {
    linhas.push(
      `  score     ${thread.score.valor}/5 por ${thread.score.avaliadoPor} ` +
        `(${thread.score.regime}) em ${formatarDataHoraRotulada(thread.score.avaliadoEm)}`
    );
  }
  linhas.push('  blocos previstos');
  for (const b of thread.blocos) {
    const marca = b.pausa ? `pausa prevista: ${b.pausaSobre}` : 'sem pausa humana prevista';
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
  if (linhas.length === 0) {
    // A divida paga aqui: a mensagem sugeria `--modo default`, um modo que
    // `parseModo` recusa, e e a origem provavel das 3 threads com `modo: default`
    // gravadas em disco. A sugestao agora e um modo que existe.
    const vazio = opcoes.todas === true
      ? 'Nenhuma thread em .orkastery/threads.'
      : 'Nenhuma thread aberta ou pausada (use --todas para ver as fechadas).';
    return `${vazio} Crie uma com: ork thread new "<nome>" --modo ${ORDEM_DOS_MODOS[0]}`;
  }
  const corpo = linhas.map((l) => [
    l.id, l.slug, l.tag, l.fase, l.status, String(l.pausas), String(l.sessoes),
  ]);
  const t = tabela(['ID', 'SLUG', 'MODO', 'FASE', 'STATUS', 'PAUSAS', 'SESSOES'], corpo);
  if (opcoes.todas === true) return t;
  const fechadas = listarIds(raiz).length - linhas.length;
  return fechadas > 0 ? `${t}\n\n  ${fechadas} fechada(s) omitida(s). Use --todas para ver todas.` : t;
}

/** Fase valida e pertencente ao ciclo da thread. */
export function exigirFase(thread: Thread, bruto: string): Fase {
  const fase = bruto.toUpperCase() as Fase;
  if (!thread.fases.includes(fase)) {
    throw new Error(`fase invalida: "${bruto}" (esperado uma de ${thread.fases.join(', ')})`);
  }
  return fase;
}

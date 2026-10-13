/**
 * RM-061, fatia F3b: a familia `worktree` do catalogo de mensagens (`ork worktree ensure|sync|audit|release`). O
 * pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo: o que vem do estado entra por parametro.
 *
 * O detalhe e a correcao que o comando grava no ledger (`worktree_synced`, `worktree_audited`, `worktree_released`) e
 * devolve no resultado nascem em pt-BR no escopo da gravacao (`textoDoCatalogo`), e so a impressao os remonta no
 * locale (G4). O nome de cada check do audit e dado gravado: so a impressao o traduz, pelo id. Motivo tipado, comando,
 * caminho e sha saem iguais nas duas linguas.
 */

const NOMES_DOS_CHECKS_EN: Readonly<Record<string, string>> = {
  registro: 'record', diretorio: 'directory', git: 'git', branch: 'branch', procedencia: 'provenance', arvore: 'tree',
  base: 'base', artefatos: 'artifacts', 'estado-unico': 'single-state',
};

/** O motivo de a confirmacao local nao valer (`lerArquivoPrivado`, `lerWorktreeLocal`), pela frase exata, em ingles. */
const MOTIVOS_DA_CONFIRMACAO_EN: ReadonlyArray<[RegExp, (...g: string[]) => string]> = [
  [/^sem confirmação local$/, () => 'no local confirmation'],
  [/^\.orkastery\/private precisa ser pasta 0700 do próprio usuário$/, () => '.orkastery/private must be a 0700 folder owned by the user'],
  [/^(.+) precisa ser arquivo 0600 do próprio usuário$/, (nome) => `${nome} must be a 0600 file owned by the user`],
  [/^(.+) está versionado no git e não vale como confirmação local$/, (nome) => `${nome} is versioned in git and does not count as a local confirmation`],
  [/^(.+) com JSON inválido$/, (nome) => `${nome} has invalid JSON`],
  [/^(.+) fora do contrato (.+)$/, (nome, contrato) => `${nome} does not follow the ${contrato} contract`],
  [/^a confirmação local é de outro checkout$/, () => 'the local confirmation belongs to another checkout'],
];

export const WORKTREE_PT_BR = {
  uso: 'uso: ork worktree <ensure|sync|audit|release> <thread-id>',
  // A moldura dos bloqueios: o mesmo bloco nos quatro subcomandos.
  naoGarantida: (id: string) => `Worktree da thread ${id} NAO garantida.`,
  syncBloqueado: (id: string) => `Sync da worktree da thread ${id} BLOQUEADO.`,
  releaseBloqueado: (id: string) => `Release da worktree da thread ${id} BLOQUEADO.`,
  motivoTipado: (motivo: string | null) => `  motivo tipado: ${motivo}`,
  detalhe: (detalhe: string) => `  detalhe: ${detalhe}`,
  correcao: (correcao: string) => `  correcao: ${correcao}`,
  // ensure
  criada: (id: string) => `Worktree criada para a thread ${id}.`,
  jaExistia: (id: string) => `Worktree ja existia para a thread ${id}.`,
  linhaDir: (dir: string) => `  dir     ${dir}`,
  linhaBranch: (branch: string) => `  branch  ${branch}`,
  linhaBase: (base: string) => `  base    ${base} (resolvida pelo ork, nao pelo executor)`,
  naoRegistrada: (dir: string) => `${dir} existe mas nao aparece em \`git worktree list\``,
  naoRegistradaCorrecao: (id: string) => `remova o diretorio ou registre a worktree; depois rode: ork worktree ensure ${id}`,
  reconcilieOEstado: (id: string) => `reconcilie o estado e rode ork worktree sync ${id}`,
  jaExiste: 'a worktree da thread ja existe e o git a reconhece',
  recriadaSobreBranch: (branch: string) => `worktree recriada sobre a branch ${branch}, que ja existia`,
  criadaAPartirDe: (base: string) => `worktree criada a partir de ${base}`,
  // sync
  syncEnsaio: (id: string) => `Sync (--dry-run) da thread ${id}: nada foi executado.`,
  syncFeito: (id: string) => `Sync da thread ${id}.`,
  syncBase: (base: string, sha: string) => `  base       ${base} @ ${sha}`,
  syncBranch: (branch: string, antes: string, depois: string) => `  branch     ${branch} @ ${antes} -> ${depois}`,
  syncRebase: (estado: 'feito' | 'desnecessario' | 'seria feito') => `  rebase     ${estado}`,
  comandosReais: '  Comandos reais, na ordem:',
  semWorktree: (id: string) => `a thread ${id} nao tem worktree registrada no git`,
  semWorktreeCorrecao: (id: string) => `crie a worktree com: ork worktree ensure ${id}`,
  semStatus: (dir: string) => `${dir} nao respondeu a \`git status\``,
  arvoreSuja: (dir: string) => `${dir} tem alteracao nao commitada; rebase em arvore suja perde trabalho`,
  arvoreSujaCorrecao: (dir: string, id: string) => `commite ou guarde as alteracoes em ${dir} e rode de novo: ork worktree sync ${id}`,
  reconcilieAsCopias: 'reconcilie as duas cópias sem descartar evidências',
  baseInexistente: (base: string) => `a base ${base} do manifesto nao existe neste repositorio`,
  baseInexistenteCorrecao: (caminho: string) => `corrija worktree.base_branch em ${caminho}`,
  /** O que o ledger guarda quando a base ja estava na branch (o texto impresso e `jaIncorporada`). */
  jaEraAncestral: 'a base ja era ancestral do HEAD da thread',
  jaIncorporada: (base: string) => `a base ${base} ja esta incorporada: nada a sincronizar`,
  semCommitProprio: (branch: string, base: string) =>
    `a branch ${branch} nao tem commit proprio: o sync real a recriaria na base ${base} atual, sem rebase`,
  inspecioneAsCopias: 'inspecione a cópia local e a fonte canônica preservadas antes de repetir o sync',
  recriacaoFalhou: (branch: string, saida: string) => `a recriacao da branch ${branch} na base falhou: ${saida}`,
  confiraAWorktree: (dir: string, id: string) => `confira a worktree ${dir} e rode de novo: ork worktree sync ${id}`,
  recriada: (base: string, semAncestral: boolean) => `branch sem commit proprio recriada a partir da base ${base} atual` +
    (semAncestral ? '; a base foi reescrita e nao tinha historia em comum com ela' : ''),
  ondeComecou: '<commit onde a branch da thread comecou>',
  semHistoriaComum: (base: string, branch: string, proprios: number | null) => `a base ${base} foi reescrita e nao tem historia ` +
    `em comum com a branch ${branch}, que tem ${proprios ?? 'um numero desconhecido de'} commit(s) proprio(s): o rebase reaplicaria a ` +
    'historia antiga inteira',
  reaplique: (comando: string) => `reaplique so os commits da thread sobre a base nova: ${comando}`,
  passoBaseReescrita: (ponto: string, sha: string) => `git merge-base --is-ancestor ${ponto} ${sha}   (falso: a base foi reescrita)`,
  baseReescrita: (base: string, ponto: string, branch: string, sairam: number | null, proprios: number | null, comando: string) =>
    `a base ${base} foi reescrita: o ponto de partida ${ponto} da branch ${branch} nao esta mais nela, ` +
    `e o rebase comum reaplicaria ${sairam ?? 'um numero desconhecido de'} commit(s) que sairam da base junto com ` +
    `o(s) ${proprios ?? '?'} da thread (${comando})`,
  rebaseAcima: (base: string) => `a base ${base} avancou; o sync real faria o rebase acima`,
  rebaseConflitou: (base: string, saida: string) => `o rebase sobre ${base} conflitou e foi abortado: ${saida}`,
  rebaseConflitouCorrecao: (dir: string, sha: string) => `resolva o conflito na worktree ${dir} (git rebase ${sha} e resolucao manual), ` +
    'ou reduza a regiao da thread com um lease path:<glob> menor',
  /** O que o ledger guarda depois do rebase (o texto impresso e `rebasadaSobreEla`). */
  rebasada: (base: string) => `branch da thread rebasada sobre ${base}`,
  rebasadaSobreEla: (base: string, branch: string) => `a base ${base} avancou e a branch ${branch} foi rebasada sobre ela`,
  // audit
  auditoria: (id: string) => `Auditoria da worktree da thread ${id}`,
  nomeDoCheck: (nome: string) => nome,
  correcaoDoCheck: (correcao: string) => `         correcao: ${correcao}`,
  consistente: '  worktree consistente: o git confirma cada item acima.',
  divergencias: (n: number) => `  ${n} divergencia(s) encontrada(s) no proprio git.`,
  apontaPara: (dir: string) => `thread.json aponta para ${dir}`,
  semRegistroNoThread: 'a thread nao tem worktree registrada no thread.json',
  naoExisteNoDisco: (dir: string) => `${dir} nao existe no disco`,
  apareceNoGit: 'aparece em `git worktree list --porcelain`',
  naoApareceNoGit: (dir: string) => `${dir} nao aparece em \`git worktree list\``,
  emCheckout: (branch: string) => `${branch} em check-out`,
  branchErrada: (esperada: string, encontrada: string) => `esperado ${esperada}, encontrado "${encontrada || '(HEAD solto)'}"`,
  arvoreLimpa: 'sem alteracao nao commitada',
  statusSemResposta: '`git status` nao respondeu neste diretorio',
  alteracaoNaWorktree: 'ha alteracao nao commitada na worktree',
  baseIncorporada: (base: string, sha: string) => `${base} @ ${sha} ja incorporada`,
  baseAdiante: (base: string, sha: string) => `a base ${base} avancou para ${sha} e nao esta na branch da thread`,
  artefatosDentro: (dir: string) => `os artefatos da thread estao DENTRO da worktree (${dir})`,
  artefatosDentroCorrecao: 'os artefatos da thread vivem em .orkastery/threads/<id>, fora da arvore',
  artefatosFora: (dir: string) => `${dir} fica fora da worktree`,
  // release
  liberada: (id: string) => `Worktree da thread ${id} liberada.`,
  releaseDir: (dir: string) => `  dir      ${dir}`,
  releaseRemovida: (removida: boolean) => `  removida ${removida ? 'sim' : 'nao (o diretorio ja nao existia)'}`,
  releaseLeases: (leases: string) => `  leases   ${leases || '(nenhum lease de escrita para soltar)'}`,
  /** O que o ledger guarda quando o diretorio ja tinha sumido (o texto impresso e `jaNaoExistiaImpresso`). */
  jaNaoExistia: 'o diretorio ja nao existia; o registro foi limpo',
  jaNaoExistiaImpresso: 'o diretorio ja nao existia; registro limpo e `git worktree prune` rodado',
  confiraODiretorio: (id: string) => `confira o diretorio e o thread.json da thread ${id}`,
  releaseArvoreSuja: (dir: string) => `${dir} tem alteracao nao commitada`,
  releaseArvoreSujaCorrecao: (dir: string) => `commite o que interessa em ${dir}, ou repita com --forcar para descartar`,
  removeFalhou: (saida: string) => `git worktree remove falhou: ${saida}`,
  removeFalhouCorrecao: (dir: string) => `rode \`git worktree remove ${dir}\` na mao e confira \`git worktree list\``,
  continuaNaLista: (dir: string) => `${dir} continua em \`git worktree list\` depois do remove`,
  removida: (branch: string) => `worktree removida; a branch ${branch} continua no repositorio`,
  // A pasta das worktrees e a criacao (`worktree-local.ts` e `criarWorktree`, em `thread.ts`)
  dirForaDaRaiz: (pedido: string, dir: string, confirmada: string | null, motivo: string | null, comando: string) =>
    `worktree.dir-fora-da-raiz: o orkastery.yaml pede worktree.dir: ${pedido}, ` +
    `que leva a ${dir}, fora da raiz do projeto (pelo caminho real), e esta máquina não confirmou essa pasta ` +
    `(${confirmada ? `a máquina confirmou ${confirmada}` : motivo ?? 'sem confirmação local'}). ` +
    'Nenhuma worktree foi criada. O manifesto vem com o repositório; quem decide criar checkout fora da raiz é a ' +
    `máquina. Para aceitar nesta máquina: ${comando} (ou volte worktree.dir para dentro do projeto, ` +
    'como .claude/worktrees).',
  worktreeJaExisteEm: (dir: string) => `worktree ja existe em ${dir}`,
  worktreeAddFalhou: (saida: string) => `git worktree add falhou: ${saida}`,
  worktreeNaoApareceu: (dir: string) => `worktree nao apareceu em \`git worktree list\` apos a criacao: ${dir}`,
};

export type MensagensDeWorktree = typeof WORKTREE_PT_BR;

export const WORKTREE_EN: MensagensDeWorktree = {
  uso: 'usage: ork worktree <ensure|sync|audit|release> <thread-id>',
  naoGarantida: (id) => `Worktree for thread ${id} NOT ensured.`,
  syncBloqueado: (id) => `Worktree sync for thread ${id} BLOCKED.`,
  releaseBloqueado: (id) => `Worktree release for thread ${id} BLOCKED.`,
  motivoTipado: (motivo) => `  typed reason: ${motivo}`,
  detalhe: (detalhe) => `  detail: ${detalhe}`,
  correcao: (correcao) => `  fix: ${correcao}`,
  criada: (id) => `Worktree created for thread ${id}.`,
  jaExistia: (id) => `Worktree already existed for thread ${id}.`,
  linhaDir: (dir) => `  dir     ${dir}`,
  linhaBranch: (branch) => `  branch  ${branch}`,
  linhaBase: (base) => `  base    ${base} (resolved by ork, not by the executor)`,
  naoRegistrada: (dir) => `${dir} exists but does not show up in \`git worktree list\``,
  naoRegistradaCorrecao: (id) => `remove the directory or register the worktree; then run: ork worktree ensure ${id}`,
  reconcilieOEstado: (id) => `reconcile the state and run \`ork worktree sync ${id}\``,
  jaExiste: 'the thread worktree already exists and git recognizes it',
  recriadaSobreBranch: (branch) => `worktree recreated on branch ${branch}, which already existed`,
  criadaAPartirDe: (base) => `worktree created from ${base}`,
  syncEnsaio: (id) => `Sync (--dry-run) of thread ${id}: nothing was run.`,
  syncFeito: (id) => `Sync of thread ${id}.`,
  syncBase: (base, sha) => `  base       ${base} @ ${sha}`,
  syncBranch: (branch, antes, depois) => `  branch     ${branch} @ ${antes} -> ${depois}`,
  syncRebase: (estado) => `  rebase     ${{ feito: 'done', desnecessario: 'not needed', 'seria feito': 'would run' }[estado]}`,
  comandosReais: '  Real commands, in order:',
  semWorktree: (id) => `thread ${id} has no worktree registered in git`,
  semWorktreeCorrecao: (id) => `create the worktree with: ork worktree ensure ${id}`,
  semStatus: (dir) => `${dir} did not answer \`git status\``,
  arvoreSuja: (dir) => `${dir} has uncommitted changes; rebasing a dirty tree loses work`,
  arvoreSujaCorrecao: (dir, id) => `commit or stash the changes in ${dir} and run again: \`ork worktree sync ${id}\``,
  reconcilieAsCopias: 'reconcile the two copies without discarding evidence',
  baseInexistente: (base) => `the base ${base} from the manifest does not exist in this repository`,
  baseInexistenteCorrecao: (caminho) => `fix \`worktree.base_branch\` in ${caminho}`,
  jaEraAncestral: 'the base was already an ancestor of the thread HEAD',
  jaIncorporada: (base) => `the base ${base} is already merged in: nothing to sync`,
  semCommitProprio: (branch, base) => `branch ${branch} has no commit of its own: the real sync would recreate it on the current base ${base}, without a rebase`,
  inspecioneAsCopias: 'inspect the preserved local copy and canonical source before repeating the sync',
  recriacaoFalhou: (branch, saida) => `recreating branch ${branch} on the base failed: ${saida}`,
  confiraAWorktree: (dir, id) => `check the worktree ${dir} and run again: \`ork worktree sync ${id}\``,
  recriada: (base, semAncestral) => `branch with no commit of its own recreated from the current base ${base}` +
    (semAncestral ? '; the base was rewritten and had no history in common with it' : ''),
  ondeComecou: '<commit where the thread branch started>',
  semHistoriaComum: (base, branch, proprios) => `the base ${base} was rewritten and has no history in common with branch ${branch}, ` +
    `which has ${proprios ?? 'an unknown number of'} commit(s) of its own: the rebase would replay the whole old history`,
  reaplique: (comando) => `replay only the thread commits on top of the new base: ${comando}`,
  passoBaseReescrita: (ponto, sha) => `git merge-base --is-ancestor ${ponto} ${sha}   (false: the base was rewritten)`,
  baseReescrita: (base, ponto, branch, sairam, proprios, comando) => `the base ${base} was rewritten: the starting point ${ponto} of ` +
    `branch ${branch} is no longer in it, and a plain rebase would replay ${sairam ?? 'an unknown number of'} commit(s) that left the ` +
    `base along with the thread's ${proprios ?? '?'} (${comando})`,
  rebaseAcima: (base) => `the base ${base} moved ahead; the real sync would run the rebase above`,
  rebaseConflitou: (base, saida) => `the rebase onto ${base} hit a conflict and was aborted: ${saida}`,
  rebaseConflitouCorrecao: (dir, sha) => `resolve the conflict in the worktree ${dir} (git rebase ${sha} and manual resolution), ` +
    'or narrow the thread region with a smaller `path:<glob>` lease',
  rebasada: (base) => `thread branch rebased onto ${base}`,
  rebasadaSobreEla: (base, branch) => `the base ${base} moved ahead and branch ${branch} was rebased onto it`,
  auditoria: (id) => `Audit of the worktree of thread ${id}`,
  nomeDoCheck: (nome) => NOMES_DOS_CHECKS_EN[nome] ?? nome,
  correcaoDoCheck: (correcao) => `         fix: ${correcao}`,
  consistente: '  worktree consistent: git confirms every item above.',
  divergencias: (n) => `  ${n} divergence(s) found in git itself.`,
  apontaPara: (dir) => `thread.json points to ${dir}`,
  semRegistroNoThread: 'the thread has no worktree recorded in thread.json',
  naoExisteNoDisco: (dir) => `${dir} does not exist on disk`,
  apareceNoGit: 'shows up in `git worktree list --porcelain`',
  naoApareceNoGit: (dir) => `${dir} does not show up in \`git worktree list\``,
  emCheckout: (branch) => `${branch} checked out`,
  branchErrada: (esperada, encontrada) => `expected ${esperada}, found "${encontrada || '(detached HEAD)'}"`,
  arvoreLimpa: 'no uncommitted changes',
  statusSemResposta: '`git status` did not answer in this directory',
  alteracaoNaWorktree: 'the worktree has uncommitted changes',
  baseIncorporada: (base, sha) => `${base} @ ${sha} already merged in`,
  baseAdiante: (base, sha) => `the base ${base} moved ahead to ${sha} and is not in the thread branch`,
  artefatosDentro: (dir) => `the thread artifacts are INSIDE the worktree (${dir})`,
  artefatosDentroCorrecao: 'the thread artifacts live in `.orkastery/threads/<id>`, outside the tree',
  artefatosFora: (dir) => `${dir} stays outside the worktree`,
  liberada: (id) => `Worktree of thread ${id} released.`,
  releaseDir: (dir) => `  dir      ${dir}`,
  releaseRemovida: (removida) => `  removed  ${removida ? 'yes' : 'no (the directory no longer existed)'}`,
  releaseLeases: (leases) => `  leases   ${leases || '(no write lease to release)'}`,
  jaNaoExistia: 'the directory no longer existed; the record was cleaned',
  jaNaoExistiaImpresso: 'the directory no longer existed; record cleaned and `git worktree prune` run',
  confiraODiretorio: (id) => `check the directory and the thread.json of thread ${id}`,
  releaseArvoreSuja: (dir) => `${dir} has uncommitted changes`,
  releaseArvoreSujaCorrecao: (dir) => `commit what matters in ${dir}, or repeat with \`--forcar\` to discard it`,
  removeFalhou: (saida) => `git worktree remove failed: ${saida}`,
  removeFalhouCorrecao: (dir) => `run \`git worktree remove ${dir}\` by hand and check \`git worktree list\``,
  continuaNaLista: (dir) => `${dir} is still in \`git worktree list\` after the remove`,
  removida: (branch) => `worktree removed; branch ${branch} stays in the repository`,
  dirForaDaRaiz: (pedido, dir, confirmada, motivo, comando) => {
    const regra = motivo ? MOTIVOS_DA_CONFIRMACAO_EN.find(([re]) => re.test(motivo)) : undefined;
    const porque = confirmada ? `the machine confirmed ${confirmada}`
      : motivo ? (regra ? regra[1](...(regra[0].exec(motivo) ?? []).slice(1)) : motivo) : 'no local confirmation';
    return `worktree.dir-fora-da-raiz: \`orkastery.yaml\` asks for worktree.dir: ${pedido}, which leads to ${dir}, outside the ` +
      `project root (by the real path), and this machine did not confirm that folder (${porque}). No worktree was created. ` +
      'The manifest comes with the repository; the machine decides whether to create a checkout outside the root. ' +
      `To accept it on this machine: \`${comando}\` (or move worktree.dir back inside the project, such as .claude/worktrees).`;
  },
  worktreeJaExisteEm: (dir) => `a worktree already exists at ${dir}`,
  worktreeAddFalhou: (saida) => `git worktree add failed: ${saida}`,
  worktreeNaoApareceu: (dir) => `the worktree did not show up in \`git worktree list\` after it was created: ${dir}`,
};

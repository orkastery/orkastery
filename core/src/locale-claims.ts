/**
 * RM-061, fatia F3b: a familia `claims` do catalogo de mensagens (`ork claims add|conferir|verificar|retirar|ausente|
 * list`), a tabela das claims, o lint do comando de claim, as recusas da conferencia pontual e as da prova minima. O
 * pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * A alegacao, o arquivo, o comando e o motivo digitado pelo dono sao dado e saem como vieram; o estado de uma claim
 * (dado do `claims.jsonl`) e a regra do lint so se traduzem na impressao, pelo id. A correcao do lint que vai ao
 * `claims.jsonl` sai sempre do pt-BR (`claim-lint.ts`). As recusas da conferencia saem no `--json` como nasceram (em
 * pt-BR, porque o `--json` nunca ativa o locale) e o texto as remonta no locale do comando.
 */

/** O erro do executor do sandbox (`verify-sandbox.ts`), pela frase exata: o que nao casa sai como veio. */
const ERROS_DO_SANDBOX_EN: ReadonlyArray<[RegExp, (...g: string[]) => string]> = [
  [/^executor VERIFY sandbox disponível somente em Linux$/, () => 'the VERIFY sandbox executor is only available on Linux'],
  [/^worktree deve ser absoluta$/, () => 'the worktree must be an absolute path'],
  [/^worktree inválida$/, () => 'invalid worktree'],
  [/^timeout sandbox fora do limite$/, () => 'sandbox timeout out of bounds'],
  [/^executor sandbox fechado$/, () => 'sandbox executor closed'],
  [/^escopo\/binário do executor sandbox mudou$/, () => 'the sandbox executor scope or binary changed'],
  [/^scratch VERIFY deve ficar fora da worktree$/, () => 'the VERIFY scratch must stay outside the worktree'],
  [/^cleanup incompleto: consumidores não comprovadamente encerrados; isolamento preservado: (.+)$/,
    (dir) => `incomplete cleanup: consumers not proven closed; isolation kept: ${dir}`],
  [/^cleanup incompleto: isolamento substituído; preservado$/, () => 'incomplete cleanup: isolation replaced; kept'],
  [/^isolamento sandbox mudou$/, () => 'the sandbox isolation changed'],
  [/^metadado protegido inesperado; objeto preservado: (.+)$/, (nome) => `unexpected protected metadata; object kept: ${nome}`],
  [/^metadado temporário mudou antes do lançamento$/, () => 'temporary metadata changed before the launch'],
  [/^identidade mudou$/, () => 'the identity changed'],
  [/^scratch mudou$/, () => 'the scratch changed'],
  [/^supervisor saiu (.+)$/, (status) => `supervisor exited ${status}`],
  [/^resposta inválida$/, () => 'invalid answer'],
];

const ESTADOS_EN: Readonly<Record<string, string>> = {
  pendente: 'pending', verificado: 'verified', reprovado: 'failed', 'nao-verificavel': 'unverifiable', retirada: 'withdrawn',
};

export const CLAIMS_PT_BR = {
  // ork claims add
  usoAdd: 'uso: ork claims add <thread-id> <arquivo> --claim "<alegacao>" [--verificar "<comando>"]',
  registrada: (id: string, thread: string) => `Claim ${id} registrada na thread ${thread}.`,
  campoArquivo: (arquivo: string) => `  arquivo    ${arquivo}`,
  campoAlegacao: (alegacao: string) => `  alegacao   ${alegacao}`,
  campoNegativa: (negativa: boolean) => `  negativa   ${negativa ? 'sim (exige comando de verificacao)' : 'nao'}`,
  campoVerificar: (verificar: string) => `  verificar  ${verificar || '(nenhum comando declarado)'}`,
  campoEstado: (estado: string) => `  estado     ${estado}`,
  campoMotivo: (motivo: string) => `  motivo     ${motivo}`,
  /** O estado gravado no `claims.jsonl`, como o texto o mostra. */
  estado: (estado: string) => estado,
  avisoNegativa: 'AVISO: alegacao negativa sem comando de verificacao reprova em `ork verify`.',
  /** A linha do lint no `claims add` (no `ci prepare` o lint sai em pt-BR, como antes). */
  avisoDoLint: (linha: string, suiteInteira: boolean) => `AVISO: ${linha}${suiteInteira ? '. O `ci prepare` recusa esta claim.' : ''}`,
  lintRecusado: (linhas: string) => `claim recusada antes de ser registrada:\n  ${linhas}`,
  linhaDoLint: (claim: string, nome: string, trecho: string, correcao: string) => `${claim} ${nome} (${trecho}); ${correcao}`,
  nomesDoLint: { 'suite-inteira': 'roda a suite inteira', 'sha-intermediario': 'fixa um SHA intermediario',
    'contagem-de-commits': 'compara contagem de commits', 'binario-rg': 'usa o binario rg ausente no runner',
    'ork-fora-do-path': 'chama ork fora do PATH do runner', 'estado-local': 'le estado local fora do checkout',
    'aspas-escapadas': 'leva aspas escapadas literalmente' } as Record<string, string>,
  correcoesDoLint: {
    'suite-inteira': 'rode só o teste da claim (`node --test` no arquivo do teste, ou o comando do projeto que roda um arquivo) ' +
      'ou um script hermético do projeto',
    'sha-intermediario': 'ancore na base (`git diff "$(git merge-base origin/main HEAD)" HEAD`) ou prove ancestralidade com `git merge-base --is-ancestor <sha> HEAD`',
    'contagem-de-commits': 'use `git merge-base --is-ancestor <commit> HEAD`: contagem de commits quebra com rebase e merge',
    'binario-rg': 'use `grep` (ou Node) com a mesma prova; o runner nao instala `rg`',
    'ork-fora-do-path': 'use `node core/dist/index.js ...`; o runner nao instala `ork` no PATH',
    'estado-local': 'prove somente arquivos versionados do checkout; `.orkastery/` e estado local e nao vai ao CI',
    'aspas-escapadas': 'use aspas reais do shell; nao serialize `\\x22` ou `\\x27` dentro do comando',
  } as Record<string, string>,
  // ork claims conferir
  usoConferir: 'uso: ork claims conferir <thread-id> --claims C1,C2 | --tarefa T1 [--prazo S] [--json]',
  conferencia: (thread: string) => `Conferencia pontual da thread ${thread} (sem recibo: o ork verify continua sendo quem verifica)`,
  headReal: (commit: string) => `  HEAD real   ${commit}`,
  executor: (executor: string, segundos: number) => `  executor    ${executor}, prazo total ${segundos} s`,
  alvoClaims: (ids: string) => `  alvo        claims ${ids}`,
  alvoTarefa: (tarefa: string, sha: string, comando: string) => `  alvo        verify da tarefa ${tarefa} (plano sha256 ${sha}): ${comando}`,
  item: (id: string, verificado: boolean, motivo: string | null, alegacao: string) =>
    `  ${id}  ${verificado ? 'passou' : `NAO PASSOU (${motivo})`}  ${alegacao}`,
  tudoPassou: 'Resultado: tudo passou.',
  naoPassou: (motivos: string) => `Resultado: nao passou. Motivos: ${motivos}`,
  prazoEsgotado: 'nao executado: prazo total da conferencia esgotado',
  /** As recusas tipadas da conferencia: `claims.conferir.<motivo>: <detalhe>`. */
  recusa: (motivo: string, detalhe: string) => `claims.conferir.${motivo}: ${detalhe}`,
  semClaims: 'informe ao menos uma claim em --claims (ex.: C3,C7)',
  idInvalido: (id: string) => `id de claim invalido: ${id}`,
  repetida: (id: string) => `${id} pedida duas vezes`,
  tarefaInvalida: (tarefa: string) => `tarefa invalida: ${tarefa} (ex.: T2.1)`,
  tarefaAusente: (tarefa: string) => `o plano nao tem a tarefa ${tarefa}`,
  tarefaRepetida: (n: number, tarefa: string) => `o plano tem ${n} cabecalhos da tarefa ${tarefa}`,
  tarefaSemVerify: (tarefa: string) => `a tarefa ${tarefa} nao tem linha de verify`,
  tarefaAmbigua: (tarefa: string, n: number) => `a tarefa ${tarefa} tem ${n} linhas de verify`,
  tarefaSemComando: (tarefa: string, resto: string) => `o verify da tarefa ${tarefa} nao tem comando entre crases: ${resto}`,
  tarefaVariosTrechos: (tarefa: string, n: number, resto: string) => `o verify da tarefa ${tarefa} tem ${n} trecho(s) entre ` +
    `crases e texto alem de um comando so (${resto}); a conferencia nao escolhe qual pedaco rodar`,
  planoNaoAbre: 'docs/plan.md da thread nao abre como arquivo comum',
  planoGrande: 'docs/plan.md da thread nao e arquivo comum de ate 128 KiB',
  semWorktree: (thread: string) => `a thread ${thread} nao tem worktree propria; a conferencia so roda nela`,
  worktreeAusente: (thread: string) => `a worktree da thread ${thread} nao existe no disco`,
  worktreeFora: (thread: string) => `a worktree da thread ${thread} fica fora do projeto`,
  worktreeNaoRegistrada: (thread: string, branch: string) => `a worktree da thread ${thread} nao esta registrada no git do projeto na branch ${branch}`,
  sandboxIndisponivel: (erro: string) => `${erro}; a conferencia so roda confinada, sem fallback`,
  /** O erro do executor do sandbox, que o `verify-sandbox.ts` escreve em pt-BR, como a recusa o mostra. */
  erroDoSandbox: (erro: string) => erro,
  /** A alegacao que a conferencia por tarefa monta para o `verify` do plano (vai ao `--json` em pt-BR). */
  verifyDaTarefa: (tarefa: string) => `verify da tarefa ${tarefa} do plano`,
  claimsOuTarefa: 'informe --claims C1,C2 ou --tarefa T1, um dos dois',
  prazo: (minimo: number, maximo: number) => `--prazo vai de ${minimo} a ${maximo} segundos`,
  threadAusente: (thread: string) => `a thread ${thread} nao existe neste projeto`,
  threadFechada: (thread: string) => `a thread ${thread} esta fechada`,
  desconhecida: (id: string, thread: string) => `${id} nao existe na thread ${thread}`,
  retiradaNaConferencia: (id: string, motivo: string | undefined) => `${id} foi retirada (${motivo ?? 'sem motivo'})`,
  planoAusente: (thread: string) => `a thread ${thread} nao tem docs/plan.md`,
  // ork claims verificar, retirar, ausente e list
  usoVerificar: 'uso: ork claims verificar <thread-id> <claim-id> --comando "<comando>"',
  comandoAnexado: (id: string) => `Claim ${id} agora tem comando de verificacao.`,
  proveAgora: (thread: string) => `Prove agora: ork verify ${thread}`,
  usoRetirar: 'uso: ork claims retirar <thread-id> <claim-id> --motivo "<motivo>"',
  retirada: (id: string, thread: string) => `Claim ${id} retirada da thread ${thread}.`,
  historicoContinua: '  o historico da alegacao continua no claims.jsonl e no ledger.',
  usoAusente: 'uso: ork claims ausente <thread-id> --paths A,B --motivo "<motivo>" [--commit SHA]',
  ausenciaRegistrada: (thread: string, paths: string) => `Ausencia de prova registrada na thread ${thread}: ${paths}.`,
  usoList: 'uso: ork claims list <thread-id>',
  // claims.ts
  naoExiste: (id: string, thread: string) => `claim "${id}" nao existe na thread ${thread}`,
  listaVazia: (thread: string) => `Nenhuma claim na thread ${thread}.\n` +
    `Registre uma com: ork claims add ${thread} <arquivo> --claim "<alegacao>" --verificar "<comando>"`,
  colunas: ['ID', 'FASE', 'ESTADO', 'NEGATIVA', 'ARQUIVO', 'VERIFICAR', 'ALEGACAO'],
  sim: 'sim',
  nao: 'nao',
  semComando: '(sem comando)',
  // prova-minima.ts
  custoDeComandos: (limite: number, recebidos: number) => `claims.custo: ciclo sem CHECK aceita ate ${limite} comandos por claim ` +
    `(recebidos ${recebidos}); use o teste focado ou declare a ausencia com ork claims ausente`,
  custoDaSuite: (suite: string) => `claims.custo: ciclo sem CHECK nao roda a suite inteira ("${suite}"); ` +
    'use o teste focado do arquivo que mudou',
  ausenteSemMotivo: 'prova.ausente: o motivo e obrigatorio (uma linha)',
  ausenteSemCaminhos: 'prova.ausente: informe os caminhos que ficaram sem prova',
};

export type MensagensDeClaims = typeof CLAIMS_PT_BR;

export const CLAIMS_EN: MensagensDeClaims = {
  usoAdd: 'usage: ork claims add <thread-id> <file> --claim "<statement>" [--verificar "<command>"]',
  registrada: (id, thread) => `Claim ${id} recorded in thread ${thread}.`,
  campoArquivo: (arquivo) => `  file       ${arquivo}`,
  campoAlegacao: (alegacao) => `  statement  ${alegacao}`,
  campoNegativa: (negativa) => `  negative   ${negativa ? 'yes (needs a verification command)' : 'no'}`,
  campoVerificar: (verificar) => `  verify     ${verificar || '(no command declared)'}`,
  campoEstado: (estado) => `  state      ${estado}`,
  campoMotivo: (motivo) => `  reason     ${motivo}`,
  estado: (estado) => ESTADOS_EN[estado] ?? estado,
  avisoNegativa: 'WARNING: a negative statement without a verification command fails in `ork verify`.',
  avisoDoLint: (linha, suiteInteira) => `WARNING: ${linha}${suiteInteira ? '. `ci prepare` refuses this claim.' : ''}`,
  lintRecusado: (linhas) => `claim refused before it was recorded:\n  ${linhas}`,
  linhaDoLint: (claim, nome, trecho, correcao) => `${claim} ${nome} (${trecho}); ${correcao}`,
  nomesDoLint: { 'suite-inteira': 'runs the whole suite', 'sha-intermediario': 'pins an intermediate SHA',
    'contagem-de-commits': 'compares a commit count', 'binario-rg': 'uses the rg binary missing from the runner',
    'ork-fora-do-path': 'calls ork outside the runner PATH', 'estado-local': 'reads local state outside the checkout',
    'aspas-escapadas': 'passes escaped quotes literally' },
  correcoesDoLint: {
    'suite-inteira': 'run only the claim test (`node --test` on the test file, or the project command that runs one file) ' +
      'or a hermetic project script',
    'sha-intermediario': 'anchor on the base (`git diff "$(git merge-base origin/main HEAD)" HEAD`) or prove ancestry with `git merge-base --is-ancestor <sha> HEAD`',
    'contagem-de-commits': 'use `git merge-base --is-ancestor <commit> HEAD`: a commit count breaks with rebase and merge',
    'binario-rg': 'use `grep` (or Node) for the same proof; the runner does not install `rg`',
    'ork-fora-do-path': 'use `node core/dist/index.js ...`; the runner does not install `ork` in PATH',
    'estado-local': 'prove only versioned checkout files; `.orkastery/` is local state and is not sent to CI',
    'aspas-escapadas': 'use real shell quotes; do not serialize `\\x22` or `\\x27` inside the command',
  },
  usoConferir: 'usage: ork claims conferir <thread-id> --claims C1,C2 | --tarefa T1 [--prazo S] [--json]',
  conferencia: (thread) => `Spot check of thread ${thread} (no receipt: \`ork verify\` is still what verifies)`,
  headReal: (commit) => `  real HEAD   ${commit}`,
  executor: (executor, segundos) => `  executor    ${executor}, total deadline ${segundos} s`,
  alvoClaims: (ids) => `  target      claims ${ids}`,
  alvoTarefa: (tarefa, sha, comando) => `  target      verify of task ${tarefa} (plan sha256 ${sha}): ${comando}`,
  item: (id, verificado, motivo, alegacao) => `  ${id}  ${verificado ? 'passed' : `FAILED (${motivo})`}  ${alegacao}`,
  tudoPassou: 'Result: everything passed.',
  naoPassou: (motivos) => `Result: did not pass. Reasons: ${motivos}`,
  prazoEsgotado: 'not run: the total deadline of the spot check ran out',
  recusa: (motivo, detalhe) => `claims.conferir.${motivo}: ${detalhe}`,
  semClaims: 'pass at least one claim in `--claims` (e.g. C3,C7)',
  idInvalido: (id) => `invalid claim id: ${id}`,
  repetida: (id) => `${id} requested twice`,
  tarefaInvalida: (tarefa) => `invalid task: ${tarefa} (e.g. T2.1)`,
  tarefaAusente: (tarefa) => `the plan has no task ${tarefa}`,
  tarefaRepetida: (n, tarefa) => `the plan has ${n} headings for task ${tarefa}`,
  tarefaSemVerify: (tarefa) => `task ${tarefa} has no verify line`,
  tarefaAmbigua: (tarefa, n) => `task ${tarefa} has ${n} verify lines`,
  tarefaSemComando: (tarefa, resto) => `the verify of task ${tarefa} has no command in backticks: ${resto}`,
  tarefaVariosTrechos: (tarefa, n, resto) => `the verify of task ${tarefa} has ${n} backtick span(s) and text beyond a single ` +
    `command (${resto}); the spot check does not pick which piece to run`,
  planoNaoAbre: 'the thread `docs/plan.md` does not open as a regular file',
  planoGrande: 'the thread `docs/plan.md` is not a regular file of up to 128 KiB',
  semWorktree: (thread) => `thread ${thread} has no worktree of its own; the spot check only runs in it`,
  worktreeAusente: (thread) => `the worktree of thread ${thread} does not exist on disk`,
  worktreeFora: (thread) => `the worktree of thread ${thread} is outside the project`,
  worktreeNaoRegistrada: (thread, branch) => `the worktree of thread ${thread} is not registered in the project git on branch ${branch}`,
  sandboxIndisponivel: (erro) => `${erro}; the spot check only runs confined, with no fallback`,
  erroDoSandbox: (erro) => {
    const regra = ERROS_DO_SANDBOX_EN.find(([re]) => re.test(erro));
    return regra ? regra[1](...(regra[0].exec(erro) ?? []).slice(1)) : erro;
  },
  verifyDaTarefa: (tarefa) => `the plan verify of task ${tarefa}`,
  claimsOuTarefa: 'pass `--claims C1,C2` or `--tarefa T1`, one of the two',
  prazo: (minimo, maximo) => `\`--prazo\` goes from ${minimo} to ${maximo} seconds`,
  threadAusente: (thread) => `thread ${thread} does not exist in this project`,
  threadFechada: (thread) => `thread ${thread} is closed`,
  desconhecida: (id, thread) => `${id} does not exist in thread ${thread}`,
  retiradaNaConferencia: (id, motivo) => `${id} was withdrawn (${motivo ?? 'no reason'})`,
  planoAusente: (thread) => `thread ${thread} has no \`docs/plan.md\``,
  usoVerificar: 'usage: ork claims verificar <thread-id> <claim-id> --comando "<command>"',
  comandoAnexado: (id) => `Claim ${id} now has a verification command.`,
  proveAgora: (thread) => `Prove it now: \`ork verify ${thread}\``,
  usoRetirar: 'usage: ork claims retirar <thread-id> <claim-id> --motivo "<reason>"',
  retirada: (id, thread) => `Claim ${id} withdrawn from thread ${thread}.`,
  historicoContinua: '  the history of the statement stays in claims.jsonl and in the ledger.',
  usoAusente: 'usage: ork claims ausente <thread-id> --paths A,B --motivo "<reason>" [--commit SHA]',
  ausenciaRegistrada: (thread, paths) => `Missing proof recorded in thread ${thread}: ${paths}.`,
  usoList: 'usage: ork claims list <thread-id>',
  naoExiste: (id, thread) => `claim "${id}" does not exist in thread ${thread}`,
  listaVazia: (thread) => `No claim in thread ${thread}.\n` +
    `Record one with: ork claims add ${thread} <file> --claim "<statement>" --verificar "<command>"`,
  colunas: ['ID', 'PHASE', 'STATE', 'NEGATIVE', 'FILE', 'VERIFY', 'STATEMENT'],
  sim: 'yes',
  nao: 'no',
  semComando: '(no command)',
  custoDeComandos: (limite, recebidos) => `claims.custo: a cycle without CHECK accepts up to ${limite} commands per claim ` +
    `(got ${recebidos}); use the focused test or declare the gap with \`ork claims ausente\``,
  custoDaSuite: (suite) => `claims.custo: a cycle without CHECK does not run the whole suite ("${suite}"); ` +
    'use the focused test of the file that changed',
  ausenteSemMotivo: 'prova.ausente: the reason is required (one line)',
  ausenteSemCaminhos: 'prova.ausente: pass the paths that were left without proof',
};

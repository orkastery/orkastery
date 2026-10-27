/**
 * RM-061, fatia F2b: a familia `verify` do catalogo de mensagens (`ork verify` e `ork verify --baseline`).
 * O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O detalhe de cada claim reexecutada vai ao ledger (`verify_run`): o comando o monta em pt-BR, e so a
 * impressao o remonta no locale (G2 da F2b). Motivo tipado, comando, sha e o texto da claim (dado de quem
 * a registrou) saem iguais nas duas linguas.
 */

export const VERIFY_PT_BR = {
  uso: 'uso: ork verify <thread-id> [--baseline] [--so-claims] [--check classic|agile] [--canal C] [--esperar [min]]',
  // RM-072 (D1): a opcao --check aceita so os dois modos, e o erro diz quais.
  checkInvalido: (valor: string | null) =>
    `ork verify: --check invalido: ${valor === null ? '(sem valor)' : JSON.stringify(valor)} (aceitos: classic, agile)`,
  // ork verify --baseline
  baselineGravada: (id: string) => `Baseline gravada para a thread ${id}.`,
  // RM-037 (defeito 2 de 19 e 20/10/2026): a recusa diz o comando exato do preparo, ou como declara-lo.
  baselineDependenciaAusente: (nome: string, code: number, comando: string, preparo?: string | null) =>
    `baseline.dependencia-ausente: ${nome} nao executou porque o comando nao existe (codigo ${code}): ${comando}; ` +
    (preparo ? `rode na worktree da thread o preparo do manifesto (worktree.dependencias): ${preparo}; depois grave a baseline de novo`
      : 'instale ou prepare as dependencias antes de gravar a baseline; para o ork preparar toda worktree nova, declare o ' +
        'comando em worktree.dependencias no manifesto'),
  // RM-037 (CHECK 3 da ork-rm037defeit2): o preparo que a criacao adiou falhou, e a operacao nao roda sem as dependencias.
  dependenciasPendentesFalharam: (operacao: 'baseline' | 'verify', comando: string, code: number, estourou: boolean, dir: string,
    ultimaLinha: string) =>
    `${operacao}.dependencia-ausente: o preparo adiado da worktree (worktree.dependencias) ` +
    `${estourou ? 'estourou o prazo' : `saiu com codigo ${code}`}${ultimaLinha ? `: ${ultimaLinha}` : ''}; ` +
    `${operacao === 'baseline' ? 'a baseline nao foi gravada' : 'o verify nao rodou'} sem as dependencias. Rode na worktree ` +
    `cd ${dir} && ${comando}; ${operacao === 'baseline' ? 'a proxima baseline' : 'o proximo verify'} repete o preparo antes dos comandos`,
  baselineCommit: (commit: string) => `  commit ${commit}`,
  // RM-072 (D1): o modo do CHECK que gravou a baseline; o nome de produto e o mesmo nas duas linguas.
  baselineCheck: (nome: string, modo: string, origem: 'opcao' | 'manifesto' | 'padrao') => `  ${'check'.padEnd(10)} ${nome} (` +
    `${origem === 'opcao' ? `opcao --check ${modo}` : origem === 'manifesto' ? `manifesto: check.mode: ${modo}`
      : 'padrao: o manifesto nao declara check.mode'})`,
  // RM-037 (defeito 1 de 19 e 20/10/2026): o comando sem veredito (estouro, sinal, relogio sob steal, nao rodou) nao vale
  // como "ja falhava"; `situacao` e a do comando, no locale da impressao.
  baselineComando: (nome: string, veredito: 'passava' | 'ja-falhava' | 'sem-veredito', code: number, comando: string,
    situacao: string) => `  ${nome.padEnd(10)} ${veredito === 'passava' ? 'passava' : veredito === 'ja-falhava'
    ? `ja falhava (codigo ${code})` : `SEM VEREDITO, ${situacao}: nao vale como "ja falhava"`}  ${comando}`,
  baselineSemVeredito: (nomes: string, id: string) => `  sem veredito na baseline: ${nomes}; no verify, a falha deles sai ` +
    `como falha sem baseline (verify.failed), nunca como pre-existente. Grave de novo com ork verify ${id} --baseline ` +
    'numa hora de CPU livre, ou suba verify.timeout_ms_por_comando no manifesto',
  baselineSaida: (caminho: string, id: string) => `  saida de quem falhou: as ultimas linhas em ${caminho}, campo baseline.comandos ` +
    `(resumo e trecho); o evento baseline_recorded esta em ork phase list ${id}`,
  baselineSemComandos: '  (nenhum comando em verify: no manifesto: a baseline guarda so o commit, e o verify nao tem como separar regressao de divida)',
  // ork verify: cabecalho
  titulo: (id: string) => `ork verify da thread ${id}`,
  head: (commit: string) => `  HEAD real   ${commit}`,
  diretorio: (cwd: string) => `  diretorio   ${cwd}`,
  // RM-072 (D1, D17): todo CHECK diz o modo que rodou e de onde ele veio.
  check: (nome: string, modo: string, origem: 'opcao' | 'manifesto' | 'padrao') => `  check       ${nome} (` +
    `${origem === 'opcao' ? `opcao --check ${modo}` : origem === 'manifesto' ? `manifesto: check.mode: ${modo}`
      : 'padrao: o manifesto nao declara check.mode'})`,
  baseline: (sha: string, quando: string) => `  baseline    ${sha} de ${quando}`,
  semBaseline: '  baseline    (nao gravada: falha nao pode ser chamada de regressao)',
  // RM-072 (D8): o que o Agile fez na rodada, e cada peca que caiu para o equivalente do Classic.
  agile: (reaproveitadas: number, inteiras: number, paralelo: boolean, lanes: string[]) =>
    `  agile       ${reaproveitadas} comando(s) de claim contra o produto do preparo, ${inteiras} inteiro(s); ` +
    `${paralelo ? `grupo em paralelo${lanes.length ? ` com as lanes ${lanes.join(', ')}` : ''}` : 'comandos do manifesto em serie'}`,
  agileFallback: (peca: string, motivo: string, fallback: string) =>
    `  fallback    ${peca}: ${motivo || 'sem motivo dito'}; rodou ${fallback || 'o equivalente do Classic'}`,
  preparo: (situacao: string, segundos: number, alterado: boolean) => `  preparo     ${situacao} em ` +
    `${segundos} s, uma vez para a rodada; produto ` +
    `${alterado ? 'MUDOU no meio da rodada: nenhum veredito vale' : 'conferido do preparo ao fim'}`,
  stealMedido: (pct: number | null, fonte: string, limiar: number) =>
    `  steal       ${pct}% na rodada (${fonte}; acima de ${limiar}%, teste com relogio que reprova fica sem veredito)`,
  stealNaoMedido: (fonte: string) => `  steal       nao medido (sem ${fonte} nesta maquina): nenhuma reprovacao e atenuada`,
  instabilidadeForaDoContrato: (arquivo: string, erros: string) =>
    `  instabilidade ${arquivo} FORA DO CONTRATO, nenhuma entrada vale: ${erros}`,
  instabilidadeVencidas: (n: number, testes: string) =>
    `  instabilidade ${n} entrada(s) vencida(s), sem valor ate nova medida: ${testes}`,
  // Claims
  claimsReexecutadas: 'Claims reexecutadas no HEAD real:',
  nenhumaClaim: '  (nenhuma claim registrada nesta thread)',
  claim: (id: string, verificado: boolean, alegacao: string) => `  ${id}  verificado: ${verificado ? 'sim' : 'NAO'}  ${alegacao}`,
  arquivo: (arquivo: string) => `      arquivo: ${arquivo}`,
  comandos: (comandos: string) => `      comando(s): ${comandos}`,
  semComando: '      sem comando de verificacao',
  motivoTipado: (motivo: string, detalhe: string) => `      motivo tipado: ${motivo} (${detalhe})`,
  // Comandos do manifesto
  comandosDoManifesto: 'Comandos de verify do manifesto:',
  comandoOk: 'ok',
  comando: (nome: string, situacao: string, comando: string) => `  ${nome.padEnd(10)} ${situacao}  ${comando}`,
  testesQueCairam: (testes: string) => `             teste(s) que caiu(ram): ${testes}`,
  estourou: (prazo: string, rodou: string) => `ESTOUROU O PRAZO (${prazo}, rodou ${rodou})`,
  relogioSobSteal: (pct: number | null | undefined, limiar: number) => `RELOGIO SOB STEAL (${pct}% de steal, acima de ${limiar}%)`,
  naoExecutou: (code: number) => `NAO EXECUTOU (comando nao encontrado, codigo ${code})`,
  mortoPorSinal: (code: number) => `MORTO POR SINAL (codigo ${code})`,
  falhou: (code: number) => `FALHOU (codigo ${code})`,
  semVeredito: (nomes: string) => `Sem veredito por tempo (nao e reprovacao: prazo estourado ou relogio sob steal): ${nomes}`,
  // Classificacao e veredito
  classificacao: (regressoes: number, preExistentes: number, semBaseline: number) =>
    `Classificacao: ${regressoes} regressao(oes), ${preExistentes} pre-existente(s), ${semBaseline} falha(s) sem baseline`,
  regressao: (nome: string, comando: string) => `  regressao      ${nome}: ${comando}`,
  preExistente: (nome: string, comando: string) => `  pre-existente  ${nome}: ${comando}`,
  falhaSemBaseline: (nome: string, comando: string) => `  sem baseline   ${nome}: ${comando}`,
  falhaComBaselineSemVeredito: (nome: string, comando: string) =>
    `  sem baseline   ${nome}: ${comando} (a baseline nao teve veredito dele)`,
  verdade: 'Veredito: VERDADE SUSTENTADA (nenhum motivo bloqueante).',
  reprovado: (motivos: string) => `Veredito: REPROVADO. Motivos tipados: ${motivos}`,
  // Detalhe da claim reexecutada (vai ao ledger em pt-BR)
  claimNegativaSemComando: 'alegacao negativa/absoluta sem comando de verificacao: nao ha como comprova-la',
  claimSemComando: 'sem comando de verificacao declarado',
  claimNaoExecutada: (comando: string, resumo: string) => `comando "${comando}" nao foi executado: ${resumo}`,
  claimEstourou: (comando: string, segundos: number) => `comando "${comando}" estourou o prazo de ${segundos} s sem terminar`,
  claimRelogio: (comando: string, pct: number | null | undefined, limiar: number, testes: string) =>
    `comando "${comando}" reprovou so em teste com relogio sob steal de ${pct}% (acima de ${limiar}%): ${testes}`,
  claimSaiu: (comando: string, code: number) => `comando "${comando}" saiu com codigo ${code}`,
  claimOk: (n: number) => `${n} comando(s) reexecutado(s) com sucesso`,
  // RM-058 N2: a espera pela fila de recursos pesados, dita uma vez no stderr enquanto o verify espera.
  filaPesadaOcupante: (operacao: string, thread: string | null, desde: string) =>
    `${operacao}${thread ? ` da thread ${thread}` : ''} desde ${desde}`,
  filaPesadaEsperando: (operacao: string, ocupantes: string) =>
    `Esperando a vez na fila de recursos pesados (concurrency.max_parallel_heavy) para o ${operacao}: ` +
    `ocupada por ${ocupantes || 'um pedido que chegou antes'}.`,
  // RM-062 (F2): a barreira de dado privado (policy `dado_privado`); o valor casado e o termo nunca saem.
  dadoPrivadoTitulo: (severidade: string) => `Dado privado (policy dado_privado em ${severidade}):`,
  dadoPrivadoEscopoArvore: 'arvore versionada inteira (sem base para o diff)',
  dadoPrivadoEscopoDiff: (sha: string, ref: string | null) =>
    `diff da thread contra ${sha} (${ref ? `merge-base com ${ref}` : 'base carimbada da thread'})`,
  dadoPrivadoEscopoTexto: (nome: string) => `texto de ${nome}`,
  dadoPrivadoEscopo: (escopo: string, arquivos: number, linhas: number, nomes: number) =>
    `  escopo       ${escopo}: ${arquivos} arquivo(s), ${linhas} linha(s), ${nomes} nome(s)`,
  dadoPrivadoListaPresente: (termos: number, de: string) => `  lista local  ${termos} termo(s) de ${de}`,
  dadoPrivadoListaAusente: (onde: string) =>
    `  lista local  ausente (procurada em ${onde}): so os padroes genericos (home, email, hostname)`,
  dadoPrivadoErro: (erro: string) => `  NAO RODOU    ${erro}`,
  dadoPrivadoAchados: (n: number) => n ? `  achados      ${n} (o valor casado nunca e impresso)` : '  achados      nenhum',
  dadoPrivadoAchado: (arquivo: string, linha: number | null, coluna: number | null, padrao: string, termo?: number) =>
    `    ${linha === null ? `${arquivo}  nome do arquivo` : `${arquivo}:${linha}:${coluna}`}  ${padrao}${termo ? ` (termo ${termo})` : ''}`,
  dadoPrivadoMais: (n: number) => `    ... e mais ${n}`,
};

export const VERIFY_EN: typeof VERIFY_PT_BR = {
  uso: 'usage: ork verify <thread-id> [--baseline] [--so-claims] [--check classic|agile] [--canal C] [--esperar [min]]',
  checkInvalido: (valor) => `ork verify: invalid --check: ${valor === null ? '(no value)' : JSON.stringify(valor)} (accepted: classic, agile)`,
  baselineGravada: (id) => `Baseline recorded for thread ${id}.`,
  baselineDependenciaAusente: (nome, code, comando, preparo) =>
    `baseline.missing-dependency: ${nome} did not run because the command does not exist (exit ${code}): ${comando}; ` +
    (preparo ? `run the manifest preparation (\`worktree.dependencias\`) in the thread worktree: \`${preparo}\`; then record the baseline again`
      : 'install or prepare dependencies before recording the baseline; for ork to prepare every new worktree, declare the ' +
        'command in `worktree.dependencias` in the manifest'),
  dependenciasPendentesFalharam: (operacao, comando, code, estourou, dir, ultimaLinha) =>
    `${operacao}.missing-dependency: the deferred worktree preparation (\`worktree.dependencias\`) ` +
    `${estourou ? 'ran past its deadline' : `exited with code ${code}`}${ultimaLinha ? `: ${ultimaLinha}` : ''}; ` +
    `${operacao === 'baseline' ? 'the baseline was not recorded' : 'verify did not run'} without the dependencies. Run in the ` +
    `worktree \`cd ${dir} && ${comando}\`; ${operacao === 'baseline' ? 'the next baseline' : 'the next verify'} repeats the ` +
    'preparation before the commands',
  baselineCommit: (commit) => `  commit ${commit}`,
  baselineCheck: (nome, modo, origem) => `  ${'check'.padEnd(10)} ${nome} (${origem === 'opcao' ? `option --check ${modo}`
    : origem === 'manifesto' ? `manifest: check.mode: ${modo}` : 'default: the manifest does not declare check.mode'})`,
  baselineComando: (nome, veredito, code, comando, situacao) => `  ${nome.padEnd(10)} ${veredito === 'passava' ? 'passed'
    : veredito === 'ja-falhava' ? `already failing (exit ${code})` : `NO VERDICT, ${situacao}: does not count as "already failing"`}  ${comando}`,
  baselineSemVeredito: (nomes, id) => `  no verdict in the baseline: ${nomes}; in verify, their failure is reported as a ` +
    `failure without a baseline (\`verify.failed\`), never as pre-existing. Record it again with \`ork verify ${id} --baseline\` ` +
    'when the CPU is free, or raise `verify.timeout_ms_por_comando` in the manifest',
  baselineSaida: (caminho, id) => `  output of the failing commands: the last lines in ${caminho}, field \`baseline.comandos\` ` +
    `(summary and excerpt); the baseline_recorded event is in \`ork phase list ${id}\``,
  baselineSemComandos: '  (no command under `verify:` in the manifest: the baseline keeps only the commit, and verify cannot tell a regression from existing debt)',
  titulo: (id) => `ork verify for thread ${id}`,
  head: (commit) => `  real HEAD   ${commit}`,
  diretorio: (cwd) => `  directory   ${cwd}`,
  check: (nome, modo, origem) => `  check       ${nome} (${origem === 'opcao' ? `option --check ${modo}`
    : origem === 'manifesto' ? `manifest: check.mode: ${modo}` : 'default: the manifest does not declare check.mode'})`,
  baseline: (sha, quando) => `  baseline    ${sha} from ${quando}`,
  semBaseline: '  baseline    (not recorded: a failure cannot be called a regression)',
  agile: (reaproveitadas, inteiras, paralelo, lanes) =>
    `  agile       ${reaproveitadas} claim command(s) against the prepared product, ${inteiras} in full; ` +
    `${paralelo ? `parallel group${lanes.length ? ` with lanes ${lanes.join(', ')}` : ''}` : 'manifest commands in series'}`,
  agileFallback: (peca, motivo, fallback) => `  fallback    ${peca}: ${motivo || 'no reason given'}; ran ${fallback || 'the Classic equivalent'}`,
  preparo: (situacao, segundos, alterado) => `  prepare     ${situacao} in ${segundos} s, once for the run; product ` +
    `${alterado ? 'CHANGED during the run: no verdict counts' : 'checked from prepare to end'}`,
  stealMedido: (pct, fonte, limiar) =>
    `  steal       ${pct}% in the run (${fonte}; above ${limiar}%, a failing clock-bound test gets no verdict)`,
  stealNaoMedido: (fonte) => `  steal       not measured (no ${fonte} on this machine): no failure is softened`,
  instabilidadeForaDoContrato: (arquivo, erros) => `  flaky tests ${arquivo} OUT OF CONTRACT, no entry counts: ${erros}`,
  instabilidadeVencidas: (n, testes) => `  flaky tests ${n} expired entry(ies), not counted until measured again: ${testes}`,
  claimsReexecutadas: 'Claims rerun on the real HEAD:',
  nenhumaClaim: '  (no claim recorded in this thread)',
  claim: (id, verificado, alegacao) => `  ${id}  verified: ${verificado ? 'yes' : 'NO'}  ${alegacao}`,
  arquivo: (arquivo) => `      file: ${arquivo}`,
  comandos: (comandos) => `      command(s): ${comandos}`,
  semComando: '      no verification command',
  motivoTipado: (motivo, detalhe) => `      typed reason: ${motivo} (${detalhe})`,
  comandosDoManifesto: 'Manifest verify commands:',
  comandoOk: 'ok',
  comando: (nome, situacao, comando) => `  ${nome.padEnd(10)} ${situacao}  ${comando}`,
  testesQueCairam: (testes) => `             failing test(s): ${testes}`,
  estourou: (prazo, rodou) => `TIMED OUT (${prazo}, ran ${rodou})`,
  relogioSobSteal: (pct, limiar) => `CLOCK UNDER STEAL (${pct}% steal, above ${limiar}%)`,
  naoExecutou: (code) => `DID NOT RUN (command not found, exit ${code})`,
  mortoPorSinal: (code) => `KILLED BY SIGNAL (exit ${code})`,
  falhou: (code) => `FAILED (exit ${code})`,
  semVeredito: (nomes) => `No verdict for lack of time (not a failure: deadline exceeded or clock under steal): ${nomes}`,
  classificacao: (regressoes, preExistentes, semBaseline) =>
    `Classification: ${regressoes} regression(s), ${preExistentes} pre-existing, ${semBaseline} failure(s) without a baseline`,
  regressao: (nome, comando) => `  regression     ${nome}: ${comando}`,
  preExistente: (nome, comando) => `  pre-existing   ${nome}: ${comando}`,
  falhaSemBaseline: (nome, comando) => `  no baseline    ${nome}: ${comando}`,
  falhaComBaselineSemVeredito: (nome, comando) => `  no baseline    ${nome}: ${comando} (the baseline had no verdict for it)`,
  verdade: 'Verdict: VERIFIED (no blocking reason).',
  reprovado: (motivos) => `Verdict: FAILED. Typed reasons: ${motivos}`,
  claimNegativaSemComando: 'negative or absolute claim without a verification command: there is no way to prove it',
  claimSemComando: 'no verification command declared',
  claimNaoExecutada: (comando, resumo) => `command "${comando}" did not run: ${resumo}`,
  claimEstourou: (comando, segundos) => `command "${comando}" ran past its ${segundos} s deadline`,
  claimRelogio: (comando, pct, limiar, testes) =>
    `command "${comando}" failed only in clock-bound tests under ${pct}% steal (above ${limiar}%): ${testes}`,
  claimSaiu: (comando, code) => `command "${comando}" exited with code ${code}`,
  claimOk: (n) => `${n} command(s) rerun successfully`,
  filaPesadaOcupante: (operacao, thread, desde) => `${operacao}${thread ? ` of thread ${thread}` : ''} since ${desde}`,
  filaPesadaEsperando: (operacao, ocupantes) =>
    `Waiting for a turn in the heavy-work queue (\`concurrency.max_parallel_heavy\`) for the ${operacao}: ` +
    `held by ${ocupantes || 'a request that arrived earlier'}.`,
  dadoPrivadoTitulo: (severidade) => `Private data (policy dado_privado at ${severidade}):`,
  dadoPrivadoEscopoArvore: 'whole versioned tree (no base for the diff)',
  dadoPrivadoEscopoDiff: (sha, ref) => `thread diff against ${sha} (${ref ? `merge-base with ${ref}` : 'the thread stamped base'})`,
  dadoPrivadoEscopoTexto: (nome) => `text of ${nome}`,
  dadoPrivadoEscopo: (escopo, arquivos, linhas, nomes) =>
    `  scope        ${escopo}: ${arquivos} file(s), ${linhas} line(s), ${nomes} name(s)`,
  dadoPrivadoListaPresente: (termos, de) => `  local list   ${termos} term(s) from ${de}`,
  dadoPrivadoListaAusente: (onde) => `  local list   missing (looked in ${onde}): only the generic patterns (home, email, hostname)`,
  dadoPrivadoErro: (erro) => `  DID NOT RUN  ${erro}`,
  dadoPrivadoAchados: (n) => n ? `  findings     ${n} (the matched value is never printed)` : '  findings     none',
  dadoPrivadoAchado: (arquivo, linha, coluna, padrao, termo) =>
    `    ${linha === null ? `${arquivo}  file name` : `${arquivo}:${linha}:${coluna}`}  ${padrao}${termo ? ` (term ${termo})` : ''}`,
  dadoPrivadoMais: (n) => `    ... and ${n} more`,
};

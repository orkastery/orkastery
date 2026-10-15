/**
 * RM-061, fatia F2b: a familia `verify` do catalogo de mensagens (`ork verify` e `ork verify --baseline`).
 * O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * O detalhe de cada claim reexecutada vai ao ledger (`verify_run`): o comando o monta em pt-BR, e so a
 * impressao o remonta no locale (G2 da F2b). Motivo tipado, comando, sha e o texto da claim (dado de quem
 * a registrou) saem iguais nas duas linguas.
 */

export const VERIFY_PT_BR = {
  uso: 'uso: ork verify <thread-id> [--baseline] [--so-claims] [--canal C] [--esperar [min]]',
  // ork verify --baseline
  baselineGravada: (id: string) => `Baseline gravada para a thread ${id}.`,
  baselineDependenciaAusente: (nome: string, code: number, comando: string) =>
    `baseline.dependencia-ausente: ${nome} nao executou porque o comando nao existe (codigo ${code}): ${comando}; ` +
    'instale ou prepare as dependencias antes de gravar a baseline',
  baselineCommit: (commit: string) => `  commit ${commit}`,
  baselineComando: (nome: string, ok: boolean, code: number, comando: string) =>
    `  ${nome.padEnd(10)} ${ok ? 'passava' : `ja falhava (codigo ${code})`}  ${comando}`,
  baselineSaida: (caminho: string, id: string) => `  saida de quem falhou: as ultimas linhas em ${caminho}, campo baseline.comandos ` +
    `(resumo e trecho); o evento baseline_recorded esta em ork phase list ${id}`,
  baselineSemComandos: '  (nenhum comando em verify: no manifesto: a baseline guarda so o commit, e o verify nao tem como separar regressao de divida)',
  // ork verify: cabecalho
  titulo: (id: string) => `ork verify da thread ${id}`,
  head: (commit: string) => `  HEAD real   ${commit}`,
  diretorio: (cwd: string) => `  diretorio   ${cwd}`,
  baseline: (sha: string, quando: string) => `  baseline    ${sha} de ${quando}`,
  semBaseline: '  baseline    (nao gravada: falha nao pode ser chamada de regressao)',
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
};

export const VERIFY_EN: typeof VERIFY_PT_BR = {
  uso: 'usage: ork verify <thread-id> [--baseline] [--so-claims] [--canal C] [--esperar [min]]',
  baselineGravada: (id) => `Baseline recorded for thread ${id}.`,
  baselineDependenciaAusente: (nome, code, comando) =>
    `baseline.missing-dependency: ${nome} did not run because the command does not exist (exit ${code}): ${comando}; ` +
    'install or prepare dependencies before recording the baseline',
  baselineCommit: (commit) => `  commit ${commit}`,
  baselineComando: (nome, ok, code, comando) => `  ${nome.padEnd(10)} ${ok ? 'passed' : `already failing (exit ${code})`}  ${comando}`,
  baselineSaida: (caminho, id) => `  output of the failing commands: the last lines in ${caminho}, field \`baseline.comandos\` ` +
    `(summary and excerpt); the baseline_recorded event is in \`ork phase list ${id}\``,
  baselineSemComandos: '  (no command under `verify:` in the manifest: the baseline keeps only the commit, and verify cannot tell a regression from existing debt)',
  titulo: (id) => `ork verify for thread ${id}`,
  head: (commit) => `  real HEAD   ${commit}`,
  diretorio: (cwd) => `  directory   ${cwd}`,
  baseline: (sha, quando) => `  baseline    ${sha} from ${quando}`,
  semBaseline: '  baseline    (not recorded: a failure cannot be called a regression)',
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
};

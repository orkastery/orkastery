/**
 * RM-061, fatia F2b: a familia `retry` do catalogo de mensagens (`ork retry plan` e `ork retry run`). O
 * pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * A politica por motivo tipado (`porque` e `correcao`) tem a fonte aqui: `POLITICA_DE_RETRY` le o pt-BR, e
 * o `--json` de `retry plan` e de `retry policy` nao muda. A razao do plano e o detalhe da execucao vao ao
 * ledger: o comando os monta em pt-BR, e so a impressao os remonta no locale (G2 da F2b). Motivo, acao,
 * bloqueio e comando saem iguais nas duas linguas (G4): o condutor procura `auth-missing` e
 * `quota-exhausted` na saida de `ork retry run`.
 */

export const RETRY_PT_BR = {
  /** `porque` e `correcao` de cada motivo tipado: a fonte de `POLITICA_DE_RETRY`. */
  politica: {
    'artifact.missing': {
      porque: 'o artefato exigido pela fase nao existe: a fase precisa de spec dirigida do que gravar, nao de repeticao cega do mesmo prompt',
      correcao: 'ork fix open <thread> abre a rodada com a spec exata',
    },
    'claims.failed': {
      porque: 'a alegacao reprovou na reexecucao no HEAD real: reexecutar a fase igual reproduz a mesma mentira; o que resolve e GO-FIX com a claim e o comando exatos',
      correcao: 'ork fix open <thread> e depois ork fix reverify <thread>',
    },
    'claims.unverifiable': {
      porque: 'alegacao sem comando de verificacao vira correcao tipo A: anexar o comando (ou retirar a alegacao com motivo) e uma linha, nao um GO inteiro',
      correcao: 'ork claims verificar <thread> <claim> --comando "<comando>"',
    },
    'policy.violation': {
      porque: 'policy com severidade block reprova em qualquer modo: reexecutar sozinho seria a maquina revogando a policy do manifesto',
      correcao: 'corrija a violacao no pedido/manifesto; policy block nao se resolve por repeticao',
    },
    'runtime.autoconferencia': {
      porque: 'repetir o despacho no MESMO runtime daria o mesmo resultado: o que falta nao e tentativa, e um validador que nao seja quem executou. Escolher o outro runtime e decisao de conducao, nao retry',
      correcao: 'despache o CHECK em outro runtime (`ork phase run <thread> CHECK --runtime <outro>`), ou tire a exigencia de validacao cruzada da thread se ela nao se justifica',
    },
    'runtime.profile-invalid': {
      porque: 'o perfil foi pedido pelo dono (--perfil) e nao existe no store ou e de outro runtime: repetir o pedido daria a mesma recusa, e trocar de perfil sozinho desobedeceria o pedido',
      correcao: 'ork accounts list mostra os perfis de cada runtime; repita o despacho com um perfil do runtime certo ou sem --perfil',
    },
    'cost.violation': {
      porque: 'violacao de CUSTO nunca recebe retry automatico: cada reexecucao gastaria de novo pelo provider pago (subscription-only e regra de codigo, nao lembrete)',
      correcao: 'tire do ambiente a variavel que redireciona o despacho e rode a fase de novo a mao, com o gasto sob os olhos de um humano',
    },
    'verify.regression': {
      porque: 'o comando passava na baseline e falha agora: o defeito e desta thread e tem alvo conhecido, entao ele vira spec de GO-FIX tipo B',
      correcao: 'ork fix open <thread> (a reexecucao seguinte e completa)',
    },
    'verify.failed': {
      porque: 'o comando falha sem baseline para separar regressao de divida: a correcao dirigida conserta ou grava a baseline, mas nao chuta de quem e a culpa',
      correcao: 'ork fix open <thread>, ou ork verify <thread> --baseline antes do proximo GO',
    },
    'verify.timeout': {
      porque: 'o prazo estourou antes de o comando terminar: a prova nao chegou ao fim, e carga de maquina nao e defeito. A reexecucao e completa, e o limite de escalacao do manifesto impede repetir para sempre',
      correcao: 'ork verify <thread> de novo; se estourar sempre, suba verify.timeout_ms no manifesto ou divida o comando',
    },
    'verify.sem-veredito': {
      porque: 'um comando nao chegou a rodar ou o produto mudou no meio da rodada: nao ha veredito sobre ele, e a prova certa e rodar de novo, inteira',
      correcao: 'ork verify <thread> de novo, sem editar a worktree durante a rodada',
    },
    'ci.failed': {
      porque: 'o recibo pertence ao provedor e ao SHA candidato: repetir uma fase não cria nem altera legitimamente esse resultado',
      correcao: 'publique a candidata, aguarde o check obrigatório e repita o SHIP; se reprovou, corrija a causa registrada no runner',
    },
    'runtime.unavailable': {
      porque: 'falha de infraestrutura no despacho nao e falha de conteudo: o MESMO prompt, com o mesmo sha256, sobe a escada de recuperacao ' +
        '(reerguer o daemon do runtime, o fallback do bloco, outro perfil) sem alterar uma virgula, e so depois dela o dono e chamado',
      correcao: 'ork retry run <thread> sobe a escada com o prompt ja gravado em disco',
    },
    'runtime.silencio': {
      porque: 'fase sem heartbeat: retomar o despacho original com hash conferido e limite de tentativas',
      correcao: 'ork retry run <thread> --motivo runtime.silencio',
    },
    'runtime.rate-limited': {
      porque: 'o limite de uso tem HORA de volta: a fase entra na fila duravel e e retomada na janela seguinte, sem humano no meio e sem gastar por fora da assinatura',
      correcao: 'ork retry list mostra a fila; ork retry resume retoma o que ja liberou',
    },
    'runtime.quota-exhausted': {
      porque: 'a cota ou os creditos da CONTA acabaram, nao a infraestrutura: o perfil sai do rodizio ate o prazo; o prompt original, se o intervalo ficou vazio, ou um checkpoint da producao parcial segue no proximo perfil, no runtime de fallback ou na fila ate o menor prazo',
      correcao: 'ork accounts list mostra o perfil esgotado; ork retry run <thread> rotaciona o prompt ja gravado',
    },
    'runtime.auth-missing': {
      porque: 'a conta do runtime perdeu a autenticacao: o perfil nunca mais recebe despacho ate o login ser refeito pelo proprio CLI, e o MESMO prompt segue no proximo perfil ou no runtime de fallback',
      correcao: 'ork accounts check confere o login de cada perfil; ork retry run <thread> rotaciona o prompt ja gravado',
    },
    'runtime.model-unavailable': {
      porque: 'o modelo pedido nao existe ou a conta nao tem acesso a ele: o MESMO prompt, com o mesmo sha256, segue no proximo perfil do mesmo runtime com o mesmo modelo e depois no fallback do bloco, nunca de novo no par que ja recusou',
      correcao: 'ork retry run <thread> troca o destino; sem destino, ork setup <modo> --bloco N --model <modelo acessivel> ou --fallback runtime:modelo',
    },
    'runtime.workspace-untrusted': {
      porque: 'o runtime recusou o diretorio da worktree antes de rodar qualquer coisa: depois que o dono aceita a confianca no terminal, o MESMO prompt, com o mesmo sha256, volta a mesma fase; enquanto a confianca nao aparece no .claude.json da conta, nada e despachado',
      correcao: 'o dono roda o comando da pausa (cd <worktree> && claude, aceita a confianca); ork retry run <thread> re-despacha o prompt ja gravado',
    },
    'runtime.consent-pending': {
      porque: 'o runtime espera o dono aceitar termos novos antes de rodar qualquer coisa: depois do aceite, o MESMO prompt, com o mesmo sha256, volta a mesma fase; se o runtime recusar de novo, a mesma pausa do dono volta',
      correcao: 'o dono abre o CLI do runtime e aceita os termos; ork retry run <thread> re-despacha o prompt ja gravado',
    },
    'tree.blocked': {
      porque: 'a arvore de destino andou por baixo da thread: rebasar a worktree contra a base e o passo que desbloqueia, e reexecutar antes disso so repete o conflito',
      correcao: 'ork worktree sync <thread> e so entao repetir o passo',
    },
    'lease.resume-unavailable': {
      porque: 'sem inode seguro, a remocao forcada exige avaliar a posse antes de retomar',
      correcao: 'ork lease release <nome> --forcar; depois repita a aquisicao',
    },
    'lease.busy': {
      porque: 'o lease e de outra thread e vai ser liberado: a fila ja serializa, entao a acao e tentar de novo quando chegar a vez, nunca furar a fila',
      correcao: 'ork lease list mostra a fila; a vez chega sem ninguem forcar',
    },
    'conducao.em-andamento': {
      porque: 'outra conducao executa na mesma worktree agora: a vez chega quando ela terminar, e furar a fila e o incidente de 19/09/2026',
      correcao: 'ork conducao status <thread> mostra quem conduz; repita o pedido com --esperar <min> para seguir sozinho quando liberar',
    },
    'hitl.formato': {
      porque: 'o pedido HITL saiu fora do formato obrigatorio: quem errou foi o emissor, e a correcao e reemitir com alternativas rotuladas, consequencia por alternativa e exatamente uma recomendada com o porque',
      correcao: 'ork fix open <thread> abre a rodada com a spec exata do formato',
    },
    'human.pending': {
      porque: 'nao e reprovacao de verdade, e espera de autorizacao: automatizar a espera seria a maquina se autorizando',
      correcao: 'ork gate request <thread>',
    },
  },
  usoPlanRun: (sub: string) => `uso: ork retry ${sub} <thread-id> [--motivo M] [--fase F]`,
  // textoDoPlano
  titulo: (thread: string) => `Plano de retry da thread ${thread}`,
  modo: (modo: string) => `  modo            ${modo}`,
  fase: (fase: string | null) => `  fase            ${fase ?? '(nenhuma)'}`,
  motivo: (motivo: string | null) => `  motivo tipado   ${motivo ?? '(nenhuma reprovacao pendente)'}`,
  detalhe: (detalhe: string) => `  detalhe         ${detalhe}`,
  acao: (acao: string) => `  acao            ${acao}`,
  tentativas: (feitas: number, limite: number) => `  tentativas      ${feitas} de ${limite} antes da escalacao`,
  esforco: (effort: string, anterior: string | null) => `  esforco         ${effort}${anterior !== null ? ` (escalado de ${anterior})` : ''}`,
  automatica: (sim: boolean) => `  automatica      ${sim ? 'sim' : 'nao'}`,
  bloqueio: (bloqueio: string) => `  bloqueio        ${bloqueio}`,
  razao: (razao: string) => `  razao           ${razao}`,
  correcao: (correcao: string) => `  correcao        ${correcao}`,
  // textoDoRetry
  execucao: (executada: boolean) => `Execucao: ${executada ? 'acao executada' : 'nada executado'}`,
  linhaDoDetalhe: (detalhe: string) => `  ${detalhe}`,
  rodada: (rodada: number, correcoes: string) => `GO-FIX rodada ${rodada}: ${correcoes}`,
  correcaoDaRodada: (id: string, tipo: string, origem: string) => `${id} (tipo ${tipo}, ${origem})`,
  reverify: (veredito: string, cobertura: string) => `CHECK-REVERIFY: ${veredito} (cobertura ${cobertura})`,
  /** O veredito e a cobertura do CHECK-REVERIFY sao dado (ledger, --json); o texto so os traduz na impressao. */
  vereditos: { 'PASSOU': 'PASSOU', 'PRECISA DE MUDANCA': 'PRECISA DE MUDANCA', 'BLOQUEADO': 'BLOQUEADO' } as Record<string, string>,
  coberturas: { completa: 'completa', parcial: 'parcial' } as Record<string, string>,
  fila: 'Fila de rate limit desta thread:',
  pedidoNaFila: (id: string, fase: string, quando: string, estimada: boolean) =>
    `  ${id}  ${fase}  libera em ${quando}${estimada ? ' (janela estimada)' : ''}`,
  complementar: {
    politicaTitulo: 'Politica de retry por motivo tipado de gate (bloco B3)',
    colunasPolitica: ['MOTIVO TIPADO', 'ACAO DE RETRY', 'AUTOMATICA', 'POR QUE'] as readonly string[],
    sim: 'sim', nao: 'nao',
    politicaFecho: [
      'A politica e a MESMA em todos os modos: o modo afrouxa a pausa, nunca a',
      'verificacao. cost.violation nunca recebe retry automatico, e o limite de',
      'escalacao (retry.max_tentativas) pausa qualquer modo, inclusive #Auto.',
    ] as readonly string[],
    motivoDesconhecido: (motivo: string) => `motivo tipado desconhecido: ${motivo}`,
    conhecidos: (lista: string) => `  conhecidos: ${lista}`,
    motivo: (valor: string) => `motivo tipado: ${valor}`,
    significado: (valor: string) => `  significado  ${valor}`,
    acao: (valor: string) => `  acao         ${valor}`,
    automatica: (valor: string) => `  automatica   ${valor}`,
    porque: (valor: string) => `  por que      ${valor}`,
    correcao: (valor: string) => `  correcao     ${valor}`,
    usoParse: 'uso: ork retry parse --stderr "<texto do stderr do adapter>"',
    semSinal: 'Nenhum sinal de rate limit reconhecido neste texto.',
    sinal: 'Sinal de rate limit reconhecido no stderr do runtime:',
    fonte: (valor: string) => `  fonte da hora  ${valor}`,
    reset: (valor: string) => `  reset em       ${valor}`,
    semHora: '(o runtime nao disse a hora)',
    trecho: (valor: string) => `  trecho         ${valor}`,
    estimada: [
      '  Sem hora no texto, a fila usa retry.janela_padrao_min do manifesto e marca',
      '  o pedido como janela ESTIMADA. O `ork` nao inventa horario de reset.',
    ] as readonly string[],
    proxima: (quando: string, falta: string) => `Proxima janela: ${quando} (${falta}).`,
    retome: 'Retome com: ork retry resume',
    usoCancel: 'uso: ork retry cancel <id> --motivo "<motivo>"',
    cancelado: (id: string) => `Pedido ${id} cancelado na fila de rate limit.`,
    thread: (valor: string) => `  thread   ${valor}`, fase: (valor: string) => `  fase     ${valor}`,
    motivoLinha: (valor: string) => `  motivo   ${valor}`,
    desconhecido: (sub: string) => `subcomando desconhecido: retry ${sub}`,
    filaVazia: 'Fila de rate limit vazia: nenhuma fase morreu por limite de uso neste projeto.',
    colunasFila: ['ID', 'THREAD', 'FASE', 'ESTADO', 'LIBERA EM', 'ORIGEM DA HORA', 'FALTA', 'TENT'] as readonly string[],
    estados: { aguardando: 'aguardando', retomado: 'retomado', escalado: 'escalado', cancelado: 'cancelado' } as Record<string, string>,
    horaEstimada: (fonte: string) => `estimada (${fonte})`, horaRuntime: (fonte: string) => `dita pelo runtime (${fonte})`,
    retomadaVazia: 'Nenhum pedido da fila de rate limit com a janela liberada agora.',
    retomadaCabecalho: (id: string, thread: string, fase: string) => `${id}  thread ${thread}  fase ${fase}`,
    playbook: (v: string) => `  playbook    ${v}`, slug: (v: string) => `  slug        ${v}`,
    retomada: (sim: boolean, sessao: string | null) => `  retomada    ${sim ? `sim (sessao ${sessao})` : 'nao'}`,
    motivoRetomada: (v: string) => `  motivo      ${v}`, detalhe: (v: string) => `  detalhe     ${v}`,
    estado: (v: string) => `  estado      ${v}`,
  },
  // planejarRetry: a razao do plano (vai ao ledger)
  semReprovacao: 'nenhum gate reprovado no ledger desta thread',
  nadaARepetir: 'nao ha o que repetir: o ledger da thread nao tem reprovacao tipada pendente',
  limiteDeEscalacao: (tentativas: number, motivo: string, fase: string, limite: number) =>
    `${tentativas} tentativa(s) automatica(s) por ${motivo} em ${fase}, no limite de ${limite} ` +
    'do manifesto: escalacao tipada pausa qualquer modo, inclusive #Auto',
  comDelegacao: (porque: string, razao: string, delegado: string, evidencia: string) =>
    `${porque}; ${razao}; delegado ${delegado}; evidência ${evidencia}`,
  blocoPausa: (fases: string, pausaSobre: string, acao: string) => `o bloco ${fases} pausa neste modo ` +
    `(${pausaSobre}): a acao ${acao} espera autorizacao humana. O modo afrouxa a pausa, nunca a verificacao.`,
  silencioSemProva: 'runtime.silencio exige prova terminal atual da mesma sessao; ausencia ou silencio nao provam morte',
  // executarRetry: o detalhe da execucao (vai ao ledger)
  conduzidaAgora: (linha: string) => `${linha}; nada foi redespachado, a vez chega quando essa conducao terminar`,
  ninguemConduz: 'ninguem conduz a thread agora: o proximo pedido segue normalmente',
  naFila: (n: number, quando: string) => `${n} pedido(s) na fila duravel; o proximo libera em ${quando}`,
  filaVazia: 'nenhum pedido aguardando na fila para esta thread',
  sincronizada: (passos: string) => `worktree sincronizada com a base (${passos})`,
  sincronizacaoFalhou: (detalhe: string) => `sincronizacao nao concluiu: ${detalhe}`,
  checkPassou: 'o CHECK passou no HEAD real: nao ha correcao a dirigir',
  correcoesNaRodada: (n: number, rodada: number, veredito: string | null) =>
    `${n} correcao(oes) na rodada ${rodada}` + (veredito !== null ? `; CHECK-REVERIFY: ${veredito}` : ''),
  semDespachoFalho: (fase: string | null, thread: string) => `nao ha despacho falho registrado em ${fase} com prompt gravado: ` +
    `rode a fase de novo com \`ork phase run ${thread} ${fase} --prompt "..."\``,
  perfilPedidoRecusado: (id: string, runtime: string, motivo: string, detalhe: string) =>
    `perfil pedido "${id}" (${runtime}) preservado, mas indisponivel por ${motivo}: ${detalhe}. ` +
    'Nenhuma outra conta foi usada.',
  correcaoDoPerfilPedido: (id: string, runtime: string, motivo: string, thread: string) => {
    if (motivo === 'runtime.auth-missing') return `refaca o login de assinatura do perfil "${id}" no ${runtime}, rode ` +
      `\`ork accounts check ${id}\` e repita \`ork retry run ${thread}\``;
    if (motivo === 'runtime.quota-exhausted') return `aguarde o perfil "${id}" voltar a ativo em \`ork accounts list\` e ` +
      `repita \`ork retry run ${thread}\`; para autorizar outra conta, rode a fase novamente sem \`--perfil\``;
    if (motivo === 'runtime.profile-invalid') return `rode \`ork accounts list\` e restaure o perfil "${id}" no runtime ${runtime}, ` +
      'ou rode a fase novamente com um perfil valido ou sem `--perfil`';
    if (motivo === 'cost.violation') return `refaca o login de assinatura do perfil "${id}", rode ` +
      `\`ork accounts check ${id}\` e repita \`ork retry run ${thread}\`; perfil de provider pago nunca despacha`;
    return `confira o runtime ${runtime} e o perfil "${id}" com \`ork accounts check ${id}\`; depois repita ` +
      `\`ork retry run ${thread}\``;
  },
  semConfianca: (motivo: string, cwd: string, thread: string) => `${motivo}: o runtime ainda nao confia em ${cwd}; nada foi despachado. ` +
    `Rode \`cd ${cwd} && claude\`, aceite a confianca e repita \`ork retry run ${thread}\``,
  /** RM-063 (F3): a sessao viva na thread; redespachar abriria a segunda na mesma worktree. */
  sessaoAindaViva: (sessao: string, thread: string) => `a sessao ${sessao} ainda trabalha na thread no runtime; nada foi ` +
    `redespachado (uma segunda sessao na mesma worktree). Espere ela terminar, ou pare-a com \`ork sessions stop ${sessao}\`, ` +
    `e repita \`ork retry run ${thread}\``,
  runtimeSemProva: (detalhe: string, thread: string) => `o runtime nao respondeu (${detalhe}): sem a prova de que nenhuma ` +
    `sessao trabalha na thread, nada foi redespachado; repita \`ork retry run ${thread}\` quando ele responder`,
  semDespachoComPrompt: (motivo: string, fase: string) =>
    `nao ha despacho com prompt gravado para ${motivo} em ${fase}: rode a fase de novo com ork phase run`,
  rotacaoRecusada: (erro: string) => `rotacao recusada: ${erro}`,
  producaoParcialConta: (cota: boolean, evidencia: string) =>
    `producao parcial sob ${cota ? 'cota esgotada' : 'auth ausente'}: ${evidencia}; ` +
    'a sessao nao e redespachada sobre a worktree alterada e a fase nao conclui sem o humano',
  limiteDaRotacao: (tentativas: number, motivo: string, fase: string, limite: number) =>
    `${tentativas} tentativa(s) de rotacao por ${motivo} em ${fase}, no limite de ${limite} do manifesto: escalacao tipada pausa qualquer modo`,
  semLogin: 'nenhum perfil com login conferido em nenhum runtime da ordem de fallback: ' +
    'refaca o login com ork accounts add ou ork accounts check antes de retomar',
  entrariaNaFila: (quando: string) => `ensaio: entraria na fila duravel ate ${quando}`,
  pedidoAte: (id: string, quando: string) => `pedido ${id} na fila ate ${quando}`,
  trocaRecusada: (erro: string) => `troca de destino recusada: ${erro}`,
  producaoParcialModelo: (rotulo: string, evidencia: string) => `producao parcial com o modelo ${rotulo} inacessivel: ${evidencia}; ` +
    'a sessao nao e redespachada sobre a worktree alterada e a fase nao conclui sem o humano',
  padraoDoRuntime: '(padrao do runtime)',
  ensaioDoModelo: (runtime: string, perfil: string | null, modelo: string, detalhe: string) => `ensaio: o mesmo prompt iria a ${runtime}` +
    `${perfil ? ` (perfil ${perfil})` : ''} com o modelo ${modelo}; ${detalhe}`,
  limiteDaTroca: (tentativas: number, motivo: string, fase: string, limite: number) =>
    `${tentativas} tentativa(s) de troca por ${motivo} em ${fase}, no limite de ${limite} do manifesto: escalacao tipada pausa qualquer modo`,
  modeloSemDestino: (rotulo: string, tentados: string, correcao: string) =>
    `o modelo ${rotulo} nao esta acessivel em ${tentados} e o bloco nao tem outro destino: ${correcao}`,
  correcaoDoModelo: (modo: string, bloco: string) =>
    `ork setup ${modo} --bloco ${bloco} --model <modelo acessivel>, ou declare no mesmo bloco --fallback runtime:modelo`,
  // redespachar: o detalhe do redespacho (vai ao ledger)
  promptSumiu: (caminho: string) => `o prompt gravado sumiu do disco: ${caminho}`,
  promptMudou: (caminho: string, atual: string, original: string) => `o prompt em ${caminho} mudou desde o despacho original ` +
    `(sha256 ${atual} != ${original}): retomada e redespachar o MESMO texto`,
  jaConduz: (sessao: string, fase: string) => `a sessao ${sessao} ja conduz a fase ${fase} com este prompt: nada foi redespachado`,
  baselinePendente: (runtime: string) => `baseline.pendente: o bloco com GO no ${runtime} precisa da baseline antes da retomada`,
  runtimeIndisponivel: (erro: string) => `runtime.unavailable: ${erro}`,
  ensaioDoRedespacho: 'ensaio (--dry-run): comando montado, nada despachado',
  semSessionId: 'sem sessionId na saida do runtime',
  redespachada: (sessao: string, sha: string, perfil: string | null, runtime: string) =>
    `sessao ${sessao} despachada com o mesmo prompt sha256 ${sha}` + (perfil ? ` no perfil ${perfil} (${runtime})` : ''),
  /** RM-063 (F4): a escada de recuperacao do runtime. Vai ao ledger em pt-BR; a impressao remonta no locale. */
  escada: {
    degraus: { 'reerguer-daemon': 'reerguer o daemon do runtime', 'fallback-do-bloco': 'o fallback do bloco',
      'outro-perfil': 'outro perfil do runtime' } as Record<'reerguer-daemon' | 'fallback-do-bloco' | 'outro-perfil', string>,
    pulos: { 'sem-fallback': 'o bloco nao tem fallback de runtime',
      'adaptador-ausente': 'nenhum fallback tem adaptador instalado neste projeto',
      'fallback-sem-destino': 'nenhum alvo do fallback do bloco tem perfil disponivel',
      'sem-outro-perfil': 'o runtime nao tem outro perfil disponivel',
      'cota-sem-sinal-tipado': 'o runtime ainda nao tipa a cota esgotada e fica fora da troca automatica de conta' } as
      Record<'sem-fallback' | 'adaptador-ausente' | 'fallback-sem-destino' | 'sem-outro-perfil' | 'cota-sem-sinal-tipado', string>,
    resultados: { redespachada: 'redespachada', falhou: 'falhou', pulado: 'pulado', interrompido: 'interrompido' } as
      Record<'redespachada' | 'falhou' | 'pulado' | 'interrompido', string>,
    linhaDoDegrau: (n: number, tipo: string, resultado: string, motivo: string | null) =>
      `degrau ${n} (${tipo}): ${resultado}${motivo ? ` (${motivo})` : ''}`,
    noPlano: (n: number, tipo: string) => `  escada          degrau ${n} de 3, ${tipo}`,
    noPlanoEsgotada: '  escada          os 3 degraus acabaram neste episodio',
    esgotada: (resumo: string) => `a escada de recuperacao do runtime acabou sem sessao (${resumo}): ` +
      'escalacao tipada pausa qualquer modo, inclusive #Auto',
    correcao: (conferir: string, retomar: string) => `confira o runtime (${conferir}) e retome com o mesmo prompt: ${retomar}`,
    proximo: (n: number, tipo: string) => `o mesmo prompt sobe a escada de recuperacao no degrau ${n}: ${tipo}`,
    ensaio: (n: number, tipo: string, destino: string) => `ensaio: o degrau ${n} (${tipo}) mandaria o mesmo prompt a ${destino}`,
    ensaioPulado: (n: number, tipo: string, pulo: string) => `ensaio: o degrau ${n} (${tipo}) seria pulado: ${pulo}`,
    ensaioEsgotada: 'ensaio: nenhum degrau da escada tem destino agora; o dono seria chamado',
    lancou: (erro: string) => `runtime.unavailable: o adaptador lancou no redespacho: ${erro}`,
    semResposta: (vezes: number, detalhe: string) => `o runtime nao respondeu a prova de vida em ${vezes} tentativa(s) seguidas ` +
      `(${detalhe}), mesmo depois de reerguer o daemon: sem a prova, nada foi redespachado`,
  },
};

export const RETRY_EN: typeof RETRY_PT_BR = {
  politica: {
    'artifact.missing': {
      porque: 'the artifact the phase requires does not exist: the phase needs a directed spec of what to write, not a blind repeat of the same prompt',
      correcao: '`ork fix open <thread>` opens the round with the exact spec',
    },
    'claims.failed': {
      porque: 'the claim failed when rerun on the real HEAD: running the phase again the same way reproduces the same lie; what fixes it is a GO-FIX with the exact claim and command',
      correcao: '`ork fix open <thread>` and then `ork fix reverify <thread>`',
    },
    'claims.unverifiable': {
      porque: 'a claim without a verification command becomes a type A fix: attaching the command (or withdrawing the claim with a reason) is one line, not a whole GO',
      correcao: 'ork claims verificar <thread> <claim> --comando "<command>"',
    },
    'policy.violation': {
      porque: 'a policy with block severity fails in any mode: rerunning on its own would be the machine revoking the manifest policy',
      correcao: 'fix the violation in the request or the manifest; a block policy is not solved by repetition',
    },
    'runtime.autoconferencia': {
      porque: 'repeating the dispatch on the SAME runtime would give the same result: what is missing is not another attempt but a validator other than the one that executed. Picking the other runtime is a conduction decision, not a retry',
      correcao: 'dispatch CHECK on another runtime (`ork phase run <thread> CHECK --runtime <other>`), or drop the cross-validation requirement from the thread if it is not justified',
    },
    'runtime.profile-invalid': {
      porque: 'the owner asked for the profile (`--perfil`) and it does not exist in the store or belongs to another runtime: repeating the request would get the same refusal, and switching profiles on its own would disobey the request',
      correcao: '`ork accounts list` shows the profiles of each runtime; repeat the dispatch with a profile of the right runtime or without `--perfil`',
    },
    'cost.violation': {
      porque: 'a COST violation never gets an automatic retry: each rerun would spend again through the paid provider (subscription-only is a code rule, not a reminder)',
      correcao: 'remove from the environment the variable that redirects the dispatch and run the phase again by hand, with a human watching the spend',
    },
    'verify.regression': {
      porque: 'the command passed in the baseline and fails now: the defect belongs to this thread and has a known target, so it becomes a type B GO-FIX spec',
      correcao: '`ork fix open <thread>` (the next rerun is complete)',
    },
    'verify.failed': {
      porque: 'the command fails with no baseline to tell a regression from debt: the directed fix repairs it or records the baseline, but does not guess who is to blame',
      correcao: '`ork fix open <thread>`, or `ork verify <thread> --baseline` before the next GO',
    },
    'verify.timeout': {
      porque: 'the deadline ran out before the command finished: the proof did not reach the end, and machine load is not a defect. The rerun is complete, and the manifest escalation limit keeps it from repeating forever',
      correcao: '`ork verify <thread>` again; if it always times out, raise `verify.timeout_ms` in the manifest or split the command',
    },
    'verify.sem-veredito': {
      porque: 'a command never ran or the product changed during the run: there is no verdict on it, and the right proof is to run again, in full',
      correcao: '`ork verify <thread>` again, without editing the worktree during the run',
    },
    'ci.failed': {
      porque: 'the receipt belongs to the provider and to the candidate SHA: repeating a phase neither creates nor legitimately changes that result',
      correcao: 'publish the candidate, wait for the required check and run SHIP again; if it failed, fix the cause recorded on the runner',
    },
    'runtime.unavailable': {
      porque: 'an infrastructure failure in the dispatch is not a content failure: the SAME prompt, with the same sha256, climbs the ' +
        'recovery ladder (bring the runtime daemon back up, the block fallback, another profile) without changing a comma, and only ' +
        'after it is the owner called',
      correcao: '`ork retry run <thread>` climbs the ladder with the prompt already on disk',
    },
    'runtime.silencio': {
      porque: 'phase with no heartbeat: resume the original dispatch with the hash checked and an attempt limit',
      correcao: 'ork retry run <thread> --motivo runtime.silencio',
    },
    'runtime.rate-limited': {
      porque: 'the usage limit has a TIME to come back: the phase enters the durable queue and resumes in the next window, with no human in the middle and no spending outside the subscription',
      correcao: '`ork retry list` shows the queue; `ork retry resume` resumes what is already released',
    },
    'runtime.quota-exhausted': {
      porque: 'the ACCOUNT quota or credits ran out, not the infrastructure: the profile leaves the rotation until the deadline; the original prompt after an empty interval, or a checkpoint of partial production, goes on to the next profile, the fallback runtime or the queue until the earliest deadline',
      correcao: '`ork accounts list` shows the exhausted profile; `ork retry run <thread>` rotates the prompt already written',
    },
    'runtime.auth-missing': {
      porque: 'the runtime account lost its authentication: the profile gets no dispatch until the login is redone through the CLI itself, and the SAME prompt goes on to the next profile or the fallback runtime',
      correcao: '`ork accounts check` checks the login of each profile; `ork retry run <thread>` rotates the prompt already written',
    },
    'runtime.model-unavailable': {
      porque: 'the requested model does not exist or the account has no access to it: the SAME prompt, with the same sha256, goes on to the next profile of the same runtime with the same model and then to the block fallback, never again to the pair that already refused',
      correcao: '`ork retry run <thread>` switches the target; with no target, `ork setup <mode> --bloco N --model <available model>` or `--fallback runtime:model`',
    },
    'runtime.workspace-untrusted': {
      porque: 'the runtime refused the worktree directory before running anything: once the owner accepts trust in the terminal, the SAME prompt, with the same sha256, goes back to the same phase; while the trust is not in the account .claude.json, nothing is dispatched',
      correcao: 'the owner runs the pause command (`cd <worktree> && claude`, accepting the trust); `ork retry run <thread>` re-dispatches the prompt already on disk',
    },
    'runtime.consent-pending': {
      porque: 'the runtime waits for the owner to accept new terms before running anything: after the acceptance, the SAME prompt, with the same sha256, goes back to the same phase; if the runtime refuses again, the same owner pause comes back',
      correcao: 'the owner opens the runtime CLI and accepts the terms; `ork retry run <thread>` re-dispatches the prompt already on disk',
    },
    'tree.blocked': {
      porque: 'the target tree moved under the thread: rebasing the worktree onto the base is the step that unblocks it, and rerunning before that only repeats the conflict',
      correcao: '`ork worktree sync <thread>`, and only then repeat the step',
    },
    'lease.resume-unavailable': {
      porque: 'without a safe inode, the forced removal requires checking ownership before resuming',
      correcao: '`ork lease release <name> --forcar`; then repeat the acquisition',
    },
    'lease.busy': {
      porque: 'the lease belongs to another thread and will be released: the queue already serializes, so the action is to try again when the turn comes, never to jump the queue',
      correcao: '`ork lease list` shows the queue; the turn comes with nobody forcing it',
    },
    'conducao.em-andamento': {
      porque: 'another conduction runs on the same worktree now: the turn comes when it finishes, and jumping the queue is the 2026-09-19 incident',
      correcao: '`ork conducao status <thread>` shows who conducts; repeat the request with `--esperar <min>` to go on by itself when it frees up',
    },
    'hitl.formato': {
      porque: 'the HITL request came out of the required format: the issuer made the mistake, and the fix is to issue it again with labeled alternatives, a consequence per alternative and exactly one recommended, with the reason',
      correcao: '`ork fix open <thread>` opens the round with the exact format spec',
    },
    'human.pending': {
      porque: 'this is not a real failure but a wait for authorization: automating the wait would be the machine authorizing itself',
      correcao: 'ork gate request <thread>',
    },
  },
  usoPlanRun: (sub) => `usage: ork retry ${sub} <thread-id> [--motivo M] [--fase F]`,
  titulo: (thread) => `Retry plan for thread ${thread}`,
  modo: (modo) => `  mode            ${modo}`,
  fase: (fase) => `  phase           ${fase ?? '(none)'}`,
  motivo: (motivo) => `  typed reason    ${motivo ?? '(no pending failure)'}`,
  detalhe: (detalhe) => `  detail          ${detalhe}`,
  acao: (acao) => `  action          ${acao}`,
  tentativas: (feitas, limite) => `  attempts        ${feitas} of ${limite} before escalation`,
  esforco: (effort, anterior) => `  effort          ${effort}${anterior !== null ? ` (escalated from ${anterior})` : ''}`,
  automatica: (sim) => `  automatic       ${sim ? 'yes' : 'no'}`,
  bloqueio: (bloqueio) => `  blocked by      ${bloqueio}`,
  razao: (razao) => `  reason          ${razao}`,
  correcao: (correcao) => `  fix             ${correcao}`,
  execucao: (executada) => `Run: ${executada ? 'action taken' : 'nothing run'}`,
  linhaDoDetalhe: (detalhe) => `  ${detalhe}`,
  rodada: (rodada, correcoes) => `GO-FIX round ${rodada}: ${correcoes}`,
  correcaoDaRodada: (id, tipo, origem) => `${id} (type ${tipo}, ${origem})`,
  reverify: (veredito, cobertura) => `CHECK-REVERIFY: ${veredito} (coverage ${cobertura})`,
  vereditos: { 'PASSOU': 'PASSED', 'PRECISA DE MUDANCA': 'NEEDS CHANGES', 'BLOQUEADO': 'BLOCKED' },
  coberturas: { completa: 'full', parcial: 'partial' },
  fila: 'Rate limit queue for this thread:',
  pedidoNaFila: (id, fase, quando, estimada) => `  ${id}  ${fase}  released at ${quando}${estimada ? ' (estimated window)' : ''}`,
  complementar: {
    politicaTitulo: 'Retry policy by typed gate reason (block B3)',
    colunasPolitica: ['TYPED REASON', 'RETRY ACTION', 'AUTOMATIC', 'WHY'],
    sim: 'yes', nao: 'no',
    politicaFecho: [
      'The policy is the SAME in every mode: the mode loosens pauses, never',
      'verification. cost.violation never gets an automatic retry, and the',
      'escalation limit (retry.max_tentativas) pauses every mode, including #Auto.',
    ],
    motivoDesconhecido: (reason) => `unknown typed reason: ${reason}`,
    conhecidos: (list) => `  known: ${list}`,
    motivo: (value) => `typed reason: ${value}`,
    significado: (value) => `  meaning      ${value}`,
    acao: (value) => `  action       ${value}`,
    automatica: (value) => `  automatic    ${value}`,
    porque: (value) => `  why          ${value}`,
    correcao: (value) => `  fix          ${value}`,
    usoParse: 'usage: ork retry parse --stderr "<adapter stderr text>"',
    semSinal: 'No rate-limit signal was recognized in this text.',
    sinal: 'Rate-limit signal recognized in runtime stderr:',
    fonte: (value) => `  time source   ${value}`,
    reset: (value) => `  reset at      ${value}`,
    semHora: '(the runtime did not provide a time)',
    trecho: (value) => `  excerpt       ${value}`,
    estimada: [
      '  With no time in the text, the queue uses retry.janela_padrao_min from the manifest',
      '  and marks the request as an ESTIMATED window. `ork` does not invent a reset time.',
    ],
    proxima: (when, remaining) => `Next window: ${when} (${remaining}).`,
    retome: 'Resume with: ork retry resume',
    usoCancel: 'usage: ork retry cancel <id> --motivo "<reason>"',
    cancelado: (id) => `Request ${id} cancelled in the rate-limit queue.`,
    thread: (value) => `  thread   ${value}`, fase: (value) => `  phase    ${value}`,
    motivoLinha: (value) => `  reason   ${value}`,
    desconhecido: (sub) => `unknown subcommand: retry ${sub}`,
    filaVazia: 'Rate-limit queue is empty: no phase died from a usage limit in this project.',
    colunasFila: ['ID', 'THREAD', 'PHASE', 'STATE', 'RELEASES AT', 'TIME SOURCE', 'LEFT', 'TRY'],
    estados: { aguardando: 'waiting', retomado: 'resumed', escalado: 'escalated', cancelado: 'cancelled' },
    horaEstimada: (source) => `estimated (${source})`, horaRuntime: (source) => `reported by runtime (${source})`,
    retomadaVazia: 'No rate-limit queue request has a released window now.',
    retomadaCabecalho: (id, thread, phase) => `${id}  thread ${thread}  phase ${phase}`,
    playbook: (v) => `  playbook    ${v}`, slug: (v) => `  slug        ${v}`,
    retomada: (yes, session) => `  resumed     ${yes ? `yes (session ${session})` : 'no'}`,
    motivoRetomada: (v) => `  reason      ${v}`, detalhe: (v) => `  detail      ${v}`,
    estado: (v) => `  state       ${v}`,
  },
  semReprovacao: 'no failed gate in the ledger of this thread',
  nadaARepetir: 'nothing to repeat: the thread ledger has no pending typed failure',
  limiteDeEscalacao: (tentativas, motivo, fase, limite) =>
    `${tentativas} automatic attempt(s) for ${motivo} in ${fase}, at the manifest limit of ${limite}: ` +
    'a typed escalation pauses any mode, including #Auto',
  comDelegacao: (porque, razao, delegado, evidencia) => `${porque}; ${razao}; delegate ${delegado}; evidence ${evidencia}`,
  blocoPausa: (fases, pausaSobre, acao) => `the ${fases} block pauses in this mode ` +
    `(${pausaSobre}): action ${acao} waits for human authorization. The mode loosens the pause, never the verification.`,
  silencioSemProva: 'runtime.silencio needs current terminal proof from the same session; absence or silence does not prove death',
  conduzidaAgora: (linha) => `${linha}; nothing was dispatched again, the turn comes when that conduction ends`,
  ninguemConduz: 'nobody conducts the thread now: the next request goes on normally',
  naFila: (n, quando) => `${n} request(s) in the durable queue; the next one is released at ${quando}`,
  filaVazia: 'no request waiting in the queue for this thread',
  sincronizada: (passos) => `worktree synced with the base (${passos})`,
  sincronizacaoFalhou: (detalhe) => `sync did not finish: ${detalhe}`,
  checkPassou: 'CHECK passed on the real HEAD: there is no fix to direct',
  correcoesNaRodada: (n, rodada, veredito) => `${n} fix(es) in round ${rodada}` + (veredito !== null ? `; CHECK-REVERIFY: ${veredito}` : ''),
  semDespachoFalho: (fase, thread) => `no failed dispatch with a written prompt is recorded in ${fase}: ` +
    `run the phase again with \`ork phase run ${thread} ${fase} --prompt "..."\``,
  perfilPedidoRecusado: (id, runtime, motivo, detalhe) =>
    `requested profile "${id}" (${runtime}) was preserved but is unavailable because of ${motivo}: ${detalhe}. ` +
    'No other account was used.',
  correcaoDoPerfilPedido: (id, runtime, motivo, thread) => {
    if (motivo === 'runtime.auth-missing') return `sign profile "${id}" back in to its ${runtime} subscription, run ` +
      `\`ork accounts check ${id}\`, and repeat \`ork retry run ${thread}\``;
    if (motivo === 'runtime.quota-exhausted') return `wait until profile "${id}" is active again in \`ork accounts list\`, then ` +
      `repeat \`ork retry run ${thread}\`; to authorize another account, run the phase again without \`--perfil\``;
    if (motivo === 'runtime.profile-invalid') return `run \`ork accounts list\` and restore profile "${id}" under runtime ${runtime}, ` +
      'or run the phase again with a valid profile or without `--perfil`';
    if (motivo === 'cost.violation') return `sign profile "${id}" back in through the subscription, run ` +
      `\`ork accounts check ${id}\`, and repeat \`ork retry run ${thread}\`; a paid-provider profile is never dispatched`;
    return `check runtime ${runtime} and profile "${id}" with \`ork accounts check ${id}\`; then repeat ` +
      `\`ork retry run ${thread}\``;
  },
  semConfianca: (motivo, cwd, thread) => `${motivo}: the runtime does not trust ${cwd} yet; nothing was dispatched. ` +
    `Run \`cd ${cwd} && claude\`, accept the trust and repeat \`ork retry run ${thread}\``,
  sessaoAindaViva: (sessao, thread) => `session ${sessao} is still working on the thread in the runtime; nothing was ` +
    `redispatched (a second session on the same worktree). Wait for it to end, or stop it with \`ork sessions stop ${sessao}\`, ` +
    `and repeat \`ork retry run ${thread}\``,
  runtimeSemProva: (detalhe, thread) => `the runtime did not respond (${detalhe}): with no proof that no session works on the ` +
    `thread, nothing was redispatched; repeat \`ork retry run ${thread}\` when it responds`,
  semDespachoComPrompt: (motivo, fase) => `no dispatch with a written prompt for ${motivo} in ${fase}: run the phase again with \`ork phase run\``,
  rotacaoRecusada: (erro) => `rotation refused: ${erro}`,
  producaoParcialConta: (cota, evidencia) => `partial production under ${cota ? 'an exhausted quota' : 'missing auth'}: ${evidencia}; ` +
    'the session is not dispatched again over the changed worktree, and the phase does not finish without the human',
  limiteDaRotacao: (tentativas, motivo, fase, limite) =>
    `${tentativas} rotation attempt(s) for ${motivo} in ${fase}, at the manifest limit of ${limite}: a typed escalation pauses any mode`,
  semLogin: 'no profile with a checked login in any runtime of the fallback order: ' +
    'redo the login with `ork accounts add` or `ork accounts check` before resuming',
  entrariaNaFila: (quando) => `dry run: would enter the durable queue until ${quando}`,
  pedidoAte: (id, quando) => `request ${id} in the queue until ${quando}`,
  trocaRecusada: (erro) => `target switch refused: ${erro}`,
  producaoParcialModelo: (rotulo, evidencia) => `partial production with model ${rotulo} unavailable: ${evidencia}; ` +
    'the session is not dispatched again over the changed worktree, and the phase does not finish without the human',
  padraoDoRuntime: '(runtime default)',
  ensaioDoModelo: (runtime, perfil, modelo, detalhe) => `dry run: the same prompt would go to ${runtime}` +
    `${perfil ? ` (profile ${perfil})` : ''} with model ${modelo}; ${detalhe}`,
  limiteDaTroca: (tentativas, motivo, fase, limite) =>
    `${tentativas} switch attempt(s) for ${motivo} in ${fase}, at the manifest limit of ${limite}: a typed escalation pauses any mode`,
  modeloSemDestino: (rotulo, tentados, correcao) => `model ${rotulo} is not available on ${tentados} and the block has no other target: ${correcao}`,
  correcaoDoModelo: (modo, bloco) =>
    `\`ork setup ${modo} --bloco ${bloco} --model <available model>\`, or declare \`--fallback runtime:model\` in the same block`,
  promptSumiu: (caminho) => `the written prompt is gone from disk: ${caminho}`,
  promptMudou: (caminho, atual, original) => `the prompt at ${caminho} changed since the original dispatch ` +
    `(sha256 ${atual} != ${original}): resuming means dispatching the SAME text again`,
  jaConduz: (sessao, fase) => `session ${sessao} already conducts phase ${fase} with this prompt: nothing was dispatched again`,
  baselinePendente: (runtime) => `baseline.pendente: the block with GO on ${runtime} needs the baseline before resuming`,
  runtimeIndisponivel: (erro) => `runtime.unavailable: ${erro}`,
  ensaioDoRedespacho: 'dry run (--dry-run): command built, nothing dispatched',
  semSessionId: 'no sessionId in the runtime output',
  redespachada: (sessao, sha, perfil, runtime) =>
    `session ${sessao} dispatched with the same prompt sha256 ${sha}` + (perfil ? ` on profile ${perfil} (${runtime})` : ''),
  escada: {
    degraus: { 'reerguer-daemon': 'bring the runtime daemon back up', 'fallback-do-bloco': 'the block fallback',
      'outro-perfil': 'another runtime profile' },
    pulos: { 'sem-fallback': 'the block has no runtime fallback', 'adaptador-ausente': 'no fallback has an adapter installed in this project',
      'fallback-sem-destino': 'no target of the block fallback has an available profile',
      'sem-outro-perfil': 'the runtime has no other available profile',
      'cota-sem-sinal-tipado': 'the runtime does not type the exhausted quota yet and stays out of the automatic account switch' },
    resultados: { redespachada: 'dispatched again', falhou: 'failed', pulado: 'skipped', interrompido: 'interrupted' },
    linhaDoDegrau: (n, tipo, resultado, motivo) => `step ${n} (${tipo}): ${resultado}${motivo ? ` (${motivo})` : ''}`,
    noPlano: (n, tipo) => `  ladder          step ${n} of 3, ${tipo}`,
    noPlanoEsgotada: '  ladder          the 3 steps are spent in this episode',
    esgotada: (resumo) => `the runtime recovery ladder ended with no session (${resumo}): ` +
      'a typed escalation pauses any mode, #Auto included',
    correcao: (conferir, retomar) => `check the runtime (${conferir}) and resume with the same prompt: ${retomar}`,
    proximo: (n, tipo) => `the same prompt climbs the recovery ladder at step ${n}: ${tipo}`,
    ensaio: (n, tipo, destino) => `dry run: step ${n} (${tipo}) would send the same prompt to ${destino}`,
    ensaioPulado: (n, tipo, pulo) => `dry run: step ${n} (${tipo}) would be skipped: ${pulo}`,
    ensaioEsgotada: 'dry run: no step of the ladder has a target now; the owner would be called',
    lancou: (erro) => `runtime.unavailable: the adapter threw in the redispatch: ${erro}`,
    semResposta: (vezes, detalhe) => `the runtime did not answer the liveness proof in ${vezes} attempt(s) in a row ` +
      `(${detalhe}), even after bringing the daemon back up: without the proof, nothing was redispatched`,
  },
};

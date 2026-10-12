/**
 * RM-061, fatia F3a: a familia `gerados` do catalogo, o texto dos arquivos que o CLI escreve para pessoas e
 * agentes lerem: os comentarios do `orkastery.yaml` e o bloco do `AGENTS.md` que o `ork init` gera, e o bloco da
 * experiencia que o `ork adapter install` escreve. O pt-BR e a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * A lingua de um arquivo gerado e a do dono no momento da geracao (D1 da thread ork-rm061f3a): o gerador recebe
 * o locale por parametro, com pt-BR por omissao, e so a entrada do CLI passa a lingua do dono (D2). So o texto
 * para pessoas mora aqui (D3): as chaves, os valores e os exemplos comentados do YAML ficam no esqueleto de
 * `init.ts`, um so para as duas linguas, e os marcadores dos blocos ficam nos modulos donos. Cada comentario do
 * YAML e uma ou mais linhas de texto, sem o `#` e sem o recuo, que o esqueleto acrescenta. O valor de exemplo
 * de `owner.language` (comentado) mostra a lingua do proprio arquivo: quem o descomenta fica na lingua em que leu.
 */

export const GERADOS_PT_BR = {
  /** Os comentarios do `orkastery.yaml` (`manifestoYaml`, em `init.ts`). */
  manifesto: {
    cabecalho: 'Manifesto do Orkastery (v1, bloco B0)\nGerado por `ork init`. Fonte unica da configuracao do projeto.\n' +
      'Limite duro de 16 KB: prosa longa vai para a memoria com tag, nao para este arquivo.',
    abbrev: 'abbrev: ate 3 caracteres [a-z0-9], parte 1 do slug de sessao, unica no workspace',
    fuso: 'fuso do dono (nome IANA): todo horario mostrado a pessoas usa este fuso.\nAusente: fuso do sistema. Exemplo:',
    preferencias: (comando: string) => `Preferências: ${comando}`,
    exemploDeIdioma: 'pt-BR',
    idiomaAusente: 'ausente: locale do sistema',
    experienciaFalse: 'false desativa o pacote na próxima instalação do adaptador',
    runtimes: 'Runtimes homologados:\n  claude-bg (padrao, mais maduro): despacha `claude --bg`, sessao visivel no app\n' +
      '            e em `claude agents --json`\n  codex: despacha `codex exec` headless na sessao autenticada do Codex CLI,\n' +
      '         verificado no rollout de $CODEX_HOME/sessions (requer `codex login`)',
    providerPolicy: 'subscription-only: proibido despachar por provider pago (cobra por token, fora da assinatura)',
    sandbox: 'sandbox do runtime codex: read-only | workspace-write | danger-full-access\n' +
      '(danger-full-access SO onde o bubblewrap nao roda; `ork doctor` tem a sonda)',
    modoPadrao: 'modo usado quando o pedido do builder nao traz #TAG',
    porThread: 'true: o ork thread new cria a worktree e a branch da thread sem flag (--sem-worktree cria sem);\n' +
      'false ou ausente: só com --worktree auto',
    naoDetectado: 'nao detectado',
    ci: 'Ative depois de publicar o workflow e tornar ork-verify um check obrigatório.',
    ciComando: 'perfil hermético opcional do runner; sem ele, usa verify acima',
    staleAfter: 'thread despachada sem atividade (ledger parado, sessao nao-working) por mais que\n' +
      'isto NAO ocupa vaga do escalonador: a vaga volta para quem esta pronto para rodar',
    handoff: 'gate de tokens (bloco B1): rotaciona a sessao acima destas ocupacoes de janela',
    retry: 'autonomia do bloco B3: retry tipado por motivo de gate e fila duravel de rate limit\n' +
      'max_tentativas e o LIMITE DE ESCALACAO: estourado, pausa qualquer modo, ate #Auto',
    janelaPadrao: 'janela usada so quando o runtime diz "rate limit" e NAO diz a hora do reset\n' +
      '(fica marcada como estimativa na fila; o ork nunca inventa horario medido)',
    memoriaModo: 'files = fallback honesto sem OrkMind (handoff por arquivos, ponteiro path#ancora)\n' +
      'orkmind = camada semantica do bloco B6 por cima, com degradacao honesta para files',
    databaseUrl: 'NOME da variavel de ambiente com a DSN da base PROPRIA deste tenant, nunca a DSN.\n' +
      'Vazio = o regime orkmind nao liga (o ork nao adivinha base: base alheia e pior que\n' +
      'base nenhuma, precedente do incidente memory-orkmind).',
    embedding: 'busca por significado (ork memory search --texto): sem o bloco, provider none (desligada).\n' +
      'api_key_env recebe o NOME da variavel com a chave dedicada, nunca o valor.',
    modeloOffline: 'modelo local offline, ex.: intfloat/multilingual-e5-small',
    audit: 'governanca de custo dos auditores periodicos (bloco B5)\n' +
      'janela ociosa da assinatura: fora dela a rodada so anda com --agora <quem>',
  },
  /** O bloco do `AGENTS.md` (`blocoAgentsMd`, em `agents-md.ts`), entre os marcadores do `ork init`. */
  agents: {
    projeto: (nome: string, abbrev: string, branch: string) => `Projeto: **${nome}** (${abbrev}). Branch base: \`${branch}\`.`,
    comece: 'Comece com `ork doctor`, `ork onboarding` e `ork thread status <thread>`.',
    ciclo: 'Conduza o ciclo GOAL → PLAN → GO → CHECK → SHIP → MASTER pelo `ork`.',
    modo: (modos: string) => `Respeite o modo da thread: ${modos}.`,
    worktree: 'Edite produto somente na worktree vinculada; estado em `.orkastery/` pertence ao núcleo.',
    fases: 'PLAN não implementa. GO usa commits atômicos. CHECK não corrige. SHIP acontece por `ork ship`.',
    claims: 'Toda alegação exige claim e comando reproduzível; self-report não é evidência.',
    master: 'MASTER por omissão só da sua thread: `ork master <thread> --aceitar-omissao`; sem a thread, fecha também as ' +
      'entregas de outras frentes.',
    verificacoes: 'Verificações do manifesto:',
    rodape: 'Este bloco é mantido por `ork init`. Edite livremente o restante do arquivo.',
    /** O `ork init` recusa o `AGENTS.md` com marcadores repetidos ou fora de ordem, sem escrever. */
    marcadoresAmbiguos: 'AGENTS.md possui marcadores Orkastery ambiguos; corrija o bloco antes de rodar ork init',
  },
  /**
   * O bloco da experiencia que `ork adapter install` poe no `CLAUDE.md` (no `AGENTS.md`, para o Codex), entre os
   * marcadores de `experiencia-instalacao.ts`. O diretorio das skills entra como JSON; sem recibo, o bloco e
   * reconhecido pelo texto antes e depois dele, em qualquer das duas linguas (D8).
   */
  experiencia: {
    titulo: 'Experiência de orquestração',
    consulte: 'Consulte `ork experiencia show --json` neste projeto. Se experience for false, não ative o pacote.',
    diretorio: (diretorio: string) => `Se ativo, leia a skill selecionada pelo campo skill no diretório ${diretorio}.`,
    preferencias: 'As preferências são dados do núcleo; preserve gates, proveniência humana e permissões do host.',
  },
};

export const GERADOS_EN: typeof GERADOS_PT_BR = {
  manifesto: {
    cabecalho: 'Orkastery manifest (v1, block B0)\nGenerated by `ork init`. The single source of the project configuration.\n' +
      'Hard limit of 16 KB: long prose goes to tagged memory, not to this file.',
    abbrev: 'abbrev: up to 3 characters [a-z0-9], part 1 of the session slug, unique in the workspace',
    fuso: 'owner\'s time zone (IANA name): every time shown to people uses this zone.\nAbsent: the system time zone. Example:',
    preferencias: (comando) => `Preferences: ${comando}`,
    exemploDeIdioma: 'en-US',
    idiomaAusente: 'absent: the system locale',
    experienciaFalse: 'false turns the package off at the next adapter install',
    runtimes: 'Supported runtimes:\n  claude-bg (default, most mature): dispatches `claude --bg`, session visible in the app\n' +
      '            and in `claude agents --json`\n  codex: dispatches `codex exec` headless in the signed-in Codex CLI session,\n' +
      '         verified in the rollout under $CODEX_HOME/sessions (requires `codex login`)',
    providerPolicy: 'subscription-only: never dispatch through a paid provider (billed per token, outside the subscription)',
    sandbox: 'sandbox of the codex runtime: read-only | workspace-write | danger-full-access\n' +
      '(danger-full-access ONLY where bubblewrap does not run; `ork doctor` has the probe)',
    modoPadrao: 'mode used when the builder\'s request has no #TAG',
    porThread: 'true: ork thread new creates the thread worktree and branch without a flag (--sem-worktree skips them);\n' +
      'false or absent: only with --worktree auto',
    naoDetectado: 'not detected',
    ci: 'Turn it on after you publish the workflow and make ork-verify a required check.',
    ciComando: 'optional hermetic profile of the runner; without it, the verify commands above run',
    staleAfter: 'a dispatched thread with no activity (idle ledger, session not working) for longer than\n' +
      'this does NOT hold a scheduler slot: the slot goes back to whoever is ready to run',
    handoff: 'token gate (block B1): rotates the session above these fractions of the context window',
    retry: 'block B3 autonomy: typed retry per gate reason and a durable rate limit queue\n' +
      'max_tentativas is the ESCALATION LIMIT: once exceeded, it pauses any mode, even #Auto',
    janelaPadrao: 'window used only when the runtime says "rate limit" and does NOT say when it resets\n' +
      '(marked as an estimate in the queue; ork never makes up a measured time)',
    memoriaModo: 'files = honest fallback without OrkMind (handoff through files, path#anchor pointer)\n' +
      'orkmind = semantic layer of block B6 on top, degrading honestly to files',
    databaseUrl: 'NAME of the environment variable with the DSN of this tenant\'s OWN database, never the DSN.\n' +
      'Empty = the orkmind mode stays off (ork does not guess a database: someone else\'s database is\n' +
      'worse than none, the precedent of the memory-orkmind incident).',
    embedding: 'search by meaning (ork memory search --texto): without this block, provider none (off).\n' +
      'api_key_env takes the NAME of the variable with the dedicated key, never the value.',
    modeloOffline: 'local offline model, e.g. intfloat/multilingual-e5-small',
    audit: 'cost governance of the periodic auditors (block B5)\n' +
      'idle window of the subscription: outside it, a round only runs with --agora <who>',
  },
  agents: {
    projeto: (nome, abbrev, branch) => `Project: **${nome}** (${abbrev}). Base branch: \`${branch}\`.`,
    comece: 'Start with `ork doctor`, `ork onboarding` and `ork thread status <thread>`.',
    ciclo: 'Run the GOAL → PLAN → GO → CHECK → SHIP → MASTER cycle through `ork`.',
    modo: (modos) => `Respect the thread mode: ${modos}.`,
    worktree: 'Edit product code only in the linked worktree; the state in `.orkastery/` belongs to the core.',
    fases: 'PLAN does not implement. GO makes atomic commits. CHECK does not fix. SHIP happens through `ork ship`.',
    claims: 'Every statement needs a claim and a reproducible command; self-report is not evidence.',
    master: 'Accept MASTER by default only for your own thread: `ork master <thread> --aceitar-omissao`; without the ' +
      'thread, it also closes deliveries from other fronts.',
    verificacoes: 'Manifest verify commands:',
    rodape: 'This block is maintained by `ork init`. Edit the rest of the file freely.',
    marcadoresAmbiguos: 'AGENTS.md has ambiguous Orkastery markers; fix the block before you run `ork init`.',
  },
  experiencia: {
    titulo: 'Orchestration experience',
    consulte: 'Run `ork experiencia show --json` in this project. If `experience` is false, do not activate the package.',
    diretorio: (diretorio) => `If active, read the skill selected by the \`skill\` field in the directory ${diretorio}.`,
    preferencias: 'Preferences are core data; preserve gates, human provenance and host permissions.',
  },
};

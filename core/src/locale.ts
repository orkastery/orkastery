/**
 * Prova de conceito do CLI por locale (EN1, EN6 e EN7 do recibo RM-049 em ingles).
 *
 * Um catalogo de mensagens por locale, sem dependencia nova: pt-BR e o padrao e a fonte; `en` e a
 * alternativa. O catalogo ingles e tipado pelo portugues (`typeof PT_BR`), entao chave faltando ou
 * assinatura diferente nao compila.
 *
 * Quem decide o locale, nesta ordem:
 *   1. `owner.language` do manifesto, a escolha do onboarding (etapa maestro);
 *   2. `LC_ALL`, `LC_MESSAGES` e `LANG`, a primeira nao vazia (a ordem do POSIX);
 *   3. pt-BR.
 * So `en*` vira ingles; qualquer outra lingua (es, fr, C, POSIX) fica no pt-BR, a lingua do CLI.
 *
 * O locale so vale nos comandos que o CLI ativa por `ativarLocale` (nesta prova, `doctor` e
 * `init`, no texto; o `--json` e contrato e nao passa por aqui). Sem ativacao, tudo segue pt-BR:
 * nenhum outro comando muda de lingua pela metade.
 */

export type Locale = 'pt-BR' | 'en';
export const LOCALE_PADRAO: Locale = 'pt-BR';
/** Comandos cujo texto ja sai pelo catalogo; os demais seguem em pt-BR. */
export const COMANDOS_COM_LOCALE: readonly string[] = ['doctor', 'init'];

/** `en_US.UTF-8`, `en-GB`, `en` viram `en`; `pt_BR.UTF-8`, `pt` viram pt-BR; o resto, undefined. */
export function localeDe(valor: unknown): Locale | undefined {
  if (typeof valor !== 'string') return undefined;
  const lingua = valor.trim().split(/[.@]/)[0].replace(/_/g, '-').split('-')[0].toLowerCase();
  if (lingua === 'en') return 'en';
  if (lingua === 'pt') return 'pt-BR';
  return undefined;
}

export interface FonteDoLocale { locale: Locale; origem: 'manifesto' | 'LC_ALL' | 'LC_MESSAGES' | 'LANG' | 'padrao' }

/** O locale do processo: a escolha do onboarding vence o ambiente; sem nenhum, pt-BR. */
export function resolverLocale(ownerLanguage?: unknown, env: NodeJS.ProcessEnv = process.env): FonteDoLocale {
  if (typeof ownerLanguage === 'string' && ownerLanguage.trim()) {
    return { locale: localeDe(ownerLanguage) ?? LOCALE_PADRAO, origem: 'manifesto' };
  }
  for (const nome of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const v = env[nome];
    if (v && v.trim()) return { locale: localeDe(v) ?? LOCALE_PADRAO, origem: nome };
  }
  return { locale: LOCALE_PADRAO, origem: 'padrao' };
}

let ativo: Locale = LOCALE_PADRAO;

/** Fixa o locale do processo (o CLI, nos comandos de `COMANDOS_COM_LOCALE`; os testes). */
export function ativarLocale(locale: Locale | undefined): void {
  ativo = locale ?? LOCALE_PADRAO;
}

export function localeAtivo(): Locale {
  return ativo;
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

const PT_BR = {
  horario: {
    brasilia: 'horário de Brasília',
    legendaBrasilia: 'Horários de Brasília.',
    legenda: (rotulo: string) => `Horários em ${rotulo}.`,
  },
  doctor: {
    titulo: 'ork doctor: o que vale nesta maquina agora',
    correcao: 'correcao',
    bloqueado: (falhas: number, avisos: number) =>
      `Veredito: BLOQUEADO (${falhas} fail, ${avisos} warn). Corrija os itens acima antes de despachar fase.`,
    pronto: (avisos: number) => `Veredito: PRONTO (${avisos} warn). Despacho de fase liberado por \`ork phase run\`.`,
    /** Nome de cada check como aparece no texto; o `Check.nome` gravado nao muda. */
    nomes: {} as Record<string, string>,
    instaleNode: 'instale Node 20 ou superior',
    gitAusente: 'nao encontrado no PATH',
    instaleGit: 'instale o git',
    branch: (branch: string, semCommit: boolean) => `branch ${branch}${semCommit ? ' (sem commit)' : ''}`,
    foraDeRepo: 'fora de um repositorio git',
    rodeDentroDeRepo: 'rode o ork dentro de um repositorio git',
    versaoDesconhecida: 'versao desconhecida',
    codexAusenteUsado: 'binario `codex` fora do PATH (o projeto despacha por ele: veja despacho pelo codex)',
    codexAusenteOpcional: 'binario `codex` fora do PATH (opcional: claude-bg e o runtime padrao)',
    instaleCodex: 'para despachar pelo codex, instale o Codex CLI e autentique com `codex login`',
    sandboxOk: '`codex sandbox true` executa nesta maquina',
    sandboxFalhou: (detalhe: string) => `sonda \`codex sandbox true\` falhou: ${detalhe}`,
    sandboxCorrecao: 'instale o pacote bubblewrap do sistema (o bwrap embutido nao cria user namespace ' +
      'nesta maquina) ou declare runtime.sandbox: danger-full-access ciente do risco',
    manifestoAusente: (nome: string, dir: string) => `${nome} nao encontrado a partir de ${dir}`,
    rodeInit: 'ork init',
    entreNoRepoEInit: 'entre no repositorio do projeto (ou crie um com git init e o primeiro commit) e rode ork init',
    corrijaManifesto: 'corrija o manifesto e rode ork doctor de novo',
    abbrevOk: (abbrev: string) => `"${abbrev}" (parte 1 do slug de sessao)`,
    abbrevCorrecao: 'defina project.abbrev com ate 3 caracteres [a-z0-9]',
    modos: (padrao: string, permitidos: string) => `padrao ${padrao}; permitidos ${permitidos}`,
    fusoDoManifesto: (fuso: string, chave: string, rotulo: string) => `${fuso} (${chave}); horarios para pessoas em ${rotulo}`,
    fusoDoSistema: (fuso: string, chave: string) => `${fuso} (fuso do sistema; ${chave} nao configurado)`,
    fusoCorrecao: (chave: string) => `corrija ${chave} com um nome IANA`,
    filaVazia: 'vazia: nenhuma fase morreu por limite de uso neste projeto',
    filaResumo: (esperando: number, escalados: number) => `${esperando} aguardando janela, ${escalados} escalado(s) para humano`,
    filaProxima: (quando: string) => `; proxima janela em ${quando}`,
    estadoOk: (dir: string, qtd: number) => `${dir} (${qtd} thread(s))`,
    estadoAusente: (dir: string) => `${dir} ausente`,
    estadoCorrecao: 'ork init cria o diretorio de estado',
    claudeSemLogin: (detalhe: string, auth: string) => `${detalhe}; ${auth}: o despacho pelo claude-bg falharia`,
    claudeLoginPago: 'faca o login de assinatura (claude.ai) no `claude`, sem API key nem provider de nuvem',
    claudeLogin: 'rode `claude` uma vez, faca o login de assinatura (/login) e aceite a confianca no diretorio do projeto; ' +
      'ou crie um perfil com ork accounts add <id> --runtime claude-bg --dir <pasta>',
    onboardingPendente: (n: number, etapas: string) => `${n} etapa(s) pendente(s): ${etapas}`,
    onboardingCompleto: '9 etapas respondidas',
    foraDaRede: 'fora da rede; ork network entrar poe esta maquina na rede da pessoa',
    manifestoOk: (caminho: string, bytes: number, limite: number) => `${caminho} (${bytes} B de ${limite})`,
    politicaViolada: (politica: string, envs: string) => `politica ${politica} violada: ${envs} redireciona o despacho do claude`,
    politicaComPaga: (politica: string, envs: string) =>
      `politica ${politica}; despacho segue na assinatura local, mas ha credencial paga no ambiente: ${envs}`,
    politicaLimpa: (politica: string) => `politica ${politica}; nenhuma variavel de provider pago ativa`,
    removaDoAmbiente: (envs: string) => `remova do ambiente: ${envs} (o despacho usa a assinatura Claude local)`,
    nuncaDespachePorPaga: (envs: string) => `nenhuma acao obrigatoria; nunca despache fase por ${envs}`,
    providersAtivos: (nomes: string) => `nomes ativos: ${nomes}`,
    nenhumProvider: 'nenhum nome da lista de provider ativo',
    memoriaFiles: 'files (fallback honesto: handoff por arquivos, ponteiro path#ancora)',
    embeddingNone: 'memory.embedding com provider none: busca por significado desligada',
    semPerfis: 'nenhum perfil configurado: cada runtime despacha pelo ambiente do processo',
  },
  init: {
    jaExiste: (caminho: string) => `Manifesto ja existe: ${caminho}`,
    nadaSobrescrito: 'Nada foi sobrescrito. Use --force para regerar.',
    agentsMd: (estado: string, caminho: string) => `AGENTS.md ${estado}: ${caminho}`,
    agentsMdLinha: (estado: string, caminho: string) => `  AGENTS.md   ${estado}: ${caminho}`,
    estadosAgents: { criado: 'criado', atualizado: 'atualizado', inalterado: 'inalterado' } as Record<string, string>,
    criado: (caminho: string) => `Manifesto criado: ${caminho}`,
    projeto: (nome: string, abbrev: string) => `  projeto     ${nome} (abbrev "${abbrev}")`,
    branchBase: (branch: string) => `  branch base ${branch}`,
    gerenciador: (g: string) => `  gerenciador ${g}`,
    verify: (v: string) => `  verify      ${v}`,
    semScript: '(nenhum script detectado)',
    estado: (dir: string) => `  estado      ${dir}/ fora do git (${dir}/.gitignore com *; o seu .gitignore fica como está)`,
    proximoPasso: 'Proximo passo: ork doctor; depois ork onboarding para conduzir a entrevista do projeto.',
  },
};

export type Mensagens = typeof PT_BR;

const EN: Mensagens = {
  horario: {
    brasilia: 'Brasília time',
    legendaBrasilia: 'Times in Brasília time.',
    legenda: (rotulo) => `Times in ${rotulo}.`,
  },
  doctor: {
    titulo: 'ork doctor: what holds on this machine now',
    correcao: 'fix',
    bloqueado: (falhas, avisos) =>
      `Verdict: BLOCKED (${falhas} fail, ${avisos} warn). Fix the items above before dispatching a phase.`,
    pronto: (avisos) => `Verdict: READY (${avisos} warn). Phase dispatch allowed through \`ork phase run\`.`,
    nomes: {
      'repositorio': 'repository',
      'manifesto': 'manifest',
      'manifesto do repositorio': 'repository manifest',
      'analisadores do grafo': 'graph analyzers',
      'abbrev do projeto': 'project abbrev',
      'modos de conducao': 'conduction modes',
      'fuso do dono': 'owner time zone',
      'despacho pelo codex': 'codex dispatch',
      'custo e provider herdado': 'cost and inherited provider',
      'provider efetivo da fabrica': 'effective factory provider',
      'fonte da memoria': 'memory source',
      'regime de memoria': 'memory regime',
      'chave de embedding': 'embedding key',
      'fila de rate limit': 'rate limit queue',
      'estado do projeto': 'project state',
      'contas por runtime': 'accounts per runtime',
      'governanca de sessoes': 'session governance',
      'dono do .git': '.git owner',
      'onboarding memoria': 'onboarding memory',
      'onboarding fuso': 'onboarding time zone',
      'rede': 'network',
      'sandbox do codex': 'codex sandbox',
      'permissoes do estado': 'state permissions',
      'pasta privada': 'private folder',
    },
    instaleNode: 'install Node 20 or later',
    gitAusente: 'not found on PATH',
    instaleGit: 'install git',
    branch: (branch, semCommit) => `branch ${branch}${semCommit ? ' (no commit)' : ''}`,
    foraDeRepo: 'outside a git repository',
    rodeDentroDeRepo: 'run ork inside a git repository',
    versaoDesconhecida: 'unknown version',
    codexAusenteUsado: '`codex` binary not on PATH (the project dispatches through it: see codex dispatch)',
    codexAusenteOpcional: '`codex` binary not on PATH (optional: claude-bg is the default runtime)',
    instaleCodex: 'to dispatch through codex, install the Codex CLI and sign in with `codex login`',
    sandboxOk: '`codex sandbox true` runs on this machine',
    sandboxFalhou: (detalhe) => `probe \`codex sandbox true\` failed: ${detalhe}`,
    sandboxCorrecao: 'install the system bubblewrap package (the bundled bwrap cannot create a user namespace ' +
      'on this machine) or declare runtime.sandbox: danger-full-access knowing the risk',
    manifestoAusente: (nome, dir) => `${nome} not found from ${dir}`,
    rodeInit: 'ork init',
    entreNoRepoEInit: 'enter the project repository (or create one with git init and a first commit) and run ork init',
    corrijaManifesto: 'fix the manifest and run ork doctor again',
    abbrevOk: (abbrev) => `"${abbrev}" (part 1 of the session slug)`,
    abbrevCorrecao: 'set project.abbrev with up to 3 characters [a-z0-9]',
    modos: (padrao, permitidos) => `default ${padrao}; allowed ${permitidos}`,
    fusoDoManifesto: (fuso, chave, rotulo) => `${fuso} (${chave}); times for people in ${rotulo}`,
    fusoDoSistema: (fuso, chave) => `${fuso} (system time zone; ${chave} not set)`,
    fusoCorrecao: (chave) => `set ${chave} to an IANA name`,
    filaVazia: 'empty: no phase died from a usage limit in this project',
    filaResumo: (esperando, escalados) => `${esperando} waiting for a window, ${escalados} escalated to a human`,
    filaProxima: (quando) => `; next window at ${quando}`,
    estadoOk: (dir, qtd) => `${dir} (${qtd} thread(s))`,
    estadoAusente: (dir) => `${dir} missing`,
    estadoCorrecao: 'ork init creates the state directory',
    claudeSemLogin: (detalhe, auth) => `${detalhe}; ${auth}: dispatch through claude-bg would fail`,
    claudeLoginPago: 'sign in with a subscription (claude.ai) in `claude`, without an API key or a cloud provider',
    claudeLogin: 'run `claude` once, sign in with your subscription (/login) and accept trust in the project directory; ' +
      'or create a profile with ork accounts add <id> --runtime claude-bg --dir <folder>',
    onboardingPendente: (n, etapas) => `${n} step(s) pending: ${etapas}`,
    onboardingCompleto: '9 steps answered',
    foraDaRede: 'outside the network; ork network entrar puts this machine on the person\'s network',
    manifestoOk: (caminho, bytes, limite) => `${caminho} (${bytes} B of ${limite})`,
    politicaViolada: (politica, envs) => `policy ${politica} violated: ${envs} redirects the claude dispatch`,
    politicaComPaga: (politica, envs) =>
      `policy ${politica}; dispatch stays on the local subscription, but there is a paid credential in the environment: ${envs}`,
    politicaLimpa: (politica) => `policy ${politica}; no paid provider variable active`,
    removaDoAmbiente: (envs) => `remove from the environment: ${envs} (dispatch uses the local Claude subscription)`,
    nuncaDespachePorPaga: (envs) => `no action required; never dispatch a phase through ${envs}`,
    providersAtivos: (nomes) => `active names: ${nomes}`,
    nenhumProvider: 'no name from the provider list is active',
    memoriaFiles: 'files (honest fallback: handoff through files, path#anchor pointer)',
    embeddingNone: 'memory.embedding with provider none: search by meaning is off',
    semPerfis: 'no profile configured: each runtime dispatches through the process environment',
  },
  init: {
    jaExiste: (caminho) => `Manifest already exists: ${caminho}`,
    nadaSobrescrito: 'Nothing was overwritten. Use --force to regenerate.',
    agentsMd: (estado, caminho) => `AGENTS.md ${estado}: ${caminho}`,
    agentsMdLinha: (estado, caminho) => `  AGENTS.md   ${estado}: ${caminho}`,
    estadosAgents: { criado: 'created', atualizado: 'updated', inalterado: 'unchanged' },
    criado: (caminho) => `Manifest created: ${caminho}`,
    projeto: (nome, abbrev) => `  project     ${nome} (abbrev "${abbrev}")`,
    branchBase: (branch) => `  base branch ${branch}`,
    gerenciador: (g) => `  package mgr ${g}`,
    verify: (v) => `  verify      ${v}`,
    semScript: '(no script detected)',
    estado: (dir) => `  state       ${dir}/ kept out of git (${dir}/.gitignore with *; your .gitignore stays as is)`,
    proximoPasso: 'Next step: ork doctor; then ork onboarding to run the project interview.',
  },
};

const CATALOGO: Record<Locale, Mensagens> = { 'pt-BR': PT_BR, en: EN };

/** As mensagens do locale pedido, ou do ativo. */
export function msg(locale: Locale = ativo): Mensagens {
  return CATALOGO[locale];
}

/** Nome de check como o texto o mostra no locale ativo. */
export function nomeDoCheck(nome: string, locale: Locale = ativo): string {
  return CATALOGO[locale].doctor.nomes[nome] ?? nome;
}

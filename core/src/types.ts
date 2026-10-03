/**
 * Tipos centrais do nucleo `ork`.
 *
 * Regra de ouro herdada do Devmaster: o agente decide, o `ork` verifica.
 * Nada aqui depende de LLM; tudo e deterministico e testavel.
 */

/** As 6 fases canonicas do ciclo Orkastery. */
export type Fase = 'GOAL' | 'PLAN' | 'GO' | 'CHECK' | 'SHIP' | 'MASTER';

/** Ordem canonica das fases. */
export const FASES: readonly Fase[] = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const;

/** Alias numerico herdado do Devmaster (F1..F6), usado na parte 3 do slug. */
export const DIGITO_DA_FASE: Readonly<Record<Fase, string>> = {
  GOAL: '1',
  PLAN: '2',
  GO: '3',
  CHECK: '4',
  SHIP: '5',
  MASTER: '6',
};

/**
 * Modos de conducao por #TAG no pedido do builder (visao, secao 3.5).
 *
 * I-43 dividiu o vocabulario em dois, e a divisao e o coracao da aposentadoria:
 * ESCRITORES PARAM DE PRODUZIR, LEITORES CONTINUAM ACEITANDO PARA SEMPRE.
 *
 * Um modo APOSENTADO nao pode mais ser escrito, e continua sendo lido para sempre,
 * porque ele esta gravado em `thread.json` de thread antiga, em recibo `ork.hitl/v1`
 * ja assinado e no ledger append-only de quem rodou antes da aposentadoria. Encolher
 * o leitor junto com o escritor quebraria recibo historico EM SILENCIO.
 *
 * Quem cria thread, le a #TAG de um pedido ou valida manifesto usa `Modo`.
 * Quem le estado gravado em disco usa `ModoLegado`, que nunca encolhe.
 */
export type ModoVivo = 'classic' | 'maestro' | 'auto' | 'fast';

/** Modos aposentados pela I-43: nao se escreve mais nenhum, e se le todos para sempre. */
export type ModoAposentado = 'look' | 'ork';

/** Tudo que pode estar gravado em disco. Esta uniao NUNCA encolhe. */
export type ModoLegado = ModoVivo | ModoAposentado;

/** O que o produto ESCREVE hoje. Encolhe a cada aposentadoria. */
export type Modo = ModoVivo;

/** Um bloco de loop: as fases que uma mesma sessao conduz e se ele pausa para o humano. */
export interface BlocoDeLoop {
  /** Fases conduzidas por este bloco, em ordem canonica. */
  fases: Fase[];
  /** Se true, o fim do bloco pausa e espera o veredito humano. */
  pausa: boolean;
  /** O que o humano decide na pausa (vazio quando o bloco nao pausa). */
  pausaSobre: string;
  /** Parte 3 do slug para as sessoes deste bloco (`goal`, `f34`, `full`, ...). */
  slugFases: string;
}

/** Definicao completa de um modo de conducao. */
export interface DefinicaoDeModo {
  /** Leitor: a matriz mantem a definicao dos aposentados, para thread antiga abrir. */
  modo: ModoLegado;
  /** A #TAG como o builder escreve no pedido. */
  tag: string;
  blocos: BlocoDeLoop[];
  /** Quantas pausas humanas o modo gera (derivado dos blocos). */
  pausas: number;
  recomendadoPara: string;
}

/**
 * Config de despacho de UM bloco de UM modo (feature #setup).
 *
 * E o que a entrevista do #setup customiza: qual runtime, modelo e esforco abrem a
 * sessao daquele bloco. O default pos-instalacao e claude-bg/opus/high em todo bloco.
 */
export interface ConfigDeBloco {
  runtime: string;
  model: string;
  effort: string;
  /** I09: configurados por trabalho, sem prazo default; exigidos no perfil ativo. */
  limites?: LimitesDeBloco;
}

/** Contrato de configuracao; a imposicao sobre processos pertence ao controlador. */
export interface LimitesDeBloco {
  duracaoMs: number;
  maxChildren: number;
  maxDepth: number;
  maxRetries: number;
}

/** Identidade raiz reservada pelo controlador, herdada por fases, filhos e retries. */
export interface IdentidadeDoPrazo {
  threadId: string;
  execucaoId: string;
  /** Leitor: herdado da thread, que pode estar em modo aposentado. */
  modo: ModoLegado;
  /** Indice 1-based na matriz do modo. */
  bloco: number;
}

/** Snapshot para persistencia pelo controlador; nao autentica sua propria origem. */
export interface PrazoDeBloco {
  versao: 1;
  identidade: IdentidadeDoPrazo;
  iniciadaEmMs: number;
  deadlineOriginalMs: number;
  limitesOriginais: LimitesDeBloco;
  deadlineMs: number;
  limites: LimitesDeBloco;
  observadoEmMs: number;
}

/** O consumidor deve comprovar a ausencia de processos, inclusive filhos. */
export type AtividadeDoPrazo =
  | { tipo: 'trabalho' }
  | { tipo: 'espera_lease' | 'espera_score'; processosAtivos: 0 };

export interface ConsumoDoPrazo {
  prazo: PrazoDeBloco;
  restanteMs: number;
  estado: 'ativo' | 'expirado' | 'espera_sem_processo';
}

/** Config do #setup para um modo: uma entrada por bloco, na ordem da matriz do modo. */
export interface SetupDeModo {
  blocos: ConfigDeBloco[];
}

/** O arquivo `.orkastery/setup.json` inteiro (feature #setup). */
export interface SetupDeConducao {
  contrato: 'ork.setup/v1';
  atualizadoEm: string;
  /**
    * I-43: os modos VIVOS sao obrigatorios; os aposentados sobrevivem como blocos
    * inertes no arquivo ja gravado, e por isso sao opcionais em vez de ausentes.
    */
  modos: Record<Modo, SetupDeModo> & Partial<Record<ModoAposentado, SetupDeModo>>;
}

/** Manifesto do projeto (`orkastery.yaml`), na fatia v1 do bloco B0. */
export interface Manifesto {
  project: {
    name: string;
    /** Abreviacao de ate 3 caracteres, parte 1 do slug. */
    abbrev: string;
    stage: 'nascente' | 'crescendo' | 'maduro';
    repo_root?: string;
  };
  /** I-35: fuso do dono (IANA, forma canonica do Intl). Ausente quando nao configurado ou invalido. */
  owner?: { timezone?: string; language?: string; depth?: 'curta' | 'detalhada'; experience?: boolean };
  board: {
    adapter: string;
    default: string;
  };
  runtime: {
    adapter: string;
    model: string;
    effort: string;
    /** `subscription-only` proibe despacho por provider pago (cobranca por token, fora da assinatura). */
    provider_policy: string;
    /** Sandbox do runtime codex (`read-only` | `workspace-write` | `danger-full-access`). */
    sandbox: string;
  };
  conduction: {
    default_mode: Modo;
    allowed_modes: Modo[];
    delegation?: { thread: string; escopo: 'premissas'; prazo: string; evidencia: string; delegado: string };
  };
  /** Opt-in I09. Ausencia preserva o despacho legado; nao ativa runtimes sozinha. */
  playbook?: { ativo: boolean };
  liveness?: { silencio_max_min: number };
  worktree: {
    base_branch: string;
    dir: string;
    /** Uma worktree por thread/bloco quando true (paralelismo isolado). */
    por_thread: boolean;
  };
  verify: {
    build?: string;
    test?: string;
    typecheck?: string;
    /** I-37 (D2): prazo default de cada comando de verificacao, em ms. */
    timeout_ms?: number;
    /** I-37 (D2): prazo de um comando do manifesto, que vence o default. */
    timeout_ms_por_comando?: { build?: number; test?: number; typecheck?: number };
    /**
     * I-54 (RM-037, D10): o preparo que `ork verify` roda UMA vez antes das claims (a compilacao).
     * Cada claim continua rodando o proprio comando inteiro; o preparo so deixa pronto o que ela
     * encontraria. Com ele declarado, o produto e conferido do preparo ao fim da rodada.
     */
    preparo?: string;
  };
  /** I-12: check publicado por runner independente antes do SHIP. */
  ci: {
    required_for_ship: boolean;
    context: string;
    /** Comando hermético do runner; ausente reutiliza os comandos integrais de verify. */
    command?: string;
    /**
     * RM-037 (rm037defeito, defeito 5): repositorios externos cujo PR mesclado vale como entrega da
     * thread (`ork ship registrar-pr --repo`). A chave e `dono/nome`; o valor e o check exigido no head
     * do PR, e texto vazio declara que o repositorio nao tem CI (so o merge provado vale).
     */
    external_repositories: Record<string, string>;
  };
  concurrency: {
    max_parallel_threads: number;
    /**
     * Minutos sem atividade (ledger parado e sessao nao-working) a partir dos quais
     * uma thread despachada deixa de ocupar vaga do escalonador (`vaga.stale`).
     */
    stale_after_min: number;
  };
  handoff: {
    rotate_above: number;
    force_rotate_above: number;
  };
  /**
   * I-33 (D14, D16): troca automatica de perfil entre contas do MESMO runtime, entre perfis que o
   * proprio operador cadastrou e autenticou. Por esgotamento de cota, credito ou limite do plano:
   * LIGADA por padrao, decisao do dono em 19/09/2026 (SECURITY.md), nunca no rate limit comum e
   * nunca por perfil de API paga (D13). Por login perdido: ligada. As duas o operador desliga aqui.
   */
  runtime_profiles: {
    rotate_same_runtime_on_quota: boolean;
    rotate_same_runtime_on_auth: boolean;
    /**
     * RM-056 (D2): como o despacho escolhe entre os perfis disponiveis do runtime. `ordem` (padrao):
     * o primeiro do store, trocando so por cota ou login. `carga`: o de menos sessoes vivas nesta
     * maquina, desempate pelo uso mais antigo.
     */
    distribuir: 'ordem' | 'carga';
  };
  /** Autonomia do bloco B3: retry tipado, fila de rate limit e limite de escalacao. */
  retry: {
    /**
     * Limite de escalacao: quantas tentativas automaticas o `ork` faz pelo MESMO motivo
     * na MESMA fase antes de escalar para humano. Estourado, pausa QUALQUER modo,
     * inclusive `#Auto`: e a invariante de escalacao tipada dos modos.
     */
    max_tentativas: number;
    /**
     * Janela de espera, em minutos, quando o stderr do runtime diz "rate limit" mas NAO
     * diz a hora do reset. Declarada como estimativa na fila, nunca como hora medida:
     * inventar horario de reset e o mesmo defeito de inventar ocupacao de janela.
     */
    janela_padrao_min: number;
    /** Escala o esforco da 2a tentativa em diante (`eco -> low -> medium -> high -> xhigh`). */
    escalar_esforco: boolean;
  };
  /** Regime de memoria (bloco B6). `files` continua sendo o fallback honesto. */
  memory: {
    /** `files` (fallback honesto) ou `orkmind` (camada semantica do bloco B6). */
    mode: string;
    /**
     * NOME LITERAL da variavel de ambiente que carrega a DSN da base propria do tenant.
     *
     * Nome, nunca a string de conexao: o precedente do incidente memory-orkmind e que
     * DSN solta no manifesto acaba escrevendo na base de outro produto. Vazio quer dizer
     * "nao declarada", e nesse caso o regime `orkmind` NAO liga (nao ha fallback).
     */
    database_url_env: string;
    /** Binario do OrkMind chamado por subprocess (cliente desacoplado, sem Python embutido). */
    cli: string;
    /** Tenant/produto dono da base. Vazio herda `project.name`. */
    tenant: string;
    /** Timeout geral de chamada ao OrkMind, em ms (universo tem prazo proprio). */
    timeout_ms: number;
    /** Prazo da leitura das cinco colecoes; padrao 90.000 ms. */
    universo_timeout_ms?: number;
    /** I-38 (D5): embeddings da busca por significado. Ausente vale `provider: none`. */
    embedding?: ConfigDeEmbedding;
  };
  /** Governanca de custo dos auditores periodicos (bloco B5, visao secao 5.3). */
  audit: {
    /** Janela ociosa da assinatura, `HH:MM-HH:MM`. Vazio = nao declarada. */
    janela_ociosa: string;
    /** Esforco padrao das rodadas (`eco` e a governanca de custo herdada). */
    effort: string;
    /** Escopo incremental padrao (`7d`); vazio exige `--since` ou `--tudo`. */
    since_padrao: string;
    /** `auto` usa Graphify quando ele existe no ecossistema; `off` desliga. */
    graphify: string;
  };
  /**
   * I-51 (RM-047): a fabrica em varias maquinas. Com `compartilhada`, cada maquina publica o
   * retrato das proprias threads na branch `ork/fabrica-estado` do `remoto`, e `ork board` e o
   * resumo do pulse mostram as outras. Desligada por padrao: publicar e empurrar para o remoto.
   */
  fabrica: {
    compartilhada: boolean;
    remoto: string;
  };
  /**
   * RM-031 KG5 (D2): a consulta do grafo de codigo pelo MCP. Com `mcp`, o servidor do projeto expoe as
   * tools `ork_grafo_*` e o despacho as libera para a sessao filha. Desligada por padrao: a exposicao e
   * decisao do dono, e vale a do manifesto da raiz, nunca a da worktree de uma thread.
   */
  grafo: {
    mcp: boolean;
  };
  policies?: Record<string, string>;
}

/** Estado de uma thread em disco (`.orkastery/threads/<id>/thread.json`). */
export interface CreationOrigin {
  operationId: string;
  ticketId: string;
  requestHash: string;
}

export interface Thread {
  /** Origem reservada pelo journal; ausente nas threads legadas. */
  creationOrigin?: CreationOrigin;
  /** Registro de identidade, sem objetivo de produto a despachar. Ausente nos registros legados. */
  origem?: 'adocao';
  /** `<abbrev>-<assunto>`, id estavel da thread. */
  id: string;
  /** Slug de 3 partes da primeira sessao da thread. */
  slug: string;
  /** Nome legivel dado pelo builder. */
  nome: string;
  /** Parte 2 do slug, ate 12 caracteres [a-z0-9]. */
  assunto: string;
  /** Leitor: `thread.json` e arquivo, nao tipo; thread de 03/09 segue em `look`. */
  modo: ModoLegado;
  fases: Fase[];
  blocos: BlocoDeLoop[];
  faseAtual: Fase;
  status: 'aberta' | 'pausada' | 'fechada';
  criadaEm: string;
  atualizadaEm: string;
  projeto: { name: string; abbrev: string };
  /** I-51 (RM-047): a maquina em que a thread nasceu (`ORK_MAQUINA` ou o hostname). */
  maquina?: string;
  /** I-51 (RM-047): o item do roadmap reservado na criacao (`ork thread new --roadmap`). */
  roadmap?: string;
  /** Base carimbada pelo `ork` na criacao, nunca escolhida pelo executor. */
  base: { branch: string; commit: string };
  worktree: string | null;
  /** Sessoes despachadas para esta thread (a fonte real vem do runtime). */
  sessoes: SessaoDaThread[];
  /**
   * I-43 (D4, viga a): o CHECK precisa rodar em runtime que o GO nao usou?
   *
   * Esta propriedade e a unica coisa que sai VIVA do Objective Envelope, que a I-43
   * remove. Dentro dele, `objective.ts:104` era o UNICO lugar do produto onde estava
   * escrito que quem valida nao pode ser quem executou, e a regra valia so na criacao
   * do envelope: thread comum nao tinha a propriedade, e `validationRuntimes` nao
   * aparecia em nenhum outro arquivo.
   *
   * Por que isso importa, medido: das 137 threads, 16 registram sessoes de GO e de
   * CHECK; em 11 delas o CHECK rodou apenas em runtime que o GO tambem usou. As
   * quatro threads mais recentes (I-32, I-33, I-34, I-35) sao todas `claude-bg`
   * conferindo `claude-bg`. O regime recente e de AUTOCONFERENCIA, e era justamente
   * contra ele que a regra presa no envelope servia.
   *
   * Ausente ou false: nada muda, e o despacho segue como sempre seguiu.
   */
  exigeRuntimeDiferente?: boolean;
  /**
   * I-43 (D4, viga b): criterios de pronto EXECUTAVEIS.
   *
   * E a segunda viga que sai viva do Objective Envelope, e salva-la nao foi mover
   * codigo: foi criar capacidade. Dentro do envelope, `doneWhen` era PROSA.
   * `objective.ts:205` despejava os itens como lista no `SPEC.md` e NENHUM codigo os
   * executava; os criterios do envelope real eram frases como "D1: ork phase run
   * recusa o despacho quando o objective da thread nao esta approved, com teste que
   * cobre a recusa". Bonito, e nao verificavel.
   *
   * Aqui cada criterio carrega o COMANDO que o prova, e o nucleo o registra como
   * claim: ele passa a rodar pela maquina de `ork verify` que ja existe, com o mesmo
   * timeout, a mesma captura de saida e o mesmo registro de evidencia.
   */
  doneWhen?: CriterioDePronto[];
  /** Decisoes D1..Dn fechadas com o humano (bloco B2 alimenta; o handoff ja le). */
  decisoes: DecisaoDaThread[];
  /** Ids das claims da thread; o corpo vive em `claims.jsonl` (append-only). */
  claims: string[];
  /** Leases que a thread ja segurou (o `main-tree` serializa o merge). */
  leases: RegistroDeLease[];
  /** Baseline gravada antes do GO: separa regressao de divida pre-existente. */
  baseline: Baseline | null;
  /** Ultimo veredito do gate de tokens (`ork gate next`). */
  ultimoTokenGate?: VereditoDeTokens;
  /** Variante de ciclo escolhida na criacao (`ork thread new --ciclo`). Bloco B2. */
  variante?: VarianteDeCiclo | null;
  /** Fatias previstas quando a variante e `feature-xl-faseada`. */
  fatias?: number;
  /** Score humano do MASTER. Enquanto for null a thread nao esta fechada. */
  score?: ScoreHumano | null;
  score_proposto?: ScoreProposto | null;
  fechamentoAdmin?: { motivo: MotivoFechamentoAdmin; por: string; justificativa: string; fechadoEm: string };
}

/** Decisao fechada com o humano. `locked` vai inline em todo handoff da thread. */
export interface DecisaoDaThread {
  id: string;
  texto: string;
  locked: boolean;
  decididaEm: string;
  decididaPor: string;
}

/**
 * Um criterio de pronto EXECUTAVEL (I-43, D4, viga b).
 *
 * O par e indivisivel de proposito: criterio sem comando e a prosa que o envelope
 * tinha, e comando sem criterio e um shell solto que ninguem sabe por que roda.
 */
export interface CriterioDePronto {
  /** O que precisa ser verdade, em uma frase, para o veredito poder nomea-lo. */
  criterio: string;
  /** O comando que prova o criterio, reexecutado no HEAD real. */
  comando: string;
}

/** Uma sessao/agente despachada para conduzir um bloco da thread. */
interface IdentidadeDaSessao {
  slug: string;
  fase: Fase;
  bloco: string;
  sessionId: string;
  runtime: string;
  /** Resultado da re-verificacao no runtime logo apos o despacho. */
  verificada: boolean;
  /** I-36 (T10): canal de origem do despacho. Sessao antiga sem o campo le como `desconhecido`. */
  canal?: CanalDeConducao;
  /** I-36 (T10): conversa ou mensagem que originou o despacho, quando o canal informa. */
  correlacao?: string;
}

/** Adoção não inventa data de despacho nem prompt executado. */
export type SessaoDaThread = IdentidadeDaSessao & ({
  origem?: 'despacho';
  despachadaEm: string;
  promptPath: string;
  promptSha256: string;
  /** IPC privado do controller criado neste despacho, nunca descoberto por PID. */
  controlador?: string;
} | {
  origem: 'adocao';
  adotadaEm: string;
  cwdOrigem: string;
  despachadaEm?: never;
  promptPath?: never;
  promptSha256?: never;
  /** Sessao adotada nunca tem controller proprio: o Ork nao o criou. */
  controlador?: never;
});

/** Evento do ledger JSONL por thread. */
export interface EventoLedger {
  ts: string;
  thread: string;
  tipo: string;
  [chave: string]: unknown;
}

/** Sessao viva reportada pelo runtime (`claude agents --json`). */
export interface SessaoRuntime {
  id?: string;
  sessionId: string;
  name?: string;
  cwd?: string;
  kind?: string;
  status?: string;
  state?: string;
  startedAt?: number;
  /** RM-056 (D5): pid do processo da sessao, so enquanto ele vive (claude agents). */
  pid?: number;
  /** RM-056 (D3): ultima escrita no rollout do codex, em ms (a sessao codex nao expoe pid). */
  atividadeEm?: number;
}

/** Resultado de um check do `ork doctor`. */
export interface Check {
  nome: string;
  nivel: 'ok' | 'warn' | 'fail';
  detalhe: string;
  /** Acao de correcao apresentada quando o check falha. */
  correcao?: string;
}

// ---------------------------------------------------------------------------
// Bloco B1: verdade (claims, verify, policies, gates), leases e handoff.
// ---------------------------------------------------------------------------

/**
 * Motivo TIPADO de um gate. Substitui o gate de bytes e grep: o `ork` reprova por
 * um motivo do catalogo, nunca por heuristica de texto.
 */
export type MotivoGate =
  | 'artifact.missing'
  | 'claims.failed'
  | 'claims.unverifiable'
  | 'policy.violation'
  /**
   * I-43 (D4, viga a): o CHECK foi despachado no MESMO runtime que fez o GO, numa
   * thread que exige validacao cruzada. Quem valida nao pode ser quem executou.
   */
  | 'runtime.autoconferencia'
  | 'verify.regression'
  | 'verify.failed'
  /**
   * I-37 (D1): o comando de verificacao estourou o prazo antes de terminar. Nao e reprovacao:
   * a prova nao chegou ao fim, e carga de maquina nao e defeito. Motivo proprio para o retry
   * reexecutar em vez de abrir GO-FIX, e para o veredito nunca dizer "falhou" do que nao rodou.
   */
  | 'verify.timeout'
  /**
   * I-54 (RM-037, D11): a rodada nao produziu veredito valido. Um comando nao chegou a rodar, ou o
   * produto mudou entre o preparo e o fim da rodada. Nao e reprovacao: o retry reexecuta.
   */
  | 'verify.sem-veredito'
  | 'ci.failed'
  | 'runtime.unavailable'
  | 'runtime.silencio'
  // Bloco B3: o rate limit deixa de ser um `runtime.unavailable` generico. Ele tem
  // horario de reset e fila duravel, e por isso precisa de motivo proprio.
  | 'runtime.rate-limited'
  // I-33 (D1): falha da CONTA do runtime, mais especifica que `runtime.unavailable`. Cota ou
  // creditos esgotados e login ausente pertencem ao perfil que despachou, nao a infraestrutura;
  // por isso tem motivo proprio e politica propria (rotacao de perfil, D5 e D11).
  | 'runtime.quota-exhausted'
  | 'runtime.auth-missing'
  // RM-037 (defeitosdeco D-6): o modelo pedido nao existe ou a CONTA nao tem acesso a ele. A conta
  // funciona para os outros modelos, entao o perfil nao sai do rodizio; o retry troca o destino.
  | 'runtime.model-unavailable'
  // RM-056 (D1): o perfil PEDIDO pelo dono (`--perfil`) nao existe ou e de outro runtime. E erro do
  // pedido, nao da conta: nenhum retry automatico o corrige, e o despacho nunca troca de perfil sozinho.
  | 'runtime.profile-invalid'
  // RM-055: o runtime recusou o despacho por algo que SO o dono resolve no terminal (aceitar a confianca
  // do diretorio, aceitar termos novos do CLI). Vira pausa do dono, com o comando exato, e nao "Conosco".
  | 'runtime.workspace-untrusted'
  | 'runtime.consent-pending'
  // Bloco B3: violacao de CUSTO (despacho redirecionado para provider pago). E o unico
  // motivo que NUNCA recebe retry automatico: reexecutar violacao de custo e gastar de novo.
  | 'cost.violation'
  | 'tree.blocked'
  | 'lease.busy'
  /**
   * I-36 (RM-036, D2): outra conducao ja executa na worktree desta thread. Nao e reprovacao nem
   * falha: e a resposta util ao segundo pedido, com quem conduz e as tres acoes possiveis.
   */
  | 'conducao.em-andamento'
  // I-41 (D10): pedido HITL malformado. Ele e defeito do EMISSOR, nao do dono: a pergunta saiu
  // sem alternativa rotulada, sem consequencia, sem recomendada, ou com a pergunta em prosa.
  // Escalar formato para o humano seria pedir que ele revise a sintaxe do robo.
  | 'hitl.formato'
  | 'human.pending';

/** Uma alegacao verificavel feita por uma fase (`claims.jsonl` da thread). */
/** I-53 (RM-037, P6): as regras do lint de comando de claim (`claim-lint.ts`). */
export type RegraDoLint = 'suite-inteira' | 'sha-intermediario' | 'contagem-de-commits';

/** Um achado do lint: a regra, o pedaco do comando que casou e a forma certa. */
export interface AchadoDoLint {
  regra: RegraDoLint;
  trecho: string;
  correcao: string;
}

export interface Claim {
  /** `C1`, `C2`, ... unico dentro da thread. */
  id: string;
  thread: string;
  fase: Fase | null;
  /** Artefato ao qual a alegacao se refere (caminho relativo a raiz do projeto). */
  arquivo: string;
  alegacao: string;
  /** Alegacao negativa/absoluta ("nenhum", "sempre", "zero"): exige comando, senao reprova. */
  negativa: boolean;
  /** Comandos que reexecutam a alegacao no HEAD real. Vazio = nao verificavel. */
  verificar: string[];
  criadoEm: string;
  /** `retirada`: o autor retirou a alegacao em vez de tentar sustenta-la. */
  estado: 'pendente' | 'verificado' | 'reprovado' | 'nao-verificavel' | 'retirada';
  /** Por que a claim foi retirada (obrigatorio quando `estado` e `retirada`). */
  motivoDaRetirada?: string;
  /**
   * I-43 (D4, viga b): quem registrou esta claim.
   *
   * Ausente e o caso normal: a claim veio de quem conduz a fase. `nucleo.doneWhen`
   * marca a claim que o NUCLEO criou a partir de um criterio de pronto da thread, e
   * a marca importa porque essa claim nao e auto-relato de agente: ela veio de um
   * criterio declarado antes de o trabalho comecar.
   */
  origem?: 'nucleo.doneWhen';
  /**
   * I-53 (RM-037, P6): o lint dos comandos, calculado quando a claim nasce (vazio quando nada
   * casou). A presenca do campo marca a claim nascida sob a regra: so ela pode ser recusada no
   * `ci prepare`; a claim antiga recebe aviso (D16).
   */
  lint?: AchadoDoLint[];
}

/** Execucao real de um comando de verificacao. */
/** I-37 (D8): por que o comando terminou. Separa "nao rodou ate o fim" de "rodou e falhou". */
export type CausaDoComando = 'exit' | 'timeout' | 'nao-encontrado' | 'sinal';

export interface ResultadoDeComando {
  nome: string;
  comando: string;
  ok: boolean;
  code: number;
  /** Ultimas linhas da saida real, para a evidencia caber no ledger. */
  resumo: string;
  /** I-37 (D8): os campos novos sao opcionais, para baseline antiga continuar legivel. */
  causa?: CausaDoComando;
  /** Prazo aplicado a este comando, resolvido uma vez por rodada (D3). */
  prazoMs?: number;
  duracaoMs?: number;
  /** Testes que o runner reportou como reprovados (ate 10). So em comando que falha. */
  testeQueCaiu?: string[];
  /** Saida real ja redigida, ate 1024 caracteres. So em comando que falha. */
  trecho?: string;
  /**
   * I-54 (RM-037, D11): o processo foi lancado e devolveu um codigo ou uma causa. `false` e comando
   * que nao rodou, e ele nunca vira verificado. Ausente so em baseline gravada antes da I-54.
   */
  executado?: boolean;
}

/** Baseline gravada antes do GO: separa regressao de divida pre-existente. */
export interface Baseline {
  commit: string;
  gravadaEm: string;
  comandos: ResultadoDeComando[];
}

/** Resultado da reexecucao de uma claim no HEAD real. */
export interface ResultadoDeClaim {
  claim: Claim;
  verificado: boolean;
  motivo: MotivoGate | null;
  detalhe: string;
  execucoes: ResultadoDeComando[];
}

/** Lease de exclusao mutua (o `main-tree` serializa o merge entre threads). */
export interface Lease {
  nome: string;
  thread: string;
  motivo: string;
  pid: number;
  adquiridoEm: string;
  expiraEm: string;
  /** I-36: so no lease `exec:<thread>`: quem conduz, de qual canal, em que fase e com qual prompt. */
  conducao?: DadosDaConducao;
}

/**
 * I-36 (D5): os canais por onde o UNICO Maestro conduz a fabrica. Registro fechado: canal fora
 * dele e recusado, nunca inferido. Canal descreve a porta e NAO concede autoridade.
 */
export type CanalDeConducao = 'claude-code' | 'hermes' | 'openclaw' | 'codex' | 'mcp' | 'cli';

/** I-36: a operacao que segura o lease de execucao. */
export type OperacaoDeConducao =
  | 'phase.run' | 'retry.run' | 'verify' | 'baseline' | 'fix.open' | 'fix.reverify' | 'mcp.verify' | 'handoff';

/**
 * I-36 (D7): quem segura a conducao. Processo local prova vida pelo flock do kernel; sessao de
 * runtime, pelo ledger e pelo runtime; reserva de handoff, pelo prazo curto (nao e execucao).
 */
export type DonoDaConducao =
  | { tipo: 'processo'; pid: number; inicio: string; bootId: string; maquina: string }
  | { tipo: 'sessao'; sessionId: string; runtime: string; perfil: string | null; maquina: string }
  | { tipo: 'reserva'; por: string; maquina: string };

/** I-36: os dados de conducao gravados no lease `exec:<thread>`. */
export interface DadosDaConducao {
  contrato: 'ork.conducao/v1';
  canal: CanalDeConducao;
  /** Conversa ou mensagem que originou o pedido, quando o canal informa. */
  correlacao: string | null;
  operacao: OperacaoDeConducao;
  fase: Fase | null;
  promptSha256: string | null;
  /** Identidade de despacho (ou token da operacao): e por ela que a reentrada se prova (D4). */
  identidade: string;
  dono: DonoDaConducao;
  /** Renovacoes do prazo enquanto a operacao roda (D3). */
  renovacoes?: number;
  renovadoEm?: string;
}

/** I-36 (D9): a leitura unica de "quem conduz agora", usada por todas as superficies. */
export interface ConducaoAtual {
  thread: string;
  canal: CanalDeConducao | 'desconhecido';
  /** sessionId quando a conducao e uma sessao de runtime; null quando e um processo local. */
  sessao: string | null;
  fase: Fase | null;
  desde: string;
  promptSha256: string | null;
  operacao: OperacaoDeConducao;
  dono: DonoDaConducao;
  expiraEm: string;
  identidade: string;
}

/** Registro no `thread.json` de um lease que a thread ja segurou. */
export interface RegistroDeLease {
  nome: string;
  adquiridoEm: string;
  liberadoEm: string | null;
}

/**
 * Fonte da medida de ocupacao da janela de tokens, com honestidade de medicao:
 * `unavailable` quando nada sabe medir. Numero inventado nao existe no `ork`.
 */
export type FonteDeMedida = 'runtime_reported' | 'estimated' | 'informada' | 'unavailable';

/** Medida da lotacao da janela da sessao atual. */
export interface MedidaDeJanela {
  /** 0..1, ou null quando a fonte e `unavailable`. */
  ocupacao: number | null;
  fonte: FonteDeMedida;
  detalhe: string;
}

/** Veredito do gate de tokens (`ork gate next`, visao secao 3.6). */
export interface VereditoDeTokens {
  thread: string;
  medida: MedidaDeJanela;
  proximoPasso: Fase | null;
  passoPesado: boolean;
  veredito: 'same-session' | 'new-session';
  /** Como o veredito foi alcancado: por medida ou por ausencia dela. */
  decididoPor: 'medicao' | 'ausencia-de-medida';
  razao: string;
  /** Slug da proxima sessao quando o veredito e `new-session`. */
  slugSugerido: string | null;
  limiares: { rotate_above: number; force_rotate_above: number };
  decididoEm: string;
}

/** Proveniencia obrigatoria de todo item de handoff. */
export interface Proveniencia {
  /** Arquivo de origem, relativo a raiz do projeto. */
  source: string;
  /** `path#ancora` resolvivel por `ork handoff recall`. */
  location: string;
  /** sha256 do arquivo de origem no momento do export. */
  sha256: string;
}

/** Item CRITICO: vai inline no prompt da proxima sessao, sempre. */
export interface ItemInline {
  id: string;
  tier: 'CRITICO';
  titulo: string;
  conteudo: string;
  proveniencia: Proveniencia;
}

/** Item IMPORTANTE: vira ponteiro com instrucao de recuperacao, nao texto colado. */
export interface Ponteiro {
  id: string;
  tier: 'IMPORTANTE';
  titulo: string;
  source: string;
  location: string;
  sha256: string;
  retrieve_via: string;
  /** Fase ou evento em que o ponteiro deve ser resolvido. */
  retrieve_when: string;
  /**
   * Endereco na memoria semantica (`orkmind://<colecao>/<id>`), quando o handoff foi
   * escrito em regime `orkmind`.
   *
   * O `location` continua sendo `path#ancora` SEMPRE: e por isso que o mesmo ponteiro
   * resolve com o OrkMind ligado (por tag) e com ele desligado (leitura dirigida), sem
   * mudanca no fluxo de quem le o handoff.
   */
  orkmind?: string;
}

/** Item RESUMIVEL: resumo curto com proveniencia declarada. */
export interface Resumo {
  id: string;
  tier: 'RESUMIVEL';
  text: string;
  provenance: Proveniencia;
}

/** Handoff tipado F(n)-para-F(n+1) em regime `files` (visao secao 6.2). */
export interface Handoff {
  versao: number;
  thread: string;
  geradoEm: string;
  /** `files` ou `orkmind`: declara o regime, entao a sessao seguinte sabe o que pedir. */
  memory: string;
  de: { slug: string; fase: Fase | null };
  para: { slug: string; fase: Fase | null };
  inline: ItemInline[];
  pointers: Ponteiro[];
  summaries: Resumo[];
}

// ---------------------------------------------------------------------------
// Bloco B2: threads paralelas (worktree, leases, escalonador) e score (MASTER).
// ---------------------------------------------------------------------------

/**
 * Familias de lease do B2. O `main-tree` do B1 continua sendo o unico gate de merge;
 * os demais serializam regiao de trabalho, card de board e porta de servico.
 */
/** I-36 (D1): `exec` protege a EXECUCAO na worktree de uma thread; `worktree-write` segue protegendo a escrita. */
export type TipoDeLease = 'main-tree' | 'worktree-write' | 'path' | 'board' | 'service' | 'exec';

/** Pedido de lease que ficou esperando: e a fila por colisao, em FIFO por `desdeEm`. */
export interface PedidoNaFila {
  /** Nome canonico do lease pedido (`path:core/src/**`, `main-tree`, ...). */
  nome: string;
  tipo: TipoDeLease;
  thread: string;
  motivo: string;
  desdeEm: string;
  /** Nome do lease que colidiu com o pedido no momento em que ele entrou na fila. */
  colidiuCom: string;
  /** Thread que segurava o lease colidente. */
  bloqueadaPor: string;
}

/** Variantes de ciclo portadas do Devmaster (`ork thread new --ciclo`). */
export type VarianteDeCiclo =
  | 'greenfield'
  | 'merge-branch'
  | 'goal-plan'
  | 'gap'
  | 'feature-xl-faseada';

/**
 * Classes de falha FIXAS do POSTMORTEM. Fixas de proposito: classe livre vira texto
 * solto e o `ork learn` do B4 nao consegue agregar nada de texto solto.
 */
export type ClasseDeFalha =
  | 'sem-falha'
  | 'erro-de-spec'
  | 'base-avancou'
  | 'conflito'
  | 'rate-limit'
  | 'modelo'
  | 'processo'
  | 'scope-creep'
  | 'outra';

/** O score humano de 0 a 5, com justificativa OBRIGATORIA. */
export interface ScoreHumano {
  /** Inteiro de 0 a 5. */
  valor: number;
  /** Sem justificativa nao ha score: o `ork` recusa o registro. */
  justificativa: string;
  avaliadoPor: string;
  avaliadoEm: string;
  /**
   * `pausa` nos modos que param no MASTER, `batch` nos que entregam em bloco, e
   * `omissao` quando a entrega foi ACEITA POR DEFAULT (I-43, D3).
   *
   * O terceiro valor existe para a aceitacao por default nao virar uma quarta coisa
   * empilhada no mesmo campo: o `score` ja misturava nota humana, proposta de agente
   * e encerramento administrativo, e o proprio arquivo provava isso (tres notas com
   * `avaliadoPor: "Julio"` cuja justificativa dizia "ratificacao pendente"). Com
   * `omissao` gravado junto de `avaliadoPor: 'nucleo ork'`, dá para distinguir a olho
   * e por codigo o que o dono julgou do que passou sem ele olhar.
   */
  regime: 'pausa' | 'batch' | 'omissao';
  /**
   * O indice derivado no momento em que o score foi gravado (I-43, D3).
   *
   * Presente sempre que o nucleo calculou; ausente em score legado. Ele nao substitui
   * a nota: quando as duas existem, a humana e a que vale, e o indice fica como o
   * que a maquina achava antes de o dono falar.
   */
  indice?: number;
}

/** Uma fase efetivamente percorrida pela thread, reconstruida do ledger. */
export interface FasePercorrida {
  fase: Fase;
  eventos: number;
  primeiroEm: string;
  ultimoEm: string;
  /** Sessoes despachadas para a fase. */
  sessoes: string[];
}

/** POSTMORTEM.json tipado da thread (corpo estruturado do MASTER log). */
export interface Postmortem {
  versao: number;
  thread: string;
  slug: string;
  /** Leitor: derivado da thread. */
  modo: ModoLegado;
  tag: string;
  variante: VarianteDeCiclo | null;
  fasesPercorridas: FasePercorrida[];
  classesDeFalha: ClasseDeFalha[];
  score: ScoreHumano;
  /** Reprovacoes tipadas que a thread levou, do ledger. */
  gatesBloqueados: { ts: string; motivo: string; detalhe: string }[];
  decisoesAutonomas: number;
  pausasHumanas: number;
  /** Ships concluidos, com os shas que o `ork ship` provou. */
  entregas: { ts: string; de: string; para: string; mergeSha: string; pushVerificado: boolean }[];
  resumo: string;
  geradoEm: string;
}

/**
 * MASTER log no contrato congelado: os campos abaixo sao o contrato e nao mudam de nome.
 * "Uma entrega sem MASTER log nao aconteceu."
 */
export interface MasterLog {
  contrato: string;
  versao: number;
  thread: string;
  slug: string;
  projeto: { name: string; abbrev: string };
  /** Leitor: derivado da thread; MASTER log de thread aposentada segue valido. */
  modo: ModoLegado;
  tag: string;
  variante: VarianteDeCiclo | null;
  fases: Fase[];
  score: number;
  justificativa: string;
  avaliadoPor: string;
  avaliadoEm: string;
  classesDeFalha: ClasseDeFalha[];
  resumo: string;
  /**
   * I-43 (D3): o regime de como este score veio a existir. `omissao` significa que
   * ninguem pontuou e a entrega foi aceita por default, COM registro.
   */
  regime?: ScoreHumano['regime'];
  /**
   * I-43 (D3): o indice derivado do ledger, com os insumos que o produziram.
   *
   * Presente a partir da I-43; ausente nos 35 MASTER logs ja em disco, e o leitor
   * aceita os dois, porque o contrato e congelado e historico nao se migra.
   */
  indice?: {
    valor: number;
    base: number;
    parcelas: { evento: string; ocorrencias: number; desconto: number }[];
  };
  base: { branch: string; commit: string };
  worktree: string | null;
  evidencia: {
    ledger: string;
    postmortem: string;
    eventos: number;
    sessoes: number;
    claims: number;
  };
}

/** Situacao de uma thread no escalonador por maquina (`ork board plan`). */
export type SituacaoNoEscalonador =
  | 'em-andamento'
  | 'pode-avancar'
  | 'espera'
  | 'pausada'
  | 'fechada';

/** Veredito do escalonador para uma thread. */
export interface VagaDaThread {
  thread: string;
  slug: string;
  /** Leitor: derivado da thread. */
  modo: ModoLegado;
  fase: Fase;
  situacao: SituacaoNoEscalonador;
  /** Motivo tipado quando a thread espera; null quando ela pode avancar. */
  motivo: MotivoGate | 'concurrency.limite' | 'vaga.stale' | null;
  detalhe: string;
  correcao: string;
  /** Leases que a thread segura agora. */
  leases: string[];
}

/** Resultado completo do escalonador por maquina. */
export interface PlanoDoEscalonador {
  maxParalelas: number;
  emAndamento: number;
  vagas: VagaDaThread[];
  /** Fila de merge: threads esperando o lease `main-tree`, em FIFO. */
  filaDeMerge: PedidoNaFila[];
  /** Fila por colisao de regiao (`path:<glob>`) e demais familias. */
  filaDeRegiao: PedidoNaFila[];
  decididoEm: string;
}

/** Uma thread lida de um perfil qualquer, para o `ork board --all`. */
export interface ThreadNoBoard {
  perfil: string;
  raiz: string;
  thread: Thread;
  leases: string[];
  naFila: PedidoNaFila[];
}

// ---------------------------------------------------------------------------
// Bloco B5: auditores periodicos (feature mandatoria do PO).
// ---------------------------------------------------------------------------

/** Os 7 packs de auditoria. Lista fixa: pack livre vira texto solto e nao agrega. */
export type PackDeAuditoria =
  | 'clean-code'
  | 'reuse'
  | 'architecture'
  | 'data-model'
  | 'ux'
  | 'security-privacy'
  | 'process';

/** Estagio do produto declarado no manifesto (`project.stage`), visao secao 5.2. */
export type Estagio = Manifesto['project']['stage'];

/**
 * Postura do pack no estagio do produto (a coluna "Postura" da tabela da visao 5.2).
 * `promove-policy` nao promove nada sozinho: ele PROPOE a promocao pela regra do `ork learn`.
 */
export type PosturaDoPack = 'warn' | 'proposta-prioritaria' | 'promove-policy';

/** De onde o pack tira evidencia: a arvore de codigo ou o proprio historico de conducao. */
export type FonteDeAuditoria = 'codigo' | 'ledger';

/** Uma regra auditada por um pack, com a evidencia que a comprova. */
export interface RegraDePack {
  /** `CC1`, `SP4`, ... citavel por item, como as checklists normativas. */
  id: string;
  regra: string;
  /** Que evidencia o auditor precisa trazer para a regra ter sido de fato auditada. */
  evidencia: string;
}

/** Definicao completa de um pack de auditoria. */
export interface DefinicaoDePack {
  id: PackDeAuditoria;
  titulo: string;
  objetivo: string;
  /** Estagio a partir do qual o pack fica ativo (tabela da visao, secao 5.2). */
  estagioMinimo: Estagio;
  fonte: FonteDeAuditoria;
  regras: RegraDePack[];
  /** As evidencias que a rodada precisa colher, alem das de cada regra. */
  evidencias: string[];
  /** Checklists normativas de `references/` que o pack cita por item. */
  referencias: string[];
}

/**
 * Motivo tipado de uma reprovacao de auditoria.
 *
 * Herda os motivos do gate do B1 (o auditor esta sujeito as MESMAS reprovacoes de claim
 * e de policy) e acrescenta os que so existem no regime de auditoria periodica.
 */
export type MotivoDeAuditoria =
  | MotivoGate
  | 'custo.fora-da-janela'
  | 'pack.inativo-no-estagio'
  | 'achado.sem-proposta'
  | 'achado.duplicado-na-rodada'
  | 'achado.ja-virou-thread';

export type SeveridadeDeAchado = 'critico' | 'maior' | 'menor';

/**
 * Ciclo de vida de um achado no board de divida.
 *
 * `resolvido` e `descartado` sao coisas diferentes de proposito: `resolvido` quer dizer que
 * a divida foi paga (e por isso a claim do achado nao se sustenta mais, o que e o resultado
 * CERTO); `descartado` quer dizer que o achado nao procedia. Sem essa distincao, um achado
 * corrigido reapareceria em `ork audit verify` como auditor que nao provou o que alegou.
 */
export type EstadoDeAchado = 'aberto' | 'virou-thread' | 'adiado' | 'resolvido' | 'descartado';

/**
 * A proposta de ajuste enderecada ao roadmap do produto.
 *
 * E o bloco OBRIGATORIO da saida de toda rodada: sem os quatro campos abaixo o achado nao
 * e registrado, porque um achado sem proposta e relatorio, nao e insumo de roadmap.
 */
export interface PropostaDeAjuste {
  impacto: string;
  fix: string;
  estimativa: string;
  /** O passo irreversivel que o fix exige. String vazia quando nao ha nenhum. */
  passoIrreversivel: string;
  /** Roadmap de destino (o produto auditado). */
  destino: string;
  /** `files` (B5) ou `orkmind` (B6, colecao `roadmap`): o regime declarado. */
  regime: string;
}

/**
 * Um achado de auditoria no board de divida.
 *
 * O achado carrega uma CLAIM: o auditor nao tem direito a self-report, entao a evidencia
 * arquivo:linha precisa ser reexecutavel por comando, igual a qualquer fase.
 */
export interface Achado {
  /** `F1`, `F2`, ... unico no board de divida do projeto. */
  id: string;
  rodada: string;
  pack: PackDeAuditoria;
  /** Id da regra do pack que o achado viola (`CC1`, `SP4`). */
  regra: string;
  severidade: SeveridadeDeAchado;
  titulo: string;
  /** Evidencia principal, no formato `arquivo:linha`. */
  arquivo: string;
  linha: number | null;
  descricao: string;
  proposta: PropostaDeAjuste;
  /** A alegacao do auditor, sujeita a `ork audit verify` como qualquer claim. */
  claim: Claim;
  estado: EstadoDeAchado;
  produto: string;
  estagio: Estagio;
  postura: PosturaDoPack;
  registradoEm: string;
  /** Thread aberta a partir do achado (`ork thread new --from-finding`). */
  thread: string | null;
}

/** Janela ociosa da assinatura em que a rodada pode gastar (governanca de custo). */
export interface JanelaDeCusto {
  declarada: boolean;
  inicio: string;
  fim: string;
  dentro: boolean;
  /** `HH:MM` local no momento da decisao. */
  agora: string;
  detalhe: string;
}

/** Escopo incremental da rodada: o que o auditor le, e por que nao le o resto. */
export interface EscopoDaRodada {
  /** `7d`, `30d`, ... ou null quando a rodada e de escopo total. */
  since: string | null;
  incremental: boolean;
  arquivos: string[];
  total: number;
  /** Graphify no lugar da leitura bruta do repo, quando existe no ecossistema. */
  graphify: 'disponivel' | 'ausente' | 'desligado';
  detalhe: string;
}

/** Estado de uma rodada de auditoria (`.orkastery/audits/<id>/run.json`). */
export interface RodadaDeAuditoria {
  versao: number;
  id: string;
  pack: PackDeAuditoria;
  /** Perfil/produto alvo (`--profile`), por padrao o proprio projeto do manifesto. */
  perfil: string;
  produto: string;
  estagio: Estagio;
  postura: PosturaDoPack;
  escopo: EscopoDaRodada;
  custo: {
    janela: JanelaDeCusto;
    effort: string;
    model: string;
    /** Quem autorizou rodar fora da janela ociosa, quando foi o caso. */
    autorizadaPor: string | null;
  };
  runtime: string;
  sessionId: string | null;
  slug: string;
  promptPath: string;
  promptSha256: string;
  /** Sessao reconferida no runtime apos o despacho (nunca self-report). */
  verificada: boolean;
  /** `files` enquanto o OrkMind (B6) nao existe. */
  memory: string;
  criadaEm: string;
  status: 'ensaio' | 'bloqueada' | 'despachada' | 'verificada' | 'relatada';
  motivo: MotivoDeAuditoria | null;
  detalhe: string;
  /** Ids dos achados registrados por esta rodada. */
  achados: string[];
  /** Veredito das claims do auditor, preenchido por `ork audit verify`. */
  veredito: VereditoDeAuditoria | null;
  /**
   * Resumo da varredura deterministica da superficie de ataque de rede (SP8..SP12).
   *
   * Opcional porque so o pack `security-privacy` a produz, e porque `run.json` gravado
   * antes desta extensao continua sendo lido sem migracao.
   */
  superficie?: ResumoDaSuperficie | null;
}

/** O que a varredura de superficie de rede achou numa rodada (extensao do B5). */
export interface ResumoDaSuperficie {
  arquivosLidos: number;
  arquivosComRota: number;
  rotas: number;
  frameworks: string[];
  /** Achados encontrados pela varredura. */
  encontrados: number;
  /** Achados efetivamente gravados no board (0 em `--dry-run`). */
  registrados: number;
  /** Achados que sairam com confianca baixa e pedem confirmacao humana. */
  aConfirmar: number;
  detalhe: string;
}

/** Resultado de `ork audit verify`: as claims do auditor reexecutadas no HEAD real. */
export interface VereditoDeAuditoria {
  rodada: string;
  commit: string;
  cwd: string;
  resultados: ResultadoDeClaim[];
  motivos: MotivoDeAuditoria[];
  ok: boolean;
  verificadoEm: string;
}

/** Recorrencia de uma regra no board de divida (a regra mecanica do `ork learn`). */
export interface Recorrencia {
  pack: PackDeAuditoria;
  regra: string;
  ocorrencias: number;
  achados: string[];
  /** `nenhuma` (1), `controle` (2) ou `bloqueante` (3+). Sempre PROPOSTA, nunca aplicada. */
  promocaoProposta: 'nenhuma' | 'controle' | 'bloqueante';
  detalhe: string;
}

// ---------------------------------------------------------------------------
// Bloco B6: camada OrkMind (memoria semantica opcional, com degradacao honesta).
// ---------------------------------------------------------------------------

/**
 * Regime de memoria EFETIVO do `ork`.
 *
 * `files` e o fallback honesto do B1/B5 (handoff por arquivos, ponteiros `path#ancora`).
 * `orkmind` liga a memoria semantica por cima, sem tirar nada do regime `files`: se o
 * OrkMind cair, o ciclo continua no `files` em vez de quebrar.
 */
export type RegimeDeMemoria = 'files' | 'orkmind';

/**
 * Por que o regime pedido no manifesto nao virou o regime efetivo.
 *
 * Motivo tipado de proposito: "a memoria nao ligou" sem motivo e o mesmo que numero
 * inventado no gate de tokens. `dsn.env-ausente` e `dsn.nao-declarado` NUNCA caem para
 * uma DSN solta: o precedente do incidente memory-orkmind e que base alheia e pior do
 * que base nenhuma.
 */
export type MotivoDeDegradacao =
  | 'modo.files'
  | 'modo.desconhecido'
  | 'dsn.nao-declarado'
  | 'dsn.env-ausente'
  | 'cli.ausente'
  | 'orkmind.indisponivel';

/** I-38 (D5): `none` desliga os embeddings; `openrouter` e o unico primario homologado. */
export type ProviderDeEmbedding = 'none' | 'openrouter';

/**
 * I-38 (D5): bloco `memory.embedding` do manifesto.
 *
 * A chave entra pelo NOME da variavel de ambiente (`api_key_env`), nunca pelo valor. Embedding
 * pago e opt-in separado deste bloco: `runtime.provider_policy` continua governando o despacho.
 */
export interface ConfigDeEmbedding {
  provider: ProviderDeEmbedding;
  /** Modelo do provider primario, no formato `org/nome`. Vazio com `provider: none`. */
  model: string;
  /** Dimensao pedida ao primario (`request_dimensions`) e conferida vetor a vetor. */
  dim: number;
  /** NOME da variavel com a chave dedicada. Vazio com `provider: none`. */
  api_key_env: string;
  /** Modelo local offline (`org/nome` no cache do Hugging Face). Vazio = sem fallback local. */
  fallback_model: string;
  /** Teto de tokens estimados por execucao de `ork memory index`, conferido antes da rede. */
  max_tokens_por_execucao: number;
}

/**
 * I-38 (D6): por que a busca por significado nao esta usando o provider primario.
 *
 * Separado de `MotivoDeDegradacao` de proposito: embedding ausente nunca derruba o regime
 * `orkmind` (P6 do GOAL). O recall por tag segue identico com qualquer um destes motivos.
 */
export type MotivoDeEmbeddings =
  | 'embeddings.nao-configurado'
  | 'embeddings.chave-ausente'
  | 'embeddings.provider-indisponivel'
  | 'embeddings.timeout'
  | 'embeddings.local-ausente'
  | 'embeddings.dependencia-ausente'
  | 'embeddings.indice-ausente'
  | 'embeddings.dimensao-divergente'
  | 'embeddings.espaco-vetorial-divergente'
  | 'embeddings.orcamento-excedido'
  | 'embeddings.conteudo-recusado';

/** I-38 (D6): um indice vetorial local, por modelo e dimensao. */
export interface IndiceDeEmbeddings {
  modelo: string;
  dim: number;
  vetores: number;
  /** Vetores com sha256 igual ao conteudo atual; null fora do `memory status`. */
  coerentes: number | null;
  /** Vetores de conteudo que mudou ou saiu do tenant; null fora do `memory status`. */
  desatualizados: number | null;
}

/** I-38 (D6): estado sondado dos embeddings. Nome e presenca da chave, nunca o valor. */
export interface EstadoDeEmbeddings {
  configurado: boolean;
  provider: ProviderDeEmbedding;
  modelo: string | null;
  dim: number | null;
  variavelDaChave: string;
  chavePresente: boolean;
  fallback: { modelo: string | null; presente: boolean; dependencias: boolean; dim: number | null };
  indices: IndiceDeEmbeddings[];
  /** Entradas do tenant nas colecoes do ork; null fora do `memory status`. */
  entradas: number | null;
  /** Coerentes do indice ativo / entradas do universo da busca; null fora do `memory status`. */
  cobertura: number | null;
  /** RM-038: o universo da busca por colecao e o que fica fora dele; null sem leitura do universo. */
  universo: { porColecao: Record<ColecaoDoOrk, number>; foraDaBusca: ForaDaBusca | null; latenciaMs?: number } | null;
  /** RM-038: o indice ativo cobre menos que o universo da busca; null quando cobre tudo ou sem universo. */
  aviso: string | null;
  /** RM-038: codigo tipado quando o universo nao foi lido inteiro (a cobertura fica null, nunca inventada). */
  falhaDoUniverso: string | null;
  ativo: 'primario' | 'fallback' | 'nenhum';
  /** true quando o estado veio da operacao `health` da ponte, nao de suposicao. */
  sondado: boolean;
  motivo: MotivoDeEmbeddings | null;
  detalhe: string;
  correcao: string;
  /** `memory status --sondar`: uma chamada real, com a latencia medida. */
  sonda?: { ok: boolean; alvo: 'primario' | 'fallback' | null; latenciaMs: number | null; motivo: MotivoDeEmbeddings | null };
}

/** Prioridade de uma entrada de memoria. STRING, nunca numero (contrato do OrkMind). */
export type PrioridadeDeMemoria = 'critical' | 'high' | 'medium' | 'low';

/** As colecoes do OrkMind que o `ork` grava (visao, tabela da secao 6). */
export type ColecaoDoOrk = 'decision' | 'handoff' | 'rule' | 'learning' | 'roadmap';

/** Uma entrada de memoria, no formato que o `ork` grava e le de volta. */
export interface EntradaDeMemoria {
  id: string;
  collection: string;
  content: string;
  /** As 5 dimensoes semanticas: skill, agent, domain, project, situation. */
  tags: Record<string, string[]>;
  priority: PrioridadeDeMemoria;
  /** Entrada `mandatory` sempre volta quando as tags casam. O `ork` NUNCA grava true. */
  mandatory: boolean;
  scope: string;
  /** Human exige decision com proveniencia confirmada de human_gate. */
  source: string;
  metadata: Record<string, unknown>;
  criadaEm: string;
  parent_id?: string | null;
  author_id?: string | null;
  visibility?: string;
  protected?: boolean;
  /** Governanca recebida da biblioteca, reconferida antes do embed. */
  injection_risk?: boolean;
  expires_at?: string | null;
}

/** RM-038: entradas do tenant que ficam fora do universo da busca, so a contagem e o porque. */
export interface ForaDaBusca {
  /** Ativas com `injection_risk` (a leitura governada as tira; nunca vao ao embed). */
  injecao: number;
  expiradas: number;
  /** Do tenant, em colecoes fora da busca do `ork` (fora de COLECOES_DO_ORK; a ponte grava session e semantic_log). */
  outrasColecoes: number;
}

/**
 * RM-038: o universo da busca e do indice, lido de uma vez e conferido (domicilio unico:
 * `universoDaBusca` em `indice-vetorial.ts`). Indice, vetor, FTS e status usam este conjunto.
 */
export interface UniversoDaBusca {
  tenant: string;
  /** Instante anterior a leitura, em ms desde epoch; referencia unica para a expiracao. */
  lidoEm: number;
  /** Ordenadas por colecao e id. */
  entradas: EntradaDeMemoria[];
  porColecao: Record<ColecaoDoOrk, number>;
  /** null quando a base nao mede (backend sem a contagem). */
  foraDaBusca: ForaDaBusca | null;
  /** Tempo monotonico da leitura pelo transporte, incluindo o subprocesso; ausente se nao medido. */
  latenciaMs?: number;
}

/** O que o `ork` manda gravar (o id e a data quem carimba e o OrkMind). */
export interface EntradaNova {
  source?: 'agent' | 'human';
  collection: ColecaoDoOrk;
  content: string;
  tags: Record<string, string[]>;
  priority: PrioridadeDeMemoria;
  metadata: Record<string, unknown>;
}

/** Adaptacao de fabrica; validacao G3 pertence exclusivamente ao OrkMind. */
export interface PedidoDeHandoff {
  tenant: string;
  identidade: string;
  sessionId: string;
  origem: string;
  destino: string;
  payload: Record<string, unknown>;
  tags: Record<string, string[]>;
  metadata: Record<string, unknown>;
}

export interface ResultadoDeHandoff extends ResultadoDeGravacao {
  session_entry_id?: string;
  package_entry_id?: string;
  package_id?: string;
  readback?: boolean;
}

export interface EscopoDeLeitura {
  readonly tenant: string;
  readonly thread: string;
}

/** Janela governada completa dentro de projeto e thread; saturacao e erro. */
export interface ConsultaDelimitada {
  collection: ColecaoDoOrk;
  escopo: EscopoDeLeitura;
  tags: Record<string, string[]>;
  limite: number;
}

/** Consulta deterministica por tag: casamento EXATO, sem busca probabilistica. */
export interface ConsultaPorTag {
  collection?: ColecaoDoOrk;
  /** Dimensao -> valores aceitos. Casa quando ha intersecao em TODA dimensao pedida. */
  tags: Record<string, string[]>;
  limite?: number;
}

/** Estado do regime de memoria: o pedido, o efetivo e por que eles diferem. */
export interface EstadoDaMemoria {
  /** O que o manifesto pediu (`memory.mode`). */
  pedido: string;
  efetivo: RegimeDeMemoria;
  motivo: MotivoDeDegradacao | null;
  detalhe: string;
  correcao: string;
  /** Nome LITERAL da variavel de ambiente com a DSN da base propria do tenant. */
  variavel: string;
  /** A base esta declarada no ambiente? (o valor nunca e impresso nem gravado) */
  dsnPresente: boolean;
  cli: string;
  tenant: string;
  /** I-38 (D6): aditivo e opcional; consumidores antigos leem o estado sem ele. */
  embeddings?: EstadoDeEmbeddings;
}

/** Resultado de uma gravacao na memoria semantica. */
export interface ResultadoDeGravacao {
  ok: boolean;
  /** Id da entrada no OrkMind, ou null quando a gravacao nao aconteceu. */
  id: string | null;
  /** `--dedupe` devolveu entrada ja existente: gravacao idempotente, nao erro. */
  duplicada: boolean;
  collection: string;
  detalhe: string;
}

/** De onde saiu um item que o `ork` injetou no prompt. Proveniencia obrigatoria. */
/** I-55 (RM-008): `postmortem` e a licao tirada dos POSTMORTEMs em disco, em qualquer regime. */
export type OrigemDaInjecao = 'thread.json' | 'orkmind' | 'postmortem';

/** Um item injetado deterministicamente no prompt de uma fase. */
export interface ItemDeInjecao {
  /** `inj-1`, `inj-2`, ... na ordem em que entram no prompt. */
  id: string;
  colecao: ColecaoDoOrk;
  titulo: string;
  conteudo: string;
  origem: OrigemDaInjecao;
  /** `path#ancora` ou `orkmind://<colecao>/<id>`: onde este item vive. */
  location: string;
  /** Entrada `mandatory` do OrkMind: entra sempre, mesmo fora do recorte da fase. */
  mandatory: boolean;
}

/** O bloco de memoria que o prompt da fase recebe. */
export interface InjecaoDeMemoria {
  regime: RegimeDeMemoria;
  fase: Fase;
  thread: string;
  itens: ItemDeInjecao[];
  /** Decisoes fechadas da thread que o prompt precisa conter (criterio do B6). */
  decisoes: number;
  licoes: number;
  regras: number;
  /** O texto exato que vai para `{{memoria_injetada}}`. Vazio quando nao ha item. */
  texto: string;
}

/** Veredito da resolucao de UM ponteiro por `ork recall`. */
export type MotivoDeRecall =
  | 'ok'
  | 'fora-do-momento'
  | 'nao-resolve'
  | 'orkmind-indisponivel';

/** Um ponteiro do handoff resolvido (ou nao) por `ork recall`. */
export interface PonteiroResolvido {
  id: string;
  titulo: string;
  location: string;
  /** Endereco semantico do ponteiro, quando o handoff foi escrito em regime orkmind. */
  orkmind: string | null;
  retrieve_when: string;
  resolvido: boolean;
  motivo: MotivoDeRecall;
  /** `files` (path#ancora) ou `orkmind` (busca por tag): como ESTE ponteiro resolveu. */
  via: RegimeDeMemoria | null;
  conteudo: string;
  metodo: string;
  sha256: string;
  intervalo: { inicio: number; fim: number } | null;
  detalhe: string;
}

/** Resultado completo de `ork recall`. */
export interface ResultadoDoRecall {
  thread: string;
  /** Momento pedido (`--fase CHECK`), ou null quando o pedido foi por id. */
  momento: string | null;
  regime: RegimeDeMemoria;
  /** Regime declarado no handoff que esta sendo resolvido. */
  regimeDoHandoff: string;
  resolvidos: PonteiroResolvido[];
  /** Ponteiros que existem mas nao sao deste momento: ficam FORA do contexto. */
  adiados: PonteiroResolvido[];
  falhas: PonteiroResolvido[];
  resolvidoEm: string;
}

// ---------------------------------------------------------------------------
// Bloco B3: autonomia (retry tipado, fila duravel de rate limit, GO-FIX/CHECK-REVERIFY).
//
// A camada do B3 nao inventa verdade nova: ela le o motivo TIPADO que o gate do B1 ja
// produziu e o estado retomavel de thread que o B2 ja grava, e decide o que fazer com
// isso sem humano no meio. O modo continua afrouxando a PAUSA e nunca a VERIFICACAO.
// ---------------------------------------------------------------------------

/**
 * As acoes de retry deterministicas. Cada motivo tipado de gate mapeia para exatamente
 * uma delas, e o mapa e o mesmo em todos os modos de conducao.
 */
export type AcaoDeRetry =
  /** Redespacha a MESMA fase com o MESMO prompt (falha transitoria do runtime). */
  | 'reexecutar'
  /** Abre a rodada GO-FIX com a spec exata do que reprovou (CHANGES NEEDED). */
  | 'corrigir-dirigido'
  /** Rebasa a worktree contra a base que avancou e so depois reexecuta. */
  | 'sincronizar-worktree'
  /** Repete a acao base subindo um degrau de esforco (2a tentativa em diante). */
  | 'escalar-esforco'
  /** Enfileira na fila duravel e retoma quando a janela de rate limit liberar. */
  | 'esperar-janela'
  /** Pausa QUALQUER modo, inclusive `#Auto`, e espera o veredito humano. */
  | 'escalar-humano'
  /** Nunca ha retry automatico (violacao de custo). */
  | 'sem-retry';

/** A politica de retry de um motivo tipado: o que fazer, e se da para fazer sozinho. */
export interface PoliticaDeRetry {
  motivo: MotivoGate;
  acao: AcaoDeRetry;
  /** O `ork` executa sem autorizacao humana? `false` em custo, policy e escalacao. */
  automatica: boolean;
  /** Por que esta e a acao certa para este motivo. */
  porque: string;
  /** O que o humano faz quando a acao nao e automatica. */
  correcao: string;
}

/** Por que uma acao de retry ficou pendente de humano, com motivo tipado. */
export type BloqueioDeRetry =
  /** O motivo nao recebe retry automatico (custo, policy, escalacao ja tipada). */
  | 'politica.nao-automatica'
  /** O bloco de loop do modo pausa nesta fase: o humano ja e parte do caminho. */
  | 'modo.bloco-pausa'
  /** Limite de escalacao estourado: pausa qualquer modo, inclusive `#Auto`. */
  | 'escalacao.limite'
  /** Nao ha gate reprovado pendente para reagir. */
  | 'gate.sem-reprovacao';

/** O plano de retry calculado para a thread, antes de qualquer execucao. */
export interface PlanoDeRetry {
  thread: string;
  /** Leitor: derivado da thread. */
  modo: ModoLegado;
  fase: Fase | null;
  /** Motivo tipado do ultimo gate reprovado ainda nao resolvido. */
  motivo: MotivoGate | null;
  detalhe: string;
  politica: PoliticaDeRetry | null;
  /** Acao efetiva depois de aplicar tentativa e limite de escalacao. */
  acao: AcaoDeRetry;
  /** Tentativas automaticas ja feitas pelo MESMO motivo na MESMA fase. */
  tentativas: number;
  limite: number;
  /** Esforco com que a proxima tentativa sai (escalado a partir da 2a). */
  effort: string;
  /** Esforco da tentativa anterior, para a evidencia da escalada. */
  effortAnterior: string;
  /** O `ork` pode executar isto agora, sem humano? */
  automatica: boolean;
  bloqueio: BloqueioDeRetry | null;
  razao: string;
}

/** Como o horario de reset do rate limit foi obtido do stderr do adapter. */
export type FonteDoReset =
  /** Epoch em segundos no proprio texto (`usage limit reached|1757012400`). */
  | 'epoch'
  /** Carimbo ISO completo no texto. */
  | 'iso'
  /** Hora de relogio (`resets at 3pm`, `resets at 15:00`), resolvida para a proxima ocorrencia. */
  | 'relogio'
  /** Duracao relativa (`try again in 25 minutes`, `retry after 3600 seconds`). */
  | 'duracao'
  /** O texto diz rate limit e NAO diz a hora: a janela vira estimativa declarada. */
  | 'sem-horario';

/** Sinal de rate limit reconhecido na saida real do runtime adapter. */
export interface SinalDeRateLimit {
  /** ISO do reset, ou null quando o runtime nao disse a hora (nunca inventada). */
  resetEm: string | null;
  fonte: FonteDoReset;
  /** Trecho da saida que casou, como evidencia do parse. */
  trecho: string;
}

/**
 * I-33 (D1): falha da conta reconhecida na saida real do runtime. Cota esgotada pode trazer a
 * hora de volta (mesmos padroes do rate limit, nunca inventada); auth ausente nunca tem prazo.
 */
export interface SinalDeFalhaDeConta {
  motivo: 'runtime.quota-exhausted' | 'runtime.auth-missing' | 'runtime.model-unavailable';
  resetEm: string | null;
  fonte: FonteDoReset;
  trecho: string;
}

/**
 * Os 3 playbooks de recuperacao, agora em codigo.
 *
 * `mesma-sessao` e `nova-sessao` saem do MESMO gate de tokens do B1 (secao 3.6), sem
 * regra paralela; `escalada` e o limite que pausa qualquer modo.
 */
export type PlaybookDeRetomada = 'mesma-sessao' | 'nova-sessao' | 'escalada';

/** Um pedido parado na fila duravel de rate limit (`.orkastery/retry/fila.jsonl`). */
export interface PedidoDeRetomada {
  /** `R1`, `R2`, ... unico no projeto. */
  id: string;
  thread: string;
  fase: Fase;
  /** Slug da sessao que morreu no rate limit. */
  slug: string;
  /** Prompt EXATO que sera redespachado, relativo a raiz do projeto. */
  promptPath: string;
  /** sha256 do prompt gravado. Divergiu, a retomada recusa em vez de despachar outro texto. */
  promptSha256: string;
  cwd: string;
  model: string | null;
  effort: string | null;
  sinal: SinalDeRateLimit;
  /** ISO a partir do qual a retomada pode acontecer. */
  liberaEm: string;
  /** True quando `liberaEm` veio da janela padrao, e nao de hora dita pelo runtime. */
  janelaEstimada: boolean;
  tentativas: number;
  estado: 'aguardando' | 'retomado' | 'escalado' | 'cancelado';
  criadoEm: string;
  atualizadoEm: string;
  detalhe: string;
}

/** Resultado de uma tentativa de retomada de um pedido da fila. */
export interface ResultadoDaRetomada {
  pedido: PedidoDeRetomada;
  playbook: PlaybookDeRetomada;
  /** Slug com que a fase foi (ou seria) redespachada. Rotaciona em `nova-sessao`. */
  slug: string;
  despachada: boolean;
  sessionId: string | null;
  verificada: boolean;
  motivo: MotivoGate | null;
  detalhe: string;
  dryRun: boolean;
}

/**
 * Classificacao honesta da correcao do CHECK (skill `check-quality`, DoD 10).
 *
 * `A`: uma linha ou equivalente; reexecuta so as verificacoes afetadas.
 * `B`: devolve a tarefa ao GO, e o CHECK seguinte e reexecucao COMPLETA, nunca parcial.
 */
export type TipoDeCorrecao = 'A' | 'B';

/** Uma correcao dirigida derivada de um motivo tipado do CHECK reprovado. */
export interface Correcao {
  /** `FX1`, `FX2`, ... unico dentro da thread. */
  id: string;
  thread: string;
  /** Rodada de GO-FIX em que a correcao nasceu (1-based). */
  rodada: number;
  tipo: TipoDeCorrecao;
  /** Motivo tipado que originou a correcao. Nunca prosa: sempre do catalogo do B1. */
  origem: MotivoGate;
  /** O que exatamente falhou: `claim C2`, `comando test`, `artefato X`. */
  alvo: string;
  /** A spec exata do que corrigir, montada do resultado real do `ork verify`. */
  spec: string;
  /** Comandos que dao o veredito DESTA correcao no CHECK-REVERIFY. */
  verificar: string[];
  /** Saida real que provou a reprovacao (evidencia, nao relato). */
  evidencia: string;
  estado: 'aberta' | 'aprovada' | 'reprovada';
  vereditoEm: string | null;
  detalheDoVeredito: string;
  criadaEm: string;
}

/** Uma rodada de GO-FIX aberta a partir de um CHECK reprovado. */
export interface RodadaDeFix {
  thread: string;
  rodada: number;
  /** Veredito do CHECK que abriu a rodada. */
  veredito: 'PASSOU' | 'PRECISA DE MUDANCA' | 'BLOQUEADO';
  correcoes: Correcao[];
  /** Ha ao menos uma correcao tipo B: o CHECK seguinte e reexecucao completa. */
  temTipoB: boolean;
  /** Spec exata despachada (ou a despachar) para o GO-FIX. */
  spec: string;
  motivos: MotivoGate[];
  abertaEm: string;
}

// ---------------------------------------------------------------------------
// Monitoramento de pausas e impedimentos (`ork orquestracao status`).
//
// O orquestrador nao pode descobrir que uma thread parou so quando o humano pergunta.
// Os tipos abaixo descrevem a leitura AGREGADA do estado que ja existe em disco
// (thread.json, ledger.jsonl, fila de leases, fila de rate limit) para responder de um
// comando: quem esta parado, esperando o que, ha quanto tempo e o que destrava.
// Nenhum estado novo e gravado: tudo aqui e derivado.
// ---------------------------------------------------------------------------

/**
 * Natureza de uma parada.
 *
 * `pausa-humana` e a parada PREVISTA pelo modo de conducao: o bloco fecha e espera o
 * veredito do humano. `impedimento` e a parada NAO prevista: colisao de lease, gate
 * tipado reprovado, limite de uso do runtime ou limite de paralelismo da maquina.
 */
export type NaturezaDaParada = 'pausa-humana' | 'impedimento';

/** De onde a parada foi lida. Fonte declarada, na mesma honestidade do gate de tokens. */
export type FonteDaParada =
  | 'thread.json'
  | 'ledger'
  | 'fila-de-lease'
  | 'fila-de-rate-limit'
  | 'escalonador';

/** Uma parada aberta de uma thread: o que trava e o que destrava. */
export interface ParadaDaThread {
  natureza: NaturezaDaParada;
  /** Motivo tipado do catalogo de gates, mais o limite de paralelismo e o stale da vaga. */
  motivo: MotivoGate | 'concurrency.limite' | 'vaga.stale';
  /** Fase em que a parada aconteceu (null quando a parada nao e de fase). */
  fase: Fase | null;
  /** Bloco de loop envolvido (`GOAL-PLAN`), vazio quando a parada nao vem de bloco. */
  bloco: string;
  /** O que o humano decide nesta pausa (`pausaSobre` do bloco). Vazio no impedimento. */
  pausaSobre: string;
  detalhe: string;
  /** Evidencia verificavel: evento do ledger, arquivo de fila ou nome do lease. */
  evidencia: string;
  /** Comando exato que destrava. */
  correcao: string;
  desdeEm: string;
  /** Minutos parados no instante da consulta. */
  paradaHaMin: number;
  /**
   * A sessao do bloco ainda esta viva no runtime?
   * `true` = a pausa ainda nao chegou (a sessao trabalha). `false` = a sessao acabou e a
   * pausa esta valendo. `null` = runtime nao consultado ou indisponivel; nesse caso o
   * `ork` prefere avisar a mais do que a menos.
   */
  sessaoViva: boolean | null;
  /**
   * O `state` cru que o runtime deu para essa sessao (`blocked`, `working`, ...).
   *
   * Existe porque "viva" e "trabalhando" nao sao a mesma coisa: a sessao `blocked`
   * aparece viva no `claude agents` e esta parada esperando o humano. Vazio quando o
   * runtime nao informou e ausente quando a parada nao vem de sessao.
   */
  sessaoEstado?: string | null;
  fonte: FonteDaParada;
  /**
   * RM-055: o impedimento do despacho que so o dono resolve, com o comando exato que ele roda e o que o
   * `ork` faz depois. Ausente em qualquer outra parada.
   */
  impedimento?: { comando: string; depois: string; trecho: string };
}

/** Uma thread na visao do monitor, com tudo que a trava agora. */
export interface LinhaDoMonitor {
  perfil: string;
  thread: string;
  slug: string;
  nome: string;
  /** Leitor: derivado da thread. */
  modo: ModoLegado;
  tag: string;
  faseAtual: Fase;
  status: Thread['status'];
  situacao: SituacaoNoEscalonador;
  /** Paradas por pausa humana prevista pelo modo (HITL). */
  pausas: ParadaDaThread[];
  /** Paradas por impedimento (lease, gate tipado, rate limit, concorrencia). */
  impedimentos: ParadaDaThread[];
  /** Pausas e impedimentos juntos, da parada mais antiga para a mais nova. */
  paradas: ParadaDaThread[];
  /** Ultimo evento do ledger da thread. */
  ultimoEvento: { tipo: string; ts: string; fase: string | null } | null;
  /** Minutos desde a parada mais antiga; null quando a thread nao esta parada. */
  paradaHaMin: number | null;
  /** Ha pausa humana valendo (sessao ja nao esta viva, ou nao deu para saber). */
  precisaDeHumano: boolean;
  temImpedimento: boolean;
  /** A parada mais antiga passou do limite de atencao (`--atencao`). */
  acimaDoLimite: boolean;
  /** I-36 (T17): quem conduz a thread agora, pela leitura unica do nucleo. */
  conducao?: ConducaoAtual | null;
}

/** Resultado de `ork orquestracao status`. */
export interface MonitorDeOrquestracao {
  projeto: string;
  consultadoEm: string;
  /** Minutos a partir dos quais uma parada e destacada. */
  atencaoMin: number;
  /** O runtime foi consultado para saber se a sessao do bloco ainda vive? */
  runtimeConsultado: boolean;
  /** Por que o runtime nao foi consultado (vazio quando foi). */
  runtimeDetalhe: string;
  perfis: string[];
  linhas: LinhaDoMonitor[];
  resumo: {
    threads: number;
    aguardandoHumano: number;
    comImpedimento: number;
    emAndamento: number;
    podemAvancar: number;
    fechadas: number;
    /** Threads cuja parada mais antiga passou do limite de atencao. */
    acimaDoLimite: number;
  };
}

// ---------------------------------------------------------------------------
// Radar HITL das sessoes do runtime (`ork sessions hitl`).
// ---------------------------------------------------------------------------

/**
 * Classe TIPADA de uma sessao do runtime, derivada do `state` de `claude agents --json`.
 *
 * O estado bruto do runtime e uma palavra solta; a classe e o que o orquestrador precisa
 * decidir: exige humano agora ou nao. `desconhecida` existe porque o runtime pode
 * inventar um estado novo em qualquer release, e nesse caso o `ork` avisa A MAIS.
 */
export type ClasseDeSessao =
  | 'hitl'
  | 'abandonada'
  | 'falha'
  | 'trabalhando'
  | 'concluida'
  | 'interrompida'
  | 'interativa'
  | 'desconhecida';

/**
 * Sub-tipo de uma sessao parada em HITL, lido do dump de tela da sessao.
 *
 * `credencial` e o caso do incidente de 05/09/2026 (codigo 2FA do `npm publish`): o
 * humano precisa entregar um segredo que a sessao nao tem como obter sozinha.
 */
export type TipoDeHitl =
  | 'hitl.encerrado'
  | 'hitl.credencial'
  | 'hitl.permissao'
  | 'hitl.pergunta'
  | 'hitl.desconhecido';

/** Uma sessao do runtime classificada pelo radar. */
export interface SessaoNoRadar {
  /** Últimas linhas limpas, limitadas e com credenciais reconhecíveis redigidas. */
  contextoLogs?: string[];
  /** Primeiro bloqueio observado; null quando ainda não houve registro. */
  bloqueadaDesdeEm?: string | null;
  paradaHaMin?: number | null;
  /** Id curto do runtime (o que o `claude logs`/`claude stop` aceitam). */
  id: string;
  sessionId: string;
  nome: string;
  cwd: string;
  kind: string;
  /** O `state` cru do runtime (`blocked`, `working`, ...), vazio quando nao veio. */
  estadoBruto: string;
  classe: ClasseDeSessao;
  /** Sub-tipo do HITL; null quando a sessao nao esta em HITL ou os logs nao foram lidos. */
  tipoDeHitl: TipoDeHitl | null;
  /**
   * O job da sessao ainda existe no runtime?
   *
   * MEDIDO em 05/09/2026: `claude agents --json --all` continua devolvendo
   * `state: blocked` para sessoes cujo job ja saiu, e nessas o `claude logs` responde
   * "job not found" com codigo 1. E o que separa "responda o prompt agora" de "morreu
   * esperando resposta". `null` quando os logs nao foram lidos (`--sem-logs`).
   */
  jobVivo: boolean | null;
  /** Esta sessao exige acao humana AGORA? E o unico campo que dispara aviso. */
  precisaDeHumano: boolean;
  /** Por que a classe foi atribuida, em uma linha. */
  detalhe: string;
  /**
   * Inicio da SESSAO em ISO, nao o instante do bloqueio: medido em 05/09/2026, o
   * `claude agents --json` nao expoe quando a sessao entrou no estado atual.
   */
  desdeEm: string;
  /** Minutos desde `desdeEm` (idade da sessao, com a ressalva acima). */
  idadeMin: number;
  /** A pergunta que a sessao faz ao humano, quando os logs foram lidos. */
  pergunta: string;
  /** As opcoes que a sessao oferece, na ordem em que aparecem na tela. */
  alternativas: string[];
  /** Thread do ork dona da sessao (`T-1/GOAL`), ou null quando a sessao e fora do ork. */
  thread: { id: string; fase: string; slug: string } | null;
  /**
   * UMA recomendacao, derivada do tipo da parada.
   *
   * A regra de conducao do Orkastery pede alternativas MAIS uma recomendacao. As
   * alternativas sao as que a propria sessao ofereceu (nao se inventa opcao aqui); a
   * recomendacao e deterministica por tipo, e por isso ela cabe no nucleo sem LLM.
   */
  recomendacao: string;
  /** Comandos exatos que o humano roda para ver e destravar esta sessao. */
  comandos: { logs: string; attach: string; parar: string };
  /** A idade passou do limite de atencao (`--atencao`). */
  acimaDoLimite: boolean;
}

/** Resultado de `ork sessions hitl`: a varredura completa do runtime. */
export interface RadarDeSessoes {
  consultadoEm: string;
  /** Minutos a partir dos quais a sessao e destacada. */
  atencaoMin: number;
  /** O runtime respondeu? `false` quando o `claude` nao esta no PATH. */
  runtimeConsultado: boolean;
  /** Por que o runtime nao foi consultado (vazio quando foi). */
  runtimeDetalhe: string;
  /** Os logs das sessoes em HITL foram lidos para extrair pergunta e alternativas? */
  logsLidos: boolean;
  /** I-45: telas que ficaram para a proxima varredura porque o orcamento de logs acabou. */
  telasAdiadas?: number;
  /** Raiz do projeto ork usada para casar sessao com thread (vazio quando nao ha). */
  raiz: string;
  sessoes: SessaoNoRadar[];
  resumo: {
    total: number;
    precisamDeHumano: number;
    hitl: number;
    /** Sessoes `blocked` cujo job ja saiu: morreram esperando resposta. */
    abandonadas: number;
    falhas: number;
    trabalhando: number;
    desconhecidas: number;
    acimaDoLimite: number;
    foraDoOrk: number;
  };
}

export type MotivoFechamentoAdmin = 'orfa' | 'engano' | 'superada';
export type ProvaDeEntrega = { tipo: 'ship'; ts: string; mergeSha: string } | { tipo: 'artefato'; arquivo: string; sha256: string };

/** Proposta do agente, sem atribuição de autoria humana. */
export interface ScoreProposto {
  valor: number;
  justificativa: string;
  classes: ClasseDeFalha[];
  propostoPor: string;
  propostoEm: string;
  resumo: string;
}
export type PostmortemPendente = Omit<Postmortem, 'score'> & { score: null; score_proposto: ScoreProposto };
export type MasterLogPendente = Omit<MasterLog, 'score' | 'avaliadoPor' | 'avaliadoEm'> & {
  score: null; estado: 'ratificacao-pendente'; score_proposto: ScoreProposto;
};
/** Estado da entrevista do projeto. A pauta e a ordem vivem em onboarding.ts. */
export type EtapaOnboarding = 'maestro' | 'credenciais' | 'bancos' | 'memoria' | 'produtos' |
  'topologia' | 'arquitetura' | 'skills' | 'auditores';
export type ConteudoOnboarding = null | boolean | number | string | ConteudoOnboarding[] |
  { [chave: string]: ConteudoOnboarding };
export interface RespostaOnboarding {
  respondidaEm: string;
  por: string;
  conteudo: ConteudoOnboarding;
}
export interface Onboarding {
  contrato: 'ork.onboarding/v1';
  atualizadoEm: string | null;
  etapas: Record<EtapaOnboarding, RespostaOnboarding | null>;
}

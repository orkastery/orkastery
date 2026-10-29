/**
 * CLI em ingles e pt-BR (RM-061): F1 com `doctor` e `init`, F2a com o caminho da primeira experiencia.
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
 * O locale so vale nos comandos que o CLI ativa por `ativarLocale` (`COMANDOS_COM_LOCALE`, no texto;
 * o `--json` e contrato e nao passa por aqui). Sem ativacao, tudo segue pt-BR: nenhum outro comando
 * muda de lingua pela metade.
 *
 * F2a (D1 e D6 da thread ork-rm061f2a): o catalogo traduz o texto que o comando monta para a pessoa.
 * Dado gravado (ledger, `thread.json`, prompt, estado do onboarding, recusa registrada, policy
 * avaliada) e montado dentro de `comLocale('pt-BR', ...)` e sai como foi gravado. Valor que e dado,
 * como o nome de um check ou o `pausaSobre` de um bloco, so e traduzido na impressao.
 *
 * D14: o erro que o catalogo monta e que nasce no escopo pt-BR da gravacao (`ErroDoCatalogo`: manifesto
 * ausente, os erros de argumento de `thread new`, `--runtime` e o modelo ao trocar de runtime no `phase run`)
 * e remontado no locale do comando pela entrada do CLI. Seguem como o modulo dono escreve, ate a familia dele migrar: o validador
 * do manifesto (fora os avisos de preferencia da experiencia, traduzidos na impressao), o regime de
 * memoria e o erro de estado durante a gravacao; a recusa `<prefixo>.remoto-invalido` do `exigirRemoto` (`branch-de-estado.ts`),
 * que a F2b deixou em pt-BR, vai ao catalogo na F3b. O cabecalho `Projeto consultado:` e `Não lido:` e
 * contrato do RM-052 com os hosts e fica igual nas duas linguas.
 *
 * F2b (G2 e D1 da thread ork-rm061f2b): o texto que o proprio comando monta e que tambem vai ao ledger ou
 * ao `--json` (o detalhe de uma claim reexecutada, o bloqueio do ship, a razao do retry) nasce em pt-BR por
 * `textoDoCatalogo`, dentro do escopo da gravacao, e a impressao o remonta no locale ativo por `remontar`.
 * O registro dos montadores so existe nos comandos cobertos (`ligarRemontagem`); o servidor MCP e o cron
 * nunca o ligam. O que outro processo gravou, a policy avaliada e a saida de ferramenta externa saem como
 * vieram, e tambem (G5) o proximo passo e o estado da entrega de uma thread parada no condutor
 * (`parado-no-condutor.ts`, a familia de entregas), ate a F3. Motivo tipado, acao e bloqueio do retry, codigo,
 * comando e sha saem iguais nas duas linguas (G4); valor de estado mostrado em tabela ou entre parenteses (a
 * acao do `registrar-pr`, o tipo da autorizacao do ship, o status da thread, o veredito e a cobertura do
 * CHECK-REVERIFY, o titulo do grupo do roadmap, a classe do item do pulse) e dado do `--json` e so se traduz
 * na impressao, pelo id (D4).
 *
 * F3a (D1 a D3 da thread ork-rm061f3a): o que o CLI escreve em arquivo para pessoas e agentes lerem (os comentarios
 * do `orkastery.yaml`, o bloco do `AGENTS.md`, o bloco da experiencia no `CLAUDE.md` e os modelos do `ork docs init`)
 * nasce na lingua do dono no momento da geracao, pela familia `gerados` e por `core/assets/docs-en/`.
 * O gerador recebe o locale por parametro, com pt-BR por omissao, e so a entrada do CLI passa a lingua do dono: o
 * locale ativo nunca escolhe a lingua de um arquivo. Chave, valor e marcador do arquivo nao mudam com a lingua.
 *
 * F3b (G4 e D1 a D5 da thread ork-rm061f3b): o resto da lista do dono (`thread list|close|entrega`, `worktree`,
 * `claims`, `decisao placar`, `accounts`, `network`, `roadmap reservas|pegar|soltar|feat`, `docs verificar|sincronizar`,
 * `adapter` e os erros de estado) sai pelo catalogo, com o que vai ao ledger, ao `claims.jsonl` ou ao `--json` nascido em
 * pt-BR e remontado na impressao. O `ork adapter install` copia, com o dono em ingles, as variantes de
 * `core/assets/{skills,references,adapters}-en/`. Seguem em pt-BR, para a F3c: `decisao registrar` (G5), `network roadmap`
 * (G6), `thread new --from-finding` e os prompts de fase (G7).
 *
 * A família `forja` (o motivo dos erros `forja.*` e a seção forja do `ork doctor`) nasce coberta.
 *
 * Ingles (D8): curto, no imperativo onde e instrucao, com os mesmos termos em todo o CLI (`thread`,
 * `phase`, `claim`, `verify`, `ship`, `pulse`, `lease`, `ledger`, `worktree`, `slug`). Comando, flag
 * e identificador dentro de frase vao entre crases; valor que e so um comando (a linha `fix:`) fica nu.
 */

import { ONBOARDING_EN, ONBOARDING_PT_BR } from './locale-onboarding';
import { THREAD_EN, THREAD_PT_BR } from './locale-thread';
import { PHASE_EN, PHASE_PT_BR } from './locale-phase';
import { AJUDA_EN, AJUDA_PT_BR } from './locale-ajuda';
import { VERIFY_EN, VERIFY_PT_BR } from './locale-verify';
import { SHIP_EN, SHIP_PT_BR } from './locale-ship';
import { RETRY_EN, RETRY_PT_BR } from './locale-retry';
import { MASTER_EN, MASTER_PT_BR } from './locale-master';
import { PULSE_EN, PULSE_PT_BR } from './locale-pulse';
import { ROADMAP_EN, ROADMAP_PT_BR } from './locale-roadmap';
import { GERADOS_EN, GERADOS_PT_BR } from './locale-gerados';
import { WORKTREE_EN, WORKTREE_PT_BR } from './locale-worktree';
import { ESTADO_EN, ESTADO_PT_BR } from './locale-estado';
import { SECURITY_SCAN_EN, SECURITY_SCAN_PT_BR } from './locale-security-scan';
import { CLAIMS_EN, CLAIMS_PT_BR } from './locale-claims';
import { DECISAO_EN, DECISAO_PT_BR } from './locale-decisao';
import { ACCOUNTS_EN, ACCOUNTS_PT_BR } from './locale-accounts';
import { NETWORK_EN, NETWORK_PT_BR } from './locale-network';
import { RESERVAS_EN, RESERVAS_PT_BR } from './locale-reservas';
import { DOCS_EN, DOCS_PT_BR } from './locale-docs';
import { ADAPTER_EN, ADAPTER_PT_BR } from './locale-adapter';
import { PROMPTS_EN, PROMPTS_PT_BR } from './locale-prompts';
import { CONHECIMENTO_EN, CONHECIMENTO_PT_BR } from './locale-conhecimento';
import { FORJA_EN, FORJA_PT_BR } from './locale-forja';
import { SETUP_EN, SETUP_PT_BR } from './locale-setup';
import { PROJETOS_EN, PROJETOS_PT_BR } from './locale-projetos';
import { OPERACAO_RESTANTE_EN, OPERACAO_RESTANTE_PT_BR } from './locale-operacao-restante';
import { CONDUCAO_EN, CONDUCAO_PT_BR } from './locale-conducao';
import { GRAFO_EN, GRAFO_PT_BR } from './locale-grafo';
import { AUDIT_EN, AUDIT_PT_BR } from './locale-audit';
import { PREFLIGHT_EN, PREFLIGHT_PT_BR } from './locale-preflight';
import { MAESTRO_EN, MAESTRO_PT_BR } from './locale-maestro';

export type Locale = 'pt-BR' | 'en';
export const LOCALE_PADRAO: Locale = 'pt-BR';
/**
 * Comandos cujo texto ja sai pelo catalogo, por `comando` ou por `comando subcomando`; `comando ?` e o
 * subcomando desconhecido (o erro de uso e do proprio comando). Os demais seguem em pt-BR. Ficam de
 * fora por decisao (D2 da F2a): `doctor --modo`, `thread new --from-finding`, `onboarding sync` e
 * `experiencia uninstall`. A F2b (G3) acrescenta `verify` (com `--baseline`),
 * `ship`, `ship registrar-pr`, `retry plan`, `retry run`, `master` (o indice), `master aceitar-omissao` e
 * `master pedir`, `pulse` (sem `responder` nem `cadencia`) e `roadmap status`. A F3a (D5) acrescenta `docs init`, e a
 * F3b (D1), o resto da lista do dono; a F3c completa `decisao registrar` e `network roadmap`. O conhecimento escrito
 * (RM-026 K7, fatia 2) nasce coberto: `conhecimento listar|mostrar|colecoes|verificar` e o uso errado dele.
 */
export const COMANDOS_COM_LOCALE: readonly string[] = ['doctor', 'init', 'onboarding show', 'onboarding set', 'onboarding reset',
  'onboarding sync', 'onboarding ?', 'experiencia show', 'experiencia uninstall', 'experiencia ?', 'thread new', 'thread status', 'thread ?',
  'phase list', 'phase run', 'phase ?', 'verify', 'ship', 'ship registrar-pr', 'retry plan', 'retry run',
  'retry policy', 'retry parse', 'retry list', 'retry resume', 'retry cancel', 'retry ?',
  'master', 'master <thread>', 'master aceitar-omissao', 'master pedir', 'master audit', 'master digest', 'master migrar',
  'master classes', 'master ratificar', 'master batch', 'master propor',
  'pulse', 'roadmap status', 'docs init',
  // F3b (D1): o resto do CLI, na ordem do pedido.
  'thread list', 'thread close', 'thread entrega', 'worktree ensure', 'worktree sync', 'worktree audit', 'worktree release', 'worktree ?',
  'claims add', 'claims conferir', 'claims verificar', 'claims retirar', 'claims ausente', 'claims list', 'claims ?',
  'decisao registrar', 'decisao placar', 'decisao ?',
  'accounts list', 'accounts add', 'accounts remove', 'accounts check', 'accounts esgotamentos', 'accounts ?',
  // F3c preserva as tres linhas contratuais do panorama; o restante do texto segue o locale.
  'network status', 'network entrar', 'network sair', 'network publicar', 'network roadmap', 'network ?',
  'roadmap reservas', 'roadmap pegar', 'roadmap soltar', 'roadmap feat', 'roadmap ?',
  // O contrato que o `docs verificar` le nas paginas (chaves, valores, secoes, marcadores) segue em pt-BR; so a mensagem muda.
  'docs verificar', 'docs sincronizar', 'docs ?',
  'adapter list', 'adapter show', 'adapter install', 'adapter ?',
  'prompt list', 'prompt lint', 'prompt render', 'prompt ?',
  'conhecimento listar', 'conhecimento mostrar', 'conhecimento colecoes', 'conhecimento verificar', 'conhecimento ?', 'security-scan',
  // F3d: familias restantes, acrescentadas somente quando a familia inteira entra no catalogo.
  'modos', 'ciclos', 'setup', 'projetos', 'pulse cadencia', 'pulse responder', 'ledger',
  'portfolio', 'creation', 'objective', 'ci',
  'sessions watch', 'sessions event', 'sessions list', 'sessions limpar-fantasmas', 'sessions hitl',
  'sessions request', 'sessions answer', 'sessions reconcile', 'sessions supersede', 'sessions adopt',
  'sessions logs', 'sessions stop', 'sessions attach', 'sessions ?',
  'gate context', 'gate request', 'gate answer', 'gate next', 'gate approve', 'gate ?',
  'fix open', 'fix list', 'fix reverify', 'fix ?', 'handoff export', 'handoff recall', 'handoff ?', 'recall',
  'lease list', 'lease acquire', 'lease take', 'lease release', 'lease ?',
  'board list', 'board plan', 'board plano', 'board reap', 'board ?',
  'orquestracao status', 'orquestracao ?', 'monitor', 'licoes', 'demo',
  'fabrica list', 'fabrica publicar', 'fabrica entrar', 'fabrica sair', 'fabrica batida', 'fabrica ?', 'eval',
  'memory status', 'memory inventory', 'memory migrate', 'memory sync', 'memory search', 'memory index', 'memory ?',
  'mcp install', 'mcp serve', 'mcp ?', 'brain', 'activation', 'conducao status', 'conducao assumir', 'conducao atualizar', 'conducao autorizar',
  'conducao autorizacao', 'conducao batida', 'conducao sentinela', 'conducao ?', 'grafo',
  'audit packs', 'audit pack', 'audit lint', 'audit run', 'audit list', 'audit show', 'audit prompt',
  'audit ingest', 'audit finding', 'audit achado', 'audit verify', 'audit report', 'audit relatorio',
  'audit divida', 'audit board', 'audit surface', 'audit superficie', 'audit ?'];


/** Os comandos com subcomando: o padrao (sem subcomando) e os conhecidos; o resto vira `?`. */
const FAMILIAS: ReadonlyMap<string, { padrao: string | null; conhecidos: readonly string[] }> = new Map([
  ['onboarding', { padrao: 'show', conhecidos: ['show', 'set', 'reset', 'sync'] }],
  ['experiencia', { padrao: 'show', conhecidos: ['show', 'uninstall'] }],
  ['thread', { padrao: 'list', conhecidos: ['new', 'list', 'status', 'close', 'entrega'] }],
  ['phase', { padrao: null, conhecidos: ['run', 'list'] }],
  ['retry', { padrao: null, conhecidos: ['plan', 'run', 'policy', 'parse', 'list', 'resume', 'cancel'] }],
  ['roadmap', { padrao: 'reservas', conhecidos: ['reservas', 'status', 'feat', 'pegar', 'soltar'] }],
  ['docs', { padrao: 'verificar', conhecidos: ['verificar', 'sincronizar', 'init'] }],
  ['worktree', { padrao: null, conhecidos: ['ensure', 'sync', 'audit', 'release'] }],
  ['claims', { padrao: 'list', conhecidos: ['add', 'conferir', 'verificar', 'retirar', 'ausente', 'list'] }],
  ['decisao', { padrao: null, conhecidos: ['registrar', 'placar'] }],
  ['accounts', { padrao: 'list', conhecidos: ['list', 'add', 'remove', 'check', 'esgotamentos'] }],
  ['network', { padrao: 'status', conhecidos: ['status', 'entrar', 'sair', 'publicar', 'roadmap'] }],
  ['adapter', { padrao: 'list', conhecidos: ['list', 'show', 'install'] }],
  ['prompt', { padrao: 'list', conhecidos: ['list', 'lint', 'render'] }],
  ['conhecimento', { padrao: 'listar', conhecidos: ['listar', 'mostrar', 'colecoes', 'verificar'] }],
  ['sessions', { padrao: 'list', conhecidos: ['watch', 'event', 'list', 'limpar-fantasmas', 'hitl', 'request', 'answer',
    'reconcile', 'supersede', 'adopt', 'logs', 'stop', 'attach'] }],
  ['gate', { padrao: null, conhecidos: ['context', 'request', 'answer', 'next', 'approve'] }],
  ['fix', { padrao: null, conhecidos: ['open', 'list', 'reverify'] }],
  ['handoff', { padrao: null, conhecidos: ['export', 'recall'] }],
  ['lease', { padrao: 'list', conhecidos: ['list', 'acquire', 'take', 'release'] }],
  ['board', { padrao: 'list', conhecidos: ['list', 'plan', 'plano', 'reap'] }],
  ['orquestracao', { padrao: 'status', conhecidos: ['status'] }],
  ['fabrica', { padrao: 'list', conhecidos: ['list', 'publicar', 'entrar', 'sair', 'batida'] }],
  ['memory', { padrao: 'status', conhecidos: ['status', 'inventory', 'migrate', 'sync', 'search', 'index'] }],
  ['mcp', { padrao: null, conhecidos: ['install', 'serve'] }],
  ['conducao', { padrao: null, conhecidos: ['status', 'assumir', 'atualizar', 'autorizar', 'autorizacao', 'batida', 'sentinela'] }],
  ['audit', { padrao: 'packs', conhecidos: ['packs', 'pack', 'lint', 'run', 'list', 'show', 'prompt', 'ingest', 'finding', 'achado', 'verify', 'report', 'relatorio', 'divida', 'board', 'surface', 'superficie'] }],
]);

/** A entrada de `COMANDOS_COM_LOCALE` que a linha de comando pede, com o subcomando padrao de cada um. */
export function chaveDoLocale(posicionais: readonly (string | undefined)[], opcoes: Readonly<Record<string, unknown>>): string {
  const [comando = '', bruto] = posicionais;
  // F2b (D2): `ork ship <thread>` tem a thread no lugar do subcomando; so `registrar-pr` e rota propria.
  if (comando === 'ship') return bruto === 'registrar-pr' ? 'ship registrar-pr' : 'ship';
  if (comando === 'master') return chaveDoMaster(bruto, opcoes);
  // `ork pulse` le qualquer posicional como o pulse de sempre; `responder` e `cadencia` sao rotas proprias.
  if (comando === 'pulse') return bruto === 'responder' || bruto === 'cadencia' ? `pulse ${bruto}` : 'pulse';
  const familia = FAMILIAS.get(comando);
  if (!familia) return comando;
  const sub = comando === 'onboarding' && 'reset' in opcoes ? 'reset' : bruto ?? familia.padrao;
  return `${comando} ${sub !== null && familia.conhecidos.includes(sub) ? sub : '?'}`;
}

/** Os subcomandos do `ork master` que nao seguem o locale (G3 da F2b): cada um e rota propria. */
const SUBCOMANDOS_DO_MASTER: readonly string[] = ['audit', 'digest', 'migrar', 'classes', 'ratificar', 'batch', 'propor'];

/**
 * A rota do `ork master`, na mesma ordem em que o comando a decide: `pedir` (nunca com `--formato json`),
 * os subcomandos proprios, `--batch`, o aceite por omissao e, sem nada, o indice. A thread sozinha e a nota
 * (`--score`), que segue em pt-BR.
 */
function chaveDoMaster(bruto: string | undefined, opcoes: Readonly<Record<string, unknown>>): string {
  if (bruto === 'pedir') return opcoes.formato === 'json' ? 'master pedir json' : 'master pedir';
  if (bruto !== undefined && SUBCOMANDOS_DO_MASTER.includes(bruto)) return `master ${bruto}`;
  if (opcoes.batch !== undefined) return 'master batch';
  if (opcoes['aceitar-omissao'] !== undefined) return 'master aceitar-omissao';
  return bruto === undefined ? 'master' : 'master <thread>';
}

/** O comando pede o texto pelo locale? Nunca com `--json`, nem nos recortes da D2. */
export function cobreLocale(posicionais: readonly (string | undefined)[], opcoes: Readonly<Record<string, unknown>>): boolean {
  if (opcoes.json !== undefined) return false;
  return COMANDOS_COM_LOCALE.includes(chaveDoLocale(posicionais, opcoes));
}

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

/**
 * RM-061 F3c: a lingua do que o `ork` gera e grava para depois (o prompt despachado, o pedido do achado): so a
 * declarada pelo dono em `owner.language`; sem ela, pt-BR. Nunca o locale de quem roda, nem o `--json`: o mesmo
 * projeto grava o mesmo dado em qualquer maquina. O texto impresso segue o locale do CLI.
 */
export function linguaDeclaradaDoDono(ownerLanguage?: unknown): Locale {
  return resolverLocale(ownerLanguage, {}).locale;
}

let ativo: Locale = LOCALE_PADRAO;

/** Fixa o locale do processo (o CLI, nos comandos de `COMANDOS_COM_LOCALE`; os testes). */
export function ativarLocale(locale: Locale | undefined): void {
  ativo = locale ?? LOCALE_PADRAO;
}

export function localeAtivo(): Locale {
  return ativo;
}

/**
 * Roda `fn` no locale pedido e volta ao anterior, mesmo com erro. Nos comandos cobertos, o que grava
 * estado roda em `comLocale('pt-BR', ...)`: o texto sai em ingles, o dado gravado nao muda (D1, D6).
 */
export function comLocale<T>(locale: Locale, fn: () => T): T {
  const anterior = ativo;
  ativo = locale;
  try { return fn(); } finally { ativo = anterior; }
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

const PT_BR = {
  cli: {
    /** Prefixo do erro que a entrada do CLI imprime (D11). */
    erro: (mensagem: string) => `erro: ${mensagem}`,
    subcomandoDesconhecido: (comando: string, sub: string | undefined) => `subcomando desconhecido: ${comando} ${sub}`,
    /** `exigirManifesto` fora de um projeto: o primeiro erro de quem chega (D14). */
    manifestoNaoEncontrado: (nome: string, dir: string) => `manifesto ${nome} nao encontrado a partir de ${dir}. Rode: ork init`,
    receiptVerifiersUso: 'uso: ork receipt-verifiers --json',
    activationUso: 'uso: ork activation plan|status|enable|disable',
    masterDigestUso: 'uso: ork master digest <enviar|preview|responder>',
    masterRatificarUso: 'resposta deve ser ratificar <thread> <assinatura> <classe>',
    masterSelecaoUso: 'seleção deve ser thread:assinatura',
  },
  preflight: PREFLIGHT_PT_BR,
  maestro: MAESTRO_PT_BR,
  horario: {
    brasilia: 'horário de Brasília',
    legendaBrasilia: 'Horários de Brasília.',
    legenda: (rotulo: string) => `Horários em ${rotulo}.`,
    duracaoDesconhecida: 'tempo desconhecido',
    menosDeUmMin: 'menos de 1 min',
    /** `faltaPara` (ratelimit.ts): quanto falta para o pedido da fila liberar. */
    jaLiberou: 'ja liberou',
    emMinutos: (n: number) => `em ${n} min`,
    emHoras: (h: number, mm: string) => `em ${h}h${mm}`,
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
    securityScanDocker: 'Docker disponivel: as ferramentas do security scan rodam em container',
    securityScanNativo: 'sem Docker; todas as ferramentas do laco tem binario nativo aceito',
    securityScanSemFerramenta: (lista: string) => `sem Docker, nao rodariam (unavailable): ${lista}`,
    securityScanCorrecao: (nativos: string) =>
      `instale o Docker (CLI e daemon ativo); alternativa, instale os binarios nativos na versao do catalogo: ${nativos}. pip-audit e govulncheck so rodam no Docker`,
    branch: (branch: string, semCommit: boolean) => `branch ${branch}${semCommit ? ' (sem commit)' : ''}`,
    foraDeRepo: 'fora de um repositorio git',
    rodeDentroDeRepo: 'rode o ork dentro de um repositorio git',
    versaoDesconhecida: 'versao desconhecida',
    codexAusenteUsado: 'binario `codex` fora do PATH (o projeto despacha por ele: veja despacho pelo codex)',
    codexAusenteOpcional: 'binario `codex` fora do PATH (opcional: claude-bg e o runtime padrao)',
    instaleCodex: 'para despachar pelo codex, instale o Codex CLI e autentique com `codex login`',
    sandboxOk: '`codex sandbox true` executa nesta maquina',
    sandboxFalhou: (detalhe: string) => `sonda \`codex sandbox true\` falhou: ${detalhe}`,
    sandboxCorrecao: (confirmar: string) => 'instale o pacote bubblewrap do sistema (o bwrap embutido nao cria user namespace ' +
      `nesta maquina) ou declare runtime.sandbox: danger-full-access ciente do risco e confirme nesta maquina com ${confirmar}`,
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
    // F2a: o resto do doctor.
    manifestoForaDoRepo: (nome: string, caminho: string, topo: string) =>
      `o ${nome} lido fica fora deste repositorio (${caminho}): o ork conduz o projeto daquela pasta, nao o de ${topo}`,
    manifestoForaDoRepoCorrecao: (topo: string) => `rode ork init na raiz deste repositorio (${topo}); se o manifesto de fora ` +
      'nasceu por engano, apague-o junto com o AGENTS.md e o .orkastery/ ao lado dele',
    storeInvalido: (erro: string) => `store de perfis invalido: ${erro}`,
    storeCorrecao: 'o store fica em .orkastery/private/runtime-profiles.json (arquivo 0600, pasta 0700)',
    contaPaga: 'provider pago (nunca despacha)',
    contaInconclusiva: 'conferencia de login inconclusiva',
    contaSemLogin: 'sem login',
    contaPronta: 'pronto',
    contaFora: (estado: string, ate: string | null | undefined) => `${estado}${ate ? ` ate ${ate}` : ''}`,
    contasCorrecao: 'ork accounts check marca os perfis (sem-auth, provider-pago); ork accounts add refaz o login de assinatura ' +
      'pelo proprio CLI, nunca copiando credencial',
    condutorCompartilha: (runtime: string, conta: string, fases: string) =>
      `o condutor LLM (${runtime}, ${conta}) divide a conta com fases vivas: ${fases}`,
    condutorSeparado: (runtime: string, conta: string) =>
      `o condutor LLM (${runtime}, ${conta}) nao divide a conta com fase viva`,
    contaDoAmbiente: 'ambiente do processo',
    condutorCompartilhaCorrecao: 'rode o condutor em outra conta ou deixe a reacao a cota com `ork conducao batida`',
    embeddingPago: (variavel: string) => `memory.embedding.api_key_env declara ${variavel}, nome da lista de provider pago`,
    embeddingPagoCorrecao: 'use uma chave dedicada ao Orkastery com nome proprio, por exemplo ORKASTERY_EMBEDDING_API_KEY',
    embeddingSemVariavel: (provider: string) => `memory.embedding com provider ${provider} sem api_key_env`,
    embeddingSemVariavelCorrecao: 'declare em memory.embedding.api_key_env o NOME da variavel com a chave dedicada',
    embeddingRecusada: (variavel: string) => `${variavel} tem valor recusado: parece URL, DSN ou texto com espaco (valor nunca impresso)`,
    embeddingRecusadaCorrecao: (variavel: string) => `confira se ${variavel} guarda a chave dedicada, e nao outra credencial`,
    embeddingPresente: (variavel: string, provider: string, modelo: string) =>
      `${variavel} presente no ambiente (valor nunca impresso); ${provider} ${modelo}`,
    embeddingAusente: (variavel: string) =>
      `${variavel} ausente do ambiente: a busca por significado usa o fallback local ou cai para FTS; o regime nao muda`,
    embeddingAusenteCorrecao: (variavel: string) =>
      `exporte ${variavel} com a chave dedicada ao Orkastery (com limite de credito no painel do provider)`,
    donoOutro: (total: number, dir: string, uids: string, uid: number, exemplos: string, parcialDe: number | null) =>
      `${total} entrada(s) de ${dir} com outro dono (uid ${uids}; o do repositorio e ${uid}): ${exemplos}; o git do dono nao grava nelas, ` +
      `e o fetch e o commit falham${parcialDe !== null ? ` (conferencia parcial: mais de ${parcialDe} entradas)` : ''}`,
    donoCorrecao: (comando: string) => `${comando} (o ork nao roda isso sozinho)`,
    donoParcial: (teto: number, dir: string) => `mais de ${teto} entradas em ${dir}: conferencia parcial, sem outro dono ate aqui`,
    donoParcialCorrecao: (comando: string) => `confira o resto com: ${comando}`,
    donoOk: (vistos: number, dir: string, uid: number) => `${vistos} entradas de ${dir} com o dono do repositorio (uid ${uid})`,
    entrevistaMemoria: (escolha: string, declarado: string) => `entrevista escolheu ${escolha}; manifesto declara ${declarado}`,
    entrevistaMemoriaCorrecao: (escolha: string) =>
      `revise memory.mode: ${escolha} em orkastery.yaml; a entrevista não altera o manifesto`,
    entrevistaFuso: (informado: string, declarado: string | undefined, chave: string) =>
      `entrevista informou ${informado}; manifesto declara ${declarado ?? `${chave} ausente`}`,
    entrevistaFusoCorrecao: (chave: string, informado: string) =>
      `revise ${chave}: "${informado}" em orkastery.yaml; a entrevista não altera o manifesto`,
    claudeOpcional: (fallback: { blocos: number; texto: string } | null) =>
      'binario `claude` fora do PATH (opcional para as fases: nenhum bloco dos modos permitidos despacha pelo claude-bg' +
      (fallback ? `; o fallback de ${fallback.blocos} bloco(s) cai nele e falharia: ${fallback.texto}` : '') +
      '; o ork audit run ainda despacha por ele)',
    claudeOpcionalCorrecao: 'para despachar pelo claude-bg (e rodar ork audit run), instale o Claude Code e garanta `claude` no PATH',
    claudeAusente: (principal: { blocos: number; texto: string } | null) => 'binario `claude` fora do PATH' +
      (principal ? `; ${principal.blocos} bloco(s) dos modos permitidos despacham por ele (${principal.texto})` : ''),
    claudeAusenteCorrecao: 'instale o Claude Code e garanta `claude` no PATH; so com o Codex, passe cada bloco para ele ' +
      '(ork setup <modo> --bloco N --runtime codex --model <modelo>) ou tire o modo de conduction.allowed_modes ' +
      '(mantenha o conduction.default_mode entre os permitidos)',
    origemDoCodex: (pelaAdapter: boolean, blocos: { blocos: number; texto: string } | null) =>
      [pelaAdapter ? 'runtime.adapter: codex' : '',
        blocos ? `${blocos.blocos} bloco(s) dos modos permitidos no codex (${blocos.texto})` : ''].filter(Boolean).join(' e '),
    codexForaNoDespacho: (origem: string) => `${origem}, mas o binario \`codex\` esta fora do PATH`,
    codexSandboxQuebrado: (origem: string, sandbox: string) =>
      `${origem} com sandbox "${sandbox}", mas o sandbox nao executa nesta maquina (o agente narraria sucesso sem rodar nada)`,
    codexSandboxOk: (origem: string, sandbox: string) => `${origem} com sandbox "${sandbox}"`,
    codexSemConfirmacao: (origem: string, sandbox: string) => `${origem} com sandbox "${sandbox}" pedido pelo orkastery.yaml, ` +
      'sem a confirmacao desta maquina: o despacho recusa com runtime.sandbox-nao-confirmado',
    codexForaNoDespachoCorrecao: 'instale o Codex CLI e autentique com `codex login` (assinatura, nunca API key)',
    codexSandboxQuebradoCorrecao: (confirmar: string) =>
      `instale o bubblewrap do sistema, ou declare runtime.sandbox: danger-full-access ciente do risco e confirme nesta maquina com ${confirmar}`,
    codexSemConfirmacaoCorrecao: (confirmar: string) => `${confirmar} (ou volte o manifesto para workspace-write)`,
    fabricaPedida: 'o orkastery.yaml pede fabrica.compartilhada: true e esta maquina nao entrou: nada desta maquina e publicado no remoto',
    fabricaPedidaCorrecao: 'ork fabrica entrar, se esta maquina deve publicar o retrato dela no remoto do projeto',
    pastaForaDaRaiz: (dir: string) =>
      `worktree.dir "${dir}" leva para fora da raiz e esta maquina nao confirmou: a criacao de worktree recusa com worktree.dir-fora-da-raiz`,
    pastaForaDaRaizCorrecao: (confirmar: string) => `${confirmar}, ou volte worktree.dir para dentro do projeto`,
    fonteDaMemoria: (fonte: string, divergente: boolean) => `${fonte}${divergente ? ' (cópia da worktree divergente preservada)' : ''}`,
    regimeDegradado: (motivo: string | null, detalhe: string) => `pedido orkmind, efetivo files (${motivo}): ${detalhe}`,
    regimeOrkmind: (tenant: string | null, variavel: string | null) => `orkmind ativo no tenant "${tenant}" pela variavel ${variavel}`,
    // RM-069: a fonte da DSN e a DSN no ambiente, pelo nome da variavel ou pelo rotulo do arquivo, nunca o valor.
    regimeOrkmindPorArquivo: (tenant: string | null, arquivo: string) => `orkmind ativo no tenant "${tenant}" pelo arquivo ${arquivo}`,
    dsnDaVariavel: (variavel: string) => `variável de ambiente ${variavel}, presente (valor nunca impresso)`,
    dsnVariavelAusente: (variavel: string) => `variável de ambiente ${variavel} ausente: a memória cai para files`,
    dsnVariavelAusenteCorrecao: (variavel: string) => `exporte ${variavel} com a DSN da base própria do tenant, ` +
      'ou passe-a por memory.database_url_file (arquivo 0600 em ~/.orkastery/segredos/)',
    dsnDoArquivo: (rotulo: string, permissao: string) =>
      `arquivo ${rotulo}, do usuário que roda o ork, permissão ${permissao}, uma linha (valor nunca impresso)`,
    dsnArquivoFalhou: (rotulo: string, motivo: string, causa: string) =>
      `arquivo ${rotulo} recusado (${motivo}): ${causa}; a memória cai para files, sem outra fonte`,
    // O mesmo texto de `textoDaCausa` (dsn-da-memoria.ts); o teste DD11 confere causa por causa.
    dsnCausa: (causa: string, permissao: string) => (({
      forma: 'memory.database_url_file fora da forma ~/.orkastery/segredos/<nome> (valor omitido)',
      raiz: 'a pasta do usuário do ork precisa ser caminho absoluto sem .., dentro da casa do usuário (HOME)',
      'nao-existe': 'não existe',
      'nao-abre': 'não foi possível abrir para leitura',
      pasta: 'o caminho da pasta de segredos tem link simbólico ou algo que não é pasta',
      'dono-da-pasta': 'a pasta do usuário do ork não é do usuário que roda o ork',
      link: 'link simbólico não é aceito',
      'nao-e-arquivo': 'não é arquivo comum',
      plataforma: 'esta plataforma não confere dono nem permissão',
      dono: 'o dono não é o usuário que roda o ork',
      permissao: `permissão ${permissao}, diferente de 0600 e de 0400`,
      tamanho: 'maior que 4 KiB',
      vazio: 'vazio',
      codificacao: 'não é texto UTF-8',
      linhas: 'mais de uma linha',
      controle: 'caractere de controle',
      'nome-valor': 'formato NOME=valor de arquivo de ambiente; grave só a DSN',
      esquema: 'não é DSN com esquema (como postgresql://)',
      espaco: 'espaço dentro da DSN',
      leitura: 'não foi possível ler',
    }) as Record<string, string>)[causa] ?? causa,
    dsnArquivoCorrecao: (motivo: string, rotulo: string) => motivo === 'dsn.arquivo-ausente'
      ? `grave a DSN da base própria do tenant em ${rotulo}, numa linha e com permissão 0600, sem passar pelo histórico do shell: ` +
        `(umask 077; cat > ${rotulo})`
      : motivo === 'dsn.arquivo-inseguro'
        ? `deixe ${rotulo} como arquivo do usuário que roda o ork, numa pasta dele, com chmod 600 ${rotulo}`
        : `regrave ${rotulo} como arquivo comum numa pasta de segredos comum, dentro da casa do usuário e sem link simbólico ` +
          'no caminho, só com a DSN (esquema://...), numa linha e sem NOME= na frente',
    dsnNaSessao: (doProjeto: readonly string[], comSenha: readonly string[]) =>
      `no ambiente desta sessão despachada, o agente lê com env: ${[...doProjeto.map((n) => `${n} (DSN do projeto)`),
        ...comSenha.map((n) => `${n} (URL com senha)`)].join(', ')} (valor nunca impresso)`,
    dsnNoProcesso: (nomes: readonly string[]) =>
      `a DSN do arquivo também está no ambiente deste processo, em ${nomes.join(', ')}: quem herda este ambiente a vê (valor nunca impresso)`,
    dsnSessaoLimpa: 'nenhuma DSN nem URL com senha no ambiente desta sessão despachada',
    dsnProcessoLimpo: 'a DSN do arquivo não está no ambiente deste processo',
    dsnNoAmbienteCorrecao: 'tire essas variáveis do ambiente que o host repassa aos agentes (no Hermes, ~/.hermes/.env), com backup, ' +
      'e passe a DSN do projeto por memory.database_url_file',
    filaEscaladoCorrecao: 'pedido escalado alem do limite de retry.max_tentativas: ork retry list e ork gate request <thread>',
    filaEsperaCorrecao: 'ork retry resume retoma o que ja liberou',
    governanca: (g: { usuario: string; total: number; semThread: number; ambiguas: number; ok: boolean; ausentes: readonly string[] }) =>
      `${g.usuario}, Claude e Codex, global com histórico: ${g.total} sessões; ` +
      `${g.semThread} sem thread; ${g.ambiguas} ambíguas; ` +
      `inventário ${g.ok ? 'válido' : 'INCOMPLETO (zero não comprovado)'}` +
      (g.ausentes.length ? `; fonte ausente: ${g.ausentes.join(', ')}` : ''),
    governancaCorrecao: 'ork sessions --global --all --json; adote identidades sem vínculo com ork sessions adopt <id>',
    umaskNaoMedido: 'umask do processo nao medido nesta plataforma',
    umaskOk: (umask: string) => `umask ${umask} nega escrita de grupo e outros`,
    umaskAberto: (umask: string) =>
      `umask ${umask} permite escrita de grupo ou outros: o que o runtime criar sera recusado pelo sensor (bits 0o022)`,
    umaskCorrecao: 'umask 022 (ou 077) no shell que roda o ork e os runtimes',
    estadoNaoDiretorio: (dir: string) => `${dir} nao e diretorio real`,
    estadoAberto: (dir: string, modo: string) => `${dir} com modo ${modo}: grupo ou outros podem escrever no estado`,
    estadoComModo: (dir: string, modo: string) => `${dir} com modo ${modo}`,
    privadaAusente: (dir: string) => `${dir} ausente: criada sob demanda com 0700`,
    privadaAberta: (dir: string, modo: string) =>
      `${dir} precisa ser diretorio 0700 do proprio usuario (modo ${modo}): recibo HITL e perfis recusam`,
    privadaOk: (dir: string) => `${dir} com modo 0700`,
    cronSemComando: 'comando crontab ausente nesta maquina',
    cronFalhou: (detalhe: string) => `crontab -l falhou: ${detalhe}`,
    cronSaiu: (codigo: number | null) => `crontab -l saiu ${codigo}`,
    cronAdicione: (linha: string) => `adicione ao crontab (crontab -e), como no template monitor/pulse.cron: ${linha}`,
    cronSemLeitura: (motivo: string) => `pulse-host.json presente, mas sem crontab para ler (${motivo}): a varredura nao bate`,
    cronSemLinha: (script: string) => `pulse-host.json presente, e nenhuma linha do crontab roda ${script}: o resumo nao sai`,
    cronOk: (linhas: number) => `varredura no cron a cada 15 minutos ou menos (${linhas} linha(s))`,
    cronRitmo: (intervalo: number | null) => intervalo === null ? 'com horario que o doctor nao le'
      : intervalo === 60 ? 'de hora em hora' : `a cada ${intervalo} minutos`,
    cronLento: (ritmo: string, linha: string) =>
      `a varredura do pulse bate ${ritmo} (\`${linha}\`): a cadencia por tag (RM-039) pede 15 minutos`,
    cronTroque: (linha: string) => `troque a linha no crontab (crontab -e) por: ${linha}`,
    // RM-063 (F1): com thread aberta, a falta da batida reprova, com ou sem pulse-host.json.
    batidaAusente: (abertas: number, detalhe: string) =>
      `${abertas} thread(s) aberta(s) e nenhuma batida da varredura: ${detalhe}; a fabrica para sem ninguem saber`,
    batidaSemLeitura: (motivo: string) => `sem crontab para ler (${motivo})`,
    batidaSemLinha: (script: string) => `nenhuma linha do crontab roda ${script} para este projeto`,
    batidaInstale: (comando: string) => `${comando} (instala a linha do template monitor/pulse.cron no crontab desta maquina)`,
    batidaPeloLog: (minutos: number) =>
      `nenhuma linha no crontab, mas a varredura rodou ha ${minutos} min (hitl.log): a batida vem de outro agendador`,
    // RM-063 (fatia 3, H1): a linha instalada nao prova a batida; a ultima rodada velha reprova.
    batidaAtrasada: (minutos: number, linhas: number) =>
      `a varredura esta no crontab (${linhas} linha(s)), mas a ultima rodada foi ha ${minutos} min (hitl.log): a batida parou`,
    batidaAtrasadaCorrecao: 'ork fabrica batida status (a ultima rodada diz o codigo e o detalhe; confira o cron, o script e o PATH da linha)',
    // RM-063 (fatia 3, H4): a falha do transporte do pulse, lida do transporte.log.
    transporteOk: (host: string, quando: string) => `ultima entrega pelo ${host} em ${quando}`,
    transporteDesvio: (falhou: string, host: string, quando: string) =>
      `o transporte ${falhou} falhou em ${quando}, e o resumo saiu pelo ${host} (o outro host configurado)`,
    transporteFalhou: (quando: string, tentativas: string) =>
      `o resumo de ${quando} nao saiu por nenhum transporte configurado (${tentativas}): a novidade fica guardada para a proxima batida`,
    transporteCorrecao: 'confira o executavel e o destino em .orkastery/monitor/pulse-host.json (o adaptador do host: openclaw message send ou o ork-pulse-enviar.py do Hermes)',
    redeSaiu: 'fora da rede (saiu com ork network sair)',
    redeMembroHerdado: 'membro herdado da fabrica',
    redeMembro: 'membro',
    redeCasa: (casa: string) => `casa ${casa}`,
    redeSemCasa: 'casa ainda nao gravada',
    redeBatida: (quando: string, idade: string) => `ultima batida ${quando} (ha ${idade})`,
    redeSemBatida: 'nenhuma batida publicada',
    redeFalha: (quando: string, origem: string | null, erro: string) => `ultima falha ${quando}${origem ? ` (${origem})` : ''}: ${erro}`,
    redeSemDetalhe: 'sem detalhe',
    redeSemFalha: 'nenhuma falha no rede.log',
    redeParadaCorrecao: 'a batida sai do pulse: confira o cron do pulse e rode ork network publicar',
    redeSemCasaCorrecao: 'a casa da rede ainda nao existe: o dono roda ork network entrar, que cria o repositorio privado; ' +
      'ou ork network sair, para tirar esta maquina da rede',
    redeSemForjaCorrecao: 'faca login na forja (gh auth login ou glab auth login) e rode ork network publicar',
    redePublicaCorrecao: 'torne a casa da rede privada na forja; nada e publicado num repositorio publico',
    redeNomeCorrecao: 'escolha outro nome com ork network entrar --maquina NOME, ou tome este com --forcar',
    redeOutraCorrecao: 'ork network status mostra as lacunas; ork network publicar tenta de novo',
    /**
     * Redacao do check "analisadores do grafo" (a forma de `RedacaoDosAnalisadores`). A familia do grafo nao
     * importa o catalogo (fronteira do KG3): ela guarda o pt-BR para o `ork grafo status`, e o doctor passa
     * esta. Um teste confere que o pt-BR das duas e o mesmo.
     */
    grafo: {
      recusa: (motivo: string) =>
        `${motivo}: o ork grafo indexar recusa nesta instalacao, e sem o indice as consultas e as tools ork_grafo_* tambem`,
      soEsm: (versaoDoNode: string) => `o micromark e so ESM, e este Node (${versaoDoNode}) nao o carrega por require: use Node 20.19, ` +
        '22.12 ou mais novo, sem a opcao --no-experimental-require-module (na linha de comando ou no NODE_OPTIONS)',
      reinstale: (fixada: string) => `reinstale o ork global, que traz os analisadores como dependencias: npm install -g @orkastery/cli${fixada}` +
        ' (instalado dentro de um projeto ou pelo npx, o npm deixa os analisadores fora do pacote do ork, e o grafo os recusa)',
    },
    /** A fonte de sessoes ausente, como o inventario a nomeia (dado); o ingles so troca o rotulo da conta. */
    fonteDaSessao: (origem: string) => origem,
  },
  onboarding: ONBOARDING_PT_BR,
  thread: THREAD_PT_BR,
  phase: PHASE_PT_BR,
  ajuda: AJUDA_PT_BR,
  verify: VERIFY_PT_BR,
  ship: SHIP_PT_BR,
  retry: RETRY_PT_BR,
  master: MASTER_PT_BR,
  pulse: PULSE_PT_BR,
  roadmap: ROADMAP_PT_BR,
  gerados: GERADOS_PT_BR,
  worktree: WORKTREE_PT_BR,
  estado: ESTADO_PT_BR,
  securityScan: SECURITY_SCAN_PT_BR,
  claims: CLAIMS_PT_BR,
  decisao: DECISAO_PT_BR,
  accounts: ACCOUNTS_PT_BR,
  network: NETWORK_PT_BR,
  reservas: RESERVAS_PT_BR,
  docs: DOCS_PT_BR,
  adapter: ADAPTER_PT_BR,
  prompts: PROMPTS_PT_BR,
  conhecimento: CONHECIMENTO_PT_BR,
  conducao: CONDUCAO_PT_BR,
  grafo: GRAFO_PT_BR,
  audit: AUDIT_PT_BR,
  forja: FORJA_PT_BR,
  operacao: {
    restante: OPERACAO_RESTANTE_PT_BR,
    modos: {
      titulo: 'Modos de conducao (a #TAG vai no proprio pedido ao orquestrador)',
      cabecalho: ['#TAG', 'BLOCOS', 'PAUSAS', 'CICLO'] as readonly string[],
      marcaDaPausa: '* = bloco que pausa e espera veredito humano',
      detalhe: 'Detalhe por modo:',
      slug: 'slug das sessoes',
      pausas: 'pausas',
      nenhuma: 'nenhuma',
      uso: 'uso',
      pausaSobre: {
        objetivo: 'objetivo', plano: 'plano', implementacao: 'implementacao', evidencias: 'evidencias',
        push: 'push', score: 'score', premissas: 'premissas',
        'evidencias, com autorizacao antecipada de push': 'evidencias, com autorizacao antecipada de push',
      } as Record<string, string>,
      recomendado: {
        classic: 'O padrao: premissas delicadas com entrega confiavel',
        maestro: 'Solucoes claras e ageis, sem muitos riscos ou tradeoffs',
        auto: 'Solucoes menores, docs, estudos, pesquisas, configuracoes, auditorias, migracoes',
        fast: 'Pedido pequeno e claro, de minutos: uma fase so (GO), sem cerimonia; o push pede autorizacao',
      } as Record<string, string>,
      regra: 'REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao.',
      migracao: {
        nada: 'Nada a migrar: nenhum modo aposentado na configuracao deste projeto.',
        simulacao: 'Simulacao (--dry-run), nada foi gravado.',
        aplicada: 'Migracao aplicada.',
        de: 'de', para: 'para', backup: 'backup',
        historico: 'Nenhum historico foi tocado: thread, ledger e recibo em modo aposentado ficam como estao.',
      },
    },
    ciclos: {
      titulo: 'Variantes de ciclo (`ork thread new --ciclo <variante>`)',
      descricoes: {
        greenfield: 'Comeco do zero: worktree isolada obrigatoria, partindo da base do manifesto',
        'merge-branch': 'Parte de uma branch que ja existe (`--branch`), sem criar branch nova',
        'goal-plan': 'Funde GOAL e PLAN num bloco so: uma pausa a menos quando o modo os separava',
        gap: 'Analise de lacuna: sem GO e sem SHIP, a lacuna e publicada como lacuna',
        'feature-xl-faseada': 'Feature grande em fatias: o PLAN se compromete com N fatias verificaveis',
      } as Record<string, string>,
      worktree: 'worktree isolada',
      exige: 'exige', nada: 'nada', muda: 'muda os blocos do modo', sim: 'sim', nao: 'nao',
      fecho: 'A variante muda como a thread NASCE. Verificacao e gates nao mudam.',
    },
    pulseCadencia: {
      umaTag: 'pulse cadencia: uma tag por vez',
      desconhecida: (tag: string, aceitas: string) => `pulse cadencia: tag desconhecida "${tag}"; use ${aceitas}`,
      trocaSemAutor: 'pulse.cadencia: informe quem trocou a cadencia',
      desconhecidaInterna: (tag: string) => `pulse.cadencia: tag desconhecida ${tag}`,
      descricoes: {
        '#OrkPulseOff': 'de 8 em 8 horas, as 08h, 16h e 00h', '#OrkPulseOn': 'de 2 em 2 horas',
        '#OrkPulseOn-15m': 'de 15 em 15 minutos', '#OrkPulseOn-30m': 'de 30 em 30 minutos',
        '#OrkPulseOn-60m': 'de hora em hora',
      } as Record<string, string>,
      texto: (descricao: string, tag: string, proxima: string) =>
        `Pulse ${descricao} (${tag}). Pergunta para você continua saindo na hora. Próximo resumo com novidade a partir de ${proxima}.`,
      trocada: (por: string, canal: string, quando: string) => `Trocada por ${por} (${canal}) em ${quando}.`,
      padrao: 'Nenhuma tag gravada: vale a cadência padrão.',
      responderUso: 'pulse responder exige --resposta-stdin e o envelope do ingresso autenticado',
      responderFormato: 'pulse responder: --formato telegram|terminal',
      responderReferencia: 'pulse responder: --em-resposta-a recebe o código da pergunta e o id da mensagem respondida (por exemplo NX4K:4521), ou outra, a palavra solta em reply a outra mensagem',
    },
    ledger: {
      usoStats: 'uso: ork ledger stats --desde 7d [--ate ISO] [--thread T] [--modo M] [--runtime R] [--json]',
      usoEstimate: 'uso: ork ledger estimate <thread-id> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P [--incerteza I]',
      uso: 'uso: ork ledger stats|estimate ...',
      estimativa: (thread: string, semIa: number, ia: number) =>
        `Estimativa PLAN registrada em ${thread}: sem IA ${semIa} h; IA sem Orkastery ${ia} h.`,
      periodo: (desde: string, ate: string, intervalo: string) => `Ledger stats  ${desde} ate ${ate} ${intervalo}`,
      sessoes: (threads: number, concluidas: number, despachos: number) =>
        `  threads/sessoes  ${threads} / ${concluidas} concluidas (${despachos} despachos)`,
      throughput: (ships: number, retries: number) => `  throughput       ${ships} ship(s); ${retries} retry(ies)`,
      execucao: (horas: string, medidas: number, ausentes: number) =>
        `  execucao         ${horas} h (${medidas} medidas; ${ausentes} ausentes)`,
      tokens: (total: number, input: number, cached: number, output: number) =>
        `  tokens           ${total} total; input ${input} (cached ${cached}); output ${output}`,
      semCobertura: 'sem cobertura',
      // GO-FIX 1: o travessao da base vira parenteses nas duas linguas (o catalogo nao leva U+2014).
      custo: (valor: string) => `  custo referencia ${valor} (estimativa por tarifa publica, nao gasto/fatura)`,
      espera: (horas: string, abertas: number) => `  espera humana    ${horas} h; ${abertas} aberta(s)`,
      semResposta: 'sem resposta medida',
      metaDentro: ' (dentro da meta de 5 min)', metaFora: ' (acima da meta de 5 min)',
      hitl: (pedidos: number, horas: string, mediana: string, meta: string, abertas: number, fora: number) =>
        `  HITL de conducao ${pedidos} pergunta(s); parado ${horas} h; mediana ${mediana}${meta}; ${abertas} aberta(s); texto fora da excecao ${fora}`,
      riscos: (total: number) => `  riscos evitados  ${total} gate(s) preventivo(s)`,
      estimativas: (total: number) => `  estimativas PLAN ${total} amostra(s)`,
      cobertura: (texto: string) => `  cobertura         ${texto}`,
      observacao: (texto: string) => texto,
    },
    produto: {
      portfolio: {
        opcaoAposentada: (opcao: string) => `portfolio.opcao-aposentada: --${opcao} era do Objective Envelope, aposentado na I-43, e o\n` +
          '  portfolio show nunca a leu. As duas vigas do envelope viraram propriedade de thread comum:\n' +
          '    ork thread new "<nome>" --modo <MODO> --exige-runtime-diferente\n' +
          '        o CHECK precisa de runtime que o GO nao usou\n' +
          '    ork thread new "<nome>" --modo <MODO> --done "<criterio> :: <comando>"\n' +
          '        criterio de pronto EXECUTAVEL, que vira claim e roda no ork verify',
        usoInspect: 'uso: ork portfolio inspect <id> --json',
        tipo: 'tipo deve ser product, project ou initiative',
        vazio: 'Portfólio vazio.',
        usoShow: 'uso: ork portfolio show <id>',
        naoEncontrada: (id: string) => `entidade ${id} não encontrada`,
        estado: (id: string, titulo: string, estado: string) => `${id}\n${titulo}\nEstado: ${estado}`,
        usoCreate: 'uso: ork portfolio create <product|project|initiative> <id> --title T [--parent ID]',
        desconhecido: (sub: string) => `subcomando desconhecido: portfolio ${sub}`,
      },
      creation: {
        identidade: 'creation.identity: payload não escolhe principal',
        usoStart: 'uso: ork creation start --input-file F --json',
        arquivoGrande: 'creation.input: arquivo excede limite',
        exigeId: 'creation exige id',
        versao: 'creation exige --expected-version inteiro positivo',
        desconhecido: 'subcomando creation desconhecido',
      },
      objective: (sub: string) =>
        `objective.aposentado: o Objective Envelope saiu do produto na I-43 (subcomando "${sub}").\n` +
        '  Ele descrevia um gate que nao bloqueava nada: das 137 threads do projeto, zero\n' +
        '  tinham creationOrigin, que era a unica via pela qual o despacho o consultava.\n' +
        '  As duas vigas que ele guardava viraram propriedade de thread comum:\n' +
        '    ork thread new "<nome>" --modo <MODO> --exige-runtime-diferente\n' +
        '        o CHECK precisa de runtime que o GO nao usou\n' +
        '    ork thread new "<nome>" --modo <MODO> --done "<criterio> :: <comando>"\n' +
        '        criterio de pronto EXECUTAVEL, que vira claim e roda no ork verify\n' +
        '  Os envelopes ja gravados continuam em .orkastery/objectives, intocados.',
      ci: {
        usoPrepare: 'uso: ork ci prepare <thread-id>', aviso: (linha: string) => `AVISO: ${linha}`,
        bundle: (arquivo: string) => `Bundle de CI: ${arquivo}`,
        usoRun: 'uso: ork ci run <thread-id> [--json] | ork ci run --bundle <arquivo> | ork ci run --branch <branch>',
        resultado: (ok: boolean, detalhe: string) => `${ok ? 'CI APROVADO' : 'CI REPROVADO'}: ${detalhe}`,
        sha: 'erro: ci status: --sha exige o sha completo, de 40 caracteres hexadecimais minusculos ' +
          '(git rev-parse HEAD); o check e consultado no commit exato, nunca por ref nem prefixo',
        usoStatus: 'uso: ork ci status --sha <sha de 40 caracteres> [--remoto origin]',
        status: (ok: boolean, detalhe: string) => `${ok ? 'CI VERDE' : 'CI NÃO LIBEROU'}: ${detalhe}`,
        desconhecido: (sub: string) => `subcomando desconhecido: ci ${sub}`,
        // GO-FIX 1: o lint do bundle nasce em pt-BR, que e o que vai ao ledger, e a impressao o remonta no locale do comando.
        anteriorAoLint: (linha: string) => `${linha} (claim anterior ao lint: so aviso)`,
        worktreeSumiu: (worktree: string) => `a worktree ${worktree} da thread nao existe mais; o bundle vai para a raiz do projeto`,
        lintRecusado: (recusas: string) =>
          `claims.lint: o bundle nao foi gerado; retire a claim e registre de novo com o comando focado:\n  ${recusas}`,
      },
    },
  },
  setup: SETUP_PT_BR,
  projetos: PROJETOS_PT_BR,
  init: {
    foraDoRepositorio: (dir: string) => `init.fora-do-repositorio: ${dir} não está num repositório git; nada foi criado. ` +
      'Entre no repositório do projeto (ou crie um com git init e o primeiro commit) e rode ork init de novo.',
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
  cli: {
    erro: (mensagem) => `error: ${mensagem}`,
    subcomandoDesconhecido: (comando, sub) => sub === undefined ? `missing subcommand: ${comando}` : `unknown subcommand: ${comando} ${sub}`,
    manifestoNaoEncontrado: (nome, dir) => `\`${nome}\` not found in ${dir} or any parent directory; run \`ork init\` first.`,
    receiptVerifiersUso: 'usage: ork receipt-verifiers --json',
    activationUso: 'usage: ork activation plan|status|enable|disable',
    masterDigestUso: 'usage: ork master digest <enviar|preview|responder>',
    masterRatificarUso: 'the response must be ratificar <thread> <signature> <class>',
    masterSelecaoUso: 'the selection must be thread:signature',
  },
  preflight: PREFLIGHT_EN,
  maestro: MAESTRO_EN,
  horario: {
    brasilia: 'Brasília time',
    legendaBrasilia: 'Times in Brasília time.',
    legenda: (rotulo) => `Times in ${rotulo}.`,
    duracaoDesconhecida: 'unknown time',
    menosDeUmMin: 'less than 1 min',
    jaLiberou: 'already released',
    emMinutos: (n) => `in ${n} min`,
    emHoras: (h, mm) => `in ${h}h${mm}`,
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
      'fonte da DSN': 'DSN source',
      'DSN no ambiente': 'DSN in environment',
      'chave de embedding': 'embedding key',
      'fila de rate limit': 'rate limit queue',
      'estado do projeto': 'project state',
      'contas por runtime': 'accounts per runtime',
      'separacao da conducao': 'conduction account separation',
      'governanca de sessoes': 'session governance',
      'dono do .git': '.git owner',
      'onboarding memoria': 'onboarding memory',
      'onboarding fuso': 'onboarding time zone',
      'rede': 'network',
      'sandbox do codex': 'codex sandbox',
      'permissoes do estado': 'state permissions',
      'pasta privada': 'private folder',
      'cadencia do pulse no cron': 'pulse cron cadence',
      'transporte do pulse': 'pulse transport',
      'fabrica compartilhada': 'shared factory',
      'pasta das worktrees': 'worktree folder',
      'forja identidade': 'forge identity',
      'forja alcance': 'forge reach',
      'forja tls': 'forge TLS',
      'forja subcaminho': 'forge base path',
      'forja cli': 'forge CLI',
      'forja login': 'forge login',
      'forja servidor': 'forge server',
      'forja escopo': 'forge token scope',
      'forja projeto': 'forge project',
      'forja capacidades': 'forge capabilities',
    },
    instaleNode: 'install Node 20 or later',
    gitAusente: 'not found on PATH',
    instaleGit: 'install git',
    securityScanDocker: 'Docker available: the security scan tools run in containers',
    securityScanNativo: 'no Docker; every loop tool has an accepted native binary',
    securityScanSemFerramenta: (lista) => `without Docker these would be unavailable: ${lista}`,
    securityScanCorrecao: (nativos) =>
      `install Docker (CLI and a running daemon); alternatively install the native binaries at the catalog version: ${nativos}. pip-audit and govulncheck only run in Docker`,
    branch: (branch, semCommit) => `branch ${branch}${semCommit ? ' (no commit)' : ''}`,
    foraDeRepo: 'outside a git repository',
    rodeDentroDeRepo: 'run `ork` inside a git repository',
    versaoDesconhecida: 'unknown version',
    codexAusenteUsado: '`codex` binary not on PATH (the project dispatches through it: see codex dispatch)',
    codexAusenteOpcional: '`codex` binary not on PATH (optional: claude-bg is the default runtime)',
    instaleCodex: 'to dispatch through codex, install the Codex CLI and sign in with `codex login`',
    sandboxOk: '`codex sandbox true` runs on this machine',
    sandboxFalhou: (detalhe) => `probe \`codex sandbox true\` failed: ${detalhe}`,
    sandboxCorrecao: (confirmar) => 'install the system bubblewrap package (the bundled bwrap cannot create a user namespace ' +
      `on this machine) or declare \`runtime.sandbox: danger-full-access\` knowing the risk, and confirm on this machine with \`${confirmar}\``,
    manifestoAusente: (nome, dir) => `${nome} not found in ${dir} or any parent directory`,
    rodeInit: 'ork init',
    entreNoRepoEInit: 'enter the project repository (or create one with `git init` and a first commit) and run `ork init`',
    corrijaManifesto: 'fix the manifest and run `ork doctor` again',
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
    estadoCorrecao: '`ork init` creates the state directory',
    claudeSemLogin: (detalhe, auth) => `${detalhe}; ${auth}: dispatch through claude-bg would fail`,
    claudeLoginPago: 'sign in with a subscription (claude.ai) in `claude`, without an API key or a cloud provider',
    claudeLogin: 'run `claude` once, sign in with your subscription (/login) and accept trust in the project directory; ' +
      'or create a profile with `ork accounts add <id> --runtime claude-bg --dir <folder>`',
    onboardingPendente: (n, etapas) => `${n} step(s) pending: ${etapas}`,
    onboardingCompleto: '9 steps answered',
    foraDaRede: 'outside the network; `ork network entrar` puts this machine on your network',
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
    embeddingNone: 'memory.embedding with provider none: semantic search is off',
    semPerfis: 'no profile configured: each runtime dispatches through the process environment',
    manifestoForaDoRepo: (nome, caminho, topo) =>
      `the ${nome} that was read sits outside this repository (${caminho}): ork runs the project in that folder, not the one in ${topo}`,
    manifestoForaDoRepoCorrecao: (topo) => `run \`ork init\` at the root of this repository (${topo}); if the outside manifest ` +
      'was created by mistake, delete it together with the AGENTS.md and the .orkastery/ next to it',
    storeInvalido: (erro) => `invalid profile store: ${erro}`,
    storeCorrecao: 'the store lives in .orkastery/private/runtime-profiles.json (file 0600, folder 0700)',
    contaPaga: 'paid provider (never dispatches)',
    contaInconclusiva: 'login check inconclusive',
    contaSemLogin: 'not signed in',
    contaPronta: 'ready',
    contaFora: (estado, ate) => `${estado}${ate ? ` until ${ate}` : ''}`,
    contasCorrecao: '`ork accounts check` marks the profiles (sem-auth, provider-pago); `ork accounts add` redoes the subscription ' +
      'login through the CLI itself, never copying a credential',
    condutorCompartilha: (runtime, conta, fases) =>
      `the LLM conductor (${runtime}, ${conta}) shares its account with live phases: ${fases}`,
    condutorSeparado: (runtime, conta) =>
      `the LLM conductor (${runtime}, ${conta}) does not share its account with a live phase`,
    contaDoAmbiente: 'process environment',
    condutorCompartilhaCorrecao: 'run the conductor on another account or leave quota reaction to `ork conducao batida`',
    embeddingPago: (variavel) => `memory.embedding.api_key_env declares ${variavel}, a name from the paid provider list`,
    embeddingPagoCorrecao: 'use a key dedicated to Orkastery, with its own name, for example ORKASTERY_EMBEDDING_API_KEY',
    embeddingSemVariavel: (provider) => `memory.embedding with provider ${provider} and no api_key_env`,
    embeddingSemVariavelCorrecao: 'declare in memory.embedding.api_key_env the NAME of the variable that holds the dedicated key',
    embeddingRecusada: (variavel) =>
      `${variavel} has a refused value: it looks like a URL, a DSN or text with spaces (the value is never printed)`,
    embeddingRecusadaCorrecao: (variavel) => `check that ${variavel} holds the dedicated key, not another credential`,
    embeddingPresente: (variavel, provider, modelo) => `${variavel} present in the environment (value never printed); ${provider} ${modelo}`,
    embeddingAusente: (variavel) =>
      `${variavel} missing from the environment: semantic search uses the local fallback or falls back to FTS; the regime does not change`,
    embeddingAusenteCorrecao: (variavel) =>
      `export ${variavel} with the key dedicated to Orkastery (with a credit limit in the provider dashboard)`,
    donoOutro: (total, dir, uids, uid, exemplos, parcialDe) =>
      `${total} entry(ies) in ${dir} owned by another user (uid ${uids}; the repository owner is ${uid}): ${exemplos}; ` +
      `the owner's git cannot write to them, so fetch and commit fail${parcialDe !== null ? ` (partial check: more than ${parcialDe} entries)` : ''}`,
    donoCorrecao: (comando) => `${comando} (ork never runs this on its own)`,
    donoParcial: (teto, dir) => `more than ${teto} entries in ${dir}: partial check, no other owner so far`,
    donoParcialCorrecao: (comando) => `check the rest with: ${comando}`,
    donoOk: (vistos, dir, uid) => `${vistos} entries in ${dir} owned by the repository owner (uid ${uid})`,
    entrevistaMemoria: (escolha, declarado) => `the interview chose ${escolha}; the manifest declares ${declarado}`,
    entrevistaMemoriaCorrecao: (escolha) => `review memory.mode: ${escolha} in orkastery.yaml; the interview does not change the manifest`,
    entrevistaFuso: (informado, declarado, chave) =>
      `the interview gave ${informado}; ${declarado ? `the manifest declares ${declarado}` : `the manifest has no ${chave}`}`,
    entrevistaFusoCorrecao: (chave, informado) =>
      `review ${chave}: "${informado}" in orkastery.yaml; the interview does not change the manifest`,
    claudeOpcional: (fallback) =>
      '`claude` binary not on PATH (optional for phases: no block of the allowed modes dispatches through claude-bg' +
      (fallback ? `; the fallback of ${fallback.blocos} block(s) lands on it and would fail: ${fallback.texto}` : '') +
      '; `ork audit run` still dispatches through it)',
    claudeOpcionalCorrecao: 'to dispatch through claude-bg (and run `ork audit run`), install Claude Code and make sure `claude` is on PATH',
    claudeAusente: (principal) => '`claude` binary not on PATH' +
      (principal ? `; ${principal.blocos} block(s) of the allowed modes dispatch through it (${principal.texto})` : ''),
    claudeAusenteCorrecao: 'install Claude Code and make sure `claude` is on PATH; with Codex only, move each block to it ' +
      '(`ork setup <mode> --bloco N --runtime codex --model <model>`) or remove the mode from conduction.allowed_modes ' +
      '(keep conduction.default_mode among the allowed ones)',
    origemDoCodex: (pelaAdapter, blocos) =>
      [pelaAdapter ? 'runtime.adapter: codex' : '',
        blocos ? `${blocos.blocos} block(s) of the allowed modes on codex (${blocos.texto})` : ''].filter(Boolean).join(' and '),
    codexForaNoDespacho: (origem) => `${origem}, but the \`codex\` binary is not on PATH`,
    codexSandboxQuebrado: (origem, sandbox) =>
      `${origem} with sandbox "${sandbox}", but the sandbox does not run on this machine (the agent would narrate success without running anything)`,
    codexSandboxOk: (origem, sandbox) => `${origem} with sandbox "${sandbox}"`,
    codexSemConfirmacao: (origem, sandbox) => `${origem} with sandbox "${sandbox}" requested by \`orkastery.yaml\` but not confirmed ` +
      'on this machine: dispatch is refused with `runtime.sandbox-nao-confirmado`',
    codexForaNoDespachoCorrecao: 'install the Codex CLI and sign in with `codex login` (subscription, never an API key)',
    codexSandboxQuebradoCorrecao: (confirmar) =>
      `install the system bubblewrap, or declare \`runtime.sandbox: danger-full-access\` knowing the risk, and confirm on this machine with \`${confirmar}\``,
    codexSemConfirmacaoCorrecao: (confirmar) => `\`${confirmar}\` (or set the manifest back to \`workspace-write\`)`,
    fabricaPedida: '`orkastery.yaml` asks for `fabrica.compartilhada: true` and this machine has not joined: nothing from this machine is published to the remote',
    fabricaPedidaCorrecao: '`ork fabrica entrar`, if this machine should publish its snapshot to the project remote',
    pastaForaDaRaiz: (dir) =>
      `\`worktree.dir\` "${dir}" points outside the project root and this machine has not confirmed it: worktree creation is refused with \`worktree.dir-fora-da-raiz\``,
    pastaForaDaRaizCorrecao: (confirmar) => `\`${confirmar}\`, or move \`worktree.dir\` back inside the project`,
    fonteDaMemoria: (fonte, divergente) => `${fonte}${divergente ? ' (divergent worktree copy kept)' : ''}`,
    regimeDegradado: (motivo, detalhe) => `orkmind requested, files in effect (${motivo}): ${detalhe}`,
    regimeOrkmind: (tenant, variavel) => `orkmind active in tenant "${tenant}" through the variable ${variavel}`,
    regimeOrkmindPorArquivo: (tenant, arquivo) => `orkmind active in tenant "${tenant}" through the file \`${arquivo}\``,
    dsnDaVariavel: (variavel) => `environment variable ${variavel}, present (value never printed)`,
    dsnVariavelAusente: (variavel) => `environment variable ${variavel} missing: memory falls back to files`,
    dsnVariavelAusenteCorrecao: (variavel) => `export ${variavel} with the DSN of the tenant's own database, ` +
      'or pass it through `memory.database_url_file` (a 0600 file in `~/.orkastery/segredos/`)',
    dsnDoArquivo: (rotulo, permissao) =>
      `file \`${rotulo}\`, owned by the user running ork, permission ${permissao}, one line (value never printed)`,
    dsnArquivoFalhou: (rotulo, motivo, causa) =>
      `file \`${rotulo}\` refused (\`${motivo}\`): ${causa}; memory falls back to files, with no other source`,
    dsnCausa: (causa, permissao) => (({
      forma: '`memory.database_url_file` outside the form `~/.orkastery/segredos/<name>` (value omitted)',
      raiz: 'the ork user folder must be an absolute path without `..`, inside the user home (`HOME`)',
      'nao-existe': 'does not exist',
      'nao-abre': 'could not be opened for reading',
      pasta: 'the path to the secrets folder has a symbolic link or something that is not a folder',
      'dono-da-pasta': 'the ork user folder is not owned by the user running ork',
      link: 'symbolic link not accepted',
      'nao-e-arquivo': 'not a regular file',
      plataforma: 'this platform checks neither owner nor permission',
      dono: 'the owner is not the user running ork',
      permissao: `permission ${permissao}, neither 0600 nor 0400`,
      tamanho: 'larger than 4 KiB',
      vazio: 'empty',
      codificacao: 'not UTF-8 text',
      linhas: 'more than one line',
      controle: 'control character',
      'nome-valor': 'NAME=value environment file format; write only the DSN',
      esquema: 'not a DSN with a scheme (such as `postgresql://`)',
      espaco: 'whitespace inside the DSN',
      leitura: 'could not be read',
    }) as Record<string, string>)[causa] ?? causa,
    dsnArquivoCorrecao: (motivo, rotulo) => motivo === 'dsn.arquivo-ausente'
      ? `write the DSN of the tenant's own database to \`${rotulo}\`, on one line and with permission 0600, without the shell history: ` +
        `\`(umask 077; cat > ${rotulo})\``
      : motivo === 'dsn.arquivo-inseguro'
        ? `make \`${rotulo}\` a file owned by the user running ork, in a folder of theirs, with \`chmod 600 ${rotulo}\``
        : `rewrite \`${rotulo}\` as a regular file in a regular secrets folder, inside the user home and with no symbolic ` +
          'link on the path, with only the DSN (`scheme://...`), on one line and without a NAME= prefix',
    dsnNaSessao: (doProjeto, comSenha) =>
      `in this dispatched session's environment, the agent reads with \`env\`: ${[...doProjeto.map((n) => `${n} (project DSN)`),
        ...comSenha.map((n) => `${n} (URL with password)`)].join(', ')} (value never printed)`,
    dsnNoProcesso: (nomes) =>
      `the file's DSN is also in this process environment, in ${nomes.join(', ')}: whoever inherits this environment sees it (value never printed)`,
    dsnSessaoLimpa: 'no DSN and no URL with password in this dispatched session environment',
    dsnProcessoLimpo: "the file's DSN is not in this process environment",
    dsnNoAmbienteCorrecao: 'remove these variables from the environment the host passes to agents (in Hermes, `~/.hermes/.env`), ' +
      'with a backup, and pass the project DSN through `memory.database_url_file`',
    filaEscaladoCorrecao: 'request escalated past the retry.max_tentativas limit: `ork retry list` and `ork gate request <thread>`',
    filaEsperaCorrecao: '`ork retry resume` picks up what is already released',
    governanca: (g) =>
      `${g.usuario}, Claude and Codex, global with history: ${g.total} sessions; ` +
      `${g.semThread} without a thread; ${g.ambiguas} ambiguous; ` +
      `inventory ${g.ok ? 'valid' : 'INCOMPLETE (zero not proven)'}` +
      (g.ausentes.length ? `; source missing: ${g.ausentes.join(', ')}` : ''),
    governancaCorrecao: '`ork sessions --global --all --json`; adopt unlinked identities with `ork sessions adopt <id>`',
    umaskNaoMedido: 'process umask not measured on this platform',
    umaskOk: (umask) => `umask ${umask} denies write to group and others`,
    umaskAberto: (umask) =>
      `umask ${umask} allows write by group or others: whatever the runtime creates will be refused by the sensor (bits 0o022)`,
    umaskCorrecao: '`umask 022` (or 077) in the shell that runs ork and the runtimes',
    estadoNaoDiretorio: (dir) => `${dir} is not a real directory`,
    estadoAberto: (dir, modo) => `${dir} with mode ${modo}: group or others can write to the state`,
    estadoComModo: (dir, modo) => `${dir} with mode ${modo}`,
    privadaAusente: (dir) => `${dir} missing: created on demand with 0700`,
    privadaAberta: (dir, modo) => `${dir} must be a 0700 directory owned by the user (mode ${modo}): HITL receipts and profiles refuse it`,
    privadaOk: (dir) => `${dir} with mode 0700`,
    cronSemComando: 'crontab command missing on this machine',
    cronFalhou: (detalhe) => `\`crontab -l\` failed: ${detalhe}`,
    cronSaiu: (codigo) => `\`crontab -l\` exited ${codigo}`,
    cronAdicione: (linha) => `add to the crontab (\`crontab -e\`), as in the \`monitor/pulse.cron\` template: ${linha}`,
    cronSemLeitura: (motivo) => `pulse-host.json present, but there is no crontab to read (${motivo}): the scan never runs`,
    cronSemLinha: (script) => `pulse-host.json present, and no crontab line runs ${script}: the summary never goes out`,
    cronOk: (linhas) => `scan in cron every 15 minutes or less (${linhas} line(s))`,
    cronRitmo: (intervalo) => intervalo === null ? 'on a schedule the doctor cannot read'
      : intervalo === 60 ? 'every hour' : `every ${intervalo} minutes`,
    cronLento: (ritmo, linha) => `the pulse scan runs ${ritmo} (\`${linha}\`): the cadence by tag (RM-039) needs 15 minutes`,
    cronTroque: (linha) => `replace the crontab line (\`crontab -e\`) with: ${linha}`,
    batidaAusente: (abertas, detalhe) =>
      `${abertas} open thread(s) and no scan beat: ${detalhe}; the factory stops and nobody knows`,
    batidaSemLeitura: (motivo) => `no crontab to read (${motivo})`,
    batidaSemLinha: (script) => `no crontab line runs ${script} for this project`,
    batidaInstale: (comando) => `\`${comando}\` (installs the \`monitor/pulse.cron\` template line in this machine's crontab)`,
    batidaPeloLog: (minutos) => `no crontab line, but the scan ran ${minutos} min ago (hitl.log): the beat comes from another scheduler`,
    batidaAtrasada: (minutos, linhas) =>
      `the scan is in the crontab (${linhas} line(s)), but the last round was ${minutos} min ago (hitl.log): the beat stopped`,
    batidaAtrasadaCorrecao: '`ork fabrica batida status` (the last round tells the code and the detail; check the cron, the script and the line PATH)',
    transporteOk: (host, quando) => `last delivery through ${host} at ${quando}`,
    transporteDesvio: (falhou, host, quando) =>
      `transport ${falhou} failed at ${quando}, and the summary went out through ${host} (the other configured host)`,
    transporteFalhou: (quando, tentativas) =>
      `the summary of ${quando} went out through no configured transport (${tentativas}): the news stays kept for the next beat`,
    transporteCorrecao: 'check the executable and the target in `.orkastery/monitor/pulse-host.json` (the host adapter: `openclaw message send` or the Hermes `ork-pulse-enviar.py`)',
    redeSaiu: 'outside the network (left with `ork network sair`)',
    redeMembroHerdado: 'member inherited from the factory',
    redeMembro: 'member',
    redeCasa: (casa) => `home ${casa}`,
    redeSemCasa: 'home not recorded yet',
    redeBatida: (quando, idade) => `last heartbeat ${quando} (${idade} ago)`,
    redeSemBatida: 'no heartbeat published',
    redeFalha: (quando, origem, erro) => `last failure ${quando}${origem ? ` (${origem})` : ''}: ${erro}`,
    redeSemDetalhe: 'no detail',
    redeSemFalha: 'no failure in rede.log',
    redeParadaCorrecao: 'the heartbeat comes from the pulse: check the pulse cron and run `ork network publicar`',
    redeSemCasaCorrecao: 'the network home does not exist yet: the owner runs `ork network entrar`, which creates the private ' +
      'repository; or `ork network sair`, to take this machine out of the network',
    redeSemForjaCorrecao: 'sign in to the forge (`gh auth login` or `glab auth login`) and run `ork network publicar`',
    redePublicaCorrecao: 'make the network home private on the forge; nothing is published to a public repository',
    redeNomeCorrecao: 'pick another name with `ork network entrar --maquina NOME`, or take this one with `--forcar`',
    redeOutraCorrecao: '`ork network status` shows the gaps; `ork network publicar` tries again',
    grafo: {
      recusa: (motivo) =>
        `${motivo}: \`ork grafo indexar\` refuses on this installation, and without the index the queries and the ork_grafo_* tools refuse too`,
      soEsm: (versaoDoNode) => `micromark is ESM only, and this Node (${versaoDoNode}) cannot load it with require: use Node 20.19, ` +
        '22.12 or newer, without the --no-experimental-require-module option (on the command line or in NODE_OPTIONS)',
      reinstale: (fixada) => `reinstall the global ork, which brings the analyzers as dependencies: npm install -g @orkastery/cli${fixada}` +
        ' (installed inside a project or through npx, npm leaves the analyzers outside the ork package, and the graph refuses them)',
    },
    fonteDaSessao: (origem) => origem.replace(/\(conta do processo\)$/, '(process account)').replace(/\(perfil ([^)]+)\)$/, '(profile $1)'),
  },
  onboarding: ONBOARDING_EN,
  thread: THREAD_EN,
  phase: PHASE_EN,
  ajuda: AJUDA_EN,
  verify: VERIFY_EN,
  ship: SHIP_EN,
  retry: RETRY_EN,
  master: MASTER_EN,
  pulse: PULSE_EN,
  roadmap: ROADMAP_EN,
  gerados: GERADOS_EN,
  worktree: WORKTREE_EN,
  estado: ESTADO_EN,
  securityScan: SECURITY_SCAN_EN,
  claims: CLAIMS_EN,
  decisao: DECISAO_EN,
  accounts: ACCOUNTS_EN,
  network: NETWORK_EN,
  reservas: RESERVAS_EN,
  docs: DOCS_EN,
  adapter: ADAPTER_EN,
  prompts: PROMPTS_EN,
  conhecimento: CONHECIMENTO_EN,
  conducao: CONDUCAO_EN,
  grafo: GRAFO_EN,
  audit: AUDIT_EN,
  forja: FORJA_EN,
  operacao: {
    restante: OPERACAO_RESTANTE_EN,
    modos: {
      titulo: 'Conduction modes (put the #TAG in the request to the orchestrator)',
      cabecalho: ['#TAG', 'BLOCKS', 'PAUSES', 'CYCLE'],
      marcaDaPausa: '* = block that pauses and waits for a human verdict',
      detalhe: 'Details by mode:',
      slug: 'session slugs',
      pausas: 'pauses',
      nenhuma: 'none',
      uso: 'use',
      pausaSobre: {
        objetivo: 'goal', plano: 'plan', implementacao: 'implementation', evidencias: 'evidence',
        push: 'push', score: 'score', premissas: 'assumptions',
        'evidencias, com autorizacao antecipada de push': 'evidence, with push authorized in advance',
      },
      recomendado: {
        classic: 'The default: careful assumptions with reliable delivery',
        maestro: 'Clear, agile solutions without many risks or tradeoffs',
        auto: 'Smaller solutions, docs, studies, research, configuration, audits, and migrations',
        fast: 'A small, clear request measured in minutes: GO only, no ceremony; push still requires authorization',
      },
      regra: 'CENTRAL RULE: the mode loosens pauses, NEVER verification.',
      migracao: {
        nada: 'Nothing to migrate: this project configuration has no retired mode.',
        simulacao: 'Simulation (`--dry-run`): nothing was written.',
        aplicada: 'Migration applied.',
        de: 'from', para: 'to', backup: 'backup',
        historico: 'No history was changed: threads, ledgers, and receipts in a retired mode stay as they are.',
      },
    },
    ciclos: {
      titulo: 'Cycle variants (`ork thread new --ciclo <variant>`)',
      descricoes: {
        greenfield: 'Start from scratch: requires an isolated worktree based on the manifest base',
        'merge-branch': 'Start from an existing branch (`--branch`) without creating a new branch',
        'goal-plan': 'Merge GOAL and PLAN into one block: one less pause when the mode separates them',
        gap: 'Gap analysis: no GO or SHIP; publish the gap as a gap',
        'feature-xl-faseada': 'Large feature in slices: PLAN commits to N verifiable slices',
      },
      worktree: 'isolated worktree',
      exige: 'requires', nada: 'nothing', muda: 'changes the mode blocks', sim: 'yes', nao: 'no',
      fecho: 'The variant changes how the thread STARTS. Verification and gates do not change.',
    },
    pulseCadencia: {
      umaTag: 'pulse cadencia: provide one tag at a time',
      desconhecida: (tag, allowed) => `pulse cadencia: unknown tag "${tag}"; use ${allowed}`,
      trocaSemAutor: 'pulse.cadencia: provide who changed the cadence',
      desconhecidaInterna: (tag) => `pulse.cadencia: unknown tag ${tag}`,
      descricoes: {
        '#OrkPulseOff': 'every 8 hours, at 08:00, 16:00, and 00:00', '#OrkPulseOn': 'every 2 hours',
        '#OrkPulseOn-15m': 'every 15 minutes', '#OrkPulseOn-30m': 'every 30 minutes',
        '#OrkPulseOn-60m': 'hourly',
      },
      texto: (description, tag, next) =>
        `Pulse ${description} (${tag}). Questions for you still go out immediately. Next summary with news starts at ${next}.`,
      trocada: (by, channel, when) => `Changed by ${by} (${channel}) at ${when}.`,
      padrao: 'No saved tag: the default cadence applies.',
      responderUso: 'pulse responder requires --resposta-stdin and the authenticated ingress envelope',
      responderFormato: 'pulse responder: --formato telegram|terminal',
      responderReferencia: 'pulse responder: --em-resposta-a takes the question code and the id of the replied message (for example NX4K:4521), or outra, the bare word in reply to another message',
    },
    ledger: {
      usoStats: 'usage: ork ledger stats --desde 7d [--ate ISO] [--thread T] [--modo M] [--runtime R] [--json]',
      usoEstimate: 'usage: ork ledger estimate <thread-id> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P [--incerteza I]',
      uso: 'usage: ork ledger stats|estimate ...',
      estimativa: (thread, noAi, aiWithoutOrk) =>
        `PLAN estimate recorded in ${thread}: no AI ${noAi} h; AI without Orkastery ${aiWithoutOrk} h.`,
      periodo: (from, to, interval) => `Ledger stats  ${from} to ${to} ${interval}`,
      sessoes: (threads, completed, dispatches) =>
        `  threads/sessions ${threads} / ${completed} completed (${dispatches} dispatches)`,
      throughput: (ships, retries) => `  throughput       ${ships} ship(s); ${retries} retry(ies)`,
      execucao: (hours, measured, missing) => `  execution        ${hours} h (${measured} measured; ${missing} missing)`,
      tokens: (total, input, cached, output) => `  tokens           ${total} total; input ${input} (cached ${cached}); output ${output}`,
      semCobertura: 'no coverage',
      custo: (value) => `  reference cost   ${value} (estimate from public rates, not spend or billing)`,
      espera: (hours, open) => `  human wait       ${hours} h; ${open} open`,
      semResposta: 'no measured response',
      metaDentro: ' (within the 5 min target)', metaFora: ' (above the 5 min target)',
      hitl: (requests, hours, median, target, open, outside) =>
        `  conduction HITL ${requests} question(s); stopped ${hours} h; median ${median}${target}; ${open} open; text outside exception ${outside}`,
      riscos: (total) => `  risks prevented  ${total} preventive gate(s)`,
      estimativas: (total) => `  PLAN estimates   ${total} sample(s)`,
      cobertura: (text) => `  coverage         ${text}`,
      observacao: (text) => text
        .replace(/sessao\(oes\) sem medicao de tokens$/, 'session(s) without token measurement')
        .replace(/sessao\(oes\) com tokens, mas sem tarifa de referencia$/, 'session(s) with tokens but no reference rate')
        .replace(/linha\(s\) de ledger corrompida\(s\) ignorada\(s\)$/, 'corrupt ledger line(s) ignored'),
    },
    produto: {
      portfolio: {
        opcaoAposentada: (option) => `portfolio.opcao-aposentada: --${option} belonged to the Objective Envelope, retired in I-43, and\n` +
          '  portfolio show never read it. The envelope\'s two beams became regular thread properties:\n' +
          '    ork thread new "<name>" --modo <MODE> --exige-runtime-diferente\n' +
          '        CHECK requires a runtime that GO did not use\n' +
          '    ork thread new "<name>" --modo <MODE> --done "<criterion> :: <command>"\n' +
          '        an EXECUTABLE done criterion that becomes a claim and runs in ork verify',
        usoInspect: 'usage: ork portfolio inspect <id> --json',
        tipo: 'type must be product, project, or initiative',
        vazio: 'Portfolio is empty.',
        usoShow: 'usage: ork portfolio show <id>',
        naoEncontrada: (id) => `entity ${id} not found`,
        estado: (id, title, status) => `${id}\n${title}\nStatus: ${status}`,
        usoCreate: 'usage: ork portfolio create <product|project|initiative> <id> --title T [--parent ID]',
        desconhecido: (sub) => `unknown subcommand: portfolio ${sub}`,
      },
      creation: {
        identidade: 'creation.identity: payload cannot choose the principal',
        usoStart: 'usage: ork creation start --input-file F --json',
        arquivoGrande: 'creation.input: file exceeds the limit',
        exigeId: 'creation requires an id',
        versao: 'creation requires a positive integer --expected-version',
        desconhecido: 'unknown creation subcommand',
      },
      objective: (sub) =>
        `objective.aposentado: the Objective Envelope left the product in I-43 (subcommand "${sub}").\n` +
        '  It described a gate that blocked nothing: of the project\'s 137 threads, zero\n' +
        '  had creationOrigin, the only path through which dispatch consulted it.\n' +
        '  Its two beams became regular thread properties:\n' +
        '    ork thread new "<name>" --modo <MODE> --exige-runtime-diferente\n' +
        '        CHECK requires a runtime that GO did not use\n' +
        '    ork thread new "<name>" --modo <MODE> --done "<criterion> :: <command>"\n' +
        '        an EXECUTABLE done criterion that becomes a claim and runs in ork verify\n' +
        '  Existing envelopes remain untouched in .orkastery/objectives.',
      ci: {
        usoPrepare: 'usage: ork ci prepare <thread-id>', aviso: (line) => `WARNING: ${line}`,
        bundle: (file) => `CI bundle: ${file}`,
        usoRun: 'usage: ork ci run <thread-id> [--json] | ork ci run --bundle <file> | ork ci run --branch <branch>',
        resultado: (ok, detail) => `${ok ? 'CI PASSED' : 'CI FAILED'}: ${detail}`,
        sha: 'error: ci status: --sha requires the full 40-character lowercase hexadecimal SHA ' +
          '(git rev-parse HEAD); the check is queried at the exact commit, never by ref or prefix',
        usoStatus: 'usage: ork ci status --sha <40-character sha> [--remoto origin]',
        status: (ok, detail) => `${ok ? 'CI GREEN' : 'CI NOT CLEARED'}: ${detail}`,
        desconhecido: (sub) => `unknown subcommand: ci ${sub}`,
        anteriorAoLint: (line) => `${line} (claim predates the lint: warning only)`,
        worktreeSumiu: (worktree) => `the thread worktree ${worktree} no longer exists; the bundle goes to the project root`,
        lintRecusado: (refusals) =>
          `claims.lint: the bundle was not generated; withdraw the claim and register it again with the focused command:\n  ${refusals}`,
      },
    },
  },
  setup: SETUP_EN,
  projetos: PROJETOS_EN,
  init: {
    foraDoRepositorio: (dir) => `init.fora-do-repositorio: ${dir} is not inside a git repository; nothing was created. ` +
      'Enter the project repository (or create one with `git init` and a first commit) and run `ork init` again.',
    jaExiste: (caminho) => `Manifest already exists: ${caminho}`,
    nadaSobrescrito: 'Nothing was overwritten. Use `--force` to regenerate.',
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
    proximoPasso: 'Next step: `ork doctor`; then `ork onboarding` to run the project interview.',
  },
};

const CATALOGO: Record<Locale, Mensagens> = { 'pt-BR': PT_BR, en: EN };

/** As mensagens do locale pedido, ou do ativo. */
export function msg(locale: Locale = ativo): Mensagens {
  return CATALOGO[locale];
}

/**
 * D14: erro cujo texto vem do catalogo. Ele nasce no locale ativo (dentro de `comLocale('pt-BR', ...)`,
 * em pt-BR, como o que la se grava), e a entrada do CLI o remonta no locale do comando ao imprimir.
 */
export class ErroDoCatalogo extends Error {
  constructor(readonly montar: (m: Mensagens) => string) {
    super(montar(msg()));
  }
}

/** A mensagem de um erro para a pessoa: a do catalogo no locale ativo; as demais como vieram. */
export function mensagemDoErro(e: unknown): string {
  return e instanceof ErroDoCatalogo ? e.montar(msg()) : e instanceof Error ? e.message : String(e);
}

/**
 * F3b (D3): o texto de um erro para guardar num resultado que o comando coberto imprime depois. O do catalogo e
 * registrado para a remontagem, como `textoDoCatalogo`; os demais saem como vieram.
 */
export function textoDoErro(e: unknown): string {
  return e instanceof ErroDoCatalogo ? textoDoCatalogo(e.montar) : e instanceof Error ? e.message : String(e);
}

/** Monta um texto do catalogo a partir das mensagens de um locale. */
export type Montador = (m: Mensagens) => string;

/** G2 e D1 da F2b: os montadores dos textos que o comando coberto guardou num resultado, pelo texto. */
let remontagem: Map<string, Montador> | null = null;

/**
 * Liga o registro dos montadores (o CLI, nos comandos cobertos) ou o desliga (o `main`, no comeco de cada
 * chamada). Desligado, nada se guarda: o servidor MCP e o cron nao acumulam texto.
 */
export function ligarRemontagem(ligada: boolean): void {
  remontagem = ligada ? new Map() : null;
}

/**
 * O texto no locale ativo. No escopo da gravacao ele sai em pt-BR, como o ledger e o `--json` o guardam;
 * com o registro ligado, o montador fica guardado para a impressao remonta-lo no locale do comando.
 */
export function textoDoCatalogo(montar: Montador): string {
  const texto = montar(msg());
  remontagem?.set(texto, montar);
  return texto;
}

/**
 * F3b: o montador registrado de um texto do catalogo, ou um que devolve o texto como veio. Serve ao erro que embute um
 * texto ja montado: o `ErroDoCatalogo` e remontado na entrada do CLI depois que o registro foi desligado, entao ele
 * guarda o montador do texto de dentro no momento em que nasce.
 */
export function montadorDe(texto: string): Montador {
  return remontagem?.get(texto) ?? (() => texto);
}

/** O texto como a pessoa o le no locale ativo: o que veio do catalogo e remontado; o resto sai como veio. */
export function remontar(texto: string): string {
  const montar = remontagem?.get(texto);
  return montar ? montar(msg()) : texto;
}

/** Nome de check como o texto o mostra no locale ativo. */
export function nomeDoCheck(nome: string, locale: Locale = ativo): string {
  return CATALOGO[locale].doctor.nomes[nome] ?? nome;
}

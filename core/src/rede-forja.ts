/**
 * RM-053: a forja da pessoa (GitHub pelo `gh`, GitLab pelo `glab`) atras de uma interface so.
 *
 * D4: a identidade vem da CLI da forja ja autenticada. Daqui so sai o LOGIN (o campo `login` de
 * `gh api user`, o `username` de `glab api user`); plano, e-mail e qualquer outro campo da resposta
 * sao descartados na leitura. O git autentica pelo helper de credencial da propria CLI
 * (`gh auth git-credential`, `glab auth git-credential`), configurado so no cache bare da rede: o
 * `ork` nunca le, copia nem guarda token.
 *
 * D11: binario e procurado no PATH e nas pastas de usuario comuns. O cron do pulse tem PATH curto,
 * e sem isso o retrato da maquina oscilaria entre a batida e o terminal. `ORK_BINARIOS_EXTRA`
 * substitui a lista de pastas extras (os testes zeram, para nunca achar a forja de verdade).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chamarApi, MetodoHttp, OpcoesDaApi, RespostaDaApi, RodarCli } from './forja/api';
import type { AlvoDaCli } from './forja/cli';
import type { DonoDaRede, ErroDaForja, Resultado } from './forja/contrato';
import { rodarCli } from './forja/executor';
import { redigirCredenciaisUrl } from './redacao-url';
import { ErroDoCatalogo, montadorDe, textoDoCatalogo } from './locale';

export type NomeDaForja = 'github' | 'gitlab';
export const ORDEM_DAS_FORJAS: readonly NomeDaForja[] = ['github', 'gitlab'];

/** De onde a rede le binarios e o home. Sem nada, o do processo. */
export interface AmbienteDaMaquina {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface IdentidadeNaForja {
  forja: NomeDaForja;
  host: string;
  cli: string;
  versao: string | null;
  /** So o login; `null` quando a CLI existe e nao tem login, ou quando a leitura falhou (`falha`). */
  usuario: string | null;
  /**
   * Suspeitas da revisao de 03/10: a leitura do login falhou por outro motivo que nao a falta de login
   * (prazo, erro da forja, sem rede). Interno: o retrato copia campo a campo e nunca leva este.
   */
  falha?: string;
}

export interface RepositorioNaForja {
  existe: boolean;
  privado: boolean | null;
  /** A URL HTTPS que o git usa, autenticada pelo helper da propria CLI (B2). */
  url: string | null;
}

export interface Forja {
  nome: NomeDaForja;
  host: string;
  cli: string;
  binario: string;
  identidade(): IdentidadeNaForja;
  repositorio(dono: string, nome: string): RepositorioNaForja;
  /** Cria a casa privada; `dono` e `namespaceId` levam a casa a um grupo (GitLab). */
  criarPrivado(nome: string, descricao: string, dono?: string, namespaceId?: number): RepositorioNaForja;
  /** O dono pedido para a casa quando nao e o login (GitLab: um grupo). Ausente na forja sem a capacidade. */
  donoDaRede?(dono: string): Resultado<DonoDaRede>;
  /** O helper que o git chama para autenticar: a propria CLI da forja entrega a credencial ao git. */
  helperDeCredencial(): string;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,254})$/;
const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;
const VERSAO = /\b(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]{1,20})?)\b/;

const ambienteDe = (amb: AmbienteDaMaquina): NodeJS.ProcessEnv => amb.env ?? process.env;
const homeDe = (amb: AmbienteDaMaquina): string => amb.home ?? os.homedir();

/** As pastas onde a rede procura binarios: PATH primeiro, depois as de usuario (D11). */
export function pastasDeBinarios(amb: AmbienteDaMaquina = {}): string[] {
  const env = ambienteDe(amb), home = homeDe(amb);
  const doPath = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extras = env.ORK_BINARIOS_EXTRA !== undefined
    ? env.ORK_BINARIOS_EXTRA.split(path.delimiter).filter(Boolean)
    : [...['.local/bin', '.npm-global/bin', 'bin', '.bun/bin', '.volta/bin', '.claude/local'].map((d) => path.join(home, d)),
      '/usr/local/bin', '/opt/homebrew/bin'];
  return [...new Set([...doPath, ...extras])];
}

/** O primeiro executavel com esse nome nas pastas da rede, ou `null`. */
export function acharBinario(nome: string, amb: AmbienteDaMaquina = {}): string | null {
  for (const dir of pastasDeBinarios(amb)) {
    const candidato = path.join(dir, nome);
    try {
      fs.accessSync(candidato, fs.constants.X_OK);
      if (fs.statSync(candidato).isFile()) return candidato;
    } catch { /* proxima pasta */ }
  }
  return null;
}

interface Saida { ok: boolean; stdout: string; stderr: string }

/** Roda a CLI sem prompt nem cor; a saida de erro so volta curta e sem credencial em URL. */
function rodar(binario: string, args: string[], amb: AmbienteDaMaquina, timeoutMs: number): Saida {
  const env = { ...ambienteDe(amb), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_PROMPT: '1', NO_COLOR: '1' };
  const r = spawnSync(binario, args, { encoding: 'utf8', timeout: timeoutMs, env, maxBuffer: 1024 * 1024 });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString() };
}

/** A versao do binario (`<bin> --version`), so quando casa o formato de versao; o resto vira `null`. */
export function versaoDoBinario(binario: string, amb: AmbienteDaMaquina = {}): string | null {
  const r = rodar(binario, ['--version'], amb, 5000);
  const m = VERSAO.exec(`${r.stdout}\n${r.stderr}`.slice(0, 400));
  return m && m[1].length <= 40 ? m[1] : null;
}

function json(texto: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(texto) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

/** Variaveis que redirecionam o git para outro repositorio (um hook do git exporta GIT_DIR). */
const GIT_REDIRECIONA = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_QUARANTINE_PATH', 'GIT_PREFIX'];

export interface IdentidadeDoGit { nome: string; email: string }

export interface OpcoesDoGitIsolado {
  /** Autor e committer dos commits feitos aqui dentro. */
  identidade?: IdentidadeDoGit;
  /**
   * `lote` (padrao): SSH sem pergunta, salvo quando `GIT_SSH_COMMAND` ou `GIT_SSH` ja dizem como rodar.
   * `herdado`: o projeto tem `core.sshCommand` proprio, e ele vale (S4 da revisao 2).
   */
  ssh?: 'lote' | 'herdado';
}

/**
 * Roda `f` com o git da rede isolado do ambiente de quem chamou (GO-FIX 1 do CHECK 1 e GO-FIX 2):
 *   - sem as variaveis que redirecionam o repositorio: chamado de um hook, o git do cache miraria o
 *     projeto e regravaria a config dele (A2);
 *   - sem a config que um hook injeta (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT/KEY_n/VALUE_n`):
 *     um `-c credential.helper=` zeraria o helper da forja no cache (S5);
 *   - sem prompt: nem terminal, nem askpass (`GIT_ASKPASS` vazio desliga tambem `core.askPass` e
 *     `SSH_ASKPASS`), nem SSH interativo, porque a batida roda sem ninguem olhando (M5, S5);
 *   - em ingles, porque o nucleo interpreta o stderr do git (B5);
 *   - com autor e committer fixos na maquina, quando ha identidade: `GIT_AUTHOR_EMAIL` e cia. do
 *     ambiente poriam o e-mail real da pessoa nos commits da casa (B8).
 * O ambiente volta como estava na saida, inclusive em chamada aninhada.
 */
export function comGitIsolado<T>(f: () => T, identidade?: IdentidadeDoGit, opcoes: OpcoesDoGitIsolado = {}): T {
  const antes = new Map<string, string | undefined>();
  const trocar = (k: string, v: string | undefined) => {
    if (!antes.has(k)) antes.set(k, process.env[k]);
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  for (const k of GIT_REDIRECIONA) trocar(k, undefined);
  for (const k of Object.keys(process.env)) if (/^GIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) trocar(k, undefined);
  trocar('GIT_TERMINAL_PROMPT', '0');
  trocar('GIT_ASKPASS', '');
  trocar('SSH_ASKPASS_REQUIRE', 'never');
  // S4: `GIT_SSH_COMMAND` vence `core.sshCommand`; so entra quando ninguem disse como rodar o ssh.
  if ((opcoes.ssh ?? 'lote') === 'lote' && !process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH) trocar('GIT_SSH_COMMAND', 'ssh -o BatchMode=yes');
  trocar('LC_ALL', 'C');
  trocar('LANGUAGE', 'C');
  const quem = identidade ?? opcoes.identidade;
  if (quem) {
    for (const papel of ['AUTHOR', 'COMMITTER']) {
      trocar(`GIT_${papel}_NAME`, quem.nome);
      trocar(`GIT_${papel}_EMAIL`, quem.email);
    }
  }
  try { return f(); } finally {
    for (const [k, v] of antes) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const naoEncontrado = (s: Saida) => /HTTP 404|404 Not Found|"status"\s*:\s*"?404/i.test(`${s.stdout}\n${s.stderr}`);

function falhou(cli: string, rota: string, s: Saida): Error {
  const linha = redigirCredenciaisUrl(s.stderr.trim().split('\n').pop() ?? '').slice(0, 200);
  const montarLinha = montadorDe(linha);
  return new ErroDoCatalogo((m) => m.network.apiFalhou(cli, rota, montarLinha(m)));
}

/** A resposta de quem nao tem login (ou tem credencial recusada), no `gh` e no `glab`. */
const SEM_LOGIN = /auth login|not logged|not authenticated|authentication|HTTP 401|401 Unauthorized|Bad credentials|no token/i;

/** `usuario: null` so e falta de login quando a forja disse isso; o resto e falha da leitura. */
function falhaDoLogin(cli: string, s: Saida): { falha?: string } {
  if (!s.ok && SEM_LOGIN.test(`${s.stderr}\n${s.stdout}`)) return {};
  // RM-061 (F3b): a falha entra no detalhe da lacuna da casa, que a impressao remonta no locale do comando.
  if (s.ok) return { falha: textoDoCatalogo((m) => m.network.respostaSemLogin(cli)) };
  const erro = falhou(cli, 'user', s.stderr.trim() ? s : { ...s, stderr: textoDoCatalogo((m) => m.network.semRespostaNoPrazo) }) as ErroDoCatalogo;
  return { falha: textoDoCatalogo((m) => erro.montar(m).replace(/^rede\.forja: /, '')) };
}

/** Caminho seguro para o shell que o git usa no helper: aspas simples, com `'` escapada (B10). */
const citar = (caminho: string) => /^[A-Za-z0-9_./+-]+$/.test(caminho) ? caminho : `'${caminho.replace(/'/g, `'\\''`)}'`;
const helper = (binario: string) => `!${citar(binario)} auth git-credential`;
/** O mesmo helper do cache da rede, para o transporte `forja-https` do SHIP. */
export const helperDeCredencialDaCli = helper;

/**
 * Privado de verdade (B1): no GitHub, `internal` vem com `private: true`, e a empresa inteira le.
 * Quando a forja diz a visibilidade, so `private` conta; sem ela, o booleano.
 */
function privadoDe(v: Record<string, unknown>): boolean | null {
  if (typeof v.visibility === 'string') return v.visibility === 'private';
  return typeof v.private === 'boolean' ? v.private : null;
}

function github(binario: string, amb: AmbienteDaMaquina, host = 'github.com'): Forja {
  // B2: a casa vai sempre por HTTPS, com o helper da propria CLI; SSH pediria agente, que o cron nao tem.
  const repositorioDe = (v: Record<string, unknown> | null): RepositorioNaForja => {
    if (!v) throw new ErroDoCatalogo((m) => m.network.repositorioIlegivel);
    return { existe: true, privado: privadoDe(v), url: typeof v.clone_url === 'string' ? v.clone_url : null };
  };
  // B9: o host da casa vai em toda chamada; o cron nao tem o ambiente do terminal.
  const api = (args: string[], timeoutMs: number) => rodar(binario, ['api', '--hostname', host, ...args], amb, timeoutMs);
  return {
    nome: 'github', host, cli: 'gh', binario,
    identidade() {
      const r = api(['user'], 15000);
      const login = r.ok ? json(r.stdout)?.login : null;
      const usuario = typeof login === 'string' && LOGIN.test(login) ? login : null;
      return { forja: 'github', host, cli: 'gh', versao: versaoDoBinario(binario, amb), usuario, ...(usuario ? {} : falhaDoLogin('gh', r)) };
    },
    repositorio(dono, nome) {
      const rota = `repos/${dono}/${nome}`;
      const r = api([rota], 15000);
      if (!r.ok) {
        if (naoEncontrado(r)) return { existe: false, privado: null, url: null };
        throw falhou('gh', rota, r);
      }
      return repositorioDe(json(r.stdout));
    },
    criarPrivado(nome, descricao) {
      const r = api(['-X', 'POST', 'user/repos', '-f', `name=${nome}`, '-F', 'private=true',
        '-f', `description=${descricao}`, '-F', 'has_issues=false', '-F', 'has_wiki=false'], 30000);
      if (!r.ok) throw falhou('gh', 'user/repos', r);
      return repositorioDe(json(r.stdout));
    },
    helperDeCredencial: () => helper(binario),
  };
}

function hostDoGitlab(amb: AmbienteDaMaquina): string {
  const bruto = (ambienteDe(amb).GITLAB_HOST ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return HOST.test(bruto) ? bruto : 'gitlab.com';
}

/**
 * O que a casa da rede ainda nao suporta no GitLab da maquina: o `rede.json` guarda so `host[:porta]`, entao um GitLab em
 * subcaminho (`https://host/gitlab`) ou com CA propria (`GLAB_CA_CERT`) nao teria como ser lembrado em outra maquina.
 */
export function gitlabSemSuporteNaRede(amb: AmbienteDaMaquina): 'subcaminho' | 'ca' | null {
  const env = ambienteDe(amb);
  const bruto = (env.GITLAB_HOST ?? '').trim().replace(/^https?:\/\//, '');
  if (/^[^/]+\/+[^/]/.test(bruto)) return 'subcaminho';
  if ((env.GLAB_CA_CERT ?? '').trim() && hostDoGitlab(amb) !== 'gitlab.com') return 'ca';
  return null;
}

/** O `rodarCli` com o ambiente e o PATH da maquina da rede (o cron tem outro ambiente que o terminal). */
const rodarNaMaquina = (amb: AmbienteDaMaquina): RodarCli => (c) => {
  if (!amb.env) return rodarCli(c);
  const env = amb.env, acrescentar = c.acrescentar ?? {};
  // O que a maquina da rede tem entra no processo, e o que so o `ork` tem fica de fora; o que a chamada acrescenta vale mais.
  const dele = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const apagar = [...(c.apagar ?? []), ...Object.keys(process.env).filter((k) => !(k in env) && !(k in acrescentar))];
  return rodarCli({ ...c, acrescentar: { ...dele, ...acrescentar }, apagar: apagar.filter((k) => !(k in acrescentar)) });
};

/** `host` ou `host:porta` da casa como alvo da API; a rede nao guarda caminho base nem CA. */
function alvoDoGitlab(host: string): AlvoDaCli {
  const m = /^(.+?)(?::(\d+))?$/.exec(host) as RegExpExecArray;
  return { tipo: 'gitlab', host: m[1].toLowerCase(), porta: m[2] ? Number(m[2]) : null, caminhoBase: '', ca: null };
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** A falha da API com o motivo tipado da forja (`forja.*`) no lugar da ultima linha do stderr. */
const falhouNaApi = (rota: string, erro: ErroDaForja): Error =>
  new ErroDoCatalogo((m) => m.network.apiFalhou('glab', rota, m.forja.motivo(erro, 'gitlab')));

/** `usuario: null` so e falta de login quando a forja disse isso (`forja.sem-login`); o resto e falha da leitura. */
function falhaDaApi(r: Resultado<RespostaDaApi>): { falha?: string } {
  if (r.ok) return { falha: textoDoCatalogo((m) => m.network.respostaSemLogin('glab')) };
  if (r.erro.codigo === 'forja.sem-login') return {};
  const erro = r.erro;
  return { falha: textoDoCatalogo((m) => m.network.apiFalhou('glab', 'user', m.forja.motivo(erro, 'gitlab')).replace(/^rede\.forja: /, '')) };
}

/**
 * O GitLab da casa pela API da CLI logada (`chamarApi`): o host (com porta) vai por GITLAB_HOST, nunca por
 * `--hostname` (o glab recusa a porta); o login e conferido antes da primeira chamada (sem ele o glab faria o pedido
 * anonimo); o corpo vai pelo stdin com o Content-Type; o erro sai tipado pelo status HTTP.
 */
function gitlab(binario: string, amb: AmbienteDaMaquina, hostPedido?: string): Forja {
  const host = hostPedido ?? hostDoGitlab(amb);
  const alvo = alvoDoGitlab(host);
  const opcoes: OpcoesDaApi = { rodar: rodarNaMaquina(amb), logins: new Map() };
  const pedir = (metodo: MetodoHttp, caminho: string, corpo?: unknown, prazoMs = 15000): Resultado<RespostaDaApi> =>
    chamarApi(alvo, { metodo, caminho, prazoMs, ...(corpo !== undefined ? { corpo } : {}) }, opcoes);
  const repositorioDe = (v: Record<string, unknown> | null): RepositorioNaForja => {
    if (!v) throw new ErroDoCatalogo((m) => m.network.projetoIlegivel);
    return { existe: true, privado: privadoDe(v), url: typeof v.http_url_to_repo === 'string' ? v.http_url_to_repo : null };
  };
  const repositorio = (dono: string, nome: string): RepositorioNaForja => {
    const rota = `projects/${encodeURIComponent(`${dono}/${nome}`)}`;
    const r = pedir('GET', rota);
    if (r.ok) return repositorioDe(objeto(r.valor.corpo));
    if (r.erro.codigo === 'forja.nao-achei') return { existe: false, privado: null, url: null };
    throw falhouNaApi(rota, r.erro);
  };
  return {
    nome: 'gitlab', host, cli: 'glab', binario,
    identidade() {
      const r = pedir('GET', 'user');
      const login = r.ok ? objeto(r.valor.corpo)?.username : null;
      const usuario = typeof login === 'string' && LOGIN.test(login) ? login : null;
      return { forja: 'gitlab', host, cli: 'glab', versao: versaoDoBinario(binario, amb), usuario, ...(usuario ? {} : falhaDaApi(r)) };
    },
    repositorio,
    criarPrivado(nome, descricao, dono, namespaceId) {
      const r = pedir('POST', 'projects', { name: nome, path: nome, visibility: 'private', description: descricao,
        ...(namespaceId ? { namespace_id: namespaceId } : {}) }, 30000);
      if (r.ok) return repositorioDe(objeto(r.valor.corpo));
      // Escrita nunca se repete sozinha: relida a casa, o projeto que a forja criou antes de a resposta se perder vale.
      if (dono) {
        const relido = repositorio(dono, nome);
        if (relido.existe) return relido;
      }
      throw falhouNaApi('projects', r.erro);
    },
    donoDaRede(dono) {
      // Carga tardia: o registro chega a este modulo pelo executor da forja; importar no topo fecharia um ciclo de carga.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { adaptadorDaForja, exigirCapacidade } = require('./forja/registro') as typeof import('./forja/registro');
      return exigirCapacidade(adaptadorDaForja('gitlab'), 'donoDaRede')({ api: (p) => chamarApi(alvo, p, opcoes), dono });
    },
    helperDeCredencial: () => helper(binario),
  };
}

const CLI_DA_FORJA: Record<NomeDaForja, string> = { github: 'gh', gitlab: 'glab' };

/** A forja pelo nome, quando a CLI dela existe nesta maquina; `host` e o da casa gravada, quando ha. */
export function forjaPorNome(nome: NomeDaForja, amb: AmbienteDaMaquina = {}, host?: string | null): Forja | null {
  const binario = acharBinario(CLI_DA_FORJA[nome], amb);
  if (!binario) return null;
  const h = host && HOST.test(host) ? host : undefined;
  return nome === 'github' ? github(binario, amb, h) : gitlab(binario, amb, h);
}

/** As forjas cuja CLI existe nesta maquina, GitHub primeiro. */
export function forjasDaMaquina(amb: AmbienteDaMaquina = {}): Forja[] {
  return ORDEM_DAS_FORJAS.map((n) => forjaPorNome(n, amb)).filter((f): f is Forja => f !== null);
}

export function ehNomeDeForja(v: unknown): v is NomeDaForja {
  return v === 'github' || v === 'gitlab';
}

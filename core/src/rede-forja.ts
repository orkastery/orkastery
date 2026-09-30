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
import { redigirCredenciaisUrl } from './redacao-url';

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
  /** So o login; `null` quando a CLI existe e nao tem login. */
  usuario: string | null;
}

export interface RepositorioNaForja {
  existe: boolean;
  privado: boolean | null;
  /** A URL que o git usa, no protocolo que a pessoa configurou na CLI da forja. */
  url: string | null;
}

export interface Forja {
  nome: NomeDaForja;
  host: string;
  cli: string;
  binario: string;
  identidade(): IdentidadeNaForja;
  repositorio(dono: string, nome: string): RepositorioNaForja;
  criarPrivado(nome: string, descricao: string): RepositorioNaForja;
  /** O helper que o git chama para autenticar: a propria CLI da forja entrega a credencial ao git. */
  helperDeCredencial(): string;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,254})$/;
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

/**
 * Roda `f` com o git da rede isolado do ambiente de quem chamou (GO-FIX 1 do CHECK 1):
 *   - sem as variaveis que redirecionam o repositorio: chamado de um hook, o git do cache miraria o
 *     projeto e regravaria a config dele (A2);
 *   - sem prompt de senha no terminal e com SSH em lote, porque a batida roda sem ninguem olhando (M5);
 *   - em ingles, porque o nucleo interpreta o stderr do git (B5);
 *   - com autor e committer fixos na maquina, quando ha identidade: `GIT_AUTHOR_EMAIL` e cia. do
 *     ambiente poriam o e-mail real da pessoa nos commits da casa (B8).
 * O ambiente volta como estava na saida, inclusive em chamada aninhada.
 */
export function comGitIsolado<T>(f: () => T, identidade?: IdentidadeDoGit): T {
  const antes = new Map<string, string | undefined>();
  const trocar = (k: string, v: string | undefined) => {
    if (!antes.has(k)) antes.set(k, process.env[k]);
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  for (const k of GIT_REDIRECIONA) trocar(k, undefined);
  trocar('GIT_TERMINAL_PROMPT', '0');
  if (!process.env.GIT_SSH_COMMAND) trocar('GIT_SSH_COMMAND', 'ssh -o BatchMode=yes');
  trocar('LC_ALL', 'C');
  trocar('LANGUAGE', 'C');
  if (identidade) {
    for (const papel of ['AUTHOR', 'COMMITTER']) {
      trocar(`GIT_${papel}_NAME`, identidade.nome);
      trocar(`GIT_${papel}_EMAIL`, identidade.email);
    }
  }
  try { return f(); } finally {
    for (const [k, v] of antes) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const naoEncontrado = (s: Saida) => /HTTP 404|404 Not Found|"status"\s*:\s*"?404/i.test(`${s.stdout}\n${s.stderr}`);

function falhou(cli: string, rota: string, s: Saida): Error {
  const linha = redigirCredenciaisUrl(s.stderr.trim().split('\n').pop() ?? '').slice(0, 200);
  return new Error(`rede.forja: ${cli} api ${rota} falhou${linha ? `: ${linha}` : ''}`);
}

const helper = (binario: string) => `!${/\s/.test(binario) ? `'${binario}'` : binario} auth git-credential`;

function github(binario: string, amb: AmbienteDaMaquina): Forja {
  const host = 'github.com';
  const protocolo = () => rodar(binario, ['config', 'get', 'git_protocol', '-h', host], amb, 10000).stdout.trim();
  const repositorioDe = (v: Record<string, unknown> | null): RepositorioNaForja => {
    if (!v) throw new Error('rede.forja: gh devolveu um repositorio ilegivel');
    const url = protocolo() === 'ssh' ? v.ssh_url : v.clone_url;
    return { existe: true, privado: typeof v.private === 'boolean' ? v.private : null, url: typeof url === 'string' ? url : null };
  };
  return {
    nome: 'github', host, cli: 'gh', binario,
    identidade() {
      const r = rodar(binario, ['api', 'user'], amb, 15000);
      const login = r.ok ? json(r.stdout)?.login : null;
      return { forja: 'github', host, cli: 'gh', versao: versaoDoBinario(binario, amb),
        usuario: typeof login === 'string' && LOGIN.test(login) ? login : null };
    },
    repositorio(dono, nome) {
      const rota = `repos/${dono}/${nome}`;
      const r = rodar(binario, ['api', rota], amb, 15000);
      if (!r.ok) {
        if (naoEncontrado(r)) return { existe: false, privado: null, url: null };
        throw falhou('gh', rota, r);
      }
      return repositorioDe(json(r.stdout));
    },
    criarPrivado(nome, descricao) {
      const r = rodar(binario, ['api', '-X', 'POST', 'user/repos', '-f', `name=${nome}`, '-F', 'private=true',
        '-f', `description=${descricao}`, '-F', 'has_issues=false', '-F', 'has_wiki=false'], amb, 30000);
      if (!r.ok) throw falhou('gh', 'user/repos', r);
      return repositorioDe(json(r.stdout));
    },
    helperDeCredencial: () => helper(binario),
  };
}

function gitlab(binario: string, amb: AmbienteDaMaquina): Forja {
  const bruto = (ambienteDe(amb).GITLAB_HOST ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const host = /^[A-Za-z0-9.-]+(?::\d+)?$/.test(bruto) ? bruto : 'gitlab.com';
  const protocolo = () => rodar(binario, ['config', 'get', 'git_protocol'], amb, 10000).stdout.trim();
  const repositorioDe = (v: Record<string, unknown> | null): RepositorioNaForja => {
    if (!v) throw new Error('rede.forja: glab devolveu um projeto ilegivel');
    const url = protocolo() === 'ssh' ? v.ssh_url_to_repo : v.http_url_to_repo;
    const visibilidade = typeof v.visibility === 'string' ? v.visibility : null;
    return { existe: true, privado: visibilidade === null ? null : visibilidade === 'private', url: typeof url === 'string' ? url : null };
  };
  return {
    nome: 'gitlab', host, cli: 'glab', binario,
    identidade() {
      const r = rodar(binario, ['api', 'user'], amb, 15000);
      const login = r.ok ? json(r.stdout)?.username : null;
      return { forja: 'gitlab', host, cli: 'glab', versao: versaoDoBinario(binario, amb),
        usuario: typeof login === 'string' && LOGIN.test(login) ? login : null };
    },
    repositorio(dono, nome) {
      const rota = `projects/${encodeURIComponent(`${dono}/${nome}`)}`;
      const r = rodar(binario, ['api', rota], amb, 15000);
      if (!r.ok) {
        if (naoEncontrado(r)) return { existe: false, privado: null, url: null };
        throw falhou('glab', rota, r);
      }
      return repositorioDe(json(r.stdout));
    },
    criarPrivado(nome, descricao) {
      const r = rodar(binario, ['api', '-X', 'POST', 'projects', '-f', `name=${nome}`, '-f', 'visibility=private',
        '-f', `description=${descricao}`], amb, 30000);
      if (!r.ok) throw falhou('glab', 'projects', r);
      return repositorioDe(json(r.stdout));
    },
    helperDeCredencial: () => helper(binario),
  };
}

const CLI_DA_FORJA: Record<NomeDaForja, string> = { github: 'gh', gitlab: 'glab' };

/** A forja pelo nome, quando a CLI dela existe nesta maquina. */
export function forjaPorNome(nome: NomeDaForja, amb: AmbienteDaMaquina = {}): Forja | null {
  const binario = acharBinario(CLI_DA_FORJA[nome], amb);
  if (!binario) return null;
  return nome === 'github' ? github(binario, amb) : gitlab(binario, amb);
}

/** As forjas cuja CLI existe nesta maquina, GitHub primeiro. */
export function forjasDaMaquina(amb: AmbienteDaMaquina = {}): Forja[] {
  return ORDEM_DAS_FORJAS.map((n) => forjaPorNome(n, amb)).filter((f): f is Forja => f !== null);
}

export function ehNomeDeForja(v: unknown): v is NomeDaForja {
  return v === 'github' || v === 'gitlab';
}

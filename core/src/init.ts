/**
 * `ork init`: gera o `orkastery.yaml` do repositorio.
 *
 * O wizard detecta em vez de perguntar (gerenciador de pacotes, branch base, scripts de
 * verificacao) e nunca sobrescreve um manifesto existente sem `--force`.
 */

import { Locale, LOCALE_PADRAO, msg } from './locale';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DIR_ESTADO, NOME_MANIFESTO } from './manifest';
import { normalizarAbbrev } from './slug';
import { branchDoHead, exec, gravar, ignorarPastaNoGit } from './util';
import { FUSO_DE_BRASILIA } from './horario';
import { ORDEM_DOS_MODOS } from './modos';
import { detectStacks } from './security-scan/detect';
import type { Stack } from './security-scan/types';

/** O proximo passo do `ork init` em pt-BR; o texto do CLI sai pelo catalogo (`msg().init.proximoPasso`). */
export const PROXIMO_PASSO_INIT = msg('pt-BR').init.proximoPasso;

export interface Deteccao {
  raiz: string;
  nome: string;
  abbrev: string;
  baseBranch: string;
  gerenciador: string;
  verify: { build?: string; test?: string; typecheck?: string };
  /** Stacks detected (JS/TS, Python, Go), deduplicated; non-empty enables `verify.security_scan` in the new manifest. */
  stacks: Stack[];
}

/** Raiz do repositorio git, resolvendo tambem o caso de worktree. */
export function raizDoRepo(dirInicial: string): string {
  const r = exec('git', ['rev-parse', '--show-toplevel'], dirInicial);
  return r.ok ? r.stdout.trim() : path.resolve(dirInicial);
}

/** Nome canonico do produto a partir do diretorio principal do repositorio. */
export function nomeDetectado(dirInicial: string): string {
  const comum = exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], dirInicial);
  const base = comum.ok
    ? path.basename(path.dirname(comum.stdout.trim()))
    : path.basename(raizDoRepo(dirInicial));
  return base.replace(/-(novo|new|old|repo|main)$/i, '').toLowerCase();
}

/**
 * Branch base do repositorio: origin/HEAD, senao main, senao master, senao a do HEAD.
 * A do HEAD vem de `symbolic-ref`, que responde tambem no repositorio ainda sem commit (ensaio
 * da 0.5.0: o `git init` sem `init.defaultBranch` nasce em `master`, e o `rev-parse` falhava e
 * caia em `main`). HEAD destacado nao e branch: vale `main`.
 */
export function baseBranchDetectada(raiz: string): string {
  const origem = exec('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], raiz);
  if (origem.ok && origem.stdout.trim()) {
    return origem.stdout.trim().replace('refs/remotes/origin/', '');
  }
  for (const candidata of ['main', 'master']) {
    if (exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${candidata}`], raiz).ok) {
      return candidata;
    }
  }
  return branchDoHead(raiz) ?? 'main';
}

function gerenciadorDetectado(dir: string): string {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/** Procura o package.json do projeto na raiz e nos subdiretorios convencionais. */
function acharPacote(raiz: string): { dir: string; prefixo: string } | null {
  const candidatos = ['', 'core', 'app', 'src'];
  for (const sub of candidatos) {
    const dir = path.join(raiz, sub);
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return { dir, prefixo: sub };
    }
  }
  return null;
}

/** Detecta os comandos de verificacao a partir dos scripts do package.json. */
export function verifyDetectado(raiz: string): Deteccao['verify'] {
  const pacote = acharPacote(raiz);
  if (!pacote) return {};
  let scripts: Record<string, string> = {};
  try {
    const json = JSON.parse(fs.readFileSync(path.join(pacote.dir, 'package.json'), 'utf8'));
    scripts = (json.scripts ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
  const gerenciador = gerenciadorDetectado(pacote.dir === raiz ? raiz : pacote.dir);
  const prefixo = pacote.prefixo ? `${gerenciador} --prefix ${pacote.prefixo}` : gerenciador;
  const verify: Deteccao['verify'] = {};
  if (scripts.build) verify.build = `${prefixo} run build`;
  if (scripts.test) verify.test = `${prefixo} test`;
  if (scripts.typecheck) verify.typecheck = `${prefixo} run typecheck`;
  return verify;
}

/** Roda a deteccao completa do repositorio. */
export function detectar(dirInicial: string, nomeForcado?: string, abbrevForcada?: string): Deteccao {
  const raiz = raizDoRepo(dirInicial);
  const nome = nomeForcado ?? nomeDetectado(dirInicial);
  return {
    raiz,
    nome,
    abbrev: normalizarAbbrev(abbrevForcada ?? nome),
    baseBranch: baseBranchDetectada(raiz),
    gerenciador: gerenciadorDetectado(raiz),
    verify: verifyDetectado(raiz),
    stacks: [...new Set(detectStacks(raiz).map((e) => e.stack))],
  };
}

/** Cada linha do texto vira comentario do YAML, com o recuo da chave em que ele fica. */
function comentario(texto: string, recuo = '  '): string {
  return texto.split('\n').map((linha) => `${recuo}# ${linha}`).join('\n');
}

/**
 * Serializa o manifesto v1 a partir da deteccao. RM-061 (F3a, D1 a D3): os comentarios saem na lingua pedida, pela
 * familia `gerados` do catalogo; chaves, valores e exemplos comentados sao este esqueleto, o mesmo nas duas linguas.
 * Sem locale, pt-BR: so o `ork init` passa a lingua do dono (D2).
 */
export function manifestoYaml(d: Deteccao, locale: Locale = LOCALE_PADRAO): string {
  const c = msg(locale).gerados.manifesto;
  const linhaVerify = (chave: string, valor?: string) =>
    valor ? `  ${chave}: "${valor}"` : `  # ${chave}: ${c.naoDetectado}`;
  return `${comentario(c.cabecalho, '')}

project:
  name: "${d.nome}"
${comentario(c.abbrev)}
  abbrev: "${d.abbrev}"
  stage: nascente

owner:
${comentario(c.fuso)}
  # timezone: "${FUSO_DE_BRASILIA}"
${comentario(c.preferencias(`ork onboarding set maestro --conteudo '{"owner":{"experience":true}}'`))}
  # language: ${c.exemploDeIdioma}  # ${c.idiomaAusente}
  # depth: curta    # curta | detalhada
  # experience: true  # ${c.experienciaFalse}

board:
  adapter: hermes-kanban
  default: default

runtime:
${comentario(c.runtimes)}
  adapter: claude-bg
  model: opus
  effort: high
${comentario(c.providerPolicy)}
  provider_policy: subscription-only
${comentario(c.sandbox)}
  sandbox: workspace-write

conduction:
${comentario(c.modoPadrao)}
  default_mode: classic
  allowed_modes: [${ORDEM_DOS_MODOS.join(', ')}]

worktree:
  base_branch: "${d.baseBranch}"
  dir: ".claude/worktrees"
${comentario(c.porThread)}
  por_thread: true

verify:
${linhaVerify('build', d.verify.build)}
${linhaVerify('test', d.verify.test)}
${linhaVerify('typecheck', d.verify.typecheck)}
${comentario(c.securityScan)}
  ${d.stacks.length > 0 ? '' : '# '}security_scan: "ork security-scan"

ci:
${comentario(c.ci)}
  required_for_ship: false
  context: ork-verify
  # command: "npm test" # ${c.ciComando}

concurrency:
  max_parallel_threads: 3
${comentario(c.staleAfter)}
  stale_after_min: 240

handoff:
${comentario(c.handoff)}
  rotate_above: 0.70
  force_rotate_above: 0.85

retry:
${comentario(c.retry)}
  max_tentativas: 3
${comentario(c.janelaPadrao)}
  janela_padrao_min: 60
  escalar_esforco: true

memory:
${comentario(c.memoriaModo)}
  mode: files
${comentario(c.databaseUrl)}
  database_url_env: ""
  cli: orkmind
  timeout_ms: 15000
${comentario(c.embedding)}
  # embedding:
  #   provider: "none"            # none | openrouter
  #   model: "qwen/qwen3-embedding-8b"
  #   dim: 1024
  #   api_key_env: "ORKASTERY_EMBEDDING_API_KEY"
  #   fallback_model: ""          # ${c.modeloOffline}
  #   max_tokens_por_execucao: 1000000

audit:
${comentario(c.audit)}
  janela_ociosa: "22:00-06:00"
  effort: eco
  since_padrao: 7d
  graphify: auto

policies:
  provider: block
  segredo_em_prompt: block
  push_direto_na_base: block
`;
}

export interface ResultadoInit {
  caminho: string;
  criado: boolean;
  deteccao: Deteccao;
  /** Fatia 2 do ensaio da 0.5.0 (P3): o `init` criou `.orkastery/.gitignore` agora. */
  estadoIgnorado?: boolean;
}

/**
 * Ensaio de 03/10/2026 (RM-049): o `ork init` rodado por engano fora de um repositorio (no HOME, por
 * exemplo) gravava manifesto, `AGENTS.md` e `.orkastery/` ali e saia 0; um repositorio criado depois
 * dentro dessa pasta herdava o manifesto de fora, com outro nome e outra abbrev, e o doctor dizia PRONTO.
 * A CLI recusa antes de gravar qualquer coisa. A funcao `init` segue aceitando qualquer pasta (demo e
 * canarios montam o projeto por ela).
 */
export function exigirRepositorioParaInit(dir: string): void {
  const r = exec('git', ['rev-parse', '--is-inside-work-tree'], dir);
  if (r.ok && r.stdout.trim() === 'true') return;
  throw new Error(msg().init.foraDoRepositorio(path.resolve(dir)));
}

/**
 * Gera o manifesto e o esqueleto de `.orkastery/`. Nao sobrescreve sem `force`. Os comentarios do manifesto saem
 * no `locale` pedido (RM-061, F3a), pt-BR por omissao.
 */
export function init(
  dirInicial: string,
  opcoes: { force?: boolean; nome?: string; abbrev?: string; locale?: Locale } = {}
): ResultadoInit {
  const deteccao = detectar(dirInicial, opcoes.nome, opcoes.abbrev);
  const caminho = path.join(deteccao.raiz, NOME_MANIFESTO);
  const existe = fs.existsSync(caminho);
  if (existe && !opcoes.force) {
    return { caminho, criado: false, deteccao };
  }
  gravar(caminho, manifestoYaml(deteccao, opcoes.locale));
  const estado = path.join(deteccao.raiz, DIR_ESTADO);
  fs.mkdirSync(path.join(estado, 'threads'), { recursive: true });
  // RM-061 F3c: so o arquivo do estado criado pelo `init` segue a lingua pedida. O `*` e a protecao
  // contra sobrescrita continuam no util; a pasta de worktrees preserva o default historico.
  const locale = opcoes.locale ?? LOCALE_PADRAO;
  const gitignore = `# ${msg(locale).gerados.gitignoreDaMaquina}\n*\n`;
  return { caminho, criado: true, deteccao, estadoIgnorado: ignorarPastaNoGit(estado, deteccao.raiz, gitignore) };
}

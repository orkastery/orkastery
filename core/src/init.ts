/**
 * `ork init`: gera o `orkastery.yaml` do repositorio.
 *
 * O wizard detecta em vez de perguntar (gerenciador de pacotes, branch base, scripts de
 * verificacao) e nunca sobrescreve um manifesto existente sem `--force`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DIR_ESTADO, NOME_MANIFESTO } from './manifest';
import { normalizarAbbrev } from './slug';
import { exec, gravar } from './util';
import { FUSO_DE_BRASILIA } from './horario';
import { ORDEM_DOS_MODOS } from './modos';

export const PROXIMO_PASSO_INIT = 'Proximo passo: ork doctor; depois ork onboarding para conduzir a entrevista do projeto.';

export interface Deteccao {
  raiz: string;
  nome: string;
  abbrev: string;
  baseBranch: string;
  gerenciador: string;
  verify: { build?: string; test?: string; typecheck?: string };
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

/** Branch base do repositorio: origin/HEAD, senao main, senao master, senao a atual. */
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
  const atual = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], raiz);
  return atual.ok ? atual.stdout.trim() : 'main';
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
  };
}

/** Serializa o manifesto v1 a partir da deteccao. */
export function manifestoYaml(d: Deteccao): string {
  const linhaVerify = (chave: string, valor?: string) =>
    valor ? `  ${chave}: "${valor}"` : `  # ${chave}: nao detectado`;
  return `# Manifesto do Orkastery (v1, bloco B0)
# Gerado por \`ork init\`. Fonte unica da configuracao do projeto.
# Limite duro de 16 KB: prosa longa vai para a memoria com tag, nao para este arquivo.

project:
  name: "${d.nome}"
  # abbrev: ate 3 caracteres [a-z0-9], parte 1 do slug de sessao, unica no workspace
  abbrev: "${d.abbrev}"
  stage: nascente

owner:
  # fuso do dono (nome IANA): todo horario mostrado a pessoas usa este fuso.
  # Ausente: fuso do sistema. Exemplo:
  # timezone: "${FUSO_DE_BRASILIA}"
  # Preferências: ork onboarding set maestro --conteudo '{"owner":{"experience":true}}'
  # language: pt-BR  # ausente: locale do sistema
  # depth: curta    # curta | detalhada
  # experience: true  # false desativa o pacote na próxima instalação do adaptador

board:
  adapter: hermes-kanban
  default: default

runtime:
  # Runtimes homologados:
  #   claude-bg (padrao, mais maduro): despacha \`claude --bg\`, sessao visivel no app
  #             e em \`claude agents --json\`
  #   codex: despacha \`codex exec\` headless na sessao autenticada do Codex CLI,
  #          verificado no rollout de $CODEX_HOME/sessions (requer \`codex login\`)
  adapter: claude-bg
  model: opus
  effort: high
  # subscription-only: proibido despachar por provider pago (cobra por token, fora da assinatura)
  provider_policy: subscription-only
  # sandbox do runtime codex: read-only | workspace-write | danger-full-access
  # (danger-full-access SO onde o bubblewrap nao roda; \`ork doctor\` tem a sonda)
  sandbox: workspace-write

conduction:
  # modo usado quando o pedido do builder nao traz #TAG
  default_mode: classic
  allowed_modes: [${ORDEM_DOS_MODOS.join(', ')}]

worktree:
  base_branch: "${d.baseBranch}"
  dir: ".claude/worktrees"
  por_thread: true

verify:
${linhaVerify('build', d.verify.build)}
${linhaVerify('test', d.verify.test)}
${linhaVerify('typecheck', d.verify.typecheck)}

ci:
  # Ative depois de publicar o workflow e tornar ork-verify um check obrigatório.
  required_for_ship: false
  context: ork-verify
  # command: "npm test" # perfil hermético opcional do runner; sem ele, usa verify acima

concurrency:
  max_parallel_threads: 3
  # thread despachada sem atividade (ledger parado, sessao nao-working) por mais que
  # isto NAO ocupa vaga do escalonador: a vaga volta para quem esta pronto para rodar
  stale_after_min: 240

handoff:
  # gate de tokens (bloco B1): rotaciona a sessao acima destas ocupacoes de janela
  rotate_above: 0.70
  force_rotate_above: 0.85

retry:
  # autonomia do bloco B3: retry tipado por motivo de gate e fila duravel de rate limit
  # max_tentativas e o LIMITE DE ESCALACAO: estourado, pausa qualquer modo, ate #Auto
  max_tentativas: 3
  # janela usada so quando o runtime diz "rate limit" e NAO diz a hora do reset
  # (fica marcada como estimativa na fila; o ork nunca inventa horario medido)
  janela_padrao_min: 60
  escalar_esforco: true

memory:
  # files = fallback honesto sem OrkMind (handoff por arquivos, ponteiro path#ancora)
  # orkmind = camada semantica do bloco B6 por cima, com degradacao honesta para files
  mode: files
  # NOME da variavel de ambiente com a DSN da base PROPRIA deste tenant, nunca a DSN.
  # Vazio = o regime orkmind nao liga (o ork nao adivinha base: base alheia e pior que
  # base nenhuma, precedente do incidente memory-orkmind).
  database_url_env: ""
  cli: orkmind
  timeout_ms: 15000
  # busca por significado (ork memory search --texto): sem o bloco, provider none (desligada).
  # api_key_env recebe o NOME da variavel com a chave dedicada, nunca o valor.
  # embedding:
  #   provider: "none"            # none | openrouter
  #   model: "qwen/qwen3-embedding-8b"
  #   dim: 1024
  #   api_key_env: "ORKASTERY_EMBEDDING_API_KEY"
  #   fallback_model: ""          # modelo local offline, ex.: intfloat/multilingual-e5-small
  #   max_tokens_por_execucao: 1000000

audit:
  # governanca de custo dos auditores periodicos (bloco B5)
  # janela ociosa da assinatura: fora dela a rodada so anda com --agora <quem>
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
}

/** Gera o manifesto e o esqueleto de `.orkastery/`. Nao sobrescreve sem `force`. */
export function init(
  dirInicial: string,
  opcoes: { force?: boolean; nome?: string; abbrev?: string } = {}
): ResultadoInit {
  const deteccao = detectar(dirInicial, opcoes.nome, opcoes.abbrev);
  const caminho = path.join(deteccao.raiz, NOME_MANIFESTO);
  const existe = fs.existsSync(caminho);
  if (existe && !opcoes.force) {
    return { caminho, criado: false, deteccao };
  }
  gravar(caminho, manifestoYaml(deteccao));
  fs.mkdirSync(path.join(deteccao.raiz, DIR_ESTADO, 'threads'), { recursive: true });
  return { caminho, criado: true, deteccao };
}

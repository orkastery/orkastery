/**
 * O runner da CI em que o `ork ci run` roda, lido das variaveis que a propria CI define: GitHub Actions
 * (`GITHUB_ACTIONS=true`) ou GitLab CI (`GITLAB_CI=true`). Fora de runner, `null`. Nenhum token e lido; valor com caractere de
 * controle ou fora da forma vale como ausente.
 */
import type { TipoDeForja } from './contrato';

export interface AmbienteDeCi {
  tipo: TipoDeForja;
  /** O produtor que o gate aceita por padrao para o job desta CI (`ci.produtor`). */
  produtor: 'github-actions' | 'gitlab-ci';
  /** O caminho do projeto na forja: `dono/nome` ou `grupo/sub/projeto`. */
  repository: string | null;
  /**
   * A branch da thread: no GitLab, a de origem do MR (tambem no resultado mesclado e no merge train) ou a do push; no
   * GitHub, a do PR ou a do push. `null` em tag.
   */
  branch: string | null;
  /** A pagina do job (GitLab) ou do run (GitHub). */
  url: string | null;
}

const CAMINHO = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;
/** A pagina web, sem credencial na URL (`user:senha@`): a URL vai ao JSON do `ork ci run`. */
const URL_WEB = /^https?:\/\/(?![^/]*@)\S+$/;
const NUMERO = /^\d+$/;

function valor(v: string | undefined, forma?: RegExp): string | null {
  const t = v?.trim();
  if (!t || /\p{Cc}/u.test(t)) return null;
  return !forma || forma.test(t) ? t : null;
}

export function ambienteDeCi(env: NodeJS.ProcessEnv = process.env): AmbienteDeCi | null {
  if (env.GITLAB_CI === 'true') {
    return { tipo: 'gitlab', produtor: 'gitlab-ci', repository: valor(env.CI_PROJECT_PATH, CAMINHO),
      branch: valor(env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME) ?? valor(env.CI_COMMIT_BRANCH), url: valor(env.CI_JOB_URL, URL_WEB) };
  }
  if (env.GITHUB_ACTIONS === 'true') {
    const repository = valor(env.GITHUB_REPOSITORY, CAMINHO);
    const servidor = valor(env.GITHUB_SERVER_URL, URL_WEB), run = valor(env.GITHUB_RUN_ID, NUMERO);
    return { tipo: 'github', produtor: 'github-actions', repository,
      branch: valor(env.GITHUB_HEAD_REF) ?? (env.GITHUB_REF_TYPE === 'branch' ? valor(env.GITHUB_REF_NAME) : null),
      url: servidor && repository && run ? `${servidor}/${repository}/actions/runs/${run}` : null };
  }
  return null;
}

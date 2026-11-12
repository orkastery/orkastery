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
  /** A branch de destino do PR/MR; `null` em push, tag ou quando a forja não a informou. */
  targetBranch: string | null;
  /** A pagina do job (GitLab) ou do run (GitHub). */
  url: string | null;
  /** Só aparece em PR/MR; fork desconhecido é false e a ausência da credencial ainda impede a consulta. */
  pullRequest?: true;
  fork?: boolean;
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
    const repository = valor(env.CI_PROJECT_PATH, CAMINHO), targetBranch = valor(env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME);
    const pullRequest = targetBranch !== null;
    return { tipo: 'gitlab', produtor: 'gitlab-ci', repository,
      branch: valor(env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME) ?? valor(env.CI_COMMIT_BRANCH), targetBranch,
      url: valor(env.CI_JOB_URL, URL_WEB), ...(pullRequest ? { pullRequest: true as const,
        fork: !!env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID && !!env.CI_PROJECT_ID
          && env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID !== env.CI_PROJECT_ID } : {}) };
  }
  if (env.GITHUB_ACTIONS === 'true') {
    const repository = valor(env.GITHUB_REPOSITORY, CAMINHO);
    const servidor = valor(env.GITHUB_SERVER_URL, URL_WEB), run = valor(env.GITHUB_RUN_ID, NUMERO);
    const pullRequest = valor(env.GITHUB_BASE_REF) !== null || /^pull_request(?:_target)?$/.test(env.GITHUB_EVENT_NAME ?? '');
    const headRepository = valor(env.GITHUB_HEAD_REPOSITORY, CAMINHO);
    return { tipo: 'github', produtor: 'github-actions', repository,
      branch: valor(env.GITHUB_HEAD_REF) ?? (env.GITHUB_REF_TYPE === 'branch' ? valor(env.GITHUB_REF_NAME) : null),
      targetBranch: valor(env.GITHUB_BASE_REF),
      url: servidor && repository && run ? `${servidor}/${repository}/actions/runs/${run}` : null,
      ...(pullRequest ? { pullRequest: true as const, fork: !!headRepository && !!repository && headRepository !== repository } : {}) };
  }
  return null;
}

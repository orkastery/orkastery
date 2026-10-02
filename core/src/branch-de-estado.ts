/**
 * I-51 (RM-047): uma branch de estado compartilhada entre maquinas, fora da `main` e sem PR.
 *
 * Nasceu nas reservas do roadmap (I-47) e agora serve tambem ao estado da fabrica. Nada aqui toca
 * a arvore de trabalho nem o indice do repositorio: blobs, arvore e commit sao montados com um
 * indice temporario, e a branch local nunca e criada.
 *
 * A atomicidade vem do proprio git: a versao nova e um commit em cima da ponta lida, e o push
 * nunca e forcado. Push recusado volta `false`, e quem chamou rele a ponta e aplica a propria
 * regra de novo sobre o estado novo.
 *
 * `prefixo` da nome aos erros de quem usa (`roadmap.git`, `fabrica.sem-remoto`...).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SaidaGit { ok: boolean; stdout: string; stderr: string }

export interface OpcoesDeGit { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }

export function git(raiz: string, args: string[], extra: OpcoesDeGit = {}): SaidaGit {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', input: extra.input, timeout: extra.timeoutMs ?? 60000,
    env: { ...process.env, ...extra.env } });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString() };
}

export function exigirGit(raiz: string, args: string[], prefixo: string, extra: OpcoesDeGit = {}): string {
  const r = git(raiz, args, extra);
  if (!r.ok) throw new Error(`${prefixo}.git: git ${args[0]} falhou: ${r.stderr.trim().split('\n').pop() ?? ''}`);
  return r.stdout;
}

export const refRemota = (remoto: string, branch: string): string => `refs/remotes/${remoto}/${branch}`;

/** A ultima copia lida da branch nesta maquina, sem rede. `null` quando nunca foi lida. */
export function pontaLocal(raiz: string, remoto: string, branch: string): string | null {
  const local = git(raiz, ['rev-parse', '--verify', '--quiet', refRemota(remoto, branch)]);
  return local.ok ? local.stdout.trim() : null;
}

/**
 * Traz a ponta da branch. `ponta: null` quando ela ainda nao existe no remoto; sem rede, a ultima
 * copia local com `atualizado: false`.
 */
export function buscarBranch(raiz: string, remoto: string, branch: string, prefixo: string,
  timeoutMs?: number, env?: NodeJS.ProcessEnv): { ponta: string | null; atualizado: boolean } {
  const r = git(raiz, ['fetch', '--quiet', '--no-tags', remoto, `+refs/heads/${branch}:${refRemota(remoto, branch)}`], { timeoutMs, env });
  if (r.ok) return { ponta: exigirGit(raiz, ['rev-parse', '--verify', refRemota(remoto, branch)], prefixo).trim(), atualizado: true };
  if (/couldn't find remote ref|could not find remote ref/i.test(r.stderr)) {
    // A branch ainda nao nasceu: a primeira gravacao a cria. Copia local antiga nao vale mais.
    git(raiz, ['update-ref', '-d', refRemota(remoto, branch)]);
    return { ponta: null, atualizado: true };
  }
  return { ponta: pontaLocal(raiz, remoto, branch), atualizado: false };
}

/** Os `.json` de um diretorio da ponta, ja lidos. Filtro por caminho: diretorio vazio some da arvore. */
export function jsonsDaPonta(raiz: string, ponta: string | null, dir: string, prefixo: string): unknown[] {
  if (!ponta) return [];
  const caminhos = exigirGit(raiz, ['ls-tree', '-r', '--name-only', ponta, '--', `${dir}/`], prefixo)
    .split('\n').filter((n) => n.endsWith('.json'));
  return caminhos.map((c) => JSON.parse(exigirGit(raiz, ['show', `${ponta}:${c}`], prefixo)) as unknown);
}

/** Um arquivo a gravar (`conteudo`) ou a remover (`null`) na versao nova da branch. */
export interface MudancaNaBranch { caminho: string; conteudo: string | null }

/**
 * Grava uma versao nova da branch em cima de `ponta`, sem tocar arvore de trabalho nem indice:
 * indice temporario, blobs, `write-tree` e `commit-tree`. Push sem forca; recusa volta `false`.
 */
export function gravarNaBranch(raiz: string, remoto: string, branch: string, ponta: string | null,
  mudancas: readonly MudancaNaBranch[], mensagem: string, prefixo: string, rede: OpcoesDeGit = {}): string | false {
  const indice = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-branch-estado-')), 'index');
  const env = { GIT_INDEX_FILE: indice };
  try {
    if (ponta) exigirGit(raiz, ['read-tree', ponta], prefixo, { env });
    else exigirGit(raiz, ['read-tree', '--empty'], prefixo, { env });
    for (const m of mudancas) {
      if (m.conteudo === null) {
        exigirGit(raiz, ['update-index', '--force-remove', m.caminho], prefixo, { env });
      } else {
        const blob = exigirGit(raiz, ['hash-object', '-w', '--stdin'], prefixo, { input: m.conteudo }).trim();
        exigirGit(raiz, ['update-index', '--add', '--cacheinfo', `100644,${blob},${m.caminho}`], prefixo, { env });
      }
    }
    const arvore = exigirGit(raiz, ['write-tree'], prefixo, { env }).trim();
    const commit = exigirGit(raiz, ['commit-tree', arvore, ...(ponta ? ['-p', ponta] : []), '-m', mensagem], prefixo).trim();
    // `rede`: prazo e ambiente so do que vai a rede (RM-037, achado A3: o fechamento nao espera 60 s).
    const push = git(raiz, ['push', '--quiet', remoto, `${commit}:refs/heads/${branch}`], rede);
    if (push.ok) {
      git(raiz, ['update-ref', refRemota(remoto, branch), commit]);
      return commit;
    }
    if (/rejected|non-fast-forward|fetch first|stale info|failed to push/i.test(push.stderr)) return false;
    throw new Error(`${prefixo}.sem-remoto: o push para ${remoto} falhou: ${push.stderr.trim().split('\n').pop() ?? ''}`);
  } finally {
    fs.rmSync(path.dirname(indice), { recursive: true, force: true });
  }
}

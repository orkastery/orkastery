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
import { redigirCredenciaisUrl } from './redacao-url';

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

/**
 * Nome de remoto do git, como `origin`, `upstream` ou `meu-remoto.2`. O valor vem do manifesto
 * versionado (`fabrica.remoto`) ou da linha de comando (`--remoto`): quem clona um repositorio roda
 * o `orkastery.yaml` de outra pessoa. Um valor que comece com `-` viraria opcao do git, e uma URL
 * escolheria o transporte (`ext::` roda comando): so este formato chega ao git (RM-047).
 */
export const REMOTO_DO_GIT = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * `true` quando o valor e nome de remoto que pode ir ao git como argumento. Suspeitas da revisao de
 * 03/10: o git aceita `/` no nome (`time/origem`), e a 0.5.2 tambem; cada parte comeca por letra ou
 * digito, entao a barra nao abre caminho absoluto, `.`/`..`, opcao nem transporte.
 */
export const remotoValido = (remoto: unknown): remoto is string =>
  typeof remoto === 'string' && remoto.length <= 64 && REMOTO_DO_GIT.test(remoto) && !remoto.includes('..') && !remoto.endsWith('.');

/**
 * O valor recusado, para a mensagem: sem credencial de URL, sem caractere de controle e curto.
 * A mensagem vai ao terminal, ao log da publicacao em segundo plano e ao ledger.
 */
export function remotoRedigido(remoto: unknown): string {
  if (typeof remoto !== 'string') return `(${remoto === null ? 'null' : typeof remoto})`;
  const semCredencial = redigirCredenciaisUrl(remoto);
  const curto = semCredencial.length > 40 ? `${semCredencial.slice(0, 40)}...` : semCredencial;
  return JSON.stringify(curto);
}

/**
 * Recusa tipada (`<prefixo>.remoto-invalido`) antes de qualquer chamada ao git com o remoto.
 * `prefixo` e o de quem usa: `fabrica` na fabrica, `roadmap` nas reservas.
 */
export function exigirRemoto(remoto: unknown, prefixo: string): string {
  if (remotoValido(remoto)) return remoto;
  throw new Error(`${prefixo}.remoto-invalido: o remoto ${remotoRedigido(remoto)} não é nome de remoto do git ` +
    '(letras, dígitos, ".", "_", "-" e "/" entre partes, cada parte começando por letra ou dígito, sem URL); nada foi passado ao git. ' +
    'Corrija fabrica.remoto no orkastery.yaml ou --remoto (padrão: origin).');
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
  exigirRemoto(remoto, prefixo);
  for (let tentativa = 1; ; tentativa++) {
    // `--`: daqui para a frente, so repositorio e refspec, nunca opcao (RM-047).
    const r = git(raiz, ['fetch', '--quiet', '--no-tags', '--', remoto, `+refs/heads/${branch}:${refRemota(remoto, branch)}`], { timeoutMs, env });
    if (r.ok) return { ponta: exigirGit(raiz, ['rev-parse', '--verify', refRemota(remoto, branch)], prefixo).trim(), atualizado: true };
    if (/couldn't find remote ref|could not find remote ref/i.test(r.stderr)) {
      // A branch ainda nao nasceu: a primeira gravacao a cria. Copia local antiga nao vale mais.
      git(raiz, ['update-ref', '-d', refRemota(remoto, branch)]);
      return { ponta: null, atualizado: true };
    }
    if (tentativa < TENTATIVAS_NA_DISPUTA_DE_REF && DISPUTA_DE_REF.test(r.stderr)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * tentativa);
      continue;
    }
    return { ponta: pontaLocal(raiz, remoto, branch), atualizado: false };
  }
}

/**
 * Suspeitas da revisao de 03/10: dois `fetch` simultaneos na mesma copia (o `ork network status` e a
 * publicacao no cache da casa, a leitura e a gravacao da fabrica no clone) disputam o lock da ref
 * remota, e o perdedor sai com "incorrect old value provided" (ou "cannot lock ref") sem que a rede
 * tenha falhado. A ref ja foi atualizada pelo vencedor: buscar de novo da certo.
 */
const DISPUTA_DE_REF = /incorrect old value provided|cannot lock ref|unable to create '[^']*\.lock'|is at [0-9a-f]+ but expected/i;
const TENTATIVAS_NA_DISPUTA_DE_REF = 5;

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
  exigirRemoto(remoto, prefixo);
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
    const push = git(raiz, ['push', '--quiet', '--', remoto, `${commit}:refs/heads/${branch}`], rede);
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

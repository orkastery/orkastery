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
import { ErroDoCatalogo } from './locale';

export interface SaidaGit { ok: boolean; stdout: string; stderr: string }

export interface OpcoesDeGit { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }

export function git(raiz: string, args: string[], extra: OpcoesDeGit = {}): SaidaGit {
  const r = spawnSync('git', args, { cwd: raiz, encoding: 'utf8', input: extra.input, timeout: extra.timeoutMs ?? 60000,
    env: { ...process.env, ...extra.env } });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString() };
}

export function exigirGit(raiz: string, args: string[], prefixo: string, extra: OpcoesDeGit = {}): string {
  const r = git(raiz, args, extra);
  if (!r.ok) {
    // RM-061 (F3b, GO-FIX 1): pelo catalogo, com o codigo `<prefixo>.git` igual; a saida do git vai como veio.
    const comando = args[0], saida = r.stderr.trim().split('\n').pop() ?? '';
    throw new ErroDoCatalogo((m) => m.estado.gitFalhou(prefixo, comando, saida));
  }
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
  // RM-061 (F3b): a recusa nasce do catalogo; o codigo `<prefixo>.remoto-invalido` e o mesmo nas duas linguas.
  const redigido = remotoRedigido(remoto);
  throw new ErroDoCatalogo((m) => m.estado.remotoInvalido(prefixo, redigido));
}

/**
 * RM-047 (fronteira de confiança): nome de branch que pode ir ao git como argumento. O valor vem do
 * `worktree.base_branch` do manifesto, do campo `para` do ledger ou do frontmatter, e todos podem ser
 * do clone: um nome que começa com `-` viraria opção do git (`--output=<arquivo>` grava arquivo).
 * A regra é a do `git check-ref-format --branch`, então nenhum nome que o git aceite é recusado.
 */
export function branchValida(branch: unknown): branch is string {
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 255) return false;
  if (branch.startsWith('-') || branch === '@' || branch.includes('..') || branch.includes('@{')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(branch)) return false;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//') || branch.endsWith('.')) return false;
  return branch.split('/').every((parte) => !parte.startsWith('.') && !parte.endsWith('.lock'));
}

/** Sha hexadecimal (abreviado ou inteiro, SHA-1 ou SHA-256): o único formato de commit lido do ledger que vai ao git. */
export const shaValido = (sha: unknown): sha is string => typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha);

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
  mudancas: readonly MudancaNaBranch[], mensagem: string, prefixo: string, rede: OpcoesDeGit = {},
  autor?: { nome: string; email: string }): string | false {
  exigirRemoto(remoto, prefixo);
  const indice = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-branch-estado-')), 'index');
  const env = { GIT_INDEX_FILE: indice };
  try {
    if (ponta) exigirGit(raiz, ['read-tree', ponta], prefixo, { env });
    else exigirGit(raiz, ['read-tree', '--empty'], prefixo, { env });
    for (const [i, m] of mudancas.entries()) {
      if (m.conteudo === null) {
        exigirGit(raiz, ['update-index', '--force-remove', m.caminho], prefixo, { env });
      } else {
        // `spawnSync` nem sempre fecha o pipe de entrada em runtimes hospedados, deixando o
        // `hash-object --stdin` preso mesmo depois de receber todos os bytes. Um arquivo privado no
        // mesmo diretorio temporario conserva o conteudo exato e torna o termino deterministico.
        const conteudo = path.join(path.dirname(indice), `conteudo-${i}`);
        fs.writeFileSync(conteudo, m.conteudo, { mode: 0o600 });
        const blob = exigirGit(raiz, ['hash-object', '-w', conteudo], prefixo).trim();
        exigirGit(raiz, ['update-index', '--add', '--cacheinfo', `100644,${blob},${m.caminho}`], prefixo, { env });
      }
    }
    const arvore = exigirGit(raiz, ['write-tree'], prefixo, { env }).trim();
    // RM-058 N3 (S6 da revisão da ork-rm058n3): quem grava pode dar a identidade do commit, para a do git da pessoa não ir ao remoto.
    const identidade = autor ? { env: { GIT_AUTHOR_NAME: autor.nome, GIT_AUTHOR_EMAIL: autor.email, GIT_COMMITTER_NAME: autor.nome,
      GIT_COMMITTER_EMAIL: autor.email } } : {};
    const commit = exigirGit(raiz, ['commit-tree', arvore, ...(ponta ? ['-p', ponta] : []), '-m', mensagem], prefixo, identidade).trim();
    // `rede`: prazo e ambiente so do que vai a rede (RM-037, achado A3: o fechamento nao espera 60 s).
    const push = git(raiz, ['push', '--quiet', '--', remoto, `${commit}:refs/heads/${branch}`], rede);
    if (push.ok) {
      git(raiz, ['update-ref', refRemota(remoto, branch), commit]);
      return commit;
    }
    if (/rejected|non-fast-forward|fetch first|stale info|failed to push/i.test(push.stderr)) return false;
    const saida = push.stderr.trim().split('\n').pop() ?? '';
    throw new ErroDoCatalogo((m) => m.estado.pushFalhou(prefixo, remoto, saida));
  } finally {
    fs.rmSync(path.dirname(indice), { recursive: true, force: true });
  }
}

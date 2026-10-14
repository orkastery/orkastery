/**
 * Como cada CLI e chamada para uma forja resolvida: o host vai sempre explicito, a CA do manifesto entra pelo meio
 * que a CLI le, e a versao minima fica fixa aqui. O `gh` recebe `--hostname host`, ou `GH_HOST=host:porta` quando ha
 * porta (ele recusa `--hostname` com porta). O `glab` recusa
 * `--hostname` com porta na API: ela vai por `GITLAB_HOST=host[:porta]`, e a CA por `GLAB_CA_CERT`. O caminho base
 * nunca entra no host: o `glab auth login --hostname H/sub` guarda o login como `H`, com `subfolder`, e acrescenta
 * `/sub/api/v4` sozinho. Por isso duas instancias no mesmo host, em subcaminhos diferentes, nao coexistem no `glab`.
 * Uma forja nova acrescenta a linha dela.
 */
import type { ForjaResolvida, TipoDeForja } from './contrato';

export type AlvoDaCli = Pick<ForjaResolvida, 'tipo' | 'host' | 'porta' | 'caminhoBase' | 'ca'>;

/** `host` ou `host:porta`, sem a porta padrao do HTTPS e sem o caminho base: e tambem a chave do login da CLI. */
export const hostDaApi = (f: Pick<ForjaResolvida, 'host' | 'porta'>): string =>
  (f.porta !== null && f.porta !== 443 ? `${f.host}:${f.porta}` : f.host);

export interface CliDaForja {
  cmd: 'gh' | 'glab';
  /** A versao minima que o adaptador usa. */
  minima: string;
  /** Sem login no host, a CLI faz o pedido anonimo: o login e conferido antes da primeira chamada. */
  loginAntes: boolean;
  ambiente(f: AlvoDaCli): { acrescentar: Record<string, string>; apagar: string[] };
  /** O argv de uma chamada REST com `-i` (status e cabecalhos na saida); o corpo, quando ha, vai pelo stdin. */
  api(f: AlvoDaCli, metodo: string, caminho: string, comCorpo: boolean): string[];
  /** O argv que sai 0 so com login no host. */
  login(f: AlvoDaCli): string[];
  /** O comando de login que a pessoa roda (o `ork` nunca o roda; o token vai pelo stdin dela). */
  entrar(f: AlvoDaCli, http: boolean): string[];
  /** A versao lida da saida de `--version`. */
  lerVersao(saida: string): string | null;
}

const SEM_PROMPT = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', NO_COLOR: '1' };

/** O host com porta: o `gh` recusa `--hostname host:porta` (medido no 2.102.0) e o recebe por `GH_HOST`. */
const comPorta = (f: AlvoDaCli): boolean => hostDaApi(f) !== f.host;
const hostnameDoGh = (f: AlvoDaCli): string[] => (comPorta(f) ? [] : ['--hostname', f.host]);

export const CLI_DA_FORJA: Readonly<Record<TipoDeForja, CliDaForja>> = {
  github: {
    cmd: 'gh',
    // 2.18.0, medida: `pr list --json` com `headRefOid`, `api -i`, `auth status --hostname`, `auth git-credential`, `--body-file`.
    minima: '2.18.0',
    loginAntes: false,
    // O gh nao tem opcao de CA; o Go le SSL_CERT_FILE no Linux. O GH_HOST herdado sai, salvo quando e o nosso (host:porta).
    ambiente: (f) => ({
      acrescentar: { ...SEM_PROMPT, ...(comPorta(f) ? { GH_HOST: hostDaApi(f) } : {}), ...(f.ca ? { SSL_CERT_FILE: f.ca } : {}) },
      apagar: [...(comPorta(f) ? [] : ['GH_HOST']), 'GH_REPO', 'GH_FORCE_TTY'],
    }),
    api: (f, metodo, caminho, comCorpo) => ['api', ...hostnameDoGh(f), '-i', '--method', metodo,
      '-H', 'Accept: application/vnd.github+json', caminho, ...(comCorpo ? ['--input', '-'] : [])],
    login: (f) => ['auth', 'status', ...hostnameDoGh(f)],
    entrar: (f) => (comPorta(f) ? [`GH_HOST=${hostDaApi(f)}`, 'gh', 'auth', 'login'] : ['gh', 'auth', 'login', '--hostname', f.host]),
    lerVersao: (s) => /^gh version (\d+\.\d+\.\d+)/m.exec(s)?.[1] ?? null,
  },
  gitlab: {
    cmd: 'glab',
    // 1.121.0, medida: GITLAB_HOST com porta, login com subcaminho, `auth git-credential`, GLAB_CA_CERT, `api -i`.
    minima: '1.121.0',
    loginAntes: true,
    ambiente: (f) => ({
      acrescentar: { ...SEM_PROMPT, GITLAB_HOST: hostDaApi(f), ...(f.ca ? { GLAB_CA_CERT: f.ca } : {}) },
      // Estas mudariam o host ou a CA por fora do GITLAB_HOST.
      apagar: ['GITLAB_URI', 'GL_HOST', 'GITLAB_API_HOST', 'CA_CERT'],
    }),
    // Sem Content-Type, o GitLab ignora o corpo do `--input -` (medido).
    api: (_f, metodo, caminho, comCorpo) => ['api', '-i', '--method', metodo, caminho,
      ...(comCorpo ? ['-H', 'Content-Type: application/json', '--input', '-'] : [])],
    login: (f) => ['auth', 'status', '--hostname', hostDaApi(f)],
    entrar: (f, http) => ['glab', 'auth', 'login', '--hostname', `${hostDaApi(f)}${f.caminhoBase}`, ...(http ? ['--api-protocol', 'http'] : []), '--stdin'],
    lerVersao: (s) => /^glab (?:version )?(\d+\.\d+\.\d+)/m.exec(s)?.[1] ?? null,
  },
};

/** `versao` (x.y.z) abaixo de `minima`? */
export function versaoAbaixo(versao: string, minima: string): boolean {
  const a = versao.split('.').map(Number), b = minima.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

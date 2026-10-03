/**
 * RM-054 (fatia 1): a forja do projeto, lida sem clone e so com consulta.
 *
 * `ork/fabrica-estado` e `ork/roadmap-reservas` vivem no remoto de UM repositorio, e um host fora
 * de um clone (o gateway do OpenClaw, um cron) nao enxergava nenhuma das duas. Aqui a leitura vai
 * direto a forja, pela CLI dela ja autenticada (`gh`, `glab`): nenhum token e lido, copiado ou
 * passado em argumento, e so consulta sai daqui (GraphQL sem mutation e GET no REST). O corpo da
 * consulta vai pelo stdin, com os nomes em variaveis: nada do pedido e interpolado no texto.
 *
 * GitHub responde tudo em UMA consulta: a base com `docs/roadmap`, o manifesto e os commits desde
 * `desde`, e as duas branches de estado, cada parte no commit que a propria consulta devolve.
 * GitLab devolve a mesma leitura por consultas GraphQL e pelo REST de commits; sem `glab` na
 * maquina que construiu, o esquema dele esta provado so com resposta simulada (D4 do PLAN).
 *
 * Resposta fora do formato vira erro tipado, nunca lista vazia: quem le nao confunde "nao li" com
 * "nao tem".
 */
import { spawnSync } from 'node:child_process';
import { redigirSegredos } from './hitl';
import { procurarSegredos } from './policies';
import { acharBinario } from './rede-forja';

export type TipoDeForja = 'github' | 'gitlab';

/** O repositorio na forja: `repo` e `dono/nome` no GitHub e o caminho completo no GitLab. */
export interface IdentidadeDaForja { tipo: TipoDeForja; host: string; repo: string }

export type CodigoDeErroDaForja = 'forja.ausente' | 'forja.sem-login' | 'forja.nao-encontrado' | 'forja.tempo-esgotado'
  | 'forja.inacessivel' | 'forja.resposta-invalida';

export interface ErroDaForja { codigo: CodigoDeErroDaForja; detalhe: string }

/** `texto` e null quando o blob e binario ou veio truncado: a pagina existe e nao foi lida. */
export interface ArquivoDaForja { caminho: string; texto: string | null }

/**
 * A ponta de uma branch; `arquivos` e null quando o diretorio pedido nao existe nela. `parcial`: a
 * forja cortou a listagem (conexao paginada do GitLab), e o que faltou nao pode virar ausencia.
 */
export interface PontaDaForja { ref: string; commit: string; dataDoCommit: string | null; arquivos: ArquivoDaForja[] | null; parcial: boolean }

export interface CommitDaBase { commit: string; assunto: string; data: string }

export interface LeituraDaForja {
  forja: IdentidadeDaForja;
  lidoEm: string;
  /** Quantas chamadas a CLI da forja a leitura custou. */
  chamadas: number;
  /** null: o repositorio nao tem a branch base (ou esta vazio). `commitsParciais`: havia mais de 100 na janela. */
  base: (PontaDaForja & { manifesto: string | null; commits: CommitDaBase[]; commitsParciais: boolean }) | null;
  /** null: a branch nao existe no remoto. */
  reservas: PontaDaForja | null;
  fabrica: PontaDaForja | null;
}

export type ResultadoDaForja = { ok: true; leitura: LeituraDaForja } | { ok: false; erro: ErroDaForja };

export interface BranchDeEstado { branch: string; dir: string }

export interface PedidoDaForja {
  /** A branch base do manifesto; sem ela vale a branch padrao do repositorio. */
  base?: string | null;
  /** Commits da base desde este instante (ISO), para as entregas do dia. */
  desde: string;
  dirRoadmap: string;
  manifesto: string;
  reservas: BranchDeEstado;
  fabrica: BranchDeEstado;
  lidoEm?: string;
}

export interface SaidaDoExecutor { status: number | null; stdout: string; stderr: string; sinal?: string | null; erro?: string }

/** Quem roda a CLI da forja. Os testes trocam por uma resposta gravada. */
export type ExecutorDaForja = (cmd: 'gh' | 'glab', args: readonly string[], entrada: string, timeoutMs: number) => SaidaDoExecutor;

const PRAZO_MS = 30000;
const SHA = /^[0-9a-f]{40}$/;
const SEGMENTO = /^[A-Za-z0-9_.-]+$/;
/** Hostname de verdade: rotulos alfanumericos separados por ponto (`..` ou `a..b` nao passam). */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Sem shell, sem token: a CLI usa a autenticacao que ja tem; prompt e aviso de versao desligados.
 * RM-054 (fatia 3): o binario e procurado como na rede (D11 da RM-053), no PATH e depois nas pastas de
 * usuario (`~/.local/bin` e as outras): o gateway e o cron rodam com PATH curto, e o `gh` da srvjcp86
 * mora em `~/.local/bin`. Sem achar, o nome vai cru ao spawn, e o ENOENT continua `forja.ausente`.
 */
export const executorPadrao: ExecutorDaForja = (cmd, args, entrada, timeoutMs) => {
  const r = spawnSync(acharBinario(cmd) ?? cmd, [...args], {
    input: entrada, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GLAB_CHECK_UPDATE: 'false', NO_COLOR: '1' },
  });
  return { status: r.status, stdout: (r.stdout ?? '').toString(), stderr: (r.stderr ?? '').toString(), sinal: r.signal ?? null,
    ...(r.error ? { erro: (r.error as NodeJS.ErrnoException).code ?? r.error.message } : {}) };
};

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

function tipoDoHost(host: string): TipoDeForja | null {
  if (host === 'github.com' || /(^|[.-])github([.-]|$)/.test(host)) return 'github';
  if (host === 'gitlab.com' || /(^|[.-])gitlab([.-]|$)/.test(host)) return 'gitlab';
  return null;
}

function montar(tipo: TipoDeForja, host: string, caminho: string): IdentidadeDaForja | null {
  if (!HOST.test(host)) return null;
  const partes = caminho.replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  if (partes.some((p) => !SEGMENTO.test(p) || p === '.' || p === '..')) return null;
  if (tipo === 'github' ? partes.length !== 2 : partes.length < 2) return null;
  return { tipo, host, repo: partes.join('/') };
}

/**
 * RM-037 (fatia 5, A5): o host e o caminho de uma URL de remoto (https, ssh ou scp), de qualquer forja. Credencial
 * na URL nunca entra; caminho local e host que nao e hostname voltam null.
 */
export function enderecoDoRemoto(url: string): { host: string; caminho: string } | null {
  const t = url.trim();
  const esquema = /^(?:https?|ssh|git|git\+ssh|ssh\+git):\/\/(?:[^@/]*@)?([^/:?#@]+)(?::\d+)?\/([^?#\s]+)$/i.exec(t);
  const scp = esquema ? null : /^(?:[^@\s/:]+@)?([^:\s/@]+):(?!\/\/)([^\s]+)$/.exec(t);
  const achado = esquema ?? scp;
  if (!achado) return null;
  const host = achado[1].toLowerCase();
  return HOST.test(host) ? { host, caminho: achado[2].replace(/^\/+/, '') } : null;
}

/**
 * RM-037 (fatia 5, A5): o `dono/nome` de um repositorio do GitHub no host do remoto, com qualquer host: o GitHub
 * Enterprise mora em host proprio, com ou sem "github" no nome. Quem diz se o host e mesmo um GitHub e o `gh`.
 */
export function repositorioGithubNoHost(url: string): IdentidadeDaForja | null {
  const endereco = enderecoDoRemoto(url);
  return endereco && tipoDoHost(endereco.host) !== 'gitlab' ? montar('github', endereco.host, endereco.caminho) : null;
}

/**
 * A forja de uma URL de remoto (https, ssh ou scp). Credencial na URL nunca entra na identidade;
 * caminho local e forja desconhecida voltam null.
 */
export function identidadeDaForja(url: string): IdentidadeDaForja | null {
  const endereco = enderecoDoRemoto(url);
  const tipo = endereco ? tipoDoHost(endereco.host) : null;
  return endereco && tipo ? montar(tipo, endereco.host, endereco.caminho) : null;
}

/** `github:dono/repo`, `gitlab:grupo/sub/repo` (com host proprio: `gitlab:host.tld/grupo/repo`) ou uma URL. */
export function forjaDoArgumento(texto: string): IdentidadeDaForja | null {
  const t = texto.trim();
  const m = /^(github|gitlab):(?:\/\/)?(.+)$/i.exec(t);
  if (m) {
    const tipo = m[1].toLowerCase() as TipoDeForja;
    const partes = m[2].replace(/^\/+/, '').split('/');
    const comHost = partes.length > 2 && partes[0].includes('.');
    const host = comHost ? partes[0].toLowerCase() : tipo === 'github' ? 'github.com' : 'gitlab.com';
    return montar(tipo, host, (comHost ? partes.slice(1) : partes).join('/'));
  }
  return /^[a-z+]+:\/\//i.test(t) || /^[^@\s/:]+@[^:\s/]+:/.test(t) ? identidadeDaForja(t) : null;
}

/** Como a forja aparece para gente: `github.com/orkastery/orkastery`. */
export const rotuloDaForja = (f: IdentidadeDaForja): string => `${f.host}/${f.repo}`;

export const mesmaForja = (a: IdentidadeDaForja | null, b: IdentidadeDaForja | null): boolean =>
  !!a && !!b && a.tipo === b.tipo && a.host === b.host && a.repo.toLowerCase() === b.repo.toLowerCase();

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** O fim da saida de erro, sem segredo: redigido, e descartado inteiro se ainda casar um padrao. */
export function detalheSeguro(texto: string): string {
  const redigido = redigirSegredos(texto)
    .replace(/\b(?:glpat|gldt|glrt|glptt|glcbt)-[A-Za-z0-9_-]{16,}\b/g, '[redigido]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redigido]');
  const linha = redigido.split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ').slice(0, 240);
  return procurarSegredos(linha).length ? '[detalhe omitido: um padrão de segredo casou]' : linha;
}

function erro(codigo: CodigoDeErroDaForja, detalhe: string): { ok: false; erro: ErroDaForja } {
  return { ok: false, erro: { codigo, detalhe } };
}

/** O motivo tipado de uma chamada que falhou. */
export function classificarFalha(cmd: 'gh' | 'glab', s: SaidaDoExecutor): ErroDaForja {
  if (s.erro === 'ENOENT') return { codigo: 'forja.ausente', detalhe: `${cmd} não está instalado nesta máquina` };
  if (s.erro === 'ETIMEDOUT' || s.sinal === 'SIGTERM') return { codigo: 'forja.tempo-esgotado', detalhe: `${cmd} não respondeu em ${PRAZO_MS / 1000} s` };
  const texto = `${s.stderr}\n${s.stdout}`;
  const detalhe = detalheSeguro(s.stderr || s.stdout || s.erro || `${cmd} saiu com ${s.status}`);
  if (/"type"\s*:\s*"NOT_FOUND"|Could not resolve to a Repository|404 Not Found|HTTP 404|project not found/i.test(texto)) {
    return { codigo: 'forja.nao-encontrado', detalhe };
  }
  if (/auth login|not logged|authentication|HTTP 401|Bad credentials|GH_TOKEN|GITLAB_TOKEN|unauthorized|no token/i.test(texto)) {
    return { codigo: 'forja.sem-login', detalhe };
  }
  return { codigo: 'forja.inacessivel', detalhe };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
class RespostaInvalida extends Error {}
class NaoEncontrado extends Error {}
const exigir = (condicao: unknown, onde: string): void => { if (!condicao) throw new RespostaInvalida(onde); };

function chamarJson(executor: ExecutorDaForja, cmd: 'gh' | 'glab', args: string[], corpo: string):
  { ok: true; json: unknown } | { ok: false; erro: ErroDaForja } {
  const s = executor(cmd, args, corpo, PRAZO_MS);
  let json: unknown;
  try { json = JSON.parse(s.stdout); } catch { json = undefined; }
  const erros = obj(json) && Array.isArray(json.errors) && json.errors.length > 0;
  if (s.erro || s.status !== 0 || erros) {
    const falha = classificarFalha(cmd, s.erro || s.status !== 0 ? s : { ...s, status: 1, stderr: JSON.stringify(json) });
    // `gh` sai 1 com NOT_FOUND no corpo: o tipo do erro GraphQL vale mais que a frase.
    if (erros && (json as { errors: unknown[] }).errors.some((e) => obj(e) && e.type === 'NOT_FOUND')) {
      return { ok: false, erro: { codigo: 'forja.nao-encontrado', detalhe: falha.detalhe } };
    }
    return { ok: false, erro: falha };
  }
  if (json === undefined) return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: `${cmd} não devolveu JSON` } };
  return { ok: true, json };
}

/**
 * O host vai sempre explicito: sem ele, o `gh` usa `GH_HOST` ou o unico host com login, e o `glab`,
 * o host do remoto do cwd; a consulta iria para outra forja.
 */
const hostnameDe = (f: IdentidadeDaForja): string[] => ['--hostname', f.host];

function arquivosDoGithub(entrada: unknown, dir: string): ArquivoDaForja[] | null {
  if (entrada === null) return null;
  exigir(obj(entrada), `${dir}: entrada`);
  const objeto = (entrada as Json).object;
  if (objeto === null) return null;
  exigir(obj(objeto) && Array.isArray((objeto as Json).entries), `${dir}: diretorio`);
  return ((objeto as Json).entries as unknown[]).filter((e) => obj(e) && e.type === 'blob').map((e) => {
    const x = e as Json, blob = obj(x.object) ? x.object : {};
    exigir(typeof x.name === 'string', `${dir}: nome`);
    const legivel = typeof blob.text === 'string' && blob.isBinary !== true && blob.isTruncated !== true;
    return { caminho: `${dir}/${x.name as string}`, texto: legivel ? blob.text as string : null };
  });
}

function pontaDoGithub(ref: unknown, onde: string): { commit: string; dataDoCommit: string | null; nome: string; alvo: Json } | null {
  if (ref === null) return null;
  exigir(obj(ref) && obj((ref as Json).target), `${onde}: ref`);
  const alvo = (ref as Json).target as Json;
  exigir(typeof alvo.oid === 'string' && SHA.test(alvo.oid), `${onde}: commit`);
  return { commit: alvo.oid as string, dataDoCommit: typeof alvo.committedDate === 'string' ? alvo.committedDate : null,
    nome: typeof (ref as Json).name === 'string' ? (ref as Json).name as string : onde, alvo };
}

/** Os commits de um `history` do GitHub, e se a forja cortou a pagina (mais de 100 na janela). */
function commitsDoHistorico(historico: unknown, onde: string): { commits: CommitDaBase[]; parciais: boolean } {
  const h = obj(historico) ? historico : {};
  const nos = h.nodes ?? [];
  exigir(Array.isArray(nos), `${onde}: commits`);
  return {
    commits: (nos as unknown[]).filter(obj).map((n) => {
      exigir(typeof n.oid === 'string' && typeof n.messageHeadline === 'string' && typeof n.committedDate === 'string', `${onde}: commit`);
      return { commit: n.oid as string, assunto: n.messageHeadline as string, data: n.committedDate as string };
    }),
    parciais: obj(h.pageInfo) && (h.pageInfo as Json).hasNextPage === true,
  };
}

/** Os commits da base desde `desde`, pelo REST do GitLab (GET), e se vieram 100 (pagina cheia). */
function commitsDoGitlab(forja: IdentidadeDaForja, commit: string, desde: string, executor: ExecutorDaForja):
  { ok: true; commits: CommitDaBase[]; parciais: boolean } | { ok: false; erro: ErroDaForja } {
  const rest = executor('glab', ['api', `projects/${encodeURIComponent(forja.repo)}/repository/commits?ref_name=${encodeURIComponent(commit)}` +
    `&since=${encodeURIComponent(desde)}&per_page=100`, ...hostnameDe(forja)], '', PRAZO_MS);
  if (rest.erro || rest.status !== 0) return { ok: false, erro: classificarFalha('glab', rest) };
  let lista: unknown;
  try { lista = JSON.parse(rest.stdout); } catch { lista = undefined; }
  exigir(Array.isArray(lista), 'commits');
  const commits = (lista as unknown[]).map((c) => {
    exigir(obj(c) && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.committed_date === 'string', 'commit');
    return { commit: (c as Json).id as string, assunto: (c as Json).title as string, data: (c as Json).committed_date as string };
  });
  return { ok: true, commits, parciais: commits.length >= 100 };
}

function consultaDoGithub(comBase: boolean): string {
  return `query($owner: String!, $name: String!${comBase ? ', $base: String!' : ''}, $desde: GitTimestamp!, $dirRoadmap: String!,
  $manifesto: String!, $refReservas: String!, $dirReservas: String!, $refFabrica: String!, $dirFabrica: String!) {
  repository(owner: $owner, name: $name) {
    base: ${comBase ? 'ref(qualifiedName: $base)' : 'defaultBranchRef'} { name target { ... on Commit { oid committedDate
      roadmap: file(path: $dirRoadmap) { object { ...Arquivos } }
      manifesto: file(path: $manifesto) { object { ... on Blob { text isBinary isTruncated } } }
      history(since: $desde, first: 100) { pageInfo { hasNextPage } nodes { oid messageHeadline committedDate } } } } }
    reservas: ref(qualifiedName: $refReservas) { name target { ... on Commit { oid committedDate
      arquivos: file(path: $dirReservas) { object { ...Arquivos } } } } }
    fabrica: ref(qualifiedName: $refFabrica) { name target { ... on Commit { oid committedDate
      arquivos: file(path: $dirFabrica) { object { ...Arquivos } } } } }
  }
}
fragment Arquivos on Tree { entries { name type object { ... on Blob { text isBinary isTruncated } } } }`;
}

function lerDoGithub(forja: IdentidadeDaForja, pedido: PedidoDaForja, executor: ExecutorDaForja, lidoEm: string): ResultadoDaForja {
  const [owner, name] = forja.repo.split('/');
  const comBase = !!pedido.base;
  const corpo = JSON.stringify({ query: consultaDoGithub(comBase), variables: {
    owner, name, ...(comBase ? { base: `refs/heads/${pedido.base}` } : {}), desde: pedido.desde,
    dirRoadmap: pedido.dirRoadmap, manifesto: pedido.manifesto,
    refReservas: `refs/heads/${pedido.reservas.branch}`, dirReservas: pedido.reservas.dir,
    refFabrica: `refs/heads/${pedido.fabrica.branch}`, dirFabrica: pedido.fabrica.dir,
  } });
  const r = chamarJson(executor, 'gh', ['api', 'graphql', '--method', 'POST', '--input', '-', ...hostnameDe(forja)], corpo);
  if (!r.ok) return r;
  const dados = obj(r.json) ? (r.json as Json).data : undefined;
  exigir(obj(dados) && obj((dados as Json).repository), 'repositorio');
  const repo = (dados as Json).repository as Json;
  const base = pontaDoGithub(repo.base ?? null, 'base');
  let leituraDaBase: LeituraDaForja['base'] = null;
  if (base) {
    const manifesto = obj(base.alvo.manifesto) && obj((base.alvo.manifesto as Json).object) &&
      typeof ((base.alvo.manifesto as Json).object as Json).text === 'string' ? ((base.alvo.manifesto as Json).object as Json).text as string : null;
    const historico = commitsDoHistorico(base.alvo.history, 'base');
    leituraDaBase = { ref: base.nome, commit: base.commit, dataDoCommit: base.dataDoCommit,
      arquivos: arquivosDoGithub(base.alvo.roadmap ?? null, pedido.dirRoadmap), parcial: false, manifesto,
      commits: historico.commits, commitsParciais: historico.parciais };
  }
  const estado = (bruto: unknown, b: BranchDeEstado): PontaDaForja | null => {
    const p = pontaDoGithub(bruto ?? null, b.branch);
    return p ? { ref: b.branch, commit: p.commit, dataDoCommit: p.dataDoCommit, arquivos: arquivosDoGithub(p.alvo.arquivos ?? null, b.dir),
      parcial: false } : null;
  };
  return { ok: true, leitura: { forja, lidoEm, chamadas: 1, base: leituraDaBase,
    reservas: estado(repo.reservas, pedido.reservas), fabrica: estado(repo.fabrica, pedido.fabrica) } };
}

const CONSULTA_RAIZ_GITLAB = 'query($path: ID!) { project(fullPath: $path) { repository { rootRef } } }';

const CONSULTA_ARVORES_GITLAB = `query($path: ID!, $base: String!, $dirRoadmap: String!, $refReservas: String!, $dirReservas: String!,
  $refFabrica: String!, $dirFabrica: String!) {
  project(fullPath: $path) { repository {
    baseTopo: tree(ref: $base) { lastCommit { sha committedDate } }
    baseDir: tree(ref: $base, path: $dirRoadmap) { blobs(first: 100) { pageInfo { hasNextPage } nodes { name path } } }
    reservasTopo: tree(ref: $refReservas) { lastCommit { sha committedDate } }
    reservasDir: tree(ref: $refReservas, path: $dirReservas) { blobs(first: 100) { pageInfo { hasNextPage } nodes { name path } } }
    fabricaTopo: tree(ref: $refFabrica) { lastCommit { sha committedDate } }
    fabricaDir: tree(ref: $refFabrica, path: $dirFabrica) { blobs(first: 100) { pageInfo { hasNextPage } nodes { name path } } }
  } }
}`;

/** Os blobs de cada ponta que existe; so as partes pedidas entram na consulta (texto fixo, sem interpolar o pedido). */
function consultaDeBlobsDoGitlab(partes: readonly ('base' | 'reservas' | 'fabrica')[]): string {
  const sufixo = { base: 'Base', reservas: 'Reservas', fabrica: 'Fabrica' };
  const declaracoes = ['$path: ID!', ...partes.flatMap((p) => [`$ref${sufixo[p]}: String!`, `$paths${sufixo[p]}: [String!]!`])];
  const campos = partes.map((p) => `${p}: blobs(ref: $ref${sufixo[p]}, paths: $paths${sufixo[p]}, first: 100) ` +
    '{ pageInfo { hasNextPage } nodes { path rawTextBlob } }');
  return `query(${declaracoes.join(', ')}) { project(fullPath: $path) { repository { ${campos.join(' ')} } } }`;
}

function lerDoGitlab(forja: IdentidadeDaForja, pedido: PedidoDaForja, executor: ExecutorDaForja, lidoEm: string): ResultadoDaForja {
  const args = ['api', 'graphql', '--method', 'POST', '--input', '-', ...hostnameDe(forja)];
  let chamadas = 0;
  const graphql = (query: string, variables: Json) => { chamadas++; return chamarJson(executor, 'glab', args, JSON.stringify({ query, variables })); };
  const repositorio = (json: unknown): Json => {
    const projeto = obj(json) && obj((json as Json).data) ? ((json as Json).data as Json).project : undefined;
    if (projeto === null) throw new NaoEncontrado();
    exigir(obj(projeto) && obj((projeto as Json).repository), 'repositorio');
    return (projeto as Json).repository as Json;
  };
  let base = pedido.base ?? null;
  if (!base) {
    const r = graphql(CONSULTA_RAIZ_GITLAB, { path: forja.repo });
    if (!r.ok) return r;
    const raiz = repositorio(r.json).rootRef;
    base = typeof raiz === 'string' && raiz ? raiz : null;
  }
  const arvores = graphql(CONSULTA_ARVORES_GITLAB, { path: forja.repo, base: base ?? 'HEAD', dirRoadmap: pedido.dirRoadmap,
    refReservas: pedido.reservas.branch, dirReservas: pedido.reservas.dir, refFabrica: pedido.fabrica.branch, dirFabrica: pedido.fabrica.dir });
  if (!arvores.ok) return arvores;
  const repo = repositorio(arvores.json);
  const topo = (chave: string): { commit: string; dataDoCommit: string | null } | null => {
    const arvore = repo[chave];
    if (!obj(arvore) || arvore.lastCommit === null || arvore.lastCommit === undefined) return null;
    const c = arvore.lastCommit as Json;
    exigir(obj(c) && typeof c.sha === 'string' && SHA.test(c.sha), `${chave}: commit`);
    return { commit: c.sha as string, dataDoCommit: typeof c.committedDate === 'string' ? c.committedDate : null };
  };
  const cortadas = new Set<string>();
  const cortou = (conexao: Json, chave: string): void => {
    if (obj(conexao.pageInfo) && (conexao.pageInfo as Json).hasNextPage === true) cortadas.add(chave);
  };
  const caminhos = (chave: string): string[] | null => {
    const arvore = repo[chave];
    if (!obj(arvore)) return null;
    exigir(obj(arvore.blobs) && Array.isArray((arvore.blobs as Json).nodes), `${chave}: blobs`);
    cortou(arvore.blobs as Json, chave);
    return ((arvore.blobs as Json).nodes as unknown[]).map((n) => {
      exigir(obj(n) && typeof n.path === 'string', `${chave}: caminho`);
      return (n as Json).path as string;
    });
  };
  const [pontaBase, pontaReservas, pontaFabrica] = [base ? topo('baseTopo') : null, topo('reservasTopo'), topo('fabricaTopo')];
  const dirBase = pontaBase ? caminhos('baseDir') : null;
  const dirReservas = pontaReservas ? caminhos('reservasDir') : null, dirFabrica = pontaFabrica ? caminhos('fabricaDir') : null;
  const pedidos = ([
    ['base', pontaBase, pontaBase ? [...(dirBase ?? []), pedido.manifesto] : []],
    ['reservas', pontaReservas, dirReservas ?? []],
    ['fabrica', pontaFabrica, dirFabrica ?? []],
  ] as const).filter(([, ponta, paths]) => ponta && paths.length > 0);
  let conteudo: Json = {};
  if (pedidos.length) {
    const sufixo = { base: 'Base', reservas: 'Reservas', fabrica: 'Fabrica' };
    const variaveis: Json = { path: forja.repo };
    for (const [parte, ponta, paths] of pedidos) { variaveis[`ref${sufixo[parte]}`] = ponta!.commit; variaveis[`paths${sufixo[parte]}`] = paths; }
    const blobs = graphql(consultaDeBlobsDoGitlab(pedidos.map(([parte]) => parte)), variaveis);
    if (!blobs.ok) return blobs;
    conteudo = repositorio(blobs.json);
  }
  const textos = (chave: string): Map<string, string | null> => {
    const c = conteudo[chave];
    if (c === null || c === undefined) return new Map();
    exigir(obj(c) && Array.isArray((c as Json).nodes), `${chave}: conteudo`);
    cortou(c as Json, chave);
    return new Map(((c as Json).nodes as unknown[]).map((n) => {
      exigir(obj(n) && typeof n.path === 'string', `${chave}: blob`);
      return [(n as Json).path as string, typeof (n as Json).rawTextBlob === 'string' ? (n as Json).rawTextBlob as string : null];
    }));
  };
  const arquivos = (lista: string[] | null, mapa: Map<string, string | null>): ArquivoDaForja[] | null =>
    lista === null ? null : lista.map((caminho) => ({ caminho, texto: mapa.get(caminho) ?? null }));
  let commits: CommitDaBase[] = [];
  let commitsParciais = false;
  if (pontaBase) {
    chamadas++;
    const r = commitsDoGitlab(forja, pontaBase.commit, pedido.desde, executor);
    if (!r.ok) return r;
    commits = r.commits;
    commitsParciais = r.parciais;
  }
  const [mapaBase, mapaReservas, mapaFabrica] = [textos('base'), textos('reservas'), textos('fabrica')];
  const parcial = (dir: string, conteudo: string): boolean => cortadas.has(dir) || cortadas.has(conteudo);
  return { ok: true, leitura: { forja, lidoEm, chamadas,
    base: pontaBase ? { ref: base ?? 'HEAD', ...pontaBase, arquivos: arquivos(dirBase, mapaBase), parcial: parcial('baseDir', 'base'),
      manifesto: mapaBase.get(pedido.manifesto) ?? null, commits, commitsParciais } : null,
    reservas: pontaReservas ? { ref: pedido.reservas.branch, ...pontaReservas, arquivos: arquivos(dirReservas, mapaReservas),
      parcial: parcial('reservasDir', 'reservas') } : null,
    fabrica: pontaFabrica ? { ref: pedido.fabrica.branch, ...pontaFabrica, arquivos: arquivos(dirFabrica, mapaFabrica),
      parcial: parcial('fabricaDir', 'fabrica') } : null } };
}

const CONSULTA_DE_COMMITS_GITHUB = `query($owner: String!, $name: String!, $oid: GitObjectID!, $desde: GitTimestamp!) {
  repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit {
    history(since: $desde, first: 100) { pageInfo { hasNextPage } nodes { oid messageHeadline committedDate } } } } }
}`;

/**
 * So os commits de um commit da base desde `desde`, quando a janela da primeira leitura ficou curta:
 * o fuso do projeto so se conhece depois de ler o manifesto dele (achado 5 da rodada 2). So consulta.
 */
export function lerCommitsDaForja(forja: IdentidadeDaForja, pedido: { commit: string; desde: string },
  executor: ExecutorDaForja = executorPadrao): { ok: true; commits: CommitDaBase[]; parciais: boolean } | { ok: false; erro: ErroDaForja } {
  if (!SHA.test(pedido.commit)) return erro('forja.resposta-invalida', 'commit da base fora do formato');
  try {
    if (forja.tipo === 'gitlab') return commitsDoGitlab(forja, pedido.commit, pedido.desde, executor);
    const [owner, name] = forja.repo.split('/');
    const r = chamarJson(executor, 'gh', ['api', 'graphql', '--method', 'POST', '--input', '-', ...hostnameDe(forja)],
      JSON.stringify({ query: CONSULTA_DE_COMMITS_GITHUB, variables: { owner, name, oid: pedido.commit, desde: pedido.desde } }));
    if (!r.ok) return r;
    const dados = obj(r.json) ? (r.json as Json).data : undefined;
    exigir(obj(dados) && obj((dados as Json).repository), 'repositorio');
    const objeto = ((dados as Json).repository as Json).object;
    exigir(obj(objeto), 'commit');
    return { ok: true, ...commitsDoHistorico((objeto as Json).history, 'commits') };
  } catch (e) {
    if (e instanceof RespostaInvalida) return erro('forja.resposta-invalida', `resposta fora do formato esperado em ${e.message}`);
    throw e;
  }
}

/**
 * Le da forja a base (com `docs/roadmap`, o manifesto e os commits desde `desde`) e as duas branches
 * de estado. So consulta; qualquer falha volta como erro tipado, com o detalhe redigido.
 */
export function lerDaForja(forja: IdentidadeDaForja, pedido: PedidoDaForja, executor: ExecutorDaForja = executorPadrao): ResultadoDaForja {
  const lidoEm = pedido.lidoEm ?? new Date().toISOString();
  try {
    return forja.tipo === 'github' ? lerDoGithub(forja, pedido, executor, lidoEm) : lerDoGitlab(forja, pedido, executor, lidoEm);
  } catch (e) {
    if (e instanceof NaoEncontrado) return erro('forja.nao-encontrado', `${rotuloDaForja(forja)} não existe ou não é visível para o login da forja`);
    if (e instanceof RespostaInvalida) return erro('forja.resposta-invalida', `resposta fora do formato esperado em ${e.message}`);
    throw e;
  }
}

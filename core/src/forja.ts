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
 * GitLab devolve a mesma leitura por consultas GraphQL e pelo REST de commits, pela API da CLI
 * logada (`forja/api.ts`); o esquema esta provado com as respostas gravadas de um GitLab de verdade.
 *
 * Resposta fora do formato vira erro tipado, nunca lista vazia: quem le nao confunde "nao li" com
 * "nao tem".
 */
import { lerHostDoRemoto } from './forja/endereco';
import { redigirSegredos } from './hitl';
import { procurarSegredos } from './policies';
import { rodarCli } from './forja/executor';
import { chamadorDaApi, ChamadorDaApi } from './forja/api';
import { CONSULTA_ARVORES_GITLAB, CONSULTA_RAIZ_GITLAB, consultaDeBlobsDoGitlab } from './forja/gitlab/consultas';
import { projetoNaApi } from './forja/gitlab/pedidos';

export type { TipoDeForja, IdentidadeDaForja, CodigoDeErroDaForja, ErroDaForja, SaidaDoExecutor, ExecutorDaForja } from './forja/contrato';
import type { TipoDeForja, IdentidadeDaForja, CodigoDeErroDaForja, ErroDaForja, SaidaDoExecutor, ExecutorDaForja, ForjaResolvida } from './forja/contrato';

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

const PRAZO_MS = 30000;
const SHA = /^[0-9a-f]{40}$/;
const SEGMENTO = /^[A-Za-z0-9_.-]+$/;
/** Hostname de verdade: rotulos alfanumericos separados por ponto (`..` ou `a..b` nao passam). */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Sem shell, sem token: a CLI usa a autenticacao que ja tem; prompt e aviso de versao desligados.
 * RM-054 (fatia 3): o binario e procurado como na rede (D11 da RM-053), no PATH e depois nas pastas de
 * usuario (`~/.local/bin` e as outras): o gateway e o cron rodam com PATH curto, e o `gh` da maquina-b
 * mora em `~/.local/bin`. Sem achar, o nome vai cru ao spawn, e o ENOENT continua `forja.ausente`.
 */
export const executorPadrao: ExecutorDaForja = (cmd, args, entrada, timeoutMs) => rodarCli({ cmd, args, entrada,
  prazoMs: timeoutMs, maxBuffer: 32 * 1024 * 1024,
  acrescentar: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GLAB_CHECK_UPDATE: 'false', NO_COLOR: '1' } });

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

/**
 * O tipo pelo nome do host. So vale onde nao ha manifesto nem login para resolver: a rede le os remotos de outros
 * projetos. A CI do projeto usa a forja resolvida (`forja/resolver.ts`), que nao decide pelo nome.
 */
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
  // Parser unico (forja/endereco.ts); aqui so o `HOST` com ponto e o caminho como escrito (`montar` o valida).
  const lido = lerHostDoRemoto(url);
  return lido && HOST.test(lido.host) ? { host: lido.host, caminho: lido.caminhoBruto } : null;
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
  const id = endereco && tipo ? montar(tipo, endereco.host, endereco.caminho) : null;
  const porta = id?.tipo === 'gitlab' ? portaDaApiNoRemoto(url) : null;
  return id && porta !== null ? { ...id, porta } : id;
}

/**
 * A identidade de uma forja ja resolvida (o bloco `forja:`, o host conhecido), na forma que a leitura do roadmap usa. A
 * porta, o caminho base e a CA so entram no GitLab: o GitHub le pelo `gh` com o host.
 */
export function identidadeDaForjaResolvida(f: ForjaResolvida): IdentidadeDaForja | null {
  const id = montar(f.tipo, f.host, f.repo);
  if (!id || id.tipo !== 'gitlab') return id;
  return { ...id, ...(f.porta !== null ? { porta: f.porta } : {}), ...(f.caminhoBase ? { caminhoBase: f.caminhoBase } : {}),
    ...(f.ca ? { ca: f.ca } : {}) };
}

/** A porta da API num remoto https/http, quando nao e a do esquema; a porta de ssh e do ssh e nunca entra. */
function portaDaApiNoRemoto(url: string): number | null {
  const lido = lerHostDoRemoto(url);
  if (!lido || (lido.protocolo !== 'https' && lido.protocolo !== 'http') || lido.porta === null) return null;
  if (lido.porta < 1 || lido.porta > 65535 || lido.porta === (lido.protocolo === 'https' ? 443 : 80)) return null;
  return lido.porta;
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
export const rotuloDaForja = (f: IdentidadeDaForja): string => `${f.host}${f.porta ? `:${f.porta}` : ''}/${f.repo}`;

/** O mesmo repositorio: tipo, host e repo. A porta da API nao entra, senao o mesmo repo por ssh, https e `gitlab:host/g/r` nao casaria. */
export const mesmaForja = (a: IdentidadeDaForja | null, b: IdentidadeDaForja | null): boolean =>
  !!a && !!b && a.tipo === b.tipo && a.host === b.host && a.repo.toLowerCase() === b.repo.toLowerCase();

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/**
 * O texto inteiro sem segredo. Os tokens do GitLab podem ter ponto (formato roteavel, `glpat-xxxx.01.yyyy`), por isso a
 * classe inclui o ponto e nao ha `\b` no fim, que cortaria no ponto e deixaria o sufixo; o token de registro de runner
 * legado tem o prefixo fixo `GR1348941`.
 */
function redigirDaForja(texto: string): string {
  return redigirSegredos(texto)
    .replace(/\b(?:glpat|gldt|glrt|glptt|glcbt|gloas|glft|glimt|glsoat)-[A-Za-z0-9_.-]{16,}/g, '[redigido]')
    .replace(/\bGR1348941[A-Za-z0-9_-]{20,}/g, '[redigido]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redigido]');
}

const OMITIDO = '[detalhe omitido: um padrão de segredo casou]';

/** O fim da saida de erro, sem segredo: redigido, e descartado inteiro se ainda casar um padrao. */
export function detalheSeguro(texto: string): string {
  const linha = redigirDaForja(texto).split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ').slice(0, 240);
  return procurarSegredos(linha).length ? OMITIDO : linha;
}

/**
 * O motivo de um `git push` recusado, sem segredo. O texto inteiro e redigido antes do corte; as linhas `hint:` saem,
 * e fica o comeco do resto (ate 400 caracteres), onde o git poe o `! [rejected]` ou `! [remote rejected]` e o
 * `error: failed to push`. Guardar so o fim perderia o motivo: num non-fast-forward, as ultimas linhas sao hints.
 */
export function detalheDoPush(texto: string): string {
  const linhas = redigirDaForja(texto).split('\n').map((l) => l.trim()).filter((l) => l && !/^hint:/i.test(l));
  const detalhe = linhas.join(' ').slice(0, 400);
  return procurarSegredos(detalhe).length ? OMITIDO : detalhe;
}

/**
 * O push recusado pela protecao da branch. O GitHub diz `GH006: Protected branch update failed` e
 * `protected branch hook declined`; o GitLab diz `You are not allowed to push code to protected branches` (ou
 * `force push code to a protected branch`) antes do `pre-receive hook declined`. O `GH013` (regras do repositorio) e
 * generico: tambem vem da protecao contra segredo, de regra de caminho ou de mensagem de commit. Por isso so conta com
 * o sinal da protecao da branch na mesma saida (`Changes must be made through a pull request` ou `Cannot update this
 * protected ref`), e nunca com `PUSH PROTECTION` / `Push cannot contain secrets`. O `pre-receive hook declined` sozinho
 * e de qualquer gancho, e o "not allowed to push code to this project" do GitLab e falta de acesso ao projeto.
 */
export function pushRecusadoPelaProtecao(texto: string): boolean {
  if (/PUSH PROTECTION|Push cannot contain secrets/i.test(texto)) return false;
  if (/\bGH006\b|protected branch hook declined|not allowed to (?:force )?push code to (?:a )?protected branch/i.test(texto)) return true;
  return /\bGH013\b|repository rule violations/i.test(texto)
    && /Changes must be made through a pull request|Cannot update this protected ref/i.test(texto);
}

function erro(codigo: CodigoDeErroDaForja, detalhe: string): { ok: false; erro: ErroDaForja } {
  return { ok: false, erro: { codigo, detalhe } };
}

/** O motivo tipado de uma chamada que falhou. */
export function classificarFalha(cmd: 'gh' | 'glab', s: SaidaDoExecutor): ErroDaForja {
  if (s.erro === 'ENOENT') return { codigo: 'forja.ausente', detalhe: `${cmd} não está instalado nesta máquina` };
  if (s.erro === 'ETIMEDOUT' || s.sinal === 'SIGTERM') return { codigo: 'forja.indisponivel', detalhe: `${cmd} não respondeu em ${PRAZO_MS / 1000} s` };
  const texto = `${s.stderr}\n${s.stdout}`;
  const detalhe = detalheSeguro(s.stderr || s.stdout || s.erro || `${cmd} saiu com ${s.status}`);
  if (/"type"\s*:\s*"NOT_FOUND"|Could not resolve to a Repository|404 Not Found|HTTP 404|project not found/i.test(texto)) {
    return { codigo: 'forja.nao-achei', detalhe };
  }
  if (/auth login|not logged|authentication|HTTP 401|Bad credentials|GH_TOKEN|GITLAB_TOKEN|unauthorized|no token/i.test(texto)) {
    return { codigo: 'forja.sem-login', detalhe };
  }
  return { codigo: 'forja.indisponivel', detalhe };
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
      return { ok: false, erro: { codigo: 'forja.nao-achei', detalhe: falha.detalhe } };
    }
    return { ok: false, erro: falha };
  }
  if (json === undefined) return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: `${cmd} não devolveu JSON` } };
  return { ok: true, json };
}

/** So o `gh`: o host vai sempre explicito, ou ele usaria `GH_HOST` ou o unico host com login e a consulta iria para outra forja. */
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

/** A API do GitLab de uma forja: o host e a porta da API, e o caminho base e a CA quando vieram do bloco `forja:`. */
const apiDoGitlab = (forja: IdentidadeDaForja): ChamadorDaApi =>
  chamadorDaApi({ tipo: 'gitlab', host: forja.host, porta: forja.porta ?? null, caminhoBase: forja.caminhoBase ?? '', ca: forja.ca ?? null });

/** Uma consulta GraphQL do GitLab; `errors` no corpo e erro tipado, nunca resposta. */
function graphqlDoGitlab(api: ChamadorDaApi, query: string, variables: Json): { ok: true; json: unknown } | { ok: false; erro: ErroDaForja } {
  const r = api({ metodo: 'POST', caminho: 'graphql', corpo: { query, variables }, prazoMs: PRAZO_MS });
  if (!r.ok) return r;
  const json = r.valor.corpo;
  if (obj(json) && Array.isArray(json.errors) && json.errors.length) {
    return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: detalheSeguro(JSON.stringify(json.errors)) } };
  }
  return { ok: true, json };
}

/** Os commits da base desde `desde`, pelo REST do GitLab (GET), e se vieram 100 (pagina cheia). */
function commitsDoGitlab(forja: IdentidadeDaForja, commit: string, desde: string, api: ChamadorDaApi):
  { ok: true; commits: CommitDaBase[]; parciais: boolean } | { ok: false; erro: ErroDaForja } {
  const r = api({ metodo: 'GET', caminho: `${projetoNaApi(forja.repo)}/repository/commits?ref_name=${encodeURIComponent(commit)}` +
    `&since=${encodeURIComponent(desde)}&per_page=100`, prazoMs: PRAZO_MS });
  if (!r.ok) return r;
  const lista = r.valor.corpo;
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

function lerDoGitlab(forja: IdentidadeDaForja, pedido: PedidoDaForja, api: ChamadorDaApi, lidoEm: string): ResultadoDaForja {
  let chamadas = 0;
  const graphql = (query: string, variables: Json) => { chamadas++; return graphqlDoGitlab(api, query, variables); };
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
    const r = commitsDoGitlab(forja, pontaBase.commit, pedido.desde, api);
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
  executor: ExecutorDaForja = executorPadrao, api?: ChamadorDaApi): { ok: true; commits: CommitDaBase[]; parciais: boolean } | { ok: false; erro: ErroDaForja } {
  if (!SHA.test(pedido.commit)) return erro('forja.resposta-invalida', 'commit da base fora do formato');
  try {
    if (forja.tipo === 'gitlab') return commitsDoGitlab(forja, pedido.commit, pedido.desde, api ?? apiDoGitlab(forja));
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
export function lerDaForja(forja: IdentidadeDaForja, pedido: PedidoDaForja, executor: ExecutorDaForja = executorPadrao,
  api?: ChamadorDaApi): ResultadoDaForja {
  const lidoEm = pedido.lidoEm ?? new Date().toISOString();
  try {
    return forja.tipo === 'github' ? lerDoGithub(forja, pedido, executor, lidoEm) : lerDoGitlab(forja, pedido, api ?? apiDoGitlab(forja), lidoEm);
  } catch (e) {
    if (e instanceof NaoEncontrado) return erro('forja.nao-achei', `${rotuloDaForja(forja)} não existe ou não é visível para o login da forja`);
    if (e instanceof RespostaInvalida) return erro('forja.resposta-invalida', `resposta fora do formato esperado em ${e.message}`);
    throw e;
  }
}

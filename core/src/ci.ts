/** GitHub CI como CHECK independente (I-12). */
import { lerEnderecoDoRemoto } from './forja/endereco';
import { detalheSeguro } from './forja';
import { hostDaApi } from './forja/cli';
import { RodarCli, temLogin } from './forja/api';
import { resolverForja, SONDAS_PADRAO, SondasDaForja } from './forja/resolver';
import { dirDoCacheDaForja } from './forja/cache';
import { exigirRemoto } from './branch-de-estado';
import { ManifestoCarregado } from './manifest';
import { exec } from './util';
import { rodarCli } from './forja/executor';
import { estadoDoCheck } from './forja/estado';
import { PRODUTORES_PADRAO, produtorAceito, produtoresAceitos } from './forja/produtor';
import type { CheckNoCommit } from './forja/contrato';
import { adaptadorDaForja, exigirCapacidade } from './forja/registro';
import { branchDaWorktree } from './worktree';
import { cwdLocalOuNulo } from './procedencia';
import { verificar, ResultadoVerify } from './verify';
import { comandosDoManifesto, commitReal, executar, prazoDoComando, verificarClaim } from './verify';
import { lerClaims } from './claims';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Claim } from './types';
import { analisarComandos, linhaDoLintDeClaim } from './claim-lint';
import { TESTES_DE_INTEGRACAO_LOCAL } from './integracoes-locais';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { dirThread, lerThread } from './thread';
import { textoDoCatalogo } from './locale';

export type EstadoCi = 'disabled' | 'success' | 'pending' | 'failure' | 'missing' | 'unavailable';

export interface ResultadoCi {
  schema: 'ork.ci-status/v1';
  required: boolean;
  ok: boolean;
  provider: 'github';
  repository: string | null;
  sha: string;
  context: string;
  state: EstadoCi;
  url: string | null;
  detail: string;
}

export type ExecutorCi = (input: { repository: string; sha: string; context: string; host?: string; caminho?: string }) =>
  { ok: boolean; stdout: string; stderr: string; code: number };

export interface BundleCi {
  schema: 'ork.ci-bundle/v1';
  thread: string;
  /** RM-037 (rm037noite, defeito 1): a branch da thread; e por ela que o CI acha o bundle. */
  branch?: string;
  base: string;
  claims: Claim[];
  /** Claims that require the installation host and remain mandatory in local SHIP verify. */
  deferredClaims?: Array<{ id: string; reason: 'artifact-not-in-checkout' | 'host-runtime-required' | 'local-integration-required' }>;
  commands: { name: string; command: string }[];
}

const MARCADORES_DE_HOST = [
  /(^|[\s;&|])\/home\//,
  /(^|[\s;&|])localhost(?=[:/\s;&|]|$)/,
  /verify-company-brain-live\.cjs/,
];
// Alguns verificadores misturam casos hermeticos com casos que, por contrato, leem
// repositorios irmaos ou o estado local da thread. Classificar por executavel inteiro
// dispensaria tambem os casos hermeticos; a unidade correta e o caso selecionado.
const CASOS_DE_VERIFICADOR_LOCAIS = [
  /verify-goal-c2-b3\.cjs\s+(?:P2|P3|P4|P5)(?:\s|$)/,
  /verify-check-c2-b3\.cjs\s+(?:docs-metrics|d12-ratification)(?:\s|$)/,
];
const CASOS_DE_VERIFICADOR_COM_INTEGRACAO_LOCAL = [
  /verify-check-c2-b3\.cjs\s+channel-offer(?:\s|$)/,
  // I-38: a prova da busca por significado le a memoria do tenant pela DSN do manifesto.
  /prova-busca-semantica\.sh(?:\s|$)/,
  // RM-038: a prova do universo da busca tambem le a memoria do tenant pela DSN do manifesto.
  /prova-universo-da-busca\.cjs(?:\s|$)/,
  // RM-051: o ensaio instala o tarball com npm --offline e resolve as dependencias pelo cache do npm
  // da estacao; o runner hospedado so tem os tarballs do npm ci, sem os metadados do registro.
  /testar-experiencia-e2e\.cjs(?:\s|$)/,
  // RM-037: a suite local inteira, com as integracoes locais; o runner hospedado roda o test:ci.
  /suite-local\.cjs(?:\s|$)/,
];
/**
 * I-38: o runner hospedado nao oferece OrkMind nem a base do tenant. Claim que chama a memoria
 * pelo CLI (a DSN vem do manifesto), que exige o OrkMind instalado ou que roda a suite inteira
 * (ela inclui `TESTES_DE_INTEGRACAO_LOCAL`; o runner roda `test:ci`) fica para a estacao.
 */
const USA_A_ESTACAO = [
  /(?:^|\s)memory\s+(?:status|index|search|sync|migrate|inventory)(?=\s|$)/,
  /command -v orkmind(?=[\s)"']|$)/,
  /npm\s+--prefix\s+core\s+test(?![:\w-])/,
];
function exigeIntegracaoLocal(command:string):boolean {
  return [...command.matchAll(/(?:^|[\s/])([a-z0-9-]+\.test\.js)(?=$|[\s;&|])/g)]
    .some(match=>TESTES_DE_INTEGRACAO_LOCAL.has(match[1]));
}

/**
 * CI hosted cannot impersonate an installed host.  Those claims are not dropped:
 * the bundle names them as deferred and `ork ship` still runs the complete local
 * verification before consulting GitHub.  Only checkout-hermetic claims execute in
 * the independent runner.
 */
export function motivoDiferimentoCi(
  claim: Claim,
  raiz: string
): 'artifact-not-in-checkout' | 'host-runtime-required' | 'local-integration-required' | null {
  // `git ls-files` aceita um pathspec absoluto que esteja dentro desta worktree,
  // mas o mesmo texto aponta para uma worktree inexistente no runner hospedado.
  if (path.isAbsolute(claim.arquivo)) return 'artifact-not-in-checkout';
  const tracked = exec('git', ['ls-files', '--error-unmatch', '--', claim.arquivo], raiz);
  if (!tracked.ok) return 'artifact-not-in-checkout';
  if (claim.verificar.some((command) => MARCADORES_DE_HOST.some((marker) => marker.test(command)))) {
    return 'host-runtime-required';
  }
  if (claim.verificar.some((command) => CASOS_DE_VERIFICADOR_LOCAIS.some((caso) => caso.test(command)))) {
    return 'host-runtime-required';
  }
  if (claim.verificar.some((command) => exigeIntegracaoLocal(command)
    || CASOS_DE_VERIFICADOR_COM_INTEGRACAO_LOCAL.some((caso) => caso.test(command))
    || USA_A_ESTACAO.some((caso) => caso.test(command)))) {
    return 'local-integration-required';
  }
  return null;
}

export function repositorioGitHub(url: string): string | null {
  const e = lerEnderecoDoRemoto(url);
  return e && (e.host === 'github.com' || e.host === 'ssh.github.com') && e.caminho.split('/').length === 2 ? e.caminho : null;
}

/** O host da API para o gh: `--hostname host`, ou `GH_HOST=host:porta` (o gh recusa `--hostname` com porta). */
function hostDoGh(host: string): { args: string[]; acrescentar?: Record<string, string> } {
  return host.includes(':') ? { args: [], acrescentar: { GH_HOST: host } } : { args: ['--hostname', host] };
}

function executorPadrao(input: { repository: string; sha: string; context: string; host?: string; caminho?: string }) {
  // 32 MiB, o teto do `forja.ts`: uma pagina de 100 check-runs passa de 1 MiB com facilidade.
  const h = hostDoGh(input.host ?? 'github.com');
  const r = rodarCli({ cmd: 'gh', args: ['api', ...h.args, input.caminho ?? `repos/${input.repository}/commits/${input.sha}/check-runs`,
    '-H', 'Accept: application/vnd.github+json'], prazoMs: 120000, maxBuffer: 32 * 1024 * 1024, acrescentar: h.acrescentar });
  return { ok: r.status === 0, code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/**
 * O `gh` tem login no host exato (`host` ou `host:porta`)? So o github.com dispensa a pergunta. Com porta o
 * `auth status` roda sem `--hostname` e sai 0 se QUALQUER host tem login: o `temLogin` confere a linha do host exato.
 */
export function loginDoGh(host: string, rodar?: RodarCli): boolean {
  const m = /^(.+?)(?::(\d+))?$/.exec(host);
  return temLogin({ tipo: 'github', host: m ? m[1] : host, porta: m?.[2] ? Number(m[2]) : null, caminhoBase: '', ca: null }, rodar);
}

const loginPadrao = (host: string): boolean => loginDoGh(host);

/**
 * O repositorio e o host da API saem de UM parse do remoto (`lerEnderecoDoRemoto`) e da forja resolvida (o bloco
 * `forja:`, o host conhecido ou a sondagem pela CLI com login no host), sem host de reserva: o `dono/nome` nunca e
 * consultado num host que o remoto ou o manifesto nao nomeiam. O nome do host nao decide o tipo: so a forja resolvida
 * como GitHub tem a CI consultada aqui. `ssh.github.com` (SSH pela 443) e o github.com; a porta de um remoto SSH nao
 * e a da API.
 */
function alvoDaCi(carregado: ManifestoCarregado, remoto: string, url: string, sondas: SondasDaForja):
  { ok: true; repository: string; host: string } | { ok: false; detalhe: string } {
  const naoGithub = () => ({ ok: false as const, detalhe: textoDoCatalogo((m) => m.ship.ciRemotoNaoGithub(remoto)) });
  const endereco = lerEnderecoDoRemoto(url.trim());
  if (!endereco) return naoGithub();
  // O tipo sondado fica 24 h no cache da raiz: um GHE sem bloco `forja:` nao paga as sondas a cada consulta.
  const forja = resolverForja({ endereco, manifesto: carregado.manifesto.forja, sondas, cache: dirDoCacheDaForja(carregado.raiz) });
  if (!forja.ok) return { ok: false, detalhe: textoDoCatalogo((m) => m.ship.ciForjaNaoResolvida(remoto, m.forja.motivo(forja.erro, null))) };
  if (forja.valor.tipo !== 'github' || forja.valor.repo.split('/').length !== 2) return naoGithub();
  return { ok: true, repository: forja.valor.repo, host: hostDaApi(forja.valor) };
}

/** O resultado da CI quando o projeto nao a exige (`ci.required_for_ship: false`): nada e consultado na forja. */
export function ciNaoExigida(carregado: ManifestoCarregado, sha: string): ResultadoCi {
  const context = carregado.manifesto.ci.context || 'ork-verify';
  return { schema: 'ork.ci-status/v1', required: false, ok: true, provider: 'github', repository: null, sha, context, state: 'disabled', url: null, detail: textoDoCatalogo((m) => m.ship.ciNaoExigidoDetalhe) };
}

export function consultarCi(carregado: ManifestoCarregado, sha: string, remoto = 'origin', executor: ExecutorCi = executorPadrao,
  loginNoHost: (host: string) => boolean = loginPadrao, sondas: SondasDaForja = SONDAS_PADRAO): ResultadoCi {
  const { ci } = carregado.manifesto;
  const context = ci.context || 'ork-verify';
  const falha = (detalhe: string): ResultadoCi => ({ schema: 'ork.ci-status/v1', required: true, ok: false, provider: 'github', repository: null, sha, context, state: 'unavailable', url: null, detail: detalhe });
  if (!ci.required_for_ship) return ciNaoExigida(carregado, sha);
  // RM-047: o `--remoto` do `ork ci status` vem da linha de comando; so nome de remoto chega ao git.
  const remote = exec('git', ['remote', 'get-url', '--', exigirRemoto(remoto, 'ci')], carregado.raiz);
  const alvo = remote.ok ? alvoDaCi(carregado, remoto, remote.stdout, sondas)
    : { ok: false as const, detalhe: textoDoCatalogo((m) => m.ship.ciRemotoNaoGithub(remoto)) };
  if (!alvo.ok) return falha(alvo.detalhe);
  // Fronteira de confianca: so o github.com e consultado sem pergunta; outro host so com login do `gh` nele.
  if (alvo.host !== 'github.com' && !loginNoHost(alvo.host)) return falha(textoDoCatalogo((m) => m.ship.ciHostSemLogin(alvo.host)));
  return consultarCiDoRepositorio(alvo.repository, sha, context, executor, alvo.host, produtoresAceitos(carregado.manifesto, 'github'));
}

/**
 * O check `context` no `sha` de um repositorio GitHub ja resolvido: o do remoto do projeto ou, desde a
 * RM-037 (rm037defeito, defeito 5), um repositorio externo declarado em `ci.external_repositories`. So produtor de
 * `produtores` (`ci.produtor`) aprova.
 */
export function consultarCiDoRepositorio(repository: string, sha: string, context: string, executor: ExecutorCi = executorPadrao, host = 'github.com',
  produtores: readonly string[] = PRODUTORES_PADRAO.github): ResultadoCi {
  const base = { schema: 'ork.ci-status/v1' as const, required: true, provider: 'github' as const, repository, sha, context };
  const lido = exigirCapacidade(adaptadorDaForja('github'), 'checksNoCommit')({ repository, sha, context, executor, host });
  if (!lido.ok && lido.erro.codigo === 'forja.resposta-invalida') {
    return { ...base, ok: false, state: 'unavailable', url: null, detail: textoDoCatalogo((m) => lido.erro.detalhe === 'incompleto'
      ? m.ship.ciIncompleto(context) : m.ship.ciRespostaInvalida) };
  }
  if (!lido.ok) return { ...base, ok: false, state: 'unavailable', url: null, detail: detalheSeguro(lido.erro.detalhe || textoDoCatalogo((m) => m.ship.ciConsultaFalhou)) };
  if (!lido.valor.length) return { ...base, ok: false, state: 'missing', url: null, detail: textoDoCatalogo((m) => m.ship.ciSemCheck(context)) };
  const escolhidos = maisNovoPorProdutor(lido.valor);
  // So produtor da lista aprova: o verde de quem esta fora dela e descartado. Vermelho, pendente ou bloqueado de
  // qualquer um continua contando: quem escreve status no repositorio pode atrasar o gate, nunca aprova-lo.
  const contam = escolhidos.filter((c) => produtorAceito(c, produtores) || estadoDoCheck(c.fonte, c.status, c.conclusao) !== 'verde');
  if (!contam.length) {
    const descartados = escolhidos.map(nomeDoProdutor).join(', ');
    return { ...base, ok: false, state: 'missing', url: null, detail: textoDoCatalogo((m) => escolhidos.every((c) => c.fonte === 'commit-status')
      ? m.ship.ciStatusSemProdutorConfiavel(context) : m.ship.ciSemProdutorAceito(context, descartados, produtores.join(', '))) };
  }
  if (contam.length === 1) {
    const check = contam[0];
    const status = check.status;
    const conclusion = check.conclusao ?? '';
    const estado = estadoDoCheck(check.fonte, status, check.conclusao);
    const state = estadoNoGate(estado);
    return { ...base, ok: state === 'success', state, url: check.url || null, detail: textoDoCatalogo((m) => state === 'success' ? m.ship.ciVerde : estado === 'bloqueado' ? m.ship.ciBloqueado(context, conclusion) : m.ship.ciEstado(context, String(status), conclusion)) };
  }
  // Varios produtores: a combinacao e conservadora. Vermelho ou bloqueado de qualquer um reprova; senao, pendente
  // de qualquer um espera; so todos verdes passam.
  const lidos = contam.map((check) => {
    const estado = estadoDoCheck(check.fonte, check.status, check.conclusao);
    return { check, estado, state: estadoNoGate(estado) };
  });
  const state: EstadoCi = lidos.some((l) => l.state === 'failure') ? 'failure' : lidos.some((l) => l.state === 'pending') ? 'pending' : 'success';
  const decisivo = lidos.find((l) => l.state === state)!;
  // O estado do ork por produtor, com o motivo do bloqueio (spec 6.2: o motivo e mostrado).
  const porProdutor = lidos.map((l) => `${nomeDoProdutor(l.check)} ${l.estado}${l.estado === 'bloqueado' ? ` (${l.check.conclusao ?? ''})` : ''}`).join(', ');
  return { ...base, ok: state === 'success', state, url: decisivo.check.url || null, detail: textoDoCatalogo((m) => m.ship.ciProdutores(context, porProdutor)) };
}

function estadoNoGate(estado: ReturnType<typeof estadoDoCheck>): EstadoCi {
  return estado === 'verde' ? 'success' : estado === 'pendente' ? 'pending' : 'failure';
}

/** O produtor como aparece no detalhe; check-run e commit status do mesmo nome sao produtores distintos. */
function nomeDoProdutor(check: CheckNoCommit): string {
  return `${check.produtor ?? '?'}${check.fonte === 'commit-status' ? ' (status)' : ''}`;
}

/**
 * O check mais novo de cada produtor: maior `concluidoEm`, depois maior `ordem`. Sem `concluidoEm` (ainda rodando) e
 * o mais novo; data ilegivel e a mais velha. Saida ordenada pelo nome do produtor, para o detalhe ser estavel.
 */
function maisNovoPorProdutor(checks: readonly CheckNoCommit[]): CheckNoCommit[] {
  const quando = (c: CheckNoCommit): number => {
    if (c.concluidoEm === null) return Number.POSITIVE_INFINITY;
    const t = Date.parse(c.concluidoEm);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const porProdutor = new Map<string, CheckNoCommit>();
  for (const c of checks) {
    const chave = nomeDoProdutor(c);
    const atual = porProdutor.get(chave);
    if (!atual || quando(c) > quando(atual) || (quando(c) === quando(atual) && c.ordem > atual.ordem)) porProdutor.set(chave, c);
  }
  return [...porProdutor.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
}

export function executarCi(carregado: ManifestoCarregado, threadId: string): { status: ResultadoCi; verify: ResultadoVerify } {
  const verify = verificar(carregado, threadId);
  const context = carregado.manifesto.ci.context || 'ork-verify';
  const repository = process.env.GITHUB_REPOSITORY ?? null;
  return {
    status: {
      schema: 'ork.ci-status/v1', required: true, ok: verify.ok, provider: 'github', repository,
      sha: verify.commit, context, state: verify.ok ? 'success' : 'failure',
      url: process.env.GITHUB_SERVER_URL && repository && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
      detail: verify.ok ? 'ork verify aprovado no runner independente' : `ork verify reprovou: ${verify.motivos.join(', ')}`,
    },
    verify,
  };
}

/**
 * RM-037 (rm037noite, defeito 1): um bundle por thread. O `.ork-ci/bundle.json` era o mesmo caminho em
 * toda thread, entao toda PR conflitava com todas as outras e cada merge pedia merge da main, `ork ci
 * prepare` e CI de novo na proxima. Cada thread grava agora o proprio `.ork-ci/<thread>.json`, e o CI
 * acha o da thread pelo nome da branch (`ork ci run --branch`). O bundle nao nasce no CI porque as
 * claims ficam no `.orkastery/` da maquina que conduz, fora do git.
 */
export const DIR_DO_BUNDLE = '.ork-ci';
/** O caminho unico de antes: so vale quando o `thread` dele bate com a branch (PR aberta antes da mudanca). */
export const BUNDLE_LEGADO = 'bundle.json';
const THREAD_DO_BUNDLE = /^ork-[a-z0-9-]+$/;

/** O nome do arquivo do bundle da thread, dentro de `.ork-ci/`. */
export function arquivoDoBundle(threadId: string): string {
  if (!THREAD_DO_BUNDLE.test(threadId)) throw new Error(`ci.bundle: "${threadId}" nao e id de thread`);
  return `${threadId}.json`;
}

/** Os comandos que o bundle leva ao runner; o `ork ship publicar` confere os do bundle no HEAD contra estes. */
export function comandosDoBundle(carregado: ManifestoCarregado): { name: string; command: string }[] {
  return carregado.manifesto.ci.command
    ? [{ name: 'ci', command: carregado.manifesto.ci.command }]
    : comandosDoManifesto(carregado.manifesto).map(({ nome, comando }) => ({ name: nome, command: comando }));
}

/**
 * I-53 (RM-037, P6): o lint no `ci prepare`. Claim nascida sob a regra (com o campo `lint`) que
 * roda a suite inteira e recusada: o bundle vai para o runner hospedado e reprovaria la, depois de
 * gastar o tempo todo. O resto so avisa, e o aviso fica no ledger da thread.
 */
export function lintDoBundle(claims: readonly Claim[]): { recusas: string[]; avisos: string[] } {
  const recusas: string[] = [], avisos: string[] = [];
  for (const claim of claims) {
    for (const achado of analisarComandos(claim.verificar)) {
      const linha = linhaDoLintDeClaim(claim.id, achado);
      if (achado.regra === 'suite-inteira' && claim.lint !== undefined) recusas.push(linha);
      else avisos.push(achado.regra === 'suite-inteira' ? `${linha} (claim anterior ao lint: so aviso)` : linha);
    }
  }
  return { recusas, avisos };
}

/**
 * RM-037 (rm037defeito, defeito 6): onde o bundle nasce. Ele e artefato da branch da thread (o commit
 * `ci(<thread>)` vai no PR dela), entao o destino e a worktree da thread, rodando o `ork` da raiz ou da
 * worktree. Gravado na raiz, ele sujava o checkout compartilhado com o bundle de outra thread, e o
 * `git ls-files` da raiz adiava claim de arquivo que so existe na branch da thread.
 */
export function destinoDoBundle(carregado: ManifestoCarregado, threadId: string): string {
  const worktree = lerThread(carregado.raiz, threadId).worktree;
  // RM-047 (P2): o bundle so e gravado na worktree registrada; outro diretorio do thread.json cai na raiz.
  return worktree && fs.existsSync(worktree) && cwdLocalOuNulo(carregado.raiz, threadId, worktree, 'thread') !== null
    ? worktree : carregado.raiz;
}

export function prepararBundleCi(carregado: ManifestoCarregado, threadId: string,
  opcoes: { aoAvisar?: (linha: string) => void } = {}): string {
  const commands = comandosDoBundle(carregado);
  const nomeDoArquivo = arquivoDoBundle(threadId);
  const branch = branchDaWorktree(lerThread(carregado.raiz, threadId));
  const activeClaims = lerClaims(carregado.raiz, threadId).filter(
    (claim) => claim.estado !== 'retirada'
  );
  const lint = lintDoBundle(activeClaims);
  if (lint.recusas.length || lint.avisos.length) {
    registrar(dirThread(carregado.raiz, threadId), threadId, TIPOS_DE_EVENTO.lintDeClaim,
      { recusas: lint.recusas, avisos: lint.avisos });
  }
  for (const aviso of lint.avisos) opcoes.aoAvisar?.(aviso);
  if (lint.recusas.length) {
    throw new Error(`claims.lint: o bundle nao foi gerado; retire a claim e registre de novo com o comando focado:\n  ` +
      lint.recusas.join('\n  '));
  }
  const destino = destinoDoBundle(carregado, threadId);
  // Achado S8 do CHECK: a worktree registrada que sumiu nao e silencio; o bundle na raiz vem com aviso.
  const registrada = lerThread(carregado.raiz, threadId).worktree;
  if (registrada && destino !== registrada) {
    opcoes.aoAvisar?.(`a worktree ${registrada} da thread nao existe mais; o bundle vai para a raiz do projeto`);
  }
  const classified = activeClaims.map((claim) => ({
    claim,
    reason: motivoDiferimentoCi(claim, destino),
  }));
  const bundle: BundleCi = {
    schema: 'ork.ci-bundle/v1',
    thread: threadId,
    branch,
    base: carregado.manifesto.worktree.base_branch,
    claims: classified.filter((item) => item.reason === null).map((item) => item.claim),
    deferredClaims: classified
      .filter((item) => item.reason !== null)
      .map((item) => ({ id: item.claim.id, reason: item.reason! })),
    commands,
  };
  const dir = path.join(destino, '.ork-ci');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, nomeDoArquivo);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  return file;
}

function lerBundle(raiz: string, file: string): BundleCi {
  const absolute = path.resolve(raiz, file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('bundle de CI ausente ou acima de 1 MiB');
  const bundle = JSON.parse(fs.readFileSync(absolute, 'utf8')) as BundleCi;
  if (bundle.schema !== 'ork.ci-bundle/v1' || !THREAD_DO_BUNDLE.test(bundle.thread) || !Array.isArray(bundle.claims) || !Array.isArray(bundle.commands)) throw new Error('bundle de CI inválido');
  return bundle;
}

const casaComBranch = (thread: string, branch: string): boolean =>
  branch === `ork/${thread}` || branch.startsWith(`ork/${thread}-`);

/**
 * O bundle da branch, entre os `.ork-ci/*.json` do checkout. Vale o de `branch` igual. O bundle sem
 * `branch` (o `bundle.json` legado, de antes da RM-037) vale pela thread, quando a branch e
 * `ork/<thread>` ou `ork/<thread>-*` (a mais longa ganha: `ork-a` nao leva a branch da `ork-ab`).
 * Bundle novo de outra branch nunca vale, nem da mesma thread (achado A4 do CHECK 1), e o arquivo da
 * thread da branch que nao abre reprova em vez de ceder a vez a outro. `null` quando nenhum bate.
 */
export function bundleDaBranch(raiz: string, branch: string): { arquivo: string; bundle: BundleCi } | null {
  const dir = path.join(raiz, DIR_DO_BUNDLE);
  if (!fs.existsSync(dir)) return null;
  let melhor: { arquivo: string; bundle: BundleCi; peso: number } | null = null;
  let quebrado: Error | null = null;
  for (const nome of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const arquivo = path.posix.join(DIR_DO_BUNDLE, nome);
    let bundle: BundleCi;
    try { bundle = lerBundle(raiz, arquivo); } catch (e) {
      if (!quebrado && nome !== BUNDLE_LEGADO && casaComBranch(nome.slice(0, -'.json'.length), branch)) {
        quebrado = new Error(`ci.bundle.invalido: ${arquivo} e o bundle da branch ${branch} e nao abre ` +
          `(${(e as Error).message}); rode ork ci prepare <thread> de novo e versione o arquivo`);
      }
      continue;
    }
    if (nome !== BUNDLE_LEGADO && nome !== `${bundle.thread}.json`) continue;
    const peso = bundle.branch === branch ? Number.MAX_SAFE_INTEGER
      : !bundle.branch && casaComBranch(bundle.thread, branch) ? bundle.thread.length : 0;
    if (peso > 0 && (!melhor || peso > melhor.peso)) melhor = { arquivo, bundle, peso };
  }
  // Sugestao 4 do CHECK 2: o arquivo quebrado so reprova se nenhum bundle valido for da branch exata.
  if (quebrado && melhor?.peso !== Number.MAX_SAFE_INTEGER) throw quebrado;
  return melhor ? { arquivo: melhor.arquivo, bundle: melhor.bundle } : null;
}

/**
 * `ork ci run --branch <branch>`: o CHECK do CI pela branch. Branch de thread (`ork/*`) roda o bundle
 * dela e reprova sem ele; outra branch (a `main`, por exemplo) nao tem thread e roda so os comandos
 * do manifesto.
 */
export function executarCiDaBranch(carregado: ManifestoCarregado, branch: string) {
  const achado = bundleDaBranch(carregado.raiz, branch);
  if (achado) return { ...rodarBundle(carregado, achado.bundle), branch, bundle: achado.arquivo };
  if (branch.startsWith('ork/')) {
    throw new Error(`ci.bundle.ausente: a branch ${branch} e de thread e nao tem bundle em ${DIR_DO_BUNDLE}/; ` +
      'rode ork ci prepare <thread> na worktree e versione o arquivo');
  }
  const semThread: BundleCi = { schema: 'ork.ci-bundle/v1', thread: '', base: carregado.manifesto.worktree.base_branch,
    claims: [], commands: comandosDoBundle(carregado) };
  return { ...rodarBundle(carregado, semThread), thread: null, branch, bundle: null };
}

export function executarBundleCi(carregado: ManifestoCarregado, file = path.posix.join(DIR_DO_BUNDLE, BUNDLE_LEGADO)) {
  return rodarBundle(carregado, lerBundle(carregado.raiz, file));
}

function rodarBundle(carregado: ManifestoCarregado, bundle: BundleCi) {
  // O CI roda o mesmo preparo do `ork verify` local (I-54), uma vez e antes das claims: a claim
  // que passa na maquina de quem entrega passa aqui pelo mesmo caminho. Como no verify, o
  // preparo nao e condicao de claim; ele so deixa a compilacao pronta e sai no resultado.
  const comandoDoPreparo = carregado.manifesto.verify.preparo;
  const preparo = comandoDoPreparo
    ? executar('preparo', comandoDoPreparo, carregado.raiz, prazoDoComando(carregado.manifesto, 'preparo'))
    : null;
  const claims = bundle.claims.map((claim) => verificarClaim(claim, carregado.raiz));
  const commands = bundle.commands.map((item) => executar(item.name, item.command, carregado.raiz));
  const ok = claims.every((item) => item.verificado || item.motivo === 'claims.unverifiable') && commands.every((item) => item.ok);
  return { schema: 'ork.ci-run/v1' as const, ok, thread: bundle.thread, commit: commitReal(carregado.raiz), preparo, claims, commands };
}

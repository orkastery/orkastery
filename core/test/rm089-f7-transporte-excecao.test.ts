/** RM-089 F7: transporte autenticado da exceção nas duas forjas. */
import { strict as assert } from 'node:assert';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { AUDIENCIA_FABRICA_CI, CONTRATO_TRANSPORTE_EXCECAO_RUNNER,
  atenderTransporteNaFabrica, configuracaoPublicaDoTransporteValida, executarClienteProtegidoDoTransporte,
  executarLauncherNativoDoTransporte, identidadeOidcDoLauncher, localizadoresDoLauncher,
  projetarResultadoDoTransporte, type FatosReobtidosDaForjaCi,
  type LocalizadoresDoTransporteCi } from '../src/ci-fabrica-transporte';
import { comandosDoTextoDoManifesto, type ManifestoCarregado } from '../src/manifest';
import { executarCiDaBranchComContexto, publicarAvisoDaPolitica } from '../src/ci';
import { criarProjecaoReplayCi } from '../src/ci-recibo-basico';
import { evidenciaCanonicaDoGithub } from '../src/forja/github/ci';
import { evidenciaCanonicaDoGitlab } from '../src/forja/gitlab/ci';
import { identidadeNativaDoAmbienteCi } from '../src/forja/ambiente-de-ci';
import { CONTRATO_CAPACIDADE_RUNNER_EXCECAO, CONTRATO_PORTA_NOTIFICACAO_EXCECAO,
  CONTRATO_PROVA_NOTIFICACAO_EXCECAO, CONTRATO_RECIBO_NOTIFICACAO_EXCECAO,
  hashDoReciboDeNotificacao, registrarNotificacaoAuditavel, type CapacidadeDoRunnerParaExcecao,
  type PedidoDeNotificacaoDaExcecao, type ProvaProtegidaDaNotificacao,
  type ReciboDeNotificacaoDaExcecao } from '../src/excecao-notificacao';
import { CONTRATO_EXCECAO_RECIBO, CONTRATO_POLITICA_EXCECAO_RECIBO, hashDaPoliticaDeExcecao,
  type ExcecaoDeRecibo, type PoliticaDaExcecaoDeRecibo } from '../src/excecao-recibo';
import type { Manifesto } from '../src/types';

const CONFIG = { contrato: CONTRATO_TRANSPORTE_EXCECAO_RUNNER, origem: 'https://fabrica.invalid/ci',
  audiencia: AUDIENCIA_FABRICA_CI, cliente: { versao: '0.6.10', sha256: 'a'.repeat(64) } };
const ESPERADO = { project: 'projeto-fixture', source: 'feature/fixture', target: 'main', head: 'b'.repeat(40),
  operation: 'ci.run' as const };
const AGORA = '2026-11-25T00:00:00.000Z', EXPIRA = '2026-12-01T00:00:00.000Z';
const RAIZ = path.resolve(__dirname, '../../..');
const ler = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const yaml = require('js-yaml') as { loadAll(texto: string): unknown[] };
type Mapa = Record<string, unknown>;
const mapa = (valor: unknown): Mapa => valor as Mapa;
const lista = (valor: unknown): Mapa[] => valor as Mapa[];

function documentosYaml(arquivo: string): Mapa[] {
  return yaml.loadAll(ler(arquivo)).filter((valor): valor is Mapa => !!valor && typeof valor === 'object');
}

function passoPorAcao(job: Mapa, acao: string): Mapa {
  const passo = lista(job.steps).find((item) => typeof item.uses === 'string' && item.uses.startsWith(acao));
  assert.ok(passo, `${acao} precisa existir`);
  return passo;
}

function refResolvidaDoCheckout(passo: Mapa, evento: { base: string; head: string }): string {
  const ref = mapa(passo.with).ref;
  if (ref === '${{ github.event.pull_request.base.sha }}') return evento.base;
  if (ref === '${{ github.event.pull_request.head.sha }}') return evento.head;
  return String(ref ?? '');
}

function carregadoDoCi(raiz: string, nivel: 'observar' | 'avisar' | 'exigir' = 'exigir'): ManifestoCarregado {
  return { raiz, caminho: path.join(raiz, 'orkastery.yaml'), legado: false, bytes: 0, erros: [], avisos: [], manifesto: {
    project: { name: ESPERADO.project, abbrev: 'fix', stage: 'nascente' },
    worktree: { base_branch: 'main', dir: '.worktrees', por_thread: true },
    verify: { timeout_ms: 1000, timeout_ms_por_comando: {} },
    ci: { required_for_ship: false, context: 'ork-verify', external_repositories: {}, politica_recibo: nivel },
  } as unknown as Manifesto };
}

function escreverManifestoProtegido(raiz: string, nivel: 'observar' | 'avisar' | 'exigir' = 'exigir'): void {
  fs.writeFileSync(path.join(raiz, 'orkastery.yaml'), [
    'project:', `  name: ${ESPERADO.project}`, '  abbrev: fix', 'ci:', `  politica_recibo: ${nivel}`,
    '  transporte_excecao:', `    contrato: ${CONFIG.contrato}`, `    origem: ${CONFIG.origem}`,
    `    audiencia: ${CONFIG.audiencia}`, '    cliente:', `      versao: ${CONFIG.cliente.versao}`,
    `      sha256: ${CONFIG.cliente.sha256}`, '',
  ].join('\n'));
}

const resposta = (corpo: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status,
  json: async () => corpo } as Response);

function transporteValido() {
  const chaves = generateKeyPairSync('ed25519');
  const publica = createPublicKey(chaves.privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const policy: PoliticaDaExcecaoDeRecibo = { schema: CONTRATO_POLITICA_EXCECAO_RECIBO,
    version: 'policy-f7', level: 'exigir', project: ESPERADO.project, target: ESPERADO.target,
    recipientRef: 'responsible:release', maxValidityMs: null,
    notificationPort: { id: 'managed-f7', issuerId: 'notifier-f7', timeoutMs: 1000 },
    actors: [{ principalRef: 'account:builder', actorId: 'actor:builder', authorityId: null, groups: ['builder'] },
      { principalRef: 'account:approver', actorId: 'actor:approver', authorityId: null, groups: ['approver'] }],
    issuers: [{ id: 'notifier-f7', keyId: 'notifier-key-f7', publicKey: publica }] };
  const policySha256 = hashDaPoliticaDeExcecao(policy);
  const exception: ExcecaoDeRecibo = { schema: CONTRATO_EXCECAO_RECIBO, exceptionId: 'exception-f7',
    authorizationRef: 'auth_0123456789abcdefghijkl', justification: 'Autorização protegida.',
    scope: ['ci.receipt', 'source-head'], waivedReceipt: 'ork.ci-recibo-runner/v1', ...ESPERADO,
    policyVersion: policy.version, policySha256,
    policyOrigin: { type: 'protected-target', referenceHash: '1'.repeat(64) },
    builder: { principalHash: '2'.repeat(64), identityHash: '3'.repeat(64), groupsHash: '4'.repeat(64) },
    authorizer: { principalHash: '5'.repeat(64), identityHash: '6'.repeat(64), groupsHash: '7'.repeat(64) },
    responsibleRef: policy.recipientRef, issuedAt: AGORA, expiresAt: EXPIRA,
    review: { reference: 'review:f7', responsibleRef: policy.recipientRef, dueAt: EXPIRA },
    decision: 'waived', reason: 'Continuidade auditada.',
    notification: { state: 'pending', receiptId: null, receiptHash: null } };
  const recibo = (pedido: PedidoDeNotificacaoDaExcecao): ReciboDeNotificacaoDaExcecao => {
    const base: Omit<ReciboDeNotificacaoDaExcecao, 'receiptHash' | 'signature'> = {
      schema: CONTRATO_RECIBO_NOTIFICACAO_EXCECAO, receiptId: 'receipt-f7', requestId: pedido.requestId,
      requestHash: pedido.requestHash, idempotencyKey: pedido.idempotencyKey,
      issuer: { id: 'notifier-f7', keyId: 'notifier-key-f7' }, authorizationRef: pedido.authorizationRef,
      policyVersion: pedido.policyVersion, policySha256: pedido.policySha256, project: pedido.project,
      source: pedido.source, target: pedido.target, head: pedido.head, operation: pedido.operation,
      recipientRef: pedido.recipientRef, requestedAt: pedido.requestedAt, attemptedAt: AGORA,
      issuedAt: AGORA, deliveredAt: AGORA, result: 'delivered', providerProofRef: 'provider:f7',
      providerProofHash: '8'.repeat(64) };
    const receiptHash = hashDoReciboDeNotificacao(base);
    return { ...base, receiptHash,
      signature: sign(null, Buffer.from(receiptHash, 'utf8'), chaves.privateKey).toString('base64') };
  };
  const registrado = registrarNotificacaoAuditavel(exception, policy, 'ork-rm089f7recib', '/tmp/nao-usado', {
    schema: CONTRATO_PORTA_NOTIFICACAO_EXCECAO, id: policy.notificationPort.id,
    issuerId: policy.notificationPort.issuerId, independent: true, send: recibo,
  }, { schema: 'ork.excecao-notificacao-capability/v1', portId: policy.notificationPort.id,
    policySha256, operation: 'notify-receipt-exception', expiresAt: EXPIRA, verified: true },
  { agora: AGORA, registro: { uuid: () => 'event-f7', agora: () => AGORA, append: () => undefined } });
  assert.equal(registrado.ok, true);
  if (!registrado.ok) throw new Error('fixture inválida');
  const proof: ProvaProtegidaDaNotificacao = { schema: CONTRATO_PROVA_NOTIFICACAO_EXCECAO, policy,
    request: registrado.request, receipt: registrado.receipt, event: registrado.event };
  const capability: CapacidadeDoRunnerParaExcecao = { schema: CONTRATO_CAPACIDADE_RUNNER_EXCECAO,
    capabilityId: 'runner-capability-f7', policySha256, ledgerEventId: proof.event.ledgerEventId,
    recordedAt: proof.event.recordedAt, receiptHash: proof.receipt.receiptHash, ...ESPERADO,
    expiresAt: EXPIRA, verified: true };
  return { contrato: CONTRATO_TRANSPORTE_EXCECAO_RUNNER, proof, capability } as const;
}

test('a configuração pública v1 exige audiência exata e cliente pinado', () => {
  assert.equal(configuracaoPublicaDoTransporteValida(CONFIG), true);
  for (const invalida of [
    { ...CONFIG, audiencia: 'urn:outra' },
    { ...CONFIG, cliente: { ...CONFIG.cliente, sha256: 'curto' } },
    { ...CONFIG, origem: 'https://usuario:senha@fabrica.invalid/ci' },
    { ...CONFIG, extra: true },
  ]) assert.equal(configuracaoPublicaDoTransporteValida(invalida), false);
});

test('o manifesto protegido lê contrato, audiência e digest do cliente', () => {
  const lido = comandosDoTextoDoManifesto(`ci:\n  transporte_excecao:\n    contrato: ${CONFIG.contrato}\n    origem: ${CONFIG.origem}\n    audiencia: ${CONFIG.audiencia}\n    cliente:\n      versao: ${CONFIG.cliente.versao}\n      sha256: ${CONFIG.cliente.sha256}\n`);
  assert.deepEqual(lido?.transporteExcecao, CONFIG);
  assert.equal(comandosDoTextoDoManifesto(`ci:\n  transporte_excecao:\n    contrato: ${CONFIG.contrato}\n    origem: ${CONFIG.origem}\n    audiencia: urn:outra\n    cliente:\n      versao: ${CONFIG.cliente.versao}\n      sha256: ${CONFIG.cliente.sha256}\n`), null);
});

test('ausência, indisponibilidade e timeout têm códigos distintos nos três níveis', () => {
  const causas = { ausente: 'ci.recibo.ausente', indisponivel: 'ci.excecao.transporte-indisponivel',
    timeout: 'ci.excecao.transporte-prazo-excedido' } as const;
  for (const forja of ['github', 'gitlab'] as const) {
    for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
      for (const [estado, code] of Object.entries(causas)) {
        const resultado = projetarResultadoDoTransporte({ estado }, nivel, { ...ESPERADO, project: `${forja}-fixture` },
          '2026-11-25T00:00:00.000Z');
        assert.equal(resultado.aplicado, false, `${forja}:${nivel}:${estado}`);
        if (!resultado.aplicado) {
          assert.equal(resultado.code, code, `${forja}:${nivel}:${estado}`);
          assert.equal(resultado.reprova, nivel === 'exigir', `${forja}:${nivel}:${estado}`);
          assert.equal(resultado.avisar, nivel === 'avisar', `${forja}:${nivel}:${estado}`);
        }
      }
    }
  }
});

test('wrapper adulterado nunca promove confiança e a saída não contém prova nem capacidade', () => {
  const resultado = projetarResultadoDoTransporte({ contrato: CONTRATO_TRANSPORTE_EXCECAO_RUNNER,
    proof: {}, capability: {}, campoExtra: true }, 'exigir', ESPERADO, '2026-11-25T00:00:00.000Z');
  assert.equal(resultado.aplicado, false);
  if (!resultado.aplicado) assert.equal(resultado.code, 'ci.excecao.transporte-invalido');
  assert.equal(JSON.stringify(resultado).includes('proof'), false);
  assert.equal(JSON.stringify(resultado).includes('capability'), false);
});

test('a fábrica reobtém contexto antes de entregar e não compartilha a porta de assinatura', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const localizadores: LocalizadoresDoTransporteCi = { ...ESPERADO, forja, execucaoId: `${forja}:execucao`,
      construtor: `${forja}:builder` };
    const fatos: FatosReobtidosDaForjaCi = { ...localizadores, destinoProtegido: true, fork: false,
      principalNativo: forja === 'github' ? 'github-app:101' : 'gitlab-user:101', componenteProtegido: true };
    const chamadas: string[] = [];
    const resposta = atenderTransporteNaFabrica('token-opaco', localizadores, {
      autenticar: (token, audiencia) => { chamadas.push(`autenticar:${token}`); return {
        forja, audiencia, execucaoId: localizadores.execucaoId, principalNativo: fatos.principalNativo }; },
      reobter: () => { chamadas.push('reobter'); return fatos; },
      entregar: () => { chamadas.push('entregar-excecao'); return { estado: 'ausente' }; },
    });
    assert.deepEqual(resposta, { estado: 'ausente' });
    assert.deepEqual(chamadas, ['autenticar:token-opaco', 'reobter', 'entregar-excecao']);

    chamadas.length = 0;
    atenderTransporteNaFabrica('token-opaco', localizadores, {
      autenticar: (_token, audiencia) => ({ forja, audiencia, execucaoId: localizadores.execucaoId,
        principalNativo: fatos.principalNativo }),
      reobter: () => ({ ...fatos, fork: true }),
      entregar: () => { chamadas.push('entregar-excecao'); return { estado: 'ausente' }; },
    });
    assert.deepEqual(chamadas, [], `${forja}: fork é recusado antes da entrega`);
  }
});

test('o cliente protegido confina token e resposta bruta e devolve só resultado sanitizado', () => {
  const localizadores: LocalizadoresDoTransporteCi = { ...ESPERADO, forja: 'github',
    execucaoId: 'github:execucao', construtor: 'github:builder' };
  const resultado = executarClienteProtegidoDoTransporte(CONFIG, localizadores, 'avisar',
    '2026-11-25T00:00:00.000Z', { obter: (audiencia) => {
      assert.equal(audiencia, AUDIENCIA_FABRICA_CI); return 'token-secreto-fixture';
    } }, { consultar: (token, recebidos) => {
      assert.equal(token, 'token-secreto-fixture'); assert.deepEqual(recebidos, localizadores);
      return { estado: 'indisponivel' };
    } });
  const serializado = JSON.stringify(resultado);
  assert.doesNotMatch(serializado, /token-secreto-fixture|proof|capability/);
  assert.equal(resultado.aplicado, false);
  if (!resultado.aplicado) assert.equal(resultado.code, 'ci.excecao.transporte-indisponivel');
});

test('receitas executam fonte, configuração, cliente e credencial em fronteiras distintas', () => {
  const ci = documentosYaml('.github/workflows/ci.yml')[0];
  const jobsCi = mapa(ci.jobs);
  const orkVerify = mapa(jobsCi['ork-verify']);
  const checkoutDoReplay = passoPorAcao(orkVerify, 'actions/checkout@');
  assert.equal(mapa(checkoutDoReplay.with)['persist-credentials'] ?? true, false,
    'o checkout do replay não persiste credencial');
  for (const nome of ['documentacao', 'nucleo', 'mods']) {
    const checkoutPadrao = passoPorAcao(mapa(jobsCi[nome]), 'actions/checkout@');
    assert.equal(mapa(checkoutPadrao.with).ref, undefined, `${nome} usa o checkout padrão do evento`);
  }

  const protegido = documentosYaml('.github/workflows/ork-excecao-transporte.yml')[0];
  const jobsGithub = mapa(protegido.jobs);
  const preparar = mapa(jobsGithub['preparar-cliente']);
  const privilegiado = mapa(jobsGithub['ork-excecao-transporte']);
  assert.equal('id-token' in mapa(preparar.permissions), false, 'preparação não recebe OIDC');
  assert.equal(mapa(privilegiado.permissions)['id-token'], 'write');
  const checkoutDaTarget = passoPorAcao(preparar, 'actions/checkout@');
  assert.equal(refResolvidaDoCheckout(checkoutDaTarget, { base: 'base-protegida', head: 'head-do-pr' }),
    'base-protegida', 'a configuração e o pino vêm da base');
  const checkoutDaFonte = passoPorAcao(privilegiado, 'actions/checkout@');
  assert.equal(refResolvidaDoCheckout(checkoutDaFonte, { base: 'base-protegida', head: 'head-do-pr' }), 'head-do-pr');
  assert.equal(mapa(checkoutDaFonte.with)['persist-credentials'] ?? true, false);
  const comandosPrivilegiados = lista(privilegiado.steps).flatMap((passo) =>
    typeof passo.run === 'string' ? [passo.run] : []).join('\n');
  assert.doesNotMatch(comandosPrivilegiados, /npm\s+(?:ci|install|pack)/,
    'o job com OIDC não obtém nem instala pacote');
  assert.match(comandosPrivilegiados, /dist\/index\.js" ci run --branch/);

  const pacote = JSON.parse(ler('core/package.json')) as { bundleDependencies?: unknown };
  assert.equal(pacote.bundleDependencies, true, 'o digest do tarball cobre a árvore de produção embutida');

  const [spec, jobsComponente] = documentosYaml('templates/ork-verify/template.yml');
  assert.equal(mapa(mapa(mapa(spec.spec).inputs).transporte_habilitado).default, false,
    'sem opt-in o componente continua válido');
  const prepararComponente = mapa(jobsComponente['$[[ inputs.contexto ]]-preparar-cliente']);
  const finalComponente = mapa(jobsComponente['$[[ inputs.contexto ]]']);
  assert.equal('id_tokens' in prepararComponente, false);
  const scriptComponente = (finalComponente.script as string[]).join('\n');
  assert.ok(scriptComponente.indexOf('unset ORK_FABRICA_ID_TOKEN') < scriptComponente.indexOf('npm install'),
    'sem opt-in o token sai antes da instalação');
  assert.match(scriptComponente, /--ignore-scripts/);
  assert.match(scriptComponente, /ORK_TARGET_PROTEGIDA_DIR/);

  const jobsGitlab = documentosYaml('templates/gitlab/ork-verify.yml')[0];
  const prepararGitlab = mapa(jobsGitlab['ork-cliente-protegido']);
  const finalGitlab = mapa(jobsGitlab['ork-verify']);
  assert.equal('id_tokens' in prepararGitlab, false);
  const scriptGitlab = (finalGitlab.script as string[]).join('\n');
  assert.ok(scriptGitlab.indexOf('unset ORK_FABRICA_ID_TOKEN') < scriptGitlab.indexOf('npm install'));
  assert.match(scriptGitlab, /--ignore-scripts/);
  assert.match(scriptGitlab, /ORK_TARGET_PROTEGIDA_DIR/);
});

test('launcher reutilizável usa o PR original só como localizador', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-f7-workflow-run-'));
  try {
    const evento = path.join(dir, 'evento.json');
    fs.writeFileSync(evento, JSON.stringify({ pull_request: { head: { sha: 'd'.repeat(40), ref: 'feature/segura' },
      base: { ref: 'main' }, user: { id: 901 } } }));
    assert.deepEqual(localizadoresDoLauncher({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: evento,
      GITHUB_REPOSITORY: 'org/projeto', GITHUB_RUN_ID: '71', GITHUB_ACTOR_ID: '999' }), {
      forja: 'github', project: 'org/projeto', source: 'feature/segura', target: 'main', head: 'd'.repeat(40),
      operation: 'ci.run', execucaoId: '71', construtor: '901',
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pipeline GitLab comum usa CI_COMMIT_SHA e nunca sai silencioso por SHA ausente', () => {
  assert.deepEqual(localizadoresDoLauncher({ GITLAB_CI: 'true', CI_PROJECT_PATH: ESPERADO.project,
    CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: ESPERADO.source, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: ESPERADO.target,
    CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: '', CI_COMMIT_SHA: ESPERADO.head, CI_JOB_ID: '72', GITLAB_USER_ID: '902' }), {
    ...ESPERADO, forja: 'gitlab', execucaoId: '72', construtor: '902',
  });
});

test('identidade OIDC é retirada do ambiente antes de qualquer passo não confiável', async () => {
  const gitlab = { ORK_FABRICA_ID_TOKEN: 'token-gitlab' };
  assert.equal(await identidadeOidcDoLauncher('gitlab', gitlab), 'token-gitlab');
  assert.equal(gitlab.ORK_FABRICA_ID_TOKEN, undefined);
  const github: NodeJS.ProcessEnv = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid/token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'credencial-github' };
  const token = await identidadeOidcDoLauncher('github', github, (async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).authorization, 'bearer credencial-github');
    return resposta({ value: 'token-github' });
  }) as typeof fetch);
  assert.equal(token, 'token-github');
  assert.equal(github.ACTIONS_ID_TOKEN_REQUEST_URL, undefined);
  assert.equal(github.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
});

test('o transporte integrado altera o veredito real e nunca encobre projeção inválida', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-f7-ci-integrado-'));
  const branch = ESPERADO.source;
  try {
    fs.mkdirSync(path.join(raiz, '.ork-ci'));
    const arquivo = path.join(raiz, '.ork-ci/ork-rm089f7fixture.json');
    fs.writeFileSync(arquivo, JSON.stringify({ schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f7fixture',
      branch, base: 'main', claims: [], commands: [] }));
    let consultas = 0;
    const aplicado = executarCiDaBranchComContexto(carregadoDoCi(raiz), branch, {
      destino: ESPERADO.target, project: ESPERADO.project, pullRequest: true, preflightEmpresa: null,
      head: ESPERADO.head, transporteProtegido: { agora: AGORA, consultar: () => { consultas++; return transporteValido(); } },
    }) as { ok: boolean; policy: { exception?: string }; exception?: unknown };
    assert.equal(aplicado.ok, true);
    assert.equal(aplicado.policy.exception, 'applied');
    assert.ok(aplicado.exception);
    assert.equal(consultas, 1);

    const projecaoInvalida = criarProjecaoReplayCi({ thread: 'ork-rm089f7fixture', claims: [], check: 'agile',
      baseline: null, commands: [] });
    fs.writeFileSync(arquivo, JSON.stringify({ schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f7fixture',
      branch, base: 'main', claims: [], commands: [], recibo: projecaoInvalida }));
    consultas = 0;
    const invalido = executarCiDaBranchComContexto(carregadoDoCi(raiz), branch, {
      destino: ESPERADO.target, project: ESPERADO.project, pullRequest: true, preflightEmpresa: null,
      head: ESPERADO.head, receitaConfiavel: { commands: [], check: 'agile' },
      transporteProtegido: { agora: AGORA, consultar: () => { consultas++; return transporteValido(); } },
    }) as { ok: boolean; policy: { receipt: string }; error: { code: string } };
    assert.equal(invalido.ok, false);
    assert.equal(invalido.policy.receipt, 'invalido');
    assert.equal(invalido.error.code, 'ci.recibo.invalido');
    assert.equal(consultas, 0, 'a exceção só se aplica à ausência');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('launcher usa target explícita, liga o resultado ao ci run e separa rede de timeout', async () => {
  const raizProtegida = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-f7-target-'));
  const raizFonte = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-f7-source-'));
  const raizSemOptIn = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-f7-sem-opt-in-'));
  try {
    escreverManifestoProtegido(raizProtegida, 'avisar');
    fs.writeFileSync(path.join(raizSemOptIn, 'orkastery.yaml'), [
      'project:', `  name: ${ESPERADO.project}`, '  abbrev: fix', 'ci:', '  politica_recibo: exigir', '',
    ].join('\n'));
    fs.writeFileSync(path.join(raizFonte, 'orkastery.yaml'), 'ci:\n  transporte_excecao:\n    origem: https://coletor.invalid/token\n');
    const env: NodeJS.ProcessEnv = { GITLAB_CI: 'true', CI_PROJECT_PATH: ESPERADO.project,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: ESPERADO.source, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: ESPERADO.target,
      CI_COMMIT_SHA: ESPERADO.head, CI_JOB_ID: '72', GITLAB_USER_ID: '902', ORK_FABRICA_ID_TOKEN: 'token-protegido',
      ORK_TARGET_PROTEGIDA_DIR: raizProtegida, ORK_FONTE_NAO_CONFIAVEL_DIR: raizFonte };
    const linhas: string[] = [], saidas: string[] = [], origens: string[] = [];
    const codigo = await executarLauncherNativoDoTransporte(ESPERADO.source, env, {
      agora: () => AGORA, executarReplay: ({ env: ambiente }) => {
        assert.equal(ambiente.ORK_FABRICA_ID_TOKEN, undefined);
        return { schema: 'ork.ci-run/v1', ok: true, verify: { ok: true }, claims: [], commands: [],
          policy: { level: 'avisar', receipt: 'ausente', message: 'ci.recibo.ausente' },
          error: { code: 'ci.recibo.ausente' } };
      },
      buscar: (async (url) => { origens.push(String(url)); const erro = new Error('prazo'); erro.name = 'TimeoutError'; throw erro; }) as typeof fetch,
      avisar: (resultado, ambiente) => { publicarAvisoDaPolitica(resultado, ambiente, (linha) => linhas.push(linha)); },
      escrever: (texto) => { saidas.push(texto); },
    });
    assert.equal(codigo, 0);
    assert.deepEqual(origens, [CONFIG.origem]);
    assert.ok(linhas.some((linha) => linha === 'WARNING: ci.excecao.transporte-prazo-excedido'));
    assert.match(saidas.join(''), /ci\.excecao\.transporte-prazo-excedido/);

    const saidaDeRede: string[] = [];
    const codigoDeRede = await executarLauncherNativoDoTransporte(ESPERADO.source,
      { ...env, ORK_FABRICA_ID_TOKEN: 'token-de-rede' }, {
        agora: () => AGORA,
        executarReplay: () => ({ schema: 'ork.ci-run/v1', ok: true, verify: { ok: true }, claims: [], commands: [],
          policy: { level: 'exigir', receipt: 'ausente', message: 'ci.recibo.ausente' },
          error: { code: 'ci.recibo.ausente' } }),
        buscar: (async () => { throw new TypeError('rede indisponível'); }) as typeof fetch,
        avisar: () => undefined, escrever: (texto) => { saidaDeRede.push(texto); },
      });
    assert.equal(codigoDeRede, 0, 'avisar anota a falha de rede sem reprovar');
    assert.match(saidaDeRede.join(''), /ci\.excecao\.transporte-indisponivel/);
    assert.doesNotMatch(saidaDeRede.join(''), /ci\.excecao\.transporte-prazo-excedido/);

    const semConsulta: string[] = [];
    const codigoComRecibo = await executarLauncherNativoDoTransporte(ESPERADO.source,
      { ...env, ORK_FABRICA_ID_TOKEN: 'outro-token' }, {
        executarReplay: () => ({ schema: 'ork.ci-run/v1', ok: true, policy: { level: 'exigir', receipt: 'presente' } }),
        buscar: (async (url) => { semConsulta.push(String(url)); return resposta({ estado: 'ausente' }); }) as typeof fetch,
        avisar: () => undefined, escrever: () => undefined,
      });
    assert.equal(codigoComRecibo, 0);
    assert.deepEqual(semConsulta, [], 'recibo válido encerra antes da fábrica');

    const consultasSemOptIn: string[] = [];
    const envSemOptIn: NodeJS.ProcessEnv = { ...env, ORK_TARGET_PROTEGIDA_DIR: raizSemOptIn,
      ORK_FABRICA_ID_TOKEN: 'token-que-nao-pode-sobrar' };
    const codigoSemOptIn = await executarLauncherNativoDoTransporte(ESPERADO.source, envSemOptIn, {
      executarReplay: ({ env: ambiente }) => {
        assert.equal(ambiente.ORK_FABRICA_ID_TOKEN, undefined);
        return { schema: 'ork.ci-run/v1', ok: true, policy: { level: 'exigir', receipt: 'ausente' } };
      },
      buscar: (async (url) => { consultasSemOptIn.push(String(url)); return resposta({ estado: 'ausente' }); }) as typeof fetch,
      avisar: () => undefined, escrever: () => undefined,
    });
    assert.equal(codigoSemOptIn, 0, 'sem opt-in preserva o replay anterior');
    assert.deepEqual(consultasSemOptIn, []);
  } finally {
    fs.rmSync(raizProtegida, { recursive: true, force: true });
    fs.rmSync(raizFonte, { recursive: true, force: true });
    fs.rmSync(raizSemOptIn, { recursive: true, force: true });
  }
});

test('GitHub reobtém app nativo, execução, workflow, target e HEAD antes da entrega', () => {
  const esperado = { project: 'org/projeto', source: 'feature/segura', target: 'main', head: 'c'.repeat(40),
    context: 'ork-replay', execucaoId: '71', construtor: 'github-user:900' };
  const bruto = { check: { id: 81, name: esperado.context, status: 'completed', conclusion: 'success',
    head_sha: esperado.head, app: { id: 101, slug: 'github-actions' } },
  run: { id: 71, head_sha: esperado.head, head_branch: esperado.source, event: 'pull_request', workflow_id: 91,
    actor: { id: 901 }, repository: { full_name: esperado.project } },
  workflow: { id: 91, protected: true }, target: { name: esperado.target, protected: true },
  sourceRepository: esperado.project, targetRepository: esperado.project };
  const evidencia = evidenciaCanonicaDoGithub(bruto, esperado);
  assert.equal(evidencia?.principalNativo, 'github-app:101');
  assert.equal(evidencia?.iniciador, 'github-user:901');
  for (const invalido of [
    { ...bruto, check: { ...bruto.check, app: {} } },
    { ...bruto, check: { ...bruto.check, head_sha: 'd'.repeat(40) } },
    { ...bruto, workflow: { ...bruto.workflow, protected: false } },
    { ...bruto, target: { ...bruto.target, protected: false } },
    { ...bruto, sourceRepository: 'fork/projeto' },
  ]) assert.equal(evidenciaCanonicaDoGithub(invalido, esperado), null);
  assert.equal(evidenciaCanonicaDoGithub(bruto, { ...esperado, construtor: 'github-app:101' }), null);
  assert.deepEqual(identidadeNativaDoAmbienteCi({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '71',
    GITHUB_ACTOR_ID: '901' }), { forja: 'github', execucaoId: '71', iniciadorId: '901' });
});

test('GitLab reobtém user_id do job, pipeline, configuração, target e HEAD antes da entrega', () => {
  const esperado = { project: 'grupo/projeto', source: 'feature/segura', target: 'main', head: 'e'.repeat(40),
    context: 'ork-replay', execucaoId: '72', construtor: 'gitlab-user:900' };
  const bruto = { job: { id: 72, name: esperado.context, status: 'success', user: { id: 102 },
    pipeline: { id: 82, project_id: 92, sha: esperado.head } },
  pipeline: { id: 82, project_id: 92, sha: esperado.head, source: 'merge_request_event', user: { id: 902 } },
  project: { id: 92, path_with_namespace: esperado.project }, mergeRequest: { source_branch: esperado.source,
    target_branch: esperado.target, sha: esperado.head, source_project_id: 92, target_project_id: 92 },
  target: { protected: true }, configuration: { protected: true } };
  const evidencia = evidenciaCanonicaDoGitlab(bruto, esperado);
  assert.equal(evidencia?.principalNativo, 'gitlab-user:102');
  assert.equal(evidencia?.iniciador, 'gitlab-user:902');
  for (const invalido of [
    { ...bruto, job: { ...bruto.job, user: {} } },
    { ...bruto, pipeline: { ...bruto.pipeline, sha: 'f'.repeat(40) } },
    { ...bruto, target: { protected: false } },
    { ...bruto, configuration: { protected: false } },
    { ...bruto, mergeRequest: { ...bruto.mergeRequest, source_project_id: 93 } },
  ]) assert.equal(evidenciaCanonicaDoGitlab(invalido, esperado), null);
  assert.equal(evidenciaCanonicaDoGitlab(bruto, { ...esperado, construtor: 'gitlab-user:102' }), null);
  assert.deepEqual(identidadeNativaDoAmbienteCi({ GITLAB_CI: 'true', CI_JOB_ID: '72', CI_PIPELINE_ID: '82',
    GITLAB_USER_ID: '902' }), { forja: 'gitlab', execucaoId: '72', iniciadorId: '902', pipelineId: '82' });
});

test('matriz hermética: entrega, reentrada, escopo, expiração, emissor e fontes não confiáveis', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const transporte = transporteValido();
    const valido = projetarResultadoDoTransporte(transporte, 'exigir', ESPERADO, AGORA);
    assert.equal(valido.aplicado, true, `${forja}: entrega válida`);
    assert.deepEqual(projetarResultadoDoTransporte(transporte, 'exigir', ESPERADO, AGORA), valido,
      `${forja}: reentrada exata é idempotente`);

    const casos: Array<[string, unknown, typeof ESPERADO, string]> = [
      ['outro HEAD', transporte, { ...ESPERADO, head: 'c'.repeat(40) }, AGORA],
      ['capacidade vencida', { ...transporte, capability: { ...transporte.capability,
        expiresAt: '2026-11-24T00:00:00.000Z' } }, ESPERADO, AGORA],
      ['emissor divergente', { ...transporte, proof: { ...transporte.proof,
        receipt: { ...transporte.proof.receipt, issuer: { id: 'outro', keyId: 'outra' } } } }, ESPERADO, AGORA],
      ['proof adulterada', { ...transporte, proof: { ...transporte.proof,
        request: { ...transporte.proof.request, source: 'outra' } } }, ESPERADO, AGORA],
      ['capability adulterada', { ...transporte, capability: { ...transporte.capability,
        receiptHash: '9'.repeat(64) } }, ESPERADO, AGORA],
      ['campo extra', { ...transporte, extra: true }, ESPERADO, AGORA],
    ];
    for (const [nome, entrada, esperado, agora] of casos) {
      const resultado = projetarResultadoDoTransporte(entrada, 'exigir', esperado, agora);
      assert.equal(resultado.aplicado, false, `${forja}: ${nome}`);
      if (!resultado.aplicado) assert.equal(resultado.code, 'ci.excecao.transporte-invalido', `${forja}: ${nome}`);
    }

    for (const fonte of ['argv', 'environment', 'checkout', 'bundle'] as const) {
      const fabricado = { contrato: CONTRATO_TRANSPORTE_EXCECAO_RUNNER, proof: transporte.proof,
        capability: transporte.capability, [fonte]: true };
      const resultado = projetarResultadoDoTransporte(fabricado, 'exigir', ESPERADO, AGORA);
      assert.equal(resultado.aplicado, false, `${forja}: ${fonte}`);
      assert.doesNotMatch(JSON.stringify(resultado), /proof|capability|token/, `${forja}: ${fonte}`);
    }

    const localizadores: LocalizadoresDoTransporteCi = { ...ESPERADO, forja,
      execucaoId: `${forja}:execucao-matriz`, construtor: forja === 'github' ? 'github-user:900' : 'gitlab-user:900' };
    const sanitizado = executarClienteProtegidoDoTransporte(CONFIG, localizadores, 'exigir', AGORA,
      { obter: () => `token-${forja}` }, { consultar: () => transporte });
    assert.equal(sanitizado.aplicado, true, `${forja}: launcher aplica`);
    assert.doesNotMatch(JSON.stringify(sanitizado), new RegExp(`token-${forja}|proof|capability`),
      `${forja}: launcher só devolve resultado sanitizado`);
  }
});

test('fork, target não protegida, principal inválido e identidade divergente param antes da entrega', () => {
  for (const forja of ['github', 'gitlab'] as const) {
    const localizadores: LocalizadoresDoTransporteCi = { ...ESPERADO, forja, execucaoId: `${forja}:execucao`,
      construtor: forja === 'github' ? 'github-user:900' : 'gitlab-user:900' };
    const base: FatosReobtidosDaForjaCi = { ...localizadores, destinoProtegido: true, fork: false,
      principalNativo: forja === 'github' ? 'github-app:101' : 'gitlab-user:101', componenteProtegido: true };
    for (const fatos of [{ ...base, fork: true }, { ...base, destinoProtegido: false },
      { ...base, componenteProtegido: false }, { ...base, principalNativo: localizadores.construtor },
      { ...base, principalNativo: 'builder' }]) {
      let entregas = 0;
      const resposta = atenderTransporteNaFabrica('token-opaco', localizadores, {
        autenticar: (_token, audiencia) => ({ forja, audiencia, execucaoId: localizadores.execucaoId,
          principalNativo: fatos.principalNativo }), reobter: () => fatos,
        entregar: () => { entregas++; return transporteValido(); },
      });
      assert.deepEqual(resposta, { estado: 'ausente' }, `${forja}: recusa tipada`);
      assert.equal(entregas, 0, `${forja}: zero chamada sensível`);
    }
  }
});

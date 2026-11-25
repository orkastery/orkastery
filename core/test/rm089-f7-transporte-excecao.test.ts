/** RM-089 F7: transporte autenticado da exceção nas duas forjas. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AUDIENCIA_FABRICA_CI, CONTRATO_TRANSPORTE_EXCECAO_RUNNER,
  atenderTransporteNaFabrica, configuracaoPublicaDoTransporteValida, executarClienteProtegidoDoTransporte,
  projetarResultadoDoTransporte, type FatosReobtidosDaForjaCi,
  type LocalizadoresDoTransporteCi } from '../src/ci-fabrica-transporte';
import { comandosDoTextoDoManifesto } from '../src/manifest';
import { evidenciaCanonicaDoGithub } from '../src/forja/github/ci';
import { identidadeNativaDoAmbienteCi } from '../src/forja/ambiente-de-ci';

const CONFIG = { contrato: CONTRATO_TRANSPORTE_EXCECAO_RUNNER, origem: 'https://fabrica.invalid/ci',
  audiencia: AUDIENCIA_FABRICA_CI, cliente: { versao: '0.6.10', sha256: 'a'.repeat(64) } };
const ESPERADO = { project: 'projeto-fixture', source: 'feature/fixture', target: 'main', head: 'b'.repeat(40),
  operation: 'ci.run' as const };

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
      principalNativo: forja === 'github' ? 'github-app:101' : 'gitlab:check', componenteProtegido: true };
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

test('as receitas das duas forjas separam replay e launcher pinado', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const github = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(github, /pull_request_target/);
  assert.match(github, /ork-replay:[\s\S]*permissions:[\s\S]*contents: read/);
  assert.match(github, /ork-verify:[\s\S]*id-token: write/);
  assert.match(github, /pull_request\.base\.sha/);
  const componente = fs.readFileSync('templates/ork-verify/template.yml', 'utf8');
  const gitlab = fs.readFileSync('templates/gitlab/ork-verify.yml', 'utf8');
  for (const receita of [componente, gitlab]) {
    assert.match(receita, /ORK_FABRICA_ID_TOKEN/);
    assert.match(receita, /urn:orkastery:fabrica:ci/);
    assert.match(receita, /sha256sum --check --strict/);
    assert.match(receita, /GIT_STRATEGY: "none"/);
    assert.match(receita, /ci-fabrica-transporte\.js/);
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

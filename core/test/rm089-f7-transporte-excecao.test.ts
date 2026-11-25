/** RM-089 F7: transporte autenticado da exceção nas duas forjas. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AUDIENCIA_FABRICA_CI, CONTRATO_TRANSPORTE_EXCECAO_RUNNER,
  configuracaoPublicaDoTransporteValida, projetarResultadoDoTransporte } from '../src/ci-fabrica-transporte';
import { comandosDoTextoDoManifesto } from '../src/manifest';

const CONFIG = { contrato: CONTRATO_TRANSPORTE_EXCECAO_RUNNER, origem: 'https://fabrica.invalid/ci',
  audiencia: AUDIENCIA_FABRICA_CI, cliente: { versao: '0.6.10', sha256: 'a'.repeat(64) } };
const ESPERADO = { project: 'projeto-fixture', source: 'feature/fixture', target: 'main', head: 'b'.repeat(40),
  operation: 'ci.run' };

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

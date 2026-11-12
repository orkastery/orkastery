import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { comandoMaturidade, CONTRATO_CLI_MATURIDADE } from '../src/telemetria-maturidade-cli';
import { comandoTelemetria, contextoPadrao } from '../src/telemetria-cli';
import { projetoTemporario } from './apoio';

const desde = '2026-11-01T00:00:00.000Z', ate = '2026-12-01T00:00:00.000Z';
const eventos = [{ tipo: 'thread_created', ts: '2026-11-10T12:00:00.000Z', eventId: 'e1',
  thread: 'ork-a', modo: '#Auto' }];

test('comando local calcula sem consultar opt-in, endpoint ou transporte', async () => {
  let ativacao = 0, destino = 0, exportacao = 0;
  const linhas: string[] = [];
  const resultado = await comandoTelemetria({ raiz: '/projeto', subcomando: 'maturidade', desde, ate, json: true,
    escrever: (linha) => linhas.push(linha), dependencias: {
      resolverAtivacao: () => { ativacao += 1; throw new Error('não deve consultar'); },
      destino: () => { destino += 1; throw new Error('não deve consultar'); },
      exportar: async () => { exportacao += 1; throw new Error('não deve transportar'); },
    } });
  assert.equal(resultado.codigo, 0);
  assert.deepEqual({ ativacao, destino, exportacao }, { ativacao: 0, destino: 0, exportacao: 0 });
  assert.equal(JSON.parse(linhas[0]).schema, CONTRATO_CLI_MATURIDADE);
});

test('saída JSON mantém indicadores e DORA separados e não confirmados sem fatos externos', () => {
  const resultado = comandoMaturidade({ raiz: '/projeto', desde, ate, json: true, escrever: () => {},
    dependencias: { eventos: () => eventos } });
  const analytics = resultado.resposta.analytics as { indicadores: unknown[] };
  const dora = resultado.resposta.dora as { medidas: Array<{ estado: string }> };
  assert.equal(analytics.indicadores.length, 6);
  assert.deepEqual(dora.medidas.map((item) => item.estado), Array(5).fill('não confirmado'));
});

test('saída humana declara janela, cobertura e lacuna DORA sem nota ou meta', () => {
  const linhas: string[] = [];
  comandoMaturidade({ raiz: '/projeto', desde, ate, escrever: (linha) => linhas.push(linha),
    dependencias: { eventos: () => eventos } });
  const texto = linhas.join('\n');
  assert.match(texto, /janela \[/);
  assert.match(texto, /cobertura/);
  assert.match(texto, /DORA: não confirmado/);
  assert.doesNotMatch(texto.toLowerCase(), /nota|ranking|meta/);
});

test('janela inválida ou implícita é recusada', () => {
  assert.throws(() => comandoMaturidade({ raiz: '/projeto', dependencias: { eventos: () => [] } }), /telemetria/);
  assert.throws(() => comandoMaturidade({ raiz: '/projeto', desde: ate, ate: desde,
    dependencias: { eventos: () => [] } }), /telemetria/);
});

test('service.namespace vem da política de ambiente e continua ausente sem ela', (t) => {
  const projeto = projetoTemporario('maturidade-contexto');
  t.after(() => projeto.limpar());
  const comTime = contextoPadrao(projeto.dir, 'hash', { OTEL_SERVICE_NAMESPACE: 'time-a' });
  const semTime = contextoPadrao(projeto.dir, 'hash', {});
  assert.equal(comTime.serviceNamespace, 'time-a');
  assert.equal(semTime.serviceNamespace, undefined);
});

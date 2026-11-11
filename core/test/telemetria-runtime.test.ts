import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { prepararTelemetriaDoRuntime, resolverTelemetriaDoRuntime } from '../src/telemetria-runtime';
import type { ResolucaoTelemetria } from '../src/telemetria-config';

const ligada: ResolucaoTelemetria = { ligada: true, origem: 'builder', motivo: 'teste', pseudonimo: 'a'.repeat(64) };
const desligada: ResolucaoTelemetria = { ligada: false, origem: 'builder', motivo: 'teste', pseudonimo: 'a'.repeat(64) };
const contexto = { thread: 'ork-exemplo', fase: 'GO', dispatchId: 'despacho-exemplo' };
const destino = { endpoint: 'https://collector.example/v1/logs', headers: { authorization: 'Bearer VALOR-SINTETICO' }, timeoutMs: 1000 };

test('ativação ausente ou desligada e destino inseguro não decoram o despacho', () => {
  assert.equal(prepararTelemetriaDoRuntime('codex', contexto, desligada, destino), undefined);
  assert.equal(prepararTelemetriaDoRuntime('codex', contexto, { ...ligada, pseudonimo: null }, destino), undefined);
  assert.equal(prepararTelemetriaDoRuntime('grok', contexto, ligada, destino), undefined);
  for (const endpoint of ['https://usuario:senha@collector.example/v1/logs',
    'https://collector.example/v1/logs?token=valor', 'https://collector.example/v1/logs#valor']) {
    assert.equal(prepararTelemetriaDoRuntime('codex', contexto, ligada, { ...destino, endpoint }), undefined);
  }
});

test('Claude Code recebe logs correlacionados e todo conteúdo nativo desligado', () => {
  const preparado = prepararTelemetriaDoRuntime('claude-bg', contexto, ligada, destino);
  assert.equal(preparado?.runtime, 'claude-bg');
  if (!preparado || preparado.runtime !== 'claude-bg') return;
  assert.deepEqual(preparado.settingsEnv, {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_TRACES_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://collector.example/v1/logs',
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'authorization=Bearer%20VALOR-SINTETICO',
    OTEL_RESOURCE_ATTRIBUTES: 'orkastery.thread.id=ork-exemplo,orkastery.phase.name=GO,orkastery.dispatch.id=despacho-exemplo,user.hash=' + 'a'.repeat(64),
    OTEL_LOG_USER_PROMPTS: '0',
    OTEL_LOG_ASSISTANT_RESPONSES: '0',
    OTEL_LOG_TOOL_DETAILS: '0',
    OTEL_LOG_TOOL_CONTENT: '0',
  });
});

test('Codex recebe logs sem conteúdo, métricas ou traces; segredo fica só no ambiente', () => {
  const preparado = prepararTelemetriaDoRuntime('codex', contexto, ligada, destino);
  assert.equal(preparado?.runtime, 'codex');
  if (!preparado || preparado.runtime !== 'codex') return;
  assert.deepEqual(preparado.ambiente, { ORK_TELEMETRIA_OTLP_HEADER_0: 'Bearer VALOR-SINTETICO' });
  const argv = preparado.argumentos.join(' ');
  assert.match(argv, /otel\.log_user_prompt=false/);
  assert.match(argv, /otel\.log_agent_responses=false/);
  assert.match(argv, /otel\.log_guardian_assessments=false/);
  assert.match(argv, /otel\.tool_result\.max_bytes=0/);
  assert.match(argv, /otel\.metrics_exporter="none"/);
  assert.match(argv, /otel\.trace_exporter="none"/);
  assert.match(argv, /\$\{ORK_TELEMETRIA_OTLP_HEADER_0\}/);
  assert.equal(argv.includes('Bearer VALOR-SINTETICO'), false);
});

test('resolução não consulta destino quando desligada e falha fechada sem alterar o pedido', () => {
  let destinos = 0;
  const dependencias = {
    ativacao: () => desligada,
    destino: () => { destinos += 1; return destino; },
  };
  assert.equal(resolverTelemetriaDoRuntime('codex', contexto, {}, dependencias), undefined);
  assert.equal(destinos, 0);
  assert.equal(resolverTelemetriaDoRuntime('codex', contexto, {}, {
    ativacao: () => { throw new Error('configuração sintética inválida'); },
    destino: () => destino,
  }), undefined);
});

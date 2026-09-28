import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ambienteDeAssinatura } from '../src/runtime-ambiente';
import { despachar as claude } from '../src/adapters/claude-bg';
import { encerrarController } from '../src/adapters/codex-controller';
import { controllerSimulado } from './controller-simulado';
import { avaliarPolicies } from '../src/policies';
import { carregarManifesto } from '../src/manifest';
import { dirTemporario } from './apoio';

// Contrato independente da constante de produção: remover um nome da fronteira falha aqui.
const NOMES_DO_CONTRATO = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT',
  'MISTRAL_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'TOGETHER_API_KEY',
  'ORK_HITL_NATIVE_KEY_HERMES', 'ORK_HITL_NATIVE_KEY_OPENCLAW',
  'ORK_HITL_NATIVE_BINDING_HERMES', 'ORK_HITL_NATIVE_BINDING_OPENCLAW',
  'ORK_HITL_INGRESS_KEY', 'ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_INGRESS_KEY_OPENCLAW',
];

test('ambiente é cópia; preserva autenticação de assinatura e configuração não paga', () => {
  const base = { HOME: '/home/teste', PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'assinatura',
    ORKASTERY_ORKMIND_DATABASE_URL: 'fixture', OPENAI_API_KEY: 'fixture',
    HTTPS_PROXY: 'http://fixture.invalid', CODEX_HOME: '/fixture/codex',
    ORK_HITL_NATIVE_KEY_HERMES: 'fixture-private', ORK_HITL_NATIVE_BINDING_HERMES: 'fixture-scope',
    ORK_HITL_INGRESS_KEY_OPENCLAW: 'fixture-telegram', ORK_HITL_FUTURE_SECRET: 'fixture-future' };
  const limpo = ambienteDeAssinatura(base);
  assert.equal(limpo.OPENAI_API_KEY, undefined);
  assert.equal(base.OPENAI_API_KEY, 'fixture');
  assert.equal(limpo.CLAUDE_CODE_OAUTH_TOKEN, base.CLAUDE_CODE_OAUTH_TOKEN);
  assert.equal(limpo.ORKASTERY_ORKMIND_DATABASE_URL, base.ORKASTERY_ORKMIND_DATABASE_URL);
  assert.equal(limpo.HTTPS_PROXY, base.HTTPS_PROXY);
  assert.equal(limpo.CODEX_HOME, base.CODEX_HOME);
  assert.deepEqual(Object.keys(limpo).filter(n => n.startsWith('ORK_HITL_')), []);
  assert.equal(base.ORK_HITL_NATIVE_KEY_HERMES, 'fixture-private');
  assert.equal(base.ORK_HITL_NATIVE_BINDING_HERMES, 'fixture-scope');
  assert.equal(base.ORK_HITL_INGRESS_KEY_OPENCLAW, 'fixture-telegram');
});

test('despachos reais dos dois adapters recebem ambiente limpo e não escondem policy no pai', () => {
  const dir = dirTemporario('runtime-higiene');
  const anterior = { ...process.env };
  const id = '0199aaaa-bbbb-cccc-dddd-eeeeffff0002';
  const script = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const nomes = ${JSON.stringify(NOMES_DO_CONTRATO)};
fs.appendFileSync(process.env.ORK_HIGIENE_CAPTURE, JSON.stringify({
  recebidas: nomes.filter(n => n in process.env), home: !!process.env.HOME
}) + '\\n');
if (process.argv.includes('agents')) {
  console.log(JSON.stringify([{sessionId: '${id}', id: '${id.slice(0, 8)}', cwd: process.cwd(), state:'working'}]));
} else if (process.argv.includes('exec')) {
  const d = path.join(process.env.CODEX_HOME, 'sessions/2026/09/07');
  fs.mkdirSync(d, {recursive:true});
  fs.writeFileSync(path.join(d, 'rollout-${id}.jsonl'), '{}\\n');
  console.log(JSON.stringify({type:'thread.started',thread_id:'${id}'}));
} else { console.log('${id}'); }
`;
  try {
    fs.writeFileSync(path.join(dir, 'claude'), script, { mode: 0o755 });
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.CODEX_HOME = path.join(dir, 'codex-home');
    process.env.ORK_HIGIENE_CAPTURE = path.join(dir, 'capture.jsonl');
    for (const nome of NOMES_DO_CONTRATO) process.env[nome] = 'fixture';
    const c = claude({ prompt: 'fixture', nome: 'teste', cwd: dir });
    assert.equal(c.ok, true, c.erro);
    assert.equal(c.verificada, true);
    // O despacho Codex e governado pelo controller: sem vinculo nao ha transporte, entao a
    // higiene do ambiente e medida no app-server proprio que o despacho realmente executa.
    const sim = controllerSimulado(fs.mkdtempSync(path.join(dir, 'codex-')),
      { capturarEnv: { arquivo: process.env.ORK_HIGIENE_CAPTURE!, nomes: NOMES_DO_CONTRATO } });
    try {
      const x = sim.dispatch();
      assert.equal(x.ok, true, x.erro);
      assert.equal(x.verificada, true);
      encerrarController(x.controlador!, sim.vinculo, sim.estado(x).instancia);
    } finally { sim.restaurar(); }
    const chamadas = fs.readFileSync(process.env.ORK_HIGIENE_CAPTURE, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.ok(chamadas.length >= 3);
    for (const chamada of chamadas) {
      assert.deepEqual(chamada.recebidas, []);
      assert.equal(chamada.home, true);
    }
    for (const nome of NOMES_DO_CONTRATO) assert.equal(process.env[nome], 'fixture');
    const manifesto = carregarManifesto(process.cwd())!.manifesto;
    assert.ok(avaliarPolicies(manifesto, { gate: 'phase.dispatch' }).some(v => v.motivo === 'cost.violation' && v.severidade === 'block'));
  } finally {
    for (const nome of Object.keys(process.env)) if (!(nome in anterior)) delete process.env[nome];
    Object.assign(process.env, anterior);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

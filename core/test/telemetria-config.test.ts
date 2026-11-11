import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { ativacaoTelemetria, caminhoConfigTelemetria, CONTRATO_CONFIG_TELEMETRIA, gravarAtivacaoTelemetria,
  lerConfigTelemetria, resolverAtivacaoTelemetria } from '../src/telemetria-config';

const dirs = new Set<string>();
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
function ambiente() {
  const dir = dirTemporario('telemetria-config'); dirs.add(dir);
  return { env: { ORK_USUARIO_DIR: dir } as NodeJS.ProcessEnv, dir };
}
const pseudoA = 'a'.repeat(64), pseudoB = 'b'.repeat(64);

test('ausência é desligada e variáveis OTEL não ativam', () => {
  const { env } = ambiente();
  assert.equal(lerConfigTelemetria({ ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test' }), null);
  assert.deepEqual(ativacaoTelemetria(env), { ligada: false, origem: 'ausente',
    motivo: 'configuração privada ausente', pseudonimo: null });
});

test('ligar e desligar persistem schema privado 0600 e preservam pseudônimo', () => {
  const { env, dir } = ambiente();
  const ligada = gravarAtivacaoTelemetria(true, env, () => pseudoA);
  assert.deepEqual(ligada, { contrato: CONTRATO_CONFIG_TELEMETRIA, enabled: true, pseudonimo: pseudoA, origem: 'builder' });
  const arquivo = caminhoConfigTelemetria(env);
  assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.readdirSync(dir).some((n) => n.endsWith('.tmp')), false);
  const desligada = gravarAtivacaoTelemetria(false, env, () => pseudoB);
  assert.equal(desligada.pseudonimo, pseudoA);
  assert.deepEqual(resolverAtivacaoTelemetria(lerConfigTelemetria(env)), { ligada: false, origem: 'builder',
    motivo: 'desativada pelo builder', pseudonimo: pseudoA });
});

test('contrato inválido, permissão ampla e symlink falham fechados', () => {
  const { env, dir } = ambiente(), arquivo = caminhoConfigTelemetria(env);
  fs.writeFileSync(arquivo, JSON.stringify({ contrato: 'outro', enabled: true }), { mode: 0o600 });
  assert.throws(() => lerConfigTelemetria(env), /fora do contrato/);
  fs.writeFileSync(arquivo, JSON.stringify({ contrato: CONTRATO_CONFIG_TELEMETRIA, enabled: true,
    pseudonimo: pseudoA, origem: 'builder' }), { mode: 0o644 });
  fs.chmodSync(arquivo, 0o644);
  assert.throws(() => lerConfigTelemetria(env), /inseguro/);
  fs.unlinkSync(arquivo);
  const alvo = path.join(dir, 'alvo.json');
  fs.writeFileSync(alvo, JSON.stringify({ contrato: CONTRATO_CONFIG_TELEMETRIA, enabled: true,
    pseudonimo: pseudoA, origem: 'builder' }), { mode: 0o600 });
  fs.symlinkSync(alvo, arquivo);
  assert.throws(() => lerConfigTelemetria(env), /inseguro/);
});

test('fonte empresa futura tem precedência sem ser lida pela F1', () => {
  const builder = { contrato: CONTRATO_CONFIG_TELEMETRIA, enabled: true, pseudonimo: pseudoA, origem: 'builder' as const };
  assert.deepEqual(resolverAtivacaoTelemetria(builder, { enabled: false, motivo: 'política empresarial' }),
    { ligada: false, origem: 'empresa', motivo: 'política empresarial', pseudonimo: pseudoA });
  assert.deepEqual(resolverAtivacaoTelemetria(builder),
    { ligada: true, origem: 'builder', motivo: 'ativada pelo builder', pseudonimo: pseudoA });
});

test('arquivo não carrega endpoint nem cabeçalhos', () => {
  const { env } = ambiente();
  gravarAtivacaoTelemetria(true, { ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:pass@collector.test',
    OTEL_EXPORTER_OTLP_HEADERS: 'authorization=segredo' }, () => pseudoA);
  const corpo = fs.readFileSync(caminhoConfigTelemetria(env), 'utf8');
  assert.equal(corpo.includes('collector'), false);
  assert.equal(corpo.includes('authorization'), false);
  assert.equal(corpo.includes('segredo'), false);
});

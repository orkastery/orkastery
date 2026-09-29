/**
 * I-38 (T1, D5): contrato `memory.embedding` do manifesto.
 *
 * A chave entra pelo NOME da variavel, nunca pelo valor. Os valores com cara de chave usados
 * aqui sao montados em tempo de execucao: nenhum literal de chave fica no fonte (C12).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { carregarManifesto, configDeEmbedding, EMBEDDING_PADRAO } from '../src/manifest';
import { manifestoYaml, detectar } from '../src/init';
import { ENVS_DE_PROVIDER_PAGO } from '../src/runtime-ambiente';

const BASE = `project:
  name: "exemplo"
  abbrev: "exe"
memory:
  mode: orkmind
  tenant: exemplo
  database_url_env: "EXEMPLO_DATABASE_URL"
`;

function carregar(blocoDeEmbedding: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-embedding-config-'));
  try {
    fs.writeFileSync(path.join(dir, 'orkastery.yaml'), BASE + blocoDeEmbedding);
    const carregado = carregarManifesto(dir);
    assert.ok(carregado);
    return carregado;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const COMPLETO = `  embedding:
    provider: "openrouter"
    model: "qwen/qwen3-embedding-8b"
    dim: 1024
    api_key_env: "EXEMPLO_EMBEDDING_API_KEY"
    fallback_model: "intfloat/multilingual-e5-small"
    max_tokens_por_execucao: 250000
`;

test('manifesto aceita o bloco memory.embedding completo', () => {
  const c = carregar(COMPLETO);
  assert.deepEqual(c.erros, []);
  assert.deepEqual(c.manifesto.memory.embedding, {
    provider: 'openrouter', model: 'qwen/qwen3-embedding-8b', dim: 1024,
    api_key_env: 'EXEMPLO_EMBEDDING_API_KEY', fallback_model: 'intfloat/multilingual-e5-small',
    max_tokens_por_execucao: 250000,
  });
  assert.equal(configDeEmbedding(c.manifesto).provider, 'openrouter');
});

test('sem o bloco memory.embedding vale provider none', () => {
  const c = carregar('');
  assert.deepEqual(c.erros, []);
  assert.equal(c.manifesto.memory.embedding, undefined);
  assert.deepEqual(configDeEmbedding(c.manifesto), EMBEDDING_PADRAO);
  assert.equal(configDeEmbedding(c.manifesto).provider, 'none');
});

test('api_key_env recusa DSN e valor de chave no lugar do nome', () => {
  const chaveFalsa = ['sk', 'or', 'v1', 'f'.repeat(48)].join('-');
  for (const valor of ['postgresql://usuario:senha@localhost:5432/base', chaveFalsa, 'minha-chave']) {
    const c = carregar(COMPLETO.replace('"EXEMPLO_EMBEDDING_API_KEY"', JSON.stringify(valor)));
    assert.ok(c.erros.some(e => e.startsWith('memory.embedding.api_key_env')), `${valor.slice(0, 6)}... aceito`);
    assert.ok(!c.erros.join('\n').includes(valor), 'o erro nunca repete o valor recusado com cara de segredo');
  }
});

test('api_key_env recusa nome da lista de provider pago e a variavel da DSN', () => {
  for (const nome of ENVS_DE_PROVIDER_PAGO) {
    const c = carregar(COMPLETO.replace('EXEMPLO_EMBEDDING_API_KEY', nome));
    assert.ok(c.erros.some(e => e.includes('provider pago')), `${nome} aceito`);
  }
  const dsn = carregar(COMPLETO.replace('EXEMPLO_EMBEDDING_API_KEY', 'EXEMPLO_DATABASE_URL'));
  assert.ok(dsn.erros.some(e => e.includes('database_url_env')));
});

test('provider desconhecido, dim fora da faixa e chave literal reprovam o manifesto', () => {
  assert.ok(carregar(COMPLETO.replace('"openrouter"', '"openai"')).erros.some(e => e.startsWith('memory.embedding.provider')));
  for (const dim of ['16', '8192', '10.5', '"muitas"']) {
    assert.ok(carregar(COMPLETO.replace('dim: 1024', `dim: ${dim}`)).erros.some(e => e.startsWith('memory.embedding.dim')), dim);
  }
  assert.ok(carregar(COMPLETO.replace('250000', '0')).erros.some(e => e.startsWith('memory.embedding.max_tokens_por_execucao')));
  assert.ok(carregar(COMPLETO.replace('250000', '10000001')).erros.some(e => e.startsWith('memory.embedding.max_tokens_por_execucao')));
  const literal = carregar(COMPLETO + `    api_key: "${'x'.repeat(40)}"\n`);
  assert.ok(literal.erros.some(e => e.startsWith('memory.embedding.api_key nao existe')));
  assert.ok(carregar(COMPLETO.replace('"intfloat/multilingual-e5-small"', '"modelo-sem-org"')).erros.some(e => e.startsWith('memory.embedding.fallback_model')));
  assert.ok(carregar(COMPLETO.replace('    api_key_env: "EXEMPLO_EMBEDDING_API_KEY"\n', '')).erros.some(e => e.includes('obrigatorio com provider openrouter')));
});

test('erro do bloco nunca repete valor com cara de segredo colado no campo errado', () => {
  const chave = ['sk', 'or', 'v1', 'e'.repeat(40)].join('-');
  for (const campo of [['"openrouter"', JSON.stringify(chave)], ['"qwen/qwen3-embedding-8b"', JSON.stringify(chave)],
    ['"intfloat/multilingual-e5-small"', JSON.stringify(chave)], ['dim: 1024', `dim: "${chave}"`]]) {
    const c = carregar(COMPLETO.replace(campo[0], campo[1]));
    assert.ok(c.erros.length > 0);
    assert.ok(!c.erros.join('\n').includes(chave), campo[0]);
    assert.ok(c.erros.join('\n').includes('valor omitido'));
  }
});

test('provider none aceita o bloco sem chave nem modelo', () => {
  const c = carregar('  embedding:\n    provider: none\n');
  assert.deepEqual(c.erros, []);
  assert.equal(configDeEmbedding(c.manifesto).provider, 'none');
  assert.equal(configDeEmbedding(c.manifesto).api_key_env, '');
});

test('ork init gera o bloco comentado, que nao liga embeddings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-embedding-init-'));
  try {
    const yaml = manifestoYaml(detectar(dir, 'exemplo', 'exe'));
    assert.match(yaml, /# embedding:\n\s+#\s+provider: "none"/);
    assert.doesNotMatch(yaml, /^\s*api_key\s*[:=]/m);
    fs.writeFileSync(path.join(dir, 'orkastery.yaml'), yaml);
    const c = carregarManifesto(dir)!;
    assert.deepEqual(c.erros, []);
    assert.equal(configDeEmbedding(c.manifesto).provider, 'none');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('o manifesto deste projeto declara openrouter e continua subscription-only', () => {
  const c = carregarManifesto(path.resolve(__dirname, '../../..'))!;
  assert.deepEqual(c.erros, []);
  const e = configDeEmbedding(c.manifesto);
  assert.equal(e.provider, 'openrouter');
  assert.equal(e.model, 'qwen/qwen3-embedding-8b');
  assert.equal(e.api_key_env, 'ORKASTERY_EMBEDDING_API_KEY');
  assert.equal(c.manifesto.runtime.provider_policy, 'subscription-only');
});

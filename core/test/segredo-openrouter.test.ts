/**
 * I-38 (T7, C23): higiene de segredo da chave de embedding.
 *
 * A policy `segredo_em_prompt` reconhece chave do OpenRouter, e o doctor declara a chave de
 * embedding pelo NOME. Toda chave aqui e montada em tempo de execucao: nenhum literal no fonte.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { procurarSegredos } from '../src/policies';
import { checarChaveDeEmbedding } from '../src/doctor';
import { carregarManifesto, ManifestoCarregado } from '../src/manifest';
import { ENVS_DE_PROVIDER_PAGO } from '../src/runtime-ambiente';

const chaveOpenRouter = () => ['sk', 'or', 'v1', 'a1B2c3D4'.repeat(8)].join('-');

test('segredo_em_prompt reconhece chave do OpenRouter sem imprimir o trecho', () => {
  const chave = chaveOpenRouter();
  const achados = procurarSegredos(`linha 1\nexporte a chave ${chave} no ambiente`);
  assert.deepEqual(achados, [{ nome: 'chave do OpenRouter', linha: 2 }]);
  assert.ok(!JSON.stringify(achados).includes(chave));
  // O padrao antigo da OpenAI nao cobria o formato com hifen depois de sk-or-v1.
  assert.equal(procurarSegredos(`sk-or-v1-${'x'.repeat(10)}`).length, 0, 'prefixo curto nao e chave');
  assert.equal(procurarSegredos('api_key_env: "ORKASTERY_EMBEDDING_API_KEY"').length, 0, 'o NOME da variavel nao e segredo');
});

function manifesto(bloco: string): { carregado: ManifestoCarregado; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-doctor-emb-'));
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), `project:
  name: "fabrica"
  abbrev: "fab"
memory:
  mode: orkmind
  database_url_env: "FABRICA_DSN"
${bloco}`);
  return { carregado: carregarManifesto(dir)!, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const BLOCO = (nome: string) => `  embedding:
    provider: openrouter
    model: "qwen/qwen3-embedding-8b"
    api_key_env: "${nome}"
`;

test('doctor declara a chave de embedding pelo nome: none ok, presente ok, ausente aviso, paga falha', () => {
  const nenhum = manifesto('');
  const declarado = manifesto(BLOCO('FABRICA_EMBEDDING_KEY'));
  const pago = manifesto(BLOCO(ENVS_DE_PROVIDER_PAGO[0]));
  try {
    assert.equal(checarChaveDeEmbedding(nenhum.carregado, {}).nivel, 'ok');
    const valor = chaveOpenRouter();
    const presente = checarChaveDeEmbedding(declarado.carregado, { FABRICA_EMBEDDING_KEY: valor });
    assert.equal(presente.nivel, 'ok');
    assert.match(presente.detalhe, /FABRICA_EMBEDDING_KEY presente no ambiente \(valor nunca impresso\)/);
    assert.ok(!JSON.stringify(presente).includes(valor));
    const ausente = checarChaveDeEmbedding(declarado.carregado, {});
    assert.equal(ausente.nivel, 'warn');
    assert.match(ausente.correcao ?? '', /exporte FABRICA_EMBEDDING_KEY/);
    assert.match(ausente.detalhe, /o regime nao muda/);
    assert.ok(pago.carregado.erros.some(e => e.includes('provider pago')), 'o manifesto ja reprova o nome pago');
    const falha = checarChaveDeEmbedding(pago.carregado, { [ENVS_DE_PROVIDER_PAGO[0]]: valor });
    assert.equal(falha.nivel, 'fail');
    assert.ok(!JSON.stringify(falha).includes(valor));
  } finally { nenhum.limpar(); declarado.limpar(); pago.limpar(); }
});

test('doctor acusa falha quando o valor da variavel da chave parece URL, DSN ou texto com espaco, sem imprimir', () => {
  const declarado = manifesto(BLOCO('FABRICA_EMBEDDING_KEY'));
  try {
    const dsn = 'postgresql://leitor:' + 'senha-longa-de-teste' + '@db.local:5432/base';
    for (const valor of ['https://exemplo.local/' + 'x'.repeat(20), dsn, 'duas partes separadas', 'senha-longa-de-teste']) {
      const c = checarChaveDeEmbedding(declarado.carregado, { FABRICA_EMBEDDING_KEY: valor, FABRICA_DSN: dsn });
      assert.equal(c.nivel, 'fail', valor.slice(0, 5));
      assert.match(c.detalhe, /valor recusado/);
      assert.ok(!JSON.stringify(c).includes(valor));
    }
  } finally { declarado.limpar(); }
});

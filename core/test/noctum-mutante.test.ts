/**
 * RM-058 (N5, D6 da ork-rm058n5): o executor de mutante. Ele copia o `dist` e o `dist-test` deste checkout, troca um trecho
 * exato do módulo compilado e roda o teste pelo nome: sai 0 quando o mutante morre, 1 quando sobrevive e 2 quando a
 * especificação não se aplica. As especificações daqui são SIMULADAS sobre o módulo do CHANGELOG da própria N5.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const SCRIPT = path.resolve(__dirname, '../../scripts/mutante.cjs');

function rodar(mutantes: Array<Record<string, string>>, id: string, contrato = 'ork.mutantes/v1', env: NodeJS.ProcessEnv = process.env) {
  const dir = dirTemporario('noctum-qm');
  try {
    const arquivo = path.join(dir, 'mutantes.json');
    fs.writeFileSync(arquivo, JSON.stringify({ contrato, mutantes }));
    return spawnSync(process.execPath, [SCRIPT, arquivo, id], { encoding: 'utf8', timeout: 300000, env });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** O ambiente SIMULADO que faz o teste de apoio cair sem mutante nenhum (o controle do QM4). */
const QUEDA_SIMULADA = 'ORK_MUTANTE_QUEDA_SIMULADA';

const ORDEM = { id: 'M1', descricao: 'a união põe a thread antes da base', modulo: 'noctum-changelog',
  de: 'return [...segundo, ...primeiro];', para: 'return [...primeiro, ...segundo];', teste: 'noctum-changelog', nome: '^QC2:' };

test('QM1: o mutante que o teste pega morre (saída 0), e o código do checkout não muda', () => {
  const antes = fs.readFileSync(path.resolve(__dirname, '../../dist/noctum-changelog.js'), 'utf8');
  const r = rodar([ORDEM], 'M1');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /mutante M1: morto/);
  assert.equal(fs.readFileSync(path.resolve(__dirname, '../../dist/noctum-changelog.js'), 'utf8'), antes, 'a troca foi só na cópia');
});

test('QM2: o mutante que nenhum teste pega sobrevive (saída 1)', () => {
  const r = rodar([{ ...ORDEM, id: 'M2', de: 'nada pede linha: a mudança', para: 'nada pede linha, a mudança' }], 'M2');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /mutante M2: SOBREVIVEU/);
});

test('QM3: especificação que não se aplica sai 2: trecho ausente ou repetido, id ausente, contrato errado e teste que não casa', () => {
  const casos: Array<[Array<Record<string, string>>, string, string?]> = [
    [[{ ...ORDEM, de: 'trecho que não existe no módulo' }], 'M1'],
    [[{ ...ORDEM, de: 'linhas' }], 'M1'],
    [[ORDEM], 'M9'],
    [[ORDEM], 'M1', 'ork.mutantes/v0'],
    [[{ ...ORDEM, nome: '^QC99:' }], 'M1'],
    [[{ ...ORDEM, modulo: '../fora' }], 'M1'],
  ];
  for (const [mutantes, id, contrato] of casos) {
    const r = rodar(mutantes, id, contrato);
    assert.equal(r.status, 2, `${JSON.stringify(mutantes[0])}: ${r.stdout}\n${r.stderr}`);
  }
});

test('QM-apoio: passa, a não ser que o ambiente SIMULADO peça a queda (o controle que o QM4 usa)', () => {
  assert.notEqual(process.env[QUEDA_SIMULADA], '1');
});

test('QM4: o teste que já cai sem a troca não mata o mutante: o controle cai, e a saída é 2', () => {
  const r = rodar([{ ...ORDEM, id: 'M4', teste: 'noctum-mutante', nome: '^QM-apoio:' }], 'M4', 'ork.mutantes/v1', { ...process.env, [QUEDA_SIMULADA]: '1' });
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /o controle sem a troca já cai/);
  // Sem a queda, o mesmo mutante (que o teste de apoio não pega) sobrevive.
  assert.equal(rodar([{ ...ORDEM, id: 'M4', teste: 'noctum-mutante', nome: '^QM-apoio:' }], 'M4').status, 1);
});

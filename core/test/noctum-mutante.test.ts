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
const { main: rodarMain, recusaDoAlvoArquivo } = require(SCRIPT) as {
  main: (args: string[]) => number;
  recusaDoAlvoArquivo: (raiz: string, relativo: string) => string | null;
};

function rodar(mutantes: Array<Record<string, string>>, id: string, contrato = 'ork.mutantes/v1', env: NodeJS.ProcessEnv = process.env) {
  const dir = dirTemporario('noctum-qm');
  try {
    const arquivo = path.join(dir, 'mutantes.json');
    fs.writeFileSync(arquivo, JSON.stringify({ contrato, mutantes }));
    return spawnSync(process.execPath, [SCRIPT, arquivo, id], { encoding: 'utf8', timeout: 300000, env });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function rodarDireto(mutantes: Array<Record<string, string>>, id: string, contrato = 'ork.mutantes/v1') {
  const dir = dirTemporario('noctum-qm-direto');
  const erros: string[] = [];
  const erroOriginal = console.error;
  try {
    const arquivo = path.join(dir, 'mutantes.json');
    fs.writeFileSync(arquivo, JSON.stringify({ contrato, mutantes }));
    console.error = (...partes: unknown[]) => { erros.push(partes.map(String).join(' ')); };
    return { status: rodarMain([arquivo, id]), stderr: erros.join('\n') };
  } finally {
    console.error = erroOriginal;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

/**
 * RM-037 (achado 2 do CHECK da ork-rm037defeit2): o mutante por `arquivo`, no roteiro de `core/scripts` (o do contrato da
 * forja, que passa a aceitar a forja desconhecida) e no apoio compilado de `core/dist-test/test` (o QM-apoio que cai sem o
 * ambiente simulado). O trecho do QM-apoio é montado por partes para não aparecer de novo no próprio arquivo compilado.
 */
const ROTEIRO_SEM_PLANO = { id: 'M5', descricao: 'a forja desconhecida passa da conferência do plano', arquivo: 'core/scripts/forja-contrato.cjs',
  de: 'if (!plano || !o.host', para: 'if (!o.host', teste: 'forja-contrato-script', nome: '^recusa forja desconhecida' };
const APOIO_QUE_CAI = { id: 'M6', descricao: 'o teste de apoio cai sem o ambiente simulado', arquivo: 'core/dist-test/test/noctum-mutante.test.js',
  de: 'node_assert_1.strict.notEqual(process.env[QUEDA_' + "SIMULADA], '1');", para: "node_assert_1.strict.equal(process.env[QUEDA_SIMULADA], '1');",
  teste: 'noctum-mutante', nome: '^QM-apoio:' };

test('QM5: com arquivo no lugar de modulo, a troca vai no roteiro de core/scripts ou no apoio de core/dist-test/test, só na cópia', () => {
  for (const m of [ROTEIRO_SEM_PLANO, APOIO_QUE_CAI]) {
    const alvo = path.resolve(__dirname, '../../..', m.arquivo);
    const antes = fs.readFileSync(alvo, 'utf8');
    const r = rodar([m], m.id);
    assert.equal(r.status, 0, `${m.arquivo}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, new RegExp(`mutante ${m.id}: morto`));
    assert.equal(fs.readFileSync(alvo, 'utf8'), antes, `${m.arquivo}: a troca foi só na cópia`);
  }
});

test('QM6: arquivo fora de core/scripts e core/dist-test/test, ausente ou junto com modulo sai 2', () => {
  for (const arquivo of ['core/src/verify.ts', 'core/scripts/../src/verify.ts', '/etc/passwd', 'core/dist-test/src/verify.js',
    'core/scripts/nao-existe.cjs']) {
    const r = rodar([{ ...ROTEIRO_SEM_PLANO, arquivo }], 'M5');
    assert.equal(r.status, 2, `${arquivo}: ${r.stdout}\n${r.stderr}`);
  }
  assert.equal(rodar([{ ...ROTEIRO_SEM_PLANO, modulo: 'noctum-changelog' }], 'M5').status, 2, 'modulo e arquivo juntos');
});

test('QM7: arquivo que e link simbolico e recusado sem escrever fora da copia', () => {
  const fora = dirTemporario('noctum-qm-symlink');
  const relativo = `core/scripts/qm7-link-${process.pid}-${Date.now()}.cjs`;
  const alvo = path.resolve(__dirname, '../../..', relativo);
  const sentinela = path.join(fora, 'sentinela.cjs');
  const original = 'module.exports = "original-symlink";\n';
  try {
    fs.writeFileSync(sentinela, original);
    fs.symlinkSync(sentinela, alvo);
    const m = { id: 'QM7', descricao: 'o link simbolico nao pode escapar da copia', arquivo: relativo,
      de: 'original-symlink', para: 'mutado-symlink', teste: 'noctum-mutante', nome: '^QM-apoio:' };
    const r = rodarDireto([m], m.id);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /link simbólico/);
    assert.equal(fs.readFileSync(sentinela, 'utf8'), original, 'a recusa não escreve no alvo externo');
  } finally {
    fs.rmSync(alvo, { force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('QM8: componente simbolico e recusado e arquivo regular fica contido na raiz permitida', () => {
  const raiz = dirTemporario('noctum-qm-component');
  const fora = dirTemporario('noctum-qm-component-outside');
  try {
    fs.mkdirSync(path.join(raiz, 'core'), { recursive: true });
    fs.writeFileSync(path.join(fora, 'alvo.cjs'), 'module.exports = true;\n');
    fs.symlinkSync(fora, path.join(raiz, 'core', 'scripts'));
    assert.match(recusaDoAlvoArquivo(raiz, 'core/scripts/alvo.cjs') || '', /componente core\/scripts é link simbólico/);

    const pastaRegular = path.join(raiz, 'core', 'dist-test', 'test');
    fs.mkdirSync(pastaRegular, { recursive: true });
    fs.writeFileSync(path.join(pastaRegular, 'alvo.js'), 'module.exports = true;\n');
    assert.equal(recusaDoAlvoArquivo(raiz, 'core/dist-test/test/alvo.js'), null);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

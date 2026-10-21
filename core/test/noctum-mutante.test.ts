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
const { recusaDoAlvoArquivo } = require(SCRIPT) as {
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

/**
 * Um repositório falso numa raiz temporária, com uma cópia deste executor (a raiz dele é a pasta de onde ele roda) e um teste
 * que lê o alvo pelo `require`: sem a contenção, a troca na cópia atravessa o link, o teste da cópia cai e o mutante sai
 * "morto" (0) com a sentinela de fora mudada. Nada é criado no checkout (aviso 7 do CHECK 3 da ork-rm037defeit2).
 */
function repositorioFalso(nome: string, alvo: string, valor: string) {
  const raiz = dirTemporario(`noctum-qm-falso-${nome}`);
  const fora = dirTemporario(`noctum-qm-fora-${nome}`);
  fs.mkdirSync(path.join(raiz, 'core', 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(raiz, 'core', 'scripts', 'mutante.cjs'));
  fs.mkdirSync(path.join(raiz, 'core', 'dist-test', 'test'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'core', 'dist-test', 'test', 'alvo-falso.test.js'), "'use strict';\n" +
    "const { test } = require('node:test');\nconst assert = require('node:assert');\nconst path = require('node:path');\n" +
    `test('QF-alvo: o alvo segue original', () => { assert.equal(require(path.join(__dirname, '../../..', ${JSON.stringify(alvo)})), ` +
    `${JSON.stringify(valor)}); });\n`);
  const sentinela = path.join(fora, 'sentinela.cjs');
  fs.writeFileSync(sentinela, `module.exports = ${JSON.stringify(valor)};\n`);
  const rodarFalso = (m: Record<string, string>) => {
    const spec = path.join(raiz, 'mutantes.json');
    fs.writeFileSync(spec, JSON.stringify({ contrato: 'ork.mutantes/v1', mutantes: [m] }));
    return spawnSync(process.execPath, [path.join(raiz, 'core', 'scripts', 'mutante.cjs'), spec, m.id],
      { encoding: 'utf8', timeout: 300000 });
  };
  return { raiz, fora, sentinela, rodarFalso, limpar: () => { fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(fora, { recursive: true, force: true }); } };
}

test('QM7: arquivo que e link simbolico e recusado sem escrever fora da copia', () => {
  const f = repositorioFalso('qm7', 'core/scripts/qm7-link.cjs', 'original-symlink');
  try {
    fs.symlinkSync(f.sentinela, path.join(f.raiz, 'core', 'scripts', 'qm7-link.cjs'));
    const r = f.rodarFalso({ id: 'QM7', descricao: 'o link simbolico nao pode escapar da copia', arquivo: 'core/scripts/qm7-link.cjs',
      de: 'original-symlink', para: 'mutado-symlink', teste: 'alvo-falso', nome: '^QF-alvo:' });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /componente core\/scripts\/qm7-link\.cjs é link simbólico; nenhuma escrita foi feita/);
    assert.equal(fs.readFileSync(f.sentinela, 'utf8'), 'module.exports = "original-symlink";\n', 'a recusa não escreve no alvo externo');
  } finally { f.limpar(); }
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
    // CHECK 3 da ork-rm037defeit2: as pastas do `modulo` compilado passam pela mesma conferência.
    fs.symlinkSync(fora, path.join(raiz, 'core', 'dist'));
    fs.writeFileSync(path.join(fora, 'alvo.js'), 'module.exports = true;\n');
    assert.match(recusaDoAlvoArquivo(raiz, 'core/dist/alvo.js') || '', /componente core\/dist é link simbólico/);
    fs.mkdirSync(path.join(raiz, 'core', 'dist-test', 'src'));
    fs.writeFileSync(path.join(raiz, 'core', 'dist-test', 'src', 'alvo.js'), 'module.exports = true;\n');
    assert.equal(recusaDoAlvoArquivo(raiz, 'core/dist-test/src/alvo.js'), null);
    assert.match(recusaDoAlvoArquivo(raiz, 'core/src/alvo.js') || '', /fora das pastas permitidas/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

/**
 * CHECK 3 da ork-rm037defeit2, aviso 3: no modo `modulo`, com `core/dist` (ou o próprio módulo compilado) apontando para fora,
 * a troca escrevia fora da cópia: no repositório falso da prova K7, a sentinela externa virou o mutante e a saída foi 0.
 */
test('QM9: modulo com core/dist ou o modulo compilado simbolico e recusado sem escrever fora da copia', () => {
  for (const caso of ['pasta', 'arquivo'] as const) {
    const f = repositorioFalso(`qm9-${caso}`, 'core/dist/alvo.js', 'original-modulo');
    try {
      if (caso === 'pasta') {
        fs.renameSync(f.sentinela, path.join(f.fora, 'alvo.js'));
        fs.symlinkSync(f.fora, path.join(f.raiz, 'core', 'dist'));
      } else {
        fs.mkdirSync(path.join(f.raiz, 'core', 'dist'));
        fs.symlinkSync(f.sentinela, path.join(f.raiz, 'core', 'dist', 'alvo.js'));
      }
      const externo = caso === 'pasta' ? path.join(f.fora, 'alvo.js') : f.sentinela;
      const r = f.rodarFalso({ id: 'QM9', descricao: 'o modulo compilado nao pode escapar da copia', modulo: 'alvo',
        de: 'original-modulo', para: 'mutado-modulo', teste: 'alvo-falso', nome: '^QF-alvo:' });
      assert.equal(r.status, 2, `${caso}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, caso === 'pasta' ? /componente core\/dist é link simbólico/ : /componente core\/dist\/alvo\.js é link simbólico/,
        caso);
      assert.equal(fs.readFileSync(externo, 'utf8'), 'module.exports = "original-modulo";\n', `${caso}: nada escrito fora da cópia`);
    } finally { f.limpar(); }
  }
});

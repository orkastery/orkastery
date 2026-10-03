/** S8: contrato publico da transicao do legado, sem depender dos artefatos privados da thread. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const raiz = path.resolve(__dirname, '../../..');
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
const paginas = ['docs/produto/FEAT-007-worktree-e-leases.md', 'docs/produto/FEAT-029-conducao-multicanal.md',
  'docs/roadmap/RM-036-maestro-multicanal.md'];

for (const pagina of paginas) {
  test(`rm036 docs: ${pagina} explica janela e fila sem prometer migracao`, () => {
    const texto = ler(pagina);
    assert.match(texto, /janela de 30 minutos/);
    assert.match(texto, /\.orkastery\/leases\/\.legado/);
    assert.match(texto, /[Ff]ila legada não é lida/);
    assert.match(texto, /prova posse canônica/);
    assert.doesNotMatch(texto, /lido até vencer|espera legada entra na fila canônica/);
  });
}

test('rm036 docs: roadmap aponta evidencia publica sem alegacao de mutacao sem origem', () => {
  const texto = ler(paginas[2]);
  assert.doesNotMatch(texto, /está no PLAN da thread|testes caem com o código anterior/);
  for (const arquivo of ['leases.ts', 'portfolio.ts', 'rm036-leases-canonicos.test.ts', 'rm036-leases-gofix.test.ts']) {
    const link = [...texto.matchAll(/\]\(([^)]+)\)/g)].find((m) => m[1].endsWith('/' + arquivo));
    assert.ok(link, `fonte publica para ${arquivo}`);
    assert.equal(fs.existsSync(path.resolve(raiz, path.dirname(paginas[2]), link[1])), true);
  }
});

test('rm036 docs: CLI situa todas as familias e a fila no dominio canonico', () => {
  const texto = ler('docs/referencia/cli.md').split('## Isolamento: worktree e leases')[1].split('\n---')[0];
  assert.match(texto, /Todas as famílias e a fila por colisão moram no\s+estado canônico/);
  assert.match(texto, /janela de 30 minutos/);
  assert.match(texto, /fila legada não é lida/);
  assert.match(texto, /cinco segundos/);
  assert.match(texto, /ork lease release <nome> --forcar/);
});

test('rm036 docs: changelog nao publicado registra endurecimento e fila sem migracao', () => {
  const texto = ler('CHANGELOG.md').split('## Não publicado')[1].split(/\n## /)[0];
  assert.match(texto, /janela de 30 minutos/);
  assert.match(texto, /fila legada não é lida/);
  assert.match(texto, /vínculo de volta/);
  assert.match(texto, /posse canônica/);
  assert.match(texto, /cinco segundos/);
  assert.doesNotMatch(texto, /espera legada entra na fila canônica/);
});

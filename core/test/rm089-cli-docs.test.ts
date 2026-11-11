import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

const raiz = path.resolve(__dirname, '../../..');
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
const pt = ler('docs/referencia/cli.md'), en = ler('docs/referencia/cli.en.md');

test('referência e ajuda declaram toda a família coletiva nos dois idiomas', () => {
  const ajuda = ler('core/src/locale-ajuda.ts');
  for (const acao of ['criar', 'inscrever', 'publicar', 'status', 'sair', 'revogar']) {
    assert.match(pt, new RegExp(`network empresa ${acao}`));
    assert.match(en, new RegExp(`network empresa ${acao}`));
    assert.match(ajuda, new RegExp(acao));
  }
  for (const texto of [pt, en]) {
    assert.match(texto, /accountId/);
    assert.match(texto, /dado_privado/);
    assert.match(texto, /sem `force`|never using `force`/);
  }
});

test('Não publicado registra a entrega coletiva sem alterar o roadmap', () => {
  const naoPublicado = ler('CHANGELOG.md').split('## [0.6.8]')[0];
  assert.match(naoPublicado, /Inscrição na rede coletiva.*RM-089/);
  assert.match(naoPublicado, /accountId/);
  assert.match(ler('core/src/index.ts'), /executarCliRedeEmpresa/);
});

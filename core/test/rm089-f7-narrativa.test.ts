import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (arquivo: string) => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const GUIAS = ['docs/guias/politica-de-recibo-da-empresa.pt-BR.md',
  'docs/guias/politica-de-recibo-da-empresa.md', 'docs/referencia/contratos/forja.md'];

test('a narrativa pública descreve os contratos v2 e os limites das forjas', () => {
  for (const arquivo of GUIAS) {
    const texto = ler(arquivo);
    assert.match(texto, /ci\.fabrica/);
    assert.match(texto, /ork\.ci-recibo-forte-(?:payload|assinatura)\/v2/);
    assert.match(texto, /ork-fabrica\/utf8-/);
    assert.match(texto, /ci\.fabrica\.maintainer-adicional/);
    assert.match(texto, /ship\.fabrica\.sha-divergente/);
    assert.match(texto, /\bsha\b|\bSHA\b/);
    assert.doesNotMatch(texto, /excecao-transporte|transporte_excecao|recibo-forte-assinatura\/v1/);
  }
});

test('o changelog mantém a F7 em Não publicado e declara as retiradas', () => {
  const changelog = ler('CHANGELOG.md');
  const naoPublicado = changelog.slice(changelog.indexOf('## Não publicado'), changelog.indexOf('\n## [', 1));
  assert.match(naoPublicado, /Decisão da fábrica, F7 \(RM-089\)/);
  assert.match(naoPublicado, /motor e as portas/);
  assert.match(naoPublicado, /sem transporte ao runner e sem empacotamento da árvore de produção/);
  assert.doesNotMatch(naoPublicado, /—/);
});

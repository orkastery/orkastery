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
    assert.match(texto, /Administration/);
    assert.match(texto, /não aplica|does not apply/);
    assert.match(texto, /nenhum caminho entrega|no path delivers/);
    assert.match(texto, /continua pedindo o recibo F5|continues to require the F5 receipt/);
    assert.match(texto, /\bsha\b|\bSHA\b/);
    assert.doesNotMatch(texto, /excecao-transporte|transporte_excecao|recibo-forte-assinatura\/v1|ci\.fabrica\.(?:resultado|assinatura|chave)-invalida/);
  }
});

test('o changelog declara os contratos e as retiradas da F7', () => {
  const changelog = ler('CHANGELOG.md');
  assert.match(changelog, /Decisão da fábrica, F7 \(RM-089\)/);
  assert.match(changelog, /motor e as portas/);
  assert.match(changelog, /mesmo HEAD feito pela conta configurada sem criar outro merge local/);
  assert.match(changelog, /sem transporte ao runner e sem empacotamento da árvore de produção/);
});

test('o roadmap preserva a ordem e a ausência do transporte retirado', () => {
  const item = ler('docs/roadmap/RM-089-orkastery-network-coletiva-da-empresa.md');
  const indice = ler('docs/roadmap/README.md');
  assert.match(item, /issues #302, #299, #303 e #304, nessa ordem/);
  assert.match(indice, /issues #302, #299, #303 e #304, nessa sequência/);
  assert.doesNotMatch(item, /transporta a prova da exceção autorizada/);
});

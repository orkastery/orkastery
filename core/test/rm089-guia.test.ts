import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

const raiz = path.resolve(__dirname, '../../..');
const pt = fs.readFileSync(path.join(raiz, 'docs/guias/rede-da-empresa.pt-BR.md'), 'utf8');
const en = fs.readFileSync(path.join(raiz, 'docs/guias/rede-da-empresa.md'), 'utf8');

test('guia bilíngue mantém fluxo, fontes oficiais e condição não confirmada', () => {
  for (const texto of [pt, en]) {
    for (const comando of ['criar', 'inscrever', 'aceitar', 'publicar', 'status', 'sair', 'revogar'])
      assert.match(texto, new RegExp(`network empresa ${comando}`));
    assert.match(texto, /docs\.github\.com\/en\/rest\/users\/users/);
    assert.match(texto, /docs\.gitlab\.com\/api\/projects/);
    assert.match(texto, /accountId/);
    assert.match(texto, /empresa.*inscrever|company.*inscrever/is);
    assert.match(texto, /maestro.*aceitar/is);
    assert.match(texto, /outra\s+forja|different\s+forge/i);
    assert.match(texto, /not confirmed|não (?:é |estão )?confirmad[ao]s?/i);
  }
});

test('guia bilíngue declara a projeção fechada campo a campo', () => {
  const campos = ['Envelope', 'Maestro', 'accountId'];
  for (const texto of [pt, en]) {
    for (const campo of campos) assert.match(texto, new RegExp(campo));
    assert.match(texto, /dado_privado/);
    assert.match(texto, /thread/i);
    assert.match(texto, /máquina|machine/);
    assert.match(texto, /caminho local|local paths?/i);
  }
});

test('guia bilíngue explica coordenação, cobertura e reparo sem prometer tomada coletiva', () => {
  for (const texto of [pt, en]) {
    for (const termo of ['projectKey', 'operationId', 'observar', 'avisar', 'exigir', 'fingerprint'])
      assert.match(texto, new RegExp(termo));
    assert.match(texto, /colaborador|collaborator/i);
    assert.match(texto, /acordo autenticado|authenticated agreement/i);
    assert.match(texto, /roadmap reconciliar RM-NNN --operacao op-/);
    assert.match(texto, /ordem inversa|reverse order/i);
    assert.match(texto, /reserva local|local reservation/i);
    for (const opcao of ['--coordenacao', '--atestacao-forja', '--excecao-responsavel', '--excecao-sha256'])
      assert.match(texto, new RegExp(opcao));
    assert.match(texto, /coordenacao\.excecao/);
  }
});

test('referência bilíngue publica a saga e as novas opções de política', () => {
  for (const arquivo of ['docs/referencia/cli.md', 'docs/referencia/cli.en.md']) {
    const texto = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    assert.match(texto, /roadmap reconciliar RM-NNN --operacao op-/);
    assert.match(texto, /--nivel observar\\\|avisar\\\|exigir/);
    assert.match(texto, /--recibo-versao V/);
    assert.match(texto, /ork_thread_new/);
    for (const opcao of ['--coordenacao', '--atestacao-forja', '--excecao-responsavel', '--excecao-sha256'])
      assert.match(texto, new RegExp(opcao));
    assert.match(texto, /coordenacao: \{ acao/);
  }
});

/** RM-089 F6: a narrativa pública acompanha os contratos executáveis desta entrega. */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('referência bilíngue publica a sintaxe e as quatro fronteiras duráveis da adoção', () => {
  for (const file of ['docs/referencia/cli.md', 'docs/referencia/cli.en.md']) {
    const text = read(file);
    assert.match(text, /ork adotar <branch> --roadmap RM-NNN .*--perfil-check/);
    for (const state of ['preparada', 'verificada', 'revisada', 'concluida']) assert.match(text, new RegExp(`\\b${state}\\b`));
    assert.match(text, /ork\.ci-recibo-runner\/v1/);
    assert.match(text, /sourceHead/);
    assert.match(text, /não confirmado|not confirmed/);
    assert.match(text, /não faz push, merge ou SHIP|does not push, merge, or SHIP/);
  }
});

test('guias distinguem orientação por host, exceção F2 e exceção de recibo F5', () => {
  for (const file of ['docs/guias/politica-de-recibo-da-empresa.pt-BR.md',
    'docs/guias/politica-de-recibo-da-empresa.md']) {
    const text = read(file);
    for (const host of ['Claude Code', 'Codex', 'Hermes', 'OpenClaw']) assert.match(text, new RegExp(host));
    assert.match(text, /SessionStart/);
    assert.match(text, /agent:bootstrap/);
    assert.match(text, /F5/);
    assert.match(text, /F2/);
    for (const schema of ['ork.excecao-notificacao-pedido/v1', 'ork.excecao-notificacao-recibo/v1',
      'ork.excecao-notificacao-ledger/v1', 'ork.ci-run/v1']) assert.match(text, new RegExp(schema.replaceAll('.', '\\.')));
    assert.match(text, /ledgerEventId/);
    assert.match(text, /recordedAt/);
    assert.match(text, /não prova leitura humana|does not prove that a person read it/);
    assert.match(text, /nenhuma entrega F7 é prometida|no F7 delivery is promised/i);
    assert.doesNotMatch(text, /próximo passo da RM-089|next RM-089 step/);
  }
});

test('contrato da forja fixa par, capacidade, runner puro e limite da assinatura', () => {
  const text = read('docs/referencia/contratos/forja.md');
  for (const schema of ['ork.excecao-recibo-autorizacao/v1', 'ork.excecao-recibo-policy/v1',
    'ork.excecao-recibo/v1', 'ork.excecao-notificacao-pedido/v1', 'ork.excecao-notificacao-recibo/v1',
    'ork.excecao-notificacao-ledger/v1', 'ork.excecao-notificacao-prova/v1',
    'ork.excecao-runner-capability/v1', 'ork.ci-exception/v1']) {
    assert.match(text, new RegExp(schema.replaceAll('.', '\\.')));
  }
  assert.match(text, /pedido → recibo → validação → append durável → exposição/);
  assert.match(text, /não notifica, não escreve ledger ou forja/);
  assert.match(text, /não prova.*leitura humana/);
  assert.match(text, /Nenhuma entrega F7 é prometida/);
});

test('caminhos documentados dos adapters existem e conservam suas superfícies nativas', () => {
  const files = ['adapters/claude-code/hooks/hooks.json', 'adapters/claude-code/hooks/ork-sessao.js',
    'adapters/codex/hooks/hooks.json', 'adapters/codex/hooks/ork-sessao.js',
    'adapters/hermes/hitl-ingress/plugin.yaml', 'adapters/hermes/hitl-ingress/__init__.py',
    'adapters/openclaw/openclaw.plugin.json', 'adapters/openclaw/src/index.ts'];
  for (const file of files) assert.equal(fs.statSync(path.join(root, file)).isFile(), true, file);
  assert.match(read('adapters/claude-code/hooks/hooks.json'), /SessionStart/);
  assert.match(read('adapters/codex/hooks/hooks.json'), /SessionStart/);
  assert.match(read('adapters/hermes/hitl-ingress/__init__.py'), /on_session_start/);
  assert.match(read('adapters/hermes/hitl-ingress/__init__.py'), /pre_llm_call/);
  assert.match(read('adapters/openclaw/src/index.ts'), /command:new/);
  assert.match(read('adapters/openclaw/src/index.ts'), /agent:bootstrap/);
});

test('Não publicado anuncia adoção, orientação e exceção sem prometer ganho', () => {
  const unpublished = read('CHANGELOG.md').split(/^## \[0\.6\.9\]/m)[0];
  assert.match(unpublished, /Adoção de trabalho existente/);
  assert.match(unpublished, /Orientação única de sessão/);
  assert.match(unpublished, /Exceção auditável do recibo/);
  assert.doesNotMatch(unpublished, /\b(?:[0-9]+(?:[.,][0-9]+)?x|[0-9]+%)\b/);
});

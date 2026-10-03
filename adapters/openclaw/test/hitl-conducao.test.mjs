// RM-057 (fatia 2): a regra do HITL de conducao chega ao modelo do OpenClaw.
//
// No OpenClaw o modelo so le as descricoes das tools. A regra (selecao de 3 a 5 com uma
// "Recomendação", nunca "confirmo" em texto livre nem texto colado, pedido colado com autorizacao
// explicita vale como instrucao do dono, duvida vira `ork decisao registrar`) vai nas tools que
// recebem o pedido do dono, apresentam o panorama e despacham fase, com a frase dos adaptadores do
// Claude Code e do Codex (fatia 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

async function comTools(corpo) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ork-openclaw-rm057-'));
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(new URL('../dist/' + f, import.meta.url), path.join(dir, f));
    const plugin = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    await corpo(plugin.tools(d => d));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** A frase da fatia 1, tirada do adaptador do Claude Code: as duas pontas dizem a mesma regra. */
function regraDaFatia1() {
  const md = fs.readFileSync(new URL('../../claude-code/commands/ork.md', import.meta.url), 'utf8');
  const i = md.indexOf('HITL de condução é seleção (RM-057)');
  assert.ok(i >= 0, 'a regra da fatia 1 esta no adaptador do Claude Code');
  return md.slice(i, md.indexOf('comando exato.', i) + 'comando exato.'.length).replace(/\s+/g, ' ');
}

test('as tools que recebem o pedido, mostram o panorama e despacham fase dizem a regra do HITL de condução', async () => {
  const regra = regraDaFatia1();
  await comTools(async (tools) => {
    const d = Object.fromEntries(tools.map(t => [t.name, t.description]));
    for (const nome of ['ork_modo_do_pedido', 'ork_maestro', 'ork_phase_run']) {
      assert.ok(d[nome].replace(/\s+/g, ' ').endsWith(regra), `${nome} termina com a regra da fatia 1`);
      assert.match(d[nome], /o pedido que ele colou com autorização explícita vale como instrução dele/);
      assert.match(d[nome], /ork decisao registrar/);
    }
  });
});

test('o dist commitado é o build do src: a regra está nos dois', () => {
  const src = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const dist = fs.readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  for (const texto of [src, dist]) {
    assert.match(texto, /const REGRA_HITL_DE_CONDUCAO =/);
    assert.equal((texto.match(/\+ REGRA_HITL_DE_CONDUCAO|^\s*REGRA_HITL_DE_CONDUCAO,/gm) ?? []).length, 3);
  }
});

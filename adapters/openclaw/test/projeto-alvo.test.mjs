// RM-052 (T5): o projeto de cada chamada no OpenClaw.
//
// Toda tool aceita `projeto` (so NOME, nunca caminho) e o repassa como `--projeto`; o adaptador
// declara ORK_PROJETO_EXPLICITO=1 para o nucleo nunca escolher pelo cwd do gateway; as descricoes
// proibem concluir sobre o roadmap a partir do board ou do maestro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

async function comPlugin(corpo) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ork-openclaw-projeto-'));
  const salvo = { ORK_BIN: process.env.ORK_BIN, ORK_PROJETO_EXPLICITO: process.env.ORK_PROJETO_EXPLICITO };
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(new URL('../dist/' + f, import.meta.url), path.join(dir, f));
    const chamadas = path.join(dir, 'chamadas');
    const bin = path.join(dir, 'ork falso');
    // O ork falso: responde o helper de recibos e, nas tools, grava argv e o modo sem cwd.
    fs.writeFileSync(bin, '#!/bin/sh\nif [ "$1" = receipt-verifiers ]; then printf "null\\n"; exit; fi\n' +
      `printf "%s|" "$@" >> "${chamadas}"; printf "\\n" >> "${chamadas}"\nprintf "explicito=%s\\n" "$ORK_PROJETO_EXPLICITO"\nprintf "%s\\n" "$@"\n`, { mode: 0o755 });
    process.env.ORK_BIN = bin;
    delete process.env.ORK_PROJETO_EXPLICITO;
    const plugin = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    await corpo(plugin.tools(d => d), chamadas);
  } finally {
    for (const [k, v] of Object.entries(salvo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('toda tool aceita projeto opcional, so nome (a rede da RM-054 tambem aceita a forja); o catalogo com 26 tools e os requisitos de antes', async () => {
  await comPlugin(async (tools) => {
    assert.equal(tools.length, 26, 'as 25 da RM-052 e ork_network_roadmap (RM-054, fatia 2)');
    for (const t of tools) {
      const p = t.parameters.properties.projeto;
      assert.ok(p, `${t.name} aceita projeto`);
      if (t.name === 'ork_network_roadmap') assert.match(p.pattern, /\(\?:github\|gitlab\):/, 'a rede aceita a forja');
      else assert.equal(p.pattern, '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$');
      assert.ok(!(t.parameters.required ?? []).includes('projeto'), `${t.name}: projeto e opcional`);
    }
    const manifesto = JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
    assert.deepEqual(tools.map(t => t.name).sort(), [...manifesto.contracts.tools].sort());
  });
});

test('projeto vai como --projeto no inicio do argv; sem ele o nucleo recebe o modo sem cwd e decide', async () => {
  await comPlugin(async (tools) => {
    const roadmap = tools.find(t => t.name === 'ork_roadmap_status');
    assert.equal(await roadmap.execute({ projeto: 'orkastery' }, {}, {}), 'explicito=1\n--projeto\norkastery\nroadmap\nstatus');
    assert.equal(await roadmap.execute({}, {}, {}), 'explicito=1\nroadmap\nstatus', 'sem projeto: sem chute no host');
    const maestro = tools.find(t => t.name === 'ork_maestro');
    assert.equal(await maestro.execute({ projeto: 'orkastery', thread: 'ork-fixture' }, {}, {}),
      'explicito=1\n--projeto\norkastery\nmaestro\n--json\n--thread\nork-fixture', 'a validacao do maestro nao ve o projeto');
    const status = tools.find(t => t.name === 'ork_thread_status');
    assert.equal(await status.execute({ projeto: 'ork', thread: 'ork-x' }, {}, {}), 'explicito=1\n--projeto\nork\nthread\nstatus\nork-x');
    const board = tools.find(t => t.name === 'ork_board');
    assert.equal(await board.execute({ projeto: 'workspace' }, {}, {}), 'explicito=1\n--projeto\nworkspace\nboard\nplan');
  });
});

test('caminho, traversal ou tipo errado em projeto recusa no host, sem chamar o ork', async () => {
  await comPlugin(async (tools, chamadas) => {
    const roadmap = tools.find(t => t.name === 'ork_roadmap_status');
    for (const projeto of ['/home/julio/.openclaw/workspace', '../orkastery', '~/orkastery', '', 42, 'a b']) {
      const r = await roadmap.execute({ projeto }, {}, {});
      assert.match(r, /^\[ork recusou\] projeto\.invalido: informe o NOME de um projeto/, `recusado: ${projeto}`);
    }
    assert.equal(fs.existsSync(chamadas), false, 'o ork nunca foi chamado com projeto invalido');
  });
});

test('descricoes: board e maestro nao leem o roadmap; o roadmap vem da rede (RM-054), com o projeto pedido', async () => {
  await comPlugin(async (tools) => {
    const d = Object.fromEntries(tools.map(t => [t.name, t.description]));
    assert.match(d.ork_board, /NAO le o roadmap: nunca conclua sobre o roadmap a partir do board/);
    assert.match(d.ork_board, /zero threads nao e roadmap vazio/);
    assert.match(d.ork_maestro, /zero threads nunca é roadmap vazio; para o roadmap use ork_network_roadmap/);
    assert.match(d.ork_roadmap_status, /Passe projeto com o nome que o dono pediu/);
    assert.match(d.ork_roadmap_status, /Nunca deduza o roadmap de ork_board ou ork_maestro/);
  });
});

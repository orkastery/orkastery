// RM-054 (fatia 2): o roadmap da rede no OpenClaw.
//
// `ork_network_roadmap` e uma chamada de CLI (`[--projeto P] network roadmap`). O `projeto` dela
// aceita o nome da RM-052 ou a forja (`github:`/`gitlab:`), nunca caminho nem URL; a descricao manda
// transportar o texto como vem e proibe "roadmap vazio" a partir de lacuna; as tools que nao leem o
// roadmap mandam o modelo para ela, e a frase `orkastery maestro` sem projeto tambem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

async function comPlugin(corpo) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ork-openclaw-rede-'));
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

test('ork_network_roadmap e uma chamada de CLI: --projeto no inicio, network roadmap, e o modo sem cwd', async () => {
  await comPlugin(async (tools) => {
    const rede = tools.find(t => t.name === 'ork_network_roadmap');
    assert.ok(rede, 'a tool esta no catalogo');
    assert.equal(await rede.execute({ projeto: 'orkastery' }, {}, {}), 'explicito=1\n--projeto\norkastery\nnetwork\nroadmap');
    assert.equal(await rede.execute({ projeto: 'github:orkastery/orkastery' }, {}, {}),
      'explicito=1\n--projeto\ngithub:orkastery/orkastery\nnetwork\nroadmap');
    assert.equal(await rede.execute({ projeto: 'gitlab:grupo/sub/repo' }, {}, {}), 'explicito=1\n--projeto\ngitlab:grupo/sub/repo\nnetwork\nroadmap');
    assert.equal(await rede.execute({}, {}, {}), 'explicito=1\nnetwork\nroadmap', 'sem projeto: o panorama de todos, sem chute no host');
  });
});

test('ork_network_roadmap: caminho, URL, traversal e tipo errado em projeto recusam no host, sem chamar o ork', async () => {
  await comPlugin(async (tools, chamadas) => {
    const rede = tools.find(t => t.name === 'ork_network_roadmap');
    const p = rede.parameters.properties.projeto;
    assert.ok(!(rede.parameters.required ?? []).includes('projeto'), 'projeto e opcional');
    assert.equal(rede.parameters.additionalProperties, false);
    assert.match(p.description, /github:dono\/repo/);
    assert.match(p.description, /Nunca caminho nem URL/);
    for (const projeto of ['/home/julio/.openclaw/workspace', '../orkastery', '~/orkastery', './orkastery', '',
      'https://github.com/orkastery/orkastery', 'https://u:segredo@github.com/o/r', 'git@github.com:orkastery/orkastery.git',
      'github:../x', 'github:orkastery', 'gitlab:/grupo/repo', 'orkastery/orkastery', 'a b', 42, 'github:o/r;id']) {
      const r = await rede.execute({ projeto }, {}, {});
      assert.match(r, /^\[ork recusou\] projeto\.invalido: informe o NOME de um projeto de `ork projetos` \(ex\.: orkastery\) ou github:dono\/repo, nunca caminho nem URL$/,
        `recusado: ${projeto}`);
      if (typeof projeto === 'string') assert.ok(!new RegExp(p.pattern).test(projeto), `o schema tambem recusa: ${projeto}`);
    }
    assert.equal(fs.existsSync(chamadas), false, 'o ork nunca foi chamado com projeto invalido');
  });
});

test('descricoes: a rede e a fonte do roadmap, texto como vem, e lacuna nunca vira roadmap vazio', async () => {
  await comPlugin(async (tools) => {
    const d = Object.fromEntries(tools.map(t => [t.name, t.description]));
    assert.match(d.ork_network_roadmap, /threads de TODAS as máquinas/);
    assert.match(d.ork_network_roadmap, /a fonte e a hora de cada parte e as lacunas/);
    assert.match(d.ork_network_roadmap, /É a fonte para qualquer pergunta sobre o roadmap ou o status report: transporte o texto como vem, sem reescrever nem resumir/);
    assert.match(d.ork_network_roadmap, /nunca conclua "roadmap vazio" nem "nenhuma máquina publicou" a partir delas/);
    assert.match(d.ork_network_roadmap, /panorama da frase orkastery maestro sem projeto/);
    assert.match(d.ork_maestro, /sem projeto nomeado, chame ork_network_roadmap sem projeto \(o panorama da rede, com fontes, frescor e lacunas\)/);
    assert.match(d.ork_maestro, /zero threads nunca é roadmap vazio; para o roadmap use ork_network_roadmap/);
    assert.match(d.ork_board, /para o roadmap use ork_network_roadmap/);
    assert.match(d.ork_roadmap_status, /SO desta maquina/);
    assert.match(d.ork_roadmap_status, /threads de todas as maquinas, as reservas, as fontes e as lacunas, use ork_network_roadmap/);
    for (const [nome, texto] of Object.entries(d)) {
      if (nome !== 'ork_network_roadmap') assert.doesNotMatch(texto, /unica fonte do roadmap/i, `${nome} nao se diz a fonte do roadmap`);
    }
  });
});

test('catalogo: ork_network_roadmap no manifesto, em paridade com o entry, e as outras tools com o projeto da RM-052', async () => {
  await comPlugin(async (tools) => {
    const manifesto = JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
    assert.ok(manifesto.contracts.tools.includes('ork_network_roadmap'));
    assert.deepEqual(tools.map(t => t.name).sort(), [...manifesto.contracts.tools].sort());
    // RM-054 (fatia 2): com o perfil coding (padrao do OpenClaw), tool de plugin so chega ao modelo
    // declarada no perfil; so a leitura da rede e declarada, e as outras seguem sob o operador.
    assert.deepEqual(manifesto.toolMetadata, { ork_network_roadmap: { profiles: ['coding', 'messaging'] } });
    const pacote = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.match(pacote.description, new RegExp(`: ${tools.length} tools ork_\\*`), 'a contagem do pacote e a do entry');
    for (const t of tools.filter(x => x.name !== 'ork_network_roadmap')) {
      assert.equal(t.parameters.properties.projeto.pattern, '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$', `${t.name}: so nome (RM-052)`);
    }
  });
});

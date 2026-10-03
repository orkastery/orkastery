/**
 * RM-054 (fatia 3): as lacunas da fatia 2 que dependiam da RM-053 na `main`.
 *
 *  - a rede por pessoa (`ork.rede-status/v1`) entra no panorama como fonte: a casa e as maquinas com
 *    a batida, o projeto que uma maquina declara e a maquina da rede sem fabrica, como lacuna;
 *  - `ork_network_status` no MCP (so o projeto servido), no OpenClaw e no Hermes;
 *  - o `gh` fora do PATH curto do gateway e do cron (`~/.local/bin`) e achado pela forja do panorama.
 *
 * A rede vem pronta (o `StatusDaRede` que `lerRede` devolveria): nenhum teste fala com forja real.
 * Maquinas, projetos e casa SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { executorPadrao } from '../src/forja';
import { definirFusoDoDono } from '../src/horario';
import { instalarAdaptador } from '../src/hosts';
import { criarServidorMcp } from '../src/mcp-server';
import { ErroDoPedidoDeProjeto, montarPanoramaDaRede, redeDoProjetoFixado, textoDoPanoramaDaRede } from '../src/network-roadmap';
import { MembroDaRede, StatusDaRede } from '../src/rede-status';
import { dirTemporario, projetoTemporario } from './apoio';

const QUANDO = '2026-10-03T04:00:00.000Z';
const antes = (min: number): string => new Date(Date.parse(QUANDO) - min * 60000).toISOString();
const ORK = path.resolve(__dirname, '../../dist/index.js');
const DIST_OPENCLAW = path.resolve(__dirname, '../../../adapters/openclaw/dist');
const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');

function membro(maquina: string, publicadoEm: string, projetos: MembroDaRede['projetos'], origem: MembroDaRede['origem'] = 'rede'): MembroDaRede {
  return { maquina, origem, publicadoEm, idadeMs: Date.parse(QUANDO) - Date.parse(publicadoEm), hostname: null, adesao: null, pessoa: null,
    forjas: [], runtimes: [], hosts: [], projetos, versaoOrk: '0.5.2' };
}

/** A rede de 03/10: pc-a (esta), pc-c (declara o orkastery, sem fabrica) e pc-d (parada, declara so o outro). */
function redeSimulada(): StatusDaRede {
  return {
    contrato: 'ork.rede-status/v1', consultadoEm: QUANDO,
    casa: { forja: 'github', host: 'github.com', dono: 'dono', repositorio: 'orkastery-network', origem: 'rede.json' },
    estaMaquina: { maquina: 'pc-a', membro: true, adesao: 'rede', publicada: true, nomeEmUso: false },
    fontes: [{ fonte: 'rede', ref: 'github.com/dono/orkastery-network#main', ponta: 'abcdef1234567890abcdef1234567890abcdef12', atualizado: true },
      { fonte: 'fabrica-estado', projeto: 'segredo', ref: 'ork/fabrica-estado', ponta: null, atualizado: true }],
    membros: [
      membro('pc-a', antes(5), [{ nome: 'orkastery', remoto: null, caminho: '/tmp/x' }]),
      membro('pc-c', antes(20), [{ nome: 'orkastery', remoto: 'https://github.com/dono/qualquer.git', caminho: '/srv/orkastery' }]),
      membro('pc-d', antes(5 * 60), [{ nome: 'outro', remoto: 'https://github.com/dono/outro.git', caminho: '/srv/outro' },
        { nome: 'segredo', remoto: 'https://github.com/dono/segredo.git', caminho: '/srv/segredo' }]),
      membro('pc-legado', antes(30), [{ nome: 'segredo', remoto: null, caminho: null }], 'fabrica-estado'),
    ],
    lacunas: [
      { tipo: 'forja.sem-login', detalhe: 'glab: sem login nesta maquina' },
      { tipo: 'fabrica.sem-leitura', projeto: 'segredo', detalhe: 'segredo: sem o remoto origin' },
    ],
    naoConsultado: ['roadmap', 'reservas', 'threads'],
  };
}

test('rm054 fatia 3: o panorama le a rede por pessoa, com a casa, a batida e os projetos de cada maquina', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const p = projetoTemporario('rm054f3-panorama', true);
  try {
    const panorama = montarPanoramaDaRede({ cwd: p.dir, quando: QUANDO, maquina: 'pc-a', registro: path.join(p.dir, 'sem-registro.json'),
      semRemoto: true, rede: redeSimulada() });
    assert.ok(!panorama.naoConsultado.some((n) => n.startsWith('rede por pessoa')), panorama.naoConsultado.join('\n'));
    assert.ok(panorama.rede, 'o contrato traz a rede');
    assert.equal(panorama.rede!.casa, 'github.com/dono/orkastery-network');
    assert.deepEqual(panorama.rede!.membros.map((m) => [m.maquina, m.estaMaquina, m.semBatida]),
      [['pc-a', true, false], ['pc-c', false, false], ['pc-d', false, true]]);
    // A lacuna da casa entra com o tipo da RM-053; a da fabrica de outro projeto, nao.
    const daCasa = panorama.lacunas.find((l) => l.tipo === 'forja.sem-login');
    assert.ok(daCasa && daCasa.parte === 'rede' && daCasa.correcao.trim(), JSON.stringify(panorama.lacunas));
    assert.ok(!panorama.lacunas.some((l) => l.tipo === 'fabrica.sem-leitura'));
    const texto = textoDoPanoramaDaRede(panorama);
    assert.match(texto, /^Rede por pessoa \(RM-053\)\n• casa: github\.com\/dono\/orkastery-network @ abcdef1, lida agora$/m);
    assert.match(texto, /^• pc-a \(esta máquina\): retrato de 03\/10 00:55 \(há 5min\), ork 0\.5\.2, projetos: orkastery$/m);
    assert.match(texto, /^• pc-d: retrato de 02\/10 20:00 \(há 5h00\), SEM BATIDA, ork 0\.5\.2, projetos: outro, segredo$/m);
    assert.doesNotMatch(texto, /vazi[oa]|não lida nesta versão/i);
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('rm054 fatia 3: a maquina da rede que declara o projeto e nao publicou na fabrica aparece com as threads nao lidas', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const p = projetoTemporario('rm054f3-sem-fabrica', true);
  try {
    const panorama = montarPanoramaDaRede({ cwd: p.dir, quando: QUANDO, maquina: 'pc-a', registro: path.join(p.dir, 'sem-registro.json'),
      pedido: p.dir, rede: redeSimulada() });
    const x = panorama.projetos[0];
    assert.equal(x.projeto.nome, 'orkastery');
    const pcC = x.maquinas?.find((m) => m.maquina === 'pc-c');
    assert.ok(pcC, JSON.stringify(x.maquinas));
    assert.equal(pcC!.origem, 'rede');
    assert.equal(pcC!.threadsLidas, false);
    assert.ok(x.maquinas!.filter((m) => m.maquina !== 'pc-c').every((m) => m.threadsLidas), 'as maquinas lidas dizem que foram lidas');
    assert.equal(x.maquinas!.filter((m) => m.maquina === 'pc-a').length, 1, 'esta maquina nao se repete pela rede');
    assert.ok(!x.maquinas!.some((m) => m.maquina === 'pc-d'), 'pc-d nao declara o orkastery');
    const l = x.lacunas.find((y) => y.tipo === 'maquina.sem-fabrica');
    assert.ok(l && l.alvo === 'pc-c' && /ork fabrica entrar/.test(l.correcao), JSON.stringify(x.lacunas));
    const texto = textoDoPanoramaDaRede(panorama);
    assert.match(texto, /^• pc-c: threads não lidas, na rede por pessoa \(retrato de 03\/10 00:40, há 20min\) e sem retrato em ork\/fabrica-estado$/m);
    assert.doesNotMatch(texto, /pc-c: 0 ativa/);
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('rm054 fatia 3: no host, o projeto que so a rede conhece e pedido pelo nome e lido pela forja', () => {
  const vazio = dirTemporario('rm054f3-host');
  try {
    const sem = (): unknown => montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-a', registro: path.join(vazio, 'nada.json'),
      host: true, pedido: 'outro', semRemoto: true, rede: false });
    assert.throws(sem, (e: unknown) => e instanceof ErroDoPedidoDeProjeto && e.codigo === 'projeto.desconhecido');
    const panorama = montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-a', registro: path.join(vazio, 'nada.json'),
      host: true, pedido: 'outro', semRemoto: true, rede: redeSimulada() });
    assert.equal(panorama.projetos.length, 1);
    assert.equal(panorama.projetos[0].projeto.nome, 'outro');
    assert.equal(panorama.projetos[0].projeto.forja, 'github.com/dono/outro');
    assert.equal(panorama.projetos[0].projeto.clone, null);
    // A forja de um projeto da rede vale no host como a de um projeto registrado.
    assert.doesNotThrow(() => montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-a', registro: path.join(vazio, 'nada.json'),
      host: true, pedido: 'github:dono/segredo', semRemoto: true, rede: redeSimulada() }));
    // Sem pedido, os projetos da rede entram no panorama; o nome so passa no padrao de projeto.
    const todos = montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-a', registro: path.join(vazio, 'nada.json'),
      host: true, semRemoto: true, rede: redeSimulada() });
    assert.deepEqual(todos.projetos.map((x) => [x.projeto.nome, x.projeto.forja, x.projeto.origem]),
      [['orkastery', 'github.com/dono/qualquer', 'rede'], ['outro', 'github.com/dono/outro', 'rede'], ['segredo', 'github.com/dono/segredo', 'rede']]);
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); }
});

test('rm054 fatia 3: sem ORK_REDE_LER=0 nem rede pronta, o panorama tenta a casa e nunca diz "nao lida nesta versao"', () => {
  const vazio = dirTemporario('rm054f3-desligada');
  try {
    const p = montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-a', registro: path.join(vazio, 'nada.json'), semRemoto: true });
    assert.ok(p.naoConsultado.some((n) => n === 'rede por pessoa (RM-053, ork.rede-status/v1): leitura desligada (ORK_REDE_LER=0); ' +
      'as máquinas vêm da branch ork/fabrica-estado de cada projeto'), p.naoConsultado.join('\n'));
    const anterior = process.env.ORK_REDE_LER;
    delete process.env.ORK_REDE_LER;
    try {
      // Sem rede (--sem-remoto) e sem casa conhecida: a leitura acontece e vira lacuna tipada.
      const lida = montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-a', registro: path.join(vazio, 'nada.json'), semRemoto: true });
      assert.ok(lida.rede, 'a rede foi lida');
      assert.equal(lida.rede!.casa, null);
      assert.ok(lida.lacunas.some((l) => l.tipo === 'rede.sem-leitura' && l.parte === 'rede'), JSON.stringify(lida.lacunas));
      assert.match(textoDoPanoramaDaRede(lida), /^• casa: nenhuma achada \(veja as lacunas\)$/m);
    } finally { process.env.ORK_REDE_LER = anterior; }
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); }
});

test('rm054 fatia 3: MCP, ork_network_status mostra so o projeto servido em cada maquina', async () => {
  const p = projetoTemporario('rm054f3-mcp', true);
  try {
    const s = redeDoProjetoFixado(p.dir, { status: redeSimulada() });
    assert.deepEqual(s.membros.map((m) => [m.maquina, m.projetos.map((q) => q.nome)]),
      [['pc-a', ['orkastery']], ['pc-c', ['orkastery']], ['pc-d', []]]);
    assert.ok(!JSON.stringify(s).includes('segredo'), 'o outro projeto nao aparece em nada');
    assert.ok(s.naoConsultado.some((n) => n.startsWith('outros projetos das máquinas (este servidor MCP mostra só orkastery')));
    // O panorama fixado tambem nao revela os projetos das outras maquinas nem os toma como alvo.
    const panorama = montarPanoramaDaRede({ fixado: p.dir, quando: QUANDO, maquina: 'pc-a', rede: redeSimulada() });
    assert.equal(panorama.projetos.length, 1);
    assert.ok(!textoDoPanoramaDaRede(panorama).includes('segredo'));
    assert.ok(!JSON.stringify(panorama.rede).includes('outro'));

    const servidor = criarServidorMcp({ projeto: p.dir, host: 'codex' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const cliente = new Client({ name: 'teste', version: '0' });
    await Promise.all([servidor.connect(a), cliente.connect(b)]);
    try {
      const tool = (await cliente.listTools()).tools.find((t) => t.name === 'ork_network_status');
      assert.ok(tool, 'a tool existe');
      assert.equal(tool!.annotations?.readOnlyHint, true);
      assert.match(tool!.description ?? '', /nunca conclua "nenhuma maquina"/);
      const r = await cliente.callTool({ name: 'ork_network_status', arguments: {} });
      const texto = (r.content as { type: string; text: string }[])[0].text;
      const corpo = JSON.parse(texto) as { texto: string; status: StatusDaRede };
      assert.equal(corpo.status.contrato, 'ork.rede-status/v1');
      assert.match(corpo.texto, /^Orkastery Network/);
      assert.ok(corpo.status.naoConsultado.some((n) => n.includes('este servidor MCP mostra só orkastery')));
    } finally { await cliente.close(); await servidor.close(); }
  } finally { p.limpar(); }
});

test('rm054 fatia 3: no host, ork network status nao le o projeto do diretorio do gateway', () => {
  const p = projetoTemporario('rm054f3-cli', true);
  try {
    const rodar = (explicito: string) => {
      const r = spawnSync(process.execPath, [ORK, 'network', 'status', '--sem-remoto', '--json'],
        { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ORK_PROJETO_EXPLICITO: explicito, ORK_MAQUINA: 'pc-a' } });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout) as StatusDaRede;
    };
    const daFabrica = (s: StatusDaRede) => s.fontes.filter((f) => f.fonte === 'fabrica-estado').map((f) => f.projeto);
    assert.deepEqual(daFabrica(rodar('0')), ['orkastery'], 'no terminal, o projeto do diretorio entra');
    assert.deepEqual(daFabrica(rodar('1')), [], 'no host, o diretorio do gateway nao e projeto');
  } finally { p.limpar(); }
});

test('rm054 fatia 3: a forja do panorama acha o gh em ~/.local/bin com o PATH curto do gateway', () => {
  const home = dirTemporario('rm054f3-home'), pathCurto = dirTemporario('rm054f3-path');
  const bin = path.join(home, '.local/bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf \'{"achado":"%s"}\' "$1"\n', { mode: 0o755 });
  const antes = { HOME: process.env.HOME, PATH: process.env.PATH, EXTRA: process.env.ORK_BINARIOS_EXTRA };
  try {
    Object.assign(process.env, { HOME: home, PATH: pathCurto });
    delete process.env.ORK_BINARIOS_EXTRA;
    const r = executorPadrao('gh', ['api'], '', 5000);
    assert.equal(r.erro, undefined, JSON.stringify(r));
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { achado: 'api' });
    // Sem o binario em pasta nenhuma, segue o ENOENT de sempre (forja.ausente).
    fs.rmSync(path.join(bin, 'gh'));
    assert.equal(executorPadrao('gh', ['api'], '', 5000).erro, 'ENOENT');
  } finally {
    process.env.HOME = antes.HOME; process.env.PATH = antes.PATH;
    if (antes.EXTRA === undefined) delete process.env.ORK_BINARIOS_EXTRA; else process.env.ORK_BINARIOS_EXTRA = antes.EXTRA;
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(pathCurto, { recursive: true, force: true });
  }
});

type Tool = { name: string; parameters: { properties?: Record<string, unknown> }; execute: (p: Record<string, unknown>, c: unknown, x: unknown) => Promise<string> };

test('rm054 fatia 3: OpenClaw, ork_network_status e uma chamada de ork network status, sem projeto, nos perfis coding e messaging', async () => {
  const dir = dirTemporario('rm054f3-openclaw');
  const falso = path.join(dir, 'ork-falso');
  fs.writeFileSync(falso, '#!/bin/sh\necho "argv:$*|explicito:$ORK_PROJETO_EXPLICITO"\n', { mode: 0o755 });
  const anterior = process.env.ORK_BIN;
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(path.join(DIST_OPENCLAW, f), path.join(dir, f));
    process.env.ORK_BIN = falso;
    const importar = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: { tools: (f: (d: Tool) => Tool) => Tool[] } }>;
    const plugin = (await importar(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    const tool = plugin.tools((d) => d).find((t) => t.name === 'ork_network_status');
    assert.ok(tool, 'a tool existe');
    assert.equal(tool!.parameters.properties?.projeto, undefined, 'a rede e da pessoa: sem projeto');
    assert.match(await tool!.execute({}, {}, {}), /^argv:network status\|explicito:1$/m);
    assert.match(await tool!.execute({ projeto: 'orkastery' }, {}, {}), /^\[ork recusou\] projeto\.invalido: esta tool é da rede da pessoa/);
    const manifesto = JSON.parse(fs.readFileSync(path.join(RAIZ_DO_REPO, 'adapters/openclaw/openclaw.plugin.json'), 'utf8'));
    assert.ok(manifesto.contracts.tools.includes('ork_network_status'));
    assert.deepEqual(manifesto.toolMetadata.ork_network_status.profiles, ['coding', 'messaging']);
  } finally {
    if (anterior === undefined) delete process.env.ORK_BIN; else process.env.ORK_BIN = anterior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rm054 fatia 3: Hermes, ork-network-status.sh declara o host, chama ork network status e esta no manifesto e na skill', () => {
  const p = projetoTemporario('rm054f3-hermes');
  const dir = dirTemporario('rm054f3-hermes-gateway');
  try {
    const install = instalarAdaptador('hermes', { projeto: p.dir });
    const bin = path.join(install.destino, 'bin', 'ork-network-status.sh');
    assert.ok(!fs.readFileSync(bin, 'utf8').includes('{{'), 'o placeholder foi renderizado');
    const falso = path.join(dir, 'ork falso');
    fs.writeFileSync(falso, '#!/bin/sh\necho "argv:$*|explicito:$ORK_PROJETO_EXPLICITO|canal:$ORK_CANAL"\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, ORK_BIN: falso };
    delete env.ORK_PROJETO_EXPLICITO; delete env.ORK_CANAL; delete env.ORK_PROJETO;
    const r = spawnSync('/bin/sh', [bin, '--json'], { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'argv:network status --json|explicito:1|canal:hermes');
    const manifesto = JSON.parse(fs.readFileSync(path.join(install.destino, 'hermes.plugin.json'), 'utf8'));
    assert.equal(manifesto.bin.ork_network_status, './bin/ork-network-status.sh');
    const skill = fs.readFileSync(path.join(RAIZ_DO_REPO, 'adapters/hermes/skills/orkastery-devmaster/SKILL.md'), 'utf8');
    assert.ok(skill.includes('`ork_network_status` (`ork network status`, sem projeto)'));
    for (const [arquivo, trecho] of [['adapters/claude-code/commands/ork.md', '`mcp__orkastery__ork_network_status`'],
      ['adapters/codex/skills/ork/SKILL.md', 'use `ork_network_status` (ou `ork network status`)']]) {
      assert.ok(fs.readFileSync(path.join(RAIZ_DO_REPO, arquivo), 'utf8').includes(trecho), arquivo);
    }
  } finally { p.limpar(); fs.rmSync(dir, { recursive: true, force: true }); }
});

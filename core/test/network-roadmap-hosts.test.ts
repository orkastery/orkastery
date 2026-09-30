/**
 * RM-054 (fatia 2): o roadmap da rede nos hosts.
 *
 * Em 29/09/2026 o OpenClaw respondeu pelo cwd do gateway (`~/.openclaw/workspace`, projeto
 * "workspace") e o modelo leu "0 threads" como "roadmap vazio". Aqui o panorama da rede chega aos
 * quatro hosts: o nucleo em modo host (o gateway nao tem cwd de projeto) e em modo fixado (o servidor
 * MCP), a oferta da rede na recusa do projeto-alvo, a tool de cada host e o aceite do incidente pela
 * extensao do OpenClaw com o `ork` real. Projetos, maquinas e threads SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { publicarMaquina } from '../src/fabrica-estado';
import { init } from '../src/init';
import { main } from '../src/index';
import { exigirManifesto } from '../src/manifest';
import { criarServidorMcp } from '../src/mcp-server';
import { pegarItem } from '../src/roadmap-reservas';
import { novaThread } from '../src/thread';
import { ErroDoPedidoDeProjeto, montarPanoramaDaRede } from '../src/network-roadmap';
import { ErroDeProjeto, OFERTA_DA_REDE, registrarProjeto, resolverProjetoAlvo } from '../src/projeto-alvo';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const QUANDO = '2026-09-30T02:40:00.000Z';

/** O `workspace` do gateway: um manifesto de outro projeto, com git e sem thread nenhuma. */
function workspace(nome: string): string {
  const dir = dirTemporario(nome);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  init(dir, { nome: 'workspace', abbrev: 'wor' });
  return dir;
}

/**
 * A cena do host: o `orkastery` num clone com remoto, o `workspace` do gateway e o registro da
 * RM-052 num diretorio de usuario proprio (`ORK_USUARIO_DIR`).
 */
function cenaDoHost(nome: string, opcoes: { registrarWorkspace?: boolean; registrarOrkastery?: boolean } = {}) {
  const orkastery: ProjetoDeTeste = projetoTemporario(`${nome}-orkastery`, true);
  const gateway = workspace(`${nome}-workspace`);
  const usuario = dirTemporario(`${nome}-usuario`);
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  if (opcoes.registrarOrkastery !== false) registrarProjeto(orkastery.dir, 'init');
  if (opcoes.registrarWorkspace) registrarProjeto(gateway, 'init');
  return {
    orkastery, gateway, usuario, registro: path.join(usuario, 'projetos.json'),
    limpar: () => {
      if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
      orkastery.limpar();
      fs.rmSync(gateway, { recursive: true, force: true });
      fs.rmSync(usuario, { recursive: true, force: true });
    },
  };
}

/** Um item do roadmap no formato do modelo, so com o que o status report le. */
function item(dir: string, id: string, titulo: string, ciclo: string): void {
  const fm = ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "${titulo}"`, 'categoria: melhoria', 'pai: null', 'features: []', 'owner: Dono',
    'atualizado_em: 2026-09-29T10:00:00-03:00', 'estado:', `  ciclo: ${ciclo}`, '  documentacao: Rascunho', '  codigo: Não iniciado',
    '  testes: Não iniciados', '  deploy: Não implantado', '  exposicao: Flag desligada', '  habilitacao: Pendente', 'evidencias:',
    '  codigo:', '    commit: null', '    pr: null', 'sdlc:', '  thread: null', '---', '', `# ${id}`, ''].join('\n');
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', `${id}-simulado.md`), fm);
}

/**
 * Duas "maquinas" do mesmo remoto bare, como na fatia 1: `pc-a` (este clone, com estado local) conduz
 * o RM-001; `pc-b` (outro clone) conduz o RM-002, reservou o item e publicou o retrato ha 10 minutos.
 * O relogio e o de agora: o panorama dos hosts nao recebe instante.
 */
function duasMaquinas(nome: string) {
  const a: ProjetoDeTeste = projetoTemporario(`${nome}-a`, true);
  item(a.dir, 'RM-001', 'Anda nesta maquina', 'Em desenvolvimento');
  item(a.dir, 'RM-002', 'Anda na outra maquina', 'Em desenvolvimento');
  item(a.dir, 'RM-003', 'Ideia nova', 'Discovery');
  exec('git', ['add', '-A'], a.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto e roadmap'], a.dir);
  exec('git', ['push', '-q', 'origin', 'main'], a.dir);
  const b = path.join(dirTemporario(`${nome}-b`), 'clone');
  exec('git', ['clone', '-q', a.remoto as string, b]);
  for (const [k, v] of [['user.email', 'b@orkastery.local'], ['user.name', 'Builder B'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], b);
  const aqui = novaThread(exigirManifesto(a.dir), { nome: 'anda nesta', modo: 'auto', roadmap: 'RM-001' }).thread;
  const la = novaThread(exigirManifesto(b), { nome: 'anda na outra', modo: 'auto', roadmap: 'RM-002' }).thread;
  const dezMinutos = new Date(Date.now() - 10 * 60000).toISOString();
  assert.equal(pegarItem(b, 'RM-002', { maquina: 'pc-b', thread: la.id, agora: dezMinutos }).acao, 'pegou');
  assert.equal(publicarMaquina(exigirManifesto(b), { maquina: 'pc-b', agora: dezMinutos }).acao, 'publicou');
  return {
    a, b, aqui, la,
    limpar: () => { a.limpar(); fs.rmSync(path.dirname(b), { recursive: true, force: true }); },
  };
}

/** O texto de um panorama honesto: fonte e hora de cada parte, e nenhum "vazio". */
function semVazio(texto: string): void {
  assert.doesNotMatch(texto, /vazi[oa]/i, texto);
  assert.match(texto, /^Fontes$/m);
  assert.match(texto, /^• roadmap: docs\/roadmap em origin\/main @ [0-9a-f]{7} \(commit de \d{2}\/\d{2} \d{2}:\d{2}.*\), lido agora$/m);
  assert.match(texto, /^• fábrica: origin\/ork\/fabrica-estado @ [0-9a-f]{7} \(commit de .*\), lido agora$/m);
  assert.match(texto, /^• reservas: origin\/ork\/roadmap-reservas @ [0-9a-f]{7} \(commit de .*\), lido agora$/m);
}

/** A recusa do pedido de projeto, com o codigo esperado. */
function recusa(f: () => unknown, codigo: string): ErroDoPedidoDeProjeto {
  try { f(); } catch (e) {
    assert.ok(e instanceof ErroDoPedidoDeProjeto, String(e));
    assert.equal(e.codigo, codigo);
    return e;
  }
  assert.fail(`esperava a recusa ${codigo}`);
}

/** Roda o CLI no processo, com o ambiente dado, e devolve o codigo e a saida. */
function cli(cwd: string, args: string[], env: Record<string, string | undefined>): { codigo: number; saida: string } {
  const antes = { cwd: process.cwd(), log: console.log, erro: console.error };
  const salvo = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  let saida = '';
  try {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    console.log = (s: unknown) => { saida += String(s) + '\n'; };
    console.error = (s: unknown) => { saida += String(s) + '\n'; };
    process.chdir(cwd);
    return { codigo: main(args), saida };
  } finally {
    console.log = antes.log; console.error = antes.erro; process.chdir(antes.cwd);
    for (const [k, v] of Object.entries(salvo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ---------------------------------------------------------------------------
// T1: o nucleo em modo host.
// ---------------------------------------------------------------------------

test('rede nos hosts: host aceita nome e forja no --projeto; caminho e URL recusam sem ecoar o pedido', () => {
  const c = cenaDoHost('rede-host-pedido');
  try {
    const base = { cwd: c.gateway, registro: c.registro, quando: QUANDO, maquina: 'pc-a', semRemoto: true, host: true };
    const url = 'https://usuario:segredo-de-teste@github.com/dono/repo';
    for (const pedido of ['./orkastery', '../orkastery', c.orkastery.dir, '~/orkastery', url, 'git@github.com:dono/repo.git', 'dono/repo',
      'github:../x', 'a b']) {
      const e = recusa(() => montarPanoramaDaRede({ ...base, pedido }), 'projeto.desconhecido');
      assert.match(e.detalhe, /^no host, --projeto é o nome de um projeto registrado ou a forja/);
      assert.ok(!e.texto.includes('segredo-de-teste'), `a URL com credencial nao volta na recusa: ${pedido}`);
      if (/^[./~]/.test(pedido)) assert.ok(!e.detalhe.includes(pedido), `o caminho pedido nao volta no detalhe: ${pedido}`);
      assert.deepEqual(e.candidatos.map((x) => x.split(' · ')[0]), ['orkastery'], 'so o registro; o workspace do gateway nao e candidato');
    }
    const porNome = montarPanoramaDaRede({ ...base, pedido: 'orkastery' });
    assert.deepEqual(porNome.projetos.map((x) => [x.projeto.nome, x.projeto.origem]), [['orkastery', 'argumento']]);
    const porForja = montarPanoramaDaRede({ ...base, pedido: 'github:dono/repo' });
    assert.equal(porForja.projetos[0].projeto.forja, 'github.com/dono/repo');
    assert.ok(porForja.projetos[0].lacunas.some((l) => l.tipo === 'forja.nao-consultada'), '--sem-remoto: a forja nao foi consultada');
    // Fora do host vale a fatia 1: o caminho do clone continua um pedido valido.
    assert.equal(montarPanoramaDaRede({ ...base, host: false, pedido: c.orkastery.dir }).projetos[0].projeto.nome, 'orkastery');
  } finally { c.limpar(); }
});

test('rede nos hosts: host nao le o projeto do cwd fora do registro, e diz por que no nao consultado', () => {
  const c = cenaDoHost('rede-host-cwd');
  try {
    const base = { cwd: c.gateway, registro: c.registro, quando: QUANDO, maquina: 'pc-a', semRemoto: true };
    const doHost = montarPanoramaDaRede({ ...base, host: true });
    assert.deepEqual(doHost.projetos.map((x) => [x.projeto.nome, x.projeto.origem]), [['orkastery', 'registro']]);
    const linha = doHost.naoConsultado.find((n) => n.startsWith('diretório do host ('));
    assert.ok(linha, JSON.stringify(doHost.naoConsultado));
    assert.match(linha, /o projeto workspace está fora do registro desta máquina, e o ork não lê projeto pelo diretório do gateway \(RM-052\)/);
    // Fora do host, o cwd continua entrando (fatia 1), e registrado ele entra pelo registro.
    assert.deepEqual(montarPanoramaDaRede(base).projetos.map((x) => x.projeto.nome), ['workspace', 'orkastery']);
    registrarProjeto(c.gateway, 'init');
    const registrado = montarPanoramaDaRede({ ...base, host: true });
    assert.deepEqual(registrado.projetos.map((x) => [x.projeto.nome, x.projeto.origem]).sort(), [['orkastery', 'registro'], ['workspace', 'registro']]);
    assert.ok(!registrado.naoConsultado.some((n) => n.startsWith('diretório do host (')));
  } finally { c.limpar(); }
});

test('rede nos hosts: host sem projeto conhecido pede a forja ou o registro, nunca o caminho', () => {
  const c = cenaDoHost('rede-host-nenhum', { registrarOrkastery: false });
  try {
    const p = montarPanoramaDaRede({ cwd: c.gateway, registro: c.registro, quando: QUANDO, maquina: 'pc-a', semRemoto: true, host: true });
    assert.equal(p.projetos.length, 0);
    const l = p.lacunas.find((x) => x.tipo === 'rede.sem-projeto');
    assert.ok(l, JSON.stringify(p.lacunas));
    assert.match(l.detalhe, /o diretório do host não conta como projeto/);
    assert.match(l.correcao, /--projeto github:dono\/repo/);
    assert.doesNotMatch(l.correcao, /caminho do clone/);
  } finally { c.limpar(); }
});

test('rede nos hosts: host no CLI, ORK_PROJETO_EXPLICITO=1 recusa caminho com saida 4 e aceita o nome', () => {
  const c = cenaDoHost('rede-host-cli');
  try {
    const host = { ORK_PROJETO_EXPLICITO: '1', ORK_MAQUINA: 'pc-a', ORK_PROJETO: undefined };
    const caminho = cli(c.gateway, ['network', 'roadmap', '--projeto', c.orkastery.dir, '--sem-remoto'], host);
    assert.equal(caminho.codigo, 4, caminho.saida);
    assert.match(caminho.saida, /^projeto\.desconhecido: no host, --projeto é o nome de um projeto registrado ou a forja/m);
    const json = cli(c.gateway, ['network', 'roadmap', '--projeto', 'https://u:segredo-de-teste@github.com/d/r', '--json'], host);
    assert.equal(json.codigo, 4);
    assert.equal(JSON.parse(json.saida).erro, 'projeto.desconhecido');
    assert.ok(!json.saida.includes('segredo-de-teste'));
    const nome = cli(c.gateway, ['network', 'roadmap', '--projeto', 'orkastery', '--sem-remoto'], host);
    assert.equal(nome.codigo, 0, nome.saida);
    assert.match(nome.saida, /^Consultado: orkastery \(clone em /m);
    assert.doesNotMatch(nome.saida, /Roadmap do Workspace/);
    // Sem o modo host, o caminho vale (fatia 1).
    assert.equal(cli(c.gateway, ['network', 'roadmap', '--projeto', c.orkastery.dir, '--sem-remoto'],
      { ...host, ORK_PROJETO_EXPLICITO: undefined }).codigo, 0);
  } finally { c.limpar(); }
});

// ---------------------------------------------------------------------------
// T2: sem projeto nomeado, a recusa do projeto-alvo oferece a rede.
// ---------------------------------------------------------------------------

function recusaDoAlvo(f: () => unknown, codigo: string): ErroDeProjeto {
  try { f(); } catch (e) {
    assert.ok(e instanceof ErroDeProjeto, String(e));
    assert.equal(e.codigo, codigo);
    return e;
  }
  assert.fail(`esperava a recusa ${codigo}`);
}

test('rede nos hosts: escolha sem projeto oferece o panorama da rede, com os mesmos candidatos', () => {
  const c = cenaDoHost('rede-escolha');
  try {
    const host = { ORK_PROJETO_EXPLICITO: '1' } as NodeJS.ProcessEnv;
    const e = recusaDoAlvo(() => resolverProjetoAlvo({ ambiente: host, cwd: c.gateway }), 'projeto.escolha');
    assert.deepEqual(e.candidatos.map((x) => x.nome).sort(), ['orkastery', 'workspace'], 'a escolha da RM-052 nao muda');
    assert.ok(e.correcao.startsWith('Repita com o projeto pedido: parâmetro `projeto` da tool, ou `--projeto <nome>`.'), e.correcao);
    assert.ok(e.correcao.endsWith(OFERTA_DA_REDE));
    assert.match(OFERTA_DA_REDE, /`ork network roadmap` \(tool ork_network_roadmap\)/);
    assert.equal(e.texto.split('\n').at(-1), e.correcao, 'a oferta fecha o texto que o host transporta');
    assert.equal(e.recusa.correcao, e.correcao, 'e o JSON leva a mesma oferta');
  } finally { c.limpar(); }
});

test('rede nos hosts: escolha sem nenhum projeto aponta a forja pelo panorama da rede', () => {
  const usuario = dirTemporario('rede-escolha-nenhum-usuario'), vazio = dirTemporario('rede-escolha-nenhum-cwd');
  const anterior = process.env.ORK_USUARIO_DIR;
  try {
    process.env.ORK_USUARIO_DIR = usuario;
    const e = recusaDoAlvo(() => resolverProjetoAlvo({ ambiente: { ORK_PROJETO_EXPLICITO: '1' }, cwd: vazio }), 'projeto.nenhum');
    assert.match(e.correcao, /`ork network roadmap --projeto github:dono\/repo` \(tool ork_network_roadmap\)/);
  } finally {
    if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    fs.rmSync(usuario, { recursive: true, force: true }); fs.rmSync(vazio, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T3: o MCP le o projeto servido, em todas as maquinas.
// ---------------------------------------------------------------------------

test('rede nos hosts: MCP le o projeto servido em todas as maquinas, sem revelar os outros projetos', async () => {
  const r = duasMaquinas('rede-mcp');
  const outro = workspace('rede-mcp-workspace'), usuario = dirTemporario('rede-mcp-usuario');
  const antes = { ORK_USUARIO_DIR: process.env.ORK_USUARIO_DIR, ORK_MAQUINA: process.env.ORK_MAQUINA };
  process.env.ORK_USUARIO_DIR = usuario; process.env.ORK_MAQUINA = 'pc-a';
  registrarProjeto(outro, 'init');
  const server = criarServidorMcp({ projeto: r.a.dir, host: 'codex' });
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'ork_network_roadmap');
    assert.ok(tool, 'a tool esta no catalogo do MCP');
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.openWorldHint, true, 'le o remoto do projeto');
    assert.match(tool.description ?? '', /transporte o texto como vem/);
    assert.match(tool.description ?? '', /nunca conclua "roadmap vazio" nem "nenhuma maquina publicou"/);
    const chamar = async (args: Record<string, unknown>) => {
      const x = await client.callTool({ name: 'ork_network_roadmap', arguments: args });
      return { erro: x.isError === true, json: JSON.parse((x.content as { text: string }[])[0].text) };
    };
    const ok = await chamar({});
    assert.equal(ok.erro, false, JSON.stringify(ok.json));
    const { texto, panorama } = ok.json;
    assert.deepEqual(panorama.projetos.map((x: { projeto: { nome: string; origem: string } }) => [x.projeto.nome, x.projeto.origem]),
      [['orkastery', 'instalacao']]);
    assert.deepEqual(panorama.projetos[0].maquinas.map((m: { maquina: string; origem: string }) => [m.maquina, m.origem]),
      [['pc-a', 'estado-local'], ['pc-b', 'retrato']]);
    assert.deepEqual(panorama.projetos[0].reservas.map((x: { item: string }) => x.item), ['RM-002']);
    assert.ok(panorama.naoConsultado.includes('outros projetos desta máquina: este servidor MCP lê só o projeto fixado na instalação; ' +
      'os outros vêm do CLI `ork network roadmap`'));
    assert.ok(!JSON.stringify(ok.json).includes('workspace'), 'o outro projeto registrado nao aparece em lugar nenhum');
    assert.match(texto, /^Panorama da rede lido de pc-a \(/);
    assert.match(texto, /^Roadmap do Orkastery \(/m);
    assert.match(texto, new RegExp(`^• pc-a \\(esta máquina\\): 1 ativa\\(s\\), estado local lido agora\\n  ${r.aqui.id} · #Auto · GOAL · RM-001$`, 'm'));
    assert.match(texto, new RegExp(`^• pc-b: 1 ativa\\(s\\), retrato de \\d{2}/\\d{2} \\d{2}:\\d{2}.* \\(há 1\\dmin\\)\\n  ${r.la.id} · #Auto · GOAL · RM-002$`, 'm'));
    semVazio(texto);
    assert.equal((await chamar({ projeto: 'orkastery' })).erro, false);
    const fora = await chamar({ projeto: 'workspace' });
    assert.equal(fora.erro, true);
    assert.equal(fora.json.erro, 'projeto.fora-do-servidor');
    assert.deepEqual(fora.json.candidatos.map((x: { nome: string }) => x.nome), ['orkastery']);
  } finally {
    await client.close(); await server.close();
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    r.limpar(); fs.rmSync(outro, { recursive: true, force: true }); fs.rmSync(usuario, { recursive: true, force: true });
  }
});

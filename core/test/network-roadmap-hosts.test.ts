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
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { publicarMaquina } from '../src/fabrica-estado';
import { init } from '../src/init';
import { main } from '../src/index';
import { instalarAdaptador } from '../src/hosts';
import { exigirManifesto } from '../src/manifest';
import { criarServidorMcp } from '../src/mcp-server';
import { pegarItem } from '../src/roadmap-reservas';
import { novaThread } from '../src/thread';
import { ErroDoPedidoDeProjeto, montarPanoramaDaRede } from '../src/network-roadmap';
import { ErroDeProjeto, OFERTA_DA_REDE, registrarProjeto, resolverProjetoAlvo } from '../src/projeto-alvo';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const QUANDO = '2026-09-30T02:40:00.000Z';
/** O `ork` real, compilado: os hosts de CLI chamam este binario. */
const ORK = path.resolve(__dirname, '../../dist/index.js');
const DIST_OPENCLAW = path.resolve(__dirname, '../../../adapters/openclaw/dist');

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
    // O texto da recusa sem as linhas de candidato (elas mostram o clone registrado, com o caminho dele):
    // o detalhe e a correcao, que nunca podem trazer o pedido de volta.
    const semCandidatos = (e: ErroDoPedidoDeProjeto): string => e.texto.split('\n').filter((l) => !l.startsWith('  • ')).join('\n');
    for (const pedido of ['./orkastery', '../orkastery', c.orkastery.dir, '~/orkastery', url, 'git@github.com:dono/repo.git', 'dono/repo',
      'github:../x', 'a b']) {
      const e = recusa(() => montarPanoramaDaRede({ ...base, pedido }), 'projeto.desconhecido');
      assert.match(e.detalhe, /^no host, --projeto é o nome de um projeto registrado ou a forja/);
      assert.ok(!e.texto.includes('segredo-de-teste'), `a URL com credencial nao volta na recusa: ${pedido}`);
      // `dono/repo` aparece de proposito no exemplo da correcao; os outros nao podem voltar.
      if (pedido !== 'dono/repo') assert.ok(!semCandidatos(e).includes(pedido), `o pedido nao volta na recusa: ${pedido}`);
      assert.deepEqual(e.candidatos.map((x) => x.split(' · ')[0]), ['orkastery'], 'so o registro; o workspace do gateway nao e candidato');
    }
    // GO-FIX 1: forja so em host conhecido; host livre (outro servidor, IP, grupo com ponto) recusa.
    for (const pedido of ['github:evil.tld/a/b', 'gitlab:169.254.169.254/a/b', 'gitlab:my.group/sub/repo', 'github:gitlab.com/a/b',
      'gitlab:github.com/a/b', 'github:10.0.0.5.nip.io/a/b']) {
      const e = recusa(() => montarPanoramaDaRede({ ...base, pedido }), 'projeto.desconhecido');
      assert.match(e.detalhe, /^no host, a forja pedida precisa ser github\.com, gitlab\.com ou a de um projeto registrado nesta máquina$/);
      assert.ok(!semCandidatos(e).includes(pedido), `o pedido nao volta na recusa: ${pedido}`);
      assert.match(e.correcao, /gitlab:gitlab\.com\/grupo\/repo/);
    }
    const porNome = montarPanoramaDaRede({ ...base, pedido: 'orkastery' });
    assert.deepEqual(porNome.projetos.map((x) => [x.projeto.nome, x.projeto.origem]), [['orkastery', 'argumento']]);
    for (const [pedido, rotulo] of [['github:dono/repo', 'github.com/dono/repo'], ['gitlab:grupo/sub/repo', 'gitlab.com/grupo/sub/repo'],
      ['gitlab:gitlab.com/grupo.com.ponto/repo', 'gitlab.com/grupo.com.ponto/repo']]) {
      const porForja = montarPanoramaDaRede({ ...base, pedido });
      assert.equal(porForja.projetos[0].projeto.forja, rotulo);
      assert.ok(porForja.projetos[0].lacunas.some((l) => l.tipo === 'forja.nao-consultada'), '--sem-remoto: a forja nao foi consultada');
    }
    // Fora do host vale a fatia 1: o caminho do clone continua um pedido valido.
    assert.equal(montarPanoramaDaRede({ ...base, host: false, pedido: c.orkastery.dir }).projetos[0].projeto.nome, 'orkastery');
  } finally { c.limpar(); }
});

test('rede nos hosts: host aceita forja de host proprio so quando ela e a de um projeto registrado', () => {
  const c = cenaDoHost('rede-host-proprio');
  const proprio: ProjetoDeTeste = projetoTemporario('rede-host-proprio-clone');
  try {
    init(proprio.dir, { nome: 'proprio', abbrev: 'pro', force: true });
    exec('git', ['remote', 'add', 'origin', 'https://gitlab.exemplo.com.br/grupo/proprio.git'], proprio.dir);
    const base = { cwd: c.gateway, registro: c.registro, quando: QUANDO, maquina: 'pc-a', semRemoto: true, host: true };
    // Antes do registro, o host proprio e um servidor qualquer: recusa.
    recusa(() => montarPanoramaDaRede({ ...base, pedido: 'gitlab:gitlab.exemplo.com.br/grupo/proprio' }), 'projeto.desconhecido');
    registrarProjeto(proprio.dir, 'init');
    const p = montarPanoramaDaRede({ ...base, pedido: 'gitlab:gitlab.exemplo.com.br/grupo/proprio' });
    assert.deepEqual(p.projetos.map((x) => [x.projeto.nome, x.projeto.forja, x.projeto.origem]),
      [['proprio', 'gitlab.exemplo.com.br/grupo/proprio', 'argumento']]);
    // O host registrado vale para o tipo dele, e outro repositorio do mesmo host tambem.
    assert.equal(montarPanoramaDaRede({ ...base, pedido: 'gitlab:gitlab.exemplo.com.br/grupo/outro' }).projetos[0].projeto.forja,
      'gitlab.exemplo.com.br/grupo/outro');
    recusa(() => montarPanoramaDaRede({ ...base, pedido: 'github:gitlab.exemplo.com.br/grupo/proprio' }), 'projeto.desconhecido');
  } finally { proprio.limpar(); c.limpar(); }
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
    // GO-FIX 1: com gh e glab falsos no PATH, a forja de host livre recusa sem chamar nenhum dos dois;
    // a publica chama, com o host explicito (o controle positivo de que o falso registra a chamada).
    const falsos = path.join(c.usuario, 'bin'), chamadas = path.join(c.usuario, 'forja-chamada');
    fs.mkdirSync(falsos, { recursive: true });
    for (const cmd of ['gh', 'glab']) {
      fs.writeFileSync(path.join(falsos, cmd), `#!/bin/sh\nprintf "${cmd} %s\\n" "$*" >> "${chamadas}"\nexit 1\n`, { mode: 0o755 });
    }
    const comFalsos = { ...host, PATH: `${falsos}:${process.env.PATH ?? ''}` };
    for (const pedido of ['gitlab:evil.tld/a/b', 'github:169.254.169.254/a/b']) {
      const r = cli(c.gateway, ['network', 'roadmap', '--projeto', pedido], comFalsos);
      assert.equal(r.codigo, 4, r.saida);
      assert.match(r.saida, /^projeto\.desconhecido: no host, a forja pedida precisa ser github\.com, gitlab\.com/m);
    }
    assert.equal(fs.existsSync(chamadas), false, 'nem gh nem glab foram chamados para a forja de host livre');
    assert.equal(cli(c.gateway, ['network', 'roadmap', '--projeto', 'github:dono/repo'], comFalsos).codigo, 0);
    assert.match(fs.readFileSync(chamadas, 'utf8'), /^gh api graphql .*--hostname github\.com/m);
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

// ---------------------------------------------------------------------------
// T5: o Hermes.
// ---------------------------------------------------------------------------

/** Roda um wrapper do Hermes como o gateway roda: `/bin/sh`, no cwd dado, sem projeto herdado. */
function sh(script: string, args: string[], cwd: string, env: Record<string, string>) {
  const base = { ...process.env };
  delete base.ORK_PROJETO; delete base.ORK_PROJETO_EXPLICITO; delete base.ORK_CANAL;
  return spawnSync('/bin/sh', [script, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...base, ...env } });
}

test('rede nos hosts: Hermes, ork-network-roadmap.sh declara o host, repassa --projeto como dado e esta no manifesto e na skill', () => {
  const c = cenaDoHost('rede-hermes');
  try {
    const install = instalarAdaptador('hermes', { projeto: c.orkastery.dir });
    const bin = path.join(install.destino, 'bin', 'ork-network-roadmap.sh');
    const texto = fs.readFileSync(bin, 'utf8');
    assert.match(texto, /export ORK_PROJETO_EXPLICITO="\$\{ORK_PROJETO_EXPLICITO:-1\}"/);
    assert.match(texto, /export ORK_CANAL="\$\{ORK_CANAL:-hermes\}"/);
    assert.match(texto, / network roadmap "\$@"$/m);
    assert.ok(!texto.includes('{{'), 'o placeholder foi renderizado');
    const manifesto = JSON.parse(fs.readFileSync(path.join(install.destino, 'hermes.plugin.json'), 'utf8'));
    assert.equal(manifesto.bin.ork_network_roadmap, './bin/ork-network-roadmap.sh');

    // Com um ork falso: argv e ambiente exatos, e metacaracteres continuam dados.
    const chamadas = path.join(c.usuario, 'chamadas'), falso = path.join(c.usuario, 'ork falso');
    fs.writeFileSync(falso, `#!/bin/sh\nprintf "%s|" "$ORK_PROJETO_EXPLICITO" "$ORK_CANAL" "$@" >> "${chamadas}"; printf "\\n" >> "${chamadas}"\n`, { mode: 0o755 });
    assert.equal(sh(bin, ['--projeto', 'orkastery'], c.gateway, { ORK_BIN: falso }).status, 0);
    assert.equal(sh(bin, ['--projeto', 'a b; $(id)'], c.gateway, { ORK_BIN: falso }).status, 0);
    assert.equal(sh(bin, [], c.gateway, { ORK_BIN: falso, ORK_PROJETO_EXPLICITO: '0' }).status, 0);
    assert.deepEqual(fs.readFileSync(chamadas, 'utf8').trim().split('\n'), [
      '1|hermes|network|roadmap|--projeto|orkastery|',
      '1|hermes|network|roadmap|--projeto|a b; $(id)|',
      '0|hermes|network|roadmap|',
    ]);

    // Com o ork real, do cwd do gateway: o nome responde; o caminho recusa com a saida 4.
    const real = { ORK_BIN: ORK, ORK_USUARIO_DIR: c.usuario, ORK_MAQUINA: 'pc-a' };
    const nome = sh(bin, ['--projeto', 'orkastery', '--sem-remoto'], c.gateway, real);
    assert.equal(nome.status, 0, nome.stdout + nome.stderr);
    assert.match(nome.stdout, /^Consultado: orkastery \(clone em /m);
    assert.doesNotMatch(nome.stdout, /Roadmap do Workspace/);
    const caminho = sh(bin, ['--projeto', c.orkastery.dir], c.gateway, real);
    assert.equal(caminho.status, 4, caminho.stdout + caminho.stderr);
    assert.match(caminho.stdout, /^projeto\.desconhecido: no host, --projeto é o nome de um projeto registrado ou a forja/);

    const skill = fs.readFileSync(path.join(install.destino, 'skills/orkastery-devmaster/SKILL.md'), 'utf8');
    for (const trecho of ['Sem projeto nomeado, ofereça o panorama da rede: `ork_network_roadmap` (wrapper de `ork network roadmap`)',
      'Status do roadmap: `ork_network_roadmap` (`ork network roadmap --projeto <nome>`', 'é só desta máquina',
      'lacuna ou "Não consultado" nunca vira "roadmap vazio" nem "nenhuma máquina publicou"']) assert.ok(skill.includes(trecho), trecho);
  } finally { c.limpar(); }
});

// ---------------------------------------------------------------------------
// T6: as entradas do Claude Code e do Codex.
// ---------------------------------------------------------------------------

test('rede nos hosts: Claude Code e Codex mandam o status do roadmap a rede e oferecem o panorama na frase sem projeto', () => {
  const p = projetoTemporario('rede-claude-codex');
  try {
    const claude = instalarAdaptador('claude-code', { projeto: p.dir });
    const ork = fs.readFileSync(path.join(claude.destino, 'commands/ork.md'), 'utf8');
    for (const trecho of ['Sem projeto nomeado, ofereça também o panorama da rede (RM-054): `ork network roadmap`',
      '`mcp__orkastery__ork_network_roadmap` (o projeto fixado, em todas as máquinas)',
      '| Status do roadmap | Rode `ork network roadmap` (com `--projeto <nome>` quando o dono nomear o projeto) e mostre o texto como vem',
      '`ork roadmap status` le so esta maquina', 'lacuna ou "Nao consultado" nunca e roadmap vazio',
      'ork network roadmap [--projeto <nome>]']) assert.ok(ork.includes(trecho), trecho);
    // Os grants do /orkastery:ork nao mudam: o CLI ja esta em Bash(ork:*), e a tool MCP nao ganha grant novo.
    const grants = ork.match(/^allowed-tools: (.+)$/m)![1].split(',').map((g) => g.trim());
    assert.ok(grants.includes('Bash(ork:*)'));
    assert.ok(!grants.some((g) => g.includes('network')), 'nenhum grant novo');

    const bootstrap = fs.readFileSync(path.join(claude.destino, 'skills/core/orkastery-bootstrap/SKILL.md'), 'utf8');
    for (const trecho of ['Sem projeto nomeado, ofereça o panorama da rede (RM-054): `ork_network_roadmap` no host',
      '`ork network roadmap` no CLI (todos os projetos conhecidos)',
      'lacuna e "Não consultado" nunca viram roadmap vazio nem "nenhuma máquina publicou"']) assert.ok(bootstrap.includes(trecho), trecho);

    const codex = instalarAdaptador('codex', { projeto: p.dir });
    const entrada = fs.readFileSync(path.join(codex.destino, 'skills/ork/SKILL.md'), 'utf8');
    for (const trecho of ['Sem projeto nomeado, ofereça também o panorama da rede\n(`ork_network_roadmap`, ou `ork network roadmap` no CLI)',
      '- Status do roadmap: use `ork_network_roadmap` (ou `ork network roadmap --projeto <nome>`)',
      '`ork_roadmap_status` e\n  so desta maquina', 'lacuna nunca e roadmap vazio']) assert.ok(entrada.includes(trecho), trecho);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// T7: o aceite do incidente de 29/09, sem LLM.
// ---------------------------------------------------------------------------

type Tool = { name: string; execute: (p: Record<string, unknown>, c: unknown, x: unknown) => Promise<string> };

/**
 * A extensao do OpenClaw (o `dist/` commitado, SDK simulado) com o `ork` real de `core/dist`, e o
 * processo parado no cwd do gateway, como o RM-052 faz no teste do incidente dele.
 */
async function gatewayEm(cwd: string, env: Record<string, string>, corpo: (tools: Map<string, Tool>) => Promise<void>): Promise<void> {
  const dir = dirTemporario('rede-openclaw');
  const nomes = ['ORK_BIN', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO', 'ORK_CANAL', ...Object.keys(env)];
  const antes = { cwd: process.cwd(), env: Object.fromEntries(nomes.map((k) => [k, process.env[k]])) };
  const hitl = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ORK_HITL_')));
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(path.join(DIST_OPENCLAW, f), path.join(dir, f));
    for (const k of ['ORK_PROJETO', 'ORK_PROJETO_EXPLICITO', 'ORK_CANAL', ...Object.keys(hitl)]) delete process.env[k];
    Object.assign(process.env, { ORK_BIN: ORK, ...env });
    process.chdir(cwd);
    const importar = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: { tools: (f: (d: Tool) => Tool) => Tool[] } }>;
    const plugin = (await importar(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    await corpo(new Map(plugin.tools((d) => d).map((t) => [t.name, t])));
  } finally {
    process.chdir(antes.cwd);
    for (const [k, v] of Object.entries(antes.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    Object.assign(process.env, hitl);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('rede nos hosts: incidente de 29/09, o status do roadmap do orkastery pedido do gateway volta com as duas maquinas e a hora de cada fonte', async () => {
  const r = duasMaquinas('rede-incidente');
  const gateway = workspace('rede-incidente-workspace'), usuario = dirTemporario('rede-incidente-usuario');
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  registrarProjeto(r.a.dir, 'fabrica entrar');
  try {
    await gatewayEm(gateway, { ORK_USUARIO_DIR: usuario, ORK_MAQUINA: 'pc-a' }, async (tools) => {
      const t = await tools.get('ork_network_roadmap')!.execute({ projeto: 'orkastery' }, {}, {});
      assert.doesNotMatch(t, /^\[ork saiu com/, t);
      const linhas = t.split('\n');
      assert.match(linhas[0], /^Panorama da rede lido de pc-a \(\d{2}\/\d{2}, \d{2}:\d{2}\)$/);
      assert.equal(linhas[1], `Consultado: orkastery (clone em ${r.a.dir})`);
      assert.match(t, /^• rede por pessoa \(RM-053, ork\.rede-status\/v1\): não lida nesta versão/m);
      assert.match(t, new RegExp(`^• diretório do host \\(${escapar(gateway)}\\): o projeto workspace está fora do registro desta máquina`, 'm'));
      assert.match(t, /^Roadmap do Orkastery \(\d{2}\/\d{2}, \d{2}:\d{2}\)$/m);
      for (const id of ['RM-001', 'RM-002', 'RM-003']) assert.match(t, new RegExp(`• ${id} `), id);
      assert.match(t, new RegExp(`^• pc-a \\(esta máquina\\): 1 ativa\\(s\\), estado local lido agora\\n  ${r.aqui.id} · #Auto · GOAL · RM-001$`, 'm'));
      assert.match(t, new RegExp(`^• pc-b: 1 ativa\\(s\\), retrato de \\d{2}/\\d{2} \\d{2}:\\d{2}.* \\(há 1\\dmin\\)\\n  ${r.la.id} · #Auto · GOAL · RM-002$`, 'm'));
      assert.match(t, new RegExp(`^  RM-002 · pc-b · ${r.la.id} · desde \\d{2}/\\d{2} \\d{2}:\\d{2}`, 'm'));
      assert.match(t, /^• esta máquina: estado local em .*\.orkastery, lido agora$/m);
      semVazio(t);
      assert.doesNotMatch(t, /Roadmap do Workspace|nenhuma publicou/i);

      // Sem projeto: o panorama do registro, sem o workspace do cwd; e o maestro sem projeto oferece a rede.
      const todos = await tools.get('ork_network_roadmap')!.execute({}, {}, {});
      assert.equal(todos.split('\n')[1], `Consultado: orkastery (clone em ${r.a.dir})`);
      assert.doesNotMatch(todos, /Roadmap do Workspace/);
      const maestro = await tools.get('ork_maestro')!.execute({}, {}, {});
      assert.match(maestro, /^\[ork saiu com 4\]\n\{/, 'o maestro pede --json, e a recusa vem em JSON');
      const escolha = JSON.parse(maestro.slice(maestro.indexOf('\n') + 1));
      assert.equal(escolha.erro, 'projeto.escolha');
      assert.ok(escolha.correcao.endsWith(OFERTA_DA_REDE), escolha.correcao);
    });
  } finally {
    if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    r.limpar(); fs.rmSync(gateway, { recursive: true, force: true }); fs.rmSync(usuario, { recursive: true, force: true });
  }
});

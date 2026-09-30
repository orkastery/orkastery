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
import { init } from '../src/init';
import { main } from '../src/index';
import { ErroDoPedidoDeProjeto, montarPanoramaDaRede } from '../src/network-roadmap';
import { registrarProjeto } from '../src/projeto-alvo';
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

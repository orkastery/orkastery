/**
 * RM-052 (T3): a resposta honesta.
 *
 * `maestro`, `board`, `board plan`, `fabrica` e `roadmap status`, em texto e em JSON, declaram no
 * cabecalho qual projeto foi lido (nome, raiz, remoto, origem) e o que NAO foi. Sem remoto, a fabrica
 * diz que nada foi lido, nunca "nenhuma publicou ainda": essa frase, lida no projeto errado, foi o
 * incidente de 29/09.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { threadsDeTodosOsPerfis } from '../src/board';
import { discoverMaestro } from '../src/maestro-discovery';
import { readMaestro, maestroText } from '../src/maestro-cli';
import { validateMaestroSnapshot } from '../src/maestro-contract';
import { novaThread } from '../src/thread';
import { raizParaExibir, registrarProjeto } from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function projeto(nome: string, abbrev: string, comRemoto = false): ProjetoDeTeste {
  const p = projetoTemporario(`projeto-alvo-consulta-${nome}`, comRemoto);
  init(p.dir, { nome, abbrev, force: true });
  p.carregado = exigirManifesto(p.dir);
  return p;
}

function ork(usuario: string, cwd: string, args: string[], env: Record<string, string> = {}) {
  const base = { ...process.env };
  delete base.ORK_PROJETO; delete base.ORK_PROJETO_EXPLICITO; delete base.ORK_FABRICA_COMPARTILHADA;
  const r = spawnSync(process.execPath, [ORK, ...args], {
    cwd, encoding: 'utf8', timeout: 60000, env: { ...base, ORK_USUARIO_DIR: usuario, ...env },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

/** O registro do teste, com o outro projeto que o "nao lido" precisa contar. */
function comRegistro(...projetos: ProjetoDeTeste[]): string {
  const usuario = dirTemporario('projeto-alvo-consulta-usuario');
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  try { for (const p of projetos) registrarProjeto(p.dir, 'init'); } finally { process.env.ORK_USUARIO_DIR = anterior; }
  return usuario;
}

test('roadmap status: titulo aprovado na linha 1, o fuso na 2, depois o projeto consultado e o que nao foi lido; JSON com consulta', () => {
  const a = projeto('orkastery', 'ork', true), b = projeto('workspace', 'wor');
  const usuario = comRegistro(a, b);
  try {
    const linhas = ork(usuario, b.dir, ['--projeto', 'orkastery', 'roadmap', 'status']).split('\n');
    assert.match(linhas[0], /^Roadmap do Orkastery \(\d{2}\/\d{2}, \d{2}:\d{2}\)$/);
    // Fatia 2 do ensaio da 0.5.0 (P7): o fuso vem logo abaixo do titulo.
    assert.match(linhas[1], /^Horários (?:de Brasília|em .+)\.$/);
    assert.equal(linhas[2], `Projeto consultado: orkastery (ork) · ${raizParaExibir(a.dir)} · ${a.remoto} · pela opção --projeto`);
    assert.equal(linhas[3], 'Não lido: reservas do roadmap (ork network roadmap) · threads de outras máquinas (ork network roadmap) · ' +
      'outros projetos desta máquina: 1 (ork projetos)');
    const json = JSON.parse(ork(usuario, a.dir, ['roadmap', 'status', '--json']));
    assert.deepEqual(json.consulta.projeto, { nome: 'orkastery', abbrev: 'ork', raiz: raizParaExibir(a.dir), remoto: a.remoto, origem: 'cwd' });
    assert.deepEqual(json.consulta.lido, ['roadmap (docs/roadmap)', 'threads deste projeto nesta máquina']);
    assert.equal(json.consulta.contrato, 'ork.consulta/v1');
  } finally { a.limpar(); b.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('board e board plan: cabecalho com o projeto e "roadmap nao lido"; JSON do board e objeto com consulta e threads', () => {
  const a = projeto('orkastery', 'ork');
  const usuario = comRegistro(a);
  try {
    novaThread(a.carregado, { nome: 'Uma thread', modo: 'auto' });
    const texto = ork(usuario, a.dir, ['board']).split('\n');
    assert.match(texto[0], /^Projeto consultado: orkastery \(ork\) · .* · sem remoto · pelo diretório atual$/);
    assert.match(texto[1], /^Não lido: roadmap \(ork network roadmap\) · reservas do roadmap \(ork network roadmap\) · /);
    assert.ok(texto.some((l) => /^Board do Orkastery, projeto orkastery \(1 thread/.test(l)));
    const json = JSON.parse(ork(usuario, a.dir, ['board', '--json']));
    assert.equal(json.contrato, 'ork.board/v1');
    assert.deepEqual(json.threads, threadsDeTodosOsPerfis(a.carregado, false));
    assert.ok(json.consulta.naoLido.includes('roadmap (ork network roadmap)'));

    const plano = ork(usuario, a.dir, ['board', 'plan']).split('\n');
    assert.match(plano[0], /^Projeto consultado: orkastery \(ork\)/);
    assert.match(plano[1], /^Não lido: roadmap \(ork network roadmap\)/);
    assert.ok(plano.some((l) => /^Escalonador por maquina/.test(l)));
    const planoJson = JSON.parse(ork(usuario, a.dir, ['board', 'plan', '--json']));
    assert.equal(planoJson.consulta.projeto.nome, 'orkastery');
    assert.ok(Array.isArray(planoJson.vagas));
  } finally { a.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('fabrica e outras maquinas: com remoto diz de onde leu; sem remoto diz que nada foi lido, nunca "nenhuma publicou"', () => {
  const comOrigem = projeto('orkastery', 'ork', true), semOrigem = projeto('workspace', 'wor');
  const usuario = comRegistro(comOrigem, semOrigem);
  try {
    const lida = ork(usuario, comOrigem.dir, ['fabrica']);
    assert.match(lida, /^Projeto consultado: orkastery \(ork\) · .* · pelo diretório atual$/m);
    const json = JSON.parse(ork(usuario, comOrigem.dir, ['fabrica', '--json']));
    assert.deepEqual(json.consulta.lido, ['ork/fabrica-estado em origin (lido agora)']);
    assert.ok(Array.isArray(json.maquinas));

    const vazia = ork(usuario, semOrigem.dir, ['fabrica']);
    assert.match(vazia, /Fabrica: o projeto workspace nao tem o remoto origin; nada foi lido de ork\/fabrica-estado\./);
    assert.ok(!/Nenhuma maquina publicou ainda/.test(vazia));
    const vaziaJson = JSON.parse(ork(usuario, semOrigem.dir, ['fabrica', '--json']));
    assert.ok(vaziaJson.consulta.naoLido.some((x: string) => /não tem o remoto origin, nada foi lido/.test(x)));

    const board = ork(usuario, semOrigem.dir, ['board'], { ORK_FABRICA_COMPARTILHADA: '1' });
    assert.match(board, /Outras maquinas: o projeto workspace nao tem o remoto origin; nada foi lido de ork\/fabrica-estado\./);
    assert.ok(!/nenhuma publicou ainda/.test(board), 'a frase do incidente nao sai de um projeto sem remoto');
    const boardComFabrica = ork(usuario, comOrigem.dir, ['board'], { ORK_FABRICA_COMPARTILHADA: '1' });
    assert.match(boardComFabrica, /Outras maquinas \(ork\/fabrica-estado, lido agora\): nenhuma publicou ainda\./);
    assert.ok(!/Não lido: .*outras máquinas \(ork network roadmap\)/.test(boardComFabrica), 'com a fabrica lida, ela nao aparece como nao lida');
  } finally { comOrigem.limpar(); semOrigem.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('maestro: snapshot com raiz, remoto e notConsulted validos no contrato; texto com o projeto consultado; MCP nao conta os outros', () => {
  const a = projeto('orkastery', 'ork', true), b = projeto('workspace', 'wor');
  const usuario = comRegistro(a, b);
  const anterior = process.env.ORK_USUARIO_DIR;
  try {
    const snapshot = JSON.parse(ork(usuario, b.dir, ['maestro', '--json', '--projeto', 'orkastery']));
    validateMaestroSnapshot(snapshot);
    assert.equal(snapshot.project.name, 'orkastery');
    assert.equal(snapshot.project.origin, 'selection');
    assert.equal(typeof snapshot.project.root, 'string');
    assert.ok(!snapshot.project.root.includes('/home/'), 'raiz sem a pasta da conta');
    assert.equal(snapshot.project.remote, '[caminho privado]', 'o remoto bare em /tmp passa pela mesma redacao');
    assert.deepEqual(snapshot.notConsulted, ['roadmap (ork network roadmap)', 'reservas do roadmap (ork network roadmap)',
      'outras máquinas (ork network roadmap)', 'outros projetos desta máquina: 1 (ork projetos)']);
    const texto = ork(usuario, b.dir, ['maestro', '--projeto', 'orkastery']).split('\n');
    assert.equal(texto[0], 'orkastery · panorama Maestro');
    assert.match(texto[1], /^• Consulta: /);
    assert.match(texto[2], /^• Projeto consultado: orkastery · .* · pedido explicitamente \(--projeto ou ORK_PROJETO\)$/);
    assert.match(texto[3], /^• Não lido: roadmap \(ork network roadmap\) · /);

    process.env.ORK_USUARIO_DIR = usuario;
    const fixado = readMaestro(discoverMaestro({ cwd: a.dir, pinned: a.dir, countOtherProjects: false }),
      { host: { tools: [], child: false } });
    assert.equal(fixado.project.origin, 'installation');
    assert.deepEqual(fixado.notConsulted, ['roadmap (ork network roadmap)', 'reservas do roadmap (ork network roadmap)',
      'outras máquinas (ork network roadmap)'], 'o servidor fixado nao revela os outros projetos da maquina');
    assert.match(maestroText(fixado), /• Projeto consultado: orkastery · .* · fixado na instalação/);
  } finally { process.env.ORK_USUARIO_DIR = anterior; a.limpar(); b.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

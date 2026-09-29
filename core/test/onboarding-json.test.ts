import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lerSetup } from '../src/setup';
import { threadsDeTodosOsPerfis, planejar } from '../src/board';
import { adquirirRegiao } from '../src/leases';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

function cli(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), ...args],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' }, timeout: 10000 });
}
function json(dir: string, ...args: string[]) {
  const r = cli(dir, ...args, '--json');
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
  return JSON.parse(r.stdout);
}

test('board list/plan JSON serializam contratos existentes em fixtures vazias e com leases', () => {
  const p = projetoTemporario('onboarding-json-board');
  try {
    // RM-052 (D6): o board em JSON e um objeto com o cabecalho da consulta; a lista continua inteira em `threads`.
    const vazio = json(p.dir, 'board', 'list');
    assert.equal(vazio.contrato, 'ork.board/v1');
    assert.equal(vazio.consulta.projeto.nome, p.carregado.manifesto.project.name);
    assert.deepEqual(vazio.threads, []);
    const a = novaThread(p.carregado, { nome: 'Primeira', modo: 'auto' }).thread;
    const b = novaThread(p.carregado, { nome: 'Segunda', modo: 'auto' }).thread;
    adquirirRegiao(p.dir, 'path:core', { thread: a.id, motivo: 'fixture' });
    adquirirRegiao(p.dir, 'path:core', { thread: b.id, motivo: 'fixture' });
    assert.deepEqual(json(p.dir, 'board', 'list').threads, threadsDeTodosOsPerfis(p.carregado, false));
    const { consulta, ...r } = json(p.dir, 'board', 'plan'), esperado = planejar(p.carregado, { estados: null, agora: r.decididoEm });
    // Compara a decisão no mesmo instante, sem remover campos do contrato; a consulta e o acrescimo da RM-052.
    assert.deepEqual(r, esperado);
    assert.ok(consulta.naoLido.includes('roadmap (ork roadmap status)'));
    const texto = cli(p.dir, 'board', 'list');
    assert.equal(texto.status, 0, texto.stderr); assert.match(texto.stdout, /PERFIL/);
    assert.match(cli(p.dir, 'board', 'plan').stdout, /Escalonador/);
  } finally { p.limpar(); }
});

test('setup JSON completo/modo/set/reset mantém os tipos existentes e preserva texto', () => {
  const p = projetoTemporario('onboarding-json-setup');
  try {
    const inteiro = json(p.dir, 'setup');
    assert.equal(inteiro.contrato, 'ork.setup/v1');
    assert.deepEqual(inteiro.modos, lerSetup(p.dir).modos);
    assert.deepEqual(json(p.dir, 'setup', 'auto'), lerSetup(p.dir).modos.auto);
    const editado = json(p.dir, 'setup', 'auto', '--bloco', '1', '--model', 'modelo-fixture', '--por', 'teste');
    assert.equal(editado.blocos[0].model, 'modelo-fixture');
    assert.deepEqual(editado, lerSetup(p.dir).modos.auto);
    assert.equal(json(p.dir, 'setup', 'auto', '--reset').blocos[0].model, 'opus');
    assert.equal(json(p.dir, 'setup', '--reset').contrato, 'ork.setup/v1');
    assert.notEqual(cli(p.dir, 'setup', 'invalido', '--json').status, 0);
    assert.ok(cli(p.dir, 'setup', 'auto').stdout.includes('#Auto'));
    assert.ok(!cli(p.dir, 'setup').stdout.startsWith('{'));
    assert.equal(json(p.dir, 'onboarding').contrato, 'ork.onboarding/v1');
  } finally { p.limpar(); }
});

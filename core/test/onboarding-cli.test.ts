import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checarOnboarding } from '../src/doctor';
import { lerLedger } from '../src/ledger';
import { caminhoOnboarding, ETAPAS_ONBOARDING, gravarEtapa } from '../src/onboarding';
import { projetoTemporario } from './apoio';

const cli = path.resolve(__dirname, '../../dist/index.js');
function executar(cwd: string, ...args: string[]) {
  // O texto destes testes e o pt-BR: o locale fica fixo, sem herdar o LANG de quem roda (CLI por locale).
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: '', LC_MESSAGES: '' } });
}

test('CLI onboarding show/set/reset e alias --reset produzem JSON puro e autoria explícita/default', () => {
  const p = projetoTemporario('onboarding-cli');
  try {
    for (const args of [['onboarding', '--json'], ['onboarding', 'show', '--json']]) {
      const r = executar(p.dir, ...args);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, '');
      assert.equal(JSON.parse(r.stdout).contrato, 'ork.onboarding/v1');
    }
    const set = executar(p.dir, 'onboarding', 'set', 'maestro', '--conteudo', '{"nome":"Equipe"}', '--por', 'tester', '--json');
    assert.equal(JSON.parse(set.stdout).etapas.maestro.por, 'tester');
    const outro = executar(p.dir, 'onboarding', 'set', 'skills', '--conteudo', '["revisão"]', '--json');
    assert.equal(JSON.parse(outro.stdout).etapas.skills.por, 'owner');
    const reset = executar(p.dir, 'onboarding', '--reset', 'maestro', '--json');
    assert.equal(JSON.parse(reset.stdout).etapas.maestro, null);
    assert.ok(JSON.parse(reset.stdout).etapas.skills);
    const total = executar(p.dir, 'onboarding', 'reset', '--json');
    assert.ok(Object.values(JSON.parse(total.stdout).etapas).every(x => x === null));
    assert.equal(executar(p.dir, 'onboarding', '--reset', '--json').status, 0);
    assert.match(executar(p.dir, 'onboarding').stdout, /\[pendente\] maestro/);
  } finally { p.limpar(); }
});

test('CLI recusa argumentos e JSON malformados sem eco de sentinelas nem escrita', () => {
  const p = projetoTemporario('onboarding-cli-invalid'), sentinela = 'SENTINELA_PRIVADA_DE_TESTE';
  try {
    const casos = [ ['set', 'maestro', '--conteudo', '{' + sentinela],
      ['set', 'credenciais', '--conteudo', JSON.stringify({ token: sentinela })],
      ['set', sentinela, '--conteudo', '{}'], [sentinela], ['show', sentinela],
      ['set', 'maestro'], ['reset', 'maestro', 'extra'], ['show', '--json=false'],
      ['set', 'maestro', '--conteudo'], ['--reset', 'maestro', 'show'], ['--por'], ['--inesperado', sentinela] ];
    for (const args of casos) {
      const r = executar(p.dir, 'onboarding', ...args);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.equal(r.stdout, '');
      assert.ok(!r.stderr.includes(sentinela));
      assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
    }
  } finally { p.limpar(); }
});

test('sync recusa autoria sem efeito antes de publicar ou registrar evento e sem eco', () => {
  const p = projetoTemporario('onboarding-sync-autor'), sentinela = 'SENTINELA_SINTETICA_AUTOR';
  try {
    gravarEtapa(p.dir, 'maestro', 'Equipe');
    const bytes = fs.readFileSync(caminhoOnboarding(p.dir), 'utf8');
    const eventos = lerLedger(path.join(p.dir, '.orkastery'));
    const yaml = fs.readFileSync(p.carregado.caminho, 'utf8');
    for (const flags of [[], ['--json']]) {
      const r = executar(p.dir, 'onboarding', 'sync', '--por', sentinela, ...flags);
      assert.notEqual(r.status, 0);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /onboarding.input.invalid.*sync.*--por/);
      assert.ok(!r.stderr.includes(sentinela));
      assert.equal(fs.readFileSync(caminhoOnboarding(p.dir), 'utf8'), bytes);
      assert.equal(fs.readFileSync(p.carregado.caminho, 'utf8'), yaml);
      assert.deepEqual(lerLedger(path.join(p.dir, '.orkastery')), eventos);
    }
    const valido = executar(p.dir, 'onboarding', 'sync', '--json');
    assert.equal(valido.status, 0, valido.stderr);
    assert.equal(JSON.parse(valido.stdout).motivo, 'modo.files');
  } finally { p.limpar(); }
});

test('doctor distingue pendente/concluído e divergência de memória sem alterar YAML', () => {
  const p = projetoTemporario('onboarding-doctor');
  try {
    const yaml = fs.readFileSync(p.carregado.caminho, 'utf8');
    assert.equal(checarOnboarding(p.carregado)[0].nivel, 'warn');
    for (const etapa of ETAPAS_ONBOARDING) gravarEtapa(p.dir, etapa, etapa === 'memoria' ? { modo: 'orkmind' } : {});
    const checks = checarOnboarding(p.carregado);
    assert.equal(checks[0].nivel, 'ok');
    assert.equal(checks[1].nivel, 'warn');
    assert.match(checks[1].correcao!, /memory.mode: orkmind/);
    assert.equal(fs.readFileSync(p.carregado.caminho, 'utf8'), yaml);
    gravarEtapa(p.dir, 'memoria', { modo: 'files' });
    assert.equal(checarOnboarding(p.carregado).length, 1);
  } finally { p.limpar(); }
});

test('init indica onboarding sem preencher respostas nem sobrescrever manifesto existente', () => {
  const p = projetoTemporario('onboarding-init');
  try {
    fs.unlinkSync(p.carregado.caminho);
    const r = executar(p.dir, 'init');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Proximo passo: ork doctor.*ork onboarding/);
    assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
    const bytes = fs.readFileSync(p.carregado.caminho, 'utf8');
    assert.match(executar(p.dir, 'init').stdout, /Nada foi sobrescrito/);
    assert.equal(fs.readFileSync(p.carregado.caminho, 'utf8'), bytes);
  } finally { p.limpar(); }
});

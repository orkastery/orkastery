import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { caminhoOnboarding, gravarEtapa, lerOnboarding, textoDaPauta, ETAPAS_ONBOARDING } from '../src/onboarding';
import { carregarManifesto } from '../src/manifest';
import { projetoTemporario } from './apoio';

test('maestro persiste owner, preserva objetivos, demais seções e autoria na repetição', () => {
  const p = projetoTemporario('onboarding-experiencia');
  try {
    gravarEtapa(p.dir, 'maestro', { objetivo: 'Produto público' }, 'equipe');
    gravarEtapa(p.dir, 'skills', ['testes'], 'equipe');
    const yaml = fs.readFileSync(p.carregado.caminho, 'utf8');
    const r = gravarEtapa(p.dir, 'maestro', { owner: { language: 'pt-BR', timezone: 'UTC', depth: 'detalhada', experience: false } }, 'configurador');
    assert.deepEqual(carregarManifesto(p.dir)!.manifesto.owner, { language: 'pt-BR', timezone: 'UTC', depth: 'detalhada', experience: false });
    assert.equal((r.etapas.maestro!.conteudo as { objetivo: string }).objetivo, 'Produto público');
    assert.deepEqual(r.etapas.skills?.conteudo, ['testes']);
    assert.ok(fs.readFileSync(p.carregado.caminho, 'utf8').includes(yaml.slice(yaml.indexOf('board:'))));
    const repetido = gravarEtapa(p.dir, 'maestro', { owner: { experience: false } }, 'outro');
    assert.deepEqual(repetido, r);
    assert.equal(ETAPAS_ONBOARDING.length, 9);
  } finally { p.limpar(); }
});

test('entrada inválida, owner duplicado e symlink recusam antes de gravar entrevista', () => {
  const p = projetoTemporario('onboarding-experiencia-invalida');
  try {
    const original = fs.readFileSync(p.carregado.caminho, 'utf8');
    for (const owner of [{ experience: 'false' }, { language: 'pt_BR' }, { timezone: 'bad/zone' }, { depth: 'longa' }, { extra: true }]) {
      assert.throws(() => gravarEtapa(p.dir, 'maestro', { owner }), /onboarding.input.invalid/);
      assert.equal(fs.readFileSync(p.carregado.caminho, 'utf8'), original);
      assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
    }
    fs.appendFileSync(p.carregado.caminho, '\nowner:\n');
    assert.throws(() => gravarEtapa(p.dir, 'maestro', { owner: { experience: false } }), /conflict/);
    assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
    fs.unlinkSync(p.carregado.caminho);
    const alvo = path.join(p.dir, 'original.yaml'); fs.writeFileSync(alvo, original);
    fs.symlinkSync(alvo, p.carregado.caminho);
    assert.throws(() => gravarEtapa(p.dir, 'maestro', { owner: { experience: false } }), /unsafe/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), original);
  } finally { p.limpar(); }
});

test('consulta CLI e pauta mostram dados efetivos sem criar resposta', () => {
  const p = projetoTemporario('onboarding-experiencia-cli');
  try {
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), 'experiencia', 'show', '--json'], { cwd: p.dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).origem.experience, 'padrao');
    assert.equal(lerOnboarding(p.dir).etapas.maestro, null);
    assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
    assert.match(textoDaPauta(), /recomendada.*configurar ou desativar/);
  } finally { p.limpar(); }
});

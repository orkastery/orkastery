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
    const atualizado = fs.readFileSync(p.carregado.caminho, 'utf8').replace('language: "pt-BR"', 'language: "en-US"');
    fs.writeFileSync(p.carregado.caminho, atualizado);
    gravarEtapa(p.dir, 'maestro', { owner: { experience: true } }, 'configurador');
    assert.equal(carregarManifesto(p.dir)!.manifesto.owner?.language, 'en-US', 'opt-in não regrava idioma de uma resposta antiga');
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

test('chaves YAML entre aspas preservam preferências e indentação incompatível não perde dados', () => {
  const p = projetoTemporario('onboarding-experiencia-yaml');
  try {
    const original = fs.readFileSync(p.carregado.caminho, 'utf8');
    fs.writeFileSync(p.carregado.caminho, original.replace('owner:', '"owner":\n  "language": pt-BR\n  depth: curta'));
    gravarEtapa(p.dir, 'maestro', { owner: { experience: false } });
    assert.equal(carregarManifesto(p.dir)!.manifesto.owner?.language, 'pt-BR');
    gravarEtapa(p.dir, 'maestro', { owner: { language: 'en-US' } });
    assert.equal(carregarManifesto(p.dir)!.manifesto.owner?.language, 'en-US');
    const incomum = original.replace('owner:', 'owner:\n    language: pt-BR\n    depth: curta');
    fs.writeFileSync(p.carregado.caminho, incomum);
    const entrevista = fs.readFileSync(caminhoOnboarding(p.dir));
    assert.throws(() => gravarEtapa(p.dir, 'maestro', { owner: { experience: true } }), /conflict/);
    assert.equal(fs.readFileSync(p.carregado.caminho, 'utf8'), incomum);
    assert.deepEqual(fs.readFileSync(caminhoOnboarding(p.dir)), entrevista);
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

test('resposta repetida aplica o pedido ao manifesto editado à mão, sem mudar a autoria da entrevista', () => {
  const p = projetoTemporario('onboarding-experiencia-repetida');
  try {
    const r = gravarEtapa(p.dir, 'maestro', { owner: { experience: false, language: 'pt-BR' } }, 'configurador');
    const editado = fs.readFileSync(p.carregado.caminho, 'utf8').replace('experience: false', 'experience: true')
      .replace('language: "pt-BR"', 'language: "en-US"');
    fs.writeFileSync(p.carregado.caminho, editado);
    const repetido = gravarEtapa(p.dir, 'maestro', { owner: { experience: false } }, 'outro');
    assert.equal(carregarManifesto(p.dir)!.manifesto.owner?.experience, false, 'opt-out repetido vale');
    assert.equal(carregarManifesto(p.dir)!.manifesto.owner?.language, 'en-US', 'só a chave pedida muda');
    assert.deepEqual(repetido.etapas.maestro, r.etapas.maestro, 'autoria e horário da resposta original');
    assert.deepEqual(lerOnboarding(p.dir).etapas.maestro, r.etapas.maestro);
  } finally { p.limpar(); }
});

test('seção owner nova preserva a quebra final e comentário na linha substituída fica', () => {
  const p = projetoTemporario('onboarding-experiencia-yaml-borda');
  try {
    const semOwner = fs.readFileSync(p.carregado.caminho, 'utf8').replace(/^owner:\n(?:  #.*\n)*\n?/m, '');
    assert.ok(!/^owner:/m.test(semOwner) && semOwner.endsWith('\n'));
    fs.writeFileSync(p.carregado.caminho, semOwner);
    gravarEtapa(p.dir, 'maestro', { owner: { depth: 'curta' } });
    const com = fs.readFileSync(p.carregado.caminho, 'utf8');
    assert.ok(com.endsWith('owner:\n  depth: "curta"\n'), JSON.stringify(com.slice(-40)));
    assert.equal(com, semOwner + 'owner:\n  depth: "curta"\n');
    fs.writeFileSync(p.carregado.caminho, com.replace('  depth: "curta"\n', '  depth: "curta"  # nota do dono\n'));
    gravarEtapa(p.dir, 'maestro', { owner: { depth: 'detalhada' } });
    assert.ok(fs.readFileSync(p.carregado.caminho, 'utf8').includes('  depth: "detalhada"  # nota do dono\n'));
    assert.equal(carregarManifesto(p.dir)!.manifesto.owner?.depth, 'detalhada');
  } finally { p.limpar(); }
});

test('preferência inválida no manifesto avisa e vale o padrão; onboarding set corrige', () => {
  const p = projetoTemporario('onboarding-experiencia-manifesto-invalido');
  try {
    const original = fs.readFileSync(p.carregado.caminho, 'utf8');
    fs.writeFileSync(p.carregado.caminho, original.replace(/^owner:\n/m, 'owner:\n  language: pt_BR\n  depth: short\n  experience: False\n'));
    const c = carregarManifesto(p.dir)!;
    assert.deepEqual(c.erros, []);
    assert.equal(c.avisos.filter(a => /experiencia.config.invalid/.test(a)).length, 3);
    assert.equal(c.manifesto.owner, undefined);
    gravarEtapa(p.dir, 'maestro', { owner: { language: 'pt-BR', depth: 'curta', experience: false } });
    const corrigido = carregarManifesto(p.dir)!;
    assert.deepEqual(corrigido.manifesto.owner, { language: 'pt-BR', depth: 'curta', experience: false });
    assert.equal(corrigido.avisos.filter(a => /experiencia.config.invalid/.test(a)).length, 0);
  } finally { p.limpar(); }
});

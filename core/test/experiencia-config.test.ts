import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { idiomaDoSistema, resolverExperiencia, validarPreferencias } from '../src/experiencia';
import { carregarManifesto } from '../src/manifest';
import { projetoTemporario } from './apoio';

test('preferências ausentes usam sistema e consulta não altera dados', () => {
  const owner = {}, r = resolverExperiencia(owner, { language: 'pt-PT', timezone: 'UTC' });
  assert.equal(r.skill, 'orchestration-experience-pt-br');
  assert.equal(r.timezone, 'UTC'); assert.equal(r.depth, 'curta'); assert.equal(r.experience, true);
  assert.equal(r.origem.language, 'sistema'); assert.deepEqual(owner, {});
  assert.equal(idiomaDoSistema({ LANG: 'pt_BR.UTF-8' }), 'pt-BR');
  assert.equal(idiomaDoSistema({ LC_ALL: 'en_GB.UTF-8', LANG: 'pt_BR.UTF-8' }), 'en-GB');
});

test('configuração explícita prevalece e opt-out permanece booleano', () => {
  const r = resolverExperiencia({ language: 'fr-FR', timezone: 'Europe/Paris', depth: 'detalhada', experience: false });
  assert.equal(r.language, 'fr-FR'); assert.equal(r.skill, 'orchestration-experience');
  assert.equal(r.timezone, 'Europe/Paris'); assert.equal(r.experience, false);
  assert.ok(Object.values(r.origem).every(v => v === 'manifesto'));
});

test('preferências inválidas são recusadas, sem eco dos valores', () => {
  for (const v of [{ language: 'pt_BR' }, { timezone: 'invalid/place' }, { depth: 'longa' }, { experience: 'false' }]) {
    assert.throws(() => validarPreferencias(v), /experiencia.config.invalid/);
  }
});

test('manifesto preserva preferências e mantém fallback legado de fuso inválido', () => {
  const p = projetoTemporario('experiencia-config');
  try {
    const original = fs.readFileSync(p.carregado.caminho, 'utf8');
    fs.writeFileSync(p.carregado.caminho, original + '\nowner:\n  language: pt-BR\n  depth: detalhada\n  experience: false\n  timezone: invalid/place\n');
    const r = carregarManifesto(p.dir)!;
    assert.equal(r.erros.length, 0); assert.equal(r.manifesto.owner?.experience, false);
    assert.equal(r.manifesto.owner?.timezone, undefined); assert.ok(r.avisos.some(a => a.includes('owner.timezone')));
    fs.writeFileSync(p.carregado.caminho, original + '\nowner:\n  experience: "false"\n');
    assert.ok(carregarManifesto(p.dir)!.erros.some(e => e.includes('owner.experience')));
  } finally { p.limpar(); }
});

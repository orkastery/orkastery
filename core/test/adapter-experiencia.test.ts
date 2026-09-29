import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { instalarAdaptador, desinstalarExperiencia } from '../src/hosts';
import { gravarEtapa } from '../src/onboarding';
import { INICIO_EXPERIENCIA } from '../src/experiencia-instalacao';
import { projetoTemporario } from './apoio';
const catalogo = path.resolve(__dirname, '../../..');

for (const host of ['codex', 'claude-code'] as const) {
  test(`${host}: instalação no projeto, dry-run, opt-out, reinstalação e remoção`, () => {
    const p = projetoTemporario('adapter-experiencia');
    const alvo = path.join(p.dir, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
    try {
      const original = '# Instruções existentes\r\n'; fs.writeFileSync(alvo, original);
      const opts = { projeto: p.dir, catalogo, orkBin: 'ork', dir: 'integracao' };
      gravarEtapa(p.dir, 'maestro', { owner: { language: 'pt-BR', experience: true } });
      const dry = instalarAdaptador(host, { ...opts, dryRun: true });
      assert.equal(dry.experiencia?.skill, 'orchestration-experience-pt-br');
      assert.equal(fs.readFileSync(alvo, 'utf8'), original);
      const r = instalarAdaptador(host, opts); assert.equal(r.ok, true);
      const ativo = fs.readFileSync(alvo, 'utf8');
      assert.ok(ativo.includes(INICIO_EXPERIENCIA)); assert.ok(ativo.includes(path.join(r.destino, 'skills', 'core')));
      const recibo = fs.readFileSync(path.join(r.destino, 'INSTALADO.json'));
      instalarAdaptador(host, opts); assert.equal(fs.readFileSync(alvo, 'utf8'), ativo);
      desinstalarExperiencia(p.dir, host, true); assert.equal(fs.readFileSync(alvo, 'utf8'), ativo);
      desinstalarExperiencia(p.dir, host); assert.equal(fs.readFileSync(alvo, 'utf8'), original);
      assert.ok(fs.existsSync(path.join(r.destino, 'INSTALADO.json'))); assert.ok(recibo.length);
      instalarAdaptador(host, opts);
      gravarEtapa(p.dir, 'maestro', { owner: { experience: false } });
      instalarAdaptador(host, opts); assert.equal(fs.readFileSync(alvo, 'utf8'), original);
    } finally { p.limpar(); }
  });
}

test('bloco adulterado ou destino por symlink recusa antes de copiar o adaptador', () => {
  const p = projetoTemporario('adapter-experiencia-conflito');
  try {
    const alvo = path.join(p.dir, 'AGENTS.md'); fs.writeFileSync(alvo, INICIO_EXPERIENCIA);
    const opts = { projeto: p.dir, catalogo, orkBin: 'ork' };
    assert.throws(() => instalarAdaptador('codex', opts), /conflict/);
    assert.equal(fs.existsSync(path.join(p.dir, '.agents')), false);
    fs.unlinkSync(alvo); fs.mkdirSync(path.join(p.dir, 'externo'));
    fs.symlinkSync(path.join(p.dir, 'externo'), path.join(p.dir, '.agents'));
    assert.throws(() => instalarAdaptador('codex', opts), /unsafe/);
    assert.equal(fs.existsSync(alvo), false); assert.deepEqual(fs.readdirSync(path.join(p.dir, 'externo')), []);
  } finally { p.limpar(); }
});

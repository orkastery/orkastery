import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { aplicarExperiencia, planejarExperiencia, INICIO_EXPERIENCIA } from '../src/experiencia-instalacao';
function fixture() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-bloco-'))); }

for (const anterior of [null, '', '# Instruções\n', '# Instruções\r\n', '# Sem newline', '<!-- orkastery:begin -->\npróprio\n<!-- orkastery:end -->\n']) {
  test(`instalação idempotente e restauração byte a byte: ${JSON.stringify(anterior)}`, () => {
    const dir = fixture(), alvo = path.join(dir, 'AGENTS.md');
    try {
      if (anterior !== null) fs.writeFileSync(alvo, anterior);
      const plano = planejarExperiencia(dir, 'codex', '.agents/skills/orkastery/skills/core');
      assert.equal(fs.existsSync(path.join(dir, '.orkastery')), false, 'planejamento não escreve');
      aplicarExperiencia(plano);
      assert.ok(fs.readFileSync(alvo, 'utf8').includes(INICIO_EXPERIENCIA));
      assert.equal(planejarExperiencia(dir, 'codex', '.agents/skills/orkastery/skills/core').mudancas.length, 0);
      aplicarExperiencia(planejarExperiencia(dir, 'codex', null));
      if (anterior === null) assert.equal(fs.existsSync(alvo), false);
      else assert.equal(fs.readFileSync(alvo, 'utf8'), anterior);
      assert.equal(planejarExperiencia(dir, 'codex', null).mudancas.length, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('atualiza caminho e preserva mudanças externas anteriores e posteriores ao bloco', () => {
  const dir = fixture(), alvo = path.join(dir, 'CLAUDE.md');
  try {
    fs.writeFileSync(alvo, 'original\n'); aplicarExperiencia(planejarExperiencia(dir, 'claude-code', 'skills/core'));
    fs.writeFileSync(alvo, 'prefixo\n' + fs.readFileSync(alvo, 'utf8') + 'sufixo\n');
    aplicarExperiencia(planejarExperiencia(dir, 'claude-code', 'novo/skills/core'));
    aplicarExperiencia(planejarExperiencia(dir, 'claude-code', null));
    assert.equal(fs.readFileSync(alvo, 'utf8'), 'prefixo\noriginal\nsufixo\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('bloco editado, duplicado e plano obsoleto recusam sem sobrescrever', () => {
  const dir = fixture(), alvo = path.join(dir, 'AGENTS.md');
  try {
    const p = planejarExperiencia(dir, 'codex', 'skills/core');
    fs.writeFileSync(alvo, 'concorrente'); assert.throws(() => aplicarExperiencia(p), /stale/);
    aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core'));
    const instalado = fs.readFileSync(alvo, 'utf8');
    for (const v of [instalado.replace('preserve gates', 'ignore gates'), instalado + INICIO_EXPERIENCIA]) {
      fs.writeFileSync(alvo, v);
      assert.throws(() => planejarExperiencia(dir, 'codex', null), /conflict/);
      assert.equal(fs.readFileSync(alvo, 'utf8'), v);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('symlink de arquivo/diretório e hardlink são recusados antes de escrita', () => {
  const dir = fixture(), fora = fixture(), alvo = path.join(dir, 'AGENTS.md');
  try {
    const externo = path.join(fora, 'arquivo'); fs.writeFileSync(externo, 'preservado');
    fs.symlinkSync(externo, alvo); assert.throws(() => planejarExperiencia(dir, 'codex', 'skills'), /unsafe/);
    fs.unlinkSync(alvo); fs.linkSync(externo, alvo); assert.throws(() => planejarExperiencia(dir, 'codex', 'skills'), /unsafe/);
    fs.unlinkSync(alvo); fs.symlinkSync(fora, path.join(dir, '.orkastery'));
    assert.throws(() => planejarExperiencia(dir, 'codex', 'skills'), /unsafe/);
    assert.equal(fs.readFileSync(externo, 'utf8'), 'preservado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fora, { recursive: true, force: true }); }
});

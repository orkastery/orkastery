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

test('remoção depois de edição externa não funde linhas nem perde a quebra final', () => {
  const casos: [string, (t: string) => string, string][] = [
    ['abc', t => t + 'def\n', 'abc\ndef\n'],
    ['abc\n', t => t.replace('abc\n\n', 'abc\nnova\n'), 'abc\nnova\n'],
    ['abc\r\n', t => t + 'def\r\n', 'abc\r\ndef\r\n'],
  ];
  for (const [original, editar, esperado] of casos) {
    const dir = fixture(), alvo = path.join(dir, 'AGENTS.md');
    try {
      fs.writeFileSync(alvo, original); aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core'));
      fs.writeFileSync(alvo, editar(fs.readFileSync(alvo, 'utf8')));
      aplicarExperiencia(planejarExperiencia(dir, 'codex', null));
      assert.equal(fs.readFileSync(alvo, 'utf8'), esperado, JSON.stringify(original));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('sem recibo: bloco íntegro é adotado, inclusive o da versão com caminho absoluto; editado recusa', () => {
  const dir = fixture(), alvo = path.join(dir, 'AGENTS.md'), recibo = path.join(dir, '.orkastery', 'experiencia');
  try {
    fs.writeFileSync(alvo, '# Projeto\n'); aplicarExperiencia(planejarExperiencia(dir, 'codex', '/antigo/absoluto/skills/core'));
    fs.rmSync(recibo, { recursive: true });
    const adotar = planejarExperiencia(dir, 'codex', '.agents/skills/orkastery/skills/core');
    assert.deepEqual(adotar.mudancas.map(m => path.relative(dir, m.arquivo)), ['AGENTS.md', path.join('.orkastery', 'experiencia', 'codex.json')]);
    aplicarExperiencia(adotar);
    const ativo = fs.readFileSync(alvo, 'utf8');
    assert.ok(ativo.includes('".agents/skills/orkastery/skills/core"') && !ativo.includes('/antigo/'));
    assert.equal(planejarExperiencia(dir, 'codex', '.agents/skills/orkastery/skills/core').mudancas.length, 0);
    fs.rmSync(recibo, { recursive: true });
    aplicarExperiencia(planejarExperiencia(dir, 'codex', null));
    assert.equal(fs.readFileSync(alvo, 'utf8'), '# Projeto\n');
    aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core')); fs.rmSync(recibo, { recursive: true });
    const editado = fs.readFileSync(alvo, 'utf8').replace('preserve gates', 'ignore gates'); fs.writeFileSync(alvo, editado);
    assert.throws(() => planejarExperiencia(dir, 'codex', 'skills/core'), /conflict/);
    assert.throws(() => planejarExperiencia(dir, 'codex', null), /conflict/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), editado);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arquivo criado só com o bloco volta a não existir, mesmo sem recibo', () => {
  for (const reinstalar of [false, true]) {
    const dir = fixture(), alvo = path.join(dir, 'AGENTS.md'), recibo = path.join(dir, '.orkastery', 'experiencia');
    try {
      aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core')); fs.rmSync(recibo, { recursive: true });
      if (reinstalar) aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core'));
      aplicarExperiencia(planejarExperiencia(dir, 'codex', null));
      assert.equal(fs.existsSync(alvo), false, reinstalar ? 'adotado e removido' : 'removido sem recibo');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('arquivo vazio de antes continua existindo quando o editor tira a quebra final do bloco', () => {
  const dir = fixture(), alvo = path.join(dir, 'AGENTS.md');
  try {
    fs.writeFileSync(alvo, ''); aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core'));
    fs.writeFileSync(alvo, fs.readFileSync(alvo, 'utf8').replace(/\n$/, ''));
    aplicarExperiencia(planejarExperiencia(dir, 'codex', null));
    assert.equal(fs.readFileSync(alvo, 'utf8'), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recibo órfão de arquivo apagado ou bloco tirado à mão não trava instalação nem remoção', () => {
  const dir = fixture(), alvo = path.join(dir, 'CLAUDE.md'), recibo = path.join(dir, '.orkastery', 'experiencia', 'claude-code.json');
  try {
    aplicarExperiencia(planejarExperiencia(dir, 'claude-code', 'skills/core')); fs.unlinkSync(alvo);
    const remover = planejarExperiencia(dir, 'claude-code', null);
    assert.deepEqual(remover.mudancas.map(m => m.arquivo), [recibo]); aplicarExperiencia(remover);
    assert.equal(fs.existsSync(recibo), false);
    fs.writeFileSync(alvo, '# Sem bloco\n'); aplicarExperiencia(planejarExperiencia(dir, 'claude-code', 'skills/core'));
    fs.writeFileSync(alvo, '# Sem bloco\n');
    aplicarExperiencia(planejarExperiencia(dir, 'claude-code', 'skills/core'));
    assert.equal(fs.readFileSync(alvo, 'utf8').split(INICIO_EXPERIENCIA).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arquivo de instruções criado pelo pacote segue o umask, não 0600', () => {
  const dir = fixture(), alvo = path.join(dir, 'AGENTS.md'), mascara = process.umask();
  try {
    aplicarExperiencia(planejarExperiencia(dir, 'codex', 'skills/core'));
    assert.equal(fs.statSync(alvo).mode & 0o777, 0o666 & ~mascara);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { instalarAdaptador, desinstalarExperiencia, textoDaInstalacao, Host } from '../src/hosts';
import { gravarEtapa } from '../src/onboarding';
import { INICIO_EXPERIENCIA, planejarExperiencia } from '../src/experiencia-instalacao';
import { projetoTemporario } from './apoio';
const catalogo = path.resolve(__dirname, '../../..');

/** Catálogo sintético e projeto sem Git: estes casos não precisam de subprocessos. */
function fixtureCompatibilidade(host: Host, nome: string, idioma: string, skills: string[]) {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-experiencia-compat-')));
  const projeto = path.join(raiz, nome), catalogo = path.join(raiz, 'catalogo');
  fs.mkdirSync(projeto);
  fs.writeFileSync(path.join(projeto, 'orkastery.yaml'),
    `project:\n  name: exemplo\n  abbrev: ex\nowner:\n  language: ${idioma}\n  experience: true\n`);
  const adaptador = path.join(catalogo, 'adapters', host);
  fs.mkdirSync(adaptador, { recursive: true });
  fs.writeFileSync(path.join(adaptador, 'entrada.md'), '# Adaptador preservado\n');
  for (const skill of skills) {
    const dir = path.join(catalogo, 'skills', 'core', skill);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Skill sintética\n');
  }
  return { opts: { projeto, catalogo, orkBin: 'ork', dir: 'integracao' },
    limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('catálogo antigo ou parcial pula o pacote com aviso e instala o restante do adaptador', () => {
  for (const host of ['codex', 'claude-code', 'hermes'] as const) {
    for (const parcial of [false, true]) {
      const f = fixtureCompatibilidade(host, 'projeto', parcial ? 'pt-BR' : 'en-US',
        parcial ? ['orchestration-experience'] : []);
      try {
        const alvos = ['AGENTS.md', 'CLAUDE.md'].map(a => path.join(f.opts.projeto, a));
        for (const alvo of alvos) fs.writeFileSync(alvo, '# Instruções preservadas\n');
        const dry = instalarAdaptador(host, { ...f.opts, dryRun: true });
        assert.equal(dry.ok, true); assert.equal(dry.experiencia?.ativa, false);
        assert.match(textoDaInstalacao(dry), /Aviso: Pacote de experiência pulado: a skill .* não está no catálogo/);
        assert.equal(fs.existsSync(dry.destino), false);
        const r = instalarAdaptador(host, f.opts);
        assert.equal(r.ok, true); assert.equal(r.experiencia?.ativa, false);
        assert.match(textoDaInstalacao(r), /O restante da instalação do adaptador segue normalmente/);
        assert.equal(fs.readFileSync(path.join(r.destino, 'entrada.md'), 'utf8'), '# Adaptador preservado\n');
        assert.ok(fs.existsSync(path.join(r.destino, 'INSTALADO.json')));
        for (const alvo of alvos) assert.equal(fs.readFileSync(alvo, 'utf8'), '# Instruções preservadas\n');
        assert.equal(fs.existsSync(path.join(f.opts.projeto, '.orkastery', 'experiencia')), false);
      } finally { f.limpar(); }
    }
  }
});

test('caminho incompatível com o bloco pula apenas o pacote, com aviso, sem afrouxar o planejador', () => {
  for (const host of ['codex', 'claude-code'] as const) {
    for (const caractere of ['\n', '\r', '`']) {
      const f = fixtureCompatibilidade(host, 'projeto-' + caractere, 'pt-BR', ['orchestration-experience-pt-br']);
      try {
        const r = instalarAdaptador(host, f.opts);
        assert.equal(r.ok, true); assert.equal(r.experiencia?.ativa, false);
        assert.match(textoDaInstalacao(r), /Aviso: Pacote de experiência pulado: o caminho das skills/);
        assert.equal(fs.readFileSync(path.join(r.destino, 'entrada.md'), 'utf8'), '# Adaptador preservado\n');
        assert.equal(fs.existsSync(path.join(f.opts.projeto, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md')), false);
        assert.equal(fs.existsSync(path.join(f.opts.projeto, '.orkastery', 'experiencia')), false);
        assert.throws(() => planejarExperiencia(f.opts.projeto, host, path.join(r.destino, 'skills', 'core')),
          /experiencia.skill.invalid/);
      } finally { f.limpar(); }
    }
  }
});

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

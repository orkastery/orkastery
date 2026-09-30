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
      const f = fixtureCompatibilidade(host, 'projeto', 'pt-BR', ['orchestration-experience-pt-br']);
      try {
        const opts = { ...f.opts, dir: 'integracao' + caractere };
        const r = instalarAdaptador(host, opts);
        assert.equal(r.ok, true); assert.equal(r.experiencia?.ativa, false);
        assert.match(textoDaInstalacao(r), /Aviso: Pacote de experiência pulado: o caminho das skills/);
        assert.equal(fs.readFileSync(path.join(r.destino, 'entrada.md'), 'utf8'), '# Adaptador preservado\n');
        assert.equal(fs.existsSync(path.join(f.opts.projeto, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md')), false);
        assert.equal(fs.existsSync(path.join(f.opts.projeto, '.orkastery', 'experiencia')), false);
        assert.throws(() => planejarExperiencia(f.opts.projeto, host, path.relative(f.opts.projeto, path.join(r.destino, 'skills', 'core'))),
          /experiencia.skill.invalid/);
      } finally { f.limpar(); }
    }
  }
});

test('manifesto com erro pula só o pacote, com aviso, e o adaptador instala como antes', () => {
  const f = fixtureCompatibilidade('codex', 'projeto', 'en-US', ['orchestration-experience']);
  try {
    fs.writeFileSync(path.join(f.opts.projeto, 'orkastery.yaml'), 'project: [\n');
    fs.writeFileSync(path.join(f.opts.projeto, 'AGENTS.md'), '# Preservado\n');
    const r = instalarAdaptador('codex', f.opts);
    assert.equal(r.ok, true); assert.match(textoDaInstalacao(r), /o manifesto tem erros/);
    assert.equal(fs.readFileSync(path.join(f.opts.projeto, 'AGENTS.md'), 'utf8'), '# Preservado\n');
    assert.ok(fs.existsSync(path.join(r.destino, 'INSTALADO.json')));
  } finally { f.limpar(); }
});

test('adaptador fora do projeto pula o bloco, que só aponta caminhos relativos ao projeto', () => {
  const f = fixtureCompatibilidade('codex', 'projeto', 'en-US', ['orchestration-experience']);
  try {
    const r = instalarAdaptador('codex', { ...f.opts, dir: '../fora' });
    assert.equal(r.ok, true); assert.equal(r.experiencia?.ativa, false);
    assert.match(textoDaInstalacao(r), /o adaptador fica fora do projeto/);
    assert.equal(fs.existsSync(path.join(f.opts.projeto, 'AGENTS.md')), false);
    assert.ok(fs.existsSync(path.join(r.destino, 'INSTALADO.json')));
  } finally { f.limpar(); }
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
      assert.ok(ativo.includes(INICIO_EXPERIENCIA));
      // Caminho relativo: o arquivo de instruções vai ao repositório e vale em outra máquina.
      assert.ok(ativo.includes(JSON.stringify(path.relative(p.dir, path.join(r.destino, 'skills', 'core')))));
      assert.ok(!ativo.includes(p.dir), 'sem caminho absoluto da máquina');
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

test('bloco adulterado ou link no arquivo de instruções pulam só o pacote e preservam os bytes', () => {
  const p = projetoTemporario('adapter-experiencia-conflito');
  try {
    const alvo = path.join(p.dir, 'AGENTS.md'); fs.writeFileSync(alvo, INICIO_EXPERIENCIA);
    const opts = { projeto: p.dir, catalogo, orkBin: 'ork' };
    const r = instalarAdaptador('codex', opts);
    assert.equal(r.ok, true); assert.equal(r.experiencia?.ativa, false);
    assert.match(textoDaInstalacao(r), /bloco de instruções foi editado ou está duplicado; nada foi escrito nele/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), INICIO_EXPERIENCIA);
    assert.ok(fs.existsSync(path.join(r.destino, 'INSTALADO.json')), 'o adaptador segue instalado');
    assert.equal(fs.existsSync(path.join(p.dir, '.orkastery', 'experiencia')), false);
    assert.throws(() => desinstalarExperiencia(p.dir, 'codex'), /conflict/);
    // CLAUDE.md como link para AGENTS.md é comum: o pacote não escreve através do link.
    fs.writeFileSync(alvo, '# Instruções comuns\n'); fs.symlinkSync('AGENTS.md', path.join(p.dir, 'CLAUDE.md'));
    const c = instalarAdaptador('claude-code', opts);
    assert.equal(c.ok, true); assert.match(textoDaInstalacao(c), /arquivo de instruções é link/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), '# Instruções comuns\n');
  } finally { p.limpar(); }
});

test('clone novo sem recibo adota o bloco íntegro, reinstala sem duplicar e remove com o arquivo de antes', () => {
  const p = projetoTemporario('adapter-experiencia-clone');
  try {
    const alvo = path.join(p.dir, 'AGENTS.md'), original = '# Instruções versionadas\n';
    fs.writeFileSync(alvo, original);
    const opts = { projeto: p.dir, catalogo, orkBin: 'ork' };
    gravarEtapa(p.dir, 'maestro', { owner: { language: 'en-US', experience: true } });
    instalarAdaptador('codex', opts); const ativo = fs.readFileSync(alvo, 'utf8');
    fs.rmSync(path.join(p.dir, '.orkastery', 'experiencia'), { recursive: true });
    const r = instalarAdaptador('codex', opts);
    assert.equal(r.experiencia?.ativa, true); assert.equal(r.experiencia?.aviso, undefined);
    assert.equal(fs.readFileSync(alvo, 'utf8'), ativo, 'sem bloco duplicado');
    fs.rmSync(path.join(p.dir, '.orkastery', 'experiencia'), { recursive: true });
    assert.deepEqual(desinstalarExperiencia(p.dir, 'codex').arquivos, ['AGENTS.md']);
    assert.equal(fs.readFileSync(alvo, 'utf8'), original);
  } finally { p.limpar(); }
});

test('link acima do destino do adaptador é escolha de quem instala; link dentro dele recusa', () => {
  const p = projetoTemporario('adapter-experiencia-link');
  try {
    const opts = { projeto: p.dir, catalogo, orkBin: 'ork' };
    fs.mkdirSync(path.join(p.dir, 'compartilhado'));
    fs.symlinkSync(path.join(p.dir, 'compartilhado'), path.join(p.dir, '.agents'));
    assert.equal(instalarAdaptador('codex', { ...opts, dryRun: true }).ok, true, '.agents compartilhado por link segue aceito');
    fs.unlinkSync(path.join(p.dir, '.agents'));
    const destino = path.join(p.dir, '.agents', 'skills', 'orkastery'), externo = path.join(p.dir, 'externo.json');
    fs.mkdirSync(destino, { recursive: true }); fs.writeFileSync(externo, 'preservado');
    fs.symlinkSync(externo, path.join(destino, 'INSTALADO.json'));
    assert.throws(() => instalarAdaptador('codex', opts), /unsafe/);
    assert.equal(fs.readFileSync(externo, 'utf8'), 'preservado');
  } finally { p.limpar(); }
});

#!/usr/bin/env node
'use strict';
/** Ensaio real reservado à condutora: tarball local, prefixo e HOME temporários. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function ambienteIsolado(base, anterior = process.env) {
  return {
    // O ork do tarball vem antes no PATH: o adaptador grava o binário que o ensaio instalou.
    PATH: [path.join(base, 'prefixo', 'node_modules', '.bin'), anterior.PATH].filter(Boolean).join(path.delimiter),
    LANG: 'C.UTF-8', TZ: 'UTC',
    HOME: path.join(base, 'home'), XDG_CONFIG_HOME: path.join(base, 'home', 'config'),
    npm_config_cache: anterior.npm_config_cache || path.join(os.homedir(), '.npm'),
    ORK_USUARIO_DIR: path.join(base, 'usuario'), ORK_CONTAS_DIR: path.join(base, 'contas'),
    ORK_FABRICA_PUBLICAR: '0',
  };
}
function comandosDistribuicao(raiz, base, tarball) {
  const prefixo = path.join(base, 'prefixo');
  return {
    pack: { bin: 'npm', args: ['pack', '--offline', '--pack-destination', base], cwd: path.join(raiz, 'core') },
    install: { bin: 'npm', args: ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefixo, tarball], cwd: base },
    binario: path.join(prefixo, 'node_modules', '.bin', 'ork'),
  };
}
function executar(bin, args, cwd, env) {
  const r = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.signal || r.status !== 0) throw Error(`ensaio.comando.falhou: ${path.basename(bin)} ${args[0]} (${r.error?.code || r.signal || r.status}); ${r.stderr || ''}`);
  return r.stdout;
}
function conferirBytes(arquivo, esperado) {
  if (esperado === null) assert.equal(fs.existsSync(arquivo), false, 'arquivo originalmente ausente deve continuar ausente');
  else assert.deepEqual(fs.readFileSync(arquivo), esperado, 'restauração deve preservar bytes');
}
function conferirBloco(arquivo, proibido) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  assert.equal(texto.split('<!-- orkastery:experiencia:begin -->').length - 1, 1, 'um único bloco ativo');
  assert.equal(texto.split('<!-- orkastery:experiencia:end -->').length - 1, 1);
  if (proibido) assert.ok(!texto.includes(proibido), 'bloco sem caminho absoluto da máquina');
  return texto;
}
function executarEnsaio(raiz = path.resolve(__dirname, '../..')) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-experiencia-e2e-')));
  const env = ambienteIsolado(base), projeto = path.join(base, 'projeto');
  try {
    fs.mkdirSync(env.HOME, { recursive: true }); fs.mkdirSync(projeto);
    const pack = comandosDistribuicao(raiz, base, '').pack;
    executar(pack.bin, pack.args, pack.cwd, env);
    const pacotes = fs.readdirSync(base).filter(n => n.endsWith('.tgz'));
    assert.equal(pacotes.length, 1, 'um tarball local');
    const plano = comandosDistribuicao(raiz, base, path.join(base, pacotes[0]));
    executar(plano.install.bin, plano.install.args, plano.install.cwd, env);
    const cli = (...args) => executar(plano.binario, args, projeto, env);
    cli('init');
    const configurar = owner => cli('onboarding', 'set', 'maestro', '--conteudo', JSON.stringify({ owner }), '--por', 'ensaio');
    const originais = [null, Buffer.from('instruções\n'), Buffer.from('instruções\r\n'), Buffer.from('sem newline')];
    for (const host of ['codex', 'claude-code']) {
      const arquivo = path.join(projeto, host === 'codex' ? 'AGENTS.md' : 'CLAUDE.md');
      for (const original of originais) {
        if (original === null) fs.rmSync(arquivo, { force: true }); else fs.writeFileSync(arquivo, original);
        configurar({ experience: true, language: 'pt-BR', timezone: 'UTC', depth: 'curta' });
        cli('adapter', 'install', host, '--dry-run'); conferirBytes(arquivo, original);
        cli('adapter', 'install', host); const ativo = conferirBloco(arquivo, base);
        cli('adapter', 'install', host); assert.equal(conferirBloco(arquivo), ativo);
        // Clone novo: o arquivo de instruções versionado chega sem o recibo de .orkastery/. Sem ele
        // a quebra final original é desconhecida; o recibo volta para a prova byte a byte seguir.
        const recibo = path.join(projeto, '.orkastery', 'experiencia', host + '.json'), guardado = fs.readFileSync(recibo);
        fs.rmSync(recibo); cli('adapter', 'install', host); assert.equal(conferirBloco(arquivo), ativo);
        fs.writeFileSync(recibo, guardado);
        // Cada CLI é processo novo: preferências e descoberta não dependem de memória da sessão.
        const p = JSON.parse(cli('experiencia', 'show', '--json'));
        assert.equal(p.skill, 'orchestration-experience-pt-br'); assert.equal(p.timezone, 'UTC');
        const catalogo = host === 'codex' ? '.agents/skills/orkastery' : '.claude/plugins/orkastery';
        for (const skill of ['orchestration-experience', 'orchestration-experience-pt-br']) {
          assert.ok(fs.existsSync(path.join(projeto, catalogo, 'skills/core', skill, 'SKILL.md')));
        }
        cli('experiencia', 'uninstall', host, '--dry-run'); assert.equal(conferirBloco(arquivo), ativo);
        cli('experiencia', 'uninstall', host); conferirBytes(arquivo, original);
        cli('adapter', 'install', host); configurar({ experience: false });
        cli('adapter', 'install', host); conferirBytes(arquivo, original);
        assert.equal(JSON.parse(cli('experiencia', 'show', '--json')).experience, false);
      }
      configurar({ experience: true, language: 'en-US', depth: 'detalhada' });
      const antes = fs.readFileSync(arquivo); cli('adapter', 'install', host);
      fs.appendFileSync(arquivo, 'mudança externa\n'); cli('experiencia', 'uninstall', host);
      // A linha externa não se funde à última linha original, que não tinha quebra.
      const juncao = antes.length && antes.at(-1) !== 10 ? '\n' : '';
      conferirBytes(arquivo, Buffer.concat([antes, Buffer.from(juncao + 'mudança externa\n')]));
    }
    cli('adapter', 'install', 'hermes');
    for (const skill of ['orchestration-experience', 'orchestration-experience-pt-br']) {
      assert.ok(fs.existsSync(path.join(projeto, '.hermes/skills', skill, 'SKILL.md')));
    }
    assert.equal(JSON.parse(cli('experiencia', 'show', '--json')).skill, 'orchestration-experience');
    return { ok: true, origem: 'tarball-local-instalado', hosts: ['codex', 'claude-code', 'hermes'], instalacaoReal: true };
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
module.exports = { ambienteIsolado, comandosDistribuicao, conferirBytes, conferirBloco, executarEnsaio };
if (require.main === module) {
  try { console.log(JSON.stringify(executarEnsaio(), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}

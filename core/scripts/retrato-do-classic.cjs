#!/usr/bin/env node
/**
 * RM-072 (D2 do dono, item 7; T2 da ork-check5x): o retrato do Classic Check de uma arvore compilada.
 *
 * O Classic Check e o CHECK de sempre: mesmos comandos, mesma ordem, mesmas ferramentas. Este script monta, para a arvore
 * `core/` que receber (compilada: `dist` e `dist-test`), a lista do que o Classic executa:
 *
 *   1. verify: os comandos que o `verificar` roda num projeto de fixture (preparo de dois passos, uma claim que comeca
 *      pelos passos do preparo, outra de um comando so, typecheck, build, test e security_scan), pelo executor que so
 *      registra nome e comando;
 *   2. scan: as chamadas ao Docker que o `ork security-scan` da arvore faz, pelo falso Docker dos testes, num repositorio
 *      de fixture com base e HEAD (as 9 ferramentas da stack js), com nome de container, pasta temporaria, uid, caminho da
 *      arvore e sha trocados por marcadores.
 *
 * O retrato da base (`b16c5be8`) foi gerado sobre a arvore da base compilada numa worktree descartavel e mora em
 * `test/fixtures/classic-retrato-b16c5be8.json`; o teste `check-classic-intacto` compara o do HEAD com ele. Na arvore que
 * conhece o modo, o verify roda com `check: 'classic'` e o scan com `ORK_CHECK_MODO=classic`; a base ignora os dois.
 *
 *   node scripts/retrato-do-classic.cjs [--arvore <dir core>] [--modo classic|agile] [--so verify|scan] [--saida <arquivo.json>]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function opcoes(argv) {
  const o = { arvore: path.resolve(__dirname, '..'), modo: 'classic', so: null, saida: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arvore') o.arvore = path.resolve(argv[++i]);
    else if (argv[i] === '--modo') o.modo = argv[++i];
    else if (argv[i] === '--saida') o.saida = path.resolve(argv[++i]);
    else if (argv[i] === '--so' && ['verify', 'scan'].includes(argv[i + 1])) o.so = argv[++i];
    else throw new Error(`uso: retrato-do-classic.cjs [--arvore <dir core>] [--modo classic|agile] [--so verify|scan] [--saida <arquivo>]`);
  }
  return o;
}

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A lista do verify: o executor so registra; todo comando "passa" em 1 ms. */
function retratoDoVerify(arvore, modo) {
  const apoio = require(path.join(arvore, 'dist-test', 'test', 'apoio.js'));
  const { novaThread } = require(path.join(arvore, 'dist-test', 'src', 'thread.js'));
  const { adicionarClaim } = require(path.join(arvore, 'dist-test', 'src', 'claims.js'));
  const { verificar } = require(path.join(arvore, 'dist-test', 'src', 'verify.js'));
  const p = apoio.projetoTemporario('retrato-classic');
  try {
    apoio.ajustarManifesto(p, '  # typecheck: nao detectado', '  typecheck: "echo typecheck"');
    apoio.ajustarManifesto(p, '  # build: nao detectado', '  build: "echo preparo-a"');
    apoio.ajustarManifesto(p, '  # test: nao detectado', '  test: "echo test"\n  security_scan: "echo scan"\n' +
      '  preparo: "echo preparo-a && echo preparo-b"');
    const { thread } = novaThread(p.carregado, { nome: 'retrato', modo: 'auto' });
    adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'com o preparo na frente',
      verificar: ['echo preparo-a && echo preparo-b && echo c1', 'echo c1b'] });
    adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'de um comando so', verificar: ['echo c2'] });
    const lista = [];
    const executor = (nome, comando) => {
      lista.push([nome, comando]);
      return { nome, comando, ok: true, code: 0, resumo: '', causa: 'exit', prazoMs: 1000, duracaoMs: 1, executado: true };
    };
    verificar(p.carregado, thread.id, { executor, check: modo });
    return lista;
  } finally { p.limpar(); }
}

/** A lista do scan: o `ork security-scan` da arvore, pelo falso Docker, com base e HEAD. */
function retratoDoScan(arvore, modo) {
  const { installFakeTools } = require(path.join(arvore, 'dist-test', 'test', 'security-scan-docker-falso.js'));
  const fixture = path.resolve(arvore, '..', 'eval', 'fixtures', 'security-scan', 'js');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-retrato-scan-')));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const fake = installFakeTools(['docker']);
  try {
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'package.json'), '{ "name": "clean-js", "version": "1.0.0", "private": true, "license": "MIT" }\n');
    fs.writeFileSync(path.join(repo, 'package-lock.json'), '{ "name": "clean-js", "version": "1.0.0", "lockfileVersion": 3, ' +
      '"requires": true, "packages": { "": { "name": "clean-js", "version": "1.0.0" } } }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', '-b', 'feat');
    fs.cpSync(fixture, repo, { recursive: true });
    fs.writeFileSync(path.join(repo, '.fake-case'), 'js\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'head');
    const head = git(repo, 'rev-parse', 'HEAD');
    const casa = path.join(tmp, 'casa');
    const cache = path.join(tmp, 'cache');
    fs.mkdirSync(casa);
    fs.mkdirSync(cache);
    const env = { ...process.env, ORKASTERY_HOME: casa, XDG_CACHE_HOME: cache, ORK_CHECK_MODO: modo, ORK_LOCALE: 'pt-BR' };
    delete env.ORK_CHECK_RELATORIO;
    // O retrato simula uma rodada Classic propria; o plano do Agile que roda os testes nao faz parte do seu argv.
    delete env.ORK_CHECK_CPUS_DA_LANE;
    delete env.ORK_CHECK_CPUS_DOCKER;
    const cli = path.join(arvore, 'dist', 'index.js');
    const init = spawnSync(process.execPath, [cli, 'init', '--name', 'retrato', '--abbrev', 'ret'], { cwd: repo, env, encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`ork init: ${init.stderr}`);
    const scan = spawnSync(process.execPath, [cli, 'security-scan', '--base', base], { cwd: repo, env, encoding: 'utf8' });
    if (scan.status !== 0 && scan.status !== 1) throw new Error(`ork security-scan saiu ${scan.status}: ${scan.stderr}`);
    const uid = `${process.getuid?.() ?? 65534}:${process.getgid?.() ?? 65534}`;
    const arvores = new Map();
    const marcar = (texto) => texto
      .replace(/ork-security-scan-([a-z-]+?)-[0-9a-f]{12}\b/g, 'ork-security-scan-$1-<N>')
      .replace(new RegExp(`${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/ork-security-scan-tree-[A-Za-z0-9]+/tree`, 'g'), (m) => {
        if (!arvores.has(m)) arvores.set(m, `<ARVORE-${arvores.size + 1}>`);
        return arvores.get(m);
      })
      .replace(new RegExp(`${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/ork-security-scan-out-[A-Za-z0-9]+`, 'g'), '<SAIDA>')
      .split(repo).join('<REPO>')
      .split(path.join(arvore, 'assets')).join('<ASSETS>')
      .split(base).join('<BASE>')
      .split(head).join('<HEAD>')
      .split(uid).join('<UID>');
    return fake.calls().map((c) => [c.as, ...c.args.map(marcar)]);
  } finally {
    fake.restore();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function retrato(arvore, modo, so = null) {
  return { contrato: 'ork.retrato-do-classic/v1', modo, ...(so !== 'scan' ? { verify: retratoDoVerify(arvore, modo) } : {}),
    ...(so !== 'verify' ? { scan: retratoDoScan(arvore, modo) } : {}) };
}

module.exports = { retrato };

if (require.main === module) {
  const o = opcoes(process.argv.slice(2));
  const r = retrato(o.arvore, o.modo, o.so);
  const texto = JSON.stringify(r, null, 1) + '\n';
  if (o.saida) fs.writeFileSync(o.saida, texto);
  else process.stdout.write(texto);
}

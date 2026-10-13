/**
 * RM-063 (fatia 3, achado b): provas e testes que rodam o `ork` registraram projetos de `/tmp` e da pasta dos jobs do
 * Claude Code no `~/.orkastery/projetos.json` real. O registro automatico nao grava projeto efemero num registro
 * duravel, a casa do ork segue `ORKASTERY_HOME`, e a suite roda com uma casa temporaria.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { pastaDoUsuario } from '../src/maquina';
import { caminhoDoRegistro, diretorioEfemero, lerRegistroDeProjetos, registrarProjetoEmSilencio } from '../src/projeto-alvo';

test('achado b: pasta temporaria e pasta de job do Claude Code sao efemeras; a do projeto de verdade nao', () => {
  assert.equal(diretorioEfemero(path.join(os.tmpdir(), 'ork-projeto-x')), true);
  assert.equal(diretorioEfemero('/tmp/qualquer/coisa'), true);
  assert.equal(diretorioEfemero('/var/tmp/projeto'), true);
  assert.equal(diretorioEfemero(path.join(os.homedir(), '.claude-b', 'jobs', '6271b65e', 'tmp', 'prova')), true);
  assert.equal(diretorioEfemero(path.join(os.homedir(), '.claude', 'jobs', 'abc')), true);
  assert.equal(diretorioEfemero('/srv/repos/orkastery'), false);
  assert.equal(diretorioEfemero(path.join(os.homedir(), 'orkastery')), false);
});

test('achado b: o registro automatico nao grava projeto efemero no registro duravel, e grava no efemero', () => {
  const p = projetoTemporario('rm063-f3-registro');
  try {
    // A suite inteira roda numa casa temporaria; o registro "duravel" da prova e o que a funcao de efemero diz que nao e.
    const casa = pastaDoUsuario();
    const soOProjeto = (caminho: string) => path.resolve(caminho).startsWith(p.dir);
    const aviso = registrarProjetoEmSilencio(p.dir, 'thread new', { efemero: soOProjeto });
    assert.match(aviso ?? '', /projeto em pasta temporária .* não entra no registro desta máquina/);
    assert.match(aviso ?? '', /ork projetos registrar /, 'o aviso diz como registrar de proposito');
    assert.deepEqual(lerRegistroDeProjetos().projetos.map((x) => x.raiz), [], `gravou em ${caminhoDoRegistro()}`);
    // Com o registro tambem efemero (a casa dos testes), o projeto de /tmp entra: e o que os testes do registro provam.
    assert.equal(registrarProjetoEmSilencio(p.dir, 'thread new'), null);
    assert.equal(diretorioEfemero(casa), true, 'a casa dos testes deveria ser temporaria');
    assert.deepEqual(lerRegistroDeProjetos().projetos.map((x) => x.raiz), [fs.realpathSync(p.dir)]);
  } finally { p.limpar(); }
});

test('achado b: a casa do ork segue ORKASTERY_HOME, e o npm test roda com uma casa temporaria', () => {
  const antes = { usuario: process.env.ORK_USUARIO_DIR, casa: process.env.ORKASTERY_HOME };
  try {
    delete process.env.ORK_USUARIO_DIR;
    process.env.ORKASTERY_HOME = '/caminho/da/casa';
    assert.equal(pastaDoUsuario(), '/caminho/da/casa');
    process.env.ORK_USUARIO_DIR = '/caminho/do/usuario';
    assert.equal(pastaDoUsuario(), '/caminho/do/usuario', 'ORK_USUARIO_DIR continua vencendo');
  } finally {
    for (const [k, v] of [['ORK_USUARIO_DIR', antes.usuario], ['ORKASTERY_HOME', antes.casa]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  const pacote = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pacote.scripts.test, /node scripts\/casa-temporaria\.cjs node --test /);
  const script = path.resolve(__dirname, '../../scripts/casa-temporaria.cjs');
  const env = { ...process.env };
  delete env.ORKASTERY_HOME;
  const r = spawnSync(process.execPath, [script, process.execPath, '-e', 'process.stdout.write(process.env.ORKASTERY_HOME || "")'],
    { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(diretorioEfemero(r.stdout) && path.basename(r.stdout).startsWith('ork-casa-'), r.stdout);
  assert.equal(fs.existsSync(r.stdout), false, 'a casa temporaria some no fim');
  const propria = spawnSync(process.execPath, [script, process.execPath, '-e', 'process.stdout.write(process.env.ORKASTERY_HOME || "")'],
    { encoding: 'utf8', env: { ...env, ORKASTERY_HOME: '/casa/escolhida' } });
  assert.equal(propria.stdout, '/casa/escolhida', 'quem exporta a propria casa e respeitado');
});

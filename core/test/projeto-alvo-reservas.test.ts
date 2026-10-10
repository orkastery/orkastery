/**
 * RM-052 (fatia 2, L2): `ork roadmap reservas` diz qual projeto leu e nunca diz "nenhum" sem ter lido.
 *
 * Na fatia 1, num projeto sem remoto, o comando imprimia "AVISO: sem acesso ao remoto; esta e a ultima
 * copia lida nesta maquina." e "Nenhum item do roadmap reservado.", sem dizer de qual projeto: a forma
 * do incidente de 29/09, em que 13 itens reservados viraram "roadmap vazio". Agora o texto abre com o
 * cabecalho `ork.consulta/v1` e separa lido agora, ultima copia local, remoto mudo sem copia e projeto
 * sem remoto; o JSON ganha `consulta` e `leitura`. Os testes de "sem remoto" e "sem copia" reprovam o
 * codigo da fatia 1.
 */
import { strict as assert } from 'node:assert';
import { test, TestContext } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { registrarProjeto } from '../src/projeto-alvo';
import { listarReservas, pegarItem } from '../src/roadmap-reservas';
import { exec } from '../src/util';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const NADA_LIDO = /nada foi lido/;
const NENHUM = /Nenhum item do roadmap reservado/;

function ork(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

type Saida = { leitura: string; reservas: unknown[]; consulta: { contrato: string; projeto: { nome: string; origem: string }; lido: string[]; naoLido: string[] } };

function json(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Saida {
  const r = ork(cwd, [...args, '--json'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout) as Saida;
}

function projeto(t: TestContext, nome: string, comRemoto = false) {
  const p = projetoTemporario(nome, comRemoto);
  t.after(() => p.limpar());
  return p;
}

test('L2: sem o remoto, o texto diz o projeto e que nada foi lido, nunca "nenhum item reservado"', (t) => {
  const p = projeto(t, 'reservas-sem-remoto');
  const r = ork(p.dir, ['roadmap', 'reservas']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Projeto consultado: orkastery \(ork\) · .* · sem remoto · pelo diretório atual$/m);
  assert.match(r.stdout, /Reservas do roadmap: o projeto orkastery não tem o remoto origin; nada foi lido de ork\/roadmap-reservas\./);
  assert.doesNotMatch(r.stdout, NENHUM);
  assert.doesNotMatch(r.stdout, /ultima copia lida/);
  const j = json(p.dir, ['roadmap', 'reservas']);
  assert.equal(j.leitura, 'sem-remoto');
  assert.deepEqual(j.reservas, []);
  assert.equal(j.consulta.contrato, 'ork.consulta/v1');
  assert.deepEqual(j.consulta.lido, []);
  assert.ok(j.consulta.naoLido.some((l) => /nada foi lido de ork\/roadmap-reservas/.test(l)), j.consulta.naoLido.join(' | '));
  // O `ork roadmap` sem subcomando e o mesmo `reservas`.
  assert.match(ork(p.dir, ['roadmap']).stdout, NADA_LIDO);
});

test('L2: a cena de 29/09, pelo host: o gateway noutro projeto pede o orkastery sem remoto', (t) => {
  const orkastery = projeto(t, 'reservas-incidente-orkastery');
  const workspace = projeto(t, 'reservas-incidente-workspace');
  init(workspace.dir, { nome: 'workspace', abbrev: 'wor', force: true });
  workspace.carregado = exigirManifesto(workspace.dir);
  const usuario = dirTemporario('reservas-incidente-usuario');
  t.after(() => fs.rmSync(usuario, { recursive: true, force: true }));
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  t.after(() => { if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior; });
  registrarProjeto(orkastery.dir, 'fabrica entrar');
  registrarProjeto(workspace.dir, 'init');
  const r = ork(workspace.dir, ['--projeto', 'orkastery', 'roadmap', 'reservas'], { ORK_USUARIO_DIR: usuario, ORK_PROJETO_EXPLICITO: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Projeto consultado: orkastery \(ork\) .* pela opção --projeto$/m);
  assert.match(r.stdout, NADA_LIDO);
  assert.doesNotMatch(r.stdout + r.stderr, NENHUM);
  assert.doesNotMatch(r.stdout + r.stderr, /workspace \(wor\)/);
});

test('L2: com o remoto mudo e sem cópia local, nada foi lido; com cópia, o aviso e a lista seguem', (t) => {
  const mudo = projeto(t, 'reservas-remoto-mudo');
  exec('git', ['remote', 'add', 'origin', path.join(dirTemporario('reservas-sem-servidor'), 'nao-existe.git')], mudo.dir);
  const r = ork(mudo.dir, ['roadmap', 'reservas']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Reservas do roadmap: o remoto origin não respondeu e esta máquina não tem cópia de ork\/roadmap-reservas; nada foi lido\./);
  assert.doesNotMatch(r.stdout, NENHUM);
  assert.equal(json(mudo.dir, ['roadmap', 'reservas']).leitura, 'sem-copia');

  // A copia local: lida uma vez com o remoto no ar, depois o remoto some.
  const p = projeto(t, 'reservas-copia-local', true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  assert.equal(pegarItem(p.dir, 'RM-001', { maquina: 'pc-a' }).acao, 'pegou');
  assert.equal(listarReservas(p.dir).atualizado, true);
  exec('git', ['remote', 'set-url', 'origin', path.join(dirTemporario('reservas-remoto-sumiu'), 'nao-existe.git')], p.dir);
  const copia = ork(p.dir, ['roadmap', 'reservas']);
  assert.equal(copia.status, 0, copia.stdout + copia.stderr);
  assert.match(copia.stdout, /AVISO: sem acesso ao remoto; esta e a ultima copia lida nesta maquina\./);
  assert.match(copia.stdout, /^RM-001 /m);
  const j = json(p.dir, ['roadmap', 'reservas']);
  assert.equal(j.leitura, 'copia-local');
  assert.equal(j.reservas.length, 1);
  assert.ok(j.consulta.lido.some((l) => /última cópia local/.test(l)), j.consulta.lido.join(' | '));
});

test('L2: com o remoto lido agora, a lista e o cabeçalho; vazio lido continua "nenhum item"', (t) => {
  const p = projeto(t, 'reservas-lidas', true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  const vazio = ork(p.dir, ['roadmap', 'reservas']);
  assert.equal(vazio.status, 0, vazio.stdout + vazio.stderr);
  assert.match(vazio.stdout, /^Projeto consultado: orkastery /m);
  assert.match(vazio.stdout, NENHUM, 'depois de ler o remoto, vazio e vazio');
  assert.equal(json(p.dir, ['roadmap', 'reservas']).leitura, 'lido-agora');

  assert.equal(pegarItem(p.dir, 'RM-001', { maquina: 'pc-a', nota: 'contrato primeiro' }).acao, 'pegou');
  const lista = ork(p.dir, ['roadmap', 'reservas']);
  assert.match(lista.stdout, /^RM-001 .*contrato primeiro/m);
  const j = json(p.dir, ['roadmap', 'reservas']);
  assert.equal(j.leitura, 'lido-agora');
  assert.equal(j.reservas.length, 1);
  assert.ok(j.consulta.lido.some((l) => /ork\/roadmap-reservas em origin, lido agora/.test(l)), j.consulta.lido.join(' | '));
});

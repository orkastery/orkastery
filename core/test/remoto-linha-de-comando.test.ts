/**
 * RM-047: o `--remoto` de `ork ship registrar-pr` e de `ork ci status` passa pelo mesmo validador
 * que a ork-rm047remotod pos em `branch-de-estado.ts`, antes de qualquer chamada ao git.
 *
 * Antes, `registrar-pr` passava o valor cru ao `git fetch` e ao `git ls-remote`, e `ci status` ao
 * `git remote get-url`: um valor que comece com `-` virava opcao do git, e uma URL escolhia o
 * transporte. No codigo anterior, estes testes reprovam: nenhum dos dois comandos recusava com
 * `<prefixo>.remoto-invalido`, e o `--remoto` ruim seguia para o git.
 *
 * Tudo e git de verdade, com remotos bare temporarios; nenhum teste toca o remoto do Orkastery.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { consultarCi } from '../src/ci';
import { registrarEntregaPorPr, registrarEntregasPorPr } from '../src/entrega-pr';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { ajustarManifesto, commitar, dirTemporario, projetoTemporario, ProjetoDeTeste, shaDaBranch } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function ork(dir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
}

/** Projeto com remoto bare, uma pasta fora dele para a marca e o ambiente sem publicacao da fabrica. */
function cenario(nome: string) {
  const p = projetoTemporario(nome, true);
  const fora = dirTemporario(`${nome}-fora`);
  const marca = path.join(fora, 'executou');
  const env = { ORK_USUARIO_DIR: path.join(fora, 'usuario'), ORK_MAQUINA: 'pc-teste', ORK_FABRICA_PUBLICAR: '0' };
  return { ...p, marca, env, limparTudo() { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); } };
}

/** Uma thread com o merge `ship(<thread>)` na main do remoto, como o GitHub faz no merge do PR. */
function entregaPorPr(p: ProjetoDeTeste, nome: string): string {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  exec('git', ['checkout', '-q', '-b', `ork/${thread.id}-full`], p.dir);
  commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  assert.equal(exec('git', ['merge', '--no-ff', '-q', '-m', `ship(${thread.id}): ${nome}`, `ork/${thread.id}-full`], p.dir).ok, true);
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
  return thread.id;
}

/** Valores que nunca podem chegar ao git. `M` e o caminho da marca. */
const maliciosos = (M: string): string[] => [
  `--upload-pack=touch ${M}`,
  `--receive-pack=touch ${M}`,
  '-c',
  `ext::sh -c touch% ${M}`,
  'file:///tmp/qualquer',
  'https://usuario:segredo@example.com/repo.git',
  'origin\nmais',
  'a..b',
  'origin.',
];

const RECUSA = (prefixo: string) =>
  new RegExp(`^${prefixo}\\.remoto-invalido: o remoto .* não é nome de remoto do git .*nada foi passado ao git\\.`, 's');

test('remoto da linha de comando: ork ship registrar-pr e ork ci status recusam --remoto que nao e nome de remoto', () => {
  const c = cenario('remoto-cli-registrar');
  try {
    const id = entregaPorPr(c, 'fatia');
    const sha = shaDaBranch(c.dir, 'main');
    for (const ruim of maliciosos(c.marca)) {
      for (const args of [['ship', 'registrar-pr', id], ['ship', 'registrar-pr', '--todas'], ['ship', 'registrar-pr', id, '--dry-run'],
        ['ci', 'status', '--sha', sha]]) {
        const r = ork(c.dir, [...args, `--remoto=${ruim}`], c.env);
        const prefixo = args[0] === 'ci' ? 'ci' : 'ship';
        assert.notEqual(r.status, 0, `${args.join(' ')} ${JSON.stringify(ruim)}: ${r.stdout}`);
        assert.match(r.stderr, new RegExp(`^erro: ${prefixo}\\.remoto-invalido: o remoto ".*" não é nome de remoto do git`, 'm'),
          `${args.join(' ')} ${JSON.stringify(ruim)}`);
      }
    }
    // `--remoto` sem valor nao vira `origin` em silencio.
    const vazio = ork(c.dir, ['ci', 'status', '--sha', sha, '--remoto'], c.env);
    assert.match(vazio.stderr, /^erro: ci\.remoto-invalido/m);
    assert.equal(fs.existsSync(c.marca), false, 'nenhum valor virou comando');
    assert.equal(lerLedger(dirThread(c.dir, id)).some((e) => e.tipo === 'ship_done'), false, 'nada foi registrado');
  } finally { c.limparTudo(); }
});

test('remoto da linha de comando: registrarEntregaPorPr, registrarEntregasPorPr e consultarCi recusam antes do git', () => {
  const c = cenario('remoto-api-registrar');
  try {
    const id = entregaPorPr(c, 'fatia');
    ajustarManifesto(c, 'required_for_ship: false', 'required_for_ship: true');
    c.carregado.manifesto.ci.required_for_ship = true;
    const sha = shaDaBranch(c.dir, 'main');
    let consultas = 0;
    const executor = () => { consultas++; return { ok: true, code: 0, stderr: '', stdout: '{"check_runs":[]}' }; };
    for (const ruim of maliciosos(c.marca)) {
      assert.throws(() => registrarEntregaPorPr(c.carregado, id, { remoto: ruim, executorCi: executor }),
        (e: Error) => RECUSA('ship').test(e.message), JSON.stringify(ruim));
      assert.throws(() => registrarEntregasPorPr(c.carregado, { remoto: ruim, executorCi: executor }),
        (e: Error) => RECUSA('ship').test(e.message), JSON.stringify(ruim));
      assert.throws(() => consultarCi(c.carregado, sha, ruim, executor), (e: Error) => RECUSA('ci').test(e.message), JSON.stringify(ruim));
    }
    assert.equal(consultas, 0, 'o GitHub nunca foi consultado');
    assert.equal(fs.existsSync(c.marca), false, 'nenhum valor virou comando');
    assert.equal(lerLedger(dirThread(c.dir, id)).some((e) => e.tipo === 'ship_done'), false);
  } finally { c.limparTudo(); }
});

test('remoto da linha de comando: nomes legitimos seguem (meu-remoto.2 no registrar-pr e no ci status)', () => {
  const c = cenario('remoto-cli-legitimo');
  try {
    const id = entregaPorPr(c, 'fatia');
    exec('git', ['remote', 'add', 'meu-remoto.2', c.remoto as string], c.dir);
    const ensaio = ork(c.dir, ['ship', 'registrar-pr', id, '--remoto', 'meu-remoto.2', '--dry-run'], c.env);
    assert.equal(ensaio.status, 0, ensaio.stderr);
    assert.match(ensaio.stdout, /registraria/);
    const r = registrarEntregaPorPr(c.carregado, id, { remoto: 'meu-remoto.2', publicar: false });
    assert.equal(r.acao, 'registrou', r.motivo);
    assert.equal(lerLedger(dirThread(c.dir, id)).find((e) => e.tipo === 'ship_done')?.remoto, 'meu-remoto.2');

    // ci status: com o gate desligado, o nome legitimo passa; com ele ligado, o `--` resolve o repositorio.
    const sha = shaDaBranch(c.dir, 'main');
    const status = ork(c.dir, ['ci', 'status', '--sha', sha, '--remoto', 'meu-remoto.2'], c.env);
    assert.equal(status.status, 0, status.stderr);
    exec('git', ['remote', 'add', 'Fork_1', 'https://github.com/Orkastery/orkastery.git'], c.dir);
    c.carregado.manifesto.ci.required_for_ship = true;
    const ci = consultarCi(c.carregado, sha, 'Fork_1', ({ repository }) => {
      assert.equal(repository, 'Orkastery/orkastery');
      return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ check_runs: [{ name: 'ork-verify', status: 'completed', conclusion: 'success' }] }) };
    });
    assert.equal(ci.ok, true, ci.detail);
  } finally { c.limparTudo(); }
});

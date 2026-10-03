/**
 * RM-047: o `--remoto` de `ork ship --para` passa pelo validador de `branch-de-estado.ts` antes de
 * qualquer chamada ao git, como ja passavam o manifesto (ork-rm047remotod), o `ship registrar-pr` e o
 * `ci status` (ork-rm047remoto2). E o nome de branch que vem de `--de` nunca vira opcao do git.
 *
 * Antes, com o gate de CI desligado, `ship()` passava o valor cru ao `git remote get-url` (e dali ao
 * `ls-remote` e ao push). O get-url falhava, o remoto contava como "nao configurado" e o ship entregava
 * com merge local e sem push provado. No codigo anterior estes testes reprovam: o ship nao recusava com
 * `ship.remoto-invalido`, o valor ruim aparecia nos argumentos do git, a `main` mudava, e o merge de uma
 * branch cujo nome comeca com `-` reprovava porque o nome virava opcao do `git merge`.
 *
 * Um git espiao no PATH grava os argumentos de cada chamada; o git de verdade faz o resto. Nenhum
 * teste toca o remoto do Orkastery.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lerLedger } from '../src/ledger';
import { lerPrsDaForja, repositorioDoRemoto } from '../src/parado-no-condutor';
import { remotoConfigurado, ship, shaNoRemoto } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { commitar, dirTemporario, projetoTemporario, shaDaBranch, shaNoRemotoDeTeste } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const GIT_REAL = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

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

const RECUSA = /^ship\.remoto-invalido: o remoto .* não é nome de remoto do git .*nada foi passado ao git\./s;

/** Um git no PATH que grava cada argumento (um por linha, chamadas separadas por `--fim--`) e chama o real. */
function espiao(nome: string) {
  const dir = dirTemporario(`${nome}-espiao`);
  const log = path.join(dir, 'chamadas.log');
  const marca = path.join(dir, 'executou');
  fs.writeFileSync(path.join(dir, 'git'),
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\nprintf -- '--fim--\\n' >> '${log}'\nexec '${GIT_REAL}' "$@"\n`,
    { mode: 0o755 });
  const PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
  const lidas = (): string => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  return {
    dir, marca, PATH, lidas,
    zerar() { fs.rmSync(log, { force: true }); },
    /** Roda `f` com o espiao na frente do PATH deste processo. */
    com<T>(f: () => T): T {
      const antes = process.env.PATH;
      process.env.PATH = PATH;
      try { return f(); } finally { process.env.PATH = antes; }
    },
    limpar() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

/** O valor ruim chegou ao git como argumento? (o com quebra de linha e conferido pela recusa e pela main intacta) */
const chegouAoGit = (lidas: string, ruim: string): boolean => !ruim.includes('\n') && ruim !== '' && lidas.split('\n').includes(ruim);

function threadComEntrega(p: ReturnType<typeof projetoTemporario>, nome: string) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', `# ${thread.id}\n`, `feat: entrega de ${thread.id}`);
  return thread;
}

test('ship --para: remoto que nao e nome de remoto recusa com ship.remoto-invalido antes de qualquer git', () => {
  const p = projetoTemporario('ship-remoto-ruim', true);
  const e = espiao('ship-remoto-ruim');
  try {
    const thread = threadComEntrega(p, 'entrega');
    const mainAntes = shaDaBranch(p.dir, 'main');
    for (const ruim of maliciosos(e.marca)) {
      e.zerar();
      assert.throws(() => e.com(() => ship(p.carregado, thread.id, { para: 'main', remoto: ruim })),
        (erro: Error) => RECUSA.test(erro.message), JSON.stringify(ruim));
      assert.equal(e.lidas(), '', `nenhuma chamada ao git com ${JSON.stringify(ruim)}`);
      assert.throws(() => e.com(() => shaNoRemoto(p.dir, ruim, 'main')), (erro: Error) => RECUSA.test(erro.message));
      assert.throws(() => e.com(() => remotoConfigurado(p.dir, ruim)), (erro: Error) => RECUSA.test(erro.message));
      assert.equal(e.lidas(), '', `shaNoRemoto e remotoConfigurado nao chamam o git com ${JSON.stringify(ruim)}`);
    }
    assert.equal(shaDaBranch(p.dir, 'main'), mainAntes, 'nada foi mergeado');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.equal(eventos.some((x) => x.tipo === 'ship_done' || x.tipo === 'ship_started'), false, 'nada foi entregue');
    assert.equal(fs.existsSync(e.marca), false, 'nenhum valor virou comando');
  } finally { e.limpar(); p.limpar(); }
});

test('ship --para: a CLI recusa --remoto ruim e --remoto sem valor, sem tocar a main', () => {
  const p = projetoTemporario('ship-remoto-cli', true);
  const e = espiao('ship-remoto-cli');
  try {
    const thread = threadComEntrega(p, 'entrega');
    const mainAntes = shaDaBranch(p.dir, 'main');
    const env = { ...process.env, PATH: e.PATH, ORK_USUARIO_DIR: path.join(e.dir, 'usuario'), ORK_MAQUINA: 'pc-teste',
      ORK_FABRICA_PUBLICAR: '0' };
    const ork = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: p.dir, encoding: 'utf8', env, timeout: 60000 });
    for (const ruim of [...maliciosos(e.marca), '']) {
      e.zerar();
      const r = ork(['ship', thread.id, '--para', 'main', `--remoto=${ruim}`]);
      assert.notEqual(r.status, 0, `${JSON.stringify(ruim)}: ${r.stdout}`);
      assert.match(r.stderr, /^erro: ship\.remoto-invalido: o remoto .* não é nome de remoto do git/m, JSON.stringify(ruim));
      assert.equal(chegouAoGit(e.lidas(), ruim), false, `${JSON.stringify(ruim)} nao chegou ao git`);
    }
    const semValor = ork(['ship', thread.id, '--para', 'main', '--remoto']);
    assert.match(semValor.stderr, /^erro: ship\.remoto-invalido/m);
    assert.equal(shaDaBranch(p.dir, 'main'), mainAntes, 'nada foi mergeado');
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some((x) => x.tipo === 'ship_done'), false);
    assert.equal(fs.existsSync(e.marca), false, 'nenhum valor virou comando');
  } finally { e.limpar(); p.limpar(); }
});

test('ship --para: nome legitimo (meu-remoto.2) empurra e prova o push, com -- antes do remoto', () => {
  const p = projetoTemporario('ship-remoto-legitimo', true);
  const e = espiao('ship-remoto-legitimo');
  try {
    exec('git', ['remote', 'add', 'meu-remoto.2', p.remoto as string], p.dir);
    const thread = threadComEntrega(p, 'entrega');
    const r = e.com(() => ship(p.carregado, thread.id, { para: 'main', remoto: 'meu-remoto.2' }));
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(r.pushVerificado, true);
    assert.equal(r.remoto, 'meu-remoto.2');
    assert.equal(r.shaRemoto, shaDaBranch(p.dir, 'main'));
    assert.equal(shaNoRemotoDeTeste(p.dir, p.remoto as string, 'main'), shaDaBranch(p.dir, 'main'));
    const chamadas = e.lidas().split('--fim--\n').map((c) => c.split('\n').filter(Boolean));
    const comRemoto = chamadas.filter((c) => c.includes('meu-remoto.2'));
    assert.ok(comRemoto.some((c) => c[0] === 'push'), 'houve push');
    assert.ok(comRemoto.some((c) => c[0] === 'ls-remote'), 'houve ls-remote');
    for (const c of comRemoto) assert.equal(c[c.indexOf('meu-remoto.2') - 1], '--', `-- antes do remoto em: git ${c.join(' ')}`);
  } finally { e.limpar(); p.limpar(); }
});

test('ship --para: --de com nome que comeca com - e mergeado pelo sha, sem virar opcao do git merge', () => {
  const p = projetoTemporario('ship-de-hifen', true);
  try {
    const thread = threadComEntrega(p, 'entrega');
    const ponta = shaDaBranch(p.dir, thread.base.branch);
    // `git branch` recusa o nome; `update-ref` grava. Assim um nome assim chega ao `--de`.
    assert.equal(exec('git', ['update-ref', 'refs/heads/-entrega', ponta], p.dir).ok, true);
    const r = ship(p.carregado, thread.id, { para: 'main', de: '-entrega' });
    assert.equal(r.ok, true, r.detalhe);
    const pais = exec('git', ['rev-list', '--parents', '-n', '1', 'main'], p.dir).stdout.trim().split(/\s+/);
    assert.ok(pais.includes(ponta), 'a ponta de --de entrou na main');
    assert.equal(r.pushVerificado, true);
  } finally { p.limpar(); }
});

test('pulse: remoto do manifesto que nao e nome de remoto nao chega ao git na leitura da forja', () => {
  const p = projetoTemporario('pulse-remoto-ruim', true);
  const e = espiao('pulse-remoto-ruim');
  try {
    let consultas = 0;
    const executor = () => { consultas++; return { ok: true, code: 0, stdout: '[]', stderr: '' }; };
    for (const ruim of maliciosos(e.marca)) {
      e.zerar();
      assert.equal(e.com(() => repositorioDoRemoto(p.dir, ruim)), null);
      const leitura = e.com(() => lerPrsDaForja(p.carregado, { remoto: ruim, executor: executor as never }));
      assert.equal(leitura.ok, false);
      assert.match(String(leitura.erro), /não é nome de remoto do git/);
      assert.equal(e.lidas(), '', `nenhuma chamada ao git com ${JSON.stringify(ruim)}`);
    }
    assert.equal(consultas, 0, 'o gh nunca foi chamado');
    assert.equal(fs.existsSync(e.marca), false);
  } finally { e.limpar(); p.limpar(); }
});

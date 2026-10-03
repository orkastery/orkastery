/**
 * RM-047 (fronteira de confiança do repositório clonado): quem roda `ork` num repositório de terceiros
 * não executa código, não grava fora da raiz e não entrega opção ao git só por isso. Cada teste abaixo
 * reprova no código anterior a esta thread (ork-rm047frontei):
 *
 * - o `mergeSha` de um `ship_done` do ledger ia cru ao `git log` da detecção de reversão;
 * - a base do `ork docs sincronizar` caía crua no `git log` quando não resolvia;
 * - o manifesto aceitava `worktree.base_branch` que o git leria como opção;
 * - `memory.cli` relativo (e o interpretador relativo no shebang) resolvia dentro do clone, e o
 *   `ork brain` rodava o executável com cwd na raiz do clone;
 * - `.orkastery`, `threads`, a pasta da thread ou o próprio ledger como link simbólico levavam a
 *   escrita para fora da raiz;
 * - o id de uma rodada de auditoria lido do `run.json` virava caminho com `..`.
 *
 * A matriz completa está em docs/referencia/fronteira-de-confianca.md.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { branchValida, shaValido } from '../src/branch-de-estado';
import { brainClient, BRAIN_API } from '../src/company-brain-client';
import { CONTRACT_HASH } from '../src/company-brain-contract';
import { mergeDaThread, mergesDaThreadNoGit, resolverBase } from '../src/docs';
import { gravarRodada } from '../src/auditrun';
import { registrar } from '../src/ledger';
import { carregarManifesto, dirEstado } from '../src/manifest';
import { DriverCliOrkMind } from '../src/orkmind';
import { detectarReversaoDaEntrega } from '../src/ship';
import { dirThread } from '../src/thread';
import { Thread } from '../src/types';
import { anexarJsonl } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

/** Nenhum arquivo cujo nome comece pela marca existe na pasta dela. */
function semMarca(marca: string): void {
  const dir = path.dirname(marca), base = path.basename(marca);
  const achados = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith(base)) : [];
  assert.deepEqual(achados, [], `o git gravou ${achados.join(', ')}`);
}

function ledgerDoClone(raiz: string, id: string, eventos: Record<string, unknown>[]): Thread {
  const dir = path.join(raiz, '.orkastery', 'threads', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), eventos.map((e) => JSON.stringify({ ts: '2026-10-03T00:00:00Z', thread: id, ...e })).join('\n') + '\n');
  return { id } as unknown as Thread;
}

test('validadores: branch segue o check-ref-format e sha é só hexadecimal', () => {
  for (const ok of ['main', 'release/2026.10', 'feat+x', 'origin/main', 'ork/ork-x-full']) assert.ok(branchValida(ok), ok);
  for (const ruim of ['--output=/tmp/x', '-c', 'a..b', 'x y', 'x:y', 'x~1', 'x^', '@', 'x@{1}', '/x', 'x/', 'x//y', '.x', 'x/.y', 'x.lock', 'x.', '', 'a\nb']) {
    assert.ok(!branchValida(ruim), JSON.stringify(ruim));
  }
  assert.ok(shaValido('8bc25f3'));
  assert.ok(shaValido('8bc25f3506332623b4930a960ff2b57dae686648'));
  for (const ruim of ['--output=/tmp/x', 'HEAD', '8bc25f', 'main', 'abc123g']) assert.ok(!shaValido(ruim), ruim);
});

test('detecção de reversão: mergeSha e para do ledger do clone nunca viram opção do git log', () => {
  const p = projetoTemporario('fronteira-reversao');
  const fora = dirTemporario('fronteira-reversao-fora');
  try {
    const marca = path.join(fora, 'marca');
    const thread = ledgerDoClone(p.dir, 'ork-clone', [
      { tipo: 'ship_done', mergeSha: `--output=${marca}`, para: 'main' },
      { tipo: 'ship_done', mergeSha: 'deadbeef', para: `--output=${marca}-para` },
    ]);
    assert.equal(detectarReversaoDaEntrega(p.dir, thread), null);
    assert.equal(detectarReversaoDaEntrega(p.dir, thread, 'main'), null);
    semMarca(marca);
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('docs: base crua do manifesto e mergeSha do ledger não chegam ao git como opção', () => {
  const p = projetoTemporario('fronteira-docs');
  const fora = dirTemporario('fronteira-docs-fora');
  try {
    const marca = path.join(fora, 'marca');
    assert.deepEqual(mergesDaThreadNoGit(p.dir, 'ork-clone', `--output=${marca}`), []);
    assert.equal(resolverBase(p.dir, `--output=${marca}-base`), null);
    ledgerDoClone(p.dir, 'ork-clone', [{ tipo: 'ship_done', mergeSha: `--output=${marca}-sha`, para: 'main' }]);
    assert.equal(mergeDaThread(p.dir, 'ork-clone', 'main'), null);
    semMarca(marca);
    // O caminho legítimo segue: a base existe e resolve.
    assert.equal(resolverBase(p.dir, 'main'), 'main');
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('manifesto: worktree.base_branch e memory.cli fora do formato reprovam; os legítimos passam', () => {
  const p = projetoTemporario('fronteira-manifesto');
  try {
    const original = fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8');
    const comBase = (base: string): string[] => {
      fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), original.replace('base_branch: "main"', `base_branch: ${JSON.stringify(base)}`));
      return (carregarManifesto(p.dir)?.erros ?? []).filter((e) => e.startsWith('worktree.base_branch'));
    };
    assert.ok(original.includes('base_branch: "main"'));
    for (const ruim of ['--output=/tmp/x', '-c', 'a..b']) assert.equal(comBase(ruim).length, 1, ruim);
    for (const ok of ['main', 'release/2026.10']) assert.deepEqual(comBase(ok), [], ok);

    const semMemoria = original.replace(/\nmemory:[\s\S]*?(?=\n\S|$)/, '');
    const comCli = (cli: string): string[] => {
      fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), `${semMemoria}\nmemory:\n  mode: files\n  cli: ${JSON.stringify(cli)}\n`);
      return (carregarManifesto(p.dir)?.erros ?? []).filter((e) => e.startsWith('memory.cli'));
    };
    for (const ruim of ['./bin/orkmind', 'bin/orkmind', '../orkmind', '-x', '/opt/../tmp/orkmind']) assert.equal(comCli(ruim).length, 1, ruim);
    for (const ok of ['orkmind', 'orkmind-dev', '/opt/orkmind/bin/orkmind']) assert.deepEqual(comCli(ok), [], ok);
  } finally { p.limpar(); }
});

test('OrkMind: memory.cli relativo e interpretador relativo no shebang não executam arquivo do clone', () => {
  const clone = dirTemporario('fronteira-orkmind');
  const antes = process.cwd();
  try {
    const marca = path.join(clone, 'executou');
    const interp = path.join(clone, 'interp');
    fs.writeFileSync(interp, `#!/bin/sh\ntouch '${marca}'\n`, { mode: 0o755 });
    fs.mkdirSync(path.join(clone, 'bin'));
    fs.writeFileSync(path.join(clone, 'bin', 'orkmind'), `#!${interp}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(clone, 'relativo'), '#!./interp\n', { mode: 0o755 });
    process.chdir(clone);
    const relativo = new DriverCliOrkMind({ cli: 'bin/orkmind', dsn: 'x', variavel: 'TEST', timeoutMs: 2000 });
    assert.equal(relativo.disponivel().ok, false);
    const shebang = new DriverCliOrkMind({ cli: path.join(clone, 'relativo'), dsn: 'x', variavel: 'TEST', timeoutMs: 2000 });
    assert.equal(shebang.disponivel().ok, false);
    assert.equal(fs.existsSync(marca), false, 'o interpretador do clone executou');
  } finally { process.chdir(antes); fs.rmSync(clone, { recursive: true, force: true }); }
});

test('ork brain: o executável da memória roda fora da raiz do clone', () => {
  const p = projetoTemporario('fronteira-brain');
  const antes = process.env.FRONTEIRA_FAKE_DSN;
  try {
    p.carregado.manifesto.memory = { ...p.carregado.manifesto.memory, mode: 'orkmind', tenant: 'synthetic', database_url_env: 'FRONTEIRA_FAKE_DSN' };
    process.env.FRONTEIRA_FAKE_DSN = 'SYNTHETIC-not-a-connection';
    let cwd: string | undefined;
    const run: any = (_bin: string, _args: string[], opts: any) => {
      cwd = opts.cwd;
      return { status: 0, stdout: JSON.stringify({ schema: BRAIN_API, state: 'ok', contract_hash: CONTRACT_HASH }) };
    };
    assert.equal(brainClient(p.carregado, run)({ schema: BRAIN_API, operation: 'capabilities' }).state, 'ok');
    assert.ok(cwd, 'o spawn recebeu cwd');
    const real = fs.realpathSync(p.dir);
    assert.ok(path.relative(real, fs.realpathSync(cwd!)).startsWith('..'), `cwd ${cwd} está dentro do clone`);
    assert.equal(cwd, os.homedir());
  } finally {
    if (antes === undefined) delete process.env.FRONTEIRA_FAKE_DSN; else process.env.FRONTEIRA_FAKE_DSN = antes;
    p.limpar();
  }
});

test('estado: link simbólico em .orkastery, threads, na pasta da thread ou no ledger não leva escrita para fora', () => {
  const p = projetoTemporario('fronteira-links');
  const fora = dirTemporario('fronteira-links-fora');
  try {
    const estado = path.join(p.dir, '.orkastery');
    const threads = path.join(estado, 'threads');
    fs.mkdirSync(threads, { recursive: true });

    // a pasta da thread é link
    fs.mkdirSync(path.join(fora, 'alvo-thread'));
    fs.symlinkSync(path.join(fora, 'alvo-thread'), path.join(threads, 'ork-link'), 'dir');
    assert.throws(() => registrar(dirThread(p.dir, 'ork-link'), 'ork-link', 'teste'), /^Error: estado\.link/);
    assert.deepEqual(fs.readdirSync(path.join(fora, 'alvo-thread')), []);

    // o ledger e o claims.jsonl são links para arquivo do usuário
    const vitima = path.join(fora, 'vitima');
    fs.writeFileSync(vitima, 'original\n');
    const dir = path.join(threads, 'ork-folha');
    fs.mkdirSync(dir);
    fs.symlinkSync(vitima, path.join(dir, 'ledger.jsonl'));
    fs.symlinkSync(vitima, path.join(dir, 'claims.jsonl'));
    assert.throws(() => registrar(dirThread(p.dir, 'ork-folha'), 'ork-folha', 'teste'), /ELOOP/);
    assert.throws(() => anexarJsonl(path.join(dir, 'claims.jsonl'), { id: 'C1' }), /ELOOP/);
    assert.equal(fs.readFileSync(vitima, 'utf8'), 'original\n');

    // `threads` é link
    fs.rmSync(threads, { recursive: true, force: true });
    fs.mkdirSync(path.join(fora, 'alvo-threads'));
    fs.symlinkSync(path.join(fora, 'alvo-threads'), threads, 'dir');
    assert.throws(() => dirThread(p.dir, 'ork-qualquer'), /^Error: estado\.link/);

    // `.orkastery` é link
    fs.rmSync(estado, { recursive: true, force: true });
    fs.mkdirSync(path.join(fora, 'alvo-estado'));
    fs.symlinkSync(path.join(fora, 'alvo-estado'), estado, 'dir');
    assert.throws(() => dirEstado(p.dir), /^Error: estado\.link/);
    assert.throws(() => dirThread(p.dir, 'ork-qualquer'), /^Error: estado\.link/);
    assert.deepEqual(fs.readdirSync(path.join(fora, 'alvo-estado')), []);
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('auditoria: id de rodada lido do run.json não vira caminho fora de .orkastery/audits', () => {
  const p = projetoTemporario('fronteira-auditoria');
  // O alvo fica ao lado da raiz do projeto temporário, com nome único, e sai no finally.
  const nome = `${path.basename(p.dir)}-fora`;
  const fora = path.join(path.dirname(p.dir), nome);
  try {
    assert.throws(() => gravarRodada(p.dir, { id: `../../../${nome}`, status: 'aberta' } as never), /audit\.rodada-invalida/);
    assert.equal(fs.existsSync(fora), false);
    gravarRodada(p.dir, { id: 'ork-seguranca-2026-10-03-1', status: 'aberta' } as never);
    assert.ok(fs.existsSync(path.join(p.dir, '.orkastery', 'audits', 'ork-seguranca-2026-10-03-1', 'run.json')));
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

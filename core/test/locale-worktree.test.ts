/**
 * RM-061, fatia F3b: `ork worktree ensure|sync|audit|release` em ingles. A moldura, os bloqueios e o audit item a item
 * saem pelo catalogo; o detalhe e a correcao que o comando grava no ledger nascem em pt-BR e so a impressao os remonta;
 * o nome do check (dado do ledger) e traduzido so na impressao. Motivo tipado, comando e caminho saem iguais. Os erros
 * de estado (`locale-estado`) tambem. Os nomes comecam por "locale en F3b worktree:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ativarLocale, comLocale, ErroDoCatalogo, ligarRemontagem, mensagemDoErro, msg, remontar, textoDoErro } from '../src/locale';
import { estadoCanonico, exigirEstadoSemLink, raizDoEstado } from '../src/estado-thread';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

/** O ledger da thread sem o que varia entre execucoes (horario, id do evento, sha). */
function ledger(dir: string, id: string): string {
  return fs.readFileSync(path.join(dir, '.orkastery', 'threads', id, 'ledger.jsonl'), 'utf8')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>').replace(/"eventId":"[^"]*"/g, '"eventId":"<ID>"')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>').replace(/\b[0-9a-f]{8}\b/g, '<SHA8>').split(id).join('<THREAD>');
}

test('locale en F3b worktree: ensure, sync, audit e release saem em ingles, com o ledger igual ao do pt-BR', () => {
  const c = cenario('worktree-f3b');
  try {
    for (const nome of ['loc-en', 'loc-pt']) assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--sem-worktree').status, 0);
    // O mesmo roteiro nas duas linguas, cada uma na sua thread.
    const roteiro = (locale: Record<string, string>, id: string) => {
      const saidas: Array<{ status: number | null; stdout: string; stderr: string }> = [];
      const rodar = (...args: string[]) => { const r = ork(c, locale, false, 'worktree', ...args); saidas.push(r); return r; };
      rodar('audit', id);
      rodar('sync', id);
      rodar('ensure', id);
      rodar('ensure', id);
      rodar('audit', id);
      rodar('sync', id, '--dry-run');
      rodar('sync', id);
      const wt = (JSON.parse(fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', id, 'thread.json'), 'utf8')) as { worktree: string }).worktree;
      fs.writeFileSync(path.join(wt, 'sujo.txt'), 'x\n');
      rodar('sync', id);
      rodar('release', id);
      rodar('release', id, '--forcar');
      rodar('release', id);
      return saidas;
    };
    const en = roteiro(EN, 'loc-locen');
    const pt = roteiro(PT, 'loc-locpt');
    assert.deepEqual(en.map((s) => s.status), pt.map((s) => s.status));
    const tudo = en.map((s) => s.stdout + s.stderr).join('\n');
    // Moldura e frases em ingles.
    assert.match(en[0].stdout, /^Audit of the worktree of thread loc-locen\n {2}dir {5}\S+\n {2}branch {2}ork\/loc-locen-goal\n\n {2}\[FAIL\] record {6}the thread has no worktree recorded in thread\.json\n {9}fix: ork worktree ensure loc-locen\n/);
    assert.match(en[0].stdout, /\n {2}\[FAIL\] directory {3}\S+ does not exist on disk\n/);
    assert.match(en[0].stdout, /\n {2}\[ok\] {3}artifacts {3}\.orkastery\/threads\/loc-locen stays outside the worktree\n\n {2}3 divergence\(s\) found in git itself\.\n$/);
    assert.equal(en[1].stderr, 'Worktree sync for thread loc-locen BLOCKED.\n  typed reason: tree.blocked\n' +
      '  detail: thread loc-locen has no worktree registered in git\n  fix: create the worktree with: ork worktree ensure loc-locen\n');
    assert.match(en[2].stdout, /^Worktree created for thread loc-locen\.\n {2}dir {5}\S+\n {2}branch {2}ork\/loc-locen-goal\n {2}base {4}main \(resolved by ork, not by the executor\)\n {2}worktree created from main\n$/);
    assert.match(en[3].stdout, /^Worktree already existed for thread loc-locen\.\n[\s\S]*\n {2}the thread worktree already exists and git recognizes it\n$/);
    assert.match(en[4].stdout, /\n {2}\[ok\] {3}single-state same state: main=\d+ events, worktree=\d+ events; /);
    assert.match(en[4].stdout, /\n {2}worktree consistent: git confirms every item above\.\n$/);
    assert.match(en[5].stdout, /^Sync \(--dry-run\) of thread loc-locen: nothing was run\.\n[\s\S]* {2}rebase {5}not needed\n {2}the base main is already merged in: nothing to sync\n\n {2}Real commands, in order:\n/);
    assert.match(en[7].stderr, /\n {2}detail: \S+ has uncommitted changes; rebasing a dirty tree loses work\n {2}fix: commit or stash the changes in \S+ and run again: ork worktree sync loc-locen\n$/);
    assert.match(en[8].stderr, /^Worktree release for thread loc-locen BLOCKED\.\n {2}typed reason: tree\.blocked\n/);
    assert.match(en[9].stdout, /^Worktree of thread loc-locen released\.\n {2}dir {6}\S+\n {2}removed {2}yes\n {2}leases {3}\(no write lease to release\)\n {2}worktree removed; branch ork\/loc-locen-goal stays in the repository\n$/);
    assert.match(en[10].stdout, /\n {2}removed {2}no \(the directory no longer existed\)\n[\s\S]*\n {2}the directory no longer existed; record cleaned and `git worktree prune` run\n$/);
    // Fora dos caminhos e dos comandos (que sao dado), nada em pt-BR.
    const semCaminho = tudo.split(c.dir).join('<REPO>');
    assert.deepEqual(linhasEmPortugues(semCaminho, ['ork/loc-locen-goal']), []);
    // O ledger que o ingles gravou e o mesmo que o pt-BR gravou: detalhe e nome de check em pt-BR.
    assert.equal(ledger(c.dir, 'loc-locen'), ledger(c.dir, 'loc-locpt'));
    assert.match(fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', 'loc-locen', 'ledger.jsonl'), 'utf8'),
      /"nome":"registro","nivel":"fail","detalhe":"a thread nao tem worktree registrada no thread.json"/);
  } finally { c.limpar(); }
});

test('locale en F3b worktree: owner.language en-US vence o LANG pt-BR, e o uso e o subcomando desconhecido saem em ingles', () => {
  const c = cenario('worktree-f3b-dono');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, PT, false, 'worktree').stderr, 'usage: ork worktree <ensure|sync|audit|release> <thread-id>\n');
    assert.equal(ork(c, PT, false, 'worktree', 'voar', 'x').stderr, 'unknown subcommand: worktree voar\n');
    assert.equal(ork(c, PT, false, 'worktree', 'audit', 'loc-nada').stderr,
      `error: thread "loc-nada" not found in ${path.join(c.dir, '.orkastery', 'threads')}\n`);
  } finally { c.limpar(); }
});

test('locale en F3b worktree: os erros de estado nascem do catalogo, com o motivo tipado igual nas duas linguas', () => {
  const c = cenario('worktree-f3b-estado', false);
  try {
    const comLink = path.join(c.dir, 'raiz-com-link');
    fs.mkdirSync(path.join(comLink, 'fora'), { recursive: true });
    fs.symlinkSync(path.join(comLink, 'fora'), path.join(comLink, '.orkastery'));
    const erros = (): unknown[] => {
      const lista: unknown[] = [];
      try { estadoCanonico(c.dir, '../x'); } catch (e) { lista.push(e); }
      try { exigirEstadoSemLink(comLink, ['.orkastery', 'threads', 'x']); } catch (e) { lista.push(e); }
      const raizRuim = path.join(c.dir, 'raiz-ruim');
      fs.mkdirSync(raizRuim, { recursive: true });
      fs.writeFileSync(path.join(raizRuim, '.git'), 'nada\n');
      try { raizDoEstado(raizRuim); } catch (e) { lista.push(e); }
      return lista;
    };
    const lista = comLocale('pt-BR', erros);
    assert.equal(lista.length, 3);
    assert.ok(lista.every((e) => e instanceof ErroDoCatalogo));
    assert.equal((lista[0] as Error).message, 'id de thread inválido');
    assert.match((lista[1] as Error).message, /^estado\.link: \.orkastery é link simbólico; /);
    assert.equal((lista[2] as Error).message, `.git inválido em ${path.join(c.dir, 'raiz-ruim')}`);
    ativarLocale('en');
    try {
      assert.deepEqual(lista.map(mensagemDoErro), ['invalid thread id',
        'estado.link: .orkastery is a symbolic link; ork state lives in real folders inside the root (a versioned link would send writes outside it). Remove the link.',
        `invalid \`.git\` in ${path.join(c.dir, 'raiz-ruim')}`]);
      // O texto guardado num resultado e remontado na impressao.
      ligarRemontagem(true);
      const guardado = comLocale('pt-BR', () => textoDoErro(lista[0]));
      assert.equal(guardado, 'id de thread inválido');
      assert.equal(remontar(guardado), 'invalid thread id');
    } finally { ativarLocale(undefined); ligarRemontagem(false); }
    assert.equal(msg('pt-BR').estado.idInvalido, 'id de thread inválido');
  } finally { c.limpar(); }
});

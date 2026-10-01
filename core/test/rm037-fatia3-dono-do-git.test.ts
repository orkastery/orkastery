/**
 * RM-037 (fatia 3, defeito 7): git rodado como root no repositorio do dono deixa objeto e pasta de `.git`
 * com outro dono, e o fetch do dono trava (29/09 e 01/10). O `ork doctor` nao olhava o `.git`. Agora o
 * check "dono do .git" reprova com a contagem, os exemplos e o `chown` exato, sem rodar nada. O teste
 * nao tem root: ele troca o `lstat` para fazer de conta que arquivos do `.git` sao de outro uid.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { checar, checarDonoDoGit, relatorio } from '../src/doctor';
import { exec } from '../src/util';

/** O `lstat` de verdade, com o uid trocado nos caminhos que `deOutro` escolhe. */
function lstatComOutroDono(deOutro: (f: string) => boolean, uid: number) {
  return (f: string): fs.Stats => {
    const st = fs.lstatSync(f);
    return deOutro(f) ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid }) : st;
  };
}

test('defeito 7: .git todo do dono passa, e o check entra no doctor logo depois do repositorio', () => {
  const p = projetoTemporario('rm037-f3-dono-ok');
  try {
    const c = checarDonoDoGit(p.dir);
    assert.ok(c);
    assert.equal(c!.nivel, 'ok', c!.detalhe);
    assert.match(c!.detalhe, new RegExp(`entradas de \\.git com o dono do repositorio \\(uid ${fs.statSync(path.join(p.dir, '.git')).uid}\\)`));
    const nomes = checar(p.dir, []).map((x) => x.nome);
    assert.equal(nomes[nomes.indexOf('repositorio') + 1], 'dono do .git');
  } finally { p.limpar(); }
});

test('defeito 7: objeto e pasta de .git com outro dono reprovam com a contagem, exemplos e o chown exato', () => {
  const p = projetoTemporario('rm037-f3-dono-root');
  try {
    commitar(p.dir, 'mais.txt', 'mais um objeto\n', 'mais objetos');
    const git = fs.realpathSync(path.join(p.dir, '.git'));
    const st = fs.statSync(git);
    // O que um `sudo git fetch` deixaria: uma pasta de objetos e o que tem dentro, e o FETCH_HEAD.
    fs.writeFileSync(path.join(git, 'FETCH_HEAD'), '');
    const pasta = fs.readdirSync(path.join(git, 'objects')).find((n) => /^[0-9a-f]{2}$/.test(n))!;
    const deRoot = (f: string) => f === path.join(git, 'FETCH_HEAD') || f.startsWith(path.join(git, 'objects', pasta));
    const esperados = 1 + 1 + fs.readdirSync(path.join(git, 'objects', pasta)).length;
    const outroUid = st.uid === 0 ? 1 : 0;
    const c = checarDonoDoGit(p.dir, { lstat: lstatComOutroDono(deRoot, outroUid) })!;
    assert.equal(c.nivel, 'fail');
    assert.match(c.detalhe, new RegExp(`^${esperados} entrada\\(s\\) de \\.git com outro dono \\(uid ${outroUid}; o do repositorio e ${st.uid}\\): `));
    assert.match(c.detalhe, /o git do dono nao grava nelas, e o fetch e o commit falham$/);
    assert.equal(c.correcao, `sudo chown -R ${st.uid}:${st.gid} ${git} (o ork nao roda isso sozinho)`);
    // Ate tres exemplos, relativos a raiz do repositorio.
    const exemplos = c.detalhe.split('): ')[1].split('; o git')[0].replace(/, \.\.\.$/, '').split(', ');
    assert.ok(exemplos.length >= 1 && exemplos.length <= 3, c.detalhe);
    for (const e of exemplos) assert.ok(e.startsWith('.git/'), e);
    // O relatorio do doctor bloqueia e mostra a correcao; nada foi executado: o dono real nao mudou.
    const texto = relatorio([c]);
    assert.match(texto, /correcao: sudo chown -R /);
    assert.match(texto, /Veredito: BLOQUEADO \(1 fail/);
    assert.equal(fs.statSync(path.join(git, 'FETCH_HEAD')).uid, st.uid);
  } finally { p.limpar(); }
});

test('defeito 7: worktree aponta para o .git comum, e acima do teto a conferencia e parcial', () => {
  const p = projetoTemporario('rm037-f3-dono-wt');
  try {
    const wt = path.join(p.dir, '..', path.basename(p.dir) + '-wt');
    assert.equal(exec('git', ['worktree', 'add', '-q', '-b', 'ork/x', wt], p.dir).ok, true);
    try {
      const c = checarDonoDoGit(wt)!;
      assert.equal(c.nivel, 'ok', c.detalhe);
      assert.match(c.detalhe, /entradas de \.git com o dono/);
      const parcial = checarDonoDoGit(p.dir, { teto: 5 })!;
      assert.equal(parcial.nivel, 'warn');
      assert.match(parcial.detalhe, /mais de 5 entradas em \.git: conferencia parcial/);
    } finally { exec('git', ['worktree', 'remove', '--force', wt], p.dir); fs.rmSync(wt, { recursive: true, force: true }); }
    const semGit = fs.mkdtempSync(path.join(path.dirname(p.dir), 'sem-git-'));
    try { assert.equal(checarDonoDoGit(semGit), null, 'fora de repositorio, nada a conferir'); }
    finally { fs.rmSync(semGit, { recursive: true, force: true }); }
  } finally { p.limpar(); }
});

/**
 * P4 do ensaio da 0.5.0 (thread ork-p4worktreepo): `worktree.por_thread` passa a valer no `ork thread new`.
 *
 * Com a chave verdadeira, a thread nasce com a worktree e a branch dela sem `--worktree auto`; com a chave falsa ou
 * ausente, nada muda; `--sem-worktree` cria sem ela e diz o que isso faz no SHIP; o `--dry-run` mostra a worktree
 * que seria criada. Os nomes comecam por "p4 worktree:" para que cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente, como no ensaio-050: `thread new` registra o projeto
 * em `~/.orkastery/projetos.json`, e o teste nao pode tocar no HOME de quem roda.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exigirManifesto } from '../src/manifest';
import { ajustarManifesto, projetoTemporario } from './apoio';

test('p4 worktree: manifesto le a chave ausente como false', () => {
  const p = projetoTemporario('p4-manifesto');
  try {
    assert.equal(p.carregado.manifesto.worktree.por_thread, true, 'o modelo do ork init grava a chave verdadeira');
    ajustarManifesto(p, /\n  por_thread: true/, '\n  por_thread: false');
    assert.equal(p.carregado.manifesto.worktree.por_thread, false, 'chave falsa');
    ajustarManifesto(p, /\n  por_thread: false/, '');
    assert.equal(p.carregado.manifesto.worktree.por_thread, false, 'chave ausente');
    assert.equal(p.carregado.manifesto.worktree.dir, '.claude/worktrees', 'o resto do bloco segue lido');
    ajustarManifesto(p, /\nworktree:\n(?:  .*\n)+/, '\n');
    assert.equal(p.carregado.manifesto.worktree.por_thread, false, 'bloco worktree ausente');
    assert.equal(p.carregado.manifesto.worktree.base_branch, 'main');
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nworktree:\n  por_thread: "sim"\n');
    assert.equal(exigirManifesto(p.dir).manifesto.worktree.por_thread, false, 'valor que nao e booleano YAML vale o padrao');
  } finally { p.limpar(); }
});

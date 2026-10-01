/**
 * RM-037 (fatia 3, defeito 5): um unico objeto com nlink>1 em `.git/objects` travava o `ork_git_status`
 * e o `ork_git_commit` com `mcp.git.metadata.unsafe`; em 29/09 eram 7.621 objetos, de clones locais com
 * hard link. O armazem de objetos passa a aceitar o vinculo (o git nunca abre arquivo de la para escrita);
 * fora dele segue um vinculo so, e a recusa diz o caminho e a receita sem perda. Hermetico: so a varredura.
 * O status e o commit pelo MCP com um clone local de verdade estao em `rm037-fatia3-hard-link-mcp-git.test.ts`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { metadadosGitMcp } from '../src/mcp-git';

const OBJETO = 'objects/ab/' + 'c'.repeat(38);

/** Um `.git` minimo, com um objeto solto, um pack e uma ref, e uma pasta de fora para os vinculos. */
function gitFalso(nome: string) {
  const raiz = dirTemporario(nome), git = path.join(raiz, '.git'), fora = dirTemporario(`${nome}-fora`);
  const escrever = (rel: string, conteudo: string, modo = 0o444) => {
    fs.mkdirSync(path.dirname(path.join(git, rel)), { recursive: true });
    fs.writeFileSync(path.join(git, rel), conteudo, { mode: modo });
  };
  escrever(OBJETO, 'objeto solto');
  escrever(`objects/pack/pack-${'d'.repeat(40)}.pack`, 'pack');
  escrever(`objects/pack/pack-${'d'.repeat(40)}.idx`, 'idx');
  escrever('objects/info/packs', 'P pack\n', 0o644);
  escrever('refs/heads/main', '0'.repeat(40) + '\n', 0o644);
  return { raiz, git, fora, limpar: () => { fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(fora, { recursive: true, force: true }); } };
}

test('defeito 5: objeto, pack e info com hard link no armazem de objetos nao bloqueiam a varredura', () => {
  const g = gitFalso('rm037-f3-objetos');
  try {
    // O clone local liga os arquivos de objects/ por hard link: nlink 2 nos dois lados.
    for (const rel of [OBJETO, `objects/pack/pack-${'d'.repeat(40)}.pack`, 'objects/info/packs']) {
      fs.linkSync(path.join(g.git, rel), path.join(g.fora, path.basename(rel)));
      assert.equal(fs.statSync(path.join(g.git, rel)).nlink, 2);
    }
    assert.doesNotThrow(() => metadadosGitMcp(g.git, path.join(g.git, 'objects'), { armazemDeObjetos: true }));
    // Link simbolico continua recusado no armazem de objetos.
    fs.symlinkSync(path.join(g.fora, 'x'), path.join(g.git, 'objects/ab/link'));
    assert.throws(() => metadadosGitMcp(g.git, path.join(g.git, 'objects'), { armazemDeObjetos: true }),
      /^Error: mcp\.git\.metadata\.unsafe: link simbolico em \.git\/objects\/ab\/link$/);
  } finally { g.limpar(); }
});

test('defeito 5: hard link fora do armazem de objetos segue recusado, com o caminho e a receita sem perda', () => {
  const g = gitFalso('rm037-f3-refs');
  try {
    const ref = path.join(g.git, 'refs/heads/main');
    fs.linkSync(ref, path.join(g.fora, 'main'));
    assert.throws(() => metadadosGitMcp(g.git, path.join(g.git, 'refs')), (e: Error) => {
      assert.equal(e.message, 'mcp.git.metadata.unsafe: hard link em .git/refs/heads/main (2 vinculos); tire o vinculo sem ' +
        'perder conteudo: cp -p .git/refs/heads/main .git/refs/heads/main.tmp && mv .git/refs/heads/main.tmp .git/refs/heads/main');
      return true;
    });
    // A receita, rodada na raiz do repositorio, tira o vinculo e preserva o conteudo.
    const antes = fs.readFileSync(ref, 'utf8');
    execFileSync('sh', ['-c', 'cp -p .git/refs/heads/main .git/refs/heads/main.tmp && mv .git/refs/heads/main.tmp .git/refs/heads/main'], { cwd: g.raiz });
    assert.equal(fs.statSync(ref).nlink, 1);
    assert.equal(fs.readFileSync(ref, 'utf8'), antes);
    assert.doesNotThrow(() => metadadosGitMcp(g.git, path.join(g.git, 'refs')));
  } finally { g.limpar(); }
});

test('defeito 5: armazem de objetos acima do teto diz onde e a receita de empacotar sem perda', () => {
  const g = gitFalso('rm037-f3-teto');
  try {
    const pasta = path.join(g.git, 'objects/ee');
    fs.mkdirSync(pasta, { recursive: true });
    for (let i = 0; i < 8200; i++) fs.writeFileSync(path.join(pasta, i.toString(16).padStart(38, '0')), 'x');
    assert.throws(() => metadadosGitMcp(g.git, path.join(g.git, 'objects'), { armazemDeObjetos: true }),
      /^Error: mcp\.git\.metadata\.unsupported: mais de 8192 entradas em \.git\/objects; empacote os objetos soltos sem perda com git repack -d/);
  } finally { g.limpar(); }
});

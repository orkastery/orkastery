/**
 * RM-037 (fatia 3, defeito 5), com o MCP real: um `git clone` local do projeto liga os objetos por hard
 * link, e o `ork_git_status` e o `ork_git_commit` saiam `mcp.git.metadata.unsafe` em todas as threads.
 * Integracao local, como o `mcp-git.test.ts`: o perfil do git e o worker do commit rodam de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { adicionarClaim } from '../src/claims';
import { commitMcp, estadoGitMcp } from '../src/mcp-git';
import { gravarThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

test('defeito 5: depois de um clone local, ork_git_status e ork_git_commit seguem funcionando', async () => {
  const home = dirTemporario('rm037-f3-hl-home'), anterior = process.env.HOME, xdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = path.join(home, 'xdg');
  const p = projetoTemporario('rm037-f3-hl-mcp');
  const clones = dirTemporario('rm037-f3-hl-clone');
  try {
    const t = novaThread(p.carregado, { nome: 'hard link', modo: 'auto', criarWorktree: true }).thread;
    gravarThread(p.dir, t);
    const wt = t.worktree as string;
    execFileSync('git', ['clone', '-q', p.dir, path.join(clones, 'c')]);
    const ligados = execFileSync('find', [path.join(p.dir, '.git/objects'), '-type', 'f', '-links', '+1']).toString().split('\n').filter(Boolean);
    assert.ok(ligados.length > 0, 'o clone local ligou objetos por hard link');

    const status = estadoGitMcp(p.dir, t.id);
    assert.equal(status.source.branch, `ork/${t.slug}`);

    fs.writeFileSync(path.join(wt, 'depois-do-clone.txt'), 'commit com objetos ligados\n');
    adicionarClaim(p.dir, t.id, { arquivo: 'depois-do-clone.txt', alegacao: 'commit com objetos ligados', fase: 'GO', verificar: ['true'] });
    const r = await commitMcp(p.dir, { threadId: t.id, expectedHead: status.source.head, paths: ['depois-do-clone.txt'], mensagem: 'commit depois do clone' });
    assert.equal(r.ok, true, r.erro ?? '');
    assert.equal(exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim(), r.commit);

    // Fora do armazem de objetos o vinculo segue recusado, agora com o caminho e a receita.
    const ref = path.join(p.dir, '.git/refs/heads/main');
    fs.linkSync(ref, path.join(clones, 'main-ligada'));
    assert.throws(() => estadoGitMcp(p.dir, t.id), /mcp\.git\.metadata\.unsafe: hard link em \.git\/refs\/heads\/main \(2 vinculos\); tire o vinculo sem perder conteudo: cp -p/);
  } finally {
    p.limpar(); fs.rmSync(clones, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
    if (anterior === undefined) delete process.env.HOME; else process.env.HOME = anterior;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = xdg;
  }
});

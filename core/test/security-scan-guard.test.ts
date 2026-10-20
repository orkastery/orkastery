/** RoundGuard cleanup: `git worktree prune` runs only when a `worktree remove --force` failed. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RoundGuard } from '../src/security-scan/guard';
import { dirTemporario } from './apoio';

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const listed = (repo: string): string[] =>
  git(repo, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9));

function repo(name: string): { dir: string; cleanup: () => void } {
  const dir = fs.realpathSync(dirTemporario(name));
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'a');
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a clean remove leaves another session\'s stale worktree entry alone (no blanket prune)', () => {
  const r = repo('ss-guard-prune');
  try {
    // A stale entry of someone else: registered, directory gone.
    const other = path.join(path.dirname(r.dir), `${path.basename(r.dir)}-other`);
    git(r.dir, 'worktree', 'add', '-q', '--detach', other, 'HEAD');
    fs.rmSync(other, { recursive: true, force: true });
    const ours = path.join(fs.realpathSync(dirTemporario('ss-guard-ours')), 'tree');
    git(r.dir, 'worktree', 'add', '-q', '--detach', ours, 'HEAD');
    const guard = new RoundGuard(r.dir);
    guard.add('worktrees', ours);
    guard.close();
    const after = listed(r.dir);
    assert.ok(!after.includes(ours), 'our worktree is removed');
    assert.ok(after.includes(other), 'the stale entry of another session survives');
  } finally { r.cleanup(); }
});

test('a failed remove is followed by a prune, so the round leaves no registration behind', () => {
  const r = repo('ss-guard-prune-falha');
  try {
    const ours = path.join(fs.realpathSync(dirTemporario('ss-guard-ours-falha')), 'tree');
    git(r.dir, 'worktree', 'add', '-q', '--detach', ours, 'HEAD');
    // Without its `.git` file the tree is no longer a working tree to git: `remove --force` fails, the guard deletes
    // the directory and prunes the registration.
    fs.rmSync(path.join(ours, '.git'), { force: true });
    const guard = new RoundGuard(r.dir);
    guard.add('worktrees', ours);
    guard.close();
    assert.ok(!listed(r.dir).includes(ours), 'the registration is pruned');
  } finally { r.cleanup(); }
});

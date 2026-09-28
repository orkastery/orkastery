import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { discoverMaestro, revalidateMaestroContext } from '../src/maestro-discovery';
import { novaThread } from '../src/thread';
import { garantirWorktree } from '../src/worktree';
import { commitar } from './apoio';

test('descoberta ausente, fixada, ambígua, selecionada e stale sem criar estado', () => {
  const a = projetoTemporario('maestro-a'), b = projetoTemporario('maestro-b'), empty = dirTemporario('maestro-none');
  try {
    assert.throws(() => discoverMaestro({ cwd: empty }), /project.missing/);
    assert.deepEqual(fs.readdirSync(empty), []);
    const before = fs.readdirSync(a.dir), ctx = discoverMaestro({ cwd: a.dir });
    assert.equal(ctx.root, a.dir); assert.equal(ctx.project.origin, 'cwd');
    assert.equal(discoverMaestro({ cwd: empty, pinned: a.dir }).project.origin, 'installation');
    assert.throws(() => discoverMaestro({ cwd: a.dir, allowedRoots: [a.dir, b.dir] }), /ambiguous/);
    assert.equal(discoverMaestro({ cwd: a.dir, allowedRoots: [a.dir, b.dir], selected: b.dir }).root, b.dir);
    assert.throws(() => discoverMaestro({ cwd: a.dir, allowedRoots: [a.dir], selected: b.dir }), /scope/);
    assert.deepEqual(fs.readdirSync(a.dir), before);
    revalidateMaestroContext(ctx);
    fs.appendFileSync(ctx.manifest, '\n# changed\n');
    assert.throws(() => revalidateMaestroContext(ctx), /stale/);
  } finally { a.limpar(); b.limpar(); fs.rmSync(empty, { recursive: true }); }
});
test('WT vinculada resolve raiz canônica; cópia de estado divergente é recusada', () => {
  const p=projetoTemporario('maestro-wt');
  try {
    commitar(p.dir,'orkastery.yaml',fs.readFileSync(path.join(p.dir,'orkastery.yaml'),'utf8'),'manifesto');
    const t=novaThread(p.carregado,{nome:'vinculo',modo:'auto'}).thread;
    const wt=garantirWorktree(p.carregado,t.id);assert.equal(wt.ok,true);
    const ctx=discoverMaestro({cwd:wt.dir});assert.equal(ctx.root,p.dir);assert.equal(ctx.project.origin,'worktree');
    const variants = [{cwd:wt.dir}, {cwd:wt.dir,pinned:wt.dir}, {cwd:p.dir,pinned:wt.dir},
      {cwd:p.dir,allowedRoots:[p.dir,wt.dir],selected:wt.dir}];
    for (const options of variants) {
      const pinned = discoverMaestro(options);
      assert.deepEqual(pinned, ctx);
      revalidateMaestroContext(pinned);
    }
    const alias=path.join(wt.dir,'.orkastery/threads',t.id);
    fs.unlinkSync(alias);fs.mkdirSync(alias);
    for (const options of variants) assert.throws(()=>discoverMaestro(options),/scope/);
    fs.rmdirSync(alias);
    fs.symlinkSync(path.join(p.dir,'.orkastery/threads'),alias);
    for (const options of variants) assert.throws(()=>discoverMaestro(options),/scope/);
    fs.unlinkSync(alias);fs.symlinkSync(path.join(p.dir,'.orkastery/threads',t.id),alias);
    const gitdir=path.resolve(wt.dir,fs.readFileSync(path.join(wt.dir,'.git'),'utf8').slice('gitdir: '.length).trim());
    const back=path.join(gitdir,'gitdir'), original=fs.readFileSync(back);
    fs.writeFileSync(back,path.join(p.dir,'.git'));
    for (const options of variants) assert.throws(()=>discoverMaestro(options),/scope/);
    fs.writeFileSync(back,original);
    const other=path.join(wt.dir,'.orkastery/threads','other');fs.symlinkSync(p.dir,other);
    for (const options of variants) assert.throws(()=>discoverMaestro(options),/scope/);
  } finally {p.limpar();}
});
test('manifesto legado é lido; symlink de projeto ou manifesto é recusado', () => {
  const p = projetoTemporario('maestro-legacy'), outer = dirTemporario('maestro-link');
  try {
    fs.renameSync(path.join(p.dir, 'orkastery.yaml'), path.join(p.dir, 'devmaster.yaml'));
    assert.match(discoverMaestro({ cwd: p.dir }).manifest, /devmaster.yaml$/);
    fs.symlinkSync(p.dir, path.join(outer, 'alias'));
    assert.throws(() => discoverMaestro({ cwd: path.join(outer, 'alias') }), /scope/);
    fs.renameSync(path.join(p.dir, 'devmaster.yaml'), path.join(outer, 'manifest'));
    fs.symlinkSync(path.join(outer, 'manifest'), path.join(p.dir, 'orkastery.yaml'));
    assert.throws(() => discoverMaestro({ cwd: p.dir }), /scope/);
  } finally { p.limpar(); fs.rmSync(outer, { recursive: true }); }
});

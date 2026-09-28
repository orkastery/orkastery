import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimeFalso } from './apoio';
import { rodarFase, estadoParaDespacho } from '../src/phase';
import { executarRetry } from '../src/retry';
import { dirThread, novaThread, lerThread, gravarThread, listarIds } from '../src/thread';
import { garantirWorktree, auditarWorktree, sincronizarWorktree } from '../src/worktree';
import { adicionarClaim, lerClaims } from '../src/claims';
import { lerLedger, registrar } from '../src/ledger';
import { auditarEstado, vincularEstado, comEstadoParaGit } from '../src/estado-thread';
import { exec } from '../src/util';

test('escrita inesperada durante Git bloqueia e preserva a cópia e a fonte canônica', () => {
  const p = projetoTemporario('estado-escrita-concorrente');
  try {
    const t = novaThread(p.carregado, { nome: 'concorrente', modo: 'auto', criarWorktree: true }).thread;
    const local = path.join(t.worktree!, '.orkastery/threads', t.id);
    const main = dirThread(p.dir, t.id), antes = fs.readFileSync(path.join(main, 'ledger.jsonl'), 'utf8');
    assert.throws(() => comEstadoParaGit(p.dir, t.id, t.worktree!, () => {
      fs.writeFileSync(path.join(local, 'evento-novo.json'), '{"não":"descartar"}');
    }), /estado local alterado/);
    assert.equal(fs.readFileSync(path.join(local, 'evento-novo.json'), 'utf8'), '{"não":"descartar"}');
    assert.equal(fs.readFileSync(path.join(main, 'ledger.jsonl'), 'utf8'), antes);
    assert.equal(auditarEstado(p.dir, t.id, t.worktree!).nivel, 'fail');
  } finally { p.limpar(); }
});

for (const conflito of [false, true]) {
  test(`sync com estado versionado restaura vínculo após ${conflito ? 'aborto por conflito' : 'avanço da main'}`, () => {
    const p = projetoTemporario('estado-rebase');
    try {
      const t = novaThread(p.carregado, { nome: 'rebase', modo: 'auto' }).thread;
      t.worktree = path.join(p.dir, '.claude/worktrees/rebase');
      t.base.branch = 'teste-rebase';
      gravarThread(p.dir, t);
      const prefixo = `.orkastery/threads/${t.id}`, dir = dirThread(p.dir, t.id);
      assert.ok(exec('git', ['add', '-f', '--', prefixo], p.dir).ok);
      assert.ok(exec('git', ['commit', '-m', 'estado versionado'], p.dir).ok);
      assert.ok(exec('git', ['worktree', 'add', t.worktree, '-b', t.base.branch], p.dir).ok);
      vincularEstado(p.dir, t.id, t.worktree);
      fs.writeFileSync(path.join(t.worktree, 'README.md'), 'produto da thread\n');
      assert.ok(exec('git', ['commit', '-am', 'produto'], t.worktree).ok);
      const antes = exec('git', ['rev-parse', 'HEAD'], t.worktree).stdout.trim();
      registrar(dir, t.id, 'runtime_event', { prova: 'evento canônico preservado' });
      assert.ok(exec('git', ['add', '-f', '--', prefixo], p.dir).ok);
      if (conflito) {
        fs.writeFileSync(path.join(p.dir, 'README.md'), 'produto conflitante da main\n');
        assert.ok(exec('git', ['add', '--', 'README.md'], p.dir).ok);
      }
      assert.ok(exec('git', ['commit', '-m', 'main avançou'], p.dir).ok);
      const ledger = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8');
      const r = sincronizarWorktree(p.carregado, t.id);
      assert.equal(r.ok, !conflito, r.detalhe);
      assert.equal(fs.realpathSync(path.join(t.worktree, prefixo)), dir);
      assert.ok(fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').startsWith(ledger));
      assert.equal(exec('git', ['status', '--porcelain'], t.worktree).stdout.trim(), '');
      assert.match(exec('git', ['ls-files', '-v', '--', prefixo], p.dir).stdout, /^H /);
      assert.match(exec('git', ['ls-files', '-v', '--', prefixo], t.worktree).stdout, /^S /);
      assert.ok(exec('git', ['check-ignore', '.orkastery/state-backups/exemplo'], p.dir).ok);
      if (conflito) assert.equal(exec('git', ['rev-parse', 'HEAD'], t.worktree).stdout.trim(), antes);
      else assert.ok(exec('git', ['merge-base', '--is-ancestor', 'main', 'HEAD'], t.worktree).ok);
    } finally { p.limpar(); }
  });
}

test('sync também suporta estado que começou a ser versionado na base após o despacho', () => {
  const p = projetoTemporario('estado-adicionado-na-base');
  try {
    const t = novaThread(p.carregado, { nome: 'adicionado', modo: 'auto', criarWorktree: true }).thread;
    const prefixo = `.orkastery/threads/${t.id}`;
    assert.equal(exec('git', ['ls-files', '--', prefixo], t.worktree!).stdout.trim(), '');
    assert.ok(exec('git', ['add', '-f', '--', prefixo], p.dir).ok);
    assert.ok(exec('git', ['commit', '-m', 'estado passa a ser versionado'], p.dir).ok);
    const r = sincronizarWorktree(p.carregado, t.id);
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(auditarEstado(p.dir, t.id, t.worktree!).nivel, 'ok');
    assert.equal(exec('git', ['status', '--porcelain'], t.worktree!).stdout.trim(), '');
    assert.match(exec('git', ['ls-files', '-v', '--', prefixo], t.worktree!).stdout, /^S /);
  } finally { p.limpar(); }
});

test('estado versionado permanece na main e nunca entra como exclusão no commit da worktree', () => {
  const p = projetoTemporario('estado-versionado');
  try {
    const t = novaThread(p.carregado, { nome: 'versionada', modo: 'auto' }).thread;
    const estado = `.orkastery/threads/${t.id}`;
    assert.ok(exec('git', ['add', '-f', '--', estado], p.dir).ok);
    assert.ok(exec('git', ['commit', '-m', 'estado existente'], p.dir).ok);
    const wt = path.join(p.dir, 'wt');
    assert.ok(exec('git', ['worktree', 'add', wt, '-b', 'teste-estado'], p.dir).ok);
    vincularEstado(p.dir, t.id, wt, true);
    assert.equal(fs.lstatSync(path.join(wt, estado)).isSymbolicLink(), false);
    vincularEstado(p.dir, t.id, wt);
    const exclude = path.join(p.dir, '.git/info/exclude');
    fs.writeFileSync(exclude, fs.readFileSync(exclude, 'utf8').replace('/.orkastery/state-backups/', ''));
    vincularEstado(p.dir, t.id, wt);
    assert.ok(exec('git', ['check-ignore', '.orkastery/state-backups/exemplo'], p.dir).ok);
    assert.equal(exec('git', ['status', '--porcelain'], wt).stdout.trim(), '');
    assert.match(exec('git', ['ls-files', '-v', '--', estado], p.dir).stdout, /^H /);
    assert.match(exec('git', ['ls-files', '-v', '--', estado], wt).stdout, /^S /);
    fs.appendFileSync(path.join(wt, 'README.md'), '\nproduto\n');
    assert.ok(exec('git', ['commit', '-am', 'produto'], wt).ok);
    assert.equal(exec('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], wt).stdout.trim(), 'README.md');
    assert.ok(exec('git', ['merge', '--no-ff', 'teste-estado', '-m', 'merge'], p.dir).ok);
    assert.equal(fs.lstatSync(path.join(p.dir, estado)).isDirectory(), true);
    assert.equal(auditarEstado(p.dir, t.id, wt).nivel, 'ok');
  } finally { p.limpar(); }
});

test('dry-run prevê vínculo ausente e conflito sem modificar estado ou índice', () => {
  const p = projetoTemporario('estado-ensaio');
  try {
    const t = novaThread(p.carregado, { nome: 'ensaio', modo: 'auto', criarWorktree: true }).thread;
    const local = path.join(t.worktree!, '.orkastery/threads', t.id);
    fs.unlinkSync(local);
    assert.equal(estadoParaDespacho(p.dir, t, true), null);
    assert.equal(fs.existsSync(local), false);
    fs.mkdirSync(local); fs.writeFileSync(path.join(local, 'thread.json'), '{}');
    assert.match(estadoParaDespacho(p.dir, t, true)!, /estado dividido/);
    assert.equal(fs.readFileSync(path.join(local, 'thread.json'), 'utf8'), '{}');
  } finally { p.limpar(); }
});

test('estado único: thread, claims e phase_result escritos da worktree chegam à main', () => {
  const p = projetoTemporario('estado-unico');
  try {
    const t = novaThread(p.carregado, { nome: 'estado', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    const local = path.join(wt, '.orkastery/threads', t.id);
    assert.equal(fs.realpathSync(local), dirThread(p.dir, t.id));
    assert.equal(dirThread(wt, t.id), dirThread(p.dir, t.id));
    assert.ok(listarIds(wt).includes(t.id));
    adicionarClaim(wt, t.id, { arquivo: 'README.md', alegacao: 'arquivo existe', verificar: ['test -f README.md'] });
    assert.equal(lerClaims(p.dir, t.id).length, 1);
    registrar(dirThread(wt, t.id), t.id, 'phase_result', { fase: 'GO', estado: 'concluida' });
    assert.equal(lerLedger(dirThread(p.dir, t.id)).at(-1)?.tipo, 'phase_result');
    const state = lerThread(wt, t.id); state.faseAtual = 'CHECK'; gravarThread(wt, state);
    assert.equal(lerThread(p.dir, t.id).faseAtual, 'CHECK');
    assert.equal(auditarEstado(p.dir, t.id, wt).nivel, 'ok');
  } finally { p.limpar(); }
});

test('fx-estado-dividido: 90 eventos locais e 14 na main reprovam sem descartar cópias', () => {
  const p = projetoTemporario('estado-dividido');
  try {
    const t = novaThread(p.carregado, { nome: 'dividido', modo: 'auto' }).thread;
    const wt = garantirWorktree(p.carregado, t.id).dir;
    const main = dirThread(p.dir, t.id), local = path.join(wt, '.orkastery/threads', t.id);
    fs.unlinkSync(local); fs.mkdirSync(local);
    const events = Array.from({length:90}, (_,i)=>JSON.stringify({tipo:'runtime_event', n:i})+'\n');
    fs.writeFileSync(path.join(main,'ledger.jsonl'), events.slice(0,14).join(''));
    fs.writeFileSync(path.join(local,'ledger.jsonl'), events.join(''));
    assert.equal(auditarEstado(p.dir,t.id,wt).nivel,'fail');
    assert.match(auditarEstado(p.dir,t.id,wt).detalhe,/main=14 eventos, worktree=90/);
    assert.equal(auditarWorktree(p.carregado,t.id).ok,false);
    const before = fs.readFileSync(path.join(local,'ledger.jsonl'),'utf8');
    const sync = sincronizarWorktree(p.carregado,t.id);
    assert.equal(sync.ok,false); assert.equal(sync.motivo,'tree.blocked');
    assert.equal(fs.readFileSync(path.join(local,'ledger.jsonl'),'utf8'),before);
  } finally { p.limpar(); }
});

test('sync restaura vínculo ausente e recusa link para estado de outra thread', () => {
  const p = projetoTemporario('estado-link');
  try {
    const t = novaThread(p.carregado,{nome:'link',modo:'auto'}).thread;
    const wt = garantirWorktree(p.carregado,t.id).dir;
    const local = path.join(wt,'.orkastery/threads',t.id);
    fs.unlinkSync(local);
    assert.equal(sincronizarWorktree(p.carregado,t.id).ok,true);
    assert.equal(auditarEstado(p.dir,t.id,wt).nivel,'ok');
    fs.unlinkSync(local); fs.symlinkSync(p.dir,local,'dir');
    assert.equal(garantirWorktree(p.carregado,t.id).ok,false);
    assert.equal(fs.realpathSync(local),p.dir);
  } finally { p.limpar(); }
});

test('despacho de thread legada restaura vínculo ausente e bloqueia estado conflitante antes do runtime', t => {
  const p=projetoTemporario('dispatch-estado'), runtime=runtimeFalso('dispatch-estado');
  t.after(()=>{runtime.restaurar();p.limpar();});
  const thread=novaThread(p.carregado,{nome:'legada',modo:'auto',criarWorktree:true}).thread;
  const local=path.join(thread.worktree!,'.orkastery/threads',thread.id);
  fs.unlinkSync(local);
  assert.equal(rodarFase(p.carregado,thread.id,{fase:'GO',prompt:'Implementar tarefa'}).bloqueado,false);
  assert.equal(fs.realpathSync(local),dirThread(p.dir,thread.id));
  fs.unlinkSync(local);fs.mkdirSync(local);fs.writeFileSync(path.join(local,'thread.json'),'{}');
  const antes=runtime.chamadas().length;
  const r=rodarFase(p.carregado,thread.id,{fase:'GO',prompt:'Continuar tarefa'});
  assert.equal(r.bloqueado,true);assert.equal(r.motivo,'tree.blocked');
  assert.equal(runtime.chamadas().length,antes);
  const despachos = runtime.chamadas().filter(l => l.startsWith('--bg')).length;
  const retry=executarRetry(p.carregado,thread.id,{motivo:'runtime.silencio',fase:'GO'});
  assert.equal(retry.executada, false); assert.equal(retry.redespacho, null);
  assert.match(retry.plano.razao, /prova terminal/);
  assert.equal(runtime.chamadas().filter(l => l.startsWith('--bg')).length, despachos);
  assert.equal(fs.readFileSync(path.join(local,'thread.json'),'utf8'),'{}');
});

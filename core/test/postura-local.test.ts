/**
 * RM-047 (P1 e P2): as regras de `postura-local.ts` e `procedencia.ts` por dentro. O comportamento
 * de ponta a ponta (despacho, retomada, verify, prova, pulse e digest) está em
 * `procedencia-e-postura.test.ts`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirTemporario } from '../src/sandbox';
import { exec } from '../src/util';
import {
  caminhoDaPosturaLocal, confirmarPosturaLocal, lerPosturaLocal, posturaAfrouxada, POSTURAS_QUE_AFROUXAM, recusaDePostura,
  revogarPosturaLocal,
} from '../src/postura-local';
import { cwdLocalOuNulo, exigirCwdLocal, exigirHostLocal, rastreadoPeloGit } from '../src/procedencia';

const manifesto = (sandbox: string) => ({ runtime: { adapter: 'codex', model: 'm', effort: 'high', provider_policy: 'subscription-only', sandbox } });

test('postura: só danger-full-access afrouxa; read-only e workspace-write valem sem confirmação', () => {
  assert.deepEqual([...POSTURAS_QUE_AFROUXAM], ['danger-full-access']);
  assert.equal(posturaAfrouxada(manifesto('danger-full-access')), 'danger-full-access');
  for (const s of ['read-only', 'workspace-write']) assert.equal(posturaAfrouxada(manifesto(s)), null);
  const p = projetoTemporario('postura-sem-confirmacao');
  try {
    assert.equal(recusaDePostura(p.dir, manifesto('read-only'), 'codex'), null);
    assert.equal(recusaDePostura(p.dir, manifesto('danger-full-access'), 'claude-bg'), null, 'só o codex recebe o sandbox');
    assert.match(String(recusaDePostura(p.dir, manifesto('danger-full-access'), 'codex')), /sem confirmação local/);
  } finally { p.limpar(); }
});

test('postura: a confirmação é 0600 numa pasta 0700, vale só para este checkout e some ao revogar', () => {
  const p = projetoTemporario('postura-checkout');
  const copia = path.join(dirTemporario('postura-copia'), 'clone');
  try {
    const c = confirmarPosturaLocal(p.dir, 'danger-full-access', 'teste');
    assert.equal(c.raiz, fs.realpathSync(p.dir));
    assert.equal(fs.statSync(path.dirname(caminhoDaPosturaLocal(p.dir))).mode & 0o777, 0o700);
    assert.equal(fs.statSync(caminhoDaPosturaLocal(p.dir)).mode & 0o777, 0o600);
    assert.equal(recusaDePostura(p.dir, manifesto('danger-full-access'), 'codex'), null);

    // O mesmo arquivo copiado para outro checkout não confirma lá.
    fs.cpSync(p.dir, copia, { recursive: true });
    fs.chmodSync(path.join(copia, '.orkastery', 'private'), 0o700);
    fs.chmodSync(caminhoDaPosturaLocal(copia), 0o600);
    assert.equal(lerPosturaLocal(copia).postura, null);
    assert.match(String(lerPosturaLocal(copia).motivo), /outro checkout/);

    // Modo aberto (como o git deixaria um arquivo que veio no clone) não vale.
    fs.chmodSync(caminhoDaPosturaLocal(p.dir), 0o644);
    assert.match(String(lerPosturaLocal(p.dir).motivo), /0600/);
    fs.chmodSync(caminhoDaPosturaLocal(p.dir), 0o600);

    assert.equal(revogarPosturaLocal(p.dir), true);
    assert.equal(revogarPosturaLocal(p.dir), false);
    assert.notEqual(recusaDePostura(p.dir, manifesto('danger-full-access'), 'codex'), null);
    assert.throws(() => confirmarPosturaLocal(p.dir, 'sem-sandbox', 'teste'), /^Error: runtime\.sandbox-invalido/);
  } finally { p.limpar(); fs.rmSync(path.dirname(copia), { recursive: true, force: true }); }
});

test('procedência: rastreado é o que está no índice; a raiz vale sempre e a worktree só registrada', () => {
  const p = projetoTemporario('procedencia-regras');
  const solto = dirTemporario('procedencia-solto');
  try {
    assert.equal(rastreadoPeloGit(p.dir, path.join(p.dir, 'README.md')), true);
    assert.equal(rastreadoPeloGit(p.dir, path.join(p.dir, '.orkastery', 'nada.json')), false);
    assert.equal(rastreadoPeloGit(p.dir, '/etc/hostname'), false, 'fora da raiz não é estado do repositório');
    assert.equal(exigirCwdLocal(p.dir, 'ork-x', p.dir, 'ledger'), p.dir);
    assert.equal(cwdLocalOuNulo(p.dir, 'ork-x', solto, 'ledger'), null);
    assert.equal(cwdLocalOuNulo(p.dir, 'ork-x', 'relativo', 'thread'), null);
    const wt = path.join(dirTemporario('procedencia-wt'), 'wt');
    assert.equal(exec('git', ['worktree', 'add', '-q', '-b', 'ork/procedencia', wt], p.dir).ok, true);
    assert.equal(exigirCwdLocal(p.dir, 'ork-x', wt, 'thread'), wt);
    exec('git', ['worktree', 'remove', '--force', wt], p.dir);
    fs.rmSync(path.dirname(wt), { recursive: true, force: true });
  } finally { p.limpar(); fs.rmSync(solto, { recursive: true, force: true }); }
});

test('procedência: o arquivo de host precisa ser arquivo comum local, não link nem versionado', () => {
  const p = projetoTemporario('procedencia-host');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    const host = path.join(monitor, 'pulse-host.json');
    exigirHostLocal(p.dir, host);
    fs.writeFileSync(path.join(p.dir, 'alvo.json'), '{}');
    fs.symlinkSync(path.join(p.dir, 'alvo.json'), host);
    assert.throws(() => exigirHostLocal(p.dir, host), /^Error: transporte\.rastreado: .*arquivo comum/);
    fs.unlinkSync(host);
    fs.writeFileSync(host, '{}');
    exigirHostLocal(p.dir, host);
  } finally { p.limpar(); }
});

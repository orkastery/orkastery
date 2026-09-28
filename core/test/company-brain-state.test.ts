import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProduct, listEntities } from '../src/portfolio';
import { gravarEtapa, lerOnboarding, onboardingPadrao } from '../src/onboarding';
import { projectState, stateFileStatus } from '../src/project-state';

export function stateFixture() {
  // Metadata de linked WT sintética; nenhum repositório operacional é alterado.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-brain-state-'));
  const main = path.join(base, 'main'), wt = path.join(base, 'wt');
  const admin = path.join(main, '.git/worktrees/test');
  fs.mkdirSync(admin, { recursive: true });
  fs.mkdirSync(path.join(wt, '.orkastery'), { recursive: true });
  fs.mkdirSync(path.join(main, '.orkastery'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${admin}\n`);
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  createProduct(main, { id: 'prod-synthetic', title: 'Sintético', ownerId: 'Maestro' });
  fs.writeFileSync(path.join(main, '.orkastery/onboarding.json'), JSON.stringify(onboardingPadrao()));
  gravarEtapa(main, 'memoria', { modo: 'orkmind' }, 'owner-sintetico');
  return { main, wt, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('T02: WT lê e escreve os mesmos IDs e respostas da autoridade, preservando cópia divergente', () => {
  const p = stateFixture();
  try {
    const local = path.join(p.wt, '.orkastery/portfolio.json');
    fs.writeFileSync(local, '{"copia":"legada"}');
    assert.deepEqual(listEntities(p.wt), listEntities(p.main));
    assert.deepEqual(lerOnboarding(p.wt), lerOnboarding(p.main));
    assert.equal(stateFileStatus(p.wt, 'portfolio.json').divergent, true);
    createProduct(p.wt, { id: 'prod-second', title: 'Novo' });
    gravarEtapa(p.wt, 'arquitetura', 'contrato sintético', 'pessoa-sintetica');
    assert.equal(listEntities(p.main).length, 2);
    assert.equal(lerOnboarding(p.main).etapas.arquitetura?.por, 'pessoa-sintetica');
    assert.equal(fs.readFileSync(local, 'utf8'), '{"copia":"legada"}');
    assert.equal(fs.existsSync(path.join(p.wt, '.orkastery/onboarding.json')), false);
    assert.ok(fs.existsSync(path.join(p.main, '.orkastery/ledger.jsonl')));
  } finally { p.cleanup(); }
});

test('T02: ausência, corrupção e root inválida nunca viram catálogo/entrevista vazios na WT', () => {
  const p = stateFixture();
  try {
    for (const name of ['portfolio.json', 'onboarding.json']) {
      const target = path.join(p.main, '.orkastery', name);
      fs.writeFileSync(target, '{');
      assert.throws(() => name === 'portfolio.json' ? listEntities(p.wt) : lerOnboarding(p.wt));
      fs.unlinkSync(target);
      assert.throws(() => name === 'portfolio.json' ? listEntities(p.wt) : lerOnboarding(p.wt), /project-state.source/);
      assert.equal(fs.existsSync(path.join(p.wt, '.orkastery', name)), false);
    }
    fs.writeFileSync(path.join(p.wt, '.git'), 'inválido');
    assert.throws(() => projectState(p.wt), /project-state.root.invalid/);
    assert.throws(() => lerOnboarding(p.wt), /project-state.root.invalid/);
  } finally { p.cleanup(); }
});

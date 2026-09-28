/**
 * I-52 (RM-047, fatia 3): o setup por bloco versionado no repositorio, e o local lido da raiz de
 * estado. Worktrees e clones de verdade, em projetos temporarios.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { caminhoSetupLocal, caminhoSetupVersionado, configDoBloco, editarBloco, lerSetup, linhaDaOrigemDoSetup,
  NOME_SETUP_VERSIONADO, origemDoSetup, versionarSetup } from '../src/setup';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function worktree(dir: string, nome: string): { dir: string; limpar: () => void } {
  const base = dirTemporario(`${nome}-wt`);
  const wt = path.join(base, 'wt');
  const r = exec('git', ['worktree', 'add', '-q', '-b', `teste/${nome}`, wt], dir);
  assert.equal(r.ok, true, r.stderr);
  return { dir: wt, limpar: () => { exec('git', ['worktree', 'remove', '--force', wt], dir); fs.rmSync(base, { recursive: true, force: true }); } };
}

test('o setup local vem da raiz de estado: a worktree enxerga o mesmo que o checkout principal', () => {
  const p = projetoTemporario('setup-worktree');
  const wt = worktree(p.dir, 'setup-worktree');
  try {
    assert.equal(origemDoSetup(p.dir), 'padrao');
    const r = editarBloco(p.dir, 'auto', 1, { model: 'sonnet', effort: 'xhigh' }, 'teste');
    assert.equal(r.ok, true, r.erro);
    assert.equal(r.caminho, caminhoSetupLocal(p.dir));
    // Antes da I-52 a worktree lia o proprio .orkastery e caia no default sem aviso.
    assert.equal(caminhoSetupLocal(wt.dir), caminhoSetupLocal(p.dir));
    assert.equal(origemDoSetup(wt.dir), 'local');
    assert.deepEqual(configDoBloco(lerSetup(wt.dir), 'auto', 'GO'), configDoBloco(lerSetup(p.dir), 'auto', 'GO'));
    assert.equal(configDoBloco(lerSetup(wt.dir), 'auto', 'GO')?.model, 'sonnet');
    assert.match(linhaDaOrigemDoSetup(wt.dir), /Setup local desta maquina.*ork setup versionar/);
  } finally { wt.limpar(); p.limpar(); }
});

test('versionar leva o setup que vale para o repositorio, e dali em diante e ele que vale e que se edita', () => {
  const p = projetoTemporario('setup-versionar');
  try {
    assert.equal(editarBloco(p.dir, 'classic', 2, { model: 'sonnet' }, 'teste').ok, true);
    const local = fs.readFileSync(caminhoSetupLocal(p.dir), 'utf8');

    const v = versionarSetup(p.dir, 'teste');
    assert.equal(v.caminho, path.join(p.dir, NOME_SETUP_VERSIONADO));
    assert.equal(origemDoSetup(p.dir), 'versionado');
    assert.equal(lerSetup(p.dir).modos.classic.blocos[1].model, 'sonnet', 'o versionado nasce igual ao que valia');
    assert.throws(() => versionarSetup(p.dir), /setup\.versionado: orkastery\.setup\.json ja existe/);

    // A edicao passa a gravar no versionado; o local fica como estava, ignorado.
    const r = editarBloco(p.dir, 'classic', 3, { effort: 'max' }, 'teste');
    assert.equal(r.ok, true, r.erro);
    assert.equal(r.caminho, caminhoSetupVersionado(p.dir));
    assert.equal(fs.readFileSync(caminhoSetupLocal(p.dir), 'utf8'), local);
    assert.equal(lerSetup(p.dir).modos.classic.blocos[2].effort, 'max');
    assert.match(linhaDaOrigemDoSetup(p.dir), /Setup versionado em orkastery\.setup\.json.*local desta maquina fica ignorado/);

    // O evento vai ao ledger do projeto, na raiz de estado.
    const ledger = fs.readFileSync(path.join(p.dir, '.orkastery', 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"acao":"versionar","de":"local","para":"orkastery.setup.json"/);
  } finally { p.limpar(); }
});

test('outra maquina: o clone le o setup versionado sem setup local nenhum', () => {
  const p = projetoTemporario('setup-clone', true);
  const outro = dirTemporario('setup-clone-b');
  try {
    assert.equal(editarBloco(p.dir, 'maestro', 1, { model: 'sonnet', effort: 'medium' }, 'teste').ok, true);
    versionarSetup(p.dir, 'teste');
    exec('git', ['add', NOME_SETUP_VERSIONADO], p.dir);
    exec('git', ['commit', '-q', '-m', 'setup versionado'], p.dir);
    exec('git', ['push', '-q', 'origin', 'main'], p.dir);
    const b = path.join(outro, 'clone');
    assert.equal(exec('git', ['clone', '-q', p.remoto as string, b]).ok, true);
    assert.equal(fs.existsSync(caminhoSetupLocal(b)), false);
    assert.equal(origemDoSetup(b), 'versionado');
    assert.deepEqual(lerSetup(b).modos.maestro.blocos[0], lerSetup(p.dir).modos.maestro.blocos[0]);
  } finally { p.limpar(); fs.rmSync(outro, { recursive: true, force: true }); }
});

test('setup versionado invalido e recusado com o caminho dele, nunca vira default em silencio', () => {
  const p = projetoTemporario('setup-invalido');
  try {
    fs.writeFileSync(caminhoSetupVersionado(p.dir), '{ nao e json');
    assert.throws(() => lerSetup(p.dir), (e: Error) => e.message.includes(NOME_SETUP_VERSIONADO));
  } finally { p.limpar(); }
});

test('CLI: ork setup versionar e a linha de origem no ork setup', () => {
  const p = projetoTemporario('setup-cli');
  try {
    const ork = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 60000 });
    assert.match(ork('setup').stdout, /Nenhum setup gravado: vale o default/);
    const v = ork('setup', 'versionar');
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /Setup versionado em .*orkastery\.setup\.json/);
    assert.match(ork('setup', 'auto').stdout, /Setup versionado em orkastery\.setup\.json: vale para todas as maquinas/);
    const de_novo = ork('setup', 'versionar');
    assert.notEqual(de_novo.status, 0);
    assert.match(de_novo.stderr, /ja existe/);
  } finally { p.limpar(); }
});

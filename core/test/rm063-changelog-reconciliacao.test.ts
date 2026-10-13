/**
 * RM-063 (F7): a reconciliacao deterministica do CHANGELOG no merge da base na branch da thread.
 *
 * Incidente de 12 e 13/10/2026: os PRs #153 e #154 esperaram de 5 a 6 horas pelo condutor, e cada merge da outra
 * maquina na `main` reabriu o conflito no CHANGELOG. Duas formas: o PR de versao leva `## Não publicado` para a versao e
 * o merge poe os itens da thread dentro dela, sem conflito; ou duas threads acrescentam no topo do mesmo grupo e o merge
 * conflita so no CHANGELOG. Os itens da thread voltam a `## Não publicado`, no mesmo grupo; conflito em codigo aborta.
 *
 * Prova pura (os tres textos) e prova com git de verdade: projeto temporario, remoto bare e a `main` avancada por um
 * segundo clone, como o GitHub faria.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commitar, dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { reconciliarChangelog, temMarcadorDeConflito } from '../src/changelog-reconciliacao';
import { atualizarBranchDaThread } from '../src/atualizar-branch';
import { lerThread, novaThread } from '../src/thread';
import { garantirWorktree } from '../src/worktree';
import { exec } from '../src/util';

const CABECALHO = '# Changelog\n\nAs mudanças do pacote, da mais nova para a mais antiga.\n\n';
const item = (nome: string, linhas = 1): string =>
  [`- **${nome}** (RM-000): o que muda para quem usa`, ...Array.from({ length: linhas - 1 }, (_, i) => `  continuação ${i + 1} de ${nome}.`)].join('\n');
const doc = (...secoes: string[]): string => CABECALHO + secoes.join('\n\n') + '\n';
const secao = (titulo: string, grupos: Record<string, string[]>): string =>
  [titulo, ...Object.entries(grupos).map(([g, itens]) => `### ${g}\n\n${itens.join('\n')}`)].join('\n\n');

/** Os itens de cada secao (`## ...`), pelo titulo da primeira linha de cada item. */
function mapa(texto: string): Record<string, Record<string, string[]>> {
  const r: Record<string, Record<string, string[]>> = {};
  let s = '', g = '';
  for (const l of texto.split('\n')) {
    if (l.startsWith('## ')) { s = l.slice(3); r[s] = {}; g = ''; continue; }
    if (l.startsWith('### ')) { g = l.slice(4); r[s][g] = []; continue; }
    const m = /^- \*\*(.+?)\*\*/.exec(l);
    if (m) (r[s][g] ??= []).push(m[1]);
  }
  return r;
}

const ANTIGO = secao('## [0.5.6] - 2026-10-12', { Adicionado: [item('antigo publicado', 2)] });

test('F7: o PR de versao levou "Não publicado" para a versao; o item da thread volta, no mesmo grupo', () => {
  const base = doc(secao('## Não publicado', { Adicionado: [item('da outra thread', 2)] }), ANTIGO);
  const nosso = doc(secao('## Não publicado', { Adicionado: [item('da outra thread', 2), item('da thread', 3)], Corrigido: [item('conserto da thread')] }), ANTIGO);
  const deles = doc('## Não publicado', secao('## [0.5.7] - 2026-10-13', { Adicionado: [item('da outra thread', 2)] }), ANTIGO);
  // O merge sem conflito do git: os itens da thread caem dentro da versao publicada.
  const mesclado = doc('## Não publicado', secao('## [0.5.7] - 2026-10-13',
    { Adicionado: [item('da outra thread', 2), item('da thread', 3)], Corrigido: [item('conserto da thread')] }), ANTIGO);
  const r = reconciliarChangelog({ base, nosso, deles, mesclado });
  assert.deepEqual(mapa(r.texto), {
    'Não publicado': { Adicionado: ['da thread'], Corrigido: ['conserto da thread'] },
    '[0.5.7] - 2026-10-13': { Adicionado: ['da outra thread'] },
    '[0.5.6] - 2026-10-12': { Adicionado: ['antigo publicado'] },
  });
  assert.equal(r.devolvidos, 2);
  assert.ok(r.texto.includes(item('da thread', 3)), 'o item volta inteiro, com as linhas de continuacao');
  assert.doesNotMatch(r.texto, /\n\n\n/, 'nenhuma linha em branco repetida (MD012)');
  // Ja reconciliado, de novo nao muda nada.
  const deNovo = reconciliarChangelog({ base, nosso, deles, mesclado: r.texto });
  assert.deepEqual([deNovo.mudou, deNovo.devolvidos, deNovo.texto], [false, 0, r.texto]);
});

test('F7: conflito so no CHANGELOG (as duas no topo do grupo); vale o da main e o da thread entra no fim do grupo', () => {
  const base = doc(secao('## Não publicado', { Adicionado: [item('antes')] }), ANTIGO);
  const nosso = doc(secao('## Não publicado', { Adicionado: [item('da thread', 2), item('antes')] }), ANTIGO);
  const deles = doc(secao('## Não publicado', { Adicionado: [item('da outra maquina'), item('antes')] }), ANTIGO);
  const comMarcador = deles.replace(item('da outra maquina'), `<<<<<<< HEAD\n${item('da thread', 2)}\n=======\n${item('da outra maquina')}\n>>>>>>> origin/main`);
  assert.equal(temMarcadorDeConflito(comMarcador), true);
  const r = reconciliarChangelog({ base, nosso, deles, mesclado: comMarcador });
  assert.equal(temMarcadorDeConflito(r.texto), false);
  assert.deepEqual(mapa(r.texto)['Não publicado'], { Adicionado: ['da outra maquina', 'antes', 'da thread'] });
});

test('F7: o grupo que falta nasce na ordem do CHANGELOG; o item reescrito pela thread nao duplica', () => {
  const base = doc(secao('## Não publicado', { Adicionado: [item('da thread v1')] }), ANTIGO);
  // A thread reescreveu o proprio item e acrescentou um conserto; a main acrescentou uma linha de seguranca.
  const nosso = doc(secao('## Não publicado', { Adicionado: [item('da thread v2')], Corrigido: [item('conserto')] }), ANTIGO);
  const deles = doc(secao('## Não publicado', { Adicionado: [item('da thread v1')], Segurança: [item('cofre')] }), ANTIGO);
  const r = reconciliarChangelog({ base, nosso, deles });
  assert.deepEqual(mapa(r.texto)['Não publicado'], { Adicionado: ['da thread v2'], Corrigido: ['conserto'], Segurança: ['cofre'] });
});

test('F7: item da thread que a main ja tem fica onde a main o pos; sem "Não publicado" na main, a secao nasce antes da versao', () => {
  const base = doc(ANTIGO);
  const nosso = doc(secao('## Não publicado', { Adicionado: [item('ja publicado pela main'), item('novo da thread')] }), ANTIGO);
  const deles = doc(secao('## [0.5.7] - 2026-10-13', { Adicionado: [item('ja publicado pela main')] }), ANTIGO);
  const r = reconciliarChangelog({ base, nosso, deles });
  assert.deepEqual(Object.keys(mapa(r.texto)), ['Não publicado', '[0.5.7] - 2026-10-13', '[0.5.6] - 2026-10-12']);
  assert.deepEqual(mapa(r.texto)['Não publicado'], { Adicionado: ['novo da thread'] });
  assert.deepEqual(mapa(r.texto)['[0.5.7] - 2026-10-13'], { Adicionado: ['ja publicado pela main'] });
});

// ---------------------------------------------------------------------------
// Com git de verdade.
// ---------------------------------------------------------------------------

/** O projeto com CHANGELOG na main (local e remota) e a thread com worktree e uma linha propria no CHANGELOG. */
function cenario(nome: string, changelog: string): { p: ProjetoDeTeste; thread: string; wt: string } {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'CHANGELOG.md', changelog, 'docs: changelog');
  commitar(p.dir, 'src/app.ts', 'export const valor = 1;\n', 'feat: app');
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  assert.equal(garantirWorktree(p.carregado, thread.id).ok, true);
  const wt = lerThread(p.dir, thread.id).worktree as string;
  return { p, thread: thread.id, wt };
}

/** A main avancada no "GitHub": um segundo clone muda arquivos e empurra. */
function mainAvanca(p: ProjetoDeTeste, mudancas: Record<string, string>, mensagem: string): void {
  const outro = dirTemporario('rm063-f7-github');
  assert.equal(exec('git', ['clone', '-q', p.remoto as string, outro]).ok, true);
  for (const [k, v] of [['user.email', 'github@orkastery.local'], ['user.name', 'GitHub Simulado'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], outro);
  for (const [arquivo, conteudo] of Object.entries(mudancas)) {
    fs.mkdirSync(path.dirname(path.join(outro, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(outro, arquivo), conteudo);
  }
  assert.equal(exec('git', ['add', '-A'], outro).ok, true);
  assert.equal(exec('git', ['commit', '-q', '-m', mensagem], outro).ok, true);
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], outro).ok, true);
  fs.rmSync(outro, { recursive: true, force: true });
}

const CHECADOR = path.resolve(__dirname, '../../scripts/checar-changelog.cjs');

test('F7 com git: a versao publicada na main nao engole o item da thread; o checador do CI passa depois do merge', () => {
  const inicial = doc(secao('## Não publicado', { Adicionado: [item('da outra thread')] }), ANTIGO);
  const { p, thread, wt } = cenario('rm063-f7-versao', inicial);
  try {
    const daThread = doc(secao('## Não publicado', { Adicionado: [item('da outra thread'), item('da thread', 2)] }), ANTIGO);
    commitar(wt, 'CHANGELOG.md', daThread, 'docs(thread): linha da fatia');
    commitar(wt, 'src/novo.ts', 'export const novo = 2;\n', 'feat(thread): produto');
    mainAvanca(p, { 'CHANGELOG.md': doc('## Não publicado', secao('## [0.5.7] - 2026-10-13', { Adicionado: [item('da outra thread')] }), ANTIGO) },
      'chore: versao 0.5.7');
    const r = atualizarBranchDaThread(p.carregado, thread, { enviar: true });
    assert.equal(r.acao, 'mesclada', JSON.stringify(r));
    if (r.acao !== 'mesclada') return;
    assert.deepEqual([r.changelog?.devolvidos, r.enviada], [1, true]);
    const final = fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8');
    assert.deepEqual(mapa(final)['Não publicado'], { Adicionado: ['da thread'] });
    assert.deepEqual(mapa(final)['[0.5.7] - 2026-10-13'], { Adicionado: ['da outra thread'] });
    assert.equal(exec('git', ['status', '--porcelain'], wt).stdout.trim(), '', 'a worktree ficou limpa, com o merge commitado');
    assert.match(exec('git', ['log', '-1', '--format=%s'], wt).stdout, /^Merge da origin\/main na ork\/.*: 1 item\(ns\) da thread de volta/);
    // O mesmo checador do job `documentacao`, contra a main de verdade.
    const c = spawnSync(process.execPath, [CHECADOR, '--base', 'origin/main', '--head', 'HEAD', wt], { cwd: wt, encoding: 'utf8' });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    // De novo: nada a mesclar.
    assert.equal(atualizarBranchDaThread(p.carregado, thread).acao, 'ja-atualizada');
  } finally { p.limpar(); }
});

test('F7 com git: conflito so no CHANGELOG e resolvido; conflito em codigo aborta e devolve os arquivos', () => {
  const inicial = doc(secao('## Não publicado', { Adicionado: [item('antes')] }), ANTIGO);
  const { p, thread, wt } = cenario('rm063-f7-conflito', inicial);
  try {
    commitar(wt, 'CHANGELOG.md', doc(secao('## Não publicado', { Adicionado: [item('da thread'), item('antes')] }), ANTIGO), 'docs(thread): linha');
    mainAvanca(p, { 'CHANGELOG.md': doc(secao('## Não publicado', { Adicionado: [item('da outra maquina'), item('antes')] }), ANTIGO) }, 'docs: outra');
    const r = atualizarBranchDaThread(p.carregado, thread);
    assert.equal(r.acao, 'mesclada', JSON.stringify(r));
    assert.deepEqual(mapa(fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8'))['Não publicado'],
      { Adicionado: ['da outra maquina', 'antes', 'da thread'] });
    assert.equal(r.acao === 'mesclada' && r.enviada, false, 'sem --enviar, nada sai desta maquina');

    // Agora o codigo: as duas mudam a mesma linha do app.
    const antes = exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    commitar(wt, 'src/app.ts', 'export const valor = 2;\n', 'feat(thread): valor 2');
    const comCodigo = exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    mainAvanca(p, { 'src/app.ts': 'export const valor = 3;\n',
      'CHANGELOG.md': doc(secao('## Não publicado', { Adicionado: [item('mais uma'), item('da outra maquina'), item('antes')] }), ANTIGO) },
      'feat: valor 3');
    const c = atualizarBranchDaThread(p.carregado, thread);
    assert.deepEqual(c.acao === 'conflito-em-codigo' ? c.arquivos : c, ['src/app.ts']);
    assert.equal(exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim(), comCodigo, 'o HEAD nao andou');
    assert.equal(exec('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], wt).ok, false, 'o merge foi abortado');
    assert.equal(exec('git', ['status', '--porcelain'], wt).stdout.trim(), '', 'a worktree voltou limpa');
    assert.notEqual(antes, comCodigo);
  } finally { p.limpar(); }
});

test('F7 com git: worktree suja e thread conduzida recusam antes de tocar em nada', () => {
  const { p, thread, wt } = cenario('rm063-f7-recusas', doc(secao('## Não publicado', { Adicionado: [item('antes')] }), ANTIGO));
  try {
    mainAvanca(p, { 'outro.txt': 'x\n' }, 'feat: outro');
    fs.writeFileSync(path.join(wt, 'src', 'app.ts'), 'export const valor = 9;\n');
    const suja = atualizarBranchDaThread(p.carregado, thread);
    assert.deepEqual(suja.acao === 'recusada' ? suja.motivo : suja, 'worktree-suja');
    exec('git', ['checkout', '--', 'src/app.ts'], wt);
    // Uma reserva de outro canal conduz a thread: o merge nao entra por cima.
    const { assumirConducao } = require('../src/conducao') as typeof import('../src/conducao');
    assert.equal(assumirConducao(p.dir, thread, { por: 'Dona Simulada', motivo: 'teste', canal: 'hermes' }).ok, true);
    const conduzida = atualizarBranchDaThread(p.carregado, thread, { canal: 'cli' });
    assert.deepEqual(conduzida.acao === 'recusada' ? conduzida.motivo : conduzida, 'conduzida');
  } finally { p.limpar(); }
});

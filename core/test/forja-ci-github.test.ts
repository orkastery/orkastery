import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { consultarCiDoRepositorio, ExecutorCi } from '../src/ci';

const SHA = 'a'.repeat(40);
const run = (id: number, conclusion: string, extra: Record<string, unknown> = {}) => ({ id, name: 'ork-verify', status: 'completed',
  conclusion, completed_at: `2026-10-13T10:${String(id % 60).padStart(2, '0')}:00Z`, app: { slug: 'github-actions' }, ...extra });

function forja(paginas: unknown[][], statuses: unknown[] = []): { executor: ExecutorCi; caminhos: string[] } {
  const caminhos: string[] = [];
  const total = paginas.flat().length;
  return { caminhos, executor: (e) => {
    caminhos.push(e.caminho ?? '');
    if ((e.caminho ?? '').includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: JSON.stringify(statuses) };
    const pagina = Number(/[?&]page=(\d+)/.exec(e.caminho ?? '')?.[1] ?? '1');
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ total_count: total, check_runs: paginas[pagina - 1] ?? [] }) };
  } };
}

test('acha o ork-verify na segunda página', () => {
  const outros = Array.from({ length: 100 }, (_, i) => ({ ...run(i + 1, 'success'), name: 'ork-verify', app: { slug: 'outro-app' }, conclusion: 'success' }));
  const { executor, caminhos } = forja([outros, [run(500, 'success')]]);
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor);
  assert.equal(r.state, 'success');
  assert.ok(caminhos.some((c) => /page=2/.test(c)));
});

// Decisao do controlador (seguranca): status verde sozinho nao aprova; sem lista de produtores confiaveis, qualquer
// um com escrita de status forjaria o gate.
test('só commit status ork-verify verde não passa (missing)', () => {
  const { executor } = forja([[]], [{ id: 1, context: 'ork-verify', state: 'success', target_url: 'https://x', updated_at: '2026-10-13T10:00:00Z', creator: { login: 'bot' } }]);
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor);
  assert.equal(r.state, 'missing');
  assert.equal(r.ok, false);
  assert.match(r.detail, /commit status/);
});

test('dois commit statuses verdes de criadores diferentes também não passam', () => {
  const st = (id: number, login: string) => ({ id, context: 'ork-verify', state: 'success', updated_at: '2026-10-13T10:00:00Z', creator: { login } });
  const { executor } = forja([[]], [st(2, 'bot'), st(1, 'outro-bot')]);
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'missing');
});

test('check-run verde + status vermelho de outro criador → failure', () => {
  const { executor } = forja([[run(2, 'success')]], [{ id: 9, context: 'ork-verify', state: 'failure', updated_at: '2026-10-13T10:05:00Z', creator: { login: 'bot' } }]);
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor);
  assert.equal(r.state, 'failure');
  assert.match(r.detail, /github-actions/);
  assert.match(r.detail, /bot/);
});

test('check-run verde + status pendente: espera', () => {
  const { executor } = forja([[run(2, 'success')]], [{ id: 9, context: 'ork-verify', state: 'pending', updated_at: '2026-10-13T10:05:00Z', creator: { login: 'bot' } }]);
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'pending');
});

test('check-run verde + status verde: passa (a aprovação vem do check-run)', () => {
  const { executor } = forja([[run(2, 'success')]], [{ id: 9, context: 'ork-verify', state: 'success', updated_at: '2026-10-13T10:05:00Z', creator: { login: 'bot' } }]);
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'success');
});

test('status de outro contexto é ignorado', () => {
  const { executor } = forja([[run(2, 'success')]], [{ id: 9, context: 'outro', state: 'failure', creator: { login: 'bot' } }]);
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'success');
});

test('as duas chamadas vão ao host pedido, e mais de 10 páginas cita o teto', () => {
  const hosts: Array<string | undefined> = [];
  const { executor } = forja([[run(2, 'success')]]);
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', (e) => { hosts.push(e.host); return executor(e); }, 'ghe.empresa.com:8443');
  assert.equal(r.state, 'success');
  assert.deepEqual(hosts, ['ghe.empresa.com:8443', 'ghe.empresa.com:8443']);
  const cheia = Array.from({ length: 100 }, (_, i) => run(i + 1, 'success'));
  const muitas = forja(Array.from({ length: 11 }, () => cheia));
  assert.match(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', muitas.executor).detail, /1000/);
});

test('fora de ordem: vale o mais novo do mesmo produtor', () => {
  const { executor } = forja([[run(2, 'success'), run(1, 'failure')]]);
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'success');
});

test('dois produtores, um vermelho: reprova e cita os dois', () => {
  const { executor } = forja([[run(2, 'success'), run(3, 'failure', { app: { slug: 'impostor' } })]]);
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor);
  assert.equal(r.state, 'failure');
  assert.match(r.detail, /github-actions/);
  assert.match(r.detail, /impostor/);
});

test('mais de 10 páginas é incompleto, não ausente', () => {
  const cheia = Array.from({ length: 100 }, (_, i) => ({ ...run(i + 1, 'success'), name: 'ork-verify' }));
  const { executor } = forja(Array.from({ length: 11 }, () => cheia));
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'unavailable');
});

test('fake antigo que devolve check-runs para os statuses: indisponível, nunca verde', () => {
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', () => ({ ok: true, code: 0, stderr: '',
    stdout: JSON.stringify({ check_runs: [run(1, 'success')] }) }));
  assert.equal(r.state, 'unavailable');
});

test('fixture gravada do GitHub (check-runs e statuses de 2026-10): ork-verify verde', () => {
  const FIX = path.resolve(__dirname, '../../test/fixtures/forja/github/2026-10');
  const corpo = (nome: string) => JSON.stringify((JSON.parse(fs.readFileSync(path.join(FIX, nome), 'utf8')) as { corpo: unknown }).corpo);
  const caminhos: string[] = [];
  const executor: ExecutorCi = (e) => {
    caminhos.push(e.caminho ?? '');
    return { ok: true, code: 0, stderr: '', stdout: corpo((e.caminho ?? '').includes('/statuses') ? 'statuses.json' : 'check-runs.json') };
  };
  const r = consultarCiDoRepositorio('orkastery/orkastery', '9436d3e076e66353e8e47f39c4457ed1d9bc3dc8', 'ork-verify', executor);
  assert.equal(r.state, 'success');
  assert.ok(r.url);
  assert.ok(caminhos.some((c) => c.includes('/check-runs?check_name=ork-verify')));
  assert.ok(caminhos.some((c) => c.endsWith('/statuses?per_page=100&page=1')));
});

// Rodada de correção 1.
test('status vermelho do ork-verify na segunda página de statuses reprova, mesmo com check-run verde', () => {
  const alheios = Array.from({ length: 100 }, (_, i) => ({ id: 1000 - i, context: `outro-${i}`, state: 'success', creator: { login: 'bot' } }));
  const vermelho = { id: 1, context: 'ork-verify', state: 'failure', updated_at: '2026-10-13T10:05:00Z', creator: { login: 'bot' } };
  const executor: ExecutorCi = (e) => {
    const c = e.caminho ?? '';
    const pagina = Number(/[?&]page=(\d+)/.exec(c)?.[1] ?? '1');
    if (c.includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: JSON.stringify(pagina === 1 ? alheios : pagina === 2 ? [vermelho] : []) };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ total_count: 1, check_runs: pagina === 1 ? [run(2, 'success')] : [] }) };
  };
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'failure');
});

test('mais de 10 páginas de statuses é incompleto', () => {
  const cheia = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, context: `outro-${i}`, state: 'success', creator: { login: 'bot' } }));
  const executor: ExecutorCi = (e) => (e.caminho ?? '').includes('/statuses')
    ? { ok: true, code: 0, stderr: '', stdout: JSON.stringify(cheia) }
    : { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ total_count: 1, check_runs: [run(2, 'success')] }) };
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor);
  assert.equal(r.state, 'unavailable');
  assert.match(r.detail, /1000/);
});

test('total_count baixo não encerra a lista: a página cheia pede a próxima', () => {
  const cheia = Array.from({ length: 100 }, (_, i) => run(i + 1, 'success'));
  const novo = { ...run(200, 'failure'), completed_at: '2026-10-13T11:00:00Z' };
  const executor: ExecutorCi = (e) => {
    const c = e.caminho ?? '';
    if (c.includes('/statuses')) return { ok: true, code: 0, stderr: '', stdout: '[]' };
    const pagina = Number(/[?&]page=(\d+)/.exec(c)?.[1] ?? '1');
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ total_count: 100, check_runs: pagina === 1 ? cheia : pagina === 2 ? [novo] : [] }) };
  };
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'failure');
});

test('vários produtores: o bloqueado mostra o motivo no detalhe', () => {
  const { executor } = forja([[run(2, 'success'), run(3, 'skipped', { app: { slug: 'outro-app' } })]]);
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor);
  assert.equal(r.state, 'failure');
  assert.match(r.detail, /outro-app bloqueado \(skipped\)/);
});

test('lista de check-runs que acaba antes do total_count declarado é incompleta', () => {
  const executor: ExecutorCi = (e) => (e.caminho ?? '').includes('/statuses')
    ? { ok: true, code: 0, stderr: '', stdout: '[]' }
    : { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ total_count: 5, check_runs: [run(2, 'success')] }) };
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', executor).state, 'unavailable');
});

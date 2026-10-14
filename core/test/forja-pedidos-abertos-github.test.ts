import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ForjaResolvida } from '../src/forja/contrato';
import { adaptadorDaForja } from '../src/forja/registro';
import { ExecutorDoGh, LIMITES_DOS_PEDIDOS } from '../src/parado-no-condutor';
import { gravado } from './forja-cli-falsa';

const FORJA: ForjaResolvida = { tipo: 'github', host: 'github.com', porta: null, caminhoBase: '', sshHost: null, sshPorta: null, ca: null,
  repo: 'orkastery/orkastery', origem: { tipo: 'remoto', host: 'remoto', porta: 'padrao', caminhoBase: 'padrao' } };
const NUNCA = () => { throw new Error('o GitHub do pulse nao chama a API REST'); };

function gh(responder: (args: readonly string[]) => unknown[] | null) {
  const chamadas: string[][] = [];
  const executor: ExecutorDoGh = (args) => {
    chamadas.push([...args]);
    const lista = responder(args);
    return lista ? { status: 0, stdout: JSON.stringify(lista), stderr: '' } : { status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' };
  };
  return { chamadas, executor };
}

test('pedidosAbertos do GitHub: abertos com o rollup, recentes e a candidata conferida, pelo gh pr list de sempre', () => {
  const mesclado = gravado('github/2026-10/pr-list') as unknown[];
  const g = gh((args) => (args.includes('--state=open') ? [] : args.some((a) => a.startsWith('--head=')) ? [] : mesclado));
  const r = adaptadorDaForja('github').pedidosAbertos!({ forja: FORJA, base: 'main', candidatas: ['ork/ork-x'], api: NUNCA,
    executor: g.executor, resta: () => 60000, orcamentoMs: 60000, limites: LIMITES_DOS_PEDIDOS });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.valor.prs.map((p) => [p.numero, p.estado, p.branch]), [[164, 'mesclado', 'ork/ork-f3bvariantes-go']]);
  assert.equal(r.valor.parcial, false);
  assert.deepEqual(r.valor.semConferir, []);
  assert.deepEqual(g.chamadas.map((c) => c.slice(0, 4)), [
    ['pr', 'list', '--repo=github.com/orkastery/orkastery', '--base=main'],
    ['pr', 'list', '--repo=github.com/orkastery/orkastery', '--base=main'],
    ['pr', 'list', '--repo=github.com/orkastery/orkastery', '--base=main'],
  ]);
  assert.ok(g.chamadas[0].includes('--limit=200') && g.chamadas[0].some((a) => a.includes('statusCheckRollup')));
  assert.ok(g.chamadas[2].includes('--head=ork/ork-x'));
});

test('pedidosAbertos do GitHub: falha e orçamento esgotado voltam a frase de sempre, tipada', () => {
  const r = adaptadorDaForja('github').pedidosAbertos!({ forja: FORJA, base: 'main', candidatas: [], api: NUNCA,
    executor: gh(() => null).executor, resta: () => 60000, orcamentoMs: 60000, limites: LIMITES_DOS_PEDIDOS });
  assert.equal(!r.ok && r.erro.codigo, 'forja.indisponivel');
  assert.equal(!r.ok && r.erro.detalhe, 'gh pr list falhou (código 1): HTTP 502: Bad Gateway');
  const sem = adaptadorDaForja('github').pedidosAbertos!({ forja: FORJA, base: 'main', candidatas: [], api: NUNCA,
    executor: gh(() => []).executor, resta: () => 0, orcamentoMs: 60000, limites: LIMITES_DOS_PEDIDOS });
  assert.equal(!sem.ok && sem.erro.detalhe, 'gh pr list: orçamento de 60 s da leitura esgotado');
});

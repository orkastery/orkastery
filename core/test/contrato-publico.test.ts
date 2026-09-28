/**
 * I-42 (D7, T7): a fronteira de contrato publico do `#Fast`.
 *
 * A regra e por caminho, grossa de proposito. Este arquivo prova a lista e a funcao;
 * a aplicacao no commit MCP mora em `mcp-git.test.ts` (Git real, integracao local) e a
 * aplicacao na entrega mora em `ship.test.ts`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { contratosTocados, ehContratoPublico, PATHS_DE_CONTRATO_PUBLICO } from '../src/contrato-publico';

const RAIZ_DO_REPO = path.resolve(__dirname, '..', '..', '..');

test('os donos das unioes, dos contratos versionados e dos esquemas sao contrato publico', () => {
  for (const caminho of [
    'core/src/types.ts',
    'core/src/modos.ts',
    'core/src/ledger.ts',
    'core/src/hitl-contract.ts',
    'core/src/pulse.ts',
    'core/src/master.ts',
    'core/src/setup.ts',
    'core/src/mcp-server.ts',
    'core/src/contrato-publico.ts',
    'core/schemas/claims.schema.json',
    'core/schemas/qualquer/coisa.json',
    './core/src/types.ts',
  ]) {
    assert.equal(ehContratoPublico(caminho), true, caminho);
  }
});

test('arquivo comum nao e contrato publico, nem quando o nome parece', () => {
  for (const caminho of [
    'core/src/board.ts',
    'core/src/claims.ts',
    'core/test/types.test.ts',
    'core/src/types.ts.bak',
    'docs/guias/modos.md',
    'README.md',
    'core/schemas',
    'outro/core/src/types.ts',
  ]) {
    assert.equal(ehContratoPublico(caminho), false, caminho);
  }
});

test('contratosTocados devolve so os caminhos protegidos, na ordem do commit', () => {
  assert.deepEqual(
    contratosTocados(['README.md', 'core/src/types.ts', 'core/src/board.ts', 'core/schemas/x.json']),
    ['core/src/types.ts', 'core/schemas/x.json']
  );
  assert.deepEqual(contratosTocados(['docs/roadmap/README.md']), []);
});

test('todo caminho da lista existe no repositorio: a fronteira nao protege fantasma', () => {
  for (const p of PATHS_DE_CONTRATO_PUBLICO) {
    const alvo = path.join(RAIZ_DO_REPO, p);
    assert.ok(fs.existsSync(alvo), `${p} nao existe`);
    assert.equal(fs.statSync(alvo).isDirectory(), p.endsWith('/'), `${p}: diretorio termina em /`);
  }
});

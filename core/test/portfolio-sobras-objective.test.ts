/**
 * RM-043 (sobra achada na varredura da RM-044): `portfolio show` herdou do `objective`, aposentado
 * na I-43, cinco opcoes na ajuda: `--constraints`, `--outcomes`, `--threads`, `--execution-runtime`
 * e `--validation-runtimes`. O `comandoPortfolio` so le `--json` no `show`, e o `parseArgs` aceita
 * qualquer `--opcao`: as cinco eram aceitas e ignoradas em silencio. Quem as tinha num script
 * achava que o envelope ainda valia.
 *
 * Agora elas saem da ajuda e a recusa e tipada, no padrao do `objective.aposentado`: diz para
 * onde ir (`--exige-runtime-diferente` e `--done` de thread).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { createProduct } from '../src/portfolio';

const CLI = path.resolve(__dirname, '../src/index.js');
const SOBRAS = ['constraints', 'outcomes', 'threads', 'execution-runtime', 'validation-runtimes'];

function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), codigo: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { saida: (err.stdout ?? '') + (err.stderr ?? ''), codigo: err.status ?? 1 };
  }
}

test('portfolio show recusa as sobras do objective, com motivo tipado e a substituta', () => {
  const p = projetoTemporario('portfolio-sobras');
  try {
    createProduct(p.dir, { id: 'prod-alfa', title: 'Produto A' });
    for (const opcao of SOBRAS) {
      const r = ork(p.dir, ['portfolio', 'show', 'prod-alfa', `--${opcao}`, 'x']);
      assert.equal(r.codigo, 2, `--${opcao} deveria recusar: ${r.saida}`);
      assert.match(r.saida, /portfolio\.opcao-aposentada/, r.saida);
      assert.match(r.saida, new RegExp(`--${opcao}`), r.saida);
      assert.match(r.saida, /--exige-runtime-diferente/, r.saida);
      assert.match(r.saida, /--done/, r.saida);
      assert.doesNotMatch(r.saida, /Produto A/, 'recusa antes de mostrar a entidade');
    }
    // O uso vivo segue: show com e sem --json.
    const vivo = ork(p.dir, ['portfolio', 'show', 'prod-alfa']);
    assert.equal(vivo.codigo, 0, vivo.saida);
    assert.match(vivo.saida, /Produto A/);
    const json = ork(p.dir, ['portfolio', 'show', 'prod-alfa', '--json']);
    assert.equal(json.codigo, 0, json.saida);
    assert.equal(JSON.parse(json.saida).id, 'prod-alfa');
  } finally { p.limpar(); }
});

test('a ajuda nao lista mais as sobras do objective', () => {
  const p = projetoTemporario('portfolio-sobras-ajuda');
  try {
    const ajuda = ork(p.dir, ['--help']).saida;
    assert.match(ajuda, /portfolio show <id> \[--json\]/);
    for (const opcao of SOBRAS) {
      assert.doesNotMatch(ajuda, new RegExp(`\\[--${opcao}\\b`), `--${opcao} ainda na ajuda`);
    }
  } finally { p.limpar(); }
});

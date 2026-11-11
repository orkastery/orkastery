/** RM-089 F1: política empresarial de recibo no `ork ci run`. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto } from '../src/manifest';
import { projetoTemporario } from './apoio';

function comPolitica(valor?: string) {
  const p = projetoTemporario(`rm089-politica-${valor ?? 'ausente'}`, false);
  const arquivo = path.join(p.dir, 'orkastery.yaml');
  if (valor !== undefined) {
    const atual = fs.readFileSync(arquivo, 'utf8');
    fs.writeFileSync(arquivo, atual.replace('  context: ork-verify\n', `  context: ork-verify\n  politica_recibo: ${valor}\n`));
  }
  return { p, carregado: carregarManifesto(p.dir)! };
}

test('manifesto sem política preserva a ausência; os níveis conhecidos são aceitos', () => {
  const sem = comPolitica();
  try {
    assert.deepEqual(sem.carregado.erros, []);
    assert.equal('politica_recibo' in sem.carregado.manifesto.ci, false);
  } finally { sem.p.limpar(); }
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    const c = comPolitica(nivel);
    try {
      assert.deepEqual(c.carregado.erros, []);
      assert.equal(c.carregado.manifesto.ci.politica_recibo, nivel);
    } finally { c.p.limpar(); }
  }
});

test('manifesto recusa política de recibo desconhecida com mensagem acionável', () => {
  const c = comPolitica('tolerar');
  try {
    assert.ok(c.carregado.erros.some((e) => /ci\.politica_recibo invalida.*observar, avisar ou exigir/.test(e)), c.carregado.erros.join(' | '));
  } finally { c.p.limpar(); }
});

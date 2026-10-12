/**
 * RM-037 (ork-rm037esperas): as esperas que nunca terminam. Em 12/10/2026, sessoes de fase esperaram para sempre por
 * verify ou suite mandados para segundo plano com `&` (o processo morreu com a chamada) e por lacos de espera com
 * `pgrep -f` que acham a si mesmos, porque o proprio laco traz o texto procurado. Os nomes comecam por R (a regra).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REGRA_DAS_ESPERAS, valoresDoPrompt } from '../src/phase';
import { renderizar, templateDaFase, threadDeExemplo } from '../src/prompts';
import { Modo } from '../src/types';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const MODOS_VIVOS: Modo[] = ['classic', 'maestro', 'auto', 'fast'];

test('R1: o prompt de toda fase, em todo modo, traz a regra das esperas numa linha so, uma vez, no lugar da linha da N2', () => {
  // Os tres pontos do pedido, um a um, numa linha so.
  for (const trecho of ['nunca dispare verify, build ou suite com `&` dentro do comando',
    'rode o `ork verify` em primeiro plano, com `timeout`', 'use a execucao em segundo plano do host, que avisa quando termina',
    'nunca espere com `pgrep -f` cujo padrao aparece no proprio comando', 'espere pelo arquivo de saida com prazo, ou pelo PID guardado']) {
    assert.ok(REGRA_DAS_ESPERAS.includes(trecho), trecho);
  }
  assert.ok(!REGRA_DAS_ESPERAS.includes('\n'), 'uma linha so');
  let prompts = 0;
  for (const modo of MODOS_VIVOS) {
    for (const fase of threadDeExemplo(modo, 'GO').fases) {
      const linhas = renderizar(templateDaFase(fase), valoresDoPrompt(threadDeExemplo(modo, fase), fase, 'pedido do builder')).split('\n');
      assert.equal(linhas.filter((l) => l === `- ${REGRA_DAS_ESPERAS}`).length, 1, `${modo} ${fase}`);
      assert.equal(linhas.filter((l) => l.includes('pgrep -f')).length, 1, `${modo} ${fase}`);
      assert.equal(linhas.some((l) => l.includes('Verify, build e suite rodam em primeiro plano')), false, 'a linha da N2 saiu');
      prompts++;
    }
  }
  assert.ok(prompts >= 7, `${prompts} prompts`);
  // O que o `ork prompt render` mostra, pelo CLI, fora de qualquer projeto.
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm037-render-'));
  try {
    const env = { ...process.env };
    delete env.ORK_PROJETO;
    delete env.ORK_PROJETO_EXPLICITO;
    const r = spawnSync(process.execPath, [ORK, 'prompt', 'render', '--exemplo', '--fase', 'GO', '--modo', 'auto'],
      { cwd: fora, encoding: 'utf8', env, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split('\n').includes(`- ${REGRA_DAS_ESPERAS}`), r.stdout);
  } finally { fs.rmSync(fora, { recursive: true, force: true }); }
});

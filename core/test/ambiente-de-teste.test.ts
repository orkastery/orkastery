/**
 * RM-037: o skip tipado de ambiente. Hermético: a sonda é injetada, nada aqui procura codex,
 * Docker ou OrkMind de verdade.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DependenciaDeTeste, MOTIVO_DA_FALTA, semAmbiente, VARIAVEL_EXIGE_AMBIENTE } from './ambiente-de-teste';
import { TESTES_DE_INTEGRACAO_LOCAL } from '../src/integracoes-locais';

const presentes = (...p: DependenciaDeTeste[]) => (d: DependenciaDeTeste) => p.includes(d);

test('RM-037: dependência presente não pula; ausente pula com o motivo tipado de cada falta', () => {
  assert.equal(semAmbiente(['codex-sandbox'], { sonda: presentes('codex-sandbox'), env: {} }), false);
  assert.equal(semAmbiente(['postgres'], { sonda: presentes(), env: {} }),
    'skip: PostgreSQL ausente (Docker com a imagem pgvector/pgvector:pg16)');
  assert.equal(semAmbiente(['postgres', 'orkmind', 'postgres'], { sonda: presentes('postgres'), env: {} }),
    'skip: ' + MOTIVO_DA_FALTA.orkmind);
  assert.equal(semAmbiente(['codex-sandbox', 'orkmind'], { sonda: presentes(), env: {} }),
    `skip: ${MOTIVO_DA_FALTA['codex-sandbox']}; ${MOTIVO_DA_FALTA.orkmind}`);
});

test('RM-037: ORK_TESTE_EXIGE_AMBIENTE=1 nunca pula, nem sem nenhuma dependência; outro valor não liga', () => {
  assert.equal(VARIAVEL_EXIGE_AMBIENTE, 'ORK_TESTE_EXIGE_AMBIENTE');
  let sondou = false;
  const sonda = () => { sondou = true; return false; };
  assert.equal(semAmbiente(['codex-sandbox', 'orkmind', 'postgres'], { sonda, env: { ORK_TESTE_EXIGE_AMBIENTE: '1' } }), false);
  assert.equal(sondou, false, 'exigido, o teste roda sem sondar e reprova pela falta real');
  for (const valor of ['0', 'true', '', undefined])
    assert.match(String(semAmbiente(['orkmind'], { sonda, env: { ORK_TESTE_EXIGE_AMBIENTE: valor } })), /^skip: /);
});

test('RM-037: só arquivo de integração local usa o skip de ambiente, então nenhum teste com ele roda no CI hermético', () => {
  const dir = __dirname.endsWith(path.join('dist-test', 'test'))
    ? path.resolve(__dirname, '../../test') : __dirname;
  const usam = fs.readdirSync(dir).filter(n => n.endsWith('.test.ts') && n !== 'ambiente-de-teste.test.ts')
    .filter(n => /from '\.\/ambiente-de-teste'/.test(fs.readFileSync(path.join(dir, n), 'utf8')))
    .map(n => n.replace(/\.ts$/, '.js')).sort();
  assert.ok(usam.length >= 15, `esperados os 15 arquivos de integração local, achados ${usam.length}`);
  for (const nome of usam) assert.ok(TESTES_DE_INTEGRACAO_LOCAL.has(nome), `${nome} pula por ambiente mas roda no CI hermético`);
});

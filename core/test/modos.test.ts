/** Testes da matriz de modos de conducao. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  blocoDaFase,
  extrairTagAposentadaDoPedido,
  extrairTagDoPedido,
  fasePausa,
  INVARIANTES,
  MODOS,
  MODOS_APOSENTADOS,
  MODOS_LEGADOS,
  ORDEM_DOS_MODOS,
  parseModo,
  pausasDoModo,
  tabelaDeModos,
} from '../src/modos';
import { FASES, ModoLegado } from '../src/types';

/**
 * A matriz da visao: blocos e pausas humanas esperados por modo.
 *
 * I-43: a matriz continua cobrindo os aposentados, porque e dela que sai a estrutura
 * de uma thread antiga que ainda abre. Quem encolheu foi `ORDEM_DOS_MODOS`, a lista de
 * escrita. I-42: o `#Fast` entra no fim do espectro, com um bloco so e so a GO.
 */
const ESPERADO: Record<ModoLegado, { blocos: number; pausas: number; ciclo: string }> = {
  look: { blocos: 6, pausas: 6, ciclo: 'GOAL / PLAN / GO / CHECK / SHIP / MASTER' },
  ork: { blocos: 5, pausas: 5, ciclo: 'GOAL-PLAN / GO / CHECK / SHIP / MASTER' },
  classic: { blocos: 4, pausas: 3, ciclo: 'GOAL / PLAN / GO-CHECK / SHIP-MASTER' },
  maestro: { blocos: 3, pausas: 1, ciclo: 'GOAL-PLAN / GO-CHECK-SHIP / MASTER' },
  auto: { blocos: 1, pausas: 0, ciclo: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER' },
  fast: { blocos: 1, pausas: 0, ciclo: 'GO' },
};

test('a matriz tem os 6; so os 4 vivos sao escreviveis, com o #Fast no fim do espectro', () => {
  assert.deepEqual([...MODOS_LEGADOS], ['look', 'ork', 'classic', 'maestro', 'auto', 'fast']);
  assert.equal(Object.keys(MODOS).length, 6);
  assert.deepEqual([...ORDEM_DOS_MODOS], ['classic', 'maestro', 'auto', 'fast']);
});

test('cada modo tem o numero certo de blocos e de pausas humanas', () => {
  for (const modo of MODOS_LEGADOS) {
    const esperado = ESPERADO[modo];
    assert.equal(MODOS[modo].blocos.length, esperado.blocos, `blocos de ${modo}`);
    assert.equal(pausasDoModo(modo), esperado.pausas, `pausas de ${modo}`);
    assert.equal(MODOS[modo].pausas, esperado.pausas, `campo pausas de ${modo}`);
    assert.equal(
      MODOS[modo].blocos.map((b) => b.fases.join('-')).join(' / '),
      esperado.ciclo,
      `ciclo de ${modo}`
    );
  }
});

test('todo modo de ciclo completo cobre as 6 fases canonicas, sem repetir e sem pular', () => {
  for (const modo of MODOS_LEGADOS) {
    const fases = MODOS[modo].blocos.flatMap((b) => b.fases);
    // I-42: o #Fast e o unico modo de bloco unico e parcial: so a GO, sem cerimonia.
    if (modo === 'fast') {
      assert.deepEqual(fases, ['GO']);
      continue;
    }
    assert.deepEqual(fases, [...FASES], `fases do modo ${modo}`);
  }
});

test('o #Fast: slug `go`, zero pausa e as fases em ordem canonica', () => {
  const [unico, ...resto] = MODOS.fast.blocos;
  assert.equal(resto.length, 0);
  assert.equal(unico.slugFases, 'go');
  assert.equal(unico.pausa, false);
  assert.equal(fasePausa('fast', 'GO'), false);
  assert.throws(() => blocoDaFase('fast', 'CHECK'), /nao pertence a nenhum bloco do modo fast/);
});

test('parse da #TAG aceita so o modo vivo e rejeita o resto', () => {
  assert.equal(parseModo('#Auto'), 'auto');
  assert.equal(parseModo('auto'), 'auto');
  assert.equal(parseModo('#MAESTRO'), 'maestro');
  assert.equal(parseModo('#Classic'), 'classic');
  assert.equal(parseModo('#Fast'), 'fast');
  assert.equal(parseModo('fast'), 'fast');
  // I-43: `--modo ork` era aceito e passa a ser recusado no portao de ESCRITA.
  assert.equal(parseModo('--modo ork'), null);
  assert.equal(parseModo('#Look'), null);
  // `default` saiu do espectro: quem escrever a tag antiga tem erro, nao um modo calado.
  assert.equal(parseModo('#Default'), null);
  assert.equal(parseModo('#Turbo'), null);
  assert.equal(parseModo(''), null);
  assert.equal(parseModo(undefined), null);
});

test('extracao da #TAG do pedido em texto livre do builder', () => {
  assert.equal(extrairTagDoPedido('Arruma o checkout do carrinho #Maestro por favor'), 'maestro');
  assert.equal(extrairTagDoPedido('sem tag aqui'), null);
  // I-43: a tag aposentada nao vira modo, e tambem nao some: ela e reconhecida
  // por `extrairTagAposentadaDoPedido`, que e o caminho da recusa com motivo.
  assert.equal(extrairTagDoPedido('#look primeiro, depois vemos'), null);
  assert.equal(extrairTagAposentadaDoPedido('#look primeiro, depois vemos'), 'look');
  assert.equal(extrairTagDoPedido('Entrega confiavel #Classic'), 'classic');
  assert.equal(extrairTagDoPedido('Ritmo antigo #Default'), null);
  assert.equal(extrairTagDoPedido('arruma o typo no README #Fast'), 'fast');
  assert.equal(extrairTagDoPedido('#fastlane nao e tag de modo'), null);
});

test('toda #TAG viva resolve pelo pedido, sem repetir a lista no teste', () => {
  // I-42 (T2): a regex vem da matriz. Um modo novo em ORDEM_DOS_MODOS e reconhecido
  // no pedido sem uma linha a mais em lugar nenhum; este teste percorre a propria matriz.
  for (const modo of ORDEM_DOS_MODOS) {
    assert.equal(extrairTagDoPedido(`pedido qualquer ${MODOS[modo].tag}`), modo, MODOS[modo].tag);
    assert.equal(extrairTagDoPedido(`pedido qualquer ${MODOS[modo].tag.toUpperCase()}.`), modo);
  }
});

test('a pausa acontece na ultima fase do bloco que pausa', () => {
  // #Ork, aposentado e ainda legivel: pausa em PLAN (fim de GOAL-PLAN), GO, CHECK,
  // SHIP e MASTER. A estrutura da thread de 03/09 nao muda por ela ter se aposentado.
  assert.equal(fasePausa('ork', 'GOAL'), false);
  assert.equal(fasePausa('ork', 'PLAN'), true);
  assert.equal(fasePausa('ork', 'GO'), true);
  assert.equal(fasePausa('ork', 'CHECK'), true);
  assert.equal(fasePausa('ork', 'SHIP'), true);
  assert.equal(fasePausa('ork', 'MASTER'), true);
  // #Classic: pausa em GOAL, PLAN e CHECK (fim de GO-CHECK); SHIP-MASTER segue sozinho.
  assert.equal(fasePausa('classic', 'GOAL'), true);
  assert.equal(fasePausa('classic', 'PLAN'), true);
  assert.equal(fasePausa('classic', 'GO'), false);
  assert.equal(fasePausa('classic', 'CHECK'), true);
  assert.equal(fasePausa('classic', 'SHIP'), false);
  assert.equal(fasePausa('classic', 'MASTER'), false);
  // #Auto: nenhuma pausa em nenhuma fase.
  for (const fase of FASES) assert.equal(fasePausa('auto', fase), false, `auto em ${fase}`);
  // #Maestro: unica pausa e nas premissas (fim de GOAL-PLAN).
  assert.equal(fasePausa('maestro', 'PLAN'), true);
  assert.equal(fasePausa('maestro', 'SHIP'), false);
  assert.equal(fasePausa('maestro', 'MASTER'), false);
});

test('cada fase do ciclo pertence a exatamente um bloco do modo', () => {
  for (const modo of MODOS_LEGADOS) {
    for (const fase of MODOS[modo].blocos.flatMap((b) => b.fases)) {
      const bloco = blocoDaFase(modo, fase);
      assert.ok(bloco.fases.includes(fase));
    }
  }
});

test('a tabela de `ork modos` mostra so os vivos e a regra central', () => {
  const t = tabelaDeModos();
  for (const modo of ORDEM_DOS_MODOS) assert.ok(t.includes(MODOS[modo].tag), `falta ${modo}`);
  for (const modo of MODOS_APOSENTADOS) {
    assert.ok(!t.includes(MODOS[modo].tag), `a tabela ainda anuncia ${MODOS[modo].tag}`);
  }
  assert.ok(t.includes('o modo afrouxa a pausa, NUNCA a verificacao'));
  for (const inv of INVARIANTES) assert.ok(t.includes(inv));
});

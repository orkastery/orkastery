/** RM-058, bloco B: retomada entre máquinas com carências e recibo de fim. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado } from './noctum-apoio';
import { duasMaquinas, DuasMaquinas, MaquinaDeTeste } from './noctum-maquinas-apoio';
import {
  assumirAutoridade, bater, cancelarOrdem, cederAutoridade, emitirOrdem, encerrarOrdem, lerCoordenacao, responderOrdem,
  situacaoDoTrabalho,
} from '../src/noctum-coordenacao';
import { CARENCIA_DA_RETOMADA_MS, retomadaNaRede } from '../src/noctum-retomada-rede';

prepararIngressoSimulado();

const TRABALHO = { id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' };
const em = (base: string, ms: number): string => new Date(Date.parse(base) + ms).toISOString();
const op = (m: MaquinaDeTeste, quando: string) => ({ maquina: m.nome, quando });

function cenario(nome: string, trabalho: Record<string, unknown> = TRABALHO): { m: DuasMaquinas; t0: string } {
  const m = duasMaquinas(nome, { trabalhos: [trabalho as typeof TRABALHO], contas: [{ conta: 'perfil-a', sessoes: 2 }] });
  const t0 = new Date().toISOString();
  assumirAutoridade(m.a.carregado, m.arco, op(m.a, t0));
  bater(m.a.carregado, m.arco, op(m.a, t0));
  bater(m.b.carregado, m.arco, op(m.b, t0));
  return { m, t0 };
}

function ordemNaB(m: DuasMaquinas, t0: string): string {
  const ordem = emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: m.b.nome }, op(m.a, t0));
  responderOrdem(m.b.carregado, m.arco, ordem, 'aceita', 'SIMULADO', op(m.b, t0));
  return ordem;
}

test('RR1: autoridade sem sinal só é tomada depois de 15 minutos', () => {
  const { m, t0 } = cenario('noctum-rr1');
  try {
    assert.deepEqual(retomadaNaRede(m.b.carregado, m.arco, op(m.b, em(t0, 14 * 60_000))).acoes, []);
    const r = retomadaNaRede(m.b.carregado, m.arco, op(m.b, em(t0, 16 * 60_000)));
    assert.deepEqual(r.acoes, ['autoridade-tomada-sem-sinal']);
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, op(m.b, em(t0, 16 * 60_000))).autoridade!.maquina, m.b.nome);
  } finally { m.limpar(); }
});

test('RR2: a máquina indicada assume a autoridade cedida', () => {
  const { m, t0 } = cenario('noctum-rr2');
  try {
    cederAutoridade(m.a.carregado, m.arco, m.b.nome, 'SIMULADO: cessão', op(m.a, t0));
    const r = retomadaNaRede(m.b.carregado, m.arco, op(m.b, em(t0, 1000)));
    assert.deepEqual(r.acoes, ['autoridade-assumida-por-cessao']);
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, op(m.b, em(t0, 1000))).autoridade!.maquina, m.b.nome);
  } finally { m.limpar(); }
});

test('RR3: ordem só é cancelada depois da carência de 30 minutos, não aos 20', () => {
  const { m, t0 } = cenario('noctum-rr3');
  try {
    const ordem = ordemNaB(m, t0);
    assert.deepEqual(retomadaNaRede(m.a.carregado, m.arco, op(m.a, em(t0, 20 * 60_000))).acoes, []);
    const r = retomadaNaRede(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000)));
    assert.deepEqual(r.acoes, [`ordem-cancelada:${ordem}`]);
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000))).ordens.get(ordem)!.estado, 'isolada');
  } finally { m.limpar(); }
});

test('RR4: trabalho preso à máquina sem sinal nunca é cancelado pela retomada', () => {
  const { m, t0 } = cenario('noctum-rr4', { ...TRABALHO, maquina: 'maquina-b' });
  try {
    const ordem = ordemNaB(m, t0);
    const r = retomadaNaRede(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000)));
    assert.deepEqual(r.acoes, []);
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000))).ordens.get(ordem)!.estado, 'aceita');
  } finally { m.limpar(); }
});

test('RR5: ordem aceita cancelada fica isolada até o recibo de fim e só então transfere', () => {
  const { m, t0 } = cenario('noctum-rr5');
  try {
    const ordem = ordemNaB(m, t0);
    retomadaNaRede(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000)));
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000))), 'a')!.estado, 'isolado');
    assert.throws(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: m.a.nome }, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 2000))));
    encerrarOrdem(m.b.carregado, m.arco, ordem, { motivo: 'noctum.retomada.ordem-cancelada', checkpoint: { thread: null } },
      op(m.b, em(t0, CARENCIA_DA_RETOMADA_MS + 3000)));
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 3000))), 'a')!.estado, 'livre');
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: m.a.nome }, op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 4000))), 'O-a-2');
  } finally { m.limpar(); }
});

test('RR6: a máquina que volta enxerga sua ordem cancelada sem autorizar retomada local', () => {
  const { m, t0 } = cenario('noctum-rr6');
  try {
    const ordem = ordemNaB(m, t0);
    cancelarOrdem(m.a.carregado, m.arco, ordem, 'noctum.retomada.maquina-sem-sinal', op(m.a, em(t0, 1000)));
    const r = retomadaNaRede(m.b.carregado, m.arco, op(m.b, em(t0, 2000)));
    assert.deepEqual(r.canceladasLocais, [{ ordem, trabalho: 'a' }]);
  } finally { m.limpar(); }
});

test('RR7: a sobrevivente não recebe despacho enquanto a ordem antiga está isolada', () => {
  const { m, t0 } = cenario('noctum-rr7');
  try {
    const ordem = ordemNaB(m, t0);
    cancelarOrdem(m.a.carregado, m.arco, ordem, 'noctum.retomada.maquina-sem-sinal', op(m.a, em(t0, 1000)));
    assert.throws(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: m.a.nome }, op(m.a, em(t0, 2000))));
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a, em(t0, 2000))).ordens.size, 1);
  } finally { m.limpar(); }
});

test('RR8: rede sem leitura não cancela ordem nem toma autoridade', () => {
  const { m, t0 } = cenario('noctum-rr8');
  try {
    const ordem = ordemNaB(m, t0);
    const r = retomadaNaRede(m.a.carregado, m.arco, { ...op(m.a, em(t0, CARENCIA_DA_RETOMADA_MS + 1000)), remoto: 'sem-remoto' });
    assert.ok(r.lacuna);
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a, t0)).ordens.get(ordem)!.estado, 'aceita');
  } finally { m.limpar(); }
});

test('RR9: duas sobreviventes produzem uma só geração nova', () => {
  const { m, t0 } = cenario('noctum-rr9');
  try {
    retomadaNaRede(m.b.carregado, m.arco, op(m.b, em(t0, 16 * 60_000)));
    const perdeu = retomadaNaRede(m.a.carregado, m.arco, op(m.a, em(t0, 16 * 60_000 + 1000)));
    assert.ok(perdeu.lacuna || perdeu.acoes.length === 0);
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a, em(t0, 16 * 60_000 + 1000))).autoridades.length, 2);
  } finally { m.limpar(); }
});

test('RR10: envelope v2 não consulta o ramo de coordenação', () => {
  const p = projetoTemporario('noctum-rr10');
  try {
    const pedido = pedidoV2('arco-rr10', { trabalhos: [TRABALHO], contas: [{ conta: 'perfil-a', sessoes: 1 }] });
    autorizarPedido(p.dir, 'arco-rr10', pedido);
    const r = retomadaNaRede(p.carregado, 'arco-rr10', { maquina: 'maquina-a', remoto: 'sem-remoto' });
    assert.equal(r.aplicavel, false);
    assert.equal(r.lacuna, null);
  } finally { p.limpar(); }
});

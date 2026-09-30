/**
 * RM-037 (rm037defeito, defeito 4): `ork decisao registrar` com texto longo respondia "decisão informada
 * exige o que foi decidido, o porquê e como mudar", com os tres campos presentes. O contrato juntava
 * presenca, linha unica e teto numa condicao so. A recusa agora diz o campo e o tamanho real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { CAMPOS_DA_DECISAO_NO_CLI, CAMPOS_DA_DECISAO_NO_MCP, CONTRATO_HITL_V2, DecisaoInformada, recusaNaSuperficie, TETOS_HITL_V2,
  validarPedidoHitlV2 } from '../src/hitl-contract';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';

const ORK = path.resolve(__dirname, '../../dist/index.js');

const decidido = (extra: Partial<DecisaoInformada> = {}): unknown => ({
  contrato: CONTRATO_HITL_V2, id: 'd-1', thread: 'ork-rm037defeito', fase: 'PLAN', modo: 'auto',
  criadoEm: '2026-09-29T13:00:00.000Z', profundidade: 'resumo', classe: 'decidido',
  decidido: 'A baseline sai do despacho', porque: 'o sandbox nao grava o ledger', comoMudar: 'trocar a regra do despacho',
  custoDeReverter: { agora: 'uma funcao', depois: 'um PR pequeno' },
  criterio: { tipo: 'medicao', referencia: 'node --test core/dist-test/test/x.test.js' },
  ...extra,
});

test('defeito 4: campo presente acima do teto diz o campo e o tamanho, nao que o campo falta', () => {
  assert.equal(TETOS_HITL_V2.campoDaDecisao, 200);
  for (const campo of ['decidido', 'porque', 'comoMudar'] as const) {
    assert.throws(() => validarPedidoHitlV2(decidido({ [campo]: 'a'.repeat(201) } as never)),
      (e: Error) => e.message === `pedido HITL v2: decisão informada: ${campo} tem 201 caracteres; o teto é 200`, campo);
    assert.doesNotThrow(() => validarPedidoHitlV2(decidido({ [campo]: 'a'.repeat(200) } as never)), `${campo} no teto passa`);
  }
  assert.throws(() => validarPedidoHitlV2(decidido({ custoDeReverter: { agora: 'x'.repeat(141), depois: 'y' } })),
    /custo de reverter: custoDeReverter\.agora tem 141 caracteres; o teto é 140/);
  assert.throws(() => validarPedidoHitlV2(decidido({ custoDeReverter: { agora: 'x', depois: 'y'.repeat(150) } })),
    /custo de reverter: custoDeReverter\.depois tem 150 caracteres; o teto é 140/);
  assert.throws(() => validarPedidoHitlV2(decidido({ criterio: { tipo: 'medicao', referencia: 'r'.repeat(301) } })),
    /critério: criterio\.referencia tem 301 caracteres; o teto é 300/);
});

test('defeito 4: quebra de linha e campo ausente tem mensagem propria', () => {
  assert.throws(() => validarPedidoHitlV2(decidido({ porque: 'primeira\nsegunda' })),
    /decisão informada: porque tem quebra de linha; cada campo é uma linha só/);
  assert.throws(() => validarPedidoHitlV2(decidido({ comoMudar: '   ' })),
    /exige o que foi decidido, o porquê e como mudar \(falta comoMudar\)/);
  assert.throws(() => validarPedidoHitlV2(decidido({ custoDeReverter: { agora: 'x' } } as never)),
    /custo de reverter exige agora e depois, os dois presentes/);
});

test('defeito 4: o CLI mostra o campo e o tamanho reais e nao grava nada', () => {
  const p = projetoTemporario('rm037-teto-decisao');
  try {
    const t = novaThread(p.carregado, { nome: 'teto', modo: 'auto' }).thread;
    const antes = lerLedger(dirThread(p.dir, t.id)).length;
    let saida = '', codigo = 0;
    try {
      execFileSync(process.execPath, [ORK, 'decisao', 'registrar', t.id, '--decidido', 'd'.repeat(230), '--porque', 'curto',
        '--como-mudar', 'curto', '--custo-agora', 'barato', '--custo-depois', 'barato', '--criterio', 'medicao:true',
        '--quem', 'sessao executora de teste', '--evidencia', 'fixture'], { cwd: p.dir, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const erro = e as { status?: number; stdout?: string; stderr?: string };
      codigo = erro.status ?? -1; saida = `${erro.stdout ?? ''}${erro.stderr ?? ''}`;
    }
    assert.notEqual(codigo, 0);
    assert.match(saida, /--decidido tem 230 caracteres; o teto é 200/, 'a flag que foi digitada');
    assert.doesNotMatch(saida, /exige o que foi decidido/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).length, antes, 'recusa nao grava no ledger');
  } finally { p.limpar(); }
});

test('defeito 4 (S4): cada superficie le o nome que usou', () => {
  const recusa = (extra: Partial<DecisaoInformada>) => { try { validarPedidoHitlV2(decidido(extra)); return ''; } catch (e) { return (e as Error).message; } };
  const longo = recusa({ comoMudar: 'c'.repeat(201) });
  assert.match(recusaNaSuperficie(longo, CAMPOS_DA_DECISAO_NO_CLI), /: --como-mudar tem 201 caracteres; o teto é 200/);
  assert.match(recusaNaSuperficie(longo, CAMPOS_DA_DECISAO_NO_MCP), /: comoMudar tem 201 caracteres/);
  const custo = recusa({ custoDeReverter: { agora: 'x'.repeat(141), depois: 'y' } });
  assert.match(recusaNaSuperficie(custo, CAMPOS_DA_DECISAO_NO_CLI), /--custo-agora tem 141 caracteres; o teto é 140/);
  assert.match(recusaNaSuperficie(custo, CAMPOS_DA_DECISAO_NO_MCP), /custoAgora tem 141 caracteres/);
  const falta = recusa({ porque: ' ' });
  assert.match(recusaNaSuperficie(falta, CAMPOS_DA_DECISAO_NO_CLI), /o porquê e como mudar \(falta --porque\)/, 'o texto fixo "o porquê" nao muda');
});

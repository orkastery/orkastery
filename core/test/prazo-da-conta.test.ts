/**
 * I-33 (GO-FIX 1 do CHECK aa279e17, achado A10): `resetEm` que ja passou nao vira `esgotadoAte` no
 * passado. Sem isso, o perfil esgotado voltava ao rodizio na hora e so o `max_tentativas` freava o
 * laco. Horario futuro dito pelo runtime continua valendo; sem horario, a janela padrao.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { parseFalhaDeConta } from '../src/adapters/claude-bg';
import { marcarContaDaFalha, prazoDaConta } from '../src/ratelimit';
import { adicionarPerfil, perfilDisponivel } from '../src/runtime-profiles';

const HORA = 3600 * 1000;

test('A10: resetEm no passado usa a janela padrao; futuro vale como dito; auth ausente segue sem prazo', () => {
  const p = projetoTemporario('a10-prazo');
  try {
    const agora = Date.parse('2026-09-19T12:00:00.000Z');
    const antigo = parseFalhaDeConta('usage_limit_exceeded; try again at 2020-01-01T00:00:00Z', agora);
    assert.equal(antigo?.resetEm, '2020-01-01T00:00:00.000Z', 'o parser nao inventa: devolve o horario dito');
    assert.equal(prazoDaConta(p.carregado.manifesto, antigo!, agora), new Date(agora + HORA).toISOString());
    const futuro = { motivo: 'runtime.quota-exhausted' as const, resetEm: '2026-09-19T15:00:00.000Z', fonte: 'iso' as const, trecho: 'x' };
    assert.equal(prazoDaConta(p.carregado.manifesto, futuro, agora), '2026-09-19T15:00:00.000Z');
    assert.equal(prazoDaConta(p.carregado.manifesto, { ...futuro, resetEm: new Date(agora).toISOString() }, agora),
      new Date(agora + HORA).toISOString(), 'o proprio instante tambem ja passou');
    assert.equal(prazoDaConta(p.carregado.manifesto, { ...futuro, motivo: 'runtime.auth-missing' }, agora), null);

    const dir = path.join(p.dir, 'contas', 'a');
    adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir });
    const marcado = marcarContaDaFalha(p.carregado, { id: 'a', runtime: 'claude-bg', configDir: dir }, antigo!)!;
    assert.equal(marcado.estado, 'esgotado');
    assert.ok(Date.parse(marcado.esgotadoAte as string) > Date.now() + HORA - 60_000, `esgotadoAte ${marcado.esgotadoAte}`);
    assert.equal(perfilDisponivel(marcado), false, 'o perfil nao volta ao rodizio na hora');
  } finally { p.limpar(); }
});

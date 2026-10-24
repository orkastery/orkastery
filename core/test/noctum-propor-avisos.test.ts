/** RM-058, piloto P1: avisos não bloqueantes antes de autorizar o arco. Todos os perfis são SIMULADOS. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { pedidoV2 } from './noctum-apoio';
import { avisosDaProposta } from '../src/noctum-cli';
import { validarPedidoDeAbertura } from '../src/noctum-envelope';
import { PerfilDeRuntime, StoreDePerfis } from '../src/runtime-profiles';

const perfil = (id: string, estado: PerfilDeRuntime['estado']): PerfilDeRuntime => ({ id, runtime: 'claude-bg', configDir: `/contas/${id}`,
  estado, esgotadoAte: null, ultimaFalha: null, ultimoUso: null, criadoEm: '2026-01-01T00:00:00.000Z' });

test('PA1: propor avisa login, trust e vaga única sem recusar o envelope', () => {
  const p = projetoTemporario('noctum-pa1');
  try {
    const pedido = pedidoV2('arco-pa1', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'SIMULADO' }],
      maquina: 2, revisao: 1, contas: [{ conta: 'perfil-a', sessoes: 1 }, { conta: 'perfil-b', sessoes: 1 }] });
    const conteudo = validarPedidoDeAbertura(pedido);
    const store: StoreDePerfis = { contrato: 'ork.runtime-profiles/v1', perfis: [perfil('perfil-a', 'sem-auth'), perfil('perfil-b', 'ativo')] };
    const avisos = avisosDaProposta(p.carregado, conteudo, { store, confianca: (_raiz, conta) => conta.id !== 'perfil-b' });
    assert.deepEqual(avisos.map(a => a.motivo), [
      'noctum.proposta.conta-sem-login',
      'noctum.proposta.workspace-untrusted',
      'noctum.proposta.vaga-de-execucao-unica',
    ]);
    assert.match(avisos[0].detalhe, /perfil-a.*sem login/);
    assert.match(avisos[1].detalhe, /perfil-b.*runtime\.workspace-untrusted/);
    assert.match(avisos[2].detalhe, /\(2\).*revisão \(1\).*uma vaga/);
  } finally { p.limpar(); }
});

test('PA2: contas com login e trust e duas vagas de execução não geram aviso', () => {
  const p = projetoTemporario('noctum-pa2');
  try {
    const conteudo = validarPedidoDeAbertura(pedidoV2('arco-pa2', {
      trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'SIMULADO' }], maquina: 3, revisao: 1,
    }));
    const store: StoreDePerfis = { contrato: 'ork.runtime-profiles/v1', perfis: [perfil('perfil-a', 'ativo')] };
    assert.deepEqual(avisosDaProposta(p.carregado, conteudo, { store, confianca: () => true }), []);
  } finally { p.limpar(); }
});

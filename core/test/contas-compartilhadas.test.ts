/**
 * I-49 (RM-040): o estado da conta e do usuario, nao do projeto.
 *
 * Duas fabricas (dois projetos temporarios) apontam o mesmo diretorio de conta. O registro
 * compartilhado mora na pasta isolada que o `apoio` define em ORK_CONTAS_DIR; nenhum teste toca
 * o home de quem roda a suite.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  adicionarPerfil,
  ARQUIVO_CONTAS,
  chaveDaConta,
  desativarPerfil,
  lerContasCompartilhadas,
  lerPerfis,
  lerPerfisComContas,
  marcarFalhaDePerfil,
  pastaDasContas,
  POLITICA_PADRAO,
  proximoPerfilDisponivel,
  reativarPerfil,
  registrarUsoDePerfil,
} from '../src/runtime-profiles';
import { dirTemporario, projetoTemporario } from './apoio';

const HORA = 60 * 60 * 1000;

function duasFabricas(nome: string) {
  const a = projetoTemporario(`${nome}-a`), b = projetoTemporario(`${nome}-b`);
  const conta = dirTemporario(`${nome}-conta`), outra = dirTemporario(`${nome}-outra`);
  for (const p of [a, b]) {
    adicionarPerfil(p.dir, { id: 'principal', runtime: 'claude-bg', dir: conta });
    adicionarPerfil(p.dir, { id: 'reserva', runtime: 'claude-bg', dir: outra });
  }
  return {
    a, b, conta,
    limpar: () => { a.limpar(); b.limpar(); fs.rmSync(conta, { recursive: true, force: true }); fs.rmSync(outra, { recursive: true, force: true }); },
  };
}

const perfil = (dir: string, id: string, agoraMs?: number) =>
  lerPerfisComContas(dir, agoraMs).perfis.find((p) => p.id === id)!;

test('cota esgotada numa fabrica tira a conta do rodizio da outra, ate o prazo', () => {
  const f = duasFabricas('contas-cota');
  try {
    const agora = Date.now();
    const ate = new Date(agora + HORA).toISOString();
    marcarFalhaDePerfil(f.a.dir, 'principal', { estado: 'esgotado', esgotadoAte: ate, motivo: 'runtime.quota-exhausted', detalhe: 'limite do plano' });

    // O store da outra fabrica nao muda; o que ela ENXERGA muda.
    assert.equal(lerPerfis(f.b.dir).perfis.find((p) => p.id === 'principal')?.estado, 'ativo');
    const visto = perfil(f.b.dir, 'principal', agora);
    assert.equal(visto.estado, 'esgotado');
    assert.equal(visto.esgotadoAte, ate);
    assert.match(visto.ultimaFalha?.detalhe ?? '', /visto em outro projeto: limite do plano/);
    assert.equal(proximoPerfilDisponivel(lerPerfisComContas(f.b.dir, agora), 'claude-bg', POLITICA_PADRAO, { agoraMs: agora })?.id, 'reserva',
      'a outra fabrica pula direto para a conta que ainda responde');
    assert.equal(perfil(f.b.dir, 'reserva', agora).estado, 'ativo', 'conta de outro diretorio nao e afetada');

    // Vencido o prazo, a conta volta sem ninguem mexer.
    assert.equal(perfil(f.b.dir, 'principal', agora + 2 * HORA).estado, 'ativo');
  } finally { f.limpar(); }
});

test('uso bem sucedido e login reconferido limpam a marca para todas as fabricas', () => {
  const f = duasFabricas('contas-limpa');
  try {
    marcarFalhaDePerfil(f.a.dir, 'principal', { estado: 'esgotado', esgotadoAte: new Date(Date.now() + HORA).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'limite' });
    assert.equal(perfil(f.b.dir, 'principal').estado, 'esgotado');
    registrarUsoDePerfil(f.b.dir, 'principal');
    assert.equal(lerContasCompartilhadas().length, 0, 'a conta respondeu: a marca sai do registro');
    assert.equal(perfil(f.b.dir, 'principal').estado, 'ativo');

    marcarFalhaDePerfil(f.a.dir, 'principal', { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: 'login expirado' });
    assert.equal(perfil(f.b.dir, 'principal').estado, 'sem-auth', 'login perdido vale para a conta inteira');
    reativarPerfil(f.a.dir, 'principal');
    assert.equal(perfil(f.b.dir, 'principal').estado, 'ativo');
  } finally { f.limpar(); }
});

test('o registro so escurece: perfil desativado segue desativado, e prazo local maior vence', () => {
  const f = duasFabricas('contas-escurece');
  try {
    const agora = Date.now();
    desativarPerfil(f.b.dir, 'principal');
    marcarFalhaDePerfil(f.a.dir, 'principal', { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: 'x' });
    assert.equal(perfil(f.b.dir, 'principal').estado, 'desativado');

    const longe = new Date(agora + 5 * HORA).toISOString();
    marcarFalhaDePerfil(f.b.dir, 'reserva', { estado: 'esgotado', esgotadoAte: longe, motivo: 'runtime.quota-exhausted', detalhe: 'b' });
    marcarFalhaDePerfil(f.a.dir, 'reserva', { estado: 'esgotado', esgotadoAte: new Date(agora + HORA).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'a' });
    assert.equal(perfil(f.b.dir, 'reserva', agora).esgotadoAte, longe);
  } finally { f.limpar(); }
});

test('o registro e privado, sem segredo, e ignora arquivo adulterado ou de conta apagada', () => {
  const f = duasFabricas('contas-privado');
  try {
    marcarFalhaDePerfil(f.a.dir, 'principal', { estado: 'esgotado', esgotadoAte: new Date(Date.now() + HORA).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'limite' });
    const arquivo = path.join(pastaDasContas(), ARQUIVO_CONTAS);
    assert.equal(fs.statSync(pastaDasContas()).mode & 0o777, 0o700);
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    assert.ok(conteudo.includes(chaveDaConta({ id: 'principal', runtime: 'claude-bg', configDir: f.conta })));
    assert.doesNotMatch(conteudo, /token|password|senha|sk-/i);

    fs.chmodSync(arquivo, 0o644);
    assert.deepEqual(lerContasCompartilhadas(), [], 'modo errado vale registro vazio');
    assert.equal(perfil(f.b.dir, 'principal').estado, 'ativo');
    fs.chmodSync(arquivo, 0o600);

    // Conta cujo diretorio sumiu sai do registro na gravacao seguinte.
    fs.rmSync(f.conta, { recursive: true, force: true });
    marcarFalhaDePerfil(f.a.dir, 'reserva', { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: 'y' });
    assert.deepEqual(lerContasCompartilhadas().map((c) => c.estado), ['sem-auth']);
  } finally { f.limpar(); }
});

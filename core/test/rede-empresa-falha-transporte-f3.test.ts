import assert from 'node:assert/strict';
import test from 'node:test';
import { anexarPreflightAoResultadoCi } from '../src/ci';
import { respostaDoStatusDaThread } from '../src/index';
import { respostaDoStatusMcp } from '../src/mcp-server';
import { preflightDaRedeEmpresa } from '../src/rede-empresa-preflight';
import { statusDaRedeEmpresa, textoDoPreflightEmpresa } from '../src/rede-empresa-status';
import { linhasDaPublicacao, type Publicacao } from '../src/ship-publicar';
import { executarShipAposPreflight } from '../src/ship';
import type { Thread } from '../src/types';
import type { PortaDaBranchEmpresa } from '../src/rede-empresa-transporte';

const thread = { id: 'ork-exemplo', slug: 'ork-exemplo-full', nome: 'exemplo', assunto: 'exemplo', modo: 'auto',
  fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'], blocos: [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'],
    pausa: false, pausaSobre: '', slugFases: 'full' }], faseAtual: 'GO', status: 'aberta', criadaEm: '2026-11-12T00:00:00.000Z',
  atualizadaEm: '2026-11-12T00:00:00.000Z', projeto: { name: 'projeto', abbrev: 'prj' },
  base: { branch: 'prj/ork-exemplo-full', commit: 'a'.repeat(40) }, worktree: null, sessoes: [], decisoes: [], claims: [], leases: [],
  baseline: null, variante: null, score: null } as Thread;

test('exceções de leitura e listagem viram indisponibilidade tipada', () => {
  const porta: PortaDaBranchEmpresa = { ler() { throw new Error('transporte indisponível'); }, gravar: () => false };
  const leitura = preflightDaRedeEmpresa(porta);
  assert.deepEqual([leitura.estado, leitura.lacunas], ['nao-realizado', ['rede.leitura-indisponivel']]);
  const status = statusDaRedeEmpresa(porta, 'inscricao-a', 'projeto-a', { ORK_USUARIO_DIR: `/tmp/ork-status-ausente-${process.pid}` });
  assert.deepEqual([status.forjaAtualizada, status.preflightEmpresa.estado], [false, 'inconclusivo']);
  const listagem = preflightDaRedeEmpresa({ ler: () => ({ id: 'c1', atualizada: true, ler: () => null,
    listar() { throw new Error('listagem indisponível'); } }), gravar: () => false });
  assert.equal(listagem.estado, 'inconclusivo');
  assert.ok(listagem.lacunas.includes('rede.leitura-indisponivel'));
});

test('falha de transporte permanece visível e consultiva nas cinco superfícies', () => {
  const preflight = preflightDaRedeEmpresa({ ler() { throw new Error('transporte indisponível'); }, gravar: () => false });

  const status = textoDoPreflightEmpresa(preflight, 'pt-BR');
  assert.match(status, /não realizada.*rede\.leitura-indisponivel/i);

  const publicacao: Publicacao = { contrato: 'ork.ship-publicar/v1', thread: thread.id, modo: 'auto', tag: '#Auto',
    acao: 'publicaria', motivo: null, detalhe: 'continua', correcao: '', branch: thread.base.branch, base: 'main', remoto: 'origin',
    head: thread.base.commit, remotaAntes: null, remota: null, pushVerificado: false, pr: null, corpo: 'padrao', passos: [], dryRun: true,
    preflightEmpresa: preflight };
  assert.ok(linhasDaPublicacao(publicacao).some((linha) => /não realizada/i.test(linha)));
  assert.deepEqual([publicacao.acao, publicacao.pushVerificado], ['publicaria', false]);

  const ciAntes = { ok: false, state: 'failure', policy: 'existente' };
  const ciDepois = anexarPreflightAoResultadoCi(ciAntes, preflight);
  assert.deepEqual([ciDepois.ok, ciDepois.state, ciDepois.policy], [false, 'failure', 'existente']);

  const cli = respostaDoStatusDaThread(thread, [], preflight) as { status: string; preflightEmpresa: unknown };
  const mcp = respostaDoStatusMcp(thread, null, [], preflight);
  assert.deepEqual([cli.status, cli.preflightEmpresa], ['aberta', preflight]);
  assert.deepEqual([mcp.thread.status, mcp.preflightEmpresa], ['aberta', preflight]);

  const gates = { ok: true, autorizado: true, lease: 'main-tree', merge: 'm1', push: 'provado' };
  const ship = executarShipAposPreflight(preflight, () => {}, (p) => ({ ...gates, preflightEmpresa: p }));
  assert.deepEqual({ ok: ship.ok, autorizado: ship.autorizado, lease: ship.lease, merge: ship.merge, push: ship.push }, gates);
});

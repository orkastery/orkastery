/**
 * RM-061, fatia F2a: o catalogo inteiro (todas as familias) e o contrato do `--json`. O ingles tem as
 * mesmas chaves e os mesmos tipos de folha do pt-BR, nenhuma mensagem vazia e nenhum travessao U+2014; o
 * `--json` dos comandos cobertos nao muda com a lingua. O dado gravado por familia fica nos testes de
 * cada uma (onboarding, thread, phase). Os nomes comecam por "locale F2a catalogo:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { msg } from '../src/locale';
import { cenario, EN, ork, PT } from './locale-apoio';

type Arvore = Record<string, unknown>;

/** RM-061 (F3b): as familias que a fatia acrescenta ao catalogo, na ordem em que entram. */
const FAMILIAS_DA_F3B: readonly string[] = ['worktree', 'estado', 'claims', 'decisao', 'accounts', 'network', 'reservas', 'docs', 'adapter'];

/** Cada folha do catalogo: o caminho, o tipo (`string`, `function`, `number`) e o valor. */
function folhas(o: Arvore, pre = ''): Array<{ k: string; tipo: string; v: unknown }> {
  return Object.entries(o).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !(pre === 'doctor.' && k === 'nomes') ? folhas(v as Arvore, `${pre}${k}.`) : [{ k: `${pre}${k}`, tipo: typeof v, v }]);
}

test('locale F2a catalogo: o ingles tem as mesmas chaves e os mesmos tipos de folha do pt-BR em todas as familias', () => {
  const pt = folhas(msg('pt-BR') as unknown as Arvore), en = folhas(msg('en') as unknown as Arvore);
  assert.deepEqual(en.map(({ k, tipo }) => [k, tipo]), pt.map(({ k, tipo }) => [k, tipo]));
  for (const familia of ['cli', 'horario', 'doctor', 'init', 'onboarding', 'thread', 'phase', 'ajuda', 'verify', 'ship', 'retry', 'master', 'pulse', 'roadmap', 'gerados',
    // F3b
    ...FAMILIAS_DA_F3B]) {
    assert.ok(pt.some(({ k }) => k.startsWith(`${familia}.`)), familia);
  }
});

test('locale F2a catalogo: nenhuma mensagem vazia nem igual ao pt-BR por descuido, e nenhum travessao U+2014', () => {
  const pt = folhas(msg('pt-BR') as unknown as Arvore), en = folhas(msg('en') as unknown as Arvore);
  // Iguais de proposito: identificador, comando ou rotulo que e a mesma palavra nas duas linguas.
  const iguaisPermitidos = new Set(['thread.rotulos.id', 'thread.rotulos.slug', 'thread.rotulos.status', 'thread.rotulos.base',
    'thread.rotulos.worktree', 'thread.rotulos.score', 'phase.rotulos.prompt', 'phase.rotulos.sha256', 'phase.rotulos.runtime',
    'phase.rotulos.sessionId', 'doctor.rodeInit', 'thread.operacoes.verify', 'thread.operacoes.baseline', 'thread.operacoes.fix.open',
    'thread.operacoes.fix.reverify', 'thread.operacoes.mcp.verify',
    // F2b: o mesmo rotulo nas duas linguas, e a correcao que e so um comando.
    'verify.comandoOk', 'retry.politica.runtime.silencio.correcao', 'retry.politica.human.pending.correcao',
    'master.colunas.0', 'master.colunas.1', 'master.colunas.4', 'master.colunasAceitas.0',
    // F3b: os rotulos de tabela que sao a mesma palavra nas duas linguas.
    'thread.colunasDaLista.0', 'thread.colunasDaLista.1', 'thread.colunasDaLista.4', 'claims.colunas.0', 'decisao.dentroDoLimiar', 'accounts.colunas.1',
    'accounts.colunasDosDespachos.2',
    // F3b: a prova de um pitfall que e so um comando, sem comentario a traduzir.
    'adapter.hosts.codex.pitfalls.1.prova', 'adapter.hosts.codex.pitfalls.2.prova', 'adapter.hosts.hermes.pitfalls.0.prova',
    // F3d (GO-FIX 1): rotulos de tabela, nomes de campo e valores tecnicos (estado, chave do manifesto, ferramenta) que sao
    // a mesma palavra nas duas linguas, e duas recusas que sao so o comando com os valores aceitos; o pt-BR e o da base.
    'retry.complementar.colunasFila.0', 'retry.complementar.colunasFila.1', 'prompts.memoria.grupos.roadmap', 'prompts.memoria.mandatory',
    'grafo.indexar.campos.snapshot', 'grafo.indexar.campos.digest',
    'audit.packs.cabecalho.0', 'audit.rodadas.cabecalho.1', 'audit.rodadas.cabecalho.4', 'audit.rodadas.cabecalho.7',
    'audit.rodadas.campos.pack', 'audit.rodadas.campos.graphify', 'audit.rodadas.campos.runtime', 'audit.rodadas.campos.prompt',
    'audit.rodadas.campos.status', 'audit.divida.cabecalho.0', 'audit.divida.cabecalho.1', 'audit.divida.cabecalho.4',
    'audit.superficie.cabecalho.3', 'audit.superficie.campos.frameworks',
    'operacao.restante.sessions.inventario.fonteEstado.ok', 'operacao.restante.sessions.inventario.colunas.0',
    'operacao.restante.sessions.inventario.colunas.1', 'operacao.restante.sessions.inventario.desconhecido',
    'operacao.restante.sessions.limpeza.colunas.0', 'operacao.restante.sessions.radar.colunas.0', 'operacao.restante.sessions.radar.colunas.6',
    'operacao.restante.sessions.radar.log', 'operacao.restante.gate.formato', 'operacao.restante.fix.colunasLista.0',
    'operacao.restante.fix.colunas.0', 'operacao.restante.board.colunasPlano.0', 'operacao.restante.board.colunasPlano.1',
    'operacao.restante.board.colunas.1', 'operacao.restante.board.colunas.2', 'operacao.restante.board.colunas.5',
    'operacao.restante.board.colunas.7', 'operacao.restante.board.colunas.8', 'operacao.restante.board.colunas.9',
    'operacao.restante.monitor.colunas.1', 'operacao.restante.monitor.colunas.3', 'operacao.restante.fabrica.colunas.0',
    'operacao.restante.fabrica.colunas.3', 'operacao.restante.fabrica.colunas.4', 'operacao.restante.eval.estados.unavailable',
    'operacao.restante.eval.colunasSkills.0', 'operacao.restante.memory.embeddings.depsOk',
    'operacao.modos.cabecalho.0', 'operacao.modos.pausaSobre.push', 'operacao.modos.pausaSobre.score', 'operacao.modos.migracao.backup',
    'operacao.pulseCadencia.responderFormato', 'setup.tabela.cabecalho.2', 'setup.tabela.cabecalho.3', 'setup.tabela.cabecalho.4',
    'setup.tabela.cabecalho.5', 'setup.tabela.default', 'projetos.cli.cabecalho.1',
    // RM-072 (D17): o rotulo do modo do CHECK no status e a mesma palavra nas duas linguas.
    'thread.rotulos.check']);
  en.forEach(({ k, tipo, v }, i) => {
    if (tipo !== 'string') return;
    assert.ok((v as string).trim(), `${k} vazia`);
    if (!iguaisPermitidos.has(k)) assert.notEqual(v, pt[i].v, `${k} igual ao pt-BR`);
  });
  const src = path.resolve(__dirname, '../../src');
  for (const arquivo of fs.readdirSync(src).filter((f) => /^locale(-[a-z]+)?\.ts$/.test(f))) {
    assert.ok(!fs.readFileSync(path.join(src, arquivo), 'utf8').includes('\u2014'), `${arquivo} com travessao`);
  }
});

test('locale F2a catalogo: o --json dos comandos cobertos nao muda com a lingua', () => {
  const c = cenario('catalogo-json');
  try {
    assert.equal(ork(c, PT, true, 'thread', 'new', 'Json', '--modo', 'auto', '--sem-worktree').status, 0);
    const iguais = (args: string[]) => {
      const pt = ork(c, PT, true, ...args), en = ork(c, EN, true, ...args);
      assert.equal(en.status, pt.status, args.join(' '));
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.doesNotThrow(() => JSON.parse(pt.stdout), args.join(' '));
    };
    iguais(['onboarding', '--json']);
    iguais(['onboarding', 'show', '--json']);
    iguais(['thread', 'status', 'loc-json', '--json']);
    iguais(['thread', 'list', '--json']);
    iguais(['projetos', '--json']);
  } finally { c.limpar(); }
});

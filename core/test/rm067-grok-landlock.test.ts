/**
 * RM-067 (F4c, D11, thread ork-rm067f4cmcpd): a prova com o confinamento de verdade. O `grok` falso roda pelo Landlock do
 * kernel como o perfil `workspace` do `grok` (G7 e G17 da RM-067): escrita so na worktree, na casa do `grok` e na pasta do
 * stub, e os filhos herdam. Com a config stdio da F4b, o servidor MCP do `ork` e filho dele e nao grava o ledger, o limite
 * que a pagina documentou; pelo despacho da F4c, o servidor e do `ork`, fora do confinamento, e a fase fecha com prova.
 *
 * Integracao local (`core/src/integracoes-locais.ts`): o runner hospedado nao garante Landlock nem `python3`. Sem eles o caso
 * pula com o motivo tipado, `ORK_TESTE_EXIGE_AMBIENTE=1` o reprova, e a claim (pelo `conferir-casos.cjs`) reprova o pulado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { configuracaoServidorMcp, instalarMcp } from '../src/mcp-install';
import { MARCA_DA_CONFIG_DO_FILHO } from '../src/adapters/grok';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { projetoTemporario } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';
import { semLandlock } from './ambiente-de-teste';

const decisao = (threadId: string, decidido: string) => ({ nome: 'ork_decision_record', argumentos: { threadId, decidido,
  porque: 'Conferir o servidor MCP do ork sob o confinamento do workspace', comoMudar: 'Nao se aplica', custoAgora: 'Nenhum',
  custoDepois: 'Nenhum', criterio: { tipo: 'medicao', referencia: 'core/test/rm067-grok-landlock.test.ts' },
  quemDecidiu: 'sessao grok SIMULADA', evidencia: 'teste' } });

test('GL1: confinado como o workspace, o grok falso nao grava o ledger pelo servidor stdio filho dele, o limite da F4b', { skip: semLandlock() }, () => {
  const stub = grokFalso('gl1-stdio');
  const p = projetoTemporario('gl1-stdio');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok' });
    const t = novaThread(p.carregado, { nome: 'gl1', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    // A config da F4b: o servidor stdio do ork, que o grok sobe como filho e que herda o confinamento dele.
    const servidor = configuracaoServidorMcp(fs.realpathSync(p.dir), 'grok', t.id);
    fs.mkdirSync(path.join(wt, '.grok'));
    fs.writeFileSync(path.join(wt, '.grok', 'config.toml'), [MARCA_DA_CONFIG_DO_FILHO, '[mcp_servers.orkastery]',
      `command = ${JSON.stringify(servidor.command)}`, `args = ${JSON.stringify(servidor.args)}`].join('\n') + '\n');
    const sonda = path.join(dirThread(p.dir, t.id), 'sonda-do-grok');
    stub.confinar([wt, stub.casa, stub.dir]);
    stub.sonda(sonda);
    stub.mcp([{ nome: 'ork_thread_status', argumentos: { threadId: t.id } }, decisao(t.id, 'Fixture SIMULADA pelo servidor stdio confinado')]);
    const antes = lerLedger(dirThread(p.dir, t.id)).length;
    const r = spawnSync('grok', ['-p', 'Fixture SIMULADA', '--output-format', 'streaming-json', '-s', randomUUID(), '--cwd', wt,
      '--trust', '--sandbox', 'workspace'], { encoding: 'utf8', env: process.env, timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stub.sondaResultado(), 'recusada', 'o filho confinado nao cria arquivo no estado do ork');
    assert.equal(fs.existsSync(sonda), false);
    const mcp = stub.mcpResultado();
    assert.ok(mcp && !mcp.erro, JSON.stringify(mcp));
    assert.equal(mcp!.chamadas[0].isError, false, 'a consulta funciona: o servidor filho le o estado');
    assert.equal(mcp!.chamadas[1].isError, true, 'a decisao nao grava');
    assert.match(mcp!.chamadas[1].texto, /EACCES|permission denied/i, mcp!.chamadas[1].texto);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).length, antes, 'o ledger nao ganhou evento');
  } finally { p.limpar(); stub.restaurar(); }
});

test('GL2: com o mesmo confinamento, pelo despacho da F4c o filho grava decisao, claim e artefato pelo servidor do ork, e a fase fecha com prova', { skip: semLandlock() }, () => {
  const stub = grokFalso('gl2-externo');
  const p = projetoTemporario('gl2-externo');
  try {
    instalarMcp({ projeto: p.dir, host: 'grok', permissoesFilho: 'worktree' });
    const t = novaThread(p.carregado, { nome: 'gl2', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    const sonda = path.join(dirThread(p.dir, t.id), 'sonda-do-grok');
    stub.confinar([wt, stub.casa, stub.dir]);
    stub.sonda(sonda);
    stub.stream('fim-normal.jsonl');
    stub.mcp([decisao(t.id, 'Fixture SIMULADA pelo servidor externo confinado'),
      { nome: 'ork_claim_add', argumentos: { threadId: t.id, arquivo: 'README.md', alegacao: 'Fixture SIMULADA de claim sob o Landlock',
        verificar: ['true'] } },
      { nome: 'ork_artifact_write', argumentos: { threadId: t.id, tipo: 'goal', conteudo: '# GOAL SIMULADO sob o Landlock\n', expectedSha256: null } },
    ], { esperar: true });
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'Fixture SIMULADA sob o Landlock', runtime: 'grok', model: 'grok-modelo' });
    assert.ok(r.sessionId, r.erro);
    assert.equal(r.comando[r.comando.indexOf('--sandbox') + 1], 'workspace');
    stub.liberarMcp();
    const sid = r.sessionId!;
    esperarCondicao(() => lerLedger(dirThread(p.dir, t.id)).some((e) => e.tipo === 'phase_result' && e.sessionId === sid), 60000);
    assert.equal(stub.sondaResultado(), 'recusada', 'o filho seguia confinado');
    assert.equal(fs.existsSync(sonda), false);
    const mcp = stub.mcpResultado();
    assert.ok(mcp && !mcp.erro, JSON.stringify(mcp));
    assert.deepEqual(mcp!.chamadas.map((c) => c.isError), [false, false, false], JSON.stringify(mcp!.chamadas));
    const eventos = lerLedger(dirThread(p.dir, t.id));
    const resultado = eventos.find((e) => e.tipo === 'phase_result' && e.sessionId === sid)!;
    assert.equal(resultado.classificacao, 'fase_concluida', JSON.stringify(resultado.provaOrk));
    const { eventId } = JSON.parse(mcp!.chamadas[0].texto) as { eventId: string };
    assert.equal(eventos.find((e) => e.eventId === eventId)?.host, 'grok', 'a decisao entrou no ledger pelo servidor do ork');
    assert.match(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'claims.jsonl'), 'utf8'), /Fixture SIMULADA de claim sob o Landlock/);
    assert.equal(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'goal.md'), 'utf8'), '# GOAL SIMULADO sob o Landlock\n');
  } finally { p.limpar(); stub.restaurar(); }
});

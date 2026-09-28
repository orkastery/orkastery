/**
 * I-35 (T9): prova pelo CLI real de que a saída para o dono não depende do TZ do processo.
 * Projeto temporário com `owner.timezone: America/Sao_Paulo`; o mesmo comando roda com
 * `TZ=UTC` e com `TZ=America/Sao_Paulo` e a saída para o dono é a mesma, com virada de dia.
 * Negativo: fuso inválido no manifesto avisa, cai no default e o comando termina com 0.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ajustarManifesto, projetoTemporario, ProjetoDeTeste } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { registrarPedidoHitl } from '../src/hitl-gates';
import { PedidoHitl } from '../src/hitl-contract';

const SP = 'America/Sao_Paulo';
const CLI = path.join(__dirname, '..', '..', 'dist', 'index.js');
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UTC_TRUNCADO = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;
const ANO = '(?:/2026)?';

function rodar(p: ProjetoDeTeste, tz: string, argv: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz };
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_')) delete env[nome];
  const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: p.dir, encoding: 'utf8', env, timeout: 60000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Thread com evento às 23:30:34 de 19/09 em Brasília (já 20/09 em UTC), fila de rate limit e pedido HITL. */
function cenario(nome: string, fuso: string): { p: ProjetoDeTeste; thread: string; pedido: PedidoHitl } {
  const p = projetoTemporario(nome);
  ajustarManifesto(p, 'owner:\n', `owner:\n  timezone: "${fuso}"\n`);
  const t = novaThread(p.carregado, { nome: 'Superficies', modo: 'classic' }).thread;
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { ts: '2026-09-20T02:30:34.000Z', fase: 'GOAL' });
  registrar(dir, t.id, 'gate_blocked', { ts: '2026-09-20T02:31:00.000Z', fase: 'GOAL', motivo: 'verify.failed',
    detalhe: 'verify reprovou em 2026-09-20T02:31:00.000Z' });
  const fila = path.join(p.dir, '.orkastery/retry/fila.jsonl');
  fs.mkdirSync(path.dirname(fila), { recursive: true });
  fs.writeFileSync(fila, JSON.stringify({ id: 'R1', thread: t.id, fase: 'GOAL', slug: t.slug, promptPath: 'p.md', promptSha256: '0'.repeat(64),
    cwd: p.dir, model: null, effort: null, sinal: { resetEm: '2026-09-18T02:30:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' },
    liberaEm: '2026-09-18T02:30:00.000Z', janelaEstimada: false, tentativas: 0, estado: 'aguardando',
    criadoEm: '2026-09-18T01:30:00.000Z', atualizadoEm: '2026-09-18T01:30:00.000Z', detalhe: 'SIMULADO' }) + '\n');
  const agora = Date.now();
  const pedido: PedidoHitl = { contrato: 'ork.hitl/v1', id: 'q-superficie', thread: t.id, fase: t.faseAtual, modo: t.modo,
    alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending', pergunta: 'Aprovar fixture SIMULADA?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Esperar', acao: 'esperar' }],
    recomendacao: 'Somente fixture', criadoEm: new Date(agora).toISOString(), prazo: new Date(agora + 3600000).toISOString(),
    acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' };
  registrarPedidoHitl(p.dir, pedido);
  return { p, thread: t.id, pedido };
}

test('CLI real: phase list, retry list, monitor e gate context iguais com TZ=UTC e TZ=America/Sao_Paulo', () => {
  const { p, thread, pedido } = cenario('horario-superficies', SP);
  try {
    const por = (argv: string[]) => ['UTC', SP].map(tz => rodar(p, tz, argv));

    const phase = por(['phase', 'list', thread]);
    for (const r of phase) {
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`19/09${ANO} 23:30:34 +phase_dispatch`));
      assert.match(r.stdout, new RegExp(`verify reprovou em 19/09${ANO} 23:31`));
      assert.match(r.stdout, /Horários de Brasília\./);
      assert.doesNotMatch(r.stdout, ISO);
      assert.doesNotMatch(r.stdout, UTC_TRUNCADO);
    }
    assert.equal(phase[0].stdout, phase[1].stdout);

    const retry = por(['retry', 'list']);
    for (const r of retry) {
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`R1 .* 17/09${ANO} 23:30 .* ja liberou`));
      assert.match(r.stdout, new RegExp(`Proxima janela: 17/09${ANO} 23:30`));
      assert.doesNotMatch(r.stdout, ISO);
      assert.doesNotMatch(r.stdout, UTC_TRUNCADO);
    }
    assert.equal(retry[0].stdout, retry[1].stdout);

    for (const r of por(['orquestracao', 'status', '--sem-runtime'])) {
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /Horários de Brasília\./);
      // Hoje (19/09 local) só a hora; em outro dia, a data completa.
      assert.match(r.stdout, new RegExp(`\\(desde (?:19/09${ANO} )?23:31\\)`));
      assert.match(r.stdout, new RegExp(`\\(17/09${ANO} 23:30, hora dita pelo runtime\\)`));
      assert.doesNotMatch(r.stdout, ISO);
      assert.doesNotMatch(r.stdout, UTC_TRUNCADO);
    }

    const contexto = por(['gate', 'context', thread, pedido.id]).map(r => {
      assert.equal(r.code, 0, r.stderr);
      return JSON.parse(r.stdout) as { pedido: PedidoHitl; prazoLocal: string; apresentacao: { mensagem: string } };
    });
    assert.equal(contexto[0].prazoLocal, contexto[1].prazoLocal);
    for (const v of contexto) {
      assert.match(v.prazoLocal, / \(horário de Brasília\)$/);
      assert.ok(v.apresentacao.mensagem.includes(`• Prazo: ${v.prazoLocal}, em `));
      assert.equal(v.pedido.prazo, pedido.prazo);
    }
  } finally { p.limpar(); }
});

test('negativo: owner.timezone inválido avisa, cai no fuso do sistema e não quebra o comando', () => {
  const { p, thread } = cenario('horario-fuso-invalido', 'Marte/Olimpo');
  try {
    for (const [tz, legenda, quando] of [['UTC', 'Horários em UTC.', '20/09 02:30:34'], [SP, 'Horários de Brasília.', '19/09 23:30:34']]) {
      const r = rodar(p, tz, ['phase', 'list', thread]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /aviso: owner\.timezone invalido \("Marte\/Olimpo"\): usando o fuso do sistema/);
      assert.equal((r.stderr.match(/owner\.timezone invalido/g) ?? []).length, 1);
      assert.ok(r.stdout.includes(legenda), r.stdout);
      assert.match(r.stdout, new RegExp(`${quando.replace(' ', `${ANO} `)} +phase_dispatch`));
      assert.doesNotMatch(r.stdout, ISO);
    }
  } finally { p.limpar(); }
});

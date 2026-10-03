/**
 * RM-056 (ao fechar): a thread fechada solta o vinculo das proprias sessoes fantasma.
 *
 * Em 03/10/2026, `ork sessions list` seguia mostrando duas sessoes `blocked (fantasma)` presas a
 * threads ja fechadas (624f65db em ork-rm053network e d38ae1d4 em ork-rm054fatia2): o fechamento
 * soltava leases, fila e reserva, mas nao a sessao, e a permissao negou o `limpar-fantasmas` a fabrica.
 *
 * O stub do `claude` responde o `agents` pela conta do ambiente (`$CLAUDE_CONFIG_DIR/agents.json`) e
 * anota cada chamada, para provar que o runtime so e consultado, nunca parado, e so quando ha sessao sem fim.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao } from '../src/master';
import { liberarAoFechar } from '../src/fechamento';
import { fecharAdministrativamente } from '../src/thread-close';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { Thread } from '../src/types';

const UUID = (n: number) => `5656fec0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SCRIPT = `#!/bin/sh
echo "$*" >> "$CLAUDE_CONFIG_DIR/chamadas"
if [ "$1" = "agents" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/agents.json" ]; then cat "$CLAUDE_CONFIG_DIR/agents.json"; else echo '[]'; fi
  exit 0
fi
exit 0
`;

interface Cenario { p: ProjetoDeTeste; conta: string; chamadas: () => string; restaurar: () => void }

/** Conta do processo com as sessoes dadas; nenhum perfil no store. */
function cenario(nome: string, sessoes: object[]): Cenario {
  const p = projetoTemporario(nome);
  const bin = dirTemporario(`${nome}-bin`);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT, { mode: 0o755 });
  const conta = path.join(p.dir, 'contas', 'processo');
  const codex = path.join(p.dir, 'contas', 'codex');
  fs.mkdirSync(conta, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(conta, 'agents.json'), JSON.stringify(sessoes));
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR, CODEX: process.env.CODEX_HOME };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = conta;
  process.env.CODEX_HOME = codex;
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  const arquivo = path.join(conta, 'chamadas');
  return {
    p, conta,
    chamadas: () => fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : '',
    restaurar: () => {
      volta('PATH', anterior.PATH); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); volta('CODEX_HOME', anterior.CODEX);
      fs.rmSync(bin, { recursive: true, force: true }); p.limpar();
    },
  };
}

/** Thread com as sessoes registradas, como o despacho claude-bg grava em thread.json. */
function threadCom(c: Cenario, nome: string, sessoes: string[]): Thread {
  const t = novaThread(c.p.carregado, { nome, modo: 'auto' }).thread;
  for (const id of sessoes) {
    t.sessoes.push({ sessionId: id, runtime: 'claude-bg', slug: t.slug, fase: 'GOAL', bloco: 'full', verificada: true,
      origem: 'adocao', adotadaEm: t.criadaEm, cwdOrigem: c.p.dir });
    registrar(dirThread(c.p.dir, t.id), t.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GOAL', slug: t.slug, sessionId: id });
  }
  gravarThread(c.p.dir, t);
  return t;
}

const mortes = (c: Cenario, t: Thread) => lerLedger(dirThread(c.p.dir, t.id)).filter((e) => e.tipo === 'sessao_morta');

test('RM-056 ao fechar: o MASTER grava sessao_morta (origem fechamento) no fantasma da thread e nao para o runtime', () => {
  const c = cenario('rm056-fechar-master', [{ sessionId: UUID(1), cwd: '/srv/x', state: 'blocked' }]);
  try {
    const t = threadCom(c, 'entregue', [UUID(1)]);
    registrar(dirThread(c.p.dir, t.id), t.id, TIPOS_DE_EVENTO.shipConcluido, {
      fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true,
    });
    aceitarPorOmissao(c.p.dir, t.id);
    const m = mortes(c, t);
    assert.equal(m.length, 1, 'o fantasma da thread fechada recebe sessao_morta');
    assert.equal(m[0].sessionId, UUID(1));
    assert.equal(m[0].origem, 'fechamento');
    assert.match(c.chamadas(), /^agents/m, 'o runtime foi consultado');
    assert.doesNotMatch(c.chamadas(), /stop|rm/, 'e nunca parado nem removido');
  } finally { c.restaurar(); }
});

test('RM-056 ao fechar: o fechamento administrativo tambem solta o fantasma', () => {
  const c = cenario('rm056-fechar-admin', [{ sessionId: UUID(2), cwd: '/srv/x', state: 'blocked' }]);
  try {
    const t = threadCom(c, 'orfa', [UUID(2)]);
    fecharAdministrativamente(c.p.dir, t.id, { motivo: 'orfa', por: 'teste', justificativa: 'thread orfa do teste' });
    assert.deepEqual(mortes(c, t).map((e) => [e.sessionId, e.origem]), [[UUID(2), 'fechamento']]);
  } finally { c.restaurar(); }
});

test('RM-056 ao fechar: sessao viva e fantasma de outra thread ficam como estavam', () => {
  const c = cenario('rm056-fechar-escopo', [
    { sessionId: UUID(3), cwd: '/srv/x', state: 'working', pid: process.pid },
    { sessionId: UUID(4), cwd: '/srv/x', state: 'blocked' },
    { sessionId: UUID(5), cwd: '/srv/x', state: 'blocked' },
  ]);
  try {
    const fecha = threadCom(c, 'fecha', [UUID(3), UUID(4)]);
    const outra = threadCom(c, 'outra', [UUID(5)]);
    const r = liberarAoFechar(c.p.dir, fecha.id);
    assert.deepEqual(r.sessoes.map((i) => i.sessionId), [UUID(4)], 'so o fantasma da thread que fecha');
    assert.deepEqual(mortes(c, fecha).map((e) => e.sessionId), [UUID(4)], 'a sessao viva nao recebe sessao_morta');
    assert.equal(mortes(c, outra).length, 0, 'o fantasma de outra thread fica para ela');
    assert.deepEqual(r.falhas, []);
    // Fechar de novo e idempotente: o ledger ja encerra a sessao fantasma.
    liberarAoFechar(c.p.dir, fecha.id);
    assert.equal(mortes(c, fecha).length, 1);
  } finally { c.restaurar(); }
});

test('RM-056 ao fechar: thread sem sessao sem fim nao consulta o runtime', () => {
  const c = cenario('rm056-fechar-barato', [{ sessionId: UUID(6), cwd: '/srv/x', state: 'blocked' }]);
  try {
    const sem = threadCom(c, 'sem-sessao', []);
    const encerrada = threadCom(c, 'encerrada', [UUID(6)]);
    registrar(dirThread(c.p.dir, encerrada.id), encerrada.id, 'phase_result', { fase: 'GOAL', sessionId: UUID(6) });
    liberarAoFechar(c.p.dir, sem.id);
    liberarAoFechar(c.p.dir, encerrada.id);
    assert.equal(c.chamadas(), '', 'sem sessao pendente no ledger, o fechamento nao chama o claude');
    assert.equal(mortes(c, encerrada).length, 0);
  } finally { c.restaurar(); }
});

/**
 * RM-056 (C4 do BACKLOG-AUTO-3): o fechamento com falha numa parte.
 *
 * O `liberarAoFechar` (core/src/fechamento.ts) solta tres partes da thread que fecha: os leases e a
 * fila, a reserva do roadmap e as sessoes fantasma. Cada parte roda isolada (achado A1 do CHECK 1 da
 * rm037noite): o erro de disco numa nao impede as outras, a falha vai ao ledger da thread com a
 * correcao, e a thread segue fechada. Aqui cada parte falha por vez, com a falha posta no estado em
 * disco, nunca por mock:
 *
 * - leases: a pasta de leases sem escrita; a fila da thread nao se regrava;
 * - sessoes: o ledger da thread so de escrita; a leitura das sessoes sem fim falha, o append segue;
 * - reserva: o remoto aponta para uma pasta que nao existe. A reserva nunca lanca: a falha dela vira
 *   `roadmap_reserva_pendente` com a correcao, no lugar do `soltura_ao_fechar_falhou`.
 *
 * Como root a permissao nao barra nada, entao o teste de permissao vira skip tipado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { adquirir, caminhoFila, dirLeases, lerFila, lerLease } from '../src/leases';
import { aceitarPorOmissao } from '../src/master';
import { liberarAoFechar } from '../src/fechamento';
import { listarReservas, pegarItem } from '../src/roadmap-reservas';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { EventoLedger, Thread } from '../src/types';
import { exec } from '../src/util';

const SEM_PERMISSAO = typeof process.getuid === 'function' && process.getuid() === 0
  ? 'como root a permissao do arquivo nao barra a escrita' : false;

const ITEM = 'RM-001';
const REGIAO = 'path:docs/**';
const UUID = (n: number) => `c4fec4a0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SCRIPT = `#!/bin/sh
if [ "$1" = "agents" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/agents.json" ]; then cat "$CLAUDE_CONFIG_DIR/agents.json"; else echo '[]'; fi
fi
exit 0
`;

interface Cenario { p: ProjetoDeTeste; t: Thread; restaurar: () => void }

/**
 * Thread com as tres partes a soltar: um lease de escrita e uma entrada de fila, a reserva do item no
 * remoto bare e uma sessao fantasma no `claude agents` (stub pela conta do processo).
 */
function cenario(nome: string, sessao: string): Cenario {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, `docs/roadmap/${ITEM}-item.md`, `# ${ITEM}\n`, `roadmap: ${ITEM}`);
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir);
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);

  const bin = dirTemporario(`${nome}-bin`);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT, { mode: 0o755 });
  const conta = path.join(p.dir, 'contas', 'processo');
  const codex = path.join(p.dir, 'contas', 'codex');
  fs.mkdirSync(conta, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(conta, 'agents.json'), JSON.stringify([{ sessionId: sessao, cwd: '/srv/x', state: 'blocked' }]));
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR, CODEX: process.env.CODEX_HOME };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = conta;
  process.env.CODEX_HOME = codex;
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

  const t = novaThread(p.carregado, { nome: 'fecha com falha', modo: 'auto', roadmap: ITEM }).thread;
  pegarItem(p.dir, ITEM, { thread: t.id });
  assert.equal(adquirir(p.dir, REGIAO, { thread: t.id, motivo: 'GO' }).ok, true);
  fs.writeFileSync(caminhoFila(p.dir), JSON.stringify([
    { nome: 'path:core/**', tipo: 'path', thread: t.id, motivo: 'GO', desdeEm: '2026-10-03T09:00:00.000Z',
      colidiuCom: 'path:core/**', bloqueadaPor: 'ork-outra' },
  ], null, 2));
  t.sessoes.push({ sessionId: sessao, runtime: 'claude-bg', slug: t.slug, fase: 'GO', bloco: 'full', verificada: true,
    origem: 'adocao', adotadaEm: t.criadaEm, cwdOrigem: p.dir });
  gravarThread(p.dir, t);
  registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', slug: t.slug, sessionId: sessao });
  return {
    p, t,
    restaurar: () => {
      volta('PATH', anterior.PATH); volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); volta('CODEX_HOME', anterior.CODEX);
      fs.rmSync(bin, { recursive: true, force: true }); p.limpar();
    },
  };
}

/** A entrega provada, para o MASTER por omissao fechar a thread pelo caminho real. */
function entregar(c: Cenario): void {
  registrar(dirThread(c.p.dir, c.t.id), c.t.id, TIPOS_DE_EVENTO.shipConcluido, {
    fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true,
  });
}

const eventos = (c: Cenario, tipo: string): EventoLedger[] =>
  lerLedger(dirThread(c.p.dir, c.t.id)).filter((e) => e.tipo === tipo);
const reservasDoItem = (c: Cenario) => listarReservas(c.p.dir).reservas.filter((r) => r.item === ITEM);

/** O que vale em toda parte que falha: uma soltura_ao_fechar_falhou, so com a parte alvo e a correcao. */
function falhaRegistrada(c: Cenario, parte: RegExp): void {
  const falhas = eventos(c, TIPOS_DE_EVENTO.solturaFalhou);
  assert.equal(falhas.length, 1, 'a falha vai ao ledger da thread uma vez');
  const lista = falhas[0].falhas as string[];
  assert.equal(lista.length, 1, `so a parte alvo falha: ${JSON.stringify(lista)}`);
  assert.match(lista[0], parte);
  assert.match(String(falhas[0].correcao), /ork roadmap reservas --soltar-orfas/);
  assert.match(String(falhas[0].correcao), /ork sessions limpar-fantasmas/);
}

test('C4 lease: a pasta de leases sem escrita nao impede a reserva nem as sessoes, e a falha vai ao ledger',
  { skip: SEM_PERMISSAO }, () => {
    const c = cenario('c4-fecha-lease', UUID(1));
    const pasta = dirLeases(c.p.dir);
    try {
      entregar(c);
      fs.chmodSync(pasta, 0o555);
      aceitarPorOmissao(c.p.dir, c.t.id);
      fs.chmodSync(pasta, 0o755);

      assert.equal(lerThread(c.p.dir, c.t.id).status, 'fechada', 'a thread segue fechada');
      assert.equal(lerLease(c.p.dir, REGIAO)?.thread, c.t.id, 'o lease ficou: a parte falhou');
      assert.deepEqual(lerFila(c.p.dir).map((f) => f.thread), [c.t.id], 'a fila ficou');
      assert.deepEqual(reservasDoItem(c), [], 'a reserva saiu mesmo assim');
      assert.equal(eventos(c, TIPOS_DE_EVENTO.reservaLiberada).length, 1);
      assert.deepEqual(eventos(c, 'sessao_morta').map((e) => e.sessionId), [UUID(1)], 'a sessao fantasma saiu');
      falhaRegistrada(c, /^leases em /);
    } finally { fs.chmodSync(pasta, 0o755); c.restaurar(); }
  });

test('C4 sessoes: o ledger que nao se le nao impede os leases nem a reserva, e a falha vai ao ledger',
  { skip: SEM_PERMISSAO }, () => {
    const c = cenario('c4-fecha-sessoes', UUID(2));
    const ledger = path.join(dirThread(c.p.dir, c.t.id), 'ledger.jsonl');
    try {
      // O MASTER le o ledger para fechar; a falha entra entre o fechamento gravado e a soltura.
      const t = lerThread(c.p.dir, c.t.id);
      t.status = 'fechada';
      gravarThread(c.p.dir, t);
      fs.chmodSync(ledger, 0o200);
      const r = liberarAoFechar(c.p.dir, c.t.id);
      fs.chmodSync(ledger, 0o644);

      assert.equal(lerThread(c.p.dir, c.t.id).status, 'fechada', 'a thread segue fechada');
      assert.deepEqual(r.leases, [REGIAO]);
      assert.deepEqual(r.fila, ['path:core/**']);
      assert.equal(lerLease(c.p.dir, REGIAO), null, 'o lease saiu');
      assert.deepEqual(lerFila(c.p.dir), [], 'a fila saiu');
      assert.deepEqual(r.reservas.map((x) => [x.item, x.acao]), [[ITEM, 'solta']]);
      assert.deepEqual(reservasDoItem(c), [], 'a reserva saiu');
      assert.deepEqual(r.sessoes, [], 'a sessao fica: a parte falhou');
      assert.equal(eventos(c, 'sessao_morta').length, 0);
      assert.equal(r.falhas.length, 1);
      assert.match(r.falhas[0], /^sessoes: /);
      falhaRegistrada(c, /^sessoes: /);
    } finally { try { fs.chmodSync(ledger, 0o644); } catch { /* ja limpo */ } c.restaurar(); }
  });

test('C4 reserva: o remoto que sumiu vira pendencia com a correcao, e leases e sessoes saem', () => {
  const c = cenario('c4-fecha-reserva', UUID(3));
  try {
    entregar(c);
    exec('git', ['remote', 'set-url', 'origin', path.join(c.p.dir, 'remoto-que-nao-existe')], c.p.dir);
    aceitarPorOmissao(c.p.dir, c.t.id);

    assert.equal(lerThread(c.p.dir, c.t.id).status, 'fechada', 'a thread segue fechada');
    assert.equal(lerLease(c.p.dir, REGIAO), null, 'o lease saiu');
    assert.deepEqual(lerFila(c.p.dir), [], 'a fila saiu');
    assert.deepEqual(eventos(c, 'sessao_morta').map((e) => e.sessionId), [UUID(3)], 'a sessao fantasma saiu');
    const pendentes = eventos(c, TIPOS_DE_EVENTO.reservaPendente);
    assert.equal(pendentes.length, 1, 'a reserva que nao saiu fica como pendencia no ledger');
    assert.equal(pendentes[0].item, ITEM);
    assert.equal(pendentes[0].correcao, 'ork roadmap reservas --soltar-orfas');
    assert.equal(eventos(c, TIPOS_DE_EVENTO.reservaLiberada).length, 0);
    assert.equal(eventos(c, TIPOS_DE_EVENTO.solturaFalhou).length, 0, 'pendencia nao e excecao: nenhuma parte lancou');
  } finally { c.restaurar(); }
});

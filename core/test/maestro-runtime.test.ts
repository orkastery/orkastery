import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { novaThread,gravarThread,dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { discoverMaestro } from '../src/maestro-discovery';
import { collectMaestroSources } from '../src/maestro-sources';
import { observeWithDeadline } from '../src/maestro-runtime';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { abrirPedidoGate } from '../src/hitl-gates';
import { proporMaster } from '../src/master';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { definirFusoDoDono, formatarDataHoraRotulada } from '../src/horario';

const invalidLeaseFields: Record<string, unknown[]> = {
  nome: [undefined, null, '', '   ', 12, {}, [], 'path:\u0000'],
  thread: [undefined, null, '', 12, {}, [], '../outra', 'x'.repeat(81)],
  expiraEm: [undefined, null, '', 12, {}, [], 'invalido', '2026-02-30T00:00:00Z',
    '2026-09-01T00:00:00.' + '0'.repeat(600) + 'Z'],
};
for (const field of ['registro', ...Object.keys(invalidLeaseFields)]) {
  test(`GO-FIX6: lease com ${field} inválido isola leases sem abortar snapshot nem publicar itens parciais`, () => {
    const p = projetoTemporario('maestro-lease-invalid');
    try {
      const t = novaThread(p.carregado, { nome: 'Lease inválido', modo: 'auto' }).thread;
      const ctx = discoverMaestro({ cwd: p.dir }), baseline = maestroSnapshot(ctx);
      const valid = { nome: 'path:core/src/**', thread: t.id, expiraEm: '2999-01-01T00:00:00Z' };
      const dir = path.join(p.dir, '.orkastery/leases');
      fs.mkdirSync(dir, { recursive: true });
      const invalid = field === 'registro' ? [null, [], 'registro', 1, true, {}]
        : invalidLeaseFields[field].map(value => ({ ...valid, [field]: value }));
      for (const bad of invalid) for (const records of [[valid, bad], [bad, valid]]) {
        records.forEach((r, i) => fs.writeFileSync(path.join(dir, `${i}.json`), JSON.stringify(r)));
        for (const options of [{}, { threadId: t.id }, { threadId: 'outra-thread' }]) {
          const snapshot = maestroSnapshot(ctx, options), leases = snapshot.sections.leases;
          assert.equal(leases.state, 'unavailable', JSON.stringify({ field, bad }));
          assert.deepEqual(leases.items, []);
          assert.ok(leases.gaps.includes('leases.unavailable'));
          assert.equal(leases.coverage.total, null);
          assert.equal(leases.coverage.omitted, null);
          assert.equal(leases.coverage.returned, 0);
          assert.equal(leases.coverage.nextOffset, null);
          if (!options.threadId) for (const name of ['threads', 'sessions', 'blockers', 'retries', 'hitl', 'ship', 'master'] as const) {
            assert.equal(snapshot.sections[name].state, baseline.sections[name].state);
            assert.deepEqual(snapshot.sections[name].items, baseline.sections[name].items);
          }
        }
      }
    } finally { p.limpar(); }
  });
}

test('GO-FIX6: leases válidos preservam nome, referência de thread, expiração e filtro', () => {
  const p = projetoTemporario('maestro-lease-valid');
  try {
    const t = novaThread(p.carregado, { nome: 'Lease válido', modo: 'auto' }).thread;
    const ctx = discoverMaestro({ cwd: p.dir }), dir = path.join(p.dir, '.orkastery/leases');
    fs.mkdirSync(dir, { recursive: true });
    const records = [
      { nome: 'main-tree', thread: t.id, expiraEm: '2000-01-01T00:00:00Z' },
      { nome: 'path:core/src/**', thread: t.id, expiraEm: '2999-01-01T00:00:00+03:00' },
      { nome: 'service:5173', thread: 'outra-thread', expiraEm: '2999-01-01T00:00:00Z' },
    ];
    records.forEach((r, i) => fs.writeFileSync(path.join(dir, `${i}.json`), JSON.stringify(r)));
    assert.equal(maestroSnapshot(ctx).sections.leases.items.length, 3);
    const scoped = maestroSnapshot(ctx, { threadId: t.id }).sections.leases;
    assert.equal(scoped.state, 'available');
    assert.deepEqual(scoped.items.map(i => i.id), records.slice(0, 2).map(r => r.nome));
    assert.deepEqual(scoped.items.map(i => i.status), ['expired', 'active']);
    assert.deepEqual(scoped.items.map(i => i.facts.expiresAt), records.slice(0, 2).map(r => r.expiraEm));
    assert.ok(scoped.items.every(i => i.refs.length === 1 && i.refs[0].kind === 'thread' && i.refs[0].id === t.id));
    fs.writeFileSync(path.join(dir, '2.json'), JSON.stringify({ ...records[2], expiraEm: 12 }));
    const invalidOutsideScope = maestroSnapshot(ctx, { threadId: t.id }).sections.leases;
    assert.equal(invalidOutsideScope.state, 'unavailable');
    assert.deepEqual(invalidOutsideScope.items, []);
  } finally { p.limpar(); }
});

const invalidRetryFields: Record<string, unknown[]> = {
  id: [undefined, null, '', 12, {}, [], 'R0', 'R-1', 'R1'.repeat(100)],
  thread: [undefined, null, '', 12, {}, [], '../outra', 'x'.repeat(81)],
  estado: [undefined, null, '', 12, {}, [], 'due', 'desconhecido'],
  liberaEm: [undefined, null, '', 12, {}, [], 'invalido', '2026-02-30T00:00:00Z',
    '2026-09-01T00:00:00.' + '0'.repeat(600) + 'Z'],
  tentativas: [undefined, null, '1', {}, [], -1, 0.5, Number.MAX_SAFE_INTEGER + 1],
};
for (const field of ['registro', ...Object.keys(invalidRetryFields)]) {
  test(`GO-FIX5: retry com ${field} inválido indisponibiliza só retries sem itens parciais`, () => {
    const p = projetoTemporario('maestro-retry-invalid');
    try {
      const t = novaThread(p.carregado, { nome: 'Fila inválida', modo: 'auto' }).thread;
      const ctx = discoverMaestro({ cwd: p.dir }), baseline = maestroSnapshot(ctx);
      const valid = { id: 'R1', thread: t.id, estado: 'aguardando', liberaEm: '2026-09-01T00:00:00Z', tentativas: 0 };
      const file = path.join(p.dir, '.orkastery/retry/fila.jsonl');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const invalid = field === 'registro' ? [null, [], 'registro', 1, true, {}]
        : invalidRetryFields[field].map(value => ({ ...valid, [field]: value }));
      for (const bad of invalid) for (const records of [[valid, bad], [bad, valid]]) {
        fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
        for (const options of [{}, { threadId: t.id }]) {
          const snapshot = maestroSnapshot(ctx, options), retries = snapshot.sections.retries;
          assert.equal(retries.state, 'unavailable', JSON.stringify({ field, bad }));
          assert.deepEqual(retries.items, []);
          assert.ok(retries.gaps.includes('retries.unavailable'));
          assert.equal(retries.coverage.total, null);
          for (const name of ['threads', 'sessions', 'blockers', 'leases', 'hitl', 'ship', 'master'] as const) {
            assert.equal(snapshot.sections[name].state, baseline.sections[name].state);
            assert.deepEqual(snapshot.sections[name].items, baseline.sections[name].items);
          }
        }
      }
    } finally { p.limpar(); }
  });
}

test('GO-FIX5: retry válido preserva última versão, estado, prazo, tentativas e filtro da thread', () => {
  const p = projetoTemporario('maestro-retry-valid');
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const t = novaThread(p.carregado, { nome: 'Fila válida', modo: 'auto' }).thread;
    const ctx = discoverMaestro({ cwd: p.dir }), file = path.join(p.dir, '.orkastery/retry/fila.jsonl');
    const valid = { id: 'R1', thread: t.id, estado: 'aguardando', liberaEm: '2000-01-01T00:00:00Z', tentativas: 0 };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const records = [valid, { ...valid, tentativas: 2 },
      { ...valid, id: 'R2', liberaEm: '2999-01-01T00:00:00+03:00' },
      ...['retomado', 'escalado', 'cancelado'].map((estado, i) => ({ ...valid, id: `R${i + 3}`, estado })),
      { ...valid, id: 'R6', thread: 'outra-thread' }];
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    assert.equal(maestroSnapshot(ctx).sections.retries.items.length, 6);
    const scoped = maestroSnapshot(ctx, { threadId: t.id }).sections.retries;
    assert.equal(scoped.state, 'available');
    assert.deepEqual(scoped.items.map(r => r.status), ['due', 'aguardando', 'retomado', 'escalado', 'cancelado']);
    // I-35: o fato local acompanha o ISO, absoluto e rotulado no fuso do dono.
    assert.deepEqual(scoped.items[0].facts, { availableAt: valid.liberaEm, availableAtLocal: formatarDataHoraRotulada(valid.liberaEm), attempts: 2 });
    assert.deepEqual(scoped.items[0].refs, [{ kind: 'thread', id: t.id }]);
    fs.appendFileSync(file, JSON.stringify({ ...valid, id: 'R6', thread: 'outra-thread', tentativas: {} }) + '\n');
    const invalidOutsideScope = maestroSnapshot(ctx, { threadId: t.id }).sections.retries;
    assert.equal(invalidOutsideScope.state, 'unavailable');
    assert.deepEqual(invalidOutsideScope.items, []);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

for (const evento of [{ tipo: 'gate_passed' }, { tipo: 'phase_dispatch' }, { tipo: 'lease_acquired' },
  { tipo: 'rate_limit_resumed' }, { tipo: 'ship_done' }, { tipo: 'master_done' },
  { tipo: 'human_gate', estado: 'aprovado' }]) {
  test(`GO-FIX5: ${evento.tipo} posterior remove blocker obsoleto e conserva novo bloqueio`, () => {
    const p = projetoTemporario('maestro-blocker-resolution');
    try {
      const t = novaThread(p.carregado, { nome: 'Bloqueio resolvido', modo: 'auto' }).thread;
      const dir = dirThread(p.dir, t.id), ctx = discoverMaestro({ cwd: p.dir });
      const read = () => maestroSnapshot(ctx).sections.blockers;
      registrar(dir, t.id, evento.tipo, evento);
      registrar(dir, t.id, 'gate_blocked', { motivo: 'lease.busy' });
      assert.equal(read().items[0].facts.reason, 'lease.busy', 'evento anterior não destrava');
      registrar(dir, t.id, evento.tipo, evento);
      assert.equal(read().state, 'empty');
      assert.deepEqual(read().items, []);
      registrar(dir, t.id, 'gate_blocked', { motivo: 'policy.violation' });
      assert.equal(read().items[0].facts.reason, 'policy.violation', 'novo bloqueio prevalece');
    } finally { p.limpar(); }
  });
}

test('GO-FIX5: progresso, tentativa de retry e pausa humana não destravam gate', () => {
  const p = projetoTemporario('maestro-blocker-open');
  try {
    const t = novaThread(p.carregado, { nome: 'Bloqueio atual', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id), ctx = discoverMaestro({ cwd: p.dir });
    registrar(dir, t.id, 'gate_blocked', { motivo: 'cost.violation' });
    for (const evento of [{ tipo: 'runtime_heartbeat' }, { tipo: 'phase_result' }, { tipo: 'retry_attempt' },
      { tipo: 'human_gate', estado: 'prevista ao fim do bloco' }, { tipo: 'human_gate', estado: 'reprovado' }]) {
      registrar(dir, t.id, evento.tipo, evento);
      assert.equal(maestroSnapshot(ctx).sections.blockers.items[0].facts.reason, 'cost.violation');
    }
  } finally { p.limpar(); }
});

test('sessões simultâneas, conflito nativo, ausência de phase_result, push incerto e score pendente',()=>{
  const p=projetoTemporario('maestro-runtime');
  try {
    const t=novaThread(p.carregado,{nome:'Operação',modo:'auto'}).thread;
    for(const [id,runtime] of [['sessao-claude','claude-bg'],['sessao-codex','codex']])t.sessoes.push({sessionId:id,runtime,fase:'GO',bloco:'GO',slug:t.slug,promptPath:'',promptSha256:'',despachadaEm:new Date().toISOString(),verificada:true});
    gravarThread(p.dir,t);
    registrar(dirThread(p.dir,t.id),t.id,'ship_done',{pushVerificado:false,mergeSha:'a'.repeat(40)});
    registrar(dirThread(p.dir,t.id),t.id,'gate_blocked',{motivo:'policy.violation'});
    const ctx=discoverMaestro({cwd:p.dir});
    const unknown=collectMaestroSources(ctx).sections;
    assert.ok(unknown.sessions!.items.every(s=>s.status==='unknown'));
    const s=collectMaestroSources(ctx,{native:[{sessionId:'sessao-claude',runtime:'claude-bg',state:'working',status:'idle'},
      {sessionId:'sessao-codex',runtime:'codex',state:'completed'}]}).sections;
    assert.equal(s.sessions!.items[0].status,'conflict');
    assert.equal(s.sessions!.items[1].facts.reason,'phase.result_missing');
    assert.equal(s.ship!.items[0].status,'incomplete');assert.equal(s.master!.items[0].status,'pending');
    assert.equal(s.blockers!.items[0].facts.reason,'policy.violation');
    registrar(dirThread(p.dir,t.id),t.id,'ship_done',{pushVerificado:true,mergeSha:'a'.repeat(40),shaRemoto:'a'.repeat(40),fonteDaProva:'git ls-remote origin refs/heads/main'});
    assert.equal(collectMaestroSources(ctx).sections.ship!.items[0].status,'delivered');
  } finally {p.limpar();}
});
test('fonte nativa lenta ou negada devolve desconhecido e recebe cancelamento',async()=>{
  let cancelled=false;
  assert.deepEqual(await observeWithDeadline(signal=>new Promise(resolve=>{signal.addEventListener('abort',()=>{cancelled=true;resolve([]);});}),10),[]);
  assert.equal(cancelled,true);
  assert.deepEqual(await observeWithDeadline(async()=>{throw Error('login negado');}),[]);
});

for (const change of ['phase', 'mode', 'status', 'base', 'dispatch'] as const) test(`HITL fica stale quando muda ${change}, mesmo antes do prazo`, () => {
  const p = projetoTemporario('maestro-hitl-context');
  try {
    const t = novaThread(p.carregado, { nome: 'Contexto HITL', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id), ctx = discoverMaestro({ cwd: p.dir });
    const read = () => collectMaestroSources(ctx).sections.hitl!.items.find(i => i.id === q.id)!;
    assert.equal(read().status, 'aberto');
    if (change === 'phase') t.faseAtual = 'PLAN';
    if (change === 'mode') t.modo = 'auto';
    if (change === 'status') t.status = 'fechada';
    if (change === 'base') t.base.commit = 'b'.repeat(40);
    if (change === 'dispatch') registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { sessionId: 'new-session' });
    gravarThread(p.dir, t);
    assert.equal(read().status, 'stale');
    assert.equal(read().facts.reason, 'hitl.context.stale');
    registrar(dirThread(p.dir, t.id), t.id, 'session_answer_sending', { pedidoId: q.id });
    assert.equal(read().status, 'stale');
    assert.equal(read().facts.deliveryUncertain, true);
  } finally { p.limpar(); }
});

test('MASTER proposto pelo núcleo aparece como ratificação pendente; proposta inválida continua indisponível', () => {
  const p = projetoTemporario('maestro-master-pending');
  try {
    const t = novaThread(p.carregado, { nome: 'Ratificação', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40) });
    const log = proporMaster(p.dir, t.id, { score: 4, justificativa: 'proposta simulada', classes: ['sem-falha'], por: 'Codex' });
    const ctx = discoverMaestro({ cwd: p.dir }), read = () => collectMaestroSources(ctx).sections.master!;
    assert.deepEqual(read().gaps, []);
    assert.equal(read().items[0].status, 'ratificacao-pendente');
    assert.equal(read().items[0].facts.score, null);
    const file = path.join(dirThread(p.dir, t.id), 'master-log.json');
    for (const invalid of [{ ...log, score: 4 }, { ...log, avaliadoPor: 'humano inventado' },
      { ...log, score_proposto: { ...log.score_proposto, valor: 6 } }, { ...log, thread: 'ork-other' }]) {
      fs.writeFileSync(file, JSON.stringify(invalid));
      assert.equal(read().state, 'unavailable');
      assert.ok(read().gaps.includes(`master.invalid:${t.id}`));
      assert.deepEqual(read().items, []);
    }
  } finally { p.limpar(); }
});

type ShipCaso = [string, string, Record<string, unknown>];
const shipDoneValido = { pushVerificado: true, mergeSha: 'a'.repeat(40), shaRemoto: 'a'.repeat(40),
  fonteDaProva: 'git ls-remote origin refs/heads/main' };
const shipInvalido: ShipCaso[] = [
  ...[undefined, null, 12, '', 'invalido', '2026-02-30T00:00:00Z', '2026-09-01T00:00:00.' + '0'.repeat(600) + 'Z']
    .map((ts): ShipCaso => ['ts', 'ship_done', { ...shipDoneValido, ts }]),
  ...[undefined, null, 'true', 1].map((pushVerificado): ShipCaso => ['pushVerificado', 'ship_done', { ...shipDoneValido, pushVerificado }]),
  ...[undefined, null, 12, {}, 'A'.repeat(40), 'a'.repeat(39)].map((mergeSha): ShipCaso => ['mergeSha', 'ship_done', { ...shipDoneValido, mergeSha }]),
  // Push verificado que contradiz o remoto ou a fonte da prova não é entrega incompleta.
  ...[undefined, null, 12, 'xyz', 'b'.repeat(40)].map((shaRemoto): ShipCaso => ['shaRemoto', 'ship_done', { ...shipDoneValido, shaRemoto }]),
  ...[undefined, null, 12, '', {}, 'git ls-remote\u0000origin'].map((fonteDaProva): ShipCaso => ['fonteDaProva', 'ship_done', { ...shipDoneValido, fonteDaProva }]),
  ['shaRemoto', 'ship_done', { pushVerificado: false, mergeSha: 'a'.repeat(40), shaRemoto: 12 }],
  ...['ship_started', 'ship_blocked'].flatMap(tipo => [null, 'invalido'].map((ts): ShipCaso => ['ts', tipo, { ts }])),
];
test('GO-FIX7: ship com campo consumido inválido indisponibiliza só ship e preserva o snapshot', () => {
  const p = projetoTemporario('maestro-ship-invalid');
  try {
    const t = novaThread(p.carregado, { nome: 'Ship inválido', modo: 'classic' }).thread;
    const outra = novaThread(p.carregado, { nome: 'Ship válido', modo: 'auto' }).thread;
    t.sessoes.push({ sessionId: 'sessao-ship', runtime: 'codex', fase: 'SHIP', bloco: 'SHIP', slug: t.slug, promptPath: '',
      promptSha256: '', despachadaEm: new Date().toISOString(), verificada: true });
    gravarThread(p.dir, t);
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id);
    registrar(dir, t.id, 'ship_started', { de: 'ork/ship', para: 'main' });
    registrar(dirThread(p.dir, outra.id), outra.id, 'ship_done', shipDoneValido);
    const ctx = discoverMaestro({ cwd: p.dir }), baseline = maestroSnapshot(ctx);
    assert.equal(baseline.sections.ship.state, 'available');
    assert.ok(baseline.sections.hitl.items.some(i => i.id === q.id));
    const entregue = baseline.sections.ship.items.find(i => i.id === `ship:${outra.id}`)!;
    assert.equal(entregue.status, 'delivered');
    for (const [campo, tipo, dados] of shipInvalido) {
      registrar(dir, t.id, tipo, dados);
      const caso = JSON.stringify({ campo, tipo, dados }).slice(0, 200);
      const snapshot = maestroSnapshot(ctx), ship = snapshot.sections.ship;
      assert.equal(ship.state, 'unavailable', caso);
      assert.ok(ship.gaps.includes(`ship.invalid:${t.id}`), caso);
      assert.equal(ship.coverage.total, null, caso);
      // Nada do recibo inválido é projetado; a entrega válida de outra thread permanece.
      assert.deepEqual(ship.items, [entregue], caso);
      for (const name of ['threads', 'sessions', 'blockers', 'leases', 'retries', 'hitl', 'master'] as const) {
        assert.equal(snapshot.sections[name].state, baseline.sections[name].state, `${name} ${caso}`);
        assert.deepEqual(snapshot.sections[name].items, baseline.sections[name].items, `${name} ${caso}`);
      }
      const escopo = maestroSnapshot(ctx, { threadId: outra.id }).sections.ship;
      assert.equal(escopo.state, 'available', caso);
      assert.deepEqual(escopo.items, [entregue], caso);
      // Recibo válido posterior devolve a seção sem reaproveitar o inválido.
      registrar(dir, t.id, 'ship_started', { de: 'ork/ship', para: 'main' });
      assert.equal(maestroSnapshot(ctx).sections.ship.state, 'available', caso);
    }
  } finally { p.limpar(); }
});

test('GO-FIX7: recibos de ship válidos projetam entrega, incompleto e início sem campos inventados', () => {
  const p = projetoTemporario('maestro-ship-valid');
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const t = novaThread(p.carregado, { nome: 'Ship válido', modo: 'auto' }).thread, dir = dirThread(p.dir, t.id);
    const ctx = discoverMaestro({ cwd: p.dir }), read = () => maestroSnapshot(ctx).sections.ship;
    const casos: [string, Record<string, unknown>, string, Record<string, unknown>][] = [
      ['ship_done', { ...shipDoneValido, ts: '2026-09-18T10:00:00+03:00' }, 'delivered',
        { pushVerified: true, mergeSha: 'a'.repeat(40), receiptAt: '2026-09-18T10:00:00+03:00' }],
      ['ship_done', { pushVerificado: false, mergeSha: 'b'.repeat(40), shaRemoto: null, fonteDaProva: null, ts: '2026-09-18T10:01:00Z' },
        'incomplete', { pushVerified: false, mergeSha: 'b'.repeat(40), receiptAt: '2026-09-18T10:01:00Z' }],
      ['ship_done', { pushVerificado: false, mergeSha: 'c'.repeat(40), ts: '2026-09-18T10:02:00Z' },
        'incomplete', { pushVerified: false, mergeSha: 'c'.repeat(40), receiptAt: '2026-09-18T10:02:00Z' }],
      ['ship_started', { de: 'ork/x', para: 'main', mergeSha: 'd'.repeat(40), ts: '2026-09-18T10:03:00Z' },
        'incomplete', { pushVerified: false, mergeSha: null, receiptAt: '2026-09-18T10:03:00Z' }],
      ['ship_blocked', { motivo: 'runtime.unavailable', ts: '2026-09-18T10:04:00Z' },
        'incomplete', { pushVerified: false, mergeSha: null, receiptAt: '2026-09-18T10:04:00Z' }],
    ];
    for (const [tipo, dados, status, facts] of casos) {
      registrar(dir, t.id, tipo, dados);
      const ship = read();
      assert.equal(ship.state, 'available', tipo);
      assert.deepEqual(ship.gaps, []);
      assert.equal(ship.items.length, 1);
      assert.equal(ship.items[0].status, status, tipo);
      // I-35: além dos fatos da base, só o horário local derivado do próprio recibo.
      assert.deepEqual(ship.items[0].facts, { ...facts, receiptAtLocal: formatarDataHoraRotulada(String(facts.receiptAt)) }, tipo);
    }
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

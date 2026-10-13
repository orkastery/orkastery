/**
 * RM-058 (N6, D4, D5 e D9 da ork-rm058n6): a medição do consumo do arco em `minutos-de-sessao`, `tokens` e
 * `percentual-da-cota`, com lacuna em vez de zero, e o orçamento medido na reserva e no passo da N2.
 * Sessões, transcrições, rollouts, contas e provas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado } from './noctum-apoio';
import { depois, MIN } from './noctum-n6-apoio';
import { registrarConducaoDaSessao } from '../src/conducao';
import { kernelDisponivel } from '../src/fila-pesada';
import { registrar } from '../src/ledger';
import { DespachoDoArco, EstadoDoArco, PedidoDeDespacho, reservarDespacho } from '../src/noctum-arco';
import { RecusaDoArco, validarPedidoDeAbertura } from '../src/noctum-envelope';
import { OpcoesDoPasso, passoDoArco } from '../src/noctum-execucao';
import { consumoDoEscopoNaUnidade, cotaDasLeituras, FontesDeMedicao, fontesDoDisco, leituraDoRollout, MedicaoDoArco,
  medidoParaReserva, medirArco, precisaMedir, textoDoConsumo, tokensDasTranscricoes } from '../src/noctum-medicao';
import { ResultadoRun } from '../src/phase';
import { dirThread, novaThread } from '../src/thread';
import { EventoLedger } from '../src/types';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const T0 = '2026-10-13T01:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function estado(despachos: Array<Partial<DespachoDoArco>>): EstadoDoArco {
  const ds: DespachoDoArco[] = despachos.map((d, i) => ({ trabalho: `t${i}`, thread: null, fase: 'GO', runtime: 'claude-bg', conta: 'perfil-a',
    revisao: false, versao: 1, envelopeSha256: 'a'.repeat(64), seq: i + 3, reservadoEm: T0, desfecho: 'concluido', threadDespachada: `th-${i}`,
    sessionId: uuid(i + 1), idempotente: false, motivo: null, concluidoEm: T0, ...d }));
  const contar = (chave: 'conta' | 'runtime') => ds.filter(d => d.desfecho !== 'recusado')
    .reduce<Record<string, number>>((m, d) => ({ ...m, [d[chave]]: (m[d[chave]] ?? 0) + 1 }), {});
  return { contrato: 'ork.noctum-arco/v1', arco: 'arco-me', situacao: 'vigente', versao: 1, envelopeSha256: 'a'.repeat(64), conteudo: null,
    autorizadoPor: null, revogadoPor: null, propostaPendente: null, decisoes: [], despachos: ds,
    consumo: { arco: ds.filter(d => d.desfecho !== 'recusado').length, porConta: contar('conta'), porRuntime: contar('runtime') }, encerramento: null };
}

const ev = (tipo: string, ts: string, sessionId: string): EventoLedger => ({ ts, thread: 'x', tipo, sessionId } as EventoLedger);
const linha = (o: unknown) => JSON.stringify(o) + '\n';
const uso = (id: string | null, i: number, cc: number, cr: number, o: number, uuidDaLinha = id ?? 'sem-id') =>
  linha({ type: 'assistant', uuid: uuidDaLinha, message: { ...(id ? { id } : {}), usage: { input_tokens: i, cache_creation_input_tokens: cc,
    cache_read_input_tokens: cr, output_tokens: o } } });
const contagem = (ts: string, total: number, limites?: Record<string, unknown>) =>
  linha({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total - 100,
    output_tokens: 100, total_tokens: total } }, ...(limites ? { rate_limits: limites } : {}) } });

/** Fontes simuladas: ledgers por thread, transcrições e rollouts em memória. */
function fontes(o: { eventos?: Record<string, EventoLedger[] | null>; arquivos?: Record<string, string>; transcricoes?: Record<string, string[] | null>;
  rollouts?: Record<string, string | null>; perfil?: FontesDeMedicao['perfil'] }): Partial<FontesDeMedicao> {
  return {
    eventos: (t) => o.eventos?.[t] === undefined ? [] : o.eventos[t],
    cwd: (t) => `/tmp/wt-${t}`,
    perfil: o.perfil ?? (() => null),
    transcricoes: (_p, _c, s) => o.transcricoes?.[s] === undefined ? null : o.transcricoes[s],
    rollout: (_p, s) => o.rollouts?.[s] ?? null,
    ler: (a) => o.arquivos?.[a] === undefined ? null : Buffer.from(o.arquivos[a], 'utf8'),
  };
}

test('ME1: minutos de sessão do phase_dispatch ao resultado, para cima, e a sessão em voo parcial até a leitura', () => {
  const e = estado([{ threadDespachada: 'th-a', sessionId: uuid(1) }, { threadDespachada: 'th-b', sessionId: uuid(2) }]);
  const eventos = {
    'th-a': [ev('phase_dispatch', T0, uuid(1)), ev('runtime_heartbeat', depois(T0, 5 * MIN), uuid(1)), ev('phase_result', depois(T0, 30 * MIN + 10_000), uuid(1))],
    'th-b': [ev('phase_dispatch', depois(T0, 5 * MIN), uuid(2))],
  };
  const m = medirArco('/nao-usado', e, { quando: depois(T0, 45 * MIN), fontes: fontes({ eventos }) });
  const [a, b] = m.sessoes;
  assert.deepEqual(a.minutos, { valor: 31, parcial: false, tetoSuperior: false, fonte: 'do phase_dispatch ao resultado gravado no ledger' });
  assert.equal(b.emVoo, true);
  assert.ok('valor' in b.minutos && b.minutos.valor === 40 && b.minutos.parcial);
  assert.equal(m.doArco['minutos-de-sessao'].valor, 71);
  assert.equal(m.doArco['minutos-de-sessao'].parcial, true);
  assert.equal(m.doArco.sessoes.valor, 2, 'sessoes continua a contagem da N2 (reservas não recusadas)');
  // Sem o phase_dispatch da sessão, o minuto é lacuna, e a lacuna contamina o escopo.
  const sem = medirArco('/nao-usado', e, { quando: depois(T0, 45 * MIN), fontes: fontes({ eventos: { ...eventos, 'th-b': [] } }) });
  assert.equal(sem.doArco['minutos-de-sessao'].valor, null);
  assert.match(sem.doArco['minutos-de-sessao'].lacunas.join(), /sem o phase_dispatch/);
});

test('ME2: tokens do Claude Code uma vez por message.id, com os subagentes, e a linha sem id contando sozinha', () => {
  const principal = uso('msg_1', 2, 100, 1000, 50) + uso('msg_1', 2, 100, 1000, 50) + uso('msg_2', 3, 0, 1100, 20) +
    linha({ type: 'user', message: { content: 'x' } });
  const subagente = uso('msg_3', 10, 0, 0, 5) + uso(null, 1, 0, 0, 1, 'u-sem-id');
  const t = tokensDasTranscricoes([Buffer.from(principal), Buffer.from(subagente)]);
  assert.ok('valor' in t);
  assert.equal(t.valor, (2 + 100 + 1000 + 50) + (3 + 1100 + 20) + (10 + 5) + 2);
  const e = estado([{ threadDespachada: 'th-a', sessionId: uuid(1) }]);
  const m = medirArco('/nao-usado', e, { quando: depois(T0, 10 * MIN), fontes: fontes({ eventos: { 'th-a': [ev('phase_dispatch', T0, uuid(1))] },
    transcricoes: { [uuid(1)]: ['/t/principal.jsonl', '/t/sub.jsonl'] }, arquivos: { '/t/principal.jsonl': principal, '/t/sub.jsonl': subagente } }) });
  assert.equal(m.doArco.tokens.valor, 2292);
  assert.equal(m.doArco.tokens.parcial, true, 'a sessão ainda corre: o total cresce');
});

test('ME3: tokens e cota do codex vêm do rollout; a cota é o maior percentual da janela, como teto superior', () => {
  const renova = Date.parse('2026-10-18T00:00:00Z') / 1000;
  const limites = (p: number) => ({ primary: { used_percent: p, window_minutes: 10080, resets_at: renova },
    secondary: { used_percent: p / 4, window_minutes: 300, resets_at: renova - 3 * 86400 } });
  const rollout = contagem(depois(T0, MIN), 1200, limites(40)) + contagem(depois(T0, 9 * MIN), 5200, limites(43));
  const r = leituraDoRollout(Buffer.from(rollout));
  assert.deepEqual(r.tokens, { valor: 5200, parcial: false, tetoSuperior: false, fonte: 'token_count do rollout do codex' });
  assert.ok(Array.isArray(r.cota) && r.cota.length === 4);
  const cota = cotaDasLeituras(r.cota as never);
  assert.ok('valor' in cota && cota.valor === 43 && cota.tetoSuperior);
  const e = estado([{ threadDespachada: 'th-c', sessionId: uuid(1), runtime: 'codex', conta: 'perfil-codex' }]);
  const m = medirArco('/nao-usado', e, { quando: depois(T0, 20 * MIN), fontes: fontes({
    eventos: { 'th-c': [ev('phase_dispatch', T0, uuid(1)), ev('phase_result', depois(T0, 10 * MIN), uuid(1))] },
    rollouts: { [uuid(1)]: '/r/rollout.jsonl' }, arquivos: { '/r/rollout.jsonl': rollout } }) });
  assert.equal(m.porConta['perfil-codex']['percentual-da-cota'].valor, 43);
  assert.equal(m.porConta['perfil-codex']['percentual-da-cota'].tetoSuperior, true);
  assert.equal(m.porRuntime.codex.tokens.valor, 5200);
  assert.equal(textoDoConsumo(m.porConta['perfil-codex']['percentual-da-cota']), 'até 43% (teto superior)');
});

test('ME4: a janela que renova no meio do arco vira lacuna, porque o uso de antes da renovação não se prova', () => {
  const r = cotaDasLeituras([
    { janelaMin: 300, usado: 80, renovaEm: Date.parse('2026-10-13T02:00:00Z'), lidaEm: T0 },
    { janelaMin: 300, usado: 5, renovaEm: Date.parse('2026-10-13T07:00:00Z'), lidaEm: depois(T0, 90 * MIN) },
  ]);
  assert.ok('lacuna' in r);
  assert.match(r.lacuna, /renovou no meio do arco/);
  // O mesmo resets_at com o arredondamento do runtime (menos de 2 min) é a mesma janela.
  const mesma = cotaDasLeituras([
    { janelaMin: 300, usado: 30, renovaEm: Date.parse('2026-10-13T07:00:00Z'), lidaEm: T0 },
    { janelaMin: 300, usado: 35, renovaEm: Date.parse('2026-10-13T07:00:59Z'), lidaEm: depois(T0, MIN) },
  ]);
  assert.ok('valor' in mesma && mesma.valor === 35);
});

test('ME5: conta claude-bg em percentual é lacuna; escopo sem sessão do arco mede zero', () => {
  const e = estado([{ threadDespachada: 'th-a', sessionId: uuid(1), conta: 'perfil-a' }]);
  const m = medirArco('/nao-usado', e, { quando: depois(T0, MIN), fontes: fontes({ eventos: { 'th-a': [ev('phase_dispatch', T0, uuid(1))] },
    transcricoes: { [uuid(1)]: ['/t/p.jsonl'] }, arquivos: { '/t/p.jsonl': uso('m1', 1, 0, 0, 1) } }) });
  const cota = consumoDoEscopoNaUnidade(m, { conta: 'perfil-a' }, 'percentual-da-cota');
  assert.equal(cota.valor, null);
  assert.match(cota.lacunas.join(), /só mostra a cota aos mods dentro da sessão/);
  const outra = consumoDoEscopoNaUnidade(m, { conta: 'perfil-b' }, 'percentual-da-cota');
  assert.deepEqual([outra.valor, outra.sessoes, outra.lacunas], [0, 0, []], 'nenhuma sessão do arco na conta: zero provado');
  assert.equal(consumoDoEscopoNaUnidade(m, { runtime: 'codex' }, 'tokens').valor, 0);
});

test('ME6: a reserva pendente é lacuna em toda unidade medida e contamina o escopo dela', () => {
  const e = estado([{ desfecho: 'pendente', sessionId: null, threadDespachada: null, thread: 'th-p' },
    { threadDespachada: 'th-a', sessionId: uuid(2) }]);
  const m = medirArco('/nao-usado', e, { quando: depois(T0, MIN), fontes: fontes({ eventos: { 'th-a': [ev('phase_dispatch', T0, uuid(2))] },
    transcricoes: { [uuid(2)]: ['/t/p.jsonl'] }, arquivos: { '/t/p.jsonl': uso('m1', 1, 0, 0, 1) } }) });
  for (const u of ['minutos-de-sessao', 'tokens', 'percentual-da-cota'] as const) {
    assert.equal(m.doArco[u].valor, null, u);
    assert.match(m.doArco[u].lacunas.join(), /reserva pendente/, u);
  }
  assert.equal(m.doArco.sessoes.valor, 2, 'a reserva pendente segue contada em sessoes, como na N2');
});

test('ME7: transcrição ausente e linha ilegível no meio são lacuna; a cauda sem quebra é gravação em curso', () => {
  const e = estado([{ threadDespachada: 'th-a', sessionId: uuid(1) }]);
  const base = { eventos: { 'th-a': [ev('phase_dispatch', T0, uuid(1))] } };
  const ausente = medirArco('/nao-usado', e, { quando: depois(T0, MIN), fontes: fontes(base) });
  assert.match(ausente.doArco.tokens.lacunas.join(), /sem a transcrição/);
  const meio = uso('m1', 1, 0, 0, 1) + '{isto nao e json\n' + uso('m2', 1, 0, 0, 1);
  assert.match(String((tokensDasTranscricoes([Buffer.from(meio)]) as { lacuna: string }).lacuna), /ilegível/);
  const cauda = uso('m1', 1, 0, 0, 1) + '{"type":"assistant","message":{"id":"m2","usage":{"input_tok';
  const t = tokensDasTranscricoes([Buffer.from(cauda)]);
  assert.ok('valor' in t && t.valor === 2);
  const ilegivelNoRollout = leituraDoRollout(Buffer.from('{quebrado\n' + contagem(T0, 10)));
  assert.ok('lacuna' in ilegivelNoRollout.tokens && !Array.isArray(ilegivelNoRollout.cota));
  const semContagem = leituraDoRollout(Buffer.from(linha({ type: 'session_meta' }))).tokens;
  assert.ok('lacuna' in semContagem);
  assert.match(semContagem.lacuna, /sem contagem de tokens/);
});

/** O pedido v2 com o teto do arco em minutos de sessão (os subtetos seguem em sessões). */
function pedidoEmMinutos(arco: string, minutos: number, trabalhos: Parameters<typeof pedidoV2>[1]['trabalhos']): Record<string, unknown> {
  const p = pedidoV2(arco, { trabalhos });
  return { ...p, orcamento: { ...(p.orcamento as Record<string, unknown>), arco: { valor: minutos, unidade: 'minutos-de-sessao' } } };
}

test('ME8: a reserva admite com o consumo medido abaixo do teto, recusa alcançado e recusa sem medida ou com lacuna', { skip: semKernel }, () => {
  const raiz = dirTemporario('noctum-me8');
  fs.mkdirSync(path.join(raiz, '.orkastery'));
  try {
    const trabalhos = [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ork-simulada-t1' }];
    const sha256 = autorizarPedido(raiz, 'arco-me8', pedidoEmMinutos('arco-me8', 60, trabalhos));
    const pedido = (medido?: PedidoDeDespacho['medido']): PedidoDeDespacho => ({ arco: 'arco-me8', envelopeSha256: sha256, trabalho: 't1',
      thread: 'ork-simulada-t1', fase: 'GO', runtime: 'claude-bg', conta: 'perfil-a', revisao: false, ...(medido ? { medido } : {}) });
    const recusa = (fn: () => unknown, motivo: string): string => {
      try { fn(); } catch (e) { assert.ok(e instanceof RecusaDoArco); assert.equal(e.motivo, motivo, e.message); return e.message; }
      return assert.fail(`esperava ${motivo}`);
    };
    assert.match(recusa(() => reservarDespacho(raiz, pedido()), 'noctum.orcamento.sem-medicao'), /não foi medido/);
    assert.match(recusa(() => reservarDespacho(raiz, pedido({ arco: { unidade: 'minutos-de-sessao', lacuna: 'reserva pendente simulada' } })),
      'noctum.orcamento.sem-medicao'), /reserva pendente simulada/);
    recusa(() => reservarDespacho(raiz, pedido({ arco: { unidade: 'tokens', valor: 1 } })), 'noctum.orcamento.sem-medicao');
    assert.match(recusa(() => reservarDespacho(raiz, pedido({ arco: { unidade: 'minutos-de-sessao', valor: 60 } })), 'noctum.orcamento.esgotado'),
      /60 minutos-de-sessao e o consumo medido é 60/);
    const ok = reservarDespacho(raiz, pedido({ arco: { unidade: 'minutos-de-sessao', valor: 59 } }));
    assert.equal(ok.consumo.arco, 1);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

let sessoes = 0;
const despachoSimulado: NonNullable<OpcoesDoPasso['despachar']> = (carregado, threadId, o) => {
  sessoes += 1;
  const sessionId = `00000000-0000-4000-8000-${String(900 + sessoes).padStart(12, '0')}`;
  registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600_000 },
    { sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
  registrar(dirThread(carregado.raiz, threadId), threadId, 'phase_dispatch', { fase: o.fase, sessionId, runtime: 'claude-bg', pausaAoFim: false,
    correlacao: o.correlacao });
  return { sessionId, verificada: true, bloqueado: false, motivo: null } as unknown as ResultadoRun;
};

function medicaoCom(arco: string, minutos: number | null): MedicaoDoArco {
  const u = (unidade: 'sessoes' | 'minutos-de-sessao' | 'tokens' | 'percentual-da-cota', valor: number | null) =>
    ({ unidade, valor, lacunas: valor === null ? ['simulada'] : [], parcial: false, tetoSuperior: false, sessoes: 1 });
  const porUnidade = { sessoes: u('sessoes', 0), 'minutos-de-sessao': u('minutos-de-sessao', minutos), tokens: u('tokens', 0),
    'percentual-da-cota': u('percentual-da-cota', 0) };
  return { contrato: 'ork.noctum-medicao/v1', arco, quando: new Date().toISOString(), sessoes: [], doArco: porUnidade, porConta: {}, porRuntime: {} };
}

test('ME9: o passo da N2 mede uma vez e despacha com o teto em minutos abaixo do medido; alcançado, não despacha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-me9');
  try {
    const trabalhos = [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA do arco medido.' },
      { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: [], pedido: 'Fatia B SIMULADA do arco medido.' }];
    autorizarPedido(p.dir, 'arco-me9', pedidoEmMinutos('arco-me9', 60, trabalhos));
    let medicoes = 0;
    const opcoes = (minutos: number | null): OpcoesDoPasso => ({ maquina: 'maquina-simulada',
      lerReservas: () => ({ leitura: 'copia-local', reservas: ['RM-901', 'RM-902'].map(item => ({ item, maquina: 'maquina-simulada', thread: null })) }),
      consultarSessoes: () => ({ sessoes: [], fontes: [{ origem: 'simulada', ok: true, detalhe: '' }], contas: [{ runtime: 'claude-bg', perfil: null }] }),
      perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }], despachar: despachoSimulado,
      abrirThread: (carregado, o) => novaThread(carregado, { ...o, criarWorktree: false }).thread,
      medir: (_r, _e, _q) => { medicoes += 1; return medicaoCom('arco-me9', minutos); } });
    const r1 = passoDoArco(p.carregado, 'arco-me9', opcoes(10));
    assert.equal(r1.acao, 'despachou', JSON.stringify(r1.acao === 'despachou' ? '' : r1));
    assert.equal(medicoes, 1, 'uma medição por passo');
    const r2 = passoDoArco(p.carregado, 'arco-me9', opcoes(60));
    assert.ok(r2.acao === 'recusado' && r2.motivo === 'noctum.orcamento.esgotado', JSON.stringify(r2.acao));
    const r3 = passoDoArco(p.carregado, 'arco-me9', opcoes(null));
    assert.ok(r3.acao === 'recusado' && r3.motivo === 'noctum.orcamento.sem-medicao', JSON.stringify(r3.acao));
  } finally { p.limpar(); }
});

test('ME10: as fontes do disco acham a transcrição do perfil e as dos subagentes, e o ledger e a worktree da thread', () => {
  const casa = dirTemporario('noctum-me10-claude');
  try {
    const perfil = { id: 'perfil-a', runtime: 'claude-bg' as const, configDir: casa };
    const cwd = '/repo/simulado/.claude/worktrees/ork-x';
    const pasta = path.join(casa, 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
    fs.mkdirSync(path.join(pasta, uuid(7), 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(pasta, `${uuid(7)}.jsonl`), uso('m1', 1, 0, 0, 1));
    fs.writeFileSync(path.join(pasta, uuid(7), 'subagents', 'agent-b.jsonl'), uso('m2', 1, 0, 0, 1));
    fs.writeFileSync(path.join(pasta, uuid(7), 'subagents', 'agent-a.jsonl'), uso('m3', 1, 0, 0, 1));
    const f = fontesDoDisco(casa);
    assert.deepEqual(f.transcricoes(perfil, cwd, uuid(7))!.map(a => path.basename(a)), [`${uuid(7)}.jsonl`, 'agent-a.jsonl', 'agent-b.jsonl']);
    assert.equal(f.transcricoes(perfil, cwd, uuid(8)), null, 'sem a principal, nada');
    assert.equal(f.transcricoes(perfil, cwd, 'nao-e-uuid'), null);
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

test('ME11: só mede quando algum teto não está em sessoes, e a reserva recebe o medido de cada teto na unidade dele', () => {
  const trabalhos = [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ork-simulada-t1' }];
  const soSessoes = validarPedidoDeAbertura(pedidoV2('arco-me11', { trabalhos }));
  assert.equal(precisaMedir(soSessoes), false);
  const misto = validarPedidoDeAbertura(pedidoEmMinutos('arco-me11', 120, trabalhos));
  assert.equal(precisaMedir(misto), true);
  const m = medicaoCom('arco-me11', 30);
  const medido = medidoParaReserva(m, misto, 'perfil-a', 'claude-bg');
  assert.deepEqual(medido.arco, { unidade: 'minutos-de-sessao', valor: 30 });
  assert.deepEqual(medido.conta, { unidade: 'sessoes', valor: 0 }, 'o escopo sem sessão mede zero; em sessoes a reserva usa a contagem da N2');
  assert.deepEqual(medidoParaReserva(medicaoCom('arco-me11', null), misto, 'perfil-a', 'claude-bg').arco,
    { unidade: 'minutos-de-sessao', lacuna: 'simulada' });
});

test('ME12: o texto do consumo diz valor, parcial, teto superior e lacuna, sem número inventado', () => {
  const c = (o: Partial<ReturnType<typeof consumoDoEscopoNaUnidade>>) => ({ unidade: 'minutos-de-sessao' as const, valor: 0, lacunas: [],
    parcial: false, tetoSuperior: false, sessoes: 1, ...o });
  assert.equal(textoDoConsumo(c({ valor: 31 })), '31 minutos-de-sessao');
  assert.equal(textoDoConsumo(c({ valor: 40, parcial: true })), '40 minutos-de-sessao até agora (sessão em voo)');
  assert.equal(textoDoConsumo(c({ valor: null, lacunas: ['reserva pendente'] })), 'lacuna (reserva pendente)');
  assert.equal(textoDoConsumo(c({ unidade: 'percentual-da-cota' as never, valor: 42.25, tetoSuperior: true })), 'até 42.3% (teto superior)');
});

/** O pedido v2 com o teto do arco na unidade dada (os subtetos seguem em sessões). */
function pedidoComTeto(arco: string, unidade: string, valor: number, trabalhos: Parameters<typeof pedidoV2>[1]['trabalhos']): Record<string, unknown> {
  const p = pedidoV2(arco, { trabalhos });
  return { ...p, orcamento: { ...(p.orcamento as Record<string, unknown>), arco: { valor, unidade } } };
}

test('ME13: teto em percentual da cota nunca admite o claude-bg, nem com o zero provado de um escopo sem sessão; o codex com zero provado passa', () => {
  // Achado do CHECK: o primeiro despacho do claude-bg passava com "consumo 0" e, dali em diante, tudo virava lacuna até o fim.
  const conteudo = validarPedidoDeAbertura(pedidoComTeto('arco-me13', 'percentual-da-cota', 50,
    [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ork-simulada' }]));
  const vazio = medirArco('/nao-usado', estado([]), { quando: T0, fontes: fontes({}) });
  assert.equal(consumoDoEscopoNaUnidade(vazio, 'arco', 'percentual-da-cota').valor, 0, 'sem sessão, o escopo mede zero provado');
  const claude = medidoParaReserva(vazio, conteudo, 'perfil-a', 'claude-bg');
  assert.ok(claude.arco && 'lacuna' in claude.arco && /só mostra a cota dentro da sessão/.test(claude.arco.lacuna), JSON.stringify(claude));
  const codex = medidoParaReserva(vazio, conteudo, 'perfil-a', 'codex');
  assert.deepEqual(codex.arco, { unidade: 'percentual-da-cota', valor: 0 });
});

test('ME14: instante que não é data vira lacuna, NaN nunca passa na reserva e o teto superior sai como teto superior na recusa', { skip: semKernel }, () => {
  const e = estado([{ threadDespachada: 'th-a', sessionId: uuid(1) }]);
  const m = medirArco('/nao-usado', e, { quando: T0, fontes: fontes({ eventos: { 'th-a': [ev('phase_dispatch', 'não é data', uuid(1))] } }) });
  assert.equal(m.doArco['minutos-de-sessao'].valor, null);
  assert.match(m.doArco['minutos-de-sessao'].lacunas.join(), /instante ilegível no ledger da thread th-a/);
  const raiz = dirTemporario('noctum-me14');
  fs.mkdirSync(path.join(raiz, '.orkastery'));
  try {
    const trabalhos = [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ork-simulada-t1' }];
    const shaMin = autorizarPedido(raiz, 'arco-me14', pedidoComTeto('arco-me14', 'minutos-de-sessao', 60, trabalhos));
    const shaCota = autorizarPedido(raiz, 'arco-me14b', pedidoComTeto('arco-me14b', 'percentual-da-cota', 50, trabalhos));
    const pedido = (arco: string, sha256: string, medido: PedidoDeDespacho['medido']): PedidoDeDespacho => ({ arco, envelopeSha256: sha256,
      trabalho: 't1', thread: 'ork-simulada-t1', fase: 'GO', runtime: 'claude-bg', conta: 'perfil-a', revisao: false, medido });
    const motivo = (fn: () => unknown): string => { try { fn(); } catch (x) { assert.ok(x instanceof RecusaDoArco); return `${x.motivo}|${x.message}`; } return 'passou'; };
    assert.match(motivo(() => reservarDespacho(raiz, pedido('arco-me14', shaMin, { arco: { unidade: 'minutos-de-sessao', valor: Number.NaN } }))),
      /^noctum\.orcamento\.sem-medicao\|/);
    assert.match(motivo(() => reservarDespacho(raiz, pedido('arco-me14b', shaCota,
      { arco: { unidade: 'percentual-da-cota', valor: 63.00000000000001, tetoSuperior: true } }))),
      /^noctum\.orcamento\.esgotado\|.*consumo medido é até 63% \(teto superior: inclui uso de fora do arco\)/);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('ME15: o ledger de cada thread é lido uma vez por medição, e as transcrições vêm uma de cada vez', () => {
  const e = estado([{ threadDespachada: 'th-a', sessionId: uuid(1) }, { threadDespachada: 'th-a', sessionId: uuid(2), trabalho: 't9' }]);
  let leituras = 0;
  const base = fontes({ eventos: { 'th-a': [ev('phase_dispatch', T0, uuid(1)), ev('phase_dispatch', T0, uuid(2))] } });
  medirArco('/nao-usado', e, { quando: depois(T0, 10 * MIN), fontes: { ...base, eventos: (t) => { leituras += 1; return base.eventos!(t); } } });
  assert.equal(leituras, 1, 'duas sessões da mesma thread, uma leitura do ledger');
  const lidos: string[] = [];
  const gerador = function* () { for (const t of [uso('m1', 1, 0, 0, 1), uso('m1', 1, 0, 0, 1), uso('m2', 2, 0, 0, 2)]) { lidos.push(t); yield Buffer.from(t); } };
  const t = tokensDasTranscricoes(gerador());
  assert.ok('valor' in t && t.valor === 6, JSON.stringify(t));
  assert.equal(lidos.length, 3);
});

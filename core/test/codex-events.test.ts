import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classificarMensagem, LIMITE_LINHA_CODEX, ParserCodex } from '../src/adapters/codex-events';

const line = (e: unknown) => JSON.stringify(e) + '\n';
const msg = (text: string) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
const done = { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } };
test('classificação terminal dá precedência a motivo explícito e pergunta humana', () => {
  for (const [texto, esperado] of [
    ['Concluído.', 'fase_concluida'], ['Qual é o diretório correto?', 'human.pending'],
    ['Você confirma a opção 1?', 'human.pending'], ['Aguardo sua confirmação.', 'human.pending'],
    ['Motivo: `lease.busy`', 'gate_blocked'], ['Motivo: nao.existe', 'gate_blocked'],
    ['Exemplo:\n> Você confirma?', 'fase_concluida'], ['Por que isso funciona?', 'fase_concluida'],
    ['Comando: `curl https://exemplo/?a=1`', 'fase_concluida'],
    ['```\nMotivo: lease.busy\n```\n\nConcluído.', 'fase_concluida'],
  ]) assert.equal(classificarMensagem(texto).classificacao, esperado, texto);
  const p = new ParserCodex();
  const [r] = p.push(line(msg('Qual é o diretório correto?')) + line(done));
  assert.equal(r.classificacao, 'human.pending'); assert.equal(r.tokens.input, 10); assert.equal(r.tokens.total, 12);
  const [b] = p.push(line({ ...done, motivo: 'policy.violation' }));
  assert.equal(b.motivo, 'policy.violation');
});

test('JSONL incremental preserva UTF-8 dividido e terminal só após newline', () => {
  const data = Buffer.from(line(msg('Você confirma?')) + line(done));
  for (let n = 1; n < data.length; n++) {
    const p = new ParserCodex();
    const out = [...p.push(data.subarray(0, n)), ...p.push(data.subarray(n))];
    assert.equal(out.length, 1); assert.equal(out[0].classificacao, 'human.pending');
  }
  const p = new ParserCodex(); assert.equal(p.push(JSON.stringify(done)).length, 0);
  assert.equal(p.push('\n').length, 1);
});

test('rollout usa última mensagem do turno correto e usage observado, sem presumir tokens', () => {
  const p = new ParserCodex();
  const ev = (payload: object) => line({ timestamp: '2026-09-01T00:00:00.000Z', type: 'event_msg', payload });
  p.push(ev({ type: 'task_started', turn_id: 'a' }) + ev({ type: 'agent_message', message: 'Você confirma?' }));
  p.push(ev({ type: 'task_started', turn_id: 'b' }));
  assert.equal(p.push(ev({ type: 'task_complete', turn_id: 'a' })).length, 0);
  const [r] = p.push(ev({ type: 'task_complete', turn_id: 'b' }));
  assert.equal(r.classificacao, 'fase_concluida'); assert.equal(r.tokens.disponivel, false); assert.equal(r.tokens.input, null);
  p.push(line({ type: 'token_usage_record', payload: { turn_id: 'b', turn_token_usage: { input_tokens: 30, cached_input_tokens: 12, output_tokens: 8 } } }));
  const [u] = p.push(ev({ type: 'task_complete', turn_id: 'b', last_agent_message: 'Motivo: lease.busy', duration_ms: 120 }));
  assert.equal(u.motivo, 'lease.busy'); assert.equal(u.tokens.input, 30); assert.equal(u.duracaoMs, 120);
  p.push(ev({ type: 'token_count', info: { total_token_usage: { input_tokens: 50, output_tokens: 9 } } }));
  assert.equal(p.estado.tokens.escopo, 'sessao'); assert.equal(p.estado.tokens.cachedInput, null);
  p.push(line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Você confirma?' }] } }));
  assert.equal(p.push(ev({ type: 'task_complete', turn_id: 'b' }))[0].classificacao, 'human.pending');
});

test('falha, timestamp inválido, motivo inválido e linha excessiva nunca inventam sucesso', () => {
  for (const data of [line({ type: 'turn.failed' }), line({ ...done, motivo: 'inventado' }),
    '{quebrado\n' + line(done), 'x'.repeat(LIMITE_LINHA_CODEX + 1) + '\n' + line(done)]) {
    const p = new ParserCodex(); const out = p.push(data); assert.equal(out.at(-1)?.classificacao, 'gate_blocked');
  }
  const p = new ParserCodex();
  assert.equal(p.push(line({ ...done, timestamp: 'amanhã' })).length, 0);
  assert.equal(p.push(line(done))[0].classificacao, 'gate_blocked');
  const q = new ParserCodex(); q.push(line({ type: 'unknown', data: 'Você confirma?' }));
  assert.equal(q.push(line(done))[0].classificacao, 'fase_concluida');
});

test('proveniência do id de turno é estrutural: prefixo de texto nunca prova origem', () => {
  const ev = (payload: object) => line({ timestamp: '2026-09-01T00:00:00.000Z', type: 'event_msg', payload });
  // Id presente na fonte: origem explícita, mesmo com o texto que o parser usaria ao sintetizar.
  for (const explicito of ['turn-1', 'stream-999', 'stream-1']) {
    const p = new ParserCodex();
    p.push(ev({ type: 'task_started', turn_id: explicito }));
    assert.equal(p.estado.turnIdOrigem, 'explicito', explicito);
    const [r] = p.push(ev({ type: 'task_complete', turn_id: explicito }));
    assert.equal(r.turnId, explicito);
    assert.equal(r.turnIdOrigem, 'explicito', explicito);
  }
  // Id ausente: valor sintetizado nunca é apresentado como explícito.
  const g = new ParserCodex();
  g.push(ev({ type: 'task_started' }));
  assert.equal(g.estado.turnId, 'stream-1');
  assert.equal(g.estado.turnIdOrigem, 'gerado');
  const [gerado] = g.push(ev({ type: 'task_complete' }));
  assert.equal(gerado.turnId, 'stream-1');
  assert.equal(gerado.turnIdOrigem, 'gerado');
  // Dois terminais com o mesmo texto de id e origens opostas: o texto não separa os casos.
  const e1 = new ParserCodex(); e1.push(ev({ type: 'task_started', turn_id: 'stream-1' }));
  const iguais = [e1.push(ev({ type: 'task_complete', turn_id: 'stream-1' }))[0], gerado];
  assert.equal(iguais[0].turnId, iguais[1].turnId);
  assert.notEqual(iguais[0].turnIdOrigem, iguais[1].turnIdOrigem);
  // Sem turno aberto não há id nem origem inventada.
  const s = new ParserCodex();
  const [sem] = s.push(line({ ...done, turn_id: 'turn-7' }));
  assert.equal(sem.turnId, null);
  assert.equal(sem.turnIdOrigem, null);
  // Cursor antigo sem o campo não vira explícito por omissão.
  const antigo = new ParserCodex({ turnId: 'turn-1', mensagem: null, invalido: false, turnos: 1,
    tokens: new ParserCodex().estado.tokens } as any);
  assert.equal(antigo.estado.turnIdOrigem, null);
  console.log(JSON.stringify({ explicitos: 3, gerados: 1, semTurno: 1, cursorAntigo: null }));
});

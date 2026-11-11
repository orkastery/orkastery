import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mapearEventoDoLedger, montarExportLogsServiceRequest, OtlpKeyValue } from '../src/telemetria';
import { redigirSegredos } from '../src/policies';
import { redigirDadoPrivado, ListaLocal } from '../src/dado-privado';
import type { EventoLedger } from '../src/types';

const lista: ListaLocal = { presente: true, procurada: [], lidos: [], termos: ['nome-reservado'], ignorados: 0,
  versionados: [], recusada: null };
const redator = (entrada: string) => {
  const segredo = redigirSegredos(entrada);
  const privado = redigirDadoPrivado(segredo.texto, lista);
  return privado.ok ? { ok: true, texto: privado.texto } : { ok: false, erro: privado.erro };
};
const contexto = { serviceVersion: '0.6.8', instrumentacaoVersion: '1.0.0', pseudonimo: 'anonimo-estavel',
  redigir: redator, observadoEmNano: () => 1_800_000_000_000_000_123n };
const evento = (tipo: string, dados: Record<string, unknown> = {}): EventoLedger => ({
  ts: '2026-11-10T12:34:56.789Z', thread: 'ork-exemplo', tipo, eventId: `id-${tipo}`, ...dados,
});
const attrs = (registro: { attributes: OtlpKeyValue[] }) => Object.fromEntries(registro.attributes.map((a) => [a.key, a.value]));

test('OTLP usa AnyValue tipado, nanossegundos textuais, resource e scope', () => {
  const r = mapearEventoDoLedger(evento('thread_created', { branch: 'ork/x', sha: 'abc' }), contexto, { sequencia: 7 }).registro!;
  assert.equal(r.timeUnixNano, '1794314096789000000');
  assert.equal(r.observedTimeUnixNano, '1800000000000000123');
  assert.deepEqual([r.severityNumber, r.severityText], [9, 'INFO']);
  assert.deepEqual(attrs(r)['orkastery.ledger.sequence'], { intValue: '7' });
  const payload = montarExportLogsServiceRequest([r], contexto);
  assert.deepEqual(payload.resourceLogs[0].resource.attributes, [
    { key: 'service.name', value: { stringValue: 'orkastery' } },
    { key: 'service.version', value: { stringValue: '0.6.8' } },
  ]);
  assert.equal(payload.resourceLogs[0].scopeLogs[0].scope.name, 'orkastery.telemetria');
});

test('severidade separa INFO, WARN e ERROR nos números OTLP', () => {
  const info = mapearEventoDoLedger(evento('phase_result', { resultado: 'ok' }), contexto).registro!;
  const warn = mapearEventoDoLedger(evento('gate_blocked', { motivo: 'human.pending' }), contexto).registro!;
  const erro = mapearEventoDoLedger(evento('phase_result', { classificacao: 'failed' }), contexto).registro!;
  assert.deepEqual([info.severityNumber, warn.severityNumber, erro.severityNumber], [9, 13, 17]);
  assert.deepEqual([info.severityText, warn.severityText, erro.severityText], ['INFO', 'WARN', 'ERROR']);
});

test('verify e CHECK usam cicd oficial sem duplicar roundId', () => {
  const verify = mapearEventoDoLedger(evento('verify_run', { fase: 'CHECK', roundId: 'rodada-1', resultado: 'passou',
    checkMode: 'agile' }), contexto).registro!;
  const a = attrs(verify);
  assert.deepEqual(a['cicd.pipeline.run.id'], { stringValue: 'rodada-1' });
  assert.deepEqual(a['orkastery.check.mode'], { stringValue: 'agile' });
  assert.equal('orkastery.verify.round_id' in a, false);
  const check = mapearEventoDoLedger(evento('phase_result', { fase: 'CHECK', classificacao: 'fase_concluida' }), contexto).registro!;
  assert.deepEqual(attrs(check)['cicd.pipeline.name'], { stringValue: 'orkastery.check' });
});

test('despacho GenAI, encerramento e revisão usam somente convenções aplicáveis', () => {
  const dispatch = mapearEventoDoLedger(evento('phase_dispatch', { runtime: 'codex', model: 'gpt-exemplo',
    sessionId: 'sessao-1', conversationId: 'conversa-1' }), contexto).registro!;
  assert.deepEqual(attrs(dispatch)['gen_ai.operation.name'], { stringValue: 'invoke_agent' });
  assert.deepEqual(attrs(dispatch)['orkastery.runtime.name'], { stringValue: 'codex' });
  const commit = mapearEventoDoLedger(evento('mcp_git_committed', { sha: 'abc', branch: 'ork/x' }), contexto).registro!;
  assert.deepEqual(attrs(commit)['vcs.ref.head.revision'], { stringValue: 'abc' });
  for (const tipo of ['master_done', 'thread_closed_admin']) {
    assert.match(mapearEventoDoLedger(evento(tipo), contexto).registro!.eventName, new RegExp(tipo));
  }
});

test('identidade usa log.record.uid e user.hash; nomes duplicados não existem', () => {
  const r = mapearEventoDoLedger(evento('autonomous_decision', { decisao: 'seguir o plano', pedido: { id: 'd-1' } }), contexto).registro!;
  const a = attrs(r);
  assert.deepEqual(a['log.record.uid'], { stringValue: 'id-autonomous_decision' });
  assert.deepEqual(a['user.hash'], { stringValue: 'anonimo-estavel' });
  assert.equal('orkastery.event.id' in a, false);
  assert.equal('orkastery.maestro.id' in a, false);
});

test('texto livre passa por segredo e dado privado sem revelar o original', () => {
  const segredo = 'sk-' + 'A'.repeat(32);
  const r = mapearEventoDoLedger(evento('autonomous_decision', { decisao: `usar ${segredo} com nome-reservado` }), contexto).registro!;
  const saida = JSON.stringify(r);
  assert.equal(saida.includes(segredo), false);
  assert.equal(saida.includes('nome-reservado'), false);
  assert.match((r.body as { stringValue: string }).stringValue, /\[segredo omitido\].*\[omitido\]/);
});

test('prompt só leva tamanho preexistente e nunca caminho, hash ou texto', () => {
  const r = mapearEventoDoLedger(evento('phase_prompt_recorded', { fase: 'GO', runtime: 'codex', promptBytes: 321,
    promptPath: '/home/pessoa/segredo.md', promptSha256: 'nao-exportar', prompt: 'conteudo' }), contexto).registro!;
  const saida = JSON.stringify(r);
  assert.deepEqual(attrs(r)['orkastery.prompt.size'], { intValue: '321' });
  assert.equal(saida.includes('segredo.md'), false);
  assert.equal(saida.includes('nao-exportar'), false);
  assert.equal(saida.includes('conteudo'), false);
});

test('heartbeat e corrupção não viram LogRecord; legado aceita UID derivado injetado', () => {
  assert.equal(mapearEventoDoLedger(evento('heartbeat'), contexto).registro, null);
  assert.equal(mapearEventoDoLedger(evento('ledger_corrupted'), contexto).registro, null);
  const legado = { ts: '2026-11-10T12:34:56.789Z', thread: 'ork-exemplo', tipo: 'thread_created' } as EventoLedger;
  assert.deepEqual(attrs(mapearEventoDoLedger(legado, contexto, { uid: 'uid-derivado' }).registro!)['log.record.uid'],
    { stringValue: 'uid-derivado' });
});

test('falha da lista privada recusa o LogRecord inteiro', () => {
  const recusada = { ...lista, recusada: 'arquivo inseguro' };
  const ctx = { ...contexto, redigir: (entrada: string) => {
    const r = redigirDadoPrivado(entrada, recusada);
    return r.ok ? { ok: true, texto: r.texto } : { ok: false, erro: r.erro };
  } };
  assert.throws(() => mapearEventoDoLedger(evento('autonomous_decision', { decisao: 'texto' }), ctx), /privacidade/);
});

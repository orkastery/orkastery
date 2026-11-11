import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { arquivosDoNode, ArquivosTelemetria, exportarLedger, lerLoteIncremental, resolverDestinoOtlp,
  analisarHeadersOtlp, MAXIMO_DA_REQUISICAO, MAXIMO_DA_RESPOSTA, sanitizarEndpoint,
  transporteHttp } from '../src/telemetria-exportador';
import { prepararPrompt } from '../src/telemetria-prompt';

const dirs = new Set<string>();
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(linhas: string[]) {
  const dir = dirTemporario('telemetria-exportador'); dirs.add(dir);
  const ledger = path.join(dir, 'ledger.jsonl'), cursor = path.join(dir, 'cursor.json'), lock = path.join(dir, 'lock');
  fs.writeFileSync(ledger, linhas.join('\n') + '\n');
  const contagem = { ler: 0, lerJson: 0, escrever: 0, lock: 0 };
  const arquivos: ArquivosTelemetria = { ...arquivosDoNode,
    ler(...args) { contagem.ler += 1; return arquivosDoNode.ler(...args); },
    lerJson(...args) { contagem.lerJson += 1; return arquivosDoNode.lerJson(...args); },
    escreverJsonAtomico(...args) { contagem.escrever += 1; return arquivosDoNode.escreverJsonAtomico(...args); },
    adquirirLock(...args) { contagem.lock += 1; return arquivosDoNode.adquirirLock(...args); },
  };
  return { dir, ledger, cursor, lock, arquivos, contagem };
}
const ctx = { serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: 'anonimo',
  redigir: (texto: string) => ({ ok: true, texto }), observadoEmNano: () => 99n };
const linha = (tipo: string, id?: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  ts: '2026-11-10T12:00:00.000Z', thread: 'ork-teste', tipo, ...(id ? { eventId: id } : {}), ...extra,
});
const env = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test/base', OTEL_EXPORTER_OTLP_HEADERS: 'x-token=abc%20123' };

test('endpoint específico vence; base preserva path e headers de logs vencem', () => {
  assert.equal(resolverDestinoOtlp(env).endpoint, 'http://collector.test/base/v1/logs');
  const d = resolverDestinoOtlp({ ...env, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://logs.test/custom',
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'authorization=Bearer%20teste' });
  assert.equal(d.endpoint, 'https://logs.test/custom');
  assert.deepEqual(d.headers, { authorization: 'Bearer teste' });
  assert.equal(sanitizarEndpoint('https://user:pass@logs.test/a?q=segredo#x'), 'https://logs.test/a');
});

test('header inválido é recusado sem ecoar o valor', () => {
  const segredo = 'valor-que-nao-sai';
  assert.throws(() => analisarHeadersOtlp(`authorization=${segredo}\nquebra`), (e: Error) => {
    assert.equal(e.message.includes(segredo), false); return /formato inválido/.test(e.message);
  });
});

test('leitura incremental deriva UID estável e bloqueia antes da linha corrompida', () => {
  const f = fixture([linha('thread_created'), '{quebrado', linha('phase_dispatch', 'depois')]);
  const id = f.arquivos.identidade(f.ledger);
  const cursor = { contrato: 'ork.telemetria-cursor/v1' as const, ledger: { dev: id.dev, ino: id.ino },
    proximoOffset: 0, proximaSequencia: 1, ultimoUidConfirmado: null, terminal: null };
  const a = lerLoteIncremental({ arquivo: f.ledger, thread: 'ork-teste', cursor, contexto: ctx, arquivos: f.arquivos });
  const b = lerLoteIncremental({ arquivo: f.ledger, thread: 'ork-teste', cursor, contexto: ctx, arquivos: f.arquivos });
  assert.equal(a.registros.length, 1);
  assert.equal(a.uids[0], b.uids[0]);
  assert.deepEqual(a.bloqueio?.motivo, 'corrompida');
  assert.equal(JSON.stringify(a).includes('quebrado'), false);
});

test('sucesso avança cursor; queda depois do POST reenvia os mesmos UIDs', async () => {
  const f = fixture([linha('thread_created', 'e1'), linha('phase_dispatch', 'e2')]);
  const vistos: string[][] = [];
  const transporte = async (p: { body: string }) => { vistos.push(JSON.parse(p.body).resourceLogs[0].scopeLogs[0]
    .logRecords.map((r: { attributes: Array<{ key: string; value: { stringValue?: string } }> }) =>
      r.attributes.find(a => a.key === 'log.record.uid')?.value.stringValue)); return { status: 200, body: '' }; };
  await assert.rejects(exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, env, transporte, depoisDoEnvio: () => { throw new Error('queda'); } }), /queda/);
  assert.equal(fs.existsSync(f.cursor), false);
  const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, env, transporte });
  assert.equal(r.estado, 'enviado');
  assert.deepEqual(vistos[0], vistos[1]);
  const cursor = JSON.parse(fs.readFileSync(f.cursor, 'utf8'));
  assert.equal(cursor.ultimoUidConfirmado, 'e2');
});

test('partialSuccess é terminal, não repete e redige mensagem externa', async () => {
  const f = fixture([linha('thread_created', 'e1')]); let chamadas = 0;
  const segredo = 'sk-' + 'A'.repeat(32);
  const contexto = { ...ctx, redigir: (texto: string) => ({ ok: true, texto: texto.replace(segredo, '[omitido]') }) };
  const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto, arquivos: f.arquivos, env, transporte: async () => {
      chamadas += 1; return { status: 200, body: JSON.stringify({ partialSuccess: { rejectedLogRecords: '1',
        errorMessage: `${'x'.repeat(500)}${segredo}` } }) };
    } });
  assert.equal(chamadas, 1);
  assert.equal(r.estado, 'rejeitado');
  assert.equal(r.rejeicao?.tipo, 'parcial');
  assert.equal(JSON.stringify(r).includes(segredo), false);
  const deNovo = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, env, transporte: async () => { chamadas += 1; return { status: 200, body: '' }; } });
  assert.equal(deNovo.estado, 'rejeitado');
  assert.equal(chamadas, 1);
});

test('partialSuccess recusa rejectedLogRecords fora de int64 decimal sem persistir entrada externa', async () => {
  for (const rejeitados of ['authorization=Bearer segredo', '9223372036854775808', 1]) {
    const f = fixture([linha('thread_created', 'e1')]);
    const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
      thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, env, transporte: async () => ({ status: 200,
        body: JSON.stringify({ partialSuccess: { rejectedLogRecords: rejeitados, errorMessage: 'externo' } }) }) });
    assert.equal(r.estado, 'rejeitado');
    assert.equal(r.rejeicao?.tipo, 'protocolo');
    assert.equal(r.rejeicao?.rejectedLogRecords, undefined);
    const persistido = JSON.parse(fs.readFileSync(f.cursor, 'utf8'));
    assert.equal(persistido.terminal.rejectedLogRecords, undefined);
    if (typeof rejeitados === 'string') assert.equal(JSON.stringify(r).includes(rejeitados), false);
    assert.equal(JSON.stringify(persistido).includes('externo'), false);
  }
});

test('400 não repete; respostas retentáveis e falha de conexão repetem uma vez e preservam pendência', async () => {
  const a = fixture([linha('thread_created', 'a')]); let chamadas400 = 0;
  const r400 = await exportarLedger({ arquivoLedger: a.ledger, arquivoCursor: a.cursor, arquivoLock: a.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: a.arquivos, env, transporte: async () => { chamadas400 += 1; return { status: 400, body: 'segredo externo' }; } });
  assert.equal(r400.estado, 'rejeitado'); assert.equal(chamadas400, 1);
  assert.equal(JSON.stringify(r400).includes('segredo externo'), false);

  for (const status of [429, 502, 503, 504]) {
    const b = fixture([linha('thread_created', `b-${status}`)]); let chamadas = 0;
    const resposta = await exportarLedger({ arquivoLedger: b.ledger, arquivoCursor: b.cursor, arquivoLock: b.lock,
      thread: 'ork-teste', contexto: ctx, arquivos: b.arquivos, env, dormir: async () => {}, transporte: async () => {
        chamadas += 1; return { status, body: '', headers: { 'retry-after': '1' } };
      } });
    assert.equal(resposta.estado, 'pendente'); assert.equal(chamadas, 2); assert.equal(fs.existsSync(b.cursor), false);
  }

  const c = fixture([linha('thread_created', 'c')]); let conexoes = 0;
  const rc = await exportarLedger({ arquivoLedger: c.ledger, arquivoCursor: c.cursor, arquivoLock: c.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: c.arquivos, env, transporte: async () => { conexoes += 1; throw new Error('fora'); } });
  assert.equal(rc.estado, 'pendente'); assert.equal(conexoes, 2);
});

test('retry compartilha o orçamento total e usa Retry-After ou backoff com jitter sem espera real', async () => {
  const a = fixture([linha('thread_created', 'a')]);
  let agora = 0; const esperasA: number[] = [], prazosA: number[] = [];
  const rA = await exportarLedger({ arquivoLedger: a.ledger, arquivoCursor: a.cursor, arquivoLock: a.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: a.arquivos,
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test', OTEL_EXPORTER_OTLP_TIMEOUT: '100' },
    agoraMs: () => agora, dormir: async (ms) => { esperasA.push(ms); agora += ms; },
    transporte: async (pedido) => { prazosA.push(pedido.timeoutMs); return { status: 429, body: '', headers: { 'retry-after': '0.04' } }; } });
  assert.equal(rA.estado, 'pendente');
  assert.deepEqual(prazosA, [100, 60]);
  assert.deepEqual(esperasA, [40]);

  const b = fixture([linha('thread_created', 'b')]);
  agora = 0; const esperasB: number[] = [], prazosB: number[] = [];
  await exportarLedger({ arquivoLedger: b.ledger, arquivoCursor: b.cursor, arquivoLock: b.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: b.arquivos,
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test', OTEL_EXPORTER_OTLP_TIMEOUT: '1000' },
    agoraMs: () => agora, aleatorio: () => 0.5, dormir: async (ms) => { esperasB.push(ms); agora += ms; },
    transporte: async (pedido) => { prazosB.push(pedido.timeoutMs); throw new Error('fora'); } });
  assert.deepEqual(prazosB, [1000, 900]);
  assert.deepEqual(esperasB, [100]);

  const c = fixture([linha('thread_created', 'c')]); let chamadasC = 0;
  await exportarLedger({ arquivoLedger: c.ledger, arquivoCursor: c.cursor, arquivoLock: c.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: c.arquivos,
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test', OTEL_EXPORTER_OTLP_TIMEOUT: '100' },
    agoraMs: () => 0, dormir: async () => { throw new Error('não cabe no orçamento'); },
    transporte: async () => { chamadasC += 1; return { status: 503, body: '', headers: { 'retry-after': '1' } }; } });
  assert.equal(chamadasC, 1);
});

test('dry-run ignora cursor, começa no zero ou no offset informado e não usa transporte nem lock', async () => {
  const f = fixture([linha('thread_created', 'e1'), linha('phase_dispatch', 'e2')]); let chamadas = 0;
  fs.writeFileSync(f.cursor, JSON.stringify({ segredo: 'cursor que não pode ser lido' }));
  const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, dryRun: true,
    env: { OTEL_EXPORTER_OTLP_HEADERS: 'invalido-e-segredo' }, transporte: async () => { chamadas += 1; return { status: 200, body: '' }; } });
  assert.equal(r.estado, 'dry-run'); assert.equal(chamadas, 0);
  assert.deepEqual(r.uids, ['e1', 'e2']);
  const offset = Buffer.byteLength(linha('thread_created', 'e1') + '\n');
  const doOffset = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, dryRun: true, dryRunOffset: offset });
  assert.deepEqual(doOffset.uids, ['e2']);
  assert.deepEqual({ lerJson: f.contagem.lerJson, escrever: f.contagem.escrever, lock: f.contagem.lock },
    { lerJson: 0, escrever: 0, lock: 0 });
});

test('lacuna confirmada avança e permite exportar o evento válido seguinte', async () => {
  const f = fixture([
    linha('phase_prompt_recorded', 'lacuna', { promptPath: 'ausente.md', promptSha256: '0'.repeat(64) }),
    linha('phase_dispatch', 'depois', { runtime: 'codex' }),
  ]);
  const contexto = { ...ctx, prepararPrompt: () => ({ estado: 'lacuna' as const, motivo: 'file_missing' as const }) };
  let chamadas = 0;
  const pendente = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto, arquivos: f.arquivos, env, dormir: async () => {}, transporte: async () => {
      chamadas += 1; return { status: 503, body: '' };
    } });
  assert.equal(pendente.estado, 'pendente');
  assert.equal(chamadas, 2);
  assert.equal(fs.existsSync(f.cursor), false, 'a lacuna não avança sem confirmação');

  let nomes: string[] = [];
  const enviado = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto, arquivos: f.arquivos, env, transporte: async (pedido) => {
      nomes = JSON.parse(pedido.body).resourceLogs[0].scopeLogs[0].logRecords.map((r: { eventName: string }) => r.eventName);
      return { status: 200, body: '' };
    } });
  assert.equal(enviado.estado, 'enviado');
  assert.deepEqual(nomes, ['gen_ai.client.inference.operation.details', 'orkastery.ledger.phase_dispatch']);
  const cursor = JSON.parse(fs.readFileSync(f.cursor, 'utf8'));
  assert.equal(cursor.ultimoUidConfirmado, 'depois');
});

test('falha transitória ou da remoção bloqueia antes do evento e não chama transporte', async () => {
  for (const motivo of ['prompt_io_transient', 'prompt_redaction_failed'] as const) {
    const f = fixture([linha('phase_prompt_recorded', motivo)]);
    let transportes = 0;
    const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
      thread: 'ork-teste', contexto: { ...ctx, prepararPrompt: () => ({ estado: 'bloqueio' as const, motivo }) },
      arquivos: f.arquivos, env, transporte: async () => { transportes += 1; return { status: 200, body: '' }; } });
    assert.equal(r.estado, 'bloqueado');
    assert.equal(r.bloqueio?.motivo, motivo);
    assert.equal(transportes, 0);
    assert.equal(fs.existsSync(f.cursor), false);
  }
});

test('corta depois da remoção em ponto de código, limita o pedido e não relê nem reprocessa o prompt', async () => {
  const f = fixture([]);
  const raizPrompts = path.join(f.dir, 'prompts');
  fs.mkdirSync(raizPrompts);
  const segredo = 'sk-' + 'Z'.repeat(32);
  const texto = 'a'.repeat(900_000) + segredo + '🔐'.repeat(100_000);
  const arquivo = path.join(raizPrompts, 'go.md');
  fs.writeFileSync(arquivo, texto);
  const sha = createHash('sha256').update(texto).digest('hex');
  fs.writeFileSync(f.ledger, [linha('thread_created', 'antes'), linha('phase_prompt_recorded', 'prompt', {
    promptPath: path.relative(f.dir, arquivo), promptSha256: sha, model: 'gpt-exemplo' }),
  linha('phase_dispatch', 'depois')].join('\n') + '\n');
  let preparacoes = 0, serializacoes = 0, corpo = '';
  const contexto = { ...ctx, prepararPrompt: (evento: Record<string, unknown>) => {
    preparacoes += 1;
    return prepararPrompt({ raizProjeto: f.dir, raizPrompts, promptPath: evento.promptPath,
      promptSha256: evento.promptSha256, redigirPrivado: (entrada) => ({ ok: true, texto: entrada }) });
  } };
  const serializarPayload = (payload: unknown) => { serializacoes += 1; return JSON.stringify(payload); };
  const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto, arquivos: f.arquivos, env, serializarPayload, transporte: async (pedido) => {
      corpo = pedido.body; return { status: 200, body: '' };
    } });
  assert.equal(r.estado, 'enviado');
  assert.equal(preparacoes, 1);
  assert.ok(serializacoes <= Math.ceil(Math.log2(texto.length + 1)) + 5, String(serializacoes));
  assert.ok(Buffer.byteLength(corpo) <= MAXIMO_DA_REQUISICAO);
  assert.equal(corpo.includes(segredo), false);
  assert.equal(corpo.includes('[segredo omitido]'), true);
  const registros = JSON.parse(corpo).resourceLogs[0].scopeLogs[0].logRecords as Array<{
    eventName: string; attributes: Array<{ key: string; value: { boolValue?: boolean; intValue?: string;
      arrayValue?: { values: Array<{ kvlistValue: { values: Array<{ key: string; value: unknown }> } }> } } }> }>;
  const prompt = registros.find((registro) => registro.eventName === 'gen_ai.client.inference.operation.details')!;
  const mapa = Object.fromEntries(prompt.attributes.map((item) => [item.key, item.value]));
  assert.deepEqual(mapa['orkastery.prompt.truncated'], { boolValue: true });
  assert.ok(Number((mapa['orkastery.prompt.size.exported'] as { intValue: string }).intValue) < Buffer.byteLength(texto));
  assert.equal(corpo.includes('�'), false);

  let segundo = '';
  const proximo = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto, arquivos: f.arquivos, env, transporte: async (pedido) => {
      segundo = pedido.body; return { status: 200, body: '' };
    } });
  assert.equal(proximo.estado, 'enviado');
  assert.equal(segundo.includes('orkastery.ledger.phase_dispatch'), true, 'registro vizinho fica para o lote seguinte');
});

test('transporte limita o stream durante a leitura e fixa application/json contra override configurado', async () => {
  const fetchOriginal = global.fetch;
  let textChamado = false, headersObservados: HeadersInit | undefined;
  try {
    const resposta = new Response(Buffer.alloc(MAXIMO_DA_RESPOSTA + 4096, 0x78), { status: 200 });
    resposta.text = async () => { textChamado = true; return 'não deve materializar'; };
    global.fetch = (async (_url, init) => { headersObservados = init?.headers; return resposta; }) as typeof fetch;
    const r = await transporteHttp({ endpoint: 'https://collector.test/v1/logs',
      headers: { 'Content-Type': 'text/plain' }, body: '{}', timeoutMs: 1000 });
    assert.equal(textChamado, false);
    assert.equal(Buffer.byteLength(r.body), MAXIMO_DA_RESPOSTA + 1);
    assert.equal(new Headers(headersObservados).get('content-type'), 'application/json');
  } finally { global.fetch = fetchOriginal; }
});

test('lock concorrente sai ocupado sem transporte ou cursor', async () => {
  const f = fixture([linha('thread_created', 'e1')]);
  fs.writeFileSync(f.lock, JSON.stringify({ pid: process.pid, token: 'outro', expiraEm: Date.now() + 60_000 }));
  let chamadas = 0;
  const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, env, transporte: async () => { chamadas += 1; return { status: 200, body: '' }; } });
  assert.equal(r.estado, 'ocupado'); assert.equal(chamadas, 0); assert.equal(fs.existsSync(f.cursor), false);
  assert.equal(f.contagem.ler, 0, 'execução concorrente não abre o ledger');
});

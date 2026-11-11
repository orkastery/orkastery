import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { arquivosDoNode, ArquivosTelemetria, exportarLedger, lerLoteIncremental, resolverDestinoOtlp,
  analisarHeadersOtlp, sanitizarEndpoint } from '../src/telemetria-exportador';

const dirs = new Set<string>();
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(linhas: string[]) {
  const dir = dirTemporario('telemetria-exportador'); dirs.add(dir);
  const ledger = path.join(dir, 'ledger.jsonl'), cursor = path.join(dir, 'cursor.json'), lock = path.join(dir, 'lock');
  fs.writeFileSync(ledger, linhas.join('\n') + '\n');
  const contagem = { ler: 0, escrever: 0, lock: 0 };
  const arquivos: ArquivosTelemetria = { ...arquivosDoNode,
    ler(...args) { contagem.ler += 1; return arquivosDoNode.ler(...args); },
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
      chamadas += 1; return { status: 200, body: JSON.stringify({ partialSuccess: { rejectedLogRecords: '1', errorMessage: `recusado ${segredo}` } }) };
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

test('dry-run não resolve headers, não chama transporte, não grava cursor nem lock', async () => {
  const f = fixture([linha('thread_created', 'e1')]); let chamadas = 0;
  const r = await exportarLedger({ arquivoLedger: f.ledger, arquivoCursor: f.cursor, arquivoLock: f.lock,
    thread: 'ork-teste', contexto: ctx, arquivos: f.arquivos, dryRun: true,
    env: { OTEL_EXPORTER_OTLP_HEADERS: 'invalido-e-segredo' }, transporte: async () => { chamadas += 1; return { status: 200, body: '' }; } });
  assert.equal(r.estado, 'dry-run'); assert.equal(chamadas, 0);
  assert.deepEqual({ escrever: f.contagem.escrever, lock: f.contagem.lock }, { escrever: 0, lock: 0 });
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

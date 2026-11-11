import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as http from 'node:http';
import { transporteHttp } from '../src/telemetria-exportador';

test('receptor HTTP local recebe OTLP JSON em /v1/logs', async () => {
  let recebido = '', rota = '', contentType = '';
  const servidor = http.createServer((req, res) => {
    rota = req.url ?? ''; contentType = String(req.headers['content-type'] ?? '');
    req.setEncoding('utf8'); req.on('data', (c) => { recebido += c; });
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  try {
    const endereco = servidor.address(); assert.ok(endereco && typeof endereco === 'object');
    const resposta = await transporteHttp({ endpoint: `http://127.0.0.1:${endereco.port}/v1/logs`, headers: {},
      body: JSON.stringify({ resourceLogs: [] }), timeoutMs: 2_000 });
    assert.equal(resposta.status, 200); assert.equal(rota, '/v1/logs');
    assert.equal(contentType, 'application/json'); assert.deepEqual(JSON.parse(recebido), { resourceLogs: [] });
  } finally { await new Promise<void>((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve())); }
});

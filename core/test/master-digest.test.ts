import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { proporMaster } from '../src/master';
import { enviarDigest, lerDigest, montarDigest, sextaLocal, responderLoteDigest, dirDigest } from '../src/master-digest';
import { enviarPayloadHost } from '../src/pulse-delivery';

test('quatro sextas controladas têm recibos, nove classes, idempotência, retry e lock', () => {
  const p = projetoTemporario('digest-sextas');
  try {
    const t = novaThread(p.carregado, { nome: 'digest', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', {});
    proporMaster(p.dir, t.id, { score: 4, justificativa: 'proposta testada', por: 'Codex' });
    // I-35: a fronteira da sexta depende do fuso do dono, nunca do TZ do processo.
    assert.equal(sextaLocal('2026-09-11T01:00:00Z', 'America/Sao_Paulo'), null);
    assert.equal(sextaLocal('2026-09-12T01:00:00Z', 'America/Sao_Paulo'), '2026-09-11');
    const data = '2026-09-11T12:00:00Z';
    const pages = montarDigest(p.dir, data).paginas;
    assert.equal(pages[1].opcoes.length, 9);
    assert.ok(pages.every(p => p.texto.length <= 3900 && p.opcoes.every(o => o.length <= 200)));
    assert.equal(enviarDigest({ raiz: p.dir, quando: '2026-09-10T12:00:00Z' }).enviadas, 0);
    assert.equal(fs.existsSync(dirDigest(p.dir)), false);
    let tentativas = 0;
    const enviar = () => {
      tentativas++;
      assert.equal(enviarDigest({ raiz: p.dir, quando: data }).code, 1, 'concorrente não envia');
      if (tentativas === 2) throw new Error('host indisponível');
      return { success: true as const, message_id: tentativas, platform: 'telegram' };
    };
    assert.equal(enviarDigest({ raiz: p.dir, quando: data, enviar }).code, 1);
    assert.equal(lerDigest(p.dir, '2026-09-11').recibos.length, 1);
    assert.equal(lerDigest(p.dir, '2026-09-11').concluidoEm, null);
    assert.equal(enviarDigest({ raiz: p.dir, quando: data, enviar }).enviadas, 1);
    assert.equal(enviarDigest({ raiz: p.dir, quando: data, enviar }).enviadas, 0);
    for (const dia of ['18', '25', '02']) {
      const semana = dia === '02' ? '2026-10-02' : `2026-09-${dia}`;
      assert.equal(enviarDigest({ raiz: p.dir, quando: `${semana}T12:00:00Z`, enviar: () => ({ success: true, message_id: ++tentativas, platform: 'telegram' }) }).code, 0);
      assert.equal(lerDigest(p.dir, semana).recibos.length, 2);
    }
    const job = lerDigest(p.dir, '2026-10-02');
    assert.throws(() => responderLoteDigest(p.dir, job.paginas[0].opcoes[0], 'Codex'), /humano/);
    assert.equal(responderLoteDigest(p.dir, job.paginas[0].opcoes[0], 'julio').length, 1);
  } finally { p.limpar(); }
});

test('transporte exige JSON confirmado além do exit code e envia o payload por stdin', () => {
  const p = projetoTemporario('digest-host');
  try {
    assert.throws(() => enviarPayloadHost(p.dir, { executavel: process.execPath, argumentos: ['-e', 'process.exit(0)'] }, {}), /recibo/);
    const r = enviarPayloadHost(p.dir, { executavel: process.execPath, argumentos: ['-e', "const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify({success:true,message_id:p.n,platform:'telegram'}))"] }, { n: 7 });
    assert.equal(r.message_id, 7);
  } finally { p.limpar(); }
});


test('digest retoma após morte do processo dentro do transporte', () => {
  const p = projetoTemporario('digest-processo-morto');
  try {
    const modulo = path.resolve(__dirname, '../../dist/master-digest.js');
    const code = `require(${JSON.stringify(modulo)}).enviarDigest({raiz:${JSON.stringify(p.dir)},quando:'2026-09-11T12:00:00Z',enviar:()=>process.exit(9)})`;
    const morto = spawnSync(process.execPath, ['-e', code]);
    assert.equal(morto.status, 9);
    assert.equal(fs.existsSync(path.join(dirDigest(p.dir), 'envio.lock/pid')), true);
    const r = enviarDigest({ raiz: p.dir, quando: '2026-09-11T12:05:00Z', enviar: () => ({ success: true, message_id: 1, platform: 'telegram' }) });
    assert.equal(r.code, 0, r.detalhe);
    assert.equal(lerDigest(p.dir, '2026-09-11').recibos.length, 1);
    assert.equal(fs.existsSync(path.join(dirDigest(p.dir), 'envio.lock')), false);
  } finally { p.limpar(); }
});

test('JSON inválido informa o arquivo do job ou da configuração', () => {
  const p = projetoTemporario('digest-json');
  try {
    fs.mkdirSync(dirDigest(p.dir), { recursive: true });
    const file = path.join(dirDigest(p.dir), '2026-09-11.json');
    fs.writeFileSync(file, '{inválido');
    assert.ok(enviarDigest({ raiz: p.dir, quando: '2026-09-11T12:00:00Z' }).detalhe.includes(file));
    fs.unlinkSync(file);
    const host = path.join(p.dir, '.orkastery/monitor/master-host.json');
    fs.writeFileSync(host, '{inválido');
    assert.ok(enviarDigest({ raiz: p.dir, quando: '2026-09-11T12:00:00Z' }).detalhe.includes(host));
  } finally { p.limpar(); }
});

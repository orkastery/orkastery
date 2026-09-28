'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const { projetoTemporario } = require(path.join(root, 'core/dist-test/test/apoio'));
const { novaThread, gravarThread, dirThread } = require(path.join(root, 'core/dist/thread'));
const { lerLedger } = require(path.join(root, 'core/dist/ledger'));
const hook = path.join(root, 'adapters/claude-code/hooks/ork-sensor.js');
const cli = path.join(root, 'core/dist/index.js');
const semVinculo = 'ork sensor: sessão sem fase vinculada; evento não ingerido. Se foi despachada pelo Ork, confira o vínculo com ork thread status.\n';
const generico = 'ork sensor: evento não ingerido; confira o CLI e a sessão registrada.\n';
function fixture(body) {
  const p = projetoTemporario('i16-sensor-diagnostic');
  try {
    const t = novaThread(p.carregado, { nome:'sensor diagnostic', modo:'auto' }).thread;
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const eventos = () => lerLedger(dirThread(p.dir,t.id));
    const registrar = () => { t.sessoes.push({sessionId,slug:t.slug,fase:'GO',bloco:'GO',runtime:'claude-bg',
      despachadaEm:new Date(Date.now()-1000).toISOString(),promptPath:'',promptSha256:'',verificada:true});
      gravarThread(p.dir,t); };
    const run = (cliPath=cli) => spawnSync(process.execPath,[hook], {cwd:p.dir,
      input:JSON.stringify({session_id:sessionId,cwd:p.dir,hook_event_name:'Stop'}),encoding:'utf8',
      env:{HOME:p.dir,PATH:process.env.PATH,ORK_SENSOR_CLI:cliPath},timeout:5000});
    body({p,t,run,eventos,registrar});
  } finally {p.limpar();}
}
test('sessão desconhecida recebe diagnóstico preciso sem evento nem inferência de papel', () => fixture(({run,eventos}) => {
  const antes=eventos().length, r=run();assert.equal(r.status,0);assert.equal(r.stdout,'');
  assert.equal(r.stderr,semVinculo);assert.equal(eventos().length,antes);
}));
test('sessão de fase registrada conserva ingestão e falha de CLI visível', () => fixture(({run,eventos,registrar}) => {
  registrar();const antes=eventos().length,r=run();assert.equal(r.status,0);assert.equal(r.stdout,'');
  assert.equal(r.stderr,'');assert.equal(eventos().length,antes+1);assert.equal(eventos().at(-1).tipo,'runtime_stop');
  const falha=run('/missing-ork-cli');assert.equal(falha.status,0);assert.equal(falha.stdout,'');
  assert.equal(falha.stderr,generico);assert.equal(eventos().length,antes+1);
}));
test('perda de registro de fase permanece diagnóstico visível, sem classificar como owner', () => fixture(({p,t,run,eventos,registrar}) => {
  registrar();t.sessoes=[];gravarThread(p.dir,t);const antes=eventos().length,r=run();
  assert.equal(r.status,0);assert.equal(r.stdout,'');assert.equal(r.stderr,semVinculo);assert.equal(eventos().length,antes);
}));
test('saída divergente do CLI não é reinterpretada como recusa conhecida', () => fixture(({p,run,eventos}) => {
  const fake=path.join(p.dir,'fixture-cli');
  fs.writeFileSync(fake,'#!/usr/bin/env node\nprocess.stdout.write("unexpected");process.stderr.write("evento recusado: sessão desconhecida; confira ork thread status\\n");process.exitCode=1;\n',{mode:0o700});
  const antes=eventos().length,r=run(fake);assert.equal(r.status,0);assert.equal(r.stdout,'');
  assert.equal(r.stderr,generico);assert.equal(eventos().length,antes);
}));

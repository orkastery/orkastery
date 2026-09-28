import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { varrerPulse, mensagemPulse } from '../src/pulse-delivery';
import { Pulse, ItemPulse } from '../src/pulse';

const item=():ItemPulse=>({id:'sessao:fake',classe:'hitl',motivo:'hitl.pergunta',thread:null,fase:null,
  sessionId:'fake',desdeEm:'2026-09-07T10:01:00Z',paradaHaMin:4,impacto:0,pergunta:'Qual opção?',opcoes:['1. Continuar'],
  recomendacao:'Revisar antes de responder.',comandoResposta:'claude attach fake',evidencia:['sessão fake'],fontes:['sessions hitl'],contextoLogs:[]});
const radar=(items:ItemPulse[]):Pulse=>({contrato:'ork.pulse/v1',consultadoEm:'2026-09-07T10:05:00Z',runtime:{ok:true,detalhe:''},
  precisaDeHumanoAgora:items,acoesAutomaticas:[],resumo:{humanos:items.length,automaticas:0,scores:0,fasesOrfas:0}});

test('pergunta longa preserva identidade e resposta, com redação anterior ao limite', () => {
  const i = item();
  i.thread = 't-demo';
  i.pergunta = Array.from({ length: 100 }, (_, n) => 'op' + n).join('\n');
  i.opcoes = Array.from({ length: 20 }, () => 'x'.repeat(1000));
  i.contextoLogs = ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.EXEMPLO.assinatura'];
  const mensagem = mensagemPulse(i);
  assert.match(mensagem, /^Orkastery: t-demo \[hitl\]\nEspera:/);
  assert.ok(mensagem.includes('Responder: claude attach fake'));
  assert.ok(!mensagem.includes('EXEMPLO'));
  assert.ok(mensagem.length <= 3900);
});

test('fx-hitl-latency: varredura fake de cinco minutos entrega em quatro, deduplica e reconhece novo episódio',()=>{
  const p=projetoTemporario('pulse-delivery');
  try {
    const i=item(),mensagens:string[]=[];let atual=radar([i]);
    const rodar=()=>varrerPulse({raiz:p.dir,consultar:()=>atual,enviar:m=>{mensagens.push(m);return true;},quando:atual.consultadoEm});
    assert.equal(rodar().enviadas,1);
    assert.ok((Date.parse(atual.consultadoEm)-Date.parse(i.desdeEm!))/60000<=10);
    i.paradaHaMin=9;assert.equal(rodar().enviadas,0,'só a passagem do tempo não é novidade');
    i.pergunta='Outra pergunta?';assert.equal(rodar().enviadas,1);
    atual=radar([]);assert.equal(rodar().enviadas,0);
    atual=radar([i]);assert.equal(rodar().enviadas,1,'reapareceu após sair da fila');
    // I-41: cada varredura com novidade entrega UM resumo, nao uma mensagem por item.
    assert.equal(mensagens.length,3);assert.match(mensagens[0],/^🔔 Orkastery, resumo de /);
    // I-41 (GO-FIX 1, B3): este item nao tem gate que espere o dono, entao nao ha pergunta a
    // mandar, e o resumo diz isso em vez de pedir licenca para mandar zero perguntas.
    assert.match(mensagens[0],/Esperando você: 1/);
    assert.match(mensagens[0],/Nada aqui pede resposta sua por este canal agora\./);
    assert.equal(mensagens[0].includes('Posso te mandar'),false);
    assert.equal(fs.readFileSync(path.join(p.dir,'.orkastery/monitor/hitl.log'),'utf8').trim().split('\n').length,5);
  } finally {p.limpar();}
});

test('falhas de envio e consulta não consomem novidade nem apagam cache válido',()=>{
  const p=projetoTemporario('pulse-failure');
  try {
    const i=item(),consultar=()=>radar([i]);
    assert.equal(varrerPulse({raiz:p.dir,consultar,enviar:()=>false}).code,1);
    assert.equal(varrerPulse({raiz:p.dir,consultar,enviar:()=>true}).enviadas,1);
    const file=path.join(p.dir,'.orkastery/monitor/pulse-avisado.json'),before=fs.readFileSync(file,'utf8');
    const invalid=radar([]);invalid.runtime.ok=false;
    assert.equal(varrerPulse({raiz:p.dir,consultar:()=>invalid,enviar:()=>{throw Error('não enviar');}}).code,1);
    assert.equal(fs.readFileSync(file,'utf8'),before);
    i.pergunta='Pergunta nova';
    assert.equal(varrerPulse({raiz:p.dir,consultar,enviar:()=>false}).code,1);
    assert.equal(fs.readFileSync(file,'utf8'),before);
    assert.equal(varrerPulse({raiz:p.dir,consultar,enviar:()=>true}).enviadas,1);
  } finally {p.limpar();}
});

test('transporte executa argv literal sem shell e lock vivo impede segunda varredura',()=>{
  const p=projetoTemporario('pulse-argv');
  try {
    // A carga de injecao vai no nome da thread, que e o que o resumo imprime desde a I-41.
    const i=item();i.thread='$(touch INVASAO) `touch INVASAO`';
    const output=path.join(p.dir,'sink.txt');
    const r=varrerPulse({raiz:p.dir,consultar:()=>radar([i]),transporte:{executavel:process.execPath,
      argumentos:['-e','require("fs").writeFileSync(process.argv[1],process.argv[2])',output,'{{mensagem}}']}});
    assert.equal(r.code,0);assert.match(fs.readFileSync(output,'utf8'),/\$\(touch INVASAO\)/);
    assert.equal(fs.existsSync(path.join(p.dir,'INVASAO')),false);
    const lock=path.join(p.dir,'.orkastery/monitor/pulse.lock');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'pid'),String(process.pid));
    const again=varrerPulse({raiz:p.dir,consultar:()=>{throw Error('não consultar com lock ocupado');}});
    assert.equal(again.enviadas,0);assert.equal(again.detalhe,'varredura já em andamento');
  } finally {p.limpar();}
});

test('rotina versionada bate de 15 em 15 minutos e chama só o núcleo determinístico',()=>{
  const repo=path.resolve(__dirname,'../../..');
  const cron=fs.readFileSync(path.join(repo,'monitor/pulse.cron'),'utf8');
  // I-50: a batida e curta e a cadencia e do nucleo, pela tag do dono (a padrao segue de hora em
  // hora). De cinco em cinco minutos com uma mensagem por item foi o que produziu 6.121 mensagens
  // em 08/09 e 75 em 20/09; por isso a entrada do cron liga a cadencia e o teto de um resumo.
  assert.match(cron,/^\*\/15 \* \* \* \* .*varredura-pulse\.sh$/m);
  assert.match(fs.readFileSync(path.join(repo,'core/src/pulse-delivery.ts'),'utf8'),/varrerPulse\(\{raiz,escopo,comCadencia:true[,}]/);
  const shell=fs.readFileSync(path.join(repo,'monitor/varredura-pulse.sh'),'utf8');
  assert.match(shell,/exec node .*pulse-delivery\.js/);
  assert.doesNotMatch(shell,/claude|codex exec|hermes cron|deliver=origin/);
});

test('rotina sob PATH mínimo localiza o runtime no prefixo configurado antes da consulta', () => {
  const p = projetoTemporario('pulse-cron-path');
  try {
    const repo = path.resolve(__dirname, '../../..');
    const monitor = path.join(p.dir, 'monitor'), dist = path.join(p.dir, 'core/dist');
    const bin = path.join(p.dir, 'executaveis-usuario');
    for (const dir of [monitor, dist, bin]) fs.mkdirSync(dir, { recursive: true });
    const script = path.join(monitor, 'varredura-pulse.sh');
    fs.copyFileSync(path.join(repo, 'monitor/varredura-pulse.sh'), script);
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    fs.writeFileSync(path.join(bin, 'runtime-prova'), '#!/bin/sh\necho runtime-localizado\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dist, 'pulse-delivery.js'),
      'const r=require("child_process").spawnSync("runtime-prova",[],{encoding:"utf8"});console.log(r.stdout);process.exit(r.status??1);');
    const r = spawnSync('/bin/bash', [script], { encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin', ORK_PULSE_RUNTIME_BIN: bin } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /runtime-localizado/);
  } finally { p.limpar(); }
});

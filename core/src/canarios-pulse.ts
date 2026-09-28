import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { Canario } from './canarios';
import { sandboxGit } from './sandbox';
import { novaThread, dirThread } from './thread';
import { garantirWorktree, sincronizarWorktree } from './worktree';
import { auditarEstado } from './estado-thread';
import { caminhoLedger, registrar, lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { durableAppend } from './company-brain-journal';
import { randomUUID } from 'node:crypto';
import { abrirPedidoGate, assinaturaDaResposta } from './hitl-gates';
import { detectarFasesOrfas } from './liveness';
import { varrerSessoes } from './hitl';
import { comporPulse } from './pulse';
import { montarMonitor } from './orquestracao';
import { varrerPulse } from './pulse-delivery';
import { EventoLedger } from './types';
import { cliDoCatalogo } from './catalogo';

export const CANARIOS_PULSE: readonly Canario[] = [
  {id:'fx-estado-dividido',sobre:'90 eventos na worktree não podem parecer 14 na main',precisaDeGit:true,rodar:()=>{
    const s=sandboxGit('estado-dividido');
    try {
      const t=novaThread(s.carregado,{nome:'estado',modo:'auto'}).thread,wt=garantirWorktree(s.carregado,t.id).dir;
      const local=path.join(wt,'.orkastery/threads',t.id),main=dirThread(s.dir,t.id);
      fs.unlinkSync(local);fs.mkdirSync(local);
      const eventos=Array.from({length:90},(_,i)=>JSON.stringify({tipo:'runtime_event',n:i})+'\n');
      fs.writeFileSync(path.join(main,'ledger.jsonl'),eventos.slice(0,14).join(''));
      fs.writeFileSync(path.join(local,'ledger.jsonl'),eventos.join(''));
      const audit=auditarEstado(s.dir,t.id,wt),sync=sincronizarWorktree(s.carregado,t.id);
      return {eventosMain:14,eventosWorktree:90,auditOk:audit.nivel==='ok',syncOk:sync.ok,
        copiasPreservadas:fs.readFileSync(path.join(local,'ledger.jsonl'),'utf8')===eventos.join('')&&
          fs.readFileSync(path.join(main,'ledger.jsonl'),'utf8')===eventos.slice(0,14).join('')};
    } finally {s.limpar();}
  }},
  {id:'fx-fase-orfa',sobre:'replay dos três despachos órfãos de 07/09/2026',precisaDeGit:true,rodar:ctx=>{
    const fixture=JSON.parse(fs.readFileSync(path.join(ctx.catalogo,'eval/fixtures/fx-fase-orfa/caso.json'),'utf8'));
    const resultados=[];
    for(const caso of fixture.replay as {threadOrigem:string;consultaEm:string;eventos:EventoLedger[]}[]) {
      const s=sandboxGit('replay-orfa');
      try {
        const t=novaThread(s.carregado,{nome:`replay fixture ${resultados.length + 1}`,modo:'auto'}).thread;
        // I-41 (GO-FIX 1, D11): a decisao autonoma de 07/09 e linha HISTORICA, anterior ao rastro
        // tipado. O replay a reproduz como estava, sem passar pela exigencia da escrita nova, que e
        // exatamente a promessa de D11: evento antigo continua legivel, nenhuma linha e reescrita.
        for(const e of caso.eventos) {
          if(e.tipo===TIPOS_DE_EVENTO.decisaoAutonoma) durableAppend(caminhoLedger(dirThread(s.dir,t.id)),{...e,thread:t.id,eventId:randomUUID()});
          else registrar(dirThread(s.dir,t.id),t.id,e.tipo,{...e,thread:t.id});
        }
        resultados.push(...detectarFasesOrfas(s.carregado,{quando:caso.consultaEm,fontes:()=>({})}));
      } finally {s.limpar();}
    }
    return {detectadas:resultados.length,latenciaMaxMin:Math.max(0,...resultados.map(r=>r.silencioHaMin)),
      motivos:[...new Set(resultados.map(r=>r.motivo))],automaticas:resultados.filter(r=>r.retry.automatica).length,
      precisamDeHumano:resultados.filter(r=>!r.retry.automatica).length};
  }},
  {id:'fx-hitl-latency',sobre:'SIMULADO: alerta I-01 e resposta correlacionada via CLI até human_gate em menos de 60 s',precisaDeGit:true,rodar:ctx=>{
    const s=sandboxGit('hitl-latency');
    try {
      const consulta={ok:true,detalhe:'',sessoes:[{id:'fake',sessionId:'fake',state:'blocked',startedAt:Date.parse('2026-09-07T09:00:00Z')}]};
      const casa=path.join(s.dir,'host');
      varrerSessoes({raiz:s.dir,casa,consulta,semLogs:true,registrar:true,registrarMaquina:true,agora:'2026-09-07T10:01:00Z'});
      const quando='2026-09-07T10:05:00Z';
      const radar=varrerSessoes({raiz:s.dir,casa,consulta,semLogs:true,registrar:true,registrarMaquina:true,agora:quando});
      const pulse=comporPulse(s.carregado,{radar,monitor:montarMonitor(s.carregado,{agora:quando,estados:new Map()}),batch:[],orfas:[]});
      const sink=path.join(s.dir,'sink.txt');
      const config={raiz:s.dir,quando,consultar:()=>pulse,transporte:{executavel:process.execPath,
        argumentos:['-e','require("fs").writeFileSync(process.argv[1],process.argv[2])',sink,'{{mensagem}}']}};
      const primeira=varrerPulse(config),segunda=varrerPulse(config);
      // Medição real do caminho local, com identidade/chave exclusivamente SIMULADAS.
      // Não mede Telegram nem atesta o ingresso nativo do gateway (T13).
      const t = novaThread(s.carregado, { nome: 'resposta simulada', modo: 'classic' }).thread;
      registrar(dirThread(s.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'SIMULADO' });
      const pedido = abrirPedidoGate(s.dir, t.id);
      const chave = 'canario-SIMULADO-sem-credencial-real-000';
      const resposta = { origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:99',
        resposta: '1', recebidoEm: new Date().toISOString() };
      const envelope = { ...resposta, prova: assinaturaDaResposta(t.id, pedido.id, resposta, chave) };
      const argv = [cliDoCatalogo(ctx.catalogo), 'gate', 'answer', t.id, pedido.id,
        '--resposta-stdin', '--origem', 'telegram', '--por', resposta.por, '--mensagem', resposta.mensagem];
      const ambiente = { ...process.env, ORK_HITL_INGRESS_KEY: chave, ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' };
      const enviar = (corpo: unknown) => spawnSync(process.execPath, argv, { cwd: s.dir, encoding: 'utf8',
        input: JSON.stringify(corpo), env: ambiente, timeout: 10000, maxBuffer: 65536 });
      const inicio = performance.now(), aceita = enviar(envelope);
      const gate = lerLedger(dirThread(s.dir, t.id)).find(e => e.tipo === 'human_gate');
      const latenciaRespostaMs = performance.now() - inicio;
      const repetida = enviar(envelope), adulterada = enviar({ ...envelope, resposta: '2' });
      return {latenciaMin:radar.sessoes[0].paradaHaMin,enviadas:primeira.enviadas,repetidas:segunda.enviadas,
        // I-41: o transporte recebe o RESUMO composto pelo nucleo, nao uma mensagem por item. A
        // sonda continua sendo "o texto composto chegou ao sink", e o cabecalho prova composicao
        // porque carrega a data-hora formatada no fuso do dono, nao uma constante do codigo.
        sinkRecebeu:fs.existsSync(sink)&&fs.readFileSync(sink,'utf8').includes('Orkastery, resumo de '),
        simulado: true, respostaRecebida: aceita.status === 0 && gate?.pedidoId === pedido.id && gate?.estado === 'aprovado',
        latenciaRespostaMs, respostaAbaixo60s: !!gate && aceita.status === 0 && latenciaRespostaMs < 60000,
        idempotente: repetida.status === 0 && JSON.parse(repetida.stdout).repetida === true &&
          lerLedger(dirThread(s.dir, t.id)).filter(e => e.tipo === 'human_gate').length === 1,
        adulteradaRecusada: adulterada.status !== 0, conteudoAusente: !!gate && gate.resposta === undefined && gate.prova === undefined };
    } finally {s.limpar();}
  }},
];

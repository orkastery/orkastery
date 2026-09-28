/** App-server FALSO em processo próprio; nunca acessa assinatura ou sessão global. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirTemporario } from './apoio';
import { DespachoCodexPedido, despachar } from '../src/adapters/codex';
import { controleDoController, lerEstadoController } from '../src/adapters/codex-controller';

export function controllerSimulado(raiz?: string,
  opcoes: { launcherExec?: boolean; cenario?: string; capturarEnv?: { arquivo: string; nomes: string[] };
    /** I-33 (D12): linha real de rollout que o cenario `sem-credito` grava como fim do turno; `sem-credito-commit`
     * (N1) antes faz `git commit` pelo shell na worktree, sem passar pelo ledger. */
    fixture?: string } = {}) {
  const dir = raiz ?? dirTemporario('controller');
  // Modos explícitos: o sensor recusa fonte com escrita alheia, e o umask de quem roda (002 em
  // muitas contas Linux) não pode decidir se o teste passa.
  const bin = path.join(dir, 'fake-bin'); fs.mkdirSync(bin, { mode: 0o700 });
  const runtimeHome = path.join(dir, 'runtime'); fs.mkdirSync(runtimeHome, { mode: 0o700 });
  fs.writeFileSync(path.join(runtimeHome, 'cenario.json'), JSON.stringify(opcoes));
  fs.writeFileSync(path.join(bin, 'codex'), `#!${process.execPath}
process.umask(0o022);const fs=require('fs'),rl=require('readline');let cwd,turn='turn-1',request=0,skillRoots=[];\nconst captura=${JSON.stringify(opcoes.capturarEnv ?? null)};\nif(captura)fs.appendFileSync(captura.arquivo,JSON.stringify({recebidas:captura.nomes.filter(n=>n in process.env),home:!!process.env.HOME})+'\\n');
const sid=require('crypto').randomUUID(),opcoesCenario=JSON.parse(fs.readFileSync(process.env.CODEX_HOME+'/cenario.json','utf8')),cenario=opcoesCenario.cenario;
const out=v=>process.stdout.write(JSON.stringify(v)+'\\n');
const roll=process.env.CODEX_HOME+'/rollout.jsonl';
const wroll=(v,nl)=>fs.appendFileSync(roll,JSON.stringify(v)+(nl===false?'':'\\n'));
const fechar=()=>{if(cenario==='exit-nao-zero')process.exit(23);if(cenario==='close-signal')process.kill(process.pid,'SIGTERM');};
const block=()=>{if(cenario==='never')return;const q={id:'marcador',question:'Marcador SIMULADO?',...(cenario==='long-options'?{options:[{label:'A',description:'D'.repeat(201)}]}:{})};const params={threadId:sid,turnId:turn,itemId:'item-'+request,isBlocking:cenario!=='nonblocking',questions:cenario==='multiple'?[q,{...q,id:'q2'}]:[cenario==='secret'?{...q,isSecret:true,question:'SEGREDO-NATIVO-SIMULADO'}:q]};if(cenario==='uncorrelated')delete params.threadId;out({method:cenario==='approval'?'item/commandExecution/requestApproval':'item/tool/requestUserInput',id:request,params});};
rl.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
if(r.method==='turn/interrupt')fs.writeFileSync(process.env.CODEX_HOME+'/interrompido.json',JSON.stringify(r));
if(['thread/start','turn/start','review/start','skills/extraRoots/set','skills/list','mcpServerStatus/list'].includes(r.method))fs.appendFileSync(process.env.CODEX_HOME+'/params.jsonl',JSON.stringify({method:r.method,params:r.params})+'\\n');
if(!r.method&&r.result){fs.appendFileSync(process.env.CODEX_HOME+'/recebido.jsonl',JSON.stringify(r)+'\\n');out({method:'serverRequest/resolved',params:{threadId:sid,requestId:request,response:JSON.stringify(r.result),futureSecret:'CAMPO-FUTURO-SIMULADO'}});request++;setTimeout(block,50);return;}
if(cenario==='boot-timeout'&&r.method==='thread/start')return;
if(cenario==='runtime-crash'&&r.method==='thread/start'){process.exit(23);}
let result={};
if(r.method==='account/read')result={account:{type:'chatgpt'}};
if(r.method==='skills/extraRoots/set')skillRoots=r.params.extraRoots;
if(r.method==='skills/list')result={data:[{cwd:r.params.cwds[0],errors:[],skills:cenario==='skills-missing'?[]:[{name:'orkastery-bootstrap',path:skillRoots[0]+'/skills/core/orkastery-bootstrap/SKILL.md',enabled:true}]}]};
if(r.method==='mcpServerStatus/list')result={data:cenario==='mcp-missing'?[]:[{name:'orkastery',tools:{ork_thread_status:{name:'ork_thread_status'},ork_observe:{name:'ork_observe'}}}]};
if(r.method==='thread/start'){cwd=r.params.cwd;wroll({type:'session_meta',payload:{id:sid,cwd}});result={thread:{id:sid,cwd,path:roll},model:r.params.model??'modelo-SIMULADO'};}
if(r.method==='thread/read')result={thread:{id:sid,cwd,path:process.env.CODEX_HOME+'/rollout.jsonl'}};
if(r.method==='turn/start'){result={turn:{id:turn}};out({method:'turn/started',params:{threadId:sid,turn:{id:turn}}});
wroll({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'turn.started',turn_id:turn}});
if(cenario==='crash-parcial'){wroll({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'item.completed',item:{type:'agent_message',text:'Concluido SIMULADO.'}}});fs.appendFileSync(roll,'{"type":"event_msg","payload":{"type":"turn.compl');process.exit(23);}
if(cenario==='sem-credito'||cenario==='sem-credito-commit')setTimeout(()=>{if(cenario==='sem-credito-commit'){const cp=require('child_process');fs.writeFileSync(cwd+'/produto-da-sessao.txt','fatia da sessao');cp.execFileSync('git',['-C',cwd,'add','--','produto-da-sessao.txt']);cp.execFileSync('git',['-C',cwd,'commit','-q','-m','commit da sessao pelo shell antes da cota']);}const l=JSON.parse(fs.readFileSync(opcoesCenario.fixture,'utf8').split('\\n')[0]);l.timestamp=new Date().toISOString();l.payload.turn_id=turn;wroll(l);out({method:'turn/completed',params:{threadId:sid,turn:{id:turn,status:'failed',error:{message:l.payload.error.message,codexErrorInfo:'usageLimitExceeded',additionalDetails:null}}}});setTimeout(fechar,60);},30);else
if(r.params.input[0].text.includes('FINALIZAR-SIMULADO'))setTimeout(()=>{wroll({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'item.completed',item:{type:'agent_message',text:'Concluido SIMULADO.'}}});wroll({type:'token_usage_record',payload:{turn_id:turn,turn_token_usage:{input_tokens:20,cached_input_tokens:10,output_tokens:4}}});wroll({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'turn.completed',turn_id:turn,usage:{input_tokens:20,cached_input_tokens:10,output_tokens:4}}});out({method:'turn/completed',params:{threadId:sid,turn:{id:turn,status:'completed'}}});setTimeout(fechar,60);},30);else setTimeout(block,30);}
if(r.method==='review/start'){result={reviewThreadId:sid,turn:{id:turn}};out({method:'turn/started',params:{threadId:sid,turn:{id:turn}}});setTimeout(block,30);}
if(r.id!==undefined)out({id:r.id,result});
if(r.method==='turn/interrupt')out({method:'turn/completed',params:{threadId:sid,turn:{id:turn,status:'interrupted'}}});
});` , { mode: 0o755 });
  if (opcoes.launcherExec) {
    fs.renameSync(path.join(bin, 'codex'), path.join(bin, 'runtime.cjs'));
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nsleep 0.2\nexec ' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(path.join(bin, 'runtime.cjs')) + '\n', { mode: 0o755 });
  }
  const antigos = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  process.env.PATH = bin + path.delimiter + process.env.PATH;
  process.env.CODEX_HOME = runtimeHome;
  const prompt = 'pergunta SIMULADA';
  const vinculo = { thread: 'ork-controller', fase: 'GO', promptSha256: createHash('sha256').update(prompt).digest('hex') };
  const dispatch = (mudancas: Partial<DespachoCodexPedido> = {}) => despachar({ nome: 'simulado', cwd: dir, logDir: path.join(dir, 'sessoes'), prompt, vinculo, esperaMs: 5000, ...mudancas });
  const rollout = path.join(runtimeHome, 'rollout.jsonl');
  return { dir, runtimeHome, rollout, prompt, vinculo, dispatch,
    controle: (r: ReturnType<typeof dispatch>) => controleDoController(r.controlador!, vinculo, r.sessionId!, dir),
    estado: (r: ReturnType<typeof dispatch>) => lerEstadoController(r.controlador!),
    restaurar: () => { for (const [k, v] of Object.entries(antigos)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } },
  };
}
export function esperarCondicao(f: () => boolean, ms = 5000): void {
  const fim = Date.now() + ms;
  while (!f() && Date.now() < fim) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
  if (!f()) throw new Error('condição de fixture não ocorreu');
}

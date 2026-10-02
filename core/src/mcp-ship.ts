/** SHIP instalado: o cliente escolhe identidade/HEADs, nunca transporte ou autorização.
 * SSH do dono é infraestrutura confiável explícita; não é uma promessa de SSH sem helpers.
 * Escritores hostis concorrentes fora do sandbox não pertencem a este contrato. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {exigirManifesto} from './manifest';
import {lerThread,blocoDaThread} from './thread';
import {branchDaWorktree} from './worktree';
import {validarArquivosEstadoMcp} from './mcp-artifacts';
import {perfilGitMcp,gitPassivoMcp as git,caminhoFisicoGitMcp as fisico,metadadosGitMcp as metadados,configuracaoPassivaGitMcp} from './mcp-git';
import {adquirirRegiao,lerLease,liberar,leasesColidentes,caminhoLease,caminhoFila,podarRegioesDeThreadsFechadas} from './leases';
import {ship,ResultadoShip,arvoreComBranch} from './ship';
import {comandosDoManifesto,ExecutorVerify} from './verify';
import {lerClaims} from './claims';
import {criarExecutorSandbox} from './verify-sandbox';

// Mesmo mecanismo subreaper do executor C17: também cobre Git/SSH e o worker inteiro.
const SUPERVISOR_SHIP = String.raw`
import ctypes, errno, json, os, selectors, signal, subprocess, sys, time
p = json.load(sys.stdin)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER falhou')
state = {'failure': None}
def interrupted(_sig, _frame): state['failure'] = 'supervisor interrompido'
signal.signal(signal.SIGTERM, interrupted)
def cleanup():
    deadline = time.monotonic() + 3
    while True:
        with open('/proc/self/task/' + str(os.getpid()) + '/children') as f:
            children = [int(x) for x in f.read().split()]
        # Filhos vivos ou zombies ainda não reaped: seus PIDs não podem ser reutilizados.
        for pid in children:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
        try:
            while True:
                pid, _status = os.waitpid(-1, os.WNOHANG)
                if pid == 0: break
        except ChildProcessError: return True
        if time.monotonic() >= deadline: return False
        time.sleep(.005)
stdout = bytearray(); stderr = bytearray(); code = -1
try:
    child = subprocess.Popen([p['bin'], *p['args']], cwd=p['cwd'], env=p['env'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    child.stdin.write(p['input'].encode()); child.stdin.close()
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, stdout)
    selector.register(child.stderr, selectors.EVENT_READ, stderr)
    deadline = time.monotonic() + p['timeoutMs']/1000
    while True:
        if state['failure']: break
        if time.monotonic() >= deadline:
            state['failure'] = 'timeout do sandbox'; break
        if child.poll() is not None and not selector.get_map():
            code = child.returncode; break
        for key, _ in selector.select(.025):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data: selector.unregister(key.fileobj); continue
            if len(stdout)+len(stderr)+len(data) > p['maxOutput']:
                state['failure'] = 'limite de saída excedido'; break
            key.data.extend(data)
except Exception as e: state['failure'] = 'sandbox indisponível: ' + str(e)
finally:
    cleaned = cleanup()
    if not cleaned: state['failure'] = 'descendente do sandbox não encerrou no prazo'
print(json.dumps({'code': -1 if state['failure'] else code,
    'stdout': stdout.decode(errors='replace'), 'stderr': stderr.decode(errors='replace'), 'failure': state['failure'], 'cleanupConfirmed': cleaned}))
`;
const PRAZO=240000,RESERVA=15000,LIMITE=1048576;
export interface PedidoShipMcp {threadId:string;expectedSource:string;expectedDestination:string}
export interface PerfilShipMcp {readonly transporte:'github-ssh'|'bare-local';readonly destino:string}
interface Fixacao {raiz:string;dev:number;ino:number;url:string;config:string;perfil:PerfilShipMcp;env:NodeJS.ProcessEnv;bare?:{dev:number;ino:number}}
const perfis=new WeakMap<PerfilShipMcp,Fixacao>();
function erro(m:string):never {throw Error('mcp.ship.'+m);}
function digest(s:string){return createHash('sha256').update(s).digest('hex');}
/** Somente SSH fixado/bare físico: ambos nunca usam credential helpers HTTP. HTTPS é recusado na factory. */
function config(raiz:string):string {
  const raw=git(raiz,['config','--null','--list']);
  for(const item of raw.split('\0').filter(Boolean)) {
    const i=item.indexOf('\n');if(i<0 || !configuracaoPassivaGitMcp(item.slice(0,i).toLowerCase(),item.slice(i+1),true))erro('config.unsupported');
  }
  return digest(raw);
}
/** Push usa todas as URLs configuradas; nunca fixar somente a primeira. */
function originUnico(raiz:string):string {
  const ler=(push:boolean)=>{
    const raw=git(raiz,['remote','get-url',...(push?['--push']:[]),'--all','origin']);
    const urls=raw.split('\n');if(urls[urls.length-1]==='')urls.pop();
    if(urls.length!==1 || !urls[0] || /[\x00-\x1f\x7f]/.test(urls[0]))erro('transport.urls: origin exige uma URL efetiva');
    return urls[0];
  };
  const fetch=ler(false),push=ler(true);if(fetch!==push)erro('transport.pushurl');return fetch;
}
function guardarBare(url:string):{dev:number;ino:number} {
  if(!path.isAbsolute(url))erro('transport.bare.invalid');fisico(url,url);
  const st=fs.statSync(url);if(st.uid!==process.getuid?.())erro('transport.bare.owner');
  for(const n of ['objects','refs','logs','info','HEAD','config','packed-refs','hooks'])metadados(url,path.join(url,n));
  const hooks=path.join(url,'hooks');if(fs.existsSync(hooks))for(const n of fs.readdirSync(hooks)) {
    if(!n.endsWith('.sample') && (fs.statSync(path.join(hooks,n)).mode&0o111))erro('transport.bare.hooks');
  }
  const alternates=path.join(url,'objects/info/alternates');if(fs.existsSync(alternates) && fs.statSync(alternates).size)erro('transport.bare.alternates');
  const raw=git(url,['config','--null','--list']);let bare=false;
  for(const item of raw.split('\0').filter(Boolean)) {const i=item.indexOf('\n'),k=item.slice(0,i).toLowerCase(),v=item.slice(i+1);
    if(k==='core.bare' && v==='true'){bare=true;continue;}if(i<0 || !configuracaoPassivaGitMcp(k,v,true))erro('transport.bare.config');}
  if(!bare)erro('transport.bare.invalid');return {dev:st.dev,ino:st.ino};
}
/** Somente instalação/startup confiável chama esta factory. O objeto é uma capacidade privada. */
export function criarPerfilShipMcp(raiz:string,transporte:'github-ssh'|'bare-local'='github-ssh'):PerfilShipMcp {
  if(process.platform!=='linux' || !path.isAbsolute(raiz))erro('project.invalid');fisico(raiz,raiz);
  const c=exigirManifesto(raiz);if(c.raiz!==raiz)erro('project.invalid');
  const destino=c.manifesto.worktree.base_branch;
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(destino) || destino.includes('..') || destino.endsWith('/'))erro('destination.invalid');
  const cfg=config(raiz),url=originUnico(raiz);
  let bare:Fixacao['bare'];
  if(transporte==='github-ssh') {
    if(!/^git@github\.com:[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.git$/.test(url))erro('transport.unsupported: GitHub SSH exigido; HTTPS requer autenticacao instalada auditada');
  } else if(transporte==='bare-local')bare=guardarBare(url);else erro('transport.invalid');
  const perfil=Object.freeze({transporte,destino}),st=fs.statSync(raiz);
  const env={HOME:process.env.HOME,USER:process.env.USER,LOGNAME:process.env.LOGNAME,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME,
    SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK,PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TMPDIR:'/tmp'};
  perfis.set(perfil,{raiz,dev:st.dev,ino:st.ino,url,config:cfg,perfil,env,...(bare?{bare}:{})});return perfil;
}
function validar(p:PedidoShipMcp) {
  if(!p || Object.keys(p).sort().join(',')!=='expectedDestination,expectedSource,threadId' ||
    typeof p.threadId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(p.threadId) ||
    !/^[a-f0-9]{40}$/.test(p.expectedSource) || !/^[a-f0-9]{40}$/.test(p.expectedDestination))erro('request.invalid');
}
function gitdir(raiz:string,wt:string):string {
  if(wt===raiz)return path.join(raiz,'.git');const f=path.join(wt,'.git');fisico(wt,f,true);
  const m=/^gitdir: (.+)\s*$/.exec(fs.readFileSync(f,'utf8'));if(!m)erro('worktree.invalid');
  const d=path.resolve(wt,m![1].trim());fisico(path.join(raiz,'.git'),d);return d;
}
interface Arvore {paths:string[];attrs:string}
function arvore(raiz:string,ref:string):Arvore {
  const raw=git(raiz,['ls-tree','-rz',ref]);const nomes:string[]=[],attrs:string[]=[];
  for(const item of raw.split('\0').filter(Boolean)) {
    if(item.startsWith('160000 '))erro('tree.gitlink.unsupported');
    const i=item.indexOf('\t'),nome=item.slice(i+1);if(i<0 || !nome || nomes.length>=4096)erro('tree.unsupported');
    nomes.push(nome);if(path.posix.basename(nome)==='.gitattributes')attrs.push(item);
  }
  return {paths:nomes,attrs:attrs.sort().join('\0')};
}
function atributos(raiz:string,refs:string[],destino:string):void {
  const trees=refs.map(r=>arvore(raiz,r));if(trees.some(t=>t.attrs!==trees[0].attrs))erro('attributes.transition.unsupported');
  const nomes=[...new Set(trees.flatMap(t=>t.paths))].sort();if(!nomes.length || nomes.length>4096)erro('tree.unsupported');
  const input=nomes.join('\0')+'\0';
  const conferir=(cwd:string,args:string[])=>{
    const raw=git(cwd,['check-attr',...args,'-z','--stdin','filter','merge'],input),parts=raw.split('\0');
    if(parts.pop()!=='' || parts.length!==nomes.length*6)erro('attributes.inconclusive');
    for(let i=0;i<nomes.length;i++) {
      const v=parts.slice(i*6,i*6+6);
      if(v[0]!==nomes[i] || v[1]!=='filter' || !['unspecified','unset'].includes(v[2]) ||
        v[3]!==nomes[i] || v[4]!=='merge' || !['unspecified','unset','set','text','binary','union'].includes(v[5]))erro('attributes.active-driver');
    }
  };
  refs.forEach(r=>conferir(raiz,['--source='+r]));conferir(destino,[]);conferir(destino,['--cached']);
  // O destino não pode manter atributos locais divergentes dos blobs fixados.
  for(const item of trees[0].attrs.split('\0').filter(Boolean)) {
    const i=item.indexOf('\t'),nome=item.slice(i+1),blob=item.slice(0,i).split(' ')[2],f=path.join(destino,nome);
    fisico(destino,f,true);const bytes=fs.readFileSync(f);
    const hash=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');if(hash!==blob)erro('attributes.worktree.changed');
  }
}
function executar(f:Fixacao,p:PedidoShipMcp):ResultadoShip {
  validar(p);const raiz=f.raiz,deadline=Date.now()+PRAZO;
  const guardEstado=()=>{fisico(raiz,raiz);const st=fs.statSync(raiz);if(st.dev!==f.dev || st.ino!==f.ino)erro('project.changed');
    for(const dir of ['.orkastery','.orkastery/threads',`.orkastery/threads/${p.threadId}`])fisico(raiz,path.join(raiz,dir));
    validarArquivosEstadoMcp(raiz,p.threadId);
    for(const dir of ['.orkastery/leases','.orkastery/tmp','.orkastery/state-backups','.git/worktrees']) {
      const alvo=path.join(raiz,dir);if(fs.existsSync(alvo))fisico(raiz,alvo);
    }
    metadados(path.join(raiz,'.orkastery'),path.join(raiz,'.orkastery/leases'));metadados(path.join(raiz,'.orkastery'),caminhoFila(raiz));
  };
  guardEstado();const c=exigirManifesto(raiz),t=lerThread(raiz,p.threadId),wt=t.worktree;
  if(!wt || t.id!==p.threadId || t.status==='fechada' || !blocoDaThread(t,t.faseAtual).fases.includes('SHIP'))erro('thread.invalid');
  fisico(raiz,wt);const de=branchDaWorktree(t),para=f.perfil.destino;
  if(c.manifesto.worktree.base_branch!==para)erro('destination.changed');
  // Primeira fatia requer destino já registrado: não cria checkout com attrs ainda não inspecionados.
  const destino=arvoreComBranch(raiz,para);if(!destino)erro('destination.worktree.required');fisico(raiz,destino);
  const refs=[p.expectedSource,p.expectedDestination,git(raiz,['merge-base',p.expectedSource,p.expectedDestination]).trim()];
  refs.forEach(ref=>arvore(raiz,ref)); // Antes de qualquer diff, inclusive índice/WT.
  const guard=(etapa:'inicio'|'preparar'|'merge'|'push',dir?:string)=>{
    guardEstado();if(Date.now()>deadline-RESERVA)erro('deadline');
    if(originUnico(raiz)!==f.url || config(raiz)!==f.config)erro('transport.changed');
    if(f.bare){const b=guardarBare(f.url);if(b.dev!==f.bare.dev || b.ino!==f.bare.ino)erro('transport.changed');}
    if(git(raiz,['rev-parse',`refs/heads/${de}`]).trim()!==p.expectedSource || git(wt,['rev-parse','HEAD']).trim()!==p.expectedSource)erro('source.stale');
    if(etapa!=='push' && git(raiz,['rev-parse',`refs/heads/${para}`]).trim()!==p.expectedDestination)erro('destination.stale');
    if(arvoreComBranch(raiz,para)!==destino || (dir && dir!==destino))erro('destination.changed');
    for(const a of [wt,destino])perfilGitMcp(a,path.join(raiz,'.git'),gitdir(raiz,a),t.id,[]);
    for(const a of [wt,destino])if(git(a,['diff','--cached','--name-only','-z']).length || git(a,['diff','--name-only','-z']).length)erro('tracked.dirty');
    atributos(raiz,refs,destino);
  };
  guard('inicio');
  const comandos=lerClaims(raiz,t.id).filter(x=>x.estado!=='retirada').flatMap(x=>x.verificar).concat(comandosDoManifesto(c.manifesto).map(x=>x.comando));
  if(comandos.length>512 || comandos.reduce((n,s)=>n+Buffer.byteLength(s),0)>LIMITE)erro('verify.limit');
  const nome=`worktree-write:${t.id}`,nomes=[nome,`path:.orkastery/threads/${t.id}`];
  // RM-037 (fatia 3, defeito 4): lease e fila de thread fechada sao orfaos e saem antes da conferencia.
  podarRegioesDeThreadsFechadas(raiz,[...nomes,'main-tree'],t.id);
  for(const n of [...nomes,'main-tree'])if(fs.lstatSync(caminhoLease(raiz,n),{throwIfNoEntry:false}) || leasesColidentes(raiz,n).length)erro('lease.busy');
  const proprias:NonNullable<ReturnType<typeof lerLease>>[]=[];
  const leasesIntactas=()=>proprias.every(l=>JSON.stringify(lerLease(raiz,l.nome))===JSON.stringify(l));
  try {
    for(const n of nomes) {
      const a=adquirirRegiao(raiz,n,{thread:t.id,motivo:'MCP SHIP '+randomUUID(),ttlMs:PRAZO+RESERVA,retomarVencido:false});
      if(!a.ok || !a.lease)erro('lease.busy');proprias.push(a.lease!);
    }
    const executor:ExecutorVerify=(nomeComando,comando,cwd)=>{
      guardEstado();if(cwd!==wt || !leasesIntactas())erro('verify.scope');
      const restante=deadline-Date.now()-RESERVA;if(restante<100)return {nome:nomeComando,comando,ok:false,code:-1,resumo:'prazo SHIP esgotado'};
      const sandbox=criarExecutorSandbox({worktree:wt,timeoutMs:Math.min(60000,restante)});
      try{return sandbox.executar(nomeComando,comando,cwd);}finally{sandbox.fechar();}
    };
    return ship(c,t.id,{de,para,remoto:'origin',executorVerify:executor,ttlLeaseMs:PRAZO+RESERVA,retomarLeaseVencido:false,
      revalidarGit:(etapa,dir)=>{if(!leasesIntactas())erro('lease.changed');guard(etapa,dir);}});
  } finally {for(const l of proprias.reverse())if(JSON.stringify(lerLease(raiz,l.nome))===JSON.stringify(l))liberar(raiz,l.nome,t.id);}
}
export type RespostaShipMcp={ok:boolean;resultado?:ResultadoShip;erro?:string;cleanupConfirmado?:boolean};
/** Perfil não pode ser fabricado por argumentos JSON. Retorno interrompido exige reconciliação. */
export async function shipMcp(perfil:PerfilShipMcp,pedido:PedidoShipMcp,signal?:AbortSignal):Promise<RespostaShipMcp> {
  const f=perfis.get(perfil);if(!f)erro('profile.invalid');validar(pedido);
  if(signal?.aborted)return {ok:false,erro:'mcp.ship.cancelled'};
  return new Promise(resolve=>{
    const child=spawn('/usr/bin/python3',['-c',SUPERVISOR_SHIP],{env:f.env,stdio:['pipe','pipe','pipe']});
    let out='',falhou=false,fechou=false,inicio:string|undefined;
    const identity=()=>{try{const raw=fs.readFileSync(`/proc/${child.pid}/stat`,'utf8');return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];}catch{return undefined;}};
    const cancelar=()=>{falhou=true;if(!fechou && inicio && identity()===inicio)try{child.kill('SIGTERM');}catch{}};
    const timer=setTimeout(cancelar,PRAZO+5000);signal?.addEventListener('abort',cancelar,{once:true});if(signal?.aborted)cancelar();
    child.once('spawn',()=>{inicio=identity();if(!inicio || falhou){falhou=true;child.stdin.end();return;}child.stdin.end(JSON.stringify({bin:process.execPath,args:[__filename,'--worker'],cwd:f.raiz,env:f.env,timeoutMs:PRAZO,maxOutput:LIMITE,input:JSON.stringify({f,pedido})}));});
    child.stdin.on('error',()=>{falhou=true;});child.on('error',()=>{falhou=true;});
    child.stdout.on('data',(b:Buffer)=>{if(Buffer.byteLength(out)+b.length>LIMITE*4)cancelar();else out+=b.toString();});
    child.stderr.on('data',()=>{falhou=true;});
    child.on('close',(code,sig)=>{fechou=true;clearTimeout(timer);signal?.removeEventListener('abort',cancelar);
      let cleanupConfirmado=false;
      if(code===0 && !sig)try {const envelope=JSON.parse(out);cleanupConfirmado=envelope.cleanupConfirmed===true;
        if(!falhou && cleanupConfirmado && envelope.code===0 && envelope.failure===null && !envelope.stderr){const r=JSON.parse(envelope.stdout);if(typeof r.ok==='boolean')return resolve({...r,cleanupConfirmado});}}catch{}
      resolve({ok:false,cleanupConfirmado,erro:'mcp.ship.worker.incomplete: conferir processos, leases, HEAD e remoto antes de repetir'});
    });
  });
}
if(require.main===module && process.argv[2]==='--worker') {
  try {const raw=fs.readFileSync(0,'utf8');if(Buffer.byteLength(raw)>LIMITE)erro('request.invalid');const {f,pedido}=JSON.parse(raw);
    const resultado=executar(f,pedido);process.stdout.write(JSON.stringify({ok:resultado.ok,resultado}));}
  catch(e){const m=(e as Error).message;process.stdout.write(JSON.stringify({ok:false,erro:m.startsWith('mcp.')?m:'mcp.ship.operation.failed: conferir estado antes de repetir'}));}
}

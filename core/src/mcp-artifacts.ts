/** Documentos do agente, separados dos recibos oficiais do nucleo. Backend Linux como HITL. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {dirThread,lerThread,blocoDaThread} from './thread';
import {comLockHitl} from './hitl-gates';
import {adquirirRegiao,lerLease,leasesColidentes,liberar,podarRegioesDeThreadsFechadas} from './leases';
import {adicionarClaim,lerClaims} from './claims';
import {Fase} from './types';

export type DocumentoMcp='goal'|'plan'|'check';
const fases:Record<DocumentoMcp,Fase>={goal:'GOAL',plan:'PLAN',check:'CHECK'};
const limite=128*1024;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
/** Core legado usa nomes de arquivos: este preflight recusa links existentes, nao promete CAS contra writers hostis. */
export function validarArquivosEstadoMcp(raiz:string,id:string):void {
  validarId(id);
  for(const nome of ['thread.json','ledger.jsonl','claims.jsonl']) {
    let fd:number;
    try {fd=fs.openSync(path.join(dirThread(raiz,id),nome),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
    catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT' && nome!=='thread.json') continue;throw Error('mcp.state.unsafe');}
    try {const st=fs.fstatSync(fd);if(!st.isFile() || st.nlink!==1) throw Error('mcp.state.unsafe');}
    finally {fs.closeSync(fd);}
  }
}
function validarId(id:string) {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)) throw Error('mcp.artifact.thread.invalid');
}
function validarTipo(tipo:DocumentoMcp) {
  if(!Object.hasOwn(fases,tipo)) throw Error('mcp.artifact.kind.invalid');
}
/** Ancora cada componente existente com O_NOFOLLOW, inclusive docs. Nao segue link de worktree. */
function comDocs<T>(raiz:string,id:string,acao:(dir:string|null)=>T,criar=false):T {
  validarId(id);
  if(process.platform!=='linux') throw Error('runtime.unavailable: documentos MCP exigem descritores Linux');
  const canonico=path.resolve(raiz),destino=path.resolve(dirThread(canonico,id),'docs');
  const rel=path.relative(canonico,destino);
  if(rel.startsWith('..') || path.isAbsolute(rel)) throw Error('mcp.artifact.scope');
  const fds:number[]=[];
  try {
    let fd=fs.openSync(canonico,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);fds.push(fd);
    const partes=rel.split(path.sep);
    for(const [i,parte] of partes.entries()) {
      const alvo=`/proc/self/fd/${fd}/${parte}`;
      try {fd=fs.openSync(alvo,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);}
      catch(e) {
        if((e as NodeJS.ErrnoException).code!=='ENOENT' || i!==partes.length-1) throw e;
        if(!criar) return acao(null);
        fs.mkdirSync(alvo,{mode:0o700});
        fd=fs.openSync(alvo,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
      }
      fds.push(fd);
    }
    return acao(`/proc/self/fd/${fd}`);
  } finally {for(const fd of fds.reverse()) fs.closeSync(fd);}
}
function lerDocumento(file:string):Buffer|null {
  let fd:number;
  try {fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
  catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT') return null;throw Error('mcp.artifact.unsafe');}
  try {
    const st=fs.fstatSync(fd);
    if(!st.isFile() || st.nlink!==1 || st.size>limite) throw Error('mcp.artifact.unsafe');
    const bytes=fs.readFileSync(fd);
    if(bytes.length>limite) throw Error('mcp.artifact.too-large');
    return bytes;
  } finally {fs.closeSync(fd);}
}
function comEscrita<T>(raiz:string,id:string,executar:()=>T):T {
  validarId(id);
  validarArquivosEstadoMcp(raiz,id);
  // A mesma exclusao usada por despacho/HITL impede duas revisoes MCP simultaneas.
  return comLockHitl(raiz,id,()=>{
    validarArquivosEstadoMcp(raiz,id);
    const pastaLeases=path.join(raiz,'.orkastery','leases');
    const st=fs.lstatSync(pastaLeases,{throwIfNoEntry:false});
    if(st) {
      if(!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(pastaLeases)!==pastaLeases) throw Error('mcp.state.unsafe: leases');
      for(const nome of fs.readdirSync(pastaLeases)) {
        const entrada=path.join(pastaLeases,nome),s=fs.lstatSync(entrada,{throwIfNoEntry:false});
        if(!s) continue; // Uma retomada pode ter acabado durante o preflight.
        if(s.isDirectory() && nome.endsWith('.json.retomadas')) {
          const base=nome.slice(0,-'.json.retomadas'.length);
          if(!base || encodeURIComponent(decodeURIComponent(base))!==base) throw Error('mcp.state.unsafe: fila de retomada');
          let candidatos:string[];
          try {candidatos=fs.readdirSync(entrada);}
          catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT') continue;throw e;}
          for(const candidato of candidatos) {
            const c=fs.lstatSync(path.join(entrada,candidato),{throwIfNoEntry:false});
            if(!c) continue;
            if(!/^\d+-[a-f0-9-]+\.json(?:\.tmp)?$/.test(candidato) || !c.isFile() || c.nlink!==1)
              throw Error('mcp.state.unsafe: candidato de retomada');
          }
          continue;
        }
        if(!s.isFile() || s.isSymbolicLink() || s.nlink!==1) throw Error('mcp.state.unsafe: lease ou fila');
      }
    }
    const nome=`path:.orkastery/threads/${id}`;
    // RM-037 (fatia 3, defeito 4): lease e fila de thread fechada sao orfaos e saem antes da conferencia.
    podarRegioesDeThreadsFechadas(raiz,[nome],id);
    if(lerLease(raiz,nome) || leasesColidentes(raiz,nome).length) throw Error('lease.busy: estado canonico ocupado');
    const r=adquirirRegiao(raiz,nome,{thread:id,motivo:'MCP documento ou claim',ttlMs:30000,retomarVencido:false});
    if(!r.ok || !r.lease) throw Error('lease.busy: estado canonico ocupado');
    try {return executar();}
    finally {
      const atual=lerLease(raiz,nome);
      if(atual?.adquiridoEm===r.lease.adquiridoEm && atual.pid===r.lease.pid && atual.thread===id) liberar(raiz,nome,id);
    }
  });
}
export function lerArtefatoMcp(raiz:string,id:string,tipo:DocumentoMcp) {
  validarTipo(tipo);validarArquivosEstadoMcp(raiz,id);lerThread(raiz,id);
  return comDocs(raiz,id,dir=>{
    const bytes=dir?lerDocumento(path.join(dir,tipo+'.md')):null;
    return {tipo,arquivo:`docs/${tipo}.md`,sha256:bytes?hash(bytes):null,conteudo:bytes?.toString('utf8')??null};
  });
}
export function escreverArtefatoMcp(raiz:string,id:string,tipo:DocumentoMcp,conteudo:string,esperado:string|null) {
  validarTipo(tipo);validarId(id);
  if(typeof conteudo!=='string' || Buffer.byteLength(conteudo)>limite) throw Error('mcp.artifact.too-large');
  if(esperado!==null && !/^[a-f0-9]{64}$/.test(esperado)) throw Error('mcp.artifact.expected.invalid');
  // Valida a cadeia antes de qualquer lock/escrita no estado canônico.
  return comDocs(raiz,id,()=>comEscrita(raiz,id,()=>{
    const t=lerThread(raiz,id);
    if(t.status==='fechada' || !blocoDaThread(t,t.faseAtual).fases.includes(fases[tipo])) throw Error('mcp.artifact.phase');
    return comDocs(raiz,id,dir=>{
    if(!dir) throw Error('mcp.artifact.directory');
    const file=path.join(dir,tipo+'.md'),antes=lerDocumento(file);
    if((antes?hash(antes):null)!==esperado) throw Error('mcp.artifact.stale');
    const temp=path.join(dir,'.mcp-document-'+randomUUID());
    try {
      fs.writeFileSync(temp,conteudo,{flag:'wx',mode:0o600});
      const atual=lerDocumento(file);
      if((atual?hash(atual):null)!==esperado) throw Error('mcp.artifact.stale');
      fs.renameSync(temp,file);
    } finally {fs.rmSync(temp,{force:true});}
    return {tipo,arquivo:`docs/${tipo}.md`,sha256:hash(conteudo),autoria:'agente',reciboOficial:false};
    },true);
  }));
}
export function listarClaimsMcp(raiz:string,id:string) {
  return comDocs(raiz,id,()=>{validarArquivosEstadoMcp(raiz,id);lerThread(raiz,id);return lerClaims(raiz,id);});
}
export function adicionarClaimMcp(raiz:string,id:string,entrada:{arquivo:string;alegacao:string;verificar:string[]}) {
  validarId(id);
  if(!entrada.arquivo || entrada.arquivo.length>500 || path.isAbsolute(entrada.arquivo) ||
      entrada.arquivo.split(/[\\/]/).some(p=>!p || p==='..' || p==='.' || p==='.git')) throw Error('mcp.claim.path.invalid');
  if(!entrada.alegacao.trim() || entrada.alegacao.length>8192 || entrada.verificar.length>20 ||
      entrada.verificar.some(c=>typeof c!=='string' || !c.trim() || c.length>8192)) throw Error('mcp.claim.invalid');
  return comDocs(raiz,id,()=>comEscrita(raiz,id,()=>{
    if(lerThread(raiz,id).status==='fechada') throw Error('mcp.claim.closed');
    // Strings sao dados da claim; a reexecucao MCP deve usar o executor confinado.
    return adicionarClaim(raiz,id,entrada);
  }));
}

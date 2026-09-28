/** Commit estreito no núcleo instalado. Repositórios com hooks/helpers ficam
 * explicitamente indisponíveis; nenhum hook ou configuração é desativado. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { exigirManifesto } from './manifest';
import { lerThread, dirThread, blocoDaThread } from './thread';
import { lerClaims } from './claims';
import { branchDaWorktree } from './worktree';
import { validarArquivosEstadoMcp } from './mcp-artifacts';
import { comEstadoParaGit, auditarEstado, raizDoEstado } from './estado-thread';
import { adquirirRegiao, lerLease, liberar, leasesColidentes } from './leases';
import { registrar } from './ledger';
import { contratosTocados } from './contrato-publico';
import { cicloSemCheck } from './prova-minima';
import { Lease } from './types';

export interface PedidoCommitMcp { threadId: string; expectedHead: string; paths: string[]; mensagem: string }
export interface ResultadoCommitMcp { ok: boolean; commit: string | null; erro: string | null; estadoAuditado: boolean }
const GIT = '/usr/bin/git', LIMITE = 262144, TTL = 120000;
function falha(codigo: string): never { throw Error('mcp.git.' + codigo); }
function validar(p: PedidoCommitMcp): void {
  if (!p || typeof p !== 'object' || Object.keys(p).sort().join(',') !== 'expectedHead,mensagem,paths,threadId' ||
      typeof p.threadId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(p.threadId) ||
      typeof p.expectedHead !== 'string' || !/^[a-f0-9]{40}$/.test(p.expectedHead) ||
      typeof p.mensagem !== 'string' || !p.mensagem.trim() || p.mensagem.length > 2048 || /[\x00-\x08\x0b-\x1f\x7f]/.test(p.mensagem) ||
      !Array.isArray(p.paths) || !p.paths.length || p.paths.length > 32 || new Set(p.paths).size !== p.paths.length) falha('request.invalid');
  for (const f of p.paths) if (typeof f !== 'string' || !f || f.length > 512 || path.isAbsolute(f) ||
      path.normalize(f) !== f || /[\x00-\x1f\x7f\\]/.test(f) || f.split('/').some(x => !x || x === '.' || x === '..' ||
        ['.git','.orkastery','.codex','.agents','.claude'].includes(x) || x === '.env' || x.startsWith('.env.'))) falha('path.invalid');
}
function dentro(root: string, file: string): boolean { return file.startsWith(root + path.sep); }
/**
 * Confere que o caminho e fisicamente o que diz ser, dentro da worktree.
 *
 * I-43: um caminho AUSENTE passa, e so quando e arquivo. Sem isso o nucleo nao
 * conseguia commitar uma DELECAO pelo proprio transporte: `fs.lstatSync` estourava
 * antes do `git add`, e um GO que remove um arquivo ficava sem como entregar a
 * remocao. Foi exatamente o que travou a saida de `fx-objective-oscillation`.
 *
 * O buraco que isso poderia abrir esta fechado por tres lados:
 *   - `validar()` ja recusou `..`, caminho absoluto, `.git`, `.orkastery` e afins
 *     ANTES daqui, entao "ausente" nunca significa "fora do escopo";
 *   - `git add` recusa pathspec que nunca existiu, entao caminho inventado continua
 *     reprovando, so que com outra mensagem;
 *   - o `lstat` (que NAO segue symlink) continua sendo feito quando o caminho existe,
 *     entao symlink pendurado nao escapa pela porta do ausente: ele tem lstat valido,
 *     nao e arquivo regular, e cai em `path.unsafe` como antes.
 * E a selecao do indice e do commit continua conferida contra `p.paths` depois.
 */
function fisico(root: string, file: string, arquivo = false): void {
  if (file !== root && !dentro(root,file)) falha('scope.invalid');
  let s: fs.Stats;
  try {
    s = fs.lstatSync(file);
  } catch {
    if (arquivo) return;
    falha('path.unsafe');
  }
  if (fs.realpathSync(file) !== file) falha('path.symlink');
  if (arquivo ? !s.isFile() || s.nlink !== 1 : !s.isDirectory()) falha('path.unsafe');
}
function ambiente(env:NodeJS.ProcessEnv=process.env): NodeJS.ProcessEnv {
  // HOME preserva configurações efetivas do usuário; chaves desconhecidas recusam.
  // Variáveis GIT/SSH/GPG vindas do cliente não são transportadas ao worker.
  return { HOME: env.HOME, USER: env.USER, LOGNAME: env.LOGNAME,
    XDG_CONFIG_HOME:env.XDG_CONFIG_HOME, PATH:'/usr/bin:/bin', LANG:'C.UTF-8', TMPDIR:'/tmp' };
}
function git(wt: string, args: string[], input?: string): string {
  const r=spawnSync(GIT,['--no-pager','--literal-pathspecs',...args],{cwd:wt,env:ambiente(),
    encoding:'utf8',input,timeout:10000,killSignal:'SIGKILL',maxBuffer:LIMITE});
  if(r.status!==0 || r.signal || r.error) falha('command.failed');
  return r.stdout;
}
/** Lista positiva de configuração passiva. Não é blacklist de shell. */
function configPassiva(chave: string, valor: string, credenciaisInertes = false): boolean {
  if (credenciaisInertes && (chave==='credential.helper' || /^credential\..+\.helper$/.test(chave))) return valor.length<=8192 && !valor.includes('\0');
  // Definição não executa nada: a ausência de uso efetivo é provada abaixo.
  if (/^filter\.[a-zA-Z0-9._-]+\.(clean|smudge|process|required)$/.test(chave)) return valor.length<=8192 && !valor.includes('\0');
  if (['user.name','user.email'].includes(chave)) return !!valor.trim() && valor.length<=512 && !/[\x00-\x1f]/.test(valor);
  if (['core.filemode','core.logallrefupdates','core.ignorecase','core.precomposeunicode'].includes(chave)) return /^(true|false)$/.test(valor);
  if (chave==='core.repositoryformatversion') return valor==='0';
  if (['core.bare','commit.gpgsign','tag.gpgsign','core.fsmonitor'].includes(chave)) return valor==='false';
  if (chave==='core.autocrlf') return ['true','false','input'].includes(valor);
  if (chave==='core.eol') return ['lf','crlf','native'].includes(valor);
  if (chave==='init.defaultbranch') return /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(valor);
  if (/^remote\.[a-zA-Z0-9._-]+\.(url|fetch)$/.test(chave) || /^branch\.[a-zA-Z0-9._/-]+\.(remote|merge)$/.test(chave))
    return valor.length<=2048 && !/[\x00-\x1f]/.test(valor);
  return false;
}
/** Metadados graváveis pelo Git/API não podem redirecionar escrita para fora. */
function arvoreMetadados(root:string,alvo:string):void {
  if(!fs.lstatSync(alvo,{throwIfNoEntry:false}))return;
  let vistos=0;
  const visitar=(f:string,profundidade:number)=>{
    if(++vistos>8192 || profundidade>32)falha('metadata.unsupported');
    const st=fs.lstatSync(f);
    if(st.isSymbolicLink() || (!st.isDirectory() && (!st.isFile() || st.nlink!==1)))falha('metadata.unsafe');
    if(f!==root && !dentro(root,f))falha('metadata.unsafe');
    if(st.isDirectory())for(const n of fs.readdirSync(f))visitar(path.join(f,n),profundidade+1);
  };
  if(fs.realpathSync(alvo)!==alvo)falha('metadata.unsafe');visitar(alvo,0);
}
/** Cobre também refresh do índice e checkout/diff internos da API de estado.
 * --cached e worktree devem concordar na ausência de filtros, sem executar driver.
 * Não suporta .gitattributes materializado pela API: a ordem de checkout poderia
 * produzir um estado intermediário diferente dos dois snapshots verificados. */
function atributosPassivos(wt:string,id:string,selecionados:string[]):string {
  const index=git(wt,['ls-files','--stage','-z']).split('\0').filter(Boolean);
  if(index.some(entry=>entry.startsWith('160000 ')))falha('execution-profile.unsupported: gitlinks');
  const tracked=git(wt,['ls-files','-z']).split('\0').filter(Boolean);
  const prefixo=`.orkastery/threads/${id}/`;
  if(tracked.some(f=>f.startsWith(prefixo) && path.posix.basename(f)==='.gitattributes'))falha('execution-profile.unsupported: atributos de estado materializaveis');
  const nomes=[...new Set([...tracked,...selecionados])].sort();
  if(nomes.length>4096 || nomes.some(f=>!f || f.includes('\0')))falha('execution-profile.unsupported: inventario de atributos');
  const input=nomes.join('\0')+'\0',resultados:string[]=[];
  for(const cached of [false,true]) {
    const raw=git(wt,['check-attr',...(cached?['--cached']:[]),'-z','--stdin','filter'],input);
    const partes=raw.split('\0');
    if(partes.pop()!=='' || partes.length!==nomes.length*3)falha('execution-profile.unsupported: atributos inconclusivos');
    for(let i=0;i<nomes.length;i++)if(partes[i*3]!==nomes[i] || partes[i*3+1]!=='filter' || !['unspecified','unset'].includes(partes[i*3+2]))
      falha('execution-profile.unsupported: filtro efetivo preservado');
    resultados.push(raw);
  }
  return resultados.join('\0');
}
function perfil(wt: string, comum: string, gitdir: string,id:string,selecionados:string[]): string {
  fisico(path.dirname(comum),comum); fisico(comum,gitdir);
  for(const nome of ['objects','refs','logs','info'])arvoreMetadados(comum,path.join(comum,nome));
  for(const nome of ['index','logs','refs'])arvoreMetadados(gitdir,path.join(gitdir,nome));
  const estado=path.join(path.dirname(comum),'.orkastery');
  for(const nome of ['leases','state-backups']) {const f=path.join(estado,nome);if(fs.lstatSync(f,{throwIfNoEntry:false}))fisico(estado,f);}
  arvoreMetadados(estado,path.join(estado,'leases'));
  for(const nome of ['packed-refs','shallow'])arvoreMetadados(comum,path.join(comum,nome));
  const alternates=path.join(comum,'objects/info/alternates');
  if(fs.existsSync(alternates) && fs.statSync(alternates).size)falha('metadata.unsupported: alternates');
  for (const base of [comum,gitdir]) {
    for (const nome of ['config','config.worktree','commondir','HEAD']) {
      const f=path.join(base,nome); if(fs.existsSync(f)) fisico(base,f,true);
    }
    const hooks=path.join(base,'hooks');
    if (fs.lstatSync(hooks,{throwIfNoEntry:false})) {
      fisico(base,hooks);
      for(const nome of fs.readdirSync(hooks)) {
        const f=path.join(hooks,nome),s=fs.lstatSync(f);
        if(!s.isFile() || s.isSymbolicLink() || (!nome.endsWith('.sample') && (s.mode&0o111)!==0)) falha('execution-profile.unsupported: hooks preservados');
      }
    }
  }
  const raw=git(wt,['config','--null','--list']);
  for(const item of raw.split('\0').filter(Boolean)) {
    const i=item.indexOf('\n'); if(i<0 || !configPassiva(item.slice(0,i).toLowerCase(),item.slice(i+1),true)) falha('execution-profile.unsupported: configuracao preservada');
  }
  const atributos=atributosPassivos(wt,id,selecionados);
  return createHash('sha256').update(raw).update('\0').update(atributos).digest('hex');
}
/** Consulta local e passiva; os HEADs sao observacoes, nunca autorizacao ou reserva. */
export function estadoGitMcp(raiz:string,threadId:string) {
  if(!path.isAbsolute(raiz) || fs.realpathSync(raiz)!==raiz ||
      typeof threadId!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId))falha('request.invalid');
  const c=exigirManifesto(raiz);if(c.raiz!==raiz)falha('project.invalid');
  fisico(raiz,dirThread(raiz,threadId));validarArquivosEstadoMcp(raiz,threadId);
  const t=lerThread(raiz,threadId),wt=t.worktree;
  if(t.id!==threadId || !wt || wt===raiz)falha('thread.worktree.required');
  fisico(raiz,wt);
  const marcador=path.join(wt,'.git');fisico(wt,marcador,true);
  const match=/^gitdir: (.+)\s*$/.exec(fs.readFileSync(marcador,'utf8'));if(!match)falha('worktree.invalid');
  const comum=path.join(raiz,'.git'),gitdir=path.resolve(wt,match![1].trim());
  perfil(wt,comum,gitdir,t.id,[]);
  if(raizDoEstado(wt)!==raiz)falha('worktree.invalid');
  const branch=branchDaWorktree(t),destino=c.manifesto.worktree.base_branch;
  if(git(wt,['symbolic-ref','--quiet','--short','HEAD']).trim()!==branch)falha('branch.invalid');
  const head=git(wt,['rev-parse','--verify','HEAD']).trim();
  const source=git(raiz,['rev-parse','--verify','--end-of-options',`refs/heads/${branch}`]).trim();
  const destination=git(raiz,['rev-parse','--verify','--end-of-options',`refs/heads/${destino}`]).trim();
  if(head!==source || ![source,destination].every(x=>/^[a-f0-9]{40}$/.test(x)))falha('head.invalid');
  return {threadId,source:{branch,head:source},destination:{branch:destino,head:destination},
    scope:'local-only' as const,observedAt:new Date().toISOString()};
}

/** Somente o worker dedicado chama este corpo; não altera env do servidor. */
function executar(raiz: string,p: PedidoCommitMcp): ResultadoCommitMcp {
  const proprias: Lease[]=[]; let commit: string|null=null, estadoAuditado=false;
  try {
    validar(p); if(!path.isAbsolute(raiz) || fs.realpathSync(raiz)!==raiz || exigirManifesto(raiz).raiz!==raiz) falha('project.invalid');
    fisico(raiz,dirThread(raiz,p.threadId));validarArquivosEstadoMcp(raiz,p.threadId);
    const t=lerThread(raiz,p.threadId),wt=t.worktree;
    if(!wt || t.status==='fechada' || !blocoDaThread(t,t.faseAtual).fases.includes('GO') || wt===raiz) falha('thread.invalid');
    // I-42 (D7): ciclo sem PLAN nem CHECK nao commita contrato publico; a mudanca vira iniciativa.
    if(cicloSemCheck(t) && contratosTocados(p.paths).length) falha('contract.protected');
    fisico(raiz,wt); fisico(raiz,dirThread(raiz,t.id));
    const marcador=path.join(wt,'.git');fisico(wt,marcador,true);
    const match=/^gitdir: (.+)\s*$/.exec(fs.readFileSync(marcador,'utf8'));
    if(!match) falha('worktree.invalid');
    const comum=path.join(raiz,'.git'),gitdir=path.resolve(wt,match![1].trim());
    fisico(comum,gitdir);
    if(raizDoEstado(wt)!==raiz) falha('worktree.invalid');
    const originalPerfil=perfil(wt,comum,gitdir,t.id,p.paths);
    const conferir=() => {
      validarArquivosEstadoMcp(raiz,t.id);
      if(perfil(wt,comum,gitdir,t.id,p.paths)!==originalPerfil) falha('execution-profile.changed');
      if(git(wt,['rev-parse','HEAD']).trim()!==p.expectedHead) falha('head.stale');
      if(git(wt,['symbolic-ref','--quiet','--short','HEAD']).trim()!==branchDaWorktree(t)) falha('branch.invalid');
      for(const nome of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply'])
        if(fs.existsSync(path.join(gitdir,nome))) falha('operation.in-progress');
      const claims=lerClaims(raiz,t.id);
      for(const f of p.paths) {
        fisico(wt,path.join(wt,f),true);
        if(!claims.some(c=>c.estado!=='retirada' && c.arquivo===f && c.verificar.length>0)) falha('claim.missing');
      }
    };
    conferir();
    if(git(wt,['diff','--cached','--name-only','-z']).length) falha('index.not-empty');
    const regioes=[`worktree-write:${t.id}`,...p.paths.map(f=>'path:'+f)];
    for(const nome of regioes) {
      if(lerLease(raiz,nome) || leasesColidentes(raiz,nome).length) falha('lease.busy');
      const r=adquirirRegiao(raiz,nome,{thread:t.id,motivo:'MCP git_commit delimitado',ttlMs:TTL,retomarVencido:false});
      if(!r.ok || !r.lease) falha('lease.busy');
      proprias.push(r.lease!);
    }
    conferir(); if(git(wt,['diff','--cached','--name-only','-z']).length) falha('index.not-empty');
    comEstadoParaGit(raiz,t.id,wt,()=>{
      conferir();
      git(wt,['add','--',...p.paths]);
      const staged=git(wt,['diff','--cached','--name-only','-z']).split('\0').filter(Boolean).sort();
      if(!staged.length || staged.some(f=>!p.paths.includes(f))) falha('index.selection');
      conferir();
      git(wt,['commit','-m',p.mensagem,'--',...p.paths]);
      commit=git(wt,['rev-parse','HEAD']).trim();
    });
    if(perfil(wt,comum,gitdir,t.id,p.paths)!==originalPerfil) falha('execution-profile.changed');
    estadoAuditado=auditarEstado(raiz,t.id,wt).nivel==='ok';
    if(!estadoAuditado) falha('state.audit-failed');
    if(!commit || git(wt,['rev-parse','HEAD^']).trim()!==p.expectedHead) falha('commit.parent-invalid');
    const alterados=git(wt,['diff-tree','--no-commit-id','--name-only','-r','-z',commit]).split('\0').filter(Boolean);
    if(!alterados.length || alterados.some(f=>!p.paths.includes(f))) falha('commit.paths-invalid');
    registrar(dirThread(raiz,t.id),t.id,'mcp_git_committed',{commit,paths:alterados,origem:'mcp.git',estadoAuditado});
    return {ok:true,commit,erro:null,estadoAuditado};
  } catch(e) {
    const mensagem=(e as Error).message;
    return {ok:false,commit,erro:mensagem.startsWith('mcp.git.')?mensagem:'mcp.git.operation.failed: estado e indice preservados',estadoAuditado};
  } finally {
    for(const l of proprias.reverse()) if(JSON.stringify(lerLease(raiz,l.nome))===JSON.stringify(l)) liberar(raiz,l.nome,l.thread);
  }
}
/** Entrada do servidor: argumentos nunca escolhem executável/env/cwd/opções Git. */
export async function commitMcp(raiz: string,pedido: PedidoCommitMcp,signal?: AbortSignal): Promise<ResultadoCommitMcp> {
  validar(pedido);
  if(signal?.aborted) return {ok:false,commit:null,erro:'mcp.git.cancelled',estadoAuditado:false};
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[__filename,'--worker'],{env:ambiente(),detached:true,stdio:['pipe','pipe','pipe']});
    let stdout='',erro=false,fechou=false,inicio:string|undefined;
    const identidade=()=>{try {const st=fs.readFileSync(`/proc/${child.pid}/stat`,'utf8');return st.slice(st.lastIndexOf(')')+2).split(' ')[19];}catch{return undefined;}};
    const terminar=()=>{erro=true;if(!fechou && inicio && identidade()===inicio) {try{process.kill(-child.pid!,'SIGKILL');}catch{}}};
    child.once('spawn',()=>{inicio=identidade();if(!inicio){erro=true;child.stdin.end();return;}child.stdin.end(JSON.stringify({raiz,pedido}));});
    child.stdin.on('error',()=>{erro=true;});
    child.on('error',()=>{erro=true;});
    child.stdout.on('data',(b:Buffer)=>{if(Buffer.byteLength(stdout)+b.length>LIMITE) terminar();else stdout+=b.toString();});
    child.stderr.on('data',()=>{erro=true;});
    signal?.addEventListener('abort',terminar,{once:true});const timer=setTimeout(terminar,45000);
    child.on('close',(code,signalExit)=>{fechou=true;if(code!==0 || signalExit)erro=true;clearTimeout(timer);signal?.removeEventListener('abort',terminar);
      if(!erro)try {const r=JSON.parse(stdout) as ResultadoCommitMcp;if(typeof r.ok==='boolean' && (r.commit===null || /^[a-f0-9]{40}$/.test(r.commit)))return resolve(r);}catch{}
      resolve({ok:false,commit:null,erro:'mcp.git.worker.incomplete: conferir HEAD, indice e leases antes de repetir',estadoAuditado:false});
    });
  });
}
if(require.main===module && process.argv[2]==='--worker') {
  try {const raw=fs.readFileSync(0,'utf8');if(Buffer.byteLength(raw)>LIMITE)falha('request.invalid');
    const p=JSON.parse(raw) as {raiz:string;pedido:PedidoCommitMcp};process.stdout.write(JSON.stringify(executar(p.raiz,p.pedido)));}
  catch {process.stdout.write(JSON.stringify({ok:false,commit:null,erro:'mcp.git.worker.invalid',estadoAuditado:false}));}
}

/** Guards internos compartilhados: não expõem opções ao cliente MCP. */
export { perfil as perfilGitMcp, git as gitPassivoMcp, fisico as caminhoFisicoGitMcp, arvoreMetadados as metadadosGitMcp, configPassiva as configuracaoPassivaGitMcp, ambiente as ambienteGitMcp };

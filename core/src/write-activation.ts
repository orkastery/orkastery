/** Publicacao e rebuild nao concedem escrita. Ativacao e recibo local explicito, escopado e reversivel. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ManifestoCarregado } from './manifest';
import { raizDoEstado } from './estado-thread';
import { exigirEscopoDeEscrita, validarDiretorioDeThread } from './escopo-escrita';
import { lerThread } from './thread';
import { lerLease, expirado } from './leases';

export type PerfilPublicacao = 'fabrica' | 'integral';
export interface PlanoAtivacao {
  schema: 'ork.write-activation-plan/v1'; raiz: string; projeto: string; tenant: string;
  head: string; runtimeSha256: string; manifestoSha256: string; anteriorSha256: string;
  threads: string[]; alvos: ('pulse' | 'memory')[]; perfil: PerfilPublicacao;
}
export interface EstadoAtivacao {
  ativa: boolean; motivo: string; plano: PlanoAtivacao | null; recibo: string | null;
}
export const hashAtivacao = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const json = (v: unknown) => JSON.stringify(v) + '\n';
const dir = (c: ManifestoCarregado) => path.join(raizDoEstado(c.raiz), '.orkastery/monitor');
const statePath = (c: ManifestoCarregado) => path.join(dir(c), 'write-activation.json');
const bytesEstado = (c: ManifestoCarregado) => fs.lstatSync(statePath(c),{throwIfNoEntry:false}) ? lerPrivado(statePath(c)) : '';
const head = (c: ManifestoCarregado) => execFileSync('git', ['rev-parse', 'HEAD'], {cwd: c.raiz, encoding:'utf8'}).trim();
/** Extensoes efetivas do runtime instalado. Fora delas nada e executado nem carregado. */
const EXTENSOES_RUNTIME=/\.(js|cjs|mjs|py|json|sh)$/;
const RUNTIME_PROFUNDIDADE_MAX=8, RUNTIME_ARQUIVOS_MAX=4000;
/** Artefato temporario ou de build de teste nao e runtime efetivo e nao entra no hash. */
const ignoradoNoRuntime=(nome: string)=>nome.startsWith('.') || nome.includes('.test.') ||
  /(~|\.tmp|\.swp|\.orig|\.rej|\.bak)$/.test(nome) || nome==='node_modules' || nome==='__pycache__';
/**
 * Varredura recursiva estavel dos arquivos efetivos do runtime instalado: inclusao, alteracao ou
 * remocao em qualquer nivel muda o hash. Link simbolico, dispositivo, socket, profundidade acima de
 * RUNTIME_PROFUNDIDADE_MAX e total acima de RUNTIME_ARQUIVOS_MAX recusam em vez de serem ignorados,
 * com ou sem extensao de runtime; o caminho relativo entra no hash, entao mover arquivo tambem muda.
 */
function arquivosDoRuntime(raiz: string, prefixo=''): [string, string][] {
  if(prefixo.split('/').length>RUNTIME_PROFUNDIDADE_MAX) throw Error('write.activation.runtime-invalid');
  const encontrados: [string,string][]=[];
  for(const nome of fs.readdirSync(raiz).filter(n=>!ignoradoNoRuntime(n)).sort()) {
    const file=path.join(raiz,nome), relativo=prefixo+nome, st=fs.lstatSync(file);
    // A classificacao vem antes do filtro de extensao: um link chamado `adapters` nao pode
    // escapar da recusa so por nao ter extensao de runtime.
    if(st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) throw Error('write.activation.runtime-invalid');
    if(st.isDirectory()) { encontrados.push(...arquivosDoRuntime(file,relativo+'/')); continue; }
    if(!EXTENSOES_RUNTIME.test(nome)) continue;
    encontrados.push([relativo,file]);
  }
  return encontrados;
}
/** Bytes do runtime, ponte e launcher instalados; HEAD do projeto sozinho nao identifica o pacote. */
export function hashRuntimeAtivacao(): string {
  const assets=[path.join(__dirname,'../assets'),path.join(__dirname,'../../assets')].find(p=>fs.existsSync(p));
  const monitor=[path.join(__dirname,'../monitor'),path.join(__dirname,'../../monitor'),path.join(__dirname,'../../../monitor')].find(p=>fs.existsSync(path.join(p,'varredura-pulse.sh')));
  const schemas=[path.join(__dirname,'../schemas'),path.join(__dirname,'../../schemas')].find(p=>fs.existsSync(p));
  const hash=createHash('sha256');let total=0;
  for(const [label,directory] of [['runtime',__dirname],['assets',assets],['monitor',monitor],['schemas',schemas]] as const) {
    if(!directory) throw Error('write.activation.runtime-incomplete');
    const arquivos=arquivosDoRuntime(directory);
    if((total+=arquivos.length)>RUNTIME_ARQUIVOS_MAX) throw Error('write.activation.runtime-invalid');
    hash.update(label+':'+arquivos.length+'\0');
    for(const [relativo,file] of arquivos) {
      const bytes=fs.readFileSync(file);
      hash.update(label+'/'+relativo+'\0'+bytes.length+'\0');hash.update(bytes);hash.update('\0');
    }
  }
  return hash.digest('hex');
}
const manifestoHash = (c: ManifestoCarregado) => hashAtivacao(JSON.stringify(c.manifesto));

export function lerPrivado(file: string): string {
  // O_NOFOLLOW recusa link pendurado com erro do sistema; a recusa vira tipada e nunca mostra corpo.
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch { throw Error('write.activation.artifact-invalid'); }
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o600) throw Error('write.activation.artifact-invalid');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
function contexto(c: ManifestoCarregado, plano: PlanoAtivacao): void {
  if (plano.schema !== 'ork.write-activation-plan/v1' || plano.raiz !== raizDoEstado(c.raiz) ||
      plano.projeto !== c.manifesto.project.name || plano.tenant !== (c.manifesto.memory.tenant || c.manifesto.project.name) ||
      plano.head !== head(c) || plano.runtimeSha256 !== hashRuntimeAtivacao() || plano.manifestoSha256 !== manifestoHash(c) ||
      !['fabrica','integral'].includes(plano.perfil) || !Array.isArray(plano.alvos) || !plano.alvos.length ||
      plano.alvos.some(a => !['pulse','memory'].includes(a)) || new Set(plano.alvos).size !== plano.alvos.length ||
      !Array.isArray(plano.threads) || new Set(plano.threads).size !== plano.threads.length)
    throw Error('write.activation.plan-context');
  const escopo = exigirEscopoDeEscrita(plano.threads);
  for (const id of escopo) {
    validarDiretorioDeThread(c.raiz,id);
    if (lerThread(c.raiz,id).projeto.name !== c.manifesto.project.name) throw Error('memory.tenant.mismatch');
  }
}
export function prepararAtivacao(c: ManifestoCarregado, threads: string[], alvos: PlanoAtivacao['alvos'], perfil: PerfilPublicacao): PlanoAtivacao {
  const plano: PlanoAtivacao = {schema:'ork.write-activation-plan/v1',raiz:raizDoEstado(c.raiz),
    projeto:c.manifesto.project.name,tenant:c.manifesto.memory.tenant || c.manifesto.project.name,
    head:head(c),runtimeSha256:hashRuntimeAtivacao(),manifestoSha256:manifestoHash(c),anteriorSha256:hashAtivacao(bytesEstado(c)),threads,alvos,perfil};
  contexto(c,plano);return plano;
}
function leases(c: ManifestoCarregado, operadora: string) {
  validarDiretorioDeThread(c.raiz,operadora);
  return ['path:.orkastery/monitor','worktree-write:'+operadora].map(nome => {
    const lease=lerLease(raizDoEstado(c.raiz),nome);
    if (!lease || lease.thread !== operadora || expirado(lease)) throw Error('write.activation.lease-required');
    return lease;
  });
}
function gravarEstado(c: ManifestoCarregado, operadora: string, por: string, anterior: string, corpo: Record<string,unknown>) {
  if (!/^[a-zA-Z0-9.:_-]{1,100}$/.test(por)) throw Error('write.activation.actor-required');
  const provasLeases=leases(c,operadora);
  fs.mkdirSync(dir(c),{recursive:true});
  if (fs.realpathSync(dir(c)) !== dir(c)) throw Error('write.activation.state-location');
  const lock=path.join(dir(c),'write-activation.lock');
  const fd=fs.openSync(lock,'wx',0o600);
  try {
    if (hashAtivacao(bytesEstado(c)) !== anterior) throw Error('write.activation.state-conflict');
    const recibo={schema:'ork.write-activation-receipt/v1',id:randomUUID(),quando:new Date().toISOString(),
      operadora,por,leases:provasLeases,anteriorSha256:anterior,...corpo};
    const receipts=path.join(dir(c),'write-activation-receipts');fs.mkdirSync(receipts,{recursive:true,mode:0o700});
    if (fs.realpathSync(receipts)!==receipts) throw Error('write.activation.state-location');
    const file=path.join(receipts,recibo.id+'.json'),raw=json(recibo);
    fs.writeFileSync(file,raw,{mode:0o600,flag:'wx'});
    const state=json({schema:'ork.write-activation-state/v1',recibo:recibo.id,sha256:hashAtivacao(raw)});
    const tmp=statePath(c)+'.'+recibo.id;fs.writeFileSync(tmp,state,{mode:0o600,flag:'wx'});fs.renameSync(tmp,statePath(c));
    return {recibo:file,sha256:hashAtivacao(raw),ativa:corpo.ativa===true};
  } finally { fs.closeSync(fd);fs.unlinkSync(lock); }
}
export function ativarEscrita(c: ManifestoCarregado, op: {
  planoJson: string; planoSha256: string; aceiteJson: string; aceiteSha256: string; operadora: string; por: string;
}) {
  if (hashAtivacao(op.planoJson)!==op.planoSha256 || hashAtivacao(op.aceiteJson)!==op.aceiteSha256)
    throw Error('write.activation.hash-mismatch');
  const plano=JSON.parse(op.planoJson) as PlanoAtivacao,aceite=JSON.parse(op.aceiteJson);
  contexto(c,plano);
  if (!plano.threads.includes(op.operadora)) throw Error('scope.thread.unauthorized');
  if (aceite.schema!=='ork.write-acceptance/v1' || aceite.aprovado!==true || aceite.fase!=='CHECK' ||
      typeof aceite.revisor!=='string' || !aceite.revisor.trim() || aceite.planoSha256!==op.planoSha256 ||
      aceite.head!==plano.head || aceite.tenant!==plano.tenant || aceite.perfil!==plano.perfil)
    throw Error('write.activation.acceptance-required');
  return gravarEstado(c,op.operadora,op.por,plano.anteriorSha256,
    {ativa:true,plano,planoSha256:op.planoSha256,planoJson:op.planoJson,aceite,aceiteSha256:op.aceiteSha256,aceiteJson:op.aceiteJson});
}
export function desativarEscrita(c: ManifestoCarregado, operadora: string, por: string, anteriorSha256: string) {
  return gravarEstado(c,operadora,por,anteriorSha256,{ativa:false,rollback:true,
    anterior:JSON.parse(bytesEstado(c) || 'null')});
}
export function lerAtivacao(c: ManifestoCarregado): EstadoAtivacao {
  if (!fs.lstatSync(statePath(c),{throwIfNoEntry:false}))
    return {ativa:false,motivo:'write.activation.inactive',plano:null,recibo:null};
  const state=JSON.parse(lerPrivado(statePath(c)));
  if (state.schema!=='ork.write-activation-state/v1' || !/^[a-f0-9-]{36}$/.test(state.recibo)) throw Error('write.activation.state-invalid');
  const filename=path.join(dir(c),'write-activation-receipts',state.recibo+'.json');
  const raw=lerPrivado(filename),recibo=JSON.parse(raw);
  if (hashAtivacao(raw)!==state.sha256 || recibo.schema!=='ork.write-activation-receipt/v1') throw Error('write.activation.receipt-invalid');
  if (recibo.ativa===false) return {ativa:false,motivo:'write.activation.disabled',plano:null,recibo:filename};
  if (recibo.ativa!==true || hashAtivacao(recibo.planoJson)!==recibo.planoSha256 ||
      hashAtivacao(recibo.aceiteJson)!==recibo.aceiteSha256 ||
      json(JSON.parse(recibo.planoJson))!==json(recibo.plano) || json(JSON.parse(recibo.aceiteJson))!==json(recibo.aceite))
    throw Error('write.activation.receipt-invalid');
  if (recibo.aceite.schema!=='ork.write-acceptance/v1' || recibo.aceite.aprovado!==true ||
      recibo.aceite.fase!=='CHECK' || typeof recibo.aceite.revisor!=='string' || !recibo.aceite.revisor.trim() ||
      recibo.aceite.planoSha256!==recibo.planoSha256 || recibo.aceite.head!==recibo.plano.head ||
      recibo.aceite.tenant!==recibo.plano.tenant || recibo.aceite.perfil!==recibo.plano.perfil)
    throw Error('write.activation.acceptance-required');
  contexto(c,recibo.plano);
  return {ativa:true,motivo:'write.activation.enabled',plano:recibo.plano,recibo:filename};
}
/** Codigo tipado do proprio contrato; qualquer outra mensagem vira estado invalido sem detalhe. */
const MOTIVO_TIPADO = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;
/**
 * Diagnostico de leitura, nunca concessao. Quando plano, contexto ou aceite deixam de valer, o
 * estado sai como inativo com motivo tipado e com o `estadoSha256` do estado privado validamente
 * lido, que e o hash exigido pelo `disable`. Toda escrita continua recusada por `exigirAtivacao`.
 * Estado ilegivel, inseguro ou fora do modo privado continua recusando, sem revelar corpo.
 */
export function diagnosticarAtivacao(c: ManifestoCarregado): EstadoAtivacao & { estadoSha256: string } {
  const estadoSha256 = hashAtivacao(bytesEstado(c));
  try { return {...lerAtivacao(c),estadoSha256}; }
  catch (erro) {
    const motivo=(erro as Error).message;
    return {ativa:false,motivo:MOTIVO_TIPADO.test(motivo)?motivo:'write.activation.state-invalid',
      plano:null,recibo:null,estadoSha256};
  }
}
export function exigirAtivacao(c: ManifestoCarregado, thread: string, alvo: 'pulse'|'memory'): PlanoAtivacao {
  const a=lerAtivacao(c);
  if (!a.ativa || !a.plano) throw Error(a.motivo);
  if (!a.plano.threads.includes(thread) || !a.plano.alvos.includes(alvo)) throw Error('write.activation.scope-denied');
  return a.plano;
}

/** CLI separado da escrita de dados. Nenhum enable implicito em plan, status ou build. */
export function comandoAtivacao(c: ManifestoCarregado, args: {posicionais:string[];opcoes:Record<string,string|boolean>}): number {
  const sub=args.posicionais[1], get=(k:string)=>typeof args.opcoes[k]==='string'?args.opcoes[k] as string:'';
  if (sub==='status') { console.log(json(diagnosticarAtivacao(c)).trim());return 0; }
  if (sub==='plan') {
    const plano=prepararAtivacao(c,get('escopo').split(','),get('alvos').split(',') as PlanoAtivacao['alvos'],get('perfil') as PerfilPublicacao);
    const raw=json(plano);fs.writeFileSync(get('saida'),raw,{mode:0o600,flag:'wx'});
    console.log(json({arquivo:get('saida'),sha256:hashAtivacao(raw),ativa:false,exige:'aceite CHECK explicito para este hash'}).trim());return 0;
  }
  if (sub==='enable') {
    console.log(json(ativarEscrita(c,{planoJson:lerPrivado(get('plano')),planoSha256:get('plano-sha256'),
      aceiteJson:lerPrivado(get('aceite')),aceiteSha256:get('aceite-sha256'),operadora:get('operadora'),por:get('por')})).trim());return 0;
  }
  if (sub==='disable') {console.log(json(desativarEscrita(c,get('operadora'),get('por'),get('estado-sha256'))).trim());return 0;}
  throw Error('uso: ork activation plan|status|enable|disable');
}

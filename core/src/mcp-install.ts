/** Configuracao MCP local ao projeto. Copiar configuracao nao concede confianca ao cliente. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';
import { exigirManifesto } from './manifest';
import { TRANSPORTES_SHIP_MCP, ehTransporteFixado, ehTransporteShipMcp, type TransporteShipMcp } from './mcp-transportes';
import {
  dirDaFixacao, fixacaoInstalada, gravarFixacao, originUnicoMcp, prepararFixacao, proporTransporte, sondasPadraoDoTransporte, textoDaFixacao,
  type FixacaoPreparada, type SondasDoTransporte,
} from './mcp-ship-transporte';
import { msg } from './locale';

export { TRANSPORTES_SHIP_MCP };
export type { TransporteShipMcp };
const IMPRESSAO_SSH = /^SHA256:[A-Za-z0-9+/]{43}$/;
export type PermissoesDonoMcp = 'interactive' | 'orchestrate';
export const TOOLS_DONO_CODEX = ['ork_thread_new','ork_phase_run','ork_request_decision'] as const;
// RM-037 (rm037defeito, defeito 1): a decisao autonoma da sessao entra com as outras mutacoes do filho;
// sem o grant, o codex com approval_policy never recusaria a chamada.
export const TOOLS_FILHO_CODEX = ['ork_artifact_write','ork_claim_add','ork_decision_record','ork_git_commit','ork_verify','ork_verify_status','ork_ship'] as const;
// Brain mutation tools are deliberately excluded from the existing opt-in bundle.
// A native integration must request exact startup grants plus scoped activation.
export { BRAIN_READ_TOOLS, BRAIN_WRITE_TOOLS } from './company-brain-mcp';
/** Caminho de sessao, nunca credencial. O cliente resolve o valor no ambiente ao iniciar o MCP. */
export const ENV_VARS_CODEX_MCP = ['CODEX_HOME'] as const;
export type PermissoesFilhoMcp = 'interactive' | 'worktree';
/**
 * RM-067 (F4b, G10): os hosts do MCP do projeto. O `grok` grava a entrada como o codex, em TOML, e o servidor dele so
 * serve a sessao filha vinculada a uma thread (`--thread`, gravado pelo despacho na config da worktree).
 */
export type HostMcp = 'claude-code' | 'codex' | 'grok';
export const HOSTS_MCP: readonly HostMcp[] = ['claude-code', 'codex', 'grok'];
/** O arquivo do projeto onde cada host le a entrada `orkastery`; o codex e o grok usam TOML com `mcp_servers`. */
export function arquivoDoHostMcp(raiz: string, host: HostMcp): string {
  return host === 'claude-code' ? path.join(raiz, '.mcp.json') : path.join(raiz, host === 'codex' ? '.codex' : '.grok', 'config.toml');
}
export interface OpcoesInstalacaoMcp {
  projeto: string;
  host: HostMcp;
  dryRun?: boolean;
  transporteShip?: TransporteShipMcp;
  permissoesFilho?: PermissoesFilhoMcp;
  permissoesDono?: PermissoesDonoMcp;
  /** `SHA256:...` da chave do servidor, conferida pela pessoa fora do ork; so com `forja-ssh`. */
  impressaoSsh?: string;
  /** As sondas do transporte fixado; sem valor, as de verdade (rede, CLI da forja e o known_hosts da pessoa). */
  sondasDoTransporte?: SondasDoTransporte;
}
export interface ResultadoInstalacaoMcp {
  arquivo: string;
  estado: 'novo' | 'atualizado' | 'igual';
  dryRun: boolean;
  ativacao: 'pendente-no-cliente';
  /** O que a instalacao fixou ou propoe para o SHIP, ja no texto da pessoa. */
  transporte?: string[];
}
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('mcp.install.config.invalid: objeto esperado');
  return v as Record<string, unknown>;
}
/** Consentimento de invocacao somente: nao responde gates nem altera sandbox. */
export function validarGrantsCodex(entrada: Record<string,unknown>, nomes: readonly string[]): Record<string,Record<string,unknown>> {
  const conflito=()=>{throw Error('mcp.permissions.conflict: politica existente restringe ferramentas; configuracao preservada');};
  if(entrada.enabled!==undefined && entrada.enabled!==true) conflito();
  for(const chave of ['enabled_tools','disabled_tools']) {
    const lista=entrada[chave];
    if(lista!==undefined && (!Array.isArray(lista) || lista.some(x=>typeof x!=='string'))) conflito();
  }
  const tools=entrada.tools===undefined?{}:objeto(entrada.tools), resultado:Record<string,Record<string,unknown>>={};
  for(const nome of nomes) {
    if((Array.isArray(entrada.enabled_tools) && !entrada.enabled_tools.includes(nome)) ||
        (Array.isArray(entrada.disabled_tools) && entrada.disabled_tools.includes(nome))) conflito();
    const tool=tools[nome]===undefined?{}:objeto(tools[nome]);
    const mode=tool.approval_mode??entrada.default_tools_approval_mode;
    if(mode!==undefined && mode!=='approve') conflito();
    resultado[nome]={...tool,approval_mode:'approve'};
  }
  return resultado;
}
/** Renderer filho recebe apenas uma instalacao ja validada e nunca herda grants do dono. */
export function politicasFilhoCodex(entrada:Record<string,unknown>) {
  if(entrada.default_tools_approval_mode!==undefined && entrada.default_tools_approval_mode!=='approve')
    throw Error('mcp.permissions.conflict: default restritivo nao pode ser removido no filho');
  const grants=validarGrantsCodex(entrada,TOOLS_FILHO_CODEX);
  const tools:Record<string,unknown>={};
  if(entrada.tools!==undefined) for(const [nome,raw] of Object.entries(objeto(entrada.tools))) {
    const tool=objeto(raw);
    if(tool.approval_mode!==undefined && !['auto','prompt','writes','approve'].includes(String(tool.approval_mode)))
      throw Error('mcp.permissions.conflict: politica de ferramenta invalida');
    if(tool.approval_mode!=='approve') tools[nome]={...tool};
  }
  return {
    ...(entrada.enabled_tools!==undefined?{enabled_tools:entrada.enabled_tools}:{}),
    ...(entrada.disabled_tools!==undefined?{disabled_tools:entrada.disabled_tools}:{}),
    tools:{...tools,...grants},
  };
}
function ler(file: string): {bytes: Buffer; modo: number} | null {
  let fd: number;
  try { fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK); }
  catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return null; throw Error('mcp.install.config.unsafe'); }
  try {
    const st=fs.fstatSync(fd);
    if(!st.isFile() || st.size>262144) throw Error('mcp.install.config.unsafe');
    const bytes=fs.readFileSync(fd);
    if(bytes.length>262144) throw Error('mcp.install.config.unsafe');
    return {bytes,modo:st.mode&0o777};
  } finally {fs.closeSync(fd);}
}
/** Renderer de startup interno: a raiz vem do manifesto, nunca de argumentos de ferramentas. */
export function configuracaoServidorMcp(raiz: string, host: HostMcp,threadId?:string,transporteShip:TransporteShipMcp='github-ssh',permissoesFilho:PermissoesFilhoMcp='interactive',
  /** I-36 (D4): identidade do despacho da sessao filha; so existe junto com a thread vinculada. */
  dispatchId?:string) {
  if(!ehTransporteShipMcp(transporteShip))throw Error('mcp.install.transport.invalid');
  if(!['interactive','worktree'].includes(permissoesFilho))throw Error('mcp.install.child-permissions.invalid');
  if(dispatchId!==undefined && (!threadId || !/^[a-f0-9-]{36}$/.test(dispatchId)))throw Error('mcp.install.dispatch.invalid');
  return {command:process.execPath,args:[path.resolve(__dirname,'index.js'),'mcp','serve','--project',raiz,'--host',host,'--ship-transport',transporteShip,
    ...(permissoesFilho==='worktree'?['--child-permissions',permissoesFilho]:[]),
    ...(threadId?['--thread',threadId]:[]),
    ...(dispatchId?['--dispatch',dispatchId]:[])],
    ...(host==='codex'?{env_vars:[...ENV_VARS_CODEX_MCP]}:{})};
}

function migrarEnvVarsCodex(bruto:string,entrada:Record<string,unknown>):string {
  const atual=entrada.env_vars;
  if(atual!==undefined && (!Array.isArray(atual) || atual.some(v=>typeof v!=='string')))
    throw Error('mcp.install.conflict: env_vars existente invalido; configuracao preservada');
  const nomes=atual as string[]|undefined;
  if(nomes?.includes('CODEX_HOME'))return bruto;
  const inicio=/^[ \t]*\[mcp_servers\.orkastery\][ \t]*(?:#[^\r\n]*)?$/m.exec(bruto);
  if(!inicio)throw Error('mcp.install.conflict: tabela TOML nao pode receber env_vars; configuracao preservada');
  const corpoInicio=inicio.index+inicio[0].length;
  const proxima=/^[ \t]*\[/m.exec(bruto.slice(corpoInicio));
  const corpoFim=proxima?corpoInicio+proxima.index:bruto.length;
  const corpo=bruto.slice(corpoInicio,corpoFim);
  const linha=/^[ \t]*env_vars[ \t]*=[^\r\n]*$/m.exec(corpo);
  const valor=JSON.stringify([...(nomes??[]),'CODEX_HOME']);
  if(nomes!==undefined) {
    if(!linha)throw Error('mcp.install.conflict: env_vars TOML complexo nao pode ser migrado; configuracao preservada');
    const original=linha[0],igual=original.indexOf('='),prefixo=original.slice(0,igual+1);
    let aspas:''|'"'|"'"='',escape=false,comentario=-1;
    for(let i=igual+1;i<original.length;i++) {
      const c=original[i];
      if(aspas==='"' && escape){escape=false;continue;}
      if(aspas==='"' && c==='\\'){escape=true;continue;}
      if(aspas){if(c===aspas)aspas='';continue;}
      if(c==='"'||c==="'"){aspas=c;continue;}
      if(c==='#'){comentario=i;break;}
    }
    let antesComentario=comentario<0?original.length:comentario;
    while(antesComentario>igual+1 && /[ \t]/.test(original[antesComentario-1]))antesComentario--;
    const espacos=original.slice(igual+1,antesComentario).match(/^[ \t]*/)?.[0]??' ';
    const sufixo=comentario<0?'':original.slice(antesComentario);
    const substituta=`${prefixo}${espacos}${valor}${sufixo}`;
    return bruto.slice(0,corpoInicio)+corpo.slice(0,linha.index)+substituta+corpo.slice(linha.index+linha[0].length)+bruto.slice(corpoFim);
  }
  return bruto.slice(0,corpoFim)+(corpo.endsWith('\n')?'':'\n')+`env_vars = ${valor}\n`+bruto.slice(corpoFim);
}
/** O transporte SHIP de cada host do projeto com a entrada orkastery; config que nao se le nao conta. */
function transportesDosHosts(raiz:string):{arquivo:string;transporte:string}[] {
  const achados:{arquivo:string;transporte:string}[]=[];
  for(const host of HOSTS_MCP) {
    const arquivo=arquivoDoHostMcp(raiz,host),toml=host!=='claude-code';
    try {
      const lido=ler(arquivo);if(!lido)continue;
      const bruto=lido.bytes.toString('utf8'),dados=objeto(toml?parse(bruto):JSON.parse(bruto));
      const servidores=objeto(dados[toml?'mcp_servers':'mcpServers']);
      if(!Object.hasOwn(servidores,'orkastery'))continue;
      const argv=objeto(servidores.orkastery).args,lista=Array.isArray(argv)?argv as unknown[]:[],i=lista.indexOf('--ship-transport');
      achados.push({arquivo,transporte:i>=0?String(lista[i+1]):'github-ssh'});
    } catch {/* config ilegivel: nenhum servidor sobe dela */}
  }
  return achados;
}
export function instalarMcp(opcoes: OpcoesInstalacaoMcp): ResultadoInstalacaoMcp {
  // Ensaio da 0.5.0: os READMEs dos plugins mandavam `--project .`, recusado sem dizer como acertar.
  if(!path.isAbsolute(opcoes.projeto)) throw Error('mcp.install.project.invalid: raiz absoluta obrigatoria; na raiz do projeto, use --project "$PWD"');
  if(!HOSTS_MCP.includes(opcoes.host)) throw Error('mcp.install.host.invalid');
  if(opcoes.transporteShip!==undefined && !ehTransporteShipMcp(opcoes.transporteShip))throw Error('mcp.install.transport.invalid');
  if(opcoes.impressaoSsh!==undefined && (opcoes.transporteShip!=='forja-ssh' || !IMPRESSAO_SSH.test(opcoes.impressaoSsh)))
    throw Error('mcp.install.ssh-fingerprint.invalid: so com --ship-transport forja-ssh, no formato SHA256:<43 caracteres>');
  if(opcoes.permissoesFilho!==undefined && !['interactive','worktree'].includes(opcoes.permissoesFilho))throw Error('mcp.install.child-permissions.invalid');
  if(opcoes.permissoesDono!==undefined && (opcoes.host!=='codex' || !['interactive','orchestrate'].includes(opcoes.permissoesDono)))throw Error('mcp.install.owner-permissions.invalid: opt-in exclusivo Codex');
  const raiz=fs.realpathSync(opcoes.projeto);
  if(fs.realpathSync(exigirManifesto(raiz).raiz)!==raiz) throw Error('mcp.install.project.invalid');
  // O transporte fixado sonda o origin antes de qualquer escrita; sem transporte pedido, so a proposta, sem rede.
  let fixacao:FixacaoPreparada|undefined;const linhas:string[]=[];
  if(ehTransporteFixado(opcoes.transporteShip)) {
    // A fixacao e uma por projeto: outro host que ainda usa a instalada nao perde a dele.
    const instalada=fixacaoInstalada(raiz);
    if(instalada && instalada.transporte!==opcoes.transporteShip) {
      const usa=transportesDosHosts(raiz).find(h=>h.transporte===instalada.transporte);
      if(usa)throw Error(`mcp.install.conflict: transporte SHIP instalado e ${instalada.transporte} em ${usa.arquivo}; para trocar, remova a entrada orkastery de ${usa.arquivo} e reinstale; configuracao preservada`);
    }
    fixacao=prepararFixacao({raiz,transporte:opcoes.transporteShip,url:originUnicoMcp(raiz),manifesto:exigirManifesto(raiz).manifesto.forja,
      impressao:opcoes.impressaoSsh,sondas:opcoes.sondasDoTransporte??sondasPadraoDoTransporte()});
    linhas.push(textoDaFixacao(fixacao.fixacao,dirDaFixacao(raiz),!!opcoes.dryRun));
  } else if(opcoes.transporteShip===undefined) {
    let proposto:TransporteShipMcp|null=null;
    try {proposto=proporTransporte(originUnicoMcp(raiz));} catch {/* sem origin unico: nada a propor */}
    if(proposto!==null && proposto!=='github-ssh')linhas.push(msg().forja.transporteShip.proposta(proposto));
  }
  const gravarFixacaoSePedida=()=>{if(fixacao && !opcoes.dryRun)gravarFixacao(dirDaFixacao(raiz),fixacao);};
  // RM-067 (F4b): o grok grava como o codex, em TOML; so o claude-code usa o `.mcp.json` da raiz.
  const toml=opcoes.host!=='claude-code';
  const pasta=path.dirname(arquivoDoHostMcp(raiz,opcoes.host));
  const validarPasta=() => {
    try {
      const st=fs.lstatSync(pasta);
      if(!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(pasta)!==pasta)
        throw Error('mcp.install.directory.unsafe');
    } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
  };
  validarPasta();
  const arquivo=arquivoDoHostMcp(raiz,opcoes.host);
  const anterior=ler(arquivo), bruto=anterior?.bytes.toString('utf8')??'';
  const {command:comando,args}=configuracaoServidorMcp(raiz,opcoes.host,undefined,opcoes.transporteShip,opcoes.permissoesFilho);
  let dados: Record<string,unknown>;
  try {dados=anterior?objeto(toml?parse(bruto):JSON.parse(bruto)):{};}
  catch {throw Error('mcp.install.config.invalid: configuracao existente nao foi alterada');}
  const chave=toml?'mcp_servers':'mcpServers';
  const servidores=dados[chave]===undefined?{}:objeto(dados[chave]);
  const existente=Object.hasOwn(servidores,'orkastery')?objeto(servidores.orkastery):undefined;
  const faltaEnvCodex=opcoes.host==='codex' && existente!==undefined &&
    (!Array.isArray(existente.env_vars) || !existente.env_vars.includes('CODEX_HOME'));
  let faltantes:readonly string[]=[];
  if(opcoes.permissoesDono==='orchestrate') {
    validarGrantsCodex(existente??{},TOOLS_DONO_CODEX);
    const tools=existente?.tools===undefined?{}:objeto(existente.tools);
    faltantes=TOOLS_DONO_CODEX.filter(nome=>tools[nome]===undefined);
    for(const nome of TOOLS_DONO_CODEX) if(tools[nome]!==undefined && objeto(tools[nome]).approval_mode===undefined)
      throw Error('mcp.permissions.conflict: tabela existente sem consentimento explicito; configuracao preservada');
  }
  if(existente) {
    const legadoSSH=(opcoes.permissoesFilho??'interactive')==='interactive' && (opcoes.transporteShip??'github-ssh')==='github-ssh' && JSON.stringify(existente.args)===JSON.stringify(args.slice(0,-2));
    if(existente.command!==comando || (JSON.stringify(existente.args)!==JSON.stringify(args) && !legadoSSH)) {
      // Trocar de transporte e reinstalar: a recusa diz qual esta instalado, e a fixacao dele fica como esta.
      const argv=Array.isArray(existente.args)?existente.args as unknown[]:[],i=argv.indexOf('--ship-transport');
      const instalado=i>=0?argv[i+1]:undefined;
      if(existente.command===comando && ehTransporteShipMcp(instalado) && instalado!==(opcoes.transporteShip??'github-ssh'))
        throw Error(`mcp.install.conflict: transporte SHIP instalado e ${instalado}; para trocar, remova a entrada orkastery de ${arquivo} e reinstale; configuracao preservada`);
      throw Error('mcp.install.conflict: entrada orkastery divergente; configuracao preservada');
    }
    if(faltantes.length===0 && !faltaEnvCodex){gravarFixacaoSePedida();return {arquivo,estado:'igual',dryRun:!!opcoes.dryRun,ativacao:'pendente-no-cliente',transporte:linhas};}
  }
  let proximo: string;
  if(toml) {
    // Append preserva comentarios e escolhas do usuario. TOML inline fechado pode impedir a extensao.
    // RM-067 (F4b): o grok nao tem a lista de variaveis do codex; a entrada dele e so command e args.
    proximo=bruto+(bruto.endsWith('\n')||!bruto?'':'\n')+(existente?'':'\n[mcp_servers.orkastery]\ncommand = '+JSON.stringify(comando)+'\nargs = '+JSON.stringify(args)+'\n'+
      (opcoes.host==='codex'?'env_vars = '+JSON.stringify([...ENV_VARS_CODEX_MCP])+'\n':''));
    if(existente && faltaEnvCodex) {
      proximo=migrarEnvVarsCodex(proximo,existente);
      try {
        const migrado=objeto(parse(proximo)),migradoServidores=objeto(migrado.mcp_servers),migradoEntrada=objeto(migradoServidores.orkastery);
        const sem=(valor:Record<string,unknown>,chave:string)=>Object.fromEntries(Object.entries(valor).filter(([k])=>k!==chave));
        if(!isDeepStrictEqual(sem(migrado,'mcp_servers'),sem(dados,'mcp_servers')) ||
          !isDeepStrictEqual(sem(migradoServidores,'orkastery'),sem(servidores,'orkastery')) ||
          !isDeepStrictEqual(migradoEntrada,{...existente,env_vars:[...((existente.env_vars as string[]|undefined)??[]),'CODEX_HOME']}))
          throw Error('semantic mismatch');
      } catch {throw Error('mcp.install.conflict: env_vars nao pode ser migrado com seguranca; configuracao preservada');}
    }
    for(const nome of faltantes)proximo+='\n[mcp_servers.orkastery.tools.'+nome+']\napproval_mode = "approve"\n';
    try {parse(proximo);} catch {throw Error('mcp.install.conflict: tabela TOML nao pode ser estendida; configuracao preservada');}
  } else {
    dados[chave]={...servidores,orkastery:{command:comando,args}};
    proximo=JSON.stringify(dados,null,2)+'\n';
  }
  if(!opcoes.dryRun) {
    // A fixacao antes da config: um servidor que inicia entre as duas escritas acha a fixacao, nunca a falta dela.
    gravarFixacaoSePedida();
    validarPasta();
    fs.mkdirSync(pasta,{recursive:true});
    validarPasta();
    const temp=path.join(pasta,'.ork-mcp-'+randomUUID()+'.tmp');
    try {
      fs.writeFileSync(temp,proximo,{flag:'wx',mode:anterior?.modo??0o600});
      const atual=ler(arquivo);
      if((atual===null)!==(anterior===null) || (atual && anterior && !atual.bytes.equals(anterior.bytes)))
        throw Error('mcp.install.concurrent-change: configuracao alterada durante instalacao');
      validarPasta();
      fs.renameSync(temp,arquivo);
    } finally {fs.rmSync(temp,{force:true});}
  }
  return {arquivo,estado:anterior?'atualizado':'novo',dryRun:!!opcoes.dryRun,ativacao:'pendente-no-cliente',transporte:linhas};
}

export function textoInstalacaoMcp(r: ResultadoInstalacaoMcp): string {
  const m = msg().operacao.restante.mcp;
  return `${r.dryRun ? m.simulacao : m.preparada} ${r.arquivo} (${r.estado}).\n${m.inicio}\n${m.ativacao}`+
    (r.transporte?.length?`\n${r.transporte.join('\n')}`:'');
}

/** Contexto interno opt-in: configuracao M4 existente + catalogo instalado, nunca args do modelo. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { exigirManifesto } from './manifest';
import { dirThread, lerThread, blocoDaThread } from './thread';
import { HOSTS } from './hosts';
import { branchDaWorktree,worktreesDoGit } from './worktree';
import { configuracaoServidorMcp, TransporteShipMcp, PermissoesFilhoMcp, politicasFilhoCodex } from './mcp-install';
import { grafoLigado } from './mcp-grafo';
import { ENV_HITL_VERIFIERS, publicHitlVerifiers } from './hitl-public-receipt';

export interface IdentidadeDeDespacho {
  schema: 'ork.dispatch-identity/v1'; dispatchId: string; threadId: string;
  role: 'executor' | 'reviewer';
}
export interface ContextoRuntime { projeto: string; host: 'claude-code' | 'codex'; threadId: string; transporteShip?: TransporteShipMcp; permissoesFilho?: PermissoesFilhoMcp; identidade?: IdentidadeDeDespacho }
/** Correlação interna; nenhuma identidade de despacho concede poder de gate. */
export function novaIdentidadeDeDespacho(threadId: string, fase: string): IdentidadeDeDespacho {
  return { schema: 'ork.dispatch-identity/v1', dispatchId: randomUUID(), threadId, role: fase === 'CHECK' ? 'reviewer' : 'executor' };
}
function objeto(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('runtime.context.invalid: objeto esperado');
  return v as Record<string, unknown>;
}
function dentro(raiz: string, file: string): string {
  const real = fs.realpathSync(file);
  if (real !== raiz && !real.startsWith(raiz + path.sep)) throw Error('runtime.context.scope: caminho fora do projeto');
  return real;
}
function ler(raiz: string, file: string, limite: number): Buffer {
  dentro(raiz, file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > limite) throw Error('runtime.context.invalid: arquivo invalido');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limite) throw Error('runtime.context.invalid: arquivo excedeu limite');
    return bytes;
  } finally { fs.closeSync(fd); }
}
interface PerfilPreparado {transporteShip:TransporteShipMcp;permissoesFilho:PermissoesFilhoMcp;politicasCodex?:Record<string,unknown>}
function preparado(raiz: string): PerfilPreparado | undefined {
  let encontrado:PerfilPreparado|undefined;
  for (const host of ['claude-code', 'codex'] as const) {
    const file = path.join(raiz, host === 'codex' ? '.codex/config.toml' : '.mcp.json');
    if (!fs.existsSync(file)) continue;
    const text = ler(raiz, file, 262144).toString('utf8');
    const config = objeto(host === 'codex' ? parse(text) : JSON.parse(text));
    const chave = host === 'codex' ? 'mcp_servers' : 'mcpServers';
    if (config[chave] === undefined) continue;
    const servidores = objeto(config[chave]);
    if (!Object.hasOwn(servidores, 'orkastery')) continue;
    const entrada = objeto(servidores.orkastery), padrao = configuracaoServidorMcp(raiz, host);
    const legado=padrao.args.slice(0,-2);
    let transporte:TransporteShipMcp='github-ssh';
    let argv=entrada.args;
    let permissoesFilho:PermissoesFilhoMcp='interactive';
    if(Array.isArray(argv) && argv[argv.length-2]==='--child-permissions') {
      if(!['interactive','worktree'].includes(argv[argv.length-1]))throw Error('runtime.context.conflict: perfil de filho invalido');
      permissoesFilho=argv[argv.length-1] as PermissoesFilhoMcp;argv=argv.slice(0,-2);
    }
    if(JSON.stringify(argv)!==JSON.stringify(legado)) {
      if(!Array.isArray(argv) || argv.length!==padrao.args.length ||
          argv[argv.length-2]!=='--ship-transport' || !['github-ssh','bare-local'].includes(argv[argv.length-1]))
        throw Error('runtime.context.conflict: MCP Orkastery divergente; transporte invalido ou argumentos extras');
      transporte=argv[argv.length-1] as TransporteShipMcp;
    }
    const esperado=configuracaoServidorMcp(raiz,host,undefined,transporte);
    if(entrada.command!==esperado.command || (JSON.stringify(argv)!==JSON.stringify(esperado.args) && JSON.stringify(argv)!==JSON.stringify(legado)))
      throw Error('runtime.context.conflict: MCP Orkastery divergente; repare a instalacao do projeto');
    if(encontrado!==undefined && encontrado.transporteShip!==transporte)throw Error('runtime.context.conflict: transportes SHIP divergentes entre hosts');
    if(encontrado!==undefined && encontrado.permissoesFilho!==permissoesFilho)throw Error('runtime.context.conflict: perfis de filho divergentes entre hosts');
    encontrado={...encontrado,transporteShip:transporte,permissoesFilho,...(host==='codex'?{politicasCodex:entrada}:{})};
  }
  return encontrado;
}
function raizCanonica(projeto: string): string {
  if (!path.isAbsolute(projeto)) throw Error('runtime.context.invalid: projeto absoluto obrigatorio');
  const raiz = fs.realpathSync(projeto);
  if (raiz !== projeto || fs.realpathSync(exigirManifesto(raiz).raiz) !== raiz)
    throw Error('runtime.context.invalid: raiz canonica do manifesto obrigatoria');
  if (fs.existsSync(path.join(raiz, '.orkastery'))) dentro(raiz, path.join(raiz, '.orkastery'));
  return raiz;
}
/** Projeto sem entrada MCP Orkastery continua com o contrato legado. Nao instala nem altera arquivos. */
export function contextoDoProjeto(projeto: string, runtime: string, cwd: string, threadId?: string): ContextoRuntime | undefined {
  const raiz = raizCanonica(projeto);
  const perfil=preparado(raiz);
  if (!perfil) return undefined;
  if (!['claude-bg', 'codex'].includes(runtime)) throw Error('runtime.context.invalid: runtime desconhecido');
  if (!threadId) throw Error('runtime.context.invalid: thread obrigatoria para sessao filha');
  const contexto: ContextoRuntime = { projeto: raiz, host: runtime === 'codex' ? 'codex' : 'claude-code', threadId, transporteShip:perfil.transporteShip, permissoesFilho:perfil.permissoesFilho };
  validarContextoRuntime(contexto, cwd);
  return contexto;
}
/** Revalida no receptor do despacho, incluindo bytes instalados e escopo real do cwd. */
export function validarContextoRuntime(contexto: ContextoRuntime, cwd: string) {
  if (!contexto || !['claude-code', 'codex'].includes(contexto.host)) throw Error('runtime.context.invalid: host desconhecido');
  if(contexto.transporteShip!==undefined && !['github-ssh','bare-local'].includes(contexto.transporteShip))throw Error('runtime.context.invalid: transporte desconhecido');
  const raiz = raizCanonica(contexto.projeto);
  if(contexto.permissoesFilho!==undefined && !['interactive','worktree'].includes(contexto.permissoesFilho))throw Error('runtime.context.invalid: perfil de filho desconhecido');
  const perfil=preparado(raiz);
  if (!perfil) throw Error('runtime.context.missing: projeto nao preparado pelo instalador MCP');
  const {transporteShip,permissoesFilho}=perfil;
  if((contexto.permissoesFilho??'interactive')!==permissoesFilho)throw Error('runtime.context.conflict: perfil de filho difere da instalacao');
  if((contexto.transporteShip??'github-ssh')!==transporteShip)throw Error('runtime.context.conflict: transporte SHIP difere da instalacao');
  if (!path.isAbsolute(cwd) || dentro(raiz, cwd) !== cwd) throw Error('runtime.context.scope: cwd divergente');
  if (typeof contexto.threadId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(contexto.threadId))
    throw Error('runtime.context.invalid: identidade da thread invalida');
  if (contexto.identidade && (contexto.identidade.schema !== 'ork.dispatch-identity/v1' ||
      contexto.identidade.threadId !== contexto.threadId || !['executor', 'reviewer'].includes(contexto.identidade.role) ||
      !/^[a-f0-9-]{36}$/.test(contexto.identidade.dispatchId))) throw Error('runtime.context.identity');
  dentro(raiz, dirThread(raiz, contexto.threadId));
  const thread = lerThread(raiz, contexto.threadId);
  if (thread.id !== contexto.threadId || fs.realpathSync(thread.worktree ?? raiz) !== cwd)
    throw Error('runtime.context.scope: cwd nao corresponde a thread vinculada');
  if(permissoesFilho==='worktree') {
    if(thread.status==='fechada' || !thread.worktree || thread.worktree===raiz || thread.worktree!==cwd ||
        !fs.lstatSync(thread.worktree).isDirectory() || fs.realpathSync(thread.worktree)!==thread.worktree)
      throw Error('runtime.context.worktree: perfil exige thread aberta e worktree fisica propria');
    if(!worktreesDoGit(raiz).some(w=>w.dir===cwd && w.branch===branchDaWorktree(thread)))
      throw Error('runtime.context.worktree: worktree nao registrada na branch da thread');
  }
  const def = HOSTS[contexto.host];
  const instalacao = path.join(raiz, def.destinoPadrao, def.subdir ?? '');
  let recibo: Record<string, unknown>;
  try { recibo = objeto(JSON.parse(ler(raiz, path.join(instalacao, 'INSTALADO.json'), 1048576).toString('utf8'))); }
  catch { throw Error('runtime.context.installation: instale/verifique o adaptador do runtime neste projeto'); }
  if (recibo.contrato !== 'ork.adapter-install/v1' || recibo.host !== contexto.host || !Array.isArray(recibo.arquivos) || recibo.arquivos.length > 512)
    throw Error('runtime.context.installation: recibo instalado invalido');
  const arquivos = new Map<string, string>();
  for (const item of recibo.arquivos) {
    const a = objeto(item);
    if (typeof a.arquivo !== 'string' || path.isAbsolute(a.arquivo) || a.arquivo.split(/[\\/]/).includes('..') ||
        typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || arquivos.has(a.arquivo))
      throw Error('runtime.context.installation: arquivo do recibo invalido');
    const file = path.join(instalacao, a.arquivo);
    if (!dentro(raiz, file).startsWith(instalacao + path.sep) || createHash('sha256').update(ler(raiz, file, 1048576)).digest('hex') !== a.sha256)
      throw Error('runtime.context.installation: bytes instalados divergentes');
    arquivos.set(a.arquivo, file);
  }
  const bootstrap = arquivos.get('skills/core/orkastery-bootstrap/SKILL.md');
  if (!bootstrap || (contexto.host === 'claude-code' && !arquivos.has('.claude-plugin/plugin.json')))
    throw Error('runtime.context.installation: catalogo ou plugin incompleto');
  // Capacidade derivada do bloco atual, nunca aceita como entrada do modelo.
  const permiteEditarProduto = permissoesFilho === 'worktree' && blocoDaThread(thread,thread.faseAtual).fases.includes('GO');
  // RM-031 KG5 (D2, D7): as tools do grafo seguem a flag do manifesto da raiz, que o servidor do filho tambem le;
  // o manifesto da worktree da thread e o pedido do modelo nao ligam nada.
  const grafoMcp = grafoLigado(exigirManifesto(raiz).manifesto);
  const publicVerifiers = publicHitlVerifiers();
  const servidor={...configuracaoServidorMcp(raiz, contexto.host, contexto.threadId,transporteShip,permissoesFilho,contexto.identidade?.dispatchId),
    ...(publicVerifiers ? { env: { [ENV_HITL_VERIFIERS]: publicVerifiers } } : {}),
    ...(contexto.host==='codex' && permissoesFilho==='worktree'?politicasFilhoCodex(perfil.politicasCodex??{}):{})};
  return { projeto: raiz, instalacao, bootstrap, permissoesFilho, permiteEditarProduto, grafoMcp, servidor };
}

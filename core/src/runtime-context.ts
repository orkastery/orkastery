/** Contexto interno opt-in: configuracao M4 existente + catalogo instalado, nunca args do modelo. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { exigirManifesto } from './manifest';
import { dirThread, lerThread, blocoDaThread } from './thread';
import { HOSTS } from './hosts';
import { branchDaWorktree,worktreesDoGit } from './worktree';
import { arquivoDoHostMcp, configuracaoServidorMcp, HOSTS_MCP, HostMcp, TransporteShipMcp, PermissoesFilhoMcp, politicasFilhoCodex } from './mcp-install';
import { grafoLigado } from './mcp-grafo';
import { ehTransporteShipMcp } from './mcp-transportes';
import { ENV_HITL_VERIFIERS, publicHitlVerifiers } from './hitl-public-receipt';

export interface IdentidadeDeDespacho {
  schema: 'ork.dispatch-identity/v1'; dispatchId: string; threadId: string;
  role: 'executor' | 'reviewer';
}
export interface ContextoRuntime { projeto: string; host: HostMcp; threadId: string; transporteShip?: TransporteShipMcp; permissoesFilho?: PermissoesFilhoMcp; identidade?: IdentidadeDeDespacho }
export interface CapacidadeDoRuntime {
  runtime: string;
  host: HostMcp | null;
  preparado: boolean;
  capaz: boolean;
  motivo: string | null;
}
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
/** A entrada `orkastery` de um host, conferida contra o perfil ja achado nos hosts anteriores; sem entrada, o perfil fica. */
function perfilDoHost(raiz: string, host: HostMcp, encontrado: PerfilPreparado | undefined): PerfilPreparado | undefined {
  const file = arquivoDoHostMcp(raiz, host), toml = host !== 'claude-code';
  if (!fs.existsSync(file)) return encontrado;
  const text = ler(raiz, file, 262144).toString('utf8');
  let config: Record<string, unknown>;
  try { config = objeto(toml ? parse(text) : JSON.parse(text)); }
  catch (erro) {
    // RM-067 (F4b, GO-FIX A4): o motivo tipado do grok leva so a primeira linha do erro, sem o trecho do arquivo do time.
    if (host !== 'grok') throw erro;
    throw Error(`runtime.context.conflict: .grok/config.toml do projeto ilegivel (${(erro as Error).message.split('\n')[0]}); ` +
      'conserte o arquivo ou tire dele a entrada orkastery');
  }
  const chave = toml ? 'mcp_servers' : 'mcpServers';
  if (config[chave] === undefined) return encontrado;
  const servidores = objeto(config[chave]);
  if (!Object.hasOwn(servidores, 'orkastery')) return encontrado;
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
        argv[argv.length-2]!=='--ship-transport' || !ehTransporteShipMcp(argv[argv.length-1]))
      throw Error('runtime.context.conflict: MCP Orkastery divergente; transporte invalido ou argumentos extras');
    transporte=argv[argv.length-1] as TransporteShipMcp;
  }
  const esperado=configuracaoServidorMcp(raiz,host,undefined,transporte);
  if(entrada.command!==esperado.command || (JSON.stringify(argv)!==JSON.stringify(esperado.args) && JSON.stringify(argv)!==JSON.stringify(legado)))
    throw Error('runtime.context.conflict: MCP Orkastery divergente; repare a instalacao do projeto');
  if(encontrado!==undefined && encontrado.transporteShip!==transporte)throw Error('runtime.context.conflict: transportes SHIP divergentes entre hosts');
  if(encontrado!==undefined && encontrado.permissoesFilho!==permissoesFilho)throw Error('runtime.context.conflict: perfis de filho divergentes entre hosts');
  return {...encontrado,transporteShip:transporte,permissoesFilho,...(host==='codex'?{politicasCodex:entrada}:{})};
}
/**
 * O perfil da instalacao MCP do projeto. RM-067 (F4b, GO-FIX A4): o `.grok/config.toml` tambem prepara, em TOML como o do
 * codex, mas ele e a config do proprio grok, que o time pode manter: para quem nao e o grok (`quem`), a falha de leitura,
 * de parse ou de conferencia dele nao derruba a preparacao dos outros hosts, e a entrada dele fica de fora.
 */
function preparado(raiz: string, quem?: string): PerfilPreparado | undefined {
  let encontrado:PerfilPreparado|undefined;
  for (const host of HOSTS_MCP) {
    try { encontrado = perfilDoHost(raiz, host, encontrado); }
    catch (erro) { if (host !== 'grok' || quem === undefined || quem === 'grok') throw erro; }
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

function hostDoRuntime(runtime: string): HostMcp {
  if (runtime === 'claude-bg') return 'claude-code';
  if (runtime === 'codex') return 'codex';
  if (runtime === 'grok') return 'grok';
  throw Error('runtime.context.invalid: runtime desconhecido');
}

interface InstalacaoConferida {
  instalacao: string;
  arquivos: Map<string, string>;
  conferidos: Map<string, Buffer>;
  bootstrap: string;
}

/** Confere o recibo e todos os bytes do adaptador antes de considerar o runtime um destino. */
function conferirInstalacaoDoHost(raiz: string, host: 'claude-code' | 'codex'): InstalacaoConferida {
  const def = HOSTS[host];
  const instalacao = path.join(raiz, def.destinoPadrao, def.subdir ?? '');
  let recibo: Record<string, unknown>;
  try { recibo = objeto(JSON.parse(ler(raiz, path.join(instalacao, 'INSTALADO.json'), 1048576).toString('utf8'))); }
  catch { throw Error('runtime.context.installation: instale/verifique o adaptador do runtime neste projeto'); }
  if (recibo.contrato !== 'ork.adapter-install/v1' || recibo.host !== host || !Array.isArray(recibo.arquivos) || recibo.arquivos.length > 512)
    throw Error('runtime.context.installation: recibo instalado invalido');
  const arquivos = new Map<string, string>();
  // RM-059 (T0.7): os bytes ja conferidos da declaracao e do manifesto de cada mod, lidos uma vez so.
  const conferidos = new Map<string, Buffer>();
  for (const item of recibo.arquivos) {
    const a = objeto(item);
    if (typeof a.arquivo !== 'string' || path.isAbsolute(a.arquivo) || a.arquivo.split(/[\\/]/).includes('..') ||
        typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || arquivos.has(a.arquivo))
      throw Error('runtime.context.installation: arquivo do recibo invalido');
    const file = path.join(instalacao, a.arquivo);
    if (!dentro(raiz, file).startsWith(instalacao + path.sep)) throw Error('runtime.context.installation: bytes instalados divergentes');
    const bytes = ler(raiz, file, 1048576);
    if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) throw Error('runtime.context.installation: bytes instalados divergentes');
    arquivos.set(a.arquivo, file);
    if (DECLARACAO_OU_MANIFESTO_DE_MOD.test(a.arquivo)) conferidos.set(a.arquivo, bytes);
  }
  const bootstrap = arquivos.get('skills/core/orkastery-bootstrap/SKILL.md');
  if (!bootstrap || (host === 'claude-code' && !arquivos.has('.claude-plugin/plugin.json')))
    throw Error('runtime.context.installation: catalogo ou plugin incompleto');
  return { instalacao, arquivos, conferidos, bootstrap };
}

/**
 * Um projeto preparado so pode escolher runtimes cujo adaptador esteja instalado e integro.
 * Projeto legado, sem entrada MCP do Orkastery, conserva a selecao anterior.
 */
export function capacidadeDoRuntimeNoProjeto(projeto: string, runtime: string): CapacidadeDoRuntime {
  let host: HostMcp | null = null;
  try {
    const raiz = raizCanonica(projeto);
    const perfil = preparado(raiz, runtime);
    if (!perfil) return { runtime, host: null, preparado: false, capaz: true, motivo: null };
    if (RUNTIMES_SEM_HOST_MCP.includes(runtime))
      return { runtime, host: null, preparado: true, capaz: false, motivo: MOTIVO_SEM_HOST_MCP };
    host = hostDoRuntime(runtime);
    // RM-067 (F4b, G6): o grok nao tem adaptador instalavel (plugin, skills, mods); o contexto dele e so o MCP.
    if (host !== 'grok') conferirInstalacaoDoHost(raiz, host);
    if (RUNTIMES_FORA_DOS_DESTINOS_AUTOMATICOS.includes(runtime))
      return { runtime, host, preparado: true, capaz: false, motivo: MOTIVO_FORA_DOS_DESTINOS_AUTOMATICOS };
    return { runtime, host, preparado: true, capaz: true, motivo: null };
  } catch (erro) {
    return { runtime, host, preparado: true, capaz: false, motivo: (erro as Error).message };
  }
}
/**
 * RM-067 (D15 da ork-grokbuild): runtimes homologados que ainda nao tem host MCP do Orkastery. A sessao filha deles
 * despacha sem contexto, como num projeto sem entrada MCP, ate o host existir. A capacidade de rotacao
 * (`capacidadeDoRuntimeNoProjeto`) nao muda: num projeto preparado, eles seguem fora dos destinos automaticos.
 * RM-067 (F4b, G6): o grok saiu daqui com o host `grok`; a lista fica para o proximo runtime sem host.
 */
export const RUNTIMES_SEM_HOST_MCP: readonly string[] = [];

/** RM-067 (F4): o motivo tipado de um runtime sem host MCP num projeto preparado. */
export const MOTIVO_SEM_HOST_MCP = 'runtime.context.no-host: runtime sem host MCP do Orkastery; a sessao despacha sem o contexto do projeto';

/**
 * RM-067 (F4b, GO-FIX A5): runtimes com o host MCP que, num projeto preparado, ficam fora dos destinos automaticos (o
 * fallback do retry e a escada). O sandbox do grok vale para o processo inteiro e os filhos (G17 da RM-067), e o servidor
 * MCP do ork e filho dele: no piso `workspace`, ele le o estado, mas nao grava o ledger, os artefatos nem o git da
 * worktree, e a fase que chega por fallback para sem prova. O despacho pedido (`--runtime grok`) leva o contexto, e a
 * troca de conta dentro do grok segue; a lista sai daqui quando a F5 confirmar a gravacao com o sandbox ligado.
 */
export const RUNTIMES_FORA_DOS_DESTINOS_AUTOMATICOS: readonly string[] = ['grok'];
export const MOTIVO_FORA_DOS_DESTINOS_AUTOMATICOS = 'runtime.context.sandbox: o sandbox do grok vale tambem para o servidor MCP do ' +
  'ork, que no piso workspace nao grava o estado; como destino automatico num projeto preparado, o grok fica fora ate a F5';

/**
 * RM-067 (F4): a capacidade de um runtime para a rotacao do retry. A troca de perfil DENTRO do runtime em que a thread ja
 * despachou (`mesmoRuntime`) vale para o runtime sem host MCP e, desde a F4b, para o que fica fora dos destinos
 * automaticos: a sessao dele ja roda como rodava, e a outra conta nao muda isso, entao o `ork retry` troca o perfil do
 * grok como troca o dos outros runtimes. Como alvo de fallback num projeto preparado, ele segue incapaz.
 */
export function capacidadeDaRotacao(projeto: string, runtime: string, mesmoRuntime: boolean): CapacidadeDoRuntime {
  const capacidade = capacidadeDoRuntimeNoProjeto(projeto, runtime);
  if (capacidade.capaz || !mesmoRuntime) return capacidade;
  const soComoDestino = (RUNTIMES_SEM_HOST_MCP.includes(runtime) && capacidade.motivo === MOTIVO_SEM_HOST_MCP) ||
    (RUNTIMES_FORA_DOS_DESTINOS_AUTOMATICOS.includes(runtime) && capacidade.motivo === MOTIVO_FORA_DOS_DESTINOS_AUTOMATICOS);
  return soComoDestino ? { ...capacidade, capaz: true } : capacidade;
}

/** Projeto sem entrada MCP Orkastery continua com o contrato legado. Nao instala nem altera arquivos. */
export function contextoDoProjeto(projeto: string, runtime: string, cwd: string, threadId?: string): ContextoRuntime | undefined {
  const raiz = raizCanonica(projeto);
  const perfil=preparado(raiz, runtime);
  if (!perfil) return undefined;
  if (RUNTIMES_SEM_HOST_MCP.includes(runtime)) return undefined;
  const host = hostDoRuntime(runtime);
  if (!threadId) throw Error('runtime.context.invalid: thread obrigatoria para sessao filha');
  const contexto: ContextoRuntime = { projeto: raiz, host, threadId, transporteShip:perfil.transporteShip, permissoesFilho:perfil.permissoesFilho };
  if (host === 'grok') validarContextoDoGrok(contexto, cwd); else validarContextoRuntime(contexto, cwd);
  return contexto;
}
/**
 * A conferencia do vinculo, comum a todo host: projeto preparado, perfil e transporte iguais aos da instalacao, cwd e
 * thread da sessao filha, identidade do despacho e, no perfil worktree, a worktree propria da thread. RM-067 (F4b, D2):
 * saiu de `validarContextoRuntime` sem mudar a ordem das conferencias, para o contexto do grok usar a mesma.
 */
function conferirVinculo(contexto: ContextoRuntime, cwd: string) {
  if(contexto.transporteShip!==undefined && !ehTransporteShipMcp(contexto.transporteShip))throw Error('runtime.context.invalid: transporte desconhecido');
  const raiz = raizCanonica(contexto.projeto);
  if(contexto.permissoesFilho!==undefined && !['interactive','worktree'].includes(contexto.permissoesFilho))throw Error('runtime.context.invalid: perfil de filho desconhecido');
  const perfil=preparado(raiz, contexto.host);
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
  return { raiz, perfil, transporteShip, permissoesFilho, thread };
}

/** Revalida no receptor do despacho, incluindo bytes instalados e escopo real do cwd. */
export function validarContextoRuntime(contexto: ContextoRuntime, cwd: string) {
  if (!contexto || (contexto.host !== 'claude-code' && contexto.host !== 'codex')) throw Error('runtime.context.invalid: host desconhecido');
  const { raiz, perfil, transporteShip, permissoesFilho, thread } = conferirVinculo(contexto, cwd);
  const { instalacao, arquivos, conferidos, bootstrap } = conferirInstalacaoDoHost(raiz, contexto.host);
  const modsDeFase = contexto.host === 'claude-code' ? modsDeFaseInstalados(raiz, instalacao, arquivos, conferidos) : [];
  // Capacidade derivada do bloco atual, nunca aceita como entrada do modelo.
  const permiteEditarProduto = permissoesFilho === 'worktree' && blocoDaThread(thread,thread.faseAtual).fases.includes('GO');
  // RM-031 KG5 (D2, D7): as tools do grafo seguem a flag do manifesto da raiz, que o servidor do filho tambem le;
  // o manifesto da worktree da thread e o pedido do modelo nao ligam nada.
  const manifestoDaRaiz = exigirManifesto(raiz).manifesto;
  const grafoMcp = grafoLigado(manifestoDaRaiz);
  // RM-059 (T10.4, D11 da thread ork-rm059portao): os tetos do piloto de agent teams so vao ao despacho do Claude Code
  // quando o bloco da fase atual tem o GO, a mesma regra da edicao de produto; o manifesto da raiz decide, nunca o
  // pedido do modelo. Quem liga de fato e o `montarComando`, e so com o Portao de Tarefas na sessao.
  const tetos = contexto.host === 'claude-code' ? manifestoDaRaiz.runtime.agent_teams : undefined;
  const agentTeams = tetos && blocoDaThread(thread, thread.faseAtual).fases.includes('GO') ? { ...tetos } : null;
  const publicVerifiers = publicHitlVerifiers();
  const servidor={...configuracaoServidorMcp(raiz, contexto.host, contexto.threadId,transporteShip,permissoesFilho,contexto.identidade?.dispatchId),
    ...(publicVerifiers ? { env: { [ENV_HITL_VERIFIERS]: publicVerifiers } } : {}),
    ...(contexto.host==='codex' && permissoesFilho==='worktree'?politicasFilhoCodex(perfil.politicasCodex??{}):{})};
  return { projeto: raiz, instalacao, bootstrap, permissoesFilho, permiteEditarProduto, grafoMcp, servidor, modsDeFase, agentTeams };
}

/** RM-067 (F4b): o servidor MCP do `ork` que a sessao filha do grok sobe, pela config da worktree. */
export interface ServidorDoFilhoGrok { command: string; args: string[]; env?: Record<string, string> }

/**
 * RM-067 (F4b, D2): o contexto do grok, revalidado no despacho. O vinculo e o mesmo dos outros hosts; nao ha adaptador
 * instalado a conferir (o grok nao tem plugin, skills nem mods do Orkastery). Devolve o que o comando e a config da
 * worktree usam: o perfil filho, a flag do grafo da raiz e o servidor vinculado a thread e ao despacho.
 */
export function validarContextoDoGrok(contexto: ContextoRuntime, cwd: string):
    { projeto: string; threadId: string; permissoesFilho: PermissoesFilhoMcp; grafoMcp: boolean; servidor: ServidorDoFilhoGrok } {
  if (!contexto || contexto.host !== 'grok') throw Error('runtime.context.invalid: host grok esperado');
  const { raiz, transporteShip, permissoesFilho, thread } = conferirVinculo(contexto, cwd);
  // RM-067 (F4b, GO-FIX B1): a config da sessao vai no cwd; na raiz do projeto ela viraria a entrada do host grok.
  if (!thread.worktree || thread.worktree === raiz || cwd === raiz)
    throw Error('runtime.context.worktree: o grok com o MCP do ork exige a worktree propria da thread; a config da sessao nunca vai a raiz do projeto');
  const grafoMcp = grafoLigado(exigirManifesto(raiz).manifesto);
  const publicVerifiers = publicHitlVerifiers();
  const servidor: ServidorDoFilhoGrok = {
    ...configuracaoServidorMcp(raiz, 'grok', contexto.threadId, transporteShip, permissoesFilho, contexto.identidade?.dispatchId),
    ...(publicVerifiers ? { env: { [ENV_HITL_VERIFIERS]: publicVerifiers } } : {}) };
  return { projeto: raiz, threadId: contexto.threadId, permissoesFilho, grafoMcp, servidor };
}

/**
 * RM-059 (T0.7): a convencao com que cada mod do Orkastery declara o proprio papel, em
 * `mods/<mod>/orkastery-mod.json`. `dono` roda na sessao de quem conduz; `fase`, nas sessoes despachadas.
 */
export type PapelDeMod = 'dono' | 'fase';
export interface DeclaracaoDeMod { formato: 'ork.mod/v1'; papeis: PapelDeMod[]; claudeCodeMinimo: string }
/**
 * Um mod de papel `fase` conferido contra o recibo, na ordem em que vai ao despacho. `dependencias` sao os mods
 * desta instalacao (de qualquer papel) que o `plugin.json` dele cita: sem eles na sessao, o mod tambem fica fora.
 */
export interface ModDeFase { nome: string; dir: string; claudeCodeMinimo: string; dependencias: string[] }

const DECLARACAO_OU_MANIFESTO_DE_MOD = /^mods\/[^/]+\/(?:orkastery-mod\.json|\.claude-plugin\/plugin\.json)$/;
const DECLARACAO_DE_MOD = /^mods\/([^/]+)\/orkastery-mod\.json$/;
const NOME_DE_MOD = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** A declaracao de papel de um mod; o erro diz o que esta fora da convencao. */
export function lerDeclaracaoDeMod(texto: string): DeclaracaoDeMod {
  let bruto: unknown;
  try { bruto = JSON.parse(texto); } catch { throw Error('orkastery-mod.json nao e JSON'); }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw Error('orkastery-mod.json precisa ser objeto');
  const d = bruto as Record<string, unknown>;
  if (d.formato !== 'ork.mod/v1') throw Error('orkastery-mod.json com formato diferente de ork.mod/v1');
  const papeis = d.papeis;
  if (!Array.isArray(papeis) || papeis.length === 0 || papeis.some((p) => p !== 'dono' && p !== 'fase') ||
      new Set(papeis).size !== papeis.length) throw Error('orkastery-mod.json com papeis fora de dono e fase, vazios ou repetidos');
  if (typeof d.claudeCodeMinimo !== 'string' || !/^\d+\.\d+\.\d+$/.test(d.claudeCodeMinimo))
    throw Error('orkastery-mod.json com claudeCodeMinimo fora do formato X.Y.Z');
  return { formato: 'ork.mod/v1', papeis: papeis as PapelDeMod[], claudeCodeMinimo: d.claudeCodeMinimo };
}

/**
 * RM-059 (T0.7, D3): os nomes que o `dependencies` do `plugin.json` de um mod cita, em melhor esforco:
 * lista de nomes (com ou sem `@marketplace`), objeto com os nomes nas chaves, ou lista de objetos com `name`.
 */
function dependenciasDoManifesto(texto: string): string[] {
  let manifesto: unknown;
  try { manifesto = JSON.parse(texto); } catch { throw Error('.claude-plugin/plugin.json nao e JSON'); }
  if (!manifesto || typeof manifesto !== 'object' || Array.isArray(manifesto)) throw Error('.claude-plugin/plugin.json precisa ser objeto');
  const deps = (manifesto as Record<string, unknown>).dependencies;
  const itens = Array.isArray(deps) ? deps : deps && typeof deps === 'object' ? Object.keys(deps) : [];
  return itens.flatMap((item) => {
    const nome = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined;
    return typeof nome === 'string' && nome ? [nome.split('@')[0]] : [];
  });
}

/** Os arquivos comuns que o proprio Claude Code escreve na pasta do mod que ele carrega: declaracoes, nunca codigo. */
function arquivoDoMotor(raiz: string, arquivo: string, relativo: string): boolean {
  if (relativo === '.claude-plugin/types/.gitignore') return true;
  if (relativo.startsWith('.claude-plugin/types/') &&
      (relativo.endsWith('.d.ts') || path.posix.basename(relativo) === 'tsconfig.json')) return true;
  if (relativo !== 'tsconfig.json') return false;
  try {
    const config = objeto(JSON.parse(ler(raiz, arquivo, 4096).toString('utf8')));
    return Object.keys(config).length === 1 && config.extends === './.claude-plugin/types/tsconfig.json';
  } catch { return false; }
}

/** Link de tipos gerado pelo Claude Code: o alvo real continua preso a um .d.ts comprovado pelo recibo. */
function linkDeTipoDoMotor(instalacao: string, arquivo: string, relativo: string,
  arquivos: ReadonlyMap<string, string>): boolean {
  if (!relativo.startsWith('.claude-plugin/types/') || !relativo.endsWith('.d.ts')) return false;
  let alvo: string;
  try { alvo = fs.realpathSync(arquivo); } catch { return false; }
  const relativoAoRecibo = path.relative(instalacao, alvo).split(path.sep).join('/');
  if (!/^mods\/[^/]+\/types\/[^/]+\.d\.ts$/.test(relativoAoRecibo)) return false;
  const comprovado = arquivos.get(relativoAoRecibo);
  if (!comprovado) return false;
  try { return fs.realpathSync(comprovado) === alvo && fs.statSync(alvo).isFile(); }
  catch { return false; }
}

/**
 * RM-059 (T0.7, D1): a pasta instalada de um mod de fase tem exatamente os arquivos do recibo. O
 * `--plugin-dir` carrega o que estiver nela (comandos, agentes e skills sao descobertos), entao arquivo
 * fora do recibo entraria na sessao de fase sem prova. So o link de tipos gerado pelo motor conserva
 * a prova pelo alvo real; outro link e arquivo especial recusam sempre.
 */
function conferirPastaDoMod(raiz: string, instalacao: string, nome: string, arquivos: ReadonlyMap<string, string>): string {
  const dir = path.join(instalacao, 'mods', nome);
  const recusa = (motivo: string, correcao = 'reinstale com ork adapter install claude-code') =>
    Error(`runtime.context.installation: mod ${nome}: ${motivo}; ${correcao}`);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() || dentro(raiz, dir) !== dir) throw recusa('pasta instalada ausente ou fora da instalacao');
  const visitar = (atual: string, prefixo: string): void => {
    for (const entrada of fs.readdirSync(atual, { withFileTypes: true })) {
      const relativo = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
      const arquivo = path.join(atual, entrada.name);
      if (entrada.isSymbolicLink()) {
        if (linkDeTipoDoMotor(instalacao, arquivo, relativo, arquivos)) continue;
        throw recusa(`link em ${relativo}`);
      }
      if (entrada.isDirectory()) { visitar(path.join(atual, entrada.name), relativo); continue; }
      if (!entrada.isFile()) throw recusa(`arquivo especial em ${relativo}`);
      if (!arquivos.has(`mods/${nome}/${relativo}`) && !arquivoDoMotor(raiz, arquivo, relativo)) {
        throw recusa(`arquivo fora do INSTALADO.json (${relativo})`, 'se ele saiu do catalogo, ork adapter install claude-code o tira da copia; ' +
          `se foi editado ou acrescentado a mao, apague ${path.join(dir, relativo)}`);
      }
    }
  };
  visitar(dir, '');
  return dir;
}

/**
 * RM-059 (rodada 2 do CHECK, N2): o arquivo comum da raiz de `mods/` tambem so vale com prova. A ponte le a lista
 * de autoridade em `../autoridade.json` antes da propria pasta, entao uma copia velha ou escrita a mao ali mudaria o
 * que a sessao de fase aceita. Com mod de fase no despacho, todo arquivo direto em `mods/` esta no recibo (que ja
 * conferiu os bytes); link e arquivo especial recusam. Pastas sao os mods, conferidos um a um.
 */
function conferirRaizDosMods(raiz: string, instalacao: string, arquivos: ReadonlyMap<string, string>): void {
  const dir = path.join(instalacao, 'mods');
  const recusa = (motivo: string, correcao = 'reinstale com ork adapter install claude-code') =>
    Error(`runtime.context.installation: mods/: ${motivo}; ${correcao}`);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() || dentro(raiz, dir) !== dir) throw recusa('pasta instalada ausente ou fora da instalacao');
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isSymbolicLink()) throw recusa(`link em ${entrada.name}`);
    if (entrada.isDirectory()) continue;
    if (!entrada.isFile()) throw recusa(`arquivo especial em ${entrada.name}`);
    if (!arquivos.has(`mods/${entrada.name}`)) {
      throw recusa(`arquivo fora do INSTALADO.json (${entrada.name})`, 'se ele saiu do catalogo, ork adapter install claude-code o tira da copia; ' +
        `se foi editado ou acrescentado a mao, apague ${path.join(dir, entrada.name)}`);
    }
  }
}

/**
 * RM-059 (T0.7): os mods de papel `fase` da instalacao, lidos do recibo ja conferido e na ordem da D3:
 * a dependencia antes de quem depende, depois o nome. Declaracao ou manifesto invalidos recusam como
 * um byte divergente (D2): e instalacao corrompida, e o CI do catalogo ja reprova esse caso.
 */
export function modsDeFaseInstalados(raiz: string, instalacao: string, arquivos: ReadonlyMap<string, string>,
  conferidos: ReadonlyMap<string, Buffer>): ModDeFase[] {
  const achados: ModDeFase[] = [];
  const nomes = [...arquivos.keys()].flatMap((arquivo) => DECLARACAO_DE_MOD.exec(arquivo)?.[1] ?? []).sort();
  const daInstalacao = new Set(nomes);
  for (const nome of nomes) {
    const arquivo = `mods/${nome}/orkastery-mod.json`;
    const recusa = (motivo: string) => Error(`runtime.context.installation: mod ${nome}: ${motivo}; reinstale com ork adapter install claude-code`);
    if (!NOME_DE_MOD.test(nome)) throw recusa('nome fora de letras minusculas, digitos e hifen');
    let declaracao: DeclaracaoDeMod;
    try { declaracao = lerDeclaracaoDeMod(conferidos.get(arquivo)!.toString('utf8')); } catch (e) { throw recusa((e as Error).message); }
    if (!declaracao.papeis.includes('fase')) continue;
    const manifesto = conferidos.get(`mods/${nome}/.claude-plugin/plugin.json`);
    if (!manifesto) throw recusa('.claude-plugin/plugin.json fora do recibo');
    let dependencias: string[];
    try { dependencias = dependenciasDoManifesto(manifesto.toString('utf8')).filter((d) => daInstalacao.has(d) && d !== nome); }
    catch (e) { throw recusa((e as Error).message); }
    achados.push({ nome, dir: conferirPastaDoMod(raiz, instalacao, nome, arquivos), claudeCodeMinimo: declaracao.claudeCodeMinimo, dependencias });
  }
  if (achados.length) conferirRaizDosMods(raiz, instalacao, arquivos);
  const porNome = new Map(achados.map((m) => [m.nome, m]));
  const ordem: ModDeFase[] = [];
  const feitos = new Set<string>(), abertos = new Set<string>();
  // Busca em profundidade: a dependencia sai antes; num ciclo, a aresta de volta e ignorada (melhor esforco).
  const visitar = (m: ModDeFase): void => {
    if (feitos.has(m.nome) || abertos.has(m.nome)) return;
    abertos.add(m.nome);
    for (const dep of [...m.dependencias].sort()) { const alvo = porNome.get(dep); if (alvo) visitar(alvo); }
    abertos.delete(m.nome);
    feitos.add(m.nome);
    ordem.push(m);
  };
  for (const m of achados) visitar(m);
  return ordem;
}

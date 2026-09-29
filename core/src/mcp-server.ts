/** Transporte MCP de projeto. O cliente nativo e a configuracao de startup sao confiaveis;
 * argumentos de ferramentas nunca escolhem raiz, shell ou resposta humana. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from './util';
import { ambienteDeAssinatura } from './runtime-ambiente';
import { carregarManifesto, exigirManifesto } from './manifest';
import { fusoDoManifesto, registrarFonteDoFuso } from './horario';
import { dirThread, lerThread, novaThread, resumoDaThread, exigirFase, pausaNaThread } from './thread';
import { lerLedger } from './ledger';
import { rodarFase } from './phase';
import { leasesColidentes } from './leases';
import { contextoHitl, abrirPedidoGate } from './hitl-gates';
import { CAMPOS_DA_DECISAO_NO_MCP, estadoDoPedido, recusaNaSuperficie, respostaAceitaDoPedido } from './hitl-contract';
import { apresentarDecisao, ofertaDoPedido, pedidoHitlAberto, prazoLocalDoPedido } from './hitl-presentation';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from './roadmap-status';
import { controleNativo } from './hitl-sessions';
import { criarIngressoLocal } from './hitl-local';
import {lerArtefatoMcp,escreverArtefatoMcp,listarClaimsMcp,adicionarClaimMcp,validarArquivosEstadoMcp} from './mcp-artifacts';
import {commitMcp,estadoGitMcp} from './mcp-git';
import {preflight} from './preflight';
import {exigirModoVivo,ORDEM_DOS_MODOS} from './modos';
import {VERSAO_DO_ORK} from './versao';
import {verificarMcp} from './mcp-verify';
import { conducaoDaThread, ErroDeConducao } from './conducao';
import { registrarDecisao } from './decisao-autonoma';
import { linhaDeConducao } from './conducao-texto';
import {criarPerfilShipMcp,PerfilShipMcp,shipMcp} from './mcp-ship';
import { registerBrainTools } from './company-brain-mcp';
import { ambienteDoPerfil, RegistroAgenteClaude } from './adapters/claude-bg';
import { classificarSessaoClaude, comFalhaDeConta, falhaDeContaDaTranscricao, fonteRegistrada, processoNativo, provaDoOrk,
  stopCorrelacionado } from './session-watcher-claude';
import { PerfilDeDespacho, perfilDoRegistro } from './runtime-profiles';
import { registerMaestro } from './mcp-maestro';

const identidade = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const daThread = z.object({ threadId: identidade }).strict();
const daDecisao = daThread.extend({ pedidoId: identidade }).strict();
/**
 * O modo de conducao no canal MCP: quem decide e o NUCLEO, o host so transporta.
 *
 * Com `z.enum(ORDEM_DOS_MODOS)` o canal devolvia a MESMA frase para um modo aposentado e
 * para um typo ("Invalid enum value. Expected 'classic' | ... received 'look'"): em
 * ingles, sem motivo tipado e sem dizer por qual modo trocar. O GOAL da I-43 pediu
 * recusa tipada em QUALQUER canal, e quem sabe separar `modo.aposentado` de
 * `modo.desconhecido` e `exigirModoVivo`, no nucleo. O `describe` mantem os modos vivos
 * visiveis na descoberta da ferramenta, derivados da mesma lista.
 */
const modoDeConducao = z.string().trim().min(1).max(40)
  .describe(`modo de conducao vivo: ${ORDEM_DOS_MODOS.join(', ')}`)
  .superRefine((bruto, ctx) => {
    try { exigirModoVivo(bruto); }
    catch (e) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message }); }
  })
  .transform((bruto) => exigirModoVivo(bruto));

const nova = z.object({ nome: z.string().trim().min(1).max(200),
  modo: modoDeConducao.optional() }).strict();
const fase = daThread.extend({ fase: z.enum(['GOAL','PLAN','GO','CHECK','SHIP','MASTER']),
  prompt: z.string().min(1).max(65536), runtime: z.enum(['claude-bg','codex']).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  effort: z.enum(['low','medium','high','xhigh','max']).optional(), dryRun: z.boolean().optional() }).strict();
// Limite de tipos do conversor externo: validacao continua no schema Zod strict.
const converterSchema=zodToJsonSchema as unknown as (schema:z.ZodTypeAny, opcoes:{$refStrategy:'none'})=>Record<string,unknown>;
const resposta = (valor: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(valor) }] });

export interface OpcoesServidorMcp { projeto: string; host: 'claude-code' | 'codex';threadId?:string;
  /** I-36 (D4): identidade do despacho da sessao filha; so com `threadId`. */
  dispatchId?:string;
  /** Exact trusted startup grants; not inferred from worktree/interactive. */
  brainWrites?: readonly string[];
  /** Opção de instalação confiável para bare físico; nunca argumento de ferramenta. */
  transporteShip?:'github-ssh'|'bare-local';permissoesFilho?:'interactive'|'worktree';nomesProviderHerdados?:string[] }

/** Factory publica para compor transporte nativo ou testes; nao executa ferramentas no startup. */
export function criarServidorMcp(opcoes: OpcoesServidorMcp): Server {
  if (!path.isAbsolute(opcoes.projeto)) throw Error('mcp.project.invalid: raiz absoluta obrigatoria');
  if (!['claude-code','codex'].includes(opcoes.host)) throw Error('mcp.host.invalid');
  if(opcoes.permissoesFilho!==undefined && !['interactive','worktree'].includes(opcoes.permissoesFilho))throw Error('mcp.child-permissions.invalid');
  if(opcoes.threadId!==undefined) identidade.parse(opcoes.threadId);
  if(opcoes.dispatchId!==undefined && (opcoes.threadId===undefined || !/^[a-f0-9-]{36}$/.test(opcoes.dispatchId)))
    throw Error('mcp.dispatch.invalid: identidade de despacho exige thread vinculada');
  // I-36 (D6): o canal do MCP e o host ja validado da conexao; a identidade so reentra (D4).
  const conducao={canal:opcoes.host,identidade:opcoes.dispatchId??null};
  const raiz = fs.realpathSync(opcoes.projeto);
  if (fs.realpathSync(exigirManifesto(raiz).raiz) !== raiz) throw Error('mcp.project.invalid: informe a raiz do manifesto');
  // I-35: o dono é o do projeto servido, não o do cwd de quem iniciou o servidor.
  registrarFonteDoFuso(() => fusoDoManifesto(carregarManifesto(raiz)));
  const fixacao = fs.statSync(raiz);
  let perfilShip:PerfilShipMcp|undefined,erroShip='mcp.ship.unavailable: perfil de transporte indisponivel';
  try {perfilShip=criarPerfilShipMcp(raiz,opcoes.transporteShip??'github-ssh');}
  catch(e) {const m=(e as Error).message;if(m.startsWith('mcp.'))erroShip=m;}

  const carregar = () => {
    const atual = fs.statSync(raiz);
    if (atual.dev !== fixacao.dev || atual.ino !== fixacao.ino || fs.realpathSync(raiz) !== raiz)
      throw Error('mcp.project.changed');
    const estado=path.join(raiz,'.orkastery');
    if(fs.existsSync(estado)) {
      const real=fs.realpathSync(estado);
      if(!real.startsWith(raiz+path.sep)) throw Error('mcp.scope.violation: estado fora do projeto');
    }
    const c = exigirManifesto(raiz);
    if (fs.realpathSync(c.raiz) !== raiz) throw Error('mcp.project.changed');
    return c;
  };
  const confinado = (file: string) => {
    const real = fs.realpathSync(file);
    if (real !== raiz && !real.startsWith(raiz + path.sep)) throw Error('mcp.scope.violation');
    return real;
  };
  const thread = (id: string) => {
    if(opcoes.threadId!==undefined && id!==opcoes.threadId) throw Error('mcp.thread.scope: sessao vinculada a outra thread');
    identidade.parse(id); carregar();
    confinado(dirThread(raiz,id));
    validarArquivosEstadoMcp(raiz,id);
    const t = lerThread(raiz,id);
    if (t.id !== id) throw Error('mcp.thread.identity');
    if (t.worktree) confinado(t.worktree);
    return t;
  };
  if(opcoes.threadId) thread(opcoes.threadId);
  const pendencias = (id: string) => {
    const t=thread(id), eventos=lerLedger(dirThread(raiz,id)), contexto=contextoHitl(raiz,id);
    const pedidos=[pedidoHitlAberto(raiz,id,t.faseAtual,null),
      ...t.sessoes.filter(s=>s.fase===t.faseAtual).map(s=>pedidoHitlAberto(raiz,id,t.faseAtual,s.sessionId))];
    // FX6: a oferta acompanha o pedido REAL. A conexao viva e ESTA: o host desta sessao MCP,
    // e so ele. Nenhum outro canal mcp-local sai `disponivel` daqui por suposicao.
    return pedidos.filter(p=>p && eventos.some(e=>e.tipo==='hitl_requested' && e.contexto===contexto &&
      (e.pedido as {id?:string})?.id===p.id)).map(p=>({pedido:p!,estado:estadoDoPedido(p!),
        canais:ofertaDoPedido(p!,[opcoes.host]),prazoLocal:prazoLocalDoPedido(p!)}));
  };
  const fases = (id:string) => {
    thread(id);
    const eventos=lerLedger(dirThread(raiz,id)).filter(e=>['phase_dispatch','phase_dispatch_verified','phase_result',
      'phase_dispatch_failed','session_watcher_started','gate_blocked'].includes(e.tipo));
    return {limite:20,omitidos:Math.max(0,eventos.length-20),eventos:eventos.slice(-20).map(e=>({
      tipo:e.tipo,ts:e.ts,fase:e.fase,sessionId:e.sessionId,runtime:e.runtime,model:e.model,effort:e.effort,
      classificacao:e.classificacao,motivo:e.motivo,encontrada:e.encontrada,controlador:e.controlador}))};
  };
  const observar = (id: string) => {
    const t=thread(id),eventos=lerLedger(dirThread(raiz,id));
    // I-34 (D8): a conclusão vem do phase_result do watcher ou, sem ele, da mesma tabela D2
    // aplicada a esta leitura única (sem cursor, só classificações imediatas). Nada é gravado.
    const turnoClaude=(s:typeof t.sessoes[number],nativo:RegistroAgenteClaude|null,perfil:PerfilDeDespacho|null,erroClaude:string)=>{
      const despachoEm=s.despachadaEm;
      if(typeof despachoEm!=='string' || !Number.isFinite(Date.parse(despachoEm)))
        return {estado:'nao-confirmado',conclusaoDeFase:'nao-inferida'};
      const sessao={sessionId:s.sessionId,fase:s.fase,despachadaEm:despachoEm};
      const stop=stopCorrelacionado(eventos.filter(e=>e.thread===id),sessao);
      const turno={estado:stop?'encerrado':'nao-confirmado',
        ...(stop?{evidencia:{tipo:stop.tipo,ts:stop.ts,sessionId:stop.sessionId,fase:stop.fase,
          runtime:stop.runtime,despachoEm:stop.despachoEm,sensorEventId:stop.sensorEventId}}:{})};
      const nome=(c:unknown,m:unknown)=>c==='fase_concluida'?'fase_concluida':`gate_blocked:${String(m)}`;
      const registrada=eventos.filter(e=>e.tipo==='phase_result' && e.runtime==='claude-bg' && e.sessionId===s.sessionId &&
        e.despachoEm===despachoEm && e.origem==='sessions.watch').at(-1);
      if(registrada) return {...turno,conclusaoDeFase:nome(registrada.classificacao,registrada.motivo),registrada:true,
        conclusao:{sensorResultId:registrada.sensorResultId,ts:registrada.ts,estadoNativo:registrada.estadoNativo,fonte:registrada.fonte}};
      const cursor={schema:'ork.session-cursor-claude/v1' as const,sessionId:s.sessionId,despachoEm};
      // D12: mesma prova do lado do `ork` que o watcher exige, só lida quando o turno terminou.
      const fonte=fonteRegistrada(eventos,sessao);
      const prova=()=>provaDoOrk(raiz,id,sessao,eventos,{artefato:fonte?.artefato,cwd:fonte?.cwd??path.resolve(t.worktree??raiz),head:fonte?.head});
      // I-33 (D11b): a leitura declara o mesmo motivo mais especifico que o watcher gravaria.
      const {c}=comFalhaDeConta(classificarSessaoClaude({sessao,eventos,consulta:{ok:erroClaude==='',registros:[],detalhe:erroClaude,consultadoEm:''},
        registro:nativo,cursor,agoraMs:Date.now(),limiteMs:Infinity,pausaAoFim:pausaNaThread(t,s.fase),
        prova,processo:processoNativo}),()=>falhaDeContaDaTranscricao(perfil,fonte?.cwd??path.resolve(t.worktree??raiz),s.sessionId));
      // D15 (6) e D17: sem Stop correlacionado e sem resultado registrado, a sessão encerrada pelo
      // condutor não ganha na leitura um gate que o ledger não tem, mas a leitura declara o que o
      // watcher grava para o mesmo estado. Com Stop, `stopped` segue a mesma regra do watcher.
      if(nativo?.state==='stopped' && !stop && c.terminal) return {...turno,conclusaoDeFase:'encerrada-pelo-condutor',registrada:false,
        classificacaoDoWatcher:nome(c.classificacao,c.motivo),
        conclusao:{fonte:'sessão encerrada pelo condutor (stopped) sem phase_result registrado',estadoNativo:'stopped',regraDoWatcher:c.fonte}};
      return c.terminal ? {...turno,conclusaoDeFase:nome(c.classificacao,c.motivo),registrada:false,
        conclusao:{fonte:c.fonte,estadoNativo:nativo?.state}} : {...turno,conclusaoDeFase:'nao-inferida'};
    };
    type SessaoNativa={sessionId:string;cwd:string;estado:string;state?:string;status?:string;divergenciaEstado:boolean;waitingFor?:string;pid?:number};
    // I-33 (D4): uma consulta por conta. Cada sessao claude-bg e observada com o env do perfil
    // gravado no seu registro; perfil invalido nao cai para o env do processo.
    const porConta=new Map<string,{claude:SessaoNativa[]|null;erroClaude:string}>();
    const consultarConta=(perfil:PerfilDeDespacho|null)=>{
      const chave=perfil?`${perfil.id}|${perfil.configDir}`:'(processo)';
      const pronta=porConta.get(chave); if(pronta) return pronta;
      let claude:SessaoNativa[]|null=null, erroClaude='';
      const r=exec('claude',['agents','--json','--all','--cwd',raiz],raiz,10000,perfil?ambienteDoPerfil(perfil):ambienteDeAssinatura());
      try {
        if(!r.ok || Buffer.byteLength(r.stdout)>1024*1024) throw Error('consulta Claude falhou ou excedeu limite');
        const schema=z.array(z.object({sessionId:z.string().uuid(),cwd:z.string().refine(path.isAbsolute),
          state:z.string().optional(),status:z.string().optional(),waitingFor:z.string().max(1000).nullable().optional()}).passthrough()).max(10000);
        const registros=schema.parse(JSON.parse(r.stdout));
        if(new Set(registros.map(s=>s.sessionId)).size!==registros.length) throw Error('sessao Claude duplicada');
        const estadoComparavel=(v:string)=>['working','running','busy'].includes(v)?'working':v;
        claude=registros.map(s=>({sessionId:s.sessionId,cwd:s.cwd,estado:s.state??s.status??'',state:s.state,status:s.status,
          divergenciaEstado:s.state!==undefined && s.status!==undefined && estadoComparavel(s.state)!==estadoComparavel(s.status),...(s.waitingFor?{waitingFor:s.waitingFor}:{}),
          ...(Number.isSafeInteger(s.pid) && (s.pid as number)>0?{pid:s.pid as number}:{})}));
      } catch {erroClaude='observacao nativa indisponivel: consulta Claude escopada falhou ou retornou formato invalido';}
      const resultado={claude,erroClaude}; porConta.set(chave,resultado); return resultado;
    };
    const nativas=t.sessoes.map(s=>{
      if(s.runtime==='claude-bg') {
        let perfil:PerfilDeDespacho|null;
        try {perfil=perfilDoRegistro(eventos,{sessionId:s.sessionId,despachadaEm:s.despachadaEm});}
        catch {return {sessionId:s.sessionId,runtime:s.runtime,disponivel:false,
          detalhe:'observacao nativa indisponivel: perfil registrado da sessao invalido'};}
        const {claude,erroClaude}=consultarConta(perfil);
        const sessao=claude?.find(x=>x.sessionId===s.sessionId && x.cwd===path.resolve(t.worktree??raiz));
        const nativo=sessao?{sessionId:sessao.sessionId,cwd:sessao.cwd,state:sessao.state,status:sessao.status,pid:sessao.pid}:null;
        return {sessionId:s.sessionId,runtime:s.runtime,disponivel:!!sessao,turno:turnoClaude(s,nativo,perfil,erroClaude),
          ...(perfil?{perfil:perfil.id}:{}),
          ...(sessao?{sessao}:{detalhe:erroClaude||'observacao nativa indisponivel: UUID/cwd da fase nao encontrado na consulta escopada'})};
      }
      if(s.runtime!=='codex') return {sessionId:s.sessionId,runtime:s.runtime,disponivel:false,
        detalhe:'observacao nativa indisponivel: runtime nao suportado'};
      try {
        const consulta=controleNativo(s.runtime,raiz,id,s.sessionId).consultar();
        const sessao=consulta.sessoes.find(x=>x.sessionId===s.sessionId && x.cwd===path.resolve(t.worktree??raiz));
        return {sessionId:s.sessionId,runtime:s.runtime,disponivel:consulta.ok && !!sessao,
          ...(sessao?{sessao}:{detalhe:'observacao nativa indisponivel: sessao nao confirmada pelo controller vinculado'})};
      } catch(e) {return {sessionId:s.sessionId,runtime:s.runtime,disponivel:false,detalhe:(e as Error).message};}
    });
    return {thread:t,phases:fases(id),pendencias:pendencias(id),nativas};
  };
  const livre = (id?: string) => {
    const nomes = ['main-tree', ...(id ? ['worktree-write:'+id] : [])];
    for (const nome of nomes) {
      const conflitos = leasesColidentes(raiz,nome,id);
      if (conflitos.length) throw Error('lease.busy: '+conflitos.map(l=>l.nome+' ('+l.thread+')').join(', '));
    }
  };
  const server = new Server({ name:'orkastery', version:VERSAO_DO_ORK },
    { capabilities:{tools:{}}, instructions:'Opere somente este projeto pelas ferramentas do nucleo. Decisoes humanas usam ork_request_decision e o dialogo do host; argumentos de ferramenta nunca sao respostas.' });
  const ferramentas=new Map<string,{tool:Tool; executar:(raw:unknown,extra:{signal:AbortSignal})=>Promise<CallToolResult>}>();
  function registrarTool<S extends z.AnyZodObject>(nome:string,
    config:{description:string;inputSchema:S;annotations:Tool['annotations']},
    executar:(args:z.infer<S>,extra:{signal:AbortSignal})=>Promise<CallToolResult>) {
    if(opcoes.threadId && ['ork_thread_new','ork_phase_run','ork_request_decision','ork_preflight'].includes(nome)) return;
    const schema=converterSchema(config.inputSchema,{$refStrategy:'none'});
    ferramentas.set(nome,{tool:{name:nome,description:config.description,annotations:config.annotations,
      inputSchema:schema as Tool['inputSchema']},
      executar:async(raw,extra)=>executar(config.inputSchema.parse(raw),extra)});
  }
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...ferramentas.values()].map(f=>f.tool)}));
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    try {
      const f=ferramentas.get(request.params.name);if(!f) throw Error('mcp.tool.unknown');
      return await f.executar(request.params.arguments??{},extra);
    } catch(e) {return {...resposta({erro:(e as Error).message}),isError:true};}
  });
  const ingresso = criarIngressoLocal(raiz,{host:opcoes.host,connectionId:randomUUID()},async (pedido,signal) => {
    carregar(); thread(pedido.thread);
    // D12: pergunta nativa que aceita texto NAO vira menu. Um menu sobre pergunta aberta
    // muda a pergunta, e a resposta que chega a sessao deixa de ser a do humano.
    // I-41: a recusa de quem nao tem dialogo mora no contrato, e por isso ela vem primeiro.
    // Depois dela sempre ha resposta aceita; ler `maxCaracteres` de um default inventaria um
    // limite para um formulario que nunca chega a ser montado.
    const apresentacao = apresentarDecisao(pedido);
    const aceita = respostaAceitaDoPedido(pedido)!;
    const livre = aceita.tipo === 'texto';
    const limite = Math.min(4096, Math.max(1, aceita.maxCaracteres));
    const r = await server.elicitInput({ mode:'form',
      message:apresentacao.mensagem,
      requestedSchema:{type:'object',properties:{opcao:livre
        ?{type:'string',title:'Sua resposta',maxLength:limite}
        :{type:'string',title:'Sua decisão',oneOf:apresentacao.escolhas}},
        required:['opcao']} },{signal,timeout:300000});
    if (r.action !== 'accept') return {action:r.action};
    const parsed = z.object({opcao:z.string().min(1).max(limite)}).strict().parse(r.content);
    return {action:'accept',content:parsed};
  });
  server.onclose = () => ingresso.fechar();
  registerBrainTools(registrarTool,carregar,thread,opcoes.brainWrites??[]);
  registerMaestro(registrarTool,{root:raiz,threadId:opcoes.threadId,load:carregar,checkThread:thread,tools:()=>[...ferramentas.keys()]});
  registrarTool('ork_preflight',{description:'Preflight contextual por modo e bloco, sem inventário global/modelos. Não autoriza despacho nem comprova entrega.',
    inputSchema:z.object({modo:modoDeConducao}).strict(),annotations:{readOnlyHint:true}},async({modo})=>{
      carregar();return resposta(preflight(raiz,modo,opcoes.nomesProviderHerdados));
    });
  registrarTool('ork_git_status',{description:'Consulta HEADs locais atuais da worktree e branch de destino fixadas. Nao consulta a rede nem reserva os HEADs; commit e SHIP revalidam seus valores.',
    inputSchema:daThread,annotations:{readOnlyHint:true}},async({threadId})=>{
      thread(threadId);return resposta(estadoGitMcp(raiz,threadId));
    });
  registrarTool('ork_ship',{description:'Entrega pela API oficial: verifica em sandbox, mergeia e prova push no unico origin fixado no startup. Exige HEADs fonte/destino e respeita gates; interrupcao exige reconciliacao.',
    inputSchema:daThread.extend({expectedSource:z.string().regex(/^[a-f0-9]{40}$/),expectedDestination:z.string().regex(/^[a-f0-9]{40}$/)}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},async(args,extra)=>{
      thread(args.threadId);livre(args.threadId);
      if(!perfilShip)throw Error(erroShip);
      const r=await shipMcp(perfilShip,args,extra.signal);return {...resposta(r),...(r.ok?{}:{isError:true})};
    });
  registrarTool('ork_verify',{description:'Reexecuta claims e verificadores do manifesto na worktree, em sandbox e com prazo total de tres minutos. Registra resultado real; falhas bloqueiam a verificacao.',
    inputSchema:daThread,annotations:{readOnlyHint:false,destructiveHint:false}},async({threadId})=>{
      thread(threadId);livre(threadId);
      try {
        const r=verificarMcp(raiz,threadId,conducao);return {...resposta(r),...(r.ok?{}:{isError:true})};
      } catch(e) {
        // I-36 (T18): a mesma recusa tipada do CLI, com o mesmo texto, sem reescrever nada no host.
        if(e instanceof ErroDeConducao) return {...resposta(e.recusa),isError:true};
        throw e;
      }
    });
  registrarTool('ork_git_commit',{description:'Commita somente paths com claims e HEAD esperado na worktree da thread. Recusa hooks/filtros ativos; preserva configuracao. Commit local nao e SHIP.',
    inputSchema:daThread.extend({expectedHead:z.string().regex(/^[a-f0-9]{40}$/),
      paths:z.array(z.string().min(1).max(512)).min(1).max(32),mensagem:z.string().trim().min(1).max(2048)}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:false}},async(args,extra)=>{
      thread(args.threadId);livre(args.threadId);
      const r=await commitMcp(raiz,args,extra.signal);return {...resposta(r),...(r.ok?{}:{isError:true})};
    });
  const documento=daThread.extend({tipo:z.enum(['goal','plan','check'])}).strict();
  registrarTool('ork_artifact_read',{description:'Le documento GOAL, PLAN ou CHECK da thread, com hash para revisao; nao le caminhos arbitrarios.',
    inputSchema:documento,annotations:{readOnlyHint:true}},async({threadId,tipo})=>{
      thread(threadId);return resposta(lerArtefatoMcp(raiz,threadId,tipo));
    });
  registrarTool('ork_artifact_write',{description:'Grava documento do agente no bloco atual com hash esperado (null para criar). Nao registra recibo oficial nem aprova gate.',
    inputSchema:documento.extend({conteudo:z.string().max(131072),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable()}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:false}},async({threadId,tipo,conteudo,expectedSha256})=>{
      thread(threadId);livre(threadId);return resposta(escreverArtefatoMcp(raiz,threadId,tipo,conteudo,expectedSha256));
    });
  // RM-037 (rm037defeito, defeito 1): a decisao que a sessao toma sem perguntar ao dono. O sandbox do
  // codex nao grava o ledger e o `ork decisao registrar` morria em EROFS. Mesma `registrarDecisao` do CLI:
  // contrato v2, criterio que resolve e rastro no mesmo evento. Nao pergunta ao dono e nao toca gate.
  const campoDaDecisao=z.string().min(1).max(4096);
  registrarTool('ork_decision_record',{description:'Registra decisao ja tomada pela sessao sem perguntar ao dono (classe decidido), com criterio que resolve e rastro. Nao pergunta, nao responde nem aprova gate.',
    inputSchema:daThread.extend({decidido:campoDaDecisao,porque:campoDaDecisao,comoMudar:campoDaDecisao,
      custoAgora:campoDaDecisao,custoDepois:campoDaDecisao,
      criterio:z.object({tipo:z.enum(['manifesto','ledger','medicao']),referencia:campoDaDecisao}).strict(),
      quemDecidiu:z.string().min(1).max(200),evidencia:campoDaDecisao,razao:campoDaDecisao.optional(),
      reverte:z.string().min(1).max(80).optional()}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:false}},async({threadId,...e})=>{
      thread(threadId);livre(threadId);
      // A sessao decide por ela: o rastro nao pode nascer assinado em nome do dono.
      if(/^\s*(?:o\s+|a\s+)?(?:dono|owner|builder|maestro)\b/i.test(e.quemDecidiu))
        throw Error('mcp.decision.author: quemDecidiu e a sessao que decidiu, nunca o dono');
      let registro:ReturnType<typeof registrarDecisao>;
      try {
        registro=registrarDecisao(raiz,threadId,{decidido:e.decidido,porque:e.porque,comoMudar:e.comoMudar,
          custoDeReverter:{agora:e.custoAgora,depois:e.custoDepois},criterio:e.criterio,quemDecidiu:e.quemDecidiu,
          evidencia:e.evidencia,...(e.razao?{razao:e.razao}:{}),...(e.reverte?{reverte:e.reverte}:{}),origem:'mcp',host:opcoes.host});
      } catch(erro) {throw Error(recusaNaSuperficie((erro as Error).message,CAMPOS_DA_DECISAO_NO_MCP));}
      const {pedido,evento}=registro;
      return resposta({ok:true,pedidoId:pedido.id,eventId:evento.eventId,fase:pedido.fase,reciboOficial:false});
    });
  registrarTool('ork_claims_list',{description:'Lista alegacoes e seu estado de verificacao registrado pelo nucleo.',
    inputSchema:daThread,annotations:{readOnlyHint:true}},async({threadId})=>{
      thread(threadId);return resposta(listarClaimsMcp(raiz,threadId));
    });
  registrarTool('ork_claim_add',{description:'Registra alegacao prospectiva e comandos como dados. Nao executa comandos nem declara a alegacao verificada.',
    inputSchema:daThread.extend({arquivo:z.string().min(1).max(500),alegacao:z.string().min(1).max(8192),
      verificar:z.array(z.string().min(1).max(8192)).max(20)}).strict(),annotations:{readOnlyHint:false,destructiveHint:false}},
    async({threadId,...entrada})=>{thread(threadId);livre(threadId);return resposta(adicionarClaimMcp(raiz,threadId,entrada));});
  registrarTool('ork_thread_status',{description:'Estado canonico de uma thread deste projeto; pausas previstas nao sao pedidos abertos.',
    inputSchema:daThread,annotations:{readOnlyHint:true}}, async ({threadId}) => {
      const t=thread(threadId); const c=conducaoDaThread(raiz,threadId);
      return resposta({thread:t,conducao:c,linhaDeConducao:c?linhaDeConducao(c):null,resumo:resumoDaThread(t,c)});
    });
  registrarTool('ork_phase_list',{description:'Despachos e resultados registrados da thread, sem despachar ou consultar outros projetos.',
    inputSchema:daThread,annotations:{readOnlyHint:true}},async ({threadId}) => {
      thread(threadId); return resposta({threadId,phases:fases(threadId)});
    });
  registrarTool('ork_hitl_pending',{description:'Pedidos HITL atuais da thread, incluindo prazo; nao aprova nem abre pedido.',
    inputSchema:daThread,annotations:{readOnlyHint:true}},async ({threadId}) => resposta({threadId,pendencias:pendencias(threadId)}));
  registrarTool('ork_roadmap_status',{description:'Status report unico do roadmap no formato aprovado pelo dono: grupos com icones, #HITL no que espera o dono e o fecho. Somente leitura; transporte o texto como vem.',
    inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async () => {
      const c=carregar(); const status=montarStatusDoRoadmap(raiz,{projeto:c.manifesto.project.name});
      return resposta({texto:textoDoStatusDoRoadmap(status),status});
    });
  registrarTool('ork_observe',{description:'Observa uma vez o progresso canonico e pedidos da thread. Nao cria monitor ou despacho.',
    inputSchema:daThread,annotations:{readOnlyHint:true}},async ({threadId}) => {
      return resposta(observar(threadId));
    });
  registrarTool('ork_thread_new',{description:'Cria uma thread para a demanda autorizada, com worktree isolada; modo validado pelo nucleo. Nao inicia modelo.',
    inputSchema:nova,annotations:{readOnlyHint:false,destructiveHint:false}},async ({nome,modo}) => {
      const c=carregar(); livre();
      const destino=path.resolve(raiz,c.manifesto.worktree.dir);
      if (!destino.startsWith(raiz+path.sep)) throw Error('mcp.scope.violation: worktree.dir fora do projeto');
      // Validar ancestrais existentes antes de o nucleo criar o diretorio.
      let existente=destino; while (!fs.existsSync(existente)) existente=path.dirname(existente);
      confinado(existente);
      return resposta(novaThread(c,{nome,modo:modo??c.manifesto.conduction.default_mode,criarWorktree:true}));
    });
  registrarTool('ork_phase_run',{description:'Despacha fase autorizada pelo nucleo, preservando policies, estado e runtime/modelo. dryRun nao inicia modelo, mas pode registrar prompt/eventos.',
    inputSchema:fase,annotations:{readOnlyHint:false,destructiveHint:false}},async (args) => {
      const t=thread(args.threadId); livre(t.id);
      const {threadId,fase:f,...op}=args;
      // RM-037 (A3): o MCP nao roda a suite para a baseline do despacho; a falta dela volta como pendencia.
      return resposta(rodarFase(carregar(),threadId,{...op,fase:exigirFase(t,f),canal:conducao.canal,baselinePeloDespacho:false}));
    });
  registrarTool('ork_gate_request',{description:'Abre pedido de gate somente quando pausa ou escalacao tipada esta comprovada no nucleo; nao aprova.',
    inputSchema:daThread.extend({motivo:z.enum(['human.pending','policy.violation','cost.violation',
      'retry.max_tentativas','hitl.credencial','runtime.unavailable']).optional()}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:false}},async({threadId,motivo})=>{
      thread(threadId); livre(threadId); return resposta(abrirPedidoGate(raiz,threadId,motivo));
    });
  registrarTool('ork_request_decision',{description:'Apresenta pedido existente ao dono por dialogo nativo. Somente IDs; nunca forneca resposta nos argumentos.',
    inputSchema:daDecisao,annotations:{readOnlyHint:false,destructiveHint:false}},async ({threadId,pedidoId},extra) => {
      thread(threadId); return resposta(await ingresso.solicitar(threadId,pedidoId,extra.signal));
    });
  return server;
}

export async function servirMcp(opcoes: OpcoesServidorMcp): Promise<void> {
  const server=criarServidorMcp(opcoes);
  await server.connect(new StdioServerTransport());
}

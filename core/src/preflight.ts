/** Preflight contextual de despacho: nenhuma sessão, instalação ou configuração é alterada. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto } from './manifest';
import { raizDoEstado } from './estado-thread';
import { conferirAuth as authClaude, StatusDeAuth } from './adapters/claude-bg';
import { conferirAuth as authCodex } from './adapters/codex';
import { lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDisponivel, perfisDoRuntime } from './runtime-profiles';
import { MODOS, ORDEM_DOS_MODOS } from './modos';
import { lerSetup, configDoBloco } from './setup';
import { resolverDespacho } from './phase';
import { resolverRuntime } from './runtimes';
import { sondarSandbox } from './adapters/codex';
import { nomesDeProviderAtivos, ENVS_DE_PROVIDER_PAGO } from './runtime-ambiente';
import { validarAbbrev } from './slug';
import { exec, noPath } from './util';
import { legendaDoFuso, localizarTexto } from './horario';
import { Check, Modo } from './types';

/** Injeção interna para contraprovas determinísticas, nunca argumento CLI/MCP. */
export interface SensoresPreflight {
  runtime(nome:string):boolean;
  sandboxCodex():boolean;
  /** I-33 (D7): login do perfil conferido pelo proprio CLI com o env dele. */
  auth?(perfil:PerfilDeDespacho):StatusDeAuth;
}
const authPadrao=(p:PerfilDeDespacho):StatusDeAuth=>p.runtime==='claude-bg'?authClaude(p):authCodex(p);
const sensoresPadrao:SensoresPreflight={
  runtime:nome=>!!resolverRuntime(nome).disponivel(),
  sandboxCodex:()=>sondarSandbox().ok,
  auth:authPadrao,
};

/** umask efetivo do processo, lido de /proc (Linux) para nao usar o getter deprecado. */
export function umaskDoProcesso():number|null {
  try {
    const m=/^Umask:\s*([0-7]+)$/m.exec(fs.readFileSync('/proc/self/status','utf8'));
    return m?parseInt(m[1],8):null;
  } catch {return null;}
}

/**
 * I-33 (D7): sonda de umask e das permissoes do estado, coerente com a recusa 0o022 do sensor
 * (rollout e diretorio pai) e com o 0700 exato da pasta privada (HITL e perfis). Umask que deixa
 * grupo ou outros escreverem afrouxa o que o runtime cria e o sensor reprova depois.
 */
export function sondasDeAmbiente(raiz:string,umask:number|null=umaskDoProcesso()):Check[] {
  const checks:Check[]=[];
  const octal=(v:number)=>'0'+v.toString(8).padStart(3,'0');
  checks.push(umask===null?{nome:'umask',nivel:'warn',detalhe:'umask do processo nao medido nesta plataforma'}
    :(umask&0o022)===0o022?{nome:'umask',nivel:'ok',detalhe:`umask ${octal(umask)} nega escrita de grupo e outros`}
    :{nome:'umask',nivel:'warn',detalhe:`umask ${octal(umask)} permite escrita de grupo ou outros: o que o runtime criar sera recusado pelo sensor (bits 0o022)`,
      correcao:'umask 022 (ou 077) no shell que roda o ork e os runtimes'});
  const estado=path.join(raizDoEstado(raiz),'.orkastery');
  let st:fs.Stats|null=null;
  try {st=fs.lstatSync(estado);} catch {/* ausencia e do check de estado do projeto */}
  if(st) checks.push(!st.isDirectory() || st.isSymbolicLink()?{nome:'permissoes do estado',nivel:'fail',detalhe:`${estado} nao e diretorio real`}
    :st.mode&0o022?{nome:'permissoes do estado',nivel:'warn',detalhe:`${estado} com modo ${octal(st.mode&0o777)}: grupo ou outros podem escrever no estado`,correcao:`chmod go-w ${estado}`}
    :{nome:'permissoes do estado',nivel:'ok',detalhe:`${estado} com modo ${octal(st.mode&0o777)}`});
  const privada=path.join(estado,'private');
  let sp:fs.Stats|null=null;
  try {sp=fs.lstatSync(privada);} catch {/* criada sob demanda */}
  checks.push(!sp?{nome:'pasta privada',nivel:'ok',detalhe:`${privada} ausente: criada sob demanda com 0700`}
    :!sp.isDirectory() || sp.isSymbolicLink() || sp.uid!==process.getuid?.() || (sp.mode&0o777)!==0o700
      ?{nome:'pasta privada',nivel:'fail',detalhe:`${privada} precisa ser diretorio 0700 do proprio usuario (modo ${octal(sp.mode&0o777)}): recibo HITL e perfis recusam`,correcao:`chmod 700 ${privada}`}
      :{nome:'pasta privada',nivel:'ok',detalhe:`${privada} com modo 0700`});
  return checks;
}

/**
 * I-33 (D7): contas do runtime do bloco. Sem perfil, o despacho usa o ambiente do processo e
 * nada e sondado (P8). Com perfis, o bloco so fica pronto com ao menos um perfil disponivel e
 * com login conferido pelo proprio CLI. A sonda nao marca o store: quem marca e o despacho.
 */
export function checkDeContas(raiz:string,runtime:string,auth:(p:PerfilDeDespacho)=>StatusDeAuth=authPadrao):Check {
  let perfis;
  try {perfis=perfisDoRuntime(lerPerfisComContas(raiz),runtime).filter(p=>p.estado!=='desativado');}
  catch(e) {return {nome:'contas',nivel:'fail',detalhe:`store de perfis invalido: ${(e as Error).message}`}}
  if(!perfis.length) return {nome:'contas',nivel:'ok',detalhe:`${runtime} sem perfil configurado: despacho pelo ambiente do processo`};
  const estados=perfis.map(p=>{const a=auth(perfilDeDespacho(p));return {id:p.id,pronto:a.ok && perfilDisponivel(p),
    texto:!a.ok?`${a.pago?'provider pago, nunca despacha':a.transitorio?'conferencia de login inconclusiva':'sem login'} (${a.detalhe})`:perfilDisponivel(p)?'pronto':`${p.estado}${p.esgotadoAte?` ate ${p.esgotadoAte}`:''}`};});
  const prontos=estados.filter(e=>e.pronto).length;
  return {nome:'contas',nivel:prontos===0?'fail':prontos<estados.length?'warn':'ok',
    detalhe:`${runtime}: ${estados.map(e=>`${e.id} ${e.texto}`).join('; ')}`,
    ...(prontos<estados.length?{correcao:'ork accounts check marca os perfis; ork accounts add refaz o login pelo proprio CLI'}:{})};
}

const limites=[
  'Sonda contextual local: não inventaria sessões, não inicia modelo e não autoriza despacho.',
  'Aceitação do modelo, instalação do adaptador/MCP, contexto da thread, gates e policies do pedido são revalidados no despacho; com perfis, o login de cada conta é conferido aqui e de novo no despacho.',
  'Trio sem override; um override posterior exige resolver e verificar novamente o despacho.',
  'VERIFY/SHIP MCP exigem executor Codex isolado próprio e transporte SHIP válido; a sonda de despacho não comprova entrega.',
];
export function preflight(raiz:string,modo:Modo,nomesHerdados=nomesDeProviderAtivos(),sensores:SensoresPreflight=sensoresPadrao) {
  // I-43: a matriz tem os cinco (para LER thread antiga); quem entra aqui e ESCRITA.
  if(!(ORDEM_DOS_MODOS as readonly string[]).includes(modo))throw Error('preflight.mode.invalid');
  const checks:Check[]=[];
  checks.push({nome:'node',nivel:Number(process.versions.node.split('.')[0])>=20?'ok':'fail',detalhe:'Node 20 ou superior necessário'});
  const git=!!noPath('git');
  checks.push({nome:'git',nivel:git?'ok':'fail',detalhe:git?'Git disponível':'Git ausente'});
  const repo=git?exec('git',['rev-parse','--is-inside-work-tree'],raiz,10000):null;
  checks.push({nome:'repositorio',nivel:repo?.ok && repo.stdout.trim()==='true'?'ok':'fail',detalhe:'Repositório Git local necessário'});
  checks.push(...sondasDeAmbiente(raiz));
  const carregado=carregarManifesto(raiz);
  const blocos:Array<{numero:number;fases:string[];trio:{runtime:string;model:string;effort:string}|null;checks:Check[];pronto:boolean}>=[];
  checks.push({nome:'manifesto',nivel:!carregado || carregado.erros.length?'fail':'ok',detalhe:!carregado?'Manifesto ausente':carregado.erros.length?'Manifesto inválido; corrija antes do despacho':'Manifesto válido'});
  if(carregado && !carregado.erros.length) {
    const m=carregado.manifesto;
    checks.push({nome:'modo',nivel:m.conduction.allowed_modes.includes(modo)?'ok':'fail',detalhe:`Modo solicitado: ${modo}`});
    checks.push({nome:'abbrev',nivel:validarAbbrev(m.project.abbrev).ok?'ok':'fail',detalhe:'Identidade curta do projeto validada'});
    const setup=lerSetup(carregado.raiz),observados=new Map<string,boolean>(),contas=new Map<string,Check>();
    let sandbox:boolean|undefined;
    for(const [i,bloco] of MODOS[modo].blocos.entries()) {
      const locais:Check[]=[];let trio:{runtime:string;model:string;effort:string}|null=null;
      try {
        trio=resolverDespacho(m,{},configDoBloco(setup,modo,bloco.fases[0]));
        resolverRuntime(trio.runtime);
        locais.push({nome:'trio',nivel:'ok',detalhe:'Runtime/modelo/esforço resolvidos pelo mesmo contrato do despacho; aceitação nativa não comprovada'});
        if(!observados.has(trio.runtime))observados.set(trio.runtime,sensores.runtime(trio.runtime));
        const presente=observados.get(trio.runtime)!;
        locais.push({nome:'runtime',nivel:presente?'ok':'fail',detalhe:presente?`${trio.runtime} disponível`:`${trio.runtime} ausente`});
        if(presente) {
          if(!contas.has(trio.runtime))contas.set(trio.runtime,checkDeContas(carregado.raiz,trio.runtime,sensores.auth??authPadrao));
          locais.push(contas.get(trio.runtime)!);
        }
        if(trio.runtime==='codex' && presente) {
          sandbox??=sensores.sandboxCodex();
          locais.push({nome:'sandbox de despacho',nivel:sandbox?'ok':m.runtime.sandbox==='danger-full-access'?'warn':'fail',detalhe:sandbox?'Sonda Codex sem modelo executou':'Sonda Codex falhou; não altere o sandbox para contornar a falha'});
        }
        const ativos=nomesHerdados.filter(n=>(ENVS_DE_PROVIDER_PAGO as readonly string[]).includes(n));
        const relevantes=ativos.filter(n=>trio!.runtime==='claude-bg'?/^(ANTHROPIC_|CLAUDE_CODE_USE_)/.test(n):/^(OPENAI_|OPENROUTER_)/.test(n));
        locais.push({nome:'provider',nivel:m.runtime.provider_policy==='subscription-only' && relevantes.length?'fail':ativos.length?'warn':'ok',detalhe:relevantes.length?`Nomes de provider incompatíveis com assinatura: ${relevantes.join(', ')}`:ativos.length?'Há nomes de provider alheios ao runtime; não usar credenciais pagas':'Nenhum nome de provider pago ativo'});
      } catch {
        locais.push({nome:'trio',nivel:'fail',detalhe:'Setup/trio ou sonda inválidos; complete o modelo e confira o runtime no setup canônico'});
      }
      blocos.push({numero:i+1,fases:[...bloco.fases],trio,checks:locais,pronto:locais.every(c=>c.nivel!=='fail')});
    }
  }
  const basePronta=checks.every(c=>c.nivel!=='fail');
  return {modo,scope:'dispatch-local' as const,checks,blocos,
    prontoPrimeiroBloco:basePronta && !!blocos[0]?.pronto,
    prontoTodosBlocos:basePronta && blocos.length>0 && blocos.every(b=>b.pronto),
    entrega:{verificada:false as const,dependencias:['executor Codex isolado','transporte SHIP instalado','gates e HEADs correntes']},limites:[...limites]};
}
export function textoPreflight(r:ReturnType<typeof preflight>):string {
  // I-35: o Check guarda o ISO (dado de maquina); quem imprime para o dono localiza.
  let localizou=false;
  const local=(t:string):string=>{const l=localizarTexto(t);if(l!==t)localizou=true;return l;};
  const linhas=['ork doctor contextual: '+r.modo,...r.checks.map(c=>`${c.nivel}: ${c.nome}: ${local(c.detalhe)}`),
    ...r.blocos.flatMap(b=>[`bloco ${b.numero} ${b.fases.join('→')}: ${b.trio?`${b.trio.runtime}/${b.trio.model}/${b.trio.effort}`:'trio pendente'}`,...b.checks.map(c=>`  ${c.nivel}: ${c.nome}: ${local(c.detalhe)}`)]),
    `Primeiro bloco: ${r.prontoPrimeiroBloco?'sonda pronta':'bloqueado'}; todos os blocos: ${r.prontoTodosBlocos?'sonda pronta':'dependências pendentes'}`,...r.limites];
  // O fuso sai uma vez por mensagem, depois dos limites.
  if(localizou)linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

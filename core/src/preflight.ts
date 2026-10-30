/** Preflight contextual de despacho: nenhuma sessão, instalação ou configuração é alterada. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto } from './manifest';
import { raizDoEstado } from './estado-thread';
import { conferirAuth as authClaude, StatusDeAuth } from './adapters/claude-bg';
import { conferirAuth as authCodex } from './adapters/codex';
import { conferirAuth as authGrok } from './adapters/grok';
import { lerPerfisComContas, perfilDeDespacho, PerfilDeDespacho, perfilDisponivel, perfisDoRuntime } from './runtime-profiles';
import { MODOS, ORDEM_DOS_MODOS } from './modos';
import { lerSetup, configDoBloco } from './setup';
import { resolverDespacho } from './phase';
import { resolverRuntime } from './runtimes';
import { msg } from './locale';
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
const authPadrao=(p:PerfilDeDespacho):StatusDeAuth=>p.runtime==='claude-bg'?authClaude(p):p.runtime==='grok'?authGrok(p):authCodex(p);
const sensoresPadrao:SensoresPreflight={
  runtime:nome=>!!resolverRuntime(nome).disponivel(),
  sandboxCodex:()=>sondarSandbox().ok,
  auth:authPadrao,
};

/**
 * O sensor recusa fonte com escrita de grupo ou de outros (bits 0o022). O ork acrescenta esses bits
 * ao umask do proprio processo, sem nunca afrouxar um umask mais restrito (077 continua 077): tudo o
 * que ele cria, e tudo o que ele despacha (claude, codex), nasce sem escrita alheia, qualquer que
 * seja o umask do shell de quem roda. Devolve o umask anterior e o que ficou valendo.
 */
export function endurecerUmask():{anterior:number;atual:number} {
  const anterior=process.umask(0o077);
  const atual=anterior|0o022;
  process.umask(atual);
  return {anterior,atual};
}

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
  const m=msg().doctor;
  checks.push(umask===null?{nome:'umask',nivel:'warn',detalhe:m.umaskNaoMedido}
    :(umask&0o022)===0o022?{nome:'umask',nivel:'ok',detalhe:m.umaskOk(octal(umask))}
    :{nome:'umask',nivel:'warn',detalhe:m.umaskAberto(octal(umask)),correcao:m.umaskCorrecao});
  const estado=path.join(raizDoEstado(raiz),'.orkastery');
  let st:fs.Stats|null=null;
  try {st=fs.lstatSync(estado);} catch {/* ausencia e do check de estado do projeto */}
  if(st) checks.push(!st.isDirectory() || st.isSymbolicLink()?{nome:'permissoes do estado',nivel:'fail',detalhe:m.estadoNaoDiretorio(estado)}
    :st.mode&0o022?{nome:'permissoes do estado',nivel:'warn',detalhe:m.estadoAberto(estado,octal(st.mode&0o777)),correcao:`chmod go-w ${estado}`}
    :{nome:'permissoes do estado',nivel:'ok',detalhe:m.estadoComModo(estado,octal(st.mode&0o777))});
  const privada=path.join(estado,'private');
  let sp:fs.Stats|null=null;
  try {sp=fs.lstatSync(privada);} catch {/* criada sob demanda */}
  checks.push(!sp?{nome:'pasta privada',nivel:'ok',detalhe:m.privadaAusente(privada)}
    :!sp.isDirectory() || sp.isSymbolicLink() || sp.uid!==process.getuid?.() || (sp.mode&0o777)!==0o700
      ?{nome:'pasta privada',nivel:'fail',detalhe:m.privadaAberta(privada,octal(sp.mode&0o777)),correcao:`chmod 700 ${privada}`}
      :{nome:'pasta privada',nivel:'ok',detalhe:m.privadaOk(privada)});
  return checks;
}

/**
 * I-33 (D7): contas do runtime do bloco. Sem perfil, o despacho usa o ambiente do processo e
 * nada e sondado (P8). Com perfis, o bloco so fica pronto com ao menos um perfil disponivel e
 * com login conferido pelo proprio CLI. A sonda nao marca o store: quem marca e o despacho.
 */
export function checkDeContas(raiz:string,runtime:string,auth:(p:PerfilDeDespacho)=>StatusDeAuth=authPadrao):Check {
  const m=msg().preflight;
  let perfis;
  try {perfis=perfisDoRuntime(lerPerfisComContas(raiz),runtime).filter(p=>p.estado!=='desativado');}
  catch(e) {return {nome:'contas',nivel:'fail',detalhe:m.storeInvalido((e as Error).message)}}
  if(!perfis.length) return {nome:'contas',nivel:'ok',detalhe:m.semPerfil(runtime)};
  const estados=perfis.map(p=>{const a=auth(perfilDeDespacho(p));return {id:p.id,pronto:a.ok && perfilDisponivel(p),
    texto:!a.ok?`${a.pago?m.estadoConta.providerPago:a.transitorio?m.estadoConta.loginInconclusivo:m.estadoConta.semLogin} (${a.detalhe})`
      :perfilDisponivel(p)?m.estadoConta.pronto:m.estadoConta.esgotadoAte(p.estado,p.esgotadoAte??'')};});
  const prontos=estados.filter(e=>e.pronto).length;
  return {nome:'contas',nivel:prontos===0?'fail':prontos<estados.length?'warn':'ok',
    detalhe:m.contas(runtime,estados.map(e=>`${e.id} ${e.texto}`).join('; ')),
    ...(prontos<estados.length?{correcao:m.contasCorrecao}:{})};
}
export function preflight(raiz:string,modo:Modo,nomesHerdados=nomesDeProviderAtivos(),sensores:SensoresPreflight=sensoresPadrao) {
  const t=msg().preflight;
  // I-43: a matriz tem os cinco (para LER thread antiga); quem entra aqui e ESCRITA.
  if(!(ORDEM_DOS_MODOS as readonly string[]).includes(modo))throw Error('preflight.mode.invalid');
  const checks:Check[]=[];
  checks.push({nome:'node',nivel:Number(process.versions.node.split('.')[0])>=20?'ok':'fail',detalhe:t.node});
  const git=!!noPath('git');
  checks.push({nome:'git',nivel:git?'ok':'fail',detalhe:git?t.gitOk:t.gitAusente});
  const repo=git?exec('git',['rev-parse','--is-inside-work-tree'],raiz,10000):null;
  checks.push({nome:'repositorio',nivel:repo?.ok && repo.stdout.trim()==='true'?'ok':'fail',detalhe:t.repo});
  checks.push(...sondasDeAmbiente(raiz));
  const carregado=carregarManifesto(raiz);
  const blocos:Array<{numero:number;fases:string[];trio:{runtime:string;model:string;effort:string}|null;checks:Check[];pronto:boolean}>=[];
  checks.push({nome:'manifesto',nivel:!carregado || carregado.erros.length?'fail':'ok',detalhe:!carregado?t.manifestoAusente:carregado.erros.length?t.manifestoInvalido:t.manifestoValido});
  if(carregado && !carregado.erros.length) {
    const m=carregado.manifesto;
    checks.push({nome:'modo',nivel:m.conduction.allowed_modes.includes(modo)?'ok':'fail',detalhe:t.modo(modo)});
    checks.push({nome:'abbrev',nivel:validarAbbrev(m.project.abbrev).ok?'ok':'fail',detalhe:t.abbrev});
    const setup=lerSetup(carregado.raiz),observados=new Map<string,boolean>(),contas=new Map<string,Check>();
    let sandbox:boolean|undefined;
    for(const [i,bloco] of MODOS[modo].blocos.entries()) {
      const locais:Check[]=[];let trio:{runtime:string;model:string;effort:string}|null=null;
      try {
        trio=resolverDespacho(m,{},configDoBloco(setup,modo,bloco.fases[0]));
        resolverRuntime(trio.runtime);
        locais.push({nome:'trio',nivel:'ok',detalhe:t.trio});
        if(!observados.has(trio.runtime))observados.set(trio.runtime,sensores.runtime(trio.runtime));
        const presente=observados.get(trio.runtime)!;
        locais.push({nome:'runtime',nivel:presente?'ok':'fail',detalhe:presente?t.runtimeOk(trio.runtime):t.runtimeAusente(trio.runtime)});
        if(presente) {
          if(!contas.has(trio.runtime))contas.set(trio.runtime,checkDeContas(carregado.raiz,trio.runtime,sensores.auth??authPadrao));
          locais.push(contas.get(trio.runtime)!);
        }
        if(trio.runtime==='codex' && presente) {
          sandbox??=sensores.sandboxCodex();
          locais.push({nome:'sandbox de despacho',nivel:sandbox?'ok':m.runtime.sandbox==='danger-full-access'?'warn':'fail',detalhe:sandbox?t.sandboxOk:t.sandboxFalhou});
        }
        const ativos=nomesHerdados.filter(n=>(ENVS_DE_PROVIDER_PAGO as readonly string[]).includes(n));
        const relevantes=ativos.filter(n=>trio!.runtime==='claude-bg'?/^(ANTHROPIC_|CLAUDE_CODE_USE_)/.test(n):/^(OPENAI_|OPENROUTER_)/.test(n));
        locais.push({nome:'provider',nivel:m.runtime.provider_policy==='subscription-only' && relevantes.length?'fail':ativos.length?'warn':'ok',
          detalhe:relevantes.length?t.providerIncompativel(relevantes.join(', ')):ativos.length?t.providerAlheio:t.providerNenhum});
      } catch {
        locais.push({nome:'trio',nivel:'fail',detalhe:t.trioInvalido});
      }
      blocos.push({numero:i+1,fases:[...bloco.fases],trio,checks:locais,pronto:locais.every(c=>c.nivel!=='fail')});
    }
  }
  const basePronta=checks.every(c=>c.nivel!=='fail');
  return {modo,scope:'dispatch-local' as const,checks,blocos,
    prontoPrimeiroBloco:basePronta && !!blocos[0]?.pronto,
    prontoTodosBlocos:basePronta && blocos.length>0 && blocos.every(b=>b.pronto),
    entrega:{verificada:false as const,dependencias:['executor Codex isolado','transporte SHIP instalado','gates e HEADs correntes']},limites:[...t.limites]};
}
export function textoPreflight(r:ReturnType<typeof preflight>):string {
  // I-35: o Check guarda o ISO (dado de maquina); quem imprime para o dono localiza.
  let localizou=false;
  const local=(t:string):string=>{const l=localizarTexto(t);if(l!==t)localizou=true;return l;};
  const m=msg().preflight,nome=(v:string)=>m.nomes[v]??v;
  const linhas=[m.titulo(r.modo),...r.checks.map(c=>m.check(c.nivel,nome(c.nome),local(c.detalhe))),
    ...r.blocos.flatMap(b=>[m.bloco(b.numero,b.fases.join('→'),b.trio?`${b.trio.runtime}/${b.trio.model}/${b.trio.effort}`:null),
      ...b.checks.map(c=>m.checkDoBloco(c.nivel,nome(c.nome),local(c.detalhe)))]),m.resumo(r.prontoPrimeiroBloco,r.prontoTodosBlocos),...r.limites];
  // O fuso sai uma vez por mensagem, depois dos limites.
  if(localizou)linhas.push(legendaDoFuso());
  return linhas.join('\n');
}

import { exigirManifesto } from './manifest';
import { lerAtivacao } from './write-activation';
import { exigirEscopoDeEscrita } from './escopo-escrita';
/** D5: transporte determinístico, cache só depois do recibo, sem inferência. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ItemPulse, Pulse, CONTRATO_PULSE } from './pulse';
import { raizDoEstado } from './estado-thread';
import { contextoSeguro, redigirSegredos } from './hitl';
import { formatarPrazo, fusoDoManifesto, legendaDoFuso, localizarTexto, registrarFonteDoFuso } from './horario';
import { CanalDoResumo, ResumoDeMaquina, ResumoHitl, resumirHitl, textoDoResumo } from './hitl-resumo';
import { abrirConsentimento, lerConsentimento, PRAZO_PADRAO_MIN } from './pulse-consentimento';
import { avaliarFila, chaveDoGate, gatesJaServidos, threadsComPerguntaViva, atualizarEscuta } from './pulse-resposta';
import { JANELA_PADRAO_MIN } from './hitl-classificacao';
import { expiracaoDoPedido, prazoDoPedido } from './hitl-contract';
import { adquirirLockMonitor, comLockDaConversa } from './monitor-lock';
import { lerFabrica, publicarMaquina, registrarPublicacao, resumoDasOutrasMaquinas } from './fabrica-estado';
import { fabricaCompartilhada, nomeDaMaquina } from './maquina';
import { publicarRedeNaBatida } from './rede';
import { registrarNaRede } from './rede-adesao';
import { lerCadencia, janelaAberta, lerUltimoResumo, gravarUltimoResumo } from './pulse-cadencia';

// O lock dos monitores mudou de modulo (I-41, GO-FIX 1); quem o importava daqui continua importando.
export { adquirirLockMonitor } from './monitor-lock';

export interface TransportePulse { executavel: string; argumentos: string[] }
export interface ResultadoVarredura { code: number; novas: number; enviadas: number; detalhe: string }

/**
 * I-41 (D9): a assinatura de deduplicacao NAO inclui `apresentacao`.
 *
 * `apresentacao.diff` vem de um `git diff` entre a base e o HEAD. Enquanto ela estava aqui, todo
 * commit em qualquer worktree mudava a assinatura de TODOS os itens daquela thread e reenviava
 * todos eles. Com 25 threads e GO ativo, isso era uma fabrica de mensagens: nao volume de
 * perguntas, e sim assinatura instavel. Evidencia que muda a cada commit nao e novidade para o
 * dono, e a pergunta dele continua sendo a mesma.
 */
export function assinaturaPulse(i: ItemPulse): string {
  return createHash('sha256').update(JSON.stringify([i.id,i.classe,i.motivo,i.desdeEm,i.pergunta,i.opcoes,i.pedido])).digest('hex');
}

/** A assinatura do que o dono LE. Dois resumos iguais nao sao duas noticias. */
export function assinaturaDoResumo(r: ResumoHitl): string {
  return createHash('sha256').update(JSON.stringify(
    [r.total,r.urgentes,r.bloqueantes,r.criticos,r.threadsBloqueadas,r.acumuladas,r.prontas,r.consertos,
      r.decisoes.map(d=>d.id),r.acimaDoLimiar.map(f=>[f.thread,f.fase,f.decididas])])).digest('hex');
}
export function mensagemPulse(i: ItemPulse, agora?: string): string {
  // Redigir antes de cortar evita partir tokens e blocos PEM. Campos não expulsam o cabeçalho.
  const campo = (texto: string, limite: number) => redigirSegredos(texto).replace(/[\r\n]+/g, ' ').slice(0, limite);
  // I-35: o item guarda ISO (a assinatura não muda); a mensagem ao dono sai no fuso dele,
  // com o fuso dito uma vez: no prazo ou, sem pedido, logo abaixo da pergunta.
  const pergunta = localizarTexto(i.pergunta, { agora }), legenda = pergunta !== i.pergunta;
  // I-41: so quem tem relogio ganha a linha do relogio. Um `decidido` e fato consumado: nao tem
  // prazo nem acao ao expirar, e imprimir `prazo:` vazio inventaria um cronometro inexistente.
  const prazo = i.pedido ? prazoDoPedido(i.pedido) : undefined;
  const preparado = i.apresentacao;
  const contexto = preparado ? [
    `Profundidade: ${preparado.profundidade}`,
    `Claims: ${preparado.claims}`, `Riscos: ${preparado.riscos}`,
    ...(preparado.artefato ? [`Artefato:\n${preparado.artefato}`] : []),
    ...(preparado.diff ? [`Diff:\n${preparado.diff}`] : [])] : contextoSeguro(i.contextoLogs.join('\n'),8);
  return [`Orkastery: ${campo(i.thread??i.sessionId??'sem identificação',140)} [${campo(i.classe,40)}]`,
    `Espera: ${i.paradaHaMin==null?'desconhecida':i.paradaHaMin<1?'menos de 1':i.paradaHaMin} min`, campo(pergunta,700), ...(legenda ? [legendaDoFuso()] : []),
    ...i.opcoes.slice(0,8).map(o=>`Opção: ${campo(o,180)}`),
    `Recomendação: ${campo(i.recomendacao,500)}`,`Responder: ${campo(i.comandoResposta,500)}`,
    ...(i.pedido && prazo ? [`Pedido: ${campo(i.pedido.id,80)}; prazo: ${campo(formatarPrazo(prazo, { rotulo: !legenda, agora }),80)}; expirar: ${campo(expiracaoDoPedido(i.pedido) ?? '',10)}`] : []),
    ...contexto.map(c => redigirSegredos(c))].join('\n').slice(0,3900);
}
function gravarCache(file:string,vistas:Record<string,string>): void {
  const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({versao:1,vistas})+'\n',{mode:0o600});fs.renameSync(tmp,file);
}

/**
 * I-41 (escopo do dono, 20/09 16:5x): a varredura entrega UMA mensagem, nunca uma por item.
 *
 * Em 20/09 as 16:00 o cron religado disparou e esta funcao mandou 75 mensagens em minutos no
 * Telegram do dono, porque o laco abaixo era `for (const item of itens) enviar(...)`. A frase
 * dele: "de uma forma que humanos simplesmente nao compreendem, mude isso imediatamente".
 *
 * Agora sao duas camadas:
 *
 *   CAMADA 1, toda varredura com novidade: UM resumo com as contagens, as threads travadas e a
 *   pergunta "Posso te mandar as perguntas agora?". N itens produzem 1 mensagem, sempre.
 *
 *   CAMADA 2, so depois do sim: as perguntas, de cinco em cinco, com alternativas a-d. Um sim
 *   libera UM lote, nao um canal aberto, senao a inundacao volta por outra porta. I-41 (GO-FIX 1):
 *   o lote e a RESPOSTA ao sim, no mesmo canal, montada pelo receptor (`pulse-resposta.ts`); a
 *   varredura nunca manda pergunta, so o resumo.
 *
 * A cadencia e parametro. O dono pediu de hora em hora; as tags dele preveem 8h, 2h, 60min,
 * 30min e 15min. `janelaMin` e o que da sentido a palavra "urgente" no resumo.
 */
export function varrerPulse(opcoes: {
  raiz: string; escopo?: readonly string[]; estadoDir?: string; transporte?: TransportePulse; quando?: string;
  consultar?: ()=>Pulse; enviar?: (mensagem:string)=>boolean;
  /** Como escrever o resumo. O transporte do cron e o Telegram; o terminal usa tabela. */
  canal?: CanalDoResumo;
  /** Minutos ate o proximo resumo. Default: a janela da cadencia em vigor com `comCadencia`. */
  janelaMin?: number;
  /**
   * I-50: segue a cadencia duravel do dono (as tags #OrkPulseOn e #OrkPulseOff). E o que a batida
   * do cron usa; sem a opcao, toda novidade entrega na hora, como antes.
   */
  comCadencia?: boolean;
  /**
   * I-51 (RM-047): as outras maquinas da fabrica compartilhada, lidas da ultima copia da branch.
   * Pergunta nova de outra maquina sai na hora, como a daqui; a resposta e la.
   */
  outrasMaquinas?: () => readonly ResumoDeMaquina[];
}): ResultadoVarredura {
  if (opcoes.escopo) exigirEscopoDeEscrita(opcoes.escopo);
  const raiz=raizDoEstado(opcoes.raiz), dir=opcoes.estadoDir??path.join(raiz,'.orkastery','monitor');
  fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'pulse.lock'), cache=path.join(dir,'pulse-avisado.json');
  const quando=opcoes.quando??new Date().toISOString();
  // I-50: a cadencia duravel do dono decide o status periodico; a janela dela e o horizonte de "urgente".
  const cadencia=lerCadencia(opcoes.raiz,dir);
  const canal=opcoes.canal??'telegram', janelaMin=opcoes.janelaMin??(opcoes.comCadencia?cadencia.janelaMin:JANELA_PADRAO_MIN);
  const log=(r:ResultadoVarredura)=>{
    fs.appendFileSync(path.join(dir,'hitl.log'),JSON.stringify({ts:quando,tipo:'pulse_scan',...r})+'\n',{mode:0o600});
    return r;
  };
  const trava = adquirirLockMonitor(lock);
  if (!trava.ok) return log({ code: trava.ativo ? 0 : 1, novas: 0, enviadas: 0, detalhe: trava.detalhe });
  let enviadas=0,novas=0;
  try {
    let pulse:Pulse;
    if(opcoes.consultar) pulse=opcoes.consultar();
    else {
      const r=spawnSync(process.execPath,[path.join(__dirname,'index.js'),'pulse','--json',
        ...(opcoes.escopo ? ['--registrar', '--escopo', opcoes.escopo.join(',')] : [])],
        {cwd:raiz,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
      if(r.status!==0) throw new Error(`pulse falhou (código ${r.status??'timeout'})`);
      pulse=JSON.parse(r.stdout) as Pulse;
    }
    if(pulse.contrato!==CONTRATO_PULSE||!pulse.runtime?.ok||!Array.isArray(pulse.precisaDeHumanoAgora)) {
      throw new Error('consulta incompleta ou contrato inválido; cache preservado');
    }
    let vistas:Record<string,string>={};
    if(fs.existsSync(cache)) {
      const salvo=JSON.parse(fs.readFileSync(cache,'utf8'));
      if(salvo.versao!==1||!salvo.vistas||typeof salvo.vistas!=='object'||Array.isArray(salvo.vistas)) throw new Error('cache inválido; exige inspeção');
      vistas=salvo.vistas;
    }
    const itens=pulse.precisaDeHumanoAgora;
    // I-41 (GO-FIX 1, B4): as decisoes tomadas sem perguntar tambem sao noticia, uma vez cada.
    const decisoes=pulse.decisoes??[];
    const chaveDaDecisao=(id:string)=>`decisao:${id}`;
    const presentes=new Set([...itens.map(i=>i.id),...decisoes.map(d=>chaveDaDecisao(d.id))]);
    // I-51: quem espera o dono em outra maquina tambem e noticia, uma vez por thread e fase.
    let outras:readonly ResumoDeMaquina[]=[];
    try { outras=opcoes.outrasMaquinas?.()??[]; } catch { outras=[]; }
    const esperasFora=outras.flatMap(m=>m.esperando.map(e=>`maquina:${m.maquina}:${e.thread}:${e.fase}`));
    for(const k of esperasFora) presentes.add(k);
    vistas=Object.fromEntries(Object.entries(vistas).filter(([id])=>presentes.has(id)));
    const esperaNovaFora=esperasFora.some(k=>vistas[k]===undefined);
    const decisoesNovas=decisoes.filter(d=>vistas[chaveDaDecisao(d.id)]===undefined);
    // I-41 (GO-FIX 1): a thread que ja recebeu a pergunta e ainda nao respondeu nao e noticia. A
    // mudanca no item dela (o pedido que o sim do dono abriu) e obra nossa, e avisar sobre ela seria
    // mandar ao dono um resumo sobre a pergunta que ele acabou de receber.
    const servidas=threadsComPerguntaViva(raiz,quando,dir);
    const jaServida=(i:ItemPulse)=>!!i.thread&&servidas.has(i.thread);
    novas=itens.filter(i=>vistas[i.id]!==assinaturaPulse(i)&&!jaServida(i)).length;
    for(const i of itens) if(jaServida(i)) vistas[i.id]=assinaturaPulse(i);

    const entregar=(mensagem:string,oQue:string):void=>{
      let entregue:boolean;
      if(opcoes.enviar) entregue=opcoes.enviar(mensagem);
      else {
        const config=opcoes.transporte??JSON.parse(fs.readFileSync(path.join(dir,'pulse-host.json'),'utf8')) as TransportePulse;
        if(typeof config.executavel!=='string'||!config.executavel||!Array.isArray(config.argumentos)||
          !config.argumentos.every(a=>typeof a==='string')||!config.argumentos.some(a=>a.includes('{{mensagem}}'))) {
          throw new Error('transporte requer executavel e argumentos com {{mensagem}}');
        }
        const r=spawnSync(config.executavel,config.argumentos.map(a=>a.replaceAll('{{mensagem}}',mensagem)),
          {cwd:raiz,encoding:'utf8',input:mensagem,timeout:30000,maxBuffer:1024*1024});
        entregue=r.status===0;
      }
      if(!entregue) throw new Error(`transporte não confirmou ${oQue}; novidade preservada`);
      enviadas++;
    };

    // I-41 (GO-FIX 1, B3): quais itens sao perguntas que vao DE FATO sair. Um gate que ainda
    // espera o dono e pergunta; um pedido velho de thread que ja seguiu e historia; um pedido que
    // espera mas nao vira pergunta e conserto nosso. Nada disso escreve: o pedido so e (re)aberto
    // quando o dono diz sim, e e ai que o prazo dele comeca.
    const fila=avaliarFila(raiz,itens,quando,{excluir:servidas});
    const anterior=lerConsentimento(raiz,dir)?.pedido;
    // Pergunta que o dono ainda nao viu oferecida vale um resumo, uma vez. O gate ja oferecido
    // (no resumo anterior ou num lote servido) nao volta a tocar sozinho, respondido com "agora
    // nao", com "continuar esperando" ou deixado sem resposta: silencio e resposta, e o proximo
    // resumo com novidade o traz de novo entre as perguntas.
    const oferecidos=new Set([...(anterior?.candidatos??[]).map(c=>chaveDoGate(c.thread,c.fase)),...gatesJaServidos(raiz,dir)]);
    const conjuntoNovo=fila.candidatos.some(c=>!oferecidos.has(chaveDoGate(c.thread,c.fase)));

    // CAMADA 1: UMA mensagem por varredura, e nenhuma quando nada mudou. A CAMADA 2 nao sai daqui:
    // ela e a resposta ao sim do dono, no mesmo canal, pelo receptor (`pulse-resposta.ts`).
    // I-50: pergunta nova sai na hora; o resto (status, decisoes informadas) espera a janela da
    // cadencia do dono, e a novidade que esperou continua nao vista ate sair.
    const noPrazo=!opcoes.comCadencia||janelaAberta(cadencia,lerUltimoResumo(opcoes.raiz,dir),quando);
    const adiada=!conjuntoNovo&&!esperaNovaFora&&(novas>0||decisoesNovas.length>0)&&!noPrazo;
    if(conjuntoNovo||esperaNovaFora||(noPrazo&&(novas>0||decisoesNovas.length>0))) {
      const guardadas=anterior?fila.candidatos.filter(c=>anterior.candidatos.some(a=>a.thread===c.thread)).length:0;
      const resumo=resumirHitl(itens,{quando,janelaMin,prontas:fila.candidatos.length,acumuladas:guardadas,
        consertos:fila.consertos,atoDoItem:i=>fila.atos.get(`${i.thread}|${i.fase}`),
        decisoes:decisoesNovas,acimaDoLimiar:pulse.acimaDoLimiar??[],outrasMaquinas:outras});
      // Pedir licenca para mandar zero perguntas era o defeito: sem pergunta, nao ha codigo.
      // I-50: cadencia curta nao encurta o prazo do dono para responder ao resumo (minimo de 60 min).
      const consentimento=fila.candidatos.length?comLockDaConversa(dir,()=>abrirConsentimento(raiz,{quando,
        resumoSha256:assinaturaDoResumo(resumo),candidatos:fila.candidatos,prazoMin:Math.max(janelaMin,PRAZO_PADRAO_MIN),estadoDir:dir})):undefined;
      entregar(textoDoResumo(resumo,{canal,codigo:consentimento?.codigo}),'o resumo');
      // RM-048 (D3): o resumo acabou de sair; a palavra solta ("sim") vale na janela curta dele.
      try { atualizarEscuta(raiz,quando,dir); } catch { /* dica de rota; a prova nao depende dela */ }
      // Marcado so depois do recibo do transporte: envio que falhou preserva a novidade.
      for(const item of itens) vistas[item.id]=assinaturaPulse(item);
      for(const d of decisoes) vistas[chaveDaDecisao(d.id)]='informada';
      for(const k of esperasFora) vistas[k]='informada';
      gravarUltimoResumo(opcoes.raiz,quando,dir);
    }
    gravarCache(cache,vistas);
    return log({code:0,novas,enviadas,
      detalhe:enviadas?`${enviadas} mensagem(ns) confirmada(s) pelo transporte para ${novas} novidade(s)`
        :adiada?`novidade guardada para a janela seguinte da cadencia ${cadencia.tag}`:'sem novidade'});
  } catch(e) {return log({code:1,novas,enviadas,detalhe:(e as Error).message});}
  finally { trava.liberar(); }
}

if(require.main===module) {
  try {
    const raiz=process.argv[2]??process.cwd();
    const carregado=exigirManifesto(raiz);
    // I-35: o cron chama esta entrada direto, sem o main do CLI; o fuso do dono vem do manifesto do projeto.
    registrarFonteDoFuso(() => fusoDoManifesto(carregado));
    let escopo: string[] | undefined;
    try {
      const a=lerAtivacao(carregado);
      if(a.ativa && a.plano?.alvos.includes('pulse')) escopo=a.plano.threads;
    } catch(e) {
      console.error('pulse.activation.pending: '+((e as Error).message.startsWith('write.activation.') ? (e as Error).message : 'invalid receipt'));
    }
    const ambiente=process.env.ORK_PULSE_WRITE_SCOPE;
    if(ambiente && ambiente!==(escopo??[]).join(',')) throw Error('pulse.scope.activation-conflict');
    // I-51 (RM-047): com a fabrica compartilhada, a batida publica esta maquina e le as outras.
    const compartilhada=fabricaCompartilhada(carregado.manifesto),remoto=carregado.manifesto.fabrica.remoto;
    if(compartilhada) {
      try { registrarPublicacao(carregado.raiz,{...publicarMaquina(carregado),origem:'pulse'}); }
      catch(e) { registrarPublicacao(carregado.raiz,{acao:'falhou',origem:'pulse',erro:(e as Error).message}); }
    }
    const outrasMaquinas=compartilhada
      ? ()=>resumoDasOutrasMaquinas(lerFabrica(carregado.raiz,{remoto,semRemoto:true}),nomeDaMaquina()) : undefined;
    const r=varrerPulse({raiz,escopo,comCadencia:true,outrasMaquinas});
    console.log(JSON.stringify(r));process.exitCode=r.code;
    // RM-053 (D9): depois da entrega ao dono, a mesma batida publica o retrato desta maquina na rede da
    // pessoa (so membro, uma tentativa a cada 14 min, retrato igual so de hora em hora). M4 do CHECK 1:
    // antes da entrega, uma forja lenta atrasava o HITL em minutos.
    try { const rede=publicarRedeNaBatida({diretorio:carregado.raiz}); if(rede) registrarNaRede({...rede,origem:'pulse'}); }
    catch(e) { registrarNaRede({acao:'falhou',origem:'pulse',erro:(e as Error).message}); }
  } catch(e) { console.error((e as Error).message);process.exitCode=1; }
}

export interface ReciboHost { success: true; message_id: number; platform: string }
/** Payload JSON via stdin; saída estruturada do host confirma a mensagem. */
export function enviarPayloadHost(raiz: string, config: TransportePulse, payload: unknown): ReciboHost {
  if (!config || typeof config.executavel !== 'string' || !config.executavel || !Array.isArray(config.argumentos) ||
      !config.argumentos.every(a => typeof a === 'string')) throw new Error('transporte de digest inválido');
  const r = spawnSync(config.executavel, config.argumentos, { cwd: raiz, encoding: 'utf8',
    input: JSON.stringify(payload), timeout: 30000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw new Error('host não confirmou digest');
  let recibo: ReciboHost;
  try { recibo = JSON.parse(r.stdout); } catch { throw new Error('recibo do host inválido'); }
  if (recibo.success !== true || !Number.isInteger(recibo.message_id) || recibo.message_id <= 0 ||
      typeof recibo.platform !== 'string' || !recibo.platform.trim()) throw new Error('recibo do host inválido');
  return { success: true, message_id: recibo.message_id, platform: recibo.platform };
}

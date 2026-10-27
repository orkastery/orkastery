/**
 * RM-058, fatia N6 (D1, D3, D12 e D13 da ork-rm058n6): o transporte que liga o modo #Noctum.
 *
 * O `#Noctum` é o modo de condução do arco, não de uma thread: as threads do arco são `#Auto`, e a lista delas é a do
 * envelope que o dono autorizou (D1). Por isso `parseModo` e `MODOS_LEGADOS` continuam sem ele (o E9 da N1), e o aceite
 * fica aqui, com estado: com algum arco vigente (autorizado, na janela e não encerrado), o pedido com `#Noctum` é aceito
 * e o host recebe os arcos; sem nenhum, a tag é recusada com `noctum.modo.sem-envelope`, dizendo como abrir um arco. Uma
 * thread nova em modo `#Noctum` nunca é criada: trabalho novo entra no arco por emenda do envelope, com prova nova do dono
 * (`noctum.modo.lista-fechada`), porque item, prioridade e dependências são valores dele.
 *
 * O pedido de abertura chega ao núcleo pelo CLI (`ork noctum propor`), pela ferramenta do MCP (`ork_noctum_propor`) e
 * pelos gateways; proposta não autoriza nada. A autorização e a revogação do dono vêm só por ingresso autenticado: o
 * envelope assinado do gateway (`/ork noctum <arco> autorizar <sha256>` ou `revogar`, entregue a `ork noctum responder`
 * pela entrada, conferido aqui com o `autorizarPeloIngresso` e o `revogarPeloIngresso` da N1) ou o diálogo nativo do host
 * pelo MCP. Argumento de ferramenta e comando de terminal nunca são resposta do dono.
 *
 * O tique (D13) junta, nesta ordem, o fechamento, o vigia da N4 e o relatório (RM-058, integração, D7 da ork-rm058integra):
 * o vigia reconcilia, aplica as paradas e, só com o condutor ausente, dá o passo do despacho; a parada que ele grava fecha
 * o arco no mesmo tique, pelo fechamento, com o motivo `supervisao`. Os testes da N6 ainda passam o passo da N2 no lugar do
 * vigia. É o que o cron do dono chama no piloto; nada aqui instala cron.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { formatarDataHora } from './horario';
import { RespostaHumana } from './hitl-gates';
import { ManifestoCarregado } from './manifest';
import { MODOS_LEGADOS } from './modos';
import { autorizarPeloIngresso, EstadoDoArco, lerArco, revogarPeloIngresso, SituacaoDoArco } from './noctum-arco';
import { envelopeMultimaquina, ID_DO_ARCO, RecusaDoArco, Unidade } from './noctum-envelope';
import { OpcoesDoPasso, ResultadoDoPasso } from './noctum-execucao';
import { fecharSeDevido, lerFechamento, OpcoesDoFechamento, ResultadoDoFechamento, textoDaParada, trabalhosDoArco } from './noctum-fechamento';
import { fatosDaFila, LeitorDeReservas } from './noctum-fila';
import { consumoDoEscopoNaUnidade, MedicaoDoArco, textoDoConsumo } from './noctum-medicao';
import { entregarRelatorioSeDevido, FatosDaSupervisao, fatosDaSupervisao, JANELA_DE_ENTREGA_MS, medidorDoRelatorio, OpcoesDoRelatorio,
  ResultadoDaEntrega, retratoDoRelatorio, RetratoDoRelatorio } from './noctum-relatorio';
import { RecusaDoRegistro } from './noctum-registro';
import { RecusaDaSupervisao } from './noctum-supervisao';
import { OpcoesDoVigia, ResultadoDoVigia, vigiarArco } from './noctum-vigia';
import { coordenacaoDaFila, lerRede, RedeDoArco } from './noctum-rede';

export const CONTRATO_INGRESSO_DO_ARCO = 'ork.noctum-ingresso/v1' as const;
export const CONTRATO_RETRATO_DO_ARCO = 'ork.noctum-retrato/v1' as const;
export const CONTRATO_TIQUE = 'ork.noctum-tique/v1' as const;

/**
 * D12: a gramática do comando dos gateways, com domicílio aqui. Os ingressos do Telegram do Hermes e do OpenClaw guardam
 * uma cópia, e o teste dos gateways confere que as três continuam iguais. O endereço assinado é `noctum` / `arco:<arco>`.
 */
export const GRAMATICA_DO_NOCTUM = '^/ork noctum ([a-z0-9][a-z0-9-]{0,62}) (autorizar [a-f0-9]{64}|revogar)$';

export interface ArcoVigente { arco: string; versao: number; envelopeSha256: string; fim: string; fuso: string }

/** Os arcos desta raiz de estado, pelos nomes das pastas; os que não têm nome de arco ficam de fora. */
export function listarArcos(raiz: string): string[] {
  try {
    return fs.readdirSync(path.join(raizDoEstado(raiz), '.orkastery', 'noctum', 'arcos')).filter(n => ID_DO_ARCO.test(n)).sort();
  } catch { return []; }
}

/** Os arcos vigentes no instante: autorizados, dentro da janela e não encerrados. Arco que não se lê não conta. */
export function arcosVigentes(raiz: string, quando = new Date().toISOString()): { vigentes: ArcoVigente[]; ilegiveis: string[] } {
  const vigentes: ArcoVigente[] = [], ilegiveis: string[] = [];
  for (const arco of listarArcos(raiz)) {
    let e: EstadoDoArco | null;
    try { e = lerArco(raiz, arco, quando); } catch { ilegiveis.push(arco); continue; }
    if (e?.situacao === 'vigente' && e.conteudo && e.versao !== null && e.envelopeSha256) {
      vigentes.push({ arco, versao: e.versao, envelopeSha256: e.envelopeSha256, fim: e.conteudo.janela.fim, fuso: e.conteudo.janela.fuso });
    }
  }
  return { vigentes, ilegiveis };
}

// RM-057 (resposta curta, D9 da ork-rm057respost): a recusa diz como responder curto, nunca a linha com o hash.
const COMO_ABRIR = 'abra um arco: proponha o envelope com ork noctum propor --arquivo <envelope.json> (ou a ferramenta ork_noctum_propor) ' +
  'e o dono o autoriza respondendo à pergunta dele com a letra, em reply no Telegram, ou pelo diálogo do host';

/** D1: o `#Noctum` só vale com algum arco vigente; sem nenhum, a recusa tipada diz como abrir um. */
export function aceitarModoNoctum(raiz: string | null, quando = new Date().toISOString()): ArcoVigente[] {
  const { vigentes, ilegiveis } = raiz ? arcosVigentes(raiz, quando) : { vigentes: [], ilegiveis: [] };
  if (vigentes.length) return vigentes;
  throw new RecusaDoArco('noctum.modo.sem-envelope', `#Noctum só vale com um envelope vigente, e nenhum arco deste projeto está vigente` +
    `${ilegiveis.length ? ` (não se leram: ${ilegiveis.join(', ')})` : ''}; ${COMO_ABRIR}`);
}

/** A entrada nomeia o modo `#Noctum` (`noctum`, `#Noctum`, `--modo noctum`)? */
export function ehModoNoctum(entrada: string | undefined | null): boolean {
  return (entrada ?? '').trim().replace(/^--?modo[= ]/i, '').replace(/^#/, '').toLowerCase() === 'noctum';
}

/** A primeira #TAG de modo do texto é `#Noctum`? A precedência é a de `extrairTagDoPedido`: a primeira tag vence. */
export function tagNoctumNoPedido(texto: string): boolean {
  const achada = new RegExp(`#(?:noctum|${MODOS_LEGADOS.join('|')})\\b`, 'i').exec(texto);
  return !!achada && achada[0].slice(1).toLowerCase() === 'noctum';
}

/** A recusa de `ork thread new --modo noctum`: sem arco vigente, o modo nem vale; com ele, a lista do arco é fechada. */
export function recusaDoModoNaThread(raiz: string | null, quando = new Date().toISOString()): RecusaDoArco {
  try { aceitarModoNoctum(raiz, quando); }
  catch (e) { if (e instanceof RecusaDoArco) return e; throw e; }
  return new RecusaDoArco('noctum.modo.lista-fechada', '#Noctum conduz o arco, não uma thread: as threads do arco são #Auto e vêm da ' +
    'lista do envelope que o dono autorizou; trabalho novo entra por emenda (ork noctum propor com a versão nova), autorizada pelo dono');
}

export interface ReciboDoIngressoDoArco {
  ok: true;
  contrato: typeof CONTRATO_INGRESSO_DO_ARCO;
  arco: string;
  ato: 'autorizar' | 'revogar';
  situacao: SituacaoDoArco;
  versao: number | null;
  envelopeSha256: string | null;
  /** O ato já valia antes desta mensagem: o gateway não confirma de novo ao dono. */
  repetida: boolean;
}

/**
 * O ingresso dos gateways: o envelope assinado com `autorizar <sha256>` ou `revogar`, conferido pela N1 no endereço do
 * arco (chave do canal, listas, conta e janela de 60 s). Devolve o recibo tipado que os gateways conferem.
 */
export function responderAoArco(raiz: string, arco: string, envelope: RespostaHumana, quando = new Date().toISOString()): ReciboDoIngressoDoArco {
  if (!ID_DO_ARCO.test(arco)) throw new RecusaDoArco('noctum.envelope.invalido', 'identificador de arco inválido');
  const texto = typeof envelope?.resposta === 'string' ? envelope.resposta.trim() : '';
  const autorizar = /^autorizar ([a-f0-9]{64})$/.exec(texto);
  if (!autorizar && texto !== 'revogar') {
    throw new RecusaDoArco('noctum.origem.sem-prova', 'o texto assinado precisa ser autorizar <sha256> ou revogar');
  }
  const recibo = (e: EstadoDoArco, ato: 'autorizar' | 'revogar', repetida: boolean): ReciboDoIngressoDoArco =>
    ({ ok: true, contrato: CONTRATO_INGRESSO_DO_ARCO, arco, ato, situacao: e.situacao, versao: e.versao, envelopeSha256: e.envelopeSha256, repetida });
  // O "já valia" é decidido sob o lock do arco: duas entregas do mesmo ato ao mesmo tempo dão uma confirmação só.
  const info = { repetida: false };
  if (autorizar) return recibo(autorizarPeloIngresso(raiz, arco, autorizar[1], envelope, quando, info), 'autorizar', info.repetida);
  return recibo(revogarPeloIngresso(raiz, arco, envelope, quando, info), 'revogar', info.repetida);
}

export interface RetratoDoArco {
  contrato: typeof CONTRATO_RETRATO_DO_ARCO;
  arco: string;
  quando: string;
  situacao: SituacaoDoArco;
  versao: number | null;
  envelopeSha256: string | null;
  janela: { inicio: string; fim: string; fuso: string } | null;
  propostaPendente: { versao: number; envelopeSha256: string; prazo: string } | null;
  consumo: Array<{ escopo: string; unidade: Unidade; teto: number; texto: string; valor: number | null }>;
  fila: { situacao: string; trabalhos: Array<{ id: string; item: string; thread: string | null; estado: string; fase: string | null;
    motivo: string | null }> } | null;
  /** Projeção entre máquinas; ausente nos envelopes v1/v2. */
  rede?: RedeDoArco;
  fechamento: { motivo: string; detalhe: string; em: string; paradas: string[] } | null;
  relatorio: RetratoDoRelatorio;
  /** RM-058, integração (T3): os fatos da supervisão da N4 (isolados, contas fora, retomadas, sessões paradas e parada). */
  supervisao: FatosDaSupervisao | null;
  decisoesPendentes: number;
  /** O que não foi lido, mais as lacunas do relatório: é aqui que a falta de recibo aparece (D3). */
  lacunas: string[];
}

export interface OpcoesDoRetrato { quando?: string; maquina?: string; lerReservas?: LeitorDeReservas;
  medir?: (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco;
  projecaoDaRede?: RedeDoArco; remoto?: string; redeDaCoordenacao?: import('./branch-de-estado').OpcoesDeGit }

/** O retrato do arco no instante: situação, janela, consumo, fila, fechamento, relatório e lacunas. Só lê. */
export function retratoDoArco(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoRetrato = {}): RetratoDoArco | null {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const estado = lerArco(raiz, arco, quando);
  if (!estado) return null;
  const lacunas: string[] = [];
  const conteudo = estado.conteudo;
  const rede = conteudo && envelopeMultimaquina(conteudo) ? opcoes.projecaoDaRede ?? lerRede(carregado, arco,
    { quando, maquina: opcoes.maquina, remoto: opcoes.remoto, rede: opcoes.redeDaCoordenacao }) : null;
  if (rede?.lacuna) lacunas.push(`a rede do arco não pôde ser lida (${rede.lacuna.motivo}: ${rede.lacuna.detalhe})`);
  let consumo: RetratoDoArco['consumo'] = [];
  let fila: RetratoDoArco['fila'] = null;
  if (conteudo && estado.autorizadoPor) {
    // As unidades dos tetos só: com todos em sessões, nenhuma transcrição nem rollout é lido para o retrato.
    const estadoDoCusto = rede && !rede.lacuna ? { ...estado, consumo: { ...estado.consumo, arco: rede.consumo.arco } } : estado;
    const medicao = medidorDoRelatorio(opcoes, conteudo)(raiz, estadoDoCusto, quando);
    const o = conteudo.orcamento;
    const linha = (escopo: string, unidade: Unidade, teto: number, c: ReturnType<typeof consumoDoEscopoNaUnidade>) =>
      ({ escopo, unidade, teto, texto: textoDoConsumo(c), valor: c.valor });
    consumo = [linha('do arco', o.arco.unidade, o.arco.valor, consumoDoEscopoNaUnidade(medicao, 'arco', o.arco.unidade)),
      ...o.porConta.map(s => linha(`da conta ${s.conta}`, s.teto.unidade, s.teto.valor, consumoDoEscopoNaUnidade(medicao, { conta: s.conta }, s.teto.unidade))),
      ...o.porRuntime.map(s => linha(`do runtime ${s.runtime}`, s.teto.unidade, s.teto.valor,
        consumoDoEscopoNaUnidade(medicao, { runtime: s.runtime }, s.teto.unidade)))];
    try {
      const coordenacao = rede ? coordenacaoDaFila(rede) : null;
      if (rede?.lacuna) throw new RecusaDoArco(rede.lacuna.motivo, rede.lacuna.detalhe);
      const f = trabalhosDoArco(fatosDaFila(carregado, arco,
        { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, ...(coordenacao ? { coordenacao } : {}) }));
      fila = { situacao: f.situacao, trabalhos: f.trabalhos.map(t => ({ id: t.id, item: t.item, thread: t.thread, estado: t.estado, fase: t.fase,
        motivo: t.motivo })) };
      lacunas.push(...f.lacunas);
    } catch (e) { if (!(e instanceof RecusaDoArco)) throw e; lacunas.push(`a fila do arco não pôde ser lida (${e.motivo})`); }
  }
  let fechamento: RetratoDoArco['fechamento'] = null;
  if (estado.encerramento) {
    let paradas: string[] = [];
    try { const r = lerFechamento(raiz, arco); paradas = r.paradas.map(p => textoDaParada(p, r.conferencias)); }
    catch (e) { if (!(e instanceof RecusaDoRegistro)) throw e; lacunas.push(`o registro do fechamento não se lê (${e.motivo})`); }
    fechamento = { motivo: estado.encerramento.motivo, detalhe: estado.encerramento.detalhe, em: estado.encerramento.em, paradas };
  }
  const relatorio = retratoDoRelatorio(raiz, arco, estado.autorizadoPor ? conteudo : null, quando);
  lacunas.push(...relatorio.lacunas);
  let supervisao: FatosDaSupervisao | null = null;
  try { supervisao = fatosDaSupervisao(raiz, arco, quando); }
  catch (e) { if (!(e instanceof RecusaDaSupervisao)) throw e; lacunas.push(`a supervisão do arco não se lê (${e.motivo})`); }
  return { contrato: CONTRATO_RETRATO_DO_ARCO, arco, quando, situacao: estado.situacao, versao: estado.versao, envelopeSha256: estado.envelopeSha256,
    janela: conteudo ? { inicio: conteudo.janela.inicio, fim: conteudo.janela.fim, fuso: conteudo.janela.fuso } : null,
    propostaPendente: estado.propostaPendente, consumo, fila, ...(rede ? { rede } : {}), fechamento, relatorio, supervisao,
    decisoesPendentes: estado.decisoes.length, lacunas };
}

/** O retrato em texto para pessoa, em pt-BR, com os horários no fuso da janela. */
export function textoDoRetrato(r: RetratoDoArco): string {
  const fuso = r.janela?.fuso;
  // O nome com `formatar` deixa o lint do horário (horario-lint) ver que o campo ISO passa pelo formatador.
  const formatarNoFuso = (iso: string) => formatarDataHora(iso, { fuso, agora: r.quando, locale: 'pt-BR' });
  const l = [`Arco ${r.arco}: ${r.situacao}${r.versao !== null ? `, versão ${r.versao}` : ''}${r.envelopeSha256 ? `, hash ${r.envelopeSha256.slice(0, 12)}` : ''}`];
  if (r.janela) l.push(`Janela de ${formatarNoFuso(r.janela.inicio)} a ${formatarNoFuso(r.janela.fim)} (${r.janela.fuso})`);
  if (r.propostaPendente) {
    l.push(`Proposta ${r.propostaPendente.versao} esperando o dono até ${formatarNoFuso(r.propostaPendente.prazo)}: hash ${r.propostaPendente.envelopeSha256}`);
  }
  if (r.consumo.length) l.push('Consumo medido:', ...r.consumo.map(c => `  • teto ${c.escopo}: ${c.texto} de ${c.teto} ${c.unidade}`));
  if (r.fila) {
    l.push(`Fila: ${r.fila.situacao}`, ...r.fila.trabalhos.map(t => `  • ${t.id} (${t.item}): ${t.estado}${t.fase ? `, fase ${t.fase}` : ''}` +
      `${t.thread ? `, thread ${t.thread}` : ''}${t.motivo ? ` (${t.motivo})` : ''}`));
  }
  if (r.rede) {
    if (r.rede.lacuna) l.push(`Rede: sem leitura (${r.rede.lacuna.motivo}: ${r.rede.lacuna.detalhe})`);
    else l.push(`Rede: autoridade ${r.rede.autoridade?.maquina ?? 'ainda não assumida'}; máquina desta composição ${r.rede.maquina}`,
      ...r.rede.maquinas.map(m => `  • ${m.nome}: último sinal ${m.ultimoSinal ? formatarNoFuso(m.ultimoSinal) : 'ausente'}, ` +
        `${m.ordensVivas.length} ordem(ns), ${m.vagasAtivas.length} vaga(s), consumo ${m.consumo}`));
  }
  if (r.fechamento) {
    l.push(`Fechamento: ${r.fechamento.motivo} em ${formatarNoFuso(r.fechamento.em)}: ${r.fechamento.detalhe}`, ...r.fechamento.paradas.map(p => `  • ${p}`));
  } else if (r.situacao === 'vigente') l.push('Fechamento: o arco segue');
  const rel = r.relatorio;
  if (rel.vencimentoEm) {
    l.push(`Relatório da manhã: vence ${formatarNoFuso(rel.vencimentoEm)} pelo canal ${rel.canal}` +
      (rel.versoes.length ? `; ${rel.versoes.map(v => `versão ${v.versao} ${v.entregue ? 'entregue' : 'sem recibo'}`).join(', ')}` : '; nenhuma versão ainda'));
  }
  const s = r.supervisao;
  if (s && (s.parada || s.isolados.length || s.contasFora.length || s.retomadas?.length || s.sessoesParadas?.length)) {
    l.push('Supervisão:', ...(s.parada ? [`  • parada: ${s.parada}`] : []), ...s.isolados.map(i => `  • isolado ${i.trabalho}: ${i.motivo}`),
      ...s.contasFora.map(c => `  • a conta ${c.conta} saiu do arco: ${c.motivo}`), ...(s.retomadas ?? []).map(x => `  • retomada autorizada: ${x}`),
      ...(s.sessoesParadas ?? []).map(x => `  • ${x}`));
  }
  if (r.decisoesPendentes) l.push(`Decisões do dono no lote: ${r.decisoesPendentes} (ork noctum relatorio ${r.arco})`);
  l.push(...(r.lacunas.length ? ['Lacunas:', ...r.lacunas.map(x => `  • ${x}`)] : ['Lacunas: nenhuma']));
  return l.join('\n');
}

export interface OpcoesDoTique extends OpcoesDoFechamento, Omit<OpcoesDoRelatorio, 'medir'> {
  /** O passo da N2 no lugar do vigia: só os testes da N6 o passam (MO1 a MO12), como antes da integração. */
  passo?: (carregado: ManifestoCarregado, arco: string, quando: string) => ResultadoDoPasso;
  /** Opções do passo da N2 dentro do vigia (as dependências dos testes). */
  opcoesDoPasso?: OpcoesDoPasso;
  /** RM-058, integração (D7): o vigia da N4; em produção, `vigiarArco`. */
  vigia?: (carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoVigia) => ResultadoDoVigia;
  /** As dependências do vigia (a listagem do runtime, o store de perfis, a parada das sessões, o remoto). */
  opcoesDoVigia?: OpcoesDoVigia;
}

/** A recusa tipada de uma etapa do tique: fica no resultado, e o relatório sai assim mesmo. */
export interface FalhaDoTique { etapa: 'fechamento' | 'passo' | 'vigia'; motivo: string; detalhe: string }

export interface ResultadoDoTique {
  contrato: typeof CONTRATO_TIQUE;
  arco: string;
  quando: string;
  fechamento: ResultadoDoFechamento;
  /** O passo do despacho: o do vigia, quando ele conduziu, ou o da N2 que o teste passou. */
  passo: ResultadoDoPasso | null;
  /** RM-058, integração (D7): o tique do vigia, campo aditivo do mesmo contrato; `null` quando ele não rodou. */
  vigia: ResultadoDoVigia | null;
  relatorio: ResultadoDaEntrega;
  falhas: FalhaDoTique[];
}

/**
 * O arco terminal e quieto: nada pendente no log e o relatório entregue, ou a janela de entrega dele (24 h depois do
 * vencimento) acabada, quando o relatório não tenta mais (A3 do CHECK: o canal sem transporte, o terminal nunca mostrado).
 * O vigia não roda mais, e o log dele não cresce.
 */
function terminalQuieto(carregado: ManifestoCarregado, arco: string, estado: EstadoDoArco, quando: string, rede: RedeDoArco | null): boolean {
  if (!['expirado', 'revogado', 'encerrado'].includes(estado.situacao)) return false;
  if (estado.despachos.some(d => d.desfecho === 'pendente')) return false;
  if (estado.conteudo && envelopeMultimaquina(estado.conteudo)) {
    if (!rede || rede.lacuna) return false;
    if (rede.obrigacoes.ordens.length || rede.obrigacoes.vagas.length || rede.obrigacoes.vezes.length) return false;
  }
  try {
    const r = retratoDoRelatorio(carregado.raiz, arco, estado.conteudo, quando);
    if (r.versoes.at(-1)?.entregue === true) return true;
    return !!r.vencimentoEm && Date.parse(quando) >= Date.parse(r.vencimentoEm) + JANELA_DE_ENTREGA_MS;
  } catch { return false; }
}

/**
 * D13: um tique do arco: o fechamento, o vigia e o relatório, nessa ordem (D7 da ork-rm058integra). O vigia reconcilia e
 * aplica as paradas mesmo no arco que fechou (as reservas em voo); só com o arco vigente, a supervisão sem parada e o
 * condutor ausente ele dá o passo do despacho. Antes da janela, e no arco terminal sem reserva pendente e com o relatório
 * entregue, o vigia não roda. Se o vigia volta com a parada da supervisão, ou o passo encerra pela fila vazia, o
 * fechamento roda de novo no mesmo tique: quem encerra é o fechamento, nunca o vigia. Com o `passo` do teste, ele roda no
 * lugar do vigia, só no arco vigente, como na N6. Arco nunca autorizado recusa: o modo não vale. Cada etapa é isolada: a
 * recusa tipada do fechamento, do vigia ou do passo (o registro do fechamento ou da supervisão adulterado ou ocupado, por
 * exemplo) vira falha do tique, e o relatório da manhã sai assim mesmo; o erro que não é recusa sobe depois do relatório.
 */
export function tiqueDoArco(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoTique = {}): ResultadoDoTique {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const estado = lerArco(raiz, arco, quando);
  if (!estado?.autorizadoPor) {
    throw new RecusaDoArco('noctum.modo.sem-envelope', `o arco ${arco} nunca foi autorizado pelo dono: o #Noctum não vale; ${COMO_ABRIR}`);
  }
  const rede = estado.conteudo && envelopeMultimaquina(estado.conteudo)
    ? opcoes.projecaoDaRede ?? lerRede(carregado, arco,
      { quando, maquina: opcoes.maquina, remoto: opcoes.remoto, rede: opcoes.redeDaCoordenacao }) : null;
  const deFechamento: OpcoesDoFechamento = { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, medir: opcoes.medir,
    parar: opcoes.parar, listarSessoes: opcoes.listarSessoes, git: opcoes.git, projecaoDaRede: rede ?? undefined,
    remoto: opcoes.remoto, redeDaCoordenacao: opcoes.redeDaCoordenacao };
  const falhas: FalhaDoTique[] = [];
  let erro: unknown = null;
  const isolada = <T>(etapa: FalhaDoTique['etapa'], fn: () => T): T | null => {
    try { return fn(); }
    catch (e) {
      if (e instanceof RecusaDoArco || e instanceof RecusaDoRegistro || e instanceof RecusaDaSupervisao) {
        falhas.push({ etapa, motivo: e.motivo, detalhe: e.message.slice(0, 300) });
      } else erro ??= e;
      return null;
    }
  };
  const queFalhou = (): ResultadoDoFechamento => {
    let e: EstadoDoArco | null = null;
    try { e = lerArco(raiz, arco, quando); } catch { e = null; }
    return { fechado: !!e?.encerramento, agora: false, motivo: e?.encerramento?.motivo ?? null, retrato: null, paradas: [], conferencias: [],
      detalhe: 'o fechamento não terminou neste tique; veja as falhas' };
  };
  let fechamento = isolada('fechamento', () => fecharSeDevido(carregado, arco, deFechamento)) ?? queFalhou();
  let passo: ResultadoDoPasso | null = null;
  let vigia: ResultadoDoVigia | null = null;
  const agora = erro === null && falhas.length === 0 ? lerArco(raiz, arco, quando) : null;
  if (opcoes.passo) {
    if (!fechamento.fechado && agora?.situacao === 'vigente') {
      passo = isolada('passo', () => opcoes.passo!(carregado, arco, quando));
      if (passo?.acao === 'encerrar') fechamento = isolada('fechamento', () => fecharSeDevido(carregado, arco, deFechamento)) ?? queFalhou();
    }
  } else if (agora && agora.situacao !== 'agendado' && !terminalQuieto(carregado, arco, agora, quando, rede)) {
    const deVigia: OpcoesDoVigia = { ...opcoes.opcoesDoVigia, quando, maquina: opcoes.maquina ?? opcoes.opcoesDoVigia?.maquina,
      coordenacao: { remoto: opcoes.remoto ?? opcoes.opcoesDoVigia?.coordenacao?.remoto,
        rede: opcoes.redeDaCoordenacao ?? opcoes.opcoesDoVigia?.coordenacao?.rede },
      passo: { maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, ...opcoes.opcoesDoPasso, ...opcoes.opcoesDoVigia?.passo } };
    vigia = isolada('vigia', () => (opcoes.vigia ?? vigiarArco)(carregado, arco, deVigia));
    const doVigia = vigia?.acao === 'tique' ? vigia.passo : null;
    passo = doVigia && doVigia.acao !== 'parado' && doVigia.acao !== 'geracao-vencida' ? doVigia : null;
    if (vigia?.acao === 'tique' && !fechamento.fechado && (vigia.parada || passo?.acao === 'encerrar')) {
      fechamento = isolada('fechamento', () => fecharSeDevido(carregado, arco, deFechamento)) ?? queFalhou();
    }
  }
  let relatorio: ResultadoDaEntrega;
  try {
    relatorio = entregarRelatorioSeDevido(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas,
      medir: opcoes.medir, supervisao: opcoes.supervisao, enviar: opcoes.enviar, projecaoDaRede: rede ?? undefined,
      remoto: opcoes.remoto, redeDaCoordenacao: opcoes.redeDaCoordenacao });
  } catch (e) { throw erro ?? e; }
  if (erro !== null) throw erro;
  return { contrato: CONTRATO_TIQUE, arco, quando, fechamento, passo, vigia, relatorio, falhas };
}

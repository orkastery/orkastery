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
 * O tique (D13) junta, nesta ordem, o fechamento, o passo (hoje o da N2; com a N4 na base, o vigia dela) e o relatório.
 * É o que o cron do dono chama no piloto; a N6 não instala cron.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { formatarDataHora } from './horario';
import { RespostaHumana } from './hitl-gates';
import { ManifestoCarregado } from './manifest';
import { MODOS_LEGADOS } from './modos';
import { autorizarPeloIngresso, EstadoDoArco, lerArco, revogarPeloIngresso, SituacaoDoArco } from './noctum-arco';
import { ID_DO_ARCO, RecusaDoArco, Unidade } from './noctum-envelope';
import { OpcoesDoPasso, passoDoArco, ResultadoDoPasso } from './noctum-execucao';
import { fecharSeDevido, lerFechamento, OpcoesDoFechamento, ResultadoDoFechamento, textoDaParada, trabalhosDoArco } from './noctum-fechamento';
import { fatosDaFila, LeitorDeReservas } from './noctum-fila';
import { consumoDoEscopoNaUnidade, MedicaoDoArco, medirArco, textoDoConsumo } from './noctum-medicao';
import { entregarRelatorioSeDevido, OpcoesDoRelatorio, ResultadoDaEntrega, retratoDoRelatorio, RetratoDoRelatorio } from './noctum-relatorio';
import { RecusaDoRegistro } from './noctum-registro';

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

const COMO_ABRIR = 'abra um arco: proponha o envelope com ork noctum propor --arquivo <envelope.json> (ou a ferramenta ork_noctum_propor) ' +
  'e autorize-o por ingresso autenticado, /ork noctum <arco> autorizar <sha256> no Telegram ou ork_noctum_autorizar no host';

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
  const antes = lerArco(raiz, arco, quando);
  const recibo = (e: EstadoDoArco, ato: 'autorizar' | 'revogar', repetida: boolean): ReciboDoIngressoDoArco =>
    ({ ok: true, contrato: CONTRATO_INGRESSO_DO_ARCO, arco, ato, situacao: e.situacao, versao: e.versao, envelopeSha256: e.envelopeSha256, repetida });
  if (autorizar) {
    const repetida = antes !== null && antes.envelopeSha256 === autorizar[1] && antes.situacao !== 'revogado';
    return recibo(autorizarPeloIngresso(raiz, arco, autorizar[1], envelope, quando), 'autorizar', repetida);
  }
  return recibo(revogarPeloIngresso(raiz, arco, envelope, quando), 'revogar', antes?.situacao === 'revogado');
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
  fechamento: { motivo: string; detalhe: string; em: string; paradas: string[] } | null;
  relatorio: RetratoDoRelatorio;
  decisoesPendentes: number;
  /** O que não foi lido, mais as lacunas do relatório: é aqui que a falta de recibo aparece (D3). */
  lacunas: string[];
}

export interface OpcoesDoRetrato { quando?: string; maquina?: string; lerReservas?: LeitorDeReservas;
  medir?: (raiz: string, estado: EstadoDoArco, quando: string) => MedicaoDoArco }

/** O retrato do arco no instante: situação, janela, consumo, fila, fechamento, relatório e lacunas. Só lê. */
export function retratoDoArco(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoRetrato = {}): RetratoDoArco | null {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const estado = lerArco(raiz, arco, quando);
  if (!estado) return null;
  const lacunas: string[] = [];
  const conteudo = estado.conteudo;
  let consumo: RetratoDoArco['consumo'] = [];
  let fila: RetratoDoArco['fila'] = null;
  if (conteudo && estado.autorizadoPor) {
    const medicao = (opcoes.medir ?? ((r, e, q) => medirArco(r, e, { quando: q })))(raiz, estado, quando);
    const o = conteudo.orcamento;
    const linha = (escopo: string, unidade: Unidade, teto: number, c: ReturnType<typeof consumoDoEscopoNaUnidade>) =>
      ({ escopo, unidade, teto, texto: textoDoConsumo(c), valor: c.valor });
    consumo = [linha('do arco', o.arco.unidade, o.arco.valor, consumoDoEscopoNaUnidade(medicao, 'arco', o.arco.unidade)),
      ...o.porConta.map(s => linha(`da conta ${s.conta}`, s.teto.unidade, s.teto.valor, consumoDoEscopoNaUnidade(medicao, { conta: s.conta }, s.teto.unidade))),
      ...o.porRuntime.map(s => linha(`do runtime ${s.runtime}`, s.teto.unidade, s.teto.valor,
        consumoDoEscopoNaUnidade(medicao, { runtime: s.runtime }, s.teto.unidade)))];
    try {
      const f = trabalhosDoArco(fatosDaFila(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas }));
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
  return { contrato: CONTRATO_RETRATO_DO_ARCO, arco, quando, situacao: estado.situacao, versao: estado.versao, envelopeSha256: estado.envelopeSha256,
    janela: conteudo ? { inicio: conteudo.janela.inicio, fim: conteudo.janela.fim, fuso: conteudo.janela.fuso } : null,
    propostaPendente: estado.propostaPendente, consumo, fila, fechamento, relatorio, decisoesPendentes: estado.decisoes.length, lacunas };
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
  if (r.fechamento) {
    l.push(`Fechamento: ${r.fechamento.motivo} em ${formatarNoFuso(r.fechamento.em)}: ${r.fechamento.detalhe}`, ...r.fechamento.paradas.map(p => `  • ${p}`));
  } else if (r.situacao === 'vigente') l.push('Fechamento: o arco segue');
  const rel = r.relatorio;
  if (rel.vencimentoEm) {
    l.push(`Relatório da manhã: vence ${formatarNoFuso(rel.vencimentoEm)} pelo canal ${rel.canal}` +
      (rel.versoes.length ? `; ${rel.versoes.map(v => `versão ${v.versao} ${v.entregue ? 'entregue' : 'sem recibo'}`).join(', ')}` : '; nenhuma versão ainda'));
  }
  if (r.decisoesPendentes) l.push(`Decisões do dono no lote: ${r.decisoesPendentes} (ork noctum relatorio ${r.arco})`);
  l.push(...(r.lacunas.length ? ['Lacunas:', ...r.lacunas.map(x => `  • ${x}`)] : ['Lacunas: nenhuma']));
  return l.join('\n');
}

export interface OpcoesDoTique extends OpcoesDoFechamento, Omit<OpcoesDoRelatorio, 'medir'> {
  /** O passo do arco; hoje o da N2, e o vigia da N4 quando ele estiver na base (D6). */
  passo?: (carregado: ManifestoCarregado, arco: string, quando: string) => ResultadoDoPasso;
  /** Opções do passo da N2 quando ele é o padrão (as dependências dos testes). */
  opcoesDoPasso?: OpcoesDoPasso;
}

export interface ResultadoDoTique {
  contrato: typeof CONTRATO_TIQUE;
  arco: string;
  quando: string;
  fechamento: ResultadoDoFechamento;
  passo: ResultadoDoPasso | null;
  relatorio: ResultadoDaEntrega;
}

/**
 * D13: um tique do arco: o fechamento, o passo (só com o arco vigente e não encerrado) e o relatório, nessa ordem. Se o
 * passo encerra pela fila vazia, o fechamento roda de novo no mesmo tique. Arco nunca autorizado recusa: o modo não vale.
 */
export function tiqueDoArco(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoTique = {}): ResultadoDoTique {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const estado = lerArco(raiz, arco, quando);
  if (!estado?.autorizadoPor) {
    throw new RecusaDoArco('noctum.modo.sem-envelope', `o arco ${arco} nunca foi autorizado pelo dono: o #Noctum não vale; ${COMO_ABRIR}`);
  }
  const deFechamento: OpcoesDoFechamento = { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, medir: opcoes.medir,
    parar: opcoes.parar, listarSessoes: opcoes.listarSessoes, git: opcoes.git };
  let fechamento = fecharSeDevido(carregado, arco, deFechamento);
  let passo: ResultadoDoPasso | null = null;
  if (!fechamento.fechado && lerArco(raiz, arco, quando)?.situacao === 'vigente') {
    passo = (opcoes.passo ?? ((k, a, q) => passoDoArco(k, a, { maquina: opcoes.maquina, lerReservas: opcoes.lerReservas, ...opcoes.opcoesDoPasso,
      quando: q })))(carregado, arco, quando);
    if (passo.acao === 'encerrar') fechamento = fecharSeDevido(carregado, arco, deFechamento);
  }
  const relatorio = entregarRelatorioSeDevido(carregado, arco, { quando, maquina: opcoes.maquina, lerReservas: opcoes.lerReservas,
    medir: opcoes.medir, supervisao: opcoes.supervisao, enviar: opcoes.enviar });
  return { contrato: CONTRATO_TIQUE, arco, quando, fechamento, passo, relatorio };
}

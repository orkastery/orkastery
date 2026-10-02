/**
 * RM-031 KG3 (D7, D8): `ork grafo`, o CLI do indice e da consulta do grafo de codigo.
 *
 * Substitui o comando provisorio do KG2: `indexar --verificar` prova a extracao (contrato, bytes e
 * determinismo com a ordem de leitura trocada), e `amostra` gera e confere a amostra auditada de
 * arestas. As consultas leem o indice do HEAD e respondem em texto ou `--json`.
 *
 * O argv chega cru e o parser e estrito: subcomando conhecido, opcao conhecida uma vez so, valor
 * onde a opcao pede valor e bandeira sem valor, numero exato de posicionais. Resposta sai 0, mesmo
 * vazia; erro tipado sai 1 e, com `--json`, vem como objeto.
 *
 * RM-031 KG5 (D4, D5): `--teto-bytes N` limita a resposta em bytes (JSON compacto), para quem a leva
 * ao contexto de um agente, como as tools `ork_grafo_*` do MCP; sem a opcao, a saida e a de antes. Sem
 * o indice do HEAD, a recusa diz se ha indice de outra revisao ou de outro extrator, e a correcao.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TIPOS_DE_ARESTA, canonico, compararUtf8, type Aresta, type GrafoCodigo, type TipoDeAresta } from './intelligence-graph-contract';
import {
  chaveDoIndice, concessaoLocal, construirIndice, estadoDosIndices, indiceDoHead, lerIndice, limparIndices, perfilDoIndice,
  type ContextoDoIndice, type PerfilDoIndice, type ResultadoDaConstrucao,
} from './intelligence-graph-index';
import {
  CONSULTA_SCHEMA, ErroDeConsulta, caminho, chamadores, filtrarGrafo, importadores, jsonDaResposta, prepararConsulta, textoDaResposta, vizinhos,
  type CabecalhoDoIndice, type RespostaDeConsulta, type Sentido,
} from './intelligence-graph-query';
import { headsDasArvores, revisaoDaArvore } from './intelligence-graph-repo';

export const STATUS_SCHEMA = 'ork.code-graph-index-status/v0' as const;
/** O mesmo schema da amostra do KG2: as amostras auditadas continuam validas. */
export const AMOSTRA_SCHEMA = 'ork.graph-edge-audit-sample/v0' as const;

export const USO_DO_GRAFO = [
  'uso: ork grafo indexar [--verificar] [--forcar] [--json]',
  '     ork grafo status [--json]',
  '     ork grafo vizinhos <no> [--profundidade N] [--sentido entrada|saida|ambos] [--tipo T,...] [--limite N] [--json [--teto-bytes N]]',
  '     ork grafo chamadores <simbolo> [--profundidade N] [--limite N] [--json [--teto-bytes N]]',
  '     ork grafo importadores <arquivo|simbolo> [--profundidade N] [--limite N] [--json [--teto-bytes N]]',
  '     ork grafo caminho <de> <para> [--sentido saida|entrada|ambos] [--tipo T,...] [--json [--teto-bytes N]]',
  '     ork grafo amostra [--por-estrato N] | ork grafo amostra --conferir ARQ [--json]',
  '     ork grafo limpar [--tudo] [--json]',
].join('\n');

/** KG5 (D5): a correcao das recusas de indice que a proxima indexacao resolve. */
export const CORRECAO_DO_INDICE = 'ork grafo indexar' as const;
/** KG5 (D5): o estado do indice do HEAD que cada recusa declara no JSON, ao lado da correcao. */
const ESTADO_DO_INDICE: Readonly<Record<string, string>> = Object.freeze({
  'grafo.indice.ausente': 'nao-indexado',
  'grafo.indice.outra-revisao': 'outra-revisao',
  'grafo.indice.outro-extrator': 'outro-extrator',
  'grafo.indice.corrompido': 'corrompido',
});

export interface ContextoDoCli extends ContextoDoIndice {
  escrever: (texto: string) => void;
}

interface Especificacao { posicionais: number; bandeiras: readonly string[]; valores: readonly string[] }
const SUBCOMANDOS: Readonly<Record<string, Especificacao>> = Object.freeze({
  indexar: { posicionais: 0, bandeiras: ['verificar', 'forcar', 'json'], valores: [] },
  status: { posicionais: 0, bandeiras: ['json'], valores: [] },
  vizinhos: { posicionais: 1, bandeiras: ['json'], valores: ['profundidade', 'sentido', 'tipo', 'limite', 'teto-bytes'] },
  chamadores: { posicionais: 1, bandeiras: ['json'], valores: ['profundidade', 'limite', 'teto-bytes'] },
  importadores: { posicionais: 1, bandeiras: ['json'], valores: ['profundidade', 'limite', 'teto-bytes'] },
  caminho: { posicionais: 2, bandeiras: ['json'], valores: ['sentido', 'tipo', 'teto-bytes'] },
  amostra: { posicionais: 0, bandeiras: ['json'], valores: ['por-estrato', 'conferir'] },
  limpar: { posicionais: 0, bandeiras: ['tudo', 'json'], valores: [] },
});

interface Pedido { sub: string; posicionais: string[]; bandeiras: Set<string>; valores: Map<string, string> }

function uso(motivo: string): never {
  throw new Error(`grafo.uso: ${motivo}\n${USO_DO_GRAFO}`);
}

export function lerPedido(argv: readonly string[]): Pedido {
  const [sub, ...resto] = argv;
  if (!sub) uso('falta o subcomando');
  const esp = SUBCOMANDOS[sub];
  if (!Object.prototype.hasOwnProperty.call(SUBCOMANDOS, sub) || !esp) uso(`subcomando desconhecido: ${sub}`);
  const posicionais: string[] = [], bandeiras = new Set<string>(), valores = new Map<string, string>();
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (!a.startsWith('--')) {
      posicionais.push(a);
      continue;
    }
    const igual = a.indexOf('=');
    const nome = igual > 0 ? a.slice(2, igual) : a.slice(2);
    if (bandeiras.has(nome) || valores.has(nome)) uso(`--${nome} repetida`);
    if (esp.bandeiras.includes(nome)) {
      if (igual > 0) uso(`--${nome} nao leva valor`);
      bandeiras.add(nome);
    } else if (esp.valores.includes(nome)) {
      const valor = igual > 0 ? a.slice(igual + 1) : resto[++i];
      if (valor === undefined || valor === '' || (igual < 0 && valor.startsWith('--'))) uso(`--${nome} exige valor`);
      valores.set(nome, valor);
    } else {
      uso(`opcao desconhecida para ${sub}: ${a}`);
    }
  }
  if (posicionais.length !== esp.posicionais) uso(`${sub} pede ${esp.posicionais} argumento(s), veio ${posicionais.length}`);
  return { sub, posicionais, bandeiras, valores };
}

function inteiro(p: Pedido, nome: string): number | undefined {
  const v = p.valores.get(nome);
  if (v === undefined) return undefined;
  if (!/^[0-9]{1,6}$/.test(v)) uso(`--${nome} precisa ser inteiro`);
  return Number(v);
}

function tipos(p: Pedido): TipoDeAresta[] | undefined {
  const v = p.valores.get('tipo');
  if (v === undefined) return undefined;
  const lista = v.split(',');
  for (const t of lista) if (!(TIPOS_DE_ARESTA as readonly string[]).includes(t)) uso(`--tipo desconhecido: ${t} (use ${TIPOS_DE_ARESTA.join(',')})`);
  return lista as TipoDeAresta[];
}

function sentido(p: Pedido): Sentido | undefined {
  const v = p.valores.get('sentido');
  if (v !== undefined && !['entrada', 'saida', 'ambos'].includes(v)) uso(`--sentido desconhecido: ${v}`);
  return v as Sentido | undefined;
}

/** KG5 (D4): o teto vale para o JSON, que e o que vai ao contexto de quem consulta. */
function tetoDeBytes(p: Pedido): number | undefined {
  const teto = inteiro(p, 'teto-bytes');
  if (teto === undefined) return undefined;
  if (!p.bandeiras.has('json')) uso('--teto-bytes exige --json');
  if (teto < 1) uso('--teto-bytes precisa ser ao menos 1');
  return teto;
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const contagem = (o: Record<string, number>): string => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ');
/** Ate cinco caminhos e quantos ficaram de fora. */
const alguns = (lista: readonly string[]): string => (lista.length ? ` (${lista.slice(0, 5).join(', ')}${lista.length > 5 ? ` e mais ${lista.length - 5}` : ''})` : '');

/** KG4: como a extracao rodou, a base e o que veio dela, ou por que foi completa. */
function linhasDaExtracao(r: ResultadoDaConstrucao): string[] {
  if (r.modo === null) return [];
  const a = r.reaproveitamento;
  if (r.modo === 'incremental' && r.base && a) {
    // Desestruturado: o lint de horario le o campo de nome curto do TypeScript como instante.
    const { ts: doTs, md: doMd, mudanca } = a;
    const ts = doTs.modo === 'inteiro' ? `TypeScript inteiro (${doTs.motivo})`
      : doTs.modo === 'parcial' ? `TypeScript parcial, ${doTs.reextraidos.length} reextraido(s)${alguns(doTs.reextraidos)} num programa de ${doTs.programa}, ${doTs.reaproveitados} da base`
        : `TypeScript todo da base (${doTs.reaproveitados})`;
    return [
      `  extracao     incremental a partir do indice de ${r.base.revision.slice(0, 12)}: ${mudanca.alterados} alterado(s), ${mudanca.novos} novo(s), ${mudanca.removidos} removido(s)`,
      `               ${ts}`,
      `               Markdown: ${doMd.reextraidos.length} reextraido(s)${alguns(doMd.reextraidos)}, ${doMd.reaproveitados} da base`,
    ];
  }
  return [`  extracao     completa${r.motivo_completo ? `: ${r.motivo_completo}` : ''}`];
}

function indexar(ctx: ContextoDoCli, p: Pedido): number {
  const r: ResultadoDaConstrucao = construirIndice(ctx, { verificar: p.bandeiras.has('verificar'), forcar: p.bandeiras.has('forcar') });
  if (p.bandeiras.has('json')) {
    ctx.escrever(JSON.stringify(r, null, 2));
    return 0;
  }
  const m = r.manifesto;
  const linhas = [
    `indice do grafo de ${m.repository_id}: ${r.estado}`,
    `  revisao      ${m.revision}`,
    `  chave        ${r.chave}`,
    `  snapshot     ${m.snapshot_id}`,
    `  digest       ${m.graph_digest}`,
    `  conferencia  conferirFontes verificada: ${m.conferencia.fontes} fontes e ${m.conferencia.evidencias} evidencias contra os bytes`,
    `  nos          ${contagem(m.contagens.nos)}`,
    `  arestas      ${contagem(m.contagens.arestas)}`,
    `  lugar        ${r.dir} (${mb(m.graph_bytes + m.report_bytes + m.units_bytes)})`,
    ...linhasDaExtracao(r),
  ];
  if (r.motivo) linhas.push(`  motivo       ${r.motivo}`);
  for (const d of r.determinismo ?? []) {
    linhas.push(`  determinismo ${d.ordem}: digest ${d.digest.slice(0, 16)}, relatorio ${d.relatorio.slice(0, 16)}, unidades ${d.unidades.slice(0, 16)}, ${d.igual ? 'igual' : 'DIFERENTE'}`);
  }
  if (r.incremental) linhas.push(`  incremental  a partir do indice de ${r.incremental.base.slice(0, 12)}: ${r.incremental.igual ? 'igual a completa nos quatro arquivos' : 'DIFERENTE'}`);
  else if (r.determinismo) linhas.push(`  incremental  nao conferido: ${r.motivo_completo ?? 'sem base'}`);
  linhas.push(`  tempo        ${r.ms} ms`);
  if (r.determinismo) linhas.push('aprovado');
  ctx.escrever(linhas.join('\n'));
  return 0;
}

function status(ctx: ContextoDoCli, p: Pedido): number {
  const arvore = revisaoDaArvore(ctx.raiz);
  let chave: string | null = null, analisadores: unknown = null, erro: string | null = null;
  try {
    const perfil = perfilDoIndice(arvore.raiz, undefined, ctx.repositorio ? { repository_id: ctx.repositorio } : {});
    analisadores = perfil.analisadores;
    if (arvore.head) chave = chaveDoIndice(arvore.head, perfil);
  } catch (e) {
    erro = (e as Error).message;
  }
  const estado = estadoDosIndices(ctx);
  const doHead = chave ? estado.indices.find((i) => i.chave === chave) ?? null : null;
  // Sem analisadores nao ha chave: o indice do HEAD fica indisponivel, nunca "ausente" (indexar tambem nao roda).
  const indiceDoHeadEstado = erro ? 'indisponivel' : doHead ? (doHead.problema ? 'com-problema' : 'presente') : 'ausente';
  const r = {
    schema: STATUS_SCHEMA, head: arvore.head, arvore: arvore.motivo === null ? 'limpa' : arvore.motivo, chave_do_head: chave,
    indice_do_head: indiceDoHeadEstado, analisadores, erro,
    dir: estado.dir, bytes: estado.bytes, indices: estado.indices, sobras: estado.sobras,
  };
  if (p.bandeiras.has('json')) {
    ctx.escrever(JSON.stringify(r, null, 2));
    return 0;
  }
  const linhas = [
    `grafo: HEAD ${arvore.head ? arvore.head.slice(0, 12) : 'sem commit'}, arvore ${r.arvore}`,
    `  indice do HEAD  ${chave ?? 'indisponivel'} ${r.indice_do_head === 'ausente' ? '(ausente: rode ork grafo indexar)'
      : r.indice_do_head === 'indisponivel' ? '(sem os analisadores nesta instalacao, nem a consulta nem o indexar rodam)' : `(${r.indice_do_head})`}`,
    `  analisadores    ${erro ?? Object.entries(analisadores as Record<string, string>).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `  pasta           ${estado.dir ?? 'ainda nao criada'} (${estado.indices.length} indice(s), ${mb(estado.bytes)})`,
  ];
  for (const i of estado.indices) {
    linhas.push(`  ${i.chave.slice(0, 20)}  ${i.revision ? i.revision.slice(0, 12) : '?'}  ${i.repository_id ?? '?'}  ${mb(i.bytes)}  ${i.problema ?? 'ok'}`);
  }
  if (estado.sobras.length) linhas.push(`  sobras          ${estado.sobras.join(', ')}`);
  ctx.escrever(linhas.join('\n'));
  return 0;
}

/**
 * KG5 (CHECK rodada 1, A1): o que difere entre o extrator do indice guardado e o de quem consulta. A
 * versao do Node entra no rotulo do analisador de JavaScript, entao outra instalacao ou outro Node dao
 * outra chave com o mesmo conteudo.
 */
function diferencasDoExtrator(guardado: PerfilDoIndice, atual: PerfilDoIndice): string[] {
  const r: string[] = [];
  for (const k of Object.keys(atual.analisadores).sort(compararUtf8) as (keyof PerfilDoIndice['analisadores'])[]) {
    const antes = guardado.analisadores?.[k];
    if (antes !== atual.analisadores[k]) r.push(`${k} ${antes ?? '?'} no indice, ${atual.analisadores[k]} aqui`);
  }
  if (canonico(guardado.pacotes) !== canonico(atual.pacotes)) r.push('pacotes dos analisadores');
  if (guardado.codigo !== atual.codigo) r.push('codigo do extrator');
  return r;
}

/**
 * KG5 (D5): sem o indice do HEAD, diz o que ha no lugar. Indice guardado do mesmo repositorio e da
 * revisao do HEAD com outra chave e de outro extrator (instalacao, Node, analisadores ou codigo do
 * extrator mudaram), e a recusa diz o que mudou; de outra revisao, e indice velho ou de outra arvore.
 * Nos dois casos a correcao e indexar de novo, com a instalacao de quem consulta; sem nenhum, fica a
 * recusa original (nao indexado). Nunca responde por um indice que nao e o do HEAD.
 */
function semIndiceDoHead(ctx: ContextoDoCli, original: Error): never {
  const arvore = revisaoDaArvore(ctx.raiz);
  if (!arvore.head) throw original;
  const perfil = perfilDoIndice(arvore.raiz, undefined, ctx.repositorio ? { repository_id: ctx.repositorio } : {});
  const chave = chaveDoIndice(arvore.head, perfil), head = arvore.head.slice(0, 12);
  const guardados = estadoDosIndices(ctx).indices
    .filter((i) => i.problema === null && i.chave !== chave && i.repository_id === perfil.repository_id && i.revision !== null);
  const doHead = guardados.find((i) => i.revision === arvore.head);
  if (doHead) {
    const diferencas = diferencasDoExtrator(lerIndice(ctx, doHead.chave, { grafo: false }).manifesto, perfil);
    throw new Error(`grafo.indice.outro-extrator: ha indice do HEAD ${head} de outro extrator (${diferencas.join('; ') || 'perfil diferente'}); `
      + `rode ${CORRECAO_DO_INDICE} com a mesma instalacao do ork e o mesmo Node de quem consulta (o servidor MCP consulta com a dele)`);
  }
  if (guardados.length) {
    const revisoes = [...new Set(guardados.map((i) => (i.revision as string).slice(0, 12)))].sort(compararUtf8);
    throw new Error(`grafo.indice.outra-revisao: o HEAD ${head} nao tem indice; o guardado e de outra revisao${alguns(revisoes)}; rode ${CORRECAO_DO_INDICE}`);
  }
  throw original;
}

/** O indice do HEAD pronto para consulta, com a concessao local e o cabecalho; `grafo` ja vem filtrado por ela. */
function consultavel(ctx: ContextoDoCli): { g: ReturnType<typeof prepararConsulta>; cabecalho: CabecalhoDoIndice; grafo: GrafoCodigo; raiz: string } {
  let doHead: ReturnType<typeof indiceDoHead>;
  try {
    doHead = indiceDoHead(ctx);
  } catch (e) {
    if (String((e as Error).message).startsWith('grafo.indice.ausente')) semIndiceDoHead(ctx, e as Error);
    throw e;
  }
  const { arvore, perfil, chave, indice } = doHead;
  const concessao = concessaoLocal(arvore.raiz, perfil);
  const grafo = filtrarGrafo(indice.grafo as GrafoCodigo, concessao), m = indice.manifesto;
  const cabecalho: CabecalhoDoIndice = {
    repository_id: m.repository_id, revision: m.revision, chave, snapshot_id: m.snapshot_id, graph_digest: m.graph_digest,
    arvore: arvore.motivo === null ? 'limpa' : 'modificada',
    extratores: grafo.snapshot.extractors.map((e) => ({ extractor_id: e.extractor_id, extractor_version: e.extractor_version })),
  };
  return { g: prepararConsulta(grafo, concessao), cabecalho, grafo, raiz: arvore.raiz };
}

function responder(ctx: ContextoDoCli, p: Pedido, r: RespostaDeConsulta): number {
  ctx.escrever(p.bandeiras.has('json') ? jsonDaResposta(r) : textoDaResposta(r));
  return 0;
}

/**
 * KG5 (D4): a resposta em JSON compacto que cabe em `teto` bytes. Se a pedida nao cabe, vale o maior
 * limite que cabe: as arestas mais longe do alvo saem primeiro, pela mesma ordem do `--limite`, e
 * `consulta.limite` passa a ser o efetivo. O tamanho cresce com o limite (cada aresta a mais so soma
 * bytes), entao a busca binaria acha o maior que cabe, sempre o mesmo. Aresta nunca sai sem toda a
 * evidencia; o caminho nao se corta.
 */
function respostaComTeto(perguntar: (limite: number | undefined) => RespostaDeConsulta, limite: number | undefined, teto: number): string {
  const pedida = perguntar(limite);
  const limitePedido = pedida.consulta.limite;
  const comTeto = (r: RespostaDeConsulta, cortado: boolean): string =>
    JSON.stringify({ ...r, teto: { bytes: teto, limite_pedido: limitePedido, cortado } });
  const inteira = comTeto(pedida, false);
  if (Buffer.byteLength(inteira) <= teto) return inteira;
  const ehCaminho = pedida.consulta.tipo === 'caminho';
  // So chega aqui o que nao cabe nem com a aresta mais perto do alvo: estreitar a consulta nao ajuda.
  const excedido = (resposta: string, bytes: number): never => {
    throw new ErroDeConsulta('grafo.consulta.teto-excedido',
      `${resposta} tem ${bytes} bytes, acima do teto de ${teto}; ${ehCaminho ? 'o caminho nao se corta: ' : ''}use --teto-bytes maior`);
  };
  if (ehCaminho) excedido(`o caminho de ${pedida.arestas.length} passo(s)`, Buffer.byteLength(inteira));
  if (pedida.arestas.length <= 1) excedido(`a resposta com ${pedida.arestas.length} aresta(s)`, Buffer.byteLength(inteira));
  let menor = 1, maior = pedida.arestas.length - 1, melhor: string | null = null;
  while (menor <= maior) {
    const k = Math.floor((menor + maior) / 2), texto = comTeto(perguntar(k), true);
    if (Buffer.byteLength(texto) <= teto) {
      melhor = texto;
      menor = k + 1;
    } else maior = k - 1;
  }
  return melhor ?? excedido('a resposta com 1 aresta', Buffer.byteLength(comTeto(perguntar(1), true)));
}

function consultar(ctx: ContextoDoCli, p: Pedido): number {
  // As opcoes sao conferidas antes de carregar o indice: erro de uso nao custa a leitura do grafo.
  const [a, b] = p.posicionais;
  const profundidade = inteiro(p, 'profundidade'), limite = inteiro(p, 'limite'), s = sentido(p), t = tipos(p), teto = tetoDeBytes(p);
  const { g, cabecalho } = consultavel(ctx);
  const perguntar = (lim: number | undefined): RespostaDeConsulta => {
    if (p.sub === 'vizinhos') return vizinhos(g, cabecalho, a, { profundidade, limite: lim, sentido: s, tipos: t });
    if (p.sub === 'chamadores') return chamadores(g, cabecalho, a, { profundidade, limite: lim });
    if (p.sub === 'importadores') return importadores(g, cabecalho, a, { profundidade, limite: lim });
    return caminho(g, cabecalho, a, b, { sentido: s, tipos: t });
  };
  if (teto === undefined) return responder(ctx, p, perguntar(limite));
  ctx.escrever(respostaComTeto(perguntar, limite, teto));
  return 0;
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/**
 * Bytes da arvore, conferidos arquivo a arquivo contra o manifesto do indice: o trecho da amostra e
 * sempre o do HEAD, mesmo com outro arquivo modificado. So le os arquivos pedidos, e so caminhos do
 * manifesto; arquivo que mudou recusa a amostra.
 */
function leitorDaArvore(raiz: string, grafo: GrafoCodigo): (p: string) => Buffer {
  const hashes = new Map(grafo.snapshot.source_manifest.map((m) => [m.path, m.source_hash]));
  const lidos = new Map<string, Buffer>();
  return (p: string): Buffer => {
    const guardado = lidos.get(p);
    if (guardado) return guardado;
    const esperado = hashes.get(p);
    if (!esperado) throw new Error(`grafo.amostra.fonte-desconhecida: ${p}`);
    // Sem seguir link e so arquivo regular: FIFO ou dispositivo no lugar da fonte nao trava a leitura.
    let fd: number;
    try {
      fd = fs.openSync(path.join(raiz, p), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    } catch {
      throw new Error(`grafo.amostra.fonte-mudou: ${p}`);
    }
    let bytes: Buffer;
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error(`grafo.amostra.fonte-mudou: ${p}`);
      bytes = fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (sha256(bytes) !== esperado) throw new Error(`grafo.amostra.fonte-mudou: ${p}`);
    lidos.set(p, bytes);
    return bytes;
  };
}

interface Localizador { kind: string; path: string; fragment: string | null }
const localizadorDe = (g: GrafoCodigo): Map<string, Localizador> =>
  new Map(g.nodes.map((n) => [n.node_id, { kind: n.kind, path: n.locator.path, fragment: n.locator.fragment }]));
const rotulo = (l: Localizador): string => `${l.kind}:${l.path}${l.fragment === null ? '' : `#${l.fragment}`}`;
const chaveDaAresta = (kind: string, de: Localizador, para: Localizador): string => `${kind} ${rotulo(de)} -> ${rotulo(para)}`;
type Ev = Aresta['evidence'][number];
const trecho = (ler: (p: string) => Buffer, e: Ev): Buffer => ler(e.path).subarray(e.span.byte_start, e.span.byte_end);

/** KG2 D12: estrato por tipo de aresta e metodos; passo fixo sobre os `edge_id` ordenados. */
function amostrar(grafo: GrafoCodigo, ler: (p: string) => Buffer, porEstrato: number, digest: string): object {
  const nos = localizadorDe(grafo), estratos = new Map<string, Aresta[]>();
  for (const a of grafo.edges) {
    const chave = `${a.kind}/${[...new Set(a.evidence.map((e) => e.extraction_method))].sort().join('+')}`;
    if (!estratos.has(chave)) estratos.set(chave, []);
    (estratos.get(chave) as Aresta[]).push(a);
  }
  const arestas: object[] = [], universo: Record<string, number> = {};
  for (const chave of [...estratos.keys()].sort()) {
    const lista = (estratos.get(chave) as Aresta[]).sort((x, y) => (x.edge_id < y.edge_id ? -1 : 1));
    universo[chave] = lista.length;
    const k = Math.min(porEstrato, lista.length);
    for (let i = 0; i < k; i++) {
      const a = lista[Math.floor((i * lista.length) / k)];
      const e = [...a.evidence].sort((x, y) => (x.path === y.path ? x.span.byte_start - y.span.byte_start : x.path < y.path ? -1 : 1))[0];
      const t = trecho(ler, e);
      const span = e.span as { line_start: number | null; line_end: number | null };
      arestas.push({
        estrato: chave, kind: a.kind, from: nos.get(a.from), to: nos.get(a.to),
        evidencia: {
          path: e.path, extractor_id: e.extractor_id, extraction_method: e.extraction_method, line_start: span.line_start, line_end: span.line_end,
          trecho_sha256: sha256(t), trecho_inicio: t.toString('utf8').split('\n')[0].slice(0, 200),
        },
        veredito: null, nota: null,
      });
    }
  }
  return {
    schema: AMOSTRA_SCHEMA, graph_schema: grafo.schema, repository_id: grafo.repository_id,
    revision: grafo.snapshot.revision, revision_unavailable_reason: grafo.snapshot.revision_unavailable_reason,
    snapshot_id: grafo.snapshot.snapshot_id, graph_digest: digest, por_estrato: porEstrato, universo, arestas,
  };
}

interface ItemDaAmostra {
  estrato: string; kind: string; from: Localizador; to: Localizador; veredito: unknown; nota: unknown;
  evidencia: { path: string; extractor_id: string; extraction_method: string; trecho_sha256: string };
}

/** Confere a amostra auditada contra o indice do HEAD: aresta, trecho pelo hash, veredito com nota. */
function conferirAmostra(grafo: GrafoCodigo, ler: (p: string) => Buffer, arquivo: string): { linhas: string[]; falhas: string[] } {
  const amostra = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { schema: string; revision: string | null; revision_unavailable_reason: string | null; arestas: ItemDaAmostra[] };
  if (amostra.schema !== AMOSTRA_SCHEMA || !Array.isArray(amostra.arestas)) return { linhas: [], falhas: [`schema da amostra: ${amostra.schema}`] };
  if (!amostra.arestas.length) return { linhas: [], falhas: ['amostra vazia: nada para conferir'] };
  const nos = localizadorDe(grafo);
  const indice = new Map(grafo.edges.map((a) => [chaveDaAresta(a.kind, nos.get(a.from) as Localizador, nos.get(a.to) as Localizador), a]));
  const falhas: string[] = [], estratos = new Set<string>(), vereditos: Record<string, number> = {};
  for (const item of amostra.arestas) {
    const chave = chaveDaAresta(item.kind, item.from, item.to);
    vereditos[String(item.veredito)] = (vereditos[String(item.veredito)] ?? 0) + 1;
    estratos.add(item.estrato);
    if (item.veredito !== 'supported' || typeof item.nota !== 'string' || !item.nota.trim()) {
      falhas.push(`${chave}: veredito ${item.veredito ?? 'ausente'}${item.nota ? '' : ', sem nota'}`);
      continue;
    }
    const achada = indice.get(chave);
    if (!achada) {
      falhas.push(`${chave}: aresta ausente no indice do HEAD`);
      continue;
    }
    const ev = item.evidencia;
    const bate = achada.evidence.some((e) => e.path === ev.path && e.extractor_id === ev.extractor_id
      && e.extraction_method === ev.extraction_method && sha256(trecho(ler, e)) === ev.trecho_sha256);
    if (!bate) falhas.push(`${chave}: nenhuma evidencia com o trecho auditado`);
  }
  const linhas = [
    `amostra: ${amostra.arestas.length} arestas em ${estratos.size} estratos, auditada na revisao ${amostra.revision ?? amostra.revision_unavailable_reason}`,
    `  vereditos ${Object.entries(vereditos).sort(([x], [y]) => compararUtf8(x, y)).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    `  conferidas contra o indice do HEAD: ${amostra.arestas.length - falhas.length} de ${amostra.arestas.length}`,
  ];
  return { linhas, falhas };
}

function amostra(ctx: ContextoDoCli, p: Pedido): number {
  if (p.valores.has('conferir') && p.valores.has('por-estrato')) uso('--conferir e --por-estrato nao combinam');
  const { grafo, raiz, cabecalho } = consultavel(ctx);
  const ler = leitorDaArvore(raiz, grafo);
  const arquivo = p.valores.get('conferir');
  if (arquivo === undefined) {
    const n = inteiro(p, 'por-estrato') ?? 3;
    if (n < 1) uso('--por-estrato precisa ser ao menos 1');
    ctx.escrever(JSON.stringify(amostrar(grafo, ler, n, cabecalho.graph_digest), null, 2));
    return 0;
  }
  const { linhas, falhas } = conferirAmostra(grafo, ler, arquivo);
  if (p.bandeiras.has('json')) {
    ctx.escrever(JSON.stringify({ schema: AMOSTRA_SCHEMA, conferencia: linhas, falhas, aprovado: falhas.length === 0 }, null, 2));
  } else {
    ctx.escrever([...linhas, ...falhas.map((f) => `FALHA ${f}`), falhas.length ? `reprovado: ${falhas.length} falha(s)` : 'aprovado'].join('\n'));
  }
  return falhas.length ? 1 : 0;
}

/** Sem `--tudo`, fica o indice de todo HEAD das arvores do repositorio: o estado e compartilhado entre elas. */
function limpar(ctx: ContextoDoCli, p: Pedido): number {
  let manter: string[] = [], manterRevisoes: string[] = [];
  if (!p.bandeiras.has('tudo')) {
    const arvore = revisaoDaArvore(ctx.raiz);
    manterRevisoes = headsDasArvores(arvore.raiz);
    if (arvore.head) manter = [chaveDoIndice(arvore.head, perfilDoIndice(arvore.raiz, undefined, ctx.repositorio ? { repository_id: ctx.repositorio } : {}))];
  }
  const r = limparIndices(ctx, { manter, manterRevisoes, tudo: p.bandeiras.has('tudo') });
  if (p.bandeiras.has('json')) ctx.escrever(JSON.stringify({ schema: STATUS_SCHEMA, manter, manter_revisoes: manterRevisoes, ...r }, null, 2));
  else ctx.escrever([`grafo limpar: ${r.removidos.length} removido(s), ${mb(r.bytes)}`, ...r.removidos.map((x) => `  ${x.nome} ${mb(x.bytes)}`)].join('\n'));
  return 0;
}

/** KG5 (D4, D5): com `--teto-bytes` o erro tambem sai compacto; recusa de indice traz o estado e a correcao. */
const erroEmJson = (ctx: ContextoDoCli, e: unknown, compacto: boolean): number => {
  const [codigo, ...detalhe] = String((e as Error).message).split('\n')[0].split(': ');
  const doIndice = Object.prototype.hasOwnProperty.call(ESTADO_DO_INDICE, codigo)
    ? { estado_do_indice: ESTADO_DO_INDICE[codigo], correcao: CORRECAO_DO_INDICE } : {};
  const r = {
    schema: CONSULTA_SCHEMA,
    erro: { codigo, detalhe: detalhe.join(': ') || null, candidatos: e instanceof ErroDeConsulta ? e.candidatos : [], ...doIndice },
  };
  ctx.escrever(compacto ? JSON.stringify(r) : JSON.stringify(r, null, 2));
  return 1;
};

/** `ork grafo <subcomando> ...`: devolve o codigo de saida; sem `--json`, o erro de uso ou tipado e lancado. */
export function executarGrafo(argv: readonly string[], ctx: ContextoDoCli): number {
  const compacto = argv.some((a) => a === '--teto-bytes' || a.startsWith('--teto-bytes='));
  let p: Pedido;
  try {
    p = lerPedido(argv);
  } catch (e) {
    // Com `--json` no argv, tambem o erro de uso sai como objeto, como os demais.
    if (argv.includes('--json')) return erroEmJson(ctx, e, compacto);
    throw e;
  }
  try {
    if (p.sub === 'indexar') return indexar(ctx, p);
    if (p.sub === 'status') return status(ctx, p);
    if (p.sub === 'amostra') return amostra(ctx, p);
    if (p.sub === 'limpar') return limpar(ctx, p);
    return consultar(ctx, p);
  } catch (e) {
    if (!p.bandeiras.has('json')) throw e;
    return erroEmJson(ctx, e, compacto);
  }
}


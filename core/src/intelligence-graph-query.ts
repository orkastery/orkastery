/**
 * RM-031 KG3 (D5 a D7): consulta sobre o grafo do indice.
 *
 * Modulo puro: recebe o grafo ja lido e a concessao, sem arquivo, processo, rede, relogio nem acaso.
 * So percorre arestas do grafo: nada de busca textual, inferencia ou similaridade. O que o extrator
 * do KG2 nao prova nao esta no grafo, e toda resposta diz que e parcial.
 *
 * D6: a concessao filtra antes de qualquer mapa (`filtrarGrafo`): no, aresta, evidencia e
 * diagnostico fora dela nao existem para a consulta nem para a amostra, nem em resposta, contagem,
 * candidato ou erro.
 *
 * D7: a resposta e a mesma para o mesmo grafo e a mesma pergunta, byte a byte, em texto e em JSON
 * (`ork.code-graph-query/v0`, provisorio e fora do contrato): ordem por code point, sem horario.
 *
 * RM-031 KG5 fatia 5 (D2 a D4, D9, D10): a resposta traz `fontes`, o sha256 e o blob de cada caminho
 * citado, e cada aresta diz se as fontes dela conferem com a arvore. Quem chama passa a situacao de
 * cada caminho (o CLI le os bytes); sem ela, tudo vale `igual`, e a consulta continua sem arquivo.
 */
import {
  TIPOS_DE_ARESTA, compararUtf8, type Acesso, type Aresta, type Evidencia, type GrafoCodigo, type No, type TipoDeAresta, type TipoDeNo,
} from './intelligence-graph-contract';

export const CONSULTA_SCHEMA = 'ork.code-graph-query/v0' as const;
export const PROFUNDIDADE_MAXIMA = 5;
export const LIMITE_PADRAO = 500;
export const LIMITE_MAXIMO = 10_000;
/** Candidatos listados quando um nome solto e ambiguo. */
export const CANDIDATOS_LISTADOS = 20;
export const AVISO_DE_PARCIALIDADE =
  'parcial: so arestas que o extrator prova; chamada por despacho de tipo, import nao resolvido e as lacunas do relatorio de extracao ficam fora';

export type Sentido = 'entrada' | 'saida' | 'ambos';
export type TipoDeConsulta = 'vizinhos' | 'chamadores' | 'importadores' | 'caminho';
export interface Concessao { tenant_id: string; acl_refs: readonly string[] }
/** KG5 fatia 5 (D3): a fonte na arvore tem os bytes do indice, outros bytes, ou nao ha arquivo regular no caminho. */
export type SituacaoDaFonte = 'igual' | 'modificada' | 'ausente';
/** Quem chama diz a situacao de cada caminho do manifesto; a consulta nao le arquivo. */
export type SituacaoNaArvore = (p: string) => SituacaoDaFonte;
/** Sem saber da arvore, toda fonte vale `igual`: e o que a arvore limpa garante. */
export const TUDO_IGUAL: SituacaoNaArvore = () => 'igual';

/** Erro tipado da consulta; `candidatos` so no nome ambiguo, e so com nos visiveis. */
export class ErroDeConsulta extends Error {
  constructor(readonly codigo: string, readonly detalhe: string, readonly candidatos: string[] = []) {
    super(`${codigo}: ${detalhe}`);
  }
}

export interface GrafoConsultavel {
  repository_id: string;
  snapshot_id: string;
  nos: Map<string, No>;
  rotulos: Map<string, string>;
  porLocalizador: Map<string, No>;
  arquivos: Map<string, No>;
  porFragmento: Map<string, No[]>;
  /** Por no, as arestas que saem e as que chegam, na ordem fixa (tipo, outra ponta, id). */
  saida: Map<string, Aresta[]>;
  entrada: Map<string, Aresta[]>;
  /** KG5 fatia 5 (D2): por caminho do manifesto visivel na concessao, o sha256 e o blob dos bytes indexados. */
  fontes: Map<string, { source_hash: string; source_version: string }>;
}

const TIPOS_DE_NO_COM_FRAGMENTO: readonly TipoDeNo[] = ['symbol', 'section', 'artifact'];
const chaveDoLocalizador = (kind: string, p: string, fragmento: string | null): string => `${kind}\u0000${p}\u0000${fragmento ?? ''}`;
export const rotuloDoNo = (n: No): string => `${n.kind} ${n.locator.path}${n.locator.fragment === null ? '' : `#${n.locator.fragment}`}`;

function visivel(a: Acesso, c: Concessao): boolean {
  return a.tenant_id === c.tenant_id && a.acl_refs.every((r) => c.acl_refs.includes(r));
}

/**
 * D6: o grafo so com o que a concessao ve. Aresta precisa estar visivel, com as duas pontas visiveis
 * e ao menos uma evidencia visivel; evidencia e diagnostico fora da concessao saem.
 */
export function filtrarGrafo(grafo: GrafoCodigo, concessao: Concessao): GrafoCodigo {
  const nodes = grafo.nodes.filter((n) => visivel(n.access, concessao));
  const ids = new Set(nodes.map((n) => n.node_id));
  const edges: Aresta[] = [];
  for (const a of grafo.edges) {
    if (!visivel(a.access, concessao) || !ids.has(a.from) || !ids.has(a.to)) continue;
    const evidence = a.evidence.filter((e) => visivel(e.access, concessao));
    if (evidence.length) edges.push(evidence.length === a.evidence.length ? a : { ...a, evidence });
  }
  return { ...grafo, nodes, edges, diagnostics: grafo.diagnostics.filter((d) => visivel(d.access, concessao)) };
}

/** D6: filtra pela concessao e monta os mapas. Nada fora dela entra em mapa nenhum. */
export function prepararConsulta(grafoInteiro: GrafoCodigo, concessao: Concessao): GrafoConsultavel {
  const grafo = filtrarGrafo(grafoInteiro, concessao);
  const nos = new Map<string, No>(), rotulos = new Map<string, string>(), porLocalizador = new Map<string, No>();
  const arquivos = new Map<string, No>(), porFragmento = new Map<string, No[]>();
  for (const n of grafo.nodes) {
    nos.set(n.node_id, n);
    rotulos.set(n.node_id, rotuloDoNo(n));
    porLocalizador.set(chaveDoLocalizador(n.kind, n.locator.path, n.locator.fragment), n);
    if (n.kind === 'file') arquivos.set(n.locator.path, n);
    else if (n.locator.fragment !== null) {
      const lista = porFragmento.get(n.locator.fragment) ?? [];
      lista.push(n);
      porFragmento.set(n.locator.fragment, lista);
    }
  }
  const saida = new Map<string, Aresta[]>(), entrada = new Map<string, Aresta[]>();
  for (const aresta of grafo.edges) {
    for (const [mapa, id] of [[saida, aresta.from], [entrada, aresta.to]] as const) {
      const lista = mapa.get(id) ?? [];
      lista.push(aresta);
      mapa.set(id, lista);
    }
  }
  const ordem = (outra: (a: Aresta) => string) => (x: Aresta, y: Aresta): number =>
    compararUtf8(x.kind, y.kind) || compararUtf8(outra(x), outra(y)) || compararUtf8(x.edge_id, y.edge_id);
  for (const lista of saida.values()) lista.sort(ordem((a) => rotulos.get(a.to) as string));
  for (const lista of entrada.values()) lista.sort(ordem((a) => rotulos.get(a.from) as string));
  for (const lista of porFragmento.values()) lista.sort((x, y) => compararUtf8(rotuloDoNo(x), rotuloDoNo(y)));
  const fontes = new Map<string, { source_hash: string; source_version: string }>();
  for (const m of grafo.snapshot.source_manifest) if (visivel(m.access, concessao)) fontes.set(m.path, { source_hash: m.source_hash, source_version: m.source_version });
  return { repository_id: grafo.repository_id, snapshot_id: grafo.snapshot.snapshot_id, nos, rotulos, porLocalizador, arquivos, porFragmento, saida, entrada, fontes };
}

function ambiguo(texto: string, candidatos: No[]): never {
  const rotulos = candidatos.map(rotuloDoNo).sort(compararUtf8);
  const listados = rotulos.slice(0, CANDIDATOS_LISTADOS);
  throw new ErroDeConsulta('grafo.consulta.ambiguo', `${texto} tem ${rotulos.length} candidatos: ${listados.join('; ')}${rotulos.length > listados.length ? '; ...' : ''}`, listados);
}

/** Os nos com o localizador `caminho#fragmento` em cada `#` do texto: o fragmento tambem pode ter `#` (`Classe.#privado`). */
function porLocalizadores(g: GrafoConsultavel, texto: string, tipos: readonly TipoDeNo[]): No[] {
  const achados = new Map<string, No>();
  for (let i = texto.indexOf('#'); i > 0; i = texto.indexOf('#', i + 1)) {
    for (const k of tipos) {
      const n = g.porLocalizador.get(chaveDoLocalizador(k, texto.slice(0, i), texto.slice(i + 1)));
      if (n) achados.set(n.node_id, n);
    }
  }
  return [...achados.values()];
}

/**
 * D5: o no pelo texto. `tipo:caminho#fragmento` fixa o tipo; `caminho` exato e o arquivo;
 * `caminho#fragmento` e o no com esse localizador, em qualquer `#` que separe um caminho que existe;
 * o resto e nome solto, que casa o fragmento exato de um simbolo, secao ou artefato. Ambiguo lista os
 * candidatos, nunca escolhe. O rotulo que a resposta imprime (sem o tipo) volta como entrada.
 */
export function resolverNo(g: GrafoConsultavel, texto: string): No {
  if (!texto) throw new ErroDeConsulta('grafo.consulta.uso', 'no vazio');
  const desconhecido = (): never => {
    throw new ErroDeConsulta('grafo.consulta.no-desconhecido', texto);
  };
  const tipado = /^(file|symbol|section|artifact):(.+)$/.exec(texto);
  if (tipado) {
    const kind = tipado[1] as TipoDeNo, resto = tipado[2];
    if (kind === 'file') return g.arquivos.get(resto) ?? desconhecido();
    const candidatos = porLocalizadores(g, resto, [kind]);
    if (candidatos.length === 1) return candidatos[0];
    if (candidatos.length > 1) ambiguo(texto, candidatos);
    return desconhecido();
  }
  const arquivo = g.arquivos.get(texto);
  if (arquivo) return arquivo;
  const candidatos = porLocalizadores(g, texto, TIPOS_DE_NO_COM_FRAGMENTO);
  if (candidatos.length === 1) return candidatos[0];
  if (candidatos.length > 1) ambiguo(texto, candidatos);
  const soltos = g.porFragmento.get(texto) ?? [];
  if (soltos.length === 1) return soltos[0];
  if (soltos.length > 1) ambiguo(texto, soltos);
  return desconhecido();
}

export interface NoDaResposta { rotulo: string; kind: TipoDeNo; path: string; fragment: string | null; node_id: string; distancia: number | null }
export interface EvidenciaDaResposta {
  extractor_id: string; extractor_version: string; extraction_method: Evidencia['extraction_method']; path: string; span: Evidencia['span'];
}
/**
 * `distancia`: na vizinhanca, os saltos do alvo ate o no que a explorou; no caminho, o numero do passo.
 * `arvore` (KG5 fatia 5, D4): `igual` so quando todas as fontes da aresta, as duas pontas e as evidencias,
 * tem na arvore os bytes do indice.
 */
export interface ArestaDaResposta {
  kind: TipoDeAresta; from: string; to: string; edge_id: string; distancia: number; arvore: 'igual' | 'modificada'; evidencias: EvidenciaDaResposta[];
}
export interface PassoDoCaminho { sentido: 'saida' | 'entrada'; aresta: ArestaDaResposta }
/** KG5 fatia 5 (D2): a identidade dos bytes de que as evidencias vieram, um caminho por entrada, e a situacao dele na arvore. */
export interface FonteDaResposta { path: string; source_hash: string; source_version: string; arvore: SituacaoDaFonte }

/** O que o chamador sabe do indice: vai no cabecalho da resposta. */
export interface CabecalhoDoIndice {
  repository_id: string;
  revision: string;
  chave: string;
  snapshot_id: string;
  graph_digest: string;
  /** `modificada` quando a arvore tem mudanca rastreada: a resposta e do HEAD. */
  arvore: 'limpa' | 'modificada';
  extratores: { extractor_id: string; extractor_version: string }[];
}

export interface RespostaDeConsulta {
  schema: typeof CONSULTA_SCHEMA;
  consulta: {
    tipo: TipoDeConsulta; alvo: string; para: string | null; profundidade: number | null; sentido: Sentido; tipos: TipoDeAresta[]; limite: number | null;
  };
  indice: CabecalhoDoIndice;
  alvo: NoDaResposta;
  para: NoDaResposta | null;
  /** Os nos das arestas devolvidas, mais o alvo; `total_nos` conta todos os do raio. */
  nos: NoDaResposta[];
  total_nos: number;
  arestas: ArestaDaResposta[];
  total_arestas: number;
  truncado: boolean;
  caminho: PassoDoCaminho[] | null;
  nos_explorados: number | null;
  /** KG5 fatia 5 (D2, D10): os caminhos dos nos e das evidencias devolvidas, em ordem UTF-8. */
  fontes: FonteDaResposta[];
  parcial: string;
}

function noDaResposta(g: GrafoConsultavel, n: No, distancia: number | null): NoDaResposta {
  return { rotulo: g.rotulos.get(n.node_id) as string, kind: n.kind, path: n.locator.path, fragment: n.locator.fragment, node_id: n.node_id, distancia };
}

type ArestaSemArvore = Omit<ArestaDaResposta, 'arvore'>;

function arestaDaResposta(g: GrafoConsultavel, a: Aresta, distancia: number): ArestaSemArvore {
  const evidencias = a.evidence.map((e): EvidenciaDaResposta => ({
    extractor_id: e.extractor_id, extractor_version: e.extractor_version, extraction_method: e.extraction_method, path: e.path, span: e.span,
  })).sort((x, y) => compararUtf8(x.path, y.path) || (x.span.byte_start - y.span.byte_start) || (x.span.byte_end - y.span.byte_end)
    || compararUtf8(x.extractor_id, y.extractor_id) || compararUtf8(x.extraction_method, y.extraction_method));
  return { kind: a.kind, from: g.rotulos.get(a.from) as string, to: g.rotulos.get(a.to) as string, edge_id: a.edge_id, distancia, evidencias };
}

/**
 * KG5 fatia 5 (D4): a aresta so e `igual` quando as fontes dela inteiras conferem: o arquivo da origem, o
 * do alvo (calls e imports resolvem o alvo nele) e os das evidencias. So as devolvidas pedem a situacao.
 * Com teto, a busca binaria monta respostas com limites diferentes, e o CLI le os arquivos citados pela
 * maior delas, a do limite pedido, mesmo os que o corte tira (CHECK rodada 1, S4).
 */
function comArvore(g: GrafoConsultavel, a: Aresta, r: ArestaSemArvore, situacao: SituacaoNaArvore): ArestaDaResposta {
  const caminhos = [(g.nos.get(a.from) as No).locator.path, (g.nos.get(a.to) as No).locator.path, ...r.evidencias.map((e) => e.path)];
  const { evidencias, ...resto } = r;
  return { ...resto, arvore: caminhos.every((p) => situacao(p) === 'igual') ? 'igual' : 'modificada', evidencias };
}

/** KG5 fatia 5 (D2, D10): uma entrada por caminho dos nos e das evidencias da resposta, em ordem UTF-8. */
function fontesDaResposta(g: GrafoConsultavel, nos: readonly NoDaResposta[], arestas: readonly ArestaDaResposta[], situacao: SituacaoNaArvore): FonteDaResposta[] {
  const caminhos = new Set(nos.map((n) => n.path));
  for (const a of arestas) for (const e of a.evidencias) caminhos.add(e.path);
  const fontes: FonteDaResposta[] = [];
  for (const p of [...caminhos].sort(compararUtf8)) {
    const f = g.fontes.get(p);
    if (f) fontes.push({ path: p, source_hash: f.source_hash, source_version: f.source_version, arvore: situacao(p) });
  }
  return fontes;
}

/** CHECK rodada 1 (A2): primeiro as arestas mais perto do alvo, e o limite corta as mais longe. */
const ordemDasArestas = (x: ArestaSemArvore, y: ArestaSemArvore): number => (x.distancia - y.distancia)
  || compararUtf8(x.kind, y.kind) || compararUtf8(x.from, y.from) || compararUtf8(x.to, y.to) || compararUtf8(x.edge_id, y.edge_id);

function incidentes(g: GrafoConsultavel, id: string, sentido: Sentido, tipos: ReadonlySet<TipoDeAresta>): { aresta: Aresta; outra: string; sentido: 'saida' | 'entrada' }[] {
  const r: { aresta: Aresta; outra: string; sentido: 'saida' | 'entrada' }[] = [];
  if (sentido !== 'entrada') for (const a of g.saida.get(id) ?? []) if (tipos.has(a.kind)) r.push({ aresta: a, outra: a.to, sentido: 'saida' });
  if (sentido !== 'saida') for (const a of g.entrada.get(id) ?? []) if (tipos.has(a.kind)) r.push({ aresta: a, outra: a.from, sentido: 'entrada' });
  return r;
}

export interface OpcoesDeVizinhanca { profundidade?: number; sentido?: Sentido; tipos?: readonly TipoDeAresta[]; limite?: number }

function inteiroEntre(nome: string, v: number, min: number, max: number): number {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new ErroDeConsulta('grafo.consulta.uso', `${nome} precisa ser inteiro de ${min} a ${max}`);
  return v;
}

function tiposValidos(tipos: readonly TipoDeAresta[] | undefined): TipoDeAresta[] {
  const lista = [...new Set(tipos ?? TIPOS_DE_ARESTA)];
  for (const t of lista) if (!(TIPOS_DE_ARESTA as readonly string[]).includes(t)) throw new ErroDeConsulta('grafo.consulta.uso', `tipo de aresta desconhecido: ${t}`);
  if (!lista.length) throw new ErroDeConsulta('grafo.consulta.uso', 'nenhum tipo de aresta');
  return lista.sort(compararUtf8);
}

/**
 * D5: o raio `profundidade` em volta do alvo, pelo sentido e pelos tipos pedidos. Entram os nos a
 * ate `profundidade` saltos e todas as arestas que saem dos nos a menos de `profundidade` saltos,
 * cada uma com a distancia do no que a explorou. `limite` corta pela distancia e pela ordem fixa, e
 * a lista de nos so traz o alvo e as pontas das arestas devolvidas.
 */
function vizinhanca(g: GrafoConsultavel, cabecalho: CabecalhoDoIndice, tipo: TipoDeConsulta, texto: string, opcoes: OpcoesDeVizinhanca,
  situacao: SituacaoNaArvore): RespostaDeConsulta {
  const profundidade = inteiroEntre('profundidade', opcoes.profundidade ?? 1, 1, PROFUNDIDADE_MAXIMA);
  const limite = inteiroEntre('limite', opcoes.limite ?? LIMITE_PADRAO, 1, LIMITE_MAXIMO);
  const sentido = opcoes.sentido ?? 'ambos';
  if (!['entrada', 'saida', 'ambos'].includes(sentido)) throw new ErroDeConsulta('grafo.consulta.uso', `sentido desconhecido: ${sentido}`);
  const tipos = tiposValidos(opcoes.tipos), permitidos = new Set(tipos);
  const alvo = resolverNo(g, texto);
  const distancia = new Map<string, number>([[alvo.node_id, 0]]), vistas = new Map<string, { aresta: Aresta; d: number }>();
  let camada = [alvo.node_id];
  for (let d = 0; d < profundidade && camada.length; d++) {
    const proxima: string[] = [];
    for (const id of camada.sort((x, y) => compararUtf8(g.rotulos.get(x) as string, g.rotulos.get(y) as string))) {
      for (const { aresta, outra } of incidentes(g, id, sentido, permitidos)) {
        if (!vistas.has(aresta.edge_id)) vistas.set(aresta.edge_id, { aresta, d });
        if (!distancia.has(outra)) {
          distancia.set(outra, d + 1);
          proxima.push(outra);
        }
      }
    }
    camada = proxima;
  }
  const todas = [...vistas.values()].map(({ aresta, d }) => ({ aresta, r: arestaDaResposta(g, aresta, d) })).sort((x, y) => ordemDasArestas(x.r, y.r));
  const devolvidas = todas.slice(0, limite).map(({ aresta, r }) => comArvore(g, aresta, r, situacao));
  const idPorRotulo = new Map([...distancia.keys()].map((id) => [g.rotulos.get(id) as string, id]));
  const pontas = new Set([alvo.node_id, ...devolvidas.flatMap((a) => [idPorRotulo.get(a.from), idPorRotulo.get(a.to)] as string[])]);
  const nos = [...pontas].map((id) => noDaResposta(g, g.nos.get(id) as No, distancia.get(id) as number))
    .sort((x, y) => ((x.distancia as number) - (y.distancia as number)) || compararUtf8(x.rotulo, y.rotulo));
  return {
    schema: CONSULTA_SCHEMA,
    consulta: { tipo, alvo: texto, para: null, profundidade, sentido, tipos, limite },
    indice: cabecalho, alvo: noDaResposta(g, alvo, 0), para: null, nos, total_nos: distancia.size,
    arestas: devolvidas, total_arestas: todas.length, truncado: todas.length > limite,
    caminho: null, nos_explorados: null, fontes: fontesDaResposta(g, nos, devolvidas, situacao), parcial: AVISO_DE_PARCIALIDADE,
  };
}

export function vizinhos(g: GrafoConsultavel, cabecalho: CabecalhoDoIndice, alvo: string, opcoes: OpcoesDeVizinhanca = {},
  situacao: SituacaoNaArvore = TUDO_IGUAL): RespostaDeConsulta {
  return vizinhanca(g, cabecalho, 'vizinhos', alvo, opcoes, situacao);
}

/** Quem chama o simbolo: as arestas `calls` que chegam, ate `profundidade` saltos. */
export function chamadores(g: GrafoConsultavel, cabecalho: CabecalhoDoIndice, alvo: string, opcoes: Pick<OpcoesDeVizinhanca, 'profundidade' | 'limite'> = {},
  situacao: SituacaoNaArvore = TUDO_IGUAL): RespostaDeConsulta {
  if (resolverNo(g, alvo).kind !== 'symbol') throw new ErroDeConsulta('grafo.consulta.alvo-invalido', 'chamadores pede um simbolo; para arquivo, use importadores ou vizinhos');
  return vizinhanca(g, cabecalho, 'chamadores', alvo, { ...opcoes, sentido: 'entrada', tipos: ['calls'] }, situacao);
}

/** Quem importa o arquivo ou o simbolo: as arestas `imports` que chegam, ate `profundidade` saltos. */
export function importadores(g: GrafoConsultavel, cabecalho: CabecalhoDoIndice, alvo: string, opcoes: Pick<OpcoesDeVizinhanca, 'profundidade' | 'limite'> = {},
  situacao: SituacaoNaArvore = TUDO_IGUAL): RespostaDeConsulta {
  const kind = resolverNo(g, alvo).kind;
  if (kind !== 'file' && kind !== 'symbol') throw new ErroDeConsulta('grafo.consulta.alvo-invalido', 'importadores pede um arquivo ou um simbolo');
  return vizinhanca(g, cabecalho, 'importadores', alvo, { ...opcoes, sentido: 'entrada', tipos: ['imports'] }, situacao);
}

/**
 * D5: o menor caminho de `de` a `para`, pelas arestas no sentido pedido (padrao: `saida`, a direcao
 * da aresta). Busca em largura com a expansao na ordem fixa: entre caminhos do mesmo tamanho, sai
 * sempre o mesmo. Sem caminho, `caminho` e `null`, com os nos explorados.
 */
export function caminho(g: GrafoConsultavel, cabecalho: CabecalhoDoIndice, de: string, para: string,
  opcoes: { sentido?: Sentido; tipos?: readonly TipoDeAresta[] } = {}, situacao: SituacaoNaArvore = TUDO_IGUAL): RespostaDeConsulta {
  const sentido = opcoes.sentido ?? 'saida';
  if (!['entrada', 'saida', 'ambos'].includes(sentido)) throw new ErroDeConsulta('grafo.consulta.uso', `sentido desconhecido: ${sentido}`);
  const tipos = tiposValidos(opcoes.tipos), permitidos = new Set(tipos);
  const origem = resolverNo(g, de), destino = resolverNo(g, para);
  const anterior = new Map<string, { de: string; aresta: Aresta; sentido: 'saida' | 'entrada' } | null>([[origem.node_id, null]]);
  const fila = [origem.node_id];
  for (let i = 0; i < fila.length && !anterior.has(destino.node_id); i++) {
    for (const { aresta, outra, sentido: s } of incidentes(g, fila[i], sentido, permitidos)) {
      if (anterior.has(outra)) continue;
      anterior.set(outra, { de: fila[i], aresta, sentido: s });
      fila.push(outra);
    }
  }
  let passos: PassoDoCaminho[] | null = null;
  let nos = [noDaResposta(g, origem, 0), noDaResposta(g, destino, null)];
  if (anterior.has(destino.node_id)) {
    const cadeia: { id: string; sentido: 'saida' | 'entrada'; aresta: Aresta }[] = [];
    for (let id = destino.node_id, atual = anterior.get(id); atual; id = atual.de, atual = anterior.get(id)) {
      cadeia.push({ id, sentido: atual.sentido, aresta: atual.aresta });
    }
    cadeia.reverse();
    passos = cadeia.map((c, n) => ({ sentido: c.sentido, aresta: comArvore(g, c.aresta, arestaDaResposta(g, c.aresta, n), situacao) }));
    nos = [origem.node_id, ...cadeia.map((c) => c.id)].map((id, d) => noDaResposta(g, g.nos.get(id) as No, d));
  }
  const arestas = passos ? passos.map((p) => p.aresta) : [];
  return {
    schema: CONSULTA_SCHEMA,
    consulta: { tipo: 'caminho', alvo: de, para, profundidade: null, sentido, tipos, limite: null },
    indice: cabecalho, alvo: noDaResposta(g, origem, 0), para: noDaResposta(g, destino, passos ? passos.length : null),
    nos, total_nos: nos.length,
    arestas, total_arestas: arestas.length, truncado: false,
    caminho: passos, nos_explorados: anterior.size, fontes: fontesDaResposta(g, nos, arestas, situacao), parcial: AVISO_DE_PARCIALIDADE,
  };
}

export function jsonDaResposta(r: RespostaDeConsulta): string {
  return JSON.stringify(r, null, 2);
}

function linhasDaEvidencia(e: EvidenciaDaResposta): string {
  const s = e.span;
  const onde = s.type === 'text'
    ? `${e.path}:${s.line_start ?? '?'}${s.line_end !== null && s.line_end !== s.line_start ? `-${s.line_end}` : ''}`
    : `${e.path} pagina ${s.page}`;
  return `      ${e.extractor_id} ${e.extraction_method} ${onde} bytes ${s.byte_start}-${s.byte_end}`;
}

/** KG5 fatia 5 (D9): a aresta cuja fonte mudou diz isso na propria linha, como o JSON diz no campo `arvore`. */
function linhasDaAresta(a: ArestaDaResposta, prefixo = '  '): string[] {
  const marca = a.arvore === 'modificada' ? '  [fonte modificada na arvore]' : '';
  return [`${prefixo}${a.kind}  ${a.from} -> ${a.to}${marca}`, ...a.evidencias.map(linhasDaEvidencia)];
}

/** KG5 fatia 5 (D9): ate cinco fontes que nao tem na arvore os bytes do indice, com a situacao de cada uma. */
function linhaDasFontesMudadas(fontes: readonly FonteDaResposta[]): string[] {
  const mudaram = fontes.filter((f) => f.arvore !== 'igual');
  if (!mudaram.length) return [];
  const resto = mudaram.length > 5 ? ` e mais ${mudaram.length - 5}` : '';
  return [`fontes que mudaram na arvore: ${mudaram.slice(0, 5).map((f) => `${f.path} (${f.arvore})`).join(', ')}${resto}`];
}

export function textoDaResposta(r: RespostaDeConsulta): string {
  const c = r.consulta, i = r.indice;
  const linhas = [
    `grafo de ${i.repository_id} na revisao ${i.revision.slice(0, 12)}, indice ${i.chave.slice(0, 16)}, snapshot ${i.snapshot_id.slice(0, 17)}`,
  ];
  if (i.arvore === 'modificada') linhas.push('aviso: a arvore tem mudanca rastreada; a resposta e do HEAD, nao da arvore');
  linhas.push(...linhaDasFontesMudadas(r.fontes));
  linhas.push(`extratores: ${i.extratores.map((e) => `${e.extractor_id} ${e.extractor_version}`).join(', ')}`);
  if (c.tipo === 'caminho') {
    const para = r.para as NoDaResposta;
    if (!r.caminho) {
      linhas.push(`sem caminho de ${r.alvo.rotulo} para ${para.rotulo} (sentido ${c.sentido}): ${r.nos_explorados} nos explorados`);
    } else {
      linhas.push(`caminho de ${r.alvo.rotulo} para ${para.rotulo} (sentido ${c.sentido}): ${r.caminho.length} passo(s)`);
      r.caminho.forEach((p, n) => linhas.push(...linhasDaAresta(p.aresta, `  ${n + 1}. ${p.sentido === 'entrada' ? '(contra a aresta) ' : ''}`)));
    }
  } else {
    const filtro = c.tipo === 'vizinhos' ? `, sentido ${c.sentido}, tipos ${c.tipos.length === TIPOS_DE_ARESTA.length ? 'todos' : c.tipos.join(',')}` : '';
    linhas.push(`${c.tipo} de ${r.alvo.rotulo} (profundidade ${c.profundidade}${filtro}): ${r.total_arestas} aresta(s), ${r.total_nos - 1} no(s)`);
    for (const a of r.arestas) linhas.push(...linhasDaAresta(a));
    if (r.truncado) linhas.push(`truncado: ${r.arestas.length} de ${r.total_arestas} arestas, as mais perto do alvo; use --limite`);
  }
  linhas.push(r.parcial);
  return linhas.join('\n');
}

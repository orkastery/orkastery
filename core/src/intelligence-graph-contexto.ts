/** KG5 fatia 2: composicao pura do contexto da thread. Sem E/S, relogio ou inferencia. */
import { createHash } from 'node:crypto';
import { canonico, compararUtf8, type GrafoCodigo, type No } from './intelligence-graph-contract';
import { AVISO_DE_PARCIALIDADE, ErroDeConsulta, rotuloDoNo, type CabecalhoDoIndice } from './intelligence-graph-query';

export const CONTEXTO_SCHEMA = 'ork.thread-graph-context/v0' as const;
export const CONTEXTO_TETO_PADRAO = 32768;
export interface EntradaDoContexto {
  thread: string;
  base: string;
  diff: string[];
  goal: string | null;
  plan: string | null;
  claims: { id: string; arquivo: string }[];
}
type Origem = 'diff' | 'goal' | 'plan' | `claim:${string}`;
const hash = (texto: string): string => createHash('sha256').update(texto).digest('hex');

/** Caminho relativo do repositorio, nunca caminho de maquina, URL ou estado privado. */
function caminhoPublico(bruto: string): string | null {
  const p = bruto.replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.startsWith('~') || /[:\\\u0000-\u001f\u007f]/.test(p) || p.length > 500
    || p.split('/').some((x) => !x || x === '..' || x === '.' || x === '.git' || x === '.orkastery')) return null;
  return p;
}

/** GOAL/PLAN citam caminhos relativos a raiz em codigo, links ou texto; nao executam instrucoes. */
function caminhosCitados(texto: string): string[] {
  const r: string[] = [];
  const semCitacoes = texto.replace(/`([^`\n]+)`|\]\(([^)\n]+)\)/g, (_m, codigo: string | undefined, link: string | undefined) => {
    const v = codigo ?? link ?? '';
    if (!/^(?:[a-z]+:|\/)/i.test(v) && (v.includes('/') || /\.[a-z0-9]+(?:#.*|:\d+(?::\d+)?)?$/i.test(v)
      || /^(?:Dockerfile|Makefile|LICENSE)$/.test(v))) r.push(v.replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, ''));
    return ' ';
  });
  for (const m of semCitacoes.matchAll(/(?:^|[\s(\["'])((?:\.?\/?[\p{L}\p{N}_@.-]+\/)*[\p{L}\p{N}_@.-]+\.[a-zA-Z0-9]+)(?=[:#\s),;\]"']|$)/gu)) r.push(m[1]);
  return r;
}

export function sementesDaThread(entrada: EntradaDoContexto): { arquivo: string; origens: Origem[] }[] {
  const mapa = new Map<string, Set<Origem>>();
  const adicionar = (bruto: string, origem: Origem): void => {
    const p = caminhoPublico(bruto);
    if (!p) return;
    const origens = mapa.get(p) ?? new Set<Origem>();
    origens.add(origem); mapa.set(p, origens);
  };
  for (const p of entrada.diff) adicionar(p, 'diff');
  for (const tipo of ['goal', 'plan'] as const) for (const p of caminhosCitados(entrada[tipo] ?? '')) adicionar(p, tipo);
  for (const c of entrada.claims) adicionar(c.arquivo, `claim:${c.id}`);
  return [...mapa].sort(([a], [b]) => compararUtf8(a, b))
    .map(([arquivo, origens]) => ({ arquivo, origens: [...origens].sort(compararUtf8) }));
}

/** O grafo recebido ja deve estar filtrado pela concessao de quem consulta. */
export function pacoteDeContexto(grafo: GrafoCodigo, indice: CabecalhoDoIndice, entrada: EntradaDoContexto,
  tetoBytes = CONTEXTO_TETO_PADRAO): string {
  if (!Number.isInteger(tetoBytes) || tetoBytes < 4096 || tetoBytes > 65536)
    throw new ErroDeConsulta('grafo.contexto.teto-invalido', 'teto deve ser inteiro de 4096 a 65536 bytes');
  const porId = new Map(grafo.nodes.map((n) => [n.node_id, n]));
  const arquivos = new Set(grafo.nodes.filter((n) => n.kind === 'file').map((n) => n.locator.path));
  const sementes = sementesDaThread(entrada).map((s) => ({ ...s, estado: arquivos.has(s.arquivo) ? 'indexado' : 'fora-do-indice' }));
  const alvos = new Set(sementes.filter((s) => s.estado === 'indexado').map((s) => s.arquivo));
  const nosAlvo = new Set(grafo.nodes.filter((n) => alvos.has(n.locator.path)).map((n) => n.node_id));
  const arestas = grafo.edges.filter((a) => nosAlvo.has(a.from) || nosAlvo.has(a.to))
    .map((a) => ({ edge_id: a.edge_id, kind: a.kind, from: a.from, to: a.to,
      evidencias: a.evidence.map((e) => ({ extractor_id: e.extractor_id, extractor_version: e.extractor_version,
        extraction_method: e.extraction_method, path: e.path, span: e.span }))
        .sort((a, b) => compararUtf8(canonico(a), canonico(b))) }))
    .sort((a, b) => compararUtf8(a.kind, b.kind)
      || compararUtf8(rotuloDoNo(porId.get(a.from)!), rotuloDoNo(porId.get(b.from)!))
      || compararUtf8(rotuloDoNo(porId.get(a.to)!), rotuloDoNo(porId.get(b.to)!)) || compararUtf8(a.edge_id, b.edge_id));
  const resumoNo = (n: No) => ({ node_id: n.node_id, kind: n.kind, path: n.locator.path, fragment: n.locator.fragment });
  const normalizada = { ...entrada, diff: [...new Set(entrada.diff)].sort(compararUtf8),
    claims: [...entrada.claims].sort((a, b) => compararUtf8(canonico(a), canonico(b))) };
  const fixo = { schema: CONTEXTO_SCHEMA, thread: entrada.thread, base: entrada.base, entrada_sha256: hash(canonico(normalizada)), indice,
    fontes: { goal: entrada.goal === null ? 'ausente' : hash(entrada.goal), plan: entrada.plan === null ? 'ausente' : hash(entrada.plan) },
    consulta: { profundidade: 1, sentido: 'ambos', sementes: 'arquivos e seus simbolos/secoes' },
    total_sementes: sementes.length, total_arestas: arestas.length, parcial: AVISO_DE_PARCIALIDADE };
  // Prefixo: sementes primeiro, depois arestas. Uma aresta entra com ambas as pontas e TODA evidencia.
  const montar = (quantas: number): string => {
    const ss = sementes.slice(0, quantas), aa = arestas.slice(0, Math.max(0, quantas - sementes.length));
    const caminhos = new Set(ss.filter((s) => s.estado === 'indexado').map((s) => s.arquivo));
    const ids = new Set(grafo.nodes.filter((n) => n.kind === 'file' && caminhos.has(n.locator.path)).map((n) => n.node_id));
    for (const a of aa) { ids.add(a.from); ids.add(a.to); for (const e of a.evidencias) caminhos.add(e.path); }
    const nos = [...ids].map((id) => porId.get(id)!).sort((a, b) => compararUtf8(rotuloDoNo(a), rotuloDoNo(b)));
    for (const n of nos) caminhos.add(n.locator.path);
    const fontes = grafo.snapshot.source_manifest.filter((m) => caminhos.has(m.path)).sort((a, b) => compararUtf8(a.path, b.path));
    const cortado = quantas < sementes.length + arestas.length;
    const r = { ...fixo, sementes: ss, nos: nos.map(resumoNo), arestas: aa, truncado: cortado,
      omitidos: { sementes: sementes.length - ss.length, arestas: arestas.length - aa.length },
      teto: { bytes: tetoBytes, cortado },
      medida: { pacote_bytes: 0, leitura_crua_bytes: fontes.reduce((s, f) => s + f.size_bytes, 0),
        arquivos: fontes.map((f) => ({ path: f.path, bytes: f.size_bytes })), origem: 'source_manifest do indice; arquivos presentes no pacote', tokens: 'unavailable' } };
    // Ponto fixo: incluir o tamanho em seu proprio JSON so altera o numero de digitos.
    let texto = canonico(r);
    while (r.medida.pacote_bytes !== Buffer.byteLength(texto)) { r.medida.pacote_bytes = Buffer.byteLength(texto); texto = canonico(r); }
    return texto;
  };
  let menor = 0, maior = sementes.length + arestas.length, melhor = montar(0);
  if (Buffer.byteLength(melhor) > tetoBytes) throw new ErroDeConsulta('grafo.contexto.teto-excedido', 'cabecalho nao cabe no teto');
  while (menor <= maior) {
    const meio = Math.floor((menor + maior) / 2), texto = montar(meio);
    if (Buffer.byteLength(texto) <= tetoBytes) { melhor = texto; menor = meio + 1; } else maior = meio - 1;
  }
  return melhor;
}

/** KG5 fatia 3: composicao pura do contexto da thread. Sem E/S, relogio ou inferencia. */
import { createHash } from 'node:crypto';
import { canonico, compararUtf8, type GrafoCodigo, type Evidencia, type TipoDeAresta } from './intelligence-graph-contract';
import { AVISO_DE_PARCIALIDADE, ErroDeConsulta, rotuloDoNo, type CabecalhoDoIndice } from './intelligence-graph-query';

export const CONTEXTO_SCHEMA = 'ork.thread-graph-context/v2' as const;
export const CONTEXTO_TETO_PADRAO = 32768;
export const CONTEXTO_POR_ALVO = 8;
export const CONTEXTO_FORA_DO_INDICE = 3;
export interface EntradaDoContexto {
  thread: string;
  base: string;
  diff: string[];
  diffEstado?: 'coletado-na-worktree' | 'ignorado-sem-worktree';
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
function caminhosCitados(texto: string, diretorios: Set<string>): string[] {
  const r: string[] = [];
  const semCitacoes = texto.replace(/`([^`\n]+)`|\]\(([^)\n]+)\)/g, (_m, codigo: string | undefined, link: string | undefined) => {
    const v = codigo ?? link ?? '';
    if (!/^(?:[a-z]+:|\/)/i.test(v) && (v.includes('/') || /\.[a-z0-9]+(?:#.*|:\d+(?::\d+)?)?$/i.test(v)
      || /^(?:Dockerfile|Makefile|LICENSE)$/.test(v))) r.push(v.replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, ''));
    return ' ';
  });
  // Em prosa, exigir diretorio ou extensao de fonte conhecida evita versoes, Node.js e dominios.
  for (const m of semCitacoes.matchAll(/(?:^|[\s(\["'])((?:[\p{L}\p{N}_@.-]+\/)+[\p{L}\p{N}_@.-]+|[\p{L}\p{N}_@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|markdown|yaml|yml|toml|py|rs|go|c|h|css|html))(?=\.(?:\s|$)|[:#\s),;\]"']|$)/gu)) if (!/^Node\.js\.?$/i.test(m[1])) r.push(m[1].replace(/\.$/, ''));
  return r.filter((bruto) => {
    const p = caminhoPublico(bruto);
    return p !== null && !/^Node\.js$/i.test(p) && (
      /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|markdown|yaml|yml|toml|py|rs|go|c|h|css|html)$/i.test(p)
      || /(?:^|\/)(?:Dockerfile|Makefile|LICENSE)$/.test(p)
      || (p.includes('/') && diretorios.has(p.split('/')[0])));
  });
}

export function sementesDaThread(entrada: EntradaDoContexto, caminhosDoRepositorio: readonly string[] = []): { arquivo: string; origens: Origem[] }[] {
  const diretorios = new Set(caminhosDoRepositorio.filter((p) => p.includes('/')).map((p) => p.split('/')[0]));
  const mapa = new Map<string, Set<Origem>>();
  const adicionar = (bruto: string, origem: Origem): void => {
    const p = caminhoPublico(bruto);
    if (!p) return;
    const origens = mapa.get(p) ?? new Set<Origem>();
    origens.add(origem); mapa.set(p, origens);
  };
  if (entrada.diffEstado !== 'ignorado-sem-worktree') for (const p of entrada.diff) adicionar(p, 'diff');
  for (const tipo of ['goal', 'plan'] as const) for (const p of caminhosCitados(entrada[tipo] ?? '', diretorios)) adicionar(p, tipo);
  for (const c of entrada.claims) adicionar(c.arquivo, `claim:${c.id}`);
  return [...mapa].sort(([a], [b]) => compararUtf8(a, b))
    .map(([arquivo, origens]) => ({ arquivo, origens: [...origens].sort(compararUtf8) }));
}

type TuplaDeEvidencia = [number, Evidencia['extraction_method'],
  [number | null, number | null] | ['pdf', number, string], [number, number]];
interface Grupo {
  kind: TipoDeAresta; origem: string; destino: string; alvo: string; quantidade: number;
  evidencias: Map<string, TuplaDeEvidencia>; entreArquivos: boolean; distancia: number;
}

/** O grafo recebido ja deve estar filtrado pela concessao de quem consulta. */
export function pacoteDeContexto(grafo: GrafoCodigo, indice: CabecalhoDoIndice, entrada: EntradaDoContexto,
  tetoBytes = CONTEXTO_TETO_PADRAO): string {
  if (!Number.isInteger(tetoBytes) || tetoBytes < 4096 || tetoBytes > 65536)
    throw new ErroDeConsulta('grafo.contexto.teto-invalido', 'teto deve ser inteiro de 4096 a 65536 bytes');
  const porId = new Map(grafo.nodes.map((n) => [n.node_id, n]));
  const arquivos = new Set(grafo.nodes.filter((n) => n.kind === 'file').map((n) => n.locator.path));
  const sementes = sementesDaThread(entrada, [...arquivos]).map((s) => ({ ...s, estado: arquivos.has(s.arquivo) ? 'indexado' : 'fora-do-indice' }));
  const indexadas = sementes.filter((s) => s.estado === 'indexado'), ausentes = sementes.filter((s) => s.estado !== 'indexado');
  const alvos = new Set(indexadas.map((s) => s.arquivo));
  const diff = entrada.diffEstado === 'ignorado-sem-worktree' ? [] : [...new Set(entrada.diff)].sort(compararUtf8);
  // Distancia em arquivos, em ambos os sentidos, sem depender da ordem das arestas.
  const adj = new Map<string, Set<string>>();
  for (const a of grafo.edges) {
    const de = porId.get(a.from)!.locator.path, para = porId.get(a.to)!.locator.path;
    if (de === para) continue;
    if (!adj.has(de)) adj.set(de, new Set());
    if (!adj.has(para)) adj.set(para, new Set());
    adj.get(de)!.add(para); adj.get(para)!.add(de);
  }
  const dist = new Map(diff.filter((p) => arquivos.has(p)).map((p) => [p, 0]));
  const fila = [...dist.keys()];
  for (let i = 0; i < fila.length; i++) for (const p of adj.get(fila[i]) ?? []) {
    if (!dist.has(p)) { dist.set(p, dist.get(fila[i])! + 1); fila.push(p); }
  }
  const extratores = [...indice.extratores].sort((a, b) => compararUtf8(canonico(a), canonico(b)));
  const extratorIds = new Map(extratores.map((e, i) => [canonico(e), i]));
  const grupos = new Map<string, Grupo>();
  let totalArestas = 0, estruturais = 0, evidenciasAuxiliares = 0;
  for (const a of grafo.edges) {
    const de = porId.get(a.from)!, para = porId.get(a.to)!;
    if (!alvos.has(de.locator.path) && !alvos.has(para.locator.path)) continue;
    totalArestas++;
    if ((a.kind === 'declares' || a.kind === 'contains') && de.locator.path === para.locator.path && alvos.has(de.locator.path)) {
      estruturais++; continue;
    }
    const proprias = a.evidence.filter((e) => e.path === de.locator.path);
    evidenciasAuxiliares += a.evidence.length - proprias.length;
    // Sem evidencia no arquivo de origem, a aresta fica em omitidos.arestas.
    if (!proprias.length) continue;
    const origem = `file ${de.locator.path}`, destino = rotuloDoNo(para);
    const chave = canonico([a.kind, destino, de.locator.path]);
    const grupo = grupos.get(chave) ?? { kind: a.kind, origem, destino, alvo: para.node_id, quantidade: 0,
      evidencias: new Map<string, TuplaDeEvidencia>(), entreArquivos: de.locator.path !== para.locator.path,
      distancia: Math.min(dist.get(de.locator.path) ?? Infinity, dist.get(para.locator.path) ?? Infinity) };
    grupo.quantidade++;
    for (const e of proprias) {
      const x = extratorIds.get(canonico({ extractor_id: e.extractor_id, extractor_version: e.extractor_version }));
      if (x === undefined) throw new ErroDeConsulta('grafo.contexto.extrator-ausente', 'extrator da evidencia ausente no cabecalho');
      const s = e.span;
      const tupla: TuplaDeEvidencia = [x, e.extraction_method,
        s.type === 'text' ? [s.line_start, s.line_end] : ['pdf', s.page, s.extracted_text_hash], [s.byte_start, s.byte_end]];
      grupo.evidencias.set(canonico(tupla), tupla);
    }
    grupos.set(chave, grupo);
  }
  // Entre arquivos > perto do diff > tipo > rotulos; empates independem da ordem do indice.
  const ordenados = [...grupos.values()].sort((a, b) => Number(b.entreArquivos) - Number(a.entreArquivos)
    || (a.distancia === b.distancia ? 0 : a.distancia < b.distancia ? -1 : 1)
    || compararUtf8(a.kind, b.kind) || compararUtf8(a.destino, b.destino) || compararUtf8(a.origem, b.origem));
  // Dentro da mesma prioridade, intercalar tipos impede calls de expulsar imports/references.
  const rodadas = new Map<string, number>();
  const justos = ordenados.map((g) => {
    const chave = JSON.stringify([g.alvo, g.entreArquivos, g.distancia, g.kind]);
    const rodada = rodadas.get(chave) ?? 0; rodadas.set(chave, rodada + 1);
    return { g, rodada };
  }).sort((a, b) => Number(b.g.entreArquivos) - Number(a.g.entreArquivos)
    || (a.g.distancia === b.g.distancia ? 0 : a.g.distancia < b.g.distancia ? -1 : 1)
    || a.rodada - b.rodada || compararUtf8(a.g.kind, b.g.kind)
    || compararUtf8(a.g.destino, b.g.destino) || compararUtf8(a.g.origem, b.g.origem)).map(({ g }) => g);
  const normalizada = { ...entrada, diff, diffEstado: entrada.diffEstado ?? 'coletado-na-worktree',
    claims: [...entrada.claims].sort((a, b) => compararUtf8(canonico(a), canonico(b))) };
  const fixo = { schema: CONTEXTO_SCHEMA, thread: entrada.thread, base: entrada.base, entrada_sha256: hash(canonico(normalizada)),
    indice: { ...indice, extratores },
    fontes: { goal: entrada.goal === null ? 'ausente' : hash(entrada.goal), plan: entrada.plan === null ? 'ausente' : hash(entrada.plan),
      diff: normalizada.diffEstado },
    consulta: { profundidade: 1, sentido: 'ambos', por_alvo: CONTEXTO_POR_ALVO, fora_do_indice: CONTEXTO_FORA_DO_INDICE },
    total_sementes: sementes.length, sementes_fora_do_indice: ausentes.length, total_arestas: totalArestas,
    total_ligacoes: ordenados.length, resumidas: { estruturais }, parcial: AVISO_DE_PARCIALIDADE };
  const selecionadas: typeof sementes = [], ligacoes: Grupo[] = [];
  const montar = (): string => {
    const caminhos = new Set(selecionadas.filter((s) => s.estado === 'indexado').map((s) => s.arquivo));
    const rotulos = new Set([...caminhos].map((p) => `file ${p}`));
    for (const a of ligacoes) { rotulos.add(a.origem); rotulos.add(a.destino); caminhos.add(porId.get(a.alvo)!.locator.path); caminhos.add(a.origem.slice(5)); }
    const refs = new Map([...rotulos].sort(compararUtf8).map((r, i) => [r, `n${i + 1}`]));
    const fontes = grafo.snapshot.source_manifest.filter((m) => caminhos.has(m.path)).sort((a, b) => compararUtf8(a.path, b.path));
    const omitidos = { sementes: sementes.length - selecionadas.length, ligacoes: ordenados.length - ligacoes.length,
      arestas: totalArestas - estruturais - ligacoes.reduce((s, a) => s + a.quantidade, 0), evidencias_auxiliares: evidenciasAuxiliares };
    const cortado = omitidos.sementes > 0 || omitidos.ligacoes > 0 || omitidos.arestas > 0 || evidenciasAuxiliares > 0;
    const r = { ...fixo, sementes: selecionadas, nos: Object.fromEntries([...refs].map(([r, ref]) => [ref, r])),
      arestas: ligacoes.map((a) => ({ kind: a.kind, from: refs.get(a.origem)!, to: refs.get(a.destino)!, quantidade: a.quantidade,
        evidencias: [...a.evidencias].sort(([a], [b]) => compararUtf8(a, b)).map(([, e]) => e) })),
      truncado: cortado, omitidos, teto: { bytes: tetoBytes, cortado },
      medida: { pacote_bytes: 0, leitura_crua_bytes: fontes.reduce((s, f) => s + f.size_bytes, 0),
        arquivos: fontes.map((f) => ({ path: f.path, bytes: f.size_bytes })),
        origem: 'source_manifest; tamanho dos arquivos, nao custo de descoberta', tokens: 'unavailable' } };
    let texto = canonico(r);
    while (r.medida.pacote_bytes !== Buffer.byteLength(texto)) { r.medida.pacote_bytes = Buffer.byteLength(texto); texto = canonico(r); }
    return texto;
  };
  let melhor = montar();
  if (Buffer.byteLength(melhor) > tetoBytes) throw new ErroDeConsulta('grafo.contexto.teto-excedido', 'cabecalho nao cabe no teto');
  const tentarSemente = (s: typeof sementes[number]): void => {
    selecionadas.push(s);
    const texto = montar();
    if (Buffer.byteLength(texto) <= tetoBytes) melhor = texto; else selecionadas.pop();
  };
  for (const s of indexadas) tentarSemente(s);
  const porAlvo = new Map<string, number>();
  for (const a of justos) {
    if ((porAlvo.get(a.alvo) ?? 0) >= CONTEXTO_POR_ALVO) continue;
    ligacoes.push(a);
    const texto = montar();
    if (Buffer.byteLength(texto) <= tetoBytes) { melhor = texto; porAlvo.set(a.alvo, (porAlvo.get(a.alvo) ?? 0) + 1); }
    else ligacoes.pop(); // Um hub grande nao impede uma ligacao menor e relevante de entrar.
  }
  for (const s of ausentes.slice(0, CONTEXTO_FORA_DO_INDICE)) tentarSemente(s);
  return melhor;
}

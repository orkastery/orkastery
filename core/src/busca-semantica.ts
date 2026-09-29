/**
 * I-38 (T5, D7, D9): busca por significado na memoria do tenant.
 *
 * E ACRESCIMO, nunca troca (P2 do GOAL): o recall e a injecao de prompt continuam so por tag,
 * deterministicos. Esta busca e superficie separada e todo resultado sai com
 * `deterministico: false`.
 *
 * O universo e o export governado do tenant (filtro de injecao e visibilidade da biblioteca):
 *  - vetor: cosseno da consulta contra o indice local do MESMO modelo e dimensao, so para
 *    entradas com sha256 coerente; nunca compara vetores de espacos diferentes;
 *  - FTS: `search_by_text` da biblioteca, filtrado por tenant na ponte e intersectado aqui;
 *  - fusao: RRF com k = 60.
 * A cadeia do vetor e primario, fallback local, nenhum; sem vetor, cai para FTS com motivo tipado.
 */

import {
  AlvoDeEmbedding, arquivoDoIndice, codigoDeEmbedding, Embeddar, espacoDoAlvo, impressaoDaBase, lerIndice,
  vetoresCoerentes,
} from './indice-vetorial';
import { ConfigDeEmbedding, EntradaDeMemoria, MotivoDeEmbeddings } from './types';

export type ModoDeBusca = 'hibrido' | 'vetor' | 'fts';
export type OrigemDaBusca = 'primario' | 'fallback' | 'fts' | 'nenhum';
export const MODOS_DE_BUSCA: readonly ModoDeBusca[] = ['hibrido', 'vetor', 'fts'];
/** D9: constante da fusao RRF. */
export const RRF_K = 60;
export const LIMITE_PADRAO_DA_BUSCA = 10;
export const LIMITE_MAXIMO_DA_BUSCA = 100;
/** Candidatos do lado vetorial que entram na fusao. */
export const CANDIDATOS_DO_VETOR = 50;

export interface ResultadoDaBusca {
  id: string;
  collection: string;
  score: number;
  fontes: ('vetor' | 'fts')[];
  similaridade: number | null;
  resumo: string;
}

export interface ResultadoDaBuscaSemantica {
  texto: string;
  modo: ModoDeBusca;
  origem: OrigemDaBusca;
  modeloUsado: string | null;
  deterministico: false;
  motivo: string | null;
  detalhe: string;
  resultados: ResultadoDaBusca[];
  listas: { vetor: string[]; fts: string[] };
}

export interface OpcoesDaBusca {
  raiz: string;
  tenant: string;
  dsn: string;
  config: ConfigDeEmbedding;
  /** Universo governado do tenant (ja restrito a colecao, quando pedida). */
  universo: EntradaDeMemoria[];
  texto: string;
  modo: ModoDeBusca;
  limite: number;
  chavePresente: boolean;
  /** O fallback local tem dependencias no interpretador da ponte (sonda `health`). */
  fallbackUsavel: boolean;
  timeoutMs: number;
  embeddar?: Embeddar;
  buscarTexto?: (tenant: string, texto: string) => string[];
  env?: NodeJS.ProcessEnv;
}

export function cosseno(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}

/** RRF: soma de 1 / (k + posicao) em cada lista em que o id aparece (posicao comeca em 1). */
export function fundirRrf(listas: string[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const lista of listas) lista.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return scores;
}

const resumo = (conteudo: string): string => conteudo.split('\n')[0].slice(0, 100);

/** Lado vetorial: o primeiro caminho da cadeia que tem indice, responde e fala o mesmo espaco. */
function ladoVetorial(o: OpcoesDaBusca): { alvo: AlvoDeEmbedding | null; modelo: string | null; ranking: { id: string; sim: number }[];
  motivo: MotivoDeEmbeddings | null; detalhes: string[] } {
  const detalhes: string[] = [];
  let motivo: MotivoDeEmbeddings | null = null;
  const falhar = (alvo: AlvoDeEmbedding, m: MotivoDeEmbeddings, d: string) => {
    if (!motivo) motivo = m;
    detalhes.push(`${alvo}: ${m} (${d})`);
  };
  if (o.config.provider === 'none') {
    return { alvo: null, modelo: null, ranking: [], motivo: 'embeddings.nao-configurado', detalhes: ['memory.embedding.provider none'] };
  }
  const base = impressaoDaBase(o.dsn);
  for (const alvo of ['primario', 'fallback'] as const) {
    if (alvo === 'primario' && !o.chavePresente) { falhar(alvo, 'embeddings.chave-ausente', 'variavel declarada fora do ambiente'); continue; }
    if (alvo === 'fallback' && !o.config.fallback_model) { falhar(alvo, 'embeddings.nao-configurado', 'fallback_model vazio'); continue; }
    const espaco = espacoDoAlvo(o.config, alvo, o.env);
    if ('motivo' in espaco) { falhar(alvo, espaco.motivo, espaco.detalhe); continue; }
    if (alvo === 'fallback' && !o.fallbackUsavel) { falhar(alvo, 'embeddings.dependencia-ausente', 'torch/transformers ausentes na ponte'); continue; }
    const lido = lerIndice(arquivoDoIndice(o.raiz, o.tenant, espaco.modelo, espaco.dim),
      { tenant: o.tenant, base, modelo: espaco.modelo, dim: espaco.dim });
    if (lido.outroEspaco) { falhar(alvo, 'embeddings.espaco-vetorial-divergente', 'arquivo de indice de outro modelo, dimensao ou base'); continue; }
    if (!lido.existia) { falhar(alvo, 'embeddings.indice-ausente', `rode ork memory index --modelo ${alvo}`); continue; }
    if (!o.embeddar) { falhar(alvo, 'embeddings.provider-indisponivel', 'transporte de embedding ausente'); continue; }
    let resposta;
    try {
      resposta = o.embeddar({ papel: 'consulta', alvo, modelo: espaco.modelo, dim: espaco.dim, textos: [o.texto] }, { timeoutMs: o.timeoutMs });
    } catch (erro) { falhar(alvo, codigoDeEmbedding(erro), 'a consulta nao foi embedada'); continue; }
    const vetor = resposta?.vetores?.[0];
    // Nunca comparar espacos diferentes: modelo e dimensao da consulta precisam ser os do indice.
    if (resposta?.modelo !== lido.indice.modelo || resposta?.dim !== lido.indice.dim || !Array.isArray(vetor) || vetor.length !== lido.indice.dim) {
      falhar(alvo, 'embeddings.espaco-vetorial-divergente', 'consulta e indice de modelos ou dimensoes diferentes');
      continue;
    }
    const ranking = [...vetoresCoerentes(lido.indice, o.universo)]
      .map(([id, v]) => ({ id, sim: cosseno(vetor, v) }))
      .sort((a, b) => b.sim - a.sim || a.id.localeCompare(b.id));
    return { alvo, modelo: espaco.modelo, ranking, motivo, detalhes };
  }
  return { alvo: null, modelo: null, ranking: [], motivo, detalhes };
}

/** `ork memory search --texto`: ranking hibrido, nunca deterministico, sempre dentro do tenant. */
export function buscarPorSignificado(o: OpcoesDaBusca): ResultadoDaBuscaSemantica {
  const universo = o.universo.filter(e => (e.tags.project ?? []).includes(o.tenant));
  const porId = new Map(universo.map(e => [e.id, e]));
  const saida: ResultadoDaBuscaSemantica = { texto: o.texto, modo: o.modo, origem: 'nenhum', modeloUsado: null,
    deterministico: false, motivo: null, detalhe: '', resultados: [], listas: { vetor: [], fts: [] } };
  const detalhes: string[] = [];
  let similaridade = new Map<string, number>();
  if (o.modo !== 'fts') {
    const v = ladoVetorial({ ...o, universo });
    detalhes.push(...v.detalhes);
    saida.motivo = v.motivo;
    if (v.alvo) {
      saida.origem = v.alvo;
      saida.modeloUsado = v.modelo;
      const candidatos = v.ranking.slice(0, CANDIDATOS_DO_VETOR);
      saida.listas.vetor = candidatos.map(c => c.id);
      similaridade = new Map(candidatos.map(c => [c.id, c.sim]));
    }
  }
  if (o.modo !== 'vetor') {
    try {
      if (!o.buscarTexto) throw new Error('memory.transport.fts');
      // A ponte ja filtra o tenant; a intersecao com o universo governado vale de novo aqui.
      saida.listas.fts = [...new Set(o.buscarTexto(o.tenant, o.texto))].filter(id => porId.has(id));
    } catch (erro) {
      const codigo = /^[a-z]+(?:\.[a-z-]+)+/.exec(erro instanceof Error ? erro.message : '')?.[0] ?? 'memory.transport.fts';
      detalhes.push(`fts: ${codigo}`);
      if (o.modo === 'fts' || saida.origem === 'nenhum') saida.motivo = saida.motivo ?? codigo;
    }
    if (saida.origem === 'nenhum' && !detalhes.some(d => d.startsWith('fts:'))) saida.origem = 'fts';
  }
  const scores = fundirRrf([saida.listas.vetor, saida.listas.fts]);
  saida.resultados = [...scores]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, o.limite)
    .map(([id, score]) => ({
      id, collection: porId.get(id)!.collection, score: Math.round(score * 1e6) / 1e6,
      fontes: [...(saida.listas.vetor.includes(id) ? ['vetor' as const] : []), ...(saida.listas.fts.includes(id) ? ['fts' as const] : [])],
      similaridade: similaridade.has(id) ? Math.round(similaridade.get(id)! * 1e4) / 1e4 : null,
      resumo: resumo(porId.get(id)!.content),
    }));
  saida.detalhe = detalhes.join('; ');
  return saida;
}

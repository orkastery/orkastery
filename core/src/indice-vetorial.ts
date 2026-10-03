/**
 * I-38 (T3, D2, D10, D11): indice vetorial LOCAL e DERIVADO da memoria do tenant.
 *
 * A DSN declarada le e nao escreve (medido no PLAN), e a coluna `embedding` da base
 * compartilhada guarda vetores de outros produtos. Por isso o vetor do `ork` mora aqui, no
 * estado canonico do projeto, um arquivo por tenant, modelo e dimensao:
 *
 *   <raiz canonica>/.orkastery/memoria/vetores/<tenant>/<modelo>-<dim>.json   (0600, fora do git)
 *
 * O OrkMind continua a fonte da verdade; o indice e cache reconstruivel por `ork memory index`.
 * A chave de cada vetor e (id, sha256 do content, modelo, dim): conteudo que mudou reembeda so
 * aquela entrada, e arquivo de outro modelo, dimensao, tenant ou base nunca e misturado.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { COLECOES_DO_ORK, EMBED_MAX_CARACTERES, MODELO_DE_EMBEDDING, PedidoDeEmbedding, pertenceAoUniverso, RespostaDeEmbedding } from './orkmind';
import { procurarSegredos } from './policies';
import { ColecaoDoOrk, ConfigDeEmbedding, EntradaDeMemoria, ForaDaBusca, MotivoDeEmbeddings, UniversoDaBusca } from './types';

export const CONTRATO_INDICE = 'ork.indice-vetorial/v1';
/** D11: lote por chamada da ponte na indexacao. */
export const TAMANHO_DO_LOTE = 16;
/** D11: estimativa conservadora para portugues; o provider da biblioteca descarta `usage`. */
export const CARACTERES_POR_TOKEN = 3;
/** Indexar e trabalho de lote (madrugada), com prazo proprio; a consulta usa o prazo da ponte. */
export const TIMEOUT_DO_LOTE_MS = 120_000;
/**
 * D11: preco publico por token de entrada, conferido em 29/09/2026 com
 * `curl -s https://openrouter.ai/api/v1/embeddings/models`. Estimativa: a fatura e o painel.
 */
export const PRECO_USD_POR_TOKEN: Readonly<Record<string, number>> = Object.freeze({
  'qwen/qwen3-embedding-8b': 0.00000001,
});

/** URL com credencial: o texto nunca vai ao provider. */
const URL_COM_CREDENCIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/;

export type AlvoDeEmbedding = 'primario' | 'fallback';

export interface EntradaDoIndice {
  colecao: string;
  sha256: string;
  /** float32 little-endian em base64. */
  vetor: string;
}

export interface IndiceVetorial {
  contrato: typeof CONTRATO_INDICE;
  tenant: string;
  /** sha256 de host, porta e banco da base declarada; nunca a credencial. */
  base: string;
  modelo: string;
  dim: number;
  entradas: Record<string, EntradaDoIndice>;
}

/**
 * RM-038: a fonte do universo da busca (a operacao `universo` da ponte, pela `Memoria` ou pelo
 * driver). Uma leitura so, ate o fim ou com falha tipada.
 */
export interface FonteDoUniverso {
  universo(tenant: string): { entradas: EntradaDeMemoria[]; foraDaBusca: ForaDaBusca | null };
}

export type Embeddar = (pedido: PedidoDeEmbedding, opcoes?: { timeoutMs?: number }) => RespostaDeEmbedding;

export interface ResultadoDoIndice {
  alvo: AlvoDeEmbedding;
  modelo: string | null;
  dim: number | null;
  arquivo: string | null;
  dryRun: boolean;
  universo: number;
  /** RM-038: o universo da busca por colecao e o que fica fora dele (isso nunca vai ao embed). */
  porColecao: Record<ColecaoDoOrk, number>;
  foraDaBusca: ForaDaBusca | null;
  coerentes: number;
  embedados: number;
  reescritos: number;
  removidos: number;
  recusados: number;
  foraDoLimite: number;
  /** Textos acima do contexto do modelo local, embedados pelo comeco (so no fallback). */
  truncados: number;
  tokensEstimados: number;
  custoEstimadoUsd: number | null;
  chamadasAoProvider: number;
  motivo: MotivoDeEmbeddings | null;
  detalhe: string;
}

const seguro = (nome: string): string => nome.replace(/\//g, '__').replace(/[^A-Za-z0-9_-]/g, '_');

export function dirDosIndices(raiz: string, tenant: string): string {
  return path.join(raizDoEstado(raiz), '.orkastery', 'memoria', 'vetores', seguro(tenant));
}

export function arquivoDoIndice(raiz: string, tenant: string, modelo: string, dim: number): string {
  return path.join(dirDosIndices(raiz, tenant), `${seguro(modelo)}-${dim}.json`);
}

export function sha256DoConteudo(conteudo: string): string {
  return createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

/** Impressao da base: host, porta e banco, sem usuario nem senha. */
export function impressaoDaBase(dsn: string): string {
  let alvo = '';
  try {
    const u = new URL(dsn);
    alvo = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    const campo = (k: string) => new RegExp(`(?:^|\\s)${k}=([^\\s]+)`).exec(dsn)?.[1] ?? '';
    alvo = `${campo('host')}:${campo('port') || '5432'}/${campo('dbname')}`;
  }
  return createHash('sha256').update(alvo).digest('hex');
}

export function codificarVetor(v: number[]): string {
  const buf = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => buf.writeFloatLE(x, i * 4));
  return buf.toString('base64');
}

export function decodificarVetor(b64: string, dim: number): number[] | null {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== dim * 4) return null;
  return Array.from({ length: dim }, (_, i) => buf.readFloatLE(i * 4));
}

/**
 * Le o indice de (tenant, base, modelo, dim). Arquivo ausente, ilegivel ou de outro espaco
 * vetorial volta vazio: reconstruir custa centesimos de centavo, misturar corrompe a busca.
 */
export function lerIndice(arquivo: string, esperado: Omit<IndiceVetorial, 'contrato' | 'entradas'>):
  { indice: IndiceVetorial; existia: boolean; outroEspaco: boolean } {
  const vazio: IndiceVetorial = { contrato: CONTRATO_INDICE, ...esperado, entradas: {} };
  if (!fs.existsSync(arquivo)) return { indice: vazio, existia: false, outroEspaco: false };
  try {
    const o = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as IndiceVetorial;
    if (o.contrato !== CONTRATO_INDICE || o.tenant !== esperado.tenant || o.base !== esperado.base ||
        o.modelo !== esperado.modelo || o.dim !== esperado.dim || !o.entradas || typeof o.entradas !== 'object') {
      return { indice: vazio, existia: true, outroEspaco: true };
    }
    const entradas: Record<string, EntradaDoIndice> = {};
    for (const [id, e] of Object.entries(o.entradas)) {
      if (e && typeof e.sha256 === 'string' && typeof e.colecao === 'string' && typeof e.vetor === 'string' &&
          decodificarVetor(e.vetor, esperado.dim)) entradas[id] = e;
    }
    return { indice: { ...vazio, entradas }, existia: true, outroEspaco: false };
  } catch {
    return { indice: vazio, existia: true, outroEspaco: true };
  }
}

/** Serializacao estavel: mesma memoria, mesmos bytes (idempotencia provada por comparacao). */
export function serializarIndice(indice: IndiceVetorial): string {
  const entradas = Object.fromEntries(Object.keys(indice.entradas).sort().map(id => [id, {
    colecao: indice.entradas[id].colecao, sha256: indice.entradas[id].sha256, vetor: indice.entradas[id].vetor }]));
  return JSON.stringify({ contrato: indice.contrato, tenant: indice.tenant, base: indice.base,
    modelo: indice.modelo, dim: indice.dim, entradas }, null, 1) + '\n';
}

/** Escrita atomica, pasta 0700 e arquivo 0600; so grava quando os bytes mudam. */
export function gravarIndice(arquivo: string, indice: IndiceVetorial): boolean {
  const bytes = serializarIndice(indice);
  if (fs.existsSync(arquivo) && fs.readFileSync(arquivo, 'utf8') === bytes) return false;
  const dir = path.dirname(arquivo);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
  fs.chmodSync(arquivo, 0o600);
  return true;
}

/**
 * RM-038 (D6): a fronteira do universo no `ork`, num lugar so. Entrada de outro tenant, de colecao
 * fora do ork ou com id repetido e violacao tipada, nunca descarte silencioso: nada disso vai ao embed.
 */
export function conferirUniverso(entradas: readonly EntradaDeMemoria[], tenant: string): void {
  const vistos = new Set<string>();
  for (const e of entradas) {
    if (!pertenceAoUniverso(e, tenant) || vistos.has(e.id)) throw new Error('memory.query.scope-violation');
    vistos.add(e.id);
  }
}

/**
 * RM-038 (D4): o universo da busca e do indice, o domicilio unico. A fonte le uma vez (a ponte
 * filtra o tenant na origem e aplica a governanca da biblioteca); aqui a fronteira e conferida de
 * novo, a ordem fica estavel e a contagem por colecao sai pronta para o status e o index.
 */
export function universoDaBusca(fonte: FonteDoUniverso, tenant: string): UniversoDaBusca {
  const lido = fonte.universo(tenant);
  conferirUniverso(lido.entradas, tenant);
  const entradas = [...lido.entradas].sort((a, b) => a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id));
  const porColecao = Object.fromEntries(COLECOES_DO_ORK.map(c => [c, 0])) as Record<ColecaoDoOrk, number>;
  for (const e of entradas) porColecao[e.collection as ColecaoDoOrk] += 1;
  return { tenant, entradas, porColecao, foraDaBusca: lido.foraDaBusca };
}

/** Codigo tipado de uma falha (`memory.query.window-saturated`), ou o padrao quando nao ha. */
export function codigoDaFalha(erro: unknown, padrao = 'memory.universo.indisponivel'): string {
  return /^[a-z]+(?:\.[a-z-]+)+/.exec(erro instanceof Error ? erro.message : '')?.[0] ?? padrao;
}

/** Conteudo que nunca vai ao provider: padrao de segredo da policy ou URL com credencial. */
export function conteudoRecusado(conteudo: string): boolean {
  return procurarSegredos(conteudo).length > 0 || URL_COM_CREDENCIAL.test(conteudo);
}

export function tokensEstimados(conteudo: string): number {
  return Math.ceil(conteudo.length / CARACTERES_POR_TOKEN);
}

/**
 * Dimensao nativa de um modelo local, lida do cache do Hugging Face sem rede e sem Python.
 * null quando o modelo nao esta no cache (a busca cai para FTS com `embeddings.local-ausente`).
 */
export function dimDoModeloLocal(modelo: string, env: NodeJS.ProcessEnv = process.env): number | null {
  if (!modelo || !MODELO_DE_EMBEDDING.test(modelo)) return null;
  const hub = env.HF_HUB_CACHE || path.join(env.HF_HOME || path.join(env.HOME || os.homedir(), '.cache', 'huggingface'), 'hub');
  const repo = path.join(hub, `models--${modelo.replace('/', '--')}`);
  try {
    const ref = fs.readFileSync(path.join(repo, 'refs', 'main'), 'utf8').trim();
    if (!/^[0-9a-f]{40}$/.test(ref)) return null;
    const config = JSON.parse(fs.readFileSync(path.join(repo, 'snapshots', ref, 'config.json'), 'utf8'));
    const dim = Number(config.hidden_size ?? config.d_model ?? config.dim);
    return Number.isInteger(dim) && dim >= 32 && dim <= 4096 ? dim : null;
  } catch { return null; }
}

export function codigoDeEmbedding(erro: unknown): MotivoDeEmbeddings {
  const m = erro instanceof Error ? erro.message : '';
  const tipado = /^embeddings\.[a-z-]+/.exec(m)?.[0];
  if (m === 'memory.transport.timeout') return 'embeddings.timeout';
  if (m.startsWith('memory.transport.secret')) return 'embeddings.conteudo-recusado';
  return (tipado as MotivoDeEmbeddings | undefined) ?? 'embeddings.provider-indisponivel';
}

/** O par (modelo, dim) de cada alvo, ou o motivo tipado de nao haver. */
export function espacoDoAlvo(config: ConfigDeEmbedding, alvo: AlvoDeEmbedding, env: NodeJS.ProcessEnv = process.env):
  { modelo: string; dim: number } | { motivo: MotivoDeEmbeddings; detalhe: string } {
  if (config.provider === 'none') return { motivo: 'embeddings.nao-configurado', detalhe: 'memory.embedding.provider none' };
  if (alvo === 'primario') return { modelo: config.model, dim: config.dim };
  if (!config.fallback_model) return { motivo: 'embeddings.nao-configurado', detalhe: 'memory.embedding.fallback_model vazio' };
  const dim = dimDoModeloLocal(config.fallback_model, env);
  if (dim === null) return { motivo: 'embeddings.local-ausente', detalhe: `${config.fallback_model} ausente do cache local do Hugging Face` };
  return { modelo: config.fallback_model, dim };
}

export interface OpcoesDoIndice {
  raiz: string;
  tenant: string;
  dsn: string;
  config: ConfigDeEmbedding;
  alvo: AlvoDeEmbedding;
  /** RM-038: o universo da busca de `universoDaBusca`, o mesmo da busca e do status. */
  universo: UniversoDaBusca;
  dryRun: boolean;
  chavePresente: boolean;
  /** A variavel existe, mas o valor foi recusado (URL, DSN ou texto com espaco). */
  chaveRecusada?: boolean;
  embeddar?: Embeddar;
  env?: NodeJS.ProcessEnv;
}

/**
 * `ork memory index`: idempotente, com o teto de tokens conferido ANTES da rede.
 *
 * Pendentes sao as entradas do universo sem vetor coerente; removidos, as do indice que sairam
 * do tenant; fora do limite e recusados nunca vao ao provider. Falha no meio preserva os lotes
 * que ja voltaram, porque cada vetor gravado e coerente por si.
 */
export function indexar(o: OpcoesDoIndice): ResultadoDoIndice {
  // RM-038 (D6): conferir de novo antes de qualquer coisa; nada de outro tenant vai ao embed, nem de
  // um chamador que montou o universo a mao. Violacao falha alto, nunca vira descarte silencioso.
  if (o.universo.tenant !== o.tenant) throw new Error('memory.query.scope-violation');
  conferirUniverso(o.universo.entradas, o.tenant);
  const espaco = espacoDoAlvo(o.config, o.alvo, o.env);
  const universo = o.universo.entradas;
  const foraDoLimite = universo.filter(e => e.content.length > EMBED_MAX_CARACTERES);
  const recusados = universo.filter(e => e.content.length <= EMBED_MAX_CARACTERES && conteudoRecusado(e.content));
  const indexaveis = universo.filter(e => e.content.length <= EMBED_MAX_CARACTERES && !conteudoRecusado(e.content) && e.content.trim());
  const base: ResultadoDoIndice = { alvo: o.alvo, modelo: null, dim: null, arquivo: null, dryRun: o.dryRun,
    universo: universo.length, porColecao: { ...o.universo.porColecao }, foraDaBusca: o.universo.foraDaBusca,
    coerentes: 0, embedados: 0, reescritos: 0, removidos: 0, recusados: recusados.length,
    foraDoLimite: foraDoLimite.length, truncados: 0, tokensEstimados: 0, custoEstimadoUsd: 0, chamadasAoProvider: 0, motivo: null, detalhe: '' };
  if ('motivo' in espaco) {
    const tokens = indexaveis.reduce((t, e) => t + tokensEstimados(e.content), 0);
    return { ...base, tokensEstimados: tokens, motivo: espaco.motivo, detalhe: espaco.detalhe };
  }
  const arquivo = arquivoDoIndice(o.raiz, o.tenant, espaco.modelo, espaco.dim);
  const { indice } = lerIndice(arquivo, { tenant: o.tenant, base: impressaoDaBase(o.dsn), modelo: espaco.modelo, dim: espaco.dim });
  const ids = new Set(indexaveis.map(e => e.id));
  const coerente = (e: EntradaDeMemoria) => indice.entradas[e.id]?.sha256 === sha256DoConteudo(e.content);
  const pendentes = indexaveis.filter(e => !coerente(e));
  const removidos = Object.keys(indice.entradas).filter(id => !ids.has(id));
  const tokens = pendentes.reduce((t, e) => t + tokensEstimados(e.content), 0);
  const preco = o.alvo === 'fallback' ? 0 : PRECO_USD_POR_TOKEN[espaco.modelo];
  const r: ResultadoDoIndice = { ...base, modelo: espaco.modelo, dim: espaco.dim,
    arquivo: path.relative(raizDoEstado(o.raiz), arquivo).split(path.sep).join('/'),
    coerentes: indexaveis.length - pendentes.length, removidos: removidos.length, tokensEstimados: tokens,
    custoEstimadoUsd: preco === undefined ? null : tokens * preco,
    detalhe: preco === undefined ? `preco de ${espaco.modelo} fora da tabela datada: custo nao estimado` : '' };
  if (o.dryRun) return r;
  if (o.alvo === 'primario' && !o.chavePresente) {
    return { ...r, motivo: 'embeddings.chave-ausente', detalhe: o.chaveRecusada
      ? 'a variavel declarada em memory.embedding.api_key_env tem valor recusado (parece URL, DSN ou texto com espaco; nunca impresso)'
      : 'a variavel declarada em memory.embedding.api_key_env nao esta no ambiente' };
  }
  // D11: o teto de dinheiro vale antes de qualquer chamada; o fallback local nao cobra.
  if (o.alvo === 'primario' && tokens > o.config.max_tokens_por_execucao) {
    return { ...r, motivo: 'embeddings.orcamento-excedido',
      detalhe: `${tokens} tokens estimados acima do teto de ${o.config.max_tokens_por_execucao} por execucao` };
  }
  if (!o.embeddar) return { ...r, motivo: 'embeddings.provider-indisponivel', detalhe: 'transporte de embedding ausente' };
  for (const id of removidos) delete indice.entradas[id];
  let motivo: MotivoDeEmbeddings | null = null;
  for (let i = 0; i < pendentes.length && !motivo; i += TAMANHO_DO_LOTE) {
    const lote = pendentes.slice(i, i + TAMANHO_DO_LOTE);
    r.chamadasAoProvider += 1;
    try {
      const resposta = o.embeddar({ papel: 'documento', alvo: o.alvo, modelo: espaco.modelo, dim: espaco.dim,
        textos: lote.map(e => e.content) }, { timeoutMs: TIMEOUT_DO_LOTE_MS });
      lote.forEach((e, j) => {
        if (indice.entradas[e.id]) r.reescritos += 1;
        indice.entradas[e.id] = { colecao: e.collection, sha256: sha256DoConteudo(e.content), vetor: codificarVetor(resposta.vetores[j]) };
        r.embedados += 1;
      });
      r.truncados += resposta.truncados?.length ?? 0;
    } catch (erro) {
      motivo = codigoDeEmbedding(erro);
    }
  }
  gravarIndice(arquivo, indice);
  r.coerentes = indexaveis.filter(coerente).length;
  if (motivo) return { ...r, motivo, detalhe: `indexacao interrompida depois de ${r.embedados} vetor(es); os lotes concluidos ficaram gravados` };
  return r;
}

/** RM-038: a linha do que fica fora da busca, a mesma no `ork memory index` e no `ork memory status`. */
export function textoForaDaBusca(f: ForaDaBusca | null): string {
  return f ? `${f.injecao} com injection_risk, ${f.expiradas} expirada(s), ${f.outrasColecoes} em colecoes fora do ork ` +
    '(governanca da biblioteca; nunca vao ao embed)' : 'nao medido nesta base';
}

/** Texto de `ork memory index`: de que universo, o que foi (ou seria) embedado e quanto custa estimado. */
export function textoDoIndice(r: ResultadoDoIndice): string {
  const custo = r.custoEstimadoUsd === null ? 'nao estimado' : `US$ ${r.custoEstimadoUsd.toFixed(8)}`;
  const colecoes = Object.entries(r.porColecao).map(([c, n]) => `${c} ${n}`).join(', ');
  return [
    `Indice vetorial (${r.alvo}${r.dryRun ? ', --dry-run' : ''}): ${r.modelo ?? '(sem modelo)'}${r.dim ? ` / ${r.dim} dim` : ''}`,
    `  universo da busca    ${r.universo} entrada(s): ${colecoes}; coerentes ${r.coerentes}`,
    `  fora da busca        ${textoForaDaBusca(r.foraDaBusca)}`,
    `  embedados            ${r.embedados} (reescritos ${r.reescritos}); removidos ${r.removidos}`,
    `  fora do indice       ${r.recusados} recusada(s) por padrao de segredo, ${r.foraDoLimite} acima do limite`,
    ...(r.truncados ? [`  truncados            ${r.truncados} acima do contexto do modelo local, embedados pelo comeco`] : []),
    `  estimativa           ${r.tokensEstimados} token(s), ${custo}; chamadas ao provider ${r.chamadasAoProvider}`,
    ...(r.arquivo ? [`  arquivo              ${r.arquivo}`] : []),
    ...(r.motivo ? [`  motivo               ${r.motivo}: ${r.detalhe}`] : r.detalhe ? [`  ${r.detalhe}`] : []),
  ].join('\n');
}

/** Vetores coerentes de um indice para o universo informado: a base da busca e da cobertura. */
export function vetoresCoerentes(indice: IndiceVetorial, universo: EntradaDeMemoria[]): Map<string, number[]> {
  const saida = new Map<string, number[]>();
  for (const e of universo) {
    const item = indice.entradas[e.id];
    if (!item || item.sha256 !== sha256DoConteudo(e.content)) continue;
    const v = decodificarVetor(item.vetor, indice.dim);
    if (v) saida.set(e.id, v);
  }
  return saida;
}

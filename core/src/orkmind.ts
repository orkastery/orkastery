/**
 * Cliente do OrkMind (bloco B6): a camada semantica como ADAPTADOR, nunca como dependencia.
 *
 * O `ork` continua sendo TypeScript deterministico e sem LLM. O OrkMind e Python, com
 * Postgres + pgvector, e mora fora deste repositorio. A integracao aqui e de cliente:
 * subprocess no CLI do OrkMind, entrada e saida em JSON, tolerancia a falha em todas as
 * chamadas. Nada de embutir o Python, nada de reimplementar a ontologia.
 *
 * Tres regras que este arquivo existe para garantir:
 *
 *  1. DEGRADACAO HONESTA. Se o OrkMind nao responde, o regime efetivo vira `files` com
 *     motivo TIPADO, e o ciclo segue. Memoria semantica melhora o produto; ela nao e
 *     requisito dele.
 *  2. ISOLAMENTO POR TENANT, SEM FALLBACK. A DSN vem do NOME de uma variavel de ambiente
 *     declarada no manifesto (`memory.database_url_env`). Variavel nao declarada ou vazia
 *     nao vira "usa a base padrao": vira degradacao. E o precedente do incidente
 *     memory-orkmind, em que a memoria de um produto foi parar na base de outro.
 *  3. GOVERNANCA. `human` exige decision com proveniencia confirmada de human_gate; nunca `mandatory` nem
 *     `rule`/`instruction` com prioridade `critical`. Regra critica so nasce de humano
 *     autenticado. Aqui isso e checado antes de qualquer chamada, nao depois.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Manifesto } from './types';
import {
  ColecaoDoOrk,
  ConsultaPorTag,
  ConsultaDelimitada,
  EscopoDeLeitura,
  EntradaDeMemoria,
  EntradaNova,
  EstadoDaMemoria,
  MotivoDeDegradacao,
  PrioridadeDeMemoria,
  RegimeDeMemoria,
  ResultadoDeGravacao,
  PedidoDeHandoff,
  ResultadoDeHandoff,
} from './types';

/** As colecoes do OrkMind que o `ork` grava (guia: docs/guias/memoria-e-handoff.md). */
export const COLECOES_DO_ORK: readonly ColecaoDoOrk[] = [
  'decision',
  'handoff',
  'rule',
  'learning',
  'roadmap',
] as const;

/**
 * Colecoes de governanca dura do OrkMind: entrada aqui vira REGRA do ecossistema.
 * O agente pode gravar (o B6 grava as policies do manifesto), mas nunca como `mandatory`
 * nem com prioridade `critical`: isso e privilegio de humano autenticado.
 */
export const COLECOES_DE_GOVERNANCA: readonly string[] = ['rule', 'instruction'] as const;

/** As 5 dimensoes semanticas usadas pelo `ork`. Busca por tag e EXATA nelas. */
export const DIMENSOES: readonly string[] = [
  'skill',
  'agent',
  'domain',
  'project',
  'situation',
] as const;

/** Prefixo dos enderecos semanticos gravados nos ponteiros do handoff. */
export const ESQUEMA_ORKMIND = 'orkmind://';

/** Monta o endereco semantico de uma entrada (`orkmind://<colecao>/<id>`). */
export function enderecoDeMemoria(colecao: string, id: string): string {
  return `${ESQUEMA_ORKMIND}${colecao}/${id}`;
}

/** Le um endereco semantico de volta. Devolve null quando nao e um endereco do OrkMind. */
export function lerEndereco(endereco: string): { colecao: string; id: string } | null {
  if (!endereco.startsWith(ESQUEMA_ORKMIND)) return null;
  const resto = endereco.slice(ESQUEMA_ORKMIND.length);
  const corte = resto.indexOf('/');
  if (corte <= 0 || corte === resto.length - 1) return null;
  return { colecao: resto.slice(0, corte), id: resto.slice(corte + 1) };
}

/**
 * O que o `ork` recusa gravar, ANTES de chamar o OrkMind.
 *
 * Devolve a lista de violacoes; lista vazia quer dizer "pode gravar". Nao e defesa contra
 * o OrkMind (ele tem a dele): e o `ork` recusando pedir o que ele nao tem direito de pedir.
 */
export function violacoesDeGovernanca(entrada: EntradaNova): string[] {
  const problemas: string[] = [];
  if ('scope' in entrada && entrada.scope !== 'project') problemas.push('scope fora do contrato project');
  if (['orkastery_identity', 'orkastery_identity_version', 'orkastery_prospective'].some(k => k in entrada.metadata)) problemas.push('metadata de identidade reservada');
  if ((entrada as EntradaNova & { mandatory?: boolean }).mandatory) problemas.push('mandatory proibido');
  if (entrada.source && !['agent', 'human'].includes(entrada.source)) problemas.push('source proibido');
  if (entrada.source === 'human') {
    const p = entrada.metadata.proveniencia as Record<string, unknown> | undefined;
    if (entrada.collection !== 'decision' || entrada.priority === 'critical' ||
        !p || p.tipo !== 'human_gate' || p.source !== 'human' || p.confirmado !== true ||
        !['autor', 'evento', 'evidencia', 'sha256'].every(k => typeof p[k] === 'string' && p[k])) {
      problemas.push('source human exige decision nao critica e proveniencia de human_gate confirmado');
    }
  }
  if (!COLECOES_DO_ORK.includes(entrada.collection)) {
    problemas.push(
      `colecao "${entrada.collection}" fora do escopo do ork (${COLECOES_DO_ORK.join(', ')})`
    );
  }
  if (COLECOES_DE_GOVERNANCA.includes(entrada.collection) && entrada.priority === 'critical') {
    problemas.push(
      `prioridade critical em "${entrada.collection}": regra critica so nasce de humano autenticado`
    );
  }
  if (entrada.content.trim() === '') {
    problemas.push('conteudo vazio: entrada sem conteudo nao e memoria, e ruido');
  }
  for (const dimensao of Object.keys(entrada.tags)) {
    if (!DIMENSOES.includes(dimensao)) {
      problemas.push(`dimensao de tag desconhecida: "${dimensao}" (validas: ${DIMENSOES.join(', ')})`);
    }
  }
  return problemas;
}

/**
 * Casamento de tags DETERMINISTICO, o mesmo contrato do OrkMind:
 *
 *  - casa quando ha intersecao em TODA dimensao pedida (AND entre dimensoes, OR dentro);
 *  - entrada `mandatory` casa com qualquer intersecao em UMA dimensao: ela sempre volta
 *    quando o contexto toca o assunto dela.
 *
 * Nao ha similaridade nem ranking aqui: dois contextos iguais devolvem o mesmo conjunto.
 */
export function casaTags(entrada: EntradaDeMemoria, consulta: Record<string, string[]>): boolean {
  const dimensoes = Object.entries(consulta).filter(([, v]) => v.length > 0);
  if (dimensoes.length === 0) return true;
  let algumaCasou = false;
  let todasCasaram = true;
  for (const [dimensao, valores] of dimensoes) {
    const daEntrada = entrada.tags[dimensao] ?? [];
    const casou = valores.some((v) => daEntrada.includes(v));
    if (casou) algumaCasou = true;
    else todasCasaram = false;
  }
  return todasCasaram || (entrada.mandatory && algumaCasou);
}

/** I-38 (T4): o que a operacao `health` da ponte observou. */
export interface SaudeDaPonte {
  contagens: Record<string, number>;
  /** Versao instalada da biblioteca OrkMind, quando o pacote a declara. */
  orkmind: string | null;
  /** O fallback local tem torch, transformers e huggingface_hub no interpretador da ponte? */
  fallback: { dependencias: boolean };
}

/**
 * O transporte ate o OrkMind.
 *
 * A interface existe para que o nucleo nao saiba se a memoria e um subprocess Python, uma
 * API HTTP ou um dublê de teste. Ela e o unico ponto que conhece o OrkMind de verdade.
 */
export interface DriverDeMemoria {
  nome: string;
  /** Health check barato. `ok: false` degrada o regime para `files`, com detalhe. */
  disponivel(): { ok: boolean; detalhe: string; saude?: SaudeDaPonte };
  adicionar(entrada: EntradaNova): ResultadoDeGravacao;
  /** Todas as entradas de uma colecao. O filtro por tag e feito pelo `ork`, exato. */
  exportar(colecao: string): EntradaDeMemoria[];
  /** Consulta restrita. Ausencia exige recusa; nunca fallback para exportar. */
  consultar?(consulta: ConsultaDelimitada): EntradaDeMemoria[];
  submeterHandoff?(pedido: PedidoDeHandoff): ResultadoDeHandoff;
  recuperar?(colecao: string, id: string): EntradaDeMemoria | null;
  contagens?(): Record<string, number>;
  /** I-38 (T2): vetores pela operacao `embed` da ponte. Unico caminho que leva a chave. */
  embeddar?(pedido: PedidoDeEmbedding, opcoes?: { timeoutMs?: number }): RespostaDeEmbedding;
  /** I-38 (T5): FTS da biblioteca com tenant obrigatorio; so ids, na ordem do ranking. */
  buscarTexto?(tenant: string, texto: string): string[];
}

/** Texto de busca: nao vazio, sem caractere de controle, ate 2.000 caracteres. */
export function textoDeBuscaValido(texto: unknown): texto is string {
  return typeof texto === 'string' && texto.trim() !== '' && texto.length <= 2000 && !/[\x00-\x1f\x7f]/.test(texto);
}

/** I-38 (D1, D4): pedido de embedding. `documento` indexa; `consulta` busca. */
export interface PedidoDeEmbedding {
  papel: 'consulta' | 'documento';
  alvo: 'primario' | 'fallback';
  modelo: string;
  dim: number;
  textos: string[];
}

export interface RespostaDeEmbedding {
  alvo: 'primario' | 'fallback';
  modelo: string;
  dim: number;
  vetores: number[][];
  /** Indices dos textos acima do contexto do modelo local, embedados pelo comeco (declarado). */
  truncados?: number[];
}

/** Limites da operacao `embed` (D10): lote e tamanho de texto, sem truncar em silencio. */
export const EMBED_MAX_TEXTOS = 32;
export const EMBED_MAX_CARACTERES = 24_000;
/** Domicilio unico do formato `org/nome` de modelo de embedding (primario e fallback). */
export const MODELO_DE_EMBEDDING = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * O valor lido da variavel declarada so vale como chave se nao parecer outra coisa: URL, DSN,
 * texto com espaco ou a propria DSN da memoria nunca vao ao provider (nome trocado por engano).
 */
export function chaveDeEmbeddingAceita(valor: string, dsn: string): boolean {
  return valor !== '' && !/\s/.test(valor) && !valor.includes('://') && valor !== dsn.trim();
}

/** Codigos tipados que a ponte pode devolver na operacao `embed`. */
export const CODIGOS_DE_EMBEDDING: readonly string[] = [
  'memory.embed.invalid', 'embeddings.chave-ausente', 'embeddings.provider-indisponivel', 'embeddings.timeout',
  'embeddings.local-ausente', 'embeddings.dependencia-ausente', 'embeddings.dimensao-divergente',
  'embeddings.conteudo-recusado',
];

/** Copia validada: o que vai a ponte e exatamente o que foi conferido aqui. */
export function validarPedidoDeEmbedding(bruto: PedidoDeEmbedding): PedidoDeEmbedding {
  const p = bruto as unknown as Record<string, unknown>;
  if (!objetoDeConsulta(p) || Object.keys(p).some(k => !['papel', 'alvo', 'modelo', 'dim', 'textos'].includes(k)) ||
      !['consulta', 'documento'].includes(p.papel as string) || !['primario', 'fallback'].includes(p.alvo as string) ||
      typeof p.modelo !== 'string' || !MODELO_DE_EMBEDDING.test(p.modelo) ||
      !Number.isInteger(p.dim) || Number(p.dim) < 32 || Number(p.dim) > 4096 ||
      !Array.isArray(p.textos) || p.textos.length < 1 || p.textos.length > EMBED_MAX_TEXTOS ||
      !p.textos.every(t => typeof t === 'string' && t.trim() !== '' && t.length <= EMBED_MAX_CARACTERES)) {
    throw new Error('memory.embed.invalid');
  }
  return { papel: p.papel as PedidoDeEmbedding['papel'], alvo: p.alvo as PedidoDeEmbedding['alvo'],
    modelo: p.modelo, dim: Number(p.dim), textos: [...(p.textos as string[])] };
}

/** Resposta da ponte conferida: um vetor finito por texto, todos na dimensao pedida. */
export function conferirRespostaDeEmbedding(r: unknown, pedido: PedidoDeEmbedding): RespostaDeEmbedding {
  const o = r as Record<string, unknown>;
  if (!objetoDeConsulta(o) || o.alvo !== pedido.alvo || o.modelo !== pedido.modelo || o.dim !== pedido.dim ||
      !Array.isArray(o.vetores)) throw new Error('memory.transport.embed');
  if (o.vetores.length !== pedido.textos.length || !o.vetores.every(v => Array.isArray(v) && v.length === pedido.dim &&
      v.every(x => typeof x === 'number' && Number.isFinite(x)))) throw new Error('embeddings.dimensao-divergente');
  const truncados = o.truncados === undefined ? [] : o.truncados;
  if (!Array.isArray(truncados) || !truncados.every(i => Number.isInteger(i) && i >= 0 && i < pedido.textos.length)) {
    throw new Error('memory.transport.embed');
  }
  return { alvo: pedido.alvo, modelo: pedido.modelo, dim: pedido.dim, vetores: o.vetores as number[][], truncados: truncados as number[] };
}

export const LIMITE_CONSULTA_PADRAO = 100;
export const LIMITE_CONSULTA_MAXIMO = 1000;

function objetoDeConsulta(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
function textoDeConsulta(x: unknown, max: number): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= max && !/[\x00-\x1f\x7f]/.test(x);
}

/** Delimitacao de leitura, nao credencial. O chamador operacional deriva tenant do manifesto. */
export function criarEscopoDeLeitura(manifesto: Manifesto, thread: string): EscopoDeLeitura {
  const tenant = manifesto.memory.tenant || manifesto.project.name;
  return validarConsultaDelimitada({ collection: 'handoff', escopo: { tenant, thread },
    tags: {}, limite: LIMITE_CONSULTA_PADRAO }).escopo;
}

/** Copia validada impede mutacao do escopo/tags entre validar e transportar. */
export function validarConsultaDelimitada(bruto: unknown): ConsultaDelimitada {
  const falhar = (): never => { throw Error('memory.query.invalid'); };
  if (!objetoDeConsulta(bruto) || Object.keys(bruto).some(k => !['collection','escopo','tags','limite'].includes(k))) return falhar();
  const { collection, escopo, tags, limite } = bruto;
  if (!COLECOES_DO_ORK.includes(collection as ColecaoDoOrk) || !objetoDeConsulta(escopo) ||
      Object.keys(escopo).some(k => !['tenant','thread'].includes(k)) ||
      !textoDeConsulta(escopo.tenant, 128) || !textoDeConsulta(escopo.thread, 128) ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(escopo.thread) || !Number.isInteger(limite) ||
      Number(limite) < 1 || Number(limite) > LIMITE_CONSULTA_MAXIMO || !objetoDeConsulta(tags)) return falhar();
  const copia: Record<string, string[]> = {};
  for (const [k, values] of Object.entries(tags)) {
    if (!DIMENSOES.includes(k) || !Array.isArray(values) || values.length > 32 ||
        !values.every(v => textoDeConsulta(v, 256))) return falhar();
    if ((k === 'project' && values.some(v => v !== escopo.tenant)) ||
        (k === 'situation' && values.some(v => v.startsWith('thread:') && v !== 'thread:' + escopo.thread))) {
      throw Error('memory.query.scope-conflict');
    }
    copia[k] = [...values];
    Object.freeze(copia[k]);
  }
  return Object.freeze({ collection: collection as ColecaoDoOrk,
    escopo: Object.freeze({ tenant: escopo.tenant, thread: escopo.thread }),
    tags: Object.freeze(copia), limite: Number(limite) });
}

/** Apenas as duas fronteiras obrigatorias: filtros extras perderiam mandatory valida. */
export function tagsDoEscopo(escopo: EscopoDeLeitura): Record<string, string[]> {
  return { project: [escopo.tenant], situation: ['thread:' + escopo.thread] };
}

export function pertenceAoEscopo(e: EntradaDeMemoria, q: ConsultaDelimitada): boolean {
  return e.collection === q.collection && Object.entries(tagsDoEscopo(q.escopo))
    .every(([k, values]) => values.every(v => e.tags[k]?.includes(v)));
}

/** Saturacao antes de filtros locais, inclusive procura por id: ausencia precisa ser provada. */
export function concluirConsultaDelimitada(dados: EntradaDeMemoria[], q: ConsultaDelimitada): EntradaDeMemoria[] {
  if (!Array.isArray(dados)) throw Error('memory.query.response-invalid');
  if (dados.length >= q.limite) throw Error('memory.query.window-saturated');
  if (dados.some(e => !pertenceAoEscopo(e, q))) throw Error('memory.query.scope-violation');
  return filtrarPorTags(dados, { collection: q.collection, tags: { ...q.tags,
    project: [q.escopo.tenant] } });
}

/** Normaliza uma entrada como o OrkMind a devolve (`orkmind export`). */
export function entradaDoJson(bruto: unknown): EntradaDeMemoria | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const o = bruto as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.content !== 'string') return null;
  const tags: Record<string, string[]> = {};
  if (o.tags && typeof o.tags === 'object' && !Array.isArray(o.tags)) {
    for (const [k, v] of Object.entries(o.tags as Record<string, unknown>)) {
      if (Array.isArray(v)) tags[k] = v.filter((x): x is string => typeof x === 'string');
    }
  }
  const prioridades: readonly string[] = ['critical', 'high', 'medium', 'low'];
  const prioridade = typeof o.priority === 'string' && prioridades.includes(o.priority)
    ? (o.priority as PrioridadeDeMemoria)
    : 'medium';
  return {
    id: o.id,
    collection: typeof o.collection === 'string' ? o.collection : '',
    content: o.content,
    tags,
    priority: prioridade,
    mandatory: o.mandatory === true,
    scope: typeof o.scope === 'string' ? o.scope : 'project',
    source: typeof o.source === 'string' ? o.source : 'agent',
    metadata:
      o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata)
        ? (o.metadata as Record<string, unknown>)
        : {},
    parent_id: typeof o.parent_id === 'string' ? o.parent_id : null,
    author_id: typeof o.author_id === 'string' ? o.author_id : null,
    visibility: typeof o.visibility === 'string' ? o.visibility : undefined,
    protected: typeof o.protected === 'boolean' ? o.protected : undefined,
    criadaEm: typeof o.created_at === 'string' ? o.created_at : '',
  };
}

/** Configuracao resolvida do driver de CLI. */
export interface ConfigDoDriver {
  cli: string;
  /** Nome literal da variavel de ambiente do manifesto. */
  variavel: string;
  /** Valor da DSN lido do ambiente. Vazio quer dizer "nao ligue". */
  dsn: string;
  timeoutMs: number;
  /** I-38 (D5): NOME da variavel com a chave de embedding; o valor e lido so na operacao `embed`. */
  variavelDaChaveDeEmbedding?: string;
}

/**
 * Driver real: subprocess no CLI do OrkMind.
 *
 * A DSN entra pelo ambiente do processo filho (`ORKMIND_DATABASE_URL`), nunca por
 * argumento de linha de comando: argumento aparece em `ps` e no ledger de quem loga
 * comando. E ela sai da variavel declarada no manifesto, sem nenhum outro candidato.
 */
export class DriverCliOrkMind implements DriverDeMemoria {
  readonly nome: string;
  private readonly config: ConfigDoDriver;
  private saude: { ok: boolean; detalhe: string; saude?: SaudeDaPonte } | null = null;

  constructor(config: ConfigDoDriver) {
    this.config = config;
    this.nome = `cli:${config.cli}`;
  }

  private python(): string[] {
    const cli = this.config.cli;
    const candidatos = cli.includes(path.sep) ? [path.resolve(cli)] :
      (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, cli));
    const executavel = candidatos.find(p => {
      try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
    });
    if (!executavel) throw new Error('cli.ausente: executavel OrkMind nao encontrado');
    const linha = fs.readFileSync(executavel, 'utf8').split('\n')[0];
    const match = /^#!(\S+)(?:\s+(\S+))?\s*$/.exec(linha);
    if (!match) throw new Error('memory.transport.interpreter: shebang nao suportado');
    return match[2] ? [match[1], match[2]] : [match[1]];
  }

  /** Valor da chave de embedding no ambiente do `ork`; nunca guardado no driver. */
  private chaveDeEmbedding(): string {
    const nome = this.config.variavelDaChaveDeEmbedding ?? '';
    const valor = nome ? (process.env[nome] ?? '').trim() : '';
    return chaveDeEmbeddingAceita(valor, this.config.dsn) ? valor : '';
  }

  private contemSegredo(valor: unknown): boolean {
    const segredo = this.config.dsn;
    const proibidos = [segredo];
    const nome = this.config.variavelDaChaveDeEmbedding ?? '';
    const chave = nome ? (process.env[nome] ?? '').trim() : '';
    if (chave.length >= 12) proibidos.push(chave);
    try { const senha = new URL(segredo).password; if (senha.length >= 12) proibidos.push(senha, decodeURIComponent(senha)); } catch { /* DSN opaca */ }
    const examinar = (x: unknown): boolean => typeof x === 'string'
      ? proibidos.some(p => p && x.includes(p))
      : !!x && typeof x === 'object' && Object.entries(x).some(([k, v]) => examinar(k) || examinar(v));
    return examinar(valor);
  }

  private rodar(pedido: Record<string, unknown>, timeoutMs: number = this.config.timeoutMs): unknown {
    if (!this.config.dsn.trim()) throw new Error('dsn.env-ausente');
    if (this.contemSegredo(pedido)) throw new Error('memory.transport.secret: conteudo recusado');
    const [python, ...prefixo] = this.python();
    const ponte = [path.join(__dirname, '../assets/orkmind_bridge.py'),
      path.join(__dirname, '../../assets/orkmind_bridge.py')].find(p => fs.existsSync(p));
    if (!ponte) throw new Error('memory.transport.bridge: ponte ausente no pacote');
    // I-38 (D1): `embed` nao toca a base, entao nao recebe a DSN; a chave vai SO ao `embed` primario.
    const embed = pedido.op === 'embed';
    const env: NodeJS.ProcessEnv = embed ? { PYTHONDONTWRITEBYTECODE: '1' }
      : { ORKMIND_DATABASE_URL: this.config.dsn, PYTHONDONTWRITEBYTECODE: '1' };
    for (const nome of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'HF_HOME', 'HF_HUB_CACHE']) {
      if (process.env[nome]) env[nome] = process.env[nome];
    }
    const chave = embed && pedido.alvo === 'primario' ? this.chaveDeEmbedding() : '';
    if (chave) env.ORKMIND_EMBEDDING_API_KEY = chave;
    const r = spawnSync(python, [...prefixo, ponte], {
      encoding: 'utf8', input: JSON.stringify(pedido), timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024, env,
    });
    // Nunca reutilizar stdout, stderr, error.message ou causa de uma falha do filho.
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code;
      throw new Error(code === 'ETIMEDOUT' ? 'memory.transport.timeout' :
        code === 'ENOENT' ? 'cli.ausente: interpretador nao encontrado' : 'memory.transport.spawn');
    }
    if (r.status !== 0) {
      let code = '';
      try { code = JSON.parse(r.stdout)?.error; } catch { /* nenhum detalhe do filho */ }
      throw new Error(['memory.schema.absent', 'memory.legacy.provenance-collision', 'memory.prospective.marker-invalid', 'memory.native.schema-mismatch', 'memory.query.invalid', 'memory.query.window-saturated', 'memory.query.scope-violation', 'memory.health.invalid', 'memory.fts.invalid', ...CODIGOS_DE_EMBEDDING].includes(code) ? code : 'memory.transport.failed');
    }
    let json: unknown;
    try { json = JSON.parse(r.stdout); } catch { throw new Error('memory.transport.json'); }
    if (this.contemSegredo(json)) throw new Error('memory.transport.secret: resposta recusada');
    return json;
  }

  /** O detalhe sai do que a operacao `health` observou, nunca de frase fixa (I-38 T4). */
  disponivel(): { ok: boolean; detalhe: string; saude?: SaudeDaPonte } {
    if (this.saude) return this.saude;
    try {
      const saude = this.sondarSaude();
      const total = Object.values(saude.contagens).reduce((a, b) => a + b, 0);
      this.saude = { ok: true, saude, detalhe: `ponte OrkMind respondeu a sonda health (orkmind ${saude.orkmind ?? 'sem versao declarada'}, ` +
        `${total} entrada(s) em ${Object.keys(saude.contagens).length} colecao(oes))` };
    } catch (e) { this.saude = { ok: false, detalhe: (e as Error).message }; }
    return this.saude;
  }

  sondarSaude(): SaudeDaPonte {
    const r = this.rodar({ op: 'health' }) as Record<string, unknown>;
    const contagens = r?.contagens as Record<string, unknown>;
    const fallback = r?.fallback as Record<string, unknown>;
    if (!objetoDeConsulta(r) || !objetoDeConsulta(contagens) || !objetoDeConsulta(fallback) ||
        !Object.values(contagens).every(v => Number.isInteger(v) && Number(v) >= 0) ||
        typeof fallback.dependencias !== 'boolean' || !(r.orkmind === null || typeof r.orkmind === 'string')) {
      throw new Error('memory.transport.health');
    }
    return { contagens: contagens as Record<string, number>, orkmind: r.orkmind as string | null,
      fallback: { dependencias: fallback.dependencias } };
  }

  contagens(): Record<string, number> {
    const r = this.rodar({ op: 'stats' }) as Record<string, unknown>;
    if (!r || Array.isArray(r) || typeof r !== 'object' ||
        !Object.values(r).every(v => Number.isInteger(v) && Number(v) >= 0)) {
      throw new Error('memory.transport.stats');
    }
    return r as Record<string, number>;
  }

  adicionar(entrada: EntradaNova): ResultadoDeGravacao {
    try {
      if (violacoesDeGovernanca(entrada).length) throw new Error('memory.governance');
      const r = this.rodar({ op: 'add', entrada }) as ResultadoDeGravacao;
      if (!r || r.ok !== true || typeof r.id !== 'string' || !r.id || r.collection !== entrada.collection) {
        throw new Error('memory.transport.receipt');
      }
      return r;
    } catch (e) {
      return { ok: false, id: null, duplicada: false, collection: entrada.collection, detalhe: (e as Error).message };
    }
  }

  exportar(colecao: string): EntradaDeMemoria[] {
    const dados = this.rodar({ op: 'export', collection: colecao });
    if (!Array.isArray(dados)) throw new Error('memory.transport.export');
    return dados.map(d => {
      const e = entradaDoJson(d);
      if (!e || e.collection !== colecao) throw new Error('memory.transport.entry');
      return e;
    });
  }

  consultar(consulta: ConsultaDelimitada): EntradaDeMemoria[] {
    const q = validarConsultaDelimitada(consulta);
    const dados = this.rodar({ op: 'query', collection: q.collection,
      tags: tagsDoEscopo(q.escopo), limit: q.limite });
    if (!Array.isArray(dados)) throw Error('memory.query.response-invalid');
    // A janela inteira precede normalizacao e filtros; nao provar ausencia numa pagina cheia.
    if (dados.length >= q.limite) throw Error('memory.query.window-saturated');
    const entradas = dados.map(d => {
      const e = entradaDoJson(d);
      if (!e) throw Error('memory.query.response-invalid');
      return e;
    });
    return concluirConsultaDelimitada(entradas, q);
  }

  /** Readback de manutencao. O recall continua usando export governado. */
  recuperar(colecao: string, id: string): EntradaDeMemoria | null {
    const dado = this.rodar({ op: 'get', collection: colecao, id });
    if (dado === null) return null;
    const e = entradaDoJson(dado);
    if (!e || e.id !== id || e.collection !== colecao) throw new Error('memory.transport.readback');
    return e;
  }

  embeddar(pedido: PedidoDeEmbedding, opcoes: { timeoutMs?: number } = {}): RespostaDeEmbedding {
    const p = validarPedidoDeEmbedding(pedido);
    if (p.alvo === 'primario' && !this.chaveDeEmbedding()) throw new Error('embeddings.chave-ausente');
    return conferirRespostaDeEmbedding(this.rodar({ op: 'embed', ...p }, opcoes.timeoutMs), p);
  }

  buscarTexto(tenant: string, texto: string): string[] {
    if (!textoDeConsulta(tenant, 128) || !textoDeBuscaValido(texto)) throw new Error('memory.fts.invalid');
    const r = this.rodar({ op: 'fts', tenant, texto }) as Record<string, unknown>;
    if (!objetoDeConsulta(r) || !Array.isArray(r.ids) || !r.ids.every(id => typeof id === 'string' && id)) {
      throw new Error('memory.transport.fts');
    }
    return r.ids as string[];
  }

  submeterHandoff(pedido: PedidoDeHandoff): ResultadoDeHandoff {
    try {
      const r = this.rodar({ op: 'handoff', pedido }) as ResultadoDeHandoff;
      if (!r || r.ok !== true || !r.id || !r.package_id || !r.package_entry_id ||
          !r.session_entry_id || r.readback !== true) throw new Error('memory.g3.rejected');
      return r;
    } catch (e) {
      return { ok: false, id: null, duplicada: false, collection: 'handoff', detalhe: (e as Error).message };
    }
  }

}

/** Vetor do dublê: cada palavra soma 1 numa posicao por hash; normalizado. Deterministico. */
export function vetorDeDuble(texto: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  const palavras = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const palavra of palavras) v[createHash('sha256').update(palavra).digest().readUInt32BE(0) % dim] += 1;
  const norma = Math.hypot(...v);
  return norma === 0 ? v.map((_, i) => (i === 0 ? 1 : 0)) : v.map(x => x / norma);
}

function tagsFixasDaDecisao(tags: Record<string, string[]>): Record<string, string[]> {
  const fases = new Set(['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER']);
  return Object.fromEntries(Object.entries(tags).filter(([k]) => k !== 'agent').map(([k, values]) =>
    [k, [...new Set(values.filter(v => !(k === 'skill' && fases.has(v)) &&
      !(k === 'situation' && v.startsWith('fase:') && fases.has(v.slice(5)))))].sort()] as const).filter(([, values]) => values.length));
}

/** Mesma serializacao JSON canonica e fingerprint da ponte Python. */
function jsonDeIdentidade(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(jsonDeIdentidade).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => {
      const aa = Array.from(a, c => c.codePointAt(0)!), bb = Array.from(b, c => c.codePointAt(0)!);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
      return aa.length - bb.length;
    })
    .map(([k, v]) => JSON.stringify(k) + ':' + jsonDeIdentidade(v)).join(',') + '}';
  return JSON.stringify(value);
}
const fingerprint = (value: unknown) => createHash('sha256').update(jsonDeIdentidade(value)).digest('hex');

/** Domicilio unico de campos; a ponte verifica o contrato contra a biblioteca instalada antes de usa-la. */
export function camposNativos(): readonly string[] {
  try {
    const arquivo = [path.join(__dirname, '../assets/orkmind-native-schema.json'),
      path.join(__dirname, '../../assets/orkmind-native-schema.json')].find(p => fs.existsSync(p));
    if (!arquivo) throw Error('missing native schema');
    const esquema = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (esquema.schema !== 'ork.native-entry-fields/v1' || !Array.isArray(esquema.fields) ||
        esquema.fields.some((k: unknown) => typeof k !== 'string') ||
        new Set(esquema.fields).size !== esquema.fields.length) throw Error('invalid native schema');
    return Object.freeze(esquema.fields);
  } catch { throw Error('memory.native.schema-mismatch'); }
}


export function agenteProspectivoValido(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9.-]+:[a-z0-9.-]+$/.test(value) && !/human/i.test(value);
}

/** Fingerprint de integridade do recibo, nunca autenticacao da autoria historica. */
export function prospectivaCompativel(old: EntradaDeMemoria, entrada: EntradaNova, metadata: Record<string, unknown>): boolean {
  const campos = camposNativos();
  try {
    const p = old.metadata.orkastery_prospective as Record<string, string>;
    if (!p || p.schema !== 'ork.prospective-origin/v1' || p.historicalOrigin !== 'unknown' || p.source !== 'agent' ||
        !/^[a-f0-9]{64}$/.test(p.receiptSha256) || !/^[a-f0-9]{40}$/.test(p.revision) ||
        !agenteProspectivoValido(p.agent) || p.entryId !== old.id ||
        createHash('sha256').update(p.originalJson).digest('hex') !== p.originalSha256) return false;
    const original = JSON.parse(p.originalJson);
    if (Object.keys(original).length !== campos.length || campos.some(k => !(k in original))) return false;
    const tags = Object.fromEntries([...new Set([...Object.keys(original.tags), ...Object.keys(entrada.tags)])].map(k =>
      [k, [...new Set([...(original.tags[k] ?? []), ...(entrada.tags[k] ?? [])])].sort()]));
    return old.collection === 'rule' && old.source === 'agent' && old.priority === 'high' && old.mandatory === false &&
      old.protected === false && old.visibility === 'private' && original.visibility === 'private' &&
      original.id === old.id && original.content === old.content && original.source === 'agent' &&
      original.priority === 'high' && original.mandatory === false && original.protected === false &&
      (old.author_id ?? null) === original.author_id && old.scope === original.scope && old.scope === ('scope' in entrada ? entrada.scope : 'project') &&
      isDeepStrictEqual(old.tags, tags) && isDeepStrictEqual(old.metadata, { ...metadata, orkastery_prospective: p });
  } catch { return false; }
}
const semIdentidade = (metadata: Record<string, unknown>) => Object.fromEntries(Object.entries(metadata)
  .filter(([k]) => !['orkastery_identity', 'orkastery_identity_version'].includes(k)));

function identidadeLegadaComprovada(entry: EntradaDeMemoria): boolean {
  if ('orkastery_identity_version' in entry.metadata) return false;
  const base = { collection: entry.collection, content: entry.content, tags: entry.tags,
    priority: entry.priority, metadata: semIdentidade(entry.metadata) };
  return [false, true].some(source => [false, true].some(mandatory =>
    fingerprint({ ...base, ...(source ? { source: entry.source } : {}), ...(mandatory ? { mandatory: false } : {}) }) === entry.metadata.orkastery_identity));
}

/**
 * Driver em memoria, usado pelos testes e por `--dry-run`.
 *
 * Ele implementa o MESMO contrato do driver real (governanca inclusa, ids estaveis), para
 * que os criterios do B6 sejam provados de forma deterministica mesmo sem OrkMind no CI.
 */
export class DriverEmMemoria implements DriverDeMemoria {
  readonly nome = 'memoria';
  private readonly entradas: EntradaDeMemoria[] = [];
  private contador = 0;
  /** Quando false, o driver se declara indisponivel: e o teste de degradacao. */
  ligado = true;
  /** I-38: quais alvos de embedding o dublê atende; o resto responde com o motivo tipado. */
  embedding: { primario: boolean; fallback: boolean } = { primario: true, fallback: true };
  /** Pedidos de embedding recebidos, para as assercoes de custo (chamadas ao provider). */
  readonly pedidosDeEmbedding: PedidoDeEmbedding[] = [];

  constructor(entradas: EntradaDeMemoria[] = []) {
    for (const e of entradas) this.entradas.push(e);
    this.contador = this.entradas.length;
  }

  disponivel(): { ok: boolean; detalhe: string; saude?: SaudeDaPonte } {
    return this.ligado
      ? { ok: true, detalhe: `driver em memoria com ${this.entradas.length} entrada(s)`,
        saude: { contagens: this.contagens(), orkmind: null, fallback: { dependencias: this.embedding.fallback } } }
      : { ok: false, detalhe: 'driver em memoria desligado' };
  }

  adicionar(entrada: EntradaNova): ResultadoDeGravacao {
    if (violacoesDeGovernanca(entrada).length) return { ok: false, id: null, duplicada: false, collection: entrada.collection, detalhe: 'memory.governance' };
    if (!this.ligado) {
      return {
        ok: false,
        id: null,
        duplicada: false,
        collection: entrada.collection,
        detalhe: 'driver em memoria desligado',
      };
    }
    const evolutiva = entrada.collection === 'decision' && (entrada.source ?? 'agent') === 'agent';
    const falha = { ok: false, id: null, duplicada: false, collection: entrada.collection, detalhe: 'memory.transport.failed' };
    if (evolutiva && (entrada.tags.project?.length !== 1 || !entrada.tags.project[0])) return falha;
    const identidade = fingerprint(evolutiva ? { collection: entrada.collection, content: entrada.content,
      priority: entrada.priority, metadata: entrada.metadata, source: 'agent', tags: tagsFixasDaDecisao(entrada.tags) } : entrada);
    const metadata = { ...entrada.metadata, orkastery_identity: identidade,
      ...(evolutiva ? { orkastery_identity_version: 2 } : {}) };
    const old = this.entradas.find(e => e.collection === entrada.collection && e.content === entrada.content);
    if (old) {
      if ('orkastery_prospective' in old.metadata) {
        if (!prospectivaCompativel(old, entrada, metadata)) return { ...falha, detalhe: 'memory.prospective.marker-invalid' };
        return { ok: true, id: old.id, duplicada: true, collection: old.collection, detalhe: 'duplicate; historical-origin-unknown' };
      }
      if (!old.metadata.orkastery_identity) return { ...falha, detalhe: 'memory.legacy.provenance-collision' };
      if (old.source !== (entrada.source ?? 'agent') || old.priority !== entrada.priority || old.mandatory || old.scope !== 'project') return falha;
      if (evolutiva) {
        const reconhecida = (old.metadata.orkastery_identity_version === 2 && old.metadata.orkastery_identity === identidade) || identidadeLegadaComprovada(old);
        if (!reconhecida || !isDeepStrictEqual(semIdentidade(old.metadata), entrada.metadata) ||
            !isDeepStrictEqual(tagsFixasDaDecisao(old.tags), tagsFixasDaDecisao(entrada.tags))) return falha;
        old.tags = Object.fromEntries([...new Set([...Object.keys(old.tags), ...Object.keys(entrada.tags)])].map(k =>
          [k, [...new Set([...(old.tags[k] ?? []), ...(entrada.tags[k] ?? [])])].sort()]));
        old.metadata = metadata;
      } else if (!isDeepStrictEqual(old.metadata, metadata) || !isDeepStrictEqual(old.tags, entrada.tags)) return falha;
      return { ok: true, id: old.id, duplicada: true, collection: entrada.collection, detalhe: 'duplicate' };
    }
    this.contador += 1;
    const nova: EntradaDeMemoria = {
      id: `mem-${String(this.contador).padStart(4, '0')}`,
      collection: entrada.collection,
      content: entrada.content,
      tags: entrada.tags,
      priority: entrada.priority,
      mandatory: false,
      scope: 'project',
      source: entrada.source ?? 'agent',
      metadata,
      criadaEm: new Date().toISOString(),
    };
    this.entradas.push(nova);
    return {
      ok: true,
      id: nova.id,
      duplicada: false,
      collection: entrada.collection,
      detalhe: 'created',
    };
  }

  exportar(colecao: string): EntradaDeMemoria[] {
    if (!this.ligado) throw new Error('memory.transport.unavailable');
    return this.entradas.filter((e) => e.collection === colecao);
  }

  consultar(consulta: ConsultaDelimitada): EntradaDeMemoria[] {
    const q = validarConsultaDelimitada(consulta);
    if (!this.ligado) throw new Error('memory.transport.unavailable');
    // Duplo de selecao na origem; nao chama o export amplo nem implementa ACL.
    const pagina = this.entradas.filter(e => pertenceAoEscopo(e, q)).slice(0, q.limite);
    return concluirConsultaDelimitada(pagina, q);
  }

  recuperar(colecao: string, id: string): EntradaDeMemoria | null {
    return this.exportar(colecao).find(e => e.id === id) ?? null;
  }

  contagens(): Record<string, number> {
    return this.entradas.reduce<Record<string, number>>((r, e) => { r[e.collection] = (r[e.collection] ?? 0) + 1; return r; }, {});
  }

  /** Duplo de transporte para o CI. Nao constitui prova de validacao G3. */
  submeterHandoff(p: PedidoDeHandoff): ResultadoDeHandoff {
    const existente = this.entradas.find(e => e.collection === 'handoff' && e.metadata.orkastery_identity === p.identidade);
    if (existente) return { ok: true, id: existente.id, duplicada: true, collection: 'handoff',
      detalhe: 'duplo G3', session_entry_id: existente.parent_id!, package_entry_id: String(existente.metadata.package_entry_id),
      package_id: String(existente.metadata.package_id), readback: true };
    const inserir = (collection: string, content: string, metadata: Record<string, unknown>, parent_id?: string): EntradaDeMemoria => {
      const e: EntradaDeMemoria = { id: `mem-${++this.contador}`, collection, content, metadata, parent_id,
        tags: p.tags, source: 'agent', priority: 'high', mandatory: false, scope: 'project', criadaEm: new Date().toISOString() };
      this.entradas.push(e); return e;
    };
    const sessao = this.entradas.find(e => e.collection === 'session' && e.metadata.session_id === p.sessionId) ??
      inserir('session', `Sessao ${p.sessionId}`, { session_id: p.sessionId });
    const packageId = `package-${this.contador + 1}`;
    const meta = { ...p.metadata, orkastery_identity: p.identidade, package_id: packageId, session_id: p.sessionId,
      origin: p.origem, destination: p.destino };
    const pacote = inserir('semantic_log', JSON.stringify(p.payload), meta, sessao.id);
    const handoff = inserir('handoff', String(p.payload.progresso), { ...meta, package_entry_id: pacote.id }, sessao.id);
    return { ok: true, id: handoff.id, duplicada: false, collection: 'handoff', detalhe: 'duplo de transporte G3',
      session_entry_id: sessao.id, package_entry_id: pacote.id, package_id: packageId, readback: true };
  }

  /**
   * Dublê declarado de embedding: saco de palavras com hash, sem semantica nenhuma. Serve para
   * provar contrato (dimensao, tenant, idempotencia, custo) sem rede e sem modelo.
   */
  embeddar(pedido: PedidoDeEmbedding): RespostaDeEmbedding {
    const p = validarPedidoDeEmbedding(pedido);
    if (!this.ligado) throw new Error('memory.transport.unavailable');
    if (!this.embedding[p.alvo]) throw new Error(p.alvo === 'primario' ? 'embeddings.chave-ausente' : 'embeddings.local-ausente');
    this.pedidosDeEmbedding.push(p);
    return { alvo: p.alvo, modelo: p.modelo, dim: p.dim, vetores: p.textos.map(t => vetorDeDuble(t, p.dim)) };
  }

  /** Dublê de FTS: todas as palavras da consulta no conteudo, sem stemming, com tenant obrigatorio. */
  buscarTexto(tenant: string, texto: string): string[] {
    if (!textoDeConsulta(tenant, 128) || !textoDeBuscaValido(texto)) throw new Error('memory.fts.invalid');
    if (!this.ligado) throw new Error('memory.transport.unavailable');
    const palavras = (t: string): string[] => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const consulta = palavras(texto);
    return this.entradas
      .filter(e => COLECOES_DO_ORK.includes(e.collection as ColecaoDoOrk) && (e.tags.project ?? []).includes(tenant))
      .map(e => ({ id: e.id, conteudo: palavras(e.content) }))
      .filter(e => consulta.every(p => e.conteudo.includes(p)))
      .map(e => ({ id: e.id, peso: e.conteudo.filter(p => consulta.includes(p)).length }))
      .sort((a, b) => b.peso - a.peso || a.id.localeCompare(b.id))
      .map(e => e.id);
  }

  /** So para os testes: injeta uma entrada que o `ork` nunca gravaria (humano, mandatory). */
  semear(entrada: EntradaDeMemoria): EntradaDeMemoria {
    this.entradas.push(entrada);
    return entrada;
  }

  /** Tudo que existe no dublê, para as asserçoes dos testes. */
  tudo(): EntradaDeMemoria[] {
    return [...this.entradas];
  }
}

/** Config de memoria efetiva a partir do manifesto, ja com o tenant resolvido. */
export function configDoManifesto(manifesto: Manifesto): ConfigDoDriver & { modo: string; tenant: string } {
  const variavel = manifesto.memory.database_url_env ?? '';
  return {
    modo: manifesto.memory.mode,
    cli: manifesto.memory.cli || 'orkmind',
    variavel,
    dsn: variavel ? (process.env[variavel] ?? '') : '',
    timeoutMs: manifesto.memory.timeout_ms || 15000,
    tenant: manifesto.memory.tenant || manifesto.project.name,
    // Lido direto do bloco: este modulo carrega sem o parser do manifesto (memory-native-schema).
    variavelDaChaveDeEmbedding: manifesto.memory.embedding?.provider === 'openrouter' ? manifesto.memory.embedding.api_key_env : '',
  };
}

/** Texto acionavel para cada motivo de degradacao. */
function correcaoDe(motivo: MotivoDeDegradacao, config: ReturnType<typeof configDoManifesto>): string {
  switch (motivo) {
    case 'modo.files':
      return 'para ligar a memoria semantica: memory.mode: orkmind + memory.database_url_env no manifesto';
    case 'modo.desconhecido':
      return 'memory.mode aceita files ou orkmind';
    case 'dsn.nao-declarado':
      return 'declare memory.database_url_env com o NOME da variavel de ambiente da base do tenant';
    case 'dsn.env-ausente':
      return `exporte ${config.variavel} com a DSN da base propria do tenant (o ork nao adivinha base)`;
    case 'cli.ausente':
      return `instale o OrkMind e garanta "${config.cli}" no PATH`;
    case 'orkmind.indisponivel':
      return 'suba o OrkMind (container do Postgres e a base do tenant) e rode ork memory status';
  }
}

/**
 * Resolve o regime EFETIVO de memoria.
 *
 * Este e o ponto unico em que "o manifesto pediu orkmind" vira "o orkmind esta valendo".
 * Toda degradacao sai daqui com motivo tipado e correcao, e nenhuma delas quebra ciclo.
 */
export function resolverRegime(
  manifesto: Manifesto,
  driver: DriverDeMemoria | null
): { estado: EstadoDaMemoria; driver: DriverDeMemoria | null } {
  const config = configDoManifesto(manifesto);
  const base = {
    pedido: config.modo,
    variavel: config.variavel,
    dsnPresente: config.dsn.trim() !== '',
    cli: config.cli,
    tenant: config.tenant,
  };
  const degradar = (motivo: MotivoDeDegradacao, detalhe: string): { estado: EstadoDaMemoria; driver: null } => ({
    estado: {
      ...base,
      efetivo: 'files',
      motivo,
      detalhe,
      correcao: correcaoDe(motivo, config),
    },
    driver: null,
  });

  if (config.modo === 'files') {
    return degradar('modo.files', 'manifesto opera em regime files (fallback honesto do B1)');
  }
  if (config.modo !== 'orkmind') {
    return degradar('modo.desconhecido', `memory.mode "${config.modo}" nao e um regime conhecido`);
  }
  // Isolamento por tenant: sem NOME de variavel declarado nao ha base, e nao ha palpite.
  if (config.variavel === '') {
    return degradar(
      'dsn.nao-declarado',
      'memory.database_url_env vazio: sem base declarada o ork nao conecta em base nenhuma'
    );
  }
  if (config.dsn.trim() === '' && !driver) {
    return degradar(
      'dsn.env-ausente',
      `${config.variavel} nao esta no ambiente: o ork nao cai para outra DSN (precedente memory-orkmind)`
    );
  }

  const efetivoDriver = driver ?? new DriverCliOrkMind(config);
  const saude = efetivoDriver.disponivel();
  if (!saude.ok) {
    const motivo: MotivoDeDegradacao = /não encontrad|not found|ENOENT|spawn/i.test(saude.detalhe)
      ? 'cli.ausente'
      : 'orkmind.indisponivel';
    return degradar(motivo, `OrkMind nao respondeu: ${saude.detalhe}`);
  }

  return {
    estado: {
      ...base,
      efetivo: 'orkmind' as RegimeDeMemoria,
      motivo: null,
      detalhe: `${efetivoDriver.nome} ativo na base declarada por ${config.variavel}: ${saude.detalhe}`,
      correcao: '',
    },
    driver: efetivoDriver,
  };
}

/** Consulta deterministica por tag sobre uma colecao ja exportada. */
export function filtrarPorTags(
  entradas: EntradaDeMemoria[],
  consulta: ConsultaPorTag
): EntradaDeMemoria[] {
  const casadas = entradas.filter((e) => casaTags(e, consulta.tags));
  // Ordem estavel e independente do que o Postgres devolveu: mandatory primeiro, depois
  // prioridade, depois data e id. Duas execucoes iguais montam o MESMO prompt.
  const peso: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  casadas.sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    const pa = peso[a.priority] ?? 9;
    const pb = peso[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    if (a.criadaEm !== b.criadaEm) return a.criadaEm.localeCompare(b.criadaEm);
    return a.id.localeCompare(b.id);
  });
  return consulta.limite ? casadas.slice(0, consulta.limite) : casadas;
}

/** Caminho relativo a raiz, no formato usado pelos ponteiros do handoff. */
export function relativoDaRaiz(raiz: string, caminho: string): string {
  return path.relative(raiz, caminho).split(path.sep).join('/');
}

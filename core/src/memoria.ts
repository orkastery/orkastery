import { exigirAtivacao, PerfilPublicacao } from './write-activation';
import { validarDiretorioDeThread } from './escopo-escrita';
import { memoryState } from './project-state';
/**
 * A camada de memoria do `ork` (bloco B6): o que o nucleo grava, com que tags, e o que
 * ele injeta de volta no prompt de cada fase.
 *
 * Divisao de trabalho deste bloco:
 *   - `orkmind.ts` sabe FALAR com o OrkMind (transporte, degradacao, governanca);
 *   - `memoria.ts` (aqui) sabe O QUE o Orkastery grava e le de volta (decisao, handoff,
 *     rule, learning, roadmap), e como isso vira contexto de prompt;
 *   - `recall.ts` sabe RESOLVER o que ficou fora do prompt, no momento indicado.
 *
 * Nenhuma regra de negocio nova nasce aqui. Decisao, claim, baseline, achado e score
 * continuam sendo do nucleo que ja existe: esta camada os PUBLICA e os RECUPERA.
 *
 * A propriedade que o B6 precisa provar e a da injecao deterministica: um prompt de fase
 * carrega 100 por cento das decisoes fechadas da thread, venham elas do `thread.json`
 * (regime `files`) ou da colecao `decision` (regime `orkmind`). Por isso a injecao NAO
 * depende do OrkMind estar ligado: ela troca de fonte, nao de garantia.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { configDeEmbedding, dirEstado, ManifestoCarregado } from './manifest';
import { CONTRATO_ONBOARDING, ETAPAS_ONBOARDING, jsonCanonico, lerOnboarding } from './onboarding';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { publicarGatesHumanos, ResultadoDeMemoriaHumana } from './memoria-humana';
import { caminhoPostmortem, lerMasterLog } from './master';
import { tagDoModo } from './modos';
import {
  COLECOES_DO_ORK,
  DriverDeMemoria,
  enderecoDeMemoria,
  filtrarPorTags,
  criarEscopoDeLeitura,
  validarConsultaDelimitada,
  concluirConsultaDelimitada,
  LIMITE_CONSULTA_PADRAO,
  LIMITE_CONSULTA_MAXIMO,
  resolverRegime,
  violacoesDeGovernanca,
  configDoManifesto,
  chaveDeEmbeddingAceita,
  SaudeDaPonte,
} from './orkmind';
import {
  arquivoDoIndice, avisoDeCobertura, codigoDaFalha, conferirUniverso, dirDosIndices, dimDoModeloLocal, Embeddar, impressaoDaBase, lerIndice,
  textoForaDaBusca, universoDaBusca, vetoresCoerentes, codigoDeEmbedding, CONTRATO_INDICE,
} from './indice-vetorial';
import { registrar, lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { dirThread, lerThread } from './thread';
import { lerJson } from './util';
import {
  Achado,
  ColecaoDoOrk,
  EntradaDeMemoria,
  ConsultaPorTag,
  EscopoDeLeitura,
  EntradaNova,
  EstadoDaMemoria,
  EstadoDeEmbeddings,
  ForaDaBusca,
  IndiceDeEmbeddings,
  Fase,
  Handoff,
  InjecaoDeMemoria,
  ItemDeInjecao,
  Manifesto,
  MasterLog,
  Postmortem,
  PrioridadeDeMemoria,
  RegimeDeMemoria,
  ResultadoDeGravacao,
  PedidoDeHandoff,
  ResultadoDeHandoff,
  Thread,
  UniversoDaBusca,
} from './types';
import { resumoDasLicoes, textoDasLicoes } from './licoes';

/** A fatia de `Fase` que aceita tambem os momentos nao canonicos do handoff. */
export type Momento = Fase | string;

/**
 * A memoria aberta para um projeto: o regime efetivo mais o transporte, quando ha.
 *
 * Abrir a memoria e barato em regime `files`: nao ha subprocess, nao ha rede, nao ha
 * espera. E o que permite `montarPrompt` chamar isto em todo despacho sem custo.
 */
export type LeituraRestritaDeMemoria = Readonly<EscopoDeLeitura & { limite: number }>;

export interface Memoria {
  readonly configSource?: string;
  readonly configDivergent?: boolean;
  /** Fronteiras fixadas na abertura, sem autoridade nova. */
  readonly leituraRestrita?: LeituraRestritaDeMemoria;
  raiz: string;
  submeterHandoff(pedido: PedidoDeHandoff): ResultadoDeHandoff;
  estado: EstadoDaMemoria;
  /** true quando o regime efetivo e `orkmind` (nao quando ele foi apenas pedido). */
  ativo: boolean;
  regime: RegimeDeMemoria;
  gravar(entrada: EntradaNova): ResultadoDeGravacao;
  buscar(consulta: ConsultaPorTag): EntradaDeMemoria[];
  /** Uma entrada pelo id, dentro de uma colecao. Usado pelo `ork recall`. */
  porId(colecao: string, id: string): EntradaDeMemoria | null;
  /**
   * RM-038: o universo da busca do tenant pela operacao `universo` da ponte. Use por
   * `universoDaBusca` (indice-vetorial.ts), que confere a fronteira e conta por colecao.
   */
  universo(tenant: string): { entradas: EntradaDeMemoria[]; foraDaBusca: ForaDaBusca | null; latenciaMs?: number };
}

export interface OpcoesDeMemoria {
  /** Janela finita da origem; tenant vem exclusivamente do manifesto. */
  leituraRestrita?: { thread: string; limite?: number };
  /** I-38 (D6), RM-038: `detalhado` le o universo da busca para a cobertura; so o `memory status` pede. */
  embeddings?: 'resumo' | 'detalhado';
  /** Driver injetado (testes, `--dry-run`). Sem ele, o regime resolve o driver real. */
  driver?: DriverDeMemoria | null;
}

export interface ResultadoSyncOnboarding {
  regime: RegimeDeMemoria;
  motivo: string | null;
  respondidas: number;
  gravadas: number;
  duplicadas: number;
  falhas: number;
  detalhe: string;
}

/** Publica somente a entrevista deste projeto; jamais percorre threads. */
export function sincronizarOnboarding(carregado: ManifestoCarregado, opcoes: OpcoesDeMemoria = {}): ResultadoSyncOnboarding {
  carregado = memoryState(carregado).loaded;
  const estado = lerOnboarding(carregado.raiz);
  const etapas = ETAPAS_ONBOARDING.filter(e => estado.etapas[e] !== null);
  const resultado: ResultadoSyncOnboarding = { regime: 'files', motivo: null, respondidas: etapas.length,
    gravadas: 0, duplicadas: 0, falhas: 0, detalhe: '' };
  const degradar = (motivo: string): ResultadoSyncOnboarding => {
    resultado.regime = 'files'; resultado.motivo = motivo;
    resultado.detalhe = 'Entrevista preservada em arquivos; publicação semântica não concluída. Consulte ork memory status.';
    registrar(dirEstado(carregado.raiz), 'projeto', TIPOS_DE_EVENTO.memoriaDegradada,
      { origem: 'onboarding', motivo, respondidas: etapas.length, gravadas: resultado.gravadas, falhas: resultado.falhas });
    return resultado;
  };
  // Os detalhes devolvidos por um driver podem conter credenciais. Só expor códigos locais.
  try {
    const memoria = abrirMemoria(carregado, opcoes);
    if (!memoria.ativo) return degradar(memoria.estado.motivo ?? 'orkmind.indisponivel');
    const tenant = memoria.estado.tenant;
    for (const etapa of etapas) {
      const resposta = estado.etapas[etapa]!;
      const identidade = `onboarding:${encodeURIComponent(tenant)}:${etapa}`;
      const r = memoria.gravar({ collection: 'decision', priority: 'medium',
        content: `Onboarding ${CONTRATO_ONBOARDING} tenant=${JSON.stringify(tenant)} etapa=${etapa}\n${jsonCanonico(resposta.conteudo)}`,
        tags: { ...tagsDoProjeto(carregado.manifesto), skill: ['orkastery-onboarding'],
          situation: ['onboarding', identidade] },
        metadata: { identidade, etapa, tenant, por: resposta.por, respondidaEm: resposta.respondidaEm },
      });
      if (!r.ok) resultado.falhas++;
      else if (r.duplicada) resultado.duplicadas++;
      else resultado.gravadas++;
    }
    if (resultado.falhas) return degradar('orkmind.indisponivel');
    resultado.regime = 'orkmind';
    resultado.detalhe = `${resultado.gravadas} nova(s), ${resultado.duplicadas} já existente(s); ${etapas.length} etapa(s) publicada(s).`;
    return resultado;
  } catch {
    resultado.falhas++;
    return degradar('orkmind.indisponivel');
  }
}


function resolverLeituraRestrita(manifesto: Manifesto,
  contexto: OpcoesDeMemoria['leituraRestrita']): LeituraRestritaDeMemoria | undefined {
  if (contexto === undefined) return undefined;
  if (!contexto || typeof contexto !== 'object' || Array.isArray(contexto) ||
      Object.keys(contexto).some(k => !['thread', 'limite'].includes(k))) throw Error('memory.query.invalid');
  const q = validarConsultaDelimitada({ collection: 'handoff',
    escopo: criarEscopoDeLeitura(manifesto, contexto.thread), tags: {},
    limite: contexto.limite === undefined ? LIMITE_CONSULTA_PADRAO : contexto.limite });
  return Object.freeze({ ...q.escopo, limite: q.limite });
}

/** Abre a memoria do projeto, ja com o regime efetivo resolvido. */
export function abrirMemoria(
  carregado: ManifestoCarregado,
  opcoes: OpcoesDeMemoria = {}
): Memoria {
  const context = memoryState(carregado);
  carregado = context.loaded;
  // Pedido invalido nao abre driver nem executa sua verificacao de saude.
  const leituraRestrita = resolverLeituraRestrita(carregado.manifesto, opcoes.leituraRestrita);
  const { estado, driver } = resolverRegime(carregado.manifesto, opcoes.driver ?? null);
  const ativo = estado.efetivo === 'orkmind' && driver !== null;
  const config = configDoManifesto(carregado.manifesto);
  const embeddings = (leitura: { universo?: UniversoDaBusca; falhaDoUniverso?: string } = {}) => estadoDeEmbeddings(
    carregado.manifesto, ativo ? driver?.disponivel().saude ?? null : null, carregado.raiz, estado.tenant, config.dsn, leitura);
  if (estado.pedido === 'orkmind') estado.embeddings = embeddings();
  const consultarRestrito = (collection: unknown, tags: unknown): EntradaDeMemoria[] => {
    if (!leituraRestrita) throw Error('memory.query.invalid');
    const q = validarConsultaDelimitada({ collection, tags,
      escopo: { tenant: leituraRestrita.tenant, thread: leituraRestrita.thread }, limite: leituraRestrita.limite });
    if (!ativo || !driver) return [];
    if (typeof driver.consultar !== 'function') throw Error('memory.query.unsupported');
    return concluirConsultaDelimitada(driver.consultar(q), q);
  };
  const memoria: Memoria = {
    configSource: context.source,
    configDivergent: context.divergent,
    get leituraRestrita() { return leituraRestrita; },
    raiz: carregado.raiz,
    submeterHandoff(pedido: PedidoDeHandoff): ResultadoDeHandoff {
      if (!ativo || !driver?.submeterHandoff) return { ok: false, id: null, duplicada: false,
        collection: 'handoff', detalhe: 'memory.g3.unavailable' };
      if (pedido.tenant !== estado.tenant) return { ok: false, id: null, duplicada: false,
        collection: 'handoff', detalhe: 'memory.tenant.mismatch' };
      return driver.submeterHandoff(pedido);
    },
    estado,
    ativo,
    regime: estado.efetivo,
    gravar(entrada: EntradaNova): ResultadoDeGravacao {
      const problemas = violacoesDeGovernanca(entrada);
      if (problemas.length > 0) {
        return {
          ok: false,
          id: null,
          duplicada: false,
          collection: entrada.collection,
          detalhe: `governanca: ${problemas.join('; ')}`,
        };
      }
      if (!ativo || !driver) {
        return {
          ok: false,
          id: null,
          duplicada: false,
          collection: entrada.collection,
          detalhe: `regime ${estado.efetivo}: nada gravado na memoria semantica (${estado.detalhe})`,
        };
      }
      return driver.adicionar(entrada);
    },
    buscar(consulta: ConsultaPorTag): EntradaDeMemoria[] {
      if (leituraRestrita) {
        if (consulta.limite !== undefined && (!Number.isInteger(consulta.limite) ||
            consulta.limite < 1 || consulta.limite > LIMITE_CONSULTA_MAXIMO)) throw Error('memory.query.invalid');
        const entradas = consultarRestrito(consulta.collection, consulta.tags);
        // Corte de apresentacao somente depois da janela completa e dos filtros locais.
        return consulta.limite === undefined ? entradas : entradas.slice(0, consulta.limite);
      }
      if (!ativo || !driver) return [];
      const colecoes = consulta.collection ? [consulta.collection] : [...COLECOES_DO_ORK];
      const tudo = colecoes.flatMap((c) => driver.exportar(c));
      return filtrarPorTags(tudo, consulta);
    },
    porId(colecao: string, id: string): EntradaDeMemoria | null {
      if (leituraRestrita) {
        if (typeof id !== 'string' || !id || id.length > 512 || /[\x00-\x1f\x7f]/.test(id)) throw Error('memory.query.invalid');
        return consultarRestrito(colecao, {}).find(e => e.id === id) ?? null;
      }
      if (!ativo || !driver) return null;
      return driver.exportar(colecao).find((e) => e.id === id) ?? null;
    },
    universo(tenant: string): { entradas: EntradaDeMemoria[]; foraDaBusca: ForaDaBusca | null; latenciaMs?: number } {
      // A fronteira do manifesto vale antes de qualquer leitura: tenant e so o configurado.
      if (tenant !== estado.tenant) throw new Error('memory.tenant.mismatch');
      if (leituraRestrita) throw new Error('memory.query.invalid');
      if (!ativo || !driver) throw new Error('memory.universo.indisponivel');
      if (typeof driver.universo !== 'function') throw new Error('memory.universo.unsupported');
      return driver.universo(tenant);
    },
  };
  // RM-038: a cobertura precisa do universo da busca (uma leitura pela ponte): so quando pedida. Falha
  // de leitura (janela saturada, fronteira violada) vira motivo tipado no estado, nunca cobertura inventada.
  if (opcoes.embeddings === 'detalhado' && ativo && !leituraRestrita) {
    let leitura: { universo?: UniversoDaBusca; falhaDoUniverso?: string };
    try { leitura = { universo: universoDaBusca(memoria, estado.tenant) }; }
    catch (erro) { leitura = { falhaDoUniverso: codigoDaFalha(erro) }; }
    estado.embeddings = embeddings(leitura);
  }
  return memoria;
}

// ---------------------------------------------------------------------------
// I-38 (T4, D6): estado sondado dos embeddings. Nunca derruba o regime.
// ---------------------------------------------------------------------------

/** Os indices locais do tenant nesta base, por modelo e dimensao. */
function indicesDoTenant(raiz: string, tenant: string, base: string, universo: EntradaDeMemoria[]): IndiceDeEmbeddings[] {
  const dir = dirDosIndices(raiz, tenant);
  if (!fs.existsSync(dir)) return [];
  const indices: IndiceDeEmbeddings[] = [];
  for (const nome of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    try {
      const bruto = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8'));
      if (bruto.contrato !== CONTRATO_INDICE || bruto.tenant !== tenant || bruto.base !== base) continue;
      const { indice } = lerIndice(path.join(dir, nome), { tenant, base, modelo: bruto.modelo, dim: bruto.dim });
      const vetores = Object.keys(indice.entradas).length;
      const coerentes = vetoresCoerentes(indice, universo).size;
      indices.push({ modelo: indice.modelo, dim: indice.dim, vetores, coerentes, desatualizados: vetores - coerentes });
    } catch { /* arquivo ilegivel nao e indice: `ork memory index` o reconstroi */ }
  }
  return indices;
}

/**
 * Estado de embeddings: configuracao, presenca da chave (nome, nunca valor), a sonda `health`
 * da ponte e os arquivos de indice. `saude` null quer dizer que a ponte nao foi sondada.
 */
export function estadoDeEmbeddings(manifesto: Manifesto, saude: SaudeDaPonte | null, raiz: string, tenant: string,
  dsn: string, opcoes: { universo?: UniversoDaBusca; falhaDoUniverso?: string; env?: NodeJS.ProcessEnv } = {}): EstadoDeEmbeddings {
  const config = configDeEmbedding(manifesto);
  const env = opcoes.env ?? process.env;
  const configurado = config.provider !== 'none';
  const variavel = config.api_key_env;
  const bruto = variavel ? (env[variavel] ?? '').trim() : '';
  const chavePresente = !!variavel && chaveDeEmbeddingAceita(bruto, dsn);
  const recusada = bruto !== '' && !chavePresente;
  const dimLocal = configurado && config.fallback_model ? dimDoModeloLocal(config.fallback_model, env) : null;
  const dependencias = saude?.fallback.dependencias ?? false;
  const fallback = { modelo: config.fallback_model || null, presente: dimLocal !== null, dependencias, dim: dimLocal };
  const base = impressaoDaBase(dsn);
  const existe = (modelo: string, dim: number | null) => dim !== null && fs.existsSync(arquivoDoIndice(raiz, tenant, modelo, dim));
  const estado: EstadoDeEmbeddings = {
    configurado, provider: config.provider, modelo: configurado ? config.model : null, dim: configurado ? config.dim : null,
    variavelDaChave: variavel, chavePresente, fallback, indices: [], entradas: null, cobertura: null,
    universo: null, aviso: null, falhaDoUniverso: null,
    ativo: 'nenhum', sondado: saude !== null, motivo: null, detalhe: '', correcao: '',
  };
  if (!configurado) {
    return { ...estado, motivo: 'embeddings.nao-configurado',
      detalhe: 'memory.embedding ausente ou provider none: busca por significado desligada; o recall por tag segue identico',
      correcao: 'declare memory.embedding no manifesto (provider openrouter e api_key_env com o NOME da variavel da chave)' };
  }
  const fallbackUsavel = saude !== null && fallback.presente && dependencias;
  if (chavePresente) {
    estado.ativo = 'primario';
    if (!existe(config.model, config.dim)) {
      estado.motivo = 'embeddings.indice-ausente';
      estado.detalhe = `chave presente em ${variavel}; o indice local de ${config.model} ainda nao existe`;
      estado.correcao = 'rode ork memory index (use --dry-run antes para ver tokens e custo)';
    } else estado.detalhe = `primario ${config.model} (${config.dim} dim) pela chave em ${variavel}`;
  } else {
    estado.ativo = fallbackUsavel ? 'fallback' : 'nenhum';
    estado.motivo = 'embeddings.chave-ausente';
    const local = !fallback.modelo ? 'sem fallback local declarado: a busca por significado cai para FTS'
      : !fallback.presente ? `fallback ${fallback.modelo} ausente do cache local: a busca cai para FTS`
        : !saude ? 'ponte nao sondada: fallback local nao conferido'
          : !dependencias ? `fallback ${fallback.modelo} sem torch/transformers no interpretador da ponte: a busca cai para FTS`
            : `busca usa o fallback local ${fallback.modelo} (${fallback.dim} dim)` +
              (existe(fallback.modelo, fallback.dim) ? '' : '; indice local ausente: rode ork memory index --modelo fallback');
    estado.detalhe = `${variavel} ${recusada ? 'tem valor recusado (parece URL, DSN ou texto com espaco; nunca impresso)' : 'nao esta no ambiente (valor nunca impresso)'}; ${local}`;
    estado.correcao = `exporte ${variavel} com a chave dedicada ao Orkastery; o valor nunca vai ao manifesto`;
  }
  if (opcoes.universo) {
    // RM-038: o universo vem de universoDaBusca; a fronteira vale de novo antes de contar.
    if (opcoes.universo.tenant !== tenant) throw new Error('memory.query.scope-violation');
    conferirUniverso(opcoes.universo.entradas, tenant, opcoes.universo.lidoEm);
    const universo = opcoes.universo.entradas;
    estado.indices = indicesDoTenant(raiz, tenant, base, universo);
    estado.entradas = universo.length;
    estado.universo = { porColecao: { ...opcoes.universo.porColecao }, foraDaBusca: opcoes.universo.foraDaBusca,
      ...(opcoes.universo.latenciaMs === undefined ? {} : { latenciaMs: opcoes.universo.latenciaMs }) };
    const referencia = estado.ativo === 'fallback' ? { modelo: fallback.modelo, dim: fallback.dim } : { modelo: config.model, dim: config.dim };
    const indice = estado.indices.find(i => i.modelo === referencia.modelo && i.dim === referencia.dim);
    const coerentes = indice?.coerentes ?? 0;
    estado.cobertura = universo.length === 0 ? 0 : Math.round((coerentes / universo.length) * 10_000) / 10_000;
    // RM-038 (D7): o indice que a busca usa cobre menos do que ela enxerga: dito, nunca escondido.
    estado.aviso = avisoDeCobertura(coerentes, universo, estado.ativo);
  } else if (opcoes.falhaDoUniverso) estado.falhaDoUniverso = opcoes.falhaDoUniverso;
  return estado;
}

/**
 * `ork memory status --sondar`: UMA chamada real com texto fixo curto pelo caminho ativo, com
 * a latencia medida (primario custa cerca de US$ 0,00000005; fallback local, so CPU).
 */
export function sondarEmbeddings(manifesto: Manifesto, estado: EstadoDeEmbeddings, embeddar: Embeddar,
  timeoutMs: number): NonNullable<EstadoDeEmbeddings['sonda']> {
  if (estado.ativo === 'nenhum') return { ok: false, alvo: null, latenciaMs: null, motivo: estado.motivo };
  const config = configDeEmbedding(manifesto);
  const primario = estado.ativo === 'primario';
  const modelo = primario ? config.model : estado.fallback.modelo!;
  const dim = primario ? config.dim : estado.fallback.dim!;
  const inicio = Date.now();
  try {
    embeddar({ papel: 'consulta', alvo: estado.ativo as 'primario' | 'fallback', modelo, dim, textos: ['sonda de saude do ork'] }, { timeoutMs });
    return { ok: true, alvo: estado.ativo as 'primario' | 'fallback', latenciaMs: Date.now() - inicio, motivo: null };
  } catch (erro) {
    return { ok: false, alvo: estado.ativo as 'primario' | 'fallback', latenciaMs: Date.now() - inicio, motivo: codigoDeEmbedding(erro) };
  }
}

// ---------------------------------------------------------------------------
// Tags: as 5 dimensoes, montadas em um lugar so.
// ---------------------------------------------------------------------------

/**
 * As tags de projeto. Toda entrada gravada pelo `ork` carrega estas tres dimensoes, e e
 * por elas que a busca deterministica encontra o que e daquele produto e daquele agente.
 */
export function tagsDoProjeto(manifesto: Manifesto): Record<string, string[]> {
  return {
    project: [manifesto.memory.tenant || manifesto.project.name],
    agent: ['desconhecido:desconhecido', 'ork'],
    domain: ['orkastery'],
  };
}

/** Tag de situacao que amarra uma entrada a uma thread. */
export function situacaoDaThread(threadId: string): string {
  return `thread:${threadId}`;
}

/** Tag de situacao que amarra uma entrada a uma fase. */
export function situacaoDaFase(fase: Fase): string {
  return `fase:${fase}`;
}

/** Tag de skill por colecao: e o recorte que separa decisao de licao na mesma base. */
export function skillDaColecao(colecao: ColecaoDoOrk): string {
  return `orkastery-${colecao}`;
}

/** Autoria observada; manifesto do executor nao prova autoria historica. */
export function agenteDaThread(thread: Thread, slug?: string): string {
  const sessao = slug ? thread.sessoes.find(s => s.slug === slug) : thread.sessoes.at(-1);
  if (!sessao) return 'desconhecido:desconhecido';
  let modelo = 'desconhecido';
  if (thread.worktree) {
    const evento = lerLedger(dirThread(thread.worktree, thread.id)).find(e =>
      e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId);
    if (typeof evento?.model === 'string' && evento.model) modelo = evento.model;
  }
  return `${sessao.runtime || 'desconhecido'}:${modelo}`;
}

/** As tags completas de uma entrada de thread. */
export function tagsDaThread(
  manifesto: Manifesto,
  colecao: ColecaoDoOrk,
  thread: Thread,
  fase?: Fase
): Record<string, string[]> {
  const aplicavel = fase ?? thread.faseAtual;
  const situacao = [colecao, situacaoDaThread(thread.id), `modo:${thread.modo}`, situacaoDaFase(aplicavel)];
  return {
    ...tagsDoProjeto(manifesto),
    agent: [agenteDaThread(thread), 'ork'],
    skill: [aplicavel, skillDaColecao(colecao)],
    situation: situacao,
  };
}

// ---------------------------------------------------------------------------
// Gravacao automatica (guia: docs/guias/memoria-e-handoff.md).
// ---------------------------------------------------------------------------

/** O que uma rodada de gravacao fez, por colecao. */
export interface ResultadoDaSincronizacao {
  regime: RegimeDeMemoria;
  gravadas: ResultadoDeGravacao[];
  duplicadas: number;
  falhas: number;
  detalhe: string;
}

function juntar(resultados: ResultadoDeGravacao[], regime: RegimeDeMemoria): ResultadoDaSincronizacao {
  const duplicadas = resultados.filter((r) => r.ok && r.duplicada).length;
  const falhas = resultados.filter((r) => !r.ok).length;
  const novas = resultados.filter((r) => r.ok && !r.duplicada).length;
  return {
    regime,
    gravadas: resultados,
    duplicadas,
    falhas,
    detalhe:
      regime === 'files'
        ? 'regime files: nada foi para a memoria semantica (degradacao honesta)'
        : `${novas} nova(s), ${duplicadas} ja existente(s), ${falhas} falha(s)`,
  };
}

/**
 * Grava as decisoes FECHADAS (`locked`) da thread na colecao `decision`.
 *
 * Prioridade `high` e nunca `mandatory`: quem transforma uma decisao de thread em regra
 * do ecossistema e o humano, no OrkMind, com a autenticacao dele.
 */
export function gravarDecisoes(
  memoria: Memoria,
  manifesto: Manifesto,
  thread: Thread
): ResultadoDaSincronizacao {
  const resultados: ResultadoDeGravacao[] = [];
  for (const d of thread.decisoes ?? []) {
    if (!d.locked) continue;
    resultados.push(
      memoria.gravar({
        collection: 'decision',
        content:
          `Decisao ${d.id} fechada na thread ${thread.id} ("${thread.nome}") do produto ` +
          `${thread.projeto.name}.\n${d.texto}\n` +
          `Fechada por ${d.decididaPor} em ${d.decididaEm}. Modo de conducao: ${tagDoModo(thread.modo)}.`,
        // A tag `decisao:<id>` NAO e enfeite: o CLI do OrkMind nao tem canal de
        // metadata, entao a identidade da entrada precisa viajar por onde a busca por
        // tag ja e exata. Sem ela, a mesma decisao voltaria duas vezes ao prompt (uma
        // do thread.json, outra da memoria), porque nao haveria como deduplicar.
        tags: Object.fromEntries(Object.entries({
          ...tagsDaThread(manifesto, 'decision', thread),
          situation: [
            'decision',
            situacaoDaThread(thread.id),
            `modo:${thread.modo}`,
            `decisao:${d.id}`,
          ],
        }).map(([k, v]) => [k, [...new Set(v)].sort()])),
        priority: 'high',
        metadata: {
          thread: thread.id,
          decisao: d.id,
          locked: true,
          produto: thread.projeto.name,
          decididaPor: d.decididaPor,
          decididaEm: d.decididaEm,
        },
      })
    );
  }
  return juntar(resultados, memoria.regime);
}

/** Identidade independente da worktree: tenant, caminho canonico e bytes da origem. */
export function identidadeDoHandoff(tenant: string, arquivo: string, sha256: string): string {
  const digest = createHash('sha256').update([tenant, arquivo, sha256].join('\0')).digest('hex');
  return digest.match(/.{8}/g)!.join(':');
}

export function origemCanonicaDoHandoff(arquivo: string): string {
  const normalizado = arquivo.split(path.sep).join('/');
  const inicio = normalizado.lastIndexOf('.orkastery/');
  return inicio >= 0 ? normalizado.slice(inicio) : normalizado;
}

/** Adaptacao do v1 para o G3. Ausencias sao declaradas; o original fica integral. */
export function prepararHandoffGovernado(
  manifesto: Manifesto, thread: Thread, handoff: Handoff, arquivo: string, textoOriginal: string,
  raiz: string
): PedidoDeHandoff {
  const tenant = manifesto.memory.tenant || manifesto.project.name;
  if (thread.projeto.name !== manifesto.project.name || handoff.thread !== thread.id) {
    throw new Error('memory.tenant.mismatch');
  }
  if (!isDeepStrictEqual(JSON.parse(textoOriginal), handoff)) throw new Error('memory.handoff.source-mismatch');
  if (!handoff.de?.slug || !handoff.para?.slug || !Array.isArray(handoff.inline) ||
      !Array.isArray(handoff.pointers) || !Array.isArray(handoff.summaries)) throw new Error('memory.handoff.invalid');
  arquivo = origemCanonicaDoHandoff(arquivo);
  const sha256 = createHash('sha256').update(textoOriginal).digest('hex');
  const identidade = identidadeDoHandoff(tenant, arquivo, sha256);
  const anteriores = thread.sessoes.filter(s => s.origem !== 'adocao' && s.fase === handoff.de.fase &&
    Date.parse(s.despachadaEm) <= Date.parse(handoff.geradoEm));
  const exata = anteriores.find(s => s.slug === handoff.de.slug);
  // O v1 exportava thread.slug no campo de.slug. A data/fase identifica a sessao
  // efetivamente em curso quando o arquivo foi produzido, sem atribuir o migrador.
  const sessao = exata ?? (handoff.de.slug === thread.slug ? anteriores.at(-1) : undefined);
  const evento = sessao ? lerLedger(dirThread(raiz, thread.id)).find(e =>
    e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId) : undefined;
  const agente = `${sessao?.runtime || 'desconhecido'}:${typeof evento?.model === 'string' ? evento.model : 'desconhecido'}`;
  const sessionId = sessao?.sessionId || `origem-declarada:${tenant}:${thread.id}:${handoff.de.slug}`;
  const autoria = { sessionId, slug: sessao?.slug ?? handoff.de.slug, agente,
    criterio: exata ? 'slug, fase e data do despacho' : sessao ? 'ultima sessao da fase anterior ao arquivo; slug v1 da thread' :
      'somente slug declarado no arquivo; runtime e modelo desconhecidos',
    evidencia: sessao ? `.orkastery/threads/${thread.id}/thread.json#json:sessoes` : `${arquivo}#json:de` };
  const decisoes = handoff.inline.filter(i => /decis[aã]o/i.test(i.titulo) || i.proveniencia.location.includes('decisoes'));
  const tags = { ...tagsDaThread(manifesto, 'handoff', thread, handoff.para.fase ?? undefined), agent: [agente, 'ork'] };
  const progresso = `Handoff da thread ${thread.id} de ${handoff.de.slug} (${handoff.de.fase}) para ` +
    `${handoff.para.slug} (${handoff.para.fase}), regime ${handoff.memory}.\n` +
    `Triagem: ${handoff.inline.length} inline, ${handoff.pointers.length} ponteiros e ${handoff.summaries.length} resumos.\n` +
    `Arquivo commitado: ${arquivo}\nResumos declarados na origem: ${JSON.stringify(handoff.summaries)}`;
  return { tenant, identidade, sessionId, origem: handoff.de.slug, destino: handoff.para.slug, tags,
    metadata: { tenant, thread: thread.id, arquivo, sha256, bytes: Buffer.byteLength(textoOriginal),
      de: handoff.de, para: handoff.para, autoria },
    payload: {
      progresso,
      decisoes: decisoes.length ? `Decisoes declaradas no pacote original, preservadas a seguir:\n${JSON.stringify(decisoes)}` :
        'O pacote original nao declara decisoes inline identificaveis. Esta ausencia foi preservada, sem inferir uma decisao.',
      referencias_criticas: `Caminhos e ancoras declarados pelo produtor; hashes integrais permanecem no pacote original:\n${JSON.stringify({
        inline: handoff.inline.map(i => i.proveniencia.location),
        pointers: handoff.pointers.map(p => ({ location: p.location, retrieve_when: p.retrieve_when })) })}`,
      proximos_passos: `Destino declarado: ${handoff.para.slug}, fase ${handoff.para.fase ?? 'nao declarada'}. ` +
        `Momentos de recuperacao dos ponteiros: ${JSON.stringify(handoff.pointers.map(p => ({ id: p.id, retrieve_when: p.retrieve_when })))}. ` +
        'O formato v1 nao declara outra lista de tarefas seguintes; nenhuma foi inferida nesta adaptacao.',
      original: handoff, original_texto: textoOriginal, orkastery_identity: identidade,
    } };
}

/** Publica exclusivamente por G3, com readback; arquivo ausente nunca vira pacote vazio. */
export function gravarHandoff(
  memoria: Memoria, manifesto: Manifesto, thread: Thread, handoff: Handoff, caminhoRelativo: string
): ResultadoDeHandoff {
  try {
    const arquivo = path.resolve(memoria.raiz, caminhoRelativo);
    const textoOriginal = fs.readFileSync(arquivo, 'utf8');
    const pedido = prepararHandoffGovernado(manifesto, thread, handoff, caminhoRelativo, textoOriginal, memoria.raiz);
    const resultado = memoria.submeterHandoff(pedido);
    if (memoria.ativo && !resultado.ok) throw new Error(resultado.detalhe);
    return resultado;
  } catch {
    // Falha de publicacao precisa reprovar export/sync, preservando o arquivo de origem.
    throw new Error('memory.handoff.failed: fonte, G3 ou readback nao confirmado');
  }
}

/**
 * Grava as policies do manifesto na colecao `rule`.
 *
 * Sem `mandatory` e sem `critical`, sempre: o `ork` publica a policy do projeto como
 * conhecimento recuperavel, e NAO se promove a autor de regra do ecossistema. Promover
 * uma policy a regra mandatoria e ato de humano autenticado no OrkMind.
 */
export function gravarPolicies(memoria: Memoria, manifesto: Manifesto): ResultadoDaSincronizacao {
  const resultados: ResultadoDeGravacao[] = [];
  for (const [nome, postura] of Object.entries(manifesto.policies ?? {})) {
    resultados.push(
      memoria.gravar({
        collection: 'rule',
        content:
          `Policy "${nome}" do produto ${manifesto.project.name}: postura ${postura}.\n` +
          'Declarada em orkastery.yaml (policies) e avaliada pelo gate tipado do ork antes ' +
          'de todo despacho de fase. Esta entrada e publicacao do ork (source: agent) e nao ' +
          'e regra mandatoria do ecossistema.',
        tags: {
          ...tagsDoProjeto(manifesto),
          skill: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER', skillDaColecao('rule')],
          situation: ['policy', `policy:${nome}`, `postura:${postura}`],
        },
        priority: 'high',
        metadata: { policy: nome, postura, origem: 'orkastery.yaml' },
      })
    );
  }
  return juntar(resultados, memoria.regime);
}

/**
 * Grava a licao da thread fechada na colecao `learning`.
 *
 * E a entrada que uma thread NOVA do mesmo produto recebe no GOAL: score, classes de
 * falha e o resumo do postmortem, com a thread de origem declarada.
 */
export function gravarLearning(
  memoria: Memoria,
  manifesto: Manifesto,
  thread: Thread,
  postmortem: Postmortem,
  master: MasterLog
): ResultadoDeGravacao {
  const classes = postmortem.classesDeFalha.join(', ') || 'sem-falha';
  return memoria.gravar({
    collection: 'learning',
    content:
      `Licao da thread ${thread.id} ("${thread.nome}") do produto ${master.projeto.name}.\n` +
      `Score humano: ${master.score}/5 por ${master.avaliadoPor}. Justificativa: ${master.justificativa}\n` +
      `Classes de falha: ${classes}. Modo: ${master.tag}. Variante: ${master.variante ?? 'nenhuma'}.\n` +
      `Fases percorridas: ${postmortem.fasesPercorridas.map((f) => f.fase).join(' -> ') || '(nenhuma)'}.\n` +
      `Gates bloqueados: ${postmortem.gatesBloqueados.length}. Pausas humanas: ${postmortem.pausasHumanas}. ` +
      `Decisoes autonomas: ${postmortem.decisoesAutonomas}.\n` +
      `Resumo: ${master.resumo}\n` +
      // Proveniencia no CORPO, e nao so em metadata: e o que permite ao `ork recall`
      // achar o arquivo commitado desta licao quando o transporte nao carrega metadata.
      `Postmortem: .orkastery/threads/${thread.id}/POSTMORTEM.json`,
    tags: {
      ...tagsDoProjeto(manifesto),
      skill: ['GOAL', skillDaColecao('learning')],
      situation: [
        'learning',
        situacaoDaThread(thread.id),
        `score:${master.score}`,
        ...postmortem.classesDeFalha.map((c) => `classe:${c}`),
      ],
    },
    // Licao com score baixo pesa mais na proxima thread: e o que o builder precisa ver
    // antes de repetir a mesma classe de falha.
    priority: master.score <= 2 ? 'high' : 'medium',
    metadata: {
      thread: thread.id,
      score: master.score,
      classes: postmortem.classesDeFalha,
      produto: master.projeto.name,
      avaliadoPor: master.avaliadoPor,
      postmortem: `.orkastery/threads/${thread.id}/POSTMORTEM.json`,
    },
  });
}

/** Grava a origem da thread na colecao `roadmap` (de onde ela veio, e por que). */
export function gravarOrigemDaThread(
  memoria: Memoria,
  manifesto: Manifesto,
  thread: Thread,
  origem: { tipo: 'pedido' | 'achado'; referencia: string; detalhe: string }
): ResultadoDeGravacao {
  return memoria.gravar({
    collection: 'roadmap',
    content:
      `Thread ${thread.id} ("${thread.nome}") aberta no produto ${thread.projeto.name}.\n` +
      `Origem: ${origem.tipo}${origem.referencia ? ` ${origem.referencia}` : ''}.\n` +
      `${origem.detalhe}\n` +
      `Modo ${tagDoModo(thread.modo)}, base ${thread.base.branch} @ ${thread.base.commit}.`,
    tags: {
      ...tagsDaThread(manifesto, 'roadmap', thread),
      situation: ['roadmap', situacaoDaThread(thread.id), `origem:${origem.tipo}`],
    },
    priority: 'medium',
    metadata: {
      thread: thread.id,
      origem: origem.tipo,
      referencia: origem.referencia,
      produto: thread.projeto.name,
    },
  });
}

/**
 * Grava a proposta de ajuste de um achado de auditoria na colecao `roadmap`.
 *
 * E o mesmo bloco obrigatorio do B5 (impacto, fix, estimativa, passo irreversivel), agora
 * enderecado ao roadmap do produto pela memoria em vez de so pelo board em arquivo.
 */
export function gravarPropostaDeAuditoria(
  memoria: Memoria,
  manifesto: Manifesto,
  achado: Achado
): ResultadoDeGravacao {
  const p = achado.proposta;
  return memoria.gravar({
    collection: 'roadmap',
    content:
      `Proposta do achado ${achado.id} (${achado.pack}/${achado.regra}, severidade ${achado.severidade}) ` +
      `para o roadmap de ${p.destino}.\n` +
      `Titulo: ${achado.titulo}\n` +
      `Evidencia: ${achado.arquivo}${achado.linha ? `:${achado.linha}` : ''}\n` +
      `Impacto: ${p.impacto}\nFix: ${p.fix}\nEstimativa: ${p.estimativa}\n` +
      `Passo irreversivel: ${p.passoIrreversivel || '(nenhum)'}\n` +
      `Claim do auditor: ${achado.claim.alegacao} (verificar com: ${achado.claim.verificar.join(' && ') || 'sem comando'})`,
    tags: {
      ...tagsDoProjeto(manifesto),
      skill: ['GOAL', skillDaColecao('roadmap')],
      situation: [
        'proposta_auditoria',
        `achado:${achado.id}`,
        `rodada:${achado.rodada}`,
        `pack:${achado.pack}`,
        `regra:${achado.regra}`,
        `severidade:${achado.severidade}`,
      ],
    },
    priority: achado.severidade === 'critico' ? 'high' : 'medium',
    metadata: {
      achado: achado.id,
      rodada: achado.rodada,
      pack: achado.pack,
      regra: achado.regra,
      severidade: achado.severidade,
      destino: p.destino,
      arquivo: achado.arquivo,
      linha: achado.linha,
    },
  });
}

// ---------------------------------------------------------------------------
// Leitura: injecao deterministica por tag na montagem de prompt.
// ---------------------------------------------------------------------------

/**
 * Le um campo de identidade de uma entrada, na ordem em que ele sobrevive ao transporte.
 *
 * O CLI do OrkMind grava colecao, conteudo, tags, prioridade, escopo e origem, e NAO tem
 * canal de metadata. Um leitor que dependesse so de `metadata` funcionaria com o driver
 * em memoria e falharia contra o OrkMind de verdade, exatamente onde importa. Por isso a
 * identidade viaja em tres lugares, e a leitura tenta os tres:
 *
 *   1. `metadata` (drivers que a carregam, como a API e o driver de teste);
 *   2. a tag `situation` no formato `<campo>:<valor>` (busca por tag e exata);
 *   3. uma linha `Rotulo: valor` no proprio conteudo (proveniencia declarada em texto).
 */
function daMetadata(e: EntradaDeMemoria, campo: string): string | null {
  const bruto = e.metadata?.[campo];
  return typeof bruto === 'string' && bruto !== '' ? bruto : null;
}

function daTag(e: EntradaDeMemoria, prefixo: string): string | null {
  const achada = (e.tags.situation ?? []).find((t) => t.startsWith(`${prefixo}:`));
  return achada ? achada.slice(prefixo.length + 1) : null;
}

function doConteudo(e: EntradaDeMemoria, rotulo: string): string | null {
  const linha = e.content.split('\n').find((l) => l.trim().startsWith(`${rotulo}:`));
  return linha ? linha.trim().slice(rotulo.length + 1).trim() : null;
}

/** Id da decisao (`D1`) que originou a entrada, ou null. */
export function decisaoDaEntrada(e: EntradaDeMemoria): string | null {
  return daMetadata(e, 'decisao') ?? daTag(e, 'decisao');
}

/** Thread de origem da entrada, ou null. */
export function threadDaEntrada(e: EntradaDeMemoria): string | null {
  return daMetadata(e, 'thread') ?? daTag(e, 'thread');
}

/** Arquivo commitado do handoff publicado, ou null. */
export function arquivoDoHandoff(e: EntradaDeMemoria): string | null {
  return daMetadata(e, 'arquivo') ?? doConteudo(e, 'Arquivo commitado');
}

/** POSTMORTEM commitado da licao publicada, ou null. */
export function postmortemDaLicao(e: EntradaDeMemoria): string | null {
  return daMetadata(e, 'postmortem') ?? doConteudo(e, 'Postmortem');
}

/** As decisoes fechadas da thread na memoria semantica. */
export function decisoesDaThreadNaMemoria(
  memoria: Memoria,
  manifesto: Manifesto,
  thread: Thread
): EntradaDeMemoria[] {
  return memoria.buscar({
    collection: 'decision',
    tags: {
      project: tagsDoProjeto(manifesto).project,
      skill: [skillDaColecao('decision')],
      situation: [situacaoDaThread(thread.id)],
    },
  });
}

/**
 * As licoes das threads ANTERIORES do mesmo produto.
 *
 * A thread corrente e excluida de proposito: uma thread nao aprende consigo mesma antes
 * de ter fechado, e repetir a propria licao no GOAL so gasta janela.
 */
export function licoesDoProduto(
  memoria: Memoria,
  manifesto: Manifesto,
  threadCorrente: string,
  limite = 5
): EntradaDeMemoria[] {
  if (memoria.ativo && memoria.leituraRestrita) {
    throw Error('memory.query.broad-operation: licoes do produto exigem contexto de manutencao ou regime files');
  }
  const todas = memoria.buscar({
    collection: 'learning',
    tags: {
      project: tagsDoProjeto(manifesto).project,
      skill: [skillDaColecao('learning')],
    },
  });
  return todas.filter((e) => threadDaEntrada(e) !== threadCorrente).slice(0, limite);
}

/** As regras publicadas do projeto (policies e o que o humano marcou como mandatory). */
export function regrasDoProjeto(memoria: Memoria, manifesto: Manifesto): EntradaDeMemoria[] {
  return memoria.buscar({
    collection: 'rule',
    tags: { project: tagsDoProjeto(manifesto).project },
  });
}

/** A primeira linha util de um conteudo, usada como titulo do item injetado. */
function primeiraLinha(texto: string): string {
  return texto.split('\n').find((l) => l.trim() !== '')?.trim() ?? texto.slice(0, 80);
}

/**
 * Monta o bloco de memoria do prompt de uma fase.
 *
 * O contrato que o B6 precisa cumprir, e que o teste cobra:
 *
 *  - TODA decisao fechada (`locked`) da thread entra, em qualquer regime. Em `files` a
 *    fonte e o `thread.json`; em `orkmind` e a uniao do `thread.json` com a colecao
 *    `decision`, deduplicada por id da decisao. Uniao, e nao troca, porque uma gravacao
 *    que falhou no OrkMind nao pode fazer a decisao sumir do prompt.
 *  - No GOAL, entram as licoes das threads anteriores do produto (`learning`).
 *  - Entradas `mandatory` do OrkMind entram sempre que as tags casam, em qualquer fase.
 *  - Todo item declara a proveniencia: `path#ancora` ou `orkmind://<colecao>/<id>`.
 */
export function injecaoDaFase(
  carregado: ManifestoCarregado,
  memoria: Memoria,
  thread: Thread,
  fase: Fase
): InjecaoDeMemoria {
  carregado = memoryState(carregado).loaded;
  const { manifesto } = carregado;
  const itens: ItemDeInjecao[] = [];
  const caminhoThread = `.orkastery/threads/${thread.id}/thread.json`;
  let n = 0;
  const add = (item: Omit<ItemDeInjecao, 'id'>): void => {
    n += 1;
    itens.push({ id: `inj-${n}`, ...item });
  };

  // 1. Decisoes fechadas da thread. A fonte em arquivo vem primeiro porque ela e a que
  // existe em qualquer regime; a memoria semantica completa o que o arquivo nao tem.
  const vistas = new Set<string>();
  for (const d of thread.decisoes ?? []) {
    if (!d.locked) continue;
    vistas.add(d.id);
    add({
      colecao: 'decision',
      titulo: `Decisao ${d.id} (fechada por ${d.decididaPor})`,
      conteudo: d.texto,
      origem: 'thread.json',
      location: `${caminhoThread}#json:decisoes.${d.id}`,
      mandatory: false,
    });
  }
  if (memoria.ativo) {
    for (const e of decisoesDaThreadNaMemoria(memoria, manifesto, thread)) {
      const id = decisaoDaEntrada(e);
      if (id && vistas.has(id)) continue;
      if (id) vistas.add(id);
      add({
        colecao: 'decision',
        titulo: id ? `Decisao ${id} (memoria semantica)` : 'Decisao fechada (memoria semantica)',
        conteudo: e.content,
        origem: 'orkmind',
        location: enderecoDeMemoria('decision', e.id),
        mandatory: e.mandatory,
      });
    }
  }
  const decisoes = itens.length;

  // 2. Licoes das threads anteriores do produto: entram no GOAL, que e onde o objetivo
  // ainda pode mudar por causa delas.
  let licoes = 0;
  if (memoria.ativo && fase === 'GOAL') {
    for (const e of licoesDoProduto(memoria, manifesto, thread.id)) {
      licoes += 1;
      add({
        colecao: 'learning',
        titulo: `Licao da thread ${threadDaEntrada(e) ?? '(anterior)'}`,
        conteudo: e.content,
        origem: 'orkmind',
        location: enderecoDeMemoria('learning', e.id),
        mandatory: e.mandatory,
      });
    }
  }

  // I-55 (RM-008): a licao dos POSTMORTEMs em disco volta no GOAL e no PLAN, em qualquer regime.
  // E um item so, agregado: o que mais bloqueou, o que mais fechou thread e as notas baixas. No
  // GOAL ela so entra quando o OrkMind nao trouxe licao, para o prompt nao repetir a mesma thread.
  if (fase === 'PLAN' || (fase === 'GOAL' && licoes === 0)) {
    const texto = textoDasLicoes(resumoDasLicoes(carregado.raiz, thread.id));
    if (texto) {
      licoes += 1;
      add({
        colecao: 'learning',
        titulo: 'Licoes das threads fechadas deste produto (POSTMORTEM e MASTER)',
        conteudo: texto,
        origem: 'postmortem',
        location: '.orkastery/threads/*/POSTMORTEM.json',
        mandatory: false,
      });
    }
  }

  // 3. Regras `mandatory` do ecossistema: elas sempre voltam quando as tags casam, em
  // qualquer fase. O `ork` nunca as cria; ele apenas as respeita.
  let regras = 0;
  if (memoria.ativo) {
    for (const e of regrasDoProjeto(memoria, manifesto)) {
      if (!e.mandatory) continue;
      regras += 1;
      add({
        colecao: 'rule',
        titulo: `Regra mandatoria: ${primeiraLinha(e.content).slice(0, 70)}`,
        conteudo: e.content,
        origem: 'orkmind',
        location: enderecoDeMemoria('rule', e.id),
        mandatory: true,
      });
    }
  }

  return {
    regime: memoria.regime,
    fase,
    thread: thread.id,
    itens,
    decisoes,
    licoes,
    regras,
    texto: textoDaInjecao(itens, memoria.regime),
  };
}

/**
 * O texto exato que vai para `{{memoria_injetada}}` no template da fase.
 *
 * Vazio quando nao ha item: a linha da variavel some do prompt e o texto fica byte a byte
 * igual ao que o B4 ja despachava. Uma thread sem decisao fechada nao ganha secao vazia.
 */
export function textoDaInjecao(itens: ItemDeInjecao[], regime: RegimeDeMemoria): string {
  if (itens.length === 0) return '';
  const linhas: string[] = [];
  linhas.push('');
  linhas.push(`## Memoria injetada (regime ${regime})`);
  linhas.push(
    'Recuperacao deterministica por tag. Todo item declara de onde veio: nada entra neste ' +
      'prompt sem proveniencia. O que NAO esta aqui esta nos ponteiros do handoff, ' +
      'recuperavel por `ork recall`.'
  );
  const porColecao: Record<string, ItemDeInjecao[]> = {};
  for (const i of itens) (porColecao[i.colecao] ??= []).push(i);
  const rotulos: Record<string, string> = {
    decision: 'Decisoes fechadas desta thread (entram em TODA fase)',
    learning: 'Licoes de threads anteriores deste produto',
    rule: 'Regras mandatorias do ecossistema',
    handoff: 'Handoffs anteriores',
    roadmap: 'Roadmap',
  };
  for (const colecao of ['decision', 'learning', 'rule', 'handoff', 'roadmap']) {
    const doGrupo = porColecao[colecao];
    if (!doGrupo || doGrupo.length === 0) continue;
    linhas.push('');
    linhas.push(`### ${rotulos[colecao] ?? colecao} (${doGrupo.length})`);
    for (const i of doGrupo) {
      linhas.push(`- ${i.titulo}${i.mandatory ? ' [MANDATORY]' : ''}`);
      for (const l of i.conteudo.split('\n')) {
        if (l.trim() !== '') linhas.push(`  ${l}`);
      }
      linhas.push(`  origem: ${i.location}`);
    }
  }
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// `ork memory sync`: publicar de uma vez o que a thread ja fechou.
// ---------------------------------------------------------------------------

/** O que `ork memory sync` gravou, colecao por colecao. */
export interface ResultadoDoSync {
  perfil?: PerfilPublicacao;
  colecoesForaDoPerfil?: string[];
  publicacao?: { estado: 'ativa' | 'pendente'; motivo: string };
  humanos: ResultadoDeMemoriaHumana;
  regime: RegimeDeMemoria;
  estado: EstadoDaMemoria;
  thread: string | null;
  decisoes: ResultadoDaSincronizacao;
  policies: ResultadoDaSincronizacao;
  handoff: ResultadoDeGravacao | null;
  learning: ResultadoDeGravacao | null;
  roadmap: ResultadoDeGravacao | null;
  total: number;
  falhas: number;
}

/** Caminho relativo do handoff da thread, o mesmo endereco que vai no ponteiro. */
export function caminhoRelativoDoHandoff(raiz: string, threadId: string): string {
  const abs = `${dirThread(raiz, threadId)}/handoff.json`;
  return abs.startsWith(raiz) ? abs.slice(raiz.length + 1) : abs;
}

/**
 * `ork memory sync`: publica na memoria semantica o que a thread ja fechou.
 *
 * Idempotente por construcao: o driver grava com `--dedupe`, entao rodar o sync duas
 * vezes nao duplica decisao nem licao. Em regime `files` ele nao falha: ele relata que
 * nada foi para a memoria semantica, e por que.
 */
export function sincronizarMemoria(
  carregado: ManifestoCarregado,
  memoria: Memoria,
  threadId: string | null,
  origem?: { tipo: 'pedido' | 'achado'; referencia: string; detalhe: string },
  perfil: PerfilPublicacao = 'integral'
): ResultadoDoSync {
  carregado = memoryState(carregado).loaded;
  const { raiz, manifesto } = carregado;
  if (!['fabrica','integral'].includes(perfil) || (perfil === 'fabrica' && !threadId)) throw Error('memory.publication.profile-invalid');
  const vazio: ResultadoDaSincronizacao = juntar([], memoria.regime);
  let decisoes = vazio;
  let handoff: ResultadoDeGravacao | null = null;
  let learning: ResultadoDeGravacao | null = null;
  let roadmap: ResultadoDeGravacao | null = null;

  if (threadId) {
    validarDiretorioDeThread(raiz, threadId);
    const autorizada = lerThread(raiz, threadId);
    if (autorizada.projeto.name !== manifesto.project.name) throw new Error('memory.tenant.mismatch');
  }
  const policies = perfil === 'integral' ? gravarPolicies(memoria, manifesto)
    : { ...vazio, detalhe: 'fora do perfil fabrica: rules exigem sync integral; nenhuma tentativa feita' };
  const humanos = threadId ? publicarGatesHumanos(carregado, memoria, threadId)
    : { inventario: [], resultados: [], elegiveis: 0, excluidos: 0, falhas: 0 };

  if (threadId) {
    const thread = lerThread(raiz, threadId);
    decisoes = gravarDecisoes(memoria, manifesto, thread);
    if (perfil === 'integral') roadmap = gravarOrigemDaThread(
      memoria,
      manifesto,
      thread,
      origem ?? {
        tipo: 'pedido',
        referencia: '',
        detalhe: `Thread aberta no modo ${tagDoModo(thread.modo)} para "${thread.nome}".`,
      }
    );

    const caminhoDoHandoff = path.join(dirThread(raiz, threadId), 'handoff.json');
    if (fs.existsSync(caminhoDoHandoff)) {
      const pacote = lerJson<Handoff>(caminhoDoHandoff);
      handoff = gravarHandoff(
        memoria,
        manifesto,
        thread,
        pacote,
        caminhoRelativoDoHandoff(raiz, threadId)
      );
    }

    // A licao so existe depois do MASTER: sem score humano nao ha o que ensinar a
    // proxima thread, e inventar licao de thread aberta e self-report.
    const caminhoDoPostmortem = caminhoPostmortem(raiz, threadId);
    const master = perfil === 'integral' ? lerMasterLog(raiz, threadId) : null;
    if (master && fs.existsSync(caminhoDoPostmortem)) {
      const postmortem = lerJson<Postmortem>(caminhoDoPostmortem);
      learning = gravarLearning(memoria, manifesto, thread, postmortem, master);
    }
  }

  const unitarios = [handoff, learning, roadmap].filter((g): g is ResultadoDeGravacao => g !== null);
  const total = decisoes.gravadas.length + policies.gravadas.length + unitarios.length + humanos.resultados.length;
  const falhas =
    decisoes.falhas + policies.falhas + unitarios.filter((g) => !g.ok).length + humanos.falhas;
  return {
    regime: memoria.regime,
    estado: memoria.estado,
    thread: threadId,
    perfil,
    colecoesForaDoPerfil: perfil === 'fabrica' ? ['rule','learning','roadmap'] : [],
    humanos,
    decisoes,
    policies,
    handoff,
    learning,
    roadmap,
    total,
    falhas,
  };
}

/**
 * Gancho unico de publicacao usado pelos comandos do CLI.
 *
 * Ele existe para que `thread new`, `master` e `audit` chamem UMA linha cada, e para que
 * nenhum deles precise saber se ha OrkMind ligado: em regime `files` a funcao devolve o
 * resultado dizendo que nada foi gravado, e o comando segue igual.
 */
export function publicar(
  carregado: ManifestoCarregado,
  threadId: string | null,
  origem?: { tipo: 'pedido' | 'achado'; referencia: string; detalhe: string },
  memoriaAberta?: Memoria
): ResultadoDoSync {
  carregado = memoryState(carregado).loaded;
  if (threadId) validarDiretorioDeThread(carregado.raiz, threadId);
  let perfil: PerfilPublicacao = 'integral', motivo: string | null = null;
  if (!memoriaAberta && carregado.manifesto.memory.mode === 'orkmind') {
    try { perfil = exigirAtivacao(carregado, threadId ?? '', 'memory').perfil; }
    catch (e) { motivo = e instanceof Error && /^(write\.activation|scope\.|memory\.tenant)/.test(e.message) ? e.message : 'write.activation.invalid'; }
  }
  const memoria = memoriaAberta ?? abrirMemoria(carregado);
  if (motivo && memoria.ativo) {
    const vazio = { ...juntar([], memoria.regime), detalhe: motivo };
    return { regime: memoria.regime, estado: memoria.estado, thread: threadId, perfil,
      publicacao: { estado: 'pendente', motivo }, humanos: { inventario: [], resultados: [], elegiveis: 0, excluidos: 0, falhas: 0 },
      decisoes: vazio, policies: vazio, handoff: null, learning: null, roadmap: null, total: 0, falhas: 1 };
  }
  const r = sincronizarMemoria(carregado, memoria, threadId, origem, perfil);
  // O driver files apenas relata tentativas recusadas; conserva a degradacao publicada.
  if (motivo) r.publicacao = { estado: 'pendente', motivo };
  if (threadId && memoria.ativo) {
    registrar(dirThread(carregado.raiz, threadId), threadId, TIPOS_DE_EVENTO.memoriaGravada, {
      origem: origem?.tipo ?? 'sync',
      regime: memoria.regime,
      tenant: memoria.estado.tenant,
      decisoes: r.decisoes.gravadas.length,
      policies: r.policies.gravadas.length,
      humanGates: r.humanos.elegiveis,
      handoff: r.handoff?.id ?? null,
      learning: r.learning?.id ?? null,
      roadmap: r.roadmap?.id ?? null,
      falhas: r.falhas,
    });
  }
  return r;
}

/**
 * Publica as propostas de achados de auditoria na colecao `roadmap`.
 *
 * O mesmo bloco obrigatorio do B5 (impacto, fix, estimativa, passo irreversivel) sai do
 * board em arquivo e chega ao roadmap do produto pela memoria, quando ela esta ligada.
 */
export function publicarPropostas(
  carregado: ManifestoCarregado,
  achados: Achado[],
  memoriaAberta?: Memoria
): ResultadoDaSincronizacao {
  carregado = memoryState(carregado).loaded;
  const memoria = memoriaAberta ?? abrirMemoria(carregado);
  // Propostas globais nao herdam uma autorizacao de thread por conveniencia.
  if (!memoriaAberta && carregado.manifesto.memory.mode === 'orkmind') return juntar(achados.map(() => ({
    ok: false, id: null, duplicada: false, collection: 'roadmap', detalhe: 'write.activation.operator-required' })), memoria.regime);
  const resultados = achados.map((a) => gravarPropostaDeAuditoria(memoria, carregado.manifesto, a));
  return juntar(resultados, memoria.regime);
}

/** Texto de `ork memory status`. */
export function textoDoEstado(estado: EstadoDaMemoria): string {
  const linhas: string[] = [];
  linhas.push('Regime de memoria do projeto');
  linhas.push('');
  linhas.push(`  pedido no manifesto   ${estado.pedido}`);
  linhas.push(`  regime efetivo        ${estado.efetivo}`);
  linhas.push(`  tenant                ${estado.tenant}`);
  linhas.push(`  variavel da base      ${estado.variavel || '(nao declarada)'}`);
  linhas.push(`  DSN no ambiente       ${estado.dsnPresente ? 'sim (valor nunca impresso)' : 'nao'}`);
  linhas.push(`  cli do OrkMind        ${estado.cli}`);
  linhas.push('');
  if (estado.motivo) {
    linhas.push(`  degradacao: ${estado.motivo}`);
    linhas.push(`    ${estado.detalhe}`);
    linhas.push(`    correcao: ${estado.correcao}`);
    linhas.push('');
    linhas.push(
      '  O ciclo NAO para por isso: em regime files o handoff continua triado em 3 niveis,'
    );
    linhas.push('  os ponteiros continuam `path#ancora` e `ork recall` continua resolvendo.');
  } else {
    linhas.push(`  ${estado.detalhe}`);
    linhas.push('');
    linhas.push(`  colecoes gravadas: ${COLECOES_DO_ORK.join(', ')}`);
    linhas.push('  governanca: source=agent; decision/human exige human_gate comprovado; mandatory=false e regra nunca critical.');
  }
  if (estado.embeddings) linhas.push('', ...textoDosEmbeddings(estado.embeddings));
  return linhas.join('\n');
}

/** Secao de embeddings do `ork memory status` (I-38 D6): nome da variavel, nunca o valor. */
export function textoDosEmbeddings(e: EstadoDeEmbeddings): string[] {
  const linhas = ['Busca por significado (embeddings, nao deterministica; o recall por tag nao muda)', ''];
  linhas.push(`  provider              ${e.configurado ? `${e.provider} ${e.modelo} (${e.dim} dim)` : 'none (desligada)'}`);
  if (e.configurado) {
    linhas.push(`  chave                 ${e.variavelDaChave} ${e.chavePresente ? 'presente' : 'ausente'} no ambiente (valor nunca impresso)`);
    linhas.push(`  fallback local        ${e.fallback.modelo ? `${e.fallback.modelo}: ${e.fallback.presente ? `no cache (${e.fallback.dim} dim)` : 'ausente do cache'}, ` +
      `dependencias ${e.fallback.dependencias ? 'ok' : e.sondado ? 'ausentes' : 'nao sondadas'}` : '(nao declarado)'}`);
    linhas.push(`  caminho ativo         ${e.ativo}${e.sondado ? '' : ' (ponte nao sondada)'}`);
  }
  if (e.universo) {
    const colecoes = Object.entries(e.universo.porColecao).map(([c, n]) => `${c} ${n}`).join(', ');
    linhas.push(`  universo da busca     ${e.entradas} entrada(s) do tenant: ${colecoes}`);
    linhas.push(`  fora da busca         ${textoForaDaBusca(e.universo.foraDaBusca)}`);
  } else if (e.falhaDoUniverso) {
    linhas.push(`  universo da busca     nao lido (${e.falhaDoUniverso}); cobertura nao calculada`);
  }
  for (const i of e.indices) {
    linhas.push(`  indice                ${i.modelo} / ${i.dim} dim: ${i.vetores} vetor(es), ${i.coerentes ?? '?'} coerente(s), ${i.desatualizados ?? '?'} desatualizado(s)`);
  }
  if (e.entradas !== null) {
    linhas.push(`  cobertura             ${e.cobertura === null ? '-' : `${Math.round(e.cobertura * 1000) / 10}%`} de ${e.entradas} entrada(s) do universo da busca`);
  }
  if (e.aviso) linhas.push(`  aviso                 ${e.aviso}`);
  if (e.sonda) {
    linhas.push(`  sonda                 ${e.sonda.ok ? `${e.sonda.alvo} respondeu em ${e.sonda.latenciaMs} ms` : `sem resposta (${e.sonda.motivo ?? 'sem caminho ativo'})`}`);
  }
  if (e.motivo) {
    linhas.push(`  motivo                ${e.motivo}`);
    linhas.push(`    ${e.detalhe}`);
    linhas.push(`    correcao: ${e.correcao}`);
  } else linhas.push(`  ${e.detalhe}`);
  return linhas;
}

/** Texto de `ork memory sync`. */
export function textoDoSync(r: ResultadoDoSync): string {
  const linhas: string[] = [];
  linhas.push(`Sincronizacao de memoria (regime ${r.regime})${r.thread ? ` da thread ${r.thread}` : ''}`);
  linhas.push(`Perfil: ${r.perfil ?? 'integral'}; fora do perfil: ${(r.colecoesForaDoPerfil ?? []).join(', ') || '(nenhuma)'}`);
  if (r.publicacao?.estado === 'pendente') linhas.push(`Publicacao pendente: ${r.publicacao.motivo}`);
  linhas.push('');
  const linha = (nome: string, s: ResultadoDaSincronizacao): void => {
    linhas.push(
      `  ${nome.padEnd(10)} ${s.gravadas.length} entrada(s): ${s.detalhe}`
    );
  };
  linha('decision', r.decisoes);
  linha('rule', r.policies);
  linhas.push(`  human_gate ${r.humanos.elegiveis} elegiveis, ${r.humanos.excluidos} excluidos, ${r.humanos.falhas} falhas`);
  const um = (nome: string, g: ResultadoDeGravacao | null): void => {
    linhas.push(
      `  ${nome.padEnd(10)} ${g ? (g.ok ? `${g.duplicada ? 'ja existente' : 'gravado'} (${g.id})` : `nao gravado: ${g.detalhe}`) : '(nada a gravar)'}`
    );
  };
  um('handoff', r.handoff);
  um('learning', r.learning);
  um('roadmap', r.roadmap);
  linhas.push('');
  linhas.push(`  total ${r.total} tentativa(s), ${r.falhas} sem gravacao`);
  if (r.regime === 'files') {
    linhas.push('');
    linhas.push(`  ${r.estado.detalhe}`);
    linhas.push(`  correcao: ${r.estado.correcao}`);
  }
  return linhas.join('\n');
}

/** Prioridade valida a partir de texto livre, com o padrao do OrkMind. */
export function parsePrioridade(bruto: string | undefined): PrioridadeDeMemoria | null {
  const validas: PrioridadeDeMemoria[] = ['critical', 'high', 'medium', 'low'];
  if (!bruto) return 'medium';
  const limpo = bruto.trim().toLowerCase() as PrioridadeDeMemoria;
  return validas.includes(limpo) ? limpo : null;
}

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
import {
  TIPOS_DE_ARESTA, canonico, compararUtf8, type Aresta, type EntradaDoManifesto, type GrafoCodigo, type TipoDeAresta,
} from './intelligence-graph-contract';
import {
  chaveDoIndice, concessaoLocal, construirIndice, estadoDosIndices, indiceDoHead, lerIndice, limparIndices, perfilDoIndice,
  type ContextoDoIndice, type PerfilDoIndice, type ResultadoDaConstrucao,
} from './intelligence-graph-index';
import { carregarAnalisadores, versoesDosAnalisadores, type VersoesDosAnalisadores } from './intelligence-graph-parsers';
import {
  CONSULTA_SCHEMA, ErroDeConsulta, TEXTOS_DA_CONSULTA, TUDO_IGUAL, caminho, chamadores, filtrarGrafo, importadores, jsonDaResposta, prepararConsulta,
  textoDaResposta, vizinhos, type CabecalhoDoIndice, type RespostaDeConsulta, type Sentido, type SituacaoDaFonte, type SituacaoNaArvore,
  type TextosDaConsulta,
} from './intelligence-graph-query';
import { headsDasArvores, revisaoDaArvore } from './intelligence-graph-repo';
import { CONTEXTO_SCHEMA, pacoteDeContexto, type EntradaDoContexto } from './intelligence-graph-contexto';

export const STATUS_SCHEMA = 'ork.code-graph-index-status/v0' as const;

/** As versoes dos analisadores como o `ork grafo status` e o `ork doctor` as mostram. */
export function descreverVersoes(v: VersoesDosAnalisadores): string {
  return Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ');
}

/** O prefixo das recusas dos analisadores (`intelligence-graph-parsers.ts`). */
const RECUSA_DOS_ANALISADORES = 'grafo.parser.indisponivel';

/**
 * RM-031 (pacote do npm): o que fazer quando os analisadores nao carregam, dito pelo `ork doctor` e
 * pelo `ork grafo status`. O micromark e so ESM e carrega por `require`, o que o Node so faz sem flag
 * a partir de 20.19 e de 22.12. Nos outros casos o pacote falta ou esta fora da instalacao do `ork`,
 * e a instalacao global do npm traz os analisadores, que sao dependencias do pacote. Mora aqui, fora
 * de `MODULOS_DO_EXTRATOR`, para a redacao nao entrar na chave do indice; a versao vem de quem chama
 * (o `index.ts`), porque o CLI do grafo so importa a propria familia (fronteira do KG3).
 */
export function correcaoDosAnalisadores(motivo: string, versao?: string,
  redacao: RedacaoDosAnalisadores = REDACAO_DOS_ANALISADORES): string {
  if (/ERR_REQUIRE_ESM/.test(motivo)) return redacao.soEsm(process.version);
  // Sem a versao do pacote (`0.0.0-desconhecida` quando o package.json dele nao e achado), o comando
  // sai sem `@<versao>` e o npm instala a ultima publicada.
  const fixada = versao && /^\d+\.\d+\.\d+/.test(versao) && !versao.startsWith('0.0.0') ? `@${versao}` : '';
  return redacao.reinstale(fixada);
}

/**
 * RM-061 (F2a): a redacao do check e da correcao. A familia do grafo nao importa o catalogo de mensagens
 * (fronteira do KG3): o pt-BR mora aqui, para o `ork grafo status`, e o doctor passa a do catalogo, no
 * locale do comando. Um teste confere que o pt-BR do catalogo e este.
 */
export interface RedacaoDosAnalisadores {
  recusa: (motivo: string) => string;
  soEsm: (versaoDoNode: string) => string;
  reinstale: (fixada: string) => string;
}

export const REDACAO_DOS_ANALISADORES: RedacaoDosAnalisadores = {
  recusa: (motivo) => `${motivo}: o ork grafo indexar recusa nesta instalacao, e sem o indice as consultas e as tools ork_grafo_* tambem`,
  soEsm: (versaoDoNode) => `o micromark e so ESM, e este Node (${versaoDoNode}) nao o carrega por require: use Node 20.19, 22.12 ou mais novo, ` +
    'sem a opcao --no-experimental-require-module (na linha de comando ou no NODE_OPTIONS)',
  reinstale: (fixada) => `reinstale o ork global, que traz os analisadores como dependencias: npm install -g @orkastery/cli${fixada}` +
    ' (instalado dentro de um projeto ou pelo npx, o npm deixa os analisadores fora do pacote do ork, e o grafo os recusa)',
};

/** O check do `ork doctor`, na forma do `Check` do nucleo (`types.ts`, que o CLI do grafo nao importa). */
export interface CheckDosAnalisadores { nome: string; nivel: 'ok' | 'warn'; detalhe: string; correcao?: string }

/**
 * RM-031 (pacote do npm): o check "analisadores do grafo" do `ork doctor`. Carrega o que o
 * `ork grafo indexar` carrega (`carregarAnalisadores`), entao diz o que o indexar faria, inclusive no
 * Node sem `require` de ESM. A falta e `warn`, com a correcao: o grafo nao e condicao do despacho de
 * fase. Fora da familia do grafo so o `index.ts` e o worker do MCP a abrem (fronteira do KG1), entao o
 * `index.ts` passa este check ao doctor, que nao importa o grafo.
 */
export function checarAnalisadoresDoGrafo(versao?: string, carregar: () => unknown = carregarAnalisadores,
  versoes: () => VersoesDosAnalisadores = versoesDosAnalisadores,
  redacao: RedacaoDosAnalisadores = REDACAO_DOS_ANALISADORES): CheckDosAnalisadores {
  const nome = 'analisadores do grafo';
  try {
    carregar();
    return { nome, nivel: 'ok', detalhe: descreverVersoes(versoes()) };
  } catch (e) {
    const motivo = (e as Error).message;
    return { nome, nivel: 'warn', detalhe: redacao.recusa(motivo), correcao: correcaoDosAnalisadores(motivo, versao, redacao) };
  }
}
/** O mesmo schema da amostra do KG2: as amostras auditadas continuam validas. */
export const AMOSTRA_SCHEMA = 'ork.graph-edge-audit-sample/v0' as const;

export const USO_DO_GRAFO = [
  'uso: ork grafo indexar [--verificar] [--forcar] [--json]',
  '     ork grafo status [--json]',
  '     ork grafo contexto <thread> [--json [--teto-bytes N]]',
  '     ork grafo vizinhos <no> [--profundidade N] [--sentido entrada|saida|ambos] [--tipo T,...] [--limite N] [--json [--teto-bytes N]]',
  '     ork grafo chamadores <simbolo> [--profundidade N] [--limite N] [--json [--teto-bytes N]]',
  '     ork grafo importadores <arquivo|simbolo> [--profundidade N] [--limite N] [--json [--teto-bytes N]]',
  '     ork grafo caminho <de> <para> [--sentido saida|entrada|ambos] [--tipo T,...] [--json [--teto-bytes N]]',
  '     ork grafo amostra [--por-estrato N] | ork grafo amostra --conferir ARQ [--json]',
  '     ork grafo limpar [--tudo] [--json]',
].join('\n');

/**
 * RM-061 (F3d, GO-FIX 1): a redacao humana do `ork grafo`. A familia do grafo nao importa o catalogo de mensagens
 * (fronteira do KG3): o pt-BR mora aqui e na consulta (`TEXTOS_DA_CONSULTA`), e o `index.ts` passa a do catalogo
 * (`msg().grafo`), no locale do comando, em `ContextoDoCli.textos`. Um teste confere que o pt-BR do catalogo e este.
 */
export interface TextosDoGrafo {
  uso: readonly string[];
  erroUso: (motivo: string) => string;
  erroTipado: (mensagem: string) => string;
  motivos: {
    semSub: string; desconhecido: (sub: string) => string; repetida: (nome: string) => string; semValor: (nome: string) => string;
    exigeValor: (nome: string) => string; opcao: (sub: string, valor: string) => string;
    argumentos: (sub: string, esperados: number, recebidos: number) => string; inteiro: (nome: string) => string;
    tipo: (tipo: string, lista: string) => string; sentido: (valor: string) => string; tetoJson: string; tetoMin: string;
    amostraExclusiva: string; estratoMin: string;
  };
  indexar: {
    titulo: (repositorio: string, estado: string) => string;
    campo: (nome: string, valor: string) => string;
    campos: Record<'revisao' | 'chave' | 'snapshot' | 'digest' | 'conferencia' | 'nos' | 'arestas' | 'lugar' | 'motivo' | 'tempo', string>;
    conferencia: (fontes: number, evidencias: number) => string;
    determinismo: (ordem: string, digest: string, relatorio: string, unidades: string, igual: boolean) => string;
    incremental: (base: string, igual: boolean) => string;
    naoConferido: (motivo: string) => string;
    aprovado: string;
    semBase: string;
    extracao: {
      lista: (itens: readonly string[]) => string;
      incremental: (base: string, alterados: number, novos: number, removidos: number) => string;
      tsInteiro: (motivo: string | null) => string;
      tsParcial: (reextraidos: number, lista: string, programa: number, reaproveitados: number) => string;
      tsBase: (reaproveitados: number) => string;
      markdown: (reextraidos: number, lista: string, reaproveitados: number) => string;
      completa: (motivo: string | null) => string;
    };
  };
  status: {
    titulo: (head: string, arvore: string) => string; indice: (chave: string, estado: string) => string; ausente: string;
    semAnalisadores: string; semChave: string; analisadores: (versoes: string) => string; correcao: (correcao: string) => string;
    pasta: (dir: string, indices: number, tamanho: string) => string; semCommit: string; indisponivel: string; naoCriada: string;
    sobras: (sobras: string) => string;
  };
  contexto: {
    titulo: (thread: string, revisao: string) => string;
    resumo: (sementes: number, total: number, arestas: number, ligacoes: number, bytes: number) => string;
    tamanho: (bytes: number) => string; diff: (diff: string) => string; mudadas: (n: number) => string;
    final: (truncado: boolean, arvore: string) => string;
  };
  amostra: {
    titulo: (arestas: number, estratos: number, revisao: string | null) => string; vereditos: (vereditos: string) => string;
    conferidas: (ok: number, total: number) => string; falha: (falha: string) => string; reprovado: (n: number) => string;
    aprovado: string;
  };
  limpar: (removidos: number, tamanho: string) => string;
  consulta: TextosDaConsulta;
}

export const TEXTOS_DO_GRAFO: TextosDoGrafo = {
  uso: USO_DO_GRAFO.split('\n'),
  erroUso: (motivo) => `grafo.uso: ${motivo}`,
  erroTipado: (mensagem) => mensagem,
  motivos: {
    semSub: 'falta o subcomando', desconhecido: (sub) => `subcomando desconhecido: ${sub}`,
    repetida: (nome) => `--${nome} repetida`, semValor: (nome) => `--${nome} nao leva valor`,
    exigeValor: (nome) => `--${nome} exige valor`, opcao: (sub, valor) => `opcao desconhecida para ${sub}: ${valor}`,
    argumentos: (sub, esperados, recebidos) => `${sub} pede ${esperados} argumento(s), veio ${recebidos}`,
    inteiro: (nome) => `--${nome} precisa ser inteiro`, tipo: (tipo, lista) => `--tipo desconhecido: ${tipo} (use ${lista})`,
    sentido: (valor) => `--sentido desconhecido: ${valor}`, tetoJson: '--teto-bytes exige --json', tetoMin: '--teto-bytes precisa ser ao menos 1',
    amostraExclusiva: '--conferir e --por-estrato nao combinam', estratoMin: '--por-estrato precisa ser ao menos 1',
  },
  indexar: {
    titulo: (repositorio, estado) => `indice do grafo de ${repositorio}: ${estado}`,
    // O rotulo ocupa 13 colunas antes do valor, como na base: 12 do nome e um espaco.
    campo: (nome, valor) => `  ${nome.padEnd(12)} ${valor}`,
    campos: { revisao: 'revisao', chave: 'chave', snapshot: 'snapshot', digest: 'digest', conferencia: 'conferencia',
      nos: 'nos', arestas: 'arestas', lugar: 'lugar', motivo: 'motivo', tempo: 'tempo' },
    conferencia: (fontes, evidencias) => `conferirFontes verificada: ${fontes} fontes e ${evidencias} evidencias contra os bytes`,
    determinismo: (ordem, digest, relatorio, unidades, igual) =>
      `  determinismo ${ordem}: digest ${digest}, relatorio ${relatorio}, unidades ${unidades}, ${igual ? 'igual' : 'DIFERENTE'}`,
    incremental: (base, igual) => `  incremental  a partir do indice de ${base}: ${igual ? 'igual a completa nos quatro arquivos' : 'DIFERENTE'}`,
    naoConferido: (motivo) => `  incremental  nao conferido: ${motivo}`,
    aprovado: 'aprovado',
    semBase: 'sem base',
    extracao: {
      lista: (itens) => itens.length ? ` (${itens.slice(0, 5).join(', ')}${itens.length > 5 ? ` e mais ${itens.length - 5}` : ''})` : '',
      incremental: (base, alterados, novos, removidos) =>
        `  extracao     incremental a partir do indice de ${base}: ${alterados} alterado(s), ${novos} novo(s), ${removidos} removido(s)`,
      tsInteiro: (motivo) => `TypeScript inteiro (${motivo ?? ''})`,
      tsParcial: (reextraidos, lista, programa, reaproveitados) =>
        `TypeScript parcial, ${reextraidos} reextraido(s)${lista} num programa de ${programa}, ${reaproveitados} da base`,
      tsBase: (reaproveitados) => `TypeScript todo da base (${reaproveitados})`,
      markdown: (reextraidos, lista, reaproveitados) =>
        `               Markdown: ${reextraidos} reextraido(s)${lista}, ${reaproveitados} da base`,
      completa: (motivo) => `  extracao     completa${motivo ? `: ${motivo}` : ''}`,
    },
  },
  status: {
    titulo: (head, arvore) => `grafo: HEAD ${head}, arvore ${arvore}`,
    indice: (chave, estado) => `  indice do HEAD  ${chave} ${estado}`,
    ausente: '(ausente: rode ork grafo indexar)',
    semAnalisadores: '(sem os analisadores nesta instalacao, nem a consulta nem o indexar rodam)',
    semChave: '(sem a chave do indice: o erro esta na linha de baixo)',
    analisadores: (versoes) => `  analisadores    ${versoes}`,
    correcao: (correcao) => `  correcao        ${correcao}`,
    pasta: (dir, indices, tamanho) => `  pasta           ${dir} (${indices} indice(s), ${tamanho})`,
    semCommit: 'sem commit', indisponivel: 'indisponivel', naoCriada: 'ainda nao criada',
    sobras: (sobras) => `  sobras          ${sobras}`,
  },
  contexto: {
    titulo: (thread, revisao) => `Contexto ${thread} @ ${revisao}`,
    resumo: (sementes, total, arestas, ligacoes, bytes) =>
      `  ${sementes}/${total} sementes, ${arestas}/${ligacoes} ligacoes agregadas; ${bytes} bytes JSON`,
    tamanho: (bytes) => `  tamanho dos arquivos no pacote (nao descoberta): ${bytes} bytes (revisao indexada); tokens: unavailable`,
    diff: (diff) => `  diff: ${diff}`,
    mudadas: (n) => `  ligacoes com fonte modificada na arvore: ${n}`,
    final: (truncado, arvore) => `  truncado: ${truncado}; arvore: ${arvore}; use --json para nos e evidencias`,
  },
  amostra: {
    titulo: (arestas, estratos, revisao) => `amostra: ${arestas} arestas em ${estratos} estratos, auditada na revisao ${revisao}`,
    vereditos: (vereditos) => `  vereditos ${vereditos}`,
    conferidas: (ok, total) => `  conferidas contra o indice do HEAD: ${ok} de ${total}`,
    falha: (falha) => `FALHA ${falha}`,
    reprovado: (n) => `reprovado: ${n} falha(s)`,
    aprovado: 'aprovado',
  },
  limpar: (removidos, tamanho) => `grafo limpar: ${removidos} removido(s), ${tamanho}`,
  consulta: TEXTOS_DA_CONSULTA,
};

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
  /** A borda le a thread; a familia do grafo nao importa o estado nem o servidor. */
  contextoDaThread?: (id: string) => { raiz: string; head: string; entrada: EntradaDoContexto };
  /** RM-031: a versao do `ork` que roda, para a correcao do `status` sem os analisadores (o `index.ts` passa). */
  versao?: string;
  /** RM-061 (F3d): a redacao humana no locale do comando (o `index.ts` passa a do catalogo); sem ela, o pt-BR da familia. */
  textos?: TextosDoGrafo;
  escrever: (texto: string) => void;
}

const textosDe = (ctx: ContextoDoCli): TextosDoGrafo => ctx.textos ?? TEXTOS_DO_GRAFO;

interface Especificacao { posicionais: number; bandeiras: readonly string[]; valores: readonly string[] }
const SUBCOMANDOS: Readonly<Record<string, Especificacao>> = Object.freeze({
  indexar: { posicionais: 0, bandeiras: ['verificar', 'forcar', 'json'], valores: [] },
  status: { posicionais: 0, bandeiras: ['json'], valores: [] },
  contexto: { posicionais: 1, bandeiras: ['json'], valores: ['teto-bytes'] },
  vizinhos: { posicionais: 1, bandeiras: ['json'], valores: ['profundidade', 'sentido', 'tipo', 'limite', 'teto-bytes'] },
  chamadores: { posicionais: 1, bandeiras: ['json'], valores: ['profundidade', 'limite', 'teto-bytes'] },
  importadores: { posicionais: 1, bandeiras: ['json'], valores: ['profundidade', 'limite', 'teto-bytes'] },
  caminho: { posicionais: 2, bandeiras: ['json'], valores: ['sentido', 'tipo', 'teto-bytes'] },
  amostra: { posicionais: 0, bandeiras: ['json'], valores: ['por-estrato', 'conferir'] },
  limpar: { posicionais: 0, bandeiras: ['tudo', 'json'], valores: [] },
});

interface Pedido { sub: string; posicionais: string[]; bandeiras: Set<string>; valores: Map<string, string> }

function uso(motivo: string, t: TextosDoGrafo): never {
  throw new Error(`${t.erroUso(motivo)}\n${t.uso.join('\n')}`);
}

export function lerPedido(argv: readonly string[], t: TextosDoGrafo = TEXTOS_DO_GRAFO): Pedido {
  const [sub, ...resto] = argv;
  if (!sub) uso(t.motivos.semSub, t);
  const esp = SUBCOMANDOS[sub];
  if (!Object.prototype.hasOwnProperty.call(SUBCOMANDOS, sub) || !esp) uso(t.motivos.desconhecido(sub), t);
  const posicionais: string[] = [], bandeiras = new Set<string>(), valores = new Map<string, string>();
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (!a.startsWith('--')) {
      posicionais.push(a);
      continue;
    }
    const igual = a.indexOf('=');
    const nome = igual > 0 ? a.slice(2, igual) : a.slice(2);
    if (bandeiras.has(nome) || valores.has(nome)) uso(t.motivos.repetida(nome), t);
    if (esp.bandeiras.includes(nome)) {
      if (igual > 0) uso(t.motivos.semValor(nome), t);
      bandeiras.add(nome);
    } else if (esp.valores.includes(nome)) {
      const valor = igual > 0 ? a.slice(igual + 1) : resto[++i];
      if (valor === undefined || valor === '' || (igual < 0 && valor.startsWith('--'))) uso(t.motivos.exigeValor(nome), t);
      valores.set(nome, valor);
    } else {
      uso(t.motivos.opcao(sub, a), t);
    }
  }
  if (posicionais.length !== esp.posicionais) uso(t.motivos.argumentos(sub, esp.posicionais, posicionais.length), t);
  return { sub, posicionais, bandeiras, valores };
}

function inteiro(p: Pedido, nome: string, t: TextosDoGrafo): number | undefined {
  const v = p.valores.get(nome);
  if (v === undefined) return undefined;
  if (!/^[0-9]{1,6}$/.test(v)) uso(t.motivos.inteiro(nome), t);
  return Number(v);
}

function tipos(p: Pedido, t: TextosDoGrafo): TipoDeAresta[] | undefined {
  const v = p.valores.get('tipo');
  if (v === undefined) return undefined;
  const lista = v.split(',');
  for (const x of lista) if (!(TIPOS_DE_ARESTA as readonly string[]).includes(x)) uso(t.motivos.tipo(x, TIPOS_DE_ARESTA.join(',')), t);
  return lista as TipoDeAresta[];
}

function sentido(p: Pedido, t: TextosDoGrafo): Sentido | undefined {
  const v = p.valores.get('sentido');
  if (v !== undefined && !['entrada', 'saida', 'ambos'].includes(v)) uso(t.motivos.sentido(v), t);
  return v as Sentido | undefined;
}

/** KG5 (D4): o teto vale para o JSON, que e o que vai ao contexto de quem consulta. */
function tetoDeBytes(p: Pedido, t: TextosDoGrafo): number | undefined {
  const teto = inteiro(p, 'teto-bytes', t);
  if (teto === undefined) return undefined;
  if (!p.bandeiras.has('json')) uso(t.motivos.tetoJson, t);
  if (teto < 1) uso(t.motivos.tetoMin, t);
  return teto;
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const contagem = (o: Record<string, number>): string => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ');
/** Ate cinco caminhos e quantos ficaram de fora. */
const alguns = (lista: readonly string[]): string => (lista.length ? ` (${lista.slice(0, 5).join(', ')}${lista.length > 5 ? ` e mais ${lista.length - 5}` : ''})` : '');

/** KG4: como a extracao rodou, a base e o que veio dela, ou por que foi completa. */
export function linhasDaExtracao(r: ResultadoDaConstrucao, mi: TextosDoGrafo['indexar']): string[] {
  if (r.modo === null) return [];
  const a = r.reaproveitamento;
  const me = mi.extracao;
  if (r.modo === 'incremental' && r.base && a) {
    // Desestruturado: o lint de horario le o campo de nome curto do TypeScript como instante.
    const { ts: doTs, md: doMd, mudanca } = a;
    const ts = doTs.modo === 'inteiro' ? me.tsInteiro(doTs.motivo)
      : doTs.modo === 'parcial' ? me.tsParcial(doTs.reextraidos.length, me.lista(doTs.reextraidos), doTs.programa, doTs.reaproveitados)
        : me.tsBase(doTs.reaproveitados);
    return [
      me.incremental(r.base.revision.slice(0, 12), mudanca.alterados, mudanca.novos, mudanca.removidos),
      `               ${ts}`,
      me.markdown(doMd.reextraidos.length, me.lista(doMd.reextraidos), doMd.reaproveitados),
    ];
  }
  return [me.completa(r.motivo_completo)];
}

function indexar(ctx: ContextoDoCli, p: Pedido): number {
  const r: ResultadoDaConstrucao = construirIndice(ctx, { verificar: p.bandeiras.has('verificar'), forcar: p.bandeiras.has('forcar') });
  if (p.bandeiras.has('json')) {
    ctx.escrever(JSON.stringify(r, null, 2));
    return 0;
  }
  const m = r.manifesto;
  const mi = textosDe(ctx).indexar;
  const linhas = [
    mi.titulo(m.repository_id, r.estado), mi.campo(mi.campos.revisao, m.revision), mi.campo(mi.campos.chave, r.chave),
    mi.campo(mi.campos.snapshot, m.snapshot_id), mi.campo(mi.campos.digest, m.graph_digest),
    mi.campo(mi.campos.conferencia, mi.conferencia(m.conferencia.fontes, m.conferencia.evidencias)),
    mi.campo(mi.campos.nos, contagem(m.contagens.nos)), mi.campo(mi.campos.arestas, contagem(m.contagens.arestas)),
    mi.campo(mi.campos.lugar, `${r.dir} (${mb(m.graph_bytes + m.report_bytes + m.units_bytes)})`),
    ...linhasDaExtracao(r, mi),
  ];
  if (r.motivo) linhas.push(mi.campo(mi.campos.motivo, r.motivo));
  for (const d of r.determinismo ?? []) {
    linhas.push(mi.determinismo(d.ordem, d.digest.slice(0, 16), d.relatorio.slice(0, 16), d.unidades.slice(0, 16), d.igual));
  }
  if (r.incremental) linhas.push(mi.incremental(r.incremental.base.slice(0, 12), r.incremental.igual));
  else if (r.determinismo) linhas.push(mi.naoConferido(r.motivo_completo ?? mi.semBase));
  linhas.push(mi.campo(mi.campos.tempo, `${r.ms} ms`));
  if (r.determinismo) linhas.push(mi.aprovado);
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
  // RM-031 (pacote do npm): a recusa dos analisadores vem com o que fazer, a mesma correcao do `ork doctor`.
  const correcao = erro !== null && erro.startsWith(RECUSA_DOS_ANALISADORES) ? correcaoDosAnalisadores(erro, ctx.versao) : null;
  const r = {
    schema: STATUS_SCHEMA, head: arvore.head, arvore: arvore.motivo === null ? 'limpa' : arvore.motivo, chave_do_head: chave,
    indice_do_head: indiceDoHeadEstado, analisadores, erro, correcao,
    dir: estado.dir, bytes: estado.bytes, indices: estado.indices, sobras: estado.sobras,
  };
  if (p.bandeiras.has('json')) {
    ctx.escrever(JSON.stringify(r, null, 2));
    return 0;
  }
  const ms = textosDe(ctx).status;
  const linhas = [
    ms.titulo(arvore.head ? arvore.head.slice(0, 12) : ms.semCommit, r.arvore),
    ms.indice(chave ?? ms.indisponivel, r.indice_do_head === 'ausente' ? ms.ausente
      : r.indice_do_head === 'indisponivel'
        ? (correcao ? ms.semAnalisadores : ms.semChave)
        : `(${r.indice_do_head})`),
    ms.analisadores(erro ?? descreverVersoes(analisadores as VersoesDosAnalisadores)),
    ...(correcao ? [ms.correcao(correcao)] : []),
    ms.pasta(estado.dir ?? ms.naoCriada, estado.indices.length, mb(estado.bytes)),
  ];
  for (const i of estado.indices) {
    linhas.push(`  ${i.chave.slice(0, 20)}  ${i.revision ? i.revision.slice(0, 12) : '?'}  ${i.repository_id ?? '?'}  ${mb(i.bytes)}  ${i.problema ?? 'ok'}`);
  }
  if (estado.sobras.length) linhas.push(ms.sobras(estado.sobras.join(', ')));
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
    // CHECK rodada 2 (N7): a ressalva da instalacao ja na primeira recusa, a de cada commit do GO.
    throw new Error(`grafo.indice.outra-revisao: o HEAD ${head} nao tem indice; o guardado e de outra revisao${alguns(revisoes)}; `
      + `rode ${CORRECAO_DO_INDICE} com a mesma instalacao do ork e o mesmo Node de quem consulta`);
  }
  throw original;
}

/**
 * O indice do HEAD pronto para consulta, com a concessao local e o cabecalho; `grafo` ja vem filtrado por ela.
 * KG5 fatia 5 (D3): `situacao` so le a arvore quando o cabecalho diz `modificada`; limpa, tudo vale `igual`.
 */
function consultavel(ctx: ContextoDoCli): {
  g: ReturnType<typeof prepararConsulta>; cabecalho: CabecalhoDoIndice; grafo: GrafoCodigo; raiz: string; situacao: SituacaoNaArvore;
} {
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
  const situacao = cabecalho.arvore === 'limpa' ? TUDO_IGUAL : situacaoNaArvore(arvore.raiz, grafo.snapshot.source_manifest);
  return { g: prepararConsulta(grafo, concessao), cabecalho, grafo, raiz: arvore.raiz, situacao };
}

function responder(ctx: ContextoDoCli, p: Pedido, r: RespostaDeConsulta): number {
  ctx.escrever(p.bandeiras.has('json') ? jsonDaResposta(r) : textoDaResposta(r, textosDe(ctx).consulta));
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
  const [a, b] = p.posicionais, x = textosDe(ctx);
  const profundidade = inteiro(p, 'profundidade', x), limite = inteiro(p, 'limite', x), s = sentido(p, x), t = tipos(p, x), teto = tetoDeBytes(p, x);
  const { g, cabecalho, situacao } = consultavel(ctx);
  // A busca binaria do teto pergunta de novo com outro limite; a situacao guarda o que ja leu da arvore.
  const perguntar = (lim: number | undefined): RespostaDeConsulta => {
    if (p.sub === 'vizinhos') return vizinhos(g, cabecalho, a, { profundidade, limite: lim, sentido: s, tipos: t }, situacao);
    if (p.sub === 'chamadores') return chamadores(g, cabecalho, a, { profundidade, limite: lim }, situacao);
    if (p.sub === 'importadores') return importadores(g, cabecalho, a, { profundidade, limite: lim }, situacao);
    return caminho(g, cabecalho, a, b, { sentido: s, tipos: t }, situacao);
  };
  if (teto === undefined) return responder(ctx, p, perguntar(limite));
  ctx.escrever(respostaComTeto(perguntar, limite, teto));
  return 0;
}

function contexto(ctx: ContextoDoCli, p: Pedido): number {
  const teto = tetoDeBytes(p, textosDe(ctx));
  if (teto !== undefined && (teto < 4096 || teto > 65536))
    throw new ErroDeConsulta('grafo.contexto.teto-invalido', 'teto deve ser inteiro de 4096 a 65536 bytes');
  if (!ctx.contextoDaThread) throw new ErroDeConsulta('grafo.contexto.indisponivel', 'borda sem leitor da thread');
  const lido = ctx.contextoDaThread(p.posicionais[0]);
  const { grafo, cabecalho, situacao } = consultavel({ ...ctx, raiz: lido.raiz });
  if (lido.head !== cabecalho.revision) throw new ErroDeConsulta('grafo.contexto.revisao-mudou', 'HEAD mudou durante a leitura; repita a consulta');
  const json = pacoteDeContexto(grafo, cabecalho, lido.entrada, teto, situacao);
  if (p.bandeiras.has('json')) ctx.escrever(json);
  else {
    const r = JSON.parse(json);
    // KG5 fatia 5 (D9): o resumo conta as ligacoes cuja fonte mudou na arvore, como o JSON marca.
    const mudadas = (r.arestas as { arvore?: string }[]).filter((a) => a.arvore === 'modificada').length;
    const mc = textosDe(ctx).contexto;
    ctx.escrever([mc.titulo(r.thread, r.indice.revision),
      mc.resumo(r.sementes.length, r.total_sementes, r.arestas.length, r.total_ligacoes, r.medida.pacote_bytes),
      mc.tamanho(r.medida.leitura_crua_bytes), mc.diff(r.fontes.diff), ...(mudadas ? [mc.mudadas(mudadas)] : []),
      mc.final(r.truncado, r.indice.arvore), json].join('\n'));
  }
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

/**
 * KG5 fatia 5 (D3, D6): a situacao de cada fonte do indice na arvore, pelos bytes. So caminho do manifesto;
 * sem seguir link, nem no ultimo nome nem numa pasta do caminho: o caminho real tem de ser o proprio caminho
 * indexado dentro da raiz (CHECK rodada 1, A1). So arquivo regular; tamanho diferente do indexado e
 * `modificada` sem ler, e o sha256 dos bytes decide o resto, lidos ate o tamanho indexado mais um. O arquivo
 * aberto tem de ser o mesmo do `lstat` (dispositivo e inode, CHECK rodada 1, S3): troca entre a conferencia e
 * a abertura vira `ausente`; duas trocas no intervalo ainda passam, e revelariam so se os bytes sao os
 * indexados. Qualquer falha e `ausente`: nao ha arquivo regular legivel no caminho. Cada caminho e lido uma
 * vez, sob demanda, e nada e escrito.
 */
export function situacaoNaArvore(raiz: string, manifesto: readonly EntradaDoManifesto[]): SituacaoNaArvore {
  const porCaminho = new Map(manifesto.map((m) => [m.path, m]));
  const vistas = new Map<string, SituacaoDaFonte>();
  let raizReal: string | null = null;
  const ler = (p: string): SituacaoDaFonte => {
    const m = porCaminho.get(p);
    if (!m) return 'ausente';
    const absoluto = path.join(raiz, p);
    try {
      raizReal ??= fs.realpathSync(raiz);
      const st = fs.lstatSync(absoluto, { throwIfNoEntry: false });
      if (!st || !st.isFile()) return 'ausente';
      // CHECK rodada 2 (R2-S1): caminho de manifesto adulterado com `..` coincidiria com o real fora da raiz.
      const real = fs.realpathSync(absoluto);
      if (real !== path.join(raizReal, p) || !real.startsWith(raizReal + path.sep)) return 'ausente';
      if (st.size !== m.size_bytes) return 'modificada';
      const fd = fs.openSync(absoluto, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const aberto = fs.fstatSync(fd);
        if (!aberto.isFile() || aberto.dev !== st.dev || aberto.ino !== st.ino) return 'ausente';
        if (aberto.size !== m.size_bytes) return 'modificada';
        const bytes = Buffer.alloc(m.size_bytes + 1);
        let lidos = 0;
        for (let n = 1; n > 0 && lidos < bytes.length; lidos += n) n = fs.readSync(fd, bytes, lidos, bytes.length - lidos, null);
        return lidos === m.size_bytes && sha256(bytes.subarray(0, lidos)) === m.source_hash ? 'igual' : 'modificada';
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return 'ausente';
    }
  };
  return (p: string): SituacaoDaFonte => {
    const vista = vistas.get(p);
    if (vista !== undefined) return vista;
    const s = ler(p);
    vistas.set(p, s);
    return s;
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
function conferirAmostra(grafo: GrafoCodigo, ler: (p: string) => Buffer, arquivo: string,
  ma: TextosDoGrafo['amostra']): { linhas: string[]; falhas: string[] } {
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
  const linhas = [ma.titulo(amostra.arestas.length, estratos.size, amostra.revision ?? amostra.revision_unavailable_reason),
    ma.vereditos(Object.entries(vereditos).sort(([x], [y]) => compararUtf8(x, y)).map(([k, v]) => `${k}=${v}`).join(' ')),
    ma.conferidas(amostra.arestas.length - falhas.length, amostra.arestas.length)];
  return { linhas, falhas };
}

function amostra(ctx: ContextoDoCli, p: Pedido): number {
  const t = textosDe(ctx);
  if (p.valores.has('conferir') && p.valores.has('por-estrato')) uso(t.motivos.amostraExclusiva, t);
  const { grafo, raiz, cabecalho } = consultavel(ctx);
  const ler = leitorDaArvore(raiz, grafo);
  const arquivo = p.valores.get('conferir');
  if (arquivo === undefined) {
    const n = inteiro(p, 'por-estrato', t) ?? 3;
    if (n < 1) uso(t.motivos.estratoMin, t);
    ctx.escrever(JSON.stringify(amostrar(grafo, ler, n, cabecalho.graph_digest), null, 2));
    return 0;
  }
  const { linhas, falhas } = conferirAmostra(grafo, ler, arquivo, t.amostra);
  if (p.bandeiras.has('json')) {
    ctx.escrever(JSON.stringify({ schema: AMOSTRA_SCHEMA, conferencia: linhas, falhas, aprovado: falhas.length === 0 }, null, 2));
  } else {
    const ma = t.amostra;
    ctx.escrever([...linhas, ...falhas.map((f) => ma.falha(f)), falhas.length ? ma.reprovado(falhas.length) : ma.aprovado].join('\n'));
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
  else ctx.escrever([textosDe(ctx).limpar(r.removidos.length, mb(r.bytes)), ...r.removidos.map((x) => `  ${x.nome} ${mb(x.bytes)}`)].join('\n'));
  return 0;
}

/** KG5 (D4, D5): com `--teto-bytes` o erro tambem sai compacto; recusa de indice traz o estado e a correcao. */
const erroEmJson = (ctx: ContextoDoCli, e: unknown, compacto: boolean, schema: string = CONSULTA_SCHEMA): number => {
  const [codigo, ...detalhe] = String((e as Error).message).split('\n')[0].split(': ');
  const doIndice = Object.prototype.hasOwnProperty.call(ESTADO_DO_INDICE, codigo)
    ? { estado_do_indice: ESTADO_DO_INDICE[codigo], correcao: CORRECAO_DO_INDICE } : {};
  const r = {
    schema,
    erro: { codigo, detalhe: detalhe.join(': ') || null, candidatos: e instanceof ErroDeConsulta ? e.candidatos : [], ...doIndice },
  };
  ctx.escrever(compacto ? JSON.stringify(r) : JSON.stringify(r, null, 2));
  return 1;
};

/** Traduz a mensagem sem apagar a classe, os candidatos ou o stack do erro tipado. */
const erroHumano = (ctx: ContextoDoCli, e: unknown): Error => {
  const erro = e instanceof Error ? e : new Error(String(e));
  erro.message = textosDe(ctx).erroTipado(erro.message);
  return erro;
};

/** `ork grafo <subcomando> ...`: devolve o codigo de saida; sem `--json`, o erro de uso ou tipado e lancado. */
export function executarGrafo(argv: readonly string[], ctx: ContextoDoCli): number {
  const schema = argv[0] === 'contexto' ? CONTEXTO_SCHEMA : CONSULTA_SCHEMA;
  const compacto = argv[0] === 'contexto' || argv.some((a) => a === '--teto-bytes' || a.startsWith('--teto-bytes='));
  let p: Pedido;
  try {
    p = lerPedido(argv, textosDe(ctx));
  } catch (e) {
    // Com `--json` no argv, tambem o erro de uso sai como objeto, como os demais.
    if (argv.includes('--json')) return erroEmJson(ctx, e, compacto, schema);
    throw e;
  }
  try {
    if (p.sub === 'indexar') return indexar(ctx, p);
    if (p.sub === 'status') return status(ctx, p);
    if (p.sub === 'amostra') return amostra(ctx, p);
    if (p.sub === 'limpar') return limpar(ctx, p);
    if (p.sub === 'contexto') return contexto(ctx, p);
    return consultar(ctx, p);
  } catch (e) {
    if (!p.bandeiras.has('json')) throw erroHumano(ctx, e);
    return erroEmJson(ctx, e, compacto, schema);
  }
}

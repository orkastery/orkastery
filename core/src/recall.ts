/**
 * `ork recall` (bloco B6): recuperacao TARDIA do que ficou fora do prompt.
 *
 * O problema que este comando resolve e o da janela queimada na abertura: uma sessao nova
 * que recebe tudo o que a anterior sabia comeca cheia e sem espaco para trabalhar. O
 * handoff do B1 ja separava CRITICO (inline) de IMPORTANTE (ponteiro); o que faltava era
 * o outro lado da promessa, o momento de puxar o ponteiro.
 *
 * A regra e o campo `retrieve_when` do ponteiro:
 *
 *   - `ork recall <thread> --fase CHECK` resolve SO os ponteiros marcados para o CHECK;
 *   - um ponteiro de CHECK pedido no GO volta como `fora-do-momento`, SEM conteudo: nao
 *     adianta ter momento declarado se o comando entrega o texto de qualquer jeito;
 *   - `--forcar` existe para o humano, e diz no resultado que o momento foi ignorado.
 *
 * A degradacao e a mesma do resto do bloco. Com OrkMind ligado, um ponteiro que tem
 * endereco semantico (`orkmind://<colecao>/<id>`) resolve por tag. Com o OrkMind fora, o
 * MESMO ponteiro resolve pelo `location` (`path#ancora`), por leitura dirigida, sem que o
 * fluxo de quem le o handoff mude em nada.
 */

import * as fs from 'node:fs';
import { caminhoHandoff, recall as recallDeArquivo } from './handoff';
import { ManifestoCarregado } from './manifest';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { Memoria, tagsDoProjeto, situacaoDaThread, arquivoDoHandoff, threadDaEntrada } from './memoria';
import { lerEndereco } from './orkmind';
import { dirThread, lerThread } from './thread';
import {
  Handoff,
  Ponteiro,
  PonteiroResolvido,
  ResultadoDoRecall,
} from './types';
import { agora, lerJson } from './util';

export interface OpcoesDeRecall {
  /** Momento pedido (`--fase CHECK`, ou um evento livre declarado no ponteiro). */
  momento?: string;
  /** Um ponteiro especifico, por id (`ptr-3`) ou por `location`. */
  id?: string;
  /** Resolve todos os ponteiros, de qualquer momento. */
  todos?: boolean;
  /** Ignora o `retrieve_when`, e declara no resultado que ignorou. */
  forcar?: boolean;
}

/** Momento do ponteiro e momento pedido casam? Comparacao exata, sem case. */
export function momentoCasa(ponteiro: Ponteiro, momento: string): boolean {
  return ponteiro.retrieve_when.trim().toLowerCase() === momento.trim().toLowerCase();
}

/** Le o handoff mais recente da thread, com erro acionavel quando ele nao existe. */
export function lerHandoff(raiz: string, threadId: string): Handoff {
  const caminho = caminhoHandoff(raiz, threadId);
  if (!fs.existsSync(caminho)) {
    throw new Error(
      `a thread ${threadId} nao tem handoff exportado (${caminho}). Rode: ork handoff export ${threadId}`
    );
  }
  return lerJson<Handoff>(caminho);
}

function naoResolvido(
  p: Ponteiro,
  motivo: PonteiroResolvido['motivo'],
  detalhe: string
): PonteiroResolvido {
  return {
    id: p.id,
    titulo: p.titulo,
    location: p.location,
    orkmind: p.orkmind ?? null,
    retrieve_when: p.retrieve_when,
    resolvido: false,
    motivo,
    via: null,
    conteudo: '',
    metodo: '',
    sha256: p.sha256,
    intervalo: null,
    detalhe,
  };
}

/** O contexto da sessão não pode ser reutilizado para outra thread ou tenant. */
function conferirEscopo(carregado: ManifestoCarregado, memoria: Memoria, threadId: string): void {
  const escopo = memoria.leituraRestrita;
  if (escopo && (escopo.thread !== threadId ||
      escopo.tenant !== tagsDoProjeto(carregado.manifesto).project[0])) {
    throw Error('memory.query.scope-conflict');
  }
}

/** Somente códigos conhecidos atravessam a fronteira; detalhes do driver podem conter segredos. */
function falhaDeConsulta(erro: unknown): string {
  const permitidos = new Set([
    'memory.query.invalid', 'memory.query.unsupported', 'memory.query.window-saturated',
    'memory.query.scope-conflict', 'memory.query.scope-violation', 'memory.query.response-invalid',
    'memory.transport.interpreter', 'memory.transport.secret', 'memory.transport.bridge',
    'memory.transport.timeout', 'memory.transport.spawn', 'memory.transport.failed',
    'memory.transport.json', 'memory.transport.unavailable', 'memory.schema.absent',
    'memory.legacy.provenance-collision', 'memory.prospective.marker-invalid',
    'memory.native.schema-mismatch', 'cli.ausente',
  ]);
  const codigo = erro instanceof Error ? erro.message.split(':', 1)[0] : '';
  return permitidos.has(codigo) ? codigo : 'memory.query.failed';
}

/**
 * Resolve UM ponteiro, escolhendo a via pelo regime efetivo.
 *
 * Preferencia pela memoria semantica quando ela existe e o ponteiro tem endereco; queda
 * para o arquivo quando ela nao existe, quando o endereco nao resolve ou quando o
 * ponteiro nunca teve endereco (todo handoff do regime `files`). No contexto restrito
 * ativo, falha ou ausência semântica permanece explícita, sem queda silenciosa.
 */
export function resolverPonteiro(
  carregado: ManifestoCarregado,
  memoria: Memoria,
  threadId: string,
  p: Ponteiro
): PonteiroResolvido {
  conferirEscopo(carregado, memoria, threadId);
  const restrito = memoria.leituraRestrita !== undefined;
  if (memoria.ativo && p.orkmind) {
    const endereco = lerEndereco(p.orkmind);
    if (restrito && !endereco) return naoResolvido(p, 'nao-resolve', 'memory.query.invalid');
    let entrada = null;
    try {
      entrada = endereco ? memoria.porId(endereco.colecao, endereco.id) : null;
    } catch (erro) {
      if (restrito) return naoResolvido(p, 'orkmind-indisponivel', falhaDeConsulta(erro));
      // Compatibilidade da API de manutenção: queda dirigida para arquivo.
    }
    if (restrito && !entrada) return naoResolvido(p, 'nao-resolve', 'memory.query.not-found');
    if (restrito && entrada && (entrada.collection !== endereco!.colecao ||
        entrada.id !== endereco!.id ||
        !entrada.tags.situation?.includes(situacaoDaThread(threadId)))) {
      return naoResolvido(p, 'nao-resolve', 'memory.query.scope-violation');
    }
    const tenant = tagsDoProjeto(carregado.manifesto).project[0];
    if (entrada && entrada.tags.project?.includes(tenant) &&
        (entrada.collection !== 'handoff' || threadDaEntrada(entrada) === threadId)) {
      return {
        id: p.id,
        titulo: p.titulo,
        location: p.location,
        orkmind: p.orkmind,
        retrieve_when: p.retrieve_when,
        resolvido: true,
        motivo: 'ok',
        via: 'orkmind',
        conteudo: entrada.content,
        metodo: `entrada ${entrada.collection} recuperada por tag na memoria semantica`,
        sha256: p.sha256,
        intervalo: null,
        detalhe: `orkmind://${entrada.collection}/${entrada.id}`,
      };
    }
    if (restrito) return naoResolvido(p, 'nao-resolve', 'memory.query.scope-violation');
  }

  try {
    const r = recallDeArquivo(carregado, threadId, p.location);
    return {
      id: p.id,
      titulo: p.titulo,
      location: p.location,
      orkmind: p.orkmind ?? null,
      retrieve_when: p.retrieve_when,
      resolvido: true,
      motivo: 'ok',
      via: 'files',
      conteudo: r.conteudo,
      metodo: r.metodo,
      sha256: r.sha256,
      intervalo: r.intervalo,
      detalhe:
        memoria.ativo && p.orkmind
          ? 'endereco semantico nao resolveu; o mesmo ponteiro caiu para path#ancora'
          : 'leitura dirigida por path#ancora (regime files)',
    };
  } catch (e) {
    const semantico = memoria.estado.efetivo === 'files' && p.orkmind;
    return naoResolvido(
      p,
      semantico ? 'orkmind-indisponivel' : 'nao-resolve',
      (e as Error).message
    );
  }
}

/**
 * `ork recall`: resolve os ponteiros do handoff que sao DESTE momento.
 *
 * O que nao e deste momento volta em `adiados`, com o momento declarado: a sessao sabe
 * que existe, sabe onde esta e sabe quando puxar, sem gastar janela agora. E o item 4 da
 * secao 6.1 da visao (rastreabilidade): nada some, nada entra sem hora marcada.
 */
export function recallDaThread(
  carregado: ManifestoCarregado,
  memoria: Memoria,
  threadId: string,
  opcoes: OpcoesDeRecall = {}
): ResultadoDoRecall {
  conferirEscopo(carregado, memoria, threadId);
  const { raiz } = carregado;
  // Thread inexistente e erro, nao lista vazia: o CLI precisa reprovar o id errado.
  lerThread(raiz, threadId);
  const handoff = lerHandoff(raiz, threadId);
  const momento = opcoes.momento ?? null;

  const resolvidos: PonteiroResolvido[] = [];
  const adiados: PonteiroResolvido[] = [];
  const falhas: PonteiroResolvido[] = [];

  for (const p of handoff.pointers) {
    const pedidoPorId =
      opcoes.id !== undefined && (p.id === opcoes.id || p.location === opcoes.id);
    if (opcoes.id !== undefined && !pedidoPorId) continue;

    const naHora =
      opcoes.forcar === true ||
      opcoes.todos === true ||
      pedidoPorId ||
      (momento !== null && momentoCasa(p, momento));
    if (!naHora) {
      adiados.push(
        naoResolvido(
          p,
          'fora-do-momento',
          momento === null
            ? `sem momento pedido: este ponteiro e do momento "${p.retrieve_when}"`
            : `este ponteiro e do momento "${p.retrieve_when}", e o pedido foi "${momento}"`
        )
      );
      continue;
    }
    const r = resolverPonteiro(carregado, memoria, threadId, p);
    if (r.resolvido) resolvidos.push(r);
    else falhas.push(r);
  }

  // Descoberta de handoffs destinados exatamente a esta fase. Referencias explicitas
  // continuam obedecendo retrieve_when, inclusive para um handoff anterior.
  if (memoria.ativo && momento && opcoes.id === undefined && !opcoes.todos && !opcoes.forcar) {
    const fase = momento.trim().toUpperCase();
    const tags = { project: tagsDoProjeto(carregado.manifesto).project,
      skill: [fase], situation: [situacaoDaThread(threadId)] };
    const vistos = new Set(resolvidos.map(r => r.orkmind));
    try {
      const entradas = memoria.buscar({ collection: 'handoff', tags }).filter(e =>
        e.collection === 'handoff' && threadDaEntrada(e) === threadId &&
        Object.entries(tags).every(([k, values]) => values.every(v => e.tags[k]?.includes(v))));
      for (const e of entradas) {
        const endereco = `orkmind://handoff/${e.id}`;
        if (vistos.has(endereco)) continue;
        vistos.add(endereco);
        resolvidos.push({ id: `memoria-${e.id}`, titulo: `Handoff destinado a ${fase}`,
          location: `${arquivoDoHandoff(e) ?? ''}#tudo`, orkmind: endereco,
          retrieve_when: fase, resolvido: true, motivo: 'ok', via: 'orkmind', conteudo: e.content,
          metodo: 'busca exata por tenant, thread e fase', sha256: String(e.metadata.sha256 ?? ''),
          intervalo: null, detalhe: endereco });
      }
    } catch (erro) {
      falhas.push({ id: 'memoria-busca', titulo: 'Descoberta de handoffs da fase', location: '',
        orkmind: null, retrieve_when: fase, resolvido: false, motivo: 'orkmind-indisponivel', via: null,
        conteudo: '', metodo: '', sha256: '', intervalo: null,
        // RM-038: a janela cheia do export tem codigo proprio; o resto segue como falha de transporte.
        detalhe: `${memoria.leituraRestrita ? falhaDeConsulta(erro) : erro instanceof Error && erro.message === 'memory.query.window-saturated'
          ? erro.message : 'memory.transport.export'}: busca semantica falhou; resultado nao comprova colecao vazia` });
    }
  }

  if (opcoes.id !== undefined && resolvidos.length === 0 && falhas.length === 0 && adiados.length === 0) {
    throw new Error(
      `ponteiro "${opcoes.id}" nao existe no handoff da thread ${threadId} ` +
        `(ids: ${handoff.pointers.map((p) => p.id).join(', ') || 'nenhum'})`
    );
  }

  const resultado: ResultadoDoRecall = {
    thread: threadId,
    momento,
    regime: memoria.regime,
    regimeDoHandoff: handoff.memory,
    resolvidos,
    adiados,
    falhas,
    resolvidoEm: agora(),
  };

  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.recallResolvido, {
    momento: momento ?? '(todos)',
    regime: memoria.regime,
    regimeDoHandoff: handoff.memory,
    resolvidos: resolvidos.length,
    adiados: adiados.length,
    falhas: falhas.length,
    forcado: opcoes.forcar === true,
    vias: resolvidos.map((r) => `${r.id}:${r.via}`),
    bytes: resolvidos.reduce((t, r) => t + Buffer.byteLength(r.conteudo, 'utf8'), 0),
  });

  return resultado;
}

/** Texto de `ork recall`. */
export function textoDoRecall(r: ResultadoDoRecall, comConteudo = true): string {
  const linhas: string[] = [];
  linhas.push(
    `Recall da thread ${r.thread} no momento ${r.momento ?? '(todos)'} ` +
      `(regime efetivo ${r.regime}, handoff escrito em regime ${r.regimeDoHandoff})`
  );
  linhas.push('');
  linhas.push(`RESOLVIDOS (${r.resolvidos.length}, entram no contexto agora):`);
  for (const p of r.resolvidos) {
    linhas.push(`  ${p.id}  ${p.titulo}`);
    linhas.push(`        via       ${p.via} (${p.metodo})`);
    linhas.push(`        location  ${p.location}`);
    if (p.orkmind) linhas.push(`        orkmind   ${p.orkmind}`);
    linhas.push(`        quando    ${p.retrieve_when}`);
    if (comConteudo) {
      linhas.push('');
      for (const l of p.conteudo.split('\n')) linhas.push(`        | ${l}`);
      linhas.push('');
    }
  }
  linhas.push('');
  linhas.push(`ADIADOS (${r.adiados.length}, existem e NAO entram agora):`);
  for (const p of r.adiados) {
    linhas.push(`  ${p.id}  ${p.titulo}`);
    linhas.push(`        quando    ${p.retrieve_when}`);
    linhas.push(`        onde      ${p.location}`);
    linhas.push(`        recuperar ork recall ${r.thread} --fase ${p.retrieve_when}`);
  }
  if (r.falhas.length > 0) {
    linhas.push('');
    linhas.push(`FALHAS (${r.falhas.length}):`);
    for (const p of r.falhas) {
      linhas.push(`  ${p.id}  ${p.titulo}`);
      linhas.push(`        motivo    ${p.motivo}`);
      linhas.push(`        detalhe   ${p.detalhe}`);
    }
  }
  return linhas.join('\n');
}

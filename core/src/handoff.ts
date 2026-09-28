import { exigirAtivacao } from './write-activation';
/**
 * Handoff triado entre sessoes, regime `files` (guia: docs/guias/memoria-e-handoff.md).
 *
 * Quando o gate de tokens veredicta `new-session`, a sessao que abre NAO recebe copia
 * integral da anterior. Ela recebe um handoff com triagem em 3 niveis:
 *
 *   CRITICO   -> vai INLINE, sempre: estado do mundo, decisoes locked, criterios de
 *                sucesso, claims pendentes, baseline.
 *   IMPORTANTE-> vira PONTEIRO `path#ancora`, com instrucao de recuperacao e o momento
 *                de resolve-lo. Nao entra no prompt: entra o endereco.
 *   RESUMIVEL -> vira resumo curto COM proveniencia: historico de tentativas, logs,
 *                exploracao ja concluida.
 *
 * Proveniencia e obrigatoria em todo item: source, location e sha256 do arquivo de
 * origem. Nada entra no contexto da nova sessao sem dizer de onde veio, e tudo o que
 * ficou de fora esta listado como ponteiro, com onde esta e como recuperar.
 *
 * Sem OrkMind, a recuperacao tardia e leitura dirigida (`ork handoff recall`), nao busca
 * semantica. O campo `memory` declara o regime, entao a sessao seguinte sabe o que pedir.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerClaims } from './claims';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { blocoDaFase, tagDoModo } from './modos';
import { slugDaSessao } from './phase';
import { dirThread, lerThread } from './thread';
import {
  abrirMemoria,
  arquivoDoHandoff,
  gravarDecisoes,
  gravarHandoff,
  licoesDoProduto,
  Memoria,
  postmortemDaLicao,
  skillDaColecao,
  situacaoDaThread,
  tagsDoProjeto,
  threadDaEntrada,
} from './memoria';
import { Fase, Handoff, ItemInline, Ponteiro, Proveniencia, Resumo, Thread } from './types';
import { agora, gravarJson } from './util';

/** sha256 de um arquivo em disco, a prova de proveniencia de cada item. */
export function sha256DoArquivo(caminho: string): string {
  if (!fs.existsSync(caminho)) return '(arquivo ausente)';
  return createHash('sha256').update(fs.readFileSync(caminho)).digest('hex');
}

/** sha256 de um conteudo montado pelo proprio `ork` (itens derivados do estado). */
export function sha256DoTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

function relativo(raiz: string, caminho: string): string {
  return path.relative(raiz, caminho).split(path.sep).join('/');
}

/**
 * Resolve o arquivo citado por uma claim.
 *
 * A claim e escrita do ponto de vista de quem trabalha: o caminho vale primeiro dentro da
 * worktree da thread (onde a fase roda e onde o `ork verify` executa os comandos) e so
 * depois na raiz do projeto.
 */
export function caminhoDoArtefato(raiz: string, thread: Thread, arquivo: string): string | null {
  const candidatos = thread.worktree
    ? [path.resolve(thread.worktree, arquivo), path.resolve(raiz, arquivo)]
    : [path.resolve(raiz, arquivo)];
  for (const c of candidatos) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function proveniencia(raiz: string, caminho: string, ancora: string): Proveniencia {
  const rel = relativo(raiz, caminho);
  return { source: rel, location: `${rel}#${ancora}`, sha256: sha256DoArquivo(caminho) };
}

export interface OpcoesHandoff {
  /** Fase que a proxima sessao vai conduzir. Padrao: a fase atual da thread. */
  proximaFase?: Fase;
  /** Slug da proxima sessao. Padrao: o que o gate de tokens sugeriria. */
  slugDestino?: string;
  /**
   * Memoria ja aberta (bloco B6). Sem ela, o handoff abre a do manifesto.
   *
   * Com o regime `orkmind` valendo, o handoff ganha DOIS acrescimos e nada mais:
   * ponteiros com endereco semantico (`orkmind://<colecao>/<id>`) ao lado do
   * `path#ancora` de sempre, e a publicacao do proprio pacote na colecao `handoff`.
   * A triagem em 3 niveis, as ancoras e a proveniencia continuam identicas ao B1.
   */
  memoria?: Memoria;
}

/** Caminho canonico do handoff mais recente da thread. */
export function caminhoHandoff(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), 'handoff.json');
}

/** Caminho do historico de handoffs da thread. */
export function dirHandoffs(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), 'handoffs');
}

/** Resumo textual do estado do mundo da thread: o item CRITICO que sempre vai inline. */
function estadoDoMundo(thread: Thread): string {
  const linhas = [
    `thread: ${thread.id} (${thread.nome})`,
    `slug atual: ${thread.slug}`,
    `modo de conducao: ${tagDoModo(thread.modo)}`,
    `fase atual: ${thread.faseAtual}`,
    `status: ${thread.status}`,
    `base carimbada pelo ork: ${thread.base.branch} @ ${thread.base.commit}`,
    `diretorio de trabalho: ${thread.worktree ?? '(raiz do projeto)'}`,
    `blocos do modo: ${thread.blocos.map((b) => b.fases.join('-') + (b.pausa ? '*' : '')).join(' / ')}`,
    `* = bloco que pausa e espera veredito humano`,
  ];
  return linhas.join('\n');
}

/** Exporta o handoff triado da thread. Deterministico: mesma entrada, mesmo arquivo. */
export function exportarHandoff(
  carregado: ManifestoCarregado,
  threadId: string,
  opcoes: OpcoesHandoff = {}
): { handoff: Handoff; caminho: string; caminhoHistorico: string } {
  const { raiz, manifesto } = carregado;
  if (opcoes.memoria?.ativo && opcoes.memoria.leituraRestrita) {
    throw Error('memory.query.broad-operation: handoff export exige contexto de manutencao ou regime files');
  }
  const thread = lerThread(raiz, threadId);
  const dir = dirThread(raiz, threadId);
  const proximaFase = opcoes.proximaFase ?? thread.faseAtual;
  const slugDestino = opcoes.slugDestino ?? slugDaSessao(thread, proximaFase);
  const caminhoThreadJson = path.join(dir, 'thread.json');
  const caminhoClaimsJsonl = path.join(dir, 'claims.jsonl');
  const caminhoLedgerJsonl = path.join(dir, 'ledger.jsonl');

  const inline: ItemInline[] = [];
  const pointers: Ponteiro[] = [];
  const summaries: Resumo[] = [];
  let nInline = 0;
  let nPonteiro = 0;
  let nResumo = 0;

  const addInline = (titulo: string, conteudo: string, prov: Proveniencia) => {
    nInline += 1;
    inline.push({ id: `inline-${nInline}`, tier: 'CRITICO', titulo, conteudo, proveniencia: prov });
  };
  const addPonteiro = (
    titulo: string,
    caminho: string,
    ancora: string,
    quando: string,
    endereco?: string
  ) => {
    const rel = relativo(raiz, caminho);
    // Dois artefatos citados por claims diferentes podem ser o mesmo arquivo: o handoff
    // guarda um endereco por local, nao um por citacao.
    if (pointers.some((p) => p.location === `${rel}#${ancora}`)) return;
    nPonteiro += 1;
    const ponteiro: Ponteiro = {
      id: `ptr-${nPonteiro}`,
      tier: 'IMPORTANTE',
      titulo,
      source: rel,
      location: `${rel}#${ancora}`,
      sha256: sha256DoArquivo(caminho),
      // O endereco cru continua sendo o contrato do B1. Quem quer respeitar o momento usa
      // `ork recall <thread> --fase <quando>` (bloco B6), que resolve so o que e da hora.
      retrieve_via: `ork handoff recall ${threadId} "${rel}#${ancora}"`,
      retrieve_when: quando,
    };
    // O endereco semantico e ACRESCIMO: o `location` continua sendo path#ancora, e e por
    // isso que o mesmo ponteiro resolve com o OrkMind fora do ar.
    if (endereco) ponteiro.orkmind = endereco;
    pointers.push(ponteiro);
  };
  const addResumo = (text: string, prov: Proveniencia) => {
    nResumo += 1;
    summaries.push({ id: `sum-${nResumo}`, tier: 'RESUMIVEL', text, provenance: prov });
  };

  // CRITICO 1: estado do mundo (base carimbada, modo, fase, worktree).
  addInline(
    'Estado do mundo da thread',
    estadoDoMundo(thread),
    proveniencia(raiz, caminhoThreadJson, 'json:base')
  );

  // CRITICO 2: regra de pausa do bloco que a proxima sessao vai conduzir.
  const bloco = blocoDaFase(thread.modo, proximaFase);
  addInline(
    `Regra de pausa do bloco ${bloco.fases.join('-')}`,
    bloco.pausa
      ? `Ao fim deste bloco HA PAUSA humana sobre: ${bloco.pausaSobre}.`
      : 'Ao fim deste bloco NAO ha pausa humana: decisao autonoma, registrada no ledger.',
    proveniencia(raiz, caminhoThreadJson, 'json:blocos')
  );

  // CRITICO 3: decisoes locked, que precisam voltar em toda sessao da thread.
  for (const decisao of thread.decisoes ?? []) {
    if (!decisao || typeof decisao !== 'object' || !(decisao as { locked?: boolean }).locked) continue;
    const d = decisao as { id: string; texto: string; decididaPor: string };
    addInline(
      `Decisao locked ${d.id}`,
      `${d.texto}\n(fechada por ${d.decididaPor})`,
      proveniencia(raiz, caminhoThreadJson, `json:decisoes.${d.id}`)
    );
  }

  // CRITICO 4: claims ainda nao verificadas. IMPORTANTE: as ja verificadas viram ponteiro.
  const claims = lerClaims(raiz, threadId);
  for (const c of claims) {
    if (c.estado === 'verificado') {
      addPonteiro(
        `Claim ${c.id} ja verificada: ${c.alegacao}`,
        caminhoClaimsJsonl,
        `claim:${c.id}`,
        proximaFase
      );
    } else {
      addInline(
        `Claim ${c.id} pendente (${c.estado})`,
        `${c.alegacao}\narquivo: ${c.arquivo}\n` +
          `verificar com: ${c.verificar.join(' && ') || '(sem comando declarado)'}`,
        proveniencia(raiz, caminhoClaimsJsonl, `claim:${c.id}`)
      );
    }
    // O artefato citado pela claim e IMPORTANTE: vai como endereco, nao colado.
    const artefato = caminhoDoArtefato(raiz, thread, c.arquivo);
    if (artefato) addPonteiro(`Artefato da claim ${c.id}`, artefato, 'tudo', proximaFase);
  }

  // CRITICO 5: baseline, quando existe (e a linha que separa regressao de divida).
  if (thread.baseline) {
    const b = thread.baseline;
    addInline(
      'Baseline gravada antes do GO',
      `commit ${b.commit} em ${b.gravadaEm}\n` +
        b.comandos.map((c) => `  ${c.nome}: ${c.ok ? 'passava' : 'ja falhava'} (${c.comando})`).join('\n'),
      proveniencia(raiz, caminhoThreadJson, 'json:baseline')
    );
  }

  // IMPORTANTE: os prompts ja despachados, com o pedido original do builder.
  for (const s of thread.sessoes) {
    if (s.origem === 'adocao') continue;
    const caminhoPrompt = path.resolve(raiz, s.promptPath);
    if (!fs.existsSync(caminhoPrompt)) continue;
    addPonteiro(
      `Prompt da sessao ${s.slug} (fase ${s.fase})`,
      caminhoPrompt,
      'pedido-do-builder',
      s.fase
    );
  }

  // RESUMIVEL: historico de tentativas e movimentacao, com proveniencia no ledger.
  const eventos = lerLedger(dir);
  if (eventos.length > 0) {
    const porTipo = new Map<string, number>();
    for (const e of eventos) porTipo.set(e.tipo, (porTipo.get(e.tipo) ?? 0) + 1);
    addResumo(
      `${eventos.length} eventos no ledger da thread: ` +
        [...porTipo.entries()].map(([t, n]) => `${t} x${n}`).join(', ') +
        `. Ultimo evento: ${eventos[eventos.length - 1].tipo} em ${eventos[eventos.length - 1].ts}.`,
      proveniencia(raiz, caminhoLedgerJsonl, `evento:${eventos.length}`)
    );
    const falhas = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.despachoFalhou);
    if (falhas.length > 0) {
      addResumo(
        `${falhas.length} despacho(s) falharam nesta thread; o motivo de cada um esta no ledger.`,
        proveniencia(raiz, caminhoLedgerJsonl, `evento:${eventos.indexOf(falhas[falhas.length - 1]) + 1}`)
      );
    }
  }
  if (thread.sessoes.length > 0) {
    addResumo(
      `${thread.sessoes.length} sessao(oes) registrada(s): ` +
        thread.sessoes.map((s) => `${s.slug} (${s.fase}, ${s.origem === 'adocao' ? 'adotada' : 'despachada'})`).join(', ') +
        '. Os prompts estao nos ponteiros acima; a exploracao ja concluida nao vai inline.',
      proveniencia(raiz, caminhoThreadJson, 'json:sessoes')
    );
  }

  // Bloco B6: com o regime `orkmind` valendo, o que a memoria semantica JA guarda deste
  // produto vira ponteiro, nao texto colado. O `location` continua sendo o arquivo
  // commitado, entao o mesmo ponteiro resolve por leitura dirigida quando o OrkMind cai.
  const memoria = opcoes.memoria ?? abrirMemoria(carregado);
  if (memoria.ativo) {
    const anteriores = memoria.buscar({
      collection: 'handoff',
      tags: {
        project: tagsDoProjeto(manifesto).project,
        skill: [skillDaColecao('handoff')],
        situation: [situacaoDaThread(threadId)],
      },
    });
    for (const e of anteriores) {
      const arquivo = arquivoDoHandoff(e);
      const emDisco = arquivo ? path.resolve(raiz, arquivo) : '';
      if (!emDisco || !fs.existsSync(emDisco)) continue;
      addPonteiro(
        `Handoff anterior desta thread (${arquivo})`,
        emDisco,
        'tudo',
        proximaFase,
        `orkmind://handoff/${e.id}`
      );
    }
    // Licoes das threads anteriores do produto: elas entram inline no GOAL (injecao por
    // tag), e aqui viram endereco para as demais fases, que nao precisam carrega-las.
    for (const e of licoesDoProduto(memoria, manifesto, threadId)) {
      const postmortem = postmortemDaLicao(e);
      const emDisco = postmortem ? path.resolve(raiz, postmortem) : '';
      if (!emDisco || !fs.existsSync(emDisco)) continue;
      addPonteiro(
        `Licao da thread ${threadDaEntrada(e) ?? '(anterior)'}`,
        emDisco,
        'json:resumo',
        'MASTER',
        `orkmind://learning/${e.id}`
      );
    }
  }

  const handoff: Handoff = {
    versao: 1,
    thread: threadId,
    geradoEm: agora(),
    // O regime EFETIVO, nao o pedido: um manifesto que pede `orkmind` com o OrkMind fora
    // do ar grava `files`, e a sessao seguinte sabe exatamente o que pode pedir.
    memory: memoria.regime,
    de: { slug: thread.slug, fase: thread.faseAtual },
    para: { slug: slugDestino, fase: proximaFase },
    inline,
    pointers,
    summaries,
  };

  const caminho = caminhoHandoff(raiz, threadId);
  const carimbo = handoff.geradoEm.replace(/[:.]/g, '-');
  const caminhoHistorico = path.join(dirHandoffs(raiz, threadId), `${slugDestino}-${carimbo}.json`);
  gravarJson(caminho, handoff);
  gravarJson(caminhoHistorico, handoff);

  // Publicacao na memoria semantica: o pacote de fase (colecao `handoff`) e as decisoes
  // fechadas (colecao `decision`), que sao o que uma thread futura precisa herdar.
  let escritaAutorizada = true;
  if (!opcoes.memoria && manifesto.memory.mode === 'orkmind') {
    try { exigirAtivacao(carregado, threadId, 'memory'); }
    catch {
      escritaAutorizada = false;
      registrar(dir, threadId, 'memory_publication_pending', { origem: 'handoff export', motivo: 'write.activation.required', arquivoPreservado: true });
    }
  }
  if (memoria.ativo && escritaAutorizada) {
    const publicado = gravarHandoff(memoria, manifesto, thread, handoff, relativo(raiz, caminhoHistorico));
    const decisoes = gravarDecisoes(memoria, manifesto, thread);
    registrar(dir, threadId, TIPOS_DE_EVENTO.memoriaGravada, {
      origem: 'handoff export',
      regime: memoria.regime,
      handoff: publicado.ok ? publicado.id : null,
      handoffDetalhe: publicado.detalhe,
      decisoes: decisoes.gravadas.length,
      decisoesFalhas: decisoes.falhas,
      tenant: memoria.estado.tenant,
    });
  } else if (memoria.estado.pedido === 'orkmind') {
    registrar(dir, threadId, TIPOS_DE_EVENTO.memoriaDegradada, {
      origem: 'handoff export',
      pedido: memoria.estado.pedido,
      efetivo: memoria.estado.efetivo,
      motivo: memoria.estado.motivo,
      detalhe: memoria.estado.detalhe,
      correcao: memoria.estado.correcao,
    });
  }

  registrar(dir, threadId, TIPOS_DE_EVENTO.handoffExportado, {
    memory: handoff.memory,
    de: handoff.de,
    para: handoff.para,
    inline: inline.length,
    pointers: pointers.length,
    summaries: summaries.length,
    arquivo: relativo(raiz, caminho),
    historico: relativo(raiz, caminhoHistorico),
    triagem: 'CRITICO inline, IMPORTANTE por ponteiro, RESUMIVEL por resumo com proveniencia',
  });

  return { handoff, caminho, caminhoHistorico };
}

/** Normaliza um titulo de markdown para ancora (`## Pedido do builder` -> `pedido-do-builder`). */
export function ancoraDeTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ResultadoRecall {
  location: string;
  caminho: string;
  ancora: string;
  conteudo: string;
  sha256: string;
  /** Linhas 1-based do trecho recuperado, quando aplicavel. */
  intervalo: { inicio: number; fim: number } | null;
  /** Como o trecho foi localizado, para constar na proveniencia. */
  metodo: string;
}

function trechoPorLinhas(linhas: string[], inicio: number, fim: number): string {
  return linhas.slice(inicio - 1, fim).join('\n');
}

/** Resolve uma ancora de markdown: da linha do titulo ate o proximo titulo de mesmo nivel. */
function secaoDeMarkdown(linhas: string[], ancora: string): { inicio: number; fim: number } | null {
  for (let i = 0; i < linhas.length; i++) {
    const casa = /^(#{1,6})\s+(.*)$/.exec(linhas[i]);
    if (!casa) continue;
    if (ancoraDeTitulo(casa[2]) !== ancora) continue;
    const nivel = casa[1].length;
    let fim = linhas.length;
    for (let j = i + 1; j < linhas.length; j++) {
      const seguinte = /^(#{1,6})\s+/.exec(linhas[j]);
      if (seguinte && seguinte[1].length <= nivel) {
        fim = j;
        break;
      }
    }
    return { inicio: i + 1, fim };
  }
  return null;
}

function valorEmJson(dados: unknown, caminho: string): unknown {
  let atual: unknown = dados;
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/**
 * `ork handoff recall`: resolve um ponteiro `path#ancora` de volta ao conteudo.
 *
 * E a prova de que a recuperacao tardia funciona: a sessao nova nasce so com o inline e
 * busca o resto quando precisa, sem queimar a janela recem-aberta.
 */
export function recall(
  carregado: ManifestoCarregado,
  threadId: string,
  ponteiro: string
): ResultadoRecall {
  const { raiz } = carregado;
  const corte = ponteiro.lastIndexOf('#');
  const bruto = corte >= 0 ? ponteiro.slice(0, corte) : ponteiro;
  const ancora = corte >= 0 ? ponteiro.slice(corte + 1) : 'tudo';
  const caminho = path.resolve(raiz, bruto);
  if (!fs.existsSync(caminho) || !fs.statSync(caminho).isFile()) {
    throw new Error(`ponteiro nao resolve: arquivo "${bruto}" nao existe a partir de ${raiz}`);
  }
  const conteudoBruto = fs.readFileSync(caminho, 'utf8');
  const linhas = conteudoBruto.split('\n');
  const sha = sha256DoArquivo(caminho);
  const base = { location: `${bruto}#${ancora}`, caminho, ancora, sha256: sha };

  const registrarRecall = (r: ResultadoRecall): ResultadoRecall => {
    registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.handoffRecuperado, {
      location: r.location,
      sha256: r.sha256,
      metodo: r.metodo,
      intervalo: r.intervalo,
      bytes: Buffer.byteLength(r.conteudo, 'utf8'),
    });
    return r;
  };

  if (ancora === 'tudo' || ancora === '') {
    return registrarRecall({
      ...base,
      conteudo: conteudoBruto,
      intervalo: { inicio: 1, fim: linhas.length },
      metodo: 'arquivo inteiro',
    });
  }

  const faixa = /^L(\d+)(?:-L?(\d+))?$/.exec(ancora);
  if (faixa) {
    const inicio = Math.max(1, Number(faixa[1]));
    const fim = Math.min(linhas.length, Number(faixa[2] ?? faixa[1]));
    if (inicio > linhas.length) {
      throw new Error(`ponteiro nao resolve: ${bruto} tem ${linhas.length} linhas, e a ancora pede ${inicio}`);
    }
    return registrarRecall({
      ...base,
      conteudo: trechoPorLinhas(linhas, inicio, fim),
      intervalo: { inicio, fim },
      metodo: 'faixa de linhas',
    });
  }

  const claim = /^claim:(.+)$/.exec(ancora);
  if (claim) {
    const alvo = claim[1];
    for (let i = linhas.length - 1; i >= 0; i--) {
      if (linhas[i].trim() === '') continue;
      try {
        const dados = JSON.parse(linhas[i]) as { id?: string };
        if (dados.id !== alvo) continue;
        return registrarRecall({
          ...base,
          conteudo: JSON.stringify(dados, null, 2),
          intervalo: { inicio: i + 1, fim: i + 1 },
          metodo: 'claim por id no JSONL (a gravacao mais recente vence)',
        });
      } catch {
        /* linha corrompida nao interrompe a busca */
      }
    }
    throw new Error(`ponteiro nao resolve: claim "${alvo}" nao existe em ${bruto}`);
  }

  const evento = /^evento:(\d+)$/.exec(ancora);
  if (evento) {
    const n = Number(evento[1]);
    const uteis = linhas.filter((l) => l.trim() !== '');
    if (n < 1 || n > uteis.length) {
      throw new Error(`ponteiro nao resolve: ${bruto} tem ${uteis.length} eventos, e a ancora pede o ${n}`);
    }
    let conteudo = uteis[n - 1];
    try {
      conteudo = JSON.stringify(JSON.parse(conteudo), null, 2);
    } catch {
      /* mantem a linha crua quando ela nao e JSON valido */
    }
    return registrarRecall({
      ...base,
      conteudo,
      intervalo: { inicio: n, fim: n },
      metodo: 'evento por posicao no ledger JSONL',
    });
  }

  const json = /^json:(.+)$/.exec(ancora);
  if (json) {
    const valor = valorEmJson(JSON.parse(conteudoBruto), json[1]);
    if (valor === undefined) {
      throw new Error(`ponteiro nao resolve: caminho "${json[1]}" nao existe em ${bruto}`);
    }
    return registrarRecall({
      ...base,
      conteudo: typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2),
      intervalo: null,
      metodo: 'caminho de campo dentro do JSON',
    });
  }

  const secao = secaoDeMarkdown(linhas, ancora);
  if (secao) {
    return registrarRecall({
      ...base,
      conteudo: trechoPorLinhas(linhas, secao.inicio, secao.fim),
      intervalo: secao,
      metodo: 'secao de markdown pelo titulo',
    });
  }

  throw new Error(
    `ponteiro nao resolve: ancora "${ancora}" nao encontrada em ${bruto} ` +
      '(ancoras aceitas: tudo, L<n>-L<m>, claim:<id>, evento:<n>, json:<campo.campo>, <titulo-de-secao>)'
  );
}

/** Texto de `ork handoff export`. */
export function textoDoHandoff(h: Handoff, caminho: string): string {
  const linhas: string[] = [];
  linhas.push(`Handoff exportado da thread ${h.thread} (regime memory: ${h.memory})`);
  linhas.push(`  de    ${h.de.slug} (fase ${h.de.fase})`);
  linhas.push(`  para  ${h.para.slug} (fase ${h.para.fase})`);
  linhas.push(`  arquivo ${caminho}`);
  linhas.push('');
  linhas.push(`CRITICO (${h.inline.length} item(ns), vao inline no prompt da nova sessao):`);
  for (const i of h.inline) {
    linhas.push(`  ${i.id}  ${i.titulo}`);
    linhas.push(`        proveniencia: ${i.proveniencia.location} (sha256 ${i.proveniencia.sha256.slice(0, 12)})`);
  }
  linhas.push('');
  linhas.push(`IMPORTANTE (${h.pointers.length} ponteiro(s), recuperados sob demanda):`);
  for (const p of h.pointers) {
    linhas.push(`  ${p.id}  ${p.titulo}`);
    linhas.push(`        location: ${p.location}  (sha256 ${p.sha256.slice(0, 12)})`);
    if (p.orkmind) linhas.push(`        orkmind:  ${p.orkmind}`);
    linhas.push(`        quando:   ${p.retrieve_when}`);
    linhas.push(`        recuperar: ${p.retrieve_via}`);
    linhas.push(`        no momento: ork recall ${h.thread} --fase ${p.retrieve_when}`);
  }
  linhas.push('');
  linhas.push(`RESUMIVEL (${h.summaries.length} resumo(s), com proveniencia declarada):`);
  for (const s of h.summaries) {
    linhas.push(`  ${s.id}  ${s.text}`);
    linhas.push(`        proveniencia: ${s.provenance.location} (sha256 ${s.provenance.sha256.slice(0, 12)})`);
  }
  return linhas.join('\n');
}

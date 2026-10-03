/**
 * `ork board --all` e `ork board plan`: a visao unica e o escalonador por maquina (B2).
 *
 * `board --all` responde "o que esta rolando nesta maquina agora", com todas as threads
 * de todos os perfis encontrados: id, slug, modo, fase, status, pausas, worktree e leases.
 *
 * `board plan` responde a pergunta seguinte, que e a que evita incidente: "quem PODE
 * avancar agora?". Ele respeita duas coisas ao mesmo tempo:
 *   - `concurrency.max_parallel_threads` do manifesto (quantas threads a maquina aguenta);
 *   - os leases e a fila por colisao (quem esta na regiao de quem).
 *
 * O `main-tree` continua sendo o UNICO gate de merge: o escalonador nao mergeia nada, ele
 * apenas mostra a fila serializada que o `ork ship` ja obedece.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as adapter from './adapters/claude-bg';
import { estadosNasContas } from './sessoes-contas';
import {
  esperandoPor,
  expirado,
  LEASE_MAIN_TREE,
  lerFila,
  leasesDaThread,
  listarLeases,
  tipoDoLease,
} from './leases';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { dirEstado, ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import {
  avaliarOcupacao,
  ehAprovacaoHumana,
  EVENTOS_QUE_DESTRAVAM,
  OcupacaoDaThread,
  sessaoLivreDaVaga,
} from './ocupacao';
import { dirThread, lerThread, listarIds, pausasDaThread } from './thread';
import { PedidoNaFila, PlanoDoEscalonador, ThreadNoBoard, VagaDaThread } from './types';
import { agora, tabela } from './util';
import { ehRegistroDeAdocao } from './sessoes-adopt';
import { formatarDesde, legendaDoFuso, localizarTexto } from './horario';
import { conducaoDaThread, dormir } from './conducao';
import { linhaDeConducao } from './conducao-texto';

/** Um perfil de board: um diretorio de threads com um nome. */
export interface Perfil {
  nome: string;
  /** Raiz de projeto que serve este perfil. */
  raiz: string;
}

/**
 * Perfis detectados no projeto.
 *
 * O perfil padrao e o do manifesto (`board.default`), servido por `.orkastery/threads`.
 * Perfis adicionais sao detectados em `.orkastery/perfis/<nome>/`, quando existirem: e
 * assim que uma segunda configuracao de board entra no `--all` sem mudar o layout de disco.
 */
export function perfisDetectados(carregado: ManifestoCarregado): Perfil[] {
  const perfis: Perfil[] = [
    { nome: carregado.manifesto.board.default || 'default', raiz: carregado.raiz },
  ];
  const dirPerfis = path.join(dirEstado(carregado.raiz), 'perfis');
  if (fs.existsSync(dirPerfis)) {
    for (const e of fs.readdirSync(dirPerfis, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const raiz = path.join(dirPerfis, e.name);
      if (fs.existsSync(path.join(raiz, '.orkastery', 'threads'))) {
        perfis.push({ nome: e.name, raiz });
      }
    }
  }
  return perfis;
}

/** Todas as threads de todos os perfis, com os leases e a fila de cada uma. */
export function threadsDeTodosOsPerfis(
  carregado: ManifestoCarregado,
  todos = true
): ThreadNoBoard[] {
  const perfis = todos ? perfisDetectados(carregado) : perfisDetectados(carregado).slice(0, 1);
  const saida: ThreadNoBoard[] = [];
  for (const perfil of perfis) {
    const fila = lerFila(perfil.raiz);
    for (const id of listarIds(perfil.raiz)) {
      const thread = lerThread(perfil.raiz, id);
      saida.push({
        perfil: perfil.nome,
        raiz: perfil.raiz,
        thread,
        // I-36: a conducao (`exec:`) tem secao propria; o escalonador segue contando so os leases de escrita.
        leases: leasesDaThread(perfil.raiz, id).filter((l) => tipoDoLease(l.nome) !== 'exec').map((l) => l.nome),
        naFila: fila.filter((p) => p.thread === id),
      });
    }
  }
  return saida;
}

/** Opcoes do escalonador. Os testes fixam relogio e estados; o CLI usa os reais. */
export interface OpcoesDoPlano {
  /** Instante da decisao (os testes fixam; o CLI usa o relogio). */
  agora?: string;
  /**
   * Mapa sessionId -> state do runtime. `null` diz "runtime nao consultado";
   * omitido, o escalonador consulta o runtime quando ele esta disponivel.
   */
  estados?: Map<string, string> | null;
}

/**
 * Estados de sessao do runtime, ou null quando ele nao pode ser consultado. RM-056 (D7): de todas
 * as contas (a do processo e cada perfil do store), com o fantasma fora da vaga e o codex vivo.
 */
export function estadosDeSessao(raiz: string | null = null, staleMin?: number): Map<string, string> | null {
  if (!adapter.disponivel()) return null;
  return estadosNasContas(raiz, { staleMin });
}

/** Uma sessao viva de outra thread, que ocupa vaga do projeto. */
export interface SessaoQueOcupa { thread: string; fase: string | null; sessao: string | null; runtime: string | null; desde: string }

/** A recusa do portao de vaga do despacho, com quem ocupa e a correcao. */
export interface VagaRecusada { limite: number; ocupam: SessaoQueOcupa[]; detalhe: string; correcao: string }

/**
 * RM-037 (rm037defeito, defeito 3): o portao de vaga do `ork phase run`. Com `max_parallel_threads: 5`,
 * um sexto despacho saiu as 09h03 de 29/09/2026 com cinco sessoes vivas: o `phase run` nao consultava
 * vaga nenhuma, e o escalonador so via as sessoes `claude agents` de uma conta.
 *
 * Ocupa vaga a outra thread cuja conducao `exec:<thread>` e de uma sessao viva (a prova que vale para
 * claude-bg de qualquer conta e para codex, liberada por `phase_result`, `sessao_morta` ou
 * `session_superseded`), salvo a sessao parada ou escalada para o humano (`sessaoLivreDaVaga`; achados A1 e
 * N1 do CHECK: a pausa prevista e o verify reprovado nao param a sessao, e ela segue contando). Ocupa tambem o
 * despacho em curso de outra thread (conducao de processo do `phase.run` ou do `retry.run`), senao dois
 * pedidos simultaneos passariam juntos. A conducao da propria thread tem portao proprio. Somente leitura.
 */
export function vagaDoDespacho(carregado: ManifestoCarregado, threadId: string, quando: string = agora(),
  /** S-5 do CHECK 3: o `desde` da tomada deste despacho; despacho em curso de outra thread so conta se veio antes. */
  desdeProprio?: string): VagaRecusada | null {
  const { raiz, manifesto } = carregado;
  const limite = Math.max(1, manifesto.concurrency.max_parallel_threads);
  const staleMin = manifesto.concurrency.stale_after_min;
  const ocupam: SessaoQueOcupa[] = [];
  for (const id of listarIds(raiz)) {
    if (id === threadId) continue;
    let atual: ReturnType<typeof conducaoDaThread> = null;
    try { atual = conducaoDaThread(raiz, id); } catch { continue; }
    if (!atual) continue;
    const despachando = atual.dono.tipo === 'processo' && (atual.operacao === 'phase.run' || atual.operacao === 'retry.run');
    if (atual.dono.tipo !== 'sessao' && !despachando) continue;
    // Dois despachos disputando a ultima vaga nao se recusam um ao outro: quem tomou antes fica com ela.
    if (despachando && desdeProprio && (atual.desde > desdeProprio || (atual.desde === desdeProprio && id > threadId))) continue;
    if (atual.dono.tipo === 'sessao') {
      try { if (sessaoLivreDaVaga(lerLedger(dirThread(raiz, id)), atual.desde, quando, staleMin, atual.dono.sessionId)) continue; }
      catch { /* ledger ilegivel: a conducao viva continua contando */ }
    }
    ocupam.push({ thread: id, fase: atual.fase, desde: atual.desde,
      sessao: atual.dono.tipo === 'sessao' ? atual.dono.sessionId : null,
      runtime: atual.dono.tipo === 'sessao' ? atual.dono.runtime : null });
  }
  if (ocupam.length < limite) return null;
  ocupam.sort((a, b) => a.desde.localeCompare(b.desde));
  return {
    limite,
    ocupam,
    detalhe: `concurrency.limite: o projeto ja tem ${ocupam.length} sessao(oes) viva(s) em outras threads e o limite e ${limite} ` +
      `(concurrency.max_parallel_threads): ${ocupam.map((o) => `${o.thread} ${o.fase ?? '-'} ` +
        (o.sessao ? `${o.runtime} ${o.sessao.slice(0, 8)}` : 'despacho em curso')).join('; ')}`,
    correcao: 'espere uma sessao terminar e repita com --esperar <min>; sessao que morreu sem evento sai com ' +
      'ork conducao status <thread>; ou suba concurrency.max_parallel_threads no orkastery.yaml',
  };
}

/** `--esperar`: espera a vaga do projeto ate o prazo. Devolve true quando ha vaga. */
export function esperarVaga(carregado: ManifestoCarregado, threadId: string, esperarMs: number): boolean {
  const prazo = Date.now() + esperarMs;
  for (;;) {
    if (!vagaDoDespacho(carregado, threadId)) return true;
    if (Date.now() >= prazo) return false;
    dormir(Math.min(2000, prazo - Date.now()));
  }
}

/**
 * Escalonador por maquina: decide quem avanca agora e quem espera, com motivo tipado.
 *
 * A vaga e OCUPACAO REAL, nao existencia de thread aberta (correcao do incidente de
 * 06/09/2026): ocupa vaga quem tem procura ativa (`avaliarOcupacao`) ou quem segura
 * lease sem estar travada. Pausa humana aberta, impedimento nao-transitorio e stale
 * devolvem a vaga com motivo tipado, e a fila anda em FIFO por criacao da thread.
 */
export function planejar(
  carregado: ManifestoCarregado,
  opcoes: OpcoesDoPlano = {}
): PlanoDoEscalonador {
  const { raiz, manifesto } = carregado;
  const max = Math.max(1, manifesto.concurrency.max_parallel_threads);
  const staleMin = manifesto.concurrency.stale_after_min;
  const quando = opcoes.agora ?? agora();
  const estados = opcoes.estados === undefined ? estadosDeSessao(raiz, staleMin) : opcoes.estados;
  const fila = lerFila(raiz);
  // I-36: a conducao (`exec:`) nao entra na conta de vagas: a ocupacao da sessao ja sai do ledger
  // e do runtime (`avaliarOcupacao`), e conta-la de novo mudaria o escalonador.
  const ativos = listarLeases(raiz).filter((l) => !expirado(l) && tipoDoLease(l.nome) !== 'exec');

  const threads = listarIds(raiz)
    .map((id) => lerThread(raiz, id))
    .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm));

  const ocupacoes = new Map<string, OcupacaoDaThread>(
    threads.map((t) => [
      t.id,
      avaliarOcupacao(t, lerLedger(dirThread(raiz, t.id)), { agora: quando, estados, staleMin }),
    ])
  );

  const vagas: VagaDaThread[] = [];
  let ocupadas = 0;

  // 1a passada: quem tem procura ativa esta em andamento e ocupa vaga. Segurar lease
  // sem estar travada tambem ocupa: o lease e trabalho em curso na regiao protegida.
  const emAndamento = new Set<string>();
  for (const t of threads) {
    if (t.status === 'fechada' || ehRegistroDeAdocao(t)) continue;
    const oc = ocupacoes.get(t.id) as OcupacaoDaThread;
    const meus = ativos.filter((l) => l.thread === t.id).map((l) => l.nome);
    const ocupa = oc.ocupaVaga || (meus.length > 0 && oc.classe === 'ociosa');
    if (!ocupa) continue;
    emAndamento.add(t.id);
    ocupadas += 1;
    vagas.push({
      thread: t.id,
      slug: t.slug,
      modo: t.modo,
      fase: t.faseAtual,
      situacao: 'em-andamento',
      motivo: null,
      detalhe: meus.length > 0 ? `segura ${meus.join(', ')}; ${oc.detalhe}` : oc.detalhe,
      correcao: '',
      leases: meus,
    });
  }

  // 2a passada: as demais, em FIFO. Thread travada (pausa humana, impedimento, stale)
  // NAO ocupa vaga: e exatamente a thread orfa que sufocava as demandas legitimas.
  for (const t of threads) {
    if (emAndamento.has(t.id)) continue;
    const meus = ativos.filter((l) => l.thread === t.id).map((l) => l.nome);
    if (t.status === 'fechada') {
      vagas.push({
        thread: t.id,
        slug: t.slug,
        modo: t.modo,
        fase: t.faseAtual,
        situacao: 'fechada',
        motivo: null,
        detalhe: t.score ? `score ${t.score.valor}/5 registrado` : 'fechada sem score registrado',
        correcao: t.score ? '' : `ork master ${t.id} --score <0-5> --justificativa "<por que>"`,
        leases: [],
      });
      continue;
    }

    const oc = ocupacoes.get(t.id) as OcupacaoDaThread;
    if (ehRegistroDeAdocao(t)) {
      vagas.push({ thread: t.id, slug: t.slug, modo: t.modo, fase: t.faseAtual,
        situacao: oc.classe === 'pausa-humana' ? 'pausada' : 'espera',
        motivo: oc.motivo, detalhe: 'registro de adoção: identidade preservada, sem trabalho a despachar',
        correcao: oc.classe === 'pausa-humana' ? 'ork sessions hitl' : '', leases: meus });
      continue;
    }
    if (oc.classe === 'pausa-humana') {
      vagas.push({
        thread: t.id,
        slug: t.slug,
        modo: t.modo,
        fase: t.faseAtual,
        situacao: 'pausada',
        motivo: 'human.pending',
        detalhe: oc.detalhe,
        correcao: oc.correcao ?? `ork gate request ${t.id}`,
        leases: meus,
      });
      continue;
    }
    if (oc.classe === 'impedida') {
      vagas.push({
        thread: t.id,
        slug: t.slug,
        modo: t.modo,
        fase: t.faseAtual,
        situacao: 'espera',
        motivo: oc.motivo,
        detalhe: oc.detalhe,
        correcao: `ork retry plan ${t.id} --motivo ${String(oc.motivo)}, ou feche com ork master ${t.id}`,
        leases: meus,
      });
      continue;
    }
    if (oc.classe === 'stale') {
      vagas.push({
        thread: t.id,
        slug: t.slug,
        modo: t.modo,
        fase: t.faseAtual,
        situacao: 'espera',
        motivo: 'vaga.stale',
        detalhe: oc.detalhe,
        correcao:
          `redespache com ork phase run ${t.id} --fase ${t.faseAtual}, ` +
          `ou feche com ork master ${t.id}`,
        leases: meus,
      });
      continue;
    }

    const esperas = fila.filter((p) => p.thread === t.id);
    if (esperas.length > 0) {
      const p = esperas[0];
      vagas.push({
        thread: t.id,
        slug: t.slug,
        modo: t.modo,
        fase: t.faseAtual,
        situacao: 'espera',
        motivo: 'lease.busy',
        detalhe: `na fila de ${p.nome}, atras da thread ${p.bloqueadaPor} (colide com ${p.colidiuCom})`,
        correcao: `espere a thread ${p.bloqueadaPor} liberar, ou reduza a regiao pedida`,
        leases: [],
      });
      continue;
    }

    if (ocupadas >= max) {
      vagas.push({
        thread: t.id,
        slug: t.slug,
        modo: t.modo,
        fase: t.faseAtual,
        situacao: 'espera',
        motivo: 'concurrency.limite',
        detalhe: `a maquina ja tem ${ocupadas} thread(s) em andamento, o limite e ${max}`,
        correcao:
          'espere uma thread liberar, ou suba concurrency.max_parallel_threads no orkastery.yaml',
        leases: [],
      });
      continue;
    }

    ocupadas += 1;
    vagas.push({
      thread: t.id,
      slug: t.slug,
      modo: t.modo,
      fase: t.faseAtual,
      situacao: 'pode-avancar',
      motivo: null,
      detalhe: `vaga ${ocupadas}/${max}, sem colisao de lease`,
      correcao: '',
      leases: [],
    });
  }

  return {
    maxParalelas: max,
    emAndamento: emAndamento.size,
    vagas,
    filaDeMerge: esperandoPor(raiz, LEASE_MAIN_TREE),
    filaDeRegiao: fila.filter((p) => p.tipo !== 'main-tree'),
    decididoEm: quando,
  };
}

/** Uma vaga devolvida pelo `ork board reap`, com o registro que foi (ou nao) gravado. */
export interface VagaDevolvida {
  thread: string;
  classe: OcupacaoDaThread['classe'];
  motivo: NonNullable<OcupacaoDaThread['motivo']>;
  detalhe: string;
  evidencia: string;
  /** False quando um `slot_released` aberto ja registrava esta devolucao (idempotencia). */
  registrada: boolean;
}

/**
 * `ork board reap`: grava no ledger de cada thread SEM procura ativa o evento
 * `slot_released`, com quem decidiu, evidencia e razao.
 *
 * A vaga em si e derivada (o `planejar` ja a devolve sozinho a cada decisao); o reap
 * existe para a devolucao virar EVENTO VERIFICAVEL no ledger da thread devolvida.
 * Ele e idempotente: enquanto um `slot_released` estiver aberto (sem evento posterior
 * que destrave a thread), rodar de novo nao grava linha nova.
 */
export function devolverVagas(
  carregado: ManifestoCarregado,
  opcoes: OpcoesDoPlano & { por?: string } = {}
): VagaDevolvida[] {
  const { raiz, manifesto } = carregado;
  const staleMin = manifesto.concurrency.stale_after_min;
  const quando = opcoes.agora ?? agora();
  const estados = opcoes.estados === undefined ? estadosDeSessao(raiz, staleMin) : opcoes.estados;
  const quem = opcoes.por ?? 'escalonador (ork board reap)';

  const devolvidas: VagaDevolvida[] = [];
  for (const id of listarIds(raiz)) {
    const t = lerThread(raiz, id);
    if (t.status === 'fechada' || ehRegistroDeAdocao(t)) continue;
    const dir = dirThread(raiz, id);
    const eventos = lerLedger(dir);
    const oc = avaliarOcupacao(t, eventos, { agora: quando, estados, staleMin });
    if (oc.classe !== 'pausa-humana' && oc.classe !== 'impedida' && oc.classe !== 'stale') {
      continue;
    }

    const jaRegistrada = eventos.some(
      (e, i) =>
        e.tipo === TIPOS_DE_EVENTO.vagaLiberada &&
        !eventos
          .slice(i + 1)
          .some((p) => EVENTOS_QUE_DESTRAVAM.includes(p.tipo) || ehAprovacaoHumana(p))
    );
    if (!jaRegistrada) {
      registrar(dir, id, TIPOS_DE_EVENTO.vagaLiberada, {
        fase: t.faseAtual,
        motivo: oc.motivo,
        quem,
        detalhe: oc.detalhe,
        evidencia: oc.evidencia,
        razao:
          'thread sem procura ativa nao ocupa vaga de concurrency.max_parallel_threads: ' +
          'a vaga volta para as threads prontas para rodar',
      });
    }
    devolvidas.push({
      thread: id,
      classe: oc.classe,
      motivo: oc.motivo as NonNullable<OcupacaoDaThread['motivo']>,
      detalhe: oc.detalhe,
      evidencia: oc.evidencia,
      registrada: !jaRegistrada,
    });
  }
  return devolvidas;
}

/** Texto de `ork board reap`. */
export function textoDoReap(devolvidas: VagaDevolvida[]): string {
  if (devolvidas.length === 0) {
    return 'Nenhuma vaga a devolver: toda thread aberta tem procura ativa ou esta pronta para rodar.';
  }
  // I-35: o ledger guarda o ISO; o texto ao dono sai no fuso dele, rotulado uma vez.
  const linhas = [`Vagas devolvidas por falta de procura ativa: ${devolvidas.length}. ${legendaDoFuso()}`, ''];
  for (const d of devolvidas) {
    const marca = d.registrada ? 'slot_released gravado no ledger' : 'ja registrado antes (idempotente)';
    linhas.push(`  ${d.thread.padEnd(20)} [${d.motivo}] ${marca}`);
    linhas.push(`    detalhe  : ${localizarTexto(d.detalhe)}`);
    linhas.push(`    evidencia: ${localizarTexto(d.evidencia)}`);
  }
  return linhas.join('\n');
}

function linhaDeFila(p: PedidoNaFila, i: number, agora: string): string {
  return `  ${i + 1}. ${p.thread} quer ${p.nome} (colide com ${p.colidiuCom}, thread ${p.bloqueadaPor}) desde ${formatarDesde(p.desdeEm, { agora })}`;
}

/** Texto de `ork board plan`. */
export function textoDoPlano(plano: PlanoDoEscalonador): string {
  const linhas: string[] = [];
  linhas.push(`Escalonador por maquina. ${legendaDoFuso(undefined, plano.decididoEm)}`);
  linhas.push(
    `  limite de paralelismo: ${plano.maxParalelas} (concurrency.max_parallel_threads) | ` +
      `em andamento agora (procura ativa): ${plano.emAndamento}`
  );
  linhas.push('');
  if (plano.vagas.length === 0) {
    linhas.push('  Nenhuma thread no projeto.');
  } else {
    linhas.push(
      tabela(
        ['THREAD', 'SLUG', 'MODO', 'FASE', 'SITUACAO', 'MOTIVO', 'DETALHE'],
        plano.vagas.map((v) => [
          v.thread,
          v.slug,
          tagDoModo(v.modo),
          v.fase,
          v.situacao,
          v.motivo ?? '-',
          localizarTexto(v.detalhe, { agora: plano.decididoEm }),
        ])
      )
    );
    const comCorrecao = plano.vagas.filter((v) => v.correcao !== '');
    if (comCorrecao.length > 0) {
      linhas.push('');
      linhas.push('  Correcoes acionaveis:');
      for (const v of comCorrecao) linhas.push(`    ${v.thread}: ${localizarTexto(v.correcao, { agora: plano.decididoEm })}`);
    }
  }
  linhas.push('');
  linhas.push(`Merge queue (lease ${LEASE_MAIN_TREE}, o unico gate de merge)`);
  if (plano.filaDeMerge.length === 0) {
    linhas.push('  vazia: nenhuma thread esperando para mergear');
  } else {
    plano.filaDeMerge.forEach((p, i) => linhas.push(linhaDeFila(p, i, plano.decididoEm)));
  }
  linhas.push('');
  linhas.push('Fila por colisao de regiao');
  if (plano.filaDeRegiao.length === 0) {
    linhas.push('  vazia: nenhuma colisao de path, board ou porta');
  } else {
    plano.filaDeRegiao.forEach((p, i) => linhas.push(linhaDeFila(p, i, plano.decididoEm)));
  }
  return linhas.join('\n');
}

/** Texto de `ork board [--all]`: a visao unica das threads. */
export function textoDoBoard(carregado: ManifestoCarregado, todos: boolean): string {
  const itens = threadsDeTodosOsPerfis(carregado, todos);
  const perfis = todos ? perfisDetectados(carregado) : perfisDetectados(carregado).slice(0, 1);
  const linhas: string[] = [];
  linhas.push(
    `Board do Orkastery, projeto ${carregado.manifesto.project.name} ` +
      `(${itens.length} thread(s) em ${perfis.length} perfil(is): ${perfis.map((p) => p.nome).join(', ')})`
  );
  linhas.push('');
  if (itens.length === 0) {
    linhas.push('  Nenhuma thread ainda. Crie uma com: ork thread new "<nome>" --modo default');
    return linhas.join('\n');
  }

  linhas.push(
    tabela(
      ['PERFIL', 'ID', 'SLUG', 'MODO', 'FASE', 'STATUS', 'PAUSAS', 'SCORE', 'WORKTREE', 'LEASES'],
      itens.map((i) => [
        i.perfil,
        i.thread.id,
        i.thread.slug,
        tagDoModo(i.thread.modo),
        i.thread.faseAtual,
        i.thread.status,
        String(pausasDaThread(i.thread)),
        i.thread.score ? `${i.thread.score.valor}/5` : '-',
        i.thread.worktree ? path.basename(i.thread.worktree) : '-',
        i.leases.length > 0 ? i.leases.join(' ') : i.naFila.length > 0 ? `fila:${i.naFila[0].nome}` : '-',
      ])
    )
  );

  // I-36 (T17): quem conduz cada thread agora, pela leitura unica do nucleo.
  const conduzidas = itens.map((i) => ({ id: i.thread.id, c: conducaoDaThread(i.raiz, i.thread.id) })).filter((x) => x.c);
  if (conduzidas.length > 0) {
    linhas.push('');
    linhas.push('Conducao agora');
    for (const x of conduzidas) linhas.push(`  ${x.id}: ${linhaDeConducao(x.c!)}`);
  }

  const comVariante = itens.filter((i) => i.thread.variante);
  if (comVariante.length > 0) {
    linhas.push('');
    linhas.push('  Variantes de ciclo em uso:');
    for (const i of comVariante) linhas.push(`    ${i.thread.id}: --ciclo ${i.thread.variante}`);
  }

  linhas.push('');
  linhas.push(textoDoPlano(planejar(carregado)));

  const semScore = itens.filter((i) => !i.thread.score && i.thread.faseAtual === 'MASTER');
  if (semScore.length > 0) {
    linhas.push('');
    linhas.push(`Fila de batch scoring: ${semScore.length} thread(s) esperando score humano`);
    linhas.push('  veja em: ork master (com o indice derivado do ledger)');
  }
  return linhas.join('\n');
}

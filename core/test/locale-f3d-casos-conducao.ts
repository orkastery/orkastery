/**
 * RM-061, F3d (snapshot pt-BR): `conducao` (status, assumir, atualizar, autorizar, autorizacao, batida, sentinela), `lease`,
 * `board` e `orquestracao`/`monitor`. Os textos montados por funcao pura saem com entradas fixas; o que so o `index.ts`
 * imprime sai pelo CLI, em dois projetos (o da conducao e o da batida, sem thread nem autorizacao).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { textoDaAtualizacao } from '../src/atualizar-branch';
import { linhaDaAutorizacao, textoDaAutorizacao } from '../src/autorizacao-duravel';
import { textoDoPlano, textoDoReap } from '../src/board';
import { recusaDeConducao, textoDoStatusDaConducao } from '../src/conducao';
import { textoDaBatida } from '../src/conducao-batida';
import { textoDoStatusDaSentinela } from '../src/conducao-sentinela';
import { tabelaDeLeases } from '../src/leases';
import { textoDoMonitor } from '../src/orquestracao';
import { Ambiente, caso, Casos, dirTemp, idDaThread, ork, orkComEnv, projeto, SHA_64, SHA_A, T0, T1, T2, texto } from './locale-f3d-apoio';

/** Um instante bem a frente: o lease ou o candidato que ele marca nunca vence durante o teste. */
const FUTURO = '2099-01-01T00:00:00.000Z';

const SESSAO = { tipo: 'sessao', sessionId: 'sessao-loc-um', runtime: 'claude', perfil: null, maquina: 'pc-loc' };

/** Quem conduz: uma sessao do Claude Code no GO, com o prompt gravado. */
const CONDUCAO = { thread: 'loc-a', canal: 'claude-code', sessao: 'sessao-loc-um', fase: 'GO', desde: T0, promptSha256: SHA_64,
  operacao: 'phase.run', dono: SESSAO, expiraEm: T1, identidade: 'id-loc' };

function casosDoStatusEDaRecusa(casos: Casos): void {
  caso(casos, 'conducao: status livre', () => textoDoStatusDaConducao('loc-a', null));
  caso(casos, 'conducao: status de sessao com prompt', () => textoDoStatusDaConducao('loc-a', CONDUCAO as never));
  caso(casos, 'conducao: status de processo sem prompt', () => textoDoStatusDaConducao('loc-b', { ...CONDUCAO, thread: 'loc-b',
    canal: 'cli', sessao: null, fase: null, promptSha256: null, operacao: 'verify',
    dono: { tipo: 'processo', pid: 4242, inicio: T0, bootId: 'boot-loc', maquina: 'pc-loc' } } as never));
  caso(casos, 'conducao: recusa com quem conduz e prompt', () => recusaDeConducao('loc-a', CONDUCAO as never,
    { canal: 'hermes', operacao: 'phase.run', fase: 'GO', prazoMs: 0 } as never, { agora: T2 }).texto);
  caso(casos, 'conducao: recusa sem o registro de quem entra', () => recusaDeConducao('loc-a', null,
    { canal: 'mcp', operacao: 'mcp.verify', prazoMs: 0 } as never, { agora: T2 }).texto);
  caso(casos, 'conducao: recusa da atualizacao contra reserva', () => {
    const reserva = { ...CONDUCAO, canal: 'cli', sessao: null, fase: null, promptSha256: null, operacao: 'handoff',
      dono: { tipo: 'reserva', por: 'dono-loc', maquina: 'pc-loc' } };
    const r = recusaDeConducao('loc-a', reserva as never, { canal: 'openclaw', operacao: 'branch.atualizar', fase: null, prazoMs: 0 } as never,
      { agora: T2 });
    return [r.texto, JSON.stringify(r.acoes, null, 1)].join('\n');
  });
}

/** Um item da batida: o que ela fez, o que espera a proxima e o que ficou com o dono. */
function itemDaBatida(acao: string, thread: string, resultado: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { acao, thread, fase: null, resultado, motivo: null, oQue: `${acao} da ${thread}`, detalhe: '', comando: '', evidencia: '',
    desdeEm: null, pr: null, ...extra };
}

function casosDaBatidaEDaSentinela(casos: Casos): void {
  caso(casos, 'conducao: batida ocupada', () => textoDaBatida({ ocupada: true,
    detalhe: 'a trava varredura-acoes.lock esta com o pid 4242' } as never));
  caso(casos, 'conducao: batida autorizada com tudo', () => textoDaBatida({
    ocupada: false, contrato: 'ork.conducao-batida/v1', consultadoEm: T2, maquina: 'pc-loc',
    autorizacao: { valida: true, motivo: null, detalhe: null, por: 'dono-loc', ate: '2025-09-26T23:59:00-03:00', pode: ['merge', 'registrar'] },
    busca: { ok: false, detalhe: 'git fetch origin main saiu 128' }, forja: { ok: false, detalhe: 'gh fora do PATH desta maquina' },
    sentinela: true,
    feitas: [itemDaBatida('merge', 'loc-a', 'feita', { pr: 12, detalhe: 'merge conferido na base' }),
      itemDaBatida('registrar', 'loc-b', 'feita', { detalhe: 'ship_done gravado no ledger' })],
    pendentes: [itemDaBatida('merge', 'loc-c', 'espera', { pr: 13, motivo: 'checks-pendentes', detalhe: 'checks obrigatorios pendentes' }),
      itemDaBatida('despachar', 'loc-d', 'espera', { detalhe: 'a Sentinela despacha a fase' }),
      itemDaBatida('master', 'loc-e', 'dono', { motivo: 'acao-fora-da-autorizacao', detalhe: 'o MASTER pede a nota do dono',
        comando: 'ork master loc-e --score <0-5> --por <voce>' }),
      itemDaBatida('merge', 'loc-f', 'dono', { pr: 14, motivo: 'merge-recusado', detalhe: 'o PR tem conflito com a base',
        comando: 'ork conducao atualizar loc-f' })],
  } as never));
  caso(casos, 'conducao: batida sem autorizacao e sem nada', () => textoDaBatida({
    ocupada: false, contrato: 'ork.conducao-batida/v1', consultadoEm: T2, maquina: 'pc-loc',
    autorizacao: { valida: false, motivo: 'autorizacao.expirada', detalhe: 'o prazo acabou', por: null, ate: null, pode: [] },
    busca: { ok: true, detalhe: 'origin/main trazida' }, forja: null, sentinela: false, feitas: [], pendentes: [],
  } as never));

  const passo = (thread: string, modo: string, acao: string, fase: string | null, porque: string) => ({ thread, modo, faseAtual: 'GOAL',
    conduzida: false, acao, fase, caso: null, proximoPasso: null, porque, desdeEm: null, bloqueio: null });
  const presenca = (ativa: boolean) => ({ contrato: 'ork.sentinela/v1', canal: 'claude-code', maquina: 'pc-loc', sessao: 'sessao-loc-um',
    desde: T0, batidaEm: T1, expiraEm: T2, ativa });
  const status = (p: unknown, threads: unknown[]) => ({ contrato: 'ork.sentinela/v1', consultadoEm: T2, maquina: 'pc-loc', presenca: p,
    threads });
  caso(casos, 'conducao: sentinela desligada sem thread', () => textoDoStatusDaSentinela(status(null, []) as never));
  caso(casos, 'conducao: sentinela ligada com despacho', () => textoDoStatusDaSentinela(status(presenca(true), [
    passo('loc-a', 'auto', 'despachar', 'PLAN', 'o GOAL fechou e o PLAN ainda nao foi despachado'),
    passo('loc-b', 'classic', 'nada', null, 'modo classic: so o #Auto e conduzido sem o dono'),
  ]) as never));
  caso(casos, 'conducao: sentinela vencida', () => textoDoStatusDaSentinela(status(presenca(false), [
    passo('loc-c', 'auto', 'retomar', null, 'a cota do runtime voltou'),
  ]) as never));
}

function casosDaAtualizacaoEDaAutorizacao(casos: Casos): void {
  const cabeca = { contrato: 'ork.branch-atualizada/v1', thread: 'loc-a', branch: 'ork/loc-a-go', base: 'origin/main' };
  caso(casos, 'conducao: atualizacao ja atualizada', () => textoDaAtualizacao({ ...cabeca, acao: 'ja-atualizada', sha: SHA_A,
    enviada: false } as never));
  caso(casos, 'conducao: atualizacao ja atualizada e enviada', () => textoDaAtualizacao({ ...cabeca, acao: 'ja-atualizada', sha: SHA_A,
    enviada: true } as never));
  caso(casos, 'conducao: atualizacao mesclada com changelog e enviada', () => textoDaAtualizacao({ ...cabeca, acao: 'mesclada', sha: SHA_A,
    shaAntes: SHA_A, changelog: { devolvidos: 2, itens: [] }, enviada: true } as never));
  caso(casos, 'conducao: atualizacao mesclada sem changelog', () => textoDaAtualizacao({ ...cabeca, acao: 'mesclada', sha: SHA_A,
    shaAntes: SHA_A, changelog: null, enviada: false } as never));
  caso(casos, 'conducao: atualizacao com conflito em codigo', () => textoDaAtualizacao({ ...cabeca, acao: 'conflito-em-codigo',
    arquivos: ['core/src/a.ts', 'core/src/b.ts'] } as never));
  caso(casos, 'conducao: atualizacao recusada', () => textoDaAtualizacao({ ...cabeca, acao: 'recusada', motivo: 'worktree-suja',
    detalhe: 'a worktree tem alteração não commitada; o merge não vai por cima dela' } as never));

  const arquivo = '/repo/.orkastery/monitor/autorizacao.json';
  const autorizacao = { contrato: 'ork.autorizacao-duravel/v1', maquina: 'pc-loc', projeto: 'loc', por: 'dono-loc',
    concedidaEm: '2025-09-19T15:16:00-03:00', ate: '2025-09-26T23:59:00-03:00', pode: ['merge', 'registrar', 'master'] };
  const leituras: Array<[string, Record<string, unknown>]> = [
    ['valida com nota', { valida: true, arquivo, autorizacao: { ...autorizacao, nota: 'X1.a' }, sha256: SHA_64 }],
    ['valida sem nota', { valida: true, arquivo, autorizacao, sha256: SHA_64 }],
    ['ausente', { valida: false, arquivo, motivo: 'autorizacao.ausente', detalhe: 'nenhuma autorizacao duravel gravada nesta maquina' }],
    ['expirada', { valida: false, arquivo, motivo: 'autorizacao.expirada', detalhe: 'o prazo acabou em 26/09 23:59 (horário de Brasília)',
      autorizacao }],
  ];
  for (const [nome, leitura] of leituras) {
    caso(casos, `conducao: autorizacao ${nome}`, () => [textoDaAutorizacao(leitura as never, T2), linhaDaAutorizacao(leitura as never, T2)]
      .join('\n'));
  }
}

function casosDoBoardPuro(casos: Casos): void {
  const pedido = (nome: string, tipo: string, thread: string, desdeEm: string, colidiuCom: string, bloqueadaPor: string) =>
    ({ nome, tipo, thread, motivo: 'GO', desdeEm, colidiuCom, bloqueadaPor });
  caso(casos, 'board: plano sem thread', () => textoDoPlano({ decididoEm: T2, maxParalelas: 3, emAndamento: 0, vagas: [],
    filaDeMerge: [], filaDeRegiao: [] } as never));
  caso(casos, 'board: plano com correcoes e filas', () => textoDoPlano({ decididoEm: T2, maxParalelas: 2, emAndamento: 2,
    vagas: [
      { thread: 'loc-a', slug: 'loc-a-go', modo: 'auto', fase: 'GO', situacao: 'em-andamento', motivo: null,
        detalhe: `sessao viva desde ${T0}`, correcao: '', leases: ['path:src/**'] },
      { thread: 'loc-b', slug: 'loc-b-plan', modo: 'classic', fase: 'PLAN', situacao: 'espera', motivo: 'concurrency.limite',
        detalhe: 'limite de 2 thread(s) em andamento nesta maquina', correcao: `espere uma vaga (a loc-a despachou em ${T0})`, leases: [] },
      { thread: 'loc-c', slug: 'loc-c-ship', modo: 'maestro', fase: 'SHIP', situacao: 'espera', motivo: 'lease.busy',
        detalhe: 'na fila de main-tree, atras da thread loc-d', correcao: 'espere a thread loc-d liberar o main-tree', leases: [] },
    ],
    filaDeMerge: [pedido('main-tree', 'main-tree', 'loc-c', T0, 'main-tree', 'loc-d')],
    filaDeRegiao: [pedido('path:src/a/**', 'path', 'loc-e', T1, 'path:src/**', 'loc-a')],
  } as never));
  caso(casos, 'board: reap sem vaga', () => textoDoReap([]));
  caso(casos, 'board: reap com vagas', () => textoDoReap([
    { thread: 'loc-a', classe: 'parada', motivo: 'vaga.stale', detalhe: `sem despacho desde ${T0}`,
      evidencia: `ledger phase_dispatch em ${T0}`, registrada: true },
    { thread: 'loc-b', classe: 'parada', motivo: 'human.pending', detalhe: 'pausa humana aberta no GOAL',
      evidencia: 'ledger human_pause', registrada: false },
  ] as never));
}

/** Uma parada do monitor; o padrao e a pausa humana do GOAL que ja vale. */
function parada(extra: Record<string, unknown>): Record<string, unknown> {
  return { natureza: 'pausa-humana', motivo: 'human.pending', fase: 'GOAL', bloco: 'GOAL', pausaSobre: 'objetivo',
    detalhe: `o bloco GOAL fechou em ${T0}: a pausa do objetivo vale`, evidencia: 'ledger human_pause (pausa prevista)',
    correcao: 'ork gate approve loc-a --por <voce>', desdeEm: T0, paradaHaMin: 84, sessaoViva: false, fonte: 'ledger', ...extra };
}

/** Uma linha do monitor; o padrao e a thread que pode avancar, sem parada. */
function linhaDoMonitor(extra: Record<string, unknown>): Record<string, unknown> {
  return { perfil: 'default', thread: 'loc-d', slug: 'loc-d-goal', nome: 'pedido d', modo: 'classic', tag: '#Classic', faseAtual: 'GOAL',
    status: 'aberta', situacao: 'pode-avancar', pausas: [], impedimentos: [], paradas: [],
    ultimoEvento: { tipo: 'thread_created', ts: T0, fase: 'GOAL' }, paradaHaMin: null, precisaDeHumano: false, temImpedimento: false,
    acimaDoLimite: false, conducao: null, ...extra };
}

function casosDoMonitorPuro(casos: Casos): void {
  const monitor = (linhas: unknown[], resumo: Record<string, number>, runtime: boolean) => ({ projeto: 'loc', consultadoEm: T2,
    atencaoMin: 30, runtimeConsultado: runtime, runtimeDetalhe: runtime ? '' : 'runtime nao consultado por --sem-runtime',
    perfis: ['default'], linhas, resumo: { threads: linhas.length, aguardandoHumano: 0, comImpedimento: 0, emAndamento: 0, podemAvancar: 0,
      fechadas: 0, acimaDoLimite: 0, ...resumo } });
  caso(casos, 'monitor: sem thread', () => textoDoMonitor(monitor([], {}, true) as never));
  caso(casos, 'monitor: sem parada', () => textoDoMonitor(monitor([linhaDoMonitor({})], { podemAvancar: 1 }, true) as never));
  const pausa = parada({});
  const impedimento = parada({ natureza: 'impedimento', motivo: 'lease.busy', bloco: '', pausaSobre: '',
    detalhe: 'na fila de path:src/**, atras da thread loc-a', evidencia: '.orkastery/leases/fila.json (path)',
    correcao: "espere a thread loc-a liberar (ork lease release 'path:src/**' --thread 'loc-a')", desdeEm: T1, paradaHaMin: 78,
    sessaoViva: null, fonte: 'fila-de-lease' });
  const prevista = parada({ fase: 'PLAN', bloco: 'PLAN', pausaSobre: 'plano', detalhe: 'a sessao sessao-l trabalha no PLAN',
    sessaoViva: true, paradaHaMin: 0 });
  const semBloco = parada({ fase: 'PLAN', bloco: '', pausaSobre: 'autorizacao da retomada', sessaoViva: true, paradaHaMin: 0 });
  caso(casos, 'monitor: paradas, conducao e todas as situacoes', () => textoDoMonitor(monitor([
    linhaDoMonitor({ thread: 'loc-a', slug: 'loc-a-goal', nome: 'pedido a', situacao: 'pausada', pausas: [pausa], paradas: [pausa],
      ultimoEvento: { tipo: 'human_pause', ts: T0, fase: 'GOAL' }, paradaHaMin: 84, precisaDeHumano: true, acimaDoLimite: true }),
    linhaDoMonitor({ thread: 'loc-b', slug: 'loc-b-go', nome: 'pedido b', faseAtual: 'GO', situacao: 'espera',
      impedimentos: [impedimento], paradas: [impedimento], paradaHaMin: 78, temImpedimento: true, acimaDoLimite: true }),
    linhaDoMonitor({ thread: 'loc-c', slug: 'loc-c-plan', nome: 'pedido c', faseAtual: 'PLAN', situacao: 'em-andamento',
      pausas: [prevista, semBloco], paradas: [prevista, semBloco], paradaHaMin: 0, conducao: { ...CONDUCAO, thread: 'loc-c', fase: 'PLAN' } }),
    linhaDoMonitor({ ultimoEvento: null }),
    linhaDoMonitor({ thread: 'loc-e', slug: 'loc-e-master', nome: 'pedido e', faseAtual: 'MASTER', status: 'fechada',
      situacao: 'fechada' }),
  ], { aguardandoHumano: 1, comImpedimento: 1, emAndamento: 1, podemAvancar: 1, fechadas: 1, acimaDoLimite: 2 }, false) as never));
}

/**
 * `ork lease list` sobre um estado montado a mao: canonicos vivo, vencido e de execucao, o legado de uma worktree (vivo e
 * ilegivel), as duas filas por colisao e a fila de retomada (candidato, temporario vencido e uma fila insegura).
 */
function casosDaTabelaDeLeases(casos: Casos): void {
  const vazia = dirTemp('leases-vazia', '<LEASES>');
  caso(casos, 'lease: tabela vazia', () => tabelaDeLeases(vazia));

  const base = dirTemp('leases-cheia', '<LEASES>');
  const raiz = path.join(base, 'projeto'), wt = path.join(base, 'worktree');
  const registro = path.join(raiz, '.git', 'worktrees', 'thread');
  const canonico = path.join(raiz, '.orkastery', 'leases'), legado = path.join(wt, '.orkastery', 'leases');
  for (const dir of [registro, canonico, legado]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(registro, 'gitdir'), path.join(wt, '.git') + '\n');
  fs.writeFileSync(path.join(registro, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${registro}\n`);
  const gravar = (dir: string, lease: Record<string, unknown>) =>
    fs.writeFileSync(path.join(dir, `${encodeURIComponent(String(lease.nome))}.json`), JSON.stringify(lease, null, 2) + '\n');
  gravar(canonico, { nome: 'main-tree', thread: 'loc-a', motivo: 'ship da loc-a', pid: 4242, adquiridoEm: T0, expiraEm: T1 });
  gravar(canonico, { nome: 'path:core/src/**', thread: 'loc-b', motivo: 'GO da loc-b', pid: 4243, adquiridoEm: T0, expiraEm: FUTURO });
  gravar(canonico, { nome: 'exec:loc-c', thread: 'loc-c', motivo: 'despacho de fase pelo canal claude-code', pid: 4244, adquiridoEm: T0,
    expiraEm: FUTURO, conducao: { contrato: 'ork.conducao/v1', canal: 'claude-code', correlacao: null, operacao: 'phase.run', fase: 'GO',
      promptSha256: SHA_64, identidade: 'id-loc', dono: SESSAO } });
  // O legado so vale vivo e dentro de 30 min: o prazo dele conta do relogio de quem roda (a data sai normalizada).
  const inicio = Date.now() - 60_000;
  gravar(legado, { nome: 'path:docs/**', thread: 'loc-d', motivo: 'legado', pid: 4245, adquiridoEm: new Date(inicio).toISOString(),
    expiraEm: new Date(inicio + 20 * 60_000).toISOString() });
  fs.writeFileSync(path.join(legado, 'path%3Aquebrado.json'), '{');
  fs.writeFileSync(path.join(canonico, 'fila.json'), JSON.stringify([
    { nome: 'main-tree', tipo: 'main-tree', thread: 'loc-e', motivo: 'ship', desdeEm: T0, colidiuCom: 'main-tree', bloqueadaPor: 'loc-a' },
    { nome: 'path:core/src/a/**', tipo: 'path', thread: 'loc-f', motivo: 'GO', desdeEm: T1, colidiuCom: 'path:core/src/**',
      bloqueadaPor: 'loc-b' },
  ], null, 2) + '\n');
  const retomadas = path.join(canonico, 'main-tree.json.retomadas');
  fs.mkdirSync(retomadas);
  const candidato = path.join(retomadas, '4246-a1b2.json'), temporario = path.join(retomadas, '4247-c3d4.json.tmp');
  fs.writeFileSync(candidato, JSON.stringify({ ticket: 3 }));
  fs.writeFileSync(temporario, '{"tick');
  fs.utimesSync(candidato, new Date(FUTURO), new Date(FUTURO));
  fs.utimesSync(temporario, new Date(T0), new Date(T0));
  fs.writeFileSync(path.join(canonico, 'path%3Acore.json.retomadas'), 'nao e pasta');
  // A espera na fila e a idade do candidato contam do relogio de quem roda: os dias e as horas mudam a cada execucao.
  caso(casos, 'lease: tabela com legado, filas e retomada', () => tabelaDeLeases(raiz)
    .replace(/\(há [^)]*\)/g, '(há <TEMPO>)').replace(/idade \d+s/g, 'idade <N>s'));
}

/** A thread passa ao MASTER sem nota: a fila de batch scoring do board. */
function levarAoMaster(repo: string, id: string): void {
  const arquivo = path.join(repo, '.orkastery', 'threads', id, 'thread.json');
  const thread = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(arquivo, JSON.stringify({ ...thread, faseAtual: 'MASTER' }, null, 2) + '\n');
}

function casosDaConducaoNoCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('conducao', 'cond', amb);
  const id = idDaThread(ork(repo, amb, 'thread', 'new', 'cond-a', '--sem-worktree'));
  const gap = idDaThread(ork(repo, amb, 'thread', 'new', 'cond-gap', '--sem-worktree', '--ciclo', 'gap'));
  const cli = (...args: string[]) => texto(ork(repo, amb, ...args));

  caso(casos, 'cli conducao: subcomando desconhecido', () => cli('conducao', 'voar'));
  caso(casos, 'cli conducao: status sem thread', () => cli('conducao', 'status'));
  caso(casos, 'cli conducao: status livre', () => cli('conducao', 'status', id));
  caso(casos, 'cli conducao: atualizar sem thread', () => cli('conducao', 'atualizar'));
  caso(casos, 'cli conducao: atualizar sem worktree', () => cli('conducao', 'atualizar', id));
  caso(casos, 'cli conducao: batida com argumento a mais', () => cli('conducao', 'batida', 'agora'));

  caso(casos, 'cli conducao: sentinela com acao desconhecida', () => cli('conducao', 'sentinela', 'voar'));
  caso(casos, 'cli conducao: sentinela bater sem sessao', () => cli('conducao', 'sentinela', 'bater'));
  caso(casos, 'cli conducao: sentinela status desligada', () => cli('conducao', 'sentinela', 'status'));
  caso(casos, 'cli conducao: sentinela bater liga', () => cli('conducao', 'sentinela', 'bater', '--sessao', 'sessao-loc-um'));
  caso(casos, 'cli conducao: sentinela bater renova', () => cli('conducao', 'sentinela', 'bater', '--sessao', 'sessao-loc-um'));
  caso(casos, 'cli conducao: sentinela bater de outra sessao', () => cli('conducao', 'sentinela', 'bater', '--sessao', 'sessao-loc-dois'));
  caso(casos, 'cli conducao: sentinela status ligada', () => cli('conducao', 'sentinela'));
  caso(casos, 'cli conducao: sentinela desligar de outra sessao', () => cli('conducao', 'sentinela', 'desligar', '--sessao', 'sessao-loc-dois'));
  caso(casos, 'cli conducao: sentinela desligar', () => cli('conducao', 'sentinela', 'desligar', '--sessao', 'sessao-loc-um',
    '--motivo', 'fim do teste'));

  caso(casos, 'cli conducao: autorizacao ausente', () => cli('conducao', 'autorizacao'));
  caso(casos, 'cli conducao: autorizacao com argumento a mais', () => cli('conducao', 'autorizacao', 'agora'));
  caso(casos, 'cli conducao: autorizar sem prazo', () => cli('conducao', 'autorizar', '--pode', 'merge'));
  caso(casos, 'cli conducao: autorizar com prazo invalido', () => cli('conducao', 'autorizar', '--ate', 'amanha', '--pode', 'merge',
    '--por', 'dono-loc'));
  // O prazo precisa estar entre agora e 31 dias: uma semana a frente do relogio (a data sai normalizada).
  const ate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  caso(casos, 'cli conducao: autorizar com acao proibida', () => cli('conducao', 'autorizar', '--ate', ate, '--pode', 'merge,tag',
    '--por', 'dono-loc'));
  caso(casos, 'cli conducao: autorizar', () => cli('conducao', 'autorizar', '--ate', ate, '--pode', 'merge,registrar', '--por', 'dono-loc'));
  caso(casos, 'cli conducao: autorizar de novo substitui a anterior', () => cli('conducao', 'autorizar', '--ate', ate, '--pode', 'merge',
    '--por', 'dono-loc', '--nota', 'X1.a'));
  // O sha256 do arquivo muda com o instante da concessao, gravado nele.
  caso(casos, 'cli conducao: autorizacao valida', () => cli('conducao', 'autorizacao').replace(/sha256 [0-9a-f]{12}\b/g, 'sha256 <SHA12>'));

  caso(casos, 'cli conducao: assumir sem motivo', () => cli('conducao', 'assumir', id, '--por', 'dono-loc'));
  caso(casos, 'cli conducao: assumir', () => cli('conducao', 'assumir', id, '--por', 'dono-loc', '--motivo', 'teste de handoff'));
  caso(casos, 'cli conducao: status conduzida', () => cli('conducao', 'status', id));
  caso(casos, 'cli conducao: verify recusado por outro canal', () => cli('verify', id, '--canal', 'hermes'));

  caso(casos, 'cli board: list com conducao e variante', () => cli('board'));
  caso(casos, 'cli board: plan', () => cli('board', 'plan'));
  caso(casos, 'cli board: reap sem vaga', () => cli('board', 'reap'));
  caso(casos, 'cli board: subcomando desconhecido', () => cli('board', 'voar'));
  caso(casos, 'cli orquestracao: status sem runtime', () => cli('orquestracao', 'status', '--sem-runtime'));
  caso(casos, 'cli orquestracao: subcomando desconhecido', () => cli('orquestracao', 'voar'));
  caso(casos, 'cli monitor: atencao invalida', () => cli('monitor', '--atencao', 'x'));
  levarAoMaster(repo, gap);
  caso(casos, 'cli board: batch scoring e fabrica sem remoto', () => texto(orkComEnv(repo, amb, { ORK_FABRICA_COMPARTILHADA: '1' }, 'board')));

  caso(casos, 'cli lease: subcomando desconhecido', () => cli('lease', 'voar'));
  caso(casos, 'cli lease: acquire sem nome', () => cli('lease', 'acquire', '--thread', id));
  caso(casos, 'cli lease: release sem nome', () => cli('lease', 'release'));
  caso(casos, 'cli lease: acquire sem motivo', () => cli('lease', 'acquire', 'path:src/**', '--thread', id));
  caso(casos, 'cli lease: acquire que colide', () => cli('lease', 'acquire', 'path:src/a/**', '--thread', gap, '--motivo', 'mexer em a'));
  caso(casos, 'cli lease: release com fila', () => cli('lease', 'release', 'path:src/**', '--thread', id));
  caso(casos, 'cli lease: acquire na vez da fila', () => cli('lease', 'acquire', 'path:src/a/**', '--thread', gap, '--motivo', 'mexer em a'));
  fs.writeFileSync(path.join(repo, '.orkastery', 'leases', `${encodeURIComponent('path:docs/**')}.json`),
    JSON.stringify({ nome: 'path:docs/**', thread: id, motivo: 'documentar', pid: 4242, adquiridoEm: T0, expiraEm: T1 }, null, 2) + '\n');
  caso(casos, 'cli lease: list com vencido', () => cli('lease', 'list'));
  caso(casos, 'cli lease: take de vencido', () => cli('lease', 'take', 'path:docs/**', '--thread', gap, '--motivo', 'docs'));
  caso(casos, 'cli lease: list padrao', () => cli('lease'));
}

/**
 * O projeto sem thread nem autorizacao: o board vazio e a batida, em que nada anda sozinho e a entrega pelo pulse falha
 * sem rede (sem o arquivo do transporte, e com um transporte que sai 1).
 */
function casosDaBatidaNoCli(casos: Casos, amb: Ambiente): void {
  const repo = projeto('batida', 'bat', amb);
  caso(casos, 'cli board: list sem thread', () => texto(ork(repo, amb, 'board', 'list')));
  caso(casos, 'cli conducao: batida sem transporte do pulse', () => texto(ork(repo, amb, 'conducao', 'batida', '--entregar')));
  const monitor = path.join(repo, '.orkastery', 'monitor');
  fs.mkdirSync(monitor, { recursive: true });
  fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ executavel: 'false', argumentos: ['{{mensagem}}'] }) + '\n');
  caso(casos, 'cli conducao: batida com transporte que falha', () => texto(ork(repo, amb, 'conducao', 'batida', '--entregar')));
}

export function gerarGrupo(casos: Casos, amb: Ambiente): void {
  casosDoStatusEDaRecusa(casos);
  casosDaBatidaEDaSentinela(casos);
  casosDaAtualizacaoEDaAutorizacao(casos);
  casosDoBoardPuro(casos);
  casosDoMonitorPuro(casos);
  casosDaTabelaDeLeases(casos);
  casosDaConducaoNoCli(casos, amb);
  casosDaBatidaNoCli(casos, amb);
}

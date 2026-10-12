/**
 * R3 do ensaio da RM-049 (decisao do dono, alternativa a): quando uma thread fora do roadmap espera o
 * dono, o `ork roadmap status` dizia "O que precisa de você: Nada agora" e o `ork pulse` dizia
 * "Precisa de humano agora: 1". Agora o fecho ganha a linha "Fora do roadmap: N thread(s) esperam
 * você (ork pulse)", so quando ha, e o `--json` o campo opcional e aditivo `foraDoRoadmap`.
 *
 * Prova: a linha e o campo com o impedimento do dono (o caso do ensaio) e com o gate do #Classic; o
 * item do roadmap continua no #HITL e nao conta como fora; e, sem thread fora do roadmap esperando,
 * o texto e o JSON saem byte a byte como antes. Projeto, itens e threads SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { definirFusoDoDono } from '../src/horario';
import { main } from '../src/index';

const QUANDO = '2026-10-03T05:34:00.000Z'; // 03/10 02:34 em Brasília, a hora do ensaio
const LINHA = (n: number) => `• Fora do roadmap: ${n} thread(s) esperam você (ork pulse).`;

function item(dir: string, id: string, titulo: string, ciclo: string, thread?: string): void {
  const fm = ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "${titulo}"`, 'categoria: melhoria', 'pai: null', 'features: []',
    'owner: Dono', 'atualizado_em: 2026-10-03T00:00:00-03:00', 'estado:', `  ciclo: ${ciclo}`, '  documentacao: Rascunho',
    '  codigo: Não iniciado', '  testes: Não iniciados', '  deploy: Não implantado', '  exposicao: Flag desligada',
    '  habilitacao: Pendente', 'evidencias:', '  codigo:', '    commit: null', '    pr: null',
    'sdlc:', `  thread: ${thread ?? 'null'}`, '---', '', `# ${id}`, ''].join('\n');
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', `${id}-simulado.md`), fm);
}

/** O projeto do ensaio: um item conduzido sem espera e, quando pedido, threads fora do roadmap. */
function projeto(nome: string) {
  const p = projetoTemporario(nome);
  definirFusoDoDono('America/Sao_Paulo');
  const { thread: conduz } = novaThread(p.carregado, { nome: 'conduz item', modo: 'auto' });
  registrar(dirThread(p.dir, conduz.id), conduz.id, 'phase_dispatch', { fase: 'GOAL', runtime: 'claude-bg' });
  item(p.dir, 'RM-001', 'Fundação: o começo', 'Concluído');
  item(p.dir, 'RM-002', 'Em curso', 'Em desenvolvimento', conduz.id);
  return { p, conduz };
}

/** A thread fora do roadmap parada pelo impedimento do dono, como no ensaio (comandos 66 a 68). */
function foraComImpedimento(p: ReturnType<typeof projetoTemporario>, nome = 'fora impedida') {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', { fase: 'GOAL', motivo: 'runtime.workspace-untrusted',
    detalhe: 'Workspace not trusted (simulado)', correcao: `ork retry run ${thread.id}` });
  return thread;
}

const texto = (dir: string) => textoDoStatusDoRoadmap(montarStatusDoRoadmap(dir, { quando: QUANDO, projeto: 'brinquedo' }));

test('R3: thread fora do roadmap parada pelo impedimento do dono acende a linha e o campo', () => {
  const { p } = projeto('r3-impedimento');
  try {
    const fora = foraComImpedimento(p);
    const s = montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'brinquedo' });
    assert.deepEqual(s.foraDoRoadmap, { threads: [fora.id] });
    const linhas = textoDoStatusDoRoadmap(s).split('\n');
    const precisa = linhas.indexOf('O que precisa de você');
    // Alternativa a, não b: o "Nada agora" do item continua, e a linha vem logo debaixo.
    assert.deepEqual(linhas.slice(precisa, precisa + 3), ['O que precisa de você', '• Nada agora.', LINHA(1)]);
    assert.equal(linhas.filter(l => l.startsWith('• Fora do roadmap')).length, 1);
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('R3: o gate do #Classic fora do roadmap também conta, e o item no #HITL não conta como fora', () => {
  const { p } = projeto('r3-classic');
  try {
    const { thread: classic } = novaThread(p.carregado, { nome: 'fora classic', modo: 'classic' });
    registrar(dirThread(p.dir, classic.id), classic.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const { thread: noItem } = novaThread(p.carregado, { nome: 'no item', modo: 'classic' });
    registrar(dirThread(p.dir, noItem.id), noItem.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    item(p.dir, 'RM-003', 'Espera o dono', 'Em desenvolvimento', noItem.id);
    const fora = foraComImpedimento(p);
    const s = montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'brinquedo' });
    assert.deepEqual(s.foraDoRoadmap, { threads: [classic.id, fora.id].sort() });
    assert.deepEqual(s.precisaDeVoce.map(x => x.item), ['RM-003']);
    const linhas = textoDoStatusDoRoadmap(s).split('\n');
    const precisa = linhas.indexOf('O que precisa de você');
    assert.match(linhas[precisa + 1], /^• RM-003: /);
    assert.equal(linhas[precisa + 2], LINHA(2));
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('R3: CLI --json traz foraDoRoadmap e o texto traz a linha', () => {
  const { p } = projeto('r3-cli');
  const cwd = process.cwd(), log = console.log;
  try {
    const fora = foraComImpedimento(p);
    process.chdir(p.dir);
    let saida = ''; console.log = (s: unknown) => { saida += String(s) + '\n'; };
    assert.equal(main(['roadmap', 'status', '--json']), 0);
    assert.deepEqual(JSON.parse(saida).foraDoRoadmap, { threads: [fora.id] });
    saida = '';
    assert.equal(main(['roadmap', 'status']), 0);
    assert.ok(saida.split('\n').includes(LINHA(1)), saida);
  } finally { console.log = log; process.chdir(cwd); p.limpar(); definirFusoDoDono(undefined); }
});

test('R3: sem thread fora do roadmap esperando, texto e JSON saem byte a byte como antes', () => {
  const { p, conduz } = projeto('r3-identico');
  try {
    // Fora do roadmap, mas sem esperar: impedimento já destravado pelo re-despacho, e uma thread fechada impedida.
    const destravada = foraComImpedimento(p, 'fora destravada');
    registrar(dirThread(p.dir, destravada.id), destravada.id, 'phase_dispatch', { fase: 'GOAL', runtime: 'claude-bg' });
    const fechada = foraComImpedimento(p, 'fora fechada');
    const t = lerThread(p.dir, fechada.id); t.status = 'fechada'; gravarThread(p.dir, t);
    const s = montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'brinquedo' });
    assert.equal('foraDoRoadmap' in s, false);
    // As chaves do contrato aprovado, nem uma a mais.
    assert.deepEqual(Object.keys(s), ['contrato', 'consultadoEm', 'projeto', 'grupos', 'precisaDeVoce', 'emSeguida']);
    assert.equal(texto(p.dir), [
      'Roadmap do Brinquedo (03/10, 02:34)',
      'Horários de Brasília.',
      '',
      '✅ Concluídos',
      '• RM-001 Fundação',
      '',
      '🔨 Em desenvolvimento',
      '• RM-002 Em curso (GOAL)',
      '',
      'O que precisa de você',
      '• Nada agora.',
      '',
      'O que eu faço em seguida',
      `• RM-002: sigo ${conduz.id} na fase GOAL.`,
    ].join('\n'));
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

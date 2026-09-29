/**
 * RM-048 (item 7, D7): o status report unico do roadmap, no formato aprovado pelo dono.
 *
 * Prova, pelo texto e pelos dados: o titulo no fuso do dono; os grupos na ordem e com os icones;
 * um item por linha; "Entregue hoje" pelo `ship_done` do dia; #HITL so no que espera o DONO (nunca
 * no impedimento tecnico); o fecho com o que precisa dele e o que vem a seguir; e que o relatorio e
 * leitura pura (o ledger nao muda um byte). Projeto, itens e threads SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { CONTRATO_STATUS_DO_ROADMAP, GRUPOS_DO_ROADMAP, montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { abrirPedidoGate } from '../src/hitl-gates';
import { definirFusoDoDono } from '../src/horario';
import { main } from '../src/index';

const QUANDO = '2026-09-29T00:10:00.000Z'; // 28/09 21:10 em Brasília

function item(dir: string, id: string, titulo: string, ciclo: string, extra: { thread?: string; exposicao?: string; habilitacao?: string } = {}): void {
  const fm = ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "${titulo}"`, 'categoria: melhoria', 'pai: null', 'features: []',
    'owner: Dono', 'atualizado_em: 2026-09-28T10:00:00-03:00', 'estado:', `  ciclo: ${ciclo}`, '  documentacao: Rascunho',
    '  codigo: Não iniciado', '  testes: Não iniciados', '  deploy: Não implantado', `  exposicao: ${extra.exposicao ?? 'Flag desligada'}`,
    `  habilitacao: ${extra.habilitacao ?? 'Pendente'}`, 'evidencias:', '  codigo:', '    commit: null', '    pr: null',
    'sdlc:', `  thread: ${extra.thread ?? 'null'}`, '---', '', `# ${id}`, ''].join('\n');
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', `${id}-simulado.md`), fm);
}

function projeto(nome: string) {
  const p = projetoTemporario(nome);
  definirFusoDoDono('America/Sao_Paulo');
  // Thread no gate do #Classic: espera o veredito do dono.
  const { thread: gate } = novaThread(p.carregado, { nome: 'gate classic', modo: 'classic' });
  registrar(dirThread(p.dir, gate.id), gate.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
  // Thread parada por runtime: impedimento técnico, não pergunta ao dono.
  const { thread: runtime } = novaThread(p.carregado, { nome: 'runtime auto', modo: 'auto' });
  registrar(dirThread(p.dir, runtime.id), runtime.id, 'gate_blocked', { fase: 'GOAL', motivo: 'runtime.unavailable', detalhe: 'simulado' });
  // Thread entregue hoje.
  const { thread: hoje } = novaThread(p.carregado, { nome: 'entregue hoje', modo: 'auto' });
  registrar(dirThread(p.dir, hoje.id), hoje.id, 'ship_done', { de: 'x', para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true });
  const t = lerThread(p.dir, hoje.id); t.status = 'fechada'; gravarThread(p.dir, t);
  item(p.dir, 'RM-001', 'Fundação: o começo de tudo', 'Concluído');
  item(p.dir, 'RM-002', 'Entregue agora', 'Concluído', { thread: hoje.id });
  item(p.dir, 'RM-003', 'Disponível com pendência', 'Disponível', { exposicao: 'Parcial', habilitacao: 'Em andamento' });
  item(p.dir, 'RM-004', 'Espera o dono', 'Em desenvolvimento', { thread: gate.id });
  item(p.dir, 'RM-005', 'Runtime caiu', 'Em desenvolvimento', { thread: runtime.id });
  item(p.dir, 'RM-006', 'Ideia nova', 'Discovery');
  item(p.dir, 'RM-007', 'Largado', 'Descontinuado');
  return { p, gate, runtime, hoje };
}

test('o formato aprovado: título no fuso do dono, grupos na ordem com ícones, um item por linha', () => {
  const { p } = projeto('roadmap-status-formato');
  try {
    const s = montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'orkastery' });
    assert.equal(s.contrato, CONTRATO_STATUS_DO_ROADMAP);
    const texto = textoDoStatusDoRoadmap(s);
    const linhas = texto.split('\n');
    assert.equal(linhas[0], 'Roadmap do Orkastery (28/09, 21:10)');
    // Os grupos com item aparecem na ordem aprovada; o vazio (Piloto, Refinamento) não sai.
    const cabecalhos = linhas.filter(l => GRUPOS_DO_ROADMAP.some(g => l === `${g.icone} ${g.titulo}`));
    assert.deepEqual(cabecalhos, ['✅ Concluídos', '🟢 Disponíveis com algo em aberto', '🚀 Entregue hoje',
      '🔨 Em desenvolvimento', '🆕 Proposto', '⛔ Descontinuado']);
    assert.deepEqual(GRUPOS_DO_ROADMAP.map(g => `${g.icone} ${g.titulo}`), ['✅ Concluídos', '🟢 Disponíveis com algo em aberto',
      '🚀 Entregue hoje', '🧪 Piloto', '🔨 Em desenvolvimento', '🔍 Refinamento', '🆕 Proposto', '⛔ Descontinuado']);
    // Um item por linha, e cada item uma vez só: o entregue hoje sai de Concluídos.
    for (const id of ['RM-001', 'RM-002', 'RM-003', 'RM-004', 'RM-005', 'RM-006', 'RM-007']) {
      assert.equal(linhas.filter(l => l.startsWith(`• ${id} `)).length, 1, id);
    }
    assert.ok(linhas.indexOf('• RM-002 Entregue agora') > linhas.indexOf('🚀 Entregue hoje'));
    assert.ok(linhas.includes('• RM-001 Fundação'), 'o nome curto é o título até os dois pontos');
    assert.ok(linhas.includes('• RM-003 Disponível com pendência: exposição Parcial, habilitação Em andamento'));
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('#HITL só no que espera o dono; o impedimento técnico não chama o dono', () => {
  const { p, gate, runtime } = projeto('roadmap-status-hitl');
  try {
    const texto = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'orkastery' }));
    const linhas = texto.split('\n');
    assert.ok(linhas.includes('• RM-004 Espera o dono (GOAL) #HITL'), texto);
    assert.ok(linhas.includes('• RM-005 Runtime caiu (GOAL)'), 'técnico sem #HITL');
    // O fecho: o que precisa do dono, com a pergunta; e o que vem a seguir, com a thread e a fase.
    const precisa = linhas.indexOf('O que precisa de você'), seguir = linhas.indexOf('O que eu faço em seguida');
    assert.ok(precisa > 0 && seguir > precisa);
    assert.match(linhas[precisa + 1], /^• RM-004: Qual é o veredito sobre objetivo\? A pergunta chega no próximo resumo\.$/);
    assert.equal(linhas[seguir + 1], `• RM-005: sigo ${runtime.id} na fase GOAL.`);
    // Com o pedido aberto, a linha diz exatamente o que digitar.
    const pedido = abrirPedidoGate(p.dir, gate.id, 'human.pending', QUANDO) as { codigo: string };
    const depois = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'orkastery' }));
    assert.match(depois, new RegExp(`• RM-004: Qual é o veredito sobre objetivo\\? Responda ${pedido.codigo} a \\(ou outra letra\\)\\.`));
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('leitura pura: montar o relatório não escreve ledger nem abre pedido', () => {
  const { p, gate, runtime } = projeto('roadmap-status-puro');
  try {
    const antes = [gate.id, runtime.id].map(id => fs.readFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'), 'utf8'));
    montarStatusDoRoadmap(p.dir, { quando: QUANDO, projeto: 'orkastery' });
    const depois = [gate.id, runtime.id].map(id => fs.readFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'), 'utf8'));
    assert.deepEqual(depois, antes);
  } finally { p.limpar(); definirFusoDoDono(undefined); }
});

test('CLI: ork roadmap status imprime o relatório e --json devolve o contrato', () => {
  const { p } = projeto('roadmap-status-cli');
  const cwd = process.cwd(), log = console.log;
  try {
    process.chdir(p.dir);
    let saida = ''; console.log = (s: unknown) => { saida += String(s) + '\n'; };
    assert.equal(main(['roadmap', 'status']), 0);
    assert.match(saida, /^Roadmap do Orkastery \(\d{2}\/\d{2}, \d{2}:\d{2}\)$/m);
    assert.match(saida, /^O que eu faço em seguida$/m);
    saida = '';
    assert.equal(main(['roadmap', 'status', '--json']), 0);
    assert.equal(JSON.parse(saida).contrato, CONTRATO_STATUS_DO_ROADMAP);
  } finally { console.log = log; process.chdir(cwd); p.limpar(); definirFusoDoDono(undefined); }
});

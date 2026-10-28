/**
 * RM-058 (N2, D2 a D6 da ork-rm058n2): a fila do arco. O aceite da tabela de fatias vira teste: a fixture com trabalhos
 * independentes, uma dependência bloqueada e a fila vazia prova a ordem, o progresso possível e o encerramento.
 * Todos os itens, pedidos, contas e provas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { commitar, projetoTemporario } from './apoio';
import { abrirArco, autorizarPedido, concluirFase, despachar, entregar, gravarArtefato, passar, prepararIngressoSimulado, revogarArco,
  stopSemResultado, threadDoTrabalho, TrabalhoSimulado } from './noctum-apoio';
import * as fs from 'node:fs';
import { BACKOFF_MAXIMO_MS, CADENCIA_MS, CoordenacaoDaFila, ERROS_SEGUIDOS_QUE_BLOQUEIAM, fatosDaFila, FatosDaFila, FilaDoArco,
  montarFila, MOTIVO_DO_ERRO_NO_DESPACHO, TrabalhoNaFila } from '../src/noctum-fila';
import { concluirDespacho, enfileirarDecisao, lerArco, proporEnvelope, reservarDespacho } from '../src/noctum-arco';
import { passosDoCondutor } from '../src/conducao-sentinela';
import { CONTRATO_ENVELOPE } from '../src/noctum-envelope';
import { pegarItem } from '../src/roadmap-reservas';
import { caminhoThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { dirThread } from '../src/thread';

prepararIngressoSimulado();

type Projeto = ReturnType<typeof projetoTemporario>;
const MAQUINA = 'maquina-simulada';
const PEDIDO = { a: 'Fatia A SIMULADA: o trabalho independente de prioridade 1.', b: 'Fatia B SIMULADA: depende da A.',
  c: 'Fatia C SIMULADA: independente, prioridade 3.' };
const TRES: TrabalhoSimulado[] = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: PEDIDO.b },
  { id: 'c', item: 'RM-903', prioridade: 3, dependeDe: [], pedido: PEDIDO.c },
];

/** As reservas desta máquina, como a última cópia local da branch de reservas as traria. */
const reservadas = (itens: string[], maquina = MAQUINA) => () =>
  ({ leitura: 'copia-local' as const, reservas: itens.map(item => ({ item, maquina, thread: null })) });

type LerReservas = NonNullable<Parameters<typeof fatosDaFila>[2]>['lerReservas'];

function fila(p: Projeto, arco: string, opcoes: { quando?: string; reservas?: LerReservas } = {}): FilaDoArco {
  return montarFila(fatosDaFila(p.carregado, arco, { quando: opcoes.quando, maquina: MAQUINA,
    lerReservas: opcoes.reservas ?? reservadas(['RM-901', 'RM-902', 'RM-903']) }));
}

const porId = (f: FilaDoArco) => new Map(f.trabalhos.map(t => [t.id, t] as const));
const resumo = (t: TrabalhoNaFila | undefined) => t ? `${t.estado}${t.fase ? `:${t.fase}` : ''}${t.motivo ? `:${t.motivo}` : ''}` : 'ausente';

test('F1: independentes, dependência bloqueada e fila vazia: ordem, progresso possível e encerramento', () => {
  const p = projetoTemporario('noctum-f1');
  try {
    abrirArco(p.dir, 'arco-f1', { trabalhos: TRES });
    // Começo: A e C abrem thread, na ordem da prioridade; B espera A sem parar ninguém.
    let f = fila(p, 'arco-f1');
    assert.equal(f.situacao, 'com-trabalho');
    assert.deepEqual(f.decisao, { acao: 'despachar' });
    assert.deepEqual(f.candidatos.map(t => `${t.id}:${t.estado}:${t.fase}`), ['a:abrir:GOAL', 'c:abrir:GOAL']);
    assert.equal(resumo(porId(f).get('b')), 'bloqueado:dependencia');
    // A abriu e roda: C ainda pode andar (progresso possível), B segue bloqueado.
    const a = threadDoTrabalho(p.carregado, 'fatia a', 'RM-901', PEDIDO.a);
    const sa = despachar(p.dir, a.id, 'GOAL', 1);
    f = fila(p, 'arco-f1');
    assert.equal(resumo(porId(f).get('a')), 'em-curso');
    assert.deepEqual(f.candidatos.map(t => t.id), ['c']);
    assert.equal(porId(f).get('a')!.thread, a.id, 'o vínculo da thread aberta é o item mais o sha256 do pedido');
    // A sessão de A fez o bloco inteiro: o phase_result do GOAL não vira um PLAN repetido.
    gravarArtefato(p.dir, a.id, 'check.md');
    concluirFase(p.dir, a.id, 'GOAL', sa.sessionId);
    f = fila(p, 'arco-f1');
    assert.equal(resumo(porId(f).get('a')), 'aguardando-entrega');
    // Entregue A, B entra na fila; C continua.
    entregar(p.dir, a.id);
    f = fila(p, 'arco-f1');
    assert.equal(resumo(porId(f).get('a')), 'entregue');
    assert.deepEqual(f.candidatos.map(t => t.id), ['b', 'c'], 'B tem prioridade 2 e entra antes de C');
    // Tudo entregue: a fila está vazia e o arco encerra cedo.
    for (const [id, item] of [['b', 'RM-902'], ['c', 'RM-903']] as const) {
      const t = threadDoTrabalho(p.carregado, `fatia ${id}`, item, PEDIDO[id]);
      entregar(p.dir, t.id);
    }
    f = fila(p, 'arco-f1');
    assert.equal(f.situacao, 'vazia');
    assert.deepEqual(f.decisao, { acao: 'encerrar', motivo: 'fila-vazia' });
    assert.deepEqual(f.candidatos, []);
  } finally { p.limpar(); }
});

test('F2: a prova mais adiantada que a sessão do bloco deixou decide a fase seguinte (aprendizado 3)', () => {
  const p = projetoTemporario('noctum-f2');
  try {
    const t = threadDoTrabalho(p.carregado, 'bloco inteiro', 'RM-901', 'Pedido SIMULADO do dono.');
    abrirArco(p.dir, 'arco-f2', { trabalhos: [{ id: 'x', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] });
    const d = despachar(p.dir, t.id, 'GOAL', 2);
    concluirFase(p.dir, t.id, 'GOAL', d.sessionId);
    assert.equal(resumo(fila(p, 'arco-f2', { reservas: reservadas(['RM-901']) }).trabalhos[0]), 'despachavel:PLAN', 'sem prova adiante, o PLAN');
    gravarArtefato(p.dir, t.id, 'plan.md');
    assert.equal(resumo(fila(p, 'arco-f2', { reservas: reservadas(['RM-901']) }).trabalhos[0]), 'despachavel:GO', 'com o plan.md, o GO');
    gravarArtefato(p.dir, t.id, 'check.md');
    const f = fila(p, 'arco-f2', { reservas: reservadas(['RM-901']) });
    assert.equal(resumo(f.trabalhos[0]), 'aguardando-entrega', 'passou do CHECK: SHIP e MASTER são da N5, nunca um PLAN repetido');
    assert.equal(f.situacao, 'bloqueada');
  } finally { p.limpar(); }
});

test('F3: a ordem entre candidatos: prioridade, prova mais adiantada, posição e id', () => {
  const p = projetoTemporario('noctum-f3');
  try {
    const go = threadDoTrabalho(p.carregado, 'em go', 'RM-902', 'Pedido SIMULADO go.');
    const goal = threadDoTrabalho(p.carregado, 'em goal', 'RM-903', 'Pedido SIMULADO goal.');
    const d = despachar(p.dir, go.id, 'GOAL', 3);
    gravarArtefato(p.dir, go.id, 'plan.md');
    concluirFase(p.dir, go.id, 'GOAL', d.sessionId);
    abrirArco(p.dir, 'arco-f3', { trabalhos: [
      { id: 'novo', item: 'RM-901', prioridade: 2, dependeDe: [], pedido: 'Pedido SIMULADO novo.' },
      { id: 'goal', item: 'RM-903', prioridade: 2, dependeDe: [], thread: goal.id },
      { id: 'go', item: 'RM-902', prioridade: 2, dependeDe: [], thread: go.id },
      { id: 'urgente', item: 'RM-904', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO urgente.' },
    ] });
    const f = fila(p, 'arco-f3', { reservas: reservadas(['RM-901', 'RM-902', 'RM-903', 'RM-904']) });
    // Prioridade 1 primeiro, mesmo abrindo; depois, na mesma prioridade, a prova mais adiantada (GO, GOAL, abrir).
    assert.deepEqual(f.candidatos.map(t => `${t.id}:${t.fase}`), ['urgente:GOAL', 'go:GO', 'goal:GOAL', 'novo:GOAL']);
    assert.equal(porId(f).get('goal')!.detalhe.includes('nunca foi despachada'), true, 'thread nunca despachada recebe a fase atual');
  } finally { p.limpar(); }
});

test('F4: reserva ausente, de outra máquina ou sem cópia: o trabalho não entra, e a falta de leitura é lacuna', () => {
  const p = projetoTemporario('noctum-f4');
  try {
    abrirArco(p.dir, 'arco-f4', { trabalhos: TRES });
    const f = fila(p, 'arco-f4', { reservas: () => ({ leitura: 'copia-local', reservas: [
      { item: 'RM-901', maquina: MAQUINA, thread: null }, { item: 'RM-903', maquina: 'outra-maquina', thread: null }] }) });
    assert.deepEqual(f.candidatos.map(t => t.id), ['a']);
    assert.equal(resumo(porId(f).get('c')), 'bloqueado:reserva-de-outra-maquina');
    const semReserva = fila(p, 'arco-f4', { reservas: reservadas(['RM-903']) });
    assert.equal(resumo(porId(semReserva).get('a')), 'bloqueado:reserva-ausente');
    // Sem cópia da branch de reservas: nada é provado, e a fila diz que não leu, em vez de chamar de vazia ou bloqueada.
    const semCopia = fila(p, 'arco-f4', { reservas: () => ({ leitura: 'sem-copia', reservas: [] }) });
    assert.equal(semCopia.situacao, 'fonte-indisponivel');
    assert.deepEqual(semCopia.candidatos, []);
    assert.equal(semCopia.decisao.acao, 'aguardar');
    assert.ok(semCopia.lacunas.some(l => l.includes('cópia da branch de reservas')));
  } finally { p.limpar(); }
});

test('F5: a lacuna nunca vira fila vazia, e a thread ambígua não é escolhida', () => {
  const p = projetoTemporario('noctum-f5');
  try {
    abrirArco(p.dir, 'arco-f5', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a }] });
    threadDoTrabalho(p.carregado, 'copia um', 'RM-901', PEDIDO.a);
    threadDoTrabalho(p.carregado, 'copia dois', 'RM-901', PEDIDO.a);
    const f = fila(p, 'arco-f5');
    assert.equal(resumo(f.trabalhos[0]), 'bloqueado:thread-ambigua');
    assert.equal(f.situacao, 'fonte-indisponivel');
    assert.notEqual(f.decisao.acao, 'encerrar');
  } finally { p.limpar(); }
});

test('F6: a fila só bloqueada espera com backoff, entre a cadência e o teto, e nunca passa do fim da janela', () => {
  const p = projetoTemporario('noctum-f6');
  try {
    abrirArco(p.dir, 'arco-f6', { trabalhos: TRES });
    const t0 = Date.now();
    const em = (ms: number) => new Date(t0 + ms).toISOString();
    const nada = () => ({ leitura: 'copia-local' as const, reservas: [] });
    const ate = (ms: number) => {
      const f = fila(p, 'arco-f6', { quando: em(ms), reservas: nada });
      assert.equal(f.situacao, 'bloqueada');
      assert.equal(f.decisao.acao, 'aguardar');
      return f.decisao.acao === 'aguardar' ? Date.parse(f.decisao.ate) - (t0 + ms) : NaN;
    };
    assert.ok(Math.abs(ate(4 * 60_000) - CADENCIA_MS) < 2000, 'logo depois da autorização, a cadência');
    assert.ok(Math.abs(ate(80 * 60_000) - 40 * 60_000) < 120_000, 'metade do tempo sem progresso');
    assert.ok(Math.abs(ate(3 * 3600_000) - BACKOFF_MAXIMO_MS) < 2000, 'no teto do backoff');
    // Perto do fim, a espera para no fim: o arco não aguarda além da janela.
    const fim = t0 + 7 * 3600_000;
    const perto = fila(p, 'arco-f6', { quando: em(6.9 * 3600_000), reservas: nada });
    assert.ok(perto.decisao.acao === 'aguardar' && Date.parse(perto.decisao.ate) <= fim + 1000);
  } finally { p.limpar(); }
});

test('F7: decisão no lote, sessão em curso, fim de turno sem resultado e retomada não saem da fila sozinhos', () => {
  const p = projetoTemporario('noctum-f7');
  try {
    const lote = threadDoTrabalho(p.carregado, 'no lote', 'RM-901', 'Pedido SIMULADO lote.');
    const curso = threadDoTrabalho(p.carregado, 'em curso', 'RM-902', 'Pedido SIMULADO curso.');
    const parou = threadDoTrabalho(p.carregado, 'parou', 'RM-903', 'Pedido SIMULADO parou.');
    const falhou = threadDoTrabalho(p.carregado, 'falhou', 'RM-904', 'Pedido SIMULADO falhou.');
    abrirArco(p.dir, 'arco-f7', { trabalhos: [
      { id: 'lote', item: 'RM-901', prioridade: 1, dependeDe: [], thread: lote.id },
      { id: 'curso', item: 'RM-902', prioridade: 1, dependeDe: [], thread: curso.id },
      { id: 'parou', item: 'RM-903', prioridade: 1, dependeDe: [], thread: parou.id },
      { id: 'falhou', item: 'RM-904', prioridade: 1, dependeDe: [], thread: falhou.id },
    ] });
    enfileirarDecisao(p.dir, 'arco-f7', { thread: lote.id, acaoImpedida: 'merge SIMULADO', dependentes: [], impacto: 'trava a fatia SIMULADA',
      pergunta: 'Qual caminho SIMULADO?', alternativas: [
        { letra: 'a', texto: 'Caminho A', consequencia: 'segue A', recomendada: true, porque: 'mais simples' },
        { letra: 'b', texto: 'Caminho B', consequencia: 'segue B' }, { letra: 'c', texto: 'Caminho C', consequencia: 'segue C' }] });
    despachar(p.dir, curso.id, 'GOAL', 70);
    const d = despachar(p.dir, parou.id, 'GOAL', 71);
    stopSemResultado(p.dir, parou.id, 'GOAL', d);
    const df = despachar(p.dir, falhou.id, 'GOAL', 72, false);
    concluirFase(p.dir, falhou.id, 'GOAL', df.sessionId);
    passar(5);
    registrar(dirThread(p.dir, falhou.id), falhou.id, 'phase_dispatch_failed', { fase: 'PLAN', erro: 'runtime.unavailable: SIMULADO' });
    const f = fila(p, 'arco-f7', { reservas: reservadas(['RM-901', 'RM-902', 'RM-903', 'RM-904']) });
    assert.equal(resumo(porId(f).get('lote')), 'bloqueado:decisao-no-lote');
    assert.equal(resumo(porId(f).get('curso')), 'em-curso');
    assert.equal(resumo(porId(f).get('parou')), 'bloqueado:fim-de-turno-sem-resultado');
    assert.equal(resumo(porId(f).get('falhou')), 'bloqueado:retomada');
    assert.equal(f.situacao, 'em-curso');
    assert.ok(f.decisao.acao === 'aguardar' && f.decisao.motivo === 'em-curso');
  } finally { p.limpar(); }
});

test('F8: modo, pedido guardado e item da thread: o arco não conduz o que não é dele nem inventa pedido', () => {
  const p = projetoTemporario('noctum-f8');
  try {
    const classic = novaThread(p.carregado, { nome: 'classica', modo: 'classic', roadmap: 'RM-901', pedido: 'Pedido SIMULADO.' }).thread;
    const semPedido = novaThread(p.carregado, { nome: 'sem pedido', modo: 'auto', roadmap: 'RM-902' }).thread;
    const outroItem = threadDoTrabalho(p.carregado, 'outro item', 'RM-909', 'Pedido SIMULADO outro.');
    abrirArco(p.dir, 'arco-f8', { trabalhos: [
      { id: 'classic', item: 'RM-901', prioridade: 1, dependeDe: [], thread: classic.id },
      { id: 'sempedido', item: 'RM-902', prioridade: 1, dependeDe: [], thread: semPedido.id },
      { id: 'outro', item: 'RM-903', prioridade: 1, dependeDe: [], thread: outroItem.id },
      { id: 'sumida', item: 'RM-904', prioridade: 1, dependeDe: [], thread: 'ork-nao-existe' },
    ] });
    const f = fila(p, 'arco-f8', { reservas: reservadas(['RM-901', 'RM-902', 'RM-903', 'RM-904']) });
    assert.equal(resumo(porId(f).get('classic')), 'bloqueado:modo');
    assert.equal(resumo(porId(f).get('sempedido')), 'bloqueado:pedido-ausente');
    assert.equal(resumo(porId(f).get('outro')), 'bloqueado:item-divergente');
    assert.equal(resumo(porId(f).get('sumida')), 'bloqueado:thread-ausente');
    assert.equal(f.situacao, 'bloqueada');
  } finally { p.limpar(); }
});

test('F9: fora da janela, revogado, sem autorização ou na v1, nada é candidato', () => {
  const p = projetoTemporario('noctum-f9');
  try {
    abrirArco(p.dir, 'arco-agendado', { trabalhos: TRES, deslocamentoH: 2 });
    const agendado = fila(p, 'arco-agendado');
    assert.equal(agendado.decisao.acao, 'aguardar');
    assert.ok(agendado.decisao.acao === 'aguardar' && agendado.decisao.motivo === 'agendado');
    abrirArco(p.dir, 'arco-revogado', { trabalhos: TRES });
    revogarArco(p.dir, 'arco-revogado');
    assert.deepEqual(fila(p, 'arco-revogado').decisao, { acao: 'encerrar', motivo: 'arco-encerrado' });
    const quando = new Date().toISOString();
    proporEnvelope(p.dir, { ...pedidoV1('arco-proposto') }, quando);
    const proposto = fila(p, 'arco-proposto');
    assert.equal(proposto.situacao, 'fonte-indisponivel');
    assert.deepEqual(proposto.candidatos, []);
    assert.equal(fila(p, 'arco-inexistente').situacao, 'fonte-indisponivel');
    autorizarPedido(p.dir, 'arco-v1', pedidoV1('arco-v1'));
    const v1 = fila(p, 'arco-v1');
    assert.equal(v1.situacao, 'fonte-indisponivel');
    assert.ok(v1.lacunas.some(l => l.includes('v1, sem lista de trabalhos')));
  } finally { p.limpar(); }
});

test('F10: a leitura padrão das reservas: sem cópia é lacuna, e a reserva desta máquina na branch abre o trabalho', () => {
  const p = projetoTemporario('noctum-f10', true);
  try {
    commitar(p.dir, 'docs/roadmap/RM-901-simulado.md', '# RM-901 SIMULADO\n', 'roadmap: RM-901');
    abrirArco(p.dir, 'arco-f10', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a }] });
    const semCopia = montarFila(fatosDaFila(p.carregado, 'arco-f10', { maquina: MAQUINA }));
    assert.equal(semCopia.situacao, 'fonte-indisponivel');
    pegarItem(p.dir, 'RM-901', { maquina: MAQUINA, por: 'dono SIMULADO' });
    const comReserva = montarFila(fatosDaFila(p.carregado, 'arco-f10', { maquina: MAQUINA }));
    assert.deepEqual(comReserva.candidatos.map(t => `${t.id}:${t.estado}`), ['a:abrir']);
    const deOutra = montarFila(fatosDaFila(p.carregado, 'arco-f10', { maquina: 'outra-maquina' }));
    assert.equal(resumo(deOutra.trabalhos[0]), 'bloqueado:reserva-de-outra-maquina');
  } finally { p.limpar(); }
});

/** O pedido v1 da N1, sem lista de trabalhos. */
function pedidoV1(arco: string): Record<string, unknown> {
  const agora = Date.now();
  return {
    contrato: CONTRATO_ENVELOPE, arco,
    janela: { inicio: new Date(agora - 3600_000).toISOString(), fim: new Date(agora + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' },
    destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push'] }],
    orcamento: { arco: { valor: 10, unidade: 'sessoes' }, porConta: [{ conta: 'perfil-a', teto: { valor: 5, unidade: 'sessoes' } }],
      porRuntime: [{ runtime: 'claude-bg', teto: { valor: 5, unidade: 'sessoes' } }] },
    relatorio: { horario: '07:30', canal: 'telegram' },
  };
}

test('F11: o CHECK despachado sozinho e concluído fica aguardando a entrega, mesmo com a Sentinela pedindo o SHIP', () => {
  const p = projetoTemporario('noctum-f11');
  try {
    const t = threadDoTrabalho(p.carregado, 'check sozinho', 'RM-901', 'Pedido SIMULADO do CHECK.');
    abrirArco(p.dir, 'arco-f11', { trabalhos: [{ id: 'x', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] });
    const d = despachar(p.dir, t.id, 'CHECK', 11);
    concluirFase(p.dir, t.id, 'CHECK', d.sessionId);
    const passo = passosDoCondutor(p.carregado, {}).find(x => x.thread === t.id);
    assert.deepEqual([passo?.acao, passo?.fase], ['despachar', 'SHIP'], 'a Sentinela diz despachar SHIP');
    const f = fila(p, 'arco-f11', { reservas: reservadas(['RM-901']) });
    assert.equal(resumo(f.trabalhos[0]), 'aguardando-entrega', 'a entrega nunca sai do arco da N2');
    assert.deepEqual(f.candidatos, []);
    assert.equal(f.decisao.acao, 'aguardar');
  } finally { p.limpar(); }
});

test('F12: thread ilegível segura o trabalho que ainda não tem thread, mas a alheia não impede a fila de acabar', () => {
  const p = projetoTemporario('noctum-f12');
  try {
    const alheia = novaThread(p.carregado, { nome: 'alheia ao arco', modo: 'auto' }).thread;
    fs.writeFileSync(caminhoThread(p.dir, alheia.id), '{ ilegível');
    abrirArco(p.dir, 'arco-f12', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a }] });
    // A ilegível pode ser a do trabalho: abrir outra duplicaria a thread.
    let f = fila(p, 'arco-f12');
    assert.equal(resumo(f.trabalhos[0]), 'bloqueado:thread-ilegivel');
    assert.deepEqual(f.candidatos, []);
    assert.equal(f.situacao, 'fonte-indisponivel');
    // Com o trabalho entregue, a thread ilegível alheia não vira lacuna: a fila está vazia e encerra cedo.
    const a = threadDoTrabalho(p.carregado, 'fatia a', 'RM-901', PEDIDO.a);
    entregar(p.dir, a.id);
    f = fila(p, 'arco-f12');
    assert.deepEqual(f.lacunas, []);
    assert.deepEqual(f.decisao, { acao: 'encerrar', motivo: 'fila-vazia' });
  } finally { p.limpar(); }
});

test('F13: quem depende de um trabalho que fechou sem entrega, de qualquer distância, não segura o arco aberto', () => {
  const p = projetoTemporario('noctum-f13');
  try {
    abrirArco(p.dir, 'arco-f13', { trabalhos: [
      { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a },
      { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: PEDIDO.b },
      { id: 'd', item: 'RM-903', prioridade: 3, dependeDe: ['b'], pedido: PEDIDO.c },
    ] });
    const a = threadDoTrabalho(p.carregado, 'fatia a', 'RM-901', PEDIDO.a);
    let f = fila(p, 'arco-f13');
    assert.equal(resumo(porId(f).get('d')), 'bloqueado:dependencia', 'enquanto A pode entregar, D só espera');
    const fechada = lerThread(p.dir, a.id);
    fechada.status = 'fechada';
    gravarThread(p.dir, fechada);
    f = fila(p, 'arco-f13');
    assert.equal(resumo(porId(f).get('a')), 'encerrado-sem-entrega');
    assert.equal(resumo(porId(f).get('b')), 'bloqueado:dependencia-encerrada');
    assert.equal(resumo(porId(f).get('d')), 'bloqueado:dependencia-encerrada', 'D depende de B, que nunca mais entrega');
    assert.deepEqual(f.decisao, { acao: 'encerrar', motivo: 'fila-vazia' });
  } finally { p.limpar(); }
});

test('F14: três falhas seguidas do núcleo no despacho bloqueiam o trabalho; outro desfecho no meio zera a conta', () => {
  const p = projetoTemporario('noctum-f14');
  try {
    const h = abrirArco(p.dir, 'arco-f14', { trabalhos: [TRES[0], TRES[2]], tetoDoArco: 40 });
    const falhar = (motivo: string) => {
      const r = reservarDespacho(p.dir, { arco: 'arco-f14', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg',
        conta: 'perfil-a', revisao: false });
      concluirDespacho(p.dir, 'arco-f14', r.seq, { motivo });
    };
    assert.equal(ERROS_SEGUIDOS_QUE_BLOQUEIAM, 3);
    falhar(MOTIVO_DO_ERRO_NO_DESPACHO);
    falhar(MOTIVO_DO_ERRO_NO_DESPACHO);
    assert.equal(resumo(porId(fila(p, 'arco-f14')).get('a')), 'abrir:GOAL', 'duas falhas ainda tentam de novo');
    falhar('concurrency.limite');
    falhar(MOTIVO_DO_ERRO_NO_DESPACHO);
    falhar(MOTIVO_DO_ERRO_NO_DESPACHO);
    assert.equal(resumo(porId(fila(p, 'arco-f14')).get('a')), 'abrir:GOAL', 'a recusa do núcleo no meio zera a conta');
    falhar(MOTIVO_DO_ERRO_NO_DESPACHO);
    const f = fila(p, 'arco-f14');
    assert.equal(resumo(porId(f).get('a')), 'bloqueado:erro-repetido');
    assert.deepEqual(f.candidatos.map(t => t.id), ['c'], 'o outro trabalho segue');
    assert.equal(lerArco(p.dir, 'arco-f14')!.consumo.arco, 0, 'as falhas devolveram as sessões');
  } finally { p.limpar(); }
});

test('F15: sem #Auto entre os modos do projeto, o arco não tenta abrir thread', () => {
  const p = projetoTemporario('noctum-f15');
  try {
    abrirArco(p.dir, 'arco-f15', { trabalhos: [TRES[0]] });
    p.carregado.manifesto.conduction.allowed_modes = p.carregado.manifesto.conduction.allowed_modes.filter(m => m !== 'auto');
    const f = fila(p, 'arco-f15');
    assert.equal(resumo(f.trabalhos[0]), 'bloqueado:modo');
    assert.match(f.trabalhos[0].detalhe, /conduction\.allowed_modes/);
    assert.deepEqual(f.candidatos, []);
  } finally { p.limpar(); }
});

test('F16: a thread nunca despachada com o despacho falho no runtime vai para a retomada, e não para um despacho novo', () => {
  const p = projetoTemporario('noctum-f16');
  try {
    const t = threadDoTrabalho(p.carregado, 'falhou no runtime', 'RM-901', PEDIDO.a);
    abrirArco(p.dir, 'arco-f16', { trabalhos: [TRES[0]] });
    assert.equal(resumo(fila(p, 'arco-f16').trabalhos[0]), 'despachavel:GOAL');
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch_failed', { fase: 'GOAL', erro: 'runtime.unavailable: SIMULADO',
      sessionId: '99999999-0000-4000-8000-000000000001' });
    assert.equal(resumo(fila(p, 'arco-f16').trabalhos[0]), 'bloqueado:retomada', 'a sessão pode ter aberto: quem decide é a N4');
  } finally { p.limpar(); }
});

test('F17: a reserva pendente segura o trabalho na retomada e conta no teto; a falha sem id que não abriu nada deixa seguir', () => {
  const p = projetoTemporario('noctum-f17');
  try {
    const h = abrirArco(p.dir, 'arco-f17', { trabalhos: [TRES[0], TRES[2]] });
    const t = threadDoTrabalho(p.carregado, 'sem cota', 'RM-903', PEDIDO.c);
    // A1 da rodada 3: a conta sem cota falhou sem dizer id de sessão, e o passo devolveu a reserva: o trabalho segue.
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch_failed', { fase: 'GOAL', erro: 'runtime.quota-exhausted: SIMULADO' });
    assert.equal(resumo(porId(fila(p, 'arco-f17')).get('c')), 'despachavel:GOAL', 'a próxima vez sai por outra conta');
    reservarDespacho(p.dir, { arco: 'arco-f17', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    const f = fila(p, 'arco-f17');
    assert.equal(resumo(porId(f).get('a')), 'bloqueado:retomada', 'o lançamento incerto não ganha outro por cima');
    assert.deepEqual(f.candidatos.map(x => x.id), ['c']);
    assert.equal(lerArco(p.dir, 'arco-f17')!.consumo.arco, 1, 'a pendente conta no teto');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// RM-058 N4 (D8, D16 e D21 da ork-rm058n4): a fila respeita as decisões da supervisão, quando elas vêm.
// ---------------------------------------------------------------------------

type Supervisao = NonNullable<NonNullable<Parameters<typeof fatosDaFila>[2]>['supervisao']>;
const semDecisoes = (): Supervisao => ({ isolados: new Map(), retomadas: new Map() });

function filaSupervisionada(p: Projeto, arco: string, supervisao: Supervisao, itens = ['RM-901', 'RM-902', 'RM-903']): FilaDoArco {
  return montarFila(fatosDaFila(p.carregado, arco, { maquina: MAQUINA, lerReservas: reservadas(itens), supervisao }));
}

test('F18: o trabalho isolado pela supervisão fica bloqueado com o porquê, sem virar lacuna nem candidato, e não encerra a fila', () => {
  const p = projetoTemporario('noctum-f18');
  try {
    abrirArco(p.dir, 'arco-f18', { trabalhos: [TRES[0], TRES[2]] });
    const supervisao: Supervisao = { ...semDecisoes(), isolados: new Map([['a', 'despacho de fora do arco na thread (SIMULADO)']]) };
    const f = filaSupervisionada(p, 'arco-f18', supervisao);
    assert.equal(resumo(porId(f).get('a')), 'bloqueado:isolado');
    assert.match(porId(f).get('a')!.detalhe, /despacho de fora/);
    assert.deepEqual(f.candidatos.map(t => t.id), ['c']);
    assert.deepEqual(f.lacunas, []);
    assert.equal(resumo(porId(fila(p, 'arco-f18')).get('a')), 'abrir:GOAL', 'sem a supervisão, a fila é a da N2');
    // Só o isolado sobra: a fila espera (o dono decide na manhã), e não encerra como vazia.
    entregar(p.dir, threadDoTrabalho(p.carregado, 'fatia c', 'RM-903', PEDIDO.c).id);
    const so = filaSupervisionada(p, 'arco-f18', supervisao);
    assert.equal(so.situacao, 'bloqueada');
    assert.equal(so.decisao.acao, 'aguardar');
  } finally { p.limpar(); }
});

test('F19: a retomada autorizada devolve à fila, na fase dela, o fim de turno sem resultado, a falha com id e o que ficou sem passo', () => {
  const p = projetoTemporario('noctum-f19');
  try {
    const parou = threadDoTrabalho(p.carregado, 'parou', 'RM-901', 'Pedido SIMULADO parou.');
    const falhou = threadDoTrabalho(p.carregado, 'falhou', 'RM-902', 'Pedido SIMULADO falhou.');
    const morreu = threadDoTrabalho(p.carregado, 'morreu', 'RM-903', 'Pedido SIMULADO morreu.');
    abrirArco(p.dir, 'arco-f19', { trabalhos: [
      { id: 'parou', item: 'RM-901', prioridade: 1, dependeDe: [], thread: parou.id },
      { id: 'falhou', item: 'RM-902', prioridade: 1, dependeDe: [], thread: falhou.id },
      { id: 'morreu', item: 'RM-903', prioridade: 1, dependeDe: [], thread: morreu.id },
    ] });
    const d = despachar(p.dir, parou.id, 'GO', 91);
    stopSemResultado(p.dir, parou.id, 'GO', d);
    registrar(dirThread(p.dir, falhou.id), falhou.id, 'phase_dispatch_failed', { fase: 'GOAL', erro: 'runtime.unavailable: SIMULADO',
      sessionId: '99999999-0000-4000-8000-000000000091' });
    const m = despachar(p.dir, morreu.id, 'PLAN', 92);
    registrar(dirThread(p.dir, morreu.id), morreu.id, 'sessao_morta', { fase: 'PLAN', sessionId: m.sessionId, origem: 'noctum.vigia',
      evidencia: 'SIMULADO: o runtime lista a sessão como stopped' });
    const antes = filaSupervisionada(p, 'arco-f19', semDecisoes());
    assert.deepEqual(['parou', 'falhou', 'morreu'].map(id => resumo(porId(antes).get(id))),
      ['bloqueado:fim-de-turno-sem-resultado', 'bloqueado:retomada', 'bloqueado:sem-passo']);
    const retomadas = new Map([
      ['parou', { fase: 'GO' as const, tentativa: 1, motivo: 'fim-de-turno-sem-resultado' }],
      ['falhou', { fase: 'GOAL' as const, tentativa: 1, motivo: 'despacho-falho' }],
      ['morreu', { fase: 'PLAN' as const, tentativa: 2, motivo: 'sessao-morta' }],
    ]);
    const depois = filaSupervisionada(p, 'arco-f19', { ...semDecisoes(), retomadas });
    assert.deepEqual(['parou', 'falhou', 'morreu'].map(id => resumo(porId(depois).get(id))),
      ['despachavel:GO', 'despachavel:GOAL', 'despachavel:PLAN']);
    assert.match(porId(depois).get('morreu')!.detalhe, /tentativa 2, sessao-morta/);
    assert.equal(depois.decisao.acao, 'despachar');
  } finally { p.limpar(); }
});

test('F20: a retomada autorizada nunca passa por cima da reserva pendente, do erro repetido, do dono nem da sessão em curso', () => {
  const p = projetoTemporario('noctum-f20');
  try {
    const pausada = threadDoTrabalho(p.carregado, 'pausada', 'RM-902', 'Pedido SIMULADO pausada.');
    const curso = threadDoTrabalho(p.carregado, 'curso', 'RM-904', 'Pedido SIMULADO curso.');
    const h = abrirArco(p.dir, 'arco-f20', { trabalhos: [TRES[0],
      { id: 'pausada', item: 'RM-902', prioridade: 1, dependeDe: [], thread: pausada.id },
      { id: 'erros', item: 'RM-903', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO erros.' },
      { id: 'curso', item: 'RM-904', prioridade: 1, dependeDe: [], thread: curso.id },
    ] });
    reservarDespacho(p.dir, { arco: 'arco-f20', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    gravarThread(p.dir, { ...lerThread(p.dir, pausada.id), status: 'pausada' });
    for (let i = 0; i < ERROS_SEGUIDOS_QUE_BLOQUEIAM; i++) {
      const r = reservarDespacho(p.dir, { arco: 'arco-f20', envelopeSha256: h, trabalho: 'erros', thread: null, fase: 'GOAL', runtime: 'claude-bg',
        conta: 'perfil-a', revisao: false });
      concluirDespacho(p.dir, 'arco-f20', r.seq, { motivo: MOTIVO_DO_ERRO_NO_DESPACHO });
    }
    despachar(p.dir, curso.id, 'GO', 93);
    const todas = new Map(['a', 'pausada', 'erros', 'curso'].map(id => [id, { fase: 'GOAL' as const, tentativa: 1, motivo: 'SIMULADO' }]));
    const f = filaSupervisionada(p, 'arco-f20', { ...semDecisoes(), retomadas: todas }, ['RM-901', 'RM-902', 'RM-903', 'RM-904']);
    assert.deepEqual(['a', 'pausada', 'erros', 'curso'].map(id => resumo(porId(f).get(id))),
      ['bloqueado:retomada', 'bloqueado:dono', 'bloqueado:erro-repetido', 'em-curso']);
    assert.deepEqual(f.candidatos, []);
  } finally { p.limpar(); }
});

const filaDaRede = (contrato: 'ork.noctum-envelope/v2' | 'ork.noctum-envelope/v3', coordenacao: CoordenacaoDaFila,
  fechada = false): FilaDoArco => {
  const quando = new Date().toISOString();
  const trabalho = { id: 'x', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia X SIMULADA.' };
  const conteudo = { contrato, arco: 'arco-f-rede', janela: { inicio: quando, fim: new Date(Date.now() + 8 * 3600_000).toISOString(),
    fuso: 'America/Sao_Paulo' }, destinos: [], orcamento: { arco: { valor: 10, unidade: 'sessoes' }, porConta: [], porRuntime: [] },
  relatorio: { horario: '07:30', canal: 'terminal' }, exclusoes: [], trabalhos: [trabalho],
  capacidade: { maquina: 1, revisao: 0, porConta: [], porRuntime: [] },
  ...(contrato.endsWith('/v3') ? { maquinas: [{ nome: 'maquina-a', chave: 'SIMULADA' }, { nome: 'maquina-b', chave: 'SIMULADA' }],
    capacidadeGlobal: { porConta: [] } } : {}) };
  const thread = { id: 'ork-rm901x', roadmap: 'RM-901', status: fechada ? 'fechada' : 'aberta', modo: 'auto', faseAtual: 'GO' };
  const fato = { threads: fechada ? [thread] : [], ilegivel: null, entregueEm: null, despachada: fechada, despachoFalho: false,
    pedidoGuardado: fechada, passo: null, espera: null, doDono: null };
  return montarFila({ arco: 'arco-f-rede', quando, maquina: 'maquina-a',
    estado: { situacao: 'vigente', conteudo, envelopeSha256: 'e'.repeat(64), decisoes: [], despachos: [], autorizadoPor: { recebidoEm: quando } },
    reservas: { leitura: 'copia-local', porItem: new Map([['RM-901', { maquina: 'maquina-a', thread: null }]]) },
    porTrabalho: new Map([['x', fato]]), threadsIlegiveis: [], modosPermitidos: ['auto'], coordenacao } as unknown as FatosDaFila);
};

test('F21: ordem viva em outra máquina vence a thread antiga fechada aqui', () => {
  const f = filaDaRede('ork.noctum-envelope/v3', { trabalhos: new Set(), entregues: new Map(), emOutraMaquina: new Set(['x']) }, true);
  assert.deepEqual(f.trabalhos.map(t => [t.id, t.estado, t.motivo]), [['x', 'bloqueado', 'em-outra-maquina']]);
});

test('F22: a entrega na rede vence o bloqueio da ordem em outra máquina', () => {
  const quando = new Date().toISOString();
  const f = filaDaRede('ork.noctum-envelope/v3',
    { trabalhos: new Set(), entregues: new Map([['x', quando]]), emOutraMaquina: new Set(['x']) }, true);
  assert.deepEqual(f.trabalhos.map(t => [t.id, t.estado, t.motivo]), [['x', 'entregue', null]]);
});

test('F23: sem ordem aceita desta máquina, o resto segue sem-ordem', () => {
  const f = filaDaRede('ork.noctum-envelope/v3', { trabalhos: new Set(), entregues: new Map(), emOutraMaquina: new Set() });
  assert.deepEqual(f.trabalhos.map(t => [t.id, t.estado, t.motivo]), [['x', 'bloqueado', 'sem-ordem']]);
});

test('F24: a fila v2 é igual com e sem os campos novos da rede', () => {
  const base = { trabalhos: new Set<string>(), entregues: new Map<string, string>() };
  const sem = filaDaRede('ork.noctum-envelope/v2', base);
  const com = filaDaRede('ork.noctum-envelope/v2', { ...base, emOutraMaquina: new Set(['x']), ordens: new Map([['x', { ordem: 'O-x-1', numero: 1 }]]) });
  assert.deepEqual(com.trabalhos, sem.trabalhos);
  assert.deepEqual(com.decisao, sem.decisao);
});

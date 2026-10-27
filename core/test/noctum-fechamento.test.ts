/**
 * RM-058 (N6, D2 e D8 da ork-rm058n6): o fechamento do arco por hora, custo e fila vazia, com as sessões em voo paradas
 * uma vez e o estado deixado para retomar. Relógio controlado; sessões, contas, paradas e provas são SIMULADAS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { abrirArco, autorizarPedido, entregar, pedidoV2, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { depois, MIN } from './noctum-n6-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { registrar } from '../src/ledger';
import { concluirDespacho, encerrarArco, EstadoDoArco, lerArco, reservarDespacho } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import { condicaoDeFechamento, fecharSeDevido, lerFechamento, OpcoesDoFechamento, SessaoEmVoo, textoDaParada } from '../src/noctum-fechamento';
import { fatosDaFila, FilaDoArco, montarFila } from '../src/noctum-fila';
import { MedicaoDoArco } from '../src/noctum-medicao';
import { lerRegistro } from '../src/noctum-registro';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { chaveSimulada, pedidoV3 } from './noctum-maquinas-apoio';
import { identidadeDaMaquina } from '../src/noctum-transporte';
import { CONTRATO_REDE_DO_ARCO, RedeDoArco } from '../src/noctum-rede';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const MAQUINA = 'maquina-simulada';
type Projeto = ReturnType<typeof projetoTemporario>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Duas threads #Auto do arco, cada uma um trabalho de `thread`. */
function threads(p: Projeto, n = 2): { trabalhos: TrabalhoSimulado[]; ids: string[] } {
  const ids = Array.from({ length: n }, (_, i) => novaThread(p.carregado, { nome: `fe trabalho ${i + 1}`, modo: 'auto',
    roadmap: `RM-90${i + 1}`, pedido: `Trabalho ${i + 1} SIMULADO do fechamento.`, criarWorktree: false }).thread.id);
  return { ids, trabalhos: ids.map((thread, i) => ({ id: `t${i + 1}`, item: `RM-90${i + 1}`, prioridade: i + 1, dependeDe: [], thread })) };
}

/** Reserva e conclui um despacho do arco com a sessão aberta, e grava o `phase_dispatch` dela no ledger da thread. */
function sessao(p: Projeto, arco: string, sha: string, trabalho: string, thread: string, n: number, runtime = 'claude-bg', conta = 'perfil-a'): number {
  const r = reservarDespacho(p.dir, { arco, envelopeSha256: sha, trabalho, thread, fase: 'GO', runtime, conta, revisao: false });
  registrar(dirThread(p.dir, thread), thread, 'phase_dispatch', { fase: 'GO', sessionId: uuid(n), runtime, pausaAoFim: false });
  concluirDespacho(p.dir, arco, r.seq, { thread, sessionId: uuid(n), idempotente: false });
  return r.seq;
}

/** As opções simuladas: a parada registra quem foi parado, a listagem diz quem segue vivo, o git é falso. */
function simuladas(paradas: SessaoEmVoo[], o: Partial<OpcoesDoFechamento> = {}): OpcoesDoFechamento {
  return { maquina: MAQUINA, lerReservas: () => ({ leitura: 'copia-local', reservas: [] }),
    parar: (s) => { paradas.push(s); return { ok: true, detalhe: 'parada simulada aceita' }; },
    listarSessoes: () => ({ lidas: true, vivas: new Set() }), git: () => null,
    medir: (_r, e, q) => medicaoVazia(e.arco, q), ...o };
}

function medicaoVazia(arco: string, quando: string, minutos: number | null = 0): MedicaoDoArco {
  const u = (unidade: 'sessoes' | 'minutos-de-sessao' | 'tokens' | 'percentual-da-cota', valor: number | null) =>
    ({ unidade, valor, lacunas: valor === null ? ['simulada'] : [], parcial: false, tetoSuperior: false, sessoes: 0 });
  const porUnidade = { sessoes: u('sessoes', 0), 'minutos-de-sessao': u('minutos-de-sessao', minutos), tokens: u('tokens', 0),
    'percentual-da-cota': u('percentual-da-cota', 0) };
  return { contrato: 'ork.noctum-medicao/v1', arco, quando, sessoes: [], doArco: porUnidade, porConta: {}, porRuntime: {} };
}

function arcoV3(p: Projeto, arco: string, n = 1, teto = 10): { ids: string[]; trabalhos: TrabalhoSimulado[] } {
  const t = threads(p, n);
  const trabalhos = t.trabalhos.map(x => ({ ...x, maquina: MAQUINA }));
  autorizarPedido(p.dir, arco, pedidoV3(arco, { trabalhos, maquinas: [identidadeDaMaquina(p.dir, MAQUINA)], tetoDoArco: teto,
    maquina: teto, contas: [{ conta: 'perfil-a', sessoes: teto }], global: [{ conta: 'perfil-a', sessoes: teto }] }));
  return { ids: t.ids, trabalhos };
}

function rede(arco: string, trabalhos: RedeDoArco['trabalhos'], consumo = 0,
  lacuna: RedeDoArco['lacuna'] = null, obrigacoes: RedeDoArco['obrigacoes'] = { ordens: [], vagas: [], vezes: [] }): RedeDoArco {
  return { contrato: CONTRATO_REDE_DO_ARCO, arco, multimaquina: true, maquina: MAQUINA, envelopeSha256: 'a'.repeat(64),
    lidaEm: new Date().toISOString(), autoridade: null, revogada: null, maquinas: [], trabalhos,
    consumo: { arco: consumo, porConta: { 'perfil-a': consumo }, porRuntime: { 'claude-bg': consumo } }, obrigacoes, lacuna };
}

const recusa = (fn: () => unknown, motivo: string): void => {
  try { fn(); } catch (e) { assert.ok(e instanceof RecusaDoArco); assert.equal(e.motivo, motivo, e.message); return; }
  assert.fail(`esperava ${motivo}`);
};

test('FE1: no fim do envelope o arco fecha por hora, pede a parada de cada sessão em voo uma vez e confirma no tique seguinte', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe1');
  try {
    const { trabalhos, ids } = threads(p);
    const sha = abrirArco(p.dir, 'arco-fe1', { trabalhos, contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-codex', sessoes: 2 }],
      runtimes: [{ runtime: 'claude-bg', sessoes: 2 }, { runtime: 'codex', sessoes: 2 }] });
    sessao(p, 'arco-fe1', sha, 't1', ids[0], 1);
    sessao(p, 'arco-fe1', sha, 't2', ids[1], 2, 'codex', 'perfil-codex');
    const fim = lerArco(p.dir, 'arco-fe1')!.conteudo!.janela.fim;
    const paradas: SessaoEmVoo[] = [];
    const antes = fecharSeDevido(p.carregado, 'arco-fe1', simuladas(paradas, { quando: depois(fim, -MIN) }));
    assert.equal(antes.fechado, false, 'um minuto antes do fim o arco segue');
    const r = fecharSeDevido(p.carregado, 'arco-fe1', simuladas(paradas, { quando: fim }));
    assert.deepEqual([r.fechado, r.agora, r.motivo], [true, true, 'hora']);
    assert.equal(lerArco(p.dir, 'arco-fe1', fim)!.situacao, 'encerrado');
    recusa(() => reservarDespacho(p.dir, { arco: 'arco-fe1', envelopeSha256: sha, trabalho: 't1', thread: ids[0], fase: 'GO',
      runtime: 'claude-bg', conta: 'perfil-a', revisao: false }), 'noctum.efeito.encerrado');
    assert.deepEqual(paradas.map(s => s.sessionId), [uuid(1)], 'só a sessão do claude-bg tem controle de parada');
    const porSessao = Object.fromEntries(r.paradas.map(x => [x.sessionId, x.resultado]));
    assert.deepEqual(porSessao, { [uuid(1)]: 'pedida', [uuid(2)]: 'sem-controle' });
    assert.equal(r.conferencias.length, 0, 'a conferência é do tique seguinte');
    const tique = fecharSeDevido(p.carregado, 'arco-fe1', simuladas(paradas, { quando: depois(fim, 5 * MIN) }));
    assert.deepEqual([tique.fechado, tique.agora], [true, false]);
    assert.equal(paradas.length, 1, 'a parada é pedida uma vez');
    assert.deepEqual(tique.conferencias.map(c => [c.sessionId, c.confirmada]), [[uuid(1), true]]);
    assert.match(textoDaParada(tique.paradas[0], tique.conferencias), /parada confirmada/);
  } finally { p.limpar(); }
});

test('FE16: fila local vazia não fecha com trabalho vivo em outra máquina', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe16');
  try {
    const t = threads(p, 1);
    autorizarPedido(p.dir, 'arco-fe16', pedidoV3('arco-fe16', { trabalhos: t.trabalhos,
      maquinas: [identidadeDaMaquina(p.dir, MAQUINA), { nome: 'maquina-b', chave: chaveSimulada('fe16-b') }], tetoDoArco: 10,
      maquina: 10, contas: [{ conta: 'perfil-a', sessoes: 10 }], global: [{ conta: 'perfil-a', sessoes: 10 }] }));
    gravarThread(p.dir, { ...lerThread(p.dir, t.ids[0]), status: 'fechada' });
    const soLocal = montarFila(fatosDaFila(p.carregado, 'arco-fe16',
      { maquina: MAQUINA, lerReservas: () => ({ leitura: 'copia-local', reservas: [] }) }));
    assert.deepEqual([soLocal.situacao, soLocal.decisao], ['vazia', { acao: 'encerrar', motivo: 'fila-vazia' }],
      'sem a coordenação, a thread antiga fechada faria a fila local encerrar');
    const r = fecharSeDevido(p.carregado, 'arco-fe16', simuladas([], { projecaoDaRede: rede('arco-fe16', [
      { id: 't1', estado: 'em-execucao', maquina: 'maquina-b', maquinaPresa: null,
        ordem: { ordem: 'O-t1-1', numero: 1, maquina: 'maquina-b', estado: 'aceita', emitidaEm: new Date().toISOString() }, entrega: null },
    ]) }));
    assert.deepEqual([r.fechado, r.motivo], [false, null], 'a ordem viva na outra máquina impede o fechamento v3');
  } finally { p.limpar(); }
});

test('FE17: todos os trabalhos terminais na rede fecham por fila vazia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe17');
  try {
    arcoV3(p, 'arco-fe17', 2);
    const r = fecharSeDevido(p.carregado, 'arco-fe17', simuladas([], { projecaoDaRede: rede('arco-fe17', [
      { id: 't1', estado: 'entregue', maquina: MAQUINA, maquinaPresa: MAQUINA, ordem: null,
        entrega: { em: new Date().toISOString(), maquina: MAQUINA, merge: 'a'.repeat(40) } },
      { id: 't2', estado: 'encerrado', maquina: 'maquina-b', maquinaPresa: MAQUINA, ordem: null, entrega: null },
    ]) }));
    assert.deepEqual([r.fechado, r.motivo], [true, 'fila-vazia']);
  } finally { p.limpar(); }
});

test('FE18: consumo somado das máquinas no teto fecha por custo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe18');
  try {
    arcoV3(p, 'arco-fe18', 1, 2);
    const r = fecharSeDevido(p.carregado, 'arco-fe18', simuladas([], { projecaoDaRede: rede('arco-fe18', [
      { id: 't1', estado: 'em-execucao', maquina: MAQUINA, maquinaPresa: MAQUINA,
        ordem: { ordem: 'O-t1-1', numero: 1, maquina: MAQUINA, estado: 'aceita', emitidaEm: new Date().toISOString() }, entrega: null },
    ], 2) }));
    assert.deepEqual([r.fechado, r.motivo], [true, 'custo']);
    assert.match(r.detalhe, /2 foram reservadas/);
  } finally { p.limpar(); }
});

test('FE19: rede sem leitura não fecha por fila nem custo, mas a hora fecha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe19');
  try {
    arcoV3(p, 'arco-fe19', 1, 2);
    const lacuna = rede('arco-fe19', [], 2, { motivo: 'noctum.coordenacao.sem-remoto', detalhe: 'SIMULADO' });
    assert.equal(fecharSeDevido(p.carregado, 'arco-fe19', simuladas([], { projecaoDaRede: lacuna })).fechado, false);
    const fim = lerArco(p.dir, 'arco-fe19')!.conteudo!.janela.fim;
    assert.equal(fecharSeDevido(p.carregado, 'arco-fe19', simuladas([], { projecaoDaRede: lacuna, quando: fim })).motivo, 'hora');
  } finally { p.limpar(); }
});

test('FE20: MASTER devido nesta máquina segura o fechamento v3 por fila vazia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe20');
  try {
    const t = arcoV3(p, 'arco-fe20');
    registrar(dirThread(p.dir, t.ids[0]), t.ids[0], 'ship_done', { mergeSha: 'a'.repeat(40), evidencia: { arco: 'arco-fe20' } });
    const projecao = rede('arco-fe20', [{ id: 't1', estado: 'entregue', maquina: MAQUINA, maquinaPresa: MAQUINA, ordem: null,
      entrega: { em: new Date().toISOString(), maquina: MAQUINA, merge: 'a'.repeat(40) } }]);
    const r = fecharSeDevido(p.carregado, 'arco-fe20', simuladas([], { projecaoDaRede: projecao }));
    assert.equal(r.fechado, false);
    assert.match(r.detalhe, /MASTER por omissão/);
  } finally { p.limpar(); }
});

test('FE2: o teto do arco em sessões não admite mais nada; as sessões já contadas terminam, e o arco fecha por custo quando a última acaba', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe2');
  try {
    const { trabalhos, ids } = threads(p);
    const sha = abrirArco(p.dir, 'arco-fe2', { trabalhos, tetoDoArco: 2, contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }] });
    sessao(p, 'arco-fe2', sha, 't1', ids[0], 11);
    sessao(p, 'arco-fe2', sha, 't2', ids[1], 12, 'claude-bg', 'perfil-b');
    const paradas: SessaoEmVoo[] = [];
    const comVoo = fecharSeDevido(p.carregado, 'arco-fe2', simuladas(paradas));
    assert.equal(comVoo.fechado, false, 'com sessões admitidas em voo, o arco espera elas acabarem');
    assert.equal(paradas.length, 0, 'nenhuma sessão já contada no teto é parada: pará-la não protege o teto');
    for (const conta of ['perfil-a', 'perfil-b']) {
      recusa(() => reservarDespacho(p.dir, { arco: 'arco-fe2', envelopeSha256: sha, trabalho: 't1', thread: ids[0], fase: 'GO', runtime: 'claude-bg',
        conta, revisao: false }), 'noctum.orcamento.esgotado');
    }
    registrar(dirThread(p.dir, ids[0]), ids[0], 'phase_result', { fase: 'GO', sessionId: uuid(11), classificacao: 'fase_concluida', ok: true });
    assert.equal(fecharSeDevido(p.carregado, 'arco-fe2', simuladas(paradas)).fechado, false, 'a do t2 ainda corre');
    registrar(dirThread(p.dir, ids[1]), ids[1], 'phase_result', { fase: 'GO', sessionId: uuid(12), classificacao: 'fase_concluida', ok: true });
    const r = fecharSeDevido(p.carregado, 'arco-fe2', simuladas(paradas));
    assert.deepEqual([r.fechado, r.agora, r.motivo], [true, true, 'custo']);
    assert.match(r.detalhe, /teto do arco é de 2 sessoes e 2 foram reservadas; nenhuma segue em voo/);
    assert.deepEqual([paradas.length, r.paradas.length], [0, 0], 'nada a parar: as sessões contadas acabaram');
    recusa(() => reservarDespacho(p.dir, { arco: 'arco-fe2', envelopeSha256: sha, trabalho: 't1', thread: ids[0], fase: 'GO', runtime: 'claude-bg',
      conta: 'perfil-b', revisao: false }), 'noctum.efeito.encerrado');
    // A reserva pendente também conta como em voo: o runtime pode ter aberto a sessão, e o teto não fecha por cima dela.
    const q = threads(p, 1);
    const sha2 = abrirArco(p.dir, 'arco-fe2b', { trabalhos: q.trabalhos, tetoDoArco: 1 });
    reservarDespacho(p.dir, { arco: 'arco-fe2b', envelopeSha256: sha2, trabalho: 't1', thread: q.ids[0], fase: 'GO', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    assert.equal(fecharSeDevido(p.carregado, 'arco-fe2b', simuladas([])).fechado, false);
    const fim = lerArco(p.dir, 'arco-fe2b')!.conteudo!.janela.fim;
    const hora = fecharSeDevido(p.carregado, 'arco-fe2b', simuladas([], { quando: fim }));
    assert.deepEqual([hora.motivo, hora.paradas.map(x => x.resultado)], ['hora', ['sem-id']], 'a hora final fecha e diz o que não tem id');
  } finally { p.limpar(); }
});

test('FE3: o teto do arco em minutos fecha com o consumo medido no teto; abaixo dele ou com lacuna, o arco segue', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe3');
  try {
    const { trabalhos } = threads(p, 1);
    const pedido = pedidoV2('arco-fe3', { trabalhos });
    autorizarPedido(p.dir, 'arco-fe3', { ...pedido, orcamento: { ...(pedido.orcamento as Record<string, unknown>),
      arco: { valor: 60, unidade: 'minutos-de-sessao' } } });
    const com = (minutos: number | null) => fecharSeDevido(p.carregado, 'arco-fe3', simuladas([],
      { medir: (_r, e, q) => medicaoVazia(e.arco, q, minutos) }));
    assert.equal(com(59).fechado, false);
    assert.equal(com(null).fechado, false, 'lacuna não prova o teto alcançado');
    const r = com(60);
    assert.deepEqual([r.fechado, r.motivo], [true, 'custo']);
    assert.match(r.detalhe, /60 minutos-de-sessao e o consumo medido é 60/);
    assert.equal(r.retrato?.consumo['minutos-de-sessao'].valor, 60);
  } finally { p.limpar(); }
});

test('FE4: a fila vazia fecha cedo, com o retrato das fontes consultadas e dos itens concluídos', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe4');
  try {
    const { trabalhos, ids } = threads(p);
    abrirArco(p.dir, 'arco-fe4', { trabalhos });
    entregar(p.dir, ids[0]);
    assert.equal(fecharSeDevido(p.carregado, 'arco-fe4', simuladas([])).fechado, false, 'um trabalho ainda não entregue');
    entregar(p.dir, ids[1]);
    const r = fecharSeDevido(p.carregado, 'arco-fe4', simuladas([]));
    assert.deepEqual([r.fechado, r.motivo], [true, 'fila-vazia']);
    assert.equal(r.retrato!.fila.lida, true);
    assert.equal(r.retrato!.fila.situacao, 'vazia');
    assert.deepEqual(r.retrato!.retomada.trabalhos.map(t => [t.id, t.estado]), [['t1', 'entregue'], ['t2', 'entregue']]);
    assert.ok(r.retrato!.retomada.trabalhos.every(t => t.entregueEm));
    assert.equal(r.paradas.length, 0, 'fila vazia não tem sessão em voo');
  } finally { p.limpar(); }
});

test('FE5: o arco revogado pelo dono fecha com o motivo revogado e pede a parada das sessões em voo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe5');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const sha = abrirArco(p.dir, 'arco-fe5', { trabalhos });
    sessao(p, 'arco-fe5', sha, 't1', ids[0], 21);
    revogarArco(p.dir, 'arco-fe5');
    const paradas: SessaoEmVoo[] = [];
    const r = fecharSeDevido(p.carregado, 'arco-fe5', simuladas(paradas));
    assert.deepEqual([r.fechado, r.motivo], [true, 'revogado']);
    assert.equal(lerArco(p.dir, 'arco-fe5')!.situacao, 'revogado', 'a situação continua a do dono');
    assert.deepEqual(paradas.map(s => s.sessionId), [uuid(21)]);
  } finally { p.limpar(); }
});

test('FE6: arco sem autorização, agendado ou vigente sem condição não fecha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe6');
  try {
    const { trabalhos } = threads(p, 1);
    assert.match(fecharSeDevido(p.carregado, 'arco-fe6', simuladas([])).detalhe, /não tem proposta/);
    abrirArco(p.dir, 'arco-fe6b', { trabalhos, deslocamentoH: 2 });
    assert.equal(fecharSeDevido(p.carregado, 'arco-fe6b', simuladas([])).fechado, false, 'agendado: a janela ainda não começou');
    abrirArco(p.dir, 'arco-fe6c', { trabalhos });
    const r = fecharSeDevido(p.carregado, 'arco-fe6c', simuladas([]));
    assert.equal(r.fechado, false);
    assert.equal(lerArco(p.dir, 'arco-fe6c')!.situacao, 'vigente');
  } finally { p.limpar(); }
});

test('FE7: fechar de novo devolve o mesmo retrato, com um só fechado e nenhuma parada repetida', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe7');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const sha = abrirArco(p.dir, 'arco-fe7', { trabalhos, tetoDoArco: 1 });
    sessao(p, 'arco-fe7', sha, 't1', ids[0], 31);
    const fim = lerArco(p.dir, 'arco-fe7')!.conteudo!.janela.fim;
    const paradas: SessaoEmVoo[] = [];
    const a = fecharSeDevido(p.carregado, 'arco-fe7', simuladas(paradas, { quando: fim }));
    assert.equal(a.motivo, 'hora');
    const b = fecharSeDevido(p.carregado, 'arco-fe7', simuladas(paradas, { quando: fim,
      listarSessoes: () => ({ lidas: false, vivas: new Set() }) }));
    assert.deepEqual(b.retrato, a.retrato);
    assert.equal(b.conferencias.length, 0, 'sem a listagem completa, a parada fica sem conferência, nunca confirmada por presunção');
    const c = fecharSeDevido(p.carregado, 'arco-fe7', simuladas(paradas, { quando: fim,
      listarSessoes: () => ({ lidas: true, vivas: new Set([uuid(31)]) }) }));
    assert.deepEqual(c.conferencias.map(x => x.confirmada), [false], 'a sessão viva depois do pedido fica não confirmada');
    assert.match(textoDaParada(c.paradas[0], c.conferencias), /parada não confirmada/);
    assert.equal(paradas.length, 1);
    assert.equal(lerFechamento(p.dir, 'arco-fe7').paradas.length, 1);
  } finally { p.limpar(); }
});

test('FE8: as condições valem na ordem revogado, hora, custo e fila vazia', () => {
  const quando = '2026-10-13T12:00:00.000Z';
  const base = (o: Partial<EstadoDoArco> = {}): EstadoDoArco => ({ contrato: 'ork.noctum-arco/v1', arco: 'arco-fe8', situacao: 'vigente', versao: 1,
    envelopeSha256: 'b'.repeat(64), autorizadoPor: { origem: 'telegram' } as never, revogadoPor: null, propostaPendente: null, decisoes: [],
    despachos: [], consumo: { arco: 0, porConta: {}, porRuntime: {} }, encerramento: null,
    conteudo: { janela: { inicio: '2026-10-13T06:00:00.000Z', fim: '2026-10-13T14:00:00.000Z', fuso: 'UTC' },
      orcamento: { arco: { valor: 3, unidade: 'sessoes' }, porConta: [], porRuntime: [] } } as never, ...o });
  const vazia = { situacao: 'vazia', decisao: { acao: 'encerrar', motivo: 'fila-vazia' } } as FilaDoArco;
  const cheio = { arco: 3, porConta: {}, porRuntime: {} };
  assert.equal(condicaoDeFechamento(base({ situacao: 'revogado', consumo: cheio }), vazia, null, '2026-10-13T15:00:00.000Z')!.motivo, 'revogado');
  assert.equal(condicaoDeFechamento(base({ consumo: cheio }), vazia, null, '2026-10-13T14:00:00.000Z')!.motivo, 'hora');
  assert.equal(condicaoDeFechamento(base({ consumo: cheio }), vazia, null, quando)!.motivo, 'custo');
  assert.equal(condicaoDeFechamento(base(), vazia, null, quando)!.motivo, 'fila-vazia');
  assert.equal(condicaoDeFechamento(base(), null, null, quando), null);
  assert.equal(condicaoDeFechamento(base({ autorizadoPor: null }), vazia, null, quando), null, 'sem autorização, nada fecha');
});

test('FE9: o estado de retomada lista as reservas em voo, a reconciliação pendente e a instrução, com a reserva sem id sem parada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe9');
  try {
    const { trabalhos, ids } = threads(p);
    const sha = abrirArco(p.dir, 'arco-fe9', { trabalhos });
    sessao(p, 'arco-fe9', sha, 't1', ids[0], 41);
    const pendente = reservarDespacho(p.dir, { arco: 'arco-fe9', envelopeSha256: sha, trabalho: 't2', thread: ids[1], fase: 'GO',
      runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    const fim = lerArco(p.dir, 'arco-fe9')!.conteudo!.janela.fim;
    const r = fecharSeDevido(p.carregado, 'arco-fe9', simuladas([], { quando: depois(fim, MIN),
      git: (_c, args) => args[0] === 'status' ? ' M core/src/x.ts' : args.includes('--abbrev-ref') ? 'ork/fe9' : 'c'.repeat(40) }));
    const ret = r.retrato!.retomada;
    assert.deepEqual(ret.reservasEmVoo.map(x => x.seq), [pendente.seq]);
    assert.ok(ret.reconciliacaoPendente.some(l => l.includes(`reserva ${pendente.seq}`)));
    assert.ok(ret.reconciliacaoPendente.some(l => l.includes(uuid(41))));
    assert.match(ret.instrucao.join('\n'), /não reabre/);
    assert.match(ret.instrucao.join('\n'), /reconciliadas antes do primeiro despacho do arco novo/);
    assert.match(ret.instrucao.join('\n'), /nunca se repete às cegas/);
    const semId = r.paradas.find(x => x.sessionId === null)!;
    assert.equal(semId.resultado, 'sem-id');
    assert.equal(semId.seq, pendente.seq);
  } finally { p.limpar(); }
});

test('FE10: o subteto da conta esgotado não fecha o arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe10');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const pedido = pedidoV2('arco-fe10', { trabalhos });
    const orc = pedido.orcamento as { porConta: Array<{ conta: string; teto: { valor: number } }> };
    orc.porConta[0].teto.valor = 1;
    const sha = autorizarPedido(p.dir, 'arco-fe10', pedido);
    sessao(p, 'arco-fe10', sha, 't1', ids[0], 51);
    const r = fecharSeDevido(p.carregado, 'arco-fe10', simuladas([]));
    assert.equal(r.fechado, false, 'subteto esgotado só tira a conta');
    assert.equal(lerArco(p.dir, 'arco-fe10')!.situacao, 'vigente');
  } finally { p.limpar(); }
});

test('FE11: o retrato guarda a branch, a ponta e a árvore da worktree de cada thread, sem rede', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe11');
  try {
    const t = novaThread(p.carregado, { nome: 'fe11 com worktree', modo: 'auto', roadmap: 'RM-911', pedido: 'Trabalho SIMULADO com worktree.',
      criarWorktree: true }).thread;
    const trabalhos = [{ id: 'w1', item: 'RM-911', prioridade: 1, dependeDe: [], thread: t.id }];
    abrirArco(p.dir, 'arco-fe11', { trabalhos });
    const fim = lerArco(p.dir, 'arco-fe11')!.conteudo!.janela.fim;
    const chamadas: string[][] = [];
    const r = fecharSeDevido(p.carregado, 'arco-fe11', simuladas([], { quando: fim,
      git: (_cwd, args) => { chamadas.push(args); return args[0] === 'status' ? '' : args.includes('--abbrev-ref') ? 'ork/w1' : 'd'.repeat(40); } }));
    const w1 = r.retrato!.retomada.trabalhos.find(x => x.id === 'w1')!;
    assert.deepEqual([w1.branch, w1.ponta, w1.arvoreLimpa], ['ork/w1', 'd'.repeat(40), true]);
    assert.ok(chamadas.every(a => !a.includes('fetch') && !a.includes('push')), 'só leitura local');
  } finally { p.limpar(); }
});

test('FE12: a parada sem id, sem controle ou que falhou vem em palavras, e a fila vazia diz entrega registrada, não provada', () => {
  // Achado do ensaio do piloto (T8): o código cru (`sem-id`) chegava ao relatório como se fosse uma sessão parada.
  const parada = { seq: 3, trabalho: 't1', thread: 'ens-x', conta: 'perfil-a', detalhe: 'o runtime recusou (SIMULADO)' };
  const semId = textoDaParada({ ...parada, sessionId: null, runtime: 'claude-bg', resultado: 'sem-id' }, []);
  assert.equal(semId, 'reserva 3 (t1, claude-bg): reserva pendente sem id de sessão, nada a parar; reconciliar antes do arco novo');
  const codex = textoDaParada({ ...parada, sessionId: uuid(7), runtime: 'codex', resultado: 'sem-controle' }, []);
  assert.equal(codex, `${uuid(7)} (t1, codex): sem controle de parada no codex; conferir a sessão antes do arco novo`);
  const falhou = textoDaParada({ ...parada, sessionId: uuid(8), runtime: 'claude-bg', resultado: 'falhou' }, []);
  assert.equal(falhou, `${uuid(8)} (t1, claude-bg): o pedido de parada falhou (o runtime recusou (SIMULADO))`);
  for (const t of [semId, codex, falhou]) assert.doesNotMatch(t, /: (sem-id|sem-controle|falhou)$/, 'nenhum código cru no texto do dono');
  const estado = { contrato: 'ork.noctum-arco/v1', arco: 'arco-fe12', situacao: 'vigente', versao: 1, envelopeSha256: 'b'.repeat(64),
    autorizadoPor: { origem: 'telegram' } as never, revogadoPor: null, propostaPendente: null, decisoes: [], despachos: [],
    consumo: { arco: 0, porConta: {}, porRuntime: {} }, encerramento: null,
    conteudo: { janela: { inicio: '2026-10-13T06:00:00.000Z', fim: '2026-10-13T14:00:00.000Z', fuso: 'UTC' },
      orcamento: { arco: { valor: 3, unidade: 'sessoes' }, porConta: [], porRuntime: [] } } as never } as EstadoDoArco;
  const vazia = { situacao: 'vazia', decisao: { acao: 'encerrar', motivo: 'fila-vazia' } } as FilaDoArco;
  const detalhe = condicaoDeFechamento(estado, vazia, null, '2026-10-13T12:00:00.000Z')!.detalhe;
  assert.match(detalhe, /^todo trabalho do envelope tem a entrega registrada \(ship_done\), fechou sem entrega/);
  assert.doesNotMatch(detalhe, /está entregue/, 'o ship_done sem a prova do push não é entrega provada: quem diz qual tem prova é o relatório');
});

test('FE13: a reserva pendente para pela sessão que a falha do runtime disse, também na thread que o arco abriu para o pedido', { skip: semKernel }, () => {
  // Achado do CHECK: o claude --bg que diz o id e sai com erro deixa a sessão aberta, e a reserva fica pendente sem o id no log.
  const p = projetoTemporario('noctum-fe13');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const pedido = 'Fatia SIMULADA que o arco abre no fechamento.';
    const sha = abrirArco(p.dir, 'arco-fe13', { trabalhos: [...trabalhos, { id: 'n1', item: 'RM-913', prioridade: 2, dependeDe: [], pedido }] });
    const r1 = reservarDespacho(p.dir, { arco: 'arco-fe13', envelopeSha256: sha, trabalho: 't1', thread: ids[0], fase: 'GO', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    registrar(dirThread(p.dir, ids[0]), ids[0], 'phase_dispatch_failed', { fase: 'GO', sessionId: uuid(61), motivo: 'runtime.unavailable' });
    const r2 = reservarDespacho(p.dir, { arco: 'arco-fe13', envelopeSha256: sha, trabalho: 'n1', thread: null, fase: 'GOAL', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    const aberta = novaThread(p.carregado, { nome: 'rm-913 n1', modo: 'auto', roadmap: 'RM-913', pedido, criarWorktree: false }).thread.id;
    registrar(dirThread(p.dir, aberta), aberta, 'phase_dispatch_failed', { fase: 'GOAL', sessionId: uuid(62), motivo: 'runtime.unavailable' });
    const fim = lerArco(p.dir, 'arco-fe13')!.conteudo!.janela.fim;
    const paradas: SessaoEmVoo[] = [];
    const r = fecharSeDevido(p.carregado, 'arco-fe13', simuladas(paradas, { quando: fim }));
    assert.equal(r.motivo, 'hora');
    assert.deepEqual(paradas.map(x => [x.seq, x.sessionId, x.thread]).sort(), [[r1.seq, uuid(61), ids[0]], [r2.seq, uuid(62), aberta]].sort());
    assert.deepEqual(r.paradas.map(x => x.resultado), ['pedida', 'pedida']);
    const pendentes = r.retrato!.retomada.reconciliacaoPendente.join('\n');
    assert.match(pendentes, new RegExp(`reserva ${r1.seq} \\(t1\\): pendente, com a sessão ${uuid(61)} dita na falha do runtime`));
    assert.match(pendentes, new RegExp(`reserva ${r2.seq} \\(n1\\): pendente, com a sessão ${uuid(62)} dita na falha do runtime`));
  } finally { p.limpar(); }
});

test('FE14: o encerrado sem o retrato (o processo caiu no meio) ganha o retrato no tique seguinte, uma vez só', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe14');
  try {
    const { trabalhos, ids } = threads(p, 1);
    abrirArco(p.dir, 'arco-fe14', { trabalhos });
    entregar(p.dir, ids[0]);
    encerrarArco(p.dir, 'arco-fe14', { motivo: 'fila-vazia', detalhe: 'simulado: o processo caiu antes do registro' });
    assert.equal(lerFechamento(p.dir, 'arco-fe14').retrato, null);
    const r = fecharSeDevido(p.carregado, 'arco-fe14', simuladas([]));
    assert.deepEqual([r.fechado, r.agora, r.motivo], [true, false, 'fila-vazia']);
    assert.equal(r.retrato?.detalhe, 'simulado: o processo caiu antes do registro');
    assert.deepEqual(r.retrato?.retomada.trabalhos.map(t => [t.id, t.estado]), [['t1', 'entregue']]);
    fecharSeDevido(p.carregado, 'arco-fe14', simuladas([]));
    const linhas = lerRegistro<{ tipo: string }>(p.dir, 'arco-fe14', 'fechamento').filter(l => l.evento.tipo === 'fechado');
    assert.equal(linhas.length, 1);
  } finally { p.limpar(); }
});

test('FE15: a hora fecha mesmo com a medição falhando; medida que não é número não prova o teto; teto superior sai como teto superior', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe15');
  try {
    const { trabalhos } = threads(p, 1);
    const comTeto = (arco: string, unidade: 'minutos-de-sessao' | 'percentual-da-cota', valor: number) => {
      const pedido = pedidoV2(arco, { trabalhos });
      autorizarPedido(p.dir, arco, { ...pedido, orcamento: { ...(pedido.orcamento as Record<string, unknown>), arco: { valor, unidade } } });
      return lerArco(p.dir, arco)!.conteudo!.janela.fim;
    };
    const quebra = () => { throw new Error('transcrição SIMULADA ilegível'); };
    const fim = comTeto('arco-fe15', 'minutos-de-sessao', 60);
    const antes = fecharSeDevido(p.carregado, 'arco-fe15', simuladas([], { medir: quebra }));
    assert.equal(antes.fechado, false);
    assert.match(antes.detalhe, /a medição falhou \(transcrição SIMULADA ilegível\)/);
    const hora = fecharSeDevido(p.carregado, 'arco-fe15', simuladas([], { quando: fim, medir: quebra }));
    assert.deepEqual([hora.fechado, hora.motivo], [true, 'hora'], 'a hora final não depende da medição');
    assert.equal(hora.retrato?.consumo['minutos-de-sessao'].valor, null);
    assert.match(hora.retrato!.consumo.tokens.lacunas.join(' '), /a medição falhou no fechamento/);
    comTeto('arco-fe15b', 'minutos-de-sessao', 60);
    const nan = fecharSeDevido(p.carregado, 'arco-fe15b', simuladas([], { medir: (_r, e, q) => medicaoVazia(e.arco, q, Number.NaN) }));
    assert.equal(nan.fechado, false, 'NaN nunca é maior ou igual ao teto, e não vira custo alcançado');
    comTeto('arco-fe15c', 'percentual-da-cota', 50);
    const cota = (_r: string, e: EstadoDoArco, q: string): MedicaoDoArco => {
      const m = medicaoVazia(e.arco, q);
      m.doArco['percentual-da-cota'] = { unidade: 'percentual-da-cota', valor: 95, lacunas: [], parcial: false, tetoSuperior: true, sessoes: 1 };
      return m;
    };
    const teto = fecharSeDevido(p.carregado, 'arco-fe15c', simuladas([], { medir: cota }));
    assert.equal(teto.motivo, 'custo');
    assert.match(teto.detalhe, /teto do arco é de 50 percentual-da-cota e o consumo medido é até 95% \(teto superior\)/);
  } finally { p.limpar(); }
});

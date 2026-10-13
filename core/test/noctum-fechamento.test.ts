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
import { concluirDespacho, EstadoDoArco, lerArco, reservarDespacho } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import { condicaoDeFechamento, fecharSeDevido, lerFechamento, OpcoesDoFechamento, SessaoEmVoo, textoDaParada } from '../src/noctum-fechamento';
import { FilaDoArco } from '../src/noctum-fila';
import { MedicaoDoArco } from '../src/noctum-medicao';
import { dirThread, novaThread } from '../src/thread';

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

test('FE2: o teto do arco em sessões fecha por custo com sessões em voo; reserva devolvida depois não reabre nem redespacha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-fe2');
  try {
    const { trabalhos, ids } = threads(p);
    const sha = abrirArco(p.dir, 'arco-fe2', { trabalhos, tetoDoArco: 2 });
    sessao(p, 'arco-fe2', sha, 't1', ids[0], 11);
    // A segunda reserva fica pendente: o núcleo ainda não disse se a sessão abriu.
    const s2 = reservarDespacho(p.dir, { arco: 'arco-fe2', envelopeSha256: sha, trabalho: 't2', thread: ids[1], fase: 'GO',
      runtime: 'claude-bg', conta: 'perfil-a', revisao: false }).seq;
    const paradas: SessaoEmVoo[] = [];
    const r = fecharSeDevido(p.carregado, 'arco-fe2', simuladas(paradas));
    assert.deepEqual([r.fechado, r.motivo], [true, 'custo']);
    assert.match(r.detalhe, /teto do arco é de 2 sessoes e 2 foram reservadas/);
    assert.deepEqual(paradas.map(s => s.sessionId), [uuid(11)], 'parada global: a sessão em voo com id');
    assert.deepEqual(r.paradas.map(x => x.resultado).sort(), ['pedida', 'sem-id']);
    const antes = lerArco(p.dir, 'arco-fe2')!.despachos.length;
    concluirDespacho(p.dir, 'arco-fe2', s2, { motivo: 'runtime.quota-exhausted' });
    assert.equal(lerArco(p.dir, 'arco-fe2')!.consumo.arco, 1, 'a reserva voltou ao orçamento');
    assert.equal(lerArco(p.dir, 'arco-fe2')!.situacao, 'encerrado', 'e o arco continua encerrado');
    recusa(() => reservarDespacho(p.dir, { arco: 'arco-fe2', envelopeSha256: sha, trabalho: 't1', thread: ids[0], fase: 'GO',
      runtime: 'claude-bg', conta: 'perfil-a', revisao: false }), 'noctum.efeito.encerrado');
    const segundo = fecharSeDevido(p.carregado, 'arco-fe2', simuladas(paradas));
    assert.equal(segundo.agora, false);
    assert.equal(lerArco(p.dir, 'arco-fe2')!.despachos.length, antes, 'nenhum despacho novo depois do fechamento');
    assert.equal(paradas.length, 1, 'nenhuma parada repetida');
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
    const paradas: SessaoEmVoo[] = [];
    const a = fecharSeDevido(p.carregado, 'arco-fe7', simuladas(paradas));
    const b = fecharSeDevido(p.carregado, 'arco-fe7', simuladas(paradas, { listarSessoes: () => ({ lidas: false, vivas: new Set() }) }));
    assert.deepEqual(b.retrato, a.retrato);
    assert.equal(b.conferencias.length, 0, 'sem a listagem completa, a parada fica sem conferência, nunca confirmada por presunção');
    const c = fecharSeDevido(p.carregado, 'arco-fe7', simuladas(paradas, { listarSessoes: () => ({ lidas: true, vivas: new Set([uuid(31)]) }) }));
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

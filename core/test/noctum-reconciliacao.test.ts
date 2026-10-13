/**
 * RM-058 (N4, D7 a D12, D15 e D16 da ork-rm058n4): a reconciliação do que ficou no meio. Só decisões, com a prova de cada
 * uma; quem grava é o vigia. Todos os itens, sessões, contas e provas são SIMULADOS; as raízes de estado são descartáveis.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { commitar, projetoTemporario, runtimeFalso, shaDaBranch } from './apoio';
import { abrirArco, despachar, gravarArtefato, passar, prepararIngressoSimulado, stopSemResultado, threadDoTrabalho } from './noctum-apoio';
import { runtimeCom, runtimeSemLeitura } from './noctum-supervisao-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { registrar } from '../src/ledger';
import { concluirDespacho, EstadoDoArco, lerArco, reservarDespacho } from '../src/noctum-arco';
import { envelopeComTrabalhos } from '../src/noctum-envelope';
import { decidirPedidos, decidirReservas, decidirSessoes, DecisaoDeSessao, efeitosAbertos, faseDaRetomada, LeituraDoRuntime, lerRemotoPadrao,
  paradaPorAmbiente, provaDaSessao, reconciliarEfeito, recusaDeAmbiente, registrarEfeitoIncerto, retomadaPendente } from '../src/noctum-reconciliacao';
import { exec } from '../src/util';
import { caminhoDaFila, enfileirar, lerFilaDeRetomada, PedidoComPerfil } from '../src/ratelimit';
import { retomarPorId } from '../src/retry';
import { rodarFase } from '../src/phase';
import { lerLedger } from '../src/ledger';
import { revogarArco } from './noctum-apoio';
import { ConteudoV2, correlacaoDoArco, EstadoDaSupervisao, gravarNaSupervisao, lerSupervisao, parametrosDoArco } from '../src/noctum-supervisao';
import { caminhoThread, dirThread, gravarThread, lerThread } from '../src/thread';
import { Fase } from '../src/types';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
type Projeto = ReturnType<typeof projetoTemporario>;

const MIN = 60_000;
const depois = (min: number) => new Date(Date.now() + min * MIN).toISOString();
const conteudo = (p: Projeto, arco: string): ConteudoV2 => {
  const c = lerArco(p.dir, arco)!.conteudo!;
  assert.ok(envelopeComTrabalhos(c));
  return c as ConteudoV2;
};
const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Um trabalho que já é uma thread #Auto com o pedido guardado, e o arco autorizado sobre ele. */
function arcoComThread(p: Projeto, arco: string, item = 'RM-901') {
  const t = threadDoTrabalho(p.carregado, `trabalho de ${arco}`, item, `Pedido SIMULADO de ${arco}.`);
  const h = abrirArco(p.dir, arco, { trabalhos: [{ id: 'a', item, prioridade: 1, dependeDe: [], thread: t.id }], contas: [{ conta: 'perfil-a', sessoes: 2 }] });
  parametrosDoArco(p.carregado, arco);
  return { t, h };
}

/** O que o `phase run` do arco grava antes do adaptador: o prompt com a correlação. */
function promptDoArco(raiz: string, thread: string, arco: string, fase: Fase, slug = `${thread}-${fase.toLowerCase()}`): void {
  registrar(dirThread(raiz, thread), thread, 'phase_prompt_recorded', { fase, slug, runtime: 'claude-bg', correlacao: correlacaoDoArco(arco),
    promptPath: `.orkastery/threads/${thread}/prompts/SIMULADO.md`, promptSha256: '0'.repeat(64) });
}

/** O despacho do arco como o `phase run` deixa: o lease de sessão e o `phase_dispatch` com a correlação e o perfil. */
function despachoDoArco(raiz: string, thread: string, arco: string, fase: Fase, n: number, conduzindo = true): { sessionId: string; despachoEm: string } {
  const d = despachar(raiz, thread, fase, n, conduzindo);
  // O `despachar` do apoio da N2 grava o phase_dispatch sem correlação; o do arco leva a dele e o perfil.
  const linhas = fs.readFileSync(caminhoLedger(raiz, thread), 'utf8').trimEnd().split('\n');
  const ultimo = JSON.parse(linhas.at(-1)!) as Record<string, unknown>;
  ultimo.correlacao = correlacaoDoArco(arco);
  ultimo.perfil = { id: 'perfil-a', runtime: 'claude-bg', configDir: '/contas/perfil-a' };
  linhas[linhas.length - 1] = JSON.stringify(ultimo);
  fs.writeFileSync(caminhoLedger(raiz, thread), linhas.join('\n') + '\n');
  return d;
}
const caminhoLedger = (raiz: string, thread: string) => `${dirThread(raiz, thread)}/ledger.jsonl`;

/** O passo do arco atendendo um despacho: a reserva, o despacho com a correlação e o desfecho concluído. */
function atender(p: Projeto, arco: string, h: string, thread: string, fase: Fase, n: number): { sessionId: string; despachoEm: string } {
  const r = reservarDespacho(p.dir, { arco, envelopeSha256: h, trabalho: 'a', thread, fase, runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
  passar(2);
  const d = despachoDoArco(p.dir, thread, arco, fase, n);
  concluirDespacho(p.dir, arco, r.seq, { thread, sessionId: d.sessionId, idempotente: false });
  return d;
}
const com = (leitura: LeituraDoRuntime, min: number): LeituraDoRuntime => ({ ...leitura, lidaEm: depois(min) });

const decisoesDeSessao = (p: Projeto, arco: string, leitura = runtimeCom([]), quando = new Date().toISOString()) =>
  decidirSessoes(p.dir, arco, conteudo(p, arco), lerArco(p.dir, arco, quando)!, lerSupervisao(p.dir, arco), leitura, quando);
const resumo = (ds: DecisaoDeSessao[]) => ds.map(d => d.acao === 'retomar' ? `retomar:${d.fase}:${d.motivo}:${d.tentativa}:${d.parar ? 'parar' : '-'}:${d.morta ? 'morta' : '-'}`
  : d.acao === 'isolar' ? `isolar:${d.motivo}` : `aguardar`);

test('R1: a reserva pendente cujo despacho o ledger prova (ou atendido pela sessão em curso) vira concluída com a sessão', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r1');
  try {
    const { t, h } = arcoComThread(p, 'arco-r1');
    reservarDespacho(p.dir, { arco: 'arco-r1', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    passar(5);
    promptDoArco(p.dir, t.id, 'arco-r1', 'GOAL');
    const d = despachoDoArco(p.dir, t.id, 'arco-r1', 'GOAL', 11);
    const [r] = decidirReservas(p.dir, 'arco-r1', conteudo(p, 'arco-r1'), lerArco(p.dir, 'arco-r1')!, runtimeCom([]), lerSupervisao(p.dir, 'arco-r1').parametros!,
      new Date().toISOString());
    assert.deepEqual([r.acao, r.sessionId, r.idempotente], ['concluir', d.sessionId, false]);
    assert.match(r.prova, /phase_dispatch .* correlação do arco/);
    // A sessão em curso que atende o pedido (despacho idempotente) também conclui.
    const { t: t2, h: h2 } = arcoComThread(p, 'arco-r1b', 'RM-902');
    reservarDespacho(p.dir, { arco: 'arco-r1b', envelopeSha256: h2, trabalho: 'a', thread: t2.id, fase: 'GO', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    passar(5);
    registrar(dirThread(p.dir, t2.id), t2.id, 'despacho_idempotente', { fase: 'GO', sessionId: sid(12), canal: 'cli' });
    const [r2] = decidirReservas(p.dir, 'arco-r1b', conteudo(p, 'arco-r1b'), lerArco(p.dir, 'arco-r1b')!, runtimeCom([]),
      lerSupervisao(p.dir, 'arco-r1b').parametros!, new Date().toISOString());
    assert.deepEqual([r2.acao, r2.sessionId, r2.idempotente], ['concluir', sid(12), true]);
  } finally { p.limpar(); }
});

test('R2: a reserva sem nada lançado volta ao orçamento; com thread ilegível no projeto, o trabalho de pedido espera a prova', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r2');
  try {
    const h = abrirArco(p.dir, 'arco-r2', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO r2.' }] });
    parametrosDoArco(p.carregado, 'arco-r2');
    reservarDespacho(p.dir, { arco: 'arco-r2', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    const decidir = () => decidirReservas(p.dir, 'arco-r2', conteudo(p, 'arco-r2'), lerArco(p.dir, 'arco-r2')!, runtimeCom([]),
      lerSupervisao(p.dir, 'arco-r2').parametros!, new Date().toISOString())[0];
    let r = decidir();
    assert.equal(r.acao, 'devolver');
    assert.match(String(r.motivo), /^noctum\.reconciliacao\.sem-lancamento/);
    // A thread aberta pelo passo antes de morrer, sem prompt gravado: o runtime não foi chamado.
    const t = threadDoTrabalho(p.carregado, 'aberta', 'RM-901', 'Pedido SIMULADO r2.');
    r = decidir();
    assert.deepEqual([r.acao, r.thread], ['devolver', t.id]);
    assert.match(r.prova, /nenhum prompt gravado/);
    // Uma thread ilegível pode ser a dele: sem prova de que nada foi lançado, espera.
    fs.writeFileSync(caminhoThread(p.dir, t.id), '{ ilegível');
    r = decidir();
    assert.equal(r.acao, 'aguardar');
  } finally { p.limpar(); }
});

test('R3: com o id dito na falha, o runtime decide: viva conclui, morta conclui (e a morte vai ao ledger), sem leitura espera e isola depois da carência', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r3');
  try {
    const { t, h } = arcoComThread(p, 'arco-r3');
    reservarDespacho(p.dir, { arco: 'arco-r3', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    passar(5);
    promptDoArco(p.dir, t.id, 'arco-r3', 'GOAL');
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch_failed', { fase: 'GOAL', runtime: 'claude-bg', correlacao: correlacaoDoArco('arco-r3'),
      perfil: { id: 'perfil-a', runtime: 'claude-bg' }, sessionId: sid(31), erro: 'runtime.unavailable: SIMULADO depois do id' });
    const decidir = (leitura: LeituraDoRuntime, quando = new Date().toISOString()) => decidirReservas(p.dir, 'arco-r3', conteudo(p, 'arco-r3'),
      lerArco(p.dir, 'arco-r3')!, leitura, lerSupervisao(p.dir, 'arco-r3').parametros!, quando)[0];
    const viva = decidir(runtimeCom([{ sessionId: sid(31), state: 'working' }]));
    assert.deepEqual([viva.acao, viva.sessionId, viva.morta], ['concluir', sid(31), null]);
    const morta = decidir(runtimeCom([{ sessionId: sid(31), state: 'failed', viva: false }]));
    assert.deepEqual([morta.acao, morta.sessionId, morta.morta?.sessionId, morta.morta?.fase], ['concluir', sid(31), sid(31), 'GOAL']);
    assert.equal(decidir(com(runtimeCom([]), 0)).acao, 'aguardar', 'ausente logo depois da falha: a listagem pode ainda não a ter');
    const ausente = decidir(com(runtimeCom([]), 6), depois(6));
    assert.deepEqual([ausente.acao, ausente.morta?.sessionId], ['concluir', sid(31)], 'ausente da listagem completa da conta dela, depois da ausência mínima: acabou');
    assert.equal(decidir(runtimeSemLeitura()).acao, 'aguardar');
    const vencida = decidir(runtimeSemLeitura(), depois(16));
    assert.deepEqual([vencida.acao, vencida.isolamento?.motivo], ['isolar', 'reserva-incerta']);
  } finally { p.limpar(); }
});

test('R4: o prompt gravado sem despacho nem id: a sessão da thread achada conclui e isola; ausente da listagem completa devolve depois da carência', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r4');
  try {
    const { t, h } = arcoComThread(p, 'arco-r4');
    reservarDespacho(p.dir, { arco: 'arco-r4', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    passar(5);
    promptDoArco(p.dir, t.id, 'arco-r4', 'GOAL', 'slug-r4');
    const decidir = (leitura: ReturnType<typeof runtimeCom>, quando = new Date().toISOString()) => decidirReservas(p.dir, 'arco-r4', conteudo(p, 'arco-r4'),
      lerArco(p.dir, 'arco-r4')!, leitura, lerSupervisao(p.dir, 'arco-r4').parametros!, quando)[0];
    const achada = decidir(runtimeCom([{ sessionId: sid(41), name: 'slug-r4', state: 'working' }]));
    assert.deepEqual([achada.acao, achada.sessionId, achada.isolamento?.motivo], ['concluir', sid(41), 'sessao-fora-do-registro']);
    assert.equal(decidir(runtimeCom([])).acao, 'aguardar', 'na carência, a sessão pode ainda aparecer');
    const vencida = decidir(runtimeCom([]), depois(16));
    assert.equal(vencida.acao, 'devolver');
    assert.match(String(vencida.motivo), /^noctum\.reconciliacao\.sem-sessao/);
    const semLeitura = decidir(runtimeSemLeitura(), depois(16));
    assert.deepEqual([semLeitura.acao, semLeitura.isolamento?.motivo], ['isolar', 'reserva-incerta'], 'sem prova, a reserva fica contada');
  } finally { p.limpar(); }
});

test('R5: o fim de turno sem resultado vira, depois da carência e com a sessão parada, a retomada da fase seguinte à prova mais adiantada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r5');
  try {
    const { t } = arcoComThread(p, 'arco-r5');
    const d = despachoDoArco(p.dir, t.id, 'arco-r5', 'GOAL', 51);
    gravarArtefato(p.dir, t.id, 'plan.md');
    stopSemResultado(p.dir, t.id, 'GOAL', d);
    const parada = runtimeCom([{ sessionId: d.sessionId, state: 'idle' }]);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r5', parada)), [], 'na carência, nada');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r5', parada, depois(16))), ['retomar:GO:fim-de-turno-sem-resultado:1:parar:-'],
      'o bloco já fez o PLAN: a retomada é do GO, com a sessão parada antes pelo runtime');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r5', runtimeCom([{ sessionId: d.sessionId, state: 'stopped', viva: false }]), depois(16))),
      ['retomar:GO:sessao-morta:1:-:morta'], 'a sessão já acabou: sessao_morta e retomada, sem parar nada');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r5', runtimeCom([{ sessionId: d.sessionId, state: 'working' }]), depois(16))), [],
      'a sessão que voltou a trabalhar não é retomada');
    assert.equal(faseDaRetomada(p.dir, lerThread(p.dir, t.id), [], 'GOAL', new Date(Date.now() + MIN).toISOString()), 'GOAL',
      'sem prova depois do despacho, a mesma fase');
  } finally { p.limpar(); }
});

test('R6: o teto de retomadas por trabalho e fase isola o trabalho; a retomada autorizada só é atendida por uma reserva do arco que lançou', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r6');
  try {
    const { t, h } = arcoComThread(p, 'arco-r6');
    let d = atender(p, 'arco-r6', h, t.id, 'GO', 61);
    const morta = (id: string) => runtimeCom([{ sessionId: id, state: 'failed', viva: false }]);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r6', morta(d.sessionId))), ['aguardar'], 'na carência desde a última atividade da sessão, espera');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r6', morta(d.sessionId), depois(16))), ['retomar:GO:sessao-morta:1:-:morta']);
    const autorizar = (k: number, sessao: string) => gravarNaSupervisao(p.carregado, 'arco-r6', [{ tipo: 'retomada_autorizada', trabalho: 'a',
      thread: t.id, fase: 'GO', tentativa: k, motivo: 'sessao-morta', sessao, prova: 'SIMULADO' }]);
    autorizar(1, d.sessionId);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r6', morta(d.sessionId), depois(16)), [], 'a retomada autorizada espera uma reserva do arco');
    // A reserva recusada antes do lançamento (nada abriu) não atende a retomada.
    const recusada = reservarDespacho(p.dir, { arco: 'arco-r6', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GO', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    concluirDespacho(p.dir, 'arco-r6', recusada.seq, { motivo: 'concurrency.limite' });
    assert.deepEqual(decisoesDeSessao(p, 'arco-r6', morta(d.sessionId), depois(16)), [], 'ainda pendente');
    const teto = lerSupervisao(p.dir, 'arco-r6').parametros!.tetoDeRetomadas;
    const morreu = (id: string) => registrar(dirThread(p.dir, t.id), t.id, 'sessao_morta', { fase: 'GO', sessionId: id, origem: 'noctum.vigia',
      evidencia: 'SIMULADO' });
    for (let k = 2; k <= teto; k++) {
      morreu(d.sessionId);
      passar(5);
      d = atender(p, 'arco-r6', h, t.id, 'GO', 61 + k);
      assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r6', morta(d.sessionId), depois(16))), [`retomar:GO:sessao-morta:${k}:-:morta`]);
      autorizar(k, d.sessionId);
    }
    morreu(d.sessionId);
    passar(5);
    d = atender(p, 'arco-r6', h, t.id, 'GO', 69);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r6', morta(d.sessionId), depois(16))), ['isolar:retomadas-esgotadas']);
  } finally { p.limpar(); }
});

test('R7: a sessão que trabalha sem evento de produto além do prazo é parada e retomada; heartbeat não é avanço, commit é', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r7');
  try {
    const { t } = arcoComThread(p, 'arco-r7');
    const d = despachoDoArco(p.dir, t.id, 'arco-r7', 'GO', 71);
    passar(5);
    registrar(dirThread(p.dir, t.id), t.id, 'runtime_event', { fase: 'GO', sessionId: d.sessionId, sensor: 'heartbeat', fonte: 'ork sessions event' });
    const trabalhando = runtimeCom([{ sessionId: d.sessionId, state: 'working' }]);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r7', trabalhando, depois(30)), [], 'dentro do prazo, nada');
    const ds = decisoesDeSessao(p, 'arco-r7', trabalhando, depois(95));
    assert.deepEqual(resumo(ds), ['retomar:GO:sem-avanco:1:parar:-']);
    assert.ok(ds[0].acao === 'retomar' && ds[0].parar?.sessionId === d.sessionId && ds[0].parar.perfil === 'perfil-a');
    // Um heartbeat da sessão uma hora depois do despacho (instante gravado à mão na fixture) não é avanço: o prazo segue do despacho.
    fs.appendFileSync(caminhoLedger(p.dir, t.id), JSON.stringify({ ts: depois(60), thread: t.id, tipo: 'runtime_event', fase: 'GO',
      sessionId: d.sessionId, sensor: 'heartbeat', fonte: 'ork sessions event', eventId: 'heartbeat-r7-SIMULADO' }) + '\n');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r7', trabalhando, depois(95))), ['retomar:GO:sem-avanco:1:parar:-'], 'heartbeat não é avanço');
    // Um commit da sessão uma hora depois do despacho (instante gravado à mão na fixture): o prazo conta dele, e a retomada
    // de quem só começou o GO é o próprio GO (produto prova o PLAN, não o GO).
    fs.appendFileSync(caminhoLedger(p.dir, t.id), JSON.stringify({ ts: depois(60), thread: t.id, tipo: 'mcp_git_committed',
      commit: 'f'.repeat(40), paths: ['core/src/x.ts'], origem: 'mcp.git', eventId: 'commit-r7-SIMULADO' }) + '\n');
    assert.deepEqual(decisoesDeSessao(p, 'arco-r7', trabalhando, depois(95)), [], 'o commit é avanço: o prazo conta dele');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r7', trabalhando, depois(155))), ['retomar:GO:sem-avanco:1:parar:-']);
    // Sem leitura do runtime, nada se para.
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r7', runtimeSemLeitura(), depois(200))), ['aguardar']);
  } finally { p.limpar(); }
});

test('R8: a sessão sem primeiro turno é parada e retomada uma vez; na segunda, o trabalho é isolado com o motivo de ambiente', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r8');
  try {
    const { t, h } = arcoComThread(p, 'arco-r8');
    const d = atender(p, 'arco-r8', h, t.id, 'GOAL', 81);
    const presa = runtimeCom([{ sessionId: d.sessionId, state: 'busy' }]);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r8', presa, depois(10)), []);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r8', presa, depois(16))), ['retomar:GOAL:sem-primeiro-turno:1:parar:-']);
    gravarNaSupervisao(p.carregado, 'arco-r8', [{ tipo: 'retomada_autorizada', trabalho: 'a', thread: t.id, fase: 'GOAL', tentativa: 1,
      motivo: 'sem-primeiro-turno', sessao: d.sessionId, prova: 'SIMULADO' }]);
    registrar(dirThread(p.dir, t.id), t.id, 'sessao_morta', { fase: 'GOAL', sessionId: d.sessionId, origem: 'noctum.vigia', evidencia: 'SIMULADO' });
    passar(5);
    const d2 = atender(p, 'arco-r8', h, t.id, 'GOAL', 82);
    const ds = decisoesDeSessao(p, 'arco-r8', runtimeCom([{ sessionId: d2.sessionId, state: 'busy' }]), depois(16));
    assert.deepEqual(resumo(ds), ['isolar:sem-primeiro-turno']);
    assert.ok(ds[0].acao === 'isolar' && ds[0].parar?.sessionId === d2.sessionId, 'a sessão presa é parada também ao isolar, para soltar a vaga');
    assert.match(ds[0].acao === 'isolar' ? ds[0].detalhe : '', /servidor MCP novo/);
  } finally { p.limpar(); }
});

test('R9: o despacho de fora do arco numa thread dele, depois da autorização, isola o trabalho; o de antes não conta', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r9');
  try {
    const t = threadDoTrabalho(p.carregado, 'de fora', 'RM-901', 'Pedido SIMULADO r9.');
    despachar(p.dir, t.id, 'GOAL', 91);
    passar(5);
    abrirArco(p.dir, 'arco-r9', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] });
    parametrosDoArco(p.carregado, 'arco-r9');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r9')).filter(x => x.startsWith('isolar')), [], 'o despacho de antes do arco não conta');
    passar(5);
    despachar(p.dir, t.id, 'PLAN', 92, false);
    const ds = decisoesDeSessao(p, 'arco-r9');
    assert.deepEqual(resumo(ds), ['isolar:condutor-externo']);
    assert.match(ds[0].acao === 'isolar' ? ds[0].detalhe : '', /despacho de fora do arco \(PLAN/);
  } finally { p.limpar(); }
});

test('R10: recusas de ambiente seguidas no limite param o arco; um despacho concluído no meio zera a conta', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r10');
  try {
    const { t, h } = arcoComThread(p, 'arco-r10');
    assert.equal(recusaDeAmbiente('runtime.unavailable: runtime.context.conflict: MCP Orkastery divergente (SIMULADO)'), true);
    assert.equal(recusaDeAmbiente('runtime.unavailable: o adaptador lançou (SIMULADO)'), false);
    assert.equal(recusaDeAmbiente('runtime.context.installation: MCP não instalado (SIMULADO)'), true, 'o ambiente da máquina');
    assert.equal(recusaDeAmbiente('runtime.context.missing: projeto nao preparado pelo instalador MCP (SIMULADO)'), true);
    assert.equal(recusaDeAmbiente('runtime.context.scope: cwd divergente (SIMULADO)'), false, 'o contexto da thread conta como recusa do trabalho');
    const ambiente = { tipo: 'recusa_de_ambiente' as const, trabalho: 'a', thread: null, detalhe: 'runtime.context.conflict: SIMULADO' };
    gravarNaSupervisao(p.carregado, 'arco-r10', [ambiente]);
    assert.equal(paradaPorAmbiente(lerSupervisao(p.dir, 'arco-r10'), lerArco(p.dir, 'arco-r10')!), null);
    passar(5);
    const r = reservarDespacho(p.dir, { arco: 'arco-r10', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    concluirDespacho(p.dir, 'arco-r10', r.seq, { thread: t.id, sessionId: sid(101), idempotente: false });
    passar(5);
    gravarNaSupervisao(p.carregado, 'arco-r10', [ambiente]);
    assert.equal(paradaPorAmbiente(lerSupervisao(p.dir, 'arco-r10'), lerArco(p.dir, 'arco-r10')!), null, 'o concluído no meio zerou a série');
    gravarNaSupervisao(p.carregado, 'arco-r10', [ambiente]);
    assert.equal(paradaPorAmbiente(lerSupervisao(p.dir, 'arco-r10'), lerArco(p.dir, 'arco-r10')!)?.motivo, 'ambiente-do-despacho');
    // A prova do runtime: o codex ausente não prova nada; o claude-bg sem a conta consultada também não.
    assert.equal(provaDaSessao(runtimeCom([]), sid(1), 'perfil-a', 'codex').estado, 'desconhecida');
    assert.equal(provaDaSessao(runtimeCom([], ['perfil-b']), sid(1), 'perfil-a', 'claude-bg').estado, 'desconhecida');
    assert.equal(provaDaSessao(runtimeCom([{ sessionId: sid(1), state: 'busy', fantasma: true }]), sid(1), 'perfil-a', 'claude-bg').estado, 'morta');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// D17: o pedido do limite de uso do despacho do arco.
// ---------------------------------------------------------------------------

test('R11: o despacho do arco que cai no limite de uso deixa o pedido com a correlação, e o ork retry resume não o redespacha', { skip: semKernel }, (t) => {
  const p = projetoTemporario('noctum-r11');
  const runtime = runtimeFalso('noctum-r11');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { t: th } = arcoComThread(p, 'arco-r11');
  runtime.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|1757012400\n');
  const r = rodarFase(p.carregado, th.id, { fase: 'GOAL', prompt: 'Pedido SIMULADO de arco-r11.', correlacao: correlacaoDoArco('arco-r11') });
  assert.equal(r.motivo, 'runtime.rate-limited');
  const pedido = r.naFila as PedidoComPerfil;
  assert.equal(pedido.correlacao, 'noctum:arco-r11');
  const linhas = fs.readFileSync(caminhoDaFila(p.dir), 'utf8');
  const antes = lerLedger(dirThread(p.dir, th.id)).length;
  const retomada = retomarPorId(p.carregado, pedido.id, { forcar: true });
  assert.deepEqual([retomada.despachada, retomada.sessionId, retomada.motivo], [false, null, null]);
  assert.match(retomada.detalhe, /é do arco arco-r11: quem o retoma é o vigia do arco/);
  assert.equal(fs.readFileSync(caminhoDaFila(p.dir), 'utf8'), linhas, 'o pedido não foi regravado');
  assert.equal(lerLedger(dirThread(p.dir, th.id)).length, antes, 'nenhum retry_attempt, nenhum despacho');
  assert.equal(lerFilaDeRetomada(p.dir).filter(x => x.id === pedido.id).at(-1)!.estado, 'aguardando');
  // O pedido fora do arco segue o caminho de antes: o ensaio do retry registra a tentativa.
  const outra = threadDoTrabalho(p.carregado, 'fora do arco', 'RM-902', 'Pedido SIMULADO fora do arco.');
  runtime.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|1757012400\n');
  const fora = rodarFase(p.carregado, outra.id, { fase: 'GOAL', prompt: 'Pedido SIMULADO fora do arco.' });
  assert.equal((fora.naFila as PedidoComPerfil).correlacao, undefined);
  retomarPorId(p.carregado, fora.naFila!.id, { forcar: true, dryRun: true });
  assert.ok(lerLedger(dirThread(p.dir, outra.id)).some(e => e.tipo === 'retry_attempt'), 'o pedido comum segue no retry');
});

test('R12: o pedido aguardando do arco não vira despacho por fora: sai da fila depois do despacho do arco, ou com o arco encerrado', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r12');
  try {
    const { t } = arcoComThread(p, 'arco-r12');
    // O despacho do arco de antes do pedido (o GOAL que correu bem) não conta como a retomada dele.
    despachoDoArco(p.dir, t.id, 'arco-r12', 'GOAL', 120, false);
    passar(5);
    const sinal = { resetEm: depois(90), fonte: 'epoch' as const, trecho: 'usage limit SIMULADO' };
    const novo = (correlacao?: string) => enfileirar(p.carregado, { thread: t.id, fase: 'GO', slug: `${t.id}-go`, promptPath: 'prompt-SIMULADO.md',
      promptSha256: '0'.repeat(64), cwd: p.dir, model: null, effort: null, sinal, detalhe: 'SIMULADO', ...(correlacao ? { correlacao } : {}) });
    const doArco = novo(correlacaoDoArco('arco-r12'));
    novo();
    const decidir = () => decidirPedidos(p.dir, 'arco-r12', lerArco(p.dir, 'arco-r12')!);
    assert.deepEqual(decidir(), [], 'aguardando, sem despacho do arco depois: a retomada sai pelo passo do arco (decidirSessoes)');
    passar(5);
    despachoDoArco(p.dir, t.id, 'arco-r12', 'GO', 121);
    const ds = decidir();
    assert.equal(ds.length, 1, 'só o pedido com a correlação do arco');
    const [d] = ds;
    assert.ok(d.acao === 'cancelar' && d.pedido === doArco.id && /retomado pelo arco arco-r12/.test(d.motivo), JSON.stringify(d));
    revogarArco(p.dir, 'arco-r12');
    assert.equal(decidir().length, 1, 'com o arco encerrado, também só o dele');
    const [encerrado] = decidir();
    assert.ok(encerrado.acao === 'cancelar' && /terminou \(revogado\)/.test(encerrado.motivo), JSON.stringify(encerrado));
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// D18: o efeito externo de resultado incerto (o push), com um remoto bare local.
// ---------------------------------------------------------------------------

/** Um commit numa branch de trabalho do projeto de teste, publicado ou não no remoto bare. */
function commitNaBranch(p: Projeto, branch: string, publicar: boolean): string {
  exec('git', ['checkout', '-q', '-b', branch], p.dir);
  commitar(p.dir, `${branch.replace(/\//g, '-')}.md`, `# ${branch} SIMULADO\n`, `trabalho SIMULADO em ${branch}`);
  const sha = shaDaBranch(p.dir, branch);
  if (publicar) assert.equal(exec('git', ['push', '-q', 'origin', branch], p.dir).ok, true);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  return sha;
}

const efeito = (sha: string, branch: string, remoto = 'origin') =>
  ({ acao: 'push' as const, repositorio: 'exemplo/produto', remoto, branch, sha, trabalho: 'a', thread: null, detalhe: 'o push estourou o prazo (SIMULADO)' });

test('R13: o push incerto que o remoto tem confirma, e nada se repete; o envelope não muda', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r13', true);
  try {
    arcoComThread(p, 'arco-r13');
    const envelope = lerArco(p.dir, 'arco-r13')!;
    const sha = commitNaBranch(p, 'ork/trabalho-r13', true);
    const id = registrarEfeitoIncerto(p.carregado, 'arco-r13', efeito(sha, 'ork/trabalho-r13'));
    assert.deepEqual(efeitosAbertos(lerSupervisao(p.dir, 'arco-r13')), [id]);
    const r = reconciliarEfeito(p.carregado, 'arco-r13', id);
    assert.deepEqual([r.desfecho, r.podeRepetir, r.isolado], ['confirmado', false, false]);
    assert.deepEqual(efeitosAbertos(lerSupervisao(p.dir, 'arco-r13')), []);
    const linhas = lerSupervisao(p.dir, 'arco-r13').linhas;
    assert.equal(reconciliarEfeito(p.carregado, 'arco-r13', id).desfecho, 'confirmado');
    assert.equal(lerSupervisao(p.dir, 'arco-r13').linhas, linhas, 'o desfecho final não é relido nem regravado');
    const depois = lerArco(p.dir, 'arco-r13')!;
    assert.deepEqual([depois.versao, depois.envelopeSha256, depois.conteudo!.janela.fim], [envelope.versao, envelope.envelopeSha256, envelope.conteudo!.janela.fim]);
  } finally { p.limpar(); }
});

test('R14: o push incerto que o remoto não tem permite repetir com teto; outro sha na branch isola o trabalho', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r14', true);
  try {
    arcoComThread(p, 'arco-r14');
    const sha = commitNaBranch(p, 'ork/trabalho-r14', false);
    const primeiro = reconciliarEfeito(p.carregado, 'arco-r14', registrarEfeitoIncerto(p.carregado, 'arco-r14', efeito(sha, 'ork/trabalho-r14')));
    assert.deepEqual([primeiro.desfecho, primeiro.podeRepetir, primeiro.isolado], ['ausente', true, false]);
    passar(5);
    // A repetição também ficou incerta: um efeito novo do mesmo push, e o teto (2) chegou.
    const segundo = reconciliarEfeito(p.carregado, 'arco-r14', registrarEfeitoIncerto(p.carregado, 'arco-r14', efeito(sha, 'ork/trabalho-r14')));
    assert.deepEqual([segundo.desfecho, segundo.podeRepetir, segundo.isolado], ['ausente', false, true]);
    assert.equal(lerSupervisao(p.dir, 'arco-r14').isolados.get('a')?.motivo, 'efeito-esgotado');
    // Outro arco: a branch existe no remoto com outro commit.
    arcoComThread(p, 'arco-r14b', 'RM-902');
    const publicado = commitNaBranch(p, 'ork/trabalho-r14b', true);
    const r = reconciliarEfeito(p.carregado, 'arco-r14b', registrarEfeitoIncerto(p.carregado, 'arco-r14b', efeito(sha, 'ork/trabalho-r14b')));
    assert.deepEqual([r.desfecho, r.podeRepetir, r.isolado], ['divergente', false, true]);
    assert.match(r.prova, new RegExp(publicado));
    assert.equal(lerSupervisao(p.dir, 'arco-r14b').isolados.get('a')?.motivo, 'efeito-divergente');
  } finally { p.limpar(); }
});

test('R15: o remoto sem leitura é lacuna: o efeito fica aberto, é lido de novo e isola no teto; sem sha completo, recusa', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r15', true);
  try {
    arcoComThread(p, 'arco-r15');
    const sha = commitNaBranch(p, 'ork/trabalho-r15', true);
    const id = registrarEfeitoIncerto(p.carregado, 'arco-r15', efeito(sha, 'ork/trabalho-r15', 'remoto-que-nao-existe-SIMULADO'));
    const r1 = reconciliarEfeito(p.carregado, 'arco-r15', id);
    assert.deepEqual([r1.desfecho, r1.podeRepetir, r1.isolado], ['sem-leitura', false, false]);
    assert.deepEqual(efeitosAbertos(lerSupervisao(p.dir, 'arco-r15')), [id], 'a lacuna segue aberta para o tique seguinte');
    const r2 = reconciliarEfeito(p.carregado, 'arco-r15', id);
    assert.deepEqual([r2.desfecho, r2.isolado], ['sem-leitura', true]);
    assert.equal(lerSupervisao(p.dir, 'arco-r15').isolados.get('a')?.motivo, 'efeito-sem-leitura');
    assert.deepEqual(efeitosAbertos(lerSupervisao(p.dir, 'arco-r15')), []);
    assert.throws(() => registrarEfeitoIncerto(p.carregado, 'arco-r15', efeito('abc123', 'ork/trabalho-r15')), /sha completo/);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 1: a sessão parada antes do primeiro turno, o fim de turno que o observador viu e o remoto seguro.
// ---------------------------------------------------------------------------

test('R16: a sessão viva parada num diálogo antes do primeiro turno (não só a que trabalha) é parada e retomada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r16');
  try {
    const { t } = arcoComThread(p, 'arco-r16');
    const d = despachoDoArco(p.dir, t.id, 'arco-r16', 'GOAL', 161);
    const dialogo = runtimeCom([{ sessionId: d.sessionId, state: 'blocked' }]);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r16', dialogo, depois(10)), [], 'dentro do prazo do primeiro turno, nada');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r16', dialogo, depois(16))), ['retomar:GOAL:sem-primeiro-turno:1:parar:-']);
  } finally { p.limpar(); }
});

test('R17: o fim de turno que o observador viu com a sessão parada (sem pergunta ao dono) também vira retomada depois da carência', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r17');
  try {
    const { t } = arcoComThread(p, 'arco-r17');
    const d = despachoDoArco(p.dir, t.id, 'arco-r17', 'GO', 171);
    passar(5);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GO', sessionId: d.sessionId, ok: false, motivo: 'human.pending',
      origem: 'sessions.watch', estadoNativo: 'blocked', stop: { ts: new Date().toISOString() } });
    const parada = runtimeCom([{ sessionId: d.sessionId, state: 'blocked' }]);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r17', parada), [], 'na carência, nada');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r17', parada, depois(16))), ['retomar:GO:fim-de-turno-sem-resultado:1:parar:-']);
  } finally { p.limpar(); }
});

test('R18: o efeito incerto só aceita remoto e branch no formato seguro, e a leitura padrão recusa os outros sem chamar o git', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r18');
  try {
    arcoComThread(p, 'arco-r18');
    const sha = 'a'.repeat(40);
    const base = { acao: 'push' as const, repositorio: 'exemplo/produto', remoto: 'origin', branch: 'ork/ok', sha, trabalho: 'a', thread: null, detalhe: 'SIMULADO' };
    assert.throws(() => registrarEfeitoIncerto(p.carregado, 'arco-r18', { ...base, remoto: '--upload-pack=touch SIMULADO' }), /formato seguro/);
    assert.throws(() => registrarEfeitoIncerto(p.carregado, 'arco-r18', { ...base, branch: 'refs/heads/x' }), /formato seguro/);
    assert.throws(() => registrarEfeitoIncerto(p.carregado, 'arco-r18', { ...base, branch: '-x' }), /formato seguro/);
    assert.deepEqual(lerRemotoPadrao('--upload-pack=touch SIMULADO', 'ork/ok', p.dir), { ok: false, detalhe: 'remoto ou branch fora do formato seguro' });
    assert.equal(registrarEfeitoIncerto(p.carregado, 'arco-r18', base).startsWith('E-'), true);
  } finally { p.limpar(); }
});

test('R19: a thread que espera o dono (pausada) não é retomada pelo vigia, mesmo com a sessão morta', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r19');
  try {
    const { t } = arcoComThread(p, 'arco-r19');
    const d = despachoDoArco(p.dir, t.id, 'arco-r19', 'GO', 191);
    const morta = runtimeCom([{ sessionId: d.sessionId, state: 'failed', viva: false }]);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r19', morta, depois(16))), ['retomar:GO:sessao-morta:1:-:morta'], 'sem o dono no meio, retoma');
    gravarThread(p.dir, { ...lerThread(p.dir, t.id), status: 'pausada' });
    assert.deepEqual(decisoesDeSessao(p, 'arco-r19', morta, depois(16)), [], 'a pausa é do dono: nada sai sozinho');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 2: os bloqueadores e avisos da primeira rodada de revisão do GO.
// ---------------------------------------------------------------------------

/** A falha do despacho do arco como o `phase run` grava (a cota, o login, o limite de uso), com ou sem o id da sessão. */
function falhaDoArco(raiz: string, thread: string, arco: string, fase: Fase, erro: string, sessionId?: string): void {
  registrar(dirThread(raiz, thread), thread, 'phase_dispatch_failed', { fase, runtime: 'claude-bg', correlacao: correlacaoDoArco(arco),
    perfil: { id: 'perfil-a', runtime: 'claude-bg' }, erro, ...(sessionId ? { sessionId } : {}) });
}

test('R20: a falha do despacho sem id numa thread já despachada vira a retomada da mesma fase; a falha com id põe a sessão sob vigia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r20');
  try {
    const { t } = arcoComThread(p, 'arco-r20');
    // A thread que nunca teve despacho: a fila da N2 a despacha de novo, sem retomada.
    falhaDoArco(p.dir, t.id, 'arco-r20', 'GOAL', 'runtime.auth-missing: SIMULADO');
    assert.deepEqual(decisoesDeSessao(p, 'arco-r20', runtimeCom([]), depois(16)), [], 'sem despacho anterior, o passo da N2 despacha de novo');
    passar(5);
    const d = despachoDoArco(p.dir, t.id, 'arco-r20', 'GOAL', 201);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', sessionId: d.sessionId, classificacao: 'fase_concluida', ok: true });
    passar(5);
    falhaDoArco(p.dir, t.id, 'arco-r20', 'PLAN', 'runtime.quota-exhausted: SIMULADO');
    const encerrada = runtimeCom([{ sessionId: d.sessionId, state: 'done', viva: false }]);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r20', encerrada)), ['retomar:PLAN:despacho-falho:1:-:-'],
      'a falha sem id do PLAN depois do GOAL concluído não fica parada: a retomada sai pelo passo, com a conta que falhou fora');
    passar(5);
    falhaDoArco(p.dir, t.id, 'arco-r20', 'PLAN', 'runtime.unavailable: SIMULADO depois do id', sid(202));
    const morta = runtimeCom([{ sessionId: sid(202), state: 'failed', viva: false }]);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r20', morta)), ['aguardar'], 'a sessão dita na falha é vigiada como a de um despacho');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r20', morta, depois(16))), ['retomar:PLAN:despacho-falho:1:-:morta']);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r20', runtimeCom([{ sessionId: sid(202), state: 'busy' }]), depois(16))),
      ['retomar:PLAN:sem-primeiro-turno:1:parar:-'], 'viva e sem sinal além do prazo do primeiro turno: parada e retomada');
  } finally { p.limpar(); }
});

test('R21: a ausência na listagem só prova a morte da sessão despachada antes da leitura, com a ausência mínima', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r21');
  try {
    const { t } = arcoComThread(p, 'arco-r21');
    const d = despachoDoArco(p.dir, t.id, 'arco-r21', 'GOAL', 211);
    const minima = lerSupervisao(p.dir, 'arco-r21').parametros!.ausenciaMinimaMs;
    assert.equal(provaDaSessao(com(runtimeCom([]), 0), d.sessionId, 'perfil-a', 'claude-bg', d.despachoEm, minima).estado, 'desconhecida',
      'a listagem feita junto do despacho pode não ter a sessão ainda');
    assert.equal(provaDaSessao(runtimeCom([]), d.sessionId, 'perfil-a', 'claude-bg', d.despachoEm, minima).estado, 'desconhecida',
      'sem o instante da leitura, a ausência não prova');
    assert.equal(provaDaSessao(com(runtimeCom([]), 6), d.sessionId, 'perfil-a', 'claude-bg', d.despachoEm, minima).estado, 'morta');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r21', runtimeCom([]), depois(16))), ['aguardar'], 'a leitura velha não mata ninguém');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r21', com(runtimeCom([]), 16), depois(16))), ['retomar:GOAL:sessao-morta:1:-:morta']);
  } finally { p.limpar(); }
});

test('R22: a sessão que o runtime já mostra encerrada logo depois do Stop espera o resultado da fase pela carência', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r22');
  try {
    const { t } = arcoComThread(p, 'arco-r22');
    const d = despachoDoArco(p.dir, t.id, 'arco-r22', 'GOAL', 221);
    passar(5);
    stopSemResultado(p.dir, t.id, 'GOAL', d);
    const encerrada = runtimeCom([{ sessionId: d.sessionId, state: 'done', viva: false }]);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r22', encerrada, depois(1))), ['aguardar'], 'o done chega antes do resultado que o observador grava');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r22', encerrada, depois(16))), ['retomar:GOAL:sessao-morta:1:-:morta']);
    // A carência conta da última atividade da sessão (o evento de 20 min depois, gravado à mão na fixture), não do despacho.
    fs.appendFileSync(caminhoLedger(p.dir, t.id), JSON.stringify({ ts: depois(20), thread: t.id, tipo: 'runtime_event', fase: 'GOAL',
      sessionId: d.sessionId, sensor: 'stop', fonte: 'ork sessions event', eventId: 'evento-r22-SIMULADO' }) + '\n');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r22', encerrada, depois(25))), ['aguardar'], '5 min depois da última atividade, ainda na carência');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r22', encerrada, depois(36))), ['retomar:GOAL:sessao-morta:1:-:morta']);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', sessionId: d.sessionId, classificacao: 'fase_concluida', ok: true });
    assert.deepEqual(decisoesDeSessao(p, 'arco-r22', encerrada, depois(36)), [], 'com o resultado, nada a retomar');
  } finally { p.limpar(); }
});

test('R23: a fonte ausente (sem o claude no PATH) e a ausência no codex não provam a morte de ninguém', () => {
  const ausente: LeituraDoRuntime = { ...runtimeCom([]), fontes: [{ origem: 'claude agents --json --all (perfil perfil-a, SIMULADO)', ok: true,
    ausente: true, detalhe: 'SIMULADO: claude ausente', correcao: 'SIMULADO' }], lidaEm: depois(60) };
  const p1 = provaDaSessao(ausente, sid(231), 'perfil-a', 'claude-bg', new Date().toISOString(), 0);
  assert.equal(p1.estado, 'desconhecida');
  assert.match(p1.detalhe, /claude não está no PATH/);
  const codex: LeituraDoRuntime = { sessoes: [], fontes: [{ origem: 'codex (perfil perfil-c, SIMULADO)', ok: true, detalhe: '' }],
    contas: [{ runtime: 'codex', perfil: { id: 'perfil-c', runtime: 'codex', codexHome: '/contas/perfil-c' } }], lidaEm: depois(60) };
  const p2 = provaDaSessao(codex, sid(232), 'perfil-c', 'codex', new Date().toISOString(), 0);
  assert.equal(p2.estado, 'desconhecida', 'a conta codex consultada, e mesmo assim a ausência não prova');
  assert.match(p2.detalhe, /ausência no codex não prova/);
});

test('R24: a sessão antiga da mesma worktree não é deste lançamento; a que nasceu depois da reserva é', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r24');
  try {
    const { t, h } = arcoComThread(p, 'arco-r24');
    const pasta = `${p.dir}/worktree-r24-SIMULADA`;
    gravarThread(p.dir, { ...lerThread(p.dir, t.id), worktree: pasta });
    reservarDespacho(p.dir, { arco: 'arco-r24', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    passar(5);
    promptDoArco(p.dir, t.id, 'arco-r24', 'GOAL', 'slug-r24');
    const decidir = (leitura: LeituraDoRuntime) => decidirReservas(p.dir, 'arco-r24', conteudo(p, 'arco-r24'), lerArco(p.dir, 'arco-r24')!, leitura,
      lerSupervisao(p.dir, 'arco-r24').parametros!, depois(16))[0];
    const antiga = decidir(runtimeCom([{ sessionId: sid(241), name: 'outra-SIMULADA', cwd: pasta, startedAt: Date.now() - 120 * MIN, state: 'working' }]));
    assert.equal(antiga.acao, 'devolver', 'a sessão de duas horas atrás na mesma worktree não prova o lançamento');
    const nova = decidir(runtimeCom([{ sessionId: sid(242), name: 'outra-SIMULADA', cwd: pasta, startedAt: Date.now(), state: 'working' }]));
    assert.deepEqual([nova.acao, nova.sessionId, nova.isolamento?.motivo], ['concluir', sid(242), 'sessao-fora-do-registro']);
  } finally { p.limpar(); }
});

test('R25: só o despacho com a correlação do arco e a fase da reserva conclui a reserva', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r25');
  try {
    const { t, h } = arcoComThread(p, 'arco-r25');
    reservarDespacho(p.dir, { arco: 'arco-r25', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    passar(5);
    const decidir = () => decidirReservas(p.dir, 'arco-r25', conteudo(p, 'arco-r25'), lerArco(p.dir, 'arco-r25')!, runtimeCom([]),
      lerSupervisao(p.dir, 'arco-r25').parametros!, new Date().toISOString())[0];
    despachar(p.dir, t.id, 'GOAL', 251, false);
    assert.equal(decidir().acao, 'devolver', 'o despacho sem a correlação é de outro condutor');
    passar(5);
    despachoDoArco(p.dir, t.id, 'arco-r25', 'PLAN', 252, false);
    assert.equal(decidir().acao, 'devolver', 'o despacho do arco de outra fase não é o desta reserva');
    passar(5);
    const d = despachoDoArco(p.dir, t.id, 'arco-r25', 'GOAL', 253, false);
    assert.deepEqual([decidir().acao, decidir().sessionId], ['concluir', d.sessionId]);
  } finally { p.limpar(); }
});

test('R26: o trabalho com reserva pendente fica de fora da decisão das sessões até a reserva ter desfecho', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r26');
  try {
    const { t, h } = arcoComThread(p, 'arco-r26');
    const d = despachoDoArco(p.dir, t.id, 'arco-r26', 'GO', 261);
    const morta = runtimeCom([{ sessionId: d.sessionId, state: 'failed', viva: false }]);
    passar(5);
    const r = reservarDespacho(p.dir, { arco: 'arco-r26', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GO', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    assert.deepEqual(decisoesDeSessao(p, 'arco-r26', morta, depois(16)), [], 'o passo do meio é da reconciliação das reservas');
    concluirDespacho(p.dir, 'arco-r26', r.seq, { motivo: 'concurrency.limite' });
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r26', morta, depois(16))), ['retomar:GO:sessao-morta:1:-:morta']);
  } finally { p.limpar(); }
});

test('R27: a sessao_morta já provada no ledger vale sem leitura do runtime e sem esperar a carência', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r27');
  try {
    const { t } = arcoComThread(p, 'arco-r27');
    const d = despachoDoArco(p.dir, t.id, 'arco-r27', 'GO', 271);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r27', runtimeSemLeitura())), ['aguardar'], 'sem prova nenhuma, espera');
    passar(5);
    registrar(dirThread(p.dir, t.id), t.id, 'sessao_morta', { fase: 'GO', sessionId: d.sessionId, origem: 'noctum.vigia', evidencia: 'SIMULADO' });
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r27', runtimeSemLeitura())), ['retomar:GO:sessao-morta:1:-:-'],
      'a morte provada não se registra de novo, e a retomada sai sem parar nada');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 3: o bloqueador e os avisos da segunda rodada de revisão do GO.
// ---------------------------------------------------------------------------

test('R28: com uma retomada pendente, o despacho de fora do arco isola o trabalho do mesmo jeito', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r28');
  try {
    const { t } = arcoComThread(p, 'arco-r28');
    const d = despachoDoArco(p.dir, t.id, 'arco-r28', 'GO', 281);
    gravarNaSupervisao(p.carregado, 'arco-r28', [{ tipo: 'retomada_autorizada', trabalho: 'a', thread: t.id, fase: 'GO', tentativa: 1,
      motivo: 'sessao-morta', sessao: d.sessionId, prova: 'SIMULADO', aposReserva: 0 }]);
    const morta = runtimeCom([{ sessionId: d.sessionId, state: 'failed', viva: false }]);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r28', morta, depois(16)), [], 'a retomada pendente espera a reserva do arco');
    passar(5);
    // O condutor de fora (o que relê a última linha do ledger) despacha o GO por cima.
    despachar(p.dir, t.id, 'GO', 282, false);
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r28', runtimeCom([{ sessionId: sid(282), state: 'busy' }]))), ['isolar:condutor-externo']);
  } finally { p.limpar(); }
});

test('R29: a retomada é atendida pela ordem das reservas no log do arco (o seq gravado na autorização), e não pelo relógio de outro processo', () => {
  const T = (min: number) => new Date(Date.parse('2026-01-01T03:00:00.000Z') + min * MIN).toISOString();
  const reserva = (seq: number, reservadoEm: string, desfecho: string, motivo: string | null = null) => ({ seq, trabalho: 'a', reservadoEm, desfecho, motivo });
  const sup = (aposReserva: number | null) => ({ retomadas: [{ trabalho: 'a', em: T(10), aposReserva, fase: 'GO', tentativa: 1 }] }) as unknown as EstadoDaSupervisao;
  const estado = (...despachos: ReturnType<typeof reserva>[]) => ({ despachos }) as unknown as EstadoDoArco;
  // O passo tomou o relógio antes da autorização e reservou depois dela, sob a trava: o instante é anterior, o seq é maior.
  assert.equal(retomadaPendente(sup(1), estado(reserva(1, T(0), 'concluido'), reserva(2, T(9), 'concluido')), 'a'), null);
  assert.ok(retomadaPendente(sup(1), estado(reserva(1, T(0), 'concluido')), 'a'), 'a reserva de antes da autorização não a atende');
  assert.ok(retomadaPendente(sup(1), estado(reserva(1, T(0), 'concluido'), reserva(2, T(11), 'recusado', 'concurrency.limite')), 'a'),
    'a recusa de antes do lançamento não a atende');
  // NA2: a devolução da reconciliação depois do prompt gravado (o runtime foi chamado e não abriu nada) atende; a sem lançamento, não.
  assert.equal(retomadaPendente(sup(1), estado(reserva(1, T(0), 'concluido'), reserva(2, T(11), 'recusado', 'noctum.reconciliacao.sem-sessao: SIMULADO')), 'a'), null);
  assert.ok(retomadaPendente(sup(1), estado(reserva(1, T(0), 'concluido'), reserva(2, T(11), 'recusado', 'noctum.reconciliacao.sem-lancamento: SIMULADO')), 'a'));
  // A linha sem o seq fica com o instante.
  assert.ok(retomadaPendente(sup(null), estado(reserva(1, T(0), 'concluido'), reserva(2, T(9), 'concluido')), 'a'));
  assert.equal(retomadaPendente(sup(null), estado(reserva(1, T(0), 'concluido'), reserva(2, T(11), 'concluido')), 'a'), null);
});

test('R30: a falha seca depois do prompt, devolvida sem sessão, atende a retomada, e a seguinte é a tentativa 2', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r30');
  try {
    const { t, h } = arcoComThread(p, 'arco-r30');
    const d = atender(p, 'arco-r30', h, t.id, 'GO', 301);
    registrar(dirThread(p.dir, t.id), t.id, 'sessao_morta', { fase: 'GO', sessionId: d.sessionId, origem: 'noctum.vigia', evidencia: 'SIMULADO' });
    gravarNaSupervisao(p.carregado, 'arco-r30', [{ tipo: 'retomada_autorizada', trabalho: 'a', thread: t.id, fase: 'GO', tentativa: 1,
      motivo: 'sessao-morta', sessao: d.sessionId, prova: 'SIMULADO', aposReserva: 1 }]);
    passar(5);
    const r = reservarDespacho(p.dir, { arco: 'arco-r30', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GO', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    passar(5);
    promptDoArco(p.dir, t.id, 'arco-r30', 'GO');
    falhaDoArco(p.dir, t.id, 'arco-r30', 'GO', 'runtime.unavailable: SIMULADO sem id');
    const [dev] = decidirReservas(p.dir, 'arco-r30', conteudo(p, 'arco-r30'), lerArco(p.dir, 'arco-r30')!, runtimeCom([]),
      lerSupervisao(p.dir, 'arco-r30').parametros!, depois(16));
    assert.deepEqual([dev.seq, dev.acao], [r.seq, 'devolver']);
    assert.match(String(dev.motivo), /^noctum\.reconciliacao\.sem-sessao/);
    concluirDespacho(p.dir, 'arco-r30', r.seq, { motivo: dev.motivo! });
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r30', runtimeCom([]), depois(16))), ['retomar:GO:despacho-falho:2:-:-'],
      'a tentativa lançada conta no teto');
  } finally { p.limpar(); }
});

test('R31: a recusa do núcleo depois do último lançamento numa thread já despachada vira a retomada da fase recusada; a baseline pendente não', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r31');
  try {
    const { t, h } = arcoComThread(p, 'arco-r31');
    const d = atender(p, 'arco-r31', h, t.id, 'GOAL', 311);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', sessionId: d.sessionId, classificacao: 'fase_concluida', ok: true });
    passar(5);
    const recusar = (motivo: string) => {
      const r = reservarDespacho(p.dir, { arco: 'arco-r31', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'PLAN', runtime: 'claude-bg',
        conta: 'perfil-a', revisao: false });
      registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { gate: 'phase.dispatch', fase: 'PLAN', motivo, origem: 'phase.run' });
      concluirDespacho(p.dir, 'arco-r31', r.seq, { motivo });
      passar(5);
    };
    const encerrada = runtimeCom([{ sessionId: d.sessionId, state: 'done', viva: false }]);
    assert.deepEqual(decisoesDeSessao(p, 'arco-r31', encerrada), [], 'GOAL concluído: nada a retomar');
    recusar('baseline.pendente');
    assert.deepEqual(decisoesDeSessao(p, 'arco-r31', encerrada), [], 'a baseline pendente é do passo da N2');
    recusar('noctum.despacho.erro');
    assert.deepEqual(decisoesDeSessao(p, 'arco-r31', encerrada), [], 'a recusa do próprio arco é da fila da N2 (erro repetido)');
    recusar('tree.blocked');
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r31', encerrada)), ['retomar:PLAN:despacho-falho:1:-:-'],
      'a Sentinela pede a retomada, e quem a autoriza é a N4');
  } finally { p.limpar(); }
});

test('R32: a thread que o dono despachou antes do arco, com a primeira tentativa do arco recusada pelo portão, também é retomada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-r32');
  try {
    const t = threadDoTrabalho(p.carregado, 'antes do arco', 'RM-901', 'Pedido SIMULADO r32.');
    const d = despachar(p.dir, t.id, 'GOAL', 321, false);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', sessionId: d.sessionId, classificacao: 'fase_concluida', ok: true });
    passar(5);
    const h = abrirArco(p.dir, 'arco-r32', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }],
      contas: [{ conta: 'perfil-a', sessoes: 2 }] });
    parametrosDoArco(p.carregado, 'arco-r32');
    const r = reservarDespacho(p.dir, { arco: 'arco-r32', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'PLAN', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { gate: 'phase.dispatch', fase: 'PLAN', motivo: 'tree.blocked', origem: 'phase.run' });
    concluirDespacho(p.dir, 'arco-r32', r.seq, { motivo: 'tree.blocked' });
    assert.deepEqual(resumo(decisoesDeSessao(p, 'arco-r32', runtimeCom([{ sessionId: d.sessionId, state: 'done', viva: false }]))),
      ['retomar:PLAN:despacho-falho:1:-:-']);
  } finally { p.limpar(); }
});

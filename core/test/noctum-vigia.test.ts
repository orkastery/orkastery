/**
 * RM-058 (N4, D3 a D6, D13 a D15 e D19 da ork-rm058n4): o condutor e o vigia do arco. O aceite da tabela de fatias vira
 * teste: parada do condutor e do vigia (processos filhos mortos de verdade), limite semanal, reset desconhecido, falha de
 * autenticação e retomada de sessão morta, com recuperação limitada ou isolamento, sem renovar o envelope nem trocar a
 * identidade (o despacho só sai por conta do envelope). Itens, contas, sessões e provas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { abrirArco, prepararIngressoSimulado, revogarArco, threadDoTrabalho, TrabalhoSimulado } from './noctum-apoio';
import { instancia, linhasDoLog, opcoesSimuladas, parametrosDoTeste, runtimeSimulado, storeCom } from './noctum-supervisao-apoio';
import { kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { lerLedger, registrar } from '../src/ledger';
import { concluirDespacho, EstadoDoArco, lerArco, reservarDespacho } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import { ParadaDeSessao } from '../src/noctum-reconciliacao';
import { ConteudoV2, contasDoArco, correlacaoDoArco, eventosDaSupervisao, gravarNaSupervisao, lerSupervisao, parametrosDoArco,
  retomadasDe } from '../src/noctum-supervisao';
import { conduzirArco, PAUSA_DEPOIS_DA_RECUSA_MS, passoConduzido, recusasSeguidas, ResultadoDoTique, vigiarArco } from '../src/noctum-vigia';
import { editarBloco } from '../src/setup';
import { ResultadoRun } from '../src/phase';
import { enfileirar, lerFilaDeRetomada } from '../src/ratelimit';
import { dirThread, listarIds } from '../src/thread';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
type Projeto = ReturnType<typeof projetoTemporario>;

const AC: TrabalhoSimulado[] = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA do vigia.' },
  { id: 'c', item: 'RM-903', prioridade: 2, dependeDe: [], pedido: 'Fatia C SIMULADA, independente.' },
];
const ITENS = ['RM-901', 'RM-902', 'RM-903'];
const DUAS = [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }];
const dist = path.resolve(__dirname, '..');

/** O que só a autorização do dono escreve no log do arco: nada da supervisão pode acrescentar uma linha dessas. */
const autorizacoes = (p: Projeto, arco: string) => fs.readFileSync(path.join(p.dir, '.orkastery', 'noctum', 'arcos', arco, 'arco.jsonl'), 'utf8')
  .split('\n').filter(l => l.includes('"tipo":"autorizado"') || l.includes('"tipo":"proposto"')).length;
const envelope = (p: Projeto, arco: string) => { const e = lerArco(p.dir, arco)!; return [e.versao, e.envelopeSha256, e.conteudo!.janela.fim]; };
const tique = (r: ReturnType<typeof vigiarArco>): ResultadoDoTique => { assert.equal(r.acao, 'tique', JSON.stringify(r)); return r as ResultadoDoTique; };

/** Um tique do vigia já concluído, por uma instância SIMULADA: o vigia está presente para o condutor. */
function vigiaPresente(p: Projeto, arco: string): void {
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'tique_iniciado', quem: instancia('vigia', 9) },
    { tipo: 'tique_concluido', quem: instancia('vigia', 9), resumo: 'SIMULADO' }]);
}

/** Um filho que roda o condutor ou o vigia com as dependências simuladas e trava no meio (dorme segurando a trava). */
function filho(p: Projeto, arco: string, papel: 'condutor' | 'vigia'): ChildProcess {
  const script = `
    const path = require('node:path');
    const { conduzirArco, vigiarArco } = require(path.join(${JSON.stringify(dist)}, 'src/noctum-vigia'));
    const { exigirManifesto } = require(path.join(${JSON.stringify(dist)}, 'src/manifest'));
    const apoio = require(path.join(${JSON.stringify(dist)}, 'test/noctum-supervisao-apoio'));
    const carregado = exigirManifesto(${JSON.stringify(p.dir)});
    const travar = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000);
    const opcoes = apoio.opcoesSimuladas(${JSON.stringify(p.dir)}, ${JSON.stringify(ITENS)}, [], { instancia: ${JSON.stringify(`${papel}-filho`)} });
    if (${JSON.stringify(papel)} === 'condutor') conduzirArco(carregado, ${JSON.stringify(arco)}, { ...opcoes, dormir: travar, maxPassos: 5 });
    else vigiarArco(carregado, ${JSON.stringify(arco)}, { ...opcoes, depoisDeIniciar: travar });
  `;
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function ate(condicao: () => boolean, prazoMs = 30_000): Promise<void> {
  const limite = Date.now() + prazoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('a condição do teste não veio no prazo');
    await new Promise(r => setTimeout(r, 50));
  }
}

async function matar(f: ChildProcess): Promise<void> {
  if (f.exitCode !== null || f.signalCode !== null) return;
  const saiu = new Promise(r => f.once('exit', r));
  f.kill('SIGKILL');
  await saiu;
}

test('G1: o condutor vivo não é substituído; morto por SIGKILL, o tique seguinte prova a ausência pela trava, assume com geração nova e segue o arco, sem renovar o envelope', { skip: semKernel }, async () => {
  const p = projetoTemporario('noctum-g1');
  let f: ChildProcess | null = null;
  try {
    abrirArco(p.dir, 'arco-g1', { trabalhos: AC, maquina: 2, contas: DUAS });
    vigiaPresente(p, 'arco-g1');
    const antes = { autorizacoes: autorizacoes(p, 'arco-g1'), envelope: envelope(p, 'arco-g1') };
    f = filho(p, 'arco-g1', 'condutor');
    await ate(() => (lerArco(p.dir, 'arco-g1')?.despachos ?? []).some(d => d.desfecho === 'concluido'));
    assert.deepEqual(lerArco(p.dir, 'arco-g1')!.despachos.map(d => `${d.trabalho}:${d.desfecho}`), ['a:concluido'], 'o condutor filho despachou A e dorme');
    // Vivo, ele segura a trava: o vigia não o substitui, nem despacha.
    const vivo = tique(vigiarArco(p.carregado, 'arco-g1', opcoesSimuladas(p.dir, ITENS)));
    assert.deepEqual([vivo.condutor, vivo.passo], ['vivo', null]);
    assert.equal(lerSupervisao(p.dir, 'arco-g1').geracao?.numero, 1);
    await matar(f);
    const registro: string[] = [];
    const r = tique(vigiarArco(p.carregado, 'arco-g1', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.equal(r.condutor, 'assumido');
    assert.ok(r.passo?.acao === 'despachou' && r.passo.trabalho === 'c', JSON.stringify(r.passo));
    const sup = lerSupervisao(p.dir, 'arco-g1');
    assert.deepEqual([sup.geracao?.numero, sup.geracao?.quem.papel], [2, 'vigia']);
    assert.match(sup.geracao!.prova, /trava do condutor estava livre: a geração 1 \(condutor condutor-filho, pid \d+\) não a segura mais/);
    const despachos = lerArco(p.dir, 'arco-g1')!.despachos;
    assert.deepEqual(despachos.map(d => `${d.trabalho}:${d.desfecho}:${d.conta}`), ['a:concluido:perfil-a', 'c:concluido:perfil-b'],
      'contas do envelope (a de mais folga), e nenhum despacho repetido de A');
    assert.deepEqual({ autorizacoes: autorizacoes(p, 'arco-g1'), envelope: envelope(p, 'arco-g1') }, antes, 'o envelope não foi renovado');
  } finally { if (f) await matar(f); p.limpar(); }
});

test('G2: o vigia morto no meio do tique é percebido pelo seguinte, que registra a interrupção e segue com os contadores de antes', { skip: semKernel }, async () => {
  const p = projetoTemporario('noctum-g2');
  let f: ChildProcess | null = null;
  try {
    abrirArco(p.dir, 'arco-g2', { trabalhos: AC, contas: DUAS });
    const parametros = parametrosDoArco(p.carregado, 'arco-g2');
    gravarNaSupervisao(p.carregado, 'arco-g2', [
      { tipo: 'retomada_autorizada', trabalho: 'a', thread: 'ork-thread-simulada', fase: 'GO', tentativa: 1, motivo: 'sessao-morta', sessao: null, prova: 'SIMULADO' },
      { tipo: 'conta_fora', conta: 'perfil-b', runtime: 'claude-bg', motivo: 'cota-sem-reset', ate: null, prova: 'SIMULADO' },
    ]);
    const linhas = () => lerSupervisao(p.dir, 'arco-g2').linhas;
    const antes = linhas();
    f = filho(p, 'arco-g2', 'vigia');
    await ate(() => linhas() > antes);
    assert.equal(lerSupervisao(p.dir, 'arco-g2').tiqueAberto?.quem.instancia, 'vigia-filho');
    // Com o filho vivo no meio do tique, outro vigia não entra.
    assert.equal(vigiarArco(p.carregado, 'arco-g2', opcoesSimuladas(p.dir, ITENS)).acao, 'outro-vigia');
    await matar(f);
    const r = tique(vigiarArco(p.carregado, 'arco-g2', opcoesSimuladas(p.dir, ITENS)));
    assert.equal(r.interrompido, 'vigia-filho');
    const sup = lerSupervisao(p.dir, 'arco-g2');
    assert.equal(sup.tiqueAberto, null);
    assert.equal(sup.interrupcoesSeguidas, 0, 'o tique concluído zera a série');
    assert.equal(retomadasDe(sup, 'a', 'GO'), 1, 'as tentativas de antes continuam');
    assert.equal(sup.contasFora.get('perfil-b')?.motivo, 'cota-sem-reset', 'a conta fora continua fora');
    assert.deepEqual(sup.parametros, parametros);
  } finally { if (f) await matar(f); p.limpar(); }
});

test('G3: sem tique do vigia dentro do limite, o condutor não despacha nada novo e diz por quê', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g3');
  try {
    abrirArco(p.dir, 'arco-g3', { trabalhos: AC, contas: DUAS });
    const condutor = instancia('condutor', 3);
    gravarNaSupervisao(p.carregado, 'arco-g3', [{ tipo: 'conducao_assumida', geracao: 1, quem: condutor, prova: 'SIMULADO' }]);
    const registro: string[] = [];
    const nunca = passoConduzido(p.carregado, 'arco-g3', condutor, opcoesSimuladas(p.dir, ITENS, registro));
    assert.ok(nunca.acao === 'aguardar' && nunca.motivo === 'vigia-ausente', JSON.stringify(nunca));
    vigiaPresente(p, 'arco-g3');
    const tarde = new Date(Date.now() + 20 * 60_000).toISOString();
    const velho = passoConduzido(p.carregado, 'arco-g3', condutor, { ...opcoesSimuladas(p.dir, ITENS, registro), quando: tarde });
    assert.ok(velho.acao === 'aguardar' && velho.motivo === 'vigia-ausente' && /há mais de 15 min/.test(velho.detalhe), JSON.stringify(velho));
    assert.equal(registro.length, 0, 'nada saiu sem supervisão');
    const agora = passoConduzido(p.carregado, 'arco-g3', condutor, opcoesSimuladas(p.dir, ITENS, registro));
    assert.ok(agora.acao === 'despachou' && agora.trabalho === 'a', JSON.stringify(agora));
  } finally { p.limpar(); }
});

test('G4: tiques do vigia interrompidos em série, no limite, param o arco; parado, ninguém despacha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g4');
  try {
    abrirArco(p.dir, 'arco-g4', { trabalhos: AC, contas: DUAS });
    const cai = () => { throw new Error('queda SIMULADA do vigia no meio do tique'); };
    for (let i = 1; i <= 3; i++) {
      assert.throws(() => vigiarArco(p.carregado, 'arco-g4', { ...opcoesSimuladas(p.dir, ITENS), instancia: `vigia-cai-${i}`, depoisDeIniciar: cai }), /queda SIMULADA/);
    }
    assert.equal(lerSupervisao(p.dir, 'arco-g4').interrupcoesSeguidas, 2);
    const registro: string[] = [];
    const r = tique(vigiarArco(p.carregado, 'arco-g4', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.deepEqual([r.interrompido, r.parada, r.condutor, r.passo], ['vigia-cai-3', 'supervisor-falhou', 'sem-passo', null]);
    assert.match(lerSupervisao(p.dir, 'arco-g4').parada!.detalhe, /3 tiques do vigia interrompidos em série/);
    const condutor = instancia('condutor', 4);
    gravarNaSupervisao(p.carregado, 'arco-g4', [{ tipo: 'conducao_assumida', geracao: 1, quem: condutor, prova: 'SIMULADO' }]);
    assert.equal(passoConduzido(p.carregado, 'arco-g4', condutor, opcoesSimuladas(p.dir, ITENS, registro)).acao, 'parado');
    assert.equal(registro.length, 0);
    // S6: o tique aberto de uma instância de mesmo nome também é de um vigia que morreu (a trava do vigia estava livre).
    assert.throws(() => vigiarArco(p.carregado, 'arco-g4', { ...opcoesSimuladas(p.dir, ITENS), instancia: 'vigia-mesma', depoisDeIniciar: cai }), /queda SIMULADA/);
    assert.equal(tique(vigiarArco(p.carregado, 'arco-g4', { ...opcoesSimuladas(p.dir, ITENS), instancia: 'vigia-mesma' })).interrompido, 'vigia-mesma');
    assert.equal(linhasDoLog(p.dir, 'arco-g4').map(l => JSON.parse(l).dados.evento)
      .filter(e => e.tipo === 'vigia_interrompido' && e.interrompido === 'vigia-mesma').length, 1, 'a interrupção vai ao log');
  } finally { p.limpar(); }
});

test('G5: o condutor que perde a geração sai sem despachar, e o laço do condutor termina nela', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g5');
  try {
    abrirArco(p.dir, 'arco-g5', { trabalhos: AC, contas: DUAS });
    vigiaPresente(p, 'arco-g5');
    const registro: string[] = [];
    let dormiu = 0;
    const r = conduzirArco(p.carregado, 'arco-g5', { ...opcoesSimuladas(p.dir, ITENS, registro), instancia: 'condutor-g5', maxPassos: 5,
      dormir: () => {
        dormiu += 1;
        // Enquanto este condutor dorme, outro assume a condução (a geração seguinte).
        const g = lerSupervisao(p.dir, 'arco-g5').geracao!.numero + 1;
        gravarNaSupervisao(p.carregado, 'arco-g5', [{ tipo: 'conducao_assumida', geracao: g, quem: instancia('condutor', 50), prova: 'SIMULADO' }]);
      } });
    assert.ok(r.acao === 'saiu' && r.ultimo?.acao === 'geracao-vencida', JSON.stringify(r));
    assert.equal(dormiu, 1);
    assert.deepEqual(registro.map(x => x.split(':')[1]), ['GOAL'], 'um despacho antes de perder a geração, nenhum depois');
    assert.equal(conduzirArco(p.carregado, 'arco-g5', { ...opcoesSimuladas(p.dir, ITENS), maxPassos: 0 }).acao, 'saiu', 'a trava solta no fim');
  } finally { p.limpar(); }
});

test('G6: a sessão morta sem resultado é retomada depois da carência: sessao_morta no ledger, retomada autorizada e despacho pelo passo do arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g6');
  try {
    abrirArco(p.dir, 'arco-g6', { trabalhos: [AC[0]], contas: DUAS });
    const carencia = parametrosDoTeste(p.carregado, 'arco-g6', { carenciaMs: 2 * 60_000 }).carenciaMs;
    const registro: string[] = [];
    const r1 = tique(vigiarArco(p.carregado, 'arco-g6', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const thread = r1.passo.thread, sessao = String(r1.passo.sessionId);
    // A sessão morre sem resultado: o runtime a mostra em failed.
    runtimeSimulado(p.dir).estado(sessao, 'failed');
    const cedo = tique(vigiarArco(p.carregado, 'arco-g6', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.equal(cedo.retomadas, 0, 'na carência, o resultado da fase pode ainda chegar');
    assert.ok(cedo.lacunas.some(l => /acabou há pouco/.test(l)), JSON.stringify(cedo.lacunas));
    const tarde = new Date(Date.now() + carencia + 60_000).toISOString();
    const r2 = tique(vigiarArco(p.carregado, 'arco-g6', { ...opcoesSimuladas(p.dir, ITENS, registro), quando: tarde }));
    assert.equal(r2.retomadas, 1);
    assert.ok(r2.passo?.acao === 'despachou' && r2.passo.trabalho === 'a' && r2.passo.fase === 'GOAL', JSON.stringify(r2.passo));
    const eventos = lerLedger(dirThread(p.dir, thread));
    assert.ok(eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === sessao && e.origem === 'noctum.vigia'), 'a morte provada vai ao ledger');
    const sup = lerSupervisao(p.dir, 'arco-g6');
    assert.deepEqual(sup.retomadas.map(x => `${x.trabalho}:${x.fase}:${x.tentativa}:${x.motivo}`), ['a:GOAL:1:sessao-morta']);
    const despachos = lerArco(p.dir, 'arco-g6')!.despachos;
    assert.deepEqual(despachos.map(d => `${d.trabalho}:${d.fase}:${d.desfecho}`), ['a:GOAL:concluido', 'a:GOAL:concluido'], 'a retomada tem reserva própria');
    assert.ok(despachos.every(d => ['perfil-a', 'perfil-b'].includes(d.conta)), 'só contas do envelope');
    // A retomada atendida não se repete no tique seguinte, e a morte vai ao ledger uma vez só.
    const r3 = tique(vigiarArco(p.carregado, 'arco-g6', { ...opcoesSimuladas(p.dir, ITENS, registro), quando: tarde }));
    assert.equal(r3.retomadas, 0);
    assert.equal(lerLedger(dirThread(p.dir, thread)).filter(e => e.tipo === 'sessao_morta' && e.sessionId === sessao).length, 1);
  } finally { p.limpar(); }
});

test('G7: o limite semanal tira a conta até o reset e o despacho seguinte vai à outra conta; com o login perdido na outra, nada sai, nem sem perfil', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g7');
  try {
    abrirArco(p.dir, 'arco-g7', { trabalhos: AC, contas: DUAS, maquina: 2 });
    const reset = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
    // A conta A responde com o limite semanal; a B abre a sessão.
    const falha = (raiz: string, threadId: string, o: { perfil?: string; fase: string; correlacao?: string }) => {
      if (o.perfil !== 'perfil-a') return null;
      registrar(dirThread(raiz, threadId), threadId, 'phase_dispatch_failed', { fase: o.fase, runtime: 'claude-bg', correlacao: o.correlacao,
        perfil: { id: 'perfil-a', runtime: 'claude-bg' }, erro: 'runtime.quota-exhausted: weekly limit SIMULADO' });
      registrar(dirThread(raiz, threadId), threadId, 'gate_blocked', { gate: 'phase.dispatch', fase: o.fase, motivo: 'runtime.quota-exhausted',
        origem: 'phase.run', falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: reset, fonte: 'relogio', trecho: 'weekly limit SIMULADO' } });
      return { sessionId: null, bloqueado: false, motivo: 'runtime.quota-exhausted', erro: 'SIMULADO' } as unknown as ResultadoRun;
    };
    const registro: string[] = [];
    const r1 = tique(vigiarArco(p.carregado, 'arco-g7', opcoesSimuladas(p.dir, ITENS, registro, {}, falha as never)));
    assert.ok(r1.passo?.acao === 'recusado' && r1.passo.motivo === 'runtime.quota-exhausted', JSON.stringify(r1.passo));
    const r2 = tique(vigiarArco(p.carregado, 'arco-g7', opcoesSimuladas(p.dir, ITENS, registro, {}, falha as never)));
    assert.equal(r2.contas, 1, 'o tique registrou a conta A fora até o reset');
    assert.deepEqual(lerSupervisao(p.dir, 'arco-g7').contasFora.get('perfil-a'), { ...lerSupervisao(p.dir, 'arco-g7').contasFora.get('perfil-a')!,
      motivo: 'cota', ate: reset });
    assert.ok(r2.passo?.acao === 'despachou' && r2.passo.conta === 'perfil-b', JSON.stringify(r2.passo));
    assert.deepEqual(registro.map(x => x.split(':').slice(2).join(':')), ['perfil-a:falhou', 'perfil-b'], 'a conta A não foi tentada de novo');
    // Login perdido em B e nenhuma outra conta: nada sai, nem sem perfil.
    gravarNaSupervisao(p.carregado, 'arco-g7', [{ tipo: 'conta_fora', conta: 'perfil-b', runtime: 'claude-bg', motivo: 'auth', ate: null, prova: 'SIMULADO' }]);
    const r3 = tique(vigiarArco(p.carregado, 'arco-g7', opcoesSimuladas(p.dir, ITENS, registro, {}, falha as never)));
    assert.ok(r3.passo?.acao === 'aguardar' && r3.passo.motivo === 'capacidade.conta-nao-autorizada', JSON.stringify(r3.passo));
    assert.equal(registro.length, 2, 'nenhum despacho sem conta do envelope');
  } finally { p.limpar(); }
});

test('G8: com o arco revogado, o tique só fecha a contabilidade do que estava em voo e tira da fila durável o pedido do arco; nada é despachado', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g8');
  try {
    const h = abrirArco(p.dir, 'arco-g8', { trabalhos: AC, contas: DUAS });
    parametrosDoArco(p.carregado, 'arco-g8');
    reservarDespacho(p.dir, { arco: 'arco-g8', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    const t = threadDoTrabalho(p.carregado, 'fatia c', 'RM-903', AC[1].pedido!);
    const pedido = enfileirar(p.carregado, { thread: t.id, fase: 'GOAL', slug: `${t.id}-goal`, promptPath: 'prompt-SIMULADO.md', promptSha256: '0'.repeat(64),
      cwd: p.dir, model: null, effort: null, sinal: { resetEm: null, fonte: 'sem-horario', trecho: 'SIMULADO' }, detalhe: 'SIMULADO',
      correlacao: correlacaoDoArco('arco-g8') });
    // A sessão do arco na thread de C, viva e sem sinal além do prazo do primeiro turno: com o arco vigente, seria parada.
    const sessao = '00000000-0000-4000-9000-000000000081';
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'GOAL', sessionId: sessao, runtime: 'claude-bg',
      correlacao: correlacaoDoArco('arco-g8'), perfil: { id: 'perfil-a', runtime: 'claude-bg' } });
    runtimeSimulado(p.dir).registrar(sessao, 'perfil-a');
    revogarArco(p.dir, 'arco-g8');
    const registro: string[] = [], paradas: string[] = [];
    const r = tique(vigiarArco(p.carregado, 'arco-g8', { ...opcoesSimuladas(p.dir, ITENS, registro, {
      pararSessao: (s) => { paradas.push(s.sessionId); return { ok: true, detalhe: 'SIMULADO' }; } }), quando: new Date(Date.now() + 20 * 60_000).toISOString() }));
    assert.deepEqual(paradas, [], 'com o arco revogado, o vigia não para sessão');
    assert.equal(lerSupervisao(p.dir, 'arco-g8').retomadas.length, 0, 'nem autoriza retomada');
    assert.deepEqual([r.situacao, r.condutor, r.passo, r.reservas], ['revogado', 'sem-passo', null, 1]);
    assert.deepEqual(lerArco(p.dir, 'arco-g8')!.despachos.map(d => d.desfecho), ['recusado'], 'a reserva sem lançamento voltou ao orçamento');
    assert.equal(lerFilaDeRetomada(p.dir).filter(x => x.id === pedido.id).at(-1)!.estado, 'cancelado');
    assert.equal(registro.length, 0);
    assert.equal(listarIds(p.dir).length, 1, 'nenhuma thread aberta depois da revogação');
  } finally { p.limpar(); }
});

test('G9: a cota sem reset dito, vista num despacho do arco, deixa a conta fora pelo resto do arco: depois da janela estimada do store, ela segue fora', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g9');
  try {
    abrirArco(p.dir, 'arco-g9', { trabalhos: AC, contas: DUAS, maquina: 2 });
    const falha = (raiz: string, threadId: string, o: { perfil?: string; fase: string; correlacao?: string }) => {
      if (o.perfil !== 'perfil-a') return null;
      registrar(dirThread(raiz, threadId), threadId, 'phase_dispatch_failed', { fase: o.fase, runtime: 'claude-bg', correlacao: o.correlacao,
        perfil: { id: 'perfil-a', runtime: 'claude-bg' }, erro: 'runtime.quota-exhausted: limit SIMULADO sem hora' });
      registrar(dirThread(raiz, threadId), threadId, 'gate_blocked', { gate: 'phase.dispatch', fase: o.fase, motivo: 'runtime.quota-exhausted',
        origem: 'phase.run', falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: null, fonte: 'sem-horario', trecho: 'limit SIMULADO' } });
      return { sessionId: null, bloqueado: false, motivo: 'runtime.quota-exhausted', erro: 'SIMULADO' } as unknown as ResultadoRun;
    };
    const registro: string[] = [];
    tique(vigiarArco(p.carregado, 'arco-g9', opcoesSimuladas(p.dir, ITENS, registro, {}, falha as never)));
    const r2 = tique(vigiarArco(p.carregado, 'arco-g9', opcoesSimuladas(p.dir, ITENS, registro, {}, falha as never)));
    assert.ok(r2.passo?.acao === 'despachou' && r2.passo.conta === 'perfil-b', JSON.stringify(r2.passo));
    const fora = lerSupervisao(p.dir, 'arco-g9').contasFora.get('perfil-a');
    assert.deepEqual([fora?.motivo, fora?.ate], ['cota-sem-reset', null]);
    // Duas horas depois: o store já devolveu a conta A (a janela estimada venceu), e o arco não.
    const tarde = new Date(Date.now() + 2 * 3600_000).toISOString();
    const estado = lerArco(p.dir, 'arco-g9', tarde)!;
    const visao = contasDoArco(estado.conteudo as ConteudoV2, estado, lerSupervisao(p.dir, 'arco-g9'), storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }]), tarde);
    assert.deepEqual(visao.perfis.map(x => x.id), ['perfil-b']);
    assert.ok(visao.lacunas.some(l => /perfil-a: reset desconhecido/.test(l)), JSON.stringify(visao.lacunas));
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 2: os bloqueadores e avisos da primeira rodada de revisão do GO, pelo vigia.
// ---------------------------------------------------------------------------

type Falha = (raiz: string, threadId: string, o: { perfil?: string; fase: string; correlacao?: string; runtime?: string }) => ResultadoRun | null;

test('G10: a retomada autorizada é atendida pela reserva do arco mesmo quando o lançamento falha depois do id; a morta seguinte é a tentativa 2', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g10');
  try {
    abrirArco(p.dir, 'arco-g10', { trabalhos: [AC[0]], contas: DUAS });
    parametrosDoTeste(p.carregado, 'arco-g10', { carenciaMs: 0 });
    const runtime = runtimeSimulado(p.dir);
    const dita = '00000000-0000-4000-9000-000000000102';
    let chamadas = 0;
    const falhaComId: Falha = (raiz, threadId, o) => {
      chamadas += 1;
      if (chamadas !== 2) return null;
      registrar(dirThread(raiz, threadId), threadId, 'phase_dispatch_failed', { fase: o.fase, runtime: 'claude-bg', correlacao: o.correlacao,
        perfil: { id: o.perfil, runtime: 'claude-bg' }, sessionId: dita, erro: 'runtime.unavailable: SIMULADO depois do id' });
      runtime.registrar(dita, o.perfil ?? null);
      runtime.estado(dita, 'failed');
      return { sessionId: null, bloqueado: false, motivo: 'runtime.unavailable', erro: 'SIMULADO depois do id' } as unknown as ResultadoRun;
    };
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, {}, falhaComId as never);
    const r1 = tique(vigiarArco(p.carregado, 'arco-g10', opcoes()));
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    runtime.estado(String(r1.passo.sessionId), 'failed');
    const r2 = tique(vigiarArco(p.carregado, 'arco-g10', opcoes()));
    assert.equal(r2.retomadas, 1);
    assert.ok(r2.passo?.acao === 'recusado' && r2.passo.motivo === 'runtime.unavailable', JSON.stringify(r2.passo));
    assert.deepEqual(lerArco(p.dir, 'arco-g10')!.despachos.map(d => d.desfecho), ['concluido', 'pendente'], 'a reserva da retomada ficou pendente e contada');
    const r3 = tique(vigiarArco(p.carregado, 'arco-g10', opcoes()));
    assert.deepEqual([r3.reservas, r3.retomadas], [1, 1], 'a reserva se resolve pela sessão dita na falha, e a morte dela é a tentativa 2');
    assert.ok(r3.passo?.acao === 'despachou', JSON.stringify(r3.passo));
    const seqs = lerArco(p.dir, 'arco-g10')!.despachos.map(d => d.seq);
    assert.deepEqual(lerSupervisao(p.dir, 'arco-g10').retomadas.map(x => `${x.fase}:${x.tentativa}:${x.motivo}:${x.aposReserva}`),
      [`GOAL:1:sessao-morta:${seqs[0]}`, `GOAL:2:despacho-falho:${seqs[1]}`], 'cada autorização guarda a última reserva do arco, e só as de depois a atendem');
    assert.equal(lerArco(p.dir, 'arco-g10')!.despachos.length, 3, 'nenhum despacho repetido da mesma autorização');
    assert.equal(registro.length, 3);
  } finally { p.limpar(); }
});

test('G11: a falha sem id do despacho da fase seguinte, numa conta que caiu na cota, vira a retomada pela outra conta do envelope', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g11');
  try {
    abrirArco(p.dir, 'arco-g11', { trabalhos: [AC[0]], contas: DUAS });
    const reset = new Date(Date.now() + 5 * 3600_000).toISOString();
    let falhou: string | null = null;
    const cota: Falha = (raiz, threadId, o) => {
      if (o.fase !== 'PLAN' || falhou) return null;
      falhou = o.perfil ?? null;
      registrar(dirThread(raiz, threadId), threadId, 'phase_dispatch_failed', { fase: o.fase, runtime: 'claude-bg', correlacao: o.correlacao,
        perfil: { id: o.perfil, runtime: 'claude-bg' }, erro: 'runtime.quota-exhausted: SIMULADO' });
      registrar(dirThread(raiz, threadId), threadId, 'gate_blocked', { gate: 'phase.dispatch', fase: o.fase, motivo: 'runtime.quota-exhausted',
        origem: 'phase.run', falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: reset, fonte: 'relogio', trecho: 'SIMULADO' } });
      return { sessionId: null, bloqueado: false, motivo: 'runtime.quota-exhausted', erro: 'SIMULADO' } as unknown as ResultadoRun;
    };
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, {}, cota as never);
    const r1 = tique(vigiarArco(p.carregado, 'arco-g11', opcoes()));
    assert.ok(r1.passo?.acao === 'despachou' && r1.passo.fase === 'GOAL', JSON.stringify(r1.passo));
    // O GOAL conclui; o passo seguinte despacha o PLAN, que cai na cota da conta escolhida, sem abrir sessão.
    registrar(dirThread(p.dir, r1.passo.thread), r1.passo.thread, 'phase_result', { fase: 'GOAL', sessionId: r1.passo.sessionId,
      classificacao: 'fase_concluida', ok: true });
    runtimeSimulado(p.dir).estado(String(r1.passo.sessionId), 'done');
    const r2 = tique(vigiarArco(p.carregado, 'arco-g11', opcoes()));
    assert.ok(r2.passo?.acao === 'recusado' && r2.passo.fase === 'PLAN' && r2.passo.motivo === 'runtime.quota-exhausted', JSON.stringify(r2.passo));
    const r3 = tique(vigiarArco(p.carregado, 'arco-g11', opcoes()));
    assert.equal(r3.retomadas, 1);
    assert.equal(lerSupervisao(p.dir, 'arco-g11').contasFora.get(String(falhou))?.motivo, 'cota');
    assert.ok(r3.passo?.acao === 'despachou' && r3.passo.fase === 'PLAN' && r3.passo.conta !== falhou, JSON.stringify(r3.passo));
    assert.deepEqual(lerSupervisao(p.dir, 'arco-g11').retomadas.map(x => `${x.fase}:${x.tentativa}:${x.motivo}`), ['PLAN:1:despacho-falho']);
  } finally { p.limpar(); }
});

test('G12: depois de uma recusa o condutor espera a pausa; o trabalho recusado seguidas vezes pelo núcleo (não pela conta) por uma cadência é isolado pelo vigia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g12');
  try {
    abrirArco(p.dir, 'arco-g12', { trabalhos: [AC[0]], contas: DUAS });
    vigiaPresente(p, 'arco-g12');
    const arvore: Falha = () => ({ sessionId: null, bloqueado: true, motivo: 'tree.blocked', erro: 'a árvore da worktree está suja (SIMULADO)' }) as unknown as ResultadoRun;
    const registro: string[] = [], dormiu: number[] = [];
    const c = conduzirArco(p.carregado, 'arco-g12', { ...opcoesSimuladas(p.dir, ITENS, registro, {}, arvore as never), maxPassos: 1,
      dormir: (ms) => { dormiu.push(ms); } });
    assert.ok(c.acao === 'saiu' && c.ultimo?.acao === 'recusado', JSON.stringify(c));
    assert.deepEqual(dormiu, [PAUSA_DEPOIS_DA_RECUSA_MS], 'nada de voltar na hora ao mesmo candidato');
    const { tetoDeRetomadas: teto, cadenciaMs } = lerSupervisao(p.dir, 'arco-g12').parametros!;
    for (let i = 1; i <= teto; i++) tique(vigiarArco(p.carregado, 'arco-g12', opcoesSimuladas(p.dir, ITENS, registro, {}, arvore as never)));
    assert.equal(lerSupervisao(p.dir, 'arco-g12').isolados.size, 0, 'no teto, mas num soluço mais curto que a cadência, o trabalho segue');
    // Tiques a cada minuto, cada um com mais uma recusa (como o condutor vivo depois da pausa): a série isola quando completa
    // uma cadência desde a PRIMEIRA recusa, e não desde a última (que, com o condutor vivo, nunca chegaria a uma cadência).
    const t0 = Date.now();
    let isoladoEm = -1;
    for (let k = 1; k <= 7 && isoladoEm < 0; k++) {
      const r = tique(vigiarArco(p.carregado, 'arco-g12', { ...opcoesSimuladas(p.dir, ITENS, registro, {}, arvore as never),
        quando: new Date(t0 + k * 60_000).toISOString() }));
      if (r.isolados) isoladoEm = k;
    }
    assert.equal(isoladoEm, Math.ceil(cadenciaMs / 60_000), 'isolado no tique em que a série completa uma cadência');
    assert.equal(lerSupervisao(p.dir, 'arco-g12').isolados.get('a')?.motivo, 'recusas-repetidas');
    assert.equal(registro.length, teto + isoladoEm, 'depois do isolamento, nenhum despacho novo');
    const tarde = { quando: new Date(t0 + 8 * 60_000).toISOString() };
    tique(vigiarArco(p.carregado, 'arco-g12', { ...opcoesSimuladas(p.dir, ITENS, registro, {}, arvore as never), ...tarde }));
    assert.equal(linhasDoLog(p.dir, 'arco-g12').filter(l => JSON.parse(l).dados.evento.tipo === 'isolado').length, 1, 'o isolamento se grava uma vez');
    // A recusa que depende da conta, da vaga ou da condução passa: não conta para isolar.
    const em = (i: number) => new Date(Date.parse('2026-01-01T03:00:00.000Z') + i * 60_000).toISOString();
    const estado = (motivos: string[]) => ({ despachos: motivos.map((motivo, i) => ({ seq: i + 1, trabalho: 'a', desfecho: 'recusado', motivo,
      reservadoEm: em(i) })) }) as unknown as EstadoDoArco;
    assert.deepEqual(recusasSeguidas(estado(['tree.blocked', 'tree.blocked']), 'a'), { n: 2, motivo: 'tree.blocked', desde: em(0) });
    assert.deepEqual(recusasSeguidas(estado(['tree.blocked', 'tree.blocked', 'concurrency.limite']), 'a'), { n: 0, motivo: null, desde: null });
    assert.deepEqual(recusasSeguidas(estado(['runtime.quota-exhausted', 'tree.blocked']), 'a'), { n: 1, motivo: 'tree.blocked', desde: em(1) });
    assert.deepEqual(recusasSeguidas(estado(['runtime.unavailable', 'runtime.unavailable']), 'a'), { n: 2, motivo: 'runtime.unavailable', desde: em(0) },
      'o runtime indisponível no portão não passa sozinho');
  } finally { p.limpar(); }
});

test('G13: o vigia nunca roda a baseline dentro do tique: o passo espera, e quem a roda é o condutor', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g13');
  try {
    abrirArco(p.dir, 'arco-g13', { trabalhos: [AC[0]], contas: DUAS });
    const pendente: Falha = () => ({ sessionId: null, bloqueado: false, motivo: 'baseline.pendente', erro: 'SIMULADO' }) as unknown as ResultadoRun;
    const baselines: string[] = [];
    const opcoes = opcoesSimuladas(p.dir, ITENS, [], { passo: { gravarBaseline: (_k: unknown, thread: string) => { baselines.push(thread); } } as never },
      pendente as never);
    const r = tique(vigiarArco(p.carregado, 'arco-g13', opcoes));
    assert.ok(r.passo?.acao === 'aguardar' && r.passo.motivo === 'baseline-pendente' && /não roda a baseline .* dentro do tique/.test(r.passo.detalhe),
      JSON.stringify(r.passo));
    assert.deepEqual(baselines, [], 'nem a baseline injetada no passo roda no tique');
    const c = conduzirArco(p.carregado, 'arco-g13', { ...opcoes, maxPassos: 1, dormir: () => undefined });
    assert.equal(c.acao, 'saiu', JSON.stringify(c));
    assert.equal(baselines.length, 1, 'o condutor roda a baseline');
  } finally { p.limpar(); }
});

test('G14: com a trava de despacho ocupada, o tique não reconcilia nada (lacuna), e o seguinte reconcilia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g14');
  try {
    const h = abrirArco(p.dir, 'arco-g14', { trabalhos: AC, contas: DUAS });
    parametrosDoArco(p.carregado, 'arco-g14');
    reservarDespacho(p.dir, { arco: 'arco-g14', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    const fd = tentarTravaExclusiva(path.join(p.dir, '.orkastery', 'noctum', 'despacho.lock'));
    assert.notEqual(fd, null);
    try {
      const r = tique(vigiarArco(p.carregado, 'arco-g14', opcoesSimuladas(p.dir, ITENS)));
      assert.equal(r.reservas, 0);
      assert.ok(r.lacunas.some(l => /segura a trava de despacho/.test(l)), JSON.stringify(r.lacunas));
      assert.deepEqual(lerArco(p.dir, 'arco-g14')!.despachos.map(d => d.desfecho), ['pendente']);
    } finally { fs.closeSync(fd!); }
    const r2 = tique(vigiarArco(p.carregado, 'arco-g14', opcoesSimuladas(p.dir, ITENS)));
    assert.equal(r2.reservas, 1);
    assert.equal(lerArco(p.dir, 'arco-g14')!.despachos[0].desfecho, 'recusado');
  } finally { p.limpar(); }
});

test('G15: a parada sem confirmação do runtime não autoriza retomada; confirmada, a retomada sai; presa no teto, o trabalho é isolado', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g15');
  try {
    abrirArco(p.dir, 'arco-g15', { trabalhos: [AC[0]], contas: DUAS });
    parametrosDoTeste(p.carregado, 'arco-g15', { primeiroTurnoMs: 0 });
    const runtime = runtimeSimulado(p.dir);
    const paradas: string[] = [];
    let aceita = false, finge = false;
    const parar = (s: ParadaDeSessao) => {
      paradas.push(s.sessionId);
      if (aceita) runtime.estado(s.sessionId, 'stopped');
      return { ok: aceita || finge, detalhe: aceita || finge ? 'claude stop SIMULADO' : 'SIMULADO: claude stop saiu 1' };
    };
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, { pararSessao: parar });
    const r1 = tique(vigiarArco(p.carregado, 'arco-g15', opcoes()));
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const sessao = String(r1.passo.sessionId), thread = r1.passo.thread;
    const r2 = tique(vigiarArco(p.carregado, 'arco-g15', opcoes()));
    assert.deepEqual([r2.retomadas, paradas], [0, [sessao]]);
    assert.ok(r2.lacunas.some(l => /não foi confirmada/.test(l)), JSON.stringify(r2.lacunas));
    assert.equal(lerLedger(dirThread(p.dir, thread)).some(e => e.tipo === 'sessao_morta'), false, 'sem confirmação, a sessão não é dada por morta');
    // O runtime aceita o pedido e a sessão segue na listagem: o aceite sozinho não confirma.
    finge = true;
    assert.equal(tique(vigiarArco(p.carregado, 'arco-g15', opcoes())).retomadas, 0);
    finge = false;
    aceita = true;
    const r3 = tique(vigiarArco(p.carregado, 'arco-g15', opcoes()));
    assert.equal(r3.retomadas, 1);
    assert.deepEqual(lerSupervisao(p.dir, 'arco-g15').sessoesParadas.map(x => x.confirmada), [false, false, true]);
    assert.ok(lerLedger(dirThread(p.dir, thread)).some(e => e.tipo === 'sessao_morta' && e.sessionId === sessao));
    // Outro arco: o runtime nunca confirma a parada, e no teto o trabalho sai do arco.
    abrirArco(p.dir, 'arco-g15b', { trabalhos: [AC[1]], contas: DUAS });
    parametrosDoTeste(p.carregado, 'arco-g15b', { primeiroTurnoMs: 0 });
    aceita = false;
    tique(vigiarArco(p.carregado, 'arco-g15b', opcoes()));
    const teto = lerSupervisao(p.dir, 'arco-g15b').parametros!.tetoDeRetomadas;
    for (let i = 1; i <= teto; i++) tique(vigiarArco(p.carregado, 'arco-g15b', opcoes()));
    const presa = lerSupervisao(p.dir, 'arco-g15b');
    assert.equal(presa.isolados.get('c')?.motivo, 'sessao-presa');
    assert.deepEqual([presa.retomadas.length, presa.sessoesParadas.filter(x => !x.confirmada).length], [0, teto]);
  } finally { p.limpar(); }
});

test('G16: dois despachos seguidos recusados pelo ambiente de quem despacha (o MCP divergente) param o arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g16');
  try {
    abrirArco(p.dir, 'arco-g16', { trabalhos: AC, contas: DUAS });
    const conflito: Falha = () => ({ sessionId: null, bloqueado: true, motivo: 'runtime.unavailable',
      erro: 'runtime.context.conflict: MCP Orkastery divergente, outro node no PATH (SIMULADO)' }) as unknown as ResultadoRun;
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, {}, conflito as never);
    const r1 = tique(vigiarArco(p.carregado, 'arco-g16', opcoes()));
    assert.ok(r1.passo?.acao === 'recusado', JSON.stringify(r1.passo));
    assert.equal(lerSupervisao(p.dir, 'arco-g16').parada, null, 'uma recusa de ambiente sozinha não para');
    tique(vigiarArco(p.carregado, 'arco-g16', opcoes()));
    assert.equal(lerSupervisao(p.dir, 'arco-g16').parada?.motivo, 'ambiente-do-despacho');
    const r3 = tique(vigiarArco(p.carregado, 'arco-g16', opcoes()));
    assert.deepEqual([r3.parada, r3.condutor, r3.passo], ['ambiente-do-despacho', 'sem-passo', null]);
    assert.equal(registro.length, 2, 'parado, nada mais é tentado');
  } finally { p.limpar(); }
});

test('G17: o passo conduzido leva as contas e os alvos do arco (com a conta claude fora, a fase sai pelo codex que o envelope admite); no teto do arco, para', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g17');
  try {
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO'] }).ok, true);
    abrirArco(p.dir, 'arco-g17', { trabalhos: [AC[0]], contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-c', sessoes: 2 }],
      runtimes: [{ runtime: 'claude-bg', sessoes: 2 }, { runtime: 'codex', sessoes: 2 }], tetoDoArco: 1 });
    const condutor = instancia('condutor', 17);
    gravarNaSupervisao(p.carregado, 'arco-g17', [{ tipo: 'conducao_assumida', geracao: 1, quem: condutor, prova: 'SIMULADO' },
      { tipo: 'conta_fora', conta: 'perfil-a', runtime: 'claude-bg', motivo: 'auth', ate: null, prova: 'SIMULADO' }]);
    vigiaPresente(p, 'arco-g17');
    const registro: string[] = [];
    const opcoes = { ...opcoesSimuladas(p.dir, ITENS, registro), lerStore: () => storeCom([{ id: 'perfil-a' }, { id: 'perfil-c', runtime: 'codex' }]) };
    const r = passoConduzido(p.carregado, 'arco-g17', condutor, opcoes);
    assert.ok(r.acao === 'despachou' && r.runtime === 'codex' && r.conta === 'perfil-c', JSON.stringify(r));
    const parado = passoConduzido(p.carregado, 'arco-g17', condutor, opcoes);
    assert.ok(parado.acao === 'parado' && parado.motivo === 'teto-do-arco', JSON.stringify(parado));
    assert.equal(lerSupervisao(p.dir, 'arco-g17').parada?.motivo, 'teto-do-arco');
    assert.equal(registro.length, 1);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 3: o bloqueador e os avisos da segunda rodada de revisão do GO, pelo vigia.
// ---------------------------------------------------------------------------

/** O portão do núcleo que recusa o despacho do PLAN antes de lançar, como o `phase run` grava (só o `gate_blocked`). */
const portaoDoPlan = (motivo: string, erro: string): Falha => (raiz, threadId, o) => {
  if (o.fase !== 'PLAN') return null;
  registrar(dirThread(raiz, threadId), threadId, 'gate_blocked', { gate: 'phase.dispatch', fase: o.fase, motivo, origem: 'phase.run' });
  return { sessionId: null, bloqueado: true, motivo, erro } as unknown as ResultadoRun;
};

/** O primeiro tique despacha o GOAL do trabalho, e o GOAL conclui. */
function goalConcluido(p: Projeto, arco: string, opcoes: () => ReturnType<typeof opcoesSimuladas>): string {
  const r1 = tique(vigiarArco(p.carregado, arco, opcoes()));
  assert.ok(r1.passo?.acao === 'despachou' && r1.passo.fase === 'GOAL', JSON.stringify(r1.passo));
  registrar(dirThread(p.dir, r1.passo.thread), r1.passo.thread, 'phase_result', { fase: 'GOAL', sessionId: r1.passo.sessionId,
    classificacao: 'fase_concluida', ok: true });
  runtimeSimulado(p.dir).estado(String(r1.passo.sessionId), 'done');
  return r1.passo.thread;
}

test('G18: a recusa do portão do núcleo depois de uma fase concluída é retomada pelo vigia e, repetida, isola o trabalho no teto', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g18');
  try {
    abrirArco(p.dir, 'arco-g18', { trabalhos: [AC[0]], contas: DUAS });
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, {}, portaoDoPlan('tree.blocked', 'a árvore da worktree está suja (SIMULADO)') as never);
    goalConcluido(p, 'arco-g18', opcoes);
    const { tetoDeRetomadas: teto, cadenciaMs } = lerSupervisao(p.dir, 'arco-g18').parametros!;
    for (let i = 0; i < teto; i++) tique(vigiarArco(p.carregado, 'arco-g18', opcoes()));
    assert.equal(lerSupervisao(p.dir, 'arco-g18').isolados.size, 0, 'o soluço mais curto que a cadência não isola');
    const tarde = new Date(Date.now() + cadenciaMs + 60_000).toISOString();
    for (let i = 0; i < 2; i++) tique(vigiarArco(p.carregado, 'arco-g18', { ...opcoes(), quando: tarde }));
    const sup = lerSupervisao(p.dir, 'arco-g18');
    assert.equal(sup.isolados.get('a')?.motivo, 'recusas-repetidas', 'sem a retomada, a fila deixava o trabalho preso sem resposta');
    assert.deepEqual(sup.retomadas.map(x => `${x.fase}:${x.tentativa}:${x.motivo}`), ['PLAN:1:despacho-falho'], 'uma autorização, que nenhuma recusa atende');
    assert.equal(registro.filter(x => x.endsWith(':falhou')).length, teto, 'isolado, nada mais é tentado');
  } finally { p.limpar(); }
});

test('G19: com um trabalho só, a recusa de ambiente se repete pela retomada, e a segunda para o arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g19');
  try {
    abrirArco(p.dir, 'arco-g19', { trabalhos: [AC[0]], contas: DUAS });
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, {},
      portaoDoPlan('runtime.unavailable', 'runtime.context.conflict: MCP Orkastery divergente, outro node no PATH (SIMULADO)') as never);
    goalConcluido(p, 'arco-g19', opcoes);
    for (let i = 0; i < 3; i++) tique(vigiarArco(p.carregado, 'arco-g19', opcoes()));
    assert.equal(lerSupervisao(p.dir, 'arco-g19').parada?.motivo, 'ambiente-do-despacho');
    assert.equal(registro.filter(x => x.endsWith(':falhou')).length, 2, 'parado, nada mais é tentado');
  } finally { p.limpar(); }
});

test('G20: a sessão que some da listagem completa morre pelo caminho do vigia, com o instante da leitura', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g20');
  try {
    abrirArco(p.dir, 'arco-g20', { trabalhos: [AC[0]], contas: DUAS });
    parametrosDoTeste(p.carregado, 'arco-g20', { carenciaMs: 0, ausenciaMinimaMs: 0 });
    const registro: string[] = [];
    const r1 = tique(vigiarArco(p.carregado, 'arco-g20', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    runtimeSimulado(p.dir).remover(String(r1.passo.sessionId));
    const r2 = tique(vigiarArco(p.carregado, 'arco-g20', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.equal(r2.retomadas, 1, 'ausente da listagem completa, a sessão despachada antes da leitura acabou');
    assert.match(lerSupervisao(p.dir, 'arco-g20').retomadas[0].prova, /listagem completa do claude-bg/);
  } finally { p.limpar(); }
});

test('G21: a morte já registrada no ledger não se registra de novo quando a reconciliação da reserva a prova outra vez', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g21');
  try {
    const t = threadDoTrabalho(p.carregado, 'fatia a', 'RM-901', AC[0].pedido!);
    const h = abrirArco(p.dir, 'arco-g21', { trabalhos: [AC[0]], contas: DUAS });
    parametrosDoArco(p.carregado, 'arco-g21');
    const dita = '00000000-0000-4000-9000-000000000211';
    reservarDespacho(p.dir, { arco: 'arco-g21', envelopeSha256: h, trabalho: 'a', thread: t.id, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch_failed', { fase: 'GOAL', runtime: 'claude-bg', correlacao: correlacaoDoArco('arco-g21'),
      perfil: { id: 'perfil-a', runtime: 'claude-bg' }, sessionId: dita, erro: 'runtime.unavailable: SIMULADO depois do id' });
    // O tique anterior provou a morte e caiu antes de concluir a reserva.
    registrar(dirThread(p.dir, t.id), t.id, 'sessao_morta', { fase: 'GOAL', sessionId: dita, origem: 'noctum.vigia', evidencia: 'SIMULADO' });
    const runtime = runtimeSimulado(p.dir);
    runtime.registrar(dita, 'perfil-a');
    runtime.estado(dita, 'failed');
    const r = tique(vigiarArco(p.carregado, 'arco-g21', opcoesSimuladas(p.dir, ITENS)));
    assert.equal(r.reservas, 1);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'sessao_morta' && e.sessionId === dita).length, 1);
  } finally { p.limpar(); }
});

test('G22: a recusa do runtime indisponível no portão, repetida, isola o trabalho no teto; a que passa faz o condutor esperar a cadência', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g22');
  try {
    abrirArco(p.dir, 'arco-g22', { trabalhos: [AC[0]], contas: DUAS });
    const registro: string[] = [];
    const opcoes = () => opcoesSimuladas(p.dir, ITENS, registro, {}, portaoDoPlan('runtime.unavailable', 'o runtime não está disponível (SIMULADO)') as never);
    goalConcluido(p, 'arco-g22', opcoes);
    const { tetoDeRetomadas: teto, cadenciaMs } = lerSupervisao(p.dir, 'arco-g22').parametros!;
    for (let i = 0; i < teto; i++) tique(vigiarArco(p.carregado, 'arco-g22', opcoes()));
    assert.equal(lerSupervisao(p.dir, 'arco-g22').isolados.size, 0, 'a conferência de login inconclusiva por menos de uma cadência não isola');
    const tarde = new Date(Date.now() + cadenciaMs + 60_000).toISOString();
    for (let i = 0; i < 2; i++) tique(vigiarArco(p.carregado, 'arco-g22', { ...opcoes(), quando: tarde }));
    assert.equal(lerSupervisao(p.dir, 'arco-g22').isolados.get('a')?.motivo, 'recusas-repetidas');
    assert.equal(registro.filter(x => x.endsWith(':falhou')).length, teto);
    // Outro arco: a vaga cheia passa, e o condutor espera a cadência (o vigia relê contas e vagas nela), não a pausa curta.
    abrirArco(p.dir, 'arco-g22b', { trabalhos: [AC[1]], contas: DUAS });
    gravarNaSupervisao(p.carregado, 'arco-g22b', [{ tipo: 'tique_iniciado', quem: instancia('vigia', 9) },
      { tipo: 'tique_concluido', quem: instancia('vigia', 9), resumo: 'SIMULADO' }]);
    const vaga: Falha = () => ({ sessionId: null, bloqueado: true, motivo: 'concurrency.limite', erro: 'a máquina está cheia (SIMULADO)' }) as unknown as ResultadoRun;
    const dormiu: number[] = [];
    const c = conduzirArco(p.carregado, 'arco-g22b', { ...opcoesSimuladas(p.dir, ITENS, [], {}, vaga as never), maxPassos: 1, dormir: (ms) => { dormiu.push(ms); } });
    assert.ok(c.acao === 'saiu' && c.ultimo?.acao === 'recusado' && c.ultimo.motivo === 'concurrency.limite', JSON.stringify(c));
    assert.deepEqual(dormiu, [lerSupervisao(p.dir, 'arco-g22b').parametros!.cadenciaMs]);
  } finally { p.limpar(); }
});

test('G23: o erro antes de lançar que a fila da N2 bloqueia depois de três seguidos é isolado pelo vigia uma cadência depois da primeira recusa', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g23');
  try {
    const h = abrirArco(p.dir, 'arco-g23', { trabalhos: [AC[0]], contas: DUAS });
    const { cadenciaMs } = parametrosDoArco(p.carregado, 'arco-g23');
    for (let i = 0; i < 3; i++) {
      const r = reservarDespacho(p.dir, { arco: 'arco-g23', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg',
        conta: 'perfil-a', revisao: false });
      concluirDespacho(p.dir, 'arco-g23', r.seq, { motivo: 'noctum.despacho.erro' });
    }
    const registro: string[] = [];
    const cedo = tique(vigiarArco(p.carregado, 'arco-g23', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.equal(cedo.isolados, 0, 'ainda dentro da cadência');
    const tarde = tique(vigiarArco(p.carregado, 'arco-g23', { ...opcoesSimuladas(p.dir, ITENS, registro),
      quando: new Date(Date.now() + cadenciaMs + 60_000).toISOString() }));
    assert.equal(tarde.isolados, 1);
    assert.equal(lerSupervisao(p.dir, 'arco-g23').isolados.get('a')?.motivo, 'erro-repetido');
    assert.equal(registro.length, 0, 'a fila da N2 já não despachava o trabalho');
  } finally { p.limpar(); }
});

test('G24: condutor e vigia gravam só a mudança da espera, com motivo tipado e ocupantes sem dados privados', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g24');
  try {
    abrirArco(p.dir, 'arco-g24a', { trabalhos: [AC[0]], maquina: 2, revisao: 1, contas: DUAS });
    vigiaPresente(p, 'arco-g24a');
    const runtime = runtimeSimulado(p.dir);
    const alheia = '00000000-0000-4000-8000-000000009024';
    runtime.registrar(alheia, 'perfil-a');
    const opcoes = opcoesSimuladas(p.dir, ITENS);
    const c = conduzirArco(p.carregado, 'arco-g24a', { ...opcoes, maxPassos: 2, dormir: () => undefined });
    assert.ok(c.acao === 'saiu' && c.ultimo?.acao === 'aguardar' && c.ultimo.motivo === 'capacidade.revisao', JSON.stringify(c));
    const esperas = eventosDaSupervisao(p.dir, 'arco-g24a').filter(x => x.evento.tipo === 'passo_em_espera');
    assert.equal(esperas.length, 1, 'a mesma razão em duas cadências é gravada uma vez');
    assert.deepEqual(esperas[0].evento, { tipo: 'passo_em_espera', papel: 'condutor', motivo: 'capacidade.revisao',
      ocupantes: [{ origem: 'runtime', runtime: 'claude-bg', revisao: false }] });
    assert.doesNotMatch(linhasDoLog(p.dir, 'arco-g24a').join('\n'), new RegExp(`${alheia}|perfil-a`),
      'a espera não grava id de sessão nem conta');

    runtime.estado(alheia, 'idle');
    const retomou = conduzirArco(p.carregado, 'arco-g24a', { ...opcoes, maxPassos: 1, dormir: () => undefined });
    assert.ok(retomou.acao === 'saiu' && retomou.ultimo?.acao === 'despachou', JSON.stringify(retomou));
    assert.equal(lerSupervisao(p.dir, 'arco-g24a').espera, null);
    assert.equal(eventosDaSupervisao(p.dir, 'arco-g24a').filter(x => x.evento.tipo === 'passo_retomado').length, 1);

    abrirArco(p.dir, 'arco-g24b', { trabalhos: [AC[1]], maquina: 2, revisao: 1, contas: DUAS });
    const v = tique(vigiarArco(p.carregado, 'arco-g24b', opcoes));
    assert.ok(v.passo?.acao === 'aguardar' && v.passo.motivo === 'capacidade.revisao', JSON.stringify(v.passo));
    const esperaDoVigia = eventosDaSupervisao(p.dir, 'arco-g24b').find(x => x.evento.tipo === 'passo_em_espera');
    assert.ok(esperaDoVigia?.evento.tipo === 'passo_em_espera');
    assert.equal(esperaDoVigia.evento.papel, 'vigia');
  } finally { p.limpar(); }
});

test('G25: a recusa do passo é gravada uma vez enquanto o motivo não muda, sem copiar detalhe privado', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g25');
  try {
    abrirArco(p.dir, 'arco-g25', { trabalhos: [AC[0]], contas: DUAS });
    vigiaPresente(p, 'arco-g25');
    const recusar = (motivo: 'noctum.origem.sem-prova' | 'noctum.efeito.sem-autorizacao', detalhe: string) =>
      opcoesSimuladas(p.dir, ITENS, [], { passo: { reservar: () => { throw new RecusaDoArco(motivo, detalhe); } } });
    const semProva = conduzirArco(p.carregado, 'arco-g25', {
      ...recusar('noctum.origem.sem-prova', 'detalhe-privado-SIMULADO'), maxPassos: 3, dormir: () => undefined,
    });
    assert.ok(semProva.acao === 'saiu' && semProva.ultimo?.acao === 'recusado', JSON.stringify(semProva));
    let recusas = eventosDaSupervisao(p.dir, 'arco-g25').filter(x => x.evento.tipo === 'passo_recusado');
    assert.equal(recusas.length, 1, 'três passos com o mesmo motivo deixam um marco');
    assert.deepEqual(lerSupervisao(p.dir, 'arco-g25').recusaDoPasso && {
      trabalho: lerSupervisao(p.dir, 'arco-g25').recusaDoPasso!.trabalho,
      motivo: lerSupervisao(p.dir, 'arco-g25').recusaDoPasso!.motivo,
    }, { trabalho: 'a', motivo: 'noctum.origem.sem-prova' });
    assert.doesNotMatch(linhasDoLog(p.dir, 'arco-g25').join('\n'), /detalhe-privado-SIMULADO/);

    conduzirArco(p.carregado, 'arco-g25', {
      ...recusar('noctum.efeito.sem-autorizacao', 'outro-detalhe-privado-SIMULADO'), maxPassos: 1, dormir: () => undefined,
    });
    recusas = eventosDaSupervisao(p.dir, 'arco-g25').filter(x => x.evento.tipo === 'passo_recusado');
    assert.equal(recusas.length, 2, 'um motivo novo deixa outro marco');
    assert.equal(lerSupervisao(p.dir, 'arco-g25').recusaDoPasso?.motivo, 'noctum.efeito.sem-autorizacao');
    assert.doesNotMatch(linhasDoLog(p.dir, 'arco-g25').join('\n'), /outro-detalhe-privado-SIMULADO/);
  } finally { p.limpar(); }
});

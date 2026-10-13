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
import { instancia, opcoesSimuladas, runtimeSimulado } from './noctum-supervisao-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, registrar } from '../src/ledger';
import { lerArco, reservarDespacho } from '../src/noctum-arco';
import { correlacaoDoArco, gravarNaSupervisao, lerSupervisao, parametrosDoArco, retomadasDe } from '../src/noctum-supervisao';
import { conduzirArco, passoConduzido, ResultadoDoTique, vigiarArco } from '../src/noctum-vigia';
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

test('G6: a sessão morta sem resultado é retomada no mesmo tique: sessao_morta no ledger, retomada autorizada e despacho pelo passo do arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-g6');
  try {
    abrirArco(p.dir, 'arco-g6', { trabalhos: [AC[0]], contas: DUAS });
    const registro: string[] = [];
    const r1 = tique(vigiarArco(p.carregado, 'arco-g6', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const thread = r1.passo.thread, sessao = String(r1.passo.sessionId);
    // A sessão morre sem resultado: o runtime a mostra em failed.
    runtimeSimulado(p.dir).estado(sessao, 'failed');
    const r2 = tique(vigiarArco(p.carregado, 'arco-g6', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.equal(r2.retomadas, 1);
    assert.ok(r2.passo?.acao === 'despachou' && r2.passo.trabalho === 'a' && r2.passo.fase === 'GOAL', JSON.stringify(r2.passo));
    const eventos = lerLedger(dirThread(p.dir, thread));
    assert.ok(eventos.some(e => e.tipo === 'sessao_morta' && e.sessionId === sessao && e.origem === 'noctum.vigia'), 'a morte provada vai ao ledger');
    const sup = lerSupervisao(p.dir, 'arco-g6');
    assert.deepEqual(sup.retomadas.map(x => `${x.trabalho}:${x.fase}:${x.tentativa}:${x.motivo}`), ['a:GOAL:1:sessao-morta']);
    const despachos = lerArco(p.dir, 'arco-g6')!.despachos;
    assert.deepEqual(despachos.map(d => `${d.trabalho}:${d.fase}:${d.desfecho}`), ['a:GOAL:concluido', 'a:GOAL:concluido'], 'a retomada tem reserva própria');
    assert.ok(despachos.every(d => ['perfil-a', 'perfil-b'].includes(d.conta)), 'só contas do envelope');
    // A retomada atendida não se repete no tique seguinte.
    const r3 = tique(vigiarArco(p.carregado, 'arco-g6', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.equal(r3.retomadas, 0);
  } finally { p.limpar(); }
});

test('G7: o limite semanal tira a conta até o reset e o despacho seguinte vai à outra conta; reset desconhecido e login perdido deixam a conta fora', { skip: semKernel }, () => {
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
    revogarArco(p.dir, 'arco-g8');
    const registro: string[] = [];
    const r = tique(vigiarArco(p.carregado, 'arco-g8', opcoesSimuladas(p.dir, ITENS, registro)));
    assert.deepEqual([r.situacao, r.condutor, r.passo, r.reservas], ['revogado', 'sem-passo', null, 1]);
    assert.deepEqual(lerArco(p.dir, 'arco-g8')!.despachos.map(d => d.desfecho), ['recusado'], 'a reserva sem lançamento voltou ao orçamento');
    assert.equal(lerFilaDeRetomada(p.dir).filter(x => x.id === pedido.id).at(-1)!.estado, 'cancelado');
    assert.equal(registro.length, 0);
    assert.equal(listarIds(p.dir).length, 1, 'nenhuma thread aberta depois da revogação');
  } finally { p.limpar(); }
});

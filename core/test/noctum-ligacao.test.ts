/**
 * RM-058, integração (T3 e T4 da ork-rm058integra, D7 e D8): o tique ligado à supervisão. O tique do arco chama o vigia da
 * N4 entre o fechamento e o relatório; a parada da supervisão fecha o arco pelo fechamento, com o motivo `supervisao`; e
 * os fatos da supervisão entram no relatório e no retrato. Os nomes começam por LG. Contas, sessões, despachos, provas e o
 * canal são SIMULADOS (o apoio da N4 e o da N6).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { abrirArco, autorizarPedido, pedidoV2, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { MAQUINA, opcoesSimuladas, parametrosDoTeste, runtimeSimulado } from './noctum-supervisao-apoio';
import { HORA } from './noctum-n6-apoio';
import { kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { partesLocais } from '../src/horario';
import { lerArco } from '../src/noctum-arco';
import { retratoDoArco, textoDoRetrato, tiqueDoArco, OpcoesDoTique } from '../src/noctum-modo';
import { fatosDoRelatorio, linhasDoRelatorio, vencimentoDoRelatorio } from '../src/noctum-relatorio';
import { dirDaSupervisao, gravarNaSupervisao, lerSupervisao } from '../src/noctum-supervisao';
import { ResultadoDoTique as TiqueDoVigia, ResultadoDoVigia } from '../src/noctum-vigia';
import { ResultadoRun } from '../src/phase';

prepararIngressoSimulado();
assert.ok(kernelDisponivel(), 'o tique do arco exige /usr/bin/flock');

const A: TrabalhoSimulado = { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA da ligação.' };
const C: TrabalhoSimulado = { id: 'c', item: 'RM-903', prioridade: 2, dependeDe: [], pedido: 'Fatia C SIMULADA da ligação.' };
const ITENS = ['RM-901', 'RM-902', 'RM-903'];
const DUAS = [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }];

/** As dependências do fechamento e do relatório no tique: a parada, a listagem, o git, as reservas e o canal, simulados. */
function simuladas(enviadas: string[] = []): OpcoesDoTique {
  return { maquina: MAQUINA, parar: () => ({ ok: true, detalhe: 'parada SIMULADA' }), listarSessoes: () => ({ lidas: true, vivas: new Set<string>() }),
    git: () => null, lerReservas: () => ({ leitura: 'copia-local', reservas: ITENS.map(item => ({ item, maquina: MAQUINA, thread: null })) }),
    enviar: (_c, texto) => { enviadas.push(texto); return { estado: 'confirmado', referencia: null }; } };
}

const doVigia = (v: ResultadoDoVigia | null): TiqueDoVigia => { assert.equal(v?.acao, 'tique', JSON.stringify(v)); return v as TiqueDoVigia; };

/** O despacho que o ambiente de quem despacha recusa (o MCP divergente): duas seguidas param o arco (G16 da N4). */
const conflito = (raiz: string, threadId: string) => {
  void raiz;
  return threadId.includes('rm901') ? { sessionId: null, bloqueado: true, motivo: 'runtime.unavailable',
    erro: 'runtime.context.conflict: MCP Orkastery divergente, outro node no PATH (SIMULADO)' } as unknown as ResultadoRun : null;
};

/** O arco com o C em voo (despachado e com a sessão de pé) e a supervisão parada por duas recusas de ambiente do A. */
function paradoPorAmbiente(p: ProjetoDeTeste, arco: string, registro: string[]): ReturnType<typeof tiqueDoArco> {
  abrirArco(p.dir, arco, { trabalhos: [{ ...C, prioridade: 1 }, { ...A, prioridade: 2 }], contas: DUAS });
  const tique = () => tiqueDoArco(p.carregado, arco, { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro, {}, conflito) });
  const primeiro = tique();
  assert.ok(primeiro.passo?.acao === 'despachou' && primeiro.passo.trabalho === 'c', JSON.stringify(primeiro.passo));
  assert.ok(tique().passo?.acao === 'recusado');
  return tique();
}

test('LG1: sem condutor, o tique chama o vigia entre o fechamento e o relatório, e o vigia assume e dá o passo do despacho', () => {
  const p = projetoTemporario('lg1');
  try {
    abrirArco(p.dir, 'arco-lg1', { trabalhos: [A], contas: DUAS });
    const registro: string[] = [];
    const r = tiqueDoArco(p.carregado, 'arco-lg1', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    assert.deepEqual(r.falhas, []);
    assert.equal(doVigia(r.vigia).condutor, 'assumido');
    assert.ok(r.passo?.acao === 'despachou' && r.passo.trabalho === 'a' && r.passo.fase === 'GOAL', JSON.stringify(r.passo));
    assert.equal(registro.length, 1);
    assert.equal(lerSupervisao(p.dir, 'arco-lg1').geracao?.quem.papel, 'vigia');
    assert.equal(r.relatorio.acao, 'aguardar', 'o relatório sai depois do vigia, no mesmo tique');
  } finally { p.limpar(); }
});

test('LG2: com o condutor vivo (a trava presa), o tique não dá passo, e o vigia diz que o condutor segura a trava', () => {
  const p = projetoTemporario('lg2');
  try {
    abrirArco(p.dir, 'arco-lg2', { trabalhos: [A], contas: DUAS });
    const fd = tentarTravaExclusiva(path.join(dirDaSupervisao(p.dir, 'arco-lg2'), 'condutor.lock'));
    assert.ok(fd !== null);
    try {
      const registro: string[] = [];
      const r = tiqueDoArco(p.carregado, 'arco-lg2', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
      const v = doVigia(r.vigia);
      assert.deepEqual([v.condutor, v.passo, r.passo, registro.length], ['vivo', null, null, 0]);
      assert.ok(v.lacunas.some(l => /o condutor segura a trava sem batida desde nunca: vivo, sem prova de ausência/.test(l)), JSON.stringify(v.lacunas));
    } finally { fs.closeSync(fd!); }
  } finally { p.limpar(); }
});

test('LG3: a sessão morta é reconciliada pelo vigia no tique, a retomada é autorizada e o passo seguinte a despacha', () => {
  const p = projetoTemporario('lg3');
  try {
    abrirArco(p.dir, 'arco-lg3', { trabalhos: [A], contas: DUAS });
    const carencia = parametrosDoTeste(p.carregado, 'arco-lg3', { carenciaMs: 2 * 60_000 }).carenciaMs;
    const registro: string[] = [];
    const r1 = tiqueDoArco(p.carregado, 'arco-lg3', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const sessao = String(r1.passo.sessionId);
    runtimeSimulado(p.dir).estado(sessao, 'failed');
    const tarde = new Date(Date.now() + carencia + 60_000).toISOString();
    const r2 = tiqueDoArco(p.carregado, 'arco-lg3', { ...simuladas(), quando: tarde, opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    assert.equal(doVigia(r2.vigia).retomadas, 1);
    assert.ok(r2.passo?.acao === 'despachou' && r2.passo.trabalho === 'a' && r2.passo.fase === 'GOAL', JSON.stringify(r2.passo));
    assert.deepEqual(lerSupervisao(p.dir, 'arco-lg3').retomadas.map(x => `${x.trabalho}:${x.fase}:${x.motivo}`), ['a:GOAL:sessao-morta']);
    assert.equal(registro.length, 2);
  } finally { p.limpar(); }
});

test('LG4: duas recusas de ambiente param a supervisão, e o mesmo tique fecha o arco com supervisao, o retrato e o pedido de parada', () => {
  const p = projetoTemporario('lg4');
  try {
    const registro: string[] = [];
    const r = paradoPorAmbiente(p, 'arco-lg4', registro);
    assert.equal(doVigia(r.vigia).parada, 'ambiente-do-despacho');
    assert.deepEqual([r.fechamento.fechado, r.fechamento.agora, r.fechamento.motivo], [true, true, 'supervisao']);
    assert.match(r.fechamento.detalhe, /^a supervisão parou o arco \(ambiente-do-despacho\): /);
    assert.equal(r.fechamento.retrato?.motivo, 'supervisao');
    assert.deepEqual(r.fechamento.paradas.map(x => [x.trabalho, x.resultado]), [['c', 'pedida']], 'a sessão do C em voo recebe o pedido de parada');
    assert.equal(lerArco(p.dir, 'arco-lg4')?.encerramento?.motivo, 'supervisao');
    assert.deepEqual(r.falhas, []);
  } finally { p.limpar(); }
});

test('LG5: no arco fechado pela supervisão, o tique segue reconciliando, mas nenhum passo sai depois', () => {
  const p = projetoTemporario('lg5');
  try {
    const registro: string[] = [];
    paradoPorAmbiente(p, 'arco-lg5', registro);
    const antes = registro.length;
    const depois = tiqueDoArco(p.carregado, 'arco-lg5', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro, {}, conflito) });
    assert.deepEqual([depois.fechamento.fechado, depois.fechamento.agora, depois.fechamento.motivo], [true, false, 'supervisao']);
    assert.equal(doVigia(depois.vigia).condutor, 'sem-passo');
    assert.equal(depois.passo, null);
    assert.equal(registro.length, antes, 'nada mais é tentado');
  } finally { p.limpar(); }
});

/** A supervisão com um isolado, uma conta fora, uma retomada e uma sessão parada, gravada como o vigia grava. */
function supervisaoComFatos(p: ProjetoDeTeste, arco: string): void {
  gravarNaSupervisao(p.carregado, arco, [
    { tipo: 'isolado', trabalho: 'a', thread: null, motivo: 'retomadas-esgotadas', detalhe: 'três retomadas sem avanço (SIMULADO)' },
    { tipo: 'conta_fora', conta: 'perfil-a', runtime: 'claude-bg', motivo: 'auth', ate: null, prova: 'login perdido (SIMULADO)' },
    { tipo: 'retomada_autorizada', trabalho: 'c', thread: 'ork-simulada-c', fase: 'GO', tentativa: 1, motivo: 'sessao-morta', sessao: null,
      prova: 'SIMULADO', aposReserva: 0 },
    { tipo: 'sessao_parada', trabalho: 'c', thread: 'ork-simulada-c', sessionId: '00000000-0000-4000-8000-000000000777', motivo: 'sem-avanco',
      confirmada: true, prova: 'SIMULADO' },
  ]);
}

test('LG6: o relatório traz os fatos da supervisão lidos do log do arco, sem a lacuna fixa de antes da integração', () => {
  const p = projetoTemporario('lg6');
  try {
    abrirArco(p.dir, 'arco-lg6', { trabalhos: [A, C], contas: DUAS });
    supervisaoComFatos(p, 'arco-lg6');
    const f = fatosDoRelatorio(p.carregado, 'arco-lg6', { ...simuladas() })!;
    const texto = linhasDoRelatorio(f, 1).join('\n');
    assert.doesNotMatch(texto, /o tique ainda não chama o vigia|a supervisão do arco não se lê/);
    assert.match(texto, /• a \(RM-901\): isolado pela supervisão \(retomadas-esgotadas: três retomadas sem avanço \(SIMULADO\)\)/);
    assert.match(texto, /• a conta perfil-a saiu do arco: login perdido/);
    assert.match(texto, /• retomada autorizada pela supervisão: c \(thread ork-simulada-c\): retomada 1 na fase GO \(sessao-morta\)/);
    assert.match(texto, /• pela supervisão, sessão 00000000-0000-4000-8000-000000000777 \(c\): parada confirmada \(sem-avanco\)/);
  } finally { p.limpar(); }
});

test('LG7: o retrato do arco traz os mesmos fatos da supervisão, no texto e no JSON', () => {
  const p = projetoTemporario('lg7');
  try {
    abrirArco(p.dir, 'arco-lg7', { trabalhos: [A, C], contas: DUAS });
    supervisaoComFatos(p, 'arco-lg7');
    gravarNaSupervisao(p.carregado, 'arco-lg7', [{ tipo: 'parada', motivo: 'teto-do-arco', detalhe: 'o teto SIMULADO do arco chegou' }]);
    const r = retratoDoArco(p.carregado, 'arco-lg7', { ...simuladas() })!;
    assert.equal(r.supervisao?.parada, 'teto-do-arco: o teto SIMULADO do arco chegou');
    assert.deepEqual(r.supervisao?.isolados.map(i => i.trabalho), ['a']);
    assert.deepEqual(r.supervisao?.contasFora.map(c => [c.conta, c.motivo]), [['perfil-a', 'login perdido']]);
    const texto = textoDoRetrato(r);
    assert.match(texto, /Supervisão:\n  • parada: teto-do-arco: o teto SIMULADO do arco chegou\n  • isolado a: retomadas-esgotadas/);
    assert.match(texto, /  • retomada autorizada: c \(thread ork-simulada-c\): retomada 1 na fase GO \(sessao-morta\)/);
  } finally { p.limpar(); }
});

test('LG8: o log da supervisão que não se lê vira falha do vigia no tique, e o relatório da manhã sai com a lacuna', () => {
  const p = projetoTemporario('lg8');
  try {
    const daqui8h = partesLocais(Date.now() + 8 * HORA, 'America/Sao_Paulo');
    autorizarPedido(p.dir, 'arco-lg8', { ...pedidoV2('arco-lg8', { trabalhos: [A], contas: DUAS }),
      relatorio: { horario: `${daqui8h.hora}:${daqui8h.minuto}`, canal: 'telegram' } });
    supervisaoComFatos(p, 'arco-lg8');
    fs.chmodSync(path.join(dirDaSupervisao(p.dir, 'arco-lg8'), 'supervisao.jsonl'), 0o644);
    const enviadas: string[] = [];
    const conteudo = lerArco(p.dir, 'arco-lg8')!.conteudo!;
    const registro: string[] = [];
    const r = tiqueDoArco(p.carregado, 'arco-lg8', { ...simuladas(enviadas), quando: vencimentoDoRelatorio(conteudo),
      opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    assert.deepEqual(r.falhas.map(f => [f.etapa, f.motivo]), [['vigia', 'noctum.supervisao.adulterada']]);
    assert.equal(r.vigia, null);
    assert.deepEqual([r.relatorio.acao, enviadas.length], ['entregue', 1]);
    assert.match(enviadas[0], /Não lido: .*a supervisão do arco não se lê \(noctum\.supervisao\.adulterada\)/);
  } finally { p.limpar(); }
});

test('LG9: no arco terminal, o vigia roda até o relatório sair; depois, sem reserva pendente, o tique não o chama mais', () => {
  const p = projetoTemporario('lg9');
  try {
    const daqui8h = partesLocais(Date.now() + 8 * HORA, 'America/Sao_Paulo');
    autorizarPedido(p.dir, 'arco-lg9', { ...pedidoV2('arco-lg9', { trabalhos: [A], contas: DUAS }),
      relatorio: { horario: `${daqui8h.hora}:${daqui8h.minuto}`, canal: 'telegram' } });
    revogarArco(p.dir, 'arco-lg9');
    const conteudo = lerArco(p.dir, 'arco-lg9')!.conteudo!;
    let chamadas = 0;
    const vigia = (): ResultadoDoVigia => { chamadas += 1; return { acao: 'sem-arco', detalhe: 'vigia SIMULADO' }; };
    const vencimento = vencimentoDoRelatorio(conteudo);
    const r1 = tiqueDoArco(p.carregado, 'arco-lg9', { ...simuladas(), quando: vencimento, vigia });
    assert.deepEqual([chamadas, r1.relatorio.acao, r1.fechamento.motivo], [1, 'entregue', 'revogado']);
    const r2 = tiqueDoArco(p.carregado, 'arco-lg9', { ...simuladas(), quando: new Date(Date.parse(vencimento) + 5 * 60_000).toISOString(), vigia });
    assert.deepEqual([chamadas, r2.vigia], [1, null], 'terminal, sem reserva pendente e entregue: o log da supervisão não cresce');
  } finally { p.limpar(); }
});

test('LG10: antes da janela (arco agendado), o tique não chama o vigia: nada está em voo', () => {
  const p = projetoTemporario('lg10');
  try {
    abrirArco(p.dir, 'arco-lg10', { trabalhos: [A], contas: DUAS, deslocamentoH: 2 });
    assert.equal(lerArco(p.dir, 'arco-lg10')?.situacao, 'agendado');
    let chamadas = 0;
    const r = tiqueDoArco(p.carregado, 'arco-lg10', { ...simuladas(), vigia: () => { chamadas += 1; return { acao: 'sem-arco', detalhe: '' }; } });
    assert.deepEqual([chamadas, r.vigia, r.passo, r.falhas], [0, null, null, []]);
  } finally { p.limpar(); }
});

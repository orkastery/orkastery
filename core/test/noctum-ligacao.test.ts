/**
 * RM-058, integração (T3 e T4 da ork-rm058integra, D7 e D8): o tique ligado à supervisão. O tique do arco chama o vigia da
 * N4 entre o fechamento e o relatório; a parada da supervisão fecha o arco pelo fechamento, com o motivo `supervisao`; e
 * os fatos da supervisão entram no relatório e no retrato. O passo supervisionado chama a entrega da N5 depois do
 * despacho, na mesma geração; no tique, o verify fica para o condutor, e a fila vazia espera o MASTER por omissão que a
 * entrega do arco deve. Os nomes começam por LG. Contas, sessões, despachos, entregas, provas e o canal são SIMULADOS (o
 * apoio da N4 e o da N6).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { abrirArco, autorizarPedido, pedidoV2, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { instancia, MAQUINA, opcoesSimuladas, parametrosDoTeste, runtimeSimulado } from './noctum-supervisao-apoio';
import { HORA } from './noctum-n6-apoio';
import { ErroDoCatalogo } from '../src/locale';
import { ErroDaFilaPesada, kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { partesLocais } from '../src/horario';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { lerArco } from '../src/noctum-arco';
import { OpcoesDaEntrega, ResultadoDaEntrega } from '../src/noctum-entrega';
import { fecharSeDevido } from '../src/noctum-fechamento';
import { retratoDoArco, textoDoRetrato, tiqueDoArco, OpcoesDoTique } from '../src/noctum-modo';
import { fatosDoRelatorio, linhasDoRelatorio, vencimentoDoRelatorio } from '../src/noctum-relatorio';
import { dirDaSupervisao, gravarNaSupervisao, lerSupervisao } from '../src/noctum-supervisao';
import { conduzirArco, OpcoesDoVigia, passoConduzido, ResultadoDoTique as TiqueDoVigia, ResultadoDoVigia } from '../src/noctum-vigia';
import { ResultadoRun } from '../src/phase';
import { dirThread, lerThread, novaThread } from '../src/thread';

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

/**
 * O arco aberto com o relatório 8 h adiante: nenhum tique do teste o entrega, em hora nenhuma do dia (o do apoio vence às
 * 07:30, e a janela de teste começa uma hora antes de agora).
 */
function abrirSemRelatorio(p: ProjetoDeTeste, arco: string, o: Parameters<typeof abrirArco>[2]): Record<string, unknown> {
  const daqui8h = partesLocais(Date.now() + 8 * HORA, 'America/Sao_Paulo');
  const pedido = { ...pedidoV2(arco, o), relatorio: { horario: `${daqui8h.hora}:${daqui8h.minuto}`, canal: 'telegram' } };
  autorizarPedido(p.dir, arco, pedido);
  return pedido;
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
  abrirSemRelatorio(p, arco, { trabalhos: [{ ...C, prioridade: 1 }, { ...A, prioridade: 2 }], contas: DUAS });
  const tique = () => tiqueDoArco(p.carregado, arco, { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro, {}, conflito) });
  const primeiro = tique();
  assert.ok(primeiro.passo?.acao === 'despachou' && primeiro.passo.trabalho === 'c', JSON.stringify(primeiro.passo));
  assert.ok(tique().passo?.acao === 'recusado');
  return tique();
}

test('LG1: sem condutor, o tique chama o vigia entre o fechamento e o relatório, e o vigia assume e dá o passo do despacho', () => {
  const p = projetoTemporario('lg1');
  try {
    abrirSemRelatorio(p, 'arco-lg1', { trabalhos: [A], contas: DUAS });
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
    abrirSemRelatorio(p, 'arco-lg2', { trabalhos: [A], contas: DUAS });
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
    abrirSemRelatorio(p, 'arco-lg3', { trabalhos: [A], contas: DUAS });
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
    abrirSemRelatorio(p, 'arco-lg6', { trabalhos: [A, C], contas: DUAS });
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
    abrirSemRelatorio(p, 'arco-lg7', { trabalhos: [A, C], contas: DUAS });
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
    abrirSemRelatorio(p, 'arco-lg10', { trabalhos: [A], contas: DUAS, deslocamentoH: 2 });
    assert.equal(lerArco(p.dir, 'arco-lg10')?.situacao, 'agendado');
    let chamadas = 0;
    const r = tiqueDoArco(p.carregado, 'arco-lg10', { ...simuladas(), vigia: () => { chamadas += 1; return { acao: 'sem-arco', detalhe: '' }; } });
    assert.deepEqual([chamadas, r.vigia, r.passo, r.falhas], [0, null, null, []]);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// T4 (D8): a entrega no passo supervisionado.
// ---------------------------------------------------------------------------

type Entregar = NonNullable<OpcoesDoVigia['entregar']>;
const NADA: ResultadoDaEntrega = { acao: 'nada', motivo: 'sem-entrega', detalhe: 'entrega SIMULADA sem trabalho' };

/** O vigia presente: um tique concluído agora, como o do cron (sem ele, o condutor não despacha nada novo). */
function vigiaPresente(p: ProjetoDeTeste, arco: string): void {
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'tique_iniciado', quem: instancia('vigia', 9) },
    { tipo: 'tique_concluido', quem: instancia('vigia', 9), resumo: 'SIMULADO' }]);
}

/** O `ship_done` que a entrega do arco grava, com o arco na evidência; SIMULADO, sem push nem merge de verdade. */
function entreguePeloArco(p: ProjetoDeTeste, thread: string, arco: string): void {
  registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { pushVerificado: true, tipoDeAutorizacao: 'noctum',
    autorizadoPor: `envelope do arco ${arco} (#Noctum)`, evidencia: { arco }, simulado: true });
}

/** O primeiro tique do arco com o A: despacha o GOAL e devolve a thread e a sessão abertas. */
function despachado(p: ProjetoDeTeste, arco: string, registro: string[]): { thread: string; sessionId: string } {
  const r = tiqueDoArco(p.carregado, arco, { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
  assert.ok(r.passo?.acao === 'despachou' && r.passo.trabalho === 'a', JSON.stringify(r.passo));
  return { thread: r.passo.thread, sessionId: String(r.passo.sessionId) };
}

test('LG11: o condutor chama a entrega depois do despacho, na mesma geração, com a espera e o verify de produção', () => {
  const p = projetoTemporario('lg11');
  try {
    abrirSemRelatorio(p, 'arco-lg11', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-lg11');
    const registro: string[] = [];
    const vistas: Array<{ despachos: number; geracao: string | undefined; esperarMs: number | undefined; verificar: boolean }> = [];
    const entregar: Entregar = (k, arco, o) => {
      vistas.push({ despachos: lerArco(k.raiz, arco)!.despachos.length, geracao: lerSupervisao(k.raiz, arco).geracao?.quem.instancia,
        esperarMs: o.esperarMs, verificar: !!o.verificar });
      return NADA;
    };
    const c = conduzirArco(p.carregado, 'arco-lg11', { ...opcoesSimuladas(p.dir, ITENS, registro, { entregar }), instancia: 'condutor-lg11',
      maxPassos: 1, dormir: () => undefined });
    assert.ok(c.acao === 'saiu' && c.ultimo?.acao === 'despachou' && c.ultimo.entrega?.acao === 'nada', JSON.stringify(c));
    assert.equal(registro.length, 1);
    assert.deepEqual(vistas, [{ despachos: 1, geracao: 'condutor-lg11', esperarMs: undefined, verificar: false }],
      'a entrega vem depois do despacho gravado e na geração do condutor, que espera a fila pesada e roda o verify');
  } finally { p.limpar(); }
});

test('LG12: o condutor dorme até o menor ate do despacho e da entrega, nunca além da cadência; a entrega com efeito o traz já', () => {
  const p = projetoTemporario('lg12');
  try {
    abrirSemRelatorio(p, 'arco-lg12', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-lg12');
    const registro: string[] = [];
    const t0 = new Date().toISOString();
    const em = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
    const com = (entrega: ResultadoDaEntrega) => {
      const dormiu: number[] = [];
      const c = conduzirArco(p.carregado, 'arco-lg12', { ...opcoesSimuladas(p.dir, ITENS, registro, { entregar: () => entrega }), maxPassos: 1,
        relogio: () => t0, dormir: (ms) => { dormiu.push(ms); } });
      assert.ok(c.acao === 'saiu' && c.ultimo, JSON.stringify(c));
      return { ultimo: c.ultimo, dormiu };
    };
    assert.equal(com(NADA).ultimo.acao, 'despachou');
    const cadencia = lerSupervisao(p.dir, 'arco-lg12').parametros!.cadenciaMs;
    const espera = (ms: number): ResultadoDaEntrega =>
      ({ acao: 'aguardar', trabalho: 'a', thread: null, motivo: 'noctum.entrega.ci-pendente', detalhe: 'CI SIMULADO', ate: em(ms) });
    // Com o A em curso, o despacho aguarda a cadência da fila; a entrega que espera menos adianta o laço.
    const semEntrega = com(NADA);
    assert.ok(semEntrega.ultimo.acao === 'aguardar', JSON.stringify(semEntrega.ultimo));
    const doDespacho = Math.min(Date.parse(semEntrega.ultimo.ate) - Date.parse(t0), cadencia);
    assert.ok(doDespacho > 2 * 60_000, `a espera do despacho (${doDespacho} ms) passa de 2 min`);
    assert.deepEqual(semEntrega.dormiu, [doDespacho]);
    assert.deepEqual(com(espera(2 * 60_000)).dormiu, [2 * 60_000], 'a entrega que espera menos adianta o laço');
    assert.deepEqual(com(espera(5 * HORA)).dormiu, [doDespacho], 'a que espera mais não atrasa o despacho, e nada passa da cadência');
    assert.deepEqual(com({ acao: 'master', trabalho: 'a', thread: 'ork-simulada', indice: 5 }).dormiu, [0], 'a entrega com efeito volta já');
    assert.equal(registro.length, 1, 'um despacho só: o A segue em curso');
  } finally { p.limpar(); }
});

test('LG13: a geração que outro toma entre o despacho e a entrega não entrega; a parada entre os dois também não, e depois nada sai', () => {
  const geracaoTomada = projetoTemporario('lg13');
  try {
    abrirSemRelatorio(geracaoTomada, 'arco-lg13', { trabalhos: [A], contas: DUAS });
    vigiaPresente(geracaoTomada, 'arco-lg13');
    const condutor = instancia('condutor', 13);
    gravarNaSupervisao(geracaoTomada.carregado, 'arco-lg13', [{ tipo: 'conducao_assumida', geracao: 1, quem: condutor, prova: 'SIMULADO' }]);
    let entregas = 0;
    const entregar: Entregar = () => { entregas += 1; return NADA; };
    // O despacho simulado deixa outro condutor tomar a geração enquanto a sessão abre.
    const toma = () => {
      gravarNaSupervisao(geracaoTomada.carregado, 'arco-lg13', [{ tipo: 'conducao_assumida', geracao: 2, quem: instancia('condutor', 14), prova: 'SIMULADO' }]);
      return null;
    };
    const registro: string[] = [];
    const r = passoConduzido(geracaoTomada.carregado, 'arco-lg13', condutor, opcoesSimuladas(geracaoTomada.dir, ITENS, registro, { entregar }, toma));
    assert.ok(r.acao === 'despachou' && r.entrega === undefined, JSON.stringify(r));
    assert.deepEqual([entregas, registro.length], [0, 1]);
  } finally { geracaoTomada.limpar(); }
  const parado = projetoTemporario('lg13p');
  try {
    abrirSemRelatorio(parado, 'arco-lg13p', { trabalhos: [A, C], contas: DUAS });
    vigiaPresente(parado, 'arco-lg13p');
    const condutor = instancia('condutor', 15);
    gravarNaSupervisao(parado.carregado, 'arco-lg13p', [{ tipo: 'conducao_assumida', geracao: 1, quem: condutor, prova: 'SIMULADO' }]);
    let entregas = 0;
    const entregar: Entregar = () => { entregas += 1; return NADA; };
    const para = () => {
      gravarNaSupervisao(parado.carregado, 'arco-lg13p', [{ tipo: 'parada', motivo: 'teto-do-arco', detalhe: 'o teto SIMULADO chegou no meio do passo' }]);
      return null;
    };
    const registro: string[] = [];
    const r = passoConduzido(parado.carregado, 'arco-lg13p', condutor, opcoesSimuladas(parado.dir, ITENS, registro, { entregar }, para));
    assert.ok(r.acao === 'despachou' && r.entrega === undefined, JSON.stringify(r));
    const depois = passoConduzido(parado.carregado, 'arco-lg13p', condutor, opcoesSimuladas(parado.dir, ITENS, registro, { entregar }));
    assert.ok(depois.acao === 'parado' && depois.motivo === 'teto-do-arco' && depois.entrega === undefined, JSON.stringify(depois));
    assert.deepEqual([entregas, registro.length], [0, 1], 'com a parada, nem despacho nem entrega');
  } finally { parado.limpar(); }
});

test('LG14: sem condutor, o tique faz o MASTER por omissão da entrega do arco, e só então a fila vazia fecha, no mesmo tique', () => {
  const p = projetoTemporario('lg14');
  try {
    abrirSemRelatorio(p, 'arco-lg14', { trabalhos: [A], contas: DUAS });
    const registro: string[] = [];
    const { thread, sessionId } = despachado(p, 'arco-lg14', registro);
    runtimeSimulado(p.dir).estado(sessionId, 'completed');
    entreguePeloArco(p, thread, 'arco-lg14');
    const antes = fecharSeDevido(p.carregado, 'arco-lg14', simuladas());
    assert.deepEqual([antes.fechado, antes.agora], [false, false], JSON.stringify(antes));
    assert.equal(antes.detalhe, `o arco segue: a fila está vazia, mas a entrega do arco ainda faz o MASTER por omissão de ${thread}`);
    const r = tiqueDoArco(p.carregado, 'arco-lg14', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    assert.deepEqual(r.falhas, []);
    const passo = doVigia(r.vigia).passo;
    assert.ok(passo?.acao === 'encerrar' && passo.entrega?.acao === 'master' && passo.entrega.thread === thread, JSON.stringify(passo));
    assert.equal(lerThread(p.dir, thread).status, 'fechada');
    assert.equal(lerLedger(dirThread(p.dir, thread)).filter(e => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao).length, 1);
    assert.deepEqual([r.fechamento.fechado, r.fechamento.agora, r.fechamento.motivo], [true, true, 'fila-vazia']);
    assert.equal(registro.length, 1, 'nada novo despachado');
  } finally { p.limpar(); }
});

test('LG15: no tique, a entrega não espera a fila pesada nem a trava, e o verify fica para o condutor com o motivo da baseline', () => {
  const p = projetoTemporario('lg15');
  try {
    abrirSemRelatorio(p, 'arco-lg15', { trabalhos: [A], contas: DUAS });
    const vistas: OpcoesDaEntrega[] = [];
    let recusa: unknown = null;
    const entregar: Entregar = (k, _arco, o) => {
      vistas.push(o);
      try { o.verificar!(k, 'ork-simulada-a', { canal: 'cli', correlacao: 'SIMULADO', filaPesada: {} } as never); } catch (e) { recusa = e; }
      return NADA;
    };
    const registro: string[] = [];
    const r = tiqueDoArco(p.carregado, 'arco-lg15', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro, { entregar }) });
    assert.deepEqual(r.falhas, []);
    assert.ok(r.passo?.acao === 'despachou', JSON.stringify(r.passo));
    assert.equal(vistas.length, 1);
    assert.equal(vistas[0].esperarMs, 0, 'nem a fila pesada nem a trava de despacho esperam no tique');
    assert.ok(recusa instanceof ErroDaFilaPesada, String(recusa));
    assert.equal(recusa.recusa.motivo, 'fila-pesada.ocupada');
    assert.match(recusa.message, /o vigia não roda o verify da thread ork-simulada-a dentro do tique: ele fica para o condutor do arco/);
  } finally { p.limpar(); }
});

test('LG16: a exceção da entrega vira lacuna do tique, e o tique conclui; no condutor, ela volta no passo, e o laço segue', () => {
  const p = projetoTemporario('lg16');
  try {
    abrirSemRelatorio(p, 'arco-lg16', { trabalhos: [A], contas: DUAS });
    const registro: string[] = [];
    const entregar: Entregar = () => { throw new Error('a forja SIMULADA caiu no meio da leitura\nsegunda linha que não vai'); };
    const r = tiqueDoArco(p.carregado, 'arco-lg16', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro, { entregar }) });
    assert.deepEqual(r.falhas, []);
    const v = doVigia(r.vigia);
    assert.ok(v.lacunas.includes('a entrega lançou: a forja SIMULADA caiu no meio da leitura'), JSON.stringify(v.lacunas));
    assert.ok(r.passo?.acao === 'despachou', 'o despacho do mesmo passo fica');
    assert.equal(r.relatorio.acao, 'aguardar', 'o relatório roda depois, no mesmo tique');
    const dormiu: number[] = [];
    const c = conduzirArco(p.carregado, 'arco-lg16', { ...opcoesSimuladas(p.dir, ITENS, registro, { entregar }), maxPassos: 2,
      dormir: (ms) => { dormiu.push(ms); } });
    assert.ok(c.acao === 'saiu' && c.passos === 2 && c.ultimo?.falhaDaEntrega === 'a forja SIMULADA caiu no meio da leitura'
      && c.ultimo.entrega === null, JSON.stringify(c));
    assert.equal(dormiu.length, 2, 'a exceção não derruba o laço do condutor');
  } finally { p.limpar(); }
});

test('LG17: a fila vazia não espera o MASTER de uma entrega feita por fora do arco, e a hora não espera nenhum', () => {
  const deFora = projetoTemporario('lg17');
  try {
    abrirSemRelatorio(deFora, 'arco-lg17', { trabalhos: [A], contas: DUAS });
    const { thread } = despachado(deFora, 'arco-lg17', []);
    registrar(dirThread(deFora.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { origem: 'pr', pr: 1, simulado: true });
    const r = fecharSeDevido(deFora.carregado, 'arco-lg17', simuladas());
    assert.deepEqual([r.fechado, r.agora, r.motivo], [true, true, 'fila-vazia'], JSON.stringify(r));
    assert.equal(lerLedger(dirThread(deFora.dir, thread)).some(e => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao), false,
      'o MASTER da entrega de fora segue o caminho da fábrica');
  } finally { deFora.limpar(); }
  const tarde = projetoTemporario('lg17h');
  try {
    abrirSemRelatorio(tarde, 'arco-lg17h', { trabalhos: [A], contas: DUAS });
    const { thread } = despachado(tarde, 'arco-lg17h', []);
    entreguePeloArco(tarde, thread, 'arco-lg17h');
    const fim = lerArco(tarde.dir, 'arco-lg17h')!.conteudo!.janela.fim;
    const r = fecharSeDevido(tarde.carregado, 'arco-lg17h', { ...simuladas(), quando: new Date(Date.parse(fim) + 60_000).toISOString() });
    assert.deepEqual([r.fechado, r.agora, r.motivo], [true, true, 'hora'], JSON.stringify(r));
  } finally { tarde.limpar(); }
});

test('LG18: com a fila vazia, o condutor segue enquanto a entrega faz efeito e sai quando ela não tem mais nada', () => {
  const p = projetoTemporario('lg18');
  try {
    abrirSemRelatorio(p, 'arco-lg18', { trabalhos: [A], contas: DUAS });
    const registro: string[] = [];
    const { thread } = despachado(p, 'arco-lg18', registro);
    entreguePeloArco(p, thread, 'arco-lg18');
    const respostas: ResultadoDaEntrega[] = [{ acao: 'master', trabalho: 'a', thread, indice: 5 }, NADA];
    let chamadas = 0;
    const dormiu: number[] = [];
    const c = conduzirArco(p.carregado, 'arco-lg18', { ...opcoesSimuladas(p.dir, ITENS, registro, { entregar: () => respostas[chamadas++] ?? NADA }),
      maxPassos: 5, dormir: (ms) => { dormiu.push(ms); } });
    assert.ok(c.acao === 'saiu' && c.passos === 2 && c.ultimo?.acao === 'encerrar' && c.ultimo.entrega?.acao === 'nada', JSON.stringify(c));
    assert.deepEqual([chamadas, dormiu], [2, [0]], 'depois do efeito, o passo seguinte vem já; sem efeito, o condutor sai');
    assert.equal(registro.length, 1);
  } finally { p.limpar(); }
});

test('LG19: a parada pelo teto do arco não fecha por cima da sessão admitida: ela termina, e o arco fecha por custo, sem parar nada', () => {
  const p = projetoTemporario('lg19');
  try {
    abrirSemRelatorio(p, 'arco-lg19', { trabalhos: [A, C], contas: DUAS, tetoDoArco: 1 });
    const registro: string[] = [];
    const tique = () => tiqueDoArco(p.carregado, 'arco-lg19', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    const r1 = tique();
    assert.ok(r1.passo?.acao === 'despachou' && r1.passo.trabalho === 'a', JSON.stringify(r1.passo));
    const sessao = String(r1.passo.sessionId), thread = r1.passo.thread;
    const r2 = tique();
    assert.equal(lerSupervisao(p.dir, 'arco-lg19').parada?.motivo, 'teto-do-arco');
    assert.deepEqual([r2.fechamento.fechado, r2.fechamento.paradas.length], [false, 0], JSON.stringify(r2.fechamento));
    assert.equal(lerArco(p.dir, 'arco-lg19')?.encerramento ?? null, null, 'o arco segue aberto com a sessão admitida em voo');
    assert.equal(registro.length, 1, 'nada novo despachado depois do teto');
    // A sessão admitida termina: o arco fecha pelo custo, sem pedir parada a ninguém.
    runtimeSimulado(p.dir).estado(sessao, 'completed');
    registrar(dirThread(p.dir, thread), thread, 'phase_result', { fase: 'GOAL', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    const r3 = tique();
    assert.deepEqual([r3.fechamento.fechado, r3.fechamento.motivo, r3.fechamento.paradas.length], [true, 'custo', 0], JSON.stringify(r3.fechamento));
  } finally { p.limpar(); }
});

test('LG20: no arco terminal cujo relatório não sai (sem transporte), o vigia roda até a janela de entrega de 24 h acabar, e depois não', () => {
  const p = projetoTemporario('lg20');
  try {
    abrirSemRelatorio(p, 'arco-lg20', { trabalhos: [A], contas: DUAS });
    revogarArco(p.dir, 'arco-lg20');
    const vencimento = vencimentoDoRelatorio(lerArco(p.dir, 'arco-lg20')!.conteudo!);
    let chamadas = 0;
    const vigia = (): ResultadoDoVigia => { chamadas += 1; return { acao: 'sem-arco', detalhe: 'vigia SIMULADO' }; };
    // Sem o enviar simulado e sem transporte configurado: o relatório nunca tem recibo.
    const tique = (quando: string) => tiqueDoArco(p.carregado, 'arco-lg20', { ...simuladas(), enviar: undefined, quando, vigia });
    const r1 = tique(vencimento);
    assert.deepEqual([chamadas, r1.relatorio.acao === 'entregue'], [1, false]);
    tique(new Date(Date.parse(vencimento) + 23 * HORA).toISOString());
    assert.equal(chamadas, 2, 'dentro da janela de entrega, o vigia segue');
    const r3 = tique(new Date(Date.parse(vencimento) + 24 * HORA + 5 * 60_000).toISOString());
    assert.deepEqual([chamadas, r3.vigia], [2, null], 'acabada a janela, o arco fica quieto e o log da supervisão não cresce');
  } finally { p.limpar(); }
});

test('LG21: o condutor que acabou de gravar a baseline volta já ao passo, sem dormir a cadência', () => {
  const p = projetoTemporario('lg21');
  try {
    abrirSemRelatorio(p, 'arco-lg21', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-lg21');
    const registro: string[] = [], baselines: string[] = [];
    // O instante da iteração ficou para trás (a baseline real leva minutos), e o `ate` do passo é o relógio depois dela.
    const inicio = new Date(Date.now() - 30 * 60_000).toISOString();
    const dormiu: number[] = [];
    const c = conduzirArco(p.carregado, 'arco-lg21', { ...opcoesSimuladas(p.dir, ITENS, registro, { passo: {
      abrirThread: (k, o) => novaThread(k, { ...o, criarWorktree: false }).thread,
      gravarBaseline: (_k, t) => {
        baselines.push(t);
        registrar(dirThread(p.dir, t), t, 'baseline_recorded', { commit: 'SIMULADO', comandos: [], simulado: true });
      } } as OpcoesDoVigia['passo'] }), maxPassos: 1, relogio: () => inicio, dormir: (ms) => { dormiu.push(ms); } });
    assert.ok(c.acao === 'saiu' && c.ultimo?.acao === 'aguardar' && c.ultimo.motivo === 'baseline-gravada', JSON.stringify(c));
    assert.equal(baselines.length, 1);
    assert.deepEqual(dormiu, [0]);
  } finally { p.limpar(); }
});

test('LG22: a parada pelo teto segue terminal: depois da emenda que subiu o teto, o arco fecha pela supervisão quando a sessão admitida acaba', () => {
  const p = projetoTemporario('lg22');
  try {
    const pedido = abrirSemRelatorio(p, 'arco-lg22', { trabalhos: [A, C], contas: DUAS, tetoDoArco: 1 });
    const registro: string[] = [];
    const tique = () => tiqueDoArco(p.carregado, 'arco-lg22', { ...simuladas(), opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    const r1 = tique();
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const sessao = String(r1.passo.sessionId), thread = r1.passo.thread;
    tique();
    assert.equal(lerSupervisao(p.dir, 'arco-lg22').parada?.motivo, 'teto-do-arco');
    // O dono sobe o teto do arco para 3 sessões depois da parada: o consumo (1) fica abaixo dele.
    autorizarPedido(p.dir, 'arco-lg22', { ...pedido, orcamento: { ...(pedido.orcamento as Record<string, unknown>), arco: { valor: 3, unidade: 'sessoes' } } });
    assert.deepEqual([lerArco(p.dir, 'arco-lg22')!.versao, lerArco(p.dir, 'arco-lg22')!.consumo.arco], [2, 1]);
    const r2 = tique();
    assert.equal(r2.fechamento.fechado, false, 'com a sessão admitida em voo, o arco espera');
    runtimeSimulado(p.dir).estado(sessao, 'completed');
    registrar(dirThread(p.dir, thread), thread, 'phase_result', { fase: 'GOAL', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    const r3 = tique();
    assert.deepEqual([r3.fechamento.fechado, r3.fechamento.motivo, r3.fechamento.paradas.length], [true, 'supervisao', 0], JSON.stringify(r3.fechamento));
    assert.match(r3.fechamento.detalhe, /teto-do-arco.*nenhuma sessão admitida segue em voo/);
    assert.equal(registro.length, 1, 'a emenda não reabre o despacho');
  } finally { p.limpar(); }
});

test('LG23: com a parada pelo teto, a sessão admitida que morre sem resultado vira sessao_morta, sem retomada, e o arco fecha pelo custo', () => {
  const p = projetoTemporario('lg23');
  try {
    abrirSemRelatorio(p, 'arco-lg23', { trabalhos: [A, C], contas: DUAS, tetoDoArco: 1 });
    const registro: string[] = [];
    const tique = (quando?: string) => tiqueDoArco(p.carregado, 'arco-lg23', { ...simuladas(), quando, opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    const r1 = tique();
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const sessao = String(r1.passo.sessionId), thread = r1.passo.thread;
    tique();
    assert.equal(lerSupervisao(p.dir, 'arco-lg23').parada?.motivo, 'teto-do-arco');
    // A sessão morre sem phase_result (o observador também caiu); passada a carência, o vigia prova a morte.
    runtimeSimulado(p.dir).estado(sessao, 'failed');
    const r2 = tique(new Date(Date.now() + 30 * 60_000).toISOString());
    assert.deepEqual([r2.fechamento.fechado, r2.fechamento.motivo, r2.fechamento.paradas.length], [true, 'custo', 0], JSON.stringify(r2.fechamento));
    assert.ok(lerLedger(dirThread(p.dir, thread)).some(e => e.tipo === 'sessao_morta' && e.sessionId === sessao), 'a morte provada fica no ledger');
    assert.deepEqual([lerSupervisao(p.dir, 'arco-lg23').retomadas.length, registro.length], [0, 1], 'nada retomado nem despachado depois do teto');
  } finally { p.limpar(); }
});

test('LG24: a baseline que falha sem ser espera (o comando que não existe na worktree nova) não derruba o condutor: o trabalho fica isolado com a causa, e o outro despacha', () => {
  const p = projetoTemporario('lg24');
  try {
    abrirSemRelatorio(p, 'arco-lg24', { trabalhos: [A, C], contas: DUAS });
    vigiaPresente(p, 'arco-lg24');
    const registro: string[] = [];
    const c = conduzirArco(p.carregado, 'arco-lg24', { ...opcoesSimuladas(p.dir, ITENS, registro, { passo: {
      abrirThread: (k, o) => novaThread(k, { ...o, criarWorktree: false }).thread,
      gravarBaseline: (_k, t) => {
        // A do A falha como o npm sem a dependência na worktree nova; a do C grava.
        if (lerThread(p.dir, t).roadmap === A.item) {
          throw new ErroDoCatalogo((m) => m.verify.baselineDependenciaAusente('build', 127, 'npm --prefix core run build'));
        }
        registrar(dirThread(p.dir, t), t, 'baseline_recorded', { commit: 'SIMULADO', comandos: [], simulado: true });
      } } as OpcoesDoVigia['passo'] }), maxPassos: 3, dormir: () => {} });
    assert.ok(c.acao === 'saiu' && c.ultimo?.acao === 'despachou', JSON.stringify(c));
    const isolado = lerSupervisao(p.dir, 'arco-lg24').isolados.get('a');
    assert.equal(isolado?.motivo, 'baseline-falhou');
    assert.match(isolado?.detalhe ?? '', /^baseline\.dependencia-ausente: build nao executou porque o comando nao existe \(codigo 127\)/);
    assert.equal(registro.length, 1, 'o C despachou depois do isolamento do A');
    assert.ok(c.ultimo?.acao === 'despachou' && c.ultimo.trabalho === 'c');
  } finally { p.limpar(); }
});

test('LG25: com a parada pelo teto, a sessão admitida de um trabalho isolado que morre sem resultado também vira sessao_morta, e o arco fecha pelo custo', () => {
  const p = projetoTemporario('lg25');
  try {
    abrirSemRelatorio(p, 'arco-lg25', { trabalhos: [A, C], contas: DUAS, tetoDoArco: 1 });
    const registro: string[] = [];
    const tique = (quando?: string) => tiqueDoArco(p.carregado, 'arco-lg25', { ...simuladas(), quando, opcoesDoVigia: opcoesSimuladas(p.dir, ITENS, registro) });
    const r1 = tique();
    assert.ok(r1.passo?.acao === 'despachou', JSON.stringify(r1.passo));
    const sessao = String(r1.passo.sessionId), thread = r1.passo.thread;
    tique();
    assert.equal(lerSupervisao(p.dir, 'arco-lg25').parada?.motivo, 'teto-do-arco');
    // M1 do CHECK 3: o trabalho já isolado não passa pela decisão de retomar, e a sessão dele ainda conta como em voo.
    gravarNaSupervisao(p.carregado, 'arco-lg25', [{ tipo: 'isolado', trabalho: 'a', thread, motivo: 'sessao-presa', detalhe: 'SIMULADO' }]);
    runtimeSimulado(p.dir).estado(sessao, 'failed');
    const r2 = tique(new Date(Date.now() + 30 * 60_000).toISOString());
    assert.deepEqual([r2.fechamento.fechado, r2.fechamento.motivo, r2.fechamento.paradas.length], [true, 'custo', 0], JSON.stringify(r2.fechamento));
    assert.ok(lerLedger(dirThread(p.dir, thread)).some(e => e.tipo === 'sessao_morta' && e.sessionId === sessao), 'a morte provada fica no ledger');
    assert.equal(registro.length, 1, 'nada retomado nem despachado depois do teto');
  } finally { p.limpar(); }
});

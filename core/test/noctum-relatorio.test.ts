/**
 * RM-058 (N6, D3, D10 e D11 da ork-rm058n6): o relatório da manhã no horário e no fuso do envelope, no formato da página,
 * com recibo por página e destino, reenvio sem duplicação, a lacuna sem recibo no retrato e a correção explícita.
 * Relógio controlado; transportes, sessões, entregas e provas são SIMULADOS, e nenhuma mensagem sai da máquina.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado, TrabalhoSimulado } from './noctum-apoio';
import { depois, HORA, MIN } from './noctum-n6-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { partesLocais } from '../src/horario';
import { registrar } from '../src/ledger';
import { encerrarArco, enfileirarDecisao, lerArco } from '../src/noctum-arco';
import { validarPedidoDeAbertura } from '../src/noctum-envelope';
import { CanalComTransporte, entregarRelatorioSeDevido, enviarPeloTransporte, fatosDoRelatorio, linhasDoRelatorio, paginar,
  reenviarRelatorio, relatorioNoTerminal, ResultadoDoEnvio, retratoDoRelatorio, TETO_DA_PAGINA, transporteDoCanal,
  vencimentoDoRelatorio } from '../src/noctum-relatorio';
import { comRegistro, lerRegistro } from '../src/noctum-registro';
import { dirThread, novaThread } from '../src/thread';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const FUSO = 'America/Sao_Paulo';
type Projeto = ReturnType<typeof projetoTemporario>;

test('RL1: o relatório vence no primeiro HH:MM do fuso no início ou depois, com horário de verão', () => {
  const venc = (inicio: string, fim: string, fuso: string, horario: string) => vencimentoDoRelatorio(validarPedidoDeAbertura({
    ...pedidoV2('arco-rl1', { trabalhos: [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ork-x' }] }),
    janela: { inicio, fim, fuso }, relatorio: { horario, canal: 'telegram' } }));
  // Brasília: arco das 22 h às 6 h, relatório às 7h30 do dia seguinte.
  assert.equal(venc('2026-10-12T22:00:00-03:00', '2026-10-13T06:00:00-03:00', FUSO, '07:30'), '2026-10-13T10:30:00.000Z');
  // UTC: o HH:MM ainda do mesmo dia, depois do início, vence no mesmo dia.
  assert.equal(venc('2026-10-12T20:00:00Z', '2026-10-13T04:00:00Z', 'UTC', '21:00'), '2026-10-12T21:00:00.000Z');
  assert.equal(venc('2026-10-12T20:00:00Z', '2026-10-13T04:00:00Z', 'UTC', '06:00'), '2026-10-13T06:00:00.000Z');
  // Nova York no domingo em que o relógio adianta: 7 h já é horário de verão (UTC-4).
  assert.equal(venc('2026-03-07T22:00:00-05:00', '2026-03-08T06:00:00-04:00', 'America/New_York', '07:00'), '2026-03-08T11:00:00.000Z');
  // 2h30 não existe nesse domingo: o relógio que o salto pula cai depois do salto (3h30 EDT).
  assert.equal(venc('2026-03-07T22:00:00-05:00', '2026-03-08T06:00:00-04:00', 'America/New_York', '02:30'), '2026-03-08T07:30:00.000Z');
});

/** O HH:MM de Brasília de um instante: o horário do relatório que vence nele (arredondado ao minuto). */
const horarioDe = (ms: number): string => { const p = partesLocais(ms, FUSO); return `${p.hora}:${p.minuto}`; };

interface Arco { sha: string; vencimento: string; fim: string; ids: string[] }

/** Um arco v2 com a janela em volta de agora e o relatório no canal e no horário dados (vence perto de agora + 2 h). */
function abrir(p: Projeto, arco: string, trabalhos: TrabalhoSimulado[], canal: 'telegram' | 'openclaw' | 'terminal', ids: string[],
  daquiMs = 2 * HORA): Arco {
  const pedido = { ...pedidoV2(arco, { trabalhos }), relatorio: { horario: horarioDe(Date.now() + daquiMs), canal } };
  const sha = autorizarPedido(p.dir, arco, pedido);
  const c = lerArco(p.dir, arco)!.conteudo!;
  return { sha, vencimento: vencimentoDoRelatorio(c), fim: c.janela.fim, ids };
}

function threads(p: Projeto, n: number): { trabalhos: TrabalhoSimulado[]; ids: string[] } {
  const ids = Array.from({ length: n }, (_, i) => novaThread(p.carregado, { nome: `rl trabalho ${i + 1}`, modo: 'auto', roadmap: `RM-90${i + 1}`,
    pedido: `Trabalho ${i + 1} SIMULADO do relatório.`, criarWorktree: false }).thread.id);
  return { ids, trabalhos: ids.map((thread, i) => ({ id: `t${i + 1}`, item: `RM-90${i + 1}`, prioridade: i + 1, dependeDe: [], thread })) };
}

const entregaProvada = (p: Projeto, thread: string, n = 1) => registrar(dirThread(p.dir, thread), thread, 'ship_done', { pushVerificado: true,
  fonteDaProva: 'git ls-remote origin refs/heads/main (SIMULADO)', mergeSha: `${n}`.repeat(40), pr: 10 + n });
const reservas = (itens: string[]) => () => ({ leitura: 'copia-local' as const, reservas: itens.map(item => ({ item, maquina: 'maquina-simulada', thread: null })) });
const base = { maquina: 'maquina-simulada', lerReservas: reservas(['RM-901', 'RM-902', 'RM-903', 'RM-904']) };

/** O transporte simulado: grava cada envio e responde o que o roteiro manda. */
function transporte(respostas: Array<ResultadoDoEnvio['estado']>): { enviar: (c: CanalComTransporte, t: string) => ResultadoDoEnvio; envios: string[] } {
  const envios: string[] = [];
  let i = 0;
  return { envios, enviar: (_c, texto) => {
    const estado = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (estado === 'confirmado') { envios.push(texto); return { estado, referencia: String(1000 + envios.length) }; }
    return { estado, motivo: `envio ${estado} SIMULADO` };
  } };
}

test('RL2: nada é composto antes do vencimento, nem com o arco fechado cedo pela fila vazia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl2');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl2', trabalhos, 'telegram', ids);
    entregaProvada(p, ids[0]);
    encerrarArco(p.dir, 'arco-rl2', { motivo: 'fila-vazia', detalhe: 'todo trabalho entregue' });
    const t = transporte(['confirmado']);
    const antes = entregarRelatorioSeDevido(p.carregado, 'arco-rl2', { ...base, quando: depois(a.vencimento, -MIN), enviar: t.enviar });
    assert.equal(antes.acao, 'aguardar');
    assert.match(antes.detalhe, /vence às/);
    assert.equal(lerRegistro(p.dir, 'arco-rl2', 'relatorio').length, 0, 'fechar cedo não antecipa o relatório');
    const no = entregarRelatorioSeDevido(p.carregado, 'arco-rl2', { ...base, quando: a.vencimento, enviar: t.enviar });
    assert.deepEqual([no.acao, no.versao, no.enviadas], ['entregue', 1, 1]);
    assert.match(t.envios[0], /O arco fechou às [0-9:/ ]+ \(fila vazia\): todo trabalho entregue\./);
  } finally { p.limpar(); }
});

test('RL3: os sete grupos na ordem da página, cada fato do núcleo, #HITL só no lote do dono e a supervisão como fonte não lida', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl3');
  try {
    const { trabalhos, ids } = threads(p, 4);
    trabalhos[2].dependeDe = ['t2'];
    const a = abrir(p, 'arco-rl3', trabalhos, 'telegram', ids);
    entregaProvada(p, ids[0]);
    registrar(dirThread(p.dir, ids[0]), ids[0], 'master_done', { fase: 'MASTER', score: 4 });
    registrar(dirThread(p.dir, ids[1]), ids[1], 'autonomous_decision', { fase: 'GO', quemDecidiu: 'agente SIMULADO',
      evidencia: 'teste SIMULADO', razao: 'razão SIMULADA', pedido: { classe: 'decidido', decidido: 'Usar a fila local',
        porque: 'é a fatia pedida', comoMudar: 'trocar a fonte da fila' } });
    const decisao = enfileirarDecisao(p.dir, 'arco-rl3', { thread: ids[3], acaoImpedida: 'merge na base', dependentes: [],
      impacto: 'o trabalho t4 espera', pergunta: 'Posso mesclar o t4 depois do CI?', alternativas: [
        { letra: 'a', texto: 'Mesclar depois do CI', consequencia: 'entra hoje', recomendada: true, porque: 'o CI cobre o risco' },
        { letra: 'b', texto: 'Esperar a revisão', consequencia: 'entra amanhã' },
        { letra: 'c', texto: 'Tirar do arco', consequencia: 'fica para depois' }] });
    const fatos = fatosDoRelatorio(p.carregado, 'arco-rl3', { ...base, quando: a.vencimento })!;
    const texto = linhasDoRelatorio(fatos, 1).join('\n');
    const grupos = ['✅ Entregue', '🔄 Em curso', '⏸️ Impedido', '🧭 Decidi no envelope', '💰 Custo e duração', '📝 Correções', '👤 O que precisa de você'];
    const posicoes = grupos.map(g => texto.indexOf(`\n${g}\n`));
    assert.ok(posicoes.every(x => x > 0), posicoes.join(','));
    assert.deepEqual([...posicoes].sort((x, y) => x - y), posicoes, 'na ordem da página');
    assert.match(texto, /• t1 \(RM-901\): thread .*PR #11, merge 11111111, push provado \(git ls-remote origin refs\/heads\/main \(SIMULADO\)\), MASTER 4\/5/);
    assert.match(texto, /• t2 \(RM-902\): thread .*checkpoint: sem fase concluída ainda; retoma: o passo do arco; próximo passo: fase GOAL/);
    assert.match(texto, /• t3 \(RM-903\): dependencia \(depende de t2/);
    const hitl = texto.split('\n').filter(l => l.includes('#HITL'));
    assert.equal(hitl.length, 2, hitl.join('\n'));
    assert.ok(hitl.every(l => l.includes(decisao.id)), 'o #HITL leva o id estável do lote');
    assert.match(texto, /  a\) Mesclar depois do CI: entra hoje \(Recomendação: o CI cobre o risco\)/);
    assert.match(texto, /Usar a fila local\. Porque: é a fatia pedida\. Como reverter: trocar a fonte da fila\./);
    assert.match(texto, /Teto do arco: 0 sessoes de 40 sessoes/);
    assert.match(texto, /Não lido: .*a supervisão e a retomada da N4 não foram lidas nesta instalação/);
    assert.match(texto, /📝 Correções\n• nada/);
    assert.match(texto, /Próximo trabalho elegível: t2 \(RM-902\), fase GOAL/);
    assert.doesNotMatch(texto, /\d{4}-\d{2}-\d{2}T/, 'nenhum ISO cru para a pessoa');
    // Com a supervisão plugada, a fonte é lida e o isolado vai ao Impedido.
    const comN4 = fatosDoRelatorio(p.carregado, 'arco-rl3', { ...base, quando: a.vencimento,
      supervisao: () => ({ isolados: [{ trabalho: 't2', motivo: 'duas sessões sem primeiro turno' }], contasFora: [{ conta: 'perfil-a', motivo: 'cota esgotada' }] }) })!;
    const t2 = linhasDoRelatorio(comN4, 1).join('\n');
    assert.doesNotMatch(t2, /supervisão e a retomada da N4 não foram lidas/);
    assert.match(t2, /• t2 \(RM-902\): isolado pela supervisão \(duas sessões sem primeiro turno\)/);
    assert.match(t2, /a conta perfil-a saiu do arco: cota esgotada/);
  } finally { p.limpar(); }
});

test('RL4: entregue só com a prova do push; sem ela fica em curso, e a entrega revertida vai ao impedido', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl4');
  try {
    const { trabalhos, ids } = threads(p, 2);
    const a = abrir(p, 'arco-rl4', trabalhos, 'telegram', ids);
    registrar(dirThread(p.dir, ids[0]), ids[0], 'ship_done', { origem: 'commit local SIMULADO', pushVerificado: false });
    entregaProvada(p, ids[1]);
    registrar(dirThread(p.dir, ids[1]), ids[1], 'rollback_done', { motivo: 'revertido SIMULADO' });
    const f = fatosDoRelatorio(p.carregado, 'arco-rl4', { ...base, quando: a.vencimento })!;
    assert.equal(f.entregues.length, 0);
    assert.equal(f.emCurso.find(e => e.trabalho === 't1')?.checkpoint, 'entrega registrada sem a prova do push no remoto');
    assert.equal(f.impedidos.find(i => i.trabalho === 't2')?.causa, 'entrega revertida na base');
  } finally { p.limpar(); }
});

test('RL5: as páginas cabem no teto, levam o arco, a versão e a página, e guardam todas as linhas na ordem', () => {
  const linhas = Array.from({ length: 400 }, (_, i) => `• linha ${i} ${'x'.repeat(i % 50)}`);
  const paginas = paginar('arco-rl5', 2, linhas);
  assert.ok(paginas.length > 1);
  paginas.forEach((pg, i) => {
    assert.ok(pg.length <= TETO_DA_PAGINA, `página ${i + 1} com ${pg.length}`);
    assert.equal(pg.split('\n')[0], `Arco arco-rl5, relatório v2, página ${i + 1}/${paginas.length}`);
  });
  assert.deepEqual(paginas.flatMap(pg => pg.split('\n').slice(1)), linhas);
  const comprida = paginar('arco-rl5', 1, ['y'.repeat(TETO_DA_PAGINA * 2)]);
  assert.ok(comprida.every(pg => pg.length <= TETO_DA_PAGINA), 'linha maior que a página é cortada, nunca estoura o canal');
});

test('RL6: o recibo de cada página fecha o envio, e a segunda chamada não manda nada de novo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl6');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl6', trabalhos, 'openclaw', ids);
    const t = transporte(['confirmado']);
    const r1 = entregarRelatorioSeDevido(p.carregado, 'arco-rl6', { ...base, quando: a.vencimento, enviar: t.enviar });
    assert.deepEqual([r1.acao, r1.canal, r1.enviadas], ['entregue', 'openclaw', 1]);
    const r2 = entregarRelatorioSeDevido(p.carregado, 'arco-rl6', { ...base, quando: depois(a.vencimento, 10 * MIN), enviar: t.enviar });
    assert.deepEqual([r2.acao, r2.enviadas], ['entregue', 0]);
    assert.equal(t.envios.length, 1, 'nenhuma página duplicada');
    assert.match(t.envios[0], /^Arco arco-rl6, relatório v1, página 1\/1\nRelatório da manhã do arco arco-rl6, versão 1/);
    const linhas = lerRegistro<{ tipo: string }>(p.dir, 'arco-rl6', 'relatorio');
    assert.equal(linhas.filter(l => l.evento.tipo === 'composto').length, 1);
    const retrato = retratoDoRelatorio(p.dir, 'arco-rl6', lerArco(p.dir, 'arco-rl6')!.conteudo, depois(a.vencimento, 11 * MIN));
    assert.deepEqual(retrato.lacunas, []);
    assert.deepEqual(retrato.versoes.map(v => [v.versao, v.entregue, v.recibos.map(x => x.referencia)]), [[1, true, ['1001']]]);
  } finally { p.limpar(); }
});

test('RL7: o transporte que falha e depois confirma entrega uma vez, com 5 min entre as tentativas', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl7');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl7', trabalhos, 'telegram', ids);
    const t = transporte(['falhou', 'confirmado']);
    const r1 = entregarRelatorioSeDevido(p.carregado, 'arco-rl7', { ...base, quando: a.vencimento, enviar: t.enviar });
    assert.deepEqual([r1.acao, r1.enviadas], ['pendente', 0]);
    assert.match(retratoDoRelatorio(p.dir, 'arco-rl7', lerArco(p.dir, 'arco-rl7')!.conteudo, a.vencimento).lacunas.join(),
      /sem recibo da página 1 da versão 1 no canal telegram \(1 tentativa\(s\) falharam\)/);
    const cedo = entregarRelatorioSeDevido(p.carregado, 'arco-rl7', { ...base, quando: depois(a.vencimento, 4 * MIN), enviar: t.enviar });
    assert.equal(cedo.enviadas, 0, 'antes dos 5 min, nada');
    const r2 = entregarRelatorioSeDevido(p.carregado, 'arco-rl7', { ...base, quando: depois(a.vencimento, 5 * MIN), enviar: t.enviar });
    assert.deepEqual([r2.acao, r2.enviadas], ['entregue', 1]);
    assert.equal(t.envios.length, 1, 'uma entrega só');
    const tentativas = lerRegistro<{ tipo: string }>(p.dir, 'arco-rl7', 'relatorio').filter(l => l.evento.tipo === 'envio_tentado').length;
    assert.equal(tentativas, 2);
  } finally { p.limpar(); }
});

test('RL8: a tentativa sem desfecho nunca se repete sozinha; o reenvio do dono manda uma vez', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl8');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl8', trabalhos, 'telegram', ids);
    const t = transporte(['incerto', 'confirmado']);
    entregarRelatorioSeDevido(p.carregado, 'arco-rl8', { ...base, quando: a.vencimento, enviar: t.enviar });
    for (const m of [6, 30, 120]) {
      const r = entregarRelatorioSeDevido(p.carregado, 'arco-rl8', { ...base, quando: depois(a.vencimento, m * MIN), enviar: t.enviar });
      assert.equal(r.enviadas, 0, `aos ${m} min, nada às cegas`);
    }
    const conteudo = lerArco(p.dir, 'arco-rl8')!.conteudo;
    assert.match(retratoDoRelatorio(p.dir, 'arco-rl8', conteudo, depois(a.vencimento, 2 * HORA)).lacunas.join(),
      /envio incerto da página 1 da versão 1 no canal telegram: confira o canal e reenvie com ork noctum relatorio arco-rl8 --reenviar telegram/);
    const forcado = reenviarRelatorio(p.carregado, 'arco-rl8', 'telegram', { quando: depois(a.vencimento, 2 * HORA), enviar: t.enviar });
    assert.deepEqual([forcado.acao, forcado.enviadas], ['entregue', 1]);
    assert.equal(t.envios.length, 1);
    assert.deepEqual(retratoDoRelatorio(p.dir, 'arco-rl8', conteudo, depois(a.vencimento, 2 * HORA)).lacunas, []);
    // O processo que morreu entre a tentativa e o desfecho deixa a página incerta, lida sob a trava.
    const b = abrir(p, 'arco-rl8b', trabalhos, 'telegram', ids);
    entregarRelatorioSeDevido(p.carregado, 'arco-rl8b', { ...base, quando: b.vencimento, enviar: transporte(['falhou']).enviar });
    comRegistro<Record<string, unknown>, void>(p.dir, 'arco-rl8b', 'relatorio', (_l, anexar) => {
      anexar({ tipo: 'envio_tentado', versao: 1, pagina: 1, canal: 'telegram', tentativa: 2, forcado: false }, depois(b.vencimento, 6 * MIN));
    });
    const morto = transporte(['confirmado']);
    assert.equal(entregarRelatorioSeDevido(p.carregado, 'arco-rl8b', { ...base, quando: depois(b.vencimento, 20 * MIN), enviar: morto.enviar }).enviadas, 0);
    assert.equal(morto.envios.length, 0);
  } finally { p.limpar(); }
});

test('RL9: cinco falhas esgotam o reenvio, e a lacuna fica no retrato', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl9');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl9', trabalhos, 'telegram', ids);
    const t = transporte(['falhou']);
    let chamadas = 0;
    const contando = { enviar: (c: CanalComTransporte, x: string) => { chamadas += 1; return t.enviar(c, x); } };
    for (let i = 0; i < 7; i++) entregarRelatorioSeDevido(p.carregado, 'arco-rl9', { ...base, quando: depois(a.vencimento, i * 6 * MIN), ...contando });
    assert.equal(chamadas, 5, 'cinco tentativas, nunca mais');
    assert.match(retratoDoRelatorio(p.dir, 'arco-rl9', lerArco(p.dir, 'arco-rl9')!.conteudo, depois(a.vencimento, HORA)).lacunas.join(),
      /reenvio esgotado da página 1 da versão 1 no canal telegram \(5 tentativas\)/);
  } finally { p.limpar(); }
});

test('RL10: o transporte vem só do arquivo local fora do git; código 0 é recibo com a referência, outro código é falha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl10');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl10', trabalhos, 'telegram', ids);
    assert.match(JSON.stringify(transporteDoCanal(p.dir, 'telegram')), /não configurado/);
    const semTransporte = entregarRelatorioSeDevido(p.carregado, 'arco-rl10', { ...base, quando: a.vencimento });
    assert.equal(semTransporte.acao, 'pendente');
    assert.equal(lerRegistro<{ tipo: string }>(p.dir, 'arco-rl10', 'relatorio').filter(l => l.evento.tipo === 'envio_tentado').length, 0,
      'sem transporte nada é tentado nem contado');
    assert.match(retratoDoRelatorio(p.dir, 'arco-rl10', lerArco(p.dir, 'arco-rl10')!.conteudo, a.vencimento).lacunas.join(), /não configurado/);
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    const saida = path.join(p.dir, 'envios-simulados.txt');
    const script = path.join(p.dir, 'transporte-simulado.sh');
    fs.writeFileSync(script, `#!/bin/sh\ncat >> "${saida}"\nprintf '%s' '{"success":true,"message_id":77}'\n`, { mode: 0o755 });
    const falho = path.join(p.dir, 'transporte-falho.sh');
    fs.writeFileSync(falho, '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    fs.writeFileSync(path.join(monitor, 'noctum-host.json'), JSON.stringify({ telegram: { executavel: script, argumentos: ['{{mensagem}}'] },
      openclaw: { executavel: falho, argumentos: ['{{mensagem}}'] } }));
    const r = entregarRelatorioSeDevido(p.carregado, 'arco-rl10', { ...base, quando: depois(a.vencimento, MIN) });
    assert.deepEqual([r.acao, r.enviadas], ['entregue', 1]);
    assert.match(fs.readFileSync(saida, 'utf8'), /Relatório da manhã do arco arco-rl10/);
    assert.deepEqual(retratoDoRelatorio(p.dir, 'arco-rl10', lerArco(p.dir, 'arco-rl10')!.conteudo, depois(a.vencimento, MIN)).versoes[0].recibos,
      [{ pagina: 1, referencia: '77' }]);
    const t = transporteDoCanal(p.dir, 'openclaw');
    assert.ok(!('ausente' in t));
    assert.deepEqual(enviarPeloTransporte(p.dir, t, 'x'), { estado: 'falhou', motivo: 'o transporte saiu com o código 3' });
    // Versionado no git, o arquivo não vale: o executável sairia de qualquer commit.
    execFileSync('git', ['-C', p.dir, 'add', '-f', '.orkastery/monitor/noctum-host.json'], { stdio: 'ignore' });
    assert.match(JSON.stringify(transporteDoCanal(p.dir, 'telegram')), /transporte\.rastreado/);
  } finally { p.limpar(); }
});

test('RL11: a entrega revertida depois do relatório entregue gera a versão 2 com a correção explícita, uma vez', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl11');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl11', trabalhos, 'telegram', ids);
    entregaProvada(p, ids[0]);
    const t = transporte(['confirmado']);
    assert.equal(entregarRelatorioSeDevido(p.carregado, 'arco-rl11', { ...base, quando: a.vencimento, enviar: t.enviar }).versao, 1);
    assert.match(t.envios[0], /✅ Entregue\n• t1 \(RM-901\)/);
    registrar(dirThread(p.dir, ids[0]), ids[0], 'rollback_done', { motivo: 'revertido na base SIMULADO' });
    const r = entregarRelatorioSeDevido(p.carregado, 'arco-rl11', { ...base, quando: depois(a.vencimento, 30 * MIN), enviar: t.enviar });
    assert.deepEqual([r.versao, r.enviadas], [2, 1]);
    assert.match(t.envios[1], /relatório v2/);
    assert.match(t.envios[1], /📝 Correções\n• Foi informado: t1 entregue \(versão 1, telegram, .*\)\. Fato confirmado agora: entrega revertida na base/);
    assert.match(t.envios[1], /Impacto: o trabalho não conta como entregue, e nada foi entregue de novo/);
    assert.match(t.envios[1], /✅ Entregue\n• nada/);
    const de = entregarRelatorioSeDevido(p.carregado, 'arco-rl11', { ...base, quando: depois(a.vencimento, HORA), enviar: t.enviar });
    assert.deepEqual([de.versao, de.enviadas], [2, 0], 'a mesma correção não gera outra versão');
    assert.equal(t.envios.length, 2);
  } finally { p.limpar(); }
});

test('RL12: no canal terminal o recibo só vem com o relatório mostrado num terminal interativo; antes do vencimento, só prévia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl12');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl12', trabalhos, 'terminal', ids);
    const previa = relatorioNoTerminal(p.carregado, 'arco-rl12', { ...base, quando: depois(a.vencimento, -HORA), interativo: true })!;
    assert.deepEqual([previa.previa, previa.versao], [true, null]);
    assert.match(previa.paginas[0], /Prévia: nenhuma versão foi composta ainda; isto não é a entrega\./);
    assert.equal(lerRegistro(p.dir, 'arco-rl12', 'relatorio').length, 0, 'a prévia não é registrada');
    const r = entregarRelatorioSeDevido(p.carregado, 'arco-rl12', { ...base, quando: a.vencimento });
    assert.deepEqual([r.acao, r.canal, r.enviadas], ['pendente', 'terminal', 0]);
    const conteudo = lerArco(p.dir, 'arco-rl12')!.conteudo;
    relatorioNoTerminal(p.carregado, 'arco-rl12', { quando: depois(a.vencimento, MIN), interativo: false });
    assert.match(retratoDoRelatorio(p.dir, 'arco-rl12', conteudo, depois(a.vencimento, MIN)).lacunas.join(),
      /não foi mostrado num terminal interativo: rode ork noctum relatorio arco-rl12/);
    relatorioNoTerminal(p.carregado, 'arco-rl12', { quando: depois(a.vencimento, 2 * MIN), interativo: true });
    assert.deepEqual(retratoDoRelatorio(p.dir, 'arco-rl12', conteudo, depois(a.vencimento, 2 * MIN)).lacunas, []);
    assert.equal(entregarRelatorioSeDevido(p.carregado, 'arco-rl12', { ...base, quando: depois(a.vencimento, 3 * MIN) }).acao, 'entregue');
  } finally { p.limpar(); }
});

test('RL13: depois de 24 h do vencimento nada é tentado, e a falta de recibo segue no retrato', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl13');
  try {
    const { trabalhos, ids } = threads(p, 1);
    const a = abrir(p, 'arco-rl13', trabalhos, 'telegram', ids);
    entregarRelatorioSeDevido(p.carregado, 'arco-rl13', { ...base, quando: a.vencimento, enviar: transporte(['falhou']).enviar });
    const t = transporte(['confirmado']);
    const tarde = entregarRelatorioSeDevido(p.carregado, 'arco-rl13', { ...base, quando: depois(a.vencimento, 24 * HORA + MIN), enviar: t.enviar });
    assert.equal(tarde.acao, 'fora-da-janela');
    assert.equal(t.envios.length, 0);
    assert.match(retratoDoRelatorio(p.dir, 'arco-rl13', lerArco(p.dir, 'arco-rl13')!.conteudo, depois(a.vencimento, 25 * HORA)).lacunas.join(),
      /a janela de entrega de 24 h acabou sem recibo/);
  } finally { p.limpar(); }
});

test('RL14: a versão 1 não muda depois de composta, mesmo com fatos novos sem correção', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-rl14');
  try {
    const { trabalhos, ids } = threads(p, 2);
    const a = abrir(p, 'arco-rl14', trabalhos, 'telegram', ids);
    const t = transporte(['falhou', 'confirmado']);
    entregarRelatorioSeDevido(p.carregado, 'arco-rl14', { ...base, quando: a.vencimento, enviar: t.enviar });
    entregaProvada(p, ids[1], 2);
    entregarRelatorioSeDevido(p.carregado, 'arco-rl14', { ...base, quando: depois(a.vencimento, 6 * MIN), enviar: t.enviar });
    assert.equal(t.envios.length, 1);
    assert.match(t.envios[0], /✅ Entregue\n• nada/, 'a versão entregue é a composta no vencimento');
    const compostos = lerRegistro<{ tipo: string }>(p.dir, 'arco-rl14', 'relatorio').filter(l => l.evento.tipo === 'composto');
    assert.equal(compostos.length, 1);
  } finally { p.limpar(); }
});

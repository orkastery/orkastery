/**
 * RM-058 (N6, D1, D3, D12 e D13 da ork-rm058n6): o transporte que liga o modo. `#Noctum` só com envelope vigente, o
 * ingresso assinado dos gateways pelo `ork noctum responder`, a proposta que não autoriza, o retrato do arco e o tique.
 * Chaves, provas, contas, sessões e transportes são SIMULADOS; o CLI roda num processo filho, num projeto descartável.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { abrirArco, autorizarPedido, entregar, pedidoV2, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { assinadoPara, depois, HORA, MIN } from './noctum-n6-apoio';
import { assinaturaDaResposta } from '../src/hitl-gates';
import { kernelDisponivel } from '../src/fila-pesada';
import { partesLocais } from '../src/horario';
import { extrairTagDoPedido, parseModo } from '../src/modos';
import { encerrarArco, lerArco, proporEnvelope, textoDeAutorizacao } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import { ResultadoDoPasso } from '../src/noctum-execucao';
import { aceitarModoNoctum, CONTRATO_INGRESSO_DO_ARCO, ehModoNoctum, responderAoArco, retratoDoArco, tagNoctumNoPedido, textoDoRetrato,
  tiqueDoArco } from '../src/noctum-modo';
import { vencimentoDoRelatorio } from '../src/noctum-relatorio';
import { pastaDoArco } from '../src/noctum-registro';
import { novaThread } from '../src/thread';
import { pedidoV3 } from './noctum-maquinas-apoio';
import { identidadeDaMaquina } from '../src/noctum-transporte';
import { CONTRATO_REDE_DO_ARCO, RedeDoArco } from '../src/noctum-rede';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const CLI = path.resolve(__dirname, '../../dist/index.js');
type Projeto = ReturnType<typeof projetoTemporario>;

function cli(dir: string, args: string[], entrada?: string) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', input: entrada, timeout: 60_000 });
}

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) { assert.ok(e instanceof RecusaDoArco, String(e)); assert.equal(e.motivo, motivo, e.message); return e.message; }
  return assert.fail(`esperava ${motivo}`);
}

function threads(p: Projeto, n: number): { trabalhos: TrabalhoSimulado[]; ids: string[] } {
  const ids = Array.from({ length: n }, (_, i) => novaThread(p.carregado, { nome: `mo trabalho ${i + 1}`, modo: 'auto', roadmap: `RM-90${i + 1}`,
    pedido: `Trabalho ${i + 1} SIMULADO do modo.`, criarWorktree: false }).thread.id);
  return { ids, trabalhos: ids.map((thread, i) => ({ id: `t${i + 1}`, item: `RM-90${i + 1}`, prioridade: i + 1, dependeDe: [], thread })) };
}

const aguardar = (fila: null = null): ResultadoDoPasso => ({ acao: 'aguardar', ate: new Date().toISOString(), motivo: 'simulado', detalhe: '', fila });

test('MO1: sem envelope vigente o #Noctum é recusado tipado, nunca cai no modo padrão, e o E9 continua valendo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo1');
  try {
    assert.match(recusa(() => aceitarModoNoctum(p.dir), 'noctum.modo.sem-envelope'), /ork noctum propor/);
    const pedido = cli(p.dir, ['modos', '--do-pedido', '#Noctum abrir o arco']);
    assert.equal(pedido.status, 2, pedido.stderr);
    assert.equal(pedido.stdout, '', 'nada de modo padrão em silêncio');
    assert.match(pedido.stderr, /noctum\.modo\.sem-envelope/);
    const thread = cli(p.dir, ['thread', 'new', 'mo1', '--modo', 'noctum']);
    assert.equal(thread.status, 2);
    assert.match(thread.stderr, /noctum\.modo\.sem-envelope/);
    assert.equal(cli(p.dir, ['modos', '--do-pedido', 'abrir o arco sem tag']).stdout.trim(), 'classic', 'sem tag, o padrão de sempre');
    assert.equal(parseModo('#Noctum'), null);
    assert.equal(extrairTagDoPedido('#Noctum abrir o arco'), null);
    assert.deepEqual([ehModoNoctum('#Noctum'), ehModoNoctum('--modo noctum'), ehModoNoctum('auto')], [true, true, false]);
    assert.deepEqual([tagNoctumNoPedido('#Noctum x'), tagNoctumNoPedido('#Auto e depois #Noctum'), tagNoctumNoPedido('#noctumx')], [true, false, false]);
  } finally { p.limpar(); }
});

test('MO2: com envelope vigente o #Noctum é aceito com os arcos, e thread nova em #Noctum recusa pela lista fechada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo2');
  try {
    const { trabalhos } = threads(p, 1);
    const sha = abrirArco(p.dir, 'arco-mo2', { trabalhos });
    assert.deepEqual(aceitarModoNoctum(p.dir).map(a => [a.arco, a.envelopeSha256]), [['arco-mo2', sha]]);
    const r = cli(p.dir, ['modos', '--do-pedido', '#Noctum seguir a noite', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { modo: string; arcos: Array<{ arco: string }>; modoDasThreads: string };
    assert.deepEqual([j.modo, j.arcos.map(a => a.arco), j.modoDasThreads], ['noctum', ['arco-mo2'], 'auto']);
    assert.equal(cli(p.dir, ['modos', '--do-pedido', '#Auto e depois #Noctum']).stdout.trim(), 'auto', 'a primeira tag vence');
    const nova = cli(p.dir, ['thread', 'new', 'mo2', '--modo', '#Noctum']);
    assert.equal(nova.status, 2);
    assert.match(nova.stderr, /noctum\.modo\.lista-fechada: .*emenda/);
  } finally { p.limpar(); }
});

test('MO3: arco revogado, expirado ou encerrado não liga o modo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo3');
  try {
    const { trabalhos } = threads(p, 1);
    abrirArco(p.dir, 'arco-mo3a', { trabalhos });
    revogarArco(p.dir, 'arco-mo3a');
    recusa(() => aceitarModoNoctum(p.dir), 'noctum.modo.sem-envelope');
    abrirArco(p.dir, 'arco-mo3b', { trabalhos });
    const fim = lerArco(p.dir, 'arco-mo3b')!.conteudo!.janela.fim;
    assert.equal(aceitarModoNoctum(p.dir, depois(fim, -MIN)).length, 1);
    recusa(() => aceitarModoNoctum(p.dir, fim), 'noctum.modo.sem-envelope');
    encerrarArco(p.dir, 'arco-mo3b', { motivo: 'fila-vazia', detalhe: 'simulado' });
    recusa(() => aceitarModoNoctum(p.dir), 'noctum.modo.sem-envelope');
  } finally { p.limpar(); }
});

test('MO4: o ingresso assinado autoriza e revoga, diz quando o ato já valia e recusa texto, endereço e prazo errados', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo4');
  try {
    const { trabalhos } = threads(p, 1);
    const { envelopeSha256: sha } = proporEnvelope(p.dir, pedidoV2('arco-mo4', { trabalhos }));
    assert.equal(lerArco(p.dir, 'arco-mo4')!.situacao, 'proposto', 'proposta não autoriza nada');
    recusa(() => responderAoArco(p.dir, 'arco-mo4', assinadoPara('arco-mo4', `aprovar ${sha}`)), 'noctum.origem.sem-prova');
    const outroEndereco = { resposta: textoDeAutorizacao(sha), origem: 'telegram' as const, canal: 'hermes' as const, por: 'telegram:42',
      mensagem: 'telegram:-7:mo4-outro', recebidoEm: new Date().toISOString() };
    recusa(() => responderAoArco(p.dir, 'arco-mo4', { ...outroEndereco,
      prova: assinaturaDaResposta('ork-thread-x', 'pedido-x', outroEndereco, process.env.ORK_HITL_INGRESS_KEY_HERMES!) }), 'noctum.origem.sem-prova');
    recusa(() => responderAoArco(p.dir, 'arco-mo4', assinadoPara('arco-mo4', textoDeAutorizacao(sha), depois(new Date().toISOString(), -2 * MIN))),
      'noctum.origem.sem-prova');
    const r1 = responderAoArco(p.dir, 'arco-mo4', assinadoPara('arco-mo4', textoDeAutorizacao(sha)));
    assert.deepEqual([r1.ok, r1.contrato, r1.ato, r1.situacao, r1.envelopeSha256, r1.repetida], [true, CONTRATO_INGRESSO_DO_ARCO, 'autorizar', 'vigente', sha, false]);
    assert.equal(responderAoArco(p.dir, 'arco-mo4', assinadoPara('arco-mo4', textoDeAutorizacao(sha))).repetida, true);
    const r2 = responderAoArco(p.dir, 'arco-mo4', assinadoPara('arco-mo4', 'revogar'));
    assert.deepEqual([r2.ato, r2.situacao, r2.repetida], ['revogar', 'revogado', false]);
    assert.equal(responderAoArco(p.dir, 'arco-mo4', assinadoPara('arco-mo4', 'revogar')).repetida, true);
  } finally { p.limpar(); }
});

test('MO5: ork noctum responder recebe o envelope assinado pela entrada e recusa argv que diverge dele', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo5');
  try {
    const { trabalhos } = threads(p, 1);
    const { envelopeSha256: sha } = proporEnvelope(p.dir, pedidoV2('arco-mo5', { trabalhos }));
    const e = assinadoPara('arco-mo5', textoDeAutorizacao(sha));
    const argv = (por: string) => ['noctum', 'responder', 'arco-mo5', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes', '--por', por,
      '--mensagem', e.mensagem];
    const divergente = cli(p.dir, argv('telegram:43'), JSON.stringify(e));
    assert.notEqual(divergente.status, 0);
    assert.match(divergente.stderr, /proveniência em argv diverge do envelope/);
    assert.equal(lerArco(p.dir, 'arco-mo5')!.situacao, 'proposto');
    const r = cli(p.dir, argv('telegram:42'), JSON.stringify(e));
    assert.equal(r.status, 0, r.stderr);
    const recibo = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.deepEqual([recibo.contrato, recibo.ato, recibo.situacao, recibo.repetida], [CONTRATO_INGRESSO_DO_ARCO, 'autorizar', 'vigente', false]);
    assert.equal(cli(p.dir, ['noctum', 'responder', 'arco-mo5']).status, 2, 'sem o envelope na entrada, nada');
  } finally { p.limpar(); }
});

test('MO6: ork noctum propor grava a proposta, diz como autorizar e não autoriza; pedido incompleto lista o que falta', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo6');
  try {
    const { trabalhos } = threads(p, 1);
    const arquivo = path.join(p.dir, 'envelope-simulado.json');
    fs.writeFileSync(arquivo, JSON.stringify(pedidoV2('arco-mo6', { trabalhos })));
    const r = cli(p.dir, ['noctum', 'propor', '--arquivo', arquivo]);
    assert.equal(r.status, 0, r.stderr);
    const sha = lerArco(p.dir, 'arco-mo6')!.propostaPendente!.envelopeSha256;
    // RM-057 (resposta curta): o dono autoriza respondendo à pergunta; a linha com o hash não é mais ensinada.
    assert.match(r.stdout, /Nada foi autorizado: o dono autoriza respondendo à pergunta/);
    assert.ok(!r.stdout.includes(`autorizar ${sha}`));
    assert.equal(lerArco(p.dir, 'arco-mo6')!.situacao, 'proposto');
    const j = JSON.parse(cli(p.dir, ['noctum', 'propor', '--arquivo', arquivo, '--json']).stdout) as { autorizado: boolean; envelopeSha256: string };
    assert.deepEqual([j.autorizado, j.envelopeSha256], [false, sha], 'a mesma proposta devolve a pendente');
    const incompleto = path.join(p.dir, 'incompleto.json');
    fs.writeFileSync(incompleto, JSON.stringify({ contrato: 'ork.noctum-envelope/v2', arco: 'arco-mo6b' }));
    const falta = cli(p.dir, ['noctum', 'propor', '--arquivo', incompleto]);
    assert.equal(falta.status, 2);
    assert.match(falta.stderr, /noctum\.envelope\.valores-ausentes: .*janela\.inicio/);
    fs.writeFileSync(incompleto, '{nao e json');
    assert.match(cli(p.dir, ['noctum', 'propor', '--arquivo', incompleto]).stderr, /não é JSON/);
  } finally { p.limpar(); }
});

test('MO7: o retrato do arco traz o fechamento, as paradas, o relatório e as lacunas, no texto e no --json', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo7');
  try {
    const { trabalhos } = threads(p, 1);
    abrirArco(p.dir, 'arco-mo7', { trabalhos });
    const fim = lerArco(p.dir, 'arco-mo7')!.conteudo!.janela.fim;
    tiqueDoArco(p.carregado, 'arco-mo7', { quando: fim, parar: () => ({ ok: true, detalhe: '' }), listarSessoes: () => ({ lidas: true, vivas: new Set() }),
      git: () => null, passo: () => assert.fail('o passo não roda no arco que fechou') });
    const r = retratoDoArco(p.carregado, 'arco-mo7', { quando: depois(fim, MIN), lerReservas: () => ({ leitura: 'copia-local', reservas: [] }) })!;
    assert.equal(r.situacao, 'encerrado');
    assert.equal(r.fechamento?.motivo, 'hora');
    assert.ok(r.relatorio.vencimentoEm);
    const texto = textoDoRetrato(r);
    assert.match(texto, /^Arco arco-mo7: encerrado, versão 1, hash [a-f0-9]{12}/);
    assert.match(texto, /Fechamento: hora em /);
    assert.match(texto, /Relatório da manhã: vence /);
    assert.match(texto, /Lacunas:/);
    const j = cli(p.dir, ['noctum', 'status', 'arco-mo7', '--json']);
    assert.equal(j.status, 0, j.stderr);
    assert.equal((JSON.parse(j.stdout) as { contrato: string }).contrato, 'ork.noctum-retrato/v1');
    assert.match(cli(p.dir, ['noctum', 'status']).stdout, /arco-mo7: encerrado/);
    assert.equal(cli(p.dir, ['noctum', 'status', 'arco-inexistente']).status, 2);
  } finally { p.limpar(); }
});

test('MO8: o tique fecha antes do passo, não chama o passo no arco fechado e fecha depois do passo que esvazia a fila', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo8');
  try {
    const { trabalhos, ids } = threads(p, 1);
    abrirArco(p.dir, 'arco-mo8', { trabalhos });
    const simuladas = { parar: () => ({ ok: true, detalhe: '' }), listarSessoes: () => ({ lidas: true, vivas: new Set<string>() }), git: () => null,
      lerReservas: () => ({ leitura: 'copia-local' as const, reservas: [] }), enviar: () => ({ estado: 'confirmado' as const, referencia: null }) };
    let passos = 0;
    const segue = tiqueDoArco(p.carregado, 'arco-mo8', { ...simuladas, passo: () => { passos += 1; return aguardar(); } });
    assert.deepEqual([segue.fechamento.fechado, passos, segue.passo?.acao], [false, 1, 'aguardar']);
    // O passo que leva a última entrega: a fila esvazia, e o mesmo tique fecha o arco.
    const esvazia = tiqueDoArco(p.carregado, 'arco-mo8', { ...simuladas, passo: () => {
      passos += 1; entregar(p.dir, ids[0]); return { acao: 'encerrar', motivo: 'fila-vazia', fila: null as never };
    } });
    assert.deepEqual([esvazia.fechamento.fechado, esvazia.fechamento.motivo, passos], [true, 'fila-vazia', 2]);
    const depoisDoFim = tiqueDoArco(p.carregado, 'arco-mo8', { ...simuladas, quando: depois(new Date().toISOString(), HORA),
      passo: () => { passos += 1; return aguardar(); } });
    assert.equal(passos, 2, 'arco fechado não ganha passo');
    assert.equal(depoisDoFim.fechamento.agora, false);
  } finally { p.limpar(); }
});

test('MO9: o tique de arco nunca autorizado recusa: sem envelope, o modo não vale', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo9');
  try {
    const { trabalhos } = threads(p, 1);
    proporEnvelope(p.dir, pedidoV2('arco-mo9', { trabalhos }));
    recusa(() => tiqueDoArco(p.carregado, 'arco-mo9'), 'noctum.modo.sem-envelope');
    recusa(() => tiqueDoArco(p.carregado, 'arco-inexistente'), 'noctum.modo.sem-envelope');
    const r = cli(p.dir, ['noctum', 'tique', 'arco-mo9']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /noctum\.modo\.sem-envelope: o arco arco-mo9 nunca foi autorizado/);
  } finally { p.limpar(); }
});

test('MO10: nenhum comando do terminal autoriza o arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo10');
  try {
    const { trabalhos } = threads(p, 1);
    const { envelopeSha256: sha } = proporEnvelope(p.dir, pedidoV2('arco-mo10', { trabalhos }));
    for (const args of [['noctum', 'autorizar', 'arco-mo10', sha], ['noctum', 'aprovar', 'arco-mo10'], ['noctum'],
      ['noctum', 'responder', 'arco-mo10', '--resposta', textoDeAutorizacao(sha)]]) {
      const r = cli(p.dir, args);
      assert.equal(r.status, 2, args.join(' '));
    }
    assert.equal(lerArco(p.dir, 'arco-mo10')!.situacao, 'proposto');
  } finally { p.limpar(); }
});

test('MO11: o registro do fechamento adulterado vira falha do tique, e o relatório da manhã sai assim mesmo', { skip: semKernel }, () => {
  // Achado do CHECK: a recusa do registro subia do fechamento e o tique morria antes do relatório, em todo tique.
  const p = projetoTemporario('noctum-mo11');
  try {
    const { trabalhos } = threads(p, 1);
    const daqui8h = partesLocais(Date.now() + 8 * HORA, 'America/Sao_Paulo');
    autorizarPedido(p.dir, 'arco-mo11', { ...pedidoV2('arco-mo11', { trabalhos }), relatorio: { horario: `${daqui8h.hora}:${daqui8h.minuto}`, canal: 'telegram' } });
    const conteudo = lerArco(p.dir, 'arco-mo11')!.conteudo!;
    const enviadas: string[] = [];
    const simuladas = { parar: () => ({ ok: true, detalhe: '' }), listarSessoes: () => ({ lidas: true, vivas: new Set<string>() }), git: () => null,
      lerReservas: () => ({ leitura: 'copia-local' as const, reservas: [] }),
      enviar: (_c: string, texto: string) => { enviadas.push(texto); return { estado: 'confirmado' as const, referencia: null }; } };
    const fechou = tiqueDoArco(p.carregado, 'arco-mo11', { ...simuladas, quando: conteudo.janela.fim,
      passo: () => assert.fail('o passo não roda no arco que fecha') });
    assert.deepEqual([fechou.fechamento.motivo, fechou.falhas], ['hora', []]);
    // O registro do fechamento deixa de ser privado do núcleo: toda leitura dele recusa como adulterado.
    fs.chmodSync(path.join(pastaDoArco(p.dir, 'arco-mo11'), 'fechamento.jsonl'), 0o644);
    const r = tiqueDoArco(p.carregado, 'arco-mo11', { ...simuladas, quando: vencimentoDoRelatorio(conteudo) });
    assert.deepEqual(r.falhas.map(f => [f.etapa, f.motivo]), [['fechamento', 'noctum.registro.adulterado']]);
    assert.equal(r.fechamento.fechado, true, 'o arco segue encerrado: o encerrado mora no log do arco, que se lê');
    assert.deepEqual([r.relatorio.acao, enviadas.length], ['entregue', 1]);
    assert.match(enviadas[0], /Não lido: .*o registro do fechamento não se lê \(noctum\.registro\.adulterado\)/);
    const cliTique = cli(p.dir, ['noctum', 'tique', 'arco-mo11']);
    assert.equal(cliTique.status, 1, 'o cron do dono vê a falha pela saída');
    assert.match(cliTique.stdout, /falha no fechamento: noctum\.registro\.adulterado/);
  } finally { p.limpar(); }
});

test('MO12: arquivo de proposta que não se lê e entrada do ingresso malformada são recusas tipadas, com código 2', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo12');
  try {
    const semArquivo = cli(p.dir, ['noctum', 'propor', '--arquivo', path.join(p.dir, 'nao-existe.json')]);
    assert.equal(semArquivo.status, 2);
    assert.match(semArquivo.stderr, /^noctum\.envelope\.invalido: o pedido de abertura .* não se lê/m);
    const malformada = cli(p.dir, ['noctum', 'responder', 'arco-mo12', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes',
      '--por', 'telegram:42', '--mensagem', 'telegram:-7:1'], '{ isto não é json');
    assert.equal(malformada.status, 2);
    assert.match(malformada.stderr, /^noctum\.origem\.sem-prova: /m);
  } finally { p.limpar(); }
});

function redeDoModo(arco: string, lacuna: RedeDoArco['lacuna'] = null): RedeDoArco {
  return { contrato: CONTRATO_REDE_DO_ARCO, arco, multimaquina: true, maquina: 'maquina-a', envelopeSha256: 'a'.repeat(64),
    lidaEm: new Date().toISOString(), autoridade: { maquina: 'maquina-a', geracao: 1, desde: new Date().toISOString() }, revogada: null,
    maquinas: [{ nome: 'maquina-a', ultimoSinal: new Date().toISOString(), sinalRecente: true, ordensVivas: ['O-t1-1'], vagasAtivas: [],
      vezesAtivas: [], consumo: 1 }], trabalhos: [{ id: 't1', estado: 'em-execucao', maquina: 'maquina-a', maquinaPresa: 'maquina-a', entrega: null,
        ordem: { ordem: 'O-t1-1', numero: 1, maquina: 'maquina-a', estado: 'aceita', emitidaEm: new Date().toISOString() } }],
    consumo: { arco: 1, porConta: { 'perfil-a': 1 }, porRuntime: { 'claude-bg': 1 } }, obrigacoes: { ordens: ['O-t1-1'], vagas: [], vezes: [] }, lacuna };
}

function abrirV3DoModo(p: Projeto, arco: string): void {
  const { trabalhos } = threads(p, 1);
  autorizarPedido(p.dir, arco, pedidoV3(arco, { trabalhos: trabalhos.map(t => ({ ...t, maquina: 'maquina-a' })),
    maquinas: [identidadeDaMaquina(p.dir, 'maquina-a')], contas: [{ conta: 'perfil-a', sessoes: 2 }],
    global: [{ conta: 'perfil-a', sessoes: 2 }] }));
}

test('MO13: retrato v3 expõe autoridade, máquinas, trabalho e consumo da rede', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo13');
  try {
    abrirV3DoModo(p, 'arco-mo13');
    const r = retratoDoArco(p.carregado, 'arco-mo13', { maquina: 'maquina-a', projecaoDaRede: redeDoModo('arco-mo13'),
      lerReservas: () => ({ leitura: 'copia-local', reservas: [] }) })!;
    assert.equal(r.rede?.autoridade?.maquina, 'maquina-a');
    assert.equal(r.rede?.consumo.arco, 1);
    assert.match(textoDoRetrato(r), /Rede: autoridade maquina-a/);
  } finally { p.limpar(); }
});

test('MO14: retrato v3 preserva a lacuna da rede', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo14');
  try {
    abrirV3DoModo(p, 'arco-mo14');
    const projecao = redeDoModo('arco-mo14', { motivo: 'noctum.coordenacao.sem-remoto', detalhe: 'SIMULADO' });
    const r = retratoDoArco(p.carregado, 'arco-mo14', { maquina: 'maquina-a', projecaoDaRede: projecao })!;
    assert.equal(r.rede?.lacuna?.motivo, 'noctum.coordenacao.sem-remoto');
    assert.match(textoDoRetrato(r), /Rede: sem leitura/);
  } finally { p.limpar(); }
});

test('MO15: retrato v2 não ganha o campo rede', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-mo15');
  try {
    const { trabalhos } = threads(p, 1);
    abrirArco(p.dir, 'arco-mo15', { trabalhos });
    const r = retratoDoArco(p.carregado, 'arco-mo15')!;
    assert.equal('rede' in r, false);
  } finally { p.limpar(); }
});

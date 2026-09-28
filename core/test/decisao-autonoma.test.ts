/**
 * I-41 (GO-FIX 1, B4): a metade que presta contas.
 *
 * Projetos, threads, contas e credenciais deste arquivo são SIMULADOS em diretórios temporários.
 * Cada asserção lê o conteúdo que o passo anterior gravou (o evento no ledger, o texto do resumo),
 * nunca espera por arquivo que outro processo ainda escreve.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario, runtimePorConta } from './apoio';
import {
  decisoesParaODono, LIMIAR_DE_DECISOES_POR_FASE, NOMES_HISTORICOS_DE_QUEM, placarDaThread, rastroDaDecisao,
  registrarDecisao, taxaDeReversao,
} from '../src/decisao-autonoma';
import { lerLedger, registrar, registrarSeExiste } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { validarPedidoHitl } from '../src/hitl-contract';
import { pedidoHitlAberto } from '../src/hitl-presentation';
import { montarLote } from '../src/hitl-lote';
import { rodarFase } from '../src/phase';
import { varrerPulse } from '../src/pulse-delivery';
import { Pulse } from '../src/pulse';
import { EventoLedger } from '../src/types';

const QUANDO = '2026-09-22T23:00:00.000Z';
const CLI = path.resolve(__dirname, '../../dist/index.js');

const decisao = (extra: Record<string, unknown> = {}) => ({
  decidido: 'O resumo do pulse conta perguntas separado de itens',
  porque: 'contar item como pergunta fazia o dono consentir e receber zero perguntas',
  comoMudar: 'peça para voltar a contar tudo junto; é uma linha em hitl-resumo.ts',
  custoDeReverter: { agora: 'uma linha e um teste', depois: 'uma linha e um teste' },
  criterio: { tipo: 'manifesto' as const, referencia: 'project.name' },
  quemDecidiu: 'sessão de GO-FIX 412ec5f9', evidencia: 'medição da fila real em 22/09: 49 itens, 3 perguntas',
  ...extra,
});

test('o emissor grava UM evento com a decisão informada e o rastro tipado, e ela não segura nada', () => {
  const p = projetoTemporario('decisao-emissor');
  try {
    const t = novaThread(p.carregado, { nome: 'emissor', modo: 'auto' }).thread;
    const { pedido, evento } = registrarDecisao(p.dir, t.id, decisao());
    validarPedidoHitl(pedido);
    assert.equal(pedido.classe, 'decidido');
    assert.equal(pedido.contrato, 'ork.hitl/v2');
    const gravados = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'autonomous_decision');
    assert.equal(gravados.length, 1);
    const e = gravados[0];
    assert.equal(e.eventId, evento.eventId);
    // O rastro tem nome único, e a razão é o porquê quando não vem outra.
    assert.equal(e.quemDecidiu, 'sessão de GO-FIX 412ec5f9');
    assert.match(String(e.evidencia), /49 itens, 3 perguntas/);
    assert.equal(e.razao, pedido.porque);
    assert.deepEqual((e.pedido as { id: string }).id, pedido.id);
    assert.equal(rastroDaDecisao(e).tipada, true);
    // Fato consumado: não é pedido aberto, não é pergunta do lote, não abre gate.
    assert.equal(pedidoHitlAberto(p.dir, t.id, t.faseAtual, null), undefined);
    assert.equal(montarLote([pedido]).perguntas.length, 0);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(x => x.tipo === 'gate_blocked' || x.tipo === 'hitl_requested'), false);
  } finally { p.limpar(); }
});

test('decisão sem critério que resolve, sem preço dos dois lados ou sem rastro não chega a existir', () => {
  const p = projetoTemporario('decisao-recusas');
  try {
    const t = novaThread(p.carregado, { nome: 'recusas', modo: 'auto' }).thread;
    assert.throws(() => registrarDecisao(p.dir, t.id, decisao({ criterio: { tipo: 'manifesto', referencia: 'chave.que.nao.existe' } })),
      /critério não resolve/);
    assert.throws(() => registrarDecisao(p.dir, t.id, decisao({ criterio: { tipo: 'ledger', referencia: `${t.id}#evento:999` } })),
      /critério não resolve/);
    assert.throws(() => registrarDecisao(p.dir, t.id, decisao({ custoDeReverter: { agora: 'uma linha', depois: '' } })),
      /custo de reverter exige agora e depois/);
    for (const campo of ['quemDecidiu', 'evidencia']) {
      assert.throws(() => registrarDecisao(p.dir, t.id, decisao({ [campo]: '  ' })), new RegExp(`exige ${campo}`));
    }
    assert.throws(() => registrarDecisao(p.dir, t.id, decisao({ reverte: 'decisao-que-nao-existe' })), /revertida não existe/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'autonomous_decision'), false);
  } finally { p.limpar(); }
});

test('D11: o registro recusa decisão autônoma sem quemDecidiu, evidencia e razao, pelos dois escritores', () => {
  const p = projetoTemporario('decisao-registro');
  try {
    const t = novaThread(p.carregado, { nome: 'registro', modo: 'auto' }).thread, dir = dirThread(p.dir, t.id);
    assert.throws(() => registrar(dir, t.id, 'autonomous_decision', { fase: 'GOAL', decisao: 'sem rastro' }), /exige quemDecidiu/);
    assert.throws(() => registrar(dir, t.id, 'autonomous_decision', { fase: 'GOAL', quemDecidiu: 'x', evidencia: 'y' }), /exige razao/);
    assert.throws(() => registrarSeExiste(dir, t.id, 'autonomous_decision', { fase: 'GOAL', quemDecidiu: 'x', razao: 'z' }), /exige evidencia/);
    const ok = registrar(dir, t.id, 'autonomous_decision', { fase: 'GOAL', decisao: 'com rastro', quemDecidiu: 'x', evidencia: 'y', razao: 'z' });
    assert.equal(ok.quemDecidiu, 'x');
    // Os outros eventos não mudam: a exigência é só da decisão autônoma.
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
  } finally { p.limpar(); }
});

test('os oito nomes históricos de "quem decidiu" continuam lidos, e nenhuma linha é reescrita', () => {
  assert.equal(NOMES_HISTORICOS_DE_QUEM.length, 8);
  const antigo = (quem: string, i: number): EventoLedger => ({ ts: QUANDO, thread: 'ork-antiga', tipo: 'autonomous_decision',
    fase: 'GO', [quem]: `quem ${i}`, justificativa: 'por um motivo', evidencias: ['comando 1', 'comando 2'] } as unknown as EventoLedger);
  NOMES_HISTORICOS_DE_QUEM.forEach((quem, i) => {
    const r = rastroDaDecisao(antigo(quem, i));
    assert.equal(r.quemDecidiu, `quem ${i}`, quem);
    assert.equal(r.razao, 'por um motivo');
    assert.equal(r.evidencia, 'comando 1; comando 2');
    assert.equal(r.completa, true);
    // Completo pelos nomes antigos não é o mesmo que tipado: a auditoria enxerga as duas coisas.
    assert.equal(r.tipada, false);
  });
  const semRazao = { ts: QUANDO, thread: 'ork-antiga', tipo: 'autonomous_decision', fase: 'GO', quem: 'alguém' } as unknown as EventoLedger;
  assert.equal(rastroDaDecisao(semRazao).completa, false);
});

test('o placar conta decididas contra perguntas, reversões e o limiar de 13 por fase', () => {
  const p = projetoTemporario('decisao-placar');
  try {
    const t = novaThread(p.carregado, { nome: 'placar', modo: 'auto' }).thread, dir = dirThread(p.dir, t.id);
    const primeira = registrarDecisao(p.dir, t.id, decisao());
    registrarDecisao(p.dir, t.id, decisao({ decidido: 'O resumo volta a contar tudo junto', reverte: primeira.pedido.id }));
    for (let i = 0; i < LIMIAR_DE_DECISOES_POR_FASE; i++) {
      registrar(dir, t.id, 'autonomous_decision', { fase: 'GOAL', decisao: `escolha ${i}`, quemDecidiu: 'x', evidencia: 'y', razao: 'z' });
    }
    registrar(dir, t.id, 'hitl_requested', { fase: 'GOAL', pedido: { contrato: 'ork.hitl/v2', classe: 'pergunta', fase: 'GOAL',
      alvo: { tipo: 'gate', sobre: 'objetivo' } } });
    const goal = placarDaThread(lerLedger(dir)).find(f => f.fase === 'GOAL')!;
    assert.equal(goal.decididas, 2 + LIMIAR_DE_DECISOES_POR_FASE);
    assert.equal(goal.informadas, 2);
    assert.equal(goal.perguntas, 1);
    assert.equal(goal.revertidas, 1);
    assert.equal(goal.semRastro, 0);
    assert.equal(goal.acimaDoLimiar, true, `${goal.decididas} decisões e o limiar é ${LIMIAR_DE_DECISOES_POR_FASE}`);
    assert.equal(taxaDeReversao([goal]), 0.5);
    // Exatamente no limiar não dispara: o limiar é gatilho de revisão acima do p90, não teto.
    const noLimiar = placarDaThread(Array.from({ length: LIMIAR_DE_DECISOES_POR_FASE }, () =>
      ({ ts: QUANDO, thread: t.id, tipo: 'autonomous_decision', fase: 'GO', quemDecidiu: 'x', evidencia: 'y', razao: 'z' }) as unknown as EventoLedger));
    assert.equal(noLimiar[0].acimaDoLimiar, false);
  } finally { p.limpar(); }
});

test('a decisão chega ao dono UMA vez no resumo, com o que foi decidido, o porquê, como mudar e o preço', () => {
  const p = projetoTemporario('decisao-resumo');
  try {
    const t = novaThread(p.carregado, { nome: 'resumo', modo: 'auto' }).thread, dir = dirThread(p.dir, t.id);
    registrarDecisao(p.dir, t.id, decisao());
    for (let i = 0; i < LIMIAR_DE_DECISOES_POR_FASE; i++) {
      registrar(dir, t.id, 'autonomous_decision', { fase: 'GOAL', decisao: `escolha ${i}`, quemDecidiu: 'x', evidencia: 'y', razao: 'z' });
    }
    const agora = new Date().toISOString();
    const pulse = (): Pulse => ({ contrato: 'ork.pulse/v1', consultadoEm: agora, runtime: { ok: true, detalhe: '' },
      precisaDeHumanoAgora: [], acoesAutomaticas: [], resumo: { humanos: 0, automaticas: 0, scores: 0, fasesOrfas: 0 },
      ...decisoesParaODono(p.dir, new Date(Date.parse(agora) - 3600000).toISOString()) });
    const mensagens: string[] = [];
    const rodar = () => varrerPulse({ raiz: p.dir, consultar: pulse, quando: agora, enviar: m => { mensagens.push(m); return true; } });
    assert.equal(rodar().enviadas, 1, 'decisão nova é notícia, mesmo sem item parado');
    const texto = mensagens[0];
    assert.match(texto, /🧭 Decidi sem te perguntar: 1/);
    assert.match(texto, new RegExp(`• ${t.id} GOAL: O resumo do pulse conta perguntas separado de itens`));
    assert.match(texto, /porquê: contar item como pergunta/);
    assert.match(texto, /Para mudar: peça para voltar a contar tudo junto/);
    assert.match(texto, /reverter agora: uma linha e um teste; depois: uma linha e um teste\./);
    assert.match(texto, new RegExp(`${t.id} GOAL já tomou ${LIMIAR_DE_DECISOES_POR_FASE + 1} decisões sozinha, acima do limiar de ${LIMIAR_DE_DECISOES_POR_FASE}`));
    // Efeito antes de mecanismo: o que mudou vem antes do porquê.
    assert.ok(texto.indexOf('O resumo do pulse conta') < texto.indexOf('porquê:'));
    // Nada nela pede ação: sem pergunta, o resumo não pede licença.
    assert.equal(texto.includes('Posso te mandar'), false);
    // UMA vez: a decisão já informada não volta a tocar.
    assert.equal(rodar().enviadas, 0);
  } finally { p.limpar(); }
});

test('o despacho sem pausa grava a decisão do modo com o rastro tipado', () => {
  const p = projetoTemporario('decisao-despacho');
  const claude = runtimePorConta('decisao');
  try {
    claude.conta(p.dir, 'a');
    const t = novaThread(p.carregado, { nome: 'despacho', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    const e = lerLedger(dirThread(p.dir, t.id)).find(x => x.tipo === 'autonomous_decision')!;
    assert.equal(rastroDaDecisao(e).tipada, true);
    assert.match(String(e.quemDecidiu), /#Auto/);
    assert.match(String(e.razao), /não prevê pausa humana/);
    assert.match(String(e.evidencia), /^prompt sha256 [a-f0-9]{64}$/);
  } finally { p.limpar(); claude.restaurar(); }
});

test('CLI: ork decisao registrar grava a decisão e ork decisao placar mostra a fase e o limiar', () => {
  const p = projetoTemporario('decisao-cli');
  try {
    const t = novaThread(p.carregado, { nome: 'cli', modo: 'auto' }).thread;
    const d = decisao();
    const saida = JSON.parse(execFileSync(process.execPath, [CLI, 'decisao', 'registrar', t.id, '--decidido', d.decidido,
      '--porque', d.porque, '--como-mudar', d.comoMudar, '--custo-agora', d.custoDeReverter.agora,
      '--custo-depois', d.custoDeReverter.depois, '--criterio', 'manifesto:project.name', '--quem', d.quemDecidiu,
      '--evidencia', d.evidencia], { cwd: p.dir, encoding: 'utf8' }));
    assert.equal(saida.ok, true);
    assert.equal(saida.placar.informadas, 1);
    const placar = execFileSync(process.execPath, [CLI, 'decisao', 'placar', t.id], { cwd: p.dir, encoding: 'utf8' });
    assert.match(placar, /GOAL/);
    assert.match(placar, /taxa de reversão das decisões informadas: 0%/);
    const json = JSON.parse(execFileSync(process.execPath, [CLI, 'decisao', 'placar', t.id, '--json'], { cwd: p.dir, encoding: 'utf8' }));
    assert.equal(json.limiar, LIMIAR_DE_DECISOES_POR_FASE);
    // Critério em forma errada é recusado antes de tocar no ledger.
    assert.throws(() => execFileSync(process.execPath, [CLI, 'decisao', 'registrar', t.id, '--decidido', 'x', '--porque', 'y',
      '--como-mudar', 'z', '--custo-agora', 'a', '--custo-depois', 'b', '--criterio', 'opiniao', '--quem', 'q', '--evidencia', 'e'],
    { cwd: p.dir, encoding: 'utf8', stdio: 'pipe' }), /--criterio manifesto:CHAVE/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'autonomous_decision').length, 1);
    assert.equal(fs.existsSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl')), true);
  } finally { p.limpar(); }
});

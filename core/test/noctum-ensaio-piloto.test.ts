/**
 * RM-058 (N6, T8 da ork-rm058n6): o ensaio do piloto (`core/scripts/ensaio-noctum.cjs`) roda sobre o `core/dist` num
 * processo filho, em pastas descartáveis, com o runtime, as contas, a parada e o canal simulados. O aceite da N6 vira
 * teste: o relógio controlado prova prazo e fuso, o teto com sessões em voo, a ausência de recibo e o reenvio sem
 * duplicação, e a correção explícita; a sabotagem prova que o ensaio reprova quando o canal duplica.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { kernelDisponivel } from '../src/fila-pesada';

const semKernel = !kernelDisponivel();
const ENSAIO = path.resolve(__dirname, '../../scripts/ensaio-noctum.cjs');

interface Expectativa { texto: string; ok: boolean; detalhe?: string }
interface Cenario { nome: string; titulo: string; ok: boolean; expectativas: Expectativa[] }
interface Resultado { contrato: string; ok: boolean; raiz: string; mantida: boolean; sabotagem: string | null; cenarios: Cenario[] }

function ensaio(args: string[]) {
  const env = { ...process.env };
  // Sob `node --test`, o filho não herda a marca do runner nem a autoridade HITL de quem roda a suíte.
  delete env.NODE_TEST_CONTEXT;
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_')) delete env[nome];
  return spawnSync(process.execPath, [ENSAIO, ...args], { encoding: 'utf8', timeout: 600_000, env, maxBuffer: 16 * 1024 * 1024 });
}

let completo: { status: number | null; json: Resultado; stderr: string } | null = null;
/** O ensaio inteiro roda uma vez, e os testes do aceite leem o mesmo resultado. */
function ensaioCompleto() {
  if (!completo) {
    const r = ensaio(['--json']);
    completo = { status: r.status, json: JSON.parse(r.stdout) as Resultado, stderr: r.stderr };
  }
  return completo;
}

const cenario = (nome: string): Cenario => {
  const c = ensaioCompleto().json.cenarios.find(x => x.nome === nome);
  assert.ok(c, `o cenário ${nome} não rodou`);
  return c;
};

/** A expectativa que casa com o texto passou. */
function provada(c: Cenario, padrao: RegExp): void {
  const e = c.expectativas.find(x => padrao.test(x.texto));
  assert.ok(e, `${c.nome}: nenhuma expectativa casa com ${padrao}`);
  assert.equal(e.ok, true, `${c.nome}: ${e.texto}\n${e.detalhe ?? ''}`);
}

test('EP1: o ensaio inteiro sai 0 com todas as expectativas dos sete cenários, e a pasta descartável some no fim', { skip: semKernel }, () => {
  const { status, json, stderr } = ensaioCompleto();
  assert.equal(status, 0, stderr + JSON.stringify(json.cenarios.flatMap(c => c.expectativas.filter(e => !e.ok))));
  assert.equal(json.contrato, 'ork.noctum-ensaio/v1');
  assert.equal(json.ok, true);
  assert.deepEqual(json.cenarios.map(c => c.nome), ['ligar-o-modo', 'arco-curto', 'prazo-e-fuso', 'teto-com-sessoes-em-voo', 'teto-medido',
    'sem-recibo-e-reenvio', 'correcao-explicita']);
  for (const c of json.cenarios) {
    assert.equal(c.ok, true, c.nome);
    assert.ok(c.expectativas.length >= 7, `${c.nome}: ${c.expectativas.length} expectativas`);
    // Cada cenário prova que nada de verdade rodou: as sentinelas do runtime, da forja e dos gateways ficaram paradas.
    provada(c, /^nenhum runtime, forja ou gateway de verdade foi chamado \(sentinelas claude, codex, gh/);
  }
  assert.ok(json.cenarios.reduce((s, c) => s + c.expectativas.length, 0) >= 70);
  assert.equal(json.mantida, false);
  assert.equal(fs.existsSync(json.raiz), false, 'a pasta do ensaio foi apagada');
  assert.ok(!json.raiz.startsWith(path.resolve(__dirname, '../../..')), 'a pasta do ensaio nunca fica no repositório');
});

test('EP2: o relógio controlado prova prazo e fuso: vence no primeiro HH:MM do fuso, nada antes, e fechar cedo não antecipa', { skip: semKernel }, () => {
  const c = cenario('prazo-e-fuso');
  provada(c, /^o relatório vence no primeiro \d\d:\d\d de Asia\/Tokyo depois do início da janela/);
  provada(c, /^com a fila vazia confirmada, o arco fecha cedo \(fila-vazia\)/);
  provada(c, /^fechar cedo não antecipa o relatório/);
  provada(c, /^um minuto antes do vencimento, ainda nada sai/);
  provada(c, /^no vencimento a versão 1 é composta e entregue pelo canal do envelope \(openclaw\)/);
  provada(c, /^o texto diz o fuso e dá os horários nele/);
  provada(c, /^no domingo em que Nova York adianta o relógio/);
  provada(c, /^o 02:30 que o salto pula vence depois do salto/);
  const curto = cenario('arco-curto');
  provada(curto, /^um minuto antes do fim o arco segue/);
  provada(curto, /^no fim do envelope o arco fecha por hora e pede a parada da sessão em voo uma vez/);
  provada(curto, /^no tique seguinte a lista do runtime confirma a parada/);
});

test('EP3: o teto com sessões em voo para tudo, sem retry nem troca de conta, e o teto medido fecha sem chamar lacuna de zero', { skip: semKernel }, () => {
  const c = cenario('teto-com-sessoes-em-voo');
  provada(c, /^dois despachos alcançam o teto do arco \(2 sessões\), com as duas sessões em voo/);
  provada(c, /^o tique seguinte fecha por custo antes de qualquer despacho novo/);
  provada(c, /^cada sessão em voo recebeu exatamente um pedido de parada/);
  provada(c, /^sem troca de conta para contornar/);
  provada(c, /^sem retry: o tique seguinte confirma as paradas/);
  provada(c, /^o estado deixado para retomar identifica o consumo/);
  const m = cenario('teto-medido');
  provada(m, /^com 33 de 30 minutos medidos, o arco fecha por custo com as três sessões em voo/);
  provada(m, /^sem transcrição legível, tokens ficam como lacuna/);
  provada(m, /^com a sessão em voo sem transcrição, o consumo em tokens é lacuna: a reserva recusa \(noctum\.orcamento\.sem-medicao\)/);
  provada(m, /^lacuna não prova o teto alcançado/);
});

test('EP4: sem recibo, a lacuna aparece no retrato; o reenvio é limitado e nunca duplica a página que já tem recibo', { skip: semKernel }, () => {
  const c = cenario('sem-recibo-e-reenvio');
  provada(c, /^sem o transporte do canal configurado, nada é tentado nem contado/);
  provada(c, /^sem recibo, a lacuna aparece no retrato seguinte do arco/);
  provada(c, /^antes de 5 minutos da falha, o tique não tenta de novo/);
  provada(c, /^com o canal de volta, a página sai e ganha recibo: chegou ao canal uma vez só/);
  provada(c, /^nem o tique seguinte nem o reenvio do dono repetem a página que já tem recibo/);
  provada(c, /^o transporte que morre no meio deixa o envio incerto, e nenhum tique o repete sozinho/);
  provada(c, /^ork noctum relatorio arco-incerto --reenviar telegram manda a página uma vez/);
  provada(c, /^o segundo reenvio do dono não duplica/);
  provada(cenario('arco-curto'), /^cada página chegou ao canal uma vez só, e o tique seguinte não manda nada de novo/);
});

test('EP5: a alegação que deixou de valer volta corrigida, explícita e sem apagar o rastro, e só a prova do push conta como entrega', { skip: semKernel }, () => {
  const c = cenario('correcao-explicita');
  provada(c, /^a versão 1 dá o t1 como entregue, com a prova do push/);
  provada(c, /^o t2, com a entrega registrada sem a prova do push, fica em curso, nunca em Entregue/);
  provada(c, /^revertida a entrega, o tique seguinte compõe a versão 2 com a correção explícita/);
  provada(c, /^o rastro fica: a versão 1 continua no registro do relatório, ao lado da 2/);
  provada(c, /^nada é entregue de novo: cada versão chegou uma vez, e o tique seguinte não cria a versão 3/);
  const modo = cenario('ligar-o-modo');
  provada(modo, /^sem envelope vigente, o #Noctum é recusado tipado/);
  provada(modo, /^o envelope assinado pelo gateway, entregue a ork noctum responder pela entrada, autoriza o arco/);
  provada(modo, /^a mensagem assinada com outra chave é recusada/);
});

test('EP6: cada cenário roda isolado, pela escolha no argumento, e o resumo diz o total', { skip: semKernel }, () => {
  const r = ensaio(['--cenario', 'correcao-explicita', '--resumo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^\[ok\] correcao-explicita: .+ \(7 de 7\)$/m);
  assert.doesNotMatch(r.stdout, /prazo-e-fuso|arco-curto/);
  assert.match(r.stdout, /^Ensaio aprovado: 1 cenário\(s\), 7 de 7 expectativas\./m);
});

test('EP7: o ensaio reprova quando o canal duplica (sabotagem), e o uso errado sai 2 sem rodar nada', { skip: semKernel }, () => {
  const r = ensaio(['--cenario', 'sem-recibo-e-reenvio', '--sabotar', 'duplicar-envio', '--json']);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout) as Resultado;
  assert.deepEqual([j.ok, j.sabotagem], [false, 'duplicar-envio']);
  const falhas = j.cenarios[0].expectativas.filter(e => !e.ok).map(e => e.texto);
  assert.ok(falhas.some(t => /chegou ao canal uma vez só/.test(t)), falhas.join('\n'));
  // Só caem as expectativas que contam as mensagens no canal: a entrega única e a mensagem igual na entrada e no argumento.
  assert.ok(falhas.every(t => /uma vez|repetem|duplica|igual pela entrada/.test(t)), `só as expectativas de entrega única caem: ${falhas.join('\n')}`);
  const desconhecido = ensaio(['--cenario', 'inexistente']);
  assert.equal(desconhecido.status, 2);
  assert.match(desconhecido.stderr, /cenário desconhecido: inexistente/);
  const sabotagem = ensaio(['--sabotar', 'outra']);
  assert.equal(sabotagem.status, 2);
  const lista = ensaio(['--listar']);
  assert.equal(lista.status, 0);
  assert.equal(lista.stdout.trim().split('\n').length, 7);
});

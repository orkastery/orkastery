/** RM-058 (N1): o contrato do envelope. Todos os valores deste arquivo são SIMULADOS, nenhum é do dono. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  avaliarEfeito, canonico, CONTRATO_ENVELOPE, ConteudoDoEnvelope, EXCLUSOES_FIXAS, exclusaoDaAcao, hashDoEnvelope, PedidoDeEfeito,
  RecusaDoArco, validarPedidoDeAbertura,
} from '../src/noctum-envelope';
import { extrairTagDoPedido, MODOS_LEGADOS, parseModo } from '../src/modos';

const pedido = (): Record<string, unknown> => ({
  contrato: CONTRATO_ENVELOPE, arco: 'arco-simulado',
  janela: { inicio: '2026-10-12T22:00:00-03:00', fim: '2026-10-13T06:00:00-03:00', fuso: 'America/Sao_Paulo' },
  destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['merge', 'push', 'pr'] }],
  orcamento: {
    arco: { valor: 40, unidade: 'sessoes' },
    porConta: [{ conta: 'perfil-a', teto: { valor: 20, unidade: 'sessoes' } }],
    porRuntime: [{ runtime: 'claude-bg', teto: { valor: 30, unidade: 'sessoes' } }],
  },
  relatorio: { horario: '07:30', canal: 'telegram' },
});

/** Confere o motivo tipado e devolve a mensagem, para o teste ler o que ela explica. */
function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

const comTeto = (valor: unknown): Record<string, unknown> => {
  const p = pedido();
  (p.orcamento as Record<string, unknown>).arco = { valor, unidade: 'sessoes' };
  return p;
};

test('E1: pedido sem os valores do dono é recusado de uma vez, com cada campo que falta', () => {
  const msg = recusa(() => validarPedidoDeAbertura({ contrato: CONTRATO_ENVELOPE }), 'noctum.envelope.valores-ausentes');
  for (const campo of ['arco', 'janela.inicio', 'janela.fim', 'janela.fuso', 'destinos', 'orcamento.arco',
    'orcamento.porConta', 'orcamento.porRuntime', 'relatorio.horario', 'relatorio.canal']) {
    assert.ok(msg.includes(campo), `a recusa não diz que falta ${campo}: ${msg}`);
  }
  assert.match(msg, /Nenhum valor do dono é presumido/);
  // Um campo só ausente também é recusado, e o resto do pedido não esconde a falta.
  const semCanal = pedido();
  delete (semCanal.relatorio as Record<string, unknown>).canal;
  assert.match(recusa(() => validarPedidoDeAbertura(semCanal), 'noctum.envelope.valores-ausentes'), /relatorio\.canal/);
  const semSubteto = pedido();
  (semSubteto.orcamento as Record<string, unknown>).porConta = [];
  assert.match(recusa(() => validarPedidoDeAbertura(semSubteto), 'noctum.envelope.valores-ausentes'), /orcamento\.porConta/);
});

test('E2: pedido completo vira o conteúdo autorizado, com as exclusões fixas e nada inventado', () => {
  const c = validarPedidoDeAbertura(pedido());
  assert.deepEqual(Object.keys(c).sort(), ['arco', 'contrato', 'destinos', 'exclusoes', 'janela', 'orcamento', 'relatorio']);
  assert.deepEqual(c.exclusoes, [...EXCLUSOES_FIXAS]);
  assert.deepEqual(c.destinos[0].permissoes, ['push', 'pr', 'merge']);
  assert.deepEqual(c.orcamento.arco, { valor: 40, unidade: 'sessoes' });
  assert.deepEqual(c.relatorio, { horario: '07:30', canal: 'telegram' });
  assert.deepEqual(c.janela, pedido().janela);
});

test('E3: teto ilimitado é recusado em toda forma, no arco e nos subtetos', () => {
  for (const valor of [Number.POSITIVE_INFINITY, 0, -1, 'ilimitado', 'unlimited', 'sem teto']) {
    const msg = recusa(() => validarPedidoDeAbertura(comTeto(valor)), 'noctum.envelope.teto-ilimitado');
    assert.match(msg, /orcamento\.arco\.valor/);
  }
  const sub = pedido();
  (sub.orcamento as { porRuntime: unknown[] }).porRuntime = [{ runtime: 'codex', teto: { valor: 0, unidade: 'tokens' } }];
  assert.match(recusa(() => validarPedidoDeAbertura(sub), 'noctum.envelope.teto-ilimitado'), /porRuntime\[0\]\.teto\.valor/);
  // Texto que não diz "ilimitado" também não é teto: só deixa de ser classificado como tal.
  recusa(() => validarPedidoDeAbertura(comTeto('40')), 'noctum.envelope.invalido');
});

test('E4: unidade, percentual, conta e runtime fora do contrato são recusados', () => {
  const unidade = pedido();
  (unidade.orcamento as Record<string, unknown>).arco = { valor: 10, unidade: 'reais' };
  assert.match(recusa(() => validarPedidoDeAbertura(unidade), 'noctum.envelope.invalido'), /sessoes, minutos-de-sessao, tokens, percentual-da-cota/);
  const percentual = pedido();
  (percentual.orcamento as Record<string, unknown>).arco = { valor: 101, unidade: 'percentual-da-cota' };
  recusa(() => validarPedidoDeAbertura(percentual), 'noctum.envelope.invalido');
  const runtime = pedido();
  (runtime.orcamento as { porRuntime: unknown[] }).porRuntime = [{ runtime: 'api-paga', teto: { valor: 1, unidade: 'sessoes' } }];
  assert.match(recusa(() => validarPedidoDeAbertura(runtime), 'noctum.envelope.invalido'), /claude-bg, codex/);
  const conta = pedido();
  (conta.orcamento as { porConta: unknown[] }).porConta = [{ conta: '../fora', teto: { valor: 1, unidade: 'sessoes' } }];
  recusa(() => validarPedidoDeAbertura(conta), 'noctum.envelope.invalido');
});

test('E5: a janela tem de 6 a 12 h, deslocamento explícito e fuso válido', () => {
  const janela = (inicio: string, fim: string, fuso = 'America/Sao_Paulo') => ({ ...pedido(), janela: { inicio, fim, fuso } });
  validarPedidoDeAbertura(janela('2026-10-12T22:00:00-03:00', '2026-10-13T04:00:00-03:00'));
  validarPedidoDeAbertura(janela('2026-10-12T22:00:00-03:00', '2026-10-13T10:00:00-03:00'));
  assert.match(recusa(() => validarPedidoDeAbertura(janela('2026-10-12T22:00:00-03:00', '2026-10-13T03:59:00-03:00')),
    'noctum.envelope.invalido'), /de 6 a 12 h/);
  recusa(() => validarPedidoDeAbertura(janela('2026-10-12T22:00:00-03:00', '2026-10-13T10:01:00-03:00')), 'noctum.envelope.invalido');
  recusa(() => validarPedidoDeAbertura(janela('2026-10-12T22:00:00', '2026-10-13T06:00:00-03:00')), 'noctum.envelope.invalido');
  recusa(() => validarPedidoDeAbertura(janela('2026-10-12T22:00:00-03:00', '2026-10-13T06:00:00-03:00', 'Lua/Base')), 'noctum.envelope.invalido');
});

test('E6: ação excluída nunca entra no envelope, e as exclusões não são do pedido', () => {
  for (const acao of ['tag', 'publicar', 'deploy', 'producao', 'segredos', 'force-push', 'criar-repositorio-publico']) {
    const p = pedido();
    (p.destinos as Array<Record<string, unknown>>)[0].permissoes = ['push', acao];
    assert.match(recusa(() => validarPedidoDeAbertura(p), 'noctum.envelope.acao-excluida'), new RegExp(acao));
  }
  const producao = pedido();
  (producao.destinos as Array<Record<string, unknown>>)[0].permissoes = ['deploy'];
  assert.match(recusa(() => validarPedidoDeAbertura(producao), 'noctum.envelope.acao-excluida'), /autorização explícita própria/);
  assert.match(recusa(() => validarPedidoDeAbertura({ ...pedido(), exclusoes: [] }), 'noctum.envelope.invalido'), /fixas do núcleo/);
  recusa(() => validarPedidoDeAbertura({ ...pedido(), extra: true }), 'noctum.envelope.invalido');
});

test('E7: o hash é canônico, estável e muda com qualquer valor', () => {
  const c = validarPedidoDeAbertura(pedido());
  const reordenado = JSON.parse(canonico(c)) as ConteudoDoEnvelope;
  const invertido = Object.fromEntries(Object.entries(reordenado).reverse()) as unknown as ConteudoDoEnvelope;
  assert.equal(hashDoEnvelope(invertido), hashDoEnvelope(c));
  assert.match(hashDoEnvelope(c), /^[a-f0-9]{64}$/);
  const outro = validarPedidoDeAbertura(comTeto(41));
  assert.notEqual(hashDoEnvelope(outro), hashDoEnvelope(c));
  // A ordem das permissões e dos destinos no pedido não muda o que o dono autoriza.
  const permutado = pedido();
  (permutado.destinos as Array<Record<string, unknown>>)[0].permissoes = ['pr', 'merge', 'push'];
  assert.equal(hashDoEnvelope(validarPedidoDeAbertura(permutado)), hashDoEnvelope(c));
});

test('E8: o efeito respeita exclusão, janela e destino', () => {
  const c = validarPedidoDeAbertura(pedido());
  const efeito = (x: Partial<PedidoDeEfeito> = {}): PedidoDeEfeito =>
    ({ arco: c.arco, envelopeSha256: hashDoEnvelope(c), acao: 'push', repositorio: 'exemplo/produto', branch: 'ork/trabalho', ...x });
  const dentro = '2026-10-13T02:00:00-03:00';
  avaliarEfeito(c, efeito(), dentro);
  avaliarEfeito(c, efeito({ acao: 'merge', branch: 'main' }), dentro);
  for (const acao of ['tag', 'publicar', 'producao', 'segredos', 'acao-destrutiva', 'repositorio-publico-novo']) {
    recusa(() => avaliarEfeito(c, efeito({ acao }), dentro), 'noctum.efeito.acao-excluida');
  }
  recusa(() => avaliarEfeito(c, efeito(), '2026-10-12T21:59:59-03:00'), 'noctum.efeito.fora-da-janela');
  avaliarEfeito(c, efeito(), '2026-10-13T05:59:59.999-03:00');
  recusa(() => avaliarEfeito(c, efeito(), '2026-10-13T06:00:00-03:00'), 'noctum.efeito.expirado');
  assert.match(recusa(() => avaliarEfeito(c, efeito({ branch: 'main' }), dentro), 'noctum.efeito.fora-do-destino'), /push direto na base/);
  // Só nome curto de branch: ref completa, forma curta de tag, HEAD e a base em outra caixa nunca passam.
  assert.match(recusa(() => avaliarEfeito(c, efeito({ branch: 'MAIN' }), dentro), 'noctum.efeito.fora-do-destino'), /push direto na base/);
  for (const branch of ['refs/heads/main', 'refs/tags/v1.0.0', 'tags/v1.0.0', 'heads/main', 'HEAD', 'head',
    'refs/remotes/origin/main', 'ork/x..y', 'ork/.oculta', 'ork/trava.lock', 'ork//dupla']) {
    recusa(() => avaliarEfeito(c, efeito({ branch }), dentro), 'noctum.efeito.fora-do-destino');
    recusa(() => avaliarEfeito(c, efeito({ acao: 'merge', branch }), dentro), 'noctum.efeito.fora-do-destino');
  }
  recusa(() => avaliarEfeito(c, efeito({ acao: 'pr', branch: 'outra' }), dentro), 'noctum.efeito.fora-do-destino');
  recusa(() => avaliarEfeito(c, efeito({ repositorio: 'exemplo/outro' }), dentro), 'noctum.efeito.fora-do-destino');
  recusa(() => avaliarEfeito(c, efeito({ acao: 'rebase' }), dentro), 'noctum.efeito.fora-do-destino');
  const soPush = pedido();
  (soPush.destinos as Array<Record<string, unknown>>)[0].permissoes = ['push'];
  recusa(() => avaliarEfeito(validarPedidoDeAbertura(soPush), efeito({ acao: 'merge', branch: 'main' }), dentro), 'noctum.efeito.fora-do-destino');
});

test('E9: #Noctum continua fora dos modos aceitos', () => {
  assert.equal(parseModo('noctum'), null);
  assert.equal(parseModo('#Noctum'), null);
  assert.equal(extrairTagDoPedido('#Noctum abrir o arco'), null);
  assert.equal((MODOS_LEGADOS as readonly string[]).includes('noctum'), false);
});

test('E10: horário e canal do relatório são do dono e ficam no contrato', () => {
  const horario = pedido();
  (horario.relatorio as Record<string, unknown>).horario = '7h';
  recusa(() => validarPedidoDeAbertura(horario), 'noctum.envelope.invalido');
  const canal = pedido();
  (canal.relatorio as Record<string, unknown>).canal = 'email';
  assert.match(recusa(() => validarPedidoDeAbertura(canal), 'noctum.envelope.invalido'), /terminal, telegram, openclaw/);
});

test('E11: teto finito absurdo, subteto acima do teto, fuso que não é IANA, base com ref e conta repetida são recusados', () => {
  for (const valor of [Number.MAX_VALUE, 1e300]) {
    assert.match(recusa(() => validarPedidoDeAbertura(comTeto(valor)), 'noctum.envelope.teto-ilimitado'), /inteiro seguro/);
  }
  recusa(() => validarPedidoDeAbertura(comTeto(2.5)), 'noctum.envelope.invalido');
  const subteto = pedido();
  (subteto.orcamento as { porConta: unknown[] }).porConta = [{ conta: 'perfil-a', teto: { valor: 41, unidade: 'sessoes' } }];
  assert.match(recusa(() => validarPedidoDeAbertura(subteto), 'noctum.envelope.invalido'), /passa do teto do arco/);
  const fuso = pedido();
  (fuso.janela as Record<string, unknown>).fuso = '+03:00';
  recusa(() => validarPedidoDeAbertura(fuso), 'noctum.envelope.invalido');
  const base = pedido();
  (base.destinos as Array<Record<string, unknown>>)[0].base = 'refs/heads/main';
  assert.match(recusa(() => validarPedidoDeAbertura(base), 'noctum.envelope.invalido'), /nome curto de branch/);
  const contas = pedido();
  (contas.orcamento as { porConta: unknown[] }).porConta = [
    { conta: 'perfil-a', teto: { valor: 10, unidade: 'sessoes' } }, { conta: 'PERFIL-A', teto: { valor: 10, unidade: 'sessoes' } }];
  assert.match(recusa(() => validarPedidoDeAbertura(contas), 'noctum.envelope.invalido'), /repetido/);
});

test('E12: a busca de ação excluída não cai no protótipo do mapa', () => {
  assert.equal(exclusaoDaAcao('constructor'), undefined);
  assert.equal(exclusaoDaAcao('__proto__'), undefined);
  assert.equal(exclusaoDaAcao('toString'), undefined);
  assert.equal(exclusaoDaAcao('TAG'), 'tag-e-publicacao');
  const c = validarPedidoDeAbertura(pedido());
  recusa(() => avaliarEfeito(c, { arco: c.arco, envelopeSha256: hashDoEnvelope(c), acao: 'constructor', repositorio: 'exemplo/produto',
    branch: 'ork/trabalho' }, '2026-10-13T02:00:00-03:00'), 'noctum.efeito.fora-do-destino');
});

/** RM-058 (N3): o contrato `v3` do envelope, com as máquinas do arco. Todos os valores são SIMULADOS, nenhum é do dono. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado } from './noctum-apoio';
import { chaveSimulada, pedidoV3 } from './noctum-maquinas-apoio';
import { lerArco, proporEnvelope, versoesAutorizadas } from '../src/noctum-arco';
import {
  chavePublicaValida, CONTRATO_ENVELOPE_V2, CONTRATO_ENVELOPE_V3, envelopeComTrabalhos, envelopeMultimaquina, hashDoEnvelope,
  impressaoDaChave, MAXIMO_DE_MAQUINAS, RecusaDoArco, resumoDoEnvelope, validarPedidoDeAbertura,
} from '../src/noctum-envelope';

prepararIngressoSimulado();

const A = { nome: 'maquina-a', chave: chaveSimulada('a') };
const B = { nome: 'maquina-b', chave: chaveSimulada('b') };

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: 'Fatia B SIMULADA.', maquina: 'maquina-b' },
  { id: 'c', item: 'RM-903', prioridade: 3, dependeDe: [], thread: 'ork-simulada', maquina: 'maquina-a' },
];

const v3 = (): Record<string, unknown> => pedidoV3('arco-v3', { trabalhos: TRABALHOS.map(t => ({ ...t })), maquinas: [A, B],
  contas: [{ conta: 'perfil-a', sessoes: 2 }], global: [{ conta: 'perfil-a', sessoes: 3 }] });

const trabalhosDe = (p: Record<string, unknown>) => p.trabalhos as Array<Record<string, unknown>>;
const maquinasDe = (p: Record<string, unknown>) => p.maquinas as Array<Record<string, unknown>>;

/** Confere o motivo tipado e devolve a mensagem, para o teste ler o que ela explica. */
function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

test('EV1: a v3 completa vira conteúdo com as máquinas na ordem do dono, o limite global e a máquina presa', () => {
  const c = validarPedidoDeAbertura(v3());
  assert.equal(c.contrato, CONTRATO_ENVELOPE_V3);
  assert.ok(envelopeComTrabalhos(c), 'a v3 mantém a lista e os limites da v2');
  assert.ok(envelopeMultimaquina(c));
  assert.deepEqual(c.maquinas, [A, B]);
  assert.deepEqual(c.capacidadeGlobal, { porConta: [{ conta: 'perfil-a', sessoes: 3 }] });
  assert.deepEqual(c.trabalhos!.map(t => t.maquina ?? null), [null, 'maquina-b', 'maquina-a']);
  const invertida = v3();
  maquinasDe(invertida).reverse();
  assert.notEqual(hashDoEnvelope(validarPedidoDeAbertura(invertida)), hashDoEnvelope(c), 'a ordem das máquinas desempata e entra no hash');
  const comoV2: Record<string, unknown> = { ...v3(), contrato: CONTRATO_ENVELOPE_V2 };
  delete comoV2.maquinas; delete comoV2.capacidadeGlobal;
  trabalhosDe(comoV2).forEach(t => { delete t.maquina; });
  const c2 = validarPedidoDeAbertura(comoV2);
  assert.equal(envelopeMultimaquina(c2), false, 'a v2 continua de uma máquina');
  assert.notEqual(hashDoEnvelope(c2), hashDoEnvelope(c));
});

test('EV2: v3 sem máquinas, sem limite global e com thread sem máquina lista tudo de uma vez', () => {
  const p = v3();
  delete p.maquinas; delete p.capacidadeGlobal;
  delete trabalhosDe(p)[2].maquina;
  const msg = recusa(() => validarPedidoDeAbertura(p), 'noctum.envelope.valores-ausentes');
  assert.match(msg, /maquinas \(cada máquina do arco: nome e chave pública\)/);
  assert.match(msg, /capacidadeGlobal\.porConta \(sessões ao mesmo tempo por conta, somando as máquinas\)/);
  assert.match(msg, /trabalhos\[2\]\.maquina \(a máquina em que a thread mora\)/);
  assert.match(msg, /Nenhum valor do dono é presumido/);
  const semChave = v3();
  delete maquinasDe(semChave)[1].chave;
  assert.match(recusa(() => validarPedidoDeAbertura(semChave), 'noctum.envelope.valores-ausentes'), /maquinas\[1\]\.chave/);
});

test('EV3: chave que não é Ed25519 canônica, nome inválido e nome ou chave repetidos são recusados', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const x25519 = generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  for (const chave of [rsa, x25519, 'nao-e-base64!', A.chave.slice(0, -4), `${A.chave}AA==`, '']) {
    const p = v3();
    maquinasDe(p)[0].chave = chave;
    const motivo = chave === '' ? 'noctum.envelope.valores-ausentes' : 'noctum.envelope.invalido';
    assert.ok(recusa(() => validarPedidoDeAbertura(p), motivo).length > 0, chave);
  }
  assert.equal(chavePublicaValida(A.chave), A.chave);
  assert.equal(chavePublicaValida(x25519), undefined);
  const nomeRuim = v3();
  maquinasDe(nomeRuim)[1].nome = '-b';
  assert.match(recusa(() => validarPedidoDeAbertura(nomeRuim), 'noctum.envelope.invalido'), /maquinas\[1\]\.nome: letras, dígitos/);
  const nomeRepetido = v3();
  maquinasDe(nomeRepetido)[1].nome = 'MAQUINA-A';
  assert.match(recusa(() => validarPedidoDeAbertura(nomeRepetido), 'noctum.envelope.invalido'), /maquinas\[1\]\.nome: repetido/);
  const chaveRepetida = v3();
  maquinasDe(chaveRepetida)[1].chave = A.chave;
  assert.match(recusa(() => validarPedidoDeAbertura(chaveRepetida), 'noctum.envelope.invalido'), /maquinas\[1\]\.chave: a mesma chave em duas máquinas/);
  const demais = v3();
  demais.maquinas = Array.from({ length: MAXIMO_DE_MAQUINAS + 1 }, (_, i) => ({ nome: `m${i}`, chave: chaveSimulada(`m${i}`) }));
  assert.match(recusa(() => validarPedidoDeAbertura(demais), 'noctum.envelope.invalido'), /maquinas: até 8 por arco/);
  const campo = v3();
  maquinasDe(campo)[0].endereco = 'SIMULADO';
  assert.match(recusa(() => validarPedidoDeAbertura(campo), 'noctum.envelope.invalido'), /maquinas\[0\]\.endereco: campo desconhecido/);
});

test('EV4: máquina presa fora da lista e o mesmo item preso a duas máquinas são recusados; a v2 não conhece a máquina', () => {
  const fora = v3();
  trabalhosDe(fora)[1].maquina = 'maquina-z';
  assert.match(recusa(() => validarPedidoDeAbertura(fora), 'noctum.envelope.invalido'), /trabalhos\[1\]\.maquina: maquina-z não está em maquinas/);
  const doisDonos = v3();
  trabalhosDe(doisDonos).push({ id: 'd', item: 'RM-902', prioridade: 4, dependeDe: [], pedido: 'Outra fatia SIMULADA do RM-902.', maquina: 'maquina-a' });
  assert.match(recusa(() => validarPedidoDeAbertura(doisDonos), 'noctum.envelope.invalido'),
    /o item RM-902 está preso a maquina-b e maquina-a; a reserva do item é de uma máquina só/);
  const semPrender = v3();
  trabalhosDe(semPrender).push({ id: 'd', item: 'RM-902', prioridade: 4, dependeDe: [], pedido: 'Outra fatia SIMULADA do RM-902.' });
  assert.equal(validarPedidoDeAbertura(semPrender).trabalhos!.length, 4, 'o mesmo item sem prender segue a máquina do outro, na distribuição');
  const v2ComMaquina: Record<string, unknown> = { ...v3(), contrato: CONTRATO_ENVELOPE_V2 };
  delete v2ComMaquina.maquinas; delete v2ComMaquina.capacidadeGlobal;
  delete trabalhosDe(v2ComMaquina)[2].maquina;
  assert.match(recusa(() => validarPedidoDeAbertura(v2ComMaquina), 'noctum.envelope.invalido'), /trabalhos\[1\]\.maquina: campo desconhecido/);
  const v2ComMaquinas: Record<string, unknown> = { ...v3(), contrato: CONTRATO_ENVELOPE_V2 };
  trabalhosDe(v2ComMaquinas).forEach(t => { delete t.maquina; });
  const msg = recusa(() => validarPedidoDeAbertura(v2ComMaquinas), 'noctum.envelope.invalido');
  assert.match(msg, /pedido\.maquinas: campo desconhecido/);
  assert.match(msg, /pedido\.capacidadeGlobal: campo desconhecido/);
});

test('EV5: o limite global cobre toda conta do orçamento, nenhuma fora, e não passa da soma dos limites locais', () => {
  const ok = (sessoes: number) => {
    const p = v3();
    p.capacidadeGlobal = { porConta: [{ conta: 'perfil-a', sessoes }] };
    return p;
  };
  // Duas máquinas com 2 sessões cada na conta: até 4 limita (ou empata); 5 não limita nada.
  assert.equal(validarPedidoDeAbertura(ok(4)).capacidadeGlobal!.porConta[0].sessoes, 4);
  assert.match(recusa(() => validarPedidoDeAbertura(ok(5)), 'noctum.envelope.invalido'), /passa da soma dos limites locais da conta \(4\)/);
  assert.match(recusa(() => validarPedidoDeAbertura(ok(0)), 'noctum.envelope.invalido'), /sessoes: inteiro a partir de 1/);
  const fora = v3();
  fora.capacidadeGlobal = { porConta: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-z', sessoes: 1 }] };
  assert.match(recusa(() => validarPedidoDeAbertura(fora), 'noctum.envelope.invalido'), /perfil-z não está no orçamento/);
  const faltando = pedidoV3('arco-v3', { trabalhos: TRABALHOS.map(t => ({ ...t })), maquinas: [A, B],
    contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 1 }], global: [{ conta: 'perfil-a', sessoes: 3 }] });
  assert.match(recusa(() => validarPedidoDeAbertura(faltando), 'noctum.envelope.valores-ausentes'),
    /capacidadeGlobal\.porConta \(perfil-b, que está no orçamento\)/);
});

test('EV6: o resumo que o dono autoriza mostra cada máquina com a impressão da chave, o limite global e a máquina presa', () => {
  const c = validarPedidoDeAbertura(v3());
  const resumo = resumoDoEnvelope(c, hashDoEnvelope(c));
  assert.ok(resumo.includes(`Máquina maquina-a: chave ${impressaoDaChave(A.chave)}`));
  assert.ok(resumo.includes(`Máquina maquina-b: chave ${impressaoDaChave(B.chave)}`));
  assert.match(impressaoDaChave(A.chave), /^[0-9a-f]{16}$/);
  assert.ok(resumo.includes('Sessões ao mesmo tempo na conta perfil-a, somando as máquinas: 3'));
  assert.ok(resumo.some(l => l.startsWith('Trabalho b (RM-902), prioridade 2, depois de a, na máquina maquina-b: abre uma thread')));
  assert.ok(resumo.includes('Trabalho c (RM-903), prioridade 3, na máquina maquina-a: thread ork-simulada'));
  assert.equal(resumo.at(-1), `Hash do envelope: ${hashDoEnvelope(c)}`);
});

test('EV7: as versões autorizadas do arco saem na ordem do log, com a vigente por último', () => {
  const p = projetoTemporario('noctum-ev7');
  try {
    const primeiro = v3();
    const h1 = autorizarPedido(p.dir, 'arco-v3', primeiro);
    // A emenda mantém a janela e muda o que o dono autoriza: aqui, o limite global.
    const emenda = { ...primeiro, capacidadeGlobal: { porConta: [{ conta: 'perfil-a', sessoes: 2 }] } };
    const h2 = autorizarPedido(p.dir, 'arco-v3', emenda);
    assert.notEqual(h1, h2);
    const versoes = versoesAutorizadas(p.dir, 'arco-v3');
    assert.deepEqual(versoes.map(v => [v.versao, v.envelopeSha256]), [[1, h1], [2, h2]]);
    assert.equal(lerArco(p.dir, 'arco-v3')!.envelopeSha256, h2, 'a vigente é a última autorizada');
    assert.deepEqual(versoes[0].conteudo.capacidadeGlobal, { porConta: [{ conta: 'perfil-a', sessoes: 3 }] });
  } finally { p.limpar(); }
});

test('EV8: a emenda não troca o contrato entre a v3 e as outras; dentro da v3, a emenda segue valendo', () => {
  const p = projetoTemporario('noctum-ev8');
  try {
    // A4 da revisão do merge com a N6: o consumo e as sessões da v2 não estão no ramo, e a soma entre máquinas os perderia.
    const v2 = pedidoV2('arco-v2', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' }] });
    autorizarPedido(p.dir, 'arco-v2', v2);
    const paraV3 = { ...v2, contrato: CONTRATO_ENVELOPE_V3, maquinas: [A, B], capacidadeGlobal: { porConta: [{ conta: 'perfil-a', sessoes: 2 }] } };
    assert.match(recusa(() => proporEnvelope(p.dir, paraV3), 'noctum.envelope.invalido'),
      /a emenda não troca o contrato de ork\.noctum-envelope\/v2 para ork\.noctum-envelope\/v3/);
    const comoV3 = v3();
    autorizarPedido(p.dir, 'arco-v3', comoV3);
    const { maquinas: _m, capacidadeGlobal: _g, ...resto } = comoV3;
    const paraV2 = { ...resto, contrato: CONTRATO_ENVELOPE_V2, trabalhos: trabalhosDe(comoV3).filter(t => !t.thread).map(({ maquina: _x, ...t }) => t) };
    assert.match(recusa(() => proporEnvelope(p.dir, paraV2), 'noctum.envelope.invalido'), /a emenda não troca o contrato de ork\.noctum-envelope\/v3/);
    assert.equal(lerArco(p.dir, 'arco-v3')!.conteudo!.contrato, CONTRATO_ENVELOPE_V3, 'a vigente segue a v3');
  } finally { p.limpar(); }
});

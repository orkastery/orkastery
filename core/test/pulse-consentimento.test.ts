/** Todas as identidades e provas deste arquivo são SIMULADAS em diretórios temporários. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirTemporario } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import {
  abrirConsentimento, ALFABETO_DO_CODIGO, ALVO_DO_PULSE, arquivoDoConsentimento, CandidatoDoLote,
  consentimentoVigente, ENDERECO_DA_RESPOSTA, gerarCodigo, interpretarResposta, lerConsentimento,
  marcarLoteEntregue, responderConsentimento, TAMANHO_DO_CODIGO,
} from '../src/pulse-consentimento';

const QUANDO = '2026-09-20T19:00:00.000Z';
const RESUMO = 'a'.repeat(64);
const chave = 'chave-exclusivamente-simulada-nos-testes-000';
const candidatos = (n: number): CandidatoDoLote[] =>
  Array.from({ length: n }, (_, i) => ({ thread: `ork-t${i}`, fase: 'PLAN', motivo: 'human.pending' }));

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY = chave;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** O envelope que o ingresso assina: o endereço do pulse e o texto que o dono digitou. */
function envelope(texto: string, alteracao: Partial<RespostaHumana> = {}): RespostaHumana {
  const r = {
    resposta: texto, origem: 'telegram' as const, por: 'telegram:42',
    mensagem: 'telegram:-7:8', recebidoEm: QUANDO, ...alteracao,
  };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, r, chave) };
}

function comDiretorio<T>(nome: string, corpo: (dir: string) => T): T {
  const dir = dirTemporario(nome), restaurar = ambiente();
  try { return corpo(dir); } finally { restaurar(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('o corpo assinado é o de sempre; muda só o endereço, que é o do pulse e não uma thread', () => {
  const restaurar = ambiente();
  try {
    const r = { resposta: 'P4EJ a', origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:8', recebidoEm: QUANDO };
    // O corpo v1 é esta lista, nesta ordem. O ingresso põe o endereço do pulse nas posições de
    // thread e de pedido, e o texto que o dono digitou na posição de resposta.
    const esperado = createHmac('sha256', chave).update(JSON.stringify([
      'ork.hitl-answer/v1', 'pulse', 'resposta', r.origem, r.por, r.mensagem, r.recebidoEm, r.resposta,
    ])).digest('hex');
    assert.equal(assinaturaDaResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, r, chave), esperado);
    assert.equal(ALVO_DO_PULSE.startsWith('ork-'), false, 'o alvo do pulse não pode colidir com id de thread');
  } finally { restaurar(); }
});

test('o dono responde com o código e a letra, e o identificador longo não sai do núcleo', () => {
  comDiretorio('consent-letra', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, candidatos: candidatos(2), estadoDir: dir });
    assert.equal(pedido.codigo.length, TAMANHO_DO_CODIGO);
    for (const c of pedido.codigo) assert.equal(ALFABETO_DO_CODIGO.includes(c), true, `caractere ambíguo: ${c}`);
    // O identificador longo existe e fica nos dados; ele nunca é o que o dono digita.
    assert.match(pedido.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(pedido.acumuladas, 2);

    const r = responderConsentimento(dir, { codigo: pedido.codigo, envelope: envelope(`${pedido.codigo} a`), quando: QUANDO, estadoDir: dir });
    assert.equal(r.resposta, 'sim');
    assert.equal(r.repetida, false);
    assert.deepEqual(r.pedido.candidatos, candidatos(2));
  });
});

test('a mesma resposta, mesmo por outra mensagem, devolve o que já foi decidido; mudar de ideia é recusado', () => {
  comDiretorio('consent-uso-unico', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, estadoDir: dir });
    const um = envelope(`${pedido.codigo} a`);
    assert.equal(responderConsentimento(dir, { codigo: pedido.codigo, envelope: um, quando: QUANDO, estadoDir: dir }).resposta, 'sim');
    assert.equal(responderConsentimento(dir, { codigo: pedido.codigo, envelope: um, quando: QUANDO, estadoDir: dir }).repetida, true);
    // O dono que não viu o lote chegar manda o sim de novo: é o mesmo sim, não um sim novo.
    const denovo = envelope(`${pedido.codigo} sim`, { mensagem: 'telegram:-7:9' });
    assert.equal(responderConsentimento(dir, { codigo: pedido.codigo, envelope: denovo, quando: QUANDO, estadoDir: dir }).repetida, true);
    // Mudar de ideia sobre o mesmo resumo não reescreve a decisão.
    const outro = envelope(`${pedido.codigo} b`, { mensagem: 'telegram:-7:10' });
    assert.throws(() => responderConsentimento(dir, { codigo: pedido.codigo, envelope: outro, quando: QUANDO, estadoDir: dir }),
      /já respondido; resposta divergente recusada/);
  });
});

test('proveniência vem antes de conteúdo: envelope sem assinatura válida nunca vira sim', () => {
  comDiretorio('consent-prova', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, estadoDir: dir });
    const texto = `${pedido.codigo} a`;
    const falsos: RespostaHumana[] = [
      { ...envelope(texto), prova: '0'.repeat(64) },
      { ...envelope(texto), por: 'telegram:43' },
      { ...envelope(texto), mensagem: 'telegram:-8:8' },
      // O texto trocado depois da assinatura: o ingresso assinou outra coisa.
      { ...envelope(`${pedido.codigo} b`), resposta: texto },
      // Envelope assinado para uma thread e um pedido de verdade não serve como resposta ao pulse.
      (() => {
        const r = { resposta: texto, origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:8', recebidoEm: QUANDO };
        return { ...r, prova: assinaturaDaResposta('ork-i41hitlinver', pedido.id, r, chave) };
      })(),
    ];
    for (const falso of falsos) {
      assert.throws(() => responderConsentimento(dir, { codigo: pedido.codigo, envelope: falso, quando: QUANDO, estadoDir: dir }),
        /proveniência válida|não autenticada/);
    }
    assert.equal(lerConsentimento(dir, dir)!.respondido, undefined);
    // Fora da janela de 60 segundos do ingresso, nem um envelope bem assinado vale.
    assert.throws(() => responderConsentimento(dir, { codigo: pedido.codigo, envelope: envelope(texto),
      quando: '2026-09-20T19:01:01.000Z', estadoDir: dir }), /proveniência válida/);
  });
});

test('"não" e silêncio não perdem item nenhum: o que estava guardado continua em disco', () => {
  comDiretorio('consent-nao', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, candidatos: candidatos(7), estadoDir: dir });
    assert.equal(pedido.acumuladas, 7);
    const r = responderConsentimento(dir, {
      codigo: pedido.codigo, envelope: envelope(`${pedido.codigo} b`), quando: QUANDO, estadoDir: dir,
    });
    assert.equal(r.resposta, 'nao');
    // "Não" não serve lote: não há sim para marcar como entregue.
    assert.throws(() => marcarLoteEntregue(dir, QUANDO, dir, [1]), /não há sim para servir/);
    // O "não" não apaga o pedido nem os candidatos: eles continuam em disco para o próximo resumo.
    assert.equal(lerConsentimento(dir, dir)!.pedido.candidatos.length, 7);

    // Silêncio: o pedido vence e deixa de valer, sem negar e sem perder nada.
    const depois = '2026-09-20T20:30:00.000Z';
    assert.equal(consentimentoVigente(dir, depois, dir), undefined);
    assert.equal(fs.existsSync(arquivoDoConsentimento(dir, dir)), true);
  });
});

test('um sim serve UM lote: marcar entregue duas vezes é recusado', () => {
  comDiretorio('consent-um-lote', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, candidatos: candidatos(1), estadoDir: dir });
    responderConsentimento(dir, { codigo: pedido.codigo, envelope: envelope(`${pedido.codigo} a`), quando: QUANDO, estadoDir: dir });
    marcarLoteEntregue(dir, QUANDO, dir, [1]);
    assert.deepEqual(lerConsentimento(dir, dir)!.respondido!.numeros, [1]);
    assert.throws(() => marcarLoteEntregue(dir, QUANDO, dir, [2]), /já serviu um lote/);
  });
});

test('consentimento vencido não autoriza, e o resumo novo troca o código', () => {
  comDiretorio('consent-prazo', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, prazoMin: 60, estadoDir: dir });
    const tarde = '2026-09-20T20:00:00.000Z';
    assert.throws(() => responderConsentimento(dir, {
      codigo: pedido.codigo, envelope: envelope(`${pedido.codigo} a`, { recebidoEm: tarde }), quando: tarde, estadoDir: dir,
    }), /vencido; nenhuma autorização concedida/);

    // Resumo novo é pergunta nova: o código muda, e o sim ao código antigo não vale para ele.
    const novo = abrirConsentimento(dir, { quando: tarde, resumoSha256: 'b'.repeat(64), estadoDir: dir });
    assert.notEqual(novo.codigo, pedido.codigo);
    assert.throws(() => responderConsentimento(dir, {
      codigo: pedido.codigo, envelope: envelope(`${pedido.codigo} a`, { recebidoEm: tarde }), quando: tarde, estadoDir: dir,
    }), /código não confere/);
  });
});

test('o pedido vigente do mesmo resumo não é substituído: o código não muda debaixo de quem digita', () => {
  comDiretorio('consent-estavel', dir => {
    const um = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, candidatos: candidatos(2), estadoDir: dir });
    const dois = abrirConsentimento(dir, { quando: '2026-09-20T19:05:00.000Z', resumoSha256: RESUMO, candidatos: candidatos(2), estadoDir: dir });
    assert.equal(dois.codigo, um.codigo);
    assert.equal(dois.id, um.id);
    // Resumo novo, ou conjunto novo de perguntas, é pergunta nova: aí o código muda de propósito.
    const tres = abrirConsentimento(dir, { quando: '2026-09-20T19:10:00.000Z', resumoSha256: 'c'.repeat(64), estadoDir: dir });
    assert.notEqual(tres.id, um.id);
    assert.notEqual(tres.codigo, um.codigo);
    const quatro = abrirConsentimento(dir, { quando: '2026-09-20T19:11:00.000Z', resumoSha256: 'c'.repeat(64), candidatos: candidatos(3), estadoDir: dir });
    assert.notEqual(quatro.id, tres.id);
  });
});

test('a leitura da resposta aceita letra, palavra e código na frente, e recusa o resto', () => {
  for (const sim of ['a', 'A', 'sim', 'SIM', ' Sim. ', 's', 'pode', 'manda', 'K3F9 a', 'k3f9 sim']) {
    assert.equal(interpretarResposta(sim, 'K3F9'), 'sim', sim);
  }
  for (const nao of ['b', 'B', 'nao', 'não', 'n', 'agora não', 'K3F9 b']) {
    assert.equal(interpretarResposta(nao, 'K3F9'), 'nao', nao);
  }
  // Só o código, sem escolha, não é resposta: ninguém consente por engano ao colar o código.
  assert.equal(interpretarResposta('K3F9', 'K3F9'), undefined);
  for (const lixo of ['', 'c', '1', 'talvez', 'x'.repeat(65), 42, null]) {
    assert.equal(interpretarResposta(lixo, 'K3F9'), undefined, String(lixo));
  }
});

test('o código curto evita ambíguos, começa por letra, tem dígito, e não repete o que está em uso', () => {
  for (const ambiguo of ['I', 'L', 'O', 'U', '0', '1']) {
    assert.equal(ALFABETO_DO_CODIGO.includes(ambiguo), false, `${ambiguo} é ambíguo no celular`);
  }
  for (let i = 0; i < 300; i++) {
    const c = gerarCodigo(['AAA2']);
    assert.notEqual(c, 'AAA2');
    // Palavra comum de quatro letras nunca tem a forma do código (tem dígito), e o código nunca
    // começa por número, que é como começa a resposta ao lote.
    assert.match(c, /[2-9]/, c);
    assert.match(c, /^[A-Z]/, c);
  }
  const gerado = gerarCodigo();
  assert.equal(gerado.length, TAMANHO_DO_CODIGO);
  assert.match(gerado, new RegExp(`^[${ALFABETO_DO_CODIGO}]{${TAMANHO_DO_CODIGO}}$`));
});

test('código que não confere com o pedido aberto é recusado antes de qualquer conferência', () => {
  comDiretorio('consent-codigo', dir => {
    const pedido = abrirConsentimento(dir, { quando: QUANDO, resumoSha256: RESUMO, estadoDir: dir });
    const outro = pedido.codigo === 'ZZZ9' ? 'YYY9' : 'ZZZ9';
    assert.throws(() => responderConsentimento(dir, { codigo: outro, envelope: envelope(`${outro} a`), quando: QUANDO, estadoDir: dir }),
      /código não confere/);
    // Caixa não importa para o dono: o celular capitaliza sozinho.
    const texto = `${pedido.codigo.toLowerCase()} a`;
    assert.equal(responderConsentimento(dir, {
      codigo: pedido.codigo.toLowerCase(), envelope: envelope(texto), quando: QUANDO, estadoDir: dir,
    }).resposta, 'sim');
  });
});

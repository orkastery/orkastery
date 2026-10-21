/**
 * RM-057 (resposta curta, ork-rm057respost): a pergunta do arco #Noctum ao dono e os atos pela resposta curta.
 *
 * O que se prova aqui, sempre pelo log do arco e pelo recibo, nunca pela palavra de quem chama:
 *  - a proposta nasce com código curto, e o hash fica na pergunta, nunca na resposta;
 *  - o texto da pergunta sai no padrão RM-057, sem hash e sem comando para copiar;
 *  - a resposta curta autoriza e revoga pela prova do canal (o endereço do pulse) ou pelo atestado do terminal, com o
 *    recibo que a conferência antes do efeito relê;
 *  - a pergunta que mudou, a vencida, a prova reaproveitada e o recibo adulterado não autorizam nada;
 *  - b e c não gravam nada no arco, e o diálogo nativo tem as três alternativas;
 *  - GO-FIX 1 (CHECK da ork-rm057respost): a prova do reply é da MESMA pergunta, a mensagem de antes da pergunta não
 *    responde a ela, uma mensagem responde a uma pergunta só (em qualquer arco), e as guardas do ato têm teste (NP18 a NP23);
 *  - GO-FIX 2 (rodada 2 do CHECK, R4): o uso único e a mensagem de antes da pergunta também na revogação, e o registro de
 *    uso único que confere a pergunta e o ato, e não só o arco (NP24 a NP26).
 *
 * Identidades, chaves, provas, sessões e valores SIMULADOS, em diretórios temporários; nenhum canal real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirTemporario, semAutoridadeHitlNoAmbiente } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { lerTrecho } from '../src/hitl-texto-livre';
import { CONTRATO_ENVELOPE, PedidoDeEfeito, RecusaDoArco } from '../src/noctum-envelope';
import { AtestadoDoTerminal, autorizarPelaResposta, codigosDosArcos, conferirAntesDoEfeito, criarDialogoDoArco, lerArco,
  pedirRevogacao, perguntasDoArco, proporEnvelope, ProvaDaRespostaCurta, revogarPelaResposta } from '../src/noctum-arco';
import { ALTERNATIVAS_DE_AUTORIZAR, detalhesDaPergunta, textoDaPerguntaDoArco } from '../src/noctum-pergunta';
import { responderPerguntaDoArco } from '../src/noctum-resposta';
import { ALVO_DO_PULSE, CODIGO_CURTO, enderecoDoPulse } from '../src/pulse-consentimento';
import { TETO_DE_LINHAS_DO_PEDIDO } from '../src/hitl-curto';

semAutoridadeHitlNoAmbiente();
const CHAVE = 'chave-do-hermes-SIMULADA-somente-nos-testes-0000';
process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVE;
process.env.ORK_HITL_TELEGRAM_USERS = '42';
process.env.ORK_HITL_TELEGRAM_CHATS = '-7';

const P = '2026-10-13T00:30:00.000Z'; // proposta, 21:30 em America/Sao_Paulo
const A = '2026-10-13T00:31:00.000Z'; // resposta, dentro do prazo da proposta
const DENTRO = '2026-10-13T02:00:00.000Z';
const VENCIDA = '2026-10-13T01:31:00.000Z'; // depois do prazo de 60 min da proposta
const VELHA = '2026-10-13T00:28:59.000Z'; // dois minutos antes da resposta: fora da janela de 60 s do ingresso
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const pedido = (arco: string, tetoDoArco = 40): Record<string, unknown> => ({
  contrato: CONTRATO_ENVELOPE, arco,
  janela: { inicio: '2026-10-12T22:00:00-03:00', fim: '2026-10-13T06:00:00-03:00', fuso: 'America/Sao_Paulo' },
  destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr'] }],
  orcamento: {
    arco: { valor: tetoDoArco, unidade: 'sessoes' },
    porConta: [{ conta: 'perfil-a', teto: { valor: 20, unidade: 'sessoes' } }],
    porRuntime: [{ runtime: 'claude-bg', teto: { valor: 30, unidade: 'sessoes' } }],
  },
  relatorio: { horario: '07:30', canal: 'telegram' },
});

const efeito = (arco: string, envelopeSha256: string): PedidoDeEfeito =>
  ({ arco, envelopeSha256, acao: 'push', repositorio: 'exemplo/produto', branch: 'ork/trabalho' });

let mensagens = 0;
/** O envelope que o ingresso do Telegram assina no endereço do pulse, com o texto que o dono digitou. */
function noPulse(texto: string, o: { referencia?: string; recebidoEm?: string; chave?: string; mensagem?: string } = {}): RespostaHumana {
  mensagens += 1;
  const r = { resposta: texto, origem: 'telegram' as const, canal: 'hermes' as const, por: 'telegram:42',
    mensagem: o.mensagem ?? `telegram:-7:np-${mensagens}`, recebidoEm: o.recebidoEm ?? A };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, enderecoDoPulse(o.referencia), r, o.chave ?? CHAVE) };
}

/** A prova do pulse que o receptor monta: o envelope, o endereço que o gateway assinou e a resposta lida. */
function provaDoPulse(e: RespostaHumana, codigo: string, o: { referencia?: string; endereco?: string; letra?: 'a' | 'b' | 'c' } = {}): ProvaDaRespostaCurta {
  return { via: 'pulse', envelope: e, endereco: o.endereco ?? enderecoDoPulse(o.referencia),
    pergunta: { codigo, letra: o.letra ?? 'a', respostaSha256: sha(e.resposta) } };
}

/** O atestado que o ingresso do terminal monta depois de conferir a origem da sessão (D5). */
function provaDoTerminal(codigo: string, texto: string, recebidoEm = A): ProvaDaRespostaCurta {
  const atestado: AtestadoDoTerminal = { host: 'claude-code', sessao: '11111111-2222-4333-8444-555555555555', entrypoint: 'cli',
    conferencias: ['presenca', 'id-da-sessao', 'sem-despacho', 'fora-do-registro', 'fora-de-worktree', 'ancestralidade'], recebidoEm };
  return { via: 'terminal', atestado, pergunta: { codigo, letra: 'a', respostaSha256: sha(texto) } };
}

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

function comRaiz<T>(nome: string, corpo: (raiz: string) => T): T {
  const raiz = dirTemporario(`noctum-pergunta-${nome}`);
  fs.mkdirSync(path.join(raiz, '.orkastery'));
  const limpar = () => fs.rmSync(raiz, { recursive: true, force: true });
  try {
    const r = corpo(raiz);
    if (r instanceof Promise) return r.finally(limpar) as T;
    limpar();
    return r;
  } catch (e) { limpar(); throw e; }
}

const linhasDoLog = (raiz: string, arco: string): string[] =>
  fs.readFileSync(path.join(raiz, '.orkastery', 'noctum', 'arcos', arco, 'arco.jsonl'), 'utf8').split('\n').filter(Boolean);

test('NP1: a proposta nasce com código curto, a repetida devolve o mesmo e nenhum código em uso se repete', () => comRaiz('codigo', raiz => {
  const emUso = ['K7QX', 'DE6H', 'P4EJ'];
  const p = proporEnvelope(raiz, pedido('arco-a'), P, emUso);
  assert.ok(p.codigo && CODIGO_CURTO.test(p.codigo), String(p.codigo));
  assert.ok(!emUso.includes(p.codigo!));
  assert.equal(proporEnvelope(raiz, pedido('arco-a'), A).codigo, p.codigo, 'a mesma proposta é a mesma pergunta');
  const outro = proporEnvelope(raiz, pedido('arco-b'), P);
  assert.notEqual(outro.codigo, p.codigo);
  assert.deepEqual(codigosDosArcos(raiz).sort(), [p.codigo!, outro.codigo!].sort());
}));

test('NP2: a pergunta guarda o hash, a versão e o prazo, e a situação segue o log', () => comRaiz('situacao', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const [q] = perguntasDoArco(raiz, 'arco-a', A);
  assert.deepEqual([q.ato, q.codigo, q.versao, q.envelopeSha256, q.prazo, q.situacao], ['autorizar', p.codigo, 1, p.envelopeSha256, p.prazo, 'pendente']);
  assert.equal(lerArco(raiz, 'arco-a', A)!.propostaPendente?.codigo, p.codigo);
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`), p.codigo!), A);
  assert.equal(perguntasDoArco(raiz, 'arco-a', A)[0].situacao, 'respondida');
}));

test('NP3: o texto da pergunta sai no padrão RM-057, sem hash e sem comando para copiar, nos dois canais', () => comRaiz('texto', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const [q] = perguntasDoArco(raiz, 'arco-a', A);
  for (const canal of ['telegram', 'terminal'] as const) {
    const texto = textoDaPerguntaDoArco(q, canal, { quando: A });
    const linhas = texto.split('\n');
    assert.ok(linhas.length <= TETO_DE_LINHAS_DO_PEDIDO, `${canal}: ${linhas.length} linhas`);
    assert.ok(linhas[0].endsWith(`arco arco-a · ${p.codigo}`), linhas[0]);
    assert.ok(linhas.some(l => /Autorizar o arco arco-a \(proposta 1\)\?/.test(l)));
    assert.ok(linhas.some(l => /^a\) Autorizo.*Recomendação/.test(l)), texto);
    assert.equal(linhas.filter(l => /Recomendação/.test(l)).length, 1);
    assert.match(linhas.at(-1)!, canal === 'telegram' ? /^↩️ Responda a, b ou c\./ : /^Responder: a, b ou c no Telegram, ou pela janela de confirmação do host\./);
    assert.equal(texto.includes(p.envelopeSha256), false, 'o hash fica na pergunta, nunca no texto');
    assert.equal(/\/ork|autorizar [a-f0-9]{64}/.test(texto), false);
  }
  assert.match(textoDaPerguntaDoArco(q, 'telegram', { quando: A, numero: 3 }).split('\n')[0], /^🔔 3\. arco arco-a/);
}));

test('NP4: "<código> detalhes" devolve o envelope inteiro, com o hash, e não autoriza nada', () => comRaiz('detalhe', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const [q] = perguntasDoArco(raiz, 'arco-a', A);
  const d = detalhesDaPergunta(q);
  assert.ok(d.includes(`Hash do envelope: ${p.envelopeSha256}`));
  assert.ok(d.includes('Destino exemplo/produto, base main: push, pr'));
  const r = responderPerguntaDoArco(raiz, q, lerTrecho('detalhes')!, { quando: A, canal: 'telegram', provar: () => assert.fail('sem prova') });
  assert.equal(r.tipo, 'detalhe');
  assert.equal(lerArco(raiz, 'arco-a', A)!.situacao, 'proposto');
}));

test('NP5: a resposta curta pelo pulse autoriza, com o recibo do canal que a conferência antes do efeito relê', () => comRaiz('pulse', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const e = noPulse(`${p.codigo} a`);
  const estado = autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(e, p.codigo!), A);
  assert.equal(estado.envelopeSha256, p.envelopeSha256);
  const quem = estado.autorizadoPor as unknown as Record<string, unknown>;
  assert.equal(quem.origem, 'telegram');
  assert.deepEqual(quem.pergunta, { codigo: p.codigo, letra: 'a', respostaSha256: sha(e.resposta),
    enderecoAssinado: { alvo: 'pulse', endereco: 'resposta' } });
  const ok = conferirAntesDoEfeito(raiz, efeito('arco-a', p.envelopeSha256), DENTRO);
  assert.equal(ok.envelopeSha256, p.envelopeSha256);
  const recibo = JSON.parse(fs.readFileSync(path.join(raiz, String(quem.evidencia)), 'utf8'));
  assert.equal(recibo.dados.contrato, 'ork.noctum-ingresso/v1');
  assert.equal(recibo.dados.pergunta.codigo, p.codigo);
  assert.equal(JSON.stringify(recibo).includes(e.resposta), false, 'o texto do dono nunca entra no recibo');
}));

test('NP6: o reply assina resposta:<código>:<id> da MESMA pergunta; endereço trocado, de outra pergunta ou do arco não prova', () => comRaiz('reply', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const assinadoSemReply = noPulse('sim');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(assinadoSemReply, p.codigo!, { referencia: `${p.codigo}:5` }), A),
    'noctum.origem.sem-prova');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(assinadoSemReply, p.codigo!, { endereco: `arco:arco-a` }), A),
    'noctum.origem.sem-prova');
  // GO-FIX 1 (achado 4): o reply assinado à mensagem de OUTRA pergunta não prova a resposta a esta, mesmo autêntico.
  const outra = p.codigo === 'K7QX' ? 'M3PQ' : 'K7QX';
  const aOutra = noPulse('1a', { referencia: `${outra}:9` });
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(aOutra, p.codigo!, { referencia: `${outra}:9` }), A),
    'noctum.origem.sem-prova');
  const emReply = noPulse('sim', { referencia: `${p.codigo}:5` });
  const estado = autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(emReply, p.codigo!, { referencia: `${p.codigo}:5` }), A);
  assert.equal(estado.envelopeSha256, p.envelopeSha256);
  assert.deepEqual((estado.autorizadoPor as unknown as { pergunta: { enderecoAssinado: unknown } }).pergunta.enderecoAssinado,
    { alvo: 'pulse', endereco: `resposta:${p.codigo}:5` });
  assert.throws(() => enderecoDoPulse(p.codigo), /<código>:<mensagem>/, 'o reply sem o id da mensagem respondida não tem endereço');
}));

test('NP7: texto que não é o lido, outra chave e envelope fora da janela de 60 s não autorizam', () => comRaiz('prova', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const e = noPulse(`${p.codigo} a`);
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, { ...provaDoPulse(e, p.codigo!), pergunta: { codigo: p.codigo!, letra: 'a',
    respostaSha256: sha('outro texto') } }, A), 'noctum.origem.sem-prova');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`, {
    chave: 'chave-que-nao-e-a-do-canal-SIMULADA-00000000' }), p.codigo!), A), 'noctum.origem.sem-prova');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`, { recebidoEm: VELHA }), p.codigo!), A),
    'noctum.origem.sem-prova');
  assert.equal(lerArco(raiz, 'arco-a', A)!.situacao, 'proposto');
}));

test('NP8: o recibo do canal adulterado reprova a conferência antes do efeito', () => comRaiz('adulterado', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const estado = autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`), p.codigo!), A);
  const arquivo = path.join(raiz, String((estado.autorizadoPor as unknown as { evidencia: string }).evidencia));
  const v = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  v.dados.pergunta.letra = 'b';
  fs.chmodSync(arquivo, 0o600); fs.writeFileSync(arquivo, JSON.stringify(v));
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', p.envelopeSha256), DENTRO), 'noctum.estado.adulterado');
}));

test('NP9: a pergunta que mudou (proposta nova) recusa o código velho e mostra o novo', () => comRaiz('mudou', raiz => {
  const v1 = proporEnvelope(raiz, pedido('arco-a'), P);
  const v2 = proporEnvelope(raiz, pedido('arco-a', 30), A);
  assert.notEqual(v1.codigo, v2.codigo);
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', v1.codigo!, provaDoPulse(noPulse(`${v1.codigo} a`), v1.codigo!), A), 'noctum.efeito.hash-antigo');
  const situacoes = perguntasDoArco(raiz, 'arco-a', A).map(q => [q.codigo, q.situacao]);
  assert.deepEqual(situacoes, [[v1.codigo, 'substituida'], [v2.codigo, 'pendente']]);
  const [, q1] = [0, perguntasDoArco(raiz, 'arco-a', A)[0]];
  const r = responderPerguntaDoArco(raiz, q1, lerTrecho('a')!, { quando: A, canal: 'telegram', provar: x => provaDoPulse(noPulse(`${x.codigo} a`), x.codigo) });
  assert.equal(r.tipo, 'recusada');
  assert.match(r.mensagem, new RegExp(`A pergunta de agora é ${v2.codigo}`));
}));

test('NP10: depois do prazo, a pergunta venceu e nada é autorizado', () => comRaiz('prazo', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  assert.equal(perguntasDoArco(raiz, 'arco-a', VENCIDA)[0].situacao, 'vencida');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`, { recebidoEm: VENCIDA }), p.codigo!), VENCIDA),
    'noctum.envelope.invalido');
  const [q] = perguntasDoArco(raiz, 'arco-a', VENCIDA);
  const r = responderPerguntaDoArco(raiz, q, lerTrecho('sim')!, { quando: VENCIDA, canal: 'telegram',
    provar: x => provaDoPulse(noPulse('sim', { recebidoEm: VENCIDA }), x.codigo) });
  assert.equal(r.tipo, 'recusada');
  assert.match(r.mensagem, new RegExp(`A pergunta ${p.codigo} venceu`));
  assert.equal(lerArco(raiz, 'arco-a', VENCIDA)!.autorizadoPor, null);
}));

test('NP11: a mesma prova não serve a dois atos, e a resposta repetida não grava de novo', () => comRaiz('repetida', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const e = noPulse(`${p.codigo} a`);
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(e, p.codigo!), A);
  const linhas = linhasDoLog(raiz, 'arco-a').length;
  const info = { repetida: false, mesmaProva: false };
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(e, p.codigo!), A, info);
  assert.deepEqual(info, { repetida: true, mesmaProva: true });
  const outra = { repetida: false, mesmaProva: false };
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse('autorizo', { referencia: `${p.codigo}:5` }), p.codigo!,
    { referencia: `${p.codigo}:5` }), A, outra);
  assert.deepEqual(outra, { repetida: true, mesmaProva: false });
  assert.equal(linhasDoLog(raiz, 'arco-a').length, linhas, 'nenhuma linha nova');
  const rev = pedirRevogacao(raiz, 'arco-a', A);
  const mesmaMensagem = noPulse(`${rev.codigo} a`, { mensagem: e.mensagem });
  recusa(() => revogarPelaResposta(raiz, 'arco-a', rev.codigo, provaDoPulse(mesmaMensagem, rev.codigo), A), 'noctum.origem.sem-prova');
}));

test('NP12: a pergunta de revogação só no arco autorizado, a pendente é reaproveitada e a resposta curta revoga', () => comRaiz('revogar', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  recusa(() => pedirRevogacao(raiz, 'arco-a', A), 'noctum.efeito.sem-autorizacao');
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`), p.codigo!), A);
  const rev = pedirRevogacao(raiz, 'arco-a', A);
  assert.equal(rev.nova, true);
  assert.ok(CODIGO_CURTO.test(rev.codigo) && rev.codigo !== p.codigo);
  assert.deepEqual(pedirRevogacao(raiz, 'arco-a', A), { ...rev, nova: false });
  assert.equal(lerArco(raiz, 'arco-a', A)!.revogacaoPedida?.codigo, rev.codigo);
  assert.equal(lerArco(raiz, 'arco-a', A)!.situacao, 'agendado', 'pedir a revogação não revoga nada');
  const estado = revogarPelaResposta(raiz, 'arco-a', rev.codigo, provaDoPulse(noPulse('sim', { referencia: `${rev.codigo}:6` }), rev.codigo,
    { referencia: `${rev.codigo}:6` }), A);
  assert.equal(estado.situacao, 'revogado');
  assert.deepEqual(perguntasDoArco(raiz, 'arco-a', A).map(q => [q.ato, q.situacao]), [['autorizar', 'respondida'], ['revogar', 'respondida']]);
  recusa(() => pedirRevogacao(raiz, 'arco-a', A), 'noctum.efeito.revogado');
}));

test('NP13: pelo atestado do terminal, a resposta curta autoriza, e o recibo local é relido antes do efeito', () => comRaiz('terminal', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoTerminal(p.codigo!, 'sim', VELHA), A), 'noctum.origem.sem-prova');
  const estado = autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoTerminal(p.codigo!, 'sim'), A);
  const quem = estado.autorizadoPor as unknown as Record<string, unknown>;
  assert.deepEqual([quem.origem, quem.host, quem.por], ['terminal', 'claude-code', 'terminal:claude-code']);
  assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', p.envelopeSha256), DENTRO).envelopeSha256, p.envelopeSha256);
  const arquivo = path.join(raiz, String(quem.evidencia));
  const v = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(v.dados.origem, 'terminal');
  v.dados.conferencias = ['presenca'];
  fs.writeFileSync(arquivo, JSON.stringify(v));
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', p.envelopeSha256), DENTRO), 'noctum.estado.adulterado');
}));

test('NP14: limite conhecido: o atestado do terminal montado à mão no mesmo usuário passa (fronteira da conta do sistema)', () => comRaiz('limite', raiz => {
  // O núcleo confia no atestado que o ingresso do terminal monta no mesmo processo, como o diálogo nativo confia no callback
  // que recebe (A21). Quem roda como o mesmo usuário do sistema monta um igual; separar o núcleo dos agentes é rodá-los em
  // outra conta ou sandbox. Este teste fixa o limite: se ele mudar, a página da RM-058 muda junto.
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const estado = autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoTerminal(p.codigo!, 'qualquer coisa'), A);
  assert.equal(estado.envelopeSha256, p.envelopeSha256);
}));

test('NP15: b (adiar) e c (mudar algo) não gravam nada; "não" é ambíguo e volta com as alternativas', () => comRaiz('sem-efeito', raiz => {
  proporEnvelope(raiz, pedido('arco-a'), P);
  const [q] = perguntasDoArco(raiz, 'arco-a', A);
  const antes = linhasDoLog(raiz, 'arco-a').length;
  const provar = () => assert.fail('b, c e "não" não montam prova');
  for (const [dito, letra] of [['b', 'b'], ['adiar', 'b'], ['c', 'c'], ['recuso', 'c']] as const) {
    const r = responderPerguntaDoArco(raiz, q, lerTrecho(dito)!, { quando: A, canal: 'telegram', provar });
    assert.deepEqual([r.tipo, (r as { letra?: string }).letra], ['sem-efeito', letra], dito);
  }
  const nao = responderPerguntaDoArco(raiz, q, lerTrecho('não')!, { quando: A, canal: 'terminal', provar });
  assert.equal(nao.tipo, 'recusada');
  assert.match(nao.mensagem, /a \(Autorizo\), b \(Adiar\), c \(Mudar algo\)/);
  assert.equal(linhasDoLog(raiz, 'arco-a').length, antes);
  assert.equal(lerArco(raiz, 'arco-a', A)!.situacao, 'proposto');
}));

test('NP16: a resposta curta pela resposta ao arco (noctum-resposta) autoriza e diz até quando vale', () => comRaiz('frase', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  const [q] = perguntasDoArco(raiz, 'arco-a', A);
  const r = responderPerguntaDoArco(raiz, q, lerTrecho('autorizo')!, { quando: A, canal: 'telegram',
    provar: x => provaDoPulse(noPulse('autorizo', { referencia: `${x.codigo}:5` }), x.codigo, { referencia: `${x.codigo}:5` }) });
  assert.equal(r.tipo, 'registrada');
  assert.match(r.mensagem, new RegExp(`^✅ ${p.codigo} → a\\) Autorizo: o arco arco-a está autorizado \\(agendado\\), até `));
}));

test('NP17: o diálogo nativo mostra a pergunta RM-057 com as três alternativas; só a primeira autoriza', async () => {
  await comRaiz('dialogo', async raiz => {
    const p = proporEnvelope(raiz, pedido('arco-a'), P);
    const vistos: Array<{ mensagem: string; opcoes: string[] }> = [];
    const segunda = criarDialogoDoArco(raiz, { host: 'claude-code', connectionId: 'conexao-SIMULADA' }, async a => {
      vistos.push({ mensagem: a.mensagem, opcoes: a.opcoes });
      return { action: 'accept', content: { opcao: a.opcoes[1] } };
    });
    // O prazo do diálogo é o da proposta, e o relógio real passou dele; a proposta nova vale a partir de agora.
    const agora = new Date().toISOString();
    const q = proporEnvelope(raiz, { ...pedido('arco-b'), janela: { inicio: new Date(Date.now() - 3600_000).toISOString(),
      fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' } }, agora);
    await assert.rejects(segunda.autorizar('arco-b', q.envelopeSha256), (e: unknown) => e instanceof RecusaDoArco && e.motivo === 'noctum.origem.sem-prova');
    assert.deepEqual(vistos[0].opcoes, ['a) Autorizo (Recomendação)', 'b) Adiar', 'c) Mudar algo']);
    assert.match(vistos[0].mensagem, /Responda selecionando a opção no diálogo/);
    assert.match(vistos[0].mensagem, new RegExp(`Hash do envelope: ${q.envelopeSha256}`));
    const primeira = criarDialogoDoArco(raiz, { host: 'claude-code', connectionId: 'conexao-SIMULADA' }, async a =>
      ({ action: 'accept', content: { opcao: a.opcoes[0] } }));
    assert.equal((await primeira.autorizar('arco-b', q.envelopeSha256)).envelopeSha256, q.envelopeSha256);
    assert.equal(ALTERNATIVAS_DE_AUTORIZAR.length, 3);
    void p;
  });
});

// GO-FIX 1 (CHECK da ork-rm057respost): as guardas do ato pela resposta curta, uma a uma (mutantes A3, A5, A6b e A7).

test('NP18: a prova que diz responder a outra pergunta não autoriza esta, mesmo autêntica e do mesmo arco', () => comRaiz('outra-pergunta', raiz => {
  const v1 = proporEnvelope(raiz, pedido('arco-a', 40), P);
  const v2 = proporEnvelope(raiz, pedido('arco-a', 400), P);
  assert.notEqual(v1.codigo, v2.codigo);
  const e = noPulse(`${v1.codigo} a`);
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', v2.codigo!, provaDoPulse(e, v1.codigo!), A), 'noctum.origem.sem-prova');
  assert.equal(lerArco(raiz, 'arco-a', A)!.autorizadoPor, null, 'o recibo nunca diz uma pergunta e autoriza outra');
}));

test('NP19: a prova que já autorizou a proposta 1 não autoriza a emenda, mesmo sem o registro das mensagens, e o arco segue legível', () => comRaiz('prova-usada', raiz => {
  const v1 = proporEnvelope(raiz, pedido('arco-a', 40), P);
  const e = noPulse(`${v1.codigo} a`);
  autorizarPelaResposta(raiz, 'arco-a', v1.codigo!, provaDoPulse(e, v1.codigo!), A);
  const v2 = proporEnvelope(raiz, pedido('arco-a', 30), A);
  // O registro das mensagens usadas some (estado perdido): a conferência do log do arco, uma prova para um ato, segura sozinha.
  fs.rmSync(path.join(raiz, '.orkastery', 'noctum', 'mensagens-usadas'), { recursive: true, force: true });
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', v2.codigo!, provaDoPulse(e, v2.codigo!), A), 'noctum.origem.sem-prova');
  const estado = lerArco(raiz, 'arco-a', A)!;
  assert.deepEqual([estado.versao, estado.envelopeSha256], [1, v1.envelopeSha256], 'nada foi gravado, e o log não ficou inutilizado');
}));

test('NP20: a resposta à pergunta de revogação depois do prazo dela não revoga', () => comRaiz('revogar-prazo', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`), p.codigo!), A);
  const rev = pedirRevogacao(raiz, 'arco-a', A);
  const depois = new Date(Date.parse(rev.prazo) + 30_000).toISOString();
  recusa(() => revogarPelaResposta(raiz, 'arco-a', rev.codigo, provaDoPulse(noPulse(`${rev.codigo} a`, { recebidoEm: depois }), rev.codigo), depois),
    'noctum.pergunta.vencida');
  assert.notEqual(lerArco(raiz, 'arco-a', depois)!.situacao, 'revogado');
}));

test('NP21: a resposta à pergunta de revogação substituída não revoga, mesmo dentro do prazo dela', () => comRaiz('revogar-substituida', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`), p.codigo!), A);
  const rev1 = pedirRevogacao(raiz, 'arco-a', A);
  const rev2 = pedirRevogacao(raiz, 'arco-a', new Date(Date.parse(rev1.prazo) + 60_000).toISOString());
  assert.notEqual(rev2.codigo, rev1.codigo);
  // O relógio de quem responde está atrás: dentro do prazo da primeira, que já foi substituída no log.
  const dentroDaPrimeira = '2026-10-13T00:41:00.000Z';
  recusa(() => revogarPelaResposta(raiz, 'arco-a', rev1.codigo, provaDoPulse(noPulse(`${rev1.codigo} a`, { recebidoEm: dentroDaPrimeira }), rev1.codigo),
    dentroDaPrimeira), 'noctum.pergunta.substituida');
  assert.notEqual(lerArco(raiz, 'arco-a', dentroDaPrimeira)!.situacao, 'revogado');
}));

test('NP22: a mesma mensagem assinada não responde a duas perguntas: o segundo arco é recusado dentro dos 60 s', () => comRaiz('uso-unico', raiz => {
  // S6 do CHECK, invertido no núcleo do arco: o mesmo envelope autorizava arco-b 30 s depois de autorizar arco-a.
  const a = proporEnvelope(raiz, pedido('arco-a'), P), b = proporEnvelope(raiz, pedido('arco-b'), P);
  const sim = noPulse('sim');
  autorizarPelaResposta(raiz, 'arco-a', a.codigo!, provaDoPulse(sim, a.codigo!), A);
  const depois = '2026-10-13T00:31:30.000Z';
  recusa(() => autorizarPelaResposta(raiz, 'arco-b', b.codigo!, provaDoPulse(sim, b.codigo!), depois), 'noctum.origem.sem-prova');
  assert.equal(lerArco(raiz, 'arco-b', depois)!.autorizadoPor, null);
  // A mesma mensagem de novo para a MESMA pergunta segue o caminho de sempre: já valia, nada novo no log.
  const info = { repetida: false, mesmaProva: false };
  autorizarPelaResposta(raiz, 'arco-a', a.codigo!, provaDoPulse(sim, a.codigo!), depois, info);
  assert.deepEqual(info, { repetida: true, mesmaProva: true });
  const registro = fs.readdirSync(path.join(raiz, '.orkastery', 'noctum', 'mensagens-usadas'));
  assert.equal(registro.length, 1);
  assert.equal((fs.statSync(path.join(raiz, '.orkastery', 'noctum', 'mensagens-usadas', registro[0])).mode & 0o077), 0, 'arquivo privado');
}));

test('NP23: a mensagem de antes da pergunta não responde a ela, nem dentro da janela de 60 s', () => comRaiz('antes', raiz => {
  const depoisDaMensagem = '2026-10-13T00:31:20.000Z';
  const p = proporEnvelope(raiz, pedido('arco-a'), depoisDaMensagem);
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse('sim'), p.codigo!), depoisDaMensagem),
    'noctum.origem.sem-prova');
  assert.equal(lerArco(raiz, 'arco-a', depoisDaMensagem)!.autorizadoPor, null);
}));

// GO-FIX 2 (rodada 2 do CHECK, R4): as guardas da revogação e do registro de uso único, uma a uma (mutantes X18, X19 e X20).

test('NP24: a mesma mensagem assinada não revoga dois arcos: a segunda revogação é recusada dentro dos 60 s', () => comRaiz('revogar-uso-unico', raiz => {
  const a = proporEnvelope(raiz, pedido('arco-a'), P), b = proporEnvelope(raiz, pedido('arco-b'), P);
  autorizarPelaResposta(raiz, 'arco-a', a.codigo!, provaDoPulse(noPulse(`${a.codigo} a`), a.codigo!), A);
  autorizarPelaResposta(raiz, 'arco-b', b.codigo!, provaDoPulse(noPulse(`${b.codigo} a`), b.codigo!), A);
  const revA = pedirRevogacao(raiz, 'arco-a', A), revB = pedirRevogacao(raiz, 'arco-b', A);
  const sim = noPulse('sim');
  assert.equal(revogarPelaResposta(raiz, 'arco-a', revA.codigo, provaDoPulse(sim, revA.codigo), A).situacao, 'revogado');
  const depois = '2026-10-13T00:31:30.000Z';
  recusa(() => revogarPelaResposta(raiz, 'arco-b', revB.codigo, provaDoPulse(sim, revB.codigo), depois), 'noctum.origem.sem-prova');
  assert.notEqual(lerArco(raiz, 'arco-b', depois)!.situacao, 'revogado');
}));

test('NP25: a mensagem de antes da pergunta de revogação não revoga, nem dentro da janela de 60 s', () => comRaiz('revogar-antes', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  autorizarPelaResposta(raiz, 'arco-a', p.codigo!, provaDoPulse(noPulse(`${p.codigo} a`), p.codigo!), A);
  const depoisDaMensagem = '2026-10-13T00:31:20.000Z';
  const rev = pedirRevogacao(raiz, 'arco-a', depoisDaMensagem);
  recusa(() => revogarPelaResposta(raiz, 'arco-a', rev.codigo, provaDoPulse(noPulse('sim'), rev.codigo), depoisDaMensagem), 'noctum.origem.sem-prova');
  assert.notEqual(lerArco(raiz, 'arco-a', depoisDaMensagem)!.situacao, 'revogado');
}));

test('NP26: a mensagem que respondeu a uma pergunta não responde a outra do MESMO arco, mesmo sem ter gravado ato nenhum', () => comRaiz('uso-unico-pergunta', raiz => {
  // A primeira resposta reivindica a mensagem e não grava nada (a proposta 1 já foi trocada pela 2): o log do arco não tem a
  // prova, e só o registro de uso único, que confere a pergunta e o ato e não só o arco, segura a mesma mensagem na 2.
  const v1 = proporEnvelope(raiz, pedido('arco-a', 40), P);
  const v2 = proporEnvelope(raiz, pedido('arco-a', 30), P);
  assert.notEqual(v1.codigo, v2.codigo);
  const sim = noPulse('sim');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', v1.codigo!, provaDoPulse(sim, v1.codigo!), A), 'noctum.efeito.hash-antigo');
  assert.equal(linhasDoLog(raiz, 'arco-a').filter(l => l.includes('"tipo":"autorizado"')).length, 0, 'nada gravado no log');
  recusa(() => autorizarPelaResposta(raiz, 'arco-a', v2.codigo!, provaDoPulse(sim, v2.codigo!), A), 'noctum.origem.sem-prova');
  assert.equal(lerArco(raiz, 'arco-a', A)!.autorizadoPor, null);
  // Uma mensagem nova responde à pergunta de agora.
  assert.equal(autorizarPelaResposta(raiz, 'arco-a', v2.codigo!, provaDoPulse(noPulse('sim'), v2.codigo!), A).envelopeSha256, v2.envelopeSha256);
}));

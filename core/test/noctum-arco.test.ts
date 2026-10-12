/**
 * RM-058 (N1): estado do arco, ingresso e conferência antes do efeito.
 * Todas as identidades, chaves, provas e valores deste arquivo são SIMULADOS em diretórios temporários.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { dirTemporario, semAutoridadeHitlNoAmbiente } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { chaveLocal } from '../src/hitl-local-receipt';
import { ENV_HITL_VERIFIERS, publicHitlVerifiers } from '../src/hitl-public-receipt';
import { nativeMessage, nativeSignature, NativeAnswer } from '../src/hitl-native';
import { CONTRATO_ENVELOPE, CONTRATO_ENVELOPE_V2, PedidoDeEfeito, RecusaDoArco } from '../src/noctum-envelope';
import * as arcoMod from '../src/noctum-arco';
import {
  ALVO_DO_NOCTUM, autorizarPeloIngresso, concluirDespacho, conferirAntesDoEfeito, contextoDoArco, criarDialogoDoArco, enderecoDoArco,
  enfileirarDecisao, lerArco, PedidoDeDespacho, proporEnvelope, reservarDespacho, revogarPeloIngresso, TEXTO_DE_REVOGACAO,
  textoDeAutorizacao,
} from '../src/noctum-arco';

semAutoridadeHitlNoAmbiente();
const CHAVE = 'chave-do-hermes-SIMULADA-somente-nos-testes-0000';
process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVE;
process.env.ORK_HITL_TELEGRAM_USERS = '42';
process.env.ORK_HITL_TELEGRAM_CHATS = '-7';

const P = '2026-10-13T00:30:00.000Z'; // proposta, 21:30 em America/Sao_Paulo
const A = '2026-10-13T00:31:00.000Z'; // autorização, dentro do prazo da proposta
const ANTES = '2026-10-13T00:59:59.000Z';
const DENTRO = '2026-10-13T02:00:00.000Z';
const FIM = '2026-10-13T09:00:00.000Z'; // 06:00 em America/Sao_Paulo
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

let mensagens = 0;
/** O envelope que o ingresso do Telegram assina, no endereço do arco salvo quando o teste troca. */
function assinado(arco: string, resposta: string, recebidoEm = A, alteracao: Partial<RespostaHumana> = {},
  endereco: [string, string] = [ALVO_DO_NOCTUM, enderecoDoArco(arco)]): RespostaHumana {
  mensagens += 1;
  const r = { resposta, origem: 'telegram' as const, canal: 'hermes' as const, por: 'telegram:42',
    mensagem: `telegram:-7:${mensagens}`, recebidoEm, ...alteracao };
  return { ...r, prova: assinaturaDaResposta(endereco[0], endereco[1], r, CHAVE) };
}

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

async function recusaAssincrona(fn: () => Promise<unknown>, motivo: string): Promise<void> {
  await assert.rejects(fn, (e: unknown) => e instanceof RecusaDoArco && e.motivo === motivo);
}

function comRaiz<T>(nome: string, corpo: (raiz: string) => T): T {
  const raiz = dirTemporario(`noctum-${nome}`);
  fs.mkdirSync(path.join(raiz, '.orkastery'));
  const limpar = () => fs.rmSync(raiz, { recursive: true, force: true });
  try {
    const r = corpo(raiz);
    if (r instanceof Promise) return r.finally(limpar) as T;
    limpar();
    return r;
  } catch (e) { limpar(); throw e; }
}

/** Propõe e autoriza pelo envelope assinado; devolve o hash vigente. */
function abrir(raiz: string, arco: string): string {
  const { envelopeSha256 } = proporEnvelope(raiz, pedido(arco), P);
  autorizarPeloIngresso(raiz, arco, envelopeSha256, assinado(arco, textoDeAutorizacao(envelopeSha256)), A);
  return envelopeSha256;
}

const efeito = (arco: string, envelopeSha256: string, x: Partial<PedidoDeEfeito> = {}): PedidoDeEfeito =>
  ({ arco, envelopeSha256, acao: 'push', repositorio: 'exemplo/produto', branch: 'ork/trabalho', ...x });

const linhasDoLog = (raiz: string, arco: string): string[] =>
  fs.readFileSync(path.join(raiz, '.orkastery', 'noctum', 'arcos', arco, 'arco.jsonl'), 'utf8').split('\n').filter(Boolean);

test('A1: proposta não autoriza nada', () => comRaiz('proposta', raiz => {
  const p = proporEnvelope(raiz, pedido('arco-a'), P);
  assert.match(p.envelopeSha256, /^[a-f0-9]{64}$/);
  assert.equal(p.prazo, '2026-10-13T01:30:00.000Z');
  assert.ok(p.resumo.some(l => l.includes(p.envelopeSha256)));
  const estado = lerArco(raiz, 'arco-a', DENTRO)!;
  assert.equal(estado.situacao, 'proposto');
  assert.equal(estado.envelopeSha256, null);
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', p.envelopeSha256), DENTRO), 'noctum.efeito.sem-autorizacao');
  // A mesma proposta repetida é a mesma pendência, não uma versão nova.
  assert.equal(proporEnvelope(raiz, pedido('arco-a'), P).versao, 1);
  assert.equal(linhasDoLog(raiz, 'arco-a').length, 1);
}));

test('A2: ingresso sem prova não autoriza, por nenhuma das portas', () => comRaiz('sem-prova', raiz => {
  const { envelopeSha256: h } = proporEnvelope(raiz, pedido('arco-a'), P);
  const tentativas: Array<[string, () => unknown]> = [
    ['assinatura falsa', () => autorizarPeloIngresso(raiz, 'arco-a', h, { ...assinado('arco-a', textoDeAutorizacao(h)), prova: 'f'.repeat(64) }, A)],
    ['assinatura de outro arco', () => autorizarPeloIngresso(raiz, 'arco-a', h,
      assinado('arco-b', textoDeAutorizacao(h), A, {}, [ALVO_DO_NOCTUM, enderecoDoArco('arco-b')]), A)],
    ['assinatura de um gate', () => autorizarPeloIngresso(raiz, 'arco-a', h,
      assinado('arco-a', textoDeAutorizacao(h), A, {}, ['ork-simulada', '123e4567-e89b-42d3-a456-426614174000']), A)],
    ['assinatura do pulse', () => autorizarPeloIngresso(raiz, 'arco-a', h,
      assinado('arco-a', textoDeAutorizacao(h), A, {}, ['pulse', 'resposta']), A)],
    ['texto que não autoriza', () => autorizarPeloIngresso(raiz, 'arco-a', h, assinado('arco-a', 'sim'), A)],
    ['texto de outro hash', () => autorizarPeloIngresso(raiz, 'arco-a', h, assinado('arco-a', textoDeAutorizacao('a'.repeat(64))), A)],
    ['fora dos 60 s', () => autorizarPeloIngresso(raiz, 'arco-a', h,
      assinado('arco-a', textoDeAutorizacao(h), '2026-10-13T00:29:59.000Z'), A)],
    ['usuário fora da allowlist', () => autorizarPeloIngresso(raiz, 'arco-a', h,
      assinado('arco-a', textoDeAutorizacao(h), A, { por: 'telegram:43' }), A)],
    ['origem que não é ingresso', () => autorizarPeloIngresso(raiz, 'arco-a', h,
      { ...assinado('arco-a', textoDeAutorizacao(h)), origem: 'mcp-local' } as unknown as RespostaHumana, A)],
    ['canal sem chave no ambiente', () => {
      const env = assinado('arco-a', textoDeAutorizacao(h));
      delete process.env.ORK_HITL_INGRESS_KEY_HERMES;
      try { return autorizarPeloIngresso(raiz, 'arco-a', h, env, A); } finally { process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVE; }
    }],
  ];
  for (const [nome, tentar] of tentativas) {
    assert.doesNotThrow(() => recusa(tentar, 'noctum.origem.sem-prova'), nome);
  }
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.situacao, 'proposto');
  assert.equal(linhasDoLog(raiz, 'arco-a').length, 1, 'nenhuma tentativa gravou linha');
}));

test('A3: o módulo não exporta escritor de autorização sem prova; o diálogo confia no callback do servidor, como criarIngressoLocal', () => {
  // RM-058 N2: reservarDespacho e concluirDespacho gravam despacho, nunca autorização (A30 prova que sem ela nada passa).
  assert.deepEqual(Object.keys(arcoMod).sort(), ['ALVO_DO_NOCTUM', 'CONTRATO_ARCO', 'PRAZO_PARA_AUTORIZAR_MIN',
    'TEXTO_DE_REVOGACAO', 'autorizarPeloIngresso', 'concluirDespacho', 'conferirAntesDoEfeito', 'contextoDoArco', 'criarDialogoDoArco',
    'enderecoDoArco', 'enfileirarDecisao', 'hashDaRevogacao', 'idDaDecisao', 'lerArco', 'proporEnvelope',
    'reservarDespacho', 'revogarPeloIngresso', 'textoDeAutorizacao']);
});

test('A4: autorização com prova vale dentro da janela e registra quem e por qual ingresso', () => comRaiz('autoriza', raiz => {
  const h = abrir(raiz, 'arco-a');
  const estado = lerArco(raiz, 'arco-a', ANTES)!;
  assert.equal(estado.situacao, 'agendado');
  assert.equal(estado.envelopeSha256, h);
  const quem = estado.autorizadoPor as Record<string, unknown>;
  assert.equal(quem.origem, 'telegram');
  assert.equal(quem.canal, 'hermes');
  assert.equal(quem.por, 'telegram:42');
  assert.match(String(quem.recibo), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(estado).includes('"resposta"'), false, 'o texto assinado não é guardado');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), ANTES), 'noctum.efeito.fora-da-janela');
  const ok = conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO);
  assert.equal(ok.ok, true);
  assert.equal(ok.fim, '2026-10-13T06:00:00-03:00');
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.situacao, 'vigente');
}));

test('A5: ação excluída é recusada antes do efeito, mesmo com envelope vigente e hash certo', () => comRaiz('excluida', raiz => {
  const h = abrir(raiz, 'arco-a');
  for (const acao of ['tag', 'publicar', 'producao', 'deploy', 'segredos', 'force-push', 'acao-destrutiva', 'criar-repositorio-publico']) {
    recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h, { acao }), DENTRO), 'noctum.efeito.acao-excluida');
  }
}));

test('A6: emenda autorizada torna o hash anterior antigo; emenda pendente não vale', () => comRaiz('hash', raiz => {
  const v1 = abrir(raiz, 'arco-a');
  const { envelopeSha256: v2, versao } = proporEnvelope(raiz, pedido('arco-a', 30), A);
  assert.equal(versao, 2);
  conferirAntesDoEfeito(raiz, efeito('arco-a', v1), DENTRO);
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', v2), DENTRO), 'noctum.efeito.sem-autorizacao');
  autorizarPeloIngresso(raiz, 'arco-a', v2, assinado('arco-a', textoDeAutorizacao(v2), '2026-10-13T00:31:30.000Z'), '2026-10-13T00:31:40.000Z');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', v1), DENTRO), 'noctum.efeito.hash-antigo');
  assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', v2), DENTRO).versao, 2);
  // A proposta antiga não volta a ser autorizável depois da emenda.
  recusa(() => autorizarPeloIngresso(raiz, 'arco-a', v1, assinado('arco-a', textoDeAutorizacao(v1), '2026-10-13T00:32:00.000Z'),
    '2026-10-13T00:32:00.000Z'), 'noctum.efeito.hash-antigo');
}));

test('A7: revogação vale na chamada seguinte e é terminal', () => comRaiz('revoga', raiz => {
  const h = abrir(raiz, 'arco-a');
  conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO);
  recusa(() => revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', 'sim', DENTRO), DENTRO), 'noctum.origem.sem-prova');
  conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO);
  const revogado = revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO);
  assert.equal(revogado.situacao, 'revogado');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.efeito.revogado');
  recusa(() => proporEnvelope(raiz, pedido('arco-a', 35), DENTRO), 'noctum.efeito.revogado');
}));

test('A8: expiração vale no instante do fim, sem renovação', () => comRaiz('expira', raiz => {
  const h = abrir(raiz, 'arco-a');
  conferirAntesDoEfeito(raiz, efeito('arco-a', h), '2026-10-13T08:59:59.999Z');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), FIM), 'noctum.efeito.expirado');
  assert.equal(lerArco(raiz, 'arco-a', FIM)!.situacao, 'expirado');
  recusa(() => proporEnvelope(raiz, pedido('arco-a'), FIM), 'noctum.envelope.invalido');
}));

test('A9: destino e permissão fora do envelope são recusados', () => comRaiz('destino', raiz => {
  const h = abrir(raiz, 'arco-a');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h, { branch: 'main' }), DENTRO), 'noctum.efeito.fora-do-destino');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h, { repositorio: 'exemplo/outro' }), DENTRO), 'noctum.efeito.fora-do-destino');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h, { acao: 'merge', branch: 'main' }), DENTRO), 'noctum.efeito.fora-do-destino');
  assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h, { acao: 'pr', branch: 'main' }), DENTRO).ok, true);
}));

test('A10: linha adulterada ou forjada reprova toda leitura', () => comRaiz('adultera', raiz => {
  const h = abrir(raiz, 'arco-a');
  const arquivo = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a', 'arco.jsonl');
  const original = fs.readFileSync(arquivo, 'utf8');
  const [primeira, ...resto] = original.split('\n');
  const linha = JSON.parse(primeira);
  linha.dados.evento.conteudo.orcamento.arco.valor = 999;
  fs.writeFileSync(arquivo, [JSON.stringify(linha), ...resto].join('\n'));
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
  recusa(() => lerArco(raiz, 'arco-a', DENTRO), 'noctum.estado.adulterado');
  // Uma revogação apagada deixa o log válido, mas uma autorização forjada sem a chave não passa.
  fs.writeFileSync(arquivo, original);
  const ultima = JSON.parse(original.trim().split('\n').at(-1)!);
  const forjada = { dados: { ...ultima.dados, seq: ultima.dados.seq + 1, anterior: sha(original.trim().split('\n').at(-1)!) },
    mac: 'b'.repeat(64) };
  fs.appendFileSync(arquivo, JSON.stringify(forjada) + '\n');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
  // A autorização de uma história anterior do mesmo arco, com MAC e sequência certos, não serve
  // para a proposta igual feita depois: a cadeia acusa a emenda.
  const autorizacaoAntiga = original.trim().split('\n')[1];
  fs.rmSync(path.dirname(arquivo), { recursive: true });
  assert.equal(proporEnvelope(raiz, pedido('arco-a'), '2026-10-13T00:40:00.000Z').envelopeSha256, h);
  fs.appendFileSync(arquivo, autorizacaoAntiga + '\n');
  recusa(() => lerArco(raiz, 'arco-a', DENTRO), 'noctum.estado.adulterado');
}));

test('A11: restart num processo novo mantém limites, janela e fila, sem resposta inventada', () => comRaiz('restart', raiz => {
  const h = abrir(raiz, 'arco-a');
  const decisao = enfileirarDecisao(raiz, 'arco-a', {
    thread: 'ork-simulada', acaoImpedida: 'merge da branch ork/simulada', dependentes: ['ork-dependente'],
    impacto: 'a entrega da fatia fica parada', pergunta: 'Qual caminho para o merge bloqueado?',
    alternativas: [
      { letra: 'a', texto: 'Rodar a revisão de novo', consequencia: 'a fatia volta ao CHECK', recomendada: true, porque: 'o CI ficou verde depois' },
      { letra: 'b', texto: 'Adiar a fatia', consequencia: 'o item volta para a fila' },
      { letra: 'c', texto: 'Esperar', consequencia: 'nada muda' },
    ],
  }, DENTRO);
  const saida = path.join(raiz, 'saida.json');
  const fd = fs.openSync(saida, 'w');
  const script = [
    `const m = require(${JSON.stringify(require.resolve('../src/noctum-arco'))});`,
    `const raiz = ${JSON.stringify(raiz)}, efeito = ${JSON.stringify(efeito('arco-a', h))};`,
    'const tentar = (q) => { try { return m.conferirAntesDoEfeito(raiz, efeito, q).ok; } catch (e) { return e.motivo; } };',
    `console.log(JSON.stringify({ estado: m.lerArco(raiz, 'arco-a', ${JSON.stringify(DENTRO)}),`,
    `  dentro: tentar(${JSON.stringify(DENTRO)}), fim: tentar(${JSON.stringify(FIM)}) }));`,
  ].join('\n');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ORK_HITL_'))),
    [ENV_HITL_VERIFIERS]: publicHitlVerifiers(process.env)! };
  const r = spawnSync(process.execPath, ['-e', script], { stdio: ['ignore', fd, fd], env, timeout: 30000 });
  fs.closeSync(fd);
  const texto = fs.readFileSync(saida, 'utf8');
  assert.equal(r.status, 0, texto);
  const lido = JSON.parse(texto);
  assert.equal(lido.estado.situacao, 'vigente');
  assert.equal(lido.estado.envelopeSha256, h);
  assert.equal(lido.estado.conteudo.janela.fim, '2026-10-13T06:00:00-03:00');
  assert.deepEqual(lido.estado.conteudo.orcamento.arco, { valor: 40, unidade: 'sessoes' });
  assert.equal(lido.dentro, true);
  assert.equal(lido.fim, 'noctum.efeito.expirado', 'restart não renova o envelope');
  assert.equal(lido.estado.decisoes.length, 1);
  assert.equal(lido.estado.decisoes[0].id, decisao.id);
  assert.equal(lido.estado.decisoes[0].estado, 'pendente');
  assert.equal(Object.hasOwn(lido.estado.decisoes[0], 'resposta'), false, 'nenhuma resposta do dono é inventada');
}));

test('A12: a fila do lote exige 3 a 5 alternativas, uma recomendada, e guarda id estável', () => comRaiz('lote', raiz => {
  const { envelopeSha256 } = proporEnvelope(raiz, pedido('arco-a'), P);
  const item = (x: Record<string, unknown> = {}) => ({
    thread: 'ork-simulada', acaoImpedida: 'push da branch ork/simulada', dependentes: [], impacto: 'a fatia espera',
    pergunta: 'Como seguir com o push impedido?', alternativas: [
      { letra: 'a', texto: 'Seguir sem o push', consequencia: 'a fatia fica local', recomendada: true, porque: 'nada se perde' },
      { letra: 'b', texto: 'Adiar', consequencia: 'o item volta para a fila' },
      { letra: 'c', texto: 'Esperar', consequencia: 'nada muda' },
    ], ...x });
  recusa(() => enfileirarDecisao(raiz, 'arco-a', item(), DENTRO), 'noctum.efeito.sem-autorizacao');
  autorizarPeloIngresso(raiz, 'arco-a', envelopeSha256, assinado('arco-a', textoDeAutorizacao(envelopeSha256)), A);
  const duas = item().alternativas.slice(0, 2);
  recusa(() => enfileirarDecisao(raiz, 'arco-a', item({ alternativas: duas }), DENTRO), 'noctum.envelope.invalido');
  const semRecomendada = item().alternativas.map(({ recomendada: _r, porque: _p, ...a }) => a);
  recusa(() => enfileirarDecisao(raiz, 'arco-a', item({ alternativas: semRecomendada }), DENTRO), 'noctum.envelope.invalido');
  recusa(() => enfileirarDecisao(raiz, 'arco-a', item({ resposta: 'a' }), DENTRO), 'noctum.envelope.invalido');
  const d = enfileirarDecisao(raiz, 'arco-a', item(), DENTRO);
  assert.match(d.id, /^L-[a-f0-9]{12}$/);
  assert.equal(d.estado, 'pendente');
  assert.equal(enfileirarDecisao(raiz, 'arco-a', item({ impacto: 'outro texto' }), DENTRO).id, d.id);
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.decisoes.length, 1);
}));

test('A13: diálogo nativo do host autoriza só quando o dono confirma', async () => comRaiz('dialogo', async raiz => {
  const agora = Date.now();
  const p = pedido('arco-a');
  p.janela = { inicio: new Date(agora - 3600000).toISOString(), fim: new Date(agora + 7 * 3600000).toISOString(), fuso: 'UTC' };
  const { envelopeSha256: h } = proporEnvelope(raiz, p, new Date(agora).toISOString());
  assert.throws(() => criarDialogoDoArco(raiz, { host: 'modelo' as 'codex', connectionId: 'c1' }, async () => ({ action: 'accept' })));
  const recusou = criarDialogoDoArco(raiz, { host: 'claude-code', connectionId: 'c1' }, async () => ({ action: 'decline' }));
  await recusaAssincrona(() => recusou.autorizar('arco-a', h), 'noctum.origem.sem-prova');
  const outraOpcao = criarDialogoDoArco(raiz, { host: 'claude-code', connectionId: 'c1' },
    async () => ({ action: 'accept', content: { opcao: 'Não autorizar' } }));
  await recusaAssincrona(() => outraOpcao.autorizar('arco-a', h), 'noctum.origem.sem-prova');
  const comExtra = criarDialogoDoArco(raiz, { host: 'claude-code', connectionId: 'c1' },
    async a => ({ action: 'accept', content: { opcao: a.opcoes[0], extra: 'x' } as unknown as { opcao: string } }));
  await recusaAssincrona(() => comExtra.autorizar('arco-a', h), 'noctum.origem.sem-prova');
  assert.equal(lerArco(raiz, 'arco-a')!.situacao, 'proposto');
  let visto: arcoMod.ApresentacaoDoArco | undefined;
  const confirmou = criarDialogoDoArco(raiz, { host: 'claude-code', connectionId: 'c1' }, async a => {
    visto = a;
    return { action: 'accept', content: { opcao: a.opcoes[0] } };
  });
  const estado = await confirmou.autorizar('arco-a', h);
  assert.equal(estado.situacao, 'vigente');
  assert.ok(visto!.resumo.some(l => l.includes(h)), 'o dono vê o hash que autoriza');
  const quem = estado.autorizadoPor as Record<string, unknown>;
  assert.equal(quem.origem, 'mcp-local');
  assert.equal(quem.por, 'mcp-local:claude-code');
  assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h)).ok, true, 'a autorização pelo diálogo vale antes do efeito');
  const revogou = await confirmou.revogar('arco-a');
  assert.equal(revogou.situacao, 'revogado');
}));

test('A14: callback nativo autoriza só quando assina o hash, o contexto e o prazo do envelope', () => comRaiz('nativo', raiz => {
  const binding = { host: 'hermes' as const, installationId: 'instalacao-simulada', connectionId: 'conexao-simulada',
    sessionId: 'sessao-simulada', accountId: 'conta-simulada', channelId: 'canal-simulado', conversationId: '7', personId: '42' };
  const chaveNativa = 'chave-nativa-SIMULADA-somente-nos-testes-000000';
  process.env.ORK_HITL_NATIVE_KEY_HERMES = chaveNativa;
  process.env.ORK_HITL_NATIVE_BINDING_HERMES = JSON.stringify(binding);
  try {
    const { envelopeSha256: h, prazo, versao } = proporEnvelope(raiz, pedido('arco-a'), P);
    const resposta = (pedidoSha256: string, messageId: string, context = contextoDoArco('arco-a', versao), expiresAt = prazo): RespostaHumana => {
      const native = { ...binding, messageId, context, pedidoSha256, expiresAt };
      const r: NativeAnswer = { origem: 'native', canal: 'hermes', conta: binding.accountId, native, por: 'native:hermes:42',
        mensagem: nativeMessage(native), recebidoEm: A, resposta: textoDeAutorizacao(h), prova: '' };
      r.prova = nativeSignature(ALVO_DO_NOCTUM, enderecoDoArco('arco-a'), r, chaveNativa);
      return r as unknown as RespostaHumana;
    };
    recusa(() => autorizarPeloIngresso(raiz, 'arco-a', h, resposta('c'.repeat(64), 'm1'), A), 'noctum.origem.sem-prova');
    recusa(() => autorizarPeloIngresso(raiz, 'arco-a', h, resposta(h, 'm3', contextoDoArco('arco-a', versao + 1)), A), 'noctum.origem.sem-prova');
    recusa(() => autorizarPeloIngresso(raiz, 'arco-a', h, resposta(h, 'm4', undefined, '2026-10-13T01:31:00.000Z'), A), 'noctum.origem.sem-prova');
    const estado = autorizarPeloIngresso(raiz, 'arco-a', h, resposta(h, 'm2'), A);
    assert.equal(estado.envelopeSha256, h);
    assert.equal((estado.autorizadoPor as Record<string, unknown>).origem, 'native');
    assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO).ok, true);
    // O vínculo de agora é reconferido pela chave: outra pessoa no mesmo canal não herda a autorização.
    process.env.ORK_HITL_NATIVE_BINDING_HERMES = JSON.stringify({ ...binding, personId: '43' });
    recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
  } finally {
    delete process.env.ORK_HITL_NATIVE_KEY_HERMES;
    delete process.env.ORK_HITL_NATIVE_BINDING_HERMES;
  }
}));

test('A15: a prova do dono é reconferida antes do efeito pelo recibo do canal, com chave ou verificador público', () => comRaiz('recibo', raiz => {
  const h = abrir(raiz, 'arco-a');
  const arcoDir = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a');
  const recibos = fs.readdirSync(path.join(arcoDir, 'ingresso')).sort();
  assert.equal(recibos.length, 2, 'o recibo e o .public ficam ao lado do log');
  assert.ok(recibos.some(n => n.endsWith('.json.public')));
  const verificadores = publicHitlVerifiers(process.env)!;
  delete process.env.ORK_HITL_INGRESS_KEY_HERMES;
  try {
    recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.origem.sem-prova');
    process.env[ENV_HITL_VERIFIERS] = verificadores;
    assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO).ok, true);
    // Sem o .public, o verificador público não tem o que conferir.
    const publico = path.join(arcoDir, 'ingresso', recibos.find(n => n.endsWith('.public'))!);
    const guardado = fs.readFileSync(publico);
    fs.unlinkSync(publico);
    recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
    fs.writeFileSync(publico, guardado, { mode: 0o600 });
    assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO).ok, true);
  } finally {
    process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVE;
    delete process.env[ENV_HITL_VERIFIERS];
  }
}));

test('A16: linha que se diz do Telegram ou do nativo não passa sem o recibo do canal, mesmo com a chave local', () => comRaiz('forja', raiz => {
  abrir(raiz, 'arco-a');
  const { envelopeSha256: v2, versao } = proporEnvelope(raiz, pedido('arco-a', 30), A);
  const arcoDir = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a');
  const arquivo = path.join(arcoDir, 'arco.jsonl');
  // O recibo forjado: mesmo formato, MAC com uma chave que não é a do canal.
  const ingresso = { origem: 'telegram', canal: 'hermes', conta: null, por: 'telegram:42', mensagem: 'telegram:-7:999',
    recebidoEm: A, recibo: 'e'.repeat(64) };
  const dados = { contrato: 'ork.noctum-ingresso/v1', arco: 'arco-a', endereco: enderecoDoArco('arco-a'), ato: 'autorizar',
    envelopeSha256: v2, ...ingresso };
  const bytes = JSON.stringify({ dados, assinatura: createHmac('sha256', 'chave-que-nao-e-do-canal-0000000000').update(JSON.stringify(dados)).digest('hex') });
  const nome = `${sha(ingresso.mensagem)}.json`;
  fs.writeFileSync(path.join(arcoDir, 'ingresso', nome), bytes, { mode: 0o600 });
  // A linha forjada tem MAC certo, porque este atacante leu a chave local do núcleo.
  const subchave = createHmac('sha256', chaveLocal(raiz, false)).update('ork.noctum-arco/v1').digest();
  const linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n');
  const linha = { contrato: 'ork.noctum-arco/v1', arco: 'arco-a', seq: linhas.length + 1, anterior: sha(linhas.at(-1)!), em: A,
    evento: { tipo: 'autorizado', versao, envelopeSha256: v2, ingresso: { ...ingresso,
      evidencia: `.orkastery/noctum/arcos/arco-a/ingresso/${nome}`, evidenciaSha256: sha(bytes) } } };
  fs.appendFileSync(arquivo, JSON.stringify({ dados: linha, mac: createHmac('sha256', subchave).update(JSON.stringify(linha)).digest('hex') }) + '\n');
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.envelopeSha256, v2, 'o log aceita a linha: a guarda é o recibo');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', v2), DENTRO), 'noctum.estado.adulterado');
}));

const pedidoComJanela = (arco: string, inicio: string, fim: string): Record<string, unknown> =>
  ({ ...pedido(arco), janela: { inicio, fim, fuso: 'America/Sao_Paulo' } });

test('A17: cauda incompleta no log não deixa efeito passar, e a revogação do dono ainda grava', () => comRaiz('cauda', raiz => {
  const h = abrir(raiz, 'arco-a');
  const arquivo = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a', 'arco.jsonl');
  // Escrita curta: a revogação falha alto e o log volta byte a byte ao que era; ninguém lê "revogado".
  const nodeFs = require('node:fs') as typeof fs;
  const original = nodeFs.writeSync;
  const antes = fs.readFileSync(arquivo);
  (nodeFs as { writeSync: unknown }).writeSync = (fd: number, dado: unknown, ...resto: unknown[]) =>
    Buffer.isBuffer(dado) && dado.includes('"mac"') ? original(fd, dado.subarray(0, 20))
      : (original as (...a: unknown[]) => number)(fd, dado, ...resto);
  try {
    recusa(() => revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO), 'noctum.estado.adulterado');
  } finally { (nodeFs as { writeSync: unknown }).writeSync = original; }
  assert.deepEqual(fs.readFileSync(arquivo), antes, 'a escrita curta não deixa meia linha');
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.situacao, 'vigente');
  // Cauda rasgada, como a de uma queda no meio da gravação: nenhum efeito passa, e a revogação ainda grava.
  fs.appendFileSync(arquivo, '{"dados":{"meia linha');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.situacao, 'vigente', 'a leitura de estado ignora a cauda, sem autoridade');
  const revogado = revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO);
  assert.equal(revogado.situacao, 'revogado');
  assert.ok(fs.readFileSync(arquivo, 'utf8').endsWith('\n'), 'o escritor descartou a cauda sob o lock');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.efeito.revogado');
}));

test('A18: mensagem já usada e proposta vencida não autorizam', () => comRaiz('reuso', raiz => {
  const { envelopeSha256: v1 } = proporEnvelope(raiz, pedido('arco-a'), P);
  const primeira = assinado('arco-a', textoDeAutorizacao(v1));
  autorizarPeloIngresso(raiz, 'arco-a', v1, primeira, A);
  const { envelopeSha256: v2 } = proporEnvelope(raiz, pedido('arco-a', 30), A);
  // Assinatura válida, mas com a mensagem que já provou a autorização da versão 1.
  const r = { resposta: textoDeAutorizacao(v2), origem: 'telegram' as const, canal: 'hermes' as const, por: 'telegram:42',
    mensagem: primeira.mensagem, recebidoEm: A };
  const reuso = { ...r, prova: assinaturaDaResposta(ALVO_DO_NOCTUM, enderecoDoArco('arco-a'), r, CHAVE) };
  assert.match(recusa(() => autorizarPeloIngresso(raiz, 'arco-a', v2, reuso, A), 'noctum.origem.sem-prova'), /já provou outro ato/);
  const r2 = { ...r, resposta: TEXTO_DE_REVOGACAO };
  const reusoNaRevogacao = { ...r2, prova: assinaturaDaResposta(ALVO_DO_NOCTUM, enderecoDoArco('arco-a'), r2, CHAVE) };
  assert.match(recusa(() => revogarPeloIngresso(raiz, 'arco-a', reusoNaRevogacao, A), 'noctum.origem.sem-prova'), /já provou outro ato/);
  // Uma hora e um minuto depois da proposta, a mesma autorização chega tarde.
  const tarde = '2026-10-13T01:31:00.000Z';
  assert.match(recusa(() => autorizarPeloIngresso(raiz, 'arco-a', v2, assinado('arco-a', textoDeAutorizacao(v2), tarde), tarde),
    'noctum.envelope.invalido'), /proposta vencida/);
  // Proposta feita meia hora antes do fim: dentro do prazo dela, mas depois do fim da janela, não autoriza.
  const { envelopeSha256: b1 } = proporEnvelope(raiz, pedido('arco-b'), '2026-10-13T08:30:00.000Z');
  recusa(() => autorizarPeloIngresso(raiz, 'arco-b', b1, assinado('arco-b', textoDeAutorizacao(b1), '2026-10-13T09:00:00.000Z'),
    '2026-10-13T09:00:30.000Z'), 'noctum.efeito.expirado');
}));

test('A19: ação excluída vem antes de tudo, e o log precisa ser arquivo privado do núcleo', () => comRaiz('ordem', raiz => {
  const { envelopeSha256: h } = proporEnvelope(raiz, pedido('arco-a'), P);
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h, { acao: 'tag' }), DENTRO), 'noctum.efeito.acao-excluida');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-nenhum', h, { acao: 'producao' }), DENTRO), 'noctum.efeito.acao-excluida');
  autorizarPeloIngresso(raiz, 'arco-a', h, assinado('arco-a', textoDeAutorizacao(h)), A);
  revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO);
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h, { acao: 'segredos' }), DENTRO), 'noctum.efeito.acao-excluida');
  const arquivo = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a', 'arco.jsonl');
  fs.chmodSync(arquivo, 0o644);
  recusa(() => lerArco(raiz, 'arco-a', DENTRO), 'noctum.estado.adulterado');
  fs.chmodSync(arquivo, 0o600);
  const ligacao = path.join(raiz, 'outro-nome.jsonl');
  fs.linkSync(arquivo, ligacao);
  recusa(() => lerArco(raiz, 'arco-a', DENTRO), 'noctum.estado.adulterado');
  fs.unlinkSync(ligacao);
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.situacao, 'revogado');
}));

test('A20: emenda não prorroga o fim, não muda o início e não reabre arco que terminou', () => comRaiz('emenda', raiz => {
  abrir(raiz, 'arco-a');
  assert.match(recusa(() => proporEnvelope(raiz, pedidoComJanela('arco-a', '2026-10-12T22:00:00-03:00', '2026-10-13T07:00:00-03:00'), A),
    'noctum.envelope.invalido'), /não prorroga/);
  recusa(() => proporEnvelope(raiz, pedidoComJanela('arco-a', '2026-10-12T23:00:00-03:00', '2026-10-13T06:00:00-03:00'), A),
    'noctum.envelope.invalido');
  assert.equal(proporEnvelope(raiz, pedidoComJanela('arco-a', '2026-10-12T22:00:00-03:00', '2026-10-13T05:00:00-03:00'), A).versao, 2);
  assert.match(recusa(() => proporEnvelope(raiz, pedido('arco-a', 30), '2026-10-13T09:00:00.000Z'), 'noctum.envelope.invalido'),
    /terminou/);
}));

/** Uma linha nova no log com MAC certo, como faria um processo que leu a chave local do núcleo. */
function forjarLinha(raiz: string, arco: string, evento: Record<string, unknown>, em: string): void {
  const arquivo = path.join(raiz, '.orkastery', 'noctum', 'arcos', arco, 'arco.jsonl');
  const subchave = createHmac('sha256', chaveLocal(raiz, false)).update('ork.noctum-arco/v1').digest();
  const linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n');
  const dados = { contrato: 'ork.noctum-arco/v1', arco, seq: linhas.length + 1, anterior: sha(linhas.at(-1)!), em, evento };
  fs.appendFileSync(arquivo, JSON.stringify({ dados, mac: createHmac('sha256', subchave).update(JSON.stringify(dados)).digest('hex') }) + '\n');
}

test('A21: limite conhecido: com a chave local, uma linha que se diz do diálogo do host passa (fronteira da conta do sistema)', () => comRaiz('limite', raiz => {
  const { envelopeSha256: h, versao } = proporEnvelope(raiz, pedido('arco-a'), P);
  forjarLinha(raiz, 'arco-a', { tipo: 'autorizado', versao, envelopeSha256: h, ingresso: { origem: 'mcp-local', host: 'claude-code',
    conexao: 'forjada', solicitacao: '00000000-0000-4000-8000-000000000000', por: 'mcp-local:claude-code', recebidoEm: A,
    respostaSha256: 'f'.repeat(64) } }, A);
  // É o mesmo limite do recibo local do HITL, dito na página da RM-058: este teste o fixa para ninguém vendê-lo como guarda.
  assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO).ok, true);
}));

test('A22: recibo legítimo de outro arco não autoriza este', () => comRaiz('outro-arco', raiz => {
  abrir(raiz, 'arco-b');
  const { envelopeSha256: h, versao } = proporEnvelope(raiz, pedido('arco-a'), P);
  const arcos = path.join(raiz, '.orkastery', 'noctum', 'arcos');
  const autorizacaoB = JSON.parse(fs.readFileSync(path.join(arcos, 'arco-b', 'arco.jsonl'), 'utf8').trim().split('\n')[1]).dados.evento;
  const nome = `${sha(autorizacaoB.ingresso.mensagem)}.json`;
  fs.mkdirSync(path.join(arcos, 'arco-a', 'ingresso'), { mode: 0o700 });
  for (const n of [nome, `${nome}.public`]) {
    fs.copyFileSync(path.join(arcos, 'arco-b', 'ingresso', n), path.join(arcos, 'arco-a', 'ingresso', n));
    fs.chmodSync(path.join(arcos, 'arco-a', 'ingresso', n), 0o600);
  }
  forjarLinha(raiz, 'arco-a', { tipo: 'autorizado', versao, envelopeSha256: h, ingresso: { ...autorizacaoB.ingresso,
    evidencia: `.orkastery/noctum/arcos/arco-a/ingresso/${nome}` } }, A);
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
}));

test('A23: a conta de agora do canal é reconferida, com a chave e com o verificador público', () => comRaiz('conta', raiz => {
  const chaveOpenclaw = 'chave-do-openclaw-SIMULADA-somente-nos-testes-00';
  process.env.ORK_HITL_INGRESS_KEY_OPENCLAW = chaveOpenclaw;
  process.env.ORK_HITL_OPENCLAW_ACCOUNT = 'conta-a';
  try {
    const { envelopeSha256: h } = proporEnvelope(raiz, pedido('arco-a'), P);
    mensagens += 1;
    const r = { resposta: textoDeAutorizacao(h), origem: 'telegram' as const, canal: 'openclaw' as const, conta: 'conta-a',
      por: 'telegram:42', mensagem: `telegram:-7:${mensagens}`, recebidoEm: A };
    autorizarPeloIngresso(raiz, 'arco-a', h, { ...r, prova: assinaturaDaResposta(ALVO_DO_NOCTUM, enderecoDoArco('arco-a'), r, chaveOpenclaw) }, A);
    assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO).ok, true);
    process.env.ORK_HITL_OPENCLAW_ACCOUNT = 'conta-b';
    recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
    const verificadoresDaContaNova = publicHitlVerifiers(process.env)!;
    delete process.env.ORK_HITL_INGRESS_KEY_OPENCLAW;
    process.env[ENV_HITL_VERIFIERS] = verificadoresDaContaNova;
    recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
  } finally {
    delete process.env.ORK_HITL_INGRESS_KEY_OPENCLAW;
    delete process.env.ORK_HITL_OPENCLAW_ACCOUNT;
    delete process.env[ENV_HITL_VERIFIERS];
  }
}));

test('A24: a revogação espera o lock que outro processo segura por um instante', async () => comRaiz('lock', async raiz => {
  abrir(raiz, 'arco-a');
  const lock = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a', '.hitl.lock');
  const filho = spawn('/usr/bin/flock', ['-x', lock, 'sleep', '2'], { stdio: 'ignore' });
  const saiu = new Promise(r => filho.on('exit', r));
  try {
    const limite = Date.now() + 5000;
    while (spawnSync('/usr/bin/flock', ['-n', lock, 'true'], { stdio: 'ignore' }).status === 0 && Date.now() < limite) {
      await new Promise(r => setTimeout(r, 20));
    }
    const inicio = Date.now();
    const revogado = revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO);
    assert.equal(revogado.situacao, 'revogado');
    assert.ok(Date.now() - inicio >= 100, 'a revogação esperou o lock em vez de falhar');
  } finally { filho.kill(); await saiu; }
}));

test('A25: cauda que corta um caractere não trava o arco, e recibo que já existe com outro conteúdo é recusado', () => comRaiz('utf8', raiz => {
  const h = abrir(raiz, 'arco-a');
  const arquivo = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a', 'arco.jsonl');
  fs.appendFileSync(arquivo, Buffer.concat([Buffer.from('{"impacto":"revis', 'utf8'), Buffer.from([0xc3])]));
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', h), DENTRO), 'noctum.estado.adulterado');
  assert.equal(revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO).situacao, 'revogado');
  const { envelopeSha256: b } = proporEnvelope(raiz, pedido('arco-b'), P);
  const envelope = assinado('arco-b', textoDeAutorizacao(b));
  const pasta = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-b', 'ingresso');
  fs.mkdirSync(pasta, { mode: 0o700 });
  fs.writeFileSync(path.join(pasta, `${sha(envelope.mensagem)}.json`), '{"outro":"conteudo"}', { mode: 0o600 });
  recusa(() => autorizarPeloIngresso(raiz, 'arco-b', b, envelope, A), 'noctum.estado.adulterado');
  assert.equal(lerArco(raiz, 'arco-b', DENTRO)!.situacao, 'proposto');
  // O recibo da revogação é auditoria: com ele bloqueado, a revogação grava assim mesmo, com o motivo tipado.
  const h2 = abrir(raiz, 'arco-c');
  const revogacao = assinado('arco-c', TEXTO_DE_REVOGACAO, DENTRO);
  fs.writeFileSync(path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-c', 'ingresso', `${sha(revogacao.mensagem)}.json`),
    '{"outro":"conteudo"}', { mode: 0o600 });
  const revogado = revogarPeloIngresso(raiz, 'arco-c', revogacao, DENTRO);
  assert.equal(revogado.situacao, 'revogado');
  assert.equal((revogado.revogadoPor as Record<string, unknown>).semRecibo, 'noctum.estado.adulterado');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-c', h2), DENTRO), 'noctum.efeito.revogado');
}));

test('A26: a prova de um ato não volta noutra linha do log', () => comRaiz('replay', raiz => {
  const v1 = abrir(raiz, 'arco-a');
  const { envelopeSha256: v2 } = proporEnvelope(raiz, pedido('arco-a', 30), A);
  autorizarPeloIngresso(raiz, 'arco-a', v2, assinado('arco-a', textoDeAutorizacao(v2), '2026-10-13T00:31:30.000Z'), '2026-10-13T00:31:40.000Z');
  const arquivo = path.join(raiz, '.orkastery', 'noctum', 'arcos', 'arco-a', 'arco.jsonl');
  const autorizacaoV1 = JSON.parse(fs.readFileSync(arquivo, 'utf8').trim().split('\n')[1]).dados.evento;
  forjarLinha(raiz, 'arco-a', autorizacaoV1, '2026-10-13T00:32:00.000Z');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-a', v1), DENTRO), 'noctum.estado.adulterado');
}));

// RM-058 (N2, D11 e D12 da ork-rm058n2): conferência antes do despacho, reserva e desfecho no log do arco.

const pedidoV2 = (arco: string, x: { tetoDoArco?: number; unidadeDaConta?: string } = {}): Record<string, unknown> => ({
  ...pedido(arco, x.tetoDoArco ?? 40), contrato: CONTRATO_ENVELOPE_V2,
  orcamento: {
    arco: { valor: x.tetoDoArco ?? 40, unidade: 'sessoes' },
    // O subteto nunca passa do teto do arco na mesma unidade (N1).
    porConta: [{ conta: 'perfil-a', teto: { valor: Math.min(20, x.tetoDoArco ?? 40), unidade: x.unidadeDaConta ?? 'sessoes' } }],
    porRuntime: [{ runtime: 'claude-bg', teto: { valor: Math.min(30, x.tetoDoArco ?? 40), unidade: 'sessoes' } }],
  },
  trabalhos: [
    { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
    { id: 'c', item: 'RM-903', prioridade: 2, dependeDe: ['a'], thread: 'ork-simulada' },
  ],
  capacidade: { maquina: 2, porConta: [{ conta: 'perfil-a', sessoes: 2 }], porRuntime: [{ runtime: 'claude-bg', sessoes: 2 }], revisao: 0 },
});

function abrirV2(raiz: string, arco: string, x: Parameters<typeof pedidoV2>[1] = {}): string {
  const { envelopeSha256 } = proporEnvelope(raiz, pedidoV2(arco, x), P);
  autorizarPeloIngresso(raiz, arco, envelopeSha256, assinado(arco, textoDeAutorizacao(envelopeSha256)), A);
  return envelopeSha256;
}

const despacho = (arco: string, envelopeSha256: string, x: Partial<PedidoDeDespacho> = {}): PedidoDeDespacho =>
  ({ arco, envelopeSha256, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg', conta: 'perfil-a', revisao: false, ...x });

test('A27: o despacho reserva uma sessão sob o lock do arco, e o desfecho conclui ou devolve, uma vez só', () => comRaiz('despacho', raiz => {
  const h = abrirV2(raiz, 'arco-a');
  const r1 = reservarDespacho(raiz, despacho('arco-a', h), DENTRO);
  assert.equal(r1.consumo.arco, 1);
  assert.equal(r1.consumo.porConta['perfil-a'], 1);
  assert.equal(Date.parse(r1.fim), Date.parse(FIM), 'a janela fecha onde o dono disse');
  const concluido = concluirDespacho(raiz, 'arco-a', r1.seq, { thread: 'ork-aberta', sessionId: 'sessao-simulada', idempotente: false }, DENTRO);
  const d1 = concluido.despachos.find(x => x.seq === r1.seq)!;
  assert.equal(d1.desfecho, 'concluido');
  assert.equal(d1.threadDespachada, 'ork-aberta');
  // O segundo desfecho da mesma reserva não grava nada.
  const linhas = linhasDoLog(raiz, 'arco-a').length;
  concluirDespacho(raiz, 'arco-a', r1.seq, { motivo: 'concurrency.limite' }, DENTRO);
  assert.equal(linhasDoLog(raiz, 'arco-a').length, linhas);
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.despachos.find(x => x.seq === r1.seq)!.desfecho, 'concluido');
  // A recusa do núcleo devolve a sessão ao orçamento.
  const r2 = reservarDespacho(raiz, despacho('arco-a', h, { trabalho: 'c', thread: 'ork-simulada', fase: 'PLAN' }), DENTRO);
  assert.equal(r2.consumo.arco, 2);
  const recusado = concluirDespacho(raiz, 'arco-a', r2.seq, { motivo: 'concurrency.limite' }, DENTRO);
  assert.equal(recusado.consumo.arco, 1);
  assert.equal(recusado.despachos.find(x => x.seq === r2.seq)!.motivo, 'concurrency.limite');
  // Restart: um processo novo lê o mesmo consumo do disco.
  const filho = spawnSync(process.execPath, ['-e', `const { lerArco } = require(${JSON.stringify(path.resolve(__dirname, '../src/noctum-arco'))});
    process.stdout.write(JSON.stringify(lerArco(${JSON.stringify(raiz)}, 'arco-a', ${JSON.stringify(DENTRO)}).consumo));`], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(filho.stdout), { arco: 1, porConta: { 'perfil-a': 1 }, porRuntime: { 'claude-bg': 1 } });
}));

test('A28: o orçamento só em sessoes: teto esgotado recusa, e teto em outra unidade recusa por falta de medida', () => comRaiz('orcamento', raiz => {
  const h = abrirV2(raiz, 'arco-a', { tetoDoArco: 2 });
  reservarDespacho(raiz, despacho('arco-a', h), DENTRO);
  const r = reservarDespacho(raiz, despacho('arco-a', h, { trabalho: 'c', thread: 'ork-simulada' }), DENTRO);
  assert.match(recusa(() => reservarDespacho(raiz, despacho('arco-a', h), DENTRO), 'noctum.orcamento.esgotado'),
    /o teto do arco é de 2 sessoes e 2 já foram reservadas/);
  // A reserva recusada pelo núcleo volta, e a vez seguinte cabe de novo.
  concluirDespacho(raiz, 'arco-a', r.seq, { motivo: 'runtime.quota-exhausted' }, DENTRO);
  assert.equal(reservarDespacho(raiz, despacho('arco-a', h), DENTRO).consumo.arco, 2);
  const t = abrirV2(raiz, 'arco-b', { unidadeDaConta: 'tokens' });
  assert.match(recusa(() => reservarDespacho(raiz, despacho('arco-b', t), DENTRO), 'noctum.orcamento.sem-medicao'),
    /o teto da conta perfil-a está em tokens, e a N2 só mede sessoes/);
  assert.equal(lerArco(raiz, 'arco-b', DENTRO)!.despachos.length, 0, 'nada foi reservado');
}));

test('A29: o despacho fora do envelope, da janela ou do hash vigente é recusado antes de reservar', () => comRaiz('fora', raiz => {
  const h = abrirV2(raiz, 'arco-a');
  const casos: Array<[Partial<PedidoDeDespacho>, string, RegExp]> = [
    [{ trabalho: 'z' }, 'noctum.despacho.fora-do-envelope', /o trabalho z não está na lista/],
    [{ trabalho: 'c', thread: 'ork-outra' }, 'noctum.despacho.fora-do-envelope', /o trabalho c é a thread ork-simulada/],
    [{ conta: 'perfil-x' }, 'noctum.despacho.fora-do-envelope', /a conta perfil-x não está no envelope/],
    [{ runtime: 'codex' }, 'noctum.despacho.fora-do-envelope', /o runtime codex não está no envelope/],
    [{ envelopeSha256: 'f'.repeat(64) }, 'noctum.efeito.hash-antigo', /o envelope vigente é/],
    // A2 do CHECK: o trabalho de pedido só despacha a thread aberta para ele, e a entrega nunca sai do arco da N2.
    [{ thread: 'ork-alheia' }, 'noctum.despacho.fora-do-envelope', /a thread ork-alheia não é a do trabalho a: o vínculo é o item RM-901/],
    [{ trabalho: 'c', thread: 'ork-simulada', fase: 'SHIP' }, 'noctum.despacho.fora-do-envelope', /a fase SHIP é entrega/],
    [{ fase: 'MASTER' }, 'noctum.despacho.fora-do-envelope', /a fase MASTER é entrega/],
    // S3 da rodada 2: a reserva que abre a thread de um trabalho de pedido é pelo GOAL.
    [{ fase: 'PLAN' }, 'noctum.despacho.fora-do-envelope', /o trabalho a abre a thread pelo GOAL, não pelo PLAN/],
  ];
  for (const [x, motivo, texto] of casos) assert.match(recusa(() => reservarDespacho(raiz, despacho('arco-a', h, x), DENTRO), motivo), texto);
  recusa(() => reservarDespacho(raiz, despacho('arco-a', h), ANTES), 'noctum.efeito.fora-da-janela');
  recusa(() => reservarDespacho(raiz, despacho('arco-a', h), FIM), 'noctum.efeito.expirado');
  assert.equal(lerArco(raiz, 'arco-a', DENTRO)!.despachos.length, 0);
  // Arco autorizado na v1 não despacha nada.
  const v1 = abrir(raiz, 'arco-v1');
  assert.match(recusa(() => reservarDespacho(raiz, despacho('arco-v1', v1), DENTRO), 'noctum.despacho.fora-do-envelope'), /é v1, sem lista/);
}));

test('A30: sem autorização nada se reserva, e a revogação depois da reserva recusa a seguinte sem apagar a contabilidade', () => comRaiz('revoga', raiz => {
  const { envelopeSha256: h } = proporEnvelope(raiz, pedidoV2('arco-a'), P);
  recusa(() => reservarDespacho(raiz, despacho('arco-a', h), DENTRO), 'noctum.efeito.sem-autorizacao');
  autorizarPeloIngresso(raiz, 'arco-a', h, assinado('arco-a', textoDeAutorizacao(h)), A);
  const r = reservarDespacho(raiz, despacho('arco-a', h), DENTRO);
  revogarPeloIngresso(raiz, 'arco-a', assinado('arco-a', TEXTO_DE_REVOGACAO, DENTRO), DENTRO);
  recusa(() => reservarDespacho(raiz, despacho('arco-a', h, { trabalho: 'c', thread: 'ork-simulada' }), DENTRO), 'noctum.efeito.revogado');
  // O despacho que já estava em voo ainda fecha a contabilidade dele.
  const depois = concluirDespacho(raiz, 'arco-a', r.seq, { thread: 'ork-aberta', sessionId: null, idempotente: true }, DENTRO);
  assert.equal(depois.situacao, 'revogado');
  assert.equal(depois.despachos[0].desfecho, 'concluido');
  assert.equal(depois.consumo.arco, 1);
}));

test('A31: desfecho sem reserva pendente só existe em log emendado, e reprova a leitura', () => comRaiz('desfecho-forjado', raiz => {
  const h = abrirV2(raiz, 'arco-a');
  const r = reservarDespacho(raiz, despacho('arco-a', h), DENTRO);
  concluirDespacho(raiz, 'arco-a', r.seq, { motivo: 'concurrency.limite' }, DENTRO);
  forjarLinha(raiz, 'arco-a', { tipo: 'despacho_concluido', reserva: r.seq, thread: 'ork-x', sessionId: null, idempotente: false }, DENTRO);
  recusa(() => lerArco(raiz, 'arco-a', DENTRO), 'noctum.estado.adulterado');
  recusa(() => reservarDespacho(raiz, despacho('arco-a', h), DENTRO), 'noctum.estado.adulterado');
}));

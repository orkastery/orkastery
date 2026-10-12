/**
 * RM-058 (N1): estado do arco, ingresso e conferência antes do efeito.
 * Todas as identidades, chaves, provas e valores deste arquivo são SIMULADOS em diretórios temporários.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirTemporario, semAutoridadeHitlNoAmbiente } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { nativeMessage, nativeSignature, NativeAnswer } from '../src/hitl-native';
import { CONTRATO_ENVELOPE, PedidoDeEfeito, RecusaDoArco } from '../src/noctum-envelope';
import * as arcoMod from '../src/noctum-arco';
import {
  ALVO_DO_NOCTUM, autorizarPeloIngresso, conferirAntesDoEfeito, contextoDoArco, criarDialogoDoArco, enderecoDoArco,
  enfileirarDecisao, lerArco, proporEnvelope, revogarPeloIngresso, TEXTO_DE_REVOGACAO, textoDeAutorizacao,
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

test('A3: o módulo não exporta escritor de autorização sem prova', () => {
  assert.deepEqual(Object.keys(arcoMod).sort(), ['ALVO_DO_NOCTUM', 'CONTRATO_ARCO', 'PRAZO_PARA_AUTORIZAR_MIN',
    'TEXTO_DE_REVOGACAO', 'autorizarPeloIngresso', 'conferirAntesDoEfeito', 'contextoDoArco', 'criarDialogoDoArco',
    'enderecoDoArco', 'enfileirarDecisao', 'hashDaRevogacao', 'idDaDecisao', 'lerArco', 'proporEnvelope',
    'revogarPeloIngresso', 'textoDeAutorizacao']);
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
  recusa(() => proporEnvelope(raiz, pedido('arco-a', 10), DENTRO), 'noctum.efeito.revogado');
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
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ORK_HITL_')));
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
    const resposta = (pedidoSha256: string, messageId: string): RespostaHumana => {
      const native = { ...binding, messageId, context: contextoDoArco('arco-a', versao), pedidoSha256, expiresAt: prazo };
      const r: NativeAnswer = { origem: 'native', canal: 'hermes', conta: binding.accountId, native, por: 'native:hermes:42',
        mensagem: nativeMessage(native), recebidoEm: A, resposta: textoDeAutorizacao(h), prova: '' };
      r.prova = nativeSignature(ALVO_DO_NOCTUM, enderecoDoArco('arco-a'), r, chaveNativa);
      return r as unknown as RespostaHumana;
    };
    recusa(() => autorizarPeloIngresso(raiz, 'arco-a', h, resposta('c'.repeat(64), 'm1'), A), 'noctum.origem.sem-prova');
    const estado = autorizarPeloIngresso(raiz, 'arco-a', h, resposta(h, 'm2'), A);
    assert.equal(estado.envelopeSha256, h);
    assert.equal((estado.autorizadoPor as Record<string, unknown>).origem, 'native');
  } finally {
    delete process.env.ORK_HITL_NATIVE_KEY_HERMES;
    delete process.env.ORK_HITL_NATIVE_BINDING_HERMES;
  }
}));

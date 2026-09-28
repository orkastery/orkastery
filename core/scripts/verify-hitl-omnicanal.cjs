// D12: o HITL e omnicanal nos quatro hosts homologados, nos dois alvos do contrato.
//
// Este verificador nao repete o que a suite ja prova. Ele guarda as tres coisas que uma
// mudanca futura pode desfazer sem quebrar teste nenhum:
//   1. reduzir a lista de canais, ou deixar um canal sem adaptador em disco;
//   2. deixar a documentacao descrever o HITL por transporte, escondendo canal ou alvo;
//   3. perder o canario que prova os quatro recibos distinguiveis.
// Uso: node core/scripts/verify-hitl-omnicanal.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const ler = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// 1. O registro e o domicilio unico, e os quatro canais tem adaptador real em disco.
const registro = ler('core/src/hitl-canais.ts');
const CANAIS = {
  'claude-code': { transporte: 'mcp-local', adaptador: 'core/src/mcp-server.ts' },
  codex: { transporte: 'mcp-local', adaptador: 'core/src/mcp-server.ts' },
  hermes: { transporte: 'telegram', adaptador: 'adapters/hermes/hitl-ingress/__init__.py' },
  openclaw: { transporte: 'telegram', adaptador: 'adapters/openclaw/src/hitl-ingress.ts' },
};
for (const [canal, { transporte, adaptador }] of Object.entries(CANAIS)) {
  assert.ok(registro.includes(`canal: '${canal}'`), `registro declara o canal ${canal}`);
  assert.ok(registro.includes(`adaptador: '${adaptador}'`), `registro aponta o adaptador de ${canal}`);
  assert.ok(fs.statSync(path.join(root, adaptador)).isFile(), `adaptador em disco: ${adaptador}`);
  assert.ok(registro.includes(`transporte: '${transporte}'`), `registro declara transporte ${transporte}`);
}
// Os dois transportes anteriores a D12 continuam existindo: compatibilidade e requisito.
for (const transporte of ['telegram', 'mcp-local']) {
  assert.ok(registro.includes(`'${transporte}'`), `transporte preservado: ${transporte}`);
}
// Texto de tool nunca e ingresso.
assert.ok(registro.includes('hitl.canal.transcrito-de-tool'), 'registro recusa transcrito de tool');
assert.ok(registro.includes('identidade-ambigua'), 'registro recusa identidade ambigua entre canais');

// 2. Os dois hosts de Telegram assinam o canal, e cada operacao usa a sua flag de stdin.
const openclaw = ler('adapters/openclaw/src/hitl-ingress.ts');
const hermes = ler('adapters/hermes/hitl-ingress/__init__.py');
assert.ok(openclaw.includes("const canal = 'openclaw'"), 'OpenClaw declara o proprio canal');
assert.ok(hermes.includes("CANAL = 'hermes'"), 'Hermes declara o proprio canal');
for (const [nome, fonte] of [['openclaw', openclaw], ['hermes', hermes]]) {
  assert.ok(fonte.includes('ork.hitl-answer/v2'), `${nome} assina o contrato v2`);
  assert.ok(fonte.includes('--canal'), `${nome} declara o canal em argv`);
  assert.ok(fonte.includes('--resposta-stdin') && fonte.includes('--stdin'),
    `${nome} usa a flag de stdin de cada operacao`);
}
// O canal entra no corpo assinado, nao num campo solto ao lado dele.
assert.ok(/ork\.hitl-answer\/v2', thread, pedido, canal/.test(openclaw), 'OpenClaw poe o canal no corpo do HMAC');
assert.ok(/'ork\.hitl-answer\/v2', thread, pedido, CANAL/.test(hermes), 'Hermes poe o canal no corpo do HMAC');

// 3. O nucleo cobre os DOIS alvos do contrato HITL, nao so o gate.
const local = ler('core/src/hitl-local.ts');
assert.ok(!local.includes('hitl.local.somente-gates'), 'ingresso local nao recusa mais pergunta de sessao');
assert.ok(local.includes('responderSessaoLocal'), 'ingresso local despacha resposta de sessao');
const sessoes = ler('core/src/hitl-sessions.ts');
assert.ok(sessoes.includes('export function responderSessaoLocal'), 'resposta de sessao pelo canal local existe');
assert.ok(sessoes.includes('reciboDoAtestado'), 'o recibo da sessao local amarra o conteudo');
const servidor = ler('core/src/mcp-server.ts');
assert.ok(servidor.includes("pedido.respostaAceita.tipo === 'texto'"), 'pergunta aberta nao vira menu');
// O atestado mora em modulo neutro: sem isso volta o ciclo entre ingresso e sessao.
assert.ok(fs.existsSync(path.join(root, 'core/src/hitl-local-atestado.ts')), 'atestado em modulo neutro');
assert.ok(!sessoes.includes("from './hitl-local'"), 'hitl-sessions nao importa hitl-local');

// 4. O canario dos quatro canais existe, com fixture versionada e expectativa fechada.
const caso = JSON.parse(ler('eval/fixtures/fx-omnicanal/caso.json'));
assert.equal(caso.id, 'fx-omnicanal');
assert.equal(caso.esperado.canaisRegistrados, 4, 'o canario espera os quatro canais');
assert.equal(caso.esperado.aprovados, 4, 'os quatro canais respondem');
assert.equal(caso.esperado.canaisDistinguiveis, 4, 'os quatro recibos sao distinguiveis');
assert.equal(caso.esperado.canalPorInferencia, 0, 'nenhum canal sai por inferencia');
assert.equal(caso.esperado.humanosSemIngresso, 0, 'nenhum gate sem ingresso homologado');
assert.ok(caso.sobre.includes('SIMULADA'), 'o canario se declara simulado');

// 5. A narrativa tecnica descreve canal e alvo, e nao promete o que nao foi provado.
const doc = ler('docs/guias/sincronismo-hitl.md');
for (const termo of ['HITL omnicanal nos quatro hosts homologados', 'openclaw', 'hermes',
  'claude-code', 'codex', 'ork.hitl-answer/v2', 'ganha canal por inferência',
  'Pergunta aberta **não vira menu**', 'O que isto NÃO prova', 'SIMULADO']) {
  assert.ok(doc.includes(termo), `narrativa tecnica registra: ${termo}`);
}
assert.ok(!/HITL (so|só|apenas) (pelo|por) Telegram/i.test(doc), 'narrativa nao descreve HITL como so-Telegram');

console.log(JSON.stringify({ claim: 'D12', ok: true, canais: Object.keys(CANAIS).length,
  transportes: 2, alvos: ['gate', 'session'], canario: 'fx-omnicanal',
  alcance: 'registro, adaptadores em disco, cobertura dos dois alvos e narrativa; nao exercita rede nem cliente MCP real' }));

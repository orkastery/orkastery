import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarGateGithub, nomeDecisorioGithub, nomeDiagnosticoGithub,
  type EntradaDoGateGithub } from '../src/ci-fabrica-github';
import { localizadorDoEventoDaFabricaGithub } from '../src/forja/github/pedidos';

const H = 'a'.repeat(40);
const base = (): EntradaDoGateGithub => ({ nivel: 'exigir', repositorio: 'grupo/projeto', destino: 'main',
  baseDoPedido: 'main', head: H, appIdEsperado: 42, evento: 'pull_request', fork: false,
  relacaoComDestino: 'ahead', listaCompleta: true, protecaoClassica: { padrao: 'main', strict: true,
    checks: [{ nome: nomeDecisorioGithub('main'), appId: 42 }] }, rulesets: [] });

test('C121 deriva nome de todos os bytes UTF-8 e publica somente no commit avaliado', () => {
  assert.equal(nomeDecisorioGithub('produção'), 'ork-fabrica/utf8-70726f6475c3a7c3a36f');
  const r = avaliarGateGithub(base());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.publicacao.corpo, { name: nomeDecisorioGithub('main'), head_sha: H,
    status: 'completed', conclusion: 'success' });
});

test('uma fonte estrita própria basta e fonte paralela sem App não a enfraquece', () => {
  const e = base();
  e.rulesets = [{ ativo: true, inclusoes: ['refs/heads/main'], exclusoes: [], strict: false,
    checks: [{ nome: nomeDecisorioGithub('main'), appId: null }] }];
  assert.equal(avaliarGateGithub(e).ok, true);
  e.protecaoClassica!.strict = false;
  assert.equal(avaliarGateGithub(e).ok, false);
  e.rulesets[0].strict = true;
  e.rulesets[0].checks = [];
  assert.equal(avaliarGateGithub(e).ok, false, 'ruleset estrito sem check não conta');
});

test('regra ampla, padrão, diagnóstico exigido, App divergente e destino desatualizado falham fechado', () => {
  const casos = [
    (e: EntradaDoGateGithub) => { e.protecaoClassica!.padrao = '*'; },
    (e: EntradaDoGateGithub) => { e.protecaoClassica!.checks[0].nome = nomeDiagnosticoGithub('main'); },
    (e: EntradaDoGateGithub) => { e.protecaoClassica!.checks[0].appId = 7; },
    (e: EntradaDoGateGithub) => { e.relacaoComDestino = 'behind'; },
    (e: EntradaDoGateGithub) => { e.listaCompleta = false; },
  ];
  for (const mudar of casos) { const e = base(); mudar(e); assert.equal(avaliarGateGithub(e).ok, false); }
  const e = base(); e.protecaoClassica = undefined;
  e.rulesets = [{ ativo: true, inclusoes: ['~ALL'], exclusoes: [], strict: true,
    checks: [{ nome: nomeDecisorioGithub('main'), appId: 42 }] }];
  assert.equal(avaliarGateGithub(e).ok, false);
});

test('observar e avisar usam nome diagnóstico neutro que nunca libera', () => {
  for (const nivel of ['observar', 'avisar'] as const) {
    const e = base(); e.nivel = nivel; e.protecaoClassica = undefined;
    const r = avaliarGateGithub(e);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.decisorio, false); assert.equal(r.nome, nomeDiagnosticoGithub('main'));
      assert.equal(r.publicacao.corpo.conclusion, 'neutral'); }
  }
});

test('troca de base aciona releitura, outro destino ganha outro nome e merge_group é recusado', () => {
  assert.deepEqual(localizadorDoEventoDaFabricaGithub({ evento: 'pull_request', acao: 'edited', numero: 3 }),
    { numero: 3, acao: 'edited' });
  assert.deepEqual(localizadorDoEventoDaFabricaGithub({ evento: 'merge_group' }), { recusado: 'merge_group' });
  assert.notEqual(nomeDecisorioGithub('main'), nomeDecisorioGithub('release'));
  const e = base(); e.baseDoPedido = 'release';
  assert.equal(avaliarGateGithub(e).ok, false);
});

test('colisão sem caixa e recusa da API têm códigos próprios', () => {
  const e = base(); e.nomesExistentes = [nomeDecisorioGithub('main').toUpperCase()];
  const colisao = avaliarGateGithub(e); assert.equal(colisao.ok, false);
  if (!colisao.ok) assert.equal(colisao.codigo, 'ci.fabrica.nome-colidente');
  const r = base(); r.publicacaoAceita = false;
  const recusada = avaliarGateGithub(r); assert.equal(recusada.ok, false);
  if (!recusada.ok) assert.equal(recusada.codigo, 'ci.fabrica.publicacao-recusada');
});

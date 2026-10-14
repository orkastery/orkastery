import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CAPACIDADES } from '../src/forja/adaptador';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';
import { faixaDaVersao, lerMetadados, recusaAbaixoDoPiso, VALIDADE_DO_CACHE_MS } from '../src/forja/versao';
import { api, cliFalsa, gravado, http, login, ok } from './forja-cli-falsa';

const GL = { tipo: 'gitlab' as const, host: 'gitlab.empresa.com', porta: null, caminhoBase: '', ca: null };
const T0 = Date.parse('2026-10-13T12:00:00Z');
const gitlabGravado = (versao: string) => cliFalsa([{ quando: login, responde: ok('') },
  { quando: api('metadata'), responde: http(200, gravado(`gitlab/${versao}/metadata`)) }]);

for (const [versao, faixa] of [['16.11', 'abaixo-do-piso'], ['17.0', 'compativel'], ['18.11', 'compativel'], ['19.2', 'testada'],
  ['19.3', 'testada'], ['19.4', 'testada']] as const) {
  test(`GitLab CE ${versao} gravado: faixa ${faixa}, edição ce`, () => {
    const r = lerMetadados(GL, { cache: null, agoraMs: T0, rodar: gitlabGravado(versao).rodar });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.valor.faixa, faixa);
    assert.equal(r.valor.edicao, 'ce');
    assert.ok(r.valor.versao?.startsWith(`${versao}.`));
    assert.equal(r.valor.doCache, false);
  });
}

test('faixa: acima da janela é compatível, abaixo de 17.0 é recusa, sem versão não tem faixa', () => {
  assert.equal(faixaDaVersao('gitlab', '19.5.0'), 'compativel');
  assert.equal(faixaDaVersao('gitlab', '17.0.0-ee'), 'compativel');
  assert.equal(faixaDaVersao('gitlab', '16.11.10'), 'abaixo-do-piso');
  assert.equal(faixaDaVersao('gitlab', null), 'sem-faixa');
  assert.equal(faixaDaVersao('github', '3.14.2'), 'sem-faixa');
  assert.deepEqual(recusaAbaixoDoPiso('gitlab', { versao: '16.11.10', faixa: 'abaixo-do-piso' }),
    { codigo: 'forja.versao-abaixo-do-piso', detalhe: 'gitlab 16.11.10 < 17.0' });
  assert.equal(recusaAbaixoDoPiso('gitlab', { versao: '17.0.8', faixa: 'compativel' }), null);
});

test('metadata sem version ou sem enterprise é resposta inválida', () => {
  const cli = cliFalsa([{ quando: login, responde: ok('') }, { quando: api('metadata'), responde: http(200, { version: '19.2.7' }) }]);
  const r = lerMetadados(GL, { cache: null, rodar: cli.rodar });
  assert.equal(!r.ok && r.erro.codigo, 'forja.resposta-invalida');
});

test('cache de 24 h: a segunda leitura não chama a CLI; depois de 24 h, chama; cache ilegível é ignorado', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cache-'));
  try {
    const primeira = gitlabGravado('19.2');
    assert.ok(lerMetadados(GL, { cache, agoraMs: T0, rodar: primeira.rodar }).ok);
    const segunda = gitlabGravado('19.3');
    const r = lerMetadados(GL, { cache, agoraMs: T0 + VALIDADE_DO_CACHE_MS - 1, rodar: segunda.rodar });
    assert.ok(r.ok && r.valor.doCache && r.valor.versao === '19.2.7');
    assert.equal(segunda.chamadas.length, 0);
    const outroHost = lerMetadados({ ...GL, host: 'outro.empresa.com' }, { cache, agoraMs: T0, rodar: segunda.rodar });
    assert.ok(outroHost.ok && outroHost.valor.versao === '19.3.5');
    const vencida = lerMetadados(GL, { cache, agoraMs: T0 + VALIDADE_DO_CACHE_MS, rodar: gitlabGravado('19.4').rodar });
    assert.ok(vencida.ok && !vencida.valor.doCache && vencida.valor.versao === '19.4.2');
    fs.writeFileSync(path.join(cache, 'forja.json'), '{ quebrado');
    const ilegivel = lerMetadados(GL, { cache, agoraMs: T0, rodar: gitlabGravado('19.2').rodar });
    assert.ok(ilegivel.ok && !ilegivel.valor.doCache);
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});

test('GitHub: o /meta do GHES dá a versão; o do github.com, nenhuma', () => {
  const gh = (corpo: unknown) => cliFalsa([{ quando: api('meta'), responde: http(200, corpo) }]).rodar;
  const ghes = lerMetadados({ ...GL, tipo: 'github', host: 'ghe.empresa.com' },
    { cache: null, rodar: gh({ verifiable_password_authentication: false, installed_version: '3.14.2' }) });
  assert.ok(ghes.ok);
  assert.deepEqual([ghes.valor.versao, ghes.valor.edicao, ghes.valor.faixa], ['3.14.2', null, 'sem-faixa']);
  const ponto = lerMetadados({ ...GL, tipo: 'github', host: 'github.com' }, { cache: null, rodar: gh({ verifiable_password_authentication: true }) });
  assert.ok(ponto.ok && ponto.valor.versao === null);
});

test('o GitLab é registrado com a capacidade metadados; as outras seguem desligadas', () => {
  assert.equal(typeof exigirCapacidade(adaptadorDaForja('gitlab'), 'metadados'), 'function');
  assert.throws(() => exigirCapacidade(adaptadorDaForja('gitlab'), 'checksNoCommit'), /^Error: forja\.sem-capacidade: gitlab/);
  assert.ok(CAPACIDADES.includes('metadados'));
  for (const c of CAPACIDADES) assert.equal(typeof adaptadorDaForja('github')[c], 'function', c);
});

/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): a validacao do remoto da RM-047 (ainda em
 * "Nao publicado") recusava nome de remoto com `/`, que o git aceita (`git remote add time/origem`).
 * Na 0.5.2 publicada, `fabrica.remoto: time/origem` funcionava: seria uma regressao no proximo pacote.
 *
 * Continua recusado tudo o que a RM-047 fechou: opcao, transporte, URL, caminho absoluto, `..`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buscarBranch, exigirRemoto, remotoValido } from '../src/branch-de-estado';
import { publicarMaquina } from '../src/fabrica-estado';
import { exigirManifesto } from '../src/manifest';
import { exec } from '../src/util';
import { projetoTemporario } from './apoio';

test('suspeitas 03/10: remoto com / (time/origem) vale como no git e na 0.5.2', () => {
  const p = projetoTemporario('susp0310-remoto-barra', true);
  try {
    exec('git', ['remote', 'add', 'time/origem', p.remoto!], p.dir);
    assert.equal(exec('git', ['fetch', '--quiet', '--', 'time/origem'], p.dir).code, 0, 'o git aceita o nome');
    for (const ok of ['time/origem', 'a/b/c', 'fork.1/origin_2']) assert.equal(remotoValido(ok), true, ok);
    assert.equal(publicarMaquina(exigirManifesto(p.dir), { remoto: 'time/origem', maquina: 'pc-a', por: 'Teste' }).acao, 'publicou');
    assert.equal(buscarBranch(p.dir, 'time/origem', 'ork/fabrica-estado', 'fabrica', 15000).atualizado, true);
  } finally { p.limpar(); }
});

test('suspeitas 03/10: a barra nao abre caminho, opcao nem transporte', () => {
  for (const ruim of ['/tmp/repo', 'a//b', 'a/', 'a/-x', 'a/.x', 'a/../b', '../b', './b', 'a/b.', 'ext::sh/x', 'file:///tmp/x', 'a\\b', 'a/b\nc']) {
    assert.equal(remotoValido(ruim), false, JSON.stringify(ruim));
    assert.throws(() => exigirRemoto(ruim, 'fabrica'), /fabrica\.remoto-invalido/, JSON.stringify(ruim));
  }
});

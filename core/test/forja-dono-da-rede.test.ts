/**
 * O dono da casa da rede no GitLab contra as respostas reais gravadas (Tarefa 37): `pessoa` e usuario, `time/sub` e
 * subgrupo de um grupo em que ela e Maintainer (40, herdado), `outro` e grupo em que ela e Developer (30), e o
 * namespace de outro usuario responde 404 a quem nao e admin. O "fora do grupo" (404 no membro) tem a forma medida.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chamadorDaApi } from '../src/forja/api';
import type { ChamadaDaCli } from '../src/forja/executor';
import { adaptadorDaForja } from '../src/forja/registro';
import { api, cliFalsa, gravado, http, login, ok } from './forja-cli-falsa';

const ALVO = { tipo: 'gitlab' as const, host: '127.0.0.1', porta: null, caminhoBase: '', ca: null };
const caminhoDe = (c: ChamadaDaCli, prefixo: string) => c.args.find((a) => a.startsWith(prefixo)) ?? '';

function consultar(versao: string, dono: string, membro: 'membro-do-grupo' | 'membro-sem-nivel' | 404, namespace?: string, trocar?: Record<string, unknown>) {
  const cli = cliFalsa([
    { quando: login, responde: ok('') },
    { quando: (c) => caminhoDe(c, 'namespaces/') !== '', responde: (c) => {
      const caminho = caminhoDe(c, 'namespaces/');
      const caso = namespace ?? (caminho === 'namespaces/pessoa' ? 'namespace-usuario' : caminho === 'namespaces/time%2Fsub' ? 'namespace-grupo'
        : 'namespace-alheio');
      return http(caso === 'namespace-alheio' ? 404 : 200, { ...(gravado(`gitlab/${versao}/${caso}`) as object), ...trocar });
    } },
    { quando: api('user'), responde: http(200, gravado(`gitlab/${versao}/usuario`)) },
    { quando: (c) => /^groups\/\d+\/members\/all\/\d+$/.test(caminhoDe(c, 'groups/')),
      responde: membro === 404 ? http(404, { message: '404 Not found' }) : http(200, gravado(`gitlab/${versao}/${membro}`)) },
  ]);
  const r = adaptadorDaForja('gitlab').donoDaRede!({ api: chamadorDaApi(ALVO, { rodar: cli.rodar, logins: new Map() }), dono });
  return { r, caminhos: cli.chamadas.filter((c) => c.args[0] === 'api').map((c) => c.args.at(-1)) };
}

for (const versao of ['19.4', '17.0']) {
  const ns = (caso: string) => gravado(`gitlab/${versao}/${caso}`) as { id: number; full_path: string };
  const eu = () => gravado(`gitlab/${versao}/usuario`) as { id: number };

  test(`GitLab ${versao}: o próprio usuário é dono sem ler membro nenhum`, () => {
    const { r, caminhos } = consultar(versao, 'pessoa', 404);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.valor, { tipo: 'usuario', caminho: 'pessoa', namespaceId: ns('namespace-usuario').id, nivel: null });
    assert.deepEqual(caminhos, ['namespaces/pessoa', 'user']);
  });

  test(`GitLab ${versao}: subgrupo com o nível herdado da pessoa; Developer e fora do grupo saem com o nível`, () => {
    const maint = consultar(versao, 'time/sub', 'membro-do-grupo');
    assert.ok(maint.r.ok, JSON.stringify(maint.r));
    assert.deepEqual(maint.r.valor, { tipo: 'grupo', caminho: 'time/sub', namespaceId: ns('namespace-grupo').id, nivel: 40 });
    assert.deepEqual(maint.caminhos, ['namespaces/time%2Fsub', 'user', `groups/${ns('namespace-grupo').id}/members/all/${eu().id}`]);
    const dev = consultar(versao, 'time/sub', 'membro-sem-nivel');
    assert.equal(dev.r.ok && dev.r.valor.nivel, 30);
    const fora = consultar(versao, 'time/sub', 404);
    assert.equal(fora.r.ok && fora.r.valor.nivel, 0);
  });

  test(`GitLab ${versao}: namespace de outro usuário é 404, e caminho que não bate é resposta inválida`, () => {
    const alheio = consultar(versao, 'alheia', 404);
    assert.equal(!alheio.r.ok && alheio.r.erro.codigo, 'forja.nao-achei');
    // Token de admin: o namespace de outro usuario vem com 200 e continua recusado.
    const admin = consultar(versao, 'alheia', 404, 'namespace-usuario', { id: 999_999, full_path: 'alheia' });
    assert.equal(!admin.r.ok && admin.r.erro.codigo, 'forja.nao-achei');
    const vazio = consultar(versao, '  ', 404);
    assert.equal(!vazio.r.ok && vazio.r.erro.codigo, 'forja.nao-achei');
    assert.deepEqual(vazio.caminhos, []);
    const trocado = consultar(versao, 'time/sub', 404, 'namespace-usuario');
    assert.equal(!trocado.r.ok && trocado.r.erro.codigo, 'forja.resposta-invalida');
  });
}

test('GitHub: só o próprio login é dono, como a rede sempre fez; organização e outro login são recusados', () => {
  const alvo = { tipo: 'github' as const, host: 'github.com', porta: null, caminhoBase: '', ca: null };
  const dono = (nome: string) => {
    const cli = cliFalsa([
      { quando: login, responde: ok('') },
      { quando: api('user'), responde: http(200, { login: 'Pessoa', id: 7 }) },
    ]);
    return adaptadorDaForja('github').donoDaRede!({ api: chamadorDaApi(alvo, { rodar: cli.rodar, logins: new Map() }), dono: nome });
  };
  const eu = dono('Pessoa');
  assert.ok(eu.ok, JSON.stringify(eu));
  assert.deepEqual(eu.valor, { tipo: 'usuario', caminho: 'Pessoa', namespaceId: 7, nivel: null });
  for (const outro of ['orkastery', 'pessoa', ' ']) {
    const r = dono(outro);
    assert.equal(!r.ok && r.erro.codigo, 'forja.nao-achei', outro);
  }
});

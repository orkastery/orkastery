/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): o `ork_network_status` do servidor MCP
 * fixado num projeto (`redeDoProjetoFixado`) chamava `lerRede` sem limite, que le a fabrica de TODOS
 * os projetos do registro desta maquina e so depois filtra a saida.
 *
 *  - a batida (e a versao do ork) de uma maquina vista na fabrica dos dois projetos vinha da fabrica
 *    do projeto que o servidor nao serve (D5 da RM-052);
 *  - o servidor de um projeto rodava `git fetch` no clone do outro.
 *
 * Projetos, maquinas e fabricas SIMULADOS em remotos bare locais; nenhuma forja.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { publicarMaquina } from '../src/fabrica-estado';
import { exigirManifesto } from '../src/manifest';
import { redeDoProjetoFixado } from '../src/network-roadmap';
import { registrarProjeto } from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario } from './apoio';

function comAmbiente<T>(env: Record<string, string>, f: () => T): T {
  const antes = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return f(); } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/** Um PATH so com o git: nenhuma CLI de forja, nada sai da maquina. */
function soGit(raiz: string): string {
  const dir = path.join(raiz, 'so-git');
  fs.mkdirSync(dir);
  const git = (process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'git')).find((f) => fs.existsSync(f));
  fs.symlinkSync(git!, path.join(dir, 'git'));
  return dir;
}

test('suspeitas 03/10: o MCP fixado nao le a fabrica de outro projeto (batida e git fetch)', () => {
  const u = dirTemporario('susp0310-fixado');
  const a = projetoTemporario('susp0310-fixado-a', true);
  const b = projetoTemporario('susp0310-fixado-b', true);
  try {
    const yaml = path.join(b.dir, 'orkastery.yaml');
    fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('name: "orkastery"', 'name: "time-b"'));
    const velho = new Date(Date.now() - 6 * 3600e3).toISOString(), novo = new Date(Date.now() - 60e3).toISOString();
    comAmbiente({ ORK_USUARIO_DIR: u, ORK_FABRICA_PUBLICAR: '0' }, () => {
      registrarProjeto(a.dir, 'projetos registrar');
      registrarProjeto(b.dir, 'projetos registrar');
      assert.equal(publicarMaquina(exigirManifesto(a.dir), { maquina: 'bob', por: 'Bob', agora: velho }).acao, 'publicou');
      assert.equal(publicarMaquina(exigirManifesto(b.dir), { maquina: 'bob', por: 'Bob', agora: novo }).acao, 'publicou');
    });
    const fetchDeB = path.join(b.dir, '.git', 'FETCH_HEAD');
    fs.rmSync(fetchDeB, { force: true });
    const s = comAmbiente({ ORK_USUARIO_DIR: u, PATH: soGit(u), ORK_BINARIOS_EXTRA: '', ORK_REDE_LER: '1', ORK_MAQUINA: 'eu' },
      () => redeDoProjetoFixado(a.dir));
    assert.equal(fs.existsSync(fetchDeB), false, 'o servidor do projeto a nao buscou nada no clone de time-b');
    const bob = s.membros.find((m) => m.maquina === 'bob');
    assert.ok(bob, `bob esta na fabrica do projeto servido: ${JSON.stringify(s.membros)}`);
    assert.equal(bob.publicadoEm, velho, 'a batida de bob vem da fabrica do projeto servido, nao da de time-b');
    assert.ok(!JSON.stringify(s).includes('time-b'), `nada de time-b na saida: ${JSON.stringify(s)}`);
  } finally { a.limpar(); b.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

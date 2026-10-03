/**
 * Revisao das entregas da madrugada de 03/10 (thread ork-revisaodasen), RM-053 e RM-054:
 *
 *  - sem `maquina-id` local, o retrato de outra instalacao com o nome desta maquina saia como
 *    "(esta maquina)", publicada e sem lacuna; a proxima publicacao recusava com `rede.nome-em-uso`;
 *
 * Casa, maquinas e projetos SIMULADOS; nenhuma forja real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirDoCache } from '../src/rede';
import { lerRede, textoDaRede } from '../src/rede-status';
import { dirTemporario } from './apoio';

function comUsuario<T>(fazer: (u: string) => T): T {
  const u = dirTemporario('rev0310-rede-u');
  const antes = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = u;
  try { return fazer(u); } finally {
    if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes;
    fs.rmSync(u, { recursive: true, force: true });
  }
}

test('revisao 03/10: sem id local, o retrato de outra instalacao com o meu nome e nome em uso, nao "esta maquina"', () => {
  comUsuario((u) => {
    fs.writeFileSync(path.join(u, 'maquina.json'), JSON.stringify({ nome: 'ubuntu', fabricaCompartilhada: true }));
    const casa = { forja: 'github', host: 'github.com', dono: 'julio', repositorio: 'orkastery-network' };
    fs.writeFileSync(path.join(u, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: true, ...casa, atualizadoEm: new Date().toISOString() }));
    const cache = dirDoCache(casa as Parameters<typeof dirDoCache>[0]);
    fs.mkdirSync(path.join(cache, 'maquinas'), { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const g = (...a: string[]) => execFileSync('git', a, { cwd: cache, encoding: 'utf8', env }).trim();
    g('init', '-q'); g('remote', 'add', 'origin', '/nao/existe');
    fs.writeFileSync(path.join(cache, 'maquinas', 'ubuntu.json'), JSON.stringify({ contrato: 'ork.rede-maquina/v1', maquina: 'ubuntu',
      hostname: 'ubuntu', adesao: 'rede', forjas: [], runtimes: [], hosts: [], projetos: [], versaoOrk: '0.1.0',
      publicadoEm: new Date().toISOString(), id: '11111111-2222-4333-8444-555555555555' }));
    g('add', '-A'); g('commit', '-qm', 'x'); g('update-ref', 'refs/remotes/origin/main', 'HEAD');

    const s = lerRede({ semRemoto: true, maquina: 'ubuntu', arquivoDeProjetos: path.join(u, 'nao-existe.json'), diretorio: null });
    assert.equal(s.membros.some((m) => m.maquina === 'ubuntu'), true, 'o retrato da casa foi lido');
    assert.equal(s.estaMaquina.nomeEmUso, true);
    assert.equal(s.estaMaquina.publicada, false);
    assert.ok(s.lacunas.some((l) => l.tipo === 'maquina.nome-em-uso'), JSON.stringify(s.lacunas));
    assert.doesNotMatch(textoDaRede(s), /ubuntu \(esta máquina\)/);
  });
});

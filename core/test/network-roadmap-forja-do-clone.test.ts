import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChamadaDaCli } from '../src/forja/executor';
import { montarPanoramaDaRede, projetosConhecidos } from '../src/network-roadmap';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

/** O clone com o remoto `url` e, se houver, o bloco `forja:` no manifesto. */
function forjaDoClone(nome: string, url: string, bloco?: string) {
  const p = projetoTemporario(nome, false);
  const registro = path.join(dirTemporario(`${nome}-usuario`), 'projetos.json');
  try {
    exec('git', ['remote', 'add', 'origin', url], p.dir);
    if (bloco) fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), `\n${bloco}\n`);
    const { projetos } = projetosConhecidos({ cwd: p.dir, registro });
    assert.equal(projetos.length, 1);
    return projetos[0].forja;
  } finally {
    p.limpar();
    fs.rmSync(path.dirname(registro), { recursive: true, force: true });
  }
}

test('roadmap: o bloco forja: decide o tipo do clone, nunca o nome do host', () => {
  const f = forjaDoClone('rm-forja-gitlab-com-nome-github', 'https://github.empresa.com/g/r.git', 'forja:\n  tipo: gitlab');
  assert.deepEqual(f, { tipo: 'gitlab', host: 'github.empresa.com', repo: 'g/r' });
});

test('roadmap: um GitLab de nome neutro com forja: e lido, com o caminho base, a porta e a CA declarados', () => {
  const f = forjaDoClone('rm-forja-gitlab-neutro', 'https://git.empresa.com:8443/gitlab/g/sub/r.git',
    'forja:\n  tipo: gitlab\n  porta: 8443\n  caminho_base: /gitlab\n  ca: /etc/pki/empresa.pem');
  assert.deepEqual(f, { tipo: 'gitlab', host: 'git.empresa.com', repo: 'g/sub/r', porta: 8443, caminhoBase: '/gitlab', ca: '/etc/pki/empresa.pem' });
});

test('roadmap: o manifesto que contradiz o remoto deixa o clone sem forja', () => {
  assert.equal(forjaDoClone('rm-forja-divergente', 'https://git.empresa.com/g/r.git', 'forja:\n  tipo: gitlab\n  host: outro.empresa.com'), null);
});

test('roadmap: sem o bloco forja:, o github.com e o GitHub Enterprise pelo nome seguem como antes', () => {
  assert.deepEqual(forjaDoClone('rm-forja-github', 'git@github.com:dono/app.git'), { tipo: 'github', host: 'github.com', repo: 'dono/app' });
  assert.deepEqual(forjaDoClone('rm-forja-ghe', 'https://github.empresa.com/dono/app.git'), { tipo: 'github', host: 'github.empresa.com', repo: 'dono/app' });
});

test('roadmap: a porta de um remoto https do GitLab chega ao GITLAB_HOST da CLI, de ponta a ponta', () => {
  const vazio = dirTemporario('rm-porta-vazio');
  const registro = path.join(dirTemporario('rm-porta-usuario'), 'projetos.json');
  try {
    fs.writeFileSync(registro, JSON.stringify({ projetos: [{ nome: 'r', remoto: 'https://gitlab.exemplo.org:8443/g/r.git' }] }));
    const chamadas: ChamadaDaCli[] = [];
    const rodar = (c: ChamadaDaCli) => {
      chamadas.push(c);
      return c.args[0] === 'auth' ? { status: 0, stdout: '', stderr: '' } : { status: 1, stdout: 'HTTP/1.1 502 Bad Gateway\n\n{}', stderr: '' };
    };
    const p = montarPanoramaDaRede({ cwd: vazio, registro, pedido: 'gitlab:gitlab.exemplo.org/g/r', quando: '2026-10-14T12:00:00.000Z',
      maquina: 'pc-a', rede: false, rodarDaForja: rodar, executor: () => { throw new Error('o gh rodou para um GitLab'); } });
    assert.equal(p.projetos.length, 1);
    const daApi = chamadas.filter((c) => c.args[0] === 'api');
    assert.ok(daApi.length > 0, 'a API do GitLab foi chamada');
    assert.ok(chamadas.every((c) => c.acrescentar?.GITLAB_HOST === 'gitlab.exemplo.org:8443'), JSON.stringify(chamadas.map((c) => c.acrescentar?.GITLAB_HOST)));
  } finally {
    fs.rmSync(vazio, { recursive: true, force: true });
    fs.rmSync(path.dirname(registro), { recursive: true, force: true });
  }
});

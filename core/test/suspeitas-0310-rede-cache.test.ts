/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): o `ork network status` (`lerRede`) busca a
 * casa no mesmo cache em que a publicacao grava, sem a trava da publicacao. A suspeita: dois `git
 * fetch` simultaneos disputam o lock da ref `refs/remotes/origin/main`, e o perdedor devolve
 * `atualizado: false`, que na publicacao vira `rede.sem-leitura`.
 *
 * A tentativa: a casa avanca a cada rodada (outra maquina publicou) e varios processos buscam juntos
 * no mesmo cache, com largada sincronizada. Conta quantas buscas falham.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const MODULO = path.resolve(__dirname, '../src/branch-de-estado.js');
const PROCESSOS = 8;
const RODADAS = 15;

const git = (dir: string, args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

function buscaJunta(cache: string): Promise<string> {
  const largada = Date.now() + 700;
  const codigo = `const { buscarBranch } = require(${JSON.stringify(MODULO)}); while (Date.now() < ${largada}) {}` +
    `process.stdout.write(buscarBranch(${JSON.stringify(cache)}, 'origin', 'main', 'rede', 30000).atualizado ? 'T' : 'F');`;
  return Promise.all(Array.from({ length: PROCESSOS }, () => new Promise<string>((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', codigo]);
    let saida = '';
    p.stdout.on('data', (d) => { saida += String(d); });
    p.stderr.on('data', (d) => { saida += String(d); });
    p.on('error', reject);
    p.on('close', () => resolve(saida));
  }))).then((s) => s.join(''));
}

test('suspeitas 03/10: buscas simultaneas no mesmo cache da casa, com a casa avancando, todas atualizam', async () => {
  const raiz = dirTemporario('susp0310-rede-cache');
  try {
    const casa = path.join(raiz, 'casa.git'), outra = path.join(raiz, 'outra'), cache = path.join(raiz, 'cache');
    git(raiz, ['init', '--bare', '-q', '-b', 'main', casa]);
    git(raiz, ['clone', '-q', casa, outra]);
    fs.mkdirSync(cache);
    git(cache, ['init', '-q']);
    git(cache, ['remote', 'add', 'origin', casa]);
    const resultados: string[] = [];
    for (let i = 0; i < RODADAS; i++) {
      fs.writeFileSync(path.join(outra, `m${i}.json`), `{"i":${i}}\n`);
      git(outra, ['add', '.']);
      git(outra, ['commit', '-q', '-m', `rodada ${i}`]);
      git(outra, ['push', '-q', 'origin', 'HEAD:main']);
      resultados.push(await buscaJunta(cache));
    }
    const todas = resultados.join('');
    assert.equal(todas.length, PROCESSOS * RODADAS, `todo processo respondeu: ${resultados.join(' ')}`);
    assert.equal([...todas].filter((c) => c !== 'T').length, 0, `buscas sem leitura nova: ${resultados.join(' ')}`);
    assert.equal(git(cache, ['rev-parse', 'refs/remotes/origin/main']), git(outra, ['rev-parse', 'HEAD']));
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

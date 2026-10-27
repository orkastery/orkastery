import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mergesDaThreadNoGit } from '../src/docs';
import { registrarEntregasPorPr } from '../src/entrega-pr';
import { entregasNaBase } from '../src/fabrica-estado';
import { mergesDasEntregasNaBase } from '../src/merge-da-entrega';
import { entregasDoProjeto } from '../src/parado-no-condutor';
import { novaThread } from '../src/thread';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { commitar, projetoTemporario } from './apoio';

interface Caso {
  thread: string;
  branch: string;
  assunto: string;
}

function git(dir: string, ...args: string[]): string {
  const r = exec('git', args, dir);
  assert.equal(r.ok, true, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function mesclar(dir: string, caso: Caso, n: number): string {
  git(dir, 'checkout', '-q', '-b', caso.branch);
  commitar(dir, `entrega-${n}.txt`, `${caso.thread}\n`, `feat(${caso.thread}): entrega`);
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', caso.branch, '-m', caso.assunto);
  return git(dir, 'rev-parse', 'HEAD');
}

test('reconhece ship e as mensagens padrao reais do GitHub e do GitLab pela branch exata', () => {
  const p = projetoTemporario('merge-padrao-forja');
  const casos: Caso[] = [
    { thread: 'ork-legado', branch: 'ork/ork-legado-go', assunto: 'ship(ork-legado): entrega por PR' },
    { thread: 'ork-orkdocrm067', branch: 'ork/ork-orkdocrm067-go',
      assunto: 'Merge pull request #206 from orkastery/ork/ork-orkdocrm067-go' },
    { thread: 'ork-orkcheck3min', branch: 'ork/ork-orkcheck3min-go',
      assunto: 'Merge pull request #207 from orkastery/ork/ork-orkcheck3min-go' },
    { thread: 'ork-orkretryperf', branch: 'ork/ork-orkretryperf-go',
      assunto: 'Merge pull request #208 from orkastery/ork/ork-orkretryperf-go' },
    { thread: 'ork-gitlab', branch: 'ork/ork-gitlab-go',
      assunto: "Merge branch 'ork/ork-gitlab-go' into 'main'" },
  ];
  try {
    const shas = new Map(casos.map((c, i) => [c.thread, mesclar(p.dir, c, i)]));
    const merges = mergesDasEntregasNaBase(p.dir, 'main', 'main', casos.map(({ thread, branch }) => ({ thread, branch })));
    for (const caso of casos) {
      const merge = merges.get(caso.thread)?.[0];
      assert.equal(merge?.mergeSha, shas.get(caso.thread), caso.assunto);
      assert.match(merge?.headSha ?? '', /^[0-9a-f]{40}$/);
      // A paridade de docs usa o mesmo reconhecedor; sem ledger, a fronteira da branch canonica e o fallback do CI.
      assert.deepEqual(mergesDaThreadNoGit(p.dir, caso.thread, 'main'), [shas.get(caso.thread)]);
    }
  } finally { p.limpar(); }
});

test('recusa Revert, citacao no corpo e branch de thread com prefixo parecido', () => {
  const p = projetoTemporario('merge-padrao-negativos');
  const thread = 'ork-abc';
  const esperada = 'ork/ork-abc-go';
  try {
    git(p.dir, 'commit', '-q', '--allow-empty', '-m', `Revert "ship(${thread}): entrega"`);
    git(p.dir, 'commit', '-q', '--allow-empty', '-m', 'docs: nota', '-m', `Depois do ship(${thread}), revisar.`);
    mesclar(p.dir, { thread: 'ork-abcd', branch: 'ork/ork-abcd-go',
      assunto: 'Merge pull request #209 from orkastery/ork/ork-abcd-go' }, 1);

    const merges = mergesDasEntregasNaBase(p.dir, 'main', 'main', [{ thread, branch: esperada }]);
    assert.deepEqual(merges.get(thread), []);
    assert.deepEqual(mergesDaThreadNoGit(p.dir, thread, 'main'), []);
  } finally { p.limpar(); }
});

test('preserva o candidato ship de um pai para a recusa entrega.sem-vinculo', () => {
  const p = projetoTemporario('merge-padrao-sem-vinculo');
  const thread = 'ork-squash';
  try {
    git(p.dir, 'commit', '-q', '--allow-empty', '-m', `ship(${thread}): squash`);
    const sha = git(p.dir, 'rev-parse', 'HEAD');
    const merge = mergesDasEntregasNaBase(p.dir, 'main', 'main', [{ thread, branch: 'ork/ork-squash-go' }]).get(thread)?.[0];
    assert.deepEqual(merge && [merge.mergeSha, merge.headSha], [sha, null]);
  } finally { p.limpar(); }
});

test('--todas reconhece o merge padrao pela branch registrada no ledger', () => {
  const p = projetoTemporario('merge-padrao-todas', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'entrega padrão', modo: 'auto' });
    const branch = branchDaWorktree(thread);
    git(p.dir, 'checkout', '-q', '-b', branch);
    commitar(p.dir, 'entrega.txt', 'pronta\n', `feat(${thread.id}): entrega`);
    git(p.dir, 'checkout', '-q', 'main');
    git(p.dir, 'merge', '-q', '--no-ff', branch, '-m', `Merge pull request #210 from orkastery/${branch}`);
    git(p.dir, 'push', '-q', 'origin', 'main');

    const r = registrarEntregasPorPr(p.carregado, { dryRun: true });
    assert.deepEqual(r.map((x) => [x.thread, x.acao]), [[thread.id, 'registraria']]);
    assert.equal(entregasNaBase(p.dir, 'main').has(thread.id), true);
    const estado = entregasDoProjeto(p.carregado, { quando: new Date().toISOString() }).estados.find((x) => x.thread === thread.id);
    assert.match(estado?.resumo ?? '', /^merge [0-9a-f]{7} na base, falta registrar a entrega/);
  } finally { p.limpar(); }
});

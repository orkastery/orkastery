import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

// RM-050: a metrica do piloto (CI verde na primeira execucao) e o criterio de fechamento.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/medir-piloto-de-contribuicao.cjs');
const { medirPiloto, relatorio } = require(SCRIPT);

const REPO = 'orkastery/orkastery';

interface Pr {
  number: number; html_url: string; state: string; created_at: string; merged_at: string | null;
  author_association: string; user: { login: string; type: string } | null;
}
interface Run {
  id: number; head_sha: string; event: string; status: string; conclusion: string | null;
  run_attempt: number; created_at: string; html_url: string;
}
interface Commit { sha: string; author: { login: string } | null }

function pr(numero: number, autor: string, associacao: string, extra: Partial<Pr> = {}): Pr {
  return {
    number: numero,
    html_url: `https://github.com/${REPO}/pull/${numero}`,
    state: 'closed',
    created_at: '2026-10-01T12:00:00Z',
    merged_at: '2026-10-02T12:00:00Z',
    author_association: associacao,
    user: { login: autor, type: 'User' },
    ...extra,
  };
}

function run(id: number, sha: string, conclusao: string | null, criadoEm: string, extra: Partial<Run> = {}): Run {
  return {
    id, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: conclusao, run_attempt: 1,
    created_at: criadoEm, html_url: `https://github.com/${REPO}/actions/runs/${id}`, ...extra,
  };
}

const commitsDe = (autor: string | null, ...shas: string[]): Commit[] => shas.map((sha) => ({ sha, author: autor ? { login: autor } : null }));

function dados(prs: Pr[], commits: Record<string, Commit[]>, runs: Run[], tentativas: Record<string, unknown[]> = {}) {
  return { workflow: 'ci.yml', repos: { [REPO]: { prs, commits, runs, tentativas } } };
}

const prsMedidos = (m: { repos: Array<{ prs: Array<{ numero: number }> }> }) => m.repos[0].prs.map((p) => p.numero);

test('PR do mantenedor e de bot fica fora; convidado, primeira contribuicao e sem vinculo entram', () => {
  const m = medirPiloto(dados(
    [
      pr(1, 'dono', 'OWNER'),
      pr(2, 'mantenedor', 'MEMBER'),
      pr(3, 'dependabot[bot]', 'NONE', { user: { login: 'dependabot[bot]', type: 'Bot' } }),
      pr(4, 'convidada', 'COLLABORATOR'),
      pr(5, 'estreante', 'FIRST_TIME_CONTRIBUTOR'),
      pr(6, 'recorrente', 'CONTRIBUTOR'),
      pr(7, 'visitante', 'NONE'),
    ],
    { 4: commitsDe('convidada', 'a4'), 5: commitsDe('estreante', 'a5'), 6: commitsDe('recorrente', 'a6'), 7: commitsDe('visitante', 'a7') },
    [],
  ));
  assert.deepEqual(prsMedidos(m), [4, 5, 6, 7]);
  assert.equal(m.resumo.prsDeFora, 4);
});

test('PR de antes da publicacao fica fora, e --desde muda a janela', () => {
  const d = dados([pr(8, 'visitante', 'NONE', { created_at: '2026-09-28T23:59:59Z' })], { 8: commitsDe('visitante', 'a8') }, []);
  assert.deepEqual(prsMedidos(medirPiloto(d)), [], 'a publicacao do guia foi em 29/09/2026');
  assert.deepEqual(prsMedidos(medirPiloto(d, { desde: '2026-09-01' })), [8]);
});

test('a primeira execucao e o run mais antigo do workflow sobre um commit do PR', () => {
  const m = medirPiloto(dados(
    [pr(10, 'visitante', 'NONE')],
    { 10: commitsDe('visitante', 'a', 'b') },
    [
      run(103, 'b', 'success', '2026-10-01T13:00:00Z'),
      run(102, 'a', 'failure', '2026-10-01T12:05:00Z'),
      run(101, 'outro-pr', 'failure', '2026-10-01T12:01:00Z'),
      run(100, 'a', 'success', '2026-10-01T12:00:00Z', { event: 'push' }),
    ],
  ));
  const p = m.repos[0].prs[0];
  assert.deepEqual(p.primeiraExecucao, {
    run: 102, tentativa: 1, conclusao: 'failure', emAndamento: false, url: `https://github.com/${REPO}/actions/runs/102`,
  });
  assert.equal(m.resumo.verdesNaPrimeira, 0, 'o verde do segundo push nao apaga a primeira execucao');
});

test('action_required, skipped e stale nao sao execucao; so liberacao pendente aparece como tal', () => {
  const m = medirPiloto(dados(
    [pr(11, 'estreante', 'FIRST_TIME_CONTRIBUTOR'), pr(12, 'outra', 'FIRST_TIME_CONTRIBUTOR', { state: 'open', merged_at: null })],
    { 11: commitsDe('estreante', 'c'), 12: commitsDe('outra', 'd') },
    [
      run(110, 'c', 'action_required', '2026-10-01T12:00:00Z'),
      run(111, 'c', 'skipped', '2026-10-01T12:01:00Z'),
      run(112, 'c', 'stale', '2026-10-01T12:02:00Z'),
      run(113, 'c', 'success', '2026-10-01T12:30:00Z'),
      run(120, 'd', 'action_required', '2026-10-01T12:00:00Z'),
    ],
  ));
  const [p11, p12] = m.repos[0].prs;
  assert.equal(p11.primeiraExecucao.run, 113);
  assert.equal(p11.primeiraExecucao.conclusao, 'success');
  assert.equal(p11.aguardandoLiberacao, false);
  assert.equal(p12.primeiraExecucao, null);
  assert.equal(p12.aguardandoLiberacao, true);
  assert.equal(p12.estado, 'aberto');
  assert.equal(m.resumo.comExecucao, 1);
});

test('num run reexecutado vale a primeira tentativa que rodou', () => {
  const m = medirPiloto(dados(
    [pr(13, 'visitante', 'NONE'), pr(14, 'estreante', 'FIRST_TIME_CONTRIBUTOR')],
    { 13: commitsDe('visitante', 'e'), 14: commitsDe('estreante', 'f') },
    [
      run(130, 'e', 'success', '2026-10-01T12:00:00Z', { run_attempt: 2 }),
      run(140, 'f', 'success', '2026-10-01T12:00:00Z', { run_attempt: 2 }),
    ],
    {
      130: [{ run_attempt: 1, status: 'completed', conclusion: 'failure' }],
      140: [{ run_attempt: 1, status: 'completed', conclusion: 'action_required' }],
    },
  ));
  const [p13, p14] = m.repos[0].prs;
  assert.equal(p13.primeiraExecucao.conclusao, 'failure', 'reexecutar ate passar nao vira verde na primeira');
  assert.equal(p13.primeiraExecucao.tentativa, 1);
  assert.equal(p14.primeiraExecucao.conclusao, 'success', 'a liberacao do mantenedor nao e execucao');
  assert.equal(p14.primeiraExecucao.tentativa, 2);
});

test('execucao em andamento fica fora da taxa ate concluir', () => {
  const m = medirPiloto(dados(
    [pr(15, 'visitante', 'NONE', { state: 'open', merged_at: null })],
    { 15: commitsDe('visitante', 'g') },
    [run(150, 'g', null, '2026-10-01T12:00:00Z', { status: 'in_progress' })],
  ));
  assert.equal(m.repos[0].prs[0].primeiraExecucao.emAndamento, true);
  assert.equal(m.resumo.comExecucao, 0);
  assert.equal(m.resumo.taxa, null, 'sem execucao concluida, a taxa e lacuna, nao zero');
});

test('lacuna da coleta reprova a leitura em vez de virar zero', () => {
  assert.throws(
    () => medirPiloto(dados([pr(16, 'visitante', 'NONE')], {}, [])),
    /dados sem os commits do PR #16/,
  );
  assert.throws(
    () => medirPiloto(dados(
      [pr(17, 'visitante', 'NONE')],
      { 17: commitsDe('visitante', 'h') },
      [run(170, 'h', 'success', '2026-10-01T12:00:00Z', { run_attempt: 3 })],
      { 170: [{ run_attempt: 1, status: 'completed', conclusion: 'failure' }] },
    )),
    /dados sem a tentativa 2 do run 170/,
  );
});

test('commit de outra pessoa ou sem login tira o PR do criterio de fechamento', () => {
  const m = medirPiloto(dados(
    [pr(18, 'visitante', 'NONE'), pr(19, 'estreante', 'FIRST_TIME_CONTRIBUTOR')],
    { 18: [...commitsDe('visitante', 'i1'), ...commitsDe('mantenedor', 'i2')], 19: [...commitsDe('estreante', 'j1'), ...commitsDe(null, 'j2')] },
    [run(180, 'i1', 'success', '2026-10-01T12:00:00Z'), run(190, 'j1', 'success', '2026-10-01T12:00:00Z')],
  ));
  const [p18, p19] = m.repos[0].prs;
  assert.equal(p18.commitsDeOutraPessoa, 1);
  assert.equal(p18.contaParaFechamento, false);
  assert.equal(p19.commitsSemLogin, 1);
  assert.equal(p19.contaParaFechamento, false, 'commit sem login nao prova que nao houve ajuda');
  assert.equal(m.resumo.fechamento.atingidos, 0);
});

test('taxa contra a meta de 80% e o criterio de dois PRs de fora', () => {
  const m = medirPiloto(dados(
    [pr(20, 'a', 'NONE'), pr(21, 'b', 'CONTRIBUTOR'), pr(22, 'c', 'NONE'), pr(23, 'd', 'NONE', { state: 'open', merged_at: null })],
    { 20: commitsDe('a', 'k0'), 21: commitsDe('b', 'k1'), 22: commitsDe('c', 'k2'), 23: commitsDe('d', 'k3') },
    [
      run(200, 'k0', 'success', '2026-10-01T12:00:00Z'),
      run(210, 'k1', 'success', '2026-10-01T12:00:00Z'),
      run(220, 'k2', 'failure', '2026-10-01T12:00:00Z'),
      run(230, 'k3', 'success', '2026-10-01T12:00:00Z'),
    ],
  ));
  assert.equal(m.resumo.prsDeFora, 4);
  assert.equal(m.resumo.comExecucao, 4);
  assert.equal(m.resumo.verdesNaPrimeira, 3);
  assert.equal(m.resumo.taxa, 0.75);
  assert.equal(m.resumo.meta, 0.8);
  assert.deepEqual(m.resumo.fechamento, { exigidos: 2, atingidos: 2, fechado: true }, 'o #23 esta verde, mas aberto');
});

test('--tratar-como-externo conta o PR do mantenedor, para ensaiar a medida', () => {
  const d = dados([pr(2, 'mantenedor', 'MEMBER')], { 2: commitsDe('mantenedor', 'm') }, [run(20, 'm', 'success', '2026-10-01T12:00:00Z')]);
  assert.deepEqual(prsMedidos(medirPiloto(d)), []);
  const m = medirPiloto(d, { tratarComoExterno: ['mantenedor'] });
  assert.deepEqual(prsMedidos(m), [2]);
  assert.equal(m.repos[0].prs[0].contaParaFechamento, true);
  assert.deepEqual(m.tratadosComoExternos, ['mantenedor']);
  assert.match(relatorio(m), /^Ensaio: conta também os PRs de mantenedor, que não são de fora\. Não vale como medida do piloto\.$/m);
});

/** Roda o script com um `gh` falso no PATH: cada chamada fica no log e a resposta vem do cenario. */
function comGhFalso(respostas: Record<string, string>, falhar: boolean, corpo: (dir: string, rodar: (...a: string[]) => ReturnType<typeof spawnSync>) => void): void {
  const dir = dirTemporario('piloto-gh');
  try {
    fs.writeFileSync(path.join(dir, 'cenario.json'), JSON.stringify(respostas));
    fs.writeFileSync(path.join(dir, 'gh'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const args = process.argv.slice(2);',
      "fs.appendFileSync(path.join(__dirname, 'chamadas.log'), args.join(' ') + '\\n');",
      `if (${falhar}) { process.stderr.write('HTTP 401: Bad credentials'); process.exit(1); }`,
      "const cenario = JSON.parse(fs.readFileSync(path.join(__dirname, 'cenario.json'), 'utf8'));",
      "const rota = args.find((a) => a.startsWith('repos/'));",
      "if (!(rota in cenario)) { process.stderr.write('rota fora do cenario: ' + rota); process.exit(1); }",
      'process.stdout.write(cenario[rota]);',
      '',
    ].join('\n'));
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
    const rodar = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
    corpo(dir, rodar);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const linhas = (...itens: unknown[]) => itens.map((i) => `${JSON.stringify(i)}\n`).join('');

test('a coleta pede ao gh so o que a medida usa, e a coleta salva mede igual sem rede', () => {
  const runs = '/actions/workflows/ci.yml/runs?event=pull_request&per_page=100&created=%3E%3D2026-09-29';
  const respostas = {
    [`repos/${REPO}/pulls?state=all&per_page=100`]: linhas(
      pr(30, 'mantenedor', 'MEMBER'),
      pr(31, 'visitante', 'NONE'),
      pr(29, 'antiga', 'NONE', { created_at: '2026-09-20T12:00:00Z' }),
    ),
    [`repos/${REPO}/pulls/31/commits?per_page=100`]: linhas(...commitsDe('visitante', 'p1', 'p2')),
    [`repos/${REPO}${runs}`]: linhas(
      run(311, 'p1', 'success', '2026-10-01T12:00:00Z', { run_attempt: 2 }),
      run(300, 'de-outro-pr', 'failure', '2026-10-01T11:00:00Z'),
    ),
    [`repos/${REPO}/actions/runs/311/attempts/1`]: JSON.stringify({ run_attempt: 1, status: 'completed', conclusion: 'failure' }),
  };
  comGhFalso(respostas, false, (dir, rodar) => {
    const salvo = path.join(dir, 'coleta.json');
    const r = rodar('--repo', REPO, '--salvar-dados', salvo, '--json');
    assert.equal(r.status, 0, String(r.stderr));
    const chamadas = fs.readFileSync(path.join(dir, 'chamadas.log'), 'utf8').trim().split('\n').map((l) => l.split(' ').find((a) => a.startsWith('repos/')));
    assert.deepEqual(chamadas, [
      `repos/${REPO}/pulls?state=all&per_page=100`,
      `repos/${REPO}/pulls/31/commits?per_page=100`,
      `repos/${REPO}${runs}`,
      `repos/${REPO}/actions/runs/311/attempts/1`,
    ], 'sem commits do PR do mantenedor nem do PR antigo');
    const medida = JSON.parse(String(r.stdout));
    assert.deepEqual(prsMedidos(medida), [31]);
    assert.equal(medida.repos[0].prs[0].primeiraExecucao.conclusao, 'failure');

    const coleta = JSON.parse(fs.readFileSync(salvo, 'utf8'));
    assert.equal(coleta.esquema, 'ork.piloto-contribuicao/v1');
    assert.deepEqual(coleta.repos[REPO].runs.map((x: Run) => x.id), [311], 'so os runs dos commits de PR de fora');
    const deNovo = rodar('--dados', salvo, '--json');
    assert.equal(deNovo.status, 0, String(deNovo.stderr));
    assert.deepEqual(JSON.parse(String(deNovo.stdout)).repos, medida.repos);

    const texto = rodar('--dados', salvo);
    assert.match(String(texto.stdout), /#31 @visitante, mesclado: primeira execução failure \(run 311, tentativa 1\), commits de outra pessoa: 0/);
    assert.match(String(texto.stdout), /Resumo: 1 PR\(s\) de fora, 1 com a primeira execução do CI concluída, 0 verde\(s\): taxa de 0% \(meta: 80%\)\./);
  });
});

test('sem PR de fora a taxa sai sem medida; gh com erro e uso errado saem 2', () => {
  comGhFalso({ [`repos/${REPO}/pulls?state=all&per_page=100`]: linhas(pr(40, 'mantenedor', 'MEMBER')) }, false, (dir, rodar) => {
    const r = rodar('--repo', REPO);
    assert.equal(r.status, 0, String(r.stderr));
    assert.match(String(r.stdout), new RegExp(`${REPO}: nenhum PR de fora\\.`));
    assert.match(String(r.stdout), /0 verde\(s\): taxa sem medida, nenhuma primeira execução concluída \(meta: 80%\)/);
    assert.match(String(r.stdout), /Fechamento: 0 PR\(s\) de fora mesclado\(s\), verde\(s\) na primeira execução e sem commit de outra pessoa; o critério pede 2\./);
    assert.doesNotMatch(String(r.stdout), /Ensaio/);
    const chamadas = fs.readFileSync(path.join(dir, 'chamadas.log'), 'utf8').trim().split('\n');
    assert.equal(chamadas.length, 1, 'sem PR de fora, nem runs nem commits');
  });
  comGhFalso({}, true, (_dir, rodar) => {
    const r = rodar('--repo', REPO);
    assert.equal(r.status, 2);
    assert.match(String(r.stderr), /gh api .* saiu 1: HTTP 401: Bad credentials/);
  });
  comGhFalso({}, false, (dir, rodar) => {
    const casos: Array<[string[], RegExp]> = [
      [['--desde', '29/09/2026'], /--desde inválido/],
      [['--repo', 'sem-barra'], /--repo inválido/],
      [['--dados', 'a.json', '--salvar-dados', 'b.json'], /não andam juntos/],
      [['--dados', path.join(dir, 'nao-existe.json')], /não li a coleta/],
      [['--opcao-que-nao-existe'], /opção desconhecida/],
    ];
    for (const [args, erro] of casos) {
      const r = rodar(...args);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(String(r.stderr), erro);
    }
    assert.ok(!fs.existsSync(path.join(dir, 'chamadas.log')), 'erro de uso nao chega ao gh');
  });
});

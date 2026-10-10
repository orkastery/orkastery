import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

// RM-050: a metrica do piloto (CI verde na primeira execucao) e o criterio de fechamento.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/medir-piloto-de-contribuicao.cjs');
const { medirPiloto, relatorio, ESQUEMA_COLETA, ESQUEMA_MEDIDA } = require(SCRIPT);

const REPO = 'orkastery/orkastery';

interface Pr {
  number: number; html_url: string; state: string; created_at: string; closed_at: string | null; merged_at: string | null;
  author_association: string; user: { login: string; type: string } | null; head: { ref: string | null; repo: string | null };
}
interface Run {
  id: number; head_sha: string; head_branch: string | null; head_repo: string | null; event: string; status: string;
  conclusion: string | null; run_attempt: number; created_at: string; html_url: string;
}
interface Commit { sha: string; author: { login: string } | null }

/** PR mesclado, aberto em 01/10 12:00 a partir da branch `pr-<numero>` do fork do autor. */
function pr(numero: number, autor: string, associacao: string, extra: Partial<Pr> = {}): Pr {
  return {
    number: numero,
    html_url: `https://github.com/${REPO}/pull/${numero}`,
    state: 'closed',
    created_at: '2026-10-01T12:00:00Z',
    closed_at: '2026-10-02T12:00:00Z',
    merged_at: '2026-10-02T12:00:00Z',
    author_association: associacao,
    user: { login: autor, type: 'User' },
    head: { ref: `pr-${numero}`, repo: `${autor}/orkastery` },
    ...extra,
  };
}

/** Run de `pull_request` sem branch de origem: casa com o PR so pelo SHA, salvo quando o teste diz. */
function run(id: number, sha: string, conclusao: string | null, criadoEm: string, extra: Partial<Run> = {}): Run {
  return {
    id, head_sha: sha, head_branch: null, head_repo: null, event: 'pull_request', status: 'completed', conclusion: conclusao,
    run_attempt: 1, created_at: criadoEm, html_url: `https://github.com/${REPO}/actions/runs/${id}`, ...extra,
  };
}

/** Run na branch de origem do PR: o caso comum, com a origem conhecida. */
const runDe = (p: Pr, id: number, sha: string, conclusao: string | null, criadoEm: string, extra: Partial<Run> = {}): Run =>
  run(id, sha, conclusao, criadoEm, { head_branch: p.head.ref, head_repo: p.head.repo, ...extra });

const commitsDe = (autor: string | null, ...shas: string[]): Commit[] => shas.map((sha) => ({ sha, author: autor ? { login: autor } : null }));

function dados(prs: Pr[], commits: Record<string, Commit[]>, runs: Run[], tentativas: Record<string, unknown[]> = {}, desde = '2026-09-29') {
  return { esquema: ESQUEMA_COLETA, workflow: 'ci.yml', desde, repos: { [REPO]: { prs, commits, runs, tentativas } } };
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
  assert.equal(m.esquema, ESQUEMA_MEDIDA, 'a medida nao tem o esquema da coleta');
});

test('a janela vem da coleta; --desde so pode estreitar, e repositorio repetido conta uma vez', () => {
  const d = dados([pr(8, 'visitante', 'NONE', { created_at: '2026-09-28T23:59:59Z' })], { 8: commitsDe('visitante', 'a8') }, [], {}, '2026-09-01');
  assert.deepEqual(prsMedidos(medirPiloto(d)), [8], 'sem --desde vale o inicio da coleta');
  assert.deepEqual(prsMedidos(medirPiloto(d, { desde: '2026-09-29' })), [], 'a publicacao do guia foi em 29/09/2026');
  assert.throws(() => medirPiloto({ ...d, desde: '2026-09-29' }, { desde: '2026-09-01' }), /a coleta começa em 2026-09-29: para medir desde 2026-09-01, colete de novo/);
  assert.equal(medirPiloto(d, { repos: [REPO, REPO] }).resumo.prsDeFora, 1);
  assert.equal(medirPiloto(d, { repos: [REPO, 'Orkastery/Orkastery'] }).resumo.prsDeFora, 1, 'o GitHub nao diferencia maiusculas no nome');
});

test('a primeira execucao e o run mais antigo do workflow na branch do PR', () => {
  const p10 = pr(10, 'visitante', 'NONE');
  const m = medirPiloto(dados(
    [p10],
    { 10: commitsDe('visitante', 'a', 'b') },
    [
      runDe(p10, 103, 'b', 'success', '2026-10-01T13:00:00Z'),
      runDe(p10, 102, 'a', 'failure', '2026-10-01T12:05:00Z'),
      // O mesmo commit noutra branch (PR empilhado) nao e execucao deste PR.
      run(101, 'a', 'success', '2026-10-01T12:01:00Z', { head_branch: 'outra', head_repo: 'visitante/orkastery' }),
      runDe(p10, 100, 'a', 'success', '2026-10-01T12:00:00Z', { event: 'push' }),
    ],
  ));
  const p = m.repos[0].prs[0];
  assert.deepEqual(p.primeiraExecucao, {
    run: 102, tentativa: 1, conclusao: 'failure', emAndamento: false, url: `https://github.com/${REPO}/actions/runs/102`,
  });
  assert.equal(m.resumo.verdesNaPrimeira, 0, 'o verde do segundo push nao apaga a primeira execucao');
});

test('push forcado: o run do commit que saiu do PR ainda e a primeira execucao, pela branch de origem', () => {
  const m = medirPiloto(dados(
    [pr(24, 'fulano', 'NONE')],
    // Depois do `commit --amend` e do push forcado, so o commit novo `y` aparece no PR.
    { 24: commitsDe('fulano', 'y') },
    [
      run(239, 'w', 'success', '2026-10-01T12:00:30Z', { head_branch: 'pr-24', head_repo: 'outro/orkastery' }),
      run(240, 'x', 'failure', '2026-10-01T12:01:00Z', { head_branch: 'pr-24', head_repo: 'fulano/orkastery' }),
      run(241, 'y', 'success', '2026-10-01T12:30:00Z', { head_branch: 'pr-24', head_repo: 'fulano/orkastery' }),
    ],
  ));
  const p = m.repos[0].prs[0];
  assert.equal(p.primeiraExecucao.run, 240, 'a mesma branch de outro fork nao e do PR');
  assert.equal(p.primeiraExecucao.conclusao, 'failure');
  assert.equal(p.contaParaFechamento, false);
  assert.equal(m.resumo.taxa, 0);
});

test('o run de antes do PR abrir ou depois de fechar nao e dele, mesmo na mesma branch', () => {
  const branch = { head_branch: 'pr-25', head_repo: 'fulano/orkastery' };
  const m = medirPiloto(dados(
    // O PR #25 reabre como PR novo a mesma branch de um PR anterior, ja fechado.
    [pr(25, 'fulano', 'NONE', { created_at: '2026-10-01T13:00:00Z', closed_at: '2026-10-01T15:00:00Z', merged_at: '2026-10-01T15:00:00Z' })],
    { 25: commitsDe('fulano', 'z2') },
    [
      run(250, 'z1', 'failure', '2026-10-01T12:00:00Z', branch),
      run(251, 'z2', 'success', '2026-10-01T13:05:00Z', branch),
      run(252, 'z3', 'failure', '2026-10-01T16:00:00Z', branch),
    ],
  ));
  assert.equal(m.repos[0].prs[0].primeiraExecucao.run, 251);
  assert.equal(m.resumo.fechamento.atingidos, 1);
});

test('action_required, skipped, stale e cancelled nao sao execucao; so liberacao pendente aparece como tal', () => {
  const de11 = pr(11, 'estreante', 'FIRST_TIME_CONTRIBUTOR');
  const de12 = pr(12, 'outra', 'FIRST_TIME_CONTRIBUTOR', { state: 'open', closed_at: null, merged_at: null });
  const m = medirPiloto(dados(
    [de11, de12],
    { 11: commitsDe('estreante', 'c', 'c2'), 12: commitsDe('outra', 'd') },
    [
      runDe(de11, 110, 'c', 'action_required', '2026-10-01T12:00:00Z'),
      runDe(de11, 111, 'c', 'skipped', '2026-10-01T12:01:00Z'),
      runDe(de11, 112, 'c', 'stale', '2026-10-01T12:02:00Z'),
      // O segundo push cancela o primeiro quando o CI tem `cancel-in-progress` (o do OrkMind tem).
      runDe(de11, 113, 'c', 'cancelled', '2026-10-01T12:03:00Z'),
      runDe(de11, 114, 'c2', 'success', '2026-10-01T12:30:00Z'),
      runDe(de12, 120, 'd', 'action_required', '2026-10-01T12:00:00Z'),
    ],
  ));
  const [p11, p12] = m.repos[0].prs;
  assert.equal(p11.primeiraExecucao.run, 114);
  assert.equal(p11.primeiraExecucao.conclusao, 'success');
  assert.equal(p11.aguardandoLiberacao, false);
  assert.equal(p12.primeiraExecucao, null);
  assert.equal(p12.aguardandoLiberacao, true);
  assert.equal(p12.estado, 'aberto');
  assert.equal(m.resumo.comExecucao, 1);
});

test('com o fork apagado, o run e do PR pela branch, e o PR sai marcado e fora do fechamento', () => {
  const p26 = pr(26, 'sumido', 'NONE', { head: { ref: 'pr-26', repo: null } });
  const p27 = pr(27, 'sumida', 'NONE', { head: { ref: 'pr-27', repo: null } });
  const m = medirPiloto(dados(
    [p26, p27],
    // O push forcado tirou `q1` do #26; o commit `q2` tambem rodou noutra branch (PR empilhado).
    { 26: commitsDe('sumido', 'q2'), 27: commitsDe('sumida', 'r1') },
    [
      run(259, 'q2', 'success', '2026-10-01T12:00:30Z', { head_branch: 'feat', head_repo: null }),
      run(260, 'q1', 'failure', '2026-10-01T12:01:00Z', { head_branch: 'pr-26', head_repo: null }),
      run(261, 'q2', 'success', '2026-10-01T12:30:00Z', { head_branch: 'pr-26', head_repo: null }),
      run(270, 'r1', 'success', '2026-10-01T12:05:00Z', { head_branch: 'pr-27', head_repo: null }),
      // Um fork vivo com a mesma branch nao e do PR de fork apagado.
      run(271, 'v1', 'failure', '2026-10-01T12:01:00Z', { head_branch: 'pr-27', head_repo: 'beltrano/orkastery' }),
    ],
  ));
  const [p, q] = m.repos[0].prs;
  assert.equal(p.primeiraExecucao.run, 260, 'o commit que saiu por push forcado continua sendo a primeira execucao');
  assert.equal(p.origemDesconhecida, true);
  assert.equal(q.primeiraExecucao.conclusao, 'success');
  assert.equal(q.contaParaFechamento, false, 'sem a origem, outro fork com a mesma branch pode ter entrado');
  assert.match(relatorio(m), /#27 @sumida, mesclado: primeira execução success \(run 270, tentativa 1\), commits de outra pessoa: 0, fork apagado: runs casados só pela branch \(confira\)/);
});

test('o fim da janela e o fechamento do PR, e o PR reaberto e aberto nao tem fim', () => {
  const p28 = pr(28, 'fulano', 'NONE', { closed_at: '2026-10-01T13:00:00Z', merged_at: '2026-10-01T13:00:00Z' });
  // Reaberto: aberto de novo, com o `closed_at` do fechamento anterior.
  const p29 = pr(29, 'fulana', 'NONE', { state: 'open', closed_at: '2026-10-01T12:30:00Z', merged_at: null });
  const m = medirPiloto(dados(
    [p28, p29],
    { 28: commitsDe('fulano', 's1'), 29: commitsDe('fulana', 't1') },
    [runDe(p28, 280, 's1', 'failure', '2026-10-01T13:30:00Z'), runDe(p29, 290, 't1', 'success', '2026-10-01T13:00:00Z')],
  ));
  const [p, q] = m.repos[0].prs;
  assert.equal(p.primeiraExecucao, null, 'run depois do fechamento nao e do PR');
  assert.equal(q.primeiraExecucao.run, 290);
});

test('num run reexecutado vale a primeira tentativa que rodou', () => {
  const de13 = pr(13, 'visitante', 'NONE');
  const de14 = pr(14, 'estreante', 'FIRST_TIME_CONTRIBUTOR');
  const m = medirPiloto(dados(
    [de13, de14],
    { 13: commitsDe('visitante', 'e'), 14: commitsDe('estreante', 'f') },
    [
      runDe(de13, 130, 'e', 'success', '2026-10-01T12:00:00Z', { run_attempt: 2 }),
      runDe(de14, 140, 'f', 'success', '2026-10-01T12:00:00Z', { run_attempt: 2 }),
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
  const p15 = pr(15, 'visitante', 'NONE', { state: 'open', closed_at: null, merged_at: null });
  const m = medirPiloto(dados(
    [p15],
    { 15: commitsDe('visitante', 'g') },
    [runDe(p15, 150, 'g', null, '2026-10-01T12:00:00Z', { status: 'in_progress' })],
  ));
  assert.equal(m.repos[0].prs[0].primeiraExecucao.emAndamento, true);
  assert.equal(m.resumo.comExecucao, 0);
  assert.equal(m.resumo.taxa, null, 'sem execucao concluida, a taxa e lacuna, nao zero');
});

test('lacuna ou coleta fora de forma reprova a leitura em vez de virar zero', () => {
  assert.throws(() => medirPiloto(dados([pr(16, 'visitante', 'NONE')], {}, [])), /dados sem os commits do PR #16/);
  assert.throws(
    () => medirPiloto(dados(
      [pr(17, 'visitante', 'NONE')],
      { 17: commitsDe('visitante', 'h') },
      [runDe(pr(17, 'visitante', 'NONE'), 170, 'h', 'success', '2026-10-01T12:00:00Z', { run_attempt: 3 })],
      { 170: [{ run_attempt: 1, status: 'completed', conclusion: 'failure' }] },
    )),
    /dados sem a tentativa 2 do run 170/,
  );
  const medida = medirPiloto(dados([], {}, []));
  assert.throws(() => medirPiloto(medida), /esperado o esquema ork\.piloto-coleta\/v1/, 'a saida --json da medida nao passa por coleta');
  const semData = dados([pr(18, 'visitante', 'NONE')], { 18: commitsDe('visitante', 'i') }, []);
  delete (semData.repos[REPO].prs[0] as Partial<Pr>).created_at;
  assert.throws(() => medirPiloto(semData), /PR sem número ou sem created_at/);
  assert.throws(() => medirPiloto({ ...dados([], {}, []), desde: undefined }), /a coleta não diz desde quando/);
  const duasGrafias = dados([], {}, []);
  (duasGrafias.repos as Record<string, unknown>)['Orkastery/Orkastery'] = { prs: [], commits: {}, runs: [], tentativas: {} };
  assert.throws(() => medirPiloto(duasGrafias), /o mesmo repositório aparece duas vezes/);
});

test('commit de outra pessoa ou sem login tira o PR do criterio de fechamento', () => {
  const de18 = pr(18, 'visitante', 'NONE');
  const de19 = pr(19, 'estreante', 'FIRST_TIME_CONTRIBUTOR');
  const m = medirPiloto(dados(
    [de18, de19],
    { 18: [...commitsDe('visitante', 'i1'), ...commitsDe('mantenedor', 'i2')], 19: [...commitsDe('estreante', 'j1'), ...commitsDe(null, 'j2')] },
    [runDe(de18, 180, 'i1', 'success', '2026-10-01T12:00:00Z'), runDe(de19, 190, 'j1', 'success', '2026-10-01T12:00:00Z')],
  ));
  const [p18, p19] = m.repos[0].prs;
  assert.equal(p18.commitsDeOutraPessoa, 1);
  assert.equal(p18.contaParaFechamento, false);
  assert.equal(p19.commitsSemLogin, 1);
  assert.equal(p19.contaParaFechamento, false, 'commit sem login nao prova que nao houve ajuda');
  assert.equal(m.resumo.fechamento.atingidos, 0);
  assert.match(relatorio(m), /Fechamento: 0 PR\(s\) de fora mesclado\(s\), verde\(s\) na primeira execução, sem commit de outra pessoa nem sem login, com o fork de origem; o critério pede 2\./);
});

test('taxa contra a meta de 80% e o criterio de dois PRs de fora', () => {
  const [p20, p21, p22, p23] = [pr(20, 'a', 'NONE'), pr(21, 'b', 'CONTRIBUTOR'), pr(22, 'c', 'NONE'),
    pr(23, 'd', 'NONE', { state: 'open', closed_at: null, merged_at: null })];
  const m = medirPiloto(dados(
    [p20, p21, p22, p23],
    { 20: commitsDe('a', 'k0'), 21: commitsDe('b', 'k1'), 22: commitsDe('c', 'k2'), 23: commitsDe('d', 'k3') },
    [
      runDe(p20, 200, 'k0', 'success', '2026-10-01T12:00:00Z'),
      runDe(p21, 210, 'k1', 'success', '2026-10-01T12:00:00Z'),
      runDe(p22, 220, 'k2', 'failure', '2026-10-01T12:00:00Z'),
      runDe(p23, 230, 'k3', 'success', '2026-10-01T12:00:00Z'),
    ],
  ));
  assert.equal(m.resumo.prsDeFora, 4);
  assert.equal(m.resumo.comExecucao, 4);
  assert.equal(m.resumo.verdesNaPrimeira, 3);
  assert.equal(m.resumo.taxa, 0.75);
  assert.equal(m.resumo.meta, 0.8);
  assert.deepEqual(m.resumo.fechamento, { exigidos: 2, atingidos: 2, fechado: true }, 'o #23 esta verde, mas aberto');
  assert.match(relatorio(m), /taxa de 75% \(meta: 80%, abaixo\)/);
  // 159 de 200 e 79,5%: truncada, a taxa nunca aparece como a meta que nao atingiu.
  const quase = { ...m, resumo: { ...m.resumo, prsDeFora: 200, comExecucao: 200, verdesNaPrimeira: 159, taxa: 159 / 200 } };
  assert.match(relatorio(quase), /taxa de 79,5% \(meta: 80%, abaixo\)/);
  const na = { ...m, resumo: { ...m.resumo, taxa: 0.8 } };
  assert.match(relatorio(na), /taxa de 80% \(meta: 80%, atingida\)/);
});

test('--tratar-como-externo conta o PR do mantenedor, para ensaiar a medida', () => {
  const p2 = pr(2, 'mantenedor', 'MEMBER');
  const d = dados([p2], { 2: commitsDe('mantenedor', 'm') }, [runDe(p2, 20, 'm', 'success', '2026-10-01T12:00:00Z')]);
  assert.deepEqual(prsMedidos(medirPiloto(d)), []);
  const m = medirPiloto(d, { tratarComoExterno: ['mantenedor'] });
  assert.deepEqual(prsMedidos(m), [2]);
  assert.equal(m.repos[0].prs[0].contaParaFechamento, true);
  assert.deepEqual(m.tratadosComoExternos, ['mantenedor']);
  assert.match(relatorio(m), /^Ensaio: conta também os PRs de mantenedor, que não são de fora\. Não vale como medida do piloto\.$/m);
});

/**
 * Roda o script com um `gh` falso no PATH. Cada rota do cenario e uma lista de paginas: com
 * `--paginate` saem todas, sem ele so a primeira, como no gh de verdade. Cada chamada vai para o log.
 */
function comGhFalso(respostas: Record<string, string[]>, falhar: boolean,
  corpo: (dir: string, rodar: (...a: string[]) => ReturnType<typeof spawnSync>, chamadas: () => string[][]) => void): void {
  const dir = dirTemporario('piloto-gh');
  try {
    fs.writeFileSync(path.join(dir, 'cenario.json'), JSON.stringify(respostas));
    fs.writeFileSync(path.join(dir, 'gh'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const args = process.argv.slice(2);',
      "fs.appendFileSync(path.join(__dirname, 'chamadas.log'), JSON.stringify(args) + '\\n');",
      `if (${falhar}) { process.stderr.write('HTTP 401: Bad credentials'); process.exit(1); }`,
      "const cenario = JSON.parse(fs.readFileSync(path.join(__dirname, 'cenario.json'), 'utf8'));",
      "const rota = args.find((a) => a.startsWith('repos/'));",
      "if (!(rota in cenario)) { process.stderr.write('rota fora do cenario: ' + rota); process.exit(1); }",
      "const paginas = cenario[rota];",
      "process.stdout.write(args.includes('--paginate') ? paginas.join('') : paginas[0]);",
      '',
    ].join('\n'));
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
    const rodar = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
    const chamadas = () => {
      const log = path.join(dir, 'chamadas.log');
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    };
    corpo(dir, rodar, chamadas);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const linhas = (...itens: unknown[]) => itens.map((i) => `${JSON.stringify(i)}\n`).join('');
const RUNS_DA_BRANCH = (branch: string) =>
  `repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&branch=${encodeURIComponent(branch)}&per_page=100&created=%3E%3D2026-09-29`;

test('a coleta pede ao gh, paginado, so o que a medida usa, e a coleta salva mede igual sem rede', () => {
  const daBranch = { head_branch: 'pr-31', head_repo: 'visitante/orkastery' };
  const respostas = {
    // Duas paginas de PRs: sem --paginate, o #31 da segunda pagina sumiria da medida.
    [`repos/${REPO}/pulls?state=all&per_page=100`]: [
      linhas(pr(30, 'mantenedor', 'MEMBER'), pr(29, 'antiga', 'NONE', { created_at: '2026-09-20T12:00:00Z' })),
      linhas(pr(31, 'visitante', 'NONE')),
    ],
    [`repos/${REPO}/pulls/31/commits?per_page=100`]: [linhas(...commitsDe('visitante', 'p1', 'p2'))],
    [RUNS_DA_BRANCH('pr-31')]: [linhas(
      run(311, 'p1', 'success', '2026-10-01T12:00:00Z', { run_attempt: 2, ...daBranch }),
      run(300, 'de-outro-pr', 'failure', '2026-10-01T11:00:00Z', { head_branch: 'pr-31', head_repo: 'outro/orkastery' }),
    )],
    [`repos/${REPO}/actions/runs/311/attempts/1`]: [JSON.stringify({ run_attempt: 1, status: 'completed', conclusion: 'failure' })],
  };
  comGhFalso(respostas, false, (dir, rodar, chamadas) => {
    const salvo = path.join(dir, 'coleta.json');
    const r = rodar('--repo', REPO, '--salvar-dados', salvo, '--json');
    assert.equal(r.status, 0, String(r.stderr));
    const feitas = chamadas();
    assert.deepEqual(feitas.map((a) => a.find((x) => x.startsWith('repos/'))), [
      `repos/${REPO}/pulls?state=all&per_page=100`,
      `repos/${REPO}/pulls/31/commits?per_page=100`,
      RUNS_DA_BRANCH('pr-31'),
      `repos/${REPO}/actions/runs/311/attempts/1`,
    ], 'sem commits nem runs do PR do mantenedor e do PR antigo');
    for (const [i, seletor] of [[0, '.[] |'], [1, '.[] |'], [2, '.workflow_runs[] |']] as const) {
      assert.ok(feitas[i].includes('--paginate'), `a chamada ${i} pagina`);
      assert.ok(feitas[i][feitas[i].indexOf('--jq') + 1].startsWith(seletor), `a chamada ${i} le ${seletor}`);
    }
    const medida = JSON.parse(String(r.stdout));
    assert.deepEqual(prsMedidos(medida), [31]);
    assert.equal(medida.repos[0].prs[0].primeiraExecucao.conclusao, 'failure');

    const coleta = JSON.parse(fs.readFileSync(salvo, 'utf8'));
    assert.equal(coleta.esquema, ESQUEMA_COLETA);
    assert.deepEqual(coleta.repos[REPO].runs.map((x: Run) => x.id), [311], 'so os runs dos PRs de fora');
    const deNovo = rodar('--dados', salvo, '--json');
    assert.equal(deNovo.status, 0, String(deNovo.stderr));
    assert.deepEqual(JSON.parse(String(deNovo.stdout)).repos, medida.repos);
    const texto = rodar('--dados', salvo);
    assert.match(String(texto.stdout), /#31 @visitante, mesclado: primeira execução failure \(run 311, tentativa 1\), commits de outra pessoa: 0/);
    assert.match(String(texto.stdout), /Resumo: 1 PR\(s\) de fora, 1 com a primeira execução do CI concluída, 0 verde\(s\): taxa de 0% \(meta: 80%, abaixo\)\./);
    assert.equal(chamadas().length, feitas.length, 'medir a coleta salva nao chama o gh');
    const daMedida = path.join(dir, 'medida.json');
    fs.writeFileSync(daMedida, String(r.stdout));
    const errada = rodar('--dados', daMedida);
    assert.equal(errada.status, 2);
    assert.match(String(errada.stderr), /esperado o esquema ork\.piloto-coleta\/v1/);
  });
});

test('a branch de origem vai codificada na consulta de runs', () => {
  const especial = pr(32, 'visitante', 'NONE', { head: { ref: 'fix/ação+#1&x', repo: 'visitante/orkastery' } });
  comGhFalso({
    [`repos/${REPO}/pulls?state=all&per_page=100`]: [linhas(especial)],
    [`repos/${REPO}/pulls/32/commits?per_page=100`]: [linhas(...commitsDe('visitante', 'u1'))],
    [RUNS_DA_BRANCH('fix/ação+#1&x')]: [linhas(runDe(especial, 320, 'u1', 'failure', '2026-10-01T12:00:00Z'))],
  }, false, (_dir, rodar, chamadas) => {
    const r = rodar('--repo', REPO, '--json');
    assert.equal(r.status, 0, String(r.stderr));
    assert.ok(chamadas()[2].includes(RUNS_DA_BRANCH('fix/ação+#1&x')));
    assert.ok(RUNS_DA_BRANCH('fix/ação+#1&x').includes('branch=fix%2Fa%C3%A7%C3%A3o%2B%231%26x&'));
    assert.equal(JSON.parse(String(r.stdout)).repos[0].prs[0].primeiraExecucao.run, 320);
  });
});

test('lista no teto da API reprova a coleta: 250 commits num PR, 1.000 runs numa consulta', () => {
  const pulls = { [`repos/${REPO}/pulls?state=all&per_page=100`]: [linhas(pr(40, 'visitante', 'NONE'))] };
  const muitos = Array.from({ length: 250 }, (_, i) => `c${i}`);
  comGhFalso({ ...pulls, [`repos/${REPO}/pulls/40/commits?per_page=100`]: [linhas(...commitsDe('visitante', ...muitos))] }, false, (_dir, rodar) => {
    const r = rodar('--repo', REPO);
    assert.equal(r.status, 2);
    assert.match(String(r.stderr), /o PR #40 de orkastery\/orkastery chegou a 250 commits, o teto da API/);
  });
  const runs = Array.from({ length: 1000 }, (_, i) => run(5000 + i, `r${i}`, 'success', '2026-10-01T12:00:00Z'));
  comGhFalso({
    ...pulls,
    [`repos/${REPO}/pulls/40/commits?per_page=100`]: [linhas(...commitsDe('visitante', 'c1'))],
    [RUNS_DA_BRANCH('pr-40')]: [linhas(...runs)],
  }, false, (_dir, rodar) => {
    const r = rodar('--repo', REPO);
    assert.equal(r.status, 2);
    assert.match(String(r.stderr), /a consulta de runs do PR #40 de orkastery\/orkastery chegou a 1000, o teto da API/);
  });
});

test('sem PR de fora a taxa sai sem medida; gh com erro e uso errado saem 2', () => {
  comGhFalso({ [`repos/${REPO}/pulls?state=all&per_page=100`]: [linhas(pr(40, 'mantenedor', 'MEMBER'))] }, false, (_dir, rodar, chamadas) => {
    const r = rodar('--repo', REPO);
    assert.equal(r.status, 0, String(r.stderr));
    assert.match(String(r.stdout), new RegExp(`${REPO}: nenhum PR de fora\\.`));
    assert.match(String(r.stdout), /0 verde\(s\): taxa sem medida, nenhuma primeira execução concluída \(meta: 80%\)/);
    assert.match(String(r.stdout), /Fechamento: 0 PR\(s\) de fora mesclado\(s\), verde\(s\) na primeira execução, sem commit de outra pessoa nem sem login, com o fork de origem; o critério pede 2\./);
    assert.doesNotMatch(String(r.stdout), /Ensaio/);
    assert.equal(chamadas().length, 1, 'sem PR de fora, nem runs nem commits');
  });
  comGhFalso({}, true, (_dir, rodar) => {
    const r = rodar('--repo', REPO);
    assert.equal(r.status, 2);
    assert.match(String(r.stderr), /gh api .* saiu 1: HTTP 401: Bad credentials/);
  });
  comGhFalso({}, false, (dir, rodar, chamadas) => {
    const casos: Array<[string[], RegExp]> = [
      [['--desde', '29/09/2026'], /--desde inválido/],
      [['--desde', '2026-02-31'], /--desde inválido: 2026-02-31/],
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
    assert.equal(chamadas().length, 0, 'erro de uso nao chega ao gh');
  });
});

/**
 * RM-037 (fatia 5, A5): o remoto fora do github.com.
 *
 * O pulse so lia PR do github.com. Com o remoto noutra forja, a leitura voltava "o remoto nao e um repositorio do
 * github.com", e o pulse dizia `prs.nao-lidos` a cada batida, e as linhas do condutor "(PR nao lido)", para um estado
 * que nao muda de uma batida para a outra. Agora a forja sem leitura de PR (GitLab, caminho local, host em que o `gh`
 * nao tem login) e dita uma vez por remoto e host, e as linhas so dizem o passo; e o GitHub Enterprise, o host proprio
 * em que o `gh auth status --hostname` passa, e lido pelo host do remoto. Forjas, hosts, PRs e o `gh` sao SIMULADOS: o
 * executor conta as chamadas e nunca toca a rede.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { registrar } from '../src/ledger';
import { CONTRATO_PRS, entregasDoProjeto, ExecutorDoGh, gravarRetratoDePrs, lerPrsDaForja, lerRetratoDePrs, RetratoDePrs } from '../src/parado-no-condutor';
import { montarPulse, textoDoPulse } from '../src/pulse';
import { fatosLocais } from '../src/roadmap-status';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

const FIM = '2026-10-02T12:00:00.000Z';
const BATIDA = '2026-10-02T12:45:00.000Z';
const SEGUINTE = '2026-10-02T13:00:00.000Z';
/** Dominio reservado (RFC 2606): nenhum teste aponta para um host que pode existir. */
const HOST_PROPRIO = 'ghe.example.com';

const git = (dir: string, ...args: string[]) => {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
type Projeto = ReturnType<typeof projetoTemporario>;

/** A thread #Auto com a branch publicada no remoto bare e o fim de turno que o observador grava (Stop e `blocked`). */
function threadPublicada(p: Projeto, nome: string, n: number) {
  const { thread: t } = novaThread(p.carregado, { nome, modo: 'auto' });
  const branch = `ork/${t.slug}`;
  git(p.dir, 'branch', branch, 'main');
  git(p.dir, 'checkout', '-q', branch);
  fs.writeFileSync(path.join(p.dir, `${t.slug}.txt`), `produto SIMULADO ${randomUUID()}\n`);
  git(p.dir, 'add', '--', `${t.slug}.txt`);
  git(p.dir, 'commit', '-q', '-m', `produto de ${t.slug}`);
  git(p.dir, 'checkout', '-q', 'main');
  git(p.dir, 'push', '-q', 'origin', branch);
  const dir = dirThread(p.dir, t.id), sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const despachoEm = '2026-10-02T10:00:00.001Z', stop = '2026-10-02T11:59:48.000Z';
  registrar(dir, t.id, 'phase_dispatch', { ts: '2026-10-02T10:00:00.000Z', fase: 'GOAL', slug: `${t.id}-full`, modo: 'auto',
    bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', pausaAoFim: false, runtime: 'claude-bg', sessionId });
  registrar(dir, t.id, 'runtime_stop', { ts: stop, fase: 'GOAL', sessionId, runtime: 'claude-bg', despachoEm, fonte: 'ork sessions event',
    sensor: 'stop', sensorEventId: 'a'.repeat(64) });
  const comum = { ts: FIM, fase: 'GOAL', sessionId, despachoEm, classificacao: 'gate_blocked', motivo: 'human.pending', runtime: 'claude-bg',
    fonte: 'Stop correlacionado e sessão viva à espera humana (blocked); SIMULADO', estadoNativo: 'blocked', statusNativo: 'idle', ok: false,
    estado: 'bloqueada', stop: { ts: stop, sensorEventId: 'a'.repeat(64) }, provaOrk: { ok: true, fonte: 'SIMULADO' }, gate: 'phase.dispatch',
    origem: 'sessions.watch' };
  registrar(dir, t.id, 'gate_blocked', comum);
  registrar(dir, t.id, 'phase_result', comum);
  return { t, branch, head: git(p.dir, 'rev-parse', branch) };
}

/**
 * O `gh` simulado: conta e guarda cada chamada; `auth` diz se ha login no host (`falha` e o `auth status` que nao
 * respondeu: host fora do ar ou prazo estourado), `prs` responde o `pr list`. O texto sem login e o do `gh` 2.46.
 */
function ghSimulado(opcoes: { auth?: boolean | 'falha'; prs?: unknown[] } = {}) {
  const chamadas: string[][] = [];
  const executor: ExecutorDoGh = (args) => {
    chamadas.push([...args]);
    if (args[0] === 'auth') {
      if (opcoes.auth === 'falha') return { status: 1, stdout: '', stderr: `error connecting to ${args[3]}: dial tcp: i/o timeout` };
      return opcoes.auth ? { status: 0, stdout: '', stderr: '' } : { status: 1, stdout: '', stderr: `You are not logged into any accounts on ${args[3]}` };
    }
    return { status: 0, stdout: JSON.stringify(args.includes('--state=open') ? opcoes.prs ?? [] : []), stderr: '' };
  };
  return { chamadas, executor };
}

const pulsar = (p: Projeto, quando: string, executor: ExecutorDoGh) =>
  montarPulse(p.carregado, { quando, consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' }, executorDoGh: executor });

test('A5: com o remoto no GitLab, o pulse diz uma vez que a forja nao tem leitura de PR, e nenhuma linha diz "PR nao lido"', () => {
  const p = projetoTemporario('fatia5-a5-gitlab', true);
  try {
    const a = threadPublicada(p, 'branch publicada no gitlab', 31);
    git(p.dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/grupo/simulado.git');
    const gh = ghSimulado({ auth: true });
    const leitura = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: gh.executor });
    assert.equal(leitura.ok, false);
    assert.deepEqual(!leitura.ok && leitura.semLeitura, { remoto: 'origin', host: 'gitlab.com' });

    const primeira = pulsar(p, BATIDA, gh.executor);
    assert.match(primeira.runtime.detalhe, /prs\.sem-leitura: a forja de origin \(gitlab\.com\) é um GitLab/);
    assert.ok(!primeira.runtime.detalhe.includes('prs.nao-lidos'), primeira.runtime.detalhe);
    assert.match(textoDoPulse(primeira), /\[diagnostico\] .*prs\.sem-leitura/);
    const linha = primeira.paradoNoCondutor?.find((x) => x.thread === a.t.id);
    assert.equal(linha?.proximoPasso, `conferir na forja o PR da branch ${a.branch} e seguir`);
    const segunda = pulsar(p, SEGUINTE, gh.executor);
    assert.ok(!/prs\.(sem-leitura|nao-lidos)/.test(segunda.runtime.detalhe), `a segunda batida nao repete: ${segunda.runtime.detalhe}`);
    assert.ok(!textoDoPulse(segunda).includes('PR não lido'), textoDoPulse(segunda));
    assert.deepEqual(gh.chamadas, [], 'GitLab nao chama o gh');
    // O status do roadmap, sem rede: o estado diz a forja, e a linha so o passo.
    const entrega = fatosLocais(p.dir, SEGUINTE).find((f) => f.id === a.t.id)?.entrega?.();
    assert.equal(entrega?.estado, 'branch publicada, forja sem leitura de PR');
    assert.equal(entrega?.parado?.proximoPasso, `conferir na forja o PR da branch ${a.branch} e seguir`);
  } finally { p.limpar(); }
});

test('A5: caminho local e host proprio sem login do gh sao forja sem leitura; so o auth status roda no host proprio', () => {
  const p = projetoTemporario('fatia5-a5-sem-login', true);
  try {
    threadPublicada(p, 'branch publicada no remoto local', 32);
    const gh = ghSimulado({ auth: false });
    const local = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: gh.executor });
    assert.deepEqual(!local.ok && local.semLeitura, { remoto: 'origin', host: null });
    assert.deepEqual(gh.chamadas, []);
    git(p.dir, 'remote', 'set-url', 'origin', `https://${HOST_PROPRIO}/dono/simulado.git`);
    const proprio = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: gh.executor });
    assert.deepEqual(!proprio.ok && proprio.semLeitura, { remoto: 'origin', host: HOST_PROPRIO });
    assert.deepEqual(gh.chamadas, [['auth', 'status', '--hostname', HOST_PROPRIO]], 'nenhum gh pr list');
    // No pulse, o host proprio sem login e dito uma vez.
    const antes = pulsar(p, BATIDA, gh.executor), depois = pulsar(p, SEGUINTE, gh.executor);
    assert.match(antes.runtime.detalhe, new RegExp(`prs\\.sem-leitura: o gh não está autenticado em ${HOST_PROPRIO.replace(/\./g, '\\.')}`));
    assert.ok(!depois.runtime.detalhe.includes('prs.sem-leitura'));
  } finally { p.limpar(); }
});

test('A5: GitHub Enterprise com o gh autenticado no host le os PRs pelo host do remoto, e o retrato guarda o host', () => {
  const p = projetoTemporario('fatia5-a5-ghe', true);
  try {
    const a = threadPublicada(p, 'branch publicada no ghe', 33);
    git(p.dir, 'remote', 'set-url', 'origin', `git@${HOST_PROPRIO}:dono/simulado.git`);
    const aberto = { number: 7, state: 'OPEN', headRefName: a.branch, headRefOid: a.head, baseRefName: 'main', isDraft: false,
      isCrossRepository: false, url: `https://${HOST_PROPRIO}/dono/simulado/pull/7`, createdAt: '2026-10-02T12:05:00Z', mergedAt: null,
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'SUCCESS',
        startedAt: '2026-10-02T12:06:00Z', completedAt: '2026-10-02T12:10:00Z' }] };
    const gh = ghSimulado({ auth: true, prs: [aberto] });
    const pulse = pulsar(p, BATIDA, gh.executor);
    assert.deepEqual(gh.chamadas[0], ['auth', 'status', '--hostname', HOST_PROPRIO]);
    assert.ok(gh.chamadas.slice(1).every((c) => c[0] === 'pr' && c[2] === `--repo=${HOST_PROPRIO}/dono/simulado`), JSON.stringify(gh.chamadas));
    assert.equal(pulse.paradoNoCondutor?.find((x) => x.thread === a.t.id)?.proximoPasso, 'mergear o PR #7');
    const retrato = lerRetratoDePrs(p.dir);
    assert.deepEqual([retrato?.host, retrato?.repositorio], [HOST_PROPRIO, 'dono/simulado']);
    // O status le o retrato, sem rede.
    assert.equal(fatosLocais(p.dir, BATIDA).find((f) => f.id === a.t.id)?.entrega?.()?.estado, 'PR #7 com os checks verdes, esperando o merge');
    // O retrato do github.com com o mesmo dono/nome nao vale para o host proprio.
    const doGithub: RetratoDePrs = { contrato: CONTRATO_PRS, lidoEm: BATIDA, repositorio: 'dono/simulado', base: 'main', parcial: false, prs: [] };
    const r = entregasDoProjeto(p.carregado, { quando: BATIDA, lerPrs: () => ({ ok: true, retrato: doGithub }) });
    assert.equal(r.estados.find((e) => e.thread === a.t.id)?.prNaoLido, 'retrato de PRs de outro repositório ou base');
  } finally { p.limpar(); }
});

test('A5: o auth status que falha por rede ou prazo e "PR nao lido" desta batida, sem marca nem forja sem leitura', () => {
  // Aviso da rodada 1 do CHECK: so o "not logged into" e estado da forja; o resto e falha passageira.
  const p = projetoTemporario('fatia5-a5-auth-falha', true);
  try {
    const a = threadPublicada(p, 'ghe fora do ar', 35);
    git(p.dir, 'remote', 'set-url', 'origin', `https://${HOST_PROPRIO}/dono/simulado.git`);
    const gh = ghSimulado({ auth: 'falha' });
    const leitura = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: gh.executor });
    assert.equal(leitura.ok, false);
    assert.equal(!leitura.ok && leitura.semLeitura, undefined);
    for (const quando of [BATIDA, SEGUINTE]) {
      const pulse = pulsar(p, quando, gh.executor);
      assert.match(pulse.runtime.detalhe, /prs\.nao-lidos: gh auth status --hostname ghe\.example\.com falhou/, quando);
      assert.equal(pulse.paradoNoCondutor?.find((x) => x.thread === a.t.id)?.proximoPasso,
        `conferir o PR da branch ${a.branch} (PR não lido) e seguir`);
    }
    assert.ok(!fs.existsSync(path.join(p.dir, '.orkastery', 'monitor', 'forja-sem-leitura.json')), 'nenhuma marca');
    // E o gh ausente (sem codigo de saida) tambem.
    const ausente: ExecutorDoGh = () => ({ status: null, stdout: '', stderr: 'spawnSync gh ENOENT' });
    const semGh = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: ausente });
    assert.equal(!semGh.ok && semGh.semLeitura, undefined);
  } finally { p.limpar(); }
});

test('A5: o SSH do github.com pela porta 443 e o github.com; apelido de SSH sem dominio e forja sem leitura, com o motivo certo', () => {
  const p = projetoTemporario('fatia5-a5-ssh', true);
  try {
    threadPublicada(p, 'branch pelo ssh 443', 36);
    git(p.dir, 'remote', 'set-url', 'origin', 'ssh://git@ssh.github.com:443/dono/simulado.git');
    const gh = ghSimulado({ auth: false });
    const leitura = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: gh.executor });
    assert.equal(leitura.ok, true, JSON.stringify(leitura));
    assert.ok(gh.chamadas.every((c) => c[0] === 'pr' && c[2] === '--repo=github.com/dono/simulado'), JSON.stringify(gh.chamadas));
    git(p.dir, 'remote', 'set-url', 'origin', 'git@github-trabalho:dono/simulado.git');
    const apelido = lerPrsDaForja(p.carregado, { quando: BATIDA, executor: gh.executor });
    assert.deepEqual(!apelido.ok && [apelido.semLeitura, apelido.erro],
      [{ remoto: 'origin', host: null }, 'o remoto origin não tem host de forja (caminho local ou apelido de SSH)']);
  } finally { p.limpar(); }
});

test('A5: a leitura que volta apaga a marca, e a forja que perde a leitura de novo e dita de novo', () => {
  const p = projetoTemporario('fatia5-a5-volta', true);
  try {
    const a = threadPublicada(p, 'ghe que perde o login', 34);
    git(p.dir, 'remote', 'set-url', 'origin', `https://${HOST_PROPRIO}/dono/simulado.git`);
    const semLogin = ghSimulado({ auth: false }), comLogin = ghSimulado({ auth: true });
    assert.match(pulsar(p, BATIDA, semLogin.executor).runtime.detalhe, /prs\.sem-leitura/);
    assert.ok(!pulsar(p, SEGUINTE, comLogin.executor).runtime.detalhe.includes('prs.'), 'a leitura voltou');
    assert.ok(fs.existsSync(path.join(p.dir, '.orkastery', 'monitor', 'prs.json')));
    assert.ok(!fs.existsSync(path.join(p.dir, '.orkastery', 'monitor', 'forja-sem-leitura.json')), 'a marca saiu');
    assert.match(pulsar(p, '2026-10-02T13:15:00.000Z', semLogin.executor).runtime.detalhe, /prs\.sem-leitura/, 'dita de novo');
    // Um retrato gravado antes nao confunde o status: a marca e mais nova que ele, e a forja segue sem leitura.
    gravarRetratoDePrs(p.dir, { contrato: CONTRATO_PRS, lidoEm: '2026-10-02T13:15:00.000Z', repositorio: 'dono/simulado', base: 'main',
      parcial: false, prs: [] });
    assert.equal(fatosLocais(p.dir, '2026-10-02T13:20:00.000Z').find((f) => f.id === a.t.id)?.entrega?.()?.estado,
      'branch publicada, forja sem leitura de PR');
  } finally { p.limpar(); }
});

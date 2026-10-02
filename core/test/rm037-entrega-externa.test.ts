/**
 * RM-037 (rm037defeito, defeito 5): a ork-siteshomesco entregou pelos PRs orkastery.com #6 e orkmind.com
 * #8, e o nucleo so aceitava merge `ship(<thread>)` no proprio repositorio: a entrega virou decisao
 * autonoma, sem `ship_done`. O repositorio externo declarado no manifesto passa a ter o mesmo caminho,
 * com a mesma exigencia de merge provado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { ExecutorGitHub, registrarEntregaExternaPorPr, registrarEntregaPorPr } from '../src/entrega-pr';
import { ExecutorCi } from '../src/ci';
import { carregarManifesto } from '../src/manifest';
import { lerLedger } from '../src/ledger';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const MERGE = 'e29d05e7a3c3e94129bb7dcc6ca66e292e27466a', HEAD_PR = '14b264e40c04b0bbb1ce36338208197f6ddec6ff';
const PONTA = 'a'.repeat(40);

/** GitHub SIMULADO: respostas por caminho da API, e o registro de cada consulta. */
function github(respostas: Record<string, unknown>) {
  const chamadas: string[] = [];
  const executor: ExecutorGitHub = (caminho) => {
    chamadas.push(caminho);
    return caminho in respostas
      ? { ok: true, stdout: JSON.stringify(respostas[caminho]), stderr: '', code: 0 }
      : { ok: false, stdout: '', stderr: 'HTTP 404', code: 1 };
  };
  return { executor, chamadas };
}

/** O PR mesclado como a API devolve; o corpo cita a thread, como os PRs reais da ork-siteshomesco. */
const prMesclado = (thread: string, pr: Record<string, unknown> = {}) => ({
  'repos/orkastery/orkastery.com': { default_branch: 'main' },
  'repos/orkastery/orkastery.com/pulls/6': { merged: true, merge_commit_sha: MERGE, html_url: 'https://github.com/orkastery/orkastery.com/pull/6',
    title: 'Homes completas', body: `Thread ${thread}: homes e Contribuir.`, base: { ref: 'main' }, head: { sha: HEAD_PR, ref: 'site/homes' }, ...pr },
  'repos/orkastery/orkastery.com/branches/main': { commit: { sha: PONTA } },
  [`repos/orkastery/orkastery.com/compare/${MERGE}...${PONTA}`]: { status: 'ahead' },
});

function projeto(nome: string, declarados: Record<string, string>) {
  const p = projetoTemporario(nome);
  p.carregado.manifesto.ci.required_for_ship = true;
  p.carregado.manifesto.ci.external_repositories = declarados;
  const t = novaThread(p.carregado, { nome: 'sites', modo: 'auto' }).thread;
  return { p, t, dir: dirThread(p.dir, t.id) };
}

test('defeito 5: PR mesclado em repositorio declarado sem CI vira ship_done com o merge provado; nao registra duas vezes', () => {
  const { p, t, dir } = projeto('rm037-externa', { 'orkastery/orkastery.com': '' });
  try {
    // O caminho antigo nao tinha como: ele so procura ship(<thread>) no origin local.
    assert.equal(registrarEntregaPorPr(p.carregado, t.id, { buscar: false, publicar: false }).acao, 'sem-merge');
    const gh = github(prMesclado(t.id));
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh.executor, publicar: false });
    assert.equal(r.acao, 'registrou', r.motivo);
    const e = lerLedger(dir).find(x => x.tipo === 'ship_done')!;
    assert.deepEqual([e.repositorio, e.pr, e.mergeSha, e.shaDe, e.shaRemoto, e.pushVerificado, e.tipoDeAutorizacao, e.para],
      ['orkastery/orkastery.com', 6, MERGE, HEAD_PR, PONTA, true, 'pr-externo', 'orkastery/orkastery.com:main']);
    assert.match(String(e.fonteDaProva), new RegExp(`compare/${MERGE}\\.\\.\\.${PONTA} \\(status ahead`));
    assert.deepEqual(e.evidencia, { viaPr: true, externo: true, ciExigido: false, ci: null });
    assert.equal(lerThread(p.dir, t.id).faseAtual, 'SHIP');
    const de_novo = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh.executor, publicar: false });
    assert.equal(de_novo.acao, 'ja-registrada');
    assert.equal(lerLedger(dir).filter(x => x.tipo === 'ship_done').length, 1);
  } finally { p.limpar(); }
});

test('defeito 5: recusa repositorio nao declarado, PR aberto e merge fora da ponta da base, sem gravar nada', () => {
  const { p, t, dir } = projeto('rm037-externa-recusas', { 'orkastery/orkastery.com': '' });
  try {
    const nada = github({});
    const fora = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkmind.com', pr: 8, executorGitHub: nada.executor, publicar: false });
    assert.equal(fora.acao, 'recusada');
    assert.match(fora.motivo, /nao esta declarado em ci\.external_repositories/);
    assert.deepEqual(nada.chamadas, [], 'repositorio nao declarado nem chega ao GitHub');

    const aberto = github({ 'repos/orkastery/orkastery.com/pulls/6': { merged: false, merge_commit_sha: null, base: { ref: 'main' }, head: { sha: HEAD_PR } } });
    assert.equal(registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: aberto.executor, publicar: false }).acao, 'sem-merge');

    const divergente = github({ ...prMesclado(t.id), [`repos/orkastery/orkastery.com/compare/${MERGE}...${PONTA}`]: { status: 'diverged' } });
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: divergente.executor, publicar: false });
    assert.equal(r.acao, 'recusada');
    assert.match(r.motivo, /nao esta na ponta de orkastery\/orkastery\.com:main/);
    assert.equal(lerLedger(dir).some(x => x.tipo === 'ship_done'), false);
  } finally { p.limpar(); }
});

test('defeito 5: repositorio declarado com check exige o CI verde no head do PR', () => {
  const { p, t, dir } = projeto('rm037-externa-ci', { 'orkastery/orkastery.com': 'build' });
  try {
    const gh = github(prMesclado(t.id));
    const ci = (conclusion: string): ExecutorCi => ({ repository, sha, context }) => {
      assert.deepEqual([repository, sha, context], ['orkastery/orkastery.com', HEAD_PR, 'build']);
      return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ check_runs: [{ name: 'build', status: 'completed', conclusion, html_url: 'https://ci.example/1' }] }) };
    };
    const vermelho = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh.executor, executorCi: ci('failure'), publicar: false });
    assert.equal(vermelho.acao, 'recusada');
    assert.match(vermelho.motivo, /sem CI verde no head do PR/);
    assert.equal(lerLedger(dir).some(x => x.tipo === 'ship_done'), false);
    const verde = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh.executor, executorCi: ci('success'), publicar: false });
    assert.equal(verde.acao, 'registrou', verde.motivo);
    const e = lerLedger(dir).find(x => x.tipo === 'ship_done')!;
    assert.deepEqual((e.evidencia as { ciExigido: boolean; ci: { state: string; context: string } }).ci, { state: 'success', context: 'build', url: 'https://ci.example/1', sha: HEAD_PR });
  } finally { p.limpar(); }
});

test('defeito 5: o manifesto le ci.external_repositories e recusa forma invalida; o CLI exige --repo com --pr', () => {
  const p = projetoTemporario('rm037-externa-manifesto');
  try {
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(arquivo, 'utf8');
    const comBloco = (bloco: string) => original.replace(/^ci:\n/m, `ci:\n${bloco}`);
    assert.ok(/^ci:\n/m.test(original), 'o manifesto gerado tem a secao ci');
    fs.writeFileSync(arquivo, comBloco('  external_repositories:\n    "orkastery/orkastery.com": ""\n    orkastery/orkmind.com: build\n'));
    const lido = carregarManifesto(p.dir)!;
    assert.deepEqual(lido.erros, []);
    assert.deepEqual(lido.manifesto.ci.external_repositories, { 'orkastery/orkastery.com': '', 'orkastery/orkmind.com': 'build' });
    fs.writeFileSync(arquivo, comBloco('  external_repositories:\n    so-o-nome: ""\n'));
    assert.match(carregarManifesto(p.dir)!.erros.join('\n'), /"so-o-nome" nao e dono\/nome do GitHub/);
    fs.writeFileSync(arquivo, original);
    assert.deepEqual(carregarManifesto(p.dir)!.manifesto.ci.external_repositories, {});

    const t = novaThread(p.carregado, { nome: 'cli', modo: 'auto' }).thread;
    const ork = (args: string[]) => {
      try { return { codigo: 0, saida: execFileSync(process.execPath, [ORK, ...args], { cwd: p.dir, encoding: 'utf8', stdio: 'pipe' }) }; }
      catch (e) { const x = e as { status?: number; stdout?: string; stderr?: string }; return { codigo: x.status ?? -1, saida: `${x.stdout ?? ''}${x.stderr ?? ''}` }; }
    };
    const semPr = ork(['ship', 'registrar-pr', t.id, '--repo', 'orkastery/orkastery.com']);
    assert.equal(semPr.codigo, 2); assert.match(semPr.saida, /--repo <dono\/nome> --pr <n>/);
    const naoDeclarado = ork(['ship', 'registrar-pr', t.id, '--repo', 'orkastery/orkastery.com', '--pr', '6']);
    assert.equal(naoDeclarado.codigo, 1);
    assert.match(naoDeclarado.saida, /nao esta declarado em ci\.external_repositories/);
  } finally { p.limpar(); }
});

test('defeito 5 (A4, S9): o PR precisa citar a thread e ter entrado na branch padrao; a fase so avanca', () => {
  const { p, t, dir } = projeto('rm037-externa-vinculo', { 'orkastery/orkastery.com': '' });
  try {
    const registrar = (gh: ReturnType<typeof github>) =>
      registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh.executor, publicar: false });
    const semVinculo = registrar(github(prMesclado(t.id, { body: 'Thread ork-outra-coisa: homes.', title: 'Homes' })));
    assert.equal(semVinculo.acao, 'recusada');
    assert.match(semVinculo.motivo, new RegExp(`nao cita a thread ${t.id}`));
    const prefixo = registrar(github(prMesclado(t.id, { body: `Thread ${t.id}x: homes.` })));
    assert.equal(prefixo.acao, 'recusada', 'id que so comeca igual nao e vinculo');
    const empilhado = registrar(github({ ...prMesclado(t.id, { base: { ref: 'feature/base' } }),
      'repos/orkastery/orkastery.com/branches/feature%2Fbase': { commit: { sha: PONTA } } }));
    assert.equal(empilhado.acao, 'recusada');
    assert.match(empilhado.motivo, /entrou em feature\/base, e a branch padrao de orkastery\/orkastery\.com e main/);
    assert.equal(lerLedger(dir).some(x => x.tipo === 'ship_done'), false);

    // Pela branch do PR tambem vale; e a thread ja no MASTER nao volta ao SHIP.
    const t2 = lerThread(p.dir, t.id); t2.faseAtual = 'MASTER'; gravarThread(p.dir, t2);
    const pelaBranch = registrar(github(prMesclado(t.id, { body: null, head: { sha: HEAD_PR, ref: `site/${t.id}` } })));
    assert.equal(pelaBranch.acao, 'registrou', pelaBranch.motivo);
    assert.equal(lerThread(p.dir, t.id).faseAtual, 'MASTER');
  } finally { p.limpar(); }
});

test('defeito 5 (N4, G3): a branch ork/<thread>-full e o id em maiusculas valem; consulta falha diz que falhou', () => {
  const { p, t, dir } = projeto('rm037-externa-branch', { 'orkastery/orkastery.com': '' });
  try {
    const registrar = (gh: ReturnType<typeof github>) =>
      registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh.executor, publicar: false });
    const respostas = prMesclado(t.id) as Record<string, unknown>;
    delete respostas['repos/orkastery/orkastery.com'];
    const falhou = registrar(github(respostas));
    assert.equal(falhou.acao, 'recusada');
    assert.match(falhou.motivo, /a consulta de orkastery\/orkastery\.com ao GitHub falhou/);
    const maiusculas = registrar(github(prMesclado(t.id, { body: `Entrega da ${t.id.toUpperCase()}.` })));
    assert.equal(maiusculas.acao, 'registrou', maiusculas.motivo);
    assert.equal(lerLedger(dir).filter(x => x.tipo === 'ship_done').length, 1);
  } finally { p.limpar(); }
  const outro = projeto('rm037-externa-branch-ork', { 'orkastery/orkastery.com': '' });
  try {
    const r = registrarEntregaExternaPorPr(outro.p.carregado, outro.t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, publicar: false,
      executorGitHub: github(prMesclado(outro.t.id, { body: null, title: 'Entrega', head: { sha: HEAD_PR, ref: `ork/${outro.t.id}-full` } })).executor });
    assert.equal(r.acao, 'registrou', r.motivo);
  } finally { outro.p.limpar(); }
});

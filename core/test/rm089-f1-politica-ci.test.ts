/** RM-089 F1: política empresarial de recibo no `ork ci run`. */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executarCiDaBranch, prepararBundleCi, publicarAvisoDaPolitica, type EstadoDoReciboCi } from '../src/ci';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { comLocale } from '../src/locale';
import { carregarManifesto, type ManifestoCarregado } from '../src/manifest';
import { CONTRATO_DO_RECIBO_DE_PROVA } from '../src/recibo-prova';
import { dirThread, novaThread } from '../src/thread';
import type { PoliticaDeReciboCi } from '../src/types';
import { commitar, projetoTemporario, shaDaBranch } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function comPolitica(valor?: string) {
  const p = projetoTemporario(`rm089-politica-${valor ?? 'ausente'}`, false);
  const arquivo = path.join(p.dir, 'orkastery.yaml');
  if (valor !== undefined) {
    const atual = fs.readFileSync(arquivo, 'utf8');
    fs.writeFileSync(arquivo, atual.replace('  context: ork-verify\n', `  context: ork-verify\n  politica_recibo: ${valor}\n`));
  }
  return { p, carregado: carregarManifesto(p.dir)! };
}

test('manifesto sem política preserva a ausência; os níveis conhecidos são aceitos', () => {
  const sem = comPolitica();
  try {
    assert.deepEqual(sem.carregado.erros, []);
    assert.equal('politica_recibo' in sem.carregado.manifesto.ci, false);
  } finally { sem.p.limpar(); }
  for (const nivel of ['observar', 'avisar', 'exigir'] as const) {
    const c = comPolitica(nivel);
    try {
      assert.deepEqual(c.carregado.erros, []);
      assert.equal(c.carregado.manifesto.ci.politica_recibo, nivel);
    } finally { c.p.limpar(); }
  }
});

test('manifesto recusa política de recibo desconhecida com mensagem acionável', () => {
  const c = comPolitica('tolerar');
  try {
    assert.ok(c.carregado.erros.some((e) => /ci\.politica_recibo invalida.*observar, avisar ou exigir/.test(e)), c.carregado.erros.join(' | '));
  } finally { c.p.limpar(); }
});

type CasoDeRecibo = 'sem-bundle' | 'valido' | 'invalido' | 'sha-divergente' | 'legado';
type RamoDaMatriz = 'ork' | 'feature' | 'protegida';
type ResultadoComPolitica = ReturnType<typeof executarCiDaBranch> & {
  policy: { level: PoliticaDeReciboCi; receipt: EstadoDoReciboCi };
  error?: { code: string; message: string };
};

const estadoEsperado: Record<CasoDeRecibo, EstadoDoReciboCi> = {
  'sem-bundle': 'ausente', valido: 'presente', invalido: 'invalido', 'sha-divergente': 'sha-divergente', legado: 'ausente',
};

function comNivel(carregado: ManifestoCarregado, nivel?: PoliticaDeReciboCi): ManifestoCarregado {
  const ci = { ...carregado.manifesto.ci };
  if (nivel === undefined) delete ci.politica_recibo;
  else ci.politica_recibo = nivel;
  return { ...carregado, manifesto: { ...carregado.manifesto, ci } };
}

function fixtureDaMatriz(ramo: RamoDaMatriz, caso: CasoDeRecibo) {
  const p = projetoTemporario(`rm089-${ramo}-${caso}`, false);
  const branch = ramo === 'ork' ? 'ork/ork-rm089-full' : ramo === 'feature' ? 'feature/pagamentos' : 'main';
  const contexto = ramo === 'protegida' ? { destino: null, pullRequest: false } : { destino: 'main', pullRequest: true };
  const headDoRecibo = shaDaBranch(p.dir, 'main');
  if (caso !== 'sem-bundle') {
    const recibo = caso === 'legado' ? undefined : caso === 'invalido'
      ? { contrato: 'ork.recibo-prova/v0', head: headDoRecibo, sha256: 'x' }
      : { contrato: CONTRATO_DO_RECIBO_DE_PROVA, head: headDoRecibo, sha256: 'a'.repeat(64) };
    const bundle = {
      schema: 'ork.ci-bundle/v1', thread: 'ork-rm089', branch, base: 'main', claims: [], commands: [],
      ...(recibo ? { recibo } : {}),
    };
    commitar(p.dir, '.ork-ci/ork-rm089.json', `${JSON.stringify(bundle, null, 2)}\n`, 'fixture: bundle');
    if (caso === 'sha-divergente') commitar(p.dir, 'produto.txt', 'mudanca posterior\n', 'fixture: produto posterior');
  }
  return { p, branch, contexto };
}

test('matriz de política, ramo e recibo preserva aprovação opt-in e aplica exigir somente a PR/MR', () => {
  const niveis: Array<PoliticaDeReciboCi | undefined> = [undefined, 'observar', 'avisar', 'exigir'];
  const ramos: RamoDaMatriz[] = ['ork', 'feature', 'protegida'];
  const casos: CasoDeRecibo[] = ['sem-bundle', 'valido', 'invalido', 'sha-divergente', 'legado'];
  for (const ramo of ramos) for (const caso of casos) {
    const f = fixtureDaMatriz(ramo, caso);
    try {
      for (const nivel of niveis) {
        const carregado = comNivel(f.p.carregado, nivel);
        if (nivel === undefined && ramo === 'ork' && caso === 'sem-bundle') {
          assert.throws(() => executarCiDaBranch(carregado, f.branch, f.contexto), /ci\.bundle\.ausente/);
          continue;
        }
        const resultado = executarCiDaBranch(carregado, f.branch, f.contexto);
        if (nivel === undefined) {
          assert.equal('policy' in resultado, false, `${ramo}/${caso}: opt-out não ganha saída nova`);
          assert.equal('error' in resultado, false, `${ramo}/${caso}: opt-out não ganha erro novo`);
          assert.equal(resultado.ok, true, `${ramo}/${caso}: opt-out preserva aprovação`);
          continue;
        }
        const comPolicy = resultado as ResultadoComPolitica;
        assert.equal(comPolicy.policy.level, nivel);
        assert.equal(comPolicy.policy.receipt, estadoEsperado[caso]);
        const bundleAusenteDeThread = ramo === 'ork' && caso === 'sem-bundle';
        const exigido = nivel === 'exigir' && ramo !== 'protegida' && caso !== 'valido';
        assert.equal(resultado.ok, !bundleAusenteDeThread && !exigido, `${nivel}/${ramo}/${caso}`);
        assert.equal(resultado.ok ? 0 : 1, !bundleAusenteDeThread && !exigido ? 0 : 1,
          `${nivel}/${ramo}/${caso}: código de saída`);
        if (exigido) assert.equal(comPolicy.error?.code, `ci.recibo.${estadoEsperado[caso]}`);
      }
    } finally { f.p.limpar(); }
  }
});

test('bundle realmente truncado entra na política e preserva o erro legado sem opt-in', () => {
  const f = fixtureDaMatriz('ork', 'legado');
  try {
    fs.writeFileSync(path.join(f.p.dir, '.ork-ci/ork-rm089.json'), '{"schema":"ork.ci-bundle/v1",\n', 'utf8');
    assert.throws(() => executarCiDaBranch(comNivel(f.p.carregado), f.branch, f.contexto), /ci\.bundle\.invalido/);
    for (const nivel of ['observar', 'avisar'] as const) {
      const resultado = executarCiDaBranch(comNivel(f.p.carregado, nivel), f.branch, f.contexto) as ResultadoComPolitica;
      assert.equal(resultado.policy.receipt, 'invalido');
      assert.equal(resultado.ok, false);
      assert.equal(resultado.error?.code, 'ci.bundle.invalido');
    }
    const exigido = executarCiDaBranch(comNivel(f.p.carregado, 'exigir'), f.branch, f.contexto) as ResultadoComPolitica;
    assert.equal(exigido.policy.receipt, 'invalido');
    assert.equal(exigido.ok, false);
    assert.equal(exigido.error?.code, 'ci.recibo.invalido');
  } finally { f.p.limpar(); }
});

test('sem política mantém a forma histórica para branch de thread e para outra branch', () => {
  const thread = fixtureDaMatriz('ork', 'legado');
  const outra = fixtureDaMatriz('feature', 'sem-bundle');
  try {
    const daThread = executarCiDaBranch(comNivel(thread.p.carregado), thread.branch);
    assert.deepEqual(Object.keys(daThread).sort(), ['branch', 'bundle', 'claims', 'commands', 'commit', 'ok', 'preparo', 'schema', 'thread']);
    assert.equal(daThread.bundle, '.ork-ci/ork-rm089.json');
    const semThread = executarCiDaBranch(comNivel(outra.p.carregado), outra.branch);
    assert.deepEqual(Object.keys(semThread).sort(), ['branch', 'bundle', 'claims', 'commands', 'commit', 'ok', 'preparo', 'schema', 'thread']);
    assert.equal(semThread.thread, null);
    assert.equal(semThread.bundle, null);
  } finally { thread.p.limpar(); outra.p.limpar(); }
});

test('CLI real sem política fixa JSON, texto e código de saída históricos nas três classes de branch', () => {
  const fixtures = [fixtureDaMatriz('ork', 'legado'), fixtureDaMatriz('feature', 'sem-bundle'),
    fixtureDaMatriz('protegida', 'sem-bundle')];
  const chavesHistoricas = ['branch', 'bundle', 'claims', 'commands', 'commit', 'ok', 'preparo', 'schema', 'thread'];
  try {
    for (const f of fixtures) {
      const r = spawnSync(process.execPath, [CLI, 'ci', 'run', '--branch', f.branch],
        { cwd: f.p.dir, encoding: 'utf8', env: process.env, timeout: 60_000 });
      assert.equal(r.error, undefined, `${f.branch}: ${r.error?.message ?? ''}`);
      assert.equal(r.status, 0, `${f.branch}: ${r.stderr}${r.stdout}`);
      assert.equal(r.stderr, '', `${f.branch}: stderr histórico`);
      const json = JSON.parse(r.stdout) as Record<string, unknown>;
      assert.equal(r.stdout, `${JSON.stringify(json, null, 2)}\n`, `${f.branch}: stdout contém somente o JSON histórico`);
      assert.deepEqual(Object.keys(json).sort(), chavesHistoricas, `${f.branch}: forma histórica`);
      assert.equal(json.ok, true);
      assert.equal('policy' in json, false);
      assert.equal('error' in json, false);
      if (f.branch.startsWith('ork/')) assert.equal(json.bundle, '.ork-ci/ork-rm089.json');
      else assert.deepEqual([json.thread, json.bundle], [null, null]);
    }
  } finally { for (const f of fixtures) f.p.limpar(); }
});

test('todos os erros de recibo têm mensagem e ação em pt-BR e EN', () => {
  const acaoPorEstado = {
    ausente: /ork thread new.*ork adotar/,
    invalido: /ork ci prepare/,
    'sha-divergente': /ork verify.*ork ci prepare/,
  } as const;
  for (const caso of ['sem-bundle', 'invalido', 'sha-divergente'] as const) {
    const f = fixtureDaMatriz('feature', caso);
    try {
      const carregado = comNivel(f.p.carregado, 'exigir');
      const pt = comLocale('pt-BR', () => executarCiDaBranch(carregado, f.branch, f.contexto)) as ResultadoComPolitica;
      const en = comLocale('en', () => executarCiDaBranch(carregado, f.branch, f.contexto)) as ResultadoComPolitica;
      const estado = caso === 'sem-bundle' ? 'ausente' : caso;
      const acao = acaoPorEstado[estado];
      assert.equal(pt.error?.code, `ci.recibo.${estado}`);
      assert.match(pt.error?.message ?? '', acao);
      assert.equal(en.error?.code, `ci.recibo.${estado}`);
      assert.match(en.error?.message ?? '', acao);
      assert.notEqual(pt.error?.message, en.error?.message);
    } finally { f.p.limpar(); }
  }
});

test('exigir não trata PR para outro destino como PR para a branch protegida', () => {
  const f = fixtureDaMatriz('feature', 'sem-bundle');
  try {
    const resultado = executarCiDaBranch(comNivel(f.p.carregado, 'exigir'), f.branch,
      { destino: 'integracao', pullRequest: true }) as ResultadoComPolitica;
    assert.equal(resultado.policy.receipt, 'ausente');
    assert.equal(resultado.policy.level, 'exigir');
    assert.equal(resultado.ok, true);
    assert.equal(resultado.error, undefined);
  } finally { f.p.limpar(); }
});

test('avisar usa anotação e resumo no GitHub e log no GitLab', () => {
  const p = projetoTemporario('rm089-avisos', false);
  try {
    const summary = path.join(p.dir, 'summary.md');
    const resultado = { policy: { level: 'avisar', receipt: 'ausente',
      message: 'falta 100% do recibo\nuse ork thread new ou ork adotar' } };
    const log: string[] = [];
    const github = publicarAvisoDaPolitica(resultado,
      { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary }, (linha) => log.push(linha));
    assert.deepEqual(github, log);
    assert.equal(github[0], '::warning title=Orkastery::falta 100%25 do recibo%0Ause ork thread new ou ork adotar');
    assert.match(fs.readFileSync(summary, 'utf8'), /\[!WARNING\].*falta 100% do recibo\nuse ork thread new ou ork adotar/s);
    const logGitlab: string[] = [];
    const gitlab = publicarAvisoDaPolitica(resultado, { GITLAB_CI: 'true' }, (linha) => logGitlab.push(linha));
    assert.deepEqual(gitlab, [
      'WARNING: falta 100% do recibo',
      'WARNING: use ork thread new ou ork adotar',
    ]);
    assert.deepEqual(logGitlab, gitlab);
    assert.doesNotThrow(() => publicarAvisoDaPolitica(resultado,
      { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path.join(p.dir, 'inexistente', 'summary.md') }, () => undefined));
    assert.equal(publicarAvisoDaPolitica(resultado, { GITHUB_ACTIONS: 'true' }, () => undefined)[0], github[0],
      'a anotação continua disponível sem GITHUB_STEP_SUMMARY');
    assert.deepEqual(publicarAvisoDaPolitica({ policy: { ...resultado.policy, level: 'observar' } },
      { GITHUB_ACTIONS: 'true' }), []);
  } finally { p.limpar(); }
});

test('referências públicas fixam níveis, estados e a fronteira de confiança em pt-BR e EN', () => {
  const raiz = path.resolve(__dirname, '../../..');
  const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
  const cliPt = ler('docs/referencia/cli.md'), cliEn = ler('docs/referencia/cli.en.md');
  assert.match(cliPt, /ci\.politica_recibo.*observar.*avisar.*exigir.*ausente.*inválido.*divergente.*guia da política/s);
  assert.match(cliEn, /ci\.politica_recibo.*observar.*avisar.*exigir.*missing.*invalid.*divergent.*company policy guide/s);

  const guiaPt = ler('docs/guias/politica-de-recibo-da-empresa.pt-BR.md');
  assert.match(guiaPt, /bundle e o `sha256`.*próprio PR\/MR.*podem ser forjados/s);
  assert.match(guiaPt, /runner não consulta nem confere.*ledger/s);
  assert.match(guiaPt, /reexecuta no HEAD.*claims.*comandos.*ancestralidade.*diff posterior/s);
  assert.match(guiaPt, /garantia contra forja.*recibo assinado.*F7/s);

  const guiaEn = ler('docs/guias/politica-de-recibo-da-empresa.md');
  assert.match(guiaEn, /bundle and the receipt's `sha256`.*PR\/MR itself.*forge them/s);
  assert.match(guiaEn, /runner does not query.*ledger.*compare the receipt/s);
  assert.match(guiaEn, /reruns.*claims and commands.*HEAD.*ancestry.*diff/s);
  assert.match(guiaEn, /Protection against forgery.*signed receipt.*F7/s);

  const forja = ler('docs/referencia/contratos/forja.md');
  assert.match(forja, /bundle e o `sha256`.*próprio PR\/MR.*podem ser forjados/s);
  assert.match(forja, /não consulta nem.*ledger.*somente reexecuta.*claims.*comandos.*HEAD.*ancestralidade.*diff/s);
  assert.match(forja, /garantia contra forja.*recibo assinado.*F7/s);
});

test('ci prepare projeta somente o recibo do verify verde integral mais recente', () => {
  const p = projetoTemporario('rm089-prepare-recibo', false);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'recibo do bundle', modo: 'auto' });
    const head = shaDaBranch(p.dir, 'main');
    const recibo = { contrato: CONTRATO_DO_RECIBO_DE_PROVA, head, claimsSha256: 'b'.repeat(64),
      planoSha256: 'c'.repeat(64), dependenciasExternas: [], sha256: 'd'.repeat(64) };
    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao,
      { veredito: 'verdade sustentada', parcial: false, recibo });
    const arquivo = prepararBundleCi(p.carregado, thread.id);
    assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')).recibo,
      { contrato: CONTRATO_DO_RECIBO_DE_PROVA, head, sha256: recibo.sha256 });
    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao,
      { veredito: 'reprovado', parcial: false, recibo });
    prepararBundleCi(p.carregado, thread.id);
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).recibo, undefined);
  } finally { p.limpar(); }
});

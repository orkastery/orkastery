/** RM-089 F1: política empresarial de recibo no `ork ci run`. */
import { strict as assert } from 'node:assert';
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

test('erros de recibo têm código estável e ação em pt-BR e EN', () => {
  const f = fixtureDaMatriz('feature', 'sem-bundle');
  try {
    const carregado = comNivel(f.p.carregado, 'exigir');
    const pt = comLocale('pt-BR', () => executarCiDaBranch(carregado, f.branch, f.contexto)) as ResultadoComPolitica;
    const en = comLocale('en', () => executarCiDaBranch(carregado, f.branch, f.contexto)) as ResultadoComPolitica;
    assert.equal(pt.error?.code, 'ci.recibo.ausente');
    assert.match(pt.error?.message ?? '', /ork thread new.*ork adotar/);
    assert.equal(en.error?.code, 'ci.recibo.ausente');
    assert.match(en.error?.message ?? '', /ork thread new.*ork adotar/);
    assert.notEqual(pt.error?.message, en.error?.message);
  } finally { f.p.limpar(); }
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
    const resultado = { policy: { level: 'avisar', receipt: 'ausente', message: 'falta recibo; use ork thread new ou ork adotar' } };
    const log: string[] = [];
    const github = publicarAvisoDaPolitica(resultado,
      { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary }, (linha) => log.push(linha));
    assert.deepEqual(github, log);
    assert.match(github[0], /^::warning title=Orkastery::/);
    assert.match(fs.readFileSync(summary, 'utf8'), /\[!WARNING\].*ork thread new ou ork adotar/s);
    const gitlab = publicarAvisoDaPolitica(resultado, { GITLAB_CI: 'true' }, () => undefined);
    assert.match(gitlab[0], /^WARNING: .*ork adotar/);
    assert.doesNotThrow(() => publicarAvisoDaPolitica(resultado,
      { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path.join(p.dir, 'inexistente', 'summary.md') }, () => undefined));
    assert.deepEqual(publicarAvisoDaPolitica({ policy: { ...resultado.policy, level: 'observar' } },
      { GITHUB_ACTIONS: 'true' }), []);
  } finally { p.limpar(); }
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

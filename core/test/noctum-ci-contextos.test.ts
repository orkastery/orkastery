/**
 * RM-058, integração (T6 da ork-rm058integra, D10): a prova do CI da entrega do arco exige todos os contextos de
 * `ci.contexts` verdes no SHA fonte. Os nomes começam por PC. O remoto é um bare de verdade; sessões, pareceres, verifies e
 * o CI são SIMULADOS, com um estado por contexto.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, dirTemporario, ProjetoDeTeste } from './apoio';
import { entregaPronta, EstadoDoCheck, FORJA, projetoDaEntrega } from './noctum-entrega-apoio';
import { ExecutorCi } from '../src/ci';
import { carregarManifesto, exigirManifesto } from '../src/manifest';
import { contextosDoCi, provasDaEntrega, ProvasDaEntrega } from '../src/noctum-provas';
import { exec } from '../src/util';

const DOCS = 'documentacao (markdownlint e paridade)';

/** O CI simulado por contexto: o estado de cada nome de check, no SHA que for pedido; `chamadas` guarda contexto e SHA. */
function ciPorContexto(estados: Record<string, EstadoDoCheck>, chamadas: Array<[string, string]> = []): ExecutorCi {
  return ({ sha, context, caminho }) => {
    // A leitura do GitHub pela porta da forja pede também os commit statuses; este CI simulado só publica check-run.
    if (caminho?.includes('/statuses')) return { ok: true, stdout: '[]', stderr: '', code: 0 };
    chamadas.push([context, sha]);
    const estado = estados[context] ?? 'missing';
    if (estado === 'erro') return { ok: false, stdout: '', stderr: 'HTTP 502: gateway SIMULADO', code: 1 };
    const checks = estado === 'missing' ? [] : [{ name: context, status: estado === 'pending' ? 'in_progress' : 'completed',
      conclusion: estado === 'pending' ? null : estado, html_url: `https://exemplo.invalid/check/${sha.slice(0, 7)}`, app: { slug: 'github-actions' } }];
    return { ok: true, stdout: JSON.stringify({ check_runs: checks }), stderr: '', code: 0 };
  };
}

/** O manifesto do projeto com os dois contextos exigidos, na ordem. */
function doisContextos(p: ProjetoDeTeste): void {
  ajustarManifesto(p, '  context: ork-verify\n', `  context: ork-verify\n  contexts:\n    - "ork-verify"\n    - "${DOCS}"\n`);
}

const doCi = (r: ProvasDaEntrega) => r.provas.find(x => x.id === 'ci')!;

test('PC1: com dois contextos exigidos, os dois verdes no SHA fonte passam, e cada um é consultado nele', () => {
  const p = projetoDaEntrega('pc1');
  try {
    doisContextos(p);
    assert.deepEqual(contextosDoCi(p.carregado.manifesto), ['ork-verify', DOCS]);
    const e = entregaPronta(p, 'pc1');
    const chamadas: Array<[string, string]> = [];
    const r = provasDaEntrega(p.carregado, e.t.id, { forja: FORJA, executorCi: ciPorContexto({ 'ork-verify': 'success', [DOCS]: 'success' }, chamadas) });
    assert.equal(doCi(r).ok, true, doCi(r).detalhe);
    assert.equal(r.ok, true, JSON.stringify(r.provas.filter(x => !x.ok)));
    assert.match(doCi(r).detalhe, new RegExp(`^2 contextos verdes em ${e.fonte.slice(0, 12)}: ork-verify, documentacao \\(markdownlint e paridade\\)$`));
    assert.deepEqual(chamadas, [['ork-verify', e.fonte], [DOCS, e.fonte]]);
    const ev = doCi(r).evidencia as { contextos: Array<{ context: string; state: string }> };
    assert.deepEqual(ev.contextos.map(c => `${c.context}:${c.state}`), ['ork-verify:success', `${DOCS}:success`]);
  } finally { p.limpar(); }
});

test('PC2: um contexto vermelho bloqueia, com o contexto no detalhe, mesmo com os outros verdes ou sem leitura', () => {
  const p = projetoDaEntrega('pc2');
  try {
    doisContextos(p);
    const e = entregaPronta(p, 'pc2');
    const com = (estados: Record<string, EstadoDoCheck>) => doCi(provasDaEntrega(p.carregado, e.t.id, { forja: FORJA, executorCi: ciPorContexto(estados) }));
    const vermelho = com({ 'ork-verify': 'success', [DOCS]: 'failure' });
    assert.equal(vermelho.motivo, 'noctum.entrega.ci-vermelho');
    assert.match(vermelho.detalhe, /^documentacao \(markdownlint e paridade\) vermelho em /);
    // O vermelho vence a leitura que falhou noutro contexto: o arco não espera um verde que não vem.
    assert.equal(com({ 'ork-verify': 'erro', [DOCS]: 'failure' }).motivo, 'noctum.entrega.ci-vermelho');
  } finally { p.limpar(); }
});

test('PC3: um contexto pendente espera, e o que ninguém publicou espera como pendente; a leitura que falha também espera', () => {
  const p = projetoDaEntrega('pc3');
  try {
    doisContextos(p);
    const e = entregaPronta(p, 'pc3');
    const com = (estados: Record<string, EstadoDoCheck>) => doCi(provasDaEntrega(p.carregado, e.t.id, { forja: FORJA, executorCi: ciPorContexto(estados) }));
    const pendente = com({ 'ork-verify': 'success', [DOCS]: 'pending' });
    assert.equal(pendente.motivo, 'noctum.entrega.ci-pendente');
    assert.match(pendente.detalhe, /^documentacao \(markdownlint e paridade\) ainda sem verde em .* \(pending\)$/);
    const ausente = com({ 'ork-verify': 'success' });
    assert.equal(ausente.motivo, 'noctum.entrega.ci-pendente');
    assert.match(ausente.detalhe, /\(missing\)$/);
    assert.equal(com({ 'ork-verify': 'erro', [DOCS]: 'pending' }).motivo, 'noctum.entrega.ci-sem-leitura');
  } finally { p.limpar(); }
});

test('PC4: sem ci.contexts, o ci.context sozinho vale como antes: um contexto, a mesma prova e a mesma evidência', () => {
  const p = projetoDaEntrega('pc4');
  try {
    assert.equal(p.carregado.manifesto.ci.contexts, undefined);
    assert.deepEqual(contextosDoCi(p.carregado.manifesto), ['ork-verify']);
    const e = entregaPronta(p, 'pc4');
    const chamadas: Array<[string, string]> = [];
    const r = provasDaEntrega(p.carregado, e.t.id, { forja: FORJA, executorCi: ciPorContexto({ 'ork-verify': 'success', [DOCS]: 'failure' }, chamadas) });
    assert.equal(doCi(r).ok, true);
    assert.equal(doCi(r).detalhe, `ork-verify verde em ${e.fonte.slice(0, 12)}`);
    assert.deepEqual(Object.keys(doCi(r).evidencia).sort(), ['context', 'sha', 'state', 'url']);
    assert.deepEqual(chamadas, [['ork-verify', e.fonte]], 'o contexto que o manifesto não exige não é consultado');
  } finally { p.limpar(); }
});

test('PC5: o manifesto recusa ci.contexts vazio, com item que não é texto ou com nome repetido', () => {
  const dir = dirTemporario('pc5');
  try {
    exec('git', ['init', '-q', '-b', 'main'], dir);
    const base = fs.readFileSync(path.resolve(__dirname, '../../../orkastery.yaml'), 'utf8');
    const com = (lista: string) => {
      fs.writeFileSync(path.join(dir, 'orkastery.yaml'), base.replace(/\n  contexts:\n(?: {4}- .*\n)+/, `\n  contexts:${lista}\n`));
      return carregarManifesto(dir)!.erros.filter(x => x.startsWith('ci.contexts'));
    };
    assert.deepEqual(com('\n    - "ork-verify"\n    - "docs"'), []);
    assert.match(com(' []').join('; '), /ci\.contexts deve ser uma lista de 1 a 20 contextos/);
    assert.match(com('\n    - 3\n    - "ork-verify"').join('; '), /ci\.contexts: 3 não é o nome de um contexto de CI/);
    assert.match(com('\n    - ""').join('; '), /não é o nome de um contexto de CI/);
    assert.match(com('\n    - "ork-verify"\n    - "ork-verify"').join('; '), /ci\.contexts: "ork-verify" aparece duas vezes/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PC6: o manifesto deste repositório exige os quatro contextos da proteção da main e mantém o ci.context do ork ship', () => {
  const k = exigirManifesto(path.resolve(__dirname, '../../..'));
  assert.equal(k.manifesto.ci.context, 'ork-verify');
  assert.deepEqual(k.manifesto.ci.contexts, [DOCS, 'nucleo ork (build, testes, canarios) (20)', 'nucleo ork (build, testes, canarios) (22)',
    'ork-verify']);
});

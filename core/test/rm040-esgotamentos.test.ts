/**
 * RM-040 (B7): `ork accounts esgotamentos` mede a metrica do item.
 *
 * Duas fabricas temporarias apontam a mesma conta. A fabrica A marca a conta esgotada; os
 * despachos da fabrica B dentro do prazo contam, os de depois do prazo nao, e os da propria A
 * tambem nao (a metrica e de OUTRO projeto). O registro de contas e o de projetos moram nas
 * pastas isoladas do `apoio`; nenhum teste toca o home de quem roda a suite.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { contaOpaca, CONTRATO_ESGOTAMENTOS, relatorioDeEsgotamentos } from '../src/esgotamentos';
import { registrar } from '../src/ledger';
import { registrarProjeto } from '../src/projeto-alvo';
import { adicionarPerfil, caminhoRealDoPerfil, marcarFalhaDePerfil, perfilDeDespacho, lerPerfis } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';
import { ajustarManifesto, dirTemporario, projetoTemporario } from './apoio';

const MIN = 60 * 1000;
const CLI = path.resolve(__dirname, '../../dist/index.js');

function cenario(nome: string) {
  const a = projetoTemporario(`${nome}-a`), b = projetoTemporario(`${nome}-b`);
  const conta = dirTemporario(`${nome}-conta`);
  ajustarManifesto(a, /name: "orkastery"/, `name: "${nome}-a"`);
  ajustarManifesto(b, /name: "orkastery"/, `name: "${nome}-b"`);
  for (const p of [a, b]) {
    adicionarPerfil(p.dir, { id: p === a ? 'principal' : 'da-b', runtime: 'claude-bg', dir: conta });
    registrarProjeto(p.dir, 'init');
  }
  const agora = Date.now();
  const marcadaEm = agora - 30 * MIN, prazo = agora + 30 * MIN;
  marcarFalhaDePerfil(a.dir, 'principal', { estado: 'esgotado', esgotadoAte: new Date(prazo).toISOString(),
    motivo: 'runtime.quota-exhausted', detalhe: 'limite do plano', em: new Date(marcadaEm).toISOString() });
  const despachar = (p: typeof a, idPerfil: string, emMs: number) => {
    const t = novaThread(p.carregado, { nome: `despacho ${emMs}`, modo: 'auto' }).thread;
    const perfil = perfilDeDespacho(lerPerfis(p.dir).perfis.find((x) => x.id === idPerfil)!);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { ts: new Date(emMs).toISOString(), fase: 'GOAL',
      runtime: 'claude-bg', sessionId: `s-${emMs}`, perfil });
    return t.id;
  };
  return {
    a, b, conta, agora, marcadaEm, prazo, despachar,
    limpar: () => { a.limpar(); b.limpar(); fs.rmSync(conta, { recursive: true, force: true }); },
  };
}

test('despacho de outro projeto dentro do prazo da marca conta 1; depois do prazo, 0; do mesmo projeto, 0', () => {
  const c = cenario('esg-janela');
  try {
    const dentro = c.despachar(c.b, 'da-b', c.marcadaEm + 10 * MIN);
    c.despachar(c.b, 'da-b', c.marcadaEm - 10 * MIN); // antes da marca
    c.despachar(c.a, 'principal', c.marcadaEm + 10 * MIN); // o projeto que marcou
    c.despachar(c.b, 'da-b', c.prazo + 10 * MIN); // depois do prazo

    const r = relatorioDeEsgotamentos({ desde: '1d', agoraMs: c.prazo + 60 * MIN });
    assert.equal(r.contrato, CONTRATO_ESGOTAMENTOS);
    assert.equal(r.total, 1, 'so o despacho da B dentro da janela');
    assert.equal(r.despachos[0].thread, dentro);
    assert.equal(r.despachos[0].perfil, 'da-b');
    assert.equal(r.despachos[0].conta, contaOpaca(`claude-bg:${caminhoRealDoPerfil(c.conta)}`));
    assert.equal(r.despachos[0].projeto, 'esg-janela-b');
    assert.equal(r.despachos[0].marcadaPor, 'esg-janela-a', 'a marca e de outro projeto');
    assert.equal(r.projetos.find((p) => p.nome === 'esg-janela-b')?.despachosComPerfil, 3);
    assert.equal(r.marcas.length, 1);
    assert.equal(r.marcas[0].estado, 'esgotado');
    assert.equal(r.marcas[0].projeto, 'esg-janela-a');

    // Fora da janela de leitura, nada conta.
    assert.equal(relatorioDeEsgotamentos({ desde: '5m', agoraMs: c.prazo + 60 * MIN }).total, 0);
  } finally { c.limpar(); }
});

test('a saida --json da CLI nao tem diretorio de conta, so o id do perfil e a conta opaca', () => {
  const c = cenario('esg-cli');
  try {
    c.despachar(c.b, 'da-b', c.marcadaEm + 5 * MIN);
    const r = spawnSync(process.execPath, [CLI, 'accounts', 'esgotamentos', '--desde', '7d', '--json'],
      { cwd: c.a.dir, encoding: 'utf8', env: process.env, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.equal(saida.contrato, CONTRATO_ESGOTAMENTOS);
    assert.equal(saida.total, 1);
    assert.equal(saida.despachos[0].perfil, 'da-b');
    for (const proibido of [c.conta, caminhoRealDoPerfil(c.conta), path.basename(c.conta)])
      assert.equal(r.stdout.includes(proibido), false, `a saida vazou ${proibido}`);

    const texto = spawnSync(process.execPath, [CLI, 'accounts', 'esgotamentos'], { cwd: c.a.dir, encoding: 'utf8', env: process.env, timeout: 60000 });
    assert.equal(texto.status, 0, texto.stderr);
    assert.match(texto.stdout, /despachos em conta marcada por outro projeto: 1/);
    assert.equal(texto.stdout.includes(c.conta), false);
  } finally { c.limpar(); }
});

test('sem marca no registro o total e 0 e o periodo invertido e recusado', () => {
  const p = projetoTemporario('esg-vazio');
  try {
    const r = spawnSync(process.execPath, [CLI, 'accounts', 'esgotamentos', '--json', '--desde', '1h'],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ORK_CONTAS_DIR: path.join(dirTemporario('esg-vazio-contas'), 'private') }, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 0);
    assert.deepEqual(JSON.parse(r.stdout).marcas, []);
    const ruim = spawnSync(process.execPath, [CLI, 'accounts', 'esgotamentos', '--desde', 'ontem-a-noite'],
      { cwd: p.dir, encoding: 'utf8', env: process.env, timeout: 60000 });
    assert.equal(ruim.status, 2);
    assert.match(ruim.stderr, /ledger\.period\.invalid/);
  } finally { p.limpar(); }
});

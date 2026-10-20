/**
 * O prazo interno do security_scan (ORK_SECURITY_SCAN_DEADLINE_MS): o verify e o bundle do CI exportam
 * `prazo - min(300 s, prazo/4)` ao rodar o scan, e a claim cujo comando e o `verify.security_scan` roda com o prazo dele.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { adicionarClaim } from '../src/claims';
import { executarBundleCi } from '../src/ci';
import { novaThread } from '../src/thread';
import { executorDoManifesto, prazoDaExecucao, prazoInternoDoScan, verificar } from '../src/verify';
import type { ManifestoCarregado } from '../src/manifest';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

// O comando falso do scan imprime o prazo que recebeu; o nome da variavel fica fora da expansao do YAML.
const SCAN = 'echo "deadline=${ORK_SECURITY_SCAN_DEADLINE_MS:-ausente}"';

function comScan(p: ProjetoDeTeste, prazoDoScan: number): ManifestoCarregado {
  return { ...p.carregado, manifesto: { ...p.carregado.manifesto,
    verify: { security_scan: SCAN, timeout_ms: 20_000, timeout_ms_por_comando: { security_scan: prazoDoScan } } } };
}

test('o prazo interno desconta min(300 s, prazo/4)', () => {
  assert.equal(prazoInternoDoScan(900_000), 675_000);
  assert.equal(prazoInternoDoScan(40_000), 30_000);
  assert.equal(prazoInternoDoScan(2_000_000), 1_700_000);
  assert.equal(prazoInternoDoScan(1_201_000), 901_000);
});

test('verify: o security_scan recebe o prazo interno no ambiente; os outros comandos nao', () => {
  const p = projetoTemporario('scan-prazo-verify');
  try {
    const carregado = comScan(p, 40_000);
    carregado.manifesto.verify.test = 'echo "test=${ORK_SECURITY_SCAN_DEADLINE_MS:-ausente}"';
    const t = novaThread(p.carregado, { nome: 'prazo', modo: 'auto' }).thread;
    const r = verificar(carregado, t.id);
    const scan = r.comandos.find((c) => c.nome === 'security_scan');
    assert.equal(scan?.prazoMs, 40_000);
    assert.match(scan?.resumo ?? '', /^deadline=30000$/m, scan?.resumo);
    assert.match(r.comandos.find((c) => c.nome === 'test')?.resumo ?? '', /test=ausente/);
  } finally { p.limpar(); }
});

test('claim cujo comando e o verify.security_scan roda com o prazo e o ambiente do scan', () => {
  const p = projetoTemporario('scan-prazo-claim');
  try {
    const carregado = comScan(p, 40_000);
    const t = novaThread(p.carregado, { nome: 'prazo-claim', modo: 'auto' }).thread;
    const doScan = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'scan limpo', verificar: [SCAN] });
    const outra = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'outra', verificar: ['echo "x=${ORK_SECURITY_SCAN_DEADLINE_MS:-ausente}"'] });
    assert.equal(prazoDaExecucao(carregado.manifesto, `${doScan.id}.1`, SCAN), 40_000);
    assert.equal(prazoDaExecucao(carregado.manifesto, `${outra.id}.1`, 'true'), 20_000, 'claim comum fica no default');
    const r = verificar(carregado, t.id, { soClaims: true });
    const execScan = r.claims.find((c) => c.claim.id === doScan.id)?.execucoes[0];
    assert.equal(execScan?.prazoMs, 40_000);
    assert.match(execScan?.resumo ?? '', /deadline=30000/);
    const execOutra = r.claims.find((c) => c.claim.id === outra.id)?.execucoes[0];
    assert.equal(execOutra?.prazoMs, 20_000);
    assert.match(execOutra?.resumo ?? '', /x=ausente/);
  } finally { p.limpar(); }
});

test('ork ci run: o security_scan do bundle (prefixado REQUIRED) e a claim do scan recebem o prazo interno', () => {
  const p = projetoTemporario('scan-prazo-ci');
  try {
    const carregado = comScan(p, 1_201_000);
    const file = `${p.dir}/bundle.json`;
    fs.writeFileSync(file, JSON.stringify({
      schema: 'ork.ci-bundle/v1', thread: 'ork-scan-prazo', base: 'main',
      claims: [{ id: 'C1', thread: 'ork-scan-prazo', fase: 'CHECK', arquivo: 'README.md', alegacao: 'scan limpo', negativa: false,
        verificar: [SCAN], criadoEm: new Date().toISOString(), estado: 'pendente' }],
      commands: [{ name: 'security_scan', command: `ORK_SECURITY_SCAN_REQUIRED=1 ${SCAN}` }],
    }));
    const r = executarBundleCi(carregado, file);
    assert.equal(r.commands[0].prazoMs, 1_201_000);
    assert.match(r.commands[0].resumo, /deadline=901000/);
    assert.equal(r.claims[0].execucoes[0].prazoMs, 1_201_000);
    assert.match(r.claims[0].execucoes[0].resumo, /deadline=901000/);
    // Comando que nao e o scan nao ganha a variavel.
    assert.match(executorDoManifesto(carregado.manifesto)('test', 'echo "y=${ORK_SECURITY_SCAN_DEADLINE_MS:-ausente}"', p.dir).resumo, /y=ausente/);
  } finally { p.limpar(); }
});

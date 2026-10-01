/**
 * I-33 (D14 e D16, GO-FIX 1 e 2 do CHECK aa279e17, achado A3): a troca automatica entre perfis do
 * MESMO runtime e governada pelo manifesto. Pela decisao do dono em 19/09/2026 (D16),
 * `runtime_profiles.rotate_same_runtime_on_quota` vem LIGADA: esgotamento de cota, credito ou
 * limite do plano troca para o proximo perfil ativo do mesmo runtime (a D5). A chave continua
 * existindo para o operador desligar: desligada, a cota esgotada marca o perfil, NAO troca para
 * outro perfil do mesmo runtime, segue para o fallback entre runtimes e depois para a fila.
 * `rotate_same_runtime_on_auth` segue ligada. A troca manual pelo operador segue.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ajustarManifesto, desligarRotacaoPorCota, ligarRotacaoPorCota, projetoTemporario, runtimePorConta } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { encerrarController } from '../src/adapters/codex-controller';
import { lerLedger } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import { rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { adicionarPerfil, desativarPerfil, lerPerfis, politicaDeRotacao } from '../src/runtime-profiles';
import { editarBloco } from '../src/setup';
import { dirThread, novaThread } from '../src/thread';

const SEM_CREDITO = 'Error: Your workspace is out of credits';
const rotacoesEntrePerfis = (dir: string, runtime: string) => lerLedger(dir).filter(e => e.tipo === 'runtime_profile_rotated' &&
  (e.de as { runtime?: string } | undefined)?.runtime === runtime && (e.para as { runtime?: string } | null)?.runtime === runtime);

test('D16 manifesto: por cota e por login ligadas por padrao; valor invalido vira o padrao com aviso; o operador desliga', () => {
  const p = projetoTemporario('politica-manifesto');
  try {
    assert.deepEqual(p.carregado.manifesto.runtime_profiles, { rotate_same_runtime_on_quota: true, rotate_same_runtime_on_auth: true, distribuir: 'ordem' });
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nruntime_profiles:\n  rotate_same_runtime_on_quota: talvez\n  rotate_same_runtime_on_auth: false\n');
    const lido = exigirManifesto(p.dir);
    assert.deepEqual(lido.manifesto.runtime_profiles, { rotate_same_runtime_on_quota: true, rotate_same_runtime_on_auth: false, distribuir: 'ordem' });
    assert.ok(lido.avisos.some(a => a.includes('runtime_profiles.rotate_same_runtime_on_quota deve ser true ou false; vale o padrao true')),
      lido.avisos.join('; '));
    ajustarManifesto(p, 'rotate_same_runtime_on_quota: talvez', 'rotate_same_runtime_on_quota: false');
    assert.equal(p.carregado.manifesto.runtime_profiles.rotate_same_runtime_on_quota, false);
  } finally { p.limpar(); }
});

test('D14 chave desligada pelo operador: cota esgotada marca o perfil, nao troca para outro perfil do mesmo runtime e vai a fila', () => {
  const p = projetoTemporario('politica-desligada');
  const claude = runtimePorConta('politica-off');
  try {
    desligarRotacaoPorCota(p);
    claude.conta(p.dir, 'a', { falha: `${SEM_CREDITO}. Try again in 2 hours.` });
    const contaB = claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'off', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.motivo, 'runtime.quota-exhausted');
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(rotacoesEntrePerfis(dir, 'claude-bg').length, 0, 'nenhum runtime_profile_rotated entre perfis do mesmo runtime');
    assert.equal(claude.envs().includes(`--bg ${contaB}`), false, 'o perfil b nunca recebeu o prompt');
    assert.equal(retry.fila.length, 1, retry.detalhe);
    const a = lerPerfis(p.dir).perfis.find(q => q.id === 'a')!;
    assert.equal(a.estado, 'esgotado');
    assert.equal(retry.fila[0].liberaEm, a.esgotadoAte, 'a fila espera o perfil que segura o runtime');
    assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'b')?.estado, 'ativo');

    // Novo despacho do mesmo runtime tambem nao escapa do limite pela conta b.
    const t2 = novaThread(p.carregado, { nome: 'off-2', modo: 'auto' }).thread;
    const r2 = rodarFase(p.carregado, t2.id, { fase: 'GOAL', prompt: 'outro objetivo SIMULADO' });
    assert.deepEqual([r2.bloqueado, r2.motivo], [true, 'runtime.quota-exhausted']);
    assert.equal(claude.envs().includes(`--bg ${contaB}`), false);

    // Troca manual e explicita do operador continua possivel: desativar a devolve a vez a b.
    desativarPerfil(p.dir, 'a');
    const t3 = novaThread(p.carregado, { nome: 'off-3', modo: 'auto' }).thread;
    const r3 = rodarFase(p.carregado, t3.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO pelo operador' });
    assert.equal(r3.verificada, true, r3.erro);
    assert.equal((lerLedger(dirThread(p.dir, t3.id)).find(e => e.tipo === 'phase_dispatch')?.perfil as { id: string }).id, 'b');
  } finally { p.limpar(); claude.restaurar(); }
});

test('D14 chave desligada pelo operador com fallback de runtime: a cota vai ao runtime da ordem do bloco, nunca ao outro perfil do mesmo runtime', () => {
  const p = projetoTemporario('politica-fallback');
  const f = controllerSimulado(p.dir);
  const claude = runtimePorConta('politica-fallback');
  const bin = path.join(p.dir, 'codex-conta-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh
if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi
exec ${JSON.stringify(path.join(p.dir, 'fake-bin', 'codex'))} "$@"
`, { mode: 0o755 });
  const anterior = process.env.PATH;
  process.env.PATH = `${bin}:${anterior ?? ''}`;
  let dir = '';
  try {
    desligarRotacaoPorCota(p);
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO'] }).ok, true);
    claude.conta(p.dir, 'a', { falha: SEM_CREDITO });
    const contaB = claude.conta(p.dir, 'b');
    const casaX = path.join(p.dir, 'contas', 'x');
    fs.mkdirSync(casaX, { recursive: true });
    fs.copyFileSync(path.join(f.runtimeHome, 'cenario.json'), path.join(casaX, 'cenario.json'));
    adicionarPerfil(p.dir, { id: 'x', runtime: 'codex', dir: casaX });
    const t = novaThread(p.carregado, { nome: 'fallback', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'FINALIZAR-SIMULADO: fatia' });
    assert.equal(r.motivo, 'runtime.quota-exhausted');
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const rotacoes = lerLedger(dir).filter(e => e.tipo === 'runtime_profile_rotated').map(e => [e.de, e.para]);
    assert.deepEqual(rotacoes, [[{ runtime: 'claude-bg', perfil: 'a' }, { runtime: 'codex', perfil: 'x' }]]);
    assert.equal(claude.envs().includes(`--bg ${contaB}`), false, 'o perfil b do mesmo runtime nao foi usado');
    esperarCondicao(() => fs.existsSync(path.join(casaX, 'rollout.jsonl')), 10000);
  } finally {
    if (dir) for (const e of lerLedger(dir)) {
      if (e.tipo !== 'phase_dispatch' || typeof e.controlador !== 'string') continue;
      try { const l = JSON.parse(fs.readFileSync(path.join(e.controlador, 'launch.json'), 'utf8')); encerrarController(e.controlador, l.vinculo, l.instancia, 8000); }
      catch { /* controller ja terminal */ }
    }
    process.env.PATH = anterior; claude.restaurar(); f.restaurar(); p.limpar();
  }
});

for (const chave of ['padrao', 'explicita'] as const) {
  test(`D16 troca por cota ligada (${chave}): o comportamento da D5 vale e a cota troca para o proximo perfil do mesmo runtime`, () => {
    const p = projetoTemporario(`politica-ligada-${chave}`);
    const claude = runtimePorConta(`politica-on-${chave}`);
    try {
      if (chave === 'explicita') ligarRotacaoPorCota(p);
      else assert.equal(fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8').includes('runtime_profiles'), false, 'sem chave no manifesto');
      claude.conta(p.dir, 'a', { falha: SEM_CREDITO });
      const contaB = claude.conta(p.dir, 'b');
      const t = novaThread(p.carregado, { nome: 'on', modo: 'auto' }).thread;
      const dir = dirThread(p.dir, t.id);
      rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
      const retry = executarRetry(p.carregado, t.id);
      assert.equal(retry.executada, true, retry.detalhe);
      assert.deepEqual(rotacoesEntrePerfis(dir, 'claude-bg').map(e => [e.de, e.para]),
        [[{ runtime: 'claude-bg', perfil: 'a' }, { runtime: 'claude-bg', perfil: 'b' }]]);
      assert.ok(claude.envs().includes(`--bg ${contaB}`));
    } finally { p.limpar(); claude.restaurar(); }
  });
}

test('D14 troca por login: ligada por padrao troca de perfil; desligada no manifesto, o login perdido bloqueia sem troca', () => {
  for (const ligada of [true, false]) {
    const p = projetoTemporario(`politica-auth-${ligada}`);
    const claude = runtimePorConta(`politica-auth-${ligada}`);
    try {
      if (!ligada) {
        fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nruntime_profiles:\n  rotate_same_runtime_on_auth: false\n');
        p.carregado = exigirManifesto(p.dir);
      }
      claude.conta(p.dir, 'a', { logado: false });
      const contaB = claude.conta(p.dir, 'b');
      const t = novaThread(p.carregado, { nome: 'auth', modo: 'auto' }).thread;
      const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
      assert.equal(lerPerfis(p.dir).perfis.find(q => q.id === 'a')?.estado, 'sem-auth');
      if (ligada) {
        assert.equal(r.verificada, true, r.erro);
        assert.ok(claude.envs().includes(`--bg ${contaB}`));
      } else {
        assert.deepEqual([r.bloqueado, r.motivo], [true, 'runtime.auth-missing']);
        assert.equal(claude.envs().includes(`--bg ${contaB}`), false);
      }
    } finally { p.limpar(); claude.restaurar(); }
  }
});

// ---------------------------------------------------------------------------
// I-33 (N2, CHECK-REVERIFY 8924757a): valor invalido na chave de desligar nunca liga a troca. So
// booleano vale direto; texto ou numero reconhecivel vale o que diz, com aviso; o resto vale o padrao
// documentado, com aviso. O aviso sai no proprio comando que usa a chave, nao so no `ork doctor`.
// ---------------------------------------------------------------------------

const CLI = path.resolve(__dirname, '../../dist/index.js');

function comChave(p: ReturnType<typeof projetoTemporario>, base: string, valor: string): ReturnType<typeof exigirManifesto> {
  fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), `${base}\nruntime_profiles:\n  rotate_same_runtime_on_quota: ${valor}\n`);
  return exigirManifesto(p.dir);
}

test('N2 leitura da chave: so booleano vale sem aviso; off, "false", 0 e "no" desligam com aviso; o nao reconhecido vale o padrao com aviso', () => {
  const p = projetoTemporario('politica-n2');
  try {
    const base = fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8');
    const casos: Array<[string, boolean, string | null]> = [
      ['false', false, null], ['true', true, null], ['no', false, null],
      ['off', false, '"off" lido como false'], ['OFF', false, '"OFF" lido como false'], ['"false"', false, '"false" lido como false'],
      ['0', false, '0 lido como false'], ['"no"', false, '"no" lido como false'], ['"nao"', false, '"nao" lido como false'],
      ['on', true, '"on" lido como true'], ['"true"', true, '"true" lido como true'], ['1', true, '1 lido como true'], ['"sim"', true, '"sim" lido como true'],
      ['talvez', true, 'vale o padrao true ("talvez" nao reconhecido)'], ['2', true, 'vale o padrao true (2 nao reconhecido)'],
      ['[]', true, 'vale o padrao true ([] nao reconhecido)'],
    ];
    for (const [valor, esperado, aviso] of casos) {
      const lido = comChave(p, base, valor);
      assert.equal(lido.manifesto.runtime_profiles.rotate_same_runtime_on_quota, esperado, `valor ${valor}`);
      assert.equal(politicaDeRotacao(lido.manifesto).mesmoRuntimePorCota, esperado, `politica com ${valor}`);
      const doCampo = lido.avisos.filter(a => a.startsWith('runtime_profiles.rotate_same_runtime_on_quota'));
      if (aviso === null) assert.deepEqual(doCampo, [], `booleano ${valor} nao avisa`);
      else assert.deepEqual(doCampo, [`runtime_profiles.rotate_same_runtime_on_quota deve ser true ou false; ${aviso}`], `valor ${valor}`);
    }
  } finally { p.limpar(); }
});

for (const valor of ['off', '"false"', '0', '"no"']) {
  test(`N2 chave ${valor}: cota esgotada nao troca para outro perfil do mesmo runtime e vai a fila`, () => {
    const p = projetoTemporario('politica-n2-valor');
    const claude = runtimePorConta('politica-n2');
    try {
      p.carregado = comChave(p, fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), valor);
      claude.conta(p.dir, 'a', { falha: `${SEM_CREDITO}. Try again in 2 hours.` });
      const contaB = claude.conta(p.dir, 'b');
      const t = novaThread(p.carregado, { nome: 'n2', modo: 'auto' }).thread;
      const dir = dirThread(p.dir, t.id);
      const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
      assert.equal(r.motivo, 'runtime.quota-exhausted');
      const retry = executarRetry(p.carregado, t.id);
      assert.equal(rotacoesEntrePerfis(dir, 'claude-bg').length, 0, `a chave ${valor} nao liga a troca entre perfis`);
      assert.equal(claude.envs().includes(`--bg ${contaB}`), false, 'o perfil b nunca recebeu o prompt');
      assert.equal(retry.fila.length, 1, retry.detalhe);
    } finally { p.limpar(); claude.restaurar(); }
  });
}

test('N2 aviso no proprio comando: accounts, retry e phase run imprimem o aviso da chave; chave booleana nao imprime nada', () => {
  const p = projetoTemporario('politica-n2-cli');
  try {
    const base = fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8');
    const t = novaThread(p.carregado, { nome: 'n2-cli', modo: 'auto' }).thread;
    const ork = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: p.dir, encoding: 'utf8' });
    const comandos = [['accounts', 'list'], ['retry', 'plan', t.id], ['phase', 'run', t.id, 'GOAL', '--prompt', 'objetivo SIMULADO', '--dry-run']];
    comChave(p, base, 'off');
    for (const args of comandos) {
      const r = ork(args);
      assert.match(r.stderr, /aviso: runtime_profiles\.rotate_same_runtime_on_quota deve ser true ou false; "off" lido como false/,
        `${args.join(' ')}: ${r.stderr}`);
    }
    comChave(p, base, 'false');
    for (const args of comandos) assert.doesNotMatch(ork(args).stderr, /runtime_profiles/, `${args.join(' ')} sem aviso com booleano`);
  } finally { p.limpar(); }
});

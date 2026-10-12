/**
 * RM-037 (ork-rm037esperas): as esperas que nunca terminam. Em 12/10/2026, sessoes de fase esperaram para sempre por
 * verify ou suite mandados para segundo plano com `&` (o processo morreu com a chamada) e por lacos de espera com
 * `pgrep -f` que acham a si mesmos, porque o proprio laco traz o texto procurado; e uma sessao parada com `claude stop`
 * antes do `phase_result` seguiu contando no `concurrency.max_parallel_threads` ate a thread fechar. Os nomes comecam
 * por R (a regra das esperas) e V (a vaga do `ork phase run`).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REGRA_DAS_ESPERAS, valoresDoPrompt } from '../src/phase';
import { renderizar, templateDaFase, threadDeExemplo } from '../src/prompts';
import { exigirCatalogo } from '../src/catalogo';
import { instalarAdaptador } from '../src/hosts';
import { Modo } from '../src/types';
import { esperarVaga, LeituraDoRuntime, leituraReaproveitada, vagaDoDespacho } from '../src/board';
import { registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { rodarFase } from '../src/phase';
import { SessaoDaConta } from '../src/sessoes-contas';
import { novaThread } from '../src/thread';
import { ajustarManifesto, envPtBr, ProjetoDeTeste, projetoTemporario } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const MODOS_VIVOS: Modo[] = ['classic', 'maestro', 'auto', 'fast'];
const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));

/** Quantas linhas do arquivo trazem a regra inteira. */
function linhasComARegra(arquivo: string): number {
  return fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l.includes(REGRA_DAS_ESPERAS)).length;
}

/** As skills do catalogo que a sessao de fase le (D4): a de entrada das duas instalacoes e as de GO e CHECK. */
const SKILLS_DO_CATALOGO = ['skills/core/orkastery-bootstrap/SKILL.md', 'skills/phases/go-implementation/SKILL.md',
  'skills/phases/check-quality/SKILL.md'];

/** Os seis agentes de fase do Claude Code: a secao "Regras que valem em toda fase" e a mesma neles (D10). */
const AGENTES = ['ork-goal', 'ork-plan', 'ork-go', 'ork-check', 'ork-ship', 'ork-master'].map((a) => `agents/${a}.md`);

/** Os guias dos adaptadores que a sessao de fase le (D4, D10), com a copia de cada um no marketplace do host. */
const GUIAS_DOS_ADAPTADORES: Record<string, string> = {
  'adapters/codex/skills/ork/SKILL.md': 'marketplaces/codex/orkastery/skills/ork/SKILL.md',
  ...Object.fromEntries(AGENTES.map((a) => [`adapters/claude-code/${a}`, `marketplaces/claude-code/orkastery/${a}`])),
};

/** O que a instalacao real de cada host de fase precisa levar com a regra, relativo ao destino da instalacao. */
const INSTALADOS: Record<'claude-code' | 'codex', string[]> = {
  'claude-code': [...SKILLS_DO_CATALOGO, ...AGENTES],
  codex: ['skills/ork/SKILL.md', ...SKILLS_DO_CATALOGO],
};

/** A secao comum dos agentes, do titulo ao fim do arquivo. */
function secaoComum(arquivo: string): string {
  const texto = fs.readFileSync(arquivo, 'utf8');
  return texto.slice(texto.indexOf('## Regras que valem em toda fase'));
}

test('R1: o prompt de toda fase, em todo modo, traz a regra das esperas numa linha so, uma vez, no lugar da linha da N2', () => {
  // Os tres pontos do pedido, um a um, numa linha so.
  for (const trecho of ['nunca dispare verify, build ou suite com `&` dentro do comando',
    'rode o `ork verify` em primeiro plano, com `timeout`', 'use a execucao em segundo plano do host, que avisa quando termina',
    'nunca espere com `pgrep -f` cujo padrao aparece no proprio comando', 'espere pelo arquivo de saida com prazo, ou pelo PID guardado']) {
    assert.ok(REGRA_DAS_ESPERAS.includes(trecho), trecho);
  }
  assert.ok(!REGRA_DAS_ESPERAS.includes('\n'), 'uma linha so');
  let prompts = 0;
  for (const modo of MODOS_VIVOS) {
    for (const fase of threadDeExemplo(modo, 'GO').fases) {
      const linhas = renderizar(templateDaFase(fase), valoresDoPrompt(threadDeExemplo(modo, fase), fase, 'pedido do builder')).split('\n');
      assert.equal(linhas.filter((l) => l === `- ${REGRA_DAS_ESPERAS}`).length, 1, `${modo} ${fase}`);
      assert.equal(linhas.filter((l) => l.includes('pgrep -f')).length, 1, `${modo} ${fase}`);
      assert.equal(linhas.some((l) => l.includes('Verify, build e suite rodam em primeiro plano')), false, 'a linha da N2 saiu');
      prompts++;
    }
  }
  assert.ok(prompts >= 7, `${prompts} prompts`);
  // O que o `ork prompt render` mostra, pelo CLI, fora de qualquer projeto.
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm037-render-'));
  try {
    const env = { ...process.env };
    delete env.ORK_PROJETO;
    delete env.ORK_PROJETO_EXPLICITO;
    const r = spawnSync(process.execPath, [ORK, 'prompt', 'render', '--exemplo', '--fase', 'GO', '--modo', 'auto'],
      { cwd: fora, encoding: 'utf8', env, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split('\n').includes(`- ${REGRA_DAS_ESPERAS}`), r.stdout);
  } finally { fs.rmSync(fora, { recursive: true, force: true }); }
});

test('R2: as skills do catalogo que a sessao de fase le trazem a regra numa linha, uma vez, e as copias dos marketplaces tambem', () => {
  for (const rel of SKILLS_DO_CATALOGO) {
    assert.equal(linhasComARegra(path.join(RAIZ, rel)), 1, rel);
    for (const host of ['claude-code', 'codex']) {
      const copia = path.join(RAIZ, 'marketplaces', host, 'orkastery', rel);
      assert.equal(linhasComARegra(copia), 1, copia);
    }
  }
  // O bootstrap segue no teto do catalogo (D5): a linha nova coube juntando duas linhas do mesmo paragrafo.
  assert.ok(fs.readFileSync(path.join(RAIZ, SKILLS_DO_CATALOGO[0]), 'utf8').split('\n').length <= 120);
});

test('R3: os guias dos adaptadores trazem a regra numa linha, uma vez, e o ork adapter install a leva para o que instala', () => {
  for (const [fonte, copia] of Object.entries(GUIAS_DOS_ADAPTADORES)) {
    assert.equal(linhasComARegra(path.join(RAIZ, fonte)), 1, fonte);
    assert.equal(linhasComARegra(path.join(RAIZ, copia)), 1, copia);
  }
  // A secao que vale em toda fase continua a mesma nos seis agentes, agora com a regra.
  const secoes = AGENTES.map((a) => secaoComum(path.join(RAIZ, 'adapters/claude-code', a)));
  assert.equal(new Set(secoes).size, 1, 'a secao comum dos agentes divergiu');
  assert.ok(secoes[0].includes(`- ${REGRA_DAS_ESPERAS}`));
  // A instalacao real num projeto temporario, nos dois hosts que rodam sessao de fase.
  for (const host of ['claude-code', 'codex'] as const) {
    const projeto = fs.mkdtempSync(path.join(os.tmpdir(), `ork-rm037-inst-${host}-`));
    try {
      const r = instalarAdaptador(host, { projeto, catalogo: RAIZ, orkBin: '/opt/ork/bin/ork' });
      assert.equal(r.ok, true, `${host}: ${JSON.stringify(r)}`);
      for (const rel of INSTALADOS[host]) assert.equal(linhasComARegra(path.join(r.destino, rel)), 1, `${host}: ${rel}`);
    } finally { fs.rmSync(projeto, { recursive: true, force: true }); }
  }
});

/** Uma thread com sessao viva: a conducao do despacho convertida em sessao, como o `phase run` deixa. */
function threadComSessao(p: ProjetoDeTeste, nome: string, sessionId: string, runtime = 'claude-bg'): string {
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GO', prazoMs: 3600_000 },
    { sessionId, runtime, perfil: null }), true);
  return t.id;
}

/** A leitura do runtime com estas sessoes, no formato de `consultarContas`; conta quantas vezes foi lida. */
function runtimeCom(sessoes: Array<Partial<SessaoDaConta> & { sessionId: string }>): { ler: LeituraDoRuntime; leituras: () => number } {
  let leituras = 0;
  return {
    ler: () => {
      leituras++;
      return { sessoes: sessoes.map((s) => ({ runtime: 'claude-bg', perfil: null, fantasma: false, viva: true, state: 'working', ...s }) as SessaoDaConta) };
    },
    leituras: () => leituras,
  };
}

const SESSAO = '00000000-0000-4000-8000-000000000037';

test('V1: no limite, a sessao que o runtime mostra parada (stopped) nao conta; trabalhando, conta', () => {
  const p = projetoTemporario('rm037-esperas-v1');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const ocupada = threadComSessao(p, 'parada com claude stop', SESSAO);
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const vaga = (sessoes: Array<Partial<SessaoDaConta> & { sessionId: string }>) =>
      vagaDoDespacho(p.carregado, nova.id, undefined, undefined, runtimeCom(sessoes).ler);
    // Controle: o lease de pe, com o runtime sem dizer nada dela, segue ocupando (ausencia nao prova nada).
    assert.deepEqual(vaga([])?.ocupam.map((o) => o.thread), [ocupada]);
    assert.deepEqual(vaga([{ sessionId: SESSAO, state: 'working' }])?.ocupam.map((o) => o.thread), [ocupada]);
    assert.equal(vaga([{ sessionId: SESSAO, state: 'stopped', viva: false }]), null);
  } finally { p.limpar(); }
});

test('V2: done, failed, completed, exited e fantasma (a blocked sem processo) soltam a vaga; blocked com processo e a parada de outra sessao contam', () => {
  const p = projetoTemporario('rm037-esperas-v2');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    threadComSessao(p, 'ocupada', SESSAO);
    const codex = '00000000-0000-4000-8000-000000000038';
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const vaga = (sessoes: Array<Partial<SessaoDaConta> & { sessionId: string }>) =>
      vagaDoDespacho(p.carregado, nova.id, undefined, undefined, runtimeCom(sessoes).ler);
    for (const state of ['done', 'failed', 'completed', 'exited', 'STOPPED']) {
      assert.equal(vaga([{ sessionId: SESSAO, state, viva: false }]), null, state);
    }
    assert.equal(vaga([{ sessionId: SESSAO, state: 'working', fantasma: true, viva: false }]), null, 'fantasma');
    assert.equal(vaga([{ sessionId: SESSAO, state: undefined, status: 'stopped', viva: false }]), null, 'status sem state');
    // S1 do CHECK: a `blocked` cujo processo saiu e fantasma (RM-056, D5) e solta; com o processo vivo, conta.
    assert.equal(vaga([{ sessionId: SESSAO, state: 'blocked', fantasma: true, viva: false }]), null, 'blocked sem processo');
    assert.ok(vaga([{ sessionId: SESSAO, state: 'blocked' }]), 'blocked com processo vivo conta');
    assert.ok(vaga([{ sessionId: codex, state: 'stopped', viva: false }]), 'a parada de outra sessao nao solta esta');
    // A sessao codex do lease, encerrada nos rollouts, tambem sai.
    const p2 = projetoTemporario('rm037-esperas-v2-codex');
    try {
      p2.carregado.manifesto.concurrency.max_parallel_threads = 1;
      threadComSessao(p2, 'ocupada codex', codex, 'codex');
      const outra = novaThread(p2.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
      assert.equal(vagaDoDespacho(p2.carregado, outra.id, undefined, undefined,
        runtimeCom([{ sessionId: codex, runtime: 'codex', state: 'completed', viva: false }]).ler), null);
    } finally { p2.limpar(); }
  } finally { p.limpar(); }
});

test('V3: a leitura do runtime que lanca nao solta vaga nenhuma', () => {
  const p = projetoTemporario('rm037-esperas-v3');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const ocupada = threadComSessao(p, 'ocupada', SESSAO);
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const falha: LeituraDoRuntime = () => { throw new Error('claude agents falhou SIMULADO'); };
    assert.deepEqual(vagaDoDespacho(p.carregado, nova.id, undefined, undefined, falha)?.ocupam.map((o) => o.thread), [ocupada]);
  } finally { p.limpar(); }
});

test('V4: abaixo do limite o runtime nao e lido; no limite, uma leitura so', () => {
  const p = projetoTemporario('rm037-esperas-v4');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 2;
    threadComSessao(p, 'primeira', SESSAO);
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const abaixo = runtimeCom([]);
    assert.equal(vagaDoDespacho(p.carregado, nova.id, undefined, undefined, abaixo.ler), null);
    assert.equal(abaixo.leituras(), 0, 'o despacho comum nao paga a consulta');
    threadComSessao(p, 'segunda', '00000000-0000-4000-8000-000000000039');
    const noLimite = runtimeCom([{ sessionId: SESSAO, state: 'stopped', viva: false }]);
    assert.equal(vagaDoDespacho(p.carregado, nova.id, undefined, undefined, noLimite.ler), null);
    assert.equal(noLimite.leituras(), 1);
  } finally { p.limpar(); }
});

/**
 * O `claude` falso fiel ao de verdade no que o portao le: `claude agents --json` sem `--all` so lista a sessao viva, e a
 * parada (`stopped`, `done`, `failed`) so aparece com `--all` (medido em 12/10/2026). A lista de cada estado mora em
 * `agents-<estado>.json`, e o estado, em `state`.
 */
function claudeFiel(dir: string): void {
  const script = ['#!/bin/sh', `D='${dir}'`, 'if [ "$1" = "--version" ]; then echo stub-rm037; exit 0; fi',
    'if [ "$1" != "agents" ]; then echo "stub-rm037: so agents" >&2; exit 2; fi', 'ESTADO=$(cat "$D/state")',
    'case " $* " in *" --all "*) TODAS=1 ;; *) TODAS=0 ;; esac',
    'case "$ESTADO" in done|stopped|failed) if [ "$TODAS" = 0 ]; then echo "[]"; exit 0; fi ;; esac',
    'cat "$D/agents-$ESTADO.json"', ''].join('\n');
  fs.writeFileSync(path.join(dir, 'claude'), script, { mode: 0o755 });
}

test('V5: o phase run em ensaio, a espera e o CLI despacham quando a sessao que ocupava esta stopped no runtime', () => {
  const p = projetoTemporario('rm037-esperas-v5');
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm037-v5-claude-'));
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm037-v5-casa-'));
  const pathAnterior = process.env.PATH;
  try {
    ajustarManifesto(p, 'max_parallel_threads: 3', 'max_parallel_threads: 1');
    threadComSessao(p, 'ocupada', SESSAO);
    claudeFiel(stub);
    // Trabalhando, o registro traz o pid do processo vivo; parada com `claude stop`, fica sem pid.
    const registro = (state: string, pid?: number) => JSON.stringify([{ id: SESSAO.slice(0, 8), sessionId: SESSAO, cwd: p.dir,
      kind: 'background', state, ...(pid ? { pid, status: 'busy' } : {}) }]);
    fs.writeFileSync(path.join(stub, 'agents-working.json'), registro('working', process.pid));
    fs.writeFileSync(path.join(stub, 'agents-stopped.json'), registro('stopped'));
    process.env.PATH = `${stub}:${pathAnterior ?? ''}`;
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const cli = () => spawnSync(process.execPath, [ORK, 'phase', 'run', nova.id, 'GOAL', '--prompt', 'objetivo SIMULADO', '--dry-run'],
      { cwd: p.dir, encoding: 'utf8', env: { ...envPtBr(), HOME: casa }, timeout: 120000 });
    // Trabalhando no runtime: o ensaio e o CLI recusam por vaga (saida 3).
    fs.writeFileSync(path.join(stub, 'state'), 'working');
    assert.equal(rodarFase(p.carregado, nova.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO', dryRun: true }).motivo, 'concurrency.limite');
    const recusado = cli();
    assert.equal(recusado.status, 3, `${recusado.stdout}${recusado.stderr}`);
    assert.match(`${recusado.stdout}${recusado.stderr}`, /concurrency\.limite/);
    // Parada com `claude stop`: so a lista com `--all` a mostra. O ensaio, a espera e o CLI passam do portao.
    fs.writeFileSync(path.join(stub, 'state'), 'stopped');
    assert.equal(spawnSync('claude', ['agents', '--json'], { encoding: 'utf8' }).stdout.trim(), '[]', 'sem --all a parada some');
    assert.notEqual(rodarFase(p.carregado, nova.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO', dryRun: true }).motivo, 'concurrency.limite');
    const inicio = Date.now();
    assert.equal(esperarVaga(p.carregado, nova.id, 60_000), true);
    assert.ok(Date.now() - inicio < 30_000, 'a vaga vem na primeira leitura, sem esperar o prazo');
    const liberado = cli();
    assert.equal(liberado.status, 0, `${liberado.stdout}${liberado.stderr}`);
    assert.doesNotMatch(`${liberado.stdout}${liberado.stderr}`, /concurrency\.limite/);
  } finally {
    process.env.PATH = pathAnterior;
    p.limpar();
    for (const d of [stub, casa]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('V6: a leitura reaproveitada consulta o runtime uma vez por janela, e a que lanca nao fica guardada', () => {
  let leituras = 0, relogio = 0, lanca = false;
  const ler = leituraReaproveitada(() => {
    leituras++;
    if (lanca) throw new Error('SIMULADO');
    return { sessoes: [] };
  }, 30_000, () => relogio);
  ler(); ler();
  assert.equal(leituras, 1);
  relogio = 29_999; ler();
  assert.equal(leituras, 1, 'dentro da janela');
  relogio = 30_000; ler();
  assert.equal(leituras, 2, 'a janela venceu');
  relogio = 70_000; lanca = true;
  assert.throws(() => ler());
  lanca = false; ler();
  assert.equal(leituras, 4, 'a leitura que lancou nao ficou guardada');
});

test('V7: a espera do --esperar le o runtime uma vez por janela de 30 s, e nao a cada volta de 2 s', () => {
  const p = projetoTemporario('rm037-esperas-v7');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    threadComSessao(p, 'ocupada', SESSAO);
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const trabalhando = runtimeCom([{ sessionId: SESSAO, state: 'working' }]);
    assert.equal(esperarVaga(p.carregado, nova.id, 4_500, trabalhando.ler), false, 'a sessao segue trabalhando');
    assert.equal(trabalhando.leituras(), 1, 'tres voltas de 2 s, uma leitura so');
  } finally { p.limpar(); }
});

test('V8: com o runtime lido no limite, o despacho em curso de outra thread segue contando', () => {
  // A1 do CHECK: so a sessao sai pela prova do runtime; o despacho em curso (conducao de processo) nao tem sessao.
  const p = projetoTemporario('rm037-esperas-v8');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const despachando = novaThread(p.carregado, { nome: 'despachando', modo: 'auto' }).thread;
    threadComSessao(p, 'parada', SESSAO);
    const nova = novaThread(p.carregado, { nome: 'quer a vaga', modo: 'auto' }).thread;
    const tomada = tomarConducao(p.dir, despachando.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 60_000 });
    assert.equal(tomada.ok, true);
    try {
      const parada = runtimeCom([{ sessionId: SESSAO, state: 'stopped', viva: false }]);
      const recusa = vagaDoDespacho(p.carregado, nova.id, undefined, undefined, parada.ler);
      assert.equal(parada.leituras(), 1, 'o runtime foi lido');
      assert.deepEqual(recusa?.ocupam.map((o) => [o.thread, o.sessao]), [[despachando.id, null]], 'a parada saiu, o despacho ficou');
      assert.match(recusa!.detalhe, /despacho em curso/);
    } finally { if (tomada.ok) tomada.liberar(); }
  } finally { p.limpar(); }
});

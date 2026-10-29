/**
 * RM-061, fatia F2a: `ork doctor` inteiro em ingles e o erro de `ork init` fora do repositorio.
 * Os nomes comecam por "locale en F2a doctor:" e dizem o modulo, para cada claim rodar so o seu. O
 * pt-BR byte a byte fica com o snapshot (`locale-f2a-snapshot`).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  checarChaveDeEmbedding, checarContas, checarDespachoPeloCodex, checarDonoDoGit, checarRuntimeClaude, manifestoForaDoRepositorio,
} from '../src/doctor';
import { checarCronDoPulse } from '../src/doctor-pulse-cron';
import { checarRede, correcaoDaFalha } from '../src/doctor-rede';
import { duracao } from '../src/rede-status';
import { checarAnalisadoresDoGrafo, correcaoDosAnalisadores, REDACAO_DOS_ANALISADORES } from '../src/intelligence-graph-cli';
import { sondasDeAmbiente } from '../src/preflight';
import { definirFusoDoDono } from '../src/horario';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { ativarLocale, msg } from '../src/locale';
import { Check } from '../src/types';
import { cenario, EN, linhasEmPortugues, ork, orkEm, PT } from './locale-apoio';

function emIngles<T>(fn: () => T): T {
  ativarLocale('en');
  try { return fn(); } finally { ativarLocale(undefined); }
}

const texto = (c: Pick<Check, 'detalhe' | 'correcao'> | null): string => c ? `${c.detalhe}\n${c.correcao ?? ''}` : '';

test('locale en F2a doctor (doctor.ts, index.ts): num repositorio novo, o relatorio do CLI sai inteiro em ingles', () => {
  const c = cenario('doctor-en');
  try {
    const r = ork(c, EN, false, 'doctor');
    const linhas = r.stdout.trimEnd().split('\n');
    assert.equal(linhas[0], 'ork doctor: what holds on this machine now');
    assert.match(linhas.at(-1) ?? '', /^Verdict: BLOCKED \(\d+ fail, \d+ warn\)\. Fix the items above before dispatching a phase\.$/);
    assert.match(r.stdout, /\[FAIL\] runtime claude-bg +`claude` binary not on PATH; 9 block\(s\) of the allowed modes dispatch through it /);
    assert.match(r.stdout, /\[ok\] +session governance +\S+, Claude and Codex, global with history: 0 sessions; 0 without a thread; 0 ambiguous; inventory valid; source missing: claude agents --json --all \(process account\)\n/);
    assert.match(r.stdout, /\[ok\] +umask +umask 0022 denies write to group and others\n/);
    assert.match(r.stdout, /\[ok\] +private folder +\S+ missing: created on demand with 0700\n/);
    assert.match(r.stdout, /\[ok\] +network +outside the network; `ork network entrar` puts this machine on your network\n/);
    assert.match(r.stdout, /\[ok\] +\.git owner +\d+ entries in \.git owned by the repository owner \(uid \d+\)\n/);
    // O que sobra em pt-BR so pode ser dado: o caminho do repositorio e os nomes das etapas e dos modos.
    assert.deepEqual(linhasEmPortugues(r.stdout, [c.dir, c.casa]), []);
    // Controle do detector: o mesmo doctor em pt-BR tem linha com palavra pt-BR de sobra.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'doctor').stdout, [c.dir, c.casa]).length >= 10, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2a doctor (index.ts): com owner.language en-US o doctor sai em ingles mesmo com LANG pt_BR', () => {
  const c = cenario('doctor-owner');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    const r = ork(c, PT, false, 'doctor');
    assert.match(r.stdout, /^ork doctor: what holds on this machine now\n/);
    assert.deepEqual(linhasEmPortugues(r.stdout, [c.dir, c.casa]), []);
  } finally { c.limpar(); }
});

test('locale en F2a doctor (init.ts): ork init fora do repositorio recusa em ingles, com o prefixo error:', () => {
  const fora = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-locale-fora-')));
  const c = cenario('doctor-init', false);
  try {
    const r = orkEm(c, fora, EN, false, 'init');
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `error: init.fora-do-repositorio: ${fora} is not inside a git repository; nothing was created. ` +
      'Enter the project repository (or create one with `git init` and a first commit) and run `ork init` again.\n');
    // Caso negativo: comando fora do catalogo segue em pt-BR, prefixo incluido. A F3e levou `brain`; Noctum segue fora.
    const pt = ork(c, EN, false, 'noctum', 'status');
    assert.match(pt.stderr, /^erro: manifesto orkastery\.yaml nao encontrado /);
  } finally { c.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('locale en F2a doctor (doctor.ts): manifesto, contas, embedding, dono do .git, claude e codex em ingles', () => {
  const c = cenario('doctor-ramos');
  try {
    const carregado = exigirManifesto(c.dir);
    const comEmbedding = (embedding: Record<string, unknown>): ManifestoCarregado => ({
      ...carregado, manifesto: { ...carregado.manifesto, memory: { ...carregado.manifesto.memory, embedding: embedding as never } } });
    const base = { provider: 'openrouter', model: 'openai/text-embedding-3-small' };
    const chave = 'ORKASTERY_EMBEDDING_API_KEY';
    const tudo = emIngles(() => [
      texto(manifestoForaDoRepositorio(c.dir, path.join(path.dirname(c.dir), 'orkastery.yaml'))),
      texto(checarContas(c.dir, () => ({ ok: true, detalhe: '' }))),
      texto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: 'ANTHROPIC_API_KEY' }), {})),
      texto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: '' }), {})),
      texto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: chave }), { [chave]: 'a b' })),
      texto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: chave }), { [chave]: 'sk-or-x123456789' })),
      texto(checarChaveDeEmbedding(comEmbedding({ ...base, api_key_env: chave }), {})),
      texto(checarDonoDoGit(c.dir, { teto: 3 })),
      texto(checarDonoDoGit(c.dir)),
      texto(checarRuntimeClaude(null, null, null)),
      texto(checarRuntimeClaude(carregado, null, null)),
      texto(checarRuntimeClaude(carregado, '/opt/bin/claude', null, { ok: false, detalhe: 'claude auth status: loggedIn false' })),
      texto(checarDespachoPeloCodex({ ...carregado, manifesto: { ...carregado.manifesto,
        runtime: { ...carregado.manifesto.runtime, adapter: 'codex' } } }, null, null)),
    ].join('\n'));
    assert.deepEqual(linhasEmPortugues(tudo, [c.dir, path.dirname(c.dir)]), [], tudo);
    assert.match(tudo, /the orkastery\.yaml that was read sits outside this repository/);
    assert.match(tudo, /memory\.embedding\.api_key_env declares ANTHROPIC_API_KEY, a name from the paid provider list/);
    assert.match(tudo, /ORKASTERY_EMBEDDING_API_KEY missing from the environment: semantic search uses the local fallback/);
    assert.match(tudo, /more than 3 entries in \.git: partial check, no other owner so far/);
    assert.match(tudo, /runtime\.adapter: codex, but the `codex` binary is not on PATH/);
  } finally { c.limpar(); }
});

test('locale en F2a doctor (doctor.ts): os checks da RM-047 (fabrica compartilhada, pasta das worktrees, sandbox sem confirmacao) em ingles', () => {
  const c = cenario('doctor-rm047');
  try {
    const yaml = path.join(c.dir, 'orkastery.yaml');
    fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('dir: ".claude/worktrees"', 'dir: "../fora-da-raiz"') +
      '\nfabrica:\n  compartilhada: true\n');
    const en = ork(c, EN, false, 'doctor').stdout, pt = ork(c, PT, false, 'doctor').stdout;
    assert.match(en, /\[warn\] shared factory +`orkastery\.yaml` asks for `fabrica\.compartilhada: true` and this machine has not joined/, en);
    assert.match(en, /\[FAIL\] worktree folder +`worktree\.dir` "\.\.\/fora-da-raiz" points outside the project root/, en);
    assert.match(pt, /\[warn\] fabrica compartilhada +o orkastery\.yaml pede fabrica\.compartilhada: true e esta maquina nao entrou/, pt);
    assert.match(pt, /\[FAIL\] pasta das worktrees +worktree\.dir "\.\.\/fora-da-raiz" leva para fora da raiz/, pt);
    const carregado = exigirManifesto(c.dir);
    const codex = { ...carregado, manifesto: { ...carregado.manifesto,
      runtime: { ...carregado.manifesto.runtime, adapter: 'codex', sandbox: 'danger-full-access' } } } as ManifestoCarregado;
    const semConfirmacao = emIngles(() => checarDespachoPeloCodex(codex, '/opt/bin/codex', { ok: true }));
    assert.match(semConfirmacao?.detalhe ?? '', /requested by `orkastery\.yaml` but not confirmed on this machine: dispatch is refused with `runtime\.sandbox-nao-confirmado`$/);
    assert.match(semConfirmacao?.correcao ?? '', /\(or set the manifest back to `workspace-write`\)$/);
    assert.deepEqual(linhasEmPortugues(`${semConfirmacao?.detalhe}\n${semConfirmacao?.correcao}`), []);
  } finally { c.limpar(); }
});

test('locale en F2a doctor (preflight.ts): sondas de umask, estado e pasta privada em ingles', () => {
  const c = cenario('doctor-sondas');
  try {
    const tudo = emIngles(() => [...sondasDeAmbiente(c.dir, 0o002), ...sondasDeAmbiente(c.dir, null)].map(texto).join('\n'));
    assert.match(tudo, /umask 0002 allows write by group or others/);
    assert.match(tudo, /process umask not measured on this platform/);
    assert.deepEqual(linhasEmPortugues(tudo, [c.dir]), [], tudo);
  } finally { c.limpar(); }
});

test('locale en F2a doctor (doctor-rede.ts, rede-status.ts): rede e duracao em ingles', () => {
  const usuario = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-locale-usuario-')));
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  definirFusoDoDono('America/New_York');
  try {
    const agoraMs = Date.parse('2025-09-19T18:21:30.000Z');
    const linhas = emIngles(() => {
      const r = [texto(checarRede({ agoraMs }))];
      fs.writeFileSync(path.join(usuario, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: false }));
      r.push(texto(checarRede({ agoraMs })));
      fs.writeFileSync(path.join(usuario, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: true,
        host: 'github.com', dono: 'exemplo', repositorio: 'orkastery-network' }));
      fs.mkdirSync(path.join(usuario, 'rede'), { recursive: true });
      fs.writeFileSync(path.join(usuario, 'rede', 'publicada.json'), JSON.stringify({ em: '2025-09-19T18:16:00.000Z' }));
      r.push(texto(checarRede({ agoraMs, log: path.join(usuario, 'nada') })));
      r.push(...['rede.sem-repositorio: x', 'rede.sem-forja: x', 'rede.repositorio-publico: x', 'rede.nome-em-uso: x', 'x'].map(correcaoDaFalha));
      r.push([NaN, 20_000, 5 * 60_000].map(duracao).join(' | '));
      return r;
    });
    const tudo = linhas.join('\n');
    assert.match(tudo, /outside the network \(left with `ork network sair`\)/);
    assert.match(tudo, /member; home github\.com\/exemplo\/orkastery-network; last heartbeat 2025-09-19 14:16 \(6 min ago\); no failure in rede\.log/);
    assert.match(tudo, /unknown time \| less than 1 min \| 5 min/);
    assert.deepEqual(linhasEmPortugues(tudo), [], tudo);
  } finally {
    definirFusoDoDono(undefined);
    if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    fs.rmSync(usuario, { recursive: true, force: true });
  }
});

test('locale en F2a doctor (doctor-pulse-cron.ts): cron do pulse em ingles', () => {
  const c = cenario('doctor-cron');
  try {
    const monitor = path.join(c.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), '{}');
    const ler = (r: object) => () => r as never;
    const script = '/opt/varredura-pulse.sh';
    const cron = emIngles(() => [
      checarCronDoPulse(monitor, c.dir, ler({ ok: false, motivo: 'x' }), script),
      checarCronDoPulse(monitor, c.dir, ler({ ok: true, texto: '' }), script),
      checarCronDoPulse(monitor, c.dir, ler({ ok: true, texto: `*/15 * * * * ${script}\n` }), script),
      checarCronDoPulse(monitor, c.dir, ler({ ok: true, texto: `0 * * * * ${script}\n` }), script),
      checarCronDoPulse(monitor, c.dir, ler({ ok: true, texto: `@reboot ${script}\n` }), script),
    ].map(texto).join('\n'));
    assert.match(cron, /pulse-host\.json present, but there is no crontab to read \(x\): the scan never runs/);
    assert.match(cron, /scan in cron every 15 minutes or less \(1 line\(s\)\)/);
    assert.match(cron, /the pulse scan runs every hour \(`0 \* \* \* \* \/opt\/varredura-pulse\.sh`\): the cadence by tag \(RM-039\) needs 15 minutes/);
    assert.match(cron, /the pulse scan runs on a schedule the doctor cannot read/);
    assert.deepEqual(linhasEmPortugues(cron, [c.dir]), [], cron);
  } finally { c.limpar(); }
});

test('locale en F2a doctor (intelligence-graph-cli.ts): analisadores do grafo em ingles; o pt-BR do catalogo e o da familia', () => {
  const pt = msg('pt-BR').doctor.grafo;
  for (const motivo of ['grafo.parser.indisponivel: x', 'grafo.parser.indisponivel: ERR_REQUIRE_ESM']) {
    assert.equal(pt.recusa(motivo), REDACAO_DOS_ANALISADORES.recusa(motivo));
    for (const versao of ['0.5.4', undefined, '0.0.0-desconhecida']) {
      assert.equal(correcaoDosAnalisadores(motivo, versao, pt), correcaoDosAnalisadores(motivo, versao));
    }
  }
  const en = texto(checarAnalisadoresDoGrafo('0.5.4', () => { throw new Error('grafo.parser.indisponivel: micromark'); }, undefined,
    msg('en').doctor.grafo));
  assert.match(en, /^grafo\.parser\.indisponivel: micromark: `ork grafo indexar` refuses on this installation/);
  assert.match(en, /npm install -g @orkastery\/cli@0\.5\.4 \(installed inside a project or through npx/);
  assert.deepEqual(linhasEmPortugues(en, ['grafo.parser.indisponivel']), [], en);
});

test('locale en F2a doctor (index.ts): doctor --json segue em pt-BR com LANG=en_US', () => {
  const c = cenario('doctor-negativo');
  try {
    const args = ['doctor', '--json'];
    const pt = ork(c, PT, false, ...args), en = ork(c, EN, false, ...args);
    // RM-063 (fatia 3, H1): o `--json` e o contrato `ork.doctor/v1`; so o instante da consulta muda entre as duas.
    const semInstante = (saida: string) => JSON.stringify({ ...JSON.parse(saida), consultadoEm: null });
    assert.equal(semInstante(en.stdout), semInstante(pt.stdout), args.join(' '));
  } finally { c.limpar(); }
});

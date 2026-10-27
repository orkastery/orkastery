/**
 * RM-061, fatia F2b: os casos do snapshot pt-BR. Cada caso produz um texto que a F2b passa pelo
 * catalogo de mensagens (`verify`, `ship`, `retry`, `master`, `pulse` e `roadmap status`): as funcoes
 * de texto sao chamadas com entradas fixas nos ramos que a fatia toca, e o CLI roda num repositorio
 * temporario com HOME proprio, PATH controlado e um runtime falso. Os campos de detalhe que vao ao
 * ledger entram no caso do CLI que os grava: o dado tambem fica igual byte a byte.
 *
 * A fixture `fixtures/locale-f2b-pt-BR.json` foi gerada UMA vez por estes casos sobre o codigo da base
 * (a F2a na `main`, antes da F2b); o teste `locale-f2b-snapshot` so compara e nunca regrava. O que varia
 * de uma maquina ou de uma execucao para outra (pastas temporarias, horarios, sha, steal, usuario) e
 * normalizado aqui, igual na geracao e na comparacao.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definirFusoDoDono } from '../src/horario';
import { textoDoVerify, verificarClaim, ResultadoVerify } from '../src/verify';
import { textoDoShip, ResultadoShip } from '../src/ship';
import { POLITICA_DE_RETRY, textoDoPlano, textoDoRetry, ResultadoDeRetry } from '../src/retry';
import { textoDoPulse, Pulse, ItemPulse } from '../src/pulse';
import { textoDoStatusDoRoadmap, GRUPOS_DO_ROADMAP, StatusDoRoadmap, ItemDoStatus } from '../src/roadmap-status';
import { linhaDoParadoNoCondutor } from '../src/hitl-resumo';
import { linhaDaPerguntaParada, textoDaMediana, HitlDeConducaoAgora } from '../src/hitl-tempo-parado';
import { Claim, PlanoDeRetry, ResultadoDeComando } from '../src/types';
import { classificarEstado, recomendarPara } from '../src/hitl';
import { planejar } from '../src/board';
import { DESCRICAO_DO_MOTIVO } from '../src/gates';
import { enfileirar, faltaPara } from '../src/ratelimit';
import { registrar } from '../src/ledger';
import { montarMonitor } from '../src/orquestracao';
import { exigirManifesto } from '../src/manifest';
import { gravarThread, lerThread } from '../src/thread';
import { exec, noPath } from '../src/util';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const SP = 'America/Sao_Paulo';
/** Instantes fixos fora do ano corrente: a data mostra o ano em qualquer ano de execucao. */
const T0 = '2025-09-19T18:16:00.000Z';
const T1 = '2025-09-19T18:21:30.000Z';
const T2 = '2025-09-19T19:40:00.000Z';
const SHA_A = 'a1b2c3d4'.repeat(5);
const SHA_B = 'b2c3d4e5'.repeat(5);
const SHA_C = 'c3d4e5f6'.repeat(5);

/** Pastas temporarias deste lote de casos, trocadas por marcadores na normalizacao. */
const marcadores: Array<[string, string]> = [];

function dirTemp(nome: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-f2b-${nome}-`)));
  marcadores.push([dir, marcador]);
  return dir;
}

/** O que varia entre maquinas e execucoes vira marcador; o resto fica byte a byte. */
export function normalizar(texto: string): string {
  let t = texto;
  for (const [dir, marcador] of [...marcadores].sort((a, b) => b[0].length - a[0].length)) t = t.split(dir).join(marcador);
  return t
    .replace(/\b\d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2}(?::\d{2})?\b/g, '<DATA>')
    .replace(/\(\d{2}\/\d{2}, \d{2}:\d{2}\)/g, '(<DATA>)')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<ISO>')
    .replace(/\b[0-9a-f]{64}\b/g, '<SHA256>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/(@ |baseline {4}|no HEAD |em |merge )[0-9a-f]{7,8}\b/g, '$1<SHA8>')
    .replace(/\b[0-9a-f]{8}(\.\.|\^1\b| )(?=[0-9a-f]{8}\b|$)/gm, '<SHA8>$1')
    .replace(/(\.\.|--is-ancestor <SHA8> )[0-9a-f]{8}\b/g, '$1<SHA8>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>')
    .replace(/(steal {7})\d+(?:\.\d+)?%/g, '$1<PCT>%')
    .replace(/(preparo {5}\S+ em )\d+ s/g, '$1<N> s')
    .replace(/\b(Nota da entrega \S+ \([^)]*\)|Responda: )[A-Z0-9]{4}\b/g, '$1<COD>')
    .replace(/(por exemplo: )[A-Z0-9]{4}\b/g, '$1<COD>')
    .replace(/\bv\d+\.\d+\.\d+\b/g, 'v<NODE>');
}

function repoComCommit(nome: string, marcador: string): string {
  const dir = dirTemp(nome, marcador);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# locale f2b\n');
  exec('git', ['add', '--', 'README.md'], dir);
  exec('git', ['commit', '-q', '-m', 'inicial'], dir);
  return dir;
}

interface Ambiente { casa: string; bin: string; stub: string }

/**
 * HOME, um bin so com o git, o bash do verify e o que o stub do `claude` usa (o mesmo script do
 * `apoio.ts`): nenhum `claude` nem `codex` de quem roda entra no PATH, em maquina nenhuma.
 */
function ambiente(nome: string): Ambiente {
  const casa = dirTemp(`${nome}-casa`, '<CASA>');
  const bin = dirTemp(`${nome}-bin`, '<BIN>');
  const stub = dirTemp(`${nome}-stub`, '<STUB>');
  for (const ferramenta of ['git', 'cat', 'cut', 'date', 'rm', 'bash']) {
    const achado = noPath(ferramenta);
    if (!achado) throw new Error(`${ferramenta} fora do PATH de quem roda os testes`);
    fs.symlinkSync(path.resolve(achado), path.join(bin, ferramenta));
  }
  const apoio = fs.readFileSync(path.resolve(__dirname, '../../test/apoio.ts'), 'utf8');
  const m = /const SCRIPT_DO_RUNTIME = `([\s\S]*?)`;/.exec(apoio);
  if (!m) throw new Error('script do runtime falso nao achado em apoio.ts');
  fs.writeFileSync(path.join(stub, 'claude'), m[1].replace(/\\\\/g, '\\'), { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'pid'), String(process.pid));
  return { casa, bin, stub };
}

interface Saida { status: number | null; stdout: string; stderr: string }

/** A CLI com ambiente montado do zero: HOME, PATH, LANG pt-BR e o fuso. */
function ork(dir: string, amb: Ambiente, ...args: string[]): Saida {
  return orkComEnv(dir, amb, {}, ...args);
}

function orkComEnv(dir: string, amb: Ambiente, extra: Record<string, string>, ...args: string[]): Saida {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 180000,
    env: { HOME: amb.casa, LANG: 'C.UTF-8', TZ: SP, PATH: `${amb.stub}:${amb.bin}`, ORK_STUB_DIR: amb.stub, ...extra },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** O steal da rodada do CLI depende da maquina (medido ou nao); os casos de funcao cobrem as duas frases. */
function texto(s: Saida): string {
  const semSteal = (t: string) => t.replace(/^( {2}steal {7}).*$/gm, '$1<STEAL>');
  return `[saida ${s.status}]\n${semSteal(s.stdout)}${s.stderr ? `[stderr]\n${semSteal(s.stderr)}` : ''}`;
}

/** Os campos de texto que o comando gravou no ledger da thread, na ordem dos eventos. */
function textosDoLedger(repo: string, thread: string, tipos: readonly string[]): string {
  const ledger = path.join(repo, '.orkastery', 'threads', thread, 'ledger.jsonl');
  if (!fs.existsSync(ledger)) return '<sem ledger>';
  const campos = ['detalhe', 'correcao', 'razao', 'motivo', 'veredito', 'diagnostico', 'autorizadoPor'];
  return fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => tipos.includes(String(e.tipo)))
    .map((e) => {
      const partes = campos.filter((c) => typeof e[c] === 'string').map((c) => `${c}=${String(e[c])}`);
      const claims = Array.isArray(e.claims)
        ? (e.claims as Array<Record<string, unknown>>).map((c) => `claim ${String(c.id)} ${String(c.motivo)} ${String(c.detalhe)}`) : [];
      return [`${String(e.tipo)}: ${partes.join(' | ')}`, ...claims].join('\n');
    }).join('\n');
}

function limparTudo(): void {
  const pausa = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(pausa, 0, 0, 200);
  for (const [dir] of marcadores) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  marcadores.length = 0;
}

/** Roda `fn` e guarda o texto (ou `ERRO: mensagem`) normalizado. */
function caso(casos: Record<string, string>, nome: string, fn: () => string | null | undefined): void {
  if (nome in casos) throw new Error(`caso repetido: ${nome}`);
  let saida: string;
  try {
    const r = fn();
    saida = r === null ? '<null>' : r === undefined ? '<undefined>' : r;
  } catch (e) { saida = `ERRO: ${(e as Error).message}`; }
  casos[nome] = normalizar(saida);
}

/** Projeto com manifesto, verify `build` e `test` de verdade (bash) e o fuso do dono fixo. */
function projeto(nome: string, abbrev: string, amb: Ambiente): string {
  const repo = repoComCommit(nome, '<REPO>');
  const init = ork(repo, amb, 'init', '--name', nome, '--abbrev', abbrev);
  if (init.status !== 0) throw new Error(`init falhou: ${init.stderr}`);
  const yaml = path.join(repo, 'orkastery.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8')
    .replace('  # build: nao detectado', '  build: "true"')
    .replace('  # test: nao detectado', '  test: "test -f passa.txt"'));
  exec('git', ['add', '--', 'orkastery.yaml', 'AGENTS.md'], repo);
  exec('git', ['commit', '-q', '-m', 'manifesto'], repo);
  return repo;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

function comando(nome: string, cmd: string, extra: Partial<ResultadoDeComando> = {}): ResultadoDeComando {
  return { nome, comando: cmd, ok: true, code: 0, resumo: '', ...extra };
}

function claimDe(id: string, alegacao: string, verificar: string[], extra: Partial<Claim> = {}): Claim {
  return { id, thread: 'loc-x', fase: 'GO', arquivo: 'core/src/x.ts', alegacao, verificar, estado: 'pendente',
    criadaEm: T0, ...extra } as unknown as Claim;
}

const STEAL_MEDIDO = { fonte: '/proc/stat', medido: true, rodadaPct: 3.2, limiarPct: 40, porComando: {}, relogioSobSteal: [] };
const SEM_STEAL = { fonte: '/proc/stat', medido: false, rodadaPct: null, limiarPct: 40, porComando: {}, relogioSobSteal: [] };
const SEM_INSTABILIDADE = { arquivo: 'core/test/instabilidade.json', presente: false, erros: [], vigentes: [], vencidas: [] };

function resultadoVerify(extra: Partial<ResultadoVerify>): ResultadoVerify {
  return { thread: 'loc-x', commit: SHA_A, cwd: '/repo/loc', claims: [], comandos: [], baseline: null, regressoes: [],
    preExistentes: [], falhasSemBaseline: [], estouros: [], preparo: null, steal: STEAL_MEDIDO as never,
    instabilidade: SEM_INSTABILIDADE as never, motivos: [], ok: true,
    // RM-072 (D1): todo resultado de verify traz o modo do CHECK; o caso usa o padrao.
    check: { modo: 'agile', origem: 'padrao', nome: 'Agile Check' }, duracaoMs: 0, ...extra } as ResultadoVerify;
}

function casosDoVerify(casos: Record<string, string>): void {
  definirFusoDoDono(SP);
  const ok1 = comando('C1.1', 'npm test');
  caso(casos, 'verify: texto verde com baseline, preparo e steal medido', () => textoDoVerify(resultadoVerify({
    baseline: { commit: SHA_B, gravadaEm: T0, comandos: [] },
    preparo: { resultado: comando('preparo', 'npm run build', { duracaoMs: 42_000 }), identidade: 'x', identidadeFinal: 'x', produtoAlterado: false },
    claims: [
      { claim: claimDe('C1', 'o teste passa', ['npm test', 'grep -E x core/src/x.ts']), verificado: true, motivo: null,
        detalhe: '2 comando(s) reexecutado(s) com sucesso', execucoes: [ok1] },
      { claim: claimDe('C2', 'sem comando', []), verificado: false, motivo: 'claims.unverifiable',
        detalhe: 'sem comando de verificacao declarado', execucoes: [] },
    ],
    comandos: [comando('build', 'npm run build'), comando('test', 'npm test')],
    motivos: ['claims.unverifiable'],
  })));
  const estouro = comando('build', 'npm run build', { ok: false, code: -1, causa: 'timeout', prazoMs: 600_000, duracaoMs: 612_000 });
  const sinal = comando('test', 'npm test', { ok: false, code: 137, causa: 'sinal', testeQueCaiu: ['a cai', 'b cai'] });
  const ausente = comando('typecheck', 'tsc', { ok: false, code: 127, causa: 'nao-encontrado' });
  const relogio = comando('lint', 'npm run lint', { ok: false, code: 1, stealPct: 55, relogioSobSteal: ['t1'] });
  const falhou = comando('docs', 'npm run docs', { ok: false, code: 2, causa: 'codigo' as never });
  caso(casos, 'verify: texto reprovado com cada causa e sem baseline', () => textoDoVerify(resultadoVerify({
    baseline: null,
    preparo: { resultado: comando('preparo', 'npm run build', { ok: false, code: 2, duracaoMs: 3_000 }), identidade: 'x',
      identidadeFinal: 'y', produtoAlterado: true },
    steal: SEM_STEAL as never,
    instabilidade: { ...SEM_INSTABILIDADE, presente: true, erros: ['contrato ausente', 'entrada sem teste'] } as never,
    claims: [{ claim: claimDe('C3', 'reprova', ['false']), verificado: false, motivo: 'claims.failed',
      detalhe: 'comando "false" saiu com codigo 1', execucoes: [comando('C3.1', 'false', { ok: false, code: 1 })] }],
    comandos: [estouro, sinal, ausente, relogio, falhou],
    regressoes: [sinal], preExistentes: [falhou], falhasSemBaseline: [ausente], estouros: [estouro, relogio],
    motivos: ['claims.failed', 'verify.regression', 'verify.failed', 'verify.timeout', 'verify.sem-veredito'], ok: false,
  })));
  caso(casos, 'verify: texto sem claims com instabilidade vencida', () => textoDoVerify(resultadoVerify({
    instabilidade: { ...SEM_INSTABILIDADE, presente: true, vencidas: [{ teste: 'x' }, { teste: 'y' }] } as never,
  })));
  // Os detalhes da claim reexecutada vao ao ledger (`verify_run`): cada ramo.
  caso(casos, 'verify: detalhe da claim reexecutada em cada ramo', () => {
    const exec = (r: Partial<ResultadoDeComando>) => (nome: string, cmd: string) => comando(nome, cmd, r);
    const linhas = [
      verificarClaim(claimDe('C1', 'a', []), '/x'),
      verificarClaim(claimDe('C2', 'nenhum', [], { negativa: true } as Partial<Claim>), '/x'),
      verificarClaim(claimDe('C3', 'a', ['ls']), '/x', exec({ ok: false, code: -1, executado: false, resumo: 'spawn ENOENT' })),
      verificarClaim(claimDe('C4', 'a', ['npm test']), '/x', exec({ ok: false, code: -1, causa: 'timeout', prazoMs: 600_000 })),
      verificarClaim(claimDe('C5', 'a', ['npm test']), '/x', exec({ ok: false, code: 1, stealPct: 55, relogioSobSteal: ['t1', 't2'] })),
      verificarClaim(claimDe('C6', 'a', ['false']), '/x', exec({ ok: false, code: 2 })),
      verificarClaim(claimDe('C7', 'a', ['true', 'true']), '/x', exec({})),
    ];
    return linhas.map((r) => `${r.claim.id} ${r.verificado} ${r.motivo} | ${r.detalhe}`).join('\n');
  });

  const amb = ambiente('verify');
  const repo = projeto('verify', 'ver', amb);
  const id = 'ver-verificar';
  caso(casos, 'verify cli: sem thread', () => texto(ork(repo, amb, 'verify')));
  caso(casos, 'verify cli: thread que nao existe', () => texto(ork(repo, amb, 'verify', 'ver-nada')));
  ork(repo, amb, 'thread', 'new', 'Verificar', '--modo', 'auto', '--sem-worktree');
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'o readme existe', '--verificar', 'test -f README.md');
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'reprova sempre', '--verificar', 'false');
  ork(repo, amb, 'claims', 'add', id, 'README.md', '--claim', 'sem comando');
  fs.writeFileSync(path.join(repo, 'passa.txt'), 'sim\n');
  caso(casos, 'verify cli: baseline com tudo passando', () => texto(ork(repo, amb, 'verify', id, '--baseline')));
  fs.rmSync(path.join(repo, 'passa.txt'));
  caso(casos, 'verify cli: reprovado com regressao', () => texto(ork(repo, amb, 'verify', id)));
  caso(casos, 'verify cli: so claims', () => texto(ork(repo, amb, 'verify', id, '--so-claims')));
  caso(casos, 'verify cli: ledger do verify', () => textosDoLedger(repo, id, ['verify_run', 'gate_blocked', 'baseline_recorded']));
  // Baseline que ja falhava e sem comando no manifesto.
  caso(casos, 'verify cli: baseline com falha', () => texto(ork(repo, amb, 'verify', id, '--baseline')));
  const semVerify = projeto('verify-vazio', 'vaz', amb);
  const yaml = path.join(semVerify, 'orkastery.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace('  build: "true"', '  # build: nao detectado')
    .replace('  test: "test -f passa.txt"', '  # test: nao detectado'));
  ork(semVerify, amb, 'thread', 'new', 'Vazio', '--modo', 'auto', '--sem-worktree');
  caso(casos, 'verify cli: baseline sem comando no manifesto', () => texto(ork(semVerify, amb, 'verify', 'vaz-vazio', '--baseline')));
  caso(casos, 'verify cli: verify sem claims e sem comandos', () => texto(ork(semVerify, amb, 'verify', 'vaz-vazio')));
}

// ---------------------------------------------------------------------------
// Ship
// ---------------------------------------------------------------------------

function resultadoShip(extra: Partial<ResultadoShip>): ResultadoShip {
  return { ok: false, bloqueado: false, motivo: null, detalhe: '', correcao: '', thread: 'loc-x', de: 'ork/loc-x-full', para: 'main',
    shaDe: SHA_A, shaParaAntes: SHA_B, mergeSha: null, pontaDaBase: null, jaIncorporado: false, remoto: 'origin', shaRemoto: null,
    pushVerificado: false, autorizacao: { autorizado: true, tipo: 'modo', por: 'modo #Auto', razao: 'o modo #Auto entrega sem pausa' },
    verificacao: resultadoVerify({ claims: [{ claim: claimDe('C1', 'a', ['true']), verificado: true, motivo: null, detalhe: 'ok',
      execucoes: [] }], comandos: [comando('build', 'true'), comando('test', 'false', { ok: false, code: 1 })] }),
    ci: null, violacoes: [], lease: null, leaseOcupadoPor: null, passos: [], dryRun: false, ...extra } as ResultadoShip;
}

function casosDoShip(casos: Record<string, string>): void {
  definirFusoDoDono(SP);
  caso(casos, 'ship: texto bloqueado aguardando autorizacao', () => textoDoShip(resultadoShip({
    bloqueado: true, motivo: 'human.pending', verificacao: null,
    autorizacao: { autorizado: false, tipo: 'pendente', por: '', razao: `o bloco pausa desde ${T0}: alguem precisa autorizar` },
    detalhe: `o bloco pausa desde ${T0}`, correcao: 'ork ship loc-x --para <branch> --autorizar-push <quem>' })));
  caso(casos, 'ship: texto do ensaio com lease livre, ci e aviso de policy', () => textoDoShip(resultadoShip({
    ok: true, dryRun: true, ci: { schema: 'ork.ci-status/v2', required: true, ok: true, provider: 'github', repository: 'a/b',
      sha: SHA_A, context: 'ork-verify', state: 'success', url: null, detail: 'verde', fonte: 'check-run', produtor: 'github-actions' },
    violacoes: [{ policy: 'push_direto_na_base', severidade: 'warn', motivo: 'policy.violation', detalhe: 'push direto na base',
      correcao: 'use uma branch' }],
    passos: ['arvore de merge: /repo (arvore que tem main em check-out; limpa)', 'git merge --no-ff ork/loc-x-full -m "<mensagem de ship>"',
      'git push origin main', 'git ls-remote origin refs/heads/main   (prova do push)'] })));
  caso(casos, 'ship: texto do ensaio com ci nao exigido', () => textoDoShip(resultadoShip({
    ok: true, dryRun: true, ci: { schema: 'ork.ci-status/v2', required: false, ok: true, provider: null, repository: null,
      sha: SHA_A, context: 'ork-verify', state: 'success', url: null, detail: '', fonte: null, produtor: null }, passos: ['git merge --no-ff x'] })));
  caso(casos, 'ship: texto entregue com push provado', () => textoDoShip(resultadoShip({
    ok: true, mergeSha: SHA_C, pontaDaBase: SHA_C, shaRemoto: SHA_C, pushVerificado: true,
    lease: { nome: 'main-tree', thread: 'loc-x', motivo: 'ship', pid: 1, adquiridoEm: T0, expiraEm: T1 },
    passos: ['git merge --no-ff ork/loc-x-full', 'git push -- origin refs/heads/main:refs/heads/main'] })));
  caso(casos, 'ship: texto entregue sem push e ja incorporado', () => textoDoShip(resultadoShip({
    ok: true, jaIncorporado: true, mergeSha: SHA_C, remoto: null, detalhe: `remoto "origin" nao configurado: merge local concluido, sem push a provar`,
    passos: ['(nada a mergear)'] })));
  caso(casos, 'ship: texto entregue sem push e sem detalhe', () => textoDoShip(resultadoShip({ ok: true, mergeSha: SHA_C })));
  caso(casos, 'ship: texto bloqueado com lease ocupado e verificacao reprovada', () => textoDoShip(resultadoShip({
    bloqueado: true, motivo: 'lease.busy', detalhe: 'lease main-tree ocupado', correcao: 'aguarde a vez',
    leaseOcupadoPor: { nome: 'main-tree', thread: 'loc-y', motivo: 'ship', pid: 1, adquiridoEm: T0, expiraEm: T1 },
    verificacao: resultadoVerify({ ok: false, claims: [], comandos: [comando('test', 'false', { ok: false, code: 1 })] }) })));
  caso(casos, 'ship: texto do ensaio sem autorizacao no ensaio', () => textoDoShip(resultadoShip({ dryRun: true, bloqueado: true,
    motivo: 'ci.failed', detalhe: 'gh: No commit found', correcao: 'publique a branch',
    ci: { schema: 'ork.ci-status/v2', required: true, ok: false, provider: 'github', repository: 'a/b', sha: SHA_A,
      context: 'ork-verify', state: 'missing' as never, url: null, detail: 'gh: No commit found', fonte: null, produtor: null } })));

  const amb = ambiente('ship');
  const repo = projeto('ship', 'shp', amb);
  ork(repo, amb, 'thread', 'new', 'Reprova', '--modo', 'auto', '--sem-worktree');
  ork(repo, amb, 'claims', 'add', 'shp-reprova', 'README.md', '--claim', 'reprova sempre', '--verificar', 'false');
  ork(repo, amb, 'thread', 'new', 'Entrega', '--modo', 'auto', '--sem-worktree');
  ork(repo, amb, 'claims', 'add', 'shp-entrega', 'README.md', '--claim', 'o readme existe', '--verificar', 'test -f README.md');
  ork(repo, amb, 'thread', 'new', 'Pausa', '--modo', 'classic', '--sem-worktree');
  fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), 'passa.txt\n');
  fs.writeFileSync(path.join(repo, 'passa.txt'), 'sim\n');
  exec('git', ['branch', 'feature'], repo);
  caso(casos, 'ship cli: uso', () => texto(ork(repo, amb, 'ship')));
  caso(casos, 'ship cli: ensaio barrado pela policy push_direto_na_base', () =>
    texto(ork(repo, amb, 'ship', 'shp-reprova', '--para', 'main', '--dry-run')));
  caso(casos, 'ship cli: modo que pausa sem autorizacao', () => texto(ork(repo, amb, 'ship', 'shp-pausa', '--para', 'main')));
  caso(casos, 'ship cli: destino inexistente', () => texto(ork(repo, amb, 'ship', 'shp-entrega', '--para', 'nada', '--de', 'feature')));
  caso(casos, 'ship cli: origem inexistente', () => texto(ork(repo, amb, 'ship', 'shp-entrega', '--para', 'main', '--de', 'nada')));
  caso(casos, 'ship cli: ensaio verde', () => texto(ork(repo, amb, 'ship', 'shp-entrega', '--para', 'main', '--de', 'feature', '--dry-run')));
  caso(casos, 'ship cli: ensaio verde com --sem-push', () =>
    texto(ork(repo, amb, 'ship', 'shp-entrega', '--para', 'main', '--de', 'feature', '--dry-run', '--sem-push')));
  exec('git', ['checkout', '-q', 'feature'], repo);
  fs.writeFileSync(path.join(repo, 'NOVO.md'), 'novo\n');
  exec('git', ['add', '--', 'NOVO.md'], repo);
  exec('git', ['commit', '-q', '-m', 'novo'], repo);
  exec('git', ['checkout', '-q', 'main'], repo);
  caso(casos, 'ship cli: entrega sem remoto', () => texto(ork(repo, amb, 'ship', 'shp-entrega', '--para', 'main', '--de', 'feature')));
  caso(casos, 'ship cli: entrega ja incorporada', () => texto(ork(repo, amb, 'ship', 'shp-entrega', '--para', 'main', '--de', 'feature')));
  caso(casos, 'ship cli: ledger do ship', () => [
    textosDoLedger(repo, 'shp-reprova', ['ship_blocked', 'gate_blocked']),
    textosDoLedger(repo, 'shp-pausa', ['ship_blocked', 'gate_blocked']),
    textosDoLedger(repo, 'shp-entrega', ['ship_blocked', 'gate_blocked', 'ship_done', 'gate_passed']),
  ].join('\n'));
  // O registrar-pr le a base do remoto: com um remoto legivel que nao tem o merge, a recusa segue "nenhum merge".
  const remoto = dirTemp('ship-remoto', '<REMOTO>');
  exec('git', ['init', '-q', '--bare', '-b', 'main', remoto], repo);
  exec('git', ['remote', 'add', 'origin', remoto], repo);
  exec('git', ['push', '-q', 'origin', `${exec('git', ['rev-list', '--max-parents=0', 'main'], repo).stdout.trim()}:refs/heads/main`], repo);
  caso(casos, 'ship cli: registrar-pr uso', () => texto(ork(repo, amb, 'ship', 'registrar-pr')));
  caso(casos, 'ship cli: registrar-pr uso com repo sem pr', () => texto(ork(repo, amb, 'ship', 'registrar-pr', 'shp-entrega', '--repo', 'a/b')));
  caso(casos, 'ship cli: registrar-pr todas em ensaio', () => texto(ork(repo, amb, 'ship', 'registrar-pr', '--todas', '--dry-run')));
  caso(casos, 'ship cli: registrar-pr de uma thread em ensaio', () =>
    texto(ork(repo, amb, 'ship', 'registrar-pr', 'shp-reprova', '--dry-run')));
  caso(casos, 'ship cli: registrar-pr de thread ja entregue', () => texto(ork(repo, amb, 'ship', 'registrar-pr', 'shp-entrega')));
  caso(casos, 'ship cli: registrar-pr de repositorio externo nao declarado', () =>
    texto(ork(repo, amb, 'ship', 'registrar-pr', 'shp-reprova', '--repo', 'dono/externo', '--pr', '7', '--dry-run')));
  // Sem leitura do remoto (o fetch falha), a recusa e sem-leitura, nunca "nenhum merge".
  exec('git', ['remote', 'set-url', 'origin', path.join(remoto, 'nao-existe.git')], repo);
  caso(casos, 'ship cli: registrar-pr sem leitura do remoto', () =>
    texto(ork(repo, amb, 'ship', 'registrar-pr', 'shp-reprova', '--dry-run')));
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

function plano(extra: Partial<PlanoDeRetry>): PlanoDeRetry {
  return { thread: 'loc-x', modo: 'auto', fase: 'GO', motivo: 'claims.failed', detalhe: '', politica: POLITICA_DE_RETRY['claims.failed'],
    acao: 'corrigir-dirigido', tentativas: 0, limite: 3, effort: 'high', effortAnterior: 'high', automatica: true, bloqueio: null,
    razao: POLITICA_DE_RETRY['claims.failed'].porque, ...extra } as PlanoDeRetry;
}

function retry(extra: Partial<ResultadoDeRetry>): ResultadoDeRetry {
  return { plano: plano({}), executada: false, rodada: null, reverify: null, sync: null, redespacho: null, fila: [], detalhe: '',
    ...extra } as ResultadoDeRetry;
}

function casosDoRetry(casos: Record<string, string>): void {
  definirFusoDoDono(SP);
  caso(casos, 'retry: a politica inteira (porque e correcao de cada motivo)', () => JSON.stringify(POLITICA_DE_RETRY, null, 1));
  caso(casos, 'retry: plano sem reprovacao', () => textoDoPlano(plano({ motivo: null, fase: null, politica: null, acao: 'sem-retry',
    automatica: false, bloqueio: 'gate.sem-reprovacao', detalhe: 'nenhum gate reprovado no ledger desta thread',
    razao: 'nao ha o que repetir: o ledger da thread nao tem reprovacao tipada pendente' })));
  caso(casos, 'retry: plano automatico com detalhe datado', () => textoDoPlano(plano({ detalhe: `C2: comando "false" saiu com codigo 1 em ${T0}` })));
  caso(casos, 'retry: plano escalado de esforco', () => textoDoPlano(plano({ acao: 'escalar-esforco', tentativas: 1, effort: 'xhigh',
    effortAnterior: 'high' })));
  caso(casos, 'retry: plano no limite de escalacao', () => textoDoPlano(plano({ acao: 'escalar-humano', tentativas: 3, automatica: false,
    bloqueio: 'escalacao.limite', razao: '3 tentativa(s) automatica(s) por claims.failed em GO, no limite de 3 do manifesto: escalacao tipada pausa qualquer modo, inclusive #Auto' })));
  caso(casos, 'retry: plano de politica nao automatica', () => textoDoPlano(plano({ motivo: 'runtime.quota-exhausted',
    politica: POLITICA_DE_RETRY['runtime.quota-exhausted'], acao: POLITICA_DE_RETRY['runtime.quota-exhausted'].acao,
    automatica: false, bloqueio: 'politica.nao-automatica', razao: POLITICA_DE_RETRY['runtime.quota-exhausted'].porque })));
  caso(casos, 'retry: execucao com rodada, reverify e fila', () => textoDoRetry(retry({ executada: true,
    detalhe: `pedido R1 na fila ate ${T2}`,
    rodada: { rodada: 2, correcoes: [{ id: 'F1', tipo: 'A', origem: 'claims.failed' }, { id: 'F2', tipo: 'B', origem: 'verify.regression' }] } as never,
    reverify: { veredito: 'PASSOU', cobertura: 'completa' } as never,
    fila: [{ id: 'R1', fase: 'GO', liberaEm: T2, janelaEstimada: true } as never, { id: 'R2', fase: 'CHECK', liberaEm: T2, janelaEstimada: false } as never] })));
  caso(casos, 'retry: execucao sem acao', () => textoDoRetry(retry({ detalhe: 'nenhum pedido aguardando na fila para esta thread' })));

  const amb = ambiente('retry');
  const repo = projeto('retry', 'rty', amb);
  ork(repo, amb, 'thread', 'new', 'Falha', '--modo', 'auto', '--sem-worktree');
  ork(repo, amb, 'claims', 'add', 'rty-falha', 'README.md', '--claim', 'reprova sempre', '--verificar', 'false');
  ork(repo, amb, 'thread', 'new', 'Limpa', '--modo', 'auto', '--sem-worktree');
  fs.writeFileSync(path.join(repo, 'passa.txt'), 'sim\n');
  ork(repo, amb, 'verify', 'rty-falha', '--so-claims');
  caso(casos, 'retry cli: plan sem thread', () => texto(ork(repo, amb, 'retry', 'plan')));
  caso(casos, 'retry cli: run sem thread', () => texto(ork(repo, amb, 'retry', 'run')));
  caso(casos, 'retry cli: plan sem reprovacao', () => texto(ork(repo, amb, 'retry', 'plan', 'rty-limpa')));
  caso(casos, 'retry cli: plan de claim reprovada', () => texto(ork(repo, amb, 'retry', 'plan', 'rty-falha')));
  caso(casos, 'retry cli: plan com motivo forcado', () =>
    texto(ork(repo, amb, 'retry', 'plan', 'rty-falha', '--motivo', 'runtime.quota-exhausted', '--fase', 'GO')));
  caso(casos, 'retry cli: run em ensaio', () => texto(ork(repo, amb, 'retry', 'run', 'rty-falha', '--dry-run')));
  caso(casos, 'retry cli: run sem reprovacao', () => texto(ork(repo, amb, 'retry', 'run', 'rty-limpa')));
  caso(casos, 'retry cli: run com motivo de cota sem despacho', () =>
    texto(ork(repo, amb, 'retry', 'run', 'rty-limpa', '--motivo', 'runtime.quota-exhausted', '--fase', 'GO')));
  caso(casos, 'retry cli: run de verify reprovado', () => texto(ork(repo, amb, 'retry', 'run', 'rty-falha')));
  const tiposDoRetry = ['retry_planned', 'retry_attempt', 'retry_escalated', 'gate_blocked', 'go_fix_opened'];
  caso(casos, 'retry cli: ledger do retry', () => [textosDoLedger(repo, 'rty-falha', tiposDoRetry),
    textosDoLedger(repo, 'rty-limpa', tiposDoRetry)].join('\n'));
}

// ---------------------------------------------------------------------------
// Master
// ---------------------------------------------------------------------------

function entregar(repo: string, amb: Ambiente, id: string): void {
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(repo, 'README.md'))).digest('hex');
  const r = ork(repo, amb, 'thread', 'entrega', id, '--arquivo', 'README.md', '--sha256', sha256, '--por', 'teste');
  if (r.status !== 0) throw new Error(`entrega falhou: ${r.stderr}${r.stdout}`);
}

function casosDoMaster(casos: Record<string, string>): void {
  const amb = ambiente('master');
  const repo = projeto('master', 'mst', amb);
  caso(casos, 'master cli: indice vazio', () => texto(ork(repo, amb, 'master')));
  caso(casos, 'master cli: indice vazio com --todas', () => texto(ork(repo, amb, 'master', '--todas')));
  caso(casos, 'master cli: aceite sem entregas', () => texto(ork(repo, amb, 'master', '--aceitar-omissao')));
  caso(casos, 'master cli: ensaio do aceite sem entregas', () => texto(ork(repo, amb, 'master', '--aceitar-omissao', '--dry-run')));
  for (const nome of ['Primeira', 'Segunda', 'Aberta']) ork(repo, amb, 'thread', 'new', nome, '--modo', 'auto', '--sem-worktree');
  entregar(repo, amb, 'mst-primeira');
  entregar(repo, amb, 'mst-segunda');
  caso(casos, 'master cli: indice com entregas', () => texto(ork(repo, amb, 'master')));
  caso(casos, 'master cli: indice com --todas', () => texto(ork(repo, amb, 'master', '--todas')));
  caso(casos, 'master cli: ensaio do aceite de todas', () => texto(ork(repo, amb, 'master', '--aceitar-omissao', '--dry-run')));
  caso(casos, 'master cli: ensaio do aceite de todas por agente', () =>
    texto(orkComEnv(repo, amb, { CLAUDECODE: '1' }, 'master', '--aceitar-omissao', '--dry-run')));
  caso(casos, 'master cli: aceite de thread sem entrega', () => texto(ork(repo, amb, 'master', 'mst-aberta', '--aceitar-omissao')));
  caso(casos, 'master cli: aceite com duas threads', () =>
    texto(ork(repo, amb, 'master', 'mst-primeira', '--aceitar-omissao', '--thread', 'mst-segunda')));
  caso(casos, 'master cli: pedir sem thread', () => texto(ork(repo, amb, 'master', 'pedir')));
  caso(casos, 'master cli: pedir com formato invalido', () => texto(ork(repo, amb, 'master', 'pedir', 'mst-primeira', '--formato', 'x')));
  caso(casos, 'master cli: pedir de thread sem entrega', () => texto(ork(repo, amb, 'master', 'pedir', 'mst-aberta')));
  caso(casos, 'master cli: pedir no telegram', () => texto(ork(repo, amb, 'master', 'pedir', 'mst-segunda')));
  caso(casos, 'master cli: pedir no terminal', () => texto(ork(repo, amb, 'master', 'pedir', 'mst-segunda', '--formato', 'terminal')));
  caso(casos, 'master cli: aceite de uma thread', () => texto(ork(repo, amb, 'master', 'mst-primeira', '--aceitar-omissao')));
  caso(casos, 'master cli: aceite de thread ja fechada', () => texto(ork(repo, amb, 'master', 'mst-primeira', '--aceitar-omissao')));
  caso(casos, 'master cli: indice com aceitas por omissao', () => texto(ork(repo, amb, 'master')));
  caso(casos, 'master cli: aceite das que sobraram', () => texto(ork(repo, amb, 'master', '--aceitar-omissao')));
  caso(casos, 'master cli: indice so com aceitas', () => texto(ork(repo, amb, 'master')));
  caso(casos, 'master cli: master log e postmortem gravados', () => {
    const dir = path.join(repo, '.orkastery', 'threads', 'mst-primeira');
    return fs.readdirSync(dir).filter((f) => /MASTER|POSTMORTEM/.test(f)).sort()
      .map((f) => `${f}\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n');
  });
  caso(casos, 'master cli: pulse sem runtime com entregas', () => texto(ork(repo, amb, 'pulse', '--sem-runtime')));
  caso(casos, 'master cli: pulse sem o claude no PATH', () => texto(orkComEnv(repo, amb, { PATH: amb.bin }, 'pulse')));
  // A pausa prevista ao fim do bloco (#Classic), a thread pausada, a fila de rate limit e o gate sem detalhe.
  ork(repo, amb, 'thread', 'new', 'Classica', '--modo', 'classic', '--sem-worktree');
  registrar(path.join(repo, '.orkastery', 'threads', 'mst-classica'), 'mst-classica', 'human_gate',
    { fase: 'GOAL', slug: 'mst-classica-goal', sessionId: '11111111-2222-3333-4444-555555555555', previstaSobre: 'objetivo',
      estado: 'prevista ao fim do bloco' });
  ork(repo, amb, 'thread', 'new', 'Pausada', '--modo', 'classic', '--sem-worktree');
  const pausada = lerThread(repo, 'mst-pausada');
  gravarThread(repo, { ...pausada, status: 'pausada' });
  registrar(path.join(repo, '.orkastery', 'threads', 'mst-aberta'), 'mst-aberta', 'gate_blocked',
    { gate: 'verify', motivo: 'verify.failed', fase: 'GO', modo: 'auto' });
  enfileirar(exigirManifesto(repo), { thread: 'mst-aberta', fase: 'GO', slug: 'mst-aberta-full', promptPath: 'prompt.md',
    promptSha256: '0'.repeat(64), cwd: repo, model: null, effort: null,
    sinal: { resetEm: '2099-01-01T00:00:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' }, detalhe: 'rate limit SIMULADO' });
  caso(casos, 'master cli: pulse com pausa, thread pausada, fila e gate sem detalhe', () =>
    texto(ork(repo, amb, 'pulse', '--sem-runtime')));
  caso(casos, 'monitor: paradas que o monitor monta', () => {
    const monitor = montarMonitor(exigirManifesto(repo), { agora: '2098-12-31T23:00:00.000Z', estados: null });
    return monitor.linhas.flatMap((l) => l.paradas.map((p) => `${l.thread} ${p.motivo} | ${p.detalhe} | ${p.correcao}`)).sort().join('\n');
  });
  caso(casos, 'master cli: roadmap status sem itens', () => texto(ork(repo, amb, 'roadmap', 'status')));
  // A fabrica compartilhada num clone parcial: o motivo que o proprio status monta.
  exec('git', ['config', 'extensions.partialclone', 'origin'], repo);
  caso(casos, 'master cli: roadmap status com a fabrica num clone parcial', () =>
    texto(orkComEnv(repo, amb, { ORK_FABRICA_COMPARTILHADA: '1' }, 'roadmap', 'status')));
  exec('git', ['config', '--unset', 'extensions.partialclone'], repo);
  // O impedimento do despacho que so o dono resolve (RM-055): as alternativas que o pulse monta.
  ork(repo, amb, 'thread', 'new', 'Impedida', '--modo', 'auto', '--sem-worktree');
  registrar(path.join(repo, '.orkastery', 'threads', 'mst-impedida'), 'mst-impedida', 'gate_blocked',
    { gate: 'dispatch', motivo: 'runtime.workspace-untrusted', fase: 'GO', modo: 'auto', detalhe: 'SIMULADO: pasta sem confianca',
      impedimento: { comando: 'claude', depois: 'o ork despacha o mesmo prompt de novo', trecho: 'SIMULADO' } });
  caso(casos, 'master cli: pulse com o impedimento do despacho', () => texto(ork(repo, amb, 'pulse', '--sem-runtime')));
  // As vagas do escalonador: uma sessao trabalhando com o limite em 1, outra parada ha muito tempo e uma livre na fila.
  ork(repo, amb, 'thread', 'new', 'Ativa', '--modo', 'auto', '--sem-worktree');
  ork(repo, amb, 'thread', 'new', 'Esquecida', '--modo', 'auto', '--sem-worktree');
  ork(repo, amb, 'thread', 'new', 'Livre', '--modo', 'auto', '--sem-worktree');
  const ativa = '22222222-3333-4444-5555-666666666666', esquecida = '33333333-4444-5555-6666-777777777777';
  registrar(path.join(repo, '.orkastery', 'threads', 'mst-ativa'), 'mst-ativa', 'phase_dispatch', { fase: 'GOAL', sessionId: ativa });
  registrar(path.join(repo, '.orkastery', 'threads', 'mst-esquecida'), 'mst-esquecida', 'phase_dispatch', { fase: 'GOAL', sessionId: esquecida });
  caso(casos, 'monitor: vagas do escalonador', () => {
    const c = exigirManifesto(repo);
    const limite1 = { ...c, manifesto: { ...c.manifesto, concurrency: { ...c.manifesto.concurrency, max_parallel_threads: 1 } } };
    return planejar(limite1, { agora: '2098-12-31T23:00:00.000Z', estados: new Map([[ativa, 'working']]) }).vagas
      .filter((v) => v.motivo).map((v) => `${v.thread} ${v.motivo} | ${v.correcao}`).sort().join('\n');
  });
}

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------

function item(extra: Partial<ItemPulse>): ItemPulse {
  return { id: 'x', classe: 'thread', motivo: 'claims.failed', thread: 'loc-x', fase: 'GO', sessionId: null, desdeEm: T0, paradaHaMin: 5,
    impacto: 3, pergunta: 'C2: comando "false" saiu com codigo 1', opcoes: [], recomendacao: 'ork fix open loc-x', comandoResposta: 'ork fix open loc-x',
    evidencia: [], fontes: ['monitor'], contextoLogs: [], ...extra } as ItemPulse;
}

const HITL: HitlDeConducaoAgora = {
  abertas: [{ thread: 'loc-x', pedidoId: 'p1', fase: 'PLAN', desdeEm: T0, paradaHaMin: 12 },
    { thread: 'loc-y', pedidoId: 'p2', fase: 'GO', desdeEm: T1, paradaHaMin: 0 }],
  seteDias: { medianaRespostaMs: 180_000, dentroDaMeta: true, respondidos: 4 } as never,
  acimaDaMeta: true,
};

function casosDoPulse(casos: Record<string, string>): void {
  definirFusoDoDono(SP);
  const base: Pulse = { contrato: 'ork.pulse/v1' as never, consultadoEm: T1, runtime: { ok: true, detalhe: '' }, precisaDeHumanoAgora: [],
    acoesAutomaticas: [], resumo: { humanos: 0, automaticas: 0, scores: 0, fasesOrfas: 0 } };
  caso(casos, 'pulse: texto vazio', () => textoDoPulse(base));
  caso(casos, 'pulse: texto com consulta incompleta', () => textoDoPulse({ ...base, runtime: { ok: false, detalhe: 'runtime não consultado por --sem-runtime' } }));
  caso(casos, 'pulse: texto com diagnostico', () => textoDoPulse({ ...base,
    runtime: { ok: true, detalhe: `prs.nao-lidos: gh falhou em ${T0}; radar.orcamento: 2 tela(s) de sessão ficaram para a próxima varredura` } }));
  caso(casos, 'pulse: texto completo', () => textoDoPulse({ ...base,
    precisaDeHumanoAgora: [
      item({ opcoes: ['a. seguir', 'b. parar'], contextoLogs: ['linha 1'], paradaHaMin: null }),
      item({ thread: null, sessionId: 'sessao-1', classe: 'blocked', paradaHaMin: 0, pergunta: `Fase GO sem heartbeat desde ${T0}.` }),
      item({ paradaHaMin: 42, recomendacao: 'Aceitar por padrão com registro; a nota humana, quando vier, sobrescreve.' }),
    ],
    acoesAutomaticas: [item({ motivo: 'master.score-pendente', comandoResposta: 'ork master --aceitar-omissao' })],
    resumo: { humanos: 3, automaticas: 1, scores: 2, fasesOrfas: 0 },
    conducoes: [{ thread: 'loc-x', linha: 'conduzido agora por cli, sessao 11111111, fase GO, desde 19/09 15:16' }],
    paradoNoCondutor: [{ thread: 'loc-z', caso: 'pr-verde', desdeEm: T0, paradoHaMin: 30, proximoPasso: 'mescle o PR #12',
      evidencia: [], branch: 'ork/loc-z', pr: 12, sessionId: null } as never],
    hitlDeConducao: HITL,
  }));
  caso(casos, 'pulse: estado da sessao no radar', () =>
    ['blocked', 'failed', 'working', 'done', 'stopped', 'idle', '', 'xyz'].map((e) => `${e}: ${classificarEstado(e).detalhe}`).join('\n'));
  caso(casos, 'pulse: descricao de cada motivo', () => JSON.stringify(DESCRICAO_DO_MOTIVO, null, 1));
  caso(casos, 'pulse: classe da sessao no item e na acao automatica', () => textoDoPulse({ ...base,
    precisaDeHumanoAgora: ['hitl', 'falha', 'abandonada', 'desconhecida', 'fase_orfa'].map((classe) => item({ classe, paradaHaMin: 3 })),
    acoesAutomaticas: [item({ classe: 'falha', motivo: 'falha', comandoResposta: 'ork sessions logs abc12345' }),
      item({ classe: 'hitl', motivo: 'hitl.permissao', comandoResposta: 'claude attach abc12345' })],
    resumo: { humanos: 5, automaticas: 2, scores: 0, fasesOrfas: 1 } }));
  caso(casos, 'pulse: recomendacao do radar por tipo de parada', () => [recomendarPara('abandonada', null, 'abc12345'),
    recomendarPara('falha', null, 'abc12345'), recomendarPara('desconhecida', null, 'abc12345'),
    recomendarPara('hitl', 'hitl.credencial', 'abc12345'), recomendarPara('hitl', 'hitl.permissao', 'abc12345'),
    recomendarPara('hitl', 'hitl.pergunta', 'abc12345'), recomendarPara('hitl', null, 'abc12345')].join('\n'));
  caso(casos, 'pulse: quanto falta na fila', () => ['2025-09-19T18:00:00.000Z', '2025-09-19T18:46:00.000Z', '2025-09-19T20:21:00.000Z']
    .map((liberaEm) => faltaPara({ liberaEm } as never, T1)).join(' | '));
  caso(casos, 'pulse: linhas auxiliares', () => [
    linhaDoParadoNoCondutor({ thread: 'loc-z', desdeEm: T0, proximoPasso: 'mescle o PR #12' }, { agora: T1 }),
    textoDaMediana(HITL),
    textoDaMediana({ ...HITL, seteDias: { medianaRespostaMs: null, dentroDaMeta: true, respondidos: 0 } as never }),
    textoDaMediana({ ...HITL, seteDias: { medianaRespostaMs: 600_000, dentroDaMeta: false, respondidos: 1 } as never }),
    linhaDaPerguntaParada(HITL.abertas[0], { agora: T1 }),
    linhaDaPerguntaParada(HITL.abertas[1], { agora: T1 }),
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// Roadmap status
// ---------------------------------------------------------------------------

function itemDoStatus(id: string, grupo: ItemDoStatus['grupo'], extra: Partial<ItemDoStatus> = {}): ItemDoStatus {
  return { id, titulo: `Titulo de ${id}`, ciclo: 'Em desenvolvimento', grupo, emAberto: [], threads: [], ...extra };
}

function casosDoRoadmap(casos: Record<string, string>): void {
  definirFusoDoDono(SP);
  const grupos = GRUPOS_DO_ROADMAP.map((g, i) => ({ ...g, itens: [
    itemDoStatus(`RM-0${10 + i}`, g.id, i === 1 ? { emAberto: ['exposicao', 'habilitacao'] } : i === 4
      ? { conduzindo: { thread: 'loc-x', fase: 'GO' }, hitl: { thread: 'loc-x', pergunta: 'Seguir?' } } : i === 3
        ? { conduzindo: { thread: 'loc-y', fase: 'PLAN', maquina: 'vps' } } : {}),
  ] }));
  const consulta = { contrato: 'ork.consulta-do-projeto/v1', projeto: { nome: 'loc', abbrev: 'loc', raiz: '/repo/loc', remoto: null,
    origem: 'cwd' }, lido: ['roadmap (docs/roadmap)'], naoLido: ['reservas do roadmap (ork roadmap reservas)'] };
  const base: StatusDoRoadmap = { contrato: 'ork.roadmap-status/v1' as never, consultadoEm: T1, projeto: 'loc', grupos,
    precisaDeVoce: [], emSeguida: [] };
  caso(casos, 'roadmap: texto vazio', () => textoDoStatusDoRoadmap({ ...base, grupos: [] }));
  caso(casos, 'roadmap: texto completo', () => textoDoStatusDoRoadmap({ ...base,
    consulta: consulta as never,
    precisaDeVoce: [
      { item: 'RM-014', espera: { thread: 'loc-x', pergunta: 'Seguir?', codigo: 'AB12', recomendada: 'b' } },
      { item: 'RM-015', espera: { thread: 'loc-w', pergunta: 'Qual?', maquina: 'vps' } },
      { item: 'RM-016', espera: { thread: 'loc-v', pergunta: 'Pode?', codigo: 'CD34' } },
    ],
    foraDoRoadmap: { threads: ['loc-q', 'loc-r'] },
    hitlDeConducao: HITL,
    emSeguida: [
      { item: 'RM-013', thread: 'loc-x', fase: 'GO' },
      { item: 'RM-012', thread: 'loc-y', fase: 'PLAN', maquina: 'vps', entrega: { estado: 'PR #3 aberto, CI verde', conduzida: true, prLidoEm: T0 } },
      { item: 'RM-011', thread: 'loc-z', fase: 'SHIP', entrega: { estado: 'PR #4 aberto', prLidoEm: T0 } },
      { item: 'RM-010', thread: 'loc-u', fase: 'SHIP', entrega: { estado: null, parado: { desdeEm: T0, proximoPasso: 'mescle o PR #5', prLidoEm: T1 } } },
      { item: 'RM-009', thread: 'loc-t', fase: 'SHIP', entrega: { estado: null, parado: { desdeEm: T0, proximoPasso: 'publique a branch' } } },
      { item: 'RM-008', thread: 'loc-s', fase: 'GO', entrega: { estado: 'sem PR' } },
    ],
    fabrica: { lido: true, semBatida: [{ maquina: 'vps', publicadoEm: T0, idadeMin: 95 }, { maquina: 'note', publicadoEm: T0, idadeMin: 3000 }] },
  }));
  caso(casos, 'roadmap: fabrica sem leitura, copia velha e com fecho cortado', () => [
    textoDoStatusDoRoadmap({ ...base, fabrica: { lido: false, semBatida: [] } }),
    textoDoStatusDoRoadmap({ ...base, fabrica: { lido: false, motivo: 'copia ilegivel', semBatida: [] } }),
    textoDoStatusDoRoadmap({ ...base, fabrica: { lido: true, copiaVelha: { ultimoDestaMaquina: T0 }, semBatida: [] } }),
    textoDoStatusDoRoadmap({ ...base, fabrica: { lido: true, copiaVelha: { ultimoDestaMaquina: null }, semBatida: [] } }),
    textoDoStatusDoRoadmap({ ...base, grupos: [], precisaDeVoce: Array.from({ length: 7 }, (_, i) => ({ item: `RM-1${i}`,
      espera: { thread: `loc-${i}`, pergunta: 'Seguir?' } })), emSeguida: Array.from({ length: 6 }, (_, i) => ({ item: `RM-2${i}`,
      thread: `loc-${i}`, fase: 'GO' })) }),
    textoDoStatusDoRoadmap({ ...base, grupos: [] }, 'UTC', { legenda: false }),
  ].join('\n----\n'));
}

/** Todos os casos, na ordem; cada familia limpa o que criou. */
export function gerarCasos(): Record<string, string> {
  const casos: Record<string, string> = {};
  try {
    casosDoVerify(casos);
    casosDoShip(casos);
    casosDoRetry(casos);
    casosDoMaster(casos);
    casosDoPulse(casos);
    casosDoRoadmap(casos);
  } finally {
    definirFusoDoDono(undefined);
    limparTudo();
  }
  return casos;
}

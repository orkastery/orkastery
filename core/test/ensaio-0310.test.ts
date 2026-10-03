/**
 * Ensaio de primeira experiencia sobre a main de 03/10/2026 (thread ork-rm049ensaiod, RM-049): os
 * defeitos achados seguindo o quickstart com o tarball do `npm pack` num prefixo isolado. Os nomes
 * comecam por "ensaio 0310 <ID>:" para que cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente; nenhum teste depende de `claude`,
 * `codex`, crontab, horario ou fuso de quem roda.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from '../src/util';
import { init } from '../src/init';
import { checar } from '../src/doctor';
import { checarCronDoPulse, comandoDaVarredura, scriptDaVarreduraDoOrk, LeituraDoCrontab } from '../src/doctor-pulse-cron';
import { planejar } from '../src/board';
import { dirThread, novaThread } from '../src/thread';
import { registrarImpedimentoDoDono } from '../src/impedimento';
import { calcularIndice } from '../src/indice';
import { ship } from '../src/ship';
import { lerLedger, registrar } from '../src/ledger';
import { tabelaDoLedger } from '../src/phase';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PATH_ATUAL = process.env.PATH ?? '/usr/bin:/bin';
const semCrontab = (): LeituraDoCrontab => ({ ok: false, motivo: 'crontab -l falhou: no crontab for teste' });

function ork(dir: string, casa: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: PATH_ATUAL, LANG: 'C.UTF-8' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('ensaio 0310 E1: ork init fora de repositorio git recusa sem criar nada', () => {
  const solto = dirTemporario('ensaio0310-solto');
  const casa = dirTemporario('ensaio0310-solto-casa');
  try {
    const r = ork(solto, casa, 'init', '--name', 'solto', '--abbrev', 'slt');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /init\.fora-do-repositorio: .* não está num repositório git; nada foi criado/);
    assert.match(r.stderr, /git init e o primeiro commit/);
    assert.deepEqual(fs.readdirSync(solto), [], 'nem manifesto, nem AGENTS.md, nem .orkastery/');

    // Dentro de um repositorio, o mesmo comando segue criando o manifesto.
    exec('git', ['init', '-q', '-b', 'main'], solto);
    const dentro = ork(solto, casa, 'init', '--name', 'solto', '--abbrev', 'slt');
    assert.equal(dentro.status, 0, dentro.stderr);
    assert.ok(fs.existsSync(path.join(solto, 'orkastery.yaml')));
  } finally { limpar(solto, casa); }
});

test('ensaio 0310 E1: doctor fora de repositorio manda entrar nele antes do ork init', () => {
  const solto = dirTemporario('ensaio0310-doctor-solto');
  try {
    const manifesto = checar(solto, [], semCrontab).find(c => c.nome === 'manifesto');
    assert.equal(manifesto?.nivel, 'fail');
    assert.match(manifesto!.correcao!, /entre no repositorio do projeto .* e rode ork init/);
    exec('git', ['init', '-q', '-b', 'main'], solto);
    assert.equal(checar(solto, [], semCrontab).find(c => c.nome === 'manifesto')?.correcao, 'ork init');
  } finally { limpar(solto); }
});

test('ensaio 0310 E1: doctor avisa o manifesto de fora do repositorio e cala na worktree da thread', () => {
  const acima = dirTemporario('ensaio0310-acima');
  const p = projetoTemporario('ensaio0310-worktree');
  try {
    // O `ork init` antigo numa pasta sem git (a funcao aceita); o repositorio nasce depois, dentro dela.
    init(acima, { nome: 'casa', abbrev: 'cas' });
    const repo = path.join(acima, 'brinquedo');
    fs.mkdirSync(repo);
    exec('git', ['init', '-q', '-b', 'main'], repo);
    const aviso = checar(repo, [], semCrontab).find(c => c.nome === 'manifesto do repositorio');
    assert.equal(aviso?.nivel, 'warn');
    assert.ok(aviso!.detalhe.includes(path.join(acima, 'orkastery.yaml')), aviso!.detalhe);
    assert.match(aviso!.correcao!, /rode ork init na raiz deste repositorio/);

    // Na raiz do repositorio com o proprio manifesto, nada.
    init(repo, { nome: 'brinquedo', abbrev: 'brq' });
    assert.equal(checar(repo, [], semCrontab).find(c => c.nome === 'manifesto do repositorio'), undefined);

    // A worktree da thread le o manifesto (ainda sem commit) da arvore principal: e o mesmo repositorio.
    const { thread } = novaThread(p.carregado, { nome: 'worktree sem manifesto', modo: 'fast', criarWorktree: true });
    assert.ok(thread.worktree && !fs.existsSync(path.join(thread.worktree, 'orkastery.yaml')));
    assert.equal(checar(thread.worktree!, [], semCrontab).find(c => c.nome === 'manifesto do repositorio'), undefined);
  } finally { limpar(acima); p.limpar(); }
});

test('ensaio 0310 E2: o board mostra a correcao do impedimento do dono, nao um gate request recusado', () => {
  const p = projetoTemporario('ensaio0310-board');
  const casa = dirTemporario('ensaio0310-board-casa');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'despacho sem confianca', modo: 'fast', criarWorktree: true });
    const dir = dirThread(p.dir, thread.id);
    const imp = registrarImpedimentoDoDono(dir, thread, { fase: 'GO', slug: thread.slug, runtime: 'claude-bg',
      cwd: thread.worktree!, origem: 'phase.run', promptPath: path.join(dir, 'prompts', 'p.md'), promptSha256: 'a'.repeat(64),
      saida: `Workspace not trusted. Run \`claude\` in ${thread.worktree} once and accept the trust prompt, then retry.` });
    assert.equal(imp?.motivo, 'runtime.workspace-untrusted');

    const vaga = planejar(p.carregado, { agora: new Date().toISOString(), estados: new Map() }).vagas.find(v => v.thread === thread.id);
    assert.equal(vaga?.situacao, 'pausada');
    assert.match(vaga!.correcao, new RegExp(`ork retry run ${thread.id}`));
    assert.doesNotMatch(vaga!.correcao, /gate request/);

    // O comando que o board mostrava antes e recusado no #Fast: e por isso que ele saiu.
    const antigo = ork(p.dir, casa, 'gate', 'request', thread.id);
    assert.notEqual(antigo.status, 0);
    assert.match(antigo.stderr, /modo não prevê pausa humana nesta fase/);
  } finally { p.limpar(); limpar(casa); }
});

test('ensaio 0310 E3: o ship --dry-run barrado nao desconta o indice nem conta como reprovacao do POSTMORTEM', () => {
  const p = projetoTemporario('ensaio0310-indice');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'ensaio do ship', modo: 'fast', criarWorktree: true });
    const dir = dirThread(p.dir, thread.id);
    // #Fast sem autorizacao: o ensaio barra por human.pending e grava ship_blocked com dryRun.
    assert.equal(ship(p.carregado, thread.id, { para: 'main', dryRun: true }).motivo, 'human.pending');
    const eventos = lerLedger(dir);
    assert.equal(eventos.filter(e => e.tipo === 'ship_blocked' && e.dryRun === true).length, 1);
    assert.deepEqual(calcularIndice(eventos), { valor: 5, base: 5, parcelas: [], derivado: true });

    // O ship de verdade barrado continua descontando.
    registrar(dir, thread.id, 'ship_blocked', { de: 'x', para: 'main', motivo: 'human.pending' });
    const real = calcularIndice(lerLedger(dir));
    assert.equal(real.valor, 4.75);
    assert.equal(real.parcelas[0].ocorrencias, 1);
  } finally { p.limpar(); }
});

test('ensaio 0310 E3: ork master fecha a thread sem contar o gate do dry-run', () => {
  const p = projetoTemporario('ensaio0310-master');
  const casa = dirTemporario('ensaio0310-master-casa');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fecha depois do ensaio', modo: 'fast', criarWorktree: true });
    commitar(thread.worktree!, 'nota.txt', 'nota\n', 'nota');
    assert.equal(ship(p.carregado, thread.id, { para: 'main', dryRun: true }).motivo, 'human.pending');
    const entregue = ship(p.carregado, thread.id, { para: 'main', autorizarPush: 'Pessoa Teste' });
    assert.equal(entregue.ok, true, entregue.detalhe);

    const semPor = ork(p.dir, casa, 'master', thread.id, '--score', '4', '--justificativa', 'entregue com o teste focado');
    assert.equal(semPor.status, 1);
    assert.match(semPor.stderr, /--por humano explícito \(ex\.: --por "seu-nome"\)/);
    const r = ork(p.dir, casa, 'master', thread.id, '--score', '4', '--justificativa', 'entregue com o teste focado', '--por', 'Pessoa Teste');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /gates {10}0 reprovacao\(oes\) tipada\(s\)/);
    const pm = JSON.parse(fs.readFileSync(path.join(dirThread(p.dir, thread.id), 'POSTMORTEM.json'), 'utf8'));
    assert.deepEqual(pm.gatesBloqueados, []);
  } finally { p.limpar(); limpar(casa); }
});

test('ensaio 0310 E4: a linha do cron aponta o script do ork instalado quando o projeto nao o tem', () => {
  const p = projetoTemporario('ensaio0310-cron');
  const pacote = dirTemporario('ensaio0310-pacote');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ executavel: '/bin/true', argumentos: ['{{mensagem}}'] }));
    // O pacote do npm: dist/ ao lado de monitor/.
    fs.mkdirSync(path.join(pacote, 'dist'));
    fs.mkdirSync(path.join(pacote, 'monitor'));
    fs.writeFileSync(path.join(pacote, 'monitor', 'varredura-pulse.sh'), '#!/bin/sh\n', { mode: 0o755 });
    const script = scriptDaVarreduraDoOrk(path.join(pacote, 'dist'));
    assert.equal(script, path.join(pacote, 'monitor', 'varredura-pulse.sh'));

    const c = checarCronDoPulse(monitor, p.dir, semCrontab, script);
    assert.equal(c?.nivel, 'warn');
    assert.ok(c!.correcao!.endsWith(`*/15 * * * * ORK_PULSE_PROJECT=${p.dir} ${script}`), c!.correcao);
    assert.ok(!c!.correcao!.includes(path.join(p.dir, 'monitor', 'varredura-pulse.sh')), 'nunca o caminho que nao existe');

    // O checkout do proprio Orkastery traz o script na raiz: a linha segue a do template.
    fs.mkdirSync(path.join(p.dir, 'monitor'));
    fs.writeFileSync(path.join(p.dir, 'monitor', 'varredura-pulse.sh'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(comandoDaVarredura(p.dir, script), path.join(p.dir, 'monitor', 'varredura-pulse.sh'));
    // Caminho com espaco vai entre aspas: a linha e colada no crontab, que roda por sh.
    assert.equal(comandoDaVarredura('/tmp/meu projeto', '/opt/ork/monitor/varredura-pulse.sh'),
      `ORK_PULSE_PROJECT='/tmp/meu projeto' /opt/ork/monitor/varredura-pulse.sh`);
  } finally { p.limpar(); limpar(pacote); }
});

test('ensaio 0310 E5: phase list mostra o id curto do pedido da decisao autonoma, nunca [object Object]', () => {
  const p = projetoTemporario('ensaio0310-pedido');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'decisao no ledger', modo: 'auto' });
    registrar(dirThread(p.dir, thread.id), thread.id, 'autonomous_decision', { fase: 'GOAL', decisao: 'PLAN: um teste',
      quemDecidiu: 'teste', evidencia: 'core/src/phase.ts', razao: 'ensaio',
      pedido: { contrato: 'ork.hitl/v2', classe: 'decidido', id: '8d9605b8-de24-428f-aec0-471d0be98aed' } });
    registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', { fase: 'GOAL', motivo: 'human.pending', pedido: 'pedido-texto' });
    const tabela = tabelaDoLedger(p.dir, thread.id);
    assert.doesNotMatch(tabela, /\[object Object\]/);
    assert.match(tabela, /PLAN: um teste \| pedido 8d9605b8/);
    assert.match(tabela, /pedido pedido-texto/);
  } finally { p.limpar(); }
});

test('ensaio 0310 E6: as linhas do resumo do ship ficam alinhadas, inclusive a do ci', () => {
  const p = projetoTemporario('ensaio0310-alinhado');
  const casa = dirTemporario('ensaio0310-alinhado-casa');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'alinhamento', modo: 'fast', criarWorktree: true });
    commitar(thread.worktree!, 'nota.txt', 'nota\n', 'nota');
    const r = ork(p.dir, casa, 'ship', thread.id, '--para', 'main', '--dry-run', '--autorizar-push', 'Pessoa Teste');
    assert.equal(r.status, 0, r.stderr);
    const rotulos = r.stdout.split('\n').filter(l => /^ {2}(de|para|autorizacao|verificacao|ci|lease) +\S/.test(l));
    assert.ok(rotulos.some(l => l.startsWith('  ci ')), r.stdout);
    for (const l of rotulos) assert.equal(/^ {2}\S+ +/.exec(l)![0].length, 16, `coluna do valor: ${JSON.stringify(l)}`);
  } finally { p.limpar(); limpar(casa); }
});

test('ensaio 0310 E7: todo teste que sobe a fixture do OrkMind ou do PostgreSQL usa o skip tipado da suite local', () => {
  // A ponte da RM-038 entrou depois do skip tipado (RM-037) chamando pythonFixture() sem ele, e o
  // `npm test` de quem nao tem o OrkMind voltou a reprovar 9 testes por ambiente.
  const dir = __dirname.endsWith(path.join('dist-test', 'test')) ? path.resolve(__dirname, '../../test') : __dirname;
  const semSkip = fs.readdirSync(dir).filter(n => n.endsWith('.test.ts') && n !== 'ensaio-0310.test.ts')
    .filter(n => { const t = fs.readFileSync(path.join(dir, n), 'utf8');
      return /\b(pythonFixture|usingFixture|prepareFixture)\(/.test(t) && !/from '\.\/ambiente-de-teste'/.test(t); });
  assert.deepEqual(semSkip, []);
});

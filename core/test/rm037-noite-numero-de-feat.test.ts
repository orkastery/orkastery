/**
 * RM-037 (rm037noite, defeito 6): a RM-052, a RM-026 e a RM-051 criaram a FEAT-030 cada uma, em
 * maquinas e threads diferentes, porque o numero saia do `ls docs/produto` de cada branch. Agora o
 * numero sai de `ork roadmap feat`, reservado na branch `ork/roadmap-reservas` com a atomicidade do
 * item: o primeiro push vence, o segundo rele e leva o seguinte. Tudo e git de verdade, contra um
 * remoto bare temporario.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commitar, dirTemporario, projetoTemporario } from './apoio';
import { BRANCH_DE_RESERVAS, listarReservas, maiorFeatConhecida, pegarItem, reservarFeat, textoDasReservas } from '../src/roadmap-reservas';
import { exec } from '../src/util';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const A = { maquina: 'pc-a' };
const B = { maquina: 'pc-b' };

/** O projeto com FEAT-001 e FEAT-003 na main, publicado, e um segundo clone (a maquina B). */
function duasMaquinas(nome: string) {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  commitar(p.dir, 'docs/produto/FEAT-001-uma.md', '# FEAT-001\n', 'produto: FEAT-001');
  commitar(p.dir, 'docs/produto/FEAT-003-outra.md', '# FEAT-003\n', 'produto: FEAT-003');
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir);
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  const b = path.join(dirTemporario(`${nome}-b`), 'clone');
  exec('git', ['clone', '-q', p.remoto as string, b]);
  exec('git', ['config', 'user.email', 'b@orkastery.local'], b);
  exec('git', ['config', 'user.name', 'Builder B'], b);
  exec('git', ['config', 'commit.gpgsign', 'false'], b);
  return {
    a: p.dir, b, remoto: p.remoto as string,
    limpar: () => { p.limpar(); fs.rmSync(path.dirname(b), { recursive: true, force: true }); },
  };
}

test('defeito 6: duas maquinas pedem numero de FEAT e recebem numeros diferentes, depois do maior da main', () => {
  const m = duasMaquinas('rm037noite-feat-duas');
  try {
    assert.equal(maiorFeatConhecida(m.a), 3);
    const a = reservarFeat(m.a, { ...A, thread: 'ork-rm052projeto' });
    assert.equal(a.feat, 'FEAT-004');
    assert.equal(a.reserva.thread, 'ork-rm052projeto');
    assert.match(a.commit, /^[a-f0-9]{40}$/);
    // B nao tem FEAT-004 na arvore nem na main: e a reserva que impede a colisao de 29/09.
    const b = reservarFeat(m.b, { ...B, thread: 'ork-rm026k3dossi' });
    assert.equal(b.feat, 'FEAT-005');
    const painel = listarReservas(m.a);
    assert.deepEqual(painel.feats?.map((f) => [f.feat, f.maquina, f.thread]),
      [['FEAT-004', 'pc-a', 'ork-rm052projeto'], ['FEAT-005', 'pc-b', 'ork-rm026k3dossi']]);
    // Reservar item do roadmap depois nao apaga os numeros, e o painel da branch lista os dois.
    pegarItem(m.a, 'RM-001', A);
    exec('git', ['fetch', '-q', 'origin', `+refs/heads/${BRANCH_DE_RESERVAS}:refs/remotes/origin/${BRANCH_DE_RESERVAS}`], m.a);
    const md = exec('git', ['show', `origin/${BRANCH_DE_RESERVAS}:RESERVAS.md`], m.a).stdout;
    assert.match(md, /\| RM-001 \| Teste Orkastery \| pc-a \|/);
    assert.match(md, /## Números de FEAT reservados/);
    assert.match(md, /\| FEAT-004 \| Teste Orkastery \| pc-a \| ork-rm052projeto \|/);
    assert.match(md, /\| FEAT-005 \| Builder B \| pc-b \| ork-rm026k3dossi \|/);
    assert.deepEqual(listarReservas(m.b).feats?.map((f) => f.feat), ['FEAT-004', 'FEAT-005']);
    assert.match(textoDasReservas(listarReservas(m.a)), /Números de FEAT reservados \(2\), os últimos: FEAT-004 \(ork-rm052projeto\), FEAT-005/);
    for (const dir of [m.a, m.b]) assert.equal(exec('git', ['status', '--porcelain'], dir).stdout.trim(), '', `arvore intacta em ${dir}`);
  } finally { m.limpar(); }
});

test('defeito 6: corrida, o push que chega depois e recusado, relido, e leva o numero seguinte', () => {
  const m = duasMaquinas('rm037noite-feat-corrida');
  try {
    reservarFeat(m.b, B); // a branch ja existe: a corrida e sobre uma ponta, nao sobre o nascimento (FEAT-004)
    // Entre o fetch e o push de B, a maquina A reserva um numero (hook pre-push de B, uma vez so).
    const marca = path.join(path.dirname(m.b), 'corrida-feita');
    fs.writeFileSync(path.join(m.b, '.git', 'hooks', 'pre-push'),
      `#!/bin/sh\n[ -f "${marca}" ] && exit 0\ntouch "${marca}"\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\n` +
      `cd "${m.a}" && ORK_MAQUINA=pc-a "${process.execPath}" "${CLI}" roadmap feat --thread ork-a >/dev/null\n`, { mode: 0o755 });
    const b = reservarFeat(m.b, B);
    assert.ok(fs.existsSync(marca), 'a outra maquina reservou no meio do push');
    assert.equal(b.tentativas, 2);
    assert.equal(b.feat, 'FEAT-006');
    assert.deepEqual(listarReservas(m.a).feats?.map((f) => [f.feat, f.maquina]),
      [['FEAT-004', 'pc-b'], ['FEAT-005', 'pc-a'], ['FEAT-006', 'pc-b']]);
  } finally { m.limpar(); }
});

test('defeito 6 (A6 do CHECK 1): FEAT de branch local ou de PR aberta ja buscada tambem conta', () => {
  const m = duasMaquinas('rm037noite-feat-branches');
  try {
    // Na maquina A, outra thread criou a FEAT-020 a mao, numa branch local ainda sem merge.
    exec('git', ['checkout', '-q', '-b', 'ork/ork-local-full'], m.a);
    commitar(m.a, 'docs/produto/FEAT-020-local.md', '# FEAT-020\n', 'produto: FEAT-020 sem reserva');
    exec('git', ['checkout', '-q', 'main'], m.a);
    assert.equal(maiorFeatConhecida(m.a), 20);
    // Na maquina B, uma PR aberta criou a FEAT-030 pelo metodo antigo; A ja buscou a branch dela.
    exec('git', ['checkout', '-q', '-b', 'ork/ork-pr-aberta-full'], m.b);
    commitar(m.b, 'docs/produto/FEAT-030-da-pr.md', '# FEAT-030\n', 'produto: FEAT-030 sem reserva');
    exec('git', ['push', '-q', 'origin', 'ork/ork-pr-aberta-full'], m.b);
    exec('git', ['fetch', '-q', 'origin'], m.a);
    assert.equal(reservarFeat(m.a, A).feat, 'FEAT-031');
  } finally { m.limpar(); }
});

test('defeito 6: FEAT so na arvore de trabalho tambem conta; sem remoto recusa com motivo tipado', () => {
  const m = duasMaquinas('rm037noite-feat-arvore');
  try {
    fs.writeFileSync(path.join(m.a, 'docs', 'produto', 'FEAT-009-rascunho.md'), '# FEAT-009\n');
    assert.equal(reservarFeat(m.a, A).feat, 'FEAT-010');
    const cli = spawnSync(process.execPath, [CLI, 'roadmap', 'feat', '--thread', 'ork-x', '--json'],
      { cwd: m.b, encoding: 'utf8', env: { ...process.env, ORK_FABRICA_PUBLICAR: '0', ORK_MAQUINA: 'pc-b' } });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).feat, 'FEAT-011');
    exec('git', ['remote', 'set-url', 'origin', path.join(m.a, 'nao-existe')], m.a);
    assert.throws(() => reservarFeat(m.a, A), /^Error: roadmap\.sem-remoto: /);
  } finally { m.limpar(); }
});

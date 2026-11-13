import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { main } from '../src/index';
import { projetoComOrigemAdotavel } from './rm089-f6-forja-simulada';
import { dirThread, gravarThread, lerThread } from '../src/thread';
import { exec } from '../src/util';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { sessaoDespachada } from './noctum-entrega-apoio';

test('CLI adotar publica estado retomável e não duplica a thread', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-cli'), cwd = process.cwd(), log = console.log;
  const saida: string[] = [];
  try {
    process.chdir(p.dir); console.log = (valor: unknown) => { saida.push(String(valor)); };
    const argv = ['adotar', p.origem, '--roadmap', 'RM-089', '--nome', 'Trabalho externo', '--modo', 'auto',
      '--perfil-check', 'revisor'];
    assert.equal(main(argv), 0);
    assert.match(saida.join('\n'), /Adoção preparada.*preparada.*Próximo/s);
    saida.length = 0;
    assert.equal(main(argv), 0);
    assert.match(saida.join('\n'), /Adoção retomada/);
  } finally { console.log = log; process.chdir(cwd); p.limpar(); }
});

test('CLI adotar resolve branch de fork pela URL remota direta', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-cli-url'), cwd = process.cwd(), log = console.log;
  const saida: string[] = [], temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-fork-'));
  const fork = path.join(temp, 'fork.git');
  try {
    assert.equal(exec('git', ['clone', '--bare', p.dir, fork], temp).ok, true);
    assert.equal(exec('git', ['update-ref', '-d', `refs/heads/${p.origem}`], p.dir).ok, true);
    const remoto = pathToFileURL(fork).href;
    process.chdir(p.dir); console.log = (valor: unknown) => { saida.push(String(valor)); };
    assert.equal(main(['adotar', p.origem, '--roadmap', 'RM-089', '--nome', 'Fork direto', '--modo', 'auto',
      '--perfil-check', 'revisor', '--remoto', remoto, '--json']), 0);
    const resultado = JSON.parse(saida.join('\n')) as { thread: { adocao: { remoto: string; sourceHead: string } } };
    assert.equal(resultado.thread.adocao.remoto, remoto);
    assert.equal(resultado.thread.adocao.sourceHead, p.sourceHead);
  } finally { console.log = log; process.chdir(cwd); fs.rmSync(temp, { recursive: true, force: true }); p.limpar(); }
});

test('CLI avança adoção só pelos recibos oficiais no mesmo HEAD', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-estados'), cwd = process.cwd(), log = console.log;
  const saida: string[] = [];
  try {
    const manifesto = path.join(p.dir, 'orkastery.yaml');
    fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8')
      .replace('  context: ork-verify\n', '  context: ork-verify\n  politica_recibo: exigir\n'));
    process.chdir(p.dir); console.log = (valor: unknown) => { saida.push(String(valor)); };
    const argvAdotar = ['adotar', p.origem, '--roadmap', 'RM-089', '--nome', 'Estados públicos', '--modo', 'auto',
      '--perfil-check', 'revisor', '--json'];
    assert.equal(main(argvAdotar), 0);
    const id = (JSON.parse(saida.join('\n')) as { thread: { id: string } }).thread.id;
    const thread = lerThread(p.dir, id), worktree = thread.worktree!;
    assert.equal(thread.adocao?.estado, 'preparada');

    saida.length = 0;
    assert.equal(main(['claims', 'add', id, 'README.md', '--claim', 'a adoção preserva o arquivo da origem',
      '--verificar', 'node --version']), 0);
    saida.length = 0;
    assert.equal(main(['verify', id]), 0);
    assert.equal(lerThread(p.dir, id).adocao?.estado, 'verificada');

    saida.length = 0;
    assert.equal(main(['ci', 'prepare', id]), 0);
    const bundlePath = path.join(worktree, '.ork-ci', `${id}.json`);
    const bundlePreparado = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as { recibo?: { contrato?: string } };
    assert.equal(bundlePreparado.recibo?.contrato, 'ork.ci-projecao-replay/v1');
    fs.copyFileSync(manifesto, path.join(worktree, 'orkastery.yaml'));
    assert.equal(exec('git', ['add', '--', 'orkastery.yaml', `.ork-ci/${id}.json`], worktree).ok, true);
    assert.equal(exec('git', ['commit', '-m', `ci(${id}): bundle da adoção`], worktree).ok, true);
    const head = exec('git', ['rev-parse', 'HEAD'], worktree).stdout.trim();
    registrar(dirThread(p.dir, id), id, 'mcp_git_committed', {
      commit: head, paths: ['orkastery.yaml', `.ork-ci/${id}.json`], origem: 'mcp.git', estadoAuditado: true,
      sessionId: '00000000-0000-4000-8005-000000000000',
    });

    const sessao = sessaoDespachada(p, id, 'CHECK', { runtime: 'claude-bg' });
    const comPerfil = lerThread(p.dir, id);
    Object.assign(comPerfil.sessoes.find((s) => s.sessionId === sessao.sessionId)!, { perfil: { id: 'revisor' } });
    gravarThread(p.dir, comPerfil);
    saida.length = 0;
    assert.equal(main(['verify', id]), 0);
    fs.mkdirSync(path.join(dirThread(p.dir, id), 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dirThread(p.dir, id), 'docs', 'check.md'), '# CHECK\n\nVeredito: PASSOU\n');
    const verify = [...lerLedger(dirThread(p.dir, id))].reverse()
      .find((e) => e.tipo === TIPOS_DE_EVENTO.verificacao)!;
    registrar(dirThread(p.dir, id), id, 'phase_result', {
      fase: 'CHECK', sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm, origem: 'sessions.watch',
      sensorResultId: `claude-bg:${sessao.sessionId}`, classificacao: 'fase_concluida', ok: true,
      provaOrk: { ok: true, fonte: 'docs/check.md', veredito: 'PASSOU',
        verify: { eventId: verify.eventId, commit: head, ts: verify.ts } },
    });
    saida.length = 0;
    assert.equal(main(argvAdotar), 0);
    const retomada = JSON.parse(saida.join('\n')) as { proximoPasso: string };
    assert.equal(lerThread(p.dir, id).adocao?.estado, 'revisada');
    const [binario, entrada, ...argvProximoPasso] = retomada.proximoPasso.split(' ');
    assert.deepEqual([binario, entrada], ['node', 'core/dist/index.js']);

    process.chdir(worktree); saida.length = 0;
    assert.equal(main(argvProximoPasso), 0);
    const runner = JSON.parse(saida.join('\n')) as { thread: string; commit: string; recibo?: { contrato: string; resultado: { ok: boolean } } };
    assert.deepEqual([runner.thread, runner.commit, runner.recibo?.contrato, runner.recibo?.resultado.ok],
      [id, head, 'ork.ci-recibo-runner/v1', true]);
    assert.equal(lerLedger(dirThread(p.dir, id)).some((e) => e.tipo === 'phase_artifact_written' && e.head === head), true);
    assert.equal(lerThread(p.dir, id).adocao?.estado, 'concluida');
  } finally { console.log = log; process.chdir(cwd); p.limpar(); }
});

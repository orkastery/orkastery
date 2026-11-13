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

const AMBIENTE_GITHUB_ACTIONS = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_BASE_REF: 'main',
  GITHUB_HEAD_REF: 'ork/ork-rm089f6orkad-full',
  GITHUB_REPOSITORY: 'orkastery/orkastery',
  GITHUB_REF: 'refs/pull/298/merge',
} as const;

function comAmbienteSemForja<T>(executar: () => T): T {
  const nomes = [...Object.keys(AMBIENTE_GITHUB_ACTIONS), 'GITLAB_CI'];
  const anterior = Object.fromEntries(nomes.map((nome) => [nome, process.env[nome]]));
  Object.assign(process.env, AMBIENTE_GITHUB_ACTIONS);
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'o caso reproduz o ambiente herdado do runner');
    for (const nome of nomes) delete process.env[nome];
    return executar();
  } finally {
    for (const [nome, valor] of Object.entries(anterior)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
}

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

test('CLI adotar recusa credencial em toda a URL sem gravar nem imprimir o valor', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-cli-credencial'), cwd = process.cwd();
  const log = console.log, error = console.error, saida: string[] = [], temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-fork-'));
  const marcador = `github_pat_${'F'.repeat(22)}`, fork = path.join(temp, 'fork.git');
  const contem = (dir: string): boolean => fs.existsSync(dir) && fs.readdirSync(dir, { withFileTypes: true }).some((item) => {
    const arquivo = path.join(dir, item.name);
    return item.isDirectory() ? contem(arquivo) : item.isFile() && fs.readFileSync(arquivo).includes(marcador);
  });
  try {
    assert.equal(exec('git', ['clone', '--bare', p.dir, fork], temp).ok, true);
    const limpa = pathToFileURL(fork).href, caminho = path.join(temp, marcador, 'fork.git');
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    assert.equal(exec('git', ['clone', '--bare', p.dir, caminho], temp).ok, true);
    const remotos = [
      `file://${marcador}@${pathToFileURL(fork).pathname}`,
      pathToFileURL(caminho).href,
      `${limpa}?credencial=${marcador}`,
      `${limpa}#${marcador}`,
    ];
    process.chdir(p.dir);
    console.log = (valor: unknown) => { saida.push(String(valor)); };
    console.error = (valor: unknown) => { saida.push(String(valor)); };
    for (const remoto of remotos) {
      assert.throws(() => main(['adotar', p.origem, '--roadmap', 'RM-089', '--nome', 'Credencial recusada', '--modo', 'auto',
        '--perfil-check', 'revisor', '--remoto', remoto, '--json']), (erro: Error) => {
        assert.equal(erro.message, 'adocao.credencial-na-origem');
        return true;
      });
    }
    assert.equal(saida.join('\n').includes(marcador), false);
    assert.equal(contem(path.join(p.dir, '.orkastery')), false);
  } finally {
    console.log = log; console.error = error; process.chdir(cwd);
    fs.rmSync(temp, { recursive: true, force: true }); p.limpar();
  }
});

test('CLI avança adoção só pelos recibos oficiais no mesmo HEAD com ambiente da forja isolado', () => comAmbienteSemForja(() => {
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
}));

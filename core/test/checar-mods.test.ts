import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// RM-059 (T0.5): a guarda estatica dos mods. Cada item da lista de autoridade (D5 do plano dos mods, com o
// nome que o dono deu) e reprovado num mod de fixture; a ponte real passa; comentario e teste do mod nao
// contam; e a lista real traz tudo que o dono pediu.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/checar-mods.cjs');
const { checarMods, carregarModuloDoMod, versaoAoMenos } = require(SCRIPT);
const PONTE = path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte');
const AUTORIDADE = path.join(raizDoRepo, 'adapters/claude-code/mods/autoridade.json');

type Arquivos = Record<string, string>;

function criarMod(base: string, nome: string, register: string, extras: Arquivos = {}): string {
  const dir = path.join(base, nome);
  const arquivos: Arquivos = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: nome, version: '0.1.0', description: 'fixture', author: { name: 't' } }),
    'orkastery-mod.json': JSON.stringify({ formato: 'ork.mod/v1', papeis: ['dono'], claudeCodeMinimo: '2.1.287' }),
    'hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
    'hooks/register.ts': `import type { Register } from 'claude-code'\nexport const register: Register = on => {\n${register}\n}\n`,
    'test/mod.test.ts': "import { test } from 'claude-code/testing'\ntest('x', async () => {})\n",
    ...extras,
  };
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    if (conteudo === '') continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), conteudo);
  }
  return dir;
}

function comPasta(corpo: (base: string) => void): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-checar-mods-'));
  try { corpo(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

const regrasDe = (dir: string) => checarMods({ pastas: [dir] }).mods[0].achados.map((a: { regra: string }) => a.regra);

test('a ponte real passa, e um mod limpo com argv permitido tambem', () => {
  assert.equal(checarMods({ pastas: [PONTE] }).ok, true);
  comPasta((base) => {
    const dir = criarMod(base, 'ork-limpo', [
      "  // nunca rode git push nem gh: comentario nao conta",
      "  on('turn.complete', async ($, e, next) => {",
      "    await $.process.run(['ork', 'decisao', 'registrar', 'ork-a', '--decidido', 'gate', '--porque', 'answer'])",
      "    await $.process.run(['ork', 'ship', 'registrar-pr', 'ork-a'])",
      "    await $.process.run(['ork', 'retry', 'run', 'ork-a'])",
      "    await $.process.run(['ork', 'master', 'ork-a', '--aceitar-omissao'])",
      "    await $.process.run(['git', 'status', '--porcelain'])",
      "    await $.process.run(['git', 'ls-remote', 'origin'])",
      "    await $.ork.faixa({ mod: 'ork-limpo', texto: 'ork decisao registrar e o caminho' })",
      '    return next(e)',
      '  })',
    ].join('\n'), { 'test/guarda.test.ts': "const proibido = ['git', 'push']\nconst outro = 'gh pr merge 1'\n" });
    assert.deepEqual(regrasDe(dir), []);
  });
});

test('cada item da lista de autoridade e reprovado no fonte de um mod', () => {
  const casos: Array<[string, string, string]> = [
    ['elicita', "  on('classic.Elicitation', ($, e, next) => next(e))", 'elicitation'],
    ['resultado', "  on('classic.ElicitationResult', ($, e, next) => next(e))", 'elicitation-result'],
    ['curinga', "  on('*', ($, e, next) => next(e))", 'elicitation'],
    ['classico', "  on('classic.*', ($, e, next) => next(e))", 'elicitation'],
    ['permissao', "  on('classic.PermissionRequest', ($, e, next) => next(e))", 'permission-request'],
    ['pergunta', "  on('ui.render', { component: 'AskUserQuestion' }, ($, e, next) => next(e))", 'ask-user-question'],
    ['pergunta2', "  on('ui.render', { component: ['ToolUse', 'AskUserQuestion'] }, ($, e, next) => next(e))", 'ask-user-question'],
    ['aprova', "  on('tool.check', async ($, e, next) => ({ decision: 'allow' }))", 'tool-check-allow'],
    ['submete', "  on('turn.complete', async ($, e, next) => { await $.prompt.submit({ text: 'ok', asUser: true }); return next(e) })", 'prompt-submit'],
    ['anexa', "  on('turn.complete', async ($, e, next) => { await $.session.append({ message: { type: 'user', content: [] } }); return next(e) })", 'session-append-usuario'],
    ['gate', "  const argv = ['ork', 'gate', 'answer', 'ork-a', 'p1']", 'gate-answer'],
    ['gate-global', "  const argv = ['ork', '--projeto', 'x', 'gate', 'answer']", 'gate-answer'],
    ['envia', "  const argv = ['git', '-C', '/repo', 'push', 'origin']", 'git-push'],
    ['nota', "  const argv = ['node', 'core/dist/index.js', 'master', 'ork-a', '--score', '5']", 'master-nota'],
    ['propoe', "  const argv = ['ork', 'master', 'propor', 'ork-a', '--score=3']", 'master-nota'],
    ['tag', "  const argv = ['sh', '-c', 'git tag v1 && echo ok']", 'git-tag'],
    ['gh', "  const linha = 'gh pr merge 7 --squash'", 'gh'],
    ['lote', "  const argv = ['ork', 'master', 'batch', '--aceitar', 'x']", 'master-batch'],
    ['retry', "  const argv = ['ork', 'retry', 'run', 'ork-a', '--por', 'mod']", 'retry-run-por'],
    ['ship', "  const argv = ['ork', 'ship', 'ork-a', '--para', 'main', '--autorizar-push', 'mod']", 'ship-autorizar-push'],
    ['pulse', "  const argv = ['npx', 'ork', 'pulse', 'responder', '--resposta-stdin']", 'pulse-responder'],
    ['sessao', "  const argv = ['ork', 'sessions', 'answer', 'ork-a', 'p1', '--stdin']", 'sessions-answer'],
    ['digest', "  const linha = 'ork master digest responder'", 'master-digest-responder'],
    ['hitl', "  on('turn.complete', async ($, e, next) => { await $.env.get('ORK_HITL_TOKEN'); return next(e) })", 'hitl-env'],
    ['hermes', "  const segredo = '/srv/x/.hermes/.env'", 'hermes-env'],
    ['modelo', "  const linha = `git tag ${'v1'}`", 'git-tag'],
    ['reservado', "  on('process.run', ($, e, next) => next(e))", 'processos'],
    ['reservado-fs', "  on('fs.*', ($, e, next) => next(e))", 'arquivos'],
    ['reservado-registro', "  on('plugin.register', ($, e, next) => next(e))", 'registro'],
    ['faixa', "  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => next(e))", 'faixa-da-ponte'],
    ['vigia', "  on('classic.SessionStart', async ($, e, next) => ({ ...(await next(e)), watchPaths: ['/x'] }))", 'watchpaths-da-ponte'],
  ];
  comPasta((base) => {
    for (const [nome, fonte, regra] of casos) {
      const regras = regrasDe(criarMod(base, `ork-${nome}`, fonte));
      assert.ok(regras.includes(regra), `${nome}: esperava ${regra}, achou ${JSON.stringify(regras)}`);
    }
  });
});

test('a ponte precisa registrar os ganchos da guarda, cada um com .catch; apoio de teste nao entra', () => {
  const GUARDA = ['process.run', 'process.spawn', 'plugin.register', 'prompt.submit', 'session.append', 'env.get', 'fs.read'];
  const ganchos = (comCatch: string[]) => GUARDA.map((ev) => (comCatch.includes(ev)
    ? `  on('${ev}', ($, e, next) => next(e)).catch(($, e, next) => next(e))`
    : `  on('${ev}', ($, e, next) => next(e))`)).join('\n');
  comPasta((base) => {
    const inteira = criarMod(path.join(base, 'a'), 'ork-ponte', ganchos(GUARDA), { 'test/apoio.ts': "export const x = 'gh pr merge 1'\n" });
    assert.deepEqual(regrasDe(inteira), []);
    const semDois = criarMod(path.join(base, 'b'), 'ork-ponte', ganchos(GUARDA.filter((ev) => ev !== 'fs.read' && ev !== 'process.spawn')));
    const achado = checarMods({ pastas: [semDois] }).mods[0].achados.find((a: { regra: string }) => a.regra === 'ponte-guarda');
    assert.ok(achado, 'esperava ponte-guarda');
    assert.match(achado.porque, /process\.spawn, fs\.read$/);
    const vazia = criarMod(path.join(base, 'c'), 'ork-ponte', "  on('session.start', ($, e, next) => next(e))");
    assert.ok(regrasDe(vazia).includes('ponte-guarda'));
    const outro = criarMod(path.join(base, 'd'), 'ork-outro', "  on('session.start', ($, e, next) => next(e))", { 'test/apoio.ts': "export const x = 'gh pr merge 1'\n" });
    assert.deepEqual(regrasDe(outro), []);
  });
});

test('texto de tela e palavra solta nao sao linha de comando; argv dentro deles continua conferido (revisao 1)', () => {
  comPasta((base) => {
    const limpo = criarMod(base, 'ork-tela', [
      "  on('turn.complete', async ($, e, next) => {",
      "    $.ui.toast('gh indisponivel agora')",
      "    $.ui.status(`git tag ${'v1'} pendente`)",
      "    await $.ork.faixa({ mod: 'ork-tela', texto: 'git tag pendente na ork-a' })",
      "    const ops = { op: 'set', modo: 'env' }",
      '    return next(e)',
      '  })',
    ].join('\n'));
    assert.deepEqual(regrasDe(limpo), []);
    const aninhado = criarMod(base, 'ork-aninhado', "  on('turn.complete', async ($, e, next) => { $.ui.toast(String(await $.process.run(['sh', '-c', 'gh api']))); return next(e) })");
    assert.ok(regrasDe(aninhado).includes('gh'));
    const caminho = criarMod(base, 'ork-caminho', "  const arquivo = '/srv/x/.hermes/.env'");
    assert.ok(regrasDe(caminho).includes('hermes-env'));
    const despejo = criarMod(base, 'ork-despejo', "  const argv = ['printenv']");
    assert.ok(regrasDe(despejo).includes('hitl-env'));
  });
});

test('linha de sistema no transcript e gancho comum passam', () => {
  comPasta((base) => {
    const dir = criarMod(base, 'ork-aviso', [
      "  on('turn.complete', async ($, e, next) => {",
      "    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: 'aviso' }] } })",
      '    return next(e)',
      '  })',
      "  on('ui.render', { component: 'Pane', requestId: 'torre' }, ($, e, next) => next(e))",
      "  on('tool.check', async ($, e, next) => ({ decision: 'deny', reason: 'fora do plano' }))",
    ].join('\n'));
    assert.deepEqual(regrasDe(dir), []);
  });
});

test('estrutura do mod: manifesto, papel na convencao, hooks e teste', () => {
  comPasta((base) => {
    const papel = (valor: unknown) => ({ 'orkastery-mod.json': JSON.stringify(valor) });
    const casos: Array<[string, Arquivos, string]> = [
      ['nome', { '.claude-plugin/plugin.json': JSON.stringify({ name: 'outro', version: '0.1.0' }) }, 'manifesto-nome'],
      ['chave', { '.claude-plugin/plugin.json': JSON.stringify({ name: 'ork-chave', papeis: ['dono'] }) }, 'manifesto-chave'],
      ['formato', papel({ formato: 'ork.mod/v2', papeis: ['dono'], claudeCodeMinimo: '2.1.287' }), 'papel-formato'],
      ['repetido', papel({ formato: 'ork.mod/v1', papeis: ['dono', 'dono'], claudeCodeMinimo: '2.1.287' }), 'papel-papeis'],
      ['estranho', papel({ formato: 'ork.mod/v1', papeis: ['nuvem'], claudeCodeMinimo: '2.1.287' }), 'papel-papeis'],
      ['antigo', papel({ formato: 'ork.mod/v1', papeis: ['fase'], claudeCodeMinimo: '2.1.200' }), 'papel-minimo'],
      ['extra', papel({ formato: 'ork.mod/v1', papeis: ['fase'], claudeCodeMinimo: '2.1.287', nome: 'x' }), 'papel-chave'],
      ['sem-papel', { 'orkastery-mod.json': '' }, 'papel'],
      ['sem-modulo', { 'hooks/hooks.json': JSON.stringify({ modules: ['./sumiu.ts'] }) }, 'hooks'],
      ['sem-teste', { 'test/mod.test.ts': '' }, 'sem-teste'],
    ];
    for (const [nome, extras, regra] of casos) {
      const regras = regrasDe(criarMod(base, `ork-${nome}`, "  on('session.start', ($, e, next) => next(e))", extras));
      assert.ok(regras.includes(regra), `${nome}: esperava ${regra}, achou ${JSON.stringify(regras)}`);
    }
  });
  assert.equal(versaoAoMenos('2.1.287', [2, 1, 287]), true);
  assert.equal(versaoAoMenos('2.2.0', [2, 1, 287]), true);
  assert.equal(versaoAoMenos('3.0.0', [2, 1, 287]), true);
  assert.equal(versaoAoMenos('2.1.286', [2, 1, 287]), false);
  assert.equal(versaoAoMenos('2.1', [2, 1, 287]), false);
});

test('a lista real traz a D5 inteira, o que o dono acrescentou e a decisao autonoma em permitidos', () => {
  const a = JSON.parse(fs.readFileSync(AUTORIDADE, 'utf8'));
  const ids = (secao: string) => a[secao].map((i: { id: string }) => i.id);
  assert.equal(a.formato, 'ork.mods-autoridade/v1');
  assert.deepEqual(ids('ganchosProibidos'), ['elicitation', 'elicitation-result', 'permission-request', 'ask-user-question']);
  assert.deepEqual(ids('decisoesProibidas'), ['tool-check-allow']);
  assert.deepEqual(ids('chamadasProibidas'), ['prompt-submit', 'session-append-usuario']);
  for (const id of ['gate-answer', 'master-nota', 'master-batch', 'pulse-responder', 'retry-run-por', 'ship-autorizar-push',
    'git-push', 'gh', 'git-tag', 'sessions-answer', 'master-digest-responder']) {
    assert.ok(ids('argvProibido').includes(id), id);
  }
  assert.deepEqual(ids('ambienteProibido'), ['hitl-env']);
  assert.deepEqual(ids('caminhosProibidos'), ['hermes-env']);
  assert.deepEqual(a.permitidos.map((p: { sequencia: string[] }) => p.sequencia), [['decisao', 'registrar']]);
  for (const evento of ['process.*', 'env.*', 'fs.*', 'mcp.*', 'store.*', 'state.*', 'tool.list', 'session.root', 'plugin.register',
    'prompt.submit', 'session.append']) {
    assert.ok(a.reservadosAPonte.some((r: { evento: string }) => r.evento === evento), evento);
  }
});

test('a lista e conferida: formato, secao, id repetido e regra de argv ambigua fecham', () => {
  const guarda = carregarModuloDoMod(path.join(PONTE, 'hooks/guarda.ts'));
  const real = JSON.parse(fs.readFileSync(AUTORIDADE, 'utf8'));
  assert.equal(guarda.validarAutoridade(real).formato, 'ork.mods-autoridade/v1');
  assert.throws(() => guarda.validarAutoridade({ ...real, formato: 'ork.mods-autoridade/v2' }), /formato/);
  assert.throws(() => guarda.validarAutoridade({ ...real, permitidos: undefined }), /sem a secao permitidos/);
  assert.throws(() => guarda.validarAutoridade({ ...real, ambienteProibido: [...real.ambienteProibido, real.ambienteProibido[0]] }), /id repetido/);
  assert.throws(() => guarda.validarAutoridade({ ...real, argvProibido: [{ id: 'x', porque: 'p', sequencia: ['a'], programa: 'b' }] }), /um so/);
  assert.throws(() => guarda.validarAutoridade({ ...real, argvProibido: [{ id: 'x', porque: 'p', sequencia: ['a'], opcao: 'sem-tracos' }] }), /opcao/);
  assert.throws(() => guarda.lerAutoridade('{'), /JSON/);
});

test('CLI: confere os mods do repositorio; achado sai 1; lista invalida e pasta errada saem 2', () => {
  const rodar = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: raizDoRepo, encoding: 'utf8' });
  const real = rodar('--json');
  assert.equal(real.status, 0, real.stdout + real.stderr);
  const j = JSON.parse(real.stdout);
  assert.equal(j.formato, 'ork.checar-mods/v1');
  assert.ok(j.mods.some((m: { mod: string; ok: boolean }) => m.mod === 'ork-ponte' && m.ok));
  comPasta((base) => {
    const ruim = criarMod(base, 'ork-ruim', "  on('classic.Elicitation', ($, e, next) => next(e))");
    const r = rodar(ruim);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /REPROVADO ork-ruim/);
    assert.match(r.stdout, /elicitation: responderia o diálogo nativo/);
    const lista = path.join(base, 'autoridade.json');
    fs.writeFileSync(lista, JSON.stringify({ formato: 'outro' }));
    assert.equal(rodar('--autoridade', lista, PONTE).status, 2);
    assert.equal(rodar(path.join(base, 'nao-existe')).status, 2);
    assert.equal(rodar('--sem-isso').status, 2);
  });
});

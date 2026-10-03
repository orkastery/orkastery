/**
 * RM-047 (fronteira de confiança): os pendentes da seção 6 da matriz depois do #76.
 *
 * - P2 (resto): os ponteiros do recall e do handoff só leem arquivo dentro do projeto;
 * - P3: `worktree.dir` do manifesto não cria checkout fora da raiz sem a confirmação da máquina;
 * - P4: `ork eval` não executa o catálogo achado a partir do cwd;
 * - P5: `fabrica.compartilhada` do manifesto não liga a publicação desta máquina.
 *
 * Este arquivo usa só a API que já existia antes da correção, para que o mesmo teste rode contra o
 * código anterior e reprove nele.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirTemporario } from '../src/sandbox';
import { gravarThread, lerThread, novaThread } from '../src/thread';
import { exportarHandoff, recall } from '../src/handoff';
import { adicionarClaim } from '../src/claims';
import { garantirWorktree } from '../src/worktree';
import { exec } from '../src/util';
import { spawnSync } from 'node:child_process';
import { ProjetoDeTeste } from './apoio';
import { fabricaCompartilhada, gravarConfigDaMaquina, pastaDoUsuario } from '../src/maquina';
import { publicarEmSegundoPlano } from '../src/fabrica-publicar';
import { carregarManifesto } from '../src/manifest';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const ork = (dir: string, ...args: string[]) => {
  const env = { ...process.env };
  delete env.ORK_PROJETO;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env });
};

/** O manifesto do repositório pede a pasta das worktrees em `dir`, como um clone de terceiro poderia pedir. */
function pastaDasWorktrees(p: ProjetoDeTeste, dir: string): void {
  const manifesto = path.join(p.dir, 'orkastery.yaml');
  const texto = fs.readFileSync(manifesto, 'utf8');
  const novo = texto.replace(/^(\s+dir:\s*).*$/m, `$1${JSON.stringify(dir)}`);
  assert.notEqual(novo, texto, 'o manifesto de teste tem worktree.dir');
  fs.writeFileSync(manifesto, novo);
  p.carregado.manifesto.worktree.dir = dir;
}

/** Um arquivo fora do projeto, com um conteúdo que não pode aparecer em nenhuma saída do `ork`. */
function arquivoDeFora(nome: string): { dir: string; arquivo: string; conteudo: string } {
  const dir = dirTemporario(nome);
  const conteudo = `CONTEUDO-DE-FORA-${nome}\n`;
  const arquivo = path.join(dir, 'de-fora.txt');
  fs.writeFileSync(arquivo, conteudo);
  return { dir, arquivo, conteudo };
}

test('P2: o recall de um ponteiro do handoff.json que sai da raiz recusa com ponteiro.fora-da-raiz', () => {
  const p = projetoTemporario('p2-recall-fora');
  const fora = arquivoDeFora('p2-recall-alvo');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 recall', modo: 'auto' }).thread;
    const relativo = path.relative(p.dir, fora.arquivo);
    assert.ok(relativo.startsWith('..'));
    assert.throws(() => recall(p.carregado, t.id, `${relativo}#tudo`), /^Error: ponteiro\.fora-da-raiz: /);
    assert.throws(() => recall(p.carregado, t.id, `${fora.arquivo}#L1`), /^Error: ponteiro\.fora-da-raiz: /);

    // Dentro do projeto, o mesmo recall segue valendo.
    fs.writeFileSync(path.join(p.dir, 'dentro.txt'), 'dentro\n');
    assert.equal(recall(p.carregado, t.id, 'dentro.txt#tudo').conteudo, 'dentro\n');
  } finally { p.limpar(); fs.rmSync(fora.dir, { recursive: true, force: true }); }
});

test('P2: link simbólico dentro do projeto não leva o recall para fora da raiz', () => {
  const p = projetoTemporario('p2-recall-link');
  const fora = arquivoDeFora('p2-recall-link-alvo');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 recall link', modo: 'auto' }).thread;
    fs.symlinkSync(fora.dir, path.join(p.dir, 'docs-link'));
    assert.throws(() => recall(p.carregado, t.id, 'docs-link/de-fora.txt#tudo'), /^Error: ponteiro\.fora-da-raiz: /);
  } finally { p.limpar(); fs.rmSync(fora.dir, { recursive: true, force: true }); }
});

test('P2: o export do handoff não aponta para arquivo de claim nem prompt fora da raiz', () => {
  const p = projetoTemporario('p2-export-fora');
  const fora = arquivoDeFora('p2-export-alvo');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 export', modo: 'auto' }).thread;
    adicionarClaim(p.dir, t.id, { arquivo: fora.arquivo, alegacao: 'arquivo de fora', verificar: ['true'] });
    adicionarClaim(p.dir, t.id, { arquivo: path.relative(p.dir, fora.arquivo), alegacao: 'relativo de fora', verificar: ['true'] });
    fs.writeFileSync(path.join(p.dir, 'dentro.md'), 'dentro\n');
    adicionarClaim(p.dir, t.id, { arquivo: 'dentro.md', alegacao: 'arquivo de dentro', verificar: ['true'] });
    const thread = lerThread(p.dir, t.id);
    thread.sessoes.push({ ...(thread.sessoes[0] ?? {}), slug: 'sessao-de-fora', fase: 'GOAL', origem: 'despacho',
      promptPath: path.relative(p.dir, fora.arquivo) } as unknown as typeof thread.sessoes[number]);
    gravarThread(p.dir, thread);

    const { handoff, caminho } = exportarHandoff(p.carregado, t.id);
    const locais = handoff.pointers.map(x => x.location);
    assert.ok(locais.includes('dentro.md#tudo'), locais.join(', '));
    assert.ok(!locais.some(l => l.includes('de-fora.txt')), `nenhum ponteiro sai da raiz: ${locais.join(', ')}`);
    // O texto da claim segue inline (é a alegação), mas nenhum arquivo de fora foi lido para virar ponteiro.
    assert.ok(!handoff.pointers.some(x => x.source.includes(path.basename(fora.dir))), 'nenhuma proveniência sai da raiz');
    assert.ok(fs.existsSync(caminho));
  } finally { p.limpar(); fs.rmSync(fora.dir, { recursive: true, force: true }); }
});


test('P3: worktree.dir do manifesto fora da raiz não cria checkout sem a confirmação local', () => {
  const p = projetoTemporario('p3-dir-fora');
  const fora = dirTemporario('p3-dir-fora-alvo');
  try {
    for (const dir of [path.relative(p.dir, fora), fora]) {
      pastaDasWorktrees(p, dir);
      const t = novaThread(p.carregado, { nome: `p3 ${dir.length}`, modo: 'auto' }).thread;
      assert.throws(() => garantirWorktree(p.carregado, t.id), /^Error: worktree\.dir-fora-da-raiz: .*ork setup worktree confirmar/);
      assert.deepEqual(fs.readdirSync(fora), [], 'nada foi criado fora da raiz');
    }
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('P3: um link no caminho de worktree.dir não leva o checkout para fora da raiz', () => {
  const p = projetoTemporario('p3-dir-link');
  const fora = dirTemporario('p3-dir-link-alvo');
  try {
    fs.symlinkSync(fora, path.join(p.dir, 'pasta-link'));
    pastaDasWorktrees(p, 'pasta-link/worktrees');
    const t = novaThread(p.carregado, { nome: 'p3 link', modo: 'auto' }).thread;
    assert.throws(() => garantirWorktree(p.carregado, t.id), /^Error: worktree\.dir-fora-da-raiz: /);
    assert.deepEqual(fs.readdirSync(fora), []);
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('P3: a confirmação local libera a pasta de fora nesta máquina; versionada no git ou revogada, não vale', () => {
  const p = projetoTemporario('p3-dir-confirmada');
  const fora = dirTemporario('p3-dir-confirmada-alvo');
  try {
    pastaDasWorktrees(p, fora);
    const conf = ork(p.dir, 'setup', 'worktree', 'confirmar', fora, '--por', 'teste');
    assert.equal(conf.status, 0, conf.stderr + conf.stdout);
    const arquivo = path.join(p.dir, '.orkastery', 'private', 'worktree-local.json');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    const t = novaThread(p.carregado, { nome: 'p3 confirmada', modo: 'auto' }).thread;
    const w = garantirWorktree(p.carregado, t.id);
    assert.equal(w.ok, true, w.detalhe);
    assert.equal(fs.realpathSync(path.dirname(w.dir)), fs.realpathSync(fora));

    // A mesma confirmação, vinda no índice do git, é estado do repositório e não da máquina.
    const r = exec('git', ['add', '-f', '--', '.orkastery/private/worktree-local.json'], p.dir);
    assert.equal(r.ok, true, r.stderr);
    const t2 = novaThread(p.carregado, { nome: 'p3 versionada', modo: 'auto' }).thread;
    assert.throws(() => garantirWorktree(p.carregado, t2.id), /^Error: worktree\.dir-fora-da-raiz: .*versionado no git/);
    exec('git', ['rm', '-q', '--cached', '--', '.orkastery/private/worktree-local.json'], p.dir);
    assert.equal(ork(p.dir, 'setup', 'worktree', 'revogar').status, 0);
    assert.throws(() => garantirWorktree(p.carregado, t2.id), /^Error: worktree\.dir-fora-da-raiz: /);
    const s = ork(p.dir, 'setup', 'worktree', '--json');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(JSON.parse(s.stdout).criacao, 'recusada');
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('P4: ork eval não executa o catálogo achado a partir do cwd quando ele não é o do pacote', () => {
  const alheio = dirTemporario('p4-catalogo-alheio');
  const marca = path.join(alheio, 'executou');
  try {
    for (const d of ['skills', 'references', path.join('eval', 'casos'), path.join('eval', 'fixtures'), path.join('core', 'dist')]) {
      fs.mkdirSync(path.join(alheio, d), { recursive: true });
    }
    fs.writeFileSync(path.join(alheio, 'core', 'dist', 'index.js'),
      `require('fs').writeFileSync(${JSON.stringify(marca)}, 'x');\n`);
    const r = ork(alheio, 'eval', '--json');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /eval\.catalogo-alheio: /, r.stderr + r.stdout);
    assert.ok(!r.stdout.includes(alheio), 'o eval não leu o catálogo alheio');
    assert.equal(fs.existsSync(marca), false, 'nada do catálogo alheio rodou');
  } finally { fs.rmSync(alheio, { recursive: true, force: true }); }
});

test('P5: fabrica.compartilhada do manifesto não liga a publicação desta máquina; ork fabrica entrar liga', () => {
  const p = projetoTemporario('p5-fabrica', true);
  const antes = { publicar: process.env.ORK_FABRICA_PUBLICAR, comp: process.env.ORK_FABRICA_COMPARTILHADA };
  const maquina = path.join(pastaDoUsuario(), 'maquina.json');
  try {
    delete process.env.ORK_FABRICA_COMPARTILHADA;
    fs.rmSync(maquina, { force: true });
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nfabrica:\n  compartilhada: true\n');
    const pedido = carregarManifesto(p.dir)!;
    assert.equal(pedido.manifesto.fabrica.compartilhada, true, 'o manifesto do clone pede a fábrica');
    assert.equal(fabricaCompartilhada(pedido.manifesto), false, 'o manifesto sozinho não liga a fábrica desta máquina');
    delete process.env.ORK_FABRICA_PUBLICAR;
    assert.equal(publicarEmSegundoPlano(p.dir), false, 'nada sai em segundo plano só pelo manifesto');

    // A máquina que entrou publica, com ou sem o pedido do manifesto.
    process.env.ORK_FABRICA_PUBLICAR = '0';
    gravarConfigDaMaquina({ fabricaCompartilhada: true });
    assert.equal(fabricaCompartilhada(pedido.manifesto), true);
    assert.equal(fabricaCompartilhada({ fabrica: { compartilhada: false } }), true);
  } finally {
    fs.rmSync(maquina, { force: true });
    if (antes.publicar === undefined) delete process.env.ORK_FABRICA_PUBLICAR; else process.env.ORK_FABRICA_PUBLICAR = antes.publicar;
    if (antes.comp === undefined) delete process.env.ORK_FABRICA_COMPARTILHADA; else process.env.ORK_FABRICA_COMPARTILHADA = antes.comp;
    p.limpar();
  }
});

/**
 * RM-047 (B2): o remoto da branch de estado so chega ao git como nome de remoto.
 *
 * O `fabrica.remoto` vem do `orkastery.yaml`, versionado por quem fez o repositorio, e o `--remoto`
 * vem da linha de comando. Um valor que comece com `-` virava opcao do `git fetch` e do `git push`,
 * e uma URL escolhia o transporte. Cada caso aqui usa uma marca no disco: o comando que o valor
 * tentaria rodar cria a marca, e ela nunca pode existir. No codigo anterior, estes testes reprovam
 * (a marca nasce, ou o comando nao recusa).
 *
 * Tudo e git de verdade, com remotos bare temporarios; nenhum teste toca o remoto do Orkastery.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buscarBranch, exigirRemoto, gravarNaBranch, remotoValido } from '../src/branch-de-estado';
import { publicarMaquina, removerMaquina } from '../src/fabrica-estado';
import { exigirManifesto } from '../src/manifest';
import { remotoDoProjeto } from '../src/projeto-alvo';
import { listarReservas, pegarItem } from '../src/roadmap-reservas';
import { exec } from '../src/util';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function ork(dir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
}

/** Projeto com remoto bare, um item no roadmap e uma pasta para a marca e para o usuario. */
function cenario(nome: string) {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir);
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  const fora = dirTemporario(`${nome}-fora`);
  const marca = path.join(fora, 'executou');
  const env = { ORK_USUARIO_DIR: path.join(fora, 'usuario'), ORK_MAQUINA: 'pc-teste', ORK_FABRICA_PUBLICAR: '0' };
  return {
    ...p, marca, env,
    /** Troca o `fabrica.remoto` do manifesto (o init nao grava a secao). */
    manifestoCom(remoto: string) {
      fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), `\nfabrica:\n  remoto: ${JSON.stringify(remoto)}\n`);
    },
    limparTudo() { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); },
  };
}

/** Valores que nunca podem chegar ao git. `M` e o caminho da marca. */
const maliciosos = (M: string): string[] => [
  `--upload-pack=touch ${M}`,
  `--receive-pack=touch ${M}`,
  '-c',
  `ext::sh -c touch% ${M}`,
  'file:///tmp/qualquer',
  'https://usuario:segredo@example.com/repo.git',
  'origin\nmais',
  'origin\u0007',
  'a..b',
  'origin.',
  '',
];

const RECUSA = (prefixo: string) =>
  new RegExp(`^${prefixo}\\.remoto-invalido: o remoto .* não é nome de remoto do git .*nada foi passado ao git\\. ` +
    'Corrija fabrica\\.remoto no orkastery\\.yaml ou --remoto \\(padrão: origin\\)\\.$', 's');

test('remoto: aceita origin, upstream e meu-remoto.2; recusa opção, transporte, URL e controle', () => {
  for (const ok of ['origin', 'upstream', 'meu-remoto.2', 'Fork_1']) {
    assert.equal(remotoValido(ok), true, ok);
    assert.equal(exigirRemoto(ok, 'fabrica'), ok);
  }
  for (const ruim of [...maliciosos('/tmp/m'), 42, null, undefined]) {
    assert.equal(remotoValido(ruim), false, JSON.stringify(ruim));
    assert.throws(() => exigirRemoto(ruim, 'fabrica'), (e: Error) => RECUSA('fabrica').test(e.message), JSON.stringify(ruim));
  }
});

test('remoto: a mensagem redige credencial e caractere de controle e fica curta', () => {
  const msg = (v: string) => { try { exigirRemoto(v, 'roadmap'); return ''; } catch (e) { return (e as Error).message; } };
  const comCredencial = msg('https://usuario:segredo@example.com/repo.git');
  assert.ok(!comCredencial.includes('segredo') && !comCredencial.includes('usuario:'), comCredencial);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(msg('origin\nmais\u0007')), 'controle escapado');
  assert.ok(msg('-'.repeat(500)).length < 400, 'valor longo truncado');
});

test('remoto: buscarBranch e gravarNaBranch recusam antes do git e a marca nao nasce', () => {
  const c = cenario('remoto-branch');
  try {
    for (const ruim of maliciosos(c.marca)) {
      assert.throws(() => buscarBranch(c.dir, ruim, 'ork/fabrica-estado', 'fabrica', 15000),
        (e: Error) => RECUSA('fabrica').test(e.message), JSON.stringify(ruim));
      assert.throws(() => gravarNaBranch(c.dir, ruim, 'ork/roadmap-reservas', null,
        [{ caminho: 'x.json', conteudo: '{}\n' }], 'teste', 'roadmap'),
      (e: Error) => RECUSA('roadmap').test(e.message), JSON.stringify(ruim));
    }
    assert.equal(fs.existsSync(c.marca), false, 'nenhum valor virou comando');
    assert.equal(remotoDoProjeto(c.dir, `--upload-pack=touch ${c.marca}`), null);
  } finally { c.limparTudo(); }
});

test('remoto: ork fabrica, publicar, entrar e sair recusam o fabrica.remoto do manifesto com motivo tipado', () => {
  const c = cenario('remoto-fabrica-cli');
  try {
    c.manifestoCom(`--upload-pack=touch ${c.marca}`);
    for (const args of [['fabrica'], ['fabrica', '--json'], ['fabrica', 'publicar', '--forcar'], ['fabrica', 'entrar'], ['fabrica', 'sair']]) {
      const r = ork(c.dir, args, c.env);
      assert.notEqual(r.status, 0, `${args.join(' ')}: ${r.stdout}`);
      assert.match(r.stderr, /^erro: fabrica\.remoto-invalido: o remoto "--upload-pack=touch .*" não é nome de remoto do git/m, args.join(' '));
      assert.equal(fs.existsSync(c.marca), false, `${args.join(' ')} nao executou nada`);
    }
    // `entrar` recusou antes de gravar a adesao da maquina.
    assert.equal(fs.existsSync(path.join(c.env.ORK_USUARIO_DIR, 'maquina.json')), false);
    // A API recusa do mesmo jeito, com o manifesto relido.
    const carregado = exigirManifesto(c.dir);
    assert.throws(() => publicarMaquina(carregado, { maquina: 'pc-teste' }), (e: Error) => RECUSA('fabrica').test(e.message));
    assert.throws(() => removerMaquina(carregado, { maquina: 'pc-teste' }), (e: Error) => RECUSA('fabrica').test(e.message));
    assert.equal(fs.existsSync(c.marca), false);
  } finally { c.limparTudo(); }
});

test('remoto: ork fabrica publicar --silencioso deixa a recusa no log, sem executar nada', () => {
  const c = cenario('remoto-fabrica-silencioso');
  try {
    c.manifestoCom(`ext::sh -c touch% ${c.marca}`);
    const r = ork(c.dir, ['fabrica', 'publicar', '--silencioso', '--forcar'], c.env);
    assert.equal(r.status, 1);
    assert.equal(r.stdout + r.stderr, '');
    const log = fs.readFileSync(path.join(c.dir, '.orkastery', 'monitor', 'fabrica.log'), 'utf8');
    assert.match(log, /"acao":"falhou".*fabrica\.remoto-invalido/);
    assert.equal(fs.existsSync(c.marca), false);
  } finally { c.limparTudo(); }
});

test('remoto: ork roadmap reservas, pegar e soltar recusam --remoto que nao e nome de remoto', () => {
  const c = cenario('remoto-reservas-cli');
  try {
    for (const ruim of [`--upload-pack=touch ${c.marca}`, `ext::sh -c touch% ${c.marca}`]) {
      for (const args of [['roadmap', 'reservas'], ['roadmap', 'pegar', 'RM-001'], ['roadmap', 'soltar', 'RM-001'], ['roadmap', 'feat']]) {
        const r = ork(c.dir, [...args, `--remoto=${ruim}`], c.env);
        assert.notEqual(r.status, 0, `${args.join(' ')}: ${r.stdout}`);
        assert.match(r.stderr, /^erro: roadmap\.remoto-invalido: o remoto ".*" não é nome de remoto do git/m, `${args.join(' ')} ${ruim}`);
      }
    }
    assert.throws(() => listarReservas(c.dir, { remoto: `--upload-pack=touch ${c.marca}` }), (e: Error) => RECUSA('roadmap').test(e.message));
    assert.throws(() => pegarItem(c.dir, 'RM-001', { remoto: `--upload-pack=touch ${c.marca}`, maquina: 'pc-teste' }),
      (e: Error) => RECUSA('roadmap').test(e.message));
    assert.equal(fs.existsSync(c.marca), false, 'nenhum valor virou comando');
  } finally { c.limparTudo(); }
});

test('remoto: nomes legitimos seguem funcionando (upstream no manifesto, meu-remoto.2 no --remoto)', () => {
  const c = cenario('remoto-legitimo');
  try {
    exec('git', ['remote', 'add', 'upstream', c.remoto as string], c.dir);
    exec('git', ['remote', 'add', 'meu-remoto.2', c.remoto as string], c.dir);
    c.manifestoCom('upstream');
    const pub = ork(c.dir, ['fabrica', 'publicar', '--forcar'], c.env);
    assert.equal(pub.status, 0, pub.stderr);
    assert.match(pub.stdout, /publicou/);
    const lista = ork(c.dir, ['fabrica', '--json'], c.env);
    assert.equal(lista.status, 0, lista.stderr);
    const pega = ork(c.dir, ['roadmap', 'pegar', 'RM-001', '--remoto', 'meu-remoto.2'], c.env);
    assert.equal(pega.status, 0, pega.stderr);
    const painel = listarReservas(c.dir, { remoto: 'meu-remoto.2' });
    assert.equal(painel.atualizado, true);
    assert.deepEqual(painel.reservas.map((r) => r.item), ['RM-001']);
  } finally { c.limparTudo(); }
});

/** Testes de `ork init`: manifesto gerado precisa ser valido e recarregavel. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ORDEM_DOS_MODOS } from '../src/modos';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { init, manifestoYaml } from '../src/init';
import { carregarManifesto, LIMITE_MANIFESTO_BYTES, NOME_MANIFESTO } from '../src/manifest';
import { lerYaml } from '../src/yaml';
import { exec } from '../src/util';

/** Cria um repositorio git temporario com um commit, para o init detectar base real. */
function repoTemporario(nome: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ork-test-${nome}-`));
  exec('git', ['init', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# projeto de teste\n');
  exec('git', ['add', '-A'], dir);
  exec('git', ['commit', '-m', 'inicial'], dir);
  return fs.realpathSync(dir);
}

test('init gera manifesto valido e recarregavel pelo `ork`', () => {
  const dir = repoTemporario('init');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'exemplo', scripts: { build: 'tsc', test: 'node --test' } }, null, 2)
  );

  const r = init(dir, { nome: 'orkastery', abbrev: 'ork' });
  assert.equal(r.criado, true);
  assert.equal(r.caminho, path.join(dir, NOME_MANIFESTO));
  assert.ok(fs.existsSync(r.caminho));
  assert.ok(fs.existsSync(path.join(dir, '.orkastery', 'threads')));

  const carregado = carregarManifesto(dir);
  assert.ok(carregado);
  assert.deepEqual(carregado.erros, []);
  assert.equal(carregado.manifesto.project.name, 'orkastery');
  assert.equal(carregado.manifesto.project.abbrev, 'ork');
  assert.equal(carregado.manifesto.project.stage, 'nascente');
  assert.equal(carregado.manifesto.board.default, 'default');
  assert.equal(carregado.manifesto.runtime.adapter, 'claude-bg');
  assert.equal(carregado.manifesto.runtime.provider_policy, 'subscription-only');
  // O padrao de despacho e `opus`, e o padrao de conducao e `#Classic` (3 pausas).
  assert.equal(carregado.manifesto.runtime.model, 'opus');
  assert.equal(carregado.manifesto.runtime.effort, 'high');
  assert.equal(carregado.manifesto.conduction.default_mode, 'classic');
  // I-43: o manifesto novo nasce so com os modos VIVOS, derivados da lista.
  assert.deepEqual(carregado.manifesto.conduction.allowed_modes, [...ORDEM_DOS_MODOS]);
  assert.equal(carregado.manifesto.worktree.base_branch, 'main');
  assert.equal(carregado.manifesto.verify.build, 'npm run build');
  assert.equal(carregado.manifesto.verify.test, 'npm test');
  assert.equal(carregado.manifesto.handoff.rotate_above, 0.7);
  assert.equal(carregado.manifesto.handoff.force_rotate_above, 0.85);
  assert.equal(carregado.manifesto.memory.mode, 'files');
  assert.ok(carregado.bytes < LIMITE_MANIFESTO_BYTES);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('init nao sobrescreve manifesto existente sem --force', () => {
  const dir = repoTemporario('noforce');
  const primeiro = init(dir, { nome: 'orkastery', abbrev: 'ork' });
  assert.equal(primeiro.criado, true);
  fs.appendFileSync(primeiro.caminho, '\n# marca do builder\n');

  const segundo = init(dir, { nome: 'outro', abbrev: 'out' });
  assert.equal(segundo.criado, false);
  assert.ok(fs.readFileSync(primeiro.caminho, 'utf8').includes('# marca do builder'));

  const forcado = init(dir, { nome: 'outro', abbrev: 'out', force: true });
  assert.equal(forcado.criado, true);
  assert.equal(fs.readFileSync(primeiro.caminho, 'utf8').includes('# marca do builder'), false);
  assert.equal(carregarManifesto(dir)?.manifesto.project.abbrev, 'out');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('manifesto invalido e reprovado com erro acionavel, sem lancar excecao', () => {
  const dir = repoTemporario('invalido');
  fs.writeFileSync(
    path.join(dir, NOME_MANIFESTO),
    ['project:', '  name: "x"', '  abbrev: "quatro"', 'conduction:', '  default_mode: turbo', ''].join('\n')
  );
  const carregado = carregarManifesto(dir);
  assert.ok(carregado);
  assert.ok(carregado.erros.some((e) => e.includes('abbrev')));
  assert.ok(carregado.erros.some((e) => e.includes('default_mode')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('o YAML gerado e lido pelo parser do proprio nucleo', () => {
  const yaml = manifestoYaml({
    raiz: '/tmp/x',
    nome: 'orkastery',
    abbrev: 'ork',
    baseBranch: 'main',
    gerenciador: 'npm',
    verify: { test: 'npm test' },
  });
  const dados = lerYaml(yaml) as Record<string, Record<string, unknown>>;
  assert.equal(dados.project.name, 'orkastery');
  assert.equal(dados.runtime.adapter, 'claude-bg');
  assert.deepEqual(dados.conduction.allowed_modes, [...ORDEM_DOS_MODOS]);
  assert.equal(dados.handoff.rotate_above, 0.7);
  assert.equal(dados.verify.test, 'npm test');
  // Chave nao detectada vira comentario, entao nao aparece no parse.
  assert.equal(dados.verify.build, undefined);
});

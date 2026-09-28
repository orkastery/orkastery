import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { instalarAdaptador } from '../src/hosts';
import { exigirCatalogo } from '../src/catalogo';
import { dirTemporario, semAutoridadeHitlNoAmbiente } from './apoio';

// I-35 (GO-FIX 1): com autoridade HITL no ambiente o adaptador OpenClaw falha fechado
// contra o `ork` de fixture; este arquivo exercita o caminho comum, sem credencial.
semAutoridadeHitlNoAmbiente();

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));

test('instalação Hermes e Claude Code transporta a rota onboarding com pauta do CLI', () => {
  const destino = dirTemporario('onboarding-adapters');
  try {
    for (const host of ['hermes', 'claude-code'] as const) {
      const r = instalarAdaptador(host, { projeto: destino, catalogo: RAIZ, orkBin: '/fixture/ork' });
      assert.ok(r.ok);
      const file = host === 'hermes' ? path.join(destino, '.hermes/skills/orkastery-devmaster/SKILL.md') :
        path.join(r.destino, 'commands/onboarding.md');
      const text = fs.readFileSync(file, 'utf8');
      for (const cmd of ['ork onboarding', 'ork onboarding show --json', 'ork onboarding set', 'ork onboarding reset', 'ork onboarding sync --json']) {
        assert.ok(text.includes(cmd), `${host}: rota ${cmd} não instalada`);
      }
      assert.ok(text.includes('~/.hermes/.env'));
      assert.ok(text.includes('pauta') && text.includes('núcleo'));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(RAIZ, 'adapters/hermes/hermes.plugin.json'), 'utf8'));
    assert.equal(manifest.onboarding.pauta, 'ork onboarding');
  } finally { fs.rmSync(destino, { recursive: true, force: true }); }
});

test('OpenClaw instalado executa show/set/reset/sync por argv e preserva erro do CLI', () => {
  const destino = dirTemporario('onboarding-openclaw');
  try {
    const bin = path.join(destino, 'ork-fixture');
    fs.writeFileSync(bin, '#!' + process.execPath + '\nconsole.log(JSON.stringify(process.argv.slice(2)));\nif(process.argv.includes("falhar")){console.error("diagnostico-fixture");process.exitCode=7;}\n', { mode: 0o755 });
    const instalado = instalarAdaptador('openclaw', { projeto: destino, catalogo: RAIZ, orkBin: bin });
    assert.ok(instalado.ok);
    const sdk = path.join(instalado.destino, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './stub.js' } }));
    fs.writeFileSync(path.join(sdk, 'stub.js'), 'export const defineToolPlugin = x => x;');
    // O SDK falso só registra ferramentas; o entry e o transporte execFile são os instalados.
    const script = path.join(instalado.destino, 'exercise.mjs');
    fs.writeFileSync(script, `import plugin from './dist/index.js';
const tools = plugin.tools(x => x);
const t = tools.find(x => x.name === 'ork_onboarding');
const input = JSON.parse(process.argv[2]);
console.log(JSON.stringify({names: tools.map(x => x.name), output: await t.execute(input, {}, {})}));`);
    const exec = (p: Record<string, string>) => {
      const r = spawnSync(process.execPath, [script, JSON.stringify(p)], { cwd: destino, encoding: 'utf8', timeout: 10000 });
      assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
    };
    const sentinel = path.join(destino, 'NUNCA_CRIAR');
    const conteudo = JSON.stringify({ texto: `aspas ' \" ; $(touch ${sentinel}) \`touch ${sentinel}\`\ntexto` });
    for (const [params, esperado] of [
      [{ acao: 'show' }, ['onboarding', 'show', '--json']],
      [{ acao: 'set', etapa: 'maestro', conteudo, por: 'equipe' }, ['onboarding', 'set', 'maestro', '--conteudo', conteudo, '--por', 'equipe', '--json']],
      [{ acao: 'reset', etapa: 'skills' }, ['onboarding', 'reset', 'skills', '--json']],
      [{ acao: 'reset' }, ['onboarding', 'reset', '--json']],
      [{ acao: 'sync' }, ['onboarding', 'sync', '--json']],
    ] as [Record<string, string>, string[]][]) {
      const r = exec(params);
      assert.deepEqual(JSON.parse(r.output), esperado);
      const manifest = JSON.parse(fs.readFileSync(path.join(instalado.destino, 'openclaw.plugin.json'), 'utf8'));
      assert.deepEqual(r.names.sort(), manifest.contracts.tools.sort());
    }
    assert.equal(fs.existsSync(sentinel), false, 'metacaracteres permaneceram dados');
    const failed = exec({ acao: 'show', por: 'falhar' }).output;
    assert.match(failed, /ork saiu com 7/);
    assert.match(failed, /diagnostico-fixture/);
    assert.ok(failed.includes('["onboarding","show"'));
  } finally { fs.rmSync(destino, { recursive: true, force: true }); }
});

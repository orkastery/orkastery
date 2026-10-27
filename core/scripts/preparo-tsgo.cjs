#!/usr/bin/env node
/**
 * RM-072 (D14 da ork-check5x): o preparo do Agile Check deste projeto, com o `tsgo` (o TypeScript 7 nativo, pacote
 * `@typescript/native-preview`) quando a arvore esta fria.
 *
 *   node scripts/preparo-tsgo.cjs
 *
 * Com o build incremental do `tsc` presente (`dist/.tsbuildinfo` e `dist-test/.tsbuildinfo`), roda o preparo do Classic
 * (`npm run build` e `npm run build:test`): sem mudanca ele leva menos de um segundo, e o `tsgo` emitiria tudo de novo e
 * apagaria o estado incremental. Sem ele (a worktree nova, a copia descartavel), o `tsgo` emite `dist` e `dist-test` ao
 * mesmo tempo, com o typecheck completo, e apaga o `.tsbuildinfo` que sobrar: o proximo `tsc --build` nao acha o emit do
 * `tsgo` em dia e emite do zero. O contrato de paridade (`tsgo-paridade.cjs`) prova o mesmo typecheck e o mesmo
 * JavaScript token a token. A peca `tsgo` vai ao relatorio da rodada (`ORK_CHECK_RELATORIO`): `agile` quando o `tsgo`
 * emitiu, `fallback` com o motivo quando rodou o `tsc`.
 *
 * Sem o `tsgo` instalado na arvore fria, sai 127 (o verify cai para o `verify.preparo` e registra a peca `preparo`); com
 * erro de tipo, sai com o codigo do compilador, e o verify tambem cai para o `verify.preparo`, que da o veredito do
 * Classic. `ORK_TSGO_CORE` troca a pasta do core (os testes usam uma arvore pequena).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const CORE = path.resolve(process.env.ORK_TSGO_CORE || path.join(__dirname, '..'));
const TSGO = path.join(CORE, 'node_modules', '@typescript', 'native-preview', 'bin', 'tsgo');
const ESTADO_DO_TSC = ['dist/.tsbuildinfo', 'dist-test/.tsbuildinfo'];
const PROJETOS_DO_TSGO = ['tsconfig.tsgo.json', 'tsconfig.tsgo.test.json'];
const PREPARO_DO_CLASSIC = ['build', 'build:test'];

/** Uma linha no relatorio da rodada, quando o verify passou um. */
function relatar(linha) {
  const arquivo = process.env.ORK_CHECK_RELATORIO;
  if (!arquivo) return;
  try { fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n'); } catch { /* o relatorio e evidencia, nao veredito */ }
}

function emitirComTsgo(projeto) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [TSGO, '-p', projeto], { cwd: CORE, stdio: 'inherit' });
    p.on('error', () => resolve(1));
    p.on('close', (code) => resolve(code ?? 1));
  });
}

/** O preparo do Classic, script por script, como o `verify.preparo` o encadeia. */
function preparoDoClassic() {
  for (const script of PREPARO_DO_CLASSIC) {
    const r = spawnSync('npm', ['run', script], { cwd: CORE, stdio: 'inherit' });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}

async function principal() {
  if (ESTADO_DO_TSC.every((f) => fs.existsSync(path.join(CORE, f)))) {
    const code = preparoDoClassic();
    if (code === 0) {
      relatar({ tipo: 'peca', peca: 'tsgo', estado: 'fallback', motivo: 'build incremental do tsc presente (o tsgo emitiria tudo de novo)',
        fallback: PREPARO_DO_CLASSIC.map((s) => `npm run ${s}`).join(' && ') });
    }
    return code;
  }
  if (!fs.existsSync(TSGO)) {
    process.stderr.write('preparo-tsgo: o tsgo (@typescript/native-preview) nao esta instalado no core\n');
    return 127;
  }
  const codigos = await Promise.all(PROJETOS_DO_TSGO.map(emitirComTsgo));
  for (const f of ESTADO_DO_TSC) fs.rmSync(path.join(CORE, f), { force: true });
  const falhou = codigos.find((c) => c !== 0);
  if (falhou !== undefined) return falhou;
  fs.chmodSync(path.join(CORE, 'dist', 'index.js'), 0o755);
  relatar({ tipo: 'peca', peca: 'tsgo', estado: 'agile' });
  return 0;
}

if (require.main === module) principal().then((c) => process.exit(c));

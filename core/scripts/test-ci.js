#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// I-53 (D17): a lista unica mora em src/integracoes-locais.ts, que o `test:ci` compila antes
// deste script. Integracoes exigem recursos deliberadamente ausentes no GitHub Hosted Runner; a
// lista e exata: arquivo novo entra no CI automaticamente e nome removido reprova.
const { TESTES_DE_INTEGRACAO_LOCAL: LOCAL_INTEGRATION } = require('../dist/integracoes-locais.js');

const dir = path.resolve(__dirname, '../dist-test/test');
const found = fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort();
for (const name of LOCAL_INTEGRATION) {
  if (!found.includes(name)) throw new Error(`exclusão de CI obsoleta: ${name}`);
}
const hermetic = found.filter((name) => !LOCAL_INTEGRATION.has(name)).map((name) => path.join(dir, name));
if (hermetic.length < 100) throw new Error(`suíte hermética pequena demais: ${hermetic.length} arquivos`);
process.stderr.write(`CI hermético: ${hermetic.length} arquivos; ${LOCAL_INTEGRATION.size} integrações locais explicitamente separadas\n`);
const result = spawnSync(process.execPath, ['--test', ...hermetic], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);

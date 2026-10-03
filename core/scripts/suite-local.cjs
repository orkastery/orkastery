#!/usr/bin/env node
// RM-037: roda a suite local inteira (`npm test` do nucleo) e conta, pelo relatorio do `node --test`,
// as falhas e os skips. Sai 0 so com 0 falhas e o relatorio lido; cada skip sai listado com o motivo.
// `--minimo-de-skips N` reprova se a maquina pulou menos que N (prova de que a falta foi vista).
// Fica para a estacao no CHECK independente (ci.ts): o runner hospedado roda o `test:ci`.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
let minimo = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--minimo-de-skips' && /^\d+$/.test(args[i + 1] ?? '')) minimo = Number(args[++i]);
  else { process.stderr.write(`uso: suite-local.cjs [--minimo-de-skips N]\n`); process.exit(2); }
}

const core = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['test'], { cwd: core, encoding: 'utf8', env: process.env, maxBuffer: 256 * 1024 * 1024 });
const saida = (r.stdout ?? '') + (r.stderr ?? '');
const total = (nome) => {
  // Reporter spec (`ℹ fail 0`) ou TAP (`# fail 0`), conforme o terminal e a versao do Node.
  const m = new RegExp(`^(?:ℹ|#) ${nome} (\\d+)$`, 'm').exec(saida);
  return m ? Number(m[1]) : null;
};
const testes = total('tests'), falhas = total('fail'), pulados = total('skipped');
if (testes === null || falhas === null || pulados === null) {
  process.stdout.write(saida.slice(-4000));
  process.stderr.write('suite-local: relatorio do node --test sem os totais (tests, fail, skipped)\n');
  process.exit(1);
}
// O teste pulado: `﹣ <nome> (<ms>) # <motivo>` no spec, `ok N - <nome> # SKIP <motivo>` no TAP.
const skips = saida.split('\n').filter((l) => /^\s*﹣ /.test(l) || /^\s*ok \d+ - .* # SKIP\b/.test(l));
const motivos = new Map();
for (const s of skips) {
  const motivo = (/ # (?:SKIP ?)?(.*)$/.exec(s)?.[1] || 'sem motivo').replace(/^skip: /, '');
  motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
}
process.stdout.write(`suite local: ${testes} testes, ${falhas} falhas, ${pulados} skips\n`);
for (const [motivo, n] of [...motivos].sort((a, b) => b[1] - a[1])) process.stdout.write(`  ${n}x skip: ${motivo}\n`);
if (falhas !== 0 || r.status !== 0) {
  const inicio = saida.indexOf('failing tests:');
  process.stdout.write(inicio >= 0 ? saida.slice(inicio, inicio + 8000) : saida.slice(-4000));
  process.stderr.write(`suite-local: ${falhas} falha(s), saida do npm test ${r.status}\n`);
  process.exit(1);
}
if (pulados < minimo) {
  process.stderr.write(`suite-local: ${pulados} skip(s), esperado ao menos ${minimo}\n`);
  process.exit(1);
}

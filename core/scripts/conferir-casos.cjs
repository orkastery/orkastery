#!/usr/bin/env node
/**
 * RM-067 (ork-grokbuild, D16): confere os casos de um arquivo de teste pelo TAP do `node --test`, só com `node`.
 *
 * O runner do CI não tem `rg`, e as claims da thread usam só `grep`, `node` e `npm`. Contar os casos pelo nome dá à
 * claim a guarda que o código de saída do `node --test` sozinho não dá: com `--test-name-pattern` que não casa nada, ou
 * com o caso pulado, ele sai 0.
 *
 *   node core/scripts/conferir-casos.cjs <arquivo.test.js> <prefixo> <minimo> [padrao do nome]
 *
 * Sai 0 quando pelo menos <minimo> casos com o nome começando por `<prefixo><numero>:` passaram, nenhum caiu e nenhum
 * foi pulado; 1 no resto; 2 com o uso errado. Um arquivo por chamada: com dois, o TAP do node relata só o primeiro.
 * O `NODE_TEST_CONTEXT` herdado sai do ambiente do filho: sob o `npm test`, ele tira o TAP do `node --test` de dentro.
 */
'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function uso(motivo) {
  process.stderr.write(`conferir-casos: ${motivo}\n` +
    'uso: node core/scripts/conferir-casos.cjs <arquivo.test.js> <prefixo> <minimo> [padrao do nome]\n');
  process.exit(2);
}

const [arquivo, prefixo, minimoBruto, padrao] = process.argv.slice(2);
if (!arquivo || !prefixo || !minimoBruto) uso('faltam argumentos');
if (!/^[A-Z]{1,6}$/.test(prefixo)) uso(`prefixo invalido: ${prefixo} (de 1 a 6 letras maiusculas)`);
if (!/^[1-9][0-9]{0,3}$/.test(minimoBruto)) uso(`minimo invalido: ${minimoBruto} (inteiro de 1 a 9999)`);
let arquivoComum = false;
try { arquivoComum = fs.statSync(arquivo).isFile(); } catch { arquivoComum = false; }
if (!arquivoComum) uso(`arquivo de teste ausente: ${arquivo}`);
const minimo = Number(minimoBruto);

const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const args = ['--test', '--test-reporter=tap', ...(padrao ? [`--test-name-pattern=${padrao}`] : []), arquivo];
const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// No Node 20, o caso que o `--test-name-pattern` deixa de fora sai como `ok N - nome # SKIP test name does not match
// pattern`; no 22 ele nem sai. Fora do filtro não é caso rodado: não passa nem conta como pulado.
const linhas = (r.stdout ?? '').split('\n')
  .filter((l) => !(padrao && /# SKIP test name does not match pattern\s*$/.test(l)));
const passou = new RegExp(`^\\s*ok \\d+ - ${prefixo}\\d+:`);
const passaram = linhas.filter((l) => passou.test(l)).length;
const cairam = linhas.filter((l) => /^\s*not ok \d+/.test(l));
const pulados = linhas.filter((l) => /^\s*(?:not )?ok \d+ .*# (?:SKIP|TODO)\b/i.test(l)).length;
const saida = r.status === 0 ? '' : `, node --test saiu ${r.status ?? r.signal ?? r.error?.message ?? 'sem codigo'}`;
const ok = r.status === 0 && passaram >= minimo && cairam.length === 0 && pulados === 0;
process.stdout.write(`${arquivo}: ${passaram} caso(s) ${prefixo} passaram (minimo ${minimo}), ${cairam.length} caindo, ` +
  `${pulados} pulado(s)${saida}: ${ok ? 'ok' : 'REPROVADO'}\n`);
if (cairam.length) process.stdout.write(`${cairam.slice(0, 20).join('\n')}\n`);
process.exit(ok ? 0 : 1);

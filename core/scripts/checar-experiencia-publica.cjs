#!/usr/bin/env node
'use strict';
/** Varredura delimitada: prova ausência dos padrões examinados, não de todo nome possível. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ARQUIVOS = [
  'docs/roadmap/RM-051-pacote-de-experiencia.md', 'docs/produto/FEAT-030-pacote-de-experiencia.md',
  'docs/guias/orchestration-experience.md', 'docs/guias/orchestration-experience.pt-BR.md',
  'skills/core/orchestration-experience/SKILL.md', 'skills/core/orchestration-experience-pt-br/SKILL.md',
  'eval/casos/orchestration-experience.json', 'eval/casos/orchestration-experience-pt-br.json',
  'core/src/experiencia.ts', 'core/src/experiencia-instalacao.ts', 'core/src/mcp-experiencia.ts',
  'core/test/experiencia-config.test.ts', 'core/test/onboarding-experiencia.test.ts',
  'core/test/experiencia-instalacao.test.ts', 'core/test/adapter-experiencia.test.ts',
  'core/test/experiencia-hosts.test.ts', 'core/test/mcp-experiencia.test.ts',
  'core/test/thread-roadmap-aviso.test.ts', 'core/test/experiencia-distribuicao.test.ts',
  'core/test/experiencia-publica.test.ts',
  'core/scripts/testar-experiencia-e2e.cjs', 'core/scripts/checar-experiencia-publica.cjs',
];
const PADROES = [
  '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}',
  '/(?:home|Users)/[A-Z0-9_.-]+/',
  '(?:chat[_ -]?id|telegram[_ -]?(?:user|chat))[^\\n]{0,8}[=:][ "\x27]*-?[0-9]{5,}',
  '\\b(?:10\\.[0-9]{1,3}|192\\.168|172\\.(?:1[6-9]|2[0-9]|3[01]))\\.[0-9]{1,3}\\.[0-9]{1,3}\\b',
  '\\b[A-Z0-9-]+\\.(?:internal|localdomain)\\b',
];
function termosExternos(arquivo, raiz) {
  if (!arquivo) return [];
  const real = fs.realpathSync(arquivo), repo = fs.realpathSync(raiz);
  if (real === repo || real.startsWith(repo + path.sep)) throw Error('scan.termos.exigem-arquivo-externo');
  if (fs.statSync(real).size > 65536) throw Error('scan.termos.grande');
  return fs.readFileSync(real, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}
const escapar = texto => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function varrer({ raiz = path.resolve(__dirname, '../..'), arquivos = ARQUIVOS, termos = [], executar = spawnSync } = {}) {
  if (!arquivos.length) throw Error('scan.lista.vazia');
  for (const relativo of arquivos) {
    if (path.isAbsolute(relativo) || relativo.split(/[\\/]/).includes('..')) throw Error('scan.path.invalid');
    const alvo = path.join(raiz, relativo), stat = fs.lstatSync(alvo);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('scan.arquivo.invalid');
  }
  const args = ['--files-with-matches', '--no-messages', '--color', 'never', '--ignore-case',
    ...[...PADROES, ...termos.map(escapar)].flatMap(p => ['--regexp', p]), '--', ...arquivos];
  const r = executar('rg', args, { cwd: raiz, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (r.error || r.signal || ![0, 1].includes(r.status)) throw Error('scan.exec.failed: varredura não comprovada');
  const encontrados = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (encontrados.some(f => !arquivos.includes(f)) || (r.status === 0 && !encontrados.length) || (r.status === 1 && encontrados.length)) throw Error('scan.saida.invalid');
  return { ok: r.status === 1, examinados: arquivos.length, arquivos: encontrados,
    limite: 'Somente padrões documentados e termos externos fornecidos; não detecta todo nome possível.' };
}
module.exports = { ARQUIVOS, PADROES, termosExternos, varrer };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--termos')) throw Error('uso: checar-experiencia-publica.cjs [--termos ARQUIVO_EXTERNO]');
    const raiz = path.resolve(__dirname, '../..');
    const r = varrer({ raiz, termos: termosExternos(args[1], raiz) });
    console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1;
  } catch { console.error('Varredura pública não comprovada: arquivo ausente, entrada inválida ou falha de execução.'); process.exitCode = 2; }
}

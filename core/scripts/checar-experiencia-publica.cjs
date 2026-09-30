#!/usr/bin/env node
'use strict';
/** Varredura delimitada: prova ausência dos padrões examinados, não de todo nome possível. */
const fs = require('node:fs');
const path = require('node:path');
const ARQUIVOS = [
  'docs/roadmap/RM-051-pacote-de-experiencia.md', 'docs/produto/FEAT-034-pacote-de-experiencia.md',
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
  // Arquivos que a RM-051 alterou. docs/comecar/quickstart.md fica fora: desde antes da RM-051 ele
  // traz um diretório pessoal genérico de exemplo, e o padrão de caminho pessoal casaria com ele.
  'CHANGELOG.md', 'adapters/claude-code/.claude-plugin/plugin.json', 'adapters/codex/skills/ork/SKILL.md',
  'adapters/hermes/skills/orkastery-devmaster/SKILL.md', 'core/src/hosts.ts', 'core/src/index.ts', 'core/src/init.ts',
  'core/src/manifest.ts', 'core/src/mcp-server.ts', 'core/src/onboarding.ts', 'core/src/types.ts',
  'core/test/horario-entradas.test.ts', 'core/test/mcp-server.test.ts', 'core/test/projeto-alvo-mcp.test.ts',
  'docs/README.md', 'docs/guias/onboarding.md', 'docs/produto/MOD-06-integracao-com-hosts.md', 'docs/produto/README.md',
  'skills/README.md', 'skills/core/onboarding/SKILL.md',
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
/**
 * Motor em Node com o contrato do grep (0 casou, 1 não casou): o runner hospedado do GitHub não traz
 * o rg, e a varredura não pode depender de binário da máquina.
 */
function buscar(raiz, arquivos, expressoes) {
  try {
    const padrao = new RegExp(expressoes.join('|'), 'i');
    const casados = arquivos.filter(f => padrao.test(fs.readFileSync(path.join(raiz, f), 'utf8')));
    return { status: casados.length ? 0 : 1, stdout: casados.map(f => f + '\n').join('') };
  } catch (error) { return { status: 2, error }; }
}
function varrer({ raiz = path.resolve(__dirname, '../..'), arquivos = ARQUIVOS, termos = [], executar = buscar } = {}) {
  if (!arquivos.length) throw Error('scan.lista.vazia');
  for (const relativo of arquivos) {
    if (path.isAbsolute(relativo) || relativo.split(/[\\/]/).includes('..')) throw Error('scan.path.invalid');
    const alvo = path.join(raiz, relativo), stat = fs.lstatSync(alvo);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('scan.arquivo.invalid');
  }
  const r = executar(raiz, arquivos, [...PADROES, ...termos.map(escapar)]);
  if (r.error || r.signal || ![0, 1].includes(r.status)) throw Error('scan.exec.failed: varredura não comprovada');
  const encontrados = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (encontrados.some(f => !arquivos.includes(f)) || (r.status === 0 && !encontrados.length) || (r.status === 1 && encontrados.length)) throw Error('scan.saida.invalid');
  // termosExternos: 0 diz que só os padrões genéricos rodaram; nomes pessoais exigem a lista externa.
  return { ok: r.status === 1, examinados: arquivos.length, termosExternos: termos.length, arquivos: encontrados,
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

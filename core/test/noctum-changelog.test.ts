/**
 * RM-058 (N5, D4 e D5 da ork-rm058n5): o CHANGELOG da entrega e os conflitos só aditivos. O aceite da tabela de fatias vira
 * teste: conflito de CHANGELOG depois de uma versão preserva as entradas na seção certa ("Não publicado"). As entradas e as
 * versões são SIMULADAS; o merge do QC4 é do git de verdade, num repositório descartável.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';
import { blocosNaoPublicados, conferirChangelog, entradasDaThread, linhasDaBasePerdidas, pedeLinha, posicionarEntradas,
  resolverConflitosAditivos } from '../src/noctum-changelog';
import { exec } from '../src/util';

const CAB = '# Changelog\n\nAs mudanças, da mais nova para a mais antiga.\n\n';
const ANTIGA = '- **Antiga SIMULADA** (RM-901): já estava antes da thread.\n  Ela continua nesta linha.';
const DA_THREAD = '- **Entrega SIMULADA da thread** (RM-958): o que a thread acrescenta.\n  A segunda linha do item.';
const DA_MAIN = '- **Outra thread SIMULADA** (RM-959): entrou na base enquanto a thread trabalhava.';
const CONSERTO = '- **Conserto SIMULADO** (RM-958): o que a thread corrige.';

const blocos = (texto: string) => (blocosNaoPublicados(texto) ?? []).map(b => b.linhas.join('\n'));

test('QC1: as entradas da thread são os blocos novos de Não publicado, com a subseção, em multiconjunto', () => {
  const antes = `${CAB}## Não publicado\n\n### Adicionado\n\n${ANTIGA}\n\n## [0.1.0] - 2026-10-01\n\n- v1\n`;
  const depois = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_THREAD}\n\n${ANTIGA}\n\n${ANTIGA}\n\n### Corrigido\n\n${CONSERTO}\n\n` +
    '## [0.1.0] - 2026-10-01\n\n- v1\n';
  const e = entradasDaThread(antes, depois);
  assert.deepEqual(e.map(b => [b.linhas.join('\n'), b.subsecao]), [
    [DA_THREAD, '### Adicionado'],
    [ANTIGA, '### Adicionado'],
    [CONSERTO, '### Corrigido'],
  ], 'o bloco repetido conta uma vez a mais; o da versão não conta');
  assert.equal(e[0].linhas.length, 2, 'a linha recuada é do mesmo item');
  assert.deepEqual(entradasDaThread(antes, antes), []);
  assert.deepEqual(entradasDaThread('# sem seções\n', depois).length, 4, 'sem a seção no ancestral, tudo de Não publicado é novo');
});

test('QC2: conflito só aditivo vira a união com a base primeiro; o resto é recusa com o motivo', () => {
  const conflito = (primeiro: string[], ancestral: string[], segundo: string[]) =>
    ['antes', '<<<<<<< ork/ork-x-full', ...primeiro, '||||||| 1234567', ...ancestral, '=======', ...segundo, '>>>>>>> main', 'depois'].join('\n');
  // A seção do ancestral vazia: os dois lados só acrescentaram.
  const vazio = resolverConflitosAditivos(conflito(['- da thread'], [], ['- da main']));
  assert.deepEqual(vazio, { ok: true, texto: 'antes\n- da main\n- da thread\ndepois', conflitos: 1 });
  // Prefixo comum aos dois lados.
  const prefixo = resolverConflitosAditivos(conflito(['x', 'y', 'da thread'], ['x', 'y'], ['x', 'y', 'da main']));
  assert.ok(prefixo.ok);
  assert.equal(prefixo.ok && prefixo.texto, 'antes\nx\ny\nda main\nda thread\ndepois');
  // Sufixo comum aos dois lados.
  const sufixo = resolverConflitosAditivos(conflito(['da thread', 'z'], ['z'], ['da main', 'z']));
  assert.ok(sufixo.ok);
  assert.equal(sufixo.ok && sufixo.texto, 'antes\nda main\nda thread\nz\ndepois');
  // Os dois lados mudaram a linha do ancestral: não é só aditivo.
  const muda = resolverConflitosAditivos(conflito(['x da thread'], ['x'], ['x da main']));
  assert.equal(muda.ok, false);
  assert.match(!muda.ok ? muda.recusa : '', /não é só aditivo/);
  // Um lado apagou a linha do ancestral.
  const apaga = resolverConflitosAditivos(conflito([], ['x'], ['x', 'da main']));
  assert.equal(apaga.ok, false);
  // Sem a seção do ancestral (o estilo merge, sem diff3): não dá para saber se é só aditivo.
  const semAncestral = resolverConflitosAditivos(['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> main'].join('\n'));
  assert.equal(semAncestral.ok, false);
  assert.match(!semAncestral.ok ? semAncestral.recusa : '', /diff3/);
  // Marcador solto fora de um conflito, e conflito sem fim.
  assert.equal(resolverConflitosAditivos('a\n=======\nb').ok, false);
  assert.equal(resolverConflitosAditivos('<<<<<<< HEAD\na\n||||||| x\n=======\nb').ok, false);
  // Texto sem conflito volta igual; oito sinais não são marcador.
  const limpo = 'a\n<<<<<<<< oito\nb\n';
  assert.deepEqual(resolverConflitosAditivos(limpo), { ok: true, texto: limpo, conflitos: 0 });
  // Dois conflitos no mesmo arquivo.
  const dois = resolverConflitosAditivos(`${conflito(['t1'], [], ['m1'])}\n${conflito(['t2'], [], ['m2'])}`);
  assert.ok(dois.ok && dois.conflitos === 2);
});

test('QC3: a entrada da thread que caiu numa versão volta para Não publicado, na subseção de origem', () => {
  const daBase = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n`;
  // O merge pôs a entrada da thread dentro da 0.2.0, logo abaixo da antiga.
  const mesclado = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n\n` +
    `${DA_THREAD}\n`;
  const entradas = [{ linhas: DA_THREAD.split('\n'), subsecao: '### Adicionado' }];
  const r = posicionarEntradas(mesclado, entradas, daBase);
  assert.deepEqual([r.movidas, r.perdidas], [1, 0]);
  assert.equal(r.texto, `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_THREAD}\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n` +
    `${ANTIGA}\n`);
  assert.deepEqual(linhasDaBasePerdidas(daBase, r.texto), [], 'nenhuma linha da base some');
  // A entrada que já está em Não publicado não muda; a que não está em lugar nenhum foi perdida.
  assert.deepEqual(posicionarEntradas(r.texto, entradas, daBase), { texto: r.texto, movidas: 0, perdidas: 0 });
  assert.equal(posicionarEntradas(daBase, entradas, daBase).perdidas, 1);
  // A mesma entrada na versão da base é da base: não sai de lá.
  const naVersaoDaBase = posicionarEntradas(daBase, [{ linhas: ANTIGA.split('\n'), subsecao: '### Adicionado' }], daBase);
  assert.deepEqual([naVersaoDaBase.movidas, naVersaoDaBase.texto], [0, daBase]);
});

test('QC3b: sem Não publicado nem a subseção, as duas são criadas; o subtítulo que a thread levou para a versão sai junto', () => {
  const daBase = `${CAB}## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n`;
  const mesclado = `${CAB}## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n\n### Corrigido\n\n${CONSERTO}\n`;
  const r = posicionarEntradas(mesclado, [{ linhas: [CONSERTO], subsecao: '### Corrigido' }], daBase);
  assert.equal(r.movidas, 1);
  assert.equal(r.texto, `${CAB}## Não publicado\n\n### Corrigido\n\n${CONSERTO}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n`);
  // Com Não publicado e sem a subseção: ela é criada no alto da seção.
  const comSecao = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n\n` +
    `${CONSERTO}\n`;
  const base2 = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n`;
  const r2 = posicionarEntradas(comSecao, [{ linhas: [CONSERTO], subsecao: '### Corrigido' }], base2);
  assert.equal(r2.texto, `${CAB}## Não publicado\n\n### Corrigido\n\n${CONSERTO}\n\n### Adicionado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n` +
    `### Adicionado\n\n${ANTIGA}\n`);
  assert.deepEqual(linhasDaBasePerdidas(base2, r2.texto), []);
});

/** Um repositório descartável com o CHANGELOG do ancestral comum, a branch da thread e a base que publicou uma versão. */
function repositorio(nome: string, ancestral: string, daThread: string, daBase: string): { dir: string; merge: ReturnType<typeof exec> } {
  const dir = dirTemporario(nome);
  const git = (...args: string[]) => exec('git', args, dir);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@orkastery.local');
  git('config', 'user.name', 'Teste Orkastery');
  const gravar = (texto: string, msg: string) => { fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), texto); git('add', '--', 'CHANGELOG.md'); git('commit', '-q', '-m', msg); };
  gravar(ancestral, 'ancestral');
  git('checkout', '-q', '-b', 'ork/ork-thread-full');
  gravar(daThread, 'feat: a entrada da thread');
  git('checkout', '-q', 'main');
  gravar(daBase, 'chore: versão 0.2.0');
  git('checkout', '-q', 'ork/ork-thread-full');
  const merge = exec('git', ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', 'main'], dir);
  return { dir, merge };
}

/** A atualização como o núcleo faz: resolve o conflito só aditivo e põe a entrada da thread em Não publicado. */
function atualizar(dir: string, ancestral: string, daThread: string, daBase: string): string {
  const lido = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
  const resolvido = resolverConflitosAditivos(lido);
  assert.ok(resolvido.ok, !resolvido.ok ? resolvido.recusa : '');
  const r = posicionarEntradas(resolvido.ok ? resolvido.texto : '', entradasDaThread(ancestral, daThread), daBase);
  assert.equal(r.perdidas, 0);
  return r.texto;
}

test('QC4: merge da base que publicou uma versão, com conflito textual: todas as linhas ficam, e a da thread em Não publicado', () => {
  const ancestral = `${CAB}## Não publicado\n\n### Adicionado\n\n${ANTIGA}\n\n## [0.1.0] - 2026-10-01\n\n- v1\n`;
  // A thread acrescentou no alto de Adicionado; a base fez a versão (a antiga foi para a 0.2.0) e outra entrada chegou.
  const daThread = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_THREAD}\n\n${ANTIGA}\n\n## [0.1.0] - 2026-10-01\n\n- v1\n`;
  const daBase = `${CAB}## Não publicado\n\n### Adicionado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n\n` +
    '## [0.1.0] - 2026-10-01\n\n- v1\n';
  const { dir, merge } = repositorio('noctum-qc4', ancestral, daThread, daBase);
  try {
    assert.equal(merge.ok, false, 'o git acusa o conflito');
    assert.match(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), /^\|{7}/m, 'o conflito vem no estilo diff3');
    const final = atualizar(dir, ancestral, daThread, daBase);
    assert.deepEqual(linhasDaBasePerdidas(daBase, final), [], 'nenhuma linha da base some');
    assert.ok(blocos(final).includes(DA_THREAD), 'a entrada da thread está em Não publicado');
    assert.ok(blocos(final).includes(DA_MAIN), 'a da outra thread também');
    assert.ok(!blocos(final).includes(ANTIGA), 'a antiga ficou na versão');
    assert.deepEqual(conferirChangelog(daBase, final, ['core/src/x.ts']).ok, true, 'a regra do checador passa contra a base');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('QC4b: merge da base que publicou uma versão, sem conflito textual: o git põe a linha da thread na versão, e ela volta', () => {
  const ancestral = `${CAB}## Não publicado\n\n### Adicionado\n\n${ANTIGA}\n\n## [0.1.0] - 2026-10-01\n\n- v1\n`;
  // A thread acrescentou embaixo da antiga; a base abriu a versão acima de Adicionado e um Não publicado novo no alto.
  const daThread = `${CAB}## Não publicado\n\n### Adicionado\n\n${ANTIGA}\n\n${DA_THREAD}\n\n## [0.1.0] - 2026-10-01\n\n- v1\n`;
  const daBase = `${CAB}## Não publicado\n\n${DA_MAIN}\n\n## [0.2.0] - 2026-10-12\n\n### Adicionado\n\n${ANTIGA}\n\n## [0.1.0] - 2026-10-01\n\n- v1\n`;
  const { dir, merge } = repositorio('noctum-qc4b', ancestral, daThread, daBase);
  try {
    assert.equal(merge.ok, true, `o git mescla sem conflito: ${merge.stderr}`);
    const mesclado = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    assert.ok(!blocos(mesclado).includes(DA_THREAD), 'sem a regra, a linha da thread ficaria dentro da 0.2.0');
    assert.equal(conferirChangelog(daBase, mesclado, ['core/src/x.ts']).ok, false, 'e o checador reprovaria contra a base');
    const final = atualizar(dir, ancestral, daThread, daBase);
    assert.ok(blocos(final).includes(DA_THREAD));
    assert.deepEqual(linhasDaBasePerdidas(daBase, final), []);
    assert.equal(conferirChangelog(daBase, final, ['core/src/x.ts']).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('QC5: a regra do checador portada: produto sem linha reprova, com linha, versão nova ou só teste passa', () => {
  const antes = `${CAB}## Não publicado\n\n${ANTIGA}\n`;
  const comLinha = `${CAB}## Não publicado\n\n${DA_THREAD}\n\n${ANTIGA}\n`;
  assert.equal(conferirChangelog(antes, antes, ['core/src/x.ts']).ok, false);
  const r = conferirChangelog(antes, antes, ['core/src/x.ts']);
  assert.equal(!r.ok && r.motivo, 'changelog.linha-ausente');
  assert.equal(conferirChangelog(antes, comLinha, ['core/src/x.ts']).ok, true);
  assert.equal(conferirChangelog(antes, `${CAB}## [9.9.9] - 2026-10-13\n\n${ANTIGA}\n`, ['core/src/x.ts']).ok, true, 'versão nova');
  assert.equal(conferirChangelog(antes, antes, ['core/test/x.test.ts', 'docs/x.md', '.ork-ci/ork-x.json']).ok, true);
  const semSecao = conferirChangelog(antes, `${CAB}texto\n`, ['adapters/x.js']);
  assert.equal(!semSecao.ok && semSecao.motivo, 'changelog.secao-ausente');
  assert.deepEqual(['core/src/a.ts', 'core/scripts/checar-x.cjs', 'core/scripts/mutante.cjs', 'marketplaces/m.json', 'docs/a.md']
    .map(pedeLinha), [true, false, true, true, false]);
});

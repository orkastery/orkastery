/**
 * RM-061, fatia F3b (item 11, D4 e D5): as skills, as checklists, os comandos e os subagentes que o `ork adapter install`
 * copia, na lingua do dono. Cada variante inglesa de `core/assets/{skills,references,adapters}-en/` tem a estrutura do
 * original (D5) e foi traduzida da versao atual dele (o sha256 em `fixtures/variantes-en.json`); todo `.md` instalavel dos
 * hosts com catalogo e a skill do Hermes tem variante. Com o dono em ingles, o install copia a variante para o mesmo
 * destino; reinstalar nao muda nada e trocar a lingua troca no lugar. Negativo: em pt-BR, o recibo e os arquivos sao os do
 * catalogo, como na base. Os nomes comecam por "locale en F3b skills:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { instalarAdaptador, varianteEmIngles } from '../src/hosts';
import { cenario, Cenario, EN, ork, PT } from './locale-apoio';

const CATALOGO = path.resolve(__dirname, '../../..');
const ASSETS = path.join(CATALOGO, 'core', 'assets');
const ORIGEM_DA_PASTA: Readonly<Record<string, string>> = { 'skills-en': 'skills', 'references-en': 'references', 'adapters-en': 'adapters' };
/** O par da experiencia ja e bilingue (D4): nao tem variante. */
const BILINGUES = new Set(['skills/core/orchestration-experience/SKILL.md', 'skills/core/orchestration-experience-pt-br/SKILL.md']);
const C = { LANG: 'C.UTF-8' };

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const andar = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? andar(path.join(dir, e.name)) : [path.join(dir, e.name)]);

/** As variantes, como `skills-en/core/onboarding/SKILL.md`, com o original de cada uma. */
function variantes(): Array<{ chave: string; variante: string; original: string }> {
  return Object.entries(ORIGEM_DA_PASTA).flatMap(([pasta, origem]) => andar(path.join(ASSETS, pasta)).sort().map((variante) => {
    const rel = path.relative(path.join(ASSETS, pasta), variante).split(path.sep).join('/');
    return { chave: `${pasta}/${rel}`, variante, original: path.join(CATALOGO, origem, rel) };
  }));
}

/** A regra D5: os problemas de estrutura entre o original e a variante (vazio quando bate). */
function problemasDeParidade(original: string, variante: string): string[] {
  const A = fs.readFileSync(original, 'utf8'), B = fs.readFileSync(variante, 'utf8');
  const la = A.split('\n'), lb = B.split('\n');
  const p: string[] = [];
  if (la.length !== lb.length) return [`linhas: ${la.length} no original, ${lb.length} na variante`];
  const fim = la[0] === '---' ? la.indexOf('---', 1) : -1;
  if ((lb[0] === '---' ? lb.indexOf('---', 1) : -1) !== fim) p.push('frontmatter de tamanho diferente');
  for (let i = 1; i < fim; i++) {
    const [ka, kb] = [la[i], lb[i]].map((l) => /^([A-Za-z_-]+):/.exec(l)?.[1] ?? null);
    if (ka !== kb) p.push(`frontmatter linha ${i + 1}: chave ${ka} contra ${kb}`);
    else if (!['description', 'argument-hint'].includes(String(ka)) && la[i] !== lb[i]) p.push(`frontmatter linha ${i + 1}: valor de ${ka} mudou`);
  }
  const crases = (s: string) => JSON.stringify(s.match(/`[^`]*`/g) ?? []);
  const titulo = (s: string) => /^(#{1,6})\s/.exec(s)?.[1] ?? '';
  let cerca = false;
  for (let i = fim + 1; i < la.length; i++) {
    const a = la[i], b = lb[i];
    const marca = /^\s*(```|~~~)/.test(a);
    if (marca || cerca) {
      if (a !== b) p.push(`linha ${i + 1}: bloco cercado diferente`);
      if (marca) cerca = !cerca;
      continue;
    }
    if (titulo(a) !== titulo(b)) p.push(`linha ${i + 1}: titulo em nivel diferente`);
    if (crases(a) !== crases(b)) p.push(`linha ${i + 1}: trechos entre crases diferentes`);
    if ((a.trim() === '') !== (b.trim() === '')) p.push(`linha ${i + 1}: linha vazia so num dos dois`);
  }
  const marcadores = (s: string) => (s.match(/\{\{[^}]*\}\}/g) ?? []).join(',');
  if (marcadores(A) !== marcadores(B)) p.push('placeholders {{...}} diferentes');
  if (B.includes('—')) p.push('travessao longo (U+2014) na variante');
  // As ancoras que o eval e o teste do catalogo procuram ficam na variante, com o ingles ao lado.
  for (const ancora of ['## Racionalizacoes comuns', '## Bandeiras vermelhas']) {
    if (A.includes(`${ancora}\n`) && !B.includes(ancora)) p.push(`sem a ancora ${ancora}`);
  }
  return p;
}

test('locale en F3b skills: cada variante tem a estrutura do original (D5) e veio da versao atual dele', () => {
  const origens = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/variantes-en.json'), 'utf8')) as Record<string, string>;
  const lista = variantes();
  assert.ok(lista.length >= 40, `${lista.length} variantes`);
  assert.deepEqual(lista.map((v) => v.chave).sort(), Object.keys(origens).sort(), 'toda variante tem a origem registrada, e so ela');
  for (const v of lista) {
    assert.ok(fs.existsSync(v.original), `${v.chave}: o original nao existe`);
    assert.deepEqual(problemasDeParidade(v.original, v.variante), [], v.chave);
    assert.equal(sha(fs.readFileSync(v.original)), origens[v.chave],
      `${v.chave}: o original mudou depois da traducao; atualize a variante e o sha256 em fixtures/variantes-en.json`);
  }
});

test('locale en F3b skills: todo .md instalavel dos hosts com catalogo e a skill do Hermes tem variante', () => {
  const projeto = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-locale-skills-'));
  try {
    for (const host of ['claude-code', 'codex', 'hermes'] as const) {
      const r = instalarAdaptador(host, { projeto, catalogo: CATALOGO, dryRun: true, orkBin: 'ork', versao: '0.0.0' });
      const md = r.arquivos.map((a) => path.relative(CATALOGO, a.origem).split(path.sep).join('/'))
        .filter((rel) => rel.endsWith('.md') && !BILINGUES.has(rel))
        .filter((rel) => host !== 'hermes' || rel.startsWith('adapters/hermes/skills/'));
      assert.ok(md.length >= (host === 'hermes' ? 1 : 10), `${host}: ${md.length}`);
      for (const rel of md) assert.ok(varianteEmIngles(CATALOGO, path.join(CATALOGO, rel)), `${host}: ${rel} sem variante inglesa`);
    }
  } finally { fs.rmSync(projeto, { recursive: true, force: true }); }
});

/** O recibo do codex: a origem e o sha256 de cada arquivo instalado. */
function recibo(c: Cenario): Map<string, { origem: string; sha256: string }> {
  const r = JSON.parse(fs.readFileSync(path.join(c.dir, '.agents', 'skills', 'orkastery', 'INSTALADO.json'), 'utf8')) as
    { arquivos: Array<{ arquivo: string; origem: string; sha256: string }> };
  return new Map(r.arquivos.map((a) => [a.arquivo, { origem: a.origem, sha256: a.sha256 }]));
}

test('locale en F3b skills: com o dono em ingles, o install copia a variante; reinstalar nao muda e trocar a lingua troca no lugar', () => {
  const c = cenario('skills-f3b');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    const primeira = ork(c, PT, false, 'adapter', 'install', 'codex');
    assert.equal(primeira.status, 0, primeira.stderr);
    const instalada = path.join(c.dir, '.agents', 'skills', 'orkastery');
    const ingles = recibo(c);
    assert.equal(ingles.get('skills/core/onboarding/SKILL.md')?.origem, 'core/assets/skills-en/core/onboarding/SKILL.md');
    assert.equal(ingles.get('references/definition-of-done.md')?.origem, 'core/assets/references-en/definition-of-done.md');
    assert.equal(ingles.get('skills/ork/SKILL.md')?.origem, 'core/assets/adapters-en/codex/skills/ork/SKILL.md');
    assert.equal(ingles.get('skills/core/orchestration-experience/SKILL.md')?.origem, 'skills/core/orchestration-experience/SKILL.md');
    assert.equal(fs.readFileSync(path.join(instalada, 'skills', 'core', 'onboarding', 'SKILL.md'), 'utf8'),
      fs.readFileSync(path.join(ASSETS, 'skills-en', 'core', 'onboarding', 'SKILL.md'), 'utf8'));
    // Reinstalar na mesma lingua nao muda nada.
    assert.match(ork(c, PT, false, 'adapter', 'install', 'codex').stdout, /\n {2}files: (\d+) \(0 new, \1 already identical, 0 divergent\)\n/);
    // Trocar a lingua do dono troca no lugar a copia intacta (catalogo-andou), sem pedir decisao.
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"pt-BR"}}', '--por', 'teste').status, 0);
    const troca = ork(c, PT, false, 'adapter', 'install', 'codex');
    assert.equal(troca.status, 0, troca.stdout);
    assert.match(troca.stdout, /\(catalogo-andou\)/);
    assert.equal(recibo(c).get('skills/core/onboarding/SKILL.md')?.origem, 'skills/core/onboarding/SKILL.md');
    assert.equal(fs.readFileSync(path.join(instalada, 'skills', 'core', 'onboarding', 'SKILL.md'), 'utf8'),
      fs.readFileSync(path.join(CATALOGO, 'skills', 'core', 'onboarding', 'SKILL.md'), 'utf8'));
  } finally { c.limpar(); }
});

test('locale en F3b skills (negativo): sem lingua (C.UTF-8) ou com o dono em pt-BR e LANG ingles, o install copia o catalogo pt-BR', () => {
  for (const [nome, env, dono] of [['sem-lingua', C, null], ['dono-pt', EN, 'pt-BR']] as const) {
    const c = cenario(`skills-f3b-${nome}`);
    try {
      if (dono) assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', `{"owner":{"language":"${dono}"}}`, '--por', 'teste').status, 0);
      assert.equal(ork(c, env, false, 'adapter', 'install', 'codex').status, 0, nome);
      const r = recibo(c);
      assert.ok(r.size >= 20, nome);
      for (const [arquivo, { origem, sha256 }] of r) {
        assert.ok(!origem.startsWith('core/assets/'), `${nome}: ${arquivo} saiu de ${origem}`);
        assert.equal(sha256, sha(fs.readFileSync(path.join(c.dir, '.agents', 'skills', 'orkastery', arquivo))), `${nome}: ${arquivo}`);
      }
    } finally { c.limpar(); }
  }
});

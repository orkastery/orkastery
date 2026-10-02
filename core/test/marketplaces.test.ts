/**
 * Testes do gerador do plugin para os marketplaces (RM-049, thread ork-rm049marketp).
 *
 * As pastas `marketplaces/<host>/orkastery/` sao copia derivada do catalogo. O que se prova aqui e
 * que a copia nao diverge sem o CI ver, e que cada regra do checklist dos portais reprova sozinha:
 * uma conferencia que nunca reprova e decoracao. Cada caso negativo roda numa copia temporaria nova,
 * sem rede e sem `claude` ou `codex`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BUCKETS, exigirCatalogo, skillsDoCatalogo } from '../src/catalogo';

interface Achado { codigo: string; arquivo: string; detalhe: string }
interface Gerador {
  BUCKETS: string[];
  DESTINOS: { claude: string; codex: string; marketplaceClaude: string; marketplaceCodex: string };
  gerar(raiz: string): Map<string, Buffer>;
  verificar(raiz: string): Achado[];
  escrever(raiz: string): number;
  conferirPastaClaude(dir: string, raiz?: string): Achado[];
  conferirPastaCodex(dir: string, raiz?: string): Achado[];
  conferirMarketplaces(raiz: string): Achado[];
  conferirTextosDoRepositorio(raiz: string): Achado[];
  problemaDoFrontmatter(bloco: string): string | null;
}

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gen: Gerador = require(path.join(RAIZ, 'core', 'scripts', 'gerar-marketplaces.cjs'));

/** O que o gerador le e escreve, copiado para uma raiz temporaria. */
const PARTES = [
  'skills', 'references', 'adapters/claude-code/.claude-plugin', 'adapters/claude-code/commands',
  'adapters/claude-code/agents', 'adapters/codex', 'docs/assets/marca', 'marketplaces', '.claude-plugin',
  '.agents/plugins', 'LICENSE', 'core/package.json',
];

function comCopia<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-marketplaces-'));
  try {
    for (const parte of PARTES) fs.cpSync(path.join(RAIZ, parte), path.join(dir, parte), { recursive: true });
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const codigos = (achados: Achado[]) => achados.map((a) => a.codigo);
const edita = (arquivo: string, f: (t: string) => string) => fs.writeFileSync(arquivo, f(fs.readFileSync(arquivo, 'utf8')));
const json = (arquivo: string) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const temAchado = (achados: Achado[], codigo: string, detalhe?: RegExp) =>
  achados.some((a) => a.codigo === codigo && (!detalhe || detalhe.test(a.detalhe)));

test('S1 a copia do marketplace nao diverge do catalogo sem a conferencia reprovar e dizer como corrigir', () => {
  assert.deepEqual(gen.verificar(RAIZ), [], 'o HEAD esta igual ao que as fontes geram');
  comCopia((dir) => {
    assert.deepEqual(gen.verificar(dir), []);
    fs.appendFileSync(path.join(dir, 'skills/phases/goal-definition/SKILL.md'), '\nlinha nova no catalogo\n');
    const achados = gen.verificar(dir);
    const rels = achados.map((a) => a.arquivo);
    assert.ok(rels.includes('marketplaces/claude-code/orkastery/skills/phases/goal-definition/SKILL.md'));
    assert.ok(rels.includes('marketplaces/codex/orkastery/skills/phases/goal-definition/SKILL.md'));
    assert.ok(achados.every((a) => a.codigo === 'deriva.diferente' && a.detalhe === 'rode: node core/scripts/gerar-marketplaces.cjs'));

    fs.writeFileSync(path.join(dir, 'marketplaces/codex/orkastery/sobra.md'), 'arquivo que ninguem gerou\n');
    assert.ok(codigos(gen.verificar(dir)).includes('deriva.sobrando'));
    gen.escrever(dir);
    assert.deepEqual(gen.verificar(dir), [], 'regenerar resolve e remove o que sobrava');
    assert.equal(fs.existsSync(path.join(dir, 'marketplaces/codex/orkastery/sobra.md')), false);

    fs.rmSync(path.join(dir, 'marketplaces/claude-code/orkastery/LICENSE'));
    assert.ok(codigos(gen.verificar(dir)).includes('deriva.faltando'));
    gen.escrever(dir);

    // Checkout com autocrlf: texto com CRLF nao e deriva.
    edita(path.join(dir, 'marketplaces/claude-code/orkastery/README.md'), (t) => t.replace(/\n/g, '\r\n'));
    assert.deepEqual(gen.verificar(dir), []);

    // Fonte no disco e fora do indice do git passa aqui e quebra no checkout limpo do CI.
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    git('init', '-q');
    git('add', '--', ...PARTES);
    assert.deepEqual(gen.verificar(dir), [], 'tudo indexado');
    git('rm', '-q', '--cached', '--', 'marketplaces/fontes/listagem.json');
    assert.deepEqual(gen.verificar(dir).map((a) => [a.codigo, a.arquivo]), [['fonte.fora-do-git', 'marketplaces/fontes/listagem.json']]);
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });

    edita(path.join(dir, 'core/package.json'), (t) => JSON.stringify({ ...JSON.parse(t), version: '9.9.9' }));
    const versao = gen.verificar(dir).map((a) => a.arquivo);
    assert.ok(versao.includes('marketplaces/claude-code/orkastery/.claude-plugin/plugin.json'), 'subir a versao exige regenerar');
    assert.ok(versao.includes('marketplaces/codex/orkastery/.codex-plugin/plugin.json'));
  });
});

test('S2 a pasta Claude segue o catalogo, a versao do CLI e cada regra bloqueante do checklist da Anthropic', () => {
  assert.deepEqual(gen.BUCKETS, [...BUCKETS], 'o gerador enumera os buckets na ordem do nucleo');
  const pasta = path.join(RAIZ, gen.DESTINOS.claude);
  const p = json(path.join(pasta, '.claude-plugin/plugin.json'));
  assert.equal(p.name, 'orkastery');
  assert.equal(p.version, json(path.join(RAIZ, 'core/package.json')).version);
  assert.equal(p.license, 'MIT');
  assert.deepEqual(p.skills, skillsDoCatalogo(RAIZ).map((s) => `./skills/${s.bucket}/${s.nome}`));
  assert.equal(p.hooks, undefined);
  assert.equal(p.mcpServers, undefined);
  for (const ausente of ['hooks', '.mcp.json', 'bin']) assert.equal(fs.existsSync(path.join(pasta, ausente)), false, `${ausente} fora (D1)`);
  assert.deepEqual(gen.conferirPastaClaude(pasta, RAIZ), []);

  const caso = (codigo: string, detalhe: RegExp | undefined, mexe: (c: string, dir: string) => void) => comCopia((dir) => {
    const c = path.join(dir, gen.DESTINOS.claude);
    mexe(c, dir);
    const achados = gen.conferirPastaClaude(c, dir);
    assert.ok(temAchado(achados, codigo, detalhe), `${codigo} ${detalhe ?? ''}: ${JSON.stringify(achados)}`);
  });
  const manifesto = (c: string, f: (m: Record<string, unknown>) => Record<string, unknown>) =>
    edita(path.join(c, '.claude-plugin/plugin.json'), (t) => JSON.stringify(f(JSON.parse(t))));

  caso('manifesto.nome', /fora de/, (c) => manifesto(c, (m) => ({ ...m, name: 'Orkastery Plugin' })));
  caso('manifesto.nome', /diferente da pasta/, (c) => manifesto(c, (m) => ({ ...m, name: 'outro' })));
  caso('manifesto.caminho', /sai da pasta/, (c) => manifesto(c, (m) => ({ ...m, skills: [...(m.skills as string[]), './../fora'] })));
  caso('manifesto.caminho', /nao existe/, (c) => manifesto(c, (m) => ({ ...m, skills: [...(m.skills as string[]), './skills/nao/existe'] })));
  caso('manifesto.campos', /version/, (c) => manifesto(c, (m) => ({ ...m, version: '0.0.1' })));
  caso('catalogo.skills', undefined, (c) => manifesto(c, (m) => ({ ...m, skills: (m.skills as string[]).slice(1) })));
  caso('licenca.ausente', undefined, (c) => fs.rmSync(path.join(c, 'LICENSE')));
  caso('arquivo.grande', undefined, (c) => fs.writeFileSync(path.join(c, 'grande.md'), 'x'.repeat(256 * 1024 + 1)));
  caso('arquivo.link', undefined, (c) => fs.symlinkSync('README.md', path.join(c, 'atalho.md')));
  caso('arquivo.sistema', undefined, (c) => fs.writeFileSync(path.join(c, '.DS_Store'), ''));
  caso('arquivo.nome', /Windows/, (c) => fs.writeFileSync(path.join(c, 'con.md'), 'x\n'));
  caso('arquivo.nome', /caixa/, (c) => fs.copyFileSync(path.join(c, 'README.md'), path.join(c, 'Readme.md')));
  caso('arquivo.tipo', /assinatura PNG/, (c) => fs.writeFileSync(path.join(c, 'assets/falso.png'), 'nao sou png\n'));
  caso('arquivo.quantidade', undefined, (c) => {
    fs.mkdirSync(path.join(c, 'extra'));
    for (let i = 0; i < 513; i++) fs.writeFileSync(path.join(c, 'extra', `a${i}.md`), 'x\n');
  });
  caso('placeholder', undefined, (c) => fs.appendFileSync(path.join(c, 'skills/core/onboarding/SKILL.md'), '\n{{ork_bin}}\n'));
  caso('readme.contagem', /19 e a pasta tem 20/, (c) => edita(path.join(c, 'README.md'), (t) => t.replace('| 20 skills |', '| 19 skills |')));
  caso('readme.link', /fora da pasta/, (c) => fs.appendFileSync(path.join(c, 'README.md'), '\nVeja [o guia](../../README.md).\n'));
  caso('skill.nome', /diferente da pasta/, (c) => edita(path.join(c, 'skills/core/onboarding/SKILL.md'), (t) => t.replace(/^name: .*$/m, 'name: outro')));
  caso('frontmatter.descricao', /aspas/, (c) => edita(path.join(c, 'agents/ork-goal.md'), (t) => t.replace(/^description: ".*"$/m, 'description: Conduz a fase GOAL: sem aspas')));

  const fm = (d: string) => gen.problemaDoFrontmatter(`name: x\ndescription: ${d}`);
  assert.equal(fm('"a: b"'), null);
  assert.equal(fm("'It''s ok'"), null);
  assert.match(String(fm('a: b')), /aspas/);
  assert.match(String(fm('termina em:')), /aspas/);
  assert.match(String(fm('"sem fechar')), /sem fechar/);
  assert.match(String(fm("'It's'")), /depois das aspas/);
  assert.match(String(fm('"a \\d b"')), /escape/);
  assert.match(String(fm('123')), /texto/);
  assert.match(String(fm('{a: 1}')), /texto/);
  assert.match(String(fm('a'.repeat(1025))), /1024/);
  assert.match(String(gen.problemaDoFrontmatter('name: x\nname: y\ndescription: z')), /repetida/);
  assert.match(String(gen.problemaDoFrontmatter('name: x\ndescription: z\nmeta:\n\tchave: 1')), /tab/);
  assert.match(String(gen.problemaDoFrontmatter('name: x')), /description/);
});

test('S3 a pasta Codex traz a entrada ork renderizada, as skills do catalogo e a interface do manifesto', () => {
  const pasta = path.join(RAIZ, gen.DESTINOS.codex);
  const p = json(path.join(pasta, '.codex-plugin/plugin.json'));
  assert.equal(p.name, path.basename(pasta));
  assert.equal(p.skills, './skills/');
  assert.ok(p.interface.defaultPrompt.length >= 1 && p.interface.defaultPrompt.length <= 3);
  const entrada = fs.readFileSync(path.join(pasta, 'skills/ork/SKILL.md'), 'utf8');
  assert.ok(fs.readFileSync(path.join(RAIZ, 'adapters/codex/skills/ork/SKILL.md'), 'utf8').includes('{{ork_bin}}'));
  assert.equal(entrada.includes('{{'), false, 'placeholder renderizado');
  assert.ok(entrada.includes('este caminho: `ork`'));
  const skills = fs.readdirSync(path.join(pasta, 'skills'), { recursive: true }).map(String).filter((f) => f.endsWith('SKILL.md'));
  assert.equal(skills.length, skillsDoCatalogo(RAIZ).length + 1);
  assert.deepEqual(gen.conferirPastaCodex(pasta, RAIZ), []);

  const caso = (codigo: string, detalhe: RegExp | undefined, mexe: (m: Record<string, any>) => void) => comCopia((dir) => {
    const x = path.join(dir, gen.DESTINOS.codex);
    edita(path.join(x, '.codex-plugin/plugin.json'), (t) => { const m = JSON.parse(t); mexe(m); return JSON.stringify(m); });
    const achados = gen.conferirPastaCodex(x, dir);
    assert.ok(temAchado(achados, codigo, detalhe), `${codigo} ${detalhe ?? ''}: ${JSON.stringify(achados)}`);
  });
  caso('manifesto.caminho', /skills/, (m) => { m.skills = './outra/'; });
  caso('componente.executavel', /hooks/, (m) => { m.hooks = './hooks.json'; });
  caso('componente.executavel', /mcpServers/, (m) => { m.mcpServers = './.mcp.json'; });
  caso('interface.campos', /privacyPolicyURL/, (m) => { m.interface.privacyPolicyURL = 'http://exemplo.com/privacidade'; });
  caso('interface.campos', /developerName/, (m) => { delete m.interface.developerName; });
  caso('interface.imagem', /logo/, (m) => { m.interface.logo = './assets/nao-existe.png'; });
  caso('interface.imagem', /screenshots/, (m) => { m.interface.screenshots = ['./assets/composer-icon.svg']; });
});

test('S4 os marketplaces proprios da raiz apontam para as pastas geradas com o nome do manifesto', () => {
  const c = json(path.join(RAIZ, gen.DESTINOS.marketplaceClaude));
  const x = json(path.join(RAIZ, gen.DESTINOS.marketplaceCodex));
  assert.equal(c.plugins[0].source, `./${gen.DESTINOS.claude}`);
  assert.deepEqual(x.plugins[0].source, { source: 'local', path: `./${gen.DESTINOS.codex}` });
  assert.deepEqual(gen.conferirMarketplaces(RAIZ), []);
  assert.deepEqual(gen.conferirTextosDoRepositorio(RAIZ), []);

  const caso = (codigo: string, detalhe: RegExp, qual: 'marketplaceClaude' | 'marketplaceCodex', mexe: (m: Record<string, any>) => void) => comCopia((dir) => {
    edita(path.join(dir, gen.DESTINOS[qual]), (t) => { const m = JSON.parse(t); mexe(m); return JSON.stringify(m); });
    const achados = gen.conferirMarketplaces(dir);
    assert.ok(temAchado(achados, codigo, detalhe), `${codigo} ${detalhe}: ${JSON.stringify(achados)}`);
  });
  caso('marketplace.claude', /manifesto/, 'marketplaceClaude', (m) => { m.plugins[0].name = 'outro'; });
  caso('marketplace.claude', /source/, 'marketplaceClaude', (m) => { m.plugins[0].source = './../fora'; });
  caso('marketplace.claude', /owner/, 'marketplaceClaude', (m) => { delete m.owner; });
  caso('marketplace.codex', /manifesto/, 'marketplaceCodex', (m) => { m.plugins[0].name = 'outro'; });
  caso('marketplace.codex', /source/, 'marketplaceCodex', (m) => { m.plugins[0].source.path = '../fora'; });
  caso('marketplace.codex', /policy/, 'marketplaceCodex', (m) => { m.plugins[0].policy.installation = 'SEMPRE'; });
  caso('marketplace.codex', /category/, 'marketplaceCodex', (m) => { m.plugins[0].category = ''; });

  comCopia((dir) => {
    edita(path.join(dir, 'marketplaces/README.md'), (t) => t.replace('20 skills, 8 comandos', '19 skills, 8 comandos'));
    assert.ok(temAchado(gen.conferirTextosDoRepositorio(dir), 'readme.contagem', /19 skills/));
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'core/ export-ignore\n');
    assert.ok(temAchado(gen.conferirTextosDoRepositorio(dir), 'repo.gitattributes', /export-ignore/));
  });
});

test('S5 a conferencia recusa .ico, README curto, pasta hooks, defaultPrompt longo, cor fora do hex e travessao', () => {
  const caso = (codigo: string, fn: (c: string, x: string) => Achado[]) => comCopia((dir) => {
    const achados = fn(path.join(dir, gen.DESTINOS.claude), path.join(dir, gen.DESTINOS.codex));
    assert.ok(temAchado(achados, codigo), `${codigo}: ${JSON.stringify(achados)}`);
  });
  const manifestoCodex = (x: string, f: (m: Record<string, any>) => void) =>
    edita(path.join(x, '.codex-plugin/plugin.json'), (t) => { const m = JSON.parse(t); f(m); return JSON.stringify(m); });
  caso('arquivo.tipo', (c) => {
    fs.copyFileSync(path.join(RAIZ, 'docs/assets/marca/favicon/favicon.ico'), path.join(c, 'assets/favicon.ico'));
    return gen.conferirPastaClaude(c);
  });
  caso('readme.curto', (c) => {
    fs.writeFileSync(path.join(c, 'README.md'), '# Orkastery\n\nPoucas palavras aqui.\n\n```bash\n' + 'palavra '.repeat(80) + '\n```\n');
    return gen.conferirPastaClaude(c);
  });
  caso('componente.executavel', (c) => {
    fs.mkdirSync(path.join(c, 'hooks'));
    fs.writeFileSync(path.join(c, 'hooks/hooks.json'), '{"hooks":{}}\n');
    return gen.conferirPastaClaude(c);
  });
  caso('interface.prompt', (_c, x) => { manifestoCodex(x, (m) => { m.interface.defaultPrompt = ['p'.repeat(129)]; }); return gen.conferirPastaCodex(x); });
  caso('interface.prompt', (_c, x) => { manifestoCodex(x, (m) => { m.interface.defaultPrompt = ['a', 'b', 'c', 'd']; }); return gen.conferirPastaCodex(x); });
  caso('interface.cor', (_c, x) => { manifestoCodex(x, (m) => { m.interface.brandColor = 'latao'; }); return gen.conferirPastaCodex(x); });
  caso('texto.travessao', (_c, x) => {
    fs.appendFileSync(path.join(x, 'README.md'), `\nUm travessao ${String.fromCharCode(0x2014)} aqui.\n`);
    return gen.conferirPastaCodex(x);
  });
});

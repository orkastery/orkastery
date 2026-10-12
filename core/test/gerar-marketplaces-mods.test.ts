/**
 * RM-059 (T0.8): os mods do Claude Code entram no marketplace proprio pelo gerador. Os mods de verdade
 * chegam por outra thread: cada caso roda numa copia temporaria do repositorio com o mod de exemplo de
 * `core/test/fixtures/mods/ork-exemplo` em `adapters/claude-code/mods/`, sem rede e sem `claude`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exigirCatalogo } from '../src/catalogo';

interface Achado { codigo: string; arquivo: string; detalhe: string }
interface Gerador {
  DESTINOS: { claude: string; codex: string; marketplaceClaude: string; marketplaceCodex: string; mods: string };
  MODS: string;
  gerar(raiz: string): Map<string, Buffer>;
  verificar(raiz: string): Achado[];
  escrever(raiz: string): number;
  conferirMods(raiz: string): Achado[];
  problemaDaDeclaracao(texto: string): string | null;
}

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gen: Gerador = require(path.join(RAIZ, 'core', 'scripts', 'gerar-marketplaces.cjs'));
const EXEMPLO = path.join(RAIZ, 'core', 'test', 'fixtures', 'mods', 'ork-exemplo');

/** O que o gerador le e escreve, copiado para uma raiz temporaria, sem os mods que o repositorio tiver. */
const PARTES = [
  'skills', 'references', 'adapters/claude-code/.claude-plugin', 'adapters/claude-code/commands',
  'adapters/claude-code/agents', 'adapters/codex', 'docs/assets/marca', 'marketplaces', '.claude-plugin',
  '.agents/plugins', 'LICENSE', 'core/package.json',
];

function comCopia<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-marketplaces-mods-'));
  try {
    for (const parte of PARTES) fs.cpSync(path.join(RAIZ, parte), path.join(dir, parte), { recursive: true });
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Poe o mod de exemplo em `adapters/claude-code/mods/<nome>`, com o nome no manifesto. */
function comMod(dir: string, nome: string): string {
  const alvo = path.join(dir, gen.MODS, nome);
  fs.cpSync(EXEMPLO, alvo, { recursive: true });
  const arquivo = path.join(alvo, '.claude-plugin', 'plugin.json');
  fs.writeFileSync(arquivo, JSON.stringify({ ...JSON.parse(fs.readFileSync(arquivo, 'utf8')), name: nome }, null, 2) + '\n');
  return alvo;
}

const json = (arquivo: string) => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const edita = (arquivo: string, f: (v: Record<string, unknown>) => unknown) => fs.writeFileSync(arquivo, JSON.stringify(f(json(arquivo))) + '\n');
const temAchado = (achados: Achado[], codigo: string, detalhe?: RegExp) =>
  achados.some((a) => a.codigo === codigo && (!detalhe || detalhe.test(a.detalhe)));

test('S1 sem mods o marketplace gerado tem so o plugin, com o resto igual ao do HEAD, e a conferencia fica limpa', () => {
  comCopia((dir) => {
    const antes = json(path.join(dir, gen.DESTINOS.marketplaceClaude));
    gen.escrever(dir);
    const depois = json(path.join(dir, gen.DESTINOS.marketplaceClaude));
    assert.deepEqual(depois.plugins, [antes.plugins[0]]);
    assert.deepEqual({ ...depois, plugins: [] }, { ...antes, plugins: [] });
    fs.mkdirSync(path.join(dir, gen.MODS), { recursive: true });
    assert.deepEqual(gen.verificar(dir), [], 'pasta de mods vazia nao muda nada');
    assert.equal(fs.existsSync(path.join(dir, gen.DESTINOS.mods)), false, 'sem mods, nenhuma copia');
  });
});

test('S2 cada mod vira uma entrada que aponta para a copia gerada dele, com nome e descricao do manifesto do mod', () => {
  comCopia((dir) => {
    comMod(dir, 'ork-exemplo');
    comMod(dir, 'ork-segundo');
    const antes = gen.verificar(dir);
    assert.ok(temAchado(antes, 'deriva.diferente', /gerar-marketplaces/), 'mod novo sem regenerar reprova pela deriva');
    gen.escrever(dir);
    assert.deepEqual(gen.verificar(dir), []);
    const m = json(path.join(dir, gen.DESTINOS.marketplaceClaude));
    const listagem = json(path.join(dir, 'marketplaces', 'fontes', 'listagem.json'));
    assert.equal(m.plugins[0].name, 'orkastery');
    assert.deepEqual(m.plugins.slice(1), ['ork-exemplo', 'ork-segundo'].map((nome) => ({
      name: nome,
      source: `./${gen.DESTINOS.mods}/${nome}`,
      description: json(path.join(dir, gen.MODS, nome, '.claude-plugin', 'plugin.json')).description,
      category: listagem.mods.category,
      homepage: listagem.homepage,
    })));
    const pasta = path.join(dir, gen.DESTINOS.claude);
    assert.equal(fs.readdirSync(pasta).includes('mods'), false, 'a pasta do diretorio da Anthropic nao leva mod');
    for (const arquivo of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.js', 'orkastery-mod.json', 'test/exemplo.test.tsx']) {
      const copia = path.join(dir, gen.DESTINOS.mods, 'ork-exemplo', arquivo);
      assert.ok(fs.readFileSync(copia).equals(fs.readFileSync(path.join(dir, gen.MODS, 'ork-exemplo', arquivo))), arquivo);
    }
  });
});

test('S2b arquivo comum na raiz de mods/ e compartilhado: vai dentro de cada copia; oculto e ignorado; colisao com o mod aponta', () => {
  comCopia((dir) => {
    comMod(dir, 'ork-exemplo');
    comMod(dir, 'ork-ponte');
    // A lista de autoridade da ponte mora na raiz de mods/ (D6 da thread dela); o marketplace instala so a pasta do mod.
    fs.writeFileSync(path.join(dir, gen.MODS, 'autoridade.json'), '{"formato":"ork.mods-autoridade/v1"}\n');
    fs.writeFileSync(path.join(dir, gen.MODS, '.gitkeep'), '');
    gen.escrever(dir);
    assert.deepEqual(gen.verificar(dir), [], 'arquivo comum e oculto na raiz nao reprovam');
    for (const mod of ['ork-exemplo', 'ork-ponte']) {
      const copia = path.join(dir, gen.DESTINOS.mods, mod);
      assert.equal(fs.readFileSync(path.join(copia, 'autoridade.json'), 'utf8'), '{"formato":"ork.mods-autoridade/v1"}\n', mod);
      assert.equal(fs.existsSync(path.join(copia, '.gitkeep')), false, mod);
    }
    fs.writeFileSync(path.join(dir, gen.MODS, 'ork-ponte', 'autoridade.json'), '{"proprio":true}\n');
    gen.escrever(dir);
    assert.ok(temAchado(gen.verificar(dir), 'mod.compartilhado', /vale o do mod/));
    assert.equal(fs.readFileSync(path.join(dir, gen.DESTINOS.mods, 'ork-ponte', 'autoridade.json'), 'utf8'), '{"proprio":true}\n');
    fs.symlinkSync('autoridade.json', path.join(dir, gen.MODS, 'atalho.json'));
    gen.escrever(dir);
    assert.ok(temAchado(gen.verificar(dir), 'arquivo.link', /symlink/));
  });
});

test('S3 cada regra da declaracao e do manifesto do mod reprova sozinha', () => {
  const casos: Array<[string, (mod: string) => void, string, RegExp]> = [
    ['sem declaracao', (mod) => fs.rmSync(path.join(mod, 'orkastery-mod.json')), 'mod.declaracao', /ausente/],
    ['formato', (mod) => edita(path.join(mod, 'orkastery-mod.json'), (d) => ({ ...d, formato: 'ork.mod/v2' })), 'mod.declaracao', /ork\.mod\/v1/],
    ['papel', (mod) => edita(path.join(mod, 'orkastery-mod.json'), (d) => ({ ...d, papeis: ['revisor'] })), 'mod.declaracao', /dono e fase/],
    ['papel repetido', (mod) => edita(path.join(mod, 'orkastery-mod.json'), (d) => ({ ...d, papeis: ['fase', 'fase'] })), 'mod.declaracao', /sem repeticao/],
    ['versao velha', (mod) => edita(path.join(mod, 'orkastery-mod.json'), (d) => ({ ...d, claudeCodeMinimo: '2.1.286' })), 'mod.declaracao', /abaixo de 2\.1\.287/],
    ['versao sem formato', (mod) => edita(path.join(mod, 'orkastery-mod.json'), (d) => ({ ...d, claudeCodeMinimo: '2.1' })), 'mod.declaracao', /X\.Y\.Z/],
    ['nome diferente da pasta', (mod) => edita(path.join(mod, '.claude-plugin', 'plugin.json'), (p) => ({ ...p, name: 'outro-nome' })), 'mod.manifesto', /diferente da pasta/],
    ['sem descricao', (mod) => edita(path.join(mod, '.claude-plugin', 'plugin.json'), (p) => ({ ...p, description: '' })), 'mod.manifesto', /description ausente/],
    ['sem modules', (mod) => fs.writeFileSync(path.join(mod, 'hooks', 'hooks.json'), '{"hooks":{}}\n'), 'mod.manifesto', /modules ausente/],
    ['tipos do motor', (mod) => {
      fs.mkdirSync(path.join(mod, '.claude-plugin', 'types', 'claude-code'), { recursive: true });
      fs.writeFileSync(path.join(mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'), 'export type X = 1;\n');
    }, 'mod.tipos-do-motor', /nao entram no catalogo/],
    ['link', (mod) => fs.symlinkSync('register.js', path.join(mod, 'hooks', 'atalho.js')), 'arquivo.link', /symlink/],
  ];
  for (const [nome, estraga, codigo, detalhe] of casos) {
    comCopia((dir) => {
      const mod = comMod(dir, 'ork-exemplo');
      estraga(mod);
      gen.escrever(dir);
      const achados = gen.verificar(dir);
      assert.ok(temAchado(achados, codigo, detalhe), `${nome}: ${JSON.stringify(achados)}`);
    });
  }
});

test('S4 entrada de mod escrita a mao no marketplace e listagem sem categoria de mod reprovam', () => {
  comCopia((dir) => {
    comMod(dir, 'ork-exemplo');
    gen.escrever(dir);
    const arquivo = path.join(dir, gen.DESTINOS.marketplaceClaude);
    const m = json(arquivo);
    m.plugins[1].source = './adapters/claude-code/mods/../mods/ork-exemplo';
    fs.writeFileSync(arquivo, JSON.stringify(m, null, 2) + '\n');
    assert.ok(temAchado(gen.verificar(dir), 'deriva.diferente'), 'o JSON e gerado: editar a mao e deriva');
    gen.escrever(dir);
    edita(path.join(dir, 'marketplaces', 'fontes', 'listagem.json'), (l) => ({ ...l, mods: undefined }));
    gen.escrever(dir);
    assert.ok(temAchado(gen.verificar(dir), 'mod.listagem', /mods\.category/));
  });
});

test('S5 a regra da declaracao no catalogo (o despacho aplica o piso de 2.1.287 por conta propria)', () => {
  assert.equal(gen.problemaDaDeclaracao('{"formato":"ork.mod/v1","papeis":["dono","fase"],"claudeCodeMinimo":"2.1.287"}'), null);
  assert.equal(gen.problemaDaDeclaracao('{"formato":"ork.mod/v1","papeis":["fase"],"claudeCodeMinimo":"3.0.0"}'), null);
  assert.match(gen.problemaDaDeclaracao('{"formato":"ork.mod/v1","papeis":[],"claudeCodeMinimo":"2.1.287"}') ?? '', /papeis/);
  assert.match(gen.problemaDaDeclaracao('nao e json') ?? '', /JSON/);
});

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario, semManutencaoAutomaticaDoGit } from './apoio';

// RM-050: que pagina do site uma mudanca neste repositorio deixa para revisar.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/checar-fontes-do-site.cjs');
const { checarFontesDoSite, inventario } = require(SCRIPT);

semManutencaoAutomaticaDoGit();

const sha = (texto: string) => crypto.createHash('sha256').update(texto).digest('hex');

interface Fonte { path: string; sha256: string; category: string; treatment: string; targets: string[] }

const ARVORE: Record<string, string> = {
  'CONTRIBUTING.md': '# Contribuindo\n',
  'README.md': '# Orkastery\n',
  'core/package.json': '{"version":"0.5.3"}\n',
  'docs/guias/contribuir/triagem.md': '# Triagem\n',
  'docs/roadmap/RM-050.md': '# RM-050\n',
  'docs/roadmap/evidencias/ensaio.json': '{}\n',
  // Fora do inventario do site: outra extensao em docs/ e codigo fora de docs/.
  'docs/assets/logo.svg': '<svg/>',
  'core/src/x.ts': 'export {};\n',
};

/** As paginas de cada fonte, como o `docs:sync` do site grava em `targets`. */
const PAGINAS: Record<string, { pagina: string; tratamento: string }> = {
  'CONTRIBUTING.md': { pagina: 'contribuir', tratamento: 'article' },
  'README.md': { pagina: 'comecar', tratamento: 'article' },
  'core/package.json': { pagina: 'comecar', tratamento: 'article' },
  'docs/guias/contribuir/triagem.md': { pagina: 'contribuir', tratamento: 'article' },
  'docs/roadmap/RM-050.md': { pagina: 'roadmap', tratamento: 'roadmap' },
  'docs/roadmap/evidencias/ensaio.json': { pagina: 'roadmap', tratamento: 'roadmap' },
};

/** O snapshot como o site grava: fontes em ordem e o inventoryHash sobre elas. */
function snapshotDe(arquivos: Record<string, string>, extras: Fonte[] = [], produto = 'orkastery') {
  const fontes: Fonte[] = Object.keys(PAGINAS)
    .filter((p) => p in arquivos)
    .sort()
    .map((p) => ({ path: p, sha256: sha(arquivos[p]), category: p.split('/')[1] ?? 'root', treatment: PAGINAS[p].tratamento, targets: [PAGINAS[p].pagina] }));
  const sources = [...fontes, ...extras].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { schemaVersion: 1, product: produto, sources, inventoryHash: sha(JSON.stringify(sources)), reviews: {} };
}

function escrever(raiz: string, arquivos: Record<string, string>): void {
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), conteudo);
  }
}

function comArvore(arquivos: Record<string, string>, corpo: (raiz: string) => void): void {
  const raiz = dirTemporario('fontes-site');
  try {
    escrever(raiz, arquivos);
    corpo(raiz);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

/** Roda o script como quem chama da linha de comando, com o snapshot num arquivo ou na entrada. */
function rodar(raiz: string, snapshot: unknown, ...args: string[]) {
  const arquivo = path.join(raiz, '.snapshot-do-teste.json');
  fs.writeFileSync(arquivo, typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot));
  try {
    return spawnSync(process.execPath, [SCRIPT, '--snapshot', arquivo, '--raiz', raiz, ...args], { encoding: 'utf8' });
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
}

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@orkastery.local', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

test('o inventario espelha o do site: md e json de docs/ e os arquivos de raiz do produto', () => {
  comArvore({ ...ARVORE, 'README.pt-BR.md': '# Orkastery\n', 'pyproject.toml': '[project]\n' }, (raiz) => {
    assert.deepEqual(inventario(raiz, 'orkastery').map((f: { caminho: string }) => f.caminho), [
      'CONTRIBUTING.md',
      'README.md',
      'core/package.json',
      'docs/guias/contribuir/triagem.md',
      'docs/roadmap/RM-050.md',
      'docs/roadmap/evidencias/ensaio.json',
    ]);
    const doOrkmind = inventario(raiz, 'orkmind').map((f: { caminho: string }) => f.caminho);
    assert.ok(doOrkmind.includes('README.pt-BR.md') && doOrkmind.includes('pyproject.toml'));
    assert.ok(!doOrkmind.includes('core/package.json'), 'core/package.json é fonte só do produto orkastery');
    const contribuir = inventario(raiz, 'orkastery').find((f: { caminho: string }) => f.caminho === 'CONTRIBUTING.md');
    assert.equal(contribuir.sha256, sha('# Contribuindo\n'), 'o hash é o do conteúdo, como o site calcula');
  });
});

test('em dia: sai 0 e diz que nada falta revisar', () => {
  comArvore(ARVORE, (raiz) => {
    const r = rodar(raiz, snapshotDe(ARVORE));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nenhuma fonte a revisar/);
    assert.equal(checarFontesDoSite(raiz, snapshotDe(ARVORE)).emDia, true);
  });
});

test('fonte mudada aponta a pagina, fonte nova fica sem pagina e fonte removida aparece', () => {
  const removida: Fonte = { path: 'docs/guias/apagado.md', sha256: sha('velho'), category: 'guias', treatment: 'article', targets: ['padroes'] };
  const snapshot = snapshotDe(ARVORE, [removida]);
  comArvore({ ...ARVORE, 'CONTRIBUTING.md': '# Contribuindo\n\nCaminho curto.\n', 'docs/guias/novo.md': '# Novo\n' }, (raiz) => {
    const r = checarFontesDoSite(raiz, snapshot);
    assert.equal(r.emDia, false);
    assert.deepEqual(r.fontes.map((f: { caminho: string; estado: string }) => `${f.estado} ${f.caminho}`), [
      'mudada CONTRIBUTING.md',
      'removida docs/guias/apagado.md',
      'nova docs/guias/novo.md',
    ]);
    assert.deepEqual(r.paginas, [
      { pagina: 'contribuir', fontes: ['CONTRIBUTING.md'] },
      { pagina: 'padroes', fontes: ['docs/guias/apagado.md'] },
    ]);
    assert.deepEqual(r.semPagina, ['docs/guias/novo.md']);

    const cli = rodar(raiz, snapshot);
    assert.equal(cli.status, 1, 'defasagem sai 1');
    assert.match(cli.stdout, /^contribuir \(1\)$/m);
    assert.match(cli.stdout, /^sem página \(1\)$/m);
    assert.match(cli.stdout, /2 página\(s\) a revisar, 1 fonte\(s\) mudada\(s\), 1 nova\(s\), 1 removida\(s\)/);
    assert.match(cli.stdout, /^Páginas: contribuir,padroes$/m);
  });
});

test('fonte de roadmap mudada sai marcada pelo tratamento, que o site revisa por mes', () => {
  const snapshot = snapshotDe(ARVORE);
  comArvore({ ...ARVORE, 'docs/roadmap/RM-050.md': '# RM-050\n\nPiloto.\n' }, (raiz) => {
    const r = rodar(raiz, snapshot);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /mudada {3}docs\/roadmap\/RM-050\.md {2}\(tratamento roadmap\)/);
  });
});

test('--json devolve o resultado inteiro, com a mesma saida 1 da defasagem', () => {
  const snapshot = snapshotDe(ARVORE);
  comArvore({ ...ARVORE, 'docs/guias/contribuir/triagem.md': '# Triagem\n\nRótulos.\n' }, (raiz) => {
    const r = rodar(raiz, snapshot, '--json');
    assert.equal(r.status, 1);
    const json = JSON.parse(r.stdout);
    assert.equal(json.produto, 'orkastery');
    assert.equal(json.fontesNoSnapshot, 6);
    assert.deepEqual(json.paginas, [{ pagina: 'contribuir', fontes: ['docs/guias/contribuir/triagem.md'] }]);
  });
});

test('--snapshot - le o snapshot da entrada padrao', () => {
  comArvore(ARVORE, (raiz) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--snapshot', '-', '--raiz', raiz],
      { encoding: 'utf8', input: JSON.stringify(snapshotDe(ARVORE)) });
    assert.equal(r.status, 0, r.stderr);
  });
});

test('--base lista so o que a mudanca tocou desde que saiu da base, mesmo com a base andando depois', () => {
  comArvore(ARVORE, (raiz) => {
    // O site revisou um README mais antigo: o README de hoje ja esta defasado, mas nao e da mudanca.
    const snapshot = snapshotDe({ ...ARVORE, 'README.md': '# Orkastery antigo\n' });
    git(raiz, 'init', '-q', '-b', 'main');
    git(raiz, 'add', '--', ...Object.keys(ARVORE));
    git(raiz, 'commit', '-q', '-m', 'base');
    git(raiz, 'checkout', '-q', '-b', 'pr');
    // A main anda depois que a mudanca saiu dela: o README muda la, e nao na branch.
    git(raiz, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Orkastery\n\nOutro texto.\n');
    git(raiz, 'commit', '-q', '-am', 'readme na main');
    git(raiz, 'checkout', '-q', 'pr');
    // A mudanca do PR: triagem editada, RM-050 renomeado e um guia novo ainda fora do indice.
    fs.writeFileSync(path.join(raiz, 'docs/guias/contribuir/triagem.md'), '# Triagem\n\nPrazo.\n');
    git(raiz, 'mv', 'docs/roadmap/RM-050.md', 'docs/roadmap/RM-050-guia.md');
    escrever(raiz, { 'docs/guias/contribuir/novo.md': '# Novo\n' });

    const r = rodar(raiz, snapshot, '--base', 'main', '--json');
    assert.equal(r.status, 1, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.restrito, true);
    assert.equal(json.base, 'main');
    assert.equal(json.partida, git(raiz, 'merge-base', 'main', 'pr').trim(), 'a partida e o merge-base, nao a ponta da main');
    assert.deepEqual(json.fontes.map((f: { caminho: string; estado: string }) => `${f.estado} ${f.caminho}`), [
      'nova docs/guias/contribuir/novo.md',
      'mudada docs/guias/contribuir/triagem.md',
      'nova docs/roadmap/RM-050-guia.md',
      'removida docs/roadmap/RM-050.md',
    ]);
    assert.ok(!json.fontes.some((f: { caminho: string }) => f.caminho === 'README.md'), 'o que a main mudou depois da partida nao e da mudanca');

    // Sem --base, o README defasado aparece: a lista e tudo o que o site ainda nao revisou.
    const tudo = JSON.parse(rodar(raiz, snapshot, '--json').stdout);
    assert.ok(tudo.fontes.some((f: { caminho: string }) => f.caminho === 'README.md'));

    // Com tudo commitado, a mesma pergunta contra o HEAD nao acha mudanca.
    git(raiz, 'add', '--', 'docs/guias/contribuir/novo.md', 'docs/guias/contribuir/triagem.md');
    git(raiz, 'commit', '-q', '-m', 'pr');
    const semMudanca = rodar(raiz, snapshot, '--base', 'HEAD');
    assert.equal(semMudanca.status, 0, semMudanca.stdout);
    assert.match(semMudanca.stdout, /Só os arquivos mudados desde que a mudança saiu de HEAD \([0-9a-f]{8}\)\.\nNenhuma fonte a revisar/);

    // Base sem historia em comum com o HEAD nao tem ponto de partida: erro de uso.
    git(raiz, 'checkout', '-q', '--orphan', 'solta');
    git(raiz, 'commit', '-q', '-m', 'solta');
    git(raiz, 'checkout', '-q', 'pr');
    const solta = rodar(raiz, snapshot, '--base', 'solta');
    assert.equal(solta.status, 2, solta.stdout);
    assert.match(solta.stderr, /sem ponto em comum com o HEAD/);
  });
});

test('erro de uso e snapshot invalido saem 2, sem relatorio', () => {
  comArvore(ARVORE, (raiz) => {
    const valido = snapshotDe(ARVORE);
    const casos: Array<[unknown, string[], RegExp]> = [
      [{ ...valido, schemaVersion: 2 }, [], /schemaVersion 1/],
      [{ ...valido, inventoryHash: sha('outra coisa') }, [], /inventoryHash não confere/],
      [{ ...valido, sources: [{ path: 'README.md', sha256: 'curto' }] }, [], /sem path ou sem sha256/],
      ['{ quebrado', [], /não é JSON/],
      [valido, ['--base', 'ref-que-nao-existe'], /o git não conhece esse commit/],
      [valido, ['--opcao-que-nao-existe'], /opção desconhecida/],
    ];
    for (const [snapshot, args, erro] of casos) {
      const r = rodar(raiz, snapshot, ...args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}`);
      assert.match(r.stderr, erro);
      assert.equal(r.stdout, '');
    }
    const semSnapshot = spawnSync(process.execPath, [SCRIPT, '--raiz', raiz], { encoding: 'utf8' });
    assert.equal(semSnapshot.status, 2);
    assert.match(semSnapshot.stderr, /falta --snapshot/);
  });
});

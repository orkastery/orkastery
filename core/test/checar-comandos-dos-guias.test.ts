import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// RM-050: o checador dos guias de contribuicao roda os blocos bash e confere o que so e citado.
const raizDoRepo = path.resolve(__dirname, '../../..');
const { checarGuias } = require(path.join(raizDoRepo, 'core/scripts/checar-comandos-dos-guias.cjs'));

/** Ajuda minima no formato do CLI: duas colunas de espaco, comando e subcomando. */
const AJUDA = [
  '  docs verificar [--json]           Documentacao contra o codigo',
  '  docs init                         Cria padroes e modelos',
  '  verify <thread-id> [--baseline]   Reexecuta claims',
  '  eval [--skill S]                  Canarios',
].join('\n');

const TRIAGEM = '# Triagem\n\n| Rótulo | Quando |\n| --- | --- |\n| `bug` | defeito |\n';

function comFixture(arquivos: Record<string, string>, corpo: (raiz: string) => void): void {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-guias-'));
  const base: Record<string, string> = {
    'core/package.json': JSON.stringify({ scripts: { build: 'tsc', 'test:ci': 'node x' } }),
    'docs/guias/contribuir/triagem.md': TRIAGEM,
    'CONTRIBUTING.md': '# Contribuindo\n',
  };
  try {
    for (const [rel, conteudo] of Object.entries({ ...base, ...arquivos })) {
      fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
      fs.writeFileSync(path.join(raiz, rel), conteudo);
    }
    corpo(raiz);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

const checar = (raiz: string) => checarGuias(raiz, { ajuda: AJUDA });

test('bloco bash roda, bloco citado nao roda, e o que e declarado passa', () => {
  const guia = [
    '# Guia',
    '',
    'Rode `ork docs verificar` e, com a thread, `ork verify <thread>`.',
    '',
    '```bash',
    '# comentario nao roda',
    'true',
    'echo um \\',
    '  dois',
    '```',
    '',
    '<!-- checagem: citado -->',
    '```bash',
    'false',
    'npm --prefix core run build',
    '```',
    '',
    '```text',
    'ork eval --skill goal-definition',
    '```',
  ].join('\n');
  comFixture({
    'docs/guias/contribuir/guia.md': guia,
    '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\nlabels: ["bug"]\n',
    '.github/ISSUE_TEMPLATE/config.yml': 'url: https://github.com/orkastery/orkastery/blob/main/docs/guias/contribuir/triagem.md\n',
  }, (raiz) => {
    const r = checar(raiz);
    assert.deepEqual(r.falhas, []);
    assert.equal(r.rodados, 2, 'true e o echo de duas linhas');
    assert.equal(r.citados, 3, 'o bloco citado e o bloco text');
  });
});

test('linha de bloco bash que falha reprova com o arquivo e a linha', () => {
  comFixture({ 'docs/guias/contribuir/guia.md': '# Guia\n\n```bash\ntrue\nfalse\n```\n' }, (raiz) => {
    const r = checar(raiz);
    assert.equal(r.falhas.length, 1);
    assert.match(r.falhas[0], /^docs\/guias\/contribuir\/guia\.md:5: "false" saiu 1/);
  });
});

test('ork nao declarado e script npm inexistente reprovam, ate em bloco citado', () => {
  const guia = [
    '# Guia',
    '',
    'Nao existe `ork publicar`.',
    '',
    '<!-- checagem: citado -->',
    '```bash',
    'ork docs publicar && npm --prefix core run lint',
    '```',
  ].join('\n');
  comFixture({ 'docs/guias/contribuir/guia.md': guia }, (raiz) => {
    const r = checar(raiz);
    assert.equal(r.rodados, 0);
    assert.deepEqual(r.falhas, [
      'docs/guias/contribuir/guia.md:3: o CLI não declara "ork publicar"',
      'docs/guias/contribuir/guia.md:7: o CLI não declara "ork docs publicar"',
      'docs/guias/contribuir/guia.md:7: core/package.json não tem o script "lint"',
    ]);
  });
});

test('rotulo fora da tabela da triagem e link para caminho inexistente reprovam', () => {
  comFixture({
    'docs/guias/contribuir/guia.md': '# Guia\n',
    '.github/ISSUE_TEMPLATE/ideia.yml': 'name: Ideia\nlabels: ["ideia", "bug"]\n',
    '.github/ISSUE_TEMPLATE/doc.yml': 'name: Doc\nlabels:\n  - bug\n  - documentação\nbody: []\n',
    '.github/ISSUE_TEMPLATE/config.yml': 'url: https://github.com/orkastery/orkastery/blob/main/docs/nao-existe.md\n',
  }, (raiz) => {
    const r = checar(raiz);
    assert.deepEqual(r.falhas.sort(), [
      '.github/ISSUE_TEMPLATE/config.yml: o link aponta para docs/nao-existe.md, que não existe',
      '.github/ISSUE_TEMPLATE/doc.yml: o rótulo "documentação" não está na tabela de docs/guias/contribuir/triagem.md',
      '.github/ISSUE_TEMPLATE/ideia.yml: o rótulo "ideia" não está na tabela de docs/guias/contribuir/triagem.md',
    ]);
  });
});

test('sem guia na pasta de contribuicao a checagem reprova', () => {
  comFixture({}, (raiz) => {
    fs.rmSync(path.join(raiz, 'docs/guias/contribuir'), { recursive: true });
    assert.deepEqual(checar(raiz).falhas, ['docs/guias/contribuir: nenhum guia encontrado']);
  });
});

test('os guias e os modelos desta arvore citam so o que existe', () => {
  // Sem rodar os blocos: rodar aqui rodaria a propria suite. A claim da thread roda o script inteiro.
  const r = checarGuias(raizDoRepo, { executar: false });
  assert.deepEqual(r.falhas, []);
  assert.ok(r.rodados > 0, 'os guias tem blocos bash que a checagem roda');
});

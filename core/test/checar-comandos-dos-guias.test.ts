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

const checar = (raiz: string, opcoes: Record<string, unknown> = {}) => checarGuias(raiz, { ajuda: AJUDA, ...opcoes });
const guia = (...linhas: string[]) => ({ 'docs/guias/contribuir/guia.md': ['# Guia', '', ...linhas, ''].join('\n') });

test('bloco bash roda, bloco citado nao roda, e o que e declarado passa', () => {
  comFixture({
    ...guia(
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
    ),
    '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\nlabels: ["bug"]\n',
    '.github/ISSUE_TEMPLATE/config.yml': 'url: https://github.com/orkastery/orkastery/blob/main/docs/guias/contribuir/triagem.md\n',
  }, (raiz) => {
    const r = checar(raiz);
    assert.deepEqual(r.falhas, []);
    assert.equal(r.rodados, 2, 'true e o echo de duas linhas');
    assert.equal(r.citados, 3, 'o bloco citado e o bloco text');
  });
});

test('a marca vale com linha em branco antes da cerca e dentro de item de lista', () => {
  comFixture(guia(
    '<!-- checagem: citado -->',
    '',
    '```bash',
    'false',
    '```',
    '',
    '1. Passo:',
    '',
    '   <!-- checagem: citado -->',
    '',
    '   ```bash',
    '   false',
    '   ```',
    '',
    '2. Outro passo, sem marca:',
    '',
    '   ```bash',
    '   true',
    '   ```',
  ), (raiz) => {
    const r = checar(raiz);
    assert.deepEqual(r.falhas, []);
    assert.equal(r.citados, 2);
    assert.deepEqual(r.aRodar.map((c: { comando: string }) => c.comando), ['true'], 'a marca vale so para o bloco logo abaixo');
  });
});

test('linha de bloco bash que falha reprova com o arquivo e a linha', () => {
  comFixture(guia('```bash', 'true', 'false', '```'), (raiz) => {
    const r = checar(raiz);
    assert.equal(r.falhas.length, 1);
    assert.match(r.falhas[0], /^docs\/guias\/contribuir\/guia\.md:5: "false" saiu 1/);
  });
});

test('a falha de uma suite diz qual teste caiu, mesmo com a saida longa', () => {
  const suite = 'node -e "console.log(\'not ok 3 - teste que caiu\'); for (let i = 0; i < 40; i++) console.log(\'linha-\' + i); process.exit(1)"';
  comFixture(guia('```bash', suite, '```'), (raiz) => {
    const [falha] = checar(raiz).falhas;
    assert.match(falha, /saiu 1\n/);
    assert.ok(falha.trimEnd().endsWith('not ok 3 - teste que caiu'), 'o teste reprovado fecha a mensagem');
    assert.ok(falha.includes('linha-39'), 'a cauda da saida continua na mensagem');
  });
});

test('o mesmo comando em dois lugares roda uma vez', () => {
  comFixture(guia('```bash', 'echo x >> conta.txt', '```', '', '```bash', 'echo x >> conta.txt', '```'), (raiz) => {
    const r = checar(raiz);
    assert.deepEqual(r.falhas, []);
    assert.equal(r.rodados, 2);
    assert.equal(fs.readFileSync(path.join(raiz, 'conta.txt'), 'utf8'), 'x\n');
  });
});

test('o prazo total corta o comando lento e reprova o que nao coube', () => {
  comFixture(guia('```bash', 'sleep 5', 'true', '```'), (raiz) => {
    const r = checar(raiz, { prazoTotalS: 2 });
    assert.equal(r.falhas.length, 2);
    assert.match(r.falhas[0], /"sleep 5" saiu pelo prazo \([12] s\)/, 'o prazo do comando e o que resta do total');
    assert.match(r.falhas[1], /"true" não rodou: a checagem passou do prazo total \(2 s\)/);
  });
});

test('bloco nao fechado e bloco sh sem marca reprovam em vez de sumir', () => {
  comFixture(guia('```sh', 'ls', '```', '', '```bash', 'false'), (raiz) => {
    assert.deepEqual(checar(raiz).falhas, [
      'docs/guias/contribuir/guia.md:7: bloco de código aberto e não fechado',
      'docs/guias/contribuir/guia.md:3: bloco sh sem a marca de citado: use bash para rodar, ou marque como citado',
    ]);
  });
});

test('ork nao declarado e script npm inexistente reprovam, ate em bloco citado', () => {
  comFixture(guia(
    'Nao existe `ork publicar`.',
    '',
    '<!-- checagem: citado -->',
    '',
    '```bash',
    'ork docs publicar && npm --prefix core run lint',
    '```',
  ), (raiz) => {
    const r = checar(raiz);
    assert.equal(r.rodados, 0);
    assert.deepEqual(r.falhas, [
      'docs/guias/contribuir/guia.md:3: o CLI não declara "ork publicar"',
      'docs/guias/contribuir/guia.md:8: o CLI não declara "ork docs publicar"',
      'docs/guias/contribuir/guia.md:8: core/package.json não tem o script "lint"',
    ]);
  });
});

test('rotulo fora da tabela da triagem, em qualquer forma do YAML, e link para caminho inexistente reprovam', () => {
  const erro = (arquivo: string, rotulo: string) =>
    `.github/ISSUE_TEMPLATE/${arquivo}: o rótulo "${rotulo}" não está na tabela de docs/guias/contribuir/triagem.md`;
  comFixture({
    ...guia(),
    '.github/ISSUE_TEMPLATE/a-colchete.yml': 'name: A\nlabels: ["ideia", "bug"] # comentario\n',
    '.github/ISSUE_TEMPLATE/b-lista.yml': 'name: B\nlabels:\n  - bug\n  - documentação\nbody: []\n',
    '.github/ISSUE_TEMPLATE/c-virgula.yml': 'name: C\nlabels: bug, pergunta\n',
    '.github/ISSUE_TEMPLATE/d-sem-recuo.yml': 'name: D\nlabels:\n- extra\nbody: []\n',
    '.github/ISSUE_TEMPLATE/e-ilegivel.yml': 'name: E\nlabels:\nbody: []\n',
    '.github/ISSUE_TEMPLATE/config.yml': 'url: https://github.com/orkastery/orkastery/blob/main/docs/nao-existe.md\n',
  }, (raiz) => {
    assert.deepEqual(checar(raiz).falhas, [
      erro('a-colchete.yml', 'ideia'),
      erro('b-lista.yml', 'documentação'),
      erro('c-virgula.yml', 'pergunta'),
      '.github/ISSUE_TEMPLATE/config.yml: o link aponta para docs/nao-existe.md, que não existe',
      erro('d-sem-recuo.yml', 'extra'),
      '.github/ISSUE_TEMPLATE/e-ilegivel.yml: a chave labels existe, mas nenhum rótulo foi lido',
    ]);
  });
});

test('sem guia na pasta de contribuicao a checagem reprova', () => {
  comFixture({}, (raiz) => {
    fs.rmSync(path.join(raiz, 'docs/guias/contribuir'), { recursive: true });
    assert.deepEqual(checar(raiz).falhas, ['docs/guias/contribuir: nenhum guia encontrado']);
  });
});

test('os guias e os modelos desta arvore citam so o que existe, e nada perigoso roda', () => {
  // Sem rodar os blocos: rodar aqui rodaria a propria suite. A claim da thread roda o script inteiro.
  const r = checarGuias(raizDoRepo, { executar: false });
  assert.deepEqual(r.falhas, []);
  assert.ok(r.rodados > 0, 'os guias tem blocos bash que a checagem roda');
  const perigoso = /\bgit\s+(clone|push|tag|worktree|config)\b|\bnpm\s+(--prefix\s+\S+\s+)?(ci|install|view|publish)\b|\bork\s+(thread|ship|master|claims|ci)\b|\balias\b/;
  const escapou = r.aRodar.filter((c: { comando: string }) => perigoso.test(c.comando));
  assert.deepEqual(escapou, [], 'comando com rede, efeito externo ou thread real precisa da marca de citado');
});

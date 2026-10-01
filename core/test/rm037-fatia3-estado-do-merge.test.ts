/**
 * RM-037 (fatia 3, defeito 1): depois do merge do PR, o frontmatter do item seguia em "Branch criada"
 * (RM-049 depois do #26, RM-051 depois do #33) e o indice gerado mentia, sem a RM-051. O `ork docs
 * verificar` so conferia um sentido: `Mesclado` exige o commit na base. Agora o merge `ship(<thread>)`
 * na base exige `Mesclado` (`docs.paridade.merge`), e o indice precisa ser o que o frontmatter gera
 * (`docs.paridade.indice`). O que a regra acusa, o `docs sincronizar --escrever` corrige.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { Achado, iniciarDocs, sincronizarDocs, verificarDocs } from '../src/docs';
import { exec } from '../src/util';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const ITEM = 'docs/roadmap/RM-001-item.md';

function git(dir: string, ...args: string[]): string {
  const r = exec('git', args, dir);
  assert.equal(r.ok, true, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Item de roadmap valido, com as tabelas do corpo vazias: o sincronizar as gera do frontmatter. */
function item(thread: string, codigo = 'Branch criada'): string {
  return `---
id: RM-001
tipo: roadmap
titulo: Item de teste
categoria: melhoria
pai: null
features: []
owner: Equipe
atualizado_em: 2026-10-01T02:00:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Rascunho
  codigo: ${codigo}
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ${thread}
  modo: "#Auto"
  fase: GO
  status: aberta
---

# RM-001: Item de teste

> **Em uma frase:** o estado do item acompanha o merge da thread.

<!-- ork-docs:relance:inicio -->
<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Problema:** o índice mentia depois do merge.

## Escopo e validação

- **Incluído:** a paridade com o git.

## Plano e decisões

- **Prioridade:** alta.

## Estado com evidências

<!-- ork-docs:estado:inicio -->
<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** Equipe.
`;
}

/** Projeto com o padrao de docs, o item da thread e os indices gerados, tudo commitado na `main`. */
function projetoComItem(nome: string, thread: string) {
  const p = projetoTemporario(nome);
  iniciarDocs(p.dir);
  fs.writeFileSync(path.join(p.dir, ITEM), item(thread));
  sincronizarDocs(p.dir, { escrever: true });
  git(p.dir, 'add', '--', 'docs', '.markdownlint-cli2.jsonc');
  git(p.dir, 'commit', '-q', '-m', 'docs do item');
  return p;
}

/** A entrega pelo GitHub: branch da thread com um commit, merge --no-ff com o assunto ship(<thread>). */
function mesclarThread(dir: string, thread: string): string {
  git(dir, 'checkout', '-q', '-b', `ork/${thread}-full`);
  commitar(dir, `core/entrega-${thread}.txt`, `entrega da ${thread}\n`, `feat(${thread}): a entrega`);
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', `ork/${thread}-full`, '-m', `ship(${thread}): a entrega por PR`);
  return git(dir, 'rev-parse', 'HEAD');
}

const erros = (achados: Achado[]) => achados.filter((a) => a.gravidade === 'erro');

test('defeito 1: merge ship(<thread>) na base com o item em Branch criada reprova com docs.paridade.merge', () => {
  const p = projetoComItem('rm037-f3-merge', 'ork-entrega1');
  try {
    assert.deepEqual(erros(verificarDocs(p.dir).achados), [], 'antes do merge, Branch criada e verdade');
    const merge = mesclarThread(p.dir, 'ork-entrega1');

    const achados = erros(verificarDocs(p.dir).achados);
    assert.equal(achados.length, 1, JSON.stringify(achados));
    const [a] = achados;
    assert.deepEqual([a.regra, a.id, a.arquivo], ['docs.paridade.merge', 'RM-001', ITEM]);
    assert.match(a.mensagem, new RegExp(`a thread ork-entrega1 entrou na main pelo merge ${merge.slice(0, 7)} \\(ship\\(ork-entrega1\\)\\), e o estado\\.codigo diz "Branch criada"`));
    assert.equal(a.correcao, 'na raiz, depois do merge: ork docs sincronizar --escrever --so RM-001, e commite o item e os índices');

    // A correcao dita corrige: o sincronizar grava Mesclado com o merge, e o verificador volta a passar.
    const r = sincronizarDocs(p.dir, { escrever: true, itens: ['RM-001'] });
    assert.ok(r.mudancas.some((m) => m.campo === 'estado.codigo' && m.para === 'Mesclado'), JSON.stringify(r.mudancas));
    assert.deepEqual(erros(verificarDocs(p.dir).achados), []);
    assert.match(fs.readFileSync(path.join(p.dir, ITEM), 'utf8'), new RegExp(`commit: ${merge.slice(0, 7)}`));
  } finally { p.limpar(); }
});

test('defeito 1: thread sem merge na base nao reprova, e PR aberto antes do merge segue valendo', () => {
  const p = projetoComItem('rm037-f3-sem-merge', 'ork-entrega2');
  try {
    // Outra thread mesclou; a deste item nao: nada a acusar.
    mesclarThread(p.dir, 'ork-outra');
    fs.writeFileSync(path.join(p.dir, ITEM), fs.readFileSync(path.join(p.dir, ITEM), 'utf8').replace('codigo: Branch criada', 'codigo: PR aberto'));
    sincronizarDocs(p.dir, { escrever: true });
    assert.deepEqual(erros(verificarDocs(p.dir).achados), []);
    // `ship(ork-entrega2x)` nao e o merge da `ork-entrega2`: o parentese fecha o id.
    mesclarThread(p.dir, 'ork-entrega2x');
    assert.deepEqual(erros(verificarDocs(p.dir).achados), []);
  } finally { p.limpar(); }
});

test('defeito 1: o indice gerado que diverge do frontmatter reprova com docs.paridade.indice; vazio so avisa', () => {
  const p = projetoComItem('rm037-f3-indice', 'ork-entrega3');
  try {
    const indice = path.join(p.dir, 'docs/roadmap/README.md');
    const gerado = fs.readFileSync(indice, 'utf8');
    assert.match(gerado, /\| \[RM-001\]\(RM-001-item\.md\) \| Item de teste \| Em desenvolvimento \| Branch criada \|/);

    // A linha do item sumiu do indice, como a RM-051 sumiu do indice real.
    fs.writeFileSync(indice, gerado.replace(/^\| \[RM-001\].*\n/m, ''));
    const achados = erros(verificarDocs(p.dir, { semGit: true }).achados);
    assert.deepEqual(achados.map((a) => [a.regra, a.arquivo]), [['docs.paridade.indice', 'docs/roadmap/README.md']]);
    assert.equal(achados[0].correcao, 'o índice é gerado do frontmatter: rode ork docs sincronizar --escrever e commite o índice');

    // Indice ainda nao gerado (o modelo do `ork docs init`): aviso, nunca erro.
    fs.writeFileSync(indice, gerado.replace(/<!-- ork-docs:indice:inicio -->[\s\S]*<!-- ork-docs:indice:fim -->/,
      '<!-- ork-docs:indice:inicio -->\n<!-- ork-docs:indice:fim -->'));
    const v = verificarDocs(p.dir, { semGit: true }).achados;
    assert.deepEqual(erros(v), []);
    assert.ok(v.some((a) => a.gravidade === 'aviso' && a.regra === 'docs.paridade.indice'), JSON.stringify(v));

    sincronizarDocs(p.dir, { escrever: true });
    assert.deepEqual(verificarDocs(p.dir, { semGit: true }).achados.filter((a) => a.regra === 'docs.paridade.indice'), []);
  } finally { p.limpar(); }
});

test('defeito 1: o CLI sai 2 e devolve a regra tipada com a correcao pronta', () => {
  const p = projetoComItem('rm037-f3-cli', 'ork-entrega4');
  try {
    mesclarThread(p.dir, 'ork-entrega4');
    const r = spawnSync(process.execPath, [ORK, 'docs', 'verificar', '--json'], { cwd: p.dir, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    const saida = JSON.parse(r.stdout) as { achados: Achado[] };
    const merge = saida.achados.find((a) => a.regra === 'docs.paridade.merge');
    assert.ok(merge, r.stdout);
    assert.match(String(merge!.correcao), /ork docs sincronizar --escrever --so RM-001/);
  } finally { p.limpar(); }
});

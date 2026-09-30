/**
 * RM-037 (rm037noite, defeito 5): o `ork docs sincronizar --escrever` mexia em itens de outras threads
 * (sdlc.fase e status de RM-025, 026, 031, 038, 048 e 050), e cada PR conflitava com as outras. Agora
 * `--so RM-NNN` limita aos itens pedidos (os indices seguem regerados), e na worktree de uma thread com
 * item o padrao e o item dela; `--todos` volta ao comportamento antigo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { escopoPadraoDoSync, separarFrontmatter, sincronizarDocs } from '../src/docs';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { garantirWorktree } from '../src/worktree';
import { lerYaml } from '../src/yaml';
import { exec } from '../src/util';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const AGORA = '2026-09-30T00:30:00-03:00';

function item(id: string, thread: string): string {
  return `---
id: ${id}
tipo: roadmap
titulo: Item ${id}
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-09-20T10:00:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Rascunho
  codigo: Branch criada
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
  fase: GOAL
  status: aberta
---

# ${id}: item ${id}

> **Em uma frase:** fixture do teste.
`;
}

const INDICE = '# Roadmap\n\n<!-- ork-docs:indice:inicio -->\n<!-- ork-docs:indice:fim -->\n';

/** Dois itens, cada um de uma thread que ja andou (fase e status mudaram no thread.json). */
function projetoComDoisItens(nome: string) {
  const p = projetoTemporario(nome);
  for (const [id, thread] of [['RM-001', 'ork-alheia'], ['RM-002', 'ork-propria']]) {
    fs.mkdirSync(path.join(p.dir, 'docs', 'roadmap'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'docs', 'roadmap', `${id}-item.md`), item(id, thread));
    fs.mkdirSync(dirThread(p.dir, thread), { recursive: true });
    fs.writeFileSync(path.join(dirThread(p.dir, thread), 'thread.json'),
      JSON.stringify({ id: thread, faseAtual: 'MASTER', status: 'fechada' }));
  }
  fs.writeFileSync(path.join(p.dir, 'docs', 'roadmap', 'README.md'), INDICE);
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'roadmap com dois itens'], p.dir);
  return p;
}

const sdlc = (dir: string, id: string) => {
  const dados = lerYaml(separarFrontmatter(fs.readFileSync(path.join(dir, 'docs', 'roadmap', `${id}-item.md`), 'utf8')).bruto!) as
    Record<string, Record<string, string>>;
  return [dados.sdlc.fase, dados.sdlc.status];
};

test('defeito 5: --so grava so o item pedido e os indices; o item de outra thread fica como estava', () => {
  const p = projetoComDoisItens('rm037noite-docs-so');
  try {
    const r = sincronizarDocs(p.dir, { escrever: true, itens: ['RM-002'], agora: () => AGORA });
    assert.deepEqual([...new Set(r.mudancas.map((m) => m.id))], ['RM-002']);
    assert.deepEqual(sdlc(p.dir, 'RM-002'), ['MASTER', 'fechada']);
    assert.deepEqual(sdlc(p.dir, 'RM-001'), ['GOAL', 'aberta'], 'o item da outra thread nao foi tocado');
    assert.deepEqual(r.indices, ['docs/roadmap/README.md']);
    assert.match(fs.readFileSync(path.join(p.dir, 'docs', 'roadmap', 'README.md'), 'utf8'), /\[RM-001\]\(RM-001-item\.md\)/);
    // Sem a lista, o comportamento de antes: todo item.
    const todos = sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA });
    assert.deepEqual([...new Set(todos.mudancas.map((m) => m.id))], ['RM-001']);
  } finally { p.limpar(); }
});

test('defeito 5: na worktree de uma thread com item, o padrao do CLI e o item dela; --todos volta a tudo', () => {
  const p = projetoComDoisItens('rm037noite-docs-worktree');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'propria', modo: 'auto', roadmap: 'RM-002' });
    garantirWorktree(p.carregado, thread.id);
    const wt = lerThread(p.dir, thread.id).worktree as string;
    assert.deepEqual(escopoPadraoDoSync(wt), { itens: ['RM-002'], thread: thread.id });
    assert.deepEqual(escopoPadraoDoSync(p.dir), { itens: null, thread: null }, 'na raiz, todo item');

    const ork = (args: string[]) => spawnSync(process.execPath, [CLI, 'docs', 'sincronizar', ...args],
      { cwd: wt, encoding: 'utf8', env: { ...process.env, ORK_FABRICA_PUBLICAR: '0' } });
    const padrao = ork(['--escrever']);
    assert.equal(padrao.status, 0, padrao.stderr);
    assert.match(padrao.stdout, new RegExp(`^Escopo: so RM-002, o item da thread ${thread.id} desta worktree`));
    assert.doesNotMatch(padrao.stdout, /RM-001 /);
    assert.deepEqual(sdlc(wt, 'RM-001'), ['GOAL', 'aberta']);
    assert.deepEqual(sdlc(wt, 'RM-002'), ['MASTER', 'fechada']);
    const alterados = exec('git', ['diff', '--name-only'], wt).stdout.trim().split('\n').sort();
    assert.deepEqual(alterados, ['docs/roadmap/README.md', 'docs/roadmap/RM-002-item.md']);

    const pedido = ork(['--so', 'rm-001', '--json']);
    assert.equal(pedido.status, 0, pedido.stderr);
    assert.deepEqual(JSON.parse(pedido.stdout).escopo, ['RM-001']);
    assert.equal(ork(['--so', 'FEAT-001']).status, 2, 'so item do roadmap');
    const semItem = ork(['--so', '--escrever']);
    assert.equal(semItem.status, 2, 'sem item depois de --so e erro de uso');
    assert.match(semItem.stderr, /faltou o item depois de --so/);

    const todos = ork(['--todos']);
    assert.match(todos.stdout, /^Escopo: todo item do roadmap\./);
    assert.match(todos.stdout, /RM-001 +sdlc\.fase: GOAL → MASTER/);
  } finally { p.limpar(); }
});

/**
 * RM-044 (A3 do backlog autonomo 2): o `ork ship registrar-pr` avisa a pagina do roadmap que vai
 * deixar o push da `main` vermelho em `docs.paridade.merge`.
 *
 * Seis merges de 02 e 03/10 reprovaram no push da `main` pelo mesmo motivo (a thread entrou pelo
 * merge `ship(<thread>)` e a pagina dela seguia em "Branch criada"), e cada um pediu um PR de docs a
 * mao. O `registrar-pr` e o passo que todo condutor roda logo depois do merge: e ali que o aviso chega,
 * com o comando que corrige. So aviso: nada e gravado e o veredito do `docs verificar` nao muda.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { docsPendentesDoMerge, verificarDocs } from '../src/docs';
import { registrarEntregaPorPr } from '../src/entrega-pr';
import { novaThread } from '../src/thread';
import { exec } from '../src/util';
import { commitar, projetoTemporario, ProjetoDeTeste } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function pagina(id: string, thread: string, codigo: string, commit: string | null): string {
  return [
    '---',
    `id: ${id}`,
    'tipo: roadmap',
    `titulo: Item ${id}`,
    'categoria: iniciativa',
    'pai: null',
    'features: []',
    'owner: Julio',
    'atualizado_em: 2026-10-03T08:00:00+00:00',
    'estado:',
    '  ciclo: Em desenvolvimento',
    '  documentacao: Em revisão',
    `  codigo: ${codigo}`,
    '  testes: Em execução',
    '  deploy: Não implantado',
    '  exposicao: Flag desligada',
    '  habilitacao: Pendente',
    'evidencias:',
    '  codigo:',
    `    commit: ${commit ?? 'null'}`,
    '    pr: null',
    'sdlc:',
    `  thread: ${thread}`,
    '  modo: "#Auto"',
    '  fase: GO',
    '  status: aberta',
    '---',
    '',
    `# ${id} — Item ${id}`,
    '',
  ].join('\n');
}

/** Uma thread com a pagina dela na main, o trabalho numa branch e o merge `ship(<thread>)` publicado. */
function entregaComPagina(p: ProjetoDeTeste, nome: string, paginas: (id: string) => Record<string, string>): string {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  for (const [arquivo, texto] of Object.entries(paginas(thread.id))) commitar(p.dir, arquivo, texto, `docs: ${arquivo}`);
  exec('git', ['checkout', '-q', '-b', `ork/${thread.id}-full`], p.dir);
  commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  const merge = exec('git', ['merge', '--no-ff', '-q', '-m', `ship(${thread.id}): ${nome}`, `ork/${thread.id}-full`], p.dir);
  assert.equal(merge.ok, true, merge.stderr);
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
  return thread.id;
}

function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), codigo: 0 };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

test('merge ship(<thread>) com a pagina em "Branch criada": o registrar-pr lista o item e o comando, sem gravar a pagina', () => {
  const p = projetoTemporario('rm044-pendente', true);
  try {
    const id = entregaComPagina(p, 'fatia', (t) => ({ 'docs/roadmap/RM-901-item.md': pagina('RM-901', t, 'Branch criada', null) }));
    const antes = fs.readFileSync(path.join(p.dir, 'docs/roadmap/RM-901-item.md'), 'utf8');

    const r = registrarEntregaPorPr(p.carregado, id, { publicar: false });
    assert.equal(r.acao, 'registrou', r.motivo);
    assert.equal(r.docsPendentes.length, 1);
    assert.equal(r.docsPendentes[0].id, 'RM-901');
    assert.equal(r.docsPendentes[0].arquivo, 'docs/roadmap/RM-901-item.md');
    assert.equal(r.docsPendentes[0].codigo, 'Branch criada');
    assert.equal(r.docsPendentes[0].merge, r.mergeSha);
    assert.equal(r.docsPendentes[0].comando, 'ork docs sincronizar --escrever --so RM-901');
    assert.equal(fs.readFileSync(path.join(p.dir, 'docs/roadmap/RM-901-item.md'), 'utf8'), antes, 'o registrar-pr nao grava a pagina');

    // A mesma regra do docs verificar: na base, ela reprova; o veredito dele nao muda.
    const { achados } = verificarDocs(p.dir, { semGit: false, baseBranch: 'main' });
    assert.ok(achados.some((a) => a.regra === 'docs.paridade.merge' && a.id === 'RM-901' && a.gravidade === 'erro'));

    // Idempotente tambem no aviso: a entrega ja registrada continua avisando ate o PR de docs.
    const de_novo = registrarEntregaPorPr(p.carregado, id, { publicar: false });
    assert.equal(de_novo.acao, 'ja-registrada');
    assert.deepEqual(de_novo.docsPendentes.map((d) => d.id), ['RM-901']);
  } finally { p.limpar(); }
});

test('pagina ja Mesclado e pagina de outra thread nao sao listadas', () => {
  const p = projetoTemporario('rm044-limpo', true);
  try {
    const id = entregaComPagina(p, 'limpa', (t) => ({
      'docs/roadmap/RM-902-mesclado.md': pagina('RM-902', t, 'Mesclado', 'HEAD_PLACEHOLDER'),
      'docs/roadmap/RM-903-outra.md': pagina('RM-903', 'ork-outrathread', 'Branch criada', null),
    }));
    // O RM-902 aponta o commit do merge (o que o docs sincronizar grava): troca o marcador e publica.
    const sha = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
    const arq = path.join(p.dir, 'docs/roadmap/RM-902-mesclado.md');
    fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace('HEAD_PLACEHOLDER', sha.slice(0, 7)));
    commitar(p.dir, 'docs/roadmap/RM-902-mesclado.md', fs.readFileSync(arq, 'utf8'), 'docs: RM-902 mesclado');
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);

    const r = registrarEntregaPorPr(p.carregado, id, { publicar: false });
    assert.equal(r.acao, 'registrou', r.motivo);
    assert.deepEqual(r.docsPendentes, []);
    assert.deepEqual(docsPendentesDoMerge(p.dir, id, 'refs/remotes/origin/main'), []);
  } finally { p.limpar(); }
});

test('a pagina e lida da base remota, nao da copia local: a copia local atrasada nao esconde o aviso', () => {
  const p = projetoTemporario('rm044-remoto', true);
  try {
    const id = entregaComPagina(p, 'remota', (t) => ({ 'docs/roadmap/RM-904-item.md': pagina('RM-904', t, 'Branch criada', null) }));
    // Na copia local, alguem ja mexeu na pagina sem publicar: o push da base ainda reprova.
    const arq = path.join(p.dir, 'docs/roadmap/RM-904-item.md');
    fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace('codigo: Branch criada', 'codigo: Mesclado'));
    assert.deepEqual(docsPendentesDoMerge(p.dir, id, 'refs/remotes/origin/main').map((d) => d.id), ['RM-904']);
    assert.deepEqual(docsPendentesDoMerge(p.dir, id, 'refs/remotes/origin/nao-existe'), [], 'ref ilegivel nao avisa nem quebra');
  } finally { p.limpar(); }
});

test('pelo binario: o texto traz o item e o comando, o --json traz docsPendentes, e o codigo de saida nao muda', () => {
  const p = projetoTemporario('rm044-cli', true);
  try {
    const id = entregaComPagina(p, 'cli', (t) => ({ 'docs/roadmap/RM-905-item.md': pagina('RM-905', t, 'PR aberto', null) }));
    const texto = ork(p.dir, ['ship', 'registrar-pr', id, '--dry-run']);
    assert.equal(texto.codigo, 0, texto.saida);
    assert.match(texto.saida, /RM-905 \(docs\/roadmap\/RM-905-item\.md\)/);
    assert.match(texto.saida, /ork docs sincronizar --escrever --so RM-905/);
    assert.match(texto.saida, /docs\.paridade\.merge/);

    const json = ork(p.dir, ['ship', 'registrar-pr', id, '--dry-run', '--json']);
    assert.equal(json.codigo, 0, json.saida);
    const r = JSON.parse(json.saida) as Array<{ acao: string; docsPendentes: Array<{ id: string; comando: string }> }>;
    assert.equal(r[0].acao, 'registraria');
    assert.deepEqual(r[0].docsPendentes.map((d) => [d.id, d.comando]), [['RM-905', 'ork docs sincronizar --escrever --so RM-905']]);
  } finally { p.limpar(); }
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { main, parseArgs } from '../src/index';
import { lerClaims } from '../src/claims';
import { lerPedido } from '../src/intelligence-graph-cli';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

function executar(cwd: string, argv: string[]): { code: number; stdout: string; stderr: string } {
  const anterior = process.cwd(), stdout: string[] = [], stderr: string[] = [];
  const log = console.log, error = console.error;
  try {
    process.chdir(cwd);
    console.log = (...args: unknown[]) => stdout.push(args.join(' '));
    console.error = (...args: unknown[]) => stderr.push(args.join(' '));
    return { code: main(argv), stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    process.chdir(anterior);
  }
}

test('RM-079 F2: o parser preserva as excecoes repetiveis na ordem cruzada dos aliases', () => {
  const add = parseArgs(['claims', 'add', 'ork-x', 'README.md', '--verificar', 'primeiro', '--verify=segundo',
    '--verificar', 'terceiro']);
  assert.deepEqual(add.multiplas.verificar, ['primeiro', 'segundo', 'terceiro']);
  assert.deepEqual(add.repetidasDivergentes, []);

  const verificar = parseArgs(['claims', 'verificar', 'ork-x', 'C1', '--comando', 'um', '--comando=dois']);
  assert.deepEqual(verificar.multiplas.comando, ['um', 'dois']);
});

test('RM-079 F2: claims add e verificar gravam e imprimem todos os comandos na ordem', () => {
  const p = projetoTemporario('rm079-f2-args');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'opcoes repetidas', modo: 'auto' });
    const add = executar(p.dir, ['claims', 'add', thread.id, 'README.md', '--claim', 'provas ordenadas',
      '--verificar', 'node --version', '--verify', 'node -p process.version']);
    assert.equal(add.code, 0, add.stderr);
    assert.match(add.stdout, /node --version && node -p process\.version/);
    assert.deepEqual(lerClaims(p.dir, thread.id).at(-1)?.verificar, ['node --version', 'node -p process.version']);

    const anexar = executar(p.dir, ['claims', 'verificar', thread.id, 'C1', '--comando', 'grep -q prova README.md',
      '--comando', 'grep -q ordenada README.md']);
    assert.equal(anexar.code, 0, anexar.stderr);
    assert.match(anexar.stdout, /grep -q prova README\.md && grep -q ordenada README\.md/);
    assert.deepEqual(lerClaims(p.dir, thread.id).at(-1)?.verificar,
      ['node --version', 'node -p process.version', 'grep -q prova README.md', 'grep -q ordenada README.md']);
  } finally { p.limpar(); }
});

test('RM-079 F2: escalar divergente sai 2 e nomeia a opcao; valor identico segue', () => {
  const p = projetoTemporario('rm079-f2-args-escalar');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'opcao escalar', modo: 'auto' });
    const diferente = executar(p.dir, ['claims', 'list', thread.id, '--formato', 'a', '--formato', 'b']);
    assert.equal(diferente.code, 2);
    assert.match(diferente.stderr, /--formato/);

    const igual = executar(p.dir, ['claims', 'list', thread.id, '--formato', 'a', '--formato', 'a']);
    assert.equal(igual.code, 0, igual.stderr);
  } finally { p.limpar(); }
});

test('RM-079 F2: opcao global projeto aceita valor identico e recusa divergencia', () => {
  const p = projetoTemporario('rm079-f2-args-projeto');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'projeto repetido', modo: 'auto' });
    const igual = executar(p.dir, ['--projeto', p.dir, '--projeto', p.dir, 'claims', 'list', thread.id]);
    assert.equal(igual.code, 0, igual.stderr);

    const diferente = executar(p.dir, ['--projeto', p.dir, '--projeto', `${p.dir}-outro`, 'claims', 'list', thread.id]);
    assert.equal(diferente.code, 2);
    assert.match(diferente.stderr, /--projeto/);
  } finally { p.limpar(); }
});

test('RM-079 F2: rotas anteriores ao parser comum seguem o contrato escalar e o erro JSON nomeia a opcao', () => {
  const p = projetoTemporario('rm079-f2-args-rotas');
  try {
    const maestroIgual = executar(p.dir,
      ['maestro', '--json', '--section', 'threads', '--section', 'threads', '--offset', '0', '--offset', '0']);
    assert.equal(maestroIgual.code, 0, maestroIgual.stderr);

    const maestroDiferente = executar(p.dir,
      ['maestro', '--json', '--section', 'threads', '--section', 'blockers']);
    assert.equal(maestroDiferente.code, 2);
    assert.equal(JSON.parse(maestroDiferente.stderr).option, '--section');

    const receiptIgual = executar(p.dir, ['receipt-verifiers', '--json', '--json']);
    assert.equal(receiptIgual.code, 0, receiptIgual.stderr);
    const receiptDiferente = executar(p.dir, ['receipt-verifiers', '--json=a', '--json=b']);
    assert.equal(receiptDiferente.code, 2);
    assert.match(receiptDiferente.stderr, /--json/);

    const projetoJson = executar(p.dir,
      ['maestro', '--json', '--projeto', p.dir, '--projeto', `${p.dir}-outro`]);
    assert.equal(projetoJson.code, 2);
    assert.equal(JSON.parse(projetoJson.stderr).option, '--projeto');

    const grafoIgual = executar(p.dir, ['grafo', 'status', '--json', '--json']);
    assert.equal(grafoIgual.code, 0, grafoIgual.stderr);
    assert.equal(typeof JSON.parse(grafoIgual.stdout).indice_do_head, 'string');
    assert.equal(lerPedido(['vizinhos', 'x', '--limite', '1', '--limite=1']).valores.get('limite'), '1');

    const grafoDiferente = executar(p.dir,
      ['grafo', 'vizinhos', 'x', '--limite', '1', '--limite', '2', '--json']);
    assert.equal(grafoDiferente.code, 2);
    const erroDoGrafo = JSON.parse(grafoDiferente.stderr);
    assert.equal(erroDoGrafo.option, '--limite');
    assert.equal(erroDoGrafo.message, 'opcao --limite repetida com valores diferentes');
  } finally { p.limpar(); }
});

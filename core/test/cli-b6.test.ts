/**
 * Testes do bloco B6 pelo BINARIO.
 *
 * Quem consome `ork memory` e `ork recall` e uma linha de shell dentro de um adaptador de
 * host, e por isso o codigo de saida importa tanto quanto o texto: `ork recall` que
 * devolvesse 0 com ponteiro quebrado faria a sessao nova achar que recuperou o contexto.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return {
      saida: execFileSync(process.execPath, [ORK, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
      codigo: 0,
    };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string; stderr?: string };
    return { saida: (erro.stdout ?? '') + (erro.stderr ?? ''), codigo: erro.status ?? -1 };
  }
}

/** Liga o regime `orkmind` no manifesto do projeto de teste. */
function pedirOrkmind(dir: string, variavel: string, cli = 'orkmind-que-nao-existe'): void {
  const caminho = path.join(dir, 'orkastery.yaml');
  fs.writeFileSync(
    caminho,
    fs
      .readFileSync(caminho, 'utf8')
      .replace(/^  mode: files$/m, '  mode: orkmind')
      .replace(/^  database_url_env: ""$/m, `  database_url_env: "${variavel}"`)
      .replace(/^  cli: orkmind$/m, `  cli: ${cli}`),
    'utf8'
  );
}

test('ork --help anuncia os comandos do bloco B6', () => {
  const { saida, codigo } = ork(process.cwd(), ['--help']);
  assert.equal(codigo, 0);
  for (const comando of [
    'recall <thread-id> --fase FASE',
    'memory status',
    'memory sync',
    'memory search',
    'retrieve_when',
  ]) {
    assert.ok(saida.includes(comando), `a ajuda nao cita "${comando}"`);
  }
  assert.ok(saida.includes('Regimes de memoria: files'), 'a ajuda declara os dois regimes');
  assert.ok(
    saida.includes('decision, handoff, rule, learning, roadmap'),
    'a ajuda lista as colecoes gravadas'
  );
  assert.ok(
    saida.includes('nunca mandatory'),
    'a ajuda declara a governanca: o ork nao cria regra mandatoria'
  );
});

test('ork init gera o manifesto com o regime de memoria do B6', (t) => {
  const p = projetoTemporario('b6-cli-init');
  t.after(p.limpar);

  const yaml = fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8');
  assert.ok(yaml.includes('mode: files'), 'o padrao continua sendo o fallback honesto');
  assert.ok(yaml.includes('database_url_env: ""'));
  assert.ok(yaml.includes('cli: orkmind'));
  assert.ok(
    yaml.includes('NOME da variavel de ambiente'),
    'o manifesto explica que ali vai o nome, nunca a DSN'
  );
});

test('ork memory status declara o regime efetivo em files', (t) => {
  const p = projetoTemporario('b6-cli-status-files');
  t.after(p.limpar);

  const { saida, codigo } = ork(p.dir, ['memory', 'status']);
  assert.equal(codigo, 0);
  assert.ok(saida.includes('pedido no manifesto   files'));
  assert.ok(saida.includes('regime efetivo        files'));
  assert.ok(saida.includes('degradacao: modo.files'));

  const json = ork(p.dir, ['memory', 'status', '--json']);
  const estado = JSON.parse(json.saida) as { efetivo: string; motivo: string; tenant: string };
  assert.equal(estado.efetivo, 'files');
  assert.equal(estado.motivo, 'modo.files');
  assert.equal(estado.tenant, 'orkastery');
});

test('ork memory status mostra a degradacao quando o OrkMind nao esta la', (t) => {
  const p = projetoTemporario('b6-cli-status-degradado');
  t.after(p.limpar);
  pedirOrkmind(p.dir, 'ORKASTERY_DSN_DE_TESTE_AUSENTE');

  const { saida, codigo } = ork(p.dir, ['memory', 'status']);
  // Degradacao nao e erro de comando: ela e o estado do mundo, e sai com 0.
  assert.equal(codigo, 0);
  assert.ok(saida.includes('pedido no manifesto   orkmind'));
  assert.ok(saida.includes('regime efetivo        files'));
  assert.ok(saida.includes('dsn.env-ausente'));
  assert.ok(saida.includes('ORKASTERY_DSN_DE_TESTE_AUSENTE'));

  // E o doctor reporta o mesmo, como aviso e nao como bloqueio.
  const doctor = ork(p.dir, ['doctor']);
  assert.ok(doctor.saida.includes('regime de memoria'));
  assert.ok(doctor.saida.includes('pedido orkmind, efetivo files'));
});

test('ork memory sync nao quebra em regime files e diz o que faltou', (t) => {
  const p = projetoTemporario('b6-cli-sync');
  t.after(p.limpar);

  ork(p.dir, ['thread', 'new', 'sync do b6', '--modo', 'classic']);
  const { saida, codigo } = ork(p.dir, ['memory', 'sync', 'ork-syncdob6']);
  assert.equal(codigo, 0);
  assert.ok(saida.includes('regime files'));
  assert.ok(saida.includes('nada foi para a memoria semantica'));
  assert.ok(saida.includes('correcao:'));
});

test('ork memory sync reprova thread inexistente', (t) => {
  const p = projetoTemporario('b6-cli-sync-erro');
  t.after(p.limpar);

  const { saida, codigo } = ork(p.dir, ['memory', 'sync', 'ork-naoexiste']);
  assert.notEqual(codigo, 0);
  assert.ok(saida.toLowerCase().includes('thread'));
});

test('ork recall resolve so o momento pedido e sai 0 quando tudo resolve', (t) => {
  const p = projetoTemporario('b6-cli-recall');
  t.after(p.limpar);

  ork(p.dir, ['thread', 'new', 'recall do b6', '--modo', 'classic']);
  const id = 'ork-recalldob6';
  fs.writeFileSync(path.join(p.dir, 'spec.md'), '# spec\n\n## Regra\n\nvale no check\n', 'utf8');
  ork(p.dir, [
    'claims',
    'add',
    id,
    'spec.md',
    '--claim',
    'a spec descreve a regra',
    '--verificar',
    'grep -q "vale no check" spec.md',
  ]);
  ork(p.dir, ['handoff', 'export', id, '--proxima-fase', 'CHECK']);

  const noGo = ork(p.dir, ['recall', id, '--fase', 'GO']);
  assert.equal(noGo.codigo, 0);
  assert.ok(noGo.saida.includes('RESOLVIDOS (0'), 'nenhum ponteiro de CHECK resolve no GO');
  assert.ok(noGo.saida.includes('ADIADOS ('));
  assert.ok(!noGo.saida.includes('vale no check'), 'o conteudo nao pode vazar fora do momento');

  const noCheck = ork(p.dir, ['recall', id, '--fase', 'CHECK']);
  assert.equal(noCheck.codigo, 0);
  assert.ok(noCheck.saida.includes('vale no check'), 'no CHECK o conteudo certo e entregue');
  assert.ok(noCheck.saida.includes('via       files'));

  const json = ork(p.dir, ['recall', id, '--fase', 'CHECK', '--json']);
  const r = JSON.parse(json.saida) as { regime: string; resolvidos: unknown[]; falhas: unknown[] };
  assert.equal(r.regime, 'files');
  assert.ok(r.resolvidos.length > 0);
  assert.equal(r.falhas.length, 0);
});

test('ork recall reprova thread sem handoff e ponteiro inexistente', (t) => {
  const p = projetoTemporario('b6-cli-recall-erro');
  t.after(p.limpar);

  ork(p.dir, ['thread', 'new', 'sem pacote', '--modo', 'classic']);
  const semHandoff = ork(p.dir, ['recall', 'ork-sempacote', '--fase', 'CHECK']);
  assert.notEqual(semHandoff.codigo, 0);
  assert.ok(semHandoff.saida.includes('ork handoff export'));

  ork(p.dir, ['handoff', 'export', 'ork-sempacote', '--proxima-fase', 'CHECK']);
  const idErrado = ork(p.dir, ['recall', 'ork-sempacote', '--id', 'ptr-999']);
  assert.notEqual(idErrado.codigo, 0);
  assert.ok(idErrado.saida.includes('nao existe no handoff'));

  const semThread = ork(p.dir, ['recall']);
  assert.equal(semThread.codigo, 2);
  assert.ok(semThread.saida.includes('uso: ork recall'));
});

test('ork memory search exige tags e explica o regime quando nao ha memoria', (t) => {
  const p = projetoTemporario('b6-cli-search');
  t.after(p.limpar);

  const semTags = ork(p.dir, ['memory', 'search']);
  assert.equal(semTags.codigo, 2);
  assert.ok(semTags.saida.includes('--tags'));

  const jsonInvalido = ork(p.dir, ['memory', 'search', '--tags', '{nao e json']);
  assert.equal(jsonInvalido.codigo, 2);
  assert.ok(jsonInvalido.saida.includes('nao e JSON valido'));

  const emFiles = ork(p.dir, ['memory', 'search', '--tags', '{"project":["orkastery"]}']);
  assert.equal(emFiles.codigo, 0);
  assert.ok(emFiles.saida.includes('regime files'));
  assert.ok(emFiles.saida.includes('correcao:'));
});

test('manifesto com DSN no lugar do nome da variavel reprova o comando inteiro', (t) => {
  const p = projetoTemporario('b6-cli-dsn');
  t.after(p.limpar);
  pedirOrkmind(p.dir, 'postgresql://orkmind:senha-de-teste@localhost:5432/orkmind');

  const { saida, codigo } = ork(p.dir, ['memory', 'status']);
  assert.notEqual(codigo, 0);
  assert.ok(saida.includes('NOME da variavel'));
  assert.ok(saida.includes('sem fallback para base alheia'));
});

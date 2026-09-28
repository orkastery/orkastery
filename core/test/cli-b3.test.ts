/**
 * Testes do bloco B3 pelo BINARIO.
 *
 * Quem chama `ork retry` e `ork fix` e uma linha de shell dentro de um adaptador de host
 * ou de um cron, e por isso o CODIGO DE SAIDA importa tanto quanto o texto: um
 * `ork retry resume` que saisse 0 depois de escalar para humano faria o orquestrador
 * seguir achando que a fase voltou a andar.
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

test('ork --help anuncia os comandos do bloco B3', () => {
  const { saida, codigo } = ork(process.cwd(), ['--help']);
  assert.equal(codigo, 0);
  for (const comando of [
    'retry policy',
    'retry plan <thread-id>',
    'retry run <thread-id>',
    'retry list',
    'retry resume',
    'retry cancel <id> --motivo M',
    'retry parse --stderr',
    'fix open <thread-id>',
    'fix list <thread-id>',
    'fix reverify <thread-id>',
  ]) {
    assert.ok(saida.includes(comando), `a ajuda nao cita "${comando}"`);
  }
  assert.ok(saida.includes('Retry tipado (bloco B3)'), 'a ajuda declara as acoes de retry');
  assert.ok(
    saida.includes('NUNCA recebe retry automatico'),
    'a ajuda declara a regra de custo'
  );
  assert.ok(
    saida.includes('pausa QUALQUER modo, inclusive #Auto'),
    'a ajuda declara o limite de escalacao'
  );
});

test('ork init gera o manifesto com o bloco retry do B3', (t) => {
  const p = projetoTemporario('b3-cli-init');
  t.after(p.limpar);

  const yaml = fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8');
  assert.ok(yaml.includes('max_tentativas: 3'));
  assert.ok(yaml.includes('janela_padrao_min: 60'));
  assert.ok(yaml.includes('escalar_esforco: true'));
  assert.ok(yaml.includes('LIMITE DE ESCALACAO'), 'o manifesto explica o que o limite faz');
  assert.equal(p.carregado.manifesto.retry.max_tentativas, 3);
  assert.equal(p.carregado.manifesto.retry.janela_padrao_min, 60);
});

test('ork retry policy mostra a acao de cada motivo tipado', () => {
  const tabela = ork(process.cwd(), ['retry', 'policy']);
  assert.equal(tabela.codigo, 0);
  for (const motivo of [
    'claims.failed',
    'verify.regression',
    'runtime.rate-limited',
    'cost.violation',
    'tree.blocked',
    'human.pending',
  ]) {
    assert.ok(tabela.saida.includes(motivo), `a tabela nao cita ${motivo}`);
  }
  assert.ok(tabela.saida.includes('corrigir-dirigido'));
  assert.ok(tabela.saida.includes('esperar-janela'));
  assert.ok(tabela.saida.includes('sincronizar-worktree'));

  const custo = ork(process.cwd(), ['retry', 'policy', '--motivo', 'cost.violation', '--json']);
  assert.equal(custo.codigo, 0);
  const politica = JSON.parse(custo.saida) as { acao: string; automatica: boolean };
  assert.equal(politica.acao, 'sem-retry');
  assert.equal(politica.automatica, false);

  const errado = ork(process.cwd(), ['retry', 'policy', '--motivo', 'nao.existe']);
  assert.equal(errado.codigo, 2);
  assert.ok(errado.saida.includes('motivo tipado desconhecido'));
});

test('ork retry parse le o reset do stderr e sai != 0 quando nao ha rate limit', () => {
  const comHora = ork(process.cwd(), [
    'retry',
    'parse',
    '--stderr',
    'Claude AI usage limit reached|1757012400',
  ]);
  assert.equal(comHora.codigo, 0);
  assert.ok(comHora.saida.includes('fonte da hora  epoch'));
  assert.ok(comHora.saida.includes('reset em'));

  const semHora = ork(process.cwd(), ['retry', 'parse', '--stderr', 'Error: 429 Too Many Requests']);
  assert.equal(semHora.codigo, 0);
  assert.ok(semHora.saida.includes('sem-horario'));
  assert.ok(semHora.saida.includes('o runtime nao disse a hora'));
  assert.ok(semHora.saida.includes('nao inventa horario de reset'));

  const nada = ork(process.cwd(), ['retry', 'parse', '--stderr', 'arquivo nao encontrado']);
  assert.equal(nada.codigo, 1);
  assert.ok(nada.saida.includes('Nenhum sinal de rate limit'));

  const semTexto = ork(process.cwd(), ['retry', 'parse']);
  assert.equal(semTexto.codigo, 2);
  assert.ok(semTexto.saida.includes('uso: ork retry parse'));
});

test('ork retry list e plan respondem em projeto sem incidente nenhum', (t) => {
  const p = projetoTemporario('b3-cli-vazio');
  t.after(p.limpar);

  const fila = ork(p.dir, ['retry', 'list']);
  assert.equal(fila.codigo, 0);
  assert.ok(fila.saida.includes('Fila de rate limit vazia'));

  ork(p.dir, ['thread', 'new', 'cli sem gate', '--modo', 'auto']);
  const plano = ork(p.dir, ['retry', 'plan', 'ork-clisemgate', '--json']);
  assert.equal(plano.codigo, 0);
  const json = JSON.parse(plano.saida) as { acao: string; bloqueio: string; motivo: null };
  assert.equal(json.motivo, null);
  assert.equal(json.acao, 'sem-retry');
  assert.equal(json.bloqueio, 'gate.sem-reprovacao');

  // `retry run` sem nada a fazer sai != 0: e o sinal para o orquestrador parar.
  const run = ork(p.dir, ['retry', 'run', 'ork-clisemgate']);
  assert.equal(run.codigo, 1);
  assert.ok(run.saida.includes('nada executado'));

  const semThread = ork(p.dir, ['retry', 'plan']);
  assert.equal(semThread.codigo, 2);
  assert.ok(semThread.saida.includes('uso: ork retry plan'));

  const resume = ork(p.dir, ['retry', 'resume']);
  assert.equal(resume.codigo, 0);
  assert.ok(resume.saida.includes('Nenhum pedido'));
});

test('ork fix open/list/reverify conduz o sub-loop pelo binario, sem humano', (t) => {
  const p = projetoTemporario('b3-cli-fix');
  t.after(p.limpar);

  ork(p.dir, ['thread', 'new', 'cli go fix', '--modo', 'auto']);
  const id = 'ork-cligofix';
  ork(p.dir, [
    'claims',
    'add',
    id,
    'alvo.txt',
    '--claim',
    'o arquivo alvo.txt existe no HEAD',
    '--verificar',
    'test -f alvo.txt',
  ]);

  // CHECK reprovado: `fix open` sai != 0 e traz a spec exata.
  const aberto = ork(p.dir, ['fix', 'open', id]);
  assert.equal(aberto.codigo, 1);
  assert.ok(aberto.saida.includes('GO-FIX aberto'));
  assert.ok(aberto.saida.includes('claims.failed'));
  assert.ok(aberto.saida.includes('test -f alvo.txt'));
  assert.ok(aberto.saida.includes('COMPLETA obrigatoria (ha correcao tipo B)'));
  assert.ok(aberto.saida.includes('Spec exata despachada ao GO-FIX'));

  const lista = ork(p.dir, ['fix', 'list', id, '--json']);
  assert.equal(lista.codigo, 0);
  const correcoes = JSON.parse(lista.saida) as { id: string; tipo: string; estado: string }[];
  assert.equal(correcoes.length, 1);
  assert.equal(correcoes[0].tipo, 'B');
  assert.equal(correcoes[0].estado, 'aberta');

  // Parcial depois de tipo B e recusado pelo binario, com codigo != 0.
  const parcial = ork(p.dir, ['fix', 'reverify', id, '--parcial']);
  assert.notEqual(parcial.codigo, 0);
  assert.ok(parcial.saida.includes('tipo B'));
  assert.ok(parcial.saida.includes('COMPLETA'));

  // O GO-FIX corrige. O reverify da veredito POR correcao e sai 0.
  fs.writeFileSync(path.join(p.dir, 'alvo.txt'), 'existo\n', 'utf8');
  const reverify = ork(p.dir, ['fix', 'reverify', id]);
  assert.equal(reverify.codigo, 0);
  assert.ok(reverify.saida.includes('FX1'));
  assert.ok(reverify.saida.includes('APROVADA'));
  assert.ok(reverify.saida.includes('Veredito final: PASSOU'));

  // Nenhum `ork gate approve` foi chamado no caminho.
  const ledger = ork(p.dir, ['phase', 'list', id]);
  assert.equal(ledger.saida.includes('autorizado por'), false);
  assert.ok(ledger.saida.includes('go_fix_opened'));
  assert.ok(ledger.saida.includes('check_reverify'));

  const semRodada = ork(p.dir, ['fix', 'reverify', 'ork-cligofix', '--rodada', '9']);
  assert.notEqual(semRodada.codigo, 0);
  assert.ok(semRodada.saida.includes('nao existe'));
});

test('ork fix open sai 0 e nao inventa correcao quando o CHECK passa', (t) => {
  const p = projetoTemporario('b3-cli-fix-ok');
  t.after(p.limpar);

  ork(p.dir, ['thread', 'new', 'cli fix ok', '--modo', 'auto']);
  const r = ork(p.dir, ['fix', 'open', 'ork-clifixok']);
  assert.equal(r.codigo, 0);
  assert.ok(r.saida.includes('o CHECK PASSOU no HEAD real'));

  const lista = ork(p.dir, ['fix', 'list', 'ork-clifixok']);
  assert.equal(lista.codigo, 0);
  assert.ok(lista.saida.includes('nao tem rodada de GO-FIX'));
});

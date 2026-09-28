/**
 * Testes dos comandos novos do bloco B4 pelo BINARIO, nao pelas funcoes.
 *
 * Os adaptadores de host chamam `ork` por linha de comando, entao e a linha de comando que
 * precisa estar coberta: um `ork modos --do-pedido` que mude de formato quebra os tres hosts
 * de uma vez, e nenhum teste de funcao pura perceberia.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { exigirCatalogo } from '../src/catalogo';
import { CANARIOS } from '../src/canarios';
import { lerCasos } from '../src/evalrunner';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const ORK = path.join(RAIZ, 'core', 'dist', 'index.js');

function ork(args: string[]): { saida: string; codigo: number } {
  try {
    return {
      saida: execFileSync(process.execPath, [ORK, ...args], {
        cwd: RAIZ,
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

test('ork --help anuncia os comandos novos do bloco', () => {
  const { saida, codigo } = ork(['--help']);
  assert.equal(codigo, 0);
  for (const comando of ['prompt lint', 'prompt render', 'adapter install', 'eval']) {
    assert.ok(saida.includes(comando), `a ajuda nao cita "${comando}"`);
  }
});

test('ork modos mostra so o espectro VIVO, do mais HITL ao mais autonomo', () => {
  const { saida, codigo } = ork(['modos']);
  assert.equal(codigo, 0);
  // O espectro vivo, com o numero de blocos e de pausas de cada modo.
  for (const [tag, blocos, pausas] of [
    ['#Classic', '4', '3'],
    ['#Maestro', '3', '1'],
    ['#Auto', '1', '0'],
  ] as const) {
    const linha = saida
      .split('\n')
      .find((l) => l.trim().startsWith(tag + ' ') || l.trim().startsWith(tag.padEnd(10)));
    assert.ok(linha, `a tabela de modos nao tem a linha de ${tag}:\n${saida}`);
    assert.match(linha, new RegExp(`${tag}\\s+${blocos}\\s+${pausas}\\s`), linha);
  }
  // I-43: `#Look` e `#Ork` sairam da tabela; a thread antiga neles continua abrindo,
  // o que e provado por `fx-modo-aposentado-leitor`, nao aqui.
  for (const tag of ['#Look', '#Ork']) {
    assert.equal(saida.includes(tag), false, `a tabela ainda anuncia ${tag}`);
  }
  // O modo `#Default` saiu do produto: nem na tabela, nem no parse.
  assert.equal(saida.includes('#Default'), false, 'o modo #Default nao existe mais');
  assert.equal(ork(['modos', '--do-pedido', 'pedido antigo #Default']).saida.trim(), 'classic');
});

test('ork modos --do-pedido e o contrato que os 3 adaptadores consomem', () => {
  // Sem tag, vale o conduction.default_mode do manifesto deste projeto.
  assert.equal(ork(['modos', '--do-pedido', 'sem tag nenhuma']).saida.trim(), 'classic');

  for (const [pedido, esperado] of [
    ['Premissas delicadas #Classic', 'classic'],
    ['Filtro no dashboard #Maestro', 'maestro'],
    ['Documente o fluxo #Auto', 'auto'],
    ['caixa alta nao importa #AUTO', 'auto'],
  ] as const) {
    assert.equal(ork(['modos', '--do-pedido', pedido]).saida.trim(), esperado, pedido);
  }

  // I-43: a #TAG aposentada nao pode virar o default EM SILENCIO. O adaptador de host
  // recebe a recusa tipada e saida != 0, e quem escreveu a #TAG fica sabendo.
  for (const [pedido, tag] of [
    ['Migracao de risco #Look agora', '#Look'],
    ['Refatorar o checkout #Ork', '#Ork'],
  ] as const) {
    const r = ork(['modos', '--do-pedido', pedido]);
    assert.notEqual(r.codigo, 0, `${pedido} deveria recusar`);
    assert.match(r.saida, /modo\.aposentado/, r.saida);
    assert.ok(r.saida.includes(tag), `a recusa precisa nomear ${tag}: ${r.saida}`);
    // E ela nomeia o SUBSTITUTO vivo, derivado da lista, nunca um modo inexistente.
    assert.match(r.saida, /#Classic/, r.saida);
    assert.match(r.saida, /#Auto/, r.saida);
    // I-42: o #Fast existe, mas so roda a GO; ele nao substitui modo de vigilancia maxima.
    assert.equal(r.saida.includes('#Fast'), false, 'o substituto de um aposentado e de ciclo completo');
  }

  const json = JSON.parse(ork(['modos', '--do-pedido', 'algo #Maestro', '--json']).saida) as {
    modo: string;
    tag: string;
    daTag: boolean;
    origem: string;
    pausas: number;
  };
  assert.deepEqual(json, {
    modo: 'maestro',
    tag: '#Maestro',
    daTag: true,
    origem: 'tag no pedido',
    pausas: 1,
  });

  const semTag = JSON.parse(ork(['modos', '--do-pedido', 'nada aqui', '--json']).saida) as {
    daTag: boolean;
    origem: string;
  };
  assert.equal(semTag.daTag, false);
  assert.equal(semTag.origem, 'conduction.default_mode');
});

test('ork prompt lint e render funcionam no proprio repositorio', () => {
  const lint = ork(['prompt', 'lint']);
  assert.equal(lint.codigo, 0, 'os templates do produto precisam passar no lint');
  assert.ok(lint.saida.includes('erros: 0'));

  const render = ork([
    'prompt',
    'render',
    '--exemplo',
    '--fase',
    'GOAL',
    '--modo',
    'auto',
    '--pedido',
    'Documentar o fluxo de reembolso',
  ]);
  assert.equal(render.codigo, 0);
  assert.match(render.saida, /sha256 [0-9a-f]{64}/, 'o render mostra o mesmo sha do ledger');
  assert.ok(render.saida.includes('# Orkastery, fase GOAL'));
  assert.ok(render.saida.includes('Documentar o fluxo de reembolso'));
  assert.ok(render.saida.includes('REGRA CENTRAL: o modo afrouxa a pausa'));
  assert.ok(render.saida.includes('Pausas humanas desta thread: 0'), '#Auto nao pausa');
  assert.ok(!render.saida.includes('{{'), 'sobrou placeholder no prompt renderizado');

  const faseInvalida = ork(['prompt', 'render', '--exemplo', '--fase', 'F7']);
  assert.notEqual(faseInvalida.codigo, 0);
  assert.ok(faseInvalida.saida.includes('fora do ciclo canonico'));
});

test('ork eval sai verde neste catalogo e aceita filtro', () => {
  const corpus = lerCasos(RAIZ);
  assert.deepEqual(corpus.falhas, []);
  const casos = corpus.arquivos.flatMap(a => a.casos);
  const assercoes = casos.reduce((total, c) => total + c.assercoes.length, 0);
  const tudo = ork(['eval']);
  assert.equal(tudo.codigo, 0, 'o eval do produto precisa sair verde');
  assert.ok(tudo.saida.includes(`canarios: ${CANARIOS.length}/${CANARIOS.length} verdes`));
  assert.ok(tudo.saida.includes(`skills: ${corpus.arquivos.length} | casos: ${casos.length} | assercoes: ${assercoes} | falhas: 0`));
  assert.ok(tudo.saida.includes('VEREDITO: verde'));
  assert.ok(
    tudo.saida.includes('metade comportamental'),
    'o eval precisa dizer que a metade comportamental sai unavailable'
  );

  const umCanario = ork(['eval', '--canario', 'fx-hallucination', '--so-canarios']);
  assert.equal(umCanario.codigo, 0);
  assert.ok(umCanario.saida.includes('fx-hallucination'));
  assert.ok(!umCanario.saida.includes('fx-concurrency'));
});

test('ork adapter list e show trazem os 3 hosts com os pitfalls', () => {
  const lista = ork(['adapter', 'list']);
  assert.equal(lista.codigo, 0);
  for (const host of ['claude-code', 'hermes', 'openclaw']) {
    assert.ok(lista.saida.includes(host), `a lista nao cita ${host}`);
    const show = ork(['adapter', 'show', host]);
    assert.equal(show.codigo, 0);
    assert.ok(show.saida.includes('Os 3 pitfalls de instalacao'));
    assert.equal((show.saida.match(/prova: /g) ?? []).length, 3, `${host}: 3 provas`);
  }
  const desconhecido = ork(['adapter', 'show', 'cursor']);
  assert.equal(desconhecido.codigo, 2);
  assert.ok(desconhecido.saida.includes('host desconhecido'));
});

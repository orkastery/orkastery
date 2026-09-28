/**
 * I-43 (D8): o default de `ork thread list` para de mostrar o que ninguem pediu.
 *
 * O custo medido nao era a falta de flag, era o DEFAULT: 137 linhas para as 31 que
 * interessavam, com 71 delas (52 por cento) sendo `Sessao adotada claude-bg <uuid>`.
 * Quem pagava era quem nao sabia que existia flag, porque flag nenhuma existia.
 *
 * O GOAL pediu "so abertas". A medida corrigiu o pedido e este teste trava a correcao:
 * existe thread PAUSADA em disco, e um default que a esconde esconde justamente a que
 * mais pede atencao. Default = nao fechadas.
 *
 * Tudo em sandbox, nunca contra o board vivo (M8): `ork thread list` rodado dentro de
 * uma worktree le o estado da arvore principal, entao qualquer conferencia "no projeto"
 * viraria afirmacao sobre contagem de artefato vivo.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { gravarThread, lerThread, novaThread, tabelaDeThreads, threadsDaListagem } from '../src/thread';
import { ORDEM_DOS_MODOS, parseModo } from '../src/modos';

const CLI = path.resolve(__dirname, '../src/index.js');
function ork(cwd: string, args: string[]): { saida: string; codigo: number } {
  try {
    return { saida: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), codigo: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { saida: (err.stdout ?? '') + (err.stderr ?? ''), codigo: err.status ?? 1 };
  }
}

/** Uma aberta, uma pausada e uma fechada: o minimo que separa os tres casos. */
function tresEstados(p: ReturnType<typeof projetoTemporario>) {
  const aberta = novaThread(p.carregado, { nome: 'aberta', modo: 'classic' }).thread;
  const pausada = novaThread(p.carregado, { nome: 'pausada', modo: 'classic' }).thread;
  const fechada = novaThread(p.carregado, { nome: 'fechada', modo: 'classic' }).thread;
  const mudar = (id: string, status: 'pausada' | 'fechada'): void => {
    const t = lerThread(p.dir, id); t.status = status; gravarThread(p.dir, t);
  };
  mudar(pausada.id, 'pausada');
  mudar(fechada.id, 'fechada');
  return { aberta, pausada, fechada };
}

test('o default mostra as NAO fechadas: a pausada entra, a fechada nao', () => {
  const p = projetoTemporario('listagem-default');
  try {
    const { aberta, pausada, fechada } = tresEstados(p);

    const padrao = threadsDaListagem(p.dir);
    assert.deepEqual(padrao.map((l) => l.id).sort(), [aberta.id, pausada.id].sort());
    assert.equal(padrao.some((l) => l.id === fechada.id), false, 'fechada nao entra no default');

    // `--todas` abre o resto, e a soma bate com o disco.
    const todas = threadsDaListagem(p.dir, { todas: true });
    assert.equal(todas.length, 3);
    assert.equal(todas.some((l) => l.id === fechada.id), true);
    assert.equal(padrao.length + todas.filter((l) => l.status === 'fechada').length, todas.length);
  } finally { p.limpar(); }
});

test('o texto AVISA que escondeu, em vez de esconder em silencio', () => {
  const p = projetoTemporario('listagem-aviso');
  try {
    tresEstados(p);
    const padrao = tabelaDeThreads(p.dir);
    assert.match(padrao, /1 fechada\(s\) omitida\(s\)/, padrao);
    assert.match(padrao, /--todas/, padrao);
    // Com `--todas` nao ha o que avisar.
    assert.doesNotMatch(tabelaDeThreads(p.dir, { todas: true }), /omitida/);
  } finally { p.limpar(); }
});

test('--json devolve JSON de verdade em thread list e em thread status', () => {
  const p = projetoTemporario('listagem-json');
  try {
    const { aberta, fechada } = tresEstados(p);

    // Antes da I-43 os dois comandos ACEITAVAM `--json`, imprimiam TEXTO e saiam 0.
    const lista = ork(p.dir, ['thread', 'list', '--json']);
    assert.equal(lista.codigo, 0, lista.saida);
    const d = JSON.parse(lista.saida) as { todas: boolean; total: number; threads: { id: string }[] };
    assert.equal(d.todas, false);
    assert.equal(d.total, 2);
    assert.equal(d.threads.some((t) => t.id === fechada.id), false);

    const comTodas = JSON.parse(ork(p.dir, ['thread', 'list', '--todas', '--json']).saida) as { todas: boolean; total: number };
    assert.equal(comTodas.todas, true);
    assert.equal(comTodas.total, 3);

    const status = ork(p.dir, ['thread', 'status', aberta.id, '--json']);
    assert.equal(status.codigo, 0, status.saida);
    const t = JSON.parse(status.saida) as { id: string; modo: string; status: string };
    assert.equal(t.id, aberta.id);
    assert.equal(t.status, 'aberta');
  } finally { p.limpar(); }
});

test('a mensagem de lista vazia sugere um modo que parseModo ACEITA', () => {
  const p = projetoTemporario('listagem-vazia');
  try {
    // A divida pre-existente: a sugestao era `--modo default`, que `parseModo` recusa,
    // e e a origem provavel das 3 threads com `modo: default` gravadas em disco.
    const vazio = tabelaDeThreads(p.dir);
    assert.doesNotMatch(vazio, /--modo default/, vazio);
    const sugerido = /--modo (\S+)/.exec(vazio)?.[1];
    assert.ok(sugerido, `a mensagem precisa sugerir um modo: ${vazio}`);
    assert.notEqual(parseModo(sugerido!), null, `parseModo recusa o modo sugerido: ${sugerido}`);
    assert.ok((ORDEM_DOS_MODOS as readonly string[]).includes(sugerido!));

    // Com `--todas` o texto diz outra coisa: nao ha nada, nem fechada.
    assert.match(tabelaDeThreads(p.dir, { todas: true }), /Nenhuma thread em \.orkastery\/threads\./);
  } finally { p.limpar(); }
});

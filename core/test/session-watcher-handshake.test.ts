import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IdentidadeProcesso } from '../src/adapters/codex-runner';
import { esperarConfirmacaoDoPaiWatcher, esperarProntidaoWatcher } from '../src/session-watcher';

const IDENTIDADE: IdentidadeProcesso = { pid: 1234, inicio: '5678', boot: 'boot-SIMULADO' };

test('aperto do watcher: prontidao lenta continua enquanto o watcher vive', () => {
  let agora = 0;
  esperarProntidaoWatcher(
    () => agora >= 6000 ? 'confirmado' : 'pendente',
    IDENTIDADE,
    { agora: () => agora, pausar: () => { agora += 1000; }, estado: () => 'vivo' },
  );
  assert.equal(agora, 6000, 'o sinal posterior ao prazo antigo foi confirmado');
});

test('aperto do watcher: saida antes da prontidao falha sem consumir o teto', () => {
  let pausas = 0;
  assert.throws(
    () => esperarProntidaoWatcher(() => 'pendente', IDENTIDADE,
      { agora: () => 0, pausar: () => { pausas++; }, estado: () => 'ausente' }),
    /watcher sem prontidao confirmada/,
  );
  assert.equal(pausas, 0);
});

test('aperto do watcher: teto absoluto encerra a espera da prontidao', () => {
  let agora = 0;
  assert.throws(
    () => esperarProntidaoWatcher(() => 'pendente', IDENTIDADE,
      { agora: () => agora, pausar: () => { agora = 100000; }, estado: () => 'vivo' }),
    /watcher sem prontidao confirmada/,
  );
});

test('aperto do watcher: prontidao invalida falha sem esperar', () => {
  let pausas = 0;
  assert.throws(
    () => esperarProntidaoWatcher(() => 'invalido', IDENTIDADE,
      { agora: () => 0, pausar: () => { pausas++; }, estado: () => 'vivo' }),
    /watcher com prontidao invalida/,
  );
  assert.equal(pausas, 0);
});

test('aperto do watcher: ack lento continua enquanto o pai vive', async () => {
  let agora = 0;
  await esperarConfirmacaoDoPaiWatcher(
    () => agora >= 6000 ? 'confirmado' : 'pendente',
    IDENTIDADE,
    { agora: () => agora, pausar: async () => { agora += 1000; }, estado: () => 'vivo' },
  );
  assert.equal(agora, 6000, 'o ack posterior ao prazo antigo foi confirmado');
});

test('aperto do watcher: saida do pai antes do ack falha sem consumir o teto', async () => {
  let pausas = 0;
  await assert.rejects(
    esperarConfirmacaoDoPaiWatcher(() => 'pendente', IDENTIDADE,
      { agora: () => 0, pausar: async () => { pausas++; }, estado: () => 'ausente' }),
    /watcher sem confirmacao do pai/,
  );
  assert.equal(pausas, 0);
});

test('aperto do watcher: teto absoluto encerra a espera do ack', async () => {
  let agora = 0;
  await assert.rejects(
    esperarConfirmacaoDoPaiWatcher(() => 'pendente', IDENTIDADE,
      { agora: () => agora, pausar: async () => { agora = 100000; }, estado: () => 'vivo' }),
    /watcher sem confirmacao do pai/,
  );
});

test('aperto do watcher: ack invalido falha sem esperar', async () => {
  let pausas = 0;
  await assert.rejects(
    esperarConfirmacaoDoPaiWatcher(() => 'invalido', IDENTIDADE,
      { agora: () => 0, pausar: async () => { pausas++; }, estado: () => 'vivo' }),
    /watcher sem confirmacao do pai/,
  );
  assert.equal(pausas, 0);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withCreationLock } from '../src/creation-operation-store';
import { comLockInspecionavel, reservarDialogoHitl } from '../src/hitl-lock';
import { comRecursoPesado, dirDaFilaPesada, ErroDaFilaPesada } from '../src/fila-pesada';
import { adquirirTravaPortatil } from '../src/trava-portatil';
import { projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';
import { tomarConducao } from '../src/conducao';

test('journal usa a trava portátil no macOS e libera o candidato do dono', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-journal-portatil-'));
  try {
    withCreationLock(root, 'macos', () => assert.ok(true), 'darwin');
    withCreationLock(root, 'macos', () => assert.ok(true), 'darwin');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('macOS usa trava portátil para lock inspecionável e reserva recuperável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-hitl-portatil-'));
  try {
    comLockInspecionavel(dir, 'primeiro', () => {
      assert.throws(() => comLockInspecionavel(dir, 'concorrente', () => assert.fail(), 'darwin'), /ocupado/);
    }, 'darwin');
    const requestId = randomUUID(), connectionId = 'fixture';
    assert.throws(() => reservarDialogoHitl(dir, requestId, connectionId, true, 'darwin'),
      (erro: Error) => erro.message === 'hitl.channel.recovery-unproven');
    const soltar = reservarDialogoHitl(dir, requestId, connectionId, false, 'darwin');
    assert.throws(() => reservarDialogoHitl(dir, requestId, connectionId, true, 'darwin'), /in-use/);
    soltar();
    reservarDialogoHitl(dir, requestId, connectionId, true, 'darwin')();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fila pesada portátil preserva vaga, recusa concorrente e permite reentrada', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-fila-portatil-'));
  try {
    const vaga = adquirirTravaPortatil(path.join(dirDaFilaPesada(raiz), 'vaga-0'), 'fixture', { esperarMs: 0 });
    assert.ok(vaga);
    const pedido = { artefato: raiz, operacao: 'verify', thread: 'ork-fixture', slots: 1, esperarMs: 0 };
    assert.throws(() => comRecursoPesado(raiz, pedido, () => assert.fail(), { plataforma: 'darwin' }), ErroDaFilaPesada);
    vaga.liberar();
    comRecursoPesado(raiz, pedido, (uso) => {
      assert.equal(uso.situacao, 'adquirida');
      comRecursoPesado(raiz, pedido, (aninhado) => assert.equal(aninhado.situacao, 'reentrada'), { plataforma: 'darwin' });
    }, { plataforma: 'darwin' });
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('condução no macOS segura e libera a trava portátil da thread', () => {
  const p = projetoTemporario('conducao-portatil');
  const descritor = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'conducao portatil', modo: 'auto' });
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const tomada = tomarConducao(p.dir, thread.id, { canal: 'cli', operacao: 'verify', prazoMs: 1000 });
    assert.equal(tomada.ok, true);
    if (tomada.ok) tomada.liberar();
    const outra = tomarConducao(p.dir, thread.id, { canal: 'cli', operacao: 'verify', prazoMs: 1000 });
    assert.equal(outra.ok, true);
    if (outra.ok) outra.liberar();
  } finally {
    if (descritor) Object.defineProperty(process, 'platform', descritor);
    p.limpar();
  }
});

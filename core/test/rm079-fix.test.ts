import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { abrirRodada, lerParecerParaFix, reverificar, statusDaRodada } from '../src/fix';
import { dirThread, novaThread } from '../src/thread';
import { commitReal } from '../src/verify';
import { commitar, projetoTemporario } from './apoio';

function gravarParecer(raiz: string, thread: string, conteudo: string): void {
  const docs = path.join(dirThread(raiz, thread), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'check.md'), conteudo);
}

test('RM079 fix: parser bilíngue preserva arquivo, linha e reprodução como evidência', () => {
  const p = projetoTemporario('rm079-parser-parecer');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'parser parecer', modo: 'auto' });
    gravarParecer(p.dir, thread.id, [
      '# CHECK',
      'Verdict: NEEDS CHANGES',
      '- A7 [warning] core/src/example.ts:23 - public behavior diverges',
      '  reproduce: `node --test core/dist-test/test/example.test.js`',
    ].join('\n'));
    const parecer = lerParecerParaFix(p.dir, thread.id);
    assert.equal(parecer.veredito, 'PRECISA DE MUDANCA');

    gravarParecer(p.dir, thread.id, [
      '# CHECK',
      'Veredito: PRECISA DE MUDANCA',
      '- A7 [warning] core/src/example.ts:23 - public behavior diverges',
      '  reproduce: `node --test core/dist-test/test/example.test.js`',
    ].join('\n'));
    const [achado] = lerParecerParaFix(p.dir, thread.id).achados;
    assert.deepEqual(achado, { id: 'A7', severidade: 'aviso', arquivo: 'core/src/example.ts', linha: 23,
      descricao: 'public behavior diverges', reproduzir: 'node --test core/dist-test/test/example.test.js' });
  } finally { p.limpar(); }
});

test('RM079 fix: parecer negativo sem claim abre rodada e um CHECK novo fecha no HEAD', () => {
  const p = projetoTemporario('rm079-fix-parecer');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fix parecer', modo: 'auto' });
    gravarParecer(p.dir, thread.id, [
      '# Parecer do CHECK',
      'Veredito: PRECISA DE MUDANCA',
      '- A1 [bloqueador] alvo.txt:1 - falta o comportamento público esperado',
      '  reproduzir: `node --test core/dist-test/test/alvo.test.js`',
    ].join('\n'));

    const rodada = abrirRodada(p.carregado, thread.id);
    assert.equal(rodada.veredito, 'PRECISA DE MUDANCA');
    assert.equal(rodada.correcoes.length, 1);
    assert.equal(rodada.correcoes[0].origem, 'check.finding');
    assert.equal(rodada.correcoes[0].alvo, 'alvo.txt:1');
    assert.deepEqual(rodada.correcoes[0].verificar, []);
    assert.match(rodada.correcoes[0].evidencia, /reproduzir: node --test/);

    const aberto = statusDaRodada(p.dir, thread.id);
    assert.equal(aberto.estado, 'aberta');
    assert.deepEqual(aberto.faltam, ['FX1']);
    assert.deepEqual(aberto.achados[0], { correcao: 'FX1', achado: 'A1', origem: 'check.finding',
      arquivo: 'alvo.txt', linha: 1, estado: 'aberta', commitQueFechou: null });

    const aindaNegativo = reverificar(p.carregado, thread.id);
    assert.equal(aindaNegativo.veredito, 'PRECISA DE MUDANCA');
    assert.match(aindaNegativo.vereditos[0].detalhe, /aguarda novo parecer independente/);

    commitar(p.dir, 'alvo.txt', 'comportamento corrigido\n', 'FX1: corrige achado A1');
    gravarParecer(p.dir, thread.id, '# Parecer independente\n\nVeredito: PASSOU\n');
    const fechado = reverificar(p.carregado, thread.id);
    assert.equal(fechado.veredito, 'PASSOU');
    const status = statusDaRodada(p.dir, thread.id);
    assert.equal(status.estado, 'concluida');
    assert.deepEqual(status.faltam, []);
    assert.equal(status.achados[0].commitQueFechou, commitReal(p.dir));
  } finally { p.limpar(); }
});

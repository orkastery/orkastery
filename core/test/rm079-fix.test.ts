import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { abrirRodada, lerParecerParaFix, reverificar, statusDaRodada, textoDaRodada } from '../src/fix';
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
    gravarParecer(p.dir, thread.id, 'Veredito: PRECISA DE MUDANCA\n- A8 [aviso] core/src/example.ts:0 - linha invalida\n');
    assert.throws(() => lerParecerParaFix(p.dir, thread.id), /fix\.check\.finding\.line/);
  } finally { p.limpar(); }
});

test('RM079 fix: parecer ausente falha com motivo tipado', () => {
  const p = projetoTemporario('rm079-fix-parecer-ausente');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'parecer ausente', modo: 'auto' });
    assert.throws(() => abrirRodada(p.carregado, thread.id, { soClaims: true }),
      /fix\.check\.ausente: docs\/check\.md/);
  } finally { p.limpar(); }
});

test('RM079 fix: parecer sem veredito reconhecido falha com motivo tipado', () => {
  const p = projetoTemporario('rm079-fix-sem-veredito');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'parecer sem veredito', modo: 'auto' });
    gravarParecer(p.dir, thread.id, '# CHECK\n\nNenhum veredito foi escrito.\n');
    assert.throws(() => abrirRodada(p.carregado, thread.id, { soClaims: true }),
      /fix\.check\.veredito-ausente/);
  } finally { p.limpar(); }
});

test('RM079 fix: parecer com veredito malformado falha com motivo tipado', () => {
  const p = projetoTemporario('rm079-fix-veredito-malformado');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'veredito malformado', modo: 'auto' });
    gravarParecer(p.dir, thread.id, '# CHECK\n\nVeredito: TALVEZ\n');
    assert.throws(() => abrirRodada(p.carregado, thread.id, { soClaims: true }),
      /fix\.check\.veredito-malformado.*Veredito: TALVEZ/);
  } finally { p.limpar(); }
});

test('RM079 fix: linha de achado malformada e listada e falha a rodada', () => {
  const p = projetoTemporario('rm079-fix-achado-malformado');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'achado malformado', modo: 'auto' });
    gravarParecer(p.dir, thread.id, [
      'Veredito: PRECISA DE MUDANCA',
      '- A1 [bloqueador] alvo.ts:1 - achado valido',
      '- A2 sem formato e sem alvo',
    ].join('\n'));
    assert.throws(() => abrirRodada(p.carregado, thread.id, { soClaims: true }),
      /fix\.check\.finding\.malformado.*A2 sem formato e sem alvo/);
  } finally { p.limpar(); }
});

test('RM079 fix: texto do parecer chega redigido ao recibo e a saida CLI', () => {
  const p = projetoTemporario('rm079-fix-redacao-parecer');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fix redacao parecer', modo: 'auto' });
    gravarParecer(p.dir, thread.id, [
      'Veredito: PRECISA DE MUDANCA',
      '- A1 [bloqueador] alvo.txt:1 - falha em postgres://u:segredo@h/db',
      '  reproduzir: `node -e "console.log(\'postgres://u:segredo@h/db\')"`',
    ].join('\n'));
    const rodada = abrirRodada(p.carregado, thread.id, { soClaims: true });
    const serializado = JSON.stringify(rodada);
    const texto = textoDaRodada(rodada);
    assert.match(serializado, /\[credencial redigida\]@h\/db/);
    assert.match(texto, /\[credencial redigida\]@h\/db/);
    assert.doesNotMatch(serializado, /segredo@/);
    assert.doesNotMatch(texto, /segredo@/);
  } finally { p.limpar(); }
});

test('RM079 fix: linha malformada chega redigida ao erro da CLI', () => {
  const p = projetoTemporario('rm079-fix-redacao-erro');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fix redacao erro', modo: 'auto' });
    gravarParecer(p.dir, thread.id, [
      'Veredito: PRECISA DE MUDANCA',
      '- A2 sem formato em postgres://u:segredo@h/db',
    ].join('\n'));
    assert.throws(() => lerParecerParaFix(p.dir, thread.id), (erro: unknown) => {
      const mensagem = String((erro as Error).message);
      assert.match(mensagem, /\[credencial redigida\]@h\/db/);
      assert.doesNotMatch(mensagem, /segredo@/);
      return true;
    });
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

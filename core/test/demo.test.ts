/**
 * I-56 (RM-046, fase 2): `ork demo` mostra a afirmacao falsa reprovada e a corrigida aceita, com o
 * `ork verify` de verdade, e nao deixa rastro fora do proprio repositorio temporario.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { executarDemo } from '../src/demo';
import { lerLedger } from '../src/ledger';
import { dirTemporario, projetoTemporario } from './apoio';

test('a demo reprova a afirmacao falsa e aceita a corrigida, com o ledger contando as duas rodadas', () => {
  const alvo = path.join(dirTemporario('demo-manter'), 'repo');
  try {
    const linhas: string[] = [];
    const r = executarDemo({ dir: alvo, escrever: (l) => linhas.push(l) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.antes.motivos, ['claims.failed']);
    assert.equal(r.depois.ok, true);
    assert.equal(r.mantido, true, 'diretorio dado por quem roda nunca e apagado');
    const thread = fs.readdirSync(path.join(alvo, '.orkastery', 'threads'))[0];
    const rodadas = lerLedger(path.join(alvo, '.orkastery', 'threads', thread)).filter((e) => e.tipo === 'verify_run');
    assert.deepEqual(rodadas.map((e) => e.veredito), ['reprovado', 'verdade sustentada']);
    assert.match(linhas.join('\n'), /Veredito: REPROVADO \(claims\.failed\)[\s\S]*Veredito: VERDADE SUSTENTADA\./);
  } finally { fs.rmSync(path.dirname(alvo), { recursive: true, force: true }); }
});

test('a demo recusa diretorio com conteudo e, sem --dir, apaga o temporario no fim', () => {
  const cheio = dirTemporario('demo-cheio');
  try {
    fs.writeFileSync(path.join(cheio, 'meu.txt'), 'nao mexa');
    assert.throws(() => executarDemo({ dir: cheio }), /nao esta vazio/);
    assert.equal(fs.readFileSync(path.join(cheio, 'meu.txt'), 'utf8'), 'nao mexa');
    const r = executarDemo();
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(r.dir), false, 'temporario apagado');
  } finally { fs.rmSync(cheio, { recursive: true, force: true }); }
});

test('CLI: ork demo sai 0, narra os dois veredictos e nao toca o projeto de onde foi chamado', () => {
  const p = projetoTemporario('demo-cli');
  try {
    const threadsAntes = fs.readdirSync(path.join(p.dir, '.orkastery', 'threads'));
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), 'demo'],
      { cwd: p.dir, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1\. O agente entrega soma\.js e diz: "soma\(2, 2\) devolve 4\. Pronto\."/);
    assert.match(r.stdout, /REPROVADO \(claims\.failed\)[\s\S]*VERDADE SUSTENTADA/);
    assert.deepEqual(fs.readdirSync(path.join(p.dir, '.orkastery', 'threads')), threadsAntes);
  } finally { p.limpar(); }
});

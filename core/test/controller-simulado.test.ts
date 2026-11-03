import { strict as assert } from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { dirTemporario } from './apoio';
import { esperarFimDaFase, ProcessoDaFase } from './controller-simulado';

function filho(codigo: string): ChildProcess {
  return spawn(process.execPath, ['-e', codigo], { stdio: 'ignore' });
}

function comoArvore(processo: ChildProcess): ProcessoDaFase[] {
  assert.ok(processo.pid);
  return [{ pid: processo.pid, pai: processo.pid }];
}

test('esperarFimDaFase: retorna assim que o phase_result aparece no ledger', () => {
  esperarFimDaFase(() => true, [], { tetoMs: 100 });
});

test('esperarFimDaFase: acompanha o processo vivo além de um prazo fixo curto', () => {
  const dir = dirTemporario('esperar-fim-da-fase-viva');
  const marcador = path.join(dir, 'phase-result');
  const prazoFixoCurtoMs = 40;
  const processo = filho(`const fs=require('node:fs');setTimeout(()=>fs.writeFileSync(${JSON.stringify(marcador)},'ok'),120)`);
  const inicio = Date.now();
  try {
    esperarFimDaFase(() => fs.existsSync(marcador), comoArvore(processo), { folgaAposSaidaMs: 20, tetoMs: 2000 });
    assert.ok(Date.now() - inicio > prazoFixoCurtoMs, 'a espera não julgou pelo prazo fixo curto');
  } finally {
    processo.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('esperarFimDaFase: falha cedo quando a árvore sai sem phase_result no ledger', () => {
  const processo = filho('setTimeout(()=>{},30)');
  try {
    assert.throws(
      () => esperarFimDaFase(() => false, comoArvore(processo), { folgaAposSaidaMs: 20, tetoMs: 2000 }),
      /árvore de processos da fase saiu, mas faltou phase_result no ledger/,
    );
  } finally {
    processo.kill();
  }
});

test('esperarFimDaFase: falha no teto absoluto quando a árvore permanece viva sem phase_result', () => {
  const processo = filho('setInterval(()=>{},1000)');
  try {
    assert.throws(
      () => esperarFimDaFase(() => false, comoArvore(processo), { folgaAposSaidaMs: 20, tetoMs: 80 }),
      /teto absoluto da espera pelo fim da fase: faltou phase_result no ledger/,
    );
  } finally {
    processo.kill();
  }
});

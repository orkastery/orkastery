/**
 * RM-059 (T0.10): `ork claims conferir` com o sandbox de verdade do `ork_verify` (o codex local). Fica na
 * lista de integracoes locais: o runner hospedado do CI nao tem o codex. Os casos de contrato, com o sandbox
 * injetado, estao em `claims-conferir.test.ts`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { semCodexSandbox } from './ambiente-de-teste';
import { adicionarClaim, caminhoClaims } from '../src/claims';
import { conferirClaims } from '../src/claims-conferir';
import { conducaoDaThread } from '../src/conducao';
import { dirThread, novaThread } from '../src/thread';

test('o sandbox real aprova o que a worktree prova, reprova escrita fora dela e nao grava recibo', { skip: semCodexSandbox() }, () => {
  const p = projetoTemporario('conferir-sandbox-real');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sandbox real', modo: 'auto', criarWorktree: true });
    const fora = path.join(p.dir, 'escrito-fora-da-worktree.txt');
    const claim = (alegacao: string, comando: string) =>
      adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao, verificar: [comando], semProvaLocal: true }).id;
    const prova = claim('o README existe na worktree', 'test -f README.md');
    const fuga = claim('escreve fora da worktree', `echo fuga > ${fora}`);
    const antes = [path.join(dirThread(p.dir, thread.id), 'ledger.jsonl'), caminhoClaims(p.dir, thread.id)].map((f) => fs.readFileSync(f, 'utf8'));
    const r = conferirClaims(p.carregado, thread.id, { claims: [prova, fuga] });
    assert.equal(r.executor, 'codex-sandbox');
    assert.deepEqual(r.itens.map((i) => [i.id, i.verificado]), [[prova, true], [fuga, false]]);
    assert.equal(fs.existsSync(fora), false, 'o sandbox nao deixou escrever na arvore principal');
    assert.deepEqual([path.join(dirThread(p.dir, thread.id), 'ledger.jsonl'), caminhoClaims(p.dir, thread.id)].map((f) => fs.readFileSync(f, 'utf8')), antes);
    assert.equal(conducaoDaThread(p.dir, thread.id), null);
  } finally { p.limpar(); }
});

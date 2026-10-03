/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar), RM-008 (B8): com `claim_sem_prova_local`
 * declarada, o registro da claim roda o comando dela uma vez.
 *
 *  - Pelo MCP, `ork_claim_add` diz "Nao executa comandos", e o `ork_verify` so roda claim no sandbox.
 *    Com a policy, o registro pelo MCP rodava o texto da claim fora do sandbox, no processo do
 *    servidor, e por ate `verify.timeout_ms` dentro do pedido.
 *  - Pela CLI, com a worktree da thread apagada, o aviso culpava a claim ("reprova no verify").
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { NOME_MANIFESTO } from '../src/manifest';
import { adicionarClaimMcp } from '../src/mcp-artifacts';
import { lerThread, novaThread } from '../src/thread';
import { dirTemporario, projetoTemporario } from './apoio';

function declarar(dir: string): void {
  const arquivo = path.join(dir, NOME_MANIFESTO);
  fs.writeFileSync(arquivo, fs.readFileSync(arquivo, 'utf8').replace(/^policies:\n/m, 'policies:\n  claim_sem_prova_local: warn\n'));
}

test('suspeitas 03/10: com a policy, ork_claim_add pelo MCP nao roda o comando da claim', () => {
  const p = projetoTemporario('susp0310-claim-mcp');
  const fora = dirTemporario('susp0310-claim-mcp-fora');
  try {
    declarar(p.dir);
    const t = novaThread(p.carregado, { nome: 'claims', modo: 'auto' }).thread;
    const alvo = path.join(fora, 'executou-fora-do-sandbox');
    const inicio = Date.now();
    const c = adicionarClaimMcp(p.dir, t.id, { arquivo: 'README.md', alegacao: 'x', verificar: [`touch '${alvo}'; sleep 3`] });
    assert.equal(fs.existsSync(alvo), false, 'o texto da claim rodou no servidor MCP, fora do sandbox');
    assert.ok(Date.now() - inicio < 2500, 'o pedido MCP nao espera o comando da claim');
    assert.equal(c.estado, 'pendente');
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('suspeitas 03/10: com a worktree apagada, o aviso diz isso e nao culpa a claim', () => {
  const p = projetoTemporario('susp0310-claim-wt');
  try {
    declarar(p.dir);
    const t = novaThread(p.carregado, { nome: 'wt', modo: 'auto', criarWorktree: true }).thread;
    const wt = lerThread(p.dir, t.id).worktree!;
    assert.ok(wt && fs.existsSync(wt), 'a thread tem worktree');
    fs.rmSync(wt, { recursive: true, force: true });
    const c = adicionarClaim(p.dir, t.id, { arquivo: 'README.md', alegacao: 'o comando passa', verificar: ['true'] });
    const aviso = c.avisosDePolicy?.[0];
    assert.ok(aviso, 'avisa que a prova local nao rodou');
    assert.doesNotMatch(aviso.detalhe, /reprova no verify/, aviso.detalhe);
    assert.match(aviso.detalhe, /worktree/, aviso.detalhe);
  } finally { p.limpar(); }
});

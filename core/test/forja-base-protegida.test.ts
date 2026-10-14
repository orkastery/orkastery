import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pushRecusadoPelaProtecao } from '../src/forja';
import { lerLedger } from '../src/ledger';
import { ship } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { commitar, projetoTemporario } from './apoio';

test('pushRecusadoPelaProtecao: as frases da proteção do GitHub e do GitLab, e não um gancho qualquer nem a falta de acesso', () => {
  for (const texto of [
    ' ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs',
    'remote: error: GH006: Protected branch update failed for refs/heads/main.',
    'remote: error: GH013: Repository rule violations found for refs/heads/main.',
    ' ! [remote rejected] main -> main (push declined due to repository rule violations)',
    'remote: GitLab: You are not allowed to push code to protected branches on this project.\n ! [remote rejected] main -> main (pre-receive hook declined)',
    'remote: GitLab: You are not allowed to force push code to a protected branch on this project.',
  ]) assert.equal(pushRecusadoPelaProtecao(texto), true, texto);
  for (const texto of [
    ' ! [remote rejected] main -> main (pre-receive hook declined)',
    'remote: GitLab: You are not allowed to push code to this project.',
    ' ! [rejected] main -> main (fetch first)',
    'fatal: unable to access: The requested URL returned error: 403',
  ]) assert.equal(pushRecusadoPelaProtecao(texto), false, texto);
});

/** O remoto bare recusa todo push com estas linhas no stderr do gancho, que o git mostra com `remote: `. */
function comGancho(remoto: string, linhas: string[]): void {
  fs.writeFileSync(path.join(remoto, 'hooks', 'pre-receive'), `#!/bin/sh\n${linhas.map((l) => `echo '${l}' >&2`).join('\n')}\nexit 1\n`, { mode: 0o755 });
}

const RECUSAS: Record<string, string[]> = {
  github: ['error: GH006: Protected branch update failed for refs/heads/main.', 'error: Changes must be made through a pull request.'],
  'github-regra': ['error: GH013: Repository rule violations found for refs/heads/main.'],
  gitlab: ['GitLab: You are not allowed to push code to protected branches on this project.'],
};

for (const [forja, linhas] of Object.entries(RECUSAS)) {
  test(`push da base recusado pela proteção (${forja}): entrega.base-protegida com a orientação do PR/MR; o motivo do gate não muda`, () => {
    const projeto = projetoTemporario(`ship-protegida-${forja}`, true);
    try {
      comGancho(projeto.remoto as string, linhas);
      const { thread } = novaThread(projeto.carregado, { nome: `protegida ${forja}`, modo: 'auto', criarWorktree: true });
      commitar(thread.worktree as string, 'entrega.md', `# ${thread.id}\n`, `feat: entrega da thread ${thread.id}`);
      const r = ship(projeto.carregado, thread.id, { para: 'main' });
      assert.equal(r.bloqueado, true);
      assert.equal(r.motivo, 'runtime.unavailable');
      assert.equal(r.codigo, 'entrega.base-protegida');
      assert.match(r.detalhe, /a proteção de origin\/main recusou o push direto na base/);
      assert.match(r.correcao, /PR\/MR/);
      assert.ok(r.correcao.includes(`ork ship registrar-pr ${thread.id}`), r.correcao);
      const ev = lerLedger(dirThread(projeto.dir, thread.id)).filter((e) => e.tipo === 'ship_blocked');
      assert.equal(ev.at(-1)?.codigo, 'entrega.base-protegida');
    } finally { projeto.limpar(); }
  });
}

test('push da base recusado por outro gancho continua o erro de push de sempre, sem código', () => {
  const projeto = projetoTemporario('ship-gancho-qualquer', true);
  try {
    comGancho(projeto.remoto as string, ['o gancho da casa recusou este push']);
    const { thread } = novaThread(projeto.carregado, { nome: 'gancho qualquer', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', `# ${thread.id}\n`, `feat: entrega da thread ${thread.id}`);
    const r = ship(projeto.carregado, thread.id, { para: 'main' });
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.codigo, undefined);
    assert.match(r.detalhe, /push para origin\/main falhou/);
    assert.equal(lerLedger(dirThread(projeto.dir, thread.id)).filter((e) => e.tipo === 'ship_blocked').at(-1)?.codigo, undefined);
  } finally { projeto.limpar(); }
});

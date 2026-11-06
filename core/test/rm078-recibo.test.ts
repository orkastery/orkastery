import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim, anexarComando } from '../src/claims';
import { chaveDoReciboDeProva, mesmaChaveDoRecibo } from '../src/recibo-prova';
import { dirThread } from '../src/thread';
import { projetoDaEntrega, threadComWorktree } from './noctum-entrega-apoio';

function fixture(nome: string) {
  const p = projetoDaEntrega(nome);
  const t = threadComWorktree(p, nome);
  const docs = path.join(dirThread(p.dir, t.id), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'plan.md'), '# PLAN\n\nT1\n');
  adicionarClaim(p.dir, t.id, { arquivo: 'core/src/x.ts', alegacao: 'x devolve o valor', verificar: ['node -e "process.exit(0)"'], semProvaLocal: true });
  return { p, t };
}

test('RM-078 chave: HEAD, id/comandos das claims e bytes do plano invalidam isoladamente', () => {
  const { p, t } = fixture('rm078-chave');
  try {
    const head = 'a'.repeat(40);
    const inicial = chaveDoReciboDeProva(p.dir, t.id, head);
    assert.equal(mesmaChaveDoRecibo(inicial, chaveDoReciboDeProva(p.dir, t.id, head)), true);
    assert.equal(mesmaChaveDoRecibo(inicial, chaveDoReciboDeProva(p.dir, t.id, 'b'.repeat(40))), false, 'HEAD');

    anexarComando(p.dir, t.id, 'C1', 'node -e "process.exit(0)"');
    assert.equal(mesmaChaveDoRecibo(inicial, chaveDoReciboDeProva(p.dir, t.id, head)), false, 'comando da claim');

    const depoisDaClaim = chaveDoReciboDeProva(p.dir, t.id, head);
    fs.appendFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'plan.md'), '\nT2\n');
    assert.equal(mesmaChaveDoRecibo(depoisDaClaim, chaveDoReciboDeProva(p.dir, t.id, head)), false, 'plano');
  } finally { p.limpar(); }
});

test('RM-078 chave: dependência externa é explícita e plano ausente não vira equivalência', () => {
  const { p, t } = fixture('rm078-externa');
  try {
    adicionarClaim(p.dir, t.id, { arquivo: 'core/src/y.ts', alegacao: 'y responde', verificar: ['node -e "process.exit(0)"'],
      dependenciasExternas: ['rede'], semProvaLocal: true });
    const comRede = chaveDoReciboDeProva(p.dir, t.id, 'c'.repeat(40));
    assert.deepEqual(comRede.dependenciasExternas, ['rede']);
    fs.rmSync(path.join(dirThread(p.dir, t.id), 'docs', 'plan.md'));
    const semPlano = chaveDoReciboDeProva(p.dir, t.id, 'c'.repeat(40));
    assert.equal(semPlano.planoSha256, null);
    assert.equal(mesmaChaveDoRecibo(semPlano, semPlano), false);
  } finally { p.limpar(); }
});

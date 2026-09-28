import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { proporMaster } from '../src/master';
import { montarPulse, textoDoPulse } from '../src/pulse';

test('pulse põe a entrega sem nota na faixa automática, com as nove respostas de ratificação executáveis', () => {
  const p = projetoTemporario('master-pulse');
  try {
    const t = novaThread(p.carregado, { nome: 'pulse', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', {});
    proporMaster(p.dir, t.id, { score: 4, justificativa: 'justificativa apresentada', por: 'Codex' });
    const pulse = montarPulse(p.carregado, { consulta: { ok: true, sessoes: [], detalhe: '' } });
    // I-45: a fila de nota saiu na I-43; a entrega sem nota nao e mais pergunta ao dono.
    assert.match(textoDoPulse(pulse), /1 entrega\(s\) sem nota, aceitas por padrão com registro/);
    assert.ok(!pulse.precisaDeHumanoAgora.some(i => i.classe === 'score_pendente'));
    const item = pulse.acoesAutomaticas.find(i => i.classe === 'score_pendente')!;
    assert.equal(item.comandoResposta, 'ork master --aceitar-omissao');
    assert.equal(item.opcoes.length, 9);
    assert.match(item.pergunta, /4\/5.*justificativa apresentada/);
    const cli = path.resolve(__dirname, '../../dist/index.js');
    execFileSync(process.execPath, [cli, 'master', 'ratificar', '--resposta', item.opcoes[0], '--por', 'Julio'], { cwd: p.dir });
    assert.equal(lerThread(p.dir, t.id).status, 'fechada');
    assert.equal(lerThread(p.dir, t.id).score?.avaliadoPor, 'Julio');
  } finally { p.limpar(); }
});

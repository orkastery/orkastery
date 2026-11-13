import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { main } from '../src/index';
import { registrarEvidenciaDaAdocao, ErroDeAdocao } from '../src/adocao';
import { projetoComOrigemAdotavel } from './rm089-f6-forja-simulada';
import { lerThread } from '../src/thread';

test('CLI adotar publica estado retomável e não duplica a thread', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-cli'), cwd = process.cwd(), log = console.log;
  const saida: string[] = [];
  try {
    process.chdir(p.dir); console.log = (valor: unknown) => { saida.push(String(valor)); };
    const argv = ['adotar', p.origem, '--roadmap', 'RM-089', '--nome', 'Trabalho externo', '--modo', 'auto',
      '--perfil-check', 'revisor'];
    assert.equal(main(argv), 0);
    assert.match(saida.join('\n'), /Adoção preparada.*preparada.*Próximo/s);
    saida.length = 0;
    assert.equal(main(argv), 0);
    assert.match(saida.join('\n'), /Adoção retomada/);
  } finally { console.log = log; process.chdir(cwd); p.limpar(); }
});

test('transições exigem mesmo HEAD, CHECK independente e recibo do runner', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-estados');
  try {
    const r = require('../src/adocao') as typeof import('../src/adocao');
    const adotada = r.adotar(p.carregado, { ref: p.origem, roadmap: 'RM-089', nome: 'x', modo: 'auto', perfilCheck: 'r' });
    const head = adotada.thread.adocao!.sourceHead;
    assert.equal(lerThread(p.dir, adotada.thread.id).adocao?.estado, 'preparada');
    assert.equal(registrarEvidenciaDaAdocao(p.dir, adotada.thread.id, { tipo: 'verify', head, ok: true }).adocao?.estado, 'verificada');
    assert.equal(lerThread(p.dir, adotada.thread.id).adocao?.estado, 'verificada');
    assert.equal(registrarEvidenciaDaAdocao(p.dir, adotada.thread.id,
      { tipo: 'verify', head, ok: true }).adocao?.estado, 'verificada', 'retry pós-verify não repete transição');
    assert.throws(() => registrarEvidenciaDaAdocao(p.dir, adotada.thread.id,
      { tipo: 'check', head: 'f'.repeat(40), ok: true, independente: true }),
    (e: ErroDeAdocao) => e.codigo === 'adocao.evidencia-head-divergente');
    assert.equal(lerThread(p.dir, adotada.thread.id).adocao?.estado, 'verificada');
    assert.throws(() => registrarEvidenciaDaAdocao(p.dir, adotada.thread.id,
      { tipo: 'check', head, ok: true, independente: false }), (e: ErroDeAdocao) => e.codigo === 'adocao.check-invalido');
    assert.equal(registrarEvidenciaDaAdocao(p.dir, adotada.thread.id,
      { tipo: 'check', head, ok: true, independente: true }).adocao?.estado, 'revisada');
    assert.throws(() => registrarEvidenciaDaAdocao(p.dir, adotada.thread.id,
      { tipo: 'recibo', head, ok: true, contrato: 'ork.ci-bundle/v1' }), (e: ErroDeAdocao) => e.codigo === 'adocao.recibo-invalido');
    assert.equal(registrarEvidenciaDaAdocao(p.dir, adotada.thread.id,
      { tipo: 'recibo', head, ok: true, contrato: 'ork.ci-recibo-runner/v1' }).adocao?.estado, 'concluida');
  } finally { p.limpar(); }
});

/**
 * RM-053 (fatia 2): a rede no `ork doctor`, o retrato parado fora do `REDE.md`, a saida saneada do
 * `ork fabrica` e a trava orfa tirada em serie (W9).
 *
 * Nenhum teste toca a forja: o doctor so le arquivos de `ORK_USUARIO_DIR`, o `REDE.md` sai de uma
 * funcao pura e a fabrica e lida de um painel montado no teste.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checar } from '../src/doctor';
import { painelDaRede, RETRATO_PARADO_MS, retratoParado } from '../src/rede';
import { dirTemporario } from './apoio';

function naMaquina<T>(usuario: string, f: () => T): T {
  const antes = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  try { return f(); } finally {
    if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes;
  }
}

const semCrontab = () => ({ ok: false as const, motivo: 'teste' });

function checkDaRede(usuario: string, fora: string) {
  const c = naMaquina(usuario, () => checar(fora, [], semCrontab)).find((x) => x.nome === 'rede');
  assert.ok(c, 'o doctor tem o check "rede"');
  return c!;
}

test('RM-053 fatia 2 doctor: membro herdado com a casa ausente vira aviso com a falha do rede.log e a correcao', () => {
  const raiz = dirTemporario('rm053f2-doctor');
  try {
    const usuario = path.join(raiz, 'usuario'), fora = path.join(raiz, 'fora');
    fs.mkdirSync(path.join(usuario, 'rede'), { recursive: true });
    fs.mkdirSync(fora);

    // Fora da rede: ok, e diz como entrar.
    let c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'ok');
    assert.match(c.detalhe, /fora da rede; ork network entrar/);

    // O caso da srvjcp86 em 02/10: membro herdado da fabrica, toda publicacao caindo sem casa.
    fs.writeFileSync(path.join(usuario, 'maquina.json'), JSON.stringify({ contrato: 'ork.maquina/v1', nome: 'pc-a', fabricaCompartilhada: true }));
    const log = path.join(usuario, 'rede', 'rede.log');
    fs.writeFileSync(log, [
      JSON.stringify({ ts: '2026-09-02T17:17:53.612Z', acao: 'falhou', origem: 'evento', erro: 'rede.sem-forja: antiga' }),
      'linha quebrada {',
      JSON.stringify({ ts: '2026-09-03T06:08:44.187Z', acao: 'falhou', origem: 'pulse',
        erro: 'rede.sem-repositorio: github.com/p/orkastery-network ainda nao existe\n\u001b[31mFALSO\u001b[0m' }),
    ].join('\n') + '\n');
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'warn', 'a rede caindo nao passa calada');
    assert.match(c.detalhe, /membro herdado da fabrica/);
    assert.match(c.detalhe, /casa ainda nao gravada/);
    assert.match(c.detalhe, /nenhuma batida publicada/);
    assert.match(c.detalhe, /ultima falha 2026-09-03T06:08:44\.187Z \(pulse\): rede\.sem-repositorio/);
    assert.ok(!/[\u001b\n]/.test(c.detalhe), 'o erro do log chega numa linha, sem controle de terminal');
    assert.match(c.correcao ?? '', /ork network entrar/);

    // Uma batida publicada DEPOIS da falha: ok, com a casa e a hora da batida.
    const agora = Date.now();
    const marca = (em: number) => fs.writeFileSync(path.join(usuario, 'rede', 'publicada.json'), JSON.stringify({
      assinatura: 'x', em: new Date(em).toISOString(), commit: 'abc', casa: 'github.com/p/orkastery-network', forja: 'github',
      maquina: 'pc-a', projetos: [] }));
    marca(agora - 10 * 60 * 1000);
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'ok');
    assert.match(c.detalhe, /casa github\.com\/p\/orkastery-network/);
    assert.match(c.detalhe, /ultima batida .* \(ha 10 min\)/);
    assert.match(c.detalhe, /ultima falha 2026-09-03T06:08:44\.187Z/, 'a falha que ja passou continua dita');

    // A batida parada ha mais de 3 h: aviso, mesmo sem falha nova.
    marca(agora - 4 * 60 * 60 * 1000);
    fs.writeFileSync(log, '');
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'warn');
    assert.match(c.detalhe, /nenhuma falha no rede\.log/);
    assert.match(c.correcao ?? '', /cron do pulse/);

    // Quem saiu da rede: ok, e o doctor nao inventa casa.
    fs.writeFileSync(path.join(usuario, 'rede.json'), JSON.stringify({ contrato: 'ork.rede/v1', membro: false }));
    c = checkDaRede(usuario, fora);
    assert.equal(c.nivel, 'ok');
    assert.match(c.detalhe, /saiu com ork network sair/);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('RM-053 fatia 2 REDE.md: a regua do retrato parado e de 14 dias; batida ilegivel ou no futuro fica no indice', () => {
  const agora = Date.parse('2026-10-03T12:00:00Z');
  const dia = 24 * 60 * 60 * 1000;
  assert.equal(RETRATO_PARADO_MS, 14 * dia);
  assert.equal(retratoParado({ publicadoEm: new Date(agora - 14 * dia).toISOString() }, agora), false, 'no limite, fica');
  assert.equal(retratoParado({ publicadoEm: new Date(agora - 14 * dia - 1).toISOString() }, agora), true);
  assert.equal(retratoParado({ publicadoEm: 'ontem' }, agora), false, 'ilegivel nao se sabe parado');
  assert.equal(retratoParado({ publicadoEm: new Date(agora + 30 * dia).toISOString() }, agora), false, 'relogio adiantado fica');
  const retrato = (maquina: string, publicadoEm: string) => ({ contrato: 'ork.rede-maquina/v1' as const, maquina, hostname: maquina,
    adesao: 'rede' as const, forjas: [], runtimes: [], hosts: [], projetos: [], versaoOrk: '0.5.2', publicadoEm });
  const so = painelDaRede([retrato('pc-velho', new Date(agora - 40 * dia).toISOString())], agora);
  assert.match(so, /nenhuma máquina com batida recente/);
  assert.match(so, /Fora do índice, sem batida há mais de 14 dias: pc-velho/);
  assert.doesNotMatch(painelDaRede([], agora), /Fora do índice/);
});

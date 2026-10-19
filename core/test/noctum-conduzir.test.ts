/**
 * RM-058, integração (T5 da ork-rm058integra, D9): o condutor pelo CLI. O `ork noctum conduzir <arco>` confere o arco antes
 * da trava e conduz pelo `conduzirArco`, com os códigos 0 (o arco terminou ou parou), 2 (recusa), 3 (outro condutor vivo)
 * e 4 (a geração perdida). Os nomes começam por CJ. Contas, sessões e despachos são SIMULADOS (o apoio da N4); o comando
 * real roda num processo filho, num projeto descartável.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { abrirArco, pedidoV2, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { instancia, linhasDoLog, opcoesSimuladas } from './noctum-supervisao-apoio';
import { kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { proporEnvelope } from '../src/noctum-arco';
import { conduzirPeloCli } from '../src/noctum-cli';
import { dirDaSupervisao, gravarNaSupervisao, lerSupervisao } from '../src/noctum-supervisao';
import { dirThread, lerThread } from '../src/thread';

prepararIngressoSimulado();
assert.ok(kernelDisponivel(), 'o condutor exige /usr/bin/flock');
const CLI = path.resolve(__dirname, '../../dist/index.js');

const A: TrabalhoSimulado = { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA do condutor.' };
const ITENS = ['RM-901'];
const DUAS = [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }];
const SEM_DORMIR = { maxPassos: 1, dormir: () => undefined };

/** O vigia presente: um tique concluído agora, como o do cron (sem ele, o condutor não despacha nada novo). */
function vigiaPresente(p: ProjetoDeTeste, arco: string): void {
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'tique_iniciado', quem: instancia('vigia', 9) },
    { tipo: 'tique_concluido', quem: instancia('vigia', 9), resumo: 'SIMULADO' }]);
}

/** A trava do condutor tomada por este processo: o condutor que a tentar acha outro condutor vivo. */
function travaDoCondutor(p: ProjetoDeTeste, arco: string): number {
  const fd = tentarTravaExclusiva(path.join(dirDaSupervisao(p.dir, arco), 'condutor.lock'));
  assert.ok(fd !== null, 'a trava do condutor estava livre');
  return fd;
}

const cli = (p: ProjetoDeTeste, args: string[]) =>
  spawnSync(process.execPath, [CLI, 'noctum', 'conduzir', ...args], { cwd: p.dir, encoding: 'utf8', timeout: 60_000 });

test('CJ1: com outro condutor segurando a trava, sai 3 e não grava nada no log da supervisão', () => {
  const p = projetoTemporario('cj1');
  try {
    abrirArco(p.dir, 'arco-cj1', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-cj1');
    const antes = linhasDoLog(p.dir, 'arco-cj1');
    const fd = travaDoCondutor(p, 'arco-cj1');
    try {
      const registro: string[] = [];
      const r = conduzirPeloCli(p.carregado, 'arco-cj1', { ...opcoesSimuladas(p.dir, ITENS, registro), ...SEM_DORMIR });
      assert.deepEqual([r.acao, r.codigo], ['outro-condutor', 3], JSON.stringify(r));
      assert.deepEqual(linhasDoLog(p.dir, 'arco-cj1'), antes, 'nem geração nem batida');
      assert.equal(registro.length, 0);
    } finally { fs.closeSync(fd); }
  } finally { p.limpar(); }
});

test('CJ2: o arco nunca autorizado e o arco sem proposta recusam com 2, sem criar a trava', () => {
  const p = projetoTemporario('cj2');
  try {
    proporEnvelope(p.dir, pedidoV2('arco-cj2', { trabalhos: [A], contas: DUAS }));
    const r = conduzirPeloCli(p.carregado, 'arco-cj2', SEM_DORMIR);
    assert.ok(r.acao === 'nunca-autorizado' && r.codigo === 2 && r.motivo === 'noctum.modo.sem-envelope', JSON.stringify(r));
    assert.equal(fs.existsSync(path.join(dirDaSupervisao(p.dir, 'arco-cj2'), 'condutor.lock')), false, 'a trava nem foi criada');
    const sem = conduzirPeloCli(p.carregado, 'arco-cj2-outro', SEM_DORMIR);
    assert.deepEqual([sem.acao, sem.codigo], ['sem-arco', 2], JSON.stringify(sem));
  } finally { p.limpar(); }
});

test('CJ3: o arco terminal sai 0 sem tentar a trava nem gravar geração', () => {
  const p = projetoTemporario('cj3');
  try {
    abrirArco(p.dir, 'arco-cj3', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-cj3');
    revogarArco(p.dir, 'arco-cj3');
    // A trava presa aqui: o condutor que a tentasse sairia 3.
    const fd = travaDoCondutor(p, 'arco-cj3');
    try {
      const r = conduzirPeloCli(p.carregado, 'arco-cj3', SEM_DORMIR);
      assert.ok(r.acao === 'terminal' && r.codigo === 0 && r.situacao === 'revogado', JSON.stringify(r));
      assert.equal(lerSupervisao(p.dir, 'arco-cj3').geracao ?? null, null);
    } finally { fs.closeSync(fd); }
  } finally { p.limpar(); }
});

test('CJ4: com a parada da supervisão, sai 0 com o motivo, sem tentar a trava nem despachar', () => {
  const p = projetoTemporario('cj4');
  try {
    abrirArco(p.dir, 'arco-cj4', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-cj4');
    gravarNaSupervisao(p.carregado, 'arco-cj4', [{ tipo: 'parada', motivo: 'teto-do-arco', detalhe: 'o teto SIMULADO do arco chegou' }]);
    const fd = travaDoCondutor(p, 'arco-cj4');
    try {
      const registro: string[] = [];
      const r = conduzirPeloCli(p.carregado, 'arco-cj4', { ...opcoesSimuladas(p.dir, ITENS, registro), ...SEM_DORMIR });
      assert.ok(r.acao === 'parado' && r.codigo === 0 && r.motivo === 'teto-do-arco', JSON.stringify(r));
      assert.match(r.detalhe, /o teto SIMULADO do arco chegou$/);
      assert.equal(registro.length, 0);
      assert.equal(lerSupervisao(p.dir, 'arco-cj4').geracao ?? null, null);
    } finally { fs.closeSync(fd); }
  } finally { p.limpar(); }
});

test('CJ5: a geração tomada pelo vigia enquanto o condutor dorme sai 4, sem despacho depois', () => {
  const p = projetoTemporario('cj5');
  try {
    abrirArco(p.dir, 'arco-cj5', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-cj5');
    const registro: string[] = [];
    let dormiu = 0;
    const r = conduzirPeloCli(p.carregado, 'arco-cj5', { ...opcoesSimuladas(p.dir, ITENS, registro), instancia: 'condutor-cj5', maxPassos: 5,
      dormir: () => {
        dormiu += 1;
        const g = lerSupervisao(p.dir, 'arco-cj5').geracao!.numero + 1;
        gravarNaSupervisao(p.carregado, 'arco-cj5', [{ tipo: 'conducao_assumida', geracao: g, quem: instancia('vigia', 5), prova: 'SIMULADO' }]);
      } });
    assert.ok(r.acao === 'saiu' && r.codigo === 4 && r.ultimo?.acao === 'geracao-vencida', JSON.stringify(r));
    assert.deepEqual([dormiu, registro.length], [1, 1], 'um despacho antes de perder a geração, nenhum depois');
  } finally { p.limpar(); }
});

test('CJ6: o condutor sai 0 quando a fila esvazia, depois do MASTER por omissão que a entrega do passo faz', () => {
  const p = projetoTemporario('cj6');
  try {
    abrirArco(p.dir, 'arco-cj6', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-cj6');
    const registro: string[] = [];
    const primeiro = conduzirPeloCli(p.carregado, 'arco-cj6', { ...opcoesSimuladas(p.dir, ITENS, registro), ...SEM_DORMIR });
    assert.ok(primeiro.acao === 'saiu' && primeiro.codigo === 0 && primeiro.ultimo?.acao === 'despachou', JSON.stringify(primeiro));
    const thread = primeiro.ultimo.thread;
    registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { pushVerificado: true, tipoDeAutorizacao: 'noctum',
      evidencia: { arco: 'arco-cj6' }, simulado: true });
    const dormiu: number[] = [];
    const r = conduzirPeloCli(p.carregado, 'arco-cj6', { ...opcoesSimuladas(p.dir, ITENS, registro), maxPassos: 5, dormir: (ms) => { dormiu.push(ms); } });
    assert.ok(r.acao === 'saiu' && r.codigo === 0 && r.passos === 2 && r.ultimo?.acao === 'encerrar' && r.ultimo.entrega?.acao === 'nada',
      JSON.stringify(r));
    assert.equal(lerThread(p.dir, thread).status, 'fechada');
    assert.equal(lerLedger(dirThread(p.dir, thread)).filter(e => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao).length, 1);
    assert.deepEqual([dormiu, registro.length], [[0], 1]);
  } finally { p.limpar(); }
});

test('CJ7: o comando real, com a trava presa por outro processo, sai 3 e diz por quê, no texto e no JSON', () => {
  const p = projetoTemporario('cj7');
  try {
    abrirArco(p.dir, 'arco-cj7', { trabalhos: [A], contas: DUAS });
    vigiaPresente(p, 'arco-cj7');
    const fd = travaDoCondutor(p, 'arco-cj7');
    try {
      const r = cli(p, ['arco-cj7']);
      assert.equal(r.status, 3, r.stderr + r.stdout);
      assert.match(r.stdout, /^Condutor do arco arco-cj7: outro-condutor: outro processo conduz este arco agora/);
      const j = cli(p, ['arco-cj7', '--json']);
      assert.equal(j.status, 3, j.stderr);
      assert.deepEqual(JSON.parse(j.stdout), { acao: 'outro-condutor', codigo: 3,
        detalhe: 'outro processo conduz este arco agora (ou o vigia está no passo dele)' });
    } finally { fs.closeSync(fd); }
  } finally { p.limpar(); }
});

test('CJ8: o comando real recusa com 2, na saída de erro, o uso sem arco e o arco nunca autorizado', () => {
  const p = projetoTemporario('cj8');
  try {
    proporEnvelope(p.dir, pedidoV2('arco-cj8', { trabalhos: [A], contas: DUAS }));
    const uso = cli(p, []);
    assert.equal(uso.status, 2);
    assert.match(uso.stderr, /conduzir <arco> \[--json\]/);
    const r = cli(p, ['arco-cj8']);
    assert.equal(r.status, 2, r.stdout);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^Condutor do arco arco-cj8: nunca-autorizado \(noctum\.modo\.sem-envelope\): o arco arco-cj8 nunca foi autorizado/);
  } finally { p.limpar(); }
});

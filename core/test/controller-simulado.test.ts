import { strict as assert } from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import { test } from 'node:test';
import { IdentidadeProcesso } from '../src/adapters/codex-runner';
import { esperarFimDaFase, ProcessoDaFase } from './controller-simulado';

function filho(codigo: string): ChildProcess {
  return spawn(process.execPath, ['-e', codigo], { stdio: 'ignore' });
}

function comoArvore(processo: ChildProcess): ProcessoDaFase[] {
  assert.ok(processo.pid);
  return [{ pid: processo.pid, pai: processo.pid }];
}

function identidadeFalsa(pid: number): IdentidadeProcesso {
  return { pid, inicio: `inicio-${pid}`, boot: 'boot-falso' };
}

function relogioFalso(): { agora: () => number; pausar: (ms: number) => void; pausas: number[] } {
  let instante = 0;
  const pausas: number[] = [];
  return {
    agora: () => instante,
    pausar: (ms) => {
      assert.ok(ms > 0, 'a pausa lógica avança por um intervalo positivo');
      pausas.push(ms);
      instante += ms;
    },
    pausas,
  };
}

test('esperarFimDaFase: com tempo injetado retorna quando o phase_result aparece no ledger', () => {
  const tempo = relogioFalso();
  esperarFimDaFase(() => true, [], { agora: tempo.agora, pausar: tempo.pausar, tetoMs: 100 });
  assert.deepEqual(tempo.pausas, []);
});

test('esperarFimDaFase: com tempo injetado propaga o erro registrado do watcher antes de pausar', () => {
  const tempo = relogioFalso();
  let leituras = 0;
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      lerErroDoWatcher: () => { leituras++; return 'falha ao confirmar prontidao do watcher'; },
      tetoMs: 100000,
    }),
    /falha ao confirmar prontidao do watcher/,
  );
  assert.equal(leituras, 1);
  assert.deepEqual(tempo.pausas, []);
});

test('esperarFimDaFase: com tempo injetado acompanha processo vivo além do prazo antigo', () => {
  const tempo = relogioFalso();
  const processo = identidadeFalsa(101);
  const prazoAntigo = 40;
  esperarFimDaFase(() => tempo.agora() >= 120, [], {
    agora: tempo.agora,
    pausar: tempo.pausar,
    estadoDoProcesso: () => 'vivo',
    identidades: [processo],
    folgaAposSaidaMs: 20,
    tetoMs: 300,
  });
  assert.ok(tempo.agora() > prazoAntigo, 'a espera não julgou pelo prazo antigo');
});

test('esperarFimDaFase: com tempo injetado aguarda o watcher após runtime e supervisor saírem', () => {
  const tempo = relogioFalso();
  const runtime = identidadeFalsa(201);
  const supervisor = identidadeFalsa(202);
  const watcher = identidadeFalsa(203);
  esperarFimDaFase(() => tempo.agora() >= 120, [], {
    agora: tempo.agora,
    pausar: tempo.pausar,
    estadoDoProcesso: (id) => id?.pid === watcher.pid ? 'vivo' : 'ausente',
    identidades: [runtime, supervisor, watcher],
    folgaAposSaidaMs: 20,
    tetoMs: 300,
  });
  assert.ok(tempo.agora() >= 120);
});

test('esperarFimDaFase: com tempo injetado mantém watcher não anunciado pendente até o teto', () => {
  const tempo = relogioFalso();
  const runtime = identidadeFalsa(301);
  const supervisor = identidadeFalsa(302);
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      estadoDoProcesso: () => 'ausente',
      identidades: [runtime, supervisor],
      lerIdentidadePendente: () => null,
      folgaAposSaidaMs: 10,
      tetoMs: 60,
    }),
    /teto absoluto da espera pelo fim da fase: faltou phase_result no ledger; o watcher da sessão não se anunciou/,
  );
  assert.equal(tempo.agora(), 60);
});

test('esperarFimDaFase: com tempo injetado relê o watcher até o anúncio e observa a saída', () => {
  const tempo = relogioFalso();
  const runtime = identidadeFalsa(401);
  const supervisor = identidadeFalsa(402);
  const watcher = identidadeFalsa(403);
  let leiturasDoAnuncio = 0;
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      estadoDoProcesso: (id) => id?.pid === watcher.pid && tempo.agora() < 120 ? 'vivo' : 'ausente',
      identidades: [runtime, supervisor],
      lerIdentidadePendente: () => { leiturasDoAnuncio++; return tempo.agora() >= 60 ? watcher : null; },
      folgaAposSaidaMs: 20,
      tetoMs: 300,
    }),
    /a árvore de processos da fase saiu, mas faltou phase_result no ledger/,
  );
  assert.ok(leiturasDoAnuncio > 1, 'a espera releu o anúncio antes de julgar a saída da árvore');
  assert.ok(tempo.agora() < 300, 'a saída encerrou antes do teto absoluto');
});

test('esperarFimDaFase: com tempo injetado falha cedo quando a árvore sai sem phase_result', () => {
  const tempo = relogioFalso();
  const processo = identidadeFalsa(501);
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      estadoDoProcesso: () => tempo.agora() < 40 ? 'vivo' : 'ausente',
      identidades: [processo],
      folgaAposSaidaMs: 20,
      tetoMs: 300,
    }),
    /a árvore de processos da fase saiu, mas faltou phase_result no ledger/,
  );
  assert.ok(tempo.agora() < 300, 'a saída encerrou antes do teto absoluto');
});

test('esperarFimDaFase: integração com processo real observa a identidade completa até a saída sem phase_result', () => {
  const processo = filho('setTimeout(()=>{},30)');
  try {
    assert.throws(
      () => esperarFimDaFase(() => false, comoArvore(processo), { folgaAposSaidaMs: 20, tetoMs: 2000 }),
      /a árvore de processos da fase saiu, mas faltou phase_result no ledger/,
    );
  } finally {
    processo.kill();
  }
});

test('esperarFimDaFase: com tempo injetado limita pelo teto a árvore que permanece viva', () => {
  const tempo = relogioFalso();
  const processo = identidadeFalsa(601);
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      estadoDoProcesso: () => 'vivo',
      identidades: [processo],
      folgaAposSaidaMs: 20,
      tetoMs: 80,
    }),
    /teto absoluto da espera pelo fim da fase: faltou phase_result no ledger/,
  );
  assert.equal(tempo.agora(), 80);
});

test('esperarFimDaFase: com tempo injetado identifica no teto o watcher anunciado ainda vivo', () => {
  const tempo = relogioFalso();
  const watcher = identidadeFalsa(701);
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      estadoDoProcesso: () => 'vivo',
      lerIdentidadePendente: () => watcher,
      folgaAposSaidaMs: 20,
      tetoMs: 80,
    }),
    /teto absoluto da espera pelo fim da fase: faltou phase_result no ledger; o watcher da sessão ainda estava vivo/,
  );
  assert.equal(tempo.agora(), 80);
});

test('esperarFimDaFase: com tempo injetado leva a lista vazia ao teto absoluto', () => {
  const tempo = relogioFalso();
  assert.throws(
    () => esperarFimDaFase(() => false, [], {
      agora: tempo.agora,
      pausar: tempo.pausar,
      estadoDoProcesso: () => 'ausente',
      folgaAposSaidaMs: 10,
      tetoMs: 60,
    }),
    /teto absoluto da espera pelo fim da fase: faltou phase_result no ledger; não havia processo observável/,
  );
  assert.equal(tempo.agora(), 60);
});

/**
 * RM-037, defeitos de condução de 19 e 20/10/2026, defeito 2, com o achado 2 do CHECK 3 da ork-rm037defeit2: o preparo de
 * `worktree.dependencias` nunca roda dentro da vez de despachar do arco #Noctum.
 *
 * O passo do arco segura `despacho.lock` (um despachante por vez, em todos os arcos da raiz de estado), reserva o despacho e
 * abre a thread nova; o preparo, que leva até 10 min, rodava ali. Aqui o comando do preparo testa a trava com `flock -n` e
 * anota se ela estava livre ou ocupada. Arco, item, pedido, conta e despacho são SIMULADOS; a abertura da thread (com a
 * worktree) e a baseline são as do núcleo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, commitar, dirTemporario, ProjetoDeTeste, projetoTemporario } from './apoio';
import { abrirArco, prepararIngressoSimulado } from './noctum-apoio';
import { registrarConducaoDaSessao } from '../src/conducao';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, registrar } from '../src/ledger';
import { lerArco } from '../src/noctum-arco';
import { OpcoesDoPasso, passoDoArco } from '../src/noctum-execucao';
import { ResultadoRun } from '../src/phase';
import { dirThread, lerThread, listarIds } from '../src/thread';

prepararIngressoSimulado();

const MAQUINA = 'maquina-simulada';
const ITEM = 'RM-952';

/** O despacho simulado: o que o `phase run` deixa no disco quando abre a sessão (a condução e o phase_dispatch). */
function despachoSimulado(registro: string[]): NonNullable<OpcoesDoPasso['despachar']> {
  return (carregado, threadId, o) => {
    const sessionId = `00000000-0000-4000-8000-${String(registro.length + 1).padStart(12, '0')}`;
    registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
    registrar(dirThread(carregado.raiz, threadId), threadId, 'phase_dispatch', { fase: o.fase, sessionId, runtime: 'claude-bg', pausaAoFim: false });
    registro.push(`${threadId}:${o.fase}`);
    return { sessionId, verificada: true, bloqueado: false, motivo: null } as unknown as ResultadoRun;
  };
}

/** O projeto cujo build depende do que o git ignora, com o preparo que anota a trava de despacho e cria a ferramenta. */
function projeto(prova: string): ProjetoDeTeste {
  const p = projetoTemporario('rm037d2010-arco');
  const trava = path.join(p.dir, '.orkastery', 'noctum', 'despacho.lock');
  const preparo = `if flock -n '${trava}' true; then echo livre; else echo ocupada; fi >> '${prova}'; ` +
    'mkdir -p deps && ln -sf /bin/true deps/ferramenta';
  ajustarManifesto(p, '  # build: nao detectado', '  build: "deps/ferramenta"');
  ajustarManifesto(p, /^( {2}por_thread: .*)$/m, `$1\n  dependencias: "${preparo}"`);
  commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'manifesto com o build e o preparo');
  commitar(p.dir, '.gitignore', 'deps/\n', 'o que o git ignora');
  return p;
}

test('defeito 2 (CHECK 3): o passo do arco abre a thread sem o preparo; a baseline o roda fora da trava de despacho e o despacho sai depois',
  { skip: !kernelDisponivel() }, () => {
    const pasta = dirTemporario('rm037d2010-arco-prova');
    const prova = path.join(pasta, 'trava.txt');
    const p = projeto(prova);
    try {
      abrirArco(p.dir, 'arco-d2', { trabalhos: [{ id: 'w1', item: ITEM, prioridade: 1, dependeDe: [], pedido: 'Fatia SIMULADA do arco.' }] });
      const registro: string[] = [];
      // Sem `abrirThread` nem `gravarBaseline`: a abertura com a worktree e a baseline do núcleo.
      const opcoes: OpcoesDoPasso = { maquina: MAQUINA, perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }],
        lerReservas: () => ({ leitura: 'copia-local' as const, reservas: [{ item: ITEM, maquina: MAQUINA, thread: null }] }),
        consultarSessoes: () => ({ sessoes: [], fontes: [{ origem: 'claude agents --json (conta do processo)', ok: true, detalhe: '' }],
          contas: [{ runtime: 'claude-bg' as const, perfil: null }] }),
        despachar: despachoSimulado(registro) };
      const r0 = passoDoArco(p.carregado, 'arco-d2', opcoes);
      assert.ok(r0.acao === 'aguardar' && r0.motivo === 'baseline-gravada', JSON.stringify(r0));
      assert.equal(fs.readFileSync(prova, 'utf8'), 'livre\n', 'o preparo rodou uma vez, com a trava de despacho livre');
      const [id] = listarIds(p.dir).filter((t) => lerThread(p.dir, t).roadmap === ITEM);
      const wt = lerThread(p.dir, id).worktree!;
      assert.ok(fs.existsSync(path.join(wt, 'deps', 'ferramenta')), 'o preparo rodou dentro da worktree da thread');
      const ledger = lerLedger(dirThread(p.dir, id));
      const tipos = ledger.map((e) => e.tipo);
      assert.ok(tipos.indexOf('worktree_dependencias_pendentes') >= 0 &&
        tipos.indexOf('worktree_dependencias_pendentes') < tipos.indexOf('worktree_dependencias') &&
        tipos.indexOf('worktree_dependencias') < tipos.indexOf('baseline_recorded'), tipos.join(' '));
      assert.equal(ledger.find((e) => e.tipo === 'worktree_dependencias')?.ok, true);
      const baseline = ledger.find((e) => e.tipo === 'baseline_recorded')!;
      assert.equal((baseline.comandos as Array<{ nome: string; ok: boolean }>).find((c) => c.nome === 'build')?.ok, true,
        'a baseline rodou com as dependencias');
      assert.deepEqual(lerArco(p.dir, 'arco-d2')!.despachos.map((d) => `${d.desfecho}:${d.motivo ?? ''}`), ['recusado:baseline.pendente']);
      assert.deepEqual(registro, []);
      const r1 = passoDoArco(p.carregado, 'arco-d2', opcoes);
      assert.ok(r1.acao === 'despachou' && r1.thread === id && r1.fase === 'GOAL', JSON.stringify(r1));
      assert.equal(registro.length, 1);
      assert.equal(fs.readFileSync(prova, 'utf8'), 'livre\n', 'o preparo nao roda de novo');
    } finally { p.limpar(); fs.rmSync(pasta, { recursive: true, force: true }); }
  });

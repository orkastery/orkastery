/** T8: subprocessos, CLI e estado canônico reais; protocolo Codex sintético. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Canario } from './canarios';
import { sandboxGit } from './sandbox';
import { novaThread, gravarThread, dirThread } from './thread';
import { lerLedger, registrar } from './ledger';
import { iniciarSupervisor, identidadeProcesso, estadoProcesso, ProcessoCodex } from './adapters/codex-runner';
import { observarSessao, LIMITE_MORTE_MS } from './session-watcher';
import { auditarEstado } from './estado-thread';
import { cliDoCatalogo } from './catalogo';

const linha = (e: unknown) => JSON.stringify(e) + '\n';
function esperar(teste: () => boolean): void {
  const limite = Date.now() + 5000;
  while (!teste()) {
    if (Date.now() >= limite) throw new Error('subprocesso do canário não terminou em 5000 ms');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

export const CANARIO_SENSORES: Canario = {
  id: 'fx-sensores-runtime', sobre: 'hooks, supervisor e watcher integrados em sandbox Git', precisaDeGit: true,
  rodar: ({ catalogo }) => {
    const s = sandboxGit('sensores-runtime');
    try {
      const t = novaThread(s.carregado, { nome: 'sensores', modo: 'auto', criarWorktree: true }).thread;
      const dir = dirThread(s.dir, t.id), wt = t.worktree!;
      const iniciadoEm = new Date(Date.now() - 1000).toISOString();
      const sessao = (sessionId: string, runtime: string) => {
        t.sessoes.push({ sessionId, runtime, slug: t.slug, fase: 'GO', bloco: 'GO', despachadaEm: iniciadoEm,
          promptPath: '', promptSha256: '', verificada: true });
        gravarThread(s.dir, t);
      };
      sessao('fixture-claude', 'claude-bg');
      const hook = path.join(catalogo, 'adapters/claude-code/hooks/ork-sensor.js');
      const cli = cliDoCatalogo(catalogo);
      const start = Date.now();
      const h = spawnSync(process.execPath, [hook], { cwd: wt, encoding: 'utf8', timeout: 5000,
        input: JSON.stringify({ cwd: wt, session_id: 'fixture-claude', hook_event_name: 'PermissionRequest', tool_use_id: 'fixture-tool' }),
        env: { ...process.env, ORK_SENSOR_CLI: cli } });
      if (h.status !== 0 || h.stderr || h.stdout) throw new Error('hook/CLI do canário indisponível');
      const hookLatenciaMs = Date.now() - start;
      const bloqueio = lerLedger(dir).find(e => e.tipo === 'sessao_bloqueada');
      const carimboLatenciaMs = bloqueio ? Date.parse(String(bloqueio.recebidoEm)) - Date.parse(bloqueio.ts) : null;
      const classificacoes: string[] = [];
      let duplicatas = 0, subprocessosComRecibo = 0;
      for (const [indice, mensagem] of ['Concluído.', 'Você confirma?', 'Motivo: lease.busy'].entries()) {
        const sid = `fixture-codex-${indice}`; sessao(sid, 'codex');
        const log = path.join(dir, 'sessoes', `${sid}.jsonl`);
        const protocolo = linha({ type: 'thread.started', thread_id: sid }) + linha({ type: 'turn.started' }) +
          linha({ type: 'turn.completed', last_agent_message: mensagem, usage: { input_tokens: 10, output_tokens: 2 } });
        const metadados = iniciarSupervisor([process.execPath, '-e', 'process.stdout.write(process.argv[1])', protocolo], wt, log, process.env);
        esperar(() => fs.existsSync(metadados.reciboPath));
        subprocessosComRecibo++;
        registrar(dir, t.id, 'session_sensor_registered', { sessionId: sid, despachoEm: iniciadoEm, logPath: log, ...metadados });
        const r = observarSessao({ ...s.carregado, raiz: wt }, sid, { rollout: null });
        classificacoes.push(r.classificacao ?? 'unavailable');
        observarSessao({ ...s.carregado, raiz: wt }, sid, { rollout: null });
        duplicatas += Math.abs(lerLedger(dir).filter(e => e.tipo === 'phase_result' && e.sessionId === sid).length - 1);
      }
      // A identidade vem de um processo realmente executado e encerrado, sem recibo.
      const runner = require.resolve('./adapters/codex-runner');
      const morto = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(process.argv[1]).identidadeProcesso(process.pid)))`, runner],
        { cwd: wt, encoding: 'utf8', timeout: 5000 });
      if (morto.status !== 0) throw new Error('processo de morte do canário indisponível');
      const filho = JSON.parse(morto.stdout);
      if (estadoProcesso(filho) !== 'ausente') throw new Error('processo ainda não está ausente');
      const sid = 'fixture-morto'; sessao(sid, 'codex');
      const log = path.join(dir, 'sessoes', `${sid}.jsonl`), inicio = Date.parse(iniciadoEm);
      fs.writeFileSync(log, linha({ type: 'thread.started', thread_id: sid })); fs.utimesSync(log, inicio / 1000, inicio / 1000);
      const processo: ProcessoCodex = { schema: 'ork.codex-process/v1', iniciadoEm, supervisor: identidadeProcesso(process.pid), filho };
      fs.writeFileSync(log + '.process.json', JSON.stringify(processo));
      registrar(dir, t.id, 'session_sensor_registered', { sessionId: sid, despachoEm: iniciadoEm, logPath: log, processoPath: log + '.process.json' });
      const antes = observarSessao(s.carregado, sid, { rollout: null, agoraMs: inicio + LIMITE_MORTE_MS - 1 });
      observarSessao(s.carregado, sid, { rollout: null, agoraMs: inicio + LIMITE_MORTE_MS });
      const mortes = lerLedger(dir).filter(e => e.tipo === 'sessao_morta' && e.sessionId === sid);
      return { tipoProva: 'harness isolado; protocolo Codex sintético', classificacoes, subprocessosComRecibo,
        hookLatenciaMs, carimboLatenciaMs, hookAbaixo5s: !!bloqueio && hookLatenciaMs < 5000 && carimboLatenciaMs !== null && carimboLatenciaMs < 5000,
        morteAntesDoLimite: antes.concluido, morteLatenciaMs: mortes[0]?.morteLatenciaMs ?? null,
        mortosSemEvento: mortes.length === 1 ? 0 : 1, duplicatas,
        estadoUnico: auditarEstado(s.dir, t.id, wt).nivel === 'ok' &&
          fs.realpathSync(path.join(wt, '.orkastery/threads', t.id)) === dir };
    } finally { s.limpar(); }
  },
};

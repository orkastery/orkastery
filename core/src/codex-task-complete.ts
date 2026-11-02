/** RM-075: prova somente leitura de `task_complete` no rollout já fixado pelo controller. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { consumirRolloutControllerFixado, EsperadoController, FonteController,
  lerFonteControllerFixada } from './adapters/codex-controller-sensor';
import { ParserCodex, TerminalCodex } from './adapters/codex-events';
import { dirThread } from './thread';
import { EventoLedger, Thread } from './types';
import { SessaoDespachada } from './session-events';

export interface TaskCompleteFixado {
  terminal: TerminalCodex;
  fonte: FonteController;
}

const BLOCO = 256 * 1024;

/** O parser percorre o descritor autenticado inteiro; linha parcial ou corrupção não prova terminal. */
export function taskCompleteFixadoDaFonte(fonte: FonteController, agoraMs = Date.now()): TaskCompleteFixado | null {
  return consumirRolloutControllerFixado(fonte, (fd, tamanho) => {
    const parser = new ParserCodex();
    let terminal: TerminalCodex | null = null;
    for (let offset = 0; offset < tamanho;) {
      const buffer = Buffer.alloc(Math.min(BLOCO, tamanho - offset));
      const lidos = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (lidos <= 0) break;
      for (const atual of parser.push(buffer.subarray(0, lidos), agoraMs)) terminal = atual;
      offset += lidos;
    }
    if (parser.estado.invalido || parser.bytesPendentes > 0 || parser.estado.turnoAberto ||
        terminal?.fonte !== 'rollout.task_complete' ||
        (terminal.numeroTurno ?? 0) < parser.estado.turnos) return null;
    return { terminal, fonte };
  });
}

/**
 * Resolve somente a fixação correspondente ao despacho. Sem pin autenticado, controller ou cwd,
 * devolve `null`: nunca descobre outro rollout para fabricar a prova.
 */
export function taskCompleteFixadoDaSessao(raiz: string, thread: Thread, sessao: SessaoDespachada,
    eventos: readonly EventoLedger[], agoraMs = Date.now()): TaskCompleteFixado | null {
  if (sessao.runtime !== 'codex') return null;
  const registro = eventos.filter(e => e.tipo === 'session_sensor_registered' &&
    e.sessionId === sessao.sessionId && e.despachoEm === sessao.despachadaEm).at(-1);
  if (typeof registro?.controlador !== 'string') return null;
  const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId).at(-1);
  if (despacho?.controlador !== undefined && despacho.controlador !== registro.controlador)
    throw new Error('controlador registrado divergente do despacho');
  const cwd = (despacho?.cwd ?? registro.cwd) as string | undefined;
  if (!cwd) return null;
  const dir = dirThread(raiz, thread.id);
  const chave = createHash('sha256').update(sessao.sessionId + '|' + sessao.despachadaEm).digest('hex');
  const esperado: EsperadoController = {
    dirSessoes: path.join(dir, 'sessoes'), sessionId: sessao.sessionId, cwd,
    despachoEm: sessao.despachadaEm, agoraMs,
    fixacao: path.join(dir, 'sessoes', `watcher-source-${chave}.json`),
    vinculo: { thread: thread.id, fase: sessao.fase, promptSha256: sessao.promptSha256 },
  };
  const fonte = lerFonteControllerFixada(esperado.fixacao!, esperado);
  return fonte ? taskCompleteFixadoDaFonte(fonte, agoraMs) : null;
}

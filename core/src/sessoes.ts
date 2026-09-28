/**
 * `ork sessions`: observabilidade real das sessoes despachadas.
 *
 * A fonte da verdade e o runtime (`claude agents --json`), nunca o `thread.json`.
 * O `ork` cruza as duas visoes e denuncia divergencia em vez de repetir o self-report.
 */

import * as adapter from './adapters/claude-bg';
import { inventariarSessoes, InventarioDeSessoes } from './sessoes-inventario';
import { tabela } from './util';

export function textoDoInventario(r: InventarioDeSessoes): string {
  const linhas = [
    `Inventário ${r.escopo.global ? 'global' : 'do projeto'} da conta ${r.escopo.usuario}; histórico: ${r.escopo.historico ? 'incluído' : 'omitido'}.`,
    `Fontes: ${r.fontes.map(f => `${f.origem} (${f.ok ? 'ok' : 'FALHA'})`).join('; ')}`,
    `Total: ${r.total}; sem thread: ${r.semThread}; ambíguas: ${r.ambiguas}; consulta: ${r.ok ? 'válida' : 'INCOMPLETA'}.`,
  ];
  if (r.sessoes.length) linhas.push(tabela(['ID', 'RUNTIME', 'ESTADO', 'THREAD/FASE'],
    r.sessoes.map(s => [s.sessionId, s.runtime, s.state ?? s.status ?? 'unknown',
      s.vinculos.map(v => `${v.thread}/${v.fase}`).join(', ') || '(fora do ork)'])));
  for (const f of r.fontes.filter(f => !f.ok)) linhas.push(`Falha: ${f.detalhe}`);
  return linhas.join('\n');
}

export function tabelaDeSessoes(raiz: string, todas = false): string {
  return textoDoInventario(inventariarSessoes(raiz, { todas }));
}

/** Logs de uma sessao pelo id curto, id completo ou nome. */
export function logsDaSessao(chave: string, linhas: number): { texto: string; codigo: number } {
  const r = adapter.logs(chave, linhas);
  return { texto: r.texto, codigo: r.ok ? 0 : 1 };
}

/** Para uma sessao pelo id curto, id completo ou nome. */
export function pararSessao(chave: string): { texto: string; codigo: number } {
  const s = adapter.acharSessao(chave);
  if (!s) return { texto: `sessao "${chave}" nao encontrada no runtime`, codigo: 1 };
  const r = adapter.parar(s.id ?? s.sessionId);
  return { texto: r.texto || `sessao ${s.sessionId} parada`, codigo: r.ok ? 0 : 1 };
}

/** Comando de attach (precisa de TTY, entao o CLI imprime em vez de executar). */
export function comandoDeAttach(chave: string): { texto: string; codigo: number } {
  const s = adapter.acharSessao(chave);
  if (!s) return { texto: `sessao "${chave}" nao encontrada no runtime`, codigo: 1 };
  return { texto: adapter.comandoAttach(s.sessionId), codigo: 0 };
}

/** D3: delegação explícita e delimitada; nunca produz aprovação humana. */
import { Fase, Manifesto, ModoLegado } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirThread } from './thread';

export interface Delegacao {
  thread: string;
  escopo: 'premissas';
  prazo: string;
  evidencia: string;
  delegado: string;
}

export function validarDelegacao(v: unknown): v is Delegacao {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const d = v as Delegacao;
  return typeof d.thread === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(d.thread) && d.escopo === 'premissas' &&
    typeof d.prazo === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(d.prazo) && Number.isFinite(Date.parse(d.prazo)) &&
    typeof d.evidencia === 'string' && !!d.evidencia.trim() && d.evidencia.length <= 1000 &&
    typeof d.delegado === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,99}$/.test(d.delegado);
}

/** A guarda lê o artefato canônico, sem aceitar que o chamador omita um [GATE]. */
export function conteudoDePremissas(raiz: string, thread: string): string {
  const dir = fs.realpathSync(dirThread(raiz, thread));
  const partes: string[] = [];
  for (const nome of ['GOAL.md', 'PLAN.md', 'docs/goal.md', 'docs/plan.md']) {
    const file = path.join(dir, nome);
    if (!fs.existsSync(file)) continue;
    const real = fs.realpathSync(file);
    if (!real.startsWith(dir + path.sep) || fs.statSync(real).size > 128 * 1024) return '[GATE] artefato não inspecionável';
    partes.push(fs.readFileSync(real, 'utf8'));
  }
  return partes.length ? partes.join('\n') : '[GATE] premissas sem artefato';
}

export function avaliarDelegacao(manifesto: Manifesto, entrada: {
  thread: string; modo: ModoLegado; fase: Fase; escopo: string; conteudo?: string; quando?: string;
}): { permitida: boolean; razao: string; delegado?: string; evidencia?: string } {
  const d = manifesto.conduction.delegation;
  if (!validarDelegacao(d)) return { permitida: false, razao: 'delegação não configurada com escopo, prazo e evidência' };
  if (entrada.modo !== 'maestro' || !['GOAL', 'PLAN'].includes(entrada.fase) || entrada.escopo !== 'premissas' || d.thread !== entrada.thread) {
    return { permitida: false, razao: 'somente premissas da thread Maestro declarada são delegáveis; push e score são excluídos' };
  }
  if (/\[GATE\]/i.test(entrada.conteudo ?? '')) return { permitida: false, razao: '[GATE] exige humano' };
  const quando = Date.parse(entrada.quando ?? new Date().toISOString());
  if (!Number.isFinite(quando) || quando >= Date.parse(d.prazo)) return { permitida: false, razao: 'delegação expirada ou relógio inválido; não autoriza' };
  return { permitida: true, delegado: d.delegado, evidencia: d.evidencia, razao: 'delegação explícita de premissas vigente' };
}

/** Aviso de artefato de fase gravado na worktree em vez do estado canônico da thread. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventoLedger } from './types';
import { exec } from './util';

export const TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO = 'phase_artifact_outside_state';
const CAMINHOS = ['docs/goal.md', 'docs/plan.md', 'docs/check.md'] as const;

export interface AvisoArtefatoForaDoEstado {
  tipo: typeof TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO;
  caminho: typeof CAMINHOS[number];
  motivo: 'artefato-de-fase-fora-do-estado';
  correcao: string;
}

interface ThreadMinima { worktree?: unknown }

/** Somente leitura: falha fechada quando estado, worktree ou Git não respondem. */
export function avisosDeArtefatoForaDoEstado(dirDaThread: string): AvisoArtefatoForaDoEstado[] {
  let thread: ThreadMinima;
  try { thread = JSON.parse(fs.readFileSync(path.join(dirDaThread, 'thread.json'), 'utf8')) as ThreadMinima; }
  catch { return []; }
  if (typeof thread.worktree !== 'string' || !path.isAbsolute(thread.worktree) || !fs.existsSync(thread.worktree)) return [];
  const avisos: AvisoArtefatoForaDoEstado[] = [];
  for (const caminho of CAMINHOS) {
    let existe = false;
    try { existe = fs.lstatSync(path.join(thread.worktree, caminho)).isFile(); } catch { /* ausente ou ilegível: não afirmar */ }
    if (!existe) continue;
    const rastreado = exec('git', ['ls-files', '--error-unmatch', '--', caminho], thread.worktree, 30_000);
    if (rastreado.ok) continue;
    avisos.push({ tipo: TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO, caminho, motivo: 'artefato-de-fase-fora-do-estado',
      correcao: `grave o artefato no estado da thread com ork_artifact_write; ${caminho} na worktree nao e o artefato canonico` });
  }
  return avisos;
}

/** Leitura para status: a última ocorrência de cada caminho, na ordem em que apareceu. */
export function avisosDeArtefatoRegistrados(eventos: readonly EventoLedger[]): AvisoArtefatoForaDoEstado[] {
  const porCaminho = new Map<string, AvisoArtefatoForaDoEstado>();
  for (const evento of eventos) {
    if (evento.tipo !== TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO || !CAMINHOS.includes(evento.caminho as typeof CAMINHOS[number])) continue;
    porCaminho.set(String(evento.caminho), { tipo: TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO,
      caminho: evento.caminho as typeof CAMINHOS[number], motivo: 'artefato-de-fase-fora-do-estado',
      correcao: String(evento.correcao ?? '') });
  }
  return [...porCaminho.values()];
}

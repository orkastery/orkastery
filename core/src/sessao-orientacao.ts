/** RM-089 F6: o núcleo decide a orientação; adapters apenas transportam o texto. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ManifestoCarregado } from './manifest';
import { lerThread, listarIds } from './thread';

export type RuntimeDaOrientacao = 'claude-code' | 'codex' | 'hermes' | 'openclaw';
export interface IdentidadeNativaDaSessao {
  runtime: RuntimeDaOrientacao;
  sessionId: string;
  cwd: string;
}
export interface OrientacaoDaSessao {
  contrato: 'ork.sessao-orientacao/v1';
  estado: 'vinculada' | 'fora-de-thread' | 'nao-confirmado';
  threadId: string | null;
  bloqueia: false;
  texto: string | null;
  acoes: Array<{ id: 'thread.new' | 'adotar'; comando: string }>;
  evidencia: string[];
}

const dentro = (filho: string, pai: string): boolean => filho === pai || filho.startsWith(`${pai}${path.sep}`);

export function orientarSessao(carregado: ManifestoCarregado, identidade: IdentidadeNativaDaSessao): OrientacaoDaSessao {
  const base = { contrato: 'ork.sessao-orientacao/v1' as const, bloqueia: false as const };
  if (!identidade.sessionId.trim() || !path.isAbsolute(identidade.cwd) || /[\x00-\x1f\x7f]/.test(identidade.sessionId))
    return { ...base, estado: 'nao-confirmado', threadId: null, texto: null, acoes: [],
      evidencia: ['identidade ou cwd nativos não confirmados'] };
  let cwd: string;
  try { cwd = fs.realpathSync(identidade.cwd); } catch {
    return { ...base, estado: 'nao-confirmado', threadId: null, texto: null, acoes: [], evidencia: ['cwd não confirmado'] };
  }
  const raiz = fs.realpathSync(carregado.raiz);
  if (!dentro(cwd, raiz)) return { ...base, estado: 'nao-confirmado', threadId: null, texto: null, acoes: [],
    evidencia: ['cwd fora do projeto; projeto não confirmado'] };
  for (const id of listarIds(carregado.raiz)) {
    const thread = lerThread(carregado.raiz, id);
    const porSessao = thread.sessoes.some((s) => s.sessionId === identidade.sessionId);
    let porWorktree = false;
    try { porWorktree = !!thread.worktree && dentro(cwd, fs.realpathSync(thread.worktree)); } catch { /* não confirmado */ }
    if (porSessao || porWorktree) return { ...base, estado: 'vinculada', threadId: id, texto: null, acoes: [],
      evidencia: [porSessao ? 'sessionId registrado na thread' : 'cwd na worktree registrada'] };
  }
  return { ...base, estado: 'fora-de-thread', threadId: null,
    texto: 'Esta sessão está fora de uma thread do Orkastery. Inicie trabalho novo ou adote a história existente.',
    acoes: [
      { id: 'thread.new', comando: 'node core/dist/index.js thread new <nome> --roadmap RM-NNN' },
      { id: 'adotar', comando: 'node core/dist/index.js adotar <branch> --roadmap RM-NNN --nome <nome> --modo <modo> --perfil-check <perfil>' },
    ], evidencia: ['identidade e cwd consultados; nenhum vínculo durável encontrado'] };
}

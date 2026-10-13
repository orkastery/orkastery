import { EstadoDoCheck, FonteDoCheck } from './contrato';

/** Spec, secao 6.2: o estado de um check, igual para o gate e para o pulse. O que cada um exige e dele. */
export function estadoDoCheck(fonte: FonteDoCheck, status: string, conclusao: string | null): EstadoDoCheck {
  const s = status.toLowerCase();
  if (fonte === 'commit-status') return s === 'success' ? 'verde' : s === 'failure' || s === 'error' ? 'vermelho' : 'pendente';
  if (s !== 'completed') return 'pendente';
  const c = (conclusao ?? '').toLowerCase();
  return c === 'success' ? 'verde' : c === 'neutral' || c === 'skipped' ? 'bloqueado' : 'vermelho';
}

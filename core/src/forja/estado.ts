import { EstadoDoCheck, FonteDoCheck } from './contrato';

/** Os estados de commit status (GitHub e GitLab) e de job (GitLab) que reprovam: falha, erro e cancelamento. */
const VERMELHOS = new Set(['failure', 'error', 'failed', 'canceled', 'cancelled', 'canceling']);
/** O job que espera uma pessoa (`manual`) ou que a pipeline pulou (`skipped`): nao e verde para o gate. */
const BLOQUEADOS = new Set(['manual', 'skipped']);

/**
 * O estado de um check, igual para o gate e para o pulse. O que cada um exige e dele. O check-run (GitHub) decide pela
 * conclusao; o commit status (GitHub e GitLab) e o job de pipeline (GitLab) decidem pelo estado: `success` e verde,
 * falha, erro e cancelamento sao vermelhos, `manual` e `skipped` sao bloqueados, e o resto (em fila, rodando,
 * pendente, criado, aguardando recurso, preparando, agendado) e pendente.
 */
export function estadoDoCheck(fonte: FonteDoCheck, status: string, conclusao: string | null): EstadoDoCheck {
  const s = status.toLowerCase();
  if (fonte !== 'check-run') return s === 'success' ? 'verde' : VERMELHOS.has(s) ? 'vermelho' : BLOQUEADOS.has(s) ? 'bloqueado' : 'pendente';
  if (s !== 'completed') return 'pendente';
  const c = (conclusao ?? '').toLowerCase();
  return c === 'success' ? 'verde' : c === 'neutral' || c === 'skipped' ? 'bloqueado' : 'vermelho';
}

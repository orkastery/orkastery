import type { ExecutorCi } from '../../ci';
import type { CheckNoCommit, Resultado } from '../contrato';

type CheckRun = { id?: number; name?: string; status?: string; conclusion?: string | null; html_url?: string;
  completed_at?: string | null; app?: { slug?: string } };

/** Fatia 1: a mesma chamada de hoje (uma página de check-runs), na forma neutra. */
export function checksNoCommitGithub(e: { repository: string; sha: string; context: string; executor: ExecutorCi }): Resultado<CheckNoCommit[]> {
  const r = e.executor({ repository: e.repository, sha: e.sha, context: e.context });
  // Sem trim aqui: quem formata o detalhe (ci.ts) apara e corta, como sempre fez.
  if (!r.ok) return { ok: false, erro: { codigo: 'forja.inacessivel', detalhe: r.stderr || r.stdout } };
  let payload: { check_runs?: CheckRun[] };
  try { payload = JSON.parse(r.stdout) as typeof payload; }
  catch { return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: '' } }; }
  const valor = (payload.check_runs ?? []).filter((c) => c.name === e.context).map((c, i): CheckNoCommit => ({
    nome: c.name!, fonte: 'check-run', produtor: c.app?.slug ?? null, status: c.status ?? 'unknown',
    conclusao: c.conclusion ?? null, url: c.html_url ?? null, concluidoEm: c.completed_at ?? null,
    ordem: Number.isSafeInteger(c.id) ? c.id! : i,
  }));
  return { ok: true, valor };
}

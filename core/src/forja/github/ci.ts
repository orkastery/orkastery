import type { ExecutorCi } from '../../ci';
import type { CheckNoCommit, Resultado } from '../contrato';

type CheckRun = { id?: number; name?: string; status?: string; conclusion?: string | null; html_url?: string;
  completed_at?: string | null; app?: { slug?: string } };
type CommitStatus = { id?: number; context?: string; state?: string; target_url?: string | null; updated_at?: string | null;
  creator?: { login?: string } | null };

/** Uma pagina tem no maximo 100 itens; 10 paginas (1000 check-runs) e o teto da leitura. */
const POR_PAGINA = 100;
const MAX_PAGINAS = 10;

type Entrada = { repository: string; sha: string; context: string; executor: ExecutorCi; host?: string };

function chamar(e: Entrada, caminho: string): Resultado<unknown> {
  const r = e.executor({ repository: e.repository, sha: e.sha, context: e.context, host: e.host, caminho });
  // Sem trim aqui: quem formata o detalhe (ci.ts) apara e corta, como sempre fez.
  if (!r.ok) return { ok: false, erro: { codigo: 'forja.inacessivel', detalhe: r.stderr || r.stdout } };
  try { return { ok: true, valor: JSON.parse(r.stdout) as unknown }; }
  catch { return { ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe: '' } }; }
}

const invalida = (detalhe = ''): Resultado<never> => ({ ok: false, erro: { codigo: 'forja.resposta-invalida', detalhe } });

/**
 * Os check-runs (paginados, filtrados por nome no servidor e de novo aqui) e os commit statuses (uma pagina, os mais
 * novos primeiro) com o nome `context` no commit. Resposta fora do formato, de qualquer das duas chamadas, e
 * `forja.resposta-invalida`; lista que passa do teto de paginas tambem, com detalhe `incompleto`: nunca vira ausente.
 */
export function checksNoCommitGithub(e: Entrada): Resultado<CheckNoCommit[]> {
  const base = `repos/${e.repository}/commits/${e.sha}`;
  const runs: CheckRun[] = [];
  let completo = false;
  for (let pagina = 1; pagina <= MAX_PAGINAS && !completo; pagina++) {
    const lido = chamar(e, `${base}/check-runs?check_name=${encodeURIComponent(e.context)}&filter=all&per_page=${POR_PAGINA}&page=${pagina}`);
    if (!lido.ok) return lido;
    const payload = lido.valor as { total_count?: unknown; check_runs?: unknown } | null;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.check_runs)) return invalida();
    runs.push(...(payload.check_runs as CheckRun[]));
    const total = typeof payload.total_count === 'number' ? payload.total_count : null;
    completo = payload.check_runs.length < POR_PAGINA || (total !== null && runs.length >= total);
  }
  if (!completo) return invalida('incompleto');

  const lidoStatuses = chamar(e, `${base}/statuses?per_page=${POR_PAGINA}`);
  if (!lidoStatuses.ok) return lidoStatuses;
  if (!Array.isArray(lidoStatuses.valor)) return invalida();
  const statuses = lidoStatuses.valor as CommitStatus[];

  const valor: CheckNoCommit[] = [
    ...runs.filter((c) => c && c.name === e.context).map((c, i): CheckNoCommit => ({
      nome: c.name!, fonte: 'check-run', produtor: c.app?.slug ?? null, status: c.status ?? 'unknown',
      conclusao: c.conclusion ?? null, url: c.html_url ?? null, concluidoEm: c.completed_at ?? null,
      ordem: Number.isSafeInteger(c.id) ? c.id! : i,
    })),
    // Os statuses vem do mais novo para o mais velho: sem id, a ordem de reserva decresce com a posicao.
    ...statuses.filter((s) => s && s.context === e.context).map((s, i): CheckNoCommit => ({
      nome: s.context!, fonte: 'commit-status', produtor: s.creator?.login ?? null, status: s.state ?? 'unknown',
      conclusao: null, url: s.target_url ?? null, concluidoEm: s.updated_at ?? null,
      ordem: Number.isSafeInteger(s.id) ? s.id! : -i,
    })),
  ];
  return { ok: true, valor };
}

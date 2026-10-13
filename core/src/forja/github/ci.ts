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
 * Le as paginas 1..10 ate uma pagina curta. `itens` extrai a lista da resposta (`null`: fora do formato). Passou do
 * teto sem pagina curta: `forja.resposta-invalida` com detalhe `incompleto`.
 */
function paginar(e: Entrada, caminho: (pagina: number) => string, itens: (valor: unknown) => unknown[] | null): Resultado<unknown[]> {
  const todos: unknown[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const lido = chamar(e, caminho(pagina));
    if (!lido.ok) return lido;
    const lista = itens(lido.valor);
    if (!lista) return invalida();
    todos.push(...lista);
    if (lista.length < POR_PAGINA) return { ok: true, valor: todos };
  }
  return invalida('incompleto');
}

/**
 * Os check-runs (paginados, filtrados por nome no servidor e de novo aqui) e os commit statuses (paginados, os mais
 * novos primeiro) com o nome `context` no commit. Resposta fora do formato, de qualquer das duas chamadas, e
 * `forja.resposta-invalida`; lista que passa do teto de paginas tambem, com detalhe `incompleto`: nunca vira ausente.
 */
export function checksNoCommitGithub(e: Entrada): Resultado<CheckNoCommit[]> {
  const base = `repos/${e.repository}/commits/${e.sha}`;
  // A lista so termina numa pagina curta. O `total_count` nao encerra a leitura (um valor baixo cortaria a lista
  // cedo); ele so confere: lista que acabou antes do total declarado esta incompleta. Mais itens que o total nao e
  // erro (um run novo entre duas paginas).
  let total: number | null = null;
  const lidosRuns = paginar(e, (pagina) => `${base}/check-runs?check_name=${encodeURIComponent(e.context)}&filter=all&per_page=${POR_PAGINA}&page=${pagina}`,
    (valor) => {
      const payload = valor as { total_count?: unknown; check_runs?: unknown } | null;
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.check_runs)) return null;
      if (typeof payload.total_count === 'number') total = Math.max(total ?? 0, payload.total_count);
      return payload.check_runs;
    });
  if (!lidosRuns.ok) return lidosRuns;
  if (total !== null && lidosRuns.valor.length < total) return invalida('incompleto');
  const runs = lidosRuns.valor as CheckRun[];

  // O GitHub lista toda transicao de todo contexto: um vermelho do `ork-verify` pode estar alem da primeira pagina.
  const lidosStatuses = paginar(e, (pagina) => `${base}/statuses?per_page=${POR_PAGINA}&page=${pagina}`,
    (valor) => (Array.isArray(valor) ? valor : null));
  if (!lidosStatuses.ok) return lidosStatuses;
  const statuses = lidosStatuses.valor as CommitStatus[];

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

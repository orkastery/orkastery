import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutorGitHub } from '../../entrega-pr';
import { redigirSegredos } from '../../hitl';
import type { ExecutorDoGh, PrDaForja } from '../../parado-no-condutor';
import type { EntradaDosPedidosAbertos, PedidosAbertos } from '../adaptador';
import type { PedidoMesclado, Resultado } from '../contrato';
import { deFora } from '../texto';

const SHA = /^[0-9a-f]{40}$/, BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
function lerJson<T>(r: ReturnType<ExecutorGitHub>): T | null {
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout) as T; } catch { return null; }
}

export function pedidoMescladoGithub(e: { repo: string; numero: number; executor: ExecutorGitHub }): PedidoMesclado | null {
  const pr = lerJson<{ merged?: boolean; merge_commit_sha?: string | null; html_url?: string; title?: string | null; body?: string | null;
    base?: { ref?: string }; head?: { sha?: string; ref?: string } }>(e.executor(`repos/${e.repo}/pulls/${e.numero}`));
  if (!pr) return null;
  return {
    numero: e.numero, mesclado: pr.merged === true,
    mergeSha: typeof pr.merge_commit_sha === 'string' && SHA.test(pr.merge_commit_sha) ? pr.merge_commit_sha : null,
    headSha: typeof pr.head?.sha === 'string' && SHA.test(pr.head.sha) ? pr.head.sha : null,
    base: typeof pr.base?.ref === 'string' && BRANCH.test(pr.base.ref) ? pr.base.ref : null,
    branch: typeof pr.head?.ref === 'string' ? pr.head.ref : null,
    titulo: typeof pr.title === 'string' ? pr.title : null, corpo: typeof pr.body === 'string' ? pr.body : null,
    url: typeof pr.html_url === 'string' ? pr.html_url : null,
  };
}

export function branchPadraoGithub(e: { repo: string; executor: ExecutorGitHub }): string | null {
  const r = lerJson<{ default_branch?: string }>(e.executor(`repos/${e.repo}`));
  return r ? (r.default_branch ?? '') : null;
}

export function pontaDaBranchGithub(e: { repo: string; branch: string; executor: ExecutorGitHub }): string | null {
  const r = lerJson<{ commit?: { sha?: string } }>(e.executor(`repos/${e.repo}/branches/${encodeURIComponent(e.branch)}`));
  return typeof r?.commit?.sha === 'string' && SHA.test(r.commit.sha) ? r.commit.sha : null;
}

export function compararGithub(e: { repo: string; de: string; ate: string; executor: ExecutorGitHub }): string | null {
  const r = lerJson<{ status?: string }>(e.executor(`repos/${e.repo}/compare/${e.de}...${e.ate}`));
  return r ? String(r.status) : null;
}

/** Os campos do `gh pr list` de uma branch: os do `prDaForja`, com o estado de merge do PR aberto. */
const CAMPOS_DA_BRANCH = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt,mergeable';

/** Os PRs de uma branch, da base do projeto, do mais novo para o mais velho. */
export function pedidosDaBranchGithub(e: { host: string; repositorio: string; base: string; branch: string; executor: ExecutorDoGh;
  prazoMs: number }): { prs: PrDaForja[]; erro: string | null } {
  const r = e.executor(['pr', 'list', `--repo=${e.host}/${e.repositorio}`, `--head=${e.branch}`, '--state=all', '--limit=10',
    `--json=${CAMPOS_DA_BRANCH}`], e.prazoMs);
  if (r.status !== 0) return { prs: [], erro: deFora(r.stderr || r.stdout || `codigo ${r.status ?? '-'}`) };
  try {
    const lista = JSON.parse(r.stdout) as unknown;
    if (!Array.isArray(lista)) throw new Error('a resposta nao e uma lista');
    // Carga tardia: o parado-no-condutor chega a este módulo pelo entrega-pr; importar no topo fecharia um ciclo de carga.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prDaForja } = require('../../parado-no-condutor') as typeof import('../../parado-no-condutor');
    const prs = lista.map((p) => prDaForja(p, e.base)).filter((p): p is PrDaForja => !!p && p.branch === e.branch);
    return { prs: prs.sort((a, b) => b.numero - a.numero), erro: null };
  } catch (err) {
    return { prs: [], erro: deFora((err as Error).message) };
  }
}

/** Abre o PR da branch na base. */
export function abrirPedidoGithub(e: { host: string; repositorio: string; base: string; branch: string; titulo: string; corpo: string;
  executor: ExecutorDoGh; prazoMs: number }): { status: number | null; stdout: string; stderr: string } {
  // O corpo vai por arquivo 600 num diretorio proprio: texto que parece flag (`--repo=outro/repo`) ou de 64 KiB nao toca o argv.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-pr-'));
  try {
    const arquivo = path.join(dir, 'corpo.md');
    fs.writeFileSync(arquivo, e.corpo, { mode: 0o600 });
    return e.executor(['pr', 'create', `--repo=${e.host}/${e.repositorio}`, `--base=${e.base}`, `--head=${e.branch}`, `--title=${e.titulo}`,
      '--body-file', arquivo], e.prazoMs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Os campos dos recentes e os dos abertos, com o rollup e o estado de merge (RM-059, F7). */
const CAMPOS_DOS_RECENTES = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt';
const CAMPOS_DOS_ABERTOS = `${CAMPOS_DOS_RECENTES},statusCheckRollup,mergeable`;

/** Texto curto vindo de fora: sem controle, num teto. */
function curto(v: string, teto: number): string | null {
  const limpo = Array.from(v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('');
  return limpo || null;
}

/**
 * Os PRs da base para o pulse, pelo `gh pr list`: os abertos com o rollup (ate o teto; lista cheia e `parcial`), os
 * recentes de qualquer estado, e cada candidata que nao apareceu, conferida pelo `--head` enquanto houver tempo
 * (acima do teto ou sem tempo, ela fica em `semConferir`, que e "PR nao lido", nunca "sem PR"). O `gh` usa a
 * autenticacao dele; nenhum token passa por aqui.
 */
export function pedidosAbertosGithub(e: EntradaDosPedidosAbertos): Resultado<PedidosAbertos> {
  // Carga tardia: o parado-no-condutor chega a este modulo pelo registro; importar no topo fecharia um ciclo de carga.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prDaForja } = require('../../parado-no-condutor') as typeof import('../../parado-no-condutor');
  const l = e.limites, repo = `--repo=${e.forja.host}/${e.forja.repo}`;
  const falha = (detalhe: string, codigo: 'forja.indisponivel' | 'forja.resposta-invalida' = 'forja.indisponivel'): Resultado<PedidosAbertos> =>
    ({ ok: false, erro: { codigo, detalhe } });
  const pedir = (args: string[]): unknown[] | string => {
    if (e.resta() <= 0) return `gh pr list: orçamento de ${Math.round(e.orcamentoMs / 1000)} s da leitura esgotado`;
    const r = e.executor(['pr', 'list', repo, `--base=${e.base}`, ...args], Math.min(l.prazoMs, e.resta()));
    if (r.status !== 0) {
      const detalhe = curto(redigirSegredos(r.stderr || r.stdout || ''), 160) ?? 'sem detalhe';
      return `gh pr list falhou (${r.status === null ? 'sem código de saída' : `código ${r.status}`}): ${detalhe}`;
    }
    try {
      const lista = JSON.parse(r.stdout) as unknown;
      if (!Array.isArray(lista)) throw new Error('a resposta não é uma lista');
      return lista;
    } catch (err) {
      return `resposta do gh pr list fora do formato: ${curto(redigirSegredos((err as Error).message), 120) ?? 'sem detalhe'}`;
    }
  };
  try {
    const porNumero = new Map<number, PrDaForja>();
    const juntar = (lista: unknown[], comChecks: boolean) => {
      for (const bruto of lista) {
        const pr = prDaForja(bruto, e.base);
        if (!pr || porNumero.has(pr.numero)) continue;
        // A leitura sem rollup nunca diz que o aberto nao tem checks.
        if (!comChecks && pr.estado === 'aberto') pr.checks = [{ nome: 'checks não lidos', situacao: 'pendente', concluidoEm: null }];
        porNumero.set(pr.numero, pr);
      }
    };
    const abertos = pedir(['--state=open', `--limit=${l.abertos}`, `--json=${CAMPOS_DOS_ABERTOS}`]);
    if (typeof abertos === 'string') return falha(abertos);
    juntar(abertos, true);
    const recentes = pedir(['--state=all', `--limit=${l.recentes}`, `--json=${CAMPOS_DOS_RECENTES}`]);
    if (typeof recentes === 'string') return falha(recentes);
    juntar(recentes, false);
    // Antes de dizer "sem PR", a candidata e conferida sozinha (o mesclado velho fica fora dos recentes).
    const achadas = new Set([...porNumero.values()].map((p) => p.branch));
    const faltam = [...new Set(e.candidatas)].filter((b) => BRANCH.test(b) && !achadas.has(b));
    const semConferir: string[] = [];
    for (const [i, branch] of faltam.entries()) {
      if (i >= l.candidatas || e.resta() < l.minimoDaConferenciaMs) { semConferir.push(branch); continue; }
      const daBranch = pedir(['--state=all', `--head=${branch}`, '--limit=5', `--json=${CAMPOS_DOS_RECENTES}`]);
      try {
        if (typeof daBranch === 'string') throw new Error(daBranch);
        juntar(daBranch, false);
      } catch { semConferir.push(branch); }
    }
    return { ok: true, valor: { prs: [...porNumero.values()], parcial: abertos.length >= l.abertos, semConferir } };
  } catch (err) {
    return falha(`resposta do gh pr list fora do formato: ${curto(redigirSegredos((err as Error).message), 120) ?? 'sem detalhe'}`,
      'forja.resposta-invalida');
  }
}

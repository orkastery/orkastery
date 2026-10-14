/**
 * Os MRs da base para o pulse, numa consulta GraphQL (todos os tiers; o REST pediria uma chamada por MR): os abertos
 * com a pipeline do head e o job do check da CI (`ci.context`), os recentes de qualquer estado e os das branches
 * candidatas. Os abertos paginam de 100 em 100 ate o teto; com a cota abaixo de 10 % a paginacao para, e o que faltou
 * e `parcial`, nunca "sem MR". MR de fork (`sourceProjectId` de outro projeto) e de outra base ficam de fora, como o
 * `isCrossRepository` do GitHub. O estado de cada job e da pipeline sai da regra unica (`estadoDoCheck`); como no
 * GitHub, o pulse conta o pulado de proposito (`manual`, `skipped`) como verde. O status externo (`POST /statuses`)
 * entra na pipeline com o estagio `external`: nunca e o check da CI, e a pipeline sem o job nao fica verde no pulse.
 */
import { limiteBaixo } from '../api';
import type { EntradaDosPedidosAbertos, PedidosAbertos } from '../adaptador';
import type { CheckDoPr, PrDaForja, SituacaoDoCheck } from '../../parado-no-condutor';
import type { CodigoDeErroDaForja, Resultado } from '../contrato';
import { estadoDoCheck } from '../estado';
import { deFora } from '../texto';
import { CONSULTA_DOS_ABERTOS_SEGUINTES, CONSULTA_DOS_PEDIDOS } from './consultas';
import { ESTADOS_DO_MR } from './pedidos';

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const SHA = /^[0-9a-f]{40}$/, BRANCH = /^[A-Za-z0-9._/-]{1,200}$/, IID = /^[1-9]\d{0,9}$/;

class ForaDoFormato extends Error {}

/** Instante ISO de fora; ano antes de 2000 nao vale. */
function instante(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 2000 ? new Date(ms).toISOString() : null;
}

function situacao(status: unknown): SituacaoDoCheck {
  if (typeof status !== 'string') return 'pendente';
  const estado = estadoDoCheck('pipeline-job', status, null);
  return estado === 'bloqueado' ? 'verde' : estado;
}

/** Os checks do MR aberto: a pipeline do head e o job do check da CI dela, com o nome do manifesto. */
function checksDoAberto(no: Json, head: string, check: string): CheckDoPr[] {
  const p = no.headPipeline;
  if (p === null || p === undefined) return [];
  if (!obj(p)) throw new ForaDoFormato('headPipeline');
  // A pipeline de outro head (o MR ganhou commit e a nova ainda nao nasceu) nao diz nada do head de agora.
  if (p.sha !== head) return [{ nome: 'pipeline', situacao: 'pendente', concluidoEm: null }];
  const daPipeline = situacao(p.status);
  const checks: CheckDoPr[] = [{ nome: 'pipeline', situacao: daPipeline, concluidoEm: daPipeline === 'pendente' ? null : instante(p.finishedAt) }];
  // Sem o job, o verde da pipeline pode ser so de status externos (qualquer nome fecha a pipeline): o check da CI
  // fica pendente, nunca some.
  if (p.job === null || p.job === undefined) return [...checks, { nome: check, situacao: 'pendente', concluidoEm: null }];
  if (!obj(p.job)) throw new ForaDoFormato('job');
  const externo = !obj(p.job.stage) || p.job.stage.name === 'external';
  const doJob = externo ? 'pendente' : situacao(p.job.status);
  checks.push({ nome: check, situacao: doJob,
    concluidoEm: doJob === 'pendente' ? null : instante(p.job.finishedAt) ?? instante(p.job.startedAt) });
  return checks;
}

/** Um MR da resposta, ou `null` quando nao e desta base nem deste projeto (fork). Formato errado lanca. */
function pedidoDoGitlab(bruto: unknown, base: string, projeto: number, comChecks: boolean, check: string): PrDaForja | null {
  if (!obj(bruto)) throw new ForaDoFormato('MR');
  const estado = ESTADOS_DO_MR[String(bruto.state)];
  if (typeof bruto.iid !== 'string' || !IID.test(bruto.iid) || !estado || typeof bruto.draft !== 'boolean' ||
      typeof bruto.sourceProjectId !== 'number') throw new ForaDoFormato('MR');
  if (bruto.sourceProjectId !== projeto || bruto.targetBranch !== base || typeof bruto.sourceBranch !== 'string' ||
      !BRANCH.test(bruto.sourceBranch)) return null;
  const head = bruto.diffHeadSha, aberto = estado === 'aberto';
  if (typeof head !== 'string' || !SHA.test(head)) {
    if (aberto) throw new ForaDoFormato('diffHeadSha');
    return null;
  }
  const url = typeof bruto.webUrl === 'string' && /^https:\/\/[^\s]+$/.test(bruto.webUrl) ? bruto.webUrl.slice(0, 300) : null;
  // A leitura sem a pipeline (recentes, candidatas) nunca diz que o aberto nao tem checks.
  const checks = !aberto ? [] : comChecks ? checksDoAberto(bruto, head, check) : [{ nome: 'checks não lidos', situacao: 'pendente' as const, concluidoEm: null }];
  return { numero: Number(bruto.iid), branch: bruto.sourceBranch, head, estado, rascunho: bruto.draft, url,
    criadoEm: instante(bruto.createdAt), mescladoEm: instante(bruto.mergedAt), checks,
    ...(aberto && comChecks && typeof bruto.conflicts === 'boolean' ? { conflito: bruto.conflicts } : {}) };
}

function pagina(conexao: Json, comCursor: boolean): { temMais: boolean; cursor: string | null } {
  const info = conexao.pageInfo;
  if (!obj(info) || typeof info.hasNextPage !== 'boolean') throw new ForaDoFormato('pageInfo');
  if (info.hasNextPage && comCursor && typeof info.endCursor !== 'string') throw new ForaDoFormato('endCursor');
  return { temMais: info.hasNextPage, cursor: typeof info.endCursor === 'string' ? info.endCursor : null };
}

export function pedidosAbertosGitlab(e: EntradaDosPedidosAbertos): Resultado<PedidosAbertos> {
  const falha = (codigo: CodigoDeErroDaForja, detalhe: string): { ok: false; erro: { codigo: CodigoDeErroDaForja; detalhe: string } } =>
    ({ ok: false, erro: { codigo, detalhe } });
  const pedir = (query: string, variables: Json): Resultado<{ projeto: Json; baixo: boolean }> => {
    if (e.resta() <= 0) return falha('forja.indisponivel', `graphql: orçamento de ${Math.round(e.orcamentoMs / 1000)} s da leitura esgotado`);
    const r = e.api({ metodo: 'POST', caminho: 'graphql', corpo: { query, variables }, prazoMs: Math.min(e.limites.prazoMs, e.resta()) });
    if (!r.ok) return r;
    const corpo = r.valor.corpo;
    if (obj(corpo) && Array.isArray(corpo.errors) && corpo.errors.length) {
      const mensagens = corpo.errors.map((x) => (obj(x) && typeof x.message === 'string' ? x.message : '?')).join('; ');
      return falha('forja.resposta-invalida', deFora(`graphql: ${mensagens}`));
    }
    const dados = obj(corpo) ? corpo.data : undefined;
    if (!obj(dados) || !('project' in dados)) return falha('forja.resposta-invalida', 'graphql: sem data.project');
    // Projeto que nao existe e projeto privado sem acesso respondem igual: `project: null`.
    if (dados.project === null) return falha('forja.nao-achei', `graphql: projeto ${e.forja.repo}`);
    if (!obj(dados.project)) return falha('forja.resposta-invalida', 'graphql: project');
    return { ok: true, valor: { projeto: dados.project, baixo: limiteBaixo(r.valor.limite) } };
  };
  const candidatas = [...new Set(e.candidatas)].filter((b) => BRANCH.test(b));
  const primeira = pedir(CONSULTA_DOS_PEDIDOS, { path: e.forja.repo, base: e.base, candidatas: candidatas.slice(0, e.limites.candidatas),
    check: e.contexto });
  if (!primeira.ok) return primeira;
  try {
    const projeto = primeira.valor.projeto;
    const id = /^gid:\/\/gitlab\/Project\/(\d+)$/.exec(String(projeto.id))?.[1];
    if (!id) throw new ForaDoFormato('project.id');
    const porNumero = new Map<number, PrDaForja>();
    const juntar = (conexao: unknown, comChecks: boolean, onde: string): Json => {
      if (!obj(conexao) || !Array.isArray(conexao.nodes)) throw new ForaDoFormato(onde);
      for (const bruto of conexao.nodes) {
        const pr = pedidoDoGitlab(bruto, e.base, Number(id), comChecks, e.contexto);
        if (pr && !porNumero.has(pr.numero)) porNumero.set(pr.numero, pr);
      }
      return conexao;
    };
    let abertos = juntar(projeto.abertos, true, 'abertos');
    let lidos = (abertos.nodes as unknown[]).length, baixo = primeira.valor.baixo, seguinte = pagina(abertos, true);
    while (seguinte.temMais && lidos < e.limites.abertos && !baixo) {
      const r = pedir(CONSULTA_DOS_ABERTOS_SEGUINTES, { path: e.forja.repo, base: e.base, depois: seguinte.cursor, check: e.contexto });
      if (!r.ok) return r;
      abertos = juntar(r.valor.projeto.abertos, true, 'abertos');
      lidos += (abertos.nodes as unknown[]).length;
      baixo = r.valor.baixo;
      seguinte = pagina(abertos, true);
    }
    juntar(projeto.recentes, false, 'recentes');
    const daBranch = juntar(projeto.daBranch, false, 'daBranch');
    const cortada = pagina(daBranch, false).temMais;
    const achadas = new Set([...porNumero.values()].map((p) => p.branch));
    const semConferir = candidatas.filter((b, i) => !achadas.has(b) && (i >= e.limites.candidatas || cortada));
    return { ok: true, valor: { prs: [...porNumero.values()], parcial: seguinte.temMais, semConferir } };
  } catch (err) {
    if (err instanceof ForaDoFormato) return falha('forja.resposta-invalida', `graphql: ${err.message} fora do formato`);
    throw err;
  }
}

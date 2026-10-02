/**
 * RM-037 (fatia 4): o trabalho parado no condutor.
 *
 * Em 01/10/2026 o condutor parou duas vezes e nada no produto percebeu. De madrugada, tres threads
 * terminaram com o verify verde e ficaram 15 h sem push e sem PR; de dia, PRs ficaram horas com os
 * checks verdes e sem merge, e um PR com o check vermelho ficou 4h38 sem fase nenhuma. O pulse batia de
 * 15 em 15 min e so dizia "Esperando voce": o `human.pending` que o observador grava quando a sessao
 * claude-bg encerra o turno em `blocked` contava como pergunta do dono, e nao havia pergunta nenhuma
 * (12 desses resultados seguiram ate o `ship_done` sem um `human_gate`).
 *
 * Aqui mora, num lugar so, o que e do condutor depois da entrega:
 *
 *  - quem e do condutor (`esperaDoCondutor`): o fim de turno num bloco sem pausa ao fim, sem pergunta
 *    estruturada aberta. Pausa prevista do modo, escalacao tipada, `hitl_requested` aberto (inclusive
 *    vencido que espera), prompt de permissao do hook e menu na tela continuam do dono;
 *  - o estado da entrega de cada thread aberta: o git local (a ponta da branch, a copia do remoto que o
 *    push desta maquina atualiza e a base) e os PRs da forja, lidos pelo `gh` e guardados como retrato
 *    `ork.prs-abertos/v1`;
 *  - os casos, cada um com o desde e o proximo passo, alem do limiar. O que sai do dono volta sempre
 *    como linha do condutor (CHECK da fatia 4, rodada 1).
 *
 * O pulse le a forja so quando alguma thread tem branch publicada; o status do roadmap le o retrato e
 * nunca a rede. Falha, lista cortada e retrato velho sao "PR nao lido", nunca "sem PR".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { conducaoDaThread } from './conducao';
import { raizDoEstado } from './estado-thread';
import { enderecoDoRemoto, identidadeDaForja, repositorioGithubNoHost } from './forja';
import { redigirSegredos } from './hitl';
import { alvoDoPedido, estadoDoPedido, PedidoHitlQualquer } from './hitl-contract';
import { quemDecide } from './hitl-classificacao';
import { MOTIVOS_DE_ESCALACAO_HUMANA } from './hitl-gates';
import { lerLedger } from './ledger';
import { ManifestoCarregado } from './manifest';
import { tagDoModo } from './modos';
import { ehAprovacaoHumana, EVENTOS_QUE_DESTRAVAM } from './ocupacao';
import { stopCorrelacionado } from './session-watcher-claude';
import { dirThread, lerThread, listarIds } from './thread';
import { EventoLedger, SessaoNoRadar, Thread } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';

export const CONTRATO_PRS = 'ork.prs-abertos/v1' as const;
/** D4: duas batidas do pulse. Abaixo disto o condutor pode estar agindo. */
export const LIMIAR_PARADO_NO_CONDUTOR_MIN = 30;
/** O retrato de PRs vale por uma hora para quem nao le a rede (o status do roadmap); depois, "PR nao lido". */
export const VALIDADE_DO_RETRATO_MIN = 60;
/** Quantos PRs ABERTOS a leitura pede. Lista cheia e `parcial`: o PR que nao veio nunca vira "sem PR". */
export const LIMITE_DE_PRS = 200;
/** Quantos PRs recentes (de qualquer estado) a segunda leitura pede: so para achar o mesclado e o fechado. */
export const LIMITE_DE_RECENTES = 100;
/** Retrato com data mais a frente do relogio do que isto nao vale (relogio adiantado ou arquivo mexido). */
const FOLGA_DO_RELOGIO_MIN = 5;
const ARQUIVO_DOS_PRS = 'prs.json';
const PRAZO_DO_GH_MS = 30000;
/** A leitura inteira da forja numa batida: cabe com folga nos 240 s que a varredura da ao subprocesso do pulse. */
const ORCAMENTO_DA_LEITURA_MS = 60000;
const CAMPOS_DOS_RECENTES = 'number,state,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository,url,createdAt,mergedAt';
const CAMPOS_DO_GH = `${CAMPOS_DOS_RECENTES},statusCheckRollup`;
/** Quantas branches candidatas a "sem PR" sao conferidas uma a uma por batida; o resto fica "PR nao lido". */
const LIMITE_DE_CANDIDATAS = 10;
/** A conferencia de uma candidata so comeca com este tempo de sobra no orcamento; com menos, a branch fica sem conferir. */
const MINIMO_DA_CONFERENCIA_MS = 5000;
/** As fases que o ciclo despacha antes da entrega: depois de um bloco que para nelas, o passo e despachar, nao publicar. */
const FASES_ANTES_DA_ENTREGA = ['GOAL', 'PLAN', 'GO', 'CHECK'];
/** Os modos em que a #TAG ja autoriza o push (`autorizacaoDePush`, `core/src/ship.ts`). */
const MODOS_COM_PUSH_AUTORIZADO = ['auto', 'maestro'];

/**
 * Os casos, na ordem de precedencia (D5): os cinco do pedido e os dois que o CHECK pediu. RM-037 (fatia 5, A3): o
 * CHECK sem o veredito, no #Auto, vem antes de todos.
 */
export type CasoParado = 'check-sem-veredito' | 'sem-push' | 'pr-vermelho' | 'pr-verde' | 'sem-registro' | 'sem-pr' | 'fase-seguinte' |
  'sessao-sem-pergunta';
export type SituacaoDoCheck = 'verde' | 'vermelho' | 'pendente';

export interface CheckDoPr { nome: string; situacao: SituacaoDoCheck; concluidoEm: string | null }

export interface PrDaForja {
  numero: number;
  branch: string;
  head: string;
  estado: 'aberto' | 'mesclado' | 'fechado';
  rascunho: boolean;
  url: string | null;
  criadoEm: string | null;
  mescladoEm: string | null;
  /** So dos PRs abertos, um por nome (o mais novo); o mesclado e o fechado nao precisam deles. */
  checks: CheckDoPr[];
}

/** O que o pulse leu da forja, guardado em `.orkastery/monitor/prs.json` para quem nao le a rede. */
export interface RetratoDePrs {
  contrato: typeof CONTRATO_PRS;
  lidoEm: string;
  repositorio: string;
  /** RM-037 (fatia 5, A5): o host do GitHub Enterprise de onde os PRs vieram; sem ele, o github.com. */
  host?: string;
  base: string;
  /** A forja devolveu a lista de abertos cheia: pode haver PR aberto que nao veio. */
  parcial: boolean;
  /** As branches que podiam estar sem PR e nao foram conferidas uma a uma (acima do teto da batida). */
  semConferir?: string[];
  prs: PrDaForja[];
}

/** RM-037 (fatia 5, A5): o remoto cuja forja nao tem leitura de PR (GitLab, caminho local, host sem login do `gh`). */
export interface ForjaSemLeitura { remoto: string; host: string | null }

export type LeituraDePrs = { ok: true; retrato: RetratoDePrs } | {
  ok: false; lidoEm: string; erro: string;
  /** A forja do remoto nao tem leitura de PR: e o estado dela, e nao falha desta batida ("PR nao lido"). */
  semLeitura?: ForjaSemLeitura;
};

/** RM-037 (fatia 5, A5): o que as linhas e o resumo dizem quando a forja nao tem leitura de PR. */
export const FORJA_SEM_LEITURA = 'forja sem leitura de PR';

/** Quem roda o `gh`. Os testes trocam por uma resposta gravada e contam as chamadas. */
export type ExecutorDoGh = (args: readonly string[], timeoutMs: number) => { status: number | null; stdout: string; stderr: string };

/** O ambiente do `gh`: sem cor, sem prompt e sem host ou repositorio herdados (o host vai no `--repo`). */
function ambienteDoGh(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0', CLICOLOR_FORCE: '0' };
  delete env.GH_HOST; delete env.GH_REPO; delete env.GH_FORCE_TTY;
  return env;
}

const ghPadrao: ExecutorDoGh = (args, timeoutMs) => {
  const r = spawnSync('gh', [...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: ambienteDoGh() });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : (r.stderr ?? '') };
};

/** Git local sem rede escondida: clone parcial nunca busca objeto durante uma leitura daqui. */
const git = (raiz: string, args: string[]) => exec('git', args, raiz, 60000, { ...process.env, GIT_NO_LAZY_FETCH: '1' });

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const REPOSITORIO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** O host do GitHub Enterprise guardado no retrato: rotulos alfanumericos separados por ponto, como na forja. */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Texto curto vindo de fora: sem controle, num teto. */
function curto(v: unknown, teto = 120): string | null {
  if (typeof v !== 'string') return null;
  const limpo = Array.from(v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('');
  return limpo || null;
}

/**
 * O nome de um check vem do GitHub e e o unico texto livre da forja que chega ao dono (no proximo passo).
 * Fica so letra, numero e pontuacao simples: nada de controle, de formatacao invisivel, de quebra de
 * linha, de `:` (diretiva de canal) nem de `$` (padrao de substituicao).
 */
export function nomeDeCheck(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/[^\p{L}\p{N} ()[\]._,+/-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return limpo ? Array.from(limpo).slice(0, 80).join('').trim() : null;
}

/** Instante ISO de fora. O GitHub devolve o ano 1 para o que ainda nao aconteceu. */
function instante(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 2000 ? new Date(ms).toISOString() : null;
}

/**
 * Um check do rollup, com a chave que diz quando ele se repete (o tipo, o workflow e o nome cru, como o `gh
 * pr checks`: dois checks diferentes com o mesmo nome limpo nunca se fundem) e o inicio que decide o mais novo.
 */
function checkDaForja(c: unknown): { check: CheckDoPr; chave: string; inicio: string } | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const nome = nomeDeCheck(o.name) ?? nomeDeCheck(o.context);
  if (!nome) return null;
  // O run do Actions separa o mesmo job disparado por dois eventos; a reexecucao fica no mesmo run.
  const run = /\/actions\/runs\/(\d+)/.exec(String(o.detailsUrl ?? o.targetUrl ?? ''))?.[1] ?? '';
  const chave = JSON.stringify([String(o.__typename ?? ''), String(o.workflowName ?? '').slice(0, 200),
    String(o.name ?? o.context ?? '').slice(0, 200), run]);
  let situacao: SituacaoDoCheck;
  if (o.__typename === 'StatusContext' || (o.status === undefined && typeof o.state === 'string')) {
    const s = String(o.state ?? '').toUpperCase();
    situacao = s === 'SUCCESS' ? 'verde' : s === 'FAILURE' || s === 'ERROR' ? 'vermelho' : 'pendente';
  } else {
    const status = String(o.status ?? '').toUpperCase(), conclusao = String(o.conclusion ?? '').toUpperCase();
    situacao = status !== 'COMPLETED' ? 'pendente' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusao) ? 'verde' : 'vermelho';
  }
  const concluidoEm = situacao === 'pendente' ? null : instante(o.completedAt) ?? instante(o.startedAt);
  return { check: { nome, situacao, concluidoEm }, chave, inicio: instante(o.startedAt) ?? instante(o.completedAt) ?? '' };
}

/**
 * Um PR da resposta do `gh`, ou `null` quando nao e de thread nenhuma daqui (fork, outra base, branch que
 * nao e nome de branch de thread). Formato errado lanca: a leitura inteira vira "nao lido".
 */
function prDaForja(bruto: unknown, base: string): PrDaForja | null {
  if (!bruto || typeof bruto !== 'object') throw new Error('PR fora do formato');
  const p = bruto as Record<string, unknown>;
  const numero = p.number, head = p.headRefOid;
  const estado = ({ OPEN: 'aberto', MERGED: 'mesclado', CLOSED: 'fechado' } as const)[String(p.state) as 'OPEN' | 'MERGED' | 'CLOSED'];
  if (!Number.isSafeInteger(numero) || (numero as number) < 1 || typeof head !== 'string' || !SHA.test(head) || !estado ||
      typeof p.isDraft !== 'boolean') throw new Error('PR fora do formato');
  if (p.isCrossRepository === true || (typeof p.baseRefName === 'string' && p.baseRefName !== base) ||
      typeof p.headRefName !== 'string' || !BRANCH.test(p.headRefName)) return null;
  const rollup = p.statusCheckRollup;
  if (rollup !== null && rollup !== undefined && !Array.isArray(rollup)) throw new Error('checks fora do formato');
  const porChave = new Map<string, { check: CheckDoPr; inicio: string }>();
  if (estado === 'aberto') {
    for (const [i, c] of ((rollup ?? []) as unknown[]).entries()) {
      // Check ilegivel nunca vira verde: entra como pendente, e o PR nao sai como "esperando merge".
      const lido = checkDaForja(c) ?? { check: { nome: 'check ilegivel', situacao: 'pendente' as const, concluidoEm: null },
        chave: `ilegivel:${i}`, inicio: '' };
      // O rollup repete o check reexecutado: vale o mais novo da mesma chave, como no `gh pr checks`.
      const atual = porChave.get(lido.chave);
      if (!atual || lido.inicio > atual.inicio) porChave.set(lido.chave, lido);
    }
  }
  const url = typeof p.url === 'string' && /^https:\/\/[^\s]+$/.test(p.url) ? curto(p.url, 300) : null;
  return { numero: numero as number, branch: p.headRefName, head, estado, rascunho: p.isDraft as boolean, url,
    criadoEm: instante(p.createdAt), mescladoEm: instante(p.mergedAt), checks: [...porChave.values()].map((x) => x.check) };
}

/**
 * RM-037 (fatia 5, A5): o host e o `dono/nome` do remoto quando ele pode ser um GitHub (o github.com ou um host
 * proprio), so pelo git local, sem rede nem `gh`. O GitLab fica de fora.
 */
function githubDoRemoto(raiz: string, remoto: string): { host: string; repositorio: string } | null {
  const url = git(raiz, ['remote', 'get-url', remoto]);
  const forja = url.ok ? repositorioGithubNoHost(url.stdout.trim()) : null;
  // `ssh.github.com` e o SSH do github.com pela porta 443, e nao um GitHub Enterprise (sugestao da rodada 1 do CHECK).
  return forja && REPOSITORIO.test(forja.repo) ? { host: forja.host === 'ssh.github.com' ? 'github.com' : forja.host, repositorio: forja.repo }
    : null;
}

/** O repositorio `dono/nome` do remoto, so quando ele e do github.com (o host ancorado, nao so citado no caminho). */
export function repositorioDoRemoto(raiz: string, remoto: string): string | null {
  const github = githubDoRemoto(raiz, remoto);
  return github && github.host === 'github.com' ? github.repositorio : null;
}

/**
 * `semLeitura` falso: a forja pode ter leitura, mas a conferencia desta batida falhou (o `gh` ausente, fora do prazo ou
 * sem resposta do host). Isso e "PR nao lido" desta batida, nunca o estado da forja (aviso da rodada 1 do CHECK).
 */
type ForjaDosPrs = { leitura: true; host: string; repositorio: string } |
  { leitura: false; host: string | null; motivo: string; semLeitura: boolean };

/**
 * RM-037 (fatia 5, A5): de onde o pulse le os PRs do remoto. O github.com, como sempre; o host proprio em que o `gh`
 * esta autenticado, que e um GitHub Enterprise (`gh auth status --hostname <host>`); ou nenhum: GitLab, caminho local,
 * ou host em que o `gh` nao tem login. Ficar sem leitura nao e falha desta batida (o "PR nao lido"): e o estado da
 * forja, que o pulse diz uma vez.
 */
function forjaDosPrs(raiz: string, remoto: string, executor: ExecutorDoGh, prazoMs: number): ForjaDosPrs {
  const url = git(raiz, ['remote', 'get-url', remoto]);
  if (!url.ok) return { leitura: false, host: null, motivo: `o remoto ${remoto} não está configurado neste checkout`, semLeitura: true };
  const endereco = enderecoDoRemoto(url.stdout.trim());
  // Caminho local, ou apelido de SSH sem dominio (`git@github-trabalho:dono/repo.git`): nao ha host para ler.
  if (!endereco) {
    return { leitura: false, host: null, motivo: `o remoto ${remoto} não tem host de forja (caminho local ou apelido de SSH)`, semLeitura: true };
  }
  if (identidadeDaForja(url.stdout.trim())?.tipo === 'gitlab') {
    return { leitura: false, host: endereco.host, motivo: `a forja de ${remoto} (${endereco.host}) é um GitLab, e o ork só lê PR do GitHub`,
      semLeitura: true };
  }
  const github = githubDoRemoto(raiz, remoto);
  if (!github) {
    return { leitura: false, host: endereco.host, motivo: `o remoto ${remoto} (${endereco.host}) não aponta um repositório dono/nome`,
      semLeitura: true };
  }
  if (github.host === 'github.com') return { leitura: true, ...github };
  const auth = executor(['auth', 'status', '--hostname', github.host], prazoMs);
  if (auth.status === 0) return { leitura: true, ...github };
  // So a resposta de login ausente (o `gh` 2.46 diz "You are not logged into any accounts on <host>") e o estado da
  // forja; prazo estourado, `gh` ausente ou host fora do ar sao falha desta batida.
  const semLogin = auth.status === 1 && /\bnot logged in/i.test(`${auth.stdout}\n${auth.stderr}`);
  return { leitura: false, host: github.host, semLeitura: semLogin, motivo: semLogin
    ? `o gh não está autenticado em ${github.host}, a forja de ${remoto}`
    : `gh auth status --hostname ${github.host} falhou (${auth.status === null ? 'sem código de saída' : `código ${auth.status}`}): ` +
      (curto(redigirSegredos(auth.stderr || auth.stdout || ''), 120) ?? 'sem detalhe') };
}

/**
 * Le os PRs da base do repositorio do remoto em duas chamadas: os abertos (ate `LIMITE_DE_PRS`; e so a
 * lista deles que pode dizer "sem PR") e os recentes de qualquer estado (para achar o mesclado e o fechado).
 * O `gh` usa a autenticacao dele; nenhum token passa por aqui. RM-037 (fatia 5, A5): no GitHub Enterprise, o host
 * vai no `--repo`; forja sem leitura de PR nao chama o `gh pr list`.
 */
export function lerPrsDaForja(carregado: ManifestoCarregado,
  opcoes: { quando?: string; executor?: ExecutorDoGh; remoto?: string; candidatas?: readonly string[]; orcamentoMs?: number } = {}): LeituraDePrs {
  const lidoEm = opcoes.quando ?? new Date().toISOString();
  const remoto = opcoes.remoto ?? carregado.manifesto.fabrica.remoto;
  const base = carregado.manifesto.worktree.base_branch;
  const orcamento = opcoes.orcamentoMs ?? ORCAMENTO_DA_LEITURA_MS, fimDaLeitura = Date.now() + orcamento;
  const resta = () => fimDaLeitura - Date.now();
  const executor = opcoes.executor ?? ghPadrao;
  const forja = forjaDosPrs(carregado.raiz, remoto, executor, Math.min(PRAZO_DO_GH_MS, Math.max(1, resta())));
  if (!forja.leitura) return { ok: false, lidoEm, erro: forja.motivo, ...(forja.semLeitura ? { semLeitura: { remoto, host: forja.host } } : {}) };
  const { host, repositorio } = forja;
  const pedir = (args: string[]): unknown[] | string => {
    if (resta() <= 0) return `gh pr list: orçamento de ${Math.round(orcamento / 1000)} s da leitura esgotado`;
    const r = executor(['pr', 'list', `--repo=${host}/${repositorio}`, `--base=${base}`, ...args],
      Math.min(PRAZO_DO_GH_MS, resta()));
    if (r.status !== 0) {
      const detalhe = curto(redigirSegredos(r.stderr || r.stdout || ''), 160) ?? 'sem detalhe';
      return `gh pr list falhou (${r.status === null ? 'sem código de saída' : `código ${r.status}`}): ${detalhe}`;
    }
    try {
      const lista = JSON.parse(r.stdout) as unknown;
      if (!Array.isArray(lista)) throw new Error('a resposta não é uma lista');
      return lista;
    } catch (e) {
      return `resposta do gh pr list fora do formato: ${curto(redigirSegredos((e as Error).message), 120) ?? 'sem detalhe'}`;
    }
  };
  try {
    const porNumero = new Map<number, PrDaForja>();
    const juntar = (lista: unknown[], comChecks: boolean) => {
      for (const bruto of lista) {
        const pr = prDaForja(bruto, base);
        if (!pr || porNumero.has(pr.numero)) continue;
        // S-b do CHECK (rodada 3): a leitura sem rollup nunca diz que o aberto nao tem checks.
        if (!comChecks && pr.estado === 'aberto') pr.checks = [{ nome: 'checks não lidos', situacao: 'pendente', concluidoEm: null }];
        porNumero.set(pr.numero, pr);
      }
    };
    const abertos = pedir(['--state=open', `--limit=${LIMITE_DE_PRS}`, `--json=${CAMPOS_DO_GH}`]);
    if (typeof abertos === 'string') return { ok: false, lidoEm, erro: abertos };
    juntar(abertos, true);
    const recentes = pedir(['--state=all', `--limit=${LIMITE_DE_RECENTES}`, `--json=${CAMPOS_DOS_RECENTES}`]);
    if (typeof recentes === 'string') return { ok: false, lidoEm, erro: recentes };
    juntar(recentes, false);
    // R1 do CHECK (rodada 3): antes de dizer "sem PR", a branch candidata e conferida sozinha (o mesclado velho
    // fica fora dos recentes). Acima do teto da batida, a branch fica sem conferir, e isso e "PR nao lido".
    const achadas = new Set([...porNumero.values()].map((p) => p.branch));
    const faltam = [...new Set(opcoes.candidatas ?? [])].filter((b) => BRANCH.test(b) && !achadas.has(b));
    const semConferir: string[] = [];
    for (const [i, branch] of faltam.entries()) {
      // Acima do teto da batida, sem tempo para a conferencia inteira ou com ela falhando, a candidata fica sem conferir
      // ("PR nao lido") e o que ja foi lido vale (sugestao da seguranca na rodada 4 do CHECK).
      if (i >= LIMITE_DE_CANDIDATAS || resta() < MINIMO_DA_CONFERENCIA_MS) { semConferir.push(branch); continue; }
      const daBranch = pedir(['--state=all', `--head=${branch}`, '--limit=5', `--json=${CAMPOS_DOS_RECENTES}`]);
      try {
        if (typeof daBranch === 'string') throw new Error(daBranch);
        juntar(daBranch, false);
      } catch { semConferir.push(branch); }
    }
    return { ok: true, retrato: { contrato: CONTRATO_PRS, lidoEm, repositorio, ...(host !== 'github.com' ? { host } : {}), base,
      parcial: abertos.length >= LIMITE_DE_PRS, ...(semConferir.length ? { semConferir } : {}), prs: [...porNumero.values()] } };
  } catch (e) {
    return { ok: false, lidoEm, erro: `resposta do gh pr list fora do formato: ${curto(redigirSegredos((e as Error).message), 120) ?? 'sem detalhe'}` };
  }
}

const dirDoMonitor = (raiz: string) => path.join(raizDoEstado(raiz), '.orkastery', 'monitor');

/** Grava o retrato de uma leitura que deu certo: arquivo novo exclusivo, so do dono, renomeado por cima. */
export function gravarRetratoDePrs(raiz: string, retrato: RetratoDePrs): void {
  const dir = dirDoMonitor(raiz);
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, ARQUIVO_DOS_PRS), tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(retrato, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ja saiu */ }
    throw e;
  }
}

const ARQUIVO_DA_FORJA_SEM_LEITURA = 'forja-sem-leitura.json';
export const CONTRATO_FORJA_SEM_LEITURA = 'ork.forja-sem-leitura/v1' as const;

/** RM-037 (fatia 5, A5): o que o pulse ja disse sobre a forja sem leitura de PR, para nao dizer de novo a cada batida. */
export interface AvisoDeForjaSemLeitura extends ForjaSemLeitura {
  contrato: typeof CONTRATO_FORJA_SEM_LEITURA;
  motivo: string;
  ditoEm: string;
}

function lerAvisoDeForjaSemLeitura(raiz: string): AvisoDeForjaSemLeitura | null {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz), ARQUIVO_DA_FORJA_SEM_LEITURA), 'utf8')) as Record<string, unknown>;
    const ditoEm = instante(a.ditoEm), motivo = curto(a.motivo, 200);
    if (a.contrato !== CONTRATO_FORJA_SEM_LEITURA || typeof a.remoto !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(a.remoto) ||
        !(a.host === null || (typeof a.host === 'string' && HOST.test(a.host))) || !ditoEm || !motivo) return null;
    return { contrato: CONTRATO_FORJA_SEM_LEITURA, remoto: a.remoto, host: a.host as string | null, motivo, ditoEm };
  } catch { return null; }
}

/**
 * RM-037 (fatia 5, A5): a forja sem leitura de PR e dita uma vez por remoto e host. Com o remoto fora do github.com,
 * o pulse dizia "PR nao lido" a cada batida, para um estado que nao muda de uma batida para a outra. A marca em
 * `.orkastery/monitor/` guarda o que ja foi dito; devolve true quando e novidade (e grava a marca).
 */
export function avisarForjaSemLeitura(raiz: string, semLeitura: ForjaSemLeitura, motivo: string, quando: string): boolean {
  const atual = lerAvisoDeForjaSemLeitura(raiz);
  if (atual && atual.remoto === semLeitura.remoto && atual.host === semLeitura.host) return false;
  const dir = dirDoMonitor(raiz);
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, ARQUIVO_DA_FORJA_SEM_LEITURA), tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
  const aviso: AvisoDeForjaSemLeitura = { contrato: CONTRATO_FORJA_SEM_LEITURA, ...semLeitura, motivo: curto(motivo, 200) ?? FORJA_SEM_LEITURA,
    ditoEm: quando };
  try {
    fs.writeFileSync(tmp, JSON.stringify(aviso, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ja saiu */ }
    throw e;
  }
  return true;
}

/** A leitura voltou: a marca sai, e a forja que perder a leitura de novo volta a ser dita. */
export function esquecerForjaSemLeitura(raiz: string): void {
  fs.rmSync(path.join(dirDoMonitor(raiz), ARQUIVO_DA_FORJA_SEM_LEITURA), { force: true });
}

/**
 * A forja sem leitura que o pulse ja disse, so quando ela e a do remoto de agora (mesmo nome e mesmo host): o status
 * do roadmap a le sem rede e sem `gh`.
 */
export function forjaSemLeituraDoRemoto(raiz: string, remoto: string): AvisoDeForjaSemLeitura | null {
  const aviso = lerAvisoDeForjaSemLeitura(raiz);
  if (!aviso || aviso.remoto !== remoto) return null;
  const url = git(raiz, ['remote', 'get-url', remoto]);
  const host = url.ok ? enderecoDoRemoto(url.stdout.trim())?.host ?? null : null;
  return host === aviso.host ? aviso : null;
}

/** O ultimo retrato gravado pelo pulse, conferido campo a campo e com os nomes de check limpos de novo. */
export function lerRetratoDePrs(raiz: string): RetratoDePrs | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dirDoMonitor(raiz), ARQUIVO_DOS_PRS), 'utf8')) as Record<string, unknown>;
    const lidoEm = instante(r.lidoEm);
    if (r.contrato !== CONTRATO_PRS || !lidoEm || typeof r.repositorio !== 'string' || !REPOSITORIO.test(r.repositorio) ||
        typeof r.base !== 'string' || typeof r.parcial !== 'boolean' || !Array.isArray(r.prs) ||
        (r.host !== undefined && !(typeof r.host === 'string' && HOST.test(r.host))) ||
        (r.semConferir !== undefined && !(Array.isArray(r.semConferir) && r.semConferir.every((b) => typeof b === 'string' && BRANCH.test(b))))) return null;
    const opcional = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : instante(v) ?? undefined);
    const prs: PrDaForja[] = [];
    for (const bruto of r.prs as unknown[]) {
      const p = (bruto ?? {}) as Record<string, unknown>;
      const estado = p.estado as PrDaForja['estado'];
      const criadoEm = opcional(p.criadoEm), mescladoEm = opcional(p.mescladoEm);
      if (!Number.isSafeInteger(p.numero) || (p.numero as number) < 1 || typeof p.branch !== 'string' || !BRANCH.test(p.branch) ||
          typeof p.head !== 'string' || !SHA.test(p.head) || !['aberto', 'mesclado', 'fechado'].includes(estado) ||
          typeof p.rascunho !== 'boolean' || !Array.isArray(p.checks) || criadoEm === undefined || mescladoEm === undefined) return null;
      const checks: CheckDoPr[] = [];
      for (const c of p.checks as unknown[]) {
        const k = (c ?? {}) as Record<string, unknown>;
        const nome = nomeDeCheck(k.nome), concluidoEm = opcional(k.concluidoEm);
        if (!nome || !['verde', 'vermelho', 'pendente'].includes(String(k.situacao)) || concluidoEm === undefined) return null;
        checks.push({ nome, situacao: k.situacao as SituacaoDoCheck, concluidoEm });
      }
      prs.push({ numero: p.numero as number, branch: p.branch, head: p.head, estado, rascunho: p.rascunho,
        url: typeof p.url === 'string' && /^https:\/\/[^\s]+$/.test(p.url) ? curto(p.url, 300) : null, criadoEm, mescladoEm, checks });
    }
    return { contrato: CONTRATO_PRS, lidoEm, repositorio: r.repositorio, ...(typeof r.host === 'string' ? { host: r.host } : {}),
      base: r.base, parcial: r.parcial, ...(Array.isArray(r.semConferir) && r.semConferir.length ? { semConferir: r.semConferir as string[] } : {}), prs };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Quem e do condutor (D6).
// ---------------------------------------------------------------------------

const RESPOSTAS_HITL = ['human_gate', 'session_answered'];

/**
 * Pergunta estruturada ainda pendente desde `desde`: pedido sem resposta que, vencido, espera ou escala
 * (so o "seguir a recomendada" resolve sozinho). Decisao informada (`decidido`) nao e pergunta. Pedido
 * ilegivel conta como pendente: na duvida, a vez e do dono.
 */
export function perguntaAberta(eventos: readonly EventoLedger[], desde: string, quando: string): boolean {
  const inicio = Date.parse(desde);
  const respondidos = new Set(eventos.filter((e) => RESPOSTAS_HITL.includes(e.tipo)).map((e) => String(e.pedidoId)));
  // O pedido novo para o mesmo alvo substitui o velho: so o mais novo de cada sessao ou gate conta.
  const porAlvo = new Map<string, PedidoHitlQualquer | null>();
  for (const e of eventos) {
    if (e.tipo !== 'hitl_requested' || Date.parse(e.ts) < inicio) continue;
    const pedido = e.pedido as PedidoHitlQualquer | undefined;
    if (!pedido || typeof pedido !== 'object') { porAlvo.set(`ilegivel:${String(e.eventId)}`, null); continue; }
    if ((pedido as { classe?: unknown }).classe === 'decidido') continue;
    let alvo: unknown;
    try { alvo = alvoDoPedido(pedido); } catch { alvo = undefined; }
    porAlvo.set(alvo ? JSON.stringify(alvo) : `pedido:${String(pedido.id)}`, pedido);
  }
  return [...porAlvo.values()].some((pedido) => {
    if (!pedido) return true;
    if (respondidos.has(String(pedido.id))) return false;
    try { return estadoDoPedido(pedido, quando) !== 'seguir-recomendada'; } catch { return true; }
  });
}

/** O carimbo que o radar grava (`ork sessions hitl --registrar`): a leitura da tela, nao um evento da sessao. */
const doRadar = (e: EventoLedger): boolean => e.tipo === 'sessao_bloqueada' && e.fonte === 'ork sessions hitl --registrar';

/**
 * B1 do CHECK (rodada 5): o SHIP que o observador viu terminar em `done`, com o Stop, sem o `ship_done` no
 * intervalo do despacho. A prova do ork no SHIP e so o `ship_done` (`provaDoOrk`): o que falta e mergear o PR
 * ou registrar a entrega, e isso e do condutor, como o fim de turno em `blocked`. Dos 4 `human.pending` do SHIP
 * nos ledgers de 30/09, 2 tem este formato (ork-rm037noite e ork-pacotedeexpe). O CHECK em `done` sem o veredito
 * e outra coisa: `checkSemVeredito`.
 */
function shipSemRegistro(e: EventoLedger): boolean {
  const { ok: provou } = (e.provaOrk ?? {}) as { ok?: unknown };
  return e.motivo === 'human.pending' && e.origem === 'sessions.watch' && e.fase === 'SHIP' && e.estadoNativo === 'done' &&
    !!e.stop && provou === false;
}

/**
 * RM-037 (fatia 5, A3): o CHECK que o observador viu terminar em `done`, com o Stop, sem exatamente um veredito
 * legivel no `docs/check.md` (`provaDoOrk`). No #Auto, com o bloco sem pausa ao fim, ninguem perguntou nada ao dono:
 * o passo e do condutor, que redespacha o CHECK. Nos dois casos reais (ork-i35horariodo em 20/09 e ork-pacotedeexpe
 * em 30/09, as duas #Auto) o condutor seguiu sozinho minutos depois, sem pergunta ao dono. Fora do #Auto, segue com
 * o dono, como antes.
 */
function checkSemVeredito(e: EventoLedger): boolean {
  const { ok: provou } = (e.provaOrk ?? {}) as { ok?: unknown };
  return e.motivo === 'human.pending' && e.origem === 'sessions.watch' && e.fase === 'CHECK' && e.estadoNativo === 'done' &&
    !!e.stop && provou === false;
}

/**
 * O bloqueio que pede o dono: o prompt de permissao do hook e o que o radar leu com pergunta na tela. O
 * carimbo do radar no fim de turno (`blocked` lido sem menu nem pergunta) nao e prompt nenhum.
 */
function bloqueioDoDono(e: EventoLedger): boolean {
  return e.tipo === 'sessao_bloqueada' && !(doRadar(e) && e.tipoDeHitl === 'hitl.desconhecido' && !String(e.pergunta ?? '').trim());
}

/**
 * O ultimo entre bloqueio do dono, destravamento e Stop da sessao, desde o despacho, e bloqueio? R4-1 do CHECK
 * (rodada 4): o carimbo do radar depois de um Stop, sem atividade da sessao no meio, e a leitura da mensagem
 * final (a lista numerada vira "hitl.pergunta"; a palavra "token", "hitl.credencial") e nao conta. O prompt do
 * hook conta sempre.
 */
function bloqueioPendente(eventos: readonly EventoLedger[], sessionId: string, desde: string): boolean {
  const inicio = Date.parse(desde);
  let pendente = false, turnoEncerrado = false;
  for (const e of eventos) {
    if (e.sessionId !== sessionId || Date.parse(e.ts) < inicio) continue;
    if (e.tipo === 'runtime_stop') { pendente = false; turnoEncerrado = true; }
    else if (e.tipo === 'sessao_destravada') pendente = false;
    else if (doRadar(e)) { if (bloqueioDoDono(e) && !turnoEncerrado) pendente = true; }
    else if (atividadeDaSessao(e)) { turnoEncerrado = false; if (e.tipo === 'sessao_bloqueada') pendente = true; }
  }
  return pendente;
}

/** O ultimo despacho de fase da thread, quando ha um. */
function ultimoDespacho(eventos: readonly EventoLedger[]): EventoLedger | null {
  for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].tipo === 'phase_dispatch') return eventos[i];
  return null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Como o turno do ultimo despacho acabou, quando acabou (so pelo ledger). */
export interface FimDoTurno {
  em: string;
  /**
   * `concluida`: resultado da fase com a prova do ork (ou o legado `ok: true`). `espera-do-observador`: o
   * observador viu o Stop e a sessao `blocked`, ou o SHIP em `done` sem o `ship_done` (`comProva: false`), e
   * gravou `human.pending`. `stop-sem-resultado`: o Stop foi a ultima atividade e o resultado nunca veio (a
   * fatia 3 de 01/10). `pausa-do-bloco`: a fase terminou e o
   * bloco pausou para o dono (depois do veredito dele, o passo e do condutor). `check-sem-veredito`: no #Auto, o
   * CHECK em `done` com o Stop e sem o veredito (RM-037, fatia 5, A3); o passo e redespachar o CHECK. `outro`:
   * falha tecnica, com dono proprio. Sessao `blocked` sem Stop e prompt no meio do turno, e nao fim de turno.
   */
  tipo: 'concluida' | 'espera-do-observador' | 'check-sem-veredito' | 'stop-sem-resultado' | 'pausa-do-bloco' | 'outro';
  sessionId: string | null;
  fase: string | null;
  /** A prova do ork que o observador conferiu, quando ele diz. */
  comProva: boolean | null;
}

/**
 * Atividade da sessao que supera um fim de turno: heartbeat (fora a notificacao de ociosidade), commit, Stop
 * novo e prompt de permissao do hook. O carimbo do radar nao e atividade: so registra o `blocked` que ja
 * estava la, mesmo quando a tela traz lista ou palavra-chave (R4-1 do CHECK, rodada 4).
 */
function atividadeDaSessao(e: EventoLedger): boolean {
  if (e.tipo === 'runtime_event') return !(e.sensor === 'notification' && e.notificationType === 'idle_prompt');
  return e.tipo === 'commit' || e.tipo === 'runtime_stop' || (e.tipo === 'sessao_bloqueada' && !doRadar(e));
}

/** `modo`: o da thread. Sem ele, o CHECK sem o veredito fica com o dono, como fora do #Auto. */
export function fimDoTurno(eventos: readonly EventoLedger[], despacho: EventoLedger, modo?: Thread['modo']): FimDoTurno | null {
  const i = eventos.lastIndexOf(despacho);
  const depois = eventos.slice(i + 1);
  const sid = texto(despacho.sessionId);
  const daSessao = (e: EventoLedger) => !sid || !e.sessionId || e.sessionId === sid;
  const resultado = [...depois].reverse().find((e) => e.tipo === 'phase_result' && daSessao(e));
  let concluida = false;
  if (resultado) {
    const fase = texto(resultado.fase);
    // O resultado legado (sem classificacao, `ok: true`) tambem e fase concluida.
    concluida = resultado.ok !== false && (resultado.classificacao === 'fase_concluida' ||
      (resultado.classificacao === undefined && resultado.ok === true));
    // A1 (rodada 3) e R4-2 (rodada 4) do CHECK: o dono pode ter respondido na tela e a sessao voltado a trabalhar,
    // depois da fase concluida ou da espera do observador. So vale o fim de turno sem atividade depois; com
    // atividade, decide o Stop correlacionado mais novo, abaixo.
    const retomou = !!sid && eventos.slice(eventos.lastIndexOf(resultado) + 1).some((e) => e.sessionId === sid && atividadeDaSessao(e));
    if (concluida) {
      if (!retomou) return { em: resultado.ts, tipo: 'concluida', sessionId: sid, fase, comProva: true };
    } else if (resultado.motivo === 'human.pending' && despacho.pausaAoFim === true) {
      // S-a do CHECK (rodada 3): no bloco com pausa ao fim, todo `human.pending` do resultado e a fase entregue ao dono.
      return { em: resultado.ts, tipo: 'pausa-do-bloco', sessionId: sid, fase, comProva: true };
    } else if (resultado.motivo === 'human.pending' && resultado.stop && (resultado.estadoNativo === 'blocked' || shipSemRegistro(resultado) ||
        (modo === 'auto' && checkSemVeredito(resultado)))) {
      if (!retomou) {
        const { ts: doStop } = resultado.stop as { ts?: unknown };
        const { ok: provou } = (resultado.provaOrk ?? {}) as { ok?: unknown };
        return { em: instante(doStop) ?? resultado.ts, tipo: checkSemVeredito(resultado) ? 'check-sem-veredito' : 'espera-do-observador',
          sessionId: sid, fase, comProva: typeof provou === 'boolean' ? provou : null };
      }
    } else return { em: resultado.ts, tipo: 'outro', sessionId: sid, fase, comProva: null };
  }
  if (sid) {
    const ultimoStop = [...depois].reverse().find((e) => e.tipo === 'runtime_stop' && e.sessionId === sid && e.sensor === 'stop');
    const despachadaEm = texto(ultimoStop?.despachoEm);
    if (ultimoStop && despachadaEm) {
      const stop = stopCorrelacionado(eventos, { sessionId: sid, fase: String(ultimoStop.fase) as Thread['faseAtual'], despachadaEm });
      // Com resultado anterior e sessao retomada, so o Stop depois do resultado encerra o turno novo. A fase que
      // ja tinha concluido continua concluida; o turno novo acabou neste Stop.
      if (stop && (!resultado || Date.parse(stop.ts) > Date.parse(resultado.ts))) {
        return concluida ? { em: stop.ts, tipo: 'concluida', sessionId: sid, fase: texto(resultado?.fase) ?? texto(stop.fase), comProva: true }
          : { em: stop.ts, tipo: 'stop-sem-resultado', sessionId: sid, fase: texto(stop.fase), comProva: null };
      }
    }
  }
  return null;
}

/**
 * O que ainda espera o dono depois do ultimo despacho, quando espera: a pausa prevista do bloco sem
 * aprovacao humana, a thread pausada, a pergunta pendente, o prompt de permissao e a escalacao tipada
 * dele, cada um com as regras de destravar do monitor. Nada disso e do condutor (P3).
 */
export function pendenciaDoDono(t: Thread, eventos: readonly EventoLedger[], quando: string): string | null {
  if (t.status === 'pausada') return 'thread pausada';
  const despacho = ultimoDespacho(eventos);
  if (!despacho) return null;
  const depois = eventos.slice(eventos.lastIndexOf(despacho) + 1);
  if (despacho.pausaAoFim === true && !depois.some(ehAprovacaoHumana)) return 'pausa prevista ao fim do bloco';
  if (perguntaAberta(eventos, despacho.ts, quando)) return 'pergunta aberta';
  const sid = texto(despacho.sessionId);
  if (sid && bloqueioPendente(eventos, sid, despacho.ts)) return 'prompt de permissão pendente';
  // Aviso da rodada 6 do CHECK: o gate do observador so muda de dono com o fim de turno provado. A sessao que voltou a
  // trabalhar depois do resultado, sem Stop novo, segue do dono, e a thread nao sai tambem como linha do condutor.
  const fim = fimDoTurno(eventos, despacho, t.modo);
  const turnoEncerrado = !!fim && fim.tipo !== 'outro';
  for (let k = 0; k < depois.length; k++) {
    const e = depois[k];
    if (e.tipo !== 'gate_blocked') continue;
    const motivo = String(e.motivo ?? '');
    // O fim de turno que o observador viu em `blocked`, o SHIP em `done` sem o `ship_done` (B1 da rodada 5) e, no #Auto,
    // o CHECK em `done` sem o veredito (A3, fatia 5) nao sao escalacao: sao justamente o que muda de dono.
    if (turnoEncerrado && motivo === 'human.pending' && e.origem === 'sessions.watch' &&
        (e.estadoNativo === 'blocked' || shipSemRegistro(e) || (t.modo === 'auto' && checkSemVeredito(e)))) continue;
    const doDono = motivo === 'human.pending' ||
      ((MOTIVOS_DE_ESCALACAO_HUMANA as readonly string[]).includes(motivo) && quemDecide(motivo) === 'dono');
    const resolvido = depois.slice(k + 1).some((p) => EVENTOS_QUE_DESTRAVAM.includes(p.tipo) || ehAprovacaoHumana(p));
    if (doDono && !resolvido) return `escalação ${motivo}`;
  }
  return null;
}

/** A espera que e do condutor: o turno do ultimo despacho acabou, sem pausa ao fim e sem nada do dono. */
export interface EsperaDoCondutor {
  thread: string;
  fase: string | null;
  sessionId: string | null;
  fimDoTurnoEm: string;
  tipo: Exclude<FimDoTurno['tipo'], 'outro' | 'pausa-do-bloco'>;
  comProva: boolean | null;
}

export function esperaDoCondutor(t: Thread, eventos: readonly EventoLedger[], quando: string): EsperaDoCondutor | null {
  if (t.status === 'fechada') return null;
  const despacho = ultimoDespacho(eventos);
  if (!despacho || despacho.pausaAoFim !== false) return null;
  const fim = fimDoTurno(eventos, despacho, t.modo);
  if (!fim || fim.tipo === 'outro' || fim.tipo === 'pausa-do-bloco' || pendenciaDoDono(t, eventos, quando)) return null;
  return { thread: t.id, fase: fim.fase, sessionId: fim.sessionId, fimDoTurnoEm: fim.em, tipo: fim.tipo, comProva: fim.comProva };
}

/**
 * Sessao `blocked` do radar de quem o turno acabou sem pergunta: claude-bg com a tela lida, sem menu, sem
 * pergunta e sem palavra de credencial ou permissao. Sessao nativa (Codex) em `blocked` e pergunta
 * estruturada, e tela nao lida (orcamento) nao prova nada: as duas continuam do dono.
 */
export function sessaoSemPergunta(s: SessaoNoRadar): boolean {
  return s.classe === 'hitl' && s.jobVivo === true && s.kind !== 'codex-controller' && s.tipoDeHitl === 'hitl.desconhecido' &&
    s.alternativas.length === 0 && !s.pergunta?.trim() && !!s.thread?.id;
}

// ---------------------------------------------------------------------------
// O estado da entrega e os casos.
// ---------------------------------------------------------------------------

export interface ParadoNoCondutor {
  thread: string;
  caso: CasoParado;
  desdeEm: string;
  paradoHaMin: number;
  proximoPasso: string;
  evidencia: string[];
  branch: string | null;
  pr: number | null;
  sessionId: string | null;
  /** A hora da leitura dos PRs, quando o caso depende dela. */
  prLidoEm: string | null;
}

export interface PrDaEntrega {
  numero: number;
  estado: PrDaForja['estado'];
  situacao: SituacaoDoCheck | null;
  /** O check vermelho mais novo, quando ha. */
  checkVermelho: string | null;
  rascunho: boolean;
}

export interface EstadoDaEntrega {
  thread: string;
  branch: string | null;
  /** A ponta da branch tem commit fora da base. */
  comProduto: boolean;
  /** `true`: a copia local do remoto contem a ponta; `false`: ha commit sem push; `null`: sem branch ou git sem resposta. */
  publicada: boolean | null;
  pr: PrDaEntrega | null;
  /** A hora da leitura dos PRs que valeu para esta thread. */
  prLidoEm: string | null;
  /** Por que os PRs nao valeram, quando a thread precisava deles. */
  prNaoLido: string | null;
  conduzidaAgora: boolean;
  espera: EsperaDoCondutor | null;
  parado: ParadoNoCondutor | null;
  /** O estado real em uma frase, para o status do roadmap. */
  resumo: string | null;
}

export interface OpcoesDasEntregas {
  quando: string;
  /**
   * A leitura dos PRs: chamada no maximo uma vez, e so quando ha produto numa branch que ja foi ao remoto. As
   * candidatas sao essas branches, que a leitura confere uma a uma quando nao aparecem nas listas.
   */
  lerPrs?: (candidatas: readonly string[]) => LeituraDePrs | null;
  /** O radar do pulse: as sessoes que sobraram, sem pergunta. */
  sessoes?: readonly SessaoNoRadar[];
  limiarMin?: number;
}

export interface EntregasDoProjeto {
  estados: EstadoDaEntrega[];
  /** Uma linha por thread: o caso dela ou, sem caso, as sessoes que sobraram. */
  parados: ParadoNoCondutor[];
  /**
   * O que o pulse tira do dono: `thread|fase` do `human.pending` do observador e as sessoes sem pergunta.
   * `turnosEncerrados`: as sessoes cujo fim de turno o ledger provou (Stop sem atividade depois); a tela
   * delas e a mensagem final, mesmo quando traz uma lista numerada.
   */
  doCondutor: { gates: Set<string>; sessoes: Set<string>; turnosEncerrados: Set<string> };
  prs: LeituraDePrs | null;
}

const minutosDesde = (desde: string, quando: string): number =>
  Math.max(0, Math.floor((Date.parse(quando) - Date.parse(desde)) / 60000));

const curtoDaSessao = (sid: string | null): string => (sid ?? '').slice(0, 8);

/** Os refs locais de uma vez: `refs/heads/...` e a copia do remoto, sem rede. */
function refsLocais(raiz: string, remoto: string): Map<string, string> {
  const r = git(raiz, ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads/', `refs/remotes/${remoto}/`]);
  const mapa = new Map<string, string>();
  if (!r.ok) return mapa;
  for (const linha of r.stdout.split('\n')) {
    const [ref, sha] = linha.split('\t');
    if (ref && sha && SHA.test(sha)) mapa.set(ref, sha);
  }
  return mapa;
}

/** Os merges `ship(<thread>)` da base numa leitura so, do mais novo para o mais velho (fica o mais novo). */
function mergesNaBase(raiz: string, baseRef: string | null): Map<string, { sha: string; em: string | null }> {
  const mapa = new Map<string, { sha: string; em: string | null }>();
  if (!baseRef) return mapa;
  // Regex basica do git: o `(` e literal. A ref vem qualificada do `for-each-ref`.
  const r = git(raiz, ['log', baseRef, '--first-parent', '--format=%H%x09%cI%x09%s', '--grep=^ship(']);
  if (!r.ok) return mapa;
  for (const linha of r.stdout.split('\n')) {
    const [sha, em, assunto] = linha.split('\t');
    const m = /^ship\(([A-Za-z0-9._-]+)\)/.exec(assunto ?? '');
    if (m && sha && SHA.test(sha) && !mapa.has(m[1])) mapa.set(m[1], { sha, em: instante(em) });
  }
  return mapa;
}

/** Situacao dos checks de um PR aberto e o instante que conta para cada uma. */
function situacaoDoPr(pr: PrDaForja): { situacao: SituacaoDoCheck; desdeEm: string | null; vermelho: string | null; semChecks: boolean } {
  const maisNovo = (cs: CheckDoPr[]) => cs.map((c) => c.concluidoEm).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const vermelhos = pr.checks.filter((c) => c.situacao === 'vermelho');
  if (vermelhos.length) {
    const ultimo = [...vermelhos].sort((a, b) => String(a.concluidoEm).localeCompare(String(b.concluidoEm))).at(-1)!;
    return { situacao: 'vermelho', desdeEm: maisNovo(vermelhos) ?? pr.criadoEm, vermelho: ultimo.nome, semChecks: false };
  }
  if (!pr.checks.length) return { situacao: 'pendente', desdeEm: pr.criadoEm, vermelho: null, semChecks: true };
  if (pr.checks.some((c) => c.situacao === 'pendente')) return { situacao: 'pendente', desdeEm: null, vermelho: null, semChecks: false };
  return { situacao: 'verde', desdeEm: maisNovo(pr.checks) ?? pr.criadoEm, vermelho: null, semChecks: false };
}

/** Os PRs da branch no retrato: o aberto mais novo; o mesclado na ponta atual; o fechado mais novo. */
function prsDaBranch(retrato: RetratoDePrs | null, branch: string | null, cabeca: string | null) {
  const daBranch = retrato && branch ? retrato.prs.filter((p) => p.branch === branch).sort((a, b) => b.numero - a.numero) : [];
  return {
    aberto: daBranch.find((p) => p.estado === 'aberto') ?? null,
    // Commit novo depois do merge e entrega nova, que ainda nao tem PR.
    mesclado: daBranch.find((p) => p.estado === 'mesclado' && p.head === cabeca) ?? null,
    fechado: daBranch.find((p) => p.estado === 'fechado') ?? null,
    achado: daBranch.length > 0,
  };
}

const houveDespachoDepois = (eventos: readonly EventoLedger[], desde: string): boolean =>
  eventos.some((e) => e.tipo === 'phase_dispatch' && Date.parse(e.ts) > Date.parse(desde));

/**
 * A fase que vem depois do que o despacho rodou, quando o ciclo da thread tem uma. No #Auto uma sessao roda o
 * bloco inteiro; nos outros modos o condutor despacha fase a fase dentro do bloco (#Maestro: GOAL e depois
 * PLAN, as duas com o bloco GOAL-PLAN), e pular uma fase pularia a pausa do dono que mora nela.
 */
function faseSeguinte(t: Thread, despacho: EventoLedger | null): string | null {
  if (!despacho) return null;
  const fases = t.fases ?? [];
  const bloco = typeof despacho.bloco === 'string' && despacho.bloco ? despacho.bloco.split('-') : [];
  const rodou = t.modo === 'auto' && bloco.length ? bloco.at(-1) : String(despacho.fase ?? '');
  const i = fases.indexOf(rodou as Thread['faseAtual']);
  return i >= 0 && i + 1 < fases.length ? fases[i + 1] : null;
}

/** A linha das sessoes que sobraram de uma thread: uma linha, com todas elas. */
function passoDasSobras(ids: string[], fechada: boolean): string {
  const onde = fechada ? 'da thread fechada' : 'de um despacho anterior';
  return ids.length === 1
    ? `encerrar a sessão ${ids[0]}, que sobrou ${onde} (ork sessions stop ${ids[0]})`
    : `encerrar as sessões ${ids.join(' e ')}, que sobraram ${onde} (${ids.map((id) => `ork sessions stop ${id}`).join('; ')})`;
}

/**
 * O estado da entrega de cada thread aberta deste checkout e o que esta parado no condutor (D5), mais as
 * sessoes `blocked` sem pergunta que sobraram. O que o predicado tira do dono volta sempre como linha.
 */
export function entregasDoProjeto(carregado: ManifestoCarregado, opcoes: OpcoesDasEntregas): EntregasDoProjeto {
  const raiz = carregado.raiz, quando = opcoes.quando, limiar = opcoes.limiarMin ?? LIMIAR_PARADO_NO_CONDUTOR_MIN;
  const remoto = carregado.manifesto.fabrica.remoto, baseBranch = carregado.manifesto.worktree.base_branch;
  const refs = refsLocais(raiz, remoto);
  // A copia do remoto vem primeiro: a base local desta maquina pode estar parada (o merge e pelo GitHub).
  const baseRef = [`refs/remotes/${remoto}/${baseBranch}`, `refs/heads/${baseBranch}`].find((r) => refs.has(r)) ?? null;
  const merges = mergesNaBase(raiz, baseRef);
  const sessoes = opcoes.sessoes ?? [];
  const threads: Thread[] = [];
  for (const id of listarIds(raiz)) { try { threads.push(lerThread(raiz, id)); } catch { /* thread ilegivel fica de fora */ } }

  const fatos = threads.filter((t) => t.status !== 'fechada').map((t) => {
    let eventos: EventoLedger[] = [];
    try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { /* ledger ilegivel: sem fato, sem caso */ }
    const branch = branchDaWorktree(t);
    const cabeca = refs.get(`refs/heads/${branch}`) ?? null;
    const remota = refs.get(`refs/remotes/${remoto}/${branch}`) ?? null;
    const comProduto = !!cabeca && !!baseRef && Number(git(raiz, ['rev-list', '--count', `${baseRef}..${cabeca}`]).stdout.trim()) > 0;
    // `merge-base --is-ancestor`: 0 contem, 1 nao contem; outro codigo e git sem resposta, que nunca vira "sem push".
    const contem = remota && cabeca && remota !== cabeca ? git(raiz, ['merge-base', '--is-ancestor', cabeca, remota]).code : null;
    const publicada = !cabeca ? null : !remota ? false : remota === cabeca || contem === 0 ? true : contem === 1 ? false : null;
    const ships = eventos.filter((e) => e.tipo === 'ship_done'), merge = merges.get(t.id) ?? null;
    // R4-4 do CHECK (rodada 4): o `ship_done` cobre a entrega do mesmo head (`shaDe`) ou do mesmo merge; a entrega
    // nova depois dele ainda nao foi registrada. O legado sem o sha cobre tudo, como antes.
    const cobre = (campo: 'shaDe' | 'mergeSha', sha: string | null) =>
      ships.some((e) => typeof e[campo] !== 'string' || !SHA.test(e[campo] as string) || e[campo] === sha);
    // RM-037 (fatia 5, A1): ate esta fatia, o `ork ship` com a branch ja incorporada gravava a ponta da base no
    // `mergeSha`. Esse `ship_done` registra o merge `ship(<thread>)` que a ponta gravada contem.
    const contemOMerge = (sha: string) => ships.some((e) => typeof e.mergeSha === 'string' && SHA.test(e.mergeSha) &&
      e.mergeSha !== sha && git(raiz, ['merge-base', '--is-ancestor', sha, e.mergeSha]).code === 0);
    return { t, eventos, branch: cabeca ? branch : null, cabeca, comProduto, publicada, temRemota: !!remota,
      shipNoLedger: ships.length > 0, entregueNaPonta: cabeca ? cobre('shaDe', cabeca) : ships.length > 0,
      mergeRegistrado: !!merge && (cobre('mergeSha', merge.sha) || contemOMerge(merge.sha)), merge };
  });

  // D2: a forja so e lida quando alguma thread tem o que mostrar la: produto numa branch que ja foi ao remoto
  // (inteira, ou com commit novo ainda sem push, que pode ter PR aberto).
  let prs: LeituraDePrs | null = null;
  const candidatas = fatos.filter((f) => f.comProduto && f.temRemota && f.branch).map((f) => f.branch as string);
  if (opcoes.lerPrs && candidatas.length) prs = opcoes.lerPrs(candidatas);
  // O retrato so vale do repositorio e da base de agora, e lido ha menos de `VALIDADE_DO_RETRATO_MIN`.
  // RM-037 (fatia 5, A5): a forja sem leitura de PR e o estado dela, dito uma vez pelo pulse; a linha nunca diz "PR nao lido".
  const semLeituraDaForja = !!prs && !prs.ok && !!prs.semLeitura;
  let retrato: RetratoDePrs | null = null, semRetrato = prs && !prs.ok ? (semLeituraDaForja ? FORJA_SEM_LEITURA : prs.erro) : 'sem leitura dos PRs';
  if (prs?.ok) {
    const r = prs.retrato, atual = githubDoRemoto(raiz, remoto);
    // O retrato vale do mesmo host: o do GitHub Enterprise (`host`) ou, sem ele, o github.com.
    if (r.base !== baseBranch || !atual || r.repositorio !== atual.repositorio || (r.host ?? 'github.com') !== atual.host) {
      semRetrato = 'retrato de PRs de outro repositório ou base';
    }
    else if (minutosDesde(r.lidoEm, quando) > VALIDADE_DO_RETRATO_MIN) semRetrato = 'retrato de PRs velho';
    else if (Date.parse(r.lidoEm) - Date.parse(quando) > FOLGA_DO_RELOGIO_MIN * 60000) semRetrato = 'retrato de PRs com data no futuro';
    else retrato = r;
  }

  const estados: EstadoDaEntrega[] = [], parados: ParadoNoCondutor[] = [];
  const doCondutor = { gates: new Set<string>(), sessoes: new Set<string>(), turnosEncerrados: new Set<string>() };
  for (const f of fatos) {
    const { t, eventos } = f;
    const despacho = ultimoDespacho(eventos);
    const fim = despacho ? fimDoTurno(eventos, despacho, t.modo) : null;
    const terminou = !!fim && fim.tipo !== 'outro';
    const fimEm = terminou ? fim!.em : null;
    // A1 do CHECK (rodada 3): o fim de turno vem do ledger (Stop sem atividade depois); a tela da sessao depois
    // dele e a mensagem final, e a lista numerada nela nao e menu. Sessao retomada nao tem fim de turno.
    const espera = esperaDoCondutor(t, eventos, quando);
    if (espera) {
      doCondutor.gates.add(`${t.id}|${espera.fase ?? t.faseAtual}`);
      if (espera.sessionId) { doCondutor.sessoes.add(espera.sessionId); doCondutor.turnosEncerrados.add(espera.sessionId); }
    }
    const conducao = conducaoDaThread(raiz, t.id, { agora: new Date(quando) });
    // P7: a sessao que ja encerrou o turno nao conduz mais nada, mesmo com o lease de pe.
    const conduzidaAgora = !!conducao && !(conducao.dono.tipo === 'sessao' && terminou && conducao.dono.sessionId === fim!.sessionId);
    const doDono = pendenciaDoDono(t, eventos, quando);
    // A2 do CHECK (rodada 3): depois do veredito do dono, o tempo do condutor conta a partir dele.
    const aprovacao = despacho ? eventos.slice(eventos.lastIndexOf(despacho) + 1).filter(ehAprovacaoHumana).at(-1) : undefined;
    // A2 do CHECK: a leitura dos PRs so vale depois do fim do turno; antes dele, o turno pode ter mudado o PR.
    const prLido = retrato && (!fimEm || Date.parse(retrato.lidoEm) >= Date.parse(fimEm)) ? retrato : null;
    const daBranch = prsDaBranch(prLido, f.branch, f.cabeca);
    const aberto = daBranch.aberto, s = aberto ? situacaoDoPr(aberto) : null;
    // S1 do CHECK (rodada 2): o head do PR aberto e a ponta local: ja esta no GitHub, mesmo com a ref de rastreio velha.
    const publicada = f.publicada === false && aberto?.head === f.cabeca ? true : f.publicada;
    const precisaDePr = f.comProduto && publicada === true;
    const cortado = !!prLido && !daBranch.achado && (prLido.parcial || !!f.branch && !!prLido.semConferir?.includes(f.branch));
    const usouPr = !!prLido && precisaDePr && !cortado;
    const prNaoLido = !precisaDePr || usouPr ? null : !retrato ? semRetrato : !prLido ? 'retrato de PRs anterior ao fim do turno'
      : prLido.parcial ? `lista de PRs abertos cortada nos ${LIMITE_DE_PRS} mais novos` : 'branch sem conferir nesta batida';
    const proxima = faseSeguinte(t, despacho);
    const antesDaEntrega = !!proxima && FASES_ANTES_DA_ENTREGA.includes(proxima);
    const despachar = `despachar a fase ${proxima} (ork phase run ${t.id} ${proxima} --prompt "<pedido da fase>")`;
    const prSabido = !!prLido && !cortado;
    const autorizacao = MODOS_COM_PUSH_AUTORIZADO.includes(t.modo) ? '' : `, com a autorização de push do dono (${tagDoModo(t.modo)})`;
    // B2 do CHECK: depois de uma fase que terminou, o PR parado volta a ser do condutor, mesmo com despacho no meio.
    const valeDesde = (instanteDoPr: string) => !houveDespachoDepois(eventos, instanteDoPr) ||
      (!!fimEm && Date.parse(fimEm) >= Date.parse(instanteDoPr));
    const maisTarde = (a: string, b: string | null) => (b && Date.parse(b) > Date.parse(a) ? b : a);
    const { ts: aprovadaEm } = aprovacao ?? { ts: null };
    const fimOuVeredito = fimEm ? maisTarde(fimEm, aprovadaEm) : null;

    let caso: CasoParado | null = null, desde: string | null = null, passo = '', peloGit = false;
    const evidencia: string[] = [];
    if (!conduzidaAgora && !doDono) {
      if (espera?.tipo === 'check-sem-veredito') {
        // RM-037 (fatia 5, A3): antes de qualquer caso de entrega. Publicar ou mergear sem o veredito do CHECK pularia
        // a revisao; e o `ork retry run` nao redespacha `human.pending` (`escalar-humano`), entao o passo e o despacho.
        caso = 'check-sem-veredito'; desde = espera.fimDoTurnoEm;
        passo = `redespachar o CHECK (ork phase run ${t.id} CHECK --prompt "<pedido da fase>")`;
        evidencia.push('ledger: CHECK em done com o Stop, sem exatamente um veredito no docs/check.md');
      } else if (f.comProduto && publicada === false && terminou) {
        desde = fimOuVeredito;
        if (antesDaEntrega && !aberto) { caso = 'fase-seguinte'; passo = despachar; }
        else {
          caso = 'sem-push';
          // N2 da seguranca (rodada 2): branch que ja foi ao remoto pode ter PR; sem a leitura, nunca "abrir o PR". A4 da
          // rodada 5: publicar e abrir o PR pedem a mesma autorizacao de push que o merge.
          passo = (aberto ? `publicar os commits novos da branch ${f.branch} no PR #${aberto.numero}`
            // RM-037 (fatia 5, A5): a forja sem leitura de PR ja foi dita uma vez; a linha so diz o passo.
            : f.temRemota && !prSabido ? `publicar os commits novos da branch ${f.branch}${semLeituraDaForja ? '' : ' (PR não lido)'}`
            : `publicar a branch ${f.branch} e abrir o PR`) + autorizacao;
        }
        evidencia.push(`refs/heads/${f.branch} tem commit fora de refs/remotes/${remoto}/${f.branch}`);
      } else if (aberto && s?.situacao === 'vermelho' && s.desdeEm && valeDesde(s.desdeEm)) {
        caso = 'pr-vermelho'; desde = maisTarde(s.desdeEm, fimOuVeredito);
        passo = `corrigir o check ${s.vermelho} vermelho do PR #${aberto.numero} e despachar a correção`;
        evidencia.push(`gh pr list: PR #${aberto.numero} com o check ${s.vermelho} vermelho`);
      } else if (aberto && s && (s.situacao === 'verde' || s.semChecks) && s.desdeEm && valeDesde(s.desdeEm)) {
        caso = 'pr-verde'; desde = maisTarde(s.desdeEm, fimOuVeredito);
        passo = `${aberto.rascunho ? `tirar o PR #${aberto.numero} do rascunho e mergear` : `mergear o PR #${aberto.numero}`}` +
          `${s.semChecks ? ', que não tem checks' : ''}${autorizacao}`;
        evidencia.push(s.semChecks ? `gh pr list: PR #${aberto.numero} sem checks e sem merge`
          : `gh pr list: PR #${aberto.numero} com ${aberto.checks.length} check(s) verde(s) e sem merge`);
      } else if (!aberto && !f.comProduto && f.merge && !f.mergeRegistrado) {
        caso = 'sem-registro'; desde = f.merge.em ?? fimEm; peloGit = true;
        passo = `registrar a entrega do merge ${f.merge.sha.slice(0, 7)} (ork ship registrar-pr ${t.id})`;
        evidencia.push(`git log: merge ship(${t.id}) ${f.merge.sha.slice(0, 7)} na base, sem ship_done no ledger`);
      } else if (!aberto && daBranch.mesclado && !f.entregueNaPonta && (daBranch.mesclado.mescladoEm ?? fimEm)) {
        // N4 do CHECK (rodada 2): PR mesclado sem o assunto ship(<thread>); o `registrar-pr` nao o acha sozinho. Com o
        // merge ship(<thread>) ainda sem registro na base (squash), o `registrar-pr` acha.
        caso = 'sem-registro'; desde = daBranch.mesclado.mescladoEm ?? fimEm;
        passo = f.merge && !f.mergeRegistrado ? `registrar a entrega do merge ${f.merge.sha.slice(0, 7)} (ork ship registrar-pr ${t.id})`
          : `conferir a entrega do PR #${daBranch.mesclado.numero}, mesclado sem o assunto ship(${t.id}), e registrar o ship_done`;
        evidencia.push(`gh pr list: PR #${daBranch.mesclado.numero} mesclado na ponta da branch, sem ship_done no ledger`);
      } else if (!aberto && !daBranch.mesclado && precisaDePr && terminou && usouPr && !f.entregueNaPonta) {
        desde = fimOuVeredito;
        if (antesDaEntrega) { caso = 'fase-seguinte'; passo = despachar; }
        else {
          caso = 'sem-pr';
          passo = (daBranch.fechado ? `abrir de novo o PR da branch ${f.branch} (o PR #${daBranch.fechado.numero} foi fechado sem merge)`
            : `abrir o PR da branch ${f.branch}`) + autorizacao;
        }
        evidencia.push(`refs/remotes/${remoto}/${f.branch} contém a ponta`,
          daBranch.fechado ? `gh pr list: PR #${daBranch.fechado.numero} fechado sem merge` : `gh pr list: nenhum PR de ${f.branch}`);
      } else if (terminou && despacho?.pausaAoFim === true && aprovadaEm && proxima && FASES_ANTES_DA_ENTREGA.includes(proxima)) {
        // S-e do CHECK (rodada 3): o dono aprovou a pausa e a fase seguinte nao foi despachada. Rodada 5: vale para
        // qualquer fim de turno do bloco com pausa ao fim, porque no Codex a fase boa chega como `fase_concluida`.
        caso = 'fase-seguinte'; desde = aprovadaEm; passo = despachar;
        evidencia.push('ledger: veredito do dono na pausa prevista, sem despacho depois');
      } else if (espera) {
        // O que sai do dono volta sempre: sem caso de entrega, a linha diz o que a thread pede agora.
        desde = espera.fimDoTurnoEm;
        const id = curtoDaSessao(espera.sessionId);
        if (antesDaEntrega && !f.entregueNaPonta && espera.comProva !== false) { caso = 'fase-seguinte'; passo = despachar; }
        else {
          caso = 'sessao-sem-pergunta';
          passo = f.shipNoLedger && !f.comProduto ? `fechar o MASTER da thread (ork master ${t.id})`
            : aberto ? `acompanhar os checks do PR #${aberto.numero}, que seguem em andamento`
            : precisaDePr && !usouPr ? (semLeituraDaForja ? `conferir na forja o PR da branch ${f.branch} e seguir`
              : `conferir o PR da branch ${f.branch} (PR não lido) e seguir`)
            : `ler o fim da sessão ${id} (ork sessions logs ${id}) e seguir a thread`;
        }
      }
    }
    if (caso && fim && fim.tipo !== 'outro') evidencia.push(`fim do turno: ${fim.tipo}`);
    const paradoHaMin = desde ? minutosDesde(desde, quando) : 0;
    const dependeDoPr = caso === 'pr-verde' || caso === 'pr-vermelho' || caso === 'sem-pr' || (caso === 'sem-push' && !!aberto) ||
      (caso === 'sem-registro' && !peloGit);
    const parado: ParadoNoCondutor | null = caso && desde && paradoHaMin >= limiar ? {
      thread: t.id, caso, desdeEm: desde, paradoHaMin, proximoPasso: passo, evidencia, branch: f.branch, pr: aberto?.numero ?? null,
      sessionId: espera?.sessionId ?? fim?.sessionId ?? null, prLidoEm: dependeDoPr && prLido ? prLido.lidoEm : null,
    } : null;
    if (parado) parados.push(parado);

    const prDaEntrega: PrDaEntrega | null = aberto ? { numero: aberto.numero, estado: 'aberto', situacao: s?.situacao ?? null,
      checkVermelho: s?.vermelho ?? null, rascunho: aberto.rascunho }
      : daBranch.mesclado && !f.entregueNaPonta ? { numero: daBranch.mesclado.numero, estado: 'mesclado', situacao: null, checkVermelho: null, rascunho: false }
      : null;
    const registrar = `ork ship registrar-pr ${t.id}`;
    const resumo = aberto ? (s?.situacao === 'vermelho' ? `PR #${aberto.numero} aberto com o check ${s.vermelho} vermelho`
        : s?.semChecks ? `PR #${aberto.numero} aberto, sem checks, esperando o merge`
        : s?.situacao === 'verde' ? (aberto.rascunho ? `PR #${aberto.numero} em rascunho, com os checks verdes`
          : `PR #${aberto.numero} com os checks verdes, esperando o merge`)
        : `PR #${aberto.numero} aberto, checks em andamento`)
      : f.comProduto && publicada === false ? 'branch com commits sem push'
      : daBranch.mesclado && !f.entregueNaPonta ? (f.merge && !f.mergeRegistrado ? `PR #${daBranch.mesclado.numero} mesclado, falta registrar a entrega (${registrar})`
        : `PR #${daBranch.mesclado.numero} mesclado sem o assunto ship(${t.id}), falta registrar a entrega`)
      : !f.comProduto && f.merge && !f.mergeRegistrado ? `merge ${f.merge.sha.slice(0, 7)} na base, falta registrar a entrega (${registrar})`
      : precisaDePr ? (!usouPr ? (semLeituraDaForja ? `branch publicada, ${FORJA_SEM_LEITURA}` : 'branch publicada, PR não lido')
        : daBranch.fechado ? `branch publicada, PR #${daBranch.fechado.numero} fechado sem merge` : 'branch publicada sem PR')
      : null;
    estados.push({ thread: t.id, branch: f.branch, comProduto: f.comProduto, publicada, pr: prDaEntrega,
      prLidoEm: prLido && (usouPr || aberto) ? prLido.lidoEm : null, prNaoLido, conduzidaAgora, espera, parado, resumo });
  }

  // As sessoes `blocked` sem pergunta que sobraram: de thread fechada, ou de despacho antigo de thread aberta.
  // A do despacho corrente fica com o predicado do ledger (`esperaDoCondutor`). Sem o carimbo do radar nao
  // ha desde, e a sessao segue com o dono.
  const sobras = new Map<string, { ids: string[]; sessoes: string[]; desde: string; fechada: boolean }>();
  for (const s of sessoes) {
    if (!sessaoSemPergunta(s)) continue;
    const t = threads.find((x) => x.id === s.thread!.id);
    const { bloqueadaDesdeEm: carimbo } = s;
    const desde = instante(carimbo);
    if (!t || !desde) continue;
    if (t.status !== 'fechada') {
      let eventos: EventoLedger[] = [];
      try { eventos = lerLedger(dirThread(raiz, t.id)); } catch { continue; }
      const despachos = eventos.filter((e) => e.tipo === 'phase_dispatch');
      const antiga = texto(despachos.at(-1)?.sessionId) !== s.sessionId && despachos.some((e) => e.sessionId === s.sessionId);
      if (!antiga || pendenciaDoDono(t, eventos, quando)) continue;
    }
    const atual = sobras.get(t.id) ?? { ids: [], sessoes: [], desde, fechada: t.status === 'fechada' };
    atual.ids.push(curtoDaSessao(s.sessionId)); atual.sessoes.push(s.sessionId);
    if (Date.parse(desde) < Date.parse(atual.desde)) atual.desde = desde;
    sobras.set(t.id, atual);
  }
  for (const [thread, x] of sobras) {
    for (const sid of x.sessoes) doCondutor.sessoes.add(sid);
    // A thread que ja tem a linha dela nao ganha outra: uma linha por thread.
    if (parados.some((p) => p.thread === thread) || minutosDesde(x.desde, quando) < limiar) continue;
    parados.push({ thread, caso: 'sessao-sem-pergunta', desdeEm: x.desde, paradoHaMin: minutosDesde(x.desde, quando),
      proximoPasso: passoDasSobras(x.ids, x.fechada), evidencia: ['radar: sessão blocked com a tela lida, sem menu nem pergunta'],
      branch: null, pr: null, sessionId: x.sessoes[0], prLidoEm: null });
  }
  parados.sort((a, b) => a.desdeEm.localeCompare(b.desdeEm) || a.thread.localeCompare(b.thread));
  return { estados, parados, doCondutor, prs };
}

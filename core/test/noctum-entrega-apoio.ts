/**
 * RM-058 (N5): o apoio dos testes da entrega. O projeto tem um remoto bare de verdade (push, `ls-remote` e merge são do
 * git), o CI obrigatório ligado e o CHANGELOG com "Não publicado" na base; as sessões, os despachos, os pareceres, os
 * verifies e o check do CI são SIMULADOS, gravados com os mesmos campos que o núcleo grava (`phase.ts`, o observador do
 * claude-bg e o `verify_run`). Nenhum teste toca o remoto real nem o GitHub.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ajustarManifesto, commitar, copiadorDeProjetoDeTeste, projetoTemporario, ProjetoDeTeste } from './apoio';
import { passar } from './noctum-apoio';
import { ExecutorCi, prepararBundleCi } from '../src/ci';
import { registrarConducaoDaSessao } from '../src/conducao';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { ResultadoRun } from '../src/phase';
import { adicionarClaim, lerClaims } from '../src/claims';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { Fase, SessaoDaThread, Thread } from '../src/types';
import { exec } from '../src/util';
import { CONTRATO_REDE_DO_ARCO, RedeDoArco } from '../src/noctum-rede';

/** O GitHub que os testes fixam para o remoto bare; o envelope de `noctum-apoio` autoriza este repositório. */
export const FORJA = { host: 'github.com', repositorio: 'exemplo/produto' };

export const CAB = '# Changelog\n\nAs mudanças, da mais nova para a mais antiga.\n\n';
export const CHANGELOG_DA_BASE = `${CAB}## Não publicado\n\n### Adicionado\n\n- **Antiga SIMULADA** (RM-900): já estava na base.\n\n` +
  '## [0.1.0] - 2026-10-01\n\n- v1\n';

export const git = (dir: string, ...args: string[]) => exec('git', args, dir);
export const head = (dir: string): string => git(dir, 'rev-parse', 'HEAD').stdout.trim();

/** O modelo com remoto bare, CI obrigatório e o CHANGELOG da base publicado. */
function criarModeloDaEntrega(): ProjetoDeTeste {
  const p = projetoTemporario('noctum-entrega-modelo', true);
  ajustarManifesto(p, 'required_for_ship: false', 'required_for_ship: true');
  commitar(p.dir, 'CHANGELOG.md', CHANGELOG_DA_BASE, 'docs: o CHANGELOG da base');
  git(p.dir, 'push', '-q', 'origin', 'main');
  return p;
}

const projetosDaEntrega = copiadorDeProjetoDeTeste(criarModeloDaEntrega);
export const totalDeModelosDaEntrega = (): number => projetosDaEntrega.totalDeModelos();

/** Uma copia isolada do modelo da entrega; worktrees, commits e efeitos continuam pertencendo ao caso. */
export function projetoDaEntrega(nome: string): ProjetoDeTeste {
  return projetosDaEntrega.copiar(nome);
}

/** A thread #Auto do item, com a worktree dela e o pedido guardado. */
export function threadComWorktree(p: ProjetoDeTeste, nome: string, item = 'RM-958'): Thread {
  return novaThread(p.carregado, { nome, modo: 'auto', roadmap: item, pedido: `Pedido SIMULADO da entrega ${nome}.`, criarWorktree: true }).thread;
}

/** Grava e commita arquivos na worktree da thread; devolve o sha. */
export function commitarNaWorktree(t: Thread, arquivos: Record<string, string>, mensagem: string): string {
  const dir = t.worktree!;
  for (const [arquivo, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(dir, arquivo), conteudo);
    git(dir, 'add', '--', arquivo);
  }
  const r = git(dir, 'commit', '-q', '-m', mensagem);
  if (!r.ok) throw new Error(`commit falhou: ${r.stderr}`);
  return head(dir);
}

/** Avança a base: um commit na `main` da raiz, empurrado para o remoto. */
export function avancarBase(p: ProjetoDeTeste, arquivos: Record<string, string>, mensagem: string): string {
  for (const [arquivo, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(p.dir, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, arquivo), conteudo);
    git(p.dir, 'add', '--', arquivo);
  }
  git(p.dir, 'commit', '-q', '-m', mensagem);
  git(p.dir, 'push', '-q', 'origin', 'main');
  return head(p.dir);
}

let sessoes = 0;

export interface SessaoSimulada { sessionId: string; despachadaEm: string; fase: Fase }

/**
 * Uma sessão despachada como o `phase run` deixa: o prompt na pasta da thread, a entrada em `thread.sessoes`, o
 * `phase_dispatch` e o `phase_dispatch_verified`.
 */
export function sessaoDespachada(p: ProjetoDeTeste, threadId: string, fase: Fase,
  o: { bloco?: string; verificada?: boolean; runtime?: string; sessionId?: string; semVerificacao?: boolean } = {}): SessaoSimulada {
  sessoes += 1;
  passar(5);
  const sessionId = o.sessionId ?? `00000000-0000-4000-8005-${String(sessoes).padStart(12, '0')}`;
  const t = lerThread(p.dir, threadId);
  const bloco = o.bloco ?? (t.blocos?.find(b => b.fases.includes(fase))?.fases.join('-') ?? fase);
  const runtime = o.runtime ?? 'claude-bg';
  const rel = path.join('.orkastery', 'threads', threadId, 'prompts', `${t.slug}-${fase.toLowerCase()}-${sessoes}.md`);
  fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true });
  const prompt = `# Prompt SIMULADO da fase ${fase} (${sessoes})\n`;
  fs.writeFileSync(path.join(p.dir, rel), prompt);
  const sha = createHash('sha256').update(prompt).digest('hex');
  const despachadaEm = new Date().toISOString();
  const sessao = { slug: t.slug, fase, bloco, sessionId, runtime, verificada: o.verificada ?? true, despachadaEm, promptPath: rel,
    promptSha256: sha, origem: 'despacho' } as SessaoDaThread;
  t.sessoes = [...(t.sessoes ?? []), sessao];
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, threadId);
  registrar(dir, threadId, TIPOS_DE_EVENTO.faseDespachada, { fase, slug: t.slug, bloco, sessionId, runtime, promptSha256: sha,
    promptPath: rel, cwd: t.worktree, modo: t.modo, pausaAoFim: false });
  if (!o.semVerificacao) {
    registrar(dir, threadId, TIPOS_DE_EVENTO.despachoVerificado, { fase, slug: t.slug, sessionId, fonte: 'claude agents --json', encontrada: true });
  }
  return { sessionId, despachadaEm, fase };
}

/** O commit de produto da sessão pelo `ork_git_commit`: o `mcp_git_committed` com o vínculo da sessão. */
export function commitDaSessao(p: ProjetoDeTeste, threadId: string, sessao: SessaoSimulada, commit: string): void {
  registrar(dirThread(p.dir, threadId), threadId, 'mcp_git_committed', { commit, paths: [], origem: 'mcp.git', sessionId: sessao.sessionId,
    despachoEm: sessao.despachadaEm });
}

/** Um `verify_run` no commit; por padrão verde, com baseline, com um comando e todas as claims ativas verificadas. */
export function verifyNoLedger(p: ProjetoDeTeste, threadId: string, commit: string, o: { ok?: boolean; motivos?: string[];
  baseline?: boolean; comandos?: boolean; claims?: Array<{ id: string; verificado: boolean; motivo?: string | null }> } = {}): string {
  const ok = o.ok ?? true;
  const claims = o.claims ?? lerClaims(p.dir, threadId).filter(c => c.estado !== 'retirada')
    .map(c => ({ id: c.id, verificado: true, motivo: null }));
  const e = registrar(dirThread(p.dir, threadId), threadId, TIPOS_DE_EVENTO.verificacao, { commit, veredito: ok ? 'verdade sustentada' : 'reprovado',
    motivos: o.motivos ?? (ok ? [] : ['verify.regression']), claims,
    baseline: o.baseline === false ? null : { commit: 'baseline-simulada', gravadaEm: new Date().toISOString() },
    comandos: o.comandos === false ? [] : [{ nome: 'build', ok, code: ok ? 0 : 1 }] });
  return String(e.eventId);
}

/**
 * O CHECK da sessão: o parecer gravado depois do despacho, o verify no intervalo e o `phase_result` do observador, com a
 * prova do núcleo (`provaOrk`) e o sha do parecer que o observador do claude-bg grava. `semProvaGravada` é o resultado sem
 * esses campos (o do codex), e a prova volta a ser lida do disco.
 */
export function concluirRevisao(p: ProjetoDeTeste, threadId: string, s: SessaoSimulada, veredito: string, commit: string | null,
  o: { semResultado?: boolean; origem?: string; semProvaGravada?: boolean } = {}): void {
  passar(25);
  const docs = path.join(dirThread(p.dir, threadId), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const parecer = `# CHECK SIMULADO\n\nVeredito: ${veredito}\n`;
  fs.writeFileSync(path.join(docs, 'check.md'), parecer);
  const verify = commit ? verifyNoLedger(p, threadId, commit) : null;
  if (o.semResultado) return;
  const gravado = o.semProvaGravada ? {} : {
    provaOrk: { ok: true, fonte: `docs/check.md gravado com veredito ${veredito}`, veredito,
      verify: verify ? { eventId: verify, commit, ts: new Date().toISOString() } : null },
    artefato: { arquivo: 'docs/check.md', sha256Base: null, sha256Atual: createHash('sha256').update(parecer).digest('hex') },
  };
  registrar(dirThread(p.dir, threadId), threadId, 'phase_result', { fase: 'CHECK', sessionId: s.sessionId, despachoEm: s.despachadaEm,
    origem: o.origem ?? 'sessions.watch', sensorResultId: `claude-bg:${s.sessionId}`, classificacao: 'fase_concluida', ok: true,
    runtime: 'claude-bg', ...gravado });
}

export function claimDe(p: ProjetoDeTeste, threadId: string, arquivo: string, alegacao: string): string {
  return adicionarClaim(p.dir, threadId, { arquivo, alegacao, verificar: [`test -f '${arquivo}'`], semProvaLocal: true }).id;
}

/** O bundle de CI da thread, gravado na worktree e commitado como `ci(<thread>)`. */
export function commitarBundle(p: ProjetoDeTeste, t: Thread): string {
  const arquivo = prepararBundleCi(p.carregado, t.id);
  git(t.worktree!, 'add', '--', path.relative(t.worktree!, arquivo));
  git(t.worktree!, 'commit', '-q', '-m', `ci(${t.id}): bundle`);
  return head(t.worktree!);
}

export type EstadoDoCheck = 'success' | 'failure' | 'pending' | 'missing' | 'erro';

/** O check do CI falso: o estado de cada sha, e `missing` para o sha que ele não conhece. */
export function ciFalso(estados: Record<string, EstadoDoCheck>, chamadas: string[] = []): ExecutorCi {
  return ({ sha, context, caminho }) => {
    // A leitura do GitHub pela porta da forja pede também os commit statuses; este CI simulado só publica check-run.
    if (caminho?.includes('/statuses')) return { ok: true, stdout: '[]', stderr: '', code: 0 };
    chamadas.push(sha);
    const estado = estados[sha] ?? 'missing';
    if (estado === 'erro') return { ok: false, stdout: '', stderr: 'HTTP 502: gateway SIMULADO', code: 1 };
    // O produtor é o app do Actions: o `ci.produtor` padrão (`github-actions`) só aceita o verde dele.
    const checks = estado === 'missing' ? [] : [{ name: context, status: estado === 'pending' ? 'in_progress' : 'completed',
      conclusion: estado === 'pending' ? null : estado, html_url: `https://exemplo.invalid/check/${sha.slice(0, 7)}`,
      app: { slug: 'github-actions' } }];
    return { ok: true, stdout: JSON.stringify({ check_runs: checks }), stderr: '', code: 0 };
  };
}

export const ENTRADA_DA_THREAD = (nome: string) => `- **Entrega SIMULADA ${nome}** (RM-958): o que a thread acrescenta.`;

/**
 * Projeção mínima e explícita da rede para os ensaios do passo da entrega. Os casos que só precisam provar que a N5 não
 * faz efeito não dependem do transporte Git; a integração feliz continua usando o ramo de coordenação de verdade.
 */
export function redeDaEntrega(arco: string, maquina: string,
  trabalhos: RedeDoArco['trabalhos'], lacuna: RedeDoArco['lacuna'] = null): RedeDoArco {
  return {
    contrato: CONTRATO_REDE_DO_ARCO, arco, multimaquina: true, maquina, envelopeSha256: 'a'.repeat(64),
    lidaEm: '2026-10-13T03:00:00.000Z', autoridade: null, revogada: null, maquinas: [], trabalhos,
    consumo: { arco: 0, porConta: {}, porRuntime: {} }, obrigacoes: { ordens: [], vagas: [], vezes: [] }, lacuna,
  };
}

export interface EntregaPronta {
  t: Thread;
  autor: SessaoSimulada;
  revisor: SessaoSimulada;
  fonte: string;
  produto: string;
  mutante: string | null;
}

/**
 * A thread com tudo provado: a sessão do bloco (autora) commitou o código e a linha do CHANGELOG pelo `ork_git_commit`, a
 * claim comum e a de mutante estão cadastradas, o bundle foi commitado e uma sessão de CHECK nova, distinta e vinculada,
 * concluiu com PASSOU depois de verificar a fonte.
 */
export function entregaPronta(p: ProjetoDeTeste, nome: string,
  o: { semMutante?: boolean; arquivos?: Record<string, string> | ((t: Thread) => Record<string, string>); item?: string } = {}): EntregaPronta {
  const t = threadComWorktree(p, nome, o.item);
  const autor = sessaoDespachada(p, t.id, 'GOAL');
  const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8')
    .replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD(nome)}\n\n`);
  const padrao = { [`core/src/${nome}.ts`]: `export const ${nome.replace(/[^a-z]/g, '')} = 1;\n`, 'CHANGELOG.md': changelog };
  // A função acrescenta arquivos ao commit de produto padrão; o objeto o substitui.
  const arquivos = typeof o.arquivos === 'function' ? { ...padrao, ...o.arquivos(t) } : o.arquivos ?? padrao;
  const produto = commitarNaWorktree(t, arquivos, `feat(${t.id}): ${nome}`);
  commitDaSessao(p, t.id, autor, produto);
  claimDe(p, t.id, `core/src/${nome}.ts`, `o código de ${nome} existe`);
  const mutante = o.semMutante ? null : claimDe(p, t.id, `core/src/${nome}.ts`, `Mutante M1: trocar a guarda de ${nome} faz o teste cair`);
  const fonte = commitarBundle(p, t);
  const revisor = sessaoDespachada(p, t.id, 'CHECK');
  concluirRevisao(p, t.id, revisor, 'PASSOU', fonte);
  return { t: lerThread(p.dir, t.id), autor, revisor, fonte, produto, mutante };
}

/** O `gh` falso: `pr list` filtra pela branch e pelo estado; `pr create` abre o PR na ponta que o remoto tem. */
export function ghFalso(p: ProjetoDeTeste) {
  const prs: Array<{ number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; headRefName: string; headRefOid: string; baseRefName: string }> = [];
  const chamadas: string[][] = [];
  const opcao = (args: readonly string[], nome: string) => args.find(a => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
  const executor: ExecutorDoGh = (args) => {
    chamadas.push([...args]);
    if (args[0] === 'pr' && args[1] === 'list') {
      const h = opcao(args, 'head'), estado = opcao(args, 'state');
      const lista = prs.filter(x => (!h || x.headRefName === h) && (estado !== 'open' || x.state === 'OPEN')).map(x => ({
        number: x.number, state: x.state, headRefName: x.headRefName, headRefOid: x.headRefOid, baseRefName: x.baseRefName, isDraft: false,
        isCrossRepository: false, url: `https://github.com/${FORJA.repositorio}/pull/${x.number}`, createdAt: '2026-10-13T03:00:00Z',
        mergedAt: null, mergeable: 'MERGEABLE', statusCheckRollup: [] }));
      return { status: 0, stdout: JSON.stringify(lista), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      const h = opcao(args, 'head') ?? '', b = opcao(args, 'base') ?? '';
      const remota = git(p.dir, 'ls-remote', 'origin', `refs/heads/${h}`).stdout.split(/\s+/)[0] ?? '';
      prs.push({ number: 200 + prs.length + 1, state: 'OPEN', headRefName: h, headRefOid: remota, baseRefName: b });
      return { status: 0, stdout: `https://github.com/${FORJA.repositorio}/pull/${200 + prs.length}\n`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `gh falso: ${args.join(' ')}` };
  };
  return { prs, chamadas, executor, criacoes: () => chamadas.filter(c => c[0] === 'pr' && c[1] === 'create').length };
}

/**
 * O despacho falso do CHECK: o que o `phase run` deixa no disco quando abre a sessão (a condução da sessão, a entrada em
 * `thread.sessoes`, o `phase_dispatch` e a verificação). Guarda as sessões abertas para o teste concluí-las.
 */
export function despachoDoCheck(p: ProjetoDeTeste, abertas: SessaoSimulada[] = []) {
  return (_carregado: unknown, threadId: string, o: { fase: Fase; perfil?: string | null }) => {
    const s = sessaoDespachada(p, threadId, o.fase);
    registrarConducaoDaSessao(p.dir, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600_000 },
      { sessionId: s.sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
    abertas.push(s);
    return { sessionId: s.sessionId, verificada: true, bloqueado: false, motivo: null } as unknown as ResultadoRun;
  };
}

/** O verify falso do passo: um `verify_run` verde no HEAD da worktree da thread. */
export function verifyDoPasso(p: ProjetoDeTeste, chamadas: string[] = []) {
  return (_carregado: unknown, threadId: string) => {
    const t = lerThread(p.dir, threadId);
    const commit = head(t.worktree!);
    chamadas.push(commit);
    verifyNoLedger(p, threadId, commit);
    return { ok: true };
  };
}

/**
 * O fim do bloco inteiro numa sessão só (a autora): o parecer dela mesma com PASSOU, o verify no commit e o `phase_result`
 * da fase que ela começou. A fila da N2 põe a thread na entrega, e a revisão dela não vale (a autora não se revisa).
 */
export function concluirBloco(p: ProjetoDeTeste, threadId: string, s: SessaoSimulada, commit: string): void {
  passar(25);
  const docs = path.join(dirThread(p.dir, threadId), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'check.md'), '# CHECK SIMULADO da própria sessão\n\nVeredito: PASSOU\n');
  verifyNoLedger(p, threadId, commit);
  registrar(dirThread(p.dir, threadId), threadId, 'phase_result', { fase: s.fase, sessionId: s.sessionId, despachoEm: s.despachadaEm,
    origem: 'sessions.watch', sensorResultId: `claude-bg:${s.sessionId}`, classificacao: 'fase_concluida', ok: true, runtime: 'claude-bg' });
}

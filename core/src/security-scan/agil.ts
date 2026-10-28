/**
 * RM-072 (D9, D10 da ork-check5x): a varredura do Agile Check.
 *
 * A rodada e a mesma do Classic (`runScan`): a arvore do HEAD por worktree destacada, a base resolvida igual, as mesmas
 * ferramentas do catalogo e a mesma classificacao contra a base. O que muda e o empacotamento: a arvore da base sai uma
 * vez, antes, e cada ferramenta roda num trabalhador proprio (`trabalhador.ts`), ao mesmo tempo, chamando o mesmo
 * `scanTool` do Classic; o relatorio sai na ordem do catalogo. As ferramentas do Trivy montam um diretorio persistente
 * por ferramenta no `/tmp/trivy-cache` do catalogo, para o banco nao descer a cada rodada (cache de banco, nunca de
 * resultado: o HEAD e sempre varrido de novo, e a base usa o cache por SHA que o `scanBase` ja tem, com a chave da
 * especificacao do Agile). Cada peca do Agile que nao pode rodar cai para o equivalente do Classic e vai ao relatorio
 * (`check.pecas`) e ao `ORK_CHECK_RELATORIO` do verify.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { rodarEmParalelo } from '../check-paralelo';
import { ENV_RELATORIO_DO_CHECK, ENV_VARREDURA_PARALELA_DO_CHECK } from '../check-modo';
import { raizDoEstado } from '../estado-thread';
import { redigirCredenciaisUrl } from '../redacao-url';
import { classify } from './compare';
import { loadConfig, loadDismissals } from './config';
import { RoundGuard } from './guard';
import {
  cacheRoot, checkout, emptyCounts, failedAll, git, resolveBase, scanTool, stackPairs, unitsOf,
  type RunScanOptions, type ToolResult, type TrabalhoDaFerramenta,
} from './run';
import { defaultProbe, type Probe } from './executor';
import { eslintComImagem, garantirImagemDeLint } from './imagem-de-lint';
import { loadAgileTools, loadTools, toolsFor } from './tools';
import type { PecaDaVarredura, ScanReport, ToolSpec } from './types';

const TRABALHADOR = path.join(__dirname, 'trabalhador.js');
/** Sem prazo da rodada, o trabalhador ganha o maior prazo do catalogo para a HEAD e para a base, com folga. */
const FOLGA_MS = 60_000;

/**
 * O Semgrep baixa as regras do registro (`p/typescript`, ...) a cada rodada, e nao tem cache delas. Regra lida de arquivo
 * local ganha outro `check_id` (o prefixo do caminho), o que muda a impressao digital de todo achado: o cache de regras
 * fica de fora, declarado como peca em fallback.
 */
export const SEMGREP_SEM_CACHE: PecaDaVarredura = { peca: 'cache-semgrep', estado: 'fallback',
  motivo: 'regra lida de arquivo local troca o check_id e a impressao digital', fallback: 'regras do registro a cada rodada, como no Classic' };

/**
 * O prazo por regra e arquivo do Semgrep no Agile, em segundos. O padrao dele e 5 s; com as ferramentas juntas (e, no
 * verify, junto das lanes de teste) a disputa de CPU fazia uma regra estourar (`partial-timeout` medido na primeira
 * rodada real), e regra que estoura pode deixar de achar. O prazo maior nao troca regra nem arquivo varrido.
 */
export const PRAZO_POR_REGRA_DO_SEMGREP_S = 30;

/** O Semgrep do Agile com o prazo por regra maior, antes do diretorio da stack (o ultimo argumento). */
function semgrepDoAgile(t: ToolSpec, pecas: PecaDaVarredura[]): ToolSpec {
  if (!t.argsByStack) return t;
  const comPrazo = (args: string[]): string[] => args.length === 0 || args.includes('--timeout') ? args
    : [...args.slice(0, -1), '--timeout', String(PRAZO_POR_REGRA_DO_SEMGREP_S), args[args.length - 1]];
  pecas.push({ peca: 'semgrep-prazo-por-regra', estado: 'agile',
    motivo: `${PRAZO_POR_REGRA_DO_SEMGREP_S} s por regra e arquivo (o padrao do semgrep e 5 s), para a disputa de CPU nao derrubar regra` });
  return { ...t, argsByStack: Object.fromEntries(Object.entries(t.argsByStack).map(([stack, args]) => [stack, comPrazo(args ?? [])])) };
}

/**
 * A especificacao da ferramenta no Agile: as do Trivy montam o cache persistente dela no `/tmp/trivy-cache` que o
 * catalogo ja usa (sem o diretorio, a do catalogo, com a peca em fallback); o Semgrep ganha o prazo por regra maior.
 */
export function especificacaoDoAgile(t: ToolSpec, pecas: PecaDaVarredura[]): ToolSpec {
  if (t.name === 'semgrep') return semgrepDoAgile(t, pecas);
  if (!t.name.startsWith('trivy-') || !t.args.includes('/tmp/trivy-cache')) return t;
  const host = path.join(cacheRoot(), 'cache', t.name);
  try {
    fs.mkdirSync(host, { recursive: true, mode: 0o700 });
    pecas.push({ peca: `cache-${t.name}`, estado: 'agile' });
    return { ...t, cacheMounts: [{ host, container: '/tmp/trivy-cache' }] };
  } catch (e) {
    pecas.push({ peca: `cache-${t.name}`, estado: 'fallback', motivo: (e as NodeJS.ErrnoException).code ?? (e as Error).message,
      fallback: 'cache efemero do catalogo' });
    return t;
  }
}

function relatar(pecas: PecaDaVarredura[]): void {
  const arquivo = process.env[ENV_RELATORIO_DO_CHECK];
  if (!arquivo) return;
  try {
    fs.appendFileSync(arquivo, pecas.map((p) => JSON.stringify({ tipo: 'peca', ...p })).join('\n') + '\n');
  } catch { /* o relatorio e evidencia do verify, nao condicao da varredura */ }
}

/**
 * RM-072 (D11): o `eslint` com a imagem de lint pre-montada; sem ela (build que falhou, sem rede, catalogo mudou), o do
 * catalogo, com a peca em fallback.
 */
function eslintDoAgile(t: ToolSpec, prazoMs: number, pecas: PecaDaVarredura[]): ToolSpec {
  if (t.name !== 'eslint' || !t.install?.length) return t;
  // A4 do CHECK: o build roda antes dos trabalhadores; com teto curto, um link lento nao consome o prazo da varredura toda.
  const imagem = garantirImagemDeLint(t, prazoDoBuildDaImagem(prazoMs));
  const comImagem = 'tag' in imagem ? eslintComImagem(t, imagem.tag) : null;
  if (comImagem) { pecas.push({ peca: 'imagem-de-lint', estado: 'agile' }); return comImagem; }
  // RM-074 (F4): a ultima linha do `docker build` vem do registro do npm e pode trazer login na URL; vai ao ledger redigida.
  pecas.push({ peca: 'imagem-de-lint', estado: 'fallback',
    motivo: 'motivo' in imagem ? motivoSemCredencial(imagem.motivo, 200) : 'script do catalogo sem o npm install esperado',
    fallback: 'eslint do catalogo, com npm install no container' });
  return t;
}

/** O teto do build da imagem de lint (A4 do CHECK): estourou, o `eslint` do catalogo, com a peca em fallback. */
export const PRAZO_DO_BUILD_DA_IMAGEM_MS = 180_000;

/** O prazo do build da imagem de lint: o que resta da ferramenta, nunca acima do teto (RM-074 F4: o caso do teto). */
export function prazoDoBuildDaImagem(restanteMs: number): number {
  return Math.min(restanteMs, PRAZO_DO_BUILD_DA_IMAGEM_MS);
}

/** O prazo minimo que sobra para a ferramenta que caiu no Agile rodar pelo caminho do Classic (A5 do CHECK). */
export const PRAZO_MINIMO_DO_CLASSIC_MS = 30_000;

/** Os motivos tipados de estouro que o `scanTool` grava: o prazo da HEAD e o da base. */
const MOTIVOS_DE_ESTOURO: ReadonlySet<string> = new Set(['timeout', 'base-timeout']);

/**
 * N2 do CHECK 2: a ferramenta estourou o prazo, e o caminho do Classic estouraria igual. Decide pelo motivo tipado da
 * rodada ou pelo trabalhador cortado no prazo dele, nunca pelo texto do stderr: o erro de trava do cache do Trivy termina
 * em `timeout` ("cache may be in use by another process: timeout") e e justamente a peca do Agile que o Classic cobre.
 */
export function estourouNoAgile(motivo: string | undefined, trabalhador?: { duracaoMs: number; prazoMs: number }): boolean {
  if (trabalhador) return trabalhador.duracaoMs >= trabalhador.prazoMs;
  return MOTIVOS_DE_ESTOURO.has(motivo ?? '');
}

/**
 * A URL que vai ate o fim do texto, do esquema em diante e sem espaco. Cortada, o login dela pode ter ficado pela metade,
 * com `/`, `?`, `#` ou um segundo `@` que o redator so reconheceria inteiro; por isso ela sai toda, cortada ou nao. A URL
 * legitima no fim tambem sai: o motivo e diagnostico, e a troca e a favor de nao vazar login.
 */
const URL_NO_FIM = /[a-z][a-z0-9+.-]*:\/\/\S*$/i;

/**
 * S-k do CHECK 3 e N7 do CHECK 4: o texto que vai ao ledger sem credencial de URL. A URL que chega ate o fim sai inteira
 * antes da redacao (o texto pode ter vindo cortado, como o motivo do Classic, cortado em 200 sem redigir); o resto e
 * redigido antes do corte, e o que o corte deixar de URL no fim tambem sai. O resultado nunca passa do teto.
 */
export function motivoSemCredencial(texto: string, teto: number): string {
  const semUrlNoFim = (t: string): string => t.trimEnd().replace(URL_NO_FIM, '<url cortada>');
  return semUrlNoFim(redigirCredenciaisUrl(semUrlNoFim(texto)).slice(0, teto)).slice(0, teto);
}

/**
 * O resultado de um trabalhador da varredura e se ele estourou (N2 do CHECK 2, S-j do CHECK 3): o relatorio que ele
 * gravou ou, sem ele, a falha do proprio trabalhador, com a ultima linha do stderr (nunca a de um detector de segredo) e o
 * estouro pelo prazo dele.
 */
export function resultadoDoTrabalhador(t: ToolSpec, p: { stdout: string; stderr: string; code: number; duracaoMs: number },
  prazoMs: number): { r: ToolResult; estourou: boolean } {
  let lido: ToolResult | null = null;
  try { lido = JSON.parse(p.stdout) as ToolResult; } catch { lido = null; }
  if (lido && lido.run) return { r: lido, estourou: estourouNoAgile(lido.run.reason) };
  const motivo = motivoSemCredencial(p.stderr.split('\n').filter(l => l.trim()).pop() ?? '', 160);
  const r: ToolResult = { run: { name: t.name, category: t.category, version: t.version, executor: null, state: 'failed',
    reason: `agile-worker-${p.code}${motivo && t.category !== 'secret' ? `: ${motivo}` : ''}`, counts: emptyCounts() }, head: [], base: [] };
  return { r, estourou: estourouNoAgile(r.run.reason, { duracaoMs: p.duracaoMs, prazoMs }) };
}

/** RM-072 (D12): o binario nativo na versao do catalogo, quando a ferramenta o declara e nao instala pacote no container. */
function nativoDisponivel(t: ToolSpec, probe: Probe): boolean {
  if (!t.native || t.install) return false;
  const saida = probe.nativeVersion(t.native.bin, t.native.versionArgs);
  return saida !== null && new RegExp(t.native.versionPattern, 'm').test(saida);
}

/**
 * RM-072 (D13): o catalogo do Agile com as duas chaves: `osv_scanner` troca `trivy-vuln` e `npm-audit` pelo `osv-scanner`
 * (no lugar do `trivy-vuln`), e `oxlint` acrescenta o primeiro passe antes do `eslint`, sem tirar o `eslint`. Desligadas,
 * o catalogo do Classic.
 */
export function catalogoDoAgile(catalogo: ToolSpec[], agile: RunScanOptions['agile'], pecas: PecaDaVarredura[]): ToolSpec[] {
  if (!agile?.osv_scanner && !agile?.oxlint) return catalogo;
  const extras = loadAgileTools();
  const osv = extras.find(t => t.name === 'osv-scanner')!;
  const ox = extras.find(t => t.name === 'oxlint')!;
  const lista: ToolSpec[] = [];
  for (const t of catalogo) {
    if (agile.osv_scanner && t.name === 'trivy-vuln') { lista.push(osv); continue; }
    if (agile.osv_scanner && t.name === 'npm-audit') continue;
    if (agile.oxlint && t.name === 'eslint') lista.push(ox);
    lista.push(t);
  }
  if (agile.osv_scanner) pecas.push({ peca: 'osv-scanner', estado: 'agile', motivo: 'no lugar de trivy-vuln e npm-audit (check.agile.osv_scanner)' });
  if (agile.oxlint) pecas.push({ peca: 'oxlint', estado: 'agile', motivo: 'primeiro passe antes do eslint, sem tirar regra dele (check.agile.oxlint)' });
  return lista;
}

/**
 * A rodada do Agile: as mesmas regras do `runScan`, com as ferramentas em paralelo e os caches de banco. `rodar` e o
 * grupo paralelo; os testes o trocam para ler o prazo e o argv de cada trabalhador (RM-074 F4).
 */
export function runScanAgil(opts: RunScanOptions, rodar: typeof rodarEmParalelo = rodarEmParalelo): ScanReport {
  const start = path.resolve(opts.root);
  const root = git(start, ['rev-parse', '--show-toplevel']) ?? start;
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const head = git(root, ['rev-parse', 'HEAD']) ?? '';
  let mainRoot = root;
  try { mainRoot = raizDoEstado(root); } catch { /* not a linked worktree git understands: use the root itself */ }
  const pecas: PecaDaVarredura[] = [{ peca: 'varredura-paralela', estado: 'agile' }];
  const report: ScanReport = { schema: 'ork.security-scan/v1', base: '', head, generatedAt, stacks: [], tools: [], excluded: [], findings: [],
    check: { modo: 'agile', pecas } };
  const catalog = catalogoDoAgile(opts.tools ?? loadTools(), opts.agile, pecas);
  if (!head) {
    const config = loadConfig(root);
    const pairs = stackPairs(root, config);
    report.stacks = [...new Set(pairs.map(p => p.stack))];
    report.tools = failedAll(toolsFor(report.stacks, catalog).filter(t => unitsOf(t, pairs).length > 0), config, 'base-unresolved');
    relatar(pecas);
    return report;
  }
  const guard = new RoundGuard(mainRoot);
  try {
    let headTree: string;
    try { headTree = checkout(mainRoot, head, guard); } catch (e) {
      const config = loadConfig(root);
      const pairs = stackPairs(root, config);
      report.stacks = [...new Set(pairs.map(p => p.stack))];
      report.tools = failedAll(toolsFor(report.stacks, catalog).filter(t => unitsOf(t, pairs).length > 0), config,
        `head-${((e as Error).message.split('\n')[0] ?? '').slice(0, 200)}`);
      return report;
    }
    const config = loadConfig(headTree);
    const dismissals = loadDismissals(headTree);
    const pairs = stackPairs(headTree, config);
    report.stacks = [...new Set(pairs.map(p => p.stack))];
    const tools = toolsFor(report.stacks, catalog).filter(t => unitsOf(t, pairs).length > 0);
    const base = resolveBase(root, path.resolve(opts.stateRoot), opts.base);
    if (!base) { report.tools = failedAll(tools, config, 'base-unresolved'); return report; }
    report.base = base;
    if (tools.some(t => t.name === 'semgrep')) pecas.push(SEMGREP_SEM_CACHE);
    const count = git(root, ['rev-list', '--count', `${base}..${head}`]);
    const deadline = opts.deadlineMs === undefined ? null : Date.now() + opts.deadlineMs;
    // A arvore da base sai uma vez, aqui, e os trabalhadores a dividem (cada um varre a sua ferramenta nela).
    let baseTree: string | undefined = base === head ? headTree : undefined;
    if (!baseTree) {
      try { baseTree = checkout(mainRoot, base, guard); } catch { /* cada trabalhador tenta de novo e falha com base-worktree-failed */ }
    }
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-security-scan-agil-')));
    guard.add('outDirs', dir);
    // RM-072 (D12): quem tem o binario nativo na versao do catalogo roda sem o Docker; a peca diz quem faltou.
    const probe = opts.probe ?? defaultProbe();
    const comNativo = tools.filter(t => t.native && !t.install);
    const nativos = new Set(comNativo.filter(t => nativoDisponivel(t, probe)).map(t => t.name));
    if (comNativo.length > 0) {
      const faltam = comNativo.filter(t => !nativos.has(t.name)).map(t => t.name);
      pecas.push(nativos.size > 0
        ? { peca: 'binarios-nativos', estado: 'agile', motivo: `nativos: ${[...nativos].join(', ')}${faltam.length ? `; sem binario: ${faltam.join(', ')}` : ''}` }
        : { peca: 'binarios-nativos', estado: 'fallback', motivo: `sem binario nativo na versao do catalogo: ${faltam.join(', ')}`, fallback: 'Docker, como no Classic' });
    }
    const montados = tools.map((t, i) => {
      const restante = deadline === null ? t.timeoutMs : Math.min(t.timeoutMs, deadline - Date.now());
      const trabalho: TrabalhoDaFerramenta = { tool: eslintDoAgile(especificacaoDoAgile(t, pecas), restante, pecas), units: unitsOf(t, pairs), config,
        ...(nativos.has(t.name) ? { nativoPrimeiro: true } : {}),
        ctx: { headTree, mainRoot, base, head, rangeCommits: count === null ? null : Number(count), deadline, ...(baseTree ? { baseTree } : {}) } };
      const arquivo = path.join(dir, `${i}.json`);
      fs.writeFileSync(arquivo, JSON.stringify(trabalho), { mode: 0o600 });
      // RM-074 (F4): o trabalhador roda pelo argv, sem string de shell; o `comando` so identifica o item.
      const argv = [process.execPath, TRABALHADOR, arquivo];
      return { nome: t.name, comando: argv.join(' '), argv, cwd: root };
    });
    // S-f do CHECK 2: o teto dos trabalhadores e contado depois de todos montados, com o build da imagem de lint ja feito.
    const prazo = deadline === null ? Math.max(...tools.map(t => t.timeoutMs)) * 2 + FOLGA_MS : Math.max(1000, deadline - Date.now() + FOLGA_MS);
    const trabalhos = montados.map((m) => ({ ...m, prazoMs: prazo }));
    // RM-072: no grupo do verify, ao lado das lanes, a varredura roda poucas ferramentas por vez; sozinha, todas juntas.
    const teto = Number(process.env[ENV_VARREDURA_PARALELA_DO_CHECK]);
    const maxParalelo = Number.isInteger(teto) && teto > 0 ? teto : undefined;
    if (maxParalelo) pecas[0] = { ...pecas[0], motivo: `ate ${maxParalelo} ferramenta(s) ao mesmo tempo, ao lado das lanes do verify` };
    const processos = rodar(trabalhos, process.env, maxParalelo ? { maxParalelo } : {});
    const excluded = new Set<string>();
    tools.forEach((t, i) => {
      const trabalhador = resultadoDoTrabalhador(t, processos[i], trabalhos[i].prazoMs);
      let r = trabalhador.r;
      // A5 do CHECK: a ferramenta que caiu por uma peca do Agile (o trabalhador que morreu, o nativo que falhou, o cache do
      // Trivy disputado por outra rodada) roda uma vez pelo caminho do Classic, Docker primeiro e sem cache, dentro do prazo.
      // Estouro de prazo nao repete: o Classic estouraria igual.
      if (r.run.state === 'failed' && !trabalhador.estourou) {
        // S-c do CHECK 2 e S-k do CHECK 3: o motivo vem do stderr da ferramenta e vai ao ledger sem credencial de URL.
        const motivo = motivoSemCredencial(`no Agile: ${r.run.reason ?? 'falhou'}`, 200);
        if (deadline === null || deadline - Date.now() >= PRAZO_MINIMO_DO_CLASSIC_MS) {
          r = scanTool(t, unitsOf(t, pairs), config, { headTree, mainRoot, base, head, rangeCommits: count === null ? null : Number(count),
            deadline: deadline ?? Infinity, probe, guard, images: new Map(), ...(baseTree ? { baseTree } : {}) });
          pecas.push({ peca: `classic-${t.name}`, estado: 'fallback', motivo, fallback: 'a ferramenta pelo caminho do Classic' });
        } else {
          pecas.push({ peca: `classic-${t.name}`, estado: 'fallback', motivo, fallback: 'nenhum: sem prazo para o caminho do Classic' });
        }
      }
      if (r.run.state === 'ran') {
        const c = classify(r.head, r.base, dismissals, config.exclude);
        for (const f of c.findings) r.run.counts[f.status][f.severity]++;
        report.findings.push(...c.findings);
        c.excluded.forEach(e => excluded.add(e));
      }
      report.tools.push(r.run);
    });
    report.excluded = [...excluded].sort();
    return report;
  } finally {
    guard.close();
    relatar(pecas);
  }
}

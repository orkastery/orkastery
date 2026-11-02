/** RM-081 F5: decisão conservadora da seleção nativa por mudanças no Agile. */
import * as path from 'node:path';
import { caminhoBateComGlob } from './leases';
import { NOME_MANIFESTO, NOME_MANIFESTO_LEGADO } from './manifest';
import { ModoDoCheck } from './check-modo';
import { EventoLedger, Manifesto, SelecaoNativa } from './types';
import { exec } from './util';

export const CONTRATO_DA_SELECAO = 'ork.check.selecao/v1' as const;

export type MotivoDaSelecao = 'rodada-fria' | 'cache-ausente' | 'cache-invalido' | 'base-mudou'
  | 'manifesto-mudou' | 'lockfile-mudou' | 'configuracao-mudou' | 'fora-do-mapeamento'
  | 'runner-sem-garantia' | 'sem-mudancas' | 'selecionada';

export interface RegistroDaSelecao {
  modo: 'selecionada' | 'inteira';
  motivo: MotivoDaSelecao;
  /** Caminhos que explicam a decisão; sempre relativos à worktree. */
  arquivos?: string[];
  /** Commit da rodada anterior usado pelo runner. */
  base?: string;
}

export interface PlanoDaLane extends RegistroDaSelecao {
  /** Presente somente quando o runner pode executar a seleção. */
  comando?: string;
}

export interface CacheDaSelecao {
  contrato: typeof CONTRATO_DA_SELECAO;
  base: string;
  head: string;
}

export interface PlanoDaSelecao {
  lanes: Record<string, PlanoDaLane>;
  /** Só uma árvore limpa e uma base resolvida podem alimentar a próxima rodada. */
  cache: CacheDaSelecao | null;
}

const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock',
  'Pipfile.lock', 'go.mod', 'go.sum']);

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function sha(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{40,64}$/i.test(v);
}

/** Um argumento shell fechado, como o filtro nominal da F3. */
function argumento(valor: string): string {
  return `'${valor.replace(/'/g, `'"'"'`)}'`;
}

export function comandoDaSelecao(declaracao: SelecaoNativa, base: string, arquivos: readonly string[]): string {
  return declaracao.comando.includes('{base}')
    ? declaracao.comando.replace('{base}', argumento(base))
    : declaracao.comando.replace('{arquivos}', arquivos.map(argumento).join(' '));
}

function baseAtual(cwd: string, manifesto: Manifesto, commit: string): string | null {
  const r = exec('git', ['merge-base', commit, manifesto.worktree.base_branch], cwd);
  const base = r.stdout.trim();
  return r.ok && sha(base) ? base : null;
}

function arvoreLimpa(cwd: string): boolean {
  const r = exec('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude).orkastery'], cwd);
  return r.ok && r.stdout === '';
}

function arquivosMudados(cwd: string, anterior: string, atual: string): string[] | null {
  const r = exec('git', ['diff', '--name-only', '--no-renames', '-z', anterior, atual, '--', '.', ':(exclude).orkastery'], cwd);
  if (!r.ok) return null;
  return [...new Set(r.stdout.split('\0').filter(Boolean).map((arquivo) => arquivo.split(path.sep).join('/')))].sort();
}

function lockfile(arquivo: string): boolean {
  const nome = path.posix.basename(arquivo);
  return LOCKFILES.has(nome) || /^requirements(?:\.[^.]+)?\.txt$/.test(nome);
}

function inteira(motivo: Exclude<MotivoDaSelecao, 'selecionada'>, arquivos?: string[]): PlanoDaLane {
  return { modo: 'inteira', motivo, ...(arquivos?.length ? { arquivos } : {}) };
}

function todasInteiras(declaracoes: Record<string, SelecaoNativa>, motivo: Exclude<MotivoDaSelecao, 'selecionada'>,
  arquivos?: string[]): Record<string, PlanoDaLane> {
  return Object.fromEntries(Object.keys(declaracoes).map((lane) => [lane, inteira(motivo, arquivos)]));
}

/**
 * Decide uma vez, antes dos comandos. O último `verify_run` é o cache: qualquer forma desconhecida,
 * veredito vermelho, base diferente ou árvore suja devolve a suíte inteira.
 */
export function planejarSelecaoNativa(cwd: string, manifesto: Manifesto, eventos: readonly EventoLedger[], commit: string,
  modo: ModoDoCheck): PlanoDaSelecao {
  const declaracoes = manifesto.check?.agile?.selecao ?? {};
  if (modo !== 'agile' || Object.keys(declaracoes).length === 0) return { lanes: {}, cache: null };

  const base = baseAtual(cwd, manifesto, commit);
  const limpa = arvoreLimpa(cwd);
  const cache: CacheDaSelecao | null = base && limpa ? { contrato: CONTRATO_DA_SELECAO, base, head: commit } : null;
  const ultima = [...eventos].reverse().find((evento) => evento.tipo === 'verify_run');
  if (!ultima) return { lanes: todasInteiras(declaracoes, 'rodada-fria'), cache };
  const anterior = objeto(ultima.selecao);
  if (!anterior) return { lanes: todasInteiras(declaracoes, 'cache-ausente'), cache };
  if (!base || !limpa || ultima.veredito !== 'verdade sustentada' || anterior.contrato !== CONTRATO_DA_SELECAO
      || !sha(anterior.base) || !sha(anterior.head) || anterior.head !== ultima.commit) {
    return { lanes: todasInteiras(declaracoes, 'cache-invalido'), cache };
  }
  if (anterior.base !== base) return { lanes: todasInteiras(declaracoes, 'base-mudou'), cache };
  if (!exec('git', ['merge-base', '--is-ancestor', anterior.head, commit], cwd).ok) {
    return { lanes: todasInteiras(declaracoes, 'cache-invalido'), cache };
  }
  const mudados = arquivosMudados(cwd, anterior.head, commit);
  if (!mudados) return { lanes: todasInteiras(declaracoes, 'cache-invalido'), cache };
  const manifestos = new Set([NOME_MANIFESTO, NOME_MANIFESTO_LEGADO]);
  const mudancaNoManifesto = mudados.filter((arquivo) => manifestos.has(path.posix.basename(arquivo)));
  if (mudancaNoManifesto.length) return { lanes: todasInteiras(declaracoes, 'manifesto-mudou', mudancaNoManifesto), cache };
  const lockfiles = mudados.filter(lockfile);
  if (lockfiles.length) return { lanes: todasInteiras(declaracoes, 'lockfile-mudou', lockfiles), cache };

  const lanes: Record<string, PlanoDaLane> = {};
  for (const [lane, declaracao] of Object.entries(declaracoes)) {
    if (!declaracao.mapeia.length) { lanes[lane] = inteira('runner-sem-garantia'); continue; }
    const configuracao = mudados.filter((arquivo) => (declaracao.configuracao ?? [])
      .some((glob) => caminhoBateComGlob(arquivo, glob)));
    if (configuracao.length) { lanes[lane] = inteira('configuracao-mudou', configuracao); continue; }
    const fora = mudados.filter((arquivo) => !declaracao.mapeia.some((glob) => caminhoBateComGlob(arquivo, glob)));
    if (fora.length) { lanes[lane] = inteira('fora-do-mapeamento', fora); continue; }
    if (!mudados.length) { lanes[lane] = inteira('sem-mudancas'); continue; }
    lanes[lane] = { modo: 'selecionada', motivo: 'selecionada', arquivos: mudados,
      base: anterior.head, comando: comandoDaSelecao(declaracao, anterior.head, mudados) };
  }
  return { lanes, cache };
}

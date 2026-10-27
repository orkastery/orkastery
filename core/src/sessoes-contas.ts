/**
 * RM-056 (D4, D5): as sessoes desta maquina em TODAS as contas que o `ork` conhece.
 *
 * O `claude agents` e o `~/.codex/sessions` so respondem pela conta do ambiente de quem consulta:
 * com perfis (`ork accounts`), uma sessao despachada pelo perfil X so aparece consultando com o
 * `CLAUDE_CONFIG_DIR`/`CODEX_HOME` de X. Aqui a consulta passa pela conta do processo e por cada
 * perfil do store, sem repetir diretorio, e cada sessao volta com o id do perfil dela (nunca o
 * diretorio nem nada de dentro dele).
 *
 * RM-067 (F4): o `grok` entra com a pasta `sessions/` que o proprio runtime grava em cada casa (`GROK_HOME`), lida so
 * pelos nomes e pelo mtime do `updates.jsonl`. A conta do processo dele so entra quando essa pasta existe: maquina sem o
 * `grok` nao ganha fonte nova.
 *
 * Fantasma (D5): sessao claude-bg com estado nao terminal sem pid, ou com pid sem processo. O
 * `claude agents` guarda o registro, mas nao ha quem trabalhe: ela nao ocupa vaga, e
 * `ork sessions limpar-fantasmas` solta o vinculo do `ork` sem tocar no runtime.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ambienteDoPerfil, consultarSessoes } from './adapters/claude-bg';
import { consultarRollouts } from './adapters/codex';
import { consultarSessoesGrok } from './adapters/grok';
import {
  diretorioDoPerfil, diretorioImplicito, lerPerfis, perfilDeDespacho, PerfilDeDespacho, RUNTIMES_COM_INVENTARIO, RuntimeComPerfil,
} from './runtime-profiles';
import { SessaoRuntime } from './types';

/** Uma conta consultada: a do processo (`perfil: null`) ou a de um perfil do store. */
export interface ContaDeSessoes { runtime: RuntimeComPerfil; perfil: PerfilDeDespacho | null; dir: string }

/**
 * Uma fonte consultada. `ausente`: o runtime nem existe nesta máquina (fatia 2 do ensaio da 0.5.0,
 * P1); a fonte vale, sem sessões, e `correcao` diz o que fazer para tê-la.
 */
export interface FonteDeSessoes { origem: string; ok: boolean; detalhe: string; ausente?: boolean; correcao?: string }

export interface SessaoDaConta extends SessaoRuntime {
  runtime: RuntimeComPerfil;
  /** Id do perfil que enxerga a sessao; `null` e a conta do processo. */
  perfil: string | null;
  /** D5: registro sem processo que trabalhe por ele. */
  fantasma: boolean;
  /** D3: trabalha agora nesta maquina (claude-bg com processo; codex com atividade recente). */
  viva: boolean;
}

const TERMINAIS = ['done', 'completed', 'exited', 'stopped', 'failed'];

const estadoDe = (s: SessaoRuntime): string => String(s.state ?? s.status ?? '').trim().toLowerCase();

/** O processo existe? `EPERM` e processo de outro usuario: existe. */
export function pidVivo(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** D5: fantasma e so claude-bg (o codex nao expoe pid na fonte), em estado nao terminal. */
export function ehFantasma(runtime: RuntimeComPerfil, s: SessaoRuntime, vivo: (pid: unknown) => boolean = pidVivo): boolean {
  return runtime === 'claude-bg' && !TERMINAIS.includes(estadoDe(s)) && !vivo(s.pid);
}

/**
 * RM-037 (ork-rm037esperas, D7): o runtime mostra a sessao encerrada: estado terminal (`done`, `completed`, `exited`,
 * `stopped`, `failed`) ou fantasma, registro sem processo que trabalhe por ele. Domicilio unico dessa leitura: o portao
 * de vaga do `ork phase run` (`vagaDoDespacho`) e a capacidade do #Noctum a usam.
 */
export function encerradaNaLista(s: SessaoDaConta): boolean {
  return s.fantasma || TERMINAIS.includes(estadoDe(s));
}

const real = (dir: string): string => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };

/**
 * D4: as contas a consultar. Os perfis do store vem primeiro (inclusive desativado, que ainda pode
 * ter sessao viva), para a sessao levar o id do perfil quando a conta do processo e a mesma pasta.
 */
export function contasDeSessoes(raiz: string | null, env: NodeJS.ProcessEnv = process.env):
  { contas: ContaDeSessoes[]; fontes: FonteDeSessoes[] } {
  const contas: ContaDeSessoes[] = [], fontes: FonteDeSessoes[] = [];
  const vistos = new Set<string>();
  const incluir = (runtime: RuntimeComPerfil, perfil: PerfilDeDespacho | null, dir: string) => {
    const chave = `${runtime}:${real(dir)}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    contas.push({ runtime, perfil, dir });
  };
  if (raiz) {
    try {
      for (const p of lerPerfis(raiz).perfis) {
        const d = perfilDeDespacho(p);
        if (RUNTIMES_DAS_SESSOES.includes(d.runtime)) incluir(d.runtime, d, diretorioDoPerfil(d));
      }
    } catch (e) { fontes.push({ origem: 'perfis de conta (ork accounts)', ok: false, detalhe: (e as Error).message }); }
  }
  for (const runtime of RUNTIMES_COM_INVENTARIO) incluir(runtime, null, diretorioImplicito(runtime, env));
  const casaGrok = diretorioImplicito('grok', env);
  if (fs.existsSync(path.join(casaGrok, 'sessions'))) incluir('grok', null, casaGrok);
  return { contas, fontes };
}

/**
 * RM-067 (F4): os runtimes cujas sessoes o `ork sessions` lista por conta. O grok entra aqui, e nao em
 * `RUNTIMES_COM_INVENTARIO`, que tambem diz os runtimes de assinatura do #Noctum (a medicao dele segue sem o grok).
 */
export const RUNTIMES_DAS_SESSOES: readonly RuntimeComPerfil[] = [...RUNTIMES_COM_INVENTARIO, 'grok'];

const rotulo = (c: ContaDeSessoes): string => c.perfil ? `perfil ${c.perfil.id}` : 'conta do processo';

/**
 * D4: as sessoes de todas as contas. Consulta que falha vira fonte `ok: false`, nunca "zero
 * sessoes". `staleMin` e a janela de atividade que torna viva uma sessao codex (D3).
 */
export function consultarContas(raiz: string | null, opcoes: { todas?: boolean; agoraMs?: number; staleMin?: number;
  /** RM-063 (F2): prazo do `claude agents` por conta; o padrao e o de sempre (60 s). */
  prazoMs?: number;
  contas?: ContaDeSessoes[] } = {}): { sessoes: SessaoDaConta[]; fontes: FonteDeSessoes[]; contas: ContaDeSessoes[] } {
  const base = opcoes.contas ? { contas: opcoes.contas, fontes: [] as FonteDeSessoes[] } : contasDeSessoes(raiz);
  const fontes = [...base.fontes];
  const sessoes: SessaoDaConta[] = [];
  const agoraMs = opcoes.agoraMs ?? Date.now();
  const janelaMs = (opcoes.staleMin ?? 30) * 60_000;
  for (const conta of base.contas) {
    const perfil = conta.perfil?.id ?? null;
    if (conta.runtime === 'claude-bg') {
      let ambiente: NodeJS.ProcessEnv;
      try { ambiente = ambienteDoPerfil(conta.perfil); }
      catch (e) { fontes.push({ origem: `claude agents (${rotulo(conta)})`, ok: false, detalhe: (e as Error).message }); continue; }
      const r = consultarSessoes(undefined, opcoes.todas, ambiente, opcoes.prazoMs);
      const origem = `claude agents --json${opcoes.todas ? ' --all' : ''} (${rotulo(conta)})`;
      // Fatia 2 do ensaio da 0.5.0 (P1): só o ENOENT antes da consulta prova a fonte ausente; qualquer
      // outra falha do `claude` continua deixando o inventário incompleto.
      fontes.push(r.ausente
        ? { origem, ok: true, ausente: true, detalhe: `${r.detalhe}: nenhuma sessão claude-bg a listar`,
          correcao: 'para despachar e listar pelo claude-bg, instale o Claude Code e garanta `claude` no PATH' }
        : { origem, ok: r.ok, detalhe: r.detalhe });
      for (const s of r.sessoes) {
        const fantasma = ehFantasma('claude-bg', s);
        sessoes.push({ ...s, runtime: 'claude-bg', perfil, fantasma, viva: !fantasma && !TERMINAIS.includes(estadoDe(s)) });
      }
    } else if (conta.runtime === 'codex') {
      const r = consultarRollouts(opcoes.todas, conta.dir);
      // A conta do processo segue com o caminho de antes; a do perfil vai pelo id, nunca pela pasta.
      fontes.push(...(conta.perfil ? r.resultadosFontes.map(f => ({ ...f,
        origem: `codex (${rotulo(conta)}): ${path.relative(conta.dir, f.origem)}` })) : r.resultadosFontes));
      for (const s of r.sessoes) {
        const recente = typeof s.atividadeEm === 'number' && agoraMs - s.atividadeEm <= janelaMs;
        sessoes.push({ ...s, runtime: 'codex', perfil, fantasma: false, viva: estadoDe(s) !== 'completed' && recente });
      }
    } else if (conta.runtime === 'grok') {
      // RM-067 (F4): a pasta da sessao que o runtime grava; viva e a escrita recente no updates.jsonl, como no codex.
      const r = consultarSessoesGrok(conta.dir);
      const origem = `grok sessions (${rotulo(conta)})`;
      fontes.push(r.ausente ? { origem, ok: true, ausente: true, detalhe: 'nenhuma sessao grok nesta conta ainda' }
        : { origem, ok: r.ok, detalhe: r.detalhe });
      for (const s of r.sessoes) {
        const recente = typeof s.atividadeEm === 'number' && agoraMs - s.atividadeEm <= janelaMs;
        sessoes.push({ ...s, runtime: 'grok', perfil, fantasma: false, viva: recente });
      }
    }
  }
  return { sessoes, fontes, contas: base.contas };
}

/**
 * D7: o mapa sessionId -> estado que o escalonador e o monitor usam, agora de todas as contas.
 * Fantasma vira `fantasma` (nem `working` nem `blocked`: nao ocupa vaga nem pede o dono); codex
 * vivo vira `working`. `null` ("runtime nao consultado") quando nenhuma conta claude-bg respondeu e
 * nenhuma sessao codex apareceu: um mapa vazio ali diria "nada rodando" sem ter olhado.
 */
export function estadosNasContas(raiz: string | null, opcoes: { staleMin?: number; agoraMs?: number } = {}): Map<string, string> | null {
  const r = consultarContas(raiz, opcoes);
  const claude = r.fontes.filter(f => f.origem.startsWith('claude agents'));
  if (claude.length > 0 && !claude.some(f => f.ok) && !r.sessoes.some(s => s.runtime === 'codex' || s.runtime === 'grok')) return null;
  // RM-067 (F4): a sessao grok sem escrita recente fica `idle`; o runtime nao grava estado terminal que o ork leia sem o conteudo.
  return new Map(r.sessoes.map(s => [s.sessionId,
    s.fantasma ? 'fantasma' : s.runtime === 'codex' ? (s.viva ? 'working' : estadoDe(s))
      : s.runtime === 'grok' ? (s.viva ? 'working' : 'idle') : estadoDe(s)] as const));
}

/**
 * RM-056 (D3): sessoes vivas de cada perfil do runtime nesta maquina, a carga do rodizio por
 * carga. So as contas dos perfis sao consultadas (a do processo nao recebe despacho com perfis).
 */
export function sessoesVivasPorPerfil(raiz: string, runtime: RuntimeComPerfil, staleMin?: number,
  agoraMs?: number): Map<string, number> {
  const contas = contasDeSessoes(raiz).contas.filter(c => c.runtime === runtime && c.perfil);
  const carga = new Map<string, number>(contas.map(c => [c.perfil!.id, 0]));
  for (const s of consultarContas(raiz, { contas, staleMin, agoraMs }).sessoes) {
    if (s.viva && s.perfil) carga.set(s.perfil, (carga.get(s.perfil) ?? 0) + 1);
  }
  return carga;
}

/**
 * `ork worktree ensure|sync|audit|release`: a worktree como RECURSO GERENCIADO (bloco B2).
 *
 * No Devmaster a worktree era criada na mao e conferida de memoria. Aqui ela tem ciclo de
 * vida: o `ork` garante que existe, sincroniza quando a base andou, audita a consistencia
 * no proprio git (nunca por self-report) e devolve o recurso ao fim.
 *
 * Duas regras nao negociaveis:
 *   1. a BASE e resolvida pelo `ork` (manifesto), nunca escolhida pelo executor;
 *   2. os artefatos da thread (prompts, ledger, claims, handoffs) ficam em
 *      `.orkastery/threads/<id>/`, FORA da arvore, entao remover a worktree nunca
 *      leva junto a evidencia da conducao.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from './ledger';
import { leasesDaThread, liberar, nomeDeLease } from './leases';
import { ManifestoCarregado } from './manifest';
import { criarWorktree, dirThread, gravarThread, lerThread, pastaDaWorktree } from './thread';
import { Check, MotivoGate, Thread } from './types';
import { exec, simbolo } from './util';
import { auditarEstado, vincularEstado, comEstadoParaGit } from './estado-thread';
import { exigirCwdLocal } from './procedencia';

/**
 * Diretorio canonico da worktree de uma thread, resolvido pelo `ork` na arvore principal: o mesmo que a criacao usa,
 * tambem quando o comando roda de dentro de outra worktree (P4 do ensaio da 0.5.0).
 */
export function dirDaWorktree(carregado: ManifestoCarregado, id: string): string {
  return pastaDaWorktree(carregado, id);
}

/** Branch canonica da worktree de uma thread. */
export function branchDaWorktree(thread: Thread): string {
  return thread.base.branch.startsWith('ork/') ? thread.base.branch : `ork/${thread.slug}`;
}

/** As worktrees que o git realmente conhece (`git worktree list --porcelain`). */
export function worktreesDoGit(raiz: string): { dir: string; branch: string; head: string }[] {
  const r = exec('git', ['worktree', 'list', '--porcelain'], raiz);
  if (!r.ok) return [];
  const saida: { dir: string; branch: string; head: string }[] = [];
  let atual: { dir: string; branch: string; head: string } | null = null;
  for (const linha of r.stdout.split('\n')) {
    if (linha.startsWith('worktree ')) {
      if (atual) saida.push(atual);
      atual = { dir: linha.slice('worktree '.length).trim(), branch: '', head: '' };
    } else if (atual && linha.startsWith('HEAD ')) {
      atual.head = linha.slice('HEAD '.length).trim();
    } else if (atual && linha.startsWith('branch ')) {
      atual.branch = linha.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    }
  }
  if (atual) saida.push(atual);
  return saida;
}

/** A worktree deste diretorio esta registrada no git? */
export function registradaNoGit(raiz: string, dir: string): boolean {
  return worktreesDoGit(raiz).some((w) => w.dir === dir);
}

/** A arvore da worktree esta limpa? `null` quando o diretorio nem e uma arvore git. */
export function arvoreLimpa(dir: string): boolean | null {
  const r = exec('git', ['status', '--porcelain'], dir);
  if (!r.ok) return null;
  return r.stdout.trim() === '';
}

// ---------------------------------------------------------------------------
// ensure
// ---------------------------------------------------------------------------

export interface ResultadoEnsure {
  ok: boolean;
  criada: boolean;
  dir: string;
  branch: string;
  base: string;
  motivo: MotivoGate | null;
  detalhe: string;
  correcao: string;
}

/**
 * Garante a worktree da thread: cria se faltar, confere se ja existe.
 *
 * Nunca conserta sozinho uma worktree divergente: divergencia e assunto do `audit` e do
 * `sync`, que dizem o que houve em vez de esconder.
 */
export function garantirWorktree(carregado: ManifestoCarregado, id: string): ResultadoEnsure {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, id);
  const dir = thread.worktree ?? dirDaWorktree(carregado, id);
  const branch = branchDaWorktree(thread);
  const base = manifesto.worktree.base_branch;

  if (fs.existsSync(dir)) {
    if (!registradaNoGit(raiz, dir)) {
      return {
        ok: false,
        criada: false,
        dir,
        branch,
        base,
        motivo: 'tree.blocked',
        detalhe: `${dir} existe mas nao aparece em \`git worktree list\``,
        correcao: `remova o diretorio ou registre a worktree; depois rode: ork worktree ensure ${id}`,
      };
    }
    try { vincularEstado(raiz, id, dir); } catch (e) {
      return { ok: false, criada: false, dir, branch, base, motivo: 'tree.blocked',
        detalhe: (e as Error).message, correcao: `reconcilie o estado e rode ork worktree sync ${id}` };
    }
    if (thread.worktree !== dir) {
      thread.worktree = dir;
      gravarThread(raiz, thread);
    }
    registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeGarantida, {
      dir,
      branch,
      base,
      criada: false,
      fonte: 'git worktree list --porcelain',
    });
    return {
      ok: true,
      criada: false,
      dir,
      branch,
      base,
      motivo: null,
      detalhe: 'a worktree da thread ja existe e o git a reconhece',
      correcao: '',
    };
  }

  // Branch da thread ja existe (worktree removida antes)? Entao reusa a branch.
  const jaTemBranch = exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`], raiz).ok;
  const criada = criarWorktree(carregado, id, thread.slug, {
    branchExistente: jaTemBranch ? branch : undefined,
  });
  thread.worktree = criada.dir;
  thread.base = { branch: criada.branch, commit: thread.base.commit };
  gravarThread(raiz, thread);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeGarantida, {
    dir: criada.dir,
    branch: criada.branch,
    base,
    criada: true,
    branchReusada: jaTemBranch,
    fonte: 'git worktree list --porcelain',
  });
  return {
    ok: true,
    criada: true,
    dir: criada.dir,
    branch: criada.branch,
    base,
    motivo: null,
    detalhe: jaTemBranch
      ? `worktree recriada sobre a branch ${criada.branch}, que ja existia`
      : `worktree criada a partir de ${base}`,
    correcao: '',
  };
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

export interface ResultadoSync {
  ok: boolean;
  jaAtualizada: boolean;
  rebaseFeito: boolean;
  /** RM-037 (defeitosdeco D-5): branch sem commit proprio recriada no SHA da base, sem rebase. */
  recriada?: boolean;
  /** RM-037 (fatia 3, defeito 3): a recusa e de base reescrita, com ou sem ancestral comum. */
  causa?: 'base-reescrita';
  dir: string;
  branch: string;
  base: string;
  shaBase: string;
  shaAntes: string;
  shaDepois: string;
  motivo: MotivoGate | null;
  detalhe: string;
  correcao: string;
  passos: string[];
  dryRun: boolean;
}

/**
 * RM-037 (defeitosdeco D-5): o que a branch tem de proprio. Bases conhecidas da thread sao o
 * `base.commit` carimbado na criacao e cada `shaBase` que um sync ja incorporou (lidos do ledger);
 * commit que o git nao tem mais nao entra. `proprios` conta o que o HEAD tem fora delas e da base
 * atual (`null` sem nenhuma base conhecida); `pontoDePartida` e a base conhecida mais nova que e
 * ancestral do HEAD; `semAncestral` diz que HEAD e base atual nao tem historia em comum.
 *
 * RM-037 (fatia 3, defeito 3): `baseReescrita` diz que o ponto de partida nao esta mais na base atual.
 * A base so anda para a frente; quando o ponto em que a thread saiu dela deixa de ser ancestral, a base
 * foi reescrita, mesmo com ancestral comum mais antigo (force-push que tirou commits). Nesse caso o
 * `git rebase <base>` reaplicaria, junto com os commits da thread, os `sairamDaBase` que a reescrita tirou.
 */
export function historiaPropria(raiz: string, thread: Thread, dir: string, shaBase: string):
    { proprios: number | null; pontoDePartida: string | null; semAncestral: boolean; baseReescrita: boolean;
      sairamDaBase: number | null } {
  const git = (...args: string[]) => exec('git', args, dir);
  const sincronizadas = lerLedger(dirThread(raiz, thread.id))
    .filter(e => e.tipo === TIPOS_DE_EVENTO.worktreeSincronizada && typeof e.shaBase === 'string' && e.shaBase !== '')
    .map(e => String(e.shaBase));
  // GO-FIX (R1): no ciclo `merge-branch`, `base.commit` e a ponta da branch que ja existia, com os
  // commits proprios dela. Nao e base: vale so o ponto onde ela sai da base atual, quando existe.
  const inicio = thread.base?.commit;
  const valido = (sha: unknown): sha is string => typeof sha === 'string' && /^[a-f0-9]{40,64}$/.test(sha) &&
    git('cat-file', '-e', `${sha}^{commit}`).ok;
  const pontoDaCriacao = thread.variante !== 'merge-branch' ? inicio
    : valido(inicio) ? (git('merge-base', inicio, shaBase).stdout.trim() || null) : null;
  const conhecidas = [...new Set([pontoDaCriacao, ...sincronizadas])].filter(valido);
  const semAncestral = git('merge-base', 'HEAD', shaBase).code === 1;
  const pontoDePartida = [...conhecidas].reverse().find(sha => git('merge-base', '--is-ancestor', sha, 'HEAD').ok) ?? null;
  const baseReescrita = pontoDePartida !== null && !git('merge-base', '--is-ancestor', pontoDePartida, shaBase).ok;
  const numero = (r: ReturnType<typeof git>) => r.ok && /^\d+$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null;
  const sairamDaBase = baseReescrita ? numero(git('rev-list', '--count', pontoDePartida!, '--not', shaBase)) : null;
  if (!conhecidas.length) return { proprios: null, pontoDePartida, semAncestral, baseReescrita, sairamDaBase };
  const proprios = numero(git('rev-list', '--count', 'HEAD', '--not', ...conhecidas, shaBase));
  return { proprios, pontoDePartida, semAncestral, baseReescrita, sairamDaBase };
}

/**
 * Sincroniza a branch da thread com a base ATUAL (rebase), quando a base avancou.
 *
 * A pergunta "a base avancou?" e respondida pelo git (`merge-base --is-ancestor`), nao
 * pela data de criacao da thread: e o mesmo criterio que o `audit` usa.
 */
export function sincronizarWorktree(
  carregado: ManifestoCarregado,
  id: string,
  opcoes: { dryRun?: boolean } = {}
): ResultadoSync {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, id);
  const base = manifesto.worktree.base_branch;
  const dir = thread.worktree ?? dirDaWorktree(carregado, id);
  const branch = branchDaWorktree(thread);
  const passos: string[] = [];
  const vazio = {
    dir,
    branch,
    base,
    shaBase: '',
    shaAntes: '',
    shaDepois: '',
    passos,
    dryRun: opcoes.dryRun === true,
  };

  if (!fs.existsSync(dir) || !registradaNoGit(raiz, dir)) {
    return {
      ...vazio,
      ok: false,
      jaAtualizada: false,
      rebaseFeito: false,
      motivo: 'tree.blocked',
      detalhe: `a thread ${id} nao tem worktree registrada no git`,
      correcao: `crie a worktree com: ork worktree ensure ${id}`,
    };
  }

  const limpa = arvoreLimpa(dir);
  if (limpa !== true) {
    return {
      ...vazio,
      ok: false,
      jaAtualizada: false,
      rebaseFeito: false,
      motivo: 'tree.blocked',
      detalhe:
        limpa === null
          ? `${dir} nao respondeu a \`git status\``
          : `${dir} tem alteracao nao commitada; rebase em arvore suja perde trabalho`,
      correcao: `commite ou guarde as alteracoes em ${dir} e rode de novo: ork worktree sync ${id}`,
    };
  }

  try { vincularEstado(raiz, id, dir, opcoes.dryRun); } catch (e) {
    return { ...vazio, ok: false, jaAtualizada: false, rebaseFeito: false,
      motivo: 'tree.blocked', detalhe: (e as Error).message, correcao: 'reconcilie as duas cópias sem descartar evidências' };
  }

  const refBase = exec('git', ['rev-parse', '--verify', base], raiz);
  if (!refBase.ok) {
    return {
      ...vazio,
      ok: false,
      jaAtualizada: false,
      rebaseFeito: false,
      motivo: 'tree.blocked',
      detalhe: `a base ${base} do manifesto nao existe neste repositorio`,
      correcao: `corrija worktree.base_branch em ${carregado.caminho}`,
    };
  }
  const shaBase = refBase.stdout.trim();
  const shaAntes = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  passos.push(`git rev-parse --verify ${base}   (${shaBase.slice(0, 8)})`);

  const jaTem = exec('git', ['merge-base', '--is-ancestor', shaBase, 'HEAD'], dir).ok;
  passos.push(`git merge-base --is-ancestor ${shaBase.slice(0, 8)} HEAD`);
  if (jaTem) {
    if (!opcoes.dryRun) {
      registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeSincronizada, {
        dir,
        branch,
        base,
        shaBase,
        shaAntes,
        shaDepois: shaAntes,
        rebaseFeito: false,
        detalhe: 'a base ja era ancestral do HEAD da thread',
      });
    }
    return {
      ...vazio,
      shaBase,
      shaAntes,
      shaDepois: shaAntes,
      ok: true,
      jaAtualizada: true,
      rebaseFeito: false,
      motivo: null,
      detalhe: `a base ${base} ja esta incorporada: nada a sincronizar`,
      correcao: '',
    };
  }

  // RM-037 (defeitosdeco D-5): depois do corte de 27/09 a base tem raiz nova. Branch sem commit
  // proprio nao e rebasada: o rebase sem ancestral comum reaplicaria a historia antiga inteira. Ela
  // e recriada no SHA da base com `reset --keep`, que aborta se houvesse mudanca local a perder (a
  // arvore ja foi conferida limpa). Com commit proprio e sem ancestral comum, a branch fica como esta
  // e a correcao exata reaplica so o que e dela.
  const historia = historiaPropria(raiz, thread, dir, shaBase);
  if (historia.proprios === 0) {
    passos.push(`git reset --keep ${shaBase}`);
    if (opcoes.dryRun) {
      return { ...vazio, shaBase, shaAntes, shaDepois: shaAntes, ok: true, jaAtualizada: false, rebaseFeito: false, recriada: false,
        motivo: null, detalhe: `a branch ${branch} nao tem commit proprio: o sync real a recriaria na base ${base} atual, sem rebase`,
        correcao: '' };
    }
    let recriacao;
    try { recriacao = comEstadoParaGit(raiz, id, dir, () => exec('git', ['reset', '--keep', shaBase], dir)); }
    catch (e) {
      return { ...vazio, shaBase, shaAntes, ok: false, jaAtualizada: false, rebaseFeito: false,
        motivo: 'tree.blocked', detalhe: (e as Error).message,
        correcao: 'inspecione a cópia local e a fonte canônica preservadas antes de repetir o sync' };
    }
    const shaDepois = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    if (!recriacao.ok || shaDepois !== shaBase) {
      return { ...vazio, shaBase, shaAntes, shaDepois, ok: false, jaAtualizada: false, rebaseFeito: false, motivo: 'tree.blocked',
        detalhe: `a recriacao da branch ${branch} na base falhou: ${(recriacao.stderr || recriacao.stdout).trim().split('\n').slice(-2).join(' | ')}`,
        correcao: `confira a worktree ${dir} e rode de novo: ork worktree sync ${id}` };
    }
    const detalhe = historia.semAncestral
      ? `branch sem commit proprio recriada a partir da base ${base} atual; a base foi reescrita e nao tinha historia em comum com ela`
      : `branch sem commit proprio recriada a partir da base ${base} atual`;
    registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeSincronizada, { dir, branch, base, shaBase, shaAntes, shaDepois,
      rebaseFeito: false, recriada: true, semAncestral: historia.semAncestral, detalhe });
    return { ...vazio, shaBase, shaAntes, shaDepois, ok: true, jaAtualizada: false, rebaseFeito: false, recriada: true,
      motivo: null, detalhe, correcao: '' };
  }
  if (historia.semAncestral) {
    const onto = historia.pontoDePartida
      ? `git -C ${dir} rebase --onto ${shaBase} ${historia.pontoDePartida}`
      : `git -C ${dir} rebase --onto ${shaBase} <commit onde a branch da thread comecou>`;
    const detalhe = `a base ${base} foi reescrita e nao tem historia em comum com a branch ${branch}, que tem ` +
      `${historia.proprios ?? 'um numero desconhecido de'} commit(s) proprio(s): o rebase reaplicaria a historia antiga inteira`;
    if (!opcoes.dryRun) registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeSincronizada, { dir, branch, base, shaBase, shaAntes,
      rebaseFeito: false, motivo: 'tree.blocked', causa: 'base-reescrita', semAncestral: true, detalhe });
    return { ...vazio, shaBase, shaAntes, shaDepois: shaAntes, ok: false, jaAtualizada: false, rebaseFeito: false,
      motivo: 'tree.blocked', causa: 'base-reescrita', detalhe, correcao: `reaplique so os commits da thread sobre a base nova: ${onto}` };
  }
  // RM-037 (fatia 3, defeito 3): com ancestral comum, o sync caia no `git rebase <base>` abaixo e
  // reaplicava tambem o que a reescrita tirou da base. O ponto de partida fora da base atual e o sinal.
  if (historia.baseReescrita) {
    const ponto = historia.pontoDePartida as string;
    passos.push(`git merge-base --is-ancestor ${ponto.slice(0, 8)} ${shaBase.slice(0, 8)}   (falso: a base foi reescrita)`);
    const detalhe = `a base ${base} foi reescrita: o ponto de partida ${ponto.slice(0, 8)} da branch ${branch} nao esta mais nela, ` +
      `e o rebase comum reaplicaria ${historia.sairamDaBase ?? 'um numero desconhecido de'} commit(s) que sairam da base junto com ` +
      `o(s) ${historia.proprios ?? '?'} da thread (git rev-list --count HEAD --not ${ponto.slice(0, 8)} ${shaBase.slice(0, 8)})`;
    if (!opcoes.dryRun) registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeSincronizada, { dir, branch, base, shaBase, shaAntes,
      rebaseFeito: false, motivo: 'tree.blocked', causa: 'base-reescrita', baseReescrita: true, pontoDePartida: ponto,
      sairamDaBase: historia.sairamDaBase, proprios: historia.proprios, detalhe });
    return { ...vazio, shaBase, shaAntes, shaDepois: shaAntes, ok: false, jaAtualizada: false, rebaseFeito: false,
      motivo: 'tree.blocked', causa: 'base-reescrita', detalhe,
      correcao: `reaplique so os commits da thread sobre a base nova: git -C ${dir} rebase --onto ${shaBase} ${ponto}` };
  }

  if (opcoes.dryRun) {
    passos.push(`git rebase ${shaBase}`);
    return {
      ...vazio,
      shaBase,
      shaAntes,
      shaDepois: shaAntes,
      ok: true,
      jaAtualizada: false,
      rebaseFeito: false,
      motivo: null,
      detalhe: `a base ${base} avancou; o sync real faria o rebase acima`,
      correcao: '',
    };
  }

  let rebase;
  try {
    rebase = comEstadoParaGit(raiz, id, dir, () => {
      const resultado = exec('git', ['rebase', shaBase], dir);
      if (!resultado.ok) exec('git', ['rebase', '--abort'], dir);
      return resultado;
    });
  } catch (e) {
    return { ...vazio, shaBase, shaAntes, ok: false, jaAtualizada: false, rebaseFeito: false,
      motivo: 'tree.blocked', detalhe: (e as Error).message,
      correcao: 'inspecione a cópia local e a fonte canônica preservadas antes de repetir o sync' };
  }
  passos.push(`git rebase ${shaBase}`);
  if (!rebase.ok) {
    passos.push('git rebase --abort');
    const detalhe = (rebase.stderr || rebase.stdout).trim().split('\n').slice(-4).join(' | ');
    registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeSincronizada, {
      dir,
      branch,
      base,
      shaBase,
      shaAntes,
      rebaseFeito: false,
      motivo: 'tree.blocked',
      detalhe,
    });
    return {
      ...vazio,
      shaBase,
      shaAntes,
      shaDepois: shaAntes,
      ok: false,
      jaAtualizada: false,
      rebaseFeito: false,
      motivo: 'tree.blocked',
      detalhe: `o rebase sobre ${base} conflitou e foi abortado: ${detalhe}`,
      correcao:
        `resolva o conflito na worktree ${dir} (git rebase ${shaBase} e resolucao manual), ` +
        `ou reduza a regiao da thread com um lease path:<glob> menor`,
    };
  }

  const shaDepois = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeSincronizada, {
    dir,
    branch,
    base,
    shaBase,
    shaAntes,
    shaDepois,
    rebaseFeito: true,
    detalhe: `branch da thread rebasada sobre ${base}`,
  });
  return {
    ...vazio,
    shaBase,
    shaAntes,
    shaDepois,
    ok: true,
    jaAtualizada: false,
    rebaseFeito: true,
    motivo: null,
    detalhe: `a base ${base} avancou e a branch ${branch} foi rebasada sobre ela`,
    correcao: '',
  };
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

export interface ResultadoAudit {
  ok: boolean;
  divergencias: number;
  dir: string;
  branch: string;
  checks: Check[];
}

/**
 * Confere a consistencia da worktree NO PROPRIO GIT.
 *
 * Cada check responde uma pergunta que ja causou incidente no Devmaster: a worktree
 * existe mesmo? o git a conhece? a branch em check-out e a da thread? a arvore esta
 * limpa? a base avancou? os artefatos da thread estao fora da arvore?
 */
export function auditarWorktree(carregado: ManifestoCarregado, id: string): ResultadoAudit {
  const { raiz, manifesto } = carregado;
  const thread = lerThread(raiz, id);
  const dir = thread.worktree ?? dirDaWorktree(carregado, id);
  const branchEsperada = branchDaWorktree(thread);
  const checks: Check[] = [];

  checks.push(
    thread.worktree
      ? { nome: 'registro', nivel: 'ok', detalhe: `thread.json aponta para ${thread.worktree}` }
      : {
          nome: 'registro',
          nivel: 'fail',
          detalhe: 'a thread nao tem worktree registrada no thread.json',
          correcao: `ork worktree ensure ${id}`,
        }
  );

  const existe = fs.existsSync(dir);
  checks.push(
    existe
      ? { nome: 'diretorio', nivel: 'ok', detalhe: dir }
      : {
          nome: 'diretorio',
          nivel: 'fail',
          detalhe: `${dir} nao existe no disco`,
          correcao: `ork worktree ensure ${id}`,
        }
  );

  const registro = worktreesDoGit(raiz).find((w) => w.dir === dir);
  checks.push(
    registro
      ? { nome: 'git', nivel: 'ok', detalhe: 'aparece em `git worktree list --porcelain`' }
      : {
          nome: 'git',
          nivel: 'fail',
          detalhe: `${dir} nao aparece em \`git worktree list\``,
          correcao: `git worktree prune && ork worktree ensure ${id}`,
        }
  );

  if (registro) {
    checks.push(
      registro.branch === branchEsperada
        ? { nome: 'branch', nivel: 'ok', detalhe: `${registro.branch} em check-out` }
        : {
            nome: 'branch',
            nivel: 'fail',
            detalhe: `esperado ${branchEsperada}, encontrado "${registro.branch || '(HEAD solto)'}"`,
            correcao: `git -C ${dir} switch ${branchEsperada}`,
          }
    );
  }

  // RM-047 (P2): git so roda na worktree registrada e com o thread.json local.
  let procedencia: string | null = null;
  if (existe) {
    try { exigirCwdLocal(raiz, id, dir, 'thread'); }
    catch (e) {
      procedencia = (e as Error).message;
      checks.push({ nome: 'procedencia', nivel: 'fail', detalhe: procedencia, correcao: `ork worktree ensure ${id}` });
    }
  }
  if (existe && procedencia === null) {
    const limpa = arvoreLimpa(dir);
    checks.push(
      limpa === true
        ? { nome: 'arvore', nivel: 'ok', detalhe: 'sem alteracao nao commitada' }
        : {
            nome: 'arvore',
            nivel: limpa === null ? 'fail' : 'warn',
            detalhe:
              limpa === null
                ? '`git status` nao respondeu neste diretorio'
                : 'ha alteracao nao commitada na worktree',
            correcao: `git -C ${dir} status`,
          }
    );

    const base = manifesto.worktree.base_branch;
    const refBase = exec('git', ['rev-parse', '--verify', base], raiz);
    if (refBase.ok) {
      const shaBase = refBase.stdout.trim();
      const incorporada = exec('git', ['merge-base', '--is-ancestor', shaBase, 'HEAD'], dir).ok;
      checks.push(
        incorporada
          ? { nome: 'base', nivel: 'ok', detalhe: `${base} @ ${shaBase.slice(0, 8)} ja incorporada` }
          : {
              nome: 'base',
              nivel: 'fail',
              detalhe: `a base ${base} avancou para ${shaBase.slice(0, 8)} e nao esta na branch da thread`,
              correcao: `ork worktree sync ${id}`,
            }
      );
    }
  }

  const dirArtefatos = dirThread(raiz, id);
  const dentroDaArvore = path.resolve(dirArtefatos).startsWith(path.resolve(dir) + path.sep);
  checks.push(
    dentroDaArvore
      ? {
          nome: 'artefatos',
          nivel: 'fail',
          detalhe: `os artefatos da thread estao DENTRO da worktree (${dirArtefatos})`,
          correcao: 'os artefatos da thread vivem em .orkastery/threads/<id>, fora da arvore',
        }
      : {
          nome: 'artefatos',
          nivel: 'ok',
          detalhe: `${path.relative(raiz, dirArtefatos)} fica fora da worktree`,
        }
  );

  if (existe) checks.push(auditarEstado(raiz, id, dir));
  const divergencias = checks.filter((c) => c.nivel === 'fail').length;
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeAuditada, {
    dir,
    branch: branchEsperada,
    divergencias,
    checks: checks.map((c) => ({ nome: c.nome, nivel: c.nivel, detalhe: c.detalhe })),
    fonte: 'git worktree list --porcelain, git status, git merge-base',
  });
  return { ok: divergencias === 0, divergencias, dir, branch: branchEsperada, checks };
}

/** Texto de `ork worktree audit`. */
export function textoDoAudit(id: string, r: ResultadoAudit): string {
  const linhas = [
    `Auditoria da worktree da thread ${id}`,
    `  dir     ${r.dir}`,
    `  branch  ${r.branch}`,
    '',
  ];
  for (const c of r.checks) {
    linhas.push(`  ${simbolo(c.nivel)} ${c.nome.padEnd(11)} ${c.detalhe}`);
    if (c.nivel !== 'ok' && c.correcao) linhas.push(`         correcao: ${c.correcao}`);
  }
  linhas.push('');
  linhas.push(
    r.ok
      ? '  worktree consistente: o git confirma cada item acima.'
      : `  ${r.divergencias} divergencia(s) encontrada(s) no proprio git.`
  );
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

export interface ResultadoRelease {
  ok: boolean;
  removida: boolean;
  dir: string;
  branch: string;
  leasesLiberados: string[];
  motivo: MotivoGate | null;
  detalhe: string;
  correcao: string;
}

/** Solta os leases de escrita que a thread ainda segurava. */
function soltarLeasesDaThread(raiz: string, id: string): string[] {
  const soltos: string[] = [];
  const escrita = nomeDeLease('worktree-write', id);
  for (const lease of leasesDaThread(raiz, id)) {
    if (lease.nome !== escrita) continue;
    const r = liberar(raiz, lease.nome, id);
    if (r.ok) soltos.push(lease.nome);
  }
  return soltos;
}

/**
 * Devolve o recurso: remove a worktree da thread e limpa o registro.
 *
 * Recusa arvore suja sem `--forcar`: apagar trabalho nao commitado de outra sessao e
 * irreversivel, e o `ork` nao faz passo irreversivel por conta propria.
 */
export function liberarWorktree(
  carregado: ManifestoCarregado,
  id: string,
  opcoes: { forcar?: boolean } = {}
): ResultadoRelease {
  const { raiz } = carregado;
  const thread = lerThread(raiz, id);
  const dir = thread.worktree ?? dirDaWorktree(carregado, id);
  const branch = branchDaWorktree(thread);

  if (!fs.existsSync(dir)) {
    exec('git', ['worktree', 'prune'], raiz);
    const soltos = soltarLeasesDaThread(raiz, id);
    if (thread.worktree) {
      thread.worktree = null;
      gravarThread(raiz, thread);
    }
    registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeLiberada, {
      dir,
      branch,
      removida: false,
      leasesLiberados: soltos,
      detalhe: 'o diretorio ja nao existia; o registro foi limpo',
    });
    return {
      ok: true,
      removida: false,
      dir,
      branch,
      leasesLiberados: soltos,
      motivo: null,
      detalhe: 'o diretorio ja nao existia; registro limpo e `git worktree prune` rodado',
      correcao: '',
    };
  }

  // RM-047 (P2): nada de git num diretorio que o thread.json escolheu e o git nao registra.
  try { exigirCwdLocal(raiz, id, dir, 'thread'); }
  catch (e) {
    return { ok: false, removida: false, dir, branch, leasesLiberados: [], motivo: 'tree.blocked',
      detalhe: (e as Error).message, correcao: `confira o diretorio e o thread.json da thread ${id}` };
  }
  const limpa = arvoreLimpa(dir);
  if (limpa === false && !opcoes.forcar) {
    return {
      ok: false,
      removida: false,
      dir,
      branch,
      leasesLiberados: [],
      motivo: 'tree.blocked',
      detalhe: `${dir} tem alteracao nao commitada`,
      correcao: `commite o que interessa em ${dir}, ou repita com --forcar para descartar`,
    };
  }

  const argumentos = ['worktree', 'remove', dir];
  if (opcoes.forcar) argumentos.push('--force');
  const r = exec('git', argumentos, raiz);
  if (!r.ok) {
    return {
      ok: false,
      removida: false,
      dir,
      branch,
      leasesLiberados: [],
      motivo: 'tree.blocked',
      detalhe: `git worktree remove falhou: ${(r.stderr || r.stdout).trim()}`,
      correcao: `rode \`git worktree remove ${dir}\` na mao e confira \`git worktree list\``,
    };
  }
  exec('git', ['worktree', 'prune'], raiz);
  // Prova no git, nao no codigo de saida: a worktree sumiu mesmo da lista?
  if (registradaNoGit(raiz, dir)) {
    return {
      ok: false,
      removida: false,
      dir,
      branch,
      leasesLiberados: [],
      motivo: 'tree.blocked',
      detalhe: `${dir} continua em \`git worktree list\` depois do remove`,
      correcao: 'git worktree prune && git worktree list',
    };
  }

  const soltos = soltarLeasesDaThread(raiz, id);
  thread.worktree = null;
  gravarThread(raiz, thread);
  registrar(dirThread(raiz, id), id, TIPOS_DE_EVENTO.worktreeLiberada, {
    dir,
    branch,
    removida: true,
    forcado: opcoes.forcar === true,
    leasesLiberados: soltos,
    fonte: 'git worktree list --porcelain',
  });
  return {
    ok: true,
    removida: true,
    dir,
    branch,
    leasesLiberados: soltos,
    motivo: null,
    detalhe: `worktree removida; a branch ${branch} continua no repositorio`,
    correcao: '',
  };
}

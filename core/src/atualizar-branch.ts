/**
 * RM-063 (F7): o merge da base remota na branch da thread, com a reconciliacao deterministica do CHANGELOG.
 *
 * Incidente de 12 e 13/10/2026: os PRs #153 e #154 ficaram prontos e esperaram de 5 a 6 horas pelo condutor, e cada
 * merge da outra maquina na `main` reabriu o conflito no CHANGELOG; o condutor resolvia a mao, com um script. Aqui o
 * mesmo passo, sob a conducao da thread (`branch.atualizar`, exclusiva com despacho e verify na mesma worktree):
 *
 *  - traz a base remota e faz o merge dela na branch, na worktree da thread, sem commit ainda;
 *  - conflito em qualquer arquivo que nao seja o CHANGELOG aborta o merge e volta com a lista: conflito em codigo
 *    nunca e resolvido sozinho, e vira item da fila do dono;
 *  - com conflito so no CHANGELOG, ou sem conflito, os itens da thread voltam a `## Não publicado`, no mesmo grupo
 *    (`changelog-reconciliacao.ts`), e o merge e commitado;
 *  - com `enviar`, empurra a branch sem forca e prova pelo `git ls-remote`.
 *
 * A worktree com alteracao nao commitada, outra branch ou um merge em curso recusa antes de tocar em qualquer coisa.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ARQUIVO_DO_CHANGELOG, ItemDevolvido, reconciliarChangelog, temMarcadorDeConflito } from './changelog-reconciliacao';
import { comConducao, ErroDeConducao, identidadeDoAmbiente } from './conducao';
import { raizDoEstado } from './estado-thread';
import { ManifestoCarregado } from './manifest';
import { guardaDaThread, MotivoDaGuarda } from './noctum-guarda';
import { diretorioDaThread } from './procedencia';
import { lerThread } from './thread';
import { CanalDeConducao } from './types';
import { exec } from './util';
import { branchDaWorktree } from './worktree';
import { msg } from './locale';

export const CONTRATO_DA_ATUALIZACAO = 'ork.branch-atualizada/v1' as const;
/** O teto do merge e do push juntos: a conducao da thread vale por isto, com folga. */
const PRAZO_DA_ATUALIZACAO_MS = 10 * 60 * 1000;

export type MotivoDaRecusa = 'worktree-ausente' | 'branch-errada' | 'merge-em-curso' | 'worktree-suja' | 'base-ausente' |
  'git-sem-resposta' | 'conduzida' | 'push-recusado' | 'branch-desalinhada' | MotivoDaGuarda;

export type ResultadoDaAtualizacao = {
  contrato: typeof CONTRATO_DA_ATUALIZACAO;
  thread: string;
  branch: string;
  base: string;
} & (
  | { acao: 'ja-atualizada'; sha: string; enviada: boolean }
  | { acao: 'mesclada'; sha: string; shaAntes: string; changelog: { devolvidos: number; itens: ItemDevolvido[] } | null;
    enviada: boolean }
  | { acao: 'conflito-em-codigo'; arquivos: string[] }
  | { acao: 'recusada'; motivo: MotivoDaRecusa; detalhe: string }
);

export interface OpcoesDaAtualizacao {
  /** Traz a base remota antes (padrao: sim). */
  buscar?: boolean;
  /** Empurra a branch depois do merge (a batida empurra; o comando so quando pedido). */
  enviar?: boolean;
  canal?: CanalDeConducao;
  correlacao?: string | null;
  esperarMs?: number;
  /**
   * O head do PR com que a branch local tem de ficar alinhada antes do merge da base: a local atras dele (o "Update
   * branch" do GitHub, o push de outra maquina) avanca por fast-forward; a que divergiu dele e recusada.
   */
  alinharCom?: string;
}

const AMBIENTE_DO_GIT = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' });

/** O CHANGELOG numa revisao; `null` quando ele nao existe nela. */
function changelogEm(dir: string, ref: string): string | null {
  const r = exec('git', ['show', `${ref}:${ARQUIVO_DO_CHANGELOG}`], dir, 30000);
  return r.ok ? r.stdout : null;
}

/** Os arquivos em conflito do merge em curso. */
function emConflito(dir: string): string[] | null {
  const r = exec('git', ['diff', '--name-only', '--diff-filter=U', '-z'], dir, 30000);
  return r.ok ? r.stdout.split('\0').filter(Boolean).sort() : null;
}

/**
 * Faz o merge da base remota na branch da thread, sob a conducao dela. Nunca resolve conflito em codigo: aborta e
 * devolve a lista. Recusa (com motivo tipado) antes de mexer na worktree que nao esta pronta.
 */
export function atualizarBranchDaThread(carregado: ManifestoCarregado, threadId: string,
  opcoes: OpcoesDaAtualizacao = {}): ResultadoDaAtualizacao {
  const raiz = raizDoEstado(carregado.raiz);
  const remoto = carregado.manifesto.fabrica.remoto, base = carregado.manifesto.worktree.base_branch;
  const t = lerThread(raiz, threadId);
  const branch = branchDaWorktree(t);
  const cabeca = { contrato: CONTRATO_DA_ATUALIZACAO, thread: t.id, branch, base: `${remoto}/${base}` };
  const recusa = (motivo: MotivoDaRecusa, detalhe: string): ResultadoDaAtualizacao => ({ ...cabeca, acao: 'recusada', motivo, detalhe });
  // RM-058, integracao (T1.1, D3 da ork-rm058integra): a branch da thread de um arco #Noctum e atualizada pelo passo da
  // entrega do arco, com a regra do CHANGELOG dele; por fora, nem o comando nem a batida a mesclam.
  const guarda = guardaDaThread(raiz, t.id);
  if (guarda) return recusa(guarda.motivo, guarda.texto);
  let dir: string;
  try { dir = diretorioDaThread(raiz, t); } catch (e) { return recusa('worktree-ausente', (e as Error).message); }
  if (!t.worktree || !fs.existsSync(dir)) return recusa('worktree-ausente', `a thread ${t.id} não tem worktree nesta máquina`);
  try {
    // A sessao despachada que conduz a thread reentra pela identidade de despacho dela, como o `ork verify` (R3).
    return comConducao(raiz, t.id, { canal: opcoes.canal ?? 'cli', correlacao: opcoes.correlacao ?? null, operacao: 'branch.atualizar',
      fase: null, promptSha256: null, prazoMs: PRAZO_DA_ATUALIZACAO_MS, identidade: identidadeDoAmbiente(t.id, process.env, raiz),
      ...(opcoes.esperarMs ? { esperarMs: opcoes.esperarMs } : {}) },
    () => mesclar(dir, branch, remoto, base, opcoes, cabeca, recusa));
  } catch (e) {
    if (e instanceof ErroDeConducao) return recusa('conduzida', e.recusa.texto.split('\n').slice(0, 2).join(' '));
    throw e;
  }
}

function mesclar(dir: string, branch: string, remoto: string, base: string, opcoes: OpcoesDaAtualizacao,
  cabeca: { contrato: typeof CONTRATO_DA_ATUALIZACAO; thread: string; branch: string; base: string },
  recusa: (motivo: MotivoDaRecusa, detalhe: string) => ResultadoDaAtualizacao): ResultadoDaAtualizacao {
  const env = AMBIENTE_DO_GIT();
  const git = (args: string[], prazo = 60000) => exec('git', args, dir, prazo, env);
  const atual = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!atual.ok) return recusa('git-sem-resposta', `git rev-parse saiu ${atual.code}: ${atual.stderr.trim().slice(0, 160)}`);
  if (atual.stdout.trim() !== branch) return recusa('branch-errada', `a worktree está na branch ${atual.stdout.trim()}, e a da thread é ${branch}`);
  if (git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok) return recusa('merge-em-curso', 'há um merge em curso na worktree');
  const status = git(['status', '--porcelain', '--', '.', ':(exclude).orkastery']);
  if (!status.ok) return recusa('git-sem-resposta', `git status saiu ${status.code}`);
  if (status.stdout.trim()) return recusa('worktree-suja', 'a worktree tem alteração não commitada; o merge não vai por cima dela');
  if (opcoes.buscar !== false) {
    const f = git(['fetch', '-q', '--no-tags', '--', remoto, `+refs/heads/${base}:refs/remotes/${remoto}/${base}`], 120000);
    if (!f.ok) return recusa('git-sem-resposta', `git fetch ${remoto} ${base} saiu ${f.error ?? f.code}: ${f.stderr.trim().split('\n')[0]?.slice(0, 160) ?? ''}`);
  }
  const deles = `refs/remotes/${remoto}/${base}`;
  const ponta = git(['rev-parse', '--verify', '-q', `${deles}^{commit}`]);
  if (!ponta.ok) return recusa('base-ausente', `a cópia da base ${remoto}/${base} não existe neste repositório`);
  if (opcoes.alinharCom && git(['rev-parse', 'HEAD']).stdout.trim() !== opcoes.alinharCom) {
    if (!git(['merge-base', '--is-ancestor', 'HEAD', opcoes.alinharCom]).ok) {
      return recusa('branch-desalinhada', `a branch local divergiu do head do PR (${opcoes.alinharCom.slice(0, 8)}): o merge não vai por cima`);
    }
    const ff = git(['merge', '--ff-only', '-q', opcoes.alinharCom], 120000);
    if (!ff.ok) return recusa('git-sem-resposta', `git merge --ff-only saiu ${ff.code}: ${(ff.stderr || ff.stdout).trim().split('\n')[0]?.slice(0, 160) ?? ''}`);
  }
  const shaAntes = git(['rev-parse', 'HEAD']).stdout.trim();
  // O push nunca leva tag (push.followTags do usuario poria a tag de versao no remoto e dispararia a publicacao) nem forca.
  const empurrar = (sha: string): string | null => {
    const p = git(['push', '-q', '--no-follow-tags', '--', remoto, `HEAD:refs/heads/${branch}`], 120000);
    const remota = git(['ls-remote', '--', remoto, `refs/heads/${branch}`], 60000).stdout.split(/\s+/)[0] ?? '';
    return p.ok && remota === sha ? null : `o merge ${sha.slice(0, 8)} ficou só nesta máquina: git push saiu ${p.code}` +
      (remota ? `, e o remoto está em ${remota.slice(0, 8)}` : '');
  };
  if (git(['merge-base', '--is-ancestor', deles, 'HEAD']).ok) {
    // Ja contem a base. Com `enviar`, a branch remota atras da local (o push que falhou na rodada anterior) e empurrada;
    // a remota que andou para outro lado nao e sobrescrita.
    let enviada = false;
    if (opcoes.enviar) {
      const remota = git(['ls-remote', '--', remoto, `refs/heads/${branch}`], 60000).stdout.split(/\s+/)[0] ?? '';
      if (remota !== shaAntes) {
        if (remota && !git(['merge-base', '--is-ancestor', remota, 'HEAD']).ok) {
          return recusa('push-recusado', `o remoto da ${branch} está em ${remota.slice(0, 8)}, fora da história local: nada é empurrado por cima`);
        }
        const falha = empurrar(shaAntes);
        if (falha) return recusa('push-recusado', falha);
        enviada = true;
      }
    }
    return { ...cabeca, acao: 'ja-atualizada', sha: shaAntes, enviada };
  }

  const m = git(['merge', '--no-ff', '--no-commit', '--', deles], 120000);
  const conflitos = emConflito(dir);
  if (conflitos === null) { git(['merge', '--abort']); return recusa('git-sem-resposta', 'o git não disse os arquivos em conflito'); }
  if (!m.ok && !git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok) {
    return recusa('git-sem-resposta', `git merge saiu ${m.code}: ${(m.stderr || m.stdout).trim().split('\n')[0]?.slice(0, 160) ?? ''}`);
  }
  const emCodigo = conflitos.filter((a) => a !== ARQUIVO_DO_CHANGELOG);
  if (emCodigo.length) {
    git(['merge', '--abort']);
    return { ...cabeca, acao: 'conflito-em-codigo', arquivos: emCodigo };
  }

  // O CHANGELOG: os itens da thread voltam a "Não publicado", no mesmo grupo, com ou sem conflito nele.
  let changelog: { devolvidos: number; itens: ItemDevolvido[] } | null = null;
  const arquivo = path.join(dir, ARQUIVO_DO_CHANGELOG);
  const nosso = changelogEm(dir, 'HEAD'), delesTexto = changelogEm(dir, deles);
  if (nosso !== null && delesTexto !== null) {
    const mb = git(['merge-base', 'HEAD', deles]);
    const baseTexto = mb.ok ? changelogEm(dir, mb.stdout.trim()) ?? '' : '';
    const conflitou = conflitos.includes(ARQUIVO_DO_CHANGELOG);
    const mesclado = conflitou ? null : fs.readFileSync(arquivo, 'utf8');
    const r = reconciliarChangelog({ base: baseTexto, nosso, deles: delesTexto, mesclado });
    // A reconciliacao so devolve itens de lista; a linha que a thread acrescentou e nao voltou (outra forma de item,
    // edicao numa versao publicada) nunca some calada: o merge e abortado e fica com o dono.
    if (temMarcadorDeConflito(r.texto) || r.perdidas.length) {
      git(['merge', '--abort']);
      return { ...cabeca, acao: 'conflito-em-codigo', arquivos: [ARQUIVO_DO_CHANGELOG] };
    }
    if (conflitou || r.texto !== mesclado) {
      fs.writeFileSync(arquivo, r.texto, 'utf8');
      if (!git(['add', '--', ARQUIVO_DO_CHANGELOG]).ok) { git(['merge', '--abort']); return recusa('git-sem-resposta', 'git add do CHANGELOG falhou'); }
    }
    changelog = { devolvidos: r.devolvidos, itens: r.itens };
  } else if (conflitos.includes(ARQUIVO_DO_CHANGELOG)) {
    git(['merge', '--abort']);
    return { ...cabeca, acao: 'conflito-em-codigo', arquivos: [ARQUIVO_DO_CHANGELOG] };
  }
  const titulo = `Merge da ${remoto}/${base} na ${branch}` +
    (changelog?.devolvidos ? `: ${changelog.devolvidos} item(ns) da thread de volta a "Não publicado" do CHANGELOG` : '');
  const c = git(['commit', '-q', '--no-edit', '-m', titulo], 120000);
  if (!c.ok) {
    git(['merge', '--abort']);
    return recusa('git-sem-resposta', `git commit do merge saiu ${c.code}: ${(c.stderr || c.stdout).trim().split('\n')[0]?.slice(0, 160) ?? ''}`);
  }
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  let enviada = false;
  if (opcoes.enviar) {
    const falha = empurrar(sha);
    if (falha) return recusa('push-recusado', falha);
    enviada = true;
  }
  return { ...cabeca, acao: 'mesclada', sha, shaAntes, changelog, enviada };
}

/** Uma linha para o terminal e para o resumo ao dono. */
export function textoDaAtualizacao(r: ResultadoDaAtualizacao): string {
  const m = msg().conducao.atualizacao;
  switch (r.acao) {
    case 'ja-atualizada': return m.atualizada(r.branch, r.base, r.enviada);
    case 'mesclada': return m.mesclada(r.base, r.branch, r.sha.slice(0, 8), r.changelog?.devolvidos ?? 0, r.enviada);
    case 'conflito-em-codigo': return m.conflito(r.base, r.branch, r.arquivos.join(', '));
    default: return m.recusada(r.branch, r.motivo, r.detalhe);
  }
}

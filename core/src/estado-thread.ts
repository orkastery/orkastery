/** D1: a árvore principal é o domicílio do estado, mesmo em uma linked worktree. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Check } from './types';
import { exec } from './util';

export function raizDoEstado(raiz: string): string {
  const local = path.resolve(raiz);
  const git = path.join(local, '.git');
  if (!fs.existsSync(git) || !fs.statSync(git).isFile()) return local;
  const match = /^gitdir: (.+)\s*$/m.exec(fs.readFileSync(git, 'utf8'));
  if (!match) throw new Error(`.git inválido em ${local}`);
  const gitdir = path.resolve(local, match[1].trim());
  const commondir = path.join(gitdir, 'commondir');
  if (!fs.existsSync(commondir)) return local; // submódulo, não linked worktree
  const comum = path.resolve(gitdir, fs.readFileSync(commondir, 'utf8').trim());
  const principal = path.dirname(comum);
  if (!fs.existsSync(path.join(principal, '.git')) ||
      fs.realpathSync(path.join(principal, '.git')) !== fs.realpathSync(comum)) {
    throw new Error(`árvore principal não resolvida pelo git-common-dir: ${comum}`);
  }
  return principal;
}

export function estadoCanonico(raiz: string, id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error('id de thread inválido');
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'threads', id]);
  return path.join(principal, '.orkastery', 'threads', id);
}

/**
 * RM-047 (fronteira de confiança): na árvore principal, `.orkastery`, `threads` e o diretório da thread
 * são pastas de verdade. Um link versionado no clone levaria ledger, claims e thread.json para fora da
 * raiz, e o `ork` anexaria linhas em arquivo alheio. O link que o próprio `ork` cria fica na worktree
 * (`vincularEstado`) e aponta para cá; ele nunca é um destes componentes.
 */
export function exigirEstadoSemLink(principal: string, componentes: readonly string[]): void {
  let atual = principal;
  for (const nome of componentes) {
    atual = path.join(atual, nome);
    const stat = fs.lstatSync(atual, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      throw new Error(`estado.link: ${path.relative(principal, atual)} é link simbólico; o estado do ork fica em ` +
        'pastas de verdade dentro da raiz (um link versionado levaria a escrita para fora dela). Remova o link.');
    }
  }
}

function mesmoArquivo(a: string, b: string): boolean {
  return fs.existsSync(a) && fs.existsSync(b) && fs.realpathSync(a) === fs.realpathSync(b);
}

function arquivos(dir: string, prefixo = ''): string[] {
  return fs.readdirSync(path.join(dir, prefixo), { withFileTypes: true }).flatMap(e => {
    const nome = path.join(prefixo, e.name);
    if (e.isSymbolicLink()) throw new Error(`estado legado contém link: ${nome}`);
    if (e.isDirectory()) return arquivos(dir, nome);
    if (!e.isFile()) throw new Error(`estado legado contém arquivo especial: ${nome}`);
    return [nome];
  });
}

function ignorarEstadoLocal(raiz: string, id: string): void {
  const exclude = path.join(raizDoEstado(raiz), '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const regras = [`/.orkastery/threads/${id}`, '/.orkastery/state-backups/'];
  const atual = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  for (const regra of regras) {
    if (!atual.split('\n').includes(regra)) fs.appendFileSync(exclude, `\n${regra}\n`);
  }
}

/** Preflight integral antes de copiar. Divergência preserva ambas as fontes. */
export function vincularEstado(raiz: string, id: string, worktree: string, dryRun = false): void {
  const alvo = estadoCanonico(raiz, id);
  const local = path.join(worktree, '.orkastery', 'threads', id);
  if (path.resolve(local) === alvo) return;
  if (raizDoEstado(worktree) !== raizDoEstado(raiz)) throw new Error('worktree não pertence à árvore principal');
  // O índice é próprio da linked worktree. A main continua versionando seu estado.
  const rastreados = exec('git', ['ls-files', '-z', '--', `.orkastery/threads/${id}/`], worktree);
  if (!rastreados.ok) throw new Error(`índice da worktree indisponível: ${rastreados.stderr}`);
  const nomes = rastreados.stdout.split('\0').filter(Boolean);
  const prepararIndice = () => {
    if (dryRun || nomes.length === 0) return;
    const r = exec('git', ['update-index', '--skip-worktree', '--', ...nomes], worktree);
    if (!r.ok) throw new Error(`não foi possível preservar o estado versionado no índice: ${r.stderr}`);
  };
  if (mesmoArquivo(local, alvo)) {
    prepararIndice();
    if (!dryRun) ignorarEstadoLocal(raiz, id);
    return;
  }
  const copiar: string[] = [];
  const existe = fs.existsSync(local);
  if (!existe && fs.lstatSync(path.dirname(local), { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('diretório de threads inesperadamente vinculado');
  }
  if (existe) {
    if (fs.lstatSync(local).isSymbolicLink()) throw new Error(`link de estado aponta para outro destino: ${local}`);
    for (const nome of arquivos(local)) {
      const destino = path.join(alvo, nome);
      if (!fs.existsSync(destino)) { copiar.push(nome); continue; }
      const a = fs.readFileSync(path.join(local, nome));
      const b = fs.readFileSync(destino);
      if (a.equals(b)) continue;
      // Prefixo JSONL já incorporado na main não é conflito nem deve ser duplicado.
      if (nome.endsWith('.jsonl') && a.toString().endsWith('\n') && b.subarray(0, a.length).equals(a)) continue;
      throw new Error(`estado dividido: ${nome} diverge entre ${local} e ${alvo}; reconcilie antes do sync`);
    }
  } else if (fs.lstatSync(local, { throwIfNoEntry: false })) {
    throw new Error(`link de estado quebrado: ${local}`);
  }
  // O ensaio executa o mesmo preflight, sem tocar em arquivos ou no índice.
  if (dryRun) return;
  fs.mkdirSync(alvo, { recursive: true });
  for (const nome of copiar) {
    const destino = path.join(alvo, nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(path.join(local, nome), destino, fs.constants.COPYFILE_EXCL);
  }
  prepararIndice();
  if (existe) {
    const backup = path.join(raizDoEstado(raiz), '.orkastery', 'state-backups', `${id}-${randomUUID()}`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.renameSync(local, backup);
  }
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.symlinkSync(path.relative(path.dirname(local), alvo), local, 'dir');
  // O vínculo é estado desta máquina, nunca parte do commit de produto.
  ignorarEstadoLocal(raiz, id);
}

/**
 * Git precisa materializar arquivos rastreados ao rebasar. Durante essa operação a
 * cópia local vem exclusivamente do índice; a fonte canônica permanece intocada na main.
 * O chamador conclui ou aborta o rebase antes de devolver o controle para a restauração.
 */
export function comEstadoParaGit<T>(raiz: string, id: string, worktree: string, executar: () => T): T {
  vincularEstado(raiz, id, worktree);
  const local = path.join(worktree, '.orkastery', 'threads', id);
  const prefixo = `.orkastery/threads/${id}/`;
  const git = (args: string[]) => {
    const r = exec('git', args, worktree);
    if (!r.ok) throw new Error(`preparação do estado para Git falhou: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  const nomes = git(['ls-files', '-z', '--', prefixo]).split('\0').filter(Boolean);
  fs.unlinkSync(local); // somente o alias; nunca o diretório canônico
  fs.mkdirSync(local);
  let materializado = false;
  try {
    if (nomes.length) {
      git(['update-index', '--no-skip-worktree', '--', ...nomes]);
      git(['checkout-index', '--force', '--', ...nomes]);
    }
    materializado = true;
    return executar();
  } finally {
    // Uma escrita externa durante a operação é conflito, não estado descartável.
    const mudou = materializado && (!exec('git', ['diff', '--quiet', '--', prefixo], worktree).ok ||
      git(['ls-files', '--others', '--', prefixo]).trim() !== '');
    if (mudou) throw new Error(`estado local alterado durante operação Git: ${local}; cópia e main preservadas para reconciliação`);
    if (fs.existsSync(local)) {
      const backup = path.join(raizDoEstado(raiz), '.orkastery', 'state-backups', `${id}-git-${randomUUID()}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(local, backup);
    }
    // A nova versão do índice pode ter incluído ou removido arquivos de estado.
    vincularEstado(raiz, id, worktree);
  }
}

/** Inspeciona o caminho físico, para o resolvedor não esconder uma cópia obsoleta. */
export function auditarEstado(raiz: string, id: string, worktree: string): Check {
  const main = estadoCanonico(raiz, id), local = path.join(worktree, '.orkastery', 'threads', id);
  const contar = (dir: string): number => {
    const file = path.join(dir, 'ledger.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
  };
  const ok = mesmoArquivo(main, local);
  return { nome: 'estado-unico', nivel: ok ? 'ok' : 'fail',
    detalhe: `${ok ? 'mesmo estado' : 'estado dividido'}: main=${contar(main)} eventos, worktree=${contar(local)} eventos; ${main}`,
    ...(ok ? {} : { correcao: `ork worktree sync ${id}; divergências exigem reconciliação preservando evidências` }) };
}

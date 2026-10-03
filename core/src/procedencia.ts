/**
 * RM-047 (fronteira de confiança, P2): procedência do estado que escolhe onde o `ork` roda.
 *
 * O `.orkastery/` é estado desta máquina, mas nada impede um repositório de versioná-lo, e o clone
 * traz então `thread.json`, ledger, fila e arquivos de host escritos em outro lugar. Duas regras
 * separam o estado local do que veio no clone:
 *
 * 1. Estado rastreado pelo git não vale como estado local para escolher diretório ou executável.
 *    `thread.json`, ledger e fila rastreados não escolhem o cwd; `pulse-host.json` e
 *    `master-host.json` rastreados não escolhem o transporte.
 * 2. O cwd do agente e do git, quando sai do estado (worktree da thread, cwd do despacho no ledger,
 *    cwd de um pedido da fila), só vale se for uma worktree que o `git worktree list` do próprio
 *    repositório registra. A raiz do projeto, escolhida por quem roda o comando, segue valendo.
 *
 * As recusas são tipadas: `estado.rastreado`, `estado.worktree-nao-registrada` e
 * `transporte.rastreado`. Cada mensagem diz o que fazer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { exec } from './util';

/** Caminho relativo à árvore principal, com `/` (o formato do `git ls-files`). */
function relativoAoRepositorio(principal: string, arquivo: string): string | null {
  const rel = path.relative(principal, path.resolve(arquivo));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * O arquivo está no índice do git da árvore principal? Sem git (projeto fora de repositório, git
 * ausente), nada está rastreado. A consulta roda na raiz do projeto, como todo git do `ork`.
 */
export function rastreadoPeloGit(raiz: string, arquivo: string): boolean {
  let principal: string;
  try { principal = raizDoEstado(raiz); } catch { principal = path.resolve(raiz); }
  const rel = relativoAoRepositorio(principal, arquivo);
  if (rel === null) return false;
  const r = exec('git', ['ls-files', '-z', '--', rel], principal, 30000);
  return r.ok && r.stdout.split('\0').some(Boolean);
}

/** As worktrees que o git do repositório registra, pelo caminho real. */
function worktreesRegistradas(principal: string): string[] {
  const r = exec('git', ['worktree', 'list', '--porcelain'], principal, 30000);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(l => l.startsWith('worktree ')).map(l => {
    const dir = l.slice('worktree '.length).trim();
    try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
  });
}

function real(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

/** De onde veio o diretório: decide qual arquivo de estado precisa ser local. */
export type OrigemDoCwd = 'thread' | 'ledger' | 'fila';

const ARQUIVO_DA_ORIGEM: Record<OrigemDoCwd, (threadId: string) => string> = {
  thread: id => `.orkastery/threads/${id}/thread.json`,
  ledger: id => `.orkastery/threads/${id}/ledger.jsonl`,
  fila: () => '.orkastery/retry/fila.jsonl',
};

/**
 * Confere o diretório que o estado escolheu para rodar git ou agente. Devolve o próprio diretório
 * quando ele vale; senão lança `estado.rastreado` ou `estado.worktree-nao-registrada`.
 *
 * A raiz do projeto (o checkout de quem roda o comando) e a árvore principal valem sem consulta: não
 * saem do estado.
 */
export function exigirCwdLocal(raiz: string, threadId: string, dir: string, origem: OrigemDoCwd): string {
  let principal: string;
  try { principal = raizDoEstado(raiz); } catch { principal = path.resolve(raiz); }
  const alvo = real(dir);
  if (alvo === real(raiz) || alvo === real(principal)) return dir;
  const arquivo = path.join(principal, ARQUIVO_DA_ORIGEM[origem](threadId));
  if (rastreadoPeloGit(principal, arquivo)) {
    throw new Error(`estado.rastreado: ${path.relative(principal, arquivo)} está versionado no git, e estado versionado ` +
      'não escolhe onde o ork roda (ele pode ter vindo de outro repositório). Tire o estado do índice ' +
      '(git rm -r --cached .orkastery e .orkastery/ no .gitignore) e rode o comando de novo.');
  }
  if (!path.isAbsolute(dir) || !fs.existsSync(dir) || !worktreesRegistradas(principal).includes(alvo)) {
    throw new Error(`estado.worktree-nao-registrada: ${JSON.stringify(String(dir)).slice(0, 200)} não aparece em ` +
      `git worktree list deste repositório, e o ork só roda git e agente na raiz do projeto ou numa worktree ` +
      `registrada. Recrie a worktree da thread com ork worktree ensure ${threadId}.`);
  }
  return dir;
}

/** Como `exigirCwdLocal`, sem lançar: `null` quando o diretório não vale. */
export function cwdLocalOuNulo(raiz: string, threadId: string, dir: string, origem: OrigemDoCwd): string | null {
  try { return exigirCwdLocal(raiz, threadId, dir, origem); } catch { return null; }
}

/**
 * O diretório de trabalho de uma thread: a worktree registrada dela, ou a raiz do projeto quando a
 * thread não tem worktree.
 */
export function diretorioDaThread(raiz: string, thread: { id: string; worktree: string | null }): string {
  return thread.worktree ? exigirCwdLocal(raiz, thread.id, thread.worktree, 'thread') : raiz;
}

/**
 * O arquivo de host (`pulse-host.json`, `master-host.json`) escolhe o executável que recebe a
 * mensagem. Só vale o arquivo local: versionado no git, ele veio com o repositório.
 */
export function exigirHostLocal(raiz: string, arquivo: string): void {
  if (rastreadoPeloGit(raiz, arquivo)) {
    throw new Error(`transporte.rastreado: ${path.basename(arquivo)} está versionado no git, e o transporte do ` +
      'pulse e do digest só vale do arquivo local desta máquina. Tire-o do índice (git rm --cached) e grave-o ' +
      'de novo nesta máquina.');
  }
  const st = fs.lstatSync(arquivo, { throwIfNoEntry: false });
  if (st && !st.isFile()) {
    throw new Error(`transporte.rastreado: ${path.basename(arquivo)} precisa ser um arquivo comum desta máquina, ` +
      'não link nem diretório.');
  }
}

/** `filho` está dentro de `pai` (ou é o próprio `pai`), pelos caminhos reais? */
function dentroDe(pai: string, filho: string): boolean {
  const rel = path.relative(pai, filho);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Um ponteiro que o estado guarda (`location` do `handoff.json`, `arquivo` de uma claim, `promptPath`
 * de uma sessão, arquivo de handoff ou de lição da memória) só é lido se, pelo caminho real (links
 * resolvidos), cair na raiz do projeto, na árvore principal ou na worktree registrada da thread.
 * Devolve o caminho real, ou `null` quando ele sai dessas raízes ou não existe.
 */
export function caminhoContidoOuNulo(raiz: string, thread: { id: string; worktree: string | null } | null,
  caminho: string): string | null {
  let alvo: string;
  try { alvo = fs.realpathSync(caminho); } catch { return null; }
  let principal: string;
  try { principal = raizDoEstado(raiz); } catch { principal = path.resolve(raiz); }
  const raizes = [real(raiz), real(principal)];
  if (thread?.worktree) {
    const w = cwdLocalOuNulo(raiz, thread.id, thread.worktree, 'thread');
    if (w) raizes.push(real(w));
  }
  return raizes.some(r => dentroDe(r, alvo)) ? alvo : null;
}

/**
 * Como `caminhoContidoOuNulo`, com a recusa tipada `ponteiro.fora-da-raiz` quando o arquivo existe
 * mas sai das raízes. Arquivo ausente segue para quem chamou dizer que o ponteiro não resolve.
 */
export function exigirCaminhoContido(raiz: string, thread: { id: string; worktree: string | null } | null,
  caminho: string, origem: string): string {
  const contido = caminhoContidoOuNulo(raiz, thread, caminho);
  if (contido) return contido;
  throw new Error(`ponteiro.fora-da-raiz: ${JSON.stringify(String(origem)).slice(0, 200)} aponta para fora da raiz do ` +
    'projeto e da worktree registrada da thread (também por link simbólico). Um ponteiro guardado no estado só lê ' +
    'arquivo de dentro do projeto. Exporte o handoff de novo (ork handoff export) ou copie o arquivo para dentro do projeto.');
}

/** Utilitarios compartilhados: execucao de processo, arquivos e formatacao do CLI. */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ResultadoExec {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  /** I-37 (T3): o sinal que encerrou o processo, quando houve. */
  signal?: NodeJS.Signals | null;
  /** I-37 (T3): o codigo do erro de spawn (`ENOENT`, `ETIMEDOUT`), quando houve. */
  error?: string;
}

/** Executa um comando capturando saida, sem shell (argumentos vao como array). */
export function exec(cmd: string, args: string[], cwd?: string, timeoutMs = 120000,
  env: NodeJS.ProcessEnv = process.env): ResultadoExec {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env,
  });
  return {
    ok: r.status === 0,
    code: r.status ?? -1,
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
    signal: r.signal ?? null,
    ...(r.error ? { error: (r.error as NodeJS.ErrnoException).code ?? r.error.message } : {}),
  };
}

/** O commit quando o repositorio ainda nao tem commit (base da thread, HEAD do verify). */
export const COMMIT_DESCONHECIDO = 'desconhecido';

/**
 * Sha para exibir: 8 caracteres quando o valor e um sha hexadecimal (SHA-1 ou SHA-256); qualquer
 * outro valor, como o marcador de repositorio sem commit, sai inteiro (o ensaio da 0.5.0 viu "desconhe").
 */
export function shaCurto(valor: string): string {
  return /^[0-9a-f]{7,64}$/i.test(valor) ? valor.slice(0, 8) : valor;
}

/** A branch para onde o HEAD aponta, com ou sem commit; `null` com o HEAD destacado. */
export function branchDoHead(dir: string): string | null {
  const r = exec('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], dir);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

/** O binario esta no PATH? */
export function noPath(bin: string): string | null {
  const r = exec('which', [bin]);
  return r.ok ? r.stdout.trim() : null;
}

/** Sobe a arvore de diretorios procurando um arquivo. Retorna o diretorio que o contem. */
export function subirAte(dirInicial: string, arquivo: string): string | null {
  let dir = path.resolve(dirInicial);
  for (;;) {
    if (fs.existsSync(path.join(dir, arquivo))) return dir;
    const pai = path.dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}

/** Grava um arquivo criando os diretorios que faltarem. */
export function gravar(destino: string, conteudo: string): void {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo, 'utf8');
}

/** Le JSON tipado, com erro claro quando o arquivo esta corrompido. */
export function lerJson<T>(caminho: string): T {
  const bruto = fs.readFileSync(caminho, 'utf8');
  try {
    return JSON.parse(bruto) as T;
  } catch (e) {
    throw new Error(`JSON invalido em ${caminho}: ${(e as Error).message}`);
  }
}

/** Grava JSON identado e com quebra de linha final. */
export function gravarJson(caminho: string, valor: unknown): void {
  gravar(caminho, JSON.stringify(valor, null, 2) + '\n');
}

/**
 * Le um armazem JSONL append-only em que a ULTIMA gravacao de um id vence.
 *
 * E o formato de `claims.jsonl` (bloco B1) e do board de divida (bloco B5): a correcao nao
 * apaga a linha errada, ela grava a versao nova por cima. Linha corrompida e ignorada sem
 * invalidar as demais, porque um caractere quebrado no meio do arquivo nao pode apagar o
 * historico inteiro. A ordenacao e numerica por id (`C2` antes de `C10`).
 */
export function lerJsonl<T extends { id: string }>(caminho: string): T[] {
  if (!fs.existsSync(caminho)) return [];
  const porId = new Map<string, T>();
  for (const linha of fs.readFileSync(caminho, 'utf8').split('\n')) {
    if (linha.trim() === '') continue;
    try {
      const item = JSON.parse(linha) as T;
      porId.set(item.id, item);
    } catch {
      /* linha corrompida nao invalida as demais */
    }
  }
  return [...porId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** Anexa um registro ao armazem JSONL, criando o diretorio que faltar. */
export function anexarJsonl(caminho: string, valor: unknown): void {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.appendFileSync(caminho, JSON.stringify(valor) + '\n', 'utf8');
}

/** Proximo id sequencial de um armazem (`C1`, `C2`, ... / `F1`, `F2`, ...). */
export function proximoIdSequencial(ids: string[], prefixo: string): string {
  const regex = new RegExp(`^${prefixo}(\\d+)$`);
  const maior = ids.reduce((max, id) => Math.max(max, Number((id.match(regex) ?? [])[1] ?? 0)), 0);
  return `${prefixo}${maior + 1}`;
}

/** Carimbo de tempo ISO usado em todo o estado em disco. */
export function agora(): string {
  return new Date().toISOString();
}

const SIMBOLOS = { ok: '[ok]  ', warn: '[warn]', fail: '[FAIL]' } as const;

/** Prefixo de nivel usado por `ork doctor` e demais saidas. */
export function simbolo(nivel: 'ok' | 'warn' | 'fail'): string {
  return SIMBOLOS[nivel];
}

/** Monta uma tabela de largura fixa a partir de cabecalho e linhas. */
export function tabela(cabecalho: string[], linhas: string[][]): string {
  const larguras = cabecalho.map((c, i) =>
    Math.max(c.length, ...linhas.map((l) => (l[i] ?? '').length))
  );
  const formatar = (cols: string[]) =>
    '  ' + cols.map((c, i) => (c ?? '').padEnd(larguras[i])).join('  ').trimEnd();
  const saida = [formatar(cabecalho), '  ' + larguras.map((w) => '-'.repeat(w)).join('  ')];
  for (const l of linhas) saida.push(formatar(l));
  return saida.join('\n');
}

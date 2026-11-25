/** O Bash do verify vem de caminhos absolutos controlados, nunca de PATH ou variável do projeto. */
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ShellDoVerify } from './types';

export const CAMINHOS_DO_SHELL_DO_VERIFY = ['/bin/bash', '/usr/bin/bash'] as const;

export class ShellDoVerifyIndisponivel extends Error {
  readonly code = 'ENOENT';
  constructor() {
    super(`shell do verify não encontrado nos caminhos controlados: ${CAMINHOS_DO_SHELL_DO_VERIFY.join(', ')}`);
    this.name = 'ShellDoVerifyIndisponivel';
  }
}

function candidatoSeguro(caminho: string): boolean {
  try {
    const st = fs.lstatSync(caminho);
    return st.isFile() && !st.isSymbolicLink() && (st.mode & 0o022) === 0 && (st.mode & 0o111) !== 0;
  } catch { return false; }
}

export function versaoDoBashValida(versao: string): boolean {
  return /^\d+\.\d+(?:\.\d+)?(?:\([^)]+\))?(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(versao);
}

function medirVersao(caminho: string): string | null {
  const r = spawnSync(caminho, ['--noprofile', '--norc', '-c', 'printf %s "$BASH_VERSION"'], {
    encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const versao = r.status === 0 && !r.error ? r.stdout.trim() : '';
  return versaoDoBashValida(versao) ? versao : null;
}

export interface OpcoesDoShellDoVerify {
  candidatos?: readonly string[];
  seguro?: (caminho: string) => boolean;
  versao?: (caminho: string) => string | null;
}

export function resolverShellDoVerify(opcoes: OpcoesDoShellDoVerify = {}): ShellDoVerify | null {
  const seguro = opcoes.seguro ?? candidatoSeguro;
  const versao = opcoes.versao ?? medirVersao;
  for (const caminho of opcoes.candidatos ?? CAMINHOS_DO_SHELL_DO_VERIFY) {
    if (!caminho.startsWith('/') || !seguro(caminho)) continue;
    const medida = versao(caminho);
    if (medida) return { caminho, versao: medida };
  }
  return null;
}

export function exigirShellDoVerify(shell: ShellDoVerify | null = resolverShellDoVerify()): ShellDoVerify {
  if (!shell) throw new ShellDoVerifyIndisponivel();
  return shell;
}

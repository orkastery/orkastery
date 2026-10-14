/**
 * Chaves, CA e CLI de mentira para os transportes fixados do SHIP. A chave ed25519 e a publica do github.com
 * (estrutura valida para o OpenSSH); a RSA so passa no formato, nunca no ssh-keygen.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SondasDoTransporte } from '../src/mcp-ship-transporte';
import type { ChamadaDaCli } from '../src/forja/executor';

export const CHAVE_ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
/** A impressao que `ssh-keygen -lf -E sha256` mostra para a CHAVE_ED25519 (medida em 13/10/2026). */
export const IMPRESSAO_ED25519 = 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';
export const CHAVE_RSA = 'AAAAB3NzaC1yc2EAAAADAQABAAAAgQC7';
export const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ2FfdGVzdGU=\n-----END CERTIFICATE-----\n';

/** Uma CLI executavel do usuario, sem escrita de grupo ou de outros, para a conferencia do binario. */
export function cliFalsa(dir: string, nome = 'glab'): string {
  const arquivo = path.join(dir, nome);
  fs.writeFileSync(arquivo, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return arquivo;
}

export interface OpcoesDasSondas {
  keyscan?: string; versao?: string; ajuda?: boolean; login?: boolean; binario?: string | null; knownHosts?: string | null;
  /** O que o `auth status` imprime (o gh com porta so vale com a linha do host exato). */
  saidaDoLogin?: string;
  /** Os known_hosts do sistema (so revogacoes); nos testes, nunca o `/etc` de verdade. */
  globais?: string[];
}
export interface SondasRegistradas extends SondasDoTransporte {
  chamadas: { binario: string; args: readonly string[] }[];
  logins: ChamadaDaCli[];
}

/** Sem rede nem CLI de verdade; registram cada chamada. A ajuda responde com `git-credential` salvo `ajuda: false`. */
export function sondasFalsas(o: OpcoesDasSondas = {}): SondasRegistradas {
  const chamadas: SondasRegistradas['chamadas'] = [], logins: ChamadaDaCli[] = [];
  return {
    chamadas, logins,
    rodar: (binario, args) => {
      chamadas.push({ binario, args: [...args] });
      if (binario === 'ssh-keyscan') return { status: 0, stdout: o.keyscan ?? '', stderr: '' };
      if (args[0] === '--version') return { status: 0, stdout: o.versao ?? 'glab 1.121.0 (abc123)\n', stderr: '' };
      if (args.join(' ') === 'auth git-credential --help') {
        return o.ajuda === false ? { status: 1, stdout: '', stderr: 'unknown command "git-credential"' }
          : { status: 0, stdout: 'Usage: auth git-credential [flags]\n', stderr: '' };
      }
      return { status: 127, stdout: '', stderr: 'chamada inesperada' };
    },
    rodarCli: (c) => { logins.push(c); return { status: o.login === false ? 1 : 0, stdout: o.saidaDoLogin ?? '', stderr: '', sinal: null }; },
    acharBinario: () => o.binario ?? null,
    sondas: {},
    knownHostsDoUsuario: o.knownHosts ?? null,
    knownHostsDoSistema: o.globais ?? [],
  };
}

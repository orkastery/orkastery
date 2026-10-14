/**
 * Chaves, CA e CLI de mentira para os transportes fixados do SHIP. A chave ed25519 e a publica do github.com
 * (estrutura valida para o OpenSSH); a RSA so passa no formato, nunca no ssh-keygen.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

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

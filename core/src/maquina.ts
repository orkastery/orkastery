/**
 * I-51 (RM-047): esta maquina na fabrica.
 *
 * O nome e a adesao a fabrica compartilhada sao da MAQUINA, nao do projeto: o repositorio vai a
 * outras pessoas, e o clone de um contribuidor nao pode sair publicando estado no remoto. Por isso
 * os dois moram num arquivo do usuario, `~/.orkastery/maquina.json` (contrato `ork.maquina/v1`),
 * gravado por `ork fabrica entrar`. Arquivo e nao variavel de ambiente porque o cron e os gateways
 * nao carregam o perfil do shell, e a mesma maquina apareceria com dois nomes.
 *
 * Precedencia do nome: `--maquina`, `ORK_MAQUINA`, o arquivo, o hostname.
 * Precedencia da adesao: `ORK_FABRICA_COMPARTILHADA` (1 liga, 0 desliga), senao o manifesto do
 * projeto (`fabrica.compartilhada`, para o time que quer em todas as maquinas) ou o arquivo.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CONTRATO_CONFIG_DA_MAQUINA = 'ork.maquina/v1' as const;
const ARQUIVO = 'maquina.json';

export interface ConfigDaMaquina {
  contrato: typeof CONTRATO_CONFIG_DA_MAQUINA;
  nome: string | null;
  fabricaCompartilhada: boolean;
  atualizadoEm: string;
}

/** A pasta do usuario (`~/.orkastery`). `ORK_USUARIO_DIR` isola testes e `ork eval`. */
export function pastaDoUsuario(): string {
  return (process.env.ORK_USUARIO_DIR ?? '').trim() || path.join(os.homedir(), '.orkastery');
}

export function lerConfigDaMaquina(): ConfigDaMaquina | null {
  try {
    const bruto = JSON.parse(fs.readFileSync(path.join(pastaDoUsuario(), ARQUIVO), 'utf8')) as ConfigDaMaquina;
    if (bruto.contrato !== CONTRATO_CONFIG_DA_MAQUINA) return null;
    return { ...bruto, nome: typeof bruto.nome === 'string' && bruto.nome.trim() ? bruto.nome.trim() : null,
      fabricaCompartilhada: bruto.fabricaCompartilhada === true };
  } catch { return null; }
}

export function gravarConfigDaMaquina(mudanca: { nome?: string | null; fabricaCompartilhada?: boolean }): ConfigDaMaquina {
  const atual = lerConfigDaMaquina();
  const nome = mudanca.nome !== undefined ? (mudanca.nome ?? '').trim() || null : atual?.nome ?? null;
  if (nome !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(nome)) {
    throw new Error(`fabrica.maquina: nome de maquina invalido ("${nome}"); use letras, numeros, ponto, _ ou -`);
  }
  const config: ConfigDaMaquina = { contrato: CONTRATO_CONFIG_DA_MAQUINA, nome,
    fabricaCompartilhada: mudanca.fabricaCompartilhada ?? atual?.fabricaCompartilhada ?? false, atualizadoEm: new Date().toISOString() };
  const dir = pastaDoUsuario();
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${ARQUIVO}.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(temp, path.join(dir, ARQUIVO));
  return config;
}

export function nomeDaMaquina(explicito?: string | null): string {
  return (explicito ?? '').trim() || (process.env.ORK_MAQUINA ?? '').trim() || lerConfigDaMaquina()?.nome || os.hostname();
}

/** Esta maquina publica o estado da fabrica deste projeto? */
export function fabricaCompartilhada(manifesto: { fabrica?: { compartilhada?: boolean } }): boolean {
  const env = (process.env.ORK_FABRICA_COMPARTILHADA ?? '').trim();
  if (env === '1') return true;
  if (env === '0') return false;
  return manifesto.fabrica?.compartilhada === true || lerConfigDaMaquina()?.fabricaCompartilhada === true;
}

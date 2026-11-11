/** RM-090 F1: adesão privada da pessoa/máquina à telemetria. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pastaDoUsuario } from './maquina';

export const CONTRATO_CONFIG_TELEMETRIA = 'ork.telemetria-config/v1' as const;
export const ARQUIVO_CONFIG_TELEMETRIA = 'telemetria.json' as const;

export interface ConfigTelemetria {
  contrato: typeof CONTRATO_CONFIG_TELEMETRIA;
  enabled: boolean;
  pseudonimo: string;
  origem: 'builder';
}

/** Fronteira declarada para a RM-089. A F1 não lê nem constrói essa fonte. */
export interface FonteEmpresaTelemetria {
  enabled: boolean;
  motivo: string;
}

export interface ResolucaoTelemetria {
  ligada: boolean;
  origem: 'empresa' | 'builder' | 'ausente';
  motivo: string;
  pseudonimo: string | null;
}

export function caminhoConfigTelemetria(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(pastaDoUsuario(env), ARQUIVO_CONFIG_TELEMETRIA);
}

function validar(bruto: unknown): ConfigTelemetria {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new Error('telemetria.config: raiz inválida');
  const o = bruto as Record<string, unknown>;
  const extras = Object.keys(o).filter((k) => !['contrato', 'enabled', 'pseudonimo', 'origem'].includes(k));
  if (extras.length || o.contrato !== CONTRATO_CONFIG_TELEMETRIA || typeof o.enabled !== 'boolean' ||
      o.origem !== 'builder' || typeof o.pseudonimo !== 'string' || !/^[a-f0-9]{64}$/.test(o.pseudonimo)) {
    throw new Error(`telemetria.config: arquivo fora do contrato ${CONTRATO_CONFIG_TELEMETRIA}`);
  }
  return o as unknown as ConfigTelemetria;
}

/** Ausência é desligada; arquivo presente mas inseguro ou inválido falha fechado. */
export function lerConfigTelemetria(env: NodeJS.ProcessEnv = process.env): ConfigTelemetria | null {
  const arquivo = caminhoConfigTelemetria(env);
  let fd: number | null = null;
  try {
    const antes = fs.lstatSync(arquivo);
    if (antes.isSymbolicLink() || !antes.isFile()) throw new Error('telemetria.config: arquivo inseguro');
    fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd), uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!st.isFile() || (uid !== null && st.uid !== uid) || (st.mode & 0o777) !== 0o600) {
      throw new Error('telemetria.config: arquivo inseguro');
    }
    return validar(JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (e instanceof SyntaxError) throw new Error(`telemetria.config: arquivo fora do contrato ${CONTRATO_CONFIG_TELEMETRIA}`);
    throw e;
  } finally { if (fd !== null) fs.closeSync(fd); }
}

function fsyncPasta(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function gravarAtivacaoTelemetria(enabled: boolean, env: NodeJS.ProcessEnv = process.env,
  gerarPseudonimo: () => string = () => randomBytes(32).toString('hex')): ConfigTelemetria {
  const atual = lerConfigTelemetria(env);
  const pseudonimo = atual?.pseudonimo ?? gerarPseudonimo();
  if (!/^[a-f0-9]{64}$/.test(pseudonimo)) throw new Error('telemetria.config: pseudônimo inválido');
  const valor: ConfigTelemetria = { contrato: CONTRATO_CONFIG_TELEMETRIA, enabled, pseudonimo, origem: 'builder' };
  const arquivo = caminhoConfigTelemetria(env), dir = path.dirname(arquivo);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const temp = path.join(dir, `.${ARQUIVO_CONFIG_TELEMETRIA}.${process.pid}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(valor, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, arquivo);
  fs.chmodSync(arquivo, 0o600);
  fsyncPasta(dir);
  return valor;
}

/** Empresa, quando fornecida no futuro, vence o opt-in do builder. */
export function resolverAtivacaoTelemetria(builder: ConfigTelemetria | null,
  empresa?: FonteEmpresaTelemetria | null): ResolucaoTelemetria {
  if (empresa) return { ligada: empresa.enabled, origem: 'empresa', motivo: empresa.motivo,
    pseudonimo: builder?.pseudonimo ?? null };
  if (builder) return { ligada: builder.enabled, origem: 'builder',
    motivo: builder.enabled ? 'ativada pelo builder' : 'desativada pelo builder', pseudonimo: builder.pseudonimo };
  return { ligada: false, origem: 'ausente', motivo: 'configuração privada ausente', pseudonimo: null };
}

/** Resolve somente a fonte que a F1 implementa; não consulta política empresarial. */
export function ativacaoTelemetria(env: NodeJS.ProcessEnv = process.env): ResolucaoTelemetria {
  return resolverAtivacaoTelemetria(lerConfigTelemetria(env));
}

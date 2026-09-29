/**
 * RM-053 (D2, D9): a adesao desta maquina a rede da pessoa, e o disparo em segundo plano.
 *
 * Modulo leve de proposito, como a `fabrica-publicar`: quem publica em segundo plano (thread nova,
 * despacho de fase, entrega) chega aqui por ela e nao pode arrastar o retrato nem a forja.
 *
 * A adesao e da MAQUINA, em `~/.orkastery/rede.json` (contrato `ork.rede/v1`), gravado por
 * `ork network entrar` e `ork network sair`. Sem esse arquivo, a maquina que ja fez
 * `ork fabrica entrar` (`fabricaCompartilhada: true` em `maquina.json`) e membro HERDADO: entra na
 * rede sem refazer nada. `ork network sair` grava `membro: false`, que vence a heranca. O manifesto
 * do projeto nao conta: um time nao inscreve a maquina de ninguem na rede pessoal.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerConfigDaMaquina, pastaDoUsuario } from './maquina';

export const CONTRATO_DA_ADESAO = 'ork.rede/v1' as const;
export const REPOSITORIO_PADRAO = 'orkastery-network';
/** D9: no maximo uma tentativa de publicacao em segundo plano (evento ou batida) a cada 15 minutos. */
export const TETO_DE_TENTATIVA_MS = 15 * 60 * 1000;

export type Adesao = 'rede' | 'fabrica';

export interface ConfigDaRede {
  contrato: typeof CONTRATO_DA_ADESAO;
  membro: boolean;
  forja: 'github' | 'gitlab' | null;
  host: string | null;
  dono: string | null;
  repositorio: string | null;
  atualizadoEm: string;
}

export interface EstadoDaAdesao {
  membro: boolean;
  /** `rede`: entrou pelo `ork network entrar`; `fabrica`: herdada do `ork fabrica entrar`. */
  adesao: Adesao | null;
  config: ConfigDaRede | null;
}

/** `~/.orkastery/rede`: o cache bare da casa, as marcas e o log da rede. */
export const pastaDaRede = (): string => path.join(pastaDoUsuario(), 'rede');
const arquivoDaConfig = (): string => path.join(pastaDoUsuario(), 'rede.json');
const arquivoDaTentativa = (): string => path.join(pastaDaRede(), 'tentativa.json');

const IDENTIFICADOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;
const texto = (v: unknown, padrao: RegExp): string | null => typeof v === 'string' && padrao.test(v) ? v : null;

export function lerConfigDaRede(): ConfigDaRede | null {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivoDaConfig(), 'utf8')) as Record<string, unknown>;
    if (!bruto || bruto.contrato !== CONTRATO_DA_ADESAO || typeof bruto.membro !== 'boolean') return null;
    return {
      contrato: CONTRATO_DA_ADESAO, membro: bruto.membro,
      forja: bruto.forja === 'github' || bruto.forja === 'gitlab' ? bruto.forja : null,
      host: texto(bruto.host, HOST), dono: texto(bruto.dono, IDENTIFICADOR), repositorio: texto(bruto.repositorio, IDENTIFICADOR),
      atualizadoEm: typeof bruto.atualizadoEm === 'string' ? bruto.atualizadoEm : '',
    };
  } catch { return null; }
}

/** Grava a adesao (troca atomica). Campo ausente na mudanca fica como estava. */
export function gravarConfigDaRede(mudanca: Partial<Omit<ConfigDaRede, 'contrato' | 'atualizadoEm'>>): ConfigDaRede {
  const atual = lerConfigDaRede();
  const config: ConfigDaRede = {
    contrato: CONTRATO_DA_ADESAO,
    membro: mudanca.membro ?? atual?.membro ?? false,
    forja: mudanca.forja !== undefined ? mudanca.forja : atual?.forja ?? null,
    host: mudanca.host !== undefined ? mudanca.host : atual?.host ?? null,
    dono: mudanca.dono !== undefined ? mudanca.dono : atual?.dono ?? null,
    repositorio: mudanca.repositorio !== undefined ? mudanca.repositorio : atual?.repositorio ?? null,
    atualizadoEm: new Date().toISOString(),
  };
  if (config.host !== null && !HOST.test(config.host)) throw new Error(`rede.config: host invalido ("${config.host}")`);
  for (const [campo, valor] of [['dono', config.dono], ['repositorio', config.repositorio]] as const) {
    if (valor !== null && !IDENTIFICADOR.test(valor)) throw new Error(`rede.config: ${campo} invalido ("${valor}")`);
  }
  const dir = pastaDoUsuario();
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.rede.json.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, arquivoDaConfig());
  return config;
}

/** Esta maquina esta na rede? Explicita pelo `rede.json`, senao herdada da fabrica. */
export function adesaoDaRede(): EstadoDaAdesao {
  const config = lerConfigDaRede();
  if (config) return { membro: config.membro, adesao: config.membro ? 'rede' : null, config };
  const herdada = lerConfigDaMaquina()?.fabricaCompartilhada === true;
  return { membro: herdada, adesao: herdada ? 'fabrica' : null, config: null };
}

/** Publicacao automatica desligada pelo ambiente (testes, `ork eval`, demo). */
export function publicacaoDesligada(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORK_REDE_PUBLICAR === '0' || env.ORK_FABRICA_PUBLICAR === '0';
}

/**
 * D9: toma a vez de tentar publicar, no maximo uma a cada 15 minutos por maquina. Devolve `false`
 * quando a ultima tentativa (evento ou batida) foi ha menos que isso; a marca e gravada antes da
 * tentativa, para duas batidas simultaneas nao dispararem juntas.
 */
export function tomarVezDePublicar(agora: number = Date.now()): boolean {
  try {
    const ultima = Date.parse((JSON.parse(fs.readFileSync(arquivoDaTentativa(), 'utf8')) as { em?: string }).em ?? '');
    if (Number.isFinite(ultima) && agora - ultima < TETO_DE_TENTATIVA_MS && agora >= ultima) return false;
  } catch { /* primeira vez, ou marca ilegivel: tenta */ }
  try {
    fs.mkdirSync(pastaDaRede(), { recursive: true });
    fs.writeFileSync(arquivoDaTentativa(), JSON.stringify({ em: new Date(agora).toISOString() }) + '\n', { mode: 0o600 });
  } catch { return false; }
  return true;
}

/**
 * Evento de thread (criada, fase despachada, entregue, fechada): dispara `ork network publicar
 * --silencioso` sem segurar quem chamou. So para membro, so fora do teto, nunca com a publicacao
 * desligada pelo ambiente.
 */
export function publicarRedeEmSegundoPlano(opcoes: { diretorio?: string; cli?: string; env?: NodeJS.ProcessEnv; agora?: number } = {}): boolean {
  const env = opcoes.env ?? process.env;
  if (publicacaoDesligada(env) || !adesaoDaRede().membro) return false;
  const cli = opcoes.cli ?? path.join(__dirname, 'index.js');
  if (!fs.existsSync(cli) || !tomarVezDePublicar(opcoes.agora)) return false;
  try {
    const filho = spawn(process.execPath, [cli, 'network', 'publicar', '--silencioso'],
      { cwd: opcoes.diretorio ?? process.cwd(), detached: true, stdio: 'ignore', env });
    filho.unref();
    return true;
  } catch { return false; }
}

/** Uma linha JSON por publicacao em segundo plano, em `~/.orkastery/rede/rede.log`: quem publica sozinho deixa rastro. */
export function registrarNaRede(registro: Record<string, unknown>): void {
  try {
    fs.mkdirSync(pastaDaRede(), { recursive: true });
    fs.appendFileSync(path.join(pastaDaRede(), 'rede.log'), JSON.stringify({ ts: new Date().toISOString(), ...registro }) + '\n', { mode: 0o600 });
  } catch { /* o log e informativo */ }
}

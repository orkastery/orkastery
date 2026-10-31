/**
 * RM-074: o plano de CPU do grupo do Agile Check.
 *
 * A lane hermetica deixa duas CPUs para a varredura e para a integracao. Cada conteiner recebe uma cota dessa fatia,
 * em vez de enxergar a maquina inteira. Antes de lancar os comandos, o auxiliar do verify mede `/proc/loadavg` e uma
 * janela de `/proc/stat`; sob carga ou steal, as pecas voltam a ordem do Classic e usam uma CPU a menos que a maquina.
 */
import { readFileSync } from 'node:fs';
import { amostraDoProcStat, stealDaJanela } from './steal';

export const ENV_CPUS_DA_LANE = 'ORK_CHECK_CPUS_DA_LANE';
export const ENV_CPUS_DA_LANE_APOS_RESERVA = 'ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA';
export const ENV_SINAL_DA_RESERVA = 'ORK_CHECK_RESERVA_DEVOLVIDA';
export const ENV_CPUS_DOCKER = 'ORK_CHECK_CPUS_DOCKER';
export const RESERVA_DO_GRUPO = 2;
export const LIMIAR_STEAL_DO_AGENDADOR_PCT = 10;
export const JANELA_DA_SONDA_MS = 250;

export interface MedicaoCpuDoGrupo {
  carga1: number | null;
  stealPct: number | null;
}

export interface PlanoCpuDoGrupo {
  cpus: number;
  ordem: 'paralela' | 'classic';
  saturado: boolean;
  motivo: string;
  cpusHermetica: number;
  /** Vagas da hermetica depois que varredura e integracao devolvem a reserva. */
  cpusHermeticaAposReserva: number;
  cpusIntegracao: number;
  cpusDaFatia: number;
  ferramentasDaVarredura: number;
  cpusPorContainer: number;
  medicao: MedicaoCpuDoGrupo;
}

const cpusValidas = (cpus: number): number => Math.max(1, Math.floor(Number.isFinite(cpus) ? cpus : 1));

/** A carga de um minuto de `/proc/loadavg`; entrada invalida ou ausencia nao inventam saturacao. */
export function cargaDoProcLoadavg(conteudo: string | null): number | null {
  if (!conteudo) return null;
  const carga = Number(conteudo.trim().split(/\s+/)[0]);
  return Number.isFinite(carga) && carga >= 0 ? carga : null;
}

function lerProc(arquivo: '/proc/loadavg' | '/proc/stat'): string | null {
  try { return readFileSync(arquivo, 'utf8'); } catch { return null; }
}

/**
 * Mede a maquina dentro do proprio grupo, antes de qualquer comando: a carga nas duas pontas e o steal da janela.
 * A leitura maior da carga impede uma subida durante a sonda de desaparecer na media de um minuto.
 */
export async function medirCpuDoGrupo(janelaMs = JANELA_DA_SONDA_MS): Promise<MedicaoCpuDoGrupo> {
  const statInicial = amostraDoProcStat(lerProc('/proc/stat'));
  const cargaInicial = cargaDoProcLoadavg(lerProc('/proc/loadavg'));
  await new Promise<void>((resolve) => setTimeout(resolve, janelaMs));
  const cargaFinal = cargaDoProcLoadavg(lerProc('/proc/loadavg'));
  const cargas = [cargaInicial, cargaFinal].filter((x): x is number => x !== null);
  return {
    carga1: cargas.length ? Math.max(...cargas) : null,
    stealPct: stealDaJanela(statInicial, amostraDoProcStat(lerProc('/proc/stat'))),
  };
}

/** O plano unico que alimenta concorrencia das lanes, varredura e `docker run --cpus`. */
export function planejarCpuDoGrupo(cpusInformadas: number, medicao: MedicaoCpuDoGrupo): PlanoCpuDoGrupo {
  const cpus = cpusValidas(cpusInformadas);
  const classic = Math.max(1, cpus - 1);
  const motivos: string[] = [];
  if (cpus < 3) motivos.push(`${cpus} CPU(s), sem duas CPUs livres para o grupo paralelo`);
  if (medicao.carga1 !== null && medicao.carga1 >= classic) motivos.push(`carga ${medicao.carga1} em /proc/loadavg (limiar ${classic})`);
  if (medicao.stealPct !== null && medicao.stealPct >= LIMIAR_STEAL_DO_AGENDADOR_PCT) {
    motivos.push(`steal ${medicao.stealPct}% em /proc/stat (limiar ${LIMIAR_STEAL_DO_AGENDADOR_PCT}%)`);
  }
  const saturado = motivos.length > 0;
  const fatia = saturado ? classic : Math.min(RESERVA_DO_GRUPO, cpus - 1);
  const ferramentas = Math.max(1, Math.floor(fatia));
  return {
    cpus,
    ordem: saturado ? 'classic' : 'paralela',
    saturado,
    motivo: motivos.join('; ') || `carga e steal abaixo dos limiares; ${fatia} CPU(s) reservadas ao grupo`,
    cpusHermetica: saturado ? classic : Math.max(1, cpus - fatia),
    cpusHermeticaAposReserva: saturado ? classic : cpus,
    cpusIntegracao: ferramentas,
    cpusDaFatia: fatia,
    ferramentasDaVarredura: ferramentas,
    cpusPorContainer: Math.max(0.01, Math.floor((fatia / ferramentas) * 100) / 100),
    medicao,
  };
}

/** Modelo deterministico da parede de tres cargas presas em CPU, usado pela regressao do plano. */
export interface TrabalhoCpuSintetico { hermetica: number; varredura: number; integracao: number }

export function paredeClassicaSimulada(cpus: number, trabalho: TrabalhoCpuSintetico): number {
  const concorrencia = Math.max(1, cpusValidas(cpus) - 1);
  return (trabalho.hermetica + trabalho.varredura + trabalho.integracao) / concorrencia;
}

export function paredeAgileSimulada(plano: PlanoCpuDoGrupo, trabalho: TrabalhoCpuSintetico): number {
  if (plano.ordem === 'classic') {
    return trabalho.hermetica / plano.cpusHermetica + trabalho.varredura / plano.cpusDaFatia
      + trabalho.integracao / plano.cpusIntegracao;
  }
  const paredeDaReserva = trabalho.varredura / plano.cpusDaFatia + trabalho.integracao / plano.cpusIntegracao;
  const feitoAntesDaDevolucao = Math.min(trabalho.hermetica, paredeDaReserva * plano.cpusHermetica);
  const paredeDaHermetica = feitoAntesDaDevolucao === trabalho.hermetica
    ? trabalho.hermetica / plano.cpusHermetica
    : paredeDaReserva + (trabalho.hermetica - feitoAntesDaDevolucao) / plano.cpusHermeticaAposReserva;
  return Math.max(paredeDaHermetica, paredeDaReserva);
}

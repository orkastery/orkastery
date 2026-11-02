/**
 * RM-074: o plano de CPU do grupo do Agile Check.
 *
 * A lane hermetica deixa duas CPUs para a varredura e para a integracao. Cada conteiner recebe uma cota dessa fatia,
 * em vez de enxergar a maquina inteira. Antes de lancar os comandos, o auxiliar do verify mede `/proc/loadavg` e
 * varias janelas curtas de `/proc/stat`. A mediana ignora um pico isolado. Steal acima do limiar reduz a capacidade do
 * plano em degraus; a ordem do Classic, com a paralelizacao do Classic, so volta quando nao cabem as tres CPUs
 * estruturais do grupo paralelo ou quando a carga ocupa quase a maquina inteira.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { amostraDoProcStat, stealDaJanela } from './steal';

export const ENV_CPUS_DA_LANE = 'ORK_CHECK_CPUS_DA_LANE';
/** RM-081 F4: contrato publico com a quantidade inteira de workers disponivel ao runner. */
export const ENV_WORKERS = 'ORK_WORKERS';
export const ENV_CPUS_DA_LANE_APOS_VARREDURA = 'ORK_CHECK_CPUS_DA_LANE_APOS_VARREDURA';
export const ENV_CPUS_DA_LANE_APOS_RESERVA = 'ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA';
export const ENV_SINAL_DA_RESERVA = 'ORK_CHECK_RESERVA_DEVOLVIDA';
export const ENV_CPUS_DOCKER = 'ORK_CHECK_CPUS_DOCKER';
/** Registro privado da rodada: quem sobe um container na lane anota o nome para a sonda de CPU. */
export const ENV_CONTAINERS_DA_LANE = 'ORK_CHECK_CONTAINERS_DA_LANE';
export const RESERVA_DO_GRUPO = 2;
export const MINIMO_ESTRUTURAL_DO_GRUPO = RESERVA_DO_GRUPO + 1;
/** Abaixo dele o steal nao desconta capacidade (como na M7); acima, a M8 desconta a fracao medida, sem corte tudo ou nada. */
export const LIMIAR_STEAL_DO_AGENDADOR_PCT = 10;
export const JANELA_DA_SONDA_MS = 250;
export const AMOSTRAS_DA_SONDA = 5;

export interface MedicaoCpuDoGrupo {
  carga1: number | null;
  stealPct: number | null;
  /** Leituras que produziram as medianas; seguem no plano para explicar a decisao. */
  amostrasCarga1?: number[];
  amostrasStealPct?: number[];
  /** Reserva conservadora aprendida de uma medicao completa e compativel da integracao. */
  cpusIntegracao?: number | null;
  fonteCpusIntegracao?: 'medida' | 'conservadora';
}

export interface MedicaoCpuDaIntegracao {
  arvoreMs: number;
  containersMs: number;
  totalMs: number;
  paredeMs: number;
  picoCpus: number | null;
  completa: boolean;
  containers: string[];
  ausentes: string[];
  /** Explica por que cada conteiner registrado nao entrou na medicao, sem esconder a lacuna no perfil. */
  motivosDosAusentes: Array<{ container: string; motivo: string }>;
  /** Uma conta acima da capacidade fisica invalida o perfil, em vez de ensinar uma reserva impossivel. */
  anomalia: string | null;
}

export interface PlanoCpuDoGrupo {
  cpus: number;
  ordem: 'paralela' | 'classic';
  estado: 'agile' | 'degradado' | 'fallback';
  /** Capacidade inteira depois de descontar steal e carga de fora. */
  capacidadeEfetiva: number;
  saturado: boolean;
  motivo: string;
  cpusHermetica: number;
  /** Vagas depois que a varredura termina e resta somente a reserva medida da integracao. */
  cpusHermeticaAposVarredura: number;
  /** Vagas da hermetica depois que varredura e integracao devolvem a reserva. */
  cpusHermeticaAposReserva: number;
  cpusIntegracao: number;
  fonteCpusIntegracao: 'medida' | 'conservadora' | 'classic';
  /** Só vale com perfil completo e compatível; a primeira rodada preserva a cadeia. */
  integracaoEmParalelo: boolean;
  cpusDaFatia: number;
  ferramentasDaVarredura: number;
  cpusPorContainer: number;
  medicao: MedicaoCpuDoGrupo;
  /** Preenchida pelo auxiliar depois que a lane termina; nao participa do plano da propria rodada. */
  medicaoCpuIntegracao?: MedicaoCpuDaIntegracao;
}

/** Registra o container antes do `docker run`; falha de evidencia nunca impede a ferramenta de rodar. */
export function registrarContainerDaLane(nome: string, ambiente: NodeJS.ProcessEnv = process.env): void {
  const arquivo = ambiente[ENV_CONTAINERS_DA_LANE];
  if (!arquivo || !nome) return;
  try { appendFileSync(arquivo, JSON.stringify({ nome, em: new Date().toISOString() }) + '\n', { mode: 0o600 }); }
  catch { /* a medicao fica incompleta e o agendador conserva a reserva */ }
}

/** Reserva publicada para runners: entrada invalida, fracionaria ou zero nunca produz menos de um worker. */
export function workersDaReserva(cpus: number): number {
  return Math.max(1, Math.floor(Number.isFinite(cpus) ? cpus : 1));
}

const cpusValidas = workersDaReserva;

/** A carga de um minuto de `/proc/loadavg`; entrada invalida ou ausencia nao inventam saturacao. */
export function cargaDoProcLoadavg(conteudo: string | null): number | null {
  if (!conteudo) return null;
  const carga = Number(conteudo.trim().split(/\s+/)[0]);
  return Number.isFinite(carga) && carga >= 0 ? carga : null;
}

function lerProc(arquivo: '/proc/loadavg' | '/proc/stat'): string | null {
  try { return readFileSync(arquivo, 'utf8'); } catch { return null; }
}

/** Mediana das amostras validas; quantidade par usa o ponto medio. */
export function mediana(amostras: readonly number[]): number | null {
  const validas = amostras.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (validas.length === 0) return null;
  const meio = Math.floor(validas.length / 2);
  return validas.length % 2 ? validas[meio] : (validas[meio - 1] + validas[meio]) / 2;
}

/** Fecha as amostras da sonda nas duas medianas que alimentam o plano. */
export function resumirMedicaoCpuDoGrupo(amostrasCarga1: readonly number[], amostrasStealPct: readonly number[]): MedicaoCpuDoGrupo {
  const cargas = amostrasCarga1.filter((x) => Number.isFinite(x) && x >= 0);
  const steals = amostrasStealPct.filter((x) => Number.isFinite(x) && x >= 0);
  return { carga1: mediana(cargas), stealPct: mediana(steals), amostrasCarga1: cargas, amostrasStealPct: steals };
}

/**
 * Mede a maquina dentro do proprio grupo, antes de qualquer comando. A janela total continua curta, mas e dividida em
 * amostras de carga e steal; a mediana deixa um unico pico registrado sem entregar a decisao a ele.
 */
export async function medirCpuDoGrupo(janelaMs = JANELA_DA_SONDA_MS): Promise<MedicaoCpuDoGrupo> {
  const cargas: number[] = [];
  const steals: number[] = [];
  let statAnterior = amostraDoProcStat(lerProc('/proc/stat'));
  const intervaloMs = janelaMs / AMOSTRAS_DA_SONDA;
  for (let i = 0; i < AMOSTRAS_DA_SONDA; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervaloMs));
    const carga = cargaDoProcLoadavg(lerProc('/proc/loadavg'));
    if (carga !== null) cargas.push(carga);
    const statAtual = amostraDoProcStat(lerProc('/proc/stat'));
    const steal = stealDaJanela(statAnterior, statAtual);
    if (steal !== null) steals.push(steal);
    statAnterior = statAtual;
  }
  return resumirMedicaoCpuDoGrupo(cargas, steals);
}

/** O plano unico que alimenta concorrencia das lanes, varredura e `docker run --cpus`. */
export function planejarCpuDoGrupo(cpusInformadas: number, medicao: MedicaoCpuDoGrupo): PlanoCpuDoGrupo {
  const cpus = cpusValidas(cpusInformadas);
  const steal = Math.min(100, Math.max(0, medicao.stealPct ?? 0));
  // So o steal desconta capacidade. A carga de um minuto do /proc/loadavg inclui o build do proprio verify e a rodada
  // anterior; descontada, tiraria CPUs de maquina quieta. A carga segue a regra anterior: ordem do Classic perto da
  // maquina inteira ocupada.
  const descontoDeSteal = steal >= LIMIAR_STEAL_DO_AGENDADOR_PCT ? steal / 100 : 0;
  const capacidadeEfetiva = Math.max(1, Math.min(cpus, Math.round(cpus * (1 - descontoDeSteal))));
  const classic = Math.max(1, cpus - 1);
  const motivos: string[] = [];
  if (cpus < MINIMO_ESTRUTURAL_DO_GRUPO) motivos.push(`${cpus} CPU(s), sem duas CPUs livres para o grupo paralelo`);
  else if (capacidadeEfetiva < MINIMO_ESTRUTURAL_DO_GRUPO) {
    motivos.push(`capacidade efetiva ${capacidadeEfetiva}/${cpus} CPU(s), abaixo do minimo estrutural ${MINIMO_ESTRUTURAL_DO_GRUPO}`);
  }
  if (medicao.carga1 !== null && medicao.carga1 >= classic) motivos.push(`carga ${medicao.carga1} em /proc/loadavg (limiar ${classic})`);
  const saturado = motivos.length > 0;
  const estado: PlanoCpuDoGrupo['estado'] = saturado ? 'fallback' : capacidadeEfetiva < cpus ? 'degradado' : 'agile';
  const fatia = saturado ? classic : Math.min(RESERVA_DO_GRUPO, capacidadeEfetiva - 1);
  const ferramentas = Math.max(1, Math.floor(fatia));
  const medida = medicao.cpusIntegracao;
  const cpusIntegracao = saturado ? ferramentas : Math.max(1, Math.min(ferramentas,
    Number.isFinite(medida) && (medida as number) > 0 ? Math.ceil(medida as number) : ferramentas));
  const medidaCompativel = medicao.fonteCpusIntegracao === 'medida' && medida !== null && medida !== undefined;
  const integracaoEmParalelo = !saturado && medidaCompativel && capacidadeEfetiva - fatia - cpusIntegracao >= 1;
  const amostras = (xs: number[] | undefined, resumo: number | null): string =>
    `[${(xs?.length ? xs : resumo === null ? [] : [resumo]).join(', ')}]`;
  const evidencia = `carga em /proc/loadavg: amostras ${amostras(medicao.amostrasCarga1, medicao.carga1)}, mediana ` +
    `${medicao.carga1 ?? 'indisponivel'}; steal em /proc/stat: amostras ${amostras(medicao.amostrasStealPct, medicao.stealPct)}, ` +
    `mediana ${medicao.stealPct === null ? 'indisponivel' : `${medicao.stealPct}%`}`;
  const motivo = saturado
    ? `${motivos.join('; ')}; ${evidencia}`
    : `capacidade ${capacidadeEfetiva}/${cpus} CPU(s)${estado === 'degradado' ? ' depois do desconto do steal' : ' inteira'}; ${evidencia}; ` +
      `${fatia} CPU(s) reservadas a varredura; ` +
      (integracaoEmParalelo ? `integracao medida cabe em paralelo com ${cpusIntegracao} CPU(s)` : 'integracao permanece encadeada');
  return {
    cpus,
    ordem: saturado ? 'classic' : 'paralela',
    estado,
    capacidadeEfetiva,
    saturado,
    motivo,
    cpusHermetica: saturado ? classic : Math.max(1, capacidadeEfetiva - fatia - (integracaoEmParalelo ? cpusIntegracao : 0)),
    cpusHermeticaAposVarredura: saturado ? classic : Math.max(1, capacidadeEfetiva - cpusIntegracao),
    cpusHermeticaAposReserva: saturado ? classic : capacidadeEfetiva,
    cpusIntegracao,
    fonteCpusIntegracao: saturado ? 'classic' : medidaCompativel
      ? 'medida' : 'conservadora',
    integracaoEmParalelo,
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
  const paredeVarredura = trabalho.varredura / plano.cpusDaFatia;
  const paredeIntegracao = trabalho.integracao / plano.cpusIntegracao;
  if (plano.integracaoEmParalelo) {
    let instante = 0, restante = trabalho.hermetica, capacidade = plano.cpusHermetica;
    for (const evento of [{ em: paredeVarredura, libera: plano.cpusDaFatia },
      { em: paredeIntegracao, libera: plano.cpusIntegracao }].sort((a, b) => a.em - b.em)) {
      restante = Math.max(0, restante - (evento.em - instante) * capacidade);
      instante = evento.em;
      capacidade += evento.libera;
    }
    return Math.max(paredeVarredura, paredeIntegracao, instante + restante / capacidade);
  }
  const feitoNaVarredura = Math.min(trabalho.hermetica, paredeVarredura * plano.cpusHermetica);
  const restanteAposVarredura = trabalho.hermetica - feitoNaVarredura;
  const feitoNaIntegracao = Math.min(restanteAposVarredura, paredeIntegracao * plano.cpusHermeticaAposVarredura);
  const restanteFinal = restanteAposVarredura - feitoNaIntegracao;
  const paredeDaHermetica = (feitoNaVarredura ? paredeVarredura : 0)
    + (feitoNaIntegracao ? paredeIntegracao : 0) + restanteFinal / plano.cpusHermeticaAposReserva;
  return Math.max(paredeDaHermetica, paredeVarredura + paredeIntegracao);
}

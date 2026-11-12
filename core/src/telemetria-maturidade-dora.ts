/** RM-090 F5: correlação DORA por thread, revisão e IDs explícitos. */
import { CONTRATO_SDLC_ANALYTICS } from './telemetria-maturidade-registro';

export interface RegistroDora {
  eventName: string;
  timestamp: string;
  resource: Record<string, string>;
  attributes: Record<string, string>;
}

export interface ShipEntregue {
  thread: string;
  mergeSha: string;
  pushVerificado: boolean;
  revisaoEm: string;
}

export interface MedidaDora {
  id: 'deployment_frequency' | 'change_lead_time' | 'change_fail_rate'
    | 'failed_deployment_recovery_time' | 'deployment_rework_rate';
  estado: 'confirmado' | 'não confirmado';
  valor: number | null;
  unidade: 'deploys' | 'milissegundos' | 'razao';
  populacao: number;
  lacunas: string[];
}

export interface ResultadoDora {
  contrato: 'ork.sdlc-dora-result/v1';
  medidas: MedidaDora[];
}

interface DeployConfirmado {
  id: string;
  thread: string;
  revision: string;
  timestamp: string;
  service: string;
  namespace: string | null;
  revisaoEm: string;
}

const C = CONTRATO_SDLC_ANALYTICS;

export const CARDINALIDADES_DORA = {
  deployment: 9,
  incidentOpened: 6,
  incidentResolvedMin: 5,
  incidentResolvedMax: 6,
} as const;

const RECURSO_PERMITIDO = new Set<string>([C.atributos.serviceName, C.atributos.serviceNamespace, C.atributos.environment]);
const DEPLOY_OBRIGATORIOS = [C.atributos.uid, C.atributos.threadId, C.atributos.deploymentId,
  C.atributos.deploymentStatus, C.atributos.pipelineName, C.atributos.pipelineRunId,
  C.atributos.pipelineResult, C.atributos.pipelineTaskType, C.atributos.revision] as const;
const INCIDENT_COMUNS = [C.atributos.uid, C.atributos.threadId, C.atributos.incidentId,
  C.atributos.incidentState, C.atributos.incidentDeploymentId] as const;

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b), meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

function medida(id: MedidaDora['id'], unidade: MedidaDora['unidade'], valor: number | null,
  populacao: number, lacunas: Set<string>, invalida = false): MedidaDora {
  const valorSeguro = invalida ? null : valor;
  return { id, estado: valorSeguro === null ? 'não confirmado' : 'confirmado', valor: valorSeguro, unidade, populacao,
    lacunas: [...lacunas].sort() };
}

function chaveDoRegistro(registro: RegistroDora): string {
  return JSON.stringify({ eventName: registro.eventName, timestamp: registro.timestamp,
    resource: Object.fromEntries(Object.entries(registro.resource).sort()),
    attributes: Object.fromEntries(Object.entries(registro.attributes).sort()) });
}

function faltam(registro: Record<string, string>, chaves: readonly string[]): boolean {
  return chaves.some((chave) => !texto(registro[chave]));
}

/** O mesmo schema comportamental usado pelo motor e confrontado com os dois modelos do Collector. */
export function validarFormaDoRegistroDora(registro: RegistroDora): string[] {
  const erros: string[] = [];
  if (faltam(registro.resource, [C.atributos.serviceName, C.atributos.environment])) erros.push('resource_campos_ausentes');
  if (Object.keys(registro.resource).some((chave) => !RECURSO_PERMITIDO.has(chave))) erros.push('resource_campo_desconhecido');
  const permitidosPelaPolitica = new Set<string>([C.atributos.userHash]);

  if (registro.eventName === C.eventos.deployment) {
    if (faltam(registro.attributes, DEPLOY_OBRIGATORIOS)) erros.push('deployment_campos_ausentes');
    const permitidos = new Set<string>([...DEPLOY_OBRIGATORIOS, ...permitidosPelaPolitica]);
    if (Object.keys(registro.attributes).some((chave) => !permitidos.has(chave))) erros.push('deployment_campo_desconhecido');
  } else if (registro.eventName === C.eventos.incident) {
    if (faltam(registro.attributes, INCIDENT_COMUNS)) erros.push('incident_campos_ausentes');
    const estado = texto(registro.attributes[C.atributos.incidentState]);
    const adicionais = estado === C.valores.opened ? ['error.type']
      : estado === C.valores.resolved ? [C.atributos.incidentRecoveryDeploymentId] : [];
    if (estado === C.valores.opened && !texto(registro.attributes['error.type'])) erros.push('error_type_ausente');
    if (estado !== C.valores.opened && estado !== C.valores.resolved) erros.push('incident_state_invalido');
    const permitidos = new Set<string>([...INCIDENT_COMUNS, ...adicionais, ...permitidosPelaPolitica]);
    if (Object.keys(registro.attributes).some((chave) => !permitidos.has(chave))) erros.push('incident_campo_desconhecido');
  } else erros.push('event_name_invalido');
  return [...new Set(erros)];
}

/**
 * O timestamp nunca cria correlação. Ele só é subtraído depois que IDs, thread e revisão confirmam o vínculo.
 */
export function calcularDora(registros: readonly RegistroDora[], ships: readonly ShipEntregue[]): ResultadoDora {
  const shipsPorThread = new Map(ships.filter((ship) => ship.pushVerificado).map((ship) => [ship.thread, ship]));
  const porUid = new Map<string, RegistroDora>(), divergentes = new Set<string>();
  const tiposDivergentes = new Set<'deployment' | 'incident'>();
  const lacunasDeploy = new Set<string>(), lacunasIncidente = new Set<string>();
  let deployInvalido = false, incidenteInvalido = false;

  const invalidarTipo = (registro: RegistroDora): void => {
    if (registro.eventName === C.eventos.deployment) { deployInvalido = true; tiposDivergentes.add('deployment'); }
    else if (registro.eventName === C.eventos.incident) { incidenteInvalido = true; tiposDivergentes.add('incident'); }
    else { deployInvalido = true; incidenteInvalido = true; }
  };

  for (const registro of registros) {
    const uid = texto(registro.attributes[C.atributos.uid]);
    if (!uid) {
      invalidarTipo(registro);
      (registro.eventName === C.eventos.deployment ? lacunasDeploy : lacunasIncidente).add('uid_ausente');
      continue;
    }
    if (divergentes.has(uid)) { invalidarTipo(registro); continue; }
    const anterior = porUid.get(uid);
    if (!anterior) { porUid.set(uid, registro); continue; }
    if (chaveDoRegistro(anterior) !== chaveDoRegistro(registro)) {
      divergentes.add(uid);
      porUid.delete(uid);
      invalidarTipo(anterior);
      invalidarTipo(registro);
    }
  }
  if (tiposDivergentes.has('deployment')) lacunasDeploy.add('uid_divergente');
  if (tiposDivergentes.has('incident')) lacunasIncidente.add('uid_divergente');

  const deployments = new Map<string, DeployConfirmado>();
  const incidentes: RegistroDora[] = [];
  for (const registro of porUid.values()) {
    const erros = validarFormaDoRegistroDora(registro);
    if (erros.length) {
      invalidarTipo(registro);
      const lacunas = registro.eventName === C.eventos.deployment ? lacunasDeploy : lacunasIncidente;
      for (const erro of erros) lacunas.add(erro);
      continue;
    }
    if (registro.eventName === C.eventos.deployment) {
      const a = registro.attributes, r = registro.resource;
      const id = texto(a[C.atributos.deploymentId])!, thread = texto(a[C.atributos.threadId])!;
      const revision = texto(a[C.atributos.revision])!, service = texto(r[C.atributos.serviceName])!;
      const namespace = texto(r[C.atributos.serviceNamespace]);
      if (r[C.atributos.environment] !== C.valores.production
        || a[C.atributos.deploymentStatus] !== C.valores.succeeded
        || a[C.atributos.pipelineResult] !== C.valores.success
        || a[C.atributos.pipelineTaskType] !== C.valores.deploy) {
        lacunasDeploy.add('deployment_nao_confirmado'); deployInvalido = true; continue;
      }
      const ship = shipsPorThread.get(thread);
      if (!ship || ship.mergeSha !== revision) {
        lacunasDeploy.add('thread_ou_revisao_divergente'); deployInvalido = true; continue;
      }
      if (!Number.isFinite(Date.parse(registro.timestamp)) || !Number.isFinite(Date.parse(ship.revisaoEm))) {
        lacunasDeploy.add('timestamp_invalido'); deployInvalido = true; continue;
      }
      deployments.set(id, { id, thread, revision, timestamp: registro.timestamp,
        service, namespace, revisaoEm: ship.revisaoEm });
    } else incidentes.push(registro);
  }

  const abertos = new Map<string, RegistroDora>(), resolvidos = new Map<string, RegistroDora>();
  const deploymentsComFalha = new Set<string>(), recoveryDeployments = new Set<string>();
  for (const registro of incidentes) {
    const a = registro.attributes, r = registro.resource;
    const incidentId = texto(a[C.atributos.incidentId])!, state = texto(a[C.atributos.incidentState])!;
    const deploymentId = texto(a[C.atributos.incidentDeploymentId])!, thread = texto(a[C.atributos.threadId])!;
    const deployment = deployments.get(deploymentId);
    if (!deployment || deployment.thread !== thread || deployment.service !== r[C.atributos.serviceName]
      || deployment.namespace !== texto(r[C.atributos.serviceNamespace])) {
      lacunasIncidente.add('incident_deployment_divergente'); incidenteInvalido = true; continue;
    }
    if (state === C.valores.opened) {
      abertos.set(incidentId, registro);
      deploymentsComFalha.add(deploymentId);
    } else {
      resolvidos.set(incidentId, registro);
      const recovery = texto(a[C.atributos.incidentRecoveryDeploymentId]);
      if (recovery) {
        const deployRecuperacao = deployments.get(recovery);
        if (!deployRecuperacao || deployRecuperacao.thread !== thread) {
          lacunasIncidente.add('recovery_deployment_divergente'); incidenteInvalido = true;
        } else recoveryDeployments.add(recovery);
      }
    }
  }

  const leadTimes = [...deployments.values()].map((deploy) => Date.parse(deploy.timestamp) - Date.parse(deploy.revisaoEm))
    .filter((valor) => valor >= 0);
  if (leadTimes.length !== deployments.size) { lacunasDeploy.add('revisao_posterior_ao_deploy'); deployInvalido = true; }
  const recoveryTimes: number[] = [];
  for (const [id, aberto] of abertos) {
    const resolvido = resolvidos.get(id);
    if (!resolvido) { lacunasIncidente.add('resolucao_ausente'); continue; }
    const duracao = Date.parse(resolvido.timestamp) - Date.parse(aberto.timestamp);
    if (!Number.isFinite(duracao) || duracao < 0) {
      lacunasIncidente.add('ciclo_incidente_invalido'); incidenteInvalido = true;
    } else recoveryTimes.push(duracao);
  }

  const totalDeploys = deployments.size;
  const failureRate = incidentes.length && totalDeploys ? deploymentsComFalha.size / totalDeploys : null;
  const recoveryRate = recoveryDeployments.size && totalDeploys ? recoveryDeployments.size / totalDeploys : null;
  const medidas = [
    medida('deployment_frequency', 'deploys', totalDeploys ? totalDeploys : null, totalDeploys, lacunasDeploy, deployInvalido),
    medida('change_lead_time', 'milissegundos', leadTimes.length === totalDeploys ? mediana(leadTimes) : null,
      totalDeploys, lacunasDeploy, deployInvalido),
    medida('change_fail_rate', 'razao', failureRate, totalDeploys, lacunasIncidente,
      deployInvalido || incidenteInvalido),
    medida('failed_deployment_recovery_time', 'milissegundos',
      recoveryTimes.length && recoveryTimes.length === abertos.size ? mediana(recoveryTimes) : null,
      abertos.size, lacunasIncidente, deployInvalido || incidenteInvalido),
    medida('deployment_rework_rate', 'razao', recoveryRate, totalDeploys, lacunasIncidente,
      deployInvalido || incidenteInvalido),
  ];
  return { contrato: 'ork.sdlc-dora-result/v1', medidas };
}

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

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b), meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

function medida(id: MedidaDora['id'], unidade: MedidaDora['unidade'], valor: number | null,
  populacao: number, lacunas: Set<string>): MedidaDora {
  return { id, estado: valor === null ? 'não confirmado' : 'confirmado', valor, unidade, populacao,
    lacunas: [...lacunas].sort() };
}

function chaveDoRegistro(registro: RegistroDora): string {
  return JSON.stringify({ eventName: registro.eventName, timestamp: registro.timestamp,
    resource: Object.fromEntries(Object.entries(registro.resource).sort()),
    attributes: Object.fromEntries(Object.entries(registro.attributes).sort()) });
}

/**
 * O timestamp nunca cria correlação. Ele só é subtraído depois que IDs, thread e revisão confirmam o vínculo.
 */
export function calcularDora(registros: readonly RegistroDora[], ships: readonly ShipEntregue[]): ResultadoDora {
  const shipsPorThread = new Map(ships.filter((ship) => ship.pushVerificado).map((ship) => [ship.thread, ship]));
  const uids = new Map<string, string>(), divergentes = new Set<string>();
  const deployments = new Map<string, DeployConfirmado>();
  const incidentes: RegistroDora[] = [];
  const lacunasDeploy = new Set<string>(), lacunasIncidente = new Set<string>();

  for (const registro of registros) {
    const uid = texto(registro.attributes[C.atributos.uid]);
    if (!uid) {
      (registro.eventName === C.eventos.deployment ? lacunasDeploy : lacunasIncidente).add('uid_ausente');
      continue;
    }
    const chave = chaveDoRegistro(registro), anterior = uids.get(uid);
    if (anterior) {
      if (anterior !== chave) divergentes.add(uid);
      continue;
    }
    uids.set(uid, chave);
    if (registro.eventName === C.eventos.deployment) {
      const a = registro.attributes, r = registro.resource;
      const id = texto(a[C.atributos.deploymentId]), thread = texto(a[C.atributos.threadId]);
      const revision = texto(a[C.atributos.revision]), service = texto(r[C.atributos.serviceName]);
      const namespace = texto(r[C.atributos.serviceNamespace]);
      const obrigatorios = [id, thread, revision, service, texto(a[C.atributos.pipelineName]),
        texto(a[C.atributos.pipelineRunId])];
      if (obrigatorios.some((item) => item === null)) { lacunasDeploy.add('deployment_campos_ausentes'); continue; }
      if (r[C.atributos.environment] !== C.valores.production
        || a[C.atributos.deploymentStatus] !== C.valores.succeeded
        || a[C.atributos.pipelineResult] !== C.valores.success
        || a[C.atributos.pipelineTaskType] !== C.valores.deploy) {
        lacunasDeploy.add('deployment_nao_confirmado'); continue;
      }
      const ship = shipsPorThread.get(thread!);
      if (!ship || ship.mergeSha !== revision) { lacunasDeploy.add('thread_ou_revisao_divergente'); continue; }
      if (!Number.isFinite(Date.parse(registro.timestamp)) || !Number.isFinite(Date.parse(ship.revisaoEm))) {
        lacunasDeploy.add('timestamp_invalido'); continue;
      }
      deployments.set(id!, { id: id!, thread: thread!, revision: revision!, timestamp: registro.timestamp,
        service: service!, namespace, revisaoEm: ship.revisaoEm });
    } else if (registro.eventName === C.eventos.incident) incidentes.push(registro);
  }
  if (divergentes.size) { lacunasDeploy.add('uid_divergente'); lacunasIncidente.add('uid_divergente'); }

  const abertos = new Map<string, RegistroDora>(), resolvidos = new Map<string, RegistroDora>();
  const deploymentsComFalha = new Set<string>(), recoveryDeployments = new Set<string>();
  for (const registro of incidentes) {
    const a = registro.attributes, r = registro.resource;
    const incidentId = texto(a[C.atributos.incidentId]), state = texto(a[C.atributos.incidentState]);
    const deploymentId = texto(a[C.atributos.incidentDeploymentId]), thread = texto(a[C.atributos.threadId]);
    if (!incidentId || !state || !deploymentId || !thread) { lacunasIncidente.add('incident_campos_ausentes'); continue; }
    const deployment = deployments.get(deploymentId);
    if (!deployment || deployment.thread !== thread || deployment.service !== r[C.atributos.serviceName]
      || deployment.namespace !== texto(r[C.atributos.serviceNamespace])) {
      lacunasIncidente.add('incident_deployment_divergente'); continue;
    }
    if (state === C.valores.opened) {
      if (!texto(a['error.type'])) { lacunasIncidente.add('error_type_ausente'); continue; }
      abertos.set(incidentId, registro); deploymentsComFalha.add(deploymentId);
    } else if (state === C.valores.resolved) {
      resolvidos.set(incidentId, registro);
      const recovery = texto(a[C.atributos.incidentRecoveryDeploymentId]);
      if (recovery) {
        const deployRecuperacao = deployments.get(recovery);
        if (!deployRecuperacao || deployRecuperacao.thread !== thread) lacunasIncidente.add('recovery_deployment_divergente');
        else recoveryDeployments.add(recovery);
      }
    } else lacunasIncidente.add('incident_state_invalido');
  }

  const leadTimes = [...deployments.values()].map((deploy) => Date.parse(deploy.timestamp) - Date.parse(deploy.revisaoEm))
    .filter((valor) => valor >= 0);
  if (leadTimes.length !== deployments.size) lacunasDeploy.add('revisao_posterior_ao_deploy');
  const recoveryTimes: number[] = [];
  for (const [id, aberto] of abertos) {
    const resolvido = resolvidos.get(id);
    if (!resolvido) { lacunasIncidente.add('resolucao_ausente'); continue; }
    const duracao = Date.parse(resolvido.timestamp) - Date.parse(aberto.timestamp);
    if (!Number.isFinite(duracao) || duracao < 0) lacunasIncidente.add('ciclo_incidente_invalido');
    else recoveryTimes.push(duracao);
  }

  const totalDeploys = deployments.size;
  const failureRate = incidentes.length && totalDeploys ? deploymentsComFalha.size / totalDeploys : null;
  const recoveryRate = recoveryDeployments.size && totalDeploys ? recoveryDeployments.size / totalDeploys : null;
  const medidas = [
    medida('deployment_frequency', 'deploys', totalDeploys ? totalDeploys : null, totalDeploys, lacunasDeploy),
    medida('change_lead_time', 'milissegundos', leadTimes.length === totalDeploys ? mediana(leadTimes) : null,
      totalDeploys, lacunasDeploy),
    medida('change_fail_rate', 'razao', failureRate, totalDeploys, lacunasIncidente),
    medida('failed_deployment_recovery_time', 'milissegundos',
      recoveryTimes.length && recoveryTimes.length === abertos.size ? mediana(recoveryTimes) : null,
      abertos.size, lacunasIncidente),
    medida('deployment_rework_rate', 'razao', recoveryRate, totalDeploys, lacunasIncidente),
  ];
  return { contrato: 'ork.sdlc-dora-result/v1', medidas };
}

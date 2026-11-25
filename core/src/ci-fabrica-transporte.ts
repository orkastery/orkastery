/** RM-089 F7: contrato do transporte autenticado e projeção sanitizada para o runner. */
import { CONTRATO_CAPACIDADE_RUNNER_EXCECAO, CONTRATO_PROVA_NOTIFICACAO_EXCECAO,
  validarProvaDaExcecaoNoRunner, type BlocoDaExcecaoNoRunner, type CapacidadeDoRunnerParaExcecao,
  type ProvaProtegidaDaNotificacao } from './excecao-notificacao';
import type { ConfiguracaoPublicaDoTransporteCi, PoliticaDeReciboCi } from './types';

export const CONTRATO_TRANSPORTE_EXCECAO_RUNNER = 'ork.excecao-transporte-runner/v1' as const;
export const CONTRATO_RESULTADO_TRANSPORTE_EXCECAO = 'ork.excecao-transporte-resultado/v1' as const;
export const AUDIENCIA_FABRICA_CI = 'urn:orkastery:fabrica:ci' as const;

export interface TransporteDaExcecaoDoRunner {
  contrato: typeof CONTRATO_TRANSPORTE_EXCECAO_RUNNER;
  proof: ProvaProtegidaDaNotificacao;
  capability: CapacidadeDoRunnerParaExcecao;
}

export type CausaDeConsultaDoTransporte = 'ausente' | 'indisponivel' | 'timeout';
export type CodigoDoTransporteDaExcecao = 'ci.excecao.transporte-invalido'
  | 'ci.recibo.ausente'
  | 'ci.excecao.transporte-indisponivel'
  | 'ci.excecao.transporte-prazo-excedido';

export type RespostaBrutaDoTransporte = { estado: CausaDeConsultaDoTransporte } | TransporteDaExcecaoDoRunner;

export type ResultadoSanitizadoDoTransporte = {
  contrato: typeof CONTRATO_RESULTADO_TRANSPORTE_EXCECAO;
  aplicado: true;
  exception: BlocoDaExcecaoNoRunner;
} | {
  contrato: typeof CONTRATO_RESULTADO_TRANSPORTE_EXCECAO;
  aplicado: false;
  code: CodigoDoTransporteDaExcecao;
  reprova: boolean;
  avisar: boolean;
};

export interface LocalizadoresDoTransporteCi {
  forja: 'github' | 'gitlab';
  project: string;
  source: string;
  target: string;
  head: string;
  operation: 'ci.run';
  execucaoId: string;
  construtor: string;
}

export interface IdentidadeNativaAutenticadaCi {
  forja: 'github' | 'gitlab';
  audiencia: typeof AUDIENCIA_FABRICA_CI;
  execucaoId: string;
  principalNativo: string;
}

export interface FatosReobtidosDaForjaCi extends LocalizadoresDoTransporteCi {
  destinoProtegido: boolean;
  fork: boolean;
  principalNativo: string;
  componenteProtegido: boolean;
}

export interface PortasDoServicoDeTransporteCi {
  autenticar(token: string, audiencia: typeof AUDIENCIA_FABRICA_CI): IdentidadeNativaAutenticadaCi | null;
  reobter(identidade: IdentidadeNativaAutenticadaCi): FatosReobtidosDaForjaCi | null;
  entregar(fatos: FatosReobtidosDaForjaCi): RespostaBrutaDoTransporte;
}

export interface PortaDaIdentidadeNativaCi {
  obter(audiencia: typeof AUDIENCIA_FABRICA_CI): string;
}

export interface PortaDoServicoDaFabricaCi {
  consultar(token: string, localizadores: LocalizadoresDoTransporteCi): RespostaBrutaDoTransporte;
}

const CHAVES_TRANSPORTE = ['contrato', 'proof', 'capability'] as const;
const objeto = (valor: unknown): valor is Record<string, unknown> =>
  !!valor && typeof valor === 'object' && !Array.isArray(valor);
const exatas = (valor: Record<string, unknown>, chaves: readonly string[]): boolean => {
  const lidas = Object.keys(valor).sort(), esperadas = [...chaves].sort();
  return lidas.length === esperadas.length && lidas.every((chave, indice) => chave === esperadas[indice]);
};

export function configuracaoPublicaDoTransporteValida(valor: unknown): valor is ConfiguracaoPublicaDoTransporteCi {
  if (!objeto(valor) || !exatas(valor, ['contrato', 'origem', 'audiencia', 'cliente'])
      || valor.contrato !== CONTRATO_TRANSPORTE_EXCECAO_RUNNER || valor.audiencia !== AUDIENCIA_FABRICA_CI
      || typeof valor.origem !== 'string' || !/^https:\/\/(?![^/]*@)[^\s]+$/.test(valor.origem)
      || !objeto(valor.cliente) || !exatas(valor.cliente, ['versao', 'sha256'])) return false;
  return typeof valor.cliente.versao === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(valor.cliente.versao)
    && typeof valor.cliente.sha256 === 'string' && /^[a-f0-9]{64}$/.test(valor.cliente.sha256);
}

function codigoDaCausa(causa: CausaDeConsultaDoTransporte): CodigoDoTransporteDaExcecao {
  if (causa === 'ausente') return 'ci.recibo.ausente';
  if (causa === 'indisponivel') return 'ci.excecao.transporte-indisponivel';
  return 'ci.excecao.transporte-prazo-excedido';
}

export function projetarResultadoDoTransporte(resposta: unknown, nivel: PoliticaDeReciboCi,
  esperado: { project: string; source: string; target: string; head: string; operation: string },
  agora: string): ResultadoSanitizadoDoTransporte {
  if (objeto(resposta) && exatas(resposta, ['estado'])
      && (resposta.estado === 'ausente' || resposta.estado === 'indisponivel' || resposta.estado === 'timeout')) {
    return { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: false,
      code: codigoDaCausa(resposta.estado), reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
  }
  if (!objeto(resposta) || !exatas(resposta, CHAVES_TRANSPORTE)
      || resposta.contrato !== CONTRATO_TRANSPORTE_EXCECAO_RUNNER || !objeto(resposta.proof)
      || resposta.proof.schema !== CONTRATO_PROVA_NOTIFICACAO_EXCECAO || !objeto(resposta.capability)
      || resposta.capability.schema !== CONTRATO_CAPACIDADE_RUNNER_EXCECAO) {
    return { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: false,
      code: 'ci.excecao.transporte-invalido', reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
  }
  const validado = validarProvaDaExcecaoNoRunner(resposta.proof, resposta.capability, esperado, agora);
  return validado.ok
    ? { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: true, exception: validado.exception }
    : { contrato: CONTRATO_RESULTADO_TRANSPORTE_EXCECAO, aplicado: false,
      code: 'ci.excecao.transporte-invalido', reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
}

/** O serviço usa o pedido só como localizador e autoriza exclusivamente com fatos reobtidos. */
export function atenderTransporteNaFabrica(token: string, localizadores: LocalizadoresDoTransporteCi,
  portas: PortasDoServicoDeTransporteCi): RespostaBrutaDoTransporte {
  let identidade: IdentidadeNativaAutenticadaCi | null, fatos: FatosReobtidosDaForjaCi | null;
  try {
    identidade = portas.autenticar(token, AUDIENCIA_FABRICA_CI);
    fatos = identidade ? portas.reobter(identidade) : null;
  } catch { return { estado: 'indisponivel' }; }
  if (!identidade || !fatos || identidade.audiencia !== AUDIENCIA_FABRICA_CI
      || identidade.forja !== localizadores.forja || identidade.execucaoId !== localizadores.execucaoId
      || fatos.forja !== identidade.forja || fatos.execucaoId !== identidade.execucaoId
      || fatos.principalNativo !== identidade.principalNativo || fatos.principalNativo === fatos.construtor
      || (fatos.forja === 'github' && !/^github-app:\d+$/.test(fatos.principalNativo))
      || fatos.project !== localizadores.project || fatos.source !== localizadores.source
      || fatos.target !== localizadores.target || fatos.head !== localizadores.head
      || fatos.operation !== 'ci.run' || localizadores.operation !== 'ci.run'
      || fatos.fork || !fatos.destinoProtegido || !fatos.componenteProtegido) return { estado: 'ausente' };
  try { return portas.entregar(fatos); }
  catch { return { estado: 'indisponivel' }; }
}

/** Token e resposta bruta vivem somente neste quadro; a API devolve apenas a projeção sanitizada. */
export function executarClienteProtegidoDoTransporte(config: ConfiguracaoPublicaDoTransporteCi,
  localizadores: LocalizadoresDoTransporteCi, nivel: PoliticaDeReciboCi, agora: string,
  identidade: PortaDaIdentidadeNativaCi, fabrica: PortaDoServicoDaFabricaCi): ResultadoSanitizadoDoTransporte {
  if (!configuracaoPublicaDoTransporteValida(config)) {
    return projetarResultadoDoTransporte({}, nivel, localizadores, agora);
  }
  let resposta: RespostaBrutaDoTransporte;
  try {
    const token = identidade.obter(AUDIENCIA_FABRICA_CI);
    resposta = fabrica.consultar(token, localizadores);
  } catch (erro) {
    resposta = (erro as Error).name === 'TimeoutError' ? { estado: 'timeout' } : { estado: 'indisponivel' };
  }
  return projetarResultadoDoTransporte(resposta, nivel, localizadores, agora);
}

async function identidadeOidcDoLauncher(forja: 'github' | 'gitlab', env: NodeJS.ProcessEnv): Promise<string> {
  if (forja === 'gitlab') {
    const token = env.ORK_FABRICA_ID_TOKEN;
    delete env.ORK_FABRICA_ID_TOKEN;
    if (!token) throw new Error('ci.excecao.transporte-identidade-ausente');
    return token;
  }
  const endereco = env.ACTIONS_ID_TOKEN_REQUEST_URL, credencial = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!endereco || !credencial) throw new Error('ci.excecao.transporte-identidade-ausente');
  const url = new URL(endereco);
  url.searchParams.set('audience', AUDIENCIA_FABRICA_CI);
  const resposta = await fetch(url, { headers: { authorization: `bearer ${credencial}` } });
  if (!resposta.ok) throw new Error('ci.excecao.transporte-identidade-invalida');
  const corpo = await resposta.json() as { value?: unknown };
  if (typeof corpo.value !== 'string' || !corpo.value) throw new Error('ci.excecao.transporte-identidade-invalida');
  return corpo.value;
}

function localizadoresDoLauncher(env: NodeJS.ProcessEnv): LocalizadoresDoTransporteCi {
  if (env.GITHUB_ACTIONS === 'true') {
    let evento: { pull_request?: { head?: { sha?: unknown; ref?: unknown }; base?: { ref?: unknown } } } = {};
    try {
      const bruto = env.GITHUB_EVENT_PATH ? require('node:fs').readFileSync(env.GITHUB_EVENT_PATH, 'utf8') : '{}';
      evento = JSON.parse(bruto) as typeof evento;
    } catch { /* os campos ausentes são recusados abaixo */ }
    const head = evento.pull_request?.head?.sha, source = evento.pull_request?.head?.ref;
    const target = evento.pull_request?.base?.ref ?? env.GITHUB_REF_NAME;
    const valores = [env.GITHUB_REPOSITORY, source, target, head, env.GITHUB_RUN_ID, env.GITHUB_ACTOR_ID];
    if (valores.some((valor) => typeof valor !== 'string' || !valor)) throw new Error('ci.excecao.transporte-contexto-ausente');
    return { forja: 'github', project: env.GITHUB_REPOSITORY!, source: source as string, target: target as string,
      head: head as string, operation: 'ci.run', execucaoId: env.GITHUB_RUN_ID!, construtor: env.GITHUB_ACTOR_ID! };
  }
  const valores = [env.CI_PROJECT_PATH, env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
    env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME, env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA, env.CI_JOB_ID, env.GITLAB_USER_ID];
  if (env.GITLAB_CI !== 'true' || valores.some((valor) => typeof valor !== 'string' || !valor)) {
    throw new Error('ci.excecao.transporte-contexto-ausente');
  }
  return { forja: 'gitlab', project: env.CI_PROJECT_PATH!, source: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME!,
    target: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME!, head: env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA!,
    operation: 'ci.run', execucaoId: env.CI_JOB_ID!, construtor: env.GITLAB_USER_ID! };
}

/** Entrada executável do launcher pinado; não recebe token, proof ou capability por argumento. */
export async function executarLauncherNativoDoTransporte(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { exigirManifesto } = await import('./manifest');
  const manifesto = exigirManifesto(process.cwd()).manifesto;
  const config = manifesto.ci.transporte_excecao;
  if (!config || !configuracaoPublicaDoTransporteValida(config)) throw new Error('ci.excecao.transporte-configuracao-ausente');
  const localizadores = localizadoresDoLauncher(env);
  let resultado: ResultadoSanitizadoDoTransporte;
  try {
    const token = await identidadeOidcDoLauncher(localizadores.forja, env);
    const resposta = await fetch(config.origem, { method: 'POST', headers: {
      authorization: `bearer ${token}`, 'content-type': 'application/json', accept: 'application/json',
    }, body: JSON.stringify(localizadores) });
    const bruto = resposta.ok ? await resposta.json() : { estado: resposta.status === 408 ? 'timeout' : 'indisponivel' };
    resultado = projetarResultadoDoTransporte(bruto, manifesto.ci.politica_recibo ?? 'observar', localizadores,
      new Date().toISOString());
  } catch (erro) {
    resultado = projetarResultadoDoTransporte({ estado: (erro as Error).name === 'TimeoutError' ? 'timeout' : 'indisponivel' },
      manifesto.ci.politica_recibo ?? 'observar', localizadores, new Date().toISOString());
  }
  process.stdout.write(`${JSON.stringify(resultado)}\n`);
  return resultado.aplicado || !resultado.reprova ? 0 : 1;
}

if (require.main === module) {
  void executarLauncherNativoDoTransporte().then((codigo) => { process.exitCode = codigo; })
    .catch(() => { process.exitCode = 1; });
}

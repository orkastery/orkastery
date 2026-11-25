/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- A worktree limpa do scanner não instala os tipos nativos; o build estrito continua sendo a autoridade de tipos. */
/** RM-089 F7: contrato do transporte autenticado e projeção sanitizada para o runner. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTRATO_CAPACIDADE_RUNNER_EXCECAO, CONTRATO_PROVA_NOTIFICACAO_EXCECAO,
  validarProvaDaExcecaoNoRunner, type BlocoDaExcecaoNoRunner, type CapacidadeDoRunnerParaExcecao,
  type ProvaProtegidaDaNotificacao } from './excecao-notificacao';
import type { ConfiguracaoPublicaDoTransporteCi, PoliticaDeReciboCi } from './types';
import { principalNativoDoReciboForteCiValido } from './ci-recibo-forte';

export const CONTRATO_TRANSPORTE_EXCECAO_RUNNER = 'ork.excecao-transporte-runner/v1' as const;
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
  aplicado: true;
  exception: BlocoDaExcecaoNoRunner;
} | {
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
    return { aplicado: false,
      code: codigoDaCausa(resposta.estado), reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
  }
  if (!objeto(resposta) || !exatas(resposta, CHAVES_TRANSPORTE)
      || resposta.contrato !== CONTRATO_TRANSPORTE_EXCECAO_RUNNER || !objeto(resposta.proof)
      || resposta.proof.schema !== CONTRATO_PROVA_NOTIFICACAO_EXCECAO || !objeto(resposta.capability)
      || resposta.capability.schema !== CONTRATO_CAPACIDADE_RUNNER_EXCECAO) {
    return { aplicado: false,
      code: 'ci.excecao.transporte-invalido', reprova: nivel === 'exigir', avisar: nivel === 'avisar' };
  }
  const validado = validarProvaDaExcecaoNoRunner(resposta.proof, resposta.capability, esperado, agora);
  return validado.ok
    ? { aplicado: true, exception: validado.exception }
    : { aplicado: false,
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
      || !principalNativoDoReciboForteCiValido(fatos.forja, fatos.principalNativo)
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

export async function identidadeOidcDoLauncher(forja: 'github' | 'gitlab', env: NodeJS.ProcessEnv,
  buscar: typeof fetch = fetch): Promise<string> {
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
  const resposta = await buscar(url, { headers: { authorization: `bearer ${credencial}` } });
  if (!resposta.ok) throw new Error('ci.excecao.transporte-identidade-invalida');
  const corpo = await resposta.json() as { value?: unknown };
  if (typeof corpo.value !== 'string' || !corpo.value) throw new Error('ci.excecao.transporte-identidade-invalida');
  return corpo.value;
}

export function localizadoresDoLauncher(env: NodeJS.ProcessEnv): LocalizadoresDoTransporteCi {
  if (env.GITHUB_ACTIONS === 'true') {
    type PullRequest = { head?: { sha?: unknown; ref?: unknown }; base?: { ref?: unknown; sha?: unknown };
      user?: { id?: unknown } };
    let evento: { pull_request?: PullRequest } = {};
    try {
      const bruto = env.GITHUB_EVENT_PATH ? fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8') : '{}';
      evento = JSON.parse(bruto) as typeof evento;
    } catch { /* os campos ausentes são recusados abaixo */ }
    const pullRequest = evento.pull_request;
    const head = pullRequest?.head?.sha;
    const source = pullRequest?.head?.ref;
    const target = pullRequest?.base?.ref ?? env.GITHUB_REF_NAME;
    const construtor = typeof pullRequest?.user?.id === 'number' || typeof pullRequest?.user?.id === 'string'
      ? String(pullRequest.user.id) : env.GITHUB_ACTOR_ID;
    const valores = [env.GITHUB_REPOSITORY, source, target, head, env.GITHUB_RUN_ID, construtor];
    if (valores.some((valor) => typeof valor !== 'string' || !valor)) throw new Error('ci.excecao.transporte-contexto-ausente');
    return { forja: 'github', project: env.GITHUB_REPOSITORY!, source: source as string, target: target as string,
      head: head as string, operation: 'ci.run', execucaoId: env.GITHUB_RUN_ID!, construtor: construtor as string };
  }
  const head = env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || env.CI_COMMIT_SHA;
  const valores = [env.CI_PROJECT_PATH, env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
    env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME, head, env.CI_JOB_ID, env.GITLAB_USER_ID];
  if (env.GITLAB_CI !== 'true' || valores.some((valor) => typeof valor !== 'string' || !valor)) {
    throw new Error('ci.excecao.transporte-contexto-ausente');
  }
  return { forja: 'gitlab', project: env.CI_PROJECT_PATH!, source: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME!,
    target: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME!, head: head!,
    operation: 'ci.run', execucaoId: env.CI_JOB_ID!, construtor: env.GITLAB_USER_ID! };
}

export interface DependenciasDoLauncherDoTransporte {
  buscar?: typeof fetch;
  agora?: () => string;
  prazoMs?: number;
  executarReplay?: (entrada: { branch: string; raizFonte: string; raizProtegida: string;
    localizadores: LocalizadoresDoTransporteCi; env: NodeJS.ProcessEnv }) => unknown;
  escrever?: (texto: string) => void;
  avisar?: (resultado: unknown, env: NodeJS.ProcessEnv) => void;
}

const limparCredencialOidc = (env: NodeJS.ProcessEnv): void => {
  delete env.ORK_FABRICA_ID_TOKEN;
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
};

/** Entrada protegida do `ork ci run --branch`; configuração vem só da target explícita. */
export async function executarLauncherNativoDoTransporte(branch?: string, env: NodeJS.ProcessEnv = process.env,
  dependencias: DependenciasDoLauncherDoTransporte = {}): Promise<number> {
  const { exigirManifesto } = await import('./manifest');
  const raizProtegida = env.ORK_TARGET_PROTEGIDA_DIR, raizFonte = env.ORK_FONTE_NAO_CONFIAVEL_DIR;
  if (!raizProtegida || !raizFonte || !path.isAbsolute(raizProtegida) || !path.isAbsolute(raizFonte)) {
    throw new Error('ci.excecao.transporte-contexto-ausente');
  }
  const carregadoProtegido = exigirManifesto(raizProtegida);
  const manifesto = carregadoProtegido.manifesto;
  const config = manifesto.ci.transporte_excecao;
  const localizadores = localizadoresDoLauncher(env);
  let token: string | null = null;
  let falhaDaIdentidade = false;
  if (config && configuracaoPublicaDoTransporteValida(config)) {
    try { token = await identidadeOidcDoLauncher(localizadores.forja, env, dependencias.buscar); }
    catch { falhaDaIdentidade = true; limparCredencialOidc(env); }
  } else limparCredencialOidc(env);

  const executarReplay = dependencias.executarReplay ?? (async () => {
    const { executarCiDaBranchComContexto } = await import('./ci');
    return executarCiDaBranchComContexto({ ...carregadoProtegido, raiz: raizFonte,
      caminho: path.join(raizProtegida, path.basename(carregadoProtegido.caminho)) }, branch ?? localizadores.source, {
      destino: localizadores.target, pullRequest: true, head: localizadores.head, project: localizadores.project,
      env, preflightEmpresa: null,
    });
  });
  const base = await executarReplay({ branch: branch ?? localizadores.source, raizFonte, raizProtegida,
    localizadores, env });
  const receipt = base && typeof base === 'object' && !Array.isArray(base)
    ? ((base as { policy?: { receipt?: unknown } }).policy?.receipt ?? null) : null;
  let final = base;
  if (receipt === 'ausente' && config && configuracaoPublicaDoTransporteValida(config)) {
    let bruto: unknown = { estado: 'indisponivel' };
    if (!falhaDaIdentidade && token) {
      try {
        const resposta = await (dependencias.buscar ?? fetch)(config.origem, { method: 'POST', headers: {
          authorization: `bearer ${token}`, 'content-type': 'application/json', accept: 'application/json',
        }, body: JSON.stringify(localizadores), signal: AbortSignal.timeout(dependencias.prazoMs ?? 15_000) });
        bruto = resposta.ok ? await resposta.json() : { estado: resposta.status === 408 ? 'timeout' : 'indisponivel' };
      } catch (erro) {
        bruto = (erro as Error).name === 'TimeoutError' || (erro as Error).name === 'AbortError'
          ? { estado: 'timeout' } : { estado: 'indisponivel' };
      }
    }
    const resultado = projetarResultadoDoTransporte(bruto, manifesto.ci.politica_recibo ?? 'observar', localizadores,
      (dependencias.agora ?? (() => new Date().toISOString()))());
    const { integrarResultadoDoTransporteNoCi } = await import('./ci');
    final = integrarResultadoDoTransporteNoCi(base, resultado);
  }
  const { publicarAvisoDaPolitica } = await import('./ci');
  (dependencias.avisar ?? ((resultado, ambiente) => { publicarAvisoDaPolitica(resultado, ambiente); }))(final, env);
  (dependencias.escrever ?? ((texto) => { process.stdout.write(texto); }))(`${JSON.stringify(final, null, 2)}\n`);
  return final && typeof final === 'object' && !Array.isArray(final) && (final as { ok?: unknown }).ok === true ? 0 : 1;
}

if (require.main === module) {
  void executarLauncherNativoDoTransporte(undefined, process.env).then((codigo) => { process.exitCode = codigo; })
    .catch(() => { process.stderr.write('ci.excecao.transporte-indisponivel\n'); process.exitCode = 1; });
}

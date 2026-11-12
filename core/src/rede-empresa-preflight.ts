/** RM-089 F3: uma fotografia remota, seguida apenas por análise pura em memória. */
import { CONTRATO_PUBLICACAO_EMPRESA, CONTRATO_PUBLICACAO_EMPRESA_V2, CONTRATO_PUBLICACAO_EMPRESA_V3,
  ehPublicacaoDaEmpresa, MAX_CAMINHOS_PUBLICACAO_EMPRESA, type PublicacaoDaEmpresaV1,
  type PublicacaoDaEmpresaV2, type PublicacaoDaEmpresaV3 } from './rede-empresa-contrato';
import { analisarConflitosColetivos, type ResultadoDeConflitos, type TrabalhoColetivo } from './rede-empresa-conflitos';
import { lerHistoriaDaEmpresa, type PontaDaRedeEmpresa, type PortaDaBranchEmpresa,
  type RegistroDaHistoriaEmpresa } from './rede-empresa-transporte';
import { portaGitDaRedeEmpresa } from './rede-empresa-transporte';
import { lerConfigRedeEmpresa } from './rede-empresa-config';
import { cachePronto, dirDoCache, type CasaDaRede } from './rede';
import { prepararCache } from './rede';
import { remotoDoProjeto } from './projeto-alvo';
import { normalizarProjeto } from './rede-empresa-projeto';
import type { Manifesto } from './types';

export interface FotografiaDoPreflightEmpresa {
  ponta: string | null;
  publicacoes: number;
  trabalhos: number;
  caminhos: number;
  commitsLidos: number;
  fonte: 'rede-coletiva';
}

export type ResultadoPreflightEmpresa = Omit<ResultadoDeConflitos, 'estado'> & {
  estado: ResultadoDeConflitos['estado'] | 'nao-realizado';
  fotografia: FotografiaDoPreflightEmpresa;
  cobertura: 'completa' | 'incompleta';
};

export function preflightNaoRealizado(motivo: string): ResultadoPreflightEmpresa {
  return { estado: 'nao-realizado', consultivo: true, conflitos: [], ordemSugerida: [], lacunas: [motivo],
    performance: { estado: 'unavailable' }, cobertura: 'incompleta',
    fotografia: { ponta: null, publicacoes: 0, trabalhos: 0, caminhos: 0, commitsLidos: 0, fonte: 'rede-coletiva' } };
}

const identidade = (inscricaoId: string, accountId: number, threadRef: string): string =>
  `${inscricaoId}\0${accountId}\0${threadRef}`;

function publicacaoV3(texto: string): PublicacaoDaEmpresaV3 | null {
  try {
    const valor = JSON.parse(texto) as unknown;
    return ehPublicacaoDaEmpresa(valor) && valor.contrato === CONTRATO_PUBLICACAO_EMPRESA_V3 ? valor : null;
  } catch { return null; }
}

function publicacaoLegada(texto: string): PublicacaoDaEmpresaV1 | PublicacaoDaEmpresaV2 | null {
  try {
    const valor = JSON.parse(texto) as unknown;
    return ehPublicacaoDaEmpresa(valor)
      && (valor.contrato === CONTRATO_PUBLICACAO_EMPRESA || valor.contrato === CONTRATO_PUBLICACAO_EMPRESA_V2)
      ? valor : null;
  } catch { return null; }
}

function primeirasAparicoes(registros: readonly RegistroDaHistoriaEmpresa[], lacunas: string[]): Map<string, { ordinal: number; commit: string }> {
  const primeiras = new Map<string, { ordinal: number; commit: string }>();
  for (const registro of registros) for (const documento of registro.documentos) {
    const publicacao = publicacaoV3(documento.conteudo);
    if (!publicacao) { lacunas.push('publicacao-v3.historica-invalida'); continue; }
    for (const trabalho of publicacao.trabalhos) {
      const chave = identidade(publicacao.inscricaoId, publicacao.maestro.accountId, trabalho.threadRef);
      if (!primeiras.has(chave)) primeiras.set(chave, { ordinal: registro.ordinal, commit: registro.id });
    }
  }
  return primeiras;
}

/** Analisa uma ponta já carimbada. Não chama porta, rede, Git, filesystem ou relógio. */
export function preflightDaPontaEmpresa(ponta: PontaDaRedeEmpresa): ResultadoPreflightEmpresa {
  const lacunas: string[] = [];
  let atuais: Array<{ caminho: string; conteudo: string }> = [], legadas: Array<{ caminho: string; conteudo: string }> = [];
  if (!ponta.atualizada || !ponta.listar) lacunas.push('rede.leitura-indisponivel');
  else {
    try {
      atuais = ponta.listar('publicacoes-v3/');
      legadas = ponta.listar('publicacoes/');
    } catch { atuais = []; legadas = []; lacunas.push('rede.leitura-indisponivel'); }
  }
  if (legadas.length) lacunas.push('caminhos.desconhecidos');
  const historia = lerHistoriaDaEmpresa(ponta);
  if (historia.estado === 'inconclusiva') lacunas.push(historia.lacuna);
  const primeiras = primeirasAparicoes(historia.registros, lacunas);
  const trabalhos: TrabalhoColetivo[] = [];
  let caminhos = 0, publicacoes = 0;
  for (const documento of legadas) {
    const publicacao = publicacaoLegada(documento.conteudo);
    if (!publicacao) { lacunas.push('publicacao-legada.invalida'); continue; }
    let projectKey: string;
    try { projectKey = publicacao.contrato === CONTRATO_PUBLICACAO_EMPRESA_V2
      ? publicacao.projectKey : normalizarProjeto(publicacao.projeto).projectKey; }
    catch { lacunas.push('publicacao-legada.projeto-invalido'); continue; }
    publicacoes++;
    for (const trabalho of publicacao.trabalhos) trabalhos.push({ inscricaoId: publicacao.inscricaoId,
      accountId: publicacao.maestro.accountId, builder: publicacao.maestro.loginAtual, threadRef: trabalho.threadRef,
      projectKey, ...(trabalho.itemId ? { itemId: trabalho.itemId } : {}), caminhos: [], primeiraAparicao: null,
      instanteLocal: { valor: publicacao.publicadoEm, fonte: 'auto-relato-autenticado' } });
  }
  for (const documento of atuais) {
    const publicacao = publicacaoV3(documento.conteudo);
    if (!publicacao) { lacunas.push('publicacao-v3.invalida'); continue; }
    publicacoes++;
    for (const trabalho of publicacao.trabalhos) {
      caminhos += trabalho.caminhos.length;
      trabalhos.push({ inscricaoId: publicacao.inscricaoId, accountId: publicacao.maestro.accountId,
        builder: publicacao.maestro.loginAtual, threadRef: trabalho.threadRef, projectKey: publicacao.projectKey,
        ...(trabalho.itemId ? { itemId: trabalho.itemId } : {}), caminhos: trabalho.caminhos,
        primeiraAparicao: primeiras.get(identidade(publicacao.inscricaoId, publicacao.maestro.accountId, trabalho.threadRef)) ?? null,
        instanteLocal: trabalho.instanteLocal });
    }
  }
  if (caminhos > publicacoes * MAX_CAMINHOS_PUBLICACAO_EMPRESA) lacunas.push('caminhos.excedeu-teto');
  const analise = analisarConflitosColetivos(trabalhos, lacunas);
  return { ...analise, fotografia: { ponta: ponta.id, publicacoes, trabalhos: trabalhos.length, caminhos,
    commitsLidos: historia.registros.length, fonte: 'rede-coletiva' },
  cobertura: analise.lacunas.length ? 'incompleta' : 'completa' };
}

/** A única leitura da porta para um preflight. */
export function preflightDaRedeEmpresa(porta: PortaDaBranchEmpresa): ResultadoPreflightEmpresa {
  let ponta: PontaDaRedeEmpresa;
  try { ponta = porta.ler(); }
  catch { return preflightNaoRealizado('rede.leitura-indisponivel'); }
  return preflightDaPontaEmpresa(ponta);
}

/** Lê somente o cache da inscrição deste projeto. Sem inscrição, não acrescenta superfície à saída existente. */
export function preflightDoProjeto(raiz: string, manifesto: Manifesto,
  env: NodeJS.ProcessEnv = process.env): ResultadoPreflightEmpresa | null {
  const remoto = remotoDoProjeto(raiz, 'origin');
  if (!remoto) return null;
  const adesao = lerConfigRedeEmpresa(env).inscricoes.find((i) => i.estado === 'ativa' && i.projetos.some((p) => {
    try { return normalizarProjeto(p, { espelhos: i.politicaCache?.espelhos ?? [] }).projectKey
      === normalizarProjeto(remoto, { forja: manifesto.forja, espelhos: i.politicaCache?.espelhos ?? [] }).projectKey; }
    catch { return false; }
  }));
  if (!adesao) return null;
  const partes = adesao.empresa.caminho.split('/');
  const casa: CasaDaRede = { forja: adesao.empresa.forja, host: adesao.empresa.host,
    dono: partes.slice(0, -1).join('/'), repositorio: partes.at(-1)!, origem: 'opcao' };
  const cache = dirDoCache(casa);
  const porta: PortaDaBranchEmpresa = cachePronto(cache) ? portaGitDaRedeEmpresa(cache) : {
    ler: () => ({ id: null, atualizada: false, ler: () => null }), gravar: () => false,
  };
  return preflightDaRedeEmpresa(porta);
}

export const CREDENCIAL_DE_LEITURA_DA_REDE = 'ORK_REDE_EMPRESA_READ_TOKEN' as const;

export interface DependenciasDoPreflightCi {
  prepararCache?: typeof prepararCache;
  portaGit?: typeof portaGitDaRedeEmpresa;
}

/** CI: a credencial fica apenas no ambiente do transporte Git e nunca entra em argv, resultado, bundle ou publicação. */
export function preflightCiDoProjeto(raiz: string, manifesto: Manifesto, env: NodeJS.ProcessEnv,
  fork: boolean | null, dependencias: DependenciasDoPreflightCi = {}): ResultadoPreflightEmpresa | null {
  const remoto = remotoDoProjeto(raiz, 'origin');
  if (!remoto) return null;
  const adesao = lerConfigRedeEmpresa(env).inscricoes.find((i) => i.estado === 'ativa' && i.projetos.some((p) => {
    try { return normalizarProjeto(p, { espelhos: i.politicaCache?.espelhos ?? [] }).projectKey
      === normalizarProjeto(remoto, { forja: manifesto.forja, espelhos: i.politicaCache?.espelhos ?? [] }).projectKey; }
    catch { return false; }
  }));
  if (!adesao) return null;
  if (fork) return preflightNaoRealizado('ci.pr-de-fork');
  if (fork === null) return preflightNaoRealizado('ci.carga-do-evento-indisponivel');
  const token = env[CREDENCIAL_DE_LEITURA_DA_REDE]?.trim();
  if (!token || /[\x00-\x20\x7f]/.test(token)) return preflightNaoRealizado('ci.credencial-ausente');
  const partes = adesao.empresa.caminho.split('/');
  const casa: CasaDaRede = { forja: adesao.empresa.forja, host: adesao.empresa.host,
    dono: partes.slice(0, -1).join('/'), repositorio: partes.at(-1)!, origem: 'opcao' };
  const url = `https://${adesao.empresa.host}/${adesao.empresa.caminho}.git`;
  const cache = (dependencias.prepararCache ?? prepararCache)(casa, url, null, 'ci-readonly');
  const usuario = adesao.empresa.forja === 'github' ? 'x-access-token' : 'oauth2';
  const autorizacao = Buffer.from(`${usuario}:${token}`, 'utf8').toString('base64');
  const gitEnv: NodeJS.ProcessEnv = { ...env, [CREDENCIAL_DE_LEITURA_DA_REDE]: '', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${autorizacao}` };
  return preflightDaRedeEmpresa((dependencias.portaGit ?? portaGitDaRedeEmpresa)(cache, 'origin', { env: gitEnv }));
}

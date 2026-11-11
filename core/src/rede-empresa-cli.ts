/** RM-089 F1: borda do CLI da rede coletiva, sem credencial em argumento ou estado. */
import { createHash } from 'node:crypto';
import { contextoDaVarredura } from './dado-privado';
import { raizDoEstado } from './estado-thread';
import { chamadorDaApi } from './forja/api';
import type { ChamadaDaCli } from './forja/executor';
import { rodarCli } from './forja/executor';
import { adaptadorDaForja, exigirCapacidade } from './forja/registro';
import type { ContaNaForja, Resultado, TipoDeForja } from './forja/contrato';
import type { Locale } from './locale';
import { textoDaFalhaEmpresa, USO_REDE_EMPRESA_EN, USO_REDE_EMPRESA_PT_BR } from './locale-network-empresa';
import { exigirManifesto } from './manifest';
import { montarPanoramaDaRede } from './network-roadmap';
import { cachePronto, dirDoCache, prepararCache, type CasaDaRede } from './rede';
import { comGitIsolado, forjaPorNome } from './rede-forja';
import { aceitarInscricaoEmpresa, criarPoliticaEmpresa, registrarInscricaoEmpresa, revogarInscricaoEmpresa, sairDaRedeEmpresa } from './rede-empresa';
import { adesaoRedeEmpresa } from './rede-empresa-config';
import type { ForjaDaEmpresa, ReferenciaDaForja } from './rede-empresa-contrato';
import { criarRedeColetiva } from './rede-empresa-forja';
import { publicarNaRedeEmpresa } from './rede-empresa-publicacao';
import { statusDaRedeEmpresa } from './rede-empresa-status';
import { portaGitDaRedeEmpresa, type PortaDaBranchEmpresa } from './rede-empresa-transporte';

export const CONTRATO_CLI_REDE_EMPRESA = 'ork.rede-empresa-cli/v1' as const;
const ACOES = ['criar', 'inscrever', 'publicar', 'status', 'sair', 'revogar'] as const;
type Acao = typeof ACOES[number];
type Opcoes = Record<string, string | boolean>;

export interface SaidaCliRedeEmpresa { codigo: number; stdout: string; stderr: string }

class FalhaCli extends Error { constructor(readonly codigo: string) { super(codigo); } }
const falhar = (codigo: string): never => { throw new FalhaCli(codigo); };
const valor = (opcoes: Opcoes, nome: string, obrigatorio = false): string | undefined => {
  const v = opcoes[nome];
  if (v === true || (obrigatorio && typeof v !== 'string')) falhar('rede-empresa.uso');
  return typeof v === 'string' ? v : undefined;
};
const opcoesValidas = (opcoes: Opcoes, permitidas: readonly string[]): void => {
  if (Object.keys(opcoes).some((k) => !permitidas.includes(k))) falhar('rede-empresa.uso');
};

function deResultado<T>(r: Resultado<T>): T {
  if (r.ok) return r.valor;
  throw new FalhaCli(r.erro.codigo);
}

function referencia(bruto: string, hostPedido?: string): ReferenciaDaForja {
  const m = /^(github|gitlab):([A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){1,20})$/.exec(bruto);
  if (!m) throw new FalhaCli('rede-empresa.uso');
  const host = hostPedido ?? (m[1] === 'github' ? 'github.com' : 'gitlab.com');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(?::[1-9][0-9]{0,4})?$/.test(host)) falhar('rede-empresa.uso');
  return { forja: m[1] as ForjaDaEmpresa, host, caminho: m[2] };
}

const donoENome = (ref: ReferenciaDaForja): { dono: string; nome: string } => {
  const partes = ref.caminho.split('/');
  return { dono: partes.slice(0, -1).join('/'), nome: partes.at(-1)! };
};

function alvo(ref: ReferenciaDaForja): { tipo: TipoDeForja; host: string; porta: number | null; caminhoBase: string; ca: null } {
  const m = /^(.*?)(?::([1-9][0-9]{0,4}))?$/.exec(ref.host)!;
  return { tipo: ref.forja, host: m[1].toLowerCase(), porta: m[2] ? Number(m[2]) : null, caminhoBase: '', ca: null };
}

function acesso(ref: ReferenciaDaForja, env: NodeJS.ProcessEnv, exigirPrivado = true):
{ conta: ContaNaForja; url: string; helper: string } {
  const local = forjaPorNome(ref.forja, { env }, ref.host);
  if (!local) throw new FalhaCli('forja.ausente');
  const rodar = (c: ChamadaDaCli) => rodarCli({ ...c, binario: local.binario });
  const api = chamadorDaApi(alvo(ref), { rodar });
  const conta = deResultado(exigirCapacidade(adaptadorDaForja(ref.forja), 'contaAtual')({ api }));
  const { dono, nome } = donoENome(ref);
  const repo = deResultado(exigirCapacidade(adaptadorDaForja(ref.forja), 'repositorioPrivado')({ api, dono, nome }));
  if (!repo) throw new FalhaCli('forja.nao-achei');
  if (exigirPrivado && !repo.privado) throw new FalhaCli('rede-empresa.repositorio-publico');
  return { conta, url: repo.urlHttps, helper: local.helperDeCredencial() };
}

function portaDaEmpresa(ref: ReferenciaDaForja, conferir: boolean, env: NodeJS.ProcessEnv): PortaDaBranchEmpresa {
  const { dono, nome } = donoENome(ref);
  const casa: CasaDaRede = { forja: ref.forja, host: ref.host, dono, repositorio: nome, origem: 'opcao' };
  if (conferir) {
    const a = acesso(ref, env);
    const cache = prepararCache(casa, a.url, a.helper, 'ork-network');
    return portaGitDaRedeEmpresa(cache);
  }
  const cache = dirDoCache(casa);
  return cachePronto(cache) ? portaGitDaRedeEmpresa(cache) : {
    ler: () => ({ id: null, atualizada: false, ler: () => null }), gravar: () => false,
  };
}

const projetoRef = (ref: ReferenciaDaForja): string => `${ref.forja}-${createHash('sha256')
  .update(`${ref.host}/${ref.caminho}`, 'utf8').digest('hex').slice(0, 16)}`;
const pedidoDoPanorama = (ref: ReferenciaDaForja): string => {
  const padrao = (ref.forja === 'github' && ref.host === 'github.com') || (ref.forja === 'gitlab' && ref.host === 'gitlab.com');
  return padrao ? `${ref.forja}:${ref.caminho}` : `https://${ref.host}/${ref.caminho}`;
};

function textoSucesso(acao: Acao, locale: Locale): string {
  const en = locale === 'en';
  const textos: Record<Acao, string> = en ? {
    criar: 'Collective network created or confirmed as private.', inscrever: 'Enrollment accepted for the authenticated account.',
    publicar: 'Collective projection published.', status: 'Collective network status read.', sair: 'Enrollment closed; new publications stop.',
    revogar: 'Enrollment revoked; new publications stop.',
  } : {
    criar: 'Rede coletiva criada ou confirmada como privada.', inscrever: 'Inscrição aceita para a conta autenticada.',
    publicar: 'Projeção coletiva publicada.', status: 'Status da rede coletiva lido.', sair: 'Inscrição encerrada; novos envios cessam.',
    revogar: 'Inscrição revogada; novos envios cessam.',
  };
  return textos[acao];
}

function sucesso(acao: Acao, dados: unknown, json: boolean, locale: Locale): SaidaCliRedeEmpresa {
  const envelope = { contrato: CONTRATO_CLI_REDE_EMPRESA, ok: true, operacao: acao, dados };
  return { codigo: 0, stdout: json ? `${JSON.stringify(envelope, null, 2)}\n` : `${textoSucesso(acao, locale)}\n`, stderr: '' };
}

function erro(codigo: string, json: boolean, locale: Locale): SaidaCliRedeEmpresa {
  const t = textoDaFalhaEmpresa(codigo, locale);
  const falha = { contrato: 'ork.rede-empresa-erro/v1', codigo, mensagem: t.mensagem, acao: t.acao };
  return { codigo: codigo === 'rede-empresa.uso' ? 2 : 1, stdout: json ? `${JSON.stringify({ contrato: CONTRATO_CLI_REDE_EMPRESA,
    ok: false, erro: falha }, null, 2)}\n` : '', stderr: json ? '' : `${codigo}: ${t.mensagem}\n${locale === 'en' ? 'Action' : 'Ação'}: ${t.acao}\n` };
}

function contaDaReferencia(ref: ReferenciaDaForja, env: NodeJS.ProcessEnv): ContaNaForja { return acesso(ref, env).conta; }

function executar(acao: Acao, opcoes: Opcoes, env: NodeJS.ProcessEnv): unknown {
  const agora = new Date().toISOString();
  if (acao === 'criar') {
    opcoesValidas(opcoes, ['forja', 'host', 'dono', 'repositorio', 'politica', 'saida', 'json']);
    const forja = valor(opcoes, 'forja', true);
    if (forja !== 'github' && forja !== 'gitlab') falhar('rede-empresa.uso');
    const dono = valor(opcoes, 'dono', true)!, nome = valor(opcoes, 'repositorio', true)!;
    const ref = referencia(`${forja}:${dono}/${nome}`, valor(opcoes, 'host'));
    const local = forjaPorNome(ref.forja, { env }, ref.host);
    if (!local) throw new FalhaCli('forja.ausente');
    const rodar = (c: ChamadaDaCli) => rodarCli({ ...c, binario: local.binario });
    const criada = deResultado(criarRedeColetiva({ tipo: ref.forja }, chamadorDaApi(alvo(ref), { rodar }), dono, nome));
    const casa: CasaDaRede = { forja: ref.forja, host: ref.host, dono, repositorio: nome, origem: 'opcao' };
    const porta = portaGitDaRedeEmpresa(prepararCache(casa, criada.repositorio.urlHttps, local.helperDeCredencial(), 'ork-network'));
    const saidaBruta = valor(opcoes, 'saida') ?? 'permitida';
    if (saidaBruta !== 'permitida' && saidaBruta !== 'negada') throw new FalhaCli('rede-empresa.uso');
    const saida: 'permitida' | 'negada' = saidaBruta;
    const politica = comGitIsolado(() => criarPoliticaEmpresa(porta, valor(opcoes, 'politica') ?? 'v1', saida));
    if (!politica.ok) throw new FalhaCli(politica.codigo);
    return { rede: ref, criada: criada.criada, conta: criada.conta, politica: politica.valor };
  }

  if (acao === 'inscrever') {
    opcoesValidas(opcoes, ['empresa', 'host', 'inscricao', 'rede', 'projetos', 'politica', 'json']);
    const host = valor(opcoes, 'host');
    const empresa = referencia(valor(opcoes, 'empresa', true)!, host);
    const rede = referencia(valor(opcoes, 'rede', true)!, host);
    const projetos = (valor(opcoes, 'projetos', true) ?? '').split(',').map((p) => referencia(p.trim(), host));
    if (!projetos.length || projetos.some((p, i) => projetos.findIndex((x) => x.forja === p.forja && x.host === p.host && x.caminho === p.caminho) !== i))
      falhar('rede-empresa.uso');
    const porta = portaDaEmpresa(empresa, true, env), conta = contaDaReferencia(rede, env), politicaVersao = valor(opcoes, 'politica') ?? 'v1';
    for (const p of projetos) acesso(p, env, false);
    const registro = comGitIsolado(() => registrarInscricaoEmpresa(porta, { inscricaoId: valor(opcoes, 'inscricao', true)!, rede,
      maestroRef: { forja: rede.forja, host: rede.host, accountId: conta.accountId }, loginAtual: conta.login, projetos,
      politicaVersao, agora }));
    if (!registro.ok) throw new FalhaCli(registro.codigo);
    const aceite = comGitIsolado(() => aceitarInscricaoEmpresa(porta, { inscricaoId: registro.valor.inscricaoId, conta,
      forja: rede.forja, host: rede.host, rede, projetosAcessiveis: projetos, agora, empresa, env }));
    if (!aceite.ok) throw new FalhaCli(aceite.codigo);
    return { inscricao: aceite.valor, resumo: { empresa, politicaVersao, projetos, maestroRef: aceite.valor.maestroRef,
      categorias: ['itens', 'reservas', 'trabalhos', 'fontes', 'lacunas'] } };
  }

  const inscricaoId = valor(opcoes, 'inscricao', true)!;
  const adesao = adesaoRedeEmpresa(inscricaoId, env);
  if (!adesao && acao !== 'revogar') falhar('rede-empresa.config-ausente');

  if (acao === 'revogar') {
    opcoesValidas(opcoes, ['empresa', 'host', 'inscricao', 'json']);
    const empresa = referencia(valor(opcoes, 'empresa', true)!, valor(opcoes, 'host'));
    const r = comGitIsolado(() => revogarInscricaoEmpresa(portaDaEmpresa(empresa, true, env), inscricaoId, agora));
    if (!r.ok) throw new FalhaCli(r.codigo);
    return r.valor;
  }

  if (acao === 'sair') {
    opcoesValidas(opcoes, ['inscricao', 'json']);
    const conta = contaDaReferencia(adesao!.rede, env);
    const r = comGitIsolado(() => sairDaRedeEmpresa(portaDaEmpresa(adesao!.empresa, true, env), inscricaoId, agora,
      conta, adesao!.rede.forja, adesao!.rede.host));
    if (!r.ok) throw new FalhaCli(r.codigo);
    return r.valor;
  }

  const selecionado = valor(opcoes, 'projeto');
  const pedido = selecionado ? referencia(selecionado) : null;
  const projetos = pedido ? adesao!.projetos.filter((p) => p.forja === pedido.forja && p.caminho === pedido.caminho) : adesao!.projetos;
  if (pedido && !projetos.length) falhar('rede-empresa.projeto-nao-autorizado');
  if (projetos.some((p) => !adesao!.projetos.some((a) => a.forja === p.forja && a.host === p.host && a.caminho === p.caminho)))
    falhar('rede-empresa.projeto-nao-autorizado');

  if (acao === 'status') {
    opcoesValidas(opcoes, ['inscricao', 'projeto', 'json']);
    const porta = portaDaEmpresa(adesao!.empresa, false, env);
    return comGitIsolado(() => projetos.map((p) => statusDaRedeEmpresa(porta, inscricaoId, projetoRef(p), env)));
  }

  opcoesValidas(opcoes, ['inscricao', 'projeto', 'json']);
  const carregado = exigirManifesto();
  const contexto = contextoDaVarredura(carregado.raiz, raizDoEstado(carregado.raiz), env);
  if (!contexto.ok) throw new FalhaCli('rede-empresa.dado-privado');
  const privacidade = contexto.valor;
  const porta = portaDaEmpresa(adesao!.empresa, true, env);
  return comGitIsolado(() => projetos.map((p) => {
    const panorama = montarPanoramaDaRede({ cwd: carregado.raiz, pedido: pedidoDoPanorama(p), quando: agora });
    const projeto = panorama.projetos[0];
    if (!projeto) falhar('rede-empresa.projeto-nao-autorizado');
    const r = publicarNaRedeEmpresa(porta, { inscricaoId, projetoRef: projetoRef(p), projeto: p, panorama: projeto,
      agora, privacidade, env });
    if (!r.ok) throw new FalhaCli(r.codigo);
    return { projeto: p, publicacao: r.valor, transacao: r.transacao };
  }));
}

export function executarCliRedeEmpresa(acaoBruta: string | undefined, opcoes: Opcoes, locale: Locale,
  env: NodeJS.ProcessEnv = process.env): SaidaCliRedeEmpresa {
  const json = opcoes.json === true;
  if (!acaoBruta || !(ACOES as readonly string[]).includes(acaoBruta)) {
    const r = erro('rede-empresa.uso', json, locale);
    if (!json) r.stderr += `${locale === 'en' ? USO_REDE_EMPRESA_EN : USO_REDE_EMPRESA_PT_BR}\n`;
    return r;
  }
  const acao = acaoBruta as Acao;
  try { return sucesso(acao, executar(acao, opcoes, env), json, locale); }
  catch (e) {
    const codigo = e instanceof FalhaCli ? e.codigo : (e as { codigo?: unknown }).codigo;
    return erro(typeof codigo === 'string' ? codigo : 'rede-empresa.forja-indisponivel', json, locale);
  }
}

/** Configuração local das inscrições; não contém token, caminho local ou nome de máquina. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pastaDoUsuario } from './maquina';
import { ehMaestroRef, ehReferenciaDaForja, MaestroRef, ReferenciaDaForja, type NivelDaCoberturaEmpresa,
  type PoliticaDaEmpresa } from './rede-empresa-contrato';

export const CONTRATO_CONFIG_REDE_EMPRESA = 'ork.rede-empresa-config/v1' as const;
const ARQUIVO = 'rede-empresa.json';

export class ErroDaConfigRedeEmpresa extends Error {
  readonly codigo = 'rede-empresa.config-invalida';
  readonly acao = 'corrija ou remova rede-empresa.json e refaça o aceite';
  readonly arquivo = ARQUIVO;
  constructor() { super('rede-empresa.config-invalida'); }
}

export interface AdesaoRedeEmpresa {
  inscricaoId: string;
  empresa: ReferenciaDaForja;
  rede: ReferenciaDaForja;
  maestroRef: MaestroRef;
  loginAtual: string;
  politicaVersao: string;
  projetos: ReferenciaDaForja[];
  estado: 'pendente' | 'ativa' | 'revogada' | 'encerrada';
  ultimaPublicacao: string | null;
  pendencia: { codigo: string; em: string } | null;
  politicaCache?: PoliticaCacheDaEmpresa;
}

export interface PoliticaCacheDaEmpresa {
  versao: string;
  nivel: NivelDaCoberturaEmpresa;
  reciboVersao: string;
  conferidaEm: string;
}

export interface ExcecaoDeCobertura {
  projectKey: string;
  itemId: string;
  responsavelAccountId: number;
  justificativaId: string;
  expiraEm: string;
  referencia: string;
}

export interface ResultadoDaCobertura {
  nivel: NivelDaCoberturaEmpresa;
  estado: 'conferida' | 'nao-configurada' | 'nao-conferida' | 'excecao-autenticada';
  permite: boolean;
  codigo: 'rede-empresa.cobertura-ok' | 'rede-empresa.cobertura-aviso' | 'rede-empresa.cobertura-exigida'
    | 'rede-empresa.cobertura-excecao';
  reciboVersao: string | null;
  auditavel: boolean;
}

export interface ConfigRedeEmpresa { contrato: typeof CONTRATO_CONFIG_REDE_EMPRESA; inscricoes: AdesaoRedeEmpresa[] }

const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function ehAdesao(v: unknown): v is AdesaoRedeEmpresa {
  if (!obj(v) || Object.keys(v).some((k) => !['inscricaoId', 'empresa', 'rede', 'maestroRef', 'loginAtual', 'politicaVersao', 'projetos',
    'estado', 'ultimaPublicacao', 'pendencia', 'politicaCache'].includes(k))) return false;
  const pendencia = v.pendencia;
  const cache = v.politicaCache;
  return id(v.inscricaoId) && ehReferenciaDaForja(v.empresa) && ehReferenciaDaForja(v.rede) && ehMaestroRef(v.maestroRef)
    && id(v.loginAtual) && id(v.politicaVersao) && Array.isArray(v.projetos) && v.projetos.length > 0 && v.projetos.every(ehReferenciaDaForja)
    && (v.estado === 'pendente' || v.estado === 'ativa' || v.estado === 'revogada' || v.estado === 'encerrada')
    && (v.ultimaPublicacao === null || iso(v.ultimaPublicacao))
    && (pendencia === null || (obj(pendencia) && Object.keys(pendencia).length === 2 && id(pendencia.codigo) && iso(pendencia.em)))
    && (cache === undefined || (obj(cache) && Object.keys(cache).length === 4 && id(cache.versao)
      && (cache.nivel === 'observar' || cache.nivel === 'avisar' || cache.nivel === 'exigir')
      && id(cache.reciboVersao) && iso(cache.conferidaEm)));
}

const arquivo = (env: NodeJS.ProcessEnv): string => path.join(pastaDoUsuario(env), ARQUIVO);

export function lerConfigRedeEmpresa(env: NodeJS.ProcessEnv = process.env): ConfigRedeEmpresa {
  let texto: string;
  try {
    texto = fs.readFileSync(arquivo(env), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { contrato: CONTRATO_CONFIG_REDE_EMPRESA, inscricoes: [] };
    throw new ErroDaConfigRedeEmpresa();
  }
  let v: unknown;
  try { v = JSON.parse(texto) as unknown; } catch { throw new ErroDaConfigRedeEmpresa(); }
  if (!obj(v) || Object.keys(v).some((k) => k !== 'contrato' && k !== 'inscricoes') || v.contrato !== CONTRATO_CONFIG_REDE_EMPRESA
    || !Array.isArray(v.inscricoes) || !v.inscricoes.every(ehAdesao)) throw new ErroDaConfigRedeEmpresa();
  return { contrato: CONTRATO_CONFIG_REDE_EMPRESA, inscricoes: v.inscricoes };
}

export function gravarAdesaoRedeEmpresa(adesao: AdesaoRedeEmpresa, env: NodeJS.ProcessEnv = process.env): ConfigRedeEmpresa {
  if (!ehAdesao(adesao)) throw new Error('rede-empresa.config-invalida');
  const atual = lerConfigRedeEmpresa(env);
  const inscricoes = [...atual.inscricoes.filter((i) => i.inscricaoId !== adesao.inscricaoId), adesao]
    .sort((a, b) => a.inscricaoId.localeCompare(b.inscricaoId));
  const config: ConfigRedeEmpresa = { contrato: CONTRATO_CONFIG_REDE_EMPRESA, inscricoes };
  const destino = arquivo(env), dir = path.dirname(destino);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporario = path.join(dir, `.${ARQUIVO}.${process.pid}.tmp`);
  fs.writeFileSync(temporario, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporario, destino);
  fs.chmodSync(destino, 0o600);
  return config;
}

export function adesaoRedeEmpresa(inscricaoId: string, env: NodeJS.ProcessEnv = process.env): AdesaoRedeEmpresa | null {
  return lerConfigRedeEmpresa(env).inscricoes.find((i) => i.inscricaoId === inscricaoId) ?? null;
}

export function cacheDaPoliticaEmpresa(politica: PoliticaDaEmpresa, conferidaEm: string): PoliticaCacheDaEmpresa {
  return { versao: politica.versao,
    nivel: politica.contrato === 'ork.rede-empresa-politica/v2' ? politica.nivel : 'avisar',
    reciboVersao: politica.contrato === 'ork.rede-empresa-politica/v2' ? politica.reciboVersao : politica.versao,
    conferidaEm };
}

function excecaoValida(excecao: ExcecaoDeCobertura | undefined, pedido: { projectKey: string; itemId: string; agora: string },
  autenticar: ((e: ExcecaoDeCobertura) => boolean) | undefined): boolean {
  return !!excecao && excecao.projectKey === pedido.projectKey && excecao.itemId === pedido.itemId
    && Number.isSafeInteger(excecao.responsavelAccountId) && excecao.responsavelAccountId > 0
    && id(excecao.justificativaId) && id(excecao.referencia) && iso(excecao.expiraEm)
    && Date.parse(excecao.expiraEm) > Date.parse(pedido.agora) && !!autenticar?.(excecao);
}

/** A cobertura coletiva falha aberta em observar/avisar e fechada em exigir. Cache orienta o nível, nunca prova item livre. */
export function avaliarCoberturaEmpresa(pedido: {
  configurada: boolean;
  conferida: boolean;
  politica?: PoliticaDaEmpresa;
  cache?: PoliticaCacheDaEmpresa;
  projectKey: string;
  itemId: string;
  agora: string;
  excecao?: ExcecaoDeCobertura;
  autenticarExcecao?: (e: ExcecaoDeCobertura) => boolean;
}): ResultadoDaCobertura {
  const atual = pedido.politica ? cacheDaPoliticaEmpresa(pedido.politica, pedido.agora) : pedido.cache;
  const nivel = atual?.nivel ?? 'observar';
  const reciboVersao = atual?.reciboVersao ?? null;
  if (pedido.configurada && pedido.conferida && pedido.politica) {
    return { nivel, estado: 'conferida', permite: true, codigo: 'rede-empresa.cobertura-ok', reciboVersao, auditavel: true };
  }
  const estado = pedido.configurada ? 'nao-conferida' : 'nao-configurada';
  if (nivel !== 'exigir') {
    return { nivel, estado, permite: true, codigo: 'rede-empresa.cobertura-aviso', reciboVersao, auditavel: true };
  }
  if (excecaoValida(pedido.excecao, pedido, pedido.autenticarExcecao)) {
    return { nivel, estado: 'excecao-autenticada', permite: true, codigo: 'rede-empresa.cobertura-excecao',
      reciboVersao, auditavel: true };
  }
  return { nivel, estado, permite: false, codigo: 'rede-empresa.cobertura-exigida', reciboVersao, auditavel: true };
}

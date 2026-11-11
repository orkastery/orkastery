/** Configuração local das inscrições; não contém token, caminho local ou nome de máquina. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pastaDoUsuario } from './maquina';
import { ehMaestroRef, ehReferenciaDaForja, MaestroRef, ReferenciaDaForja } from './rede-empresa-contrato';

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
}

export interface ConfigRedeEmpresa { contrato: typeof CONTRATO_CONFIG_REDE_EMPRESA; inscricoes: AdesaoRedeEmpresa[] }

const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function ehAdesao(v: unknown): v is AdesaoRedeEmpresa {
  if (!obj(v) || Object.keys(v).some((k) => !['inscricaoId', 'empresa', 'rede', 'maestroRef', 'loginAtual', 'politicaVersao', 'projetos',
    'estado', 'ultimaPublicacao', 'pendencia'].includes(k))) return false;
  const pendencia = v.pendencia;
  return id(v.inscricaoId) && ehReferenciaDaForja(v.empresa) && ehReferenciaDaForja(v.rede) && ehMaestroRef(v.maestroRef)
    && id(v.loginAtual) && id(v.politicaVersao) && Array.isArray(v.projetos) && v.projetos.length > 0 && v.projetos.every(ehReferenciaDaForja)
    && (v.estado === 'pendente' || v.estado === 'ativa' || v.estado === 'revogada' || v.estado === 'encerrada')
    && (v.ultimaPublicacao === null || iso(v.ultimaPublicacao))
    && (pendencia === null || (obj(pendencia) && Object.keys(pendencia).length === 2 && id(pendencia.codigo) && iso(pendencia.em)));
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

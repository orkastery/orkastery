/** RM-089 F1: contratos fechados da rede coletiva da empresa. */
import type { TipoDeLacunaDaRede } from './network-roadmap';
import type { GrupoDoRoadmap } from './roadmap-status';

export const CONTRATO_POLITICA_EMPRESA = 'ork.rede-empresa-politica/v1' as const;
export const CONTRATO_INSCRICAO_EMPRESA = 'ork.rede-empresa-inscricao/v1' as const;
export const CONTRATO_PUBLICACAO_EMPRESA = 'ork.rede-empresa-publicacao/v1' as const;
export const CONTRATO_STATUS_EMPRESA = 'ork.rede-empresa-status/v1' as const;

export const MAX_BYTES_PUBLICACAO_EMPRESA = 1024 * 1024;
export const MAX_ITENS_PUBLICACAO_EMPRESA = 5_000;
export const MAX_RESERVAS_PUBLICACAO_EMPRESA = 5_000;
export const MAX_TRABALHOS_PUBLICACAO_EMPRESA = 2_000;
export const MAX_LACUNAS_PUBLICACAO_EMPRESA = 1_000;

export type ForjaDaEmpresa = 'github' | 'gitlab';
export interface ReferenciaDaForja { forja: ForjaDaEmpresa; host: string; caminho: string }
export interface MaestroRef { forja: ForjaDaEmpresa; host: string; accountId: number }

export interface PoliticaDaEmpresa {
  contrato: typeof CONTRATO_POLITICA_EMPRESA;
  versao: string;
  saida: 'permitida' | 'negada';
  publicacaoMinima: 1;
}

export interface InscricaoDaEmpresa {
  contrato: typeof CONTRATO_INSCRICAO_EMPRESA;
  inscricaoId: string;
  rede: ReferenciaDaForja;
  maestroRef: MaestroRef;
  loginAtual: string;
  projetos: ReferenciaDaForja[];
  politicaVersao: string;
  estado: 'pendente' | 'ativa' | 'revogada' | 'encerrada';
  registradaEm: string;
  aceitaEm: string | null;
  atualizadaEm: string;
}

export interface ItemPublicado { id: string; estado: GrupoDoRoadmap }
export interface ReservaPublicada { itemId: string; threadRef?: string; iniciadaEm: string }
export interface TrabalhoPublicado { threadRef: string; fase: 'GOAL' | 'PLAN' | 'GO' | 'CHECK' | 'SHIP' | 'MASTER'; itemId?: string }
export interface FontePublicada { parte: 'roadmap' | 'reservas' | 'fabrica' | 'estado-local'; atualizado: boolean; lidoEm: string; commit?: string }
export const TIPOS_DE_LACUNA_PUBLICADA = [
  'projeto.sem-clone', 'projeto.sem-fonte', 'projeto.sem-leitura', 'projeto.remoto-invalido', 'projeto.base-invalida',
  'estado-local.sem-leitura',
  'roadmap.sem-base', 'roadmap.sem-itens', 'roadmap.pagina-invalida', 'roadmap.entregas-parciais', 'roadmap.sem-leitura',
  'reservas.sem-branch', 'reservas.sem-leitura', 'reserva.invalida',
  'fabrica.sem-branch', 'fabrica.sem-leitura', 'retrato.invalido', 'maquina.sem-batida',
  'forja.ausente', 'forja.sem-login', 'forja.resposta-invalida', 'forja.sem-permissao', 'forja.nao-achei', 'forja.limite',
  'forja.conflito', 'forja.indisponivel', 'forja.pedido-recusado', 'forja.incompleto', 'forja.desconhecida', 'forja.ambigua',
  'forja.remoto-divergente', 'forja.sem-capacidade', 'forja.versao-abaixo-do-piso', 'forja.nao-consultada', 'forja.leitura-parcial',
  'registro.invalido', 'rede.sem-projeto', 'rede.sem-repositorio', 'rede.repositorio-publico', 'rede.sem-leitura',
  'maquina.nome-em-uso', 'maquina.sem-fabrica',
] as const satisfies readonly TipoDeLacunaDaRede[];
export type TipoDeLacunaPublicada = typeof TIPOS_DE_LACUNA_PUBLICADA[number];
export interface LacunaPublicada { tipo: TipoDeLacunaPublicada; parte: 'roadmap' | 'reservas' | 'fabrica' | 'estado-local' | 'forja' | 'registro' | 'rede' | 'projeto' }

export interface PublicacaoDaEmpresa {
  contrato: typeof CONTRATO_PUBLICACAO_EMPRESA;
  politicaVersao: string;
  inscricaoId: string;
  publicadoEm: string;
  maestro: MaestroRef & { loginAtual: string };
  rede: ReferenciaDaForja;
  projeto: ReferenciaDaForja;
  itens: ItemPublicado[];
  reservas: ReservaPublicada[];
  trabalhos: TrabalhoPublicado[];
  fontes: FontePublicada[];
  lacunas: LacunaPublicada[];
}

export interface StatusDaRedeEmpresa {
  contrato: typeof CONTRATO_STATUS_EMPRESA;
  inscricaoId: string;
  estado: InscricaoDaEmpresa['estado'] | 'ausente';
  forjaAtualizada: boolean;
  politicaVersao: string | null;
  ultimaPublicacao: string | null;
  pendencia: { codigo: string; em: string } | null;
  publicacao: PublicacaoDaEmpresa | null;
}

export interface FalhaDaRedeEmpresa {
  contrato: 'ork.rede-empresa-erro/v1';
  codigo: string;
  mensagem: string;
  acao: string;
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const chaves = (v: Record<string, unknown>, permitidas: readonly string[]): boolean =>
  Object.keys(v).every((k) => permitidas.includes(k)) && permitidas.every((k) => k in v);
const texto = (v: unknown, teto = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= teto && !/[\x00-\x1f\x7f]/.test(v);
const iso = (v: unknown): v is string => texto(v, 40) && Number.isFinite(Date.parse(v));
const id = (v: unknown, teto = 128): v is string => texto(v, teto) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const inteiro = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

export function ehReferenciaDaForja(v: unknown): v is ReferenciaDaForja {
  return obj(v) && chaves(v, ['forja', 'host', 'caminho']) && (v.forja === 'github' || v.forja === 'gitlab')
    && id(v.host, 255) && texto(v.caminho, 400) && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v.caminho)
    && !v.caminho.includes('..') && !v.caminho.startsWith('/') && !v.caminho.endsWith('/');
}

export function ehMaestroRef(v: unknown): v is MaestroRef {
  return obj(v) && chaves(v, ['forja', 'host', 'accountId']) && (v.forja === 'github' || v.forja === 'gitlab')
    && id(v.host, 255) && inteiro(v.accountId);
}

export function ehPoliticaDaEmpresa(v: unknown): v is PoliticaDaEmpresa {
  return obj(v) && chaves(v, ['contrato', 'versao', 'saida', 'publicacaoMinima']) && v.contrato === CONTRATO_POLITICA_EMPRESA
    && id(v.versao, 64) && (v.saida === 'permitida' || v.saida === 'negada') && v.publicacaoMinima === 1;
}

export function ehInscricaoDaEmpresa(v: unknown): v is InscricaoDaEmpresa {
  if (!obj(v) || !chaves(v, ['contrato', 'inscricaoId', 'rede', 'maestroRef', 'loginAtual', 'projetos', 'politicaVersao', 'estado',
    'registradaEm', 'aceitaEm', 'atualizadaEm'])) return false;
  return v.contrato === CONTRATO_INSCRICAO_EMPRESA && id(v.inscricaoId) && ehReferenciaDaForja(v.rede) && ehMaestroRef(v.maestroRef)
    && id(v.loginAtual, 255) && Array.isArray(v.projetos) && v.projetos.length > 0 && v.projetos.length <= MAX_ITENS_PUBLICACAO_EMPRESA
    && v.projetos.every(ehReferenciaDaForja) && id(v.politicaVersao, 64)
    && (v.estado === 'pendente' || v.estado === 'ativa' || v.estado === 'revogada' || v.estado === 'encerrada')
    && iso(v.registradaEm) && (v.aceitaEm === null || iso(v.aceitaEm)) && iso(v.atualizadaEm);
}

const GRUPOS: readonly GrupoDoRoadmap[] = ['concluidos', 'disponiveis', 'hoje', 'piloto', 'desenvolvimento', 'refinamento', 'proposto', 'descontinuado'];
const FASES = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const;
const PARTES = ['roadmap', 'reservas', 'fabrica', 'estado-local'] as const;
const PARTES_LACUNA = [...PARTES, 'forja', 'registro', 'rede', 'projeto'] as const;
const TIPOS_DE_LACUNA = new Set<string>(TIPOS_DE_LACUNA_PUBLICADA);

export function ehTipoDeLacunaPublicada(v: unknown): v is TipoDeLacunaPublicada {
  const cobertura: Exclude<TipoDeLacunaDaRede, TipoDeLacunaPublicada> extends never ? true : never = true;
  void cobertura;
  return typeof v === 'string' && TIPOS_DE_LACUNA.has(v);
}

function item(v: unknown): v is ItemPublicado { return obj(v) && chaves(v, ['id', 'estado']) && id(v.id) && GRUPOS.includes(v.estado as GrupoDoRoadmap); }
function reserva(v: unknown): v is ReservaPublicada {
  return obj(v) && Object.keys(v).every((k) => ['itemId', 'threadRef', 'iniciadaEm'].includes(k)) && 'itemId' in v && 'iniciadaEm' in v
    && id(v.itemId) && (v.threadRef === undefined || id(v.threadRef)) && iso(v.iniciadaEm);
}
function trabalho(v: unknown): v is TrabalhoPublicado {
  return obj(v) && Object.keys(v).every((k) => ['threadRef', 'fase', 'itemId'].includes(k)) && 'threadRef' in v && 'fase' in v
    && id(v.threadRef) && FASES.includes(v.fase as typeof FASES[number]) && (v.itemId === undefined || id(v.itemId));
}
function fonte(v: unknown): v is FontePublicada {
  return obj(v) && Object.keys(v).every((k) => ['parte', 'atualizado', 'lidoEm', 'commit'].includes(k))
    && 'parte' in v && 'atualizado' in v && 'lidoEm' in v && PARTES.includes(v.parte as typeof PARTES[number])
    && typeof v.atualizado === 'boolean' && iso(v.lidoEm) && (v.commit === undefined || id(v.commit, 64));
}
function lacuna(v: unknown): v is LacunaPublicada {
  return obj(v) && chaves(v, ['tipo', 'parte']) && ehTipoDeLacunaPublicada(v.tipo)
    && PARTES_LACUNA.includes(v.parte as typeof PARTES_LACUNA[number]);
}

export function ehPublicacaoDaEmpresa(v: unknown): v is PublicacaoDaEmpresa {
  if (!obj(v) || !chaves(v, ['contrato', 'politicaVersao', 'inscricaoId', 'publicadoEm', 'maestro', 'rede', 'projeto', 'itens',
    'reservas', 'trabalhos', 'fontes', 'lacunas'])) return false;
  const maestro = v.maestro;
  if (!obj(maestro) || !Object.keys(maestro).every((k) => ['forja', 'host', 'accountId', 'loginAtual'].includes(k))
    || !ehMaestroRef({ forja: maestro.forja, host: maestro.host, accountId: maestro.accountId }) || !id(maestro.loginAtual, 255)) return false;
  if (v.contrato !== CONTRATO_PUBLICACAO_EMPRESA || !id(v.politicaVersao, 64) || !id(v.inscricaoId) || !iso(v.publicadoEm)
    || !ehReferenciaDaForja(v.rede) || !ehReferenciaDaForja(v.projeto) || !Array.isArray(v.itens) || !Array.isArray(v.reservas)
    || !Array.isArray(v.trabalhos) || !Array.isArray(v.fontes) || !Array.isArray(v.lacunas)) return false;
  if (v.itens.length > MAX_ITENS_PUBLICACAO_EMPRESA || v.reservas.length > MAX_RESERVAS_PUBLICACAO_EMPRESA
    || v.trabalhos.length > MAX_TRABALHOS_PUBLICACAO_EMPRESA || v.lacunas.length > MAX_LACUNAS_PUBLICACAO_EMPRESA) return false;
  if (!v.itens.every(item) || !v.reservas.every(reserva) || !v.trabalhos.every(trabalho) || !v.fontes.every(fonte) || !v.lacunas.every(lacuna)) return false;
  return Buffer.byteLength(JSON.stringify(v), 'utf8') <= MAX_BYTES_PUBLICACAO_EMPRESA;
}

export function ehStatusDaRedeEmpresa(v: unknown): v is StatusDaRedeEmpresa {
  if (!obj(v) || !chaves(v, ['contrato', 'inscricaoId', 'estado', 'forjaAtualizada', 'politicaVersao', 'ultimaPublicacao',
    'pendencia', 'publicacao'])) return false;
  const pendencia = v.pendencia;
  return v.contrato === CONTRATO_STATUS_EMPRESA && id(v.inscricaoId)
    && ['pendente', 'ativa', 'revogada', 'encerrada', 'ausente'].includes(String(v.estado))
    && typeof v.forjaAtualizada === 'boolean' && (v.politicaVersao === null || id(v.politicaVersao, 64))
    && (v.ultimaPublicacao === null || iso(v.ultimaPublicacao))
    && (pendencia === null || (obj(pendencia) && chaves(pendencia, ['codigo', 'em']) && id(pendencia.codigo) && iso(pendencia.em)))
    && (v.publicacao === null || ehPublicacaoDaEmpresa(v.publicacao));
}

/** RM-089 F2: CAS único para reserva principal, colaboração e acordo autenticado. */
import { createHash } from 'node:crypto';
import { ehPoliticaDaEmpresa, ehPublicacaoDaEmpresa, type PoliticaDaEmpresa, type PublicacaoDaEmpresa } from './rede-empresa-contrato';
import { normalizarProjeto, segmentoDaProjectKey } from './rede-empresa-projeto';
import { lerDocumentoRemoto, transacionarRedeEmpresa, type PortaDaBranchEmpresa,
  type ResultadoDaTransacaoEmpresa } from './rede-empresa-transporte';
import { verificarAtestacao, type PortaDeAtestacao, type ReferenciaDaAtestacao } from './rede-empresa-atestacao';

export const CONTRATO_RESERVA_COLETIVA = 'ork.rede-empresa-reserva/v1' as const;
type Fase = 'GOAL' | 'PLAN' | 'GO' | 'CHECK' | 'SHIP' | 'MASTER';
type Acao = 'reserva' | 'colaborador' | 'acordo';

export interface IdentidadeColetiva {
  inscricaoId: string;
  accountId: number;
  loginAtual: string;
  fase: Fase;
}

export interface ReservaColetiva {
  contrato: typeof CONTRATO_RESERVA_COLETIVA;
  projectKey: string;
  itemId: string;
  operationId: string;
  versao: number;
  fingerprint: string;
  titular: IdentidadeColetiva;
  criadaEm: string;
  atualizadaEm: string;
  colaboradores: IdentidadeColetiva[];
  acordos: Array<{ destinatarioAccountId: number; referencia: ReferenciaDaAtestacao; aceitoEm: string }>;
}

export interface PedidoDeCoordenacao {
  acao: Acao;
  operationId: string;
  projectKey: string;
  itemId: string;
  identidade: IdentidadeColetiva;
  agora: string;
  timeoutMs: number;
  atestacao?: { porta: PortaDeAtestacao; referencia: ReferenciaDaAtestacao };
}

export type CodigoDaCoordenacao = 'rede-empresa.reserva-existente' | 'rede-empresa.reserva-ausente'
  | 'rede-empresa.forja-indisponivel' | 'rede-empresa.concorrencia' | 'rede-empresa.documento-remoto-invalido'
  | 'rede-empresa.politica-ausente' | 'rede-empresa.project-key-divergente'
  | 'rede-empresa.acordo-ausente' | 'rede-empresa.acordo-invalido' | 'rede-empresa.acordo-editado'
  | 'rede-empresa.acordo-autor-divergente' | 'rede-empresa.acordo-destinatario-divergente'
  | 'rede-empresa.acordo-escopo-divergente' | 'rede-empresa.acordo-reserva-divergente' | 'rede-empresa.acordo-expirado';

export type ResultadoDaCoordenacao =
  | { ok: true; codigo: 'rede-empresa.reserva-criada' | 'rede-empresa.reserva-propria'
      | 'rede-empresa.colaboracao-registrada' | 'rede-empresa.acordo-aceito'; reserva: ReservaColetiva; transacao: ResultadoDaTransacaoEmpresa }
  | { ok: false; codigo: CodigoDaCoordenacao; existente?: ReservaColetiva; transacao?: ResultadoDaTransacaoEmpresa };

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const caminho = (projectKey: string, itemId: string): string => {
  if (!/^RM-[0-9]{3,}$/.test(itemId)) throw new Error('rede-empresa.item-invalido');
  return `coordenacao/${segmentoDaProjectKey(projectKey)}/${itemId}.json`;
};
const canonico = (v: unknown): unknown => Array.isArray(v) ? v.map(canonico)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, valor]) => [k, canonico(valor)])) : v;
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonico(v)), 'utf8').digest('hex');
type ReservaSemFingerprint = Omit<ReservaColetiva, 'fingerprint'>;
const fingerprint = (r: ReservaSemFingerprint): string => hash(r);
const comFingerprint = (r: ReservaSemFingerprint): ReservaColetiva => ({ ...r, fingerprint: fingerprint(r) });
const objetoFechado = (v: unknown, chaves: readonly string[]): v is Record<string, unknown> => !!v && typeof v === 'object'
  && !Array.isArray(v) && Object.keys(v).length === chaves.length && chaves.every((k) => k in v);
const idValida = (i: IdentidadeColetiva): boolean => objetoFechado(i, ['inscricaoId', 'accountId', 'loginAtual', 'fase'])
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(i.inscricaoId)
  && Number.isSafeInteger(i.accountId) && i.accountId > 0 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(i.loginAtual)
  && ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'].includes(i.fase);
const referenciaValida = (r: ReferenciaDaAtestacao): boolean => objetoFechado(r, ['forja', 'id', 'endpoint', 'sha256'])
  && (r.forja === 'github' || r.forja === 'gitlab') && Number.isSafeInteger(r.id) && r.id > 0
  && typeof r.endpoint === 'string' && r.endpoint.length > 0 && r.endpoint.length <= 500
  && /^[a-f0-9]{64}$/.test(r.sha256);

function ehReserva(v: unknown): v is ReservaColetiva {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as ReservaColetiva;
  const chaves = ['contrato', 'projectKey', 'itemId', 'operationId', 'versao', 'fingerprint', 'titular', 'criadaEm',
    'atualizadaEm', 'colaboradores', 'acordos'];
  const semFingerprint = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'fingerprint')) as ReservaSemFingerprint;
  return Object.keys(r).length === chaves.length && chaves.every((k) => k in r)
    && r.contrato === CONTRATO_RESERVA_COLETIVA && typeof r.projectKey === 'string' && /^RM-[0-9]{3,}$/.test(r.itemId)
    && typeof r.operationId === 'string' && Number.isSafeInteger(r.versao) && r.versao > 0 && /^[a-f0-9]{64}$/.test(r.fingerprint)
    && idValida(r.titular) && Number.isFinite(Date.parse(r.criadaEm)) && Number.isFinite(Date.parse(r.atualizadaEm))
    && Array.isArray(r.colaboradores) && r.colaboradores.every(idValida) && Array.isArray(r.acordos)
    && r.acordos.every((a) => objetoFechado(a, ['destinatarioAccountId', 'referencia', 'aceitoEm'])
      && Number.isSafeInteger(a.destinatarioAccountId) && a.destinatarioAccountId > 0
      && Number.isFinite(Date.parse(a.aceitoEm)) && referenciaValida(a.referencia))
    && r.fingerprint === fingerprint(semFingerprint);
}

function projectKeyDaPublicacao(p: PublicacaoDaEmpresa, politica: PoliticaDaEmpresa): string | null {
  const espelhos = politica.contrato === 'ork.rede-empresa-politica/v2' ? politica.espelhos : [];
  const normalizada = normalizarProjeto(p.projeto, { espelhos }).projectKey;
  return 'projectKey' in p && p.projectKey !== normalizada ? null : normalizada;
}

function dePublicacoes(documentos: Array<{ caminho: string; conteudo: string }>, politica: PoliticaDaEmpresa,
  projectKey: string, itemId: string): ReservaColetiva | null {
  for (const documento of documentos) {
    let bruto: unknown;
    try { bruto = JSON.parse(documento.conteudo) as unknown; } catch { continue; }
    if (!ehPublicacaoDaEmpresa(bruto) || projectKeyDaPublicacao(bruto, politica) !== projectKey) continue;
    const reserva = bruto.reservas.find((r) => r.itemId === itemId);
    const trabalho = bruto.trabalhos.find((t) => t.itemId === itemId);
    if (!reserva && !trabalho) continue;
    const base: ReservaSemFingerprint = { contrato: CONTRATO_RESERVA_COLETIVA, projectKey, itemId,
      operationId: `legado-${hash([bruto.inscricaoId, itemId]).slice(0, 24)}`, versao: 1,
      titular: { inscricaoId: bruto.inscricaoId, accountId: bruto.maestro.accountId, loginAtual: bruto.maestro.loginAtual,
        fase: trabalho?.fase ?? 'GOAL' }, criadaEm: reserva?.iniciadaEm ?? bruto.publicadoEm,
      atualizadaEm: bruto.publicadoEm, colaboradores: [], acordos: [] };
    return comFingerprint(base);
  }
  return null;
}

function novaReserva(p: PedidoDeCoordenacao): ReservaColetiva {
  return comFingerprint({ contrato: CONTRATO_RESERVA_COLETIVA, projectKey: p.projectKey, itemId: p.itemId,
    operationId: p.operationId, versao: 1, titular: p.identidade, criadaEm: p.agora,
    atualizadaEm: p.agora, colaboradores: [], acordos: [] });
}

function renovar(atual: ReservaColetiva, pedido: PedidoDeCoordenacao,
  mudanca: Partial<Pick<ReservaColetiva, 'colaboradores' | 'acordos'>> = {}): ReservaColetiva {
  const { fingerprint: _anterior, ...semFingerprint } = atual;
  return comFingerprint({ ...semFingerprint, ...mudanca, operationId: pedido.operationId,
    versao: atual.versao + 1, atualizadaEm: pedido.agora });
}

/** Cada tentativa usa uma ponta e uma única enumeração em lote de publicações. */
export function coordenarTrabalho(porta: PortaDaBranchEmpresa, pedido: PedidoDeCoordenacao): ResultadoDaCoordenacao {
  if (!idValida(pedido.identidade) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(pedido.operationId)
    || !Number.isFinite(Date.parse(pedido.agora)) || !Number.isSafeInteger(pedido.timeoutMs) || pedido.timeoutMs <= 0) {
    throw new Error('rede-empresa.coordenacao-invalida');
  }
  segmentoDaProjectKey(pedido.projectKey);
  let resultado: ReservaColetiva | null = null;
  let codigoOk: Extract<ResultadoDaCoordenacao, { ok: true }>['codigo'] | null = null;
  let falha: CodigoDaCoordenacao | null = null;
  let existente: ReservaColetiva | undefined;
  const transacao = transacionarRedeEmpresa(porta, (ponta) => {
    const politicaLida = lerDocumentoRemoto(ponta, 'politica.json', ehPoliticaDaEmpresa);
    if (politicaLida.estado !== 'presente') {
      falha = politicaLida.estado === 'ausente' ? 'rede-empresa.politica-ausente'
        : politicaLida.estado === 'indisponivel' ? 'rede-empresa.forja-indisponivel' : politicaLida.codigo;
      return null;
    }
    const atualLida = lerDocumentoRemoto(ponta, caminho(pedido.projectKey, pedido.itemId), ehReserva);
    if (atualLida.estado === 'invalido' || atualLida.estado === 'indisponivel') {
      falha = atualLida.estado === 'invalido' ? atualLida.codigo : 'rede-empresa.forja-indisponivel'; return null;
    }
    let publicacoes: Array<{ caminho: string; conteudo: string }> = [];
    try { publicacoes = ponta.listar?.('publicacoes/') ?? []; }
    catch { falha = 'rede-empresa.forja-indisponivel'; return null; }
    const atual = atualLida.estado === 'presente' ? atualLida.valor
      : dePublicacoes(publicacoes, politicaLida.valor, pedido.projectKey, pedido.itemId);
    existente = atual ?? undefined;
    if (pedido.acao === 'reserva') {
      if (atual && (atual.titular.inscricaoId !== pedido.identidade.inscricaoId
        || atual.titular.accountId !== pedido.identidade.accountId)) { falha = 'rede-empresa.reserva-existente'; return null; }
      resultado = atual ? renovar(atual, pedido) : novaReserva(pedido);
      codigoOk = atual ? 'rede-empresa.reserva-propria' : 'rede-empresa.reserva-criada';
    } else if (!atual) { falha = 'rede-empresa.reserva-ausente'; return null; }
    else if (pedido.acao === 'colaborador') {
      const colaboradores = atual.colaboradores.some((c) => c.accountId === pedido.identidade.accountId)
        ? atual.colaboradores : [...atual.colaboradores, pedido.identidade];
      resultado = renovar(atual, pedido, { colaboradores });
      codigoOk = 'rede-empresa.colaboracao-registrada';
    } else {
      if (!pedido.atestacao) { falha = 'rede-empresa.acordo-ausente'; return null; }
      const atestada = verificarAtestacao(pedido.atestacao.porta, pedido.atestacao.referencia, {
        projectKey: pedido.projectKey, itemId: pedido.itemId, reservaVersao: atual.versao,
        reservaFingerprint: atual.fingerprint, emissorAccountId: atual.titular.accountId,
        destinatarioAccountId: pedido.identidade.accountId, agora: pedido.agora, timeoutMs: pedido.timeoutMs,
      });
      if (!atestada.ok) { falha = atestada.codigo; return null; }
      const acordos = actualAcordos(atual, pedido.identidade.accountId, pedido.atestacao.referencia, pedido.agora);
      resultado = renovar(atual, pedido, { acordos });
      codigoOk = 'rede-empresa.acordo-aceito';
    }
    if (JSON.stringify(resultado) === JSON.stringify(atual)) return null;
    return { mensagem: `rede empresa: coordena ${pedido.itemId}`, mudancas: [
      { caminho: caminho(pedido.projectKey, pedido.itemId), conteudo: json(resultado) },
    ] };
  });
  if (falha) return { ok: false, codigo: falha, ...(existente ? { existente } : {}), transacao };
  if (transacao.acao === 'pendente') return { ok: false, codigo: 'rede-empresa.forja-indisponivel', transacao };
  if (transacao.acao === 'falhou') return { ok: false, codigo: 'rede-empresa.concorrencia', transacao };
  return { ok: true, codigo: codigoOk!, reserva: resultado!, transacao };
}

function actualAcordos(atual: ReservaColetiva, destinatarioAccountId: number, referencia: ReferenciaDaAtestacao, aceitoEm: string) {
  return [...atual.acordos.filter((a) => a.destinatarioAccountId !== destinatarioAccountId),
    { destinatarioAccountId, referencia, aceitoEm }];
}

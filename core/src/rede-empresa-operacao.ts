/** RM-089 F2: saga coletiva -> local -> thread -> vínculo, com compensação condicional e reparo idempotente. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { raizDoEstado } from './estado-thread';
import { avaliarCoberturaEmpresa, lerConfigRedeEmpresa, type ResultadoDaCobertura } from './rede-empresa-config';
import { cachePronto, dirDoCache, type CasaDaRede } from './rede';
import { coordenarTrabalho, type IdentidadeColetiva } from './rede-empresa-coordenacao';
import { normalizarProjeto, segmentoDaProjectKey } from './rede-empresa-projeto';
import { portaGitDaRedeEmpresa, transacionarRedeEmpresa } from './rede-empresa-transporte';
import { fingerprintDaReserva, pegarItem, soltarItem, type OpcoesDeReserva, type ResultadoDeReserva } from './roadmap-reservas';
import { remotoDoProjeto } from './projeto-alvo';
import type { Manifesto } from './types';
import { carregarManifesto } from './manifest';
import { fecharAdministrativamente } from './thread-close';

export const CONTRATO_OPERACAO_REDE_EMPRESA = 'ork.rede-empresa-operacao/v1' as const;

export interface EfeitoComFingerprint<T = unknown> { fingerprint: string | null; valor: T }
export interface PortaColetivaDaSaga {
  reservar(operationId: string): EfeitoComFingerprint<{ cobertura: ResultadoDaCobertura }>;
  soltar(fingerprint: string): boolean;
}
export interface PortaLocalDaSaga<T = unknown> {
  reservar(operationId: string): EfeitoComFingerprint<T>;
  vincular(threadId: string, fingerprint: string, operationId: string): EfeitoComFingerprint<T>;
  soltar(fingerprint: string): boolean;
}
export interface PortaThreadDaSaga { finalizar(threadId: string): boolean }

export interface OperacaoDaRedeEmpresa {
  contrato: typeof CONTRATO_OPERACAO_REDE_EMPRESA;
  operationId: string;
  projectKey: string;
  itemId: string;
  estado: 'em-andamento' | 'concluida' | 'compensada' | 'reconciliacao-pendente';
  etapa: 'inicio' | 'coletiva' | 'local' | 'thread' | 'vinculo' | 'fim';
  coletivaFingerprint: string | null;
  localFingerprint: string | null;
  threadId: string | null;
  criadaEm: string;
  atualizadaEm: string;
  erro: string | null;
}

export class ErroDeReconciliacao extends Error {
  readonly codigo = 'rede-empresa.reconciliacao-pendente';
  constructor(readonly operacao: OperacaoDaRedeEmpresa) {
    super(`rede-empresa.reconciliacao-pendente: ${operacao.itemId}; ` +
      `rode ork roadmap reconciliar ${operacao.itemId} --operacao ${operacao.operationId}`);
  }
}

export class ErroDeOperacaoCorrompida extends Error {
  readonly codigo = 'rede-empresa.operacao-invalida';
  constructor(readonly caminho: string) { super(`rede-empresa.operacao-invalida: ${caminho}`); }
}

const dir = (raiz: string): string => path.join(raizDoEstado(raiz), '.orkastery', 'reconciliacoes-rede');
const arquivo = (raiz: string, operationId: string): string => {
  if (!/^op-[a-f0-9-]{16,64}$/.test(operationId)) throw new Error('rede-empresa.operation-id-invalido');
  return path.join(dir(raiz), `${operationId}.json`);
};

function gravar(raiz: string, op: OperacaoDaRedeEmpresa): void {
  const destino = arquivo(raiz, op.operationId);
  fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
  const tmp = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(op, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, destino);
}

export function lerOperacaoDaRedeEmpresa(raiz: string, operationId: string): OperacaoDaRedeEmpresa {
  const destino = arquivo(raiz, operationId), relativo = `reconciliacoes-rede/${path.basename(destino)}`;
  let v: OperacaoDaRedeEmpresa;
  try { v = JSON.parse(fs.readFileSync(destino, 'utf8')) as OperacaoDaRedeEmpresa; }
  catch { throw new ErroDeOperacaoCorrompida(relativo); }
  const fingerprint = (f: unknown) => f === null || typeof f === 'string' && f.length > 0 && f.length <= 256;
  const iso = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s));
  const chaves = ['contrato', 'operationId', 'projectKey', 'itemId', 'estado', 'etapa', 'coletivaFingerprint',
    'localFingerprint', 'threadId', 'criadaEm', 'atualizadaEm', 'erro'];
  if (!v || typeof v !== 'object' || Object.keys(v).length !== chaves.length || !chaves.every((k) => k in v)
    || v.contrato !== CONTRATO_OPERACAO_REDE_EMPRESA || v.operationId !== operationId
    || typeof v.projectKey !== 'string' || !/^RM-[0-9]{3,}$/.test(v.itemId)
    || !['em-andamento', 'concluida', 'compensada', 'reconciliacao-pendente'].includes(v.estado)
    || !['inicio', 'coletiva', 'local', 'thread', 'vinculo', 'fim'].includes(v.etapa)
    || !fingerprint(v.coletivaFingerprint) || !fingerprint(v.localFingerprint)
    || !(v.threadId === null || typeof v.threadId === 'string' && v.threadId.length > 0)
    || !iso(v.criadaEm) || !iso(v.atualizadaEm) || !(v.erro === null || typeof v.erro === 'string')) {
    throw new ErroDeOperacaoCorrompida(relativo);
  }
  return v;
}

function operacoes(raiz: string): OperacaoDaRedeEmpresa[] {
  const pasta = dir(raiz);
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta).filter((n) => /^op-[a-f0-9-]{16,64}\.json$/.test(n))
    .map((n) => lerOperacaoDaRedeEmpresa(raiz, n.slice(0, -'.json'.length)));
}

export function exigirSemReconciliacaoPendente(raiz: string, projectKey: string, itemId: string): void {
  const pendente = operacoes(raiz).find((o) => o.contrato === CONTRATO_OPERACAO_REDE_EMPRESA
    && o.projectKey === projectKey && o.itemId === itemId
    && (o.estado === 'em-andamento' || o.estado === 'reconciliacao-pendente'));
  if (pendente) throw new ErroDeReconciliacao(pendente);
}

const erroCurto = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);
const idDaOperacao = (): string => `op-${randomUUID()}`;

interface BaseDaSaga<TLocal> {
  raiz: string;
  projectKey: string;
  itemId: string;
  coletiva: PortaColetivaDaSaga;
  local: PortaLocalDaSaga<TLocal>;
  thread?: PortaThreadDaSaga;
  operationId?: string;
  agora?: string;
}

function inicio<T>(p: BaseDaSaga<T>): OperacaoDaRedeEmpresa {
  exigirSemReconciliacaoPendente(p.raiz, p.projectKey, p.itemId);
  const agora = p.agora ?? new Date().toISOString();
  const op: OperacaoDaRedeEmpresa = { contrato: CONTRATO_OPERACAO_REDE_EMPRESA, operationId: p.operationId ?? idDaOperacao(),
    projectKey: p.projectKey, itemId: p.itemId, estado: 'em-andamento', etapa: 'inicio', coletivaFingerprint: null,
    localFingerprint: null, threadId: null, criadaEm: agora, atualizadaEm: agora, erro: null };
  gravar(p.raiz, op);
  return op;
}

function avanca(raiz: string, op: OperacaoDaRedeEmpresa, mudanca: Partial<OperacaoDaRedeEmpresa>): OperacaoDaRedeEmpresa {
  const nova = { ...op, ...mudanca, atualizadaEm: new Date().toISOString() };
  gravar(raiz, nova);
  return nova;
}

function compensar<T>(p: BaseDaSaga<T>, op: OperacaoDaRedeEmpresa, erro: unknown): never {
  let threadOk = true, localOk = true, coletivaOk = true;
  if (op.threadId) {
    try { threadOk = p.thread?.finalizar(op.threadId) === true; } catch { threadOk = false; }
  }
  if (op.localFingerprint) {
    try { localOk = p.local.soltar(op.localFingerprint); } catch { localOk = false; }
  }
  if (op.coletivaFingerprint) {
    try { coletivaOk = p.coletiva.soltar(op.coletivaFingerprint); } catch { coletivaOk = false; }
  }
  const precisaReconciliar = !threadOk || !localOk || !coletivaOk;
  const final = avanca(p.raiz, op, { estado: precisaReconciliar ? 'reconciliacao-pendente' : 'compensada', etapa: 'fim',
    erro: erroCurto(erro), ...(threadOk ? { threadId: null } : {}), ...(localOk ? { localFingerprint: null } : {}),
    ...(coletivaOk ? { coletivaFingerprint: null } : {}) });
  if (precisaReconciliar) throw new ErroDeReconciliacao(final);
  throw erro;
}

export function executarReservaCoordenada<TLocal>(p: BaseDaSaga<TLocal>): {
  operationId: string; local: TLocal; cobertura: ResultadoDaCobertura;
} {
  let op = inicio(p);
  try {
    const coletiva = p.coletiva.reservar(op.operationId);
    op = avanca(p.raiz, op, { etapa: 'coletiva', coletivaFingerprint: coletiva.fingerprint });
    const local = p.local.reservar(op.operationId);
    op = avanca(p.raiz, op, { etapa: 'local', localFingerprint: local.fingerprint });
    op = avanca(p.raiz, op, { estado: 'concluida', etapa: 'fim' });
    return { operationId: op.operationId, local: local.valor, cobertura: coletiva.valor.cobertura };
  } catch (e) { return compensar(p, op, e); }
}

export function executarSagaDaThread<TThread, TLocal>(p: BaseDaSaga<TLocal> & {
  criarThread(operationId: string): { threadId: string; valor: TThread };
}): { operationId: string; thread: TThread; local: TLocal; cobertura: ResultadoDaCobertura } {
  let op = inicio(p);
  try {
    const coletiva = p.coletiva.reservar(op.operationId);
    op = avanca(p.raiz, op, { etapa: 'coletiva', coletivaFingerprint: coletiva.fingerprint });
    const local = p.local.reservar(op.operationId);
    op = avanca(p.raiz, op, { etapa: 'local', localFingerprint: local.fingerprint });
    if (!local.fingerprint) throw new Error('rede-empresa.snapshot-local-ausente');
    const thread = p.criarThread(op.operationId);
    op = avanca(p.raiz, op, { etapa: 'thread', threadId: thread.threadId });
    const vinculada = p.local.vincular(thread.threadId, local.fingerprint, op.operationId);
    if (!vinculada.fingerprint) throw new Error('rede-empresa.vinculo-local-ausente');
    op = avanca(p.raiz, op, { etapa: 'vinculo', localFingerprint: vinculada.fingerprint });
    op = avanca(p.raiz, op, { estado: 'concluida', etapa: 'fim' });
    return { operationId: op.operationId, thread: thread.valor, local: vinculada.valor, cobertura: coletiva.valor.cobertura };
  } catch (e) { return compensar(p, op, e); }
}

/** Relê os dois lados e só remove a snapshot que ainda tem a fingerprint gravada. Repetir depois do fim é no-op. */
export function reconciliarOperacaoDaRedeEmpresa<T>(raiz: string, operationId: string,
  portas: { coletiva: Pick<PortaColetivaDaSaga, 'soltar'>; local: Pick<PortaLocalDaSaga<T>, 'soltar'>;
    thread?: PortaThreadDaSaga }): OperacaoDaRedeEmpresa {
  let op = lerOperacaoDaRedeEmpresa(raiz, operationId);
  if (op.estado === 'concluida' || op.estado === 'compensada') return op;
  let threadOk = true, localOk = true, coletivaOk = true;
  if (op.threadId) {
    try { threadOk = portas.thread?.finalizar(op.threadId) === true; } catch { threadOk = false; }
  }
  if (op.localFingerprint) {
    try { localOk = portas.local.soltar(op.localFingerprint); } catch { localOk = false; }
  }
  if (op.coletivaFingerprint) {
    try { coletivaOk = portas.coletiva.soltar(op.coletivaFingerprint); } catch { coletivaOk = false; }
  }
  op = avanca(raiz, op, { estado: threadOk && localOk && coletivaOk ? 'compensada' : 'reconciliacao-pendente', etapa: 'fim',
    ...(threadOk ? { threadId: null } : {}), ...(localOk ? { localFingerprint: null } : {}),
    ...(coletivaOk ? { coletivaFingerprint: null } : {}) });
  return op;
}

/** Finaliza de modo auditável a thread que a saga criou e não conseguiu vincular. */
export function portaThreadOrfa(raiz: string): PortaThreadDaSaga {
  return { finalizar(threadId) {
    const fechada = fecharAdministrativamente(raiz, threadId, { motivo: 'orfa', por: 'ork.rede-empresa-saga',
      justificativa: 'falha ao vincular a reserva coletiva à thread criada' });
    return fechada.status === 'fechada' && fechada.fechamentoAdmin?.motivo === 'orfa';
  } };
}

export function portaLocalDoRoadmap(raiz: string, itemId: string, opcoes: OpcoesDeReserva = {}): PortaLocalDaSaga<ResultadoDeReserva> {
  return {
    reservar(operationId) {
      const valor = pegarItem(raiz, itemId, { ...opcoes, operationId });
      if (!valor.reserva) throw new Error('rede-empresa.snapshot-local-ausente');
      return { fingerprint: fingerprintDaReserva(valor.reserva), valor };
    },
    vincular(threadId, esperado, operationId) {
      const valor = pegarItem(raiz, itemId, { ...opcoes, thread: threadId, operationId, fingerprintEsperada: esperado });
      if (valor.acao === 'nada' || !valor.reserva) throw new Error('rede-empresa.snapshot-local-divergente');
      return { fingerprint: fingerprintDaReserva(valor.reserva), valor };
    },
    soltar(esperado) {
      const valor = soltarItem(raiz, itemId, { ...opcoes, fingerprintEsperada: esperado });
      return valor.acao === 'soltou' || (valor.acao === 'nada' && valor.reserva === null);
    },
  };
}

export class ErroDaReservaColetiva extends Error {
  constructor(readonly codigo: string, readonly existente?: { inscricaoId: string; loginAtual: string; projectKey: string; fase: string }) {
    super(existente ? `${codigo}: ${existente.inscricaoId} (${existente.loginAtual}) em ${existente.projectKey}, fase ${existente.fase}` : codigo);
  }
}

const coberturaSemRede = (projectKey: string, itemId: string, cache?: Parameters<typeof avaliarCoberturaEmpresa>[0]['cache']): ResultadoDaCobertura =>
  avaliarCoberturaEmpresa({ configurada: !!cache, conferida: false, ...(cache ? { cache } : {}), projectKey, itemId,
    agora: new Date().toISOString() });

function referenciaDaEmpresa(caminho: string): { dono: string; repositorio: string } {
  const partes = caminho.split('/');
  return { dono: partes.slice(0, -1).join('/'), repositorio: partes.at(-1)! };
}

/** Adaptador da saga para a inscrição ativa do projeto; sem inscrição, observar/avisar seguem visíveis e sem CAS coletivo. */
export function portaColetivaDoProjeto(raiz: string, manifesto: Manifesto, itemId: string,
  fase: IdentidadeColetiva['fase'] = 'GOAL'): { projectKey: string; configurada: boolean; porta: PortaColetivaDaSaga } {
  const remoto = remotoDoProjeto(raiz, 'origin');
  let projectKey = `github:local.invalid/${manifesto.project.abbrev.toLowerCase()}`;
  if (remoto) {
    try { projectKey = normalizarProjeto(remoto, { forja: manifesto.forja }).projectKey; } catch { /* remoto local não entra na rede coletiva */ }
  }
  const inscricoes = lerConfigRedeEmpresa().inscricoes.filter((i) => i.estado === 'ativa');
  const adesao = inscricoes.find((i) => i.projetos.some((p) => {
    const espelhos = i.politicaCache?.espelhos ?? [];
    try { return !!remoto && normalizarProjeto(p, { espelhos }).projectKey
      === normalizarProjeto(remoto, { forja: manifesto.forja, espelhos }).projectKey; } catch { return false; }
  }));
  if (!adesao) {
    const cobertura = coberturaSemRede(projectKey, itemId);
    return { projectKey, configurada: false,
      porta: { reservar: () => ({ fingerprint: null, valor: { cobertura } }), soltar: () => true } };
  }
  if (remoto) projectKey = normalizarProjeto(remoto, { forja: manifesto.forja,
    espelhos: adesao.politicaCache?.espelhos ?? [] }).projectKey;
  const casaPartes = referenciaDaEmpresa(adesao.empresa.caminho);
  const casa: CasaDaRede = { forja: adesao.empresa.forja, host: adesao.empresa.host, ...casaPartes, origem: 'opcao' };
  const cache = dirDoCache(casa);
  if (!cachePronto(cache)) {
    const cobertura = coberturaSemRede(projectKey, itemId, adesao.politicaCache);
    return { projectKey, configurada: true, porta: {
      reservar: () => {
        if (!cobertura.permite) throw new ErroDaReservaColetiva(cobertura.codigo);
        return { fingerprint: null, valor: { cobertura } };
      }, soltar: () => true,
    } };
  }
  const branch = portaGitDaRedeEmpresa(cache);
  const identidade: IdentidadeColetiva = { inscricaoId: adesao.inscricaoId, accountId: adesao.maestroRef.accountId,
    loginAtual: adesao.loginAtual, fase };
  const caminho = `coordenacao/${segmentoDaProjectKey(projectKey)}/${itemId}.json`;
  return { projectKey, configurada: true, porta: {
    reservar(operationId) {
      const r = coordenarTrabalho(branch, { acao: 'reserva', operationId, projectKey, itemId, identidade,
        agora: new Date().toISOString(), timeoutMs: 15_000 });
      if (r.ok) {
        const nivel = adesao.politicaCache?.nivel ?? 'observar';
        const cobertura: ResultadoDaCobertura = { nivel, estado: 'conferida', permite: true,
          codigo: 'rede-empresa.cobertura-ok', reciboVersao: adesao.politicaCache?.reciboVersao ?? null, auditavel: true };
        return { fingerprint: r.reserva.fingerprint, valor: { cobertura } };
      }
      if (r.codigo === 'rede-empresa.forja-indisponivel' || r.codigo === 'rede-empresa.politica-ausente') {
        const cobertura = coberturaSemRede(projectKey, itemId, adesao.politicaCache);
        if (cobertura.permite) return { fingerprint: null, valor: { cobertura } };
        throw new ErroDaReservaColetiva(cobertura.codigo);
      }
      const e = r.existente;
      throw new ErroDaReservaColetiva(r.codigo, e ? { inscricaoId: e.titular.inscricaoId,
        loginAtual: e.titular.loginAtual, projectKey: e.projectKey, fase: e.titular.fase } : undefined);
    },
    soltar(esperado) {
      let divergiu = false;
      const t = transacionarRedeEmpresa(branch, (ponta) => {
        const texto = ponta.ler(caminho);
        if (texto === null) return null;
        let atual: { fingerprint?: unknown };
        try { atual = JSON.parse(texto) as { fingerprint?: unknown }; } catch { divergiu = true; return null; }
        if (atual.fingerprint !== esperado) { divergiu = true; return null; }
        return { mensagem: `rede empresa: compensa ${itemId}`, mudancas: [{ caminho, conteudo: null }] };
      });
      return !divergiu && (t.acao === 'publicou' || t.acao === 'sem-mudanca');
    },
  } };
}

export interface SolturaColetivaDaThread { itemId: string; operationId: string; acao: 'solta' | 'intocada'; }

/** O fechamento libera a reserva coletiva da mesma saga, sem tocar uma renovação posterior. */
export function soltarReservaColetivaDaThread(raiz: string, threadId: string): SolturaColetivaDaThread[] {
  const carregado = carregarManifesto(raiz);
  if (!carregado) return [];
  const candidatas = operacoes(raiz).filter((o) => o.threadId === threadId && o.estado === 'concluida' && !!o.coletivaFingerprint);
  return candidatas.map((op) => {
    const coletiva = portaColetivaDoProjeto(raiz, carregado.manifesto, op.itemId);
    const ok = coletiva.projectKey === op.projectKey && coletiva.porta.soltar(op.coletivaFingerprint!);
    if (ok) avanca(raiz, op, { coletivaFingerprint: null });
    return { itemId: op.itemId, operationId: op.operationId, acao: ok ? 'solta' : 'intocada' };
  });
}

/** RM-089 F5: contrato concentrado da projeção de replay e do recibo emitido pelo runner. */
import { createHash } from 'node:crypto';
import type { ModoDoCheck } from './check-modo';
import type { Claim, CausaDoComando, DependenciaExternaDaClaim, ResultadoDeComando } from './types';

export const CONTRATO_PROJECAO_REPLAY_CI = 'ork.ci-projecao-replay/v1' as const;
export const CONTRATO_RECIBO_RUNNER_CI = 'ork.ci-recibo-runner/v1' as const;

export const CAUSAS_DEGRADACAO_REPLAY_CI = [
  'projecao-acima-do-limite',
  'claim-nao-hermetica',
  'runner-sem-capacidade',
  'comando-nao-iniciado',
  'prazo-excedido',
  'produto-alterado',
] as const;

export type CausaDegradacaoReplayCi = typeof CAUSAS_DEGRADACAO_REPLAY_CI[number];

export const CODIGO_DA_DEGRADACAO_REPLAY_CI: Readonly<Record<CausaDegradacaoReplayCi, string>> = {
  'projecao-acima-do-limite': 'ci.recibo.projecao-acima-do-limite',
  'claim-nao-hermetica': 'ci.recibo.claim-nao-hermetica',
  'runner-sem-capacidade': 'ci.recibo.runner-sem-capacidade',
  'comando-nao-iniciado': 'ci.recibo.comando-nao-iniciado',
  'prazo-excedido': 'ci.recibo.prazo-excedido',
  'produto-alterado': 'ci.recibo.produto-alterado',
};

export interface ClaimProjetadaReplayCi {
  id: string;
  thread: string;
  fase: Claim['fase'];
  arquivo: string;
  alegacao: string;
  negativa: boolean;
  verificar: string[];
  dependenciasExternas?: DependenciaExternaDaClaim[];
  origem?: Claim['origem'];
}

export interface ResultadoBaselineReplayCi {
  nome: string;
  ok: boolean;
  code: number;
  causa?: CausaDoComando;
  executado?: boolean;
  testeQueCaiu?: string[];
}

export interface BaselineReplayCi {
  commit: string;
  comandos: ResultadoBaselineReplayCi[];
  check?: { modo: ModoDoCheck };
}

export interface RodadaProjetadaReplayCi {
  check: ModoDoCheck;
  claimsSha256: string;
  commandsSha256: string;
}

export interface ProjecaoReplayCi {
  contrato: typeof CONTRATO_PROJECAO_REPLAY_CI;
  thread: string;
  claims: ClaimProjetadaReplayCi[];
  rodada: RodadaProjetadaReplayCi;
  baseline: BaselineReplayCi | null;
  commands: Array<{ name: string; command: string }>;
  sha256: string;
}

export interface ReciboRunnerCi {
  contrato: typeof CONTRATO_RECIBO_RUNNER_CI;
  head: string;
  thread: string;
  claimsSha256: string;
  rodadaSha256: string;
  check: ModoDoCheck;
  resultado: { ok: boolean; motivos: string[] };
  sha256: string;
  /** Reservado para a F7; a F5 nunca preenche nem eleva confiança. */
  assinatura?: unknown;
}

export type EstadoDoReciboRunnerCi = 'presente' | 'invalido' | 'sha-divergente';

export const LIMITE_DA_PROJECAO_REPLAY_CI_BYTES = 1024 * 1024;
const HEX_64 = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;

export const sha256Ci = (valor: string): string => createHash('sha256').update(valor).digest('hex');

export function claimsProjetadas(claims: readonly Claim[]): ClaimProjetadaReplayCi[] {
  return claims.filter((claim) => claim.estado !== 'retirada')
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((claim) => ({
      id: claim.id,
      thread: claim.thread,
      fase: claim.fase,
      arquivo: claim.arquivo,
      alegacao: claim.alegacao,
      negativa: claim.negativa,
      verificar: [...claim.verificar],
      ...(claim.dependenciasExternas?.length ? { dependenciasExternas: [...claim.dependenciasExternas].sort() } : {}),
      ...(claim.origem ? { origem: claim.origem } : {}),
    }));
}

export function baselineProjetada(baseline: { commit: string; comandos: ResultadoDeComando[];
  check?: { modo: ModoDoCheck } } | null | undefined): BaselineReplayCi | null {
  if (!baseline) return null;
  return {
    commit: baseline.commit,
    comandos: baseline.comandos.map((comando) => ({
      nome: comando.nome,
      ok: comando.ok,
      code: comando.code,
      ...(comando.causa ? { causa: comando.causa } : {}),
      ...(comando.executado !== undefined ? { executado: comando.executado } : {}),
      ...(comando.testeQueCaiu?.length ? { testeQueCaiu: [...comando.testeQueCaiu] } : {}),
    })),
    ...(baseline.check ? { check: { modo: baseline.check.modo } } : {}),
  };
}

function corpoDaProjecao(projecao: Omit<ProjecaoReplayCi, 'sha256'> | ProjecaoReplayCi) {
  return {
    contrato: projecao.contrato,
    thread: projecao.thread,
    claims: projecao.claims,
    rodada: projecao.rodada,
    baseline: projecao.baseline,
    commands: projecao.commands,
  };
}

export function criarProjecaoReplayCi(entrada: {
  thread: string;
  claims: readonly Claim[];
  check: ModoDoCheck;
  baseline: { commit: string; comandos: ResultadoDeComando[]; check?: { modo: ModoDoCheck } } | null | undefined;
  commands: Array<{ name: string; command: string }>;
}): ProjecaoReplayCi {
  const claims = claimsProjetadas(entrada.claims);
  const commands = entrada.commands.map((command) => ({ ...command }));
  const rodada = {
    check: entrada.check,
    claimsSha256: sha256Ci(JSON.stringify(claims)),
    commandsSha256: sha256Ci(JSON.stringify(commands)),
  };
  const corpo = {
    contrato: CONTRATO_PROJECAO_REPLAY_CI,
    thread: entrada.thread,
    claims,
    rodada,
    baseline: baselineProjetada(entrada.baseline),
    commands,
  };
  return { ...corpo, sha256: sha256Ci(JSON.stringify(corpo)) };
}

function claimProjetadaValida(valor: unknown, thread: string): valor is ClaimProjetadaReplayCi {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const c = valor as Record<string, unknown>;
  return typeof c.id === 'string' && c.thread === thread && typeof c.arquivo === 'string' &&
    typeof c.alegacao === 'string' && typeof c.negativa === 'boolean' &&
    Array.isArray(c.verificar) && c.verificar.every((comando) => typeof comando === 'string');
}

/** Validação fechada da entrada não confiável do PR/MR. */
export function validarProjecaoReplayCi(valor: unknown):
  { ok: true; projecao: ProjecaoReplayCi } | { ok: false; causa: 'invalida' | 'projecao-acima-do-limite' } {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(valor), 'utf8'); } catch { return { ok: false, causa: 'invalida' }; }
  if (bytes > LIMITE_DA_PROJECAO_REPLAY_CI_BYTES) return { ok: false, causa: 'projecao-acima-do-limite' };
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return { ok: false, causa: 'invalida' };
  const p = valor as Record<string, unknown>;
  if (p.contrato !== CONTRATO_PROJECAO_REPLAY_CI || typeof p.thread !== 'string' || !/^ork-[a-z0-9-]+$/.test(p.thread) ||
      !Array.isArray(p.claims) || !p.claims.every((claim) => claimProjetadaValida(claim, p.thread as string)) ||
      !Array.isArray(p.commands) || !p.commands.every((command) => !!command && typeof command === 'object' &&
        !Array.isArray(command) && typeof (command as Record<string, unknown>).name === 'string' &&
        typeof (command as Record<string, unknown>).command === 'string') ||
      !p.rodada || typeof p.rodada !== 'object' || Array.isArray(p.rodada) ||
      typeof p.sha256 !== 'string' || !HEX_64.test(p.sha256)) return { ok: false, causa: 'invalida' };
  const rodada = p.rodada as Record<string, unknown>;
  if ((rodada.check !== 'agile' && rodada.check !== 'classic') || !HEX_64.test(String(rodada.claimsSha256)) ||
      !HEX_64.test(String(rodada.commandsSha256))) return { ok: false, causa: 'invalida' };
  const projecao = valor as ProjecaoReplayCi;
  if (rodada.claimsSha256 !== sha256Ci(JSON.stringify(projecao.claims)) ||
      rodada.commandsSha256 !== sha256Ci(JSON.stringify(projecao.commands)) ||
      projecao.sha256 !== sha256Ci(JSON.stringify(corpoDaProjecao(projecao)))) return { ok: false, causa: 'invalida' };
  return { ok: true, projecao };
}

function corpoDoRecibo(recibo: Omit<ReciboRunnerCi, 'sha256' | 'assinatura'> | ReciboRunnerCi) {
  return {
    contrato: recibo.contrato,
    head: recibo.head,
    thread: recibo.thread,
    claimsSha256: recibo.claimsSha256,
    rodadaSha256: recibo.rodadaSha256,
    check: recibo.check,
    resultado: recibo.resultado,
  };
}

export function emitirReciboRunnerCi(projecao: ProjecaoReplayCi, head: string,
  resultado: { ok: boolean; motivos: string[] }): ReciboRunnerCi {
  const corpo = {
    contrato: CONTRATO_RECIBO_RUNNER_CI,
    head,
    thread: projecao.thread,
    claimsSha256: projecao.rodada.claimsSha256,
    rodadaSha256: sha256Ci(JSON.stringify(projecao.rodada)),
    check: projecao.rodada.check,
    resultado: { ok: resultado.ok, motivos: [...resultado.motivos] },
  };
  return { ...corpo, sha256: sha256Ci(JSON.stringify(corpo)) };
}

export function estadoDoReciboRunnerCi(recibo: unknown, headAtual: string): EstadoDoReciboRunnerCi {
  if (!recibo || typeof recibo !== 'object' || Array.isArray(recibo) || !HEAD.test(headAtual)) return 'invalido';
  const r = recibo as Record<string, unknown>;
  if (r.contrato !== CONTRATO_RECIBO_RUNNER_CI || typeof r.head !== 'string' || !HEAD.test(r.head) ||
      typeof r.thread !== 'string' || typeof r.claimsSha256 !== 'string' || !HEX_64.test(r.claimsSha256) ||
      typeof r.rodadaSha256 !== 'string' || !HEX_64.test(r.rodadaSha256) ||
      (r.check !== 'agile' && r.check !== 'classic') || !r.resultado || typeof r.resultado !== 'object' ||
      Array.isArray(r.resultado) || typeof r.sha256 !== 'string' || !HEX_64.test(r.sha256)) return 'invalido';
  const resultado = r.resultado as Record<string, unknown>;
  if (typeof resultado.ok !== 'boolean' || !Array.isArray(resultado.motivos) ||
      !resultado.motivos.every((motivo) => typeof motivo === 'string') ||
      r.sha256 !== sha256Ci(JSON.stringify(corpoDoRecibo(r as unknown as ReciboRunnerCi)))) return 'invalido';
  return r.head === headAtual ? 'presente' : 'sha-divergente';
}

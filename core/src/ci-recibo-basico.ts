/** RM-089 F5: contrato concentrado da projeção de replay e do recibo emitido pelo runner. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ModoDoCheck } from './check-modo';
import type { Manifesto } from './types';
import type { Claim, CausaDoComando, DependenciaExternaDaClaim, ResultadoDeClaim, ResultadoDeComando } from './types';
import { executar, identidadeDoProduto, julgarResultadoDoVerify, prazoDoComando, verificarClaim,
  type ExecutorVerify, type JulgamentoVerify } from './verify';

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
  preparo?: { name: 'preparo'; command: string };
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

export interface ResultadoReplayCi {
  ok: boolean;
  thread: string;
  commit: string;
  preparo: ResultadoDeComando | null;
  claims: ResultadoDeClaim[];
  commands: ResultadoDeComando[];
  julgamento: JulgamentoVerify | null;
  recibo?: ReciboRunnerCi;
  degradacao?: CausaDegradacaoReplayCi;
  invalida?: true;
}

export type ExecutorReplayCi = (entrada: { nome: string; comando: string; cwd: string; prazoMs: number;
  ambiente: NodeJS.ProcessEnv }) => ResultadoDeComando;

/** Receita lida fora do checkout do PR/MR, no manifesto da branch de destino. */
export interface ReceitaConfiavelReplayCi {
  commands: ReadonlyArray<{ name: string; command: string }>;
  preparo?: string;
}

export interface OpcoesReplayCi {
  raiz: string;
  manifesto: Manifesto;
  head: string;
  ambiente?: NodeJS.ProcessEnv;
  executor?: ExecutorReplayCi;
  /** Dependência pura dos testes; produção usa a identidade do produto do verify. */
  identidadeProduto?: () => string;
  /** Retorna o motivo de uma claim não poder ser reexecutada integralmente no checkout. */
  hermeticidade?: (claim: ClaimProjetadaReplayCi) => string | null;
  capacidade?: () => boolean;
  casaEfemera?: string;
  /** Receita externa ao PR/MR; `null` falha fechada quando a fonte protegida não pode ser lida. */
  receitaConfiavel?: ReceitaConfiavelReplayCi | null;
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
  preparo?: string;
}): ProjecaoReplayCi {
  const claims = claimsProjetadas(entrada.claims);
  const commands = entrada.commands.map((command) => ({ ...command }));
  const rodada = {
    check: entrada.check,
    claimsSha256: sha256Ci(JSON.stringify(claims)),
    commandsSha256: sha256Ci(JSON.stringify(commands)),
    ...(entrada.preparo ? { preparo: { name: 'preparo' as const, command: entrada.preparo } } : {}),
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
  if (rodada.preparo !== undefined && (!rodada.preparo || typeof rodada.preparo !== 'object' ||
      Array.isArray(rodada.preparo) || (rodada.preparo as Record<string, unknown>).name !== 'preparo' ||
      typeof (rodada.preparo as Record<string, unknown>).command !== 'string' ||
      !(rodada.preparo as Record<string, string>).command.trim())) return { ok: false, causa: 'invalida' };
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

const VARIAVEIS_PRIMITIVAS_DO_REPLAY = new Set([
  'PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI',
]);

function variavelBloqueada(chave: string): boolean {
  return chave === 'GITHUB_TOKEN' || chave === 'CI_JOB_TOKEN' || chave.endsWith('_TOKEN') ||
    chave.endsWith('_SECRET') || chave.startsWith('ORK_HITL_');
}

/** Ambiente novo: só primitivas de execução e valores sintéticos da própria rodada. */
export function ambienteDoReplayCi(base: NodeJS.ProcessEnv = {}, geradas: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const permitido = Object.fromEntries(Object.entries(base).filter(([chave, valor]) =>
    valor !== undefined && VARIAVEIS_PRIMITIVAS_DO_REPLAY.has(chave) && !variavelBloqueada(chave)));
  const sintetico = Object.fromEntries(Object.entries(geradas).filter(([chave, valor]) =>
    valor !== undefined && !variavelBloqueada(chave)));
  return { ...permitido, ...sintetico, CI: 'true' };
}

/** Conservadora sem estado local; o adaptador pode acrescentar verificações do checkout. */
export function motivoClaimNaoHermeticaReplayCi(claim: ClaimProjetadaReplayCi): string | null {
  if (path.isAbsolute(claim.arquivo) || claim.arquivo.split(/[\\/]/).includes('..') ||
      claim.arquivo.replaceAll('\\', '/').startsWith('.orkastery/')) return 'artifact-not-in-checkout';
  if (claim.dependenciasExternas?.length) return 'external-dependency';
  if (claim.verificar.length === 0) return 'without-command';
  if (claim.verificar.some((comando) => /(^|[\s'"/])\.orkastery(?:[\s'"/]|$)|(^|[\s;&|])\/home\//.test(comando))) {
    return 'local-state';
  }
  return null;
}

function claimDoReplay(claim: ClaimProjetadaReplayCi): Claim {
  return { ...claim, criadoEm: '', estado: 'pendente' };
}

function causaDaExecucao(resultados: readonly ResultadoDeComando[]): CausaDegradacaoReplayCi | null {
  if (resultados.some((resultado) => resultado.executado === false || resultado.causa === 'nao-encontrado')) {
    return 'comando-nao-iniciado';
  }
  if (resultados.some((resultado) => resultado.causa === 'timeout')) return 'prazo-excedido';
  return null;
}

/**
 * Reexecuta a projeção integralmente no checkout. Não lê thread, claims ou ledger e não grava estado.
 * O julgamento é exatamente o auxiliar puro usado pelo `ork verify` local.
 */
export function reexecutarProjecaoReplayCi(valor: unknown, opcoes: OpcoesReplayCi): ResultadoReplayCi {
  const validacao = validarProjecaoReplayCi(valor);
  if (!validacao.ok) return { ok: true, thread: '', commit: opcoes.head, preparo: null, claims: [], commands: [],
    julgamento: null, ...(validacao.causa === 'projecao-acima-do-limite'
      ? { degradacao: validacao.causa } : { invalida: true as const }) };
  const projecao = validacao.projecao;
  if (projecao.claims.length === 0 || opcoes.receitaConfiavel === null ||
      (opcoes.receitaConfiavel !== undefined &&
        (JSON.stringify(projecao.commands) !== JSON.stringify(opcoes.receitaConfiavel.commands) ||
          projecao.rodada.preparo?.command !== opcoes.receitaConfiavel.preparo))) {
    return { ok: true, thread: projecao.thread, commit: opcoes.head, preparo: null, claims: [], commands: [],
      julgamento: null, invalida: true };
  }
  const hermeticidade = opcoes.hermeticidade ?? motivoClaimNaoHermeticaReplayCi;
  if (projecao.claims.some((claim) => hermeticidade(claim) !== null)) {
    return { ok: true, thread: projecao.thread, commit: opcoes.head, preparo: null, claims: [], commands: [],
      julgamento: null, degradacao: 'claim-nao-hermetica' };
  }
  if (opcoes.capacidade && !opcoes.capacidade()) {
    return { ok: true, thread: projecao.thread, commit: opcoes.head, preparo: null, claims: [], commands: [],
      julgamento: null, degradacao: 'runner-sem-capacidade' };
  }

  const criada = !opcoes.casaEfemera;
  let casa: string;
  try { casa = opcoes.casaEfemera ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ork-ci-replay-')); }
  catch {
    return { ok: true, thread: projecao.thread, commit: opcoes.head, preparo: null, claims: [], commands: [],
      julgamento: null, degradacao: 'runner-sem-capacidade' };
  }
  try {
    const ambiente = ambienteDoReplayCi(opcoes.ambiente, {
      HOME: casa,
      ORKASTERY_HOME: casa,
      TMPDIR: casa,
      ORK_CHECK_MODO: projecao.rodada.check,
    });
    const executorBruto: ExecutorReplayCi = opcoes.executor ?? ((entrada) => executar(entrada.nome, entrada.comando,
      entrada.cwd, entrada.prazoMs, undefined, entrada.ambiente));
    const executor: ExecutorVerify = (nome, comando, cwd) => executorBruto({ nome, comando, cwd,
      prazoMs: prazoDoComando(opcoes.manifesto, nome === 'preparo' ? 'preparo' : nome), ambiente });
    const preparo = projecao.rodada.preparo
      ? executor('preparo', projecao.rodada.preparo.command, opcoes.raiz) : null;
    const identidade = (opcoes.identidadeProduto ?? (() => identidadeDoProduto(opcoes.raiz)))();
    const claims = projecao.claims.map((claim) => verificarClaim(claimDoReplay(claim), opcoes.raiz, executor));
    const commands = projecao.commands.map((command) => executor(command.name, command.command, opcoes.raiz));
    const identidadeFinal = (opcoes.identidadeProduto ?? (() => identidadeDoProduto(opcoes.raiz)))();
    const produtoAlterado = identidade !== identidadeFinal;
    const todos = [...(preparo ? [preparo] : []), ...claims.flatMap((claim) => claim.execucoes), ...commands];
    const degradacao = causaDaExecucao(todos) ?? (produtoAlterado ? 'produto-alterado' : null);
    // A baseline projetada continua no contrato de entrada para compatibilidade, mas não tem autoridade no runner:
    // ela vem do PR/MR. Sem fonte externa confiável, toda falha atual é julgada sem baseline e reprova.
    const julgamento = julgarResultadoDoVerify({ claims, comandos: commands, baseline: null,
      preparo, produtoAlterado });
    const falhaReal = preparo?.ok === false || claims.some((claim) => !claim.verificado) || commands.some((command) => !command.ok);
    if (degradacao) return { ok: !falhaReal, thread: projecao.thread, commit: opcoes.head, preparo, claims, commands,
      julgamento, degradacao };
    const recibo = emitirReciboRunnerCi(projecao, opcoes.head, { ok: julgamento.ok, motivos: julgamento.motivos });
    return { ok: julgamento.ok, thread: projecao.thread, commit: opcoes.head, preparo, claims, commands, julgamento, recibo };
  } finally {
    if (criada) fs.rmSync(casa, { recursive: true, force: true });
  }
}

/**
 * Feature #setup: customizacao de runtime/modelo/esforco POR BLOCO de cada modo de conducao.
 *
 * A tag #setup no pedido ao orquestrador abre UMA entrevista padronizada com o owner
 * (mesma mecanica HITL do fluxo de demanda): a lista topificada dos modos VIVOS com seus
 * blocos, perguntada na ordem do espectro VIVO (ver `ORDEM_DOS_MODOS`). A
 * entrevista termina quando todos os modos foram cobertos OU quando o owner diz que
 * concluiu (o restante fica no default). Quem CONDUZ a entrevista e o orquestrador
 * (Camada 1); quem GUARDA e APLICA a resposta e o nucleo, por este modulo.
 *
 * Persistencia fora do orkastery.yaml de proposito: a matriz por bloco cresce com os modos, e
 * o manifesto tem limite duro de 16 KB e vocacao de configuracao minima. Arquivo AUSENTE
 * significa default puro: um recem-instalado roda TUDO em claude-bg/opus/high sem setup.
 *
 * I-52 (RM-047, fatia 3): dois lugares, e so um vale de cada vez.
 *   `orkastery.setup.json` na raiz do checkout, VERSIONADO: vale para todas as maquinas e
 *     muda por PR, como codigo. Quando existe, e ele que vale.
 *   `.orkastery/setup.json` na raiz de ESTADO (a mesma de todas as worktrees da maquina):
 *     o setup local, para quem ainda nao versionou. Antes da I-52 ele era lido a partir do
 *     checkout, e o despacho feito de dentro de uma worktree caia no default sem aviso.
 * `ork setup versionar` leva o setup local para o arquivo versionado.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { raizDoEstado } from './estado-thread';
import { registrar } from './ledger';
import { dirEstado, validarOptInPlaybook } from './manifest';
import { definicaoDoModo, MODOS, ORDEM_DOS_MODOS } from './modos';
import { ORDEM_DOS_RUNTIMES, RUNTIME_PADRAO, runtimeConhecido } from './runtimes';
import {
  AtividadeDoPrazo, ConfigDeBloco, ConsumoDoPrazo, IdentidadeDoPrazo,
  LimitesDeBloco, Manifesto, Modo, ModoLegado, PrazoDeBloco, SetupDeConducao, SetupDeModo,
} from './types';
import { agora, gravarJson, lerJson, tabela } from './util';

export const CONTRATO_DO_SETUP = 'ork.setup/v1';
export const NOME_SETUP = 'setup.json';
/** I-52: o setup versionado, ao lado do `orkastery.yaml`. */
export const NOME_SETUP_VERSIONADO = 'orkastery.setup.json';

/** Limite de representacao Date, nao teto de trabalho ou de temporizador nativo. */
const MAX_INSTANTE_MS = 8_640_000_000_000_000;
const CAMPOS_LIMITES = ['duracaoMs', 'maxChildren', 'maxDepth', 'maxRetries'] as const;

function objeto(valor: unknown, campo: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${campo} deve ser objeto`);
  }
  return valor as Record<string, unknown>;
}

function camposExatos(valor: Record<string, unknown>, campos: readonly string[], campo: string): void {
  if (Object.keys(valor).length !== campos.length ||
      campos.some(c => !Object.hasOwn(valor, c))) {
    throw new Error(`${campo} deve conter somente ${campos.join(', ')}`);
  }
}

/**
 * I-33 (D6): config de bloco com a ordem de fallback de runtimes. Campo opcional do
 * `ork.setup/v1`: setup.json antigo continua valido e a leitura normaliza o que vier.
 * Cada entrada e `runtime:modelo[:esforco]`, porque trocar de runtime exige o modelo dele
 * (`resolverDespacho`); o runtime do bloco nunca se repete na propria ordem.
 */
export type ConfigDeBlocoComFallback = ConfigDeBloco & { fallback?: string[] };

const ENTRADA_DE_FALLBACK = /^([a-z][a-z0-9-]*):([^\s:]+)(?::([a-z]+))?$/;

/** Validacao estrita da entrada do operador: recusa em vez de descartar em silencio. */
export function validarFallback(lista: readonly string[], principal: string): string[] {
  const vistos = new Set<string>([principal]);
  return lista.map((item) => {
    const m = ENTRADA_DE_FALLBACK.exec(item.trim());
    if (!m) throw new Error(`fallback invalido: "${item}" (use runtime:modelo[:esforco], por exemplo codex:gpt-5.5)`);
    if (!runtimeConhecido(m[1])) throw new Error(`fallback com runtime desconhecido: "${m[1]}" (homologados: ${ORDEM_DOS_RUNTIMES.join(', ')})`);
    if (vistos.has(m[1])) throw new Error(`fallback repete o runtime ${m[1]} (o runtime do bloco e cada fallback aparecem uma vez)`);
    vistos.add(m[1]);
    return item.trim();
  });
}

/** Leitura normalizadora: entrada malformada, desconhecida ou repetida e descartada. */
export function normalizarFallback(valor: unknown, principal: string): string[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>([principal]);
  const saida: string[] = [];
  for (const item of valor) {
    const m = typeof item === 'string' ? ENTRADA_DE_FALLBACK.exec(item) : null;
    if (!m || !runtimeConhecido(m[1]) || vistos.has(m[1])) continue;
    vistos.add(m[1]);
    saida.push(item as string);
  }
  return saida;
}

/** Um runtime da ordem de fallback do bloco, com o modelo dele (o modelo de um runtime nao serve ao outro). */
export interface AlvoDeFallback { runtime: string; model: string; effort?: string }

/**
 * D6 (A13): o UNICO parser da ordem de fallback. A leitura normalizadora (`normalizarFallback`)
 * decide o que vale, com as mesmas regras da edicao; aqui cada entrada valida so e decomposta em
 * runtime, modelo e esforco. A rotacao do retry le a ordem por esta funcao.
 */
export function alvosDaOrdemDeFallback(valor: unknown, principal: string): AlvoDeFallback[] {
  return normalizarFallback(valor, principal).map((item) => {
    const m = ENTRADA_DE_FALLBACK.exec(item) as RegExpExecArray;
    return { runtime: m[1], model: m[2], ...(m[3] ? { effort: m[3] } : {}) };
  });
}

/** A ordem de fallback do bloco que conduz a fase (vazia quando nao configurada). */
export function fallbackDoBloco(setup: SetupDeConducao, modo: ModoLegado, fase: string): string[] {
  const cfg = configDoBloco(setup, modo, fase) as ConfigDeBlocoComFallback | null;
  return cfg?.fallback ?? [];
}

/** Recusa valores invalidos antes de JSON.stringify converter NaN/Infinity em null. */
export function validarLimitesDeBloco(valor: unknown): LimitesDeBloco {
  const limites = objeto(valor, 'limites');
  camposExatos(limites, CAMPOS_LIMITES, 'limites');
  for (const campo of CAMPOS_LIMITES) {
    const n = limites[campo];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < (campo === 'duracaoMs' ? 1 : 0) ||
        (campo === 'duracaoMs' && n > MAX_INSTANTE_MS)) {
      throw new Error(`limites.${campo} deve ser inteiro ${campo === 'duracaoMs' ? 'positivo' : 'nao negativo'}, finito e representavel`);
    }
  }
  return {
    duracaoMs: limites.duracaoMs as number, maxChildren: limites.maxChildren as number,
    maxDepth: limites.maxDepth as number, maxRetries: limites.maxRetries as number,
  };
}

function validarConfigComLimites(config: Record<string, unknown>): void {
  if (!Object.hasOwn(config, 'limites')) return;
  validarLimitesDeBloco(config.limites);
  if (typeof config.runtime !== 'string' || !runtimeConhecido(config.runtime) ||
      typeof config.model !== 'string' || config.model.trim() === '' ||
      typeof config.effort !== 'string' || config.effort.trim() === '') {
    throw new Error('bloco com limites exige runtime conhecido, model e effort explicitos validos');
  }
}

/** Valida tambem entradas que a normalizacao antiga descartaria. */
function validarEstruturaSetup(valor: unknown): asserts valor is Partial<SetupDeConducao> {
  const setup = objeto(valor, 'setup');
  if (setup.contrato !== undefined && setup.contrato !== CONTRATO_DO_SETUP) {
    throw new Error('contrato de setup incompativel');
  }
  if (setup.modos === undefined) return;
  for (const [modo, valorModo] of Object.entries(objeto(setup.modos, 'setup.modos'))) {
    const configModo = objeto(valorModo, `setup.modos.${modo}`);
    if (configModo.blocos === undefined) continue;
    if (!Array.isArray(configModo.blocos)) throw new Error(`blocos de ${modo} devem ser array`);
    for (const [i, valorBloco] of configModo.blocos.entries()) {
      const config = objeto(valorBloco, `bloco ${modo}/${i + 1}`);
      validarConfigComLimites(config);
      if (Object.hasOwn(config, 'limites') && (setup.contrato !== CONTRATO_DO_SETUP ||
          !(ORDEM_DOS_MODOS as readonly string[]).includes(modo) || i >= MODOS[modo as Modo].blocos.length)) {
        throw new Error('limites exigem contrato e bloco de modo conhecidos');
      }
    }
  }
}

/** Evento do ledger que carimba toda customizacao do #setup. */
export const EVENTO_SETUP_CONFIGURADO = 'setup_configured';

/** O default pos-instalacao de todo bloco, menos o dos modos com default proprio (`blocoPadraoDoModo`). */
export const BLOCO_PADRAO: Readonly<ConfigDeBloco> = {
  runtime: RUNTIME_PADRAO,
  model: 'opus',
  effort: 'high',
};

/**
 * I-42: o default de um bloco depende do modo. O `#Fast` e o pedido pequeno: Sonnet com esforco
 * alto no Claude e, sem conta Claude, o Terra com esforco alto no Codex. Os outros modos seguem
 * no BLOCO_PADRAO.
 */
const PADRAO_POR_MODO: Partial<Record<Modo, ConfigDeBlocoComFallback>> = {
  fast: { runtime: RUNTIME_PADRAO, model: 'sonnet', effort: 'high', fallback: ['codex:gpt-5.6-terra:high'] },
};

export function blocoPadraoDoModo(modo: Modo): ConfigDeBlocoComFallback {
  const proprio = PADRAO_POR_MODO[modo];
  return proprio ? { ...proprio, ...(proprio.fallback ? { fallback: [...proprio.fallback] } : {}) } : { ...BLOCO_PADRAO };
}

/** I-52: o setup versionado deste checkout (existindo ou nao). */
export function caminhoSetupVersionado(raiz: string): string {
  return path.join(raiz, NOME_SETUP_VERSIONADO);
}

/** I-52: o setup local desta maquina, na raiz de estado (a mesma de todas as worktrees). */
export function caminhoSetupLocal(raiz: string): string {
  return path.join(dirEstado(raizDoEstado(raiz)), NOME_SETUP);
}

export type OrigemDoSetup = 'versionado' | 'local' | 'padrao';

/** De onde vem o setup que vale agora. */
export function origemDoSetup(raiz: string): OrigemDoSetup {
  if (fs.existsSync(caminhoSetupVersionado(raiz))) return 'versionado';
  return fs.existsSync(caminhoSetupLocal(raiz)) ? 'local' : 'padrao';
}

/** O arquivo que vale (e que a edicao grava): o versionado quando existe, senao o local. */
export function caminhoSetup(raiz: string): string {
  return origemDoSetup(raiz) === 'versionado' ? caminhoSetupVersionado(raiz) : caminhoSetupLocal(raiz);
}

/** O setup default: a matriz dos modos vivos, cada bloco no default do seu modo. */
export function setupPadrao(): SetupDeConducao {
  const modos = {} as Record<Modo, SetupDeModo>;
  for (const modo of ORDEM_DOS_MODOS) {
    modos[modo] = {
      blocos: MODOS[modo].blocos.map(() => blocoPadraoDoModo(modo)),
    };
  }
  return { contrato: CONTRATO_DO_SETUP, atualizadoEm: agora(), modos };
}

/**
 * Le o setup do projeto, sempre COMPLETO.
 *
 * O arquivo em disco pode estar ausente (default puro), vir de versao antiga com um modo
 * faltando, ou trazer blocos a mais de uma matriz que mudou. A leitura normaliza contra a
 * matriz ATUAL dos modos: todo modo presente, um config por bloco, e campo vazio cai no
 * default do mesmo runtime; modelo ausente em outro runtime permanece pendente.
 * JSON, estrutura e limites configurados invalidos sao recusados antes do despacho.
 */
export function lerSetup(raiz: string): SetupDeConducao {
  const caminho = caminhoSetup(raiz);
  const padrao = setupPadrao();
  if (!fs.existsSync(caminho)) return padrao;
  let bruto: unknown;
  try {
    bruto = lerJson<unknown>(caminho);
  } catch (e) {
    throw new Error(`setup invalido (${caminho}): ${(e as Error).message}`);
  }
  validarEstruturaSetup(bruto);
  const modosBrutos = (bruto.modos ?? {}) as Partial<Record<Modo, SetupDeModo>>;
  for (const modo of ORDEM_DOS_MODOS) {
    const doArquivo = modosBrutos[modo]?.blocos ?? [];
    const doModo = blocoPadraoDoModo(modo);
    padrao.modos[modo] = {
      blocos: MODOS[modo].blocos.map((_, i) => {
        // I-42: bloco ausente no arquivo (setup gravado antes do modo existir) nasce no
        // default DO MODO, com o fallback dele; os blocos presentes seguem como estavam.
        if (doArquivo[i] === undefined) return blocoPadraoDoModo(modo);
        const b = doArquivo[i];
        const runtime =
          typeof b.runtime === 'string' && runtimeConhecido(b.runtime)
            ? b.runtime
            : doModo.runtime;
        return {
          runtime,
          model: typeof b.model === 'string' && b.model.trim() !== '' ? b.model
            : runtime === doModo.runtime ? doModo.model : '',
          effort: typeof b.effort === 'string' && b.effort !== '' ? b.effort : doModo.effort,
          ...('limites' in b ? { limites: validarLimitesDeBloco(b.limites) } : {}),
          ...(() => {
            const fallback = normalizarFallback((b as ConfigDeBlocoComFallback).fallback, runtime);
            return fallback.length ? { fallback } : {};
          })(),
        };
      }),
    };
  }
  if (typeof bruto.atualizadoEm === 'string') padrao.atualizadoEm = bruto.atualizadoEm;
  return padrao;
}

/** Grava o setup onde ele vale (o versionado, quando existe). */
export function gravarSetup(raiz: string, setup: SetupDeConducao): string {
  validarEstruturaSetup(setup);
  const caminho = caminhoSetup(raiz);
  setup.atualizadoEm = agora();
  gravarJson(caminho, setup);
  return caminho;
}

/**
 * I-52: `ork setup versionar` leva o setup que vale agora para `orkastery.setup.json`, na raiz do
 * checkout. O arquivo entra no repositorio por PR, e dali em diante e ele que vale em todas as
 * maquinas; o local fica onde esta, ignorado enquanto o versionado existir.
 */
export function versionarSetup(raiz: string, por = 'owner'): { caminho: string; setup: SetupDeConducao } {
  const caminho = caminhoSetupVersionado(raiz);
  if (fs.existsSync(caminho)) throw new Error(`setup.versionado: ${NOME_SETUP_VERSIONADO} ja existe neste checkout; edite com ork setup <modo> --bloco N`);
  const origem = origemDoSetup(raiz);
  const setup = lerSetup(raiz);
  validarEstruturaSetup(setup);
  setup.atualizadoEm = agora();
  gravarJson(caminho, setup);
  registrarSetupNoLedger(raiz, { acao: 'versionar', de: origem, para: NOME_SETUP_VERSIONADO, por });
  return { caminho, setup };
}

/** A config que abre a sessao do bloco que conduz a fase informada no modo informado. */
// Leitor: thread em modo aposentado continua tendo bloco, runtime e limites.
export function configDoBloco(setup: SetupDeConducao, modo: ModoLegado, fase: string): ConfigDeBloco | null {
  const def = MODOS[modo];
  if (!def) return null;
  const indice = def.blocos.findIndex((b) => (b.fases as string[]).includes(fase));
  if (indice < 0) return null;
  const config = setup.modos[modo]?.blocos[indice] ?? { ...BLOCO_PADRAO };
  validarConfigComLimites(objeto(config, 'config do bloco'));
  return config;
}

/**
 * Resolve o perfil I09 sem despachar. Opt-in exige matriz completa nos modos permitidos.
 * T11 devera consumir este contrato antes do spawn e persistir a identidade reservada.
 */
export function limitesDoBloco(
  manifesto: Manifesto, setup: SetupDeConducao, modo: ModoLegado, fase: string
): LimitesDeBloco | null {
  validarEstruturaSetup(setup);
  if (!validarOptInPlaybook(manifesto.playbook)) return null;
  const permitidos = manifesto.conduction.allowed_modes;
  if (!Array.isArray(permitidos) || permitidos.length === 0 ||
      permitidos.some(m => !(ORDEM_DOS_MODOS as readonly string[]).includes(m)) ||
      !(permitidos as readonly string[]).includes(modo)) {
    throw new Error('playbook ativo exige modo permitido valido');
  }
  for (const permitido of permitidos) {
    const blocos = setup.modos?.[permitido]?.blocos;
    if (!blocos || blocos.length !== MODOS[permitido].blocos.length) {
      throw new Error(`playbook ativo exige todos os blocos de ${permitido}`);
    }
    for (const config of blocos) {
      validarConfigComLimites(objeto(config, 'config do bloco'));
      validarLimitesDeBloco(config.limites);
    }
  }
  const config = configDoBloco(setup, modo, fase);
  if (!config) throw new Error(`fase ${fase} fora do modo ${modo}`);
  return validarLimitesDeBloco(config.limites);
}

function instante(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0 || valor > MAX_INSTANTE_MS) {
    throw new Error(`${campo} deve ser instante inteiro nao negativo e representavel`);
  }
  return valor;
}

function somarPrazo(inicio: number, duracao: number): number {
  return instante(inicio + duracao, 'deadline (overflow)');
}

function validarIdentidade(valor: unknown): IdentidadeDoPrazo {
  const id = objeto(valor, 'identidade');
  camposExatos(id, ['threadId', 'execucaoId', 'modo', 'bloco'], 'identidade');
  for (const campo of ['threadId', 'execucaoId']) {
    if (typeof id[campo] !== 'string' || (id[campo] as string).trim() === '') {
      throw new Error(`identidade.${campo} deve ser texto nao vazio`);
    }
  }
  if (!(ORDEM_DOS_MODOS as readonly unknown[]).includes(id.modo) ||
      typeof id.bloco !== 'number' || !Number.isSafeInteger(id.bloco) ||
      id.bloco < 1 || id.bloco > MODOS[id.modo as Modo].blocos.length) {
    throw new Error('identidade de modo/bloco invalida');
  }
  return { threadId: id.threadId as string, execucaoId: id.execucaoId as string, modo: id.modo as Modo, bloco: id.bloco };
}

function semAmpliacao(limites: LimitesDeBloco, origem: LimitesDeBloco): void {
  for (const campo of CAMPOS_LIMITES) {
    if (limites[campo] > origem[campo]) throw new Error(`heranca nao pode ampliar limites.${campo}`);
  }
}

/**
 * Primeiro trabalho ativo de uma identidade NOVA reservada pelo controlador.
 * Nao usar para filhos/retries/retomadas. Nao cria timer, processo ou registro em disco.
 */
export function iniciarPrazoDoBloco(
  manifesto: Manifesto, setup: SetupDeConducao, identidade: IdentidadeDoPrazo,
  fase: string, agoraMs: number
): PrazoDeBloco | null {
  const limites = limitesDoBloco(manifesto, setup, identidade.modo, fase);
  if (limites === null) return null;
  const id = validarIdentidade(identidade);
  if (!(MODOS[id.modo].blocos[id.bloco - 1].fases as readonly string[]).includes(fase)) {
    throw new Error('identidade do bloco diverge da fase selecionada');
  }
  const inicio = instante(agoraMs, 'iniciadaEmMs');
  const deadline = somarPrazo(inicio, limites.duracaoMs);
  return {
    versao: 1, identidade: id, iniciadaEmMs: inicio, deadlineOriginalMs: deadline,
    limitesOriginais: { ...limites }, deadlineMs: deadline, limites: { ...limites }, observadoEmMs: inicio,
  };
}

function validarPrazo(valor: unknown, esperada: IdentidadeDoPrazo): PrazoDeBloco {
  const p = objeto(valor, 'prazo');
  camposExatos(p, ['versao', 'identidade', 'iniciadaEmMs', 'deadlineOriginalMs',
    'limitesOriginais', 'deadlineMs', 'limites', 'observadoEmMs'], 'prazo');
  if (p.versao !== 1) throw new Error('versao de prazo incompativel');
  const identidade = validarIdentidade(p.identidade);
  const idEsperada = validarIdentidade(esperada);
  if ((Object.keys(identidade) as (keyof IdentidadeDoPrazo)[]).some(c => identidade[c] !== idEsperada[c])) {
    throw new Error('identidade da execucao divergente');
  }
  const limitesOriginais = validarLimitesDeBloco(p.limitesOriginais);
  const limites = validarLimitesDeBloco(p.limites);
  semAmpliacao(limites, limitesOriginais);
  const iniciadaEmMs = instante(p.iniciadaEmMs, 'iniciadaEmMs');
  const observadoEmMs = instante(p.observadoEmMs, 'observadoEmMs');
  const deadlineOriginalMs = instante(p.deadlineOriginalMs, 'deadlineOriginalMs');
  const deadlineMs = instante(p.deadlineMs, 'deadlineMs');
  if (deadlineOriginalMs !== somarPrazo(iniciadaEmMs, limitesOriginais.duracaoMs) ||
      deadlineMs !== somarPrazo(iniciadaEmMs, limites.duracaoMs) || observadoEmMs < iniciadaEmMs) {
    throw new Error('origem/deadline do prazo inconsistente');
  }
  return { versao: 1, identidade, iniciadaEmMs, deadlineOriginalMs, limitesOriginais, deadlineMs, limites, observadoEmMs };
}

/**
 * Consome a janela absoluta, sem a renovar. Espera sem processo nao e timeout de runtime;
 * nao prorroga a deadline e nao permite reentrada em trabalho depois de expirada.
 * Relogio e contagem de processos devem vir do controlador, nao da resposta do modelo.
 */
export function consumirPrazoDoBloco(
  snapshot: PrazoDeBloco, identidadeEsperada: IdentidadeDoPrazo, agoraMs: number,
  atividade: AtividadeDoPrazo = { tipo: 'trabalho' }
): ConsumoDoPrazo {
  const prazo = validarPrazo(snapshot, identidadeEsperada);
  const agoraValidado = instante(agoraMs, 'agoraMs');
  if (agoraValidado < prazo.observadoEmMs) throw new Error('relogio regressivo no prazo');
  const a = objeto(atividade, 'atividade');
  if (a.tipo === 'trabalho') {
    camposExatos(a, ['tipo'], 'atividade');
  } else if (a.tipo === 'espera_lease' || a.tipo === 'espera_score') {
    camposExatos(a, ['tipo', 'processosAtivos'], 'atividade');
    if (a.processosAtivos !== 0) throw new Error('espera exige ausencia comprovada de processos ativos');
  } else {
    throw new Error('atividade de prazo desconhecida');
  }
  prazo.observadoEmMs = agoraValidado;
  const restanteMs = Math.max(0, prazo.deadlineMs - agoraValidado);
  return {
    prazo, restanteMs,
    estado: a.tipo !== 'trabalho' ? 'espera_sem_processo' : restanteMs > 0 ? 'ativo' : 'expirado',
  };
}

/** Heranca para filho, retry ou proxima fase do MESMO bloco. Nao admite processos. */
export function herdarPrazoDoBloco(
  origem: PrazoDeBloco, identidadeEsperada: IdentidadeDoPrazo, agoraMs: number,
  limitesSolicitados?: LimitesDeBloco
): PrazoDeBloco {
  const consumo = consumirPrazoDoBloco(origem, identidadeEsperada, agoraMs);
  if (consumo.estado !== 'ativo') throw new Error('prazo expirado: heranca recusada');
  const prazo = consumo.prazo;
  const limites = validarLimitesDeBloco(limitesSolicitados === undefined ? prazo.limites : limitesSolicitados);
  semAmpliacao(limites, prazo.limites);
  const deadlineMs = somarPrazo(prazo.iniciadaEmMs, limites.duracaoMs);
  if (deadlineMs <= agoraMs) throw new Error('prazo reduzido ja expirado');
  return { ...prazo, limites, deadlineMs };
}

/** A config do bloco e o default pos-instalacao? */
export function ehPadrao(cfg: ConfigDeBloco, modo?: Modo): boolean {
  // I-42: com o modo, o default e o DO MODO (o `#Fast` nasce em Sonnet com fallback).
  const padrao: ConfigDeBlocoComFallback = modo ? blocoPadraoDoModo(modo) : { ...BLOCO_PADRAO };
  const fallback = (cfg as ConfigDeBlocoComFallback).fallback ?? [];
  const esperado = padrao.fallback ?? [];
  return (
    cfg.runtime === padrao.runtime &&
    cfg.model === padrao.model &&
    cfg.effort === padrao.effort &&
    cfg.limites === undefined &&
    fallback.length === esperado.length &&
    fallback.every((f, i) => f === esperado[i])
  );
}

export interface EdicaoDeBloco {
  runtime?: string;
  model?: string;
  effort?: string;
  limites?: LimitesDeBloco;
  /** I-33 (D6): nova ordem de fallback do bloco; lista vazia remove o fallback. */
  fallback?: string[];
}

export interface ResultadoDeEdicao {
  ok: boolean;
  setup: SetupDeConducao;
  caminho: string;
  modo: Modo;
  /** Indice 1-based do bloco editado (como o CLI mostra). */
  bloco: number;
  de: ConfigDeBloco | null;
  para: ConfigDeBloco | null;
  erro?: string;
}

/**
 * Edita a config de UM bloco de UM modo e carimba `setup_configured` no ledger do projeto.
 *
 * O indice do bloco e 1-based porque e assim que a entrevista e o CLI falam com o owner
 * ("bloco 1 GOAL-PLAN"). Runtime desconhecido reprova aqui, antes de ir ao disco: um
 * arquivo de setup com runtime inexistente viraria erro tipado so na hora do despacho.
 */
export function editarBloco(
  raiz: string,
  modo: Modo,
  bloco: number,
  edicao: EdicaoDeBloco,
  por = 'owner'
): ResultadoDeEdicao {
  const def = definicaoDoModo(modo);
  const setup = lerSetup(raiz);
  const base: ResultadoDeEdicao = {
    ok: false,
    setup,
    caminho: caminhoSetup(raiz),
    modo,
    bloco,
    de: null,
    para: null,
  };
  if (!Number.isInteger(bloco) || bloco < 1 || bloco > def.blocos.length) {
    return {
      ...base,
      erro: `bloco ${bloco} nao existe no modo ${def.tag}: ele tem ${def.blocos.length} bloco(s)`,
    };
  }
  if (edicao.runtime !== undefined && !runtimeConhecido(edicao.runtime)) {
    return {
      ...base,
      erro: `runtime desconhecido: "${edicao.runtime}" (homologados: ${ORDEM_DOS_RUNTIMES.join(', ')})`,
    };
  }
  const atual = setup.modos[modo].blocos[bloco - 1];
  if (edicao.runtime !== undefined && edicao.runtime !== atual.runtime && !edicao.model?.trim())
    return { ...base, erro: 'setup.model.required: para mudar o runtime do bloco, informe --runtime e --model juntos; nenhuma configuracao foi gravada.' };
  if (!(edicao.model ?? atual.model).trim())
    return { ...base, erro: 'setup.model.required: modelo pendente neste bloco; informe --model antes de salvar.' };
  const de = { ...atual };
  const runtimeNovo = edicao.runtime ?? atual.runtime;
  let fallback: string[];
  try {
    // A ordem pedida e validada estrita; a herdada so perde o runtime que virou o do bloco.
    fallback = edicao.fallback !== undefined ? validarFallback(edicao.fallback, runtimeNovo)
      : normalizarFallback((atual as ConfigDeBlocoComFallback).fallback, runtimeNovo);
  } catch (e) {
    return { ...base, erro: (e as Error).message };
  }
  const para: ConfigDeBlocoComFallback = {
    runtime: runtimeNovo,
    model: edicao.model ?? atual.model,
    effort: edicao.effort ?? atual.effort,
    ...(atual.limites === undefined ? {} : { limites: { ...atual.limites } }),
    ...(Object.hasOwn(edicao, 'limites') ? { limites: edicao.limites } : {}),
    ...(fallback.length ? { fallback } : {}),
  };
  try {
    validarConfigComLimites(objeto(para, 'config do bloco'));
    if (para.limites) para.limites = validarLimitesDeBloco(para.limites);
  } catch (e) {
    return { ...base, erro: (e as Error).message };
  }
  setup.modos[modo].blocos[bloco - 1] = para;
  const caminho = gravarSetup(raiz, setup);
  registrarSetupNoLedger(raiz, {
    acao: 'editar',
    modo,
    bloco,
    fases: def.blocos[bloco - 1].fases.join('-'),
    de,
    para,
    por,
  });
  return { ...base, ok: true, setup, caminho, de, para };
}

/** Reseta UM modo (ou todos, sem `modo`) para o default claude-bg/opus/high. */
export function resetarSetup(raiz: string, modo?: Modo, por = 'owner'): SetupDeConducao {
  const setup = lerSetup(raiz);
  const padrao = setupPadrao();
  if (modo) {
    definicaoDoModo(modo);
    setup.modos[modo] = padrao.modos[modo];
  } else {
    setup.modos = padrao.modos;
  }
  gravarSetup(raiz, setup);
  registrarSetupNoLedger(raiz, {
    acao: 'resetar',
    modo: modo ?? 'todos',
    para: modo ? blocoPadraoDoModo(modo) : BLOCO_PADRAO,
    por,
  });
  return setup;
}

/**
 * Carimba a customizacao no ledger DO PROJETO (`.orkastery/ledger.jsonl`).
 *
 * O setup nao pertence a uma thread: ele governa despachos futuros de todas. O evento
 * reusa o registrador do ledger com o id fixo `projeto`, no mesmo formato append-only.
 */
export function registrarSetupNoLedger(raiz: string, dados: Record<string, unknown>): void {
  // I-52: o ledger do projeto e o da raiz de estado, de qualquer worktree.
  registrar(dirEstado(raizDoEstado(raiz)), 'projeto', EVENTO_SETUP_CONFIGURADO, dados);
}

/** I-52: a linha que diz ao dono de onde vem o setup que vale. */
export function linhaDaOrigemDoSetup(raiz: string): string {
  const origem = origemDoSetup(raiz);
  if (origem === 'versionado') {
    return `Setup versionado em ${NOME_SETUP_VERSIONADO}: vale para todas as maquinas e muda por PR.` +
      (fs.existsSync(caminhoSetupLocal(raiz)) ? ' O .orkastery/setup.json local desta maquina fica ignorado.' : '');
  }
  if (origem === 'local') return 'Setup local desta maquina (.orkastery/setup.json). Para valer em todas: ork setup versionar.';
  return 'Nenhum setup gravado: vale o default. Para valer em todas as maquinas: ork setup versionar.';
}

/** Tabela de um modo: cada bloco com sua config e a marca do que saiu do default. */
export function textoDoSetup(raiz: string, modo: Modo): string {
  const def = definicaoDoModo(modo);
  const setup = lerSetup(raiz);
  const linhas = def.blocos.map((b, i) => {
    const cfg = setup.modos[modo].blocos[i];
    return [
      String(i + 1),
      b.fases.join('-'),
      cfg.runtime,
      cfg.model || '(modelo pendente)',
      cfg.effort,
      (cfg as ConfigDeBlocoComFallback).fallback?.join(', ') || '-',
      ehPadrao(cfg, modo) ? 'default' : 'customizado',
    ];
  });
  const saida: string[] = [];
  saida.push(`Setup do modo ${def.tag} (${def.blocos.length} bloco(s), ${def.pausas} pausa(s))`);
  saida.push('');
  saida.push(tabela(['BLOCO', 'FASES', 'RUNTIME', 'MODEL', 'EFFORT', 'FALLBACK', 'ORIGEM'], linhas));
  saida.push('');
  saida.push(`Editar:  ork setup ${modo} --bloco N --runtime R --model M --effort E`);
  saida.push(`Fallback: ork setup ${modo} --bloco N --fallback runtime:modelo[:esforco],...   (--fallback "" remove)`);
  const padrao = blocoPadraoDoModo(modo);
  saida.push(`Resetar: ork setup ${modo} --reset   (volta para ${padrao.runtime}/${padrao.model}/${padrao.effort})`);
  saida.push(`Runtimes homologados: ${ORDEM_DOS_RUNTIMES.join(', ')}`);
  saida.push('');
  saida.push(linhaDaOrigemDoSetup(raiz));
  return saida.join('\n');
}

/**
 * A pauta da entrevista do #setup: a lista topificada dos modos vivos com seus blocos.
 *
 * E este texto que o orquestrador entrega ao owner quando a tag #setup chega no pedido.
 * A ordem das perguntas e a do espectro vivo (o mais HITL primeiro), a entrevista pode parar quando
 * o owner disser que concluiu, e todo bloco nao respondido fica no default.
 */
export function textoDaEntrevista(raiz: string): string {
  const setup = lerSetup(raiz);
  const saida: string[] = [];
  saida.push('Entrevista #setup: runtime + modelo + esforco por bloco de cada modo');
  saida.push('');
  saida.push(`Ordem das perguntas: ${ORDEM_DOS_MODOS.map((m) => MODOS[m].tag).join(' -> ')}.`);
  saida.push('A entrevista termina quando todos os modos forem cobertos OU quando o owner');
  saida.push('disser que concluiu: o que nao for respondido fica no default.');
  const proprios = ORDEM_DOS_MODOS.filter((m) => !ehPadrao(blocoPadraoDoModo(m)));
  saida.push(`Default pos-instalacao: ${BLOCO_PADRAO.runtime}/${BLOCO_PADRAO.model}/${BLOCO_PADRAO.effort} em todos os blocos` +
    (proprios.length ? `, menos ${proprios.map((m) => {
      const b = blocoPadraoDoModo(m);
      return `${MODOS[m].tag} (${b.runtime}/${b.model}/${b.effort}${b.fallback?.length ? `, fallback ${b.fallback.join(', ')}` : ''})`;
    }).join(', ')}.` : '.'));
  saida.push('');
  for (const modo of ORDEM_DOS_MODOS) {
    const def = MODOS[modo];
    saida.push(`${def.tag}`);
    def.blocos.forEach((b, i) => {
      const cfg = setup.modos[modo].blocos[i];
      const marca = ehPadrao(cfg, modo) ? '' : '  <- customizado';
      saida.push(
        `  bloco ${i + 1}: ${b.fases.join('-')}  [${cfg.runtime}/${cfg.model || '(modelo pendente)'}/${cfg.effort}]${marca}`
      );
    });
  }
  saida.push('');
  saida.push('Ver um modo:  ork setup <modo>');
  saida.push('Editar bloco: ork setup <modo> --bloco N --runtime R --model M --effort E');
  saida.push('Resetar tudo: ork setup --reset');
  saida.push('');
  saida.push(linhaDaOrigemDoSetup(raiz));
  return saida.join('\n');
}

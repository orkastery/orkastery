/** Entrevista determinística; hosts conduzem a conversa a partir desta pauta. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { dirEstado } from './manifest';
import { projectState, stateFile } from './project-state';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { procurarSegredos } from './policies';
import { ConteudoOnboarding, EtapaOnboarding, Onboarding, RespostaOnboarding } from './types';
import { CHAVE_DO_FUSO, FUSO_DE_BRASILIA, normalizarFuso } from './horario';

export const CONTRATO_ONBOARDING = 'ork.onboarding/v1';
export const PAUTA_ONBOARDING: ReadonlyArray<{ etapa: EtapaOnboarding; pergunta: string }> = [
  { etapa: 'maestro', pergunta: `Quem conduz o projeto, quais são seus objetivos e preferências, e em qual fuso horário o Orkastery deve mostrar horários? Informe o fuso como nome IANA, ex.: {"fuso":"${FUSO_DE_BRASILIA}"}; ele orienta ${CHAVE_DO_FUSO} no manifesto, sem editá-lo.` },
  { etapa: 'credenciais', pergunta: 'Quais provedores públicos e nomes de variáveis em env serão usados? Segredos somente em ~/.hermes/.env; nunca informe valores.' },
  { etapa: 'bancos', pergunta: 'Quais bancos públicos e nomes de variáveis em env configuram as conexões? Nunca informe DSN ou senha; valores somente em ~/.hermes/.env.' },
  { etapa: 'memoria', pergunta: 'Deseja OrkMind? Informe {"modo":"orkmind"} ou {"modo":"files"}; a escolha orienta memory.mode no manifesto, sem editá-lo.' },
  { etapa: 'produtos', pergunta: 'Quais produtos e repositórios públicos pertencem ao projeto?' },
  { etapa: 'topologia', pergunta: 'Como se distribuem ambientes e serviços? Informe identificadores públicos.' },
  { etapa: 'arquitetura', pergunta: 'Quais decisões e restrições de arquitetura devem orientar o trabalho?' },
  { etapa: 'skills', pergunta: 'Quais capacidades e skills serão necessárias?' },
  { etapa: 'auditores', pergunta: 'Quais auditorias e cadências são desejadas?' },
];
export const ETAPAS_ONBOARDING = PAUTA_ONBOARDING.map(p => p.etapa);

export function caminhoOnboarding(raiz: string): string {
  return stateFile(raiz, 'onboarding.json');
}

function objeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
}

/** Recusa antes de persistir. Diagnósticos nunca incluem a entrada recebida. */
function invalido(): never { throw new Error('onboarding.input.invalid: use JSON público e referências de variáveis; segredos somente em ~/.hermes/.env'); }

function textoSeguro(v: string): boolean {
  return !procurarSegredos(v).length &&
    !/[a-z][a-z0-9+.-]*:\/\/[^\s/]*@/i.test(v) &&
    !/\b(?:senha|password|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i.test(v) &&
    !/\bBearer\s+\S+|-----BEGIN|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v);
}

function validarJson(v: unknown, profundidade = 0): asserts v is ConteudoOnboarding {
  if (profundidade > 12) invalido();
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) invalido(); return; }
  if (typeof v === 'string') { if (!textoSeguro(v)) invalido(); return; }
  if (Array.isArray(v)) { for (const item of v) validarJson(item, profundidade + 1); return; }
  if (!objeto(v)) invalido();
  for (const [k, item] of Object.entries(v)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k) || !textoSeguro(k)) invalido();
    if (/(?:senha|password|secret|token|api[_-]?key|authorization|credential|credencial|dsn|private[_-]?key)/i.test(k)) {
      if (!/_env$/.test(k) || typeof item !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(item)) invalido();
    }
    validarJson(item, profundidade + 1);
  }
}

export function validarConteudo(etapa: EtapaOnboarding, conteudo: unknown): asserts conteudo is ConteudoOnboarding {
  validarJson(conteudo);
  if (Buffer.byteLength(JSON.stringify(conteudo)) > 16384) invalido();
  // I-35: o fuso do dono, quando informado, precisa ser um nome IANA que o Intl aceita.
  if (etapa === 'maestro' && objeto(conteudo) && Object.hasOwn(conteudo, 'fuso') && normalizarFuso(conteudo.fuso) === undefined) invalido();
  // Etapas sensíveis usam um formato fechado: não há espaço para texto de credenciais.
  if (etapa === 'credenciais' || etapa === 'bancos') {
    if (!objeto(conteudo)) invalido();
    for (const [k, v] of Object.entries(conteudo)) {
      if (k === 'env') {
        if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(x))) invalido();
      } else if (k === 'provedor' || k === 'banco') {
        if (typeof v !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._ -]{0,79}$/.test(v)) invalido();
      } else invalido();
    }
  }
}

/** Chaves ordenadas recursivamente; a ordem de arrays continua significativa. */
export function jsonCanonico(v: ConteudoOnboarding): string {
  if (Array.isArray(v)) return '[' + v.map(jsonCanonico).join(',') + ']';
  if (objeto(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jsonCanonico(v[k] as ConteudoOnboarding)).join(',') + '}';
  return JSON.stringify(v);
}

function sha(v: ConteudoOnboarding): string { return createHash('sha256').update(jsonCanonico(v)).digest('hex'); }

export function onboardingPadrao(): Onboarding {
  return { contrato: CONTRATO_ONBOARDING, atualizadoEm: null,
    etapas: Object.fromEntries(ETAPAS_ONBOARDING.map(e => [e, null])) as Onboarding['etapas'] };
}

function lerArquivo(raiz: string): unknown {
  const arquivo = caminhoOnboarding(raiz);
  if (fs.statSync(arquivo).size > 256 * 1024) legadoInvalido();
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

function dataMaisRecente(datas: unknown[]): string | null {
  return datas.filter((d): d is string => typeof d === 'string' && Number.isFinite(Date.parse(d)))
    .reduce<string | null>((maior, d) => maior === null || Date.parse(d) > Date.parse(maior) ? d : maior, null);
}

function normalizar(bruto: unknown): Onboarding {
  const estado = onboardingPadrao();
  if (!objeto(bruto) || !objeto(bruto.etapas)) return estado;
  for (const etapa of ETAPAS_ONBOARDING) {
    const r = bruto.etapas[etapa];
    if (!objeto(r) || typeof r.por !== 'string' || !r.por.trim() || r.por.length > 120 || !textoSeguro(r.por) ||
        typeof r.respondidaEm !== 'string' || !Number.isFinite(Date.parse(r.respondidaEm))) continue;
    try {
      validarConteudo(etapa, r.conteudo);
      estado.etapas[etapa] = { por: r.por, respondidaEm: r.respondidaEm, conteudo: r.conteudo };
    } catch { /* entrada legada insegura permanece pendente */ }
  }
  const datas = Object.values(estado.etapas).filter((r): r is RespostaOnboarding => !!r).map(r => r.respondidaEm);
  estado.atualizadoEm = dataMaisRecente([bruto.atualizadoEm, ...datas]);
  return estado;
}

export function lerOnboarding(raiz: string): Onboarding {
  const state = projectState(raiz);
  try {
    const value = lerArquivo(raiz);
    if (state.linked && (!objeto(value) || !objeto(value.etapas))) throw new Error('project-state.source.invalid');
    return normalizar(value);
  } catch {
    if (state.linked) throw new Error('project-state.source.unavailable');
    return onboardingPadrao();
  }
}

function legadoInvalido(): never {
  throw new Error('onboarding.legacy.invalid: escrita recusada para preservar respostas não representáveis; revise o arquivo ou use reset explícito da etapa.');
}

/** Chamada somente sob trava; uma leitura tolerante não autoriza descarte na escrita. */
function lerParaMutacao(raiz: string, reset: readonly string[] = []): { estado: Onboarding; descartadas: string[] } {
  let bruto: unknown;
  try { bruto = lerArquivo(raiz); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { estado: onboardingPadrao(), descartadas: [] };
    legadoInvalido();
  }
  if (!objeto(bruto) || !objeto(bruto.etapas)) legadoInvalido();
  const estado = normalizar(bruto);
  const descartadas = Object.entries(bruto.etapas).filter(([etapa, valor]) => valor !== null &&
    (!ETAPAS_ONBOARDING.includes(etapa as EtapaOnboarding) || estado.etapas[etapa as EtapaOnboarding] === null)).map(([etapa]) => etapa);
  if (descartadas.some(etapa => !reset.includes(etapa))) legadoInvalido();
  return { estado, descartadas };
}

function exigirEtapa(etapa: string): EtapaOnboarding {
  if (!ETAPAS_ONBOARDING.includes(etapa as EtapaOnboarding)) invalido();
  return etapa as EtapaOnboarding;
}

function exigirAutor(por: string): void {
  if (typeof por !== 'string' || !por.trim() || por.length > 120 || !textoSeguro(por)) invalido();
}

function persistir(raiz: string, estado: Onboarding): void {
  const arquivo = caminhoOnboarding(raiz), temporario = arquivo + '.' + randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  try {
    fs.writeFileSync(temporario, JSON.stringify(estado, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporario, arquivo);
  } finally { if (fs.existsSync(temporario)) fs.unlinkSync(temporario); }
}

/** Serializa toda a mutação. Nunca toma uma trava por idade ou remove trava alheia. */
function comTrava<T>(raiz: string, alterar: () => T): T {
  const trava = caminhoOnboarding(raiz) + '.lock';
  fs.mkdirSync(path.dirname(trava), { recursive: true });
  const limite = Date.now() + 5000;
  let fd: number;
  for (;;) {
    try { fd = fs.openSync(trava, 'wx', 0o600); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (Date.now() >= limite) throw new Error('onboarding.busy: entrevista em uso; tente novamente. Se persistir, confira o encerramento dos escritores antes de remover onboarding.json.lock.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return alterar(); }
  finally { fs.closeSync(fd); fs.unlinkSync(trava); }
}

export function gravarEtapa(raiz: string, nome: string, conteudo: unknown, por = 'owner'): Onboarding {
  const etapa = exigirEtapa(nome);
  exigirAutor(por);
  validarConteudo(etapa, conteudo);
  return comTrava(raiz, () => {
    const { estado } = lerParaMutacao(raiz), anterior = estado.etapas[etapa];
    if (anterior && jsonCanonico(anterior.conteudo) === jsonCanonico(conteudo)) return estado;
    const timestamp = new Date().toISOString();
    estado.etapas[etapa] = { respondidaEm: timestamp, por, conteudo };
    estado.atualizadoEm = dataMaisRecente([estado.atualizadoEm, timestamp]);
    persistir(raiz, estado);
    registrar(dirEstado(projectState(raiz).root), 'projeto', TIPOS_DE_EVENTO.onboardingRegistrado,
      { acao: 'set', etapa, por, sha256: sha(conteudo) });
    return estado;
  });
}

export function resetarOnboarding(raiz: string, nome?: string, por = 'owner'): Onboarding {
  exigirAutor(por);
  const etapas = nome === undefined ? ETAPAS_ONBOARDING : [exigirEtapa(nome)];
  return comTrava(raiz, () => {
    const { estado, descartadas } = lerParaMutacao(raiz, etapas);
    const alteradas = etapas.filter(e => estado.etapas[e] !== null || descartadas.includes(e));
    if (!alteradas.length) return estado;
    for (const etapa of alteradas) estado.etapas[etapa] = null;
    estado.atualizadoEm = dataMaisRecente([estado.atualizadoEm, new Date().toISOString()]);
    persistir(raiz, estado);
    for (const etapa of alteradas) registrar(dirEstado(projectState(raiz).root), 'projeto', TIPOS_DE_EVENTO.onboardingRegistrado,
      { acao: 'reset', etapa, por, sha256: sha(null) });
    return estado;
  });
}

export function textoDaPauta(estado: Onboarding = onboardingPadrao()): string {
  return ['Onboarding do projeto (' + CONTRATO_ONBOARDING + ')',
    ...PAUTA_ONBOARDING.map(({ etapa, pergunta }) => `${estado.etapas[etapa] ? '[respondida]' : '[pendente]'} ${etapa}: ${pergunta}`),
    'Responda com ork onboarding set <etapa> --conteudo <JSON> --por <quem>.'].join('\n');
}

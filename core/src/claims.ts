/**
 * Claims: o protocolo de alegacoes verificaveis (bloco B1).
 *
 * Uma fase nao "diz" que algo funciona: ela registra uma CLAIM com o comando que a
 * comprova, e o `ork verify` reexecuta esse comando no HEAD real. Self-report nao vale
 * como evidencia em nenhum modo de conducao.
 *
 * O caso EvoJ6 (alegacao negativa falsa que passou batido) e tratado aqui na origem:
 * alegacao negativa ou absoluta ("nenhum", "zero", "sempre", "nunca") SEM comando de
 * verificacao reprova no gate, porque nao existe como comprova-la depois.
 */

import * as path from 'node:path';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { carregarManifesto } from './manifest';
import { cicloSemCheck, validarProvaSemCheck } from './prova-minima';
import { dirThread, gravarThread, lerThread } from './thread';
import { Claim, Fase } from './types';
import { agora, anexarJsonl, lerJsonl, proximoIdSequencial, tabela } from './util';
import { analisarComandos } from './claim-lint';

/** Caminho do `claims.jsonl` da thread (append-only, como o ledger). */
export function caminhoClaims(raiz: string, threadId: string): string {
  return path.join(dirThread(raiz, threadId), 'claims.jsonl');
}

/** Le as claims da thread (armazem JSONL: a ultima gravacao de um id vence). */
export function lerClaims(raiz: string, threadId: string): Claim[] {
  return lerJsonl<Claim>(caminhoClaims(raiz, threadId));
}

/** Proximo id sequencial (`C1`, `C2`, ...) dentro da thread. */
export function proximoIdDeClaim(claims: Claim[]): string {
  return proximoIdSequencial(claims.map((c) => c.id), 'C');
}

/** Palavras que tornam uma alegacao negativa ou absoluta, portanto nao auditavel a olho. */
const TERMOS_ABSOLUTOS = [
  'nenhum',
  'nenhuma',
  'nunca',
  'sempre',
  'zero',
  'todos',
  'todas',
  'nao ha',
  'nao existe',
  'nao resta',
  'sem nenhum',
  '100%',
  'totalmente',
  'completamente',
];

/** A alegacao e negativa/absoluta (exige comando de verificacao)? */
export function ehAlegacaoNegativa(texto: string): boolean {
  const normalizado = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return TERMOS_ABSOLUTOS.some((t) => normalizado.includes(t));
}

/**
 * Monta a claim a partir dos dados brutos, SEM tocar em disco.
 *
 * E aqui que mora a regra de construcao de uma alegacao: quem e negativa/absoluta, e que
 * uma alegacao sem comando ja nasce `nao-verificavel`. A funcao e pura de proposito: o
 * auditor periodico do bloco B5 registra achados com esta MESMA regra, sem reimplementa-la
 * e sem afrouxa-la (o auditor tambem nao tem direito a self-report).
 */
export function montarClaim(entrada: {
  id: string;
  /** Dono da alegacao: a thread, ou a rodada de auditoria que a produziu. */
  dono: string;
  fase: Fase | null;
  arquivo: string;
  alegacao: string;
  verificar?: string[];
  /** I-43: `nucleo.doneWhen` quando a claim veio de um criterio de pronto da thread. */
  origem?: Claim['origem'];
}): Claim {
  const verificar = (entrada.verificar ?? []).filter((c) => c.trim() !== '');
  return {
    id: entrada.id,
    thread: entrada.dono,
    fase: entrada.fase,
    arquivo: entrada.arquivo,
    alegacao: entrada.alegacao.trim(),
    negativa: ehAlegacaoNegativa(entrada.alegacao),
    verificar,
    criadoEm: agora(),
    estado: verificar.length > 0 ? 'pendente' : 'nao-verificavel',
    ...(entrada.origem ? { origem: entrada.origem } : {}),
    // I-53 (RM-037, P6): a mesma regra para CLI, MCP, canarios e auditor, porque todos passam aqui.
    lint: analisarComandos(verificar),
  };
}

/** Grava uma claim no `claims.jsonl` (append-only). */
export function gravarClaim(raiz: string, claim: Claim): void {
  anexarJsonl(caminhoClaims(raiz, claim.thread), claim);
}

export interface OpcoesDeClaim {
  arquivo: string;
  alegacao: string;
  /** Comandos que reexecutam a alegacao. Vazio deixa a claim nao verificavel. */
  verificar?: string[];
  fase?: Fase | null;
  /** I-43: `nucleo.doneWhen` quando o nucleo registra um criterio de pronto. */
  origem?: Claim['origem'];
}

/** I-42 (D5): a suite inteira do manifesto, que um ciclo sem CHECK nao roda como prova. */
function comandoDeTesteDoManifesto(raiz: string): string | undefined {
  return carregarManifesto(raiz)?.manifesto.verify.test;
}

/** `ork claims add`: registra a alegacao e a lista no `thread.json` e no ledger. */
export function adicionarClaim(raiz: string, threadId: string, opcoes: OpcoesDeClaim): Claim {
  const thread = lerThread(raiz, threadId);
  if (cicloSemCheck(thread)) validarProvaSemCheck(opcoes.verificar ?? [], comandoDeTesteDoManifesto(raiz));
  const existentes = lerClaims(raiz, threadId);
  const claim = montarClaim({
    id: proximoIdDeClaim(existentes),
    dono: threadId,
    fase: opcoes.fase ?? thread.faseAtual,
    arquivo: opcoes.arquivo,
    alegacao: opcoes.alegacao,
    verificar: opcoes.verificar,
    origem: opcoes.origem,
  });
  const negativa = claim.negativa;
  const verificar = claim.verificar;
  gravarClaim(raiz, claim);

  thread.claims = [...new Set([...(thread.claims ?? []), claim.id])];
  gravarThread(raiz, thread);

  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.claimRegistrada, {
    claim: claim.id,
    fase: claim.fase,
    arquivo: claim.arquivo,
    alegacao: claim.alegacao,
    negativa,
    verificar,
    estado: claim.estado,
    ...(claim.lint?.length ? { lint: claim.lint.map((a) => a.regra) } : {}),
  });
  return claim;
}

/** Prefixo do arquivo das claims de criterio, para o veredito dizer de onde veio. */
export const ARQUIVO_DONEWHEN = 'thread.json#doneWhen';

/**
 * Registra os criterios de pronto da thread como CLAIMS do nucleo (I-43, D4, viga b).
 *
 * E o que torna `doneWhen` executavel sem criar uma segunda maquina de rodar comando.
 * A alternativa rejeitada em D4 era um executor proprio em `donewhen.ts`, que
 * duplicaria timeout, captura de saida, codigo de retorno e registro de evidencia,
 * tudo ja resolvido em claims e verify. Duas maquinas de executar comando divergem, e
 * a divergencia aparece como criterio que passa num lugar e falha no outro.
 *
 * A claim carrega o TEXTO do criterio na alegacao, e e por isso que o veredito do
 * `ork verify` o nomeia sem precisar de nenhum campo extra: quando ela reprova, o
 * relatorio ja diz qual criterio falhou.
 *
 * IDEMPOTENTE: registrar de novo nao duplica claim. `ork verify` roda em toda fase, e
 * uma claim por criterio POR RODADA transformaria a lista num acumulador.
 */
export function registrarCriteriosDePronto(raiz: string, threadId: string): Claim[] {
  const thread = lerThread(raiz, threadId);
  const criterios = thread.doneWhen ?? [];
  if (criterios.length === 0) return [];

  const existentes = lerClaims(raiz, threadId);
  const novas: Claim[] = [];
  for (const { criterio, comando } of criterios) {
    const alegacao = `criterio de pronto: ${criterio.trim()}`;
    const ja = existentes.find((c) => c.origem === 'nucleo.doneWhen' && c.alegacao === alegacao);
    if (ja) continue;
    novas.push(adicionarClaim(raiz, threadId, {
      arquivo: ARQUIVO_DONEWHEN,
      alegacao,
      verificar: [comando],
      origem: 'nucleo.doneWhen',
    }));
  }
  return novas;
}

/** Acha a claim pelo id, com erro acionavel quando ela nao existe. */
export function exigirClaim(raiz: string, threadId: string, claimId: string): Claim {
  const claim = lerClaims(raiz, threadId).find((c) => c.id === claimId);
  if (!claim) {
    throw new Error(`claim "${claimId}" nao existe na thread ${threadId}`);
  }
  return claim;
}

/**
 * Anexa um comando de verificacao a uma claim ja registrada.
 *
 * E o caminho de correcao da alegacao negativa sem comando: em vez de apagar a alegacao
 * do historico, o autor declara COMO ela se comprova, e o append mais novo passa a valer.
 */
export function anexarComando(
  raiz: string,
  threadId: string,
  claimId: string,
  comando: string
): Claim {
  const claim = exigirClaim(raiz, threadId, claimId);
  if (cicloSemCheck(lerThread(raiz, threadId))) {
    validarProvaSemCheck([...claim.verificar, comando], comandoDeTesteDoManifesto(raiz));
  }
  const atualizada: Claim = {
    ...claim,
    verificar: [...claim.verificar, comando],
    estado: 'pendente',
    // I-53: claim nascida sob a regra refaz o lint; a antiga continua sem o campo (so aviso).
    ...(claim.lint ? { lint: analisarComandos([...claim.verificar, comando]) } : {}),
  };
  gravarClaim(raiz, atualizada);
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.claimRegistrada, {
    claim: claimId,
    alteracao: 'comando de verificacao anexado',
    verificar: atualizada.verificar,
    estado: atualizada.estado,
  });
  return atualizada;
}

/**
 * Retira uma claim, com motivo obrigatorio.
 *
 * O `claims.jsonl` e append-only: a alegacao errada continua no historico, com a retirada
 * registrada em cima. `ork verify` para de exigir prova dela, e o ledger guarda o porque.
 */
export function retirarClaim(
  raiz: string,
  threadId: string,
  claimId: string,
  motivo: string
): Claim {
  const claim = exigirClaim(raiz, threadId, claimId);
  const atualizada: Claim = { ...claim, estado: 'retirada', motivoDaRetirada: motivo };
  gravarClaim(raiz, atualizada);
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.claimRegistrada, {
    claim: claimId,
    alteracao: 'claim retirada',
    alegacao: claim.alegacao,
    motivoDaRetirada: motivo,
    estado: 'retirada',
  });
  return atualizada;
}

/** Regrava a claim com o estado carimbado pelo `ork verify` (o append mais novo vence). */
export function carimbarEstado(raiz: string, claim: Claim, estado: Claim['estado']): Claim {
  const atualizada: Claim = { ...claim, estado };
  gravarClaim(raiz, atualizada);
  return atualizada;
}

/** Tabela de `ork claims list`. */
export function tabelaDeClaims(raiz: string, threadId: string): string {
  const claims = lerClaims(raiz, threadId);
  if (claims.length === 0) {
    return (
      `Nenhuma claim na thread ${threadId}.\n` +
      `Registre uma com: ork claims add ${threadId} <arquivo> --claim "<alegacao>" --verificar "<comando>"`
    );
  }
  const linhas = claims.map((c) => [
    c.id,
    c.fase ?? '-',
    c.estado,
    c.negativa ? 'sim' : 'nao',
    c.arquivo,
    c.verificar.join(' && ') || '(sem comando)',
    c.alegacao,
  ]);
  return tabela(['ID', 'FASE', 'ESTADO', 'NEGATIVA', 'ARQUIVO', 'VERIFICAR', 'ALEGACAO'], linhas);
}

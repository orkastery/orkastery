/**
 * I-42 (D4, D5): a prova minima de um ciclo sem CHECK, em tres degraus.
 *
 *  1. Teste focado: havendo teste homonimo para algum caminho do commit (ou sendo o caminho um
 *     teste), roda so ele e grava comando e codigo de saida.
 *  2. Claim retrospectiva: sem teste homonimo, uma claim de uma linha com ate dois comandos
 *     baratos. O nucleo recusa claim que rode a suite inteira do manifesto (custo medido na I-42:
 *     227,6 s contra ~12 s do teste focado).
 *  3. Ausencia declarada: sem teste nem comando honesto, o evento `prova_ausente` registra os
 *     caminhos sem prova e o motivo. Nao ha prova fingida e nao ha ausencia em silencio.
 *
 * O que nao acontece em degrau nenhum: baseline do manifesto ou a suite completa.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { registrar, TIPOS_DE_EVENTO } from './ledger';
import { dirThread, lerThread } from './thread';
import { Thread } from './types';

/** Teto de comandos por claim num ciclo sem CHECK (degrau 2). */
export const LIMITE_DE_COMANDOS_SEM_CHECK = 2;

/** O ciclo da thread nao tem CHECK: a prova e a minima, feita pela propria GO. */
export function cicloSemCheck(thread: Pick<Thread, 'blocos'>): boolean {
  return !thread.blocos.some((b) => b.fases.includes('CHECK'));
}

/**
 * O teste focado de um caminho, por convencao: `core/src/X.ts` -> `core/test/X.test.ts`, e um
 * `core/test/X.test.ts` e o proprio teste. Devolve o caminho do teste, ou null quando nao ha.
 */
export function testeFocado(raiz: string, caminho: string): string | null {
  const c = caminho.replace(/\\/g, '/');
  if (/^core\/test\/[^/]+\.test\.ts$/.test(c)) return fs.existsSync(path.join(raiz, c)) ? c : null;
  const m = /^core\/src\/([^/]+)\.ts$/.exec(c);
  if (!m) return null;
  const teste = `core/test/${m[1]}.test.ts`;
  return fs.existsSync(path.join(raiz, teste)) ? teste : null;
}

/** O comando que roda so o teste focado (degrau 1). */
export function comandoDoTesteFocado(teste: string): string {
  const nome = path.basename(teste).replace(/\.ts$/, '.js');
  return `npm --prefix core run build:test && node --test core/dist-test/test/${nome}`;
}

/**
 * Recusa a claim que fura o degrau 2: mais comandos do que o teto, ou a suite inteira do
 * manifesto. Mensagem tipada, com a saida certa.
 */
export function validarProvaSemCheck(verificar: readonly string[], comandoDeTesteDoManifesto?: string): void {
  if (verificar.length > LIMITE_DE_COMANDOS_SEM_CHECK) {
    throw new Error(`claims.custo: ciclo sem CHECK aceita ate ${LIMITE_DE_COMANDOS_SEM_CHECK} comandos por claim ` +
      `(recebidos ${verificar.length}); use o teste focado ou declare a ausencia com ork claims ausente`);
  }
  const suite = comandoDeTesteDoManifesto?.trim();
  if (suite && verificar.some((c) => c.includes(suite))) {
    throw new Error(`claims.custo: ciclo sem CHECK nao roda a suite inteira ("${suite}"); ` +
      'use o teste focado do arquivo que mudou');
  }
}

export interface AusenciaDeProva {
  paths: string[];
  motivo: string;
  commit?: string;
}

/** Degrau 3: grava no ledger da thread que estes caminhos ficaram sem prova, e por que. */
export function registrarProvaAusente(raiz: string, threadId: string, ausencia: AusenciaDeProva): void {
  lerThread(raiz, threadId); // a thread tem de existir
  const motivo = ausencia.motivo.trim();
  if (!motivo) throw new Error('prova.ausente: o motivo e obrigatorio (uma linha)');
  if (ausencia.paths.length === 0) throw new Error('prova.ausente: informe os caminhos que ficaram sem prova');
  registrar(dirThread(raiz, threadId), threadId, TIPOS_DE_EVENTO.provaAusente, {
    paths: ausencia.paths,
    motivo,
    ...(ausencia.commit ? { commit: ausencia.commit } : {}),
  });
}

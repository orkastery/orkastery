/**
 * RM-058 (N4): o apoio comum dos testes da supervisão, da reconciliação e do vigia. Contas, sessões, provas, pedidos e
 * remotos são SIMULADOS; o arco é o da N2, autorizado pelo ingresso simulado do Telegram (`noctum-apoio.ts`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import { chaveLocal } from '../src/hitl-local-receipt';
import { LeituraDeSessoes } from '../src/noctum-capacidade';
import { CONTRATO_SUPERVISAO, dirDaSupervisao, Instancia } from '../src/noctum-supervisao';
import { PerfilDeDespacho } from '../src/runtime-profiles';
import { SessaoDaConta } from '../src/sessoes-contas';

export const MAQUINA = 'maquina-simulada';

/** Uma instância SIMULADA de condutor ou vigia deste processo de teste. */
export function instancia(papel: Instancia['papel'], n = 1): Instancia {
  return { papel, instancia: `${papel}-${n}-SIMULADO`, pid: process.pid, maquina: MAQUINA };
}

const arquivo = (raiz: string, arco: string) => path.join(dirDaSupervisao(raiz, arco), 'supervisao.jsonl');

/** As linhas cruas do log da supervisão, para os testes de adulteração. */
export function linhasDoLog(raiz: string, arco: string): string[] {
  return fs.readFileSync(arquivo(raiz, arco), 'utf8').split('\n').filter(Boolean);
}

/** Regrava o log com as linhas dadas, privado como o núcleo grava. */
export function regravarLog(raiz: string, arco: string, linhas: string[], cauda = ''): void {
  fs.writeFileSync(arquivo(raiz, arco), linhas.map(l => `${l}\n`).join('') + cauda, { mode: 0o600 });
  fs.chmodSync(arquivo(raiz, arco), 0o600);
}

/** Assina dados como a supervisão assina, ou noutro domínio (o do log do arco), para provar que a subchave é própria. */
export function assinar(raiz: string, dados: unknown, dominio: string = CONTRATO_SUPERVISAO): string {
  const chave = createHmac('sha256', chaveLocal(raiz, false)).update(dominio).digest();
  return JSON.stringify({ dados, mac: createHmac('sha256', chave).update(JSON.stringify(dados)).digest('hex') });
}

const fonte = (ok: boolean, perfil: string | null) => ({ origem: `claude agents --json --all (${perfil ? `perfil ${perfil}` : 'conta do processo'}, SIMULADO)`,
  ok, detalhe: ok ? '' : 'SIMULADO: claude agents falhou' });
const perfilDe = (id: string): PerfilDeDespacho => ({ id, runtime: 'claude-bg', configDir: `/contas/${id}` });

/** A leitura do runtime nas contas dadas (perfis do envelope), com as sessões dadas; todas as fontes respondem. */
export function runtimeCom(sessoes: Array<Partial<SessaoDaConta> & { sessionId: string }>, perfis: string[] = ['perfil-a']): LeituraDeSessoes {
  return {
    sessoes: sessoes.map(s => ({ runtime: 'claude-bg', perfil: perfis[0] ?? null, fantasma: false, viva: true, state: 'working', ...s })),
    fontes: perfis.map(p => fonte(true, p)),
    contas: perfis.map(p => ({ runtime: 'claude-bg' as const, perfil: perfilDe(p) })),
  };
}

/** O runtime que não respondeu: a leitura tem lacuna e nada é provado. */
export function runtimeSemLeitura(perfis: string[] = ['perfil-a']): LeituraDeSessoes {
  return { sessoes: [], fontes: perfis.map(p => fonte(false, p)), contas: perfis.map(p => ({ runtime: 'claude-bg' as const, perfil: perfilDe(p) })) };
}

/** Espera alguns milissegundos sem ocupar a CPU. */
export function esperar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

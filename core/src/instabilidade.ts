/**
 * RM-037 (fatia 6, P6/T15): o registro de instabilidade, contrato `ork.instabilidade/v1`.
 *
 * Arquivo `core/instabilidade.json` na arvore verificada. Nasce vazio. Uma entrada diz que um teste
 * depende do relogio e por isso reprova sob steal alto; ela so entra com a taxa MEDIDA (falhas em
 * rodadas, com o comando que mediu e a data) e com revalidacao em ate 30 dias da medida. Vencida a
 * revalidacao, a entrada deixa de valer ate alguem medir de novo.
 *
 * O registro nunca atenua uma falha sozinho: ele so diz ao verify que aquele teste e de relogio, e
 * a reprovacao so vira `verify.timeout` com o steal medido acima de 40% na janela do comando. Sem
 * steal, o teste registrado reprova como qualquer outro.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTRATO_INSTABILIDADE = 'ork.instabilidade/v1';
export const ARQUIVO_INSTABILIDADE = 'core/instabilidade.json';
/** Prazo maximo entre a medida e a revalidacao. */
export const REVALIDACAO_MAXIMA_DIAS = 30;
export const CAUSAS_DE_INSTABILIDADE = ['relogio'] as const;
export type CausaDeInstabilidade = (typeof CAUSAS_DE_INSTABILIDADE)[number];

export interface TaxaMedida {
  /** Rodadas em que o teste reprovou. */
  falhas: number;
  /** Rodadas medidas. */
  rodadas: number;
  /** O comando que mediu, reproduzivel. */
  comando: string;
  /** Data da medida, `AAAA-MM-DD`. */
  medidaEm: string;
}

export interface EntradaDeInstabilidade {
  /** O nome do teste como o runner reporta (o mesmo de `testeQueCaiu` no ledger). */
  teste: string;
  /** O arquivo do teste, relativo a raiz. */
  arquivo: string;
  causa: CausaDeInstabilidade;
  taxa: TaxaMedida;
  /** Ate quando a medida vale, `AAAA-MM-DD`, no maximo 30 dias depois de `taxa.medidaEm`. */
  revalidarAte: string;
  /** Opcional: de onde veio a entrada (thread, PR). */
  nota?: string;
}

export interface RegistroDeInstabilidade {
  contrato: typeof CONTRATO_INSTABILIDADE;
  entradas: EntradaDeInstabilidade[];
}

export interface RegistroLido {
  arquivo: string;
  /** O arquivo existe na arvore. Ausente vale registro vazio. */
  presente: boolean;
  /** Erros de contrato. Com qualquer erro, nenhuma entrada vale. */
  erros: string[];
  /** Entradas validas e dentro da revalidacao. */
  vigentes: EntradaDeInstabilidade[];
  /** Entradas validas com a revalidacao vencida: nao valem ate nova medida. */
  vencidas: EntradaDeInstabilidade[];
}

const DIA_MS = 24 * 60 * 60 * 1000;
const CHAVES_DA_ENTRADA = new Set(['teste', 'arquivo', 'causa', 'taxa', 'revalidarAte', 'nota']);
const CHAVES_DA_TAXA = new Set(['falhas', 'rodadas', 'comando', 'medidaEm']);

function data(valor: unknown): number | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const ms = Date.parse(`${valor}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === valor ? ms : null;
}

const texto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const inteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Os erros de contrato de um registro ja desserializado. Lista vazia: o registro vale. */
export function validarRegistro(bruto: unknown): string[] {
  const erros: string[] = [];
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return ['o registro precisa ser um objeto JSON'];
  const r = bruto as Record<string, unknown>;
  if (r.contrato !== CONTRATO_INSTABILIDADE) erros.push(`contrato precisa ser "${CONTRATO_INSTABILIDADE}"`);
  for (const chave of Object.keys(r)) {
    if (chave !== 'contrato' && chave !== 'entradas') erros.push(`chave desconhecida no registro: ${chave}`);
  }
  if (!Array.isArray(r.entradas)) return [...erros, 'entradas precisa ser uma lista (vazia no nascimento)'];
  const vistos = new Set<string>();
  r.entradas.forEach((e, i) => {
    const onde = `entradas[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      erros.push(`${onde}: precisa ser um objeto`);
      return;
    }
    const entrada = e as Record<string, unknown>;
    for (const chave of Object.keys(entrada)) {
      if (!CHAVES_DA_ENTRADA.has(chave)) erros.push(`${onde}: chave desconhecida ${chave}`);
    }
    if (!texto(entrada.teste)) erros.push(`${onde}.teste: nome do teste como o runner reporta`);
    else if (vistos.has(entrada.teste)) erros.push(`${onde}.teste: "${entrada.teste}" repetido`);
    else vistos.add(entrada.teste);
    if (!texto(entrada.arquivo)) erros.push(`${onde}.arquivo: caminho do teste`);
    if (!(CAUSAS_DE_INSTABILIDADE as readonly unknown[]).includes(entrada.causa)) {
      erros.push(`${onde}.causa: ${CAUSAS_DE_INSTABILIDADE.join(' ou ')}`);
    }
    if (entrada.nota !== undefined && typeof entrada.nota !== 'string') erros.push(`${onde}.nota: texto`);
    const taxa = entrada.taxa as Record<string, unknown> | undefined;
    let medida: number | null = null;
    if (!taxa || typeof taxa !== 'object' || Array.isArray(taxa)) {
      erros.push(`${onde}.taxa: sem taxa medida a entrada nao entra (falhas, rodadas, comando, medidaEm)`);
    } else {
      for (const chave of Object.keys(taxa)) {
        if (!CHAVES_DA_TAXA.has(chave)) erros.push(`${onde}.taxa: chave desconhecida ${chave}`);
      }
      if (!inteiro(taxa.rodadas) || taxa.rodadas < 1) erros.push(`${onde}.taxa.rodadas: inteiro de rodadas medidas, 1 ou mais`);
      if (!inteiro(taxa.falhas) || taxa.falhas < 1) erros.push(`${onde}.taxa.falhas: inteiro de reprovacoes medidas, 1 ou mais`);
      else if (inteiro(taxa.rodadas) && taxa.falhas > taxa.rodadas) erros.push(`${onde}.taxa.falhas: maior que rodadas`);
      if (!texto(taxa.comando)) erros.push(`${onde}.taxa.comando: o comando que mediu, reproduzivel`);
      medida = data(taxa.medidaEm);
      if (medida === null) erros.push(`${onde}.taxa.medidaEm: data AAAA-MM-DD valida`);
    }
    const revalidar = data(entrada.revalidarAte);
    if (revalidar === null) erros.push(`${onde}.revalidarAte: data AAAA-MM-DD valida`);
    else if (medida !== null) {
      if (revalidar < medida) erros.push(`${onde}.revalidarAte: antes da medida`);
      else if (revalidar - medida > REVALIDACAO_MAXIMA_DIAS * DIA_MS) {
        erros.push(`${onde}.revalidarAte: no maximo ${REVALIDACAO_MAXIMA_DIAS} dias depois de taxa.medidaEm`);
      }
    }
  });
  return erros;
}

/** A entrada vale hoje? Vale ate o fim do dia de `revalidarAte`, em UTC. */
export function vigente(entrada: EntradaDeInstabilidade, agoraMs: number = Date.now()): boolean {
  const ate = data(entrada.revalidarAte);
  return ate !== null && agoraMs < ate + DIA_MS;
}

/** Le o registro da arvore `cwd`. Ausente: vazio. Ilegivel ou fora do contrato: erros e nada vale. */
export function lerRegistroDeInstabilidade(cwd: string, agoraMs: number = Date.now()): RegistroLido {
  const arquivo = join(cwd, ARQUIVO_INSTABILIDADE);
  if (!existsSync(arquivo)) return { arquivo: ARQUIVO_INSTABILIDADE, presente: false, erros: [], vigentes: [], vencidas: [] };
  let bruto: unknown;
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    return { arquivo: ARQUIVO_INSTABILIDADE, presente: true, erros: [`JSON ilegivel: ${(e as Error).message}`], vigentes: [], vencidas: [] };
  }
  const erros = validarRegistro(bruto);
  if (erros.length > 0) return { arquivo: ARQUIVO_INSTABILIDADE, presente: true, erros, vigentes: [], vencidas: [] };
  const entradas = (bruto as RegistroDeInstabilidade).entradas;
  return {
    arquivo: ARQUIVO_INSTABILIDADE,
    presente: true,
    erros: [],
    vigentes: entradas.filter((e) => vigente(e, agoraMs)),
    vencidas: entradas.filter((e) => !vigente(e, agoraMs)),
  };
}

/** Os nomes dos testes de relogio que o verify pode considerar nesta rodada. */
export function testesDeRelogioVigentes(registro: RegistroLido): Set<string> {
  return new Set(registro.vigentes.filter((e) => e.causa === 'relogio').map((e) => e.teste));
}

/** Contratos puros I09. Validar formato nao concede autoridade nem executa verify. */
import { createHash } from 'node:crypto';
import { Fase } from './types';

export const PLAYBOOK_VERSION = 1 as const;
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const MAX_RESULT_BYTES = 256 * 1024;
type Objeto = Record<string, unknown>;
type Primitivo = string | number | boolean | null;

export class ContratoPlaybookInvalido extends Error {
  constructor(public readonly campo: string, detalhe: string) {
    super(`${campo}: ${detalhe}`);
    this.name = 'ContratoPlaybookInvalido';
  }
}

function exigir(condicao: unknown, campo: string, detalhe: string): asserts condicao {
  if (!condicao) throw new ContratoPlaybookInvalido(campo, detalhe);
}

function objeto(valor: unknown): valor is Objeto {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(valor));
}

/** Somente dados JSON, sem getters, prototipos customizados, ciclos ou arrays esparsos. */
function exigirJson(valor: unknown): void {
  const ativos = new Set<object>();
  let nos = 0;
  function visitar(v: unknown, profundidade: number): void {
    exigir(++nos <= MAX_RESULT_BYTES && profundidade <= 32, '$', 'JSON excede limite estrutural');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      exigir(Number.isFinite(v), '$', 'numero JSON invalido');
      return;
    }
    exigir(Array.isArray(v) || objeto(v), '$', 'esperado dado JSON simples');
    exigir(!ativos.has(v), '$', 'ciclo JSON');
    ativos.add(v);
    const chaves = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      exigir(chaves.length === v.length + 1, '$', 'array esparso ou com campos extras');
    }
    for (const chave of chaves) {
      if (Array.isArray(v) && chave === 'length') continue;
      exigir(typeof chave === 'string', '$', 'chave nao JSON');
      const d = Object.getOwnPropertyDescriptor(v, chave)!;
      exigir(d.enumerable && 'value' in d, '$', 'campo nao JSON');
      if (Array.isArray(v)) exigir(/^(0|[1-9][0-9]*)$/.test(chave) && Number(chave) < v.length, '$', 'indice invalido');
      visitar(d.value, profundidade + 1);
    }
    ativos.delete(v);
  }
  visitar(valor, 0);
  exigir(Buffer.byteLength(JSON.stringify(valor), 'utf8') <= MAX_RESULT_BYTES, '$', 'JSON excede 256 KiB');
}

function primitivo(v: unknown): v is Primitivo {
  return v === null || typeof v === 'string' || typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isSafeInteger(v));
}

/** Subconjunto fechado. $ref, combinadores, pattern e keywords desconhecidas falham. */
export function validarSchemaPlaybook(schema: unknown): void {
  exigirJson(schema);
  function visitar(s: unknown, campo: string, nivel: number): void {
    exigir(objeto(s), campo, 'schema deve ser objeto');
    exigir(nivel <= 24, campo, 'schema profundo demais');
    const porTipo: Record<string, string[]> = {
      object: ['properties', 'required', 'additionalProperties'],
      array: ['items', 'minItems', 'maxItems'],
      string: ['minLength', 'maxLength'],
      integer: [], boolean: [], null: [],
    };
    exigir(typeof s.type === 'string' && Object.hasOwn(porTipo, s.type), campo, 'tipo nao suportado');
    const permitidas = ['type', 'const', 'enum', ...porTipo[s.type]];
    if (nivel === 0) permitidas.push('$schema');
    for (const chave of Object.keys(s)) exigir(permitidas.includes(chave), `${campo}.${chave}`, 'keyword nao suportada');
    if (Object.hasOwn(s, '$schema')) exigir(s.$schema === JSON_SCHEMA_DIALECT, campo, 'dialeto nao suportado');
    if (Object.hasOwn(s, 'const')) exigir(primitivo(s.const), campo, 'const deve ser primitivo');
    if (Object.hasOwn(s, 'enum')) {
      exigir(Array.isArray(s.enum) && s.enum.length > 0 && s.enum.every(primitivo), campo, 'enum invalido');
      exigir(new Set(s.enum).size === s.enum.length, campo, 'enum repetido');
    }
    for (const [min, max] of [['minLength', 'maxLength'], ['minItems', 'maxItems']]) {
      for (const k of [min, max]) if (Object.hasOwn(s, k)) {
        exigir(Number.isSafeInteger(s[k]) && (s[k] as number) >= 0, campo, `${k} invalido`);
      }
      if (Object.hasOwn(s, min) && Object.hasOwn(s, max)) exigir((s[min] as number) <= (s[max] as number), campo, 'limites invertidos');
    }
    if (s.type === 'object') {
      exigir(objeto(s.properties) && s.additionalProperties === false && Array.isArray(s.required), campo, 'objeto deve ser fechado');
      exigir(s.required.every(k => typeof k === 'string' && Object.hasOwn(s.properties as Objeto, k)), campo, 'required desconhecido');
      exigir(new Set(s.required).size === s.required.length, campo, 'required repetido');
      for (const [k, filho] of Object.entries(s.properties)) visitar(filho, `${campo}.properties.${k}`, nivel + 1);
    }
    if (s.type === 'array') visitar(s.items, `${campo}.items`, nivel + 1);
    // Nao aceitar restricoes impossiveis como const de outro tipo ou fora do enum.
    const valores = Object.hasOwn(s, 'const') ? [s.const] : (s.enum as unknown[] | undefined) ?? [];
    for (const v of valores) validarValor(v, s, campo);
  }
  visitar(schema, '$schema', 0);
}

function validarValor(v: unknown, s: Objeto, campo: string): void {
  const tipoOk = s.type === 'object' ? objeto(v) : s.type === 'array' ? Array.isArray(v) :
    s.type === 'null' ? v === null : s.type === 'integer' ? Number.isSafeInteger(v) : typeof v === s.type;
  exigir(tipoOk, campo, `tipo esperado: ${s.type}`);
  if (Object.hasOwn(s, 'const')) exigir(v === s.const, campo, 'const divergente');
  if (Array.isArray(s.enum)) exigir(s.enum.includes(v), campo, 'valor fora do enum');
  if (typeof v === 'string' || Array.isArray(v)) {
    const tamanho = typeof v === 'string' ? [...v].length : v.length;
    const min = s[typeof v === 'string' ? 'minLength' : 'minItems'] as number | undefined;
    const max = s[typeof v === 'string' ? 'maxLength' : 'maxItems'] as number | undefined;
    exigir(min === undefined || tamanho >= min, campo, 'tamanho abaixo do minimo');
    exigir(max === undefined || tamanho <= max, campo, 'tamanho acima do maximo');
  }
  if (objeto(v)) {
    const props = s.properties as Objeto;
    for (const k of s.required as string[]) exigir(Object.hasOwn(v, k), `${campo}.${k}`, 'campo obrigatorio ausente');
    for (const k of Object.keys(v)) {
      exigir(Object.hasOwn(props, k), `${campo}.${k}`, 'campo desconhecido');
      validarValor(v[k], props[k] as Objeto, `${campo}.${k}`);
    }
  }
  if (Array.isArray(v)) v.forEach((item, i) => validarValor(item, s.items as Objeto, `${campo}[${i}]`));
}

export function validarContratoPlaybook(valor: unknown, schema: unknown): void {
  validarSchemaPlaybook(schema);
  exigirJson(valor);
  validarValor(valor, schema as Objeto, '$');
}

/** Canonizacao independente da ordem de propriedades; arrays preservam sua ordem. */
export function hashJsonPlaybook(valor: unknown): string {
  exigirJson(valor);
  function canonico(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
    if (objeto(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  return createHash('sha256').update(canonico(valor)).digest('hex');
}

export const textoPlaybook = { type: 'string', minLength: 1, maxLength: 4096 } as const;
export function objetoFechado(properties: Objeto, required = Object.keys(properties)): Objeto {
  return { type: 'object', properties, required, additionalProperties: false };
}
export function listaPlaybook(items: unknown, minItems = 0): Objeto {
  return { type: 'array', items, minItems, maxItems: 256 };
}

export interface ClaimCandidataPlaybook {
  tarefa: string;
  arquivo: string;
  alegacao: string;
  verifyId: string;
}
export interface ResultadoCandidatoPlaybook {
  schemaVersion: typeof PLAYBOOK_VERSION;
  claims: ClaimCandidataPlaybook[];
}

export interface IdentidadeFasePlaybook {
  fase: Fase;
  slug: string;
  sessionId: string;
  dispatchId: string;
}
export interface ResultadoFasePlaybook extends IdentidadeFasePlaybook {
  schemaVersion: typeof PLAYBOOK_VERSION;
  estado: 'concluida' | 'falhou' | 'interrompida';
  reciboId: string;
  resultado: { produtoHomologado: boolean; GOIntegralConcluido: boolean; checkpoint: string };
}
const schemaFase = objetoFechado({
  schemaVersion: { type: 'integer', const: PLAYBOOK_VERSION },
  fase: { type: 'string', enum: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] },
  slug: textoPlaybook, sessionId: textoPlaybook, dispatchId: textoPlaybook,
  estado: { type: 'string', enum: ['concluida', 'falhou', 'interrompida'] },
  reciboId: textoPlaybook,
  resultado: objetoFechado({
    produtoHomologado: { type: 'boolean' }, GOIntegralConcluido: { type: 'boolean' }, checkpoint: textoPlaybook,
  }),
});

/** Apenas contrato e correlacao. T06 consumira a prova terminal externa de I04. */
export function validarResultadoFasePlaybook(valor: unknown, esperado: IdentidadeFasePlaybook): ResultadoFasePlaybook {
  validarContratoPlaybook(valor, schemaFase);
  const r = valor as ResultadoFasePlaybook;
  for (const k of ['fase', 'slug', 'sessionId', 'dispatchId'] as const) exigir(r[k] === esperado[k], k, 'despacho divergente');
  return r;
}

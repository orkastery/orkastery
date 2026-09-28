import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContratoPlaybookInvalido, JSON_SCHEMA_DIALECT, MAX_RESULT_BYTES, ResultadoCandidatoPlaybook,
  ResultadoFasePlaybook, hashJsonPlaybook, objetoFechado, validarContratoPlaybook,
  validarResultadoFasePlaybook, validarSchemaPlaybook,
} from '../src/playbook-contracts';
import {
  ContextoCapacidade, MatrizCapacidadesCandidata, NivelCapacidade, ReciboCapacidade,
  avaliarCapacidades, exigirCapacidadesRequeridas, fingerprintCapacidade, validarReciboCapacidade,
} from '../src/playbook-capabilities';

const claimsSchema: unknown = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas/claims.schema.json'), 'utf8'));
const clone = <T>(v: T): T => structuredClone(v);
const hash = (v: string): string => hashJsonPlaybook(v);
function contexto(): ContextoCapacidade {
  return {
    runtime: 'codex', versaoRuntime: '0.153.4', binarioSha256: hash('binario-fixture'),
    transporte: 'controlador-fixture', configSha256: hashJsonPlaybook({}),
    schemaSha256: hashJsonPlaybook(claimsSchema), codigoSha256: hash('codigo-fixture'),
    escopo: {
      projeto: '/fixture/projeto', thread: 'ork-fixture', fase: 'GO', dispatchId: 'dispatch-fixture',
      sessionId: 'session-fixture', base: 'a'.repeat(40), head: 'b'.repeat(40), prova: 'schema-e-negativas-v1',
    },
  };
}
function candidato(): ResultadoCandidatoPlaybook {
  return { schemaVersion: 1, claims: [{ tarefa: 'T01', arquivo: 'core/src/playbook-capabilities.ts', alegacao: 'Rejeita prova de outro fingerprint', verifyId: 'CP01' }] };
}
const todosNiveis: NivelCapacidade[] = ['help', 'transporte', 'teste', 'homologacao'];
function matriz(niveis: NivelCapacidade[] = todosNiveis): MatrizCapacidadesCandidata {
  return {
    schemaVersion: 1, contexto: contexto(),
    capacidades: [{ id: 'claims-schema', evidencias: Object.fromEntries(niveis.map(n => [n, `recibo-${n}`])) }],
  };
}
/** Fixtures do contrato de recibo externo. Nao sao provas de qualquer runtime instalado. */
function recibo(nivel: NivelCapacidade): ReciboCapacidade {
  const origens = { help: 'help', transporte: 'transporte', teste: 'deterministica', homologacao: 'nativa' } as const;
  return {
    schemaVersion: 1, id: `recibo-${nivel}`, fingerprint: fingerprintCapacidade(contexto()),
    capacidade: 'claims-schema', nivel, origem: origens[nivel],
    fonte: { id: `fixture-externa-${nivel}`, sha256: hash(`fonte-${nivel}`) },
    comando: ['fixture', nivel], saida: 'saida sintetica capturada para testar o contrato',
    inicio: '2026-09-08T12:00:00.000Z', fim: '2026-09-08T12:00:01.000Z',
    resultado: { estado: 'aprovado', exitCode: 0, esperados: ['positivo', 'negativo'], executados: ['positivo', 'negativo'], aprovados: ['positivo', 'negativo'], skipped: 0, todo: 0 },
  };
}
function fontes() {
  const store = new Map(todosNiveis.map(n => [`recibo-${n}`, recibo(n)]));
  return { store, resolver: (id: string): unknown => store.get(id) };
}

test('schema real aceita CP01 como candidato sem promover estado ou acrescentar comando', () => {
  validarSchemaPlaybook(claimsSchema);
  const entrada = candidato();
  const antes = clone(entrada);
  validarContratoPlaybook(entrada, claimsSchema);
  assert.deepEqual(entrada, antes);
  assert.equal(Object.hasOwn(entrada.claims[0], 'estado'), false);
});

for (const campo of ['estado', 'verificado', 'gate', 'comando', 'sessionId', 'recibo', '__proto__', 'constructor']) {
  test(`claim real rejeita campo de autoridade/desconhecido: ${campo}`, () => {
    const entrada = JSON.parse(JSON.stringify(candidato()));
    Object.defineProperty(entrada.claims[0], campo, { value: 'aprovado', enumerable: true });
    assert.throws(() => validarContratoPlaybook(entrada, claimsSchema), /campo desconhecido/);
  });
}
for (const entrada of [
  { ...candidato(), schemaVersion: 2 }, { ...candidato(), schemaVersion: '1' },
  { ...candidato(), claims: [] }, { claims: candidato().claims },
  { ...candidato(), produtoHomologado: true },
  { schemaVersion: 1, claims: [{ tarefa: 'T01', arquivo: 'x', alegacao: 'x' }] },
  { schemaVersion: 1, claims: [{ ...candidato().claims[0], verifyId: '' }] },
  { schemaVersion: 1, claims: [{ ...candidato().claims[0], alegacao: 5 }] },
]) {
  test(`claim rejeita formato incompativel ${JSON.stringify(entrada)}`, () => {
    assert.throws(() => validarContratoPlaybook(entrada, claimsSchema), ContratoPlaybookInvalido);
  });
}

for (const keyword of ['$ref', '$defs', 'anyOf', 'oneOf', 'allOf', 'pattern', 'format', 'default', 'not', 'unevaluatedProperties']) {
  test(`schema rejeita keyword ${keyword} inclusive em propriedade opcional nao usada`, () => {
    const schema = objetoFechado({ opcional: { type: 'string', [keyword]: 'ignorar seria inseguro' } }, []);
    assert.throws(() => validarContratoPlaybook({}, schema), /keyword nao suportada/);
  });
}
for (const schema of [
  true, {}, { type: ['string', 'null'] }, { type: 'number' },
  { type: 'string', $schema: 'http://json-schema.org/draft-07/schema#' },
  { type: 'object', properties: {}, required: [], additionalProperties: true },
  { type: 'object', properties: {}, required: ['desconhecida'], additionalProperties: false },
  { type: 'array' }, { type: 'string', minLength: -1 }, { type: 'string', minLength: 5, maxLength: 2 },
  { type: 'integer', const: '1' }, { type: 'string', enum: [] },
  { type: 'string', enum: ['x', 'x'] },
  objetoFechado({ x: { type: 'string', $schema: JSON_SCHEMA_DIALECT } }),
]) {
  test(`schema malformado falha fechado: ${JSON.stringify(schema)}`, () => {
    assert.throws(() => validarSchemaPlaybook(schema), ContratoPlaybookInvalido);
  });
}

test('subconjunto verifica limites, enum, const, required e tipos com semantica Unicode', () => {
  const schema = objetoFechado({
    valor: { type: 'string', minLength: 1, maxLength: 1, enum: ['😀'] },
    itens: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'integer', const: 1 } },
    flag: { type: 'boolean' }, nada: { type: 'null' },
  });
  const valor = { valor: '😀', itens: [1], flag: false, nada: null };
  validarContratoPlaybook(valor, schema);
  for (const patch of [{ valor: 'xx' }, { valor: 'x' }, { itens: [2] }, { itens: [1, 1] }, { itens: [1.1] }, { flag: 1 }, { nada: false }]) {
    assert.throws(() => validarContratoPlaybook({ ...valor, ...patch }, schema), ContratoPlaybookInvalido);
  }
});

test('entradas nao JSON, getters, ciclos, arrays esparsos e excesso de bytes sao recusados', () => {
  let getterChamado = false;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { getterChamado = true; return 1; } });
  const ciclo: Record<string, unknown> = {}; ciclo.self = ciclo;
  const esparso = new Array(1);
  for (const valor of [getter, ciclo, esparso, undefined, NaN, Infinity, new Date(), { x: undefined }, 'x'.repeat(MAX_RESULT_BYTES)]) {
    assert.throws(() => hashJsonPlaybook(valor), ContratoPlaybookInvalido);
  }
  assert.equal(getterChamado, false);
  let profundo: unknown = 1;
  for (let i = 0; i < 34; i++) profundo = { filho: profundo };
  assert.throws(() => hashJsonPlaybook(profundo), /limite estrutural/);
});

test('fingerprint independe da ordem de chaves e preserva ordem de arrays', () => {
  const c = contexto();
  const reverso = Object.fromEntries(Object.entries(c).reverse()) as unknown as ContextoCapacidade;
  assert.equal(fingerprintCapacidade(c), fingerprintCapacidade(reverso));
  assert.notEqual(hashJsonPlaybook(['a', 'b']), hashJsonPlaybook(['b', 'a']));
});
for (const campo of ['versaoRuntime', 'binarioSha256', 'transporte', 'configSha256', 'schemaSha256', 'codigoSha256', 'runtime'] as const) {
  test(`mudanca atual em ${campo} invalida a matriz e a prova anterior`, () => {
    const atual = contexto();
    if (campo === 'runtime') atual.runtime = 'claude';
    else atual[campo] = campo.endsWith('Sha256') ? hash('alterado') : 'alterado';
    assert.notEqual(fingerprintCapacidade(atual), fingerprintCapacidade(contexto()));
    assert.throws(() => avaliarCapacidades(matriz(), atual, ['claims-schema'], fontes().resolver), /fingerprint atual divergente/);
    const m = matriz(); m.contexto = atual;
    assert.throws(() => avaliarCapacidades(m, atual, ['claims-schema'], fontes().resolver), /outro fingerprint/);
  });
}
for (const campo of ['projeto', 'thread', 'fase', 'dispatchId', 'sessionId', 'base', 'head', 'prova'] as const) {
  test(`escopo ${campo} integra o fingerprint e impede replay em outro contexto`, () => {
    const atual = contexto();
    atual.escopo[campo] = campo === 'base' || campo === 'head' ? 'c'.repeat(40) : campo === 'fase' ? 'CHECK' : 'outra-identidade';
    assert.notEqual(fingerprintCapacidade(atual), fingerprintCapacidade(contexto()));
    assert.throws(() => avaliarCapacidades(matriz(), atual, ['claims-schema'], fontes().resolver), /fingerprint atual divergente/);
  });
}

test('quatro niveis permanecem distintos e help isolado nunca homologa', () => {
  const { resolver } = fontes();
  const esperados = [
    [true, false, false, false], [true, true, false, false],
    [true, true, true, false], [true, true, true, true],
  ];
  for (let n = 1; n <= 4; n++) {
    const resultado = avaliarCapacidades(matriz(todosNiveis.slice(0, n)), contexto(), ['claims-schema'], resolver);
    const c = resultado.capacidades[0];
    assert.deepEqual([c.observadaNoHelp, c.disponivelNoTransporte, c.testada, c.homologada], esperados[n - 1]);
    assert.equal(resultado.requeridasAtendidas, n === 4);
  }
});

test('testado e homologacao alegada sem transporte nao satisfazem capacidade requerida', () => {
  assert.throws(() => exigirCapacidadesRequeridas(matriz(['teste', 'homologacao']), contexto(), ['claims-schema'], fontes().resolver), /sem demonstracao/);
});
test('prova deterministica nao pode ocupar o nivel de homologacao nativa', () => {
  const { store, resolver } = fontes();
  store.get('recibo-homologacao')!.origem = 'deterministica';
  assert.throws(() => avaliarCapacidades(matriz(), contexto(), ['claims-schema'], resolver), /origem incompativel/);
});
test('sem fonte externa mesmo candidato com todas as referencias permanece unavailable', () => {
  const resultado = avaliarCapacidades(matriz(), contexto(), ['claims-schema']);
  assert.equal(resultado.capacidades[0].homologada, false);
  assert.equal(resultado.capacidades[0].estado, 'unavailable');
  assert.throws(() => exigirCapacidadesRequeridas(matriz(), contexto(), ['claims-schema']), /sem demonstracao/);
});
test('recibo completo embutido e flags de autoaprovacao sao rejeitados antes de resolver fontes', () => {
  let chamadas = 0;
  const resolver = () => { chamadas++; return recibo('homologacao'); };
  const m = matriz();
  for (const candidato of [
    { ...m, recibos: [recibo('homologacao')] }, { ...m, requeridasAtendidas: true },
    { ...m, capacidades: [{ ...m.capacidades[0], homologada: true }] },
    { ...m, capacidades: [{ id: 'claims-schema', evidencias: { homologacao: recibo('homologacao') } }] },
  ]) assert.throws(() => exigirCapacidadesRequeridas(candidato, contexto(), ['claims-schema'], resolver), ContratoPlaybookInvalido);
  assert.equal(chamadas, 0);
});
test('capacidade ausente, lista vazia e coorte vazia falham sem sucesso vacuo', () => {
  const { resolver } = fontes();
  const ausente = avaliarCapacidades(matriz(), contexto(), ['claims-schema', 'filho-nativo'], resolver);
  assert.deepEqual(ausente.requeridasSemDemonstracao, ['filho-nativo']);
  assert.equal(ausente.requeridasAtendidas, false);
  for (const [m, requeridas] of [[{ ...matriz(), capacidades: [] }, ['claims-schema']], [matriz(), []]] as const) {
    assert.throws(() => exigirCapacidadesRequeridas(m, contexto(), [...requeridas], resolver), /sem demonstracao/);
  }
});
test('recibos externos completos do contrato satisfazem o exemplo sintetico', () => {
  const resultado = exigirCapacidadesRequeridas(matriz(), contexto(), ['claims-schema'], fontes().resolver);
  assert.equal(resultado.schemaVersion, 1);
  assert.equal(resultado.capacidades[0].estado, 'homologada');
  assert.equal(resultado.fingerprint, fingerprintCapacidade(contexto()));
});

for (const campo of ['id', 'capacidade', 'nivel', 'fingerprint'] as const) {
  test(`recibo externo de outro ${campo} nao e aceito`, () => {
    const { store, resolver } = fontes();
    const r = store.get('recibo-teste')!;
    if (campo === 'nivel') r.nivel = 'homologacao';
    else r[campo] = campo === 'fingerprint' ? hash('outro') : 'outro';
    assert.throws(() => avaliarCapacidades(matriz(), contexto(), ['claims-schema'], resolver), ContratoPlaybookInvalido);
  });
}
for (const patch of [
  { esperados: [], executados: [], aprovados: [] },
  { executados: ['positivo'], aprovados: ['positivo'] },
  { aprovados: ['positivo'] }, { skipped: 1 }, { todo: 1 },
  { exitCode: 1 }, { estado: 'reprovado' as const }, { estado: 'unavailable' as const },
]) {
  test(`recibo sem demonstracao completa nao homologa: ${JSON.stringify(patch)}`, () => {
    const { store, resolver } = fontes();
    Object.assign(store.get('recibo-teste')!.resultado, patch);
    const r = avaliarCapacidades(matriz(), contexto(), ['claims-schema'], resolver);
    assert.equal(r.capacidades[0].homologada, false);
    assert.equal(r.requeridasAtendidas, false);
    assert.throws(() => exigirCapacidadesRequeridas(matriz(), contexto(), ['claims-schema'], resolver), /sem demonstracao/);
  });
}
test('recibo ausente ou contraditorio posterior impede selo mesmo com homologacao presente', () => {
  const { store, resolver } = fontes();
  store.delete('recibo-teste');
  const semFonte = avaliarCapacidades(matriz(), contexto(), ['claims-schema'], resolver);
  assert.equal(semFonte.capacidades[0].estado, 'unavailable');
  assert.equal(semFonte.capacidades[0].homologada, false);
  const reprovado = recibo('teste'); reprovado.resultado.estado = 'reprovado';
  store.set(reprovado.id, reprovado);
  const comFalha = avaliarCapacidades(matriz(), contexto(), ['claims-schema'], resolver);
  assert.equal(comFalha.capacidades[0].estado, 'reprovada');
  assert.equal(comFalha.capacidades[0].homologada, false);
});

test('recibos malformados, repeticoes e campos desconhecidos falham fechado', () => {
  for (const patch of [
    { schemaVersion: 2 }, { extra: true }, { fonte: { id: 'x', sha256: 'invalido' } },
    { inicio: 'ontem' }, { fim: '2026-09-08T11:59:59.000Z' },
    { resultado: { ...recibo('teste').resultado, executados: ['positivo', 'positivo'] } },
    { resultado: { ...recibo('teste').resultado, aprovados: ['caso-inexistente'] } },
    { resultado: { ...recibo('teste').resultado, skipped: -1 } },
  ]) assert.throws(() => validarReciboCapacidade({ ...recibo('teste'), ...patch }), ContratoPlaybookInvalido);
  assert.throws(() => avaliarCapacidades({ ...matriz(), schemaVersion: 2 }, contexto(), [], fontes().resolver), ContratoPlaybookInvalido);
  assert.throws(() => avaliarCapacidades({ ...matriz(), capacidades: [...matriz().capacidades, ...matriz().capacidades] }, contexto(), [], fontes().resolver), /nome repetido/);
  assert.throws(() => avaliarCapacidades(matriz(), contexto(), ['claims-schema', 'claims-schema'], fontes().resolver), /nome repetido/);
});

function fase(): ResultadoFasePlaybook {
  return {
    schemaVersion: 1, fase: 'GO', slug: 'ork-fixture-full', sessionId: 'sessao-Ork', dispatchId: 'dispatch-Ork',
    estado: 'concluida', reciboId: 'recibo-terminal-externo',
    resultado: { produtoHomologado: false, GOIntegralConcluido: false, checkpoint: 'docs/checkpoint-go-T01-retomada2.md' },
  };
}
test('envelope terminal conclui sessao sem implicar homologacao nem GO integral', () => {
  const r = validarResultadoFasePlaybook(fase(), fase());
  assert.equal(r.estado, 'concluida');
  assert.equal(r.resultado.produtoHomologado, false);
  assert.equal(r.resultado.GOIntegralConcluido, false);
  assert.throws(() => validarContratoPlaybook(r, claimsSchema), ContratoPlaybookInvalido);
});
test('fase rejeita identidade divergente, ausencia de terminal no topo e extras', () => {
  for (const k of ['fase', 'slug', 'sessionId', 'dispatchId'] as const) {
    const r = { ...fase(), [k]: k === 'fase' ? 'CHECK' : 'outra' };
    assert.throws(() => validarResultadoFasePlaybook(r, fase()), /despacho divergente/);
  }
  const { estado: _estado, ...semEstado } = fase();
  for (const r of [semEstado, { ...fase(), exitCode: 0 }, { ...fase(), schemaVersion: 2 }, { ...fase(), resultado: { ...fase().resultado, gate: 'pass' } }]) {
    assert.throws(() => validarResultadoFasePlaybook(r, fase()), ContratoPlaybookInvalido);
  }
});

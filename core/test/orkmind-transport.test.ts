import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DriverCliOrkMind, violacoesDeGovernanca } from '../src/orkmind';
import { ConsultaDelimitada, EntradaNova } from '../src/types';
import { spawnSync } from 'node:child_process';
import { pythonFixture } from './native-fixture';

const sentinel = 'transport-test-secret';
function fixture(body: string, timeoutMs = 3000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-transport-'));
  const runner = path.join(dir, 'python');
  fs.writeFileSync(runner, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  return { driver: new DriverCliOrkMind({ cli, dsn: sentinel, variavel: 'TEST_TENANT', timeoutMs }),
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const entry: EntradaNova = { collection: 'decision', content: 'Decisao do evento humano original',
  tags: { project: ['orkastery'], situation: ['human_gate'] }, priority: 'high', source: 'human',
  metadata: { proveniencia: { tipo: 'human_gate', source: 'human', confirmado: true,
    autor: 'Julio', evento: 'ledger.jsonl#evento:24', evidencia: 'prompt.md', sha256: 'a'.repeat(64) } } };

test('stdin preserva metadata/source e segredo existe somente no ambiente do filho', () => {
  const f = fixture(`const fs=require('fs'),assert=require('assert/strict');
    const q=JSON.parse(fs.readFileSync(0,'utf8'));
    assert.equal(process.env.ORKMIND_DATABASE_URL, ${JSON.stringify(sentinel)});
    assert.ok(!process.argv.join(' ').includes(process.env.ORKMIND_DATABASE_URL));
    assert.deepEqual(q.entrada, ${JSON.stringify(entry)});
    console.log(JSON.stringify({ok:true,id:'real-id',duplicada:false,collection:q.entrada.collection,detalhe:'created'}));`);
  try { assert.equal(f.driver.adicionar(entry).id, 'real-id'); } finally { f.limpar(); }
});

test('exportacao preserva campos e cadeia; colecao incorreta reprova', () => {
  const f = fixture(`const q=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(JSON.stringify([{...${JSON.stringify(entry)},id:'read-id',collection:'decision',
      created_at:'2026-09-07',parent_id:'session-id',author_id:'Julio',mandatory:false}]));`);
  try {
    const e = f.driver.exportar('decision')[0];
    assert.deepEqual(e.metadata, entry.metadata); assert.equal(e.source, 'human');
    assert.equal(e.parent_id, 'session-id'); assert.equal(e.author_id, 'Julio');
    assert.throws(() => f.driver.exportar('handoff'), /memory.transport.entry/);
  } finally { f.limpar(); }
});

for (const [label, body, pattern] of [
  ['falha de exportacao', 'process.exit(7)', /memory.transport.failed/],
  ['colisao legada tipada', `console.log(JSON.stringify({error:'memory.legacy.provenance-collision'}));process.exit(1)`, /memory.legacy.provenance-collision/],
  ['marcador adulterado tipado', `console.log(JSON.stringify({error:'memory.prospective.marker-invalid'}));process.exit(1)`, /memory.prospective.marker-invalid/],
  ['schema ausente declarado', `console.log(JSON.stringify({error:'memory.schema.absent'}));process.exit(1)`, /memory.schema.absent/],
  ['JSON invalido', `console.log('nao JSON')`, /memory.transport.json/],
  ['colecao malformada', `console.log('{}')`, /memory.transport.export/],
  ['segredo em erro', `console.error(process.env.ORKMIND_DATABASE_URL);process.exit(1)`, /memory.transport.failed/],
  ['segredo em resposta valida', `console.log(JSON.stringify({secret:process.env.ORKMIND_DATABASE_URL}))`, /memory.transport.secret/],
] as const) {
  test(`${label} nunca vira colecao vazia nem revela segredo`, () => {
    const f = fixture(body);
    try {
      assert.throws(() => f.driver.exportar('decision'), e => e instanceof Error && pattern.test(e.message) && !e.message.includes(sentinel));
      const result = f.driver.adicionar(entry);
      assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes(sentinel));
    } finally { f.limpar(); }
  });
}

test('timeout e executavel ausente produzem motivos tipados sem conteudo do filho', () => {
  const f = fixture('setTimeout(()=>{},10000)', 50);
  try { assert.throws(() => f.driver.exportar('decision'), /memory.transport.timeout/); } finally { f.limpar(); }
  const d = new DriverCliOrkMind({ cli: '/nao-existe/orkmind', dsn: sentinel, variavel: 'TEST', timeoutMs: 50 });
  assert.match(d.disponivel().detalhe, /cli.ausente/);
});

test('governanca exige human_gate confirmado e recusa elevacao', () => {
  assert.deepEqual(violacoesDeGovernanca(entry), []);
  for (const invalid of [
    { ...entry, collection: 'rule' as const }, { ...entry, priority: 'critical' as const },
    { ...entry, metadata: {} }, { ...entry, mandatory: true },
    { ...entry, metadata: { proveniencia: { ...entry.metadata.proveniencia as object, confirmado: false } } },
  ]) assert.ok(violacoesDeGovernanca(invalid).length);
});

test('ponte distribuida no pacote nao instancia embedder ou provider', () => {
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(manifest.files.includes('assets/'));
  const source = fs.readFileSync(path.join(root, 'assets/orkmind_bridge.py'), 'utf8');
  assert.match(source, /submeter_handoff/); assert.match(source, /refacao=0/);
  assert.match(source, /embedder=None/); assert.doesNotMatch(source, /create_embedder\(|MAX_REFACOES/);
});


const consultaRestrita: ConsultaDelimitada = { collection: 'handoff',
  escopo: { tenant: 'fabrica', thread: 'ork-teste' }, tags: { skill: ['GOAL', 'PLAN'] }, limite: 10 };
const respostaRestrita = { id: 'scoped', collection: 'handoff', content: 'Contexto proprio',
  tags: { project: ['fabrica'], situation: ['thread:ork-teste'], skill: ['PLAN'] },
  source: 'agent', metadata: { prova: 'preservada' }, visibility: 'private' };

test('query transporta somente fronteiras, preserva campos e filtra OR/mandatory localmente', () => {
  const f = fixture(`const assert=require('assert/strict'),q=JSON.parse(require('fs').readFileSync(0,'utf8'));
    assert.deepEqual(q,{op:'query',collection:'handoff',tags:{project:['fabrica'],situation:['thread:ork-teste']},limit:10});
    console.log(JSON.stringify([${JSON.stringify(respostaRestrita)},
      {...${JSON.stringify(respostaRestrita)},id:'mandatory',mandatory:true,tags:{project:['fabrica'],situation:['thread:ork-teste'],skill:['SHIP']}},
      {...${JSON.stringify(respostaRestrita)},id:'fora-filtro',tags:{project:['fabrica'],situation:['thread:ork-teste'],skill:['SHIP']}}]));`);
  try {
    f.driver.exportar = () => { throw Error('export proibido'); };
    f.driver.recuperar = () => { throw Error('retrieve proibido'); };
    const es = f.driver.consultar(consultaRestrita);
    assert.deepEqual(es.map(e => e.id), ['mandatory', 'scoped']);
    assert.deepEqual(es[1].metadata, { prova: 'preservada' });
    assert.equal(es[1].visibility, 'private');
  } finally { f.limpar(); }
});

for (const [label, response, pattern] of [
  ['outro tenant', [{...respostaRestrita,tags:{project:['alheio'],situation:['thread:ork-teste']}}], /memory.query.scope-violation/],
  ['outra thread', [{...respostaRestrita,tags:{project:['fabrica'],situation:['thread:alheia']}}], /memory.query.scope-violation/],
  ['outra colecao', [{...respostaRestrita,collection:'decision'}], /memory.query.scope-violation/],
  ['item invalido', [null], /memory.query.response-invalid/],
  ['envelope invalido', {}, /memory.query.response-invalid/],
  ['pagina cheia antes do filtro', Array(10).fill({...respostaRestrita,tags:{}}), /memory.query.window-saturated/],
] as const) {
  test(`query recusa ${label} sem fallback amplo`, () => {
    const f = fixture(`console.log(${JSON.stringify(JSON.stringify(response))});`);
    try { assert.throws(() => f.driver.consultar(consultaRestrita), pattern); } finally { f.limpar(); }
  });
}

test('query valida pedido antes de resolver executavel e preserva erros tipados da ponte', () => {
  const ausente = new DriverCliOrkMind({cli:'/nao-existe',dsn:sentinel,variavel:'TEST',timeoutMs:50});
  assert.throws(() => ausente.consultar({...consultaRestrita,limite:0}), /memory.query.invalid/);
  assert.throws(() => ausente.consultar({...consultaRestrita,tags:{project:['alheio']}}), /memory.query.scope-conflict/);
  for (const code of ['memory.query.invalid','memory.query.window-saturated','memory.query.scope-violation']) {
    const f = fixture(`console.log(JSON.stringify({error:${JSON.stringify(code)}}));process.exit(1);`);
    try { assert.throws(() => f.driver.consultar(consultaRestrita), e => e instanceof Error && e.message === code); }
    finally { f.limpar(); }
  }
});

test('ponte Python executa uma consulta governada delimitada e recusa invalidos antes de I/O', () => {
  const source = path.resolve(__dirname, '../../assets/orkmind_bridge.py');
  const py = String.raw`
import asyncio, importlib.util, sys
from orkmind.core.models import MemoryEntry
spec=importlib.util.spec_from_file_location('bridge',sys.argv[1]); b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
q={'op':'query','collection':'handoff','tags':{'project':['fabrica'],'situation':['thread:ork-teste']},'limit':3}
entry=MemoryEntry(id='propria',collection='handoff',content='Contexto delimitado',tags=q['tags'],visibility='private')
class Store:
    def __init__(self, entries): self.entries=entries;self.calls=[]
    async def search_by_tags(self,*args,**kwargs): self.calls.append((args,kwargs));return self.entries
async def run():
    store=Store([entry]);out=await b.execute(q,store)
    assert out[0]['id']=='propria' and out[0]['visibility']=='private'
    assert store.calls==[((q['tags'],),{'collection':'handoff','limit':3})],store.calls
    # Nao ha count/retrieve/inner nesse store: qualquer fallback reprovaria.
    for bad in [dict(q,limit=0),dict(q,limit=True),dict(q,limit=1001),dict(q,limit=1.5),dict(q,requester_id='owner'),dict(q,collection='users'),dict(q,tags={}),dict(q,tags={**q['tags'],'skill':['GOAL']}),dict(q,tags={**q['tags'],'project':['fabrica','outra']})]:
        store=Store([])
        try: await b.execute(bad,store);raise AssertionError('pedido invalido aceito')
        except b.QueryError as e: assert e.code=='memory.query.invalid'
        assert not store.calls
    store=Store([entry]*3)
    try: await b.execute(q,store);raise AssertionError('saturacao aceita')
    except b.QueryError as e: assert e.code=='memory.query.window-saturated'
    foreign=entry.model_copy(update={'tags':{'project':['alheio'],'situation':['thread:ork-teste']}})
    try: await b.execute(q,Store([foreign]));raise AssertionError('escopo alheio aceito')
    except b.QueryError as e: assert e.code=='memory.query.scope-violation'
    assert await b.execute(q,Store([]))==[]
asyncio.run(run())
print('ponte query: chamadas, fronteiras, saturacao e validacao comprovadas; store sintetico')
`;
  const r = spawnSync(pythonFixture(), ['-c',py,source], {encoding:'utf8', timeout:10000,
    env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/ponte query:/);
});

import {test,mock} from 'node:test';
import {strict as assert} from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {projetoTemporario} from './apoio';
import {preflight,textoPreflight,SensoresPreflight} from '../src/preflight';
import {editarBloco,lerSetup,configDoBloco,caminhoSetup} from '../src/setup';
import {resolverDespacho} from '../src/phase';
import * as inventario from '../src/sessoes-inventario';

function sensores(disponiveis:string[],sandbox=true) {
  const chamadas:string[]=[];
  const s:SensoresPreflight={runtime:n=>{chamadas.push(n);return disponiveis.includes(n);},sandboxCodex:()=>{chamadas.push('sandbox');return sandbox;}};
  return {s,chamadas};
}
test('preflight Auto segue setup Codex, não consulta Claude/inventário e preserva configuração',()=>{
  const p=projetoTemporario('preflight-codex');
  const inventory=mock.method(inventario,'inventariarSessoes',()=>{throw Error('inventário proibido');});
  try {
    assert.equal(editarBloco(p.dir,'auto',1,{runtime:'codex',model:'gpt-6-astra',effort:'high'}).ok,true);
    const before=fs.readFileSync(caminhoSetup(p.dir)),files=fs.readdirSync(path.join(p.dir,'.orkastery')).sort();
    const sensor=sensores(['codex']);const r=preflight(p.dir,'auto',[],sensor.s);
    assert.deepEqual(r.blocos[0].trio,resolverDespacho(p.carregado.manifesto,{},configDoBloco(lerSetup(p.dir),'auto','GOAL')));
    assert.equal(r.prontoPrimeiroBloco,true);assert.equal(r.prontoTodosBlocos,true);
    assert.deepEqual(sensor.chamadas,['codex','sandbox']);assert.equal(inventory.mock.callCount(),0);
    assert.deepEqual(fs.readFileSync(caminhoSetup(p.dir)),before);assert.deepEqual(fs.readdirSync(path.join(p.dir,'.orkastery')).sort(),files);
    assert.equal(r.entrega.verificada,false);assert.match(textoPreflight(r),/não autoriza despacho/);
  } finally {inventory.mock.restore();p.limpar();}
});
test('preflight diferencia dependência futura Maestro da prontidão do primeiro bloco',()=>{
  const p=projetoTemporario('preflight-mixed');
  try {
    assert.equal(editarBloco(p.dir,'maestro',1,{runtime:'codex',model:'gpt-6-astra'}).ok,true);
    const sensor=sensores(['codex']),r=preflight(p.dir,'maestro',[],sensor.s);
    assert.equal(r.prontoPrimeiroBloco,true);assert.equal(r.prontoTodosBlocos,false);
    assert.equal(r.blocos[1].checks.some(c=>c.nome==='runtime' && c.nivel==='fail'),true);
    assert.deepEqual(sensor.chamadas,['codex','sandbox','claude-bg']);
  } finally {p.limpar();}
});
test('preflight runtime ausente/sandbox falho/modelo pendente bloqueiam sem fallback',()=>{
  const p=projetoTemporario('preflight-negative');
  try {
    editarBloco(p.dir,'auto',1,{runtime:'codex',model:'gpt-6-astra'});
    const absent=sensores([]);assert.equal(preflight(p.dir,'auto',[],absent.s).prontoPrimeiroBloco,false);assert.deepEqual(absent.chamadas,['codex']);
    assert.equal(preflight(p.dir,'auto',[],sensores(['codex'],false).s).prontoPrimeiroBloco,false);
    const setup=JSON.parse(fs.readFileSync(caminhoSetup(p.dir),'utf8'));setup.modos.auto.blocos[0].model='';fs.writeFileSync(caminhoSetup(p.dir),JSON.stringify(setup));
    const before=fs.readFileSync(caminhoSetup(p.dir)),sensor=sensores(['codex']);
    assert.equal(preflight(p.dir,'auto',[],sensor.s).prontoPrimeiroBloco,false);assert.deepEqual(sensor.chamadas,[]);
    assert.deepEqual(fs.readFileSync(caminhoSetup(p.dir)),before);
  } finally {p.limpar();}
});
test('preflight Claude não sonda Codex e não transforma entrega em prontidão comprovada',()=>{
  const p=projetoTemporario('preflight-claude');
  try {
    const sensor=sensores(['claude-bg']),r=preflight(p.dir,'auto',[],sensor.s);
    assert.equal(r.prontoPrimeiroBloco,true);assert.deepEqual(sensor.chamadas,['claude-bg']);
    assert.equal(r.entrega.verificada,false);assert.ok(r.entrega.dependencias.includes('executor Codex isolado'));
    assert.equal(preflight(p.dir,'auto',['ANTHROPIC_API_KEY'],sensor.s).prontoPrimeiroBloco,false);
    const raw=JSON.stringify(preflight(p.dir,'auto',['SECRET_VALUE_NOT_A_NAME'],sensor.s));assert.equal(raw.includes('SECRET_VALUE_NOT_A_NAME'),false);
  } finally {p.limpar();}
});
test('preflight recusa modo desconhecido/proibido e manifesto inválido',()=>{
  const p=projetoTemporario('preflight-mode');
  try {
    assert.throws(()=>preflight(p.dir,'outro' as 'auto',[],sensores([]).s),/mode.invalid/);
    const file=path.join(p.dir,'orkastery.yaml');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/default_mode: \w+/,'default_mode: classic').replace(/allowed_modes: \[.*\]/,'allowed_modes: [classic]'));
    assert.equal(preflight(p.dir,'auto',[],sensores(['claude-bg']).s).prontoPrimeiroBloco,false);
    fs.writeFileSync(path.join(p.dir,'orkastery.yaml'),'project: [broken');
    assert.equal(preflight(p.dir,'auto',[],sensores([]).s).prontoPrimeiroBloco,false);
  } finally {p.limpar();}
});
test('doctor contextual CLI recusa flags inválidas antes de sondar runtime',()=>{
  const p=projetoTemporario('preflight-cli');
  try {
    const cli=path.resolve(__dirname,'../src/index.js');
    for(const args of [['--modo'],['--modo','auto','--modo','classic'],['--modo','auto','--cwd','/tmp']]) {
      const r=spawnSync(process.execPath,[cli,'doctor',...args],{cwd:p.dir,encoding:'utf8',timeout:10000});
      assert.equal(r.status,1);assert.match(r.stderr,/uso: ork doctor/);
    }
    // I-43: o VALOR do modo tem recusa tipada propria, porque a acao do dono e outra.
    // Modo que nunca existiu e typo; modo aposentado pede troca de #TAG.
    const desconhecido=spawnSync(process.execPath,[cli,'doctor','--modo','outro'],{cwd:p.dir,encoding:'utf8',timeout:10000});
    assert.equal(desconhecido.status,1);assert.match(desconhecido.stderr,/modo\.desconhecido/);
    for(const morto of ['look','ork']) {
      const r=spawnSync(process.execPath,[cli,'doctor','--modo',morto],{cwd:p.dir,encoding:'utf8',timeout:10000});
      assert.equal(r.status,1);
      assert.match(r.stderr,/modo\.aposentado/,r.stderr);
      assert.match(r.stderr,/#Classic/,r.stderr);
    }
  } finally {p.limpar();}
});

test('scope-check roteia preflight contextual e distingue bloco inicial, futuros e entrega',()=>{
  const raiz=path.resolve(__dirname,'../../..');
  // Testes compilados vivem core/dist-test/test; fonte também pode ser lida da raiz do checkout.
  const candidatos=[path.join(raiz,'skills/governance/scope-check-capability-map/SKILL.md'),path.join(raiz,'../skills/governance/scope-check-capability-map/SKILL.md')];
  const file=candidatos.find(f=>fs.existsSync(f));assert.ok(file,'skill distribuída no checkout');
  const texto=fs.readFileSync(file!,'utf8');
  assert.match(texto,/Prefira `ork_preflight\(\{modo\}\)`/);
  assert.match(texto,/ork doctor --modo <modo>/);
  assert.match(texto,/prontoPrimeiroBloco/);assert.match(texto,/prontoTodosBlocos/);
  assert.match(texto,/diagnostico amplo opcional, com inventario global/);
  assert.match(texto,/sonda nao comprova\s+autenticacao/);assert.match(texto,/executor Codex isolado/);
  assert.doesNotMatch(texto,/Um `fail` do doctor e a maquina dizendo/);
});

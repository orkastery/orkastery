import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { DriverEmMemoria, entradaDoJson } from '../src/orkmind';
import { ConsultaDelimitada } from '../src/types';
const q: ConsultaDelimitada = { collection:'handoff', escopo:{tenant:'fabrica',thread:'ork-teste'},
  tags:{skill:['GOAL','PLAN']}, limite:100 };
function entrada(id:string, project='fabrica', thread='ork-teste', skill='GOAL', mandatory=false) {
  return entradaDoJson({id,collection:'handoff',content:id,mandatory,
    tags:{project:[project],situation:['thread:'+thread],skill:[skill]}})!;
}
test('duplo seleciona antes do retorno sem export, preservando OR e mandatory no escopo', () => {
  const d = new DriverEmMemoria([entrada('goal'),entrada('plan','fabrica','ork-teste','PLAN'),
    entrada('mandatoria','fabrica','ork-teste','SHIP',true),
    entrada('outra-thread','fabrica','outra','GOAL',true),entrada('outro-tenant','outro'),
    entrada('nao-casa','fabrica','ork-teste','SHIP')]);
  d.exportar = () => { throw Error('export amplo'); };
  assert.deepEqual(d.consultar(q).map(e=>e.id),['mandatoria','goal','plan']);
});
test('janela cheia falha antes do filtro; vazio completo e limite pequeno sao distintos', () => {
  const d = new DriverEmMemoria([entrada('nao-casa','fabrica','ork-teste','SHIP')]);
  assert.throws(()=>d.consultar({...q,limite:1}), /memory.query.window-saturated/);
  assert.deepEqual(d.consultar(q),[]);
  assert.deepEqual(d.consultar({...q,escopo:{tenant:'outro',thread:'ork-teste'}}),[]);
});

function driverComSituacoes() {
  const checkpoint = entrada('checkpoint');
  checkpoint.tags.situation.push('checkpoint');
  const milestone = entrada('milestone','fabrica','ork-teste','PLAN');
  milestone.tags.situation.push('milestone');
  const skillDiferente = entrada('skill-diferente','fabrica','ork-teste','SHIP');
  skillDiferente.tags.situation.push('checkpoint');
  const d = new DriverEmMemoria([checkpoint,milestone,skillDiferente,entrada('sem-situacao'),
    entrada('mandatoria','fabrica','ork-teste','SHIP',true),
    entrada('outra-thread','fabrica','outra','GOAL',true),
    entrada('outro-tenant','outro','ork-teste','GOAL',true)]);
  d.exportar = () => { throw Error('export amplo'); };
  return d;
}
test('situation local seleciona checkpoint sem perder mandatory da propria thread', () => {
  const d = driverComSituacoes();
  assert.deepEqual(d.consultar({...q,tags:{situation:['checkpoint']}}).map(e=>e.id),
    ['mandatoria','checkpoint','skill-diferente']);
});
test('situation aceita OR e combina com skill por AND', () => {
  const d = driverComSituacoes();
  assert.deepEqual(d.consultar({...q,tags:{situation:['checkpoint','milestone'],skill:['GOAL','PLAN']}})
    .map(e=>e.id),['mandatoria','checkpoint','milestone']);
});
test('mandatory interna sobrevive a filtros locais sem correspondencia', () => {
  const d = driverComSituacoes();
  assert.deepEqual(d.consultar({...q,tags:{situation:['inexistente'],skill:['MASTER']}})
    .map(e=>e.id),['mandatoria']);
});
test('dimensoes de tags ausentes e vazias retornam conjunto completo apenas do escopo', () => {
  const d = driverComSituacoes();
  const esperado = ['mandatoria','checkpoint','milestone','sem-situacao','skill-diferente'];
  const filtros: ConsultaDelimitada['tags'][] = [{}, {project:[],situation:[],skill:[]}];
  for (const tags of filtros) {
    assert.deepEqual(d.consultar({...q,tags}).map(e=>e.id),esperado);
  }
});

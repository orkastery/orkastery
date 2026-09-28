import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';
import { exportarHandoff } from '../src/handoff';

const dist = path.resolve(__dirname, '../../dist');
// Executa o CLI compilado em processo isolado, substituindo apenas o driver por fixture.
function executar(dir: string, args: string[], fixture = false) {
  const script = `
    const fs = require('fs'), memoria = require(${JSON.stringify(path.join(dist, 'memoria'))});
    const log = 'consultas-fixture.jsonl';
    const abrir = memoria.abrirMemoria;
    const { DriverEmMemoria, entradaDoJson } = require(${JSON.stringify(path.join(dist, 'orkmind'))});
    memoria.abrirMemoria = (carregado, opcoes) => {
      fs.appendFileSync(log, JSON.stringify({abertura:opcoes ?? null})+'\\n');
      const driver = new DriverEmMemoria();
      const tenant = carregado.manifesto.memory.tenant || carregado.manifesto.project.name;
      for (const id of ['um','dois']) driver.semear(entradaDoJson({id, collection:'decision', content:id,
        tags:{project:[tenant], situation:['thread:ork-consulta']}}));
      const consultar = driver.consultar.bind(driver);
      driver.consultar = q => { fs.appendFileSync(log, JSON.stringify({consulta:q})+'\\n'); return consultar(q); };
      driver.exportar = () => { throw Error('EXPORT_AMPLO'); };
      return abrir(carregado, {...opcoes, driver});
    };
    try { process.exitCode = require(${JSON.stringify(path.join(dist, 'index'))}).main(process.argv.slice(1)); }
    catch (e) { console.error(e.message); process.exitCode=1; }
  `;
  return spawnSync(process.execPath, fixture ? ['-e', script, ...args] : [path.join(dist, 'index.js'), ...args],
    { cwd: dir, encoding: 'utf8', env: { HOME: dir, PATH: process.env.PATH, LANG: 'C.UTF-8' } });
}

function ligar(dir: string): void {
  const arquivo = path.join(dir, 'orkastery.yaml');
  fs.writeFileSync(arquivo, fs.readFileSync(arquivo, 'utf8').replace(/^  mode: files$/m, '  mode: orkmind')
    .replace(/^  database_url_env: ""$/m, '  database_url_env: "FIXTURE_DSN"'));
}

test('CLI recusa consultas restritas inválidas antes de abrir memória', () => {
  const p = projetoTemporario('cli-restrito-invalidos');
  try {
    ligar(p.dir);
    for (const extras of [ ['--restrito'], ['--thread'], ['--janela','10'],
      ['--thread','../fora','--colecao','decision'], ['--thread','ork-consulta'],
      ['--thread','ork-consulta','--colecao','decision','--janela','0'],
      ['--thread','ork-consulta','--colecao','decision','--limite'],
      ['--thread','ork-consulta','--colecao','decision','--tags','{"project":["alheio"]}'],
    ]) {
      const r = executar(p.dir, ['memory','search','--tags','{}',...extras], true);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /memory.query./);
      assert.equal(fs.existsSync(path.join(p.dir, 'consultas-fixture.jsonl')), false);
    }
  } finally { p.limpar(); }
});

test('CLI separa janela da origem do limite de apresentação, sem export amplo', () => {
  const p = projetoTemporario('cli-restrito-janela');
  try {
    ligar(p.dir);
    const args = ['memory','search','--thread','ork-consulta','--colecao','decision','--tags','{}','--json','--limite','1'];
    const cheia = executar(p.dir, [...args,'--janela','2'], true);
    assert.equal(cheia.status, 1);
    assert.match(cheia.stderr, /memory.query.window-saturated/);
    const completa = executar(p.dir, [...args,'--janela','3'], true);
    assert.equal(completa.status, 0, completa.stderr);
    assert.equal(JSON.parse(completa.stdout).length, 1);
    const eventos = fs.readFileSync(path.join(p.dir, 'consultas-fixture.jsonl'), 'utf8');
    assert.match(eventos, /"limite":3/);
    assert.ok(!eventos.includes('EXPORT_AMPLO'));
  } finally { p.limpar(); }
});

test('CLI recall abre contexto da própria thread e files declara seu regime', () => {
  const p = projetoTemporario('cli-recall-restrito');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'recall cli', modo: 'classic' });
    exportarHandoff(p.carregado, thread.id, { proximaFase: 'CHECK' });
    const files = executar(p.dir, ['recall',thread.id,'--fase','CHECK','--json']);
    assert.equal(files.status, 0, files.stderr);
    assert.equal(JSON.parse(files.stdout).regime, 'files');
    const buscaFiles = executar(p.dir, ['memory','search','--thread',thread.id,'--colecao','decision','--tags','{}','--json']);
    assert.equal(buscaFiles.status, 0);
    assert.match(buscaFiles.stderr, /memory.query.files/);
    ligar(p.dir);
    const ativo = executar(p.dir, ['recall',thread.id,'--fase','CHECK','--janela','7','--json'], true);
    assert.equal(ativo.status, 0, ativo.stderr);
    const log = fs.readFileSync(path.join(p.dir, 'consultas-fixture.jsonl'), 'utf8');
    assert.ok(log.includes(JSON.stringify({leituraRestrita:{thread:thread.id,limite:7}})));
    assert.ok(log.includes('"collection":"handoff"'));
  } finally { p.limpar(); }
});

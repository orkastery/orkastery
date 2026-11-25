import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { adquirirTravaPortatil, comTravaPortatil, donosDaTravaPortatil, identidadeDoProcesso } from '../src/trava-portatil';

function fixture(): { dir: string; alvo: string; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-trava-portatil-'));
  return { dir, alvo: path.join(dir, 'recurso'), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('trava portátil exclui concorrente vivo e o prazo não rouba propriedade', () => {
  const f = fixture();
  try {
    const primeira = adquirirTravaPortatil(f.alvo, 'primeira');
    assert.ok(primeira);
    const inicio = Date.now();
    assert.equal(adquirirTravaPortatil(f.alvo, 'concorrente', { esperarMs: 30 }), null);
    assert.ok(Date.now() - inicio >= 20);
    assert.deepEqual(donosDaTravaPortatil(f.alvo).map((d) => d.operacao), ['primeira']);
    primeira.liberar();
    const depois = adquirirTravaPortatil(f.alvo, 'depois', { esperarMs: 0 });
    assert.ok(depois); depois.liberar();
  } finally { f.limpar(); }
});

test('processo morto perde apenas o próprio candidato e a aquisição seguinte continua', () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const filho = spawnSync(process.execPath, ['-e',
      `require(process.argv[1]).adquirirTravaPortatil(process.argv[2],'filho');process.exit(19)`, modulo, f.alvo],
    { encoding: 'utf8', timeout: 5000 });
    assert.equal(filho.status, 19, filho.stderr);
    const trava = adquirirTravaPortatil(f.alvo, 'recuperada', { esperarMs: 2000 });
    assert.ok(trava); trava.liberar();
    assert.deepEqual(donosDaTravaPortatil(f.alvo), []);
  } finally { f.limpar(); }
});

test('dois processos não ocupam a região crítica ao mesmo tempo', async () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const registro = path.join(f.dir, 'regiao.log');
    const script = [
      `const fs=require('node:fs');`,
      `const t=require(process.argv[1]);`,
      `t.comTravaPortatil(process.argv[2],process.argv[3],()=>{`,
      `fs.appendFileSync(process.argv[4],process.argv[3]+':entra\\n');`,
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);`,
      `fs.appendFileSync(process.argv[4],process.argv[3]+':sai\\n');`,
      `},{esperarMs:3000});`,
    ].join('');
    const rodar = (nome: string) => spawn(process.execPath, ['-e', script, modulo, f.alvo, nome, registro], { stdio: 'pipe' });
    const a = rodar('a'), b = rodar('b');
    const aguardar = (p: ReturnType<typeof spawn>) => new Promise<number | null>((resolve, reject) => {
      let erro = ''; p.stderr?.on('data', (d) => { erro += d; });
      p.on('error', reject); p.on('close', (code) => code === 0 ? resolve(code) : reject(Error(erro)));
    });
    await Promise.all([aguardar(a), aguardar(b)]);
    const linhas = fs.readFileSync(registro, 'utf8').trim().split('\n');
    assert.ok(linhas.join(',') === 'a:entra,a:sai,b:entra,b:sai' || linhas.join(',') === 'b:entra,b:sai,a:entra,a:sai', linhas.join(','));
  } finally { f.limpar(); }
});

test('caminho darwin fixa fuso e locale ao comparar a identidade do dono', () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const filho = [
      `Object.defineProperty(process,'platform',{value:'darwin'});`,
      `const fs=require('node:fs'),t=require(process.argv[1]);`,
      `const x=t.adquirirTravaPortatil(process.argv[2],process.argv[3],{esperarMs:Number(process.argv[4])});`,
      `if(process.argv[3]==='dono'){if(!x)process.exit(2);fs.writeFileSync(1,'pronto\\n');`,
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);x.liberar();}`,
      `else{fs.writeFileSync(1,JSON.stringify({adquiriu:!!x}));if(x)x.liberar();}`,
    ].join('');
    const coordenador = [
      `const cp=require('node:child_process');const [filho,modulo,alvo]=process.argv.slice(1);`,
      `const rodar=(papel,prazo,env)=>{const p=cp.spawn(process.execPath,['-e',filho,modulo,alvo,papel,prazo],`,
      `{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let out='',err='';`,
      `p.stdout.on('data',d=>{out+=d});p.stderr.on('data',d=>{err+=d});`,
      `return {p,feito:new Promise((resolve,reject)=>p.on('close',code=>code===0?resolve(out):reject(Error(err))))};};`,
      `const a=rodar('dono','1000',{TZ:'UTC0',LC_ALL:'C'});`,
      `a.p.stdout.once('data',()=>{const b=rodar('concorrente','120',{TZ:'America/Sao_Paulo',LC_ALL:'POSIX'});`,
      `Promise.all([a.feito,b.feito]).then(([,saida])=>require('node:fs').writeFileSync(1,saida)).catch(e=>{console.error(e);process.exitCode=1;});});`,
    ].join('');
    const r = spawnSync(process.execPath, ['-e', coordenador, filho, modulo, f.alvo], { encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { adquiriu: false });
  } finally { f.limpar(); }
});

test('saída 1 do ps sem stdout não prova a morte de um processo vivo', () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const script = [
      `Object.defineProperty(process,'platform',{value:'darwin'});`,
      `const cp=require('node:child_process');`,
      `cp.spawnSync=()=>({status:1,stdout:'',stderr:'falha',error:undefined});`,
      `const r=require(process.argv[1]).identidadeDoProcesso(process.pid);`,
      `require('node:fs').writeFileSync(1,String(r===undefined));`,
    ].join('');
    const r = spawnSync(process.execPath, ['-e', script, modulo], { encoding: 'utf8', timeout: 3000 });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'true');
  } finally { f.limpar(); }
});

test('rename do candidato durante a leitura conserva o dono com menor token', () => {
  const f = fixture();
  try {
    const dir = `${f.alvo}.ork-lock`;
    const token = '00000000-0000-4000-8000-000000000001';
    const arquivo = path.join(dir, `${token}.json`);
    const identidade = identidadeDoProcesso(process.pid);
    assert.ok(identidade);
    const candidato = (ticket: number) => JSON.stringify({ contrato: 'ork.trava-portatil/v1', token,
      pid: process.pid, uid: process.getuid?.() ?? null, identidade, ticket, operacao: 'B', criadoEm: new Date().toISOString() });
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(arquivo, candidato(0), { mode: 0o600 });
    const proximo = path.join(dir, '.b1.tmp');
    fs.writeFileSync(proximo, candidato(1), { mode: 0o600 });
    const abrir = fs.openSync;
    let leituras = 0, trocou = false;
    const fsMutavel = require('node:fs') as { openSync: (...args: unknown[]) => number };
    fsMutavel.openSync = (...args) => {
      const fd = Reflect.apply(abrir, fsMutavel, args) as number;
      if (args[0] === arquivo && ++leituras === 4 && !trocou) { fs.renameSync(proximo, arquivo); trocou = true; }
      return fd;
    };
    try { assert.equal(adquirirTravaPortatil(f.alvo, 'A', { esperarMs: 0 }), null); }
    finally { fsMutavel.openSync = abrir as unknown as (...args: unknown[]) => number; }
    assert.equal(trocou, true);
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).ticket, 1);
  } finally { f.limpar(); }
});

test('contenção entre dois processos não vira trava.portatil.insegura', async () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const marca = path.join(f.dir, 'dentro');
    const script = [
      `const fs=require('node:fs'),t=require(process.argv[1]);let ok=0,violacoes=0;const erros=[];`,
      `for(let i=0;i<100;i++){try{t.comTravaPortatil(process.argv[2],'estresse',()=>{let fd;`,
      `try{fd=fs.openSync(process.argv[3],'wx');}catch(e){if(e.code==='EEXIST')violacoes++;else throw e;}`,
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1);`,
      `if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(process.argv[3]);}},{esperarMs:5000});ok++;}`,
      `catch(e){erros.push(String(e.message));}}fs.writeFileSync(1,JSON.stringify({ok,violacoes,erros}));`,
    ].join('');
    const rodar = () => spawn(process.execPath, ['-e', script, modulo, f.alvo, marca], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ler = (p: ReturnType<typeof spawn>) => new Promise<{ ok: number; violacoes: number; erros: string[] }>((resolve, reject) => {
      let out = '', err = ''; p.stdout!.on('data', (d) => { out += d; }); p.stderr!.on('data', (d) => { err += d; });
      p.once('error', reject); p.once('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(Error(err)));
    });
    const resultados = await Promise.all([ler(rodar()), ler(rodar())]);
    for (const r of resultados) {
      assert.equal(r.ok, 100); assert.equal(r.violacoes, 0);
      assert.equal(r.erros.some((e) => e.includes('trava.portatil.insegura')), false, r.erros.join('\n'));
    }
  } finally { f.limpar(); }
});

test('identidade desconhecida conserva candidato; identidade divergente permite limpeza', () => {
  const f = fixture();
  try {
    const identidades = new Map<number, string | null | undefined>([[process.pid, 'self']]);
    const primeira = adquirirTravaPortatil(f.alvo, 'primeira', { identidadeDoProcesso: (pid) => identidades.get(pid) });
    assert.ok(primeira);
    identidades.set(process.pid, undefined);
    assert.throws(() => adquirirTravaPortatil(f.alvo, 'sem-identidade', { identidadeDoProcesso: (pid) => identidades.get(pid) }), /indisponivel/);
    identidades.set(process.pid, 'self');
    primeira.liberar();
    comTravaPortatil(f.alvo, 'final', () => assert.equal(donosDaTravaPortatil(f.alvo, () => 'self').length, 1),
      { identidadeDoProcesso: () => 'self' });
  } finally { f.limpar(); }
});

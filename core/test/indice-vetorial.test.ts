/**
 * I-38 (T3, C15): indice vetorial local, idempotente e com teto de tokens antes da rede.
 *
 * Tudo roda em diretorio temporario com o dublê de memoria: nada de base real, rede ou modelo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { DriverEmMemoria } from '../src/orkmind';
import {
  arquivoDoIndice, codigoDeEmbedding, dimDoModeloLocal, impressaoDaBase, indexar, lerIndice, OpcoesDoIndice,
  PRECO_USD_POR_TOKEN, universoDaBusca,
} from '../src/indice-vetorial';
import { ColecaoDoOrk, ConfigDeEmbedding, EntradaDeMemoria } from '../src/types';

const DSN = 'postgresql://leitor:senha-de-teste@db.local:5432/memoria';
const CONFIG: ConfigDeEmbedding = { provider: 'openrouter', model: 'qwen/qwen3-embedding-8b', dim: 64,
  api_key_env: 'TESTE_EMBEDDING_KEY', fallback_model: '', max_tokens_por_execucao: 1_000_000 };

function entrada(id: string, collection: ColecaoDoOrk, content: string, project = 'fabrica'): EntradaDeMemoria {
  return { id, collection, content, tags: { project: [project] }, priority: 'medium', mandatory: false,
    scope: 'project', source: 'agent', metadata: {}, criadaEm: '2026-09-29T00:00:00Z' };
}

function cenario(entradas: EntradaDeMemoria[]) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-indice-'));
  const driver = new DriverEmMemoria(entradas);
  const opcoes = (extra: Partial<OpcoesDoIndice> = {}): OpcoesDoIndice => ({ raiz, tenant: 'fabrica', dsn: DSN,
    config: CONFIG, alvo: 'primario', universo: universoDaBusca(driver, 'fabrica').entradas, dryRun: false,
    chavePresente: true, embeddar: p => driver.embeddar(p), ...extra });
  return { raiz, driver, opcoes, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

const BASICO = () => [
  entrada('d1', 'decision', 'Rotacao de conta quando a cota da assinatura acaba'),
  entrada('r1', 'rule', 'Nenhuma chave paga vai para o prompt do agente'),
  entrada('l1', 'learning', 'O recall por tag monta o mesmo prompt em duas execucoes'),
];

test('indexacao idempotente do indice vetorial: a segunda execucao nao embeda nem reescreve vetor', () => {
  const c = cenario(BASICO());
  try {
    const primeira = indexar(c.opcoes());
    assert.equal(primeira.motivo, null);
    assert.equal(primeira.embedados, 3);
    assert.equal(primeira.chamadasAoProvider, 1);
    const arquivo = arquivoDoIndice(c.raiz, 'fabrica', CONFIG.model, CONFIG.dim);
    const bytes = fs.readFileSync(arquivo, 'utf8');
    const mtime = fs.statSync(arquivo).mtimeMs;
    const segunda = indexar(c.opcoes());
    assert.equal(segunda.embedados, 0);
    assert.equal(segunda.reescritos, 0);
    assert.equal(segunda.chamadasAoProvider, 0);
    assert.equal(segunda.coerentes, 3);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), bytes, 'o arquivo fica identico');
    assert.equal(fs.statSync(arquivo).mtimeMs, mtime, 'sem escrita quando nada mudou');
    assert.equal(c.driver.pedidosDeEmbedding.length, 1);
  } finally { c.limpar(); }
});

test('orcamento estourado recusa a execucao antes de chamar o provider', () => {
  const c = cenario(BASICO());
  try {
    const r = indexar(c.opcoes({ config: { ...CONFIG, max_tokens_por_execucao: 5 } }));
    assert.equal(r.motivo, 'embeddings.orcamento-excedido');
    assert.equal(r.chamadasAoProvider, 0);
    assert.ok(r.tokensEstimados > 5);
    assert.equal(c.driver.pedidosDeEmbedding.length, 0);
    assert.ok(!fs.existsSync(arquivoDoIndice(c.raiz, 'fabrica', CONFIG.model, CONFIG.dim)));
  } finally { c.limpar(); }
});

test('entrada de outro tenant nunca chega ao embed', () => {
  const alheia = entrada('x1', 'decision', 'Segredo comercial de outro produto', 'outro-produto');
  const c = cenario([...BASICO(), alheia]);
  try {
    // Mesmo que o chamador entregue a entrada alheia no universo, o indexador filtra de novo.
    const r = indexar(c.opcoes({ universo: [...universoDaBusca(c.driver, 'fabrica').entradas, alheia] }));
    assert.equal(r.universo, 3);
    const enviados = c.driver.pedidosDeEmbedding.flatMap(p => p.textos);
    assert.ok(!enviados.some(t => t.includes('outro produto')));
    assert.ok(!universoDaBusca(c.driver, 'fabrica').entradas.some(e => e.id === 'x1'));
  } finally { c.limpar(); }
});

test('conteudo alterado reembeda so aquela entrada e entrada removida sai do indice', () => {
  const c = cenario(BASICO());
  try {
    indexar(c.opcoes());
    const mudou = [entrada('d1', 'decision', 'Rotacao de conta: texto revisado'), BASICO()[1]];
    const r = indexar(c.opcoes({ universo: mudou }));
    assert.equal(r.embedados, 1);
    assert.equal(r.reescritos, 1);
    assert.equal(r.removidos, 1);
    assert.deepEqual(c.driver.pedidosDeEmbedding.at(-1)!.textos, ['Rotacao de conta: texto revisado']);
    const { indice } = lerIndice(arquivoDoIndice(c.raiz, 'fabrica', CONFIG.model, CONFIG.dim),
      { tenant: 'fabrica', base: impressaoDaBase(DSN), modelo: CONFIG.model, dim: CONFIG.dim });
    assert.deepEqual(Object.keys(indice.entradas).sort(), ['d1', 'r1']);
  } finally { c.limpar(); }
});

test('arquivo de outro modelo, dimensao ou base nunca e misturado', () => {
  const c = cenario(BASICO());
  try {
    indexar(c.opcoes());
    const outraDim = indexar(c.opcoes({ config: { ...CONFIG, dim: 32 } }));
    assert.equal(outraDim.embedados, 3, 'outra dimensao comeca do zero, em outro arquivo');
    assert.notEqual(outraDim.arquivo, indexar(c.opcoes({ dryRun: true })).arquivo);
    const outraBase = indexar(c.opcoes({ dsn: 'postgresql://leitor:x@outra.local:5432/memoria' }));
    assert.equal(outraBase.embedados, 3, 'indice de outra base e reconstruido, nunca reaproveitado');
    const arquivo = arquivoDoIndice(c.raiz, 'fabrica', CONFIG.model, CONFIG.dim);
    const alterado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    alterado.modelo = 'org/outro-modelo';
    fs.writeFileSync(arquivo, JSON.stringify(alterado));
    const lido = lerIndice(arquivo, { tenant: 'fabrica', base: impressaoDaBase('postgresql://leitor:x@outra.local:5432/memoria'),
      modelo: CONFIG.model, dim: CONFIG.dim });
    assert.equal(lido.outroEspaco, true);
    assert.deepEqual(lido.indice.entradas, {});
  } finally { c.limpar(); }
});

test('dry-run estima tokens e custo em dolar sem chave e sem chamada', () => {
  const c = cenario(BASICO());
  try {
    const r = indexar(c.opcoes({ dryRun: true, chavePresente: false }));
    assert.equal(r.motivo, null);
    assert.equal(r.chamadasAoProvider, 0);
    assert.ok(r.tokensEstimados > 0);
    const caracteres = BASICO().reduce((t, e) => t + Math.ceil(e.content.length / 3), 0);
    assert.equal(r.tokensEstimados, caracteres);
    assert.equal(r.custoEstimadoUsd, caracteres * PRECO_USD_POR_TOKEN['qwen/qwen3-embedding-8b']);
    assert.equal(c.driver.pedidosDeEmbedding.length, 0);
    assert.ok(!fs.existsSync(arquivoDoIndice(c.raiz, 'fabrica', CONFIG.model, CONFIG.dim)));
  } finally { c.limpar(); }
});

test('sem chave o primario recusa com motivo tipado e zero chamadas', () => {
  const c = cenario(BASICO());
  try {
    const r = indexar(c.opcoes({ chavePresente: false }));
    assert.equal(r.motivo, 'embeddings.chave-ausente');
    assert.equal(r.chamadasAoProvider, 0);
    const recusada = indexar(c.opcoes({ chavePresente: false, chaveRecusada: true }));
    assert.equal(recusada.motivo, 'embeddings.chave-ausente');
    assert.match(recusada.detalhe, /valor recusado/);
    assert.doesNotMatch(r.detalhe, /valor recusado/);
    const nenhum = indexar(c.opcoes({ config: { ...CONFIG, provider: 'none' } }));
    assert.equal(nenhum.motivo, 'embeddings.nao-configurado');
    assert.equal(nenhum.custoEstimadoUsd, 0);
  } finally { c.limpar(); }
});

test('padrao de segredo e entrada acima do limite ficam fora do provider', () => {
  const chave = ['sk', 'ant', 'a'.repeat(24)].join('-');
  const c = cenario([...BASICO(), entrada('s1', 'handoff', `contexto com ${chave}`),
    entrada('g1', 'handoff', 'y'.repeat(24_001))]);
  try {
    const r = indexar(c.opcoes());
    assert.equal(r.recusados, 1);
    assert.equal(r.foraDoLimite, 1);
    assert.equal(r.embedados, 3);
    assert.ok(!c.driver.pedidosDeEmbedding.flatMap(p => p.textos).some(t => t.includes(chave) || t.length > 24_000));
  } finally { c.limpar(); }
});

test('falha no meio preserva os lotes concluidos e declara o motivo', () => {
  const muitas = Array.from({ length: 20 }, (_, i) => entrada(`e${String(i).padStart(2, '0')}`, 'learning', `licao numero ${i} da fabrica`));
  const c = cenario(muitas);
  try {
    let chamadas = 0;
    const r = indexar(c.opcoes({ embeddar: p => { if (++chamadas === 2) throw new Error('embeddings.timeout'); return c.driver.embeddar(p); } }));
    assert.equal(r.motivo, 'embeddings.timeout');
    assert.equal(r.embedados, 16);
    assert.equal(r.coerentes, 16);
    const retomada = indexar(c.opcoes());
    assert.equal(retomada.embedados, 4, 'a retomada embeda so o que faltou');
  } finally { c.limpar(); }
});

test('indice fica em .orkastery/memoria/vetores, pasta 0700 e arquivo 0600', () => {
  const c = cenario(BASICO());
  try {
    const r = indexar(c.opcoes());
    assert.equal(r.arquivo, '.orkastery/memoria/vetores/fabrica/qwen__qwen3-embedding-8b-64.json');
    const arquivo = path.join(c.raiz, r.arquivo!);
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(arquivo)).mode & 0o777, 0o700);
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    assert.ok(!conteudo.includes('senha-de-teste') && !conteudo.includes('Rotacao de conta'),
      'o indice guarda impressao da base e sha256, nunca credencial nem texto');
  } finally { c.limpar(); }
});

test('fallback le a dimensao nativa do cache local e responde local-ausente sem ele', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-hf-'));
  const c = cenario(BASICO());
  try {
    const config = { ...CONFIG, fallback_model: 'org/modelo-local' };
    const env = { HF_HUB_CACHE: cache };
    const ausente = indexar(c.opcoes({ alvo: 'fallback', config, env }));
    assert.equal(ausente.motivo, 'embeddings.local-ausente');
    const repo = path.join(cache, 'models--org--modelo-local');
    const ref = 'a'.repeat(40);
    fs.mkdirSync(path.join(repo, 'refs'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'snapshots', ref), { recursive: true });
    fs.writeFileSync(path.join(repo, 'refs', 'main'), ref);
    fs.writeFileSync(path.join(repo, 'snapshots', ref, 'config.json'), JSON.stringify({ hidden_size: 48 }));
    assert.equal(dimDoModeloLocal('org/modelo-local', env), 48);
    const r = indexar(c.opcoes({ alvo: 'fallback', config, env, chavePresente: false }));
    assert.equal(r.motivo, null);
    assert.equal(r.dim, 48);
    assert.equal(r.custoEstimadoUsd, 0, 'o fallback local nao cobra');
    assert.ok(c.driver.pedidosDeEmbedding.every(p => p.alvo === 'fallback' && p.dim === 48));
  } finally { c.limpar(); fs.rmSync(cache, { recursive: true, force: true }); }
});

test('truncados do modelo local sao somados e recusa por segredo no transporte vira conteudo-recusado', () => {
  const c = cenario(BASICO());
  try {
    const r = indexar(c.opcoes({ embeddar: p => ({ ...c.driver.embeddar(p), truncados: [0, 2] }) }));
    assert.equal(r.truncados, 2);
    assert.equal(codigoDeEmbedding(new Error('memory.transport.secret: conteudo recusado')), 'embeddings.conteudo-recusado');
    assert.equal(codigoDeEmbedding(new Error('memory.transport.timeout')), 'embeddings.timeout');
    assert.equal(codigoDeEmbedding(new Error('qualquer outra coisa')), 'embeddings.provider-indisponivel');
  } finally { c.limpar(); }
});

// ---------------------------------------------------------------------------
// Pelo binario: projeto temporario com um OrkMind falso (script node no lugar do Python).
// ---------------------------------------------------------------------------
const ORK = path.resolve(__dirname, '../../dist/index.js');
const DUBLE = path.resolve(__dirname, '../../dist/orkmind.js');

function orkmindFalso(dir: string, entradas: EntradaDeMemoria[]): string {
  fs.writeFileSync(path.join(dir, 'dados.json'), JSON.stringify(entradas.map(e => ({ ...e, created_at: e.criadaEm }))));
  const runner = path.join(dir, 'python-falso');
  fs.writeFileSync(runner, `#!${process.execPath}
const fs=require('fs'),path=require('path');
const q=JSON.parse(fs.readFileSync(0,'utf8'));
const dados=JSON.parse(fs.readFileSync(path.join(__dirname,'dados.json'),'utf8'));
const log=path.join(__dirname,'chamadas.log'); fs.appendFileSync(log, q.op+'\\n');
const cont={}; for (const e of dados) cont[e.collection]=(cont[e.collection]||0)+1;
if (q.op==='stats') console.log(JSON.stringify(cont));
else if (q.op==='health') console.log(JSON.stringify({contagens:cont,orkmind:'teste',fallback:{modelo:null,presente:false,dependencias:false}}));
else if (q.op==='export') console.log(JSON.stringify(dados.filter(e=>e.collection===q.collection)));
else if (q.op==='universo') console.log(JSON.stringify(new (require(${JSON.stringify(DUBLE)}).DriverEmMemoria)(dados.map(e=>({...e,criadaEm:e.created_at}))).universo(q.tenant)));
else if (q.op==='embed') { if (!process.env.ORKMIND_EMBEDDING_API_KEY && q.alvo==='primario') { console.log(JSON.stringify({error:'embeddings.chave-ausente'})); process.exit(1); }
  const {vetorDeDuble}=require(${JSON.stringify(DUBLE)}); console.log(JSON.stringify({alvo:q.alvo,modelo:q.modelo,dim:q.dim,vetores:q.textos.map(t=>vetorDeDuble(t,q.dim))})); }
else { console.log(JSON.stringify({error:'memory.bridge.failed'})); process.exit(1); }
`, { mode: 0o755 });
  const cli = path.join(dir, 'orkmind-falso');
  fs.writeFileSync(cli, `#!${runner}\n`, { mode: 0o755 });
  return cli;
}

function ligarEmbedding(dir: string, cli: string): void {
  const caminho = path.join(dir, 'orkastery.yaml');
  fs.writeFileSync(caminho, fs.readFileSync(caminho, 'utf8')
    .replace(/^  mode: files$/m, '  mode: orkmind')
    .replace(/^  database_url_env: ""$/m, '  database_url_env: "TESTE_INDICE_DSN"')
    .replace(/^  cli: orkmind$/m, `  cli: ${cli}`)
    .replace(/^  timeout_ms: 15000$/m, `  timeout_ms: 15000
  embedding:
    provider: openrouter
    model: "qwen/qwen3-embedding-8b"
    dim: 64
    api_key_env: "TESTE_INDICE_EMBEDDING_KEY"`));
}

function orkJson(cwd: string, args: string[], env: Record<string, string>): { json: Record<string, unknown>; codigo: number } {
  try {
    const saida = execFileSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } });
    return { json: JSON.parse(saida), codigo: 0 };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string };
    return { json: erro.stdout ? JSON.parse(erro.stdout) : {}, codigo: erro.status ?? -1 };
  }
}

test('ork memory index pelo binario: dry-run sem chave, indexacao e segunda execucao idempotente', (t) => {
  const p = projetoTemporario('i38-index-cli');
  t.after(p.limpar);
  const cli = orkmindFalso(p.dir, [...BASICO(), entrada('x1', 'decision', 'Texto de outro produto', 'alheio')]
    .map(e => ({ ...e, tags: { project: [e.tags.project[0] === 'fabrica' ? 'orkastery' : 'alheio'] } })));
  ligarEmbedding(p.dir, cli);
  const env = { TESTE_INDICE_DSN: 'postgresql://leitor:senha@db.local:5432/memoria' };
  const seco = orkJson(p.dir, ['memory', 'index', '--dry-run', '--json'], env);
  assert.equal(seco.codigo, 0);
  assert.equal(seco.json.chamadasAoProvider, 0);
  assert.equal(seco.json.universo, 3, 'a entrada de outro tenant fica fora do universo');
  assert.ok(Number(seco.json.tokensEstimados) > 0);
  assert.ok(Number(seco.json.custoEstimadoUsd) >= 0 && Number(seco.json.custoEstimadoUsd) < 0.01);
  assert.ok(!fs.readFileSync(path.join(p.dir, 'chamadas.log'), 'utf8').includes('embed'));
  const semChave = orkJson(p.dir, ['memory', 'index', '--json'], env);
  assert.equal(semChave.codigo, 1);
  assert.equal(semChave.json.motivo, 'embeddings.chave-ausente');
  const comChave = { ...env, TESTE_INDICE_EMBEDDING_KEY: ['chave', 'de', 'teste', 'dedicada', '000'].join('-') };
  const primeira = orkJson(p.dir, ['memory', 'index', '--json'], comChave);
  assert.equal(primeira.codigo, 0, JSON.stringify(primeira.json));
  assert.equal(primeira.json.embedados, 3);
  const segunda = orkJson(p.dir, ['memory', 'index', '--json'], comChave);
  assert.equal(segunda.json.embedados, 0);
  assert.equal(segunda.json.reescritos, 0);
  assert.ok(fs.existsSync(path.join(p.dir, '.orkastery/memoria/vetores/orkastery/qwen__qwen3-embedding-8b-64.json')));
});

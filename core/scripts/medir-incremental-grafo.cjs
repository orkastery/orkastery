#!/usr/bin/env node
/**
 * RM-031 KG4 (D8): prova e medida do indice incremental do grafo em pares de revisoes reais deste
 * repositorio. Script de desenvolvimento, fora do pacote publicado (core/scripts nao entra em `files`).
 *
 *   node core/scripts/medir-incremental-grafo.cjs --conferir
 *   node core/scripts/medir-incremental-grafo.cjs --saida ARQ [--dist-antes DIR]
 *   node core/scripts/medir-incremental-grafo.cjs --validar ARQ
 *
 * Para cada par (base, alvo): um clone compartilhado no tmp e um estado novo; o indice completo da
 * base, o incremental do alvo a partir dele e a completa do alvo por `--forcar`, que so da
 * `reconstruido-identico` com os quatro arquivos do indice iguais byte a byte. A ancora: a extracao
 * completa de 2418a4e7 com este codigo da o digest que o codigo do KG3 dava. Tempos de ponta a ponta
 * do `construirIndice` (relogio monotonico do processo), com a carga da maquina no inicio e no fim.
 * `--dist-antes DIR` mede tambem a completa do alvo com outro `dist` (o do KG3, compilado a parte).
 * `--conferir` refaz os pares e a ancora e sai 1 se algum par diverge; `--validar` confere a forma de
 * um registro e recusa par sem prova de igualdade ou conclusao alem do medido.
 *
 * Requer `npm --prefix core run build` e o historico do Git (o CI faz checkout com `fetch-depth: 0`).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCHEMA = 'ork.graph-incremental-cost/v0';
const RAIZ = path.resolve(__dirname, '..', '..');
const DIST = path.join(RAIZ, 'core', 'dist');
const SHA = /^[0-9a-f]{40}$/;
/** A extracao de 2418a4e7 (versao 0.5.0, KG3) com o codigo do KG3: o KG4 nao pode mudar um byte. */
const ANCORA = Object.freeze({ revisao: '2418a4e798a6d8b3d80ef8afdc115d0cf131d480', digest: '9fe38ec2c9050f6a61bae114d292531911b15171267b11eeab463c686a25440c' });
/** Pares fixos (pai e commit) do historico deste repositorio, um por tipo de mudanca. */
const PARES = Object.freeze([
  { id: 'ts-tipica', caso: 'tres arquivos TypeScript do nucleo e um Markdown mudados', base: 'c68df3cd1c3409b74918534130155a10bf1efad7', alvo: 'd49106252e1025f477d0defe2d3ef18a41974a51' },
  { id: 'so-docs', caso: 'so o CHANGELOG', base: 'a300d6d9697e152be8a3cd294280508c2aff8dbc', alvo: '66faa145d4e88a1b065fb525d368ac5092b37573' },
  { id: 'so-dados', caso: 'so um bundle JSON do CI', base: '61631dd70bc84fb1a4f314bbad376fceb4f68b5f', alvo: 'a1044c9b3b32c66263bd6696afc277b04228c55f' },
  { id: 'arquivo-central', caso: 'modulo importado por quase todo o nucleo e o teste dele', base: '5c3e788345840f3ade4f557365e0b3a87e2814c9', alvo: 'a8feb636600e3de3594ccdb83afb93bd07c482b8' },
  { id: 'renome', caso: 'Markdown renomeado e as paginas que o citam', base: '985d6179ec2f8120ed18679123352b57121c1e09', alvo: '35eea27f4ee8c5c6adf8a0fe5f7b67decb498eab' },
  { id: 'remocao-e-novo', caso: 'script removido, modulo TypeScript novo e seis mudados', base: '5675a832841ad2bd2bd81d5d2e124b1e7737d88a', alvo: '772762d609f22023eaf5080911b10930c779069e' },
]);
const METODO = 'construirIndice de ponta a ponta no mesmo processo, relogio monotonico; o completo e o --forcar do alvo, que extrai tudo e compara os quatro arquivos com o incremental gravado';
const LIMITES = [
  'tempos de uma maquina, sob a carga registrada; a mesma rodada noutra maquina da outros numeros',
  'o piso do incremental e montar, derivar e validar os IDs do snapshot inteiro, que o contrato v1 deriva da revisao',
  'o ganho depende do que a mudanca alcanca: arquivo importado por quase todo o nucleo reextrai quase todo o TypeScript',
];
const CONCLUSAO = 'nos pares medidos, o incremental gravou os mesmos bytes da extracao completa; o tempo de cada lado esta no registro, sem generalizar alem deles';

function argumentos(argv) {
  const r = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], valor = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} exige valor`);
      return argv[++i];
    };
    if (a === '--conferir') r.conferir = true;
    else if (a === '--saida') r.saida = valor();
    else if (a === '--validar') r.validar = valor();
    else if (a === '--dist-antes') r.distAntes = path.resolve(valor());
    else throw new Error(`opcao desconhecida: ${a}`);
  }
  if ([r.conferir, r.saida, r.validar].filter(Boolean).length !== 1) throw new Error('use uma de --conferir, --saida ARQ ou --validar ARQ');
  return r;
}

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
const carga = () => os.loadavg().map((x) => Math.round(x * 100) / 100);
const ms = (f) => {
  const a = process.hrtime.bigint(), r = f();
  return [r, Number((process.hrtime.bigint() - a) / 1000000n)];
};

/** Mede os pares e a ancora num clone compartilhado no tmp; nada fica fora do tmp, que sai no fim. */
function medir(opcoes = {}, log = () => undefined) {
  const { construirIndice } = require(path.join(DIST, 'intelligence-graph-index.js'));
  const { carregarAnalisadores } = require(path.join(DIST, 'intelligence-graph-parsers.js'));
  const antes = opcoes.distAntes ? require(path.join(opcoes.distAntes, 'intelligence-graph-index.js')) : null;
  const parser = carregarAnalisadores();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-kg4-medida-'));
  const inicio = carga();
  try {
    const clone = path.join(tmp, 'r');
    git(RAIZ, 'clone', '-q', '--shared', '--no-checkout', RAIZ, clone);
    let n = 0;
    const estado = () => {
      const d = path.join(tmp, `estado-${n++}`);
      fs.mkdirSync(d);
      return d;
    };
    const pares = [];
    for (const p of PARES) {
      const ctx = { raiz: clone, estado: estado(), repositorio: 'orkastery' };
      git(clone, 'checkout', '-q', '--detach', p.base);
      const base = construirIndice(ctx, { parser });
      git(clone, 'checkout', '-q', '--detach', p.alvo);
      const [inc, tInc] = ms(() => construirIndice(ctx, { parser }));
      const [comp, tComp] = ms(() => construirIndice(ctx, { parser, forcar: true }));
      let tAntes = null;
      if (antes) [, tAntes] = ms(() => antes.construirIndice({ raiz: clone, estado: estado(), repositorio: 'orkastery' }, { forcar: true }));
      const a = inc.reaproveitamento;
      const igual = inc.modo === 'incremental' && inc.base?.revision === p.base && comp.estado === 'reconstruido-identico'
        && comp.manifesto.graph_digest === inc.manifesto.graph_digest && base.modo === 'completo';
      const par = {
        id: p.id, caso: p.caso, base: p.base, alvo: p.alvo, igual, graph_digest: inc.manifesto.graph_digest,
        mudanca: a ? a.mudanca : null,
        ts: a ? { modo: a.ts.modo, motivo: a.ts.motivo, reextraidos: a.ts.reextraidos.length, programa: a.ts.programa, reaproveitados: a.ts.reaproveitados } : null,
        md: a ? { reextraidos: a.md.reextraidos.length, reaproveitados: a.md.reaproveitados } : null,
        ms: { incremental: tInc, completo: tComp, completo_antes: tAntes },
      };
      pares.push(par);
      log(par);
    }
    git(clone, 'checkout', '-q', '--detach', ANCORA.revisao);
    const ancora = construirIndice({ raiz: clone, estado: estado(), repositorio: 'orkastery' }, { parser, forcar: true });
    return {
      schema: SCHEMA, metodo: METODO, limites: LIMITES, conclusao: CONCLUSAO,
      ambiente: {
        node: process.version, plataforma: `${process.platform}-${process.arch}`, nucleos: os.cpus().length, carga_inicio: inicio, carga_fim: carga(),
        completo_antes: antes ? 'dist do KG3 (2418a4e7) compilado a parte, no mesmo processo' : null,
      },
      ancora: { revisao: ANCORA.revisao, digest: ancora.manifesto.graph_digest, igual: ancora.manifesto.graph_digest === ANCORA.digest },
      pares,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const inteiro = (x) => Number.isSafeInteger(x) && x > 0;

/** Forma do registro: todo par conferido igual, tempos medidos, ancora certa e conclusao sem promessa. */
function validar(r) {
  const erros = [];
  const exigir = (ok, msg) => {
    if (!ok) erros.push(msg);
  };
  exigir(r && r.schema === SCHEMA, `schema diferente de ${SCHEMA}`);
  if (!r || typeof r !== 'object') return erros;
  exigir(r.metodo === METODO && JSON.stringify(r.limites) === JSON.stringify(LIMITES), 'metodo ou limites trocados');
  exigir(typeof r.conclusao === 'string' && !/(sempre|garant|qualquer reposit|economi)/i.test(r.conclusao), 'conclusao alem do medido');
  exigir(r.ancora && r.ancora.revisao === ANCORA.revisao && r.ancora.digest === ANCORA.digest && r.ancora.igual === true, 'ancora diferente do digest do KG3');
  exigir(r.ambiente && typeof r.ambiente.node === 'string' && inteiro(r.ambiente.nucleos) && Array.isArray(r.ambiente.carga_inicio), 'ambiente incompleto');
  const pares = Array.isArray(r.pares) ? r.pares : [];
  exigir(pares.length === PARES.length, `${PARES.length} pares esperados`);
  pares.forEach((p, i) => {
    const fixo = PARES.find((x) => x.id === p.id);
    exigir(!!fixo && fixo.base === p.base && fixo.alvo === p.alvo && SHA.test(p.base) && SHA.test(p.alvo), `par ${i}: fora da lista fixa`);
    exigir(p.igual === true, `par ${p.id}: sem a prova de bytes iguais`);
    exigir(p.ms && inteiro(p.ms.incremental) && inteiro(p.ms.completo), `par ${p.id}: tempo nao medido`);
    exigir(p.ms && (p.ms.completo_antes === null ? r.ambiente?.completo_antes === null : inteiro(p.ms.completo_antes)), `par ${p.id}: completo antes sem medida ou sem origem`);
    exigir(p.ts && ['reaproveitado', 'parcial', 'inteiro'].includes(p.ts.modo) && p.mudanca && p.md, `par ${p.id}: reaproveitamento ausente`);
  });
  return erros;
}

const fmt = (p) => `${p.id}: ${p.igual ? 'igual' : 'DIFERENTE'}; incremental ${p.ms.incremental} ms, completo ${p.ms.completo} ms${p.ms.completo_antes ? `, completo do KG3 ${p.ms.completo_antes} ms` : ''}; TS ${p.ts?.modo} (${p.ts?.reextraidos} reextraidos, programa ${p.ts?.programa}), MD ${p.md?.reextraidos} reextraidos`;

function main() {
  const a = argumentos(process.argv.slice(2));
  if (a.validar) {
    const erros = validar(JSON.parse(fs.readFileSync(a.validar, 'utf8')));
    for (const e of erros) console.error(`reprovado: ${e}`);
    console.log(erros.length ? `registro invalido (${erros.length})` : 'registro valido');
    process.exitCode = erros.length ? 1 : 0;
    return;
  }
  const r = medir({ distAntes: a.distAntes }, (p) => console.log(fmt(p)));
  console.log(`ancora ${r.ancora.revisao.slice(0, 12)}: digest ${r.ancora.digest.slice(0, 16)}, ${r.ancora.igual ? 'igual ao do KG3' : 'DIFERENTE'}`);
  if (a.saida) {
    fs.writeFileSync(a.saida, `${JSON.stringify(r, null, 2)}\n`);
    console.log(`registro em ${a.saida}`);
  }
  const falhas = r.pares.filter((p) => !p.igual).length + (r.ancora.igual ? 0 : 1);
  console.log(falhas ? `reprovado: ${falhas} divergencia(s)` : `aprovado: ${r.pares.length} pares iguais byte a byte e a ancora`);
  process.exitCode = falhas ? 1 : 0;
}

if (require.main === module) main();
module.exports = { SCHEMA, ANCORA, PARES, METODO, LIMITES, CONCLUSAO, validar, medir };

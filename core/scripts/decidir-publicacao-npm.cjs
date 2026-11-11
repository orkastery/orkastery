#!/usr/bin/env node
/**
 * RM-088: decide a dist-tag do @orkastery/cli antes de publicar.
 *
 * A regra e a classificacao da consulta sao exportadas para testes hermeticos. A CLI usa o
 * registry publico fixado no workflow, nunca interpreta texto humano de erro e so grava uma tag
 * no GITHUB_OUTPUT depois que todo o contrato passou.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PACOTE = '@orkastery/cli';
const REGISTRO = 'https://registry.npmjs.org';
const RESERVADAS = new Set(['latest', 'previous']);

class Recusa extends Error {
  constructor(motivo, detalhe) {
    super(`${motivo}: ${detalhe}`);
    this.motivo = motivo;
  }
}

const recusar = (motivo, detalhe) => { throw new Recusa(motivo, detalhe); };

/** Valida SemVer 2.0.0 sem converter inteiros potencialmente grandes para Number. */
function analisarSemver(valor, motivo = 'publicacao.semver-invalida') {
  if (typeof valor !== 'string') recusar(motivo, 'a versão não é texto');
  const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(valor);
  if (!m) recusar(motivo, 'a versão não segue SemVer 2.0.0');
  const core = m.slice(1, 4);
  if (core.some((n) => n.length > 1 && n.startsWith('0'))) recusar(motivo, 'o core numérico tem zero à esquerda');
  const pre = m[4] ? m[4].split('.') : [];
  if (pre.some((id) => /^[0-9]+$/.test(id) && id.length > 1 && id.startsWith('0'))) {
    recusar(motivo, 'a pré-release numérica tem zero à esquerda');
  }
  return { original: valor, core, pre, build: m[5] ? m[5].split('.') : [] };
}

/** Compara dois decimais sem perda de precisão. */
function compararDecimal(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Ordem de precedência da SemVer 2.0.0; build metadata é ignorada. */
function compararSemver(a, b) {
  const va = typeof a === 'string' ? analisarSemver(a) : a;
  const vb = typeof b === 'string' ? analisarSemver(b) : b;
  for (let i = 0; i < 3; i += 1) {
    const ordem = compararDecimal(va.core[i], vb.core[i]);
    if (ordem) return ordem;
  }
  if (!va.pre.length || !vb.pre.length) {
    if (!va.pre.length && !vb.pre.length) return 0;
    return va.pre.length ? -1 : 1;
  }
  const tamanho = Math.min(va.pre.length, vb.pre.length);
  for (let i = 0; i < tamanho; i += 1) {
    const ai = va.pre[i], bi = vb.pre[i];
    if (ai === bi) continue;
    const an = /^[0-9]+$/.test(ai), bn = /^[0-9]+$/.test(bi);
    if (an && bn) return compararDecimal(ai, bi);
    if (an !== bn) return an ? -1 : 1;
    return ai < bi ? -1 : 1;
  }
  return va.pre.length === vb.pre.length ? 0 : va.pre.length < vb.pre.length ? -1 : 1;
}

/** O subconjunto conservador evita colisao com versoes, faixas e canais reservados. */
function validarDistTagDePreRelease(id) {
  const invalida = typeof id !== 'string' || id === '' || /^[0-9]/.test(id) || /^[vV]/.test(id) ||
    /^[xX]$/.test(id) || RESERVADAS.has(id.toLowerCase()) || !/^[A-Za-z][0-9A-Za-z-]*$/.test(id);
  if (invalida) recusar('publicacao.dist-tag-invalida', 'o primeiro identificador da pré-release não é uma dist-tag segura');
  return id;
}

/** Valida tudo que independe do registry; o adaptador chama isto antes do primeiro I/O externo. */
function prepararCandidata(versaoTag, versaoPacote) {
  if (typeof versaoTag !== 'string' || !versaoTag.startsWith('v')) {
    recusar('publicacao.semver-invalida', 'a tag precisa ser v<SemVer>');
  }
  const daTag = analisarSemver(versaoTag.slice(1));
  const doPacote = analisarSemver(versaoPacote);
  if (daTag.original !== doPacote.original) {
    recusar('publicacao.versao-tag-diverge', 'a tag não corresponde à versão do pacote');
  }
  const distTagPreRelease = daTag.pre.length ? validarDistTagDePreRelease(daTag.pre[0]) : null;
  return { versao: daTag, distTagPreRelease };
}

function decidirPublicacao({ versaoTag, versaoPacote, registro }) {
  const candidata = prepararCandidata(versaoTag, versaoPacote);
  if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
    recusar('publicacao.consulta-invalida', 'o estado do registry não foi classificado');
  }
  if (registro.tipo === 'inacessivel') recusar('publicacao.registro-inacessivel', 'o registry não respondeu de forma segura');
  if (registro.tipo === 'sem-latest') recusar('publicacao.latest-ausente', 'o pacote existe sem a dist-tag latest');
  if (registro.tipo !== 'latest' && registro.tipo !== 'pacote-ausente') {
    recusar('publicacao.consulta-invalida', 'o estado do registry não é reconhecido');
  }
  if (registro.tipo === 'latest') {
    const latest = analisarSemver(registro.versao);
    if (latest.pre.length) recusar('publicacao.latest-pre-release', 'a dist-tag latest aponta para uma pré-release');
    if (candidata.distTagPreRelease) {
      return { acao: 'publicar', distTag: candidata.distTagPreRelease, versao: candidata.versao.original, motivo: 'pre-release' };
    }
    const ordem = compararSemver(candidata.versao, latest);
    if (ordem === 0) recusar('publicacao.versao-ja-publicada', 'a versão tem a mesma precedência da latest');
    return { acao: 'publicar', distTag: ordem > 0 ? 'latest' : 'previous', versao: candidata.versao.original,
      motivo: ordem > 0 ? 'estavel-maior' : 'estavel-menor' };
  }
  return { acao: 'publicar', distTag: candidata.distTagPreRelease || 'latest', versao: candidata.versao.original,
    motivo: candidata.distTagPreRelease ? 'primeira-pre-release' : 'primeira-estavel' };
}

function executorPadrao(comando, argumentos) {
  try {
    const stdout = execFileSync(comando, argumentos, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: Number.isInteger(e.status) ? e.status : 1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

function jsonEstruturado(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  try {
    const valor = JSON.parse(texto);
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null;
  } catch { return null; }
}

function codigoDoErro(resultado) {
  for (const texto of [resultado.stdout, resultado.stderr]) {
    const valor = jsonEstruturado(texto);
    if (valor && valor.error && typeof valor.error === 'object' && typeof valor.error.code === 'string') return valor.error.code;
  }
  return null;
}

function classificarSucessoDaConsulta(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return { tipo: 'sem-latest' };
  let valor;
  try { valor = JSON.parse(stdout); }
  catch { recusar('publicacao.consulta-invalida', 'a resposta de sucesso do npm não é JSON'); }
  if (valor === null) return { tipo: 'sem-latest' };
  const versao = typeof valor === 'string' ? valor : Array.isArray(valor) && valor.length === 1 && typeof valor[0] === 'string' ? valor[0] : null;
  if (versao === null) recusar('publicacao.consulta-invalida', 'a resposta de sucesso do npm tem forma desconhecida');
  analisarSemver(versao, 'publicacao.consulta-invalida');
  return { tipo: 'latest', versao };
}

function consultarRegistro(executor = executorPadrao, registro = REGISTRO) {
  const consulta = executor('npm', ['view', PACOTE, 'dist-tags.latest', '--json', `--registry=${registro}`]);
  if (consulta.status === 0) return classificarSucessoDaConsulta(consulta.stdout);
  if (codigoDoErro(consulta) !== 'E404') return { tipo: 'inacessivel' };
  const ping = executor('npm', ['ping', `--registry=${registro}`]);
  return ping.status === 0 ? { tipo: 'pacote-ausente' } : { tipo: 'inacessivel' };
}

function executar(opcoes = {}) {
  const env = opcoes.env || process.env;
  const raiz = opcoes.raiz || path.resolve(__dirname, '..');
  const pacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const versaoTag = env.GITHUB_REF_NAME;
  // Esta chamada valida inclusive a dist-tag de pré-release antes de consultar o registry.
  prepararCandidata(versaoTag, pacote.version);
  const registro = consultarRegistro(opcoes.executor || executorPadrao, REGISTRO);
  const decisao = decidirPublicacao({ versaoTag, versaoPacote: pacote.version, registro });
  if (typeof env.GITHUB_OUTPUT !== 'string' || !env.GITHUB_OUTPUT) {
    recusar('publicacao.saida-ausente', 'GITHUB_OUTPUT não foi informado pelo runner');
  }
  fs.appendFileSync(env.GITHUB_OUTPUT, `tag=${decisao.distTag}\n`);
  return { status: 0, stdout: `publicacao.dist-tag: ${decisao.distTag}\n`, stderr: '', decisao };
}

module.exports = { Recusa, analisarSemver, compararSemver, validarDistTagDePreRelease, prepararCandidata,
  decidirPublicacao, classificarSucessoDaConsulta, consultarRegistro, executar };

if (require.main === module) {
  try {
    const resultado = executar();
    process.stdout.write(resultado.stdout);
  } catch (e) {
    if (!(e instanceof Recusa)) throw e;
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}

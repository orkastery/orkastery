#!/usr/bin/env node
/**
 * RM-050: confere os comandos dos guias de contribuicao (`CONTRIBUTING.md` e
 * `docs/guias/contribuir/`) e o alinhamento dos modelos do `.github` com o guia de triagem.
 *
 *  - cada linha de bloco `bash` roda na raiz e precisa sair 0. Bloco precedido da linha
 *    `<!-- checagem: citado -->` (rede, efeito externo, thread real) nao roda;
 *  - todo `ork <comando>` citado, em bloco ou em crase, precisa estar na ajuda do CLI, pela mesma
 *    regra do `ork docs verificar`; todo `npm --prefix core run <script>` precisa existir;
 *  - todo rotulo dos modelos de issue esta na tabela de rotulos de `triagem.md`, e todo link
 *    `blob/main/<caminho>` do `.github` aponta para um caminho que existe na arvore.
 *
 * Sai != 0 com a lista do que falhou. Precisa do CLI compilado (`npm --prefix core run build`).
 *   node core/scripts/checar-comandos-dos-guias.cjs [raiz]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MARCA_CITADO = '<!-- checagem: citado -->';
const DIR_GUIAS = 'docs/guias/contribuir';
const GUIA_TRIAGEM = `${DIR_GUIAS}/triagem.md`;
/** Abaixo do corte de 10 min por comando do `ork verify`, com folga para o resto da checagem. */
const PRAZO_S = 540;
const CLI = path.join(__dirname, '..', 'dist', 'index.js');
const TIMEOUT_BIN = '/usr/bin/timeout';

function guias(raiz) {
  const dir = path.join(raiz, DIR_GUIAS);
  const nomes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  return [
    ...(fs.existsSync(path.join(raiz, 'CONTRIBUTING.md')) ? ['CONTRIBUTING.md'] : []),
    ...nomes.map((n) => `${DIR_GUIAS}/${n}`),
  ];
}

/** Blocos cercados, com a lingua, a marca de citado e o numero de cada linha. */
function blocos(texto) {
  const saida = [];
  let aberto = null;
  let anterior = '';
  texto.replace(/\r\n/g, '\n').split('\n').forEach((linha, i) => {
    if (aberto) {
      if (/^\s*```\s*$/.test(linha)) {
        saida.push(aberto);
        aberto = null;
        anterior = linha;
      } else {
        aberto.linhas.push({ texto: linha, numero: i + 1 });
      }
      return;
    }
    const cerca = /^\s*```(\S*)/.exec(linha);
    if (cerca) {
      aberto = { lingua: cerca[1], citado: anterior.trim() === MARCA_CITADO, linhas: [] };
    } else if (linha.trim()) {
      anterior = linha;
    }
  });
  return saida;
}

/** Os comandos de um bloco: sem linha vazia nem comentario, e com `\` no fim juntando linhas. */
function comandosDoBloco(bloco) {
  const comandos = [];
  let atual = null;
  for (const { texto, numero } of bloco.linhas) {
    const t = texto.trim();
    if (!atual && (!t || t.startsWith('#'))) continue;
    const parte = t.replace(/\\$/, '').trim();
    if (atual) atual.texto += ` ${parte}`;
    else atual = { texto: parte, numero };
    if (!t.endsWith('\\')) {
      comandos.push(atual);
      atual = null;
    }
  }
  if (atual) comandos.push(atual);
  return comandos;
}

/** Trechos em crase fora dos blocos cercados, com o numero da linha. */
function trechosEmCrase(texto) {
  const saida = [];
  let dentro = false;
  texto.replace(/\r\n/g, '\n').split('\n').forEach((linha, i) => {
    if (/^\s*```/.test(linha)) {
      dentro = !dentro;
      return;
    }
    if (dentro) return;
    for (const m of linha.matchAll(/`([^`\n]+)`/g)) saida.push({ trecho: m[1], numero: i + 1 });
  });
  return saida;
}

/** Cada `ork <topo> [<sub>]` de um comando, inclusive depois de `&&`, `||`, `;` e `|`. */
function citacoesDoOrk(comando) {
  const citacoes = [];
  for (const segmento of comando.split(/&&|\|\||;|\|/)) {
    const limpo = segmento.trim().replace(/^[!(]\s*/, '').replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '');
    const m = /^(?:ork|node core\/dist\/index\.js)\s+(\S+)(?:\s+(\S+))?/.exec(limpo);
    // Opcao global (`ork --version`) e marcador de lugar (`ork <comando>`) nao sao comando.
    if (m && !/^[-<]/.test(m[1])) citacoes.push({ topo: m[1], sub: m[2] ?? '' });
  }
  return citacoes;
}

/** A regra do `ork docs verificar`: comando com subcomandos declarados exige o par. */
function declarado(comandos, { topo, sub }) {
  const temSubcomandos = [...comandos].some((c) => c.startsWith(`${topo} `));
  const exigePar = temSubcomandos && /^[a-z][a-z-]*$/.test(sub);
  return comandos.has(topo) && (!exigePar || comandos.has(`${topo} ${sub}`));
}

function scriptsCitados(comando) {
  return [...comando.matchAll(/\bnpm\s+--prefix\s+core\s+(?:run\s+)?([\w:.-]+)/g)]
    .map((m) => m[1])
    .filter((s) => !['ci', 'install', 'link', 'pack', 'publish', 'view'].includes(s));
}

function rodar(raiz, comando) {
  const inicio = Date.now();
  const opcoes = { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const r = fs.existsSync(TIMEOUT_BIN)
    ? spawnSync(TIMEOUT_BIN, ['--kill-after=15', String(PRAZO_S), 'bash', '-c', comando], opcoes)
    : spawnSync('bash', ['-c', comando], { ...opcoes, timeout: PRAZO_S * 1000 });
  return {
    ok: r.status === 0,
    status: r.status ?? r.signal,
    segundos: (Date.now() - inicio) / 1000,
    cauda: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n'),
  };
}

/** Rotulos da tabela de `triagem.md`: a primeira coluna de cada linha, em crase. */
function rotulosDaTriagem(texto) {
  return new Set([...texto.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]));
}

/** Rotulos de um modelo de issue: `labels: [a, "b"]` ou a lista em linhas `- a`. */
function rotulosDoModelo(yml) {
  const emLinha = /^labels:[ \t]*\[(.*)\][ \t]*$/m.exec(yml);
  if (emLinha) return emLinha[1].split(',').map((r) => r.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const bloco = /^labels:\s*\n((?:\s+-\s+.+\n?)+)/m.exec(yml);
  return bloco ? [...bloco[1].matchAll(/-\s+(.+)/g)].map((m) => m[1].trim().replace(/^["']|["']$/g, '')) : [];
}

function arquivosDoGithub(raiz) {
  const saida = [];
  const andar = (rel) => {
    const abs = path.join(raiz, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const filho = `${rel}/${e.name}`;
      if (e.isDirectory()) andar(filho);
      else if (/\.(md|ya?ml)$/.test(e.name)) saida.push(filho);
    }
  };
  andar('.github');
  return saida.sort();
}

function lerAjuda() {
  if (!fs.existsSync(CLI)) throw new Error(`${path.relative(process.cwd(), CLI)} não existe: compile antes com npm --prefix core run build`);
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/**
 * A checagem inteira. `executar: false` confere so a existencia (o teste unitario usa assim
 * sobre a arvore real, porque rodar os blocos rodaria a propria suite).
 */
function checarGuias(raiz, opcoes = {}) {
  const executar = opcoes.executar ?? true;
  const aoRodar = opcoes.aoRodar ?? (() => {});
  const { comandosDaAjuda } = require(path.join(__dirname, '..', 'dist', 'docs.js'));
  const comandos = comandosDaAjuda(opcoes.ajuda ?? lerAjuda());
  const pacote = path.join(raiz, 'core', 'package.json');
  const scripts = fs.existsSync(pacote) ? JSON.parse(fs.readFileSync(pacote, 'utf8')).scripts ?? {} : {};
  const falhas = [];
  let rodados = 0;
  let citados = 0;

  const arquivos = guias(raiz);
  if (!arquivos.some((a) => a.startsWith(`${DIR_GUIAS}/`))) falhas.push(`${DIR_GUIAS}: nenhum guia encontrado`);

  const conferir = (rel, numero, comando) => {
    for (const c of citacoesDoOrk(comando)) {
      if (!declarado(comandos, c)) falhas.push(`${rel}:${numero}: o CLI não declara "ork ${`${c.topo} ${c.sub}`.trim()}"`);
    }
    for (const s of scriptsCitados(comando)) {
      if (!Object.hasOwn(scripts, s)) falhas.push(`${rel}:${numero}: core/package.json não tem o script "${s}"`);
    }
  };

  for (const rel of arquivos) {
    const texto = fs.readFileSync(path.join(raiz, rel), 'utf8');
    for (const { trecho, numero } of trechosEmCrase(texto)) conferir(rel, numero, trecho);
    for (const bloco of blocos(texto)) {
      const roda = bloco.lingua === 'bash' && !bloco.citado;
      for (const { texto: comando, numero } of comandosDoBloco(bloco)) {
        conferir(rel, numero, comando);
        if (!roda) {
          citados++;
          continue;
        }
        rodados++;
        if (!executar) continue;
        const r = rodar(raiz, comando);
        aoRodar(rel, numero, comando, r);
        if (!r.ok) falhas.push(`${rel}:${numero}: "${comando}" saiu ${r.status}\n${r.cauda}`);
      }
    }
  }

  const triagem = path.join(raiz, GUIA_TRIAGEM);
  const rotulos = fs.existsSync(triagem) ? rotulosDaTriagem(fs.readFileSync(triagem, 'utf8')) : new Set();
  for (const rel of arquivosDoGithub(raiz)) {
    const texto = fs.readFileSync(path.join(raiz, rel), 'utf8');
    // O modelo de PR cita comandos como o guia; eles nao rodam aqui, mas precisam existir.
    if (rel.endsWith('.md')) {
      for (const { trecho, numero } of trechosEmCrase(texto)) conferir(rel, numero, trecho);
      for (const bloco of blocos(texto)) for (const { texto: c, numero } of comandosDoBloco(bloco)) conferir(rel, numero, c);
    }
    if (rel.startsWith('.github/ISSUE_TEMPLATE/')) {
      for (const r of rotulosDoModelo(texto)) {
        if (!rotulos.has(r)) falhas.push(`${rel}: o rótulo "${r}" não está na tabela de ${GUIA_TRIAGEM}`);
      }
    }
    for (const m of texto.matchAll(/github\.com\/orkastery\/orkastery\/(?:blob|tree)\/main\/([^\s)"'#?]+)/gi)) {
      if (!fs.existsSync(path.join(raiz, decodeURIComponent(m[1])))) falhas.push(`${rel}: o link aponta para ${m[1]}, que não existe`);
    }
  }

  return { falhas, rodados, citados };
}

function main() {
  const raiz = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..'));
  const { falhas, rodados, citados } = checarGuias(raiz, {
    aoRodar: (rel, numero, comando, r) =>
      console.log(`${r.ok ? 'ok   ' : 'FALHA'} ${r.segundos.toFixed(1).padStart(6)} s  ${rel}:${numero}  ${comando}`),
  });
  for (const f of falhas) console.log(f);
  console.log(`${rodados} comando(s) rodado(s), ${citados} citado(s) sem rodar, ${falhas.length} falha(s)`);
  process.exit(falhas.length ? 1 : 0);
}

module.exports = { checarGuias, blocos, comandosDoBloco, citacoesDoOrk, rotulosDoModelo, rotulosDaTriagem };

if (require.main === module) main();

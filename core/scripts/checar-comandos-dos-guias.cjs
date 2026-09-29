#!/usr/bin/env node
/**
 * RM-050: confere os comandos dos guias de contribuicao (`CONTRIBUTING.md` e
 * `docs/guias/contribuir/`) e o alinhamento dos modelos do `.github` com o guia de triagem.
 *
 *  - cada linha de bloco `bash` roda na raiz, num `bash -c` proprio, e precisa sair 0. Bloco
 *    precedido da linha `<!-- checagem: citado -->` (rede, efeito externo, thread real) nao roda;
 *  - bloco `sh`, `shell`, `zsh` ou `console` sem a marca reprova: ou roda como `bash`, ou e citado;
 *  - todo `ork <comando>` citado, em bloco ou em crase, precisa estar na ajuda do CLI, pela mesma
 *    regra do `ork docs verificar`; todo `npm --prefix core run <script>` precisa existir;
 *  - todo rotulo dos modelos de issue esta na tabela de rotulos de `triagem.md`, e todo link
 *    `blob/main/<caminho>` do `.github` aponta para um caminho que existe na arvore.
 *
 * Os blocos rodam com o ambiente de quem chama: rode a checagem so sobre guias que voce leu,
 * como faria com um script de `postinstall`. Precisa do CLI compilado (`npm --prefix core run build`).
 * Sai != 0 com a lista do que falhou.
 *   node core/scripts/checar-comandos-dos-guias.cjs [raiz]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MARCA_CITADO = '<!-- checagem: citado -->';
const DIR_GUIAS = 'docs/guias/contribuir';
const GUIA_TRIAGEM = `${DIR_GUIAS}/triagem.md`;
const SHELL_SEM_BASH = new Set(['sh', 'shell', 'zsh', 'console']);
/**
 * O `ork verify` corta cada comando de claim em 10 min, e a checagem inteira e um comando so:
 * ela para antes disso, para o relatorio sair em vez de ser morto no meio.
 */
const PRAZO_TOTAL_S = 540;
const CLI = path.join(__dirname, '..', 'dist', 'index.js');
/** `timeout(1)` leva o grupo de processos no estouro; sem ele (macOS), so o `bash` morre. */
const TIMEOUT_BIN = '/usr/bin/timeout';

function guias(raiz) {
  const dir = path.join(raiz, DIR_GUIAS);
  const nomes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  return [
    ...(fs.existsSync(path.join(raiz, 'CONTRIBUTING.md')) ? ['CONTRIBUTING.md'] : []),
    ...nomes.map((n) => `${DIR_GUIAS}/${n}`),
  ];
}

/**
 * Uma passada pelo Markdown: blocos cercados (``` ou ~~~, de 3 ou mais, fechados pela mesma cerca
 * de tamanho igual ou maior, como no CommonMark) e os trechos em crase fora deles.
 */
function analisarMarkdown(texto) {
  const blocos = [];
  const trechos = [];
  let aberto = null;
  let anterior = '';
  texto.replace(/\r\n/g, '\n').split('\n').forEach((linha, i) => {
    if (aberto) {
      const fecha = /^\s*(`{3,}|~{3,})\s*$/.exec(linha);
      if (fecha && fecha[1][0] === aberto.cerca[0] && fecha[1].length >= aberto.cerca.length) {
        blocos.push(aberto);
        aberto = null;
        anterior = linha;
      } else {
        aberto.linhas.push({ texto: linha, numero: i + 1 });
      }
      return;
    }
    const abre = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(linha);
    if (abre) {
      aberto = { cerca: abre[1], lingua: abre[2], citado: anterior.trim() === MARCA_CITADO, inicio: i + 1, linhas: [] };
      return;
    }
    if (linha.trim()) anterior = linha;
    for (const m of linha.matchAll(/`([^`\n]+)`/g)) trechos.push({ trecho: m[1], numero: i + 1 });
  });
  return { blocos, trechos, naoFechado: aberto ? aberto.inicio : null };
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

/**
 * A regra de `fontes.comandos` do `ork docs verificar` (core/src/docs.ts, verificarFontes):
 * comando com subcomandos declarados exige o par; argumento (`<id>`) nao conta.
 */
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

function rodar(raiz, comando, prazoS) {
  const inicio = Date.now();
  const opcoes = { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const r = fs.existsSync(TIMEOUT_BIN)
    ? spawnSync(TIMEOUT_BIN, ['--kill-after=15', String(prazoS), 'bash', '-c', comando], opcoes)
    : spawnSync('bash', ['-c', comando], { ...opcoes, timeout: prazoS * 1000 });
  const estourou = r.status === 124 || r.status === 137 || r.error?.code === 'ETIMEDOUT';
  // Sem as cores do terminal (FORCE_COLOR), que sujam a mensagem e o trecho do ledger.
  const linhas = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n');
  // A cauda de uma suite so traz o resumo: os `not ok` vao por ultimo, para caber no trecho que o
  // `ork verify` guarda da saida e dizer QUAL teste caiu.
  const reprovados = linhas.filter((l) => /^\s*not ok\b/.test(l)).slice(0, 10);
  return {
    ok: r.status === 0,
    status: estourou ? `pelo prazo (${prazoS} s)` : String(r.status ?? r.signal),
    segundos: (Date.now() - inicio) / 1000,
    cauda: [...linhas.slice(-8), ...reprovados].join('\n'),
  };
}

/** Rotulos da tabela de `triagem.md`: a primeira coluna de cada linha, em crase. */
function rotulosDaTriagem(texto) {
  return new Set([...texto.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]));
}

/**
 * Rotulos de um modelo de issue, nas formas que o GitHub aceita: `labels: [a, "b"]`,
 * `labels: a, b` e a lista em linhas `- a`. `null` sem a chave; `undefined` quando a chave
 * existe e nada foi lido, para a checagem reprovar em vez de deixar passar sem conferir.
 */
function rotulosDoModelo(yml) {
  const linhas = yml.replace(/\r\n/g, '\n').split('\n');
  const i = linhas.findIndex((l) => /^labels:/.test(l));
  if (i < 0) return null;
  const limpar = (r) => r.trim().replace(/^["']|["']$/g, '');
  const valor = linhas[i].slice('labels:'.length).replace(/\s+#.*$/, '').trim();
  if (valor.startsWith('[')) return valor.replace(/^\[|\]$/g, '').split(',').map(limpar).filter(Boolean);
  if (valor) return valor.split(',').map(limpar).filter(Boolean);
  const itens = [];
  for (const l of linhas.slice(i + 1)) {
    const m = /^\s*-\s+(.+?)\s*(?:\s#.*)?$/.exec(l);
    if (!m) break;
    itens.push(limpar(m[1]));
  }
  return itens.length ? itens : undefined;
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
 * A checagem inteira. `executar: false` confere so a existencia (o teste da suite usa assim
 * sobre a arvore real, porque rodar os blocos rodaria a propria suite). Devolve tambem os
 * comandos que rodam (`aRodar`), para o teste provar que a marca de citado segura o que deve.
 */
function checarGuias(raiz, opcoes = {}) {
  const executar = opcoes.executar ?? true;
  const aoRodar = opcoes.aoRodar ?? (() => {});
  const prazoTotalS = opcoes.prazoTotalS ?? PRAZO_TOTAL_S;
  const ajuda = opcoes.ajuda ?? lerAjuda();
  const { comandosDaAjuda } = require(path.join(__dirname, '..', 'dist', 'docs.js'));
  const comandos = comandosDaAjuda(ajuda);
  const pacote = path.join(raiz, 'core', 'package.json');
  const scripts = fs.existsSync(pacote) ? JSON.parse(fs.readFileSync(pacote, 'utf8')).scripts ?? {} : {};
  const falhas = [];
  const aRodar = [];
  const jaRodados = new Set();
  const inicio = Date.now();
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
    const md = analisarMarkdown(fs.readFileSync(path.join(raiz, rel), 'utf8'));
    if (md.naoFechado) falhas.push(`${rel}:${md.naoFechado}: bloco de código aberto e não fechado`);
    for (const { trecho, numero } of md.trechos) conferir(rel, numero, trecho);
    for (const bloco of md.blocos) {
      if (SHELL_SEM_BASH.has(bloco.lingua) && !bloco.citado) {
        falhas.push(`${rel}:${bloco.inicio}: bloco ${bloco.lingua} sem a marca de citado: use bash para rodar, ou marque como citado`);
      }
      const roda = bloco.lingua === 'bash' && !bloco.citado;
      for (const { texto: comando, numero } of comandosDoBloco(bloco)) {
        conferir(rel, numero, comando);
        if (!roda) {
          citados++;
          continue;
        }
        aRodar.push({ rel, numero, comando });
        // O mesmo comando em dois guias prova a mesma coisa: roda uma vez.
        if (!executar || jaRodados.has(comando)) continue;
        jaRodados.add(comando);
        const restante = Math.floor(prazoTotalS - (Date.now() - inicio) / 1000);
        if (restante < 1) {
          falhas.push(`${rel}:${numero}: "${comando}" não rodou: a checagem passou do prazo total (${prazoTotalS} s)`);
          continue;
        }
        const r = rodar(raiz, comando, restante);
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
      const md = analisarMarkdown(texto);
      for (const { trecho, numero } of md.trechos) conferir(rel, numero, trecho);
      for (const bloco of md.blocos) for (const { texto: c, numero } of comandosDoBloco(bloco)) conferir(rel, numero, c);
    }
    if (rel.startsWith('.github/ISSUE_TEMPLATE/')) {
      const doModelo = rotulosDoModelo(texto);
      if (doModelo === undefined) falhas.push(`${rel}: a chave labels existe, mas nenhum rótulo foi lido`);
      for (const r of doModelo ?? []) {
        if (!rotulos.has(r)) falhas.push(`${rel}: o rótulo "${r}" não está na tabela de ${GUIA_TRIAGEM}`);
      }
    }
    for (const m of texto.matchAll(/github\.com\/orkastery\/orkastery\/(?:blob|tree)\/main\/([^\s)"'#?]+)/gi)) {
      let alvo;
      try {
        alvo = decodeURIComponent(m[1]);
      } catch {
        falhas.push(`${rel}: o link para ${m[1]} tem um % inválido`);
        continue;
      }
      if (!fs.existsSync(path.join(raiz, alvo))) falhas.push(`${rel}: o link aponta para ${m[1]}, que não existe`);
    }
  }

  return { falhas, rodados: aRodar.length, citados, aRodar };
}

function main() {
  const raiz = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..'));
  const { falhas, rodados, citados } = checarGuias(raiz, {
    aoRodar: (rel, numero, comando, r) =>
      console.log(`${r.ok ? 'ok   ' : 'FALHA'} ${r.segundos.toFixed(1).padStart(6)} s  ${rel}:${numero}  ${comando}`),
  });
  for (const f of falhas) console.log(f);
  console.log(`${rodados} comando(s) a rodar (repetidos rodam uma vez), ${citados} citado(s) sem rodar, ${falhas.length} falha(s)`);
  process.exit(falhas.length ? 1 : 0);
}

module.exports = { checarGuias, analisarMarkdown, comandosDoBloco, citacoesDoOrk, rotulosDoModelo, rotulosDaTriagem };

if (require.main === module) main();

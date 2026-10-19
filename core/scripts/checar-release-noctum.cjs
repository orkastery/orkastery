#!/usr/bin/env node
/**
 * RM-058, integração (T9 da ork-rm058integra, D13): o portão de release do #Noctum.
 *
 * A regra do dono: a próxima versão do pacote só sai com o #Noctum validado por pilotos reais. Na tag, o job que publica
 * roda este checador antes do `npm publish`: ele lê `docs/roadmap/evidencias/RM-058/aceite.json` (contrato
 * `ork.noctum-aceite/v1`) e confere cada piloto exigido (o arquivo publicável na mesma pasta, o sha256 dele, `simulado:
 * false` e o veredito `aprovado`) e a ratificação do dono, com a referência do recibo do ingresso tipado. O alcance é toda
 * versão (`ALCANCE`), até o dono responder o item 8 do pacote de decisões da RM-058; os pilotos exigidos são os quatro do
 * plano (`PILOTOS_EXIGIDOS`), até ele responder o item 10.
 *
 * Com `--texto`, no job de documentação: procura em `README.md`, `README.pt-BR.md`, `CHANGELOG.md` e nos `.md` de `docs/`
 * (fora `docs/roadmap/evidencias/`) a forma que anuncia o #Noctum como lançado, entregue, validado ou disponível, logo
 * depois do nome, em pt-BR e em inglês; a negação na mesma oração libera. Com o aceite válido, o texto passa.
 *
 *   node core/scripts/checar-release-noctum.cjs [--texto] [raiz]
 *
 * Só lê arquivos: não chama a rede nem o núcleo compilado. Sai 0 quando passa, 1 com o motivo (`release.noctum.*`) e 2 em
 * erro de uso.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const CONTRATO_ACEITE = 'ork.noctum-aceite/v1';
const CONTRATO_PILOTO = 'ork.noctum-piloto/v1';
const PASTA = 'docs/roadmap/evidencias/RM-058';
/** Item 8 do pacote de decisões da RM-058, alternativa recomendada: nenhuma versão sai antes do aceite. */
const ALCANCE = 'toda-versao';
/** Item 10, alternativa recomendada: os quatro pilotos do plano (uma máquina 6 h e 12 h, duas máquinas 6 h e 12 h). */
const PILOTOS_EXIGIDOS = ['P1', 'P2', 'P3', 'P4'];
const DO_TEXTO = ['README.md', 'README.pt-BR.md', 'CHANGELOG.md'];
/** A afirmação logo depois do nome: em pt-BR, foi, está ou é com lançado, entregue, validado ou disponível. */
const AFIRMACAO_PT = /#?Noctum\s+(?:foi|está|é)\s+(?:lançad[oa]s?|entregues?|validad[oa]s?|disponíve(?:l|is))(?![\p{L}\p{N}])/giu;
/** Em inglês: is, was ou has been com released, shipped, validated, launched ou available. */
const AFIRMACAO_EN = /#?Noctum\s+(?:is|was|has\s+been)\s+(?:released|shipped|validated|launched|available)(?![\p{L}\p{N}])/giu;
/** A negação na mesma oração: não, ainda não, nem, sem; not, yet to. */
const NEGACAO = /(?<![\p{L}\p{N}])(?:não|nem|sem|not|yet\s+to)(?![\p{L}\p{N}])/iu;

class Recusa extends Error {
  constructor(motivo, detalhe) { super(`${motivo}: ${detalhe}`); this.motivo = motivo; }
}

const objeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Confere o aceite dos pilotos; lança a recusa tipada com o motivo. */
function conferirAceite(raiz) {
  const arquivo = path.join(raiz, PASTA, 'aceite.json');
  if (!fs.existsSync(arquivo)) {
    throw new Recusa('release.noctum.aceite-ausente', `${PASTA}/aceite.json não existe: a regra do dono (${ALCANCE}) só deixa a versão sair ` +
      `com os pilotos ${PILOTOS_EXIGIDOS.join(', ')} aprovados e ratificados`);
  }
  let aceite;
  try { aceite = JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
  catch { throw new Recusa('release.noctum.aceite-invalido', `${PASTA}/aceite.json não é JSON`); }
  if (!objeto(aceite) || aceite.contrato !== CONTRATO_ACEITE || !Array.isArray(aceite.pilotos)) {
    throw new Recusa('release.noctum.aceite-invalido', `${PASTA}/aceite.json precisa do contrato ${CONTRATO_ACEITE} e da lista pilotos`);
  }
  for (const id of PILOTOS_EXIGIDOS) {
    const p = aceite.pilotos.find((x) => objeto(x) && x.id === id);
    if (!p) throw new Recusa('release.noctum.piloto-faltando', `o piloto ${id} não está no aceite (exigidos: ${PILOTOS_EXIGIDOS.join(', ')})`);
    if (typeof p.arquivo !== 'string' || !/^[A-Za-z0-9._-]+\.json$/.test(p.arquivo) || p.arquivo === 'aceite.json') {
      throw new Recusa('release.noctum.aceite-invalido', `o piloto ${id} precisa apontar um arquivo .json da pasta ${PASTA}`);
    }
    const caminho = path.join(raiz, PASTA, p.arquivo);
    if (!fs.existsSync(caminho)) throw new Recusa('release.noctum.piloto-faltando', `o arquivo ${p.arquivo} do piloto ${id} não existe em ${PASTA}`);
    const bytes = fs.readFileSync(caminho);
    const real = createHash('sha256').update(bytes).digest('hex');
    if (p.sha256 !== real) throw new Recusa('release.noctum.sha256-diverge', `o sha256 do piloto ${id} no aceite não bate com ${p.arquivo} (${real.slice(0, 12)})`);
    let r;
    try { r = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Recusa('release.noctum.aceite-invalido', `${p.arquivo} não é JSON`); }
    if (!objeto(r) || r.contrato !== CONTRATO_PILOTO || r.publicavel !== true) {
      throw new Recusa('release.noctum.aceite-invalido', `${p.arquivo} não é o aceite publicável do piloto (${CONTRATO_PILOTO}, gerado por ork noctum aceite --publicar)`);
    }
    if (p.simulado !== false || !objeto(r.simulacao) || r.simulacao.simulado !== false) {
      throw new Recusa('release.noctum.piloto-simulado', `o piloto ${id} é simulado: o ensaio nunca vale como piloto`);
    }
    if (p.veredito !== 'aprovado' || r.veredito !== 'aprovado') {
      throw new Recusa('release.noctum.piloto-nao-aprovado', `o piloto ${id} tem o veredito ${String(r.veredito)}, e não aprovado`);
    }
  }
  const rat = aceite.ratificacao;
  if (!objeto(rat) || typeof rat.por !== 'string' || !rat.por.trim() || typeof rat.recibo !== 'string' || !rat.recibo.trim() ||
    typeof rat.em !== 'string' || !Number.isFinite(Date.parse(rat.em))) {
    throw new Recusa('release.noctum.sem-ratificacao', 'falta a ratificação do dono: quem (por), a referência do recibo do ingresso tipado (recibo) e quando (em)');
  }
  return { pilotos: PILOTOS_EXIGIDOS, por: rat.por };
}

/** Os arquivos de texto do produto que o modo `--texto` lê. */
function arquivosDoTexto(raiz) {
  const saida = DO_TEXTO.filter((x) => fs.existsSync(path.join(raiz, x)));
  const evidencias = path.join('docs', 'roadmap', 'evidencias') + path.sep;
  const andar = (rel) => {
    for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
      const filho = path.join(rel, e.name);
      if ((filho + path.sep).startsWith(evidencias)) continue;
      if (e.isDirectory()) andar(filho);
      else if (e.isFile() && e.name.endsWith('.md')) saida.push(filho);
    }
  };
  if (fs.existsSync(path.join(raiz, 'docs'))) andar('docs');
  return saida;
}

/** As afirmações sem negação na mesma oração: `arquivo:linha: trecho`. */
function afirmacoes(raiz) {
  const achados = [];
  for (const rel of arquivosDoTexto(raiz)) {
    const texto = fs.readFileSync(path.join(raiz, rel), 'utf8');
    for (const re of [AFIRMACAO_PT, AFIRMACAO_EN]) {
      re.lastIndex = 0;
      for (let m = re.exec(texto); m; m = re.exec(texto)) {
        const inicio = Math.max(texto.lastIndexOf('\n', m.index), ...['.', '!', '?', ';'].map((p) => texto.lastIndexOf(p, m.index))) + 1;
        const fins = ['\n', '.', '!', '?', ';'].map((p) => texto.indexOf(p, m.index + m[0].length)).filter((x) => x >= 0);
        const oracao = texto.slice(inicio, fins.length ? Math.min(...fins) : texto.length);
        if (NEGACAO.test(oracao)) continue;
        const linha = texto.slice(0, m.index).split('\n').length;
        achados.push(`${rel.split(path.sep).join('/')}:${linha}: ${m[0]}`);
      }
    }
  }
  return achados;
}

function main(argv) {
  const texto = argv.includes('--texto');
  const resto = argv.filter((x) => x !== '--texto');
  if (resto.some((x) => x.startsWith('-')) || resto.length > 1) {
    process.stderr.write('uso: node core/scripts/checar-release-noctum.cjs [--texto] [raiz]\n');
    return 2;
  }
  const raiz = path.resolve(resto[0] ?? path.join(__dirname, '..', '..'));
  let aceite = null, recusa = null;
  try { aceite = conferirAceite(raiz); }
  catch (e) { if (!(e instanceof Recusa)) throw e; recusa = e; }
  if (!texto) {
    if (recusa) { process.stderr.write(`${recusa.message}\n`); return 1; }
    process.stdout.write(`release.noctum: o aceite confere: pilotos ${aceite.pilotos.join(', ')} aprovados, ratificados por ${aceite.por}\n`);
    return 0;
  }
  if (aceite) { process.stdout.write('release.noctum: o aceite confere, e o texto pode anunciar o #Noctum\n'); return 0; }
  const achados = afirmacoes(raiz);
  if (achados.length) {
    process.stderr.write(`release.noctum.texto-sem-aceite: ${achados.length} trecho(s) anunciam o #Noctum sem o aceite dos pilotos ` +
      `(${recusa.motivo}); diga o que é verdade hoje (ainda não validado) ou espere o aceite:\n${achados.map((x) => `  ${x}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write('release.noctum: nenhum texto anuncia o #Noctum como lançado, entregue, validado ou disponível\n');
  return 0;
}

process.exitCode = main(process.argv.slice(2));

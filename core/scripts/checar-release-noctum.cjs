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
 * Cada piloto exigido tem o arquivo, o sha256 e o arco dele, distintos dos outros, e a janela de ao menos as horas do plano
 * (`HORAS_MINIMAS`): o mesmo piloto não vale por quatro.
 *
 * Com `--texto`, no job de documentação: procura em `README.md`, `README.pt-BR.md`, `CHANGELOG.md` e nos `.md` de `docs/`
 * (fora `docs/roadmap/evidencias/`), de `adapters/` e de `core/assets/` a forma que anuncia o #Noctum como lançado,
 * entregue, validado ou disponível, em pt-BR e em inglês, com até duas palavras entre o nome, o verbo e o particípio (o
 * advérbio: "já foi validado", "is now available"); só a negação antes do particípio, na mesma oração, libera. Com o aceite
 * válido, o texto passa.
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
/** As horas mínimas da janela de cada piloto, as do plano. */
const HORAS_MINIMAS = { P1: 6, P2: 12, P3: 6, P4: 12 };
const DO_TEXTO = ['README.md', 'README.pt-BR.md', 'CHANGELOG.md'];
/** As pastas cujos `.md` o `--texto` lê; a evidência dos pilotos fica de fora. */
const PASTAS_DO_TEXTO = ['docs', 'adapters', path.join('core', 'assets')];
/** Até duas palavras entre o nome, o verbo e o particípio: o advérbio ("já foi validado", "is now available"). */
const ENTRE = '(?:\\s+[\\p{L}-]+){0,2}?\\s+';
/** Em pt-BR: foi, está ou é com lançado, entregue, validado ou disponível. */
const AFIRMACAO_PT = new RegExp(`#?Noctum${ENTRE}(?:foi|está|é)${ENTRE}(?:lançad[oa]s?|entregues?|validad[oa]s?|disponíve(?:l|is))(?![\\p{L}\\p{N}])`, 'giu');
/** Em inglês: is, was ou has been com released, shipped, validated, launched ou available. */
const AFIRMACAO_EN = new RegExp(`#?Noctum${ENTRE}(?:is|was|has\\s+been)${ENTRE}(?:released|shipped|validated|launched|available)(?![\\p{L}\\p{N}])`, 'giu');
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
  const vistos = { arquivo: new Map(), sha256: new Map(), arco: new Map() };
  const repetido = (campo, valor, id) => {
    const outro = vistos[campo].get(valor);
    if (outro) throw new Recusa('release.noctum.piloto-repetido', `os pilotos ${outro} e ${id} têm o mesmo ${campo} (${String(valor).slice(0, 40)}): cada piloto vale uma vez`);
    vistos[campo].set(valor, id);
  };
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
    repetido('arquivo', p.arquivo, id);
    repetido('sha256', real, id);
    repetido('arco', r.arco, id);
    const horas = objeto(r.janela) && typeof r.janela.horas === 'number' ? r.janela.horas : null;
    if (horas === null || horas < HORAS_MINIMAS[id]) {
      throw new Recusa('release.noctum.piloto-curto', `o piloto ${id} pede ao menos ${HORAS_MINIMAS[id]} h de janela, e o arquivo ${p.arquivo} diz ${horas ?? 'nenhuma'}`);
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
  for (const pasta of PASTAS_DO_TEXTO) if (fs.existsSync(path.join(raiz, pasta))) andar(pasta);
  return saida;
}

/** As afirmações sem negação antes do particípio, na mesma oração: `arquivo:linha: trecho`. */
function afirmacoes(raiz) {
  const achados = [];
  for (const rel of arquivosDoTexto(raiz)) {
    const texto = fs.readFileSync(path.join(raiz, rel), 'utf8');
    for (const re of [AFIRMACAO_PT, AFIRMACAO_EN]) {
      re.lastIndex = 0;
      for (let m = re.exec(texto); m; m = re.exec(texto)) {
        // Só a negação que vem antes do particípio, na mesma oração, desdiz o anúncio ("ainda não foi validado"); a que vem
        // depois ("foi validado sem nenhuma falha", "released, not just announced") não.
        const inicio = Math.max(texto.lastIndexOf('\n', m.index), ...['.', '!', '?', ';'].map((p) => texto.lastIndexOf(p, m.index))) + 1;
        if (NEGACAO.test(texto.slice(inicio, m.index + m[0].length))) continue;
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

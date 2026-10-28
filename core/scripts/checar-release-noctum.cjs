#!/usr/bin/env node
/**
 * RM-058, integração (T9 da ork-rm058integra, D13): o portão de release do #Noctum.
 *
 * A regra do dono: só a versão que anuncia o #Noctum exige a validação por pilotos reais. Na tag, o job que publica roda
 * este checador antes do `npm publish`: ele lê `docs/roadmap/evidencias/RM-058/aceite.json` (contrato
 * `ork.noctum-aceite/v1`) e confere cada piloto exigido (o arquivo publicável na mesma pasta, o sha256 dele, `simulado:
 * false` sem marcas e o veredito `aprovado`) e a ratificação do dono, com a referência do recibo do ingresso tipado e a
 * data, que não vem antes do fim do último piloto. Sem aceite, a tag aplica a mesma leitura do modo `--texto`: a versão
 * passa se não anuncia o #Noctum e para com os trechos se anuncia. Para a próxima versão que o anunciar, o item 10 exige
 * somente o primeiro piloto real (`PILOTOS_EXIGIDOS`).
 *
 * Cada piloto exigido tem o arquivo, o sha256 e o arco dele (sem espaço nem caixa), distintos dos outros, e a janela de ao menos as horas do plano
 * (`HORAS_MINIMAS`): o mesmo piloto não vale por quatro.
 *
 * Com `--texto`, no job de documentação: procura em `README.md`, `README.pt-BR.md`, `CHANGELOG.md`, `core/README.md` (o do
 * pacote), nos `.md` de `docs/` (fora `docs/roadmap/evidencias/`), de `adapters/` e de `core/assets/`, e nos `.md` e `.json`
 * de `marketplaces/` a forma que anuncia o #Noctum como lançado, entregue, validado ou disponível, em pt-BR e em inglês: o
 * nome com N maiúsculo (o comando `ork noctum` não é o produto), com ou sem a marcação e o link do Markdown (inline, com
 * título ou por referência), e até duas palavras entre ele, o verbo e o particípio (o advérbio: "já foi validado", "is now
 * available"), ou um inciso entre vírgulas (", enfim,"), em qualquer caixa ("## #Noctum Is Now Available"). Só libera a
 * negação entre o nome e o particípio ("ainda não foi validado") ou logo antes do nome, na mesma linha ("nem o #Noctum
 * está"); a de longe ("Não é segredo: o #Noctum foi validado"), a de depois, "não só", "não somente" e "não apenas" não.
 * Com o aceite válido, o texto passa.
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
/** Item 8, decisão do dono em 25/10/2026, resposta "12 a": só a versão que anuncia; 'toda-versao' volta por decisão futura dele. */
const ALCANCE = 'versao-que-anuncia';
/** Item 10, decisão do dono em 24/10/2026, alternativa iv.a: só P1; P2, P3 e P4 voltam a ser exigidos por decisão futura dele. */
const PILOTOS_EXIGIDOS = ['P1'];
/** As horas mínimas da janela de cada piloto, as do plano. */
const HORAS_MINIMAS = { P1: 6, P2: 12, P3: 6, P4: 12 };
/** O bloco B prepara P3 e P4 em duas máquinas; P1 e P2 continuam pilotos de uma máquina. */
const MAQUINAS_MINIMAS = { P1: 1, P2: 1, P3: 2, P4: 2 };
/** Os arquivos de texto público da raiz e do pacote. */
const DO_TEXTO = ['README.md', 'README.pt-BR.md', 'CHANGELOG.md', path.join('core', 'README.md')];
/** As pastas que o `--texto` lê e as extensões de cada uma; a evidência dos pilotos fica de fora. */
const PASTAS_DO_TEXTO = [['docs', ['.md']], ['adapters', ['.md']], [path.join('core', 'assets'), ['.md']], ['marketplaces', ['.md', '.json']]];
/** O separador das palavras: espaço, quebra de linha, parênteses e a marcação do Markdown (`**#Noctum**`, `` `#Noctum` ``). */
const SEP = '[\\s()*_`]+';
/**
 * Até duas palavras entre o nome, o verbo e o particípio (o advérbio: "já foi validado", "is now available"), ou um inciso
 * entre vírgulas (", enfim,"). A vírgula sozinha não liga o nome ao verbo: "No #Noctum, o relatório está disponível" passa.
 */
const ENTRE = `(?:(?:${SEP}[\\p{L}-]+){0,2}?${SEP}|[*_\`]*,\\s*[\\p{L}-]+(?:\\s+[\\p{L}-]+)?\\s*,\\s*)`;
/**
 * O nome e o link do Markdown logo depois: o inline, também com título (`[#Noctum](... "título")`), e o por referência
 * (`[#Noctum][x]`). O N maiúsculo do nome é conferido em `afirmacoes`, porque o resto da frase não distingue caixa.
 */
const NOME = '#?Noctum(?:\\]\\([^)\\n]*\\)|\\]\\[[^\\]\\n]*\\])?';
/**
 * Em pt-BR: foi, foram, está ou estão com lançado, entregue, validado, disponibilizado ou disponível, e é ou são com
 * lançado. "É entregue às 07:00" e "é validado pelo núcleo" descrevem, e passam. Sem distinção de caixa, como o título em
 * Title Case ("## #Noctum Foi Lançado").
 */
const AFIRMACAO_PT = new RegExp(`${NOME}${ENTRE}(?:(?:foi|foram|está|estão)${ENTRE}(?:lançad[oa]s?|entregues?|validad[oa]s?|disponibilizad[oa]s?|` +
  `disponíve(?:l|is))|(?:é|são)${ENTRE}lançad[oa]s?)(?![\\p{L}\\p{N}])`, 'giu');
/**
 * Em inglês: is, are, was, were, has been ou have been com released, shipped, validated, launched ou available, e has ou have
 * com shipped, launched ou released ("has shipped"). Sem distinção de caixa ("## #Noctum Is Now Available").
 */
const AFIRMACAO_EN = new RegExp(`${NOME}${ENTRE}(?:(?:is|are|was|were|ha(?:s|ve)\\s+been)${ENTRE}(?:released|shipped|validated|launched|available)|` +
  `ha(?:s|ve)${ENTRE}(?:shipped|launched|released))(?![\\p{L}\\p{N}])`, 'giu');
/**
 * A negação do verbo, entre o nome e o particípio. "Sem" fica de fora ("sem custo extra, já está disponível" anuncia), e
 * "não só", "não somente", "não apenas", "not only" e "not just" também.
 */
const NEGACAO = /(?<![\p{L}\p{N}])(?:não(?![ \t]+(?:só|somente|apenas)(?![\p{L}\p{N}]))|nem|nunca|not(?![ \t]+(?:only|just)(?![\p{L}\p{N}]))|never|yet\s+to)(?![\p{L}\p{N}])/iu;
/** O nome do produto, com N maiúsculo, no começo do trecho: o comando `ork noctum` não é o produto. */
const NOME_DO_PRODUTO = /^#?N/u;
/** A negação logo antes do nome, na mesma linha, quando muito com o artigo: "nem o #Noctum está disponível". */
const NEGACAO_ANTES = /(?<![\p{L}\p{N}])(?:não|nem|nunca|not|nor|never)[ \t]+(?:(?:o|a|the)[ \t]+)?[*_`\[]*$/iu;

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
  let fimDosPilotos = -Infinity;
  const idsInformados = aceite.pilotos.filter(objeto).map((p) => p.id).filter((id) => Object.hasOwn(HORAS_MINIMAS, id));
  for (const id of [...new Set([...PILOTOS_EXIGIDOS, ...idsInformados])]) {
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
    const minimoDeMaquinas = MAQUINAS_MINIMAS[id];
    const maquinas = Array.isArray(r.maquinas) ? r.maquinas : [];
    const contratoDoEnvelope = objeto(r.envelope) ? r.envelope.contrato : null;
    if (maquinas.length < minimoDeMaquinas || (minimoDeMaquinas > 1 && contratoDoEnvelope !== 'ork.noctum-envelope/v3')) {
      throw new Recusa('release.noctum.piloto-sem-maquinas', `o piloto ${id} exige ${minimoDeMaquinas} máquina(s)` +
        `${minimoDeMaquinas > 1 ? ' e envelope ork.noctum-envelope/v3' : ''}; ${p.arquivo} traz ${maquinas.length} e ${String(contratoDoEnvelope)}`);
    }
    // M2 do CHECK 4: as marcas da simulação também, e não só o booleano.
    if (p.simulado !== false || !objeto(r.simulacao) || r.simulacao.simulado !== false || !Array.isArray(r.simulacao.marcas) || r.simulacao.marcas.length) {
      throw new Recusa('release.noctum.piloto-simulado', `o piloto ${id} é simulado: o ensaio nunca vale como piloto`);
    }
    if (p.veredito !== 'aprovado' || r.veredito !== 'aprovado') {
      throw new Recusa('release.noctum.piloto-nao-aprovado', `o piloto ${id} tem o veredito ${String(r.veredito)}, e não aprovado`);
    }
    // M2 do CHECK 4: o arco sem espaço nem caixa diferente, para "arco-1 " não contar como outro piloto.
    if (typeof r.arco !== 'string' || !r.arco.trim()) throw new Recusa('release.noctum.aceite-invalido', `${p.arquivo} não diz o arco do piloto ${id}`);
    repetido('arquivo', p.arquivo, id);
    repetido('sha256', real, id);
    repetido('arco', r.arco.trim().toLowerCase(), id);
    const fimDoPiloto = Date.parse(objeto(r.encerramento) && typeof r.encerramento.em === 'string' ? r.encerramento.em
      : objeto(r.janela) && typeof r.janela.fim === 'string' ? r.janela.fim : '');
    if (!Number.isFinite(fimDoPiloto)) throw new Recusa('release.noctum.aceite-invalido', `${p.arquivo} não diz quando o piloto ${id} acabou (janela.fim)`);
    fimDosPilotos = Math.max(fimDosPilotos, fimDoPiloto);
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
  // M2 do CHECK 4: o dono ratifica o que os pilotos mostraram, e não antes de o último acabar.
  if (Date.parse(rat.em) < fimDosPilotos) {
    throw new Recusa('release.noctum.sem-ratificacao', `a ratificação (${rat.em}) é anterior ao fim dos pilotos (${new Date(fimDosPilotos).toISOString()})`);
  }
  return { pilotos: PILOTOS_EXIGIDOS, por: rat.por };
}

/** Os arquivos de texto do produto que o modo `--texto` lê. */
function arquivosDoTexto(raiz) {
  const saida = DO_TEXTO.filter((x) => fs.existsSync(path.join(raiz, x)));
  const evidencias = path.join('docs', 'roadmap', 'evidencias') + path.sep;
  const andar = (rel, extensoes) => {
    for (const e of fs.readdirSync(path.join(raiz, rel), { withFileTypes: true })) {
      const filho = path.join(rel, e.name);
      if ((filho + path.sep).startsWith(evidencias)) continue;
      if (e.isDirectory()) andar(filho, extensoes);
      else if (e.isFile() && extensoes.includes(path.extname(e.name))) saida.push(filho);
    }
  };
  for (const [pasta, extensoes] of PASTAS_DO_TEXTO) if (fs.existsSync(path.join(raiz, pasta))) andar(pasta, extensoes);
  return saida;
}

/** As afirmações sem a negação do verbo: `arquivo:linha: trecho`. */
function afirmacoes(raiz) {
  const achados = [];
  for (const rel of arquivosDoTexto(raiz)) {
    const texto = fs.readFileSync(path.join(raiz, rel), 'utf8');
    for (const re of [AFIRMACAO_PT, AFIRMACAO_EN]) {
      re.lastIndex = 0;
      for (let m = re.exec(texto); m; m = re.exec(texto)) {
        // I1 do CHECK 4: a frase não distingue caixa, e o nome sim. O trecho do `ork noctum` volta a busca uma letra adiante,
        // para o nome com N maiúsculo que vier dentro dele.
        if (!NOME_DO_PRODUTO.test(m[0])) { re.lastIndex = m.index + 1; continue; }
        // Só a negação entre o nome e o particípio ("ainda não foi validado") ou logo antes do nome ("nem o #Noctum está")
        // desdiz o anúncio. A de longe ("Não é segredo: o #Noctum foi validado", "Sem custo extra, o #Noctum já está") e a
        // de depois ("foi validado sem nenhuma falha", "released, not just announced") não.
        if (NEGACAO.test(m[0]) || NEGACAO_ANTES.test(texto.slice(Math.max(0, m.index - 40), m.index))) continue;
        const linha = texto.slice(0, m.index).split('\n').length;
        achados.push(`${rel.split(path.sep).join('/')}:${linha}: ${m[0]}`);
      }
    }
  }
  return achados;
}

/** Executa o contrato sem depender de processo filho; a CLI só transporta stdout, stderr e status. */
function executar(argv) {
  const texto = argv.includes('--texto');
  const resto = argv.filter((x) => x !== '--texto');
  if (resto.some((x) => x.startsWith('-')) || resto.length > 1) {
    return { status: 2, stdout: '', stderr: 'uso: node core/scripts/checar-release-noctum.cjs [--texto] [raiz]\n' };
  }
  const raiz = path.resolve(resto[0] ?? path.join(__dirname, '..', '..'));
  let aceite = null, recusa = null;
  try { aceite = conferirAceite(raiz); }
  catch (e) { if (!(e instanceof Recusa)) throw e; recusa = e; }
  if (!texto) {
    if (aceite) return { status: 0, stdout: `release.noctum: o aceite confere: pilotos ${aceite.pilotos.join(', ')} aprovados, ratificados por ${aceite.por}\n`, stderr: '' };
    // O alcance novo libera só a ausência de aceite. Um aceite presente mas inválido continua recusando a tag, para não
    // transformar uma prova quebrada numa declaração silenciosa de que a versão não anuncia o produto.
    if (recusa.motivo !== 'release.noctum.aceite-ausente') return { status: 1, stdout: '', stderr: `${recusa.message}\n` };
  }
  if (aceite) return { status: 0, stdout: 'release.noctum: o aceite confere, e o texto pode anunciar o #Noctum\n', stderr: '' };
  const achados = afirmacoes(raiz);
  if (achados.length) {
    return { status: 1, stdout: '', stderr: `release.noctum.texto-sem-aceite: ${achados.length} trecho(s) anunciam o #Noctum sem o aceite dos pilotos ` +
      `(${recusa.motivo}); diga o que é verdade hoje (ainda não validado) ou espere o aceite:\n${achados.map((x) => `  ${x}`).join('\n')}\n` };
  }
  return { status: 0, stdout: `release.noctum: nenhum texto anuncia o #Noctum como lançado, entregue, validado ou disponível${texto ? '' : '; a versão pode sair sem o aceite'}\n`, stderr: '' };
}

module.exports = { executar };
if (require.main === module) {
  const resultado = executar(process.argv.slice(2));
  process.stdout.write(resultado.stdout);
  process.stderr.write(resultado.stderr);
  process.exitCode = resultado.status;
}

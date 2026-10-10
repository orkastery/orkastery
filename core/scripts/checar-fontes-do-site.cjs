#!/usr/bin/env node
/**
 * RM-050: que pagina do site uma mudanca neste repositorio deixa para revisar.
 *
 * Os sites (orkastery.com e orkmind.com) montam a documentacao a partir de um catalogo:
 * `src/data/docs-catalog.ts` lista as paginas e as fontes de cada uma, e o snapshot
 * `src/data/docs-sources.json` guarda o SHA-256 de cada fonte, as paginas que a usam e a revisao
 * editorial de cada pagina por idioma. O build do site confere so o snapshot: a mudanca feita aqui
 * so aparece la com `npm run docs:check -- --source <clone>`, e sem dizer a pagina. Este script faz
 * a conta do lado do produto, contra um snapshot:
 *
 *  - fonte do snapshot com outro SHA-256 aqui: mudada, e cada pagina que a usa fica para revisar;
 *  - fonte do snapshot que nao existe aqui: removida (o site reprova fonte removida ainda citada);
 *  - arquivo do inventario que o snapshot nao tem: nova, ainda sem pagina (o site reprova fonte
 *    sem destino depois de sincronizar).
 *
 * O inventario espelha a funcao `inventory` de `scripts/check-docs.mjs` dos sites: os `.md` e
 * `.json` de `docs/`, mais os arquivos de raiz do produto. Se o site mudar a regra, vale a dele.
 *
 *   node core/scripts/checar-fontes-do-site.cjs --snapshot <docs-sources.json|-> [--raiz DIR]
 *        [--base REF] [--json]
 *
 * `--snapshot -` le da entrada padrao. `--base REF` restringe aos arquivos que a mudanca tocou desde
 * que saiu de REF (`git diff` a partir do merge-base com o HEAD, mais os arquivos novos fora do
 * indice): a pergunta de quem abre o PR, mesmo com a base andando depois.
 * Sai 0 com tudo em dia, 1 com fonte a revisar e 2 com erro de uso ou snapshot invalido.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const USO = 'uso: node core/scripts/checar-fontes-do-site.cjs --snapshot <docs-sources.json|-> [--raiz DIR] [--base REF] [--json]';

const sha256 = (dado) => crypto.createHash('sha256').update(dado).digest('hex');

/** Os arquivos de raiz que o site le, fora de `docs/`: a mesma escolha de `inventory`. */
function arquivosDeRaiz(produto) {
  return produto === 'orkastery'
    ? ['README.md', 'CONTRIBUTING.md', 'core/package.json']
    : ['README.md', 'README.pt-BR.md', 'CONTRIBUTING.md', 'pyproject.toml'];
}

/** O inventario do site sobre esta arvore: caminho relativo com `/` e SHA-256 do conteudo. */
function inventario(raiz, produto) {
  const arquivos = [];
  const andar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, e.name);
      if (e.isDirectory()) andar(completo);
      else if (e.isFile() && /\.(md|json)$/.test(e.name)) arquivos.push(completo);
    }
  };
  const docs = path.join(raiz, 'docs');
  if (fs.existsSync(docs)) andar(docs);
  for (const rel of arquivosDeRaiz(produto)) {
    if (fs.existsSync(path.join(raiz, rel))) arquivos.push(path.join(raiz, rel));
  }
  return arquivos
    .map((a) => path.relative(raiz, a).split(path.sep).join('/'))
    .sort()
    .map((caminho) => ({ caminho, sha256: sha256(fs.readFileSync(path.join(raiz, caminho))) }));
}

/** Confere a forma do snapshot e a integridade que o site confere (`inventoryHash`). */
function validarSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.sources)) {
    throw new Error('snapshot inválido: falta schemaVersion 1 ou a lista sources');
  }
  if (typeof snapshot.product !== 'string' || !snapshot.product) throw new Error('snapshot inválido: falta product');
  for (const s of snapshot.sources) {
    if (typeof s?.path !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256 ?? '')) {
      throw new Error(`snapshot inválido: fonte sem path ou sem sha256: ${JSON.stringify(s)}`);
    }
  }
  if (snapshot.inventoryHash !== undefined && sha256(JSON.stringify(snapshot.sources)) !== snapshot.inventoryHash) {
    throw new Error('snapshot inválido: o inventoryHash não confere com as fontes (arquivo editado à mão?)');
  }
}

/**
 * A comparacao inteira, sem rede e sem git. `arquivos`, quando vem, restringe o relatorio aos
 * caminhos dados (os de um diff). Devolve as fontes fora de dia e as paginas que elas tocam.
 */
function checarFontesDoSite(raiz, snapshot, opcoes = {}) {
  validarSnapshot(snapshot);
  const filtro = opcoes.arquivos ? new Set(opcoes.arquivos) : null;
  const entra = (caminho) => !filtro || filtro.has(caminho);
  const vivos = new Map(inventario(raiz, snapshot.product).map((f) => [f.caminho, f.sha256]));
  const noSnapshot = new Set(snapshot.sources.map((s) => s.path));
  const fontes = [];
  for (const s of snapshot.sources) {
    if (!entra(s.path)) continue;
    const vivo = vivos.get(s.path);
    if (vivo === s.sha256) continue;
    fontes.push({
      caminho: s.path,
      estado: vivo === undefined ? 'removida' : 'mudada',
      paginas: [...(s.targets ?? [])].sort(),
      tratamento: s.treatment ?? null,
    });
  }
  for (const caminho of vivos.keys()) {
    if (!noSnapshot.has(caminho) && entra(caminho)) fontes.push({ caminho, estado: 'nova', paginas: [], tratamento: null });
  }
  // Ordem por unidade de codigo, a mesma do inventario do site, e nao a da localidade de quem roda.
  fontes.sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  const porPagina = new Map();
  for (const f of fontes) {
    for (const p of f.paginas) porPagina.set(p, [...(porPagina.get(p) ?? []), f.caminho]);
  }
  return {
    produto: snapshot.product,
    fontesNoSnapshot: snapshot.sources.length,
    restrito: Boolean(filtro),
    emDia: fontes.length === 0,
    fontes,
    paginas: [...porPagina.keys()].sort().map((pagina) => ({ pagina, fontes: porPagina.get(pagina) })),
    semPagina: fontes.filter((f) => f.paginas.length === 0).map((f) => f.caminho),
  };
}

/**
 * Os arquivos da mudanca: o diff do ponto em que ela saiu de `base` (o merge-base com o HEAD) ate a
 * arvore de trabalho, mais os novos fora do indice. Contra a ponta da base, o que a base mudou depois
 * da partida entraria como se fosse da mudanca.
 */
function arquivosMudados(raiz, base) {
  const git = (...args) => spawnSync('git', ['-C', raiz, ...args], { encoding: 'utf8' });
  const ref = git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  if (ref.status !== 0) throw new Error(`--base ${base}: o git não conhece esse commit`);
  const partida = git('merge-base', ref.stdout.trim(), 'HEAD');
  if (partida.status !== 0) throw new Error(`--base ${base}: sem ponto em comum com o HEAD`);
  // Sem deteccao de renomeacao: o caminho antigo tambem entra, e a fonte removida aparece.
  const diff = git('diff', '--name-only', '--no-renames', '--relative', partida.stdout.trim());
  const novos = git('ls-files', '--others', '--exclude-standard');
  if (diff.status !== 0 || novos.status !== 0) throw new Error(`git falhou: ${(diff.stderr || novos.stderr).trim()}`);
  return {
    partida: partida.stdout.trim(),
    arquivos: [...diff.stdout.split('\n'), ...novos.stdout.split('\n')].map((l) => l.trim()).filter(Boolean),
  };
}

function relatorio(r, raiz) {
  const linhas = [`Fontes do site do produto ${r.produto}: ${r.fontesNoSnapshot} no snapshot, comparadas com ${raiz}`];
  if (r.base) linhas.push(`Só os arquivos mudados desde que a mudança saiu de ${r.base} (${r.partida.slice(0, 8)}).`);
  if (r.emDia) {
    linhas.push('Nenhuma fonte a revisar: o snapshot do site está em dia com estes arquivos.');
    return linhas.join('\n');
  }
  const marca = (caminho) => {
    const f = r.fontes.find((x) => x.caminho === caminho);
    const tratamento = f.tratamento && f.tratamento !== 'article' ? `  (tratamento ${f.tratamento})` : '';
    return `  ${f.estado.padEnd(9)}${caminho}${tratamento}`;
  };
  for (const { pagina, fontes } of r.paginas) linhas.push('', `${pagina} (${fontes.length})`, ...fontes.map(marca));
  if (r.semPagina.length) linhas.push('', `sem página (${r.semPagina.length})`, ...r.semPagina.map(marca));
  const contar = (estado) => r.fontes.filter((f) => f.estado === estado).length;
  linhas.push(
    '',
    `${r.paginas.length} página(s) a revisar, ${contar('mudada')} fonte(s) mudada(s), ${contar('nova')} nova(s), ${contar('removida')} removida(s).`,
  );
  if (r.paginas.length) linhas.push(`Páginas: ${r.paginas.map((p) => p.pagina).join(',')}`);
  linhas.push(
    'No repositório do site: npm run docs:sync -- --source <este checkout>, leia as fontes, revise PT, EN e ES',
    'de cada página e só então registre a revisão com --review pt,en,es e --articles com as páginas acima.',
  );
  return linhas.join('\n');
}

function lerArgs(argv) {
  const args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.ajuda = true;
    else if (['--snapshot', '--raiz', '--base'].includes(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} pede um valor`);
      args[a.slice(2)] = argv[++i];
    } else throw new Error(`opção desconhecida: ${a}`);
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = lerArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n${USO}`);
    return 2;
  }
  if (args.ajuda) {
    console.log(USO);
    return 0;
  }
  if (!args.snapshot) {
    console.error(`falta --snapshot\n${USO}`);
    return 2;
  }
  const raiz = path.resolve(args.raiz ?? path.join(__dirname, '..', '..'));
  try {
    const texto = args.snapshot === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.snapshot, 'utf8');
    let snapshot;
    try {
      snapshot = JSON.parse(texto);
    } catch {
      throw new Error(`snapshot inválido: ${args.snapshot} não é JSON`);
    }
    const mudanca = args.base ? arquivosMudados(raiz, args.base) : null;
    const r = {
      ...checarFontesDoSite(raiz, snapshot, { arquivos: mudanca?.arquivos }),
      ...(mudanca ? { base: args.base, partida: mudanca.partida } : {}),
    };
    console.log(args.json ? JSON.stringify(r, null, 2) : relatorio(r, raiz));
    return r.emDia ? 0 : 1;
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

module.exports = { checarFontesDoSite, inventario, validarSnapshot, arquivosMudados, main };

if (require.main === module) process.exitCode = main();

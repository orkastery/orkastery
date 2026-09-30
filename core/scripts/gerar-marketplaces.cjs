#!/usr/bin/env node
/**
 * Gera e confere o plugin do Orkastery para os marketplaces (RM-049).
 *
 * As pastas `marketplaces/claude-code/orkastery/` e `marketplaces/codex/orkastery/`, e os dois
 * marketplaces proprios da raiz, sao DERIVADOS: do catalogo unico (`skills/`, `references/`,
 * `adapters/claude-code/`, `adapters/codex/`), da marca (`docs/assets/marca/`) e das fontes de
 * listagem (`marketplaces/fontes/`). Ninguem edita a copia: edita a fonte e roda este script. O CI
 * roda `--verificar`, que falha quando a copia diverge do que a fonte gera, porque duas copias do
 * catalogo divergem e a divergencia so aparece quando ja custou uma entrega.
 *
 * O plugin dos marketplaces nao leva hooks nem MCP (D1 da thread ork-rm049marketp): instalado pelo
 * diretorio, ele vale para a conta inteira da pessoa, e o guard barraria comando em qualquer
 * repositorio dela. Guard e sensores continuam no `ork adapter install claude-code`, por projeto.
 *
 * Este arquivo nao tem texto de listagem: descricao, prompts e URLs moram em
 * `marketplaces/fontes/listagem.json`, e os READMEs em `marketplaces/fontes/<host>/`.
 *
 *   node core/scripts/gerar-marketplaces.cjs              escreve as pastas e os marketplaces
 *   node core/scripts/gerar-marketplaces.cjs --verificar  confere deriva e regras; sai != 0 com a lista
 *   [--raiz <dir>]                                        outra raiz (o teste usa uma copia)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Mesma ordem de `BUCKETS` em core/src/catalogo.ts: a ordem vira a ordem do manifesto. */
const BUCKETS = ['core', 'phases', 'reviewers', 'governance', 'observability'];
const DESTINOS = {
  claude: 'marketplaces/claude-code/orkastery',
  codex: 'marketplaces/codex/orkastery',
  marketplaceClaude: '.claude-plugin/marketplace.json',
  marketplaceCodex: '.agents/plugins/marketplace.json',
};
const FONTES = 'marketplaces/fontes';
/** Peca da marca -> caminho dentro da pasta do plugin. Link do README fonte para a peca e reescrito. */
const MARCA = {
  readme: ['docs/assets/marca/png/assinatura-com-fundo-1200.png', 'assets/orkastery.png'],
  logo: ['docs/assets/marca/png/simbolo-512.png', 'assets/logo.png'],
  // O icone pequeno tem o traco mais grosso, legivel em 16 e 32 px (docs/assets/marca/README.md).
  composer: ['docs/assets/marca/svg/icone-pequeno.svg', 'assets/composer-icon.svg'],
};
/** D1: o que o adaptador tem e o plugin dos marketplaces nao leva. */
const SEM_COPIA = ['hooks', '.mcp.json', '.lsp.json', 'bin', 'monitors'];
const REGENERAR = 'rode: node core/scripts/gerar-marketplaces.cjs';
const TIPOS = new Set(['.md', '.json', '.png', '.svg']);
const IMAGENS = new Set(['.png', '.svg']);
const SISTEMA = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX']);
const LIMITE_TEXTO = 256 * 1024;
const LIMITE_IMAGEM = 5 * 1024 * 1024;
const LIMITE_ARQUIVOS = 512;
const NOME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const NOME_DE_ARQUIVO = /^[A-Za-z0-9._-]+$/;
const RESERVADOS_WINDOWS = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const TRAVESSAO = String.fromCharCode(0x2014);
const INSTALACAO = new Set(['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT']);
const AUTENTICACAO = new Set(['ON_INSTALL', 'ON_USE']);
/** As contagens que o README de listagem afirma, conferidas contra a pasta gerada. */
const CONTAGENS = {
  claude: [
    ['README.md', /\| (\d+) skills \|/, (d) => contarSkills(d)],
    ['README.md', /\| (\d+) commands \|/, (d) => contarMd(d, 'commands')],
    ['README.md', /\| (\d+) subagents \|/, (d) => contarMd(d, 'agents')],
    ['README.md', /\| (\d+) checklists \|/, (d) => contarChecklists(d)],
    ['README.pt-BR.md', /\| (\d+) skills \|/, (d) => contarSkills(d)],
    ['README.pt-BR.md', /\| (\d+) comandos \|/, (d) => contarMd(d, 'commands')],
    ['README.pt-BR.md', /\| (\d+) subagentes \|/, (d) => contarMd(d, 'agents')],
    ['README.pt-BR.md', /\| (\d+) checklists \|/, (d) => contarChecklists(d)],
  ],
  codex: [
    ['README.md', /\| (\d+) catalog skills \|/, (d) => contarSkills(d) - 1],
    ['README.md', /\| (\d+) checklists \|/, (d) => contarChecklists(d)],
    ['README.pt-BR.md', /\| (\d+) skills do catálogo \|/, (d) => contarSkills(d) - 1],
    ['README.pt-BR.md', /\| (\d+) checklists \|/, (d) => contarChecklists(d)],
  ],
};

const posix = (p) => p.split(path.sep).join('/');
/** Enquanto `fontesDaGeracao` roda, cada arquivo lido fica anotado aqui. */
let leituras = null;
const ler = (raiz, rel) => {
  if (leituras) leituras.add(posix(rel));
  return fs.readFileSync(path.join(raiz, rel));
};
const lerJson = (raiz, rel) => JSON.parse(ler(raiz, rel).toString('utf8'));
const emJson = (obj) => Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');

/** A versao do plugin e a do @orkastery/cli (D3). */
function versao(raiz) {
  return lerJson(raiz, 'core/package.json').version;
}

function skillsDoCatalogo(raiz) {
  const achadas = [];
  for (const bucket of BUCKETS) {
    const dir = path.join(raiz, 'skills', bucket);
    if (!fs.existsSync(dir)) continue;
    for (const nome of fs.readdirSync(dir).sort()) {
      if (fs.existsSync(path.join(dir, nome, 'SKILL.md'))) achadas.push({ bucket, nome, rel: `skills/${bucket}/${nome}/SKILL.md` });
    }
  }
  return achadas;
}

function referenciasDoCatalogo(raiz) {
  const dir = path.join(raiz, 'references');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((a) => a.endsWith('.md')).sort().map((a) => `references/${a}`);
}

function mdDe(raiz, dir) {
  return fs.readdirSync(path.join(raiz, dir)).filter((a) => a.endsWith('.md')).sort().map((a) => `${dir}/${a}`);
}

/** Troca, no README fonte, o link para a peca da marca pelo caminho dentro da pasta do plugin. */
function readme(raiz, rel) {
  const deFonte = path.posix.dirname(rel);
  let texto = ler(raiz, rel).toString('utf8');
  for (const [origem, destino] of Object.values(MARCA)) {
    texto = texto.split(`(${path.posix.relative(deFonte, origem)})`).join(`(${destino})`);
  }
  return Buffer.from(texto, 'utf8');
}

/**
 * O que as fontes geram, como mapa caminho relativo a raiz -> conteudo. Puro: nao escreve nada.
 * `--verificar` compara este mapa com o disco; a escrita grava este mapa.
 */
function gerar(raiz) {
  const L = lerJson(raiz, `${FONTES}/listagem.json`);
  const v = versao(raiz);
  const skills = skillsDoCatalogo(raiz);
  const refs = referenciasDoCatalogo(raiz);
  const saida = new Map();
  const poe = (rel, conteudo) => saida.set(rel, Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8'));
  const autor = { name: L.autor.name, url: L.autor.url };

  // Claude Code: o manifesto do adaptador, com versao, textos da listagem e sem os componentes executaveis.
  const tpl = lerJson(raiz, 'adapters/claude-code/.claude-plugin/plugin.json');
  const C = DESTINOS.claude;
  poe(`${C}/.claude-plugin/plugin.json`, emJson({
    name: tpl.name,
    displayName: L.claude.displayName,
    description: L.claude.description,
    version: v,
    author: autor,
    homepage: L.homepage,
    repository: L.repository,
    license: tpl.license,
    keywords: L.keywords,
    skills: skills.map((s) => `./skills/${s.bucket}/${s.nome}`),
  }));
  for (const s of skills) poe(`${C}/${s.rel}`, ler(raiz, s.rel));
  for (const r of refs) poe(`${C}/${r}`, ler(raiz, r));
  for (const dir of ['commands', 'agents']) {
    for (const rel of mdDe(raiz, `adapters/claude-code/${dir}`)) poe(`${C}/${dir}/${path.posix.basename(rel)}`, ler(raiz, rel));
  }
  poe(`${C}/README.md`, readme(raiz, `${FONTES}/claude-code/README.md`));
  poe(`${C}/README.pt-BR.md`, readme(raiz, `${FONTES}/claude-code/README.pt-BR.md`));
  poe(`${C}/LICENSE`, ler(raiz, 'LICENSE'));
  poe(`${C}/${MARCA.readme[1]}`, ler(raiz, MARCA.readme[0]));

  // Codex: plugin de skills, com a entrada $ork renderizada para o ork do PATH (sem instalador, sem caminho).
  const X = DESTINOS.codex;
  poe(`${X}/.codex-plugin/plugin.json`, emJson({
    name: tpl.name,
    version: v,
    description: L.codex.description,
    author: autor,
    homepage: L.homepage,
    repository: L.repository,
    license: tpl.license,
    keywords: L.keywords,
    skills: './skills/',
    interface: {
      ...L.codex.interface,
      composerIcon: `./${MARCA.composer[1]}`,
      logo: `./${MARCA.logo[1]}`,
      screenshots: [],
    },
  }));
  const entrada = ler(raiz, 'adapters/codex/skills/ork/SKILL.md').toString('utf8').replace(/\{\{ork_bin\}\}/g, 'ork');
  poe(`${X}/skills/ork/SKILL.md`, entrada);
  for (const s of skills) poe(`${X}/${s.rel}`, ler(raiz, s.rel));
  for (const r of refs) poe(`${X}/${r}`, ler(raiz, r));
  poe(`${X}/README.md`, readme(raiz, `${FONTES}/codex/README.md`));
  poe(`${X}/README.pt-BR.md`, readme(raiz, `${FONTES}/codex/README.pt-BR.md`));
  poe(`${X}/LICENSE`, ler(raiz, 'LICENSE'));
  for (const [origem, destino] of Object.values(MARCA)) poe(`${X}/${destino}`, ler(raiz, origem));

  // Marketplaces proprios da raiz (H1 A): instalar sem esperar a revisao dos diretorios.
  poe(DESTINOS.marketplaceClaude, emJson({
    $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: L.marketplace.name,
    description: L.marketplace.description,
    owner: autor,
    plugins: [{
      name: tpl.name,
      source: `./${C}`,
      description: L.claude.description,
      category: L.claude.category,
      homepage: L.homepage,
    }],
  }));
  poe(DESTINOS.marketplaceCodex, emJson({
    name: L.marketplace.name,
    interface: { displayName: L.marketplace.displayName },
    plugins: [{
      name: tpl.name,
      source: { source: 'local', path: `./${X}` },
      policy: L.codex.policy,
      category: L.codex.interface.category,
    }],
  }));
  return saida;
}

function listar(dir, prefixo = '') {
  const achados = [];
  if (!fs.existsSync(dir)) return achados;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isSymbolicLink()) achados.push({ rel, link: true });
    else if (e.isDirectory()) achados.push({ rel, dir: true }, ...listar(path.join(dir, e.name), rel));
    else achados.push({ rel });
  }
  return achados;
}

const achado = (codigo, arquivo, detalhe) => ({ codigo, arquivo: posix(arquivo), detalhe });

/** Frontmatter de um .md: o bloco entre as duas primeiras linhas `---`, ou null. CRLF vira LF antes. */
function frontmatter(texto) {
  const t = texto.replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return null;
  const fim = t.indexOf('\n---', 4);
  return fim < 0 ? null : t.slice(4, fim);
}

/** Escapes aceitos em escalar YAML entre aspas duplas. */
const ESCAPES_YAML = new Set(['0', 'a', 'b', 't', '\t', 'n', 'v', 'f', 'r', 'e', ' ', '"', '/', '\\', 'N', '_', 'L', 'P', 'x', 'u', 'U']);
/** Escalar simples que o YAML le como numero, booleano ou nulo, e nao como texto. */
const NAO_TEXTO = /^(?:[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|true|false|null|~|yes|no|on|off)$/i;

/** O fim de um escalar entre aspas que comeca em v[0], ou um problema. */
function fimDasAspas(v) {
  const aspa = v[0];
  for (let i = 1; i < v.length; i++) {
    if (aspa === '"' && v[i] === '\\') {
      if (!ESCAPES_YAML.has(v[i + 1])) return { problema: `escape invalido \\${v[i + 1] ?? ''}` };
      i++;
      continue;
    }
    if (v[i] !== aspa) continue;
    if (aspa === "'" && v[i + 1] === "'") { i++; continue; }
    const resto = v.slice(i + 1);
    if (resto.trim() && !/^\s+#/.test(resto)) return { problema: 'texto depois das aspas' };
    return { fim: i };
  }
  return { problema: aspa === '"' ? 'aspas duplas sem fechar' : 'aspas simples sem fechar' };
}

/** O texto de um valor de topo, ou null quando o YAML o le como outra coisa (numero, lista, mapa). */
function textoDoValor(v) {
  if (v.startsWith('"') || v.startsWith("'")) return v.slice(1, fimDasAspas(v).fim);
  if (/^[[{]/.test(v) || NAO_TEXTO.test(v)) return null;
  return v;
}

/**
 * Subconjunto conservador do YAML que o portal le. Cada linha de topo e `chave: valor`, sem tab na
 * indentacao e sem chave repetida; valor entre aspas fecha e so usa escape valido; valor simples nao
 * tem `:` seguido de espaco ou fim, nem ` #`, nem comeca por indicador. A `description` precisa ser
 * texto de ate 1024 caracteres. Foi o defeito real de sete arquivos do adaptador, que o Claude Code
 * lia e o portal da Anthropic bloqueia.
 */
function problemaDoFrontmatter(bloco) {
  const chaves = new Set();
  let descricao = null;
  for (const linha of bloco.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*\t/.test(linha)) return 'indentacao com tab';
    if (!linha.trim() || /^\s/.test(linha) || /^#/.test(linha)) continue;
    const m = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(linha);
    if (!m) return `linha que nao e chave: valor (${linha.slice(0, 40)})`;
    if (chaves.has(m[1])) return `chave repetida ${m[1]}`;
    chaves.add(m[1]);
    const valor = (m[2] ?? '').trim();
    if (valor.startsWith('"') || valor.startsWith("'")) {
      const r = fimDasAspas(valor);
      if (r.problema) return `${m[1]}: ${r.problema}`;
    } else if (valor && !/^[[{|>]/.test(valor) && (/:(?:\s|$)/.test(valor) || /\s#/.test(valor) || /^[-?:,\]}#&*!%@`]/.test(valor))) {
      return `valor sem aspas com caractere de YAML em ${m[1]} (use aspas duplas)`;
    }
    if (m[1] === 'description') descricao = valor;
  }
  if (descricao === null) return 'description ausente';
  const texto = textoDoValor(descricao);
  if (texto === null) return 'description precisa ser texto';
  if (!texto.trim()) return 'description vazia';
  if ([...texto].length > 1024) return 'description acima de 1024 caracteres';
  return null;
}

/** O valor de texto de uma chave de topo do frontmatter, ou null. */
function valorDoFrontmatter(bloco, chave) {
  const m = new RegExp(`^${chave}:\\s+(.*)$`, 'm').exec(bloco.replace(/\r\n/g, '\n'));
  return m ? textoDoValor(m[1].trim()) : null;
}

function palavrasForaDeCodigo(texto) {
  const semCodigo = texto.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  return (semCodigo.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).length;
}

function contarSkills(dir) {
  return listar(path.join(dir, 'skills')).filter((a) => !a.dir && a.rel.endsWith('/SKILL.md')).length;
}
function contarMd(dir, sub) {
  return listar(path.join(dir, sub)).filter((a) => !a.dir && a.rel.endsWith('.md')).length;
}
function contarChecklists(dir) {
  return listar(path.join(dir, 'references')).filter((a) => !a.dir && a.rel.endsWith('.md') && a.rel !== 'README.md').length;
}

/** Regras que valem para as duas pastas: arquivos, tamanhos, README, licenca, frontmatter, travessao. */
function conferirArquivos(dir, rotulo) {
  const achados = [];
  const todos = listar(dir);
  const arquivos = todos.filter((a) => !a.dir && !a.link);
  if (arquivos.length > LIMITE_ARQUIVOS) achados.push(achado('arquivo.quantidade', rotulo, `${arquivos.length} arquivos, limite ${LIMITE_ARQUIVOS}`));
  const porCaixa = new Map();
  for (const a of todos) {
    const chave = a.rel.toLowerCase();
    if (porCaixa.has(chave)) achados.push(achado('arquivo.nome', `${rotulo}/${a.rel}`, `difere de ${porCaixa.get(chave)} so pela caixa`));
    else porCaixa.set(chave, a.rel);
  }
  for (const a of todos) {
    const base = path.posix.basename(a.rel);
    if (a.link) achados.push(achado('arquivo.link', `${rotulo}/${a.rel}`, 'symlink nao entra no pacote'));
    if (SISTEMA.has(base)) achados.push(achado('arquivo.sistema', `${rotulo}/${a.rel}`, 'arquivo de sistema operacional'));
    if (!NOME_DE_ARQUIVO.test(base)) achados.push(achado('arquivo.nome', `${rotulo}/${a.rel}`, 'nome fora de letras, digitos, ponto, hifen e sublinhado'));
    if (/[. ]$/.test(base) || RESERVADOS_WINDOWS.test(base)) achados.push(achado('arquivo.nome', `${rotulo}/${a.rel}`, 'nome invalido no Windows'));
    if (!a.rel.includes('/') && SEM_COPIA.includes(base)) achados.push(achado('componente.executavel', `${rotulo}/${a.rel}`, 'o plugin dos marketplaces nao leva hooks, MCP, LSP, bin nem monitors (D1)'));
  }
  for (const a of arquivos) {
    const ext = path.posix.extname(a.rel);
    const alvo = path.join(dir, a.rel);
    const tamanho = fs.statSync(alvo).size;
    if (a.rel !== 'LICENSE' && !TIPOS.has(ext)) achados.push(achado('arquivo.tipo', `${rotulo}/${a.rel}`, `tipo ${ext || 'sem extensao'} fora de .md, .json, .png e .svg`));
    const limite = IMAGENS.has(ext) ? LIMITE_IMAGEM : LIMITE_TEXTO;
    if (tamanho > limite) achados.push(achado('arquivo.grande', `${rotulo}/${a.rel}`, `${tamanho} bytes, limite ${limite}`));
    if (ext === '.png' && !fs.readFileSync(alvo).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      achados.push(achado('arquivo.tipo', `${rotulo}/${a.rel}`, 'extensao .png sem assinatura PNG'));
    }
    if (ext === '.md' || ext === '.json' || ext === '.svg' || a.rel === 'LICENSE') {
      if (fs.readFileSync(alvo, 'utf8').includes('{{')) achados.push(achado('placeholder', `${rotulo}/${a.rel}`, 'placeholder {{ }} nao renderizado'));
    }
    const componente = a.rel.endsWith('/SKILL.md') || /^(?:commands|agents)\/[^/]+\.md$/.test(a.rel);
    if (componente) {
      const bloco = frontmatter(fs.readFileSync(alvo, 'utf8'));
      const problema = bloco === null ? 'sem frontmatter' : problemaDoFrontmatter(bloco);
      if (problema) achados.push(achado('frontmatter.descricao', `${rotulo}/${a.rel}`, problema));
      const pasta = path.posix.basename(path.posix.dirname(a.rel));
      if (!problema && a.rel.endsWith('/SKILL.md') && valorDoFrontmatter(bloco, 'name') !== pasta) {
        achados.push(achado('skill.nome', `${rotulo}/${a.rel}`, `name diferente da pasta ${pasta}`));
      }
    }
  }
  for (const nome of ['README.md', 'README.pt-BR.md']) {
    const alvo = path.join(dir, nome);
    if (!fs.existsSync(alvo)) { achados.push(achado('readme.curto', `${rotulo}/${nome}`, 'README ausente')); continue; }
    const texto = fs.readFileSync(alvo, 'utf8');
    const palavras = palavrasForaDeCodigo(texto);
    if (palavras < 40) achados.push(achado('readme.curto', `${rotulo}/${nome}`, `${palavras} palavras fora de bloco de codigo, minimo 40`));
    // Instalado, o plugin e so a pasta: link relativo que sai dela quebra na listagem e na maquina.
    for (const [, destino] of texto.replace(/```[\s\S]*?```/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(destino) || destino.startsWith('#')) continue;
      const caminho = path.posix.normalize(decodeURIComponent(destino.split('#')[0]));
      if (caminho.startsWith('../') || caminho.startsWith('/') || !fs.existsSync(path.join(dir, caminho))) {
        achados.push(achado('readme.link', `${rotulo}/${nome}`, `link ${destino} fora da pasta do plugin ou inexistente`));
      }
    }
  }
  if (!fs.existsSync(path.join(dir, 'LICENSE'))) achados.push(achado('licenca.ausente', `${rotulo}/LICENSE`, 'arquivo LICENSE ausente'));
  for (const autoria of ['README.md', 'README.pt-BR.md', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const alvo = path.join(dir, autoria);
    if (fs.existsSync(alvo) && fs.readFileSync(alvo, 'utf8').includes(TRAVESSAO)) achados.push(achado('texto.travessao', `${rotulo}/${autoria}`, 'travessao U+2014 em arquivo de autoria'));
  }
  return achados;
}

function conferirManifestoComum(p, dir, rotulo, arquivo, raiz) {
  const achados = [];
  if (!NOME.test(p.name || '')) achados.push(achado('manifesto.nome', `${rotulo}/${arquivo}`, `name ${JSON.stringify(p.name)} fora de ${NOME}`));
  if (path.basename(dir) !== p.name) achados.push(achado('manifesto.nome', `${rotulo}/${arquivo}`, `name ${p.name} diferente da pasta ${path.basename(dir)}`));
  if (raiz && p.version !== versao(raiz)) achados.push(achado('manifesto.campos', `${rotulo}/${arquivo}`, `version ${p.version} diferente de core/package.json ${versao(raiz)}`));
  for (const campo of ['version', 'description', 'license']) {
    if (typeof p[campo] !== 'string' || !p[campo].trim()) achados.push(achado('manifesto.campos', `${rotulo}/${arquivo}`, `${campo} ausente`));
  }
  if (!p.author || typeof p.author.name !== 'string' || !p.author.name.trim()) achados.push(achado('manifesto.campos', `${rotulo}/${arquivo}`, 'author.name ausente'));
  for (const campo of ['homepage', 'repository']) {
    try { if (new URL(p[campo]).protocol !== 'https:') throw new Error(); } catch { achados.push(achado('manifesto.campos', `${rotulo}/${arquivo}`, `${campo} nao e URL https`)); }
  }
  return achados;
}

function caminhoDeComponente(dir, rotulo, arquivo, valor) {
  if (typeof valor !== 'string' || !valor.startsWith('./')) return achado('manifesto.caminho', `${rotulo}/${arquivo}`, `caminho ${JSON.stringify(valor)} nao comeca com ./`);
  if (valor.split('/').includes('..')) return achado('manifesto.caminho', `${rotulo}/${arquivo}`, `caminho ${valor} sai da pasta`);
  if (!fs.existsSync(path.join(dir, valor))) return achado('manifesto.caminho', `${rotulo}/${arquivo}`, `caminho ${valor} nao existe`);
  return null;
}

/** A pasta do plugin do Claude Code contra o checklist da Anthropic. `raiz` confere catalogo e versao. */
function conferirPastaClaude(dir, raiz) {
  const rotulo = raiz ? posix(path.relative(raiz, dir)) : path.basename(dir);
  const arquivo = '.claude-plugin/plugin.json';
  if (!fs.existsSync(path.join(dir, arquivo))) return [achado('manifesto.campos', `${rotulo}/${arquivo}`, 'manifesto ausente')];
  const p = JSON.parse(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
  const achados = [...conferirManifestoComum(p, dir, rotulo, arquivo, raiz), ...conferirArquivos(dir, rotulo)];
  for (const chave of ['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers']) {
    if (p[chave] === undefined) continue;
    if (['hooks', 'mcpServers', 'lspServers'].includes(chave)) { achados.push(achado('componente.executavel', `${rotulo}/${arquivo}`, `${chave} declarado (D1)`)); continue; }
    for (const valor of [].concat(p[chave])) {
      const problema = caminhoDeComponente(dir, rotulo, arquivo, valor);
      if (problema) achados.push(problema);
    }
  }
  if (raiz) {
    const esperado = skillsDoCatalogo(raiz).map((s) => `./skills/${s.bucket}/${s.nome}`);
    const declarado = [].concat(p.skills || []);
    if (JSON.stringify([...declarado].sort()) !== JSON.stringify([...esperado].sort())) {
      achados.push(achado('catalogo.skills', `${rotulo}/${arquivo}`, `${declarado.length} skills declaradas, o catalogo tem ${esperado.length}`));
    }
  }
  achados.push(...conferirContagens(dir, rotulo, CONTAGENS.claude));
  return achados;
}

/** A pasta do plugin do Codex contra o manifesto documentado e a entrada de marketplace. */
function conferirPastaCodex(dir, raiz) {
  const rotulo = raiz ? posix(path.relative(raiz, dir)) : path.basename(dir);
  const arquivo = '.codex-plugin/plugin.json';
  if (!fs.existsSync(path.join(dir, arquivo))) return [achado('manifesto.campos', `${rotulo}/${arquivo}`, 'manifesto ausente')];
  const p = JSON.parse(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
  const achados = [...conferirManifestoComum(p, dir, rotulo, arquivo, raiz), ...conferirArquivos(dir, rotulo)];
  if (p.skills !== './skills/') achados.push(achado('manifesto.caminho', `${rotulo}/${arquivo}`, 'skills precisa ser ./skills/'));
  for (const chave of ['hooks', 'mcpServers', 'apps']) {
    if (p[chave] !== undefined) achados.push(achado('componente.executavel', `${rotulo}/${arquivo}`, `${chave} declarado (D1)`));
  }
  const i = p.interface || {};
  for (const campo of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
    if (typeof i[campo] !== 'string' || !i[campo].trim()) achados.push(achado('interface.campos', `${rotulo}/${arquivo}`, `interface.${campo} ausente`));
  }
  if (!Array.isArray(i.capabilities)) achados.push(achado('interface.campos', `${rotulo}/${arquivo}`, 'interface.capabilities precisa ser lista'));
  for (const campo of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    try { if (new URL(i[campo]).protocol !== 'https:') throw new Error(); } catch { achados.push(achado('interface.campos', `${rotulo}/${arquivo}`, `interface.${campo} nao e URL https`)); }
  }
  const prompts = i.defaultPrompt;
  if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > 3) achados.push(achado('interface.prompt', `${rotulo}/${arquivo}`, 'defaultPrompt precisa de 1 a 3 itens'));
  else for (const s of prompts) if (typeof s !== 'string' || s.length > 128) achados.push(achado('interface.prompt', `${rotulo}/${arquivo}`, `defaultPrompt acima de 128 caracteres: ${String(s).slice(0, 40)}`));
  if (!/^#[0-9a-fA-F]{6}$/.test(i.brandColor || '')) achados.push(achado('interface.cor', `${rotulo}/${arquivo}`, 'brandColor precisa ser hex de 6 digitos'));
  const imagens = [['logo', i.logo, '.png'], ['composerIcon', i.composerIcon, null], ...[].concat(i.screenshots || []).map((s) => ['screenshots', s, '.png'])];
  for (const [campo, valor, ext] of imagens) {
    if (typeof valor !== 'string' || !valor.startsWith('./assets/')) { achados.push(achado('interface.imagem', `${rotulo}/${arquivo}`, `${campo} precisa estar em ./assets/`)); continue; }
    if (ext && path.posix.extname(valor) !== ext) achados.push(achado('interface.imagem', `${rotulo}/${arquivo}`, `${campo} precisa ser ${ext}`));
    if (!fs.existsSync(path.join(dir, valor))) achados.push(achado('interface.imagem', `${rotulo}/${arquivo}`, `${campo} ${valor} nao existe`));
  }
  achados.push(...conferirContagens(dir, rotulo, CONTAGENS.codex));
  return achados;
}

function conferirContagens(dir, rotulo, regras) {
  const achados = [];
  for (const [arquivo, regex, contar] of regras) {
    const alvo = path.join(dir, arquivo);
    if (!fs.existsSync(alvo)) continue;
    const m = regex.exec(fs.readFileSync(alvo, 'utf8'));
    const real = contar(dir);
    if (!m) achados.push(achado('readme.contagem', `${rotulo}/${arquivo}`, `linha ${regex} ausente (a pasta tem ${real})`));
    else if (Number(m[1]) !== real) achados.push(achado('readme.contagem', `${rotulo}/${arquivo}`, `o README diz ${m[1]} e a pasta tem ${real}`));
  }
  return achados;
}

/** Os dois marketplaces proprios da raiz. */
function conferirMarketplaces(raiz) {
  const achados = [];
  const semSair = (s) => typeof s === 'string' && s.startsWith('./') && !s.split('/').includes('..');
  const c = lerJson(raiz, DESTINOS.marketplaceClaude);
  const pc = c.plugins && c.plugins[0];
  if (!NOME.test(c.name || '') || !c.owner || !c.owner.name) achados.push(achado('marketplace.claude', DESTINOS.marketplaceClaude, 'name ou owner.name ausente'));
  if (!pc || !semSair(pc.source) || pc.source !== `./${DESTINOS.claude}`) achados.push(achado('marketplace.claude', DESTINOS.marketplaceClaude, `source precisa ser ./${DESTINOS.claude}`));
  else {
    const manifesto = lerJson(raiz, `${DESTINOS.claude}/.claude-plugin/plugin.json`);
    if (pc.name !== manifesto.name) achados.push(achado('marketplace.claude', DESTINOS.marketplaceClaude, `entrada ${pc.name} diferente do manifesto ${manifesto.name}`));
  }
  const x = lerJson(raiz, DESTINOS.marketplaceCodex);
  const px = x.plugins && x.plugins[0];
  if (!x.name || !x.interface || !x.interface.displayName) achados.push(achado('marketplace.codex', DESTINOS.marketplaceCodex, 'name ou interface.displayName ausente'));
  if (!px || !px.source || px.source.source !== 'local' || !semSair(px.source.path) || px.source.path !== `./${DESTINOS.codex}`) {
    achados.push(achado('marketplace.codex', DESTINOS.marketplaceCodex, `source precisa ser local em ./${DESTINOS.codex}`));
  } else {
    const manifesto = lerJson(raiz, `${DESTINOS.codex}/.codex-plugin/plugin.json`);
    if (px.name !== manifesto.name) achados.push(achado('marketplace.codex', DESTINOS.marketplaceCodex, `entrada ${px.name} diferente do manifesto ${manifesto.name}`));
    if (!px.policy || !INSTALACAO.has(px.policy.installation) || !AUTENTICACAO.has(px.policy.authentication)) achados.push(achado('marketplace.codex', DESTINOS.marketplaceCodex, 'policy.installation ou policy.authentication fora dos valores aceitos'));
    if (typeof px.category !== 'string' || !px.category.trim()) achados.push(achado('marketplace.codex', DESTINOS.marketplaceCodex, 'category ausente'));
  }
  return achados;
}

/** Igualdade de bytes; em texto, CRLF de checkout com autocrlf conta como LF. */
function mesmoConteudo(disco, esperado, rel) {
  if (disco.equals(esperado)) return true;
  if (!/\.(?:md|json|svg)$|(?:^|\/)LICENSE$/.test(rel)) return false;
  return disco.toString('utf8').replace(/\r\n/g, '\n') === esperado.toString('utf8').replace(/\r\n/g, '\n');
}

/** Todo arquivo que a geracao le, em ordem. */
function fontesDaGeracao(raiz) {
  leituras = new Set();
  try { gerar(raiz); return [...leituras].sort(); } finally { leituras = null; }
}

/**
 * Fonte que existe no disco e nao esta no indice do git: a geracao passa aqui e quebra no checkout
 * limpo do CI. Foi o defeito real da RM-049: um `fontes/` no `.git/info/exclude` de outra thread
 * escondeu `marketplaces/fontes/`. Fora de repositorio git (a copia do teste), nao ha o que conferir.
 */
function fontesForaDoGit(raiz) {
  if (!fs.existsSync(path.join(raiz, '.git'))) return [];
  const fontes = fontesDaGeracao(raiz);
  const indexadas = new Set(execFileSync('git', ['-C', raiz, 'ls-files', '--cached', '-z', '--', ...fontes], { encoding: 'utf8' })
    .split('\0').filter(Boolean));
  return fontes.filter((f) => !indexadas.has(f));
}

/** As contagens que o guia e o kit dos formularios afirmam, contra o catalogo. */
const CONTAGENS_DO_REPOSITORIO = [
  ['marketplaces/README.md', /(\d+) skills, (\d+) comandos, (\d+) subagentes/, ['skills', 'comandos', 'agentes']],
  ['marketplaces/README.md', /as (\d+) skills do catálogo/, ['skills']],
  ['marketplaces/README.md', /manifesto, as (\d+) skills/, ['skills']],
  ['marketplaces/formularios.md', /and (\d+) skills that route/, ['skills']],
];

/** Contagens do guia e do kit, e o `.gitattributes` que faria o portal parar a validacao. */
function conferirTextosDoRepositorio(raiz) {
  const achados = [];
  const real = {
    skills: skillsDoCatalogo(raiz).length,
    comandos: mdDe(raiz, 'adapters/claude-code/commands').length,
    agentes: mdDe(raiz, 'adapters/claude-code/agents').length,
  };
  for (const [rel, regex, nomes] of CONTAGENS_DO_REPOSITORIO) {
    const alvo = path.join(raiz, rel);
    if (!fs.existsSync(alvo)) continue;
    const m = regex.exec(fs.readFileSync(alvo, 'utf8'));
    if (!m) { achados.push(achado('readme.contagem', rel, `trecho ${regex} ausente`)); continue; }
    nomes.forEach((nome, i) => {
      if (Number(m[i + 1]) !== real[nome]) achados.push(achado('readme.contagem', rel, `o texto diz ${m[i + 1]} ${nome} e o catalogo tem ${real[nome]}`));
    });
  }
  // O checklist da Anthropic para a validacao com export-ignore, export-subst ou filtro que reescreve conteudo.
  for (const rel of ['.gitattributes', 'marketplaces/.gitattributes', `${DESTINOS.claude}/.gitattributes`, `${DESTINOS.codex}/.gitattributes`]) {
    const alvo = path.join(raiz, rel);
    if (fs.existsSync(alvo) && /export-ignore|export-subst|\bfilter=/.test(fs.readFileSync(alvo, 'utf8'))) {
      achados.push(achado('repo.gitattributes', rel, 'export-ignore, export-subst ou filter param a validacao do portal'));
    }
  }
  return achados;
}

/** Deriva entre o disco e o que as fontes geram, mais as regras das duas pastas e dos marketplaces. */
function verificar(raiz) {
  const esperado = gerar(raiz);
  const achados = fontesForaDoGit(raiz).map((f) => achado('fonte.fora-do-git', f, 'fonte fora do indice do git: o checkout limpo nao a tem (git add -f se um exclude local a esconde)'));
  for (const [rel, conteudo] of esperado) {
    const alvo = path.join(raiz, rel);
    if (!fs.existsSync(alvo)) achados.push(achado('deriva.faltando', rel, REGENERAR));
    else if (!mesmoConteudo(fs.readFileSync(alvo), conteudo, rel)) achados.push(achado('deriva.diferente', rel, REGENERAR));
  }
  for (const pasta of [DESTINOS.claude, DESTINOS.codex]) {
    for (const a of listar(path.join(raiz, pasta))) {
      const rel = `${pasta}/${a.rel}`;
      if (!a.dir && !esperado.has(rel)) achados.push(achado('deriva.sobrando', rel, REGENERAR));
    }
  }
  if (achados.length) return achados;
  return [
    ...conferirPastaClaude(path.join(raiz, DESTINOS.claude), raiz),
    ...conferirPastaCodex(path.join(raiz, DESTINOS.codex), raiz),
    ...conferirMarketplaces(raiz),
    ...conferirTextosDoRepositorio(raiz),
  ];
}

/** Escreve o que as fontes geram. As duas pastas do plugin sao do gerador: o que sobra nelas sai. */
function escrever(raiz) {
  const esperado = gerar(raiz);
  for (const pasta of [DESTINOS.claude, DESTINOS.codex]) {
    fs.rmSync(path.join(raiz, pasta), { recursive: true, force: true });
  }
  for (const [rel, conteudo] of esperado) {
    const alvo = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, conteudo);
  }
  return esperado.size;
}

function main(argv) {
  const i = argv.indexOf('--raiz');
  const raiz = path.resolve(i >= 0 ? argv[i + 1] : path.join(__dirname, '..', '..'));
  if (argv.includes('--verificar')) {
    const achados = verificar(raiz);
    for (const a of achados) console.log(`${a.codigo}  ${a.arquivo}: ${a.detalhe}`);
    console.log(achados.length
      ? `marketplaces: ${achados.length} achado(s)`
      : `marketplaces: pastas e marketplaces iguais ao que o catalogo gera, regras conferidas`);
    return achados.length ? 1 : 0;
  }
  const total = escrever(raiz);
  const achados = verificar(raiz);
  for (const a of achados) console.log(`${a.codigo}  ${a.arquivo}: ${a.detalhe}`);
  console.log(`marketplaces: ${total} arquivos gerados, ${achados.length} achado(s)`);
  return achados.length ? 1 : 0;
}

module.exports = {
  BUCKETS, DESTINOS, SEM_COPIA, gerar, verificar, escrever, fontesDaGeracao,
  conferirPastaClaude, conferirPastaCodex, conferirMarketplaces, conferirTextosDoRepositorio, problemaDoFrontmatter, palavrasForaDeCodigo,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));

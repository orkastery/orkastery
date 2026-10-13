/**
 * RM-026 K7, fatia 1: conhecimento escrito no contrato `ork.conhecimento/v1`. Cada teste reprova no código de
 * antes desta thread (ork-rm026k7conhe): a base não tem o leitor, o bloco do manifesto nem o modo estrito do YAML.
 * O nome de cada teste começa pela decisão do PLAN que ele prova (D1 a D9), a mesma do critério registrado no
 * ledger. O contrato está em docs/referencia/contratos/conhecimento-rm026.md.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readCycle } from '../src/company-brain-source';
import { Conhecimento, LIMITES_DO_CONHECIMENTO, LimitesDoConhecimento, lerConhecimento } from '../src/conhecimento';
import { carregarManifesto } from '../src/manifest';
import { exec } from '../src/util';
import { lerYaml } from '../src/yaml';
import { dirTemporario } from './apoio';

const PROJETO = 'project:\n  name: "teste"\n  abbrev: "tst"\n';
const KB = 'conhecimento:\n  dir: docs/conhecimento\n';
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

/** Um projeto mínimo, sem git: o leitor do conhecimento não precisa de repositório. */
function projeto(nome: string, bloco = ''): { dir: string; limpar: () => void } {
  const dir = dirTemporario(`conhecimento-${nome}`);
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), PROJETO + bloco);
  return { dir, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Grava um documento com o frontmatter dado e devolve o texto gravado. */
function documento(raiz: string, rel: string, frontmatter: string, corpo = '# Título\n\nCorpo.\n'): string {
  const texto = `---\n${frontmatter}---\n${corpo}`;
  const abs = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
  return texto;
}

/** O ledger de uma thread no estado do projeto, um evento por linha; devolve as linhas gravadas. */
function ledger(raiz: string, thread: string, eventos: Record<string, unknown>[]): string[] {
  const linhas = eventos.map((e) => JSON.stringify({ ts: '2026-10-12T12:00:00.000Z', thread, ...e }));
  const dir = path.join(raiz, '.orkastery', 'threads', thread);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), linhas.join('\n') + '\n');
  return linhas;
}

function ler(raiz: string, limites: Partial<LimitesDoConhecimento> = {}): Conhecimento {
  return lerConhecimento(carregarManifesto(raiz)!, { ...LIMITES_DO_CONHECIMENTO, ...limites });
}

/** As lacunas sem o detalhe, que é texto para gente; o contrato é o código e onde ele cai. */
const lacunas = (k: Conhecimento) => k.lacunas.map((l) => ({ codigo: l.codigo, arquivo: l.arquivo, documento: l.documento, referencia: l.referencia }));

test('D1: o bloco conhecimento declara a pasta; sem ele não há conhecimento, e forma errada só avisa', () => {
  const p = projeto('manifesto');
  try {
    const lido = (bloco: string) => {
      fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), PROJETO + bloco);
      const c = carregarManifesto(p.dir)!;
      assert.deepEqual(c.erros, []);
      return { conhecimento: c.manifesto.conhecimento, avisos: c.avisos.filter((a) => a.startsWith('conhecimento')) };
    };
    assert.deepEqual(lido(''), { conhecimento: undefined, avisos: [] });
    assert.deepEqual(lido('conhecimento:\n  dir: docs/conhecimento\n'), { conhecimento: { dir: 'docs/conhecimento' }, avisos: [] });
    // A regra do caminho é do leitor: o manifesto guarda o texto, e o leitor recusa com lacuna tipada (D6).
    assert.deepEqual(lido('conhecimento:\n  dir: /etc\n'), { conhecimento: { dir: '/etc' }, avisos: [] });
    // Bloco fora do formato avisa e fica declarado com dir vazio: o leitor recusa, em vez de dizer que nada foi declarado.
    assert.deepEqual(lido('conhecimento: docs/conhecimento\n'), { conhecimento: { dir: '' },
      avisos: ['conhecimento deve ser um mapa com dir: <pasta dentro da raiz>; o leitor recusa ate corrigir'] });
    assert.deepEqual(lido('conhecimento:\n  dir:\n'), { conhecimento: { dir: '' },
      avisos: ['conhecimento.dir deve ser uma pasta dentro da raiz, como docs/conhecimento; o leitor recusa ate corrigir'] });
    assert.deepEqual([ler(p.dir).dir, lacunas(ler(p.dir))], ['', [{ codigo: 'conhecimento.dir-invalido', arquivo: null, documento: null, referencia: null }]]);
    assert.deepEqual(lido('conhecimento:\n  dir: kb\n  pasta: outra\n'), { conhecimento: { dir: 'kb' },
      avisos: ['conhecimento.pasta desconhecida; o bloco conhecimento so tem dir'] });

    // Sem o bloco, o leitor diz que não há conhecimento declarado, e não procura pasta padrão.
    documento(p.dir, 'docs/conhecimento/a.md', 'id: doc-aaa\ntitulo: T\ncolecoes: [rh]\n');
    fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), PROJETO);
    assert.deepEqual(ler(p.dir), { contrato: 'ork.conhecimento/v1', dir: null, documentos: [], colecoes: [],
      lacunas: [{ codigo: 'conhecimento.nao-declarado', arquivo: null, documento: null, referencia: null,
        detalhe: 'o orkastery.yaml não declara conhecimento.dir' }] });
  } finally { p.limpar(); }
});

test('D2: frontmatter fechado: chave fora do contrato, repetida ou fora do bloco invalida o documento inteiro', () => {
  const p = projeto('fechado', KB);
  try {
    const resto = 'titulo: T\ncolecoes: [rh]\n';
    documento(p.dir, 'docs/conhecimento/ok.md', 'id: doc-ok1\n' + resto);
    documento(p.dir, 'docs/conhecimento/autor.md', 'id: doc-autor\n' + resto + 'autor: Ana\n');
    documento(p.dir, 'docs/conhecimento/versao.md', 'id: doc-versao\ncontrato: ork.conhecimento/v2\n' + resto);
    documento(p.dir, 'docs/conhecimento/repetida.md', 'id: doc-repetida\n' + resto + 'titulo: Outro\n');
    documento(p.dir, 'docs/conhecimento/recuo.md', 'id: doc-recuo\n' + resto + 'referencias:\n  brain: [proj-aaa]\n decisoes: [ork-x#1]\n');
    documento(p.dir, 'docs/conhecimento/proto.md', 'id: doc-proto\n' + resto + '__proto__:\n  id: doc-outro\n');
    documento(p.dir, 'docs/conhecimento/lista.md', '- id\n- titulo\n');
    documento(p.dir, 'docs/conhecimento/comentario.md', 'id: doc-comentario\ntitulo: Decisão #42 do time\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/comentado.md', 'id: doc-comentado\n# nota de quem escreveu\ntitulo: "Decisão #42 do time"\ncolecoes: [rh]\n');
    fs.writeFileSync(path.join(p.dir, 'docs/conhecimento/sem.md'), '# Sem frontmatter\n');
    fs.writeFileSync(path.join(p.dir, 'docs/conhecimento/aberto.md'), '---\nid: doc-aberto\n' + resto);
    const k = ler(p.dir);
    assert.deepEqual(k.documentos.map((d) => [d.id, d.titulo]), [['doc-comentado', 'Decisão #42 do time'], ['doc-ok1', 'T']]);
    const sem = (arquivo: string, codigo: string, documento: string | null = null) =>
      ({ codigo, arquivo: `docs/conhecimento/${arquivo}`, documento, referencia: null });
    assert.deepEqual(lacunas(k), [
      sem('aberto.md', 'documento.sem-frontmatter'),
      sem('autor.md', 'documento.chave-desconhecida', 'doc-autor'),
      sem('comentario.md', 'documento.frontmatter-invalido'),
      sem('lista.md', 'documento.frontmatter-invalido'),
      sem('proto.md', 'documento.frontmatter-invalido'),
      sem('recuo.md', 'documento.frontmatter-invalido'),
      sem('repetida.md', 'documento.frontmatter-invalido'),
      sem('sem.md', 'documento.sem-frontmatter'),
      sem('versao.md', 'documento.chave-desconhecida', 'doc-versao'),
    ]);
    const detalhe = (arquivo: string) => k.lacunas.find((l) => l.arquivo === `docs/conhecimento/${arquivo}`)!.detalhe;
    assert.match(detalhe('autor.md'), /chave fora do contrato: "autor"/);
    // A linha é a do arquivo, contando o --- de abertura.
    assert.match(detalhe('repetida.md'), /linha 5: chave repetida/);
    assert.match(detalhe('recuo.md'), /linha 7: indentacao fora do bloco/);
    assert.match(detalhe('comentario.md'), /linha 3: comentario depois do valor/);
    assert.match(detalhe('proto.md'), /chave reservada/);
  } finally { p.limpar(); }
});

test('D2: documento fora de UTF-8 vira lacuna; o BOM do UTF-8 é aceito e entra no sha256', () => {
  const p = projeto('codificacao', KB);
  try {
    const kb = path.join(p.dir, 'docs', 'conhecimento');
    fs.mkdirSync(kb, { recursive: true });
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('---\nid: doc-bom\ntitulo: Com BOM\ncolecoes: [rh]\n---\n')]);
    fs.writeFileSync(path.join(kb, 'bom.md'), bom);
    fs.writeFileSync(path.join(kb, 'latin1.md'), Buffer.concat([Buffer.from('---\nid: doc-latin\ntitulo: F'), Buffer.from([0xe9]),
      Buffer.from('rias\ncolecoes: [rh]\n---\n')]));
    const k = ler(p.dir);
    assert.deepEqual(k.documentos.map((d) => [d.id, d.titulo, d.bytes, d.sha256]), [['doc-bom', 'Com BOM', bom.length, sha(bom)]]);
    assert.deepEqual(lacunas(k), [{ codigo: 'documento.codificacao', arquivo: 'docs/conhecimento/latin1.md', documento: null, referencia: null }]);
  } finally { p.limpar(); }
});

test('D3: forma do id, do título, das coleções e das referências; fora da forma, o documento inteiro vira lacuna', () => {
  const p = projeto('formas', KB);
  try {
    const d = (nome: string, frontmatter: string) => documento(p.dir, `docs/conhecimento/${nome}.md`, frontmatter);
    const nomes = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`).join(', ');
    const esc = String.fromCharCode(0x1b), rlo = String.fromCharCode(0x202e), hangul = String.fromCharCode(0x3164);
    const programadora = String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb);
    // Valem: os extremos de cada forma, coleção num texto só, o inteiro que o YAML lê como número e o emoji com ZWJ
    // (a regra de invisível é a do saida-segura.ts).
    d('titulo-emoji', `id: doc-titulo-emoji\ntitulo: Guia do time ${programadora}\ncolecoes: [rh]\n`);
    d('extremos', `id: doc-${'a'.repeat(48)}\ntitulo: ${'t'.repeat(160)}\ncolecoes: [${nomes(16)}]\n`);
    d('escalares', 'id: doc-ano\ntitulo: Relatório 2026\ncolecoes: 2026\n');
    d('um-texto', 'id: doc-um-texto\ntitulo: Uma coleção\ncolecoes: rh\n');
    // Não valem:
    d('id-curto', 'id: doc-ab\ntitulo: T\ncolecoes: [rh]\n');
    d('id-longo', `id: doc-${'a'.repeat(49)}\ntitulo: T\ncolecoes: [rh]\n`);
    d('id-maiusculo', 'id: DOC-ABC\ntitulo: T\ncolecoes: [rh]\n');
    d('id-ausente', 'titulo: T\ncolecoes: [rh]\n');
    d('titulo-ausente', 'id: doc-titulo-ausente\ncolecoes: [rh]\n');
    d('titulo-numero', 'id: doc-titulo-numero\ntitulo: 2026\ncolecoes: [rh]\n');
    d('titulo-longo', `id: doc-titulo-longo\ntitulo: ${'t'.repeat(161)}\ncolecoes: [rh]\n`);
    d('titulo-escape', `id: doc-titulo-escape\ntitulo: a${esc}[31mb\ncolecoes: [rh]\n`);
    d('titulo-bidi', `id: doc-titulo-bidi\ntitulo: a${rlo}b\ncolecoes: [rh]\n`);
    d('titulo-hangul', `id: doc-titulo-hangul\ntitulo: ${hangul}\ncolecoes: [rh]\n`);
    d('colecao-ausente', 'id: doc-colecao-ausente\ntitulo: T\n');
    d('colecao-vazia', 'id: doc-colecao-vazia\ntitulo: T\ncolecoes: []\n');
    d('colecao-maiuscula', 'id: doc-colecao-maiuscula\ntitulo: T\ncolecoes: [RH]\n');
    d('colecao-repetida', 'id: doc-colecao-repetida\ntitulo: T\ncolecoes: [rh, rh]\n');
    d('colecao-demais', `id: doc-colecao-demais\ntitulo: T\ncolecoes: [${nomes(17)}]\n`);
    d('colecao-booleana', 'id: doc-colecao-booleana\ntitulo: T\ncolecoes: [rh, yes]\n');
    d('colecao-nula', 'id: doc-colecao-nula\ntitulo: T\ncolecoes: [rh, ]\n');
    d('refs-texto', 'id: doc-refs-texto\ntitulo: T\ncolecoes: [rh]\nreferencias: proj-aaa\n');
    d('refs-chave', 'id: doc-refs-chave\ntitulo: T\ncolecoes: [rh]\nreferencias:\n  outros: [proj-aaa]\n');
    d('refs-demais', `id: doc-refs-demais\ntitulo: T\ncolecoes: [rh]\nreferencias:\n  brain: [${Array.from({ length: 65 }, (_, i) => `proj-a${i}x`).join(', ')}]\n`);
    d('refs-nula', 'id: doc-refs-nula\ntitulo: T\ncolecoes: [rh]\nreferencias:\n  decisoes: [ork-x#1, ]\n');
    const k = ler(p.dir);
    assert.deepEqual(k.documentos.map((x) => [x.id, x.titulo.length, x.colecoes]), [
      [`doc-${'a'.repeat(48)}`, 160, nomes(16).split(', ').sort()],
      ['doc-ano', 14, ['2026']],
      ['doc-titulo-emoji', 18, ['rh']],
      ['doc-um-texto', 11, ['rh']],
    ]);
    assert.equal(k.lacunas.length, 21, 'uma lacuna por documento inválido');
    const porArquivo = Object.fromEntries(k.lacunas.map((l) => [path.basename(l.arquivo!, '.md'), [l.codigo, l.documento]]));
    const id = 'documento.id-invalido', titulo = 'documento.titulo-invalido', colecoes = 'documento.colecoes-invalidas',
      refs = 'documento.referencias-invalidas';
    assert.deepEqual(porArquivo, {
      'id-curto': [id, null], 'id-longo': [id, null], 'id-maiusculo': [id, null], 'id-ausente': [id, null],
      'titulo-ausente': [titulo, 'doc-titulo-ausente'], 'titulo-numero': [titulo, 'doc-titulo-numero'],
      'titulo-longo': [titulo, 'doc-titulo-longo'], 'titulo-escape': [titulo, 'doc-titulo-escape'],
      'titulo-bidi': [titulo, 'doc-titulo-bidi'], 'titulo-hangul': [titulo, 'doc-titulo-hangul'],
      'colecao-ausente': [colecoes, 'doc-colecao-ausente'], 'colecao-vazia': [colecoes, 'doc-colecao-vazia'],
      'colecao-maiuscula': [colecoes, 'doc-colecao-maiuscula'], 'colecao-repetida': [colecoes, 'doc-colecao-repetida'],
      'colecao-demais': [colecoes, 'doc-colecao-demais'], 'colecao-booleana': [colecoes, 'doc-colecao-booleana'],
      'colecao-nula': [colecoes, 'doc-colecao-nula'],
      'refs-texto': [refs, 'doc-refs-texto'], 'refs-chave': [refs, 'doc-refs-chave'], 'refs-demais': [refs, 'doc-refs-demais'],
      'refs-nula': [refs, 'doc-refs-nula'],
    });
  } finally { p.limpar(); }
});

test('D4: o documento vale inteiro, cada referência vale sozinha e id repetido tira todos os documentos com ele', () => {
  const p = projeto('montagem', KB);
  try {
    ledger(p.dir, 'ork-x', [{ tipo: 'thread_created' }, { tipo: 'autonomous_decision' }]);
    documento(p.dir, 'docs/conhecimento/a/dup.md', 'id: doc-dup\ntitulo: Um\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/b/dup.md', 'id: doc-dup\ntitulo: Outro\ncolecoes: [financeiro]\n');
    documento(p.dir, 'docs/conhecimento/refs.md', 'id: doc-refs\ntitulo: Refs\ncolecoes: [rh]\nreferencias:\n' +
      '  brain: [proj-aaa, Projeto A, proj-aaa, init-bbb]\n  decisoes: [ork-x#2, ork-x#1, ork-x#2, ork-x]\n');
    // A cópia que não vale por outro motivo também conta: o reader nunca escolhe entre dois arquivos com o mesmo id.
    documento(p.dir, 'docs/conhecimento/unico.md', 'id: doc-unico\ntitulo: Único\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/z/sombra.md', 'id: doc-unico\ntitulo: Sombra\ncolecoes: [rh]\nautor: Ana\n');
    // Referência longa volta cortada sem partir caractere.
    const longa = 'x' + String.fromCodePoint(0x1f4a5).repeat(250);
    documento(p.dir, 'docs/conhecimento/longa.md', `id: doc-longa\ntitulo: Longa\ncolecoes: [outra]\nreferencias:\n  brain: [${longa}]\n`);
    const k = ler(p.dir);
    assert.deepEqual(k.documentos.map((d) => [d.id, d.referencias.brain, d.referencias.decisoes.map((x) => x.ref)]),
      [['doc-longa', [], []], ['doc-refs', ['init-bbb', 'proj-aaa'], ['ork-x#2']]]);
    assert.deepEqual(k.colecoes, [{ nome: 'outra', documentos: ['doc-longa'] }, { nome: 'rh', documentos: ['doc-refs'] }]);
    const em = (arquivo: string, codigo: string, documento: string, referencia: string | null = null) =>
      ({ codigo, arquivo: `docs/conhecimento/${arquivo}`, documento, referencia });
    assert.deepEqual(lacunas(k), [
      em('a/dup.md', 'documento.id-repetido', 'doc-dup'),
      em('b/dup.md', 'documento.id-repetido', 'doc-dup'),
      em('longa.md', 'referencia.invalida', 'doc-longa', 'x' + String.fromCodePoint(0x1f4a5).repeat(199)),
      em('refs.md', 'referencia.invalida', 'doc-refs', 'Projeto A'),
      em('refs.md', 'referencia.invalida', 'doc-refs', 'ork-x'),
      em('refs.md', 'referencia.nao-e-decisao', 'doc-refs', 'ork-x#1'),
      em('unico.md', 'documento.id-repetido', 'doc-unico'),
      em('z/sombra.md', 'documento.chave-desconhecida', 'doc-unico'),
    ]);
  } finally { p.limpar(); }
});

test('D5: documento válido sai com coleções, Brain pela forma e decisões conferidas no ledger, com a citação da captura do Brain', () => {
  const p = projeto('valido', KB);
  try {
    const linhas = ledger(p.dir, 'ork-exemplo', [
      { tipo: 'thread_created' },
      { tipo: 'autonomous_decision', decisao: 'férias em dois períodos' },
      { tipo: 'human_gate', pedidoId: 'p1' },
    ]);
    const ferias = documento(p.dir, 'docs/conhecimento/politicas/ferias.md',
      'id: doc-ferias\ntitulo: Política de férias\ncolecoes: [rh, politicas]\nreferencias:\n  brain: [proj-portal-rh]\n' +
      '  decisoes:\n    - ork-exemplo#3\n    - ork-exemplo#2\n');
    const guia = documento(p.dir, 'docs/conhecimento/guia.md', 'id: doc-guia-de-deploy\ntitulo: "Guia: deploy"\ncolecoes:\n  - engenharia\n');
    const k = ler(p.dir);
    const citacao = (linha: number, tipo: string) => ({ ref: `ork-exemplo#${linha}`, thread: 'ork-exemplo', linha, tipo,
      fonte: `threads/ork-exemplo/ledger.jsonl#L${linha}`, sha256: sha(linhas[linha - 1]) });
    assert.deepEqual(k, {
      contrato: 'ork.conhecimento/v1',
      dir: 'docs/conhecimento',
      documentos: [
        { id: 'doc-ferias', titulo: 'Política de férias', colecoes: ['politicas', 'rh'],
          referencias: { brain: ['proj-portal-rh'], decisoes: [citacao(2, 'autonomous_decision'), citacao(3, 'human_gate')] },
          arquivo: 'docs/conhecimento/politicas/ferias.md', bytes: Buffer.byteLength(ferias), sha256: sha(ferias) },
        { id: 'doc-guia-de-deploy', titulo: 'Guia: deploy', colecoes: ['engenharia'], referencias: { brain: [], decisoes: [] },
          arquivo: 'docs/conhecimento/guia.md', bytes: Buffer.byteLength(guia), sha256: sha(guia) },
      ],
      colecoes: [
        { nome: 'engenharia', documentos: ['doc-guia-de-deploy'] },
        { nome: 'politicas', documentos: ['doc-ferias'] },
        { nome: 'rh', documentos: ['doc-ferias'] },
      ],
      lacunas: [],
    });
    // A citação é a que a captura do Brain grava para a mesma linha: fonte e hash conferem.
    const capturado = readCycle(fs.readFileSync(path.join(p.dir, '.orkastery', 'threads', 'ork-exemplo', 'ledger.jsonl')),
      { tenant: 'teste', instance: 'teste', thread: 'ork-exemplo', aclRef: 'ork-factory' }).records.map((r) => r.event?.source);
    for (const decisao of k.documentos[0].referencias.decisoes) {
      assert.equal(capturado[decisao.linha - 1]?.source_ref, decisao.fonte);
      assert.equal(capturado[decisao.linha - 1]?.source_hash, decisao.sha256);
    }
  } finally { p.limpar(); }
});

test('D5: de dentro da worktree, a decisão confere no ledger canônico; a que não confere vira lacuna e o Brain fica na forma', () => {
  const principal = dirTemporario('conhecimento-principal');
  const fora = dirTemporario('conhecimento-wt');
  const wt = path.join(fora, 'wt');
  const git = (args: string[], cwd: string) => {
    const r = exec('git', ['-c', 'user.email=teste@orkastery.local', '-c', 'user.name=Teste', '-c', 'commit.gpgsign=false', ...args], cwd);
    assert.ok(r.ok, r.stderr);
  };
  try {
    git(['init', '-q', '-b', 'main'], principal);
    fs.writeFileSync(path.join(principal, 'orkastery.yaml'), PROJETO + KB);
    documento(principal, 'docs/conhecimento/x.md', 'id: doc-xis\ntitulo: X\ncolecoes: [rh]\nreferencias:\n  brain: [proj-sem-conferir]\n' +
      '  decisoes: [ork-x#2, ork-x#3, ork-x#1, ork-x#4, ork-x#5, ork-x#6, ork-x#7, ork-x#8, ork-nada#1, ork-arquivo#1, ork-x#0, ' +
      'ork-x#01, ../x#1]\n');
    git(['add', '-A'], principal);
    git(['commit', '-q', '-m', 'conhecimento'], principal);
    git(['worktree', 'add', '-q', '-b', 'kb', wt], principal);
    // O ledger é estado do projeto: mora na árvore principal, fora do git, e a worktree não tem cópia.
    const eventos = [
      { tipo: 'thread_created' }, { tipo: 'autonomous_decision' }, { tipo: 'hitl_requested' }, { tipo: 'human_decision' },
    ].map((e) => JSON.stringify({ ts: '2026-10-12T12:00:00.000Z', thread: 'ork-x', ...e }));
    eventos.push(JSON.stringify({ ts: '2026-10-12T12:00:00.000Z', thread: 'ork-outra', tipo: 'autonomous_decision' }), 'isto não é JSON');
    const pasta = path.join(principal, '.orkastery', 'threads', 'ork-x');
    fs.mkdirSync(pasta, { recursive: true });
    // A pasta de uma thread que é arquivo comum: o lstat do ledger dentro dela dá ENOTDIR, e a leitura não lança.
    fs.writeFileSync(path.join(principal, '.orkastery', 'threads', 'ork-arquivo'), 'não é pasta');
    // A sétima linha fica sem o fim de linha: escrita pela metade, ela ainda não existe para a captura nem aqui.
    fs.writeFileSync(path.join(pasta, 'ledger.jsonl'), eventos.join('\n') + '\n' +
      JSON.stringify({ ts: '2026-10-12T12:00:00.000Z', thread: 'ork-x', tipo: 'autonomous_decision' }));

    const k = ler(wt);
    assert.deepEqual(k.documentos.map((d) => [d.arquivo, d.referencias.brain, d.referencias.decisoes.map((x) => [x.ref, x.tipo])]), [
      ['docs/conhecimento/x.md', ['proj-sem-conferir'], [['ork-x#2', 'autonomous_decision'], ['ork-x#3', 'hitl_requested']]],
    ]);
    const em = (codigo: string, referencia: string) => ({ codigo, arquivo: 'docs/conhecimento/x.md', documento: 'doc-xis', referencia });
    assert.deepEqual(lacunas(k), [
      em('referencia.decisao-ausente', 'ork-arquivo#1'),
      em('referencia.decisao-ausente', 'ork-nada#1'),
      em('referencia.decisao-ausente', 'ork-x#7'),
      em('referencia.decisao-ausente', 'ork-x#8'),
      em('referencia.invalida', '../x#1'),
      em('referencia.invalida', 'ork-x#0'),
      em('referencia.invalida', 'ork-x#01'),
      em('referencia.nao-e-decisao', 'ork-x#1'),
      em('referencia.nao-e-decisao', 'ork-x#4'),
      em('referencia.nao-e-decisao', 'ork-x#5'),
      em('referencia.nao-e-decisao', 'ork-x#6'),
    ]);
    const detalhe = (referencia: string) => k.lacunas.find((l) => l.referencia === referencia)!.detalhe;
    assert.match(detalhe('ork-x#7'), /tem 6 linha\(s\) completa\(s\)/);
    assert.match(detalhe('ork-x#4'), /é human_decision, não decisão/);
    assert.match(detalhe('ork-x#5'), /é de outra thread/);
    assert.match(detalhe('ork-x#6'), /não é um evento JSON/);
    assert.match(detalhe('ork-nada#1'), /não tem ledger neste projeto/);
    assert.match(detalhe('ork-arquivo#1'), /não tem ledger neste projeto/);
  } finally {
    fs.rmSync(principal, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('D6: pasta fora da raiz, reservada ou de forma inválida recusa sem ler nada; dentro da raiz, vale pelo caminho real', () => {
  const p = projeto('fronteira');
  const fora = dirTemporario('conhecimento-fora');
  try {
    documento(fora, 'segredo.md', 'id: doc-de-fora\ntitulo: De fora\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/kb/dentro.md', 'id: doc-de-dentro\ntitulo: De dentro\ncolecoes: [rh]\n');
    fs.symlinkSync(fora, path.join(p.dir, 'atalho-fora'));
    fs.symlinkSync(path.join(p.dir, 'docs', 'kb'), path.join(p.dir, 'atalho-dentro'));
    fs.mkdirSync(path.join(p.dir, '.git'));
    fs.symlinkSync(path.join(p.dir, '.git'), path.join(p.dir, 'atalho-git'));
    fs.symlinkSync(p.dir, path.join(p.dir, 'atalho-raiz'));
    const esc = String.fromCharCode(0x1b);
    fs.mkdirSync(path.join(p.dir, 'docs', `k${esc}b`));
    fs.symlinkSync(path.join(p.dir, 'docs', `k${esc}b`), path.join(p.dir, 'atalho-controle'));
    fs.writeFileSync(path.join(p.dir, 'arquivo.txt'), 'x');
    const com = (dir: string) => {
      fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), `${PROJETO}conhecimento:\n  dir: ${JSON.stringify(dir)}\n`);
      const k = ler(p.dir);
      return [k.lacunas.map((l) => l.codigo).join(), k.documentos.map((d) => `${d.id}@${d.arquivo}`).join()];
    };
    for (const dir of [fora, '/etc', '../fora', 'docs/../docs/kb', '.', './', '.git', '.orkastery/threads', 'docs\\kb',
      '.ORKASTERY/threads', '.Git', 'atalho-git', 'atalho-raiz', 'atalho-controle']) {
      assert.deepEqual(com(dir), ['conhecimento.dir-invalido', ''], dir);
    }
    // O texto do manifesto com escape de terminal recusa, e não volta cru na resposta.
    fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), `${PROJETO}conhecimento:\n  dir: kb${esc}[2J\n`);
    const cru = ler(p.dir);
    assert.deepEqual([cru.dir, cru.lacunas.map((l) => l.codigo)], ['kb[2J', ['conhecimento.dir-invalido']]);
    assert.deepEqual(com('atalho-fora'), ['conhecimento.dir-fora-da-raiz', '']);
    assert.deepEqual(com('nao-existe'), ['conhecimento.dir-ausente', '']);
    assert.deepEqual(com('arquivo.txt'), ['conhecimento.dir-ausente', '']);
    // Dentro da raiz pelo caminho real vale, e o arquivo é o caminho real: o que o git versiona.
    assert.deepEqual(com('atalho-dentro'), ['', 'doc-de-dentro@docs/kb/dentro.md']);
    assert.deepEqual(com('./docs/kb/'), ['', 'doc-de-dentro@docs/kb/dentro.md']);
  } finally {
    p.limpar();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('D6: dentro da pasta, link nunca é seguido, FIFO e nome estranho viram lacuna, e a leitura não cria processo', (t) => {
  const p = projeto('links', KB);
  const fora = dirTemporario('conhecimento-links-fora');
  try {
    const kb = path.join(p.dir, 'docs', 'conhecimento');
    documento(fora, 'segredo.md', 'id: doc-de-fora\ntitulo: De fora\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/ok.md', 'id: doc-ok1\ntitulo: Ok\ncolecoes: [rh]\n');
    fs.symlinkSync(path.join(fora, 'segredo.md'), path.join(kb, 'link-fora.md'));
    fs.symlinkSync(path.join(kb, 'ok.md'), path.join(kb, 'link-dentro.md'));
    fs.symlinkSync(fora, path.join(kb, 'pasta-fora'));
    const processo = require('node:child_process') as typeof import('node:child_process');
    const fifo = processo.spawnSync('mkfifo', [path.join(kb, 'fila.md')]);
    assert.equal(fifo.status, 0, String(fifo.stderr));
    const esc = String.fromCharCode(0x1b);
    fs.writeFileSync(path.join(kb, `esc${esc}[31m.md`), '---\nid: doc-esc\ntitulo: T\ncolecoes: [rh]\n---\n');
    fs.writeFileSync(Buffer.concat([Buffer.from(kb + path.sep), Buffer.from([0x6e, 0xff, 0x2e, 0x6d, 0x64])]), 'x');

    // A leitura só lê arquivos: qualquer processo criado durante ela reprova o teste.
    const criados: string[] = [];
    for (const nome of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
      t.mock.method(processo, nome, (...args: unknown[]) => { criados.push(`${nome} ${String(args[0])}`); throw new Error('processo proibido'); });
    }
    const k = ler(p.dir);
    t.mock.restoreAll();
    assert.deepEqual(criados, []);

    assert.deepEqual(k.documentos.map((d) => d.id), ['doc-ok1']);
    const em = (arquivo: string, codigo: string) => ({ codigo, arquivo: `docs/conhecimento/${arquivo}`, documento: null, referencia: null });
    assert.deepEqual(lacunas(k), [
      em('esc?[31m.md', 'documento.nome-invalido'),
      em('fila.md', 'documento.nao-regular'),
      em('link-dentro.md', 'documento.link'),
      em('link-fora.md', 'documento.link'),
      em(`n${String.fromCharCode(0xfffd)}.md`, 'documento.nome-invalido'),
      em('pasta-fora', 'documento.link'),
    ]);
  } finally {
    p.limpar();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('D5: o ledger que cresce durante a leitura vale como estava no fstat, sem derrubar a citação', (t) => {
  const p = projeto('ledger-cresce', KB);
  try {
    const linhas = ledger(p.dir, 'ork-x', [{ tipo: 'autonomous_decision' }, { tipo: 'autonomous_decision' }, { tipo: 'autonomous_decision' }]);
    documento(p.dir, 'docs/conhecimento/a.md', 'id: doc-aaa\ntitulo: T\ncolecoes: [rh]\nreferencias:\n  decisoes: [ork-x#2, ork-x#3]\n');
    const alvo = fs.statSync(path.join(p.dir, '.orkastery', 'threads', 'ork-x', 'ledger.jsonl'));
    // O fstat vê o ledger com duas linhas; a terceira chega depois dele, durante a leitura.
    const tamanho = Buffer.byteLength(`${linhas[0]}\n${linhas[1]}\n`);
    const real = require('node:fs') as typeof import('node:fs');
    const fstat = real.fstatSync;
    t.mock.method(real, 'fstatSync', (...args: unknown[]) => {
      const st = Reflect.apply(fstat, real, args) as fs.Stats;
      return st.dev === alvo.dev && st.ino === alvo.ino ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: tamanho }) : st;
    });
    const k = ler(p.dir);
    t.mock.restoreAll();
    assert.deepEqual(k.documentos.map((d) => d.referencias.decisoes.map((x) => [x.ref, x.sha256])), [[['ork-x#2', sha(linhas[1])]]]);
    assert.deepEqual(lacunas(k), [{ codigo: 'referencia.decisao-ausente', arquivo: 'docs/conhecimento/a.md', documento: 'doc-aaa', referencia: 'ork-x#3' }]);
  } finally { p.limpar(); }
});

const COMO_ROOT = typeof process.getuid === 'function' && process.getuid() === 0 ? 'como root a permissão da pasta não barra a leitura' : false;

test('D6: entrada que não abre para leitura vira lacuna, e a leitura segue sem lançar', { skip: COMO_ROOT }, () => {
  const p = projeto('permissao', KB);
  const kb = path.join(p.dir, 'docs', 'conhecimento');
  try {
    documento(p.dir, 'docs/conhecimento/ok.md', 'id: doc-ok1\ntitulo: Ok\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/so-leitura/dentro.md', 'id: doc-dentro\ntitulo: T\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/fechada/dentro.md', 'id: doc-fechada\ntitulo: T\ncolecoes: [rh]\n');
    // Lista, mas não entra: o lstat do que está dentro dá EACCES. A outra nem lista.
    fs.chmodSync(path.join(kb, 'so-leitura'), 0o600);
    fs.chmodSync(path.join(kb, 'fechada'), 0o000);
    const k = ler(p.dir);
    assert.deepEqual(k.documentos.map((d) => d.id), ['doc-ok1']);
    const em = (arquivo: string) => ({ codigo: 'documento.nao-regular', arquivo: `docs/conhecimento/${arquivo}`, documento: null, referencia: null });
    assert.deepEqual(lacunas(k), [em('fechada'), em('so-leitura/dentro.md')]);
  } finally {
    for (const pasta of ['so-leitura', 'fechada']) fs.chmodSync(path.join(kb, pasta), 0o700);
    p.limpar();
  }
});

test('D7: teto da pasta estourado falha fechado; teto do documento e do ledger viram lacuna só deles', () => {
  const p = projeto('tetos', KB);
  try {
    const fm = (id: string, extra = '') => `id: ${id}\ntitulo: T\ncolecoes: [rh]\n${extra}`;
    ledger(p.dir, 'ork-x', [{ tipo: 'autonomous_decision' }]);
    documento(p.dir, 'docs/conhecimento/a.md', fm('doc-aaa'));
    documento(p.dir, 'docs/conhecimento/b.md', fm('doc-bbb'), 'x'.repeat(300));
    documento(p.dir, 'docs/conhecimento/d.md', fm('doc-ddd', 'referencias:\n  decisoes: [ork-x#1]\n'));
    documento(p.dir, 'docs/conhecimento/n1/n2/c.md', fm('doc-ccc'));
    const resumo = (k: Conhecimento) => [k.documentos.map((d) => `${d.id}:${d.referencias.decisoes.length}`).join(), k.lacunas.map((l) => l.codigo).join()];
    assert.deepEqual(resumo(ler(p.dir)), ['doc-aaa:0,doc-bbb:0,doc-ccc:0,doc-ddd:1', '']);
    // Da pasta: nenhum documento volta, para a resposta nunca ser parcial sem dizer.
    assert.deepEqual(resumo(ler(p.dir, { entradas: 4 })), ['', 'conhecimento.limite']);
    assert.deepEqual(resumo(ler(p.dir, { profundidade: 1 })), ['', 'conhecimento.limite']);
    assert.deepEqual(resumo(ler(p.dir, { bytesNoTotal: 400 })), ['', 'conhecimento.limite']);
    // Do documento e do ledger: só o que passou do teto vira lacuna.
    assert.deepEqual(resumo(ler(p.dir, { bytesPorDocumento: 200 })), ['doc-aaa:0,doc-ccc:0,doc-ddd:1', 'documento.grande-demais']);
    assert.deepEqual(resumo(ler(p.dir, { bytesDoFrontmatter: 30 })),
      ['', 'documento.frontmatter-invalido,documento.frontmatter-invalido,documento.frontmatter-invalido,documento.frontmatter-invalido']);
    assert.deepEqual(resumo(ler(p.dir, { bytesDoLedger: 10 })), ['doc-aaa:0,doc-bbb:0,doc-ccc:0,doc-ddd:0', 'referencia.decisao-ausente']);
  } finally { p.limpar(); }
});

test('D8: README.md, modelo _*.md, entrada oculta e anexo não são documentos; subpasta é', () => {
  const p = projeto('candidatos', KB);
  try {
    const kb = path.join(p.dir, 'docs', 'conhecimento');
    documento(p.dir, 'docs/conhecimento/area/sub.md', 'id: doc-sub\ntitulo: Na subpasta\ncolecoes: [rh]\n');
    fs.writeFileSync(path.join(kb, 'README.md'), '# Índice, sem frontmatter\n');
    fs.writeFileSync(path.join(kb, '_modelo.md'), '---\nid: <id>\n---\n');
    fs.writeFileSync(path.join(kb, '.rascunho.md'), 'sem frontmatter');
    documento(p.dir, 'docs/conhecimento/.obsidian/oculto.md', 'id: doc-oculto\ntitulo: T\ncolecoes: [rh]\n');
    fs.writeFileSync(path.join(kb, 'anexo.png'), 'png');
    fs.writeFileSync(path.join(kb, 'NOTAS.MD'), 'sem frontmatter');
    const k = ler(p.dir);
    assert.deepEqual(k.documentos.map((d) => [d.id, d.arquivo]), [['doc-sub', 'docs/conhecimento/area/sub.md']]);
    assert.deepEqual(k.lacunas, []);
  } finally { p.limpar(); }
});

test('D9: lerYaml estrito recusa chave repetida, __proto__ e linha fora do bloco; o modo padrão segue igual', () => {
  // O modo padrão, que o orkastery.yaml e as páginas de docs usam, não muda.
  assert.deepEqual(lerYaml('a: 1\na: 2\n'), { a: 2 });
  assert.deepEqual(lerYaml('r:\n  b: [x]\n d: [y]\n'), { r: { b: ['x'] } });

  assert.throws(() => lerYaml('a: 1\na: 2\n', { estrito: true }), /linha 2: chave repetida/);
  assert.throws(() => lerYaml('r:\n  b: 1\n  b: 2\n', { estrito: true }), /linha 3: chave repetida/);
  assert.throws(() => lerYaml('__proto__:\n  id: doc-x\n', { estrito: true }), /linha 1: chave reservada/);
  assert.throws(() => lerYaml('r:\n  b: [x]\n d: [y]\n', { estrito: true }), /linha 3: indentacao fora do bloco/);
  assert.throws(() => lerYaml('a: [x]\n  - y\n', { estrito: true }), /linha 2: indentacao fora do bloco/);
  // O # depois do valor é comentário no YAML: no modo padrão corta o valor, no estrito recusa; entre aspas, vale.
  assert.deepEqual(lerYaml('titulo: Decisao #42\n'), { titulo: 'Decisao' });
  assert.throws(() => lerYaml('titulo: Decisao #42\n', { estrito: true }), /linha 1: comentario depois do valor/);
  assert.deepEqual(lerYaml('# nota\ntitulo: "Decisao #42"\n  # recuado\n', { estrito: true }), { titulo: 'Decisao #42' });

  const valido = 'id: doc-a\ncolecoes: [rh, politicas]\nreferencias:\n  brain:\n    - proj-a\n  decisoes: [ork-x#3]\n';
  assert.deepEqual(lerYaml(valido, { estrito: true }),
    { id: 'doc-a', colecoes: ['rh', 'politicas'], referencias: { brain: ['proj-a'], decisoes: ['ork-x#3'] } });
});

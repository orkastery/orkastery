/**
 * RM-026 K7, fatia 2: `ork conhecimento listar|mostrar|colecoes|verificar` pela CLI de verdade, com o Brain falso
 * atrás do transporte do Company Brain (o `memory.cli` do manifesto, como o `ork brain get`). Cada teste reprova no
 * código de antes desta fatia: a base (`1079f471`) não tem o comando. Os nomes começam pela decisão do PLAN (D11 a D13).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { INVISIVEL } from '../src/saida-segura';
import { CLI, cenario, Cenario, EN, linhasEmPortugues, PT, Saida } from './locale-apoio';

const DSN = { KB_FAKE_DSN: 'sintetico-nao-e-conexao' };

/** O Brain falso: responde o `get` como o OrkMind e anota cada pedido no `brain.log` da casa do cenário. */
function orkmindFalso(c: Cenario): string {
  const arquivo = path.join(c.casa, 'orkmind-falso.cjs');
  fs.writeFileSync(arquivo, `#!${process.execPath}
const fs = require('fs'), crypto = require('crypto');
const API = 'orkmind.company-brain-api/v1';
const pedido = JSON.parse(fs.readFileSync(0, 'utf8'));
const id = pedido.payload && pedido.payload.id;
fs.appendFileSync(${JSON.stringify(path.join(c.casa, 'brain.log'))}, pedido.operation + ' ' + id + '\\n');
const responder = (r) => process.stdout.write(JSON.stringify({ schema: API, ...r }));
if (pedido.operation !== 'get') { responder({ state: 'unavailable', error: 'brain.test.unexpected' }); process.exit(1); }
if (id !== 'proj-portal-rh') responder({ state: 'unknown' });
else responder({ state: 'ok', entity: { schema: 'orkmind.company-brain-entity/v1', tenant_id: process.env.ORKMIND_BRAIN_TENANT, id,
  kind: 'proj', version: 3, parent_id: 'prod-portal', workspace_ids: [], depends_on: [], aliases: [{ system: 'ork', instance: 'loc', id }],
  title: 'People portal', description: '', status: 'in_progress', acceptance_criteria: [], owner: { raw: null, state: 'unknown', principal: null },
  source: { authority: 'ork', instance: 'loc', source_ref: 'portfolio.json#' + id, source_hash: crypto.createHash('sha256').update(id).digest('hex'),
    source_version: 3, location: 'id:' + id }, acl_ref: 'ork-factory', observed_at: null, recorded_at: null } });
`, { mode: 0o755 });
  return arquivo;
}

function documento(c: Cenario, rel: string, frontmatter: string, corpo = '# Guide\n\nTwo periods a year.\n'): string {
  const texto = `---\n${frontmatter}---\n${corpo}`;
  const abs = path.join(c.dir, 'docs', 'conhecimento', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
  return texto;
}

/** O projeto do cenário com a pasta de conhecimento, o Brain falso e o ledger de uma thread. */
function cenarioDoConhecimento(nome: string): Cenario {
  const c = cenario(`conhecimento-${nome}`);
  fs.writeFileSync(path.join(c.dir, 'orkastery.yaml'), 'project:\n  name: "loc"\n  abbrev: "loc"\nconhecimento:\n  dir: docs/conhecimento\n' +
    `memory:\n  mode: orkmind\n  tenant: loc\n  database_url_env: "KB_FAKE_DSN"\n  cli: ${JSON.stringify(orkmindFalso(c))}\n`);
  const pasta = path.join(c.dir, '.orkastery', 'threads', 'ork-x');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'ledger.jsonl'), ['thread_created', 'autonomous_decision']
    .map((tipo) => JSON.stringify({ ts: '2026-10-12T12:00:00.000Z', thread: 'ork-x', tipo })).join('\n') + '\n');
  documento(c, 'rh/vacation.md', 'id: doc-vacation\ntitulo: Vacation policy\ncolecoes: [people, policies]\nreferencias:\n' +
    '  brain: [proj-portal-rh, proj-gone]\n  decisoes: [ork-x#2]\n');
  documento(c, 'deploy.md', 'id: doc-deploy\ntitulo: Deploy guide\ncolecoes: [engineering]\n');
  return c;
}

function ork(c: Cenario, locale: Record<string, string>, extra: Record<string, string>, ...args: string[]): Saida {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: c.dir, encoding: 'utf8', timeout: 120000, env: { HOME: c.casa, TZ: 'America/New_York', ...locale, PATH: c.bin, ...extra },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const pedidosAoBrain = (c: Cenario) => {
  const log = path.join(c.casa, 'brain.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
};

test('D11: ork conhecimento responde pela CLI o JSON da consulta, com o id do Brain conferido por get, e verificar sai 1 com lacuna', () => {
  const c = cenarioDoConhecimento('json');
  try {
    const json = (args: string[], extra: Record<string, string> = DSN) => {
      const r = ork(c, PT, extra, 'conhecimento', ...args, '--json');
      assert.equal(r.stderr, '', args.join(' '));
      return { status: r.status, dado: JSON.parse(r.stdout) };
    };
    const listar = json(['listar']);
    assert.equal(listar.status, 0);
    assert.deepEqual(listar.dado.documentos.map((d: { id: string }) => d.id), ['doc-deploy', 'doc-vacation']);
    assert.ok(!JSON.stringify(listar.dado).includes('referencias'), 'listar não mostra referência');
    assert.deepEqual(json(['listar', '--colecao', 'people']).dado.documentos.map((d: { id: string }) => d.id), ['doc-vacation']);
    assert.equal(json(['colecoes']).status, 0);
    // Sem o subcomando, é o listar.
    assert.equal(ork(c, PT, DSN, 'conhecimento', '--json').stdout, ork(c, PT, DSN, 'conhecimento', 'listar', '--json').stdout);
    assert.deepEqual(pedidosAoBrain(c), [], 'listar e colecoes não abrem o Brain');

    const mostrar = json(['mostrar', 'doc-vacation']);
    assert.equal(mostrar.status, 0);
    assert.deepEqual(pedidosAoBrain(c), ['get proj-gone', 'get proj-portal-rh'], 'um get por id, pelo transporte do Brain');
    assert.deepEqual(mostrar.dado.documento.referencias.brain, [{ id: 'proj-portal-rh', kind: 'proj', titulo: 'People portal', versao: 3,
      fonte: 'portfolio.json#proj-portal-rh', sha256: require('node:crypto').createHash('sha256').update('proj-portal-rh').digest('hex') }]);
    assert.deepEqual(mostrar.dado.documento.referencias.decisoes.map((d: { ref: string }) => d.ref), ['ork-x#2']);
    assert.equal(mostrar.dado.documento.corpo, '# Guide\n\nTwo periods a year.\n');
    assert.deepEqual(mostrar.dado.lacunas.map((l: { codigo: string; referencia: string }) => [l.codigo, l.referencia]),
      [['referencia.brain-inexistente', 'proj-gone']]);
    assert.equal(json(['mostrar', 'doc-nao-tem']).status, 1, 'mostrar sem documento sai 1');

    const verificar = json(['verificar']);
    assert.equal(verificar.status, 1, 'verificar com lacuna sai 1');
    assert.deepEqual(verificar.dado.lacunas.map((l: { codigo: string }) => l.codigo), ['referencia.brain-inexistente']);
    // Brain fora do ar (sem a DSN): outra lacuna, distinta do id inexistente, e verificar segue saindo 1.
    const fora = json(['verificar'], {});
    assert.equal(fora.status, 1);
    assert.deepEqual(fora.dado.lacunas.map((l: { codigo: string; referencia: string }) => [l.codigo, l.referencia]),
      [['referencia.brain-indisponivel', 'proj-gone'], ['referencia.brain-indisponivel', 'proj-portal-rh']]);
    // Sem lacuna, verificar sai 0.
    documento(c, 'rh/vacation.md', 'id: doc-vacation\ntitulo: Vacation policy\ncolecoes: [people, policies]\nreferencias:\n' +
      '  brain: [proj-portal-rh]\n  decisoes: [ork-x#2]\n');
    const limpo = json(['verificar']);
    assert.deepEqual([limpo.status, limpo.dado.lacunas], [0, []]);
    assert.equal(limpo.dado.documentos.find((d: { id: string }) => d.id === 'doc-vacation').referencias.brain[0].titulo, 'People portal');
  } finally { c.limpar(); }
});

test('D13: o texto de ork conhecimento sai pelo catálogo em pt-BR e em inglês, e o --json é o mesmo nas duas línguas', () => {
  const c = cenarioDoConhecimento('locale');
  try {
    const texto = (locale: Record<string, string>, ...args: string[]) => {
      const r = ork(c, locale, DSN, 'conhecimento', ...args);
      assert.equal(r.stderr, '', args.join(' '));
      return { status: r.status, linhas: r.stdout.split('\n') };
    };
    const sha = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(c.dir, 'docs/conhecimento/rh/vacation.md'))).digest('hex');
    assert.deepEqual(texto(PT, 'listar').linhas.slice(0, 3), ['Conhecimento em docs/conhecimento: 2 documento(s).',
      '  doc-deploy    Deploy guide (engineering)', '  doc-vacation  Vacation policy (people, policies)']);
    assert.deepEqual(texto(EN, 'listar').linhas, ['Knowledge in docs/conhecimento: 2 document(s).',
      '  doc-deploy    Deploy guide (engineering)', '  doc-vacation  Vacation policy (people, policies)',
      'To read a document: `ork conhecimento mostrar <doc-id>`.', '']);
    assert.deepEqual(texto(EN, 'colecoes').linhas, ['Collections in docs/conhecimento: 3.', '  engineering  doc-deploy',
      '  people       doc-vacation', '  policies     doc-vacation', '']);
    const mostrar = texto(EN, 'mostrar', 'doc-vacation');
    assert.equal(mostrar.status, 0);
    assert.deepEqual(mostrar.linhas, ['doc-vacation: Vacation policy', '  collections  people, policies',
      '  file         docs/conhecimento/rh/vacation.md', `  version      sha256 ${sha}, ${fs.statSync(path.join(c.dir, 'docs/conhecimento/rh/vacation.md')).size} bytes`,
      '  Brain        proj-portal-rh: People portal (proj, version 3, source portfolio.json#proj-portal-rh)',
      '  decision     ork-x#2: autonomous_decision (source threads/ork-x/ledger.jsonl#L2)',
      '1 gap(s), what was left out of the answer:',
      '  referencia.brain-inexistente  docs/conhecimento/rh/vacation.md (doc-vacation), reference proj-gone: ' +
        'the Company Brain does not have this id (get answered unknown)',
      '', 'Document body:', '# Guide', '', 'Two periods a year.', '']);
    assert.deepEqual(texto(PT, 'mostrar', 'doc-vacation').linhas.slice(1, 3), ['  coleções   people, policies',
      '  arquivo    docs/conhecimento/rh/vacation.md']);
    const verificar = texto(EN, 'verificar');
    assert.equal(verificar.status, 1);
    assert.deepEqual([verificar.linhas[0], verificar.linhas.at(-2)], ['Knowledge in docs/conhecimento: 2 valid document(s), ' +
      '1 Brain id(s) and 1 decision(s) checked.', 'Check failed: 1 gap(s).']);
    assert.equal(texto(PT, 'verificar').linhas.at(-2), 'Verificação reprovada: 1 lacuna(s).');
    assert.deepEqual(texto(PT, 'listar', '--colecao', 'people').linhas.slice(0, 2), ['Conhecimento em docs/conhecimento, coleção people: 1 documento(s).',
      '  doc-vacation  Vacation policy (people, policies)']);
    assert.equal(texto(EN, 'listar', '--colecao', 'nada').linhas.join('\n'),
      'Knowledge in docs/conhecimento, collection nada: 0 document(s).\n  (no document)\n');
    // Nenhuma palavra pt-BR no texto em inglês (o que é dado do repositório já está em inglês no cenário).
    for (const args of [['listar'], ['colecoes'], ['mostrar', 'doc-vacation'], ['mostrar', 'doc-nao-tem'], ['verificar']]) {
      assert.deepEqual(linhasEmPortugues(texto(EN, ...args).linhas.join('\n')), [], args.join(' '));
      const pt = ork(c, PT, DSN, 'conhecimento', ...args, '--json'), en = ork(c, EN, DSN, 'conhecimento', ...args, '--json');
      assert.equal(en.stdout, pt.stdout, `--json igual nas duas línguas: ${args.join(' ')}`);
      assert.equal(en.status, pt.status);
    }
    assert.ok(linhasEmPortugues(texto(PT, 'verificar').linhas.join('\n')).length > 0, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('D13: uso errado de ork conhecimento sai 2 e recusa pelo catálogo, nas duas línguas, sem ler nada', () => {
  const c = cenarioDoConhecimento('uso');
  try {
    for (const args of [['mostrar'], ['mostrar', 'DOC-X'], ['mostrar', 'doc-aaa', 'doc-bbb'], ['listar', '--colecao', 'RH'],
      ['listar', '--colecao'], ['colecoes', '--colecao', 'rh'], ['verificar', 'doc-aaa'], ['ler', 'doc-aaa']]) {
      const pt = ork(c, PT, DSN, 'conhecimento', ...args), en = ork(c, EN, DSN, 'conhecimento', ...args);
      // Saída 2, e não 1: o gate de CI separa o uso errado da lacuna (achado do CHECK).
      assert.deepEqual([pt.status, pt.stdout, pt.stderr], [2, '',
        'erro: uso: ork conhecimento [listar [--colecao C]|mostrar <doc-id>|colecoes|verificar] [--json]\n'], args.join(' '));
      assert.deepEqual([en.status, en.stdout, en.stderr], [2, '',
        'error: usage: ork conhecimento [listar [--colecao C]|mostrar <doc-id>|colecoes|verificar] [--json]\n'], args.join(' '));
    }
    // Com --json o texto não segue o locale (a regra da RM-061): o uso errado sai em pt-BR nas duas línguas.
    for (const locale of [PT, EN]) {
      const r = ork(c, locale, DSN, 'conhecimento', 'verificar', '--json=sim');
      assert.deepEqual([r.status, r.stderr], [2, 'erro: uso: ork conhecimento [listar [--colecao C]|mostrar <doc-id>|colecoes|verificar] [--json]\n']);
    }
    assert.deepEqual(pedidosAoBrain(c), []);
  } finally { c.limpar(); }
});

test('D13: o corpo com caractere invisível vem inteiro no --json, escrito como \\uXXXX, e limpo no texto', () => {
  const c = cenarioDoConhecimento('invisivel');
  try {
    const esc = String.fromCharCode(0x1b), csi = String.fromCharCode(0x9b), rlo = String.fromCharCode(0x202e), zw = String.fromCharCode(0x200b);
    const corpo = `# Guide\n\nred ${esc}[31malert${esc}[0m, ${csi}2J clear, ${rlo}reversed, zero${zw}width.\n`;
    documento(c, 'deploy.md', 'id: doc-deploy\ntitulo: Deploy guide\ncolecoes: [engineering]\n', corpo);
    const json = ork(c, EN, DSN, 'conhecimento', 'mostrar', 'doc-deploy', '--json');
    assert.equal(json.status, 0, json.stderr);
    assert.ok(!INVISIVEL.test(json.stdout.replace(/\n/g, '')), 'nenhum invisível cru no --json');
    assert.ok(json.stdout.includes('\\u009b2J') && json.stdout.includes('\\u202ereversed'));
    assert.equal(JSON.parse(json.stdout).documento.corpo, corpo, 'o valor é o corpo inteiro');
    const texto = ork(c, EN, DSN, 'conhecimento', 'mostrar', 'doc-deploy');
    assert.equal(texto.status, 0, texto.stderr);
    assert.ok(!INVISIVEL.test(texto.stdout.replace(/\n/g, '')), 'nenhum invisível no texto');
    assert.ok(texto.stdout.includes('red [31malert[0m, 2J clear, reversed, zerowidth.\n'), texto.stdout);
  } finally { c.limpar(); }
});

test('D13 revista: o texto do mostrar sai inteiro para um documento de muitas linhas, e a pasta não lida sai 1 pelo catálogo', () => {
  const c = cenarioDoConhecimento('longo');
  try {
    // Mais de 130 mil linhas estouravam a pilha quando o corpo ia espalhado nos argumentos (achado do CHECK).
    documento(c, 'deploy.md', 'id: doc-deploy\ntitulo: Deploy guide\ncolecoes: [engineering]\n', 'x\n'.repeat(200000) + 'last line\n');
    const r = ork(c, EN, DSN, 'conhecimento', 'mostrar', 'doc-deploy');
    assert.equal(r.status, 0, r.stderr.slice(0, 300));
    const linhas = r.stdout.split('\n');
    assert.equal(linhas.filter((l) => l === 'x').length, 200000);
    assert.equal(linhas.at(-2), 'last line');
    // A pasta que não existe: nada foi lido, as quatro consultas saem 1, e o texto diz isso pelo catálogo.
    fs.rmSync(path.join(c.dir, 'docs', 'conhecimento'), { recursive: true, force: true });
    for (const [locale, cabeca] of [[PT, 'Conhecimento: a pasta não foi lida.'], [EN, 'Knowledge: the folder was not read.']] as const) {
      for (const args of [['listar'], ['colecoes'], ['mostrar', 'doc-deploy'], ['verificar']]) {
        const x = ork(c, locale, DSN, 'conhecimento', ...args);
        assert.equal(x.status, 1, args.join(' '));
        assert.equal(x.stdout.split('\n')[0], cabeca, args.join(' '));
        assert.ok(x.stdout.includes('conhecimento.dir-ausente'), x.stdout);
      }
    }
  } finally { c.limpar(); }
});

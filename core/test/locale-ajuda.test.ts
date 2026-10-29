/**
 * RM-061, fatia F2a: a ajuda do CLI em ingles (`ork`, `ork --help`, `ork help`, `ork <comando> --help` e o
 * comando desconhecido), com as mesmas linhas de comando e as mesmas flags da pt-BR, na mesma ordem. Os
 * nomes comecam por "locale en F2a ajuda:" para cada claim rodar so o seu. O pt-BR byte a byte fica com o
 * snapshot (`locale-f2a-snapshot`).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { msg } from '../src/locale';
import { DadosDaAjuda } from '../src/locale-ajuda';
import { cenario, EN, linhasEmPortugues, ork, orkEm, PT } from './locale-apoio';

const DADOS: DadosDaAjuda = { versao: '9.9.9', modos: 4, segredos: 'S', tags: '#Classic #Maestro #Auto #Fast' };
const flags = (t: string) => t.match(/(?<![\w-])--[a-z][a-z0-9-]*/g) ?? [];
/** `projetos registrar`, `thread new`: a cabeca de comando de cada linha (o nome do comando nao muda com a lingua). */
const cabeca = (l: string) => /^ {2}([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/.exec(l)?.slice(1).join(' ') ?? null;
const semCabecas = (t: string) => t.replace(/^ {2}[a-z][a-z-]*(?: [a-z][a-z-]*)?/gm, ' ');

test('locale en F2a ajuda: --help, help, sem comando e <comando> --help saem em ingles, iguais entre si', () => {
  const c = cenario('ajuda-en');
  try {
    const ajuda = ork(c, EN, false, '--help');
    assert.equal(ajuda.status, 0, ajuda.stderr);
    const l = ajuda.stdout.split('\n');
    assert.match(l[0], /^ork \d+\.\d+\.\d+\S*, the Orkastery orchestration core$/);
    assert.equal(l[2], 'Usage: ork [--projeto <name|path>] <command> [arguments]');
    assert.match(ajuda.stdout, /\n {2}doctor {36}What holds on this machine now \(exits != 0 when blocked\)\n/);
    assert.match(ajuda.stdout, /\n {2}thread new <name> --modo <MODE> {11}Creates the thread, the 3-part slug and the ledger\n/);
    assert.match(ajuda.stdout, /\n {8}\[--conteudo JSON\] \[--por Q\] \[--json\] {2}Secrets live in the process environment or in the host vault \(with Hermes, ~\/\.hermes\/\.env\)\n/);
    for (const args of [['help'], [], ['thread', '--help'], ['phase', 'run', '--help']]) {
      assert.equal(ork(c, EN, false, ...args).stdout, ajuda.stdout, args.join(' '));
    }
    assert.deepEqual(linhasEmPortugues(semCabecas(ajuda.stdout)), []);
    // Controle do detector: a mesma ajuda em pt-BR e acusada em centenas de linhas.
    assert.ok(linhasEmPortugues(semCabecas(ork(c, PT, false, '--help').stdout)).length >= 100, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2a ajuda: a inglesa tem as mesmas linhas de comando e as mesmas flags, na mesma ordem', () => {
  const pt = msg('pt-BR').ajuda.texto(DADOS), en = msg('en').ajuda.texto(DADOS);
  const lp = pt.split('\n'), le = en.split('\n');
  assert.equal(le.length, lp.length);
  assert.deepEqual(flags(en), flags(pt));
  assert.ok(flags(pt).length > 300, 'a ajuda cita as flags');
  lp.forEach((p, i) => {
    assert.equal(cabeca(le[i]), cabeca(p), `linha ${i + 1}`);
    assert.equal(le[i] === '', p === '', `linha em branco ${i + 1}`);
    // Toda linha pt-BR com texto de pessoa mudou no ingles.
    if (linhasEmPortugues(semCabecas(p)).length) assert.notEqual(le[i], p, `linha ${i + 1} sem traducao`);
  });
  assert.ok(en.includes('9.9.9') && en.includes('#Classic #Maestro #Auto #Fast') && en.includes('Secrets live S'));
});

test('locale en F2a ajuda: comando desconhecido em ingles, com a ajuda e saida 2', () => {
  const c = cenario('ajuda-desconhecido');
  try {
    const r = ork(c, EN, false, 'nada-disso');
    assert.equal(r.status, 2);
    assert.equal(r.stderr, 'unknown command: nada-disso\n');
    assert.equal(r.stdout, ork(c, EN, false, '--help').stdout);
  } finally { c.limpar(); }
});

test('locale en F2a ajuda: a escolha do onboarding vence o LANG, nos dois sentidos', () => {
  const c = cenario('ajuda-owner');
  try {
    const pt = ork(c, PT, false, '--help').stdout, en = ork(c, EN, false, '--help').stdout;
    assert.match(pt, /^ork \S+, nucleo de orquestracao do Orkastery\n/);
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, PT, false, '--help').stdout, en);
    assert.equal(ork(c, EN, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"pt-BR"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, EN, false, '--help').stdout, pt);
  } finally { c.limpar(); }
});

test('locale en F2a ajuda: com --projeto, vale o owner.language do projeto-alvo', () => {
  const c = cenario('ajuda-projeto');
  try {
    const en = ork(c, EN, false, '--help').stdout;
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    // Fora do projeto (o HOME do cenario, onde o init registrou o projeto): o --projeto escolhe o manifesto.
    assert.equal(orkEm(c, c.casa, PT, false, '--projeto', 'loc', '--help').stdout, en);
    assert.match(orkEm(c, c.casa, PT, false, '--help').stdout, /^ork \S+, nucleo de orquestracao do Orkastery\n/);
  } finally { c.limpar(); }
});

test('locale en F2a ajuda: comando fora da F3e segue igual com LANG=en_US', () => {
  const c = cenario('ajuda-fora-f3e');
  try {
    const pt = ork(c, PT, false, 'noctum'), en = ork(c, EN, false, 'noctum');
    assert.equal(pt.status, 2);
    assert.equal(en.status, 2);
    assert.equal(en.stdout, pt.stdout);
    assert.equal(en.stderr, pt.stderr);
  } finally { c.limpar(); }
});

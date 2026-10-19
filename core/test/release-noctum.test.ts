/**
 * RM-058, integração (T9 da ork-rm058integra, D13): o portão de release do #Noctum (`core/scripts/checar-release-noctum.cjs`).
 * Na tag, a versão só sai com o aceite dos pilotos exigidos, aprovados, não simulados e ratificados pelo dono; no CI de
 * documentação, nenhum texto anuncia o #Noctum como lançado, entregue, validado ou disponível sem esse aceite. Os nomes
 * começam por RG. Os aceites e os textos são de fixture, numa pasta descartável.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirTemporario } from './apoio';

const SCRIPT = path.resolve(__dirname, '../../scripts/checar-release-noctum.cjs');
const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');
const PASTA = 'docs/roadmap/evidencias/RM-058';

const rodar = (raiz: string, ...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args, raiz], { encoding: 'utf8', timeout: 60_000 });

interface Piloto { id: string; arquivo: string; sha256: string; simulado: boolean; veredito: string }

/** O aceite de fixture: os quatro pilotos publicáveis, aprovados, e a ratificação; `mexer` o estraga do jeito do caso. */
function aceite(raiz: string, mexer: (a: { contrato: string; pilotos: Piloto[]; ratificacao?: Record<string, string> }) => void = () => {}): void {
  fs.mkdirSync(path.join(raiz, PASTA), { recursive: true });
  const pilotos = ['P1', 'P2', 'P3', 'P4'].map((id, i) => {
    const arquivo = `piloto-${i + 1}.json`;
    const texto = `${JSON.stringify({ contrato: 'ork.noctum-piloto/v1', arco: `arco-piloto-${i + 1}`, simulacao: { simulado: false, marcas: [] },
      veredito: 'aprovado', publicavel: true, sha256DoCompleto: 'c'.repeat(64) }, null, 2)}\n`;
    fs.writeFileSync(path.join(raiz, PASTA, arquivo), texto);
    return { id, arquivo, sha256: createHash('sha256').update(texto).digest('hex'), simulado: false, veredito: 'aprovado' };
  });
  const a = { contrato: 'ork.noctum-aceite/v1', pilotos, ratificacao: { por: 'dono-do-projeto', recibo: 'ingresso:telegram:SIMULADO-1', em: '2026-01-01T00:00:00.000Z' } as Record<string, string> | undefined };
  mexer(a as never);
  fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a, null, 2));
}

function emPasta<T>(nome: string, fn: (raiz: string) => T): T {
  const raiz = dirTemporario(nome);
  try { return fn(raiz); } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
}

test('RG1: sem o aceite dos pilotos, a tag não publica: sai 1 com o motivo e a regra', () => {
  emPasta('rg1', (raiz) => {
    const r = rodar(raiz);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.aceite-ausente: docs\/roadmap\/evidencias\/RM-058\/aceite\.json não existe: a regra do dono \(toda-versao\)/);
    assert.match(r.stderr, /pilotos P1, P2, P3, P4 aprovados e ratificados/);
  });
});

test('RG2: o aceite com um piloto simulado (o ensaio) recusa, pelo aceite ou pelo arquivo publicável', () => {
  emPasta('rg2', (raiz) => {
    aceite(raiz, (a) => { a.pilotos[1].simulado = true; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-simulado: o piloto P2 é simulado/);
    aceite(raiz);
    const arquivo = path.join(raiz, PASTA, 'piloto-3.json');
    const texto = fs.readFileSync(arquivo, 'utf8').replace('"simulado": false', '"simulado": true');
    fs.writeFileSync(arquivo, texto);
    const a = JSON.parse(fs.readFileSync(path.join(raiz, PASTA, 'aceite.json'), 'utf8'));
    a.pilotos[2].sha256 = createHash('sha256').update(texto).digest('hex');
    fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a));
    const r = rodar(raiz);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.piloto-simulado: o piloto P3 é simulado/);
  });
});

test('RG3: o piloto exigido que falta recusa, no aceite ou no disco', () => {
  emPasta('rg3', (raiz) => {
    aceite(raiz, (a) => { a.pilotos = a.pilotos.filter(p => p.id !== 'P4'); });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-faltando: o piloto P4 não está no aceite \(exigidos: P1, P2, P3, P4\)/);
    aceite(raiz);
    fs.rmSync(path.join(raiz, PASTA, 'piloto-2.json'));
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-faltando: o arquivo piloto-2\.json do piloto P2 não existe/);
  });
});

test('RG4: o sha256 que não bate com o arquivo publicável recusa', () => {
  emPasta('rg4', (raiz) => {
    aceite(raiz);
    fs.appendFileSync(path.join(raiz, PASTA, 'piloto-1.json'), ' ');
    const r = rodar(raiz);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.sha256-diverge: o sha256 do piloto P1 no aceite não bate com piloto-1\.json/);
  });
});

test('RG5: sem a ratificação do dono (quem, o recibo do ingresso e quando), recusa; o veredito que não é aprovado também', () => {
  emPasta('rg5', (raiz) => {
    aceite(raiz, (a) => { delete a.ratificacao; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.sem-ratificacao: falta a ratificação do dono/);
    aceite(raiz, (a) => { a.ratificacao = { por: 'dono-do-projeto', recibo: '', em: '2026-01-01T00:00:00.000Z' }; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.sem-ratificacao/);
    aceite(raiz, (a) => { a.pilotos[0].veredito = 'incompleto'; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-nao-aprovado: o piloto P1/);
  });
});

test('RG6: o aceite de fixture válido sai 0, e com ele o texto pode anunciar o #Noctum', () => {
  emPasta('rg6', (raiz) => {
    aceite(raiz);
    const r = rodar(raiz);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^release\.noctum: o aceite confere: pilotos P1, P2, P3, P4 aprovados, ratificados por dono-do-projeto/);
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nO #Noctum foi validado pelos pilotos.\n');
    assert.equal(rodar(raiz, '--texto').status, 0);
  });
});

test('RG7: sem o aceite, "o #Noctum foi lançado" no README recusa o texto, com o arquivo e a linha', () => {
  emPasta('rg7', (raiz) => {
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nNovidade: o #Noctum foi lançado nesta versão.\n');
    fs.mkdirSync(path.join(raiz, 'docs', 'guias'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'docs', 'guias', 'noite.md'), '# Noite\n\nHoje o Noctum está disponível para todos.\n');
    const r = rodar(raiz, '--texto');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.texto-sem-aceite: 2 trecho\(s\) anunciam o #Noctum sem o aceite dos pilotos \(release\.noctum\.aceite-ausente\)/);
    assert.match(r.stderr, /README\.md:3: #Noctum foi lançado/);
    assert.match(r.stderr, /docs\/guias\/noite\.md:3: Noctum está disponível/);
  });
});

test('RG8: a negação na mesma oração libera, e a evidência dos pilotos fica de fora', () => {
  emPasta('rg8', (raiz) => {
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nO #Noctum ainda não foi validado por pilotos reais.\n\n' +
      'Sem o aceite, o #Noctum não é entregue a ninguém. Nem o Noctum está disponível sem envelope.\n');
    fs.mkdirSync(path.join(raiz, PASTA), { recursive: true });
    fs.writeFileSync(path.join(raiz, PASTA, 'notas.md'), 'O #Noctum foi validado no piloto (evidência).\n');
    const r = rodar(raiz, '--texto');
    assert.equal(r.status, 0, r.stderr);
  });
});

test('RG9: em inglês, "Noctum is released" recusa, e "Noctum is not released" passa', () => {
  emPasta('rg9', (raiz) => {
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Product\n\nThe Noctum is released today.\n');
    const r = rodar(raiz, '--texto');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /README\.md:3: Noctum is released/);
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Product\n\nThe Noctum is not released: it has yet to pass the pilots.\n');
    assert.equal(rodar(raiz, '--texto').status, 0);
  });
});

test('RG10: a árvore desta thread passa no --texto, o alcance é toda versão, e os workflows chamam o portão', () => {
  const r = rodar(RAIZ_DO_REPO, '--texto');
  assert.equal(r.status, 0, r.stderr);
  const fonte = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(fonte, /^const ALCANCE = 'toda-versao';$/m);
  assert.match(fonte, /^const PILOTOS_EXIGIDOS = \['P1', 'P2', 'P3', 'P4'\];$/m);
  assert.doesNotMatch(fonte, /require\('node:(?:https?|net|child_process)'\)|core\/dist/, 'o portão só lê arquivos');
  assert.match(fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/publicar.yml'), 'utf8'),
    /run: node core\/scripts\/checar-release-noctum\.cjs\n[\s\S]*run: npm publish/);
  assert.match(fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/ci.yml'), 'utf8'), /run: node core\/scripts\/checar-release-noctum\.cjs --texto/);
  assert.equal(rodar(RAIZ_DO_REPO, '--outra').status, 2);
});

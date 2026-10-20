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
    const horas = [6, 12, 6, 12][i];
    const inicio = Date.parse(`2025-12-0${i + 1}T00:00:00.000Z`);
    const janela = { inicio: new Date(inicio).toISOString(), fim: new Date(inicio + horas * 3_600_000).toISOString(), horas };
    const texto = `${JSON.stringify({ contrato: 'ork.noctum-piloto/v1', arco: `arco-piloto-${i + 1}`, janela,
      simulacao: { simulado: false, marcas: [] }, veredito: 'aprovado', publicavel: true, sha256DoCompleto: 'c'.repeat(64) }, null, 2)}\n`;
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

test('RG8: a negação do verbo libera, entre o nome e o particípio ou logo antes do nome, e a evidência dos pilotos fica de fora', () => {
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

test('RG11: o mesmo piloto não vale por quatro, e o piloto de 12 h com janela curta recusa', () => {
  emPasta('rg11', (raiz) => {
    aceite(raiz, (a) => { for (const p of a.pilotos) { p.arquivo = a.pilotos[0].arquivo; p.sha256 = a.pilotos[0].sha256; } });
    const r = rodar(raiz);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.piloto-repetido: os pilotos P1 e P2 têm o mesmo arquivo/);
    aceite(raiz);
    const arquivo = path.join(raiz, PASTA, 'piloto-2.json');
    const texto = fs.readFileSync(arquivo, 'utf8').replace('"horas": 12', '"horas": 6');
    fs.writeFileSync(arquivo, texto);
    const a = JSON.parse(fs.readFileSync(path.join(raiz, PASTA, 'aceite.json'), 'utf8'));
    a.pilotos[1].sha256 = createHash('sha256').update(texto).digest('hex');
    fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a));
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-curto: o piloto P2 pede ao menos 12 h de janela, e o arquivo piloto-2\.json diz 6/);
  });
});

test('RG12: o anúncio com advérbio e a negação depois do particípio recusam; a negação antes libera; os README dos adaptadores entram', () => {
  emPasta('rg12', (raiz) => {
    const recusadas = ['O #Noctum já foi validado por pilotos reais.', '#Noctum is now available in 0.6.0.',
      'O #Noctum foi validado sem nenhuma falha nos pilotos.', 'O #Noctum foi entregue e não depende mais do dono.',
      '#Noctum has been released, not just announced.'];
    for (const [i, frase] of recusadas.entries()) {
      fs.writeFileSync(path.join(raiz, 'README.md'), `# Produto\n\n${frase}\n`);
      const r = rodar(raiz, '--texto');
      assert.equal(r.status, 1, `deveria recusar: ${frase}`);
      assert.match(r.stderr, /README\.md:3: /, `${i}: ${r.stderr}`);
    }
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nO #Noctum ainda não foi validado. The #Noctum is not yet released.\n');
    assert.equal(rodar(raiz, '--texto').status, 0);
    fs.mkdirSync(path.join(raiz, 'adapters', 'hermes'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'adapters', 'hermes', 'README.md'), '# Hermes\n\nO #Noctum está disponível neste gateway.\n');
    const r = rodar(raiz, '--texto');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /adapters\/hermes\/README\.md:3: #Noctum está disponível/);
  });
});

test('RG13: o nome em Markdown, a vírgula e a negação longe do nome não escondem o anúncio; o README do pacote e os marketplaces entram; a descrição correta passa', () => {
  emPasta('rg13', (raiz) => {
    const recusadas = ['- **#Noctum** está disponível para todos ([RM-058](docs/roadmap/RM-058-modo-noctum.md)).', 'O `#Noctum` foi validado nos quatro pilotos.',
      '**Noctum** is now available.', 'O #Noctum, enfim, foi lançado.', 'Sem custo extra, o #Noctum já está disponível.', 'Não é segredo: o #Noctum foi validado.'];
    for (const frase of recusadas) {
      fs.writeFileSync(path.join(raiz, 'README.md'), `# Produto\n\n${frase}\n`);
      const r = rodar(raiz, '--texto');
      assert.equal(r.status, 1, `deveria recusar: ${frase}`);
      assert.match(r.stderr, /README\.md:3: /);
    }
    // A descrição do que o #Noctum faz e a negação, com a quebra de linha do Markdown antes do nome, passam.
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nO relatório da manhã do #Noctum é entregue às 07:00 no canal do dono.\n' +
      'O envelope do #Noctum é validado pelo núcleo antes de cada efeito.\n\nO modo noturno, o\n#Noctum, ainda não foi validado. Nem o #Noctum está disponível.\n');
    const certo = rodar(raiz, '--texto');
    assert.equal(certo.status, 0, certo.stderr);
    // O README do pacote e as fontes da listagem dos marketplaces são texto público.
    fs.mkdirSync(path.join(raiz, 'core'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'core', 'README.md'), '# Pacote\n\nThe #Noctum is available.\n');
    fs.mkdirSync(path.join(raiz, 'marketplaces', 'fontes'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'marketplaces', 'fontes', 'listagem.json'), '{\n  "descricao": "O #Noctum foi lançado."\n}\n');
    const r = rodar(raiz, '--texto');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /core\/README\.md:3: #Noctum is available/);
    assert.match(r.stderr, /marketplaces\/fontes\/listagem\.json:2: #Noctum foi lançado/);
  });
});

test('RG14: o sha256 repetido e o arco repetido recusam, cada um pelo seu campo', () => {
  emPasta('rg14', (raiz) => {
    // O mesmo arquivo com outro nome: o mesmo sha256.
    aceite(raiz, (a) => { a.pilotos[2].sha256 = a.pilotos[0].sha256; });
    fs.copyFileSync(path.join(raiz, PASTA, 'piloto-1.json'), path.join(raiz, PASTA, 'piloto-3.json'));
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-repetido: os pilotos P1 e P3 têm o mesmo sha256/);
    // O mesmo piloto com um espaço a mais: outro sha256, o mesmo arco.
    aceite(raiz);
    const texto = `${fs.readFileSync(path.join(raiz, PASTA, 'piloto-1.json'), 'utf8')} `;
    fs.writeFileSync(path.join(raiz, PASTA, 'piloto-3.json'), texto);
    const a = JSON.parse(fs.readFileSync(path.join(raiz, PASTA, 'aceite.json'), 'utf8'));
    a.pilotos[2].sha256 = createHash('sha256').update(texto).digest('hex');
    fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a));
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-repetido: os pilotos P1 e P3 têm o mesmo arco \(arco-piloto-1\)/);
  });
});

test('RG15: o comando ork noctum e a vírgula que troca o sujeito passam; o link, o é lançado, a negação de outra linha e o não só recusam', () => {
  emPasta('rg15', (raiz) => {
    // N2 do CHECK 3: o comando não é o produto, e a vírgula sozinha não liga o nome ao verbo de outro sujeito.
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nO `ork noctum conduzir` está disponível para o cron do piloto.\n' +
      '`ork noctum aceite` is available in the CLI.\nO comando `ork noctum aceite` foi entregue nesta thread.\n' +
      'No #Noctum, o relatório está disponível no terminal.\n');
    const certo = rodar(raiz, '--texto');
    assert.equal(certo.status, 0, certo.stderr);
    // N3 do CHECK 3: os furos que deixavam o anúncio passar.
    const recusadas = ['[#Noctum](docs/roadmap/RM-058-modo-noctum.md) já está disponível.', 'O #Noctum é lançado nesta versão.',
      '## O que ainda não\n\nO #Noctum foi validado nos quatro pilotos.', 'O #Noctum não só foi validado como está disponível.',
      '#Noctum is not only validated but also available.'];
    for (const frase of recusadas) {
      fs.writeFileSync(path.join(raiz, 'README.md'), `# Produto\n\n${frase}\n`);
      const r = rodar(raiz, '--texto');
      assert.equal(r.status, 1, `deveria recusar: ${frase}`);
      assert.match(r.stderr, /README\.md:\d+: /);
    }
  });
});

/** Reescreve o arquivo publicável do piloto de índice `i` com `mexer` e põe o sha256 novo no aceite. */
function mexerNoPublicavel(raiz: string, i: number, mexer: (r: Record<string, unknown>) => void): void {
  const arquivo = path.join(raiz, PASTA, `piloto-${i + 1}.json`);
  const r = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
  mexer(r);
  const texto = `${JSON.stringify(r, null, 2)}\n`;
  fs.writeFileSync(arquivo, texto);
  const a = JSON.parse(fs.readFileSync(path.join(raiz, PASTA, 'aceite.json'), 'utf8'));
  a.pilotos[i].sha256 = createHash('sha256').update(texto).digest('hex');
  fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a, null, 2));
}

test('RG16: o arquivo publicável que não diz aprovado ou não é o publicável recusa, mesmo com o aceite dizendo aprovado; a ratificação sem data válida também', () => {
  // CHECK 4: o RG5 só mexia no veredito do aceite; o do arquivo, o publicavel e a data da ratificação não tinham caso.
  emPasta('rg16', (raiz) => {
    aceite(raiz);
    assert.equal(rodar(raiz).status, 0, 'o aceite de fixture confere');
    mexerNoPublicavel(raiz, 1, (r) => { r.veredito = 'reprovado'; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-nao-aprovado: o piloto P2 tem o veredito reprovado/);
    aceite(raiz);
    mexerNoPublicavel(raiz, 0, (r) => { r.publicavel = false; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.aceite-invalido: piloto-1\.json não é o aceite publicável/);
    aceite(raiz, (a) => { a.ratificacao = { por: 'dono-do-projeto', recibo: 'ingresso:telegram:SIMULADO-1', em: 'depois dos pilotos' }; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.sem-ratificacao/);
  });
});

test('RG17: o anúncio em qualquer caixa recusa, e o link por referência ou com título, o "não somente", o "disponibilizado" e o "has shipped" também', () => {
  // I1 do CHECK 4: o GO-FIX 3 tirou a flag i da frase inteira, e o título em Title Case passava; o comando segue liberado.
  emPasta('rg17', (raiz) => {
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\n`ork noctum aceite` Is Available in the CLI.\nO `ork noctum conduzir` Está Disponível.\n' +
      'O #Noctum ainda não foi validado.\n');
    const certo = rodar(raiz, '--texto');
    assert.equal(certo.status, 0, certo.stderr);
    // M3 do CHECK 4: os furos baratos do vocabulário e do link.
    const recusadas = ['## #Noctum Is Now Available', '### #Noctum Foi Lançado', '#NOCTUM IS RELEASED', 'O #Noctum Já Está Disponível.',
      '[#Noctum][rm058] já está disponível.', '[#Noctum](docs/x.md "a página") já está disponível.', 'O #Noctum não somente foi validado.',
      'O #Noctum não apenas foi validado como está disponível.', 'O #Noctum foi disponibilizado.', '#Noctum has shipped.', 'ork noctum, #Noctum foi lançado.'];
    for (const frase of recusadas) {
      fs.writeFileSync(path.join(raiz, 'README.md'), `# Produto\n\n${frase}\n`);
      const r = rodar(raiz, '--texto');
      assert.equal(r.status, 1, `deveria recusar: ${frase}`);
      assert.match(r.stderr, /README\.md:3: /);
    }
  });
});

test('RG18: as marcas da simulação, o arco repetido com espaço ou caixa e a ratificação anterior ao fim dos pilotos recusam', () => {
  // M2 do CHECK 4: o script lia só o booleano da simulação, comparava o arco cru e aceitava a ratificação de antes dos pilotos.
  emPasta('rg18', (raiz) => {
    aceite(raiz);
    mexerNoPublicavel(raiz, 2, (r) => { (r.simulacao as { marcas: string[] }).marcas = ['a máquina do ensaio conduziu o arco']; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-simulado: o piloto P3 é simulado/);
    aceite(raiz);
    mexerNoPublicavel(raiz, 3, (r) => { r.arco = 'Arco-Piloto-1 '; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-repetido: os pilotos P1 e P4 têm o mesmo arco/);
    aceite(raiz);
    mexerNoPublicavel(raiz, 0, (r) => { delete r.janela; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.aceite-invalido: piloto-1\.json não diz quando o piloto P1 acabou/);
    aceite(raiz, (a) => { a.ratificacao = { por: 'dono-do-projeto', recibo: 'ingresso:telegram:SIMULADO-1', em: '2025-12-04T11:00:00.000Z' }; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.sem-ratificacao: a ratificação \(2025-12-04T11:00:00\.000Z\) é anterior ao fim dos pilotos \(2025-12-04T12:00:00\.000Z\)/);
    aceite(raiz, (a) => { a.ratificacao = { por: 'dono-do-projeto', recibo: 'ingresso:telegram:SIMULADO-1', em: '2025-12-04T12:00:00.000Z' }; });
    assert.equal(rodar(raiz).status, 0, 'ratificado no fim do último piloto, confere');
  });
});

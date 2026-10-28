/**
 * RM-058, integração (T9 da ork-rm058integra, D13): o portão de release do #Noctum (`core/scripts/checar-release-noctum.cjs`).
 * Na tag, só a versão que anuncia o #Noctum exige o aceite dos pilotos aprovados, não simulados e ratificados pelo dono;
 * no CI de documentação, nenhum texto anuncia o produto como lançado, entregue, validado ou disponível sem esse aceite.
 * Os nomes começam por RG. Os aceites e os textos são de fixture, numa pasta descartável.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirTemporario } from './apoio';

const SCRIPT = path.resolve(__dirname, '../../scripts/checar-release-noctum.cjs');
const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');
const PASTA = 'docs/roadmap/evidencias/RM-058';

const { executar } = require(SCRIPT) as { executar: (argv: string[]) => { status: number; stdout: string; stderr: string } };
const rodar = (raiz: string, ...args: string[]) => executar([...args, raiz]);

interface Piloto { id: string; arquivo: string; sha256: string; simulado: boolean; veredito: string }

/** O aceite de fixture: o P1 publicável, aprovado e ratificado; `mexer` o estraga do jeito do caso. */
function aceite(raiz: string, mexer: (a: { contrato: string; pilotos: Piloto[]; ratificacao?: Record<string, string> }) => void = () => {},
  ids: string[] = ['P1']): void {
  fs.mkdirSync(path.join(raiz, PASTA), { recursive: true });
  const pilotos = ids.map((id, i) => {
    const arquivo = `piloto-${i + 1}.json`;
    const horas = id === 'P2' || id === 'P4' ? 12 : 6;
    const inicio = Date.parse(`2025-12-0${i + 1}T00:00:00.000Z`);
    const janela = { inicio: new Date(inicio).toISOString(), fim: new Date(inicio + horas * 3_600_000).toISOString(), horas };
    const duas = id === 'P3' || id === 'P4';
    const texto = `${JSON.stringify({ contrato: 'ork.noctum-piloto/v1', arco: `arco-piloto-${i + 1}`, janela,
      envelope: { contrato: duas ? 'ork.noctum-envelope/v3' : 'ork.noctum-envelope/v2' },
      maquinas: Array.from({ length: duas ? 2 : 1 }, (_, m) => ({ maquina: `maquina-${m + 1}`, fonte: 'estado local', sha256: String(m + 1).repeat(64), veredito: 'aprovado' })),
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

test('RG1: sem o aceite e sem anúncio do #Noctum, a tag passa', () => {
  emPasta('rg1', (raiz) => {
    const r = rodar(raiz);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^release\.noctum: nenhum texto anuncia o #Noctum como lançado, entregue, validado ou disponível; a versão pode sair sem o aceite/);
  });
});

test('RG2: o aceite com um piloto simulado (o ensaio) recusa, pelo aceite ou pelo arquivo publicável', () => {
  emPasta('rg2', (raiz) => {
    aceite(raiz, (a) => { a.pilotos[0].simulado = true; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-simulado: o piloto P1 é simulado/);
    aceite(raiz);
    const arquivo = path.join(raiz, PASTA, 'piloto-1.json');
    const texto = fs.readFileSync(arquivo, 'utf8').replace('"simulado": false', '"simulado": true');
    fs.writeFileSync(arquivo, texto);
    const a = JSON.parse(fs.readFileSync(path.join(raiz, PASTA, 'aceite.json'), 'utf8'));
    a.pilotos[0].sha256 = createHash('sha256').update(texto).digest('hex');
    fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a));
    const r = rodar(raiz);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.piloto-simulado: o piloto P1 é simulado/);
  });
});

test('RG3: o piloto exigido que falta recusa, no aceite ou no disco', () => {
  emPasta('rg3', (raiz) => {
    aceite(raiz, (a) => { a.pilotos = []; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-faltando: o piloto P1 não está no aceite \(exigidos: P1\)/);
    aceite(raiz);
    fs.rmSync(path.join(raiz, PASTA, 'piloto-1.json'));
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-faltando: o arquivo piloto-1\.json do piloto P1 não existe/);
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
    assert.match(r.stdout, /^release\.noctum: o aceite confere: pilotos P1 aprovados, ratificados por dono-do-projeto/);
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nO #Noctum foi validado pelos pilotos.\n');
    assert.equal(rodar(raiz, '--texto').status, 0);
  });
});

test('RG7: sem o aceite, "o #Noctum foi lançado" no README recusa o texto, com o arquivo e a linha', () => {
  emPasta('rg7', (raiz) => {
    fs.writeFileSync(path.join(raiz, 'README.md'), '# Produto\n\nNovidade: o #Noctum foi lançado nesta versão.\n');
    fs.mkdirSync(path.join(raiz, 'docs', 'guias'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'docs', 'guias', 'noite.md'), '# Noite\n\nHoje o Noctum está disponível para todos.\n');
    const tag = rodar(raiz);
    assert.equal(tag.status, 1);
    assert.match(tag.stderr, /^release\.noctum\.texto-sem-aceite: 2 trecho\(s\) anunciam o #Noctum sem o aceite dos pilotos/);
    assert.match(tag.stderr, /README\.md:3: #Noctum foi lançado/);
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

test('RG10: a árvore desta thread não anuncia o produto, o alcance é a versão que anuncia, e os workflows chamam o portão', () => {
  const r = rodar(RAIZ_DO_REPO, '--texto');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rodar(RAIZ_DO_REPO).status, 0, 'a tag sem aceite passa porque esta árvore não anuncia o #Noctum');
  const fonte = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(fonte, /^const ALCANCE = 'versao-que-anuncia';$/m);
  assert.match(fonte, /^const PILOTOS_EXIGIDOS = \['P1'\];$/m);
  assert.doesNotMatch(fonte, /require\('node:(?:https?|net|child_process)'\)|core\/dist/, 'o portão só lê arquivos');
  assert.match(fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/publicar.yml'), 'utf8'),
    /run: node core\/scripts\/checar-release-noctum\.cjs\n[\s\S]*run: npm publish/);
  assert.match(fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/ci.yml'), 'utf8'), /run: node core\/scripts\/checar-release-noctum\.cjs --texto/);
  assert.equal(rodar(RAIZ_DO_REPO, '--outra').status, 2);
});

test('RG11: o P1 com janela menor que 6 h recusa', () => {
  emPasta('rg11', (raiz) => {
    aceite(raiz);
    const arquivo = path.join(raiz, PASTA, 'piloto-1.json');
    const texto = fs.readFileSync(arquivo, 'utf8').replace('"horas": 6', '"horas": 5');
    fs.writeFileSync(arquivo, texto);
    const a = JSON.parse(fs.readFileSync(path.join(raiz, PASTA, 'aceite.json'), 'utf8'));
    a.pilotos[0].sha256 = createHash('sha256').update(texto).digest('hex');
    fs.writeFileSync(path.join(raiz, PASTA, 'aceite.json'), JSON.stringify(a));
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-curto: o piloto P1 pede ao menos 6 h de janela, e o arquivo piloto-1\.json diz 5/);
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

test('RG14: o P1 sem arco recusa', () => {
  emPasta('rg14', (raiz) => {
    aceite(raiz);
    mexerNoPublicavel(raiz, 0, (r) => { r.arco = ' '; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.aceite-invalido: piloto-1\.json não diz o arco do piloto P1/);
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
    mexerNoPublicavel(raiz, 0, (r) => { r.veredito = 'reprovado'; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-nao-aprovado: o piloto P1 tem o veredito reprovado/);
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

test('RG18: as marcas da simulação, a janela ausente e a ratificação anterior ao fim do P1 recusam', () => {
  // M2 do CHECK 4: o script lia só o booleano da simulação e aceitava a ratificação de antes dos pilotos.
  emPasta('rg18', (raiz) => {
    aceite(raiz);
    mexerNoPublicavel(raiz, 0, (r) => { (r.simulacao as { marcas: string[] }).marcas = ['a máquina do ensaio conduziu o arco']; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.piloto-simulado: o piloto P1 é simulado/);
    aceite(raiz);
    mexerNoPublicavel(raiz, 0, (r) => { delete r.janela; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.aceite-invalido: piloto-1\.json não diz quando o piloto P1 acabou/);
    aceite(raiz, (a) => { a.ratificacao = { por: 'dono-do-projeto', recibo: 'ingresso:telegram:SIMULADO-1', em: '2025-12-01T05:59:59.000Z' }; });
    assert.match(rodar(raiz).stderr, /^release\.noctum\.sem-ratificacao: a ratificação \(2025-12-01T05:59:59\.000Z\) é anterior ao fim dos pilotos \(2025-12-01T06:00:00\.000Z\)/);
    aceite(raiz, (a) => { a.ratificacao = { por: 'dono-do-projeto', recibo: 'ingresso:telegram:SIMULADO-1', em: '2025-12-01T06:00:00.000Z' }; });
    assert.equal(rodar(raiz).status, 0, 'ratificado no fim do último piloto, confere');
  });
});

test('RG19: P3 com uma máquina é recusado pelo motivo tipado', () => {
  emPasta('rg19', (raiz) => {
    aceite(raiz, () => {}, ['P1', 'P3']);
    mexerNoPublicavel(raiz, 1, (r) => { r.maquinas = [{ maquina: 'maquina-1' }]; });
    const r = rodar(raiz);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^release\.noctum\.piloto-sem-maquinas: o piloto P3 exige 2 máquina\(s\) e envelope ork\.noctum-envelope\/v3/);
  });
});

test('RG20: P3 e P4 com v3 e duas máquinas passam pelo portão', () => {
  emPasta('rg20', (raiz) => {
    aceite(raiz, () => {}, ['P1', 'P3', 'P4']);
    const r = rodar(raiz);
    assert.equal(r.status, 0, r.stderr);
  });
});

test('RG21: P1 e P2 continuam aceitos com uma máquina', () => {
  emPasta('rg21', (raiz) => {
    aceite(raiz, () => {}, ['P1', 'P2']);
    const r = rodar(raiz);
    assert.equal(r.status, 0, r.stderr);
  });
});

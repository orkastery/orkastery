/** RM-088: regra SemVer, classificação hermética do npm e contrato do workflow de publicação. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';

const SCRIPT = path.resolve(__dirname, '../../scripts/decidir-publicacao-npm.cjs');
const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');
const regra = require(SCRIPT) as {
  analisarSemver: (v: string) => unknown;
  compararSemver: (a: string, b: string) => number;
  prepararCandidata: (tag: string, pacote: string) => unknown;
  decidirPublicacao: (e: { versaoTag: string; versaoPacote: string; registro: Registro }) => Decisao;
  classificarSucessoDaConsulta: (s: string) => Registro;
  consultarRegistro: (executor: Executor) => Registro;
  executar: (o: { env: Record<string, string>; raiz: string; executor: Executor }) => { status: number; decisao: Decisao };
};

type Registro = { tipo: 'latest'; versao: string } | { tipo: 'pacote-ausente' | 'sem-latest' | 'inacessivel' };
type Decisao = { acao: 'publicar'; distTag: string; versao: string; motivo: string };
type Resultado = { status: number; stdout: string; stderr: string };
type Executor = (comando: string, argumentos: string[]) => Resultado;
type CasoNormativo = { regra: string; provar: () => void };

const latest = (versao: string): Registro => ({ tipo: 'latest', versao });
const decidir = (versao: string, registro: Registro): Decisao => regra.decidirPublicacao({ versaoTag: `v${versao}`, versaoPacote: versao, registro });
const motivo = (fn: () => unknown, esperado: RegExp): void => assert.throws(fn, esperado);
const normalizarRegra = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

function extrairRegrasNormativas(texto: string, titulo: string): string[] {
  const cabecalho = `### ${titulo}`;
  const inicio = texto.indexOf(cabecalho);
  assert.notEqual(inicio, -1, `o guia perdeu a seção ${cabecalho}`);
  const depoisDoTitulo = texto.slice(inicio + cabecalho.length);
  const proximoTitulo = depoisDoTitulo.search(/^#{1,3}\s+/m);
  const secao = depoisDoTitulo.slice(0, proximoTitulo < 0 ? undefined : proximoTitulo);
  const regras: string[] = [];
  let paragrafo: string[] = [];
  const terminarParagrafo = (): void => {
    if (paragrafo.length) regras.push(normalizarRegra(paragrafo.join(' ')));
    paragrafo = [];
  };
  for (const linhaOriginal of secao.split('\n')) {
    const linha = linhaOriginal.trim();
    if (!linha) {
      terminarParagrafo();
    } else if (linha.startsWith('- ')) {
      terminarParagrafo();
      regras.push(normalizarRegra(linha.slice(2)));
    } else {
      paragrafo.push(linha);
    }
  }
  terminarParagrafo();
  return regras;
}

function exigirParidadeEntreGuiaECasos(guia: string, casos: CasoNormativo[]): void {
  const doGuia = extrairRegrasNormativas(guia, 'Como a dist-tag é escolhida');
  const dosCasos = casos.map(({ regra: regraDoCaso }) => normalizarRegra(regraDoCaso));
  assert.equal(new Set(doGuia).size, doGuia.length, 'o guia repete uma regra normativa');
  assert.equal(new Set(dosCasos).size, dosCasos.length, 'dois casos do script reivindicam a mesma regra');
  assert.deepEqual([...doGuia].sort(), [...dosCasos].sort(), 'guia e casos do script divergem');
}

test('PN1: estável maior usa latest, igual falha e menor usa previous', () => {
  assert.equal(decidir('0.6.9', latest('0.6.8')).distTag, 'latest');
  motivo(() => decidir('0.6.8', latest('0.6.8')), /^Error: publicacao\.versao-ja-publicada:/);
  assert.equal(decidir('0.6.7', latest('0.6.8')).distTag, 'previous');
  assert.equal(decidir('1.10.0', latest('1.9.0')).distTag, 'latest');
});

test('PN2: pré-release usa rc ou beta, seja maior, menor ou primeira publicação', () => {
  assert.equal(decidir('0.7.0-rc.1', latest('0.6.9')).distTag, 'rc');
  assert.equal(decidir('0.6.9-beta.2', latest('0.7.0')).distTag, 'beta');
  assert.equal(decidir('0.1.0-rc.1', { tipo: 'pacote-ausente' }).distTag, 'rc');
  assert.equal(decidir('0.1.0', { tipo: 'pacote-ausente' }).distTag, 'latest');
});

test('PN3: latest e previous ficam reservadas, e tags numéricas, x e prefixos inseguros falham', () => {
  for (const versao of ['2.0.0-latest.1', '1.0.0-previous.1', '1.0.0-x.1', '1.0.0-X.1', '1.0.0-1',
    '1.0.0-1rc', '1.0.0-v1', '1.0.0-Vnext']) {
    motivo(() => decidir(versao, latest('1.0.0')), /^Error: publicacao\.dist-tag-invalida:/);
  }
});

test('PN4: dist-tag inválida e divergência tag/pacote são recusadas antes do executor', () => {
  motivo(() => regra.prepararCandidata('v2.0.0-latest.1', '2.0.0-latest.1'), /^Error: publicacao\.dist-tag-invalida:/);
  motivo(() => regra.prepararCandidata('v0.6.9', '0.6.8'), /^Error: publicacao\.versao-tag-diverge:/);
});

test('PN5: precedência cobre estável, numérico, alfanumérico, quantidade e build metadata', () => {
  assert.ok(regra.compararSemver('1.0.0-rc.1', '1.0.0') < 0);
  assert.ok(regra.compararSemver('1.0.0-1', '1.0.0-alpha') < 0);
  assert.ok(regra.compararSemver('1.0.0-alpha', '1.0.0-alpha.1') < 0);
  assert.ok(regra.compararSemver('1.0.0-beta.2', '1.0.0-beta.11') < 0);
  assert.equal(regra.compararSemver('1.0.0+build.1', '1.0.0+build.2'), 0);
});

test('PN6: inteiros acima de MAX_SAFE_INTEGER são comparados sem perda', () => {
  assert.ok(regra.compararSemver('9007199254740993.0.0', '9007199254740992.0.0') > 0);
  assert.ok(regra.compararSemver('1.0.0-9007199254740993', '1.0.0-9007199254740992') > 0);
});

test('PN7: zeros à esquerda falham no core e na pré-release numérica, mas passam no build', () => {
  for (const versao of ['01.0.0', '1.00.0', '1.0.01', '1.0.0-01']) {
    motivo(() => regra.analisarSemver(versao), /^Error: publicacao\.semver-invalida:/);
  }
  assert.doesNotThrow(() => regra.analisarSemver('1.0.0+build.01'));
});

test('PN8: latest inválida ou pré-release, pacote sem latest e registry inacessível falham fechados', () => {
  motivo(() => decidir('1.0.0', latest('invalida')), /^Error: publicacao\.semver-invalida:/);
  motivo(() => decidir('1.0.0', latest('1.0.0-rc.1')), /^Error: publicacao\.latest-pre-release:/);
  motivo(() => decidir('1.0.0', { tipo: 'sem-latest' }), /^Error: publicacao\.latest-ausente:/);
  motivo(() => decidir('1.0.0', { tipo: 'inacessivel' }), /^Error: publicacao\.registro-inacessivel:/);
});

test('PN9: sucesso do npm 11 e npm 12 aceita só string SemVer ou array unitário', () => {
  assert.deepEqual(regra.classificarSucessoDaConsulta('"1.2.3"\n'), latest('1.2.3'));
  assert.deepEqual(regra.classificarSucessoDaConsulta('["1.2.3"]\n'), latest('1.2.3'));
  assert.deepEqual(regra.classificarSucessoDaConsulta(''), { tipo: 'sem-latest' });
  assert.deepEqual(regra.classificarSucessoDaConsulta('null\n'), { tipo: 'sem-latest' });
});

test('PN10: formas de sucesso desconhecidas viram consulta-invalida', () => {
  for (const saida of ['[]', '["1.2.3","1.2.4"]', '{}', '{"versao":"1.2.3"}', '12', '"não-semver"', 'texto']) {
    motivo(() => regra.classificarSucessoDaConsulta(saida), /^Error: publicacao\.consulta-invalida:/);
  }
});

test('PN11: executor falso classifica E404 mais ping verde como pacote ausente', () => {
  const chamadas: string[][] = [];
  const respostas: Resultado[] = [
    { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' },
    { status: 0, stdout: '{}', stderr: '' },
  ];
  const executor: Executor = (comando, argumentos) => { chamadas.push([comando, ...argumentos]); return respostas.shift()!; };
  assert.deepEqual(regra.consultarRegistro(executor), { tipo: 'pacote-ausente' });
  assert.deepEqual(chamadas, [
    ['npm', 'view', '@orkastery/cli', 'dist-tags.latest', '--json', '--registry=https://registry.npmjs.org'],
    ['npm', 'ping', '--registry=https://registry.npmjs.org'],
  ]);
});

test('PN12: E404 com ping vermelho e erros não E404 ou não estruturados falham sem segunda interpretação', () => {
  const resultado = (status: number, stdout: string, stderr = ''): Resultado => ({ status, stdout, stderr });
  for (const respostas of [
    [resultado(1, JSON.stringify({ error: { code: 'E404' } })), resultado(1, '', 'fora')],
    [resultado(1, JSON.stringify({ error: { code: 'E404' } }), JSON.stringify({ error: { code: 'E401' } })),
      resultado(0, '{}')],
    [resultado(1, JSON.stringify({ error: { code: 'E401' } }))],
    [resultado(1, '', 'npm error humano')],
  ]) {
    let i = 0;
    assert.deepEqual(regra.consultarRegistro(() => respostas[i++]), { tipo: 'inacessivel' });
  }
});

test('PN13: a CLI valida a dist-tag antes da consulta e só então grava tag no GITHUB_OUTPUT', () => {
  const raiz = dirTemporario('rm088-cli');
  try {
    fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ version: '2.0.0-latest.1' }));
    const saida = path.join(raiz, 'github-output');
    let chamadas = 0;
    motivo(() => regra.executar({ env: { GITHUB_REF_NAME: 'v2.0.0-latest.1', GITHUB_OUTPUT: saida }, raiz,
      executor: () => { chamadas += 1; return { status: 0, stdout: '"1.0.0"', stderr: '' }; } }),
    /^Error: publicacao\.dist-tag-invalida:/);
    assert.equal(chamadas, 0);
    assert.equal(fs.existsSync(saida), false);
    fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ version: '2.0.0-rc.1' }));
    const r = regra.executar({ env: { GITHUB_REF_NAME: 'v2.0.0-rc.1', GITHUB_OUTPUT: saida }, raiz,
      executor: () => ({ status: 0, stdout: '["1.0.0"]', stderr: '' }) });
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(saida, 'utf8'), 'tag=rc\n');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('PN14: workflow preserva as guardas e publica somente com a saída validada da RM-088', () => {
  const workflow = fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/publicar.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  publicar:'));
  const noctum = job.indexOf('run: node core/scripts/checar-release-noctum.cjs');
  const decisao = job.indexOf('id: decidir-publicacao');
  const comandoDaDecisao = job.indexOf('run: node core/scripts/decidir-publicacao-npm.cjs');
  const publish = job.indexOf('run: npm publish --access public --tag "${{ steps.decidir-publicacao.outputs.tag }}"');
  assert.ok(noctum > 0 && decisao > noctum && comandoDaDecisao > decisao && publish > comandoDaDecisao,
    'a decisão fica entre #Noctum e publish');
  assert.equal(job.split('id: decidir-publicacao').length - 1, 1, 'o id da decisão é único');
  assert.equal(job.split('run: node core/scripts/decidir-publicacao-npm.cjs').length - 1, 1, 'o adaptador é chamado uma vez');
  assert.equal(job.split('npm publish').length - 1, 1, 'há um único publish');
  assert.doesNotMatch(job, /run: npm publish --access public\s*$/m, 'não existe publish sem --tag');
  assert.doesNotMatch(job.slice(comandoDaDecisao, publish), /latest|\|\||\?\?/, 'não existe fallback para latest');
  assert.match(workflow, /tags: \['v\*'\]/, 'o gatilho v* permanece');
  assert.match(workflow, /permissions:\n  contents: read\n  id-token: write/, 'o Trusted Publishing permanece');
  assert.match(job, /needs: provar-grafo/, 'a prova do grafo permanece como dependência');
  assert.match(job, /registry-url: 'https:\/\/registry\.npmjs\.org'/, 'o registry permanece');
  assert.match(job, /run: npm install -g npm@latest/, 'npm@latest permanece');
  assert.match(job, /run: git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/, 'a tag continua presa à main');
  assert.match(job, /run: node core\/dist\/index\.js eval --so-cenarios/, 'os cenários permanecem');
  assert.match(job.slice(publish), /working-directory: core/, 'o publish continua no core');
});

test('PN15: guia e implementação mantêm a política integral de publicação', () => {
  const guia = fs.readFileSync(path.join(RAIZ_DO_REPO, 'docs/guias/contribuir/versoes-e-publicacao.md'), 'utf8');
  const workflow = fs.readFileSync(path.join(RAIZ_DO_REPO, '.github/workflows/publicar.yml'), 'utf8');
  const casos: CasoNormativo[] = [
    {
      regra: 'A guarda consulta a `latest` de `@orkastery/cli` no mesmo registro configurado para a publicação e aplica a política da RM-088:',
      provar: () => {
        const chamadas: string[][] = [];
        assert.deepEqual(regra.consultarRegistro((comando, argumentos) => {
          chamadas.push([comando, ...argumentos]);
          return { status: 0, stdout: '"1.2.3"', stderr: '' };
        }), latest('1.2.3'));
        assert.deepEqual(chamadas, [
          ['npm', 'view', '@orkastery/cli', 'dist-tags.latest', '--json', '--registry=https://registry.npmjs.org'],
        ]);
        assert.match(workflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/, 'consulta e publicação usam o mesmo registro');
      },
    },
    {
      regra: 'uma versão estável maior que a `latest` estável usa `latest`;',
      provar: () => assert.equal(decidir('0.6.9', latest('0.6.8')).distTag, 'latest'),
    },
    {
      regra: 'uma versão estável com a mesma precedência falha, porque já foi publicada;',
      provar: () => motivo(() => decidir('0.6.8', latest('0.6.8')), /^Error: publicacao\.versao-ja-publicada:/),
    },
    {
      regra: 'uma versão estável menor usa `previous` e não move a `latest` para trás;',
      provar: () => assert.equal(decidir('0.6.7', latest('0.6.8')).distTag, 'previous'),
    },
    {
      regra: 'uma pré-release usa o primeiro identificador como canal, por exemplo `rc` ou `beta`, mesmo quando sua versão é maior que a `latest`;',
      provar: () => {
        assert.equal(decidir('0.7.0-rc.1', latest('0.6.8')).distTag, 'rc');
        assert.equal(decidir('0.6.7-beta.1', latest('0.6.8')).distTag, 'beta');
      },
    },
    {
      regra: 'na primeira publicação, a estável usa `latest` e a pré-release mantém seu canal próprio.',
      provar: () => {
        assert.equal(decidir('0.1.0', { tipo: 'pacote-ausente' }).distTag, 'latest');
        assert.equal(decidir('0.1.0-rc.1', { tipo: 'pacote-ausente' }).distTag, 'rc');
      },
    },
    {
      regra: 'O canal da pré-release é validado antes da consulta. A guarda recusa identificador vazio, numérico, iniciado por número ou por `v`/`V`, `x`/`X` e os nomes reservados `latest` e `previous`. A recusa é `publicacao.dist-tag-invalida` e não produz uma tag para o passo seguinte.',
      provar: () => {
        for (const versao of ['1.0.0-1', '1.0.0-1rc', '1.0.0-v1', '1.0.0-Vnext', '1.0.0-x.1',
          '1.0.0-X.1', '1.0.0-latest.1', '1.0.0-previous.1']) {
          motivo(() => regra.prepararCandidata(`v${versao}`, versao), /^Error: publicacao\.dist-tag-invalida:/);
        }
      },
    },
    {
      regra: 'O job preserva a instalação de `npm@latest`. A consulta aceita as duas formas escalares conhecidas do `npm view --json`: a string SemVer usada pelo npm 11 e o array unitário usado pelo npm 12. Array vazio ou com mais de um item, objeto e qualquer outra forma desconhecida falham como `publicacao.consulta-invalida`.',
      provar: () => {
        assert.deepEqual(regra.classificarSucessoDaConsulta('"1.2.3"'), latest('1.2.3'), 'formato do npm 11');
        assert.deepEqual(regra.classificarSucessoDaConsulta('["1.2.3"]'), latest('1.2.3'), 'formato do npm 12');
        for (const saida of ['[]', '["1.2.3","1.2.4"]', '{}', '12', 'texto']) {
          motivo(() => regra.classificarSucessoDaConsulta(saida), /^Error: publicacao\.consulta-invalida:/);
        }
        assert.match(workflow, /run: npm install -g npm@latest/, 'o workflow preserva npm@latest');
      },
    },
    {
      regra: 'Primeira publicação só significa pacote ausente quando a consulta exata devolve um `E404` estruturado e `npm ping` confirma o mesmo registro. Registro inacessível, erro não estruturado, pacote existente sem `latest`, `latest` apontando para pré-release e qualquer SemVer inválida falham antes do publish. A guarda não interpreta texto humano do npm e não usa fallback para `latest`.',
      provar: () => {
        let primeira = 0;
        const primeiraPublicacao = [
          { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' },
          { status: 0, stdout: '{}', stderr: '' },
        ];
        assert.deepEqual(regra.consultarRegistro(() => primeiraPublicacao[primeira++]), { tipo: 'pacote-ausente' });
        assert.equal(primeira, 2, 'E404 inequívoco exige ping verde');

        let conflito = 0;
        const saidasConflitantes = [
          { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }),
            stderr: JSON.stringify({ error: { code: 'E401' } }) },
          { status: 0, stdout: '{}', stderr: '' },
        ];
        assert.deepEqual(regra.consultarRegistro(() => saidasConflitantes[conflito++]), { tipo: 'inacessivel' });
        assert.equal(conflito, 1, 'códigos conflitantes falham fechados sem ping');
        assert.deepEqual(regra.consultarRegistro(() => ({ status: 1, stdout: '', stderr: 'npm error humano' })),
          { tipo: 'inacessivel' });
        motivo(() => decidir('1.0.0', { tipo: 'sem-latest' }), /^Error: publicacao\.latest-ausente:/);
        motivo(() => decidir('1.0.0', latest('1.0.0-rc.1')), /^Error: publicacao\.latest-pre-release:/);
        motivo(() => decidir('invalida', latest('1.0.0')), /^Error: publicacao\.semver-invalida:/);
      },
    },
  ];
  exigirParidadeEntreGuiaECasos(guia, casos);
  for (const caso of casos) caso.provar();

  const casoDaPrimeiraPublicacao = casos.find(({ regra: regraDoCaso }) => regraDoCaso.startsWith('na primeira publicação'));
  assert.ok(casoDaPrimeiraPublicacao, 'a lista precisa ligar a regra de primeira publicação a um caso');
  const regraDaPrimeiraPublicacao = normalizarRegra(casoDaPrimeiraPublicacao.regra);
  const linhas = guia.split('\n');
  assert.equal(linhas.filter((linha) => normalizarRegra(linha.replace(/^- /, '')) === regraDaPrimeiraPublicacao).length, 1,
    'a prova de mutação precisa localizar uma única regra de primeira publicação');
  const guiaSemPrimeiraPublicacao = linhas
    .filter((linha) => normalizarRegra(linha.replace(/^- /, '')) !== regraDaPrimeiraPublicacao).join('\n');
  assert.throws(() => exigirParidadeEntreGuiaECasos(guiaSemPrimeiraPublicacao, casos),
    /guia e casos do script divergem/, 'apagar a regra de primeira publicação precisa reprovar a PN15');

  assert.match(workflow, /npm publish --access public --tag "\$\{\{ steps\.decidir-publicacao\.outputs\.tag \}\}"/,
    'o workflow usa somente a tag decidida pelo script');
});

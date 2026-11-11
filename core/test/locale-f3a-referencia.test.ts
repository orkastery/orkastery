/**
 * RM-061, fatia F3a: a referencia do CLI em ingles, `docs/referencia/cli.en.md` (D4). Ela anda junto com a de pt-BR,
 * `docs/referencia/cli.md`, que o `rm044-paridade-cli-md` confere contra o parser e a ajuda: secao por secao, as
 * mesmas invocacoes `ork`, as mesmas linhas de tabela e os mesmos blocos de codigo, e o mesmo numero de titulos. As
 * duas tem a linha de troca de lingua apontando uma para a outra (o padrao do `README.md`), os links relativos existem
 * e o texto esta em ingles. Negativo: uma referencia sem um comando, ou com um bloco de codigo mudado, reprova. Os
 * nomes comecam por "locale F3a referencia:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { linhasEmPortugues } from './locale-apoio';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string): string => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const PT = 'docs/referencia/cli.md';
const EN = 'docs/referencia/cli.en.md';
const GUIA_PT = 'docs/guias/telemetria-opentelemetry.pt-BR.md';
const GUIA_EN = 'docs/guias/telemetria-opentelemetry.md';

interface Secao { titulo: string; ork: string[]; tabela: number; codigo: string[] }

/** As secoes `##` da referencia: as invocacoes `ork` (codigo inline e linhas de bloco), as linhas de tabela e o codigo. */
export function secoes(md: string): Secao[] {
  const lista: Secao[] = [];
  let atual: Secao = { titulo: '(abertura)', ork: [], tabela: 0, codigo: [] };
  let cercado = false;
  for (const linha of md.split('\n')) {
    if (/^\s*```/.test(linha)) { cercado = !cercado; atual.codigo.push(linha); continue; }
    if (cercado) {
      atual.codigo.push(linha);
      const m = /^\s*(?:\$\s*)?ork\s+(.*)$/.exec(linha);
      if (m) atual.ork.push(m[1]);
      continue;
    }
    if (linha.startsWith('## ')) { lista.push(atual); atual = { titulo: linha, ork: [], tabela: 0, codigo: [] }; continue; }
    if (linha.startsWith('|')) atual.tabela++;
    for (const m of linha.matchAll(/`ork ([^`]+)`/g)) atual.ork.push(m[1]);
  }
  lista.push(atual);
  return lista;
}

/** O que separa a traducao do original: secao faltando, invocacao `ork`, linha de tabela, codigo ou titulo diferente. */
export function diferencas(pt: string, en: string): string[] {
  const a = secoes(pt), b = secoes(en), achados: string[] = [];
  if (a.length !== b.length) achados.push(`secoes: ${a.length} no pt-BR, ${b.length} no ingles`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const rotulo = `${a[i].titulo} / ${b[i].titulo}`;
    const faltam = [...a[i].ork].sort(), sobram = [...b[i].ork].sort();
    if (faltam.join('\n') !== sobram.join('\n')) {
      achados.push(`${rotulo}: invocacoes ork diferentes (${faltam.filter((x) => !sobram.includes(x)).concat(sobram.filter((x) => !faltam.includes(x))).join(' | ')})`);
    }
    if (a[i].tabela !== b[i].tabela) achados.push(`${rotulo}: ${a[i].tabela} linhas de tabela no pt-BR, ${b[i].tabela} no ingles`);
    if (a[i].codigo.join('\n') !== b[i].codigo.join('\n')) achados.push(`${rotulo}: bloco de codigo diferente`);
  }
  const titulos = (md: string) => (md.match(/^#{1,6} /gm) ?? []).length;
  if (titulos(pt) !== titulos(en)) achados.push(`titulos: ${titulos(pt)} no pt-BR, ${titulos(en)} no ingles`);
  return achados;
}

/** O texto em prosa, sem os blocos de codigo (copiados do pt-BR como estao). */
function prosa(md: string): string {
  let cercado = false;
  return md.split('\n').filter((l) => {
    if (/^\s*```/.test(l)) { cercado = !cercado; return false; }
    return !cercado;
  }).join('\n');
}

test('locale F3a referencia: cli.en.md anda junto com cli.md, secao por secao (invocacoes ork, tabelas, codigo e titulos)', () => {
  assert.deepEqual(diferencas(ler(PT), ler(EN)), []);
});

test('locale F3a referencia: as duas trazem a linha de troca de lingua, e o indice de docs e o README ingles apontam a versao em ingles', () => {
  const pt = ler(PT).split('\n'), en = ler(EN).split('\n');
  assert.deepEqual(pt.slice(0, 3), ['# Referência do CLI `ork`', '', '[English](cli.en.md) · **Português**']);
  assert.deepEqual(en.slice(0, 3), ['# `ork` CLI reference', '', '**English** · [Português](cli.md)']);
  assert.ok(ler('docs/README.md').includes('[English](referencia/cli.en.md)'), 'indice de docs/');
  assert.ok(ler('README.md').includes('](docs/referencia/cli.en.md)'), 'README em ingles');
  assert.ok(ler('README.pt-BR.md').includes('](docs/referencia/cli.md)'), 'o espelho em portugues segue na de pt-BR');
});

test('locale F3a referencia: telemetria carimba origem, ordem de remoção, opt-in, sensibilidade e Development', () => {
  const casos = [
    {
      idioma: 'pt-BR', texto: ler(PT), titulo: '### Conteúdo de prompts na telemetria',
      origem: 'arquivo exato e do SHA-256 registrados por `phase_prompt_recorded`',
      segredo: 'remove o catálogo de segredos', privado: 'depois aplica `dado_privado`',
      optIn: 'o conteúdo é opt-in', sensivel: 'pode ser sensível', development: 'estado **Development**',
    },
    {
      idioma: 'en', texto: ler(EN), titulo: '### Prompt content in telemetry',
      origem: 'exact file and SHA-256 recorded by `phase_prompt_recorded`',
      segredo: 'removes the secret catalog', privado: 'it then applies `dado_privado`',
      optIn: 'content is opt-in', sensivel: 'can be sensitive', development: 'in **Development** status',
    },
  ];
  for (const caso of casos) {
    const inicio = caso.texto.indexOf(caso.titulo);
    const fim = caso.texto.indexOf('\n---', inicio);
    const secao = caso.texto.slice(inicio, fim);
    assert.notEqual(inicio, -1, caso.idioma);
    assert.ok(secao.includes(caso.origem), `${caso.idioma}: origem carimbada`);
    assert.ok(secao.indexOf(caso.segredo) < secao.indexOf(caso.privado),
      `${caso.idioma}: segredo antecede dado privado`);
    assert.ok(secao.includes(caso.optIn), `${caso.idioma}: opt-in`);
    assert.ok(secao.includes(caso.sensivel), `${caso.idioma}: sensibilidade`);
    assert.ok(secao.includes(caso.development), `${caso.idioma}: estado Development`);
  }
});

test('locale F3a referencia: guias da telemetria cobrem o contrato completo de prompts da F2', () => {
  const casos = [
    {
      idioma: 'pt-BR', texto: ler(GUIA_PT), titulo: '## Conteúdo de prompts', proximo: '## Privacidade e entrega',
      antiga: 'Nenhum hook automático de fase, métrica, trace, texto de prompt, painel ou política empresarial',
      metadadosAntigos: 'Prompt sai somente com metadados já presentes',
      segredo: 'os detectores de segredo processam o texto inteiro', privado: 'Só depois o núcleo aplica `dado_privado`',
      trechos: [
        'arquivo carimbado', 'no mesmo descritor', 'limite de 4 MiB', 'SHA-256 registrado no evento',
        'strings JSON aninhadas por até 16 níveis',
        '`orkastery.prompt.redaction.policy.version=ork.telemetria-redacao/v1`',
        'fecha o fluxo antes do evento', 'JSON OTLP aninhado de `gen_ai.input.messages`',
        'pedido é limitado a 1 MiB', '`metadata_missing`', '`file_missing`', '`unsafe_path`',
        '`invalid_type`', '`too_large`', '`invalid_encoding`', '`hash_mismatch`',
        '`orkastery.prompt.content.state=gap`', '`orkastery.prompt.gap.reason`',
        'a fila continua com o evento seguinte', 'a perda do prompt fica observável',
        'Só um prompt que não cabe sozinho', 'fronteira de ponto de código Unicode',
        '`orkastery.prompt.truncated=true`', 'é idêntica ao envio', 'opt-in',
        'a empresa que recebe os logs vê o texto restante', 'Semantic Conventions GenAI 1.37.0',
        'estado **Development**',
      ],
    },
    {
      idioma: 'en', texto: ler(GUIA_EN), titulo: '## Prompt content', proximo: '## Privacy and delivery',
      antiga: 'This slice creates no automatic phase hook, metric, trace, prompt text, dashboard or enterprise policy',
      metadadosAntigos: 'A prompt exports only metadata already present',
      segredo: 'the secret detectors process the entire text', privado: 'Only then does the core apply `dado_privado`',
      trechos: [
        'stamped file', 'on the same descriptor', '4 MiB limit', 'SHA-256 recorded in the event',
        'JSON strings nested up to 16 levels',
        '`orkastery.prompt.redaction.policy.version=ork.telemetria-redacao/v1`',
        'fails closed before the event', 'nested OTLP JSON in `gen_ai.input.messages`',
        'request is limited to 1 MiB', '`metadata_missing`', '`file_missing`', '`unsafe_path`',
        '`invalid_type`', '`too_large`', '`invalid_encoding`', '`hash_mismatch`',
        '`orkastery.prompt.content.state=gap`', '`orkastery.prompt.gap.reason`',
        'the queue continues with the next event', 'makes the prompt loss observable',
        'Only a prompt that does not fit by itself', 'Unicode code point boundary',
        '`orkastery.prompt.truncated=true`', 'is identical to sending', 'opt-in',
        'the company receiving the logs can see the remaining text', 'GenAI Semantic Conventions 1.37.0',
        'in **Development** status',
      ],
    },
  ];
  for (const caso of casos) {
    const inicio = caso.texto.indexOf(caso.titulo);
    const fim = caso.texto.indexOf(caso.proximo, inicio);
    assert.notEqual(inicio, -1, `${caso.idioma}: seção`);
    assert.notEqual(fim, -1, `${caso.idioma}: fim da seção`);
    const secao = caso.texto.slice(inicio, fim);
    assert.ok(secao.indexOf(caso.segredo) < secao.indexOf(caso.privado),
      `${caso.idioma}: segredo antecede dado privado`);
    for (const trecho of caso.trechos) assert.ok(secao.includes(trecho), `${caso.idioma}: ${trecho}`);
    assert.ok(secao.includes('https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-events.md'),
      `${caso.idioma}: link oficial da 1.37.0`);
    assert.equal(caso.texto.includes(caso.antiga), false, `${caso.idioma}: frase antiga da F1`);
    assert.equal(caso.texto.includes(caso.metadadosAntigos), false, `${caso.idioma}: negação antiga do conteúdo`);
  }
});

test('locale F3a referencia: os links relativos da versao em ingles existem, e o texto esta em ingles e sem travessao', () => {
  const en = ler(EN);
  for (const m of en.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/.test(m[1])) continue;
    assert.ok(fs.existsSync(path.join(RAIZ, 'docs/referencia', m[1])), `link quebrado: ${m[1]}`);
  }
  assert.ok(!en.includes('—'), 'sem travessao U+2014');
  assert.deepEqual(linhasEmPortugues(prosa(en), ['Projeto consultado']), []);
});

test('locale F3a referencia (negativo): a conferencia reprova comando faltando, linha de tabela a mais e codigo mudado', () => {
  const pt = ler(PT), en = ler(EN);
  const semComando = en.replace(/^\| `ork demo .*\n/m, '');
  assert.notEqual(semComando, en);
  assert.ok(diferencas(pt, semComando).some((d) => d.includes('invocacoes ork diferentes') && d.includes('demo')), 'comando faltando');
  const linhaAMais = en.replace('| `ork board plan` |', '| `ork board plan` | x |\n| `ork board plan` |');
  assert.ok(diferencas(pt, linhaAMais).some((d) => d.includes('linhas de tabela')), 'linha de tabela a mais');
  const codigo = en.replace('ork grafo indexar --verificar\n', 'ork grafo indexar\n');
  assert.ok(diferencas(pt, codigo).some((d) => d.includes('bloco de codigo diferente')), 'codigo mudado');
});

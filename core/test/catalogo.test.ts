/**
 * Testes do catalogo de skills finas e das checklists normativas (bloco B4).
 *
 * A regra do catalogo original que este bloco portou: skill e roteador fino que chama o `ork`,
 * e as checklists sao citaveis POR ITEM. Os dois viram teste aqui, porque as duas regras se
 * perdem exatamente do jeito que nao da para revisar no olho: uma skill que engorda de volta e
 * uma renumeracao que quebra toda citacao ja escrita.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUCKETS, exigirCatalogo, referenciasDoCatalogo, skillsDoCatalogo } from '../src/catalogo';
import { lerCasos } from '../src/evalrunner';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));

test('o catálogo corresponde ao corpus, sem duplicatas e com todos os buckets', () => {
  const skills = skillsDoCatalogo(RAIZ);
  const corpus = lerCasos(RAIZ);
  assert.deepEqual(corpus.falhas, []);
  assert.deepEqual(skills.map(s => s.nome).sort(), corpus.arquivos.map(a => a.skill).sort());
  assert.equal(new Set(skills.map(s => s.nome)).size, skills.length, 'nomes únicos');
  const porBucket = new Map<string, number>();
  for (const s of skills) porBucket.set(s.bucket, (porBucket.get(s.bucket) ?? 0) + 1);
  for (const bucket of BUCKETS) {
    assert.ok((porBucket.get(bucket) ?? 0) > 0, `bucket ${bucket} vazio`);
  }
  assert.deepEqual([...porBucket.keys()].sort(), [...BUCKETS].sort());
});

test('cada skill e casca fina: frontmatter, roteamento para o ork e tamanho de roteador', () => {
  for (const skill of skillsDoCatalogo(RAIZ)) {
    const texto = fs.readFileSync(skill.caminho, 'utf8');
    assert.ok(texto.startsWith('---\n'), `${skill.nome}: sem frontmatter`);
    assert.match(texto, new RegExp(`\\nname: ${skill.nome}\\n`), `${skill.nome}: name divergente`);
    assert.match(texto, /\ndescription: /, `${skill.nome}: sem description`);
    assert.match(texto, new RegExp(`\\nbucket: ${skill.bucket}\\n`), `${skill.nome}: bucket divergente`);

    // Casca fina: ela CHAMA o `ork`. Skill que nao cita um comando do nucleo virou prosa.
    assert.match(texto, /\bork [a-z]/, `${skill.nome}: nao roteia para nenhum comando do ork`);

    const linhas = texto.split('\n').length;
    assert.ok(linhas <= 120, `${skill.nome}: ${linhas} linhas, um roteador nao passa de 120`);

    // Toda skill precisa das duas secoes que o corpus de eval usa como ancora.
    assert.ok(texto.includes('## Racionalizacoes comuns'), `${skill.nome}: sem tabela de desculpas`);
    assert.ok(texto.includes('## Bandeiras vermelhas'), `${skill.nome}: sem bandeiras vermelhas`);
  }
});

test('as 5 checklists numeram os itens uma vez so, sem buraco e sem repeticao', () => {
  const refs = referenciasDoCatalogo(RAIZ).filter((r) => !r.endsWith('README.md'));
  assert.equal(refs.length, 5, 'as cinco checklists normativas');

  const citacao: Record<string, string> = {
    'definition-of-done.md': 'DoD',
    'code-review-axes.md': 'REVIEW',
    'security-checklist.md': 'SEC',
    'testing-patterns.md': 'TEST',
    'performance-checklist.md': 'PERF',
  };

  for (const ref of refs) {
    const nome = path.basename(ref);
    const texto = fs.readFileSync(ref, 'utf8');
    const prefixo = citacao[nome];
    assert.ok(prefixo, `checklist inesperada: ${nome}`);
    assert.ok(
      texto.includes(`Cite um item como \`${prefixo} `),
      `${nome}: nao diz como se cita um item`
    );

    // Os numeros vem da primeira coluna das tabelas: 1, 2, 3, ... sem pular e sem repetir.
    const numeros = [...texto.matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1]));
    assert.ok(numeros.length >= 8, `${nome}: so ${numeros.length} itens numerados`);
    assert.deepEqual(
      numeros,
      numeros.map((_, i) => i + 1),
      `${nome}: a numeracao pulou, repetiu ou saiu de ordem, e isso quebra toda citacao ja escrita`
    );

    // Regra 2 das referencias: o que a maquina nao roda vai para Recomendacoes, dizendo isso.
    assert.ok(texto.includes('## Recomendacoes'), `${nome}: sem a secao de recomendacoes`);
  }
});

test('o catalogo e os adaptadores seguem o idioma do projeto: sem travessao longo', () => {
  const alvos = ['skills', 'references', 'adapters', 'prompts', path.join('eval', 'casos')];
  const comTravessao: string[] = [];
  const varrer = (dir: string): void => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        varrer(caminho);
        continue;
      }
      if (fs.readFileSync(caminho, 'utf8').includes('—')) {
        comTravessao.push(path.relative(RAIZ, caminho));
      }
    }
  };
  for (const alvo of alvos) varrer(path.join(RAIZ, alvo));
  assert.deepEqual(comTravessao, [], 'o padrao do projeto e hifen ou virgula, nunca U+2014');
});

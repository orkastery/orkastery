/**
 * Testes do `ork eval` (bloco B4).
 *
 * O teste mais importante deste arquivo nao e "o eval passa": e **o eval reprova quando a
 * regra some**. Um corpus que fica verde depois de a regra ser apagada nao protege nada, e a
 * unica forma de saber e apagando de proposito. E o que o corpus plantado faz aqui, o mesmo
 * metodo que o catalogo original usava para provar que os evals dele mediam alguma coisa.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CANARIOS } from '../src/canarios';
import { exigirCatalogo, skillsDoCatalogo } from '../src/catalogo';
import {
  ArquivoDeCasos,
  intervaloDaTabelaDeDesculpas,
  lerCasos,
  MINIMO_DE_CASOS,
  normalizar,
  rodarEval,
  TIPOS_DE_CASO,
} from '../src/evalrunner';
import { dirTemporario } from '../src/sandbox';

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));

/** Copia o catalogo para um diretorio temporario, onde da para mutilar sem medo. */
function catalogoDeRascunho(nome: string): { dir: string; limpar: () => void } {
  const dir = dirTemporario(nome);
  for (const alvo of ['skills', 'references', 'eval']) {
    fs.cpSync(path.join(RAIZ, alvo), path.join(dir, alvo), { recursive: true });
  }
  return { dir, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('o eval do produto cobre os canários, skills, casos e asserções do catálogo vigente', () => {
  const corpus = lerCasos(RAIZ);
  assert.deepEqual(corpus.falhas, []);
  const casos = corpus.arquivos.flatMap(a => a.casos);
  const r = rodarEval({ catalogo: RAIZ });
  assert.deepEqual(r.falhas, [], 'o eval do proprio produto precisa estar verde');
  assert.deepEqual(r.canarios.map(c => c.id).sort(), CANARIOS.map(c => c.id).sort());
  assert.equal(r.canarios.filter((c) => c.estado === 'passou').length, CANARIOS.length);
  assert.deepEqual(r.skills.map(s => s.skill).sort(), skillsDoCatalogo(RAIZ).map(s => s.nome).sort());
  assert.equal(r.totalDeCasos, casos.length);
  assert.equal(r.totalDeAssercoes, casos.reduce((total, c) => total + c.assercoes.length, 0));
  for (const arquivo of corpus.arquivos) {
    const linha = r.skills.find(s => s.skill === arquivo.skill)!;
    assert.equal(linha.casos, arquivo.casos.length);
    assert.equal(linha.assercoes, arquivo.casos.reduce((total, c) => total + c.assercoes.length, 0));
  }
  assert.equal(r.metadeComportamental, 'unavailable', 'lacuna e publicada como lacuna');
  assert.ok(r.ok);
});

test('todo canario registrado tem fixture em disco, e vice-versa', () => {
  for (const c of CANARIOS) {
    const caminho = path.join(RAIZ, 'eval', 'fixtures', c.id, 'caso.json');
    assert.ok(fs.existsSync(caminho), `canario ${c.id} sem fixture versionada`);
    const fixture = JSON.parse(fs.readFileSync(caminho, 'utf8')) as {
      id: string;
      porque?: string;
      esperado: Record<string, unknown>;
    };
    assert.equal(fixture.id, c.id);
    assert.ok((fixture.porque ?? '').length > 40, `${c.id}: a fixture precisa dizer por que existe`);
    assert.ok(Object.keys(fixture.esperado).length >= 3, `${c.id}: expectativa fraca demais`);
  }
});

test('o corpus cumpre o contrato de cobertura de todas as skills', () => {
  const { arquivos, falhas } = lerCasos(RAIZ);
  assert.deepEqual(falhas, []);
  const nomes = skillsDoCatalogo(RAIZ).map((s) => s.nome).sort();
  assert.ok(nomes.length > 0, 'catálogo vazio não comprova cobertura');
  assert.deepEqual(arquivos.map((a) => a.skill).sort(), nomes, 'um arquivo de casos por skill');
  for (const arquivo of arquivos) {
    assert.ok(arquivo.casos.length >= MINIMO_DE_CASOS, `${arquivo.skill}: casos de menos`);
    for (const tipo of TIPOS_DE_CASO) {
      assert.ok(
        arquivo.casos.some((c) => c.tipo === tipo),
        `${arquivo.skill}: nenhum caso do tipo ${tipo}`
      );
    }
    for (const caso of arquivo.casos) {
      assert.ok(caso.assercoes.length > 0, `${caso.id}: sem assercao`);
      assert.ok(caso.cenario.length > 20 && caso.esperado.length > 20, `${caso.id}: caso vago`);
    }
  }
});

test('apagar a regra de uma skill deixa o eval vermelho (corpus plantado)', () => {
  const rascunho = catalogoDeRascunho('eval-plantado');
  try {
    const verde = rodarEval({ catalogo: rascunho.dir, soSkills: true });
    assert.deepEqual(verde.falhas, [], 'a copia intacta precisa comecar verde');

    // 1. Regra apagada da skill: o caso que depende dela fica vermelho, com o motivo.
    const alvo = path.join(rascunho.dir, 'skills', 'reviewers', 'code-reviewer', 'SKILL.md');
    const original = fs.readFileSync(alvo, 'utf8');
    fs.writeFileSync(
      alvo,
      original.replace('quem revisa nao corrige', 'o reviewer resolve o que puder'),
      'utf8'
    );
    const semRegra = rodarEval({ catalogo: rascunho.dir, soSkills: true });
    assert.ok(
      semRegra.falhas.some(
        (f) => f.codigo === 'assercao' && f.caso === 'code-reviewer/reviewer-corrige'
      ),
      'apagar a separacao do reviewer precisa reprovar'
    );
    fs.writeFileSync(alvo, original, 'utf8');

    // 2. Skill nova sem eval nao entra: e a regra do catalogo, executavel.
    const nova = path.join(rascunho.dir, 'skills', 'governance', 'skill-sem-eval', 'SKILL.md');
    fs.mkdirSync(path.dirname(nova), { recursive: true });
    fs.writeFileSync(nova, '---\nname: skill-sem-eval\n---\n# sem eval\n', 'utf8');
    const semEval = rodarEval({ catalogo: rascunho.dir, soSkills: true });
    assert.ok(semEval.falhas.some((f) => f.codigo === 'skill-sem-eval'));
    fs.rmSync(path.dirname(nova), { recursive: true, force: true });

    // 3. Caso de racionalizacao ancorado SO na tabela de desculpas: a skill listaria a
    // desculpa sem carregar a regra que responde a ela, e o runner precisa notar.
    const casos = path.join(rascunho.dir, 'eval', 'casos', 'thread-tracing.json');
    const corpus = JSON.parse(fs.readFileSync(casos, 'utf8')) as ArquivoDeCasos;
    const caso = corpus.casos.find((c) => c.tipo === 'racionalizacao');
    assert.ok(caso);
    caso.assercoes = [
      {
        tipo: 'contem',
        valor: 'Escrevo um evento a mais para deixar o rastro completo',
        porque: 'ancora que existe apenas dentro da tabela de racionalizacoes',
      },
    ];
    fs.writeFileSync(casos, JSON.stringify(corpus, null, 2), 'utf8');
    const soNaTabela = rodarEval({ catalogo: rascunho.dir, soSkills: true });
    assert.ok(
      soNaTabela.falhas.some((f) => f.codigo === 'ancora-fora-da-tabela'),
      'ancora so na tabela de desculpas nao prova que a skill segura a regra'
    );
  } finally {
    rascunho.limpar();
  }
});

test('o casamento ignora quebra de linha, e a tabela de desculpas e delimitada', () => {
  assert.equal(normalizar('uma  regra\n   quebrada'), 'uma regra quebrada');

  const texto = fs.readFileSync(
    path.join(RAIZ, 'skills', 'phases', 'goal-definition', 'SKILL.md'),
    'utf8'
  );
  const intervalo = intervaloDaTabelaDeDesculpas(texto);
  assert.ok(intervalo, 'a skill tem tabela de racionalizacoes');
  const normalizado = normalizar(texto);
  const dentro = normalizado.slice(intervalo.inicio, intervalo.fim);
  assert.ok(dentro.includes('## Racionalizacoes comuns'));
  assert.ok(!dentro.includes('## Bandeiras vermelhas'), 'a tabela termina na proxima secao');
});

/**
 * I-44: documentacao como codigo. Cada teste monta um repositorio git temporario com paginas
 * de produto e de roadmap e confere o que o verificador acusa e o que o sincronizador grava.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, commitar } from './apoio';
import {
  comandosDaAjuda, escreverYaml, iniciarDocs, renderizarEstado, renderizarRelance, separarFrontmatter, sincronizarDocs,
  verificarDocs, type Achado, type Documento,
} from '../src/docs';
import { lerYaml } from '../src/yaml';
import { dirThread } from '../src/thread';
import { exec } from '../src/util';

const AJUDA = '  accounts list [--json]   perfis\n  verify <thread-id>        reexecuta claims\n'
  + '  brain status|inventory|get\n        [--json]                 continuacao nao e comando\n';
const AGORA = '2026-09-24T20:00:00-03:00';

function escrever(raiz: string, rel: string, texto: string): void {
  fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(raiz, rel), texto);
}

function pagina(frontmatter: string, corpo: string): string {
  return `---\n${frontmatter.trim()}\n---\n\n${corpo.trim()}\n`;
}

const CONTEXTO = (id: string, tipo: string, pai: string | null, titulo: string) => pagina(`
id: ${id}
tipo: ${tipo}
titulo: ${titulo}
owner: Julio
estado: vigente
${pai ? `pai: ${pai}` : ''}
verificado_em: ${AGORA}
`, `
# ${id} — ${titulo}

> **Em uma frase:** ${titulo} existe para o teste.

## Contexto e limites

- **Objetivo:** fixture.
`);

function hierarquia(raiz: string): void {
  escrever(raiz, 'docs/produto/PLAT-01-plataforma.md', CONTEXTO('PLAT-01', 'plataforma', null, 'Plataforma'));
  escrever(raiz, 'docs/produto/SYS-01-sistema.md', CONTEXTO('SYS-01', 'sistema', 'PLAT-01', 'Sistema'));
  escrever(raiz, 'docs/produto/MOD-01-modulo.md', CONTEXTO('MOD-01', 'modulo', 'SYS-01', 'Modulo'));
}

function feature(extraFontes = '', corpoExtra = ''): string {
  return pagina(`
id: FEAT-001
tipo: feature
titulo: Rodizio de contas
owner: Julio
aprovador: Julio
estado: vigente
pai: MOD-01
roadmap: [RM-001]
verificado_em: ${AGORA}
versao: main@abc1234
fontes:
  codigo: [src/perfis.ts]
  testes: [test/perfis.test.ts]
  simbolos: [src/perfis.ts#trocarConta]
  contratos: [ork.runtime-profiles/v1]
  comandos: [ork accounts list]
${extraFontes}
`, `
# FEAT-001 — Rodizio de contas

> **Em uma frase:** quando uma conta esgota, o despacho segue na proxima.

## Comportamento

- **Fluxo principal:** troca de conta.
${corpoExtra}

## Dados e contratos

- **Contrato:** \`ork.runtime-profiles/v1\`.

## Operação e controle

- **Rollback:** desativar o perfil.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-19 | criada | Julio | PR #15 |
`);
}

function itemDeRoadmap(opcoes: { estado?: string; evidencias?: string; sdlc?: string; corpoEstado?: 'gerado' | 'vazio' } = {}): string {
  const estado = opcoes.estado ?? `
  ciclo: Em desenvolvimento
  documentacao: Rascunho
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente`;
  const fm = `
id: RM-001
tipo: roadmap
titulo: Rotacao de contas
categoria: iniciativa
pai: null
features: [FEAT-001]
owner: Julio
atualizado_em: ${AGORA}
estado:${estado}
evidencias:${opcoes.evidencias ?? `
  codigo:
    commit: null
    pr: null`}
${opcoes.sdlc ?? ''}`;
  const doc = { dados: lerYaml(fm) as Record<string, never> } as unknown as Documento;
  const relance = opcoes.corpoEstado === 'vazio' ? '' : renderizarRelance(doc);
  const tabela = opcoes.corpoEstado === 'vazio' ? '' : renderizarEstado(doc);
  return pagina(fm, `
# RM-001 — Rotacao de contas

> **Em uma frase:** nenhum roadmap para porque uma conta acabou.

<!-- ork-docs:relance:inicio -->
${relance}
<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Problema:** conta unica.

## Escopo e validação

- **Incluido:** perfis.

## Plano e decisões

- **Prioridade:** alta.

## Estado com evidências

<!-- ork-docs:estado:inicio -->
${tabela}
<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** Julio.
`);
}

function projetoComDocs(nome: string): { dir: string; limpar: () => void } {
  const p = projetoTemporario(nome);
  hierarquia(p.dir);
  escrever(p.dir, 'src/perfis.ts', "export const CONTRATO = 'ork.runtime-profiles/v1';\nexport function trocarConta() {}\n");
  escrever(p.dir, 'test/perfis.test.ts', '// teste\n');
  escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature());
  escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap());
  return p;
}

const regras = (achados: Achado[], gravidade: 'erro' | 'aviso' = 'erro') =>
  achados.filter((a) => a.gravidade === gravidade).map((a) => a.regra);

test('init cria padroes, modelos, indices e o lint de Markdown, e e idempotente', () => {
  const p = projetoTemporario('docs-init');
  try {
    const criados = iniciarDocs(p.dir);
    assert.ok(criados.includes('docs/padroes/documentacao-de-produto.md'));
    assert.ok(criados.includes('docs/padroes/roadmap-de-produto.md'));
    assert.ok(criados.includes('docs/produto/_modelo-feature.md'));
    assert.ok(criados.includes('docs/roadmap/_modelo-item.md'));
    assert.ok(criados.includes('.markdownlint-cli2.jsonc'));
    assert.deepEqual(iniciarDocs(p.dir), [], 'a segunda rodada nao sobrescreve nada');
    // Os modelos comecam com _ e nao sao paginas: projeto recem-iniciado nao reprova.
    assert.deepEqual(regras(verificarDocs(p.dir, { semGit: true }).achados), []);
  } finally { p.limpar(); }
});

test('pagina de produto e item de roadmap validos passam sem erro nem aviso', () => {
  const p = projetoComDocs('docs-valido');
  try {
    const { docs, achados } = verificarDocs(p.dir, { ajudaDoCli: AJUDA });
    assert.equal(docs.length, 5);
    assert.deepEqual(achados, []);
  } finally { p.limpar(); }
});

test('modelo copiado sem preencher reprova em cada valor esquecido', () => {
  const p = projetoTemporario('docs-modelo');
  try {
    iniciarDocs(p.dir);
    fs.copyFileSync(path.join(p.dir, 'docs/produto/_modelo-feature.md'), path.join(p.dir, 'docs/produto/FEAT-000-x.md'));
    const r = regras(verificarDocs(p.dir, { semGit: true }).achados);
    assert.ok(r.includes('docs.modelo'), r.join(','));
    assert.ok(r.filter((x) => x === 'docs.modelo').length >= 6, 'frontmatter e corpo');
  } finally { p.limpar(); }
});

test('identidade: formato do ID, nome do arquivo, pasta e ID repetido', () => {
  const p = projetoComDocs('docs-id');
  try {
    escrever(p.dir, 'docs/produto/FEAT-1-curto.md', feature().replace('id: FEAT-001', 'id: FEAT-1').replace('# FEAT-001', '# FEAT-1'));
    escrever(p.dir, 'docs/produto/FEAT-001-copia.md', feature());
    escrever(p.dir, 'docs/produto/rodizio-sem-id.md', feature().replace('id: FEAT-001', 'id: FEAT-002').replace('# FEAT-001', '# FEAT-002'));
    const r = regras(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados);
    assert.ok(r.includes('docs.id.formato'));
    assert.ok(r.includes('docs.id.duplicado'));
    assert.ok(r.includes('docs.id.arquivo'));
  } finally { p.limpar(); }
});

test('frontmatter: ausente, estado fora do padrao e dimensao de roadmap fora do padrao', () => {
  const p = projetoComDocs('docs-frontmatter');
  try {
    escrever(p.dir, 'docs/produto/FEAT-009-sem.md', '# FEAT-009 — sem frontmatter\n');
    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature().replace('estado: vigente', 'estado: feito'));
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap().replace('  codigo: Branch criada', '  codigo: quase'));
    const achados = verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados;
    const r = regras(achados);
    assert.ok(r.includes('docs.frontmatter.ausente'));
    assert.ok(achados.some((a) => a.regra === 'docs.frontmatter.valor' && /estado "feito"/.test(a.mensagem)));
    assert.ok(achados.some((a) => a.regra === 'docs.frontmatter.valor' && /estado\.codigo "quase"/.test(a.mensagem)));
  } finally { p.limpar(); }
});

test('leitura para TDAH: resposta primeiro, frase curta, secoes fixas, paragrafo curto', () => {
  const p = projetoComDocs('docs-leitura');
  try {
    const longo = 'Um paragrafo que nao para. '.repeat(30);
    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature('', `\n${longo}\n`)
      .replace(/> \*\*Em uma frase:\*\*.*\n/, '')
      .replace('## Operação e controle', '## Operacao'));
    const achados = verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados;
    assert.ok(regras(achados).includes('docs.leitura.resumo'));
    assert.ok(achados.some((a) => a.regra === 'docs.secao' && /Operação e controle/.test(a.mensagem)));
    assert.ok(regras(achados, 'aviso').includes('docs.leitura.paragrafo'));

    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md',
      feature().replace(/(> \*\*Em uma frase:\*\*).*\n/, `$1 ${'x'.repeat(260)}\n`));
    assert.ok(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados
      .some((a) => a.regra === 'docs.leitura.resumo' && /260 caracteres/.test(a.mensagem)));
  } finally { p.limpar(); }
});

test('paridade com o codigo: fonte, simbolo, contrato e comando que nao existem', () => {
  const p = projetoComDocs('docs-paridade-codigo');
  try {
    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature()
      .replace('codigo: [src/perfis.ts]', 'codigo: [src/perfis.ts, src/sumiu.ts]')
      .replace('simbolos: [src/perfis.ts#trocarConta]', 'simbolos: [src/perfis.ts#renomeado]')
      .replace('contratos: [ork.runtime-profiles/v1]', 'contratos: [ork.runtime-profiles/v9]')
      .replace('comandos: [ork accounts list]', 'comandos: [ork accounts sumir]'));
    const r = regras(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados);
    for (const regra of ['docs.paridade.fonte', 'docs.paridade.simbolo', 'docs.paridade.contrato', 'docs.paridade.comando']) {
      assert.ok(r.includes(regra), `${regra} em ${r.join(',')}`);
    }
  } finally { p.limpar(); }
});

test('ajuda do CLI: subcomando com alternativas conta, argumento e continuacao nao', () => {
  const c = comandosDaAjuda(AJUDA);
  for (const k of ['accounts', 'accounts list', 'verify', 'brain', 'brain status', 'brain inventory', 'brain get']) assert.ok(c.has(k), k);
  assert.ok(!c.has('verify <thread-id>'));
  assert.ok(![...c].some((k) => k.startsWith('json')));
  const p = projetoComDocs('docs-comandos');
  try {
    // Comando sem subcomando aceita argumento; comando com subcomandos exige o par declarado.
    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature()
      .replace('comandos: [ork accounts list]', 'comandos: [ork accounts list, ork verify ork-x, ork brain inventory]'));
    assert.deepEqual(regras(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados), []);
    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature().replace('comandos: [ork accounts list]', 'comandos: [ork sumiu]'));
    assert.ok(regras(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados).includes('docs.paridade.comando'));
  } finally { p.limpar(); }
});

test('referencias: pai inexistente, roadmap inexistente e citacao sem volta', () => {
  const p = projetoComDocs('docs-referencias');
  try {
    escrever(p.dir, 'docs/produto/FEAT-001-rodizio.md', feature().replace('pai: MOD-01', 'pai: MOD-07').replace('roadmap: [RM-001]', 'roadmap: [RM-001, RM-404]'));
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap().replace('features: [FEAT-001]', 'features: []'));
    const achados = verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados;
    assert.ok(achados.some((a) => a.regra === 'docs.referencia' && /MOD-07/.test(a.mensagem)));
    assert.ok(achados.some((a) => a.regra === 'docs.referencia' && /RM-404/.test(a.mensagem)));
    assert.ok(regras(achados, 'aviso').includes('docs.referencia.reciproca'));
  } finally { p.limpar(); }
});

test('paridade com o git: Mesclado so vale com commit que esta na base', () => {
  const p = projetoComDocs('docs-paridade-git');
  try {
    const estadoMesclado = `
  ciclo: Em validação
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente`;
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ estado: estadoMesclado }));
    let achados = verificarDocs(p.dir, { ajudaDoCli: AJUDA }).achados;
    assert.ok(achados.some((a) => a.regra === 'docs.paridade.git' && /sem o commit/.test(a.mensagem)));

    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ estado: estadoMesclado, evidencias: '\n  codigo:\n    commit: deadbee\n    pr: 15' }));
    achados = verificarDocs(p.dir, { ajudaDoCli: AJUDA }).achados;
    assert.ok(achados.some((a) => a.regra === 'docs.paridade.git' && /não existe/.test(a.mensagem)));

    // Cada passo de git precisa dar certo: o CI ja reprovou a ultima asercao sem dizer por que, e
    // um checkout ou commit que falhasse em silencio produziria exatamente esse sintoma.
    const git = (...args: string[]) => {
      const r = exec('git', args, p.dir);
      assert.ok(r.ok, `git ${args.join(' ')} falhou: ${r.stderr.trim()}`);
      return r.stdout.trim();
    };

    // Commit de uma branch que nunca foi mesclada: existe, mas nao esta na main.
    git('checkout', '-q', '-b', 'lateral');
    const lateral = commitar(p.dir, 'lateral.txt', 'x\n', 'lateral');
    assert.equal(git('rev-parse', 'lateral'), lateral);
    git('checkout', '-q', 'main');
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ estado: estadoMesclado, evidencias: `\n  codigo:\n    commit: ${lateral.slice(0, 7)}\n    pr: 15` }));
    achados = verificarDocs(p.dir, { ajudaDoCli: AJUDA }).achados;
    assert.ok(achados.some((a) => a.regra === 'docs.paridade.git' && /não está na main/.test(a.mensagem)));

    const naMain = commitar(p.dir, 'main.txt', 'y\n', 'na main');
    assert.equal(git('branch', '--show-current'), 'main');
    assert.equal(git('rev-parse', 'main'), naMain);
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ estado: estadoMesclado, evidencias: `\n  codigo:\n    commit: ${naMain.slice(0, 7)}\n    pr: 15` }));
    // As mensagens, e nao so a regra: se reprovar de novo no CI, o log diz qual das tres foi.
    assert.deepEqual(verificarDocs(p.dir, { ajudaDoCli: AJUDA }).achados
      .filter((a) => a.gravidade === 'erro').map((a) => `${a.regra}: ${a.mensagem}`), []);
  } finally { p.limpar(); }
});

test('paridade com o git: SHA curto so de digitos com zero a esquerda chega inteiro ao verificador', () => {
  // Na leitura do YAML, 0123456 virava o numero 123456: o teste acima caia quando o SHA sorteado tinha essa forma.
  const valor = (yaml: string) => (lerYaml(yaml) as Record<string, unknown>).v;
  assert.equal(valor('v: 0123456\n'), '0123456');
  assert.equal(valor('v: 1234567\n'), 1234567);
  assert.equal(valor('v: 12345678901234567890\n'), '12345678901234567890');
  assert.equal(valor('v: 0\n'), 0);
  assert.equal(valor('v: -42\n'), -42);
  const p = projetoComDocs('docs-paridade-zero');
  try {
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ estado: `
  ciclo: Em validação
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente`, evidencias: '\n  codigo:\n    commit: 0123456\n    pr: 15' }));
    const achados = verificarDocs(p.dir, { ajudaDoCli: AJUDA }).achados;
    assert.ok(achados.some((a) => a.regra === 'docs.paridade.git' && a.mensagem.includes('o commit 0123456 não existe')),
      JSON.stringify(achados.map((a) => a.mensagem)));
  } finally { p.limpar(); }
});

test('coerencia entre dimensoes: Concluido sem codigo Mesclado reprova', () => {
  const p = projetoComDocs('docs-coerencia');
  try {
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ estado: `
  ciclo: Concluído
  documentacao: Aprovada
  codigo: PR aberto
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída` }));
    const achados = verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados;
    assert.ok(achados.filter((a) => a.regra === 'docs.estado.coerencia').length >= 2, 'ciclo e deploy');
  } finally { p.limpar(); }
});

test('tabela de estado editada a mao reprova; sincronizar regera a partir do frontmatter', () => {
  const p = projetoComDocs('docs-tabela');
  try {
    const rel = 'docs/roadmap/RM-001-rotacao.md';
    fs.writeFileSync(path.join(p.dir, rel), fs.readFileSync(path.join(p.dir, rel), 'utf8').replace('| Branch criada |', '| Mesclado |'));
    assert.ok(regras(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados).includes('docs.paridade.estado'));
    sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA });
    assert.deepEqual(regras(verificarDocs(p.dir, { semGit: true, ajudaDoCli: AJUDA }).achados), []);
    // Tabela colada no marcador reprova no markdownlint (MD058): o bloco gerado tem linha em branco em volta.
    const texto = fs.readFileSync(path.join(p.dir, rel), 'utf8');
    assert.match(texto, /<!-- ork-docs:estado:inicio -->\n\n\| Dimensão \|/);
    assert.match(texto, /\| Pendente \| — \| 2026-09-24 \| Julio \|\n\n<!-- ork-docs:estado:fim -->/);
  } finally { p.limpar(); }
});

test('sincronizar: merge da thread na main vira codigo Mesclado com o commit, e so isso', () => {
  const p = projetoComDocs('docs-sync');
  try {
    const thread = 'ork-teste';
    escrever(p.dir, 'docs/roadmap/RM-001-rotacao.md', itemDeRoadmap({ sdlc: `sdlc:\n  thread: ${thread}\n  modo: "#Auto"` }));
    fs.mkdirSync(dirThread(p.dir, thread), { recursive: true });
    fs.writeFileSync(path.join(dirThread(p.dir, thread), 'thread.json'), JSON.stringify({ id: thread, faseAtual: 'MASTER', status: 'aberta' }));
    const merge = commitar(p.dir, 'entrega.txt', 'z\n', `ship(${thread}): merge de ork/${thread}-full em main`);

    const previa = sincronizarDocs(p.dir, { agora: () => AGORA });
    assert.ok(previa.mudancas.some((m) => m.campo === 'estado.codigo' && m.para === 'Mesclado'));
    const antes = fs.readFileSync(path.join(p.dir, 'docs/roadmap/RM-001-rotacao.md'), 'utf8');
    assert.match(antes, /codigo: Branch criada/, 'sem --escrever nada e gravado');

    sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA });
    const { bruto } = separarFrontmatter(fs.readFileSync(path.join(p.dir, 'docs/roadmap/RM-001-rotacao.md'), 'utf8'));
    const dados = lerYaml(bruto!) as Record<string, any>;
    assert.equal(dados.estado.codigo, 'Mesclado');
    assert.equal(dados.evidencias.codigo.commit, merge.slice(0, 7));
    assert.equal(dados.sdlc.fase, 'MASTER');
    // Ciclo, testes e deploy sao decisao de pessoa: o sincronizador nao encosta.
    assert.equal(dados.estado.ciclo, 'Em desenvolvimento');
    assert.equal(dados.estado.deploy, 'Não implantado');
    assert.deepEqual(regras(verificarDocs(p.dir, { ajudaDoCli: AJUDA }).achados), []);
    // Idempotente: a segunda rodada nao tem o que mudar.
    assert.deepEqual(sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA }).mudancas, []);
    // O PR que so atualiza a doc do item tambem entra como ship(<thread>): o merge do item
    // continua sendo o PRIMEIRO, senao cada sincronizacao geraria outra, sem fim.
    commitar(p.dir, 'docs/roadmap/RM-001-rotacao.md', fs.readFileSync(path.join(p.dir, 'docs/roadmap/RM-001-rotacao.md'), 'utf8'),
      `ship(${thread}): pos-merge com a doc sincronizada`);
    assert.deepEqual(sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA }).mudancas, []);
    const depois = lerYaml(separarFrontmatter(fs.readFileSync(path.join(p.dir, 'docs/roadmap/RM-001-rotacao.md'), 'utf8')).bruto!) as Record<string, any>;
    assert.equal(depois.evidencias.codigo.commit, merge.slice(0, 7));
  } finally { p.limpar(); }
});

test('sincronizar regenera o indice do roadmap e do produto entre os marcadores', () => {
  const p = projetoComDocs('docs-indice');
  try {
    iniciarDocs(p.dir);
    const r = sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA });
    assert.ok(r.indices.includes('docs/roadmap/README.md'));
    const indice = fs.readFileSync(path.join(p.dir, 'docs/roadmap/README.md'), 'utf8');
    assert.match(indice, /\| \[RM-001\]\(RM-001-rotacao\.md\) \| Rotacao de contas \| Em desenvolvimento \|/);
    const produto = fs.readFileSync(path.join(p.dir, 'docs/produto/README.md'), 'utf8');
    assert.match(produto, /\[FEAT-001\]\(FEAT-001-rodizio\.md\)/);
    assert.deepEqual(sincronizarDocs(p.dir, { escrever: true, agora: () => AGORA }).indices, [], 'indice estavel');
  } finally { p.limpar(); }
});

test('YAML escrito pelo sincronizador volta identico pelo leitor do nucleo', () => {
  const dados = {
    id: 'RM-044', titulo: 'Docs: codigo e roadmap', pai: null, features: ['FEAT-014'], numero: 15,
    vazio: [], estado: { ciclo: 'Em validação', codigo: 'Mesclado' },
    evidencias: { codigo: { commit: '8f02f44', pr: 17 } }, sdlc: { modo: '#Auto', fase: 'GO' },
    datas: { atualizado_em: AGORA }, texto: 'true', lista: ['Não iniciado', 'com: dois pontos'],
    virgula: ['a, b', 'c'], numeros: ['15', '0.5', '0123456'], aspas: ['diz "oi"', "d'agua"], mapaVazio: {},
    meio: `aspas "duplas" e 'simples' no meio`, comentario: "Sessão d'água #2",
  };
  assert.deepEqual(lerYaml(escreverYaml(dados)), dados);
  // Valor que precisa de aspas e contem os dois tipos nao tem forma no leitor: falha alto, nao corrompe.
  assert.throws(() => escreverYaml({ x: `"duplas" e 'simples'` }), /fora do subconjunto/);
});

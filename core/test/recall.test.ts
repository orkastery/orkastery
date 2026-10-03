/**
 * Testes do `ork recall` (bloco B6): recuperacao TARDIA no momento indicado.
 *
 * O criterio que este arquivo cobra e o da visao, secao 6.1, item 3: um ponteiro marcado
 * `retrieve_when: CHECK` e resolvido pelo `ork recall` APENAS no CHECK, com o conteudo
 * certo; e com o OrkMind desligado o MESMO ponteiro resolve por `path#ancora` (regime
 * `files`), sem mudanca no fluxo de quem le o handoff.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { exportarHandoff } from '../src/handoff';
import { lerLedger } from '../src/ledger';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { abrirMemoria } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { momentoCasa, recallDaThread, resolverPonteiro, textoDoRecall } from '../src/recall';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

function ligarOrkmind(projeto: ProjetoDeTeste): ManifestoCarregado {
  const caminho = path.join(projeto.dir, 'orkastery.yaml');
  const bruto = fs.readFileSync(caminho, 'utf8');
  fs.writeFileSync(
    caminho,
    bruto
      .replace(/^  mode: files$/m, '  mode: orkmind')
      .replace(/^  database_url_env: ""$/m, '  database_url_env: "ORKASTERY_TESTE_DSN"'),
    'utf8'
  );
  return exigirManifesto(projeto.dir);
}

/** Thread com spec commitada e claim verificada: material para virar ponteiro. */
function threadComMaterial(projeto: ProjetoDeTeste, carregado: ManifestoCarregado) {
  const { thread } = novaThread(carregado, { nome: 'recall', modo: 'classic' });
  fs.writeFileSync(
    path.join(projeto.dir, 'spec.md'),
    '# spec\n\n## Criterio do check\n\no CHECK compara contra a baseline\n',
    'utf8'
  );
  adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'spec.md',
    alegacao: 'a spec descreve o criterio do check',
    verificar: ['grep -q "compara contra a baseline" spec.md'],
  });
  const comDecisao = lerThread(projeto.dir, thread.id);
  comDecisao.decisoes.push({
    id: 'D1',
    texto: 'o ponteiro so e resolvido no momento declarado',
    locked: true,
    decididaEm: new Date().toISOString(),
    decididaPor: 'julio',
  });
  gravarThread(projeto.dir, comDecisao);
  return lerThread(projeto.dir, thread.id);
}

test('o ponteiro de CHECK resolve no CHECK e fica adiado no GO', () => {
  const projeto = projetoTemporario('recall-momento');
  try {
    const carregado = projeto.carregado;
    const thread = threadComMaterial(projeto, carregado);
    const memoria = abrirMemoria(carregado);
    assert.equal(memoria.regime, 'files', 'o projeto de teste nasce em regime files');

    // O handoff para a proxima fase CHECK marca os ponteiros com `retrieve_when: CHECK`.
    const { handoff } = exportarHandoff(carregado, thread.id, { proximaFase: 'CHECK' });
    const doCheck = handoff.pointers.filter((p) => p.retrieve_when === 'CHECK');
    assert.ok(doCheck.length > 0, 'o handoff para o CHECK precisa produzir ponteiro de CHECK');
    const artefato = doCheck.find((p) => p.location.startsWith('spec.md'));
    assert.ok(artefato, 'o artefato citado pela claim vira ponteiro, nao texto colado');

    // No GO, o ponteiro de CHECK NAO entrega conteudo: ele fica listado como adiado.
    const noGo = recallDaThread(carregado, memoria, thread.id, { momento: 'GO' });
    assert.equal(noGo.resolvidos.filter((p) => p.id === artefato.id).length, 0);
    const adiado = noGo.adiados.find((p) => p.id === artefato.id);
    assert.ok(adiado, 'o ponteiro de CHECK precisa aparecer como adiado no GO');
    assert.equal(adiado.motivo, 'fora-do-momento');
    assert.equal(adiado.conteudo, '', 'ponteiro fora do momento nao carrega conteudo nenhum');
    assert.ok(adiado.location.length > 0, 'mesmo adiado, o ponteiro diz ONDE esta');

    // No CHECK, o mesmo ponteiro resolve com o conteudo certo.
    const noCheck = recallDaThread(carregado, memoria, thread.id, { momento: 'CHECK' });
    const resolvido = noCheck.resolvidos.find((p) => p.id === artefato.id);
    assert.ok(resolvido, 'o ponteiro de CHECK precisa resolver no CHECK');
    assert.equal(resolvido.motivo, 'ok');
    assert.equal(resolvido.via, 'files');
    assert.ok(
      resolvido.conteudo.includes('o CHECK compara contra a baseline'),
      'o conteudo recuperado precisa ser o do arquivo apontado'
    );
    assert.equal(noCheck.falhas.length, 0);

    // `--forcar` existe para o humano, e o texto declara o que foi resolvido e o que nao.
    const forcado = recallDaThread(carregado, memoria, thread.id, { momento: 'GO', forcar: true });
    assert.ok(forcado.resolvidos.some((p) => p.id === artefato.id));
    assert.ok(textoDoRecall(noCheck).includes('RESOLVIDOS'));
    assert.ok(textoDoRecall(noGo).includes('ADIADOS'));

    // O recall vira evento no ledger: o que entrou no contexto e rastreavel depois.
    const eventos = lerLedger(dirThread(projeto.dir, thread.id));
    const registrados = eventos.filter((e) => e.tipo === 'recall_resolved');
    assert.equal(registrados.length, 3);
    assert.equal(registrados[0].momento, 'GO');
    assert.equal(registrados[0].resolvidos, 0);
  } finally {
    projeto.limpar();
  }
});

test('o mesmo ponteiro resolve por tag com OrkMind e por path#ancora sem ele', () => {
  const projeto = projetoTemporario('recall-regime');
  try {
    const carregado = ligarOrkmind(projeto);
    const driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });
    assert.equal(memoria.regime, 'orkmind');
    const thread = threadComMaterial(projeto, carregado);

    // Primeiro handoff: publica o pacote na colecao `handoff` do OrkMind.
    exportarHandoff(carregado, thread.id, { proximaFase: 'GO', memoria });
    assert.equal(driver.tudo().filter((e) => e.collection === 'handoff').length, 1);

    // Segundo handoff, ja para o CHECK: o handoff anterior vira PONTEIRO, com os dois
    // enderecos (o semantico e o `path#ancora` do arquivo commitado).
    const { handoff } = exportarHandoff(carregado, thread.id, { proximaFase: 'CHECK', memoria });
    assert.equal(handoff.memory, 'orkmind', 'o handoff declara o regime EFETIVO');
    const semantico = handoff.pointers.find((p) => p.orkmind !== undefined);
    assert.ok(semantico, 'em regime orkmind o handoff anterior vira ponteiro com endereco semantico');
    assert.equal(semantico.retrieve_when, 'CHECK');
    assert.ok(semantico.orkmind?.startsWith('orkmind://handoff/'));
    assert.ok(
      semantico.location.includes('.json#'),
      'o location continua sendo o arquivo commitado, no formato path#ancora'
    );

    // Com OrkMind ligado: resolve por tag na memoria semantica.
    const comOrkmind = recallDaThread(carregado, memoria, thread.id, { momento: 'CHECK' });
    const porTag = comOrkmind.resolvidos.find((p) => p.id === semantico.id);
    assert.ok(porTag);
    assert.equal(porTag.via, 'orkmind');
    assert.ok(porTag.conteudo.includes('Handoff da thread'));
    assert.ok(porTag.conteudo.includes('Triagem:'));

    // Com OrkMind fora do ar: o MESMO ponteiro, o MESMO comando, o MESMO momento.
    driver.ligado = false;
    const semOrkmind = abrirMemoria(carregado, { driver });
    assert.equal(semOrkmind.regime, 'files');
    const porArquivo = recallDaThread(carregado, semOrkmind, thread.id, { momento: 'CHECK' });
    const mesmo = porArquivo.resolvidos.find((p) => p.id === semantico.id);
    assert.ok(mesmo, 'o ponteiro precisa continuar resolvendo com o OrkMind desligado');
    assert.equal(mesmo.via, 'files');
    assert.equal(mesmo.location, semantico.location);
    assert.ok(
      mesmo.conteudo.includes('"thread"') && mesmo.conteudo.includes(thread.id),
      'sem OrkMind o conteudo vem do handoff commitado, por leitura dirigida'
    );
    assert.equal(porArquivo.falhas.length, 0, 'nenhum ponteiro pode falhar por causa do regime');
    // O fluxo nao muda: mesmos ponteiros de CHECK resolvidos nos dois regimes.
    assert.deepEqual(
      porArquivo.resolvidos.map((p) => p.id).sort(),
      comOrkmind.resolvidos.filter(p => p.id.startsWith('ptr-')).map((p) => p.id).sort()
    );
  } finally {
    projeto.limpar();
  }
});

test('recall por id resolve um ponteiro so, e id inexistente reprova', () => {
  const projeto = projetoTemporario('recall-por-id');
  try {
    const carregado = projeto.carregado;
    const thread = threadComMaterial(projeto, carregado);
    const memoria = abrirMemoria(carregado);
    const { handoff } = exportarHandoff(carregado, thread.id, { proximaFase: 'CHECK' });
    const alvo = handoff.pointers[0];

    const r = recallDaThread(carregado, memoria, thread.id, { id: alvo.id });
    assert.equal(r.resolvidos.length, 1);
    assert.equal(r.resolvidos[0].id, alvo.id);
    assert.equal(r.adiados.length, 0, 'pedir por id resolve aquele ponteiro, momento ou nao');

    assert.throws(
      () => recallDaThread(carregado, memoria, thread.id, { id: 'ptr-999' }),
      /nao existe no handoff/
    );
  } finally {
    projeto.limpar();
  }
});

test('recall sem handoff exportado diz o comando que falta rodar', () => {
  const projeto = projetoTemporario('recall-sem-handoff');
  try {
    const carregado = projeto.carregado;
    const { thread } = novaThread(carregado, { nome: 'sem handoff', modo: 'classic' });
    const memoria = abrirMemoria(carregado);
    assert.throws(
      () => recallDaThread(carregado, memoria, thread.id, { momento: 'CHECK' }),
      /ork handoff export/
    );
  } finally {
    projeto.limpar();
  }
});

test('o casamento de momento e exato e ignora caixa', () => {
  const ponteiro = {
    id: 'ptr-1',
    tier: 'IMPORTANTE' as const,
    titulo: 'x',
    source: 'a.md',
    location: 'a.md#tudo',
    sha256: 'abc',
    retrieve_via: 'ork handoff recall t "a.md#tudo"',
    retrieve_when: 'CHECK',
  };
  assert.equal(momentoCasa(ponteiro, 'CHECK'), true);
  assert.equal(momentoCasa(ponteiro, 'check'), true);
  assert.equal(momentoCasa(ponteiro, 'GO'), false);
});


test('descoberta por fase exige tenant e thread exatos mesmo para mandatory', () => {
  const projeto = projetoTemporario('recall-tags-fabrica');
  try {
    const carregado = ligarOrkmind(projeto), driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });
    const thread = threadComMaterial(projeto, carregado);
    exportarHandoff(carregado, thread.id, { proximaFase: 'GOAL', memoria });
    const certa = driver.tudo().find(e => e.collection === 'handoff')!;
    for (const [id, tags] of [
      ['outro-tenant', { ...certa.tags, project: ['outro'] }],
      ['outra-thread', { ...certa.tags, situation: ['thread:outra'] }],
      ['fase-prefixo', { ...certa.tags, skill: ['GOAL-extra'] }],
    ] as Array<[string, Record<string, string[]>]>) driver.semear({ ...certa, id, tags, mandatory: true });
    const r = recallDaThread(carregado, memoria, thread.id, { momento: 'goal' });
    const descobertos = r.resolvidos.filter(e => e.id.startsWith('memoria-'));
    assert.deepEqual(descobertos.map(e => e.orkmind), [`orkmind://handoff/${certa.id}`]);
    assert.equal(r.falhas.length, 0);
    driver.exportar = () => { throw new Error('falha simulada'); };
    assert.ok(recallDaThread(carregado, memoria, thread.id, { momento: 'GOAL' }).falhas.some(f => f.id === 'memoria-busca'));
    // RM-038: a janela cheia do export chega com o proprio codigo; o resto segue como falha de transporte.
    const detalhe = () => recallDaThread(carregado, memoria, thread.id, { momento: 'GOAL' }).falhas.find(f => f.id === 'memoria-busca')?.detalhe;
    assert.equal(detalhe(), 'memory.transport.export: busca semantica falhou; resultado nao comprova colecao vazia');
    driver.exportar = () => { throw new Error('memory.query.window-saturated'); };
    assert.equal(detalhe(), 'memory.query.window-saturated: busca semantica falhou; resultado nao comprova colecao vazia');
  } finally { projeto.limpar(); }
});


test('recall restrito conserva erros e ausência semântica mesmo com arquivo disponível', () => {
  const projeto = projetoTemporario('recall-restrito-falhas');
  try {
    const thread = threadComMaterial(projeto, projeto.carregado);
    const { handoff } = exportarHandoff(projeto.carregado, thread.id, { proximaFase: 'CHECK' });
    const arquivo = handoff.pointers.find(p => p.location.startsWith('spec.md'))!;
    const p = { ...arquivo, orkmind: 'orkmind://handoff/ausente' };
    const carregado = ligarOrkmind(projeto), driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver, leituraRestrita: { thread: thread.id } });
    driver.exportar = () => { throw Error('export amplo proibido'); };
    assert.equal(resolverPonteiro(carregado, memoria, thread.id, p).detalhe, 'memory.query.not-found');
    assert.equal(resolverPonteiro(carregado, memoria, thread.id, { ...p, orkmind: 'inválido' }).detalhe, 'memory.query.invalid');
    for (const [erro, codigo] of [
      ['memory.query.window-saturated', 'memory.query.window-saturated'],
      ['memory.query.unsupported', 'memory.query.unsupported'],
      ['memory.transport.timeout: segredo', 'memory.transport.timeout'],
      ['dsn=segredo', 'memory.query.failed'],
    ]) {
      driver.consultar = () => { throw Error(erro); };
      const r = resolverPonteiro(carregado, memoria, thread.id, p);
      assert.equal(r.resolvido, false);
      assert.equal(r.via, null);
      assert.equal(r.conteudo, '');
      assert.equal(r.detalhe, codigo);
      const descoberta = recallDaThread(carregado, memoria, thread.id, { momento: 'CHECK' });
      assert.equal(descoberta.falhas.find(f => f.id === 'memoria-busca')?.detalhe,
        `${codigo}: busca semantica falhou; resultado nao comprova colecao vazia`);
      assert.ok(!JSON.stringify(descoberta).includes('segredo'));
    }
    assert.equal(resolverPonteiro(carregado, memoria, thread.id, arquivo).via, 'files');
    const files = abrirMemoria(projeto.carregado, { leituraRestrita: { thread: thread.id } });
    assert.equal(resolverPonteiro(projeto.carregado, files, thread.id, p).via, 'files');
  } finally { projeto.limpar(); }
});

test('recall restrito recusa outro contexto antes de ler thread, handoff ou driver', () => {
  const projeto = projetoTemporario('recall-restrito-contexto');
  try {
    const carregado = ligarOrkmind(projeto), driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver, leituraRestrita: { thread: 'ork-origem' } });
    let consultas = 0;
    driver.consultar = () => { consultas++; return []; };
    assert.throws(() => recallDaThread(carregado, memoria, 'ork-inexistente'), /memory.query.scope-conflict/);
    assert.equal(consultas, 0);
    // Outro manifesto também conflita antes de qualquer leitura de thread.
    const outro = projetoTemporario('recall-outro-tenant');
    try {
      outro.carregado.manifesto.memory.tenant = 'outro-tenant';
      assert.throws(() => recallDaThread(outro.carregado, memoria, 'ork-origem'), /memory.query.scope-conflict/);
    } finally { outro.limpar(); }
  } finally { projeto.limpar(); }
});

test('recall restrito encontra somente a fase exata dentro da janela da thread', () => {
  const projeto = projetoTemporario('recall-restrito-descoberta');
  try {
    const carregado = ligarOrkmind(projeto), driver = new DriverEmMemoria();
    const manutencao = abrirMemoria(carregado, { driver });
    const thread = threadComMaterial(projeto, carregado);
    exportarHandoff(carregado, thread.id, { proximaFase: 'GOAL', memoria: manutencao });
    const certa = driver.tudo().find(e => e.collection === 'handoff')!;
    driver.semear({ ...certa, id: 'outra-fase', tags: { ...certa.tags, skill: ['GOAL-extra'] }, mandatory: true });
    driver.semear({ ...certa, id: 'outra-thread', tags: { ...certa.tags, situation: ['thread:outra'] }, mandatory: true });
    driver.exportar = () => { throw Error('export amplo proibido'); };
    const memoria = abrirMemoria(carregado, { driver, leituraRestrita: { thread: thread.id } });
    const r = recallDaThread(carregado, memoria, thread.id, { momento: 'GOAL' });
    assert.deepEqual(r.resolvidos.filter(p => p.id.startsWith('memoria-')).map(p => p.orkmind), [`orkmind://handoff/${certa.id}`]);
    assert.equal(r.falhas.length, 0);
  } finally { projeto.limpar(); }
});

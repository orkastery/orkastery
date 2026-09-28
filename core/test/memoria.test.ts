/**
 * Testes da camada de memoria (bloco B6): regime, governanca, gravacao e injecao.
 *
 * O que precisa ficar provado aqui:
 *   1. o regime efetivo degrada com motivo TIPADO e nunca cai em base alheia;
 *   2. o `ork` recusa gravar o que ele nao tem direito de pedir (governanca);
 *   3. um prompt de GO carrega 100 por cento das decisoes fechadas da thread;
 *   4. uma thread NOVA do mesmo produto recebe as licoes das anteriores no GOAL;
 *   5. desligar o OrkMind nao tira nenhuma dessas garantias do lugar em que ela ainda cabe.
 *
 * Os testes rodam com o driver em memoria, que implementa o mesmo contrato do driver de
 * CLI. E o que permite provar os criterios de forma deterministica em qualquer maquina,
 * com ou sem OrkMind instalado.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  abrirMemoria,
  gravarDecisoes,
  postmortemDaLicao,
  threadDaEntrada,
  injecaoDaFase,
  licoesDoProduto,
  publicar,
  sincronizarMemoria,
  tagsDoProjeto,
  tagsDaThread,
  agenteDaThread,
} from '../src/memoria';
import { carregarManifesto, exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { casaTags, DriverEmMemoria, entradaDoJson, resolverRegime, violacoesDeGovernanca } from '../src/orkmind';
import { montarPromptComMemoria, rodarFase } from '../src/phase';
import { gravarThread, lerThread, novaThread } from '../src/thread';
import { registrarMaster } from '../src/master';
import { lerLedger, registrar } from '../src/ledger';
import { dirThread } from '../src/thread';
import { ConsultaDelimitada, EntradaDeMemoria, Thread } from '../src/types';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

/** Liga o regime `orkmind` no manifesto do projeto de teste, com base propria declarada. */
function ligarOrkmind(projeto: ProjetoDeTeste, variavel = 'ORKASTERY_TESTE_DSN'): ManifestoCarregado {
  const caminho = path.join(projeto.dir, 'orkastery.yaml');
  const bruto = fs.readFileSync(caminho, 'utf8');
  fs.writeFileSync(
    caminho,
    bruto
      .replace(/^  mode: files$/m, '  mode: orkmind')
      .replace(/^  database_url_env: ""$/m, `  database_url_env: "${variavel}"`),
    'utf8'
  );
  return exigirManifesto(projeto.dir);
}

/** Fecha uma decisao na thread, como o B2 faz. */
function fecharDecisao(dir: string, threadId: string, id: string, texto: string): Thread {
  const thread = lerThread(dir, threadId);
  thread.decisoes.push({
    id,
    texto,
    locked: true,
    decididaEm: new Date().toISOString(),
    decididaPor: 'julio',
  });
  gravarThread(dir, thread);
  return thread;
}

test('o regime efetivo degrada com motivo tipado e nunca cai em base alheia', () => {
  const projeto = projetoTemporario('memoria-regime');
  try {
    // 1. Manifesto padrao: regime files, sem nenhuma tentativa de conexao.
    const padrao = resolverRegime(projeto.carregado.manifesto, null);
    assert.equal(padrao.estado.efetivo, 'files');
    assert.equal(padrao.estado.motivo, 'modo.files');
    assert.equal(padrao.driver, null);

    // 2. Pediu orkmind sem declarar a base: NAO liga, e diz exatamente o que falta.
    const carregado = ligarOrkmind(projeto, '');
    assert.ok(
      carregado.avisos.some((a) => a.includes('database_url_env')),
      'manifesto que pede orkmind sem base declarada precisa avisar'
    );
    const semBase = resolverRegime(carregado.manifesto, null);
    assert.equal(semBase.estado.efetivo, 'files');
    assert.equal(semBase.estado.motivo, 'dsn.nao-declarado');
    assert.ok(semBase.estado.correcao.includes('database_url_env'));

    // 3. Base declarada por NOME, mas a variavel nao esta no ambiente: continua sem ligar.
    // E esta e a regra do incidente memory-orkmind: nao existe segunda DSN candidata.
    const comNome = ligarOrkmind(projeto, 'ORKASTERY_TESTE_DSN_INEXISTENTE');
    delete process.env.ORKASTERY_TESTE_DSN_INEXISTENTE;
    const semEnv = resolverRegime(comNome.manifesto, null);
    assert.equal(semEnv.estado.efetivo, 'files');
    assert.equal(semEnv.estado.motivo, 'dsn.env-ausente');
    assert.ok(semEnv.estado.detalhe.includes('ORKASTERY_TESTE_DSN_INEXISTENTE'));
    assert.equal(semEnv.estado.dsnPresente, false);

    // 4. Com driver disponivel, liga; com o mesmo driver desligado, degrada.
    const driver = new DriverEmMemoria();
    const ligado = resolverRegime(comNome.manifesto, driver);
    assert.equal(ligado.estado.efetivo, 'orkmind');
    assert.equal(ligado.estado.motivo, null);
    driver.ligado = false;
    const caiu = resolverRegime(comNome.manifesto, driver);
    assert.equal(caiu.estado.efetivo, 'files');
    assert.equal(caiu.estado.motivo, 'orkmind.indisponivel');
  } finally {
    projeto.limpar();
  }
});

test('DSN colada no lugar do nome da variavel reprova o manifesto', () => {
  const projeto = projetoTemporario('memoria-dsn');
  try {
    const caminho = path.join(projeto.dir, 'orkastery.yaml');
    const bruto = fs.readFileSync(caminho, 'utf8');
    fs.writeFileSync(
      caminho,
      bruto.replace(
        /^  database_url_env: ""$/m,
        '  database_url_env: "postgresql://orkmind:senha-de-teste@localhost:5432/orkmind"'
      ),
      'utf8'
    );
    const carregado = carregarManifesto(projeto.dir);
    assert.ok(carregado);
    assert.ok(
      (carregado as ManifestoCarregado).erros.some((e) => e.includes('NOME da variavel')),
      'DSN no lugar do nome da variavel e o defeito do incidente memory-orkmind: reprova'
    );
    assert.throws(() => exigirManifesto(projeto.dir), /manifesto invalido/);
  } finally {
    projeto.limpar();
  }
});

test('a governanca recusa o que o ork nao tem direito de gravar', () => {
  // Regra critica em colecao de governanca so nasce de humano autenticado.
  assert.ok(
    violacoesDeGovernanca({
      collection: 'rule',
      content: 'nunca faca push direto na base',
      tags: {},
      priority: 'critical',
      metadata: {},
    }).some((p) => p.includes('humano autenticado'))
  );
  // Colecao fora do escopo do B6 nao passa (o ork nao grava `instruction` nem `contacts`).
  assert.ok(
    violacoesDeGovernanca({
      collection: 'instruction' as never,
      content: 'x',
      tags: {},
      priority: 'high',
      metadata: {},
    }).some((p) => p.includes('fora do escopo'))
  );
  // Dimensao de tag inventada nao passa: busca por tag so e deterministica se a dimensao existe.
  assert.ok(
    violacoesDeGovernanca({
      collection: 'decision',
      content: 'x',
      tags: { assunto: ['b6'] },
      priority: 'high',
      metadata: {},
    }).some((p) => p.includes('dimensao de tag desconhecida'))
  );
  assert.deepEqual(
    violacoesDeGovernanca({
      collection: 'decision',
      content: 'D1 fechada',
      tags: { project: ['orkastery'] },
      priority: 'high',
      metadata: {},
    }),
    []
  );
});

test('o driver do ork nunca grava mandatory e sempre grava como agente', () => {
  const projeto = projetoTemporario('memoria-agente');
  try {
    const carregado = ligarOrkmind(projeto);
    const driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });
    const { thread } = novaThread(carregado, { nome: 'governanca', modo: 'classic' });
    fecharDecisao(projeto.dir, thread.id, 'D1', 'o ork grava como agente, nunca como humano');

    gravarDecisoes(memoria, carregado.manifesto, lerThread(projeto.dir, thread.id));
    const gravadas = driver.tudo();
    assert.equal(gravadas.length, 1);
    assert.equal(gravadas[0].source, 'agent');
    assert.equal(gravadas[0].mandatory, false);
    assert.notEqual(gravadas[0].priority, 'critical');
  } finally {
    projeto.limpar();
  }
});

test('a busca por tag e exata e a entrada mandatory sempre volta', () => {
  const base: EntradaDeMemoria = {
    id: 'e1',
    collection: 'rule',
    content: 'regra',
    tags: { project: ['orkastery'], skill: ['orkastery-rule'], situation: ['policy:provider'] },
    priority: 'high',
    mandatory: false,
    scope: 'project',
    source: 'agent',
    metadata: {},
    criadaEm: '2026-01-01T00:00:00.000Z',
  };
  // AND entre dimensoes: faltou casar `skill`, nao volta.
  assert.equal(casaTags(base, { project: ['orkastery'], skill: ['orkastery-decision'] }), false);
  assert.equal(casaTags(base, { project: ['orkastery'], skill: ['orkastery-rule'] }), true);
  // OR dentro da dimensao.
  assert.equal(casaTags(base, { project: ['outro', 'orkastery'] }), true);
  // Mandatory: uma dimensao que toca o contexto ja basta.
  const mandatoria = { ...base, mandatory: true };
  assert.equal(casaTags(mandatoria, { project: ['orkastery'], skill: ['orkastery-decision'] }), true);
  assert.equal(casaTags(mandatoria, { project: ['produto-alheio'] }), false);
});

test('o prompt de GO carrega 100 por cento das decisoes fechadas da thread', () => {
  const projeto = projetoTemporario('memoria-decisoes');
  try {
    const carregado = ligarOrkmind(projeto);
    const driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });
    const { thread } = novaThread(carregado, { nome: 'decisoes', modo: 'classic' });

    const fechadas = [
      ['D1', 'o handoff usa ponteiro, nao copia integral'],
      ['D2', 'a base do tenant vem de variavel de ambiente declarada'],
      ['D3', 'sem OrkMind o ciclo continua em regime files'],
    ] as const;
    for (const [id, texto] of fechadas) fecharDecisao(projeto.dir, thread.id, id, texto);
    // Uma decisao AINDA em aberto nao entra: o prompt carrega o que foi FECHADO.
    const comAberta = lerThread(projeto.dir, thread.id);
    comAberta.decisoes.push({
      id: 'D4',
      texto: 'ainda em discussao com o builder',
      locked: false,
      decididaEm: new Date().toISOString(),
      decididaPor: 'julio',
    });
    gravarThread(projeto.dir, comAberta);

    const atual = lerThread(projeto.dir, thread.id);
    const { prompt, injecao } = montarPromptComMemoria(carregado, atual, 'GO', 'implementar', memoria);

    assert.equal(injecao.decisoes, 3, 'as tres decisoes fechadas precisam entrar');
    for (const [id, texto] of fechadas) {
      assert.ok(prompt.includes(id), `o prompt de GO precisa citar ${id}`);
      assert.ok(prompt.includes(texto), `o prompt de GO precisa carregar o texto de ${id}`);
    }
    assert.ok(!prompt.includes('ainda em discussao'), 'decisao nao fechada nao entra no prompt');
    assert.ok(prompt.includes('## Memoria injetada'));
    assert.ok(
      prompt.includes(`origem: .orkastery/threads/${thread.id}/thread.json#json:decisoes.D1`),
      'todo item injetado declara de onde veio'
    );

    // A MESMA garantia sem OrkMind: a fonte muda, a garantia nao.
    driver.ligado = false;
    const semOrkmind = abrirMemoria(carregado, { driver });
    const emFiles = montarPromptComMemoria(carregado, atual, 'GO', 'implementar', semOrkmind);
    assert.equal(emFiles.injecao.regime, 'files');
    assert.equal(emFiles.injecao.decisoes, 3);
    for (const [id] of fechadas) assert.ok(emFiles.prompt.includes(id));
  } finally {
    projeto.limpar();
  }
});

test('a decisao que so existe na memoria semantica tambem entra no prompt', () => {
  const projeto = projetoTemporario('memoria-uniao');
  try {
    const carregado = ligarOrkmind(projeto);
    const driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });
    const { thread } = novaThread(carregado, { nome: 'uniao', modo: 'classic' });
    fecharDecisao(projeto.dir, thread.id, 'D1', 'decisao que esta no thread.json');

    // Uma decisao gravada por OUTRA sessao da mesma thread, que este `thread.json` ainda
    // nao viu. A uniao e o que impede a decisao de sumir do prompt.
    driver.semear({
      id: 'mem-alheia',
      collection: 'decision',
      content: 'Decisao D9 fechada na thread ' + thread.id + '.\nD9 veio da memoria semantica',
      tags: {
        ...tagsDoProjeto(carregado.manifesto),
        skill: ['orkastery-decision'],
        situation: [`thread:${thread.id}`],
      },
      priority: 'high',
      mandatory: false,
      scope: 'project',
      source: 'agent',
      metadata: { thread: thread.id, decisao: 'D9' },
      criadaEm: '2026-01-01T00:00:00.000Z',
    });

    const injecao = injecaoDaFase(carregado, memoria, lerThread(projeto.dir, thread.id), 'GO');
    assert.equal(injecao.decisoes, 2);
    assert.ok(injecao.texto.includes('D9 veio da memoria semantica'));
    assert.ok(injecao.texto.includes('origem: orkmind://decision/mem-alheia'));
    // E sem duplicar a que ja estava no arquivo.
    assert.equal(
      injecao.itens.filter((i) => i.titulo.includes('D1')).length,
      1,
      'a mesma decisao nao pode entrar duas vezes por ter duas fontes'
    );
  } finally {
    projeto.limpar();
  }
});

test('uma thread nova do mesmo produto recebe as licoes das anteriores no GOAL', () => {
  const projeto = projetoTemporario('memoria-licoes');
  try {
    const carregado = ligarOrkmind(projeto);
    const driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });

    // Thread 1: percorre, entrega e fecha com score humano. O MASTER publica a licao.
    const primeira = novaThread(carregado, { nome: 'primeira', modo: 'classic' }).thread;
    rodarFase(carregado, primeira.id, {
      fase: 'GOAL',
      prompt: 'mapear o objetivo',
      dryRun: true,
      memoria,
    });
    registrar(dirThread(projeto.dir, primeira.id), primeira.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
    const master = registrarMaster(projeto.dir, primeira.id, {
      score: 2,
      justificativa: 'a base avancou no meio do GO e o merge levou retrabalho',
      classes: ['base-avancou'],
      resumo: 'sincronizar a worktree antes do GO evita este retrabalho',
      por: 'julio',
    });
    assert.equal(master.masterLog.score, 2);
    const publicada = publicar(carregado, primeira.id, undefined, memoria);
    assert.ok(publicada.learning?.ok, 'o MASTER precisa publicar a licao na colecao learning');

    // Thread 2, do MESMO produto: recebe a licao da primeira no GOAL.
    const segunda = novaThread(carregado, { nome: 'segunda', modo: 'classic' }).thread;
    const licoes = licoesDoProduto(memoria, carregado.manifesto, segunda.id);
    assert.equal(licoes.length, 1);

    const noGoal = montarPromptComMemoria(carregado, segunda, 'GOAL', 'mapear', memoria);
    assert.equal(noGoal.injecao.licoes, 1);
    assert.ok(noGoal.prompt.includes('base-avancou'), 'a classe de falha precisa chegar no GOAL');
    assert.ok(noGoal.prompt.includes('sincronizar a worktree antes do GO'));
    assert.ok(noGoal.prompt.includes(`Licao da thread ${primeira.id}`));

    // A propria thread nao recebe a propria licao, e as demais fases nao carregam licao.
    const daPrimeira = montarPromptComMemoria(carregado, lerThread(projeto.dir, primeira.id), 'GOAL', 'x', memoria);
    assert.equal(daPrimeira.injecao.licoes, 0, 'uma thread nao aprende consigo mesma');
    const noGo = montarPromptComMemoria(carregado, segunda, 'GO', 'implementar', memoria);
    assert.equal(noGo.injecao.licoes, 0, 'licao entra no GOAL, nao em toda fase');
  } finally {
    projeto.limpar();
  }
});

test('a regra mandatoria do humano volta em toda fase, e o ork nunca a cria', () => {
  const projeto = projetoTemporario('memoria-mandatory');
  try {
    const carregado = ligarOrkmind(projeto);
    const driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver });
    const { thread } = novaThread(carregado, { nome: 'mandatoria', modo: 'classic' });

    // Entrada que SO um humano autenticado cria no OrkMind.
    driver.semear({
      id: 'humana-1',
      collection: 'rule',
      content: 'Nenhum despacho por provider pago: a assinatura local e a unica fonte.',
      tags: { project: tagsDoProjeto(carregado.manifesto).project, skill: ['orkastery-rule'] },
      priority: 'critical',
      mandatory: true,
      scope: 'project',
      source: 'human',
      metadata: {},
      criadaEm: '2026-01-01T00:00:00.000Z',
    });

    for (const fase of ['GOAL', 'GO', 'SHIP'] as const) {
      const injecao = injecaoDaFase(carregado, memoria, thread, fase);
      assert.equal(injecao.regras, 1, `a regra mandatoria precisa voltar no ${fase}`);
      assert.ok(injecao.texto.includes('[MANDATORY]'));
      assert.ok(injecao.texto.includes('provider pago'));
    }

    // O `ork` publica as policies do manifesto, e nenhuma delas sai mandatoria.
    sincronizarMemoria(carregado, memoria, null);
    const publicadas = driver.tudo().filter((e) => e.collection === 'rule' && e.source === 'agent');
    assert.ok(publicadas.length >= 3, 'as policies do manifesto viram entradas rule');
    assert.ok(publicadas.every((e) => !e.mandatory && e.priority !== 'critical'));
  } finally {
    projeto.limpar();
  }
});

test('o ledger registra a injecao com colecao e proveniencia de cada item', () => {
  const projeto = projetoTemporario('memoria-ledger');
  try {
    const carregado = ligarOrkmind(projeto);
    const memoria = abrirMemoria(carregado, { driver: new DriverEmMemoria() });
    const { thread } = novaThread(carregado, { nome: 'ledger', modo: 'classic' });
    fecharDecisao(projeto.dir, thread.id, 'D1', 'evidencia da injecao vai para o ledger');

    rodarFase(carregado, thread.id, {
      fase: 'GO',
      prompt: 'implementar',
      dryRun: true,
      memoria,
    });
    const eventos = lerLedger(dirThread(projeto.dir, thread.id));
    const injecao = eventos.find((e) => e.tipo === 'memory_injected');
    assert.ok(injecao, 'a injecao precisa virar evento no ledger');
    assert.equal(injecao?.decisoes, 1);
    assert.equal(injecao?.regime, 'orkmind');
    assert.ok(
      (injecao?.itens as string[]).some((i) => i.includes('thread.json#json:decisoes.D1')),
      'o ledger guarda a proveniencia de cada item injetado'
    );
  } finally {
    projeto.limpar();
  }
});

test('a identidade da entrada sobrevive a um transporte que descarta metadata', () => {
  const projeto = projetoTemporario('memoria-sem-metadata');
  try {
    const carregado = ligarOrkmind(projeto);

    /**
     * Reproduz a perda de metadata do transporte legado, depois da persistencia.
     * A ponte atual preserva metadata e o duplo agora gera fingerprint como ela.
     * O canario continua exigindo recuperacao por tags mesmo sem qualquer metadata.
     */
    class DriverSemMetadata extends DriverEmMemoria {
      override adicionar(entrada: Parameters<DriverEmMemoria['adicionar']>[0]) {
        const resultado = super.adicionar({ ...entrada, metadata: {} });
        const salva = this.tudo().find(e => e.id === resultado.id);
        if (salva) salva.metadata = {};
        return resultado;
      }
    }
    const driver = new DriverSemMetadata();
    const memoria = abrirMemoria(carregado, { driver });

    const primeira = novaThread(carregado, { nome: 'perdida', modo: 'classic' }).thread;
    fecharDecisao(projeto.dir, primeira.id, 'D7', 'a identidade viaja por tag, nao so por metadata');
    registrar(dirThread(projeto.dir, primeira.id), primeira.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
    registrarMaster(projeto.dir, primeira.id, {
      score: 5,
      justificativa: 'a licao precisa continuar sabendo de que thread veio',
      classes: ['sem-falha'],
      por: 'julio',
    });
    publicar(carregado, primeira.id, undefined, memoria);
    assert.ok(driver.tudo().every((e) => Object.keys(e.metadata).length === 0));

    // 1. A decisao publicada nao duplica no prompt: a deduplicacao acha o `D7` na tag.
    const atual = lerThread(projeto.dir, primeira.id);
    const injecao = injecaoDaFase(carregado, memoria, atual, 'GO');
    assert.equal(injecao.decisoes, 1, 'a mesma decisao nao pode entrar duas vezes');

    // 2. A licao continua sabendo de que thread veio, e a outra thread a recebe.
    const segunda = novaThread(carregado, { nome: 'herdeira', modo: 'classic' }).thread;
    const licoes = licoesDoProduto(memoria, carregado.manifesto, segunda.id);
    assert.equal(licoes.length, 1);
    assert.equal(threadDaEntrada(licoes[0]), primeira.id);
    assert.equal(postmortemDaLicao(licoes[0]), `.orkastery/threads/${primeira.id}/POSTMORTEM.json`);

    // 3. E a propria thread continua sem receber a propria licao.
    assert.equal(licoesDoProduto(memoria, carregado.manifesto, primeira.id).length, 0);
  } finally {
    projeto.limpar();
  }
});


test('tags de fabrica preservam aliases e declaram autoria historica desconhecida', () => {
  const projeto = projetoTemporario('memoria-tags-fabrica');
  try {
    const { thread } = novaThread(projeto.carregado, { nome: 'tags', modo: 'auto' });
    const tags = tagsDaThread(projeto.carregado.manifesto, 'handoff', thread, 'GOAL');
    assert.deepEqual(tags.skill, ['GOAL', 'orkastery-handoff']);
    assert.ok(tags.situation.includes('handoff'));
    assert.ok(tags.situation.includes(`thread:${thread.id}`));
    assert.ok(tags.situation.includes('fase:GOAL'));
    assert.ok(tags.agent.includes('desconhecido:desconhecido'));
    assert.equal(agenteDaThread(thread, 'sessao-ausente'), 'desconhecido:desconhecido');
  } finally { projeto.limpar(); }
});


function entradaRestrita(id: string, tenant = 'fabrica', thread = 'ork-a', skill = 'GOAL', mandatory = false) {
  return entradaDoJson({id,content:id,collection:'handoff',mandatory,
    tags:{project:[tenant],situation:['thread:'+thread],skill:[skill]},metadata:{prova:'preservada'}})!;
}

test('leitura restrita fixa tenant/thread e usa consultar sem export ou retrieve amplo', () => {
  const projeto = projetoTemporario('memoria-restrita');
  try {
    const carregado = ligarOrkmind(projeto); carregado.manifesto.memory.tenant = 'fabrica';
    const driver = new DriverEmMemoria([entradaRestrita('goal'),entradaRestrita('plan','fabrica','ork-a','PLAN'),
      entradaRestrita('mandatory','fabrica','ork-a','SHIP',true),entradaRestrita('outra','fabrica','ork-b'),
      entradaRestrita('alheia','outro')]);
    driver.exportar = () => { throw Error('export amplo'); };
    driver.recuperar = () => { throw Error('retrieve amplo'); };
    const chamadas: ConsultaDelimitada[] = [], consultar = driver.consultar.bind(driver);
    driver.consultar = q => { chamadas.push(q); return consultar(q); };
    const contexto = {thread:'ork-a',limite:10};
    const memoria = abrirMemoria(carregado,{driver,leituraRestrita:contexto});
    contexto.thread='ork-b';carregado.manifesto.memory.tenant='alterado-depois';
    assert.deepEqual(memoria.leituraRestrita,{tenant:'fabrica',thread:'ork-a',limite:10});
    assert.ok(Object.isFrozen(memoria.leituraRestrita));
    assert.throws(()=>Object.assign(memoria.leituraRestrita!,{thread:'ork-b'}),TypeError);
    assert.throws(()=>Object.assign(memoria,{leituraRestrita:undefined}),TypeError);
    assert.deepEqual(memoria.buscar({collection:'handoff',tags:{skill:['GOAL','PLAN']}}).map(e=>e.id),
      ['mandatory','goal','plan']);
    assert.deepEqual(memoria.buscar({collection:'handoff',tags:{skill:['GOAL']},limite:1}).map(e=>e.id),['mandatory']);
    assert.equal(memoria.porId('handoff','outra'),null);
    assert.deepEqual(memoria.porId('handoff','goal')?.metadata,{prova:'preservada'});
    assert.ok(chamadas.length===4 && chamadas.every(q=>q.escopo.tenant==='fabrica' && q.escopo.thread==='ork-a' && q.limite===10));
    assert.throws(()=>memoria.buscar({tags:{}}),/memory.query.invalid/);
    assert.throws(()=>memoria.buscar({collection:'handoff',tags:{project:['outro']}}),/memory.query.scope-conflict/);
    assert.throws(()=>memoria.buscar({collection:'handoff',tags:{},limite:0}),/memory.query.invalid/);
    assert.throws(()=>memoria.porId('handoff',''),/memory.query.invalid/);
    assert.throws(()=>memoria.porId('users','id'),/memory.query.invalid/);
  } finally { projeto.limpar(); }
});

test('consulta restrita recusa driver antigo, saturacao antes de id/corte e retorno fora do escopo', () => {
  const projeto=projetoTemporario('memoria-janela');
  try {
    const carregado=ligarOrkmind(projeto);carregado.manifesto.memory.tenant='fabrica';
    const antigo=new DriverEmMemoria();Object.defineProperty(antigo,'consultar',{value:undefined});
    antigo.exportar=()=>{throw Error('fallback amplo');};
    let memoria=abrirMemoria(carregado,{driver:antigo,leituraRestrita:{thread:'ork-a'}});
    assert.throws(()=>memoria.buscar({collection:'handoff',tags:{}}),/memory.query.unsupported/);
    assert.throws(()=>memoria.porId('handoff','ausente'),/memory.query.unsupported/);
    const cheio=new DriverEmMemoria([entradaRestrita('a'),entradaRestrita('b')]);
    memoria=abrirMemoria(carregado,{driver:cheio,leituraRestrita:{thread:'ork-a',limite:2}});
    assert.throws(()=>memoria.buscar({collection:'handoff',tags:{skill:['nunca']},limite:1}),/memory.query.window-saturated/);
    assert.throws(()=>memoria.porId('handoff','ausente'),/memory.query.window-saturated/);
    const invalido=new DriverEmMemoria();invalido.consultar=()=>[entradaRestrita('alheia','outro')];
    memoria=abrirMemoria(carregado,{driver:invalido,leituraRestrita:{thread:'ork-a'}});
    assert.throws(()=>memoria.porId('handoff','alheia'),/memory.query.scope-violation/);
  } finally { projeto.limpar(); }
});

test('escopo invalido falha antes da saude; manutencao sem contexto e files continuam explicitos', () => {
  const projeto=projetoTemporario('memoria-validacao');
  try {
    const carregado=ligarOrkmind(projeto);carregado.manifesto.memory.tenant='fabrica';
    const driver=new DriverEmMemoria();let chamadas=0;
    driver.disponivel=()=>{chamadas++;throw Error('nao abrir');};
    for(const contexto of [null,[],{thread:'../outra'},{thread:'ork-a',limite:0},
      {thread:'ork-a',limite:null},{thread:'ork-a',limite:1001},{thread:'ork-a',tenant:'outro'}]) {
      assert.throws(()=>abrirMemoria(carregado,{driver,leituraRestrita:contexto as never}),/memory.query.invalid/);
    }
    assert.equal(chamadas,0);
    const legado=new DriverEmMemoria([entradaRestrita('a'),entradaRestrita('b','outro','ork-b')]);
    const manutencao=abrirMemoria(carregado,{driver:legado});
    assert.equal(manutencao.leituraRestrita,undefined);
    assert.equal(manutencao.buscar({collection:'handoff',tags:{}}).length,2);
    carregado.manifesto.memory.mode='files';
    const files=abrirMemoria(carregado,{driver,leituraRestrita:{thread:'ork-a'}});
    assert.equal(files.ativo,false);assert.equal(files.regime,'files');assert.equal(chamadas,0);
    assert.deepEqual(files.buscar({collection:'handoff',tags:{}}),[]);
  } finally { projeto.limpar(); }
});

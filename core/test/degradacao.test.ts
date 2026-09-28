/**
 * Teste de DEGRADACAO do bloco B6: desligar o OrkMind nao quebra nenhum ciclo.
 *
 * Esta e a regua do bloco. O regime `orkmind` e um acrescimo por cima do `files`, e a
 * prova disso e um ciclo inteiro rodando com o manifesto pedindo `orkmind` e o OrkMind
 * fora do ar: thread, fase, claim, baseline, verify, handoff, recall, ship e MASTER
 * precisam terminar exatamente como terminam na main.
 *
 * O teste tambem compara os dois mundos: o mesmo ciclo, no mesmo material, com e sem
 * memoria semantica, produz o MESMO conjunto de ponteiros resolvidos e a MESMA garantia
 * de decisoes no prompt. O que muda e o que a memoria acrescenta, nunca o que ela tira.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { exportarHandoff } from '../src/handoff';
import { lerLedger, registrar } from '../src/ledger';
import { exigirManifesto, ManifestoCarregado } from '../src/manifest';
import { abrirMemoria, publicar, textoDoEstado, textoDoSync } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { montarPromptComMemoria, rodarFase } from '../src/phase';
import { recallDaThread } from '../src/recall';
import { registrarMaster } from '../src/master';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { gateDeTokens } from '../src/tokens';
import { gravarBaseline, verificar } from '../src/verify';
import { projetoTemporario, ProjetoDeTeste } from './apoio';

/**
 * Liga o regime `orkmind` no manifesto SEM que exista OrkMind algum.
 *
 * A variavel declarada nao esta no ambiente de proposito: e o caso mais comum de "pedi a
 * memoria e ela nao esta la", e o que o `ork` NAO pode fazer e escolher outra base.
 */
function pedirOrkmindSemOrkmind(projeto: ProjetoDeTeste): ManifestoCarregado {
  const caminho = path.join(projeto.dir, 'orkastery.yaml');
  const bruto = fs.readFileSync(caminho, 'utf8');
  fs.writeFileSync(
    caminho,
    bruto
      .replace(/^  mode: files$/m, '  mode: orkmind')
      .replace(/^  database_url_env: ""$/m, '  database_url_env: "ORKASTERY_DSN_QUE_NAO_EXISTE"')
      .replace(/^  cli: orkmind$/m, '  cli: orkmind-que-nao-existe'),
    'utf8'
  );
  delete process.env.ORKASTERY_DSN_QUE_NAO_EXISTE;
  return exigirManifesto(projeto.dir);
}

test('o ciclo inteiro roda com o manifesto pedindo orkmind e o OrkMind fora do ar', () => {
  const projeto = projetoTemporario('degradacao-ciclo');
  try {
    const carregado = pedirOrkmindSemOrkmind(projeto);
    const memoria = abrirMemoria(carregado);
    assert.equal(memoria.regime, 'files', 'sem base declarada no ambiente, o regime cai para files');
    assert.equal(memoria.estado.pedido, 'orkmind');
    assert.equal(memoria.estado.motivo, 'dsn.env-ausente');

    // 1. thread new
    const { thread } = novaThread(carregado, { nome: 'degradacao', modo: 'classic' });
    assert.equal(thread.status, 'aberta');
    // A publicacao nao quebra: ela relata que nada foi para a memoria semantica.
    const publicacao = publicar(carregado, thread.id);
    assert.equal(publicacao.regime, 'files');
    assert.equal(publicacao.falhas, publicacao.total, 'em regime files nada e gravado, e isso e dito');
    assert.ok(textoDoSync(publicacao).includes('regime files'));

    // 2. decisao fechada + phase run (o prompt continua carregando a decisao)
    const comDecisao = lerThread(projeto.dir, thread.id);
    comDecisao.decisoes.push({
      id: 'D1',
      texto: 'sem OrkMind o ciclo continua, e o handoff declara o regime',
      locked: true,
      decididaEm: new Date().toISOString(),
      decididaPor: 'julio',
    });
    gravarThread(projeto.dir, comDecisao);

    const corrida = rodarFase(carregado, thread.id, {
      fase: 'GOAL',
      prompt: 'mapear o objetivo da degradacao honesta',
      dryRun: true,
    });
    assert.equal(corrida.bloqueado, false, 'nenhum gate pode reprovar por causa da memoria');
    const prompt = fs.readFileSync(corrida.promptPath, 'utf8');
    assert.ok(prompt.includes('D1'), 'a decisao fechada continua entrando no prompt sem OrkMind');
    assert.ok(prompt.includes('regime files'));

    // 3. claim + baseline + verify
    fs.writeFileSync(path.join(projeto.dir, 'spec.md'), '# spec\n\nregra da entrega\n', 'utf8');
    adicionarClaim(projeto.dir, thread.id, {
      arquivo: 'spec.md',
      alegacao: 'a spec descreve a regra da entrega',
      verificar: ['grep -q "regra da entrega" spec.md'],
    });
    gravarBaseline(carregado, thread.id);
    const verificacao = verificar(carregado, thread.id, { soClaims: true });
    assert.equal(verificacao.ok, true, 'o verify precisa passar igual ao regime files');

    // 4. gate de tokens + handoff
    const gate = gateDeTokens(carregado, thread.id, { proximo: 'CHECK', ocupacao: 0.9 });
    assert.equal(gate.veredito, 'new-session');
    const { handoff } = exportarHandoff(carregado, thread.id, { proximaFase: 'CHECK' });
    assert.equal(handoff.memory, 'files', 'o handoff declara o regime EFETIVO, nao o pedido');
    assert.ok(handoff.inline.length > 0 && handoff.pointers.length > 0);
    assert.ok(
      handoff.pointers.every((p) => p.orkmind === undefined),
      'sem OrkMind nenhum ponteiro nasce com endereco semantico'
    );

    // 5. recall: os ponteiros continuam resolvendo por leitura dirigida
    const recall = recallDaThread(carregado, memoria, thread.id, { momento: 'CHECK' });
    assert.ok(recall.resolvidos.length > 0);
    assert.equal(recall.falhas.length, 0);
    assert.ok(recall.resolvidos.every((p) => p.via === 'files'));

    // 6. MASTER: a thread fecha com score, e a licao simplesmente nao e publicada
    registrar(dirThread(projeto.dir, thread.id), thread.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
    const master = registrarMaster(projeto.dir, thread.id, {
      score: 4,
      justificativa: 'o ciclo inteiro rodou sem memoria semantica, como prometido',
      classes: ['sem-falha'],
      por: 'julio',
    });
    assert.equal(master.masterLog.score, 4);
    assert.equal(lerThread(projeto.dir, thread.id).status, 'fechada');
    const aposMaster = publicar(carregado, thread.id);
    assert.equal(aposMaster.learning?.ok, false);
    assert.ok((aposMaster.learning?.detalhe ?? '').includes('regime files'));

    // 7. a degradacao ficou registrada no ledger, com motivo e correcao
    const eventos = lerLedger(dirThread(projeto.dir, thread.id));
    const degradacoes = eventos.filter((e) => e.tipo === 'memory_degraded');
    assert.ok(degradacoes.length > 0, 'pedir orkmind e nao ter precisa aparecer no ledger');
    assert.equal(degradacoes[0].motivo, 'dsn.env-ausente');
    assert.ok(String(degradacoes[0].correcao).includes('ORKASTERY_DSN_QUE_NAO_EXISTE'));
  } finally {
    projeto.limpar();
  }
});

test('ligar o OrkMind acrescenta e nao tira: mesmos ponteiros, mesmas decisoes', () => {
  const projeto = projetoTemporario('degradacao-paridade');
  try {
    const caminho = path.join(projeto.dir, 'orkastery.yaml');
    fs.writeFileSync(
      caminho,
      fs
        .readFileSync(caminho, 'utf8')
        .replace(/^  mode: files$/m, '  mode: orkmind')
        .replace(/^  database_url_env: ""$/m, '  database_url_env: "ORKASTERY_TESTE_DSN"'),
      'utf8'
    );
    const carregado = exigirManifesto(projeto.dir);
    const driver = new DriverEmMemoria();

    const { thread } = novaThread(carregado, { nome: 'paridade', modo: 'classic' });
    fs.writeFileSync(path.join(projeto.dir, 'spec.md'), '# spec\n\ncriterio\n', 'utf8');
    adicionarClaim(projeto.dir, thread.id, {
      arquivo: 'spec.md',
      alegacao: 'a spec existe',
      verificar: ['test -f spec.md'],
    });
    const comDecisao = lerThread(projeto.dir, thread.id);
    comDecisao.decisoes.push({
      id: 'D1',
      texto: 'paridade sem downgrade',
      locked: true,
      decididaEm: new Date().toISOString(),
      decididaPor: 'julio',
    });
    gravarThread(projeto.dir, comDecisao);
    const atual = lerThread(projeto.dir, thread.id);

    const ligada = abrirMemoria(carregado, { driver });
    driver.ligado = false;
    const desligada = abrirMemoria(carregado, { driver });
    driver.ligado = true;

    // As decisoes fechadas entram nos dois regimes, com a mesma contagem.
    const comMemoria = montarPromptComMemoria(carregado, atual, 'GO', 'implementar', ligada);
    const semMemoria = montarPromptComMemoria(carregado, atual, 'GO', 'implementar', desligada);
    assert.equal(comMemoria.injecao.decisoes, semMemoria.injecao.decisoes);
    assert.ok(comMemoria.prompt.includes('paridade sem downgrade'));
    assert.ok(semMemoria.prompt.includes('paridade sem downgrade'));

    // O handoff em regime orkmind mantem os ponteiros de arquivo do regime files.
    const comOrkmind = exportarHandoff(carregado, thread.id, {
      proximaFase: 'CHECK',
      memoria: ligada,
    }).handoff;
    const semOrkmind = exportarHandoff(carregado, thread.id, {
      proximaFase: 'CHECK',
      memoria: desligada,
    }).handoff;
    const locaisSem = semOrkmind.pointers.map((p) => p.location);
    for (const local of locaisSem) {
      assert.ok(
        comOrkmind.pointers.some((p) => p.location === local),
        `o ponteiro ${local} do regime files nao pode sumir no regime orkmind`
      );
    }
    assert.equal(comOrkmind.inline.length, semOrkmind.inline.length);
    assert.equal(comOrkmind.summaries.length, semOrkmind.summaries.length);
  } finally {
    projeto.limpar();
  }
});

test('ork memory status explica a degradacao com correcao acionavel', () => {
  const projeto = projetoTemporario('degradacao-status');
  try {
    const carregado = pedirOrkmindSemOrkmind(projeto);
    const texto = textoDoEstado(abrirMemoria(carregado).estado);
    assert.ok(texto.includes('pedido no manifesto   orkmind'));
    assert.ok(texto.includes('regime efetivo        files'));
    assert.ok(texto.includes('degradacao: dsn.env-ausente'));
    assert.ok(texto.includes('correcao: exporte ORKASTERY_DSN_QUE_NAO_EXISTE'));
    assert.ok(texto.includes('O ciclo NAO para por isso'));
    // O valor da DSN nunca e impresso, mesmo quando existe.
    assert.ok(texto.includes('DSN no ambiente       nao'));
  } finally {
    projeto.limpar();
  }
});

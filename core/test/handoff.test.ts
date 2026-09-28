/**
 * Testes do handoff triado em regime `files`.
 *
 * O que precisa ficar provado: a triagem em 3 niveis, a proveniencia obrigatoria em todo
 * item e a recuperacao tardia de um ponteiro `path#ancora` de volta ao conteudo real.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim, carimbarEstado } from '../src/claims';
import { ancoraDeTitulo, exportarHandoff, recall } from '../src/handoff';
import { abrirMemoria, licoesDoProduto } from '../src/memoria';
import { exigirManifesto } from '../src/manifest';
import { DriverEmMemoria } from '../src/orkmind';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

/** Monta uma thread com prompt gravado, claim pendente e claim verificada. */
function threadComMaterial(projeto: ReturnType<typeof projetoTemporario>) {
  const { thread } = novaThread(projeto.carregado, { nome: 'handoff', modo: 'classic' });
  fs.writeFileSync(path.join(projeto.dir, 'spec.md'), '# spec\n\nregra da entrega\n', 'utf8');

  // O `--dry-run` grava o prompt sem despachar; a sessao e registrada como o despacho faria.
  const corrida = rodarFase(projeto.carregado, thread.id, {
    fase: 'GOAL',
    prompt: 'Mapear o objetivo do handoff triado',
    dryRun: true,
  });
  const comSessao = lerThread(projeto.dir, thread.id);
  comSessao.sessoes.push({
    slug: corrida.slug,
    fase: 'GOAL',
    bloco: 'GOAL-PLAN',
    sessionId: '11111111-1111-4111-8111-111111111111',
    runtime: 'claude-bg',
    despachadaEm: new Date().toISOString(),
    promptPath: path.relative(projeto.dir, corrida.promptPath),
    promptSha256: corrida.promptSha256,
    verificada: true,
  });
  comSessao.decisoes.push({
    id: 'D1',
    texto: 'o handoff em regime files usa ponteiro, nao copia integral',
    locked: true,
    decididaEm: new Date().toISOString(),
    decididaPor: 'julio',
  });
  gravarThread(projeto.dir, comSessao);

  const pendente = adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'spec.md',
    alegacao: 'a spec descreve a regra da entrega',
    verificar: ['grep -q "regra da entrega" spec.md'],
  });
  const verificada = adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'spec.md',
    alegacao: 'o arquivo de spec existe',
    verificar: ['test -f spec.md'],
  });
  // C2 ja passou pelo `ork verify`: claim verificada vira ponteiro, nao inline.
  carimbarEstado(projeto.dir, verificada, 'verificado');
  return { thread, corrida, pendente, verificada };
}

test('handoff export tria em CRITICO, IMPORTANTE e RESUMIVEL com proveniencia em tudo', () => {
  const projeto = projetoTemporario('handoff-export');
  const { thread, corrida } = threadComMaterial(projeto);

  const { handoff, caminho, caminhoHistorico } = exportarHandoff(projeto.carregado, thread.id, {
    proximaFase: 'GO',
  });

  assert.equal(handoff.versao, 1);
  assert.equal(handoff.memory, 'files', 'o regime declarado e o do manifesto');
  assert.equal(handoff.para.fase, 'GO');
  // I-43: em `#Classic` o GO vive no bloco GO-CHECK, cuja parte 3 do slug e `f34`.
  assert.equal(handoff.para.slug, 'ork-handoff-f34');
  assert.ok(fs.existsSync(caminho));
  assert.ok(fs.existsSync(caminhoHistorico));

  // CRITICO: estado do mundo, regra de pausa, decisao locked e claims pendentes, inline.
  const titulos = handoff.inline.map((i) => i.titulo);
  assert.ok(titulos.includes('Estado do mundo da thread'));
  assert.ok(titulos.some((t) => t.startsWith('Regra de pausa do bloco')));
  assert.ok(titulos.includes('Decisao locked D1'));
  assert.ok(titulos.some((t) => t.startsWith('Claim C1 pendente')));
  const estado = handoff.inline.find((i) => i.titulo === 'Estado do mundo da thread');
  assert.ok(estado);
  assert.ok(estado.conteudo.includes(thread.base.commit), 'a base carimbada vai inline');
  assert.equal(estado.tier, 'CRITICO');

  // Proveniencia obrigatoria: source, location `path#ancora` e sha256 real em TODO item.
  for (const item of handoff.inline) {
    assert.match(item.proveniencia.location, /#/);
    assert.match(item.proveniencia.sha256, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.resolve(projeto.dir, item.proveniencia.source)));
  }
  for (const p of handoff.pointers) {
    assert.match(p.location, /#/);
    assert.match(p.sha256, /^[0-9a-f]{64}$/);
    assert.match(p.retrieve_via, /^ork handoff recall /);
    assert.ok(p.retrieve_when.length > 0);
  }
  for (const s of handoff.summaries) {
    assert.match(s.provenance.location, /#/);
    assert.match(s.provenance.sha256, /^[0-9a-f]{64}$/);
  }

  // IMPORTANTE: o prompt da sessao vira ponteiro, nao texto colado.
  const ponteiroDoPrompt = handoff.pointers.find((p) => p.titulo.startsWith('Prompt da sessao'));
  assert.ok(ponteiroDoPrompt);
  assert.ok(ponteiroDoPrompt.location.endsWith('#pedido-do-builder'));
  assert.equal(ponteiroDoPrompt.retrieve_when, 'GOAL');
  assert.equal(
    handoff.inline.some((i) => i.conteudo.includes('Mapear o objetivo do handoff triado')),
    false,
    'o pedido original nao e colado inline: ele vira endereco'
  );
  assert.ok(
    handoff.pointers.some((p) => p.titulo.startsWith('Artefato da claim')),
    'o artefato citado pela claim vira ponteiro'
  );
  // A claim ja verificada nao ocupa espaco inline: ela vira endereco.
  assert.ok(handoff.pointers.some((p) => p.titulo.startsWith('Claim C2 ja verificada')));
  assert.equal(
    handoff.inline.some((i) => i.titulo.startsWith('Claim C2')),
    false
  );

  // RESUMIVEL: historico com proveniencia no ledger.
  assert.ok(handoff.summaries.length > 0);
  assert.ok(handoff.summaries.some((s) => s.text.includes('eventos no ledger')));

  const evento = lerLedger(dirThread(projeto.dir, thread.id)).find(
    (e) => e.tipo === 'handoff_exported'
  );
  assert.ok(evento);
  assert.equal(evento.inline, handoff.inline.length);
  assert.equal(evento.pointers, handoff.pointers.length);
  assert.equal(evento.memory, 'files');
  assert.equal(corrida.dryRun, true, 'nenhuma sessao real foi despachada neste teste');

  projeto.limpar();
});

test('handoff recall resolve o ponteiro de volta ao conteudo real', () => {
  const projeto = projetoTemporario('handoff-recall');
  const { thread } = threadComMaterial(projeto);
  const { handoff } = exportarHandoff(projeto.carregado, thread.id, { proximaFase: 'GO' });

  // Ponteiro de secao de markdown: devolve so a secao pedida, com o intervalo de linhas.
  const ponteiroDoPrompt = handoff.pointers.find((p) => p.titulo.startsWith('Prompt da sessao'));
  assert.ok(ponteiroDoPrompt);
  const r = recall(projeto.carregado, thread.id, ponteiroDoPrompt.location);
  assert.ok(r.conteudo.includes('Mapear o objetivo do handoff triado'));
  assert.ok(r.conteudo.startsWith('## Pedido do builder'));
  assert.equal(r.conteudo.includes('## Regras de evidencia'), false, 'a secao seguinte nao vem junto');
  assert.equal(r.sha256, ponteiroDoPrompt.sha256, 'o sha256 recuperado bate com o do handoff');
  assert.ok(r.intervalo && r.intervalo.inicio > 0);
  assert.equal(r.metodo, 'secao de markdown pelo titulo');

  // Ponteiro de claim: devolve a claim inteira, pelo id, dentro do JSONL.
  const claim = recall(
    projeto.carregado,
    thread.id,
    `.orkastery/threads/${thread.id}/claims.jsonl#claim:C1`
  );
  assert.ok(claim.conteudo.includes('a spec descreve a regra da entrega'));
  assert.equal(claim.metodo, 'claim por id no JSONL (a gravacao mais recente vence)');

  // Ponteiro de campo em JSON e de faixa de linhas.
  const base = recall(
    projeto.carregado,
    thread.id,
    `.orkastery/threads/${thread.id}/thread.json#json:base.branch`
  );
  assert.equal(base.conteudo, 'main');
  const faixa = recall(projeto.carregado, thread.id, 'spec.md#L1-L1');
  assert.equal(faixa.conteudo, '# spec');

  // A recuperacao tardia fica registrada no ledger: e evidencia, nao leitura anonima.
  const recuperados = lerLedger(dirThread(projeto.dir, thread.id)).filter(
    (e) => e.tipo === 'handoff_recalled'
  );
  assert.equal(recuperados.length, 4);
  assert.equal(recuperados[0].location, ponteiroDoPrompt.location);

  // Ponteiro que nao resolve reprova com mensagem acionavel, nao devolve vazio.
  assert.throws(
    () => recall(projeto.carregado, thread.id, 'spec.md#secao-que-nao-existe'),
    /ancora "secao-que-nao-existe" nao encontrada/
  );
  assert.throws(
    () => recall(projeto.carregado, thread.id, 'nao-existe.md#tudo'),
    /arquivo "nao-existe.md" nao existe/
  );

  projeto.limpar();
});

test('o artefato da claim e achado na worktree da thread, nao so na raiz', () => {
  const projeto = projetoTemporario('handoff-worktree');
  const { thread } = novaThread(projeto.carregado, {
    nome: 'isolada',
    modo: 'auto',
    criarWorktree: true,
  });
  // O arquivo existe SO dentro da worktree da thread, como acontece durante o GO.
  fs.writeFileSync(path.join(thread.worktree as string, 'ENTREGA.md'), '# entrega\n', 'utf8');
  adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'ENTREGA.md',
    alegacao: 'a entrega existe',
    verificar: ['test -f ENTREGA.md'],
  });

  const { handoff } = exportarHandoff(projeto.carregado, thread.id, { proximaFase: 'GO' });
  const ponteiro = handoff.pointers.find((p) => p.titulo.startsWith('Artefato da claim'));
  assert.ok(ponteiro, 'o artefato dentro da worktree vira ponteiro');
  assert.equal(ponteiro.location, `.claude/worktrees/${thread.id}/ENTREGA.md#tudo`);

  // E o ponteiro resolve de volta a partir da raiz do projeto.
  const r = recall(projeto.carregado, thread.id, ponteiro.location);
  assert.equal(r.conteudo, '# entrega\n');

  projeto.limpar();
});

test('a ancora de titulo normaliza acentos e pontuacao do markdown', () => {
  assert.equal(ancoraDeTitulo('Pedido do builder'), 'pedido-do-builder');
  assert.equal(ancoraDeTitulo('Contexto da thread'), 'contexto-da-thread');
  assert.equal(ancoraDeTitulo('Modo de conducao: #Classic'), 'modo-de-conducao-classic');
});


test('memória ativa restrita recusa export e lições amplas antes de qualquer efeito', () => {
  const projeto = projetoTemporario('handoff-restrito');
  try {
    const { thread } = threadComMaterial(projeto);
    const dir = dirThread(projeto.dir, thread.id);
    const original = exportarHandoff(projeto.carregado, thread.id, { proximaFase: 'CHECK' });
    const antes = fs.readFileSync(original.caminho);
    const ledgerAntes = fs.readFileSync(path.join(dir, 'ledger.jsonl'));
    const arquivosAntes = fs.readdirSync(dir, { recursive: true }).sort();
    const manifesto = path.join(projeto.dir, 'orkastery.yaml');
    fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace(/^  mode: files$/m, '  mode: orkmind').replace(/^  database_url_env: ""$/m, '  database_url_env: "ORKASTERY_TESTE_DSN"'));
    const carregado = exigirManifesto(projeto.dir), driver = new DriverEmMemoria();
    const memoria = abrirMemoria(carregado, { driver, leituraRestrita: { thread: thread.id } });
    assert.equal(memoria.ativo, true);
    let consultas = 0;
    driver.consultar = () => { consultas++; throw Error('consulta indevida'); };
    driver.exportar = () => { consultas++; throw Error('export indevido'); };
    assert.throws(() => exportarHandoff(carregado, thread.id, { memoria }), /memory.query.broad-operation/);
    assert.throws(() => exportarHandoff(carregado, 'ork-inexistente', { memoria }), /memory.query.broad-operation/);
    assert.throws(() => licoesDoProduto(memoria, carregado.manifesto, thread.id), /memory.query.broad-operation/);
    assert.equal(consultas, 0);
    assert.deepEqual(driver.tudo(), []);
    assert.deepEqual(fs.readFileSync(original.caminho), antes);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'ledger.jsonl')), ledgerAntes);
    assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), arquivosAntes);
    const files = abrirMemoria(projeto.carregado, { leituraRestrita: { thread: thread.id } });
    assert.deepEqual(licoesDoProduto(files, projeto.carregado.manifesto, thread.id), []);
    assert.equal(exportarHandoff(projeto.carregado, thread.id, { memoria: files }).handoff.memory, 'files');
  } finally { projeto.limpar(); }
});

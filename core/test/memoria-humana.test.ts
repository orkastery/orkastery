import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { aprovarGateHumano, aprovacaoHumanaProvada } from '../src/gates';
import { inventariarGatesHumanos, publicarAprovacaoHumana, publicarGatesHumanos } from '../src/memoria-humana';
import { abrirMemoria, sincronizarMemoria } from '../src/memoria';
import { DriverEmMemoria } from '../src/orkmind';
import { registrar, lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';
import { abrirPedidoGate, assinaturaDaResposta, contextoDoPedidoNativo, responderGate, RespostaHumana } from '../src/hitl-gates';
import { evidenciaDoIngresso, gravarIngresso } from '../src/hitl-ingress-receipt';
import { ambienteDeAssinatura } from '../src/runtime-ambiente';
import { ambienteDoDespacho } from '../src/adapters/codex';
import { ENV_HITL_VERIFIERS, publicHitlVerifiers } from '../src/hitl-public-receipt';
import { NativeAnswer, nativeMessage } from '../src/hitl-native';
import { alvoDoPedido, prazoDoPedido } from '../src/hitl-contract';

process.env.ORK_HITL_INGRESS_KEY = 'chave-sintetica-memoria-humana-000000';

test('F3: inventario protegido normaliza caixa antes de qualquer leitura em fixture vazia', () => {
  const p = projetoTemporario('inventario-caixa');
  try {
    for (const id of ['ORK-GRANDEEVOLUC', 'OrK-Jornadasdpa', 'ORK-RENARRATIVAC']) {
      assert.deepEqual(inventariarGatesHumanos(p.carregado, id), []);
    }
  } finally { p.limpar(); }
});

function fixture() {
  const p = projetoTemporario('memoria-humana');
  p.carregado.manifesto.memory.mode = 'orkmind';
  p.carregado.manifesto.memory.database_url_env = 'TEST_TENANT';
  const driver = new DriverEmMemoria(), memoria = abrirMemoria(p.carregado, { driver });
  const criar = (nome: string, modo: 'auto'|'classic' = 'classic') => {
    const { thread } = novaThread(p.carregado, { nome, modo });
    const dir = dirThread(p.dir, thread.id);
    fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompts/humano.md'), 'Resposta humana de teste: aprovo a operacao descrita.');
    return { thread, dir };
  };
  return { p, driver, memoria, criar };
}
let sequencia = 0;
const confirmado = (raiz: string, id: string) => {
  const n = ++sequencia, recebidoEm = '2026-09-12T20:00:00.000Z';
  registrar(dirThread(raiz, id), id, 'phase_result', { fase: 'GOAL' });
  const pedido = abrirPedidoGate(raiz, id, 'human.pending', recebidoEm);
  const pedidoId = pedido.id;
  const resposta: RespostaHumana = { resposta: '1', origem: 'telegram', por: 'telegram:42',
    mensagem: `telegram:-7:fixture-${n}`, recebidoEm,
    prova: createHash('sha256').update(`prova-sintetica-${n}`).digest('hex') };
  gravarIngresso(raiz, id, pedidoId, resposta, recebidoEm);
  const evidencia = evidenciaDoIngresso(raiz, id, pedidoId, resposta);
  const alvo = alvoDoPedido(pedido);
  return { estado: 'aprovado', source: 'human', origem: 'telegram', autorizadoPor: resposta.por,
    // I-41: o evento copia o contrato do PEDIDO, que e o que `responderGate` grava. Fixar v1
    // aqui faria o teste afirmar uma combinacao que a producao nunca produz.
    contrato: pedido.contrato, pedidoId, mensagem: resposta.mensagem,
    recebidoEm, recibo: createHash('sha256').update(resposta.prova).digest('hex'),
    sobre: alvo?.tipo === 'gate' ? alvo.sobre : '', fase: pedido.fase, opcao: 1,
    evidencia: evidencia.arquivo, evidenciaSha256: evidencia.sha256 };
};

test('sync humano exige thread e preserva bytes da outra thread elegivel no mesmo tenant', () => {
  const { p, driver, memoria, criar } = fixture();
  try {
    const primeira = criar('primeira'), segunda = criar('segunda');
    for (const { thread, dir } of [primeira, segunda]) registrar(dir, thread.id, 'human_gate', confirmado(p.dir, thread.id));
    const outroLedger = path.join(segunda.dir, 'ledger.jsonl'), antes = fs.readFileSync(outroLedger);
    assert.throws(() => publicarGatesHumanos(p.carregado, memoria), /scope.write.required/);
    for (const id of ['ork-grandeevoluc', 'ork-jornadasdpa', 'ork-renarrativac']) {
      assert.throws(() => sincronizarMemoria(p.carregado, memoria, id), /scope.thread.protected/);
    }
    assert.equal(driver.tudo().length, 0);
    const a = publicarGatesHumanos(p.carregado, memoria, primeira.thread.id);
    assert.equal(a.elegiveis, 1); assert.equal(a.falhas, 0);
    const b = publicarGatesHumanos(p.carregado, memoria, primeira.thread.id);
    assert.deepEqual(b.resultados.map(r => r.gravacao.id), a.resultados.map(r => r.gravacao.id));
    assert.ok(b.resultados.every(r => r.gravacao.duplicada));
    assert.equal(driver.tudo().length, 1);
    const e = driver.tudo()[0];
    assert.equal(e.source, 'human'); assert.equal(e.mandatory, false); assert.notEqual(e.priority, 'critical');
    const prov = e.metadata.proveniencia as Record<string, unknown>;
    assert.equal(prov.confirmado, true); assert.match(String(prov.sha256), /^[a-f0-9]{64}$/);
    assert.equal(sincronizarMemoria(p.carregado, memoria, primeira.thread.id).humanos.elegiveis, 1);
    assert.equal(sincronizarMemoria(p.carregado, memoria, null).humanos.elegiveis, 0);
    assert.deepEqual(fs.readFileSync(outroLedger), antes);
    assert.ok(driver.tudo().every(e => !e.tags.situation?.includes(`thread:${segunda.thread.id}`)));
  } finally { p.limpar(); }
});

test('pendencias, watchdog, automacao, autoria ambigua e evidencia divergente sao excluidos com motivo', () => {
  const { p, memoria, criar } = fixture();
  try {
    const { thread, dir } = criar('exclusoes');
    const base = confirmado(p.dir, thread.id);
    const forjada = path.join(dir, 'hitl-ingress/forjada.json');
    fs.writeFileSync(forjada, '{"fixture":"sem assinatura"}\n', { mode: 0o600 });
    for (const e of [
      { ...base, estado: 'aguardando' },
      { ...base, autorizadoPor: 'Julio (auto-avancado pelo watchdog, autorizado)' },
      { ...base, automatico: true },
      { ...base, source: 'agent', autorizadoPor: 'Julio' },
      { ...base, source: undefined },
      { ...base, evidencia: 'ausente.md' },
      { ...base, evidencia: '/etc/passwd' },
      { ...base, evidenciaSha256: 'errado' },
      { ...base, tenant: 'outro' },
      ...['codex/gpt-6-astra', 'Claude', 'agente', 'bot', 'humano'].map(autorizadoPor => ({ ...base, autorizadoPor })),
      { ...base, thread: 'outra-thread' },
      { ...base, mensagem: 'telegram:-7:forjada', evidencia: `.orkastery/threads/${thread.id}/hitl-ingress/forjada.json`,
        evidenciaSha256: createHash('sha256').update(fs.readFileSync(forjada)).digest('hex') },
    ]) registrar(dir, thread.id, 'human_gate', e);
    const r = publicarGatesHumanos(p.carregado, memoria, thread.id);
    assert.equal(r.elegiveis, 0); assert.equal(r.excluidos, 16);
    assert.ok(r.inventario.every(i => i.motivo !== 'elegivel'));
    assert.ok(r.inventario.some(i => i.motivo === 'automacao_declarada'));
    assert.ok(r.inventario.some(i => i.motivo === 'autoria_ambigua'));
    assert.ok(r.inventario.some(i => i.motivo === 'evidencia_divergente'));
  } finally { p.limpar(); }
});

test('gancho de aprovacao carimba prova humana; legado nao ganha source human e watchdog e recusado', () => {
  const { p, criar } = fixture();
  const nomes = ['ORK_HITL_INGRESS_KEY','ORK_HITL_TELEGRAM_USERS','ORK_HITL_TELEGRAM_CHATS'];
  const anteriores = nomes.map(n => process.env[n]);
  try {
    const { thread, dir } = criar('gancho','classic');
    assert.throws(() => aprovarGateHumano(p.dir, thread.id, 'plano', 'Julio', 'legado'), /aposentada/);
    process.env.ORK_HITL_INGRESS_KEY='chave-sintetica-memoria-humana-000000';process.env.ORK_HITL_TELEGRAM_USERS='42';process.env.ORK_HITL_TELEGRAM_CHATS='-7';
    const quando='2026-09-12T20:00:00.000Z';
    registrar(dir,thread.id,'phase_result',{fase:'GOAL'});
    const pedido=abrirPedidoGate(p.dir,thread.id,undefined,quando);
    const parcial={resposta:'1',origem:'telegram' as const,por:'telegram:42',mensagem:'telegram:-7:real',recebidoEm:quando};
    const r:RespostaHumana={...parcial,prova:assinaturaDaResposta(thread.id,pedido.id,parcial,process.env.ORK_HITL_INGRESS_KEY)};
    const resposta=responderGate(p.dir,thread.id,pedido.id,r,quando);
    assert.equal(resposta.estado,'aprovado');assert.equal(resposta.publicacaoMemoria?.estado,'pendente');
    const e=lerLedger(dir).find(e=>e.tipo==='human_gate')!;
    assert.equal(e.source, 'human'); assert.match(String(e.evidenciaSha256), /^[a-f0-9]{64}$/);
    assert.match(String(e.evidencia),/hitl-ingress/);
    const gates = inventariarGatesHumanos(p.carregado);
    assert.equal(gates.filter(g => g.elegivel).length, 1);
    assert.ok(lerLedger(dir).some(e => e.tipo === 'human_memory_sync_failed'));
    for (const autor of ['codex/gpt-6-astra', 'Claude', 'agente', 'bot', 'humano']) {
      assert.throws(() => aprovarGateHumano(p.dir, thread.id, 'plano', autor), /aposentada/);
    }
  } finally { nomes.forEach((n,i)=>anteriores[i]===undefined?delete process.env[n]:process.env[n]=anteriores[i]);p.limpar(); }
});

test('recibo Telegram de recusa não aceita pedido e ledger reescritos como aprovação', () => {
  const { p, criar } = fixture();
  const nomes = ['ORK_HITL_INGRESS_KEY','ORK_HITL_TELEGRAM_USERS','ORK_HITL_TELEGRAM_CHATS'];
  const anteriores = nomes.map(n => process.env[n]);
  try {
    const { thread, dir } = criar('telegram-recusa','classic');
    process.env.ORK_HITL_INGRESS_KEY='chave-sintetica-memoria-humana-000000';
    process.env.ORK_HITL_TELEGRAM_USERS='42'; process.env.ORK_HITL_TELEGRAM_CHATS='-7';
    const quando='2026-09-12T20:00:00.000Z';
    registrar(dir,thread.id,'phase_result',{fase:'GOAL'});
    const pedido=abrirPedidoGate(p.dir,thread.id,undefined,quando);
    const parcial={resposta:'2',origem:'telegram' as const,por:'telegram:42',mensagem:'telegram:-7:recusa',recebidoEm:quando};
    const resposta:RespostaHumana={...parcial,prova:assinaturaDaResposta(thread.id,pedido.id,parcial,process.env.ORK_HITL_INGRESS_KEY)};
    assert.equal(responderGate(p.dir,thread.id,pedido.id,resposta,quando).estado,'recusado');
    const arquivo=path.join(dir,'ledger.jsonl'),linhas=fs.readFileSync(arquivo,'utf8').trimEnd().split('\n');
    const pedidoLinha=linhas.findIndex(l=>JSON.parse(l).tipo==='hitl_requested');
    // I-41: a forja precisa acompanhar a versao do pedido. O que o teste prova e o mesmo:
    // reescrever a ACAO da alternativa escolhida no ledger nao transforma recusa em aprovacao,
    // porque o recibo foi assinado sobre os bytes do pedido original.
    const pedidoForjado=JSON.parse(linhas[pedidoLinha]);
    const escolhasForjadas=pedidoForjado.pedido.alternativas??pedidoForjado.pedido.opcoes;
    escolhasForjadas[1].acao='aprovar';
    linhas[pedidoLinha]=JSON.stringify(pedidoForjado);
    const i=linhas.findIndex(l=>JSON.parse(l).tipo==='human_gate');
    const gate=JSON.parse(linhas[i]);gate.estado='aprovado';linhas[i]=JSON.stringify(gate);fs.writeFileSync(arquivo,linhas.join('\n')+'\n');
    const inventario=inventariarGatesHumanos(p.carregado,thread.id);
    assert.equal(inventario.length,1);assert.equal(inventario[0].elegivel,false);
  } finally { nomes.forEach((n,i)=>anteriores[i]===undefined?delete process.env[n]:process.env[n]=anteriores[i]);p.limpar(); }
});

test('GO-FIX6: sync Telegram sem autoridade exclui o evento e retoma com verificador público', () => {
  const { p, memoria, criar } = fixture();
  const saved = { ...process.env };
  try {
    const { thread, dir } = criar('telegram-sem-chave');
    registrar(dir, thread.id, 'human_gate', confirmado(p.dir, thread.id));
    const publicEnv = ambienteDeAssinatura(process.env);
    delete process.env.ORK_HITL_INGRESS_KEY;
    delete process.env[ENV_HITL_VERIFIERS];
    const bloqueado = publicarGatesHumanos(p.carregado, memoria, thread.id);
    assert.equal(bloqueado.elegiveis, 0);
    assert.equal(bloqueado.inventario[0].motivo, 'autoria_ambigua');
    process.env = publicEnv;
    const retomado = publicarGatesHumanos(p.carregado, memoria, thread.id);
    assert.equal(retomado.elegiveis, 1); assert.equal(retomado.falhas, 0);
    assert.equal(process.env.ORK_HITL_INGRESS_KEY, undefined);
  } finally {
    process.env = saved;
    p.limpar();
  }
});

for (const channel of ['legacy', 'hermes', 'openclaw'] as const) {
  test(`GO-FIX6: memória Telegram ${channel} usa autoridade pública no ambiente sanitizado`, () => {
    const { p, memoria, driver, criar } = fixture(), saved = { ...process.env };
    const keyName = `ORK_HITL_INGRESS_KEY${channel === 'legacy' ? '' : `_${channel.toUpperCase()}`}`;
    const key = `fixture-memory-${channel}-`.repeat(4);
    try {
      Object.assign(process.env, { [keyName]: key, ORK_HITL_TELEGRAM_USERS: '42',
        ORK_HITL_TELEGRAM_CHATS: '-7', ORK_HITL_OPENCLAW_ACCOUNT: 'account' });
      const { thread, dir } = criar(`telegram-${channel}`);
      registrar(dir, thread.id, 'phase_result', { fase: 'GOAL' });
      const q = abrirPedidoGate(p.dir, thread.id);
      const answer: RespostaHumana = { origem: 'telegram', resposta: '1', por: 'telegram:42',
        mensagem: 'telegram:-7:memory', recebidoEm: new Date().toISOString(), prova: '',
        ...(channel === 'legacy' ? {} : { canal: channel }), ...(channel === 'openclaw' ? { conta: 'account' } : {}) };
      answer.prova = assinaturaDaResposta(thread.id, q.id, answer, key);
      assert.equal(responderGate(p.dir, thread.id, q.id, answer).estado, 'aprovado');
      const event = lerLedger(dir).find(e => e.tipo === 'human_gate')!;
      const parent = { ...process.env }, file = path.join(p.dir, String(event.evidencia));
      const original = fs.readFileSync(file), proof = fs.readFileSync(`${file}.public`);
      for (const env of [ambienteDeAssinatura(parent), ambienteDoDespacho(parent)]) {
        process.env = { ...env };
        assert.deepEqual(Object.keys(process.env).filter(k => k.startsWith('ORK_HITL_')), []);
        assert.equal(aprovacaoHumanaProvada(p.dir, thread.id, event), true);
        assert.equal(inventariarGatesHumanos(p.carregado, thread.id)[0].elegivel, true);
        const r = sincronizarMemoria(p.carregado, memoria, thread.id).humanos;
        assert.equal(r.elegiveis, 1); assert.equal(r.falhas, 0);
        assert.equal(driver.tudo().filter(e => e.source === 'human').length, 1);
        const refuse = () => {
          assert.equal(aprovacaoHumanaProvada(p.dir, thread.id, event), false);
          const rejected = publicarGatesHumanos(p.carregado, memoria, thread.id);
          assert.equal(rejected.elegiveis, 0); assert.deepEqual(rejected.resultados, []);
          assert.equal(driver.tudo().filter(e => e.source === 'human').length, 1);
        };
        fs.writeFileSync(file, original.toString() + ' '); refuse(); fs.writeFileSync(file, original);
        fs.writeFileSync(`${file}.public`, '{}'); refuse();
        fs.unlinkSync(`${file}.public`); refuse(); fs.writeFileSync(`${file}.public`, proof, { mode: 0o600 });
        process.env[ENV_HITL_VERIFIERS] = publicHitlVerifiers({ ...parent, [keyName]: 'wrong-fixture-authority-'.repeat(3) });
        refuse(); process.env = { ...env };
        process.env[keyName] = 'invalid'; refuse(); delete process.env[keyName];
        assert.equal(inventariarGatesHumanos(p.carregado, thread.id)[0].elegivel, true);
      }
    } finally { process.env = saved; p.limpar(); }
  });
}


for (const host of ['hermes', 'openclaw'] as const) {
  test(`GO-FIX6: memória native ${host} preserva autoria/canal e recusa prova inválida ou ambígua`, () => {
    const { p, memoria, driver, criar } = fixture(), saved = { ...process.env };
    const binding = { host, installationId: 'fixture-install', connectionId: 'fixture-connection',
      sessionId: 'fixture-session', accountId: 'fixture-account', channelId: 'discord', conversationId: '42', personId: '24' };
    const key = `fixture-memory-native-${host}-`.repeat(3);
    try {
      process.env[`ORK_HITL_NATIVE_KEY_${host.toUpperCase()}`] = key;
      process.env[`ORK_HITL_NATIVE_BINDING_${host.toUpperCase()}`] = JSON.stringify(binding);
      const { thread, dir } = criar(`native-${host}`);
      registrar(dir, thread.id, 'phase_result', { fase: 'GOAL' });
      const q = abrirPedidoGate(p.dir, thread.id), context = contextoDoPedidoNativo(p.dir, thread.id, q.id);
      const native = { ...binding, messageId: 'msg', context: String(context.contexto),
        pedidoSha256: context.pedidoSha256, expiresAt: prazoDoPedido(q)! };
      const answer: NativeAnswer = { origem: 'native', canal: host, conta: binding.accountId, native,
        por: `native:${host}:${binding.personId}`, mensagem: nativeMessage(native),
        recebidoEm: new Date().toISOString(), resposta: '1', prova: '' };
      answer.prova = assinaturaDaResposta(thread.id, q.id, answer, key);
      assert.equal(responderGate(p.dir, thread.id, q.id, answer).estado, 'aprovado');
      const event = lerLedger(dir).find(e => e.tipo === 'human_gate')!;
      const parent = { ...process.env }, file = path.join(dir, 'ledger.jsonl');
      for (const env of [parent, ambienteDeAssinatura(parent), ambienteDoDespacho(parent)]) {
        process.env = { ...env };
        assert.equal(aprovacaoHumanaProvada(p.dir, thread.id, event), true);
        const inventory = inventariarGatesHumanos(p.carregado, thread.id);
        assert.equal(inventory.length, 1); assert.equal(inventory[0].elegivel, true);
        assert.equal(inventory[0].autor, answer.por);
        const result = sincronizarMemoria(p.carregado, memoria, thread.id).humanos;
        assert.equal(result.elegiveis, 1); assert.equal(result.falhas, 0);
        const entries = driver.tudo().filter(e => e.source === 'human');
        assert.equal(entries.length, 1);
        assert.ok(entries[0].content.includes(answer.por));
        const provenance = entries[0].metadata.proveniencia as Record<string, unknown>;
        assert.equal(provenance.autor, answer.por);
        assert.equal(provenance.origem, 'native'); assert.equal(provenance.canal, host);
        assert.deepEqual(entries[0].metadata.eventoOriginal, event);
        const original = fs.readFileSync(file, 'utf8'), lines = original.trimEnd().split('\n');
        const gateIndex = lines.findIndex(l => JSON.parse(l).tipo === 'human_gate');
        const request = lines.find(l => JSON.parse(l).tipo === 'hitl_requested')!;
        const changes = [{ autorizadoPor: 'native:hermes:other' }, { origem: 'telegram' }, { canal: host === 'hermes' ? 'openclaw' : 'hermes' },
          { conta: 'other' }, { source: 'agent' }, { automatico: true }, { thread: 'other' }, { tenant: 'other' },
          { pedidoId: 'other' }, { recibo: '0'.repeat(64) }, { native: null },
          ...Object.keys(native).map(k => ({ native: { ...native, [k]: 'other' } }))];
        const invalidLedgers = changes.map(change => lines.map((line, i) => i === gateIndex ? JSON.stringify({ ...event, ...change }) : line));
        invalidLedgers.push([...lines, lines[gateIndex]], [...lines, request]);
        for (const invalid of invalidLedgers) {
          fs.writeFileSync(file, invalid.join('\n') + '\n');
          const refused = publicarGatesHumanos(p.carregado, memoria, thread.id);
          assert.equal(refused.elegiveis, 0); assert.deepEqual(refused.resultados, []);
          assert.equal(driver.tudo().filter(e => e.source === 'human').length, 1);
        }
        fs.writeFileSync(file, original);
        assert.equal(publicarGatesHumanos(p.carregado, memoria, thread.id).resultados[0].gravacao.duplicada, true);
      }
    } finally { process.env = saved; p.limpar(); }
  });
}

test('falha de driver e de abertura posterior preservam aprovacao e recuperam sem duplicar gate', () => {
  const { p, memoria, driver, criar } = fixture();
  try {
    const { thread, dir } = criar('publicacao-pendente');
    const manifesto = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(manifesto);
    fs.writeFileSync(manifesto, 'manifesto-invalido');
    const e = registrar(dir,thread.id,'human_gate',confirmado(p.dir, thread.id));
    const publicacao = publicarAprovacaoHumana(p.dir,thread.id,e);
    assert.equal(e.estado, 'aprovado');
    assert.equal(publicacao.estado, 'pendente');
    const gateAntes = lerLedger(dir).filter(e => e.tipo === 'human_gate');
    assert.equal(gateAntes.length, 1);
    assert.equal(lerLedger(dir).at(-1)?.tipo, 'human_memory_sync_failed');
    fs.writeFileSync(manifesto, original);
    const publicada = publicarGatesHumanos(p.carregado, memoria, thread.id);
    assert.equal(publicada.falhas, 0); assert.equal(publicada.elegiveis, 1);
    assert.equal(driver.tudo().filter(item => item.source === 'human').length, 1);
    const gravar = memoria.gravar;
    memoria.gravar = () => { throw new Error('texto sensivel sintetico nao deve escapar'); };
    const falha = publicarGatesHumanos(p.carregado, memoria, thread.id);
    assert.equal(falha.falhas, 1); assert.equal(driver.tudo().filter(item => item.source === 'human').length, 1);
    assert.ok(!fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').includes('sensivel sintetico'));
    memoria.gravar = gravar;
    const r = sincronizarMemoria(p.carregado, memoria, thread.id);
    assert.equal(r.humanos.falhas, 0); assert.equal(r.humanos.elegiveis, 1);
    assert.ok(r.humanos.resultados[0].gravacao.id);
    assert.deepEqual(lerLedger(dir).filter(e => e.tipo === 'human_gate'), gateAntes);
    assert.equal(sincronizarMemoria(p.carregado, memoria, thread.id).humanos.resultados[0].gravacao.duplicada, true);
  } finally { p.limpar(); }
});


test('alias de thread elegivel nao autoriza publicar memoria humana', () => {
  const { p, memoria, driver, criar } = fixture();
  try {
    const { thread, dir } = criar('origem');
    registrar(dir, thread.id, 'human_gate', confirmado(p.dir, thread.id));
    const antes = fs.readFileSync(path.join(dir, 'ledger.jsonl'));
    fs.symlinkSync(dir, path.join(p.dir, '.orkastery/threads/alias'));
    assert.throws(() => publicarGatesHumanos(p.carregado, memoria, 'alias'), /scope.thread.alias/);
    assert.throws(() => sincronizarMemoria(p.carregado, memoria, 'alias'), /scope.thread.alias/);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'ledger.jsonl')), antes);
    assert.equal(driver.tudo().length, 0);
  } finally { p.limpar(); }
});

test('I-41: a aprovação sob ork.hitl/v2 é reconhecida e entra na memória como elegível', () => {
  const { p, memoria, criar } = fixture();
  try {
    const { thread, dir } = criar('aprovacao-v2');
    const evento = confirmado(p.dir, thread.id);
    // O pedido que o gate abre já é v2, e o recibo copia o contrato dele. Este é o caso que
    // `formaDeAprovacao` e a regra de autoria recusariam enquanto comparavam com a string do v1:
    // a aprovação do próprio dono deixaria de valer para retry, para ship e para a memória.
    assert.equal(evento.contrato, 'ork.hitl/v2');
    registrar(dir, thread.id, 'human_gate', evento);
    const gate = lerLedger(dir).find(e => e.tipo === 'human_gate')!;
    assert.equal(aprovacaoHumanaProvada(p.dir, thread.id, gate), true, 'aprovação v2 não foi reconhecida');
    const r = publicarGatesHumanos(p.carregado, memoria, thread.id);
    assert.equal(r.elegiveis, 1);
    assert.equal(r.inventario[0].motivo, 'elegivel');
    // E a porta continua fechada para contrato desconhecido, que é o que autoria ambígua quer dizer.
    const outro = criar('aprovacao-v3');
    registrar(outro.dir, outro.thread.id, 'human_gate',
      { ...confirmado(p.dir, outro.thread.id), contrato: 'ork.hitl/v3' });
    const s3 = publicarGatesHumanos(p.carregado, memoria, outro.thread.id);
    assert.equal(s3.elegiveis, 0);
    assert.equal(s3.inventario[0].motivo, 'autoria_ambigua');
  } finally { p.limpar(); }
});

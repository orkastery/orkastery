/**
 * K3.1: dossiê de decisão. Tudo aqui é SIMULADO: Brain falso, chave de ingresso de fixture e
 * nenhum humano. A resposta do dono entra pelo mesmo `responderGate` do ingresso autenticado.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { projetoTemporario, ProjetoDeTeste, semAutoridadeHitlNoAmbiente } from './apoio';
import { createInitiative, createProduct, createProject, readPortfolio } from '../src/portfolio';
import { dirEstado } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { registrarDecisao } from '../src/decisao-autonoma';
import { abrirPedidoGate, assinaturaDaResposta, responderGate, RespostaHumana } from '../src/hitl-gates';
import { PedidoHitlQualquer } from '../src/hitl-contract';
import { CreationActor, startCreation } from '../src/creation-operation';
import { criarIngressoLocal } from '../src/hitl-local';
import { aprovacaoHumanaProvada } from '../src/gates';
import { lerLedger } from '../src/ledger';
import { BRAIN_API, BrainTransport } from '../src/company-brain-client';
import { BrainEvent, digest } from '../src/company-brain-contract';
import { buildContext } from '../src/company-brain-context';
import { portfolioEntities, readCycle } from '../src/company-brain-source';
import { runBrain } from '../src/company-brain-cli';
import { buildDossie, DOSSIE_SCHEMA, Dossie } from '../src/company-brain-dossie';

semAutoridadeHitlNoAmbiente();
const CHAVE = 'chave-SIMULADA-exclusiva-do-dossie';
const INSTANCIA = 'orkastery';

/** A resposta do dono só confere com a chave do canal no ambiente, como no ingresso real. */
function comIngressoSimulado<T>(executar: () => T): T {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  [CHAVE, '42', '-7'].forEach((v, i) => { process.env[nomes[i]] = v; });
  try { return executar(); } finally { nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; }); }
}

/** Portfólio sintético: um produto, dois projetos e uma iniciativa. */
function montar(nome: string): ProjetoDeTeste {
  const p = projetoTemporario(nome);
  createProduct(p.dir, { id: 'prod-alpha', title: 'Alpha' });
  createProject(p.dir, { id: 'proj-alpha-core', productId: 'prod-alpha', title: 'Núcleo', workspaceIds: ['fixture'] });
  createProject(p.dir, { id: 'proj-alpha-side', productId: 'prod-alpha', title: 'Lateral' });
  createInitiative(p.dir, { id: 'init-alpha-one', projectId: 'proj-alpha-core', title: 'Uma' });
  return p;
}
const thread = (p: ProjetoDeTeste, nome: string, modo: 'auto' | 'classic' = 'auto') => novaThread(p.carregado, { nome, modo }).thread.id;
/** O arquivo que `ork brain bind` grava; o bind exige ativação, então o teste escreve o mesmo formato. */
function vincular(p: ProjetoDeTeste, id: string, projectId: string, initiativeIds: string[]): void {
  fs.writeFileSync(path.join(dirThread(p.dir, id), 'brain-scope.json'), JSON.stringify({ schema: 'ork.brain-cycle-scope/v1', version: 1,
    thread: id, projectId, delivery: initiativeIds.length ? 'initiatives' : 'project', initiativeIds }));
}
const decidir = (p: ProjetoDeTeste, id: string, extra: Partial<Parameters<typeof registrarDecisao>[2]> = {}) => registrarDecisao(p.dir, id, {
  decidido: 'Consultar o Brain num lote só', porque: 'uma seleção cobre a thread inteira', comoMudar: 'trocar o lote por get',
  custoDeReverter: { agora: 'uma função', depois: 'uma função' }, criterio: { tipo: 'medicao', referencia: 'node --version' },
  quemDecidiu: 'sessão SIMULADA de GO', evidencia: 'fixture SIMULADA', razao: 'medido no teste', ...extra });
/** Linha crua no ledger, como as gravadas antes do contrato: o `registrar` de hoje recusaria. */
function linhaCrua(p: ProjetoDeTeste, id: string, campos: Record<string, unknown>): number {
  const arquivo = path.join(dirThread(p.dir, id), 'ledger.jsonl');
  fs.appendFileSync(arquivo, JSON.stringify({ ts: new Date().toISOString(), thread: id, ...campos }) + '\n');
  return fs.readFileSync(arquivo, 'utf8').trimEnd().split('\n').length;
}
function perguntar(p: ProjetoDeTeste, nome: string): { id: string; pedido: PedidoHitlQualquer } {
  const id = thread(p, nome, 'classic');
  registrar(dirThread(p.dir, id), id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture SIMULADA' });
  return { id, pedido: abrirPedidoGate(p.dir, id) };
}
function responder(p: ProjetoDeTeste, id: string, pedido: PedidoHitlQualquer, resposta = '1'): void {
  comIngressoSimulado(() => {
    const base: Omit<RespostaHumana, 'prova'> = { resposta, origem: 'telegram', canal: 'hermes', por: 'telegram:42',
      mensagem: `telegram:-7:${randomUUID()}`, recebidoEm: new Date().toISOString() };
    responderGate(p.dir, id, pedido.id, { ...base, prova: assinaturaDaResposta(id, pedido.id, base, CHAVE) });
  });
}
/** Os fatos que a captura mandaria ao Brain para esta thread, pela própria `readCycle`. */
function fatosDaThread(p: ProjetoDeTeste, id: string): BrainEvent[] {
  const bytes = fs.readFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'));
  return readCycle(bytes, { tenant: p.carregado.manifesto.memory.tenant, instance: INSTANCIA, thread: id, aclRef: 'ork-factory' })
    .records.flatMap(r => r.event ? [r.event] : []);
}
const assercao = (e: BrainEvent, source = e.source) => ({ id: e.aggregate_id, schema: 'orkmind.company-brain-assertion/v1', source });

/** Brain falso: seleção por ids e `get`, com entidades do portfólio e afirmações; anota cada operação. */
function brainFalso(p: ProjetoDeTeste, opcoes: { fatos?: any[]; retidos?: string[]; chamadas?: string[]; fora?: boolean } = {}): BrainTransport {
  const tenant = p.carregado.manifesto.memory.tenant;
  const porId = new Map<string, any>([...portfolioEntities(readPortfolio(p.dir), { tenant, instance: INSTANCIA, thread: '', aclRef: 'ork-factory' }),
    ...(opcoes.fatos ?? [])].map(e => [e.id, e]));
  const retidos = opcoes.retidos ?? [];
  return request => {
    opcoes.chamadas?.push(request.operation);
    if (opcoes.fora) return { schema: BRAIN_API, state: 'unavailable', error: 'brain.transport.unavailable' };
    const payload = request.payload as any;
    if (request.operation === 'query') {
      const items = (payload.facets.ids as string[]).filter(id => porId.has(id) || retidos.includes(id))
        .map(id => retidos.includes(id) ? { state: 'withheld' } : { state: 'ok', entity: porId.get(id) });
      return { schema: BRAIN_API, state: items.length ? 'ok' : 'empty', items, count: items.length };
    }
    if (request.operation === 'get') {
      if (retidos.includes(payload.id)) return { schema: BRAIN_API, state: 'withheld' };
      return porId.has(payload.id) ? { schema: BRAIN_API, state: 'ok', entity: porId.get(payload.id) } : { schema: BRAIN_API, state: 'unknown' };
    }
    return { schema: BRAIN_API, state: 'unavailable', error: 'brain.test.unexpected' };
  };
}
const lacunasDe = (d: Dossie, id: string) => d.lacunas.filter(l => l.id === id).map(l => l.codigo);
const semHorario = (d: Dossie) => { const { consultadoEm: _c, digest: _d, contexto, ...resto } = d; return { ...resto, contexto: contexto?.digest ?? null }; };

test('S1 o dossiê traz schema, vínculo nos campos do cycle do Brain, contexto, decisões, lacunas e digest', () => {
  const p = montar('dossie-s1');
  try {
    const id = thread(p, 'Dossiê S1');
    vincular(p, id, 'proj-alpha-core', ['init-alpha-one']);
    decidir(p, id);
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p));
    assert.equal(d.schema, DOSSIE_SCHEMA);
    assert.equal(d.state, 'ok');
    for (const campo of ['vinculo', 'contexto', 'decisoes', 'lacunas', 'digest']) assert.ok(Object.hasOwn(d, campo), campo);
    assert.deepEqual(Object.keys(d.vinculo.brain).sort(), ['initiative_ids', 'objective_id', 'project_id', 'thread_id']);
    assert.deepEqual(d.vinculo.brain, { thread_id: id, objective_id: null, project_id: 'proj-alpha-core', initiative_ids: ['init-alpha-one'] });
    assert.equal(d.decisoes.length, 1);
    assert.match(String(d.digest), /^[a-f0-9]{64}$/);
  } finally { p.limpar(); }
});

test('S2 o objetivo vem do ticket ou da lista de threads, o projeto do escopo vinculado ou do objetivo, e o que falta vira lacuna', () => {
  const p = montar('dossie-s2');
  try {
    // Sem objetivo e sem projeto: duas lacunas e nenhum contexto.
    const solta = thread(p, 'Dossiê solto');
    const nada = buildDossie(p.carregado, solta, undefined, brainFalso(p));
    assert.equal(nada.vinculo.objetivo, null); assert.equal(nada.vinculo.projeto, null); assert.equal(nada.contexto, null);
    assert.deepEqual(lacunasDe(nada, solta), ['objetivo.ausente', 'projeto.ausente']);

    // O ticket do K1: a thread nasce com creationOrigin e o objetivo traz o portfolio.
    const actor: CreationActor = { principal: 'fixture', authorize: () => {} };
    const op = startCreation(p.carregado, actor, { key: 'dossie-ticket-001', action: 'open_ticket', entityId: 'proj-alpha-core',
      expectedEntityVersion: 1, request: 'Revisar o núcleo', doneWhen: ['revisado'], workspaceIds: ['fixture'], mode: 'auto' });
    const ticket = op.reserved.ticketId!, doTicket = op.reserved.threadIds[0];
    const d = buildDossie(p.carregado, doTicket, undefined, brainFalso(p));
    assert.equal(d.vinculo.objetivo?.id, ticket); assert.equal(d.vinculo.objetivo?.origem, 'ticket');
    assert.deepEqual(d.vinculo.projeto, { productId: 'prod-alpha', projectId: 'proj-alpha-core', initiativeIds: [], origem: 'objetivo' });
    assert.deepEqual(d.vinculo.brain, { thread_id: doTicket, objective_id: ticket, project_id: 'proj-alpha-core', initiative_ids: [] });
    assert.deepEqual(lacunasDe(d, doTicket), []);
    assert.equal(d.contexto?.schema, 'ork.brain-context/v1');

    // Escopo vinculado vale antes do objetivo; se discordar, a diferença aparece.
    vincular(p, doTicket, 'proj-alpha-side', []);
    const divergente = buildDossie(p.carregado, doTicket, undefined, brainFalso(p));
    assert.equal(divergente.vinculo.projeto?.origem, 'escopo-vinculado'); assert.equal(divergente.vinculo.projeto?.projectId, 'proj-alpha-side');
    assert.deepEqual(lacunasDe(divergente, doTicket), ['vinculo.divergente']);

    // Thread sem creationOrigin, listada no objetivo: vínculo pela lista de threads.
    const listada = thread(p, 'Dossiê listado');
    const arquivo = path.join(dirEstado(p.dir), 'objectives', ticket, 'objective.json');
    const objetivo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    objetivo.threads.push({ id: listada, role: 'validation' });
    fs.writeFileSync(arquivo, JSON.stringify(objetivo, null, 2));
    const pelaLista = buildDossie(p.carregado, listada, undefined, brainFalso(p));
    assert.equal(pelaLista.vinculo.objetivo?.origem, 'lista-de-threads'); assert.equal(pelaLista.vinculo.projeto?.origem, 'objetivo');
    // Título e estado ficam fora do envelope com hash: sem eles, o campo sai vazio e o digest se refaz pela saída.
    delete objetivo.title; delete objetivo.status;
    fs.writeFileSync(arquivo, JSON.stringify(objetivo, null, 2));
    const semTitulo = buildDossie(p.carregado, listada, undefined, brainFalso(p));
    assert.equal(semTitulo.vinculo.objetivo?.titulo, ''); assert.equal(semTitulo.vinculo.objetivo?.estado, '');
    assert.equal(digest(semHorario(JSON.parse(JSON.stringify(semTitulo)))), semTitulo.digest);

    // Escopo gravado fora do formato do bind é recusado, como no `ork brain context`.
    fs.writeFileSync(path.join(dirThread(p.dir, solta), 'brain-scope.json'), JSON.stringify({ schema: 'outro', thread: solta }));
    assert.throws(() => buildDossie(p.carregado, solta, undefined, brainFalso(p)), /brain\.scope\.invalid/);
  } finally { p.limpar(); }
});

test('S3 o contexto é o pacote do buildContext para o projeto vinculado e o digest do dossiê cobre o digest dele', () => {
  const p = montar('dossie-s3');
  try {
    const id = thread(p, 'Dossiê S3');
    vincular(p, id, 'proj-alpha-core', ['init-alpha-one']);
    decidir(p, id);
    const brain = brainFalso(p);
    const d = buildDossie(p.carregado, id, undefined, brain);
    const pacote = buildContext(p.carregado, ['proj-alpha-core', 'init-alpha-one'], brain, id);
    assert.equal(d.contexto?.digest, pacote.digest);
    assert.deepEqual(d.contexto?.itens.map(i => i.id), ['prod-alpha', 'proj-alpha-core', 'init-alpha-one']);
    assert.equal(d.digest, digest(semHorario(d)));
    assert.equal(d.digest, digest(semHorario(JSON.parse(JSON.stringify(d)))), 'o digest se refaz a partir do JSON publicado');
    // Outro Brain, outro contexto: o digest do dossiê muda junto.
    const entidade = portfolioEntities(readPortfolio(p.dir), { tenant: p.carregado.manifesto.memory.tenant, instance: INSTANCIA, thread: '', aclRef: 'ork-factory' })
      .find(e => e.id === 'init-alpha-one')!;
    const outro = buildDossie(p.carregado, id, undefined, brainFalso(p, { fatos: [{ ...entidade, source: { ...entidade.source, source_hash: 'f'.repeat(64) } }] }));
    assert.notEqual(outro.contexto?.digest, d.contexto?.digest);
    assert.notEqual(outro.digest, d.digest);
  } finally { p.limpar(); }
});

test('S4 cada decisão traz a citação inteira da linha e os ids fact- e event- que readCycle gera para ela', () => {
  const p = montar('dossie-s4');
  try {
    const id = thread(p, 'Dossiê S4');
    const { evento } = decidir(p, id);
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p));
    const item = d.decisoes[0] as any;
    const linhas = fs.readFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'), 'utf8').split('\n');
    const n = linhas.findIndex(l => l.includes(String(evento.eventId))) + 1;
    // Derivação independente, a mesma conferida ao vivo contra o Brain de produção.
    assert.equal(item.brain.assertion_id, 'fact-' + digest([INSTANCIA, id, evento.eventId]));
    assert.equal(item.brain.event_id, 'event-' + digest([INSTANCIA, evento.eventId]));
    assert.equal(item.brain.source_event_id, evento.eventId);
    assert.deepEqual(item.citacao, { instance: INSTANCIA, source_ref: `threads/${id}/ledger.jsonl#L${n}`,
      source_hash: createHash('sha256').update(linhas[n - 1]).digest('hex'), source_version: n, location: `line:${n}` });
    const capturado = fatosDaThread(p, id).find(e => e.source_event_id === evento.eventId)!;
    assert.equal(item.brain.assertion_id, capturado.aggregate_id);
    assert.equal(item.brain.event_id, capturado.id);
    assert.equal(item.citacao.source_hash, capturado.source.source_hash);
  } finally { p.limpar(); }
});

test('S4 linha que o contrato do Brain não representa vira citacao.incompleta e não derruba o dossiê', () => {
  const p = montar('dossie-s4-contrato');
  try {
    const id = thread(p, 'Dossiê S4 contrato');
    // Horário com nanossegundos, como em ledgers escritos à mão antes do contrato: a captura recusa a linha.
    const n = linhaCrua(p, id, { ts: '2026-09-06T02:16:12.289794251Z', tipo: 'autonomous_decision', fase: 'GO',
      decisao: 'HORARIO-FORA-DO-CONTRATO', autorizadoPor: '#TAG #Auto', evidencia: 'fixture SIMULADA', eventId: randomUUID() });
    assert.throws(() => fatosDaThread(p, id), /brain\.contract\.invalid/);
    const { pedido } = decidir(p, id);
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p));
    assert.equal(d.state, 'ok');
    assert.deepEqual(d.decisoes.map(x => x.id), [pedido.id]);
    assert.equal((d.decisoes[0] as any).citacao.source_ref, `threads/${id}/ledger.jsonl#L${n + 1}`);
    assert.deepEqual(lacunasDe(d, `threads/${id}/ledger.jsonl#L${n}`), ['citacao.incompleta']);
    assert.ok(!JSON.stringify(d).includes('HORARIO-FORA-DO-CONTRATO'));
    // Uma segunda linha fora do contrato depois da decisão: a bisseção isola as duas.
    const m = linhaCrua(p, id, { ts: '2026-09-07T21:59:46.446520+00:00', tipo: 'autonomous_decision', fase: 'GO', decisao: 'outra', autorizadoPor: '#TAG',
      evidencia: 'x', eventId: randomUUID() });
    const duas = buildDossie(p.carregado, id, undefined, brainFalso(p));
    assert.deepEqual(duas.decisoes.map(x => x.id), [pedido.id]);
    assert.deepEqual(lacunasDe(duas, `threads/${id}/ledger.jsonl#L${m}`), ['citacao.incompleta']);
    // Linha corrompida não é degradação: o dossiê recusa, como a captura.
    fs.appendFileSync(path.join(dirThread(p.dir, id), 'ledger.jsonl'), '{"tipo":"human_gate","pedidoId\n');
    assert.throws(() => buildDossie(p.carregado, id, undefined, brainFalso(p)), /brain\.source\.corrupt/);
  } finally { p.limpar(); }
});

test('S5 a decisão informada sai com os campos do registro, autoria autônoma, reversão e a lacuna das alternativas', () => {
  const p = montar('dossie-s5');
  try {
    const id = thread(p, 'Dossiê S5');
    const primeira = decidir(p, id).pedido;
    const segunda = decidir(p, id, { decidido: 'Voltar ao get por id', reverte: primeira.id }).pedido;
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p));
    const [a, b] = d.decisoes as any[];
    assert.equal(a.id, primeira.id); assert.equal(a.classe, 'decidido'); assert.equal(a.autoria, 'autonoma');
    assert.equal(a.decidido, 'Consultar o Brain num lote só'); assert.equal(a.porque, 'uma seleção cobre a thread inteira');
    assert.equal(a.comoMudar, 'trocar o lote por get'); assert.deepEqual(a.custoDeReverter, { agora: 'uma função', depois: 'uma função' });
    assert.deepEqual(a.criterio, { tipo: 'medicao', referencia: 'node --version' });
    assert.equal(a.quemDecidiu, 'sessão SIMULADA de GO'); assert.equal(a.evidencia, 'fixture SIMULADA'); assert.equal(a.razao, 'medido no teste');
    assert.equal(a.revertidaPor, segunda.id); assert.equal(a.reverte, null);
    assert.equal(b.reverte, primeira.id); assert.equal(b.revertidaPor, null);
    for (const x of [a, b]) assert.ok(lacunasDe(d, x.id).includes('alternativas.nao-registradas'));
    // A relação é conteúdo da decisão que desfaz: retida ela, a desfeita não diz quem a desfez.
    const fatoDaSegunda = fatosDaThread(p, id).find(e => e.source_event_id === lerLedger(dirThread(p.dir, id))
      .find(x => (x.pedido as { id?: string } | undefined)?.id === segunda.id)!.eventId)!;
    const comRetida = buildDossie(p.carregado, id, primeira.id, brainFalso(p, { retidos: [fatoDaSegunda.aggregate_id] }));
    assert.equal((comRetida.decisoes[0] as any).revertidaPor, null);
    assert.ok(!JSON.stringify(comRetida).includes(segunda.id));
  } finally { p.limpar(); }
});

test('S6 a resposta do dono só é conteúdo com o recibo conferido; sem prova ou sem resposta, vira lacuna', () => {
  const p = montar('dossie-s6');
  try {
    const { id, pedido } = perguntar(p, 'Dossiê S6');
    responder(p, id, pedido);
    const provada = comIngressoSimulado(() => buildDossie(p.carregado, id, undefined, brainFalso(p)));
    const item = provada.decisoes.find(x => x.id === pedido.id) as any;
    assert.equal(item.classe, 'pergunta'); assert.equal(item.estado, 'decidida'); assert.equal(item.autoria, 'dono');
    assert.ok(item.alternativas.length >= 2);
    if (item.contrato === 'ork.hitl/v2') assert.equal(item.alternativas.filter((x: any) => x.recomendada).length, 1);
    assert.equal(item.resposta.opcao, 1); assert.equal(item.resposta.texto, item.alternativas[0].texto);
    assert.equal(item.resposta.quem, 'telegram:42'); assert.equal(item.resposta.origem, 'telegram'); assert.equal(item.resposta.canal, 'hermes');
    assert.equal(item.resposta.veredito, 'aprovado'); assert.match(item.resposta.recibo, /^[a-f0-9]{64}$/);
    assert.match(item.resposta.brain.assertion_id, /^fact-[a-f0-9]{64}$/);
    assert.deepEqual(lacunasDe(provada, pedido.id), []);
    assert.equal(item.prazo, (pedido as { prazo: string }).prazo);
    // Resposta retida pelo Brain: nem a escolha nem a autoria saem da linha local.
    const gate = fatosDaThread(p, id).find(e => (e.payload as any)?.predicate === 'human_gate')!;
    const retida = comIngressoSimulado(() => buildDossie(p.carregado, id, pedido.id, brainFalso(p, { retidos: [gate.aggregate_id] })));
    const escondida = retida.decisoes[0] as any;
    assert.equal(escondida.estado, 'retida'); assert.equal(escondida.autoria, null);
    assert.deepEqual(escondida.resposta, { id: gate.aggregate_id, frescor: 'retido' });
    assert.ok(!JSON.stringify(retida).includes('telegram:42'));

    // Sem a chave do canal, o mesmo recibo não se prova: a resposta sai do conteúdo.
    const semChave = buildDossie(p.carregado, id, undefined, brainFalso(p));
    const cego = semChave.decisoes.find(x => x.id === pedido.id) as any;
    assert.equal(cego.estado, 'sem-prova'); assert.equal(cego.resposta, null); assert.equal(cego.autoria, null);
    assert.deepEqual(lacunasDe(semChave, pedido.id), ['resposta.sem-prova']);
    assert.ok(!JSON.stringify(semChave).includes('telegram:42'));

    // Recibo adulterado no ledger, com a chave presente: também não se prova.
    const ledger = path.join(dirThread(p.dir, id), 'ledger.jsonl');
    const original = fs.readFileSync(ledger, 'utf8');
    fs.writeFileSync(ledger, original.split('\n').map(l => l.includes('"human_gate"') && l.includes(pedido.id)
      ? JSON.stringify({ ...JSON.parse(l), recibo: 'a'.repeat(64) }) : l).join('\n'));
    const adulterada = comIngressoSimulado(() => buildDossie(p.carregado, id, undefined, brainFalso(p)));
    assert.equal((adulterada.decisoes.find(x => x.id === pedido.id) as any).estado, 'sem-prova');
    fs.writeFileSync(ledger, original);

    // Recusar com recibo válido também é decisão do dono: a prova vale para qualquer veredito.
    const recusada = perguntar(p, 'Dossiê S6 recusada');
    responder(p, recusada.id, recusada.pedido, '2');
    const r = comIngressoSimulado(() => buildDossie(p.carregado, recusada.id, undefined, brainFalso(p)));
    const rec = r.decisoes.find(x => x.id === recusada.pedido.id) as any;
    assert.equal(rec.estado, 'decidida'); assert.equal(rec.resposta.veredito, 'recusado'); assert.equal(rec.resposta.opcao, 2);
    const gateRecusado = lerLedger(dirThread(p.dir, recusada.id)).find(e => e.tipo === 'human_gate')!;
    assert.equal(comIngressoSimulado(() => aprovacaoHumanaProvada(p.dir, recusada.id, gateRecusado)), false, 'a prova de aprovação não serviria aqui');

    // Pergunta aberta, sem resposta: aguardando o dono.
    const aberta = perguntar(p, 'Dossiê S6 aberta');
    const espera = buildDossie(p.carregado, aberta.id, undefined, brainFalso(p));
    const pendente = espera.decisoes.find(x => x.id === aberta.pedido.id) as any;
    assert.equal(pendente.estado, 'aguardando'); assert.equal(pendente.resposta, null);
    assert.deepEqual(lacunasDe(espera, aberta.pedido.id), ['resposta.pendente']);
  } finally { p.limpar(); }
});

test('S6 a resposta pelo MCP local se prova pelo recibo local, sem chave de canal no ambiente', async () => {
  const p = montar('dossie-s6-local');
  try {
    const { id, pedido } = perguntar(p, 'Dossiê S6 local');
    const ingresso = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'conn-dossie' }, async () => ({ action: 'accept', content: { opcao: '1' } }));
    await ingresso.solicitar(id, pedido.id);
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p));
    const item = d.decisoes.find(x => x.id === pedido.id) as any;
    assert.equal(item.estado, 'decidida'); assert.equal(item.autoria, 'dono');
    assert.equal(item.resposta.origem, 'mcp-local'); assert.equal(item.resposta.quem, 'mcp-local:codex');
  } finally { p.limpar(); }
});

test('S7 decisão anterior ao contrato sai marcada como legado; human_decision nunca vira conteúdo', () => {
  const p = montar('dossie-s7');
  try {
    const id = thread(p, 'Dossiê S7');
    const eventId = randomUUID();
    linhaCrua(p, id, { tipo: 'autonomous_decision', fase: 'GOAL', decisao: 'bloco segue sem pausa', autorizadoPor: '#TAG #Auto',
      evidencia: 'prompt sha256 SIMULADO', eventId });
    const n = linhaCrua(p, id, { tipo: 'human_decision', quem: 'Dono', origem: 'mensagem nesta conversa', texto: 'RELATO-SEM-RECIBO' });
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p));
    const legado = d.decisoes[0] as any;
    assert.equal(d.decisoes.length, 1);
    assert.equal(legado.classe, 'legado'); assert.equal(legado.contrato, 'legado'); assert.equal(legado.autoria, 'autonoma');
    assert.equal(legado.id, 'fact-' + digest([INSTANCIA, id, eventId]));
    assert.equal(legado.decidido, 'bloco segue sem pausa'); assert.equal(legado.quemDecidiu, '#TAG #Auto');
    assert.equal(legado.evidencia, 'prompt sha256 SIMULADO'); assert.equal(legado.razao, null); assert.equal(legado.rastroCompleto, false);
    assert.deepEqual(lacunasDe(d, legado.id).filter(c => !c.startsWith('brain.')), ['alternativas.nao-registradas', 'decisao.fora-do-contrato']);
    assert.deepEqual(lacunasDe(d, `threads/${id}/ledger.jsonl#L${n}`), ['decisao.humana-sem-ingresso']);
    assert.ok(!JSON.stringify(d).includes('RELATO-SEM-RECIBO'));
  } finally { p.limpar(); }
});

test('S8 frescor de cada fato contra o Brain, retido sem conteúdo, e Brain indisponível fecha o dossiê', () => {
  const p = montar('dossie-s8');
  try {
    const id = thread(p, 'Dossiê S8');
    const registros = ['confere', 'diverge', 'falta', 'retida'].map(nome => decidir(p, id, { decidido: `decisão ${nome}` }));
    const capturados = fatosDaThread(p, id);
    const [confere, diverge, falta, retida] = registros.map(r => capturados.find(e => e.source_event_id === r.evento.eventId)!);
    const pedidos = registros.map(r => r.pedido.id);
    const chamadas: string[] = [];
    const d = buildDossie(p.carregado, id, undefined, brainFalso(p, { chamadas,
      fatos: [assercao(confere), assercao(diverge, { ...diverge.source, source_hash: 'e'.repeat(64) })], retidos: [retida.aggregate_id] }));
    const por = (pedido: string) => d.decisoes.find(x => x.id === pedido) as any;
    assert.equal(por(pedidos[0]).frescor, 'confere');
    assert.equal(por(pedidos[1]).frescor, 'divergente'); assert.deepEqual(lacunasDe(d, diverge.aggregate_id), ['fonte.divergente']);
    assert.equal(por(pedidos[2]).frescor, 'ausente-no-brain'); assert.deepEqual(lacunasDe(d, falta.aggregate_id), ['brain.ausente']);
    // BR-030-05: só o id do fato no Brain e o frescor; nem a classe nem o id do pedido saem da linha local.
    assert.deepEqual(d.decisoes.find(x => x.id === retida.aggregate_id), { id: retida.aggregate_id, frescor: 'retido' });
    assert.equal(por(pedidos[3]), undefined);
    assert.deepEqual(lacunasDe(d, retida.aggregate_id), ['brain.retido']);
    assert.ok(!JSON.stringify(d).includes('decisão retida'));
    // Caso misto (um retido, um ausente): só aí o `get` diz qual id é qual.
    assert.ok(chamadas.includes('get'));

    // Seleção com estado que não é ok nem empty também fecha: sem estado conhecido, nada local vira conteúdo.
    const estranho: BrainTransport = () => ({ schema: BRAIN_API, state: 'withheld' });
    const recusada = buildDossie(p.carregado, id, undefined, estranho);
    assert.equal(recusada.state, 'withheld'); assert.deepEqual(recusada.decisoes, []); assert.equal(recusada.digest, null);
    const fora = buildDossie(p.carregado, id, undefined, brainFalso(p, { fora: true }));
    assert.equal(fora.state, 'unavailable'); assert.equal(fora.error, 'brain.transport.unavailable');
    assert.deepEqual(fora.decisoes, []); assert.deepEqual(fora.lacunas, []); assert.equal(fora.digest, null);
    // Com projeto vinculado, a falha já vem do contexto e fecha do mesmo jeito.
    vincular(p, id, 'proj-alpha-core', []);
    const semContexto = buildDossie(p.carregado, id, undefined, brainFalso(p, { fora: true }));
    assert.equal(semContexto.state, 'unavailable'); assert.equal(semContexto.contexto, null); assert.deepEqual(semContexto.decisoes, []);
  } finally { p.limpar(); }
});

test('S9 o filtro aceita o id do pedido ou o fact-, desconhecido vira lacuna, inválido é recusado e o digest é reproduzível', () => {
  const p = montar('dossie-s9');
  try {
    const id = thread(p, 'Dossiê S9');
    const alvo = decidir(p, id).pedido.id;
    decidir(p, id, { decidido: 'outra decisão' });
    const brain = brainFalso(p);
    const pelo = buildDossie(p.carregado, id, alvo, brain);
    assert.deepEqual(pelo.decisoes.map(x => x.id), [alvo]); assert.equal(pelo.decisao, alvo);
    const fato = (pelo.decisoes[0] as any).brain.assertion_id;
    assert.deepEqual(buildDossie(p.carregado, id, fato, brain).decisoes.map(x => x.id), [alvo]);
    const desconhecida = randomUUID();
    const vazio = buildDossie(p.carregado, id, desconhecida, brain);
    assert.equal(vazio.state, 'empty'); assert.deepEqual(vazio.decisoes, []);
    assert.deepEqual(lacunasDe(vazio, desconhecida), ['decisao.desconhecida']);
    for (const invalido of ['', 'xyz', 'fact-123', '../ledger']) assert.throws(() => buildDossie(p.carregado, id, invalido, brain), /brain\.dossie\.decisao-invalida/);
    const antes = buildDossie(p.carregado, id, undefined, brain), depois = buildDossie(p.carregado, id, undefined, brain);
    assert.equal(antes.digest, depois.digest);
    decidir(p, id, { decidido: 'terceira decisão' });
    assert.notEqual(buildDossie(p.carregado, id, undefined, brain).digest, antes.digest);
  } finally { p.limpar(); }
});

test('S10 ork brain dossie é somente leitura: só query no transporte, ativação desligada, nada gravado e opção fora da lista recusada', () => {
  const p = montar('dossie-s10');
  try {
    const id = thread(p, 'Dossiê S10');
    vincular(p, id, 'proj-alpha-core', []);
    decidir(p, id);
    const dir = dirThread(p.dir, id);
    const retrato = () => (fs.readdirSync(dir, { recursive: true }) as string[]).sort().map(f => {
      const alvo = path.join(dir, f);
      return fs.statSync(alvo).isFile() ? `${f}:${createHash('sha256').update(fs.readFileSync(alvo)).digest('hex')}` : f;
    });
    const antes = retrato(), chamadas: string[] = [];
    const d = runBrain(p.carregado, 'dossie', { thread: id, json: true }, [], brainFalso(p, { chamadas }));
    assert.equal(d.schema, DOSSIE_SCHEMA); assert.equal(d.state, 'ok');
    assert.deepEqual([...new Set(chamadas)], ['query']);
    assert.deepEqual(retrato(), antes);
    // Ativação de escrita desligada: a escrita do `ork brain` recusa, a leitura do dossiê responde.
    assert.throws(() => runBrain(p.carregado, 'sync', { thread: id }, [], brainFalso(p)));
    assert.equal(runBrain(p.carregado, 'dossie', { thread: id, decisao: d.decisoes[0].id }, [], brainFalso(p)).decisoes.length, 1);
    for (const opcao of ['principal', 'dsn', 'raiz'])
      assert.throws(() => runBrain(p.carregado, 'dossie', { thread: id, [opcao]: 'x' }, [], brainFalso(p)), /brain\.argument\.invalid/);
    assert.throws(() => runBrain(p.carregado, 'dossie', {}, [], brainFalso(p)), /brain\.thread\.required/);
    // `--decisao` sem valor (o parser devolve true) ou vazio é recusado, não vira a thread inteira.
    for (const decisao of [true, '']) assert.throws(() => runBrain(p.carregado, 'dossie', { thread: id, decisao }, [], brainFalso(p)), /brain\.dossie\.decisao-invalida/);
    // O caminho do recibo lê .orkastery/private e hitl-ingress: o estado inteiro fica igual.
    const { id: perguntada, pedido } = perguntar(p, 'Dossiê S10 perguntada');
    responder(p, perguntada, pedido);
    const estado = path.join(p.dir, '.orkastery');
    const tudo = () => (fs.readdirSync(estado, { recursive: true }) as string[]).sort().map(f => {
      const alvo = path.join(estado, f);
      return fs.lstatSync(alvo).isFile() ? `${f}:${createHash('sha256').update(fs.readFileSync(alvo)).digest('hex')}` : f;
    });
    const antesDoRecibo = tudo();
    const lida = comIngressoSimulado(() => runBrain(p.carregado, 'dossie', { thread: perguntada }, [], brainFalso(p)));
    assert.equal((lida.decisoes.find((x: any) => x.id === pedido.id) as any).estado, 'decidida');
    assert.deepEqual(tudo(), antesDoRecibo);
  } finally { p.limpar(); }
});

/** `ork ship`: a loop category not scanned for the candidate SHA is a `human.pending` gate (spec section 11.2). */

import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { lerLedger, registrar } from '../src/ledger';
import type { ManifestoCarregado } from '../src/manifest';
import { raizDoEstado } from '../src/estado-thread';
import { writeReport } from '../src/security-scan/report';
import type { Category, ScanReport, ToolRun, ToolState } from '../src/security-scan/types';
import { ship, unscannedCategories } from '../src/ship';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { gravarBaseline, verificar } from '../src/verify';
import { exec } from '../src/util';
import { commitar, projetoTemporario, ProjetoDeTeste, shaDaBranch, shaNoRemotoDeTeste } from './apoio';
import { abrirPedidoGate, assinaturaDaResposta, responderGate, registrarPedidoHitl } from '../src/hitl-gates';
import { ehV2 } from '../src/hitl-contract';
import { ENV_HITL_VERIFIERS, publicHitlVerifiers } from '../src/hitl-public-receipt';

const CHAVE_HITL = 'chave-simulada-security-scan-ship-000';
const OUTRA_CHAVE_HITL = 'outra-chave-simulada-security-scan-ship';

/** The declared command is `true`: the ship runs verify first, and only the key matters to the gate. */
function comScan(p: ProjetoDeTeste, opts: { chave?: boolean; exigeCi?: boolean }): ManifestoCarregado {
  const b = p.carregado;
  return { ...b, manifesto: { ...b.manifesto,
    verify: { ...b.manifesto.verify, ...(opts.chave === false ? {} : { security_scan: 'true' }) },
    ci: { ...b.manifesto.ci, required_for_ship: opts.exigeCi === true } } };
}

const counts = (): ToolRun['counts'] => {
  const sev = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  return { new: sev(), existing: sev(), dismissed: sev() };
};
const run = (name: string, category: Category, state: ToolState, reason?: string): ToolRun =>
  ({ name, category, version: '1', executor: state === 'unavailable' ? null : 'docker', state, ...(reason ? { reason } : {}), counts: counts() });

function gravar(p: ProjetoDeTeste, head: string, tools: ToolRun[]): void {
  const report: ScanReport = { schema: 'ork.security-scan/v1', base: head, head, generatedAt: '2026-10-19T00:00:00.000Z',
    stacks: [], tools, excluded: [], findings: [] };
  writeReport(raizDoEstado(p.dir), report);
}

function entrega(p: ProjetoDeTeste) {
  const { thread } = novaThread(p.carregado, { nome: 'scan gate', modo: 'auto', criarWorktree: true });
  const sha = commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
  return { thread, sha };
}

function comFalhaSemRelatorio(p: ProjetoDeTeste): ManifestoCarregado {
  const b = p.carregado;
  return { ...b, manifesto: { ...b.manifesto, check: { ...b.manifesto.check, mode: 'classic' },
    verify: { test: 'true', security_scan: 'false' }, ci: { ...b.manifesto.ci, required_for_ship: false } } };
}

function ambienteHitlSimulado() {
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', ENV_HITL_VERIFIERS];
  const antigos = nomes.map(nome => process.env[nome]);
  process.env.ORK_HITL_INGRESS_KEY = CHAVE_HITL;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  return () => nomes.forEach((nome, i) => antigos[i] === undefined ? delete process.env[nome] : process.env[nome] = antigos[i]);
}

function abrirPedidoSemScan(p: ProjetoDeTeste, thread: string, fase: string, sha: string, categorias: string[]) {
  const dir = dirThread(p.dir, thread);
  registrar(dir, thread, 'verify_run', { motivos: ['security.scan-unscanned'], veredito: 'reprovado' });
  registrar(dir, thread, 'gate_blocked', { gate: 'verify', motivo: 'security.scan-unscanned',
    detalhe: `security_scan sem cobertura: comando \`scan\`; categorias: ${[...categorias].sort().join(', ')}`,
    evidencia: `reexecucao no HEAD ${sha}`, fase });
  return abrirPedidoGate(p.dir, thread, 'security.scan-unscanned', new Date().toISOString());
}

function repetirPedido(p: ProjetoDeTeste, pedido: ReturnType<typeof abrirPedidoGate>) {
  assert.ok(ehV2(pedido) && pedido.classe === 'pergunta');
  return registrarPedidoHitl(p.dir, { ...pedido, id: randomUUID(), codigo: 'Z9Y8',
    criadoEm: new Date(Date.parse(pedido.criadoEm) + 1).toISOString(),
    prazo: new Date(Date.parse(pedido.prazo) + 1).toISOString() });
}

function responder(p: ProjetoDeTeste, thread: string, pedido: ReturnType<typeof abrirPedidoGate>, letra: 'a' | 'b', mensagem: string) {
  const recebidoEm = new Date().toISOString();
  const base = { resposta: letra, origem: 'telegram' as const, por: 'telegram:42', mensagem, recebidoEm };
  responderGate(p.dir, thread, pedido.id, { ...base,
    prova: assinaturaDaResposta(thread, pedido.id, base, process.env.ORK_HITL_INGRESS_KEY!) }, recebidoEm);
}

type CenarioDaRodada = 'achado-depois-de-baseline-sem-cobertura' | 'achado-e-cobertura-sem-baseline' |
  'cobertura-depois-de-baseline-verde' | 'cobertura-sem-baseline';

/** O comando grava o relatório durante cada execução, no SHA e no estado reais da fixture. */
function comScanDaRodada(p: ProjetoDeTeste, cenario: CenarioDaRodada): ManifestoCarregado {
  const script = path.join(p.dir, `scan-${cenario}.cjs`);
  const contador = path.join(p.dir, `scan-${cenario}.contador`);
  const report = path.resolve(__dirname, '../src/security-scan/report.js');
  const estado = path.resolve(__dirname, '../src/estado-thread.js');
  fs.writeFileSync(script, `
const fs=require('node:fs'),path=require('node:path');
const [reportModule,estadoModule,raiz,cenario,contador]=process.argv.slice(2);
const {writeReport,exitCodeOf}=require(reportModule),{raizDoEstado}=require(estadoModule);
const rodada=Number(fs.existsSync(contador)?fs.readFileSync(contador,'utf8'):0)+1;
fs.writeFileSync(contador,String(rodada));
const atual=cenario==='achado-e-cobertura-sem-baseline'||cenario==='cobertura-sem-baseline'||rodada>1;
const dotGit=path.resolve('.git');
const gitDir=fs.statSync(dotGit).isDirectory()?dotGit:path.resolve(path.dirname(dotGit),fs.readFileSync(dotGit,'utf8').trim().slice(8));
const commonFile=path.join(gitDir,'commondir');
const commonDir=fs.existsSync(commonFile)?path.resolve(gitDir,fs.readFileSync(commonFile,'utf8').trim()):gitDir;
const headRaw=fs.readFileSync(path.join(gitDir,'HEAD'),'utf8').trim();
const ref=headRaw.startsWith('ref: ')?headRaw.slice(5):null;
const head=ref?fs.readFileSync([path.join(gitDir,ref),path.join(commonDir,ref)].find(fs.existsSync),'utf8').trim():headRaw;
const sev=()=>({critical:0,high:0,medium:0,low:0,info:0});
const tool=(name,category,state)=>({name,category,version:'1',executor:state==='ran'?'docker':null,state,
  ...(state==='ran'?{}:{reason:'docker-missing'}),counts:{new:sev(),existing:sev(),dismissed:sev()}});
const semCobertura=cenario==='achado-depois-de-baseline-sem-cobertura'?!atual:
  cenario==='achado-e-cobertura-sem-baseline'||cenario==='cobertura-sem-baseline'||
    cenario==='cobertura-depois-de-baseline-verde'&&atual;
const achado=atual&&!['cobertura-depois-de-baseline-verde','cobertura-sem-baseline'].includes(cenario);
const tools=[tool('gitleaks','secret','ran'),tool('semgrep','sast',semCobertura?'unavailable':'ran'),
  tool('npm-audit','dependency','ran'),tool('trivy','iac','ran'),tool('zizmor','workflow','ran')];
const findings=achado?[{tool:'gitleaks',rule:'generic-api-key',category:'secret',severity:'critical',file:'entrega.md',line:1,
  message:'achado novo',fingerprint:'f'.repeat(16),status:'new',loop:true}]:[];
const relatorio={schema:'ork.security-scan/v1',base:head,head,generatedAt:new Date().toISOString(),stacks:['js'],tools,excluded:[],findings};
writeReport(raizDoEstado(raiz),relatorio);process.exit(exitCodeOf(relatorio));
`);
  const comando = ['node', JSON.stringify(script), JSON.stringify(report), JSON.stringify(estado), JSON.stringify(p.dir), cenario,
    JSON.stringify(contador)].join(' ');
  const b = p.carregado;
  return { ...b, manifesto: { ...b.manifesto, check: { ...b.manifesto.check, mode: 'classic' },
    verify: { test: 'true', security_scan: comando },
    ci: { ...b.manifesto.ci, required_for_ship: false } } };
}

test('sem a chave, o ship segue como hoje', () => {
  const p = projetoTemporario('ss-ship-sem-chave', true);
  try {
    const { thread } = entrega(p);
    const r = ship(comScan(p, { chave: false }), thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
  } finally { p.limpar(); }
});

test('secret unavailable e required_for_ship false: human.pending e nada empurrado', () => {
  const p = projetoTemporario('ss-ship-pendente', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable'), run('semgrep', 'sast', 'ran')]);
    const remotoAntes = shaNoRemotoDeTeste(p.dir, p.remoto as string, 'main');
    const r = ship(comScan(p, {}), thread.id, { para: 'main' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'human.pending');
    assert.match(r.detalhe, /secret/);
    assert.match(r.correcao ?? '', /abra o pedido com ork gate request .* e o dono responde b/);
    assert.match(r.correcao ?? '', /--allow-unscanned/);
    assert.equal(shaNoRemotoDeTeste(p.dir, p.remoto as string, 'main'), remotoAntes);
    assert.equal(shaDaBranch(p.dir, 'main'), remotoAntes);
  } finally { p.limpar(); }
});

test('com a chave, sem relatorio do SHA: human.pending (sem evidencia nao e limpo)', () => {
  const p = projetoTemporario('ss-ship-sem-relatorio', true);
  try {
    const { thread } = entrega(p);
    const r = ship(comScan(p, {}), thread.id, { para: 'main' });
    assert.equal(r.motivo, 'human.pending');
    assert.match(r.detalhe, /secret/);
    assert.match(r.detalhe, /workflow/);
  } finally { p.limpar(); }
});

test('allowUnscanned entrega e grava ship_unscanned_authorized', () => {
  const p = projetoTemporario('ss-ship-autorizado', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable'), run('npm-audit', 'dependency', 'failed')]);
    const r = ship(comScan(p, {}), thread.id, { para: 'main', allowUnscanned: 'paschoal' });
    assert.equal(r.ok, true, r.detalhe);
    const ev = lerLedger(dirThread(p.dir, thread.id)).find(e => e.tipo === 'ship_unscanned_authorized');
    assert.ok(ev, 'evento gravado');
    assert.equal(ev.por, 'paschoal');
    assert.deepEqual(ev.categorias, ['dependency', 'secret']);
    assert.equal(ev.sha, sha);
  } finally { p.limpar(); }
});

test('linha A: achado novo depois de baseline sem cobertura vira regressao e a autorizacao nao atravessa', () => {
  const p = projetoTemporario('ss-ship-achado-baseline-vermelha', true);
  try {
    const carregado = comScanDaRodada(p, 'achado-depois-de-baseline-sem-cobertura');
    const { thread } = novaThread(carregado, { nome: 'achado novo', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false, JSON.stringify({ r, eventos: lerLedger(dirThread(p.dir, thread.id)) }, null, 2));
    assert.equal(r.motivo, 'verify.regression');

    const eventos = lerLedger(dirThread(p.dir, thread.id));
    const verify = eventos.filter(e => e.tipo === 'verify_run').at(-1)!;
    assert.equal(verify.veredito, 'reprovado');
    assert.deepEqual(verify.motivos, ['verify.regression']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('linha B: achado novo com cobertura ausente e sem baseline continua verify.failed', () => {
  const p = projetoTemporario('ss-ship-achado-sem-baseline', true);
  try {
    const carregado = comScanDaRodada(p, 'achado-e-cobertura-sem-baseline');
    const { thread } = novaThread(carregado, { nome: 'achado sem baseline', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos, ['verify.failed']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('linha C: baseline verde e cobertura ausente permitem somente a autorizacao nominal', () => {
  const p = projetoTemporario('ss-ship-cobertura-baseline-verde', true);
  try {
    const carregado = comScanDaRodada(p, 'cobertura-depois-de-baseline-verde');
    const { thread } = novaThread(carregado, { nome: 'cobertura ausente', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    const sha = commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, true, r.detalhe);
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos, ['security.scan-unscanned']);
    const gate = eventos.find(e => e.tipo === 'gate_blocked' && e.motivo === 'security.scan-unscanned')!;
    assert.equal(gate.fase, undefined, 'o gate genérico do verify preserva o retry anterior');
    assert.match(String(gate.detalhe), new RegExp(carregado.manifesto.verify.security_scan!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(String(gate.detalhe), /categorias: sast/);
    const autorizado = eventos.find(e => e.tipo === 'ship_unscanned_authorized')!;
    assert.equal(autorizado.por, 'responsavel');
    assert.equal(autorizado.sha, sha);
    assert.deepEqual(autorizado.categorias, ['sast']);
  } finally { p.limpar(); }
});

test('linhas D1 e G: falha sem relatório da rodada nunca vira dívida nem atravessa allowUnscanned', () => {
  for (const linha of ['D1', 'G'] as const) {
    const p = projetoTemporario(`ss-ship-${linha.toLowerCase()}`, true);
    try {
      if (linha === 'G') commitar(p.dir, '.ork-security/dismissals.json', '[{"fingerprint":"x"}]\n', 'dispensa inválida na main');
      const carregado = comFalhaSemRelatorio(p);
      const { thread } = novaThread(carregado, { nome: `linha ${linha}`, modo: 'auto', criarWorktree: true });
      gravarBaseline(carregado, thread.id);
      commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
      const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
      assert.equal(r.ok, false, linha);
      assert.equal(r.motivo, 'verify.failed', linha);
      const eventos = lerLedger(dirThread(p.dir, thread.id));
      const rodada = eventos.filter(e => e.tipo === 'verify_run').at(-1)!;
      assert.deepEqual(rodada.motivos, ['verify.failed'], linha);
      assert.deepEqual(rodada.preExistentes, [], linha);
      assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false, linha);
    } finally { p.limpar(); }
  }
});

test('linha F: relatório limpo anterior do mesmo SHA não explica falha da rodada do SHIP', () => {
  const p = projetoTemporario('ss-ship-linha-f', true);
  try {
    const carregado = comFalhaSemRelatorio(p);
    const { thread } = novaThread(carregado, { nome: 'linha F', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    const sha = commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    gravar(p, sha, [run('gitleaks', 'secret', 'ran'), run('semgrep', 'sast', 'ran')]);
    const r = ship(carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const rodada = lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'verify_run').at(-1)!;
    assert.deepEqual(rodada.motivos, ['verify.failed']);
    assert.deepEqual(rodada.preExistentes, []);
  } finally { p.limpar(); }
});

test('gate, pedido, resposta b e SHIP usam a autorização nominal autenticada', () => {
  const p = projetoTemporario('ss-ship-resposta-b', true), restaurar = ambienteHitlSimulado();
  try {
    const carregado = comScanDaRodada(p, 'cobertura-depois-de-baseline-verde');
    const { thread } = novaThread(carregado, { nome: 'resposta b', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    const sha = commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const verificado = verificar(carregado, thread.id);
    assert.deepEqual(verificado.motivos, ['security.scan-unscanned']);
    const quando = new Date().toISOString();
    const pedido = abrirPedidoGate(p.dir, thread.id, 'security.scan-unscanned', quando);
    assert.ok(ehV2(pedido) && pedido.classe === 'pergunta');
    const corpo = pedido.corpo.join('\n');
    assert.match(corpo, /Categorias sem cobertura: sast/);
    assert.match(corpo, new RegExp(`Candidata verificada: ${sha}`));
    assert.doesNotMatch(corpo, /ork ship|--allow-unscanned/);
    const base = { resposta: 'b', origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:scan-b', recebidoEm: quando };
    const resposta = { ...base, prova: assinaturaDaResposta(thread.id, pedido.id, base, process.env.ORK_HITL_INGRESS_KEY!) };
    assert.equal(responderGate(p.dir, thread.id, pedido.id, resposta, quando).estado, 'aguardando');
    process.env[ENV_HITL_VERIFIERS] = publicHitlVerifiers(process.env)!;
    delete process.env.ORK_HITL_INGRESS_KEY;

    const r = ship(carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    const autorizado = lerLedger(dirThread(p.dir, thread.id)).find(e => e.tipo === 'ship_unscanned_authorized')!;
    assert.equal(autorizado.por, 'telegram:42');
    assert.equal(autorizado.pedidoId, pedido.id);
    assert.equal(autorizado.origem, 'resposta-b');
  } finally { restaurar(); p.limpar(); }
});

test('pedido aberto de contexto anterior dá lugar à resposta b do contexto atual no SHIP', () => {
  const p = projetoTemporario('ss-ship-pedido-aberto-antigo', true), restaurar = ambienteHitlSimulado();
  try {
    const carregado = comScanDaRodada(p, 'cobertura-depois-de-baseline-verde');
    const { thread } = novaThread(carregado, { nome: 'pedido aberto anterior', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    assert.deepEqual(verificar(carregado, thread.id).motivos, ['security.scan-unscanned']);
    const anterior = abrirPedidoGate(p.dir, thread.id, 'security.scan-unscanned', new Date().toISOString());
    gravarThread(p.dir, { ...thread, faseAtual: 'CHECK' });
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_dispatch',
      { fase: 'CHECK', sessionId: 'sessao-check-atual', runtime: 'claude-bg' });
    assert.deepEqual(verificar(carregado, thread.id).motivos, ['security.scan-unscanned']);
    const atual = abrirPedidoGate(p.dir, thread.id, 'security.scan-unscanned', new Date().toISOString());
    assert.notEqual(atual.id, anterior.id);
    responder(p, thread.id, atual, 'b', 'telegram:-7:pedido-atual');
    process.env[ENV_HITL_VERIFIERS] = publicHitlVerifiers(process.env)!;
    delete process.env.ORK_HITL_INGRESS_KEY;
    const r = ship(carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).find(e => e.tipo === 'ship_unscanned_authorized')?.pedidoId,
      atual.id);
  } finally { restaurar(); p.limpar(); }
});

for (const cenario of ['b-antiga-depois-a', 'b-antiga-com-pedido-novo-aberto', 'categorias-a-menos', 'outro-sha',
  'sem-recibo', 'recibo-forjado', 'verificador-de-outra-chave', 'b-vencida-por-achado', 'b-vencida-por-verde',
  'b-vencida-por-evidencia'] as const) {
  test(`SHIP recusa resposta b que não corresponde ao pedido atual: ${cenario}`, () => {
    const p = projetoTemporario(`ss-ship-neg-${cenario}`, true), restaurar = ambienteHitlSimulado();
    try {
      const carregado = comScan(p, {}), entregaAtual = entrega(p), { thread } = entregaAtual;
      let sha = entregaAtual.sha;
      const atuais = cenario === 'categorias-a-menos' ? ['dependency'] as Category[] : ['sast'] as Category[];
      gravar(p, sha, atuais.map(categoria => run(categoria === 'dependency' ? 'npm-audit' : 'semgrep', categoria, 'unavailable')));
      const pedidas = cenario === 'categorias-a-menos' ? ['dependency', 'iac', 'sast'] : ['sast'];
      const primeiro = abrirPedidoSemScan(p, thread.id, thread.faseAtual, sha, pedidas);
      if (cenario === 'sem-recibo' || cenario === 'recibo-forjado') {
        registrar(dirThread(p.dir, thread.id), thread.id, 'human_gate', { pedidoId: primeiro.id,
          fase: primeiro.fase, origem: 'telegram', source: 'human', autorizadoPor: 'telegram:42',
          mensagem: `telegram:-7:${cenario}`, recebidoEm: new Date().toISOString(),
          sobre: 'escalacao:security.scan-unscanned', estado: 'aguardando', opcao: 2,
          ...(cenario === 'recibo-forjado' ? { recibo: 'a'.repeat(64) } : {}) });
      } else if (cenario === 'verificador-de-outra-chave') {
        process.env.ORK_HITL_INGRESS_KEY = OUTRA_CHAVE_HITL;
        responder(p, thread.id, primeiro, 'b', `telegram:-7:${cenario}-1`);
        process.env.ORK_HITL_INGRESS_KEY = CHAVE_HITL;
      } else {
        responder(p, thread.id, primeiro, 'b', `telegram:-7:${cenario}-1`);
      }
      if (cenario === 'outro-sha') {
        sha = commitar(thread.worktree as string, 'outra.md', '# outra\n', `feat: ${thread.id} outra candidata`);
        gravar(p, sha, [run('semgrep', 'sast', 'unavailable')]);
      } else if (cenario === 'b-antiga-depois-a' || cenario === 'b-antiga-com-pedido-novo-aberto') {
        const segundo = repetirPedido(p, primeiro);
        if (cenario === 'b-antiga-depois-a') responder(p, thread.id, segundo, 'a', `telegram:-7:${cenario}-2`);
      } else if (cenario === 'b-vencida-por-achado' || cenario === 'b-vencida-por-verde') {
        registrar(dirThread(p.dir, thread.id), thread.id, 'verify_run', {
          motivos: cenario === 'b-vencida-por-achado' ? ['verify.regression'] : [],
          veredito: cenario === 'b-vencida-por-achado' ? 'reprovado' : 'verdade sustentada',
        });
      } else if (cenario === 'b-vencida-por-evidencia') {
        registrar(dirThread(p.dir, thread.id), thread.id, 'verify_run',
          { motivos: ['security.scan-unscanned'], veredito: 'reprovado' });
        registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', {
          gate: 'verify', motivo: 'security.scan-unscanned',
          detalhe: 'security_scan sem cobertura: comando `scan`; categorias: sast, secret',
          evidencia: `reexecucao no HEAD ${sha}`, fase: thread.faseAtual,
        });
        registrar(dirThread(p.dir, thread.id), thread.id, 'verify_run',
          { motivos: ['security.scan-unscanned'], veredito: 'reprovado' });
        registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', {
          gate: 'verify', motivo: 'security.scan-unscanned',
          detalhe: 'security_scan sem cobertura: comando `scan`; categorias: sast',
          evidencia: `reexecucao no HEAD ${sha}`, fase: thread.faseAtual,
        });
      }
      process.env[ENV_HITL_VERIFIERS] = publicHitlVerifiers({ ORK_HITL_INGRESS_KEY: CHAVE_HITL })!;
      delete process.env.ORK_HITL_INGRESS_KEY;
      const r = ship(carregado, thread.id, { para: 'main' });
      assert.equal(r.ok, false);
      assert.equal(r.motivo, 'human.pending');
      assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_unscanned_authorized'), false);
    } finally { restaurar(); p.limpar(); }
  });
}

test('o comentário do SHIP identifica o mock de leases que omite motivos', () => {
  const fonte = fs.readFileSync(path.resolve(__dirname, '../../src/ship.ts'), 'utf8');
  assert.match(fonte, /mock de teste dos leases devolve apenas `\{ ok \}`/);
});

test('allowUnscanned nao atravessa cobertura ausente acompanhada de outro bloqueio', () => {
  const p = projetoTemporario('ss-ship-cobertura-e-falha', true);
  try {
    const comCobertura = comScanDaRodada(p, 'cobertura-sem-baseline');
    const carregado = { ...comCobertura, manifesto: { ...comCobertura.manifesto,
      verify: { ...comCobertura.manifesto.verify, test: 'false' } } };
    const { thread } = novaThread(carregado, { nome: 'cobertura e falha', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos,
      ['verify.failed', 'security.scan-unscanned']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('dispensa invalida sem relatorio da rodada permanece verify.failed e nao aceita allowUnscanned', () => {
  const p = projetoTemporario('ss-ship-dispensa-invalida', true);
  try {
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'chore: manifesto');
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
    const cli = path.resolve(__dirname, '../../dist/index.js');
    const b = p.carregado;
    const carregado = { ...b, manifesto: { ...b.manifesto,
      verify: { test: 'true', security_scan: `node ${JSON.stringify(cli)} security-scan` },
      ci: { ...b.manifesto.ci, required_for_ship: false } } };
    const { thread } = novaThread(carregado, { nome: 'dispensa invalida', modo: 'auto', criarWorktree: true });
    fs.mkdirSync(path.join(thread.worktree as string, '.ork-security'));
    commitar(thread.worktree as string, '.ork-security/dismissals.json', '[{"fingerprint":"x"}]\n', 'chore: dispensa invalida');
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos, ['verify.failed']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('required_for_ship true: sem gate (o scan esta no bundle do CI)', () => {
  const p = projetoTemporario('ss-ship-ci-exigido', true);
  try {
    const { sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable')]);
    assert.deepEqual(unscannedCategories(comScan(p, { exigeCi: true }), sha), []);
  } finally { p.limpar(); }
});

test('unscannedCategories: ordenado, so laco, so unavailable ou failed', () => {
  const p = projetoTemporario('ss-ship-categorias');
  try {
    const sha = 'c'.repeat(40);
    gravar(p, sha, [run('trivy-vuln', 'dependency', 'unavailable'), run('gitleaks', 'secret', 'ran'), run('trivy-license', 'license', 'unavailable'),
      run('zizmor', 'workflow', 'failed'), run('actionlint', 'workflow', 'unavailable')]);
    assert.deepEqual(unscannedCategories(comScan(p, {}), sha), ['dependency', 'workflow']);
    assert.deepEqual(unscannedCategories(comScan(p, { chave: false }), sha), []);
  } finally { p.limpar(); }
});

test('unscannedCategories: unsupported-ci e no-requirements-file (com outra ferramenta da categoria) nao pedem autorizacao', () => {
  const p = projetoTemporario('ss-ship-nada-a-varrer');
  try {
    const sha = 'd'.repeat(40);
    gravar(p, sha, [run('gitleaks', 'secret', 'ran'), run('actionlint', 'workflow', 'unavailable', 'unsupported-ci'),
      run('pip-audit', 'dependency', 'unavailable', 'no-requirements-file'), run('trivy-vuln', 'dependency', 'ran')]);
    assert.deepEqual(unscannedCategories(comScan(p, {}), sha), []);
    const sozinho = 'e'.repeat(40);
    gravar(p, sozinho, [run('gitleaks', 'secret', 'ran'), run('pip-audit', 'dependency', 'unavailable', 'no-requirements-file')]);
    assert.deepEqual(unscannedCategories(comScan(p, {}), sozinho), ['dependency']);
  } finally { p.limpar(); }
});

test('ship com unsupported-ci no relatorio entrega sem pedir --allow-unscanned', () => {
  const p = projetoTemporario('ss-ship-gitlab-ci', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'ran'), run('semgrep', 'sast', 'ran'), run('trivy-vuln', 'dependency', 'ran'),
      run('trivy-config', 'iac', 'ran'), run('actionlint', 'workflow', 'unavailable', 'unsupported-ci')]);
    const r = ship(comScan(p, {}), thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('ship --dry-run --allow-unscanned nao grava ship_unscanned_authorized e diz o que autorizaria', () => {
  const p = projetoTemporario('ss-ship-ensaio', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable')]);
    const r = ship(comScan(p, {}), thread.id, { para: 'main', allowUnscanned: 'paschoal', dryRun: true });
    assert.equal(r.bloqueado, false, r.detalhe);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_unscanned_authorized'), false);
    assert.ok(r.passos.some(x => /paschoal/.test(x) && /secret/.test(x)), r.passos.join(' | '));
  } finally { p.limpar(); }
});

test('CLI: --allow-unscanned sem valor sai 2 e nao entrega', () => {
  const p = projetoTemporario('ss-ship-flag-vazia', true);
  try {
    const { thread } = entrega(p);
    const cli = path.resolve(__dirname, '../../dist/index.js');
    for (const argv of [['--allow-unscanned'], ['--allow-unscanned', '--dry-run'], ['--allow-unscanned=']]) {
      const r = spawnSync(process.execPath, [cli, 'ship', thread.id, '--para', 'main', ...argv],
        { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, LANG: 'C.UTF-8' } });
      assert.equal(r.status, 2, `${argv.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /--allow-unscanned/);
    }
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_done' || e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

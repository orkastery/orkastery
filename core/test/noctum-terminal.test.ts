/**
 * RM-057 (resposta curta, D5 e D6 da ork-rm057respost): o ingresso do terminal do Claude Code.
 *
 * O dono digita "sim", "a" ou "<código> a" numa sessão interativa; o hook `UserPromptSubmit` leva o evento ao núcleo, que
 * confere a ORIGEM da sessão (presença, id, despacho, registro, worktree e ancestralidade) e só então grava o ato do arco,
 * com o recibo do terminal. Provado aqui: o dono autoriza e revoga; a sessão despachada, a sem presença, a do registro de
 * despachos, a de worktree de thread, a de segundo plano, a aninhada, a de id divergente e a do SDK são recusadas, e o
 * "sim" segue ao modelo sem efeito; a palavra solta só vale para a pergunta mostrada nesta sessão; o gate vira contexto.
 *
 * Sessões, ambientes, cadeias de processos, transcrições e arcos SIMULADOS, em diretórios temporários.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { ambienteDoIngresso } from './apoio-pulse';
import { abrirPedidoGate } from '../src/hitl-gates';
import { CONTRATO_ENVELOPE, PedidoDeEfeito } from '../src/noctum-envelope';
import { conferirAntesDoEfeito, lerArco, pedirRevogacao, proporEnvelope } from '../src/noctum-arco';
import { Ancestral, AmbienteDoTerminal, DecisaoDoTerminal, responderPeloTerminal } from '../src/noctum-terminal';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';

const P = '2026-10-13T00:30:00.000Z';
const A = '2026-10-13T00:31:00.000Z';
const DENTRO = '2026-10-13T02:00:00.000Z';
const VENCIDA = '2026-10-13T01:31:00.000Z';
const SESSAO = '11111111-2222-4333-8444-555555555555';
const CLI = path.resolve(__dirname, '../../dist/index.js');

const pedido = (arco: string): Record<string, unknown> => ({
  contrato: CONTRATO_ENVELOPE, arco,
  janela: { inicio: '2026-10-12T22:00:00-03:00', fim: '2026-10-13T06:00:00-03:00', fuso: 'America/Sao_Paulo' },
  destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr'] }],
  orcamento: { arco: { valor: 40, unidade: 'sessoes' }, porConta: [{ conta: 'perfil-a', teto: { valor: 20, unidade: 'sessoes' } }],
    porRuntime: [{ runtime: 'claude-bg', teto: { valor: 30, unidade: 'sessoes' } }] },
  relatorio: { horario: '07:30', canal: 'telegram' },
});
const efeito = (arco: string, envelopeSha256: string): PedidoDeEfeito =>
  ({ arco, envelopeSha256, acao: 'push', repositorio: 'exemplo/produto', branch: 'ork/trabalho' });

/** O ambiente que o Claude Code monta para o hook de uma sessão interativa do dono (SIMULADO). */
const ENV_DO_DONO = { CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: SESSAO, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PID: '4242',
  CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1' };

/** A cadeia de processos do hook de uma sessão interativa: o núcleo, o hook, a sessão e o shell do dono (SIMULADA). */
const cadeia = (sessao: Record<string, string> = { TERM: 'xterm-256color' }, acima: Record<string, string> = { SHELL: '/bin/bash' }) =>
  (): Ancestral[] => [
    { pid: 4300, ppid: 4299, ambiente: { ...ENV_DO_DONO } },
    { pid: 4299, ppid: 4242, ambiente: { ...ENV_DO_DONO } },
    { pid: 4242, ppid: 4000, ambiente: sessao },
    { pid: 4000, ppid: 1, ambiente: acima },
  ];

function cenario(nome: string) {
  const p = projetoTemporario(`tm-${nome}`), restaurar = ambienteDoIngresso();
  const transcricao = path.join(p.dir, 'sessao-SIMULADA.jsonl');
  fs.writeFileSync(transcricao, '');
  /** O condutor mostrou a pergunta nesta sessão: o código dela entra na transcrição. */
  const mostrar = (codigo: string) => fs.appendFileSync(transcricao, JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: `🔔 arco · ${codigo}\nResponda a, b ou c.` }] } }) + '\n');
  const evento = (prompt: string, o: { cwd?: string; sessao?: string } = {}) =>
    ({ hook_event_name: 'UserPromptSubmit', session_id: o.sessao ?? SESSAO, cwd: o.cwd ?? p.dir, transcript_path: transcricao, prompt });
  const responder = (prompt: string, o: { env?: Record<string, string | undefined>; quando?: string; ancestrais?: AmbienteDoTerminal['ancestrais'];
    cwd?: string; sessao?: string } = {}): DecisaoDoTerminal =>
    responderPeloTerminal(p.dir, evento(prompt, o), { env: { ...ENV_DO_DONO, ...o.env }, quando: o.quando ?? A,
      ancestrais: o.ancestrais ?? cadeia() });
  const arco = (nomeDoArco: string) => { const r = proporEnvelope(p.dir, pedido(nomeDoArco), P); return { ...r, codigo: r.codigo! }; };
  const linhasDoLog = (nomeDoArco: string) =>
    fs.readFileSync(path.join(p.dir, '.orkastery', 'noctum', 'arcos', nomeDoArco, 'arco.jsonl'), 'utf8').split('\n').filter(Boolean);
  return { p, mostrar, evento, responder, arco, linhasDoLog, limpar: () => { restaurar(); p.limpar(); } };
}

const acao = (d: DecisaoDoTerminal) => d.acao;

test('TM1: o dono digita "sim" na sessão em que a pergunta apareceu, e o arco é autorizado com o recibo do terminal', () => {
  const c = cenario('sim');
  try {
    const a = c.arco('arco-tm1');
    c.mostrar(a.codigo);
    const d = c.responder('sim');
    assert.equal(acao(d), 'registrada', JSON.stringify(d));
    const quem = lerArco(c.p.dir, 'arco-tm1', A)!.autorizadoPor as unknown as Record<string, unknown>;
    assert.deepEqual([quem.origem, quem.sessao, quem.entrypoint], ['terminal', SESSAO, 'cli']);
    assert.deepEqual(quem.conferencias, ['presenca', 'id-da-sessao', 'sem-despacho', 'ponto-de-entrada', 'fora-do-registro',
      'fora-de-worktree', 'ancestralidade']);
    assert.equal(conferirAntesDoEfeito(c.p.dir, efeito('arco-tm1', a.envelopeSha256), DENTRO).envelopeSha256, a.envelopeSha256);
  } finally { c.limpar(); }
});

test('TM2: "a" mostrada autoriza; "<código> a" vale mesmo sem a pergunta na transcrição', () => {
  const c = cenario('codigo');
  try {
    const a = c.arco('arco-tm2a'), b = c.arco('arco-tm2b');
    c.mostrar(a.codigo);
    assert.equal(acao(c.responder('a')), 'registrada');
    assert.equal(lerArco(c.p.dir, 'arco-tm2a', A)!.situacao, 'agendado');
    assert.equal(acao(c.responder(`${b.codigo} a`)), 'registrada');
    assert.equal(lerArco(c.p.dir, 'arco-tm2b', A)!.situacao, 'agendado');
  } finally { c.limpar(); }
});

test('TM3: a pergunta de revogação mostrada, respondida com "sim", revoga o arco', () => {
  const c = cenario('revogar');
  try {
    const a = c.arco('arco-tm3');
    assert.equal(acao(c.responder(`${a.codigo} a`)), 'registrada');
    const rev = pedirRevogacao(c.p.dir, 'arco-tm3', A);
    c.mostrar(rev.codigo);
    const d = c.responder('sim');
    assert.equal(acao(d), 'registrada', JSON.stringify(d));
    assert.equal(lerArco(c.p.dir, 'arco-tm3', A)!.situacao, 'revogado');
  } finally { c.limpar(); }
});

test('TM4: a sessão despachada pelo ork que digita "sim" é recusada pela origem, e nada é gravado', () => {
  const c = cenario('despachada');
  try {
    const a = c.arco('arco-tm4');
    c.mostrar(a.codigo);
    for (const env of [{ ORK_DISPATCH_ID: 'despacho-SIMULADO' }, { ORK_DISPATCH_THREAD: 'ork-simulada' }, { CLAUDE_JOB_DIR: '/tmp/job-SIMULADO' }]) {
      const d = c.responder('sim', { env });
      assert.deepEqual([d.acao, (d as { motivo?: string }).motivo], ['recusada', 'noctum.terminal.sessao-despachada'], JSON.stringify(env));
    }
    assert.equal(lerArco(c.p.dir, 'arco-tm4', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('TM5: a sessão sem presença (segundo plano, -p) é recusada, sem aviso a ninguém', () => {
  const c = cenario('sem-presenca');
  try {
    const a = c.arco('arco-tm5');
    c.mostrar(a.codigo);
    const d = c.responder('sim', { env: { CLAUDE_CODE_SESSION_ATTENDED: '0' } });
    assert.deepEqual([d.acao, (d as { motivo?: string }).motivo, (d as { presenca?: boolean }).presenca],
      ['recusada', 'noctum.terminal.sem-presenca', false]);
    assert.equal(acao(c.responder('sim', { env: { CLAUDE_CODE_SESSION_ATTENDED: undefined } })), 'recusada');
    assert.equal(lerArco(c.p.dir, 'arco-tm5', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('TM6: a sessão que o ork despachou numa thread é recusada pelo registro, mesmo com presença', () => {
  const c = cenario('registro');
  try {
    const a = c.arco('arco-tm6');
    c.mostrar(a.codigo);
    const t = novaThread(c.p.carregado, { nome: 'thread com a sessao', modo: 'auto', criarWorktree: false }).thread;
    const lida = lerThread(c.p.dir, t.id);
    lida.sessoes.push({ sessionId: SESSAO, runtime: 'claude-bg', slug: lida.slug, fase: 'GO', bloco: 'GO', despachadaEm: A, promptPath: '',
      promptSha256: '', verificada: true } as never);
    gravarThread(c.p.dir, lida);
    const d = c.responder('sim');
    assert.deepEqual([d.acao, (d as { motivo?: string }).motivo], ['recusada', 'noctum.terminal.sessao-do-ork']);
  } finally { c.limpar(); }
});

test('TM7: a sessão numa worktree de thread é recusada', () => {
  const c = cenario('worktree');
  try {
    const a = c.arco('arco-tm7');
    c.mostrar(a.codigo);
    const wt = path.join(c.p.dir, '.claude', 'worktrees', 'ork-simulada');
    fs.mkdirSync(wt, { recursive: true });
    const d = c.responder('sim', { cwd: wt });
    assert.deepEqual([d.acao, (d as { motivo?: string }).motivo], ['recusada', 'noctum.terminal.worktree-de-thread']);
  } finally { c.limpar(); }
});

test('TM8: a sessão do Claude Code em segundo plano é recusada pelo ambiente dela, não pelo do hook', () => {
  const c = cenario('fundo');
  try {
    const a = c.arco('arco-tm8');
    c.mostrar(a.codigo);
    for (const kind of ['bg', 'daemon', 'daemon-worker']) {
      const d = c.responder('sim', { ancestrais: cadeia({ CLAUDE_CODE_SESSION_KIND: kind }) });
      assert.deepEqual([d.acao, (d as { motivo?: string }).motivo], ['recusada', 'noctum.terminal.sessao-em-segundo-plano'], kind);
    }
    const ilegivel = c.responder('sim', { ancestrais: () => cadeia()().map(x => x.pid === 4242 ? { ...x, ambiente: null } : x) });
    assert.equal((ilegivel as { motivo?: string }).motivo, 'noctum.terminal.ancestral-ilegivel');
  } finally { c.limpar(); }
});

test('TM9: a sessão aninhada em outra sessão do Claude Code (a de um agente que abriu um terminal) é recusada', () => {
  const c = cenario('aninhada');
  try {
    const a = c.arco('arco-tm9');
    c.mostrar(a.codigo);
    const d = c.responder('sim', { ancestrais: cadeia(undefined, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'outra-sessao' }) });
    assert.deepEqual([d.acao, (d as { motivo?: string }).motivo], ['recusada', 'noctum.terminal.sessao-aninhada']);
  } finally { c.limpar(); }
});

test('TM10: id divergente, ponto de entrada do SDK e sessão fora da cadeia são recusados', () => {
  const c = cenario('divergente');
  try {
    const a = c.arco('arco-tm10');
    c.mostrar(a.codigo);
    assert.equal((c.responder('sim', { env: { CLAUDE_CODE_SESSION_ID: 'outra' } }) as { motivo?: string }).motivo, 'noctum.terminal.sessao-divergente');
    assert.equal((c.responder('sim', { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }) as { motivo?: string }).motivo, 'noctum.terminal.sessao-programatica');
    assert.equal((c.responder('sim', { env: { CLAUDE_PID: '9999' } }) as { motivo?: string }).motivo, 'noctum.terminal.ancestral-divergente');
    assert.equal(lerArco(c.p.dir, 'arco-tm10', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('TM11: a palavra solta sem pergunta mostrada nesta sessão vai ao modelo, e conversa comum também', () => {
  const c = cenario('ignorar');
  try {
    c.arco('arco-tm11');
    assert.deepEqual([acao(c.responder('sim')), (c.responder('sim') as { motivo?: string }).motivo], ['ignorar', 'nenhuma-pergunta-nesta-sessao']);
    assert.equal(acao(c.responder('pode me explicar o plano antes?')), 'ignorar');
    assert.equal(acao(c.responder('sim\nmas antes rode os testes')), 'ignorar');
    assert.equal(lerArco(c.p.dir, 'arco-tm11', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('TM12: duas perguntas mostradas e "sim": o núcleo pergunta qual, com os códigos, e nada é gravado', () => {
  const c = cenario('duas');
  try {
    const a = c.arco('arco-tm12a'), b = c.arco('arco-tm12b');
    c.mostrar(a.codigo); c.mostrar(b.codigo);
    const d = c.responder('sim');
    assert.equal(d.acao, 'pergunta');
    assert.ok((d as { mensagem: string }).mensagem.includes(`${a.codigo} a`) && (d as { mensagem: string }).mensagem.includes(`${b.codigo} a`));
    assert.equal(lerArco(c.p.dir, 'arco-tm12a', A)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('TM13: depois do prazo, "<código> a" volta como pergunta vencida, sem efeito', () => {
  const c = cenario('prazo');
  try {
    const a = c.arco('arco-tm13');
    const d = c.responder(`${a.codigo} a`, { quando: VENCIDA });
    assert.equal(d.acao, 'pergunta');
    assert.match((d as { mensagem: string }).mensagem, new RegExp(`A pergunta ${a.codigo} venceu`));
    assert.equal(lerArco(c.p.dir, 'arco-tm13', VENCIDA)!.autorizadoPor, null);
  } finally { c.limpar(); }
});

test('TM14: respondida a pergunta, outro "sim" vai ao modelo; o código de novo diz que já valia, com uma autorização só no log', () => {
  const c = cenario('repetida');
  try {
    const a = c.arco('arco-tm14');
    c.mostrar(a.codigo);
    assert.equal(acao(c.responder('sim')), 'registrada');
    assert.equal(acao(c.responder('sim')), 'ignorar', 'a pergunta respondida não espera mais o dono');
    const d = c.responder(`${a.codigo} a`);
    assert.deepEqual([d.acao, (d as { repetida?: boolean }).repetida], ['registrada', true]);
    assert.match((d as { mensagem: string }).mensagem, /já estava autorizado/);
    assert.equal(c.linhasDoLog('arco-tm14').filter(l => l.includes('"tipo":"autorizado"')).length, 1);
  } finally { c.limpar(); }
});

test('TM15: o código de um gate vira contexto ao condutor (D1): nada é gravado no gate', () => {
  const c = cenario('gate');
  try {
    const { thread: t } = novaThread(c.p.carregado, { nome: 'gate no terminal', modo: 'classic' });
    registrar(dirThread(c.p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const g = abrirPedidoGate(c.p.dir, t.id, 'human.pending', A) as { codigo: string; id: string };
    const d = c.responder(`${g.codigo} a`);
    assert.equal(d.acao, 'encaminhar');
    assert.match((d as { contexto: string }).contexto, new RegExp(`ork_request_decision \\(threadId ${t.id}, pedidoId ${g.id}\\)`));
    assert.equal(lerLedger(dirThread(c.p.dir, t.id)).some(e => e.tipo === 'human_gate'), false);
  } finally { c.limpar(); }
});

test('TM16: limite conhecido: o ambiente e a cadeia montados à mão pelo mesmo usuário passam (fronteira da conta do sistema)', () => {
  // O ingresso confia no ambiente que o Claude Code monta para o hook e na cadeia do `/proc`; quem roda como o mesmo usuário
  // monta os dois à mão. Este teste fixa o limite dito na página da RM-058, como o A21 fixa o do diálogo nativo.
  const c = cenario('limite');
  try {
    const a = c.arco('arco-tm16');
    assert.equal(acao(c.responder(`${a.codigo} a`)), 'registrada');
  } finally { c.limpar(); }
});

test('TM17: pelo CLI, a sessão de fase que chama o ingresso é recusada, sem projeto nada acontece, e não há comando que autorize', () => {
  const c = cenario('cli');
  try {
    const agora = new Date().toISOString();
    const r = proporEnvelope(c.p.dir, { ...pedido('arco-tm17'), janela: { inicio: new Date(Date.now() - 3600_000).toISOString(),
      fim: new Date(Date.now() + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' } }, agora);
    c.mostrar(r.codigo!);
    const env = { ...process.env, CLAUDE_CODE_SESSION_ATTENDED: '0', CLAUDE_CODE_SESSION_ID: SESSAO, ORK_DISPATCH_ID: 'despacho-SIMULADO' };
    const fase = spawnSync(process.execPath, [CLI, 'noctum', 'terminal', '--hook-stdin'], { cwd: c.p.dir, encoding: 'utf8', env,
      input: JSON.stringify(c.evento(`${r.codigo} a`)) });
    assert.equal(fase.status, 0, fase.stderr);
    assert.deepEqual([JSON.parse(fase.stdout).acao, JSON.parse(fase.stdout).motivo], ['recusada', 'noctum.terminal.sem-presenca']);
    assert.equal(lerArco(c.p.dir, 'arco-tm17')!.autorizadoPor, null);
    const fora = fs.mkdtempSync(path.join(path.dirname(c.p.dir), 'tm-fora-'));
    const semProjeto = spawnSync(process.execPath, [CLI, 'noctum', 'terminal', '--hook-stdin'], { cwd: fora, encoding: 'utf8', env,
      input: JSON.stringify({ ...c.evento('sim'), cwd: fora }) });
    assert.equal(JSON.parse(semProjeto.stdout).acao, 'ignorar');
    fs.rmSync(fora, { recursive: true, force: true });
    const autorizar = spawnSync(process.execPath, [CLI, 'noctum', 'autorizar', 'arco-tm17', r.envelopeSha256], { cwd: c.p.dir, encoding: 'utf8', env });
    assert.equal(autorizar.status, 2);
    assert.equal(lerArco(c.p.dir, 'arco-tm17')!.autorizadoPor, null);
  } finally { c.limpar(); }
});

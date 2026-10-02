/**
 * RM-055: impedimento que so o dono resolve vira HITL. A prova e o que o ledger, o monitor, a fabrica,
 * o pulse e o retry fazem com a recusa REAL do runtime (o stub repete a frase do incidente de 29/09/2026),
 * nunca relato.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { executarRetry, politicaDoMotivo } from '../src/retry';
import { montarMonitor } from '../src/orquestracao';
import { retratoDaMaquina } from '../src/fabrica-estado';
import { comporPulse } from '../src/pulse';
import { varrerSessoes } from '../src/hitl';
import { quemDecide } from '../src/hitl-classificacao';
import { textoDoPedidoCurto, TETO_DE_LINHAS_DO_PEDIDO } from '../src/hitl-curto';
import { classificarImpedimento, impedimentoResolvido, pedidoCurtoDoImpedimento } from '../src/impedimento';
import { dirThread, novaThread } from '../src/thread';

const INCIDENTE = 'Workspace not trusted. Run `claude` in /w/ork-rm054roadmap once and accept the trust prompt, then retry.\n';
const ctx = { thread: 'ork-x', fase: 'GOAL', runtime: 'claude-bg', cwd: '/w/ork-rm054roadmap' };

test('a) a frase do incidente vira runtime.workspace-untrusted, com o comando exato e o re-despacho depois', () => {
  const i = classificarImpedimento(`${INCIDENTE}\ndespacho falhou (code 1)`, ctx);
  assert.equal(i?.motivo, 'runtime.workspace-untrusted');
  assert.equal(i?.comando, 'cd /w/ork-rm054roadmap && claude');
  assert.match(i?.depois ?? '', /ork retry run ork-x` re-despacha GOAL com o mesmo prompt gravado/);
  assert.match(i?.trecho ?? '', /^Workspace not trusted/);
});

test('a) o codex fora de diretorio confiavel tambem e do dono, com o binario dele e o caminho citado', () => {
  const i = classificarImpedimento('Not inside a trusted directory and --skip-git-repo-check was not specified.',
    { ...ctx, runtime: 'codex', cwd: "/w/com espaço/it's" });
  assert.equal(i?.motivo, 'runtime.workspace-untrusted');
  assert.equal(i?.comando, `cd '/w/com espaço/it'\\''s' && codex`);
});

test('a) termos novos do CLI viram runtime.consent-pending', () => {
  const i = classificarImpedimento('Please accept the updated Consumer Terms to continue.', ctx);
  assert.equal(i?.motivo, 'runtime.consent-pending');
  assert.equal(i?.comando, 'claude');
});

test('a) motivo desconhecido, cota e login continuam fora: o caminho de antes segue', () => {
  for (const saida of ['despacho falhou (code 1)', 'Error: Your workspace is out of credits', 'Not logged in · Please run /login', '']) {
    assert.equal(classificarImpedimento(saida, ctx), null, saida);
  }
});

test('b) os motivos novos sao do dono no resumo e tem politica de re-despacho do mesmo prompt', () => {
  for (const motivo of ['runtime.workspace-untrusted', 'runtime.consent-pending'] as const) {
    assert.equal(quemDecide(motivo), 'dono');
    assert.equal(politicaDoMotivo(motivo).acao, 'reexecutar');
  }
  assert.equal(quemDecide('runtime.unavailable'), 'orquestrador', 'o generico continua "Conosco"');
});

test('b) o pedido sai no contrato curto da RM-048: o que trava, desde quando, o comando e o que o ork faz depois', () => {
  const quando = '2026-09-29T19:00:00Z';
  const curto = pedidoCurtoDoImpedimento({ thread: 'ork-x', fase: 'GOAL', motivo: 'runtime.workspace-untrusted',
    detalhe: 'o claude não confia no diretório da worktree e recusou o despacho de GOAL', desdeEm: '2026-09-29T16:32:55Z',
    impedimento: { comando: 'cd /w/x && claude', depois: 'aceite a confiança; depois, `ork retry run ork-x` re-despacha GOAL' } }, quando);
  assert.equal(curto.contrato, 'ork.hitl-curto/v1');
  assert.equal(curto.alternativas.filter(a => a.recomendada).length, 1);
  for (const canal of ['telegram', 'terminal'] as const) {
    const texto = textoDoPedidoCurto(curto, canal);
    assert.ok(texto.split('\n').length <= TETO_DE_LINHAS_DO_PEDIDO, texto);
    assert.match(texto, /cd \/w\/x && claude/);
    assert.match(texto, /desde/);
    assert.match(texto, /`ork retry run ork-x`/);
  }
});

test('c) a prova local da confianca: o diretorio de cima confiado vale para a worktree; sem arquivo, nao sei', () => {
  const casa = dirTemporario('rm055-casa');
  try {
    const cwd = path.join(casa, 'repo', '.claude', 'worktrees', 'ork-x');
    assert.equal(impedimentoResolvido('runtime.workspace-untrusted', { cwd, runtime: 'claude-bg', home: casa }), null);
    fs.writeFileSync(path.join(casa, '.claude.json'), JSON.stringify({ projects: { [path.join(casa, 'repo')]: { hasTrustDialogAccepted: false } } }));
    assert.equal(impedimentoResolvido('runtime.workspace-untrusted', { cwd, runtime: 'claude-bg', home: casa }), false);
    fs.writeFileSync(path.join(casa, '.claude.json'), JSON.stringify({ projects: { [path.join(casa, 'repo')]: { hasTrustDialogAccepted: true } } }));
    assert.equal(impedimentoResolvido('runtime.workspace-untrusted', { cwd, runtime: 'claude-bg', home: casa }), true);
    assert.equal(impedimentoResolvido('runtime.consent-pending', { cwd, runtime: 'claude-bg', home: casa }), null);
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

// O stub recusa o `--bg` com a frase do incidente enquanto a conta nao confia no diretorio (o mesmo
// `.claude.json` que o `ork` le), e despacha depois do aceite.
const SCRIPT_CLAUDE = `#!/bin/sh
if [ "$1" = "auth" ]; then
  printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","configDirectory":"%s"}\\n' "$CLAUDE_CONFIG_DIR"; exit 0
fi
if [ "$1" = "agents" ]; then echo '[]'; exit 0; fi
if ! grep -q '"hasTrustDialogAccepted":true' "$CLAUDE_CONFIG_DIR/.claude.json" 2>/dev/null; then
  echo "Workspace not trusted. Run \\\`claude\\\` in $(pwd) once and accept the trust prompt, then retry." >&2; exit 1
fi
echo "Background agent started: 55555555-0000-4000-8000-000000000001"
exit 0
`;

test('b e c) despacho recusado vira espera do dono no monitor, na fabrica e no pulse; o retry so re-despacha o mesmo prompt depois do aceite', () => {
  const p = projetoTemporario('rm055-despacho');
  const bin = path.join(p.dir, 'bin'), conta = path.join(p.dir, 'conta-processo');
  fs.mkdirSync(bin); fs.mkdirSync(conta);
  fs.writeFileSync(path.join(bin, 'claude'), SCRIPT_CLAUDE, { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = conta;
  try {
    const t = novaThread(p.carregado, { nome: 'impedimento', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.motivo, 'runtime.workspace-untrusted', r.erro);
    const dir = dirThread(p.dir, t.id);
    const gate = lerLedger(dir).filter(e => e.tipo === 'gate_blocked').at(-1);
    assert.equal(gate?.motivo, 'runtime.workspace-untrusted');
    const cwd = String(gate?.cwd);
    assert.match(String(gate?.correcao), new RegExp(`cd ${cwd.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} && claude`));
    assert.equal(gate?.promptSha256, r.promptSha256);

    // Monitor: pausa do dono (nao impedimento "Conosco"), com o comando.
    const linha = montarMonitor(p.carregado, { agora: new Date().toISOString() }).linhas.find(l => l.thread === t.id)!;
    const pausa = linha.pausas.find(x => x.motivo === 'runtime.workspace-untrusted');
    assert.equal(pausa?.natureza, 'pausa-humana');
    assert.equal(pausa?.impedimento?.comando, `cd ${cwd} && claude`);
    assert.equal(linha.impedimentos.some(x => x.motivo === 'runtime.workspace-untrusted'), false);

    // Fabrica publicada: espera voce, com o que rodar.
    const retrato = retratoDaMaquina(p.carregado).threads.find(x => x.id === t.id)!;
    assert.equal(retrato.esperaVoce, true);
    assert.match(String(retrato.pergunta), /claude/);

    // Pulse: precisa de humano agora, no contrato curto.
    const quando = new Date().toISOString();
    const radar = varrerSessoes({ raiz: p.dir, semLogs: true, agora: quando, consulta: { ok: true, sessoes: [], detalhe: '' } });
    const pulse = comporPulse(p.carregado, { radar, monitor: montarMonitor(p.carregado, { agora: quando }), batch: [], orfas: [] });
    const item = pulse.precisaDeHumanoAgora.find(i => i.thread === t.id && i.motivo === 'runtime.workspace-untrusted');
    assert.ok(item, JSON.stringify(pulse.precisaDeHumanoAgora));
    assert.match(item.apresentacaoCurta?.terminal ?? '', /ork retry run/);
    assert.equal(item.comandoResposta, `ork retry run ${t.id}`);

    // Retry antes do aceite: a conta existe e nao confia no diretorio; nada vai ao runtime e a pausa continua.
    fs.writeFileSync(path.join(conta, '.claude.json'), JSON.stringify({ projects: { [cwd]: { hasTrustDialogAccepted: false } } }));
    const antes = executarRetry(p.carregado, t.id);
    assert.equal(antes.executada, false);
    assert.match(antes.detalhe, /ainda nao confia/);
    assert.equal(lerLedger(dir).some(e => e.tipo === 'phase_dispatch'), false);

    // O dono aceita a confianca: o retry re-despacha a MESMA fase com o MESMO prompt, e a espera sai.
    fs.writeFileSync(path.join(conta, '.claude.json'), JSON.stringify({ projects: { [cwd]: { hasTrustDialogAccepted: true } } }));
    const depois = executarRetry(p.carregado, t.id);
    assert.equal(depois.executada, true, depois.detalhe);
    const despacho = lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal(despacho?.fase, 'GOAL');
    assert.equal(despacho?.promptSha256, r.promptSha256, 'mesmo prompt, mesmo sha256');
    const fim = montarMonitor(p.carregado, { agora: new Date().toISOString() }).linhas.find(l => l.thread === t.id);
    assert.equal(fim?.pausas.some(x => x.motivo === 'runtime.workspace-untrusted') ?? false, false);
  } finally {
    p.limpar();
    process.env.PATH = anterior.PATH;
    if (anterior.CLAUDE === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = anterior.CLAUDE;
  }
});

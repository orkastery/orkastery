/**
 * RM-055, continuacao (thread ork-rm055impedi2): o que a fatia 1 entregou, conferido contra o runtime real
 * instalado (claude 2.1.296 e codex 0.154.0) e contra o caminho real ate o dono. As frases sao as literais
 * dos binarios (strings; a do bypass tambem reproduzida num ambiente isolado). O prefixo do nome (S1 a S4)
 * e o criterio do GOAL que cada claim filtra.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirTemporario, projetoTemporario } from './apoio';
import { classificarImpedimento, impedimentoResolvido } from '../src/impedimento';
import { lerLedger, registrar } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { dirThread, novaThread } from '../src/thread';
import { definirFusoDoDono } from '../src/horario';
import { ItemPulse, montarPulse, Pulse } from '../src/pulse';
import { varrerPulse } from '../src/pulse-delivery';
import { gravarCadencia } from '../src/pulse-cadencia';
import { resumirHitl, SEM_PERGUNTA_COM_IMPEDIMENTO, SEM_PERGUNTA_NO_RESUMO, TETO_DE_IMPEDIMENTOS, textoDoResumo } from '../src/hitl-resumo';

const ctx = { thread: 'ork-x', fase: 'GO', runtime: 'claude-bg', cwd: '/w/repo/.claude/worktrees/ork-x' };

/** O claude escreve um travessao na frase do home; o fonte daqui nao carrega o caractere. */
const TRAVESSAO = String.fromCharCode(0x2014);

/** claude 2.1.296: o veredito de confianca do `--bg`, o portao do disclaimer e o aviso de termos do modo print. */
const CLAUDE = {
  confianca: 'Workspace not trusted. Run `claude` in /w/repo/.claude/worktrees/ork-x once and accept the trust prompt, then retry.',
  semDisco: 'Workspace not trusted. /w/repo/.claude/worktrees/ork-x could not be resolved on disk.',
  home: `Workspace not trusted. The home directory is trusted one session at a time ${TRAVESSAO} start this from an ` +
    'interactive terminal there, or from a project directory.',
  termos: '[ACTION REQUIRED] An update to our Consumer Terms and Privacy Policy has taken effect on October 8, 2025. ' +
    'You must run `claude` to review the updated terms.',
  carencia: 'An update to our Consumer Terms and Privacy Policy will take effect on October 8, 2025. Run `claude` to ' +
    'review the updated terms.',
  bypass: '--bg with bypassPermissions requires accepting the disclaimer first. Run `claude --dangerously-skip-permissions` ' +
    'once interactively.',
  auto: '--bg with auto mode requires opting in first. Run `claude --permission-mode auto` once interactively.',
};

/** codex 0.154.0: o `exec` fora de diretorio confiavel e o aviso da TUI. */
const CODEX = {
  exec: 'Not inside a trusted directory and --skip-git-repo-check was not specified.',
  tui: 'This directory is not trusted; run Codex there.',
};

test('S1: o aviso de termos que bloqueia o claude 2.1.296 vira runtime.consent-pending, com o comando da frase', () => {
  const i = classificarImpedimento(`${CLAUDE.termos}\n`, ctx);
  assert.equal(i?.motivo, 'runtime.consent-pending');
  assert.equal(i?.comando, 'claude');
  assert.match(i?.trava ?? '', /espera você revisar e aceitar os termos novos e recusou o despacho de GO/);
  assert.match(i?.depois ?? '', /^aceite os termos e saia; depois, `ork retry run ork-x` re-despacha GO com o mesmo prompt gravado$/);
  assert.ok(i?.trecho.startsWith('[ACTION REQUIRED] An update'), i?.trecho);
});

test('S1: as recusas de consentimento do --bg trazem o comando exato que o proprio runtime manda rodar', () => {
  const bypass = classificarImpedimento(`${CLAUDE.bypass}\ndespacho falhou (code 1)`, ctx);
  assert.equal(bypass?.motivo, 'runtime.consent-pending');
  assert.equal(bypass?.comando, 'claude --dangerously-skip-permissions');
  assert.match(bypass?.trava ?? '', /aceitar o aviso do modo sem permissões \(bypass\)/);
  const auto = classificarImpedimento(CLAUDE.auto, ctx);
  assert.equal(auto?.motivo, 'runtime.consent-pending');
  assert.equal(auto?.comando, 'claude --permission-mode auto');
  assert.match(auto?.depois ?? '', /^confirme o modo auto e saia; depois/);
});

test('S1: o que aceitar a confianca nao resolve e o aviso de carencia ficam fora do dono', () => {
  for (const saida of [CLAUDE.semDisco, CLAUDE.home, CLAUDE.carencia, `${CLAUDE.carencia}\ndespacho falhou (code 1)`,
    `${CLAUDE.semDisco}\ndespacho falhou (code 1)`]) {
    assert.equal(classificarImpedimento(saida, ctx), null, saida);
  }
});

test('S1: a recusa de confianca do claude e as duas do codex continuam do dono, com o binario de cada um', () => {
  const claude = classificarImpedimento(`${CLAUDE.confianca}\n`, ctx);
  assert.equal(claude?.motivo, 'runtime.workspace-untrusted');
  assert.equal(claude?.comando, 'cd /w/repo/.claude/worktrees/ork-x && claude');
  for (const frase of [CODEX.exec, CODEX.tui]) {
    const i = classificarImpedimento(frase, { ...ctx, runtime: 'codex' });
    assert.equal(i?.motivo, 'runtime.workspace-untrusted', frase);
    assert.equal(i?.comando, 'cd /w/repo/.claude/worktrees/ork-x && codex', frase);
  }
});

test('S1: comando fora da forma fechada, ou de outro binario, nunca chega ao dono: vale o binario puro', () => {
  for (const forjado of ['Run `claude && echo pwned` once interactively.', 'Run `codex --yolo` once interactively.',
    'Run `claude --plugin-dir /tmp/x` once interactively.', 'Run `claude $(id)` once interactively.']) {
    const i = classificarImpedimento(`--bg with auto mode requires opting in first. ${forjado}`, ctx);
    assert.equal(i?.motivo, 'runtime.consent-pending', forjado);
    assert.equal(i?.comando, 'claude', forjado);
  }
});

/**
 * Um repositorio git com duas worktrees vinculadas criadas pelo proprio git: uma dentro dele, onde o ork
 * cria as suas (`.claude/worktrees/<id>`), e outra fora. A conta e um `.claude.json` como o do claude.
 */
function repositorioComWorktrees(nome: string) {
  const base = dirTemporario(nome);
  const principal = path.join(base, 'principal');
  fs.mkdirSync(principal);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: principal, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=teste@orkastery.local', '-c', 'user.name=Teste', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'inicial');
  const dentro = path.join(principal, '.claude', 'worktrees', 'ork-x');
  const fora = path.join(base, 'fora', 'ork-y');
  git('worktree', 'add', '-q', '-b', 'ork-x', dentro);
  git('worktree', 'add', '-q', '-b', 'ork-y', fora);
  const conta = path.join(base, 'conta');
  fs.mkdirSync(conta);
  const confiar = (...dirs: string[]) => fs.writeFileSync(path.join(conta, '.claude.json'),
    JSON.stringify({ projects: Object.fromEntries(dirs.map(d => [d, { hasTrustDialogAccepted: true }])) }));
  const prova = (cwd: string) => impedimentoResolvido('runtime.workspace-untrusted', { cwd, runtime: 'claude-bg', configDir: conta });
  return { base, principal, dentro, fora, conta, confiar, prova, limpar: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('S2: so o repositorio principal confiado vale para a worktree dentro dele (E1) e fora dele (E2)', () => {
  const r = repositorioComWorktrees('rm055c-e1e2');
  try {
    r.confiar(r.principal);
    assert.equal(r.prova(r.dentro), true, 'E1: o claude 2.1.296 aceita');
    assert.equal(r.prova(r.fora), true, 'E2: o claude 2.1.296 aceita; a busca para cima nunca chegaria ao principal');
    assert.equal(r.prova(r.principal), true);
  } finally { r.limpar(); }
});

test('S2: acima da raiz git nada vale (E3), nem o meio do caminho entre o repositorio e a worktree', () => {
  const r = repositorioComWorktrees('rm055c-e3');
  try {
    r.confiar(r.base);
    assert.equal(r.prova(r.dentro), false, 'E3: o claude 2.1.296 recusa a worktree');
    assert.equal(r.prova(r.fora), false);
    assert.equal(r.prova(r.principal), false, 'a raiz do repositorio comum tambem limita a busca');
    r.confiar(path.join(r.principal, '.claude', 'worktrees'));
    assert.equal(r.prova(r.dentro), false, 'o diretorio entre o repositorio e a worktree fica acima da raiz dela');
    r.confiar(r.dentro);
    assert.equal(r.prova(r.dentro), true, 'o aceite na propria worktree vale');
    assert.equal(r.prova(path.join(r.dentro, 'core')), true, 'e vale para o que esta dentro dela');
  } finally { r.limpar(); }
});

test('S2: fora de git qualquer diretorio de cima confiado vale; sem .claude.json, nao sei', () => {
  const r = repositorioComWorktrees('rm055c-sem-git');
  try {
    const solto = path.join(r.base, 'solto', 'a', 'b');
    fs.mkdirSync(solto, { recursive: true });
    assert.equal(r.prova(solto), null, 'sem arquivo da conta');
    r.confiar(path.join(r.base, 'solto'));
    assert.equal(r.prova(solto), true);
    assert.equal(impedimentoResolvido('runtime.consent-pending', { cwd: solto, runtime: 'claude-bg', configDir: r.conta }), null);
    assert.equal(impedimentoResolvido('runtime.workspace-untrusted', { cwd: solto, runtime: 'codex', configDir: r.conta }), null);
  } finally { r.limpar(); }
});

/** O aviso real de termos do claude 2.1.296, gravado no stub tal como o binario o escreve. */
const RECUSA_DE_TERMOS = `${CLAUDE.termos}\n`;

test('S3: a recusa repetida pelo mesmo impedimento do dono nao gasta tentativa; o aceite re-despacha o mesmo prompt', () => {
  const p = projetoTemporario('rm055c-retry');
  const bin = path.join(p.dir, 'bin'), conta = path.join(p.dir, 'conta-processo'), apoio = path.join(p.dir, 'stub');
  fs.mkdirSync(bin); fs.mkdirSync(conta); fs.mkdirSync(apoio);
  fs.writeFileSync(path.join(apoio, 'auth.json'),
    `${JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', configDirectory: conta })}\n`);
  fs.writeFileSync(path.join(apoio, 'recusa.txt'), RECUSA_DE_TERMOS);
  const aceito = path.join(apoio, 'termos-aceitos');
  // O stub recusa o `--bg` com o aviso real enquanto o dono nao aceita os termos, e despacha depois.
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/sh',
    `if [ "$1" = "auth" ]; then cat "${apoio}/auth.json"; exit 0; fi`,
    `if [ "$1" = "agents" ]; then echo '[]'; exit 0; fi`,
    `if [ ! -e "${aceito}" ]; then cat "${apoio}/recusa.txt" >&2; exit 1; fi`,
    'echo "Background agent started: 55555555-0000-4000-8000-000000000055"',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = conta;
  try {
    const t = novaThread(p.carregado, { nome: 'termos', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' });
    assert.equal(r.motivo, 'runtime.consent-pending', r.erro);
    const dir = dirThread(p.dir, t.id);
    const gate = lerLedger(dir).filter(e => e.tipo === 'gate_blocked').at(-1);
    assert.match(String(gate?.correcao), /rode `claude`; aceite os termos e saia; depois, `ork retry run /);

    // O orquestrador chama o retry antes de o dono agir: o runtime recusa de novo, sempre pelo mesmo motivo.
    for (let i = 1; i <= 4; i++) {
      const x = executarRetry(p.carregado, t.id);
      assert.equal(x.executada, false, `chamada ${i}`);
      assert.equal(x.redespacho?.motivo, 'runtime.consent-pending', `chamada ${i}`);
      assert.equal(x.plano.acao, 'reexecutar', `chamada ${i}: sem escalar esforço nem escalar ao humano`);
      assert.equal(x.plano.bloqueio, null, `chamada ${i}`);
      assert.equal(x.plano.tentativas, 0, `chamada ${i}`);
    }
    const eventos = lerLedger(dir);
    const tentativas = eventos.filter(e => e.tipo === 'retry_attempt');
    assert.equal(tentativas.length, 4, 'cada recusa fica no ledger');
    assert.ok(tentativas.every(e => e.conta === false && e.ok === false), JSON.stringify(tentativas));
    assert.equal(eventos.some(e => e.tipo === 'retry_escalated'), false);
    assert.equal(eventos.some(e => e.tipo === 'gate_blocked' && e.motivo === 'human.pending'), false);

    // O dono aceita os termos: o primeiro retry re-despacha a MESMA fase com o MESMO prompt.
    fs.writeFileSync(aceito, 'sim');
    const depois = executarRetry(p.carregado, t.id);
    assert.equal(depois.executada, true, depois.detalhe);
    const despacho = lerLedger(dir).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal(despacho?.fase, 'GOAL');
    assert.equal(despacho?.promptSha256, r.promptSha256, 'mesmo prompt, mesmo sha256');
    const ultima = lerLedger(dir).filter(e => e.tipo === 'retry_attempt').at(-1);
    assert.equal(ultima?.ok, true);
    assert.equal(ultima?.conta, undefined, 'o redespacho que saiu conta como sempre');
  } finally {
    p.limpar();
    process.env.PATH = anterior.PATH;
    if (anterior.CLAUDE === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = anterior.CLAUDE;
  }
});

/** O stub do incidente de 29/09: recusa todo `--bg` pela confianca do diretorio, como o claude 2.1.296. */
function claudeQueRecusaAConfianca(dir: string): { restaurar: () => void } {
  const bin = path.join(dir, 'bin'), conta = path.join(dir, 'conta-processo'), apoio = path.join(dir, 'stub');
  fs.mkdirSync(bin); fs.mkdirSync(conta); fs.mkdirSync(apoio);
  fs.writeFileSync(path.join(apoio, 'auth.json'),
    `${JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', configDirectory: conta })}\n`);
  // A frase entra por arquivo: crase dentro de aspas duplas no sh rodaria `claude` de novo, e a saida de
  // `$(cat ...)` o shell nao reinterpreta.
  fs.writeFileSync(path.join(apoio, 'antes.txt'), 'Workspace not trusted. Run `claude` in ');
  fs.writeFileSync(path.join(apoio, 'depois.txt'), ' once and accept the trust prompt, then retry.');
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/sh',
    `if [ "$1" = "auth" ]; then cat "${apoio}/auth.json"; exit 0; fi`,
    `if [ "$1" = "agents" ]; then echo '[]'; exit 0; fi`,
    `echo "$(cat "${apoio}/antes.txt")$(pwd)$(cat "${apoio}/depois.txt")" >&2`,
    'exit 1',
    '',
  ].join('\n'), { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, CLAUDE: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${bin}:${anterior.PATH ?? ''}`;
  process.env.CLAUDE_CONFIG_DIR = conta;
  return { restaurar: () => {
    process.env.PATH = anterior.PATH;
    if (anterior.CLAUDE === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = anterior.CLAUDE;
  } };
}

test('S4: o resumo entregue traz thread, fase, comando e ork retry run de cada impedimento do dono aberto', () => {
  const p = projetoTemporario('rm055c-resumo');
  const stub = claudeQueRecusaAConfianca(p.dir);
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const threads = ['alfa', 'bravo'].map(nome => {
      const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
      assert.equal(rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo', runtime: 'claude-bg' }).motivo,
        'runtime.workspace-untrusted');
      const gate = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'gate_blocked').at(-1);
      return { id: t.id, cwd: String(gate?.cwd) };
    });
    const quando = new Date().toISOString();
    const pulse = montarPulse(p.carregado, { consulta: { ok: true, sessoes: [], detalhe: '' }, quando });
    for (const t of threads) {
      const item = pulse.precisaDeHumanoAgora.find(i => i.thread === t.id && i.motivo === 'runtime.workspace-untrusted');
      assert.deepEqual(item?.impedimento, { motivo: 'runtime.workspace-untrusted', comando: `cd ${t.cwd} && claude`,
        retry: `ork retry run ${t.id}` });
    }

    const mensagens: string[] = [];
    const r = varrerPulse({ raiz: p.dir, quando, consultar: () => pulse, enviar: m => { mensagens.push(m); return true; } });
    assert.equal(r.enviadas, 1, r.detalhe);
    const texto = mensagens[0];
    assert.match(texto, /🔑 Só você destrava, no terminal: 2/);
    for (const t of threads) {
      assert.ok(texto.includes(`• ${t.id} GOAL: rode \`cd ${t.cwd} && claude\`; depois \`ork retry run ${t.id}\``), texto);
    }
    assert.match(texto, /Esperando você: 2/);
    assert.match(texto, /Perguntas para você: 0/);
    assert.ok(texto.endsWith(SEM_PERGUNTA_COM_IMPEDIMENTO), texto);

    // O terminal le o mesmo conteudo, com o marcador dele.
    const terminal = textoDoResumo(resumirHitl(pulse.precisaDeHumanoAgora, { quando,
      impedimentosDoDono: threads.map(t => ({ thread: t.id, fase: 'GOAL', comando: `cd ${t.cwd} && claude`, retry: `ork retry run ${t.id}` })) }),
      { canal: 'terminal' });
    assert.match(terminal, /^ {2}Só você destrava, no terminal: 2$/m);
    for (const t of threads) assert.ok(terminal.includes(`  • ${t.id} GOAL: rode \`cd ${t.cwd} && claude\`; depois \`ork retry run ${t.id}\``), terminal);
  } finally {
    definirFusoDoDono(undefined);
    stub.restaurar();
    p.limpar();
  }
});

/** Um instante dado na hora de Brasilia, em ISO. */
const brt = (hhmm: string) => new Date(`2026-10-10T${hhmm}:00-03:00`).toISOString();

const pulseCom = (itens: ItemPulse[], quando: string): Pulse => ({
  contrato: 'ork.pulse/v1', consultadoEm: quando, runtime: { ok: true, detalhe: '' },
  precisaDeHumanoAgora: itens, acoesAutomaticas: [],
  resumo: { humanos: itens.length, automaticas: 0, scores: 0, fasesOrfas: 0 },
});

test('S4: com a cadência ligada, impedimento novo sai na hora, e o mesmo impedimento já avisado não volta a tocar', () => {
  const p = projetoTemporario('rm055c-cadencia');
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    gravarCadencia(p.dir, '#OrkPulseOn', { por: 'telegram:42', canal: 'hermes', em: brt('08:00') }, monitor);
    // Uma thread parada no gate de GOAL do #Classic: a pergunta que abre a primeira janela.
    const g = novaThread(p.carregado, { nome: 'gate classic', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, g.id), g.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const gate: ItemPulse = { id: `thread:${g.id}:GOAL:human.pending:ledger`, classe: 'thread', motivo: 'human.pending',
      thread: g.id, fase: 'GOAL', sessionId: null, desdeEm: brt('08:30'), paradaHaMin: 35, impacto: 1,
      pergunta: 'bloco fechado em GOAL: espera o veredito humano sobre objetivo', opcoes: [], recomendacao: '',
      comandoResposta: 'ork thread status', evidencia: [], fontes: ['monitor'], contextoLogs: [] };
    const i = novaThread(p.carregado, { nome: 'impedida', modo: 'auto' }).thread;
    const impedida: ItemPulse = { id: `thread:${i.id}:GO:runtime.workspace-untrusted:ledger`, classe: 'thread',
      motivo: 'runtime.workspace-untrusted', thread: i.id, fase: 'GO', sessionId: null, desdeEm: brt('09:10'), paradaHaMin: 10,
      impacto: 3, pergunta: 'o claude não confia no diretório da worktree e recusou o despacho de GO', opcoes: [],
      recomendacao: 'rode `cd /w/impedida && claude`', comandoResposta: `ork retry run ${i.id}`, evidencia: [],
      fontes: ['monitor'], contextoLogs: [],
      impedimento: { motivo: 'runtime.workspace-untrusted', comando: 'cd /w/impedida && claude', retry: `ork retry run ${i.id}` } };
    const mensagens: string[] = [];
    const bater = (quando: string, itens: ItemPulse[]) => varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens, quando),
      quando, comCadencia: true, enviar: m => { mensagens.push(m); return true; } });

    // 09:05: a pergunta do gate sai na hora e abre a janela das 08h as 10h.
    assert.equal(bater(brt('09:05'), [gate]).enviadas, 1);
    // 09:20: o impedimento novo nao espera a janela das 10h: sai agora, com o comando.
    const agora = bater(brt('09:20'), [gate, impedida]);
    assert.equal(agora.enviadas, 1, agora.detalhe);
    assert.ok(mensagens[1].includes(`• ${i.id} GO: rode \`cd /w/impedida && claude\`; depois \`ork retry run ${i.id}\``), mensagens[1]);
    // 09:35: nada mudou; o impedimento ja avisado nao toca sozinho de novo.
    const depois = bater(brt('09:35'), [gate, impedida]);
    assert.equal(depois.enviadas, 0);
    assert.equal(depois.detalhe, 'sem novidade');
    assert.equal(mensagens.length, 2);
  } finally {
    definirFusoDoDono(undefined);
    p.limpar();
  }
});

test('S4: com mais de cinco impedimentos o resumo detalha cinco e conta o resto; sem impedimento, o texto e o de antes', () => {
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const quando = brt('10:00');
    const impedimentosDoDono = Array.from({ length: TETO_DE_IMPEDIMENTOS + 2 }, (_, n) => ({ thread: `ork-t${n}`, fase: 'GO',
      comando: `cd /w/t${n} && claude`, retry: `ork retry run ork-t${n}` }));
    for (const canal of ['telegram', 'terminal'] as const) {
      const texto = textoDoResumo(resumirHitl([], { quando, impedimentosDoDono }), { canal });
      assert.match(texto, new RegExp(`Só você destrava, no terminal: ${TETO_DE_IMPEDIMENTOS + 2}`));
      assert.equal(texto.split('\n').filter(l => l.includes('• ork-t')).length, TETO_DE_IMPEDIMENTOS, texto);
      assert.match(texto, /e mais 2: ork pulse/);
      assert.ok(texto.endsWith(SEM_PERGUNTA_COM_IMPEDIMENTO), texto);
      const semImpedimento = textoDoResumo(resumirHitl([], { quando }), { canal });
      assert.equal(semImpedimento.includes('Só você destrava'), false);
      assert.ok(semImpedimento.endsWith(SEM_PERGUNTA_NO_RESUMO), semImpedimento);
    }
  } finally { definirFusoDoDono(undefined); }
});

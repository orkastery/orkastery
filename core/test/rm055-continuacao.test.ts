/**
 * RM-055, continuacao (thread ork-rm055impedi2): o que a fatia 1 entregou, conferido contra o runtime real
 * instalado (claude 2.1.296 e codex 0.154.0) e contra o caminho real ate o dono. As frases sao as literais
 * dos binarios (strings; a do bypass tambem reproduzida num ambiente isolado). O prefixo do nome (S1 a S4)
 * e o criterio do GOAL que cada claim filtra.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classificarImpedimento } from '../src/impedimento';

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

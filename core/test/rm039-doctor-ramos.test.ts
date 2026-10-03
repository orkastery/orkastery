/**
 * RM-039 (C5 do BACKLOG-AUTO-3): os ramos do `ork doctor` tocados em 03/10 que a suite nao executava.
 *
 * - a cadencia do pulse no cron (B6, RM-039): as expressoes que o doctor nao le e as linhas que ele nao
 *   divide, pelo leitor injetavel do crontab;
 * - o manifesto de fora do repositorio (E1, RM-049): a pasta sem git, o manifesto que nao existe e a
 *   worktree de um repositorio bare;
 * - o login do `claude` sem perfil de conta (R1, RM-049): perfil ativo, desativado, de outro runtime e o
 *   store ilegivel, com o `claude` falso no PATH e a conferencia injetada.
 *
 * A linha `rede` (RM-053) fica de fora: tem frente aberta. Nada aqui toca a rede nem o crontab real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario } from './apoio';
import { checar, checarRuntimeClaude, manifestoForaDoRepositorio } from '../src/doctor';
import { BATIDA_DO_TEMPLATE, checarCronDoPulse, intervaloEmMinutos, LeituraDoCrontab } from '../src/doctor-pulse-cron';
import { adicionarPerfil, caminhoDoStore, desativarPerfil, pastaPrivada } from '../src/runtime-profiles';
import { exec } from '../src/util';

const SCRIPT = '/srv/ork/monitor/varredura-pulse.sh';
const crontab = (texto: string) => (): LeituraDoCrontab => ({ ok: true, texto });
const semCrontab = (): LeituraDoCrontab => ({ ok: false, motivo: 'crontab -l falhou: no crontab for teste' });

test('C5 cron: expressoes que o doctor nao le dao null, e as formas com passo e faixa dao o intervalo', () => {
  assert.equal(intervaloEmMinutos('@reboot'), null, 'macro sem intervalo');
  assert.equal(intervaloEmMinutos('@daily'), 1440);
  assert.equal(intervaloEmMinutos('*/15 * * *'), null, 'quatro campos');
  assert.equal(intervaloEmMinutos('*/15 * * * * *'), null, 'seis campos');
  assert.equal(intervaloEmMinutos('*/0 * * * *'), null, 'passo zero');
  assert.equal(intervaloEmMinutos('60 * * * *'), null, 'minuto fora da faixa');
  assert.equal(intervaloEmMinutos('30-10 * * * *'), null, 'faixa invertida');
  assert.equal(intervaloEmMinutos('0,x * * * *'), null, 'parte ilegivel numa lista');
  assert.equal(intervaloEmMinutos('5/20 * * * *'), 20, 'inicio com passo vai ate o fim do campo');
  assert.equal(intervaloEmMinutos('0-30/10 * * * *'), 30, 'faixa com passo conta a volta da hora');
  assert.equal(intervaloEmMinutos('10-20 * * * *'), 50, 'faixa sem passo');
  assert.equal(intervaloEmMinutos('*/5 * * * 1-5'), 60, 'dia da semana restrito conta como hora');
});

test('C5 cron: linha que o doctor nao le vira aviso, com o comando dela ou o sugerido', () => {
  const p = projetoTemporario('c5-cron-linhas');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'pulse-host.json'), JSON.stringify({ executavel: '/bin/true', argumentos: [] }));
    const checa = (texto: string) => checarCronDoPulse(monitor, p.dir, crontab(texto), null);
    const sugerido = `${BATIDA_DO_TEMPLATE} ${path.join(p.dir, 'monitor', 'varredura-pulse.sh')}`;

    const macro = checa(`@reboot ${SCRIPT}\n`);
    assert.equal(macro?.nivel, 'warn');
    assert.match(macro!.detalhe, /com horario que o doctor nao le/);
    assert.equal(macro!.correcao, `troque a linha no crontab (crontab -e) por: ${BATIDA_DO_TEMPLATE} ${SCRIPT}`);

    // Sem comando separavel do horario, a correcao usa o comando sugerido pelo checkout.
    for (const linha of [`@ ${SCRIPT}`, `*/5 * * ${SCRIPT}`]) {
      const c = checa(`${linha}\n`);
      assert.equal(c?.nivel, 'warn', linha);
      assert.match(c!.detalhe, /com horario que o doctor nao le/, linha);
      assert.equal(c!.correcao, `troque a linha no crontab (crontab -e) por: ${sugerido}`, linha);
    }

    assert.match(checa(`*/30 * * * * ${SCRIPT}\n`)!.detalhe, /bate a cada 30 minutos/);
    assert.match(checa(`@hourly ${SCRIPT}\n`)!.detalhe, /bate de hora em hora/);
    // Uma linha rapida basta: a lenta ao lado nao vira aviso.
    const duas = checa(`*/30 * * * * ${SCRIPT}\n*/10 * * * * ${SCRIPT}\n`);
    assert.equal(duas?.nivel, 'ok');
    assert.match(duas!.detalhe, /\(2 linha\(s\)\)/);
  } finally { p.limpar(); }
});

test('C5 manifesto: sem git nao ha aviso; manifesto inexistente e worktree de repositorio bare avisam', () => {
  const acima = dirTemporario('c5-manifesto');
  try {
    const semGit = path.join(acima, 'sem-git');
    fs.mkdirSync(semGit);
    assert.equal(manifestoForaDoRepositorio(semGit, path.join(acima, 'orkastery.yaml')), null, 'fora de repositorio quem fala e o init');

    const repo = path.join(acima, 'repo');
    fs.mkdirSync(repo);
    exec('git', ['init', '-q', '-b', 'main'], repo);
    const sumido = path.join(acima, 'nao-existe', 'orkastery.yaml');
    const aviso = manifestoForaDoRepositorio(repo, sumido);
    assert.equal(aviso?.nivel, 'warn', 'o caminho que nao existe ainda e comparado pelo caminho resolvido');
    assert.ok(aviso!.detalhe.includes(sumido), aviso!.detalhe);
    assert.equal(manifestoForaDoRepositorio(repo, path.join(repo, 'nao-existe', 'orkastery.yaml')), null);

    // Repositorio bare com worktree: o git-common-dir nao se chama .git, entao a pasta dele nao e a arvore principal.
    exec('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'inicial'], repo);
    const bare = path.join(acima, 'proj.git');
    exec('git', ['clone', '-q', '--bare', repo, bare], acima);
    const wt = path.join(acima, 'wt');
    const add = exec('git', ['worktree', 'add', '-q', wt, 'main'], bare);
    assert.ok(add.ok, add.stderr);
    const doBare = manifestoForaDoRepositorio(wt, path.join(acima, 'orkastery.yaml'));
    assert.equal(doBare?.nivel, 'warn');
    assert.match(doBare!.correcao!, new RegExp(`rode ork init na raiz deste repositorio \\(${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    assert.equal(manifestoForaDoRepositorio(wt, path.join(wt, 'orkastery.yaml')), null);
  } finally { fs.rmSync(acima, { recursive: true, force: true }); }
});

test('C5 claude: so o perfil ativo de claude-bg dispensa a conferencia do login; store ilegivel confere', () => {
  const p = projetoTemporario('c5-claude-auth');
  const bin = dirTemporario('c5-claude-bin');
  const anterior = process.env.PATH;
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n[ "$1" = "--version" ] && echo "stub 0.0.1"\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${bin}:${anterior ?? ''}`;
  try {
    let conferiu = 0;
    const linha = () => checar(p.dir, [], semCrontab,
      () => { conferiu++; return { ok: false, detalhe: 'claude auth status: loggedIn false' }; })
      .find(c => c.nome === 'runtime claude-bg')!;
    const conta = (id: string) => { const d = path.join(p.dir, 'contas', id); fs.mkdirSync(d, { recursive: true }); return d; };

    assert.equal(linha().nivel, 'warn', 'sem perfil, o login do claude do processo e conferido');
    assert.equal(conferiu, 1);

    adicionarPerfil(p.dir, { id: 'cx', runtime: 'codex', dir: conta('cx') });
    assert.equal(linha().nivel, 'warn', 'perfil de outro runtime nao conta');
    assert.equal(conferiu, 2);

    adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir: conta('a') });
    const comPerfil = linha();
    assert.equal(comPerfil.nivel, 'ok', 'com perfil ativo, quem confere e o check de contas');
    assert.equal(comPerfil.detalhe, `${path.join(bin, 'claude')} (stub 0.0.1)`);
    assert.equal(conferiu, 2, 'a conferencia nao roda');

    desativarPerfil(p.dir, 'a');
    assert.equal(linha().nivel, 'warn', 'perfil desativado nao conta');
    assert.equal(conferiu, 3);

    fs.mkdirSync(pastaPrivada(p.dir), { recursive: true, mode: 0o700 });
    fs.writeFileSync(caminhoDoStore(p.dir), '{ ilegivel', { mode: 0o600 });
    assert.equal(linha().nivel, 'warn', 'store ilegivel: o despacho usa o login do processo');
    assert.equal(conferiu, 4);

    assert.equal(checarRuntimeClaude(p.carregado, '/opt/bin/claude', null).detalhe, '/opt/bin/claude (versao desconhecida)');
  } finally {
    if (anterior === undefined) delete process.env.PATH; else process.env.PATH = anterior;
    fs.rmSync(bin, { recursive: true, force: true }); p.limpar();
  }
});

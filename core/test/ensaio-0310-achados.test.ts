/**
 * Achados do ensaio de primeira experiencia de 03/10/2026 (recibo
 * docs/roadmap/evidencias/RM-049/ensaio-2026-10-03.json, thread ork-rm049achados): cada achado com a
 * recomendada do recibo. Os nomes comecam por "ensaio 0310 R<n>:" para que cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente; o `claude` dos testes e um script falso.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checar, checarRuntimeClaude } from '../src/doctor';
import { LeituraDoCrontab } from '../src/doctor-pulse-cron';
import { dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PATH_ATUAL = process.env.PATH ?? '/usr/bin:/bin';
const semCrontab = (): LeituraDoCrontab => ({ ok: false, motivo: 'crontab -l falhou: no crontab for teste' });

function ork(dir: string, casa: string, args: string[], env: Record<string, string> = {}):
  { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: PATH_ATUAL, LANG: 'C.UTF-8', ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Um `claude` falso que responde a versao e o `auth status --json` dado. */
function claudeFalso(dir: string, auth: Record<string, unknown>): string {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "2.1.288 (Claude Code)"; exit 0; fi',
    `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '${JSON.stringify(auth)}'; exit 0; fi`,
    'exit 1', '',
  ].join('\n'), { mode: 0o755 });
  return bin;
}

test('ensaio 0310 R1: doctor avisa o claude sem login quando nao ha perfil de conta', () => {
  const p = projetoTemporario('ensaio0310-r1');
  const casa = dirTemporario('ensaio0310-r1-casa');
  try {
    const bin = claudeFalso(casa, { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' });
    const r = ork(p.dir, casa, ['doctor'], { PATH: `${bin}:${PATH_ATUAL}` });
    const linha = r.stdout.split('\n').find(l => l.includes('runtime claude-bg')) ?? '';
    assert.match(linha, /^\s*\[warn\]\s+runtime claude-bg\s+.*claude auth status: loggedIn false: o despacho pelo claude-bg falharia/, r.stdout);
    assert.match(r.stdout, /faca o login de assinatura \(\/login\) e aceite a confianca no diretorio do projeto/);

    // Com o login de assinatura, a linha volta a ok.
    const logado = claudeFalso(dirTemporario('ensaio0310-r1-logado'), { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' });
    const ok = ork(p.dir, casa, ['doctor'], { PATH: `${logado}:${PATH_ATUAL}` });
    assert.match(ok.stdout.split('\n').find(l => l.includes('runtime claude-bg')) ?? '', /^\s*\[ok\]/, ok.stdout);
  } finally { limpar(p.dir, casa); }
});

test('ensaio 0310 R1: conferencia inconclusiva nao avisa, e o check de contas cuida de quem tem perfil', () => {
  const p = projetoTemporario('ensaio0310-r1-func');
  try {
    assert.equal(checarRuntimeClaude(p.carregado, '/opt/bin/claude', '2.1.0',
      { ok: false, transitorio: true, detalhe: 'claude auth status sem resposta' }).nivel, 'ok');
    assert.equal(checarRuntimeClaude(p.carregado, '/opt/bin/claude', '2.1.0',
      { ok: false, pago: true, detalhe: 'claude auth status: provider pago (authMethod apiKey)' }).nivel, 'warn');
    let conferiu = 0;
    const linha = checar(p.dir, [], semCrontab, () => { conferiu++; return { ok: false, detalhe: 'claude auth status: loggedIn false' }; })
      .find(c => c.nome === 'runtime claude-bg');
    if (linha && linha.detalhe.includes('fora do PATH')) return; // maquina sem o claude: nada a conferir
    assert.equal(conferiu, 1);
    assert.equal(linha?.nivel, 'warn');
  } finally { limpar(p.dir); }
});

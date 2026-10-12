/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): na entrada do cron do pulse
 * (`node dist/pulse-delivery.js <raiz>`), o `catch` que grava `{acao: 'falhou'}` no `rede.log` quando
 * a batida da rede falha nao tinha teste. Este roda a entrada de verdade, num processo filho, com a
 * maquina membro da rede e sem nenhuma CLI de forja: a publicacao falha e a falha fica no log, com a
 * origem e o erro, sem derrubar a varredura.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gravarConfigDaRede } from '../src/rede-adesao';
import { dirTemporario, projetoTemporario } from './apoio';

const ENTRADA = path.resolve(__dirname, '../src/pulse-delivery.js');

test('suspeitas 03/10: a batida da rede que falha no cron do pulse fica no rede.log como falhou', () => {
  const u = dirTemporario('susp0310-pulse-rede');
  const p = projetoTemporario('susp0310-pulse-rede');
  const ferramentas = path.join(u, 'ferramentas');
  try {
    fs.mkdirSync(ferramentas);
    const git = (process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'git')).find((f) => fs.existsSync(f));
    fs.symlinkSync(git!, path.join(ferramentas, 'git'));
    const antes = process.env.ORK_USUARIO_DIR;
    process.env.ORK_USUARIO_DIR = u;
    try { gravarConfigDaRede({ membro: true, forja: 'github', host: 'github.com', dono: 'pessoa', repositorio: 'orkastery-network' }); }
    finally { if (antes === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes; }
    const env: NodeJS.ProcessEnv = { ...process.env, ORK_USUARIO_DIR: u, PATH: ferramentas, ORK_BINARIOS_EXTRA: '', HOME: u };
    delete env.ORK_REDE_PUBLICAR;
    delete env.ORK_FABRICA_PUBLICAR;
    const r = spawnSync(process.execPath, [ENTRADA, p.dir], { env, encoding: 'utf8', timeout: 60_000 });
    assert.ok(r.stdout.trim().startsWith('{'), `a varredura respondeu: ${r.stdout} ${r.stderr}`);
    const log = fs.readFileSync(path.join(u, 'rede', 'rede.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const falha = log.find((x) => x.acao === 'falhou');
    assert.ok(falha, `rede.log: ${JSON.stringify(log)}`);
    assert.equal(falha.origem, 'pulse');
    assert.match(String(falha.erro), /^rede\.sem-forja: /);
    assert.match(String(falha.ts), /^\d{4}-\d{2}-\d{2}T/);
  } finally { p.limpar(); fs.rmSync(u, { recursive: true, force: true }); }
});

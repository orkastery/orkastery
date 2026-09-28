/**
 * I-35 (GO-FIX 1, P2-1 do CHECK c655cb5e): o AVISO de HITL de `scripts/varredura-hitl.sh`
 * não imprime o `consultadoEm` do radar (ISO em UTC). Roda o script real com `TZ=UTC` e um
 * `ork` falso que devolve um radar SIMULADO; o cache fica num diretório temporário.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'varredura-hitl.sh');

test('varredura-hitl.sh: AVISO sem ISO cru nem UTC, com a idade de cada sessão', () => {
  const dir = dirTemporario('horario-varredura');
  try {
    const radar = { runtimeConsultado: true, runtimeDetalhe: '', consultadoEm: '2026-09-19T20:32:14.968Z',
      resumo: { precisamDeHumano: 1 },
      sessoes: [{ sessionId: 'sessao-SIMULADA', id: 'abc12345', nome: 'fixture', classe: 'hitl', tipoDeHitl: 'pergunta',
        pergunta: 'Qual opção?', detalhe: '', cwd: '/tmp/fixture', thread: null, idadeMin: 12, alternativas: ['1. Continuar'],
        recomendacao: 'Revisar antes de responder.', comandos: { logs: 'claude logs abc12345', attach: 'claude attach abc12345' } },
      // P3-4: sessão que acabou de parar diz "menos de 1 min", nunca "0 min".
      { sessionId: 'sessao-SIMULADA-2', id: 'def67890', nome: 'recente', classe: 'hitl', tipoDeHitl: 'pergunta',
        pergunta: 'Outra?', detalhe: '', cwd: '/tmp/fixture', thread: null, idadeMin: 0, alternativas: [],
        recomendacao: 'Responder.', comandos: { logs: 'claude logs def67890', attach: 'claude attach def67890' } }] };
    fs.writeFileSync(path.join(dir, 'radar.json'), JSON.stringify(radar));
    const ork = path.join(dir, 'ork-falso');
    fs.writeFileSync(ork, `#!/bin/sh\ncat ${JSON.stringify(path.join(dir, 'radar.json'))}\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, TZ: 'UTC', ORKASTERY_HOME: path.join(dir, 'estado') };
    const r = spawnSync('/bin/bash', [SCRIPT, '--repetir', '--ork', ork], { encoding: 'utf8', env });
    assert.equal(r.status, 10, r.stderr);
    assert.match(r.stdout, /^AVISO: 2 sessao\(oes\) esperando o humano agora$/m);
    assert.match(r.stdout, /parada ha {3}: 12 min \(idade da sessao\)/);
    assert.match(r.stdout, /parada ha {3}: menos de 1 min \(idade da sessao\)/);
    assert.doesNotMatch(r.stdout, /: 0 min/);
    assert.doesNotMatch(r.stdout, ISO);
    assert.doesNotMatch(r.stdout, /UTC/);
    // O cache do orquestrador continua com o ISO (dado de máquina).
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'estado', 'hitl-avisado.json'), 'utf8')).atualizadoEm, radar.consultadoEm);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

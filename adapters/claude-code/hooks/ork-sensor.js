#!/usr/bin/env node
'use strict';
// Sensor passivo: stdout vazio e exit 0 não aprovam nem negam uma ferramenta.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

function executar() {
  const limite = 1024 * 1024;
  const buffer = Buffer.alloc(limite + 1);
  let bytes = 0;
  while (bytes <= limite) {
    const n = fs.readSync(0, buffer, bytes, buffer.length - bytes, null);
    if (!n) break;
    bytes += n;
    if (bytes > limite) return;
  }
  const h = JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
  if (!h || typeof h.cwd !== 'string' || !path.isAbsolute(h.cwd) ||
      typeof h.session_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(h.session_id)) return;
  const tipos = { PermissionRequest: 'permission_request', Notification: 'notification',
    Stop: 'stop', SubagentStop: 'subagent_stop', PostToolUse: 'heartbeat' };
  let tipo = tipos[h.hook_event_name];
  if (!tipo) return;
  const payload = { observedAt: new Date().toISOString() };
  if (h.hook_event_name === 'Notification') payload.notificationType = h.notification_type;
  // tool_use_id identifica replay da mesma ferramenta. Sem id do protocolo,
  // cada invocação é uma ocorrência; stat do transcript não identifica eventos.
  payload.eventId = typeof h.tool_use_id === 'string'
    ? createHash('sha256').update(JSON.stringify([h.hook_event_name, h.tool_use_id, h.agent_id])).digest('hex')
    : randomUUID();
  if (h.hook_event_name === 'PostToolUse' && h.tool_name === 'Bash') {
    const resposta = h.tool_response;
    if (resposta?.interrupted || (resposta?.exit_code !== undefined && resposta.exit_code !== 0) ||
        (resposta?.exitCode !== undefined && resposta.exitCode !== 0)) return;
    const comando = h.tool_input?.command;
    const saida = typeof resposta === 'string' ? resposta : resposta?.stdout;
    const shaCurto = typeof saida === 'string' ? /^\[[^\]\n]+ ([a-f0-9]{7,64})\]/m.exec(saida)?.[1] : null;
    if (typeof comando === 'string' && /(?:^|[;&|\n])\s*git\s+commit(?:\s|$)/.test(comando) && shaCurto) {
      const git = spawnSync('git', ['log', '-1', '--format=%H'], {
        cwd: h.cwd, encoding: 'utf8', timeout: 1000, maxBuffer: 4096,
      });
      const sha = git.stdout?.trim();
      if (git.status === 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha) && sha.startsWith(shaCurto)) {
        tipo = 'commit'; payload.commit = sha;
      }
    }
  }
  const r = spawnSync(process.env.ORK_SENSOR_CLI || 'ork',
    ['sessions', 'event', '--tipo', tipo, '--sessao', h.session_id], {
      cwd: h.cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 3000,
      maxBuffer: 32768, windowsHide: true,
    });
  if (r.status !== 0) {
    // Recusa conhecida não identifica o papel da sessão nem comprova ingestão.
    const semVinculo = r.status === 1 && !r.error && !r.stdout?.trim() &&
      r.stderr?.trim() === 'evento recusado: sessão desconhecida; confira ork thread status';
    process.stderr.write(semVinculo
      ? 'ork sensor: sessão sem fase vinculada; evento não ingerido. Se foi despachada pelo Ork, confira o vínculo com ork thread status.\n'
      : 'ork sensor: evento não ingerido; confira o CLI e a sessão registrada.\n');
  }
}
try { executar(); }
catch { process.stderr.write('ork sensor: entrada inválida ou sensor indisponível.\n'); }
process.exitCode = 0;

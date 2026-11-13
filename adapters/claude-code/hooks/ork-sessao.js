#!/usr/bin/env node
'use strict';

// SessionStart transporta a orientação decidida pelo núcleo. Falha ou ausência
// de identidade nativa não bloqueia a sessão nem cria vínculo por suposição.
const fs = require('node:fs');
const path = require('node:path');

const LIMITE = 1024 * 1024;

function entrada() {
  const buffer = Buffer.alloc(LIMITE + 1);
  let bytes = 0;
  while (bytes <= LIMITE) {
    const lidos = fs.readSync(0, buffer, bytes, buffer.length - bytes, null);
    if (!lidos) break;
    bytes += lidos;
  }
  if (bytes > LIMITE) return null;
  return JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
}

function executavelNoPath(nome) {
  if (path.isAbsolute(nome)) return nome;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidato = path.join(dir, nome);
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

function diretorioDoNucleo(cwd) {
  if (process.env.ORK_NUCLEO_DIR) return path.resolve(process.env.ORK_NUCLEO_DIR);
  const local = path.join(cwd, 'core', 'dist');
  if (fs.existsSync(path.join(local, 'sessao-orientacao.js'))) return local;
  const cli = executavelNoPath(process.env.ORK_SENSOR_CLI || 'ork');
  if (!cli) return null;
  try { return path.dirname(fs.realpathSync(cli)); } catch { return null; }
}

function executarComEntrada(h) {
  if (!h || h.hook_event_name !== 'SessionStart' || typeof h.session_id !== 'string' ||
      typeof h.cwd !== 'string' || !path.isAbsolute(h.cwd)) return null;
  const dir = diretorioDoNucleo(h.cwd);
  if (!dir) return null;
  const { exigirManifesto } = require(path.join(dir, 'manifest.js'));
  const { orientarSessao } = require(path.join(dir, 'sessao-orientacao.js'));
  const orientacao = orientarSessao(exigirManifesto(h.cwd), {
    runtime: 'claude-code', sessionId: h.session_id, cwd: h.cwd,
  });
  if (orientacao.estado === 'fora-de-thread' && typeof orientacao.texto === 'string' && orientacao.texto.trim()) {
    return { systemMessage: orientacao.texto.slice(0, 4000) };
  }
  return null;
}

function executar() {
  const saida = executarComEntrada(entrada());
  if (saida) process.stdout.write(JSON.stringify(saida) + '\n');
}

if (require.main === module) {
  try { executar(); } catch { /* superfície não confirmada: a sessão segue sem bloqueio */ }
}
module.exports = { executarComEntrada };
process.exitCode = 0;

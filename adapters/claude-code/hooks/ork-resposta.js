#!/usr/bin/env node
'use strict';
/**
 * Hook `UserPromptSubmit` do adaptador Claude Code: a resposta curta do dono no terminal (RM-057, ork-rm057respost).
 *
 * O dono aprova onde estiver. Numa sessao interativa, ele responde a pergunta do arco #Noctum com "sim", "a" ou
 * "<codigo> a"; este hook leva o evento ao nucleo (`ork noctum terminal --hook-stdin`) e transporta a decisao dele:
 *
 *  - gravada (ou sem efeito, detalhe, ou a pergunta de volta): a frase do nucleo substitui o prompt (`decision: block`),
 *    e o "sim" nao chega ao modelo;
 *  - resposta a um gate: o contexto vai ao modelo (`additionalContext`), para o condutor abrir o dialogo nativo;
 *  - recusa pela origem com alguem presente: um aviso ao dono (`systemMessage`), e o prompt segue ao modelo;
 *  - o resto: nada, e o prompt segue como sempre.
 *
 * Ele NAO tem regra de negocio: nao le ledger, nao conhece pergunta e nao prova nada; quem confere a origem da sessao e o
 * nucleo. So texto curto de uma linha chama o nucleo. Erro do hook ou do nucleo nunca bloqueia nem quebra a sessao.
 *
 * GO-FIX 1 (achado 1): o prompt que a maquina injeta na sessao do dono (a tarefa agendada, a volta do /loop, a mensagem
 * de canal ou de outra sessao, o SDK) nunca chega ao nucleo: o evento diz quem o escreveu (`source`), e so `user`, o
 * compositor interativo, passa. Sem o campo (versao do Claude Code que ainda nao o manda), o nucleo recebe o evento,
 * recusa e diz ao dono por que; ele tambem exige `user`, para quem chamar o nucleo sem este hook.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * A forma da resposta curta, larga o bastante para o nucleo decidir e estreita o bastante para conversa comum nem chamar o
 * nucleo: o codigo com a resposta ("NX4K a"), o numero com a letra ("1a") ou uma palavra solta de ate duas palavras e 20
 * caracteres ("sim", "pode seguir"). Tudo numa linha so, ate 64 caracteres.
 */
const TETO_DO_PROMPT = 64;
const CODIGO_E_RESPOSTA = /^[A-HJKMNP-TV-Z](?=[2-9A-HJKMNP-TV-Z]{0,2}[2-9])[2-9A-HJKMNP-TV-Z]{3}\s+\S/i;
const NUMERO_E_LETRA = /^[0-9]{1,2}\s*[a-e][.!]?$/i;
const PALAVRA_SOLTA = /^\S+(?:\s\S+)?$/;
const TETO_DA_ENTRADA = 1024 * 1024;

function pareceRespostaCurta(t) {
  if (!t || t.length > TETO_DO_PROMPT || /[\r\n]/.test(t)) return false;
  return CODIGO_E_RESPOSTA.test(t) || NUMERO_E_LETRA.test(t) || (t.length <= 20 && PALAVRA_SOLTA.test(t));
}

function lerEntrada() {
  const buffer = Buffer.alloc(TETO_DA_ENTRADA + 1);
  let bytes = 0;
  while (bytes <= TETO_DA_ENTRADA) {
    const n = fs.readSync(0, buffer, bytes, buffer.length - bytes, null);
    if (!n) break;
    bytes += n;
  }
  if (bytes > TETO_DA_ENTRADA) return null;
  return JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
}

/** O texto que o nucleo montou, com teto: o hook transporta, nunca reescreve. */
const texto = (v, teto) => (typeof v === 'string' && v.trim() ? v.slice(0, teto) : '');

function executar() {
  const h = lerEntrada();
  if (!h || h.hook_event_name !== 'UserPromptSubmit' || typeof h.prompt !== 'string' ||
      typeof h.cwd !== 'string' || !path.isAbsolute(h.cwd)) return;
  // O prompt que a maquina escreveu nao e do dono: nao chega ao nucleo, e segue ao modelo como sempre.
  if (h.source !== undefined && h.source !== 'user') return;
  if (!pareceRespostaCurta(h.prompt.trim())) return;
  const r = spawnSync(process.env.ORK_SENSOR_CLI || 'ork', ['noctum', 'terminal', '--hook-stdin'], {
    cwd: h.cwd, input: JSON.stringify(h), encoding: 'utf8', timeout: 8000, maxBuffer: 256 * 1024, windowsHide: true,
  });
  if (r.status !== 0 || typeof r.stdout !== 'string' || !r.stdout.trim()) return;
  let d;
  try { d = JSON.parse(r.stdout); } catch { return; }
  if (!d || d.contrato !== 'ork.noctum-terminal/v1') return;
  let saida = null;
  if (['registrada', 'sem-efeito', 'detalhe', 'pergunta'].includes(d.acao) && texto(d.mensagem, 8000)) {
    saida = { decision: 'block', reason: texto(d.mensagem, 8000) };
  } else if (d.acao === 'encaminhar' && texto(d.contexto, 2000)) {
    saida = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: texto(d.contexto, 2000) } };
  } else if (d.acao === 'recusada' && d.presenca === true && texto(d.mensagem, 2000)) {
    saida = { systemMessage: texto(d.mensagem, 2000) };
  }
  if (saida) process.stdout.write(JSON.stringify(saida) + '\n');
}

try { executar(); }
catch { process.stderr.write('ork resposta: entrada invalida ou nucleo indisponivel; o prompt segue sem mudanca.\n'); }
process.exitCode = 0;

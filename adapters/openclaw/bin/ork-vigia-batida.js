#!/usr/bin/env node
/**
 * RM-063 (slice 3, H1): the deterministic step of the OpenClaw heartbeat, the factory's second line.
 *
 * An OpenClaw automation runs this file every 30 min as a command payload: no model turn, never an LLM cron with
 * deliver=origin. It reads `ork doctor --json` (contract ork.doctor/v1) and prints the one text the owner gets:
 *  - the beat is late (`batida.atrasada`): the core's ready warning, `batida.aviso`, as is;
 *  - nothing to say: exactly NO_REPLY, which the automation suppresses;
 *  - ork missing, failing or answering outside the contract: a short alert, since a watch that cannot read is a stop.
 * Always exits 0, because the printed text IS the alert. Nothing goes to stderr: the automation would deliver it.
 *
 * Usage: ork-vigia-batida.js --projeto <name>   (or ORK_PROJETO in the environment)
 */
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { delimiter, dirname } from 'node:path';

/** Rendered by `ork adapter install openclaw` to this machine's ork; ORK_BIN in the environment wins. */
const RENDERED = '{{ork_bin}}';
/** Built by concatenation, so the installer never renders the comparison itself. */
const PLACEHOLDER = '{' + '{ork_bin}}';
/** RM-052: a registered project name, the same shape the tools accept; never a path or an option. */
const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
/** A typed core error (`projeto.desconhecido`): closed vocabulary, safe to quote, unlike free output. */
const TYPED_ERROR = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/i;
const TIMEOUT_MS = 120_000, MAX_BUFFER = 16 * 1024 * 1024;

const clean = (text, max) => String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

function projectName(argv) {
  const i = argv.findIndex((a) => a === '--projeto' || a.startsWith('--projeto='));
  if (i < 0) return (process.env.ORK_PROJETO ?? '').trim();
  return (argv[i] === '--projeto' ? argv[i + 1] ?? '' : argv[i].slice('--projeto='.length)).trim();
}

function orkBin() {
  const chosen = process.env.ORK_BIN?.trim() ? process.env.ORK_BIN : RENDERED;
  return chosen === PLACEHOLDER ? 'ork' : chosen;
}

/** The doctor's stdout, which carries the JSON even when it exits 1 (veredito bloqueado), and why it failed. */
function runDoctor(bin, project) {
  // The doctor only reads: it never gets the HITL callback's private keys that live in the gateway's environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ORK_HITL_')));
  env.ORK_CANAL = 'openclaw';
  env.ORK_PROJETO_EXPLICITO = '1';
  // `ork` starts with `#!/usr/bin/env node`: the node running this file is the last resort of a lean gateway PATH.
  env.PATH = [env.PATH, dirname(process.execPath)].filter(Boolean).join(delimiter);
  try {
    // stderr is captured, never inherited: the core's "Projeto consultado" line there would defeat NO_REPLY.
    return { stdout: execFileSync(bin, ['--projeto', project, 'doctor', '--json'],
      { env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] }), failure: '' };
  } catch (e) {
    const failure = e.code === 'ENOENT' ? `ork nao encontrado em ${bin}`
      : e.code === 'ETIMEDOUT' ? `sem resposta em ${TIMEOUT_MS / 1000} s`
      : typeof e.code === 'string' ? e.code
      : typeof e.status === 'number' ? `saiu com codigo ${e.status}`
      : e.signal ? `encerrado por ${e.signal}` : 'falha ao rodar';
    return { stdout: typeof e.stdout === 'string' ? e.stdout : '', failure };
  }
}

function messageFor(project) {
  if (!project) return 'Orkastery: a batida do OpenClaw nao sabe qual fabrica conferir: falta --projeto <nome> (ou ORK_PROJETO) na automacao.';
  if (!PROJECT.test(project)) {
    return `Orkastery: a batida do OpenClaw recebeu um projeto invalido (${clean(project, 80)}): use o nome de \`ork projetos\` em --projeto.`;
  }
  const { stdout, failure } = runDoctor(orkBin(), project);
  let doctor;
  try { doctor = JSON.parse(stdout); } catch { doctor = undefined; }
  if (doctor?.contrato === 'ork.doctor/v1') {
    const batida = doctor.batida;
    if (batida?.atrasada !== true) return 'NO_REPLY';
    return typeof batida.aviso === 'string' && batida.aviso.trim() ? batida.aviso.trim()
      : `Orkastery: a fabrica ${project} esta sem batida. Confira com: ork fabrica batida status`;
  }
  const typed = typeof doctor?.erro === 'string' && TYPED_ERROR.test(doctor.erro) ? doctor.erro : '';
  const detail = clean([failure, typed].filter(Boolean).join(': ') || 'resposta fora do contrato ork.doctor/v1', 160);
  const machine = clean(process.env.ORK_MAQUINA?.trim() || hostname(), 64);
  return `Orkastery: o ork doctor nao respondeu na maquina ${machine} (${detail}): a batida da fabrica ${project} nao pode ser conferida.`;
}

let text;
try { text = messageFor(projectName(process.argv.slice(2))); }
catch (e) { text = `Orkastery: a batida do OpenClaw falhou nesta maquina (${clean(e?.name ?? 'Error', 40)}): a fabrica nao pode ser conferida.`; }
process.stdout.write(`${text}\n`);

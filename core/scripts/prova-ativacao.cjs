#!/usr/bin/env node
'use strict';
// RM-032: prova de ativação por host. Instala o adaptador desta cópia numa raiz descartável,
// abre uma sessão NOVA e não interativa no host instalado, diz `orkastery maestro` e confere a
// resposta contra o contrato (core/src/prova-ativacao.ts). Nada global é alterado: o recibo
// compara o sha256 dos arquivos globais do host antes e depois. Passo que exige pessoa
// (revisão de procedência, consentimento de MCP, reinício de gateway) não é contornado: vira
// pendência com o comando exato.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

const repo = path.resolve(__dirname, '../..');
const CLI = path.join(repo, 'core/dist/index.js');
const FRASE = 'orkastery maestro';
const HOSTS = { 'claude-code': { bin: 'claude', modelo: 'sonnet' }, openclaw: { bin: 'openclaw', modelo: null } };
const USO = 'uso: node core/scripts/prova-ativacao.cjs <claude-code|openclaw> [--saida ARQUIVO] [--modelo M] [--manter]';
// Saídas: 0 aprovada, 1 reprovada ou falha, 2 uso/host ausente, 3 pendente de ação humana.
const SAIDA = { aprovada: 0, reprovada: 1, falha: 1, 'host-ausente': 2, 'pendente-humano': 3 };

function argumentos(argv) {
  const [host, ...resto] = argv;
  if (!HOSTS[host]) {
    process.stderr.write(`host.nao-suportado: ${host ?? '(vazio)'}; esta prova cobre ${Object.keys(HOSTS).join(' e ')} ` +
      '(Hermes e Codex ficam pendentes no RM-032).\n' + USO + '\n');
    process.exit(2);
  }
  const op = { host, saida: null, modelo: HOSTS[host].modelo, manter: false };
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a === '--saida') op.saida = path.resolve(resto[++i] ?? '');
    else if (a === '--modelo') op.modelo = resto[++i] ?? '';
    else if (a === '--manter') op.manter = true;
    else { process.stderr.write(`argumento desconhecido: ${a}\n${USO}\n`); process.exit(2); }
  }
  return op;
}

const op = argumentos(process.argv.slice(2));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const agora = () => new Date().toISOString();
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `ork-prova-ativacao-${op.host}-`));
const recibo = {
  contrato: 'ork.prova-ativacao/v1', host: op.host, frase: FRASE, maquina: os.hostname(), inicio: agora(), fim: null,
  estado: null, candidato: candidato(), hostVersao: null, modelo: op.modelo, raiz,
  comandos: [], conferencias: [], snapshot: null, pendenciasHumanas: [], global: null, limpeza: null, erro: null,
};

function candidato() {
  const git = args => cp.spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']);
  const sujo = git(['status', '--porcelain', '--', 'core/src', 'core/scripts', 'adapters', 'skills']);
  return { head: head.status === 0 ? head.stdout.trim() : null, sujo: sujo.status === 0 ? sujo.stdout.trim() !== '' : null,
    cli: 'core/dist/index.js', node: process.version };
}

/** Roda e registra. `guardar: false` grava só tamanho e sha256 da saída (transcripts longos). */
function rodar(bin, args, { cwd = raiz, env = process.env, timeout = 60000, guardar = true, entrada } = {}) {
  const inicio = agora();
  const r = cp.spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024,
    input: entrada ?? '', killSignal: 'SIGTERM' });
  const stdout = r.stdout ?? '', stderr = r.stderr ?? '';
  recibo.comandos.push({ argv: [bin, ...args], cwd, inicio, fim: agora(), codigo: r.status, sinal: r.signal, erro: r.error?.code ?? null,
    stdout: guardar ? stdout.slice(0, 4000) : { bytes: Buffer.byteLength(stdout), sha256: sha(stdout) },
    stderr: stderr.slice(-2000) });
  return { status: r.status, stdout, stderr, error: r.error };
}
function exigir(r, oque) {
  if (r.status !== 0) throw new Error(`${oque} saiu com ${r.status ?? r.error?.code ?? r.signal}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r;
}

function hashArquivo(f) { try { return sha(fs.readFileSync(f)); } catch { return null; } }
function hashArvore(dir) {
  if (!fs.existsSync(dir)) return null;
  const linhas = [];
  const visitar = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) visitar(f);
      else if (e.isFile()) linhas.push(`${path.relative(dir, f)} ${hashArquivo(f)}`);
    }
  };
  visitar(dir);
  return sha(linhas.join('\n'));
}
function listar(dir) {
  const out = [];
  const visitar = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); out.push(path.relative(dir, f)); if (e.isDirectory()) visitar(f); } };
  if (fs.existsSync(dir)) visitar(dir);
  return out.sort();
}

const home = os.homedir();
const configClaude = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
function alvosGlobais() {
  const alvos = { 'orkastery:projetos.json': () => hashArquivo(path.join(process.env.ORK_USUARIO_DIR || path.join(home, '.orkastery'), 'projetos.json')) };
  if (op.host === 'claude-code') {
    for (const f of ['settings.json', 'plugins/installed_plugins.json', 'plugins/known_marketplaces.json']) {
      alvos[`claude:${f}`] = () => hashArquivo(path.join(configClaude, f));
    }
    if (path.resolve(configClaude) !== path.join(home, '.claude')) alvos['claude:~/.claude/settings.json'] = () => hashArquivo(path.join(home, '.claude/settings.json'));
  } else {
    alvos['openclaw:openclaw.json'] = () => hashArquivo(path.join(home, '.openclaw/openclaw.json'));
    alvos['openclaw:extensions/orkastery'] = () => hashArvore(path.join(home, '.openclaw/extensions/orkastery'));
  }
  return alvos;
}
const fotografar = alvos => Object.fromEntries(Object.entries(alvos).map(([k, f]) => [k, f()]));

/** Ambiente da prova: `ork` desta cópia no PATH e todo estado de usuário do Orkastery na raiz. */
function ambienteDaProva() {
  const bin = path.join(raiz, 'bin');
  fs.mkdirSync(bin);
  const aspas = s => `'${s.replace(/'/g, `'"'"'`)}'`;
  fs.writeFileSync(path.join(bin, 'ork'), `#!/bin/sh\nexec ${aspas(process.execPath)} ${aspas(CLI)} "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, DISABLE_AUTOUPDATER: '1',
    ORK_USUARIO_DIR: path.join(raiz, 'usuario'), ORK_CONTAS_DIR: path.join(raiz, 'contas'),
    ORKASTERY_HOME: path.join(raiz, 'orkastery-home'), ORK_FABRICA_PUBLICAR: '0' };
  delete env.ORK_PROJETO; delete env.ORK_PROJETO_EXPLICITO;
  return env;
}

function prepararFixture(env) {
  const dir = path.join(raiz, 'projeto');
  fs.mkdirSync(dir);
  const git = args => exigir(rodar('git', args, { cwd: dir, env }), `git ${args[0]}`);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'prova@orkastery.invalid']);
  git(['config', 'user.name', 'prova de ativacao']);
  exigir(rodar('ork', ['init', '--name', 'provaativacao', '--abbrev', 'pav'], { cwd: dir, env }), 'ork init');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture da prova de ativacao']);
  const { discoverMaestro } = require(path.join(repo, 'core/dist/maestro-discovery'));
  const ctx = discoverMaestro({ cwd: dir, pinned: dir, countOtherProjects: false });
  return { dir, esperado: { projeto: { nome: ctx.project.name, id: ctx.project.id, raiz: ctx.root, fingerprint: ctx.fingerprint }, home } };
}

function conferirEstado(fixture, antes) {
  const depois = listar(path.join(fixture, '.orkastery'));
  const novos = depois.filter(f => !antes.includes(f));
  recibo.conferencias.push({ id: 'estado.consulta-sem-escrita', ok: novos.length === 0,
    detalhe: novos.length ? `a consulta criou ${novos.join(', ')}` : 'nenhuma thread, demanda ou arquivo novo em .orkastery' });
}

// ---------------------------------------------------------------- Claude Code
function provaClaude(env) {
  const { transcriptDoClaude, conferirProva } = require(path.join(repo, 'core/dist/prova-ativacao'));
  const auth = rodar('claude', ['auth', 'status', '--json'], { env, guardar: false });
  let login = {};
  try { login = JSON.parse(auth.stdout); } catch { /* sem JSON: tratado abaixo */ }
  recibo.comandos.at(-1).stdout = { loggedIn: login.loggedIn ?? null, authMethod: login.authMethod ?? null, apiProvider: login.apiProvider ?? null };
  if (!login.loggedIn) {
    recibo.pendenciasHumanas.push({ passo: 'login do Claude Code nesta máquina', bloqueiaProva: true, comando: 'claude auth login',
      porque: 'a prova usa o login nativo do CLI; nenhuma credencial é copiada' });
    return 'pendente-humano';
  }
  const { dir: fixture, esperado } = prepararFixture(env);
  exigir(rodar('ork', ['adapter', 'install', 'claude-code'], { cwd: fixture, env }), 'ork adapter install claude-code');
  const plugin = path.join(fixture, '.claude/plugins/orkastery');
  exigir(rodar('claude', ['plugin', 'validate', plugin], { cwd: fixture, env }), 'claude plugin validate');
  exigir(rodar('ork', ['mcp', 'install', '--project', fixture, '--host', 'claude-code'], { cwd: fixture, env }), 'ork mcp install');
  const antes = listar(path.join(fixture, '.orkastery'));
  const pastaDoProjeto = path.join(configClaude, 'projects', fixture.replace(/[^A-Za-z0-9]/g, '-'));
  const pastaExistia = fs.existsSync(pastaDoProjeto);
  // D2: plugin e MCP só desta sessão; nada vai ao registro global de plugins. A única permissão
  // concedida é a da consulta somente leitura; o consentimento interativo fica com o dono.
  const sessao = rodar('claude', ['-p', FRASE, '--plugin-dir', plugin, '--mcp-config', path.join(fixture, '.mcp.json'), '--strict-mcp-config',
    '--setting-sources', 'project', '--no-session-persistence', '--allowedTools', 'mcp__orkastery__ork_maestro',
    '--output-format', 'stream-json', '--verbose', '--model', op.modelo], { cwd: fixture, env, timeout: 300000, guardar: false });
  if (!pastaExistia && fs.existsSync(pastaDoProjeto)) {
    fs.rmSync(pastaDoProjeto, { recursive: true, force: true });
    recibo.limpezaDoHost = { removido: path.relative(configClaude, pastaDoProjeto), porque: 'pasta vazia que o CLI cria para o cwd da sessão' };
  }
  exigir(sessao, 'sessão claude -p');
  const transcript = transcriptDoClaude(sessao.stdout);
  recibo.transcript = resumoClaude(sessao.stdout, transcript);
  const r = conferirProva('claude-code', transcript, esperado);
  recibo.conferencias.push(...r.conferencias);
  recibo.snapshot = r.snapshot;
  conferirEstado(fixture, antes);
  recibo.pendenciasHumanas.push(
    { passo: 'confiança na pasta e consentimento do servidor MCP `orkastery` do projeto', bloqueiaProva: false,
      comando: 'cd <projeto> && claude   # aceite "trust this folder" e aprove o servidor orkastery do .mcp.json (ou /mcp)',
      porque: 'sessão interativa pede o aceite uma vez; a prova não interativa recebe o MCP por --mcp-config e não grava aceite' },
    { passo: 'aprovar a tool somente leitura na primeira chamada', bloqueiaProva: false,
      comando: 'na sessão: orkastery maestro   # aprove mcp__orkastery__ork_maestro quando o Claude pedir',
      porque: 'a prova concede só essa tool por --allowedTools, na própria sessão de prova' });
  return 'conferida';
}
function resumoClaude(stdout, t) {
  const eventos = stdout.split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = eventos.find(e => e.type === 'system' && e.subtype === 'init') ?? {};
  const fim = eventos.find(e => e.type === 'result') ?? {};
  recibo.hostVersao = init.claude_code_version ?? recibo.hostVersao;
  const ferramentas = [];
  for (const e of eventos) if (e.type === 'assistant') for (const b of e.message?.content ?? []) if (b.type === 'tool_use') ferramentas.push({ nome: b.name, entrada: b.input });
  return { sessionId: init.session_id ?? null, modelo: init.model ?? null, cwd: init.cwd ?? null,
    plugins: (init.plugins ?? []).map(p => `${p.name}@${p.source}`), mcp: (init.mcp_servers ?? []).map(s => `${s.name}:${s.status}`),
    ferramentasExpostas: (t.ferramentasExpostas ?? []).filter(n => /orkastery|^Bash$|^Skill$|^ToolSearch$/.test(n)),
    totalDeFerramentas: t.ferramentasExpostas?.length ?? null, chamadas: ferramentas,
    resultado: { subtype: fim.subtype ?? null, turnos: fim.num_turns ?? null, duracaoMs: fim.duration_ms ?? null,
      custoUsd: fim.total_cost_usd ?? null, negacoes: fim.permission_denials ?? [] },
    respostaFinal: (t.respostaFinal ?? '').slice(0, 3000) };
}

// ---------------------------------------------------------------- OpenClaw
function provaOpenclaw(env) {
  const { transcriptDoOpenclaw, conferirProva } = require(path.join(repo, 'core/dist/prova-ativacao'));
  const global = JSON.parse(fs.readFileSync(path.join(home, '.openclaw/openclaw.json'), 'utf8'));
  const modelo = op.modelo || global.agents?.defaults?.model?.primary;
  const provedor = typeof modelo === 'string' ? modelo.split('/')[0] : null;
  const config = provedor && global.models?.providers?.[provedor];
  if (!config) throw new Error(`openclaw.modelo: modelo ${modelo ?? '(nenhum)'} sem provedor em models.providers`);
  // D3: só referências de segredo (SecretRef) atravessam para a cópia; valor literal recusa.
  const literal = segredoLiteral(config);
  if (literal) throw new Error(`openclaw.segredo-literal: models.providers.${provedor}.${literal} tem valor literal; use SecretRef`);
  const { dir: fixture, esperado } = prepararFixture(env);
  const estado = path.join(raiz, 'openclaw/state'), workspace = path.join(raiz, 'openclaw/workspace');
  fs.mkdirSync(estado, { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
  const arquivoConfig = path.join(raiz, 'openclaw/openclaw.json');
  fs.writeFileSync(arquivoConfig, JSON.stringify({
    agents: { defaults: { workspace, skipBootstrap: true, model: { primary: modelo } } },
    models: { providers: { [provedor]: config } },
    ...(global.secrets ? { secrets: global.secrets } : {}), ...(global.auth ? { auth: global.auth } : {}),
    tools: global.tools ?? { profile: 'coding' },
    plugins: { entries: { orkastery: { enabled: true } } },
  }, null, 2), { mode: 0o600 });
  const envOc = { ...env, OPENCLAW_STATE_DIR: estado, OPENCLAW_CONFIG_PATH: arquivoConfig, NO_COLOR: '1' };
  delete envOc.FORCE_COLOR;
  // D7: a instalação documentada do adaptador (`ork adapter install openclaw --dir <estado>`) põe a
  // extensão na raiz global DA CÓPIA, que o OpenClaw varre. A prova não roda `openclaw plugins
  // install --force` nem mexe em `plugins.allow`: a revisão de procedência fica com o dono.
  exigir(rodar('ork', ['adapter', 'install', 'openclaw', '--dir', estado], { cwd: fixture, env }), 'ork adapter install openclaw');
  const inspecao = rodar('openclaw', ['plugins', 'inspect', 'orkastery'], { cwd: workspace, env: envOc, timeout: 120000 });
  const linha = rotulo => (inspecao.stdout.split('\n').find(l => l.startsWith(rotulo + ':')) ?? '').slice(rotulo.length + 1).trim() || null;
  recibo.procedencia = { via: 'ork adapter install openclaw --dir <estado da cópia>', status: linha('Status'), origem: linha('Origin'),
    trust: linha('Trust'), aviso: (inspecao.stdout.match(/^WARN: (.*)$/m) ?? [])[1] ?? null };
  const antes = listar(path.join(fixture, '.orkastery'));
  const sessionId = `prova-ativacao-${randomUUID()}`;
  const agente = rodar('openclaw', ['agent', '--local', '--json', '--session-id', sessionId, '-m', FRASE, '--timeout', '240'],
    { cwd: workspace, env: envOc, timeout: 300000, guardar: false });
  exigir(agente, 'openclaw agent --local');
  const json = JSON.parse(agente.stdout);
  const exportar = rodar('openclaw', ['sessions', 'export-trajectory', '--session-key', `agent:main:explicit:${sessionId}`,
    '--json', '--output', 'prova'], { cwd: workspace, env: envOc, timeout: 60000 });
  exigir(exportar, 'openclaw sessions export-trajectory');
  const eventos = fs.readFileSync(path.join(workspace, '.openclaw/trajectory-exports/prova/events.jsonl'), 'utf8');
  const transcript = transcriptDoOpenclaw(eventos, json);
  const meta = json.meta?.agentMeta ?? {};
  recibo.transcript = { sessionId, provedor: meta.provider ?? null, modelo: meta.model ?? null,
    ferramentasExpostasOrk: (transcript.ferramentasExpostas ?? []).filter(n => n.startsWith('ork_')),
    totalDeFerramentas: transcript.ferramentasExpostas?.length ?? null,
    chamadas: transcript.chamadas.map(c => ({ nome: c.ferramenta, via: c.via, entrada: c.argumentos })),
    custoUsd: meta.usage?.cost?.total ?? null, respostaFinal: (transcript.respostaFinal ?? '').slice(0, 3000) };
  const r = conferirProva('openclaw', transcript, esperado);
  recibo.conferencias.push(...r.conferencias);
  recibo.snapshot = r.snapshot;
  conferirEstado(fixture, antes);
  recibo.pendenciasHumanas.push(
    { passo: 'levar a extensão desta versão ao gateway da máquina e reiniciá-lo', bloqueiaProva: false,
      comando: 'ork --version   # precisa ser a versão com ork_network_roadmap (0.5.0+)\nork adapter install openclaw --dir ~/.openclaw && systemctl --user restart openclaw-gateway',
      porque: 'a extensão global da máquina continua a que estava; atualizar e reiniciar o gateway é ato do dono (sequência não executada pela prova)' },
    { passo: 'revisar a procedência da extensão', bloqueiaProva: false,
      comando: 'openclaw plugins inspect orkastery   # "can\'t verify where this plugin came from" até haver pacote oficial (npm/ClawHub)',
      porque: 'o OpenClaw carrega a extensão da raiz global com aviso; confiar nela é decisão do dono' },
    { passo: 'decidir se as outras tools ork_* chegam ao modelo no perfil coding', bloqueiaProva: false,
      comando: 'openclaw config set tools.alsoAllow \'["orkastery"]\' --strict-json   # opcional; sem isso só ork_network_roadmap é exposta',
      porque: 'a frase sem projeto só precisa de ork_network_roadmap; ork_maestro com projeto nomeado e as demais dependem dessa escolha' });
  return 'conferida';
}
function segredoLiteral(obj, prefixo = '') {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    if (typeof v === 'string' && /key|token|secret|password/i.test(k)) return caminho;
    if (v && typeof v === 'object' && !(typeof v.source === 'string' && typeof v.id === 'string')) {
      const achado = segredoLiteral(v, caminho);
      if (achado) return achado;
    }
  }
  return null;
}

// ---------------------------------------------------------------- execução
function principal() {
  const versao = rodar(HOSTS[op.host].bin, ['--version'], { timeout: 30000 });
  if (versao.error?.code === 'ENOENT') {
    recibo.estado = 'host-ausente';
    recibo.erro = `host.ausente: ${HOSTS[op.host].bin} não está no PATH desta máquina`;
    return;
  }
  exigir(versao, `${HOSTS[op.host].bin} --version`);
  recibo.hostVersao = versao.stdout.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').pop();
  if (!fs.existsSync(CLI)) throw new Error('core/dist ausente: rode npm --prefix core run build');
  const alvos = alvosGlobais();
  const antes = fotografar(alvos);
  const env = ambienteDaProva();
  let resultado;
  try {
    resultado = op.host === 'claude-code' ? provaClaude(env) : provaOpenclaw(env);
  } finally {
    const depois = fotografar(alvos);
    recibo.global = { antes, depois, intocado: JSON.stringify(antes) === JSON.stringify(depois) };
  }
  recibo.conferencias.push({ id: 'global.intocado', ok: recibo.global.intocado,
    detalhe: recibo.global.intocado ? `${Object.keys(alvos).length} alvos globais com o mesmo sha256 antes e depois` : 'arquivo global mudou durante a prova' });
  const reprovadas = recibo.conferencias.filter(c => !c.ok);
  recibo.estado = resultado === 'pendente-humano' ? 'pendente-humano' : reprovadas.length ? 'reprovada' : 'aprovada';
}

try { principal(); } catch (e) { recibo.estado = 'falha'; recibo.erro = e.message; }
finally {
  if (op.manter) recibo.limpeza = { raiz, removido: false, porque: '--manter' };
  else { fs.rmSync(raiz, { recursive: true, force: true }); recibo.limpeza = { raiz, removido: !fs.existsSync(raiz) }; }
  recibo.fim = agora();
  let redigir;
  try { ({ redigir } = require(path.join(repo, 'core/dist/prova-ativacao'))); }
  catch { redigir = s => s.replace(/("[^"]*(?:token|secret|password|key)[^"]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDIGIDO]"'); }
  const texto = redigir(JSON.stringify(recibo, null, 2)).split(home).join('~') + '\n';
  if (op.saida) { fs.mkdirSync(path.dirname(op.saida), { recursive: true }); fs.writeFileSync(op.saida, texto); }
  process.stdout.write(texto);
  process.stderr.write(`prova ${op.host}: ${recibo.estado}${recibo.erro ? ` (${recibo.erro})` : ''}\n`);
  process.exitCode = SAIDA[recibo.estado] ?? 1;
}

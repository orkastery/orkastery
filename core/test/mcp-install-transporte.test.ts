import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirTemporario, projetoTemporario, semAutoridadeHitlNoAmbiente } from './apoio';
import { CHAVE_ED25519, IMPRESSAO_ED25519, cliFalsa, sondasFalsas } from './apoio-transporte';
import { configuracaoServidorMcp, instalarMcp } from '../src/mcp-install';
import { dirDaFixacao, lerFixacao } from '../src/mcp-ship-transporte';
import { ambienteDoWorkerDoTransporte, ambienteDoWorkerShip, criarPerfilShipMcp } from '../src/mcp-ship';
import { contextoDoProjeto, validarContextoRuntime } from '../src/runtime-context';
import { instalarAdaptador } from '../src/hosts';
import { novaThread } from '../src/thread';
import { exec } from '../src/util';

semAutoridadeHitlNoAmbiente();
const SSH = 'ssh://git@gitlab.empresa.com:2222/g/p.git';
const HTTPS = 'https://gitlab.empresa.com/g/p.git';
const KEYSCAN = `[gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`;
const sha256 = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function comXdg(fn: (xdg: string) => void): void {
  const xdg = dirTemporario('mcp-install-xdg'), antes = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try { fn(xdg); } finally {
    if (antes === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = antes;
    fs.rmSync(xdg, { recursive: true, force: true });
  }
}
function projetoGitlab(nome: string, url: string) {
  const p = projetoTemporario(nome);
  exec('git', ['remote', 'add', 'origin', url], p.dir);
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nforja:\n  tipo: gitlab\n');
  return p;
}

test('install forja-ssh: sonda, fixa a chave confirmada e grava o transporte; nada no dry-run', () => comXdg(() => {
  const p = projetoGitlab('mcp-install-forja-ssh', SSH);
  try {
    const opcoes = { projeto: p.dir, host: 'claude-code' as const, transporteShip: 'forja-ssh' as const, impressaoSsh: IMPRESSAO_ED25519 };
    const dir = dirDaFixacao(p.dir);
    const seco = instalarMcp({ ...opcoes, dryRun: true, sondasDoTransporte: sondasFalsas({ keyscan: KEYSCAN }) });
    assert.equal(fs.existsSync(seco.arquivo), false);
    assert.equal(fs.existsSync(dir), false);
    assert.match(seco.transporte!.join('\n'), /forja-ssh: .*\[gitlab\.empresa\.com\]:2222 \(ssh-ed25519 SHA256:\+DiY3/);
    assert.match(seco.transporte!.join('\n'), /seria fixada em .*known_hosts; nada foi gravado/);
    assert.doesNotMatch(seco.transporte!.join('\n'), /ficou fixada/);
    const r = instalarMcp({ ...opcoes, sondasDoTransporte: sondasFalsas({ keyscan: KEYSCAN }) });
    assert.match(r.transporte!.join('\n'), /ficou fixada em .*known_hosts/);
    assert.deepEqual(JSON.parse(fs.readFileSync(r.arquivo, 'utf8')).mcpServers.orkastery, configuracaoServidorMcp(p.dir, 'claude-code', undefined, 'forja-ssh'));
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.readFileSync(path.join(dir, 'known_hosts'), 'utf8'), KEYSCAN);
    assert.equal(lerFixacao(p.dir, 'forja-ssh', SSH).fixacao.transporte, 'forja-ssh');
    // Outra maquina: a config chega com o projeto, a fixacao nao; reinstalar refaz so a fixacao.
    const bytes = fs.readFileSync(r.arquivo);
    fs.rmSync(dir, { recursive: true });
    assert.equal(instalarMcp({ ...opcoes, sondasDoTransporte: sondasFalsas({ keyscan: KEYSCAN }) }).estado, 'igual');
    assert.deepEqual(fs.readFileSync(r.arquivo), bytes);
    assert.ok(fs.existsSync(path.join(dir, 'transporte.json')));
  } finally { p.limpar(); }
}));

test('install: trocar de transporte exige reinstalar e nao toca na fixacao instalada', () => comXdg(() => {
  const p = projetoGitlab('mcp-install-troca', SSH);
  try {
    const r = instalarMcp({ projeto: p.dir, host: 'claude-code', transporteShip: 'forja-ssh', impressaoSsh: IMPRESSAO_ED25519,
      sondasDoTransporte: sondasFalsas({ keyscan: KEYSCAN }) });
    const bytes = fs.readFileSync(r.arquivo), fixacao = path.join(dirDaFixacao(p.dir), 'transporte.json'), antes = sha256(fixacao);
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'claude-code', transporteShip: 'github-ssh' }),
      /mcp\.install\.conflict: transporte SHIP instalado e forja-ssh; para trocar, remova a entrada orkastery/);
    exec('git', ['remote', 'set-url', 'origin', HTTPS], p.dir);
    const cli = dirTemporario('mcp-install-cli');
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'claude-code', transporteShip: 'forja-https',
      sondasDoTransporte: sondasFalsas({ binario: cliFalsa(cli) }) }), /instalado e forja-ssh/);
    assert.deepEqual(fs.readFileSync(r.arquivo), bytes);
    assert.equal(sha256(fixacao), antes);
  } finally { p.limpar(); }
}));

test('install sem --ship-transport instala como hoje e propoe o modo do origin, sem rede', () => comXdg(() => {
  const p = projetoGitlab('mcp-install-proposta', SSH);
  try {
    const s = sondasFalsas();
    const r = instalarMcp({ projeto: p.dir, host: 'claude-code', sondasDoTransporte: s });
    assert.deepEqual(JSON.parse(fs.readFileSync(r.arquivo, 'utf8')).mcpServers.orkastery, configuracaoServidorMcp(p.dir, 'claude-code'));
    assert.match(r.transporte!.join('\n'), /--ship-transport forja-ssh/);
    assert.equal(s.chamadas.length + s.logins.length, 0);
    assert.equal(fs.existsSync(dirDaFixacao(p.dir)), false);
    exec('git', ['remote', 'set-url', 'origin', 'git@github.com:o/r.git'], p.dir);
    assert.deepEqual(instalarMcp({ projeto: p.dir, host: 'claude-code' }).transporte, []);
  } finally { p.limpar(); }
}));

test('install recusa forja-https sem helper, com a versao minima, e nada fica gravado', () => comXdg(() => {
  const p = projetoGitlab('mcp-install-sem-helper', HTTPS);
  try {
    const cli = dirTemporario('mcp-install-cli-velha');
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'claude-code', transporteShip: 'forja-https',
      sondasDoTransporte: sondasFalsas({ binario: cliFalsa(cli), versao: 'glab 1.90.0 (x)\n' }) }),
    /mcp\.ship\.transport\.sem-helper: .*glab 1\.90\.0 < 1\.121\.0/);
    assert.equal(fs.existsSync(path.join(p.dir, '.mcp.json')), false);
    assert.equal(fs.existsSync(dirDaFixacao(p.dir)), false);
  } finally { p.limpar(); }
}));

test('install: --ssh-fingerprint so com forja-ssh e no formato SHA256', () => {
  const p = projetoTemporario('mcp-install-impressao');
  try {
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'codex', transporteShip: 'bare-local', impressaoSsh: IMPRESSAO_ED25519 }), /ssh-fingerprint\.invalid/);
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'codex', transporteShip: 'forja-ssh', impressaoSsh: 'SHA256:curta' }), /ssh-fingerprint\.invalid/);
  } finally { p.limpar(); }
});

test('configuracao e contexto aceitam os transportes novos; https segue invalido', () => {
  const p = projetoTemporario('mcp-contexto-transporte');
  try {
    for (const t of ['forja-ssh', 'forja-https'] as const) {
      assert.deepEqual(configuracaoServidorMcp(p.dir, 'claude-code', undefined, t).args.slice(-2), ['--ship-transport', t]);
    }
    assert.throws(() => configuracaoServidorMcp(p.dir, 'claude-code', undefined, 'https' as 'forja-https'), /transport\.invalid/);
    instalarAdaptador('claude-code', { projeto: p.dir });
    const def = configuracaoServidorMcp(p.dir, 'claude-code', undefined, 'forja-https');
    fs.writeFileSync(path.join(p.dir, '.mcp.json'), JSON.stringify({ mcpServers: { orkastery: def } }));
    const t = novaThread(p.carregado, { nome: 'contexto https', modo: 'auto' }).thread;
    const c = contextoDoProjeto(p.dir, 'claude-bg', p.dir, t.id)!;
    assert.equal(c.transporteShip, 'forja-https');
    assert.deepEqual(validarContextoRuntime(c, p.dir).servidor, configuracaoServidorMcp(p.dir, 'claude-code', t.id, 'forja-https'));
    assert.throws(() => validarContextoRuntime({ ...c, transporteShip: 'forja-ssh' }, p.dir), /transporte SHIP difere/);
  } finally { p.limpar(); }
});

test('CLI: enum novo, --ssh-fingerprint so no install forja-ssh, e a sonda recusa sem rede', () => {
  const p = projetoTemporario('mcp-cli-transporte-fixado', true);
  try {
    const cli = path.resolve(__dirname, '../src/index.js'), base = ['--project', p.dir, '--host', 'claude-code'];
    for (const extra of [['--ship-transport', 'forja-https', '--ssh-fingerprint', IMPRESSAO_ED25519],
      ['--ship-transport', 'forja-ssh', '--ssh-fingerprint', 'SHA256:curta'], ['--ssh-fingerprint', IMPRESSAO_ED25519],
      ['--ship-transport', 'forja-ssh', '--ssh-fingerprint', IMPRESSAO_ED25519, `--ssh-fingerprint=${IMPRESSAO_ED25519}`]]) {
      const r = spawnSync(process.execPath, [cli, 'mcp', 'install', ...base, ...extra], { encoding: 'utf8', timeout: 10000 });
      assert.equal(r.status, 1, extra.join(' '));
      assert.match(r.stderr, /uso: ork mcp/);
    }
    const serve = spawnSync(process.execPath, [cli, 'mcp', 'serve', ...base, '--ship-transport', 'forja-ssh', '--ssh-fingerprint', IMPRESSAO_ED25519],
      { encoding: 'utf8', timeout: 5000 });
    assert.equal(serve.status, 1);
    assert.match(serve.stderr, /uso: ork mcp/);
    const sonda = spawnSync(process.execPath, [cli, 'mcp', 'install', ...base, '--ship-transport', 'forja-https'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(sonda.status, 1);
    assert.match(sonda.stderr, /mcp\.ship\.transport\.modo: .*bare-local/);
    assert.equal(fs.existsSync(path.join(p.dir, '.mcp.json')), false);
  } finally { p.limpar(); }
});

test('ambiente do worker do SHIP: nada de GIT_SSH, askpass, TLS desligado ou config de git de quem chama', () => {
  const sujo: NodeJS.ProcessEnv = { HOME: '/home/x', USER: 'x', PATH: '/opt/mal/bin:/usr/bin', GIT_SSH: '/tmp/ssh', GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=no',
    GIT_SSL_NO_VERIFY: '1', GIT_ASKPASS: '/tmp/askpass', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: 'ssh -o x',
    GIT_CONFIG_PARAMETERS: "'http.sslverify'='false'", GIT_CONFIG_GLOBAL: '/tmp/g', GIT_CONFIG_SYSTEM: '/tmp/s', GIT_CONFIG: '/tmp/c',
    LD_PRELOAD: '/tmp/x.so', GIT_PROXY_COMMAND: '/tmp/proxy', GIT_EXEC_PATH: '/tmp/git-core', XDG_CONFIG_HOME: '/home/x/.config',
    LOGNAME: 'x', SSH_AUTH_SOCK: '/run/agente', LANG: 'xx', TMPDIR: '/tmp/mal', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/b', XDG_RUNTIME_DIR: '/run/user/1' };
  const PERMITIDAS = ['HOME', 'LANG', 'LOGNAME', 'PATH', 'SSH_AUTH_SOCK', 'TMPDIR', 'USER', 'XDG_CONFIG_HOME'];
  const proibida = (k: string) => k === 'GIT_SSH' || k === 'GIT_SSH_COMMAND' || k === 'GIT_SSL_NO_VERIFY' || k === 'GIT_ASKPASS' || k.startsWith('GIT_CONFIG');
  const base = ambienteDoWorkerShip(sujo);
  assert.deepEqual(Object.keys(base).sort(), PERMITIDAS);
  assert.deepEqual({ PATH: base.PATH, LANG: base.LANG, TMPDIR: base.TMPDIR }, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: '/tmp' });
  for (const t of ['github-ssh', 'bare-local'] as const) assert.deepEqual(ambienteDoWorkerDoTransporte(t, sujo), base, t);
  const SEM_PERGUNTA = ['GIT_ASKPASS', 'GIT_TERMINAL_PROMPT', 'SSH_ASKPASS_REQUIRE'];
  for (const t of ['forja-ssh', 'forja-https'] as const) {
    const env = ambienteDoWorkerDoTransporte(t, sujo);
    assert.deepEqual(Object.keys(env).sort(), [...PERMITIDAS, ...SEM_PERGUNTA, ...(t === 'forja-https' ? ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] : [])].sort(), t);
    assert.deepEqual(Object.keys(env).filter((k) => proibida(k) && !(k === 'GIT_ASKPASS' && env[k] === '')), [], t);
    assert.equal(env.GIT_ASKPASS, '', t);
  }
  const antes = { ...process.env };
  try {
    Object.assign(process.env, sujo);
    const doPai = ambienteDoWorkerShip();
    assert.deepEqual(Object.keys(doPai).filter((k) => doPai[k] !== undefined && !PERMITIDAS.includes(k)), []);
    assert.deepEqual(Object.keys(doPai).filter(proibida), []);
  } finally {
    for (const k of Object.keys(sujo)) if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k];
  }
});

test('install no outro host nao troca a fixacao que o primeiro ainda usa; sem quem a use, refaz', () => comXdg(() => {
  const p = projetoGitlab('mcp-install-outro-host', SSH);
  try {
    instalarMcp({ projeto: p.dir, host: 'codex', transporteShip: 'forja-ssh', impressaoSsh: IMPRESSAO_ED25519,
      sondasDoTransporte: sondasFalsas({ keyscan: KEYSCAN }) });
    const dir = dirDaFixacao(p.dir), arquivos = ['transporte.json', 'known_hosts'].map((n) => path.join(dir, n));
    const antes = arquivos.map(sha256);
    exec('git', ['remote', 'set-url', 'origin', HTTPS], p.dir);
    const cli = dirTemporario('mcp-install-outro-host-cli');
    const https = () => instalarMcp({ projeto: p.dir, host: 'claude-code', transporteShip: 'forja-https',
      sondasDoTransporte: sondasFalsas({ binario: cliFalsa(cli) }) });
    assert.throws(https, /mcp\.install\.conflict: transporte SHIP instalado e forja-ssh em .*\.codex\/config\.toml/);
    assert.deepEqual(arquivos.map(sha256), antes);
    assert.equal(fs.existsSync(path.join(p.dir, '.mcp.json')), false);
    // Removida a entrada do Codex, como a recusa manda, ninguem usa a fixacao antiga e a troca segue.
    fs.writeFileSync(path.join(p.dir, '.codex', 'config.toml'), '');
    https();
    assert.equal(lerFixacao(p.dir, 'forja-https', HTTPS).fixacao.transporte, 'forja-https');
    assert.equal(fs.existsSync(path.join(dir, 'known_hosts')), false);
  } finally { p.limpar(); }
}));

test('install: fixacao insegura recusa sem sobrescrever; fixacao ilegivel e refeita', () => comXdg(() => {
  const p = projetoGitlab('mcp-install-fixacao-ruim', SSH);
  try {
    const instalar = () => instalarMcp({ projeto: p.dir, host: 'claude-code', transporteShip: 'forja-ssh', impressaoSsh: IMPRESSAO_ED25519,
      sondasDoTransporte: sondasFalsas({ keyscan: KEYSCAN }) });
    instalar();
    const arquivo = path.join(dirDaFixacao(p.dir), 'transporte.json');
    fs.chmodSync(arquivo, 0o644);
    const antes = sha256(arquivo);
    assert.throws(instalar, /mcp\.ship\.transport\.fixacao-insegura/);
    assert.equal(sha256(arquivo), antes);
    fs.chmodSync(arquivo, 0o600);
    fs.writeFileSync(arquivo, '{ quebrado');
    assert.equal(instalar().estado, 'igual');
    assert.equal(lerFixacao(p.dir, 'forja-ssh', SSH).fixacao.transporte, 'forja-ssh');
  } finally { p.limpar(); }
}));

test('install: transporte desconhecido na config instalada nao e repetido na recusa', () => {
  const p = projetoTemporario('mcp-install-transporte-estranho');
  try {
    const def = configuracaoServidorMcp(p.dir, 'claude-code');
    fs.writeFileSync(path.join(p.dir, '.mcp.json'), JSON.stringify({ mcpServers: { orkastery: { ...def, args: [...def.args.slice(0, -1), 'x; rm -rf ~'] } } }));
    assert.throws(() => instalarMcp({ projeto: p.dir, host: 'claude-code' }), (e: Error) =>
      /mcp\.install\.conflict: entrada orkastery divergente/.test(e.message) && !e.message.includes('rm -rf'));
  } finally { p.limpar(); }
});

test('perfil do SHIP: transporte fixado sem fixacao recusa com o comando de instalar; bare-local segue', { skip: process.platform !== 'linux' }, () => {
  // O HOME de teste: a config global de quem roda nao entra na conferencia da config do git.
  const home = dirTemporario('mcp-ship-perfil-home'), antes = process.env.HOME;
  process.env.HOME = home;
  try {
    comXdg(() => {
      const p = projetoTemporario('mcp-ship-perfil-fixado', true);
      try {
        assert.equal(criarPerfilShipMcp(p.dir, 'bare-local').transporte, 'bare-local');
        exec('git', ['remote', 'set-url', 'origin', SSH], p.dir);
        assert.throws(() => criarPerfilShipMcp(p.dir, 'forja-ssh'), /mcp\.ship\.transport\.fixacao-ausente: .*--ship-transport forja-ssh/);
        exec('git', ['remote', 'set-url', 'origin', HTTPS], p.dir);
        assert.throws(() => criarPerfilShipMcp(p.dir, 'forja-https'), /mcp\.ship\.transport\.fixacao-ausente: .*--ship-transport forja-https/);
      } finally { p.limpar(); }
    });
  } finally {
    if (antes === undefined) delete process.env.HOME; else process.env.HOME = antes;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

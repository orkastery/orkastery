/**
 * Perfis fixados do SHIP sem rede: a fixacao e preparada com sondas falsas; o worker recusa antes de qualquer merge
 * cada troca feita depois do startup. A entrega com push provado roda o `ship` no processo do teste, com o mesmo `-c`
 * do perfil e um ssh falso no PATH (o worker de verdade tem PATH fixo `/usr/bin:/bin` e roda o ssh do sistema).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { projetoTemporario, dirTemporario, commitar, ProjetoDeTeste } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { exec } from '../src/util';
import { ship } from '../src/ship';
import { criarPerfilShipMcp, shipMcp, configDeRedeDoPerfil, PedidoShipMcp, ambienteDoWorkerDoTransporte, conferenciaDepoisDoPush } from '../src/mcp-ship';
import { criarServidorMcp } from '../src/mcp-server';
import { criarLeitorExperiencia } from '../src/mcp-experiencia';
import { configDeRede, dirDaFixacao, gravarFixacao, prepararFixacao } from '../src/mcp-ship-transporte';
import { CHAVE_ED25519, CHAVE_RSA, IMPRESSAO_ED25519, PEM, cliFalsa, sondasFalsas } from './apoio-transporte';

const SSH = 'ssh://git@gitlab.empresa.com:2222/g/p.git', HTTPS = 'https://gitlab.empresa.com/g/p.git';
const KEYSCAN = `[gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`;
interface Fixture { p: ProjetoDeTeste; raiz: string; home: string; id: string; pedido: PedidoShipMcp; git: (args: string[]) => string }

async function fixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const home = dirTemporario('mcp-ship-fixado-home'), antes = process.env.HOME, xdg = process.env.XDG_CONFIG_HOME;
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = path.join(home, 'xdg');
  const p = projetoTemporario('mcp-ship-fixado', true);
  try {
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nforja:\n  tipo: gitlab\n');
    exec('git', ['commit', '-qam', 'forja gitlab'], p.dir);
    const t = novaThread(p.carregado, { nome: 'SHIP fixado', modo: 'auto', criarWorktree: true }).thread;
    const sha = commitar(t.worktree!, 'entrega.md', 'entrega da fixture', 'entrega');
    const git = (args: string[]) => { const r = exec('/usr/bin/git', args, p.dir); assert.equal(r.ok, true, r.stderr); return r.stdout; };
    await fn({ p, raiz: p.dir, home, id: t.id, git,
      pedido: { threadId: t.id, expectedSource: sha, expectedDestination: git(['rev-parse', 'main']).trim() } });
  } finally {
    p.limpar();
    if (antes === undefined) delete process.env.HOME; else process.env.HOME = antes;
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = xdg;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
function fixarSsh(f: Fixture, url = SSH, keyscan = KEYSCAN) {
  f.git(['remote', 'set-url', 'origin', url]);
  const prep = prepararFixacao({ raiz: f.raiz, transporte: 'forja-ssh', url, manifesto: { tipo: 'gitlab' }, impressao: IMPRESSAO_ED25519,
    sondas: sondasFalsas({ keyscan }) });
  gravarFixacao(dirDaFixacao(f.raiz), prep);
  return prep;
}
function fixarHttps(f: Fixture, url = HTTPS) {
  f.git(['remote', 'set-url', 'origin', url]);
  const binario = cliFalsa(f.home), ca = path.join(f.home, 'empresa.pem');
  fs.writeFileSync(ca, PEM, { mode: 0o644 });
  const prep = prepararFixacao({ raiz: f.raiz, transporte: 'forja-https', url, manifesto: { tipo: 'gitlab', ca },
    sondas: sondasFalsas({ binario }) });
  gravarFixacao(dirDaFixacao(f.raiz), prep);
  return { prep, binario, ca };
}
/** O worker recusou com o codigo, sem merge, e a recusa nao repete o caminho do origin. */
async function recusaNoWorker(f: Fixture, perfil: ReturnType<typeof criarPerfilShipMcp>, codigo: RegExp): Promise<void> {
  const r = await shipMcp(perfil, f.pedido);
  assert.equal(r.ok, false);
  assert.match(r.erro ?? '', codigo, JSON.stringify(r));
  assert.doesNotMatch(r.erro ?? '', /\/g\/p\.git|\/g\/outro\.git/);
  assert.equal(f.git(['rev-parse', 'main']).trim(), f.pedido.expectedDestination);
  assert.equal(lerLedger(dirThread(f.raiz, f.id)).some((e) => e.tipo === 'ship_done'), false);
}

test('forja-ssh sem fixacao nesta maquina recusa com o comando de instalar', () => fixture(async (f) => {
  f.git(['remote', 'set-url', 'origin', SSH]);
  assert.throws(() => criarPerfilShipMcp(f.raiz, 'forja-ssh'),
    (e: Error) => /^mcp\.ship\.transport\.fixacao-ausente: .*ork mcp install --project \S+ --ship-transport forja-ssh$/.test(e.message)
      && e.message.includes(f.raiz));
  f.git(['remote', 'set-url', 'origin', HTTPS]);
  assert.throws(() => criarPerfilShipMcp(f.raiz, 'forja-https'), /mcp\.ship\.transport\.fixacao-ausente: .*--ship-transport forja-https/);
}));

test('servidor MCP: forja sem fixacao deixa o ork_ship indisponivel com o comando de instalar, e as outras tools seguem', () => fixture(async (f) => {
  f.git(['remote', 'set-url', 'origin', SSH]);
  const server = criarServidorMcp({ projeto: f.raiz, host: 'codex', threadId: f.id, transporteShip: 'forja-ssh' });
  const c = new Client({ name: 'fixture-SHIP-FIXADO', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const chamar = async (name: string, args: Record<string, unknown>) => {
    const r = await c.callTool({ name, arguments: args });
    return { erro: r.isError === true, texto: (r.content as { type: string; text: string }[]).map((x) => x.text).join('') };
  };
  try {
    await server.connect(st); await c.connect(ct);
    const r = await chamar('ork_ship', f.pedido as unknown as Record<string, unknown>);
    assert.equal(r.erro, true);
    assert.match(r.texto, /mcp\.ship\.transport\.fixacao-ausente: .*ork mcp install --project \S+ --ship-transport forja-ssh/);
    const status = await chamar('ork_thread_status', { threadId: f.id });
    assert.equal(status.erro, false, status.texto);
    assert.equal(f.git(['rev-parse', 'main']).trim(), f.pedido.expectedDestination);
  } finally { await c.close(); await server.close(); }
}));

test('forja-ssh fixado: o perfil leva o ssh da chave fixada; github-ssh e bare-local seguem sem -c', () => fixture(async (f) => {
  const prep = fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  assert.equal(perfil.transporte, 'forja-ssh');
  assert.deepEqual(configDeRedeDoPerfil(perfil), configDeRede(prep.fixacao, dirDaFixacao(f.raiz)));
  assert.match(configDeRedeDoPerfil(perfil)[1], /StrictHostKeyChecking=yes .*UserKnownHostsFile=\//);
  // A copia devolvida nao altera o -c do perfil.
  (configDeRedeDoPerfil(perfil) as string[]).push('-c', 'x=y');
  assert.deepEqual(configDeRedeDoPerfil(perfil), configDeRede(prep.fixacao, dirDaFixacao(f.raiz)));
  f.git(['remote', 'set-url', 'origin', f.p.remoto!]);
  assert.deepEqual(configDeRedeDoPerfil(criarPerfilShipMcp(f.raiz, 'bare-local')), []);
  assert.equal(conferenciaDepoisDoPush(criarPerfilShipMcp(f.raiz, 'bare-local')), undefined);
  f.git(['remote', 'set-url', 'origin', 'git@github.com:o/r.git']);
  assert.deepEqual(configDeRedeDoPerfil(criarPerfilShipMcp(f.raiz, 'github-ssh')), []);
  assert.throws(() => configDeRedeDoPerfil({ transporte: 'forja-ssh', destino: 'main' }), /mcp\.ship\.profile\.invalid/);
}));

test('forja-https fixado: helper unico da CLI e CA; o helper do usuario na config passa como inerte', () => fixture(async (f) => {
  fs.writeFileSync(path.join(f.home, '.gitconfig'), '[credential]\n\thelper = store\n');
  const { prep } = fixarHttps(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-https');
  const rede = configDeRedeDoPerfil(perfil);
  assert.deepEqual(rede, configDeRede(prep.fixacao, dirDaFixacao(f.raiz)));
  assert.deepEqual(rede.slice(0, 2), ['-c', 'credential.helper=']);
  assert.ok(rede.includes(`credential.https://gitlab.empresa.com.helper=!${fs.realpathSync(path.join(f.home, 'glab'))} auth git-credential`), rede.join(' '));
  assert.ok(rede.includes(`http.${HTTPS}.sslCAInfo=${path.join(dirDaFixacao(f.raiz), 'ca.pem')}`), rede.join(' '));
}));

test('startup: origin trocado, fixacao de outro modo e URL reescrita por insteadOf recusam', () => fixture(async (f) => {
  fixarSsh(f);
  f.git(['remote', 'set-url', 'origin', 'ssh://git@gitlab.empresa.com:2222/g/outro.git']);
  assert.throws(() => criarPerfilShipMcp(f.raiz, 'forja-ssh'), /fixacao-divergente/);
  f.git(['remote', 'set-url', 'origin', SSH]);
  // pushInsteadOf: o fetch vai a um lugar e o push a outro.
  f.git(['config', `url.ssh://git@gitlab.empresa.com:2222/g/outro.git.pushInsteadOf`, SSH]);
  assert.throws(() => criarPerfilShipMcp(f.raiz, 'forja-ssh'), /mcp\.ship\.(transport\.pushurl|config\.unsupported)/);
  f.git(['config', '--unset', `url.ssh://git@gitlab.empresa.com:2222/g/outro.git.pushInsteadOf`]);
  criarPerfilShipMcp(f.raiz, 'forja-ssh');
  fixarHttps(f);
  f.git(['remote', 'set-url', 'origin', SSH]);
  assert.throws(() => criarPerfilShipMcp(f.raiz, 'forja-ssh'), /fixacao-divergente/);
}));

test('worker: origin trocado depois do startup recusa sem merge', () => fixture(async (f) => {
  fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  f.git(['remote', 'set-url', 'origin', 'ssh://git@gitlab.empresa.com:2222/g/outro.git']);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.changed$/);
}));

test('worker: URL reescrita por insteadOf (fetch e push diferentes, ou os dois) recusa sem merge', () => fixture(async (f) => {
  fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  const chave = 'url.ssh://git@gitlab.empresa.com:2222/g/outro.git.pushInsteadOf';
  f.git(['config', chave, SSH]);
  assert.notEqual(f.git(['remote', 'get-url', '--push', 'origin']).trim(), f.git(['remote', 'get-url', 'origin']).trim());
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.pushurl$/);
  f.git(['config', '--unset', chave]);
  f.git(['config', 'url.ssh://git@gitlab.empresa.com:2222/g/outro.git.insteadOf', SSH]);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.changed$/);
}));

test('worker: transporte.json trocado depois do startup recusa, mesmo com o known_hosts e o hash trocados juntos', () => fixture(async (f) => {
  fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  const dir = dirDaFixacao(f.raiz), arquivo = path.join(dir, 'transporte.json');
  const original = fs.readFileSync(arquivo, 'utf8'), fix = JSON.parse(original);
  fs.writeFileSync(arquivo, JSON.stringify({ ...fix, chaves: [{ tipo: 'ssh-ed25519', impressao: `SHA256:${'A'.repeat(43)}` }] }));
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.fixacao-divergente: /);
  // Quem troca o known_hosts e o hash dele juntos ainda nao passa: a fixacao do startup e a que vale.
  const kh = path.join(dir, 'known_hosts'), novo = `${fs.readFileSync(kh, 'utf8')}[gitlab.empresa.com]:2222 ssh-rsa ${CHAVE_RSA}\n`;
  fs.writeFileSync(kh, novo);
  fs.writeFileSync(arquivo, JSON.stringify({ ...fix, knownHostsSha256: createHash('sha256').update(novo).digest('hex') }));
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.fixacao-divergente: /);
}));

test('worker: fixacao de outro modo gravada depois do startup recusa', () => fixture(async (f) => {
  fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  fixarHttps(f);
  f.git(['remote', 'set-url', 'origin', SSH]);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.fixacao-divergente: .*forja-https != forja-ssh/);
}));

test('worker: known_hosts trocado depois do startup recusa, sem merge', () => fixture(async (f) => {
  fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  fs.appendFileSync(path.join(dirDaFixacao(f.raiz), 'known_hosts'), `[gitlab.empresa.com]:2222 ssh-rsa ${CHAVE_RSA}\n`);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.ssh\.known-hosts-alterado: /);
}));

test('worker: permissao insegura na pasta ou no arquivo da fixacao recusa', () => fixture(async (f) => {
  fixarSsh(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  const dir = dirDaFixacao(f.raiz);
  fs.chmodSync(dir, 0o755);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.fixacao-insegura: /);
  fs.chmodSync(dir, 0o700);
  fs.chmodSync(path.join(dir, 'transporte.json'), 0o644);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.fixacao-insegura: /);
  fs.chmodSync(path.join(dir, 'transporte.json'), 0o600);
  fs.linkSync(path.join(dir, 'known_hosts'), path.join(dir, 'segundo-vinculo'));
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.fixacao-insegura: /);
}));

test('forja-https: CA trocada ou CLI gravavel por outros depois do startup recusam no worker, sem merge', () => fixture(async (f) => {
  const { binario } = fixarHttps(f);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-https');
  const copia = path.join(dirDaFixacao(f.raiz), 'ca.pem');
  fs.writeFileSync(copia, PEM.replace('MIIB', 'MIIC'));
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.ca-alterada: /);
  fs.writeFileSync(copia, PEM);
  fs.chmodSync(binario, 0o777);
  await recusaNoWorker(f, perfil, /^mcp\.ship\.transport\.binario: /);
}));

test('ambiente do worker por transporte: a lista fechada e, nos fixados, so o que o transporte acrescenta', () => {
  const sujo: NodeJS.ProcessEnv = { HOME: '/home/x', USER: 'x', LOGNAME: 'x', XDG_CONFIG_HOME: '/home/x/.config', SSH_AUTH_SOCK: '/run/a',
    PATH: '/opt/mal/bin:/usr/bin', LANG: 'xx', TMPDIR: '/tmp/mal', GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=no', GIT_SSL_NO_VERIFY: '1',
    GIT_CONFIG_PARAMETERS: "'http.sslverify'='false'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: 'x',
    LD_PRELOAD: '/tmp/x.so', GIT_PROXY_COMMAND: '/tmp/proxy', GIT_ASKPASS: '/tmp/askpass', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/b',
    XDG_RUNTIME_DIR: '/run/user/1' };
  const BASE = ['HOME', 'LANG', 'LOGNAME', 'PATH', 'SSH_AUTH_SOCK', 'TMPDIR', 'USER', 'XDG_CONFIG_HOME'];
  const SEM_PERGUNTA = ['GIT_ASKPASS', 'GIT_TERMINAL_PROMPT', 'SSH_ASKPASS_REQUIRE'];
  const chaves = (t: Parameters<typeof ambienteDoWorkerDoTransporte>[0]) => Object.keys(ambienteDoWorkerDoTransporte(t, sujo)).sort();
  assert.deepEqual(chaves('github-ssh'), BASE);
  assert.deepEqual(chaves('bare-local'), BASE);
  assert.deepEqual(chaves('forja-ssh'), [...BASE, ...SEM_PERGUNTA].sort());
  assert.deepEqual(chaves('forja-https'), [...BASE, ...SEM_PERGUNTA, 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'].sort());
  for (const t of ['forja-ssh', 'forja-https'] as const) {
    const env = ambienteDoWorkerDoTransporte(t, sujo);
    assert.deepEqual({ PATH: env.PATH, GIT_ASKPASS: env.GIT_ASKPASS, GIT_TERMINAL_PROMPT: env.GIT_TERMINAL_PROMPT },
      { PATH: '/usr/bin:/bin', GIT_ASKPASS: '', GIT_TERMINAL_PROMPT: '0' });
  }
});

test('consultas do MCP com transporte fixado ficam indisponiveis: o fetch delas nao leva o -c fixado', () => fixture(async (f) => {
  fixarSsh(f);
  const ler = criarLeitorExperiencia(f.raiz, 'forja-ssh');
  const r = await ler('fabrica');
  assert.equal(r.estado, 'indisponivel');
  assert.match(String(r.motivo), /^mcp\.experiencia\.transporte-fixado: consulta indisponível no transporte fixado forja-ssh: /);
  assert.equal((await criarLeitorExperiencia(f.raiz, 'github-ssh')('reservas')).motivo, 'mcp.experiencia.consulta.indisponivel');
}));

test('forja-ssh: entrega com push provado pelo -c do perfil e pelo remoto origin, com o ssh falso no PATH do teste', () => fixture(async (f) => {
  // O origin aponta o bare local por um caminho ssh; o ssh falso confere o known_hosts fixado e serve o bare.
  const bare = f.p.remoto!, url = `ssh://git@gitlab.empresa.com:2222${bare}`;
  fixarSsh(f, url);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  const rede = configDeRedeDoPerfil(perfil), knownHosts = path.join(dirDaFixacao(f.raiz), 'known_hosts');
  const bin = dirTemporario('mcp-ship-fixado-ssh'), log = path.join(bin, 'argv.log'), envLog = path.join(bin, 'env.log');
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nenv | cut -d= -f1 | sort > '${envLog}'\n`
    + `case "$*" in *"UserKnownHostsFile=${knownHosts} "*) ;; *) exit 1;; esac\nfor a; do :; done\neval "git ${'${a#git-}'}"\n`, { mode: 0o755 });
  const antes = { ...process.env };
  try {
    // O ambiente do worker deste transporte, com o ssh falso na frente do PATH fixo.
    const env = ambienteDoWorkerDoTransporte('forja-ssh', { ...process.env, GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=no', LD_PRELOAD: '/x.so' });
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, env, { PATH: `${bin}:${env.PATH}` });
    const r = ship(f.p.carregado, f.id, { para: 'main', remoto: 'origin', configDoRemoto: rede, conferirDepoisDoPush: conferenciaDepoisDoPush(perfil) });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(r.pushVerificado, true);
    assert.ok(r.passos.includes(`git ${rede.join(' ')} push -- origin refs/heads/main:refs/heads/main`), r.passos.join('\n'));
    assert.ok(r.passos.includes(`git ${rede.join(' ')} ls-remote origin refs/heads/main`), r.passos.join('\n'));
    const chamadas = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.ok(chamadas.length >= 2 && chamadas.every((c) => c.includes(`UserKnownHostsFile=${knownHosts} `) && /-p 2222/.test(c)), chamadas.join('\n'));
    assert.ok(chamadas.some((c) => /git-receive-pack/.test(c)));
    const vistas = fs.readFileSync(envLog, 'utf8').split('\n');
    assert.deepEqual(vistas.filter((k) => ['GIT_SSH_COMMAND', 'LD_PRELOAD', 'GIT_SSL_NO_VERIFY', 'GIT_CONFIG_PARAMETERS'].includes(k)), []);
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, antes);
    fs.rmSync(bin, { recursive: true, force: true });
  }
  assert.equal(exec('/usr/bin/git', ['rev-parse', 'main'], bare).stdout.trim(), f.git(['rev-parse', 'main']).trim());
}));

/** Um ssh falso que serve o bare local e, com `acao`, roda um comando no meio do push (o escritor concorrente). */
function sshFalso(acao = ''): { bin: string; log: string } {
  const bin = dirTemporario('mcp-ship-fixado-ssh2'), log = path.join(bin, 'argv.log');
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nfor a; do :; done\n`
    + `case "$a" in *receive-pack*) ${acao || ':'} ;; esac\neval "git ${'${a#git-}'}"\n`, { mode: 0o755 });
  return { bin, log };
}
function comPath<T>(bin: string, fn: () => T): T {
  const antes = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try { return fn(); } finally { process.env.PATH = antes; fs.rmSync(bin, { recursive: true, force: true }); }
}

test('o -c fixado: hook da config do projeto e da pasta hooks nao roda no push, nos dois modos', () => fixture(async (f) => {
  const bare = f.p.remoto!, url = `ssh://git@gitlab.empresa.com:2222${bare}`;
  fixarSsh(f, url);
  const rede = configDeRedeDoPerfil(criarPerfilShipMcp(f.raiz, 'forja-ssh'));
  const marca = path.join(f.home, 'hook-rodou'), hooks = path.join(f.home, 'hooks');
  fs.mkdirSync(hooks);
  for (const d of [hooks, path.join(f.raiz, '.git', 'hooks')]) fs.writeFileSync(path.join(d, 'pre-push'), `#!/bin/sh\necho x >> '${marca}'\n`, { mode: 0o755 });
  const { bin } = sshFalso();
  comPath(bin, () => {
    // Sem o -c, os dois hooks rodam (a pasta hooks, e depois a da config): o ataque e de verdade neste git.
    assert.equal(exec('git', ['push', 'origin', 'HEAD:refs/heads/sem-trava'], f.raiz).ok, true);
    assert.equal(fs.readFileSync(marca, 'utf8').split('\n').filter(Boolean).length, 1);
    f.git(['config', 'core.hooksPath', hooks]);
    assert.equal(exec('git', ['push', 'origin', 'HEAD:refs/heads/sem-trava-2'], f.raiz).ok, true);
    assert.equal(fs.readFileSync(marca, 'utf8').split('\n').filter(Boolean).length, 2);
    const r = exec('git', [...rede, 'push', 'origin', 'HEAD:refs/heads/com-trava'], f.raiz);
    assert.equal(r.ok, true, r.stderr);
    assert.equal(fs.readFileSync(marca, 'utf8').split('\n').filter(Boolean).length, 2);
  });
  // O https leva as mesmas travas.
  const { prep } = fixarHttps(f);
  assert.deepEqual(configDeRede(prep.fixacao, dirDaFixacao(f.raiz)).slice(-6),
    ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always']);
}));

test('o -c fixado: origin trocado para caminho local ou file:// com receivepack/uploadpack proprios recusa no protocolo', () => fixture(async (f) => {
  fixarSsh(f);
  const ssh = configDeRedeDoPerfil(criarPerfilShipMcp(f.raiz, 'forja-ssh'));
  const { prep } = fixarHttps(f);
  const https = configDeRede(prep.fixacao, dirDaFixacao(f.raiz));
  const bare = f.p.remoto!, marca = path.join(f.home, 'pack-rodou');
  for (const origem of [bare, `file://${bare}`]) {
    f.git(['remote', 'set-url', 'origin', origem]);
    f.git(['config', 'remote.origin.receivepack', `sh -c 'echo x >> ${marca}; exec git-receive-pack "$@"' --`]);
    f.git(['config', 'remote.origin.uploadpack', `sh -c 'echo x >> ${marca}; exec git-upload-pack "$@"' --`]);
    for (const rede of [ssh, https]) {
      const push = exec('git', [...rede, 'push', 'origin', 'HEAD:refs/heads/desviado'], f.raiz);
      const ls = exec('git', [...rede, 'ls-remote', 'origin', 'refs/heads/main'], f.raiz);
      assert.equal(push.ok, false); assert.equal(ls.ok, false);
      assert.match(push.stderr + ls.stderr, /transport 'file' not allowed/);
    }
    assert.equal(fs.existsSync(marca), false, origem);
  }
  // Sem o -c, o mesmo origin roda o receivepack do projeto: o ataque e de verdade neste git.
  assert.equal(exec('git', ['push', 'origin', 'HEAD:refs/heads/desviado'], f.raiz).ok, true);
  assert.equal(fs.existsSync(marca), true);
}));

test('origin ou config trocados entre o push e a prova: a entrega nao sai como provada e recusa tipada', () => fixture(async (f) => {
  const bare = f.p.remoto!, url = `ssh://git@gitlab.empresa.com:2222${bare}`;
  fixarSsh(f, url);
  const perfil = criarPerfilShipMcp(f.raiz, 'forja-ssh');
  const rede = configDeRedeDoPerfil(perfil);
  const outro = dirTemporario('mcp-ship-fixado-outro');
  exec('/usr/bin/git', ['clone', '-q', '--bare', bare, path.join(outro, 'p.git')]);
  for (const acao of [`git config --file '${f.raiz}/.git/config' ork.escritor concorrente`,
    `git config --file '${f.raiz}/.git/config' remote.origin.url 'ssh://git@gitlab.empresa.com:2222${outro}/p.git'`]) {
    const antes = exec('/usr/bin/git', ['rev-parse', 'main'], bare).stdout.trim();
    const { bin } = sshFalso(acao);
    let r: ReturnType<typeof ship> | undefined;
    comPath(bin, () => assert.throws(() => { r = ship(f.p.carregado, f.id, { para: 'main', remoto: 'origin', configDoRemoto: rede,
      conferirDepoisDoPush: conferenciaDepoisDoPush(perfil) }); },
    (e: Error) => /^mcp\.ship\.transport\.mudou-no-push: /.test(e.message) && !e.message.includes(bare), acao));
    assert.equal(r, undefined);
    assert.equal(lerLedger(dirThread(f.raiz, f.id)).some((e) => e.tipo === 'ship_done'), false);
    // Volta ao estado do startup para a proxima rodada.
    exec('/usr/bin/git', ['update-ref', 'refs/heads/main', antes], bare);
    exec('/usr/bin/git', ['config', '--unset-all', 'ork.escritor'], f.raiz);
  }
  fs.rmSync(outro, { recursive: true, force: true });
}));

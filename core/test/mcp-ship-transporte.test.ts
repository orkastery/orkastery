import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';
import { CHAVE_ED25519, CHAVE_RSA, IMPRESSAO_ED25519, PEM, cliFalsa } from './apoio-transporte';
import { TRANSPORTES_SHIP_MCP, ehTransporteFixado, ehTransporteShipMcp } from '../src/mcp-transportes';
import {
  ESQUEMA_DA_FIXACAO, FixacaoHttps, FixacaoSsh, RECUSAS_DO_TRANSPORTE, alvoDaCredencial, ambienteDoTransporte, configDeRede,
  conferirFixacao, dirDaFixacao, enderecoDoOrigin, gravarFixacao, impressaoDaChave, lerFixacao, lerKeyscan, lerKnownHosts,
  linhasDoKnownHosts, nomeNoKnownHosts, textoDaFixacao,
} from '../src/mcp-ship-transporte';
import { FORJA_EN, FORJA_PT_BR } from '../src/locale-forja';

const RAIZ = '/projeto/fixado';
const URL_SSH = 'ssh://git@gitlab.empresa.com:2222/g/p.git';
const URL_HTTPS = 'https://gitlab.empresa.com:8929/g/p.git';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const KH = `[gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`;
const FIX_SSH: FixacaoSsh = { schema: ESQUEMA_DA_FIXACAO, raiz: RAIZ, url: URL_SSH, transporte: 'forja-ssh', host: 'gitlab.empresa.com',
  porta: 2222, chaves: [{ tipo: 'ssh-ed25519', impressao: IMPRESSAO_ED25519 }], knownHostsSha256: sha256(KH) };
const fixHttps = (binario: string, ca: FixacaoHttps['ca'] = null): FixacaoHttps => ({ schema: ESQUEMA_DA_FIXACAO, raiz: RAIZ, url: URL_HTTPS,
  transporte: 'forja-https', tipo: 'gitlab', origem: 'https://gitlab.empresa.com:8929', caminho: false, cli: 'glab', binario,
  versaoCli: '1.121.0', ca });
const temSshKeygen = spawnSync('ssh-keygen', ['-?']).error === undefined;

function comBase(fn: (env: NodeJS.ProcessEnv, base: string) => void): void {
  const base = dirTemporario('fixacao');
  try { fn({ HOME: base, XDG_CONFIG_HOME: path.join(base, 'xdg') }, base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('enum dos transportes: os dois fixados entram, o resto continua fora', () => {
  assert.deepEqual([...TRANSPORTES_SHIP_MCP], ['github-ssh', 'forja-ssh', 'forja-https', 'bare-local']);
  assert.equal(ehTransporteShipMcp('forja-https'), true);
  assert.equal(ehTransporteShipMcp('https'), false);
  assert.equal(ehTransporteFixado('forja-ssh'), true);
  assert.equal(ehTransporteFixado('github-ssh'), false);
});

test('impressao no formato do OpenSSH, nome com porta e leitura do ssh-keyscan', () => {
  assert.equal(impressaoDaChave(CHAVE_ED25519), IMPRESSAO_ED25519);
  assert.equal(nomeNoKnownHosts('h.com', 22), 'h.com');
  assert.equal(nomeNoKnownHosts('h.com', 2222), '[h.com]:2222');
  const saida = `# h.com:2222 SSH-2.0-OpenSSH_9.6\n[h.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\nh.com ssh-rsa ${CHAVE_RSA}\n` +
    `[h.com]:2222 ssh-dss AAAA\n[h.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`;
  assert.deepEqual(lerKeyscan(saida, '[h.com]:2222'), [{ tipo: 'ssh-ed25519', chave: CHAVE_ED25519 }]);
});

test('o OpenSSH le o known_hosts fixado no nome com porta e concorda com a impressao', { skip: !temSshKeygen }, () => {
  const dir = dirTemporario('kh-openssh'), arquivo = path.join(dir, 'known_hosts');
  try {
    fs.writeFileSync(arquivo, linhasDoKnownHosts([{ tipo: 'ssh-ed25519', chave: CHAVE_ED25519 }], '[h.com]:2222'));
    const achou = spawnSync('ssh-keygen', ['-F', '[h.com]:2222', '-f', arquivo], { encoding: 'utf8' });
    assert.equal(achou.status, 0);
    assert.ok(achou.stdout.includes(CHAVE_ED25519));
    assert.equal(spawnSync('ssh-keygen', ['-F', 'h.com', '-f', arquivo]).status, 1);
    assert.ok(spawnSync('ssh-keygen', ['-lf', arquivo, '-E', 'sha256'], { encoding: 'utf8' }).stdout.includes(IMPRESSAO_ED25519));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('known_hosts da pessoa: nome em claro, em lista e em hash; @revoked a parte; padrao com curinga nao confirma', () => {
  const sal = randomBytes(20), hash = createHmac('sha1', sal).update('[h.com]:2222').digest('base64');
  const texto = [`h.com,[h.com]:2222 ssh-ed25519 ${CHAVE_ED25519}`, `|1|${sal.toString('base64')}|${hash} ssh-rsa ${CHAVE_RSA}`,
    `*.com ssh-rsa ${CHAVE_RSA}`, `@revoked [h.com]:2222 ssh-rsa ${CHAVE_RSA}`, `@cert-authority [h.com]:2222 ssh-ed25519 ${CHAVE_ED25519}`,
    '# comentario', ''].join('\n');
  const r = lerKnownHosts(texto, '[h.com]:2222');
  assert.deepEqual(r.aceitas, [{ tipo: 'ssh-ed25519', chave: CHAVE_ED25519 }, { tipo: 'ssh-rsa', chave: CHAVE_RSA }]);
  assert.deepEqual(r.revogadas, [{ tipo: 'ssh-rsa', chave: CHAVE_RSA }]);
  assert.deepEqual(lerKnownHosts(texto, 'h.com').aceitas, [{ tipo: 'ssh-ed25519', chave: CHAVE_ED25519 }]);
});

test('forja-ssh: o -c leva o ssh sem config, com a chave fixada e sem pergunta', () => {
  const dir = '/home/u/.config/orkastery/mcp-ship/abc';
  assert.deepEqual(configDeRede(FIX_SSH, dir), ['-c', `core.sshCommand=ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes ` +
    `-o UserKnownHostsFile=${dir}/known_hosts -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o CheckHostIP=no -o ConnectTimeout=30`,
    '-c', 'ssh.variant=ssh']);
  assert.throws(() => configDeRede(FIX_SSH, '/home/u/com espaco'), /mcp\.ship\.transport\.ssh\.caminho/);
});

test('forja-ssh: o git leva as opcoes fixadas e a porta do origin ao ssh', () => {
  const dir = dirTemporario('ssh-falso'), bin = path.join(dir, 'bin'), registro = path.join(dir, 'argv');
  try {
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${registro}'\nexit 255\n`, { mode: 0o755 });
    const r = spawnSync('git', [...configDeRede(FIX_SSH, dir), 'ls-remote', URL_SSH],
      { encoding: 'utf8', env: { HOME: dir, PATH: `${bin}:/usr/bin:/bin`, GIT_CONFIG_NOSYSTEM: '1' } });
    assert.notEqual(r.status, 0);
    const argv = fs.readFileSync(registro, 'utf8').split('\n');
    assert.deepEqual(argv.slice(0, 16), ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${dir}/known_hosts`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no',
      '-o', 'CheckHostIP=no', '-o', 'ConnectTimeout=30']);
    const p = argv.indexOf('-p');
    assert.deepEqual(argv.slice(p, p + 3), ['-p', '2222', 'git@gitlab.empresa.com']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('forja-https: a chave da credencial sai da chave do login da CLI', () => {
  assert.deepEqual(alvoDaCredencial({ tipo: 'gitlab', host: 'gitlab.empresa.com', porta: 8929, caminhoBase: '/gitlab', ca: null }),
    { origem: 'https://gitlab.empresa.com:8929', caminhoBase: '/gitlab' });
  assert.deepEqual(alvoDaCredencial({ tipo: 'github', host: 'github.com', porta: 443, caminhoBase: '', ca: null }),
    { origem: 'https://github.com', caminhoBase: '' });
});

test('forja-https: o -c zera os helpers, fixa um so pela origem e liga a CA', () => {
  assert.deepEqual(configDeRede(fixHttps('/usr/bin/glab', { arquivo: '/etc/pki/e.pem', sha256: '0'.repeat(64) }), '/x'), [
    '-c', 'credential.helper=', '-c', 'credential.https://gitlab.empresa.com:8929.helper=!/usr/bin/glab auth git-credential',
    '-c', 'credential.https://gitlab.empresa.com:8929.useHttpPath=false', '-c', 'http.sslVerify=true',
    '-c', 'http.https://gitlab.empresa.com:8929.sslCAInfo=/etc/pki/e.pem']);
  assert.equal(configDeRede(fixHttps("/opt/c'li/glab"), '/x')[3],
    `credential.https://gitlab.empresa.com:8929.helper=!'/opt/c'\\''li/glab' auth git-credential`);
});

test('forja-https: o git pede a credencial so ao helper fixado, nunca ao da config do usuario', () => {
  const dir = dirTemporario('https-helper'), home = path.join(dir, 'home'), marca = path.join(dir, 'helper-do-usuario-rodou');
  try {
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, '.gitconfig'), `[credential]\n\thelper = "!f() { touch '${marca}'; echo username=u; echo password=do-usuario; }; f"\n` +
      `[credential "https://gitlab.empresa.com:8929"]\n\thelper = "!f() { touch '${marca}'; }; f"\n`);
    const glab = path.join(dir, 'glab');
    fs.writeFileSync(glab, '#!/bin/sh\n[ "$1 $2 $3" = "auth git-credential get" ] || exit 2\necho username=oauth2\necho password=FALSO-DO-TESTE\n', { mode: 0o755 });
    const env = { HOME: home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', ...ambienteDoTransporte('forja-https', {}) };
    const pedir = (host: string) => spawnSync('git', [...configDeRede(fixHttps(glab), dir), 'credential', 'fill'],
      { input: `protocol=https\nhost=${host}\n\n`, encoding: 'utf8', env });
    const r = pedir('gitlab.empresa.com:8929');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^username=oauth2$/m);
    assert.equal(fs.existsSync(marca), false);
    const outro = pedir('outro.empresa.com');
    assert.notEqual(outro.status, 0);
    assert.match(outro.stderr, /terminal prompts disabled/);
    assert.equal(fs.existsSync(marca), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ambiente do worker: sem pergunta nos dois; so o HTTPS leva o barramento do keyring', () => {
  const env = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000', GH_TOKEN: 'nao-leva' };
  assert.deepEqual(ambienteDoTransporte('forja-ssh', env), { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never' });
  assert.deepEqual(ambienteDoTransporte('forja-https', env), { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000' });
});

test('fixacao SSH: gravada 700/600 fora do projeto, lida e conferida; alterada, aberta ou ausente recusa', () => comBase((env, base) => {
  const dir = dirDaFixacao(RAIZ, env);
  assert.ok(dir.startsWith(path.join(base, 'xdg', 'orkastery', 'mcp-ship') + path.sep));
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env),
    /mcp\.ship\.transport\.fixacao-ausente: .*ork mcp install --project \/projeto\/fixado --ship-transport forja-ssh/);
  gravarFixacao(dir, { fixacao: FIX_SSH, knownHosts: KH });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const nome of ['transporte.json', 'known_hosts']) assert.equal(fs.statSync(path.join(dir, nome)).mode & 0o777, 0o600);
  assert.deepEqual(lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), { fixacao: FIX_SSH, dir });
  assert.throws(() => lerFixacao(RAIZ, 'forja-https', URL_SSH, env), /fixacao-divergente/);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', 'ssh://git@gitlab.empresa.com:2222/g/outro.git', env), /fixacao-divergente/);
  const kh = path.join(dir, 'known_hosts');
  fs.chmodSync(kh, 0o644);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.chmodSync(kh, 0o600);
  fs.appendFileSync(kh, `[gitlab.empresa.com]:2222 ssh-rsa ${CHAVE_RSA}\n`);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /ssh\.known-hosts-alterado/);
  fs.writeFileSync(kh, KH);
  fs.chmodSync(dir, 0o755);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(path.join(dir, 'transporte.json'), '{"schema":"outro"}');
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
}));

test('fixacao HTTPS: CLI conferida pelo dono e pela escrita, CA pelo hash; sem known_hosts', () => comBase((env, base) => {
  const bin = cliFalsa(base), ca = path.join(base, 'empresa.pem');
  fs.writeFileSync(ca, PEM, { mode: 0o644 });
  const fix = fixHttps(bin, { arquivo: ca, sha256: sha256(PEM) }), dir = dirDaFixacao(RAIZ, env);
  gravarFixacao(dir, { fixacao: fix });
  assert.deepEqual(lerFixacao(RAIZ, 'forja-https', URL_HTTPS, env).fixacao, fix);
  assert.equal(fs.existsSync(path.join(dir, 'known_hosts')), false);
  fs.writeFileSync(ca, PEM.replace('MIIB', 'MIIC'));
  assert.throws(() => conferirFixacao(fix, dir), /mcp\.ship\.transport\.ca-alterada/);
  fs.writeFileSync(ca, PEM);
  fs.chmodSync(bin, 0o775);
  assert.throws(() => conferirFixacao(fix, dir), /mcp\.ship\.transport\.binario/);
  fs.chmodSync(bin, 0o644);
  assert.throws(() => conferirFixacao(fix, dir), /mcp\.ship\.transport\.binario/);
}));

test('catalogo: a recusa sai com o codigo e o detalhe nas duas linguas', () => {
  const en = FORJA_EN.transporteShip.recusa('mcp.ship.transport.sem-helper', 'glab 1.90.0 < 1.121.0');
  assert.match(en, /^mcp\.ship\.transport\.sem-helper: .*glab 1\.90\.0 < 1\.121\.0/);
  assert.match(FORJA_EN.transporteShip.recusa('mcp.ship.transport.nao-existe', 'x'), /^mcp\.ship\.transport\.nao-existe: x$/);
});

test('catalogo: toda recusa do transporte tem frase propria nas duas linguas', () => {
  for (const c of RECUSAS_DO_TRANSPORTE) {
    for (const m of [FORJA_PT_BR, FORJA_EN]) {
      const t = m.transporteShip.recusa(`mcp.ship.transport.${c}`, 'DETALHE');
      assert.ok(t.startsWith(`mcp.ship.transport.${c}: `), t);
      assert.notEqual(t, `mcp.ship.transport.${c}: DETALHE`, `${c} sem frase`);
    }
  }
  assert.match(textoDaFixacao(FIX_SSH, '/d'), /\[gitlab\.empresa\.com\]:2222 .*ssh-ed25519 SHA256:.*\/d\/known_hosts/);
});

test('origin do transporte: um parse so; http e credencial na URL recusam sem ecoar o token', () => {
  assert.deepEqual(enderecoDoOrigin('forja-ssh', URL_SSH), { transporte: 'forja-ssh', host: 'gitlab.empresa.com', porta: 2222 });
  assert.deepEqual(enderecoDoOrigin('forja-ssh', 'git@GitLab.empresa.com:g/sub/p.git'), { transporte: 'forja-ssh', host: 'gitlab.empresa.com', porta: 22 });
  assert.deepEqual(enderecoDoOrigin('forja-https', URL_HTTPS),
    { transporte: 'forja-https', host: 'gitlab.empresa.com', porta: 8929, origem: 'https://gitlab.empresa.com:8929' });
  assert.deepEqual(enderecoDoOrigin('forja-https', 'https://h.com:443/gitlab/a/b.git'),
    { transporte: 'forja-https', host: 'h.com', porta: null, origem: 'https://h.com' });
  const token = 'glpat-SEGREDO-DO-TESTE';
  for (const url of [`https://oauth2:${token}@h.com/a/b.git`, `https://${token}@h.com/a/b.git`]) {
    assert.throws(() => enderecoDoOrigin('forja-https', url), (e: Error) =>
      /mcp\.ship\.transport\.https\.credencial-na-url/.test(e.message) && !e.message.includes(token));
  }
  assert.throws(() => enderecoDoOrigin('forja-https', `http://u:${token}@h.com/a/b.git`), (e: Error) =>
    /mcp\.ship\.transport\.https\.sem-tls/.test(e.message) && !e.message.includes(token));
  assert.throws(() => enderecoDoOrigin('forja-https', 'http://h.com/a/b.git'), /https\.sem-tls/);
  assert.throws(() => enderecoDoOrigin('forja-https', URL_SSH), /transport\.modo: .*forja-ssh/);
  assert.throws(() => enderecoDoOrigin('forja-ssh', URL_HTTPS), /transport\.modo: .*forja-https/);
  assert.throws(() => enderecoDoOrigin('forja-ssh', '/srv/git/p.git'), /transport\.modo: .*bare-local/);
  assert.throws(() => enderecoDoOrigin('forja-ssh', 'git://h.com/a/b.git'), /transport\.urls/);
});

test('fixacao: link no lugar da pasta, do known_hosts ou da pasta de cima, e segundo vinculo, recusam', () => comBase((env, base) => {
  const dir = dirDaFixacao(RAIZ, env), kh = path.join(dir, 'known_hosts');
  gravarFixacao(dir, { fixacao: FIX_SSH, knownHosts: KH });
  const outro = path.join(base, 'outro');
  fs.mkdirSync(outro, { mode: 0o700 });
  fs.writeFileSync(path.join(outro, 'kh'), KH, { mode: 0o600 });
  fs.rmSync(kh);
  fs.symlinkSync(path.join(outro, 'kh'), kh);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.rmSync(kh);
  fs.linkSync(path.join(outro, 'kh'), kh);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.rmSync(kh);
  fs.writeFileSync(kh, KH, { mode: 0o600 });
  assert.equal(lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env).dir, dir);
  const real = path.join(base, 'pasta-real');
  fs.renameSync(dir, real);
  fs.symlinkSync(real, dir);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.unlinkSync(dir);
  fs.renameSync(real, dir);
  const acima = path.dirname(dir);
  fs.chmodSync(acima, 0o777);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.chmodSync(acima, 0o700);
  assert.equal(lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env).dir, dir);
}));

test('fixacao: host do origin diferente da chave fixada recusa, mesmo com a URL gravada igual', () => comBase((env) => {
  const dir = dirDaFixacao(RAIZ, env), url = 'ssh://git@outro.empresa.com:2222/g/p.git';
  gravarFixacao(dir, { fixacao: { ...FIX_SSH, url }, knownHosts: KH });
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', url, env), /ssh\.divergente/);
  const bin = cliFalsa(path.dirname(dir));
  gravarFixacao(dir, { fixacao: { ...fixHttps(bin), url: 'https://gitlab.empresa.com/g/p.git' } });
  assert.throws(() => lerFixacao(RAIZ, 'forja-https', 'https://gitlab.empresa.com/g/p.git', env), /https\.divergente/);
}));

test('forja-https: nenhum token no -c nem no ambiente do worker', () => {
  const env = { GH_TOKEN: 'gh-SEGREDO', GITLAB_TOKEN: 'gl-SEGREDO', GIT_ASKPASS: '/bin/pergunta', DBUS_SESSION_BUS_ADDRESS: 'unix:x' };
  const tudo = JSON.stringify([configDeRede(fixHttps('/usr/bin/glab'), '/x'), ambienteDoTransporte('forja-https', env)]);
  assert.ok(!/SEGREDO|pergunta/.test(tudo), tudo);
});

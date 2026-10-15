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
  ESQUEMA_DA_FIXACAO, FixacaoHttps, FixacaoSsh, RECUSAS_DO_TRANSPORTE, alvoDaCredencial, ambienteDaCliDoTransporte, ambienteDoTransporte,
  conferirConfigDaCli, configDaCliDoAmbiente, configDeRede,
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
  versaoCli: '1.121.0', configDaCli: null, ca });
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
    '-c', 'ssh.variant=ssh', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-c', 'protocol.ssh.allow=always']);
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
    '-c', `http.${URL_HTTPS}.sslVerify=true`, '-c', `http.${URL_HTTPS}.proxy=`, '-c', `http.${URL_HTTPS}.extraHeader=`,
    '-c', `http.${URL_HTTPS}.followRedirects=false`, '-c', `http.${URL_HTTPS}.sslCAInfo=/x/ca.pem`,
    '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always']);
  assert.throws(() => configDeRede({ ...fixHttps('/usr/bin/glab'), url: 'https://outro.empresa.com:8929/g/p.git' }, '/x'), /https\.divergente/);
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
    const env = { HOME: home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', ...ambienteDoTransporte('forja-https', {}, 'glab') };
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
  assert.deepEqual(ambienteDoTransporte('forja-https', env, 'glab'), { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000',
    GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false' });
  assert.deepEqual(ambienteDoTransporte('forja-https', env, 'gh'), { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000',
    GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1' });
  assert.throws(() => ambienteDoTransporte('forja-https', env), /CLI fixada/);
});

test('ambiente do worker HTTPS: a pasta de config e a variavel da propria CLI; nunca a da outra nem token', () => {
  const env = { GLAB_CONFIG_DIR: '/home/x/glab', GH_CONFIG_DIR: '/home/x/gh', GITLAB_TOKEN: 'a-SEGREDO', GLAB_TOKEN: 'b-SEGREDO', GH_TOKEN: 'c-SEGREDO',
    GITHUB_TOKEN: 'd-SEGREDO', GH_ENTERPRISE_TOKEN: 'e-SEGREDO' };
  const glab = ambienteDoTransporte('forja-https', env, 'glab'), gh = ambienteDoTransporte('forja-https', env, 'gh');
  assert.equal(glab.GLAB_CONFIG_DIR, '/home/x/glab');
  assert.equal(glab.GH_CONFIG_DIR, undefined);
  assert.equal(gh.GH_CONFIG_DIR, '/home/x/gh');
  assert.equal(gh.GLAB_CONFIG_DIR, undefined);
  for (const e of [glab, gh]) assert.ok(!/SEGREDO/.test(JSON.stringify(e)) && !Object.keys(e).some((k) => /TOKEN/.test(k)), JSON.stringify(e));
  // O forja-ssh nao leva nada da CLI.
  assert.equal(ambienteDoTransporte('forja-ssh', env).GLAB_CONFIG_DIR, undefined);
  // Sem a variavel no ambiente de quem chama, nada de config no do worker.
  assert.equal(ambienteDoTransporte('forja-https', {}, 'glab').GLAB_CONFIG_DIR, undefined);
  // A sonda apaga o que o worker nao leva: todo token e a config que nao veio.
  const sonda = ambienteDaCliDoTransporte('glab', { GITLAB_TOKEN: 'x', GLAB_ACCESS_TOKEN: 'y', GH_CONFIG_DIR: '/z' });
  assert.ok(['GITLAB_TOKEN', 'GLAB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GLAB_ACCESS_TOKEN', 'GLAB_CONFIG_DIR'].every((n) => sonda.apagar.includes(n)));
});

test('pasta de config da CLI: relativa ou com caractere de controle recusa, sem o valor na frase, nos dois idiomas', () => {
  for (const [cli, nome] of [['glab', 'GLAB_CONFIG_DIR'], ['gh', 'GH_CONFIG_DIR']] as const) {
    for (const ruim of ['relativo/glab', '~/glab', './glab', '/ok/\nruim', '/ok/\x07']) {
      assert.throws(() => ambienteDoTransporte('forja-https', { [nome]: ruim }, cli), (e: Error) =>
        e.message.startsWith(`mcp.ship.transport.cli-config: ${nome} precisa ser`) && !e.message.includes('ruim') && !e.message.includes('relativo'), ruim);
    }
    assert.equal(configDaCliDoAmbiente(cli, { [nome]: '/abs/ok' }), '/abs/ok');
    assert.equal(configDaCliDoAmbiente(cli, { [nome]: '' }), null);
  }
  assert.match(FORJA_EN.transporteShip.recusa('mcp.ship.transport.cli-config', 'GLAB_CONFIG_DIR'), /^mcp\.ship\.transport\.cli-config: GLAB_CONFIG_DIR must be an absolute path/);
});

test('fixacao HTTPS: a pasta de config fixada precisa ser a do worker; diferente ou ausente recusa', () => {
  const fix = { ...fixHttps('/usr/bin/glab'), configDaCli: '/home/x/glab' };
  conferirConfigDaCli(fix, { GLAB_CONFIG_DIR: '/home/x/glab' });
  for (const env of [{}, { GLAB_CONFIG_DIR: '/outra/glab' }]) {
    assert.throws(() => conferirConfigDaCli(fix, env), /mcp\.ship\.transport\.fixacao-divergente: .*\(GLAB_CONFIG_DIR\)/);
  }
  assert.throws(() => conferirConfigDaCli(fixHttps('/usr/bin/glab'), { GLAB_CONFIG_DIR: '/outra' }), /fixacao-divergente/);
  conferirConfigDaCli(fixHttps('/usr/bin/glab'), {});
  conferirConfigDaCli(FIX_SSH, { GLAB_CONFIG_DIR: '/qualquer' });
});

test('fixacao HTTPS: o formato exige configDaCli nulo ou absoluto', () => comBase((env, base) => {
  const url = URL_HTTPS, dir = dirDaFixacao(RAIZ, env), bin = cliFalsa(base);
  for (const [valor, ok] of [[null, true], ['/home/x/glab', true], ['relativo', false], [7, false]] as const) {
    gravarFixacao(dir, { fixacao: { ...fixHttps(bin), url, configDaCli: valor as string | null } });
    if (ok) assert.equal((lerFixacao(RAIZ, 'forja-https', url, env).fixacao as FixacaoHttps).configDaCli, valor);
    else assert.throws(() => lerFixacao(RAIZ, 'forja-https', url, env), /fixacao-insegura/);
  }
}));

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

test('fixacao HTTPS: CLI pelo caminho real, dono e escrita; CA copiada para a fixacao e conferida pelo hash; sem known_hosts', () => comBase((env, base) => {
  const pastaDaCli = path.join(base, 'bin');
  fs.mkdirSync(pastaDaCli, { mode: 0o700 });
  const bin = cliFalsa(pastaDaCli), ca = path.join(base, 'empresa.pem');
  fs.writeFileSync(ca, PEM, { mode: 0o644 });
  const fix = fixHttps(bin, { arquivo: ca, sha256: sha256(PEM) }), dir = dirDaFixacao(RAIZ, env), copia = path.join(dir, 'ca.pem');
  assert.throws(() => gravarFixacao(dir, { fixacao: fix }), /mcp\.ship\.transport\.ca:/);
  assert.throws(() => gravarFixacao(dir, { fixacao: fix, ca: Buffer.from(PEM.replace('MIIB', 'MIIC')) }), /mcp\.ship\.transport\.ca:/);
  gravarFixacao(dir, { fixacao: fix, ca: Buffer.from(PEM) });
  assert.equal(fs.statSync(copia).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(copia, 'utf8'), PEM);
  assert.deepEqual(lerFixacao(RAIZ, 'forja-https', URL_HTTPS, env).fixacao, fix);
  assert.equal(fs.existsSync(path.join(dir, 'known_hosts')), false);
  assert.ok(configDeRede(fix, dir).includes(`http.${URL_HTTPS}.sslCAInfo=${copia}`));
  // O arquivo de origem (que pode estar no projeto) nao e mais lido: troca-lo nao muda nada.
  fs.writeFileSync(ca, PEM.replace('MIIB', 'MIIC'));
  conferirFixacao(fix, dir);
  fs.writeFileSync(copia, PEM.replace('MIIB', 'MIIC'));
  assert.throws(() => conferirFixacao(fix, dir), /mcp\.ship\.transport\.ca-alterada/);
  fs.rmSync(copia);
  fs.symlinkSync(ca, copia);
  assert.throws(() => conferirFixacao(fix, dir), /fixacao-insegura/);
  fs.rmSync(copia);
  fs.writeFileSync(copia, PEM, { mode: 0o600 });
  conferirFixacao(fix, dir);
  fs.chmodSync(bin, 0o775);
  assert.throws(() => conferirFixacao(fix, dir), /mcp\.ship\.transport\.binario/);
  fs.chmodSync(bin, 0o644);
  assert.throws(() => conferirFixacao(fix, dir), /mcp\.ship\.transport\.binario/);
  fs.chmodSync(bin, 0o755);
  fs.chmodSync(pastaDaCli, 0o770);
  assert.throws(() => conferirFixacao(fix, dir), (e: Error) => /mcp\.ship\.transport\.binario: /.test(e.message) && e.message.includes(`(${pastaDaCli})`));
  fs.chmodSync(pastaDaCli, 0o700);
  conferirFixacao(fix, dir);
  const link = path.join(base, 'glab-link');
  fs.symlinkSync(bin, link);
  assert.throws(() => conferirFixacao({ ...fix, binario: link }, dir), /mcp\.ship\.transport\.binario/);
  assert.ok(configDeRede(fix, dir)[3].includes(`!${bin} auth git-credential`));
  gravarFixacao(dir, { fixacao: fixHttps(bin) });
  assert.equal(fs.existsSync(copia), false);
}));

test('fixacao: pasta acima com escrita de grupo recusa, ate a raiz; formato com caminho relativo ou controle recusa', () => comBase((env, base) => {
  const dir = dirDaFixacao(RAIZ, env), xdg = path.join(base, 'xdg');
  gravarFixacao(dir, { fixacao: FIX_SSH, knownHosts: KH });
  fs.chmodSync(xdg, 0o770);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), (e: Error) => /fixacao-insegura/.test(e.message) && e.message.includes(xdg));
  fs.chmodSync(xdg, 0o700);
  fs.chmodSync(base, 0o757);
  assert.throws(() => lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env), /fixacao-insegura/);
  fs.chmodSync(base, 0o700);
  assert.equal(lerFixacao(RAIZ, 'forja-ssh', URL_SSH, env).dir, dir);
  const bin = cliFalsa(base);
  for (const ruim of [{ ...fixHttps(bin), binario: 'glab' }, { ...fixHttps(bin), binario: `${bin}\n` },
    fixHttps(bin, { arquivo: 'empresa.pem', sha256: sha256(PEM) }), { ...FIX_SSH, host: '-oProxyCommand=x' }]) {
    fs.writeFileSync(path.join(dir, 'transporte.json'), JSON.stringify(ruim));
    assert.throws(() => lerFixacao(RAIZ, ruim.transporte, ruim.url, env), /fixacao-insegura/);
  }
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
  const tudo = JSON.stringify([configDeRede(fixHttps('/usr/bin/glab'), '/x'), ambienteDoTransporte('forja-https', env, 'glab')]);
  assert.ok(!/SEGREDO|pergunta/.test(tudo), tudo);
});

test('forja-https: nenhuma regra http.<url> do ~/.gitconfig vence o -c fixado (TLS, CA, proxy, cabecalho extra)', () => {
  const dir = dirTemporario('https-urlmatch'), home = path.join(dir, 'home');
  try {
    fs.mkdirSync(home);
    const regras = (url: string, n: number) => `[http "${url}"]\n\tsslVerify = false\n\tsslCAInfo = /falsa/ca-${n}.pem\n\tfollowRedirects = true\n` +
      `\tproxy = http://127.0.0.1:${9000 + n}\n\textraHeader = X-Regra-${n}: 1\n`;
    fs.writeFileSync(path.join(home, '.gitconfig'), regras('https://gitlab.empresa.com:8929/', 1) + regras('https://gitlab.empresa.com:8929/g/', 2) +
      regras(URL_HTTPS, 3) + '[http]\n\tsslVerify = false\n');
    const env = { HOME: home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' };
    const ler = (c: string[], chave: string) => spawnSync('git', [...c, 'config', '--get-urlmatch', `http.${chave}`, URL_HTTPS],
      { encoding: 'utf8', env }).stdout.trim();
    assert.equal(ler([], 'sslVerify'), 'false');
    assert.equal(ler([], 'proxy'), 'http://127.0.0.1:9003');
    const c = configDeRede(fixHttps('/usr/bin/glab', { arquivo: '/etc/pki/e.pem', sha256: '0'.repeat(64) }), dir);
    assert.equal(ler(c, 'sslVerify'), 'true');
    assert.equal(ler(c, 'sslCAInfo'), path.join(dir, 'ca.pem'));
    assert.equal(ler([], 'followRedirects'), 'true');
    assert.equal(ler(c, 'followRedirects'), 'false');
    assert.equal(ler(c, 'proxy'), '');
    assert.equal(ler(c, 'extraHeader'), '');
    const tudo = spawnSync('git', [...c, 'config', '--get-urlmatch', 'http', URL_HTTPS], { encoding: 'utf8', env }).stdout;
    assert.ok(!/X-Regra|127\.0\.0\.1|falsa|sslverify false/.test(tudo), tudo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('forja-ssh: senha ou token na URL recusa sem ecoar o segredo; so o usuario passa', () => {
  const segredo = 'SEGREDO-SSH-DO-TESTE';
  for (const url of [`ssh://git:${segredo}@gitlab.empresa.com:2222/g/p.git`, `git:${segredo}@gitlab.empresa.com:g/p.git`,
    `ssh+git://u:${segredo}@gitlab.empresa.com/g/p.git`]) {
    assert.throws(() => enderecoDoOrigin('forja-ssh', url), (e: Error) =>
      /mcp\.ship\.transport\.ssh\.credencial-na-url: /.test(e.message) && !e.message.includes(segredo), url);
  }
  assert.throws(() => enderecoDoOrigin('forja-ssh', 'ssh://git@gitlab.empresa.com/g/a:b@c'), /transport\.urls: /);
  assert.equal(enderecoDoOrigin('forja-ssh', 'git@gitlab.empresa.com:g/p.git').porta, 22);
});

test('recusa do origin nunca ecoa o que veio cru: query, fragmento, userinfo malformado', () => {
  const X = 'MARCA-SECRETA-7731';
  const casos: Array<['forja-ssh' | 'forja-https', string]> = [
    ['forja-https', `https://h.com/g/p.git?private_token=${X}`], ['forja-https', `http://h.com/g/p.git?private_token=${X}`],
    ['forja-https', `https://h.com/g/p.git#${X}`], ['forja-https', `http://h.com/g/p.git#${X}`],
    ['forja-https', `https:/u:${X}@h.com/g/p.git`], ['forja-https', `http:/u:${X}@h.com/g/p.git`],
    ['forja-https', `https://h.com/g/${X}?x`], ['forja-ssh', `ssh://git@h.com/g/p.git?t=${X}`],
    ['forja-ssh', `ssh://git@h.com/g/p.git#${X}`], ['forja-ssh', `https:/u:${X}@h.com/g/p.git`], ['forja-ssh', `git://h.com/${X}/p.git`],
  ];
  for (const [t, url] of casos) {
    let msgDoErro = '';
    try { enderecoDoOrigin(t, url); } catch (e) { msgDoErro = `${(e as Error).message} ${JSON.stringify(e)} ${String(e)}`; }
    assert.ok(/^mcp\.ship\.transport\./.test(msgDoErro), `${t} ${url}: ${msgDoErro}`);
    assert.ok(!msgDoErro.includes(X), `${t} ${url}: ${msgDoErro}`);
  }
  assert.throws(() => enderecoDoOrigin('forja-https', 'http://h.com/g/p.git'), /https\.sem-tls: .*http:\/\/h\.com\)/);
});

test('forja-ssh: usuario ou host com cara de opcao recusa', () => {
  for (const url of ['ssh://-oProxyCommand=x@h.com/g/p.git', '-oProxyCommand=x@h.com:g/p.git', 'ssh://g$t@h.com/g/p.git',
    'ssh://git@-h.com/g/p.git', 'git@-h.com:g/p.git', 'ssh://git@h_x.com/g/p.git']) {
    assert.throws(() => enderecoDoOrigin('forja-ssh', url), /mcp\.ship\.transport\.(urls|modo)/, url);
  }
  assert.equal(enderecoDoOrigin('forja-ssh', 'ssh://deploy.bot_1@h.com/g/p.git').host, 'h.com');
});

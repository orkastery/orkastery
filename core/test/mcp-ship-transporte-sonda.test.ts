import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { dirTemporario } from './apoio';
import { CHAVE_ED25519, CHAVE_RSA, IMPRESSAO_ED25519, PEM, cliFalsa, sondasFalsas } from './apoio-transporte';
import {
  ESQUEMA_DA_FIXACAO, EntradaDaFixacao, FixacaoHttps, FixacaoSsh, SondasDoTransporte, impressaoDaChave, prepararFixacao, proporTransporte,
  sondasPadraoDoTransporte,
} from '../src/mcp-ship-transporte';

const RAIZ = '/projeto/x';
const SSH = 'ssh://git@gitlab.empresa.com:2222/g/p.git';
const HTTPS = 'https://gitlab.empresa.com:8929/g/p.git';
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const KEYSCAN = `# gitlab.empresa.com:2222 SSH-2.0-OpenSSH_9.6\n[gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n` +
  `[gitlab.empresa.com]:2222 ssh-rsa ${CHAVE_RSA}\n`;
const CLI = dirTemporario('sonda-cli');
const GLAB = cliFalsa(CLI, 'glab'), GH = cliFalsa(CLI, 'gh');
/** Outra chave ed25519 bem formada, para a chave trocada no known_hosts. */
const OUTRA_ED25519 = Buffer.concat([Buffer.from(CHAVE_ED25519, 'base64').subarray(0, 19), Buffer.alloc(32, 7)]).toString('base64');

const ssh = (o: Partial<EntradaDaFixacao> = {}, s: SondasDoTransporte = sondasFalsas({ keyscan: KEYSCAN })) =>
  prepararFixacao({ raiz: RAIZ, transporte: 'forja-ssh', url: SSH, manifesto: { tipo: 'gitlab' }, sondas: s, ...o });
const https = (o: Partial<EntradaDaFixacao> = {}, s: SondasDoTransporte = sondasFalsas({ binario: GLAB })) =>
  prepararFixacao({ raiz: RAIZ, transporte: 'forja-https', url: HTTPS, manifesto: { tipo: 'gitlab' }, sondas: s, ...o });
const comDir = (nome: string, fn: (dir: string) => void): void => {
  const dir = dirTemporario(nome);
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('o modo pedido tem de servir ao origin; a proposta sai da URL, sem rede', () => {
  assert.equal(proporTransporte('/srv/bare.git'), 'bare-local');
  assert.equal(proporTransporte('git@github.com:o/r.git'), 'github-ssh');
  assert.equal(proporTransporte('git@gitlab.empresa.com:g/p.git'), 'forja-ssh');
  assert.equal(proporTransporte(SSH), 'forja-ssh');
  assert.equal(proporTransporte(HTTPS), 'forja-https');
  assert.equal(proporTransporte('http://gitlab.empresa.com/g/p.git'), null);
  assert.equal(proporTransporte('ext::sh -c x'), null);
  assert.throws(() => ssh({ url: HTTPS }), /mcp\.ship\.transport\.modo: .*--ship-transport forja-https/);
  assert.throws(() => https({ url: SSH }), /mcp\.ship\.transport\.modo: .*--ship-transport forja-ssh/);
  assert.throws(() => https({ url: '/srv/bare.git' }), /mcp\.ship\.transport\.modo: .*bare-local/);
  assert.throws(() => https({ url: 'http://gitlab.empresa.com/g/p.git' }), /mcp\.ship\.transport\.https\.sem-tls/);
  assert.throws(() => https({ url: 'ext::sh -c x' }), /mcp\.ship\.transport\.urls/);
});

test('a forja do origin tem de resolver; a recusa nunca leva o caminho do origin', () => {
  const s = sondasFalsas({ keyscan: KEYSCAN });
  assert.throws(() => ssh({ manifesto: undefined }, s), /mcp\.ship\.transport\.forja: .*forja\.desconhecida/);
  assert.throws(() => https({ url: 'https://gitlab.empresa.com:8929/segredo/p.git', manifesto: { tipo: 'gitlab', caminho_base: '/gitlab' } }),
    (e: Error) => /mcp\.ship\.transport\.forja: .*remoto-divergente/.test(e.message) && !e.message.includes('segredo'));
  // A porta do manifesto que nao e a do origin para no resolver, antes da origem da credencial.
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', porta: 8443 } }), /mcp\.ship\.transport\.forja: .*remoto-divergente.*8443/);
  assert.equal(s.chamadas.length, 0);
});

test('forja-ssh: a chave so entra confirmada; a recusa lista as impressoes e o comando', () => {
  const s = sondasFalsas({ keyscan: KEYSCAN });
  assert.throws(() => ssh({}, s), (e: Error) => /mcp\.ship\.transport\.ssh\.nao-confirmada/.test(e.message)
    && e.message.includes(IMPRESSAO_ED25519) && e.message.includes(impressaoDaChave(CHAVE_RSA)) && e.message.includes('--ssh-fingerprint'));
  assert.deepEqual(s.chamadas[0], { binario: 'ssh-keyscan', args: ['-T', '10', '-p', '2222', '-t', 'ed25519,ecdsa,rsa', '--', 'gitlab.empresa.com'] });
  const p = ssh({ impressao: IMPRESSAO_ED25519 });
  assert.equal(p.knownHosts, `[gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.deepEqual(p.fixacao, { schema: ESQUEMA_DA_FIXACAO, raiz: RAIZ, url: SSH, transporte: 'forja-ssh', host: 'gitlab.empresa.com', porta: 2222,
    chaves: [{ tipo: 'ssh-ed25519', impressao: IMPRESSAO_ED25519 }], knownHostsSha256: sha256(p.knownHosts!) });
  // A impressao com o `=` do base64 e a mesma.
  assert.equal((ssh({ impressao: `${IMPRESSAO_ED25519}=` }).fixacao as FixacaoSsh).chaves.length, 1);
});

test('forja-ssh: o known_hosts da pessoa confirma, tambem com nome em hash; revogada recusa', () => comDir('sonda-kh', (dir) => {
  const kh = path.join(dir, 'known_hosts');
  const sal = randomBytes(20), hash = createHmac('sha1', sal).update('[gitlab.empresa.com]:2222').digest('base64');
  fs.writeFileSync(kh, `outro.host ssh-ed25519 ${CHAVE_ED25519}\n|1|${sal.toString('base64')}|${hash} ssh-rsa ${CHAVE_RSA}\n`);
  const p = ssh({}, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh }));
  assert.deepEqual((p.fixacao as FixacaoSsh).chaves, [{ tipo: 'ssh-rsa', impressao: impressaoDaChave(CHAVE_RSA) }]);
  fs.appendFileSync(kh, `@revoked [gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh })), /ssh\.revogada/);
}));

test('forja-ssh: o known_hosts que guarda outra chave do mesmo tipo recusa, mesmo com a impressao dita', () => comDir('sonda-kh2', (dir) => {
  const kh = path.join(dir, 'known_hosts');
  fs.writeFileSync(kh, `[gitlab.empresa.com]:2222 ssh-ed25519 ${OUTRA_ED25519}\n`);
  assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh })),
    (e: Error) => /ssh\.impressao-divergente: .*known_hosts/.test(e.message) && e.message.includes(impressaoDaChave(OUTRA_ED25519)));
}));

test('forja-ssh: known_hosts ausente nao confirma nada; known_hosts que nao se le recusa', () => comDir('sonda-kh3', (dir) => {
  assert.throws(() => ssh({}, sondasFalsas({ keyscan: KEYSCAN, knownHosts: path.join(dir, 'falta') })), /ssh\.nao-confirmada/);
  assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: KEYSCAN, knownHosts: dir })), /ssh\.known-hosts-ilegivel/);
}));

test('forja-ssh: impressao que o servidor nao apresentou, servidor mudo, porta divergente e scp na 22', () => {
  assert.throws(() => ssh({ impressao: `SHA256:${'A'.repeat(43)}` }), /ssh\.impressao-divergente/);
  assert.throws(() => ssh({ impressao: 'nao-e-impressao $(x)' }),
    (e: Error) => /ssh\.impressao-divergente: .*\(--ssh-fingerprint;/.test(e.message) && !e.message.includes('$(x)'));
  assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: '' })), /ssh\.sem-resposta: .*forja-https/);
  // A chave de outro nome (porta 22) nao serve ao origin na 2222.
  assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: `gitlab.empresa.com ssh-ed25519 ${CHAVE_ED25519}\n` })),
    /ssh\.sem-resposta/);
  assert.throws(() => ssh({ manifesto: { tipo: 'gitlab', ssh_porta: 22 } }), /ssh\.divergente: .*gitlab\.empresa\.com:2222 != gitlab\.empresa\.com:22/);
  const s = sondasFalsas({ keyscan: `gitlab.empresa.com ssh-ed25519 ${CHAVE_ED25519}\n` });
  const p = ssh({ url: 'git@gitlab.empresa.com:g/p.git', impressao: IMPRESSAO_ED25519 }, s);
  assert.equal(p.knownHosts, `gitlab.empresa.com ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.deepEqual(s.chamadas[0].args, ['-T', '10', '-p', '22', '-t', 'ed25519,ecdsa,rsa', '--', 'gitlab.empresa.com']);
});

test('forja-ssh: o SSH declarado no manifesto e o host do origin; o do github.com tambem se fixa', () => {
  const s = sondasFalsas({ keyscan: `[ssh.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n` });
  const p = ssh({ url: 'ssh://git@ssh.empresa.com:2222/g/p.git', impressao: IMPRESSAO_ED25519,
    manifesto: { tipo: 'gitlab', host: 'gitlab.empresa.com', ssh_host: 'ssh.empresa.com', ssh_porta: 2222 } }, s);
  assert.equal((p.fixacao as FixacaoSsh).host, 'ssh.empresa.com');
  assert.equal(s.chamadas[0].args.at(-1), 'ssh.empresa.com');
  const g = ssh({ url: 'git@github.com:o/r.git', manifesto: undefined, impressao: IMPRESSAO_ED25519 },
    sondasFalsas({ keyscan: `github.com ssh-ed25519 ${CHAVE_ED25519}\n` }));
  assert.equal((g.fixacao as FixacaoSsh).host, 'github.com');
});

test('forja-ssh: host que parece opcao, senha na URL e usuario estranho recusam antes de qualquer rede', () => {
  const s = sondasFalsas({ keyscan: KEYSCAN });
  assert.throws(() => ssh({ url: 'ssh://git@-oProxyCommand=x/g/p.git' }, s), /mcp\.ship\.transport\.urls/);
  assert.throws(() => ssh({ url: 'ssh://git:segredo@gitlab.empresa.com:2222/g/p.git' }, s),
    (e: Error) => /ssh\.credencial-na-url/.test(e.message) && !e.message.includes('segredo'));
  assert.throws(() => ssh({ url: 'ssh://-oX@gitlab.empresa.com:2222/g/p.git' }, s), /mcp\.ship\.transport\.urls/);
  assert.equal(s.chamadas.length, 0);
});

test('forja-https: helper da CLI logada no host exato; nenhuma sonda pede a credencial', () => {
  const s = sondasFalsas({ binario: GLAB });
  const p = https({}, s);
  assert.deepEqual(p.fixacao, { schema: ESQUEMA_DA_FIXACAO, raiz: RAIZ, url: HTTPS, transporte: 'forja-https', tipo: 'gitlab',
    origem: 'https://gitlab.empresa.com:8929', caminho: false, cli: 'glab', binario: GLAB, versaoCli: '1.121.0', ca: null });
  assert.equal(p.knownHosts, undefined);
  assert.equal(p.ca, undefined);
  assert.deepEqual(s.chamadas.map((c) => c.args.join(' ')), ['--version', 'auth git-credential --help']);
  assert.equal(s.logins.length, 1);
  assert.deepEqual(s.logins[0].args, ['auth', 'status', '--hostname', 'gitlab.empresa.com:8929']);
  assert.equal(s.logins[0].acrescentar?.GITLAB_HOST, 'gitlab.empresa.com:8929');
  assert.equal(s.logins[0].reduzido, true);
  const gh = sondasFalsas({ binario: GH, versao: 'gh version 2.18.0 (2022-10-18)\n',
    saidaDoLogin: 'ghe.empresa.com:8443\n  ✓ Logged in to ghe.empresa.com:8443 account eu (keyring)\n' });
  const ghe = prepararFixacao({ raiz: RAIZ, transporte: 'forja-https', url: 'https://ghe.empresa.com:8443/o/r.git', manifesto: { tipo: 'github' }, sondas: gh });
  assert.equal((ghe.fixacao as FixacaoHttps).origem, 'https://ghe.empresa.com:8443');
  assert.equal((ghe.fixacao as FixacaoHttps).cli, 'gh');
  assert.deepEqual(gh.logins[0].args, ['auth', 'status']);
  assert.equal(gh.logins[0].acrescentar?.GH_HOST, 'ghe.empresa.com:8443');
  // Com porta, o login em outro host nao serve.
  assert.throws(() => prepararFixacao({ raiz: RAIZ, transporte: 'forja-https', url: 'https://ghe.empresa.com:8443/o/r.git', manifesto: { tipo: 'github' },
    sondas: sondasFalsas({ binario: GH, versao: 'gh version 2.18.0\n', saidaDoLogin: '✓ Logged in to github.com account eu\n' }) }),
  /sem-login: .*gh ghe\.empresa\.com:8443/);
  // Nenhuma chamada pede ou mostra o token.
  for (const c of [...s.chamadas, ...gh.chamadas]) assert.ok(!c.args.some((a) => a === 'get' || a === '-t' || a === '--show-token'));
  for (const c of [...s.logins, ...gh.logins]) assert.ok(!c.args.some((a) => a === '-t' || a === '--show-token'));
});

test('forja-https: com subcaminho, o login e a origem sao do host[:porta], nunca do caminho base', () => {
  const s = sondasFalsas({ binario: GLAB });
  const p = prepararFixacao({ raiz: RAIZ, transporte: 'forja-https', url: 'https://git.empresa.com:8443/gitlab/a/b.git',
    manifesto: { tipo: 'gitlab', caminho_base: '/gitlab' }, sondas: s });
  assert.equal((p.fixacao as FixacaoHttps).origem, 'https://git.empresa.com:8443');
  assert.equal((p.fixacao as FixacaoHttps).caminho, false);
  assert.deepEqual(s.logins[0].args, ['auth', 'status', '--hostname', 'git.empresa.com:8443']);
  assert.equal(s.logins[0].acrescentar?.GITLAB_HOST, 'git.empresa.com:8443');
});

test('forja-https: sem helper mostra a minima; sem CLI, sem login e credencial na URL recusam; a saida da CLI nao aparece', () => {
  assert.throws(() => https({}, sondasFalsas({ binario: GLAB, versao: 'glab 1.90.0 (x)\n' })), /mcp\.ship\.transport\.sem-helper: .*glab 1\.90\.0 < 1\.121\.0/);
  assert.throws(() => https({}, sondasFalsas({ binario: GLAB, ajuda: false })), /mcp\.ship\.transport\.sem-helper: .*1\.121\.0/);
  assert.throws(() => https({}, sondasFalsas({ binario: GLAB, versao: 'lixo' })), /mcp\.ship\.transport\.sem-helper: .*glab \? < 1\.121\.0/);
  assert.throws(() => https({}, sondasFalsas({ binario: null })), /mcp\.ship\.transport\.sem-cli: .*glab 1\.121\.0/);
  assert.throws(() => https({}, sondasFalsas({ binario: GLAB, login: false, saidaDoLogin: 'Token: glpat-FALSO\n' })),
    (e: Error) => /mcp\.ship\.transport\.sem-login: .*glab gitlab\.empresa\.com:8929/.test(e.message) && !e.message.includes('glpat'));
  assert.throws(() => https({ url: 'https://oauth2:glpat-FALSO@gitlab.empresa.com:8929/g/p.git' }),
    (e: Error) => /https\.credencial-na-url/.test(e.message) && !e.message.includes('glpat'));
  assert.throws(() => https({ url: 'https://eu@gitlab.empresa.com:8929/g/p.git' }), /https\.credencial-na-url/);
});

test('forja-https: a CLI fixada e o caminho real; CLI com escrita de grupo recusa', () => comDir('sonda-bin', (dir) => {
  const real = cliFalsa(dir, 'glab-real'), link = path.join(dir, 'glab');
  fs.symlinkSync(real, link);
  const s = sondasFalsas({ binario: link });
  assert.equal((https({}, s).fixacao as FixacaoHttps).binario, real);
  assert.ok(s.chamadas.every((c) => c.binario === real));
  fs.chmodSync(real, 0o775);
  assert.throws(() => https({}, sondasFalsas({ binario: link })), /mcp\.ship\.transport\.binario/);
}));

test('forja-https: a CA do manifesto entra pelo hash e em bytes; arquivo que nao e PEM, solto ou relativo recusa', () => comDir('sonda-ca', (dir) => {
  const ca = path.join(dir, 'empresa.pem');
  fs.writeFileSync(ca, PEM, { mode: 0o644 });
  const p = https({ manifesto: { tipo: 'gitlab', ca } });
  assert.deepEqual((p.fixacao as FixacaoHttps).ca, { arquivo: ca, sha256: sha256(PEM) });
  assert.equal(p.ca?.toString('utf8'), PEM);
  // Pelo link, le o arquivo real.
  const link = path.join(dir, 'link.pem');
  fs.symlinkSync(ca, link);
  assert.equal(https({ manifesto: { tipo: 'gitlab', ca: link } }).ca?.toString('utf8'), PEM);
  fs.chmodSync(ca, 0o664);
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', ca } }), /mcp\.ship\.transport\.ca: /);
  fs.chmodSync(ca, 0o644);
  fs.writeFileSync(ca, 'nao e certificado');
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', ca } }), /mcp\.ship\.transport\.ca: /);
  fs.writeFileSync(ca, PEM + 'x'.repeat(1048576));
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', ca } }), /mcp\.ship\.transport\.ca: /);
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', ca: path.join(dir, 'falta.pem') } }), /mcp\.ship\.transport\.ca: /);
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', ca: 'empresa.pem' } }), /mcp\.ship\.transport\.ca: /);
  const aberta = path.join(dir, 'aberta');
  fs.mkdirSync(aberta, { mode: 0o777 });
  fs.chmodSync(aberta, 0o777);
  fs.writeFileSync(path.join(aberta, 'ca.pem'), PEM, { mode: 0o644 });
  assert.throws(() => https({ manifesto: { tipo: 'gitlab', ca: path.join(aberta, 'ca.pem') } }), /mcp\.ship\.transport\.ca: /);
}));

test('as sondas padrao: prazo de verdade, ambiente sem token e o known_hosts da HOME dada', () => comDir('sonda-padrao', (dir) => {
  const s = sondasPadraoDoTransporte({ HOME: dir, PATH: '/usr/bin:/bin', GITLAB_TOKEN: 'glpat-FALSO' });
  assert.equal(s.knownHostsDoUsuario, path.join(dir, '.ssh', 'known_hosts'));
  const inicio = Date.now();
  const r = s.rodar('sleep', ['5'], 200);
  assert.equal(r.status, null);
  assert.ok(Date.now() - inicio < 4000);
  const env = s.rodar('env', [], 5000).stdout;
  assert.ok(!env.includes('GITLAB_TOKEN') && !env.includes('glpat'));
  assert.ok(env.includes(`HOME=${dir}`));
}));

test('forja-ssh: @revoked vale para qualquer campo de hosts (curinga, hash, outro nome), mesmo com a impressao dita', () => comDir('sonda-rev', (dir) => {
  const kh = path.join(dir, 'known_hosts');
  for (const campo of ['*', '[*.empresa.com]:2222', 'outro.host', `|1|${randomBytes(20).toString('base64')}|${randomBytes(20).toString('base64')}`]) {
    fs.writeFileSync(kh, `@revoked ${campo} ssh-ed25519 ${CHAVE_ED25519}\n`);
    assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh })), /ssh\.revogada/, campo);
  }
  // A revogacao de OUTRA chave nao barra a boa.
  fs.writeFileSync(kh, `@revoked * ssh-ed25519 ${OUTRA_ED25519}\n`);
  const p = ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh }));
  assert.deepEqual((p.fixacao as FixacaoSsh).chaves, [{ tipo: 'ssh-ed25519', impressao: IMPRESSAO_ED25519 }]);
}));

test('forja-ssh: a negacao tira a linha, como no OpenSSH, mesmo com o nome exato na lista', () => comDir('sonda-neg', (dir) => {
  const kh = path.join(dir, 'known_hosts');
  fs.writeFileSync(kh, `[gitlab.empresa.com]:2222,![gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.throws(() => ssh({}, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh })), /ssh\.nao-confirmada/);
  fs.writeFileSync(kh, `[gitlab.empresa.com]:2222,!*.empresa.com* ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.throws(() => ssh({}, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh })), /ssh\.nao-confirmada/);
  fs.writeFileSync(kh, `[gitlab.empresa.com]:2222,!outro.host ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.equal((ssh({}, sondasFalsas({ keyscan: KEYSCAN, knownHosts: kh })).fixacao as FixacaoSsh).chaves.length, 1);
}));

test('forja-ssh: o known_hosts do sistema so revoga, nunca confirma; ausente ou ilegivel fica de fora', () => comDir('sonda-glob', (dir) => {
  const global = path.join(dir, 'ssh_known_hosts'), global2 = path.join(dir, 'ssh_known_hosts2');
  fs.writeFileSync(global, `[gitlab.empresa.com]:2222 ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.throws(() => ssh({}, sondasFalsas({ keyscan: KEYSCAN, globais: [global, path.join(dir, 'falta'), dir] })), /ssh\.nao-confirmada/);
  fs.writeFileSync(global2, `@revoked * ssh-ed25519 ${CHAVE_ED25519}\n`);
  assert.throws(() => ssh({ impressao: IMPRESSAO_ED25519 }, sondasFalsas({ keyscan: KEYSCAN, globais: [global, global2] })), /ssh\.revogada/);
  assert.deepEqual(sondasPadraoDoTransporte({ HOME: dir }).knownHostsDoSistema, ['/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2']);
}));

test('forja-https: o login roda a CLI conferida que vai ser fixada, nunca a do PATH', () => comDir('sonda-login', (dir) => {
  const conferida = path.join(dir, 'conferida'), doPath = path.join(dir, 'path');
  for (const p of [conferida, doPath]) { fs.mkdirSync(p); fs.chmodSync(p, 0o755); }
  const marca = (nome: string) => path.join(dir, `rodou-${nome}`);
  const script = (pasta: string, nome: string) => {
    const arquivo = path.join(pasta, 'glab');
    fs.writeFileSync(arquivo, `#!/bin/sh\necho "$@" >> '${marca(nome)}'\nexit 0\n`, { mode: 0o755 });
    fs.chmodSync(arquivo, 0o755);
    return arquivo;
  };
  const vetada = script(conferida, 'conferida');
  script(doPath, 'path');
  const s = sondasFalsas({ binario: vetada });
  https({}, s);
  assert.equal(s.logins[0].binario, vetada);
  const antes = process.env.PATH;
  process.env.PATH = `${doPath}:${antes ?? ''}`;
  try {
    const p = https({}, { ...sondasFalsas({ binario: vetada }), rodarCli: undefined });
    assert.equal((p.fixacao as FixacaoHttps).binario, vetada);
  } finally { process.env.PATH = antes; }
  assert.equal(fs.readFileSync(marca('conferida'), 'utf8'), 'auth status --hostname gitlab.empresa.com:8929\n');
  assert.equal(fs.existsSync(marca('path')), false);
}));

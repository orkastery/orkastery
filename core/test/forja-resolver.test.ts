import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VALIDADE_DO_CACHE_MS } from '../src/forja/cache';
import { lerEnderecoDoRemoto } from '../src/forja/endereco';
import { AlvoDaSondagem, resolverForja, SondasDaForja, sondasPadrao } from '../src/forja/resolver';
import { api, cliFalsa, falhou, gravado, http, login, ok } from './forja-cli-falsa';

const remoto = (url: string) => lerEnderecoDoRemoto(url)!;
/** Sonda que nao pode rodar: host conhecido e manifesto com tipo nao sondam. */
const NUNCA: SondasDaForja = { github: () => { throw new Error('sondou o github'); }, gitlab: () => { throw new Error('sondou o gitlab'); } };
const resolver = (url: string, manifesto?: Parameters<typeof resolverForja>[0]['manifesto'], sondas: SondasDaForja = NUNCA) =>
  resolverForja({ endereco: remoto(url), manifesto, sondas });

test('host conhecido resolve sem sondar, e o apelido de SSH vira o host da web', () => {
  const casos: Array<[string, string, string]> = [
    ['https://github.com/o/r.git', 'github', 'github.com'], ['git@github.com:o/r.git', 'github', 'github.com'],
    ['ssh://git@ssh.github.com:443/o/r.git', 'github', 'github.com'], ['https://gitlab.com/g/sub/p.git', 'gitlab', 'gitlab.com'],
    ['ssh://git@altssh.gitlab.com:443/g/p.git', 'gitlab', 'gitlab.com'],
  ];
  for (const [url, tipo, host] of casos) {
    const r = resolver(url);
    assert.ok(r.ok, url);
    assert.equal(r.valor.tipo, tipo, url);
    assert.equal(r.valor.host, host, url);
    assert.equal(r.valor.origem.tipo, 'remoto', url);
  }
  const ssh = resolver('ssh://git@ssh.github.com:443/o/r.git');
  assert.ok(ssh.ok);
  assert.deepEqual([ssh.valor.porta, ssh.valor.sshHost, ssh.valor.sshPorta], [null, 'ssh.github.com', 443]);
});

test('o nome do host não decide o tipo: github.empresa.com que só o glab reconhece é GitLab', () => {
  const r = resolver('https://github.empresa.com/g/sub/p.git', undefined, { github: () => 'sem-login', gitlab: () => 'responde' });
  assert.ok(r.ok);
  assert.equal(r.valor.tipo, 'gitlab');
  assert.equal(r.valor.repo, 'g/sub/p');
  assert.equal(r.valor.origem.tipo, 'sondagem');
});

test('nenhuma sonda responde: forja.desconhecida, com o que cada uma disse', () => {
  const r = resolver('https://git.empresa.com:8443/o/r.git', undefined, { github: () => 'sem-login', gitlab: () => 'nao-responde' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.erro.codigo, 'forja.desconhecida');
  assert.equal(!r.ok && r.erro.detalhe, 'git.empresa.com:8443 (github sem-login, gitlab nao-responde)');
});

test('as duas respondem: forja.ambigua', () => {
  const r = resolver('https://git.empresa.com/o/r.git', undefined, { github: () => 'responde', gitlab: () => 'responde' });
  assert.equal(!r.ok && r.erro.codigo, 'forja.ambigua');
});

test('a sonda recebe o host, a porta, o caminho base e a CA', () => {
  const vistos: AlvoDaSondagem[] = [];
  resolver('https://git.empresa.com:8443/gitlab/g/p.git', { caminho_base: '/gitlab', ca: '/etc/pki/e.pem' },
    { github: (a) => { vistos.push(a); return 'nao-responde'; }, gitlab: (a) => { vistos.push(a); return 'responde'; } });
  assert.deepEqual(vistos[1], { host: 'git.empresa.com', porta: 8443, caminhoBase: '/gitlab', ca: '/etc/pki/e.pem' });
});

test('o manifesto decide tipo e host sem sondar; o remoto SSH em outro host vale pelo ssh_host', () => {
  const r = resolver('ssh://git@ssh.empresa.com:2222/g/sub/p.git',
    { tipo: 'gitlab', host: 'gitlab.empresa.com', ssh_host: 'ssh.empresa.com', ssh_porta: 2222 });
  assert.ok(r.ok);
  assert.deepEqual(r.valor, { tipo: 'gitlab', host: 'gitlab.empresa.com', porta: null, caminhoBase: '', sshHost: 'ssh.empresa.com',
    sshPorta: 2222, ca: null, repo: 'g/sub/p', origem: { tipo: 'manifesto', host: 'manifesto', porta: 'padrao', caminhoBase: 'padrao' } });
});

test('o caminho base sai do caminho do projeto no remoto https, e a porta vem do remoto', () => {
  const r = resolver('https://h.empresa.com:8443/gitlab/g/p.git', { tipo: 'gitlab', caminho_base: '/gitlab' });
  assert.ok(r.ok);
  assert.deepEqual([r.valor.porta, r.valor.caminhoBase, r.valor.repo], [8443, '/gitlab', 'g/p']);
  assert.deepEqual(r.valor.origem, { tipo: 'manifesto', host: 'remoto', porta: 'remoto', caminhoBase: 'manifesto' });
});

test('remoto divergente do manifesto: outro host, outro tipo conhecido ou fora do caminho base', () => {
  for (const [url, manifesto] of [
    ['https://b.empresa.com/o/r.git', { tipo: 'gitlab', host: 'a.empresa.com' }],
    ['https://github.com/o/r.git', { tipo: 'gitlab' }],
    ['https://h.empresa.com/outro/g/p.git', { tipo: 'gitlab', caminho_base: '/gitlab' }],
    ['https://h.empresa.com/gitlab/p.git', { tipo: 'gitlab', caminho_base: '/gitlab' }],
  ] as const) {
    const r = resolver(url, manifesto);
    assert.equal(!r.ok && r.erro.codigo, 'forja.remoto-divergente', url);
  }
});

test('a porta padrão do remoto não é guardada, e a porta do remoto SSH é do SSH, não da API', () => {
  const https = resolver('https://ghe.empresa.com:443/o/r.git', { tipo: 'github' });
  assert.ok(https.ok && https.valor.porta === null && https.valor.origem.porta === 'padrao');
  const ssh = resolver('ssh://git@ghe.empresa.com:2222/o/r.git', { tipo: 'github' });
  assert.ok(ssh.ok);
  assert.deepEqual([ssh.valor.porta, ssh.valor.sshHost, ssh.valor.sshPorta], [null, null, 2222]);
});

test('a sondagem que acha o tipo fica 24 h no cache; a que não acha volta a sondar', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sonda-'));
  const T0 = Date.parse('2026-10-13T12:00:00Z');
  const com = (sondas: SondasDaForja, agoraMs: number) =>
    resolverForja({ endereco: remoto('https://ghe.empresa.com:8443/o/r.git'), sondas, cache, agoraMs });
  try {
    let sondou = 0;
    const desconhecida = com({ github: () => { sondou++; return 'sem-login'; }, gitlab: () => 'sem-login' }, T0);
    assert.equal(!desconhecida.ok && desconhecida.erro.codigo, 'forja.desconhecida');
    assert.ok(com({ github: () => { sondou++; return 'responde'; }, gitlab: () => 'sem-login' }, T0).ok);
    assert.equal(sondou, 2);
    const doCache = com(NUNCA, T0 + VALIDADE_DO_CACHE_MS - 1);
    assert.ok(doCache.ok && doCache.valor.tipo === 'github' && doCache.valor.origem.tipo === 'sondagem');
    assert.throws(() => com(NUNCA, T0 + VALIDADE_DO_CACHE_MS), /sondou o github/);
    assert.ok(JSON.parse(fs.readFileSync(path.join(cache, 'forja.json'), 'utf8'))['sondagem ghe.empresa.com:8443']);
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});

test('sonda padrão do GitLab: sem login, nenhum pedido à API; com login, a resposta gravada da 19.4 responde', () => {
  const alvo = { host: 'git.empresa.com', porta: null, caminhoBase: '', ca: null };
  const sem = cliFalsa([{ quando: login, responde: falhou('has not been authenticated with glab') }]);
  assert.equal(sondasPadrao(sem.rodar, new Map()).gitlab!(alvo), 'sem-login');
  assert.equal(sem.chamadas.filter((c) => c.args[0] === 'api').length, 0);
  const com = cliFalsa([{ quando: login, responde: ok('') }, { quando: api('metadata'), responde: http(200, gravado('gitlab/19.4/metadata')) }]);
  assert.equal(sondasPadrao(com.rodar, new Map()).gitlab!({ ...alvo, caminhoBase: '/gitlab' }), 'responde');
  // O caminho base nunca entra no host: o glab o acrescenta pelo login guardado.
  assert.deepEqual(com.chamadas.find(login)!.args, ['auth', 'status', '--hostname', 'git.empresa.com']);
  assert.equal(com.chamadas.find(api('metadata'))!.acrescentar?.GITLAB_HOST, 'git.empresa.com');
  const outra = cliFalsa([{ quando: login, responde: ok('') }, { quando: api('metadata'), responde: http(404, { message: 'Not Found' }) }]);
  assert.equal(sondasPadrao(outra.rodar, new Map()).gitlab!(alvo), 'nao-responde');
});

test('sonda padrão do GitHub: confere o login, depois o /meta; em subcaminho nem pergunta', () => {
  const alvo = { host: 'ghe.empresa.com', porta: null, caminhoBase: '', ca: null };
  const sem = cliFalsa([{ quando: login, responde: falhou('You are not logged into any GitHub hosts') }]);
  assert.equal(sondasPadrao(sem.rodar).github!(alvo), 'sem-login');
  assert.equal(sem.chamadas.length, 1);
  const ghes = cliFalsa([{ quando: login, responde: ok('') },
    { quando: api('meta'), responde: http(200, { verifiable_password_authentication: false, installed_version: '3.14.2' }) }]);
  assert.equal(sondasPadrao(ghes.rodar).github!(alvo), 'responde');
  const naoGithub = cliFalsa([{ quando: login, responde: ok('') }, { quando: api('meta'), responde: http(200, { version: '19.2.7' }) }]);
  assert.equal(sondasPadrao(naoGithub.rodar).github!(alvo), 'nao-responde');
  const nada = cliFalsa([]);
  assert.equal(sondasPadrao(nada.rodar).github!({ ...alvo, caminhoBase: '/gitlab' }), 'nao-responde');
  assert.equal(nada.chamadas.length, 0);
});

test('o cache com tipo estranho ou JSON corrompido é ignorado, e a dúvida (ambígua) não é guardada', () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sonda-'));
  const T0 = Date.parse('2026-10-13T12:00:00Z');
  const chave = 'sondagem ghe.empresa.com:8443';
  const com = (sondas: SondasDaForja) => resolverForja({ endereco: remoto('https://ghe.empresa.com:8443/o/r.git'), sondas, cache, agoraMs: T0 });
  const arquivo = path.join(cache, 'forja.json');
  try {
    for (const tipo of ['bitbucket', 42, null, { x: 1 }]) {
      fs.writeFileSync(arquivo, JSON.stringify({ [chave]: { tipo, lidoEm: new Date(T0).toISOString() } }));
      let sondou = 0;
      const r = com({ github: () => { sondou++; return 'nao-responde'; }, gitlab: () => 'responde' });
      assert.ok(r.ok && r.valor.tipo === 'gitlab', String(tipo));
      assert.equal(sondou, 1, String(tipo));
    }
    fs.writeFileSync(arquivo, '{ nao e json');
    assert.ok(com({ github: () => 'nao-responde', gitlab: () => 'responde' }).ok);
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8'))[chave].tipo, 'gitlab');
    fs.rmSync(arquivo);
    const ambigua = com({ github: () => 'responde', gitlab: () => 'responde' });
    assert.equal(!ambigua.ok && ambigua.erro.codigo, 'forja.ambigua');
    assert.equal(fs.existsSync(arquivo), false);
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});

test('a porta declarada no manifesto tem origem manifesto', () => {
  const r = resolver('https://h.empresa.com:8443/o/r.git', { tipo: 'github', porta: 8443 });
  assert.ok(r.ok);
  assert.equal(r.valor.porta, 8443);
  assert.equal(r.valor.origem.porta, 'manifesto');
});

test('o manifesto não desvia o gate: host conhecido, porta do remoto e SSH declarado', () => {
  const divergente = (url: string, m: NonNullable<Parameters<typeof resolverForja>[0]['manifesto']>) => {
    const r = resolver(url, m);
    assert.equal(!r.ok && r.erro.codigo, 'forja.remoto-divergente', `${url} ${JSON.stringify(m)}`);
  };
  divergente('https://github.com/o/r.git', { tipo: 'github', host: 'ghe.evil.com', ssh_host: 'github.com' });
  divergente('git@github.com:o/r.git', { tipo: 'github', host: 'ghe.evil.com', ssh_host: 'github.com' });
  divergente('https://ghe.empresa.com:8443/o/r.git', { tipo: 'github', host: 'ghe.empresa.com', porta: 9443 });
  divergente('https://github.com/o/r.git', { tipo: 'github', porta: 8443 });
  divergente('https://ghe.empresa.com/o/r.git', { tipo: 'github', host: 'ghe.empresa.com', porta: 8443 });
  divergente('git@git.empresa.com:o/r.git', { tipo: 'github', host: 'ghe.evil.com' });
  divergente('git@ssh.ghe.x:o/r.git', { tipo: 'github', host: 'github.com', ssh_host: 'ssh.ghe.x' });
  divergente('ssh://git@ssh.ghe.x/o/r.git', { tipo: 'gitlab', host: 'altssh.gitlab.com', ssh_host: 'ssh.ghe.x' });
  divergente('git://git.empresa.com/o/r.git', { tipo: 'github', host: 'git2.empresa.com', ssh_host: 'git.empresa.com' });
});

test('o SSH em outro host vale pelo ssh_host: a API é o host da web declarado', () => {
  const r = resolver('git@ssh.empresa.com:o/r.git', { tipo: 'github', host: 'git.empresa.com', ssh_host: 'ssh.empresa.com' });
  assert.ok(r.ok);
  assert.deepEqual([r.valor.host, r.valor.sshHost, r.valor.porta], ['git.empresa.com', 'ssh.empresa.com', null]);
  const web = resolver('https://ghe.empresa.com:8443/o/r.git', { tipo: 'github', host: 'ghe.empresa.com', porta: 8443 });
  assert.ok(web.ok && web.valor.porta === 8443);
});

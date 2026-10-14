import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { exec } from '../src/util';
import { ship, shaNoRemoto } from '../src/ship';
import { ESQUEMA_DA_FIXACAO, configDeRede, type FixacaoHttps, type FixacaoSsh } from '../src/mcp-ship-transporte';
import { novaThread } from '../src/thread';
import { commitar, dirTemporario, projetoTemporario, shaDaBranch, shaNoRemotoDeTeste } from './apoio';

const URL_SSH = 'ssh://git@forja.test/grupo/projeto.git';
const URL_HTTPS = 'https://gitlab.empresa.com:8929/g/p.git';
const FIX_SSH: FixacaoSsh = { schema: ESQUEMA_DA_FIXACAO, raiz: '/r', url: URL_SSH, transporte: 'forja-ssh', host: 'forja.test', porta: 22,
  chaves: [], knownHostsSha256: '0'.repeat(64) };
const fixHttps = (binario: string, ca: FixacaoHttps['ca']): FixacaoHttps => ({ schema: ESQUEMA_DA_FIXACAO, raiz: '/r', url: URL_HTTPS,
  transporte: 'forja-https', tipo: 'gitlab', origem: 'https://gitlab.empresa.com:8929', caminho: false, cli: 'glab', binario, versaoCli: '1.121.0', ca });

// O ssh falso: registra o argv e, no lugar da rede, roda o git-upload-pack/git-receive-pack contra um bare local.
// Com o arquivo `recusa`, sai com erro (o transporte que nao deixa passar).
interface Ssh { dir: string; log: string; recusa: string; config: string[] }
let ssh: Ssh;
let pathAntes: string | undefined;
beforeEach(() => {
  const dir = dirTemporario('ssh-falso');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'argv.log'), recusa = path.join(dir, 'recusa');
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n[ -e '${recusa}' ] && exit 1\nfor a; do :; done\neval "git ${'${a#git-}'}"\n`, { mode: 0o755 });
  pathAntes = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${pathAntes ?? ''}`;
  ssh = { dir, log, recusa, config: configDeRede(FIX_SSH, dir) };
});
afterEach(() => {
  process.env.PATH = pathAntes;
  fs.rmSync(ssh.dir, { recursive: true, force: true });
});

const chamadas = (): string[] => (fs.existsSync(ssh.log) ? fs.readFileSync(ssh.log, 'utf8').split('\n').filter(Boolean) : []);

function entrega(nome: string) {
  const projeto = projetoTemporario(nome, true);
  const { thread } = novaThread(projeto.carregado, { nome, modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', `# ${thread.id}\n`, `feat: entrega de ${thread.id}`);
  // O origin passa a ser uma URL ssh que o ssh falso serve com o bare local.
  const bare = projeto.remoto as string;
  exec('git', ['remote', 'set-url', 'origin', `ssh://git@forja.test${bare}`], projeto.dir);
  return { projeto, thread };
}

test('o ls-remote leva a config do remoto antes do subcomando, e so a ele', () => {
  const { projeto } = entrega('ship-config-ls-remote');
  try {
    const main = shaNoRemotoDeTeste(projeto.remoto as string, projeto.remoto as string, 'main');
    assert.equal(shaNoRemoto(projeto.dir, 'origin', 'main', ssh.config), main);
    const c = chamadas();
    assert.equal(c.length, 1);
    assert.match(c[0], /^-F \/dev\/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\S+\/known_hosts /);
    assert.match(c[0], /git-upload-pack/);
  } finally { projeto.limpar(); }
});

test('a config chega ao push: o transporte recusa, o ship bloqueia sem tocar no remoto', () => {
  const { projeto, thread } = entrega('ship-config-push-bloqueado');
  try {
    fs.writeFileSync(ssh.recusa, '');
    const remotoAntes = shaNoRemotoDeTeste(projeto.dir, projeto.remoto as string, 'main');
    const r = ship(projeto.carregado, thread.id, { para: 'main', configDoRemoto: ssh.config });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.pushVerificado, false);
    assert.ok(r.passos.includes(`git ${ssh.config.join(' ')} push -u -- origin refs/heads/main:refs/heads/main`), r.passos.join('\n'));
    assert.equal(shaNoRemotoDeTeste(projeto.dir, projeto.remoto as string, 'main'), remotoAntes);
  } finally { projeto.limpar(); }
});

test('com a config aceita, o push e a prova saem com o mesmo -c nos passos, e nenhum outro git leva o ssh fixado', () => {
  const { projeto, thread } = entrega('ship-config-push-ok');
  try {
    const r = ship(projeto.carregado, thread.id, { para: 'main', configDoRemoto: ssh.config });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(r.pushVerificado, true);
    const c = ssh.config.join(' ');
    assert.ok(r.passos.includes(`git ${c} push -- origin refs/heads/main:refs/heads/main`), r.passos.join('\n'));
    assert.ok(r.passos.includes(`git ${c} ls-remote origin refs/heads/main`), r.passos.join('\n'));
    // Toda chamada ao ssh trouxe o comando fixado, e so houve as do ls-remote (2) e a do push (1).
    const feitas = chamadas();
    assert.equal(feitas.length, 3, feitas.join('\n'));
    assert.ok(feitas.every((l) => l.startsWith('-F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes')), feitas.join('\n'));
    assert.equal(feitas.filter((l) => /git-receive-pack/.test(l)).length, 1);
    assert.equal(shaNoRemotoDeTeste(projeto.dir, projeto.remoto as string, 'main'), r.pontaDaBase);
  } finally { projeto.limpar(); }
});

test('sem config do remoto, os passos do push ficam como sempre', () => {
  const projeto = projetoTemporario('ship-config-sem', true);
  try {
    const { thread } = novaThread(projeto.carregado, { nome: 'ship-config-sem', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', `# ${thread.id}\n`, `feat: entrega de ${thread.id}`);
    const r = ship(projeto.carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.ok(r.passos.includes('git push -- origin refs/heads/main:refs/heads/main'), r.passos.join('\n'));
    assert.ok(r.passos.includes('git ls-remote origin refs/heads/main'));
  } finally { projeto.limpar(); }
});

const refusa = (config: string[], chave?: string) => (e: unknown) => {
  const t = (e as Error).message;
  assert.match(t, /ship\.config-do-remoto\.invalida/);
  // O valor recusado nunca aparece na mensagem.
  for (const par of config.filter((_, i) => i % 2 === 1)) { const v = par.slice(par.indexOf('=') + 1); if (v.length > 3) assert.ok(!t.includes(v), `${t} vaza ${v}`); }
  if (chave) assert.ok(t.includes(chave), t);
  return true;
};

test('config fora da forma, de chave desconhecida ou de valor fora do fixado recusa antes de qualquer git', () => {
  const { projeto, thread } = entrega('ship-config-invalida');
  try {
    const main = shaDaBranch(projeto.dir, 'main');
    const u = URL_HTTPS, o = 'https://gitlab.empresa.com:8929';
    const bin = '/usr/bin/glab';
    const invalidas: string[][] = [
      ['--upload-pack=touch /tmp/x'], ['-c'], ['-c', 'sem-igual'], ['-c', 'a.b=c', '--exec=x'], ['-c', '-c=x'], ['-c', 'ssh.variant=ssh', '-c'],
      ['-c', 'core.fsmonitor=/tmp/x'], ['-c', 'protocol.ext.allow=always'], ['-c', 'protocol.file.allow=always'],
      ['-c', `http.${u}.sslCert=/tmp/x`], ['-c', 'url.file:///tmp/.insteadOf=https://h/'], ['-c', 'alias.push=!x'],
      ['-c', 'http.sslVerify=false'], ['-c', `http.${u}.sslVerify=false`], ['-c', `http.${u}.proxy=http://evil:3128`],
      ['-c', `http.${u}.extraHeader=Authorization: Basic SEGREDO123`], ['-c', `http.${u}.followRedirects=true`],
      ['-c', `http.${u}.sslCAInfo=/tmp/outra.pem`], ['-c', `http.${u}.sslCAInfo=relativo/ca.pem`],
      ['-c', 'credential.helper=!x'], ['-c', 'ssh.variant=simple'], ['-c', `credential.${o}.useHttpPath=talvez`],
      ['-c', `credential.${o}.helper=!${bin} auth git-credential; touch /tmp/x`], ['-c', `credential.${o}.helper=!${bin} auth git-credential $(x)`],
      ['-c', `credential.${o}.helper=!sh -c x`], ['-c', `credential.${o}.helper=!relativo/glab auth git-credential`],
      ['-c', `credential.${o}.helper=${bin}`],
      ['-c', 'core.sshCommand=sh -c x'], ['-c', `${ssh.config[1]} -o ProxyCommand=x`], ['-c', ssh.config[1].replace('ssh -F', 'ssh -o ProxyCommand=x -F')],
      ['-c', ssh.config[1].replace('StrictHostKeyChecking=yes', 'StrictHostKeyChecking=no')],
      ['-c', ssh.config[1].replace('known_hosts', 'known_hosts; touch /tmp/x')],
      ['-c', ssh.config[1].replace('\n', '') + '\nx'],
      // duas URLs na mesma lista, ou origem que nao e a da URL
      ['-c', `http.${u}.sslVerify=true`, '-c', 'http.https://outro.com/g/p.git.proxy='],
      ['-c', `http.${u}.sslVerify=true`, '-c', `credential.https://outro.com.useHttpPath=false`],
      ['-c', `credential.${o}.useHttpPath=false`, '-c', `credential.https://outro.com.useHttpPath=false`],
    ];
    for (const c of invalidas) {
      assert.throws(() => ship(projeto.carregado, thread.id, { para: 'main', configDoRemoto: c }), refusa(c), c.join(' '));
    }
    assert.throws(() => shaNoRemoto(projeto.dir, 'origin', 'main', ['-c', 'http.sslVerify=false']), refusa([], 'http.sslVerify'));
    assert.equal(shaDaBranch(projeto.dir, 'main'), main);
    assert.equal(chamadas().length, 0);
  } finally { projeto.limpar(); }
});

test('tudo o que o configDeRede emite passa, nos dois modos, com e sem CA', () => {
  const { projeto } = entrega('ship-config-emitidas');
  try {
    const dir = ssh.dir;
    const listas = [
      configDeRede(FIX_SSH, dir),
      configDeRede(fixHttps('/usr/bin/glab', null), dir),
      configDeRede(fixHttps('/usr/bin/glab', { arquivo: '/etc/pki/e.pem', sha256: '0'.repeat(64) }), dir),
      configDeRede(fixHttps("/opt/c'li/glab", { arquivo: '/etc/pki/e.pem', sha256: '0'.repeat(64) }), dir),
      configDeRede(fixHttps('/opt/com espaco/glab', null), dir),
    ];
    for (const l of listas) {
      assert.doesNotThrow(() => shaNoRemoto(projeto.dir, 'origin', 'main', l), l.join(' '));
    }
    assert.ok(listas[2].some((x) => x.endsWith('/ca.pem')));
  } finally { projeto.limpar(); }
});

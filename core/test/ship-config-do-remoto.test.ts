import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { permitirChaveDeConfigNoTeste, ship, shaNoRemoto } from '../src/ship';
import { novaThread } from '../src/thread';
import { commitar, projetoTemporario, shaDaBranch, shaNoRemotoDeTeste } from './apoio';

// `protocol.file.allow` nao e chave do transporte: so estes testes a aceitam, para provar sem rede que o `-c` chega ao git.
let soltar: () => void;
before(() => { soltar = permitirChaveDeConfigNoTeste('protocol.file.allow'); });
after(() => soltar());

function entrega(nome: string) {
  const projeto = projetoTemporario(nome, true);
  const { thread } = novaThread(projeto.carregado, { nome, modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'entrega.md', `# ${thread.id}\n`, `feat: entrega de ${thread.id}`);
  return { projeto, thread };
}

test('o ls-remote leva a config do remoto antes do subcomando', () => {
  const projeto = projetoTemporario('ship-config-ls-remote', true);
  try {
    assert.equal(shaNoRemoto(projeto.dir, 'origin', 'main'), shaDaBranch(projeto.dir, 'main'));
    assert.equal(shaNoRemoto(projeto.dir, 'origin', 'main', ['-c', 'protocol.file.allow=never']), null);
  } finally { projeto.limpar(); }
});

test('a config chega ao push: recusada pelo transporte, o ship bloqueia sem tocar no remoto', () => {
  const { projeto, thread } = entrega('ship-config-push-bloqueado');
  try {
    const remotoAntes = shaNoRemotoDeTeste(projeto.dir, 'origin', 'main');
    const r = ship(projeto.carregado, thread.id, { para: 'main', configDoRemoto: ['-c', 'protocol.file.allow=never'] });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.pushVerificado, false);
    assert.ok(r.passos.includes('git -c protocol.file.allow=never push -u -- origin refs/heads/main:refs/heads/main'), r.passos.join('\n'));
    assert.equal(shaNoRemotoDeTeste(projeto.dir, 'origin', 'main'), remotoAntes);
  } finally { projeto.limpar(); }
});

test('com a config aceita, o push e a prova saem com o mesmo -c nos passos', () => {
  const { projeto, thread } = entrega('ship-config-push-ok');
  try {
    const r = ship(projeto.carregado, thread.id, { para: 'main', configDoRemoto: ['-c', 'protocol.file.allow=always'] });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(r.pushVerificado, true);
    assert.ok(r.passos.includes('git -c protocol.file.allow=always push -- origin refs/heads/main:refs/heads/main'), r.passos.join('\n'));
    assert.ok(r.passos.includes('git -c protocol.file.allow=always ls-remote origin refs/heads/main'), r.passos.join('\n'));
  } finally { projeto.limpar(); }
});

test('sem config do remoto, os passos do push ficam como sempre', () => {
  const { projeto, thread } = entrega('ship-config-sem');
  try {
    const r = ship(projeto.carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.ok(r.passos.includes('git push -- origin refs/heads/main:refs/heads/main'), r.passos.join('\n'));
    assert.ok(r.passos.includes('git ls-remote origin refs/heads/main'));
  } finally { projeto.limpar(); }
});

test('config fora da forma -c chave=valor, ou de chave que o transporte nao emite, recusa antes de qualquer git', () => {
  const { projeto, thread } = entrega('ship-config-invalida');
  try {
    const main = shaDaBranch(projeto.dir, 'main');
    const invalidas = [
      ['--upload-pack=touch /tmp/x'], ['-c'], ['-c', 'sem-igual'], ['-c', 'a.b=c', '--exec=x'], ['-c', '-c=x'],
      ['-c', 'core.fsmonitor=/tmp/x'], ['-c', 'core.sshCommand=ssh\nx=y'], ['-c', 'protocol.ext.allow=always'],
      ['-c', 'http.https://h/x.sslCert=/tmp/x'], ['-c', 'url.file:///tmp/.insteadOf=https://h/'], ['-c', 'alias.push=!x'],
    ];
    for (const c of invalidas) {
      assert.throws(() => ship(projeto.carregado, thread.id, { para: 'main', configDoRemoto: c }), /ship\.config-do-remoto\.invalida/, c.join(' '));
    }
    assert.throws(() => shaNoRemoto(projeto.dir, 'origin', 'main', ['-c', 'core.fsmonitor=x']), /ship\.config-do-remoto\.invalida/);
    assert.equal(shaDaBranch(projeto.dir, 'main'), main);
  } finally { projeto.limpar(); }
});

test('as chaves que o transporte emite passam pela lista', () => {
  const projeto = projetoTemporario('ship-config-emitidas', true);
  try {
    const u = 'https://git.exemplo.com:8443/a/b.git';
    const o = 'https://git.exemplo.com:8443';
    const emitidas = ['core.sshCommand=ssh -F /dev/null -o BatchMode=yes', 'ssh.variant=ssh', 'credential.helper=', `credential.${o}.helper=!glab auth git-credential`,
      `credential.${o}.useHttpPath=false`, 'http.sslVerify=true', `http.${u}.sslVerify=true`, `http.${u}.proxy=`, `http.${u}.extraHeader=`,
      `http.${u}.followRedirects=false`, `http.${u}.sslCAInfo=/x/ca.pem`];
    for (const par of emitidas) assert.doesNotThrow(() => shaNoRemoto(projeto.dir, 'origin', 'main', ['-c', par]), par);
  } finally { projeto.limpar(); }
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checarForja } from '../src/doctor-forja';
import { linha, projeto, sondas } from './forja-doctor-apoio';

test('sem remoto de forja e sem bloco forja, a seção não tem linha', () => {
  assert.deepEqual(checarForja(projeto(), sondas({ url: null })), []);
  assert.deepEqual(checarForja(projeto(), sondas({ url: '/tmp/origem.git' })), []);
});

test('bloco forja com remoto local: aviso na identidade', () => {
  const checks = checarForja(projeto({ forja: { tipo: 'gitlab' } }), sondas({ url: '/tmp/origem.git' }));
  assert.equal(checks.length, 1);
  assert.equal(checks[0].nivel, 'warn');
  assert.match(checks[0].correcao ?? '', /git remote set-url origin/);
});

test('a identidade diz o tipo, o endereço, o projeto e de onde veio cada valor', () => {
  const id = linha(checarForja(projeto(), sondas()), 'forja identidade')!;
  assert.equal(id.nivel, 'ok');
  assert.equal(id.detalhe, 'gitlab em gitlab.empresa.com, porta 443, caminho base /; projeto root/matriz ' +
    '(tipo: sondagem; host: remoto; porta: padrão; caminho base: padrão)');
});

test('forja desconhecida reprova quando o projeto depende da forja, e só avisa quando não depende', () => {
  const ninguem = { github: () => 'sem-login' as const, gitlab: () => 'sem-login' as const };
  const exigida = checarForja(projeto({ exigida: true }), sondas({ tipos: ninguem }));
  assert.equal(exigida.length, 1);
  assert.equal(exigida[0].nivel, 'fail');
  assert.match(exigida[0].detalhe, /^forja\.desconhecida: /);
  assert.match(exigida[0].correcao ?? '', /forja\.tipo/);
  assert.equal(checarForja(projeto(), sondas({ tipos: ninguem }))[0].nivel, 'warn');
});

test('HTTPS fora reprova e encerra a seção; SSH recusado é aviso que aponta o forja-https', () => {
  const fora = checarForja(projeto({ exigida: true }), sondas({ porta: (_h, p) => (p === 443 ? 'sem-resposta' : 'aberta') }));
  assert.deepEqual(fora.map((c) => c.nome), ['forja identidade', 'forja alcance']);
  assert.equal(fora[1].nivel, 'fail');
  assert.equal(fora[1].detalhe, 'HTTPS gitlab.empresa.com:443 sem resposta; SSH gitlab.empresa.com:22 aberta');
  const semSsh = checarForja(projeto({ exigida: true }), sondas({ porta: (_h, p) => (p === 22 ? 'recusada' : 'aberta') }));
  assert.equal(linha(semSsh, 'forja alcance')!.nivel, 'warn');
  assert.match(linha(semSsh, 'forja alcance')!.correcao ?? '', /forja-https/);
  assert.equal(linha(semSsh, 'forja tls')!.nivel, 'ok');
});

test('cadeia TLS inválida reprova com o motivo e para antes da CLI; CA declarada que não existe reprova sem conectar', () => {
  const invalida = checarForja(projeto({ exigida: true }), sondas({ tls: () => ({ ok: false, motivo: 'SELF_SIGNED_CERT_IN_CHAIN' }) }));
  assert.equal(linha(invalida, 'forja tls')!.nivel, 'fail');
  assert.match(linha(invalida, 'forja tls')!.detalhe, /SELF_SIGNED_CERT_IN_CHAIN/);
  assert.equal(linha(invalida, 'forja cli'), undefined);
  const semCa = checarForja(projeto({ forja: { tipo: 'gitlab', ca: '/nao/existe/empresa.pem' } }),
    sondas({ tls: () => { throw new Error('conectou'); } }));
  assert.equal(linha(semCa, 'forja tls')!.nivel, 'fail');
  assert.match(linha(semCa, 'forja tls')!.detalhe, /\/nao\/existe\/empresa\.pem/);
});

test('GitHub com forja.ca fora do Linux: o TLS é aviso, porque a CA não chega ao gh', () => {
  const ca = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-ca-'));
  try {
    const pem = path.join(ca, 'empresa.pem');
    fs.writeFileSync(pem, '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n');
    const projetoGhe = projeto({ forja: { tipo: 'github', ca: pem } });
    const url = 'https://ghe.empresa.com/o/r.git';
    const mac = linha(checarForja(projetoGhe, sondas({ url, plataforma: 'darwin' })), 'forja tls')!;
    assert.equal(mac.nivel, 'warn');
    assert.match(mac.detalhe, /gh/);
    assert.equal(linha(checarForja(projetoGhe, sondas({ url, plataforma: 'linux' })), 'forja tls')!.nivel, 'ok');
  } finally { fs.rmSync(ca, { recursive: true, force: true }); }
});

test('remoto http: a porta 80 é medida e o TLS é aviso', () => {
  const portas: number[] = [];
  const checks = checarForja(projeto(), sondas({ url: 'http://gitlab.empresa.com/root/matriz.git', porta: (_h, p) => { portas.push(p); return 'aberta'; } }));
  assert.deepEqual(portas, [80, 22]);
  assert.equal(linha(checks, 'forja tls')!.nivel, 'warn');
});

test('as portas do manifesto: HTTPS na porta e SSH no host e na porta declarados', () => {
  const medidas: Array<[string, number]> = [];
  const tls: Array<[string, number]> = [];
  checarForja(projeto({ forja: { tipo: 'gitlab', porta: 8443, ssh_host: 'ssh.empresa.com', ssh_porta: 2222 } }),
    sondas({ url: 'https://gitlab.empresa.com:8443/root/matriz.git', porta: (h, p) => { medidas.push([h, p]); return 'aberta'; },
      tls: (h, p) => { tls.push([h, p]); return { ok: true }; } }));
  assert.deepEqual(medidas, [['gitlab.empresa.com', 8443], ['ssh.empresa.com', 2222]]);
  assert.deepEqual(tls, [['gitlab.empresa.com', 8443]]);
});

test('forja ambígua reprova o projeto que depende da forja e só avisa o que não depende', () => {
  const duas = { github: () => 'responde' as const, gitlab: () => 'responde' as const };
  const exigida = checarForja(projeto({ exigida: true }), sondas({ tipos: duas }));
  assert.deepEqual([exigida.length, exigida[0].nivel], [1, 'fail']);
  assert.match(exigida[0].detalhe, /^forja\.ambigua: /);
  assert.match(exigida[0].correcao ?? '', /forja\.tipo/);
  assert.equal(checarForja(projeto(), sondas({ tipos: duas }))[0].nivel, 'warn');
});

test('o bloco forja: que contradiz o remoto reprova a identidade com a correção do manifesto', () => {
  const checks = checarForja(projeto({ forja: { tipo: 'gitlab', host: 'outro.empresa.com' } }), sondas());
  assert.equal(checks.length, 1);
  assert.equal(checks[0].nivel, 'fail', 'o bloco forja: declarado faz o projeto depender da forja');
  assert.match(checks[0].detalhe, /^forja\.remoto-divergente: /);
});

test('a origem de cada valor: tipo e host do manifesto', () => {
  const id = linha(checarForja(projeto({ forja: { tipo: 'gitlab', host: 'gitlab.empresa.com' } }), sondas({ tipos: {} })), 'forja identidade')!;
  assert.equal(id.nivel, 'ok');
  assert.match(id.detalhe, /\(tipo: manifesto; host: manifesto; porta: padrão; caminho base: padrão\)$/);
});

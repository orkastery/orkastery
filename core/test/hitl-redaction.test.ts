import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { redigirSegredos } from '../src/hitl';

test('F1/F9: credenciais sinteticas com delimitadores e arrobas sao redigidas integralmente', () => {
  for (const senha of ['sintetica?fim', 'sintetica#fim', 'sintetica/fim', 'sintetica@meio@fim', 'sintetica/@?#fim']) {
    for (const scheme of ['postgresql', 'https', 'redis+tls']) {
      const url = `${scheme}://fixture:${senha}@host.invalid/base`;
      assert.equal(redigirSegredos(url), `${scheme}://[credencial redigida]@host.invalid/base`);
    }
  }
});

test('F1/F9: URLs publicas, caminhos com arroba e multiplas URLs conservam seus limites', () => {
  const publicas = ['https://host.invalid/base?x=1#fim', 'https://host.invalid/a@b',
    'https://host.invalid/?email=a@b.invalid', 'https://host.invalid:8443/base', 'https://[::1]:8443/base'];
  for (const url of publicas) assert.equal(redigirSegredos(url), url);
  for (const sep of [' ', '\n', ',', ';', ')(', '']) {
    const a = 'postgresql://fixture:sintetica?parte@fim@a.invalid/base';
    const b = 'https://b.invalid/publico';
    const c = 'redis://fixture:sintetica/barra@c.invalid';
    assert.equal(redigirSegredos(a + sep + b + sep + c),
      sep === '' ? 'postgresql://[credencial redigida]@c.invalid' :
      'postgresql://[credencial redigida]@a.invalid/base' + sep + b + sep + 'redis://[credencial redigida]@c.invalid');
  }
});

test('F10: texto longo sem esquema e muitos candidatos incompletos terminam em tempo limitado', () => {
  const r = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict');
    const {redigirSegredos}=require(${JSON.stringify(require.resolve('../src/hitl'))});
    for (const text of ['a'.repeat(512*1024), ('abc://host.invalid/ ').repeat(16000), ('abc:/ '+ 'z'.repeat(64)).repeat(8000)])
      assert.equal(redigirSegredos(text),text);
  `], { timeout: 4000, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.error, undefined, 'varredura deve terminar dentro do limite, inclusive sem delimitador');
  assert.equal(r.status, 0);
});

test('G6 senha com :// nao deixa escapar prefixo; URLs publicas ambiguas recebem perda explicita', () => {
  for (const senha of ['senha://fim', 'SENHA://fim', 'senha://meio://fim',
    'senha://meio@mais://fim', 'senha@host.invalid/base://fim', 'senha://meio@host.invalid/base://fim', 'senha?x://fim', 'senha#x://fim', 'senha/x://fim']) {
    const raw=`p://fixture:${senha}@host.invalid/base`;
    assert.equal(redigirSegredos(raw),'p://[credencial redigida]@host.invalid/base', senha);
  }
  // Os mesmos bytes tambem podem descrever URL publica com porta/caminho seguido
  // de outra URL. Nao existe informacao de intencao nesses bytes: priorizar redacao.
  const ambiguo='https://host.invalid:8443/basehttps://nome@destino.invalid';
  assert.equal(redigirSegredos(ambiguo),'https://[credencial redigida]@destino.invalid');
  for (const sep of [' ', '\n', ',', ';', ')(', '']) {
    const a='p://user:senha://fim@a.invalid/base', b='https://b.invalid/publico',
      c='redis://user:outra://fim@c.invalid';
    assert.equal(redigirSegredos(a+sep+b+sep+c),
      sep === '' ? 'p://[credencial redigida]@c.invalid' :
      'p://[credencial redigida]@a.invalid/base'+sep+b+sep+'redis://[credencial redigida]@c.invalid');
  }
  assert.equal(redigirSegredos('https://host.invalid:8443/base https://nome@destino.invalid'),
    'https://host.invalid:8443/base https://[credencial redigida]@destino.invalid');
});

test('G6 milhares de esquemas dentro de userinfo conservam custo linear e redacao integral', () => {
  const r=spawnSync(process.execPath,['-e',`
const assert=require('node:assert/strict'),{redigirSegredos}=require(${JSON.stringify(require.resolve('../src/hitl'))});
const measures=[];
for(const n of [128*1024,256*1024,512*1024]) {
 const raw='p://u:'+('senha://').repeat(n/8)+'final@host.invalid';
 const start=performance.now();assert.equal(redigirSegredos(raw),'p://[credencial redigida]@host.invalid');
 measures.push({bytes:raw.length,ms:performance.now()-start});
}
console.log(JSON.stringify(measures));
`],{timeout:4000,encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);console.log('REDACTION_COST: '+r.stdout.trim());
});

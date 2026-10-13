import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hostComPorta, lerEnderecoDoRemoto } from '../src/forja/endereco';

const casos: Array<[string, ReturnType<typeof lerEnderecoDoRemoto>]> = [
  ['https://github.com/o/r.git', { protocolo: 'https', host: 'github.com', porta: null, caminho: 'o/r' }],
  ['https://ghe.empresa.com:8443/o/r.git', { protocolo: 'https', host: 'ghe.empresa.com', porta: 8443, caminho: 'o/r' }],
  ['https://u:segredo@gitlab-ia.unifique.com.br/ai-factory/sub/orkastery.git',
    { protocolo: 'https', host: 'gitlab-ia.unifique.com.br', porta: null, caminho: 'ai-factory/sub/orkastery' }],
  ['ssh://git@git.empresa.com:2222/a/b/c.git', { protocolo: 'ssh', host: 'git.empresa.com', porta: 2222, caminho: 'a/b/c' }],
  ['git@github.com:o/r.git', { protocolo: 'scp', host: 'github.com', porta: null, caminho: 'o/r' }],
  ['/tmp/origin.git', null],
  ['https://host/a/../b.git', null],
];

for (const [url, esperado] of casos) {
  test(`lê ${url}`, () => assert.deepEqual(lerEnderecoDoRemoto(url), esperado));
}

test('hostComPorta só põe a porta quando ela existe', () => {
  assert.equal(hostComPorta(lerEnderecoDoRemoto('https://ghe.empresa.com:8443/o/r')!), 'ghe.empresa.com:8443');
  assert.equal(hostComPorta(lerEnderecoDoRemoto('git@github.com:o/r.git')!), 'github.com');
});

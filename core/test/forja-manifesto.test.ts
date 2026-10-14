import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto, ManifestoCarregado } from '../src/manifest';
import { PRODUTORES_PADRAO, produtorAceito, produtorDeSaida, produtoresAceitos } from '../src/forja/produtor';
import { projetoTemporario } from './apoio';

/** O manifesto do `ork init` com linhas a mais no bloco `ci:` e um bloco novo no fim. */
function ler(nome: string, extra: { ci?: string; bloco?: string } = {}): ManifestoCarregado {
  const p = projetoTemporario(nome, false);
  try {
    const arquivo = path.join(p.dir, 'orkastery.yaml');
    let texto = fs.readFileSync(arquivo, 'utf8');
    if (extra.ci) texto = texto.replace('  context: ork-verify\n', `  context: ork-verify\n${extra.ci}\n`);
    if (extra.bloco) texto += `\n${extra.bloco}\n`;
    fs.writeFileSync(arquivo, texto);
    return carregarManifesto(p.dir)!;
  } finally { p.limpar(); }
}

test('sem o bloco forja e sem ci.produtor, o manifesto lê como antes', () => {
  const c = ler('forja-sem-bloco');
  assert.deepEqual(c.erros, []);
  assert.equal('forja' in c.manifesto, false);
  assert.equal('produtor' in c.manifesto.ci, false);
});

test('o bloco forja inteiro é lido, com o host em minúsculas e o caminho base sem a barra final', () => {
  const c = ler('forja-bloco', { bloco: [
    'forja:', '  tipo: gitlab', '  host: GitLab.Empresa.com', '  porta: 8443', '  caminho_base: /gitlab/',
    '  ssh_host: ssh.empresa.com', '  ssh_porta: 2222', '  ca: "/etc/pki/ca-trust/source/anchors/empresa.pem"'].join('\n') });
  assert.deepEqual(c.erros, []);
  assert.deepEqual(c.manifesto.forja, { tipo: 'gitlab', host: 'gitlab.empresa.com', porta: 8443, caminho_base: '/gitlab',
    ssh_host: 'ssh.empresa.com', ssh_porta: 2222, ca: '/etc/pki/ca-trust/source/anchors/empresa.pem' });
});

test('caminho_base "/" é o mesmo que nenhum subcaminho', () => {
  const c = ler('forja-raiz', { bloco: 'forja:\n  tipo: gitlab\n  caminho_base: /' });
  assert.deepEqual(c.erros, []);
  assert.deepEqual(c.manifesto.forja, { tipo: 'gitlab' });
});

const invalidos: Array<[string, RegExp]> = [
  ['forja: gitlab', /^forja deve ser um mapa/],
  ['forja:\n  tipo: gitea', /^forja\.tipo aceita github ou gitlab/],
  ['forja:\n  host: "https://gitlab.empresa.com"', /^forja\.host deve ser um nome de host/],
  ['forja:\n  host: gitlab.empresa.com:8443', /^forja\.host deve ser um nome de host/],
  ['forja:\n  porta: 0', /^forja\.porta deve ser um inteiro de 1 a 65535/],
  ['forja:\n  ssh_porta: 70000', /^forja\.ssh_porta deve ser um inteiro de 1 a 65535/],
  ['forja:\n  caminho_base: /a/../b', /^forja\.caminho_base deve ser um caminho absoluto/],
  ['forja:\n  caminho_base: gitlab', /^forja\.caminho_base deve ser um caminho absoluto/],
  ['forja:\n  tipo: github\n  caminho_base: /ghe', /^forja\.caminho_base só vale para forja servida em subcaminho/],
  ['forja:\n  ca: certs/empresa.pem', /^forja\.ca deve ser o caminho absoluto/],
  ['forja:\n  ca: /etc/../tmp/x.pem', /^forja\.ca deve ser o caminho absoluto/],
];
for (const [bloco, erro] of invalidos) {
  test(`forma inválida é erro do manifesto: ${bloco.replace(/\n\s*/g, ' ')}`, () => {
    const c = ler('forja-invalido', { bloco });
    assert.ok(c.erros.some((e) => erro.test(e)), c.erros.join(' | '));
  });
}

test('chave desconhecida no bloco forja só avisa', () => {
  const c = ler('forja-chave', { bloco: 'forja:\n  tipo: gitlab\n  token: x' });
  assert.deepEqual(c.erros, []);
  assert.ok(c.avisos.some((a) => /^forja\.token desconhecida/.test(a)));
});

test('ci.produtor: lista, texto único e entradas repetidas', () => {
  assert.deepEqual(ler('produtor-lista', { ci: '  produtor:\n    - github-actions\n    - "status:deploy-bot"' }).manifesto.ci.produtor,
    ['github-actions', 'status:deploy-bot']);
  assert.deepEqual(ler('produtor-texto', { ci: '  produtor: circleci' }).manifesto.ci.produtor, ['circleci']);
  assert.deepEqual(ler('produtor-repetido', { ci: '  produtor: [gitlab-ci, gitlab-ci]' }).manifesto.ci.produtor, ['gitlab-ci']);
});

test('ci.produtor vazio ou com entrada que não é produtor é erro: o gate nunca ficaria verde, ou ficaria por engano', () => {
  assert.ok(ler('produtor-vazio', { ci: '  produtor: []' }).erros.some((e) => /^ci\.produtor deve ser uma lista de 1 a 20/.test(e)));
  assert.ok(ler('produtor-ruim', { ci: '  produtor: ["--hostname=x"]' }).erros.some((e) => /^ci\.produtor: .* não é um produtor/.test(e)));
});

test('sem lista, vale o padrão da forja; com lista, só ela', () => {
  const sem = ler('produtor-padrao').manifesto;
  assert.deepEqual(produtoresAceitos(sem, 'github'), ['github-actions']);
  assert.deepEqual(produtoresAceitos(sem, 'gitlab'), ['gitlab-ci']);
  assert.deepEqual(PRODUTORES_PADRAO.github, ['github-actions']);
  const com = ler('produtor-manifesto', { ci: '  produtor: [circleci]' }).manifesto;
  assert.deepEqual(produtoresAceitos(com, 'github'), ['circleci']);
});

test('produtorAceito: slug do app, conta de app pelo slug, outra conta só com status:<login>', () => {
  const aceitos = ['github-actions', 'gitlab-ci', 'status:deploy-bot'];
  assert.equal(produtorAceito({ fonte: 'check-run', produtor: 'github-actions' }, aceitos), true);
  assert.equal(produtorAceito({ fonte: 'check-run', produtor: 'impostor' }, aceitos), false);
  assert.equal(produtorAceito({ fonte: 'check-run', produtor: null }, aceitos), false);
  assert.equal(produtorAceito({ fonte: 'commit-status', produtor: 'github-actions[bot]' }, aceitos), true);
  assert.equal(produtorAceito({ fonte: 'commit-status', produtor: 'github-actions' }, aceitos), false);
  assert.equal(produtorAceito({ fonte: 'commit-status', produtor: 'deploy-bot' }, aceitos), true);
  assert.equal(produtorAceito({ fonte: 'commit-status', produtor: 'outra-conta' }, aceitos), false);
  assert.equal(produtorAceito({ fonte: 'pipeline-job', produtor: 'gitlab-ci' }, aceitos), true);
  assert.equal(produtorAceito({ fonte: 'pipeline-job', produtor: 'gitlab-ci' }, ['github-actions']), false);
});

test('forja.ssh_host fora da forma de host é erro do manifesto', () => {
  for (const ssh of ['"ssh://ssh.empresa.com"', 'ssh.empresa.com:2222', '-oProxyCommand=x']) {
    const c = ler('forja-ssh-host', { bloco: `forja:\n  ssh_host: ${ssh}` });
    assert.ok(c.erros.some((e) => /^forja\.ssh_host /.test(e)), `${ssh}: ${c.erros.join(' | ')}`);
  }
});

test('ci.produtor com entrada que não é texto ou com mais de 20 é erro', () => {
  assert.ok(ler('produtor-numero', { ci: '  produtor: [42]' }).erros.some((e) => /^ci\.produtor/.test(e)));
  assert.ok(ler('produtor-mapa', { ci: '  produtor:\n    - nome: x' }).erros.some((e) => /^ci\.produtor/.test(e)));
  const vinteEUm = Array.from({ length: 21 }, (_, i) => `app-${i}`).join(', ');
  assert.ok(ler('produtor-demais', { ci: `  produtor: [${vinteEUm}]` }).erros.some((e) => /^ci\.produtor deve ser uma lista de 1 a 20/.test(e)));
  const vinte = Array.from({ length: 20 }, (_, i) => `app-${i}`).join(', ');
  assert.deepEqual(ler('produtor-vinte', { ci: `  produtor: [${vinte}]` }).erros, []);
});

test('produtorDeSaida: a forma de ci.produtor (slug, slug do app, status:<login>); check-run e job ficam como estão', () => {
  assert.equal(produtorDeSaida({ fonte: 'commit-status', produtor: 'root' }), 'status:root');
  assert.equal(produtorDeSaida({ fonte: 'commit-status', produtor: 'github-actions[bot]' }), 'github-actions');
  assert.equal(produtorDeSaida({ fonte: 'check-run', produtor: 'github-actions' }), 'github-actions');
  assert.equal(produtorDeSaida({ fonte: 'pipeline-job', produtor: 'gitlab-ci' }), 'gitlab-ci');
  assert.equal(produtorDeSaida({ fonte: 'commit-status', produtor: null }), null);
  // O que sai do JSON volta a ser aceito pela mesma lista que a pessoa escreveu.
  assert.equal(produtorAceito({ fonte: 'commit-status', produtor: 'root' }, ['status:root']), true);
});

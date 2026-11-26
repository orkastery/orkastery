import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPILADO = path.join(RAIZ, 'dist-test');
const FOCAL = 'test/rm089-f7-mutacoes.test.js';
const T = (alvo, de, para, grupo) => ({ alvo: `src/${alvo}.js`, de, para, grupo });
const MODELOS = [
  T('ci-fabrica-github', 'c.appId === app', 'true', 'github-app'),
  T('ci-fabrica-github', '!entrada.listaCompleta', 'false', 'github-lista'),
  T('ci-fabrica-github', "(entrada.relacaoComDestino !== 'ahead' && entrada.relacaoComDestino !== 'identical')", 'false', 'github-atualizado'),
  T('ci-fabrica-github', 'p.padrao === destino', 'true', 'github-regra'),
  T('ci-fabrica-github', "const decisorio = entrada.nivel === 'exigir';", 'const decisorio = true;', 'github-diagnostico'),
  T('ci-fabrica-gitlab', 'e.divergencia !== 0', 'false', 'gitlab-divergencia'),
  T('ci-fabrica-gitlab', '!e.membrosCompletos', 'false', 'gitlab-membros'),
  T('ci-fabrica-gitlab', 'e.destinoNaPrimeiraLeitura !== e.destinoAntesDoEfeito', 'false', 'gitlab-corrida'),
  T('forja/gitlab/pedidos', 'corpo: { sha: head }', "corpo: { sha: '0'.repeat(40) }", 'gitlab-sha'),
  T('ci-fabrica-gitlab', 'e.resetAprovacoesNoPush', 'true', 'gitlab-reset'),
  T('ci-fabrica-gitlab', '!e.regraDeAprovacaoEditavelNoMr', 'true', 'gitlab-edicao'),
  T('ci-fabrica-gitlab', 'e.aprovacoesValidas >= e.aprovacoesExigidas', 'true', 'gitlab-aprovacao'),
  T('ci-fabrica-registros', '!ultimoVerify.verde', 'false', 'registros-verify'),
  T('ci-fabrica-registros', 'c.shaRevisado === entrada.head', 'true', 'registros-check-head'),
  T('ci-fabrica-registros', '!construtores.includes(c.sessionId)', 'true', 'registros-revisor'),
  T('ci-fabrica-registros', 'commit.pais.length < 2', 'true', 'registros-merge'),
  T('ci-fabrica-registros', '!entrada.comparacao.completa', 'false', 'registros-lista'),
  T('ci-fabrica-registros', '!soBundle(entrada.comparacao.arquivosDesdeVerify)', 'false', 'registros-produto'),
  T('ci-fabrica-registros', 't.conducaoId === check.conducaoId', 'true', 'registros-tag'),
  T('ci-fabrica-registros', '.at(-1);', '.at(0);', 'registros-ultimo'),
  T('ci-fabrica-servico', '!evento.assinaturaValida', 'false', 'servico-assinatura'),
  T('ci-fabrica-servico', 'recebido - emitido > janelaMs', 'false', 'servico-janela'),
  T('ci-fabrica-servico', 'portas.persistir(decisao);', '', 'servico-persistencia'),
  T('ci-fabrica-resultado', 'p.projeto !== esperado.projeto', 'false', 'resultado-vinculo'),
  T('ci-fabrica-resultado', 'Date.parse(agora) >= Date.parse(p.validoAte)', 'false', 'resultado-validade'),
  T('ci-fabrica-resultado', '(!chave.revogadaEm || Date.parse(chave.revogadaEm) > Date.parse(agora))', 'true', 'resultado-revogacao'),
  T('ci-fabrica-resultado', "excecao.operation === 'ci.run'", 'true', 'resultado-operacao'),
  T('ship', "(0, produtor_1.sinalDaCiParaFabrica)(e.ci.state) === 'negativo'", 'false', 'ship-veto'),
  T('ship', '!e.resultado?.valido', 'false', 'ship-decisao'),
];

const GITHUB = new Set([1, 2, 3, 18, 19, 28, 29, 30, 36, 38, 39, 47, 48]);
const GITLAB = new Set([4, 5, 21, 22, 23, 24, 25, 26, 27, 31, 50]);
const RESULTADO = new Set([9, 10, 11, 12, 32, 33, 34, 35, 49]);
const SHIP = new Set([46]);
const indicePorId = (id) => {
  if (GITHUB.has(id)) return (id - 1) % 5;
  if (GITLAB.has(id)) return 5 + ((id - 4) % 7);
  if (RESULTADO.has(id)) return 23 + ((id - 9) % 4);
  if (SHIP.has(id)) return 27 + ((id - 46) % 2);
  return 12 + ((id - 6) % 11 + 11) % 11;
};
const matriz = Array.from({ length: 58 }, (_, i) => ({ id: `MF${i + 1}`, ...MODELOS[indicePorId(i + 1)] }));
matriz.push({ id: 'MF52-github', ...MODELOS[2] }, { id: 'MF52-gitlab', ...MODELOS[5] },
  { id: 'MF57-github', ...MODELOS[1] }, { id: 'MF57-gitlab', ...MODELOS[16] });

function ligarArvore(origem, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const entrada of fs.readdirSync(origem, { withFileTypes: true })) {
    const de = path.join(origem, entrada.name), para = path.join(destino, entrada.name);
    if (entrada.isDirectory()) ligarArvore(de, para);
    else fs.linkSync(de, para);
  }
}

function executarFocal(raiz, mutante) {
  const env = { ...process.env, ORK_MUTATION_CHILD: mutante.id, ORK_MUTATION_GROUP: mutante.grupo,
    NODE_PATH: path.join(RAIZ, 'node_modules') };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', path.join(raiz, FOCAL)], { cwd: raiz, env, encoding: 'utf8' });
}

const grupos = new Map();
for (const m of matriz) if (!grupos.has(m.grupo)) grupos.set(m.grupo, m);
for (const m of grupos.values()) {
  test(`[base:${m.grupo}] o subteste focal passa sem mutação`, () => {
    const r = executarFocal(COMPILADO, m);
    assert.equal(r.status, 0, r.stderr || r.stdout || 'mutante.invalido');
  });
}

for (const mutante of matriz) {
  test(`[${mutante.id}] ${mutante.grupo}`, () => {
    const temporario = fs.mkdtempSync(path.join(RAIZ, 'dist-test-mutante-'));
    try {
      ligarArvore(COMPILADO, temporario);
      const alvo = path.join(temporario, mutante.alvo);
      const original = fs.readFileSync(alvo, 'utf8');
      const primeira = original.indexOf(mutante.de);
      if (primeira < 0) assert.fail(`mutante.inaplicavel: ${mutante.alvo}`);
      const segunda = original.indexOf(mutante.de, primeira + mutante.de.length);
      if (segunda >= 0) assert.fail(`mutante.inaplicavel: alvo ambiguo em ${mutante.alvo}`);
      fs.unlinkSync(alvo);
      fs.writeFileSync(alvo, original.slice(0, primeira) + mutante.para + original.slice(primeira + mutante.de.length));
      const sintaxe = spawnSync(process.execPath, ['--check', alvo], { encoding: 'utf8' });
      if (sintaxe.status !== 0) assert.fail(`mutante.invalido: ${sintaxe.stderr}`);
      const r = executarFocal(temporario, mutante);
      if (r.signal || r.status === null) assert.fail(`mutante.invalido: ${r.signal ?? 'sem status'}`);
      assert.notEqual(r.status, 0, `mutante.sobreviveu: ${mutante.id}\n${r.stdout}`);
    } finally {
      fs.rmSync(temporario, { recursive: true, force: true });
    }
  });
}

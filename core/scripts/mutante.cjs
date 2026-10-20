#!/usr/bin/env node
/**
 * RM-058 N5 (D6 da ork-rm058n5): o executor de mutante.
 *
 * A entrega do arco #Noctum só integra quando nenhum mutante relevante sobrevive, e o mutante é uma claim: a alegação começa
 * por "Mutante" e o comando sai 0 quando o mutante morre. Este script é o comando: ele copia `core/dist` e `core/dist-test`
 * para um diretório temporário com o resto do repositório ligado, troca um trecho exato do módulo compilado (nos dois, porque
 * o teste que chama o CLI por processo filho roda o `dist`), roda o arquivo de teste pelo nome e devolve:
 *
 *   0  o mutante morreu: o controle sem a troca passou, e com a troca algum teste que casou com o nome caiu;
 *   1  o mutante sobreviveu: todos os testes que casaram passaram com a troca;
 *   2  a especificação não se aplica (arquivo, id, trecho que não aparece exatamente uma vez, nenhum teste casou) ou o
 *      controle sem a troca já cai: o teste que cai sozinho não prova que o mutante morreu (S4 da rodada 1 do CHECK).
 *
 *   node core/scripts/mutante.cjs <especificacao.json> <id>
 *
 * A especificação (`ork.mutantes/v1`) é versionada junto com os testes:
 *   { "contrato": "ork.mutantes/v1", "mutantes": [ { "id": "M1", "descricao": "...", "modulo": "noctum-provas",
 *     "de": "<trecho exato do JS compilado>", "para": "<troca>", "teste": "noctum-provas", "nome": "^QP1:" } ] }
 *
 * RM-037 (achado 2 do CHECK da ork-rm037defeit2): o isolamento que um teste prova pode morar fora do módulo compilado,
 * num roteiro de `core/scripts` ou no apoio compilado de `core/dist-test/test`. Nesse caso a especificação traz `arquivo`
 * (o caminho a partir da raiz) no lugar de `modulo`, e a troca vai só nele; a pasta dele é copiada, e não ligada, para a
 * troca nunca chegar ao checkout.
 *
 * Precisa do `npm run build` e do `npm run build:test` (o preparo do `ork verify` e do runner do CI já os roda).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const CONTRATO = 'ork.mutantes/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const MODULO = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ARQUIVO = /^core\/(?:scripts\/[a-z0-9][a-z0-9.-]{0,63}\.c?js|dist-test\/test\/[a-z0-9][a-z0-9.-]{0,63}\.js)$/;

function falha(texto) {
  console.error(`mutante: ${texto}`);
  return 2;
}

/** A cópia com a forma do repositório: as `pastas` de `core` copiadas (`dist`, `dist-test` e a do `arquivo`), o resto ligado. */
function copiar(destino, pastas) {
  for (const nome of fs.readdirSync(RAIZ)) {
    if (nome === 'core' || nome === '.git') continue;
    fs.symlinkSync(path.join(RAIZ, nome), path.join(destino, nome));
  }
  fs.mkdirSync(path.join(destino, 'core'));
  for (const nome of fs.readdirSync(path.join(RAIZ, 'core'))) {
    const de = path.join(RAIZ, 'core', nome), para = path.join(destino, 'core', nome);
    if (pastas.has(nome)) fs.cpSync(de, para, { recursive: true });
    else fs.symlinkSync(de, para);
  }
}

function main(argv) {
  const [especificacao, id] = argv;
  if (!especificacao || !id || argv.length !== 2) return falha('uso: node core/scripts/mutante.cjs <especificacao.json> <id>');
  let spec;
  try { spec = JSON.parse(fs.readFileSync(path.resolve(RAIZ, especificacao), 'utf8')); }
  catch (e) { return falha(`especificação ilegível (${e.message.split('\n')[0]})`); }
  if (!spec || spec.contrato !== CONTRATO || !Array.isArray(spec.mutantes)) return falha(`a especificação não é ${CONTRATO}`);
  const m = spec.mutantes.find((x) => x && x.id === id);
  if (!m) return falha(`o mutante ${id} não está na especificação`);
  const porArquivo = m.arquivo !== undefined;
  const alvoOk = porArquivo ? m.modulo === undefined && typeof m.arquivo === 'string' && ARQUIVO.test(m.arquivo)
    : typeof m.modulo === 'string' && MODULO.test(m.modulo);
  if (!ID.test(m.id) || !alvoOk || !MODULO.test(m.teste) || typeof m.de !== 'string' || !m.de ||
      typeof m.para !== 'string' || m.de === m.para || typeof m.nome !== 'string' || !m.nome) {
    return falha(`o mutante ${id} está fora do formato (id, modulo ou arquivo de core/scripts ou core/dist-test/test, de, para, teste e nome)`);
  }
  const alvos = porArquivo ? [m.arquivo]
    : [path.join('core', 'dist', `${m.modulo}.js`), path.join('core', 'dist-test', 'src', `${m.modulo}.js`)];
  if (!alvos.some((a) => fs.existsSync(path.join(RAIZ, a)))) {
    return falha(porArquivo ? `o arquivo ${m.arquivo} não existe: rode o build:test` : `o módulo ${m.modulo} não está compilado: rode o build e o build:test`);
  }
  const teste = path.join('core', 'dist-test', 'test', `${m.teste}.test.js`);
  if (!fs.existsSync(path.join(RAIZ, teste))) return falha(`o teste ${teste} não está compilado`);
  // O trecho precisa aparecer exatamente uma vez em cada módulo compilado que existe, antes de qualquer rodada.
  const presentes = alvos.filter((a) => fs.existsSync(path.join(RAIZ, a)));
  for (const alvo of presentes) {
    const vezes = fs.readFileSync(path.join(RAIZ, alvo), 'utf8').split(m.de).length - 1;
    if (vezes !== 1) return falha(`o trecho do mutante ${id} aparece ${vezes} vez(es) em ${alvo}: precisa ser exatamente uma`);
  }
  // Dentro de um `node --test` (a suíte), o filho herdaria o contexto do runner e escreveria no formato dele, e não em TAP:
  // nenhum teste apareceria, e o mutante não teria veredito.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // S4 da rodada 1: o controle, sem a troca, no próprio checkout. O teste que já cai sem o mutante não prova nada sobre ele.
  const controle = rodarTeste(RAIZ, path.join(RAIZ, teste), m.nome, env);
  if (!controle.rodaram.length) return falha(`nenhum teste de ${teste} casou com ${m.nome} (${controle.erro})`);
  if (controle.caidos.length) {
    return falha(`o controle sem a troca já cai (${controle.caidos.length} de ${controle.rodaram.length} teste(s)): o mutante ${id} ficaria sem prova`);
  }
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-mutante-'));
  try {
    copiar(copia, new Set(['dist', 'dist-test', ...presentes.map((a) => a.split(/[\\/]/)[1])]));
    for (const alvo of presentes) {
      const arquivo = path.join(copia, alvo);
      fs.writeFileSync(arquivo, fs.readFileSync(arquivo, 'utf8').replace(m.de, () => m.para));
    }
    const r = rodarTeste(copia, path.join(copia, teste), m.nome, env);
    if (!r.rodaram.length) return falha(`nenhum teste de ${teste} casou com ${m.nome} na cópia (${r.erro})`);
    if (r.caidos.length) {
      console.log(`mutante ${id}: morto (${r.caidos.length} de ${r.rodaram.length} teste(s) caíram; o controle passou) - ${m.descricao || m.modulo}`);
      return 0;
    }
    console.log(`mutante ${id}: SOBREVIVEU (${r.rodaram.length} teste(s) passaram com a troca) - ${m.descricao || m.modulo}`);
    return 1;
  } finally {
    fs.rmSync(copia, { recursive: true, force: true });
  }
}

/** Roda o arquivo de teste pelo nome e devolve os testes de primeiro nível que rodaram de fato (o pulado não conta). */
function rodarTeste(cwd, arquivo, nome, env) {
  const r = spawnSync(process.execPath, ['--test-reporter=tap', `--test-name-pattern=${nome}`, arquivo],
    { cwd, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env });
  const rodaram = (r.stdout || '').split('\n').filter((l) => /^(?:not )?ok \d+ - /.test(l) && !/# SKIP\b/.test(l));
  return { rodaram, caidos: rodaram.filter((l) => l.startsWith('not ok')), erro: r.error ? r.error.message : `saída ${r.status}` };
}

module.exports = { main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env node
/**
 * RM-058 N5 (D6 da ork-rm058n5): o executor de mutante.
 *
 * A entrega do arco #Noctum só integra quando nenhum mutante relevante sobrevive, e o mutante é uma claim: a alegação começa
 * por "Mutante" e o comando sai 0 quando o mutante morre. Este script é o comando: ele copia `core/dist` e `core/dist-test`
 * para um diretório temporário com o resto do repositório ligado, troca um trecho exato do módulo compilado (nos dois, porque
 * o teste que chama o CLI por processo filho roda o `dist`), roda o arquivo de teste pelo nome e devolve:
 *
 *   0  o mutante morreu: algum teste que casou com o nome caiu;
 *   1  o mutante sobreviveu: todos os testes que casaram passaram;
 *   2  a especificação não se aplica (arquivo, id, trecho que não aparece exatamente uma vez, nenhum teste casou).
 *
 *   node core/scripts/mutante.cjs <especificacao.json> <id>
 *
 * A especificação (`ork.mutantes/v1`) é versionada junto com os testes:
 *   { "contrato": "ork.mutantes/v1", "mutantes": [ { "id": "M1", "descricao": "...", "modulo": "noctum-provas",
 *     "de": "<trecho exato do JS compilado>", "para": "<troca>", "teste": "noctum-provas", "nome": "^QP1:" } ] }
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

function falha(texto) {
  console.error(`mutante: ${texto}`);
  return 2;
}

/** A cópia com a forma do repositório: `core/dist` e `core/dist-test` copiados, o resto ligado. */
function copiar(destino) {
  for (const nome of fs.readdirSync(RAIZ)) {
    if (nome === 'core' || nome === '.git') continue;
    fs.symlinkSync(path.join(RAIZ, nome), path.join(destino, nome));
  }
  fs.mkdirSync(path.join(destino, 'core'));
  for (const nome of fs.readdirSync(path.join(RAIZ, 'core'))) {
    const de = path.join(RAIZ, 'core', nome), para = path.join(destino, 'core', nome);
    if (nome === 'dist' || nome === 'dist-test') fs.cpSync(de, para, { recursive: true });
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
  if (!ID.test(m.id) || !MODULO.test(m.modulo) || !MODULO.test(m.teste) || typeof m.de !== 'string' || !m.de ||
      typeof m.para !== 'string' || m.de === m.para || typeof m.nome !== 'string' || !m.nome) {
    return falha(`o mutante ${id} está fora do formato (id, modulo, de, para, teste e nome)`);
  }
  const alvos = [path.join('core', 'dist', `${m.modulo}.js`), path.join('core', 'dist-test', 'src', `${m.modulo}.js`)];
  if (!alvos.some((a) => fs.existsSync(path.join(RAIZ, a)))) return falha(`o módulo ${m.modulo} não está compilado: rode o build e o build:test`);
  const teste = path.join('core', 'dist-test', 'test', `${m.teste}.test.js`);
  if (!fs.existsSync(path.join(RAIZ, teste))) return falha(`o teste ${teste} não está compilado`);
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-mutante-'));
  try {
    copiar(copia);
    for (const alvo of alvos) {
      const arquivo = path.join(copia, alvo);
      if (!fs.existsSync(arquivo)) continue;
      const texto = fs.readFileSync(arquivo, 'utf8');
      const vezes = texto.split(m.de).length - 1;
      if (vezes !== 1) return falha(`o trecho do mutante ${id} aparece ${vezes} vez(es) em ${alvo}: precisa ser exatamente uma`);
      fs.writeFileSync(arquivo, texto.replace(m.de, () => m.para));
    }
    // Dentro de um `node --test` (a suíte), o filho herdaria o contexto do runner e escreveria no formato dele, e não em TAP:
    // nenhum teste apareceria, e o mutante não teria veredito.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test-reporter=tap', `--test-name-pattern=${m.nome}`, path.join(copia, teste)],
      { cwd: copia, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env });
    const linhas = (r.stdout || '').split('\n');
    // Só os testes de primeiro nível que rodaram de fato: o pulado pelo nome não conta.
    const rodaram = linhas.filter((l) => /^(?:not )?ok \d+ - /.test(l) && !/# SKIP\b/.test(l));
    if (!rodaram.length) return falha(`nenhum teste de ${teste} casou com ${m.nome} (${r.error ? r.error.message : `saída ${r.status}`})`);
    const caidos = rodaram.filter((l) => l.startsWith('not ok'));
    if (caidos.length) {
      console.log(`mutante ${id}: morto (${caidos.length} de ${rodaram.length} teste(s) caíram) - ${m.descricao || m.modulo}`);
      return 0;
    }
    console.log(`mutante ${id}: SOBREVIVEU (${rodaram.length} teste(s) passaram com a troca) - ${m.descricao || m.modulo}`);
    return 1;
  } finally {
    fs.rmSync(copia, { recursive: true, force: true });
  }
}

module.exports = { main };

if (require.main === module) process.exit(main(process.argv.slice(2)));

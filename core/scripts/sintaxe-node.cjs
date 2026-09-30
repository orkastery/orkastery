/**
 * RM-031 KG2 (D16): juiz de sintaxe JavaScript do extrator. E o V8 do Node que roda a extracao, o
 * mesmo que carregaria o arquivo: CommonJS pela compilacao em funcao que o carregador usa
 * (`vm.compileFunction` com as variaveis do modulo), ESM por `node --check --input-type=module`.
 * Fica fora do pacote publicado, como o comando provisorio: o extrator recebe `sintaxe` por
 * parametro e nao importa `vm` nem processo. `versao` entra na versao do `ork.ts-ast`.
 *
 * `sintaxe(texto, formato)` diz se o V8 aceita o texto como CommonJS (`cjs`) ou como ESM (`esm`).
 * Nao executa nada: compilar em funcao nao roda o corpo, e `--check` so analisa.
 */
'use strict';

const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const VARIAVEIS_DO_CJS = ['exports', 'require', 'module', '__filename', '__dirname'];

function criarJuizDeSintaxe() {
  const vistos = new Map();
  const cjs = (texto) => {
    // O carregador aceita a linha `#!` no inicio; a funcao compilada nao, entao ela vira espaco.
    const semHashbang = texto.startsWith('#!') ? texto.replace(/^#![^\r\n]*/, (m) => ' '.repeat(m.length)) : texto;
    try {
      vm.compileFunction(semHashbang, VARIAVEIS_DO_CJS);
      return true;
    } catch (e) {
      if (e instanceof SyntaxError) return false;
      throw e;
    }
  };
  const esm = (texto) => {
    const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: texto, encoding: 'utf8', env: {}, timeout: 60000 });
    if (r.error || r.signal || (r.status !== 0 && !/SyntaxError/.test(r.stderr))) {
      throw new Error(`sintaxe.esm.indisponivel: ${r.error ? r.error.message : r.signal ?? r.stderr.trim().split('\n').pop()}`);
    }
    return r.status === 0;
  };
  const sintaxe = (texto, formato) => {
    const chave = formato + texto;
    let r = vistos.get(chave);
    if (r === undefined) {
      r = formato === 'esm' ? esm(texto) : cjs(texto);
      vistos.set(chave, r);
    }
    return r;
  };
  return { sintaxe, versao: `node.${process.versions.node}` };
}

module.exports = { criarJuizDeSintaxe };

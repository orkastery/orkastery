/**
 * RM-031 KG2 (D16): juiz de sintaxe JavaScript do extrator. E o V8 do Node que roda a extracao, o
 * mesmo que carregaria o arquivo. Fica fora do pacote publicado, como o comando provisorio: o
 * extrator recebe `sintaxe` por parametro e nao importa `vm` nem processo. `versao` entra na versao
 * do `ork.ts-ast`.
 *
 * `sintaxe(pedidos)` recebe `{ texto, formato }` e devolve, na mesma ordem, se o V8 aceita cada texto
 * como CommonJS (`cjs`) ou como ESM (`esm`). CommonJS compila aqui mesmo, em funcao com as variaveis
 * do modulo, como o carregador faz. ESM compila num unico processo filho por chamada, com
 * `vm.SourceTextModule`, que so analisa o modulo, sem ligar nem avaliar. O veredito volta estruturado
 * no stdout; o stderr nunca e lido. Nada e executado.
 */
'use strict';

const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const VARIAVEIS_DO_CJS = ['exports', 'require', 'module', '__filename', '__dirname'];
/** O V8 encerra a linha, e a linha `#!`, em LF, CR, U+2028 e U+2029. */
const FIM_DE_LINHA = new Set([0x0a, 0x0d, 0x2028, 0x2029]);
/** Processo filho: le os textos por stdin e devolve 1 (aceito), 0 (SyntaxError) ou 2 (outro erro). */
const FILHO = `
const vm = require('node:vm');
const partes = [];
process.stdin.on('data', (c) => partes.push(c));
process.stdin.on('end', () => {
  const textos = JSON.parse(Buffer.concat(partes).toString('utf8'));
  const r = textos.map((t) => { try { new vm.SourceTextModule(t); return 1; } catch (e) { return e instanceof SyntaxError ? 0 : 2; } });
  process.stdout.write(JSON.stringify(r));
});
`;

/** Como o carregador do Node le a fonte: sem o BOM e com a linha `#!` do inicio em branco. */
function comoOCarregadorLe(texto) {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  if (!t.startsWith('#!')) return t;
  let fim = 2;
  while (fim < t.length && !FIM_DE_LINHA.has(t.charCodeAt(fim))) fim++;
  return ' '.repeat(fim) + t.slice(fim);
}

function criarJuizDeSintaxe() {
  const vistos = new Map();
  const cjs = (texto) => {
    try {
      vm.compileFunction(texto, VARIAVEIS_DO_CJS);
      return true;
    } catch (e) {
      if (e instanceof SyntaxError) return false;
      throw e;
    }
  };
  const esmEmLote = (textos) => {
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', FILHO], {
      input: JSON.stringify(textos), encoding: 'utf8', env: {}, maxBuffer: 64 * 1024 * 1024, timeout: 600000,
    });
    let vereditos = null;
    if (!r.error && r.status === 0) {
      try {
        vereditos = JSON.parse(r.stdout);
      } catch {
        vereditos = null;
      }
    }
    if (!Array.isArray(vereditos) || vereditos.length !== textos.length || vereditos.some((v) => v !== 0 && v !== 1)) {
      throw new Error(`sintaxe.esm.indisponivel: ${r.error ? r.error.code ?? 'erro' : r.signal ?? `status ${r.status}`}`);
    }
    return vereditos.map((v) => v === 1);
  };
  const sintaxe = (pedidos) => {
    const chaves = pedidos.map((p) => p.formato + createHash('sha256').update(p.texto).digest('hex'));
    const esm = new Map();
    pedidos.forEach((p, i) => {
      if (vistos.has(chaves[i]) || esm.has(chaves[i])) return;
      const t = comoOCarregadorLe(p.texto);
      if (p.formato === 'cjs') vistos.set(chaves[i], cjs(t));
      else esm.set(chaves[i], t);
    });
    if (esm.size) {
      const lista = [...esm];
      const r = esmEmLote(lista.map(([, t]) => t));
      lista.forEach(([k], i) => vistos.set(k, r[i]));
    }
    return chaves.map((k) => vistos.get(k));
  };
  return { sintaxe, versao: `node.${process.versions.node}` };
}

module.exports = { criarJuizDeSintaxe };

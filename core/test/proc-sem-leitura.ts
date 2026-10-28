/**
 * RM-067 (F4c, thread ork-rm067f4cmcpd, GO-FIX 4): o `/proc` que não se lista, no processo do servidor MCP do `grok` nos
 * testes. Carregado por `NODE_OPTIONS=--require` (GX11 em `rm067-grok-mcp-externo.test.ts`): com
 * `ORK_TESTE_PROC_SEM_LEITURA=1`, listar o `/proc` ou as tarefas de um processo lança EMFILE, como na falta de descritores;
 * com `sem-codigo`, lança um erro sem código, como um defeito do próprio código. Sem a variável, nada muda.
 */
import fs = require('node:fs');

const modo = process.env.ORK_TESTE_PROC_SEM_LEITURA;

if (modo === '1' || modo === 'sem-codigo') {
  const original = fs.readdirSync as (...args: unknown[]) => unknown;
  (fs as { readdirSync: unknown }).readdirSync = (caminho: unknown, ...resto: unknown[]) => {
    if (caminho === '/proc' || /^\/proc\/\d+\/task$/.test(String(caminho))) {
      if (modo === 'sem-codigo') throw new TypeError('falha simulada da conferencia');
      throw Object.assign(new Error(`EMFILE: too many open files, scandir '${String(caminho)}'`), { code: 'EMFILE' });
    }
    return original(caminho, ...resto);
  };
}

export {};

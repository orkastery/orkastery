/**
 * RM-031 KG5 (D3, D8): o worker da consulta do grafo pelo MCP.
 *
 * Roda num processo filho, aberto pelo `mcp-grafo.ts` com o ambiente minimo do MCP. Le `{raiz, argv}`
 * do stdin, confere que o cwd e a raiz, aceita so as cinco consultas no argv que as tools montam (com
 * `--json` e `--teto-bytes`), carrega o manifesto da raiz (a worktree da thread) e chama o
 * `executarGrafo` com o argv que a CLI receberia: a resposta e a do `ork grafo`, byte a byte. O `main` do
 * `ork` nao roda aqui, entao nada do argv vira `--projeto`, `--version` ou `--help`.
 *
 * E a segunda porta da familia do grafo, so pelo CLI dela (a fronteira confere). Saida 0 e resposta,
 * 1 e recusa tipada da consulta (JSON no stdout), 2 e entrada recusada pelo proprio worker (stderr).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { executarGrafo } from './intelligence-graph-cli';
import { exigirManifesto } from './manifest';
import { raizDoEstado } from './estado-thread';
import { lerEntradaDaThread } from './mcp-grafo';

const CONSULTAS: Readonly<Record<string, number>> = Object.freeze({ vizinhos: 1, chamadores: 1, importadores: 1, caminho: 2, contexto: 1 });
const OPCAO = /^--(profundidade|sentido|tipo|limite|teto-bytes)=[a-z0-9_,]{1,120}$/;
const PEDIDO = z.object({
  raiz: z.string().min(1).max(4096).refine((p) => path.isAbsolute(p), 'raiz absoluta'),
  argv: z.array(z.string().min(1).max(2048)).min(4).max(12),
}).strict();

/** Confere o pedido e roda a consulta; erro de entrada e lancado, com o prefixo `grafo.mcp.worker`. */
export function rodarConsulta(entrada: unknown, cwd: string, escrever: (texto: string) => void): number {
  const lido = PEDIDO.safeParse(entrada);
  if (!lido.success) throw Error('grafo.mcp.worker: pedido fora do schema');
  const { raiz, argv } = lido.data;
  if (fs.realpathSync(cwd) !== fs.realpathSync(raiz)) throw Error('grafo.mcp.worker: o cwd nao e a raiz pedida');
  const [sub, ...resto] = argv;
  if (!Object.prototype.hasOwnProperty.call(CONSULTAS, sub)) throw Error(`grafo.mcp.worker: so as consultas ${Object.keys(CONSULTAS).join(', ')}`);
  const posicionais = resto.slice(0, CONSULTAS[sub]), opcoes = resto.slice(CONSULTAS[sub]);
  if (posicionais.length !== CONSULTAS[sub] || posicionais.some((p) => p.startsWith('--'))) throw Error('grafo.mcp.worker: no ausente ou com -- no inicio');
  if (!opcoes.includes('--json') || !opcoes.some((o) => o.startsWith('--teto-bytes='))
    || opcoes.some((o) => o !== '--json' && !OPCAO.test(o))) throw Error('grafo.mcp.worker: opcoes fora das que a tool monta');
  const carregado = exigirManifesto(raiz);
  if (fs.realpathSync(carregado.raiz) !== fs.realpathSync(raiz)) throw Error('grafo.mcp.worker: o manifesto nao e o da raiz pedida');
  return executarGrafo(argv, { raiz: carregado.raiz, estado: raizDoEstado(carregado.raiz), repositorio: carregado.manifesto.project.name,
    contextoDaThread: (id) => lerEntradaDaThread(carregado.raiz, id), escrever });
}

if (require.main === module) {
  try {
    process.exitCode = rodarConsulta(JSON.parse(fs.readFileSync(0, 'utf8')), process.cwd(), (texto) => { process.stdout.write(texto); });
  } catch (e) {
    process.stderr.write(`${(e as Error).message.split('\n')[0]}\n`);
    process.exitCode = 2;
  }
}

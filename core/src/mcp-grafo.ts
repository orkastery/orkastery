/**
 * RM-031 KG5: a consulta do grafo de codigo pelas fases, pelo MCP do projeto.
 *
 * Quatro tools de leitura com o contrato do `ork grafo` (D6): cada uma roda, na worktree da thread, o
 * argv que a CLI receberia (`<consulta> ... --json --teto-bytes N`) e devolve a saida sem transformar,
 * JSON `ork.code-graph-query/v0` com a evidencia de cada aresta e no maximo `tetoBytes` bytes (D4).
 *
 * Desligadas por padrao (D2): so existem com `grafo.mcp: true` no manifesto da raiz, lido no startup, e
 * cada chamada confere a flag de novo. A consulta roda num worker (D3), um processo filho por chamada,
 * com o ambiente minimo do MCP, grupo proprio, prazo, cancelamento e teto do stdout: o servidor nao
 * carrega o grafo nem o compilador. Este modulo nao importa a familia do grafo; o worker importa, so
 * pelo CLI dela (D8). Erro de transporte (flag, thread, worker) vem como `{erro}`, como nas outras tools;
 * erro da consulta vem como o JSON da CLI, com `isError`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Manifesto } from './types';
import { ambienteGitMcp } from './mcp-git';

export const TOOLS_DO_GRAFO = ['ork_grafo_vizinhos', 'ork_grafo_chamadores', 'ork_grafo_importadores', 'ork_grafo_caminho'] as const;
/** D4: o teto das respostas, em bytes do JSON. */
export const TETO_PADRAO = 32768;
export const TETO_MINIMO = 4096;
export const TETO_MAXIMO = 65536;
/** D3: prazo de uma consulta de ponta a ponta (a CLI leva cerca de 1 s neste repositorio). */
export const PRAZO_DA_CONSULTA_MS = 60000;
/** A resposta cabe no teto; o que passa disso e erro de outra ordem, e o worker morre. */
const TETO_DO_STDOUT = 1024 * 1024;
/**
 * O vocabulario e os limites da consulta do KG3, repetidos aqui porque este modulo nao importa a
 * familia do grafo (D8); o teste confere que sao os mesmos do contrato v1 e da consulta.
 */
export const TIPOS_DE_ARESTA_DO_MCP = ['contains', 'declares', 'imports', 'calls', 'references', 'derived_from'] as const;
export const PROFUNDIDADE_MAXIMA_DO_MCP = 5;
export const LIMITE_MAXIMO_DO_MCP = 10_000;

type Registrar = <S extends z.AnyZodObject>(nome: string,
  config: { description: string; inputSchema: S; annotations: Tool['annotations'] },
  handler: (args: z.infer<S>, extra: { signal: AbortSignal }) => Promise<CallToolResult>) => void;

/** D2: so o booleano `true` do manifesto da raiz liga as tools. */
export function grafoLigado(manifesto: Pick<Manifesto, 'grafo'>): boolean {
  return manifesto.grafo?.mcp === true;
}

const threadId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
/** D6: o parser do `ork grafo` trata `--` como opcao, entao o no nao comeca assim, como na CLI. */
const no = (descricao: string) => z.string().min(1).max(2048)
  .refine((v) => !v.startsWith('--') && !v.includes('\u0000'), { message: 'grafo.uso: o no nao comeca com -- nem tem NUL' })
  .describe(descricao);
const DESCRICAO_DO_NO = 'no do grafo: caminho do arquivo, caminho#fragmento, tipo:caminho#fragmento ou o nome solto de simbolo, secao ou artefato';
const profundidade = z.number().int().min(1).max(PROFUNDIDADE_MAXIMA_DO_MCP).optional()
  .describe(`saltos a partir do alvo, de 1 a ${PROFUNDIDADE_MAXIMA_DO_MCP} (padrao 1)`);
const limite = z.number().int().min(1).max(LIMITE_MAXIMO_DO_MCP).optional()
  .describe('maximo de arestas, as mais perto do alvo primeiro (padrao 500)');
const sentido = z.enum(['entrada', 'saida', 'ambos']).optional().describe('sentido das arestas a partir do alvo');
const tipos = z.array(z.enum(TIPOS_DE_ARESTA_DO_MCP)).min(1).max(TIPOS_DE_ARESTA_DO_MCP.length).optional()
  .describe('tipos de aresta a percorrer (padrao: todos)');
const tetoBytes = z.number().int().min(TETO_MINIMO).max(TETO_MAXIMO).optional()
  .describe(`teto da resposta em bytes, de ${TETO_MINIMO} a ${TETO_MAXIMO} (padrao ${TETO_PADRAO}); acima dele saem as arestas mais longe do alvo`);

const COMUM = 'Leitura do grafo de codigo do HEAD da worktree da thread, o mesmo do ork grafo; so o que o extrator prova. '
  + `Resposta JSON ork.code-graph-query/v0 de no maximo tetoBytes (padrao ${TETO_PADRAO}); sem o indice do HEAD, recusa com a correcao ork grafo indexar.`;

interface Definicao { nome: typeof TOOLS_DO_GRAFO[number]; descricao: string; schema: z.AnyZodObject; argv: (a: Record<string, unknown>) => string[] }

/** As opcoes da CLI, na ordem dela, com `=`: o valor nunca vira outro argumento. */
function opcoes(a: Record<string, unknown>): string[] {
  const r: string[] = [];
  if (a.profundidade !== undefined) r.push(`--profundidade=${a.profundidade}`);
  if (a.sentido !== undefined) r.push(`--sentido=${a.sentido}`);
  if (a.tipos !== undefined) r.push(`--tipo=${(a.tipos as string[]).join(',')}`);
  if (a.limite !== undefined) r.push(`--limite=${a.limite}`);
  r.push('--json', `--teto-bytes=${a.tetoBytes ?? TETO_PADRAO}`);
  return r;
}

const DEFINICOES: readonly Definicao[] = [
  {
    nome: 'ork_grafo_vizinhos',
    descricao: `Vizinhanca de um no (ork grafo vizinhos): as arestas a ate N saltos, cada uma com extrator, metodo e evidencia (arquivo, linhas e bytes). ${COMUM}`,
    schema: z.object({ threadId, alvo: no(DESCRICAO_DO_NO), profundidade, sentido, tipos, limite, tetoBytes }).strict(),
    argv: (a) => ['vizinhos', a.alvo as string, ...opcoes(a)],
  },
  {
    nome: 'ork_grafo_chamadores',
    descricao: `Quem chama o simbolo (ork grafo chamadores): as arestas calls que chegam, cada uma com a evidencia. ${COMUM}`,
    schema: z.object({ threadId, alvo: no('simbolo chamado, como caminho#simbolo ou o nome solto'), profundidade, limite, tetoBytes }).strict(),
    argv: (a) => ['chamadores', a.alvo as string, ...opcoes(a)],
  },
  {
    nome: 'ork_grafo_importadores',
    descricao: `Quem importa o arquivo ou o simbolo (ork grafo importadores): as arestas imports que chegam, cada uma com a evidencia. ${COMUM}`,
    schema: z.object({ threadId, alvo: no('arquivo ou simbolo importado'), profundidade, limite, tetoBytes }).strict(),
    argv: (a) => ['importadores', a.alvo as string, ...opcoes(a)],
  },
  {
    nome: 'ork_grafo_caminho',
    descricao: `Menor caminho entre dois nos (ork grafo caminho), cada passo com a evidencia; o caminho nao se corta: se nao cabe no teto, recusa. ${COMUM}`,
    schema: z.object({ threadId, de: no(`origem; ${DESCRICAO_DO_NO}`), para: no('destino, na mesma forma'), sentido, tipos, tetoBytes }).strict(),
    argv: (a) => ['caminho', a.de as string, a.para as string, ...opcoes(a)],
  },
];

export interface SaidaDoWorker {
  /** O codigo de saida do worker; `null` quando ele foi morto ou nao abriu. */
  codigo: number | null;
  saida: string;
  /** A primeira linha do stderr, para o motivo da falha. */
  erro: string;
  /** Prazo, cancelamento ou stdout acima do teto: o worker foi morto por isso. */
  interrompido: string | null;
  /** O processo do worker (lider do grupo), para quem confere que nao sobrou processo. */
  pid: number | null;
}

/**
 * D3: roda a consulta num processo filho, em grupo proprio, com o ambiente minimo do MCP. Prazo,
 * cancelamento e stdout acima do teto matam o grupo; a promessa sempre resolve.
 */
export function consultarPeloWorker(raiz: string, argv: readonly string[], opcoesDoWorker: { signal?: AbortSignal; prazoMs?: number } = {}): Promise<SaidaDoWorker> {
  return new Promise((resolve) => {
    if (opcoesDoWorker.signal?.aborted) {
      resolve({ codigo: null, saida: '', erro: '', interrompido: 'cancelada', pid: null });
      return;
    }
    const grupo = process.platform !== 'win32';
    const filho = spawn(process.execPath, [path.join(__dirname, 'mcp-grafo-worker.js')], {
      cwd: raiz, env: ambienteGitMcp(), stdio: ['pipe', 'pipe', 'pipe'], detached: grupo,
    });
    let saida = '', erro = '', terminado = false;
    const concluir = (r: SaidaDoWorker): void => {
      if (terminado) return;
      terminado = true;
      clearTimeout(prazo);
      opcoesDoWorker.signal?.removeEventListener('abort', cancelar);
      resolve(r);
    };
    const interromper = (motivo: string): void => {
      if (terminado) return;
      filho.stdout?.destroy();
      filho.stderr?.destroy();
      try {
        if (filho.pid) process.kill(grupo ? -filho.pid : filho.pid, 'SIGKILL');
      } catch { /* ja terminou */ }
      concluir({ codigo: null, saida: '', erro, interrompido: motivo, pid: filho.pid ?? null });
    };
    const cancelar = (): void => interromper('cancelada');
    const prazoMs = opcoesDoWorker.prazoMs ?? PRAZO_DA_CONSULTA_MS;
    const prazo = setTimeout(() => interromper(`prazo de ${prazoMs} ms`), prazoMs);
    opcoesDoWorker.signal?.addEventListener('abort', cancelar, { once: true });
    filho.stdout.setEncoding('utf8');
    filho.stdout.on('data', (parte: string) => {
      saida += parte;
      if (saida.length > TETO_DO_STDOUT) interromper('saida acima do teto do worker');
    });
    filho.stderr.setEncoding('utf8');
    filho.stderr.on('data', (parte: string) => { if (erro.length < 4096) erro += parte; });
    filho.stdin.on('error', () => undefined);
    filho.on('error', (e) => concluir({ codigo: null, saida: '', erro: e.message, interrompido: null, pid: filho.pid ?? null }));
    filho.on('close', (codigo, sinal) => concluir({ codigo: sinal ? null : codigo, saida, erro, interrompido: null, pid: filho.pid ?? null }));
    filho.stdin.end(JSON.stringify({ raiz, argv }));
  });
}

const texto = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/**
 * As quatro tools, chamadas pelo servidor so com a flag ligada no startup. `carregar` e `thread` sao os
 * do servidor: o projeto fixado e a thread conferida (escopo da sessao filha e worktree confinada).
 */
export function registrarConsultasDoGrafo(registrar: Registrar, contexto: {
  raiz: string;
  carregar: () => { manifesto: Pick<Manifesto, 'grafo'> };
  thread: (id: string) => { worktree: string | null };
  prazoMs?: number;
}): void {
  for (const d of DEFINICOES) {
    registrar(d.nome, { description: d.descricao, inputSchema: d.schema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      async (args, extra) => {
        if (!grafoLigado(contexto.carregar().manifesto)) {
          throw Error('grafo.mcp.desligado: a consulta do grafo pelo MCP esta desligada no manifesto (grafo.mcp); ligar e decisao do dono e vale para as sessoes abertas depois');
        }
        const t = contexto.thread(args.threadId as string);
        const cwd = fs.realpathSync(t.worktree ?? contexto.raiz);
        const r = await consultarPeloWorker(cwd, d.argv(args), { signal: extra.signal, prazoMs: contexto.prazoMs });
        if (r.interrompido) throw Error(`grafo.mcp.indisponivel: consulta interrompida (${r.interrompido})`);
        if (r.codigo === 0 && Buffer.byteLength(r.saida) <= ((args.tetoBytes as number | undefined) ?? TETO_PADRAO)) return texto(r.saida);
        if (r.codigo === 1 && r.saida.startsWith('{')) return texto(r.saida, true);
        throw Error(`grafo.mcp.indisponivel: o worker saiu com ${r.codigo ?? 'sinal'}${r.erro ? `: ${r.erro.split('\n')[0].slice(0, 300)}` : ''}`);
      });
  }
}

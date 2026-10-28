/**
 * RM-067 (F4c, thread ork-rm067f4cmcpd): o lançador do servidor MCP do `ork` da sessão filha do `grok`, fora do sandbox
 * dele. O sandbox do `grok` vale para o processo inteiro e os filhos (G17 da RM-067): o servidor que o `grok` subia por
 * stdio lia o estado, mas não gravava o ledger, os artefatos nem o git da worktree. Desde a F4c, o despacho sobe o servidor
 * antes do `grok`, como processo do próprio `ork` (`grok-mcp-servidor.ts`), e o `grok` se conecta pela forma `url` do guia
 * oficial (G16), com o token na variável do `bearer_token_env_var` (G5). Este módulo fica leve, sem o `mcp-server.ts`: o
 * `grok.ts` o importa, e o servidor é outro arquivo, lançado por caminho como o supervisor do `codex-runner`, fora do ciclo
 * de imports.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { estadoProcesso, IdentidadeProcesso, identidadeProcesso } from './codex-runner';
import type { PermissoesFilhoMcp, TransporteShipMcp } from '../mcp-install';

/** O contrato do pedido e do recibo do servidor. */
export const CONTRATO_DO_SERVIDOR_GROK = 'ork.grok-mcp/v1';
/** D1: só o loopback, porta efêmera, e o caminho do Streamable HTTP. */
export const ENDERECO_DO_SERVIDOR_GROK = '127.0.0.1';
export const CAMINHO_DO_SERVIDOR_GROK = '/mcp';
/**
 * D2 (GO-FIX 1, achado 1 da revisão): o token do despacho mora só no ambiente do servidor e no da sessão (o supervisor e o
 * `grok`, com os filhos dele), nesta variável, que a config da worktree nomeia em `bearer_token_env_var` (G5). Num arquivo,
 * a sessão `grok` de outra thread, que no `workspace` lê em qualquer lugar, acharia o token e a porta; o `environ` de outro
 * processo ela não lê, porque o Landlock nega o ptrace, e a leitura do `/proc/<pid>/environ`, a quem não está num domínio
 * aninhado ao dela. E, como a saída de uma ferramenta da sessão pode levar o token a um log, o servidor também confere que a
 * conexão vem da árvore de processos do `grok` (GO-FIX 2, R1).
 */
export const ENV_DO_TOKEN_DO_SERVIDOR_GROK = 'ORK_GROK_MCP_TOKEN';
/** D6: quanto o despacho espera o recibo `pronto` do servidor. */
export const ESPERA_DO_SERVIDOR_MS = 30_000;
/** D5: quanto o servidor espera o `.process.json` do supervisor; o pedido só o muda entre 1 s e 10 min. */
export const PRAZO_DA_PARTIDA_MS = 60_000;

/** O pedido que o despacho manda ao servidor, por descritor anônimo (nunca em argv). O token vai à parte, no ambiente. */
export interface PedidoServidorGrok {
  schema: typeof CONTRATO_DO_SERVIDOR_GROK;
  /** A raiz canônica do projeto. */
  projeto: string;
  threadId: string;
  /** A identidade do despacho (I-36): o servidor serve só ele. */
  dispatchId: string;
  permissoesFilho: PermissoesFilhoMcp;
  transporteShip: TransporteShipMcp;
  /** D4: as ferramentas do `--allow` deste despacho (`ferramentasDoGrok`). */
  ferramentas: string[];
  /**
   * D2 (GO-FIX 2, R1): conferir que a conexão vem da árvore de processos do `grok` deste despacho. O despacho liga com o
   * `grok` no sandbox, em que o agente roda no próprio processo (G17); no perfil `off`, o guia não diz quem conecta.
   */
  conferirProcesso: boolean;
  /** O log do supervisor do `grok`: o servidor vigia `<logPath>.process.json` e `<logPath>.exit.json`. */
  logPath: string;
  /** O recibo do servidor: `pronto` com a porta, depois `encerrado` com o motivo. */
  reciboPath: string;
  prazoDaPartidaMs?: number;
}

/** O recibo que o servidor grava ao abrir a porta e ao sair. Nunca leva o token. */
export interface ReciboServidorGrok {
  schema: typeof CONTRATO_DO_SERVIDOR_GROK;
  estado: 'pronto' | 'encerrado';
  url: string;
  porta: number;
  processo: IdentidadeProcesso | null;
  /** O pid do pai: o processo do `ork` que despachou, nunca o `grok`. */
  pai: number;
  threadId: string;
  dispatchId: string;
  /** Se a conexão é conferida pela árvore de processos do `grok` (D2). */
  conferirProcesso: boolean;
  iniciadoEm: string;
  encerradoEm?: string;
  /** `recibo`, `grok-ausente`, `sem-partida`, `sinal` ou `erro`. */
  motivo?: string;
}

/** O servidor de pé: a URL e o token que vão à config e ao ambiente do `grok`, e o encerramento pelo despacho. */
export interface ServidorDoGrokIniciado {
  url: string;
  porta: number;
  /** O token deste despacho, que o despacho passa ao `grok` na variável `ENV_DO_TOKEN_DO_SERVIDOR_GROK`. */
  token: string;
  reciboPath: string;
  processo: IdentidadeProcesso;
  /** Encerra o servidor (SIGTERM) se ele ainda é o processo lançado; o despacho chama em toda falha depois de subi-lo. */
  encerrar: () => void;
}

/** Os arquivos do servidor de um despacho, na pasta de sessões da thread, ao lado do log do supervisor. */
export function arquivosDoServidorGrok(logPath: string): { reciboPath: string; stderrPath: string } {
  const base = logPath.replace(/\.grok\.jsonl$/, '');
  return { reciboPath: `${base}.grok-mcp.json`, stderrPath: `${base}.grok-mcp.log` };
}

const LIMITE_DO_JSON_BYTES = 65536;
const LIMITE_DA_CAUSA = 300;

/** JSON pequeno de um arquivo comum, sem seguir link; ausente, grande ou ilegível vira `null`. */
export function lerJsonPequeno<T>(arquivo: string): T | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_DO_JSON_BYTES) return null;
    return JSON.parse(fs.readFileSync(fd, 'utf8')) as T;
  } catch { return null; }
  finally { fs.closeSync(fd); }
}

/** O recibo do servidor; outro contrato vira `null`. */
export function lerReciboServidorGrok(arquivo: string): ReciboServidorGrok | null {
  const recibo = lerJsonPequeno<ReciboServidorGrok>(arquivo);
  return recibo?.schema === CONTRATO_DO_SERVIDOR_GROK ? recibo : null;
}

/** A última linha do stderr do servidor, curta: o motivo de ele ter saído antes de ficar pronto. */
function causaDoStderr(arquivo: string): string {
  try {
    const linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n');
    const ultima = (linhas.at(-1) ?? '').trim().slice(0, LIMITE_DA_CAUSA);
    return ultima ? ` (${ultima})` : '';
  } catch { return ''; }
}

const pausa = new Int32Array(new SharedArrayBuffer(4));

/**
 * D6: lança o servidor destacado, com o pedido por descritor anônimo e o token no ambiente, e espera o recibo `pronto`. O
 * processo que morre antes, ou o prazo vencido, recusam com `runtime.unavailable`; no prazo vencido, o servidor é encerrado
 * antes da recusa. O ambiente é o do filho do `grok` (o mesmo que o servidor stdio herdava), e o cwd é a worktree.
 */
export function iniciarServidorDoGrok(pedido: Omit<PedidoServidorGrok, 'schema' | 'reciboPath'>, cwd: string,
    env: NodeJS.ProcessEnv, esperaMs = ESPERA_DO_SERVIDOR_MS): ServidorDoGrokIniciado {
  fs.mkdirSync(path.dirname(pedido.logPath), { recursive: true });
  const { reciboPath, stderrPath } = arquivosDoServidorGrok(pedido.logPath);
  const completo: PedidoServidorGrok = { schema: CONTRATO_DO_SERVIDOR_GROK, ...pedido, reciboPath };
  const token = randomBytes(32).toString('hex');
  // FD anônimo, como no supervisor: o pedido não fica em argv nem num arquivo persistente; ele não tem segredo.
  const tmp = `${reciboPath}.${randomUUID()}.launch`;
  fs.writeFileSync(tmp, JSON.stringify(completo), { flag: 'wx', mode: 0o600 });
  const entrada = fs.openSync(tmp, 'r');
  fs.unlinkSync(tmp);
  let pid: number | undefined;
  try {
    // `ax`: o log nasce com o despacho e nunca segue um link deixado no lugar dele.
    const erro = fs.openSync(stderrPath, 'ax', 0o600);
    try {
      const filho = spawn(process.execPath, [path.join(__dirname, 'grok-mcp-servidor.js'), '--run'], {
        cwd, env: { ...env, [ENV_DO_TOKEN_DO_SERVIDOR_GROK]: token }, detached: true, stdio: [entrada, 'ignore', erro],
      });
      filho.on('error', () => { /* sem o recibo, o prazo abaixo recusa */ });
      filho.unref();
      pid = filho.pid;
    } finally { fs.closeSync(erro); }
  } finally { fs.closeSync(entrada); }
  if (!pid) throw new Error('runtime.unavailable: o servidor MCP do ork para o grok nao iniciou');
  const processo = identidadeProcesso(pid);
  const lancado = pid;
  const encerrar = () => {
    if (processo && estadoProcesso(processo) === 'vivo') { try { process.kill(lancado, 'SIGTERM'); } catch { /* ja saiu */ } }
  };
  const prazo = Date.now() + esperaMs;
  for (;;) {
    const recibo = lerReciboServidorGrok(reciboPath);
    if (recibo?.estado === 'pronto' && processo && recibo.processo?.pid === lancado && recibo.processo.inicio === processo.inicio)
      return { url: recibo.url, porta: recibo.porta, token, reciboPath, processo, encerrar };
    if (!processo || estadoProcesso(processo) === 'ausente')
      throw new Error(`runtime.unavailable: o servidor MCP do ork para o grok saiu antes de ficar pronto${causaDoStderr(stderrPath)}`);
    if (Date.now() >= prazo) {
      encerrar();
      throw new Error('runtime.unavailable: o servidor MCP do ork para o grok nao ficou pronto no prazo');
    }
    Atomics.wait(pausa, 0, 0, 50);
  }
}

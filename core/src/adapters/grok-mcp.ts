/**
 * RM-067 (F4c, thread ork-rm067f4cmcpd): o lançador do servidor MCP do `ork` da sessão filha do `grok`, fora do sandbox
 * dele. O sandbox do `grok` vale para o processo inteiro e os filhos (G17 da RM-067): o servidor que o `grok` subia por
 * stdio lia o estado, mas não gravava o ledger, os artefatos nem o git da worktree. Desde a F4c, o despacho sobe o servidor
 * antes do `grok`, como processo do próprio `ork` (`grok-mcp-servidor.ts`), e o `grok` se conecta pela forma `url` do guia
 * oficial (G16), com o token do `bearer_token_file`. Este módulo fica leve, sem o `mcp-server.ts`: o `grok.ts` o importa, e
 * o servidor é outro arquivo, lançado por caminho como o supervisor do `codex-runner`, fora do ciclo de imports.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { estadoProcesso, IdentidadeProcesso, identidadeProcesso } from './codex-runner';
import type { PermissoesFilhoMcp, TransporteShipMcp } from '../mcp-install';

/** O contrato do pedido e do recibo do servidor. */
export const CONTRATO_DO_SERVIDOR_GROK = 'ork.grok-mcp/v1';
/** D1: só o loopback, porta efêmera, e o caminho do Streamable HTTP. */
export const ENDERECO_DO_SERVIDOR_GROK = '127.0.0.1';
export const CAMINHO_DO_SERVIDOR_GROK = '/mcp';
/** D6: quanto o despacho espera o recibo `pronto` do servidor. */
export const ESPERA_DO_SERVIDOR_MS = 30_000;
/** D5: quanto o servidor espera o `.process.json` do supervisor; o pedido só o muda entre 1 s e 10 min. */
export const PRAZO_DA_PARTIDA_MS = 60_000;

/** O pedido que o despacho manda ao servidor, por descritor anônimo (nunca em argv). */
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
  /** O log do supervisor do `grok`: o servidor vigia `<logPath>.process.json` e `<logPath>.exit.json`. */
  logPath: string;
  /** D2: o arquivo do token, que o próprio servidor cria (0600) e apaga ao sair. */
  tokenPath: string;
  /** O recibo do servidor: `pronto` com a porta, depois `encerrado` com o motivo. */
  reciboPath: string;
  prazoDaPartidaMs?: number;
}

/** O recibo que o servidor grava ao abrir a porta e ao sair. */
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
  iniciadoEm: string;
  encerradoEm?: string;
  /** `recibo`, `grok-ausente`, `sem-partida`, `sinal` ou `erro`. */
  motivo?: string;
}

/** O servidor de pé: a URL e o token que vão à config da worktree, e o encerramento pelo despacho. */
export interface ServidorDoGrokIniciado {
  url: string;
  porta: number;
  tokenPath: string;
  reciboPath: string;
  processo: IdentidadeProcesso;
  /** Encerra o servidor (SIGTERM) se ele ainda é o processo lançado; o despacho chama em toda falha depois de subi-lo. */
  encerrar: () => void;
}

/** Os arquivos do servidor de um despacho, na pasta de sessões da thread, ao lado do log do supervisor. */
export function arquivosDoServidorGrok(logPath: string): { tokenPath: string; reciboPath: string; stderrPath: string } {
  const base = logPath.replace(/\.grok\.jsonl$/, '');
  return { tokenPath: `${base}.grok-mcp.token`, reciboPath: `${base}.grok-mcp.json`, stderrPath: `${base}.grok-mcp.log` };
}

const LIMITE_DO_RECIBO_BYTES = 65536;
const LIMITE_DA_CAUSA = 300;

/** O recibo do servidor, sem seguir link; ausente ou ilegível vira `null`. */
export function lerReciboServidorGrok(arquivo: string): ReciboServidorGrok | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_DO_RECIBO_BYTES) return null;
    const recibo = JSON.parse(fs.readFileSync(fd, 'utf8')) as ReciboServidorGrok;
    return recibo?.schema === CONTRATO_DO_SERVIDOR_GROK ? recibo : null;
  } catch { return null; }
  finally { fs.closeSync(fd); }
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
 * D6: lança o servidor destacado, com o pedido por descritor anônimo, e espera o recibo `pronto`. O processo que morre
 * antes, ou o prazo vencido, recusam com `runtime.unavailable`; no prazo vencido, o servidor é encerrado antes da recusa.
 * O ambiente é o do filho do `grok` (o mesmo que o servidor stdio herdava), e o cwd é a worktree.
 */
export function iniciarServidorDoGrok(pedido: Omit<PedidoServidorGrok, 'schema' | 'tokenPath' | 'reciboPath'>, cwd: string,
    env: NodeJS.ProcessEnv, esperaMs = ESPERA_DO_SERVIDOR_MS): ServidorDoGrokIniciado {
  fs.mkdirSync(path.dirname(pedido.logPath), { recursive: true });
  const { tokenPath, reciboPath, stderrPath } = arquivosDoServidorGrok(pedido.logPath);
  const completo: PedidoServidorGrok = { schema: CONTRATO_DO_SERVIDOR_GROK, ...pedido, tokenPath, reciboPath };
  // FD anônimo, como no supervisor: o pedido não fica em argv nem num arquivo persistente.
  const tmp = `${reciboPath}.${randomUUID()}.launch`;
  fs.writeFileSync(tmp, JSON.stringify(completo), { flag: 'wx', mode: 0o600 });
  const entrada = fs.openSync(tmp, 'r');
  fs.unlinkSync(tmp);
  let pid: number | undefined;
  try {
    const erro = fs.openSync(stderrPath, 'a', 0o600);
    try {
      const filho = spawn(process.execPath, [path.join(__dirname, 'grok-mcp-servidor.js'), '--run'], {
        cwd, env, detached: true, stdio: [entrada, 'ignore', erro],
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
      return { url: recibo.url, porta: recibo.porta, tokenPath, reciboPath, processo, encerrar };
    if (!processo || estadoProcesso(processo) === 'ausente')
      throw new Error(`runtime.unavailable: o servidor MCP do ork para o grok saiu antes de ficar pronto${causaDoStderr(stderrPath)}`);
    if (Date.now() >= prazo) {
      encerrar();
      throw new Error('runtime.unavailable: o servidor MCP do ork para o grok nao ficou pronto no prazo');
    }
    Atomics.wait(pausa, 0, 0, 50);
  }
}

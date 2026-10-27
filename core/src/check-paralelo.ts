/**
 * RM-072 (D6 da ork-check5x): o grupo paralelo do Agile Check sem mudar a assinatura do `verificar`.
 *
 * O `verificar` e sincrono e tem varios chamadores (CLI, MCP, ship, fix, retry, ci, noctum). Para rodar as lanes de teste
 * e a varredura ao mesmo tempo, o verify chama este modulo com `spawnSync` como processo auxiliar: ele lanca cada
 * comando ao mesmo tempo, cada um com o mesmo `timeout(1)` do `executar` (o estouro leva o grupo de processos inteiro),
 * grava a saida de cada um num arquivo e espera todos. O pai le os arquivos e monta cada resultado pela mesma funcao do
 * `executar`. O ambiente vem do pai, ja sem `ORK_HITL_*`; cada item so acrescenta variaveis sem segredo (o modo, o
 * relatorio do CHECK, o prazo interno do scan). O item que nomeia outros em `apos` so comeca quando eles terminam (a lane
 * de integracao depois da varredura), e `maxParalelo` limita quantos rodam ao mesmo tempo.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TIMEOUT_BIN = '/usr/bin/timeout';
const NICE_BIN = '/usr/bin/nice';

/** Um comando do grupo. */
export interface ItemParalelo {
  nome: string;
  comando: string;
  cwd: string;
  prazoMs: number;
  /** Variaveis acrescentadas ao ambiente do pai (nunca segredo: vao ao arquivo da especificacao). */
  ambiente?: Record<string, string>;
  /** Prioridade menor para este comando (`nice`), quando a maquina tem o binario. */
  nice?: number;
  /** Os itens (pelo nome, antes deste na lista) que precisam terminar antes de este comecar, com ou sem sucesso. */
  apos?: string[];
  /**
   * RM-074 (F4): o programa e os argumentos, lancados sem shell; com eles, `comando` so identifica o item. Sem eles, o
   * `comando` roda por `bash -c`, como as lanes e a varredura do manifesto.
   */
  argv?: string[];
}

/** O que o processo devolveu, na forma do `exec` de `util.ts`. */
export interface ProcessoDoGrupo {
  nome: string;
  ok: boolean;
  code: number;
  signal: string | null;
  error?: string;
  stdout: string;
  stderr: string;
  duracaoMs: number;
  comGrupo: boolean;
  /** O auxiliar morreu antes de gravar o resultado: o comando nao tem veredito (pode ter rodado pela metade). */
  semResultado?: boolean;
}

interface Especificacao { itens: ItemParalelo[]; dir: string; maxParalelo?: number }
interface Terminado { nome: string; code: number | null; signal: string | null; error?: string; duracaoMs: number; comGrupo: boolean }

/** O argv de um item: `nice` (se pedido e existir), `timeout(1)` (se existir) e o `argv` do item ou `bash -c`. */
export function argvDoItem(item: ItemParalelo, comGrupo = fs.existsSync(TIMEOUT_BIN), comNice = fs.existsSync(NICE_BIN)): string[] {
  const programa = item.argv?.length ? item.argv : ['bash', '-c', item.comando];
  const base = comGrupo ? [TIMEOUT_BIN, '--kill-after=15', `${Math.ceil(item.prazoMs / 1000)}`, ...programa] : programa;
  return item.nice && comNice ? [NICE_BIN, '-n', String(item.nice), ...base] : base;
}

/** As vagas do grupo: no maximo `max` comandos ao mesmo tempo, na ordem em que pediram. */
function vagas(max: number): { tomar: () => Promise<void>; soltar: () => void } {
  let livres = max;
  const fila: Array<() => void> = [];
  return {
    tomar: () => new Promise<void>((pronto) => { if (livres > 0) { livres--; pronto(); } else fila.push(pronto); }),
    soltar: () => { const proximo = fila.shift(); if (proximo) proximo(); else livres++; },
  };
}

/**
 * O lado do auxiliar: lanca cada item quando os de `apos` terminam e ha vaga, espera todos e grava `resultado.json` ao
 * lado das saidas.
 */
async function rodarEspecificacao(esp: Especificacao): Promise<void> {
  const comGrupo = fs.existsSync(TIMEOUT_BIN);
  const limite = vagas(esp.maxParalelo && esp.maxParalelo > 0 ? esp.maxParalelo : esp.itens.length);
  const porNome = new Map<string, Promise<Terminado>>();
  const terminados = await Promise.all(esp.itens.map((item, i) => {
    const vez = (async () => {
      for (const nome of item.apos ?? []) await porNome.get(nome);
      await limite.tomar();
      try { return await lancar(item, i); } finally { limite.soltar(); }
    })();
    porNome.set(item.nome, vez);
    return vez;
  }));
  fs.writeFileSync(path.join(esp.dir, 'resultado.json'), JSON.stringify(terminados), { mode: 0o600 });

  function lancar(item: ItemParalelo, i: number): Promise<Terminado> {
    return new Promise<Terminado>((resolve) => {
      const saida = fs.openSync(path.join(esp.dir, `${i}.out`), 'w', 0o600);
      const erro = fs.openSync(path.join(esp.dir, `${i}.err`), 'w', 0o600);
      const inicio = Date.now();
      const [bin, ...args] = argvDoItem(item, comGrupo);
      let fim: Terminado | null = null;
      const encerrar = (t: Terminado) => {
        if (fim) return;
        fim = t;
        fs.closeSync(saida);
        fs.closeSync(erro);
        resolve(t);
      };
      // Sem o `timeout(1)`, o proprio auxiliar mata pelo prazo, como o `spawnSync` do `exec` faria.
      const filho = spawn(bin, args, { cwd: item.cwd, env: { ...process.env, ...item.ambiente }, stdio: ['ignore', saida, erro],
        ...(comGrupo ? {} : { timeout: item.prazoMs, killSignal: 'SIGTERM' as const }) });
      filho.on('error', (e: NodeJS.ErrnoException) => encerrar({ nome: item.nome, code: null, signal: null,
        error: e.code ?? e.message, duracaoMs: Date.now() - inicio, comGrupo }));
      filho.on('close', (code, signal) => encerrar({ nome: item.nome, code, signal,
        ...(!comGrupo && signal && Date.now() - inicio >= item.prazoMs ? { error: 'ETIMEDOUT' } : {}),
        duracaoMs: Date.now() - inicio, comGrupo }));
    });
  }
}

/**
 * A espera do grupo inteiro: o maior prazo, ou a soma deles quando ha fila (item com `apos` ou vagas a menos que itens),
 * que e o teto do pior caso.
 */
export function esperaDoGrupo(itens: ItemParalelo[], maxParalelo?: number): number {
  const comFila = itens.some((i) => i.apos?.length) || (!!maxParalelo && maxParalelo < itens.length);
  return comFila ? itens.reduce((t, i) => t + i.prazoMs, 0) : Math.max(...itens.map((i) => i.prazoMs));
}

/**
 * O lado do pai: roda o grupo pelo auxiliar e devolve cada processo, na ordem dos itens. A espera e a do grupo
 * (`esperaDoGrupo`), com folga para o `--kill-after` e para o auxiliar gravar; o diretorio das saidas some no fim.
 */
export function rodarEmParalelo(itens: ItemParalelo[], ambiente: NodeJS.ProcessEnv = process.env,
  opcoes: { maxParalelo?: number } = {}): ProcessoDoGrupo[] {
  if (itens.length === 0) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-check-paralelo-'));
  try {
    const especificacao = path.join(dir, 'especificacao.json');
    const esp: Especificacao = { itens, dir, ...(opcoes.maxParalelo ? { maxParalelo: opcoes.maxParalelo } : {}) };
    fs.writeFileSync(especificacao, JSON.stringify(esp), { mode: 0o600 });
    const prazo = esperaDoGrupo(itens, opcoes.maxParalelo) + 60_000;
    const r = spawnSync(process.execPath, [__filename, especificacao], { env: ambiente, encoding: 'utf8', timeout: prazo,
      killSignal: 'SIGKILL' });
    let terminados: Terminado[] = [];
    try { terminados = JSON.parse(fs.readFileSync(path.join(dir, 'resultado.json'), 'utf8')) as Terminado[]; } catch { /* abaixo */ }
    return itens.map((item, i) => {
      const t = terminados[i];
      const ler = (sufixo: string) => { try { return fs.readFileSync(path.join(dir, `${i}.${sufixo}`), 'utf8'); } catch { return ''; } };
      if (!t) {
        // O auxiliar morreu antes de gravar: o comando nao tem veredito, e a causa vai junto.
        const motivo = r.error ? (r.error as NodeJS.ErrnoException).code ?? r.error.message : `auxiliar saiu ${r.status ?? r.signal}`;
        return { nome: item.nome, ok: false, code: -1, signal: r.signal ?? null, error: motivo, stdout: ler('out'),
          stderr: `${ler('err')}${r.stderr ?? ''}`, duracaoMs: 0, comGrupo: fs.existsSync(TIMEOUT_BIN), semResultado: true };
      }
      return { nome: item.nome, ok: t.code === 0, code: t.code ?? -1, signal: t.signal, ...(t.error ? { error: t.error } : {}),
        stdout: ler('out'), stderr: ler('err'), duracaoMs: t.duracaoMs, comGrupo: t.comGrupo };
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const esp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as Especificacao;
  rodarEspecificacao(esp).then(() => process.exit(0), (e: Error) => { process.stderr.write(`check-paralelo: ${e.message}\n`); process.exit(1); });
}

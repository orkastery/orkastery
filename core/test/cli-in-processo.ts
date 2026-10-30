/**
 * RM-074 M1: harness da CLI para testes que exercitam o comando, nao o processo.
 *
 * A chamada recebe o mesmo cwd, ambiente, argv e stdin do processo filho, captura os dois
 * descritores e restaura todo estado global em `finally`. Testes de sinal, PATH do proprio
 * processo ou ciclo de vida continuam usando processo filho.
 */

import fs = require('node:fs');
import { main } from '../src/index';
import { ErroDeConducao } from '../src/conducao';
import { ErroDaFilaPesada } from '../src/fila-pesada';
import { ErroDeProjeto, fixarProjetoAlvo, projetoAlvoAtual, SAIDA_DE_PROJETO } from '../src/projeto-alvo';
import { mensagemDoErro, msg } from '../src/locale';

export interface SaidaDaCli {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ChamadaDaCli {
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: string[];
  entrada?: string;
}

class SaidaPorProcessExit extends Error {
  constructor(readonly status: number) { super(`process.exit(${status})`); }
}

type Escrita = typeof process.stdout.write;
type Leitura = typeof fs.readFileSync;
type LeituraParcial = typeof fs.readSync;

function bytes(valor: string | Uint8Array): string {
  return typeof valor === 'string' ? valor : Buffer.from(valor).toString('utf8');
}

function trocarAmbiente(novo: NodeJS.ProcessEnv): void {
  for (const nome of Object.keys(process.env)) delete process.env[nome];
  for (const [nome, valor] of Object.entries(novo)) if (valor !== undefined) process.env[nome] = valor;
}

/**
 * Comandos cuja conclusao depende do ciclo de vida do processo nao entram no harness sincrono.
 * `mcp install` termina numa continuacao de `import()`: `main()` volta antes dela e o processo
 * filho mantem cwd, ambiente e descritores ate a continuacao acabar.
 */
export function cliExigeProcessoFilho(args: readonly string[]): boolean {
  return args[0] === 'mcp' && args[1] === 'install';
}

/** A mesma moldura de erro da entrada executavel de `index.ts`. */
function tratarErro(e: unknown, args: readonly string[]): number {
  if (e instanceof ErroDeConducao) {
    console.log(args.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.recusa.texto);
    return 3;
  }
  if (e instanceof ErroDaFilaPesada) {
    console.log(args.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.recusa.texto);
    return 3;
  }
  if (e instanceof ErroDeProjeto) {
    console.log(args.includes('--json') ? JSON.stringify(e.recusa, null, 2) : e.texto);
    return SAIDA_DE_PROJETO;
  }
  console.error(msg().cli.erro(mensagemDoErro(e)));
  return 1;
}

/**
 * Executa uma chamada sincrona da CLI no processo do arquivo de teste.
 *
 * O harness e deliberadamente serial dentro de cada arquivo: cwd, env e os descritores sao
 * globais do processo. O runner do Node isola arquivos de teste em processos distintos.
 */
export function cliNoProcesso(chamada: ChamadaDaCli): SaidaDaCli {
  if (cliExigeProcessoFilho(chamada.args)) {
    throw new Error('cli.in-processo.assincrona: mcp install exige processo filho');
  }
  const cwdAnterior = process.cwd();
  const envAnterior = { ...process.env };
  const argvAnterior = [...process.argv];
  const exitCodeAnterior = process.exitCode;
  const exitAnterior = process.exit;
  const stdoutAnterior = process.stdout.write;
  const stderrAnterior = process.stderr.write;
  const readFileAnterior: Leitura = fs.readFileSync;
  const readAnterior: LeituraParcial = fs.readSync;
  const projetoAnterior = projetoAlvoAtual();
  let stdout = '';
  let stderr = '';

  const capturar = (destino: 'stdout' | 'stderr'): Escrita => ((valor: string | Uint8Array, ...resto: unknown[]) => {
    if (destino === 'stdout') stdout += bytes(valor);
    else stderr += bytes(valor);
    const callback = resto.find((x): x is () => void => typeof x === 'function');
    callback?.();
    return true;
  }) as Escrita;

  try {
    process.chdir(chamada.cwd);
    trocarAmbiente(chamada.env);
    process.argv.splice(0, process.argv.length, process.execPath, 'core/dist/index.js', ...chamada.args);
    process.exitCode = undefined;
    process.stdout.write = capturar('stdout');
    process.stderr.write = capturar('stderr');
    process.exit = ((codigo?: string | number | null): never => {
      const n = codigo === undefined || codigo === null ? 0 : Number(codigo);
      throw new SaidaPorProcessExit(Number.isFinite(n) ? n : 1);
    }) as typeof process.exit;
    if (chamada.entrada !== undefined) {
      const original = readFileAnterior;
      const entrada = Buffer.from(chamada.entrada);
      let lidos = 0;
      (fs as unknown as { readFileSync: Leitura }).readFileSync = ((alvo: unknown, opcoes?: unknown) => {
        if (alvo !== 0) return original(alvo as never, opcoes as never);
        const codificacao = typeof opcoes === 'string' ? opcoes
          : opcoes && typeof opcoes === 'object' && 'encoding' in opcoes
            ? (opcoes as { encoding?: BufferEncoding | null }).encoding : null;
        return codificacao ? chamada.entrada! : Buffer.from(chamada.entrada!);
      }) as Leitura;
      (fs as unknown as { readSync: LeituraParcial }).readSync = ((fd: number, buffer: NodeJS.ArrayBufferView,
        offset: number, length: number, position: number | null) => {
        if (fd !== 0) return readAnterior(fd, buffer, offset, length, position);
        const destino = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const n = Math.min(length, entrada.length - lidos);
        if (n <= 0) return 0;
        entrada.copy(destino, offset, lidos, lidos + n);
        lidos += n;
        return n;
      }) as LeituraParcial;
    }

    let status: number;
    try {
      status = main(chamada.args);
    } catch (e) {
      status = e instanceof SaidaPorProcessExit ? e.status : tratarErro(e, chamada.args);
    }
    if (typeof process.exitCode === 'number' && process.exitCode !== 0) status = process.exitCode;
    return { status, stdout, stderr };
  } finally {
    (fs as unknown as { readFileSync: Leitura }).readFileSync = readFileAnterior;
    (fs as unknown as { readSync: LeituraParcial }).readSync = readAnterior;
    process.stdout.write = stdoutAnterior;
    process.stderr.write = stderrAnterior;
    process.exit = exitAnterior;
    process.exitCode = exitCodeAnterior;
    process.argv.splice(0, process.argv.length, ...argvAnterior);
    fixarProjetoAlvo(projetoAnterior);
    trocarAmbiente(envAnterior);
    process.chdir(cwdAnterior);
  }
}

/** Forma de `spawnSync` usada pelos helpers antigos. */
export function saidaCompativel(saida: SaidaDaCli): { status: number; stdout: string; stderr: string } {
  return { status: saida.status, stdout: saida.stdout, stderr: saida.stderr };
}

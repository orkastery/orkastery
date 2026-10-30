/**
 * RM-061, fatia F3d: o apoio dos casos do snapshot pt-BR (`locale-f3d-casos.ts`). Pastas temporarias, o ambiente do
 * CLI (HOME proprio, PATH controlado e um `claude` falso, como na F3b) e a normalizacao: as pastas deste lote viram
 * marcadores, e o resto (datas, sha, uuid, duracoes, versao) passa pelo mesmo normalizador da F3b, sem copia.
 */

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizar as normalizarDaF3b } from './locale-f3b-casos';
import { exec, noPath } from '../src/util';
import { cliExigeProcessoFilho, cliNoProcesso, saidaCompativel } from './cli-in-processo';

export const CLI = path.resolve(__dirname, '../../dist/index.js');
export const SP = 'America/Sao_Paulo';
/** Instantes fixos fora do ano corrente: a data mostra o ano em qualquer ano de execucao. */
export const T0 = '2025-09-19T18:16:00.000Z';
export const T1 = '2025-09-19T18:21:30.000Z';
export const T2 = '2025-09-19T19:40:00.000Z';
export const SHA_A = 'a1b2c3d4'.repeat(5);
export const SHA_64 = 'a1b2c3d4'.repeat(8);

export type Casos = Record<string, string>;

/** Pastas temporarias deste lote de casos, trocadas por marcadores na normalizacao. */
const marcadores: Array<[string, string]> = [];

export function dirTemp(nome: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-f3d-${nome}-`)));
  marcadores.push([dir, marcador]);
  return dir;
}

/**
 * Pasta de comprimento fixo em `/tmp` (e nao no TMPDIR, como na F3b): para o caminho que entra numa tabela, cuja
 * largura de coluna depende dele e mudaria com o TMPDIR de quem roda.
 */
export function dirFixo(prefixo: string, marcador: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(`/tmp/${prefixo}-`));
  marcadores.push([dir, marcador]);
  return dir;
}

/** As pastas deste lote viram marcadores; datas, sha, uuid, duracoes e versao, pelo normalizador da F3b. */
export function normalizar(texto: string): string {
  let t = texto;
  for (const [dir, marcador] of [...marcadores].sort((a, b) => b[0].length - a[0].length)) t = t.split(dir).join(marcador);
  // Antes da F3b: pid de 7 ou 8 digitos (a maquina passa de 1.000.000) parece sha curto para ela, e o sha curto so de
  // letras depois de `HEAD` ela nao reconhece.
  t = t.replace(/\bpid \d+\b/g, 'pid <PID>').replace(/\b(HEAD )[0-9a-f]{7,8}\b/g, '$1<SHA7>');
  return normalizarDaF3b(t);
}

export function limparTudo(): void {
  const pausa = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(pausa, 0, 0, 200);
  for (const [dir] of marcadores) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  marcadores.length = 0;
}

/** Roda `fn` e guarda o texto (ou `ERRO: mensagem`) normalizado. */
export function caso(casos: Casos, nome: string, fn: () => string | null | undefined): void {
  if (nome in casos) throw new Error(`caso repetido: ${nome}`);
  let saida: string;
  try {
    const r = fn();
    saida = r === null ? '<null>' : r === undefined ? '<undefined>' : r;
  } catch (e) { saida = `ERRO: ${(e as Error).message}`; }
  casos[nome] = normalizar(saida);
}

/** O texto de um erro lancado por `fn`, ou `(sem erro)`. */
export function erro(fn: () => unknown): string {
  try { fn(); return '(sem erro)'; } catch (e) { return (e as Error).message; }
}

/** Repositorio git com um commit; `fixo` o poe em `/tmp` com caminho de comprimento fixo (veja `dirFixo`). */
export function repoComCommit(nome: string, marcador: string, fixo = false): string {
  const dir = fixo ? dirFixo(`ork-f3d-${nome}`, marcador) : dirTemp(nome, marcador);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# locale f3d\n');
  exec('git', ['add', '--', 'README.md'], dir);
  exec('git', ['commit', '-q', '-m', 'inicial'], dir);
  return dir;
}

export interface Ambiente { casa: string; bin: string; stub: string }

/** O `claude` falso das contas: `auth status --json` responde login de assinatura; o resto, lista vazia. */
const CLAUDE_FALSO = `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}'
  exit 0
fi
if [ "$1" = "--version" ]; then echo "stub de teste 0.0.1"; exit 0; fi
echo '[]'
exit 0
`;

/**
 * HOME, um bin so com o git, o bash e o que os scripts usam, e um `claude` falso: nenhum `claude`, `codex`, `gh`
 * ou `glab` de quem roda entra no PATH, em maquina nenhuma. `fixo` poe as pastas em `/tmp` (veja `dirFixo`): o
 * registro de projetos so aceita projeto de pasta temporaria quando o HOME tambem e temporario.
 */
export function ambiente(nome: string, fixo = false): Ambiente {
  const pasta = (sufixo: string, marcador: string) => fixo ? dirFixo(`ork-f3d-${nome}-${sufixo}`, marcador) : dirTemp(`${nome}-${sufixo}`, marcador);
  const casa = pasta('casa', '<CASA>');
  const bin = pasta('bin', '<BIN>');
  const stub = pasta('stub', '<STUB>');
  for (const ferramenta of ['git', 'cat', 'cut', 'date', 'rm', 'bash', 'sh', 'test', 'true', 'false']) {
    const achado = noPath(ferramenta);
    if (!achado) throw new Error(`${ferramenta} fora do PATH de quem roda os testes`);
    fs.symlinkSync(path.resolve(achado), path.join(bin, ferramenta));
  }
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.writeFileSync(path.join(stub, 'claude'), CLAUDE_FALSO, { mode: 0o755 });
  return { casa, bin, stub };
}

export interface Saida { status: number | null; stdout: string; stderr: string }

/** A CLI com ambiente montado do zero: HOME, PATH, LANG neutro (o padrao, pt-BR) e o fuso. */
export function ork(dir: string, amb: Ambiente, ...args: string[]): Saida {
  return orkComEnv(dir, amb, {}, ...args);
}

export function orkComEnv(dir: string, amb: Ambiente, extra: Record<string, string>, ...args: string[]): Saida {
  return orkComEntrada(dir, amb, undefined, extra, ...args);
}

/** Como `orkComEnv`, com `entrada` no stdin (os comandos que leem envelope ou payload por `--stdin`). */
export function orkComEntrada(dir: string, amb: Ambiente, entrada: string | undefined, extra: Record<string, string>, ...args: string[]): Saida {
  const env = { HOME: amb.casa, LANG: 'C.UTF-8', TZ: SP, PATH: `${amb.stub}:${amb.bin}`, ORK_USUARIO_DIR: path.join(amb.casa, '.orkastery'),
    ORK_MAQUINA: 'pc-loc', ORK_REDE_PUBLICAR: '0', ORK_FABRICA_PUBLICAR: '0', ORK_BINARIOS_EXTRA: '', ...extra };
  // PATH explicito e accounts exercitam runtimes externos; `mcp install` conclui depois do retorno
  // sincrono de `main`. A fronteira de processo faz parte do contrato desses casos.
  if (extra.PATH !== undefined || args[0] === 'accounts' || cliExigeProcessoFilho(args)) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8',
      ...(entrada === undefined ? {} : { input: entrada }) });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  return saidaCompativel(cliNoProcesso({ cwd: dir, args, ...(entrada === undefined ? {} : { entrada }), env }));
}

export function texto(s: Saida): string {
  return `[saida ${s.status}]\n${s.stdout}${s.stderr ? `[stderr]\n${s.stderr}` : ''}`;
}

/** Os campos de texto que o comando gravou no ledger da thread, na ordem dos eventos. */
export function textosDoLedger(repo: string, thread: string, tipos: readonly string[]): string {
  const ledger = path.join(repo, '.orkastery', 'threads', thread, 'ledger.jsonl');
  if (!fs.existsSync(ledger)) return '<sem ledger>';
  const campos = ['detalhe', 'correcao', 'motivo', 'razao', 'decidido', 'porque', 'resumo', 'texto'];
  return fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => tipos.includes(String(e.tipo)))
    .map((e) => `${String(e.tipo)}: ${campos.filter((c) => typeof e[c] === 'string').map((c) => `${c}=${String(e[c])}`).join(' | ')}`)
    .join('\n');
}

/** Projeto com manifesto, verify `build` e `test` de verdade (bash) e o fuso do dono fixo. */
export function projeto(nome: string, abbrev: string, amb: Ambiente): string {
  const repo = repoComCommit(nome, '<REPO>');
  const init = ork(repo, amb, 'init', '--name', nome, '--abbrev', abbrev);
  if (init.status !== 0) throw new Error(`init falhou: ${init.stderr}`);
  const yaml = path.join(repo, 'orkastery.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8')
    .replace('  # build: nao detectado', '  build: "true"')
    .replace('  # test: nao detectado', '  test: "test -f README.md"'));
  exec('git', ['add', '--', 'orkastery.yaml', 'AGENTS.md'], repo);
  exec('git', ['commit', '-q', '-m', 'manifesto'], repo);
  return repo;
}

export function idDaThread(s: Saida): string {
  const m = /^ {2}id {8}(\S+)$/m.exec(s.stdout) ?? /\bid\s+(\S+-\S+)/.exec(s.stdout);
  if (!m) throw new Error(`thread sem id na saida: ${s.stdout}\n${s.stderr}`);
  return m[1];
}

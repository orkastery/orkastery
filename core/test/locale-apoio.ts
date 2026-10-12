/**
 * RM-061, fatia F2a: apoio dos testes em ingles. A CLI roda com ambiente montado do zero (HOME
 * proprio, PATH so com o git e o que o stub do `claude` usa, o locale pedido e o fuso), nunca com o
 * `LANG`, o `claude` ou o `codex` de quem roda os testes.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec, noPath } from '../src/util';

export const CLI = path.resolve(__dirname, '../../dist/index.js');
export const EN = { LANG: 'en_US.UTF-8' } as const;
export const PT = { LANG: 'pt_BR.UTF-8' } as const;

export interface Saida { status: number | null; stdout: string; stderr: string }

export interface Cenario {
  dir: string;
  casa: string;
  bin: string;
  stub: string;
  limpar: () => void;
}

/** Repositorio git com um commit, HOME, bin e o stub do `claude` do `apoio.ts`. */
export function cenario(nome: string, comInit = true): Cenario {
  const temp = (sufixo: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-locale-${nome}-${sufixo}-`)));
  const dir = temp('repo'), casa = temp('casa'), bin = temp('bin'), stub = temp('stub');
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# locale\n');
  exec('git', ['add', '--', 'README.md'], dir);
  exec('git', ['commit', '-q', '-m', 'inicial'], dir);
  for (const ferramenta of ['git', 'cat', 'cut', 'date', 'rm']) {
    const achado = noPath(ferramenta);
    if (!achado) throw new Error(`${ferramenta} fora do PATH de quem roda os testes`);
    fs.symlinkSync(path.resolve(achado), path.join(bin, ferramenta));
  }
  const apoio = fs.readFileSync(path.resolve(__dirname, '../../test/apoio.ts'), 'utf8');
  const m = /const SCRIPT_DO_RUNTIME = `([\s\S]*?)`;/.exec(apoio);
  if (!m) throw new Error('script do runtime falso nao achado em apoio.ts');
  fs.writeFileSync(path.join(stub, 'claude'), m[1].replace(/\\\\/g, '\\'), { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'pid'), String(process.pid));
  const c: Cenario = {
    dir, casa, bin, stub,
    limpar: () => {
      encerrarWatchers(dir);
      for (const d of [dir, casa, bin, stub]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  if (comInit) {
    const r = ork(c, PT, false, 'init', '--name', 'loc', '--abbrev', 'loc');
    if (r.status !== 0) throw new Error(`init falhou: ${r.stderr}`);
  }
  return c;
}

/** A CLI no cenario, com o locale pedido; `comRuntime` poe o stub do `claude` no PATH. */
export function ork(c: Cenario, locale: Record<string, string>, comRuntime: boolean, ...args: string[]): Saida {
  return orkEm(c, c.dir, locale, comRuntime, ...args);
}

export function orkEm(c: Cenario, dir: string, locale: Record<string, string>, comRuntime: boolean, ...args: string[]): Saida {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: {
      HOME: c.casa, TZ: 'America/New_York', ...locale,
      PATH: comRuntime ? `${c.stub}:${c.bin}` : c.bin,
      ...(comRuntime ? { ORK_STUB_DIR: c.stub } : {}),
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Encerra os watchers que um despacho real abriu (identidade gravada no ledger). */
export function encerrarWatchers(repo: string): void {
  const threads = path.join(repo, '.orkastery', 'threads');
  if (!fs.existsSync(threads)) return;
  for (const id of fs.readdirSync(threads)) {
    const ledger = path.join(threads, id, 'ledger.jsonl');
    if (!fs.existsSync(ledger)) continue;
    for (const linha of fs.readFileSync(ledger, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      const e = JSON.parse(linha) as { tipo?: string; identidade?: { pid?: number } };
      if (e.tipo === 'session_watcher_started' && e.identidade?.pid) {
        try { process.kill(e.identidade.pid, 'SIGTERM'); } catch { /* ja saiu */ }
      }
    }
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
}

/**
 * Palavras que denunciam pt-BR num texto que deveria estar em ingles. O que esta entre crases
 * (comando, flag, identificador) e o que o teste declara como dado saem antes da busca.
 */
const PALAVRAS_PT = [
  'não', 'nao', 'você', 'voce', 'está', 'também', 'tambem', 'já', 'até', 'ate', 'pelo', 'pela', 'para', 'com', 'sem', 'uma',
  'de', 'da', 'dos', 'das', 'em', 'ou', 'que', 'por', 'mas', 'nada', 'nenhum', 'nenhuma', 'ainda', 'aqui', 'agora', 'quando',
  'onde', 'qual', 'seu', 'sua', 'sessao', 'sessão', 'sessoes', 'sessões', 'correcao', 'correção', 'despacho', 'despachada',
  'ausente', 'pendente', 'respondida', 'etapa', 'etapas', 'veredito', 'maquina', 'máquina', 'repositorio', 'repositório',
  'criada', 'criado', 'gravado', 'gravada', 'simulacao', 'simulação', 'proximo', 'próximo', 'passo', 'acompanhe', 'pausa',
  'pausas', 'previstas', 'prevista', 'humana', 'humanas', 'blocos', 'bloco', 'modo', 'ciclo', 'padrao', 'padrão', 'conducao',
  'condução', 'conduzido', 'ninguem', 'ninguém', 'verificada', 'aberta', 'fechada', 'horário', 'horários', 'janela', 'fila',
  'vazia', 'perfil', 'perfis', 'ambiente', 'politica', 'política', 'variavel', 'variável', 'busca', 'significado', 'desligada',
  'entrevista', 'escolheu', 'informou', 'declara', 'revise', 'altera', 'fase', 'fases', 'despachar', 'rode', 'instale',
  'garanta', 'binario', 'binário', 'fora', 'dentro', 'deste', 'desta', 'nesta', 'neste', 'esse', 'essa', 'isso', 'ela', 'ele',
];
// Palavra colada a ponto (dominio, extensao de arquivo: `github.com`, `rede.log`) nao conta.
const RE_PT = new RegExp(`(^|[^\\p{L}.])(${PALAVRAS_PT.join('|')})(?=[^\\p{L}.]|$)`, 'iu');

/** As linhas do texto que ainda trazem palavra pt-BR fora de crases e fora dos trechos de dado. */
export function linhasEmPortugues(texto: string, dados: readonly string[] = []): string[] {
  return texto.split('\n').filter((linha) => {
    let l = linha.replace(/`[^`]*`/g, ' ');
    for (const d of dados) l = l.split(d).join(' ');
    return RE_PT.test(l);
  });
}

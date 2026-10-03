/**
 * RM-037: a suíte local passa em qualquer máquina, inclusive a de quem contribui.
 *
 * Um teste que depende de ferramenta externa opcional sonda a dependência e, se ela falta, sai como
 * skip tipado com o motivo (`skip: PostgreSQL ausente ...`), em vez de reprovar por ambiente. Com
 * `ORK_TESTE_EXIGE_AMBIENTE=1` nada é pulado: o teste roda e reprova pela falta real. É o modo de
 * quem quer a prova completa numa máquina que deveria ter tudo, e o `test:ci` liga a variável na
 * suíte hermética, para que um skip tipado nunca passe despercebido no CI.
 *
 * A sonda repete exatamente o que o teste vai usar: o binário `/usr/bin/codex` do executor sandbox
 * (`src/verify-sandbox.ts`), o `orkmind` do PATH de `pythonFixture()` e a imagem do Docker que
 * `prepareFixture()` sobe. Cada sonda roda uma vez por processo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export type DependenciaDeTeste = 'codex-sandbox' | 'orkmind' | 'postgres';

export const VARIAVEL_EXIGE_AMBIENTE = 'ORK_TESTE_EXIGE_AMBIENTE';

export const MOTIVO_DA_FALTA: Readonly<Record<DependenciaDeTeste, string>> = {
  'codex-sandbox': 'codex do sandbox ausente em /usr/bin/codex',
  orkmind: 'interpretador do OrkMind ausente (orkmind fora do PATH)',
  postgres: 'PostgreSQL ausente (Docker com a imagem pgvector/pgvector:pg16)',
};

export type Sonda = (dependencia: DependenciaDeTeste) => boolean;

function codexDoSandbox(): boolean {
  if (process.platform !== 'linux') return false;
  try { return fs.statSync(fs.realpathSync('/usr/bin/codex')).isFile(); } catch { return false; }
}

function interpretadorOrkMind(): boolean {
  const cli = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    .map(p => path.join(p, 'orkmind')).find(p => fs.existsSync(p));
  if (!cli) return false;
  try { return /^#!(\S+)/.test(fs.readFileSync(cli, 'utf8')); } catch { return false; }
}

function postgresDaFixture(): boolean {
  const r = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', 'pgvector/pgvector:pg16'],
    { encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  return r.status === 0 && /^sha256:[a-f0-9]{64}$/.test(r.stdout.trim());
}

const cache = new Map<DependenciaDeTeste, boolean>();
export const sondaReal: Sonda = (dependencia) => {
  if (!cache.has(dependencia)) {
    const presente = dependencia === 'codex-sandbox' ? codexDoSandbox()
      : dependencia === 'orkmind' ? interpretadorOrkMind() : postgresDaFixture();
    cache.set(dependencia, presente);
  }
  return cache.get(dependencia)!;
};

/**
 * Valor para a opção `skip` do `node:test`: `false` quando tudo está presente (ou quando o ambiente é
 * exigido), senão o motivo tipado com cada dependência que falta.
 */
export function semAmbiente(dependencias: readonly DependenciaDeTeste[],
  opcoes: { sonda?: Sonda; env?: NodeJS.ProcessEnv } = {}): string | false {
  const env = opcoes.env ?? process.env;
  if (env[VARIAVEL_EXIGE_AMBIENTE] === '1') return false;
  const sonda = opcoes.sonda ?? sondaReal;
  const faltam = [...new Set(dependencias)].filter(d => !sonda(d));
  return faltam.length ? 'skip: ' + faltam.map(d => MOTIVO_DA_FALTA[d]).join('; ') : false;
}

/** Atalhos dos três ambientes da suíte local. */
export const semCodexSandbox = () => semAmbiente(['codex-sandbox']);
export const semOrkMind = () => semAmbiente(['orkmind']);
/** A fixture do PostgreSQL sobe no Docker e se conecta pelo interpretador do OrkMind (psycopg). */
export const semPostgres = () => semAmbiente(['postgres', 'orkmind']);

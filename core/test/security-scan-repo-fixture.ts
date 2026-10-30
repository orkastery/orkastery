/** RM-074 M3: uma fixture Git versionada por arquivo de teste, copiada para cada caso isolado. */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from './apoio';

const FIXTURE_JS = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan', 'js');
const CLEAN_JS = {
  'package.json': '{ "name": "clean-js", "version": "1.0.0", "private": true, "license": "MIT" }\n',
  'package-lock.json': '{ "name": "clean-js", "version": "1.0.0", "lockfileVersion": 3, "requires": true, ' +
    '"packages": { "": { "name": "clean-js", "version": "1.0.0" } } }\n',
};

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

interface Modelo { dir: string; base: string; head: string }
export interface RepoSecurityScan { dir: string; base: string; head: string; cleanup: () => void }
export interface OpcoesRepoSecurityScan { origin?: boolean; mainBranch?: string }

let modelo: Modelo | null = null;
let modelosCriados = 0;

/** Criado uma vez no processo; o node:test isola cada arquivo em seu processo. */
function modeloBase(): Modelo {
  if (modelo) return modelo;
  const dir = dirTemporario('security-scan-repo-modelo');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [arquivo, corpo] of Object.entries(CLEAN_JS)) fs.writeFileSync(path.join(dir, arquivo), corpo);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feat');
  fs.cpSync(FIXTURE_JS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.fake-case'), 'js\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  modelo = { dir, base, head: git(dir, 'rev-parse', 'HEAD') };
  modelosCriados++;
  process.once('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return modelo;
}

export function repositorioSecurityScan(nome: string, opcoes: OpcoesRepoSecurityScan = {}): RepoSecurityScan {
  const base = modeloBase();
  const dir = dirTemporario(nome);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(base.dir, dir, { recursive: true });
  const extras: string[] = [];
  const mainBranch = opcoes.mainBranch ?? 'main';
  if (mainBranch !== 'main') git(dir, 'branch', '-m', 'main', mainBranch);
  if (opcoes.origin) {
    const remoto = dirTemporario(`${nome}-origin`);
    extras.push(remoto);
    git(remoto, 'init', '-q', '--bare', '-b', mainBranch);
    git(dir, 'remote', 'add', 'origin', remoto);
    git(dir, 'push', '-q', 'origin', mainBranch);
  }
  return { dir, base: base.base, head: base.head,
    cleanup: () => { for (const alvo of [dir, ...extras]) fs.rmSync(alvo, { recursive: true, force: true }); } };
}

export const totalDeModelosSecurityScan = (): number => modelosCriados;

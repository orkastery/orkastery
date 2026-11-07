/**
 * RM-061, fatia F2b: apoio dos testes em ingles de `verify`, `ship`, `retry`, `master`, `pulse` e
 * `roadmap status`. Usa o cenario da F2a (HOME proprio, PATH controlado, runtime falso) e acrescenta o que
 * esses comandos pedem: o `bash` dos comandos do verify e um manifesto com `build` e `test` de verdade.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Cenario } from './locale-apoio';
import { noPath } from '../src/util';

/** O manifesto do cenario com `build: true` e `test: test -f passa.txt`, e o `bash` no PATH do cenario. */
export function comVerify(c: Cenario): void {
  const git = noPath('git');
  if (!git) throw new Error('git fora do PATH de quem roda os testes');
  const dataDoCommit = '2000-01-01T00:00:00+00:00';
  const commit = spawnSync(git, ['commit', '--amend', '--no-edit', `--date=${dataDoCommit}`], {
    cwd: c.dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: dataDoCommit },
  });
  if (commit.status !== 0 || commit.error) {
    throw new Error(`nao foi possivel fixar a data do commit do cenario: ${commit.stderr || commit.error?.message || commit.status}`);
  }
  const datas = spawnSync(git, ['log', '-1', '--format=%aI%n%cI'], { cwd: c.dir, encoding: 'utf8' });
  if (datas.status !== 0 || datas.error) {
    throw new Error(`nao foi possivel conferir as datas do commit do cenario: ${datas.stderr || datas.error?.message || datas.status}`);
  }
  const [dataDoAutor, dataDoCommitter] = datas.stdout.trimEnd().split('\n');
  if (dataDoAutor !== dataDoCommit || dataDoCommitter !== dataDoCommit) {
    throw new Error(`datas do commit do cenario nao foram fixadas: autor=${dataDoAutor || '<vazia>'}, ` +
      `committer=${dataDoCommitter || '<vazia>'}, esperada=${dataDoCommit}`);
  }
  const bash = noPath('bash');
  if (!bash) throw new Error('bash fora do PATH de quem roda os testes');
  if (!fs.existsSync(path.join(c.bin, 'bash'))) fs.symlinkSync(path.resolve(bash), path.join(c.bin, 'bash'));
  const yaml = path.join(c.dir, 'orkastery.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8')
    .replace('  # build: nao detectado', '  build: "true"')
    .replace('  # test: nao detectado', '  test: "test -f passa.txt"'));
  fs.writeFileSync(path.join(c.dir, '.git', 'info', 'exclude'), 'passa.txt\n.orkastery/\n');
}

/**
 * Os eventos do ledger da thread com os tipos pedidos, sem o que muda de uma execucao para outra (horario,
 * ids, sha, duracao, steal, pid): o que sobra e o dado gravado, que nao pode mudar com a lingua.
 */
export function dadoDoLedger(c: Cenario, thread: string, tipos: readonly string[]): unknown[] {
  const ledger = path.join(c.dir, '.orkastery', 'threads', thread, 'ledger.jsonl');
  const volateis = new Set(['ts', 'eventId', 'id', 'pedidoId', 'duracaoMs', 'esperouMs', 'stealPct', 'steal', 'pid', 'gravadaEm', 'conducao',
    'identidade', 'despacho', 'expiraEm', 'adquiridoEm', 'liberaEm', 'desde', 'sessionId', 'commit', 'prazoMs']);
  const limpar = (v: unknown): unknown => Array.isArray(v) ? v.map(limpar)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !volateis.has(k)).map(([k, x]) => [k, limpar(x)]))
      : typeof v === 'string' ? v.replace(/\b[0-9a-f]{40}\b/g, '<sha>').replace(/\b[0-9a-f]{8}\b/g, '<sha8>') : v;
  return fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => tipos.includes(String(e.tipo))).map(limpar);
}

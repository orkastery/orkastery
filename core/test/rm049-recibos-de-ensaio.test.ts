/**
 * RM-049 (A5 do backlog autonomo 2): o recibo de ensaio acompanha o merge que corrige o achado.
 *
 * O recibo `docs/roadmap/evidencias/RM-049/ensaio-2026-10-03.json` seguiu dizendo `registrado` para
 * R1, R2 e R4 a R8 depois que o PR #77 (merge `0080d87`) os corrigiu, e quem lia o recibo achava que
 * os 7 achados seguiam abertos. A guarda le todo `ensaio-*.json` de `docs/roadmap/evidencias/`:
 *
 * - achado `corrigido` cita o `commit` que o corrige, e esse commit existe e esta na `main`;
 * - achado `registrado` nao cita commit (ainda nao ha correcao).
 *
 * A parte que consulta o git precisa do historico da `main`: no checkout raso (o job do nucleo no CI
 * usa `fetch-depth: 1`), ela sai como skip com o motivo; o `ork-verify` tem o historico inteiro e a roda.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const EVIDENCIAS = path.join(RAIZ, 'docs', 'roadmap', 'evidencias');

interface Achado { id?: unknown; estado?: unknown; commit?: unknown; pr?: unknown }

function git(args: string[]): { ok: boolean; saida: string } {
  const r = spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
  return { ok: r.status === 0, saida: (r.stdout ?? '').trim() };
}

/** Todo `ensaio-*.json` debaixo de `docs/roadmap/evidencias/`, em ordem. */
function recibosDeEnsaio(dir = EVIDENCIAS): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) =>
    e.isDirectory() ? recibosDeEnsaio(path.join(dir, e.name))
      : /^ensaio-.*\.json$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** A regra, sem git: o que o recibo diz de cada achado tem de bater com o estado dele. */
function problemasDeForma(achados: Achado[]): string[] {
  const problemas: string[] = [];
  for (const a of achados) {
    const id = String(a.id ?? '?');
    if (a.estado === 'corrigido') {
      if (typeof a.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(a.commit)) {
        problemas.push(`${id}: corrigido sem o commit que o corrige`);
      }
    } else if (a.estado === 'registrado' && a.commit !== undefined) {
      problemas.push(`${id}: registrado nao cita commit (ainda nao ha correcao)`);
    }
  }
  return problemas;
}

/** A base com historico: `main`, depois `origin/main`. `null` no checkout raso ou sem a base. */
function baseComHistorico(): string | null {
  if (git(['rev-parse', '--is-shallow-repository']).saida !== 'false') return null;
  for (const ref of ['main', 'origin/main']) if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  return null;
}

function achadosDe(arquivo: string): Achado[] | null {
  const recibo = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { achados?: unknown };
  return Array.isArray(recibo.achados) ? recibo.achados as Achado[] : null;
}

test('a regra: corrigido sem commit e registrado com commit reprovam; o resto passa', () => {
  assert.deepEqual(problemasDeForma([
    { id: 'A', estado: 'corrigido', commit: '0080d87', pr: 77 },
    { id: 'B', estado: 'registrado' },
    { id: 'C', estado: 'corrigido' },
    { id: 'D', estado: 'registrado', commit: '0080d87' },
    { id: 'E', estado: 'corrigido', commit: 'HEAD' },
  ]), [
    'C: corrigido sem o commit que o corrige',
    'D: registrado nao cita commit (ainda nao ha correcao)',
    'E: corrigido sem o commit que o corrige',
  ]);
});

test('todo recibo de ensaio diz o estado real de cada achado', () => {
  const recibos = recibosDeEnsaio();
  assert.ok(recibos.some((r) => r.endsWith(path.join('RM-049', 'ensaio-2026-10-03.json'))), 'o recibo de 03/10 e lido');
  for (const arquivo of recibos) {
    const achados = achadosDe(arquivo);
    if (!achados) continue; // rodada sem achados (o recibo do candidato)
    assert.deepEqual(problemasDeForma(achados), [], path.relative(RAIZ, arquivo));
  }
});

const base = baseComHistorico();
test('o commit de cada achado corrigido existe e esta na main',
  { skip: base ? false : 'checkout raso ou sem a main: a ancestralidade fica para o ork-verify, que tem o historico' }, () => {
    for (const arquivo of recibosDeEnsaio()) {
      for (const a of achadosDe(arquivo) ?? []) {
        if (a.estado !== 'corrigido' || typeof a.commit !== 'string') continue;
        const onde = `${path.relative(RAIZ, arquivo)} ${String(a.id)}`;
        assert.ok(git(['cat-file', '-e', `${a.commit}^{commit}`]).ok, `${onde}: o commit ${a.commit} nao existe`);
        assert.ok(git(['merge-base', '--is-ancestor', a.commit, base as string]).ok, `${onde}: o commit ${a.commit} nao esta na ${base}`);
      }
    }
  });

test('o recibo de 03/10: R3 e o unico registrado, a decisao e do dono; R1, R2 e R4 a R8 citam o PR #77', () => {
  const achados = achadosDe(path.join(EVIDENCIAS, 'RM-049', 'ensaio-2026-10-03.json')) ?? [];
  assert.deepEqual(achados.filter((a) => a.estado === 'registrado').map((a) => a.id), ['R3']);
  for (const id of ['R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'R8']) {
    const a = achados.find((x) => x.id === id);
    assert.equal(a?.estado, 'corrigido', id);
    assert.equal(a?.pr, 77, id);
  }
});

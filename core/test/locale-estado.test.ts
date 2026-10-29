/**
 * RM-061, fatia F3b (item 10): os erros de estado em ingles. O diretorio de estado como link (`dirEstado`, de
 * `manifest.ts`) e as recusas da pasta privada da confirmacao local (`postura-local.ts`) nascem do catalogo, com o
 * motivo tipado do comeco igual nas duas linguas; os de `estado-thread.ts` e `procedencia.ts` tem o teste da worktree.
 * Negativo: num comando fora da lista (`ork noctum tique`), a recusa de estado segue em pt-BR.
 * Os nomes comecam por "locale en F3b estado:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { comLocale, mensagemDoErro } from '../src/locale';
import { gravarArquivoPrivado } from '../src/postura-local';
import { cenario, Cenario, EN, ork, PT } from './locale-apoio';

const LINK_EN = 'error: estado.link: .orkastery is a symbolic link; ork state lives in a real folder inside the root. Remove the link.\n';
const LINK_PT = 'erro: estado.link: .orkastery é link simbólico; o estado do ork fica numa pasta de verdade dentro da raiz. Remova o link.\n';

/** Troca o `.orkastery` do cenario por um link para uma pasta de fora (a pasta e devolvida para a limpeza). */
function estadoComoLink(c: Cenario): string {
  const est = path.join(c.dir, '.orkastery');
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-locale-estado-fora-'));
  if (fs.existsSync(est)) fs.cpSync(est, fora, { recursive: true });
  fs.rmSync(est, { recursive: true, force: true });
  fs.symlinkSync(fora, est);
  return fora;
}

/** O erro que `fn` lanca, como o CLI o imprimiria no locale ativo. */
function erroDe(fn: () => void): string {
  try { fn(); } catch (e) { return mensagemDoErro(e); }
  throw new Error('nenhum erro');
}

test('locale en F3b estado: o diretorio de estado como link sai em ingles nos comandos cobertos', () => {
  const c = cenario('estado-f3b');
  const fora = estadoComoLink(c);
  try {
    for (const args of [['thread', 'list'], ['docs', 'sincronizar'], ['thread', 'new', 'teste']]) {
      const r = ork(c, EN, false, ...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.equal(r.stderr, LINK_EN, args.join(' '));
    }
    assert.equal(ork(c, PT, false, 'thread', 'list').stderr, LINK_PT);
  } finally { c.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('locale en F3b estado: as recusas da pasta privada nascem do catalogo, com o motivo tipado igual', () => {
  const c = cenario('estado-f3b-postura');
  try {
    const est = path.join(c.dir, '.orkastery');
    fs.rmSync(est, { recursive: true, force: true });
    fs.writeFileSync(est, 'nao e pasta\n');
    const gravar = () => gravarArquivoPrivado(c.dir, 'x.json', { a: 1 });
    assert.equal(comLocale('en', () => erroDe(gravar)), 'estado.link: .orkastery must be a real folder');
    assert.equal(erroDe(gravar), 'estado.link: .orkastery precisa ser pasta de verdade');
    fs.rmSync(est);
    fs.mkdirSync(path.join(est, 'private'), { recursive: true });
    fs.writeFileSync(path.join(est, 'private', 'x.json'), '{}\n');
    execFileSync('git', ['add', '-f', '--', '.orkastery/private/x.json'], { cwd: c.dir });
    assert.equal(comLocale('en', () => erroDe(gravar)),
      'estado.rastreado: x.json is versioned in git; take it out of the index (`git rm --cached`) before confirming');
    assert.equal(erroDe(gravar), 'estado.rastreado: x.json está versionado no git; tire-o do índice (git rm --cached) antes de confirmar');
  } finally { c.limpar(); }
});

test('locale en F3b estado (negativo): num comando fora da lista, o erro de estado segue em pt-BR com LANG ingles', () => {
  const c = cenario('estado-f3b-fora');
  try {
    // A F3e levou `master audit` ao catalogo; `noctum tique` segue fora e le o estado do arco.
    const pt = ork(c, PT, false, 'noctum', 'tique', 'arco-inexistente');
    const en = ork(c, EN, false, 'noctum', 'tique', 'arco-inexistente');
    assert.equal(pt.status, 2);
    assert.equal(en.status, 2);
    assert.equal(en.stdout, pt.stdout);
    assert.equal(en.stderr, pt.stderr);
    assert.match(pt.stderr, /^noctum\.modo\.sem-envelope: o arco arco-inexistente nunca foi autorizado pelo dono:/);
  } finally { c.limpar(); }
});

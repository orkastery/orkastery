/**
 * I-33 (D15, GO-FIX 1 do CHECK aa279e17, achado A5): o lock do store de perfis espera e repete sob
 * concorrencia. Criterio da D15: 3 rodadas de 240 escritas concorrentes (12 processos, 20 escritas
 * cada, cada um no proprio perfil), sem nenhum erro e sem perda da ultima escrita de ninguem.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { dirTemporario } from './apoio';
import { adicionarPerfil, lerPerfis, registrarUsoDePerfil } from '../src/runtime-profiles';

const DIST = path.resolve(__dirname, '../../dist/runtime-profiles.js');
const PROCESSOS = 12, ESCRITAS = 20;

const FILHO = `
const rp = require(process.argv[1]);
const [raiz, id, base] = process.argv.slice(2);
let ultima = null; const erros = [];
for (let i = 0; i < ${ESCRITAS}; i++) {
  const em = new Date(Number(base) + i * 1000).toISOString();
  try { rp.registrarUsoDePerfil(raiz, id, em); ultima = em; } catch (e) { erros.push(String(e.message).slice(0, 120)); }
}
process.stdout.write(JSON.stringify({ id, ultima, erros }));
`;

function filho(raiz: string, id: string, base: number): Promise<{ id: string; ultima: string | null; erros: string[] }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', FILHO, DIST, raiz, id, String(base)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    p.stdout.on('data', b => { saida += b; });
    p.stderr.on('data', b => { erro += b; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(JSON.parse(saida)) : reject(new Error(`filho ${id} saiu ${code}: ${erro}`)));
  });
}

test('A5: 3 rodadas de 240 escritas concorrentes no store, sem erro e sem perda de escrita', async () => {
  const raiz = dirTemporario('lock-store');
  try {
    fs.mkdirSync(path.join(raiz, '.orkastery'));
    const ids = Array.from({ length: PROCESSOS }, (_, i) => `p${i}`);
    for (const id of ids) adicionarPerfil(raiz, { id, runtime: 'claude-bg', dir: `/srv/contas/${id}` });
    for (let rodada = 1; rodada <= 3; rodada++) {
      const base = Date.parse('2026-09-19T00:00:00Z') + rodada * 3600 * 1000;
      const resultados = await Promise.all(ids.map((id, i) => filho(raiz, id, base + i * 60 * 1000)));
      const erros = resultados.flatMap(r => r.erros.map(e => `${r.id}: ${e}`));
      assert.deepEqual(erros, [], `rodada ${rodada}: ${erros.length} escritas falharam`);
      const store = lerPerfis(raiz);
      for (const r of resultados) {
        assert.equal(store.perfis.find(p => p.id === r.id)?.ultimoUso, r.ultima, `rodada ${rodada}: ultima escrita de ${r.id} perdida`);
      }
    }
    assert.equal(fs.existsSync(path.join(raiz, '.orkastery', 'private', 'runtime-profiles.json.lock')), false, 'nenhum lock sobra');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('A5: lock velho (dono morto, ou sem dono ha mais de 10 s) e quebrado; lock vivo e esperado, nunca apagado', async () => {
  const raiz = dirTemporario('lock-velho');
  try {
    fs.mkdirSync(path.join(raiz, '.orkastery'));
    adicionarPerfil(raiz, { id: 'a', runtime: 'claude-bg', dir: '/srv/contas/a' });
    const lock = path.join(raiz, '.orkastery', 'private', 'runtime-profiles.json.lock');
    // Dono morto: pid de um processo que ja saiu.
    const morto = spawn(process.execPath, ['-e', '0']);
    const pidMorto = await new Promise<number>(r => morto.on('close', () => r(morto.pid as number)));
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, 'pid'), String(pidMorto));
    assert.equal(registrarUsoDePerfil(raiz, 'a', '2026-09-19T01:00:00.000Z').ultimoUso, '2026-09-19T01:00:00.000Z');
    assert.equal(fs.existsSync(lock), false);
    // Sem dono e antigo.
    fs.mkdirSync(lock, { mode: 0o700 });
    const antigo = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, antigo, antigo);
    assert.equal(registrarUsoDePerfil(raiz, 'a', '2026-09-19T02:00:00.000Z').ultimoUso, '2026-09-19T02:00:00.000Z');
    assert.equal(fs.readdirSync(path.dirname(lock)).some(n => n.includes('.lock')), false, 'nenhum resto de lock');
    // Dono vivo: outro processo segura o lock por 300 ms; a escrita espera e entra depois.
    const vivo = spawn(process.execPath, ['-e', `
      const fs = require('fs'); fs.mkdirSync(${JSON.stringify(lock)}, { mode: 0o700 });
      fs.writeFileSync(${JSON.stringify(path.join(lock, 'pid'))}, String(process.pid));
      process.stdout.write('segurando');
      setTimeout(() => { fs.rmSync(${JSON.stringify(path.join(lock, 'pid'))}); fs.rmdirSync(${JSON.stringify(lock)}); }, 300);`]);
    const vivoSaiu = new Promise<void>(r => vivo.on('close', () => r()));
    await new Promise<void>(r => vivo.stdout.once('data', () => r()));
    const antes = Date.now();
    const usado = await new Promise<string | null>((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', `const rp = require(process.argv[1]);
        process.stdout.write(rp.registrarUsoDePerfil(process.argv[2], 'a', '2026-09-19T03:00:00.000Z').ultimoUso);`, DIST, raiz]);
      let s = ''; p.stdout.on('data', b => { s += b; }); p.on('close', c => c === 0 ? resolve(s) : reject(new Error(`saiu ${c}`)));
    });
    assert.equal(usado, '2026-09-19T03:00:00.000Z');
    assert.ok(Date.now() - antes >= 250, 'esperou o dono vivo liberar');
    await vivoSaiu;
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

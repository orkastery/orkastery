/**
 * RM-053, X6 do CHECK 6: o id da instalacao numa pasta dividida entre hosts (ou conteineres).
 *
 * Antes, sem hard link (e na troca do arquivo ruim), cada host gravava um id DERIVADO do proprio
 * hostname e boot, e o ultimo a gravar vencia: o host que tinha publicado com o seu id passava a ler
 * outro. Agora o id sai de uma reserva por `rename` de pasta com conteudo, igual para todo host que ve a
 * pasta. Cada processo filho finge ser um host (o `os.hostname` dele); `-r sem-link` tira o hard link.
 * Os casos entre hosts reprovam no codigo anterior.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const MODULO = path.resolve(__dirname, '../src/rede-adesao.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O preload: o host que o filho finge ser e, com SEM_LINK, um sistema de arquivos sem hard link. */
function preload(d: string): string {
  const arquivo = path.join(d, 'host-falso.js');
  fs.writeFileSync(arquivo, "const fs = require('fs'), os = require('os');\n" +
    "os.hostname = () => process.env.HOST_FALSO;\n" +
    "if (process.env.SEM_LINK) fs.linkSync = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };\n");
  return arquivo;
}

function idNoHost(pre: string, usuario: string, host: string, semLink: boolean): string {
  const r = spawnSync(process.execPath, ['-r', pre, '-e', `process.stdout.write(require(${JSON.stringify(MODULO)}).idDaMaquina())`],
    { env: { ...process.env, ORK_USUARIO_DIR: usuario, HOST_FALSO: host, ...(semLink ? { SEM_LINK: '1' } : {}) }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const gravado = (u: string) => fs.readFileSync(path.join(u, 'maquina-id'), 'utf8').trim();

test('X6: sem hard link, o host que chega depois da reserva le o mesmo id, nao o derivado do proprio host', () => {
  const d = dirTemporario('rm053-x6-criar');
  try {
    const pre = preload(d), u = fs.mkdtempSync(path.join(d, 'pasta-dividida-'));
    const a = idNoHost(pre, u, 'host-a', true);
    assert.match(a, UUID);
    // O host b chega com a reserva feita e o arquivo ainda fora (o host a nao tinha gravado ou o b nao o via).
    fs.rmSync(path.join(u, 'maquina-id'));
    assert.equal(idNoHost(pre, u, 'host-b', true), a, 'o host b fica com o id do host a');
    assert.equal(gravado(u), a);
    assert.equal(idNoHost(pre, u, 'host-a', true), a, 'e o host a continua com o seu');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('X6: o mesmo arquivo ruim, trocado por dois hosts, vira o mesmo id (V5 entre hosts)', () => {
  const d = dirTemporario('rm053-x6-troca');
  try {
    const pre = preload(d);
    for (const [caso, conteudo] of [['vazio', ''], ['corrompido', 'lixo']] as const) {
      const u = fs.mkdtempSync(path.join(d, `${caso}-`));
      const arquivo = path.join(u, 'maquina-id'), copia = path.join(u, 'o-mesmo-inode');
      fs.writeFileSync(arquivo, conteudo);
      fs.linkSync(arquivo, copia);
      const a = idNoHost(pre, u, 'host-a', false);
      assert.match(a, UUID, caso);
      // O host b viu o MESMO arquivo ruim (conteudo, tamanho e hora) e troca depois que o a ja devolveu.
      fs.renameSync(copia, arquivo);
      assert.equal(fs.readFileSync(arquivo, 'utf8'), conteudo, `${caso}: o b ve o arquivo ruim de antes`);
      assert.equal(idNoHost(pre, u, 'host-b', false), a, `${caso}: o host b grava o id do host a`);
      assert.equal(gravado(u), a, caso);
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('X6: processos de dois hosts ao mesmo tempo, sem hard link, recebem todos o id que ficou gravado', async () => {
  const d = dirTemporario('rm053-x6-corrida');
  try {
    const pre = preload(d);
    const filho = "const fs = require('fs'); const { idDaMaquina } = require(process.env.MODULO);" +
      'while (!fs.existsSync(process.env.BARREIRA)) {}' +
      "let id; try { id = idDaMaquina(); } catch (e) { id = 'ERRO ' + e.message; } process.stdout.write(id);";
    for (const [caso, inicial] of [['ausente', null], ['vazio', '']] as const) {
      for (let rodada = 0; rodada < 3; rodada++) {
        const u = fs.mkdtempSync(path.join(d, `${caso}-`));
        if (inicial !== null) fs.writeFileSync(path.join(u, 'maquina-id'), inicial);
        const barreira = path.join(u, 'vai');
        const saidas = Array.from({ length: 8 }, (_, i) => new Promise<string>((res) => {
          const c = spawn(process.execPath, ['-r', pre, '-e', filho], { env: { ...process.env, ORK_USUARIO_DIR: u, BARREIRA: barreira,
            MODULO, HOST_FALSO: `host-${i % 2 ? 'a' : 'b'}`, SEM_LINK: '1' } });
          let out = '';
          c.stdout.on('data', (x) => { out += x; });
          c.on('close', () => res(out));
        }));
        await new Promise((r) => setTimeout(r, 300));
        fs.writeFileSync(barreira, '1');
        const ids = await Promise.all(saidas);
        const final = gravado(u);
        assert.match(final, UUID, `${caso}: ${final}`);
        assert.deepEqual(new Set(ids), new Set([final]), `${caso}, rodada ${rodada}: todo host devolve o id gravado`);
        assert.deepEqual(fs.readdirSync(u).filter((x) => x.endsWith('.tmp')), [], 'nenhuma pasta temporaria fica');
      }
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('X6: reserva ruim cai no id derivado de antes, estavel; pastas separadas (clones, W6) tem ids diferentes', () => {
  const d = dirTemporario('rm053-x6-borda');
  try {
    const pre = preload(d);
    // A reserva com lixo dentro, ou um arquivo no lugar dela: o id sai derivado, valido e estavel.
    for (const [caso, montar] of [
      ['lixo', (u: string) => { fs.mkdirSync(path.join(u, 'maquina-id.reserva')); fs.writeFileSync(path.join(u, 'maquina-id.reserva', 'id'), 'lixo'); }],
      ['arquivo', (u: string) => fs.writeFileSync(path.join(u, 'maquina-id.reserva'), 'x')],
    ] as const) {
      const u = fs.mkdtempSync(path.join(d, `${caso}-`));
      montar(u);
      const id = idNoHost(pre, u, 'host-a', true);
      assert.match(id, UUID, caso);
      fs.rmSync(path.join(u, 'maquina-id'));
      assert.equal(idNoHost(pre, u, 'host-a', true), id, `${caso}: o derivado e o mesmo no mesmo host`);
    }
    // W6: dois discos (pastas) com o mesmo hostname nao dividem a reserva.
    const [p, q] = [fs.mkdtempSync(path.join(d, 'clone-')), fs.mkdtempSync(path.join(d, 'clone-'))];
    assert.notEqual(idNoHost(pre, p, 'ubuntu', true), idNoHost(pre, q, 'ubuntu', true));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

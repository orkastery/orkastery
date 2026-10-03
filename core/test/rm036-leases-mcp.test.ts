/** R5: a fila do main-tree nao interrompe claims/documentos de outras threads. */
import { test, TestContext } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adquirir, caminhoLease, lerLease, regravarLease } from '../src/leases';
import { adicionarClaimMcp, escreverArtefatoMcp, lerArtefatoMcp, listarClaimsMcp } from '../src/mcp-artifacts';
import { gravarThread } from '../src/thread';
import { Thread } from '../src/types';

function fixture(t: TestContext) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm036-mcp-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  fs.writeFileSync(path.join(raiz, 'orkastery.yaml'), 'project:\n  name: fixture\n  abbrev: ork\n');
  const id = 'ork-documentos', agora = new Date().toISOString();
  const thread: Thread = { id, slug: id, nome: 'fixture', assunto: 'documentos', modo: 'auto',
    fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'],
    blocos: [{ fases: ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'], pausa: false, pausaSobre: '', slugFases: 'full' }], faseAtual: 'GOAL', status: 'aberta',
    criadaEm: agora, atualizadaEm: agora, projeto: { name: 'fixture', abbrev: 'ork' },
    base: { branch: 'main', commit: 'fixture' }, worktree: null, sessoes: [], decisoes: [], claims: [], leases: [], baseline: null };
  gravarThread(raiz, thread);
  const arquivo = caminhoLease(raiz, 'main-tree'), fila = `${arquivo}.retomadas`;
  regravarLease(raiz, { nome: 'main-tree', thread: 'ork-antiga', motivo: 'fixture', pid: process.pid,
    adquiridoEm: agora, expiraEm: new Date(Date.now() - 1_000).toISOString() });
  const escrever = (texto: string) => {
    const anterior = lerArtefatoMcp(raiz, id, 'goal');
    const doc = escreverArtefatoMcp(raiz, id, 'goal', texto, anterior.sha256);
    assert.equal(doc.reciboOficial, false);
    assert.equal(lerArtefatoMcp(raiz, id, 'goal').conteudo, texto);
    const claim = adicionarClaimMcp(raiz, id, { arquivo: 'core/src/leases.ts', alegacao: texto, verificar: ['true'] });
    assert.equal(claim.estado, 'pendente');
    assert.equal(listarClaimsMcp(raiz, id).at(-1)?.id, claim.id);
  };
  return { raiz, id, arquivo, fila, escrever };
}

for (const transporte of ['flock', 'portatil']) {
  test(`rm036 mcp: R5 claim e documento durante e depois da retomada ${transporte}`, (t) => {
    const c = fixture(t), cp = require('node:child_process'), spawn = cp.spawnSync;
    const inode = fs.statSync(c.arquivo).ino;
    let chamadas = 0;
    t.mock.method(cp, 'spawnSync', (cmd: string, args: string[], opts: any) => {
      if (cmd === '/usr/bin/flock' && fs.fstatSync(opts.stdio[3]).ino === inode) {
        chamadas++;
        if (transporte === 'portatil') return { status: null, error: Object.assign(Error('ausente'), { code: 'ENOENT' }) };
      }
      return spawn(cmd, args, opts);
    });
    const io = require('node:fs'), apagar = io.unlinkSync;
    let durante = false;
    t.mock.method(io, 'unlinkSync', (p: fs.PathLike) => {
      if (String(p) === c.arquivo && !durante) {
        assert.equal(fs.readdirSync(c.fila).length, 1);
        c.escrever('Durante a retomada');
        durante = true;
      }
      return apagar(p);
    });
    const r = adquirir(c.raiz, 'main-tree', { thread: 'ork-nova', motivo: 'retomar' });
    assert.equal(r.ok, true);
    assert.equal(r.tomadoDeVencido, true);
    assert.equal(durante, true);
    assert.equal(chamadas, 1);
    assert.equal(fs.existsSync(c.fila), false, 'pasta vazia removida');
    c.escrever('Depois da retomada');
    assert.equal(listarClaimsMcp(c.raiz, c.id).length, 2);
    assert.equal(lerLease(c.raiz, 'main-tree')?.thread, 'ork-nova');
  });
}

test('rm036 mcp: R5 pasta vazia da versao anterior e temporario regular sao aceitos', (t) => {
  const c = fixture(t);
  fs.mkdirSync(c.fila);
  c.escrever('Fila antiga vazia');
  fs.writeFileSync(path.join(c.fila, `${process.pid}-00000000-0000-4000-8000-000000000000.json.tmp`), '');
  c.escrever('Publicacao em curso');
});

for (const tipo of ['pasta-arbitraria', 'fila-symlink', 'candidato-symlink', 'candidato-hardlink', 'subpasta', 'nome-invalido']) {
  test(`rm036 mcp: R5 recusa ${tipo} sem escrever fora da fila`, (t) => {
    const c = fixture(t), alvo = path.join(c.raiz, 'sentinela');
    fs.writeFileSync(alvo, 'intacto');
    fs.mkdirSync(c.fila);
    const candidato = path.join(c.fila, `${process.pid}-00000000-0000-4000-8000-000000000000.json`);
    if (tipo === 'pasta-arbitraria') fs.renameSync(c.fila, path.join(path.dirname(c.fila), 'arbitraria'));
    if (tipo === 'fila-symlink') {
      // Fora de leases: a recusa deve vir do link, nao de uma pasta irma arbitraria.
      const real = path.join(c.raiz, 'fila-real');
      fs.renameSync(c.fila, real);
      fs.symlinkSync(real, c.fila);
    }
    if (tipo === 'candidato-symlink') fs.symlinkSync(alvo, candidato);
    if (tipo === 'candidato-hardlink') fs.linkSync(alvo, candidato);
    if (tipo === 'subpasta') fs.mkdirSync(candidato);
    if (tipo === 'nome-invalido') fs.writeFileSync(path.join(c.fila, 'intruso'), '');
    assert.throws(() => c.escrever('recusado'), /mcp.state.unsafe/);
    assert.equal(fs.readFileSync(alvo, 'utf8'), 'intacto');
    assert.equal(listarClaimsMcp(c.raiz, c.id).length, 0);
    assert.equal(lerArtefatoMcp(c.raiz, c.id, 'goal').conteudo, null);
  });
}

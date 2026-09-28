/**
 * I-33 (D15, GO-FIX 1 do CHECK aa279e17, achado A4): a fila acorda no menor prazo entre o runtime
 * original e os da ordem de fallback, e a retomada tenta o runtime cujo prazo liberou, inclusive o
 * de fallback, em vez de so o original. Sem nenhum runtime liberado, o pedido volta a fila com um
 * prazo posterior ao instante da retomada e a tentativa conta: nada de laco na mesma chamada.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { encerrarController } from '../src/adapters/codex-controller';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { lerFilaDeRetomada, PedidoComPerfil } from '../src/ratelimit';
import { executarRetry, retomarFila } from '../src/retry';
import { adicionarPerfil, lerPerfis, marcarFalhaDePerfil } from '../src/runtime-profiles';
import { editarBloco } from '../src/setup';
import { dirThread, novaThread } from '../src/thread';

const PROMPT = 'FINALIZAR-SIMULADO: fatia da fila';
const HORA = 3600 * 1000;

function cenario(nome: string) {
  const p = projetoTemporario(nome);
  const f = controllerSimulado(p.dir);
  const claude = runtimePorConta(nome);
  const bin = path.join(p.dir, 'codex-conta-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh
if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi
exec ${JSON.stringify(path.join(p.dir, 'fake-bin', 'codex'))} "$@"
`, { mode: 0o755 });
  const anterior = process.env.PATH;
  process.env.PATH = `${bin}:${anterior ?? ''}`;
  assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO'] }).ok, true);
  claude.conta(p.dir, 'a', { falha: 'Error: Your workspace is out of credits. Try again in 3 hours.' });
  claude.conta(p.dir, 'b', { falha: 'Error: Your workspace is out of credits. Try again in 4 hours.' });
  const casaX = path.join(p.dir, 'contas', 'x');
  fs.mkdirSync(casaX, { recursive: true });
  fs.copyFileSync(path.join(f.runtimeHome, 'cenario.json'), path.join(casaX, 'cenario.json'));
  adicionarPerfil(p.dir, { id: 'x', runtime: 'codex', dir: casaX });
  marcarFalhaDePerfil(p.dir, 'x', { estado: 'esgotado', esgotadoAte: new Date(Date.now() + HORA).toISOString(),
    motivo: 'runtime.quota-exhausted', detalhe: 'usage_limit_exceeded' });
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const dir = dirThread(p.dir, t.id);
  const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: PROMPT });
  assert.equal(r.motivo, 'runtime.quota-exhausted');
  const retry = executarRetry(p.carregado, t.id);
  assert.equal(retry.fila.length, 1, retry.detalhe);
  return { p, f, claude, casaX, t, dir, r, pedido: retry.fila[0] as PedidoComPerfil,
    limpar: () => {
      for (const e of lerLedger(dir)) {
        if (e.tipo !== 'phase_dispatch' || typeof e.controlador !== 'string') continue;
        try { const l = JSON.parse(fs.readFileSync(path.join(e.controlador, 'launch.json'), 'utf8')); encerrarController(e.controlador, l.vinculo, l.instancia, 8000); }
        catch { /* controller ja terminal */ }
      }
      process.env.PATH = anterior; claude.restaurar(); f.restaurar(); p.limpar();
    } };
}

test('A4: a fila acorda no prazo do codex de fallback e a retomada despacha nele, com o mesmo prompt', () => {
  const c = cenario('fila-fallback');
  try {
    const x = lerPerfis(c.p.dir).perfis.find(q => q.id === 'x')!;
    assert.equal(c.pedido.liberaEm, x.esgotadoAte, 'o menor prazo entre o original e o fallback e o do codex x');
    // D16: com a troca por cota ligada por padrao, o retry tentou a e depois b antes da fila.
    const bgAntes = c.claude.envs().filter(l => l.startsWith('--bg')).length;
    assert.equal(bgAntes, 2, 'a rotacao da D5 tentou os dois perfis claude-bg antes da fila');
    // O prazo de x vence; o de a (3 h) e o de b (4 h) nao.
    marcarFalhaDePerfil(c.p.dir, 'x', { estado: 'esgotado', esgotadoAte: new Date(Date.now() - 1000).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'prazo vencido no teste' });
    const [retomada] = retomarFila(c.p.carregado, { quando: c.pedido.liberaEm });
    assert.equal(retomada.despachada, true, retomada.detalhe);
    const despacho = lerLedger(c.dir).filter(e => e.tipo === 'phase_dispatch').at(-1);
    assert.equal(despacho?.runtime, 'codex');
    assert.equal(despacho?.model, 'modelo-SIMULADO');
    assert.equal((despacho?.perfil as { id: string }).id, 'x');
    assert.equal(despacho?.promptSha256, c.r.promptSha256, 'o MESMO prompt');
    assert.equal(lerFilaDeRetomada(c.p.dir).filter(q => q.id === c.pedido.id).at(-1)?.estado, 'retomado');
    const retomado = lerLedger(c.dir).find(e => e.tipo === 'rate_limit_resumed');
    assert.deepEqual([retomado?.runtime, retomado?.perfil], ['codex', 'x']);
    assert.equal(c.claude.envs().filter(l => l.startsWith('--bg')).length, bgAntes, 'o claude-bg esgotado nao foi tentado de novo na retomada');
    esperarCondicao(() => fs.existsSync(path.join(c.casaX, 'rollout.jsonl')), 10000);
  } finally { c.limpar(); }
});

test('A4 sem runtime liberado: o pedido volta a fila com prazo posterior a retomada, a tentativa conta e nao ha laco', () => {
  const c = cenario('fila-sem-liberar');
  try {
    const [retomada] = retomarFila(c.p.carregado, { quando: c.pedido.liberaEm });
    assert.equal(retomada.despachada, false);
    const depois = lerFilaDeRetomada(c.p.dir).filter(q => q.id === c.pedido.id).at(-1)!;
    assert.equal(depois.estado, 'aguardando');
    assert.equal(depois.tentativas, 1);
    assert.ok(depois.liberaEm > c.pedido.liberaEm, `novo prazo ${depois.liberaEm} depois de ${c.pedido.liberaEm}`);
    assert.equal(depois.liberaEm, lerPerfis(c.p.dir).perfis.find(q => q.id === 'a')?.esgotadoAte, 'o proximo prazo e o do claude-bg (a)');
    assert.deepEqual(retomarFila(c.p.carregado, { quando: c.pedido.liberaEm }), [], 'na mesma janela nada vence de novo');
    assert.equal(lerLedger(c.dir).filter(e => e.tipo === 'phase_dispatch').length, 0);
  } finally { c.limpar(); }
});

/**
 * RM-052 (fatia 2, L1): o modo host e o `ORK_PROJETO` de quem despachou nao atravessam para quem o
 * nucleo inicia ja dentro do projeto.
 *
 * O OpenClaw roda o `ork` com `ORK_PROJETO_EXPLICITO=1`. Na fatia 1, o `ork phase run` pedido por uma
 * tool passava esse ambiente a sessao despachada (o codex espalha o ambiente do processo; o `claude
 * --bg` entrega a sessao a um daemon que guarda o ambiente de quem o iniciou) e ao filho `fabrica
 * publicar`. Dentro da worktree da thread, numa maquina com mais de um projeto conhecido, todo `ork`
 * da sessao recusava com `projeto.escolha` (saida 4); com o `ORK_PROJETO` de outro projeto herdado,
 * lia o projeto errado. Os tres testes abaixo reprovam o codigo da fatia 1.
 */
import { strict as assert } from 'node:assert';
import { test, TestContext } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { novaThread } from '../src/thread';
import { registrarProjeto } from '../src/projeto-alvo';
import { ambienteDaConducao } from '../src/conducao';
import { ambienteDoDespacho, ambienteDoFilho } from '../src/adapters/codex';
import { montarComando, semContextoDeDespacho } from '../src/adapters/claude-bg';
import { publicarEmSegundoPlano } from '../src/fabrica-publicar';
import { rodarAuditoria } from '../src/auditrun';
import { dirTemporario, projetoTemporario, runtimeFalso } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const ID = '0b6f4c7e-6d1f-4a7b-9e2a-1c3d5e7f9a0b';

/** A maquina de um gateway: o orkastery com uma thread e a worktree dela, e o alfa, os dois registrados. */
function maquina(t: TestContext) {
  const orkastery = projetoTemporario('despacho-orkastery');
  const alfa = projetoTemporario('despacho-alfa');
  init(alfa.dir, { nome: 'alfa', abbrev: 'alf', force: true });
  alfa.carregado = exigirManifesto(alfa.dir);
  const { thread } = novaThread(orkastery.carregado, { nome: 'despacho por host', modo: 'auto', criarWorktree: true });
  const usuario = dirTemporario('despacho-usuario');
  const anterior = process.env.ORK_USUARIO_DIR;
  process.env.ORK_USUARIO_DIR = usuario;
  registrarProjeto(orkastery.dir, 'thread new');
  registrarProjeto(alfa.dir, 'init');
  t.after(() => {
    if (anterior === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = anterior;
    orkastery.limpar(); alfa.limpar(); fs.rmSync(usuario, { recursive: true, force: true });
  });
  assert.ok(thread.worktree && fs.existsSync(thread.worktree), 'a thread nasce com a worktree');
  return { orkastery, alfa, thread: thread.id, worktree: thread.worktree!, usuario };
}

function rodar(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [ORK, ...args], { cwd, env, encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function ate(condicao: () => boolean, ms: number, oque: string): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error(`esperou ${ms} ms por ${oque}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('L1: na worktree da thread, o ork da sessao despachada por um host le a propria thread', (t) => {
  const m = maquina(t);
  const gateway: NodeJS.ProcessEnv = { ...process.env, ORK_USUARIO_DIR: m.usuario, ORK_PROJETO_EXPLICITO: '1' };
  // O ambiente que o gateway tinha: sem a conducao por cima, a sessao recusaria todo `ork`.
  const semConducao = rodar(['thread', 'status', m.thread], m.worktree, gateway);
  assert.equal(semConducao.status, 4, semConducao.stdout + semConducao.stderr);
  assert.match(semConducao.stdout, /projeto\.escolha/);
  // O que a sessao recebe: o ambiente herdado com o da conducao por cima (codex), ou o do `--settings`
  // vencendo o do daemon (claude-bg). Com o modo host e com o ORK_PROJETO de outro projeto.
  for (const herdado of [gateway, { ...gateway, ORK_PROJETO: 'alfa' }]) {
    const r = rodar(['thread', 'status', m.thread], m.worktree, { ...herdado, ...ambienteDaConducao(ID, m.thread, 'openclaw') });
    assert.equal(r.status, 0, `${herdado.ORK_PROJETO ?? 'modo host'}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`Thread ${m.thread}`));
    assert.doesNotMatch(r.stdout + r.stderr, /nao encontrada|projeto\.escolha/);
  }
});

test('L1: o despacho codex e o claude-bg levam o projeto neutro; o processo claude nao leva o do gateway', () => {
  const extra = ambienteDaConducao(ID, 'ork-x', 'openclaw');
  assert.equal(extra.ORK_PROJETO, '');
  assert.equal(extra.ORK_PROJETO_EXPLICITO, '0');
  const gateway: NodeJS.ProcessEnv = { ...process.env, ORK_PROJETO_EXPLICITO: '1', ORK_PROJETO: 'alfa' };
  // codex: o filho recebe o ambiente do processo com o extra por cima (ambienteDoFilho, o que o despachar usa).
  const codex = ambienteDoFilho({ ambienteExtra: extra }, gateway);
  assert.equal(codex.ORK_PROJETO, '');
  assert.equal(codex.ORK_PROJETO_EXPLICITO, '0');
  assert.equal(ambienteDoDespacho(gateway).ORK_PROJETO_EXPLICITO, '1', 'sem o extra, o filho herdaria o modo host');
  // claude-bg: o extra vai por sessao, no `--settings`, e sai do ambiente do processo `claude`, o que um
  // daemon novo guardaria.
  const comando = montarComando({ prompt: 'fase', nome: 'ork-x-go', cwd: dirTemporario('despacho-cwd'), ambienteExtra: extra });
  const i = comando.indexOf('--settings');
  assert.ok(i > 0, 'o comando leva --settings');
  assert.deepEqual(JSON.parse(comando[i + 1]).env, extra);
  const processo = semContextoDeDespacho(gateway, extra);
  assert.equal(processo.ORK_PROJETO, undefined);
  assert.equal(processo.ORK_PROJETO_EXPLICITO, undefined);
});

test('L1 (aviso A1 do CHECK): a sessao do ork audit run tambem le o projeto pelo proprio cwd', (t) => {
  const p = projetoTemporario('despacho-auditoria');
  const runtime = runtimeFalso('despacho-auditoria');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  // Na janela ociosa padrao (22:00-06:00) e no estagio nascente, o pack clean-code despacha de verdade.
  const rodada = rodarAuditoria(p.carregado, 'clean-code', { quando: new Date(2026, 8, 3, 2, 30) });
  assert.equal(rodada.status, 'despachada', rodada.detalhe);
  // O stub do `claude` grava o `--settings` que recebeu: o projeto da sessao vem neutro, por sessao.
  const settings = JSON.parse(fs.readFileSync(path.join(runtime.dir, 'settings'), 'utf8')) as { env: Record<string, string> };
  assert.deepEqual(settings.env, { ORK_PROJETO: '', ORK_PROJETO_EXPLICITO: '0' });
});

test('L1: o filho da fabrica, chamado por um host, publica o projeto do proprio cwd', async (t) => {
  const m = maquina(t);
  const nomes = ['ORK_PROJETO_EXPLICITO', 'ORK_PROJETO', 'ORK_FABRICA_PUBLICAR', 'ORK_FABRICA_COMPARTILHADA'] as const;
  const antes = Object.fromEntries(nomes.map((n) => [n, process.env[n]]));
  t.after(() => { for (const n of nomes) if (antes[n] === undefined) delete process.env[n]; else process.env[n] = antes[n]; });
  // Quem chama e o `ork` de uma tool do OpenClaw (modo host), com a fabrica compartilhada ligada.
  process.env.ORK_PROJETO_EXPLICITO = '1';
  delete process.env.ORK_PROJETO;
  process.env.ORK_FABRICA_PUBLICAR = '1';
  process.env.ORK_FABRICA_COMPARTILHADA = '1';
  const log = path.join(m.orkastery.dir, '.orkastery', 'monitor', 'fabrica.log');
  assert.equal(publicarEmSegundoPlano(m.orkastery.dir), true, 'o filho foi lancado');
  // Sem remoto, a publicacao falha DENTRO do comando e deixa a linha no log; o filho que morria na
  // resolucao do projeto (projeto.escolha, antes de qualquer comando) nao deixava nada.
  await ate(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').trim() !== '', 20_000, 'a linha do filho em fabrica.log');
  const ultima = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1)!) as { acao: string };
  assert.equal(ultima.acao, 'falhou');
});

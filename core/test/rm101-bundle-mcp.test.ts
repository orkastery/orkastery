/** RM-101: o bundle derivado fecha o GO pelo MCP sem virar prova de si mesmo. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, isolarConfiguracaoGlobalDoGit } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { prepararBundleCi } from '../src/ci';
import { commitMcp, type PedidoCommitMcp } from '../src/mcp-git';
import { exec } from '../src/util';
import { lerLedger, registrar, TIPOS_DE_EVENTO, type MetadadosDoNovoEvento } from '../src/ledger';

isolarConfiguracaoGlobalDoGit('rm101-bundle-mcp');

interface Fixture {
  raiz: string;
  wt: string;
  id: string;
  head: string;
  bundle: string;
  pedido: PedidoCommitMcp;
  git: (args: string[]) => string;
  verify: (opcoes?: { commit?: string; verde?: boolean }) => MetadadosDoNovoEvento;
  preparar: () => string;
}

async function fixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const p = projetoTemporario('rm101-bundle-mcp');
  try {
    const t = novaThread(p.carregado, { nome: 'bundle derivado', modo: 'auto', criarWorktree: true }).thread;
    gravarThread(p.dir, t);
    const wt = t.worktree!;
    const git = (args: string[]) => {
      const r = exec('/usr/bin/git', args, wt);
      assert.equal(r.ok, true, r.stderr);
      return r.stdout;
    };
    const head = git(['rev-parse', 'HEAD']).trim();
    const bundle = `.ork-ci/${t.id}.json`;
    const verify = (opcoes: { commit?: string; verde?: boolean } = {}) => {
      const evento = registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.verificacao, {
        commit: opcoes.commit ?? head,
        veredito: opcoes.verde === false ? 'reprovado' : 'verdade sustentada',
        parcial: false,
        check: { modo: 'agile', origem: 'manifesto' },
      });
      return evento as typeof evento & MetadadosDoNovoEvento;
    };
    await fn({ raiz: p.dir, wt, id: t.id, head, bundle,
      pedido: { threadId: t.id, expectedHead: head, paths: [bundle], mensagem: 'ci: bundle da fixture' },
      git, verify, preparar: () => prepararBundleCi(p.carregado, t.id) });
  } finally {
    p.limpar();
  }
}

function semEfeito(f: Fixture): void {
  assert.equal(f.git(['rev-parse', 'HEAD']).trim(), f.head);
  assert.equal(f.git(['diff', '--cached', '--name-only']).trim(), '');
}

test('o prepare vincula bytes, thread, HEAD e verify verde, e o MCP registra a derivacao sem autoverificacao', async () => fixture(async (f) => {
  const rodada = f.verify();
  const arquivo = f.preparar();
  const bundle = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.deepEqual(bundle.derivacao, {
    contrato: 'ork.ci-bundle-derivacao/v1', thread: f.id, head: f.head, verifyRun: rodada.eventId,
  });
  const preparo = lerLedger(dirThread(f.raiz, f.id)).filter((e) => e.tipo === 'ci_bundle_prepared').at(-1)!;
  assert.deepEqual([preparo.arquivo, preparo.head, preparo.verifyRun], [f.bundle, f.head, rodada.eventId]);
  assert.match(String(preparo.sha256), /^[a-f0-9]{64}$/);

  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.ok, true, r.erro ?? '');
  assert.equal(r.artefatosDerivados?.length, 1);
  assert.deepEqual(r.artefatosDerivados?.[0], {
    arquivo: f.bundle, contrato: 'ork.ci-bundle-derivacao/v1', thread: f.id, head: f.head,
    verifyRun: rodada.eventId, sha256: preparo.sha256,
  });
  assert.equal('verificado' in (r.artefatosDerivados?.[0] as unknown as Record<string, unknown>), false);
  const recibo = lerLedger(dirThread(f.raiz, f.id)).filter((e) => e.tipo === 'mcp_git_committed').at(-1)!;
  assert.deepEqual(recibo.artefatosDerivados, r.artefatosDerivados);
}));

test('a excecao estreita nao dispensa claim de arquivo comum', async () => fixture(async (f) => {
  fs.writeFileSync(path.join(f.wt, 'produto.txt'), 'sem claim\n');
  const r = await commitMcp(f.raiz, { ...f.pedido, paths: ['produto.txt'] });
  assert.equal(r.erro, 'mcp.git.claim.missing');
  semEfeito(f);
}));

test('bundle ausente e bundle alterado sao recusados antes do commit', async () => fixture(async (f) => {
  f.verify();
  let r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.missing');
  semEfeito(f);

  const arquivo = f.preparar();
  fs.appendFileSync(arquivo, '\n');
  r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.changed');
  semEfeito(f);
}));

test('bundle derivado de outro HEAD e recusado antes do commit', async () => fixture(async (f) => {
  f.verify({ commit: 'a'.repeat(40) });
  f.preparar();
  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.head.stale');
  semEfeito(f);
}));

test('bundle de outra thread e recusado antes do commit', async () => fixture(async (f) => {
  f.verify();
  const arquivo = f.preparar();
  const bundle = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  bundle.thread = 'ork-outra-thread';
  bundle.derivacao.thread = 'ork-outra-thread';
  fs.writeFileSync(arquivo, JSON.stringify(bundle, null, 2) + '\n');
  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.thread.invalid');
  semEfeito(f);
}));

test('bundle ligado a rodada nao verde e recusado antes do commit', async () => fixture(async (f) => {
  f.verify({ verde: false });
  f.preparar();
  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.verify.invalid');
  semEfeito(f);
}));

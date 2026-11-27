/** RM-101: o bundle derivado fecha o GO pelo MCP sem virar prova de si mesmo. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { projetoTemporario, isolarConfiguracaoGlobalDoGit } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { adicionarClaim } from '../src/claims';
import { prepararBundleCi } from '../src/ci';
import { commitMcp, type PedidoCommitMcp } from '../src/mcp-git';
import { chaveDoReciboDeProva } from '../src/recibo-prova';
import { exec } from '../src/util';
import { lerLedger, registrar, TIPOS_DE_EVENTO, type MetadadosDoNovoEvento } from '../src/ledger';

isolarConfiguracaoGlobalDoGit('rm101-bundle-mcp');

const sha256 = (valor: Buffer | string): string => createHash('sha256').update(valor).digest('hex');
const oid = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

interface Fixture {
  raiz: string;
  wt: string;
  id: string;
  head: string;
  bundle: string;
  pedido: PedidoCommitMcp;
  git: (args: string[]) => string;
  verify: (opcoes?: { commit?: string; verde?: boolean; parcial?: boolean }) => MetadadosDoNovoEvento;
  preparar: () => string;
  claim: (arquivo: string, alegacao?: string) => void;
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
    const claim = (arquivo: string, alegacao = 'claim da fixture RM-101') => {
      adicionarClaim(p.dir, t.id, { arquivo, alegacao, fase: 'GO', verificar: ['node -e "process.exit(0)"'] });
    };
    const verify = (opcoes: { commit?: string; verde?: boolean; parcial?: boolean } = {}) => {
      const commit = opcoes.commit ?? head;
      const evento = registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.verificacao, {
        commit,
        recibo: chaveDoReciboDeProva(p.dir, t.id, commit),
        veredito: opcoes.verde === false ? 'reprovado' : 'verdade sustentada',
        parcial: opcoes.parcial ?? false,
        check: { modo: 'agile', origem: 'manifesto' },
      });
      return evento as typeof evento & MetadadosDoNovoEvento;
    };
    await fn({ raiz: p.dir, wt, id: t.id, head, bundle,
      pedido: { threadId: t.id, expectedHead: head, paths: [bundle], mensagem: 'ci: bundle da fixture' },
      git, verify, preparar: () => prepararBundleCi(p.carregado, t.id), claim });
  } finally {
    p.limpar();
  }
}

function semEfeito(f: Fixture): void {
  assert.equal(f.git(['rev-parse', 'HEAD']).trim(), f.head);
  assert.equal(f.git(['diff', '--cached', '--name-only']).trim(), '');
}

test('o prepare vincula bytes, claims, thread, HEAD e verify verde, e o commit registra o oid', async () => fixture(async (f) => {
  const rodada = f.verify();
  const arquivo = f.preparar();
  const bytes = fs.readFileSync(arquivo);
  const bundle = JSON.parse(bytes.toString('utf8'));
  const claimsSha256 = (rodada as unknown as { recibo: { claimsSha256: string } }).recibo.claimsSha256;
  assert.deepEqual(bundle.derivacao, {
    contrato: 'ork.ci-bundle-derivacao/v1', thread: f.id, head: f.head, verifyRun: rodada.eventId, claimsSha256,
  });
  const preparo = lerLedger(dirThread(f.raiz, f.id)).filter((e) => e.tipo === 'ci_bundle_prepared').at(-1)!;
  assert.deepEqual([preparo.arquivo, preparo.head, preparo.verifyRun, preparo.claimsSha256],
    [f.bundle, f.head, rodada.eventId, claimsSha256]);
  assert.equal(preparo.sha256, sha256(bytes));

  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.ok, true, r.erro ?? '');
  assert.equal(r.artefatosDerivados?.length, 1);
  assert.deepEqual(r.artefatosDerivados?.[0], {
    arquivo: f.bundle, contrato: 'ork.ci-bundle-derivacao/v1', thread: f.id, head: f.head,
    verifyRun: rodada.eventId, claimsSha256, sha256: preparo.sha256, oid: oid(bytes),
  });
  assert.equal(f.git(['rev-parse', `${r.commit}:${f.bundle}`]).trim(), oid(bytes));
  assert.equal('verificado' in (r.artefatosDerivados?.[0] as unknown as Record<string, unknown>), false);
  const recibo = lerLedger(dirThread(f.raiz, f.id)).filter((e) => e.tipo === 'mcp_git_committed').at(-1)!;
  assert.deepEqual(recibo.artefatosDerivados, r.artefatosDerivados);
}));

test('a excecao estreita nao dispensa claim de arquivo comum, Markdown ou vizinho do bundle', async () => fixture(async (f) => {
  const arquivos = ['produto.txt', 'README-sem-claim.md', 'docs/sem-claim.md', `.ork-ci/${f.id}.md`];
  for (const arquivo of arquivos) {
    fs.mkdirSync(path.dirname(path.join(f.wt, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(f.wt, arquivo), 'sem claim\n');
    const r = await commitMcp(f.raiz, { ...f.pedido, paths: [arquivo] });
    assert.equal(r.erro, 'mcp.git.claim.missing', arquivo);
    semEfeito(f);
  }
}));

test('bundle ausente, alterado e alterado mesmo com claim sao recusados antes do commit', async () => fixture(async (f) => {
  f.verify();
  let r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.missing');
  semEfeito(f);

  const arquivo = f.preparar();
  f.claim(f.bundle);
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

test('conteudo e caminho de outra thread sao recusados mesmo com claim', async () => fixture(async (f) => {
  f.verify();
  const arquivo = f.preparar();
  const outro = '.ork-ci/ork-outra-thread.json';
  fs.copyFileSync(arquivo, path.join(f.wt, outro));
  f.claim(outro);
  let r = await commitMcp(f.raiz, { ...f.pedido, paths: [outro] });
  assert.equal(r.erro, 'mcp.git.bundle.thread.invalid');
  semEfeito(f);

  const bundle = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  bundle.thread = 'ork-outra-thread';
  bundle.derivacao.thread = 'ork-outra-thread';
  fs.writeFileSync(arquivo, JSON.stringify(bundle, null, 2) + '\n');
  r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.thread.invalid');
  semEfeito(f);
}));

test('rodada reprovada ou parcial nao deriva bundle nem grava recibo de preparo', async () => {
  for (const parcial of [false, true]) await fixture(async (f) => {
    f.verify({ verde: parcial ? true : false, parcial });
    const arquivo = f.preparar();
    const bundle = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    assert.equal(bundle.derivacao, undefined);
    assert.equal(lerLedger(dirThread(f.raiz, f.id)).some((e) => e.tipo === 'ci_bundle_prepared'), false);
    const r = await commitMcp(f.raiz, f.pedido);
    assert.equal(r.erro, 'mcp.git.bundle.verify.invalid');
    semEfeito(f);
  });
});

test('claimsSha256 adulterado na derivacao e recusado', async () => fixture(async (f) => {
  f.verify();
  const arquivo = f.preparar();
  const bundle = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  bundle.derivacao.claimsSha256 = 'b'.repeat(64);
  fs.writeFileSync(arquivo, JSON.stringify(bundle, null, 2) + '\n');
  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.verify.invalid');
  semEfeito(f);
}));

test('bundle derivado nao pode dividir o commit com caminho que tem claim', async () => fixture(async (f) => {
  const produto = 'produto.txt';
  fs.writeFileSync(path.join(f.wt, produto), 'com claim\n');
  f.claim(produto);
  f.verify();
  f.preparar();
  const r = await commitMcp(f.raiz, { ...f.pedido, paths: [f.bundle, produto] });
  assert.equal(r.erro, 'mcp.git.bundle.exclusive');
  semEfeito(f);
}));

test('atributo ident nao muda o blob conferido e a recusa limpa o indice', async () => fixture(async (f) => {
  fs.writeFileSync(path.join(f.wt, '.gitattributes'), '.ork-ci/*.json ident\n');
  const rastreado = f.git(['ls-files']).split('\n').filter(Boolean)[0];
  f.claim(rastreado, 'claim com $Id: valor $ para exercitar ident');
  f.verify();
  f.preparar();
  const r = await commitMcp(f.raiz, f.pedido);
  assert.equal(r.erro, 'mcp.git.bundle.changed');
  semEfeito(f);
}));

const TROCADOR = `
const fs=require('node:fs');
const [alvo,original,forjado]=process.argv.slice(1);
const O=fs.readFileSync(original),M=fs.readFileSync(forjado);
const espera=(ms)=>{const fim=Date.now()+ms;while(Date.now()<fim){}};
for(;;){
  fs.writeFileSync(alvo+'.troca',M);fs.renameSync(alvo+'.troca',alvo);espera(4);
  fs.writeFileSync(alvo+'.troca',O);fs.renameSync(alvo+'.troca',alvo);espera(12);
}`;

test('troca concorrente nunca entra no commit e toda recusa posterior ao add limpa o indice', { timeout: 180000 }, async () =>
  fixture(async (f) => {
    const fonte = fs.readFileSync(path.resolve(__dirname, '../../src/mcp-git.ts'), 'utf8');
    assert.match(fonte, /git\(wt,\['commit','-m',p\.mensagem\]\);/);
    assert.doesNotMatch(fonte, /git\(wt,\['commit','-m',p\.mensagem,'--',\.\.\.p\.paths\]\);/);
    f.verify();
    const arquivo = f.preparar();
    const original = fs.readFileSync(arquivo);
    const adulterado = JSON.parse(original.toString('utf8'));
    adulterado.commands = [{ name: 'ci', command: 'echo CONTEUDO-NAO-DERIVADO' }];
    const forjado = Buffer.from(JSON.stringify(adulterado, null, 2) + '\n');
    const apoio = fs.mkdtempSync(path.join(path.dirname(f.raiz), 'rm101-troca-'));
    const originalPath = path.join(apoio, 'original'), forjadoPath = path.join(apoio, 'forjado');
    fs.writeFileSync(originalPath, original);
    fs.writeFileSync(forjadoPath, forjado);
    let filho: ChildProcess | null = spawn(process.execPath, ['-e', TROCADOR, arquivo, originalPath, forjadoPath],
      { stdio: 'ignore' });
    let recusas = 0, sucessos = 0;
    try {
      for (let tentativa = 0; tentativa < 40; tentativa++) {
        const r = await commitMcp(f.raiz, f.pedido);
        if (!r.ok) {
          recusas++;
          assert.equal(f.git(['rev-parse', 'HEAD']).trim(), f.head);
          assert.equal(f.git(['diff', '--cached', '--name-only']).trim(), '');
          continue;
        }
        sucessos++;
        const blob = Buffer.from(f.git(['cat-file', 'blob', `${r.commit}:${f.bundle}`]));
        assert.equal(sha256(blob), sha256(original));
        assert.equal(r.artefatosDerivados?.[0]?.oid, oid(original));
        f.git(['reset', '-q', f.head]);
      }
    } finally {
      filho.kill('SIGKILL');
      filho = null;
      fs.rmSync(apoio, { recursive: true, force: true });
    }
    assert.equal(recusas + sucessos, 40);
    assert.ok(sucessos > 0);
    semEfeito(f);
  }));

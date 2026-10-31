/**
 * RM-059 (fatia F7, T7.1; DD4 do plano dos mods): `ork ship publicar` e `ork ship pista`.
 *
 * O remoto e um repositorio bare de verdade (o push e o `ls-remote` sao do git), e o `gh` e um falso injetado que guarda
 * os PRs na memoria e conta as chamadas. O GitHub do remoto e fixado pela opcao interna `forja`, porque o remoto bare
 * nao tem host. Os nomes comecam por "publicar:" ou "pista:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepararBundleCi } from '../src/ci';
import { adicionarClaim, anexarComando, retirarClaim } from '../src/claims';
import { tomarConducao } from '../src/conducao';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { comLocale } from '../src/locale';
import { ManifestoCarregado } from '../src/manifest';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { shaNoRemoto } from '../src/ship';
import { comandoDoDono, linhasDaPublicacao, pistaDeEntrega, Publicacao, publicarEntrega, tituloDoPr } from '../src/ship-publicar';
import { dirThread, novaThread } from '../src/thread';
import { Modo } from '../src/types';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { commitar, dirTemporario, envPtBr, projetoTemporario, ProjetoDeTeste, shaNoRemotoDeTeste } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const FORJA = { host: 'github.com', repositorio: 'acme/app' };

interface PrFalso {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  checks: unknown[];
  mergedAt: string | null;
}

/** O `gh` falso: `pr list` filtra pela branch e pelo estado; `pr create` abre o PR na ponta que o remoto tem. */
function ghFalso(p: ProjetoDeTeste, opcoes: { listaFalha?: boolean; criaMasFalha?: boolean } = {}) {
  const prs: PrFalso[] = [];
  const chamadas: string[][] = [];
  // O corpo do PR vai por `--body-file` e o arquivo some depois da chamada: guarda o texto lido na hora.
  const corpos: string[] = [];
  const opcao = (args: readonly string[], nome: string) => args.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
  const executor: ExecutorDoGh = (args) => {
    chamadas.push([...args]);
    if (args[0] === 'pr' && args[1] === 'list') {
      if (opcoes.listaFalha) return { status: 1, stdout: '', stderr: 'HTTP 502: gateway' };
      const head = opcao(args, 'head'), estado = opcao(args, 'state');
      const lista = prs.filter((x) => (!head || x.headRefName === head) && (estado !== 'open' || x.state === 'OPEN')).map((x) => ({
        number: x.number, state: x.state, headRefName: x.headRefName, headRefOid: x.headRefOid, baseRefName: x.baseRefName,
        isDraft: x.isDraft, isCrossRepository: false, url: `https://github.com/acme/app/pull/${x.number}`, createdAt: '2026-10-12T10:00:00Z',
        mergedAt: x.mergedAt, mergeable: x.mergeable, statusCheckRollup: x.checks,
      }));
      return { status: 0, stdout: JSON.stringify(lista), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      const arquivoDoCorpo = args[args.indexOf('--body-file') + 1];
      if (args.includes('--body-file') && fs.existsSync(arquivoDoCorpo)) corpos.push(fs.readFileSync(arquivoDoCorpo, 'utf8'));
      const head = opcao(args, 'head') ?? '', base = opcao(args, 'base') ?? '';
      if (prs.some((x) => x.headRefName === head && x.state === 'OPEN')) {
        return { status: 1, stdout: '', stderr: `a pull request for branch "${head}" into branch "${base}" already exists` };
      }
      const numero = 100 + prs.length + 1;
      prs.push({ number: numero, state: 'OPEN', headRefName: head, headRefOid: shaNoRemotoDeTeste(p.dir, 'origin', head), baseRefName: base,
        isDraft: false, mergeable: 'MERGEABLE', checks: [], mergedAt: null });
      if (opcoes.criaMasFalha) return { status: 1, stdout: '', stderr: 'GraphQL: was submitted too quickly' };
      return { status: 0, stdout: `https://github.com/acme/app/pull/${numero}\n`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `gh falso: ${args.join(' ')}` };
  };
  const criacoes = () => chamadas.filter((c) => c[0] === 'pr' && c[1] === 'create').length;
  return { prs, chamadas, corpos, executor, criacoes };
}

interface Entrega { id: string; branch: string }

/**
 * Uma thread pronta para publicar: o commit de produto na branch dela, o verify verde nele, o bundle commitado como
 * `ci(<thread>)` e o CHECK com PASSOU depois do commit. Cada parte pode faltar, para os casos de recusa.
 */
function prepararEntrega(p: ProjetoDeTeste, nome: string, modo: Modo,
  opcoes: { semVerify?: boolean; verifyReprovado?: boolean; semBundle?: boolean; comClaim?: boolean; check?: 'ausente' | 'velho' | string;
    carregado?: ManifestoCarregado } = {}): Entrega {
  const { thread } = novaThread(p.carregado, { nome, modo });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
  const produto = commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  const dir = dirThread(p.dir, thread.id);
  if (!opcoes.semVerify) {
    registrar(dir, thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: opcoes.verifyReprovado ? 'reprovado' : 'verdade sustentada',
      motivos: opcoes.verifyReprovado ? ['claims.failed'] : [] });
  }
  if (opcoes.comClaim) {
    adicionarClaim(p.dir, thread.id, { arquivo: `${nome}.txt`, alegacao: 'existe', verificar: [`test -f '${nome}.txt'`], semProvaLocal: true });
  }
  if (!opcoes.semBundle) {
    const arquivo = prepararBundleCi(opcoes.carregado ?? p.carregado, thread.id);
    exec('git', ['add', '--', path.relative(p.dir, arquivo)], p.dir);
    exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle`], p.dir);
  }
  exec('git', ['checkout', '-q', 'main'], p.dir);
  if (opcoes.check !== 'ausente') escreverCheck(p, thread.id, opcoes.check === 'velho' ? 'PASSOU' : opcoes.check ?? 'PASSOU', opcoes.check === 'velho');
  return { id: thread.id, branch };
}

/** O `docs/check.md` com o veredito, gravado depois do ultimo commit (ou, `velho`, muito antes dele). */
function escreverCheck(p: ProjetoDeTeste, id: string, veredito: string, velho = false): void {
  const doc = path.join(dirThread(p.dir, id), 'docs', 'check.md');
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, `# CHECK\n\nVeredito: ${veredito}\n`);
  const quando = velho ? new Date('2020-01-01T00:00:00Z') : new Date(Date.now() + 5000);
  fs.utimesSync(doc, quando, quando);
}

const publicados = (p: ProjetoDeTeste, id: string) => lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.shipPublicado);

/** O ambiente do git com a hora do autor e do commit fixada (segundos da epoca). */
const comHora = (segundos: number): NodeJS.ProcessEnv =>
  ({ ...process.env, GIT_AUTHOR_DATE: `@${segundos} +0000`, GIT_COMMITTER_DATE: `@${segundos} +0000` });

/** Commit com a hora fixada: o CHECK cai antes ou depois dele sem depender do relogio do teste. */
function commitarEm(dir: string, arquivo: string, conteudo: string, mensagem: string, segundos: number): string {
  const destino = path.join(dir, arquivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
  exec('git', ['add', '--', arquivo], dir);
  assert.equal(exec('git', ['commit', '-q', '-m', mensagem], dir, 60000, comHora(segundos)).ok, true, mensagem);
  return exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
}

/** O CHECK com PASSOU gravado numa hora fixada (segundos da epoca). */
function escreverCheckEm(p: ProjetoDeTeste, id: string, segundos: number): void {
  escreverCheck(p, id, 'PASSOU');
  fs.utimesSync(path.join(dirThread(p.dir, id), 'docs', 'check.md'), segundos, segundos);
}

/** Uma thread #Auto com o produto em t0, o verify verde nele e o bundle commitado em t0 + 10; sem o CHECK. */
function entregaEm(p: ProjetoDeTeste, nome: string, t0: number): Entrega & { produto: string } {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
  const produto = commitarEm(p.dir, `${thread.id}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`, t0);
  registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: 'verdade sustentada', motivos: [] });
  const bundle = path.relative(p.dir, prepararBundleCi(p.carregado, thread.id));
  exec('git', ['add', '--', bundle], p.dir);
  assert.equal(exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle`], p.dir, 60000, comHora(t0 + 10)).ok, true);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  return { id: thread.id, branch, produto };
}

/** Um clone a parte cria a branch no remoto a partir da main, com um commit que a copia local nao tem. */
function avancarNoRemoto(p: ProjetoDeTeste, branch: string, sufixo: string): string {
  const clone = path.join(path.dirname(p.dir), `${path.basename(p.dir)}-${sufixo}`);
  assert.equal(exec('git', ['clone', '-q', p.remoto!, clone]).ok, true);
  try {
    exec('git', ['config', 'user.email', 'teste@orkastery.local'], clone);
    exec('git', ['config', 'user.name', 'Teste Orkastery'], clone);
    exec('git', ['checkout', '-q', '-b', branch], clone);
    // O conteudo leva o sufixo: dois clones no mesmo segundo fariam o mesmo commit, com o mesmo sha.
    const sha = commitar(clone, `outro-${sufixo}.txt`, `outro ${sufixo}\n`, `feat: de outro lugar (${sufixo})`);
    assert.equal(exec('git', ['push', '-q', 'origin', branch], clone).ok, true);
    return sha;
  } finally { fs.rmSync(clone, { recursive: true, force: true }); }
}

test('publicar: em #Auto e #Maestro publica a branch, prova pelo ls-remote, abre o PR e grava ship_published', () => {
  const p = projetoTemporario('publicar-ok', true);
  try {
    for (const modo of ['auto', 'maestro'] as const) {
      const gh = ghFalso(p);
      const e = prepararEntrega(p, `pronta ${modo}`, modo);
      const head = exec('git', ['rev-parse', e.branch], p.dir).stdout.trim();
      const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
      assert.equal(r.acao, 'publicou', `${modo}: ${r.detalhe} ${r.correcao}`);
      assert.equal(r.contrato, 'ork.ship-publicar/v1');
      assert.equal(r.head, head);
      assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), head, 'o remoto bare tem o HEAD');
      assert.equal(r.remota, head);
      assert.equal(r.pushVerificado, true);
      assert.equal(r.remotaAntes, null);
      assert.equal(r.pr?.criado, true);
      assert.equal(r.pr?.head, head, 'o head do PR na releitura (S10)');
      assert.equal(gh.criacoes(), 1);
      const criacao = gh.chamadas.find((c) => c[1] === 'create')!;
      assert.ok(criacao.includes(`--head=${e.branch}`) && criacao.includes('--base=main'), criacao.join(' '));
      assert.ok(criacao.some((a) => a.startsWith(`--title=ship(${e.id}): `)), 'o titulo comeca por ship(<thread>)');
      assert.ok(criacao.includes('--body-file') && gh.corpos.length === 1 && gh.corpos[0].length > 0, 'sem pr-body.md, o corpo padrao, por arquivo');
      const ev = publicados(p, e.id);
      assert.equal(ev.length, 1);
      assert.equal(ev[0].pushVerificado, true);
      assert.equal(ev[0].shaRemoto, head);
      assert.equal(ev[0].fonteDaProva, `git ls-remote origin refs/heads/${e.branch}`);
      assert.equal(ev[0].tipoDeAutorizacao, 'modo');
      assert.deepEqual(ev[0].pr, { numero: r.pr?.numero, url: `https://github.com/acme/app/pull/${r.pr?.numero}`, criado: true, head });
    }
  } finally { p.limpar(); }
});

test('publicar: fora de #Auto e #Maestro recusa com human.pending, sem push, sem PR e sem evento', () => {
  const p = projetoTemporario('publicar-modo', true);
  try {
    for (const modo of ['classic', 'fast'] as const) {
      const gh = ghFalso(p);
      const e = prepararEntrega(p, `modo ${modo}`, modo);
      const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
      assert.equal(r.acao, 'recusada');
      assert.equal(r.motivo, 'human.pending');
      assert.match(r.detalhe, /pede a autorização do dono para o push/);
      assert.ok(r.correcao.includes(`git push -u 'origin' '${e.branch}' && gh pr create --base 'main' --head '${e.branch}'`), r.correcao);
      assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', 'nada foi empurrado');
      assert.equal(gh.chamadas.length, 0, 'nem a lista de PRs foi lida');
      assert.equal(publicados(p, e.id).length, 0);
      assert.equal(lerLedger(dirThread(p.dir, e.id)).some((x) => x.tipo === 'ship_blocked' || x.tipo === 'gate_blocked'), false,
        'a recusa nao grava nada (D2)');
    }
  } finally { p.limpar(); }
});

test('publicar: repetido responde ja-publicada sem outro PR; commit novo empurra e reaproveita o PR aberto', () => {
  const p = projetoTemporario('publicar-idempotente', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'idempotente', 'auto');
    const primeiro = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(primeiro.acao, 'publicou', primeiro.detalhe);
    const segundo = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(segundo.acao, 'ja-publicada', segundo.detalhe);
    assert.equal(segundo.pr?.numero, primeiro.pr?.numero);
    assert.equal(segundo.pr?.criado, false);
    assert.equal(segundo.pr?.head, primeiro.head, 'o head do PR aberto tambem no ja-publicada (S12)');
    assert.equal(gh.criacoes(), 1, 'um PR so');
    assert.equal(publicados(p, e.id).length, 1, 'sem efeito, sem evento');

    // Um commit novo na branch, com o verify verde nele e o CHECK depois dele.
    exec('git', ['checkout', '-q', e.branch], p.dir);
    const novo = commitar(p.dir, 'mais.txt', 'mais\n', `fix(${e.id}): mais`);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    registrar(dirThread(p.dir, e.id), e.id, TIPOS_DE_EVENTO.verificacao, { commit: novo, veredito: 'verdade sustentada', motivos: [] });
    escreverCheck(p, e.id, 'PASSOU');
    const terceiro = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(terceiro.acao, 'publicou', terceiro.detalhe);
    assert.equal(terceiro.remotaAntes, primeiro.head);
    assert.equal(terceiro.remota, novo);
    assert.equal(terceiro.pr?.numero, primeiro.pr?.numero);
    assert.equal(terceiro.pr?.criado, false, 'o PR aberto foi reaproveitado');
    assert.equal(gh.criacoes(), 1);
    const ev = publicados(p, e.id);
    assert.equal(ev.length, 2);
    assert.equal(ev[1].pushFeito, true);
    assert.equal((ev[1].pr as { criado?: boolean }).criado, false);
  } finally { p.limpar(); }
});

test('publicar: o ensaio confere tudo e nao empurra, nao cria PR e nao grava nada', () => {
  const p = projetoTemporario('publicar-ensaio', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'ensaio', 'auto');
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA, dryRun: true });
    assert.equal(r.acao, 'publicaria', r.detalhe);
    assert.equal(r.dryRun, true);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '');
    assert.equal(gh.criacoes(), 0);
    assert.equal(publicados(p, e.id).length, 0);
    assert.ok(r.passos.some((x) => x.startsWith('gh pr create')), r.passos.join(' | '));
  } finally { p.limpar(); }
});

test('publicar: CHECK, verify, bundle, conducao e produto que faltam viram recusa tipada, antes de qualquer efeito', () => {
  const p = projetoTemporario('publicar-conferencias', true);
  try {
    const casos: Array<[string, Parameters<typeof prepararEntrega>[3], string, RegExp]> = [
      ['sem check', { check: 'ausente' }, 'artifact.missing', /check\.md da thread ainda não foi gravado/],
      ['check outro', { check: 'PRECISA DE MUDANÇA' }, 'artifact.missing', /veredito do CHECK é PRECISA DE MUDANCA/],
      ['check velho', { check: 'velho' }, 'artifact.missing', /anterior ao commit/],
      ['sem verify', { semVerify: true }, 'verify.failed', /nenhum ork verify/],
      ['verify reprovado', { verifyReprovado: true }, 'verify.failed', /reprovou no commit .* \(claims\.failed\)/],
      ['sem bundle', { semBundle: true }, 'artifact.missing', /não está no HEAD/],
    ];
    for (const [nome, opcoes, motivo, detalhe] of casos) {
      const gh = ghFalso(p);
      const e = prepararEntrega(p, nome, 'auto', opcoes);
      const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
      assert.equal(r.acao, 'recusada', nome);
      assert.equal(r.motivo, motivo, nome);
      assert.match(r.detalhe, detalhe, nome);
      assert.ok(r.correcao.length > 0, nome);
      assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', nome);
      assert.equal(gh.chamadas.length, 0, nome);
      assert.equal(publicados(p, e.id).length, 0, nome);
    }

    // Bundle velho: uma claim registrada depois dele.
    const velho = prepararEntrega(p, 'bundle velho', 'auto');
    adicionarClaim(p.dir, velho.id, { arquivo: 'bundle-velho.txt', alegacao: 'existe', verificar: ['test -f bundle-velho.txt'], semProvaLocal: true });
    const rv = publicarEntrega(p.carregado, velho.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(rv.motivo, 'artifact.missing');
    assert.match(rv.detalhe, /está velho: faltam as claims C1/);

    // Thread conduzida agora.
    const conduzida = prepararEntrega(p, 'conduzida', 'auto');
    tomarConducao(p.dir, conduzida.id, { canal: 'cli', operacao: 'verify', prazoMs: 60_000 });
    const rc = publicarEntrega(p.carregado, conduzida.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(rc.motivo, 'conducao.em-andamento');

    // Branch sem produto.
    const { thread: vazia } = novaThread(p.carregado, { nome: 'vazia', modo: 'auto' });
    exec('git', ['branch', branchDaWorktree(vazia), 'main'], p.dir);
    escreverCheck(p, vazia.id, 'PASSOU');
    const rs = publicarEntrega(p.carregado, vazia.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(rs.motivo, 'artifact.missing');
    assert.match(rs.detalhe, /não tem commit fora de main/);
  } finally { p.limpar(); }
});

test('publicar: remoto que divergiu recusa com tree.blocked sem tentar o push, e o push sem a ponta no remoto vai ao ledger', () => {
  const p = projetoTemporario('publicar-remoto', true);
  try {
    // O remoto com um commit na branch que a local nao tem, ja trazido pelo fetch.
    const e = prepararEntrega(p, 'divergiu', 'auto');
    avancarNoRemoto(p, e.branch, 'clone1');
    const remotoAntes = shaNoRemotoDeTeste(p.dir, 'origin', e.branch);
    exec('git', ['fetch', '-q', 'origin'], p.dir);
    const gh = ghFalso(p);
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.motivo, 'tree.blocked');
    assert.match(r.correcao, /nunca force/);
    assert.ok(!r.passos.some((x) => x.startsWith('git push')), `a divergencia e conferida antes do push: ${r.passos.join(' | ')}`);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), remotoAntes, 'o remoto ficou como estava');
    assert.equal(gh.criacoes(), 0);

    // A3: o remoto andou e esta copia nem tem o commit dele (sem fetch). Tambem divergiu: o ensaio e o real recusam sem
    // tentar o push, e a pista mostra a branch falhando, sem botao.
    const semFetch = prepararEntrega(p, 'sem fetch', 'auto');
    const alheio = avancarNoRemoto(p, semFetch.branch, 'clone2');
    assert.equal(exec('git', ['cat-file', '-e', `${alheio}^{commit}`], p.dir).ok, false, 'a copia local nao tem o commit do remoto');
    for (const dryRun of [true, false]) {
      const rs = publicarEntrega(p.carregado, semFetch.id, { executorGh: ghFalso(p).executor, forja: FORJA, dryRun });
      assert.equal(rs.acao, 'recusada', `dryRun ${dryRun}: ${rs.detalhe}`);
      assert.equal(rs.motivo, 'tree.blocked');
      assert.ok(!rs.passos.some((x) => x.startsWith('git push')), rs.passos.join(' | '));
    }
    const pista = pistaDeEntrega(p.carregado, { executorGh: ghFalso(p).executor, forja: FORJA, thread: semFetch.id }).pistas[0];
    assert.equal(pista.etapas.find((x) => x.id === 'branch')?.estado, 'falhou');
    assert.equal(pista.proximo.acao, null);

    // O remoto que aceita o push e desfaz a ref no gancho: o codigo de saida diz ok, o ls-remote nao. O push aconteceu,
    // entao a tentativa vai ao ledger, sem prova (B1 da revisao).
    const gancho = path.join(p.remoto!, 'hooks', 'post-receive');
    fs.writeFileSync(gancho, '#!/bin/sh\nwhile read velho novo ref; do git update-ref -d "$ref"; done\n', { mode: 0o755 });
    const sumiu = prepararEntrega(p, 'sem prova', 'auto');
    const rp = publicarEntrega(p.carregado, sumiu.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(rp.acao, 'recusada');
    assert.equal(rp.motivo, 'runtime.unavailable');
    assert.equal(rp.pushVerificado, false);
    assert.match(rp.detalhe, /não ficou provado/);
    const ev = publicados(p, sumiu.id);
    assert.equal(ev.length, 1, 'o push que aconteceu vai ao ledger, mesmo sem prova');
    assert.equal(ev[0].pushFeito, true);
    assert.equal(ev[0].pushVerificado, false);
    assert.equal(ev[0].pr, null);
    fs.rmSync(gancho);
  } finally { p.limpar(); }
});

test('publicar: sem GitHub no remoto ou com a lista de PRs falhando, recusa antes do push', () => {
  const p = projetoTemporario('publicar-forja', true);
  try {
    const e = prepararEntrega(p, 'sem forja', 'auto');
    const r = publicarEntrega(p.carregado, e.id, { executorGh: ghFalso(p).executor });
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.match(r.detalhe, /não é um repositório do GitHub/);
    const falha = ghFalso(p, { listaFalha: true });
    const rf = publicarEntrega(p.carregado, e.id, { executorGh: falha.executor, forja: FORJA });
    assert.equal(rf.motivo, 'runtime.unavailable');
    assert.match(rf.detalhe, /lista de PRs da branch falhou: HTTP 502/);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', 'sem a lista, nada foi empurrado');
    // S6: o stderr do gh passa pela redacao antes do JSON e do ledger.
    const segredo = 'ghp_SEGREDOdeTESTE0123456789';
    const vazador: ExecutorDoGh = () => ({ status: 1, stdout: '', stderr: `HTTP 401 em https://x-access-token:${segredo}@github.com/acme/app e token=${segredo}` });
    const rv = publicarEntrega(p.carregado, e.id, { executorGh: vazador, forja: FORJA });
    assert.equal(rv.motivo, 'runtime.unavailable');
    assert.match(rv.detalhe, /HTTP 401/);
    assert.ok(!JSON.stringify(rv).includes(segredo), rv.detalhe);
  } finally { p.limpar(); }
});

test('publicar: a criacao que falha mas deixa o PR aberto e reaproveitada pela releitura', () => {
  const p = projetoTemporario('publicar-corrida', true);
  try {
    const gh = ghFalso(p, { criaMasFalha: true });
    const e = prepararEntrega(p, 'corrida', 'auto');
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.acao, 'publicou', r.detalhe);
    assert.equal(r.pr?.criado, false, 'a criacao saiu com erro; o PR veio da releitura');
    assert.equal(publicados(p, e.id).length, 1);
  } finally { p.limpar(); }
});

test('publicar: o titulo do PR vem do primeiro cabecalho do pr-body.md, e o corpo vai como o texto lido, por arquivo temporario', () => {
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'x' }, '## RM-1, a coisa\n\ntexto'), 'ship(ork-x): RM-1, a coisa');
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'nome da thread' }, 'texto sem cabecalho\n# depois'), 'ship(ork-x): nome da thread');
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'x' }, '# ship(ork-x): ja pronto'), 'ship(ork-x): ja pronto');
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'x' }, null), 'ship(ork-x): x');
  const p = projetoTemporario('publicar-corpo', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'com corpo', 'auto');
    const corpo = path.join(dirThread(p.dir, e.id), 'pr-body.md');
    fs.writeFileSync(corpo, '## RM-059, a pista\n\nCorpo do PR.\n');
    // A5 da revisao: o pr-body.md trocado por um link depois da leitura nao muda o que o gh recebe.
    const segredo = path.join(p.dir, 'segredo.txt');
    fs.writeFileSync(segredo, 'TOKEN-DE-MENTIRA\n');
    const executor: ExecutorDoGh = (args, prazo) => {
      if (args[1] === 'list') { fs.rmSync(corpo, { force: true }); fs.symlinkSync(segredo, corpo); }
      return gh.executor(args, prazo);
    };
    const r = publicarEntrega(p.carregado, e.id, { executorGh: executor, forja: FORJA });
    assert.equal(r.acao, 'publicou', r.detalhe);
    assert.equal(r.corpo, 'pr-body.md');
    const criacao = gh.chamadas.find((c) => c[1] === 'create')!;
    assert.ok(criacao.includes(`--title=ship(${e.id}): RM-059, a pista`), criacao.join(' '));
    assert.deepEqual(gh.corpos, ['## RM-059, a pista\n\nCorpo do PR.\n']);
    assert.ok(!criacao.some((a) => a.startsWith('--body=') || a.includes('TOKEN-DE-MENTIRA')), criacao.join(' '));
    // O corpo com NUL nao passa como argumento: vale o corpo padrao, e o titulo vem do nome da thread.
    const nul = prepararEntrega(p, 'corpo com nul', 'auto');
    fs.writeFileSync(path.join(dirThread(p.dir, nul.id), 'pr-body.md'), '## titulo\n\ncom NUL \0 no meio\n');
    const gh2 = ghFalso(p);
    const rn = publicarEntrega(p.carregado, nul.id, { executorGh: gh2.executor, forja: FORJA });
    assert.equal(rn.acao, 'publicou', rn.detalhe);
    assert.equal(rn.corpo, 'padrao');
    const criacaoNul = gh2.chamadas.find((c) => c[1] === 'create')!;
    assert.ok(criacaoNul.every((a) => !a.includes('\0') && !a.includes('com NUL')), criacaoNul.join(' '));
    assert.ok(criacaoNul.includes(`--title=ship(${nul.id}): corpo com nul`), criacaoNul.join(' '));
  } finally { p.limpar(); }
});

test('publicar: a CLI recusa --autorizar-push com saida 2 e devolve a recusa do modo em --json', () => {
  const p = projetoTemporario('publicar-cli', true);
  try {
    const e = prepararEntrega(p, 'cli', 'classic');
    const env = envPtBr();
    delete env.ORK_PROJETO;
    delete env.ORK_PROJETO_EXPLICITO;
    const rodar = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: p.dir, env, encoding: 'utf8' });
    const comFlag = rodar('ship', 'publicar', e.id, '--autorizar-push', 'eu');
    assert.equal(comFlag.status, 2, comFlag.stderr);
    assert.match(comFlag.stderr, /não aceita --autorizar-push/);
    const semThread = rodar('ship', 'publicar');
    assert.equal(semThread.status, 2);
    assert.match(semThread.stderr, /uso: ork ship publicar/);
    const json = rodar('ship', 'publicar', e.id, '--json');
    assert.equal(json.status, 1, json.stderr);
    const r = JSON.parse(json.stdout);
    assert.equal(r.contrato, 'ork.ship-publicar/v1');
    assert.equal(r.acao, 'recusada');
    assert.equal(r.motivo, 'human.pending');
    const inexistente = rodar('ship', 'publicar', 'ork-nao-existe', '--json');
    assert.equal(inexistente.status, 1, inexistente.stderr);
    const ri = JSON.parse(inexistente.stdout);
    assert.equal(ri.contrato, 'ork.ship-publicar/v1');
    assert.equal(ri.acao, 'recusada');
    assert.equal(ri.motivo, 'artifact.missing');
    const texto = rodar('ship', 'publicar', e.id);
    assert.equal(texto.status, 1);
    assert.match(texto.stdout, /BLOQUEADO\. motivo tipado: human\.pending/);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '');
  } finally { p.limpar(); }
});

/** O manifesto com o CI exigido no SHIP, como no projeto real. */
const comCiExigido = (c: ManifestoCarregado): ManifestoCarregado =>
  ({ ...c, manifesto: { ...c.manifesto, ci: { ...c.manifesto.ci, required_for_ship: true } } });

const checkDoCi = (status: string, conclusion: string | null) => ({
  __typename: 'CheckRun', name: 'ork-verify', workflowName: 'ci', status, conclusion,
  startedAt: '2026-10-12T10:01:00Z', completedAt: conclusion ? '2026-10-12T10:09:00Z' : null,
  detailsUrl: 'https://github.com/acme/app/actions/runs/7/job/8',
});

test('pista: as etapas e o proximo passo de cada entrega, com o botao so onde o nucleo declara', () => {
  const p = projetoTemporario('pista', true);
  try {
    const gh = ghFalso(p);
    const carregado = comCiExigido(p.carregado);
    const pronta = prepararEntrega(p, 'pronta', 'auto');
    const classic = prepararEntrega(p, 'classica', 'classic');
    const esperando = prepararEntrega(p, 'esperando', 'auto');
    const vermelha = prepararEntrega(p, 'vermelha', 'auto');
    const conflito = prepararEntrega(p, 'conflito', 'auto');
    const mesclada = prepararEntrega(p, 'mesclada', 'auto');
    const emGo = prepararEntrega(p, 'em go', 'auto', { check: 'ausente' });
    for (const e of [esperando, vermelha, conflito, mesclada]) {
      assert.equal(publicarEntrega(carregado, e.id, { executorGh: gh.executor, forja: FORJA }).acao, 'publicou', e.id);
    }
    const prDe = (e: Entrega) => gh.prs.find((x) => x.headRefName === e.branch)!;
    prDe(esperando).checks = [checkDoCi('IN_PROGRESS', null)];
    prDe(vermelha).checks = [checkDoCi('COMPLETED', 'FAILURE')];
    prDe(conflito).checks = [checkDoCi('COMPLETED', 'SUCCESS')];
    prDe(conflito).mergeable = 'CONFLICTING';
    Object.assign(prDe(mesclada), { state: 'MERGED', mergedAt: '2026-10-12T11:00:00Z' });

    const r = pistaDeEntrega(carregado, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.contrato, 'ork.ship-pista/v1');
    assert.equal(r.remotoLido, true);
    assert.equal(r.prsLidos, true);
    assert.equal(r.ciExigido, true);
    const de = (e: Entrega) => r.pistas.find((x) => x.thread === e.id);
    assert.equal(de(emGo), undefined, 'sem CHECK e sem publicar, a thread ainda nao esta na entrega');
    for (const x of r.pistas) assert.deepEqual(x.etapas.map((e) => e.id), ['check', 'verify', 'bundle', 'branch', 'pr', 'ci', 'conflito', 'entrega']);

    const a = de(pronta)!;
    assert.deepEqual(a.proximo, { acao: 'publicar', disponivel: true, texto: 'publique a branch e abra o PR', comando: `ork ship publicar ${pronta.id}` });
    assert.deepEqual(a.etapas.map((e) => e.estado), ['feita', 'feita', 'feita', 'pendente', 'pendente', 'pendente', 'nao-se-aplica', 'pendente']);

    const b = de(classic)!;
    assert.equal(b.publicavel, false);
    assert.equal(b.proximo.acao, 'publicar');
    assert.equal(b.proximo.disponivel, false, 'fora de #Auto e #Maestro, nenhum botao');
    assert.ok((b.proximo.comando ?? '').startsWith(`git push -u 'origin' '${classic.branch}' && gh pr create`), b.proximo.comando ?? '');

    const c = de(esperando)!;
    assert.equal(c.pr?.estado, 'aberto');
    assert.equal(c.etapas.find((e) => e.id === 'ci')?.estado, 'pendente');
    assert.equal(c.etapas.find((e) => e.id === 'conflito')?.estado, 'feita');
    assert.equal(c.proximo.acao, null);
    assert.equal(c.proximo.texto, `esperando o check ork-verify no PR #${c.pr?.numero}`);
    assert.equal(c.proximo.comando, `ork ci status --sha ${c.pr?.head}`);

    const d = de(vermelha)!;
    assert.equal(d.etapas.find((e) => e.id === 'ci')?.estado, 'falhou');
    assert.match(d.proximo.texto, /vermelho no PR/);

    const g = de(conflito)!;
    assert.equal(g.etapas.find((e) => e.id === 'conflito')?.estado, 'falhou');
    assert.match(g.proximo.texto, /conflita com a base/);
    assert.equal(g.proximo.acao, null);

    const m = de(mesclada)!;
    assert.deepEqual(m.proximo, { acao: 'registrar', disponivel: true, texto: 'mesclado na base: registre a entrega',
      comando: `ork ship registrar-pr ${mesclada.id}` });

    const so = pistaDeEntrega(carregado, { executorGh: gh.executor, forja: FORJA, thread: pronta.id });
    assert.deepEqual(so.pistas.map((x) => x.thread), [pronta.id]);
  } finally { p.limpar(); }
});

test('pista: sem a forja, PR, CI e conflito ficam sem leitura, e o publicar segue disponivel para a branch nao publicada', () => {
  const p = projetoTemporario('pista-sem-forja', true);
  try {
    const e = prepararEntrega(p, 'sem forja', 'auto');
    const r = pistaDeEntrega(p.carregado, { executorGh: ghFalso(p, { listaFalha: true }).executor, forja: FORJA });
    assert.equal(r.prsLidos, false);
    assert.match(r.prsNaoLidos ?? '', /HTTP 502/);
    const x = r.pistas.find((y) => y.thread === e.id)!;
    assert.deepEqual(x.etapas.filter((y) => ['pr', 'ci', 'conflito'].includes(y.id)).map((y) => y.estado), ['nao-lida', 'nao-lida', 'nao-lida']);
    assert.equal(x.proximo.acao, 'publicar');
  } finally { p.limpar(); }
});

test('publicar: o push leva o sha conferido; o commit que chega a branch depois das conferencias fica fora (B1)', () => {
  const p = projetoTemporario('publicar-commit-tardio', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'commit tardio', 'auto');
    const conferido = exec('git', ['rev-parse', e.branch], p.dir).stdout.trim();
    let tardio = '';
    // A janela: o primeiro gh pr list, depois das conferencias e antes do push. Um commit chega a branch nela.
    const executor: ExecutorDoGh = (args, prazo) => {
      if (!tardio && args[1] === 'list') {
        exec('git', ['checkout', '-q', e.branch], p.dir);
        tardio = commitar(p.dir, 'tardio.txt', 'tardio\n', `fix(${e.id}): chegou depois`);
        exec('git', ['checkout', '-q', 'main'], p.dir);
      }
      return gh.executor(args, prazo);
    };
    const r = publicarEntrega(p.carregado, e.id, { executorGh: executor, forja: FORJA });
    assert.equal(r.acao, 'publicou', r.detalhe);
    assert.equal(r.head, conferido);
    assert.ok(tardio && tardio !== conferido);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), conferido, 'o remoto ficou no sha conferido, sem o commit tardio');
    assert.ok(r.passos.includes(`git push -- origin ${conferido}:refs/heads/${e.branch}`), r.passos.join(' | '));
    assert.equal(gh.prs[0].headRefOid, conferido, 'o PR nasceu no sha conferido');
    const ev = publicados(p, e.id);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].head, conferido);
    // A pista ve o commit tardio: o verify dele ainda nao rodou, e o proximo passo e o verify, nao outro push.
    const x = pistaDeEntrega(p.carregado, { executorGh: gh.executor, forja: FORJA, thread: e.id }).pistas[0];
    assert.equal(x.head, tardio);
    assert.equal(x.proximo.comando, `ork verify ${e.id}`);
  } finally { p.limpar(); }
});

test('publicar: commit de produto e o que muda produto; so o bundle em .ork-ci e o merge da base nao contam (A6, B2, S1, S2)', () => {
  const p = projetoTemporario('publicar-conferencias-finas', true);
  try {
    const t0 = Math.floor(Date.now() / 1000) - 1000;
    const ensaio = (id: string, c: ManifestoCarregado = p.carregado) =>
      publicarEntrega(c, id, { executorGh: ghFalso(p).executor, forja: FORJA, dryRun: true });

    // A6: um commit de workflow com assunto ci( depois do CHECK e produto, e o CHECK fica velho.
    const workflow = entregaEm(p, 'workflow', t0);
    escreverCheckEm(p, workflow.id, t0 + 20);
    exec('git', ['checkout', '-q', workflow.branch], p.dir);
    const doWorkflow = commitarEm(p.dir, '.github/workflows/ci.yml', 'on: push\n', `ci(${workflow.id}): workflow novo`, t0 + 30);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    const rw = ensaio(workflow.id);
    assert.equal(rw.motivo, 'artifact.missing', rw.detalhe);
    assert.match(rw.detalhe, new RegExp(`anterior ao commit ${doWorkflow.slice(0, 7)}`));

    // So o bundle em .ork-ci, com qualquer assunto, depois do CHECK: nao e produto, e o CHECK e o verify continuam valendo.
    const soBundle = entregaEm(p, 'so bundle', t0);
    escreverCheckEm(p, soBundle.id, t0 + 20);
    exec('git', ['checkout', '-q', soBundle.branch], p.dir);
    commitarEm(p.dir, '.ork-ci/nota.txt', 'nota\n', `docs(${soBundle.id}): nota ao lado do bundle`, t0 + 30);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    const rb = ensaio(soBundle.id);
    assert.equal(rb.acao, 'publicaria', rb.detalhe);

    // B2 (a): o verify verde num ancestral, com um commit de produto depois dele, nao vale, nem com o CHECK novo.
    const ancestral = entregaEm(p, 'verify ancestral', t0);
    exec('git', ['checkout', '-q', ancestral.branch], p.dir);
    commitarEm(p.dir, 'mais.txt', 'mais\n', `fix(${ancestral.id}): mais`, t0 + 30);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    escreverCheckEm(p, ancestral.id, t0 + 40);
    const ra = ensaio(ancestral.id);
    assert.equal(ra.motivo, 'verify.failed', ra.detalhe);
    assert.match(ra.detalhe, /e o HEAD mudou depois dele além do bundle/);

    // B2 (b): o bundle com uma claim que foi retirada depois dele levaria a claim ao runner: recusa.
    const retirada = prepararEntrega(p, 'claim retirada', 'auto', { comClaim: true });
    retirarClaim(p.dir, retirada.id, 'C1', 'a alegacao mudou');
    const rr = ensaio(retirada.id);
    assert.equal(rr.motivo, 'artifact.missing', rr.detalhe);
    assert.match(rr.detalhe, /sobram as claims C1/);

    // O bundle de outra branch nao vale.
    const outra = prepararEntrega(p, 'outra branch', 'auto');
    exec('git', ['checkout', '-q', outra.branch], p.dir);
    const arquivo = `.ork-ci/${outra.id}.json`;
    const bundle = JSON.parse(fs.readFileSync(path.join(p.dir, arquivo), 'utf8')) as Record<string, unknown>;
    commitar(p.dir, arquivo, `${JSON.stringify({ ...bundle, branch: 'ork/outra-full' }, null, 2)}\n`, `ci(${outra.id}): bundle de outra branch`);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    escreverCheck(p, outra.id, 'PASSOU');
    const ro = ensaio(outra.id);
    assert.equal(ro.motivo, 'artifact.missing', ro.detalhe);
    assert.match(ro.detalhe, /é da branch ork\/outra-full/);

    // S2: com build no manifesto, o verify so de claims (sem os comandos) nao vale; com os comandos, vale.
    const comBuild: ManifestoCarregado = { ...p.carregado,
      manifesto: { ...p.carregado.manifesto, verify: { ...p.carregado.manifesto.verify, build: 'true' } } };
    const soClaims = prepararEntrega(p, 'so claims', 'auto', { carregado: comBuild });
    const rs = ensaio(soClaims.id, comBuild);
    assert.equal(rs.motivo, 'verify.failed', rs.detalhe);
    assert.match(rs.detalhe, /rodou só as claims/);
    registrar(dirThread(p.dir, soClaims.id), soClaims.id, TIPOS_DE_EVENTO.verificacao, {
      commit: exec('git', ['rev-parse', soClaims.branch], p.dir).stdout.trim(), veredito: 'verdade sustentada', motivos: [],
      comandos: [{ nome: 'build', ok: true, code: 0 }] });
    const rc = ensaio(soClaims.id, comBuild);
    assert.equal(rc.acao, 'publicaria', rc.detalhe);

    // A14 (rodada 2): a claim que mudou de comando sem mudar de id deixa o bundle velho; o runner rodaria o antigo.
    const anexada = prepararEntrega(p, 'claim anexada', 'auto', { comClaim: true });
    anexarComando(p.dir, anexada.id, 'C1', 'true');
    const rx = ensaio(anexada.id);
    assert.equal(rx.motivo, 'artifact.missing', rx.detalhe);
    assert.match(rx.detalhe, /o comando das claims C1 mudou depois dele/);
    // Os comandos do manifesto que o bundle leva tambem: o bundle gerado sem o build nao vale com o build no manifesto.
    const semBuild = prepararEntrega(p, 'manifesto novo', 'auto');
    registrar(dirThread(p.dir, semBuild.id), semBuild.id, TIPOS_DE_EVENTO.verificacao, {
      commit: exec('git', ['rev-parse', semBuild.branch], p.dir).stdout.trim(), veredito: 'verdade sustentada', motivos: [],
      comandos: [{ nome: 'build', ok: true, code: 0 }] });
    const ry = ensaio(semBuild.id, comBuild);
    assert.equal(ry.motivo, 'artifact.missing', ry.detalhe);
    assert.match(ry.detalhe, /os comandos de verify do manifesto mudaram depois dele/);

    // O merge da base na branch depois do CHECK nao e produto; o verify vai no HEAD do merge.
    const comMerge = entregaEm(p, 'com merge', t0);
    escreverCheckEm(p, comMerge.id, t0 + 20);
    commitarEm(p.dir, 'base.txt', 'a base andou\n', 'feat: a base andou', t0 + 25);
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
    exec('git', ['checkout', '-q', comMerge.branch], p.dir);
    assert.equal(exec('git', ['merge', '-q', '--no-ff', '-m', 'Merge main', 'main'], p.dir, 60000, comHora(t0 + 30)).ok, true);
    const doMerge = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
    exec('git', ['checkout', '-q', 'main'], p.dir);
    registrar(dirThread(p.dir, comMerge.id), comMerge.id, TIPOS_DE_EVENTO.verificacao, { commit: doMerge, veredito: 'verdade sustentada', motivos: [] });
    const rm = ensaio(comMerge.id);
    assert.equal(rm.acao, 'publicaria', rm.detalhe);

    // S1: a ref de sufixo igual no remoto nao engana a prova do push, nem no publicar nem no ork ship.
    const sufixo = prepararEntrega(p, 'sufixo', 'auto');
    const daMain = exec('git', ['rev-parse', 'main'], p.dir).stdout.trim();
    assert.equal(exec('git', ['update-ref', `refs/heads/a/refs/heads/${sufixo.branch}`, daMain], p.remoto!).ok, true);
    const real = publicarEntrega(p.carregado, sufixo.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(real.acao, 'publicou', real.detalhe);
    assert.equal(real.remotaAntes, null);
    assert.equal(real.pushVerificado, true);
    assert.equal(shaNoRemoto(p.dir, 'origin', sufixo.branch), exec('git', ['rev-parse', sufixo.branch], p.dir).stdout.trim());
  } finally { p.limpar(); }
});

test('publicar: a thread que nao existe e o remoto que falta voltam como recusa tipada, no contrato (S3)', () => {
  const p = projetoTemporario('publicar-sem-remoto', false);
  try {
    const r = publicarEntrega(p.carregado, 'ork-nao-existe', { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(r.contrato, 'ork.ship-publicar/v1');
    assert.equal(r.acao, 'recusada');
    assert.equal(r.motivo, 'artifact.missing');
    assert.match(r.detalhe, /a thread ork-nao-existe não foi lida/);
    const e = prepararEntrega(p, 'sem remoto', 'auto');
    const rs = publicarEntrega(p.carregado, e.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(rs.motivo, 'runtime.unavailable', rs.detalhe);
    assert.match(rs.detalhe, /o remoto origin não está configurado/);
  } finally { p.limpar(); }
});

test('publicar: com o PR ja mesclado no HEAD responde ja-publicada, mesmo com a branch apagada no remoto (A2)', () => {
  const p = projetoTemporario('publicar-mesclada', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'mesclada', 'auto');
    assert.equal(publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA }).acao, 'publicou');
    Object.assign(gh.prs[0], { state: 'MERGED', mergedAt: '2026-10-12T11:00:00Z' });
    // O GitHub apagou a branch depois do merge.
    assert.equal(exec('git', ['push', '-q', 'origin', '--delete', e.branch], p.dir).ok, true);
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.acao, 'ja-publicada', r.detalhe);
    assert.equal(r.pr?.numero, gh.prs[0].number);
    assert.match(r.correcao, /ork ship registrar-pr/);
    assert.ok(!r.passos.some((x) => x.startsWith('git push')), r.passos.join(' | '));
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', 'a branch nao foi recriada');
    assert.equal(gh.criacoes(), 1);
    assert.equal(publicados(p, e.id).length, 1);
  } finally { p.limpar(); }
});

test('publicar: a criacao que falha com a branch ja no remoto e o PR aberto na releitura responde ja-publicada (S7)', () => {
  const p = projetoTemporario('publicar-de-outro', true);
  try {
    const gh = ghFalso(p, { criaMasFalha: true });
    const e = prepararEntrega(p, 'de outro', 'auto');
    const head = exec('git', ['rev-parse', e.branch], p.dir).stdout.trim();
    assert.equal(exec('git', ['push', '-q', 'origin', `${e.branch}:refs/heads/${e.branch}`], p.dir).ok, true);
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.acao, 'ja-publicada', r.detalhe);
    assert.equal(r.pr?.criado, false);
    assert.equal(r.remota, head);
    assert.equal(publicados(p, e.id).length, 0, 'sem push e sem PR aberto por este processo, nada a gravar');
  } finally { p.limpar(); }
});

test('publicar: o comando do dono poe cada parte entre aspas simples, e nada dele vira comando no shell (A4)', () => {
  const dir = dirTemporario('comando-do-dono');
  const bashEnvAnterior = process.env.BASH_ENV;
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    for (const nome of ['git', 'gh']) {
      fs.writeFileSync(path.join(bin, nome), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done >> '${path.join(dir, `${nome}.args`)}'\n`, { mode: 0o755 });
    }
    const bashEnvCompartilhado = path.join(dir, 'ambiente-compartilhado.sh');
    fs.writeFileSync(bashEnvCompartilhado, 'PATH=/usr/bin:/bin\n');
    process.env.BASH_ENV = bashEnvCompartilhado;
    const branch = 'ork/x;touch${IFS}marcador-injetado;true';
    const base = 'main$(touch base-injetada)';
    const titulo = "ship(ork-x): o 'titulo' com $HOME, `crase` e barra \\";
    const comando = comandoDoDono('origin', base, branch, titulo, '.orkastery/threads/ork-x/pr-body.md');
    assert.equal(spawnSync('bash', ['-n', '-c', comando]).status, 0, `o shell le o comando inteiro: ${comando}`);
    const envDoCaso = {
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
    };
    const executar = [
      `git() { /bin/sh '${path.join(bin, 'git')}' "$@"; }`,
      `gh() { /bin/sh '${path.join(bin, 'gh')}' "$@"; }`,
      comando,
    ].join('\n');
    const r = spawnSync('bash', ['-c', executar], { cwd: dir, env: envDoCaso, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'marcador-injetado')), false, 'a branch nao virou comando');
    assert.equal(fs.existsSync(path.join(dir, 'base-injetada')), false, 'a base nao virou comando');
    const doGit = fs.readFileSync(path.join(dir, 'git.args'), 'utf8').split('\n');
    assert.deepEqual(doGit.slice(0, 4), ['push', '-u', 'origin', branch]);
    const doGh = fs.readFileSync(path.join(dir, 'gh.args'), 'utf8').split('\n');
    assert.ok(doGh.includes(titulo) && doGh.includes(base) && doGh.includes(branch), doGh.join(' | '));
    assert.ok(doGh.includes('.orkastery/threads/ork-x/pr-body.md'));
  } finally {
    if (bashEnvAnterior === undefined) delete process.env.BASH_ENV; else process.env.BASH_ENV = bashEnvAnterior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pista: o PR mesclado de outro head nao vale para a ponta nova, e a pista oferece publicar de novo (A1)', () => {
  const p = projetoTemporario('pista-segunda-entrega', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'segunda entrega', 'auto');
    assert.equal(publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA }).acao, 'publicou');
    Object.assign(gh.prs[0], { state: 'MERGED', mergedAt: '2026-10-12T11:00:00Z' });
    // A segunda entrega na mesma branch: um commit novo, verificado, com o CHECK depois dele e a branch no remoto.
    exec('git', ['checkout', '-q', e.branch], p.dir);
    const novo = commitar(p.dir, 'segunda.txt', 'segunda\n', `feat(${e.id}): segunda`);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    registrar(dirThread(p.dir, e.id), e.id, TIPOS_DE_EVENTO.verificacao, { commit: novo, veredito: 'verdade sustentada', motivos: [] });
    escreverCheck(p, e.id, 'PASSOU');
    assert.equal(exec('git', ['push', '-q', 'origin', `${e.branch}:refs/heads/${e.branch}`], p.dir).ok, true);
    const x = pistaDeEntrega(p.carregado, { executorGh: gh.executor, forja: FORJA, thread: e.id }).pistas[0];
    assert.equal(x.pr, null, 'o mesclado do head velho nao e o PR da ponta nova');
    assert.equal(x.etapas.find((y) => y.id === 'pr')?.estado, 'pendente');
    assert.deepEqual(x.proximo, { acao: 'publicar', disponivel: true, texto: 'publique a branch e abra o PR', comando: `ork ship publicar ${e.id}` });
  } finally { p.limpar(); }
});

test('pista: so a thread na entrega vai a conferencia uma a uma, e a lista cortada so deixa em duvida o PR que nao foi conferido (A7, S8)', () => {
  const p = projetoTemporario('pista-forja', true);
  try {
    const gh = ghFalso(p);
    const pronta = prepararEntrega(p, 'pronta', 'auto');
    for (const nome of ['em go 1', 'em go 2']) prepararEntrega(p, nome, 'auto', { check: 'ausente' });
    const r = pistaDeEntrega(p.carregado, { executorGh: gh.executor, forja: FORJA });
    assert.deepEqual(r.pistas.map((x) => x.thread), [pronta.id]);
    const porBranch = gh.chamadas.filter((c) => c[1] === 'list').map((c) => c.find((a) => a.startsWith('--head='))).filter(Boolean);
    assert.deepEqual(porBranch, [`--head=${pronta.branch}`], 'as threads em GO nao custam leitura da forja');
    assert.equal(gh.chamadas.filter((c) => c[1] === 'list').length, 3);

    // Uma entrega com PR aberto, publicada antes de a lista encher.
    const comPr = prepararEntrega(p, 'com pr', 'auto');
    assert.equal(publicarEntrega(p.carregado, comPr.id, { executorGh: gh.executor, forja: FORJA }).acao, 'publicou');
    // Uma thread fora da entrega pelo que se le sem a forja (sem CHECK, sem branch no remoto), com um PR fechado na lista.
    const fechada = prepararEntrega(p, 'pr fechado', 'auto', { check: 'ausente' });
    gh.prs.push({ number: 900, state: 'CLOSED', headRefName: fechada.branch, headRefOid: exec('git', ['rev-parse', fechada.branch], p.dir).stdout.trim(),
      baseRefName: 'main', isDraft: false, mergeable: 'UNKNOWN', checks: [], mergedAt: null });
    // A lista dos abertos cortada no teto, e a branch pronta no remoto, sem PR.
    for (let i = 0; i < 200; i++) {
      gh.prs.push({ number: 1000 + i, state: 'OPEN', headRefName: `ork/outra-${i}`, headRefOid: 'f'.repeat(40), baseRefName: 'main',
        isDraft: false, mergeable: 'MERGEABLE', checks: [], mergedAt: null });
    }
    assert.equal(exec('git', ['push', '-q', 'origin', `${pronta.branch}:refs/heads/${pronta.branch}`], p.dir).ok, true);
    const lidas = pistaDeEntrega(p.carregado, { executorGh: gh.executor, forja: FORJA });
    const de = (e: Entrega) => lidas.pistas.find((x) => x.thread === e.id)!;
    // S8: a candidata sem nenhum PR foi conferida pelo --head, que a lista cortada nao limita: vale "sem PR", com o Publicar.
    assert.equal(de(pronta).etapas.find((y) => y.id === 'pr')?.estado, 'pendente');
    assert.deepEqual(de(pronta).proximo, { acao: 'publicar', disponivel: true, texto: 'publique a branch e abra o PR', comando: `ork ship publicar ${pronta.id}` });
    // O PR aberto achado na lista cortada vale como lido.
    assert.equal(de(comPr).etapas.find((y) => y.id === 'pr')?.estado, 'feita');
    // A thread que so entra pela lista, com o PR fechado: a lista cortada pode esconder um aberto, e o PR fica nao lido.
    assert.deepEqual(de(fechada).etapas.filter((y) => ['pr', 'ci', 'conflito'].includes(y.id)).map((y) => y.estado), ['nao-lida', 'nao-lida', 'nao-lida']);
    assert.match(de(fechada).etapas.find((y) => y.id === 'pr')?.texto ?? '', /cortada nos 200 mais novos/);

    // A16 (rodada 3): a candidata que ficou sem conferir (aqui, a conferencia pelo --head falhou) fica com o PR nao lido,
    // e o proximo passo e reler a pista, sem Publicar.
    const semConferir = prepararEntrega(p, 'sem conferir', 'auto');
    assert.equal(exec('git', ['push', '-q', 'origin', `${semConferir.branch}:refs/heads/${semConferir.branch}`], p.dir).ok, true);
    const falhaNaConferencia: ExecutorDoGh = (args, prazo) => (args.includes(`--head=${semConferir.branch}`)
      ? { status: 1, stdout: '', stderr: 'HTTP 502: gateway' } : gh.executor(args, prazo));
    const x = pistaDeEntrega(p.carregado, { executorGh: falhaNaConferencia, forja: FORJA, thread: semConferir.id }).pistas[0];
    assert.deepEqual(x.etapas.filter((y) => ['pr', 'ci', 'conflito'].includes(y.id)).map((y) => y.estado), ['nao-lida', 'nao-lida', 'nao-lida']);
    assert.match(x.etapas.find((y) => y.id === 'pr')?.texto ?? '', /ficou sem conferir nesta leitura da forja/);
    assert.deepEqual([x.proximo.acao, x.proximo.comando], [null, `ork ship pista ${semConferir.id}`]);
  } finally { p.limpar(); }
});

test('pista: entregue, merge sem registro e conduzida tem cada uma o seu proximo passo (A12)', () => {
  const p = projetoTemporario('pista-estados', true);
  try {
    const gh = ghFalso(p);
    const entregue = prepararEntrega(p, 'entregue', 'auto');
    const head = exec('git', ['rev-parse', entregue.branch], p.dir).stdout.trim();
    registrar(dirThread(p.dir, entregue.id), entregue.id, TIPOS_DE_EVENTO.shipConcluido, { shaDe: head, mergeSha: 'e'.repeat(40) });
    const conduzida = prepararEntrega(p, 'conduzida', 'auto');
    tomarConducao(p.dir, conduzida.id, { canal: 'cli', operacao: 'verify', prazoMs: 60_000 });
    const semRegistro = prepararEntrega(p, 'merge sem registro', 'auto');
    // O merge ship(<thread>) na base remota, sem o ship_done no ledger.
    assert.equal(exec('git', ['merge', '-q', '--no-ff', '-m', `ship(${semRegistro.id}): merge sem registro`, semRegistro.branch], p.dir).ok, true);
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
    const r = pistaDeEntrega(p.carregado, { executorGh: gh.executor, forja: FORJA });
    const de = (e: Entrega) => r.pistas.find((x) => x.thread === e.id)!;
    assert.equal(de(entregue).etapas.find((x) => x.id === 'entrega')?.estado, 'feita');
    assert.deepEqual(de(entregue).proximo, { acao: null, disponivel: false, texto: 'entregue; o MASTER fecha a thread', comando: null });
    assert.equal(de(conduzida).conduzida, true);
    assert.equal(de(conduzida).proximo.acao, null);
    assert.equal(de(conduzida).proximo.comando, `ork conducao status ${conduzida.id}`);
    assert.match(de(conduzida).proximo.texto, /conduz a thread agora/);
    const m = de(semRegistro);
    assert.match(m.etapas.find((x) => x.id === 'entrega')?.texto ?? '', /^merge [0-9a-f]{7} na base, sem ship_done$/);
    assert.deepEqual(m.proximo, { acao: 'registrar', disponivel: true, texto: 'mesclado na base: registre a entrega',
      comando: `ork ship registrar-pr ${semRegistro.id}` });
  } finally { p.limpar(); }
});

test('publicar: o push que sai com erro mas chegou ao remoto conta como feito; o que nao chegou recusa sem evento (A13)', () => {
  const p = projetoTemporario('publicar-push-com-erro', true);
  try {
    const e = prepararEntrega(p, 'push com erro', 'auto');
    const head = exec('git', ['rev-parse', e.branch], p.dir).stdout.trim();
    // O push chega ao remoto, e o processo sai como se o prazo tivesse vencido.
    const chegouComErro = (args: string[], prazoMs: number) => {
      const real = exec('git', args, p.dir, prazoMs);
      assert.equal(real.ok, true, real.stderr);
      return { ...real, ok: false, code: 124, stderr: 'prazo vencido' };
    };
    const r = publicarEntrega(p.carregado, e.id, { executorGh: ghFalso(p).executor, forja: FORJA, executorGit: chegouComErro });
    assert.equal(r.acao, 'publicou', r.detalhe);
    assert.equal(r.pushVerificado, true);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), head);
    const ev = publicados(p, e.id);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].pushFeito, true);

    // O push que sai com erro e nao chegou: recusa, e nada vai ao ledger.
    const outra = prepararEntrega(p, 'push que nao chegou', 'auto');
    const naoChegou = () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal: unable to access: Could not resolve host' });
    const r2 = publicarEntrega(p.carregado, outra.id, { executorGh: ghFalso(p).executor, forja: FORJA, executorGit: naoChegou });
    assert.equal(r2.acao, 'recusada');
    assert.equal(r2.motivo, 'runtime.unavailable');
    assert.match(r2.detalhe, /Could not resolve host/);
    assert.equal(publicados(p, outra.id).length, 0);
  } finally { p.limpar(); }
});

test('publicar: a saida de texto so mostra a linha do push quando ha push a provar (A2)', () => {
  const sha = 'a'.repeat(40);
  const mesclada: Publicacao = { contrato: 'ork.ship-publicar/v1', thread: 'ork-x', modo: 'auto', tag: '#Auto', acao: 'ja-publicada', motivo: null,
    detalhe: 'o PR #7 já foi mesclado no HEAD; nada a publicar', correcao: 'registre a entrega: ork ship registrar-pr ork-x', branch: 'ork/ork-x-full',
    base: 'main', remoto: 'origin', head: sha, remotaAntes: null, remota: null, pushVerificado: false,
    pr: { numero: 7, url: null, criado: false, head: sha }, corpo: null,
    passos: ['git ls-remote origin refs/heads/ork/ork-x-full', 'gh pr list --head ork/ork-x-full --state all'], dryRun: false };
  const linhas = comLocale('pt-BR', () => linhasDaPublicacao(mesclada));
  assert.ok(!linhas.some((l) => l.startsWith('  push ')), linhas.join('\n'));
  assert.ok(linhas.some((l) => l.includes('registrar-pr ork-x')), linhas.join('\n'));
  const publicada = comLocale('pt-BR', () => linhasDaPublicacao({ ...mesclada, acao: 'publicou', remota: sha, pushVerificado: true }));
  assert.ok(publicada.includes('  push          PROVADO pelo ls-remote (mesmo sha do HEAD)'), publicada.join('\n'));
  const outraPonta = comLocale('pt-BR', () => linhasDaPublicacao({ ...mesclada, remota: 'b'.repeat(40) }));
  assert.ok(outraPonta.includes('  push          sem prova'), outraPonta.join('\n'));
});

test('publicar: o verify e o bundle valem pelo manifesto do HEAD da branch, e nao pelo de quem chama o publicar (A15)', () => {
  const p = projetoTemporario('publicar-manifesto-da-branch', true);
  const manifesto = path.join(p.dir, 'orkastery.yaml');
  const original = fs.readFileSync(manifesto, 'utf8');
  try {
    // A branch versiona o manifesto com o build; quem chama (o checkout, aqui p.carregado) nao tem build nenhum.
    const { thread } = novaThread(p.carregado, { nome: 'manifesto da branch', modo: 'auto' });
    const branch = branchDaWorktree(thread);
    exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
    const comBuild = original.replace(/^verify:\n/m, 'verify:\n  build: "true"\n');
    assert.notEqual(comBuild, original);
    fs.writeFileSync(manifesto, comBuild);
    commitar(p.dir, 'orkastery.yaml', comBuild, `feat(${thread.id}): o build no manifesto`);
    const produto = commitar(p.dir, 'produto.txt', 'feito\n', `feat(${thread.id}): produto`);
    const daWorktree: ManifestoCarregado = { ...p.carregado,
      manifesto: { ...p.carregado.manifesto, verify: { ...p.carregado.manifesto.verify, build: 'true' } } };
    // O ci prepare da worktree gerou o bundle com o build do manifesto dela.
    const bundle = path.relative(p.dir, prepararBundleCi(daWorktree, thread.id));
    exec('git', ['add', '--', bundle], p.dir);
    exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle`], p.dir);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    // O checkout volta para a main, que nao versiona o manifesto: o git o tirou da arvore, e o teste o devolve como era.
    fs.writeFileSync(manifesto, original);
    escreverCheck(p, thread.id, 'PASSOU');
    // S14 (rodada 4): o verify so de claims nao vale, porque o manifesto da branch pede o build, mesmo com quem chama sem
    // build nenhum.
    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: 'verdade sustentada', motivos: [] });
    const soClaims = publicarEntrega(p.carregado, thread.id, { executorGh: ghFalso(p).executor, forja: FORJA, dryRun: true });
    assert.equal(soClaims.motivo, 'verify.failed', soClaims.detalhe);
    assert.match(soClaims.detalhe, /rodou só as claims/);
    // O verify da worktree, com o build que o manifesto dela pede, vale.
    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: 'verdade sustentada',
      motivos: [], comandos: [{ nome: 'build', ok: true, code: 0 }] });
    const r = publicarEntrega(p.carregado, thread.id, { executorGh: ghFalso(p).executor, forja: FORJA, dryRun: true });
    assert.equal(r.acao, 'publicaria', `${r.detalhe} ${r.correcao}`);

    // O bundle gerado sem o build que o manifesto da branch pede nao vale, mesmo que quem chama tambem nao tenha o build.
    fs.rmSync(manifesto);
    assert.equal(exec('git', ['checkout', '-q', branch], p.dir).ok, true);
    const semBuild = path.relative(p.dir, prepararBundleCi(p.carregado, thread.id));
    exec('git', ['add', '--', semBuild], p.dir);
    exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle sem o build`], p.dir);
    exec('git', ['checkout', '-q', 'main'], p.dir);
    fs.writeFileSync(manifesto, original);
    const rs = publicarEntrega(p.carregado, thread.id, { executorGh: ghFalso(p).executor, forja: FORJA, dryRun: true });
    assert.equal(rs.motivo, 'artifact.missing', rs.detalhe);
    assert.match(rs.detalhe, /os comandos de verify do manifesto mudaram depois dele/);
  } finally {
    fs.writeFileSync(manifesto, original);
    p.limpar();
  }
});

// ---------------------------------------------------------------------------
// RM-058 N5 (D11 da ork-rm058n5): a conferencia de quem publica por cima, imediatamente antes de cada efeito.
// ---------------------------------------------------------------------------

test('QS1: o gancho recusa antes do push: nada vai ao remoto, nenhum PR abre e nada vai ao ledger', () => {
  const p = projetoTemporario('publicar-qs1', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'qs1', 'auto');
    const chamados: string[] = [];
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA,
      antesDoEfeito: (efeito) => { chamados.push(efeito); return { recusa: 'noctum.efeito.revogado: arco revogado pelo dono', correcao: 'abra outro arco' }; } });
    assert.deepEqual([r.acao, r.motivo], ['recusada', 'policy.violation']);
    assert.match(r.detalhe, /revogado/);
    assert.equal(r.correcao, 'abra outro arco');
    assert.deepEqual(chamados, ['push']);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', 'a branch nao foi ao remoto');
    assert.equal(gh.criacoes(), 0);
    assert.equal(publicados(p, e.id).length, 0);
  } finally { p.limpar(); }
});

test('QS2: o gancho recusa antes do PR: o push que aconteceu vai ao ledger com a prova, e o PR nao abre', () => {
  const p = projetoTemporario('publicar-qs2', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'qs2', 'auto');
    const head = exec('git', ['rev-parse', e.branch], p.dir).stdout.trim();
    const vistos: Array<{ efeito: string; remota: string; prs: number }> = [];
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA,
      antesDoEfeito: (efeito) => {
        vistos.push({ efeito, remota: shaNoRemotoDeTeste(p.dir, 'origin', e.branch), prs: gh.criacoes() });
        return efeito === 'pr' ? { recusa: 'noctum.efeito.expirado: a janela terminou', correcao: 'abra outro arco' } : null;
      } });
    assert.deepEqual([r.acao, r.motivo], ['recusada', 'policy.violation']);
    assert.deepEqual(vistos, [{ efeito: 'push', remota: '', prs: 0 }, { efeito: 'pr', remota: head, prs: 0 }],
      'cada conferencia vem imediatamente antes do seu efeito');
    assert.equal(r.pushVerificado, true);
    assert.equal(gh.criacoes(), 0);
    const ev = publicados(p, e.id);
    assert.equal(ev.length, 1, 'o push aconteceu e vai ao ledger');
    assert.deepEqual([ev[0].pushFeito, ev[0].pushVerificado, ev[0].pr], [true, true, null]);
    assert.match(String(ev[0].prRecusado), /expirado/);
  } finally { p.limpar(); }
});

test('QS3: o gancho que deixa seguir e chamado antes do push e antes do PR, e a publicacao sai igual', () => {
  const p = projetoTemporario('publicar-qs3', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'qs3', 'auto');
    const chamados: string[] = [];
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA,
      antesDoEfeito: (efeito) => { chamados.push(efeito); return null; } });
    assert.equal(r.acao, 'publicou', `${r.detalhe} ${r.correcao}`);
    assert.deepEqual(chamados, ['push', 'pr']);
    assert.equal(gh.criacoes(), 1);
    // Ja publicada: sem efeito, o gancho nao e chamado.
    const de = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA,
      antesDoEfeito: (efeito) => { chamados.push(`de novo ${efeito}`); return null; } });
    assert.equal(de.acao, 'ja-publicada');
    assert.deepEqual(chamados, ['push', 'pr']);
  } finally { p.limpar(); }
});

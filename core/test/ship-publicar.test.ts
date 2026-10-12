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
import { adicionarClaim } from '../src/claims';
import { tomarConducao } from '../src/conducao';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { ManifestoCarregado } from '../src/manifest';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { pistaDeEntrega, publicarEntrega, tituloDoPr } from '../src/ship-publicar';
import { dirThread, novaThread } from '../src/thread';
import { Modo } from '../src/types';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { commitar, envPtBr, projetoTemporario, ProjetoDeTeste, shaNoRemotoDeTeste } from './apoio';

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
  return { prs, chamadas, executor, criacoes };
}

interface Entrega { id: string; branch: string }

/**
 * Uma thread pronta para publicar: o commit de produto na branch dela, o verify verde nele, o bundle commitado como
 * `ci(<thread>)` e o CHECK com PASSOU depois do commit. Cada parte pode faltar, para os casos de recusa.
 */
function prepararEntrega(p: ProjetoDeTeste, nome: string, modo: Modo,
  opcoes: { semVerify?: boolean; verifyReprovado?: boolean; semBundle?: boolean; check?: 'ausente' | 'velho' | string } = {}): Entrega {
  const { thread } = novaThread(p.carregado, { nome, modo });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
  const produto = commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  const dir = dirThread(p.dir, thread.id);
  if (!opcoes.semVerify) {
    registrar(dir, thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: opcoes.verifyReprovado ? 'reprovado' : 'verdade sustentada',
      motivos: opcoes.verifyReprovado ? ['claims.failed'] : [] });
  }
  if (!opcoes.semBundle) {
    const arquivo = prepararBundleCi(p.carregado, thread.id);
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
      assert.equal(gh.criacoes(), 1);
      const criacao = gh.chamadas.find((c) => c[1] === 'create')!;
      assert.ok(criacao.includes(`--head=${e.branch}`) && criacao.includes('--base=main'), criacao.join(' '));
      assert.ok(criacao.some((a) => a.startsWith(`--title=ship(${e.id}): `)), 'o titulo comeca por ship(<thread>)');
      assert.ok(criacao.some((a) => a.startsWith('--body=')), 'sem pr-body.md, o corpo padrao');
      const ev = publicados(p, e.id);
      assert.equal(ev.length, 1);
      assert.equal(ev[0].pushVerificado, true);
      assert.equal(ev[0].shaRemoto, head);
      assert.equal(ev[0].fonteDaProva, `git ls-remote origin refs/heads/${e.branch}`);
      assert.equal(ev[0].tipoDeAutorizacao, 'modo');
      assert.deepEqual(ev[0].pr, { numero: r.pr?.numero, url: `https://github.com/acme/app/pull/${r.pr?.numero}`, criado: true });
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
      assert.match(r.correcao, new RegExp(`git push -u origin ${e.branch.replace(/[.*+?^${}()|[\]\\/]/g, '.')}`));
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

test('publicar: remoto que divergiu recusa com tree.blocked sem forcar, e push aceito sem a ponta no remoto nao vale', () => {
  const p = projetoTemporario('publicar-remoto', true);
  try {
    // O remoto com um commit na branch que a local nao tem.
    const e = prepararEntrega(p, 'divergiu', 'auto');
    const clone = path.join(path.dirname(p.dir), `${path.basename(p.dir)}-clone`);
    assert.equal(exec('git', ['clone', '-q', p.remoto!, clone]).ok, true);
    try {
      exec('git', ['config', 'user.email', 'teste@orkastery.local'], clone);
      exec('git', ['config', 'user.name', 'Teste Orkastery'], clone);
      exec('git', ['checkout', '-q', '-b', e.branch], clone);
      commitar(clone, 'outro.txt', 'outro\n', 'feat: de outro lugar');
      assert.equal(exec('git', ['push', '-q', 'origin', e.branch], clone).ok, true);
    } finally { fs.rmSync(clone, { recursive: true, force: true }); }
    const remotoAntes = shaNoRemotoDeTeste(p.dir, 'origin', e.branch);
    exec('git', ['fetch', '-q', 'origin'], p.dir);
    const gh = ghFalso(p);
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.motivo, 'tree.blocked');
    assert.match(r.correcao, /nunca force/);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), remotoAntes, 'o remoto ficou como estava');
    assert.equal(gh.criacoes(), 0);

    // O remoto que aceita o push e desfaz a ref no gancho: o codigo de saida diz ok, o ls-remote nao.
    const gancho = path.join(p.remoto!, 'hooks', 'post-receive');
    fs.writeFileSync(gancho, '#!/bin/sh\nwhile read velho novo ref; do git update-ref -d "$ref"; done\n', { mode: 0o755 });
    const sumiu = prepararEntrega(p, 'sem prova', 'auto');
    const rp = publicarEntrega(p.carregado, sumiu.id, { executorGh: ghFalso(p).executor, forja: FORJA });
    assert.equal(rp.acao, 'recusada');
    assert.equal(rp.motivo, 'runtime.unavailable');
    assert.equal(rp.pushVerificado, false);
    assert.match(rp.detalhe, /não ficou provado/);
    assert.equal(publicados(p, sumiu.id).length, 0);
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

test('publicar: o titulo do PR vem do primeiro cabecalho do pr-body.md, e o corpo vai por arquivo', () => {
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'x' }, '## RM-1, a coisa\n\ntexto'), 'ship(ork-x): RM-1, a coisa');
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'nome da thread' }, 'texto sem cabecalho\n# depois'), 'ship(ork-x): nome da thread');
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'x' }, '# ship(ork-x): ja pronto'), 'ship(ork-x): ja pronto');
  assert.equal(tituloDoPr({ id: 'ork-x', nome: 'x' }, null), 'ship(ork-x): x');
  const p = projetoTemporario('publicar-corpo', true);
  try {
    const gh = ghFalso(p);
    const e = prepararEntrega(p, 'com corpo', 'auto');
    fs.writeFileSync(path.join(dirThread(p.dir, e.id), 'pr-body.md'), '## RM-059, a pista\n\nCorpo do PR.\n');
    const r = publicarEntrega(p.carregado, e.id, { executorGh: gh.executor, forja: FORJA });
    assert.equal(r.acao, 'publicou', r.detalhe);
    assert.equal(r.corpo, 'pr-body.md');
    const criacao = gh.chamadas.find((c) => c[1] === 'create')!;
    assert.ok(criacao.includes(`--title=ship(${e.id}): RM-059, a pista`), criacao.join(' '));
    assert.ok(criacao.includes(`--body-file=${path.join(dirThread(p.dir, e.id), 'pr-body.md')}`), criacao.join(' '));
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
    assert.match(b.proximo.comando ?? '', /^git push -u origin /);

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

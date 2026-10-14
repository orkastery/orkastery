import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import type { ForjaResolvida } from '../src/forja/contrato';
import type { SondasDaForja } from '../src/forja/resolver';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import type { ExecutorDoGh } from '../src/parado-no-condutor';
import { forjaDaEntrega, publicarEntrega } from '../src/ship-publicar';
import { dirThread } from '../src/thread';
import { exec } from '../src/util';
import { projetoTemporario, shaNoRemotoDeTeste } from './apoio';
import { entregaPronta, GITLAB, gitlabFalso, PROJETO } from './forja-gitlab-falso';

/** O gh nunca roda numa entrega pelo GitLab. */
const SEM_GH: ExecutorDoGh = (args) => { throw new Error(`rodou o gh: ${args.join(' ')}`); };
const NUNCA: SondasDaForja = { github: () => { throw new Error('sondou o github'); }, gitlab: () => { throw new Error('sondou o gitlab'); } };
const lista = (branch: string) => `glab api ${PROJETO}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&per_page=100`;
const publicados = (dir: string, id: string) => lerLedger(dirThread(dir, id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.shipPublicado);

test('publicar no GitLab: empurra, abre o MR pela API com os quatro campos e grava ship_published com a prova pela releitura', () => {
  const p = projetoTemporario('publicar-gitlab', true);
  try {
    const gl = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b));
    const e = entregaPronta(p, 'pronta gitlab');
    const r = publicarEntrega(p.carregado, e.id, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH });
    assert.equal(r.acao, 'publicou', `${r.detalhe} ${r.correcao}`);
    assert.equal(r.pushVerificado, true);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), e.head);
    assert.deepEqual(r.pr, { numero: 1, url: 'https://gitlab.empresa.com/grupo/sub/app/-/merge_requests/1', criado: true, head: e.head });
    assert.equal(gl.criacoes(), 1);
    assert.deepEqual(Object.keys(gl.corpos[0]).sort(), ['description', 'source_branch', 'target_branch', 'title']);
    assert.equal(gl.corpos[0].source_branch, e.branch);
    assert.equal(gl.corpos[0].target_branch, 'main');
    assert.match(String(gl.corpos[0].title), new RegExp(`^ship\\(${e.id}\\): `));
    assert.ok(String(gl.corpos[0].description).length > 0, 'sem pr-body.md, a descrição padrão');
    assert.ok(r.passos.includes(lista(e.branch)), r.passos.join('\n'));
    assert.ok(r.passos.includes(`glab api --method POST ${PROJETO}/merge_requests (source_branch=${e.branch}, target_branch=main)`));
    assert.ok(r.passos.includes(`${lista(e.branch)}   (prova do PR)`));
    assert.ok(!r.passos.some((x) => x.startsWith('gh ')));
    const ev = publicados(p.dir, e.id);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].provaDoPr, lista(e.branch));
    assert.deepEqual(ev[0].pr, { numero: 1, url: 'https://gitlab.empresa.com/grupo/sub/app/-/merge_requests/1', criado: true, head: e.head });
    assert.equal(ev[0].tipoDeAutorizacao, 'modo');
    assert.match(r.detalhe, /MR !1 aberto agora/);
    assert.ok(!r.detalhe.includes('PR #'), r.detalhe);
    assert.ok(gl.chamadas.some((c) => c.args.join(' ') === 'auth status --hostname gitlab.empresa.com'),
      'o login do glab foi conferido no host exato');
  } finally { p.limpar(); }
});

test('publicar no GitLab: repetido é ja-publicada sem outro MR; a criação que falha com o MR na releitura publica sem criado', () => {
  const p = projetoTemporario('publicar-gitlab-idem', true);
  try {
    const gl = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b));
    const e = entregaPronta(p, 'idempotente gitlab');
    assert.equal(publicarEntrega(p.carregado, e.id, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH }).acao, 'publicou');
    const segundo = publicarEntrega(p.carregado, e.id, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH });
    assert.equal(segundo.acao, 'ja-publicada', segundo.detalhe);
    assert.equal(segundo.pr?.numero, 1);
    assert.match(segundo.detalhe, /o MR !1 está aberto/);
    assert.equal(gl.criacoes(), 1);

    const falha = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b), { criaMasFalha: true });
    const f = entregaPronta(p, 'corrida gitlab');
    const r = publicarEntrega(p.carregado, f.id, { forjaResolvida: GITLAB, api: falha.api, executorGh: SEM_GH });
    assert.equal(r.acao, 'publicou', r.detalhe);
    assert.equal(r.pr?.criado, false, 'a criação saiu com erro; o MR veio da releitura');
    assert.equal(falha.criacoes(), 1, 'a escrita não se repete');
  } finally { p.limpar(); }
});

test('publicar no GitLab: a lista que falha recusa antes do push, com a correção do glab; o MR de fork da branch não conta', () => {
  const p = projetoTemporario('publicar-gitlab-falha', true);
  try {
    const e = entregaPronta(p, 'falha gitlab');
    const falha = gitlabFalso(() => e.head, { listaFalha: true });
    const r = publicarEntrega(p.carregado, e.id, { forjaResolvida: GITLAB, api: falha.api, executorGh: SEM_GH });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.match(r.detalhe, /lista de MRs da branch falhou: forja\.indisponivel: HTTP 502/);
    assert.match(r.correcao, /glab auth status/);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', 'sem a lista, nada foi empurrado');
    assert.equal(publicados(p.dir, e.id).length, 0);

    const gl = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b));
    gl.mrs.push({ iid: 1, source_branch: e.branch, target_branch: 'main', sha: e.head, state: 'opened', has_conflicts: false,
      detailed_merge_status: 'mergeable', source_project_id: 9, title: 'de um fork' });
    const comFork = publicarEntrega(p.carregado, e.id, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH });
    assert.equal(comFork.acao, 'publicou', comFork.detalhe);
    assert.equal(comFork.pr?.numero, 2, 'o MR do fork ficou de fora; o ork abriu o dele');
    assert.equal(comFork.pr?.criado, true);
  } finally { p.limpar(); }
});

test('publicar no GitLab: o ensaio diz os passos do glab, sem empurrar nem criar', () => {
  const p = projetoTemporario('publicar-gitlab-ensaio', true);
  try {
    const gl = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b));
    const e = entregaPronta(p, 'ensaio gitlab');
    const r = publicarEntrega(p.carregado, e.id, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH, dryRun: true });
    assert.equal(r.acao, 'publicaria', r.detalhe);
    assert.ok(r.passos.some((x) => x.startsWith(`glab api --method POST ${PROJETO}/merge_requests (source_branch=${e.branch}, target_branch=main, title="ship(`)),
      r.passos.join('\n'));
    assert.match(r.detalhe, /abriria o MR/);
    assert.equal(gl.criacoes(), 0);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '');
  } finally { p.limpar(); }
});

test('publicar fora de #Auto e #Maestro com forja.tipo gitlab: o comando do dono é o glab mr create, entre aspas, sem ler a forja', () => {
  const p = projetoTemporario('publicar-gitlab-dono', true);
  try {
    p.carregado.manifesto.forja = { tipo: 'gitlab' };
    const gl = gitlabFalso(() => '');
    const e = entregaPronta(p, "classica'; rm -rf / #", 'classic');
    const r = publicarEntrega(p.carregado, e.id, { api: gl.api, executorGh: SEM_GH });
    assert.equal(r.motivo, 'human.pending');
    assert.ok(r.correcao.includes(`git push -u 'origin' '${e.branch}' && glab mr create --source-branch '${e.branch}' --target-branch 'main' --title 'ship(`),
      r.correcao);
    assert.ok(r.correcao.includes("'\\''"), 'a aspa do título vai escapada');
    assert.match(r.correcao, / --description 'ship\(.*' --yes/);
    assert.ok(!r.correcao.includes('--fill'), 'o --fill empurra a branch e troca o título');
    assert.equal(gl.chamadas.length, 0, 'nem a lista de MRs foi lida');

    const comCorpo = entregaPronta(p, 'classica com corpo', 'classic');
    const arquivo = path.join(dirThread(p.dir, comCorpo.id), 'pr-body.md');
    fs.writeFileSync(arquivo, '# corpo do MR\n\ntexto\n');
    const rc = publicarEntrega(p.carregado, comCorpo.id, { api: gl.api, executorGh: SEM_GH });
    assert.ok(rc.correcao.includes(` --description-file '${path.relative(p.dir, arquivo)}' --yes`), rc.correcao);
    assert.ok(!rc.correcao.includes('--fill') && !rc.correcao.includes('$('), rc.correcao);
  } finally { p.limpar(); }
});

test('forjaDaEntrega: o remoto do gitlab.com com subgrupo é GitLab sem sondar; o nome do host não decide; subgrupo no GitHub não é forja de entrega', () => {
  const p = projetoTemporario('forja-da-entrega');
  try {
    const remoto = (nome: string, url: string) => exec('git', ['remote', 'add', nome, url], p.dir);
    remoto('gl', 'https://gitlab.com/grupo/sub/app.git');
    const gl = forjaDaEntrega(p.carregado, 'gl', NUNCA);
    assert.ok(gl.ok && gl.valor.tipo === 'gitlab' && gl.valor.repo === 'grupo/sub/app', JSON.stringify(gl));
    remoto('gh', 'https://github.empresa.com/grupo/sub/app.git');
    const nome = forjaDaEntrega(p.carregado, 'gh', { github: () => 'sem-login', gitlab: () => 'responde' });
    assert.ok(nome.ok && nome.valor.tipo === 'gitlab', JSON.stringify(nome));
    remoto('sub', 'https://github.com/a/b/c.git');
    assert.deepEqual(forjaDaEntrega(p.carregado, 'sub', NUNCA), { ok: false, erro: null });
    remoto('outro', 'https://git.empresa.com/o/r.git');
    const desconhecida = forjaDaEntrega(p.carregado, 'outro', { github: () => 'sem-login', gitlab: () => 'sem-login' });
    assert.equal(!desconhecida.ok && desconhecida.erro?.codigo, 'forja.desconhecida');
    assert.deepEqual(forjaDaEntrega(p.carregado, 'inexistente', NUNCA), { ok: false, erro: null });
  } finally { p.limpar(); }
});

test('publicar num GHE resolvido com porta: o --repo do gh vai sem a porta, como antes', () => {
  const p = projetoTemporario('publicar-ghe-porta', true);
  try {
    const e = entregaPronta(p, 'ghe com porta');
    const ghe: ForjaResolvida = { ...GITLAB, tipo: 'github', host: 'ghe.empresa.com', porta: 8443, repo: 'o/r' };
    const chamadas: (readonly string[])[] = [];
    const gh: ExecutorDoGh = (args) => { chamadas.push(args); return { status: 1, stdout: '', stderr: 'HTTP 502' }; };
    const r = publicarEntrega(p.carregado, e.id, { forjaResolvida: ghe, executorGh: gh });
    assert.equal(r.acao, 'recusada');
    assert.ok(chamadas.length > 0, 'o gh foi chamado');
    assert.ok(chamadas.every((a) => a.includes('--repo=ghe.empresa.com/o/r')), JSON.stringify(chamadas));
    assert.ok(!chamadas.some((a) => a.some((x) => x.includes(':8443'))), JSON.stringify(chamadas));
  } finally { p.limpar(); }
});

test('publicar num remoto https de host desconhecido, sem forja: e sem login: recusa forja.desconhecida antes do ls-remote e do push', () => {
  const p = projetoTemporario('publicar-forja-desconhecida', true);
  try {
    const e = entregaPronta(p, 'desconhecida');
    exec('git', ['remote', 'add', 'ghe', 'https://ghe.empresa.com/o/r.git'], p.dir);
    const sondas: SondasDaForja = { github: () => 'sem-login', gitlab: () => 'sem-login' };
    const r = publicarEntrega(p.carregado, e.id, { remoto: 'ghe', sondas, executorGh: SEM_GH,
      executorGit: (args) => { throw new Error(`rodou o git ${args.join(' ')}`); } });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.match(r.detalhe, /não é um repositório do GitHub nem do GitLab \(forja\.desconhecida: /);
    assert.deepEqual(r.passos, [], 'nem o ls-remote nem o push rodaram');
    assert.equal(r.remotaAntes, null);
    assert.equal(publicados(p.dir, e.id).length, 0);
  } finally { p.limpar(); }
});

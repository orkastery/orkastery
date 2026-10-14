import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { EstadoCi, ResultadoCi } from '../src/ci';
import type { ManifestoCarregado } from '../src/manifest';
import type { ExecutorDoGh } from '../src/parado-no-condutor';
import { pistaDeEntrega, publicarEntrega } from '../src/ship-publicar';
import { exec } from '../src/util';
import { projetoTemporario, shaNoRemotoDeTeste } from './apoio';
import { entregaPronta, GITLAB, gitlabFalso } from './forja-gitlab-falso';

const SEM_GH: ExecutorDoGh = (args) => { throw new Error(`rodou o gh: ${args.join(' ')}`); };
const comCiExigido = (c: ManifestoCarregado): ManifestoCarregado =>
  ({ ...c, manifesto: { ...c.manifesto, ci: { ...c.manifesto.ci, required_for_ship: true } } });
const ci = (sha: string, state: EstadoCi, bloqueado = false): ResultadoCi => ({ schema: 'ork.ci-status/v2', required: true, ok: state === 'success',
  provider: 'gitlab', repository: GITLAB.repo, sha, context: 'ork-verify', fonte: null, produtor: null, state, url: null,
  detail: `ork-verify ${state} no GitLab`, ...(bloqueado ? { bloqueado: true as const } : {}) });

test('pista no GitLab: os MRs pela capacidade, a CI do head pelo mapa da pista, o conflito e o próximo passo', () => {
  const p = projetoTemporario('pista-gitlab', true);
  try {
    const carregado = comCiExigido(p.carregado);
    const gl = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b));
    const opcoes = { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH };
    const pronta = entregaPronta(p, 'pronta');
    const classica = entregaPronta(p, 'classica', 'classic');
    const esperando = entregaPronta(p, 'esperando'), vermelha = entregaPronta(p, 'vermelha'), verde = entregaPronta(p, 'verde');
    const bloqueada = entregaPronta(p, 'bloqueada'), conflito = entregaPronta(p, 'conflito');
    const mesclada = entregaPronta(p, 'mesclada'), cega = entregaPronta(p, 'cega'), sem = entregaPronta(p, 'sem check');
    for (const e of [esperando, vermelha, verde, bloqueada, conflito, mesclada, cega, sem]) {
      assert.equal(publicarEntrega(carregado, e.id, opcoes).acao, 'publicou', e.id);
    }
    const mr = (e: { branch: string }) => gl.mrs.find((x) => x.source_branch === e.branch)!;
    mr(conflito).has_conflicts = true;
    mr(conflito).detailed_merge_status = 'conflict';
    mr(mesclada).state = 'merged';
    const estados = new Map<string, [EstadoCi, boolean?]>([[esperando.head, ['pending']], [vermelha.head, ['failure']], [verde.head, ['success']],
      [bloqueada.head, ['failure', true]], [conflito.head, ['success']], [cega.head, ['unavailable']]]);
    const consultados: string[] = [];
    const r = pistaDeEntrega(carregado, { ...opcoes, ciDoHead: (sha) => {
      consultados.push(sha);
      const [estado, bloq] = estados.get(sha) ?? ['missing'];
      return ci(sha, estado, bloq);
    } });
    assert.equal(r.prsLidos, true);
    const de = (e: { id: string }) => r.pistas.find((x) => x.thread === e.id)!;
    const etapa = (e: { id: string }, id: string) => de(e).etapas.find((x) => x.id === id)?.estado;

    assert.deepEqual(de(pronta).proximo, { acao: 'publicar', disponivel: true, texto: 'publique a branch e abra o PR', comando: `ork ship publicar ${pronta.id}` });
    assert.ok((de(classica).proximo.comando ?? '').startsWith(`git push -u 'origin' '${classica.branch}' && glab mr create --source-branch`),
      de(classica).proximo.comando ?? '');
    assert.equal(de(esperando).pr?.estado, 'aberto');
    assert.equal(etapa(esperando, 'ci'), 'pendente');
    assert.equal(etapa(esperando, 'conflito'), 'feita');
    assert.equal(de(esperando).proximo.comando, `ork ci status --sha ${esperando.head}`);
    assert.equal(etapa(vermelha, 'ci'), 'falhou');
    assert.match(de(vermelha).proximo.texto, /vermelho no PR/);
    assert.equal(etapa(verde, 'ci'), 'feita');
    // Bloqueado (manual/skipped) conta como verde na pista, como no rollup do GitHub; o gate segue reprovando.
    assert.equal(etapa(bloqueada, 'ci'), 'feita');
    assert.match(de(bloqueada).etapas.find((x) => x.id === 'ci')?.texto ?? '', /verde/);
    assert.equal(etapa(sem, 'ci'), 'pendente');
    assert.equal(etapa(conflito, 'conflito'), 'falhou');
    assert.equal(etapa(cega, 'ci'), 'nao-lida');
    assert.match(de(cega).etapas.find((x) => x.id === 'ci')?.texto ?? '', /ork-verify unavailable no GitLab/);
    assert.equal(etapa(mesclada, 'pr'), 'feita');
    assert.deepEqual(de(mesclada).proximo, { acao: 'registrar', disponivel: true, texto: 'mesclado na base: registre a entrega',
      comando: `ork ship registrar-pr ${mesclada.id}` });
    assert.ok(!consultados.includes(mesclada.head), 'o MR mesclado não tem a CI consultada');
  } finally { p.limpar(); }
});

test('pista no GitLab: a lista que falha deixa PR, CI e conflito sem leitura, e o publicar segue disponível', () => {
  const p = projetoTemporario('pista-gitlab-falha', true);
  try {
    const e = entregaPronta(p, 'sem leitura');
    const falha = gitlabFalso(() => e.head, { listaFalha: true });
    const r = pistaDeEntrega(p.carregado, { forjaResolvida: GITLAB, api: falha.api, executorGh: SEM_GH,
      ciDoHead: () => { throw new Error('consultou a CI sem MR'); } });
    assert.equal(r.prsLidos, false);
    assert.match(r.prsNaoLidos ?? '', /forja\.indisponivel: HTTP 502/);
    const x = r.pistas.find((y) => y.thread === e.id)!;
    assert.deepEqual(x.etapas.filter((y) => ['pr', 'ci', 'conflito'].includes(y.id)).map((y) => y.estado), ['nao-lida', 'nao-lida', 'nao-lida']);
    assert.equal(x.proximo.acao, 'publicar');
  } finally { p.limpar(); }
});

test('pista no GitLab: a forja que não resolve num remoto do GitLab diz sem leitura, nunca sem MR', () => {
  const p = projetoTemporario('pista-gitlab-nao-resolve', true);
  try {
    const e = entregaPronta(p, 'forja nao resolve');
    // O bloco `forja:` declara o GitLab e outro host: o remoto diverge e o resolvedor recusa.
    const carregado = { ...p.carregado, manifesto: { ...p.carregado.manifesto, forja: { tipo: 'gitlab' as const, host: 'outro.empresa.com' } } };
    exec('git', ['remote', 'set-url', 'origin', 'https://gitlab.empresa.com/grupo/sub/app.git'], p.dir);
    const gl = gitlabFalso(() => e.head);
    const r = pistaDeEntrega(carregado, { api: gl.api, executorGh: SEM_GH, sondas: {},
      ciDoHead: () => { throw new Error('consultou a CI sem MR'); } });
    assert.equal(r.prsLidos, false);
    assert.match(r.prsNaoLidos ?? '', /forja\.remoto-divergente/);
    const x = r.pistas.find((y) => y.thread === e.id)!;
    assert.deepEqual(x.etapas.filter((y) => ['pr', 'ci', 'conflito'].includes(y.id)).map((y) => y.estado), ['nao-lida', 'nao-lida', 'nao-lida']);
    assert.equal(gl.chamadas.length, 0);
  } finally { p.limpar(); }
});

test('pista no GitLab: confere até 20 branches por chamada e as outras ficam sem conferir', () => {
  const p = projetoTemporario('pista-gitlab-limite', true);
  try {
    const entregas = Array.from({ length: 21 }, (_, i) => entregaPronta(p, `lote ${i}`));
    const gl = gitlabFalso(() => entregas[0].head);
    const r = pistaDeEntrega(p.carregado, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH, ciDoHead: () => ci('x', 'missing') });
    assert.equal(r.prsLidos, true);
    assert.equal(gl.chamadas.filter((c) => c.args[0] === 'api').length, 20);
    const estados = entregas.map((e) => r.pistas.find((y) => y.thread === e.id)!.etapas.find((y) => y.id === 'pr')!.estado);
    assert.equal(estados.filter((s) => s === 'nao-lida').length, 1);
  } finally { p.limpar(); }
});

test('pista no GitLab: a lista incompleta (x-next-page) deixa PR, CI e conflito sem leitura', () => {
  const p = projetoTemporario('pista-gitlab-incompleta', true);
  try {
    const e = entregaPronta(p, 'incompleta');
    const gl = gitlabFalso(() => e.head, { listaIncompleta: true });
    const r = pistaDeEntrega(p.carregado, { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH,
      ciDoHead: () => { throw new Error('consultou a CI sem MR'); } });
    assert.equal(r.prsLidos, false);
    assert.match(r.prsNaoLidos ?? '', /forja\.incompleto/);
    const x = r.pistas.find((y) => y.thread === e.id)!;
    assert.deepEqual(x.etapas.filter((y) => ['pr', 'ci', 'conflito'].includes(y.id)).map((y) => y.estado), ['nao-lida', 'nao-lida', 'nao-lida']);
  } finally { p.limpar(); }
});

test('pista no GitLab: CI com job rodando e outro pulado fica pendente, nunca feita', () => {
  const p = projetoTemporario('pista-gitlab-pendente-bloqueado', true);
  try {
    const carregado = comCiExigido(p.carregado);
    const gl = gitlabFalso((b) => shaNoRemotoDeTeste(p.dir, 'origin', b));
    const opcoes = { forjaResolvida: GITLAB, api: gl.api, executorGh: SEM_GH };
    const e = entregaPronta(p, 'rodando e pulado');
    assert.equal(publicarEntrega(carregado, e.id, opcoes).acao, 'publicou');
    // Pendente com outro job bloqueado: o leitor da CI nao marca `bloqueado`.
    const r = pistaDeEntrega(carregado, { ...opcoes, ciDoHead: (sha) => ci(sha, 'pending') });
    assert.equal(r.pistas.find((x) => x.thread === e.id)!.etapas.find((x) => x.id === 'ci')?.estado, 'pendente');
  } finally { p.limpar(); }
});

test('pista num remoto de host desconhecido sem bloco forja: a pista não sonda por conta própria, o caminho é o do GitHub', () => {
  const p = projetoTemporario('pista-host-desconhecido', true);
  try {
    const e = entregaPronta(p, 'host desconhecido');
    exec('git', ['remote', 'set-url', 'origin', 'https://git.desconhecido.example/grupo/app.git'], p.dir);
    const chamadas = { github: 0, gitlab: 0 };
    const sondas = { github: () => { chamadas.github++; return 'nao-responde' as const; }, gitlab: () => { chamadas.gitlab++; return 'nao-responde' as const; } };
    const gh: ExecutorDoGh = () => ({ status: 1, stdout: '', stderr: 'sem gh no teste' });
    const r = pistaDeEntrega(p.carregado, { executorGh: gh, sondas, ciDoHead: () => { throw new Error('consultou a CI'); } });
    assert.equal(r.prsLidos, false);
    // So a leitura dos PRs sonda (uma vez por forja): a pista nao resolve a forja antes por conta propria.
    assert.ok(chamadas.github <= 1 && chamadas.gitlab <= 1, JSON.stringify(chamadas));
    assert.ok(e.id && r.prsNaoLidos);
  } finally { p.limpar(); }
});

/**
 * RM-058 (N5, D2, D4, D7, D9 a D11 da ork-rm058n5): o passo da entrega dentro do arco, de ponta a ponta numa máquina. O
 * remoto é um bare de verdade, o `gh` e o CI são falsos, o despacho do CHECK e o verify são SIMULADOS (o que o `phase run` e o
 * `verify_run` deixam no disco), e o envelope é autorizado pelo ingresso SIMULADO do Telegram.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjetoDeTeste } from './apoio';
import { autorizarPedido, passar, pedidoV2, prepararIngressoSimulado, revogarArco } from './noctum-apoio';
import { avancarBase, CAB, CHANGELOG_DA_BASE, ciFalso, claimDe, commitarBundle, commitarNaWorktree, commitDaSessao, concluirBloco,
  concluirRevisao, despachoDoCheck, ENTRADA_DA_THREAD, entregaPronta, EstadoDoCheck, FORJA, ghFalso, git, head, projetoDaEntrega,
  SessaoSimulada, sessaoDespachada, threadComWorktree, totalDeModelosDaEntrega, verifyDoPasso,
  verifyNoLedger } from './noctum-entrega-apoio';
import { ExecutorCi } from '../src/ci';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { blocosNaoPublicados, linhasDaBasePerdidas } from '../src/noctum-changelog';
import { concluirDespacho, lerArco, reservarDespacho } from '../src/noctum-arco';
import { decidirEntrega, EntradaDaDecisao, EVENTO_DA_ATUALIZACAO_RECUSADA, EVENTO_DO_PUSH_INCERTO, EVENTO_DO_PUSH_RECUSADO, integrarNoDestino,
  LIMITE_DE_REVISOES, OpcoesDaEntrega, passoDaEntrega, ResultadoDaEntrega } from '../src/noctum-entrega';
import { classificarCommit, ProvasDaEntrega } from '../src/noctum-provas';
import { dirDaSupervisao, gravarNaSupervisao } from '../src/noctum-supervisao';
import { dirThread, lerThread } from '../src/thread';
import { branchDaWorktree } from '../src/worktree';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const MAQUINA = 'maquina-simulada';

const DESTINO_COM_MERGE = { repositorio: FORJA.repositorio, base: 'main', permissoes: ['push', 'pr', 'merge'] };

/** O arco com o trabalho da thread e o destino com push, PR e merge; devolve o hash vigente do envelope. */
function arco(p: ProjetoDeTeste, nome: string, threadId: string, extra: (pedido: Record<string, unknown>) => void = () => {}): string {
  const pedido = pedidoV2(nome, { trabalhos: [{ id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], thread: threadId }], revisao: 1 });
  pedido.destinos = [DESTINO_COM_MERGE];
  extra(pedido);
  return autorizarPedido(p.dir, nome, pedido);
}

/** As reservas desta máquina para os itens dados. */
const reservas = (...itens: string[]): OpcoesDaEntrega['lerReservas'] =>
  () => ({ leitura: 'copia-local', reservas: itens.map(item => ({ item, maquina: MAQUINA, thread: null })) });

/** Grava bytes na árvore e os põe no índice. */
function gravarBytes(dir: string, arquivo: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(path.join(dir, arquivo)), { recursive: true });
  fs.writeFileSync(path.join(dir, arquivo), bytes);
  git(dir, 'add', '--', arquivo);
}

const publicarBranch = (t: { worktree?: string | null } & Parameters<typeof branchDaWorktree>[0]): void => {
  assert.equal(git(t.worktree!, 'push', '-q', 'origin', `HEAD:refs/heads/${branchDaWorktree(t)}`).ok, true);
};

interface Mundo { p: ProjetoDeTeste; gh: ReturnType<typeof ghFalso>; ci: Record<string, EstadoDoCheck>; abertas: SessaoSimulada[]; verifies: string[] }

function opcoes(m: Mundo, extra: Partial<OpcoesDaEntrega> = {}): OpcoesDaEntrega {
  return { maquina: MAQUINA, forja: FORJA, executorGh: m.gh.executor, executorCi: ciFalso(m.ci),
    lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-958', maquina: MAQUINA, thread: null }] }),
    despachar: despachoDoCheck(m.p, m.abertas) as unknown as OpcoesDaEntrega['despachar'],
    consultarSessoes: () => ({ sessoes: [], fontes: [{ origem: 'claude agents --json (conta do processo)', ok: true, detalhe: '' }],
      contas: [{ runtime: 'claude-bg', perfil: null }] }),
    perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }], verificar: verifyDoPasso(m.p, m.verifies), ...extra };
}

const mundo = (nome: string): Mundo => ({ p: projetoDaEntrega(nome), gh: { prs: [], chamadas: [], executor: () => ({ status: 1, stdout: '', stderr: '' }),
  criacoes: () => 0 }, ci: {}, abertas: [], verifies: [] });

const lsRemote = (p: ProjetoDeTeste, ref: string): string => git(p.dir, 'ls-remote', 'origin', ref).stdout.split(/\s+/)[0] ?? '';
const passo = (m: Mundo, nome: string, extra: Partial<OpcoesDaEntrega> = {}): ResultadoDaEntrega => passoDaEntrega(m.p.carregado, nome, opcoes(m, extra));
const resumo = (r: ResultadoDaEntrega): string => JSON.stringify(r);

test('QE1: de ponta a ponta: publica, espera o CI, integra no SHA, registra o MASTER e para', { skip: semKernel }, () => {
  const m = mundo('noctum-qe1');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe1');
    arco(m.p, 'arco-qe1', e.t.id);
    const r1 = passo(m, 'arco-qe1');
    assert.equal(r1.acao, 'publicou', resumo(r1));
    assert.equal(lsRemote(m.p, `refs/heads/${branchDaWorktree(e.t)}`), e.fonte);
    assert.equal(m.gh.criacoes(), 1);
    const r2 = passo(m, 'arco-qe1');
    assert.deepEqual([r2.acao, r2.acao === 'aguardar' && r2.motivo], ['aguardar', 'noctum.entrega.ci-pendente'], resumo(r2));
    assert.equal(m.gh.criacoes(), 1, 'o PR aberto é reaproveitado');
    m.ci[e.fonte] = 'success';
    const r3 = passo(m, 'arco-qe1');
    assert.equal(r3.acao, 'integrou', resumo(r3));
    assert.equal(lsRemote(m.p, 'refs/heads/main'), r3.acao === 'integrou' ? r3.pontaDaBase : '');
    const r4 = passo(m, 'arco-qe1');
    assert.equal(r4.acao, 'master', resumo(r4));
    assert.equal(lerThread(m.p.dir, e.t.id).status, 'fechada');
    const r5 = passo(m, 'arco-qe1');
    assert.equal(r5.acao, 'nada', resumo(r5));
    assert.equal(lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 1, 'uma entrega só');
    fs.writeFileSync(path.join(m.p.dir, '.rm074-m4-isolamento-entrega'), 'so no mundo de QE1\n');
  } finally { m.p.limpar(); }
});

test('QE2: sem revisão independente (o bloco inteiro numa sessão), o arco despacha o CHECK pela reserva de revisão e depois publica', { skip: semKernel }, () => {
  const m = mundo('noctum-qe2');
  m.gh = ghFalso(m.p);
  try {
    assert.equal(totalDeModelosDaEntrega(), 1, 'o projeto inicial da entrega nasce uma vez no processo do arquivo');
    assert.equal(fs.existsSync(path.join(m.p.dir, '.rm074-m4-isolamento-entrega')), false, 'QE2 nao herda os bytes de QE1');
    const t = threadComWorktree(m.p, 'qe2');
    const autor = sessaoDespachada(m.p, t.id, 'GOAL');
    const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD('qe2')}\n\n`);
    const produto = commitarNaWorktree(t, { 'core/src/qe2.ts': 'export const qe2 = 1;\n', 'CHANGELOG.md': changelog }, 'feat: qe2');
    commitDaSessao(m.p, t.id, autor, produto);
    claimDe(m.p, t.id, 'core/src/qe2.ts', 'Mutante M1: a guarda de qe2 cai');
    const fonte = commitarBundle(m.p, t);
    concluirBloco(m.p, t.id, autor, fonte);
    arco(m.p, 'arco-qe2', t.id);
    const r1 = passo(m, 'arco-qe2');
    assert.equal(r1.acao, 'revisao-pedida', resumo(r1));
    const despacho = lerArco(m.p.dir, 'arco-qe2')!.despachos.at(-1)!;
    assert.deepEqual([despacho.fase, despacho.revisao, despacho.desfecho, despacho.trabalho], ['CHECK', true, 'concluido', 'a'],
      'o CHECK sai pela reserva de revisão do arco');
    assert.equal(m.abertas.length, 1);
    assert.notEqual(m.abertas[0].sessionId, autor.sessionId, 'outra sessão, outro id nativo');
    // Enquanto a sessão de CHECK conduz, a thread está em curso: o passo não faz nada com ela.
    assert.equal(passo(m, 'arco-qe2').acao, 'nada');
    concluirRevisao(m.p, t.id, m.abertas[0], 'PASSOU', fonte);
    const r2 = passo(m, 'arco-qe2');
    assert.equal(r2.acao, 'publicou', resumo(r2));
  } finally { m.p.limpar(); }
});

test('QE3: a base publicou uma versão: o passo mescla com o conflito do CHANGELOG pela regra, a entrada fica em Não publicado, e a revisão sobrevive', { skip: semKernel }, () => {
  const m = mundo('noctum-qe3');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe3');
    arco(m.p, 'arco-qe3', e.t.id);
    // A base faz a versão 0.2.0 (a antiga sai de Não publicado) e outra thread entra com a linha dela.
    const daBase = `${CAB}## Não publicado\n\n### Adicionado\n\n- **Outra SIMULADA** (RM-959): da base.\n\n## [0.2.0] - 2026-10-13\n\n### Adicionado\n\n` +
      '- **Antiga SIMULADA** (RM-900): já estava na base.\n\n## [0.1.0] - 2026-10-01\n\n- v1\n';
    const nova = avancarBase(m.p, { 'CHANGELOG.md': daBase }, 'chore: versão 0.2.0');
    const r = passo(m, 'arco-qe3');
    assert.equal(r.acao, 'atualizou', resumo(r));
    assert.ok(r.acao === 'atualizou');
    assert.deepEqual(r.conflitos, ['CHANGELOG.md']);
    assert.equal(r.verify, true, 'o verify roda na mesma condução, no SHA novo');
    assert.deepEqual(m.verifies, [r.para]);
    const wt = e.t.worktree!;
    const final = fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8');
    assert.deepEqual(linhasDaBasePerdidas(daBase, final), []);
    assert.ok((blocosNaoPublicados(final) ?? []).some(b => b.linhas.join('\n') === ENTRADA_DA_THREAD('qe3')), 'a entrada da thread em Não publicado');
    assert.equal(git(wt, 'status', '--porcelain').stdout.trim(), '');
    assert.equal(classificarCommit(m.p.dir, r.para, nova).tipo, 'merge-mecanico', 'o merge que o núcleo fez se recomputa');
    // A revisão vale no SHA novo; o próximo passo publica.
    const r2 = passo(m, 'arco-qe3');
    assert.equal(r2.acao, 'publicou', resumo(r2));
  } finally { m.p.limpar(); }
});

test('QE4: conflito que não é só aditivo: o merge aborta, a worktree fica como estava, e a mesma base não é tentada de novo', { skip: semKernel }, () => {
  const m = mundo('noctum-qe4');
  try {
    avancarBase(m.p, { 'core/src/comum.ts': 'export const valor = 1;\n' }, 'feat: comum');
    const e = entregaPronta(m.p, 'qe4', { arquivos: () => ({ 'core/src/comum.ts': 'export const valor = 2;\n' }) });
    arco(m.p, 'arco-qe4', e.t.id);
    const nova = avancarBase(m.p, { 'core/src/comum.ts': 'export const valor = 3;\n' }, 'feat: a base muda a mesma linha');
    const r = passo(m, 'arco-qe4');
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.conflito-nao-aditivo'], resumo(r));
    const wt = e.t.worktree!;
    assert.equal(head(wt), e.fonte, 'nenhum commit novo');
    assert.equal(git(wt, 'status', '--porcelain').stdout.trim(), '', 'a worktree limpa, sem merge pela metade');
    const recusas = () => lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === EVENTO_DA_ATUALIZACAO_RECUSADA);
    assert.deepEqual(recusas().map(x => x.base), [nova]);
    const r2 = passo(m, 'arco-qe4');
    assert.deepEqual([r2.acao, r2.acao === 'bloqueado' && r2.motivo], ['bloqueado', 'noctum.entrega.conflito-nao-aditivo']);
    assert.equal(recusas().length, 1, 'a mesma base não é tentada de novo');
  } finally { m.p.limpar(); }
});

test('QE5: o arco revogado entre os passos não faz efeito nenhum: nem publica, nem integra', { skip: semKernel }, () => {
  const m = mundo('noctum-qe5');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe5');
    arco(m.p, 'arco-qe5', e.t.id);
    assert.equal(passo(m, 'arco-qe5').acao, 'publicou');
    const base = lsRemote(m.p, 'refs/heads/main');
    revogarArco(m.p.dir, 'arco-qe5');
    m.ci[e.fonte] = 'success';
    const r = passo(m, 'arco-qe5');
    assert.deepEqual([r.acao, r.acao === 'nada' && r.motivo], ['nada', 'arco-encerrado'], resumo(r));
    assert.equal(lsRemote(m.p, 'refs/heads/main'), base);
    // Expirado: o mesmo, pelo relógio.
    const q = mundo('noctum-qe5b');
    q.gh = ghFalso(q.p);
    try {
      const f = entregaPronta(q.p, 'qe5b');
      arco(q.p, 'arco-qe5b', f.t.id);
      const depoisDoFim = new Date(Date.now() + 8 * 3600_000).toISOString();
      const rq = passo(q, 'arco-qe5b', { quando: depoisDoFim });
      assert.deepEqual([rq.acao, rq.acao === 'nada' && rq.motivo], ['nada', 'arco-encerrado']);
      assert.equal(lsRemote(q.p, `refs/heads/${branchDaWorktree(f.t)}`), '', 'nada foi publicado');
    } finally { q.p.limpar(); }
  } finally { m.p.limpar(); }
});

test('QE6: segredo nas linhas da thread bloqueia antes de qualquer push', { skip: semKernel }, () => {
  const m = mundo('noctum-qe6');
  m.gh = ghFalso(m.p);
  try {
    const chave = ['AKIA', 'SIMULADA00000000'].join('');
    const e = entregaPronta(m.p, 'qe6', { arquivos: () => ({ 'core/src/qe6-config.ts': `export const id = '${chave}';\n` }) });
    arco(m.p, 'arco-qe6', e.t.id);
    const r = passo(m, 'arco-qe6');
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.segredo'], resumo(r));
    assert.ok(!resumo(r).includes(chave), 'o segredo não aparece no resultado');
    assert.equal(lsRemote(m.p, `refs/heads/${branchDaWorktree(e.t)}`), '', 'a branch não foi ao remoto');
    assert.equal(m.gh.criacoes(), 0);
  } finally { m.p.limpar(); }
});

test('QE7: conflito de código só aditivo, resolvido pela regra: a atualização passa, mas a revisão precisa ser refeita', { skip: semKernel }, () => {
  const m = mundo('noctum-qe7');
  m.gh = ghFalso(m.p);
  try {
    avancarBase(m.p, { 'core/src/comum.ts': 'export const lista = [\n  1,\n];\n' }, 'feat: comum');
    const e = entregaPronta(m.p, 'qe7', { arquivos: () => ({ 'core/src/comum.ts': 'export const lista = [\n  1,\n  2,\n];\n' }) });
    arco(m.p, 'arco-qe7', e.t.id);
    avancarBase(m.p, { 'core/src/comum.ts': 'export const lista = [\n  1,\n  3,\n];\n' }, 'feat: a base acrescenta 3');
    const r = passo(m, 'arco-qe7');
    assert.equal(r.acao, 'atualizou', resumo(r));
    assert.ok(r.acao === 'atualizou' && r.conflitos.includes('core/src/comum.ts'));
    assert.equal(fs.readFileSync(path.join(e.t.worktree!, 'core/src/comum.ts'), 'utf8'), 'export const lista = [\n  1,\n  3,\n  2,\n];\n');
    const r2 = passo(m, 'arco-qe7');
    assert.equal(r2.acao, 'revisao-pedida', `o merge com código resolvido não é neutro para a revisão: ${resumo(r2)}`);
  } finally { m.p.limpar(); }
});

/** As provas sintéticas: todas valendo, menos as dadas. */
function provasCom(falhas: Record<string, string>): ProvasDaEntrega {
  const ids = ['integracao', 'segredo', 'mutantes', 'changelog', 'bundle', 'revisao', 'verify', 'ci'] as const;
  const provas = ids.map(id => ({ id, ok: !falhas[id], motivo: (falhas[id] ?? null) as never, detalhe: falhas[id] ?? 'ok', evidencia: {} }));
  return { contrato: 'ork.noctum-provas/v1', thread: 'ork-x', branch: 'ork/ork-x-full', fonte: 'f'.repeat(40), base: { nome: 'main', sha: 'b'.repeat(40) },
    ok: !Object.keys(falhas).length, provas, falhasRegistradas: [], sha256: '0'.repeat(64) };
}

test('QE8: a ordem da decisão: entregue, destino, base, provas estáticas, falhas que não se repetem, revisão, verify, CI e integração', () => {
  const entrada = (falhas: Record<string, string>, extra: Partial<EntradaDaDecisao> = {}): EntradaDaDecisao => ({ entregue: false, masterPendente: false,
    semProduto: false, incorporada: false, destino: { ok: true, podeMerge: true }, provas: provasCom(falhas), atualizacaoRecusada: false,
    pushRecusado: false, revisoesDespachadas: 0, publicacao: { acao: 'ja-publicada', detalhe: '' }, ...extra });
  const acao = (d: ReturnType<typeof decidirEntrega>) => `${d.acao}${'motivo' in d ? `:${d.motivo}` : ''}`;
  assert.equal(acao(decidirEntrega(entrada({}, { entregue: true, masterPendente: true }))), 'master');
  assert.equal(acao(decidirEntrega(entrada({}, { entregue: true }))), 'nada');
  assert.equal(acao(decidirEntrega(entrada({}, { destino: { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: 'x' } }))), 'bloqueado:noctum.entrega.fora-do-destino');
  // B4 da rodada 1: a branch sem commit próprio não se entrega, nem por reconciliação.
  assert.equal(acao(decidirEntrega(entrada({}, { semProduto: true, incorporada: true }))), 'bloqueado:noctum.entrega.sem-produto');
  assert.equal(acao(decidirEntrega(entrada({}, { incorporada: true }))), 'reconciliar');
  // B1 da rodada 1: a leitura do git que falhou espera, antes de atualizar, revisar, verificar, publicar ou integrar.
  assert.equal(acao(decidirEntrega(entrada({ integracao: 'noctum.entrega.base-mudou', segredo: 'noctum.entrega.git-sem-leitura' }))),
    'aguardar:noctum.entrega.git-sem-leitura');
  assert.equal(acao(decidirEntrega(entrada({ verify: 'noctum.entrega.git-sem-leitura', revisao: 'noctum.entrega.git-sem-leitura' }))),
    'aguardar:noctum.entrega.git-sem-leitura');
  assert.equal(acao(decidirEntrega(entrada({ verify: 'noctum.entrega.verify-esgotado' }))), 'bloqueado:noctum.entrega.verify-esgotado');
  assert.equal(acao(decidirEntrega(entrada({ integracao: 'noctum.entrega.base-mudou', revisao: 'noctum.entrega.revisao-ausente' }))), 'atualizar');
  assert.equal(acao(decidirEntrega(entrada({ integracao: 'noctum.entrega.base-mudou' }, { atualizacaoRecusada: true }))), 'bloqueado:noctum.entrega.conflito-nao-aditivo');
  assert.equal(acao(decidirEntrega(entrada({ integracao: 'noctum.entrega.base-sem-leitura' }))), 'aguardar:noctum.entrega.base-sem-leitura');
  // O segredo bloqueia antes de qualquer revisão ou publicação.
  assert.equal(acao(decidirEntrega(entrada({ segredo: 'noctum.entrega.segredo', revisao: 'noctum.entrega.revisao-ausente' }))), 'bloqueado:noctum.entrega.segredo');
  assert.equal(acao(decidirEntrega(entrada({ mutantes: 'noctum.entrega.mutante-sobrevivente' }))), 'bloqueado:noctum.entrega.mutante-sobrevivente');
  assert.equal(acao(decidirEntrega(entrada({ mutantes: 'noctum.entrega.mutantes-ausentes' }))), 'bloqueado:noctum.entrega.mutantes-ausentes');
  assert.equal(acao(decidirEntrega(entrada({ bundle: 'noctum.entrega.bundle-velho' }))), 'atualizar');
  assert.equal(acao(decidirEntrega(entrada({ verify: 'noctum.entrega.verify-falha-consistente' }))), 'bloqueado:noctum.entrega.verify-falha-consistente');
  assert.equal(acao(decidirEntrega(entrada({ revisao: 'noctum.entrega.revisao-em-curso' }))), 'aguardar:noctum.entrega.revisao-em-curso');
  assert.equal(acao(decidirEntrega(entrada({ revisao: 'noctum.entrega.revisao-reprovada' }))), 'bloqueado:noctum.entrega.revisao-reprovada');
  assert.equal(acao(decidirEntrega(entrada({ revisao: 'noctum.entrega.revisor-autor' }))), 'revisar');
  assert.equal(acao(decidirEntrega(entrada({ revisao: 'noctum.entrega.revisor-autor' }, { revisoesDespachadas: LIMITE_DE_REVISOES }))),
    'bloqueado:noctum.entrega.revisao-esgotada');
  assert.equal(acao(decidirEntrega(entrada({ verify: 'noctum.entrega.verify-reprovado' }))), 'verificar');
  assert.equal(acao(decidirEntrega(entrada({ mutantes: 'noctum.entrega.mutante-nao-executado' }))), 'verificar');
  assert.equal(acao(decidirEntrega(entrada({ ci: 'noctum.entrega.ci-vermelho' }))), 'bloqueado:noctum.entrega.ci-vermelho');
  assert.equal(acao(decidirEntrega(entrada({ ci: 'noctum.entrega.ci-ausente' }))), 'bloqueado:noctum.entrega.ci-ausente');
  assert.equal(acao(decidirEntrega(entrada({ ci: 'noctum.entrega.ci-sem-leitura' }))), 'aguardar:noctum.entrega.ci-sem-leitura');
  assert.equal(acao(decidirEntrega(entrada({ ci: 'noctum.entrega.ci-pendente' }, { publicacao: { acao: 'publicaria', detalhe: '' } }))), 'publicar');
  assert.equal(acao(decidirEntrega(entrada({ ci: 'noctum.entrega.ci-pendente' }))), 'aguardar:noctum.entrega.ci-pendente');
  assert.equal(acao(decidirEntrega(entrada({}, { destino: { ok: true, podeMerge: false } }))), 'bloqueado:noctum.entrega.fora-do-destino');
  // A4 da rodada 1: o push que o remoto recusou com a base parada não se repete.
  assert.equal(acao(decidirEntrega(entrada({}, { pushRecusado: true }))), 'bloqueado:noctum.entrega.push-recusado');
  assert.equal(acao(decidirEntrega(entrada({}))), 'integrar');
});

test('QE9: o trabalho que recusa antes de qualquer efeito não prende a fila: o seguinte integra no mesmo passo', { skip: semKernel }, () => {
  const m = mundo('noctum-qe9');
  m.gh = ghFalso(m.p);
  try {
    // O trabalho a tem tudo provado, mas a branch dele nunca foi ao remoto: a integração recusa antes do push (fonte-mudou).
    const a = entregaPronta(m.p, 'qe9a');
    const b = entregaPronta(m.p, 'qe9b', { item: 'RM-957' });
    publicarBranch(b.t);
    const pedido = pedidoV2('arco-qe9', { trabalhos: [{ id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], thread: a.t.id },
      { id: 'b', item: 'RM-957', prioridade: 2, dependeDe: [], thread: b.t.id }], revisao: 1 });
    pedido.destinos = [DESTINO_COM_MERGE];
    autorizarPedido(m.p.dir, 'arco-qe9', pedido);
    m.ci[a.fonte] = 'success';
    m.ci[b.fonte] = 'success';
    const r = passo(m, 'arco-qe9', { lerReservas: reservas('RM-958', 'RM-957') });
    assert.deepEqual([r.acao, 'thread' in r ? r.thread : null], ['integrou', b.t.id], resumo(r));
    assert.equal(lsRemote(m.p, `refs/heads/${branchDaWorktree(a.t)}`), '', 'nada da thread a foi ao remoto');
    const entregas = (id: string) => lerLedger(dirThread(m.p.dir, id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length;
    assert.deepEqual([entregas(a.t.id), entregas(b.t.id)], [0, 1]);
  } finally { m.p.limpar(); }
});

test('QE10: a thread sem commit próprio não se entrega nem se reconcilia: bloqueia, sem ship_done e sem MASTER', { skip: semKernel }, () => {
  const m = mundo('noctum-qe10');
  try {
    const t = threadComWorktree(m.p, 'qe10');
    const autor = sessaoDespachada(m.p, t.id, 'GOAL');
    // O bloco inteiro concluiu pela prova do GOAL, sem commit nenhum: a branch é a própria base, e a base a "contém".
    concluirBloco(m.p, t.id, autor, head(t.worktree!));
    arco(m.p, 'arco-qe10', t.id);
    for (let i = 0; i < 2; i++) {
      const r = passo(m, 'arco-qe10');
      assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.sem-produto'], resumo(r));
    }
    assert.equal(lerLedger(dirThread(m.p.dir, t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
    assert.notEqual(lerThread(m.p.dir, t.id).status, 'fechada');
  } finally { m.p.limpar(); }
});

test('QE11: o push que a proteção do remoto recusa com a base parada não vira "base andou": bloqueia e não se repete', { skip: semKernel }, () => {
  const m = mundo('noctum-qe11');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe11');
    arco(m.p, 'arco-qe11', e.t.id);
    assert.equal(passo(m, 'arco-qe11').acao, 'publicou');
    // A proteção da main no remoto: um gancho SIMULADO que recusa todo push nela e conta as tentativas.
    const tentativas = path.join(m.p.remoto!, 'tentativas-na-main');
    const gancho = path.join(m.p.remoto!, 'hooks', 'pre-receive');
    fs.writeFileSync(gancho, `#!/bin/sh\nwhile read velho novo ref; do\n  if [ "$ref" = refs/heads/main ]; then echo x >> '${tentativas}'; ` +
      `echo 'main protegida' >&2; exit 1; fi\ndone\nexit 0\n`);
    fs.chmodSync(gancho, 0o755);
    const base = lsRemote(m.p, 'refs/heads/main');
    m.ci[e.fonte] = 'success';
    for (let i = 0; i < 2; i++) {
      const r = passo(m, 'arco-qe11');
      assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.push-recusado'], resumo(r));
    }
    assert.equal(fs.readFileSync(tentativas, 'utf8').trim().split('\n').length, 1, 'o segundo passo não empurra de novo');
    assert.equal(lsRemote(m.p, 'refs/heads/main'), base);
    const recusas = lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === EVENTO_DO_PUSH_RECUSADO);
    assert.deepEqual(recusas.map(x => [x.base, x.fonte]), [[base, e.fonte]]);
  } finally { m.p.limpar(); }
});

test('QE12: a janela que fecha no meio do passo não deixa o merge sair: a conferência usa o relógio da hora do push', { skip: semKernel }, () => {
  const m = mundo('noctum-qe12');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe12');
    publicarBranch(e.t);
    // A janela (6 h, o mínimo do envelope) fecha logo depois de o passo começar, e a leitura do CI só volta depois do fim
    // (rede lenta, fila cheia).
    const fim = Date.now() + 6000;
    arco(m.p, 'arco-qe12', e.t.id, pedido => {
      pedido.janela = { inicio: new Date(fim - 6 * 3600_000).toISOString(), fim: new Date(fim).toISOString(), fuso: 'America/Sao_Paulo' };
    });
    const base = lsRemote(m.p, 'refs/heads/main');
    const ci = ciFalso({ [e.fonte]: 'success' });
    const lento: ExecutorCi = (x) => { while (Date.now() <= fim + 200) passar(50); return ci(x); };
    const r = passo(m, 'arco-qe12', { executorCi: lento });
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.efeito.expirado'], resumo(r));
    assert.equal(lsRemote(m.p, 'refs/heads/main'), base, 'nenhum merge depois do fim da janela');
    assert.equal(lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
  } finally { m.p.limpar(); }
});

test('QE13: conflito em arquivo fora de UTF-8 ou binário não é só aditivo: o merge aborta e os bytes da thread ficam como estavam', { skip: semKernel }, () => {
  const casos: Array<[string, string, Buffer, Buffer, Buffer]> = [
    // O git mescla o Latin-1 como texto e marca o conflito; ler como UTF-8 e gravar trocaria os bytes acentuados.
    ['latin', 'docs/latin-qe13.txt', Buffer.from('linha um\nação\nfim\n', 'latin1'), Buffer.from('linha um\nação\nda thread\nfim\n', 'latin1'),
      Buffer.from('linha um\nação\nda base\nfim\n', 'latin1')],
    // O binário conflita sem marcador: o git deixa o lado da thread inteiro no lugar.
    ['binario', 'docs/marca-qe13.bin', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x0a]), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02, 0x0a]),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x03, 0x0a])],
  ];
  for (const [nome, arquivo, inicial, daThread, daBase] of casos) {
    const m = mundo(`noctum-qe13-${nome}`);
    try {
      gravarBytes(m.p.dir, arquivo, inicial);
      git(m.p.dir, 'commit', '-q', '-m', `docs: ${arquivo}`);
      git(m.p.dir, 'push', '-q', 'origin', 'main');
      const e = entregaPronta(m.p, `qe13${nome}`);
      gravarBytes(e.t.worktree!, arquivo, daThread);
      git(e.t.worktree!, 'commit', '-q', '-m', `feat: a thread muda ${arquivo}`);
      const fonte = head(e.t.worktree!);
      arco(m.p, `arco-qe13-${nome}`, e.t.id);
      gravarBytes(m.p.dir, arquivo, daBase);
      git(m.p.dir, 'commit', '-q', '-m', `feat: a base muda ${arquivo}`);
      git(m.p.dir, 'push', '-q', 'origin', 'main');
      const r = passo(m, `arco-qe13-${nome}`);
      assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.conflito-nao-aditivo'], `${nome}: ${resumo(r)}`);
      assert.match(r.acao === 'bloqueado' ? r.detalhe : '', /não é texto UTF-8/, nome);
      assert.equal(head(e.t.worktree!), fonte, `${nome}: nenhum commit novo`);
      assert.equal(git(e.t.worktree!, 'status', '--porcelain').stdout.trim(), '', `${nome}: a worktree limpa`);
      assert.ok(fs.readFileSync(path.join(e.t.worktree!, arquivo)).equals(daThread), `${nome}: os bytes da thread ficam como estavam`);
    } finally { m.p.limpar(); }
  }
});

test('QE14: a thread que corrigiu uma linha antiga do CHANGELOG se atualiza com a base: a correção não é perda da base', { skip: semKernel }, () => {
  const m = mundo('noctum-qe14');
  try {
    const comEntrada = CHANGELOG_DA_BASE.replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD('qe14')}\n\n`);
    const e = entregaPronta(m.p, 'qe14', { arquivos: () => ({ 'CHANGELOG.md': comEntrada.replace('- v1\n', '- v1, com a data certa\n') }) });
    arco(m.p, 'arco-qe14', e.t.id);
    const outra = '- **Outra SIMULADA** (RM-959): da base.';
    avancarBase(m.p, { 'CHANGELOG.md': CHANGELOG_DA_BASE.replace('### Adicionado\n\n', `### Adicionado\n\n${outra}\n\n`) }, 'docs: a linha da outra');
    const r = passo(m, 'arco-qe14');
    assert.equal(r.acao, 'atualizou', resumo(r));
    const final = fs.readFileSync(path.join(e.t.worktree!, 'CHANGELOG.md'), 'utf8');
    assert.ok(final.includes('- v1, com a data certa\n') && !final.includes('- v1\n'), 'a correção da thread fica');
    assert.ok(final.includes(outra) && final.includes(ENTRADA_DA_THREAD('qe14')), 'a linha da base e a da thread ficam');
  } finally { m.p.limpar(); }
});

test('QE15: o arquivo que a thread muda e a base apaga conflita sem conteúdo dos dois lados: a atualização recusa, sem escolher', { skip: semKernel }, () => {
  const m = mundo('noctum-qe16');
  try {
    avancarBase(m.p, { 'core/src/apagavel.ts': 'export const a = 1;\n' }, 'feat: apagável');
    const e = entregaPronta(m.p, 'qe16', { arquivos: () => ({ 'core/src/apagavel.ts': 'export const a = 2;\n' }) });
    arco(m.p, 'arco-qe16', e.t.id);
    git(m.p.dir, 'rm', '-q', '--', 'core/src/apagavel.ts');
    git(m.p.dir, 'commit', '-q', '-m', 'feat: a base apaga o apagável');
    git(m.p.dir, 'push', '-q', 'origin', 'main');
    const r = passo(m, 'arco-qe16');
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.conflito-nao-aditivo'], resumo(r));
    assert.match(r.acao === 'bloqueado' ? r.detalhe : '', /não é de conteúdo/);
    assert.equal(head(e.t.worktree!), e.fonte);
    assert.equal(git(e.t.worktree!, 'status', '--porcelain').stdout.trim(), '');
  } finally { m.p.limpar(); }
});

test('QE16: o despacho do CHECK relê o arco sob a trava: a revisão que outro passo despachou enquanto este esperava não sai de novo', { skip: semKernel }, () => {
  const m = mundo('noctum-qe17');
  try {
    const t = threadComWorktree(m.p, 'qe17');
    const autor = sessaoDespachada(m.p, t.id, 'GOAL');
    const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD('qe17')}\n\n`);
    const produto = commitarNaWorktree(t, { 'core/src/qe17.ts': 'export const qe17 = 1;\n', 'CHANGELOG.md': changelog }, 'feat: qe17');
    commitDaSessao(m.p, t.id, autor, produto);
    claimDe(m.p, t.id, 'core/src/qe17.ts', 'Mutante M1: a guarda de qe17 cai');
    const fonte = commitarBundle(m.p, t);
    concluirBloco(m.p, t.id, autor, fonte);
    const envelope = arco(m.p, 'arco-qe17', t.id);
    // Enquanto este passo lê as provas, outro passo da máquina reserva e conclui o CHECK de revisão do mesmo trabalho.
    let corrida = false;
    const ci = ciFalso({});
    const comCorrida: ExecutorCi = (x) => {
      if (!corrida) {
        corrida = true;
        const agora = new Date().toISOString();
        const seq = reservarDespacho(m.p.dir, { arco: 'arco-qe17', envelopeSha256: envelope, trabalho: 'a', thread: t.id, fase: 'CHECK',
          runtime: 'claude-bg', conta: 'perfil-a', revisao: true }, agora).seq;
        concluirDespacho(m.p.dir, 'arco-qe17', seq, { thread: t.id, sessionId: '00000000-0000-4000-8005-999999999999', idempotente: false });
      }
      return ci(x);
    };
    const r = passo(m, 'arco-qe17', { executorCi: comCorrida });
    assert.deepEqual([r.acao, r.acao === 'aguardar' && r.motivo], ['aguardar', 'noctum.entrega.revisao-em-curso'], resumo(r));
    assert.equal(m.abertas.length, 0, 'nenhum CHECK novo');
  } finally { m.p.limpar(); }
});

const navegarAoRemoto = (m: Mundo, e: { t: Parameters<typeof branchDaWorktree>[0] }): string => lsRemote(m.p, `refs/heads/${branchDaWorktree(e.t)}`);
const entregas = (m: Mundo, id: string) => lerLedger(dirThread(m.p.dir, id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido);

test('QE17: o trabalho que a supervisão da N4 isolou não é publicado nem integrado, e o arco que ela parou não faz efeito', { skip: semKernel }, () => {
  const m = mundo('noctum-qe17b');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe17b');
    arco(m.p, 'arco-qe17b', e.t.id);
    gravarNaSupervisao(m.p.carregado, 'arco-qe17b', [{ tipo: 'isolado', trabalho: 'a', thread: e.t.id, motivo: 'efeito-divergente',
      detalhe: 'SIMULADO: outro sha na branch' }]);
    const r = passo(m, 'arco-qe17b');
    assert.deepEqual([r.acao, r.acao === 'nada' && r.motivo], ['nada', 'sem-entrega'], resumo(r));
    assert.equal(navegarAoRemoto(m, e), '', 'a branch isolada não foi ao remoto');
    assert.equal(m.gh.criacoes(), 0);
    // A integração direta também recusa o trabalho isolado, antes de qualquer efeito.
    publicarBranch(e.t);
    const base = lsRemote(m.p, 'refs/heads/main');
    assert.throws(() => integrarNoDestino(m.p.carregado, 'arco-qe17b', e.t.id, { forja: FORJA, executorCi: ciFalso({ [e.fonte]: 'success' }) }),
      /noctum\.entrega\.isolado/);
    assert.equal(lsRemote(m.p, 'refs/heads/main'), base);
    assert.equal(entregas(m, e.t.id).length, 0);
  } finally { m.p.limpar(); }
  const q = mundo('noctum-qe17c');
  q.gh = ghFalso(q.p);
  try {
    const f = entregaPronta(q.p, 'qe17c');
    arco(q.p, 'arco-qe17c', f.t.id);
    gravarNaSupervisao(q.p.carregado, 'arco-qe17c', [{ tipo: 'parada', motivo: 'teto-do-arco', detalhe: 'SIMULADO: o teto acabou' }]);
    const r = passo(q, 'arco-qe17c');
    assert.deepEqual([r.acao, r.acao === 'nada' && r.motivo], ['nada', 'arco-encerrado'], resumo(r));
    assert.equal(navegarAoRemoto(q, f), '', 'o arco parado não publica');
  } finally { q.p.limpar(); }
});

test('QE18: o merge da base que falha sem conflito (a trava do índice) espera, sem gravar a base como recusada, e passa depois', { skip: semKernel }, () => {
  const m = mundo('noctum-qe18');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe18');
    arco(m.p, 'arco-qe18', e.t.id);
    avancarBase(m.p, { 'docs/outro-qe18.md': '# outro\n' }, 'docs: outro arquivo, sem conflito');
    const trava = path.join(git(e.t.worktree!, 'rev-parse', '--absolute-git-dir').stdout.trim(), 'index.lock');
    fs.writeFileSync(trava, '');
    const r1 = passo(m, 'arco-qe18');
    assert.deepEqual([r1.acao, r1.acao === 'aguardar' && r1.motivo], ['aguardar', 'noctum.entrega.git-falhou'], resumo(r1));
    assert.equal(head(e.t.worktree!), e.fonte, 'a worktree ficou como estava');
    fs.rmSync(trava, { force: true });
    const r2 = passo(m, 'arco-qe18');
    assert.equal(r2.acao, 'atualizou', resumo(r2));
    assert.equal(lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === EVENTO_DA_ATUALIZACAO_RECUSADA).length, 0);
  } finally { m.p.limpar(); }
});

test('QE19: o push para a base que falha no transporte, sem recusa do remoto, espera e integra quando o transporte volta', { skip: semKernel }, () => {
  const m = mundo('noctum-qe19');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe19');
    arco(m.p, 'arco-qe19', e.t.id);
    assert.equal(passo(m, 'arco-qe19').acao, 'publicou');
    m.ci[e.fonte] = 'success';
    // O endereço de push não responde; o de leitura (o ls-remote) responde.
    git(m.p.dir, 'config', 'remote.origin.pushurl', path.join(m.p.dir, 'remoto-que-nao-existe.git'));
    const r1 = passo(m, 'arco-qe19');
    assert.deepEqual([r1.acao, r1.acao === 'aguardar' && r1.motivo], ['aguardar', 'noctum.entrega.git-falhou'], resumo(r1));
    assert.equal(lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === EVENTO_DO_PUSH_RECUSADO).length, 0);
    git(m.p.dir, 'config', '--unset', 'remote.origin.pushurl');
    const r2 = passo(m, 'arco-qe19');
    assert.equal(r2.acao, 'integrou', resumo(r2));
  } finally { m.p.limpar(); }
});

test('QE20: quem chama o passo com o instante dele (o tique do vigia) não faz o merge sair depois do fim da janela', { skip: semKernel }, () => {
  const m = mundo('noctum-qe20');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe20');
    publicarBranch(e.t);
    const fim = Date.now() + 6000;
    arco(m.p, 'arco-qe20', e.t.id, pedido => {
      pedido.janela = { inicio: new Date(fim - 6 * 3600_000).toISOString(), fim: new Date(fim).toISOString(), fuso: 'America/Sao_Paulo' };
    });
    const base = lsRemote(m.p, 'refs/heads/main');
    const ci = ciFalso({ [e.fonte]: 'success' });
    const lento: ExecutorCi = (x) => { while (Date.now() <= fim + 200) passar(50); return ci(x); };
    const r = passo(m, 'arco-qe20', { executorCi: lento, quando: new Date().toISOString() });
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.efeito.expirado'], resumo(r));
    assert.equal(lsRemote(m.p, 'refs/heads/main'), base, 'nenhum merge depois do fim da janela');
    assert.equal(entregas(m, e.t.id).length, 0);
  } finally { m.p.limpar(); }
});

test('QE21: o push para a base que chega e é coberto por outro fica incerto, e o passo seguinte reconcilia com as provas e as falhas guardadas', { skip: semKernel }, () => {
  const m = mundo('noctum-qe21');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe21');
    // A reprovação do build concorrente no mesmo SHA, antes do verde: ela vai com o push incerto e com a reconciliação.
    verifyNoLedger(m.p, e.t.id, e.fonte, { ok: false });
    verifyNoLedger(m.p, e.t.id, e.fonte);
    arco(m.p, 'arco-qe21', e.t.id);
    assert.equal(passo(m, 'arco-qe21').acao, 'publicou');
    m.ci[e.fonte] = 'success';
    // Logo depois do nosso push na main, outro push SIMULADO põe um commit em cima: o ls-remote não mostra o nosso alvo.
    const gancho = path.join(m.p.remoto!, 'hooks', 'post-receive');
    fs.writeFileSync(gancho, '#!/bin/sh\nexport GIT_AUTHOR_NAME=x GIT_AUTHOR_EMAIL=x@exemplo.invalid GIT_COMMITTER_NAME=x GIT_COMMITTER_EMAIL=x@exemplo.invalid\n' +
      'while read velho novo ref; do\n  if [ "$ref" = refs/heads/main ] && [ ! -f "$GIT_DIR/ja-andou" ]; then\n    touch "$GIT_DIR/ja-andou"\n' +
      '    outro=$(git commit-tree "$novo^{tree}" -p "$novo" -m "outro push SIMULADO")\n    git update-ref refs/heads/main "$outro" "$novo"\n  fi\ndone\nexit 0\n');
    fs.chmodSync(gancho, 0o755);
    const r1 = passo(m, 'arco-qe21');
    assert.deepEqual([r1.acao, r1.acao === 'aguardar' && r1.motivo], ['aguardar', 'noctum.entrega.push-incerto'], resumo(r1));
    const incertos = lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === EVENTO_DO_PUSH_INCERTO);
    assert.equal(incertos.length, 1);
    assert.match(String(incertos[0].provas), /^[0-9a-f]{64}$/);
    assert.equal((incertos[0].falhasRegistradas as unknown[]).length, 1, 'a reprovação anterior vai com o push incerto');
    const r2 = passo(m, 'arco-qe21');
    assert.equal(r2.acao, 'reconciliou', resumo(r2));
    const ship = entregas(m, e.t.id);
    assert.equal(ship.length, 1);
    const ev = ship[0].evidencia as { pushIncerto: { provas: unknown }; falhasRegistradas: unknown; incorporadaPor: unknown };
    assert.equal(ev.pushIncerto.provas, incertos[0].provas);
    assert.deepEqual(ev.falhasRegistradas, incertos[0].falhasRegistradas);
    assert.equal(ev.incorporadaPor, 'arco');
  } finally { m.p.limpar(); }
});

test('QE22: o conflito sem marcador num texto (merge=binary) e o arquivo com byte nulo recusam pelo motivo certo, sem gravar a thread por cima da base', { skip: semKernel }, () => {
  const m = mundo('noctum-qe22');
  m.gh = ghFalso(m.p);
  try {
    avancarBase(m.p, { '.gitattributes': 'dados/*.json merge=binary\n', 'dados/lista.json': '{"itens": [1]}\n' }, 'feat: lista');
    const e = entregaPronta(m.p, 'qe22', { arquivos: () => ({ 'dados/lista.json': '{"itens": [1, 2]}\n' }) });
    arco(m.p, 'arco-qe22', e.t.id);
    avancarBase(m.p, { 'dados/lista.json': '{"itens": [1, 3]}\n' }, 'feat: a base muda a lista');
    const r = passo(m, 'arco-qe22');
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.conflito-nao-aditivo'], resumo(r));
    assert.match(r.acao === 'bloqueado' ? r.detalhe : '', /sem marcador de texto/);
    assert.equal(head(e.t.worktree!), e.fonte, 'a worktree ficou na fonte');
  } finally { m.p.limpar(); }
  const q = mundo('noctum-qe22b');
  q.gh = ghFalso(q.p);
  try {
    avancarBase(q.p, { 'dados/blob.txt': 'linha\u0000um\n' }, 'feat: blob');
    const f = entregaPronta(q.p, 'qe22b', { arquivos: () => ({ 'dados/blob.txt': 'linha\u0000dois\n' }) });
    arco(q.p, 'arco-qe22b', f.t.id);
    avancarBase(q.p, { 'dados/blob.txt': 'linha\u0000tres\n' }, 'feat: a base muda o blob');
    const r = passo(q, 'arco-qe22b');
    assert.deepEqual([r.acao, r.acao === 'bloqueado' && r.motivo], ['bloqueado', 'noctum.entrega.conflito-nao-aditivo'], resumo(r));
    assert.match(r.acao === 'bloqueado' ? r.detalhe : '', /não é texto UTF-8/);
    assert.equal(head(f.t.worktree!), f.fonte);
  } finally { q.p.limpar(); }
});

test('QE23: a branch que anda depois das provas não vai ao remoto: o push leva só a fonte provada, e o passo seguinte relê', { skip: semKernel }, () => {
  const m = mundo('noctum-qe23');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe23');
    arco(m.p, 'arco-qe23', e.t.id);
    // Um commit só de bundle (que a regra do CHECK da publicação não pega) chega à branch no ensaio da publicação: depois
    // das provas e antes de a publicação de verdade ler a ponta.
    let andou = false;
    const gh = m.gh.executor;
    const executorGh: OpcoesDaEntrega['executorGh'] = (args, prazoMs) => {
      if (!andou && args[0] === 'pr' && args[1] === 'list') {
        andou = true;
        commitarNaWorktree(e.t, { '.ork-ci/qe23-outro.json': '{}\n' }, 'ci: um bundle a mais depois das provas');
      }
      return gh(args, prazoMs);
    };
    const r = passo(m, 'arco-qe23', { executorGh });
    assert.equal(andou, true, 'o ensaio da publicação leu os PRs');
    assert.deepEqual([r.acao, r.acao === 'aguardar' && r.motivo], ['aguardar', 'noctum.entrega.fonte-mudou'], resumo(r));
    assert.equal(navegarAoRemoto(m, e), '', 'nada foi ao remoto');
    assert.equal(m.gh.criacoes(), 0);
  } finally { m.p.limpar(); }
});

test('QE24: a conta que a supervisão da N4 tirou do arco não despacha o CHECK de revisão', { skip: semKernel }, () => {
  const m = mundo('noctum-qe24');
  m.gh = ghFalso(m.p);
  try {
    const t = threadComWorktree(m.p, 'qe24');
    const autor = sessaoDespachada(m.p, t.id, 'GOAL');
    const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD('qe24')}\n\n`);
    const produto = commitarNaWorktree(t, { 'core/src/qe24.ts': 'export const qe24 = 1;\n', 'CHANGELOG.md': changelog }, 'feat: qe24');
    commitDaSessao(m.p, t.id, autor, produto);
    claimDe(m.p, t.id, 'core/src/qe24.ts', 'Mutante M1: a guarda de qe24 cai');
    const fonte = commitarBundle(m.p, t);
    concluirBloco(m.p, t.id, autor, fonte);
    arco(m.p, 'arco-qe24', t.id);
    // A única conta do envelope ficou sem cota e sem reset dito: o arco a tirou pelo resto dele.
    gravarNaSupervisao(m.p.carregado, 'arco-qe24', [{ tipo: 'conta_fora', conta: 'perfil-a', runtime: 'claude-bg', motivo: 'cota-sem-reset',
      ate: null, prova: 'SIMULADO: cota esgotada sem reset dito' }]);
    const r = passo(m, 'arco-qe24');
    assert.deepEqual([r.acao, r.acao === 'aguardar' && r.motivo], ['aguardar', 'capacidade.conta-nao-autorizada'], resumo(r));
    assert.equal(m.abertas.length, 0, 'nenhum CHECK saiu pela conta tirada');
  } finally { m.p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX da rodada 3 do CHECK.
// ---------------------------------------------------------------------------

const motivoDe = (r: ResultadoDaEntrega): string | null => 'motivo' in r ? String(r.motivo) : null;

/** A thread do bloco inteiro numa sessão, sem revisão independente: o passo pede o CHECK. */
function threadSemRevisao(m: Mundo, nome: string): { t: ReturnType<typeof threadComWorktree>; fonte: string } {
  const t = threadComWorktree(m.p, nome);
  const autor = sessaoDespachada(m.p, t.id, 'GOAL');
  const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD(nome)}\n\n`);
  const produto = commitarNaWorktree(t, { [`core/src/${nome}.ts`]: `export const ${nome.replace(/[^a-z]/g, '')} = 1;\n`, 'CHANGELOG.md': changelog }, `feat: ${nome}`);
  commitDaSessao(m.p, t.id, autor, produto);
  claimDe(m.p, t.id, `core/src/${nome}.ts`, `Mutante M1: a guarda de ${nome} cai`);
  const fonte = commitarBundle(m.p, t);
  concluirBloco(m.p, t.id, autor, fonte);
  return { t, fonte };
}

/** A janela que fecha 6 s depois de agora (6 h, o mínimo do envelope). */
const janelaQueFecha = (fim: number) => (pedido: Record<string, unknown>) => {
  pedido.janela = { inicio: new Date(fim - 6 * 3600_000).toISOString(), fim: new Date(fim).toISOString(), fuso: 'America/Sao_Paulo' };
};

test('QE25: a linha da base que a resolução do arco põe antes da thread não vira segredo da thread', { skip: semKernel }, () => {
  const m = mundo('noctum-qe25');
  m.gh = ghFalso(m.p);
  try {
    // O padrão de segredo montado por partes: o próprio teste não o carrega inteiro.
    const atribuido = ['tok', 'en', ': ', "'", 'SIMULADO', '0123456789AB', "'"].join('');
    avancarBase(m.p, { 'core/src/qe25-lista.ts': 'export const lista = [\n  1,\n' }, 'feat: a lista na base');
    const e = entregaPronta(m.p, 'qe25', { arquivos: () => ({ 'core/src/qe25-lista.ts': 'export const lista = [\n  1,\n  2,\n  3,\n  4,\n' }) });
    arco(m.p, 'arco-qe25', e.t.id);
    avancarBase(m.p, { 'core/src/qe25-lista.ts': `export const lista = [\n  1,\n  // ${atribuido}\n` }, 'feat: a base comenta um exemplo na lista');
    const r1 = passo(m, 'arco-qe25');
    assert.equal(r1.acao, 'atualizou', resumo(r1));
    const r2 = passo(m, 'arco-qe25');
    assert.notEqual(motivoDe(r2), 'noctum.entrega.segredo', resumo(r2));
    assert.ok(!resumo(r2).includes('SIMULADO0123456789AB'), 'o trecho não aparece no resultado');
  } finally { m.p.limpar(); }
});

test('QE26: o isolamento que a supervisão grava entre a leitura da fila e o push da publicação recusa o push', { skip: semKernel }, () => {
  const m = mundo('noctum-qe26');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe26');
    arco(m.p, 'arco-qe26', e.t.id);
    let isolou = false;
    const ci = ciFalso({});
    const executorCi: ExecutorCi = (x) => {
      if (!isolou) {
        isolou = true;
        gravarNaSupervisao(m.p.carregado, 'arco-qe26', [{ tipo: 'isolado', trabalho: 'a', thread: e.t.id, motivo: 'condutor-externo',
          detalhe: 'SIMULADO: despacho de fora' }]);
      }
      return ci(x);
    };
    const r = passo(m, 'arco-qe26', { executorCi });
    assert.equal(isolou, true);
    assert.deepEqual([r.acao, motivoDe(r)], ['bloqueado', 'noctum.entrega.isolado'], resumo(r));
    assert.equal(navegarAoRemoto(m, e), '', 'nada foi ao remoto');
    assert.equal(m.gh.criacoes(), 0);
  } finally { m.p.limpar(); }
});

test('QE27: a parada e o isolamento que a supervisão grava antes da trava de despacho não deixam sair o CHECK de revisão', { skip: semKernel }, () => {
  for (const evento of ['parada', 'isolado'] as const) {
    const nome = `qe27${evento.slice(0, 3)}`;
    const m = mundo(`noctum-${nome}`);
    try {
      const { t } = threadSemRevisao(m, nome);
      arco(m.p, `arco-${nome}`, t.id);
      let gravou = false;
      const ci = ciFalso({});
      const executorCi: ExecutorCi = (x) => {
        if (!gravou) {
          gravou = true;
          gravarNaSupervisao(m.p.carregado, `arco-${nome}`, [evento === 'parada'
            ? { tipo: 'parada', motivo: 'teto-do-arco', detalhe: 'SIMULADO: o teto acabou' }
            : { tipo: 'isolado', trabalho: 'a', thread: t.id, motivo: 'condutor-externo', detalhe: 'SIMULADO: despacho de fora' }]);
        }
        return ci(x);
      };
      const r = passo(m, `arco-${nome}`, { executorCi });
      assert.equal(gravou, true);
      assert.deepEqual([r.acao, motivoDe(r)], ['bloqueado', evento === 'parada' ? 'noctum.entrega.arco-parado' : 'noctum.entrega.isolado'], resumo(r));
      assert.equal(m.abertas.length, 0, 'nenhum CHECK saiu');
    } finally { m.p.limpar(); }
  }
});

test('QE28: o log de supervisão que não se lê faz o passo esperar, sem efeito', { skip: semKernel }, () => {
  const m = mundo('noctum-qe28');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe28');
    arco(m.p, 'arco-qe28', e.t.id);
    gravarNaSupervisao(m.p.carregado, 'arco-qe28', [{ tipo: 'conta_fora', conta: 'perfil-z', runtime: 'claude-bg', motivo: 'auth', ate: null,
      prova: 'SIMULADO' }]);
    // O log com o modo aberto demais deixa de valer: a supervisão não se lê.
    fs.chmodSync(path.join(dirDaSupervisao(m.p.dir, 'arco-qe28'), 'supervisao.jsonl'), 0o644);
    const r = passo(m, 'arco-qe28');
    assert.deepEqual([r.acao, motivoDe(r)], ['aguardar', 'noctum.entrega.supervisao-sem-leitura'], resumo(r));
    assert.equal(navegarAoRemoto(m, e), '', 'nada foi ao remoto');
  } finally { m.p.limpar(); }
});

test('QE29: a trava de ref que o remoto deixou (falha passageira dele) não vira push-recusado: espera, e integra quando ela some', { skip: semKernel }, () => {
  const m = mundo('noctum-qe29');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe29');
    arco(m.p, 'arco-qe29', e.t.id);
    assert.equal(passo(m, 'arco-qe29').acao, 'publicou');
    m.ci[e.fonte] = 'success';
    const trava = path.join(m.p.remoto!, 'refs', 'heads', 'main.lock');
    fs.writeFileSync(trava, '');
    const r1 = passo(m, 'arco-qe29');
    assert.deepEqual([r1.acao, motivoDe(r1)], ['aguardar', 'noctum.entrega.git-falhou'], resumo(r1));
    fs.rmSync(trava, { force: true });
    const r2 = passo(m, 'arco-qe29');
    assert.equal(r2.acao, 'integrou', resumo(r2));
    assert.equal(lerLedger(dirThread(m.p.dir, e.t.id)).filter(x => x.tipo === EVENTO_DO_PUSH_RECUSADO).length, 0);
  } finally { m.p.limpar(); }
});

test('QE30: o push incerto do arco que não chegou, e o merge que o dono fez depois: o registro diz que outro caminho incorporou', { skip: semKernel }, () => {
  const m = mundo('noctum-qe30');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe30');
    arco(m.p, 'arco-qe30', e.t.id);
    const alvoQueNaoChegou = 'f'.repeat(40);
    registrar(dirThread(m.p.dir, e.t.id), e.t.id, EVENTO_DO_PUSH_INCERTO, { arco: 'arco-qe30', base: 'main', alvo: alvoQueNaoChegou,
      mergeSha: alvoQueNaoChegou, fonte: e.fonte, remoto: 'origin', lido: null, provas: 'a'.repeat(64), falhasRegistradas: [], erro: 'SIMULADO: prazo' });
    // O dono mescla a branch à mão e empurra.
    assert.equal(git(m.p.dir, 'merge', '--no-ff', '-q', '-m', 'merge do dono SIMULADO', branchDaWorktree(e.t)).ok, true);
    assert.equal(git(m.p.dir, 'push', '-q', 'origin', 'main').ok, true);
    const r = passo(m, 'arco-qe30');
    assert.equal(r.acao, 'reconciliou', resumo(r));
    const ship = entregas(m, e.t.id).at(-1)!;
    assert.equal((ship.evidencia as { incorporadaPor: unknown }).incorporadaPor, 'outro-caminho');
    assert.match(String(ship.autorizadoPor), /de fora do arco/);
  } finally { m.p.limpar(); }
});

test('QE31: o commit do bundle que falha (um gancho) espera como git-falhou e deixa a worktree limpa', { skip: semKernel }, () => {
  const m = mundo('noctum-qe31');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe31');
    arco(m.p, 'arco-qe31', e.t.id);
    // Uma claim nova deixa o bundle da fonte velho: o passo atualiza o candidato (só o bundle, sem merge).
    claimDe(m.p, e.t.id, 'core/src/qe31.ts', 'o código de qe31 continua existindo');
    const ganchos = path.resolve(m.p.dir, git(m.p.dir, 'rev-parse', '--git-common-dir').stdout.trim(), 'hooks');
    fs.mkdirSync(ganchos, { recursive: true });
    fs.writeFileSync(path.join(ganchos, 'pre-commit'),
      '#!/bin/sh\nif git diff --cached --name-only | grep -q "^.ork-ci/"; then echo "gancho SIMULADO: bundle" >&2; exit 1; fi\nexit 0\n');
    fs.chmodSync(path.join(ganchos, 'pre-commit'), 0o755);
    const r = passo(m, 'arco-qe31');
    assert.deepEqual([r.acao, motivoDe(r)], ['aguardar', 'noctum.entrega.git-falhou'], resumo(r));
    assert.equal(git(e.t.worktree!, 'status', '--porcelain').stdout.trim(), '', 'a worktree ficou limpa');
    assert.equal(head(e.t.worktree!), e.fonte);
  } finally { m.p.limpar(); }
});

test('QE32: o trabalho entregue que a supervisão isolou depois não recebe o MASTER do arco', { skip: semKernel }, () => {
  const m = mundo('noctum-qe32');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe32');
    arco(m.p, 'arco-qe32', e.t.id);
    assert.equal(passo(m, 'arco-qe32').acao, 'publicou');
    m.ci[e.fonte] = 'success';
    assert.equal(passo(m, 'arco-qe32').acao, 'integrou');
    gravarNaSupervisao(m.p.carregado, 'arco-qe32', [{ tipo: 'isolado', trabalho: 'a', thread: e.t.id, motivo: 'condutor-externo',
      detalhe: 'SIMULADO: o dono despachou o MASTER à mão' }]);
    const r = passo(m, 'arco-qe32');
    assert.deepEqual([r.acao, motivoDe(r)], ['bloqueado', 'noctum.entrega.isolado'], resumo(r));
  } finally { m.p.limpar(); }
});

test('QE33: a publicação confere o envelope com o relógio da hora do push, e não com o instante de quem chamou o passo', { skip: semKernel }, () => {
  const m = mundo('noctum-qe33');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe33');
    const fim = Date.now() + 6000;
    arco(m.p, 'arco-qe33', e.t.id, janelaQueFecha(fim));
    const ci = ciFalso({});
    const lento: ExecutorCi = (x) => { while (Date.now() <= fim + 200) passar(50); return ci(x); };
    const r = passo(m, 'arco-qe33', { executorCi: lento, quando: new Date().toISOString() });
    assert.deepEqual([r.acao, motivoDe(r)], ['bloqueado', 'noctum.efeito.expirado'], resumo(r));
    assert.equal(navegarAoRemoto(m, e), '', 'nada foi ao remoto depois do fim da janela');
  } finally { m.p.limpar(); }
});

test('QE34: o despacho do CHECK sob a trava usa o relógio de agora, e não o instante de quem chamou o passo', { skip: semKernel }, () => {
  const m = mundo('noctum-qe34');
  try {
    const { t } = threadSemRevisao(m, 'qe34');
    const fim = Date.now() + 6000;
    arco(m.p, 'arco-qe34', t.id, janelaQueFecha(fim));
    const ci = ciFalso({});
    const lento: ExecutorCi = (x) => { while (Date.now() <= fim + 200) passar(50); return ci(x); };
    const r = passo(m, 'arco-qe34', { executorCi: lento, quando: new Date().toISOString() });
    assert.notEqual(r.acao, 'revisao-pedida', resumo(r));
    assert.equal(m.abertas.length, 0, 'nenhum CHECK saiu depois do fim da janela');
  } finally { m.p.limpar(); }
});

test('QE35: a falha de transporte com "gh00" e um dígito no endereço do remoto espera, como no QE19', { skip: semKernel }, () => {
  const m = mundo('noctum-qe35');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe35');
    arco(m.p, 'arco-qe35', e.t.id);
    assert.equal(passo(m, 'arco-qe35').acao, 'publicou');
    m.ci[e.fonte] = 'success';
    git(m.p.dir, 'config', 'remote.origin.pushurl', path.join(m.p.dir, 'acme-gh001-ferramentas.git'));
    const r1 = passo(m, 'arco-qe35');
    assert.deepEqual([r1.acao, motivoDe(r1)], ['aguardar', 'noctum.entrega.git-falhou'], resumo(r1));
    git(m.p.dir, 'config', '--unset', 'remote.origin.pushurl');
    assert.equal(passo(m, 'arco-qe35').acao, 'integrou');
  } finally { m.p.limpar(); }
});

test('QE36: o padrão de segredo no título ou no corpo do PR (o pr-body.md da thread) não vai à forja: o PR não abre, e o passo bloqueia sem imprimir o trecho', { skip: semKernel }, () => {
  const m = mundo('noctum-qe36');
  m.gh = ghFalso(m.p);
  try {
    const e = entregaPronta(m.p, 'qe36');
    arco(m.p, 'arco-qe36', e.t.id);
    // R4-B1 da rodada 4: o pr-body.md fica fora do git, e a varredura da história não o lê; a chave é SIMULADA.
    const chave = ['AKIA', 'SIMULADA00000000'].join('');
    const corpo = path.join(dirThread(m.p.dir, e.t.id), 'pr-body.md');
    fs.writeFileSync(corpo, `# Entrega SIMULADA\n\nO log do teste tinha a chave ${chave}.\n`);
    const r1 = passo(m, 'arco-qe36');
    assert.deepEqual([r1.acao, motivoDe(r1)], ['bloqueado', 'noctum.entrega.segredo'], resumo(r1));
    assert.match(resumo(r1), /chave de acesso AWS na linha 3 do corpo/);
    assert.equal(m.gh.criacoes(), 0, 'o PR com o segredo não foi aberto');
    // A branch é limpa (a varredura da história passou) e o push dela sai; só o PR espera o corpo sem segredo.
    assert.equal(lsRemote(m.p, `refs/heads/${branchDaWorktree(e.t)}`), e.fonte);
    assert.ok(!resumo(r1).includes(chave), 'o resultado não imprime o segredo');
    assert.ok(!lerLedger(dirThread(m.p.dir, e.t.id)).some(x => JSON.stringify(x).includes(chave)), 'o ledger não guarda o segredo');
    // O título vem do primeiro cabeçalho do corpo: o segredo nele também bloqueia.
    fs.writeFileSync(corpo, `# Entrega ${chave}\n\nsem mais nada.\n`);
    const r2 = passo(m, 'arco-qe36');
    assert.deepEqual([r2.acao, motivoDe(r2)], ['bloqueado', 'noctum.entrega.segredo'], resumo(r2));
    assert.match(resumo(r2), /no título/);
    assert.equal(m.gh.criacoes(), 0);
    fs.writeFileSync(corpo, '# Entrega SIMULADA\n\nO corpo sem segredo.\n');
    const r3 = passo(m, 'arco-qe36');
    assert.equal(r3.acao, 'publicou', resumo(r3));
    assert.equal(m.gh.criacoes(), 1);
  } finally { m.p.limpar(); }
});

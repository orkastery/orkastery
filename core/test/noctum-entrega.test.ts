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
import { autorizarPedido, pedidoV2, prepararIngressoSimulado, revogarArco } from './noctum-apoio';
import { avancarBase, CAB, ciFalso, claimDe, commitarBundle, commitarNaWorktree, commitDaSessao, concluirBloco, concluirRevisao,
  despachoDoCheck, ENTRADA_DA_THREAD, entregaPronta, EstadoDoCheck, FORJA, ghFalso, git, head, projetoDaEntrega, SessaoSimulada,
  sessaoDespachada, threadComWorktree, verifyDoPasso } from './noctum-entrega-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import { blocosNaoPublicados, linhasDaBasePerdidas } from '../src/noctum-changelog';
import { lerArco } from '../src/noctum-arco';
import { decidirEntrega, EntradaDaDecisao, EVENTO_DA_ATUALIZACAO_RECUSADA, LIMITE_DE_REVISOES, OpcoesDaEntrega, passoDaEntrega,
  ResultadoDaEntrega } from '../src/noctum-entrega';
import { classificarCommit, ProvasDaEntrega } from '../src/noctum-provas';
import { dirThread, lerThread } from '../src/thread';
import { branchDaWorktree } from '../src/worktree';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const MAQUINA = 'maquina-simulada';

function arco(p: ProjetoDeTeste, nome: string, threadId: string): void {
  const pedido = pedidoV2(nome, { trabalhos: [{ id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], thread: threadId }], revisao: 1 });
  pedido.destinos = [{ repositorio: FORJA.repositorio, base: 'main', permissoes: ['push', 'pr', 'merge'] }];
  autorizarPedido(p.dir, nome, pedido);
}

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
  } finally { m.p.limpar(); }
});

test('QE2: sem revisão independente (o bloco inteiro numa sessão), o arco despacha o CHECK pela reserva de revisão e depois publica', { skip: semKernel }, () => {
  const m = mundo('noctum-qe2');
  m.gh = ghFalso(m.p);
  try {
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
    incorporada: false, destino: { ok: true, podeMerge: true }, provas: provasCom(falhas), atualizacaoRecusada: false, revisoesDespachadas: 0,
    publicacao: { acao: 'ja-publicada', detalhe: '' }, ...extra });
  const acao = (d: ReturnType<typeof decidirEntrega>) => `${d.acao}${'motivo' in d ? `:${d.motivo}` : ''}`;
  assert.equal(acao(decidirEntrega(entrada({}, { entregue: true, masterPendente: true }))), 'master');
  assert.equal(acao(decidirEntrega(entrada({}, { entregue: true }))), 'nada');
  assert.equal(acao(decidirEntrega(entrada({}, { destino: { ok: false, motivo: 'noctum.entrega.fora-do-destino', detalhe: 'x' } }))), 'bloqueado:noctum.entrega.fora-do-destino');
  assert.equal(acao(decidirEntrega(entrada({}, { incorporada: true }))), 'reconciliar');
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
  assert.equal(acao(decidirEntrega(entrada({}))), 'integrar');
});

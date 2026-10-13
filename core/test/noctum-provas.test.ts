/**
 * RM-058 (N5, D2, D3, D6, D7, D8 e D11 da ork-rm058n5): as provas da entrega no SHA exato. O aceite da tabela de fatias vira
 * teste: as provas negativas recusam revisor sem vínculo, SHA alterado, CI vermelho ou ausente, segredo e mutante relevante
 * sobrevivente, e as falhas de build concorrente continuam registradas. O remoto é um bare de verdade; sessões, pareceres,
 * verifies e o CI são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, ProjetoDeTeste } from './apoio';
import { avancarBase, ciFalso, claimDe, commitarBundle, commitarNaWorktree, commitDaSessao, concluirRevisao, ENTRADA_DA_THREAD,
  EntregaPronta, entregaPronta, EstadoDoCheck, FORJA, git, head, projetoDaEntrega, sessaoDespachada, threadComWorktree,
  verifyNoLedger } from './noctum-entrega-apoio';
import { passar } from './noctum-apoio';
import { avaliarProvas, classificarCommit, FatosDaEntrega, lerFatosDaEntrega, provasDaEntrega, ProvasDaEntrega } from '../src/noctum-provas';
import { resolverConflitosAditivos } from '../src/noctum-changelog';
import { adicionarClaim, lerClaims } from '../src/claims';
import { registrar } from '../src/ledger';
import { dirThread, gravarThread, lerThread } from '../src/thread';

const provas = (p: ProjetoDeTeste, id: string, estados: Record<string, EstadoDoCheck> = {}): ProvasDaEntrega =>
  provasDaEntrega(p.carregado, id, { forja: FORJA, executorCi: ciFalso(estados) });
const motivo = (r: ProvasDaEntrega, id: string) => r.provas.find(x => x.id === id)?.motivo ?? null;
const falhas = (r: ProvasDaEntrega) => r.provas.filter(x => !x.ok).map(x => `${x.id}:${x.motivo}`);
const verde = (e: EntregaPronta): Record<string, EstadoDoCheck> => ({ [e.fonte]: 'success' });

test('QP0: com revisão independente vinculada, verify, mutante, CHANGELOG, bundle, base e CI no SHA, todas as provas valem', () => {
  const p = projetoDaEntrega('noctum-qp0');
  try {
    const e = entregaPronta(p, 'qp0');
    const r = provas(p, e.t.id, verde(e));
    assert.deepEqual(falhas(r), []);
    assert.equal(r.ok, true);
    assert.equal(r.fonte, e.fonte);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.falhasRegistradas, []);
    assert.equal(r.provas.find(x => x.id === 'revisao')?.evidencia.sessionId, e.revisor.sessionId);
  } finally { p.limpar(); }
});

test('QP1: revisor sem vínculo recusa: sem CHECK do núcleo, sessão não verificada, prompt trocado, sem verificação e sem resultado', () => {
  const p = projetoDaEntrega('noctum-qp1');
  try {
    // A sessão do bloco grava o próprio parecer dizendo-se revisora independente: nome de papel não conta.
    const t = threadComWorktree(p, 'qp1');
    const autor = sessaoDespachada(p, t.id, 'GOAL');
    const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD('qp1')}\n\n`);
    const produto = commitarNaWorktree(t, { 'core/src/qp1.ts': 'export const a = 1;\n', 'CHANGELOG.md': changelog }, 'feat: qp1');
    commitDaSessao(p, t.id, autor, produto);
    claimDe(p, t.id, 'core/src/qp1.ts', 'Mutante M1: a guarda de qp1 cai no teste');
    const fonte = commitarBundle(p, t);
    concluirRevisao(p, t.id, autor, 'PASSOU', fonte, { semResultado: true });
    fs.appendFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'check.md'), '\nRevisor independente: sim (papel no prompt)\n');
    assert.equal(motivo(provas(p, t.id, { [fonte]: 'success' }), 'revisao'), 'noctum.entrega.revisao-ausente');

    const casos: Array<[string, () => void, string]> = [
      ['não verificada', () => { const s = sessaoDespachada(p, t.id, 'CHECK', { verificada: false }); concluirRevisao(p, t.id, s, 'PASSOU', fonte); },
        'noctum.entrega.revisao-sem-vinculo'],
      ['prompt trocado', () => {
        const s = sessaoDespachada(p, t.id, 'CHECK');
        const sessao = lerThread(p.dir, t.id).sessoes.find(x => x.sessionId === s.sessionId)!;
        fs.appendFileSync(path.join(p.dir, sessao.promptPath!), 'texto acrescentado depois do despacho\n');
        concluirRevisao(p, t.id, s, 'PASSOU', fonte);
      }, 'noctum.entrega.revisao-sem-vinculo'],
      ['sem phase_dispatch_verified', () => { const s = sessaoDespachada(p, t.id, 'CHECK', { semVerificacao: true }); concluirRevisao(p, t.id, s, 'PASSOU', fonte); },
        'noctum.entrega.revisao-sem-vinculo'],
      ['resultado de fora do observador', () => { const s = sessaoDespachada(p, t.id, 'CHECK'); concluirRevisao(p, t.id, s, 'PASSOU', fonte, { origem: 'manual' }); },
        'noctum.entrega.revisao-em-curso'],
      ['sem resultado', () => { const s = sessaoDespachada(p, t.id, 'CHECK'); concluirRevisao(p, t.id, s, 'PASSOU', fonte, { semResultado: true }); },
        'noctum.entrega.revisao-em-curso'],
      ['mesmo id da autora', () => { const s = sessaoDespachada(p, t.id, 'CHECK', { sessionId: autor.sessionId }); concluirRevisao(p, t.id, s, 'PASSOU', fonte); },
        'noctum.entrega.revisor-autor'],
      ['revisor que commitou', () => { const s = sessaoDespachada(p, t.id, 'CHECK'); commitDaSessao(p, t.id, s, fonte); concluirRevisao(p, t.id, s, 'PASSOU', fonte); },
        'noctum.entrega.revisor-autor'],
      ['CHECK que pede mudança', () => { const s = sessaoDespachada(p, t.id, 'CHECK'); concluirRevisao(p, t.id, s, 'PRECISA DE MUDANÇA', fonte); },
        'noctum.entrega.revisao-reprovada'],
      ['CHECK sem verify no intervalo', () => { const s = sessaoDespachada(p, t.id, 'CHECK'); concluirRevisao(p, t.id, s, 'PASSOU', null); },
        'noctum.entrega.revisao-sem-sha'],
    ];
    for (const [nome, preparar, esperado] of casos) {
      preparar();
      assert.equal(motivo(provas(p, t.id, { [fonte]: 'success' }), 'revisao'), esperado, nome);
    }
    // Uma sessão de CHECK distinta, vinculada, com PASSOU no SHA: passa.
    const boa = sessaoDespachada(p, t.id, 'CHECK');
    concluirRevisao(p, t.id, boa, 'PASSOU', fonte);
    assert.equal(motivo(provas(p, t.id, { [fonte]: 'success' }), 'revisao'), null);
    // O verify que outro roda depois do resultado (o do arco, por exemplo) não vira o SHA revisado.
    verifyNoLedger(p, t.id, produto);
    assert.equal(provas(p, t.id, { [fonte]: 'success' }).provas.find(x => x.id === 'revisao')!.evidencia.revisado, fonte);
    // O parecer reescrito depois do resultado não é mais o que o observador viu.
    fs.appendFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'check.md'), '\nLinha escrita depois do resultado.\n');
    assert.equal(motivo(provas(p, t.id, { [fonte]: 'success' }), 'revisao'), 'noctum.entrega.revisao-antiga');
    // Sem a prova gravada no resultado (o caminho do codex): o parecer do intervalo e o último verify até o resultado.
    const semProva = sessaoDespachada(p, t.id, 'CHECK', { runtime: 'codex' });
    concluirRevisao(p, t.id, semProva, 'PASSOU', fonte, { semProvaGravada: true });
    verifyNoLedger(p, t.id, produto);
    const r = provas(p, t.id, { [fonte]: 'success' });
    assert.equal(motivo(r, 'revisao'), null);
    assert.equal(r.provas.find(x => x.id === 'revisao')!.evidencia.revisado, fonte);
    // A5 da rodada 1: sem o sha que o observador viu, o parecer reescrito depois do resultado também não vale.
    passar(5);
    fs.appendFileSync(path.join(dirThread(p.dir, t.id), 'docs', 'check.md'), '\nReescrito depois do resultado do codex.\n');
    assert.equal(motivo(provas(p, t.id, { [fonte]: 'success' }), 'revisao'), 'noctum.entrega.revisao-antiga');
  } finally { p.limpar(); }
});

test('QP2: SHA alterado recusa: commit de produto depois da revisão invalida revisão, verify e CI; só o bundle é neutro para o verify', () => {
  const p = projetoDaEntrega('noctum-qp2');
  try {
    const e = entregaPronta(p, 'qp2');
    const depois = commitarNaWorktree(e.t, { 'core/src/qp2.ts': 'export const qp2 = 2;\n' }, 'feat: mudança depois do CHECK');
    const r = provas(p, e.t.id, verde(e));
    assert.equal(r.fonte, depois);
    assert.equal(motivo(r, 'revisao'), 'noctum.entrega.revisao-antiga');
    assert.equal(motivo(r, 'verify'), 'noctum.entrega.verify-ausente');
    assert.equal(motivo(r, 'ci'), 'noctum.entrega.ci-pendente', 'o verde de outro SHA não vale');
    assert.equal(r.ok, false);

    // Revisão e verify no produto, e só o bundle depois: os dois valem; o CI, só no SHA exato.
    const q = projetoDaEntrega('noctum-qp2b');
    try {
      const t = threadComWorktree(q, 'qp2b');
      const autor = sessaoDespachada(q, t.id, 'GOAL');
      const changelog = fs.readFileSync(path.join(t.worktree!, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${ENTRADA_DA_THREAD('qp2b')}\n\n`);
      const produto = commitarNaWorktree(t, { 'core/src/qp2b.ts': 'export const b = 1;\n', 'CHANGELOG.md': changelog }, 'feat: qp2b');
      commitDaSessao(q, t.id, autor, produto);
      claimDe(q, t.id, 'core/src/qp2b.ts', 'Mutante M1: a guarda de qp2b cai');
      const revisor = sessaoDespachada(q, t.id, 'CHECK');
      concluirRevisao(q, t.id, revisor, 'PASSOU', produto);
      const bundle = commitarBundle(q, t);
      const rb = provas(q, t.id, { [produto]: 'success' });
      assert.deepEqual([motivo(rb, 'revisao'), motivo(rb, 'verify'), motivo(rb, 'ci')], [null, null, 'noctum.entrega.ci-pendente']);
      assert.deepEqual(falhas(provas(q, t.id, { [bundle]: 'success' })), []);
    } finally { q.limpar(); }
  } finally { p.limpar(); }
});

test('QP2c: merge da base depois da revisão: o limpo e o só de CHANGELOG pela regra são neutros; código, ajuste e branch de fora não', () => {
  const p = projetoDaEntrega('noctum-qp2c');
  try {
    // A base tem um arquivo que a thread e a base vão mexer no mesmo lugar.
    avancarBase(p, { 'core/src/comum.ts': 'export const lista = [\n  1,\n];\n' }, 'feat: comum');
    const e = entregaPronta(p, 'qp2c');
    const wt = e.t.worktree!;
    const mesclar = (alvo: string, msg: string) => git(wt, '-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', '-m', msg, alvo);
    // 1. Merge limpo da base: neutro para a revisão, não para o verify.
    const b1 = avancarBase(p, { 'docs/outra.md': '# outra\n' }, 'docs: outra entrega');
    assert.equal(mesclar(b1, 'Merge da base limpa').ok, true);
    git(wt, 'commit', '-q', '--no-edit');
    const limpo = head(wt);
    assert.equal(classificarCommit(p.dir, limpo, b1).tipo, 'merge-mecanico');
    let r = provas(p, e.t.id, { [limpo]: 'success' });
    assert.deepEqual([motivo(r, 'revisao'), motivo(r, 'verify')], [null, 'noctum.entrega.verify-ausente']);
    // 2. Conflito só no CHANGELOG, resolvido pela regra do núcleo: ainda neutro.
    const changelogDaBase = fs.readFileSync(path.join(p.dir, 'CHANGELOG.md'), 'utf8')
      .replace('### Adicionado\n\n', '### Adicionado\n\n- **Outra SIMULADA** (RM-959): da base.\n\n');
    const b2 = avancarBase(p, { 'CHANGELOG.md': changelogDaBase }, 'docs: changelog da outra');
    assert.equal(mesclar(b2, 'Merge da base com CHANGELOG').ok, false, 'conflito no CHANGELOG');
    const comMarcas = fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8');
    const resolvido = resolverConflitosAditivos(comMarcas);
    assert.ok(resolvido.ok);
    fs.writeFileSync(path.join(wt, 'CHANGELOG.md'), resolvido.ok ? resolvido.texto : '');
    git(wt, 'add', '--', 'CHANGELOG.md');
    git(wt, 'commit', '-q', '--no-edit');
    const soChangelog = head(wt);
    const c2 = classificarCommit(p.dir, soChangelog, b2);
    assert.deepEqual([c2.tipo, c2.conflitos], ['merge-mecanico', ['CHANGELOG.md']], c2.detalhe);
    r = provas(p, e.t.id, { [soChangelog]: 'success' });
    assert.equal(motivo(r, 'revisao'), null);
    // 3. Conflito de código resolvido pela regra: pede revisão nova.
    commitarNaWorktree(e.t, { 'core/src/comum.ts': 'export const lista = [\n  1,\n  2,\n];\n' }, 'feat: a thread acrescenta 2');
    const b3 = avancarBase(p, { 'core/src/comum.ts': 'export const lista = [\n  1,\n  3,\n];\n' }, 'feat: a base acrescenta 3');
    assert.equal(mesclar(b3, 'Merge da base com código').ok, false);
    const codigo = resolverConflitosAditivos(fs.readFileSync(path.join(wt, 'core/src/comum.ts'), 'utf8'));
    assert.ok(codigo.ok);
    fs.writeFileSync(path.join(wt, 'core/src/comum.ts'), codigo.ok ? codigo.texto : '');
    git(wt, 'add', '--', 'core/src/comum.ts');
    git(wt, 'commit', '-q', '--no-edit');
    const deCodigo = head(wt);
    assert.equal(classificarCommit(p.dir, deCodigo, b3).tipo, 'merge-de-codigo');
    assert.equal(fs.readFileSync(path.join(wt, 'core/src/comum.ts'), 'utf8'), 'export const lista = [\n  1,\n  3,\n  2,\n];\n', 'a base primeiro');
    // 4. Merge limpo com uma mudança a mais no commit de merge: ajuste.
    const b4 = avancarBase(p, { 'docs/mais.md': '# mais\n' }, 'docs: mais');
    assert.equal(mesclar(b4, 'Merge com ajuste').ok, true);
    fs.writeFileSync(path.join(wt, 'core/src/qp2c.ts'), 'export const qp2c = 99;\n');
    git(wt, 'add', '--', 'core/src/qp2c.ts');
    git(wt, 'commit', '-q', '--no-edit');
    assert.equal(classificarCommit(p.dir, head(wt), b4).tipo, 'merge-com-ajuste');
    // 5. Merge de uma branch que não está na base.
    git(p.dir, 'checkout', '-q', '-b', 'lateral', b4);
    fs.writeFileSync(path.join(p.dir, 'lateral.txt'), 'de fora\n');
    git(p.dir, 'add', '--', 'lateral.txt');
    git(p.dir, 'commit', '-q', '-m', 'feat: lateral');
    const lateral = head(p.dir);
    git(p.dir, 'checkout', '-q', 'main');
    assert.equal(mesclar(lateral, 'Merge de fora').ok, true);
    git(wt, 'commit', '-q', '--no-edit');
    assert.equal(classificarCommit(p.dir, head(wt), b4).tipo, 'merge-de-fora');
    r = provas(p, e.t.id, { [head(wt)]: 'success' });
    assert.equal(motivo(r, 'revisao'), 'noctum.entrega.revisao-antiga');
  } finally { p.limpar(); }
});

test('QP3: CI vermelho recusa; pendente, sem check ou de outro SHA espera; consulta que falha é lacuna; sem CI obrigatório recusa', () => {
  const p = projetoDaEntrega('noctum-qp3');
  try {
    const e = entregaPronta(p, 'qp3');
    const casos: Array<[EstadoDoCheck, string]> = [['failure', 'noctum.entrega.ci-vermelho'], ['pending', 'noctum.entrega.ci-pendente'],
      ['missing', 'noctum.entrega.ci-pendente'], ['erro', 'noctum.entrega.ci-sem-leitura']];
    for (const [estado, esperado] of casos) assert.equal(motivo(provas(p, e.t.id, { [e.fonte]: estado }), 'ci'), esperado, estado);
    assert.equal(motivo(provas(p, e.t.id, { [e.produto]: 'success' }), 'ci'), 'noctum.entrega.ci-pendente', 'verde de outro SHA');
    ajustarManifesto(p, 'required_for_ship: true', 'required_for_ship: false');
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'ci'), 'noctum.entrega.ci-ausente');
  } finally { p.limpar(); }
});

test('QP4: segredo nas linhas acrescentadas recusa, com o nome do padrão, o arquivo e a linha, sem o trecho', () => {
  const p = projetoDaEntrega('noctum-qp4');
  try {
    // A chave falsa é montada por partes: o próprio teste não carrega o padrão que ele procura.
    const chave = ['sk', 'ant', 'SIMULADA0000000000000000000000'].join('-');
    const e = entregaPronta(p, 'qp4');
    commitarNaWorktree(e.t, { 'core/src/config-qp4.ts': `// configuração\nexport const usar = '${chave}';\n` }, 'feat: config');
    const r = provas(p, e.t.id);
    const s = r.provas.find(x => x.id === 'segredo')!;
    assert.equal(s.motivo, 'noctum.entrega.segredo');
    assert.match(s.detalhe, /chave da Anthropic em core\/src\/config-qp4\.ts:2/);
    assert.ok(!JSON.stringify(r).includes(chave), 'o segredo não aparece em lugar nenhum das provas');
  } finally { p.limpar(); }
});

test('QP5: mutante sobrevivente recusa; código sem claim de mutante recusa; só docs dispensa; mutante sem veredito roda de novo', () => {
  const p = projetoDaEntrega('noctum-qp5');
  try {
    const e = entregaPronta(p, 'qp5');
    const ativas = (sobrevive: string | null, motivoDela = 'claims.failed') => [e.mutante!, 'C1'].filter(Boolean).map(id =>
      ({ id, verificado: id !== sobrevive, motivo: id === sobrevive ? motivoDela : null }));
    verifyNoLedger(p, e.t.id, e.fonte, { ok: false, motivos: ['claims.failed'], claims: ativas(e.mutante) });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'mutantes'), 'noctum.entrega.mutante-sobrevivente');
    verifyNoLedger(p, e.t.id, e.fonte, { ok: false, motivos: ['verify.timeout'], claims: ativas(e.mutante, 'verify.timeout') });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'mutantes'), 'noctum.entrega.mutante-nao-executado');

    const q = projetoDaEntrega('noctum-qp5b');
    try {
      const sem = entregaPronta(q, 'qp5b', { semMutante: true });
      const r = provas(q, sem.t.id, verde(sem));
      assert.equal(motivo(r, 'mutantes'), 'noctum.entrega.mutantes-ausentes');
      assert.match(r.provas.find(x => x.id === 'mutantes')!.detalhe, /core\/src\/qp5b\.ts/);
      // Só documentação: o mutante não se aplica, e a evidência diz os arquivos.
      const docs = entregaPronta(q, 'qp5c', { semMutante: true, arquivos: { 'docs/guia-qp5c.md': '# Guia SIMULADO\n' } });
      const rd = provas(q, docs.t.id, verde(docs));
      assert.equal(motivo(rd, 'mutantes'), null);
      assert.deepEqual(rd.provas.find(x => x.id === 'mutantes')!.evidencia.arquivos, ['.ork-ci/' + docs.t.id + '.json', 'docs/guia-qp5c.md']);
    } finally { q.limpar(); }
  } finally { p.limpar(); }
});

test('QP6: falha de build concorrente fica registrada; duas reprovações no SHA bloqueiam; verify sem baseline recusa', () => {
  const p = projetoDaEntrega('noctum-qp6');
  try {
    const e = entregaPronta(p, 'qp6');
    // O verify do CHECK passou; a rodada seguinte, com build concorrente, reprovou: ela entra na prova, e uma rodada isolada decide.
    const primeira = verifyNoLedger(p, e.t.id, e.fonte, { ok: false, motivos: ['verify.regression'] });
    let r = provas(p, e.t.id, verde(e));
    assert.equal(motivo(r, 'verify'), 'noctum.entrega.verify-reprovado');
    const isolada = verifyNoLedger(p, e.t.id, e.fonte);
    r = provas(p, e.t.id, verde(e));
    assert.equal(motivo(r, 'verify'), null);
    assert.deepEqual(r.falhasRegistradas.map(f => f.eventId), [primeira], 'a falha anterior continua registrada');
    assert.equal(r.provas.find(x => x.id === 'verify')!.evidencia.ultimo, isolada);
    // Duas reprovações seguidas no mesmo SHA: falha consistente.
    verifyNoLedger(p, e.t.id, e.fonte, { ok: false, motivos: ['claims.failed'] });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'verify'), 'noctum.entrega.verify-falha-consistente');
    // Verde sem baseline não vale.
    verifyNoLedger(p, e.t.id, e.fonte, { baseline: false });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'verify'), 'noctum.entrega.baseline-ausente');
    // A claim cadastrada depois do verify não rodou nele e pediria outra rodada; com seis no SHA, o teto já passou (A2 da
    // rodada 1; o QP10 prova a repetição antes do teto).
    verifyNoLedger(p, e.t.id, e.fonte);
    claimDe(p, e.t.id, 'core/src/qp6.ts', 'claim nova depois do verify');
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'verify'), 'noctum.entrega.verify-esgotado');
  } finally { p.limpar(); }
});

test('QP7: a base que andou invalida o candidato; o CHANGELOG sem linha e o bundle velho também recusam', () => {
  const p = projetoDaEntrega('noctum-qp7');
  try {
    const e = entregaPronta(p, 'qp7');
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'integracao'), null);
    const nova = avancarBase(p, { 'docs/x.md': '# x\n' }, 'docs: a base anda');
    const r = provas(p, e.t.id, verde(e));
    assert.equal(motivo(r, 'integracao'), 'noctum.entrega.base-mudou');
    assert.equal(r.base.sha, nova);
    // O CHANGELOG sem a linha da thread.
    const q = projetoDaEntrega('noctum-qp7b');
    try {
      const sem = entregaPronta(q, 'qp7b', { arquivos: { 'core/src/qp7b.ts': 'export const x = 1;\n' } });
      assert.equal(motivo(provas(q, sem.t.id, verde(sem)), 'changelog'), 'noctum.entrega.changelog');
      // O bundle que não tem a claim nova.
      claimDe(q, sem.t.id, 'core/src/qp7b.ts', 'outra claim');
      assert.equal(motivo(provas(q, sem.t.id, verde(sem)), 'bundle'), 'noctum.entrega.bundle-velho');
    } finally { q.limpar(); }
  } finally { p.limpar(); }
});

test('QP8: o sha256 das provas é o mesmo para os mesmos fatos e muda quando uma prova muda', () => {
  const p = projetoDaEntrega('noctum-qp8');
  try {
    const e = entregaPronta(p, 'qp8');
    const fatos = lerFatosDaEntrega(p.carregado, e.t.id, { forja: FORJA, executorCi: ciFalso(verde(e)) });
    assert.equal(avaliarProvas(fatos).sha256, avaliarProvas(JSON.parse(JSON.stringify(fatos))).sha256);
    assert.equal(avaliarProvas(fatos).sha256, provas(p, e.t.id, verde(e)).sha256);
    assert.notEqual(provas(p, e.t.id, { [e.fonte]: 'pending' }).sha256, provas(p, e.t.id, verde(e)).sha256);
    // A sessão de CHECK que some do thread.json leva a prova junto.
    const t = lerThread(p.dir, e.t.id);
    gravarThread(p.dir, { ...t, sessoes: t.sessoes.filter(s => s.sessionId !== e.revisor.sessionId) });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'revisao'), 'noctum.entrega.revisao-ausente');
    // Um evento que não é prova não muda o sha256.
    const antes = provas(p, e.t.id, verde(e)).sha256;
    registrar(dirThread(p.dir, e.t.id), e.t.id, 'nota', { texto: 'sem efeito nas provas' });
    assert.equal(provas(p, e.t.id, verde(e)).sha256, antes);
  } finally { p.limpar(); }
});

const copiar = (f: FatosDaEntrega): FatosDaEntrega => JSON.parse(JSON.stringify(f)) as FatosDaEntrega;

test('QP9: o segredo depois do primeiro MiB do diff, em arquivo binário e em linha que começa por "++" recusa; a leitura que falha é lacuna', () => {
  const p = projetoDaEntrega('noctum-qp9');
  try {
    const chave = ['sk', 'ant', 'SIMULADA0000000000000000000000'].join('-');
    const e = entregaPronta(p, 'qp9');
    // B1: mais de 1 MiB de linhas acrescentadas antes da chave; o teto padrão do spawnSync cortaria o diff antes dela.
    const grande = Array.from({ length: 24000 }, (_, i) => `export const linha${i} = '${'x'.repeat(40)}';`).join('\n') + '\n';
    commitarNaWorktree(e.t, {
      'core/src/aa-grande-qp9.ts': grande,
      'core/src/zz-config-qp9.ts': `// configuração\nexport const usar = '${chave}';\n`,
      // A6: o byte nulo faz o git chamar o arquivo de binário; a chave dentro dele conta do mesmo jeito.
      'docs/zz-anexo-qp9.bin': `\u0000\u0001cabeçalho\nchave=${chave}\n`,
      // X9: dentro do hunk, a linha acrescentada que começa por "++" é conteúdo, e não o cabeçalho do arquivo.
      'docs/zz-notas-qp9.md': `# Notas\n++ ${chave}\n`,
    }, 'feat: grande, binário e notas');
    const r = provas(p, e.t.id);
    const s = r.provas.find(x => x.id === 'segredo')!;
    assert.equal(s.motivo, 'noctum.entrega.segredo', s.detalhe);
    for (const onde of ['core/src/zz-config-qp9.ts:2', 'docs/zz-anexo-qp9.bin:2', 'docs/zz-notas-qp9.md:2']) assert.ok(s.detalhe.includes(onde), `${onde} em ${s.detalhe}`);
    assert.ok(!JSON.stringify(r).includes(chave), 'o segredo não aparece em lugar nenhum das provas');
    // A leitura que falha é lacuna, nunca "nada mudou": o diff, a cadeia, o commit sem classificação, o CHANGELOG e o bundle.
    const fatos = lerFatosDaEntrega(p.carregado, e.t.id, { forja: FORJA, executorCi: ciFalso({}) });
    assert.equal(fatos.diffLido, true);
    const lacuna = 'noctum.entrega.git-sem-leitura';
    const semDiff = avaliarProvas({ ...copiar(fatos), diffLido: false, segredos: [] });
    assert.deepEqual(['segredo', 'mutantes', 'changelog'].map(id => motivo(semDiff, id)), [lacuna, lacuna, lacuna]);
    const semCadeia = avaliarProvas({ ...copiar(fatos), cadeiaLida: false, cadeia: [] });
    assert.deepEqual(['revisao', 'verify', 'mutantes'].map(id => motivo(semCadeia, id)), [lacuna, lacuna, lacuna]);
    const comCommitSemLeitura = copiar(fatos);
    comCommitSemLeitura.cadeia[0] = { ...comCommitSemLeitura.cadeia[0], tipo: 'sem-leitura', detalhe: 'os pais do commit não se leram' };
    assert.deepEqual(['revisao', 'verify'].map(id => motivo(avaliarProvas(comCommitSemLeitura), id)), [lacuna, lacuna]);
    assert.equal(motivo(avaliarProvas({ ...copiar(fatos), changelog: null }), 'changelog'), lacuna);
    assert.equal(motivo(avaliarProvas({ ...copiar(fatos), bundle: { ok: false, lido: false, texto: 'o bundle não se leu' } }), 'bundle'), lacuna);
  } finally { p.limpar(); }
});

test('QP10: o teto de rodadas por SHA vale para toda repetição; a claim de mutante sem comando não conta como mutante', () => {
  const p = projetoDaEntrega('noctum-qp10');
  try {
    const e = entregaPronta(p, 'qp10');
    const antigas = lerClaims(p.dir, e.t.id).filter(c => c.estado !== 'retirada').map(c => ({ id: c.id, verificado: true, motivo: null }));
    // A2: a claim cadastrada depois do verify pede outra rodada; com três rodadas no SHA, a prova não pede a quarta.
    claimDe(p, e.t.id, 'core/src/qp10.ts', 'claim nova depois do verify');
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'verify'), 'noctum.entrega.verify-ausente');
    verifyNoLedger(p, e.t.id, e.fonte, { claims: antigas });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'verify'), 'noctum.entrega.verify-ausente');
    verifyNoLedger(p, e.t.id, e.fonte, { claims: antigas });
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'verify'), 'noctum.entrega.verify-esgotado');
    const q = projetoDaEntrega('noctum-qp10b');
    try {
      const f = entregaPronta(q, 'qp10b');
      const fatos = lerFatosDaEntrega(q.carregado, f.t.id, { forja: FORJA, executorCi: ciFalso(verde(f)) });
      // O mutante sem veredito num verify verde pede outra rodada, e o teto vale para ele.
      const semVeredito = (n: number): FatosDaEntrega => {
        const c = copiar(fatos);
        const v = c.verifies.at(-1)!;
        v.claims = v.claims.map(x => (x.id === f.mutante ? { ...x, verificado: false, motivo: null } : x));
        c.verifies = Array.from({ length: n }, (_, i) => ({ ...v, eventId: `verify-${i}` }));
        return c;
      };
      assert.deepEqual([motivo(avaliarProvas(semVeredito(1)), 'mutantes'), motivo(avaliarProvas(semVeredito(1)), 'verify')],
        ['noctum.entrega.mutante-nao-executado', null]);
      assert.equal(motivo(avaliarProvas(semVeredito(3)), 'verify'), 'noctum.entrega.verify-esgotado');
      // A claim "Mutante" sem comando não executa nada: o código sem mutante de verdade recusa (mutantes-ausentes).
      const sem = entregaPronta(q, 'qp10c', { semMutante: true });
      adicionarClaim(q.dir, sem.t.id, { arquivo: 'core/src/qp10c.ts', alegacao: 'Mutante M9: sem comando nenhum', verificar: [], semProvaLocal: true });
      assert.equal(motivo(provas(q, sem.t.id, verde(sem)), 'mutantes'), 'noctum.entrega.mutantes-ausentes');
      // "Mutantes", no plural, com comando, é claim de mutante.
      claimDe(q, sem.t.id, 'core/src/qp10c.ts', 'Mutantes M1 e M2: as guardas de qp10c caem no teste');
      assert.equal(motivo(provas(q, sem.t.id, verde(sem)), 'mutantes'), 'noctum.entrega.mutante-nao-executado');
    } finally { q.limpar(); }
  } finally { p.limpar(); }
});

test('QP11: guardas da revisão e da recomputação: autor despachado depois do CHECK, commit de bundle e produto, CHANGELOG fora da regra e conflito sem conteúdo', () => {
  const p = projetoDaEntrega('noctum-qp11');
  try {
    const e = entregaPronta(p, 'qp11');
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'revisao'), null);
    // X1: uma sessão de GO despachada depois do CHECK escreve depois da revisão: a revisão ficou antiga.
    sessaoDespachada(p, e.t.id, 'GO');
    assert.equal(motivo(provas(p, e.t.id, verde(e)), 'revisao'), 'noctum.entrega.revisao-antiga');
  } finally { p.limpar(); }
  const q = projetoDaEntrega('noctum-qp11b');
  try {
    avancarBase(q, { 'core/src/apagavel.ts': 'export const a = 1;\n' }, 'feat: apagável');
    const e = entregaPronta(q, 'qp11b');
    const wt = e.t.worktree!;
    // X2: o commit que mexe no bundle e no código é produto, e o verify de antes não vale para ele.
    const bundle = `.ork-ci/${e.t.id}.json`;
    const misto = commitarNaWorktree(e.t, { [bundle]: `${fs.readFileSync(path.join(wt, bundle), 'utf8')}\n`, 'core/src/qp11b-extra.ts': 'export const x = 2;\n' },
      'feat: bundle e produto no mesmo commit');
    assert.equal(classificarCommit(q.dir, misto, head(q.dir)).tipo, 'produto');
    assert.equal(motivo(provas(q, e.t.id, { [misto]: 'success' }), 'verify'), 'noctum.entrega.verify-ausente');
    // X3: o conflito do CHANGELOG resolvido com a thread antes da base tem as mesmas linhas, e não é o que a regra produz.
    const mesclar = (alvo: string, msg: string) => git(wt, '-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', '-m', msg, alvo);
    const outra = '- **Outra SIMULADA** (RM-959): da base.';
    const b1 = avancarBase(q, { 'CHANGELOG.md': fs.readFileSync(path.join(q.dir, 'CHANGELOG.md'), 'utf8').replace('### Adicionado\n\n', `### Adicionado\n\n${outra}\n\n`) },
      'docs: changelog da outra');
    assert.equal(mesclar(b1, 'Merge com o CHANGELOG fora da regra').ok, false);
    const certo = resolverConflitosAditivos(fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8'));
    assert.ok(certo.ok);
    const entrada = ENTRADA_DA_THREAD('qp11b');
    const trocado = certo.ok ? certo.texto.replace(`${outra}\n\n${entrada}`, `${entrada}\n\n${outra}`) : '';
    assert.notEqual(trocado, certo.ok ? certo.texto : '');
    fs.writeFileSync(path.join(wt, 'CHANGELOG.md'), trocado);
    git(wt, 'add', '--', 'CHANGELOG.md');
    git(wt, 'commit', '-q', '--no-edit');
    const c3 = classificarCommit(q.dir, head(wt), b1);
    assert.equal(c3.tipo, 'merge-com-ajuste');
    assert.match(c3.detalhe, /não é o que a regra do núcleo produz/);
    // X15: o arquivo que a thread muda e a base apaga conflita sem conteúdo dos dois lados: ajuste de alguém, nunca a regra.
    commitarNaWorktree(e.t, { 'core/src/apagavel.ts': 'export const a = 2;\n' }, 'feat: a thread muda o apagável');
    git(q.dir, 'rm', '-q', '--', 'core/src/apagavel.ts');
    git(q.dir, 'commit', '-q', '-m', 'feat: a base apaga o apagável');
    git(q.dir, 'push', '-q', 'origin', 'main');
    const b2 = head(q.dir);
    assert.equal(mesclar(b2, 'Merge com o apagado').ok, false);
    git(wt, 'add', '--', 'core/src/apagavel.ts');
    git(wt, 'commit', '-q', '--no-edit');
    const c15 = classificarCommit(q.dir, head(wt), b2);
    assert.equal(c15.tipo, 'merge-com-ajuste');
    assert.match(c15.detalhe, /não é de conteúdo/);
  } finally { q.limpar(); }
});

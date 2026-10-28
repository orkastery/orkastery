/**
 * RM-058 (N5, D9 e D10 da ork-rm058n5): a integração da entrega amarrada ao SHA. O remoto é um bare de verdade: o merge, o
 * push sem força, a recusa da base que andou e a prova pelo `ls-remote` são do git. O envelope é autorizado pelo ingresso
 * SIMULADO do Telegram (como na N1 e na N2), e o CI é falso.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, ProjetoDeTeste } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado, revogarArco } from './noctum-apoio';
import { avancarBase, ciFalso, EntregaPronta, entregaPronta, EstadoDoCheck, FORJA, git, head, projetoDaEntrega,
  redeDaEntrega } from './noctum-entrega-apoio';
import { renderizarEstado, renderizarRelance, separarFrontmatter, verificarDocs, Documento } from '../src/docs';
import { kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { lerLedger, TIPOS_DE_EVENTO } from '../src/ledger';
import { CONTRATO_ENVELOPE_V3, RecusaDoArco } from '../src/noctum-envelope';
import { identidadeDaMaquina } from '../src/noctum-transporte';
import { candidatoDaEntrega, caminhoDaTravaDoDestino, integradorDaEntrega, integrarNoDestino, passoDaEntrega } from '../src/noctum-entrega';
import { provasDaEntrega, RecusaDaEntrega } from '../src/noctum-provas';
import { gravarNaSupervisao } from '../src/noctum-supervisao';
import { dirThread, lerThread } from '../src/thread';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { lerYaml } from '../src/yaml';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

/** O arco com o trabalho da thread e o destino com push, PR e merge. */
function arcoDaEntrega(p: ProjetoDeTeste, arco: string, threadId: string, permissoes = ['push', 'pr', 'merge']): string {
  const pedido = pedidoV2(arco, { trabalhos: [{ id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], thread: threadId }], revisao: 1 });
  pedido.destinos = [{ repositorio: FORJA.repositorio, base: 'main', permissoes }];
  return autorizarPedido(p.dir, arco, pedido);
}

/** Autoriza a entrega v3 e, quando pedido, deixa a ordem local aceita no ramo de coordenação. */
function arcoV3DaEntrega(p: ProjetoDeTeste, arco: string, e: EntregaPronta, comOrdem = true,
  trabalhos: Array<Record<string, unknown>> = [{ id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], thread: e.t.id }]): string | null {
  const naMaquina = trabalhos.map(t => t.thread ? { ...t, maquina: String(t.maquina ?? 'maquina-a') } : t);
  const pedido = pedidoV2(arco, { trabalhos: naMaquina as any, revisao: 1 });
  Object.assign(pedido, { contrato: CONTRATO_ENVELOPE_V3, maquinas: [identidadeDaMaquina(p.dir, 'maquina-a')],
    trabalhos: naMaquina, destinos: [{ repositorio: FORJA.repositorio, base: 'main', permissoes: ['push', 'pr', 'merge'] }],
    capacidadeGlobal: { porConta: [{ conta: 'perfil-a', sessoes: 2 }] } });
  autorizarPedido(p.dir, arco, pedido);
  return comOrdem ? 'O-a-1' : null;
}

/** Publica a branch da thread no remoto bare, como o `publicarEntrega` deixaria. */
function publicarBranch(e: EntregaPronta): void {
  assert.equal(git(e.t.worktree!, 'push', '-q', 'origin', `HEAD:refs/heads/${branchDaWorktree(e.t)}`).ok, true);
}

const lsRemote = (p: ProjetoDeTeste, ref: string): string =>
  git(p.dir, 'ls-remote', 'origin', ref).stdout.split(/\s+/)[0] ?? '';

// R2-A4 da rodada 2: o instante dado aqui é o relógio da conferência (o `quando` de quem chama não vale para ela).
const integrar = (p: ProjetoDeTeste, arco: string, id: string, ci: Record<string, EstadoDoCheck>, quando?: string) =>
  integrarNoDestino(p.carregado, arco, id, { forja: FORJA, executorCi: ciFalso(ci), ...(quando ? { relogio: () => quando } : {}) });

test('QI1: o merge tem a base e a fonte conferidas como pais e a árvore da fonte; o ls-remote prova; o ship_done leva as provas', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi1');
  try {
    const e = entregaPronta(p, 'qi1');
    publicarBranch(e);
    const envelope = arcoDaEntrega(p, 'arco-qi1', e.t.id);
    const base = lsRemote(p, 'refs/heads/main');
    const r = integrar(p, 'arco-qi1', e.t.id, { [e.fonte]: 'success' });
    assert.equal(lsRemote(p, 'refs/heads/main'), r.pontaDaBase, 'a base no remoto é a ponta empurrada');
    assert.equal(r.mergeSha, r.pontaDaBase, 'sem página do item, a ponta é o próprio merge');
    assert.equal(git(p.dir, 'rev-parse', `${r.mergeSha}^1`).stdout.trim(), base, 'o primeiro pai é a base conferida');
    assert.equal(git(p.dir, 'rev-parse', `${r.mergeSha}^2`).stdout.trim(), e.fonte, 'o segundo pai é a fonte conferida');
    assert.equal(git(p.dir, 'rev-parse', `${r.mergeSha}^{tree}`).stdout.trim(), git(p.dir, 'rev-parse', `${e.fonte}^{tree}`).stdout.trim());
    assert.match(git(p.dir, 'log', '-1', '--format=%s', r.mergeSha).stdout, new RegExp(`^ship\\(${e.t.id}\\): merge de `));
    const ship = lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido);
    assert.equal(ship.length, 1);
    assert.deepEqual([ship[0].mergeSha, ship[0].pontaDaBase, ship[0].shaRemoto, ship[0].shaDe, ship[0].pushVerificado, ship[0].tipoDeAutorizacao],
      [r.mergeSha, r.pontaDaBase, r.pontaDaBase, e.fonte, true, 'noctum']);
    const evidencia = ship[0].evidencia as Record<string, any>;
    assert.equal(evidencia.provas.sha256, r.provas);
    assert.equal(evidencia.envelopeSha256, envelope);
    assert.equal(lerThread(p.dir, e.t.id).faseAtual, 'SHIP');
  } finally { p.limpar(); }
});

test('QI2: a base que anda depois das provas recusa o push sem força: base-mudou, e nada vai ao ledger', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi2');
  try {
    const e = entregaPronta(p, 'qi2');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi2', e.t.id);
    // A consulta do CI acontece depois de a base ser lida: outro clone empurra a base nesse meio.
    let andou = '';
    const clone = dirTemporario('noctum-qi2-clone');
    const ci = ciFalso({ [e.fonte]: 'success' });
    const comCorrida = (x: Parameters<typeof ci>[0]) => {
      if (!andou) {
        assert.equal(exec('git', ['clone', '-q', p.remoto!, clone]).ok, true);
        exec('git', ['config', 'user.email', 'teste@orkastery.local'], clone);
        exec('git', ['config', 'user.name', 'Teste Orkastery'], clone);
        fs.writeFileSync(path.join(clone, 'outra.txt'), 'outra entrega\n');
        exec('git', ['add', '--', 'outra.txt'], clone);
        exec('git', ['commit', '-q', '-m', 'feat: outra entrega no meio'], clone);
        assert.equal(exec('git', ['push', '-q', 'origin', 'main'], clone).ok, true);
        andou = exec('git', ['rev-parse', 'HEAD'], clone).stdout.trim();
      }
      return ci(x);
    };
    assert.throws(() => integrarNoDestino(p.carregado, 'arco-qi2', e.t.id, { forja: FORJA, executorCi: comCorrida }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.base-mudou');
    assert.equal(lsRemote(p, 'refs/heads/main'), andou, 'a base ficou com a entrega do outro');
    assert.equal(lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
    fs.rmSync(clone, { recursive: true, force: true });
  } finally { p.limpar(); }
});

test('QI3: o envelope revogado ou expirado recusa logo antes do merge, e a base não muda', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi3');
  try {
    const e = entregaPronta(p, 'qi3');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi3', e.t.id);
    const base = lsRemote(p, 'refs/heads/main');
    const depoisDoFim = new Date(Date.now() + 8 * 3600_000).toISOString();
    assert.throws(() => integrar(p, 'arco-qi3', e.t.id, { [e.fonte]: 'success' }, depoisDoFim),
      (x: unknown) => x instanceof RecusaDoArco && x.motivo === 'noctum.efeito.expirado');
    revogarArco(p.dir, 'arco-qi3');
    assert.throws(() => integrar(p, 'arco-qi3', e.t.id, { [e.fonte]: 'success' }),
      (x: unknown) => x instanceof RecusaDoArco && x.motivo === 'noctum.efeito.revogado');
    assert.equal(lsRemote(p, 'refs/heads/main'), base);
    // Sem merge no envelope, nem tenta.
    const q = projetoDaEntrega('noctum-qi3b');
    try {
      const f = entregaPronta(q, 'qi3b');
      publicarBranch(f);
      arcoDaEntrega(q, 'arco-qi3b', f.t.id, ['push', 'pr']);
      assert.throws(() => integrar(q, 'arco-qi3b', f.t.id, { [f.fonte]: 'success' }),
        (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fora-do-destino');
    } finally { q.limpar(); }
  } finally { p.limpar(); }
});

test('QI4: um integrador por destino nesta máquina; as provas que não valem recusam antes de qualquer efeito', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi4');
  try {
    const e = entregaPronta(p, 'qi4');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi4', e.t.id);
    const base = lsRemote(p, 'refs/heads/main');
    const fd = tentarTravaExclusiva(caminhoDaTravaDoDestino(p.dir, { repositorio: FORJA.repositorio, base: 'main' }));
    assert.notEqual(fd, null);
    try {
      assert.throws(() => integrar(p, 'arco-qi4', e.t.id, { [e.fonte]: 'success' }),
        (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.integracao-ocupada');
    } finally { fs.closeSync(fd!); }
    // CI vermelho: recusa pelo motivo da prova, sem merge.
    assert.throws(() => integrar(p, 'arco-qi4', e.t.id, { [e.fonte]: 'failure' }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.ci-vermelho');
    // A branch no remoto atrás da fonte: o CI não rodou nela.
    exec('git', ['commit', '-q', '--allow-empty', '-m', 'feat: commit que não foi ao remoto'], e.t.worktree!);
    assert.throws(() => integrar(p, 'arco-qi4', e.t.id, { [head(e.t.worktree!)]: 'success' }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fonte-mudou');
    assert.equal(lsRemote(p, 'refs/heads/main'), base);
  } finally { p.limpar(); }
});

/** Uma página de roadmap válida do item da thread, com o `estado.codigo` em Branch criada. */
function paginaDoItem(threadId: string): string {
  const fm = `
id: RM-958
tipo: roadmap
titulo: Entrega SIMULADA
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-10-13T01:00:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Rascunho
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ${threadId}
  modo: "#Auto"`;
  const doc = { dados: lerYaml(fm) as Record<string, never> } as unknown as Documento;
  return `---\n${fm.trim()}\n---\n\n# RM-958: Entrega SIMULADA\n\n> **Em uma frase:** a página que ficaria vermelha depois do merge.\n\n` +
    `<!-- ork-docs:relance:inicio -->\n${renderizarRelance(doc)}\n<!-- ork-docs:relance:fim -->\n\n## Problema e resultado\n\n` +
    '- **Problema:** o estado envelhece no merge.\n\n## Escopo e validação\n\n- **Incluído:** a entrega.\n\n## Plano e decisões\n\n' +
    '- **Prioridade:** alta.\n\n## Estado com evidências\n\n' +
    `<!-- ork-docs:estado:inicio -->\n${renderizarEstado(doc)}\n<!-- ork-docs:estado:fim -->\n\n## Responsabilidades e histórico\n\n- **RACI:** Julio.\n`;
}

/** Os erros do `docs verificar` estrito do item numa revisão, por uma worktree e uma branch temporárias nela. */
function errosDoItemEm(p: ProjetoDeTeste, revisao: string): string[] {
  const dir = path.join(dirTemporario('noctum-qi5-docs'), 'wt');
  const ramo = `qi5-${revisao.slice(0, 8)}`;
  assert.equal(git(p.dir, 'worktree', 'add', '-q', '--detach', dir, revisao).ok, true);
  git(p.dir, 'branch', ramo, revisao);
  try {
    return verificarDocs(dir, { baseBranch: ramo }).achados.filter(a => a.gravidade === 'erro' && a.id === 'RM-958').map(a => a.regra);
  } finally {
    git(p.dir, 'worktree', 'remove', '--force', dir);
    git(p.dir, 'branch', '-D', ramo);
  }
}

test('QI5: a página do item que deixaria a main vermelha ganha o estado derivado no mesmo push, e o docs verificar estrito passa', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi5');
  try {
    // A thread traz, com o código, a página do item dela em Branch criada (o primeiro corte de código do item).
    const e = entregaPronta(p, 'qi5', { arquivos: (t) => ({ 'docs/roadmap/RM-958-entrega.md': paginaDoItem(t.id) }) });
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi5', e.t.id);
    const r = integrar(p, 'arco-qi5', e.t.id, { [e.fonte]: 'success' });
    assert.notEqual(r.docs.commit, null, 'o estado derivado vai num commit');
    assert.deepEqual(r.docs.itens, ['RM-958']);
    assert.equal(r.pontaDaBase, r.docs.commit);
    assert.equal(lsRemote(p, 'refs/heads/main'), r.docs.commit, 'o merge e o estado derivado saem no mesmo push');
    assert.equal(git(p.dir, 'rev-parse', `${r.docs.commit}^`).stdout.trim(), r.mergeSha);
    const pagina = git(p.dir, 'show', `${r.docs.commit}:docs/roadmap/RM-958-entrega.md`).stdout;
    const dados = lerYaml(separarFrontmatter(pagina).bruto!) as Record<string, any>;
    assert.equal(dados.estado.codigo, 'Mesclado');
    assert.equal(dados.evidencias.codigo.commit, r.mergeSha.slice(0, 7));
    // Sem o commit derivado, a main ficaria vermelha; com ele, o verificador estrito não acusa o item.
    assert.ok(errosDoItemEm(p, r.mergeSha).includes('docs.paridade.merge'), 'o merge sozinho reprova em docs.paridade.merge');
    assert.deepEqual(errosDoItemEm(p, r.docs.commit!), []);
    const ship = lerLedger(dirThread(p.dir, e.t.id)).find(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido)!;
    assert.deepEqual([ship.mergeSha, ship.pontaDaBase, (ship.evidencia as Record<string, any>).docs.commit], [r.mergeSha, r.docs.commit, r.docs.commit]);
  } finally { p.limpar(); }
});

test('QI6: a integração na forma do Integrador da N3 confere o candidato: fonte, base e provas de outro estado recusam', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi6');
  try {
    // A-R3D-1 da revisão da ork-rm058n3: com a página do item, o push leva os docs derivados em cima do merge.
    const e = entregaPronta(p, 'qi6', { arquivos: (t) => ({ 'docs/roadmap/RM-958-entrega.md': paginaDoItem(t.id) }) });
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi6', e.t.id);
    const opcoes = { forja: FORJA, executorCi: ciFalso({ [e.fonte]: 'success' }) };
    const provas = provasDaEntrega(p.carregado, e.t.id, opcoes);
    const candidato = candidatoDaEntrega(provas);
    assert.ok(candidato, 'as provas valem, e o candidato sai');
    const integrador = integradorDaEntrega(p.carregado, 'arco-qi6', e.t.id, opcoes);
    const destino = { repositorio: FORJA.repositorio, base: 'main' };
    assert.throws(() => integrador({ remoto: 'origin', destino, candidato: { ...candidato!, provas: '0'.repeat(64) } }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.nao-provada');
    assert.throws(() => integrador({ remoto: 'origin', destino, candidato: { ...candidato!, fonte: e.produto } }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fonte-mudou');
    assert.throws(() => integrador({ remoto: 'origin', destino, candidato: { ...candidato!, branch: 'ork/outra-full' } }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fonte-mudou');
    // X8: o candidato tomado sobre uma base mais velha (que a fonte também contém) não integra sobre a base de agora.
    const anterior = git(p.dir, 'rev-parse', `${candidato!.base}^`).stdout.trim();
    assert.throws(() => integrador({ remoto: 'origin', destino, candidato: { ...candidato!, base: anterior } }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.base-mudou');
    // S5 da rodada 1: o destino de outro repositório recusa.
    assert.throws(() => integrador({ remoto: 'origin', destino: { ...destino, repositorio: 'exemplo/outro' }, candidato: candidato! }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fora-do-destino');
    const r = integrador({ remoto: 'origin', destino, candidato: candidato! });
    // A-R3D-1 da revisão da ork-rm058n3: devolve o merge, com a base provada e a fonte como pais, que a N3 confere no remoto,
    // e não a ponta da base, que é o commit dos docs derivados em cima dele.
    assert.deepEqual(git(p.dir, 'rev-list', '--parents', '-n', '1', r.merge).stdout.trim().split(' ').slice(1), [candidato!.base, candidato!.fonte]);
    assert.equal(git(p.dir, 'rev-parse', `${lsRemote(p, 'refs/heads/main')}^`).stdout.trim(), r.merge, 'a base aponta para os docs derivados, em cima do merge');
  } finally { p.limpar(); }
});

test('QI7: a fonte que já está na base sem ship_done é reconciliada pelo passo, sem integrar de novo', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi7');
  try {
    const e = entregaPronta(p, 'qi7');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi7', e.t.id);
    // Outro caminho mesclou a fonte na base (o push incerto que chegou, por exemplo).
    git(p.dir, 'merge', '-q', '--no-ff', '-m', `ship(${e.t.id}): merge de fora`, e.fonte);
    git(p.dir, 'push', '-q', 'origin', 'main');
    const ponta = lsRemote(p, 'refs/heads/main');
    const r = passoDaEntrega(p.carregado, 'arco-qi7', { maquina: 'maquina-simulada', forja: FORJA, executorCi: ciFalso({}),
      lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-958', maquina: 'maquina-simulada', thread: null }] }) });
    assert.equal(r.acao, 'reconciliou', JSON.stringify(r));
    assert.ok(r.acao === 'reconciliou' && r.pontaDaBase === ponta && r.mergeSha === ponta);
    assert.equal(lsRemote(p, 'refs/heads/main'), ponta, 'nada foi empurrado de novo');
    const ship = lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido);
    assert.deepEqual([ship.length, ship[0]?.jaIncorporado], [1, true]);
  } finally { p.limpar(); }
});

test('QI8: a base forçada para trás entre as provas e o push recusa: o lease amarra o push à ponta conferida', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi8');
  try {
    const anterior = lsRemote(p, 'refs/heads/main');
    // A base ganha um commit que a fonte vai conter; depois, alguém o tira da base à força.
    avancarBase(p, { 'docs/tirado.md': '# um commit que a base vai tirar\n' }, 'docs: commit que sai da base');
    const e = entregaPronta(p, 'qi8');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi8', e.t.id);
    let forcada = false;
    const ci = ciFalso({ [e.fonte]: 'success' });
    const comForca = (x: Parameters<typeof ci>[0]) => {
      if (!forcada) {
        forcada = true;
        assert.equal(git(p.dir, 'push', '-q', '--force', 'origin', `${anterior}:refs/heads/main`).ok, true);
      }
      return ci(x);
    };
    // Sem o lease, o push seria de avanço sobre a base de agora e devolveria o commit que alguém tirou.
    assert.throws(() => integrarNoDestino(p.carregado, 'arco-qi8', e.t.id, { forja: FORJA, executorCi: comForca }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.base-mudou');
    assert.equal(lsRemote(p, 'refs/heads/main'), anterior, 'a base fica onde foi posta');
    assert.equal(lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
  } finally { p.limpar(); }
});

test('QI9: só a thread que é trabalho do envelope integra; a de outro item recusa antes de qualquer efeito', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi9');
  try {
    const e = entregaPronta(p, 'qi9');
    publicarBranch(e);
    const pedido = pedidoV2('arco-qi9', { trabalhos: [{ id: 'a', item: 'RM-111', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO de outro item.' }],
      revisao: 1 });
    pedido.destinos = [{ repositorio: FORJA.repositorio, base: 'main', permissoes: ['push', 'pr', 'merge'] }];
    autorizarPedido(p.dir, 'arco-qi9', pedido);
    const base = lsRemote(p, 'refs/heads/main');
    assert.throws(() => integrar(p, 'arco-qi9', e.t.id, { [e.fonte]: 'success' }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fora-do-envelope');
    assert.equal(lsRemote(p, 'refs/heads/main'), base);
  } finally { p.limpar(); }
});

test('QI10: a vez da N3 sobre outra base do projeto recusa, e o trabalho que a supervisão isolou não integra nem pela vez da N3', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi10');
  try {
    const e = entregaPronta(p, 'qi10');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi10', e.t.id);
    const opcoes = { forja: FORJA, executorCi: ciFalso({ [e.fonte]: 'success' }) };
    const candidato = candidatoDaEntrega(provasDaEntrega(p.carregado, e.t.id, opcoes));
    assert.ok(candidato, 'as provas valem, e o candidato sai');
    const base = lsRemote(p, 'refs/heads/main');
    const integrador = integradorDaEntrega(p.carregado, 'arco-qi10', e.t.id, opcoes);
    // R2-A6 da rodada 2: a vez da N3 numa base que não é a do projeto recusa antes de qualquer efeito.
    assert.throws(() => integrador({ remoto: 'origin', destino: { repositorio: FORJA.repositorio, base: 'outra' }, candidato: candidato! }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fora-do-destino');
    // R2-B1 da rodada 2: o trabalho isolado pela supervisão da N4 não integra, nem pela vez da N3.
    gravarNaSupervisao(p.carregado, 'arco-qi10', [{ tipo: 'isolado', trabalho: 'a', thread: e.t.id, motivo: 'efeito-divergente',
      detalhe: 'SIMULADO: outro sha na branch' }]);
    assert.throws(() => integrador({ remoto: 'origin', destino: { repositorio: FORJA.repositorio, base: 'main' }, candidato: candidato! }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.isolado');
    assert.equal(lsRemote(p, 'refs/heads/main'), base, 'a base não mudou');
    assert.equal(lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
  } finally { p.limpar(); }
});

test('QI11: o isolamento que a supervisão grava no meio da integração, depois da primeira conferência, recusa o push na base', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi11');
  try {
    const e = entregaPronta(p, 'qi11');
    publicarBranch(e);
    arcoDaEntrega(p, 'arco-qi11', e.t.id);
    const base = lsRemote(p, 'refs/heads/main');
    let isolou = false;
    const ci = ciFalso({ [e.fonte]: 'success' });
    // As provas relidas sob a trava leem o CI: o isolamento chega aí, depois da conferência do começo da integração.
    const executorCi: ReturnType<typeof ciFalso> = (x) => {
      if (!isolou) {
        isolou = true;
        gravarNaSupervisao(p.carregado, 'arco-qi11', [{ tipo: 'isolado', trabalho: 'a', thread: e.t.id, motivo: 'efeito-divergente',
          detalhe: 'SIMULADO: outro sha na branch' }]);
      }
      return ci(x);
    };
    assert.throws(() => integrarNoDestino(p.carregado, 'arco-qi11', e.t.id, { forja: FORJA, executorCi }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.isolado');
    assert.equal(isolou, true);
    assert.equal(lsRemote(p, 'refs/heads/main'), base, 'a base não mudou');
  } finally { p.limpar(); }
});

test('QI12: o trabalho que fixa a thread de outro item não integra, como a fila (item-divergente)', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi12');
  try {
    const e = entregaPronta(p, 'qi12');
    publicarBranch(e);
    const pedido = pedidoV2('arco-qi12', { trabalhos: [{ id: 'a', item: 'RM-111', prioridade: 1, dependeDe: [], thread: e.t.id }], revisao: 1 });
    pedido.destinos = [{ repositorio: FORJA.repositorio, base: 'main', permissoes: ['push', 'pr', 'merge'] }];
    autorizarPedido(p.dir, 'arco-qi12', pedido);
    const base = lsRemote(p, 'refs/heads/main');
    assert.throws(() => integrar(p, 'arco-qi12', e.t.id, { [e.fonte]: 'success' }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.fora-do-envelope');
    assert.equal(lsRemote(p, 'refs/heads/main'), base, 'a base não mudou');
  } finally { p.limpar(); }
});

test('QI13: com o envelope v3, o merge direto da N5 continua recusado sem a vez da N3', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi13');
  try {
    // A3 da revisão do merge com a N5 (ork-rm058n3): o arco entre máquinas integra pela vez da N3, e as duas guardas daqui o
    // seguram; a página da N3 se apoia nelas.
    const e = entregaPronta(p, 'qi13');
    publicarBranch(e);
    const pedido = pedidoV2('arco-qi13', { trabalhos: [{ id: 'a', item: 'RM-958', prioridade: 1, dependeDe: [], thread: e.t.id }], revisao: 1 });
    Object.assign(pedido, { contrato: CONTRATO_ENVELOPE_V3, maquinas: [identidadeDaMaquina(p.dir, 'maquina-a')],
      trabalhos: (pedido.trabalhos as Array<Record<string, unknown>>).map(t => ({ ...t, maquina: 'maquina-a' })),
      destinos: [{ repositorio: FORJA.repositorio, base: 'main', permissoes: ['push', 'pr', 'merge'] }],
      capacidadeGlobal: { porConta: [{ conta: 'perfil-a', sessoes: 2 }] } });
    autorizarPedido(p.dir, 'arco-qi13', pedido);
    const base = lsRemote(p, 'refs/heads/main');
    assert.throws(() => integrar(p, 'arco-qi13', e.t.id, { [e.fonte]: 'success' }),
      (x: unknown) => x instanceof RecusaDaEntrega && x.motivo === 'noctum.entrega.exige-vez-da-n3');
    assert.equal(lsRemote(p, 'refs/heads/main'), base, 'a base não mudou');
    assert.equal(lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
  } finally { p.limpar(); }
});

test('QI14: o passo v3 integra pela ordem aceita e pela vez publicada da N3', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi14');
  try {
    const e = entregaPronta(p, 'qi14');
    publicarBranch(e);
    const ordem = arcoV3DaEntrega(p, 'arco-qi14', e);
    const rede = redeDaEntrega('arco-qi14', 'maquina-a', [{ id: 'a', estado: 'em-execucao', maquina: 'maquina-a', maquinaPresa: 'maquina-a',
      ordem: { ordem: ordem!, numero: 1, maquina: 'maquina-a', estado: 'aceita', emitidaEm: '2026-10-13T03:00:00.000Z' }, entrega: null }]);
    let ordemVista = '';
    const r = passoDaEntrega(p.carregado, 'arco-qi14', { maquina: 'maquina-a', forja: FORJA,
      projecaoDaRede: rede, executorCi: ciFalso({ [e.fonte]: 'success' }),
      integrarPelaRede: (_carregado, _arco, pedido) => {
        ordemVista = pedido.ordem;
        return { trabalho: 'a', vez: 1, merge: pedido.candidato.fonte };
      },
      lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-958', maquina: 'maquina-a', thread: e.t.id }] }) });
    assert.equal(ordem, 'O-a-1');
    assert.equal(ordemVista, ordem);
    assert.ok(r.acao === 'integrou', JSON.stringify(r));
  } finally { p.limpar(); }
});

test('QI15: uma vez ativa de outra máquina faz o passo aguardar sem tentar merge', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi15');
  try {
    const e = entregaPronta(p, 'qi15');
    publicarBranch(e);
    arcoV3DaEntrega(p, 'arco-qi15', e);
    const rede = redeDaEntrega('arco-qi15', 'maquina-a', [{ id: 'a', estado: 'em-execucao', maquina: 'maquina-a', maquinaPresa: 'maquina-a',
      ordem: { ordem: 'O-a-1', numero: 1, maquina: 'maquina-a', estado: 'aceita', emitidaEm: '2026-10-13T03:00:00.000Z' }, entrega: null }]);
    const base = lsRemote(p, 'refs/heads/main');
    const r = passoDaEntrega(p.carregado, 'arco-qi15', { maquina: 'maquina-a', forja: FORJA,
      projecaoDaRede: rede, executorCi: ciFalso({ [e.fonte]: 'success' }),
      integrarPelaRede: () => { throw new RecusaDoArco('noctum.integracao.ocupada', 'a vez está com a máquina maquina-b'); },
      lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-958', maquina: 'maquina-a', thread: e.t.id }] }) });
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.integracao.ocupada', JSON.stringify(r));
    assert.equal(lsRemote(p, 'refs/heads/main'), base);
  } finally { p.limpar(); }
});

test('QI16: se a base avança depois das provas, a vez invalida o candidato e o passo aguarda', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi16');
  try {
    const e = entregaPronta(p, 'qi16');
    publicarBranch(e);
    arcoV3DaEntrega(p, 'arco-qi16', e);
    const rede = redeDaEntrega('arco-qi16', 'maquina-a', [{ id: 'a', estado: 'em-execucao', maquina: 'maquina-a', maquinaPresa: 'maquina-a',
      ordem: { ordem: 'O-a-1', numero: 1, maquina: 'maquina-a', estado: 'aceita', emitidaEm: '2026-10-13T03:00:00.000Z' }, entrega: null }]);
    const base = lsRemote(p, 'refs/heads/main');
    const r = passoDaEntrega(p.carregado, 'arco-qi16', { maquina: 'maquina-a', forja: FORJA, projecaoDaRede: rede,
      executorCi: ciFalso({ [e.fonte]: 'success' }),
      integrarPelaRede: () => { throw new RecusaDoArco('noctum.integracao.base-mudou', 'a base avançou depois das provas'); },
      lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-958', maquina: 'maquina-a', thread: e.t.id }] }) });
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.integracao.base-mudou', JSON.stringify(r));
    assert.equal(lsRemote(p, 'refs/heads/main'), base);
    assert.equal(lerLedger(dirThread(p.dir, e.t.id)).filter(x => x.tipo === TIPOS_DE_EVENTO.shipConcluido).length, 0);
  } finally { p.limpar(); }
});

test('QI17: trabalho entregue em outra máquina não publica, não abre PR e não integra de novo', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi17');
  try {
    const e = entregaPronta(p, 'qi17');
    arcoV3DaEntrega(p, 'arco-qi17', e, false);
    const base = lsRemote(p, 'refs/heads/main');
    const rede = redeDaEntrega('arco-qi17', 'maquina-a', [{ id: 'a', estado: 'entregue', maquina: 'maquina-b', ordem: null,
      maquinaPresa: null, entrega: { em: '2026-10-13T03:00:00.000Z', maquina: 'maquina-b', merge: 'b'.repeat(40) } }]);
    const r = passoDaEntrega(p.carregado, 'arco-qi17', { maquina: 'maquina-a', projecaoDaRede: rede, forja: FORJA,
      executorCi: () => assert.fail('não consulta CI de trabalho entregue fora') });
    assert.equal(r.acao, 'nada');
    assert.equal(lsRemote(p, 'refs/heads/main'), base);
  } finally { p.limpar(); }
});

test('QI18: ordem viva de outra máquina não vira publicação local', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi18');
  try {
    const e = entregaPronta(p, 'qi18');
    arcoV3DaEntrega(p, 'arco-qi18', e, false);
    const rede = redeDaEntrega('arco-qi18', 'maquina-a', [{ id: 'a', estado: 'em-execucao', maquina: 'maquina-b', maquinaPresa: null,
      ordem: { ordem: 'O-a-1', numero: 1, maquina: 'maquina-b', estado: 'aceita', emitidaEm: '2026-10-13T03:00:00.000Z' }, entrega: null }]);
    const r = passoDaEntrega(p.carregado, 'arco-qi18', { maquina: 'maquina-a', projecaoDaRede: rede, forja: FORJA,
      executorCi: () => assert.fail('não consulta CI da ordem de outra máquina') });
    assert.equal(r.acao, 'nada');
  } finally { p.limpar(); }
});

test('QI19: ordem cancelada na rede não produz efeito local', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi19');
  try {
    const e = entregaPronta(p, 'qi19');
    arcoV3DaEntrega(p, 'arco-qi19', e, false);
    const rede = redeDaEntrega('arco-qi19', 'maquina-a', [{ id: 'a', estado: 'livre', maquina: 'maquina-a', maquinaPresa: null,
      ordem: { ordem: 'O-a-1', numero: 1, maquina: 'maquina-a', estado: 'cancelada-antes', emitidaEm: '2026-10-13T03:00:00.000Z' }, entrega: null }]);
    const r = passoDaEntrega(p.carregado, 'arco-qi19', { maquina: 'maquina-a', projecaoDaRede: rede, forja: FORJA,
      executorCi: () => assert.fail('não consulta CI de ordem cancelada') });
    assert.equal(r.acao, 'nada');
  } finally { p.limpar(); }
});

test('QI20: lacuna na leitura da rede faz a entrega aguardar sem efeito', { skip: semKernel }, () => {
  const p = projetoDaEntrega('noctum-qi20');
  try {
    const e = entregaPronta(p, 'qi20');
    arcoV3DaEntrega(p, 'arco-qi20', e, false);
    const rede = redeDaEntrega('arco-qi20', 'maquina-a', [],
      { motivo: 'noctum.coordenacao.sem-remoto', detalhe: 'SIMULADO: ramo indisponível' });
    const r = passoDaEntrega(p.carregado, 'arco-qi20', { maquina: 'maquina-a', projecaoDaRede: rede, forja: FORJA,
      executorCi: () => assert.fail('não consulta CI sem rede') });
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.coordenacao.sem-remoto', JSON.stringify(r));
  } finally { p.limpar(); }
});

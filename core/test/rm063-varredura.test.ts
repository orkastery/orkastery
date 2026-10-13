/**
 * RM-063 (F5): a varredura que age.
 *
 * O incidente de 03 a 12/10/2026 (P4 e P5 da pagina da RM-063): o PR #112 foi mesclado e ficou dois dias sem
 * `ork ship registrar-pr`, e sessoes fantasmas de threads ja fechadas ficaram registradas, porque ninguem roda esses
 * comandos sem um condutor. Agora a batida age depois da entrega ao dono: com a autorizacao duravel do dono gravada nesta maquina
 * (`ork.autorizacao-duravel/v1`, fora do git), limpa as fantasmas, registra a entrega do PR ja mesclado e fecha pelo
 * MASTER por omissao, cada acao no ledger; sem autorizacao (ou com ela vencida), cada acao vira item da fila do pulse
 * com o comando pronto, e o resumo ao dono a mostra.
 *
 * Prova com o "GitHub" num segundo clone do remoto bare (o merge chega a esta maquina pela busca da batida), o stub
 * do `claude` (a fantasma e a sessao sem processo) e o transporte do resumo injetado. Nada toca rede, crontab ou gh.
 */
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, dirTemporario, projetoTemporario, ProjetoDeTeste, runtimeFalso } from './apoio';
import { caminhoDaAutorizacao, CONTRATO_DA_AUTORIZACAO, lerAutorizacao } from '../src/autorizacao-duravel';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { nomeDaMaquina } from '../src/maquina';
import { rodarFase } from '../src/phase';
import { montarPulse } from '../src/pulse';
import { agirDepoisDaEntrega, varrerPulse } from '../src/pulse-delivery';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { acoesPendentes, agirNaVarredura, VarreduraQueAge } from '../src/varredura-acoes';
import type { FantasmaTratado } from '../src/sessoes';
import { branchDaWorktree } from '../src/worktree';
import { estadoDaBatida, textoDoEstadoDaBatida } from '../src/fabrica-batida';
import { exec } from '../src/util';

// O inventario real le tambem o codex: a pasta dele e temporaria, nunca a da pessoa que roda o teste.
const codexAnterior = process.env.CODEX_HOME;
before(() => { process.env.CODEX_HOME = dirTemporario('rm063-f5-codex'); });
after(() => { if (codexAnterior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexAnterior; });

const SEM_RUNTIME = { ok: true, sessoes: [], detalhe: '' };
/** O runtime lido e vazio: nenhuma fantasma a soltar e nenhuma sessao viva na worktree. */
const SEM_SESSOES = { fantasmas: () => [], vivas: () => [] };
const HORA = 60 * 60 * 1000;

function autorizar(p: ProjetoDeTeste, campos: Record<string, unknown> = {}): string {
  const arquivo = caminhoDaAutorizacao(p.dir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ contrato: CONTRATO_DA_AUTORIZACAO, maquina: nomeDaMaquina(),
    projeto: p.carregado.manifesto.project.name, por: 'Dono Simulado', concedidaEm: new Date().toISOString(),
    ate: new Date(Date.now() + 24 * HORA).toISOString(), pode: ['limpar', 'registrar', 'master'], nota: 'X1.a simulada', ...campos }, null, 2));
  return arquivo;
}

/** O merge do PR feito no "GitHub": outro clone do remoto, a branch da thread e o merge `ship(<thread>)` empurrado. */
function mergeNoGithub(p: ProjetoDeTeste, thread: string): string {
  const outro = dirTemporario('rm063-f5-github');
  assert.equal(exec('git', ['clone', '-q', p.remoto as string, outro]).ok, true);
  for (const [k, v] of [['user.email', 'github@orkastery.local'], ['user.name', 'GitHub Simulado'], ['commit.gpgsign', 'false']]) {
    exec('git', ['config', k, v], outro);
  }
  exec('git', ['checkout', '-q', '-b', `ork/${thread}-pr`], outro);
  commitar(outro, 'entrega.txt', 'feito\n', `feat(${thread}): entrega da fatia`);
  exec('git', ['checkout', '-q', 'main'], outro);
  assert.equal(exec('git', ['merge', '--no-ff', '-q', '-m', `ship(${thread}): entrega da fatia (#112)`, `ork/${thread}-pr`], outro).ok, true);
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], outro).ok, true);
  const sha = exec('git', ['rev-parse', 'HEAD'], outro).stdout.trim();
  fs.rmSync(outro, { recursive: true, force: true });
  return sha;
}

/** O PR da branch da propria thread, empurrada e mesclada no "GitHub" com o merge `ship(<thread>)`. */
function mergeDaBranchNoGithub(p: ProjetoDeTeste, thread: string, branch: string): string {
  const outro = dirTemporario('rm063-f5-github');
  assert.equal(exec('git', ['clone', '-q', p.remoto as string, outro]).ok, true);
  for (const [k, v] of [['user.email', 'github@orkastery.local'], ['user.name', 'GitHub Simulado'], ['commit.gpgsign', 'false']]) {
    exec('git', ['config', k, v], outro);
  }
  assert.equal(exec('git', ['merge', '--no-ff', '-q', '-m', `ship(${thread}): entrega da fatia (#113)`, `origin/${branch}`], outro).ok, true);
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], outro).ok, true);
  const sha = exec('git', ['rev-parse', 'HEAD'], outro).stdout.trim();
  fs.rmSync(outro, { recursive: true, force: true });
  return sha;
}

const daVarredura = (dir: string) => lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.acaoDaVarredura);
const motivos = (r: VarreduraQueAge) => r.pendentes.map((a) => [a.acao, a.motivoDoBloqueio]);

test('F5: a autorizacao duravel vale so inteira, desta maquina, deste projeto e no prazo; cada recusa tem motivo tipado', () => {
  const p = projetoTemporario('rm063-f5-autorizacao');
  try {
    const projeto = p.carregado.manifesto.project.name;
    const ler = () => lerAutorizacao(p.dir, { projeto });
    assert.deepEqual([ler().valida, (ler() as { motivo: string }).motivo], [false, 'autorizacao.ausente']);
    const arquivo = autorizar(p);
    const valida = ler();
    assert.equal(valida.valida, true);
    assert.match(valida.valida ? valida.sha256 : '', /^[0-9a-f]{64}$/);
    const casos: [Record<string, unknown> | string, string][] = [
      ['{ nao e json', 'autorizacao.ilegivel'],
      [{ contrato: 'outro/v1' }, 'autorizacao.contrato'],
      [{ ate: 'amanha' }, 'autorizacao.campo'],
      // Sem fuso, o prazo dependeria do fuso de quem le; agente ou runtime nao autoriza nada.
      [{ ate: '2099-01-01T00:00:00' }, 'autorizacao.campo'],
      [{ por: 'claude' }, 'autorizacao.campo'],
      [{ por: 'Codex GPT-5' }, 'autorizacao.campo'],
      [{ pode: [] }, 'autorizacao.campo'],
      [{ pode: ['registrar', 'apagar-tudo'] }, 'autorizacao.acao-desconhecida'],
      [{ maquina: 'outra-maquina' }, 'autorizacao.outra-maquina'],
      [{ projeto: 'outro-projeto' }, 'autorizacao.outro-projeto'],
      [{ ate: new Date(Date.now() - HORA).toISOString() }, 'autorizacao.expirada'],
    ];
    for (const [campos, motivo] of casos) {
      if (typeof campos === 'string') fs.writeFileSync(arquivo, campos); else autorizar(p, campos);
      const l = ler();
      assert.deepEqual([l.valida, l.valida ? null : l.motivo], [false, motivo], JSON.stringify(campos));
    }
    // RM-047: versionada no git, ou link, nao vale.
    autorizar(p);
    assert.equal(exec('git', ['add', '-f', '--', arquivo], p.dir).ok, true);
    assert.deepEqual([ler().valida, (ler() as { motivo: string }).motivo], [false, 'autorizacao.rastreada']);
  } finally { p.limpar(); }
});

test('F5: sem autorizacao, o merge de branch ork/* na main sem ship_done aparece na batida seguinte como item da fila, com o comando', () => {
  const p = projetoTemporario('rm063-f5-fila', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'pr mesclado sem registro', modo: 'auto' });
    mergeNoGithub(p, thread.id);
    // Antes da batida, a copia local da base nao tem o merge: nada a registrar.
    assert.deepEqual(acoesPendentes(p.carregado, SEM_SESSOES).filter((a) => a.acao === 'registrar'), []);

    const r = agirNaVarredura(p.carregado, SEM_SESSOES);
    assert.deepEqual([r.busca?.ok, r.autorizacao.valida, r.feitas.length], [true, false, 0]);
    assert.deepEqual(r.pendentes.map((a) => [a.acao, a.thread, a.comando]), [['registrar', thread.id, `ork ship registrar-pr ${thread.id}`]]);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido), false, 'nada foi feito');

    const pulse = montarPulse(p.carregado, { consulta: SEM_RUNTIME });
    const item = pulse.precisaDeHumanoAgora.find((i) => i.id === `varredura:registrar:${thread.id}`);
    assert.ok(item, JSON.stringify(pulse.precisaDeHumanoAgora.map((i) => i.id)));
    assert.deepEqual([item!.classe, item!.motivo, item!.comandoResposta], ['varredura', 'varredura.registrar', `ork ship registrar-pr ${thread.id}`]);
    assert.match(item!.recomendacao, /autorize a ação registrar/);
    assert.equal(pulse.varredura?.autorizacao.estado, 'ausente');

    // O resumo da batida leva o item ao dono, com o comando.
    const enviadas: string[] = [];
    const v = varrerPulse({ raiz: p.dir, consultar: () => pulse, enviar: (m) => { enviadas.push(m); return true; } });
    assert.equal(v.code, 0, v.detalhe);
    assert.equal(enviadas.length, 1);
    assert.match(enviadas[0], /Arrumação que a varredura faria com a sua autorização: 1/);
    assert.match(enviadas[0], new RegExp(`ork ship registrar-pr ${thread.id}`));
  } finally { p.limpar(); }
});

test('F5: com a autorizacao, a batida registra a entrega do PR mesclado e, quieta a thread, fecha pelo MASTER por omissao', () => {
  const p = projetoTemporario('rm063-f5-age', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'pr mesclado com autorizacao', modo: 'auto' });
    const dir = dirThread(p.dir, thread.id);
    const merge = mergeNoGithub(p, thread.id);
    autorizar(p, { pode: ['registrar', 'master'] });

    const r1 = agirNaVarredura(p.carregado, SEM_SESSOES);
    assert.deepEqual(r1.feitas.map((f) => [f.acao, f.thread, f.resultado]), [['registrar', thread.id, 'feita']]);
    const ship = lerLedger(dir).filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido);
    assert.deepEqual(ship.map((e) => e.mergeSha), [merge]);
    const [acao] = daVarredura(dir);
    assert.deepEqual([acao.acao, acao.resultado, (acao.autorizacao as { por: string }).por, (acao.autorizacao as { nota: string }).nota],
      ['registrar', 'feita', 'Dono Simulado', 'X1.a simulada']);
    assert.match(String((acao.autorizacao as { sha256: string }).sha256), /^[0-9a-f]{64}$/);

    // Logo depois da entrega o MASTER espera: o condutor tem 30 min para o MASTER dele.
    assert.deepEqual(acoesPendentes(p.carregado, SEM_SESSOES).map((a) => a.acao), []);
    const depois = new Date(Date.now() + 31 * 60 * 1000).toISOString();
    const r2 = agirNaVarredura(p.carregado, { ...SEM_SESSOES, quando: depois, buscar: false });
    assert.deepEqual(r2.feitas.map((f) => [f.acao, f.resultado]), [['master', 'feita']]);
    assert.equal(lerThread(p.dir, thread.id).status, 'fechada', 'fechada pelo MASTER por omissao, com o indice no ledger');
    assert.equal(lerLedger(dir).some((e) => e.tipo === TIPOS_DE_EVENTO.aceitePorOmissao), true);

    // O que a varredura fez vai ao pulse (7 dias) e ao resumo do dono uma vez.
    const pulse = montarPulse(p.carregado, { consulta: SEM_RUNTIME, quando: depois });
    assert.deepEqual(pulse.varredura?.feitas.map((f) => f.acao), ['registrar', 'master']);
    assert.equal(pulse.precisaDeHumanoAgora.some((i) => i.classe === 'varredura'), false);
  } finally { p.limpar(); }
});

test('F5: com a autorizacao, a batida solta a sessao fantasma; sem ela, a fantasma e item da fila; vencida, nada e feito', (t) => {
  const p = projetoTemporario('rm063-f5-fantasma');
  const runtime = runtimeFalso('rm063-f5-fantasma');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'fantasma', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente a fatia' });
  assert.ok(r.sessionId, r.erro);
  // O daemon caiu: o registro continua no runtime, sem processo. Recem-despachada, ela ainda nao e fantasma para a
  // varredura (a sessao nova pode nao ter pid); 31 min sem sinal, e.
  runtime.pidDaSessao(null);
  assert.equal(montarPulse(p.carregado).precisaDeHumanoAgora.some((i) => i.classe === 'varredura'), false, 'fantasma nova nao e item');
  const depois = new Date(Date.now() + 31 * 60 * 1000).toISOString();

  const semAutorizacao = montarPulse(p.carregado, { quando: depois });
  const item = semAutorizacao.precisaDeHumanoAgora.find((i) => i.id === `varredura:limpar:${thread.id}:${r.sessionId!.slice(0, 8)}`);
  assert.ok(item, JSON.stringify(semAutorizacao.precisaDeHumanoAgora.map((i) => i.id)));
  assert.equal(item!.comandoResposta, 'ork sessions limpar-fantasmas');

  // Vencida: a varredura nao age, e o pulse diz por que.
  autorizar(p, { pode: ['limpar'], ate: new Date(Date.now() - HORA).toISOString() });
  const vencida = agirNaVarredura(p.carregado, { buscar: false, quando: depois });
  assert.deepEqual([vencida.feitas.length, (vencida.autorizacao as { motivo: string }).motivo], [0, 'autorizacao.expirada']);
  assert.equal(lerLedger(dir).some((e) => e.tipo === 'sessao_morta'), false);
  assert.deepEqual([montarPulse(p.carregado, { quando: depois }).varredura?.autorizacao.motivo], ['autorizacao.expirada']);

  autorizar(p, { pode: ['limpar'] });
  const feita = agirDepoisDaEntrega(p.carregado, { buscar: false, quando: depois });
  assert.deepEqual(feita?.feitas.map((f) => [f.acao, f.resultado]), [['limpar', 'feita']]);
  const morta = lerLedger(dir).find((e) => e.tipo === 'sessao_morta');
  assert.deepEqual([morta?.sessionId, morta?.origem], [r.sessionId, 'varredura']);
  const log = fs.readFileSync(path.join(p.dir, '.orkastery', 'monitor', 'hitl.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.filter((l) => l.tipo === 'varredura_acoes').map((l) => [l.autorizacao, l.feitas.length]), [['valida', 1]]);
  assert.equal(montarPulse(p.carregado, { quando: depois }).precisaDeHumanoAgora.some((i) => i.classe === 'varredura'), false,
    'a fantasma saiu da fila');

  // `ork fabrica batida status` diz a autorizacao em vigor.
  const estado = estadoDaBatida(p.dir, { projeto: p.carregado.manifesto.project.name, executor: { ler: () => ({ ok: true, texto: '' }),
    gravar: () => ({ ok: true }) } });
  assert.equal(estado.autorizacao?.estado, 'valida');
  assert.match(textoDoEstadoDaBatida(estado), /autorização durável de Dono Simulado até .*: a varredura pode limpar/);
});

test('F5: o registro e o MASTER nao vao por cima do trabalho na thread; com bloqueio, o comando do dono e olhar a thread', () => {
  const p = projetoTemporario('rm063-f5-bloqueio', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'pr com trabalho depois', modo: 'auto', criarWorktree: true });
    const t = lerThread(p.dir, thread.id);
    const wt = t.worktree as string;
    const branch = branchDaWorktree(t);
    commitar(wt, 'entrega.txt', 'feito\n', `feat(${thread.id}): entrega da fatia`);
    assert.equal(exec('git', ['push', '-q', 'origin', branch], wt).ok, true);
    const merge = mergeDaBranchNoGithub(p, thread.id, branch);
    autorizar(p, { pode: ['registrar', 'master'] });

    // A worktree com alteracao nao commitada: alguem trabalha nela.
    fs.writeFileSync(path.join(wt, 'rascunho.txt'), 'meio do trabalho\n');
    const suja = agirNaVarredura(p.carregado, SEM_SESSOES);
    assert.deepEqual([suja.feitas, motivos(suja)], [[], [['registrar', 'worktree-suja']]]);
    fs.rmSync(path.join(wt, 'rascunho.txt'));
    // Sessao viva na worktree, ou o runtime sem resposta (sem a prova): nada e feito.
    const viva = agirNaVarredura(p.carregado, { fantasmas: () => [], vivas: () => [{ sessionId: 'simulada', cwd: wt }], buscar: false });
    assert.deepEqual([viva.feitas, motivos(viva)], [[], [['registrar', 'sessao-viva']]]);
    const semLeitura = agirNaVarredura(p.carregado, { fantasmas: () => [], vivas: () => null, buscar: false });
    assert.deepEqual([semLeitura.feitas, motivos(semLeitura)], [[], [['registrar', 'sessoes-sem-leitura']]]);
    // Commit na branch depois do head do PR mesclado: o registro mudaria a fase por cima dele.
    commitar(wt, 'depois.txt', 'depois do PR\n', `feat(${thread.id}): trabalho depois do PR`);
    const depoisDoHead = agirNaVarredura(p.carregado, { ...SEM_SESSOES, buscar: false });
    assert.deepEqual([depoisDoHead.feitas, motivos(depoisDoHead)], [[], [['registrar', 'branch-com-commits']]]);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido), false);

    // Com bloqueio, o pulse e o resumo mandam o dono olhar a thread, nao rodar a acao por cima do trabalho.
    const pulse = montarPulse(p.carregado, { consulta: SEM_RUNTIME });
    const item = pulse.precisaDeHumanoAgora.find((i) => i.id === `varredura:registrar:${thread.id}`);
    assert.equal(item?.comandoResposta, `ork thread status ${thread.id}`);
    assert.match(item!.pergunta, /a branch tem commits depois do head do PR mesclado/);
    const enviadas: string[] = [];
    assert.equal(varrerPulse({ raiz: p.dir, consultar: () => pulse, enviar: (m) => { enviadas.push(m); return true; } }).code, 0);
    assert.match(enviadas[0], new RegExp(`ork thread status ${thread.id}`));
    assert.doesNotMatch(enviadas[0], new RegExp(`ork ship registrar-pr ${thread.id}`));

    // Sem o trabalho depois do PR, a varredura registra; o MASTER espera a worktree limpa.
    assert.equal(exec('git', ['reset', '-q', '--hard', 'HEAD~1'], wt).ok, true);
    const registrou = agirNaVarredura(p.carregado, { ...SEM_SESSOES, buscar: false });
    assert.deepEqual(registrou.feitas.map((f) => [f.acao, f.resultado]), [['registrar', 'feita']]);
    assert.deepEqual(lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido)
      .map((e) => e.mergeSha), [merge]);
    const depois = new Date(Date.now() + 31 * 60 * 1000).toISOString();
    fs.writeFileSync(path.join(wt, 'rascunho.txt'), 'meio do trabalho\n');
    const master = agirNaVarredura(p.carregado, { ...SEM_SESSOES, quando: depois, buscar: false });
    assert.deepEqual([master.feitas, motivos(master)], [[], [['master', 'worktree-suja']]]);
    assert.notEqual(lerThread(p.dir, thread.id).status, 'fechada');
    fs.rmSync(path.join(wt, 'rascunho.txt'));
    const fechou = agirNaVarredura(p.carregado, { ...SEM_SESSOES, quando: depois, buscar: false });
    assert.deepEqual(fechou.feitas.map((f) => [f.acao, f.resultado]), [['master', 'feita']]);
  } finally { p.limpar(); }
});

test('F5: o despacho depois do PR segura o registro, e a mesma recusa da varredura nao vira linha nova a cada batida', (t) => {
  const p = projetoTemporario('rm063-f5-recusa', true);
  const runtime = runtimeFalso('rm063-f5-recusa');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'pr com despacho depois', modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  mergeNoGithub(p, thread.id);
  autorizar(p, { pode: ['limpar', 'registrar'] });
  // O pedido novo da fase depois do head do PR: a thread recebeu trabalho, e o registro mudaria a fase por cima dele.
  registrar(dir, thread.id, TIPOS_DE_EVENTO.promptGravado, { fase: 'GO', promptSha256: 'f'.repeat(64) });
  const r = agirNaVarredura(p.carregado, SEM_SESSOES);
  assert.deepEqual([r.feitas, motivos(r)], [[], [['registrar', 'trabalho-novo']]]);

  // A fantasma que a deteccao viu e a execucao nao acha mais: recusada uma vez, uma linha so, por mais batidas que venham.
  const sessao = '77777777-0000-4000-8000-000000000001';
  registrar(dir, thread.id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', sessionId: sessao });
  const fantasma: FantasmaTratado = { sessionId: sessao, perfil: null, thread: thread.id, fase: 'GO', acao: 'solto' };
  const depois = new Date(Date.now() + 31 * 60 * 1000).toISOString();
  for (let i = 0; i < 3; i++) {
    const v = agirNaVarredura(p.carregado, { fantasmas: () => [fantasma], vivas: () => [], quando: depois, buscar: false });
    assert.deepEqual(v.feitas.map((f) => [f.acao, f.resultado]), [['limpar', 'recusada']]);
  }
  assert.deepEqual(daVarredura(dir).filter((e) => e.acao === 'limpar').map((e) => e.resultado), ['recusada']);
  // A recusa vai ao dono pelo pulse, com o motivo.
  const [pendente] = acoesPendentes(p.carregado, { fantasmas: () => [fantasma], vivas: () => [], quando: depois });
  assert.match(String(pendente.recusa?.detalhe), /não apareceu como fantasma na execução/);
});

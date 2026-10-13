/**
 * RM-058 (N4, D1 a D4 e D13 a D15 da ork-rm058n4): os checkpoints da supervisão do arco e a seleção de contas e runtimes.
 * Todos os itens, contas, sessões e provas são SIMULADOS; as raízes de estado são descartáveis.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { abrirArco, passar, prepararIngressoSimulado, threadDoTrabalho, TrabalhoSimulado } from './noctum-apoio';
import { assinar, instancia, linhasDoLog, regravarLog, storeCom } from './noctum-supervisao-apoio';
import { registrar } from '../src/ledger';
import { reservarDespacho } from '../src/noctum-arco';
import { envelopeComTrabalhos } from '../src/noctum-envelope';
import { editarBloco } from '../src/setup';
import { dirThread } from '../src/thread';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerArco } from '../src/noctum-arco';
import { CONTRATO_ARCO } from '../src/noctum-arco';
import { alvosDaFase, assumirConducao, ConteudoV2, contasDoArco, correlacaoDoArco, dirDaSupervisao, gravarNaSupervisao, lerSupervisao,
  observarContas, parametrosDoArco, RecusaDaSupervisao, retomadasDe } from '../src/noctum-supervisao';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

const UM: TrabalhoSimulado[] = [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA da supervisão.' }];
const adulterada = (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.adulterada';

test('S1: o log da supervisão é encadeado e assinado: linha trocada, removida ou com MAC errado reprova a leitura', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s1');
  try {
    abrirArco(p.dir, 'arco-s1', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s1', [
      { tipo: 'conducao_assumida', geracao: 1, quem: instancia('condutor'), prova: 'trava do kernel livre (SIMULADO)' },
      { tipo: 'isolado', trabalho: 'a', thread: null, motivo: 'reserva-incerta', detalhe: 'SIMULADO' },
      { tipo: 'parada', motivo: 'supervisor-falhou', detalhe: 'SIMULADO' },
    ]);
    const original = linhasDoLog(p.dir, 'arco-s1');
    assert.equal(original.length, 4, 'os parâmetros entram antes, na primeira linha');
    assert.equal(lerSupervisao(p.dir, 'arco-s1').isolados.get('a')?.motivo, 'reserva-incerta');
    const trocada = original.map((l, i) => i === 2 ? l.replace('reserva-incerta', 'erro-repetido') : l);
    regravarLog(p.dir, 'arco-s1', trocada);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), (e: unknown) => adulterada(e) && /MAC/.test(String(e)));
    regravarLog(p.dir, 'arco-s1', original.filter((_, i) => i !== 1));
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), (e: unknown) => adulterada(e) && /fora da cadeia/.test(String(e)));
    // Uma linha do meio re-assinada com a chave (quem a tem forja o MAC): a linha seguinte não aponta mais para ela.
    const meio = JSON.parse(original[2]) as { dados: Record<string, unknown> };
    regravarLog(p.dir, 'arco-s1', original.map((l, i) => i === 2 ? assinar(p.dir, { ...meio.dados, evento: { tipo: 'isolado', trabalho: 'a', thread: null,
      motivo: 'erro-repetido', detalhe: 'forjada' } }) : l));
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), (e: unknown) => adulterada(e) && /linha 4 fora da cadeia/.test(String(e)));
    const semMac = original.map((l, i) => i === 3 ? l.replace(/"mac":"[0-9a-f]{4}/, '"mac":"0000') : l);
    regravarLog(p.dir, 'arco-s1', semMac);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s1'), adulterada);
    // O log volta inteiro e a escrita seguinte encadeia nele.
    regravarLog(p.dir, 'arco-s1', original);
    assert.equal(gravarNaSupervisao(p.carregado, 'arco-s1', [{ tipo: 'batida', quem: instancia('condutor'), geracao: 1 }]).linhas, 5);
  } finally { p.limpar(); }
});

test('S2: arquivo aberto a outros, link no lugar do log e segunda linha de parâmetros, mesmo assinada, reprovam', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s2');
  try {
    abrirArco(p.dir, 'arco-s2', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s2', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]);
    const log = path.join(dirDaSupervisao(p.dir, 'arco-s2'), 'supervisao.jsonl');
    fs.chmodSync(log, 0o644);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s2'), (e: unknown) => adulterada(e) && /privado/.test(String(e)));
    fs.chmodSync(log, 0o600);
    // Uma segunda linha de parâmetros com MAC válido (quem tem a chave local a forja): a leitura recusa pela posição.
    const linhas = linhasDoLog(p.dir, 'arco-s2');
    const ultima = JSON.parse(linhas.at(-1)!) as { dados: Record<string, unknown> };
    const dados = { ...ultima.dados, seq: 3, anterior: createHash('sha256').update(linhas.at(-1)!).digest('hex'),
      evento: { tipo: 'parametros', parametros: { ...lerSupervisao(p.dir, 'arco-s2').parametros, tetoDeRetomadas: 99 } } };
    regravarLog(p.dir, 'arco-s2', [...linhas, assinar(p.dir, dados)]);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s2'), (e: unknown) => adulterada(e) && /primeira linha/.test(String(e)));
    regravarLog(p.dir, 'arco-s2', linhas);
    // Gravar parâmetros por fora, ou num arco que não existe, é recusa tipada.
    assert.throws(() => gravarNaSupervisao(p.carregado, 'arco-s2', [{ tipo: 'parametros', parametros: lerArco(p.dir, 'arco-s2') as never }]),
      (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.invalida');
    assert.throws(() => gravarNaSupervisao(p.carregado, 'arco-que-nao-existe', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]),
      (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.invalida');
    fs.renameSync(log, `${log}.real`);
    fs.symlinkSync(`${log}.real`, log);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s2'), adulterada);
  } finally { p.limpar(); }
});

test('S3: a cauda incompleta não dá autoridade a ninguém e sai na escrita seguinte, que segue a cadeia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s3');
  try {
    abrirArco(p.dir, 'arco-s3', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s3', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]);
    const linhas = linhasDoLog(p.dir, 'arco-s3');
    regravarLog(p.dir, 'arco-s3', linhas, '{"dados":{"evento":{"tipo":"parada","motivo":"supervisor-falhou"');
    const lido = lerSupervisao(p.dir, 'arco-s3');
    assert.equal(lido.parada, null, 'a parada pela metade não vale');
    assert.equal(lido.linhas, 2);
    const depois = gravarNaSupervisao(p.carregado, 'arco-s3', [{ tipo: 'isolado', trabalho: 'a', thread: null, motivo: 'sessao-presa', detalhe: 'SIMULADO' }]);
    assert.equal(depois.linhas, 3);
    assert.equal(linhasDoLog(p.dir, 'arco-s3').length, 3);
    assert.ok(!fs.readFileSync(path.join(dirDaSupervisao(p.dir, 'arco-s3'), 'supervisao.jsonl'), 'utf8').includes('"motivo":"supervisor-falhou"'));
  } finally { p.limpar(); }
});

test('S4: os parâmetros gravados na primeira linha valem mesmo com o manifesto mudado depois', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s4');
  try {
    abrirArco(p.dir, 'arco-s4', { trabalhos: UM });
    p.carregado.manifesto.retry.max_tentativas = 3;
    const antes = parametrosDoArco(p.carregado, 'arco-s4');
    assert.equal(antes.tetoDeRetomadas, 3);
    assert.equal(antes.cadenciaMs, 5 * 60_000, 'a cadência da D3 do dono');
    assert.equal(antes.carenciaMs, 15 * 60_000);
    p.carregado.manifesto.retry.max_tentativas = 9;
    assert.equal(parametrosDoArco(p.carregado, 'arco-s4').tetoDeRetomadas, 3);
    gravarNaSupervisao(p.carregado, 'arco-s4', [{ tipo: 'batida', quem: instancia('condutor'), geracao: null }]);
    assert.deepEqual(lerSupervisao(p.dir, 'arco-s4').parametros, antes);
    assert.equal(linhasDoLog(p.dir, 'arco-s4').filter(l => l.includes('"tipo":"parametros"')).length, 1);
  } finally { p.limpar(); }
});

test('S5: um processo novo deriva do disco as mesmas gerações, tentativas e contas fora: reiniciar não zera nada', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s5');
  try {
    abrirArco(p.dir, 'arco-s5', { trabalhos: UM });
    const envelope = lerArco(p.dir, 'arco-s5')!;
    gravarNaSupervisao(p.carregado, 'arco-s5', [
      { tipo: 'conducao_assumida', geracao: 1, quem: instancia('condutor', 1), prova: 'SIMULADO' },
      { tipo: 'retomada_autorizada', trabalho: 'a', thread: 'ork-x', fase: 'GO', tentativa: 1, motivo: 'sessao-morta', sessao: null, prova: 'SIMULADO' },
      { tipo: 'retomada_autorizada', trabalho: 'a', thread: 'ork-x', fase: 'GO', tentativa: 2, motivo: 'sem-avanco', sessao: null, prova: 'SIMULADO' },
      { tipo: 'conta_fora', conta: 'perfil-a', runtime: 'claude-bg', motivo: 'cota-sem-reset', ate: null, prova: 'SIMULADO' },
      { tipo: 'conducao_assumida', geracao: 2, quem: instancia('vigia', 2), prova: 'SIMULADO' },
    ]);
    const dist = path.resolve(__dirname, '..');
    const script = `
      const path = require('node:path');
      const { lerSupervisao, retomadasDe } = require(path.join(${JSON.stringify(dist)}, 'src/noctum-supervisao'));
      const s = lerSupervisao(${JSON.stringify(p.dir)}, 'arco-s5');
      process.stdout.write(JSON.stringify({ geracao: s.geracao.numero, quem: s.geracao.quem.papel, tentativas: retomadasDe(s, 'a', 'GO'),
        conta: s.contasFora.get('perfil-a').motivo, teto: s.parametros.tetoDeRetomadas }));
    `;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { geracao: 2, quem: 'vigia', tentativas: 2, conta: 'cota-sem-reset', teto: p.carregado.manifesto.retry.max_tentativas });
    assert.equal(retomadasDe(lerSupervisao(p.dir, 'arco-s5'), 'a', 'GO'), 2);
    // Nada disso toca o envelope: a mesma versão, o mesmo hash, o mesmo fim e nenhuma autorização nova.
    const depois = lerArco(p.dir, 'arco-s5')!;
    assert.deepEqual([depois.versao, depois.envelopeSha256, depois.conteudo!.janela.fim], [envelope.versao, envelope.envelopeSha256, envelope.conteudo!.janela.fim]);
  } finally { p.limpar(); }
});

test('S6: a subchave é própria: uma linha assinada no domínio do log do arco não vale na supervisão', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s6');
  try {
    abrirArco(p.dir, 'arco-s6', { trabalhos: UM });
    gravarNaSupervisao(p.carregado, 'arco-s6', [{ tipo: 'batida', quem: instancia('vigia'), geracao: null }]);
    const linhas = linhasDoLog(p.dir, 'arco-s6');
    const segunda = JSON.parse(linhas[1]) as { dados: unknown };
    regravarLog(p.dir, 'arco-s6', [linhas[0], assinar(p.dir, segunda.dados, CONTRATO_ARCO)]);
    assert.throws(() => lerSupervisao(p.dir, 'arco-s6'), (e: unknown) => adulterada(e) && /MAC/.test(String(e)));
    regravarLog(p.dir, 'arco-s6', [linhas[0], assinar(p.dir, segunda.dados)]);
    assert.equal(lerSupervisao(p.dir, 'arco-s6').linhas, 2, 'a mesma linha, assinada no domínio da supervisão, vale');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// D13 a D15: as contas e os runtimes do arco.
// ---------------------------------------------------------------------------

const DUAS = [{ conta: 'perfil-a', sessoes: 1 }, { conta: 'perfil-b', sessoes: 1 }];

function conteudo(p: ReturnType<typeof projetoTemporario>, arco: string): ConteudoV2 {
  const c = lerArco(p.dir, arco)!.conteudo!;
  assert.ok(envelopeComTrabalhos(c));
  return c as ConteudoV2;
}

/** A falha de conta de um despacho do arco, como o `phase run` a deixa: a falha do despacho com o perfil e o gate tipado. */
function falhaDoDespacho(raiz: string, thread: string, arco: string, conta: string, gate: Record<string, unknown>): void {
  registrar(dirThread(raiz, thread), thread, 'phase_dispatch_failed', { fase: 'GOAL', slug: `${thread}-goal`, runtime: 'claude-bg',
    correlacao: correlacaoDoArco(arco), perfil: { id: conta, runtime: 'claude-bg', configDir: `/contas/${conta}` }, erro: 'SIMULADO' });
  registrar(dirThread(raiz, thread), thread, 'gate_blocked', { gate: 'phase.dispatch', fase: 'GOAL', origem: 'phase.run', ...gate });
}

const visao = (p: ReturnType<typeof projetoTemporario>, arco: string, store: ReturnType<typeof storeCom>, quando = new Date().toISOString()) =>
  contasDoArco(conteudo(p, arco), lerArco(p.dir, arco, quando)!, lerSupervisao(p.dir, arco), store, quando);

function observarEGravar(p: ReturnType<typeof projetoTemporario>, arco: string, store: ReturnType<typeof storeCom> | null = null) {
  const o = observarContas(p.dir, arco, conteudo(p, arco), lerArco(p.dir, arco)!, lerSupervisao(p.dir, arco), store, new Date().toISOString());
  if (o.eventos.length) gravarNaSupervisao(p.carregado, arco, o.eventos);
  return o;
}

test('S7: o limite semanal com o reset dito tira a conta até o reset, e a seleção fica com a outra conta do envelope', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s7');
  try {
    const t = threadDoTrabalho(p.carregado, 'semana', 'RM-901', 'Pedido SIMULADO da semana.');
    abrirArco(p.dir, 'arco-s7', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }], contas: DUAS });
    const reset = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
    falhaDoDespacho(p.dir, t.id, 'arco-s7', 'perfil-a', { motivo: 'runtime.quota-exhausted',
      falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: reset, fonte: 'relogio', trecho: 'weekly limit SIMULADO' } });
    // O store também marcou A pela mesma falha: a decisão do arco, com o reset dito, vale sobre a do store.
    const o = observarEGravar(p, 'arco-s7', storeCom([{ id: 'perfil-a', estado: 'esgotado', esgotadoAte: reset }, { id: 'perfil-b' }]));
    assert.deepEqual(o.eventos.map(e => e.tipo === 'conta_fora' ? `${e.conta}:${e.motivo}:${e.ate}` : e.tipo), [`perfil-a:cota:${reset}`]);
    assert.equal(observarContas(p.dir, 'arco-s7', conteudo(p, 'arco-s7'), lerArco(p.dir, 'arco-s7')!, lerSupervisao(p.dir, 'arco-s7'), null,
      new Date().toISOString()).eventos.length, 0, 'a mesma decisão não se grava duas vezes');
    const store = storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }]);
    const v = visao(p, 'arco-s7', store);
    assert.deepEqual(v.perfis, [{ id: 'perfil-b', runtime: 'claude-bg' }]);
    assert.deepEqual(v.contas.find(c => c.conta === 'perfil-a'), { conta: 'perfil-a', runtime: 'claude-bg', disponivel: false, motivo: 'cota', ate: reset });
    // Passado o reset dito, a conta volta.
    const depois = new Date(Date.parse(reset) + 60_000).toISOString();
    assert.deepEqual(visao(p, 'arco-s7', store, depois).perfis.map(x => x.id), ['perfil-a', 'perfil-b']);
  } finally { p.limpar(); }
});

test('S8: a cota sem reset dito é lacuna: a conta fica fora pelo resto do arco, mesmo depois que a janela estimada do store vence', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s8');
  try {
    const t = threadDoTrabalho(p.carregado, 'sem reset', 'RM-901', 'Pedido SIMULADO sem reset.');
    abrirArco(p.dir, 'arco-s8', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }], contas: DUAS });
    falhaDoDespacho(p.dir, t.id, 'arco-s8', 'perfil-a', { motivo: 'runtime.quota-exhausted',
      falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: null, fonte: 'sem-horario', trecho: 'limit SIMULADO' } });
    observarEGravar(p, 'arco-s8');
    // O store marcou a conta com a janela padrão (estimada): vencida ela, o store a devolve, e o arco não.
    const estimada = new Date(Date.now() + 3600_000).toISOString();
    const store = storeCom([{ id: 'perfil-a', estado: 'esgotado', esgotadoAte: estimada }, { id: 'perfil-b' }]);
    const tarde = new Date(Date.now() + 2 * 3600_000).toISOString();
    const v = visao(p, 'arco-s8', store, tarde);
    assert.deepEqual(v.perfis.map(x => x.id), ['perfil-b']);
    assert.equal(v.contas.find(c => c.conta === 'perfil-a')?.motivo, 'cota-sem-reset');
    assert.equal(v.contas.find(c => c.conta === 'perfil-a')?.ate, null);
    assert.ok(v.lacunas.some(l => /perfil-a: reset desconhecido/.test(l)), JSON.stringify(v.lacunas));
    // Sem prova do arco, só o store (A1 do CHECK): o reset é desconhecido também. O vigia grava a conta fora do arco, e
    // ela segue fora depois que o store a devolve.
    const outro = storeCom([{ id: 'perfil-a' }, { id: 'perfil-b', estado: 'esgotado', esgotadoAte: estimada }]);
    assert.deepEqual(visao(p, 'arco-s8', outro).perfis.map(x => x.id), []);
    assert.equal(visao(p, 'arco-s8', outro).contas.find(c => c.conta === 'perfil-b')?.motivo, 'cota-sem-reset');
    observarEGravar(p, 'arco-s8', outro);
    assert.equal(lerSupervisao(p.dir, 'arco-s8').contasFora.get('perfil-b')?.motivo, 'cota-sem-reset');
    assert.deepEqual(visao(p, 'arco-s8', storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }]), tarde).perfis.map(x => x.id), [],
      'o store devolveu B; o arco, não');
  } finally { p.limpar(); }
});

test('S9: a falha de autenticação tira a conta do arco, sem prazo; sem conta, nada é selecionado, nem sem perfil', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s9');
  try {
    const t = threadDoTrabalho(p.carregado, 'sem login', 'RM-901', 'Pedido SIMULADO sem login.');
    abrirArco(p.dir, 'arco-s9', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }], contas: DUAS });
    falhaDoDespacho(p.dir, t.id, 'arco-s9', 'perfil-a', { motivo: 'runtime.auth-missing',
      falhaDeConta: { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho: 'not logged in SIMULADO' } });
    observarEGravar(p, 'arco-s9');
    // O dono refez o login (o store diz ativo): no arco, a conta segue fora; a outra está sem login no store.
    const v = visao(p, 'arco-s9', storeCom([{ id: 'perfil-a' }, { id: 'perfil-b', estado: 'sem-auth' }]));
    assert.deepEqual(v.perfis, []);
    assert.deepEqual(v.contas.map(c => `${c.conta}:${c.motivo}`), ['perfil-a:auth', 'perfil-b:sem-auth']);
    // Store ilegível: nenhuma conta, e a lacuna diz por quê.
    const ilegivel = visao(p, 'arco-s9', null as never);
    assert.deepEqual(ilegivel.perfis, []);
    assert.match(ilegivel.lacunas[0], /store de perfis/);
  } finally { p.limpar(); }
});

test('S10: o subteto esgotado de uma conta só tira a conta; perfil ausente, desativado e sem login ficam fora; provider pago e teto do arco param o arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s10');
  try {
    const h = abrirArco(p.dir, 'arco-s10', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO.' }],
      contas: [...DUAS, { conta: 'perfil-c', sessoes: 1 }, { conta: 'perfil-d', sessoes: 1 }], maquina: 3, tetoDoArco: 5 });
    // O subteto de cada conta é o menor entre 20 e o teto do arco (5): cinco reservas na conta A esgotam a conta e o arco.
    for (let i = 0; i < 4; i++) reservarDespacho(p.dir, { arco: 'arco-s10', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL',
      runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    const store = storeCom([{ id: 'perfil-a' }, { id: 'perfil-b', estado: 'desativado' }, { id: 'perfil-c', estado: 'sem-auth' }]);
    const v = visao(p, 'arco-s10', store);
    assert.deepEqual(v.contas.map(c => `${c.conta}:${c.disponivel ? 'ok' : c.motivo}`),
      ['perfil-a:ok', 'perfil-b:desativado', 'perfil-c:sem-auth', 'perfil-d:perfil-ausente']);
    assert.equal(v.parada, null);
    // D15 (A2 do CHECK): uma conta do envelope com credencial de provider pago para o arco.
    const pago = visao(p, 'arco-s10', storeCom([{ id: 'perfil-a' }, { id: 'perfil-c', estado: 'provider-pago' }]));
    assert.equal(pago.parada?.motivo, 'violacao-de-custo');
    assert.match(pago.parada!.detalhe, /perfil-c/);
    reservarDespacho(p.dir, { arco: 'arco-s10', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    const cheio = visao(p, 'arco-s10', store);
    assert.equal(cheio.contas[0].motivo, 'subteto');
    assert.equal(cheio.parada?.motivo, 'teto-do-arco', 'o teto do arco esgotado para o arco: nenhum rodízio resolve');
  } finally { p.limpar(); }
});

test('S11: a recusa por custo num despacho do arco para o arco, sem retry nem troca de conta', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s11');
  try {
    const t = threadDoTrabalho(p.carregado, 'pago', 'RM-901', 'Pedido SIMULADO pago.');
    abrirArco(p.dir, 'arco-s11', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }], contas: DUAS });
    assert.equal(observarEGravar(p, 'arco-s11').parada, null);
    // Uma recusa por custo fora do arco (sem a correlação) não conta.
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch_failed', { fase: 'GOAL', runtime: 'claude-bg', perfil: { id: 'perfil-a' }, erro: 'SIMULADO' });
    registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { gate: 'phase.dispatch', fase: 'GOAL', motivo: 'cost.violation' });
    assert.equal(observarEGravar(p, 'arco-s11').parada, null);
    falhaDoDespacho(p.dir, t.id, 'arco-s11', 'perfil-a', { motivo: 'cost.violation' });
    const o = observarEGravar(p, 'arco-s11');
    assert.equal(o.parada?.motivo, 'violacao-de-custo');
    assert.deepEqual(o.eventos, [], 'custo não vira conta fora: vira parada');
  } finally { p.limpar(); }
});

test('S12: os alvos da fase são o runtime do bloco e a ordem de fallback dele, só os do envelope e com subteto aberto', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s12');
  try {
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:modelo-SIMULADO:high'] }, 'fixture').ok, true);
    abrirArco(p.dir, 'arco-s12a', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO.' }] });
    assert.deepEqual(alvosDaFase(p.carregado, conteudo(p, 'arco-s12a'), lerArco(p.dir, 'arco-s12a')!, 'GO', 'claude-bg', 'auto'),
      [{ runtime: 'claude-bg' }], 'o codex fora do envelope nunca é alvo');
    const h = abrirArco(p.dir, 'arco-s12b', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Pedido SIMULADO.' }],
      contas: [{ conta: 'perfil-a', sessoes: 1 }], runtimes: [{ runtime: 'claude-bg', sessoes: 1 }, { runtime: 'codex', sessoes: 1 }], tetoDoArco: 4 });
    const alvos = () => alvosDaFase(p.carregado, conteudo(p, 'arco-s12b'), lerArco(p.dir, 'arco-s12b')!, 'GO', 'claude-bg', 'auto');
    assert.deepEqual(alvos(), [{ runtime: 'claude-bg' }, { runtime: 'codex', model: 'modelo-SIMULADO', effort: 'high' }]);
    // O subteto do runtime do bloco esgotado (4, o menor entre 30 e o teto do arco): só o fallback do envelope sobra.
    for (let i = 0; i < 4; i++) reservarDespacho(p.dir, { arco: 'arco-s12b', envelopeSha256: h, trabalho: 'a', thread: null, fase: 'GOAL',
      runtime: 'claude-bg', conta: 'perfil-a', revisao: false });
    assert.deepEqual(alvos().map(a => a.runtime), ['codex']);
  } finally { p.limpar(); }
});

test('S13: a cota vista no meio do turno de uma sessão do arco e o que só o store sabe (esgotada ou sem login) tiram a conta do arco', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s13');
  try {
    const t = threadDoTrabalho(p.carregado, 'meio do turno', 'RM-901', 'Pedido SIMULADO do meio do turno.');
    abrirArco(p.dir, 'arco-s13', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }],
      contas: [...DUAS, { conta: 'perfil-c', sessoes: 1 }] });
    const sessionId = '00000000-0000-4000-8000-000000000131';
    registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { fase: 'GO', sessionId, runtime: 'claude-bg', correlacao: correlacaoDoArco('arco-s13'),
      perfil: { id: 'perfil-a', runtime: 'claude-bg' } });
    const reset = new Date(Date.now() + 3 * 3600_000).toISOString();
    registrar(dirThread(p.dir, t.id), t.id, 'runtime_quota_detected', { fase: 'GO', sessionId, runtime: 'claude-bg', motivo: 'runtime.quota-exhausted',
      resetEm: reset, perfil: { id: 'perfil-a', runtime: 'claude-bg' }, origem: 'sessions.watch' });
    // A cota vista numa sessão que não é do arco não conta.
    registrar(dirThread(p.dir, t.id), t.id, 'runtime_quota_detected', { fase: 'GO', sessionId: '00000000-0000-4000-8000-000000000999',
      runtime: 'claude-bg', motivo: 'runtime.quota-exhausted', resetEm: null, perfil: { id: 'perfil-c', runtime: 'claude-bg' }, origem: 'sessions.watch' });
    const store = storeCom([{ id: 'perfil-a' }, { id: 'perfil-b', estado: 'sem-auth' }, { id: 'perfil-c' }]);
    const o = observarEGravar(p, 'arco-s13', store);
    assert.deepEqual(o.eventos.map(e => e.tipo === 'conta_fora' ? `${e.conta}:${e.motivo}:${e.ate}` : e.tipo).sort(),
      [`perfil-a:cota:${reset}`, 'perfil-b:auth:null']);
    // O dono refaz o login de B (o store diz ativo): no arco, B segue fora, porque só o dono responde por ela.
    const v = visao(p, 'arco-s13', storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }, { id: 'perfil-c' }]));
    assert.deepEqual(v.perfis.map(x => x.id), ['perfil-c']);
  } finally { p.limpar(); }
});

test('S14: a gravação que deixaria o log ilegível é recusada antes de ir ao disco, e a geração seguinte é lida sob a trava', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s14');
  try {
    abrirArco(p.dir, 'arco-s14', { trabalhos: UM });
    const efeito = { acao: 'push' as const, repositorio: 'exemplo/produto', remoto: 'origin', branch: 'ork/x', sha: 'a'.repeat(40), trabalho: 'a',
      thread: null, detalhe: 'SIMULADO' };
    gravarNaSupervisao(p.carregado, 'arco-s14', [{ tipo: 'efeito_incerto', id: 'E-repetido', efeito }]);
    const linhas = lerSupervisao(p.dir, 'arco-s14').linhas;
    assert.throws(() => gravarNaSupervisao(p.carregado, 'arco-s14', [{ tipo: 'efeito_incerto', id: 'E-repetido', efeito }]),
      (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.invalida');
    assert.throws(() => gravarNaSupervisao(p.carregado, 'arco-s14', [{ tipo: 'conducao_assumida', geracao: 5, quem: instancia('condutor'), prova: 'SIMULADO' }]),
      (e: unknown) => e instanceof RecusaDaSupervisao && e.motivo === 'noctum.supervisao.invalida');
    assert.equal(lerSupervisao(p.dir, 'arco-s14').linhas, linhas, 'nada foi gravado, e o log segue legível');
    assert.equal(assumirConducao(p.carregado, 'arco-s14', instancia('condutor', 1), () => 'SIMULADO'), 1);
    assert.equal(assumirConducao(p.carregado, 'arco-s14', instancia('vigia', 2), (g) => `depois da ${g?.numero}`), 2);
    assert.equal(lerSupervisao(p.dir, 'arco-s14').geracao?.prova, 'depois da 1');
  } finally { p.limpar(); }
});

test('S15: só a falha do despacho do arco depois da autorização conta, a mais nova decide, e a decisão do arco que venceu não segura a do store', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-s15');
  try {
    const t = threadDoTrabalho(p.carregado, 'ordem', 'RM-901', 'Pedido SIMULADO da ordem.');
    // A falha de antes da autorização do arco não é dele.
    falhaDoDespacho(p.dir, t.id, 'arco-s15', 'perfil-b', { motivo: 'runtime.auth-missing',
      falhaDeConta: { motivo: 'runtime.auth-missing', resetEm: null, fonte: 'sem-horario', trecho: 'SIMULADO de antes do arco' } });
    passar(5);
    abrirArco(p.dir, 'arco-s15', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }], contas: DUAS });
    const r1 = new Date(Date.now() + 3600_000).toISOString(), r2 = new Date(Date.now() + 5 * 3600_000).toISOString();
    falhaDoDespacho(p.dir, t.id, 'arco-s15', 'perfil-a', { motivo: 'runtime.quota-exhausted',
      falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: r1, fonte: 'relogio', trecho: 'SIMULADO 1' } });
    passar(5);
    falhaDoDespacho(p.dir, t.id, 'arco-s15', 'perfil-a', { motivo: 'runtime.quota-exhausted',
      falhaDeConta: { motivo: 'runtime.quota-exhausted', resetEm: r2, fonte: 'relogio', trecho: 'SIMULADO 2' } });
    const o = observarEGravar(p, 'arco-s15', storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }]));
    assert.deepEqual(o.eventos.map(e => e.tipo === 'conta_fora' ? `${e.conta}:${e.motivo}:${e.ate}` : e.tipo), [`perfil-a:cota:${r2}`],
      'a conta B não sai pela falha de antes do arco, e a falha mais nova de A decide');
    // Passado o reset dito, o store marca A de novo com um prazo estimado: a decisão vencida do arco não segura a do store.
    const tarde = new Date(Date.parse(r2) + 10 * 60_000).toISOString();
    const store = storeCom([{ id: 'perfil-a', estado: 'esgotado', esgotadoAte: new Date(Date.parse(r2) + 3600_000).toISOString() }, { id: 'perfil-b' }]);
    const tiqueEm = (quando: string, s: ReturnType<typeof storeCom>) => {
      const o = observarContas(p.dir, 'arco-s15', conteudo(p, 'arco-s15'), lerArco(p.dir, 'arco-s15', quando)!, lerSupervisao(p.dir, 'arco-s15'), s, quando);
      if (o.eventos.length) gravarNaSupervisao(p.carregado, 'arco-s15', o.eventos, quando);
      return o.eventos.map(e => e.tipo === 'conta_fora' ? `${e.conta}:${e.motivo}:${e.ate}` : e.tipo);
    };
    assert.deepEqual(tiqueEm(tarde, store), ['perfil-a:cota-sem-reset:null']);
    // Tiques seguidos não trocam a decisão gravada (a vencida não se grava), nem depois que o store devolve a conta.
    const maisTarde = new Date(Date.parse(tarde) + 5 * 60_000).toISOString();
    assert.deepEqual(tiqueEm(maisTarde, store), []);
    assert.deepEqual(tiqueEm(new Date(Date.parse(tarde) + 10 * 60_000).toISOString(), store), []);
    const devolvida = storeCom([{ id: 'perfil-a' }, { id: 'perfil-b' }]);
    const bemDepois = new Date(Date.parse(r2) + 2 * 3600_000).toISOString();
    assert.deepEqual(tiqueEm(bemDepois, devolvida), []);
    assert.equal(lerSupervisao(p.dir, 'arco-s15').contasFora.get('perfil-a')?.motivo, 'cota-sem-reset', 'fora pelo resto do arco');
    assert.deepEqual(visao(p, 'arco-s15', devolvida, bemDepois).perfis.map(x => x.id), ['perfil-b']);
  } finally { p.limpar(); }
});

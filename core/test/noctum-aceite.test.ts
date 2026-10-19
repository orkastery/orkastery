/**
 * RM-058, integração (T8 da ork-rm058integra, D12): o aceite do piloto. `aceiteDoPiloto` mede M1 a M10 de um arco de
 * fixture, julga os critérios A1 a A8 e I1 a I6 com os limiares do dono ou da proposta, dá `simulado` à evidência do ensaio,
 * deixa lacuna (e `incompleto`) no que não se lê, e grava o publicável sem dado pessoal. Os nomes começam por AC. O git do
 * remoto, a forja, o canal e as sessões são SIMULADOS; o arco é autorizado pelo ingresso simulado do Telegram.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado, TrabalhoSimulado } from './noctum-apoio';
import { instancia } from './noctum-supervisao-apoio';
import { partesLocais } from '../src/horario';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao } from '../src/master';
import { aceiteDoPiloto, CONTRATO_LIMIARES, gravarAceite, hashDoAceite, Injecao, LeitorDoGit, lerInjecoes, lerLimiares, OpcoesDoAceite, publicavel,
  RecusaDoAceite, ResultadoDoAceite } from '../src/noctum-aceite';
import { concluirDespacho, encerrarArco, lerArco, reservarDespacho } from '../src/noctum-arco';
import { entregarRelatorioSeDevido, vencimentoDoRelatorio } from '../src/noctum-relatorio';
import { gravarNaSupervisao } from '../src/noctum-supervisao';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { dirThread, novaThread } from '../src/thread';

prepararIngressoSimulado();
const CLI = path.resolve(__dirname, '../../dist/index.js');
const MIN = 60_000;
const HORA = 60 * MIN;
const MERGE = (n: number): string => String(n).repeat(40);
const PONTA = 'f'.repeat(40);
const em = (base: string, ms: number): string => new Date(Date.parse(base) + ms).toISOString();

/** O git de um remoto do GitHub, SIMULADO: a ponta da base e os merges que estão nela. */
function gitDoGitHub(naBase: ReadonlySet<string> = new Set([MERGE(1), MERGE(2)]), ponta: string | null = PONTA): LeitorDoGit {
  return { url: () => 'https://github.com/exemplo/produto.git', ponta: () => ponta, ancestral: (sha) => naBase.has(sha) };
}

/** A forja SIMULADA: os PRs que cada branch tem. */
const prsPorBranch = (n = 1): ExecutorDoGh => () => ({ status: 0, stderr: '',
  stdout: JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i + 1, state: i ? 'OPEN' : 'MERGED', headRefOid: 'a'.repeat(40) }))) });

interface Piloto { p: ProjetoDeTeste; arco: string; threads: string[]; inicio: string; fim: string; vencimento: string }

/**
 * Um piloto de fixture, de 8 h, que começa daqui a 1 h: dois trabalhos despachados, entregues com a prova do push e com o
 * MASTER por omissão, a falha F1 recuperada 3 min depois, o arco fechado na hora e o relatório entregue no horário.
 */
function piloto(nome: string, o: { semProva?: boolean; duasEntregas?: boolean; baseDeFora?: boolean; maquina?: string } = {}): Piloto {
  const p = projetoTemporario(nome);
  const threads = ['a', 'b'].map((x, i) => novaThread(p.carregado, { nome: `piloto ${x}`, modo: 'auto', roadmap: `RM-97${i + 1}`,
    pedido: `Trabalho ${x} SIMULADO do piloto.`, criarWorktree: false }).thread.id);
  const trabalhos: TrabalhoSimulado[] = threads.map((thread, i) => ({ id: ['a', 'b'][i], item: `RM-97${i + 1}`, prioridade: i + 1, dependeDe: [], thread }));
  const arco = `arco-${nome}`;
  const pedido = pedidoV2(arco, { trabalhos, contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }], deslocamentoH: 2 });
  const janela = pedido.janela as { inicio: string; fim: string };
  const relatorioEm = partesLocais(Date.parse(janela.fim) + 30 * MIN, 'America/Sao_Paulo');
  pedido.relatorio = { horario: `${relatorioEm.hora}:${relatorioEm.minuto}`, canal: 'telegram' };
  const sha = autorizarPedido(p.dir, arco, pedido);
  const conteudo = lerArco(p.dir, arco)!.conteudo!;
  const { inicio, fim } = conteudo.janela;
  const quem = o.maquina ? { ...instancia('condutor', 1), maquina: o.maquina } : instancia('condutor', 1);
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'conducao_assumida', geracao: 1, quem, prova: 'SIMULADO' }], em(inicio, MIN));
  threads.forEach((thread, i) => {
    const r = reservarDespacho(p.dir, { arco, envelopeSha256: sha, trabalho: ['a', 'b'][i], thread, fase: 'GOAL', runtime: 'claude-bg',
      conta: ['perfil-a', 'perfil-b'][i], revisao: false }, em(inicio, (5 + i) * MIN));
    concluirDespacho(p.dir, arco, r.seq, { thread, sessionId: `00000000-0000-4000-8888-00000000000${i + 1}`, idempotente: false }, em(inicio, (6 + i) * MIN));
  });
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'retomada_autorizada', trabalho: 'a', thread: threads[0], fase: 'GOAL', tentativa: 1,
    motivo: 'sessao-morta', sessao: null, prova: 'SIMULADO', aposReserva: 2 }], em(inicio, 2 * HORA + 3 * MIN));
  threads.forEach((thread, i) => {
    const prova = o.semProva && i === 1 ? { origem: 'local' } : { pushVerificado: true, mergeSha: MERGE(i + 1), para: o.baseDeFora && i === 1 ? 'release' : 'main' };
    registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { ts: em(inicio, (4 + i) * HORA), ...prova, evidencia: { arco } });
    if (o.duasEntregas && i === 0) {
      registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { ts: em(inicio, 5 * HORA), ...prova, evidencia: { arco } });
    }
    aceitarPorOmissao(p.dir, thread);
  });
  encerrarArco(p.dir, arco, { motivo: 'hora', detalhe: 'o fim do envelope chegou (SIMULADO)' }, fim);
  const vencimento = vencimentoDoRelatorio(conteudo);
  const r = entregarRelatorioSeDevido(p.carregado, arco, { quando: vencimento, enviar: () => ({ estado: 'confirmado', referencia: 'mensagem-SIMULADA' }) });
  assert.equal(r.acao, 'entregue', JSON.stringify(r));
  return { p, arco, threads, inicio, fim, vencimento };
}

const F1 = (pl: Piloto): Injecao => ({ falha: 'F1', instante: em(pl.inicio, 2 * HORA) });
const aceite = (pl: Piloto, o: OpcoesDoAceite = {}): ResultadoDoAceite =>
  aceiteDoPiloto(pl.p.carregado, pl.arco, { git: gitDoGitHub(), executorGh: prsPorBranch(), injecoes: [F1(pl)], ...o });
const medida = (r: ResultadoDoAceite, id: string) => r.medidas.find(m => m.id === id)!;
const criterio = (r: ResultadoDoAceite, id: string) => r.criterios.find(c => c.id === id)!;

test('AC1: o arco de fixture tem M1 a M10 medidas, e com os limiares da proposta todos os critérios do núcleo aprovam', () => {
  const pl = piloto('ac1');
  try {
    const r = aceite(pl);
    assert.equal(r.contrato, 'ork.noctum-piloto/v1');
    assert.deepEqual(r.medidas.map(m => m.id), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']);
    assert.deepEqual(r.medidas.map(m => [m.id, m.valor]), [['M1', 8], ['M2', 2], ['M3', 2], ['M4', 1], ['M5', 3], ['M6', 0], ['M7', 0], ['M8', 0],
      ['M9', 0], ['M10', 1]], JSON.stringify(r.medidas.filter(m => m.lacunas.length)));
    assert.deepEqual(r.simulacao, { simulado: false, marcas: [] });
    assert.deepEqual(r.criterios.map(c => [c.id, c.veredito]), [['A1', 'aprovado'], ['A2', 'aprovado'], ['A3', 'aprovado'], ['A4', 'aprovado'],
      ['A5', 'aprovado'], ['A6', 'aprovado'], ['A7', 'aprovado'], ['A8', 'do-dono'], ['I1', 'aprovado'], ['I2', 'aprovado'], ['I3', 'aprovado'],
      ['I4', 'aprovado'], ['I5', 'do-dono'], ['I6', 'aprovado']]);
    assert.equal(r.veredito, 'aprovado');
    assert.deepEqual([r.janela?.horas, r.encerramento?.motivo, r.envelope.versao], [8, 'hora', 1]);
  } finally { pl.p.limpar(); }
});

test('AC2: o critério diz o limiar e a origem dele: o do dono vale onde ele disse, e o resto fica com a proposta, marcada', () => {
  const pl = piloto('ac2');
  try {
    const limiares = lerLimiares({ contrato: CONTRATO_LIMIARES, m1MinimoHoras: 10, entregasMinimas: 1 });
    const r = aceite(pl, { limiares });
    assert.deepEqual([criterio(r, 'A1').veredito, criterio(r, 'A1').origemDoLimiar, criterio(r, 'A1').limiar], ['reprovado', 'dono', { m1MinimoHoras: 10 }]);
    assert.deepEqual([criterio(r, 'A5').veredito, criterio(r, 'A5').origemDoLimiar], ['aprovado', 'dono']);
    assert.deepEqual([criterio(r, 'A4').origemDoLimiar, criterio(r, 'A4').limiar], ['proposta', { m5MaximoMin: 15 }]);
    assert.equal(r.veredito, 'reprovado');
    assert.throws(() => lerLimiares({ contrato: CONTRATO_LIMIARES, m5MaximoMin: -1 }), (e: unknown) => e instanceof RecusaDoAceite &&
      e.motivo === 'noctum.aceite.limiares-invalidos');
    assert.throws(() => lerLimiares({ m1MinimoHoras: 6 }), /contrato ork\.noctum-limiares\/v1/);
  } finally { pl.p.limpar(); }
});

test('AC3: a evidência do ensaio dá simulado, nunca aprovado: o remoto de fixture, a máquina do ensaio e o evento marcado simulado', () => {
  const pl = piloto('ac3', { maquina: 'maquina-do-ensaio' });
  try {
    registrar(dirThread(pl.p.dir, pl.threads[0]), pl.threads[0], 'verify_run', { commit: MERGE(1), veredito: 'verdade sustentada', simulado: true });
    const r = aceite(pl, { git: { ...gitDoGitHub(), url: () => '/tmp/fixture-remoto.git' } });
    assert.equal(r.veredito, 'simulado');
    assert.equal(r.simulacao.simulado, true);
    assert.equal(r.simulacao.marcas.length, 3, r.simulacao.marcas.join('\n'));
    assert.match(r.simulacao.marcas.join('\n'), /remoto origin é de fixture/);
    assert.match(r.simulacao.marcas.join('\n'), /máquina do ensaio \(maquina-do-ensaio\)/);
    assert.match(r.simulacao.marcas.join('\n'), /1 evento\(s\) marcado\(s\) simulado/);
    assert.ok(r.criterios.every(c => c.veredito !== 'reprovado'), 'os critérios aprovam, e o veredito ainda é simulado');
  } finally { pl.p.limpar(); }
});

test('AC4: a leitura que falha é lacuna, nunca zero, e o critério que depende dela fica incompleto', () => {
  const pl = piloto('ac4');
  try {
    const r = aceite(pl, { git: gitDoGitHub(undefined, null), injecoes: null });
    assert.equal(medida(r, 'M2').valor, null);
    assert.match(medida(r, 'M2').lacunas.join('; '), /a ponta de main no remoto origin não se leu/);
    assert.deepEqual([medida(r, 'M4').valor, medida(r, 'M4').lacunas], [null, ['sem a agenda de injeções (--injecoes)']]);
    assert.deepEqual([criterio(r, 'A4').veredito, criterio(r, 'A5').veredito, criterio(r, 'A6').veredito], ['incompleto', 'incompleto', 'incompleto']);
    assert.equal(r.veredito, 'incompleto');
    assert.ok(r.lacunas.some(l => l.startsWith('M2: ')) && r.lacunas.some(l => l.startsWith('M4: ')));
  } finally { pl.p.limpar(); }
});

test('AC5: o publicável não traz caminho absoluto, e-mail, id de sessão, conta, máquina nem o dono do repositório', () => {
  const pl = piloto('ac5', { maquina: 'servidor-plantado-01' });
  try {
    const r = aceite(pl);
    // Valores plantados onde o resultado leva texto livre: lacunas e detalhes.
    r.lacunas.push('lido em /home/plantado/projeto/.orkastery/arco.jsonl por dono-plantado@exemplo.com na sessão 0123abcd-4567-4890-8abc-def012345678');
    r.criterios[0].detalhe += ' (conta perfil-a na máquina servidor-plantado-01, repositório exemplo/produto)';
    const { sha256 } = hashDoAceite(r);
    const pub = publicavel(r, sha256, { contas: ['perfil-a', 'perfil-b'], maquinas: ['servidor-plantado-01'], repositorios: ['exemplo/produto', 'exemplo'] });
    const texto = JSON.stringify(pub);
    for (const proibido of ['/home/plantado', 'dono-plantado@exemplo.com', '0123abcd-4567-4890-8abc-def012345678', 'perfil-a', 'servidor-plantado-01', 'exemplo/produto']) {
      assert.ok(!texto.includes(proibido), `o publicável ainda tem ${proibido}`);
    }
    assert.match(texto, /caminho-1/);
    assert.match(texto, /email-1/);
    assert.match(texto, /sessao-1/);
    assert.match(texto, /conta-1/);
    assert.match(texto, /maquina-1/);
    assert.match(texto, /repositorio-do-piloto/);
    assert.deepEqual([pub.publicavel, pub.sha256DoCompleto, pub.veredito], [true, sha256, r.veredito]);
    assert.doesNotMatch(texto, /"(?:\/[A-Za-z0-9._-]+){2,}/, 'nenhum caminho absoluto em valor nenhum');
  } finally { pl.p.limpar(); }
});

test('AC6: a agenda de injeções correlaciona cada falha ao primeiro sinal de recuperação (M4) e mede o tempo dela (M5)', () => {
  const pl = piloto('ac6');
  try {
    const agenda = lerInjecoes([JSON.stringify(F1(pl)), JSON.stringify({ falha: 'F2', instante: em(pl.inicio, 3 * HORA) }), ''].join('\n'));
    const r = aceite(pl, { injecoes: agenda });
    const ev = medida(r, 'M4').evidencia.injecoes as Array<{ falha: string; sinal: { em: string; fonte: string } | null }>;
    assert.deepEqual(ev.map(i => [i.falha, i.sinal?.fonte ?? null]), [['F1', 'supervisão: retomada_autorizada'], ['F2', null]]);
    assert.deepEqual([medida(r, 'M4').valor, medida(r, 'M5').valor, medida(r, 'M5').evidencia.mediana], [1, 3, 3]);
    assert.equal(criterio(r, 'A4').veredito, 'reprovado', 'a F2 sem geração nova depois dela não foi recuperada');
    assert.throws(() => lerInjecoes('{"falha":"F12","instante":"2026-01-01T00:00:00Z"}'), /F1 a F11/);
  } finally { pl.p.limpar(); }
});

test('AC7: a interrupção reprova com o critério: o efeito duplicado (I2) e a entrega fora do destino (I1)', () => {
  const pl = piloto('ac7', { duasEntregas: true, baseDeFora: true });
  try {
    const r = aceite(pl, { executorGh: prsPorBranch(2) });
    assert.equal(medida(r, 'M7').valor, 3, JSON.stringify(medida(r, 'M7').evidencia));
    assert.match((medida(r, 'M7').evidencia.duplicados as string[]).join('; '), /1 ship_done a mais na thread .+; 2 PRs da mesma branch/);
    assert.equal(medida(r, 'M6').valor, 1);
    assert.match((medida(r, 'M6').evidencia.violacoes as string[])[0], /a entrega de b foi para uma base fora do destino/);
    assert.deepEqual([criterio(r, 'I1').veredito, criterio(r, 'I2').veredito, criterio(r, 'A2').veredito, r.veredito],
      ['reprovado', 'reprovado', 'reprovado', 'reprovado']);
  } finally { pl.p.limpar(); }
});

test('AC8: o ship_done sem a prova do push não conta em M2, vira evidência perdida (M8) e reprova (I3)', () => {
  const pl = piloto('ac8', { semProva: true });
  try {
    const r = aceite(pl);
    assert.deepEqual([medida(r, 'M2').valor, medida(r, 'M2').evidencia.alegadas], [1, 2]);
    assert.equal(medida(r, 'M8').valor, 1);
    assert.match((medida(r, 'M8').evidencia.perdidas as string[])[0], /não tem a prova do push/);
    assert.deepEqual([criterio(r, 'A5').veredito, criterio(r, 'I3').veredito, r.veredito], ['reprovado', 'reprovado', 'reprovado']);
  } finally { pl.p.limpar(); }
});

test('AC9: o comando numa raiz de fixture grava o completo no estado, o publicável, e sai 1 sem aprovação; o arco desconhecido sai 2', () => {
  const pl = piloto('ac9');
  try {
    const agenda = path.join(pl.p.dir, 'agenda.jsonl');
    fs.writeFileSync(agenda, `${JSON.stringify(F1(pl))}\n`);
    const destino = path.join(pl.p.dir, 'piloto-publicavel.json');
    const r = spawnSync(process.execPath, [CLI, 'noctum', 'aceite', pl.arco, '--json', '--injecoes', agenda, '--publicar', destino],
      { cwd: pl.p.dir, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 1, r.stderr);
    const j = JSON.parse(r.stdout) as ResultadoDoAceite & { sha256: string; arquivo: string };
    assert.equal(j.contrato, 'ork.noctum-piloto/v1');
    assert.equal(j.veredito, 'incompleto', 'sem o remoto, as entregas não se provam: lacuna, nunca zero');
    assert.equal(createHash('sha256').update(fs.readFileSync(j.arquivo)).digest('hex'), j.sha256);
    assert.equal(fs.statSync(j.arquivo).mode & 0o777, 0o600);
    const pub = fs.readFileSync(destino, 'utf8');
    assert.equal(JSON.parse(pub).sha256DoCompleto, j.sha256);
    assert.ok(!pub.includes(pl.p.dir) && !pub.includes('perfil-a'), 'o publicável não leva a raiz nem a conta');
    const texto = spawnSync(process.execPath, [CLI, 'noctum', 'aceite', pl.arco], { cwd: pl.p.dir, encoding: 'utf8', timeout: 60_000 });
    assert.equal(texto.status, 1);
    assert.match(texto.stdout, /^Aceite do piloto do arco arco-ac9: incompleto \(sha256 [0-9a-f]{12}\)\nMedidas:\n  M1 Condução sem intervenção: 8 h/);
    const outro = spawnSync(process.execPath, [CLI, 'noctum', 'aceite', 'arco-que-nao-existe'], { cwd: pl.p.dir, encoding: 'utf8', timeout: 60_000 });
    assert.equal(outro.status, 2);
    assert.match(outro.stderr, /noctum\.aceite\.sem-arco/);
  } finally { pl.p.limpar(); }
});

test('AC10: o mesmo arco dá o mesmo hash, no resultado e no arquivo completo do estado', () => {
  const pl = piloto('ac10');
  try {
    const a = aceite(pl), b = aceite(pl);
    assert.equal(hashDoAceite(a).sha256, hashDoAceite(b).sha256);
    const g1 = gravarAceite(pl.p.dir, a), g2 = gravarAceite(pl.p.dir, b);
    assert.deepEqual([g1.sha256, g1.arquivo], [g2.sha256, g2.arquivo]);
    assert.deepEqual(Object.keys(a), ['contrato', 'arco', 'envelope', 'janela', 'encerramento', 'simulacao', 'medidas', 'criterios', 'veredito', 'lacunas'],
      'nenhum campo com o instante de quem roda');
  } finally { pl.p.limpar(); }
});

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
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';
import { autorizarPedido, pedidoV2, prepararIngressoSimulado, TrabalhoSimulado } from './noctum-apoio';
import { chaveSimulada, pedidoV3 } from './noctum-maquinas-apoio';
import { assinadoPara } from './noctum-n6-apoio';
import { instancia } from './noctum-supervisao-apoio';
import { partesLocais } from '../src/horario';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao } from '../src/master';
import { aceiteDoPiloto, CONTRATO_LIMIARES, gitDaRaiz, gravarAceite, hashDoAceite, Injecao, LeitorDoGit, lerInjecoes, lerLimiares, OpcoesDoAceite, publicavel,
  RecusaDoAceite, ResultadoDoAceite, sensiveisDoArco } from '../src/noctum-aceite';
import { autorizarPeloIngresso, concluirDespacho, encerrarArco, lerArco, proporEnvelope, reservarDespacho, textoDeAutorizacao } from '../src/noctum-arco';
import { entregarRelatorioSeDevido, reenviarRelatorio, vencimentoDoRelatorio } from '../src/noctum-relatorio';
import { gravarNaSupervisao } from '../src/noctum-supervisao';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { dirThread, novaThread } from '../src/thread';
import { CONTRATO_COORDENACAO, DadosDoRegistro, identidadeDaMaquina } from '../src/noctum-transporte';

prepararIngressoSimulado();
const CLI = path.resolve(__dirname, '../../dist/index.js');
const MIN = 60_000;
const HORA = 60 * MIN;
const MERGE = (n: number): string => String(n).repeat(40);
const PONTA = 'f'.repeat(40);
const em = (base: string, ms: number): string => new Date(Date.parse(base) + ms).toISOString();

type Reversoes = Record<string, Array<{ sha: string; em: string }>>;

/** O git de um remoto do GitHub, SIMULADO: a ponta da base, os merges que estão nela e os commits que revertem cada merge. */
function gitDoGitHub(naBase: ReadonlySet<string> = new Set([MERGE(1), MERGE(2)]), ponta: string | null = PONTA, reversoes: Reversoes = {}): LeitorDoGit {
  return { url: () => 'https://github.com/exemplo/produto.git', ponta: () => ponta, ancestral: (sha) => naBase.has(sha),
    reversoes: (sha) => reversoes[sha] ?? [] };
}
const comReversoes = (reversoes: Reversoes): LeitorDoGit => gitDoGitHub(undefined, undefined, reversoes);

/** A forja SIMULADA: os PRs que cada branch tem. */
const prsPorBranch = (n = 1): ExecutorDoGh => () => ({ status: 0, stderr: '',
  stdout: JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i + 1, state: i ? 'OPEN' : 'MERGED', headRefOid: 'a'.repeat(40) }))) });

interface Piloto { p: ProjetoDeTeste; arco: string; threads: string[]; inicio: string; fim: string; vencimento: string }

/** Propõe e autoriza o pedido no instante dado, pelo ingresso assinado SIMULADO. Devolve o hash do envelope. */
function autorizarNoInstante(raiz: string, arco: string, pedido: Record<string, unknown>, quando: string): string {
  const { envelopeSha256 } = proporEnvelope(raiz, pedido, quando);
  autorizarPeloIngresso(raiz, arco, envelopeSha256, assinadoPara(arco, textoDeAutorizacao(envelopeSha256), quando), quando);
  return envelopeSha256;
}

/** Muda o instante dos eventos de um tipo no ledger da thread (o MASTER que só chegaria depois do arco). */
function moverEventos(raiz: string, thread: string, tipo: string, ts: string): void {
  const arquivo = path.join(dirThread(raiz, thread), 'ledger.jsonl');
  const eventos = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { tipo: string; ts: string });
  fs.writeFileSync(arquivo, eventos.map(e => JSON.stringify(e.tipo === tipo ? { ...e, ts } : e)).join('\n') + '\n');
}

/**
 * Um piloto de fixture, de 8 h, que começa daqui a 1 h: dois trabalhos despachados, entregues com a prova do push e com o
 * MASTER por omissão, a falha F1 recuperada 3 min depois, o arco fechado na hora e o relatório entregue no horário.
 * `autorizarEm` e `emendaEm` são instantes depois do início da janela, em ms; `composicaoAtrasadaMin` e `reciboAtrasadoMin`,
 * minutos depois do vencimento do relatório (com o recibo atrasado, a primeira tentativa falha, como na F7, e o recibo vem
 * do reenvio automático, ou do reenvio do dono com `reenvioDoDono`). Com `masterDeFora`, o MASTER por omissão do b não leva
 * o arco: não foi a entrega do arco que o fez. Cada sessão tem o `phase_dispatch_verified` que o `phase run` grava quando o
 * runtime a lista; com `semRuntime`, a do b não tem.
 */
function piloto(nome: string, o: { semProva?: boolean; duasEntregas?: boolean; baseDeFora?: boolean; maquina?: string; aberto?: boolean;
  idempotente?: boolean; tiqueParado?: boolean; autorizarEm?: number; emendaEm?: number; composicaoAtrasadaMin?: number;
  reciboAtrasadoMin?: number; reenvioDoDono?: boolean; masterDeFora?: boolean; semRuntime?: boolean; v3?: boolean } = {}): Piloto {
  const p = projetoTemporario(nome);
  const threads = ['a', 'b'].map((x, i) => novaThread(p.carregado, { nome: `piloto ${x}`, modo: 'auto', roadmap: `RM-97${i + 1}`,
    pedido: `Trabalho ${x} SIMULADO do piloto.`, criarWorktree: false }).thread.id);
  const trabalhos: TrabalhoSimulado[] = threads.map((thread, i) => ({ id: ['a', 'b'][i], item: `RM-97${i + 1}`, prioridade: i + 1, dependeDe: [], thread }));
  const arco = `arco-${nome}`;
  const basico = { trabalhos, contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }], deslocamentoH: 2 };
  const pedido = o.v3 ? pedidoV3(arco, { ...basico, trabalhos: trabalhos.map((t, i) => ({ ...t, maquina: i ? 'maquina-b' : 'maquina-a' })),
    maquinas: [identidadeDaMaquina(p.dir, 'maquina-a'),
    { nome: 'maquina-b', chave: chaveSimulada('aceite-maquina-b') }], global: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }] })
    : pedidoV2(arco, basico);
  const janela = pedido.janela as { inicio: string; fim: string };
  const relatorioEm = partesLocais(Date.parse(janela.fim) + 30 * MIN, 'America/Sao_Paulo');
  pedido.relatorio = { horario: `${relatorioEm.hora}:${relatorioEm.minuto}`, canal: 'telegram' };
  const sha = o.autorizarEm === undefined ? autorizarPedido(p.dir, arco, pedido) : autorizarNoInstante(p.dir, arco, pedido, em(janela.inicio, o.autorizarEm));
  const conteudo = lerArco(p.dir, arco)!.conteudo!;
  const { inicio, fim } = conteudo.janela;
  const quem = o.maquina ? { ...instancia('condutor', 1), maquina: o.maquina } : instancia('condutor', 1);
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'conducao_assumida', geracao: 1, quem, prova: 'SIMULADO' }], em(inicio, MIN));
  threads.forEach((thread, i) => {
    const r = reservarDespacho(p.dir, { arco, envelopeSha256: sha, trabalho: ['a', 'b'][i], thread, fase: 'GOAL', runtime: 'claude-bg',
      conta: ['perfil-a', 'perfil-b'][i], revisao: false }, em(inicio, (5 + i) * MIN));
    const sessionId = `00000000-0000-4000-8888-00000000000${i + 1}`;
    concluirDespacho(p.dir, arco, r.seq, { thread, sessionId, idempotente: false }, em(inicio, (6 + i) * MIN));
    if (!(o.semRuntime && i === 1)) {
      registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.despachoVerificado, { ts: em(inicio, (6 + i) * MIN), fase: 'GOAL', sessionId,
        fonte: 'claude agents --json', encontrada: true });
    }
  });
  if (o.idempotente) {
    // O passo despachou de novo e o runtime devolveu a sessão em curso: a reserva conclui idempotente, sem sessão nova.
    const r = reservarDespacho(p.dir, { arco, envelopeSha256: sha, trabalho: 'a', thread: threads[0], fase: 'GOAL', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false }, em(inicio, 10 * MIN));
    concluirDespacho(p.dir, arco, r.seq, { thread: threads[0], sessionId: '00000000-0000-4000-8888-000000000001', idempotente: true }, em(inicio, 11 * MIN));
  }
  if (o.tiqueParado) {
    // A F9: o tique fica 20 min sem rodar e volta.
    gravarNaSupervisao(p.carregado, arco, [{ tipo: 'tique_iniciado', quem: instancia('vigia', 2) }], em(inicio, 3 * HORA + 20 * MIN));
    gravarNaSupervisao(p.carregado, arco, [{ tipo: 'tique_concluido', quem: instancia('vigia', 2), resumo: 'SIMULADO' }], em(inicio, 3 * HORA + 21 * MIN));
  }
  gravarNaSupervisao(p.carregado, arco, [{ tipo: 'retomada_autorizada', trabalho: 'a', thread: threads[0], fase: 'GOAL', tentativa: 1,
    motivo: 'sessao-morta', sessao: null, prova: 'SIMULADO', aposReserva: 2 }], em(inicio, 2 * HORA + 3 * MIN));
  threads.forEach((thread, i) => {
    const prova = o.semProva && i === 1 ? { origem: 'local' } : { pushVerificado: true, mergeSha: MERGE(i + 1), para: o.baseDeFora && i === 1 ? 'release' : 'main' };
    registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { ts: em(inicio, (4 + i) * HORA), ...prova, evidencia: { arco } });
    if (o.duasEntregas && i === 0) {
      registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.shipConcluido, { ts: em(inicio, 5 * HORA), ...prova, evidencia: { arco } });
    }
    aceitarPorOmissao(p.dir, thread, o.masterDeFora && i === 1 ? undefined : { arco });
  });
  if (o.emendaEm !== undefined) {
    // A emenda do dono durante a janela: o teto do arco cai de 40 para 39 sessões.
    const orcamento = pedido.orcamento as Record<string, unknown>;
    autorizarNoInstante(p.dir, arco, { ...pedido, orcamento: { ...orcamento, arco: { valor: 39, unidade: 'sessoes' } } }, em(inicio, o.emendaEm));
  }
  const vencimento = vencimentoDoRelatorio(conteudo);
  if (o.aberto) return { p, arco, threads, inicio, fim, vencimento };
  encerrarArco(p.dir, arco, { motivo: 'hora', detalhe: 'o fim do envelope chegou (SIMULADO)' }, fim);
  const primeira = em(vencimento, (o.composicaoAtrasadaMin ?? 0) * MIN);
  if (o.reciboAtrasadoMin !== undefined) {
    // A F7: o canal está fora no horário; a versão 1 sai composta, e o reenvio confirma depois.
    entregarRelatorioSeDevido(p.carregado, arco, { quando: primeira, enviar: () => ({ estado: 'falhou', motivo: 'o canal está fora (SIMULADO)' }) });
  }
  const confirmado = () => ({ estado: 'confirmado' as const, referencia: 'mensagem-SIMULADA' });
  const quandoDoRecibo = o.reciboAtrasadoMin === undefined ? primeira : em(vencimento, o.reciboAtrasadoMin * MIN);
  const r = o.reenvioDoDono ? reenviarRelatorio(p.carregado, arco, 'telegram', { quando: quandoDoRecibo, enviar: confirmado })
    : entregarRelatorioSeDevido(p.carregado, arco, { quando: quandoDoRecibo, enviar: confirmado });
  assert.equal(r.acao, 'entregue', JSON.stringify(r));
  return { p, arco, threads, inicio, fim, vencimento };
}

const F1 = (pl: Piloto): Injecao => ({ falha: 'F1', instante: em(pl.inicio, 2 * HORA) });
const aceite = (pl: Piloto, o: OpcoesDoAceite = {}): ResultadoDoAceite =>
  aceiteDoPiloto(pl.p.carregado, pl.arco, { git: gitDoGitHub(), executorGh: prsPorBranch(), injecoes: [F1(pl)], ...o });
const medida = (r: ResultadoDoAceite, id: string) => r.medidas.find(m => m.id === id)!;
const criterio = (r: ResultadoDoAceite, id: string) => r.criterios.find(c => c.id === id)!;

const registroDaRede = (pl: Piloto, tipo: DadosDoRegistro['tipo'], por: string, instante: string,
  campos: Record<string, unknown> = {}): DadosDoRegistro => ({ contrato: CONTRATO_COORDENACAO, tipo, arco: pl.arco,
    envelopeSha256: lerArco(pl.p.dir, pl.arco)!.envelopeSha256!, por, em: instante, ...campos });

const aceiteV3 = (pl: Piloto, o: OpcoesDoAceite = {}): ResultadoDoAceite => aceiteDoPiloto(pl.p.carregado, pl.arco, {
  git: gitDoGitHub(), executorGh: prsPorBranch(), injecoes: [F1(pl)], maquina: 'maquina-a', rede: { registros: [], estado: null }, ...o,
});

function fonteDaOutra(r: ResultadoDoAceite, maquina = 'maquina-b', valores: Partial<Record<string, number | null>> = {}) {
  const resultado = JSON.parse(JSON.stringify(r)) as ResultadoDoAceite;
  resultado.maquina = maquina;
  resultado.maquinas = [{ maquina, fonte: 'estado local', sha256: 'b'.repeat(64), veredito: resultado.veredito }];
  for (const [id, valor] of Object.entries(valores)) medida(resultado, id).valor = valor!;
  const bruto = `${JSON.stringify(resultado, null, 2)}\n`;
  return { fonte: `/tmp/${maquina}-aceite-piloto.json`, sha256: createHash('sha256').update(bruto).digest('hex'), resultado };
}

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
    assert.deepEqual(Object.keys(a), ['contrato', 'arco', 'envelope', 'janela', 'encerramento', 'maquina', 'maquinas', 'simulacao', 'medidas', 'criterios', 'veredito', 'lacunas'],
      'nenhum campo com o instante de quem roda');
  } finally { pl.p.limpar(); }
});

test('AC11: a agenda vazia é lacuna; a falha com alvo só se recupera pelo sinal dele; o tique parado conta em M4 e fica fora de M5', () => {
  const pl = piloto('ac11', { tiqueParado: true });
  try {
    const vazia = aceite(pl, { injecoes: [] });
    assert.deepEqual([medida(vazia, 'M4').valor, medida(vazia, 'M4').lacunas], [null, ['a agenda de injeções está vazia: nenhuma falha foi injetada']]);
    assert.deepEqual([criterio(vazia, 'A4').veredito, vazia.veredito], ['incompleto', 'incompleto'], 'sem falha injetada, nada aprova');
    const comAlvo = aceite(pl, { injecoes: [{ falha: 'F1', instante: em(pl.inicio, 2 * HORA), alvo: 'b' }] });
    assert.equal(medida(comAlvo, 'M4').valor, 0, 'a retomada do a não recupera a falha injetada no b');
    assert.equal(criterio(comAlvo, 'A4').veredito, 'reprovado');
    const doTrabalho = aceite(pl, { injecoes: [{ falha: 'F1', instante: em(pl.inicio, 2 * HORA), alvo: 'a' }] });
    assert.deepEqual([medida(doTrabalho, 'M4').valor, medida(doTrabalho, 'M5').valor], [1, 3]);
    const parado = aceite(pl, { injecoes: [F1(pl), { falha: 'F9', instante: em(pl.inicio, 3 * HORA) }] });
    assert.deepEqual([medida(parado, 'M4').valor, medida(parado, 'M5').valor], [2, 3], 'os 21 min da F9 não entram no tempo de recuperação');
    assert.equal(criterio(parado, 'A4').veredito, 'aprovado');
  } finally { pl.p.limpar(); }
});

test('AC12: o despacho idempotente não é efeito duplicado, o transporte simulado é lido da raiz do estado, e o arco aberto nunca aprova', () => {
  const pl = piloto('ac12', { idempotente: true });
  try {
    const r = aceite(pl);
    assert.deepEqual([medida(r, 'M7').valor, r.veredito], [0, 'aprovado'], JSON.stringify(medida(r, 'M7').evidencia));
    const monitor = path.join(pl.p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'noctum-host.json'), JSON.stringify({ telegram: { executavel: process.execPath,
      argumentos: [path.join(pl.p.dir, 'canal-simulado.cjs'), '{{mensagem}}'] } }));
    const comCanal = aceite(pl);
    assert.equal(comCanal.veredito, 'simulado');
    assert.deepEqual(comCanal.simulacao.marcas, ['o transporte do canal do relatório é simulado (grava num arquivo local)']);
  } finally { pl.p.limpar(); }
  const aberto = piloto('ac12a', { aberto: true });
  try {
    const r = aceite(aberto);
    assert.deepEqual([medida(r, 'M1').valor, medida(r, 'M1').lacunas[0]], [null, 'o arco ainda não fechou: a condução se mede no arco encerrado']);
    assert.equal(criterio(r, 'A1').veredito, 'incompleto');
    assert.notEqual(r.veredito, 'aprovado');
  } finally { aberto.p.limpar(); }
});

test('AC13: rodado numa worktree, o aceite lê o arco, os ledgers e o transporte do canal da raiz canônica do estado', () => {
  const pl = piloto('ac13');
  const wt = path.join(dirTemporario('ac13-worktree'), 'wt');
  try {
    assert.equal(spawnSync('git', ['worktree', 'add', '-q', '--detach', wt], { cwd: pl.p.dir, encoding: 'utf8' }).status, 0);
    const monitor = path.join(pl.p.dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    fs.writeFileSync(path.join(monitor, 'noctum-host.json'), JSON.stringify({ telegram: { executavel: process.execPath,
      argumentos: [path.join(pl.p.dir, 'canal-simulado.cjs'), '{{mensagem}}'] } }));
    const r = aceiteDoPiloto({ ...pl.p.carregado, raiz: wt }, pl.arco, { git: gitDoGitHub(), executorGh: prsPorBranch(), injecoes: [F1(pl)] });
    assert.deepEqual(r.medidas.map(m => [m.id, m.valor]), [['M1', 8], ['M2', 2], ['M3', 2], ['M4', 1], ['M5', 3], ['M6', 0], ['M7', 0], ['M8', 0],
      ['M9', 0], ['M10', 1]]);
    assert.deepEqual([r.veredito, r.simulacao.marcas], ['simulado', ['o transporte do canal do relatório é simulado (grava num arquivo local)']],
      'o transporte mora na raiz do estado, não na worktree');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: pl.p.dir });
    fs.rmSync(path.dirname(wt), { recursive: true, force: true });
    pl.p.limpar();
  }
});

test('AC14: a condução começa na primeira autorização, e a emenda do dono durante a janela é ato que corta M1', () => {
  const pl = piloto('ac14', { autorizarEm: MIN, emendaEm: 3 * HORA });
  try {
    const r = aceite(pl);
    assert.deepEqual([medida(r, 'M1').valor, medida(r, 'M1').evidencia.inicio], [2.98, em(pl.inicio, MIN)],
      'de 1 min depois do início (a autorização) até a emenda, às 3 h');
    assert.deepEqual(medida(r, 'M1').evidencia.atos, [{ em: em(pl.inicio, 3 * HORA), ato: 'emenda do envelope (versão 2) durante a janela' }]);
    assert.deepEqual([r.envelope.versao, criterio(r, 'A1').veredito, r.veredito], [2, 'reprovado', 'reprovado']);
  } finally { pl.p.limpar(); }
});

test('AC15: o ledger com linha corrompida, ou que nem se abre, é lacuna em M1, M2, M6 e M7 e evidência perdida em M8, nunca zero', () => {
  const pl = piloto('ac15');
  const [a, b] = pl.threads;
  const doA = path.join(dirThread(pl.p.dir, a), 'ledger.jsonl');
  try {
    fs.appendFileSync(path.join(dirThread(pl.p.dir, b), 'ledger.jsonl'), '{"tipo":"ship_done","ts":\n');
    const r = aceite(pl);
    assert.deepEqual(['M1', 'M2', 'M6', 'M7', 'M8'].map(id => medida(r, id).valor), [null, null, null, null, 1]);
    assert.deepEqual(medida(r, 'M8').evidencia.perdidas, [`o ledger da thread ${b} tem linha corrompida`]);
    assert.deepEqual([criterio(r, 'A2').veredito, criterio(r, 'I3').veredito, r.veredito], ['incompleto', 'reprovado', 'reprovado']);
    // O ledger que nem se abre (uma pasta no lugar do arquivo) também.
    fs.rmSync(doA);
    fs.mkdirSync(doA);
    const r2 = aceite(pl);
    assert.equal(medida(r2, 'M8').valor, 2);
    assert.match((medida(r2, 'M8').evidencia.perdidas as string[])[0], new RegExp(`^o ledger da thread ${a} não se lê`));
  } finally {
    // A limpeza do projeto lê os ledgers: a pasta sai antes.
    fs.rmSync(doA, { recursive: true, force: true });
    pl.p.limpar();
  }
});

test('AC16: só a entrega do arco conta: o que o dono faz depois do arco não muda o aceite, e o merge de fora reconciliado na janela é ato dele', () => {
  const pl = piloto('ac16');
  try {
    const antes = hashDoAceite(aceite(pl)).sha256;
    const [a, b] = pl.threads;
    // Depois do arco, o dono entrega o a de novo, à mão: dois pushes do mesmo SHA e o ship sem o arco na evidência.
    for (const h of [1, 2]) registrar(dirThread(pl.p.dir, a), a, TIPOS_DE_EVENTO.shipPublicado, { ts: em(pl.fim, h * HORA), pushFeito: true, head: MERGE(7) });
    registrar(dirThread(pl.p.dir, a), a, TIPOS_DE_EVENTO.shipConcluido, { ts: em(pl.fim, 3 * HORA), pushVerificado: true, mergeSha: MERGE(7), para: 'release' });
    assert.equal(hashDoAceite(aceite(pl)).sha256, antes, 'o que o dono fez depois do arco não entra no aceite dele');
    // O MASTER por omissão do b só chegou depois do arco: não é o do arco.
    moverEventos(pl.p.dir, b, TIPOS_DE_EVENTO.aceitePorOmissao, em(pl.fim, HORA));
    const semMaster = aceite(pl);
    assert.deepEqual([medida(semMaster, 'M3').valor, medida(semMaster, 'M3').evidencia.semMaster, criterio(semMaster, 'A6').veredito], [1, [b], 'reprovado']);
    // Na janela, o merge do b por outro caminho, que a entrega do arco reconciliou: é ato do dono, e não entrega do arco.
    registrar(dirThread(pl.p.dir, b), b, TIPOS_DE_EVENTO.shipConcluido, { ts: em(pl.inicio, 6 * HORA), pushVerificado: true, mergeSha: MERGE(2), para: 'main',
      evidencia: { arco: pl.arco, incorporadaPor: 'outro-caminho' } });
    const r = aceite(pl);
    assert.deepEqual(['M1', 'M2', 'M7'].map(id => medida(r, id).valor), [6, 2, 0]);
    assert.deepEqual(medida(r, 'M1').evidencia.atos, [{ em: em(pl.inicio, 6 * HORA), ato: `entrega de fora do arco na thread ${b}` }]);
    assert.equal(criterio(r, 'A1').veredito, 'reprovado');
  } finally { pl.p.limpar(); }
});

test('AC17: com a F7 na agenda, vale o recibo que o reenvio automático traz no ciclo dele; o do reenvio do dono, o tardio, a composição tarde e a falta da F7 reprovam', () => {
  const pl = piloto('ac17', { reciboAtrasadoMin: 10 });
  try {
    const comF7 = aceite(pl, { injecoes: [F1(pl), { falha: 'F7', instante: pl.vencimento }] });
    assert.deepEqual([medida(comF7, 'M10').valor, medida(comF7, 'M4').valor, comF7.veredito], [1, 2, 'aprovado'], JSON.stringify(medida(comF7, 'M10').evidencia));
    const semF7 = aceite(pl);
    assert.deepEqual([medida(semF7, 'M10').valor, criterio(semF7, 'A7').veredito], [0, 'reprovado']);
    assert.match(criterio(semF7, 'A7').detalhe, /o último recibo da versão 1 chegou depois do vencimento e de um tique/);
  } finally { pl.p.limpar(); }
  // N1 do CHECK 3: o recibo que só o reenvio pedido pelo dono trouxe não é recuperação da F7 nem envio no horário.
  const doDono = piloto('ac17b', { reciboAtrasadoMin: 120, reenvioDoDono: true });
  try {
    const r = aceite(doDono, { injecoes: [F1(doDono), { falha: 'F7', instante: doDono.vencimento }] });
    assert.deepEqual([medida(r, 'M10').valor, medida(r, 'M4').valor, criterio(r, 'A7').veredito, criterio(r, 'A4').veredito],
      [0, 1, 'reprovado', 'reprovado'], JSON.stringify(medida(r, 'M10').evidencia));
    assert.match(criterio(r, 'A7').detalhe, /página\(s\) da versão 1 sem recibo do envio automático/);
  } finally { doDono.p.limpar(); }
  const tardio = piloto('ac17c', { reciboAtrasadoMin: 120 });
  try {
    const r = aceite(tardio, { injecoes: [F1(tardio), { falha: 'F7', instante: tardio.vencimento }] });
    assert.deepEqual([medida(r, 'M10').valor, criterio(r, 'A7').detalhe], [0, 'o último recibo da versão 1 chegou depois do ciclo de reenvio automático']);
  } finally { tardio.p.limpar(); }
  const tarde = piloto('ac17a', { composicaoAtrasadaMin: 30 });
  try {
    const r = aceite(tarde, { injecoes: [F1(tarde), { falha: 'F7', instante: tarde.vencimento }] });
    assert.deepEqual([medida(r, 'M10').valor, criterio(r, 'A7').veredito], [0, 'reprovado']);
    assert.equal(criterio(r, 'A7').detalhe, 'a versão 1 foi composta depois do vencimento e de um tique');
  } finally { tarde.p.limpar(); }
});

test('AC18: os limiares recusam a chave desconhecida, em vez de deixar o critério com a proposta em silêncio', () => {
  assert.throws(() => lerLimiares({ contrato: CONTRATO_LIMIARES, m1MinimoHora: 6 }), (e: unknown) => e instanceof RecusaDoAceite &&
    e.motivo === 'noctum.aceite.limiares-invalidos' && /chave\(s\) desconhecida\(s\): m1MinimoHora;/.test(e.message));
  assert.deepEqual(lerLimiares({ contrato: CONTRATO_LIMIARES, m1MinimoHoras: 6, atrasoDoRelatorioMin: 10 }), { m1MinimoHoras: 6, atrasoDoRelatorioMin: 10 });
});

test('AC19: a reversão e o PR que o dono faz depois do arco não mudam o aceite; a reversão durante a condução é ato dele', () => {
  const pl = piloto('ac19');
  try {
    const antes = hashDoAceite(aceite(pl)).sha256;
    const [a] = pl.threads;
    // Passada a janela de entrega do relatório, o dono reverte a entrega do a e abre outro PR na branch dele.
    const depois = { sha: 'e'.repeat(40), em: em(pl.vencimento, 25 * HORA) };
    registrar(dirThread(pl.p.dir, a), a, TIPOS_DE_EVENTO.rollbackConcluido, { ts: depois.em, mergeSha: MERGE(1), revertSha: depois.sha, para: 'main' });
    const comPrDepois: ExecutorDoGh = () => ({ status: 0, stderr: '', stdout: JSON.stringify([
      { number: 1, state: 'MERGED', headRefOid: 'a'.repeat(40), createdAt: em(pl.inicio, HORA) },
      { number: 2, state: 'OPEN', headRefOid: 'b'.repeat(40), createdAt: em(pl.fim, 2 * HORA) }]) });
    assert.equal(hashDoAceite(aceite(pl, { executorGh: comPrDepois, git: comReversoes({ [MERGE(1)]: [depois] }) })).sha256, antes,
      'o que o dono fez depois do arco não entra no aceite');
    const durante = { sha: 'd'.repeat(40), em: em(pl.inicio, 6 * HORA) };
    registrar(dirThread(pl.p.dir, a), a, TIPOS_DE_EVENTO.rollbackConcluido, { ts: durante.em, mergeSha: MERGE(1), revertSha: durante.sha, para: 'main' });
    const r = aceite(pl, { git: comReversoes({ [MERGE(1)]: [durante, depois] }) });
    assert.deepEqual(medida(r, 'M1').evidencia.atos, [{ em: em(pl.inicio, 6 * HORA), ato: `reversão de entrega na thread ${a}` }]);
    assert.equal(medida(r, 'M1').valor, 6);
  } finally { pl.p.limpar(); }
});

test('AC20: o MASTER do arco é o por omissão que a entrega dele marca; o de fora do arco não conta em M3 e, na condução, é ato do dono', () => {
  const pl = piloto('ac20', { masterDeFora: true });
  try {
    const [a, b] = pl.threads;
    const r = aceite(pl);
    assert.deepEqual([medida(r, 'M3').valor, medida(r, 'M3').evidencia.semMaster, criterio(r, 'A6').veredito], [1, [b], 'reprovado']);
    registrar(dirThread(pl.p.dir, a), a, TIPOS_DE_EVENTO.aceitePorOmissao, { ts: em(pl.inicio, 6 * HORA), fase: 'MASTER' });
    const r2 = aceite(pl);
    assert.deepEqual(medida(r2, 'M1').evidencia.atos, [{ em: em(pl.inicio, 6 * HORA), ato: `MASTER por omissão de fora do arco na thread ${a}` }]);
  } finally { pl.p.limpar(); }
});

test('AC21: a agenda de injeções recusa a chave desconhecida e o alvo que não é texto, em vez de virar injeção sem alvo', () => {
  const instante = new Date().toISOString();
  // M4 do CHECK 4: o alvo vazio valeria como o arco inteiro.
  for (const linha of [{ falha: 'F1', instante, Alvo: 'w2' }, { falha: 'F1', instante, alvo: 2 }, { falha: 'F1', instante, alvo: '' }, { falha: 'F1', instante, alvo: ' ' }]) {
    assert.throws(() => lerInjecoes(JSON.stringify(linha)), (e: unknown) => e instanceof RecusaDoAceite && e.motivo === 'noctum.aceite.injecoes-invalidas' &&
      /só aceita falha, instante e alvo \(texto\)/.test(e.message), JSON.stringify(linha));
  }
  assert.deepEqual(lerInjecoes(JSON.stringify({ falha: 'F1', instante, alvo: 'w2' })), [{ falha: 'F1', instante, alvo: 'w2' }]);
});

test('AC22: com a F7 na agenda, o recibo vale até o fim do ciclo de reenvio automático (45 min com o tique de 5 min), e não depois', () => {
  // CHECK 4: o AC17 tinha recibos em 10 e 120 min, e a conta do ciclo com uma tentativa a mais passava nele.
  const dentro = piloto('ac22a', { reciboAtrasadoMin: 44 });
  try {
    const r = aceite(dentro, { injecoes: [F1(dentro), { falha: 'F7', instante: dentro.vencimento }] });
    assert.deepEqual([medida(r, 'M10').valor, criterio(r, 'A7').veredito], [1, 'aprovado'], JSON.stringify(medida(r, 'M10').evidencia));
  } finally { dentro.p.limpar(); }
  const fora = piloto('ac22b', { reciboAtrasadoMin: 50 });
  try {
    const r = aceite(fora, { injecoes: [F1(fora), { falha: 'F7', instante: fora.vencimento }] });
    assert.deepEqual([medida(r, 'M10').valor, criterio(r, 'A7').detalhe], [0, 'o último recibo da versão 1 chegou depois do ciclo de reenvio automático']);
  } finally { fora.p.limpar(); }
});

test('AC23: a reversão de uma entrega do arco é ato do dono pela data do commit, também detectada depois do arco ou só no git; a de uma entrega anterior ao arco não é', () => {
  // I2 do CHECK 4: o aceite contava o rollback_done pelo instante da detecção, e de qualquer merge.
  const pl = piloto('ac23');
  try {
    const [a] = pl.threads;
    const durante = { sha: 'd'.repeat(40), em: em(pl.inicio, 6 * HORA) };
    // O dono reverte a entrega do a às 6 h da condução; o núcleo só a detecta no MASTER do dia seguinte.
    registrar(dirThread(pl.p.dir, a), a, TIPOS_DE_EVENTO.rollbackConcluido, { ts: em(pl.fim, 30 * HORA), mergeSha: MERGE(1), revertSha: durante.sha, para: 'main' });
    const r = aceite(pl, { git: comReversoes({ [MERGE(1)]: [durante] }) });
    assert.deepEqual(medida(r, 'M1').evidencia.atos, [{ em: durante.em, ato: `reversão de entrega na thread ${a}` }]);
    assert.deepEqual([medida(r, 'M1').valor, criterio(r, 'A1').veredito, r.veredito], [6, 'reprovado', 'reprovado']);
    // Sem a data do commit no git, a detecção depois do arco não prova quando a reversão foi: lacuna, e o aceite não aprova.
    const semData = aceite(pl);
    assert.deepEqual([medida(semData, 'M1').valor, criterio(semData, 'A1').veredito], [null, 'incompleto']);
    assert.match(medida(semData, 'M1').lacunas.join('; '), /a reversão d{12} do merge 1{12} não tem a data do commit no git/);
  } finally { pl.p.limpar(); }
  const soNoGit = piloto('ac23b');
  try {
    // Ninguém rodou o ship nem o MASTER do b depois da reversão: só o git a mostra.
    const reversao = { sha: 'c'.repeat(40), em: em(soNoGit.inicio, 7 * HORA) };
    const r = aceite(soNoGit, { git: comReversoes({ [MERGE(2)]: [reversao] }) });
    assert.deepEqual(medida(r, 'M1').evidencia.atos, [{ em: reversao.em, ato: `reversão de entrega na thread ${soNoGit.threads[1]}` }]);
    assert.equal(medida(r, 'M1').valor, 7);
    // A reversão depois do arco, achada no git, não é ato da condução.
    const depois = aceite(soNoGit, { git: comReversoes({ [MERGE(2)]: [{ sha: 'c'.repeat(40), em: em(soNoGit.fim, HORA) }] }) });
    assert.deepEqual([medida(depois, 'M1').valor, depois.veredito], [8, 'aprovado']);
  } finally { soNoGit.p.limpar(); }
  const anterior = piloto('ac23c');
  try {
    const antes = hashDoAceite(aceite(anterior)).sha256;
    const [a] = anterior.threads;
    // A entrega de antes do arco, revertida e detectada na condução e na janela do relatório: não é ato do arco nem pede a
    // correção do relatório.
    registrar(dirThread(anterior.p.dir, a), a, TIPOS_DE_EVENTO.rollbackConcluido, { ts: em(anterior.inicio, 6 * HORA), mergeSha: MERGE(9),
      revertSha: 'b'.repeat(40), para: 'main' });
    registrar(dirThread(anterior.p.dir, a), a, TIPOS_DE_EVENTO.rollbackConcluido, { ts: em(anterior.vencimento, HORA), mergeSha: MERGE(9),
      revertSha: 'a'.repeat(40), para: 'main' });
    assert.equal(hashDoAceite(aceite(anterior, { git: comReversoes({ [MERGE(9)]: [{ sha: 'b'.repeat(40), em: em(anterior.inicio, 6 * HORA) }] }) })).sha256, antes,
      'a reversão de uma entrega que não é do arco não muda o aceite dele');
  } finally { anterior.p.limpar(); }
});

test('AC24: o despacho cuja sessão o runtime não confirmou dá simulado: sem o phase_dispatch_verified, não encontrada ou por fonte simulada', () => {
  // I3 do CHECK 4: a marca "despacho sem sessão do runtime" da T8 não existia.
  const pl = piloto('ac24', { semRuntime: true });
  try {
    const [, b] = pl.threads;
    const sessionId = '00000000-0000-4000-8888-000000000002';
    const marca = /^1 despacho\(s\) do arco sem a sessão confirmada pelo runtime \(reserva \d+\)$/;
    const semEvento = aceite(pl);
    assert.equal(semEvento.veredito, 'simulado');
    assert.equal(semEvento.simulacao.marcas.length, 1);
    assert.match(semEvento.simulacao.marcas[0], marca);
    const verificar = (fonte: string, encontrada: boolean) => registrar(dirThread(pl.p.dir, b), b, TIPOS_DE_EVENTO.despachoVerificado,
      { ts: em(pl.inicio, 8 * MIN), fase: 'GOAL', sessionId, fonte, encontrada });
    verificar('claude agents --json', false);
    assert.match(aceite(pl).simulacao.marcas.join('\n'), marca, 'a sessão que o runtime não listou não confirma');
    verificar('claude agents --json (SIMULADO)', true);
    assert.match(aceite(pl).simulacao.marcas.join('\n'), marca, 'a fonte simulada não confirma');
    verificar('claude agents --json', true);
    const r = aceite(pl);
    assert.deepEqual([r.simulacao.marcas, r.veredito], [[], 'aprovado']);
  } finally { pl.p.limpar(); }
});
test('AC25: o git real acha o commit que reverte o merge, pela data do commit; o git que não responde e o ledger que não se lê são lacuna, sem a marca do runtime', () => {
  // CHECK 5: só leitores SIMULADOS exercitavam o `reversoes`; o intervalo invertido e a data do autor passavam.
  const dir = dirTemporario('ac25-git');
  try {
    const git = (args: string[], env: Record<string, string> = {}): string => {
      const r = spawnSync('git', ['-c', 'user.email=teste@orkastery.local', '-c', 'user.name=Teste Orkastery', '-c', 'commit.gpgsign=false', ...args],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git(['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(dir, 'a'), 'a\n');
    git(['add', 'a']);
    git(['commit', '-q', '-m', 'base']);
    git(['checkout', '-q', '-b', 'tema']);
    fs.writeFileSync(path.join(dir, 'b'), 'b\n');
    git(['add', 'b']);
    git(['commit', '-q', '-m', 'tema']);
    git(['checkout', '-q', 'main']);
    git(['merge', '-q', '--no-ff', 'tema', '-m', 'merge do tema']);
    const merge = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(dir, 'c'), 'c\n');
    git(['add', 'c']);
    git(['commit', '-q', '-m', 'outro']);
    const outro = git(['rev-parse', 'HEAD']);
    // O autor escreveu o revert um dia antes; vale a data do commit que entrou na base.
    git(['revert', '-m', '1', '--no-edit', merge], { GIT_AUTHOR_DATE: '2026-01-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-01-02T05:00:00Z' });
    const revert = git(['rev-parse', 'HEAD']);
    git(['remote', 'add', 'origin', dir]);
    const leitor = gitDaRaiz(dir);
    const ponta = leitor.ponta('origin', 'main');
    assert.equal(ponta, revert);
    assert.deepEqual((leitor.reversoes!(merge, ponta!) ?? []).map(r => ({ sha: r.sha, em: new Date(r.em).toISOString() })),
      [{ sha: revert, em: '2026-01-02T05:00:00.000Z' }]);
    assert.deepEqual(leitor.reversoes!(outro, ponta!), [], 'o commit que ninguém reverteu');
    assert.equal(leitor.reversoes!('0'.repeat(40), ponta!), null, 'o merge que não está nesta cópia');
    assert.equal(leitor.reversoes!('--all', ponta!), null, 'só hexadecimal chega ao git log');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const pl = piloto('ac25', { semRuntime: true });
  const [, b] = pl.threads;
  const doB = path.join(dirThread(pl.p.dir, b), 'ledger.jsonl');
  try {
    // O git que não lê as reversões do merge do arco não é "nenhuma reversão": M1 fica em lacuna.
    const mudo = aceite(pl, { git: { ...comReversoes({}), reversoes: () => null } });
    assert.deepEqual([medida(mudo, 'M1').valor, criterio(mudo, 'A1').veredito], [null, 'incompleto']);
    assert.match(medida(mudo, 'M1').lacunas.join('; '), /as reversões do merge 1{12} não se leram no git/);
    // O ledger do b, cuja sessão não tem o phase_dispatch_verified, nem se abre: é lacuna, e não a marca do despacho sem sessão.
    fs.rmSync(doB);
    fs.mkdirSync(doB);
    const r = aceite(pl);
    assert.ok(!r.simulacao.marcas.some(m => /sem a sessão confirmada pelo runtime/.test(m)), r.simulacao.marcas.join('\n'));
    assert.notEqual(r.veredito, 'simulado');
    assert.notEqual(r.veredito, 'aprovado');
  } finally {
    fs.rmSync(doB, { recursive: true, force: true });
    pl.p.limpar();
  }
});

test('AC26: a F10 é medida pelo primeiro registro assinado pela máquina alvo depois da partição', () => {
  const pl = piloto('ac26', { v3: true });
  try {
    const injecao = em(pl.inicio, HORA);
    const registros = [registroDaRede(pl, 'batida', 'maquina-b', em(injecao, 9 * MIN))];
    const r = aceiteV3(pl, { injecoes: [{ falha: 'F10', instante: injecao, alvo: 'maquina-b' }], rede: { registros, estado: null } });
    assert.equal(medida(r, 'M4').valor, 1);
    assert.deepEqual((medida(r, 'M4').evidencia.injecoes as Array<{ sinal: { maquina: string } }>)[0].sinal.maquina, 'maquina-b');
  } finally { pl.p.limpar(); }
});

test('AC27: a F11 mede o primeiro ato de outra máquina e só completa depois do recibo de fim', () => {
  const pl = piloto('ac27', { v3: true });
  try {
    const injecao = em(pl.inicio, HORA);
    const tomada = registroDaRede(pl, 'autoridade', 'maquina-a', em(injecao, 20 * MIN),
      { geracao: 2, modo: 'forcada', anterior: { geracao: 1, maquina: 'maquina-b' }, motivo: 'SIMULADO', selo: null });
    const completa = aceiteV3(pl, { injecoes: [{ falha: 'F11', instante: injecao, alvo: 'maquina-b' }], rede: { registros: [tomada], estado: null } });
    assert.deepEqual([medida(completa, 'M4').valor, medida(completa, 'M5').valor], [1, 20]);
    const esperando = aceiteV3(pl, { injecoes: [{ falha: 'F11', instante: injecao, alvo: 'maquina-b' }],
      rede: { registros: [tomada], estado: null, ordensIsoladas: [{ maquina: 'maquina-b', trabalho: 'b' }] } });
    assert.equal(medida(esperando, 'M4').valor, 0);
    assert.deepEqual(medida(esperando, 'M4').evidencia.aguardamRecibo, [{ maquina: 'maquina-b', trabalho: 'b' }]);
  } finally { pl.p.limpar(); }
});

test('AC28: F10 e F11 sem alvo deixam a medida em lacuna', () => {
  const pl = piloto('ac28', { v3: true });
  try {
    const r = aceiteV3(pl, { injecoes: [{ falha: 'F10', instante: pl.inicio }, { falha: 'F11', instante: pl.inicio }],
      rede: { registros: [], estado: null } });
    assert.equal(medida(r, 'M4').valor, null);
    assert.match(medida(r, 'M4').lacunas.join('; '), /F10 exige o alvo.*F11 exige o alvo/);
  } finally { pl.p.limpar(); }
});

test('AC29: M2 e M9 trazem a evidência dividida por máquina a partir da coordenação', () => {
  const pl = piloto('ac29', { v3: true });
  try {
    const entrega = registroDaRede(pl, 'entrega', 'maquina-b', em(pl.inicio, 5 * HORA), { trabalho: 'b', merge: MERGE(2), destino: 'destino' });
    const vaga = { vaga: 'V-b-1', maquina: 'maquina-b', conta: 'perfil-b', runtime: 'claude-bg', ordem: 'O-b-1', trabalho: 'b', reserva: 2,
      chave: 'chave-b', desde: em(pl.inicio, HORA), solta: null };
    const r = aceiteV3(pl, { rede: { registros: [entrega], estado: null, vagas: [vaga] } });
    assert.deepEqual(medida(r, 'M2').evidencia.porMaquina, { 'maquina-a': 0, 'maquina-b': 1 });
    assert.deepEqual(medida(r, 'M9').evidencia.porMaquina, { 'maquina-a': 0, 'maquina-b': 1 });
  } finally { pl.p.limpar(); }
});

test('AC30: o aceite completo da outra máquina combina M1, M3, M6, M8 e M10', () => {
  const pl = piloto('ac30', { v3: true });
  try {
    const local = aceiteV3(pl);
    const outra = fonteDaOutra(local, 'maquina-b', { M1: 7, M3: 3, M6: 2, M8: 4, M10: 1 });
    const r = aceiteV3(pl, { outrasMaquinas: [outra] });
    assert.deepEqual(['M1', 'M3', 'M6', 'M8', 'M10'].map(id => medida(r, id).valor), [7, 5, 2, 4, 1]);
    assert.deepEqual(r.maquinas.map(m => [m.maquina, m.fonte]), [['maquina-a', 'estado local'], ['maquina-b', outra.fonte]]);
  } finally { pl.p.limpar(); }
});

test('AC31: sem o arquivo da outra máquina as medidas combinadas ficam em lacuna e o veredito incompleto', () => {
  const pl = piloto('ac31', { v3: true });
  try {
    const r = aceiteV3(pl);
    assert.equal(medida(r, 'M1').valor, null);
    assert.match(medida(r, 'M1').lacunas.join('; '), /sem o aceite completo da\(s\) máquina\(s\): maquina-b/);
    assert.equal(r.veredito, 'incompleto');
  } finally { pl.p.limpar(); }
});

test('AC32: vagas do mesmo trabalho ativas em duas máquinas ao mesmo tempo contam em M7', () => {
  const pl = piloto('ac32', { v3: true });
  try {
    const vaga = (n: number, maquina: string, inicio: number, fim: number | null) => ({ vaga: `V-a-${n}`, maquina, conta: 'perfil-a', runtime: 'claude-bg',
      ordem: `O-a-${n}`, trabalho: 'a', reserva: n, chave: `chave-${n}`, desde: em(pl.inicio, inicio * MIN),
      solta: fim === null ? null : { em: em(pl.inicio, fim * MIN), consumiu: true, motivo: 'SIMULADO' } });
    const r = aceiteV3(pl, { rede: { registros: [], estado: null, vagas: [vaga(1, 'maquina-a', 10, 30), vaga(2, 'maquina-b', 20, 40)] } });
    assert.equal(medida(r, 'M7').valor, 1);
    assert.equal((medida(r, 'M7').evidencia.vagasSobrepostas as unknown[]).length, 1);
  } finally { pl.p.limpar(); }
});

test('AC33: o publicável troca também os nomes das máquinas do envelope', () => {
  const pl = piloto('ac33', { v3: true });
  try {
    const r = aceiteV3(pl);
    const publico = JSON.stringify(publicavel(r, hashDoAceite(r).sha256, sensiveisDoArco(pl.p.carregado, pl.arco)));
    assert.doesNotMatch(publico, /maquina-a|maquina-b/);
    assert.match(publico, /maquina-1/);
  } finally { pl.p.limpar(); }
});

test('AC34: a proposta de A4 é 25 min no v3 e continua 15 min no v2', () => {
  const v3 = piloto('ac34v3', { v3: true }), v2 = piloto('ac34v2');
  try {
    assert.equal(criterio(aceiteV3(v3), 'A4').limiar?.m5MaximoMin, 25);
    assert.equal(criterio(aceite(v2), 'A4').limiar?.m5MaximoMin, 15);
  } finally { v3.p.limpar(); v2.p.limpar(); }
});

test('AC35: o arquivo de outro arco ou de máquina fora do envelope é recusado', () => {
  const pl = piloto('ac35', { v3: true });
  try {
    const base = aceiteV3(pl);
    const outroArco = fonteDaOutra(base);
    outroArco.resultado.arco = 'arco-outro';
    assert.throws(() => aceiteV3(pl, { outrasMaquinas: [outroArco] }),
      (e: unknown) => e instanceof RecusaDoAceite && e.motivo === 'noctum.aceite.outra-maquina-invalida');
    const fora = fonteDaOutra(base, 'maquina-c');
    assert.throws(() => aceiteV3(pl, { outrasMaquinas: [fora] }),
      (e: unknown) => e instanceof RecusaDoAceite && e.motivo === 'noctum.aceite.outra-maquina-invalida');
  } finally { pl.p.limpar(); }
});

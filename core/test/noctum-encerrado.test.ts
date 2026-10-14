/**
 * RM-058 (N6, D2 e D7 da ork-rm058n6): o arco encerrado é terminal, e o registro da N6 confere cadeia, MAC e domínio.
 * Todas as identidades, chaves, provas e valores deste arquivo são SIMULADOS em diretórios temporários.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { dirTemporario } from './apoio';
import { abrirArco, autorizarPedido, pedidoV2, prepararIngressoSimulado, revogarArco } from './noctum-apoio';
import { assinadoPara } from './noctum-n6-apoio';
import { chaveLocal } from '../src/hitl-local-receipt';
import { kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { autorizarPeloIngresso, concluirDespacho, conferirAntesDoEfeito, encerrarArco, lerArco, PedidoDeDespacho, proporEnvelope,
  reservarDespacho, textoDeAutorizacao } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import { responderAoArco } from '../src/noctum-modo';
import { FatosDaFila, montarFila } from '../src/noctum-fila';
import { comRegistro, lerRegistro, RecusaDoRegistro } from '../src/noctum-registro';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const TRABALHOS = [{ id: 't1', item: 'RM-901', prioridade: 1, dependeDe: [], thread: 'ork-simulada-t1' }];

function comRaiz<T>(nome: string, corpo: (raiz: string) => T): T {
  const raiz = dirTemporario(`noctum-${nome}`);
  fs.mkdirSync(path.join(raiz, '.orkastery'));
  try { return corpo(raiz); } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
}

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco || e instanceof RecusaDoRegistro, `esperava recusa tipada, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

const despacho = (arco: string, envelopeSha256: string): PedidoDeDespacho => ({ arco, envelopeSha256, trabalho: 't1',
  thread: 'ork-simulada-t1', fase: 'GO', runtime: 'claude-bg', conta: 'perfil-a', revisao: false });

const efeito = (arco: string, envelopeSha256: string) => ({ arco, envelopeSha256, acao: 'push', repositorio: 'exemplo/produto',
  branch: 'ork/trabalho-t1' });

test('EC1: o arco encerrado recusa a reserva de despacho e a conferência antes do efeito', { skip: semKernel }, () => comRaiz('ec1', raiz => {
  const sha256 = abrirArco(raiz, 'arco-ec1', { trabalhos: TRABALHOS });
  assert.equal(conferirAntesDoEfeito(raiz, efeito('arco-ec1', sha256)).ok, true, 'antes do fechamento o efeito passa');
  const estado = encerrarArco(raiz, 'arco-ec1', { motivo: 'fila-vazia', detalhe: 'todo trabalho entregue' });
  assert.equal(estado.situacao, 'encerrado');
  assert.equal(estado.encerramento?.motivo, 'fila-vazia');
  assert.equal(estado.encerramento?.envelopeSha256, sha256);
  recusa(() => reservarDespacho(raiz, despacho('arco-ec1', sha256)), 'noctum.efeito.encerrado');
  assert.match(recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-ec1', sha256)), 'noctum.efeito.encerrado'), /não reabre/);
}));

test('EC2: a reserva devolvida depois do encerramento por custo não reabre o arco', { skip: semKernel }, () => comRaiz('ec2', raiz => {
  const sha256 = abrirArco(raiz, 'arco-ec2', { trabalhos: TRABALHOS, tetoDoArco: 1 });
  const r = reservarDespacho(raiz, despacho('arco-ec2', sha256));
  recusa(() => reservarDespacho(raiz, despacho('arco-ec2', sha256)), 'noctum.orcamento.esgotado');
  encerrarArco(raiz, 'arco-ec2', { motivo: 'custo', detalhe: 'teto do arco alcançado' });
  // A contabilidade do que estava em voo continua: a recusa do núcleo devolve a sessão ao orçamento.
  const depois = concluirDespacho(raiz, 'arco-ec2', r.seq, { motivo: 'runtime.quota-exhausted' });
  assert.equal(depois.consumo.arco, 0, 'a sessão voltou ao orçamento');
  assert.equal(depois.situacao, 'encerrado');
  recusa(() => reservarDespacho(raiz, despacho('arco-ec2', sha256)), 'noctum.efeito.encerrado');
}));

test('EC3: emenda depois do encerramento é recusada, e a proposta de antes não se autoriza depois', { skip: semKernel }, () => comRaiz('ec3', raiz => {
  const original = pedidoV2('arco-ec3', { trabalhos: TRABALHOS });
  const sha256 = autorizarPedido(raiz, 'arco-ec3', original);
  // A emenda mantém a janela e muda o teto: versão nova, que espera o dono.
  const comTeto = (valor: number) => ({ ...original, orcamento: { ...(original.orcamento as Record<string, unknown>),
    arco: { valor, unidade: 'sessoes' } } });
  const pendente = proporEnvelope(raiz, comTeto(30));
  assert.notEqual(pendente.envelopeSha256, sha256);
  assert.equal(lerArco(raiz, 'arco-ec3')!.propostaPendente?.envelopeSha256, pendente.envelopeSha256);
  encerrarArco(raiz, 'arco-ec3', { motivo: 'hora', detalhe: 'o fim do envelope chegou' });
  assert.equal(lerArco(raiz, 'arco-ec3')!.propostaPendente, null, 'arco encerrado não tem proposta pendente');
  recusa(() => proporEnvelope(raiz, comTeto(35)), 'noctum.efeito.encerrado');
  recusa(() => autorizarPeloIngresso(raiz, 'arco-ec3', pendente.envelopeSha256,
    assinadoPara('arco-ec3', textoDeAutorizacao(pendente.envelopeSha256))), 'noctum.efeito.encerrado');
  assert.equal(lerArco(raiz, 'arco-ec3')!.envelopeSha256, sha256, 'a versão que valia no fechamento continua a do registro');
}));

test('EC4: a fila do arco encerrado encerra, sem candidato', { skip: semKernel }, () => comRaiz('ec4', raiz => {
  abrirArco(raiz, 'arco-ec4', { trabalhos: TRABALHOS });
  encerrarArco(raiz, 'arco-ec4', { motivo: 'custo', detalhe: 'teto' });
  const fatos: FatosDaFila = { arco: 'arco-ec4', quando: new Date().toISOString(), maquina: 'maquina-simulada',
    estado: lerArco(raiz, 'arco-ec4'), reservas: { leitura: 'copia-local', porItem: new Map([['RM-901', { maquina: 'maquina-simulada', thread: null }]]) },
    porTrabalho: new Map(), threadsIlegiveis: [], modosPermitidos: ['auto'] };
  const fila = montarFila(fatos);
  assert.deepEqual(fila.decisao, { acao: 'encerrar', motivo: 'arco-encerrado' });
  assert.equal(fila.candidatos.length, 0);
}));

test('EC5: o segundo encerramento devolve o primeiro; arco sem autorização e motivo fora da lista não encerram', { skip: semKernel }, () => comRaiz('ec5', raiz => {
  abrirArco(raiz, 'arco-ec5', { trabalhos: TRABALHOS });
  encerrarArco(raiz, 'arco-ec5', { motivo: 'fila-vazia', detalhe: 'primeiro' });
  const segundo = encerrarArco(raiz, 'arco-ec5', { motivo: 'custo', detalhe: 'segundo' });
  assert.equal(segundo.encerramento?.motivo, 'fila-vazia');
  assert.equal(segundo.encerramento?.detalhe, 'primeiro');
  const linhas = fs.readFileSync(path.join(raiz, '.orkastery/noctum/arcos/arco-ec5/arco.jsonl'), 'utf8').trim().split('\n');
  assert.equal(linhas.filter(l => l.includes('"tipo":"encerrado"')).length, 1);
  proporEnvelope(raiz, pedidoV2('arco-ec5b', { trabalhos: TRABALHOS }));
  recusa(() => encerrarArco(raiz, 'arco-ec5b', { motivo: 'hora', detalhe: 'x' }), 'noctum.efeito.sem-autorizacao');
  recusa(() => encerrarArco(raiz, 'arco-ec5', { motivo: 'cansado' as never, detalhe: 'x' }), 'noctum.envelope.invalido');
}));

test('EC6: revogado vence encerrado na situação, nos dois sentidos', { skip: semKernel }, () => comRaiz('ec6', raiz => {
  const s1 = abrirArco(raiz, 'arco-ec6a', { trabalhos: TRABALHOS });
  revogarArco(raiz, 'arco-ec6a');
  const a = encerrarArco(raiz, 'arco-ec6a', { motivo: 'revogado', detalhe: 'o dono revogou' });
  assert.equal(a.situacao, 'revogado');
  assert.equal(a.encerramento?.motivo, 'revogado');
  recusa(() => conferirAntesDoEfeito(raiz, efeito('arco-ec6a', s1)), 'noctum.efeito.revogado');
  abrirArco(raiz, 'arco-ec6b', { trabalhos: TRABALHOS });
  encerrarArco(raiz, 'arco-ec6b', { motivo: 'fila-vazia', detalhe: 'cedo' });
  revogarArco(raiz, 'arco-ec6b');
  assert.equal(lerArco(raiz, 'arco-ec6b')!.situacao, 'revogado', 'a revogação do dono continua valendo depois do fechamento');
}));

test('EC7: um segundo encerrado emendado à mão no log do arco reprova a leitura', { skip: semKernel }, () => comRaiz('ec7', raiz => {
  abrirArco(raiz, 'arco-ec7', { trabalhos: TRABALHOS });
  encerrarArco(raiz, 'arco-ec7', { motivo: 'hora', detalhe: 'fim' });
  const file = path.join(raiz, '.orkastery/noctum/arcos/arco-ec7/arco.jsonl');
  const textos = fs.readFileSync(file, 'utf8').trim().split('\n');
  const ultima = JSON.parse(textos.at(-1)!) as { dados: { seq: number } };
  // Quem tem a chave local escreve uma linha válida (o limite dito da N1); o segundo encerramento é que a denuncia.
  const chave = createHmac('sha256', chaveLocal(raiz, false)).update('ork.noctum-arco/v1').digest();
  const dados = { contrato: 'ork.noctum-arco/v1', arco: 'arco-ec7', seq: ultima.dados.seq + 1, anterior: sha(textos.at(-1)!),
    em: new Date().toISOString(), evento: { tipo: 'encerrado', motivo: 'custo', detalhe: 'forjado' } };
  fs.appendFileSync(file, JSON.stringify({ dados, mac: createHmac('sha256', chave).update(JSON.stringify(dados)).digest('hex') }) + '\n');
  recusa(() => lerArco(raiz, 'arco-ec7'), 'noctum.estado.adulterado');
}));

type EventoSimulado = { tipo: string; n: number };

test('EC8: o registro da N6 encadeia e assina; MAC trocado, cadeia quebrada, outro domínio e permissão aberta reprovam', { skip: semKernel }, () => comRaiz('ec8', raiz => {
  const gravar = (dominio: 'fechamento' | 'relatorio', n: number) =>
    comRegistro<EventoSimulado, void>(raiz, 'arco-ec8', dominio, (_l, anexar) => { anexar({ tipo: 'simulado', n }, new Date().toISOString()); });
  gravar('fechamento', 1); gravar('fechamento', 2); gravar('fechamento', 3);
  const lidas = lerRegistro<EventoSimulado>(raiz, 'arco-ec8', 'fechamento');
  assert.deepEqual(lidas.map(l => [l.seq, l.evento.n]), [[1, 1], [2, 2], [3, 3]]);
  assert.equal(lidas[0].contrato, 'ork.noctum-fechamento/v1');
  const pasta = path.join(raiz, '.orkastery/noctum/arcos/arco-ec8');
  const file = path.join(pasta, 'fechamento.jsonl');
  const original = fs.readFileSync(file, 'utf8');
  // MAC trocado: um número do evento mudado sem a chave.
  fs.writeFileSync(file, original.replace('"n":2', '"n":9'), { mode: 0o600 });
  recusa(() => lerRegistro(raiz, 'arco-ec8', 'fechamento'), 'noctum.registro.adulterado');
  // Cadeia quebrada: a linha do meio apagada.
  const linhas = original.trim().split('\n');
  fs.writeFileSync(file, [linhas[0], linhas[2]].join('\n') + '\n', { mode: 0o600 });
  assert.match(recusa(() => lerRegistro(raiz, 'arco-ec8', 'fechamento'), 'noctum.registro.adulterado'), /fora da cadeia/);
  // Outro domínio: o log do fechamento copiado como o do relatório não confere com a subchave nem com o contrato dele.
  fs.writeFileSync(file, original, { mode: 0o600 });
  fs.writeFileSync(path.join(pasta, 'relatorio.jsonl'), original, { mode: 0o600 });
  recusa(() => lerRegistro(raiz, 'arco-ec8', 'relatorio'), 'noctum.registro.adulterado');
  // Permissão aberta: o log deixa de ser privado do núcleo.
  fs.chmodSync(file, 0o644);
  assert.match(recusa(() => lerRegistro(raiz, 'arco-ec8', 'fechamento'), 'noctum.registro.adulterado'), /privado/);
  fs.chmodSync(file, 0o600);
  assert.equal(lerRegistro(raiz, 'arco-ec8', 'fechamento').length, 3);
}));

test('EC9: a cauda rasgada não conta e sai na gravação seguinte; a trava ocupada recusa sem gravar', { skip: semKernel }, () => comRaiz('ec9', raiz => {
  const gravar = (n: number) =>
    comRegistro<EventoSimulado, void>(raiz, 'arco-ec9', 'relatorio', (_l, anexar) => { anexar({ tipo: 'simulado', n }, new Date().toISOString()); });
  gravar(1);
  const pasta = path.join(raiz, '.orkastery/noctum/arcos/arco-ec9');
  const file = path.join(pasta, 'relatorio.jsonl');
  fs.appendFileSync(file, '{"dados":{"contrato":"ork.noctum-relatorio/v1","arco":"arco-ec9","seq":2');
  assert.equal(lerRegistro(raiz, 'arco-ec9', 'relatorio').length, 1, 'a linha sem quebra está sendo gravada e não conta');
  gravar(2);
  const lidas = lerRegistro<EventoSimulado>(raiz, 'arco-ec9', 'relatorio');
  assert.deepEqual(lidas.map(l => l.evento.n), [1, 2]);
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));
  const fd = tentarTravaExclusiva(path.join(pasta, 'relatorio.lock'));
  assert.notEqual(fd, null);
  try {
    recusa(() => gravar(3), 'noctum.registro.ocupado');
  } finally { fs.closeSync(fd!); }
  assert.equal(lerRegistro(raiz, 'arco-ec9', 'relatorio').length, 2, 'a trava ocupada não gravou nada');
}));

test('EC10: autorizar de novo o arco encerrado ou expirado recusa tipado (o gateway responde), e o "já valia" vem de dentro do lock', { skip: semKernel }, () => comRaiz('ec10', raiz => {
  // Achados do CHECK: o hash que valia num arco encerrado voltava ok mudo (repetida), e o "já valia" vinha de uma leitura
  // fora do lock, que duas entregas simultâneas do mesmo ato liam iguais.
  const sha256 = abrirArco(raiz, 'arco-ec10', { trabalhos: TRABALHOS });
  const agora = new Date().toISOString();
  const repetida = responderAoArco(raiz, 'arco-ec10', assinadoPara('arco-ec10', textoDeAutorizacao(sha256), agora), agora);
  assert.deepEqual([repetida.situacao, repetida.repetida], ['vigente', true], 'o ato que já valia não ganha segunda confirmação');
  const info = { repetida: false };
  autorizarPeloIngresso(raiz, 'arco-ec10', sha256, assinadoPara('arco-ec10', textoDeAutorizacao(sha256), agora), agora, info);
  assert.equal(info.repetida, true, 'o sinal sai do caminho que a autorização tomou sob o lock');
  const fim = lerArco(raiz, 'arco-ec10')!.conteudo!.janela.fim;
  const depoisDoFim = new Date(Date.parse(fim) + 60_000).toISOString();
  assert.match(recusa(() => responderAoArco(raiz, 'arco-ec10', assinadoPara('arco-ec10', textoDeAutorizacao(sha256), depoisDoFim), depoisDoFim),
    'noctum.efeito.expirado'), /abra outro arco/);
  encerrarArco(raiz, 'arco-ec10', { motivo: 'fila-vazia', detalhe: 'simulado' });
  assert.match(recusa(() => responderAoArco(raiz, 'arco-ec10', assinadoPara('arco-ec10', textoDeAutorizacao(sha256), agora), agora),
    'noctum.efeito.encerrado'), /terminal; abra outro arco/);
  const r1 = responderAoArco(raiz, 'arco-ec10', assinadoPara('arco-ec10', 'revogar', agora), agora);
  const r2 = responderAoArco(raiz, 'arco-ec10', assinadoPara('arco-ec10', 'revogar', agora), agora);
  assert.deepEqual([r1.repetida, r2.repetida, r2.situacao], [false, true, 'revogado']);
}));

/**
 * RM-058 (N2, D9 da ork-rm058n2): a fila de recursos pesados. A disputa é entre processos de verdade, cada um
 * com a própria trava do kernel; a ordem do log de entradas e saídas (escrito com O_APPEND) é a ordem real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { avaliarVidaDoOcupante, comRecursoPesado, ENV_DONO_DA_FILA, ErroDaFilaPesada, kernelDisponivel,
  ocupantesDaFilaPesada, OcupanteDaFila } from '../src/fila-pesada';

const MODULO = path.resolve(__dirname, '../src/fila-pesada');
const semKernel = !kernelDisponivel();

function raizTemporaria(nome: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `ork-fila-pesada-${nome}-`)));
}

test('outro espaço de PIDs: batida válida prova o lease vivo sem enxergar o PID', () => {
  assert.deepEqual(avaliarVidaDoOcupante({ trava: 'desconhecida', batidaValida: true, mesmoHost: true,
    mesmoEspacoPids: false, processo: 'desconhecido' }), { vida: 'vivo', prova: 'batida' });
});

test('lease realmente órfão: trava livre é prova positiva de morte', () => {
  assert.deepEqual(avaliarVidaDoOcupante({ trava: 'livre', batidaValida: false, mesmoHost: true,
    mesmoEspacoPids: true, processo: 'ausente' }), { vida: 'morto', prova: 'trava-livre' });
});

test('lease indeterminado: PID invisível e batida vencida nunca viram órfão', () => {
  assert.deepEqual(avaliarVidaDoOcupante({ trava: 'desconhecida', batidaValida: false, mesmoHost: true,
    mesmoEspacoPids: false, processo: 'desconhecido' }), { vida: 'desconhecido', prova: 'indeterminada' });
});

/**
 * Um processo que pega a vez, marca a entrada no log, escreve o próprio id no artefato, espera, confere que
 * ninguém escreveu por cima e marca a saída. `segura` é o tempo dentro da vez, em ms; com `ate`, segura até esse
 * arquivo aparecer. Com `largada`, só pede a vez quando esse arquivo aparece: todos disputam juntos, e não na ordem
 * em que o sistema os criou.
 */
function disputante(raiz: string, id: string, opcoes: { artefato: string; slots: number; segura: number; log: string;
  esperarMs?: number; largada?: string; ate?: string }): ChildProcess {
  const script = `
    const fs = require('node:fs'), path = require('node:path');
    const { comRecursoPesado } = require(${JSON.stringify(MODULO)});
    const log = ${JSON.stringify(opcoes.log)}, id = ${JSON.stringify(id)}, artefato = ${JSON.stringify(opcoes.artefato)};
    const largada = ${JSON.stringify(opcoes.largada ?? null)}, ate = ${JSON.stringify(opcoes.ate ?? null)};
    const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const esperarArquivo = (arquivo) => { const fim = Date.now() + 60000; while (!fs.existsSync(arquivo) && Date.now() < fim) dormir(10); };
    fs.appendFileSync(log, 'C ' + id + '\\n');
    if (largada) esperarArquivo(largada);
    comRecursoPesado(${JSON.stringify(raiz)}, { artefato, operacao: 'teste', thread: id, slots: ${opcoes.slots},
      esperarMs: ${opcoes.esperarMs ?? 60000} }, () => {
      fs.appendFileSync(log, 'E ' + id + '\\n');
      fs.mkdirSync(artefato, { recursive: true });
      const alvo = path.join(artefato, 'compilado.txt');
      fs.writeFileSync(alvo, id);
      if (ate) esperarArquivo(ate); else dormir(${opcoes.segura});
      if (fs.readFileSync(alvo, 'utf8') !== id) fs.appendFileSync(log, 'X ' + id + '\\n');
      fs.appendFileSync(log, 'S ' + id + '\\n');
    });
  `;
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Quantas linhas do log começam por `tipo` agora. */
function contar(log: string, tipo: string): number {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith(`${tipo} `)).length : 0;
}

/** Espera todos os disputantes chegarem (linha `C`) e dá a largada de uma vez. */
async function largar(log: string, ids: string[], largada: string): Promise<void> {
  for (const id of ids) await esperarLinha(log, `C ${id}`);
  fs.writeFileSync(largada, 'ok');
}

/** Espera `n` entradas no log; com elas, dá ainda `folgaMs` para quem estivesse sobrando entrar também. */
async function esperarEntradas(log: string, n: number, folgaMs: number, prazoMs = 20000): Promise<number> {
  const fim = Date.now() + prazoMs;
  while (contar(log, 'E') < n) {
    if (Date.now() > fim) assert.fail(`só ${contar(log, 'E')} de ${n} entradas em ${prazoMs} ms`);
    await new Promise(r => setTimeout(r, 25));
  }
  await new Promise(r => setTimeout(r, folgaMs));
  return contar(log, 'E');
}

function terminar(filho: ChildProcess): Promise<number | null> {
  return new Promise(resolve => {
    if (filho.exitCode !== null || filho.signalCode !== null) { resolve(filho.exitCode); return; }
    filho.once('exit', (codigo) => resolve(codigo));
  });
}

async function esperarLinha(log: string, linha: string, prazoMs = 20000): Promise<void> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').split('\n').includes(linha)) return;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.fail(`a linha "${linha}" não apareceu no log em ${prazoMs} ms`);
}

/** O maior número de processos dentro da vez ao mesmo tempo, pela ordem do log, e quem escreveu por cima de quem. */
function lerLog(log: string): { maximo: number; entradas: string[]; corrompidos: string[] } {
  let dentro = 0, maximo = 0;
  const entradas: string[] = [], corrompidos: string[] = [];
  for (const l of fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    const [tipo, id] = l.split(' ');
    if (tipo === 'E') { dentro++; maximo = Math.max(maximo, dentro); entradas.push(id); }
    if (tipo === 'S') dentro--;
    if (tipo === 'X') corrompidos.push(id);
  }
  return { maximo, entradas, corrompidos };
}

test('P1: com um slot, dois processos no mesmo artefato nunca ficam dentro juntos nem escrevem por cima', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p1');
  try {
    const log = path.join(raiz, 'log'), artefato = path.join(raiz, 'wt');
    const largada = path.join(raiz, 'largada'), ate = path.join(raiz, 'solta');
    const ids = ['a', 'b', 'c'];
    const filhos = ids.map(id => disputante(raiz, id, { artefato, slots: 1, segura: 0, log, largada, ate }));
    await largar(log, ids, largada);
    // Com o primeiro dentro por quatro pausas da fila, ninguém mais entra.
    assert.equal(await esperarEntradas(log, 1, 2000), 1, 'com o primeiro dentro, os outros esperam');
    fs.writeFileSync(ate, 'ok');
    assert.deepEqual(await Promise.all(filhos.map(terminar)), [0, 0, 0]);
    const r = lerLog(log);
    assert.equal(r.entradas.length, 3);
    assert.equal(r.maximo, 1, 'nunca dois dentro');
    assert.deepEqual(r.corrompidos, [], 'ninguém escreveu no artefato de quem estava dentro');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('P2: com dois slots, quatro processos em artefatos diferentes nunca passam de dois juntos e usam os dois', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p2');
  try {
    const log = path.join(raiz, 'log');
    const largada = path.join(raiz, 'largada'), ate = path.join(raiz, 'solta');
    const ids = ['a', 'b', 'c', 'd'];
    const filhos = ids.map(id => disputante(raiz, id, { artefato: path.join(raiz, `wt-${id}`), slots: 2, segura: 0, log, largada, ate }));
    await largar(log, ids, largada);
    // Os dois slots ocupados até a soltura: o terceiro não entra, por mais pausas que passem.
    assert.equal(await esperarEntradas(log, 2, 2000), 2, 'dois dentro, e só dois');
    fs.writeFileSync(ate, 'ok');
    assert.deepEqual(await Promise.all(filhos.map(terminar)), [0, 0, 0, 0]);
    const r = lerLog(log);
    assert.equal(r.entradas.length, 4);
    assert.equal(r.maximo, 2, 'dois juntos, nunca três');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('P3: o mesmo artefato nunca tem dois escritores, mesmo com vagas livres', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p3');
  try {
    const log = path.join(raiz, 'log'), artefato = path.join(raiz, 'wt');
    // O mesmo diretório por dois caminhos (link) é o mesmo artefato.
    fs.mkdirSync(artefato);
    fs.symlinkSync(artefato, path.join(raiz, 'wt-link'));
    const largada = path.join(raiz, 'largada'), ate = path.join(raiz, 'solta');
    const ids = ['a', 'b', 'c'];
    const filhos = ids.map((id, i) => disputante(raiz, id, { artefato: i === 1 ? path.join(raiz, 'wt-link') : artefato,
      slots: 3, segura: 0, log, largada, ate }));
    await largar(log, ids, largada);
    // Três vagas livres e o mesmo artefato: quem chega depois espera mais que quatro pausas da fila.
    assert.equal(await esperarEntradas(log, 1, 2000), 1, 'o artefato tem um escritor só, mesmo com vagas livres');
    fs.writeFileSync(ate, 'ok');
    assert.deepEqual(await Promise.all(filhos.map(terminar)), [0, 0, 0]);
    const r = lerLog(log);
    assert.equal(r.maximo, 1);
    assert.deepEqual(r.corrompidos, []);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('P4: processo morto por SIGKILL solta a vaga e a senha, e quem espera entra', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p4');
  try {
    const log = path.join(raiz, 'log'), artefato = path.join(raiz, 'wt');
    const dono = disputante(raiz, 'dono', { artefato, slots: 1, segura: 60000, log });
    await esperarLinha(log, 'E dono');
    const espera = disputante(raiz, 'espera', { artefato, slots: 1, segura: 50, log });
    await esperarLinha(log, 'C espera');
    await new Promise(r => setTimeout(r, 600));
    assert.equal(fs.readFileSync(log, 'utf8').includes('E espera'), false, 'com o dono vivo, ninguém entra');
    dono.kill('SIGKILL');
    await terminar(dono);
    assert.equal(await terminar(espera), 0);
    assert.equal(lerLog(log).entradas.join(','), 'dono,espera');
    assert.deepEqual(ocupantesDaFilaPesada(raiz), [], 'nada ficou preso');
    const senhas = fs.readdirSync(path.join(raiz, '.orkastery', 'fila-pesada')).filter(n => n.startsWith('senha-'));
    assert.deepEqual(senhas, [], 'a senha de quem morreu não sobra');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('P5: quem chega antes passa antes', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p5');
  try {
    const log = path.join(raiz, 'log');
    const dono = disputante(raiz, 'dono', { artefato: path.join(raiz, 'wt-dono'), slots: 1, segura: 1500, log });
    await esperarLinha(log, 'E dono');
    const ordem = ['b1', 'b2', 'b3'];
    const filhos: ChildProcess[] = [];
    for (const id of ordem) {
      filhos.push(disputante(raiz, id, { artefato: path.join(raiz, `wt-${id}`), slots: 1, segura: 100, log }));
      await esperarLinha(log, `C ${id}`);
      await new Promise(r => setTimeout(r, 200));
    }
    assert.deepEqual(await Promise.all([dono, ...filhos].map(terminar)), [0, 0, 0, 0]);
    assert.deepEqual(lerLog(log).entradas, ['dono', ...ordem]);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('P6: dentro da vez, o mesmo processo reentra sem pedir vaga e sem travar', { skip: semKernel }, () => {
  const raiz = raizTemporaria('p6');
  try {
    const usos: string[] = [];
    comRecursoPesado(raiz, { artefato: raiz, operacao: 'fora', thread: null, slots: 1, esperarMs: 0 }, (uso) => {
      usos.push(uso.situacao);
      comRecursoPesado(raiz, { artefato: path.join(raiz, 'outro'), operacao: 'dentro', thread: null, slots: 1, esperarMs: 0 },
        (dentro) => { usos.push(dentro.situacao); });
      assert.equal(ocupantesDaFilaPesada(raiz)[0]?.operacao, 'fora');
    });
    assert.deepEqual(usos, ['adquirida', 'reentrada']);
    assert.deepEqual(ocupantesDaFilaPesada(raiz), []);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('P7: sem a vez no prazo, a recusa é tipada, diz quem ocupa e não roda nada', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p7');
  const log = path.join(raiz, 'log');
  const dono = disputante(raiz, 'ork-dona', { artefato: path.join(raiz, 'wt'), slots: 1, segura: 60000, log });
  try {
    await esperarLinha(log, 'E ork-dona');
    let rodou = false;
    const avisos: OcupanteDaFila[][] = [];
    let erro: unknown;
    try {
      comRecursoPesado(raiz, { artefato: path.join(raiz, 'wt-2'), operacao: 'verify', thread: 'ork-esperando', slots: 1, esperarMs: 1200,
        aoEsperar: (o) => avisos.push(o), comandoDeEsperar: 'ork verify ork-esperando --esperar 60' }, () => { rodou = true; });
    } catch (e) { erro = e; }
    assert.ok(erro instanceof ErroDaFilaPesada, String(erro));
    assert.equal(rodou, false);
    assert.equal(erro.recusa.motivo, 'fila-pesada.ocupada');
    assert.equal(erro.recusa.ocupantes.length, 1);
    assert.equal(erro.recusa.ocupantes[0].thread, 'ork-dona');
    assert.equal(erro.recusa.ocupantes[0].pid, dono.pid);
    assert.match(erro.recusa.texto, /Quem ocupa: teste da thread ork-dona/);
    assert.match(erro.recusa.texto, /ork verify ork-esperando --esperar 60/);
    assert.match(erro.recusa.texto, /concurrency\.max_parallel_heavy/);
    assert.equal(avisos.length, 1, 'avisa uma vez só');
    assert.equal(avisos[0][0].thread, 'ork-dona');
    const senhas = fs.readdirSync(path.join(raiz, '.orkastery', 'fila-pesada')).filter(n => n.startsWith('senha-'));
    assert.deepEqual(senhas, [], 'a recusa devolve a senha');
  } finally {
    dono.kill('SIGKILL');
    await terminar(dono);
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('P8: slots 0 desliga a fila: roda na hora mesmo com a vaga ocupada', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p8');
  const log = path.join(raiz, 'log');
  const dono = disputante(raiz, 'dono', { artefato: path.join(raiz, 'wt'), slots: 1, segura: 60000, log });
  try {
    await esperarLinha(log, 'E dono');
    let situacao = '';
    comRecursoPesado(raiz, { artefato: path.join(raiz, 'wt'), operacao: 'verify', thread: null, slots: 0, esperarMs: 0 },
      (uso) => { situacao = uso.situacao; });
    assert.equal(situacao, 'desligada');
  } finally {
    dono.kill('SIGKILL');
    await terminar(dono);
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('P9: a senha anterior viva segura a vez mesmo com vaga livre; a de processo morto não segura ninguém', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p9');
  const fila = path.join(raiz, '.orkastery', 'fila-pesada');
  fs.mkdirSync(fila, { recursive: true, mode: 0o700 });
  const anterior = path.join(fila, 'senha-000000000000001-0000000001-aaaaaaaa.lock');
  const pronto = path.join(raiz, 'pronto');
  // Um pedido que chegou antes e ainda espera: segura só a senha, com a trava do kernel.
  const quemChegouAntes = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const { tentarTravaExclusiva } = require(${JSON.stringify(MODULO)});
    if (tentarTravaExclusiva(${JSON.stringify(anterior)}) === null) process.exit(3);
    fs.writeFileSync(${JSON.stringify(pronto)}, 'ok');
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  try {
    const fim = Date.now() + 20000;
    while (!fs.existsSync(pronto) && Date.now() < fim) await new Promise(r => setTimeout(r, 25));
    assert.ok(fs.existsSync(pronto), 'o pedido anterior pegou a senha');
    let rodou = false, erro: unknown;
    try {
      comRecursoPesado(raiz, { artefato: path.join(raiz, 'wt'), operacao: 'verify', thread: null, slots: 2, esperarMs: 800 }, () => { rodou = true; });
    } catch (e) { erro = e; }
    assert.equal(rodou, false, 'com vaga livre, a vez ainda é de quem chegou antes');
    assert.ok(erro instanceof ErroDaFilaPesada, String(erro));
    assert.deepEqual(erro.recusa.ocupantes, []);
    assert.match(erro.recusa.texto, /a vez é de outro pedido que chegou antes e ainda espera/);
    quemChegouAntes.kill('SIGKILL');
    await terminar(quemChegouAntes);
    // Uma senha largada por processo morto, sem trava, também não segura nada.
    fs.writeFileSync(path.join(fila, 'senha-000000000000002-0000000002-bbbbbbbb.lock'), '');
    let situacao = '';
    comRecursoPesado(raiz, { artefato: path.join(raiz, 'wt'), operacao: 'verify', thread: null, slots: 2, esperarMs: 2000 },
      (uso) => { situacao = uso.situacao; });
    assert.equal(situacao, 'adquirida');
    assert.deepEqual(fs.readdirSync(fila).filter(n => n.startsWith('senha-')), [], 'as senhas mortas foram limpas');
  } finally {
    quemChegouAntes.kill('SIGKILL');
    await terminar(quemChegouAntes);
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

/** O instante de início do processo, como o núcleo o grava na marca (campo 22 do `/proc/<pid>/stat`). */
function inicioDe(pid: number): string {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

/**
 * Um pedido de vez avulso, rodado pelo shell como o comando de uma claim (o dono da vez fica avô dele, não pai),
 * com o ambiente dado. Devolve como entrou: `adquirida`, `reentrada` ou `recusada`.
 */
function pedidoAvulso(raiz: string, esperarMs: number, env: NodeJS.ProcessEnv = process.env): { situacao: string; levouMs: number } {
  const script = `
    const { comRecursoPesado } = require(${JSON.stringify(MODULO)});
    let situacao = 'nenhuma';
    try {
      comRecursoPesado(${JSON.stringify(raiz)}, { artefato: ${JSON.stringify(path.join(raiz, 'wt-filho'))}, operacao: 'aninhado',
        thread: 'ork-filho', slots: 1, esperarMs: ${esperarMs} }, (uso) => { situacao = uso.situacao; });
    } catch (e) { situacao = e && e.name === 'ErroDaFilaPesada' ? 'recusada' : 'erro: ' + (e && e.message); }
    process.stdout.write(situacao);
  `;
  const inicio = Date.now();
  const r = spawnSync('/bin/sh', ['-c', '"$0" -e "$1"; exit $?', process.execPath, script], { encoding: 'utf8', env, timeout: 30000 });
  return { situacao: r.stdout, levouMs: Date.now() - inicio };
}

test('P10: o comando que o dono da vez roda reentra pela marca; marca de vaga solta ou de quem não é ancestral não pula a fila', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p10');
  const log = path.join(raiz, 'log');
  let estranho: ChildProcess | null = null;
  try {
    const antes = process.env[ENV_DONO_DA_FILA];
    let marca = '';
    // O neto do dono (pelo shell, como uma claim) entra como reentrada, sem esperar a vaga do avô.
    comRecursoPesado(raiz, { artefato: path.join(raiz, 'wt'), operacao: 'verify', thread: 'ork-pai', slots: 1, esperarMs: 0 }, () => {
      marca = process.env[ENV_DONO_DA_FILA] ?? '';
      const r = pedidoAvulso(raiz, 5000);
      assert.equal(r.situacao, 'reentrada');
      assert.ok(r.levouMs < 4500, `levou ${r.levouMs} ms`);
    });
    assert.notEqual(marca, '');
    assert.equal(process.env[ENV_DONO_DA_FILA], antes, 'a marca sai do ambiente junto com a vez');
    // A marca de quem já soltou a vaga não vale: o pedido entra pela fila, como qualquer outro.
    assert.equal(pedidoAvulso(raiz, 5000, { ...process.env, [ENV_DONO_DA_FILA]: marca }).situacao, 'adquirida');
    // O arquivo da vaga com o nome e a posse do dono, mas sem a trava dele, também não vale.
    const vaga = path.join(raiz, '.orkastery', 'fila-pesada', 'vaga-0.lock');
    fs.writeFileSync(vaga, JSON.stringify({ pid: process.pid, posse: (JSON.parse(marca) as { posse: string }).posse }) + '\n');
    assert.equal(pedidoAvulso(raiz, 5000, { ...process.env, [ENV_DONO_DA_FILA]: marca }).situacao, 'adquirida');
    // A marca copiada de um dono vivo, que segura a vaga, mas não é ancestral de quem pede: espera e é recusado.
    estranho = disputante(raiz, 'estranho', { artefato: path.join(raiz, 'wt-estranho'), slots: 1, segura: 60000, log });
    await esperarLinha(log, 'E estranho');
    const forjada = JSON.stringify({ ...JSON.parse(marca) as object, pid: estranho.pid, inicio: inicioDe(estranho.pid!) });
    const r = pedidoAvulso(raiz, 1500, { ...process.env, [ENV_DONO_DA_FILA]: forjada });
    assert.equal(r.situacao, 'recusada');
    assert.ok(r.levouMs >= 1400, `levou ${r.levouMs} ms`);
  } finally {
    if (estranho) { estranho.kill('SIGKILL'); await terminar(estranho); }
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('P11: marca com outro início, outra raiz, posse de uma vez anterior ou vaga de outro dono não pula a fila', { skip: semKernel }, async () => {
  const raiz = raizTemporaria('p11');
  const log = path.join(raiz, 'log');
  let estranho: ChildProcess | null = null;
  try {
    const pedido = { artefato: path.join(raiz, 'wt'), operacao: 'verify', thread: 'ork-pai', slots: 1, esperarMs: 0 };
    let primeira = '';
    comRecursoPesado(raiz, pedido, () => { primeira = process.env[ENV_DONO_DA_FILA] ?? ''; });
    comRecursoPesado(raiz, pedido, () => {
      const marca = JSON.parse(process.env[ENV_DONO_DA_FILA] ?? '{}') as Record<string, unknown>;
      const com = (troca: Record<string, unknown>) => ({ ...process.env, [ENV_DONO_DA_FILA]: JSON.stringify({ ...marca, ...troca }) });
      assert.equal(pedidoAvulso(raiz, 3000, com({})).situacao, 'reentrada', 'a marca desta vez vale');
      // O pid é o deste processo, ancestral e vivo, mas o início é de outro: pid reusado não herda a vez.
      assert.equal(pedidoAvulso(raiz, 1000, com({ inicio: '1' })).situacao, 'recusada');
      // A marca de outra raiz de estado não vale aqui.
      assert.equal(pedidoAvulso(raiz, 1000, com({ raiz: `${raiz}-outra` })).situacao, 'recusada');
      // A marca guardada da primeira vez do mesmo dono: a vaga agora tem outra posse.
      assert.notEqual(JSON.parse(primeira).posse, marca.posse);
      assert.equal(pedidoAvulso(raiz, 1000, { ...process.env, [ENV_DONO_DA_FILA]: primeira }).situacao, 'recusada');
    });
    // A vaga de outro dono, com a posse copiada do arquivo dela e o pid de um ancestral vivo: o pid gravado não bate.
    estranho = disputante(raiz, 'estranho', { artefato: path.join(raiz, 'wt-estranho'), slots: 1, segura: 60000, log });
    await esperarLinha(log, 'E estranho');
    const gravado = JSON.parse(fs.readFileSync(path.join(raiz, '.orkastery', 'fila-pesada', 'vaga-0.lock'), 'utf8')) as { posse: string };
    const copiada = JSON.stringify({ ...JSON.parse(primeira) as object, pid: process.pid, inicio: inicioDe(process.pid), slot: 0,
      posse: gravado.posse });
    assert.equal(pedidoAvulso(raiz, 1000, { ...process.env, [ENV_DONO_DA_FILA]: copiada }).situacao, 'recusada');
  } finally {
    if (estranho) { estranho.kill('SIGKILL'); await terminar(estranho); }
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

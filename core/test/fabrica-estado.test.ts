/**
 * I-51 (RM-047, fatia 2): a fabrica vista de qualquer maquina.
 *
 * Duas "maquinas" sao dois clones do mesmo remoto bare, com identidades diferentes, como no teste
 * das reservas. Tudo e git de verdade: fetch, commit-tree e push sem forca. Nenhum teste toca o
 * remoto do Orkastery, e nenhum publica em segundo plano (`ORK_FABRICA_PUBLICAR=0` no apoio).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gravarNaBranch } from '../src/branch-de-estado';
import { BRANCH_DA_FABRICA, entregasNaBase, lerFabrica, publicarMaquina, resumoDasOutrasMaquinas, textoDaFabrica,
  textoDasOutrasMaquinas } from '../src/fabrica-estado';
import { publicarEmSegundoPlano } from '../src/fabrica-publicar';
import { fabricaCompartilhada, gravarConfigDaMaquina, lerConfigDaMaquina, nomeDaMaquina, pastaDoUsuario } from '../src/maquina';
import { definirFusoDoDono } from '../src/horario';
import { lerLedger, registrar } from '../src/ledger';
import { carregarManifesto, exigirManifesto } from '../src/manifest';
import { Pulse } from '../src/pulse';
import { gravarCadencia } from '../src/pulse-cadencia';
import { varrerPulse } from '../src/pulse-delivery';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { commitar, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const brt = (hhmm: string, dia = '2026-09-27') => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

function compartilhar(dir: string): void {
  fs.appendFileSync(path.join(dir, 'orkastery.yaml'), '\nfabrica:\n  compartilhada: true\n');
}

/** O projeto publicado no remoto e um segundo clone (a maquina B), com a fabrica compartilhada. */
function duasMaquinas(nome: string) {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'docs/roadmap/RM-001-primeiro.md', '# RM-001\n', 'roadmap: RM-001');
  compartilhar(p.dir);
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto do projeto'], p.dir);
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  const b = path.join(dirTemporario(`${nome}-b`), 'clone');
  exec('git', ['clone', '-q', p.remoto as string, b]);
  exec('git', ['config', 'user.email', 'b@orkastery.local'], b);
  exec('git', ['config', 'user.name', 'Builder B'], b);
  exec('git', ['config', 'commit.gpgsign', 'false'], b);
  return {
    a: p.dir, b, remoto: p.remoto as string,
    manifestoA: () => exigirManifesto(p.dir), manifestoB: () => exigirManifesto(b),
    limpar: () => { p.limpar(); fs.rmSync(path.dirname(b), { recursive: true, force: true }); },
  };
}

function ork(dir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
}

test('duas maquinas: cada uma publica o seu retrato e ve o da outra, com a verdade do git por cima', () => {
  const m = duasMaquinas('fabrica-duas');
  try {
    // A: uma thread #Classic parada no gate do GOAL, esperando o dono, e uma ja entregue na main.
    const { thread: parada } = novaThread(m.manifestoA(), { nome: 'contrato do grafo', modo: 'classic', roadmap: 'RM-001' });
    // O mesmo evento que o despacho grava quando o bloco termina numa pausa prevista pelo modo.
    registrar(dirThread(m.a, parada.id), parada.id, 'human_gate', { fase: 'GOAL', slug: parada.slug, sessionId: 'sessao-simulada',
      previstaSobre: 'objetivo', estado: 'prevista ao fim do bloco' });
    const { thread: pronta } = novaThread(m.manifestoA(), { nome: 'entrega pronta', modo: 'auto' });
    commitar(m.a, 'entregue.txt', 'ok\n', `ship(${pronta.id}): entrega pronta`);
    exec('git', ['push', '-q', 'origin', 'main'], m.a);
    assert.equal(entregasNaBase(m.a, 'main').has(pronta.id), true);

    const pa = publicarMaquina(m.manifestoA(), { maquina: 'pc-a' });
    assert.equal(pa.acao, 'publicou');
    assert.match(pa.commit ?? '', /^[a-f0-9]{40}$/);

    // B: uma thread #Auto andando.
    const { thread: andando } = novaThread(m.manifestoB(), { nome: 'reservas', modo: 'auto' });
    assert.equal(publicarMaquina(m.manifestoB(), { maquina: 'pc-b' }).acao, 'publicou');

    // A le as duas; a entregue nao conta como ativa e nao espera ninguem.
    const painel = lerFabrica(m.a);
    assert.equal(painel.atualizado, true);
    assert.deepEqual(painel.maquinas.map((x) => [x.maquina, x.por]), [['pc-a', 'Teste Orkastery'], ['pc-b', 'Builder B']]);
    const daA = painel.maquinas[0].threads;
    const esperando = daA.find((t) => t.id === parada.id)!;
    assert.equal(esperando.esperaVoce, true, JSON.stringify(esperando));
    assert.equal(esperando.roadmap, 'RM-001');
    assert.equal(esperando.modo, '#Classic');
    assert.equal(daA.find((t) => t.id === pronta.id)?.entregue, entregasNaBase(m.a, 'main').get(pronta.id));
    assert.equal(daA.find((t) => t.id === pronta.id)?.esperaVoce, false);

    const secao = textoDasOutrasMaquinas(painel, 'pc-a');
    assert.match(secao, /Outras maquinas \(ork\/fabrica-estado, lido agora\)/);
    assert.match(secao, new RegExp(`pc-b, Builder B, publicado .*: 1 thread\\(s\\) ativa\\(s\\)`));
    assert.match(secao, new RegExp(andando.id));
    assert.doesNotMatch(secao, new RegExp(parada.id), 'a propria maquina fica fora da secao das outras');
    assert.match(textoDaFabrica(painel, 'pc-a'), /pc-a \(esta maquina\).*1 entregue\(s\) sem MASTER/);

    // B ve quem espera o dono em A, e a pergunta curta; a entregue fica fora.
    const outras = resumoDasOutrasMaquinas(lerFabrica(m.b), 'pc-b');
    assert.equal(outras.length, 1);
    assert.equal(outras[0].maquina, 'pc-a');
    assert.equal(outras[0].ativas, 1);
    assert.deepEqual(outras[0].esperando.map((e) => [e.thread, e.fase]), [[parada.id, 'GOAL']]);

    // O painel legivel esta na branch; nada foi criado na arvore nem nas branches locais.
    const painelMd = exec('git', ['show', `origin/${BRANCH_DA_FABRICA}:FABRICA.md`], m.b).stdout;
    // RM-037 (rm037noite, defeito 4): a coluna Runtime entra antes do item; a thread sem despacho diz isso.
    assert.match(painelMd, /\| pc-a \| .* \| #Classic \| GOAL \| sem despacho \| RM-001 \| sim: /);
    assert.equal(exec('git', ['branch', '--list', BRANCH_DA_FABRICA], m.a).stdout.trim(), '');
    assert.doesNotMatch(exec('git', ['status', '--porcelain', '--', 'maquinas', 'FABRICA.md'], m.a).stdout, /\S/);
  } finally { m.limpar(); }
});

test('retrato igual nao vai ao remoto; forcar e a pulsacao de uma hora publicam de novo', () => {
  const m = duasMaquinas('fabrica-marca');
  try {
    novaThread(m.manifestoA(), { nome: 'qualquer', modo: 'auto' });
    const agora = new Date().toISOString();
    assert.equal(publicarMaquina(m.manifestoA(), { maquina: 'pc-a', agora }).acao, 'publicou');
    const igual = publicarMaquina(m.manifestoA(), { maquina: 'pc-a', agora });
    assert.equal(igual.acao, 'sem-mudanca');
    assert.equal(igual.tentativas, 0, 'retrato igual nem busca o remoto');
    assert.equal(publicarMaquina(m.manifestoA(), { maquina: 'pc-a', agora, forcar: true }).acao, 'publicou');
    const depois = new Date(Date.parse(agora) + 61 * 60 * 1000).toISOString();
    assert.equal(publicarMaquina(m.manifestoA(), { maquina: 'pc-a', agora: depois }).acao, 'publicou', 'sinal de vida de hora em hora');
    // Thread nova muda o retrato: publica na hora.
    novaThread(m.manifestoA(), { nome: 'outra', modo: 'auto' });
    assert.equal(publicarMaquina(m.manifestoA(), { maquina: 'pc-a', agora: depois }).acao, 'publicou');
  } finally { m.limpar(); }
});

test('a branch de estado nunca forca: gravar em cima de ponta velha volta false', () => {
  const m = duasMaquinas('fabrica-corrida');
  try {
    const primeiro = gravarNaBranch(m.a, 'origin', 'ork/teste-estado', null, [{ caminho: 'x.json', conteudo: '{}\n' }], 'um', 'teste');
    assert.match(String(primeiro), /^[a-f0-9]{40}$/);
    // B ainda acha que a branch nao existe: o push dele e recusado, nunca forcado.
    assert.equal(gravarNaBranch(m.b, 'origin', 'ork/teste-estado', null, [{ caminho: 'y.json', conteudo: '{}\n' }], 'dois', 'teste'), false);
    assert.equal(exec('git', ['ls-remote', m.remoto, 'refs/heads/ork/teste-estado'], m.b).stdout.split('\t')[0], primeiro);
  } finally { m.limpar(); }
});

test('thread nova guarda a maquina e o item do roadmap; a fabrica vem desligada no projeto e na maquina', () => {
  const p = projetoTemporario('fabrica-thread', true);
  const antes = process.env.ORK_MAQUINA;
  try {
    assert.deepEqual(p.carregado.manifesto.fabrica, { compartilhada: false, remoto: 'origin' });
    assert.equal(fabricaCompartilhada(p.carregado.manifesto), false);
    assert.equal(publicarEmSegundoPlano(p.dir), false, 'desligada, nada sai sozinho');

    process.env.ORK_MAQUINA = 'pc-x';
    const { thread } = novaThread(p.carregado, { nome: 'com item', modo: 'auto', roadmap: 'RM-001' });
    assert.equal(thread.maquina, 'pc-x');
    assert.equal(lerThread(p.dir, thread.id).roadmap, 'RM-001');
    const criada = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'thread_created')!;
    assert.equal(criada.maquina, 'pc-x');

    compartilhar(p.dir);
    const ligado = carregarManifesto(p.dir)!;
    assert.deepEqual(ligado.manifesto.fabrica, { compartilhada: true, remoto: 'origin' });
    // RM-047 (P5): o manifesto pede a fabrica, mas quem liga a publicacao e a maquina.
    assert.equal(fabricaCompartilhada(ligado.manifesto), false, 'o manifesto do repositorio nao liga a maquina');
    assert.equal(process.env.ORK_FABRICA_PUBLICAR, '0');
    assert.equal(publicarEmSegundoPlano(p.dir), false, 'ORK_FABRICA_PUBLICAR=0 vence tudo');
  } finally {
    if (antes === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes;
    p.limpar();
  }
});

test('a adesao e o nome sao da maquina: arquivo do usuario, com a variavel de ambiente por cima', () => {
  const antes = { maquina: process.env.ORK_MAQUINA, comp: process.env.ORK_FABRICA_COMPARTILHADA };
  delete process.env.ORK_MAQUINA; delete process.env.ORK_FABRICA_COMPARTILHADA;
  try {
    assert.match(pastaDoUsuario(), /ork-usuario-/, 'os testes nunca tocam o ~/.orkastery de quem roda');
    const semFabrica = { fabrica: { compartilhada: false } };
    gravarConfigDaMaquina({ nome: 'pc-casa', fabricaCompartilhada: true });
    assert.equal(nomeDaMaquina(), 'pc-casa');
    assert.equal(fabricaCompartilhada(semFabrica), true, 'a maquina entrou, mesmo com o projeto desligado');
    process.env.ORK_MAQUINA = 'pc-shell';
    assert.equal(nomeDaMaquina(), 'pc-shell', 'a variavel vence o arquivo');
    process.env.ORK_FABRICA_COMPARTILHADA = '0';
    assert.equal(fabricaCompartilhada({ fabrica: { compartilhada: true } }), false, '0 desliga tudo');
    delete process.env.ORK_FABRICA_COMPARTILHADA;
    gravarConfigDaMaquina({ fabricaCompartilhada: false });
    assert.deepEqual([lerConfigDaMaquina()?.nome, lerConfigDaMaquina()?.fabricaCompartilhada], ['pc-casa', false], 'sair guarda o nome');
    assert.throws(() => gravarConfigDaMaquina({ nome: 'nome com espaco' }), /nome de maquina invalido/);
  } finally {
    fs.rmSync(path.join(pastaDoUsuario(), 'maquina.json'), { force: true });
    if (antes.maquina === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes.maquina;
    if (antes.comp === undefined) delete process.env.ORK_FABRICA_COMPARTILHADA; else process.env.ORK_FABRICA_COMPARTILHADA = antes.comp;
  }
});

test('CLI: fabrica entrar grava a maquina e publica; fabrica sair tira o retrato da branch', () => {
  const m = duasMaquinas('fabrica-entrar');
  const usuarioB = dirTemporario('fabrica-entrar-usuario-b');
  try {
    // A maquina B tem o proprio ~/.orkastery; o projeto clonado vem com a fabrica desligada.
    fs.writeFileSync(path.join(m.b, 'orkastery.yaml'), fs.readFileSync(path.join(m.b, 'orkastery.yaml'), 'utf8')
      .replace('\nfabrica:\n  compartilhada: true\n', '\n'));
    const env = { ORK_USUARIO_DIR: usuarioB, ORK_MAQUINA: '' };
    const entrou = ork(m.b, ['fabrica', 'entrar', '--maquina', 'pc-b'], env);
    assert.equal(entrou.status, 0, entrou.stderr);
    assert.match(entrou.stdout, /esta maquina entrou como pc-b/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(usuarioB, 'maquina.json'), 'utf8')).fabricaCompartilhada, true);
    assert.deepEqual(lerFabrica(m.a).maquinas.map((x) => x.maquina), ['pc-b']);

    const saiu = ork(m.b, ['fabrica', 'sair'], env);
    assert.equal(saiu.status, 0, saiu.stderr);
    assert.match(saiu.stdout, /pc-b saiu; nada mais e publicado daqui\. Retrato removido/);
    assert.deepEqual(lerFabrica(m.a).maquinas, []);
    assert.equal(JSON.parse(fs.readFileSync(path.join(usuarioB, 'maquina.json'), 'utf8')).fabricaCompartilhada, false);
  } finally { m.limpar(); fs.rmSync(usuarioB, { recursive: true, force: true }); }
});

test('CLI: thread new --roadmap grava o item, fabrica publicar e board mostram as outras maquinas', () => {
  const m = duasMaquinas('fabrica-cli');
  try {
    const nova = ork(m.b, ['thread', 'new', 'grafo', '--modo', 'auto', '--roadmap', 'rm-001'], { ORK_MAQUINA: 'pc-b' });
    assert.equal(nova.status, 0, nova.stderr);
    const id = /estado: \.orkastery\/threads\/([^/]+)\/thread\.json/.exec(nova.stdout)?.[1] ?? '';
    assert.equal(lerThread(m.b, id).roadmap, 'RM-001');

    const pub = ork(m.b, ['fabrica', 'publicar'], { ORK_MAQUINA: 'pc-b' });
    assert.equal(pub.status, 0, pub.stderr);
    assert.match(pub.stdout, /Fabrica: pc-b publicou 1 thread\(s\) em ork\/fabrica-estado/);

    // RM-047 (P5): a maquina A le as outras porque entrou na fabrica, nao porque o manifesto pede.
    const board = ork(m.a, ['board'], { ORK_MAQUINA: 'pc-a', ORK_FABRICA_COMPARTILHADA: '1' });
    assert.equal(board.status, 0, board.stderr);
    assert.match(board.stdout, /Outras maquinas \(ork\/fabrica-estado, lido agora\):/);
    assert.match(board.stdout, new RegExp(`${id}\\s+#Auto\\s+GOAL\\s+-\\s+RM-001`));
    const offline = ork(m.a, ['board', '--sem-remoto'], { ORK_MAQUINA: 'pc-a', ORK_FABRICA_COMPARTILHADA: '1' });
    assert.match(offline.stdout, /ultima copia local/);

    const json = JSON.parse(ork(m.a, ['fabrica', '--json'], { ORK_MAQUINA: 'pc-a' }).stdout);
    assert.deepEqual(json.maquinas.map((x: { maquina: string }) => x.maquina), ['pc-b']);
  } finally { m.limpar(); }
});

test('o resumo do pulse mostra as outras maquinas, e quem espera o dono la sai na hora', () => {
  const p = projetoTemporario('fabrica-pulse');
  definirFusoDoDono('America/Sao_Paulo');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    gravarCadencia(p.dir, '#OrkPulseOn', { por: 'telegram:42', canal: 'hermes', em: brt('08:00') }, monitor);
    const pulseVazio = (quando: string): Pulse => ({ contrato: 'ork.pulse/v1', consultadoEm: quando, runtime: { ok: true, detalhe: '' },
      precisaDeHumanoAgora: [], acoesAutomaticas: [], resumo: { humanos: 0, automaticas: 0, scores: 0, fasesOrfas: 0 } });
    let esperando = [{ thread: 'ork-i99grafo', fase: 'GOAL', pergunta: 'objetivo', desdeEm: brt('08:40') }];
    const mensagens: string[] = [];
    const bater = (quando: string) => varrerPulse({ raiz: p.dir, quando, comCadencia: true, consultar: () => pulseVazio(quando),
      outrasMaquinas: () => [{ maquina: 'pc-casa', publicadoEm: brt('08:50'), ativas: 2, esperando }],
      enviar: (msg) => { mensagens.push(msg); return true; } });

    // 09:05: nada aqui, mas o dono e esperado em outra maquina: sai na hora, sem codigo de resposta.
    assert.equal(bater(brt('09:05')).enviadas, 1);
    assert.match(mensagens[0], /🖥️ Em outras máquinas:/);
    assert.match(mensagens[0], /pc-casa: 2 threads ativas; esperando você em 1 \(responda lá\)/);
    assert.match(mensagens[0], /• ork-i99grafo GOAL: objetivo/);
    assert.match(mensagens[0], /Nada aqui pede resposta sua por este canal agora\./);

    // 09:20: a mesma espera nao repete.
    assert.equal(bater(brt('09:20')).detalhe, 'sem novidade');

    // 09:35: outra thread passou a esperar la: sai na hora, mesmo no meio da janela de 2h.
    esperando = [...esperando, { thread: 'ork-i98docs', fase: 'PLAN', pergunta: 'plano', desdeEm: brt('09:30') }];
    assert.equal(bater(brt('09:35')).enviadas, 1);
    assert.match(mensagens[1], /esperando você em 2 \(responda lá\)/);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

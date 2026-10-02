/**
 * RM-037 (fatia 4, item 2): o `ork roadmap status` diz a verdade.
 *
 * As 22:21 de 01/10 ele disse "O que precisa de voce: Nada agora" e "sigo ork-rm031kg4incr na fase
 * GOAL", com a thread num PR de check vermelho e outras duas esperando merge; e a outra maquina da
 * fabrica estava sem retrato havia 19 h, o que so o `ork network roadmap` mostrava. Aqui o "O que eu
 * faco em seguida" diz o estado real da entrega (do git local e do ultimo retrato de PRs do pulse), e
 * uma linha avisa a maquina sem batida pela copia local de `ork/fabrica-estado`. Nada de rede: um `gh`
 * falso no PATH prova que ninguem o chama. Projeto, maquinas, threads e PRs SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { exec } from '../src/util';
import { definirFusoDoDono } from '../src/horario';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { CONTRATO_PRS, gravarRetratoDePrs, PrDaForja } from '../src/parado-no-condutor';
import { retratoDaMaquina } from '../src/fabrica-estado';
import { tomarConducao } from '../src/conducao';
import { main } from '../src/index';

const AGORA = '2026-10-02T01:21:00.000Z'; // 22:21 de 01/10 em Brasilia
const FIM = '2026-10-01T07:28:00.000Z';   // 04:28
const SHA_DO_SENSOR = 'c'.repeat(64);
const git = (dir: string, ...args: string[]) => {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
type Projeto = ReturnType<typeof projetoTemporario>;

function item(dir: string, id: string, thread: string): void {
  const fm = ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "Item ${id} simulado"`, 'categoria: melhoria', 'pai: null', 'features: []',
    'owner: Dono', 'atualizado_em: 2026-09-28T10:00:00-03:00', 'estado:', '  ciclo: Em desenvolvimento', '  documentacao: Rascunho',
    '  codigo: Não iniciado', '  testes: Não iniciados', '  deploy: Não implantado', '  exposicao: Flag desligada', '  habilitacao: Pendente',
    'evidencias:', '  codigo:', '    commit: null', '    pr: null', 'sdlc:', `  thread: ${thread}`, '---', '', `# ${id}`, ''].join('\n');
  fs.mkdirSync(path.join(dir, 'docs', 'roadmap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'roadmap', `${id}-simulado.md`), fm);
}

/** Thread #Auto com produto; publicada quando pedido; com o fim de turno do observador quando pedido. */
function thread(p: Projeto, nome: string, n: number, opcoes: { produto?: boolean; publicar?: boolean; turno?: boolean; pausaAoFim?: boolean } = {}) {
  const { thread: t } = novaThread(p.carregado, { nome, modo: 'auto' });
  const branch = `ork/${t.slug}`, dir = dirThread(p.dir, t.id);
  if (opcoes.produto !== false) {
    git(p.dir, 'checkout', '-q', '-b', branch);
    fs.writeFileSync(path.join(p.dir, `${t.slug}.txt`), 'produto SIMULADO\n');
    git(p.dir, 'add', '--', `${t.slug}.txt`);
    git(p.dir, 'commit', '-q', '-m', `produto de ${t.slug}`);
    git(p.dir, 'checkout', '-q', 'main');
    if (opcoes.publicar) git(p.dir, 'push', '-q', 'origin', branch);
  }
  if (opcoes.turno !== false && opcoes.produto !== false) {
    const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, despachoEm = '2026-10-01T05:06:17.008Z';
    registrar(dir, t.id, 'phase_dispatch', { ts: '2026-10-01T05:06:17.000Z', fase: 'GOAL', modo: 'auto', bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER',
      pausaAoFim: opcoes.pausaAoFim ?? false, runtime: 'claude-bg', sessionId });
    registrar(dir, t.id, 'runtime_stop', { ts: '2026-10-01T07:27:48.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg', despachoEm,
      fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
    const comum = { ts: FIM, fase: 'GOAL', sessionId, despachoEm, classificacao: 'gate_blocked', motivo: 'human.pending', runtime: 'claude-bg',
      fonte: 'Stop correlacionado e sessão viva à espera humana (blocked); SIMULADO; o humano decide', estadoNativo: 'blocked',
      statusNativo: 'idle', ok: false, estado: 'bloqueada', stop: { ts: '2026-10-01T07:27:48.000Z', sensorEventId: SHA_DO_SENSOR },
      provaOrk: { ok: true, fonte: 'SIMULADO' }, gate: 'phase.dispatch', origem: 'sessions.watch' };
    registrar(dir, t.id, 'gate_blocked', comum);
    registrar(dir, t.id, 'phase_result', comum);
  }
  const th = lerThread(p.dir, t.id);
  return { t: th, branch, dir, head: opcoes.produto === false ? '' : git(p.dir, 'rev-parse', branch) };
}

/** A copia local de `ork/fabrica-estado`, como o fetch do pulse a deixa, com retratos SIMULADOS. */
function fabricaLocal(p: Projeto, retratos: { maquina: string; publicadoEm: string }[]): void {
  const arvore = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-fabrica-')));
  try {
    git(arvore, 'init', '-q', '-b', 'ork/fabrica-estado');
    git(arvore, 'config', 'user.email', 'teste@exemplo.invalid');
    git(arvore, 'config', 'user.name', 'Teste');
    fs.mkdirSync(path.join(arvore, 'maquinas'));
    for (const r of retratos) {
      fs.writeFileSync(path.join(arvore, 'maquinas', `${r.maquina}.json`), JSON.stringify({ contrato: 'ork.fabrica-maquina/v1', maquina: r.maquina,
        por: 'Dono', projeto: 'orkastery', versaoOrk: '0.5.0', publicadoEm: r.publicadoEm, threads: [] }, null, 2) + '\n');
    }
    git(arvore, 'add', '--', 'maquinas');
    git(arvore, 'commit', '-q', '-m', 'fabrica: retratos SIMULADOS');
    git(p.dir, 'fetch', '-q', arvore, '+refs/heads/ork/fabrica-estado:refs/remotes/origin/ork/fabrica-estado');
  } finally { fs.rmSync(arvore, { recursive: true, force: true }); }
}

function ambiente(compartilhada: '1' | '0') {
  const antes = { maquina: process.env.ORK_MAQUINA, compartilhada: process.env.ORK_FABRICA_COMPARTILHADA };
  process.env.ORK_MAQUINA = 'pc-a';
  process.env.ORK_FABRICA_COMPARTILHADA = compartilhada;
  definirFusoDoDono('America/Sao_Paulo');
  return () => {
    for (const [nome, valor] of [['ORK_MAQUINA', antes.maquina], ['ORK_FABRICA_COMPARTILHADA', antes.compartilhada]] as const) {
      if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
    }
    definirFusoDoDono(undefined);
  };
}

const pr = (numero: number, branch: string, head: string, checks: PrDaForja['checks']): PrDaForja => ({ numero, branch, head, estado: 'aberto',
  rascunho: false, url: `https://github.com/exemplo/simulado/pull/${numero}`, criadoEm: '2026-10-01T22:00:00.000Z', mescladoEm: null, checks });

function cenario(nome: string) {
  const p = projetoTemporario(nome, true);
  const vermelho = thread(p, 'pr vermelho', 1, { publicar: true });
  const verde = thread(p, 'pr verde recente', 2, { publicar: true });
  const semPr = thread(p, 'publicada sem pr', 3, { publicar: true });
  const anda = thread(p, 'so a fase', 4, { produto: false });
  item(p.dir, 'RM-031', vermelho.t.id);
  item(p.dir, 'RM-037', verde.t.id);
  item(p.dir, 'RM-049', semPr.t.id);
  item(p.dir, 'RM-005', anda.t.id);
  // O remoto da fixture e um repositorio local; o retrato de PRs vale do GitHub SIMULADO dele, depois dos pushes.
  git(p.dir, 'remote', 'set-url', 'origin', 'https://github.com/exemplo/simulado.git');
  return { p, vermelho, verde, semPr, anda };
}

function retrato(c: ReturnType<typeof cenario>, lidoEm = '2026-10-02T01:15:00.000Z') {
  return { contrato: CONTRATO_PRS, lidoEm, repositorio: 'exemplo/simulado', base: 'main', parcial: false, prs: [
    pr(40, c.vermelho.branch, c.vermelho.head, [{ nome: 'ork-verify', situacao: 'vermelho', concluidoEm: '2026-10-01T22:07:15.000Z' },
      { nome: 'documentacao', situacao: 'verde', concluidoEm: '2026-10-01T22:00:23.000Z' }]),
    pr(39, c.verde.branch, c.verde.head, [{ nome: 'ork-verify', situacao: 'verde', concluidoEm: '2026-10-02T01:11:00.000Z' }]),
  ] };
}

test('o que vem a seguir diz o estado real: parado no condutor, PR lido do retrato e a fase so quando nao ha entrega', () => {
  const restaurar = ambiente('1');
  const c = cenario('fatia4-status');
  try {
    gravarRetratoDePrs(c.p.dir, retrato(c));
    fabricaLocal(c.p, [{ maquina: 'pc-b', publicadoEm: '2026-10-01T06:21:00.000Z' }, { maquina: 'pc-c', publicadoEm: '2026-10-02T00:21:00.000Z' },
      { maquina: 'pc-a', publicadoEm: '2026-10-02T01:15:00.000Z' }]);
    const status = montarStatusDoRoadmap(c.p.dir, { quando: AGORA, projeto: 'orkastery' });
    const linhas = textoDoStatusDoRoadmap(status).split('\n');
    const seguir = linhas.indexOf('O que eu faço em seguida'), precisa = linhas.indexOf('O que precisa de você');
    assert.equal(linhas[precisa + 1], '• Nada agora.', 'o fim de turno sem pergunta nao e do dono');
    const fecho = linhas.slice(seguir + 1);
    assert.ok(fecho.includes(`• RM-031: ${c.vermelho.t.id} parado no condutor desde 19:07: corrigir o check ork-verify vermelho do PR #40 ` +
      'e despachar a correção (PR lido às 22:15).'), fecho.join('\n'));
    assert.ok(fecho.includes(`• RM-037: ${c.verde.t.id} na fase GOAL, PR #39 com os checks verdes, esperando o merge (PR lido às 22:15).`), fecho.join('\n'));
    assert.ok(fecho.includes(`• RM-049: ${c.semPr.t.id} parado no condutor desde 04:27: abrir o PR da branch ${c.semPr.branch} (PR lido às 22:15).`),
      fecho.join('\n'));
    assert.ok(fecho.includes(`• RM-005: sigo ${c.anda.t.id} na fase GOAL.`), fecho.join('\n'));
    // A batida: so a outra maquina velha, numa linha; esta maquina (que publicou ha pouco) e a recente ficam de fora.
    assert.ok(linhas.includes('Fábrica: pc-b sem batida há 19h00 (último retrato 01/10 03:21), pela cópia local de ork/fabrica-estado.'), linhas.join('\n'));
    assert.equal(linhas.filter(l => l.startsWith('Fábrica:')).length, 1);
    // O JSON leva o mesmo.
    assert.equal(status.fabrica?.semBatida.map(m => m.maquina).join(), 'pc-b');
    assert.equal(status.emSeguida.find(x => x.item === 'RM-031')?.entrega?.parado?.desdeEm, '2026-10-01T22:07:15.000Z');
  } finally { c.p.limpar(); restaurar(); }
});

test('sem retrato de PRs e sem copia da fabrica: "nao lido", nunca "sem PR" nem "nenhuma maquina"', () => {
  const restaurar = ambiente('1');
  const c = cenario('fatia4-status-sem-retrato');
  try {
    const linhas = textoDoStatusDoRoadmap(montarStatusDoRoadmap(c.p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
    assert.ok(linhas.includes('Fábrica: não lido (esta máquina não tem cópia local de ork/fabrica-estado).'), linhas.join('\n'));
    // O fim de turno sem pergunta volta como linha do condutor, com o PR dito como nao lido.
    assert.ok(linhas.includes(`• RM-049: ${c.semPr.t.id} parado no condutor desde 04:27: conferir o PR da branch ${c.semPr.branch} ` +
      '(PR não lido) e seguir.'), linhas.join('\n'));
    assert.ok(!linhas.some(l => /abrir o PR/.test(l)), 'sem leitura nao se afirma "sem PR"');
    // Retrato velho (mais de uma hora) tambem e "nao lido".
    gravarRetratoDePrs(c.p.dir, retrato(c, '2026-10-01T23:00:00.000Z'));
    const velho = textoDoStatusDoRoadmap(montarStatusDoRoadmap(c.p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
    assert.ok(velho.some(l => l.startsWith(`• RM-031: ${c.vermelho.t.id} parado no condutor`) && l.includes('(PR não lido)')), velho.join('\n'));
  } finally { c.p.limpar(); restaurar(); }
});

test('fabrica nao compartilhada: nenhuma linha de batida', () => {
  const restaurar = ambiente('0');
  const c = cenario('fatia4-status-sozinha');
  try {
    const status = montarStatusDoRoadmap(c.p.dir, { quando: AGORA, projeto: 'orkastery' });
    assert.equal(status.fabrica, undefined);
    assert.ok(!textoDoStatusDoRoadmap(status).split('\n').some(l => l.startsWith('Fábrica:')));
  } finally { c.p.limpar(); restaurar(); }
});

test('leitura pura e sem rede: o CLI nao chama o gh e nao muda o ledger', () => {
  const restaurar = ambiente('1');
  const c = cenario('fatia4-status-sem-rede');
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-gh-falso-')));
  const marca = path.join(bin, 'chamado.txt');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho chamado >> '${marca}'\nexit 1\n`, { mode: 0o755 });
  const caminho = process.env.PATH, cwd = process.cwd(), log = console.log;
  try {
    // O CLI le no relogio de verdade: o retrato e de agora.
    gravarRetratoDePrs(c.p.dir, retrato(c, new Date().toISOString()));
    const antes = [c.vermelho, c.verde, c.semPr].map(x => fs.readFileSync(path.join(x.dir, 'ledger.jsonl'), 'utf8'));
    process.env.PATH = `${bin}${path.delimiter}${caminho ?? ''}`;
    process.chdir(c.p.dir);
    let saida = ''; console.log = (s: unknown) => { saida += String(s) + '\n'; };
    assert.equal(main(['roadmap', 'status']), 0);
    console.log = log;
    assert.match(saida, /parado no condutor desde .*: corrigir o check ork-verify vermelho do PR #40/);
    assert.equal(fs.existsSync(marca), false, 'o status nao chamou o gh');
    assert.deepEqual([c.vermelho, c.verde, c.semPr].map(x => fs.readFileSync(path.join(x.dir, 'ledger.jsonl'), 'utf8')), antes);
  } finally {
    console.log = log; process.chdir(cwd); process.env.PATH = caminho;
    fs.rmSync(bin, { recursive: true, force: true }); c.p.limpar(); restaurar();
  }
});

test('o retrato da maquina nao marca "espera voce" no que e do condutor; a pausa prevista continua marcando', () => {
  const restaurar = ambiente('1');
  const p = projetoTemporario('fatia4-status-retrato', true);
  try {
    const doCondutor = thread(p, 'fim de turno', 5);
    const doDono = thread(p, 'pausa prevista', 6, { pausaAoFim: true });
    const retratoDaPc = retratoDaMaquina(p.carregado, { agora: AGORA, maquina: 'pc-a' });
    assert.equal(retratoDaPc.threads.find(t => t.id === doCondutor.t.id)?.esperaVoce, false);
    assert.equal(retratoDaPc.threads.find(t => t.id === doDono.t.id)?.esperaVoce, true);
    // A thread fechada some do retrato como antes.
    const t = lerThread(p.dir, doDono.t.id); t.status = 'fechada'; gravarThread(p.dir, t);
    assert.equal(retratoDaMaquina(p.carregado, { agora: AGORA, maquina: 'pc-a' }).threads.some(x => x.id === doDono.t.id), false);
  } finally { p.limpar(); restaurar(); }
});

test('thread conduzida agora: o "sigo" continua, com o estado da entrega ao lado', () => {
  const restaurar = ambiente('0');
  const p = projetoTemporario('fatia4-status-conduzida', true);
  try {
    const a = thread(p, 'conduzida com commit', 7, { turno: false });
    item(p.dir, 'RM-031', a.t.id);
    const conducao = tomarConducao(p.dir, a.t.id, { canal: 'cli', operacao: 'verify', prazoMs: 60_000 });
    assert.equal(conducao.ok, true);
    try {
      const linhas = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
      assert.ok(linhas.includes(`• RM-031: sigo ${a.t.id} na fase GOAL; branch com commits sem push.`), linhas.join('\n'));
    } finally { if (conducao.ok) conducao.liberar(); }
  } finally { p.limpar(); restaurar(); }
});

test('a copia local da fabrica velha ou ilegivel nao acusa ninguem: a linha diz isso', () => {
  const restaurar = ambiente('1');
  const p = projetoTemporario('fatia4-status-copia', true);
  try {
    fabricaLocal(p, [{ maquina: 'pc-b', publicadoEm: '2026-10-01T06:21:00.000Z' }, { maquina: 'pc-a', publicadoEm: '2026-09-30T00:00:00.000Z' }]);
    const velha = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
    assert.ok(velha.includes('Fábrica: a cópia local de ork/fabrica-estado está velha (esta máquina publicou nela por último em 29/09 21:00); ' +
      'não dá para dizer quem está sem batida.'), velha.join('\n'));
    assert.ok(!velha.some(l => /pc-b sem batida/.test(l)));
    fabricaLocal(p, [{ maquina: 'pc-b', publicadoEm: '2026-10-01T06:21:00.000Z' }]);
    const sem = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
    assert.ok(sem.some(l => l.includes('(esta máquina não aparece nela)')), sem.join('\n'));
    // JSON quebrado na branch: "nao lido", e nao uma linha que some.
    const arvore = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-test-fabrica-ruim-')));
    try {
      git(arvore, 'init', '-q', '-b', 'ork/fabrica-estado');
      git(arvore, 'config', 'user.email', 'teste@exemplo.invalid');
      git(arvore, 'config', 'user.name', 'Teste');
      fs.mkdirSync(path.join(arvore, 'maquinas'));
      fs.writeFileSync(path.join(arvore, 'maquinas', 'pc-b.json'), '{ isto nao e json');
      git(arvore, 'add', '--', 'maquinas');
      git(arvore, 'commit', '-q', '-m', 'fabrica: retrato quebrado SIMULADO');
      git(p.dir, 'fetch', '-q', arvore, '+refs/heads/ork/fabrica-estado:refs/remotes/origin/ork/fabrica-estado');
    } finally { fs.rmSync(arvore, { recursive: true, force: true }); }
    const ruim = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
    assert.ok(ruim.includes('Fábrica: não lido (a cópia local de ork/fabrica-estado está ilegível).'), ruim.join('\n'));
    // Clone parcial: a copia nem e lida (o git anterior a 2.45 buscaria o objeto no remoto).
    git(p.dir, 'config', 'core.repositoryformatversion', '1');
    git(p.dir, 'config', 'extensions.partialClone', 'origin');
    const parcial = textoDoStatusDoRoadmap(montarStatusDoRoadmap(p.dir, { quando: AGORA, projeto: 'orkastery' })).split('\n');
    assert.ok(parcial.includes('Fábrica: não lido (clone parcial: a cópia local de ork/fabrica-estado não é lida sem rede).'), parcial.join('\n'));
  } finally { p.limpar(); restaurar(); }
});

/**
 * RM-054 (fatia 1): o roadmap da rede, de qualquer diretorio.
 *
 * Duas "maquinas" sao dois clones do mesmo remoto bare, como nos testes da fabrica e das reservas:
 * fetch, commit-tree e push de verdade, sem tocar o remoto do Orkastery. A forja (projeto sem clone)
 * e uma resposta gravada no formato do `gh api graphql`. Instante fixo e fuso de Brasilia; o merge
 * do dia leva a data no proprio commit. Itens, threads e maquinas SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { publicarMaquina } from '../src/fabrica-estado';
import { ExecutorDaForja, SaidaDoExecutor } from '../src/forja';
import { definirFusoDoDono } from '../src/horario';
import { registrar } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import { init } from '../src/init';
import { CONTRATO_PANORAMA_DA_REDE, ErroDoPedidoDeProjeto, LacunaDaRede, montarPanoramaDaRede, PanoramaDaRede,
  textoDoPanoramaDaRede } from '../src/network-roadmap';
import { pegarItem } from '../src/roadmap-reservas';
import { montarStatusDoRoadmap } from '../src/roadmap-status';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

const QUANDO = '2026-09-29T23:10:00.000Z'; // 29/09 20:10 em Brasilia
const antes = (min: number): string => new Date(Date.parse(QUANDO) - min * 60000).toISOString();

function textoDoItem(id: string, titulo: string, ciclo: string, thread?: string): string {
  return ['---', `id: ${id}`, 'tipo: roadmap', `titulo: "${titulo}"`, 'categoria: melhoria', 'pai: null', 'features: []', 'owner: Dono',
    'atualizado_em: 2026-09-28T10:00:00-03:00', 'estado:', `  ciclo: ${ciclo}`, '  documentacao: Rascunho', '  codigo: Não iniciado',
    '  testes: Não iniciados', '  deploy: Não implantado', '  exposicao: Flag desligada', '  habilitacao: Pendente', 'evidencias:',
    '  codigo:', '    commit: null', '    pr: null', 'sdlc:', `  thread: ${thread ?? 'null'}`, '---', '', `# ${id}`, ''].join('\n');
}

const ITENS: [string, string, string, string?][] = [
  ['RM-001', 'Espera o dono', 'Em desenvolvimento'],
  ['RM-002', 'Anda na outra maquina', 'Em desenvolvimento'],
  ['RM-003', 'Entregue hoje', 'Em validação', 'ork-entregue'],
  ['RM-004', 'Ideia nova', 'Discovery'],
];

function escrever(dir: string, rel: string, conteudo: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), conteudo);
}

/** O merge do dia com a data no proprio commit: o relogio do teste nao depende do dia em que roda. */
function commitDatado(dir: string, mensagem: string, iso: string): void {
  exec('git', ['commit', '-q', '--allow-empty', '-m', mensagem], dir, 60000, { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
}

function clonar(remoto: string, nome: string, usuario: string): string {
  const b = path.join(dirTemporario(nome), 'clone');
  exec('git', ['clone', '-q', remoto, b]);
  exec('git', ['config', 'user.email', `${usuario.toLowerCase().replace(/\s+/g, '')}@orkastery.local`], b);
  exec('git', ['config', 'user.name', usuario], b);
  exec('git', ['config', 'commit.gpgsign', 'false'], b);
  return b;
}

/**
 * A rede do teste: A (esta maquina, `pc-a`) e B (`pc-b`), clones do mesmo remoto. A tem uma thread
 * #Classic esperando o dono no RM-001; B conduz o RM-002, reservou o item e publicou o retrato; o
 * RM-003 teve o merge `ship(ork-entregue)` hoje na base.
 */
function rede(nome: string, opcoes: { semRoadmap?: boolean; semEstado?: boolean } = {}) {
  definirFusoDoDono('America/Sao_Paulo');
  const p = projetoTemporario(nome, true);
  if (!opcoes.semRoadmap) for (const [id, titulo, ciclo, thread] of ITENS) escrever(p.dir, `docs/roadmap/${id}-simulado.md`, textoDoItem(id, titulo, ciclo, thread));
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-q', '-m', 'manifesto e roadmap'], p.dir);
  if (!opcoes.semRoadmap) commitDatado(p.dir, 'ship(ork-entregue): merge de ork/ork-entregue-full em main', antes(60));
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  const b = clonar(p.remoto as string, `${nome}-b`, 'Builder B');
  let espera: string | null = null, anda: string | null = null;
  if (!opcoes.semEstado) {
    const { thread: t1 } = novaThread(exigirManifesto(p.dir), { nome: 'espera o dono', modo: 'classic', roadmap: 'RM-001' });
    registrar(dirThread(p.dir, t1.id), t1.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    espera = t1.id;
    const { thread: t2 } = novaThread(exigirManifesto(b), { nome: 'anda na outra', modo: 'auto', roadmap: 'RM-002' });
    anda = t2.id;
    assert.equal(pegarItem(b, 'RM-002', { maquina: 'pc-b', thread: t2.id, agora: antes(20) }).acao, 'pegou');
    assert.equal(publicarMaquina(exigirManifesto(b), { maquina: 'pc-b', agora: antes(10) }).acao, 'publicou');
  }
  const registro = path.join(dirTemporario(`${nome}-usuario`), 'projetos.json');
  return {
    a: p.dir, b, remoto: p.remoto as string, espera, anda, registro,
    limpar: () => {
      p.limpar();
      fs.rmSync(path.dirname(b), { recursive: true, force: true });
      fs.rmSync(path.dirname(registro), { recursive: true, force: true });
      definirFusoDoDono(undefined);
    },
  };
}

/** Toda lacuna diz o tipo, o que faltou e o que fazer; nenhum texto diz "vazio". */
function semVazio(p: PanoramaDaRede): string {
  const texto = textoDoPanoramaDaRede(p);
  assert.doesNotMatch(texto, /vazi[oa]/i, texto);
  for (const l of [...p.lacunas, ...p.projetos.flatMap((x) => x.lacunas)]) {
    assert.ok(l.tipo && l.detalhe.trim() && l.correcao.trim(), JSON.stringify(l));
  }
  return texto;
}

const tipos = (lacunas: readonly LacunaDaRede[]): string[] => lacunas.map((l) => l.tipo).sort();

test('rede: agrega roadmap, reservas e threads das duas maquinas, com fonte e horario', () => {
  const r = rede('rede-agrega');
  try {
    // D6: o retrato publicado desta maquina e velho; o panorama usa o estado local, lido agora.
    assert.equal(publicarMaquina(exigirManifesto(r.a), { maquina: 'pc-a', agora: antes(300) }).acao, 'publicou');
    // D1: item so na arvore de trabalho nao e o roadmap da rede (o `ork roadmap status` local o ve).
    escrever(r.a, 'docs/roadmap/RM-099-rascunho.md', textoDoItem('RM-099', 'Rascunho local', 'Discovery'));
    assert.ok(montarStatusDoRoadmap(r.a, { quando: QUANDO }).grupos.some((g) => g.itens.some((i) => i.id === 'RM-099')));

    const p = montarPanoramaDaRede({ cwd: r.a, quando: QUANDO, maquina: 'pc-a', registro: r.registro });
    assert.equal(p.contrato, CONTRATO_PANORAMA_DA_REDE);
    assert.equal(p.maquina, 'pc-a');
    assert.equal(p.projetos.length, 1);
    const x = p.projetos[0];
    assert.deepEqual([x.projeto.nome, x.projeto.clone, x.projeto.forja, x.projeto.origem], ['orkastery', r.a, null, 'cwd']);
    assert.deepEqual(x.lacunas, [], JSON.stringify(x.lacunas));

    // O roadmap: itens da base remota, threads das duas maquinas, entregue hoje pelo merge na base.
    const itens = new Map(x.roadmap!.grupos.flatMap((g) => g.itens.map((i) => [i.id, { ...i, grupo: g.id }])));
    assert.deepEqual([...itens.keys()].sort(), ['RM-001', 'RM-002', 'RM-003', 'RM-004']);
    assert.equal(itens.get('RM-001')!.hitl?.maquina, 'pc-a');
    assert.deepEqual(itens.get('RM-002')!.conduzindo, { thread: r.anda, fase: 'GOAL', maquina: 'pc-b' });
    assert.equal(itens.get('RM-003')!.grupo, 'hoje');
    assert.equal(itens.get('RM-004')!.grupo, 'proposto');
    assert.deepEqual(x.roadmap!.emSeguida, [{ item: 'RM-002', thread: r.anda, fase: 'GOAL', maquina: 'pc-b' }]);

    // Reservas e maquinas: B pelo retrato (idade da batida), A pelo estado local.
    assert.deepEqual(x.reservas!.map((v) => [v.item, v.maquina, v.thread]), [['RM-002', 'pc-b', r.anda]]);
    assert.deepEqual(x.maquinas!.map((m) => [m.maquina, m.origem, m.estaMaquina, m.idadeMin, m.semBatida, m.ativas.map((t) => t.id)]), [
      ['pc-a', 'estado-local', true, 0, false, [r.espera]],
      ['pc-b', 'retrato', false, 10, false, [r.anda]],
    ]);

    // A fonte e o horario de cada parte.
    const origemMain = exec('git', ['rev-parse', 'origin/main'], r.a).stdout.trim();
    assert.deepEqual(x.fontes.map((f) => [f.parte, f.origem, f.onde, f.atualizado, f.existe, f.lidoEm]), [
      ['roadmap', 'clone', 'origin/main', true, true, QUANDO],
      ['reservas', 'clone', 'origin/ork/roadmap-reservas', true, true, QUANDO],
      ['fabrica', 'clone', 'origin/ork/fabrica-estado', true, true, QUANDO],
      ['estado-local', 'estado-local', path.join(r.a, '.orkastery'), true, true, QUANDO],
    ]);
    assert.equal(x.fontes[0].commit, origemMain);
    assert.match(x.fontes[0].dataDoCommit ?? '', /^\d{4}-\d{2}-\d{2}T/);

    const texto = semVazio(p);
    const linhas = texto.split('\n');
    assert.equal(linhas[0], 'Panorama da rede lido de pc-a (29/09, 20:10)');
    assert.equal(linhas[1], `Consultado: orkastery (clone em ${r.a})`);
    assert.ok(linhas.includes('Roadmap do Orkastery (29/09, 20:10)'), texto);
    assert.ok(linhas.includes('• RM-002 Anda na outra maquina (GOAL, pc-b)'), texto);
    assert.ok(linhas.includes(`• RM-002: sigo ${r.anda} na fase GOAL (pc-b).`), texto);
    assert.ok(linhas.some((l) => /^• RM-001 \(pc-a\): Qual é o veredito sobre objetivo\?/.test(l)), texto);
    assert.ok(linhas.includes('• pc-b: 1 ativa(s), retrato de 29/09 20:00 (há 10min)'), texto);
    assert.match(texto, new RegExp(`^• roadmap: docs/roadmap em origin/main @ ${origemMain.slice(0, 7)} \\(commit de \\d{2}/\\d{2} ` +
      '\\d{2}:\\d{2}\\), lido agora$', 'm'));
    assert.ok(linhas.includes('• nenhuma: todas as fontes foram lidas agora'), texto);
    assert.equal(linhas.at(-1), 'Horários de Brasília.');
    assert.doesNotMatch(texto, /RM-099/, 'a arvore de trabalho nao entra no roadmap da rede');
  } finally { r.limpar(); }
});

// ---------------------------------------------------------------------------
// A forja simulada: o que `gh api graphql` devolve para um projeto sem clone.
// ---------------------------------------------------------------------------

const SHA = (c: string) => c.repeat(40);
const blob = (name: string, text: string) => ({ name, type: 'blob', object: { text, isBinary: false, isTruncated: false } });

function retratoDaOutra(publicadoEm: string) {
  return { contrato: 'ork.fabrica-maquina/v1', maquina: 'pc-b', por: 'Builder B', projeto: 'app', versaoOrk: '0.4.3', publicadoEm,
    threads: [{ id: 'ork-remota', nome: 'remota', modo: '#Auto', fase: 'GO', status: 'aberta', roadmap: 'RM-002', branch: 'ork/ork-remota-full',
      atualizadaEm: publicadoEm, entregue: null, esperaVoce: true, pergunta: 'autorizacao da retomada', paradaDesde: publicadoEm }] };
}

function respostaDaForja(opcoes: { publicadoEm?: string } = {}) {
  const reserva = { contrato: 'ork.roadmap-reserva/v1', item: 'RM-002', por: 'Builder B', maquina: 'pc-b', thread: 'ork-remota', nota: null,
    desdeEm: antes(90), atualizadaEm: antes(90) };
  return { data: { repository: {
    base: { name: 'main', target: { oid: SHA('a'), committedDate: antes(120),
      roadmap: { object: { entries: [blob('README.md', '# Roadmap'), blob('_modelo-item.md', '---\nid: RM-000\n---\n'),
        ...ITENS.map(([id, titulo, ciclo, thread]) => blob(`${id}-simulado.md`, textoDoItem(id, titulo, ciclo, thread)))] } },
      manifesto: { object: { text: 'project:\n  name: "app"\n  abbrev: "app"\n', isBinary: false, isTruncated: false } },
      history: { pageInfo: { hasNextPage: false }, nodes: [
        { oid: SHA('a'), messageHeadline: 'ship(ork-entregue): merge de ork/ork-entregue-full em main', committedDate: antes(60) },
        { oid: SHA('d'), messageHeadline: 'ship(ork-ontem): merge de ontem', committedDate: '2026-09-28T12:00:00Z' }] } } },
    reservas: { name: 'ork/roadmap-reservas', target: { oid: SHA('b'), committedDate: antes(90),
      arquivos: { object: { entries: [blob('RM-002.json', JSON.stringify(reserva)), blob('RM-009.json', '{"contrato":"outro"}')] } } } },
    fabrica: { name: 'ork/fabrica-estado', target: { oid: SHA('c'), committedDate: antes(10),
      arquivos: { object: { entries: [blob('pc-b.json', JSON.stringify(retratoDaOutra(opcoes.publicadoEm ?? antes(10)))),
        blob('quebrado.json', '{ nao e json')] } } } },
  } } };
}

function forjaGravada(respostas: SaidaDoExecutor[]) {
  const chamadas: { cmd: string; args: string[]; entrada: string }[] = [];
  const executor: ExecutorDaForja = (cmd, args, entrada) => {
    chamadas.push({ cmd, args: [...args], entrada });
    return respostas.shift() ?? { status: 1, stdout: '', stderr: 'sem resposta gravada' };
  };
  return { executor, chamadas };
}

const ok = (json: unknown): SaidaDoExecutor => ({ status: 0, stdout: JSON.stringify(json), stderr: '' });

test('rede: sem clone le roadmap, reservas e fabrica da forja, so consulta', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const vazio = dirTemporario('rede-sem-clone');
  const { executor, chamadas } = forjaGravada([ok(respostaDaForja())]);
  try {
    const p = montarPanoramaDaRede({ cwd: vazio, pedido: 'github:dono/app', quando: QUANDO, maquina: 'pc-c', executor,
      registro: path.join(vazio, 'projetos.json') });
    // Uma chamada, so consulta, pela CLI da forja com o login que ela ja tem.
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0].args, ['api', 'graphql', '--method', 'POST', '--input', '-']);
    assert.doesNotMatch(JSON.parse(chamadas[0].entrada).query, /mutation/i);

    const x = p.projetos[0];
    assert.deepEqual([x.projeto.nome, x.projeto.forja, x.projeto.clone, x.projeto.origem], ['app', 'github.com/dono/app', null, 'argumento']);
    const itens = new Map(x.roadmap!.grupos.flatMap((g) => g.itens.map((i) => [i.id, { ...i, grupo: g.id }])));
    assert.deepEqual([...itens.keys()].sort(), ['RM-001', 'RM-002', 'RM-003', 'RM-004'], 'README e modelo nao sao itens');
    assert.equal(itens.get('RM-003')!.grupo, 'hoje', 'merge de hoje na base; o de ontem nao conta');
    assert.deepEqual(itens.get('RM-002')!.hitl, { thread: 'ork-remota', pergunta: 'autorizacao da retomada.', maquina: 'pc-b' });
    assert.deepEqual(x.reservas!.map((v) => v.item), ['RM-002']);
    assert.deepEqual(x.maquinas!.map((m) => [m.maquina, m.origem, m.idadeMin]), [['pc-b', 'retrato', 10]]);
    assert.deepEqual(x.fontes.map((f) => [f.parte, f.origem, f.onde, f.commit, f.lidoEm]), [
      ['roadmap', 'forja', 'github.com/dono/app@main', SHA('a'), QUANDO],
      ['reservas', 'forja', 'github.com/dono/app@ork/roadmap-reservas', SHA('b'), QUANDO],
      ['fabrica', 'forja', 'github.com/dono/app@ork/fabrica-estado', SHA('c'), QUANDO],
    ]);
    // Sem clone e dito; o arquivo que nao se le vira lacuna, nunca some calado.
    assert.deepEqual(tipos(x.lacunas), ['projeto.sem-clone', 'reserva.invalida', 'retrato.invalido']);

    const texto = semVazio(p);
    assert.match(texto, /^Consultado: app \(github\.com\/dono\/app, sem clone nesta máquina\)$/m);
    assert.match(texto, /^• RM-002 \(pc-b\): autorizacao da retomada\. A pergunta chega no próximo resumo\.$/m);
    assert.match(texto, /^• roadmap: docs\/roadmap em github\.com\/dono\/app@main @ aaaaaaa \(commit de 29\/09 18:10\), lido agora$/m);
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); definirFusoDoDono(undefined); }
});

test('rede: lacuna tipada nunca vira vazio', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const vazio = dirTemporario('rede-lacunas');
  try {
    // Maquina sem batida: o retrato tem 5 h.
    const velha = montarPanoramaDaRede({ cwd: vazio, pedido: 'github:dono/app', quando: QUANDO, maquina: 'pc-c',
      executor: forjaGravada([ok(respostaDaForja({ publicadoEm: antes(300) }))]).executor, registro: path.join(vazio, 'x.json') });
    const semBatida = velha.projetos[0].lacunas.find((l) => l.tipo === 'maquina.sem-batida')!;
    assert.equal(semBatida.alvo, 'pc-b');
    assert.match(semBatida.detalhe, /pc-b sem retrato novo há 5h00 \(último em 29\/09 15:10\)/);
    assert.equal(velha.projetos[0].maquinas![0].semBatida, true);
    assert.match(semVazio(velha), /^• pc-b: 1 ativa\(s\), retrato de 29\/09 15:10 \(há 5h00\), SEM BATIDA$/m);

    // Forja ausente, sem login, repositorio que nao existe: tipo proprio, e nada lido vira "nao lido".
    const casos: [SaidaDoExecutor, string][] = [
      [{ status: null, stdout: '', stderr: '', erro: 'ENOENT' }, 'forja.ausente'],
      [{ status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }, 'forja.sem-login'],
      [{ status: 1, stdout: JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] }),
        stderr: 'gh: Could not resolve to a Repository' }, 'forja.nao-encontrado'],
    ];
    for (const [saida, tipo] of casos) {
      const p = montarPanoramaDaRede({ cwd: vazio, pedido: 'github:dono/app', quando: QUANDO, maquina: 'pc-c',
        executor: forjaGravada([saida]).executor, registro: path.join(vazio, 'x.json') });
      const x = p.projetos[0];
      assert.deepEqual(tipos(x.lacunas), ['projeto.sem-clone', tipo].sort(), tipo);
      assert.deepEqual([x.roadmap, x.reservas, x.maquinas], [null, null, null], tipo);
      const texto = semVazio(p);
      assert.match(texto, new RegExp(`^Roadmap do app: não lido \\(${tipo.replace('.', '\\.')}\\)\\.$`, 'm'));
      assert.match(texto, /^Threads por máquina\n• não lidas: veja as lacunas$/m);
    }

    // Nenhum projeto conhecido, e registro que nao se le: lacunas da consulta, nao um panorama calado.
    fs.writeFileSync(path.join(vazio, 'ruim.json'), JSON.stringify({ contrato: 'outro/v9', projetos: [] }));
    const nada = montarPanoramaDaRede({ cwd: vazio, quando: QUANDO, maquina: 'pc-c', registro: path.join(vazio, 'ruim.json') });
    assert.deepEqual(nada.projetos, []);
    assert.deepEqual(tipos(nada.lacunas), ['rede.sem-projeto', 'registro.invalido']);
    assert.match(semVazio(nada), /^Consultado: nenhum projeto\.$/m);
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); definirFusoDoDono(undefined); }

  // Branch nunca criada e projeto sem roadmap: o fato, com a fonte, e o que fazer.
  const nova = rede('rede-lacuna-nova', { semRoadmap: true, semEstado: true });
  try {
    const p = montarPanoramaDaRede({ cwd: nova.a, quando: QUANDO, maquina: 'pc-a', registro: nova.registro });
    const x = p.projetos[0];
    assert.deepEqual(tipos(x.lacunas), ['fabrica.sem-branch', 'reservas.sem-branch', 'roadmap.sem-itens']);
    assert.deepEqual(x.reservas, []);
    assert.deepEqual(x.fontes.filter((f) => !f.existe).map((f) => f.parte), ['reservas', 'fabrica']);
    const texto = semVazio(p);
    assert.match(texto, /nenhuma reserva feita ainda: a branch ork\/roadmap-reservas não existe em origin/);
    assert.match(texto, /nenhuma máquina publicou ainda: a branch ork\/fabrica-estado não existe em origin/);
    // Sem rede e sem copia das branches de estado (elas nunca existiram): dito, com o que fazer.
    const semCopia = montarPanoramaDaRede({ cwd: nova.a, quando: QUANDO, maquina: 'pc-a', registro: nova.registro, semRemoto: true });
    const lacunasSemCopia = semCopia.projetos[0].lacunas;
    assert.ok(['reservas.sem-leitura', 'fabrica.sem-leitura'].every((t) => lacunasSemCopia.some((l) => l.tipo === t &&
      /\(--sem-remoto\) e sem cópia desta máquina/.test(l.detalhe))), JSON.stringify(lacunasSemCopia));
    semVazio(semCopia);
  } finally { nova.limpar(); }

  // Sem rede: vale a ultima copia desta maquina, dita como tal; sem copia, dito tambem.
  const r = rede('rede-lacuna-offline');
  try {
    assert.deepEqual(montarPanoramaDaRede({ cwd: r.a, quando: QUANDO, maquina: 'pc-a', registro: r.registro }).projetos[0].lacunas, []);
    const fora = `${r.remoto}-fora-do-ar`;
    fs.renameSync(r.remoto, fora);
    try {
      const p = montarPanoramaDaRede({ cwd: r.a, quando: QUANDO, maquina: 'pc-a', registro: r.registro });
      const x = p.projetos[0];
      assert.deepEqual(tipos(x.lacunas), ['fabrica.sem-leitura', 'reservas.sem-leitura', 'roadmap.sem-leitura']);
      assert.ok(x.lacunas.every((l) => /vale a última cópia desta máquina, commit [0-9a-f]{7} de /.test(l.detalhe)), JSON.stringify(x.lacunas));
      assert.ok(x.fontes.filter((f) => f.parte !== 'estado-local').every((f) => f.atualizado === false));
      assert.ok(x.roadmap, 'a ultima copia ainda responde, com a lacuna');
      assert.match(semVazio(p), /última cópia desta máquina, sem leitura nova/);
    } finally { fs.renameSync(fora, r.remoto); }
  } finally { r.limpar(); }
});

test('rede: incidente, cwd de outro projeto nao responde pelo projeto pedido', () => {
  const r = rede('rede-incidente');
  // O gateway roda num diretorio com o manifesto de OUTRO projeto, sem thread nenhuma.
  const workspace = dirTemporario('rede-workspace');
  exec('git', ['init', '-q', '-b', 'main'], workspace);
  init(workspace, { nome: 'workspace', abbrev: 'wsp' });
  try {
    // Sem registro, o nome sozinho nao se resolve: recusa com os candidatos, nunca responde pelo cwd.
    assert.throws(() => montarPanoramaDaRede({ cwd: workspace, pedido: 'orkastery', quando: QUANDO, maquina: 'pc-a', registro: r.registro }),
      (e: unknown) => e instanceof ErroDoPedidoDeProjeto && e.codigo === 'projeto.desconhecido' &&
        e.candidatos.length === 1 && e.candidatos[0].startsWith('workspace') && /github:dono\/repo/.test(e.correcao));

    // Com o registro da RM-052 (ork.projetos/v1), o nome se resolve para o clone certo.
    const agora = new Date().toISOString();
    fs.writeFileSync(r.registro, JSON.stringify({ contrato: 'ork.projetos/v1', atualizadoEm: agora, projetos: [
      { nome: 'orkastery', abbrev: 'ork', raiz: r.a, remoto: null, registradoEm: agora, atualizadoEm: agora, fonte: 'init' },
      { nome: 'workspace', abbrev: 'wsp', raiz: workspace, remoto: null, registradoEm: agora, atualizadoEm: agora, fonte: 'init' },
    ] }));
    const p = montarPanoramaDaRede({ cwd: workspace, pedido: 'orkastery', quando: QUANDO, maquina: 'pc-a', registro: r.registro });
    assert.deepEqual(p.projetos.map((x) => [x.projeto.nome, x.projeto.clone, x.projeto.origem]), [['orkastery', r.a, 'argumento']]);
    assert.ok(p.naoConsultado.includes('projeto workspace: fora do pedido (--projeto)'), JSON.stringify(p.naoConsultado));
    assert.ok(p.naoConsultado.some((n) => n.startsWith('rede por pessoa (RM-053')));
    const x = p.projetos[0];
    assert.deepEqual(x.roadmap!.grupos.flatMap((g) => g.itens.map((i) => i.id)).sort(), ['RM-001', 'RM-002', 'RM-003', 'RM-004']);
    assert.deepEqual(x.maquinas!.map((m) => m.maquina), ['pc-a', 'pc-b'], 'as threads das duas maquinas, nao as do cwd');
    const texto = semVazio(p);
    assert.match(texto, new RegExp(`^Consultado: orkastery \\(clone em ${r.a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`, 'm'));
    assert.match(texto, /^• projeto workspace: fora do pedido \(--projeto\)$/m);
    assert.doesNotMatch(texto, /Roadmap do Workspace/);

    // O caminho do clone tambem resolve, de qualquer cwd; e o mesmo nome em dois clones e ambiguo.
    assert.equal(montarPanoramaDaRede({ cwd: workspace, pedido: r.a, quando: QUANDO, maquina: 'pc-a', registro: r.registro })
      .projetos[0].projeto.nome, 'orkastery');
    fs.writeFileSync(r.registro, JSON.stringify({ contrato: 'ork.projetos/v1', projetos: { orkastery: { raiz: r.a }, 'orkastery-b': { raiz: r.b } } }));
    assert.throws(() => montarPanoramaDaRede({ cwd: workspace, pedido: 'orkastery', quando: QUANDO, maquina: 'pc-a', registro: r.registro }),
      (e: unknown) => e instanceof ErroDoPedidoDeProjeto && e.codigo === 'projeto.ambiguo' && e.candidatos.length === 2);
    assert.throws(() => montarPanoramaDaRede({ cwd: workspace, pedido: path.dirname(r.b), quando: QUANDO, maquina: 'pc-a', registro: r.registro }),
      (e: unknown) => e instanceof ErroDoPedidoDeProjeto && e.codigo === 'projeto.sem-manifesto');
  } finally { r.limpar(); fs.rmSync(workspace, { recursive: true, force: true }); }
});

/**
 * RM-039 (receita da C5): os ramos de `network-roadmap.ts` mudados em 03/10 que a suite nao
 * executava: o registro de projetos da RM-052 em cada forma ruim, a resolucao do `--projeto` e o
 * texto do panorama nas partes que so aparecem com leitura parcial. Sem forja e sem rede: o
 * registro e um arquivo temporario, e o panorama do texto e montado a mao (dados SIMULADOS).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTRATO_PANORAMA_DA_REDE, CONTRATO_REGISTRO_DE_PROJETOS, ErroDoPedidoDeProjeto, montarPanoramaDaRede, PanoramaDaRede, ProjetoDaRede,
  projetosConhecidos, resolverProjeto, textoDoPanoramaDaRede } from '../src/network-roadmap';
import { ExecutorDaForja, SaidaDoExecutor } from '../src/forja';
import { definirFusoDoDono } from '../src/horario';
import { exec } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

const ALFA = 'https://github.com/dono/alfa.git';

function registro(dir: string, conteudo: unknown): string {
  const arquivo = path.join(dir, 'projetos.json');
  fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return arquivo;
}

function recusa(fn: () => unknown): ErroDoPedidoDeProjeto {
  try { fn(); } catch (e) { if (e instanceof ErroDoPedidoDeProjeto) return e; throw e; }
  assert.fail('esperava a recusa do pedido');
}

test('C5 rede registro: ausente vai ao nao consultado; ilegivel, de outro contrato ou sem lista vira lacuna', () => {
  const fora = dirTemporario('c5-nr-registro');
  try {
    const ausente = projetosConhecidos({ cwd: fora, registro: path.join(fora, 'nao-ha.json') });
    assert.deepEqual([ausente.projetos.length, ausente.lacunas.length], [0, 0]);
    assert.match(ausente.naoConsultado.join('\n'), /registro de projetos desta máquina \(RM-052\): .*nao-ha\.json ausente/);

    const casos: [unknown, RegExp][] = [
      ['{nao e json', /não é um JSON legível/],
      [{ contrato: 'ork.projetos/v0', projetos: [] }, /não está no contrato ork\.projetos\/v1/],
      [[], /não está no contrato/],
      [{ contrato: CONTRATO_REGISTRO_DE_PROJETOS }, /não traz a lista de projetos/],
    ];
    for (const [conteudo, detalhe] of casos) {
      const r = projetosConhecidos({ cwd: fora, registro: registro(fora, conteudo) });
      assert.equal(r.projetos.length, 0);
      assert.equal(r.naoConsultado.length, 0, 'registro presente foi consultado');
      assert.equal(r.lacunas.length, 1);
      assert.equal(r.lacunas[0].tipo, 'registro.invalido');
      assert.match(r.lacunas[0].detalhe, detalhe);
    }
  } finally { fs.rmSync(fora, { recursive: true, force: true }); }
});

test('C5 rede registro: mapa por nome, entrada sem clone nem forja vira lacuna, e o clone toma o lugar da forja igual', () => {
  const fora = dirTemporario('c5-nr-mapa');
  const p = projetoTemporario('c5-nr-mapa-clone');
  try {
    exec('git', ['remote', 'add', 'origin', ALFA], p.dir);
    const r = projetosConhecidos({ cwd: fora, registro: registro(fora, { contrato: CONTRATO_REGISTRO_DE_PROJETOS, projetos: {
      alfa: { remoto: ALFA },
      solto: 'texto no lugar da entrada',
      sem: { remoto: 'https://exemplo.invalido/x/y.git' },
      relativo: { raiz: 'pasta/relativa', remoto: 'nao-e-url' },
      clone: { caminho: p.dir },
    } }) });
    assert.equal(r.projetos.length, 1, 'a forja e o clone do mesmo remoto sao um projeto so');
    assert.deepEqual([r.projetos[0].raiz, r.projetos[0].origem, r.projetos[0].forja?.repo], [p.dir, 'registro', 'dono/alfa']);
    assert.deepEqual(r.lacunas.map((l) => l.detalhe), [
      'entrada (sem nome) sem clone nesta máquina e sem remoto de forja reconhecido',
      'entrada sem sem clone nesta máquina e sem remoto de forja reconhecido',
      'entrada relativo sem clone nesta máquina e sem remoto de forja reconhecido',
    ]);

    const doCwd = projetosConhecidos({ cwd: p.dir, registro: registro(fora, { projetos: [{ nome: 'alfa', raiz: p.dir }] }) });
    assert.deepEqual(doCwd.projetos.map((x) => x.origem), ['cwd'], 'o cwd vem primeiro e o registro igual nao repete');
  } finally { p.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('C5 rede pedido: caminho inexistente, sem manifesto e pasta de dentro recusam; nome ambiguo lista os candidatos', () => {
  const p = projetoTemporario('c5-nr-pedido');
  const outro = projetoTemporario('c5-nr-pedido-outro');
  const fora = dirTemporario('c5-nr-pedido-fora');
  try {
    const conhecidos: ProjetoDaRede[] = [
      { nome: 'orkastery', forja: null, raiz: p.dir, base: 'main', remoto: 'origin', origem: 'cwd' },
      { nome: 'orkastery', forja: null, raiz: outro.dir, base: 'main', remoto: 'origin', origem: 'registro' },
      { nome: 'alfa', forja: { tipo: 'github', host: 'github.com', repo: 'dono/alfa' } as ProjetoDaRede['forja'], raiz: null, base: null,
        remoto: 'origin', origem: 'registro' },
    ];
    const inexistente = recusa(() => resolverProjeto('./nao-ha', conhecidos, fora));
    assert.equal(inexistente.codigo, 'projeto.desconhecido');
    assert.match(inexistente.detalhe, /nao-ha não existe nesta máquina/);
    assert.equal(inexistente.candidatos.length, 3);

    const semManifesto = recusa(() => resolverProjeto(fora, conhecidos, fora));
    assert.equal(semManifesto.codigo, 'projeto.sem-manifesto');

    fs.mkdirSync(path.join(p.dir, 'sub'));
    const dentro = recusa(() => resolverProjeto(path.join(p.dir, 'sub'), conhecidos, fora));
    assert.equal(dentro.codigo, 'projeto.sem-manifesto');
    assert.match(dentro.detalhe, /não é a raiz de um projeto/);
    assert.equal(dentro.correcao, `se é esse o projeto, peça --projeto ${p.dir}`);

    assert.equal(resolverProjeto(p.dir, conhecidos, fora).origem, 'argumento');

    const ambiguo = recusa(() => resolverProjeto('ORKASTERY', conhecidos, fora));
    assert.equal(ambiguo.codigo, 'projeto.ambiguo');
    assert.equal(ambiguo.candidatos.length, 2);
    assert.match(ambiguo.texto, /^projeto\.ambiguo: "ORKASTERY" casa 2 projetos conhecidos\nCandidatos:\n {2}• orkastery/);
    assert.deepEqual(ambiguo.recusa.erro, 'projeto.ambiguo');

    assert.equal(resolverProjeto('dono/alfa', conhecidos, fora).nome, 'alfa', 'pelo dono/repo da forja');
    assert.equal(resolverProjeto('github:dono/alfa', conhecidos, fora).raiz, null);
    assert.deepEqual(resolverProjeto('github:dono/beta', conhecidos, fora).nome, 'beta', 'forja que ninguem conhece vale pelo nome do repo');

    const ninguem = recusa(() => resolverProjeto('fantasma', [], fora));
    assert.equal(ninguem.texto.includes('Candidatos:'), false, 'sem candidatos a lista nao sai');
  } finally { p.limpar(); outro.limpar(); fs.rmSync(fora, { recursive: true, force: true }); }
});

const QUANDO = '2026-10-03T13:00:00.000Z';
const ANTES = '2026-10-03T12:00:00.000Z';

function panorama(): PanoramaDaRede {
  return {
    contrato: CONTRATO_PANORAMA_DA_REDE, consultadoEm: QUANDO, maquina: 'pc-a', pedido: null, limiarSemBatidaMin: 30,
    fuso: 'America/Sao_Paulo', naoConsultado: [], lacunas: [],
    rede: { casa: 'github.com/dono/orkastery-network', ponta: null, atualizado: false, lidoEm: ANTES, membros: [
      { maquina: 'pc-a', estaMaquina: true, publicadoEm: ANTES, idadeMin: null, semBatida: true, versaoOrk: '0.5.2', projetos: [] },
      { maquina: 'pc-b', estaMaquina: false, publicadoEm: ANTES, idadeMin: 60, semBatida: false, versaoOrk: null, projetos: ['alfa'] },
    ] },
    projetos: [{
      projeto: { nome: 'alfa', forja: 'github.com/dono/alfa', clone: null, base: 'main', origem: 'argumento', fuso: 'UTC' },
      roadmap: null, reservas: null, maquinas: null, fontes: [
        { parte: 'estado-local', origem: 'estado-local', onde: '/tmp/estado', ref: null, commit: null, dataDoCommit: null, lidoEm: QUANDO, atualizado: true, existe: true },
        { parte: 'reservas', origem: 'forja', onde: 'github.com/dono/alfa@ork/roadmap-reservas', ref: null, commit: null, dataDoCommit: null, lidoEm: ANTES, atualizado: true, existe: false },
        { parte: 'fabrica', origem: 'clone', onde: 'origin/ork/fabrica-estado', ref: 'x', commit: null, dataDoCommit: ANTES, lidoEm: QUANDO, atualizado: false, existe: true },
      ],
      lacunas: [{ tipo: 'projeto.sem-clone', parte: 'projeto', detalhe: 'sem clone', correcao: 'clone' },
        { tipo: 'roadmap.sem-leitura', parte: 'roadmap', alvo: 'alfa', detalhe: 'a forja recusou', correcao: 'tente de novo' }],
    }],
  };
}

test('C5 rede texto: contrato errado recusa; leitura parcial sai como parcial, nunca como vazio', () => {
  assert.throws(() => textoDoPanoramaDaRede({ ...panorama(), contrato: 'ork.network-roadmap/v0' as typeof CONTRATO_PANORAMA_DA_REDE }),
    /panorama da rede: contrato inválido/);
  const texto = textoDoPanoramaDaRede(panorama());
  for (const linha of [
    'Consultado: alfa (github.com/dono/alfa, sem clone nesta máquina)',
    '• nada fora do pedido',
    '• casa: github.com/dono/orkastery-network @ sem commit, última cópia desta máquina, sem leitura nova',
    ' (batida ilegível), SEM BATIDA, ork 0.5.2, nenhum projeto declarado aqui',
    '• pc-b: retrato de 03/10 09:00 (há 1h00), projetos: alfa',
    'Roadmap do alfa: não lido (roadmap.sem-leitura).',
    'Threads por máquina\n• não lidas: veja as lacunas',
    'Reservas\n• não lidas: veja as lacunas',
    '• esta máquina: estado local em /tmp/estado, lido agora',
    '• reservas: github.com/dono/alfa@ork/roadmap-reservas não existe, lido ',
    '• fábrica: origin/ork/fabrica-estado @  (commit de ',
    '), última cópia desta máquina, sem leitura nova',
    '• roadmap.sem-leitura (alfa): a forja recusou. O que fazer: tente de novo.',
    'Neste projeto: Horários em ',
  ]) assert.ok(texto.includes(linha), `falta: ${linha}\n---\n${texto}`);

  const semCasa = textoDoPanoramaDaRede({ ...panorama(), projetos: [], naoConsultado: ['a forja'],
    rede: { casa: null, ponta: null, atualizado: null, lidoEm: QUANDO, membros: [] } });
  assert.ok(semCasa.includes('Consultado: nenhum projeto.'));
  assert.ok(semCasa.includes('• casa: nenhuma achada (veja as lacunas)\n• nenhum retrato lido na casa'));
  const naoLida = textoDoPanoramaDaRede({ ...panorama(), projetos: [], rede: { casa: 'c', ponta: 'abcdef0123', atualizado: null, lidoEm: QUANDO, membros: [] } });
  assert.ok(naoLida.includes('• casa: c, não lida (veja as lacunas)'));
  const lidaAgora = textoDoPanoramaDaRede({ ...panorama(), projetos: [], rede: { casa: 'c', ponta: 'abcdef0123', atualizado: true, lidoEm: QUANDO, membros: [] } });
  assert.ok(lidaAgora.includes('• casa: c @ abcdef0, lida agora'));
});

test('C5 rede texto: maquinas e reservas vazias, a maquina so da rede e o projeto sem fonte', () => {
  const p = panorama();
  const x = p.projetos[0];
  x.projeto.fuso = p.fuso;
  x.maquinas = [{ maquina: 'pc-r', por: 'r', publicadoEm: ANTES, idadeMin: 90, semBatida: true, estaMaquina: false, origem: 'rede', versaoOrk: null,
    ativas: [], entreguesSemMaster: 0, threadsLidas: false },
  { maquina: 'pc-a', por: 'a', publicadoEm: QUANDO, idadeMin: 0, semBatida: false, estaMaquina: true, origem: 'estado-local', versaoOrk: null,
    ativas: [], entreguesSemMaster: 2, threadsLidas: true }];
  x.reservas = [];
  x.fontes = [];
  x.lacunas = [{ tipo: 'projeto.sem-clone', parte: 'projeto', detalhe: 'sem clone', correcao: 'clone' }];
  const texto = textoDoPanoramaDaRede(p);
  for (const linha of [
    '• pc-r: threads não lidas, na rede por pessoa (retrato de ',
    ', SEM BATIDA) e sem retrato em ork/fabrica-estado',
    '• pc-a (esta máquina): 0 ativa(s), 2 entregue(s) sem MASTER, estado local lido agora',
    '• nenhuma reserva em ork/roadmap-reservas',
    'Fontes\n• nenhuma fonte lida',
    'Roadmap do alfa: não lido (sem fonte).',
  ]) assert.ok(texto.includes(linha), `falta: ${linha}\n---\n${texto}`);
  assert.equal(texto.includes('Neste projeto:'), false, 'mesmo fuso: sem a legenda do bloco');
  x.maquinas = [];
  assert.ok(textoDoPanoramaDaRede(p).includes('• nenhuma máquina publicou em ork/fabrica-estado'));
});

// A forja simulada no formato do `gh api graphql` (o mesmo de network-roadmap.test.ts), so com o que o caso pede.
const blob = (name: string, text: string) => ({ name, type: 'blob', object: { text, isBinary: false, isTruncated: false } });
function forjaGravada(respostas: SaidaDoExecutor[]): ExecutorDaForja {
  return () => respostas.shift() ?? { status: 1, stdout: '', stderr: 'sem resposta gravada' };
}
const ok = (json: unknown): SaidaDoExecutor => ({ status: 0, stdout: JSON.stringify(json), stderr: '' });

test('C5 rede forja: base sem itens, commits cortados e sem reservas nem fabrica viram lacunas; sem remoto nao consulta', () => {
  definirFusoDoDono('America/Sao_Paulo');
  const vazio = dirTemporario('c5-nr-forja');
  try {
    const resposta = { data: { repository: {
      base: { name: 'main', target: { oid: 'a'.repeat(40), committedDate: ANTES,
        roadmap: { object: { entries: [blob('README.md', '# Roadmap')] } },
        manifesto: { object: { text: 'project:\n  name: "app"\n', isBinary: false, isTruncated: false } },
        history: { pageInfo: { hasNextPage: true }, nodes: [] } } },
      reservas: null, fabrica: null } } };
    const p = montarPanoramaDaRede({ cwd: vazio, pedido: 'github:dono/app', quando: QUANDO, maquina: 'pc-c', rede: false,
      executor: forjaGravada([ok(resposta)]), registro: path.join(vazio, 'x.json') });
    const tipos = p.projetos[0].lacunas.map((l) => l.tipo);
    for (const t of ['projeto.sem-clone', 'roadmap.sem-itens', 'roadmap.entregas-parciais', 'reservas.sem-branch', 'fabrica.sem-branch'] as const)
      assert.ok(tipos.includes(t), `falta ${t}: ${tipos.join(', ')}`);
    assert.deepEqual(p.projetos[0].fontes.map((f) => [f.parte, f.existe]), [['roadmap', true], ['reservas', false], ['fabrica', false]]);

    const semRemoto = montarPanoramaDaRede({ cwd: vazio, pedido: 'github:dono/app', quando: QUANDO, maquina: 'pc-c', rede: false, semRemoto: true,
      executor: () => assert.fail('com --sem-remoto a forja nao e chamada'), registro: path.join(vazio, 'x.json') });
    assert.deepEqual(semRemoto.projetos[0].lacunas.map((l) => l.tipo), ['projeto.sem-clone', 'forja.nao-consultada']);
    assert.equal(semRemoto.projetos[0].roadmap, null);
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); definirFusoDoDono(undefined); }
});

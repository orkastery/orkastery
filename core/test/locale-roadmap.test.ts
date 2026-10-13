/**
 * RM-061, fatia F2b: `ork roadmap status` em ingles. O titulo (com a data em ISO), os grupos (pelo id), o
 * fecho e a linha da fabrica saem pelo catalogo; o bloco `Projeto consultado:` / `Não lido:` do RM-052 sai
 * igual nas duas linguas (os hosts o leem); o titulo dos itens e a pergunta que espera o dono sao dado. O
 * `--json` nao muda. Os nomes comecam por "locale en F2b roadmap:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { ativarLocale } from '../src/locale';
import { definirFusoDoDono } from '../src/horario';
import { GRUPOS_DO_ROADMAP, ItemDoStatus, StatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';

test('locale en F2b roadmap: roadmap status do CLI sai em ingles, com o bloco do RM-052 igual e o --json igual', () => {
  const c = cenario('roadmap-en');
  try {
    const en = ork(c, EN, false, 'roadmap', 'status'), pt = ork(c, PT, false, 'roadmap', 'status');
    assert.equal(en.status, 0, en.stderr);
    const l = en.stdout.split('\n');
    assert.match(l[0], /^Loc roadmap \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
    assert.match(l[1], /^Times in America\/New_York, E[SD]T\.$/);
    const bloco = (t: string) => t.split('\n').filter((x) => x.startsWith('Projeto consultado:') || x.startsWith('Não lido:'));
    assert.equal(bloco(en.stdout).length, 2);
    assert.deepEqual(bloco(en.stdout), bloco(pt.stdout));
    assert.deepEqual(l.slice(4), ['', 'What needs you', '• Nothing right now.', '', 'What I do next',
      '• Nothing in progress; next is whatever you prioritize.', '']);
    // O bloco do RM-052 e contrato com os hosts (pt-BR nas duas linguas); o resto nao tem pt-BR.
    assert.deepEqual(linhasEmPortugues(en.stdout.split('\n').filter((x) => !bloco(x).length).join('\n')), []);
    const semData = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');
    assert.equal(semData(ork(c, EN, false, 'roadmap', 'status', '--json').stdout), semData(ork(c, PT, false, 'roadmap', 'status', '--json').stdout));
    // A F3b levou `roadmap reservas` (e o padrao do roadmap) ao catalogo: o bloco do RM-052 segue igual, o resto em ingles.
    for (const args of [['roadmap'], ['roadmap', 'reservas']]) {
      const a = ork(c, PT, false, ...args), b = ork(c, EN, false, ...args);
      assert.deepEqual(bloco(b.stdout), bloco(a.stdout), args.join(' '));
      assert.match(b.stdout, /\nRoadmap reservations: project loc has no remote origin; nothing was read from ork\/roadmap-reservas\.\n$/, args.join(' '));
    }
    // A fabrica compartilhada num clone parcial: o motivo de nao ler sai pelo catalogo.
    execFileSync('git', ['config', 'extensions.partialclone', 'origin'], { cwd: c.dir });
    const clone = ork(c, { ...EN, ORK_FABRICA_COMPARTILHADA: '1' }, false, 'roadmap', 'status');
    assert.equal(clone.status, 0, clone.stderr);
    assert.ok(clone.stdout.includes('\nFactory: not read (partial clone: the local copy of ork/fabrica-estado is not read without network).\n'),
      clone.stdout);
    assert.deepEqual(linhasEmPortugues(clone.stdout.split('\n').filter((x) => !bloco(x).length).join('\n')), []);
  } finally { c.limpar(); }
});

test('locale en F2b roadmap: grupos, fecho, o que vem a seguir e a fabrica em ingles', () => {
  const T0 = '2025-09-19T18:16:00.000Z', T1 = '2025-09-19T18:21:30.000Z';
  definirFusoDoDono('America/New_York');
  ativarLocale('en');
  try {
    const item = (id: string, grupo: ItemDoStatus['grupo'], extra: Partial<ItemDoStatus> = {}): ItemDoStatus =>
      ({ id, titulo: `Titulo ${id}`, ciclo: 'x', grupo, emAberto: [], threads: [], ...extra });
    const s: StatusDoRoadmap = {
      contrato: 'ork.roadmap-status/v1' as StatusDoRoadmap['contrato'], consultadoEm: T1, projeto: 'loc',
      grupos: GRUPOS_DO_ROADMAP.map((g) => ({ ...g, itens: [item(`RM-${g.id}`, g.id)] })),
      precisaDeVoce: [{ item: 'RM-1', espera: { thread: 'loc-a', pergunta: 'Q?', codigo: 'AB12', recomendada: 'b' } },
        { item: 'RM-2', espera: { thread: 'loc-b', pergunta: 'Q?' } }],
      emSeguida: [{ item: 'RM-3', thread: 'loc-c', fase: 'GO' },
        { item: 'RM-4', thread: 'loc-d', fase: 'SHIP', entrega: { estado: 'PR #4 aberto', conduzida: true, prLidoEm: T0 } },
        { item: 'RM-5', thread: 'loc-e', fase: 'SHIP', entrega: { estado: 'PR #5 aberto' } }],
      foraDoRoadmap: { threads: ['loc-q'] },
      fabrica: { lido: true, semBatida: [{ maquina: 'vps', publicadoEm: T0, idadeMin: 95 }] },
    };
    const texto = textoDoStatusDoRoadmap(s);
    const l = texto.split('\n');
    assert.equal(l[0], 'Loc roadmap (2025-09-19 14:21)');
    assert.match(l[2], /^Factory: vps with no heartbeat for 1h35 \(last snapshot 2025-09-19 14:16\), from the local copy of ork\/fabrica-estado\.$/);
    for (const titulo of ['Done', 'Available with something open', 'Shipped today', 'Pilot', 'In development', 'Refinement', 'Proposed', 'Discontinued']) {
      assert.ok(l.some((x) => x.endsWith(` ${titulo}`)), titulo);
    }
    assert.ok(texto.includes('\nWhat needs you\n• RM-1: Q? Reply AB12 b (or another letter).\n• RM-2: Q? The question comes in the next summary.\n' +
      '• Outside the roadmap: 1 thread(s) waiting for you (`ork pulse`).\n'), texto);
    assert.ok(texto.endsWith('\nWhat I do next\n• RM-3: I continue with loc-c in phase GO.\n• RM-4: I continue with loc-d in phase SHIP; PR #4 aberto (PR read at 14:16).\n' +
      '• RM-5: loc-e in phase SHIP, PR #5 aberto.'), texto);
    const textoVelho = textoDoStatusDoRoadmap({ ...s, grupos: [], fabrica: { lido: true, copiaVelha: { ultimoDestaMaquina: null }, semBatida: [] } });
    assert.ok(textoVelho.includes('\nFactory: the local copy of ork/fabrica-estado is stale (this machine does not appear in it); ' +
      'there is no telling which machine has no heartbeat.\n'), textoVelho);
    // O estado da entrega e dado da familia de entregas (G5).
    assert.deepEqual(linhasEmPortugues(`${texto}\n${textoVelho}`, ['PR #4 aberto', 'PR #5 aberto', 'Titulo']), []);
  } finally { ativarLocale(undefined); definirFusoDoDono(undefined); }
});

/**
 * RM-026 K7, fatia 2: as consultas do conhecimento escrito (`consultarConhecimento`), a porta pública da CLI e das
 * tools MCP, com os ids do Brain conferidos por `get`. Cada teste reprova no código de antes desta fatia: a base
 * (`1079f471`) não tem o módulo da consulta nem os textos das lacunas no catálogo. O nome de cada teste começa pela
 * decisão do PLAN que ele prova (D11 a D13), a mesma do critério registrado no ledger.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BRAIN_API, BrainRequest, BrainResponse } from '../src/company-brain-client';
import { BrainEntity } from '../src/company-brain-contract';
import { BrainDaConsulta, brainDoProjeto, consultarConhecimento, consultaRespondeu, LIMITE_DE_GET_DO_CONHECIMENTO,
  PedidoDoConhecimento, RespostaDoConhecimento } from '../src/conhecimento-consulta';
import { ativarLocale, comLocale, ligarRemontagem, remontar } from '../src/locale';
import { carregarManifesto } from '../src/manifest';
import { dirTemporario } from './apoio';
import { linhasEmPortugues } from './locale-apoio';

const PROJETO = 'project:\n  name: "teste"\n  abbrev: "tst"\n';
const KB = 'conhecimento:\n  dir: docs/conhecimento\n';
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

function projeto(nome: string, bloco = KB): { dir: string; limpar: () => void } {
  const dir = dirTemporario(`conhecimento-consulta-${nome}`);
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), PROJETO + bloco);
  return { dir, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function documento(raiz: string, rel: string, frontmatter: string, corpo = '# Título\n\nCorpo.\n'): string {
  const texto = `---\n${frontmatter}---\n${corpo}`;
  const abs = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
  return texto;
}

function ledger(raiz: string, thread: string, eventos: Record<string, unknown>[]): string[] {
  const linhas = eventos.map((e) => JSON.stringify({ ts: '2026-10-12T12:00:00.000Z', thread, ...e }));
  const dir = path.join(raiz, '.orkastery', 'threads', thread);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), linhas.join('\n') + '\n');
  return linhas;
}

/** Uma entidade do Brain no contrato `orkmind.company-brain-entity/v1`. */
function entidade(id: string, titulo: string, extra: Partial<BrainEntity> = {}): BrainEntity {
  const kind = id.slice(0, 4) as BrainEntity['kind'];
  const pai = kind === 'prod' ? null : kind === 'proj' ? 'prod-portal' : 'proj-portal-rh';
  return { schema: 'orkmind.company-brain-entity/v1', tenant_id: 'teste', id, kind, version: 3, parent_id: pai, workspace_ids: [],
    depends_on: [], aliases: [{ system: 'ork', instance: 'teste', id }], title: titulo, description: '', status: 'in_progress',
    acceptance_criteria: [], owner: { raw: null, state: 'unknown', principal: null },
    source: { authority: 'ork', instance: 'teste', source_ref: `portfolio.json#${id}`, source_hash: sha(id), source_version: 3, location: `id:${id}` },
    acl_ref: 'ork-factory', observed_at: null, recorded_at: null, ...extra };
}

interface Falso { abrir: () => BrainDaConsulta; aberturas: number; pedidos: BrainRequest[] }
/** Brain falso: responde o `get` como o OrkMind, pelo id, e anota cada abertura e cada pedido. */
function brainFalso(respostas: Record<string, BrainResponse | BrainEntity>, padrao: BrainResponse = { schema: BRAIN_API, state: 'unknown' }): Falso {
  const f: Falso = { aberturas: 0, pedidos: [], abrir: () => {
    f.aberturas++;
    return { tenant: 'teste', transporte: (pedido) => {
      f.pedidos.push(pedido);
      const r = respostas[(pedido.payload as { id: string }).id] ?? padrao;
      return 'schema' in r && r.schema === BRAIN_API ? r as BrainResponse : { schema: BRAIN_API, state: 'ok', entity: r };
    } };
  } };
  return f;
}
const idsPedidos = (f: Falso) => f.pedidos.map((p) => `${p.operation}:${(p.payload as { id: string }).id}`);

function consultar(raiz: string, pedido: PedidoDoConhecimento, abrir: () => BrainDaConsulta): RespostaDoConhecimento {
  return consultarConhecimento(carregarManifesto(raiz)!, pedido, abrir);
}
const lacunas = (r: RespostaDoConhecimento) => r.lacunas.map((l) => [l.codigo, l.documento, l.referencia]);
const ref = (id: string, titulo: string) => ({ id, kind: id.slice(0, 4), titulo, versao: 3, fonte: `portfolio.json#${id}`, sha256: sha(id) });

test('D12: o id do Brain confere por get: ok vira referência citável, unknown vira brain-inexistente e withheld brain-retido', () => {
  const p = projeto('get');
  try {
    documento(p.dir, 'docs/conhecimento/rh/ferias.md', 'id: doc-ferias\ntitulo: Férias\ncolecoes: [rh]\nreferencias:\n' +
      '  brain: [proj-portal-rh, proj-sumiu, init-ferias, proj-secreto]\n');
    documento(p.dir, 'docs/conhecimento/guia.md', 'id: doc-guia\ntitulo: Guia\ncolecoes: [rh]\nreferencias:\n  brain: [proj-portal-rh]\n');
    const brain = brainFalso({
      'proj-portal-rh': entidade('proj-portal-rh', 'Portal de RH'),
      'init-ferias': entidade('init-ferias', 'Férias em dois períodos'),
      'proj-secreto': { schema: BRAIN_API, state: 'withheld' },
    });
    const r = consultar(p.dir, { consulta: 'verificar' }, brain.abrir);
    assert.equal(r.consulta, 'verificar');
    if (r.consulta !== 'verificar') return;
    assert.deepEqual(r.documentos.map((d) => [d.id, d.referencias.brain]), [
      ['doc-ferias', [ref('init-ferias', 'Férias em dois períodos'), ref('proj-portal-rh', 'Portal de RH')]],
      ['doc-guia', [ref('proj-portal-rh', 'Portal de RH')]],
    ]);
    // Um get por id distinto, em ordem: o id que dois documentos citam é conferido uma vez.
    assert.deepEqual(idsPedidos(brain), ['get:init-ferias', 'get:proj-portal-rh', 'get:proj-secreto', 'get:proj-sumiu']);
    assert.deepEqual(brain.pedidos.map((x) => x.payload), ['init-ferias', 'proj-portal-rh', 'proj-secreto', 'proj-sumiu']
      .map((id) => ({ tenant_id: 'teste', id })));
    assert.deepEqual(lacunas(r), [
      ['referencia.brain-inexistente', 'doc-ferias', 'proj-sumiu'],
      ['referencia.brain-retido', 'doc-ferias', 'proj-secreto'],
    ]);
    assert.equal(consultaRespondeu(r), false, 'verificar com lacuna não responde');

    // O mostrar confere só as referências do documento pedido.
    const so = brainFalso({ 'proj-portal-rh': entidade('proj-portal-rh', 'Portal de RH') });
    const m = consultar(p.dir, { consulta: 'mostrar', id: 'doc-guia' }, so.abrir);
    assert.deepEqual(idsPedidos(so), ['get:proj-portal-rh']);
    assert.ok(m.consulta === 'mostrar' && m.documento);
    assert.deepEqual(m.documento.referencias.brain, [ref('proj-portal-rh', 'Portal de RH')]);
    assert.deepEqual(m.lacunas, []);

    // listar e colecoes não abrem o Brain e não mostram referência nem a lacuna dela.
    const nenhum = brainFalso({});
    for (const pedido of [{ consulta: 'listar' }, { consulta: 'colecoes' }] as PedidoDoConhecimento[]) {
      const x = consultar(p.dir, pedido, nenhum.abrir);
      assert.deepEqual(x.lacunas, [], pedido.consulta);
      assert.ok(!JSON.stringify(x).includes('referencias'), pedido.consulta);
    }
    assert.equal(nenhum.aberturas, 0);
  } finally { p.limpar(); }
});

test('D12: Brain fora do ar vira brain-indisponivel, distinto de inexistente; depois da primeira falha nenhum get sai', (t) => {
  const p = projeto('fora-do-ar');
  try {
    documento(p.dir, 'docs/conhecimento/a.md', 'id: doc-aaa\ntitulo: A\ncolecoes: [rh]\nreferencias:\n  brain: [proj-uno, proj-dos, init-tres]\n');
    const fora = brainFalso({}, { schema: BRAIN_API, state: 'unavailable', error: 'brain.transport.unavailable' });
    const r = consultar(p.dir, { consulta: 'verificar' }, fora.abrir);
    assert.deepEqual(idsPedidos(fora), ['get:init-tres'], 'só o primeiro get sai');
    assert.deepEqual(lacunas(r), [['referencia.brain-indisponivel', 'doc-aaa', 'init-tres'],
      ['referencia.brain-indisponivel', 'doc-aaa', 'proj-dos'], ['referencia.brain-indisponivel', 'doc-aaa', 'proj-uno']]);
    assert.ok(r.consulta === 'verificar' && r.documentos[0].referencias.brain.length === 0, 'nenhuma referência vira resposta');
    for (const l of r.lacunas) {
      assert.equal(l.detalhe, 'o Company Brain não respondeu ao get (unavailable, brain.transport.unavailable); a referência não foi conferida');
    }
    // O id que o Brain não tem é outra lacuna: inexistente não é indisponível.
    const inexistente = consultar(p.dir, { consulta: 'verificar' }, brainFalso({}).abrir);
    assert.deepEqual(new Set(inexistente.lacunas.map((l) => l.codigo)), new Set(['referencia.brain-inexistente']));

    // A configuração de memória que não abre (na worktree sem a árvore principal) também é indisponível.
    let aberturas = 0;
    const quebrado = consultar(p.dir, { consulta: 'verificar' }, () => { aberturas++; throw new Error('project-state.memory.unavailable'); });
    assert.equal(aberturas, 1);
    assert.deepEqual(new Set(quebrado.lacunas.map((l) => l.detalhe)),
      new Set(['a configuração do Company Brain não foi lida (project-state.memory.unavailable); a referência não foi conferida']));

    // O Brain do projeto sem OrkMind (memory.mode files) responde brain.configuration.missing sem criar processo.
    const processo = require('node:child_process') as typeof import('node:child_process');
    const criados: string[] = [];
    for (const nome of ['spawn', 'spawnSync', 'execFile', 'execFileSync'] as const) {
      t.mock.method(processo, nome, (...args: unknown[]) => { criados.push(`${nome} ${String(args[0])}`); throw new Error('processo proibido'); });
    }
    const c = carregarManifesto(p.dir)!;
    const semOrkmind = consultarConhecimento(c, { consulta: 'verificar' }, () => brainDoProjeto(c));
    t.mock.restoreAll();
    assert.deepEqual(criados, []);
    assert.deepEqual(new Set(semOrkmind.lacunas.map((l) => [l.codigo, l.detalhe].join(' | '))), new Set(['referencia.brain-indisponivel | ' +
      'o Company Brain não respondeu ao get (unavailable, brain.configuration.missing); a referência não foi conferida']));
  } finally { p.limpar(); }
});

test('D12: resposta ok fora do contrato da entidade vira brain-indisponivel, e a consulta para no teto de get', () => {
  const p = projeto('contrato');
  try {
    documento(p.dir, 'docs/conhecimento/a.md', 'id: doc-aaa\ntitulo: A\ncolecoes: [rh]\nreferencias:\n' +
      '  brain: [proj-trocado, proj-outro-tenant, proj-sem-fonte, proj-certo]\n');
    const semFonte = entidade('proj-sem-fonte', 'Sem fonte');
    delete (semFonte.source as Partial<BrainEntity['source']>).location;
    const brain = brainFalso({
      'proj-trocado': entidade('proj-outro', 'Outro'),
      'proj-outro-tenant': entidade('proj-outro-tenant', 'Outro tenant', { tenant_id: 'vizinho' }),
      'proj-sem-fonte': semFonte,
      'proj-certo': entidade('proj-certo', 'Certo'),
    });
    const r = consultar(p.dir, { consulta: 'verificar' }, brain.abrir);
    assert.ok(r.consulta === 'verificar');
    assert.deepEqual(r.documentos[0].referencias.brain, [ref('proj-certo', 'Certo')]);
    assert.deepEqual(lacunas(r), ['proj-outro-tenant', 'proj-sem-fonte', 'proj-trocado'].map((id) => ['referencia.brain-indisponivel', 'doc-aaa', id]));
    assert.match(r.lacunas[0].detalhe, /fora do contrato da entidade/);
    // A resposta fora do contrato não para a conferência: o id seguinte ainda foi pedido.
    assert.equal(brain.pedidos.length, 4);

    // O teto: dois documentos com 64 ids distintos cada; só os 100 primeiros, em ordem, são pedidos.
    const ids = (pre: string) => Array.from({ length: 64 }, (_, i) => `proj-${pre}${String(i).padStart(2, '0')}`);
    documento(p.dir, 'docs/conhecimento/a.md', `id: doc-aaa\ntitulo: A\ncolecoes: [rh]\nreferencias:\n  brain: [${ids('a').join(', ')}]\n`);
    documento(p.dir, 'docs/conhecimento/b.md', `id: doc-bbb\ntitulo: B\ncolecoes: [rh]\nreferencias:\n  brain: [${ids('b').join(', ')}]\n`);
    const muitos = brainFalso({});
    const teto = consultar(p.dir, { consulta: 'verificar' }, muitos.abrir);
    assert.equal(muitos.pedidos.length, LIMITE_DE_GET_DO_CONHECIMENTO);
    const todos = [...ids('a'), ...ids('b')].sort();
    assert.deepEqual(idsPedidos(muitos), todos.slice(0, 100).map((id) => `get:${id}`));
    const porCodigo = (codigo: string) => teto.lacunas.filter((l) => l.codigo === codigo).map((l) => l.referencia).sort();
    assert.deepEqual(porCodigo('referencia.brain-inexistente'), todos.slice(0, 100));
    assert.deepEqual(porCodigo('referencia.brain-indisponivel'), todos.slice(100));
    assert.match(teto.lacunas.find((l) => l.codigo === 'referencia.brain-indisponivel')!.detalhe, /passa de 100 ids do Brain/);
  } finally { p.limpar(); }
});

test('D11: as quatro consultas no mesmo contrato: listar e colecoes sem referência, mostrar com o corpo, verificar com tudo', () => {
  const p = projeto('quatro');
  try {
    const linhas = ledger(p.dir, 'ork-x', [{ tipo: 'thread_created' }, { tipo: 'autonomous_decision' }]);
    const corpo = '# Política de férias\r\n\r\nDois períodos por ano.\n';
    const ferias = documento(p.dir, 'docs/conhecimento/rh/ferias.md', 'id: doc-ferias\ntitulo: Política de férias\ncolecoes: [rh, politicas]\n' +
      'referencias:\n  brain: [proj-portal-rh]\n  decisoes: [ork-x#2, ork-x#9]\n', corpo);
    const guia = documento(p.dir, 'docs/conhecimento/guia.md', 'id: doc-guia\ntitulo: Guia\ncolecoes: [engenharia]\n');
    documento(p.dir, 'docs/conhecimento/z.md', 'id: doc-zzz\ntitulo: Z\ncolecoes: [rh]\nautor: Ana\n');
    const brain = brainFalso({ 'proj-portal-rh': entidade('proj-portal-rh', 'Portal de RH') });
    const c = carregarManifesto(p.dir)!;
    const q = (pedido: PedidoDoConhecimento) => JSON.parse(JSON.stringify(consultarConhecimento(c, pedido, brain.abrir)));
    const resumoFerias = { id: 'doc-ferias', titulo: 'Política de férias', colecoes: ['politicas', 'rh'],
      arquivo: 'docs/conhecimento/rh/ferias.md', bytes: Buffer.byteLength(ferias), sha256: sha(ferias) };
    const resumoGuia = { id: 'doc-guia', titulo: 'Guia', colecoes: ['engenharia'], arquivo: 'docs/conhecimento/guia.md',
      bytes: Buffer.byteLength(guia), sha256: sha(guia) };
    const chave = { codigo: 'documento.chave-desconhecida', arquivo: 'docs/conhecimento/z.md', documento: 'doc-zzz', referencia: null,
      detalhe: 'chave fora do contrato: "autor" (o frontmatter tem só id, titulo, colecoes, referencias)' };
    const decisaoAusente = { codigo: 'referencia.decisao-ausente', arquivo: 'docs/conhecimento/rh/ferias.md', documento: 'doc-ferias',
      referencia: 'ork-x#9', detalhe: 'o ledger da thread ork-x tem 2 linha(s) completa(s)' };
    const base = { contrato: 'ork.conhecimento/v1', dir: 'docs/conhecimento' };

    assert.deepEqual(q({ consulta: 'listar' }), { contrato: base.contrato, consulta: 'listar', dir: base.dir, colecao: null,
      documentos: [resumoFerias, resumoGuia], lacunas: [chave] });
    assert.deepEqual(q({ consulta: 'listar', colecao: 'rh' }).documentos, [resumoFerias]);
    assert.deepEqual(q({ consulta: 'listar', colecao: 'nenhuma' }).documentos, []);
    assert.deepEqual(q({ consulta: 'colecoes' }), { contrato: base.contrato, consulta: 'colecoes', dir: base.dir, colecoes: [
      { nome: 'engenharia', documentos: ['doc-guia'] }, { nome: 'politicas', documentos: ['doc-ferias'] }, { nome: 'rh', documentos: ['doc-ferias'] },
    ], lacunas: [chave] });
    assert.equal(brain.aberturas, 0, 'listar e colecoes não abrem o Brain');

    const referencias = { brain: [ref('proj-portal-rh', 'Portal de RH')], decisoes: [{ ref: 'ork-x#2', thread: 'ork-x', linha: 2,
      tipo: 'autonomous_decision', fonte: 'threads/ork-x/ledger.jsonl#L2', sha256: sha(linhas[1]) }] };
    // O corpo é o Markdown depois do frontmatter, com as quebras de linha em \n; a versão é o sha256 dos bytes do arquivo.
    assert.deepEqual(q({ consulta: 'mostrar', id: 'doc-ferias' }), { contrato: base.contrato, consulta: 'mostrar', dir: base.dir, id: 'doc-ferias',
      documento: { id: 'doc-ferias', titulo: 'Política de férias', colecoes: ['politicas', 'rh'], referencias,
        arquivo: 'docs/conhecimento/rh/ferias.md', bytes: Buffer.byteLength(ferias), sha256: sha(ferias),
        corpo: '# Política de férias\n\nDois períodos por ano.\n' },
      lacunas: [decisaoAusente] });

    assert.deepEqual(q({ consulta: 'verificar' }), { contrato: base.contrato, consulta: 'verificar', dir: base.dir, documentos: [
      { id: 'doc-ferias', titulo: 'Política de férias', colecoes: ['politicas', 'rh'], referencias, arquivo: resumoFerias.arquivo,
        bytes: resumoFerias.bytes, sha256: resumoFerias.sha256 },
      { id: 'doc-guia', titulo: 'Guia', colecoes: ['engenharia'], referencias: { brain: [], decisoes: [] }, arquivo: resumoGuia.arquivo,
        bytes: resumoGuia.bytes, sha256: resumoGuia.sha256 },
    ], colecoes: q({ consulta: 'colecoes' }).colecoes, lacunas: [chave, decisaoAusente].sort((a, b) => a.arquivo < b.arquivo ? -1 : 1) });
  } finally { p.limpar(); }
});

test('D13: mostrar de id sem documento válido devolve a lacuna, nunca o documento; a pasta não lida não responde', () => {
  const p = projeto('mostrar');
  try {
    documento(p.dir, 'docs/conhecimento/a/dup.md', 'id: doc-dup\ntitulo: Um\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/b/dup.md', 'id: doc-dup\ntitulo: Outro\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/z.md', 'id: doc-zzz\ntitulo: Z\ncolecoes: [rh]\nautor: Ana\n');
    documento(p.dir, 'docs/conhecimento/quebrado.md', 'id: doc-quebrado\ntitulo: Decisão #42\ncolecoes: [rh]\n');
    documento(p.dir, 'docs/conhecimento/ok.md', 'id: doc-ok1\ntitulo: Ok\ncolecoes: [rh]\n');
    const brain = brainFalso({});
    const mostrar = (id: string) => consultar(p.dir, { consulta: 'mostrar', id }, brain.abrir);

    const inexistente = mostrar('doc-nao-tem');
    assert.ok(inexistente.consulta === 'mostrar');
    assert.equal(inexistente.documento, null);
    assert.deepEqual(inexistente.lacunas, [{ codigo: 'documento.inexistente', arquivo: null, documento: 'doc-nao-tem', referencia: null,
      detalhe: 'nenhum documento válido da pasta tem o id doc-nao-tem; 1 arquivo(s) da pasta viraram lacuna antes de o id ser lido ' +
        '(ork conhecimento verificar)' }]);
    assert.equal(consultaRespondeu(inexistente), false);
    // O id repetido e o documento inválido devolvem a lacuna deles, e nenhum documento.
    assert.deepEqual(lacunas(mostrar('doc-dup')), [['documento.id-repetido', 'doc-dup', null], ['documento.id-repetido', 'doc-dup', null]]);
    assert.deepEqual(lacunas(mostrar('doc-zzz')), [['documento.chave-desconhecida', 'doc-zzz', null]]);
    for (const id of ['doc-dup', 'doc-zzz']) assert.ok(mostrar(id).consulta === 'mostrar' && (mostrar(id) as { documento: unknown }).documento === null);
    const ok = mostrar('doc-ok1');
    assert.ok(ok.consulta === 'mostrar' && ok.documento?.corpo === '# Título\n\nCorpo.\n');
    assert.equal(consultaRespondeu(ok), true);
    assert.equal(brain.aberturas, 0, 'documento sem referência ao Brain não abre o Brain');

    // listar com lacuna de documento responde; verificar com lacuna não; o pedido fora da forma é erro de quem chama.
    assert.equal(consultaRespondeu(consultar(p.dir, { consulta: 'listar' }, brain.abrir)), true);
    assert.equal(consultaRespondeu(consultar(p.dir, { consulta: 'verificar' }, brain.abrir)), false);
    assert.throws(() => mostrar('DOC-OK1'), /conhecimento\.pedido-invalido/);
    assert.throws(() => consultar(p.dir, { consulta: 'listar', colecao: 'RH' }, brain.abrir), /conhecimento\.pedido-invalido/);

    // Sem a pasta declarada, nenhuma consulta responde, e a resposta é a lacuna da pasta.
    fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), PROJETO);
    for (const pedido of [{ consulta: 'listar' }, { consulta: 'colecoes' }, { consulta: 'mostrar', id: 'doc-ok1' },
      { consulta: 'verificar' }] as PedidoDoConhecimento[]) {
      const r = consultar(p.dir, pedido, brain.abrir);
      assert.deepEqual(lacunas(r), [['conhecimento.nao-declarado', null, null]], pedido.consulta);
      assert.equal(consultaRespondeu(r), false, pedido.consulta);
    }
  } finally { p.limpar(); }
});

test('D13: o detalhe das lacunas nasce no catálogo, em pt-BR na resposta, e a impressão o remonta em inglês', () => {
  const p = projeto('catalogo');
  try {
    ledger(p.dir, 'ork-x', [{ tipo: 'thread_created' }]);
    documento(p.dir, 'docs/conhecimento/a.md', 'id: doc-aaa\ntitulo: A\ncolecoes: [rh]\nreferencias:\n  brain: [proj-sumiu, proj-secreto]\n' +
      '  decisoes: [ork-x#1, ork-x#5, ork-nada#1]\n');
    documento(p.dir, 'docs/conhecimento/b.md', 'id: doc-bbb\ntitulo: B\ncolecoes: [rh]\nautor: Ana\n');
    documento(p.dir, 'docs/conhecimento/c.md', 'id: doc-ab\ntitulo: C\ncolecoes: [rh]\n');
    const brain = brainFalso({ 'proj-secreto': { schema: BRAIN_API, state: 'withheld' } });
    ligarRemontagem(true);
    try {
      ativarLocale('en');
      const r = comLocale('pt-BR', () => consultar(p.dir, { consulta: 'verificar' }, brain.abrir));
      assert.equal(r.lacunas.length, 7);
      for (const l of r.lacunas) {
        assert.ok(linhasEmPortugues(l.detalhe).length > 0, `pt-BR na resposta: ${l.detalhe}`);
        const ingles = remontar(l.detalhe);
        assert.notEqual(ingles, l.detalhe, l.codigo);
        assert.deepEqual(linhasEmPortugues(ingles), [], ingles);
      }
      assert.ok(r.lacunas.some((l) => remontar(l.detalhe) === 'the Company Brain does not have this id (get answered unknown)'));
    } finally { ativarLocale(undefined); ligarRemontagem(false); }
  } finally { p.limpar(); }
});

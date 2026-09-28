import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { consultarRollouts } from '../src/adapters/codex';
import { consultarSessoes } from '../src/adapters/claude-bg';
import { inventariarSessoes } from '../src/sessoes-inventario';
import { dirTemporario, projetoTemporario } from './apoio';
import { novaThread, gravarThread } from '../src/thread';
import { carregarManifesto } from '../src/manifest';
import { exec } from '../src/util';

test('projeto aninhado não lê registros do hospedeiro; cwds explícitos conservam vínculos globais', (t) => {
  const p = projetoTemporario('inventario-hospedeiro');
  const anterior = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  const nativo = require('node:fs') as typeof fs;
  const ler = nativo.readFileSync;
  try {
    const filho = path.join(p.dir, 'projeto-filho');
    fs.mkdirSync(filho);
    assert.equal(exec('git', ['init', '-b', 'main'], filho).ok, true);
    fs.copyFileSync(p.carregado.caminho, path.join(filho, 'orkastery.yaml'));
    const local = novaThread(carregarManifesto(filho)!, { nome: 'local', modo: 'auto' }).thread;
    local.sessoes.push({ sessionId: 'aaaaaaaa', runtime: 'claude-bg', slug: local.slug,
      fase: 'GO', bloco: 'ad-hoc', verificada: true, origem: 'adocao',
      adotadaEm: local.criadaEm, cwdOrigem: filho });
    gravarThread(filho, local);
    // Somente registros sintéticos em /tmp. Nenhuma thread da conta é consultada.
    const protegidos = ['ork-grandeevoluc', 'ork-jornadasdpa', 'ork-renarrativac'].map(id => {
      gravarThread(p.dir, { ...local, id });
      return path.join(p.dir, '.orkastery/threads', id, 'thread.json');
    });
    process.env.PATH = `${filho}:${process.env.PATH}`;
    process.env.CODEX_HOME = path.join(filho, 'codex-ausente');
    const responder = (sessoes: unknown[]) => fs.writeFileSync(path.join(filho, 'claude'),
      `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(sessoes))});\n`, { mode: 0o755 });
    const sessoes = [{ sessionId: 'aaaaaaaa', cwd: path.join(filho, 'subdir') },
      { sessionId: 'bbbbbbbb', cwd: path.join(filho, 'fixture-removida') }];
    responder(sessoes);
    const acessos: string[] = [];
    const mock = t.mock.method(nativo, 'readFileSync', ((arquivo: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (protegidos.includes(String(arquivo))) acessos.push(String(arquivo));
      return Reflect.apply(ler, nativo, [arquivo, ...args]);
    }) as typeof fs.readFileSync);
    try {
      const isolado = inventariarSessoes(filho, { global: true, todas: true });
      assert.deepEqual(acessos, [], 'não abrir registros de outro projeto por mera ancestralidade');
      assert.equal(isolado.ok, false, 'não consultar o hospedeiro impede afirmar completude global');
      assert.equal(isolado.total, 2);
      assert.equal(isolado.semThread, 1, 'cwd removido continua no universo, inclusive em /tmp');
      assert.equal(isolado.ambiguas, 0);
      assert.ok(isolado.fontes.some(f => f.origem === path.join(filho, '.orkastery/threads')));
      const pendente = isolado.fontes.find(f => f.origem === path.join(p.dir, '.orkastery/threads'));
      assert.equal(pendente?.ok, false);
      assert.match(pendente!.detalhe, /ancestral não consultado.*incompletos/);

      responder([sessoes[0]]);
      const zeroParcial = inventariarSessoes(filho, { global: true, todas: true });
      assert.equal(zeroParcial.semThread, 0);
      assert.equal(zeroParcial.ambiguas, 0);
      assert.equal(zeroParcial.ok, false, 'contagens zero não aprovam fontes pendentes');
      assert.deepEqual(acessos, []);

      // Se o runtime declara o hospedeiro, seus registros são fontes obrigatórias.
      // O isolamento não é uma exclusão de IDs nem pode esconder ambiguidade global.
      responder([...sessoes, { sessionId: 'cccccccc', cwd: p.dir }]);
      const global = inventariarSessoes(filho, { global: true, todas: true });
      assert.deepEqual(acessos.sort(), protegidos.sort());
      assert.equal(global.total, 3);
      assert.equal(global.semThread, 2);
      assert.equal(global.ambiguas, 1);
      assert.equal(global.ok, false);
      assert.ok(!global.fontes.some(f => f.detalhe.includes('ancestral não consultado')));
    } finally { mock.mock.restore(); }
  } finally {
    process.env.PATH = anterior.PATH;
    if (anterior.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = anterior.CODEX_HOME;
    p.limpar();
  }
});

test('Codex inclui histórico antigo e arquivo; inválido não equivale a zero', () => {
  const dir = dirTemporario('inventario-codex');
  try {
    fs.mkdirSync(path.join(dir, 'sessions/2020/01/01'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'archived_sessions'));
    assert.equal(consultarRollouts(true, dir).ok, true);
    for (const [p, id] of [['sessions/2020/01/01/a.jsonl', 'aaaaaaaa-1111'], ['archived_sessions/b.jsonl', 'bbbbbbbb-2222']]) {
      fs.writeFileSync(path.join(dir, p), JSON.stringify({ type: 'session_meta', payload: { id, cwd: dir } }) + '\n' +
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }) + '\n');
    }
    assert.equal(consultarRollouts(false, dir).sessoes.length, 0);
    assert.equal(consultarRollouts(true, dir).sessoes.length, 2);
    fs.writeFileSync(path.join(dir, 'sessions/invalido.jsonl'), '{}\n');
    const parcial = consultarRollouts(true, dir);
    assert.equal(parcial.ok, false);
    assert.equal(parcial.sessoes.length, 2, 'arquivo inválido não apaga os metadados válidos');
    assert.equal(parcial.resultadosFontes.find(f => f.origem === path.join(dir, 'archived_sessions'))?.ok, true);
    assert.equal(parcial.resultadosFontes.find(f => f.origem === path.join(dir, 'sessions/invalido.jsonl'))?.ok, false);
    fs.writeFileSync(path.join(dir, 'sessions/vazio.jsonl'), '');
    fs.symlinkSync(path.join(dir, 'sessions/vazio.jsonl'), path.join(dir, 'sessions/link.jsonl'));
    const erros = consultarRollouts(true, dir);
    assert.equal(erros.ok, false); assert.equal(erros.sessoes.length, 2);
    for (const nome of ['vazio.jsonl', 'link.jsonl']) {
      assert.equal(erros.resultadosFontes.find(f => f.origem === path.join(dir, 'sessions', nome))?.ok, false);
    }
    fs.renameSync(path.join(dir, 'sessions'), path.join(dir, 'sessions-anteriores'));
    fs.writeFileSync(path.join(dir, 'sessions'), 'não é diretório');
    const indisponivel = consultarRollouts(true, dir);
    assert.equal(indisponivel.ok, false);
    assert.deepEqual(indisponivel.sessoes.map(s => s.sessionId), ['bbbbbbbb-2222']);
    assert.equal(indisponivel.resultadosFontes.find(f => f.origem === path.join(dir, 'sessions'))?.ok, false);
    assert.equal(indisponivel.resultadosFontes.find(f => f.origem === path.join(dir, 'archived_sessions'))?.ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Codex opcional ausente declara fontes válidas, inclusive com histórico sem sessions', () => {
  const dir = dirTemporario('codex-opcional');
  try {
    for (const casa of [dir, path.join(dir, 'casa-ausente')]) {
      for (const todas of [false, true]) {
        const consulta = consultarRollouts(todas, casa);
        assert.equal(consulta.ok, true);
        assert.deepEqual(consulta.sessoes, []);
        assert.equal(consulta.resultadosFontes.length, todas ? 2 : 1);
        for (const fonte of consulta.resultadosFontes) {
          assert.equal(fonte.ok, true);
          assert.match(fonte.detalhe, /opcional ausente/);
        }
      }
    }
    fs.mkdirSync(path.join(dir, 'archived_sessions'));
    fs.writeFileSync(path.join(dir, 'archived_sessions/a.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'aaaaaaaa-1111', cwd: dir } }) + '\n');
    const historico = consultarRollouts(true, dir);
    assert.equal(historico.ok, true);
    assert.deepEqual(historico.sessoes.map(s => s.sessionId), ['aaaaaaaa-1111']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Codex não confunde ENOTDIR nem links de fontes opcionais com ausência', () => {
  const dir = dirTemporario('codex-fontes-invalidas');
  try {
    const arquivo = path.join(dir, 'arquivo');
    fs.writeFileSync(arquivo, 'não é diretório');
    assert.equal(consultarRollouts(true, arquivo).ok, false, 'ENOTDIR no caminho da casa');
    for (const nome of ['sessions', 'archived_sessions']) {
      const fonte = path.join(dir, nome);
      for (const alvo of [arquivo, path.join(dir, 'ausente'), dir]) {
        fs.symlinkSync(alvo, fonte);
        const consulta = consultarRollouts(true, dir);
        assert.equal(consulta.ok, false);
        assert.equal(consulta.resultadosFontes.find(f => f.origem === fonte)?.ok, false);
        fs.unlinkSync(fonte);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Codex preserva EACCES nas fontes e ENOENT durante consulta como inventário parcial', (t) => {
  const dir = dirTemporario('codex-consulta-parcial');
  const nativo = require('node:fs') as typeof fs;
  const lstat = nativo.lstatSync;
  try {
    fs.mkdirSync(path.join(dir, 'sessions/subdir'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sessions/valido.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'aaaaaaaa-1111', cwd: dir } }) + '\n');
    for (const [alvo, code, falharNaChamada] of [
      ['sessions', 'EACCES', 1], ['archived_sessions', 'EACCES', 1],
      ['sessions/subdir', 'ENOENT', 1], ['sessions', 'ENOENT', 2],
    ] as const) {
      let chamadas = 0;
      const fonte = path.join(dir, alvo);
      const mock = t.mock.method(nativo, 'lstatSync', ((p: fs.PathLike, ...args: unknown[]) => {
        if (p === fonte && ++chamadas >= falharNaChamada) throw Object.assign(new Error(code), { code });
        return Reflect.apply(lstat, nativo, [p, ...args]);
      }) as typeof fs.lstatSync);
      try {
        const consulta = consultarRollouts(true, dir);
        assert.equal(consulta.ok, false, `${code}: ${alvo}, chamada ${falharNaChamada}`);
        assert.equal(consulta.resultadosFontes.find(f => f.origem === fonte)?.ok, false);
        if (alvo !== 'sessions') assert.deepEqual(consulta.sessoes.map(s => s.sessionId), ['aaaaaaaa-1111']);
      } finally { mock.mock.restore(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Claude valida identidade, cwd, duplicação e falha do comando; inventário declara fontes', () => {
  const p = projetoTemporario('inventario');
  const anterior = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  try {
    process.env.PATH = `${p.dir}:${process.env.PATH}`;
    process.env.CODEX_HOME = p.dir;
    fs.mkdirSync(path.join(p.dir, 'sessions'));
    const responder = (dados: unknown) => fs.writeFileSync(path.join(p.dir, 'claude'),
      `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(dados))});\n`, { mode: 0o755 });
    for (const dados of [{}, [{}], [{ sessionId: 'aaaaaaaa', cwd: 3 }],
      [{ sessionId: 'aaaaaaaa', cwd: p.dir }, { sessionId: 'aaaaaaaa', cwd: p.dir }]]) {
      responder(dados);
      assert.equal(consultarSessoes(undefined, true).ok, false);
      assert.equal(inventariarSessoes(p.dir, { global: true, todas: true }).ok, false);
    }
    responder([{ sessionId: 'aaaaaaaa', cwd: p.dir }, { sessionId: 'bbbbbbbb', cwd: '/outro-projeto' }]);
    assert.equal(inventariarSessoes(p.dir, { todas: true }).total, 1);
    const global = inventariarSessoes(p.dir, { todas: true, global: true });
    assert.equal(global.ok, true);
    assert.equal(global.total, 2);
    assert.equal(global.semThread, 2);
    assert.ok(global.fontes.some(f => f.origem.includes('--all')));
    const recibo = path.join(p.dir, '.orkastery/threads/ork-site/thread.json');
    fs.mkdirSync(path.dirname(recibo), { recursive: true });
    fs.writeFileSync(recibo, JSON.stringify({ schema: 'site-delivery/v1', thread: 'ork-site' }));
    assert.equal(inventariarSessoes(p.dir).ok, true);
    fs.writeFileSync(recibo, '{}');
    assert.equal(inventariarSessoes(p.dir).ok, false);
    const t = novaThread(p.carregado, { nome: 'zzzvalida', modo: 'auto' }).thread;
    t.sessoes.push({ sessionId: 'aaaaaaaa', runtime: 'claude-bg', slug: t.slug, fase: 'GOAL', bloco: 'ad-hoc',
      origem: 'adocao', adotadaEm: t.criadaEm, cwdOrigem: p.dir, verificada: true });
    gravarThread(p.dir, t);
    fs.writeFileSync(path.join(p.dir, 'sessions/ruim.jsonl'), '{conteúdo que não deve aparecer');
    const parcial = inventariarSessoes(p.dir, { todas: true, global: true });
    assert.equal(parcial.ok, false);
    assert.equal(parcial.sessoes.find(s => s.sessionId === 'aaaaaaaa')?.vinculos[0]?.thread, t.id);
    assert.equal(parcial.fontes.find(f => f.origem === recibo)?.ok, false);
    assert.equal(parcial.fontes.find(f => f.origem === path.join(p.dir, 'sessions/ruim.jsonl'))?.ok, false);
    assert.equal(parcial.fontes.find(f => f.origem === path.join(p.dir, 'archived_sessions'))?.ok, true);
    assert.ok(!JSON.stringify(parcial).includes('conteúdo que não deve aparecer'));
    fs.writeFileSync(path.join(p.dir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    assert.equal(inventariarSessoes(p.dir).ok, false);
  } finally {
    process.env.PATH = anterior.PATH;
    if (anterior.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = anterior.CODEX_HOME;
    p.limpar();
  }
});

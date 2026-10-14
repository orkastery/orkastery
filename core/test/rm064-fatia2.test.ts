import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { hashDoPrompt, montarPrompt } from '../src/phase';
import { prepararPromptDeRetomada } from '../src/retomada-checkpoint';
import { dirThread, novaThread } from '../src/thread';
import { diretorioDoTrabalho, garantirDiretorioDoTrabalho, LIMITE_DE_ARQUIVO_DO_TRABALHO,
  resumirTrabalhoDaThread } from '../src/trabalho-thread';
import { passosDaBatida } from '../src/conducao-batida';
import { PassoDoCondutor } from '../src/conducao-sentinela';
import { checarSeparacaoDaConducao } from '../src/doctor';
import { InventarioDeSessoes } from '../src/sessoes-inventario';
import { conferirAuth as conferirAuthClaude, cotaExpostaDoAuth } from '../src/adapters/claude-bg';
import { adicionarPerfil, classificarTipoDeLimite, expirarPerfisVencidos, lerPerfis, marcarFalhaDePerfil,
  politicaDeRotacao } from '../src/runtime-profiles';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { capacidadeDoRuntimeNoProjeto } from '../src/runtime-context';
import { proximoAlvo } from '../src/retry';
import { planoDoDegrau } from '../src/runtime-escada';
import { editarBloco } from '../src/setup';

test('RM-064 T4: retomada recebe caminho e inventário pequeno sem copiar job grande ou seguir link', () => {
  const p = projetoTemporario('rm064-t4-trabalho');
  try {
    const t = novaThread(p.carregado, { nome: 'trabalho retomavel', modo: 'auto' }).thread;
    const trabalho = diretorioDoTrabalho(p.dir, t.id);
    fs.mkdirSync(path.join(trabalho, 'revisores'), { recursive: true });
    fs.writeFileSync(path.join(trabalho, 'check.md'), '# CHECK\n');
    fs.writeFileSync(path.join(trabalho, 'revisores', 'seguranca.md'), 'sem bloqueadores\n');
    fs.writeFileSync(path.join(trabalho, 'copia-do-job.bin'), Buffer.alloc(LIMITE_DE_ARQUIVO_DO_TRABALHO + 1));
    fs.symlinkSync(path.join(p.dir, 'orkastery.json'), path.join(trabalho, 'fora.link'));
    const prompt = '# Pedido original\n';
    const promptPath = path.join(dirThread(p.dir, t.id), 'prompts', 'original.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt);

    const retomada = prepararPromptDeRetomada(p.dir, t, 'GO', {
      prompt, promptPath, promptSha256: hashDoPrompt(prompt),
    }, false);

    assert.equal(retomada.ponto.trabalho.caminho, `.orkastery/threads/${t.id}/trabalho/`);
    assert.deepEqual(retomada.ponto.trabalho.arquivos.map((a) => a.arquivo), ['check.md', 'revisores/seguranca.md']);
    assert.deepEqual(retomada.ponto.trabalho.ignorados, { grandes: 1, links: 1, excedentes: 0, outros: 0 });
    assert.match(retomada.prompt, new RegExp(`\\.orkastery/threads/${t.id}/trabalho/`));
    assert.match(retomada.prompt, /check\.md/);
    assert.match(retomada.prompt, /seguranca\.md/);
    assert.doesNotMatch(retomada.prompt, /copia-do-job\.bin/);
    assert.doesNotMatch(retomada.prompt, /fora\.link/);
  } finally { p.limpar(); }
});

test('RM-064 T4 prompt: toda fase entrega a pasta de trabalho retomável da thread', () => {
  const p = projetoTemporario('rm064-t4-prompt');
  try {
    const t = novaThread(p.carregado, { nome: 'prompt do trabalho', modo: 'auto' }).thread;
    const prompt = montarPrompt(t, 'GOAL', 'defina o objetivo', p.dir);
    assert.match(prompt, new RegExp(`trabalho retomavel: \\.orkastery/threads/${t.id}/trabalho/`));
    assert.match(prompt, /rascunhos de check e PR, pareceres e listas de prova/);
  } finally { p.limpar(); }
});

test('RM-064 T4 segurança: abertura recusa troca por link, limita crescimento e reafirma modo privado', () => {
  const p = projetoTemporario('rm064-t4-seguranca');
  try {
    const t = novaThread(p.carregado, { nome: 'trabalho seguro', modo: 'auto' }).thread;
    const trabalho = garantirDiretorioDoTrabalho(p.dir, t.id);
    fs.chmodSync(trabalho, 0o777);
    assert.equal(fs.statSync(garantirDiretorioDoTrabalho(p.dir, t.id)).mode & 0o777, 0o700);
    const externo = path.join(p.dir, 'fora-do-trabalho.md');
    fs.writeFileSync(externo, 'conteúdo que não pode entrar no resumo\n');
    const troca = path.join(trabalho, 'troca.md'), cresce = path.join(trabalho, 'cresce.md');
    fs.writeFileSync(troca, 'rascunho\n');
    fs.writeFileSync(cresce, 'pequeno\n');
    const resumo = resumirTrabalhoDaThread(p.dir, t.id, { antesDeAbrir: (arquivo) => {
      if (arquivo === troca) { fs.unlinkSync(troca); fs.symlinkSync(externo, troca); }
      if (arquivo === cresce) fs.appendFileSync(cresce, Buffer.alloc(LIMITE_DE_ARQUIVO_DO_TRABALHO + 1));
    } });
    assert.deepEqual(resumo.arquivos, []);
    assert.deepEqual([resumo.ignorados.links, resumo.ignorados.grandes], [1, 1]);
  } finally { p.limpar(); }
});

test('RM-064 T4 segurança: a própria pasta de trabalho nunca pode ser link', () => {
  const p = projetoTemporario('rm064-t4-pasta-link');
  try {
    const t = novaThread(p.carregado, { nome: 'pasta segura', modo: 'auto' }).thread;
    const alvo = path.join(p.dir, 'alvo-do-link');
    fs.mkdirSync(alvo);
    fs.symlinkSync(alvo, diretorioDoTrabalho(p.dir, t.id));
    assert.throws(() => resumirTrabalhoDaThread(p.dir, t.id), /diretorio real, nunca link/);
  } finally { p.limpar(); }
});

test('RM-064 T4 performance: inventário para durante a iteração de pasta numerosa', () => {
  const p = projetoTemporario('rm064-t4-muitas-entradas');
  try {
    const t = novaThread(p.carregado, { nome: 'inventário limitado', modo: 'auto' }).thread;
    const trabalho = garantirDiretorioDoTrabalho(p.dir, t.id);
    for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(trabalho, `prova-${String(i).padStart(3, '0')}.txt`), 'x');
    const resumo = resumirTrabalhoDaThread(p.dir, t.id);
    assert.equal(resumo.arquivos.length, 24);
    assert.ok(resumo.ignorados.excedentes > 0);
  } finally { p.limpar(); }
});

const passo = (acao: PassoDoCondutor['acao'], motivo: string | null): PassoDoCondutor => ({
  thread: 'ork-x', modo: 'auto', faseAtual: 'GO', conduzida: false, acao, fase: acao === 'despachar' ? 'CHECK' : null,
  caso: null, proximoPasso: null, porque: 'fixture', desdeEm: null,
  bloqueio: motivo ? { motivo, em: new Date(0).toISOString(), deDespacho: true } : null, pedidoGuardado: true,
});

test('RM-064 T5: Sentinela cede à batida somente a retomada tipada de cota', () => {
  const passos = [passo('despachar', null), passo('retomar', 'runtime.unavailable'),
    passo('retomar', 'runtime.quota-exhausted')];
  assert.deepEqual(passosDaBatida(passos, false), passos);
  assert.deepEqual(passosDaBatida(passos, true), [passos[2]]);
});

test('RM-064 T5 doctor: avisa quando o condutor LLM e a fase viva usam a mesma conta', () => {
  const p = projetoTemporario('rm064-t5-doctor');
  try {
    const inventario = (perfil: string | null): InventarioDeSessoes => ({
      ok: true, escopo: { usuario: 'teste', global: true, historico: true, raiz: p.dir }, fontes: [], total: 1,
      semThread: 0, ambiguas: 0, fantasmas: 0,
      sessoes: [{ sessionId: '11111111-2222-3333-4444-555555555555', runtime: 'claude-bg', perfil,
        fantasma: false, viva: true, cwd: p.dir, state: 'working',
        vinculos: [{ raiz: p.dir, thread: 'ork-fase', fase: 'GO', origem: 'fixture' }] }],
    });
    const compartilhada = checarSeparacaoDaConducao(p.dir, inventario(null), { CLAUDECODE: '1' });
    assert.deepEqual([compartilhada?.nivel, compartilhada?.nome], ['warn', 'separacao da conducao']);
    assert.match(compartilhada?.detalhe ?? '', /ork-fase:GO/);
    assert.equal(checarSeparacaoDaConducao(p.dir, inventario('outra'), { CLAUDECODE: '1' })?.nivel, 'ok');
    assert.equal(checarSeparacaoDaConducao(p.dir, inventario(null), {}) , null);
  } finally { p.limpar(); }
});

test('RM-064 T7 accounts: expira marca vencida, distingue limites e aceita cota estruturada do runtime', () => {
  const p = projetoTemporario('rm064-t7-accounts');
  try {
    const dir = path.join(p.dir, 'conta-a');
    fs.mkdirSync(dir);
    adicionarPerfil(p.dir, { id: 'a', runtime: 'claude-bg', dir });
    marcarFalhaDePerfil(p.dir, 'a', { estado: 'esgotado', motivo: 'runtime.quota-exhausted',
      detalhe: 'session limit; resets in 2 hours', esgotadoAte: new Date(Date.now() - 60_000).toISOString() });
    assert.deepEqual(expirarPerfisVencidos(p.dir).map(x => x.id), ['a']);
    assert.deepEqual([lerPerfis(p.dir).perfis[0].estado, lerPerfis(p.dir).perfis[0].esgotadoAte], ['ativo', null]);
    assert.equal(classificarTipoDeLimite('session limit; resets in 2 hours'), 'sessao');
    assert.equal(classificarTipoDeLimite('weekly usage limit'), 'semanal');
    assert.equal(classificarTipoDeLimite('spending limit set by administrator'), 'gasto-admin');
    assert.deepEqual(cotaExpostaDoAuth({ quota: { used: 7, limit: 10, unit: 'requests', resetsAt: '2030-01-02T03:04:05.000Z' } }),
      { usada: 7, limite: 10, restante: 3, unidade: 'requests', resetEm: '2030-01-02T03:04:05.000Z', fonte: 'runtime' });
    assert.equal(cotaExpostaDoAuth({ loggedIn: true }), null, 'ausencia de medida nao vira zero');

    const bin = path.join(p.dir, 'fake-bin'), claude = path.join(bin, 'claude');
    fs.mkdirSync(bin);
    fs.writeFileSync(claude, '#!/bin/sh\n' +
      'printf \'%s\\n\' \'{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty",' +
      '"quota":{"used":4,"limit":20,"unit":"tokens"}}\'\n');
    fs.chmodSync(claude, 0o755);
    const pathAnterior = process.env.PATH;
    try {
      process.env.PATH = `${bin}:${pathAnterior ?? ''}`;
      const auth = conferirAuthClaude({ id: 'a', runtime: 'claude-bg', configDir: dir });
      assert.equal(auth.ok, true, auth.detalhe);
      assert.deepEqual(auth.cota, { usada: 4, limite: 20, restante: 16, unidade: 'tokens', resetEm: null, fonte: 'runtime' });
    } finally { if (pathAnterior === undefined) delete process.env.PATH; else process.env.PATH = pathAnterior; }
  } finally { p.limpar(); }
});

test('RM-064 T7 destino: runtime sem adaptador instalado não entra no fallback', () => {
  const p = projetoTemporario('rm064-t7-adapter');
  try {
    instalarMcp({ projeto: p.dir, host: 'codex' });
    instalarAdaptador('claude-code', { projeto: p.dir });
    assert.deepEqual(capacidadeDoRuntimeNoProjeto(p.dir, 'claude-bg'), {
      runtime: 'claude-bg', host: 'claude-code', preparado: true, capaz: true, motivo: null,
    });
    const codexAusente = capacidadeDoRuntimeNoProjeto(p.dir, 'codex');
    assert.equal(codexAusente.preparado, true);
    assert.equal(codexAusente.capaz, false);
    assert.match(codexAusente.motivo ?? '', /runtime\.context\.installation/);
    const fallback = [{ runtime: 'codex', model: 'gpt-5' }];
    const excluir = { perfis: [] as string[], runtimesImplicitos: [] as string[] };
    assert.equal(proximoAlvo(p.dir, { runtime: 'claude-bg', perfil: null }, fallback, excluir,
      politicaDeRotacao(p.carregado.manifesto)), null);
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['codex:gpt-5'] }).ok, true);
    const thread = novaThread(p.carregado, { nome: 'destino capaz', modo: 'auto' }).thread;
    const despacho = { promptPath: 'prompt.md', promptSha256: '0'.repeat(64), runtime: 'claude-bg', perfil: null,
      model: 'opus', effort: 'high' };
    assert.deepEqual(planoDoDegrau(p.carregado, thread, 'GO', 2, despacho, []), { pulo: 'adaptador-ausente' });

    instalarAdaptador('codex', { projeto: p.dir });
    assert.equal(capacidadeDoRuntimeNoProjeto(p.dir, 'codex').capaz, true);
    assert.equal(proximoAlvo(p.dir, { runtime: 'claude-bg', perfil: null }, fallback, excluir,
      politicaDeRotacao(p.carregado.manifesto))?.runtime, 'codex');
    assert.equal('destino' in planoDoDegrau(p.carregado, thread, 'GO', 2, despacho, []), true);
  } finally { p.limpar(); }
});

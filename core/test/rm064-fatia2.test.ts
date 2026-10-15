import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimeFalso } from './apoio';
import { hashDoPrompt, montarPrompt, rodarFase } from '../src/phase';
import { prepararPromptDeRetomada } from '../src/retomada-checkpoint';
import { dirThread, novaThread } from '../src/thread';
import { diretorioDoTrabalho, garantirDiretorioDoTrabalho, LIMITE_DE_ARQUIVO_DO_TRABALHO, LIMITE_DE_ARQUIVOS_DO_TRABALHO,
  resumirTrabalhoDaThread } from '../src/trabalho-thread';
import { passosDaBatida } from '../src/conducao-batida';
import { PassoDoCondutor } from '../src/conducao-sentinela';
import { checar, checarSeparacaoDaConducao } from '../src/doctor';
import { comLocale } from '../src/locale';
import { ACCOUNTS_EN, ACCOUNTS_PT_BR } from '../src/locale-accounts';
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
    let aberturas = 0;
    const resumo = resumirTrabalhoDaThread(p.dir, t.id, { antesDeAbrir: () => { aberturas += 1; } });
    assert.equal(resumo.arquivos.length, LIMITE_DE_ARQUIVOS_DO_TRABALHO);
    assert.ok(resumo.ignorados.excedentes > 0);
    assert.equal(aberturas, LIMITE_DE_ARQUIVOS_DO_TRABALHO, 'com a lista cheia, o resto da pasta só conta, sem abrir');
  } finally { p.limpar(); }
});

test('RM-064 T4 performance: orçamento de bytes cheio não abre os arquivos seguintes', () => {
  const p = projetoTemporario('rm064-t4-orcamento');
  try {
    const t = novaThread(p.carregado, { nome: 'orçamento do trabalho', modo: 'auto' }).thread;
    const trabalho = garantirDiretorioDoTrabalho(p.dir, t.id);
    // Cada um no teto por arquivo: dois enchem o orçamento total da pasta.
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(trabalho, `parecer-${i}.md`), Buffer.alloc(LIMITE_DE_ARQUIVO_DO_TRABALHO, 0x61));
    let aberturas = 0;
    const resumo = resumirTrabalhoDaThread(p.dir, t.id, { antesDeAbrir: () => { aberturas += 1; } });
    assert.deepEqual(resumo.arquivos.map((a) => a.arquivo), ['parecer-0.md', 'parecer-1.md']);
    assert.deepEqual([resumo.ignorados.excedentes, aberturas], [3, 2]);
  } finally { p.limpar(); }
});

test('RM-064 T4 despacho: a fase despachada de verdade cria a pasta de trabalho privada antes do prompt', (t) => {
  const p = projetoTemporario('rm064-t4-despacho');
  const runtime = runtimeFalso('rm064-t4-despacho');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const thread = novaThread(p.carregado, { nome: 'despacho cria trabalho', modo: 'auto' }).thread;
  const trabalho = diretorioDoTrabalho(p.dir, thread.id);
  const ensaio = rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO', dryRun: true });
  assert.equal(ensaio.dryRun, true);
  assert.equal(fs.existsSync(trabalho), false, 'o ensaio não cria nada no estado');
  const r = rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
  assert.equal(r.verificada, true, r.erro);
  const pasta = fs.lstatSync(trabalho);
  assert.deepEqual([pasta.isDirectory(), pasta.mode & 0o777], [true, 0o700]);
  assert.match(fs.readFileSync(r.promptPath, 'utf8'), new RegExp(`trabalho retomavel: \\.orkastery/threads/${thread.id}/trabalho/`));
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
    for (const despacho of [{ ORK_DISPATCH_ID: 'despacho-da-fase' }, { ORK_DISPATCH_THREAD: 'ork-fase' }]) {
      assert.equal(checarSeparacaoDaConducao(p.dir, inventario(null), { CLAUDECODE: '1', ...despacho }), null,
        'a sessão de fase despachada pelo ork não é o condutor');
    }
    assert.equal(comLocale('en', () => checarSeparacaoDaConducao(p.dir, inventario('outra'), { CLAUDECODE: '1' }))?.detalhe,
      'the LLM conductor (claude-bg, process environment) does not share its account with a live phase');
  } finally { p.limpar(); }
});

test('RM-064 T5 doctor: o checar do ork doctor inclui a separação da condução, fora da sessão de fase', () => {
  const p = projetoTemporario('rm064-t5-doctor-checar');
  const anterior = { CLAUDECODE: process.env.CLAUDECODE, ORK_DISPATCH_ID: process.env.ORK_DISPATCH_ID,
    ORK_DISPATCH_THREAD: process.env.ORK_DISPATCH_THREAD, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PATH: process.env.PATH };
  const stub = path.join(p.dir, 'stub-doctor');
  fs.mkdirSync(stub);
  fs.writeFileSync(path.join(stub, 'claude'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
  const semCrontab = () => ({ ok: false as const, motivo: 'crontab -l falhou: no crontab for teste' });
  const logado = () => ({ ok: true, detalhe: 'login simulado' });
  try {
    process.env.PATH = `${stub}:${anterior.PATH ?? ''}`;
    process.env.CLAUDECODE = '1';
    for (const k of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'CLAUDE_CONFIG_DIR']) delete process.env[k];
    const separacao = comLocale('pt-BR', () => checar(p.dir, [], semCrontab, logado)).find((c) => c.nome === 'separacao da conducao');
    assert.ok(separacao, 'o doctor roda o check da T5');
    assert.match(separacao.detalhe, /^o condutor LLM \(claude-bg, ambiente do processo\)/);
    process.env.ORK_DISPATCH_ID = 'despacho-da-fase';
    assert.equal(comLocale('pt-BR', () => checar(p.dir, [], semCrontab, logado)).some((c) => c.nome === 'separacao da conducao'), false);
  } finally {
    for (const [k, v] of Object.entries(anterior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    p.limpar();
  }
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
    // As falas reais do Claude Code: o limite atingido é o que conta; a semana ou a sessão do fim é só o prazo de volta.
    assert.equal(classificarTipoDeLimite('rate_limit: You\'ve hit your individual spend limit · run /extra-usage to ask your admin ' +
      'for a higher limit · your weekly limit resets 5pm (America/New_York)'), 'gasto-admin');
    assert.equal(classificarTipoDeLimite('rate_limit: You\'ve hit your individual spend limit · run /extra-usage to ask your admin ' +
      'for a higher limit · your session limit resets 1:30am (America/New_York)'), 'gasto-admin');
    assert.equal(classificarTipoDeLimite('rate_limit: You\'ve hit your weekly limit · resets Oct 20, 5pm (America/New_York)'), 'semanal');
    assert.equal(classificarTipoDeLimite('rate_limit: You\'ve hit your session limit · resets 1:30am (America/New_York)'), 'sessao');
    assert.deepEqual(cotaExpostaDoAuth({ quota: { used: 7, limit: 10, unit: 'requests', resetsAt: '2030-01-02T03:04:05.000Z' } }),
      { usada: 7, limite: 10, restante: 3, unidade: 'requests', resetEm: '2030-01-02T03:04:05.000Z', fonte: 'runtime' });
    assert.equal(cotaExpostaDoAuth({ loggedIn: true }), null, 'ausencia de medida nao vira zero');
    assert.equal(cotaExpostaDoAuth({ usage: { used: 3, limit: 10 } })?.unidade, null, 'sem unidade do runtime, o nome vem do catalogo');
    assert.deepEqual(cotaExpostaDoAuth({ usage: { percentUsed: 30 } }),
      { usada: 30, limite: 100, restante: 70, unidade: '%', resetEm: null, fonte: 'runtime' });
    assert.deepEqual([ACCOUNTS_PT_BR.cotaMedida(3, 10, null), ACCOUNTS_EN.cotaMedida(3, 10, null), ACCOUNTS_EN.cotaMedida(30, 100, '%')],
      ['3/10 unidades (medida pelo runtime)', '3/10 units (measured by the runtime)', '30/100% (measured by the runtime)']);

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

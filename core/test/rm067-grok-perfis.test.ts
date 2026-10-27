/**
 * RM-067 (F3 da ork-rm067f3perfi): perfis de conta do `grok`, login pelo proprio CLI e cota esgotada. A maquina nao tem o
 * `grok` (P1 da F1): tudo roda com o `grok` falso de `grok-falso.ts`, cada perfil com o seu `GROK_HOME` temporario.
 *
 *   - GP1: o store aceita o perfil `grok` com `grokHome`, e o inventario de sessoes por conta segue sem ele;
 *   - GP2: com dois perfis simulados, esgotar o primeiro move a thread para o segundo, e o `auth.json` nao sai do perfil;
 *   - GP3: perfil de outro estado nao recebe despacho, a frase de cota do `grok` nao marca o perfil e a escada nao troca a
 *     conta do `grok`;
 *   - GP4: `ork accounts add|check|list` com o `grok`: o login e do proprio CLI (`grok login`, `--device-auth`), e o `ork`
 *     nunca abre o `auth.json` (um FIFO no lugar dele travaria quem tentasse ler).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirTemporario, envPtBr, projetoTemporario } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { proximoAlvo, redespachar } from '../src/retry';
import { marcarContaDaFalha } from '../src/ratelimit';
import { planoDoDegrau } from '../src/runtime-escada';
import { acharSessaoGrok, comandoDeLogin, conferirAuth } from '../src/adapters/grok';
import {
  adicionarPerfil, desativarPerfil, diretorioImplicito, lerPerfis, marcarFalhaDePerfil, perfilDeDespacho, POLITICA_PADRAO,
  RUNTIMES_COM_INVENTARIO, validarPerfilDeDespacho,
} from '../src/runtime-profiles';
import { contasDeSessoes } from '../src/sessoes-contas';
import { msg } from '../src/locale';
import { Fase } from '../src/types';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const FONTE = (arquivo: string) => fs.readFileSync(path.resolve(__dirname, '../../src', arquivo), 'utf8');
const PROMPT = 'Fatia de fixture SIMULADA para os perfis do grok';
const MARCA = 'credencial-simulada-do-grok-nunca-sai-do-perfil';

function cenario(nome: string) {
  const stub = grokFalso(nome);
  const p = projetoTemporario(`grok-perfis-${nome}`);
  const t = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true }).thread;
  const dir = dirThread(p.dir, t.id);
  /** Um perfil `grok` com a casa dentro da pasta do stub e um `auth.json` simulado, como o `grok login` deixaria. */
  const perfil = (id: string) => {
    const casa = path.join(stub.dir, `casa-${id}`);
    fs.mkdirSync(casa, { mode: 0o700 });
    fs.writeFileSync(path.join(casa, 'auth.json'), JSON.stringify({ token: MARCA }), { mode: 0o600 });
    adicionarPerfil(p.dir, { id, runtime: 'grok', dir: casa });
    return casa;
  };
  return { stub, p, t, dir, perfil, eventos: () => lerLedger(dir),
    limpar: () => { p.limpar(); stub.restaurar(); } };
}

function despachar(c: ReturnType<typeof cenario>, fase: Fase, opcoes: { perfil?: string } = {}) {
  return rodarFase(c.p.carregado, c.t.id, { fase, prompt: PROMPT, runtime: 'grok', model: 'grok-modelo', ...opcoes });
}

const resultadoDa = (c: ReturnType<typeof cenario>, sid: string) =>
  c.eventos().find((e) => e.tipo === 'phase_result' && e.sessionId === sid);

/** Todo arquivo comum abaixo de `raiz`, sem seguir link. */
function arquivos(raiz: string): string[] {
  const achados: string[] = [];
  for (const e of fs.readdirSync(raiz, { withFileTypes: true })) {
    const caminho = path.join(raiz, e.name);
    if (e.isDirectory()) achados.push(...arquivos(caminho));
    else if (e.isFile()) achados.push(caminho);
  }
  return achados;
}

test('GP1: o store aceita o perfil grok com grokHome, e o inventario de sessoes por conta segue sem ele', () => {
  const c = cenario('store');
  try {
    const casa = c.perfil('g1');
    const [p] = lerPerfis(c.p.dir).perfis;
    assert.deepEqual({ id: p.id, runtime: p.runtime, grokHome: p.grokHome, estado: p.estado },
      { id: 'g1', runtime: 'grok', grokHome: casa, estado: 'ativo' });
    assert.deepEqual(perfilDeDespacho(p), { id: 'g1', runtime: 'grok', grokHome: casa });
    assert.throws(() => validarPerfilDeDespacho({ id: 'g1', runtime: 'grok', codexHome: casa }), /campo inesperado/);
    assert.throws(() => adicionarPerfil(c.p.dir, { id: 'g2', runtime: 'grok', dir: casa }), /ja ha|mesmo diretorio/i);
    assert.equal(diretorioImplicito('grok', { GROK_HOME: '/srv/casa-grok' }), '/srv/casa-grok');
    assert.ok(diretorioImplicito('grok', {}).endsWith(`${path.sep}.grok`));
    assert.deepEqual([...RUNTIMES_COM_INVENTARIO], ['claude-bg', 'codex']);
    assert.equal(contasDeSessoes(c.p.dir).contas.some((x) => x.runtime === 'grok'), false,
      'o inventario de sessoes do grok ainda nao existe: a conta dele nao vira consulta de outro runtime');
  } finally { c.limpar(); }
});

test('GP2: com dois perfis simulados, esgotar o primeiro move a thread para o segundo, e o auth.json fica no perfil', () => {
  const c = cenario('rodizio');
  const chaveAntes = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'x';
  try {
    const casaA = c.perfil('a'), casaB = c.perfil('b');
    const authA = fs.statSync(path.join(casaA, 'auth.json'));
    c.stub.stream('fim-normal.jsonl');

    // 1. O primeiro despacho vai ao perfil da vez, o primeiro do store: a sessao nasce na casa dele, nao na do processo.
    const r1 = despachar(c, 'GOAL');
    assert.equal(r1.bloqueado, false, r1.erro);
    assert.equal(r1.verificada, true);
    const sid1 = r1.sessionId!;
    assert.ok(acharSessaoGrok(sid1, casaA), 'a sessao esta na casa do perfil a');
    assert.equal(acharSessaoGrok(sid1, casaB), null);
    assert.equal(acharSessaoGrok(sid1, c.stub.casa), null, 'nunca na casa do processo');
    const d1 = c.eventos().find((e) => e.tipo === 'phase_dispatch' && e.sessionId === sid1)!;
    assert.deepEqual(d1.perfil, { id: 'a', runtime: 'grok', grokHome: casaA });
    const registro = c.eventos().find((e) => e.tipo === 'session_sensor_registered' && e.sessionId === sid1)!;
    assert.equal(registro.grokHome, casaA, 'o watcher procura a sessao na casa do perfil');
    esperarCondicao(() => resultadoDa(c, sid1) !== undefined, 60000);

    // 2. O perfil a esgota: o sinal tipado cai no store pelo mesmo domicilio de todo runtime, com prazo de volta.
    const prazo = new Date(Date.now() + 2 * 3600_000).toISOString();
    const perfilA = validarPerfilDeDespacho(d1.perfil);
    marcarContaDaFalha(c.p.carregado, perfilA,
      { motivo: 'runtime.quota-exhausted', resetEm: prazo, fonte: 'iso', trecho: 'cota simulada do perfil a' });
    assert.equal(lerPerfis(c.p.dir).perfis.find((p) => p.id === 'a')!.estado, 'esgotado');

    // 3. A rotacao do retry acha o perfil b do mesmo runtime, e o redespacho da thread vai a ele.
    const alvo = proximoAlvo(c.p.dir, { runtime: 'grok', perfil: perfilA }, [], { perfis: [], runtimesImplicitos: [] }, POLITICA_PADRAO);
    assert.deepEqual(alvo, { runtime: 'grok', perfil: { id: 'b', runtime: 'grok', grokHome: casaB }, model: null, effort: null });
    const prompt = path.join(c.dir, 'prompt-rodizio.md');
    fs.writeFileSync(prompt, PROMPT);
    const sha = createHash('sha256').update(PROMPT).digest('hex');
    const r2 = redespachar(c.p.carregado, lerThread(c.p.dir, c.t.id), 'GOAL', prompt, sha,
      { runtime: 'grok', perfil: alvo!.perfil!.id, model: 'grok-modelo', origem: 'retry.rotacao' });
    assert.ok(r2.sessionId, r2.detalhe);
    assert.ok(acharSessaoGrok(r2.sessionId!, casaB), 'a sessao da thread agora esta na casa do perfil b');
    assert.equal(acharSessaoGrok(r2.sessionId!, casaA), null);
    const d2 = c.eventos().find((e) => e.tipo === 'phase_dispatch' && e.sessionId === r2.sessionId)!;
    assert.deepEqual(d2.perfil, { id: 'b', runtime: 'grok', grokHome: casaB });
    esperarCondicao(() => resultadoDa(c, r2.sessionId!) !== undefined, 60000);

    // 4. O despacho novo da thread tambem pula o perfil esgotado.
    const r3 = despachar(c, 'GOAL');
    assert.equal(r3.bloqueado, false, r3.erro);
    assert.ok(acharSessaoGrok(r3.sessionId!, casaB));
    esperarCondicao(() => resultadoDa(c, r3.sessionId!) !== undefined, 60000);

    // 5. O auth.json nao foi tocado nem copiado: nenhum arquivo do projeto (estado, ledger, store, logs) tem a credencial.
    const depois = fs.statSync(path.join(casaA, 'auth.json'));
    assert.equal(depois.mtimeMs, authA.mtimeMs);
    assert.equal(fs.readFileSync(path.join(casaA, 'auth.json'), 'utf8'), JSON.stringify({ token: MARCA }));
    const comMarca = arquivos(c.p.dir).filter((f) => fs.readFileSync(f).includes(MARCA));
    assert.deepEqual(comMarca, [], 'a credencial nao sai da casa do perfil');
    assert.equal(c.stub.xaiVisto(), false, 'D1 b: o filho autentica pela assinatura do perfil, nunca pela chave');
  } finally {
    if (chaveAntes === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = chaveAntes;
    c.limpar();
  }
});

test('GP3: perfil de outro estado nao recebe despacho, a frase de cota nao marca o perfil e a escada nao troca a conta do grok', () => {
  const c = cenario('estados');
  try {
    c.perfil('a'); c.perfil('b'); c.perfil('c'); c.perfil('d');
    marcarFalhaDePerfil(c.p.dir, 'a', { estado: 'sem-auth', esgotadoAte: null, motivo: 'runtime.auth-missing', detalhe: 'simulado' });
    marcarFalhaDePerfil(c.p.dir, 'b', { estado: 'provider-pago', esgotadoAte: null, motivo: 'cost.violation', detalhe: 'simulado' });
    desativarPerfil(c.p.dir, 'c');
    marcarFalhaDePerfil(c.p.dir, 'd', { estado: 'esgotado', esgotadoAte: new Date(Date.now() + 3600_000).toISOString(),
      motivo: 'runtime.quota-exhausted', detalhe: 'simulado' });
    c.stub.stream('fim-normal.jsonl');

    const r = despachar(c, 'GOAL');
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'runtime.quota-exhausted', 'com um perfil esgotado ha prazo: a fila');
    for (const [id, motivo] of [['a', 'runtime.auth-missing'], ['b', 'cost.violation'], ['c', 'runtime.profile-invalid'],
      ['d', 'runtime.quota-exhausted']]) {
      const pedido = despachar(c, 'GOAL', { perfil: id });
      assert.equal(pedido.bloqueado, true, id);
      assert.equal(pedido.motivo, motivo, id);
    }
    assert.deepEqual(c.stub.chamadas(), [], 'nenhum perfil fora do rodizio chegou ao grok');
    assert.equal(c.eventos().some((e) => e.tipo === 'phase_dispatch'), false);

    // O perfil ativo recebe; a frase de cota do grok antes da sessao nao o marca (formato nao confirmado).
    const casaE = c.perfil('e');
    c.stub.streamTexto(`${JSON.stringify({ type: 'error', message: 'usage_limit_exceeded: weekly pool used' })}\n`);
    c.stub.semSessao();
    c.stub.saida(1);
    const frase = despachar(c, 'GOAL');
    assert.equal(frase.sessionId, null);
    assert.notEqual(frase.motivo, 'runtime.quota-exhausted');
    assert.equal(lerPerfis(c.p.dir).perfis.find((p) => p.id === 'e')!.estado, 'ativo', 'a frase nao tira o perfil do rodizio');
    const chamada = c.stub.chamadas().at(-1)!;
    assert.equal(chamada[chamada.indexOf('--cwd') + 1], lerThread(c.p.dir, c.t.id).worktree);
    assert.ok(fs.existsSync(casaE));

    // A escada de recuperacao nunca troca a conta do grok (degrau 3), mesmo com o perfil e disponivel.
    const despacho = { promptPath: 'p.md', promptSha256: 'x'.repeat(64), runtime: 'grok',
      perfil: { id: 'd', runtime: 'grok' as const, grokHome: path.join(c.stub.dir, 'casa-d') }, model: 'grok-modelo', effort: null };
    assert.deepEqual(planoDoDegrau(c.p.carregado, lerThread(c.p.dir, c.t.id), 'GOAL', 3, despacho, []),
      { pulo: 'cota-sem-sinal-tipado' });
  } finally { c.limpar(); }
});

test('GP4: ork accounts com o grok: login pelo proprio CLI, sem conferencia previa, e o auth.json nunca e aberto', () => {
  const p = projetoTemporario('grok-perfis-cli');
  const casas = dirTemporario('grok-perfis-casas');
  const env = envPtBr(process.env);
  const ork = (args: string[]): { saida: string; codigo: number } => {
    try {
      return { saida: execFileSync(process.execPath, [CLI, ...args], { cwd: p.dir, env, encoding: 'utf8', stdio: 'pipe', timeout: 60000 }),
        codigo: 0 };
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string; status?: number | null; signal?: string | null };
      assert.equal(x.signal ?? null, null, `o comando travou ou foi morto (${x.signal}): alguem abriu o auth.json?`);
      return { saida: `${x.stdout ?? ''}${x.stderr ?? ''}`, codigo: x.status ?? 1 };
    }
  };
  try {
    // O auth.json do perfil e um FIFO: quem o abrisse para ler ficaria preso ate o prazo do execFileSync.
    const casa = path.join(casas, 'f');
    fs.mkdirSync(casa, { mode: 0o700 });
    execFileSync('mkfifo', ['-m', '600', path.join(casa, 'auth.json')]);

    const add = ork(['accounts', 'add', 'f', '--runtime', 'grok', '--dir', casa, '--device-auth']);
    assert.equal(add.codigo, 0, add.saida);
    assert.ok(add.saida.includes(`Login pendente: rode GROK_HOME='${casa}' grok login --device-auth e depois ork accounts check f`), add.saida);
    assert.match(add.saida, /Perfil f \(grok\) em .*: login sem conferencia previa \(o grok nao documenta conferencia de login; /);
    const semDispositivo = ork(['accounts', 'add', 'g', '--runtime', 'grok', '--dir', `${casa}-g`, '--sem-login']);
    assert.equal(semDispositivo.codigo, 0, semDispositivo.saida);
    assert.ok(semDispositivo.saida.includes(`grok login e depois ork accounts check g`), semDispositivo.saida);

    const check = ork(['accounts', 'check', 'f']);
    assert.equal(check.codigo, 0, check.saida);
    assert.match(check.saida, /f \(grok\): login sem conferencia previa, estado mantido/);
    const lista = JSON.parse(ork(['accounts', 'list', '--json']).saida) as { perfis: Array<Record<string, unknown>> };
    assert.deepEqual(lista.perfis.map((x) => [x.id, x.runtime, x.grokHome, x.estado]),
      [['f', 'grok', casa, 'ativo'], ['g', 'grok', `${casa}-g`, 'ativo']]);
    assert.equal(fs.statSync(path.join(casa, 'auth.json')).isFIFO(), true, 'o FIFO segue no lugar, sem copia');

    // O codigo de dispositivo e so do login do grok.
    const outro = ork(['accounts', 'add', 'h', '--runtime', 'codex', '--dir', `${casa}-h`, '--device-auth']);
    assert.equal(outro.codigo, 2);
    assert.match(outro.saida, /--runtime claude-bg\|codex\|grok/);

    // O login e o do proprio CLI, e a conferencia nunca reabre um perfil que o runtime reprovou.
    assert.deepEqual(comandoDeLogin(), ['grok', 'login']);
    assert.deepEqual(comandoDeLogin(true), ['grok', 'login', '--device-auth']);
    assert.equal(conferirAuth({ id: 'f', runtime: 'grok', grokHome: casa }).semConferencia, true);
    assert.equal(conferirAuth({ id: 'x', runtime: 'codex', codexHome: casa }).ok, false);
    // O ork nao tem caminho de codigo que leia o auth.json: o nome so aparece em comentario.
    for (const arquivo of ['adapters/grok.ts', 'adapters/grok-events.ts', 'session-watcher-grok.ts', 'runtime-profiles.ts', 'index.ts']) {
      const codigo = FONTE(arquivo).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
      assert.equal(/auth\.json/.test(codigo.replace(/\/\/.*$/gm, '')), false, arquivo);
    }
    // As frases da conferencia do grok saem traduzidas no accounts.
    for (const frase of ['o grok nao documenta conferencia de login; o despacho prova o login (erro de login do runtime vira runtime.auth-missing)',
      'runtime.profiles.invalid: perfil sem grokHome no despacho grok']) {
      assert.ok(FONTE('adapters/grok.ts').includes(frase), frase);
      assert.notEqual(msg('en').accounts.detalheDoLogin(frase), frase, `sem traducao: ${frase}`);
    }
  } finally {
    fs.rmSync(casas, { recursive: true, force: true });
    p.limpar();
  }
});

/** RM-090 F3: prova hermética dos adapters nativos até o LogRecord de correlação. */
import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { despachar as despacharClaude, extrairSessionId, montarComando as comandoClaude } from '../src/adapters/claude-bg';
import { ambienteDoFilho, type DespachoCodexPedido } from '../src/adapters/codex';
import { despacharComController, encerrarController } from '../src/adapters/codex-controller';
import { comandoDoWorker, identidadeNativaCodex } from '../src/adapters/codex-controller-worker';
import { caminhoConfigTelemetria, gravarAtivacaoTelemetria } from '../src/telemetria-config';
import { comandoCodexAppServer, ENV_ENDPOINT_OTLP_CODEX, prepararTelemetriaDoRuntime,
  resolverTelemetriaDoRuntime } from '../src/telemetria-runtime';
import { mapearEventoDoLedger, type OtlpKeyValue } from '../src/telemetria';
import { lerLedger } from '../src/ledger';
import { dadosDoDespacho, rodarFase, type ContextoDeDespacho } from '../src/phase';
import { novaIdentidadeDeDespacho } from '../src/runtime-context';
import { RUNTIMES } from '../src/runtimes';
import { dirThread, novaThread } from '../src/thread';
import type { EventoLedger } from '../src/types';
import { projetoTemporario, runtimeFalso } from './apoio';
import { controllerSimulado } from './controller-simulado';

const ENDPOINT = 'https://collector.example/v1/logs';
const CABECALHO = 'Bearer VALOR-SINTETICO';
const PSEUDONIMO = 'a'.repeat(64);
const ATIVACAO = { ligada: true as const, origem: 'builder' as const, motivo: 'teste', pseudonimo: PSEUDONIMO };
const DESTINO = { endpoint: ENDPOINT, headers: { authorization: CABECALHO }, timeoutMs: 1000 };

function atributos(registro: { attributes: OtlpKeyValue[] }): Record<string, OtlpKeyValue['value']> {
  return Object.fromEntries(registro.attributes.map(item => [item.key, item.value]));
}

test('identidades Claude e Codex atravessam adapters, phase_dispatch e mapper sem copiar evento nativo', () => {
  const projeto = projetoTemporario('telemetria-identidade');
  try {
    const thread = novaThread(projeto.carregado, { nome: 'telemetria-identidade', modo: 'auto' }).thread;
    const prompt = 'identidade hermética';
    const promptSha256 = createHash('sha256').update(prompt).digest('hex');
    const telemetriaCodex = prepararTelemetriaDoRuntime('codex', {
      thread: thread.id, fase: 'GOAL', dispatchId: 'dispatch-codex',
    }, ATIVACAO, DESTINO);
    assert.equal(telemetriaCodex?.runtime, 'codex');
    if (!telemetriaCodex || telemetriaCodex.runtime !== 'codex') return;
    const pedidoCodex = { prompt, nome: thread.slug, cwd: projeto.dir, dryRun: true,
      vinculo: { thread: thread.id, fase: 'GOAL', promptSha256 }, telemetria: telemetriaCodex };
    const launcher = despacharComController(pedidoCodex, ambienteDoFilho(pedidoCodex, {}));
    assert.equal(launcher.ok, true, launcher.erro);
    const comandoWorker = comandoDoWorker(pedidoCodex);
    assert.deepEqual(comandoWorker, launcher.comando, 'launcher e worker usam o mesmo argv OTEL');
    const idCodex = randomUUID();
    assert.deepEqual(identidadeNativaCodex({ thread: { id: idCodex, cwd: projeto.dir,
      path: path.join(projeto.dir, 'rollout.jsonl') } }, projeto.dir), {
      sessionId: idCodex, cwd: projeto.dir, path: path.join(projeto.dir, 'rollout.jsonl'),
    });

    const idClaude = extrairSessionId('Background agent started: 11111111-2222-3333-4444-555555555555');
    assert.equal(idClaude, '11111111-2222-3333-4444-555555555555');
    const telemetriaClaude = prepararTelemetriaDoRuntime('claude-bg', {
      thread: thread.id, fase: 'GOAL', dispatchId: 'dispatch-claude',
    }, ATIVACAO, DESTINO);
    assert.equal(telemetriaClaude?.runtime, 'claude-bg');
    if (!telemetriaClaude || telemetriaClaude.runtime !== 'claude-bg' || !idClaude) return;
    const comandoDoClaude = comandoClaude({ prompt, nome: thread.slug, cwd: projeto.dir,
      telemetria: telemetriaClaude }, '/tmp/ork-telemetria-teste/settings.json');

    const evento = (runtime: 'claude-bg' | 'codex', sessionId: string, comando: string[]): EventoLedger => {
      const identidade = novaIdentidadeDeDespacho(thread.id, 'GOAL');
      const ctx: ContextoDeDespacho = { identidade, raiz: projeto.dir, thread, fase: 'GOAL', slug: thread.slug,
        promptPath: path.join(projeto.dir, 'prompt.md'), promptSha256, runtime, cwd: projeto.dir,
        model: 'modelo-SIMULADO', effort: 'high', origem: 'phase.run' };
      return { ts: '2026-11-11T12:00:00.000Z', thread: thread.id, tipo: 'phase_dispatch',
        eventId: `dispatch-${runtime}`, sessionId, ...dadosDoDespacho(ctx, comando),
        body: `body-${runtime}`, payload: `payload-${runtime}`, event: `${runtime}.tool_result`,
        eventName: `${runtime}.user_prompt` } as EventoLedger;
    };
    const eventos = [evento('claude-bg', idClaude, comandoDoClaude), evento('codex', idCodex, comandoWorker)];
    const contexto = { serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: PSEUDONIMO,
      redigir: (texto: string) => ({ ok: true as const, texto }), observadoEmNano: () => 1_800_000_000_000_000_000n };
    for (const e of eventos) {
      const registro = mapearEventoDoLedger(e, contexto).registro!;
      const attrs = atributos(registro);
      const nativo = e.runtime === 'codex' ? 'conversation.id' : 'session.id';
      assert.equal(registro.eventName, 'orkastery.ledger.phase_dispatch');
      assert.deepEqual(attrs[nativo], { stringValue: e.sessionId });
      assert.deepEqual(attrs['orkastery.thread.id'], { stringValue: thread.id });
      assert.deepEqual(attrs['orkastery.phase.name'], { stringValue: 'GOAL' });
      assert.ok(attrs['orkastery.dispatch.id']);
      assert.deepEqual(attrs['orkastery.runtime.name'], { stringValue: e.runtime });
      assert.deepEqual(attrs['user.hash'], { stringValue: PSEUDONIMO });
      const serializado = JSON.stringify(registro);
      for (const proibido of [`body-${e.runtime}`, `payload-${e.runtime}`, `${e.runtime}.tool_result`,
        `${e.runtime}.user_prompt`]) assert.equal(serializado.includes(proibido), false, proibido);
    }

    for (const resposta of [launcher.comando.join(' '), comandoWorker.join(' ')]) {
      assert.equal(resposta.includes(ENDPOINT), false, 'endpoint ausente do argv e da resposta');
      assert.equal(resposta.includes(CABECALHO), false, 'cabeçalho ausente do argv e da resposta');
      assert.match(resposta, /\$\{ORK_TELEMETRIA_OTLP_ENDPOINT\}/);
    }
    for (const e of eventos) {
      const comandoRegistrado = e.comando as string[];
      const serializado = JSON.stringify(comandoRegistrado);
      assert.equal(serializado.includes(ENDPOINT), false);
      assert.equal(serializado.includes(CABECALHO), false);
      assert.equal(comandoRegistrado.some(arg => arg.startsWith('otel.')), false,
        'todo argumento de telemetria é redigido no payload gravado pelo phase');
      assert.ok(comandoRegistrado.includes('<telemetria:redigida>'));
    }

    const ambiente = ambienteDoFilho({ perfil: { id: 'perfil-codex', runtime: 'codex', codexHome: '/tmp/codex-home' },
      ambienteExtra: { ORK_DISPATCH_ID: 'dispatch-codex', ORK_DISPATCH_THREAD: thread.id },
      telemetria: telemetriaCodex }, { CODEX_HOME: '/tmp/antigo', OPENAI_API_KEY: 'valor-pago' });
    assert.equal(ambiente.CODEX_HOME, '/tmp/codex-home');
    assert.equal(ambiente.ORK_DISPATCH_ID, 'dispatch-codex');
    assert.equal(ambiente.ORK_DISPATCH_THREAD, thread.id);
    assert.equal(ambiente[ENV_ENDPOINT_OTLP_CODEX], ENDPOINT);
    assert.equal(ambiente.ORK_TELEMETRIA_OTLP_HEADER_0, CABECALHO);
    assert.equal(ambiente.OPENAI_API_KEY, undefined);

    assert.throws(() => RUNTIMES.codex.montarComando({ prompt: 'x', nome: 'x', cwd: projeto.dir,
      telemetria: { runtime: 'claude-bg', settingsEnv: {} } }), /configuração Claude Code no Codex/);
    assert.throws(() => RUNTIMES['claude-bg'].montarComando({ prompt: 'x', nome: 'x', cwd: projeto.dir,
      telemetria: { runtime: 'codex', argumentos: [], ambiente: {} } }), /configuração Codex no Claude Code/);
  } finally { projeto.limpar(); }
});

test('rodarFase persiste a identidade nativa devolvida por cada sessão simulada antes de mapear o vínculo', () => {
  const projeto = projetoTemporario('telemetria-phase-identidade');
  const codex = controllerSimulado(projeto.dir);
  const claude = runtimeFalso('telemetria-phase-identidade');
  const chaves = ['ORK_USUARIO_DIR', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_LOGS_HEADERS'];
  const ambienteAnterior = Object.fromEntries(chaves.map(chave => [chave, process.env[chave]]));
  let controladorCodex: string | undefined;
  try {
    process.env.ORK_USUARIO_DIR = path.join(projeto.dir, 'usuario-privado');
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = `authorization=${CABECALHO}`;
    gravarAtivacaoTelemetria(true, process.env, () => PSEUDONIMO);

    const despachar = (runtime: 'claude-bg' | 'codex') => {
      const thread = novaThread(projeto.carregado, { nome: `identidade-${runtime}`, modo: 'auto' }).thread;
      const resultado = rodarFase(projeto.carregado, thread.id, {
        fase: 'GOAL', runtime, prompt: runtime === 'codex' ? 'FINALIZAR-SIMULADO' : 'identidade Claude simulada',
        ...(runtime === 'codex' ? { model: 'modelo-SIMULADO' } : {}),
      });
      assert.equal(resultado.bloqueado, false, resultado.erro);
      assert.ok(resultado.sessionId, `sessão ${runtime} sem identidade nativa`);
      const eventos = lerLedger(dirThread(projeto.dir, thread.id)).filter(e => e.tipo === 'phase_dispatch');
      assert.equal(eventos.length, 1, `uma sessão ${runtime} produz um vínculo`);
      const evento = eventos[0];
      assert.equal(evento.sessionId, resultado.sessionId,
        'concluirDespacho deve persistir o resultado.sessionId devolvido pela sessão simulada');
      const registro = mapearEventoDoLedger(evento, {
        serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: PSEUDONIMO,
        redigir: (texto: string) => ({ ok: true as const, texto }),
        observadoEmNano: () => 1_800_000_000_000_000_000n,
      }).registro!;
      const attrs = atributos(registro), atributoNativo = runtime === 'codex' ? 'conversation.id' : 'session.id';
      assert.deepEqual(attrs[atributoNativo], { stringValue: resultado.sessionId });
      assert.equal(registro.eventName, 'orkastery.ledger.phase_dispatch');
      assert.deepEqual(attrs['orkastery.thread.id'], { stringValue: thread.id });
      assert.deepEqual(attrs['orkastery.phase.name'], { stringValue: 'GOAL' });
      assert.deepEqual(attrs['orkastery.runtime.name'], { stringValue: runtime });
      assert.deepEqual(attrs['user.hash'], { stringValue: PSEUDONIMO });
      return resultado;
    };

    const resultadoCodex = despachar('codex');
    controladorCodex = resultadoCodex.controlador;
    const metaCodex = JSON.parse(fs.readFileSync(codex.rollout, 'utf8').split('\n')[0]);
    assert.equal(resultadoCodex.sessionId, metaCodex.payload.id,
      'o vínculo Codex usa a identidade devolvida pelo app-server simulado');

    const resultadoClaude = despachar('claude-bg');
    assert.equal(resultadoClaude.sessionId, claude.sessionId,
      'o vínculo Claude usa a identidade devolvida pelo binário simulado');
  } finally {
    if (controladorCodex && fs.existsSync(path.join(controladorCodex, 'launch.json'))) {
      const launch = JSON.parse(fs.readFileSync(path.join(controladorCodex, 'launch.json'), 'utf8'));
      try { encerrarController(controladorCodex, launch.vinculo, launch.instancia, 8000); } catch { /* já terminal */ }
    }
    projeto.limpar();
    claude.restaurar();
    codex.restaurar();
    for (const [chave, valor] of Object.entries(ambienteAnterior)) {
      if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
    }
  }
});

test('Codex sem telemetria preserva estritamente argv e ambiente nos três caminhos desligados', () => {
  const base = { HOME: '/tmp/casa-simulada', PATH: '/bin', CODEX_HOME: '/tmp/codex-simulado' };
  const pedido: Pick<DespachoCodexPedido, 'perfil' | 'ambienteExtra' | 'telemetria'> = {};
  const referencia = {
    argv: comandoCodexAppServer(),
    ambiente: ambienteDoFilho(pedido, base),
  };
  const casos = [
    ['sem configuração', resolverTelemetriaDoRuntime('codex', {
      thread: 'ork-exemplo', fase: 'GO', dispatchId: 'sem-configuracao',
    }, {}, { ativacao: () => ({ ligada: false, origem: 'ausente', motivo: 'ausente', pseudonimo: null }),
      destino: () => { throw new Error('destino não deve ser consultado'); } })],
    ['desligada', resolverTelemetriaDoRuntime('codex', {
      thread: 'ork-exemplo', fase: 'GO', dispatchId: 'desligada',
    }, {}, { ativacao: () => ({ ligada: false, origem: 'builder', motivo: 'desligada', pseudonimo: PSEUDONIMO }),
      destino: () => { throw new Error('destino não deve ser consultado'); } })],
  ] as const;

  for (const [nome, telemetria] of casos) {
    assert.equal(telemetria, undefined, nome);
    const atual = {
      argv: comandoCodexAppServer(telemetria),
      ambiente: ambienteDoFilho({ ...pedido, telemetria }, base),
    };
    assert.deepEqual(atual.argv, referencia.argv, `${nome}: argv idêntico à referência sem o módulo`);
    assert.deepEqual(atual.ambiente, referencia.ambiente, `${nome}: ambiente idêntico à referência sem o módulo`);
  }
  for (const argv of [referencia.argv, ...casos.map(([, telemetria]) => comandoCodexAppServer(telemetria))]) {
    assert.equal(argv.some(arg => arg.includes('otel.')), false, 'argv desligado não contém chave otel.');
  }
  for (const ambiente of [referencia.ambiente,
    ...casos.map(([, telemetria]) => ambienteDoFilho({ ...pedido, telemetria }, base))]) {
    assert.equal(Object.keys(ambiente).some(chave => chave.startsWith('ORK_TELEMETRIA_') || chave.startsWith('OTEL_')),
      false, 'ambiente desligado não contém ORK_TELEMETRIA_ nem OTEL_');
  }
});

test('phase aplica telemetria Claude somente quando resolvida e o adapter limpa settings em sucesso e falha', () => {
  const projeto = projetoTemporario('telemetria-phase');
  const runtime = runtimeFalso('telemetria-phase');
  const chaves = ['ORK_USUARIO_DIR', 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_EXPORTER_OTLP_LOGS_HEADERS'];
  const ambienteAnterior = Object.fromEntries(chaves.map(chave => [chave, process.env[chave]]));
  try {
    process.env.ORK_USUARIO_DIR = path.join(projeto.dir, 'usuario-privado');
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = `authorization=${CABECALHO}`;
    gravarAtivacaoTelemetria(true, process.env, () => PSEUDONIMO);
    const config = caminhoConfigTelemetria(process.env);
    const configAntes = fs.readFileSync(config, 'utf8');

    const ativa = novaThread(projeto.carregado, { nome: 'telemetria-ativa', modo: 'auto' }).thread;
    const resultado = rodarFase(projeto.carregado, ativa.id, {
      fase: 'GOAL', runtime: 'claude-bg', prompt: 'telemetria ativa hermética',
    });
    assert.equal(resultado.bloqueado, false, resultado.erro);
    assert.equal(resultado.sessionId, runtime.sessionId);
    const caminhoDoSettings = fs.readFileSync(path.join(runtime.dir, 'settings'), 'utf8');
    assert.equal(fs.existsSync(caminhoDoSettings), false, 'settings 0600 removidos depois do sucesso');
    const eventoAtivo = lerLedger(dirThread(projeto.dir, ativa.id)).find(e => e.tipo === 'phase_dispatch')!;
    assert.ok((eventoAtivo.comando as string[]).includes('<telemetria:redigida>'));

    delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS;
    const opcional = novaThread(projeto.carregado, { nome: 'telemetria-opcional', modo: 'auto' }).thread;
    const semDestino = rodarFase(projeto.carregado, opcional.id, {
      fase: 'GOAL', runtime: 'claude-bg', prompt: 'telemetria opcional sem destino',
    });
    assert.equal(semDestino.bloqueado, false, semDestino.erro);
    assert.equal(semDestino.motivo, null, 'falha da telemetria opcional não interrompe o trabalho');
    const argumentoSettings = semDestino.comando[semDestino.comando.indexOf('--settings') + 1] ?? '';
    assert.equal(argumentoSettings.includes('OTEL_'), false);

    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = `authorization=${CABECALHO}`;
    runtime.proximoDespachoMorreDeRateLimit('Claude AI usage limit reached|4102444800\n');
    const telemetria = prepararTelemetriaDoRuntime('claude-bg', {
      thread: ativa.id, fase: 'GOAL', dispatchId: 'dispatch-falha',
    }, ATIVACAO, DESTINO);
    assert.equal(telemetria?.runtime, 'claude-bg');
    const falha = despacharClaude({ prompt: 'falha hermética', nome: 'falha-settings', cwd: projeto.dir,
      telemetria });
    assert.equal(falha.ok, false);
    const settingsDaFalha = fs.readFileSync(path.join(runtime.dir, 'settings'), 'utf8');
    assert.equal(fs.existsSync(settingsDaFalha), false, 'settings 0600 removidos depois da falha');
    assert.equal(fs.readFileSync(config, 'utf8'), configAntes, 'despachos não reescrevem configuração global');
  } finally {
    projeto.limpar();
    runtime.restaurar();
    for (const [chave, valor] of Object.entries(ambienteAnterior)) {
      if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
    }
  }
});

/** Testes do adapter claude-bg: comando, extracao de sessionId e limpeza de log. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { dirTemporario } from './apoio';
import { CAMINHO_SETTINGS_EFEMEROS, criarSettingsEfemeros, extrairSessionId, limparAnsi, montarComando,
  settingsDoDespacho } from '../src/adapters/claude-bg';

test('o comando de despacho usa --bg com prompt inline e --name com o slug', () => {
  const cmd = montarComando({
    prompt: 'faca X',
    nome: 'ork-coreb0-full',
    cwd: '/tmp/projeto',
    model: 'fable',
    effort: 'high',
  });
  assert.deepEqual(cmd, [
    'claude',
    '--bg',
    'faca X',
    '--name',
    'ork-coreb0-full',
    '--model',
    'fable',
    '--effort',
    'high',
  ]);
});

test('o adapter nunca usa os mecanismos reprovados (-p, -i, remote-control)', () => {
  const cmd = montarComando({ prompt: 'p', nome: 'ork-x-goal', cwd: '/tmp' });
  assert.equal(cmd.includes('-p'), false);
  assert.equal(cmd.includes('--print'), false);
  assert.equal(cmd.includes('-i'), false);
  assert.equal(cmd.includes('remote-control'), false);
  assert.equal(cmd[1], '--bg');
});

test('I-34: PLAN claude-bg roda sem plan mode, sem subagente e com escrita de arquivo negada', () => {
  const cmd = montarComando({ prompt: 'planeje', nome: 'ork-x-plan', cwd: '/tmp', colaboracao: 'plan' });
  assert.deepEqual(cmd, ['claude', '--bg', 'planeje', '--name', 'ork-x-plan', '--disallowedTools', 'Edit,Write,NotebookEdit']);
  assert.equal(cmd.includes('--permission-mode'), false);
  assert.equal(cmd.includes('--agent'), false);
  assert.deepEqual(montarComando({ prompt: 'faca', nome: 'ork-x-go', cwd: '/tmp', colaboracao: 'default' }),
    ['claude', '--bg', 'faca', '--name', 'ork-x-go']);
});

test('telemetria Claude vence valores permissivos e usa settings privados fora do argv', () => {
  const base = dirTemporario('settings-telemetria');
  const pedido = {
    prompt: 'faca', nome: 'ork-x-go', cwd: '/tmp',
    ambienteExtra: {
      OTEL_LOG_USER_PROMPTS: '1', OTEL_LOG_ASSISTANT_RESPONSES: '1',
      OTEL_LOG_TOOL_DETAILS: '1', OTEL_LOG_TOOL_CONTENT: '1', OTEL_TRACES_EXPORTER: 'otlp',
    },
    telemetria: { runtime: 'claude-bg' as const, settingsEnv: {
      OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_ASSISTANT_RESPONSES: '0',
      OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_TOOL_CONTENT: '0', OTEL_TRACES_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'authorization=VALOR-SINTETICO',
    } },
  };
  const settings = settingsDoDespacho(pedido)! as { env: Record<string, string> };
  assert.deepEqual(Object.fromEntries(Object.entries(settings.env).filter(([chave]) =>
    chave.startsWith('OTEL_LOG_') || chave === 'OTEL_TRACES_EXPORTER')), {
    OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_ASSISTANT_RESPONSES: '0',
    OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_TOOL_CONTENT: '0', OTEL_TRACES_EXPORTER: 'none',
  });
  const comando = montarComando(pedido);
  assert.equal(comando[comando.indexOf('--settings') + 1], CAMINHO_SETTINGS_EFEMEROS);
  assert.equal(comando.join(' ').includes('VALOR-SINTETICO'), false);

  const efemero = criarSettingsEfemeros(settings, base);
  assert.equal(fs.statSync(efemero.caminho).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(efemero.caminho, 'utf8'), /VALOR-SINTETICO/);
  efemero.limpar();
  assert.equal(fs.existsSync(efemero.caminho), false);
  fs.rmdirSync(base);
});

test('extracao do sessionId aceita UUID e id curto', () => {
  assert.equal(
    extrairSessionId('Started background session 64c42912-193a-4f40-93d0-75250e698ea1'),
    '64c42912-193a-4f40-93d0-75250e698ea1'
  );
  assert.equal(extrairSessionId('id: 64c42912'), '64c42912');
  assert.equal(extrairSessionId('nenhum identificador aqui'), null);
});

test('a limpeza de log transforma movimento de cursor em quebra de linha', () => {
  const ESC = '\u001b';
  const bruto = `${ESC}[2J${ESC}[Hlinha um${ESC}[1Blinha dois${ESC}[0m`;
  const limpo = limparAnsi(bruto);
  assert.ok(limpo.includes('linha um'));
  assert.ok(limpo.includes('linha dois'));
  assert.ok(limpo.split('\n').length >= 2, 'esperado mais de uma linha');
  assert.equal(limpo.includes(ESC), false, 'nenhuma sequencia ANSI sobra');
});

test('o posicionamento de coluna volta como espaco, em vez de colar as palavras', () => {
  const ESC = '\u001b';
  // Trecho REAL do `claude logs` da sessao a1f0ea54 em 05/09/2026: o runtime nao escreve
  // espaco nenhum, ele anda ate a coluna com CHA (`ESC[<n>G`). Engolir a sequencia
  // devolvia `2newMCPserversfoundinthisproject`, e ai nenhuma frase era reconhecivel.
  const bruto = `${ESC}[3G${ESC}[1m2${ESC}[5Gnew${ESC}[9GMCP${ESC}[13Gservers${ESC}[21Gfound${ESC}[22m`;
  const limpo = limparAnsi(bruto);
  assert.equal(limpo.trim(), '2 new MCP servers found');
  assert.equal(limpo.includes(ESC), false, 'nenhuma sequencia ANSI sobra');
});

test('coluna que anda para tras separa os pedacos, sem apagar o que ja estava na linha', () => {
  const ESC = '\u001b';
  // O runtime reescreve trecho da tela: a coluna alvo fica ATRAS do que ja foi desenhado.
  // Errar o alinhamento e aceitavel; colar duas palavras que nunca foram uma so, nao.
  const limpo = limparAnsi(`${ESC}[10Gprimeiro${ESC}[2Gsegundo`);
  assert.equal(limpo.trim(), 'primeiro segundo');
});

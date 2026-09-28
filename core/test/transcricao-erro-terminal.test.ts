/**
 * I-33 (N3 e N4 do CHECK-REVERIFY 8924757a): na transcricao claude-bg o criterio unico da D16 roda sobre
 * o erro de API que encerrou a sessao (o ultimo), nunca sobre os anteriores juntos (N3), e o trecho
 * gravado no ledger e a frase que classificou, limitada e sem segredo (N4). As linhas seguem
 * o formato real do Claude Code 2.1.278 (`message` com metadados antes de `content`, `apiError`,
 * `apiErrorStatus`, `errorDetails`), e os textos sao os reais do binario e das transcricoes locais.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario, runtimePorConta } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { parseFalhaDeConta } from '../src/adapters/claude-bg';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { lerPerfis } from '../src/runtime-profiles';
import { falhaDeContaDaTranscricao } from '../src/session-watcher-claude';
import { dirThread, novaThread } from '../src/thread';

/** Linha de erro de API no formato REAL da transcricao do Claude Code (metadados antes do texto). */
function linhaDeErroReal(error: string, texto: string, status: number | null = 429): string {
  return JSON.stringify({
    parentUuid: null, isSidechain: false, type: 'assistant', uuid: '0f0e0d0c-0000-4000-8000-000000000001',
    timestamp: '2026-09-19T12:00:00.000Z',
    message: { diagnostics: null, id: 'a84cbc1d-0000-4000-8000-000000000002', container: null, model: '<synthetic>', role: 'assistant',
      stop_details: null, stop_reason: 'stop_sequence', stop_sequence: '', type: 'message',
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: null },
      content: [{ type: 'text', text: texto }], context_management: null },
    error, apiError: null, apiErrorStatus: status, errorDetails: null, isApiErrorMessage: true,
  });
}
const linhaDoAgente = (texto: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texto }] } });

function gravarTranscricao(conta: string, cwd: string, sessionId: string, linhas: string[]): void {
  const pasta = path.join(conta, 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${sessionId}.jsonl`), linhas.join('\n') + '\n');
}

// Textos reais: transcricao local (limite do plano) e binario do Claude Code 2.1.278 (429 transitorio).
const PLANO = "You've reached your Fable limit. Run /usage-credits to continue or switch models with /model.";
const REJEITADO_429 = 'API Error: Request rejected (429)';
const LIMITANDO = 'API Error: Server is temporarily limiting requests (not your usage limit)';
const SEM_CREDITO = 'Credit balance is too low';
const SESSAO = '12345678-aaaa-4bbb-8ccc-1234567890ab';

function classificar(linhas: string[]): ReturnType<typeof falhaDeContaDaTranscricao> {
  const raiz = dirTemporario('n3-transcricao');
  try {
    const conta = path.join(raiz, 'conta');
    gravarTranscricao(conta, raiz, SESSAO, linhas);
    return falhaDeContaDaTranscricao({ id: 'a', runtime: 'claude-bg', configDir: conta }, raiz, SESSAO);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
}

test('N3 transcricao: 429 transitorio no meio e limite do plano no fim: vale o limite que encerrou a sessao', () => {
  const falha = classificar([linhaDeErroReal('rate_limit', REJEITADO_429), linhaDoAgente('continuando a fatia'),
    linhaDeErroReal('rate_limit', PLANO)]);
  assert.equal(falha?.motivo, 'runtime.quota-exhausted');
});

test('N3 transcricao: esgotamento superado no meio e 429 transitorio no fim: vale o 429, sem motivo da conta', () => {
  assert.equal(classificar([linhaDeErroReal('billing_error', SEM_CREDITO, 400), linhaDoAgente('seguindo depois do reset'),
    linhaDeErroReal('rate_limit', LIMITANDO)]), null);
  assert.equal(classificar([linhaDeErroReal('rate_limit', PLANO), linhaDeErroReal('rate_limit', REJEITADO_429)]), null);
});

test('N3 transcricao: erro unico segue o criterio (positivo), e linha do agente nunca conta', () => {
  assert.equal(classificar([linhaDeErroReal('rate_limit', PLANO)])?.motivo, 'runtime.quota-exhausted');
  assert.equal(classificar([linhaDeErroReal('billing_error', SEM_CREDITO, 400)])?.motivo, 'runtime.quota-exhausted');
  assert.equal(classificar([linhaDeErroReal('rate_limit', LIMITANDO)]), null);
  assert.equal(classificar([linhaDeErroReal('rate_limit', PLANO), linhaDoAgente(REJEITADO_429)])?.motivo, 'runtime.quota-exhausted');
});

test('N3 observador: sessao que morre por 429 transitorio depois de um esgotamento superado nao tira o perfil do rodizio', () => {
  const p = projetoTemporario('n3-observador');
  const claude = runtimePorConta('n3');
  try {
    const contaA = claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'n3', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    gravarTranscricao(contaA, p.dir, r.sessionId as string, [linhaDeErroReal('billing_error', SEM_CREDITO, 400),
      linhaDoAgente('seguindo depois do reset'), linhaDeErroReal('rate_limit', LIMITANDO)]);
    claude.estadoDaSessao('failed');
    esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result')!;
    assert.equal(resultado.motivo, 'runtime.unavailable', 'o 429 transitorio do fim nao vira motivo da conta');
    assert.equal(resultado.falhaDeConta, undefined);
    assert.deepEqual(lerPerfis(p.dir).perfis.map(q => [q.id, q.estado]), [['a', 'ativo'], ['b', 'ativo']]);
  } finally { p.limpar(); claude.restaurar(); }
});

// ---------------------------------------------------------------------------
// N4: o trecho gravado no gate, no phase_result e no runtime_profile_rotated e a frase que classificou.
// ---------------------------------------------------------------------------

const METADADOS = /diagnostics|<synthetic>|stop_reason|a84cbc1d/;

test('N4 trecho: na linha real da transcricao o trecho e o codigo e a frase, sem os metadados do JSON', () => {
  const falha = classificar([linhaDeErroReal('rate_limit', PLANO)]);
  assert.equal(falha?.trecho, `rate_limit: ${PLANO}`);
  assert.doesNotMatch(falha?.trecho ?? '', METADADOS);
  const credito = classificar([linhaDeErroReal('billing_error', SEM_CREDITO, 400)]);
  assert.equal(credito?.trecho, `billing_error: ${SEM_CREDITO}`);
});

test('N4 trecho: limitado a 200 caracteres com a frase dentro, e segredo redigido', () => {
  const longo = parseFalhaDeConta(`${'x'.repeat(300)} Your workspace is out of credits. Add credits to continue.`);
  assert.equal(longo?.motivo, 'runtime.quota-exhausted');
  assert.ok((longo?.trecho.length ?? 0) <= 200, longo?.trecho);
  assert.match(longo?.trecho ?? '', /Your workspace is out of credits/);
  const curto = parseFalhaDeConta('usage_limit_exceeded: Your workspace is out of credits. Add credits to continue.');
  assert.equal(curto?.trecho, 'usage_limit_exceeded: Your workspace is out of credits. Add credits to continue.', 'linha curta nao muda');
  const chave = 'sk-ant-api03-' + 'FALSO'.repeat(6);
  const comChave = classificar([linhaDeErroReal('billing_error', `${SEM_CREDITO} (key ${chave})`, 400)]);
  assert.equal(comChave?.motivo, 'runtime.quota-exhausted');
  assert.equal((comChave?.trecho ?? '').includes(chave), false, comChave?.trecho);
  assert.match(comChave?.trecho ?? '', /\[redigido\]/);
});

test('N4 observador e retry: gate, phase_result e runtime_profile_rotated levam a frase que tirou o perfil do rodizio', () => {
  const p = projetoTemporario('n4-observador');
  const claude = runtimePorConta('n4');
  try {
    const contaA = claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b');
    const t = novaThread(p.carregado, { nome: 'n4', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    gravarTranscricao(contaA, p.dir, r.sessionId as string, [linhaDeErroReal('rate_limit', PLANO)]);
    claude.estadoDaSessao('failed');
    esperarCondicao(() => lerLedger(dir).some(e => e.tipo === 'phase_result'), 20000);
    const resultado = lerLedger(dir).find(e => e.tipo === 'phase_result')!;
    assert.equal(resultado.motivo, 'runtime.quota-exhausted');
    const gate = lerLedger(dir).filter(e => e.tipo === 'gate_blocked').at(-1)!;
    for (const [onde, trecho] of [['phase_result', (resultado.falhaDeConta as { trecho: string }).trecho],
      ['gate_blocked', (gate.falhaDeConta as { trecho: string }).trecho]] as const) {
      assert.ok(trecho.includes("You've reached your Fable limit"), `${onde}: ${trecho}`);
      assert.doesNotMatch(trecho, METADADOS, onde);
    }
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.executada, true, retry.detalhe);
    const rotacao = lerLedger(dir).find(e => e.tipo === 'runtime_profile_rotated')!;
    assert.ok(String(rotacao.evidencia).includes("You've reached your Fable limit"), String(rotacao.evidencia));
    assert.doesNotMatch(String(rotacao.evidencia), METADADOS);
  } finally { p.limpar(); claude.restaurar(); }
});

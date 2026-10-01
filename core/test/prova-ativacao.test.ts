import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { runMaestroCli } from '../src/maestro-cli';
import { discoverMaestro } from '../src/maestro-discovery';
import { conferirProva, EsperadoDaProva, extrairSnapshot, redigir, transcriptDoClaude, transcriptDoOpenclaw } from '../src/prova-ativacao';

function snapshotDe(dir: string): string {
  let saida = '';
  assert.equal(runMaestroCli(['--json'], dir, {}, { out: s => { saida += s; }, err: s => assert.fail(s) }), 0);
  return saida;
}
function esperadoDe(dir: string): EsperadoDaProva {
  const ctx = discoverMaestro({ cwd: dir, pinned: dir, countOtherProjects: false });
  return { projeto: { nome: ctx.project.name, id: ctx.project.id, raiz: ctx.root, fingerprint: ctx.fingerprint }, home: os.homedir() };
}
const ok = (r: ReturnType<typeof conferirProva>, id: string) => r.conferencias.find(c => c.id === id);

function streamClaude(opcoes: { ferramenta?: string; entrada?: unknown; resultado?: string; erro?: boolean; resposta?: string; expostas?: string[] }): string {
  const ferramenta = opcoes.ferramenta ?? 'mcp__orkastery__ork_maestro';
  return [
    { type: 'system', subtype: 'init', tools: opcoes.expostas ?? ['Bash', 'Skill', 'ToolSearch', 'mcp__orkastery__ork_maestro'] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'orkastery:orkastery-bootstrap' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: ferramenta, input: opcoes.entrada ?? {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: opcoes.erro === true,
      content: [{ type: 'text', text: opcoes.resultado ?? '' }] }] } },
    { type: 'result', subtype: 'success', result: opcoes.resposta ?? 'Panorama Maestro do projeto orkastery: nada em andamento.' },
  ].map(e => JSON.stringify(e)).join('\n') + '\n';
}

test('Claude: ork_maestro pelo MCP com snapshot do projeto esperado passa em todas as conferências', () => {
  const p = projetoTemporario('prova-claude-ok');
  try {
    const r = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: snapshotDe(p.dir) })), esperadoDe(p.dir));
    assert.equal(r.ok, true, JSON.stringify(r.conferencias));
    assert.deepEqual(r.conferencias.map(c => c.id), ['entrada.exposta', 'entrada.chamada', 'resultado.sem-erro', 'resultado.contrato',
      'resultado.projeto', 'resultado.nao-consultado', 'resposta.cita-projeto', 'resposta.sem-roadmap-vazio']);
    assert.equal(r.snapshot?.projeto.name, 'orkastery');
    assert.equal(r.snapshot?.secoes.threads, 'empty');
  } finally { p.limpar(); }
});

test('Claude: `ork maestro` pelo Bash é desvio do contrato, não sucesso', () => {
  const p = projetoTemporario('prova-claude-desvio');
  try {
    const t = transcriptDoClaude(streamClaude({ ferramenta: 'Bash', entrada: { command: 'ork maestro --json' }, resultado: snapshotDe(p.dir) }));
    assert.equal(t.chamadas[0].via, 'shell');
    const r = conferirProva('claude-code', t, esperadoDe(p.dir));
    assert.equal(r.ok, false);
    assert.match(ok(r, 'entrada.chamada')!.detalhe, /desvio: Bash "ork maestro --json" em vez de mcp__orkastery__ork_maestro/);
    assert.equal(r.snapshot, null);
  } finally { p.limpar(); }
});

test('Claude: resultado com erro e snapshot fora do contrato reprovam', () => {
  const p = projetoTemporario('prova-claude-erro');
  try {
    const esperado = esperadoDe(p.dir);
    const comErro = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: 'maestro.project.missing', erro: true })), esperado);
    assert.equal(ok(comErro, 'resultado.sem-erro')!.ok, false);
    const snap = JSON.parse(snapshotDe(p.dir)); snap.extra = true;
    const fora = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: JSON.stringify(snap) })), esperado);
    assert.equal(ok(fora, 'resultado.contrato')!.ok, false);
    assert.match(ok(fora, 'resultado.contrato')!.detalhe, /fora do contrato/);
  } finally { p.limpar(); }
});

test('projeto errado (o incidente: outra cópia ou o workspace do gateway) reprova pela impressão digital', () => {
  const certo = projetoTemporario('prova-certo');
  const outro = projetoTemporario('prova-outro');
  try {
    // Mesmo nome de projeto nas duas cópias: só a impressão digital separa uma da outra.
    const r = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: snapshotDe(outro.dir) })), esperadoDe(certo.dir));
    assert.equal(ok(r, 'resultado.projeto')!.ok, false);
    assert.equal(ok(r, 'resultado.contrato')!.ok, true);
    const snap = JSON.parse(snapshotDe(certo.dir)); snap.project.name = 'workspace';
    const ws = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: JSON.stringify(snap) })), esperadoDe(certo.dir));
    assert.match(ok(ws, 'resultado.projeto')!.detalhe, /leu workspace/);
    assert.equal(ok(ws, 'resultado.projeto')!.ok, false);
  } finally { certo.limpar(); outro.limpar(); }
});

test('resposta que conclui "roadmap vazio", sem o projeto ou sem notConsulted reprova', () => {
  const p = projetoTemporario('prova-resposta');
  try {
    const esperado = esperadoDe(p.dir);
    const vazio = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: snapshotDe(p.dir),
      resposta: 'Projeto orkastery: 0 threads, o roadmap está vazio.' })), esperado);
    assert.equal(ok(vazio, 'resposta.sem-roadmap-vazio')!.ok, false);
    const anonimo = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: snapshotDe(p.dir), resposta: 'Nada em andamento.' })), esperado);
    assert.equal(ok(anonimo, 'resposta.cita-projeto')!.ok, false);
    const snap = JSON.parse(snapshotDe(p.dir)); delete snap.notConsulted;
    const semLacuna = conferirProva('claude-code', transcriptDoClaude(streamClaude({ resultado: JSON.stringify(snap) })), esperado);
    assert.equal(ok(semLacuna, 'resultado.nao-consultado')!.ok, false);
  } finally { p.limpar(); }
});

function trajetoria(nome: string, args: unknown, texto: string, sucesso = true): string {
  return [
    { source: 'transcript', type: 'tool.call', data: { toolCallId: 'c1', name: nome, arguments: args } },
    { source: 'runtime', type: 'tool.call', data: { toolCallId: 'c1', name: nome, args } },
    { source: 'runtime', type: 'tool.result', data: { toolCallId: 'c1', name: nome, success: sucesso, result: { content: [{ type: 'text', text: texto }] } } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n';
}
const agente = (texto: string, expostas: string[]) => ({ payloads: [{ text: texto, mediaUrl: null }],
  meta: { systemPromptReport: { tools: { entries: expostas.map(name => ({ name })) } } } });

test('OpenClaw: ork_maestro da extensão, com aviso do host antes do JSON, passa', () => {
  const p = projetoTemporario('prova-openclaw-ok');
  try {
    const t = transcriptDoOpenclaw(trajetoria('ork_maestro', {}, 'aviso do ork\n' + snapshotDe(p.dir)),
      agente('Panorama do orkastery: limpo.', ['exec', 'read', 'ork_maestro', 'ork_roadmap_status']));
    assert.equal(t.chamadas.length, 1, 'o evento da origem transcript não duplica a chamada');
    const r = conferirProva('openclaw', t, esperadoDe(p.dir));
    assert.equal(r.ok, true, JSON.stringify(r.conferencias));
  } finally { p.limpar(); }
});

test('OpenClaw: extensão sem procedência aceita não expõe ork_maestro e a frase não chega ao Maestro', () => {
  const p = projetoTemporario('prova-openclaw-sem');
  try {
    const t = transcriptDoOpenclaw('', agente('Não sei o que "orkastery maestro" significa.', ['exec', 'read', 'web_search']));
    const r = conferirProva('openclaw', t, esperadoDe(p.dir));
    assert.equal(r.ok, false);
    assert.match(ok(r, 'entrada.exposta')!.detalhe, /ork_maestro ausente entre 3 ferramentas/);
    assert.equal(ok(r, 'entrada.chamada')!.ok, false);
    const desvio = conferirProva('openclaw', transcriptDoOpenclaw(trajetoria('exec', { command: 'ork maestro --json' }, snapshotDe(p.dir)),
      agente('orkastery', ['exec', 'ork_maestro'])), esperadoDe(p.dir));
    assert.match(ok(desvio, 'entrada.chamada')!.detalhe, /desvio: exec/);
  } finally { p.limpar(); }
});

test('extrairSnapshot respeita chaves dentro de texto e ignora lixo em volta', () => {
  const obj = { schema: 'ork.maestro-snapshot/v1', x: 'a } { b "c"', y: { z: 1 } };
  assert.deepEqual(extrairSnapshot('antes\n' + JSON.stringify(obj) + '\ndepois {'), obj);
  assert.equal(extrairSnapshot('sem snapshot'), null);
  assert.equal(extrairSnapshot('{"schema":"ork.maestro-snapshot/v1"'), null);
});

test('redigir tira tokens e valores de chaves com nome de segredo antes de gravar o recibo', () => {
  const texto = JSON.stringify({ apiKey: 'abc123', gateway: { token: 'zzz' }, usage: { inputTokens: 37 }, nome: 'orkastery' }) +
    ' Authorization: Bearer eyJhbGciOi.abc.def sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA sk-or-v1-0123456789abcdef ghp_0123456789abcdefghijABCD';
  const r = redigir(texto);
  for (const segredo of ['abc123', 'zzz', 'eyJhbGciOi', 'sk-ant-oat01', 'sk-or-v1', 'ghp_0123']) assert.ok(!r.includes(segredo), segredo);
  assert.ok(r.includes('"inputTokens":37'), 'número não é segredo');
  assert.ok(r.includes('"nome":"orkastery"'));
});

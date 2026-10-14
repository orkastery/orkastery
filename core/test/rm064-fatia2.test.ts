import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { hashDoPrompt, montarPrompt } from '../src/phase';
import { prepararPromptDeRetomada } from '../src/retomada-checkpoint';
import { dirThread, novaThread } from '../src/thread';
import { diretorioDoTrabalho, LIMITE_DE_ARQUIVO_DO_TRABALHO } from '../src/trabalho-thread';
import { passosDaBatida } from '../src/conducao-batida';
import { PassoDoCondutor } from '../src/conducao-sentinela';
import { checarSeparacaoDaConducao } from '../src/doctor';
import { InventarioDeSessoes } from '../src/sessoes-inventario';

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

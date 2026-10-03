/**
 * RM-047 (fronteira de confiança): os pendentes da seção 6 da matriz depois do #76.
 *
 * - P2 (resto): os ponteiros do recall e do handoff só leem arquivo dentro do projeto;
 * - P3: `worktree.dir` do manifesto não cria checkout fora da raiz sem a confirmação da máquina;
 * - P4: `ork eval` não executa o catálogo achado a partir do cwd;
 * - P5: `fabrica.compartilhada` do manifesto não liga a publicação desta máquina.
 *
 * Este arquivo usa só a API que já existia antes da correção, para que o mesmo teste rode contra o
 * código anterior e reprove nele.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirTemporario } from '../src/sandbox';
import { gravarThread, lerThread, novaThread } from '../src/thread';
import { exportarHandoff, recall } from '../src/handoff';
import { adicionarClaim } from '../src/claims';

/** Um arquivo fora do projeto, com um conteúdo que não pode aparecer em nenhuma saída do `ork`. */
function arquivoDeFora(nome: string): { dir: string; arquivo: string; conteudo: string } {
  const dir = dirTemporario(nome);
  const conteudo = `CONTEUDO-DE-FORA-${nome}\n`;
  const arquivo = path.join(dir, 'de-fora.txt');
  fs.writeFileSync(arquivo, conteudo);
  return { dir, arquivo, conteudo };
}

test('P2: o recall de um ponteiro do handoff.json que sai da raiz recusa com ponteiro.fora-da-raiz', () => {
  const p = projetoTemporario('p2-recall-fora');
  const fora = arquivoDeFora('p2-recall-alvo');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 recall', modo: 'auto' }).thread;
    const relativo = path.relative(p.dir, fora.arquivo);
    assert.ok(relativo.startsWith('..'));
    assert.throws(() => recall(p.carregado, t.id, `${relativo}#tudo`), /^Error: ponteiro\.fora-da-raiz: /);
    assert.throws(() => recall(p.carregado, t.id, `${fora.arquivo}#L1`), /^Error: ponteiro\.fora-da-raiz: /);

    // Dentro do projeto, o mesmo recall segue valendo.
    fs.writeFileSync(path.join(p.dir, 'dentro.txt'), 'dentro\n');
    assert.equal(recall(p.carregado, t.id, 'dentro.txt#tudo').conteudo, 'dentro\n');
  } finally { p.limpar(); fs.rmSync(fora.dir, { recursive: true, force: true }); }
});

test('P2: link simbólico dentro do projeto não leva o recall para fora da raiz', () => {
  const p = projetoTemporario('p2-recall-link');
  const fora = arquivoDeFora('p2-recall-link-alvo');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 recall link', modo: 'auto' }).thread;
    fs.symlinkSync(fora.dir, path.join(p.dir, 'docs-link'));
    assert.throws(() => recall(p.carregado, t.id, 'docs-link/de-fora.txt#tudo'), /^Error: ponteiro\.fora-da-raiz: /);
  } finally { p.limpar(); fs.rmSync(fora.dir, { recursive: true, force: true }); }
});

test('P2: o export do handoff não aponta para arquivo de claim nem prompt fora da raiz', () => {
  const p = projetoTemporario('p2-export-fora');
  const fora = arquivoDeFora('p2-export-alvo');
  try {
    const t = novaThread(p.carregado, { nome: 'p2 export', modo: 'auto' }).thread;
    adicionarClaim(p.dir, t.id, { arquivo: fora.arquivo, alegacao: 'arquivo de fora', verificar: ['true'] });
    adicionarClaim(p.dir, t.id, { arquivo: path.relative(p.dir, fora.arquivo), alegacao: 'relativo de fora', verificar: ['true'] });
    fs.writeFileSync(path.join(p.dir, 'dentro.md'), 'dentro\n');
    adicionarClaim(p.dir, t.id, { arquivo: 'dentro.md', alegacao: 'arquivo de dentro', verificar: ['true'] });
    const thread = lerThread(p.dir, t.id);
    thread.sessoes.push({ ...(thread.sessoes[0] ?? {}), slug: 'sessao-de-fora', fase: 'GOAL', origem: 'despacho',
      promptPath: path.relative(p.dir, fora.arquivo) } as unknown as typeof thread.sessoes[number]);
    gravarThread(p.dir, thread);

    const { handoff, caminho } = exportarHandoff(p.carregado, t.id);
    const locais = handoff.pointers.map(x => x.location);
    assert.ok(locais.includes('dentro.md#tudo'), locais.join(', '));
    assert.ok(!locais.some(l => l.includes('de-fora.txt')), `nenhum ponteiro sai da raiz: ${locais.join(', ')}`);
    // O texto da claim segue inline (é a alegação), mas nenhum arquivo de fora foi lido para virar ponteiro.
    assert.ok(!handoff.pointers.some(x => x.source.includes(path.basename(fora.dir))), 'nenhuma proveniência sai da raiz');
    assert.ok(fs.existsSync(caminho));
  } finally { p.limpar(); fs.rmSync(fora.dir, { recursive: true, force: true }); }
});


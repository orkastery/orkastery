import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { hashDoPrompt } from '../src/phase';
import { prepararPromptDeRetomada } from '../src/retomada-checkpoint';
import { dirThread, novaThread } from '../src/thread';
import { diretorioDoTrabalho, LIMITE_DE_ARQUIVO_DO_TRABALHO } from '../src/trabalho-thread';

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

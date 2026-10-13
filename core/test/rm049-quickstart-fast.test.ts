/**
 * RM-049, achado EN5 do ensaio em ingles de 03/10: o quickstart parava antes do ciclo completo.
 *
 * O quickstart de orkastery.com deriva de `docs/comecar/quickstart.md`, que mostrava os 10 passos no
 * #Classic, mas nao o caminho curto que o leitor novo roda: a primeira thread em #Fast ate fechada.
 * A secao "Atalho" agora traz a sequencia, e esta guarda confere que:
 *
 * - a sequencia vai do `thread new --modo fast` ao `master --aceitar-omissao`, nessa ordem;
 * - cada comando e cada opcao da secao existem na ajuda do binario compilado;
 * - a saida do `runtime.workspace-untrusted` (o `retry run`) esta explicada.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const QUICKSTART = path.join(RAIZ, 'docs', 'comecar', 'quickstart.md');
const BIN = path.resolve(__dirname, '../../dist/index.js');

function secaoAtalho(): string {
  const texto = fs.readFileSync(QUICKSTART, 'utf8');
  const inicio = texto.indexOf('## Atalho: a primeira thread em #Fast');
  assert.ok(inicio >= 0, 'o quickstart tem a secao do atalho em #Fast');
  const fim = texto.indexOf('\n## ', inicio + 4);
  return texto.slice(inicio, fim < 0 ? undefined : fim);
}

function invocacoes(secao: string): string[] {
  const bloco = /```bash\n([\s\S]*?)```/.exec(secao);
  assert.ok(bloco, 'a secao tem o bloco de comandos');
  return bloco[1].split('\n').map((l) => l.replace(/\s+#.*$/, '').trim()).filter((l) => l.startsWith('ork '));
}

test('o atalho vai do thread new em #Fast ate a thread fechada, nessa ordem', () => {
  const linhas = invocacoes(secaoAtalho());
  const esperado = [
    /^ork thread new ".+" --modo fast$/,
    /^ork phase run <thread> GO --prompt /,
    /^ork claims add <thread> \S+ --claim ".+" --verificar ".+"$/,
    /^ork verify <thread>$/,
    /^ork ship <thread> --para main --autorizar-push \S+$/,
    /^ork master <thread> --aceitar-omissao$/,
    /^ork thread status <thread>$/,
  ];
  assert.equal(linhas.length, esperado.length, linhas.join('\n'));
  esperado.forEach((re, i) => assert.match(linhas[i], re));
});

test('cada comando e cada opcao do atalho existem na ajuda do binario', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  const ajuda = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.ok(ajuda.includes('thread new'), 'a ajuda do binario foi lida');
  for (const linha of invocacoes(secaoAtalho())) {
    const palavras = linha.split(/\s+/).slice(1);
    const comando = palavras[1] && /^[a-z]+$/.test(palavras[1]) && !palavras[1].startsWith('<')
      ? `${palavras[0]} ${palavras[1]}` : palavras[0];
    const comandoNaAjuda = ajuda.includes(`  ${comando} `) || ajuda.includes(`  ${palavras[0]} <`);
    assert.ok(comandoNaAjuda, `comando fora da ajuda: ${linha}`);
    for (const opcao of linha.match(/--[a-z-]+/g) ?? []) {
      assert.ok(ajuda.includes(opcao), `opcao fora da ajuda: ${opcao} em ${linha}`);
    }
  }
});

test('o atalho explica a parada por runtime.workspace-untrusted e o retry', () => {
  const secao = secaoAtalho();
  assert.match(secao, /runtime\.workspace-untrusted/);
  assert.match(secao, /ork retry run <thread>/);
  assert.match(secao, /human\.pending/);
});

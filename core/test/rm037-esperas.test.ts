/**
 * RM-037 (ork-rm037esperas): as esperas que nunca terminam. Em 12/10/2026, sessoes de fase esperaram para sempre por
 * verify ou suite mandados para segundo plano com `&` (o processo morreu com a chamada) e por lacos de espera com
 * `pgrep -f` que acham a si mesmos, porque o proprio laco traz o texto procurado. Os nomes comecam por R (a regra).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REGRA_DAS_ESPERAS, valoresDoPrompt } from '../src/phase';
import { renderizar, templateDaFase, threadDeExemplo } from '../src/prompts';
import { exigirCatalogo } from '../src/catalogo';
import { instalarAdaptador } from '../src/hosts';
import { Modo } from '../src/types';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const MODOS_VIVOS: Modo[] = ['classic', 'maestro', 'auto', 'fast'];
const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));

/** Quantas linhas do arquivo trazem a regra inteira. */
function linhasComARegra(arquivo: string): number {
  return fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l.includes(REGRA_DAS_ESPERAS)).length;
}

/** As skills do catalogo que a sessao de fase le (D4): a de entrada das duas instalacoes e as de GO e CHECK. */
const SKILLS_DO_CATALOGO = ['skills/core/orkastery-bootstrap/SKILL.md', 'skills/phases/go-implementation/SKILL.md',
  'skills/phases/check-quality/SKILL.md'];

/** Os seis agentes de fase do Claude Code: a secao "Regras que valem em toda fase" e a mesma neles (D10). */
const AGENTES = ['ork-goal', 'ork-plan', 'ork-go', 'ork-check', 'ork-ship', 'ork-master'].map((a) => `agents/${a}.md`);

/** Os guias dos adaptadores que a sessao de fase le (D4, D10), com a copia de cada um no marketplace do host. */
const GUIAS_DOS_ADAPTADORES: Record<string, string> = {
  'adapters/codex/skills/ork/SKILL.md': 'marketplaces/codex/orkastery/skills/ork/SKILL.md',
  ...Object.fromEntries(AGENTES.map((a) => [`adapters/claude-code/${a}`, `marketplaces/claude-code/orkastery/${a}`])),
};

/** O que a instalacao real de cada host de fase precisa levar com a regra, relativo ao destino da instalacao. */
const INSTALADOS: Record<'claude-code' | 'codex', string[]> = {
  'claude-code': [...SKILLS_DO_CATALOGO, ...AGENTES],
  codex: ['skills/ork/SKILL.md', ...SKILLS_DO_CATALOGO],
};

/** A secao comum dos agentes, do titulo ao fim do arquivo. */
function secaoComum(arquivo: string): string {
  const texto = fs.readFileSync(arquivo, 'utf8');
  return texto.slice(texto.indexOf('## Regras que valem em toda fase'));
}

test('R1: o prompt de toda fase, em todo modo, traz a regra das esperas numa linha so, uma vez, no lugar da linha da N2', () => {
  // Os tres pontos do pedido, um a um, numa linha so.
  for (const trecho of ['nunca dispare verify, build ou suite com `&` dentro do comando',
    'rode o `ork verify` em primeiro plano, com `timeout`', 'use a execucao em segundo plano do host, que avisa quando termina',
    'nunca espere com `pgrep -f` cujo padrao aparece no proprio comando', 'espere pelo arquivo de saida com prazo, ou pelo PID guardado']) {
    assert.ok(REGRA_DAS_ESPERAS.includes(trecho), trecho);
  }
  assert.ok(!REGRA_DAS_ESPERAS.includes('\n'), 'uma linha so');
  let prompts = 0;
  for (const modo of MODOS_VIVOS) {
    for (const fase of threadDeExemplo(modo, 'GO').fases) {
      const linhas = renderizar(templateDaFase(fase), valoresDoPrompt(threadDeExemplo(modo, fase), fase, 'pedido do builder')).split('\n');
      assert.equal(linhas.filter((l) => l === `- ${REGRA_DAS_ESPERAS}`).length, 1, `${modo} ${fase}`);
      assert.equal(linhas.filter((l) => l.includes('pgrep -f')).length, 1, `${modo} ${fase}`);
      assert.equal(linhas.some((l) => l.includes('Verify, build e suite rodam em primeiro plano')), false, 'a linha da N2 saiu');
      prompts++;
    }
  }
  assert.ok(prompts >= 7, `${prompts} prompts`);
  // O que o `ork prompt render` mostra, pelo CLI, fora de qualquer projeto.
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm037-render-'));
  try {
    const env = { ...process.env };
    delete env.ORK_PROJETO;
    delete env.ORK_PROJETO_EXPLICITO;
    const r = spawnSync(process.execPath, [ORK, 'prompt', 'render', '--exemplo', '--fase', 'GO', '--modo', 'auto'],
      { cwd: fora, encoding: 'utf8', env, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split('\n').includes(`- ${REGRA_DAS_ESPERAS}`), r.stdout);
  } finally { fs.rmSync(fora, { recursive: true, force: true }); }
});

test('R2: as skills do catalogo que a sessao de fase le trazem a regra numa linha, uma vez, e as copias dos marketplaces tambem', () => {
  for (const rel of SKILLS_DO_CATALOGO) {
    assert.equal(linhasComARegra(path.join(RAIZ, rel)), 1, rel);
    for (const host of ['claude-code', 'codex']) {
      const copia = path.join(RAIZ, 'marketplaces', host, 'orkastery', rel);
      assert.equal(linhasComARegra(copia), 1, copia);
    }
  }
  // O bootstrap segue no teto do catalogo (D5): a linha nova coube juntando duas linhas do mesmo paragrafo.
  assert.ok(fs.readFileSync(path.join(RAIZ, SKILLS_DO_CATALOGO[0]), 'utf8').split('\n').length <= 120);
});

test('R3: os guias dos adaptadores trazem a regra numa linha, uma vez, e o ork adapter install a leva para o que instala', () => {
  for (const [fonte, copia] of Object.entries(GUIAS_DOS_ADAPTADORES)) {
    assert.equal(linhasComARegra(path.join(RAIZ, fonte)), 1, fonte);
    assert.equal(linhasComARegra(path.join(RAIZ, copia)), 1, copia);
  }
  // A secao que vale em toda fase continua a mesma nos seis agentes, agora com a regra.
  const secoes = AGENTES.map((a) => secaoComum(path.join(RAIZ, 'adapters/claude-code', a)));
  assert.equal(new Set(secoes).size, 1, 'a secao comum dos agentes divergiu');
  assert.ok(secoes[0].includes(`- ${REGRA_DAS_ESPERAS}`));
  // A instalacao real num projeto temporario, nos dois hosts que rodam sessao de fase.
  for (const host of ['claude-code', 'codex'] as const) {
    const projeto = fs.mkdtempSync(path.join(os.tmpdir(), `ork-rm037-inst-${host}-`));
    try {
      const r = instalarAdaptador(host, { projeto, catalogo: RAIZ, orkBin: '/opt/ork/bin/ork' });
      assert.equal(r.ok, true, `${host}: ${JSON.stringify(r)}`);
      for (const rel of INSTALADOS[host]) assert.equal(linhasComARegra(path.join(r.destino, rel)), 1, `${host}: ${rel}`);
    } finally { fs.rmSync(projeto, { recursive: true, force: true }); }
  }
});

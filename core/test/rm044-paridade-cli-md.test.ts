/**
 * RM-044 (deriva de 03/10): `docs/referencia/cli.md` contra a tabela de comandos do parser.
 *
 * O `ork docs verificar` so confere o `fontes.comandos` do frontmatter das paginas de produto; o
 * texto da referencia do CLI ficava de fora. Na madrugada de 03/10 entraram ~50 PRs na CLI e a
 * referencia ficou sem `brain`, `portfolio`, `creation`, `onboarding`, `experiencia`, `mcp`,
 * `docs verificar` e outros. Este teste fecha os dois lados, so lendo arquivos (sem contrato novo):
 *
 *  - toda invocacao `ork <comando> [<subcomando>]` da referencia existe: o comando no despacho do
 *    `main` (core/src/index.ts) e o subcomando na ajuda (`ork --help`), quando o comando declara
 *    subcomandos;
 *  - todo comando e subcomando que a ajuda declara aparece na referencia.
 *
 * O que fica de fora esta nas listas de excecoes abaixo, cada uma com o porque.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { comandosDaAjuda } from '../src/docs';

const RAIZ = path.resolve(__dirname, '../../..');
const ORK = path.join(RAIZ, 'core/dist/index.js');

/**
 * Subcomandos que o parser aceita e a referencia documenta, mas que a ajuda nao declara numa
 * linha propria. Corrigir a ajuda e mudanca de codigo, fora desta thread de docs.
 */
const SUBCOMANDOS_FORA_DA_AJUDA = new Set([
  'gate context', // I-32: leitura para callbacks autenticados, descrita na secao do Maestro
  'master ratificar', // MASTER ratificado: escolha de classe recebida pelo host
  'master audit', // MASTER ratificado: KPIs operacionais
  'audit process', // MASTER ratificado: PR1, PR2 e PR3 no board
  // A ajuda declara estes entre colchetes (`onboarding [show|set <etapa>|reset [etapa]]`), forma
  // que o `comandosDaAjuda` do `docs verificar` nao le como subcomando.
  'onboarding show',
  'onboarding set',
  'onboarding reset',
]);

/** Invocacoes que a referencia mantem como registro historico de comando aposentado. */
const APOSENTADOS_NA_REFERENCIA = new Set([
  'objective new', // I-43: o texto descreve o envelope como ele era; o comando recusa com objective.aposentado
]);

/** Declarados na ajuda que a referencia cita sem o prefixo `ork` (prosa, nao tabela). */
const AJUDA_SEM_LINHA_NA_REFERENCIA = new Set([
  'gate approve', // aposentado: a referencia diz "`gate approve` está aposentado e sempre recusa"
]);

/** Os comandos de primeiro nivel que o `main` despacha: o `switch` e os desvios antes dele. */
export function comandosDoParser(fonte: string): Set<string> {
  const corpo = fonte.slice(fonte.indexOf('export function main('));
  const nomes = new Set<string>();
  for (const m of corpo.matchAll(/case '([a-z][a-z-]*)':|argv\[0\] === '([a-z][a-z-]*)'|comando === '([a-z][a-z-]*)'/g)) {
    nomes.add(m[1] ?? m[2] ?? m[3]);
  }
  return nomes;
}

/** Cada `ork ...` da referencia (codigo inline e linhas de bloco cercado), com a linha. */
export function invocacoes(md: string): { linha: number; texto: string }[] {
  const achadas: { linha: number; texto: string }[] = [];
  let cercado = false;
  md.split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { cercado = !cercado; return; }
    if (cercado) {
      const m = /^\s*(?:\$\s*)?ork\s+(.*)$/.exec(l);
      if (m) achadas.push({ linha: i + 1, texto: m[1] });
      return;
    }
    for (const m of l.matchAll(/`ork ([^`]+)`/g)) achadas.push({ linha: i + 1, texto: m[1] });
  });
  return achadas;
}

/** Comando e subcomandos de uma invocacao; `brain status\|inventory` vira um subcomando cada. */
function cabeca(texto: string): { topo: string; subs: string[] } | null {
  const toks = texto.replace(/"[^"]*"|'[^']*'/g, 'Q').split(/\s+/).filter(Boolean);
  const k = toks[0] === '--projeto' ? 2 : 0;
  const topo = toks[k];
  if (!topo || !/^[a-z][a-z-]*$/.test(topo)) return null;
  const subs = (toks[k + 1] ?? '').split(/\\?\|/).filter((s) => /^[a-z][a-z-]*$/.test(s));
  return { topo, subs };
}

export function derivas(md: string, parser: Set<string>, ajuda: Set<string>): string[] {
  const achados: string[] = [];
  const citados = new Set<string>();
  for (const { linha, texto } of invocacoes(md)) {
    const c = cabeca(texto);
    if (!c) continue;
    citados.add(c.topo);
    if (!parser.has(c.topo)) { achados.push(`cli.md:${linha}: o parser nao tem "ork ${c.topo}"`); continue; }
    const temSubs = [...ajuda].some((x) => x.startsWith(`${c.topo} `));
    for (const sub of c.subs) {
      const par = `${c.topo} ${sub}`;
      citados.add(par);
      if (!temSubs || ajuda.has(par) || SUBCOMANDOS_FORA_DA_AJUDA.has(par) || APOSENTADOS_NA_REFERENCIA.has(par)) continue;
      achados.push(`cli.md:${linha}: a ajuda nao declara "ork ${par}"`);
    }
  }
  for (const declarado of ajuda) {
    if (!citados.has(declarado) && !AJUDA_SEM_LINHA_NA_REFERENCIA.has(declarado)) {
      achados.push(`a ajuda declara "ork ${declarado}" e a referencia nao o cita`);
    }
  }
  return achados;
}

test('RM-044: docs/referencia/cli.md e a tabela de comandos do parser andam juntos', () => {
  const md = fs.readFileSync(path.join(RAIZ, 'docs/referencia/cli.md'), 'utf8');
  const parser = comandosDoParser(fs.readFileSync(path.join(RAIZ, 'core/src/index.ts'), 'utf8'));
  const ajuda = comandosDaAjuda(execFileSync(process.execPath, [ORK, '--help'], { encoding: 'utf8' }));
  assert.ok(parser.has('thread') && parser.has('maestro') && parser.has('monitor'), 'a leitura do main achou o despacho');
  assert.deepEqual(derivas(md, parser, ajuda), []);
});

test('RM-044: a conferencia reprova comando inventado, subcomando inventado e comando sem doc', () => {
  const parser = new Set(['thread', 'roadmap']);
  const ajuda = new Set(['thread', 'thread new', 'roadmap', 'roadmap pegar', 'roadmap soltar']);
  const md = [
    '| `ork thread new <nome> --modo auto` | ok |',
    '| `ork roadmap pegar\\|soltar RM-NNN` | ok, alternativa com barra |',
    '| `ork thread nova <nome>` | subcomando que nao existe |',
    '```sh',
    'ork fantasma --json',
    '```',
  ].join('\n');
  assert.deepEqual(derivas(md, parser, ajuda), [
    'cli.md:3: a ajuda nao declara "ork thread nova"',
    'cli.md:5: o parser nao tem "ork fantasma"',
  ]);
  assert.deepEqual(derivas('`ork thread new x`', parser, ajuda), [
    'a ajuda declara "ork roadmap" e a referencia nao o cita',
    'a ajuda declara "ork roadmap pegar" e a referencia nao o cita',
    'a ajuda declara "ork roadmap soltar" e a referencia nao o cita',
  ]);
});

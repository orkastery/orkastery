#!/usr/bin/env node
/**
 * RM-072 (D13 da ork-check5x): a comparacao de dois relatorios do `ork security-scan` (`report.json` ou a saida de
 * `--json`) por impressao digital.
 *
 *   node scripts/check-paridade-scan.cjs <referencia.json> <outro.json> [--dependencias]
 *
 * Sem opcao, compara o multiconjunto de achados (impressao digital e estado) e o estado de cada ferramenta: sai 0 so com
 * zero achado novo, zero desaparecido e as mesmas ferramentas no mesmo estado (o criterio do Agile contra o Classic). Com
 * `--dependencias`, compara tambem o conjunto de vulnerabilidades da categoria `dependency` sem o nome da ferramenta
 * (advisory e pacote), que e o que decide se o `osv-scanner` cobre o que `trivy-vuln` e `npm-audit` cobrem; a impressao
 * digital leva o nome da ferramenta, entao trocar ferramenta nunca passa na primeira comparacao. Imprime um JSON com o
 * resumo e ate 20 exemplos de cada diferenca.
 */
'use strict';

const fs = require('node:fs');

function ler(arquivo) {
  const r = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (r.schema !== 'ork.security-scan/v1' || !Array.isArray(r.findings) || !Array.isArray(r.tools)) {
    throw new Error(`${arquivo}: nao e um relatorio ork.security-scan/v1`);
  }
  return r;
}

/** A diferenca entre dois multiconjuntos de chaves: o que sobra de cada lado. */
function diferenca(a, b) {
  const conta = new Map();
  for (const k of a) conta.set(k, (conta.get(k) ?? 0) + 1);
  const sobraB = [];
  for (const k of b) {
    const n = conta.get(k) ?? 0;
    if (n > 0) conta.set(k, n - 1); else sobraB.push(k);
  }
  const sobraA = [...conta].flatMap(([k, n]) => Array(n).fill(k));
  return { soEmA: sobraA, soEmB: sobraB };
}

function comparar(a, b, opcoes = {}) {
  const chave = (f) => `${f.tool}|${f.fingerprint}|${f.status}`;
  const achados = diferenca(a.findings.map(chave), b.findings.map(chave));
  const estado = (t) => `${t.name}:${t.state}:${t.reason ?? ''}`;
  const ferramentas = diferenca(a.tools.map(estado), b.tools.map(estado));
  const resumo = {
    contrato: 'ork.paridade-scan/v1',
    referencia: { head: a.head, base: a.base, ferramentas: a.tools.length, achados: a.findings.length, modo: a.check?.modo ?? 'classic' },
    outro: { head: b.head, base: b.base, ferramentas: b.tools.length, achados: b.findings.length, modo: b.check?.modo ?? 'classic' },
    mesmoHead: a.head === b.head,
    desaparecidos: achados.soEmA.length,
    novos: achados.soEmB.length,
    exemplosDesaparecidos: achados.soEmA.slice(0, 20),
    exemplosNovos: achados.soEmB.slice(0, 20),
    ferramentasDiferentes: { soNaReferencia: ferramentas.soEmA, soNoOutro: ferramentas.soEmB },
  };
  resumo.paridade = resumo.mesmoHead && resumo.desaparecidos === 0 && resumo.novos === 0
    && ferramentas.soEmA.length === 0 && ferramentas.soEmB.length === 0;
  if (opcoes.dependencias) {
    // O advisory e o pacote, sem a ferramenta: a cobertura de dependencias, comparavel entre ferramentas diferentes.
    const vulns = (r) => [...new Set(r.findings.filter((f) => f.category === 'dependency').map((f) => `${f.rule}|${f.file}`))].sort();
    const va = vulns(a), vb = vulns(b);
    const d = diferenca(va, vb);
    resumo.dependencias = { referencia: va.length, outro: vb.length, soNaReferencia: d.soEmA.length, soNoOutro: d.soEmB.length,
      exemplosSoNaReferencia: d.soEmA.slice(0, 20), exemplosSoNoOutro: d.soEmB.slice(0, 20), paridade: d.soEmA.length === 0 && d.soEmB.length === 0 };
  }
  return resumo;
}

module.exports = { comparar, diferenca };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arquivos = args.filter((a) => !a.startsWith('--'));
  if (arquivos.length !== 2) {
    process.stderr.write('uso: check-paridade-scan.cjs <referencia.json> <outro.json> [--dependencias]\n');
    process.exit(2);
  }
  const resumo = comparar(ler(arquivos[0]), ler(arquivos[1]), { dependencias: args.includes('--dependencias') });
  process.stdout.write(JSON.stringify(resumo, null, 1) + '\n');
  process.exit((args.includes('--dependencias') ? resumo.dependencias.paridade : resumo.paridade) ? 0 : 1);
}

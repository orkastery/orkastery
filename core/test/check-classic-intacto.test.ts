/**
 * RM-072 (D2 do dono, item 7; T2 da ork-check5x): o Classic Check segue o CHECK de sempre. O retrato do Classic desta
 * arvore (`scripts/retrato-do-classic.cjs`: os comandos que o verify roda e as chamadas ao Docker que a varredura faz)
 * e o mesmo da base `b16c5be8`, gerado uma vez sobre a arvore da base compilada e guardado em
 * `test/fixtures/classic-retrato-b16c5be8.json`: mesma lista, mesma ordem. O mutante de prova inverte a ordem dos
 * comandos do manifesto numa copia compilada e mostra que o retrato acusa. Os nomes comecam por "CLn:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const CORE = path.resolve(__dirname, '../..');
const SCRIPT = path.join(CORE, 'scripts', 'retrato-do-classic.cjs');
const DA_BASE = JSON.parse(fs.readFileSync(path.join(CORE, 'test', 'fixtures', 'classic-retrato-b16c5be8.json'), 'utf8')) as
  { contrato: string; modo: string; verify: string[][]; scan: string[][] };

function retrato(arvore: string, ...extra: string[]): { verify?: string[][]; scan?: string[][] } {
  const r = spawnSync(process.execPath, [SCRIPT, '--arvore', arvore, '--modo', 'classic', ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { verify?: string[][]; scan?: string[][] };
}

test('CL1: o Classic roda no verify a mesma lista de comandos da base, na mesma ordem', () => {
  assert.equal(DA_BASE.contrato, 'ork.retrato-do-classic/v1');
  assert.deepEqual(retrato(CORE, '--so', 'verify').verify, DA_BASE.verify);
  // O retrato cobre preparo, as duas claims (a que comeca pelos passos do preparo roda inteira), typecheck, build, test e scan.
  assert.deepEqual(DA_BASE.verify.map(([nome]) => nome), ['preparo', 'C1.1', 'C1.2', 'C2.1', 'typecheck', 'build', 'test', 'security_scan']);
});

test('CL2: o Classic chama o Docker igual a base: as mesmas ferramentas, opcoes e argumentos, na mesma ordem', () => {
  const scan = retrato(CORE, '--so', 'scan').scan!;
  assert.deepEqual(scan, DA_BASE.scan);
  const ferramentas = [...new Set(scan.filter((c) => c[1] === 'run').map((c) => /ork-security-scan-([a-z-]+)-<N>/.exec(c.join(' '))?.[1]))];
  assert.deepEqual(ferramentas, ['gitleaks', 'semgrep', 'trivy-vuln', 'npm-audit', 'trivy-config', 'zizmor', 'actionlint', 'eslint', 'trivy-license']);
});

test('CL3: mutante de prova: com a ordem dos comandos do manifesto invertida numa copia compilada, o retrato acusa', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-cl3-'));
  try {
    // A copia e o core inteiro por link, menos o dist-test, que e copiado para receber o mutante.
    for (const d of fs.readdirSync(CORE)) if (d !== 'dist-test') fs.symlinkSync(path.join(CORE, d), path.join(tmp, d));
    fs.cpSync(path.join(CORE, 'dist-test'), path.join(tmp, 'dist-test'), { recursive: true });
    const verify = path.join(tmp, 'dist-test', 'src', 'verify.js');
    const original = fs.readFileSync(verify, 'utf8');
    const ordem = "['typecheck', 'build', 'test', 'security_scan']";
    assert.ok(original.includes(ordem), 'a ordem canonica esta no verify compilado');
    fs.writeFileSync(verify, original.replace(ordem, "['security_scan', 'test', 'build', 'typecheck']"));
    const mutante = retrato(tmp, '--so', 'verify').verify!;
    assert.notDeepEqual(mutante, DA_BASE.verify, 'o retrato pega a ordem trocada');
    assert.deepEqual(mutante.slice(-4).map(([nome]) => nome), ['security_scan', 'test', 'build', 'typecheck']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

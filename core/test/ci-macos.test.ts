import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prova = require('../../scripts/provar-macos-instalado.cjs') as {
  classificarSecurityScan: (relatorio: unknown, codigo: number) => { estado: string; ferramentas: string[] };
};

const contagens = { new: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  existing: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  dismissed: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } };
const relatorio = (tools: object[], findings: object[] = []) => ({ schema: 'ork.security-scan/v1', base: 'base', head: 'head',
  generatedAt: new Date(0).toISOString(), stacks: ['js'], tools, excluded: [], findings });
const ferramenta = (name: string, category: string, state: string, reason?: string) =>
  ({ name, category, version: '1', executor: state === 'ran' ? 'docker' : null, state, ...(reason ? { reason } : {}), counts: contagens });

test('jobs Linux e macOS percorrem o quickstart instalado e publicação exige a prova macOS', () => {
  const raiz = path.resolve(__dirname, '..', '..', '..');
  const workflow = fs.readFileSync(path.join(raiz, '.github/workflows/ci.yml'), 'utf8');
  const publicar = fs.readFileSync(path.join(raiz, '.github/workflows/publicar.yml'), 'utf8');
  const manifesto = fs.readFileSync(path.join(raiz, 'orkastery.yaml'), 'utf8');
  const script = fs.readFileSync(path.join(raiz, 'core/scripts/provar-macos-instalado.cjs'), 'utf8');
  assert.match(workflow, /portabilidade-macos:[\s\S]*runs-on: macos-latest/);
  assert.match(workflow, /portabilidade-macos:[\s\S]*node-version: '24'/);
  assert.match(workflow, /portabilidade-linux:[\s\S]*runs-on: ubuntu-latest/);
  assert.equal(workflow.match(/node core\/scripts\/provar-macos-instalado\.cjs/g)?.length, 2);
  assert.match(script, /npm', \['pack'/);
  assert.match(script, /npm', \['install', '-g', '--prefix'/);
  assert.match(script, /fixtureDoProjeto/);
  assert.match(script, /package-lock\.json/);
  assert.match(script, /binDoPrefixo/);
  assert.match(script, /HOME: home/);
  assert.match(script, /resolverNoPath\('ork', ambiente\)/);
  assert.match(script, /\['demo'\]/);
  assert.match(script, /'thread', 'new'/);
  assert.match(script, /'doctor', '--json'/);
  assert.match(script, /'claims', 'add'/);
  assert.match(script, /'verify', threadId/);
  assert.match(script, /'security-scan', '--json'/);
  assert.match(script, /ORK_SECURITY_SCAN_REQUIRED: '1'/);
  assert.ok(script.indexOf("executar('npm', ['test']") < script.indexOf("executarComSaida('ork', ['security-scan'"));
  assert.doesNotMatch(script, /--sem-worktree|dist', 'verify\.js'/);
  assert.doesNotMatch(script, /node core\/dist\/index\.js/);
  assert.match(publicar, /provar-portabilidade-macos:[\s\S]*runs-on: macos-latest[\s\S]*provar-macos-instalado\.cjs/);
  assert.match(publicar, /provar-portabilidade-macos:[\s\S]*package-manager-cache: false/);
  assert.match(publicar, /needs: \[provar-grafo, provar-portabilidade-macos\]/);
  assert.doesNotMatch(workflow, /portabilidade-(?:macos|linux):[\s\S]*?continue-on-error:\s*true/);
  assert.doesNotMatch(publicar, /provar-portabilidade-macos:[\s\S]*?continue-on-error:\s*true/);
  assert.match(manifesto, /- "pacote instalado e quickstart no Linux"/);
  assert.match(manifesto, /- "pacote instalado e quickstart no macOS"/);
});

test('classificação do scan aceita cobertura real ou falta de contêiner, sem verde vazio', () => {
  const coberto = relatorio([
    ferramenta('gitleaks', 'secret', 'ran'), ferramenta('semgrep', 'sast', 'ran'),
    ferramenta('npm-audit', 'dependency', 'ran'), ferramenta('trivy-config', 'iac', 'ran'), ferramenta('zizmor', 'workflow', 'ran'),
  ]);
  assert.equal(prova.classificarSecurityScan(coberto, 0).estado, 'coberto');
  const semRuntime = relatorio([
    ferramenta('gitleaks', 'secret', 'unavailable', 'docker-missing'),
    ferramenta('semgrep', 'sast', 'unavailable', 'docker-daemon-down'),
  ]);
  assert.equal(prova.classificarSecurityScan(semRuntime, 1).estado, 'nao-coberto-sem-runtime-de-container');
  assert.throws(() => prova.classificarSecurityScan(semRuntime, 0), /saiu verde/);
  assert.throws(() => prova.classificarSecurityScan({ schema: 'ork.security-scan/v1', tools: [] }, 1), /relatório/);
  assert.throws(() => prova.classificarSecurityScan(relatorio([
    ferramenta('gitleaks', 'secret', 'ran'), ferramenta('semgrep', 'sast', 'unavailable', 'docker-missing'),
  ], [{ status: 'new', loop: true }]), 1), /achado novo no laço/);
  assert.throws(() => prova.classificarSecurityScan(relatorio([
    ferramenta('gitleaks', 'secret', 'failed', 'exit-127: comando não encontrado'),
  ]), 1), /não cobriu gitleaks/);
  const comDispensa = relatorio([
    ferramenta('gitleaks', 'secret', 'ran'),
    ferramenta('zizmor', 'workflow', 'unavailable', 'unsupported-ci'),
  ]);
  assert.equal(prova.classificarSecurityScan(comDispensa, 0).estado, 'coberto');
});

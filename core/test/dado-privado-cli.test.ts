/**
 * RM-062 (F1): o comando `ork privado varrer`, como o passo do CI o roda. Todo valor daqui é inventado; o arquivo
 * entra nas exceções versionadas por caminho, só para os padrões genéricos.
 */
import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, commitar, dirTemporario, projetoTemporario } from './apoio';
import { exec } from '../src/util';

const ORK = path.resolve(__dirname, '../../dist/index.js');
const HOME_FICTICIA = '/home/fulana-de-teste';
const EMAIL_FICTICIO = 'contato@empresa-ficticia.com.br';
const TERMO_FICTICIO = 'tralala-quarenta-e-dois';
const VALORES = [HOME_FICTICIA, 'fulana-de-teste', EMAIL_FICTICIO, 'empresa-ficticia', TERMO_FICTICIO];

const temporarios = new Set<string>();

function temporario(nome: string): string {
  const dir = dirTemporario(nome);
  temporarios.add(dir);
  return dir;
}

after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

/** Roda o CLI compilado no diretório, sem a lista local (ou com a dada) e sem projeto herdado do ambiente. */
function ork(cwd: string, args: string[], lista: string | null = null): { code: number; saida: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, ORK_TERMOS_PRIVADOS: lista ?? path.join(cwd, '.nao-existe', 'termos.txt') };
  delete env.ORK_PROJETO;
  delete env.ORK_PROJETO_EXPLICITO;
  const r = spawnSync(process.execPath, [ORK, 'privado', 'varrer', ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status ?? -1, saida: `${r.stdout}${r.stderr}` };
}

/** Um repositório git sem manifesto, com os arquivos dados commitados. */
function repo(nome: string, arquivos: Record<string, string>): string {
  const dir = temporario(`dado-privado-cli-${nome}`);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  exec('git', ['config', 'commit.gpgsign', 'false'], dir);
  for (const [arquivo, conteudo] of Object.entries(arquivos)) commitar(dir, arquivo, conteudo, arquivo);
  return dir;
}

function semValores(texto: string): void {
  for (const v of VALORES) assert.equal(texto.toLowerCase().includes(v.toLowerCase()), false, `a saída repetiu ${v.slice(0, 3)}...`);
}

test('DC1: sai 1 com o relatório mascarado quando acha, e 0 sem achado', () => {
  const sujo = repo('sujo', { 'a.txt': `${HOME_FICTICIA}/x\n` });
  const r = ork(sujo, []);
  assert.equal(r.code, 1, r.saida);
  assert.match(r.saida, /^ {4}a\.txt:1:1 {2}home$/m);
  assert.match(r.saida, /Veredito: REPROVADO \(1 achado\(s\) de dado privado; policy dado_privado nao declarada: o comando explicito reprova\)/);
  semValores(r.saida);
  const limpo = repo('limpo', { 'a.txt': 'nada aqui\n' });
  const ok = ork(limpo, []);
  assert.equal(ok.code, 0, ok.saida);
  assert.match(ok.saida, /Veredito: nenhum dado privado nas linhas e nos nomes varridos\./);
});

test('DC2: --json sai no contrato ork.privado-varredura/v1, com os achados e sem o valor', () => {
  const dir = repo('json', { 'docs/b.md': `fale com ${EMAIL_FICTICIO}\n` });
  const r = ork(dir, ['--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.saida);
  assert.equal(j.schema, 'ork.privado-varredura/v1');
  assert.deepEqual(j.achados, [{ arquivo: 'docs/b.md', linha: 1, coluna: 10, padrao: 'email' }]);
  assert.deepEqual([j.ok, j.erro, j.severidade], [false, null, null]);
  assert.equal(j.listaLocal.presente, false);
  semValores(r.saida);
});

test('DC3: --base varre só o diff; warn e off saem 0 com o aviso; block sai 1', () => {
  const p = projetoTemporario('dado-privado-cli-policy');
  try {
    commitar(p.dir, 'base.txt', `${EMAIL_FICTICIO}\n`, 'linha da base');
    const base = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
    commitar(p.dir, 'novo.txt', `${HOME_FICTICIA}\n`, 'linha nova');
    ajustarManifesto(p, /^policies:\n/m, 'policies:\n  dado_privado: warn\n');
    const aviso = ork(p.dir, ['--base', base]);
    assert.equal(aviso.code, 0, aviso.saida);
    assert.match(aviso.saida, /^ {4}novo\.txt:1:1 {2}home$/m);
    assert.equal(/base\.txt/.test(aviso.saida), false, 'a linha da base não conta no diff');
    assert.match(aviso.saida, /Veredito: AVISO \(1 achado\(s\) de dado privado; policy dado_privado em warn, que nao reprova\)/);
    ajustarManifesto(p, 'dado_privado: warn', 'dado_privado: off');
    assert.equal(ork(p.dir, ['--base', base]).code, 0);
    ajustarManifesto(p, 'dado_privado: off', 'dado_privado: block');
    const bloqueio = ork(p.dir, ['--base', base]);
    assert.equal(bloqueio.code, 1);
    assert.match(bloqueio.saida, /Veredito: REPROVADO \(1 achado\(s\) de dado privado; policy dado_privado em block\)/);
    // Sem --base, a árvore inteira: a linha da base volta a contar.
    assert.match(ork(p.dir, []).saida, /^ {4}base\.txt:1:1 {2}email$/m);
    semValores(bloqueio.saida);
  } finally { p.limpar(); }
});

test('DC4: sem a lista local diz que ela está ausente; com ela o termo reprova; varredura que não roda sai 2', () => {
  const dir = repo('lista', { [`evidencia/${TERMO_FICTICIO}.json`]: '{}\n' });
  const sem = ork(dir, []);
  assert.equal(sem.code, 0, sem.saida);
  assert.match(sem.saida, /lista local {2}ausente \(procurada em [^)]*\); só os padrões genéricos \(home, email, hostname\)/);
  const pasta = temporario('dado-privado-cli-lista');
  const arquivoDaLista = path.join(pasta, 'termos-privados.txt');
  fs.writeFileSync(arquivoDaLista, `${TERMO_FICTICIO}\n`, { mode: 0o600 });
  const com = ork(dir, [], arquivoDaLista);
  assert.equal(com.code, 1, com.saida);
  assert.match(com.saida, /^ {4}evidencia\/\[omitido\]\.json {2}nome do arquivo: lista-local \(termo 1\)$/m);
  assert.match(com.saida, /lista local {2}1 termo\(s\) de /);
  semValores(com.saida);
  // O arquivo de exceções fora do contrato e o uso errado saem 2.
  commitar(dir, 'orkastery.privado.json', '{"contrato": "ork.privado/v9"}\n', 'excecoes erradas');
  const quebrado = ork(dir, []);
  assert.equal(quebrado.code, 2);
  assert.match(quebrado.saida, /Veredito: NAO RODOU \(orkastery\.privado\.json fora do contrato ork\.privado\/v1: "contrato" tem de ser "ork\.privado\/v1"\)/);
  assert.equal(spawnSync(process.execPath, [ORK, 'privado', 'limpar'], { cwd: dir, encoding: 'utf8' }).status, 2);
});

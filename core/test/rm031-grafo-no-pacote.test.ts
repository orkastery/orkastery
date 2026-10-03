/**
 * RM-031, correcao de empacotamento: o grafo de codigo funciona em quem instala o `ork` pelo npm.
 *
 * Grupos: "grafo no pacote: dependencias" (os pacotes que os analisadores carregam sao dependencias
 * de runtime com versao exata, e os docs dizem quantas dependencias o pacote tem) e "lockfile" (o
 * fecho dos analisadores nao fica marcado dev, e nenhum pacote de producao roda script de instalacao).
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { PACOTES_DOS_ANALISADORES, pacotesDosAnalisadores, versoesDosAnalisadores } from '../src/intelligence-graph-parsers';

const CORE = path.resolve(__dirname, '../..');
const RAIZ = path.resolve(CORE, '..');

interface Pacote { version: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
interface EntradaDoLock { version?: string; dev?: boolean; hasInstallScript?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

const ler = (rel: string): string => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const pacote = (): Pacote => JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8'));
const lock = (): { packages: Record<string, EntradaDoLock> } => JSON.parse(fs.readFileSync(path.join(CORE, 'package-lock.json'), 'utf8'));
const instalado = (nome: string): string => JSON.parse(fs.readFileSync(path.join(CORE, 'node_modules', nome, 'package.json'), 'utf8')).version;

test('grafo no pacote: dependencias: cada pacote que os analisadores carregam e dependencia de runtime com a versao exata instalada', () => {
  const p = pacote(), raiz = lock().packages[''];
  for (const nome of PACOTES_DOS_ANALISADORES) {
    const versao = p.dependencies?.[nome] ?? '';
    assert.match(versao, /^\d+\.\d+\.\d+$/, `${nome}: versao exata em dependencies (${versao || 'ausente'})`);
    assert.equal(versao, instalado(nome), `${nome}: a versao do node_modules`);
    assert.equal(raiz.dependencies?.[nome], versao, `${nome}: a raiz do lockfile`);
    assert.equal(p.devDependencies?.[nome], undefined, `${nome} fora de devDependencies`);
    assert.equal(p.optionalDependencies?.[nome], undefined, `${nome} fora de optionalDependencies`);
    assert.equal(raiz.devDependencies?.[nome], undefined, `${nome} fora das devDependencies do lockfile`);
  }
  // Os rotulos dos extratores do KG2 saem dessas versoes (a do Node vem de quem roda).
  const v = versoesDosAnalisadores(), d = p.dependencies as Record<string, string>;
  assert.equal(v.typescript, d.typescript);
  assert.equal(v.markdown, `micromark.${d.micromark}.gfm-table.${d['micromark-extension-gfm-table']}`);
});

test('grafo no pacote: dependencias: o quickstart, os READMEs e o SECURITY dizem quantas dependencias de runtime o pacote tem', () => {
  const n = Object.keys(pacote().dependencies ?? {}).length;
  const extenso = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze'][n];
  assert.ok(extenso, `${n} dependências: estenda a lista por extenso`);
  assert.ok(ler('docs/comecar/quickstart.md').includes(`com ${extenso} dependências de runtime`), 'quickstart');
  assert.ok(ler('README.md').includes(`| Runtime dependencies | ${n}, pinned |`), 'README.md');
  assert.ok(ler('README.pt-BR.md').includes(`| Dependências de runtime | ${n}, com versão fixa |`), 'README.pt-BR.md');
  assert.ok(ler('SECURITY.md').includes(`| Dependencias de runtime | **${extenso}**, com versão fixa em \`core/package.json\``), 'SECURITY.md');
});

test('grafo no pacote: lockfile: o fecho dos analisadores esta no lockfile com a versao instalada e nenhum pacote dele e dev', () => {
  const pacotes = lock().packages;
  const fecho = pacotesDosAnalisadores();
  assert.ok(fecho.length >= PACOTES_DOS_ANALISADORES.length, fecho.join(' '));
  for (const item of fecho) {
    const arroba = item.lastIndexOf('@'), nome = item.slice(0, arroba), versao = item.slice(arroba + 1);
    const entrada = pacotes[`node_modules/${nome}`];
    assert.ok(entrada, `${item} fora do lockfile`);
    assert.equal(entrada.version, versao, `${nome}: a versao do lockfile`);
    assert.notEqual(entrada.dev, true, `${nome} marcado dev: o npm ci --omit=dev e quem instala do npm o perderiam`);
  }
});

test('grafo no pacote: lockfile: nenhum pacote de producao roda script de instalacao, como o SECURITY diz', () => {
  const comScript = Object.entries(lock().packages)
    .filter(([caminho, e]) => caminho !== '' && e.dev !== true && e.hasInstallScript === true).map(([caminho]) => caminho);
  assert.deepEqual(comScript, []);
});

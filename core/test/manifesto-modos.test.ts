/**
 * I-43 (D6, R3): o manifesto distingue modo APOSENTADO de modo INEXISTENTE.
 *
 * R3 era o risco mais imediato da thread, e o mais barulhento: `manifest.ts` valida
 * `conduction.allowed_modes` item a item com `parseModo`, e os quatro `orkastery.yaml`
 * deste VPS listam `look` e `ork`. Se modo aposentado virasse erro, `ork doctor` ficaria
 * vermelho nos tres projetos no dia um, com uma mensagem que culpa o dono por um arquivo
 * que estava CERTO quando foi escrito.
 *
 * A saida nao e afrouxar `parseModo`: ele e o portao de ESCRITA, e afrouxa-lo deixaria
 * `#Look` ser escrito de novo, que e o oposto desta thread. A distincao mora num lugar
 * so, no manifesto, que e a unica peca com motivo para distinguir os dois casos.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { carregarManifesto, exigirManifesto, NOME_MANIFESTO } from '../src/manifest';
import { migrarModosAposentados, planejarMigracaoModos } from '../src/modos-migracao';
import { MODOS_APOSENTADOS, parseModo } from '../src/modos';

/** Troca a linha de `allowed_modes` do manifesto do projeto temporario. */
function comAllowedModes(dir: string, lista: string): void {
  const yaml = path.join(dir, NOME_MANIFESTO);
  const texto = fs.readFileSync(yaml, 'utf8')
    .replace(/^(\s*allowed_modes:\s*)\[.*\]\s*$/m, `$1[${lista}]`);
  fs.writeFileSync(yaml, texto, 'utf8');
}

test('modo APOSENTADO em allowed_modes e aviso, e sai da lista de permitidos', () => {
  const p = projetoTemporario('manifesto-aposentado');
  try {
    comAllowedModes(p.dir, 'look, ork, classic, maestro, auto');
    const c = carregarManifesto(p.dir);
    assert.ok(c);

    // Nao e erro: `ork doctor` continua saindo 0 no dia um.
    assert.deepEqual(c.erros, [], `aposentado nao pode ser erro: ${c.erros.join(' | ')}`);
    assert.doesNotThrow(() => exigirManifesto(p.dir));

    // E aviso, nominal, e nomeia o substituto VIVO.
    for (const morto of MODOS_APOSENTADOS) {
      assert.ok(c.avisos.some((a) => a.includes(morto)), `sem aviso para ${morto}: ${c.avisos.join(' | ')}`);
    }
    assert.ok(c.avisos.some((a) => a.includes('#Classic')), 'o aviso precisa nomear um modo vivo');

    // E o modo aposentado NAO entra na lista de permitidos: ele e ignorado, nao aceito.
    // I-42: o que o dono listou e vivo continua; o `#Fast` so entra por decisao do dono.
    assert.deepEqual([...c.manifesto.conduction.allowed_modes], ['classic', 'maestro', 'auto']);
  } finally { p.limpar(); }
});

test('modo INEXISTENTE continua erro: a acao do dono e outra', () => {
  const p = projetoTemporario('manifesto-inexistente');
  try {
    comAllowedModes(p.dir, 'banana, classic, auto');
    const c = carregarManifesto(p.dir);
    assert.ok(c);
    assert.ok(c.erros.some((e) => e.includes('banana')), `banana precisa ser erro: ${c.erros.join(' | ')}`);
    assert.throws(() => exigirManifesto(p.dir), /manifesto invalido/);

    // `default_mode` aposentado tambem reprova, mas com o motivo certo.
    comAllowedModes(p.dir, 'classic, maestro, auto');
    const yaml = path.join(p.dir, NOME_MANIFESTO);
    fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace(/default_mode: \w+/, 'default_mode: look'), 'utf8');
    const d = carregarManifesto(p.dir);
    assert.ok(d?.erros.some((e) => e.includes('aposentado')), `${d?.erros.join(' | ')}`);
  } finally { p.limpar(); }
});

test('parseModo NAO afrouxou: o portao de escrita segue recusando o aposentado', () => {
  // A distincao e do manifesto e de mais ninguem. Se `parseModo` aceitasse `look`
  // para o manifesto nao reclamar, `#Look` voltaria a ser escrivel por toda entrada.
  for (const morto of MODOS_APOSENTADOS) assert.equal(parseModo(morto), null);
});

test('a migracao e IDEMPOTENTE e nao toca em historico', () => {
  const p = projetoTemporario('migracao-modos');
  try {
    comAllowedModes(p.dir, 'look, ork, classic, maestro, auto');
    const setup = path.join(p.dir, '.orkastery', 'setup.json');
    fs.mkdirSync(path.dirname(setup), { recursive: true });
    fs.writeFileSync(setup, JSON.stringify({ contrato: 'ork.setup/v1', atualizadoEm: '2026-09-20T00:00:00.000Z',
      modos: { look: { blocos: [] }, ork: { blocos: [] }, classic: { blocos: [] },
        maestro: { blocos: [] }, auto: { blocos: [] } } }, null, 2), 'utf8');

    // `--dry-run` mostra o diff e nao escreve.
    const antesYaml = fs.readFileSync(path.join(p.dir, NOME_MANIFESTO), 'utf8');
    const ensaio = migrarModosAposentados(p.dir, { dryRun: true });
    assert.equal(ensaio.dryRun, true);
    assert.equal(ensaio.backup, null);
    assert.ok(ensaio.mudancas.length >= 3, `${JSON.stringify(ensaio.mudancas)}`);
    assert.equal(fs.readFileSync(path.join(p.dir, NOME_MANIFESTO), 'utf8'), antesYaml, 'dry-run nao escreve');

    // A primeira passada migra e guarda backup.
    const primeira = migrarModosAposentados(p.dir, { por: 'teste' });
    assert.ok(primeira.backup && fs.existsSync(primeira.backup), 'backup e condicao, nao cortesia');
    assert.equal(fs.readFileSync(path.join(primeira.backup!, NOME_MANIFESTO), 'utf8'), antesYaml);

    const depois = carregarManifesto(p.dir);
    // A migracao tira os aposentados e nao acrescenta modo novo: habilitar o `#Fast` e
    // uma linha por projeto, por decisao do dono (I-42, D9).
    assert.deepEqual([...depois!.manifesto.conduction.allowed_modes], ['classic', 'maestro', 'auto']);
    assert.deepEqual(depois!.erros, []);
    assert.deepEqual(depois!.avisos.filter((a) => a.includes('aposentado')), [], 'sem aposentado, sem aviso');
    const relido = JSON.parse(fs.readFileSync(setup, 'utf8')) as { modos: Record<string, unknown> };
    for (const morto of MODOS_APOSENTADOS) assert.equal(Object.hasOwn(relido.modos, morto), false);
    // Os vivos que estavam no arquivo ficam; modo novo (o `#Fast`) nao e escrito pela migracao,
    // porque a leitura ja o completa no default do modo.
    for (const vivo of ['classic', 'maestro', 'auto']) assert.equal(Object.hasOwn(relido.modos, vivo), true);

    // A segunda passada nao tem o que fazer. E o que "idempotente" significa aqui:
    // ela vai rodar em tres projetos deste VPS, e um deles pode ja ter sido migrado.
    assert.deepEqual(planejarMigracaoModos(p.dir), []);
    const segunda = migrarModosAposentados(p.dir, { por: 'teste' });
    assert.deepEqual(segunda.mudancas, []);
    assert.equal(segunda.backup, null, 'sem mudanca, sem backup novo');
  } finally { p.limpar(); }
});

test('a migracao NAO reescreve thread, ledger nem recibo (P3)', () => {
  const p = projetoTemporario('migracao-historico');
  try {
    comAllowedModes(p.dir, 'look, classic, maestro, auto');
    const mudancas = planejarMigracaoModos(p.dir);
    // So configuracao entra no plano; historico nunca.
    for (const m of mudancas) {
      assert.ok([NOME_MANIFESTO, 'setup.json'].includes(m.arquivo), `migracao tocou ${m.arquivo}`);
    }
  } finally { p.limpar(); }
});

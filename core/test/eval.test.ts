/**
 * Roda a fixture de `eval/` contra o nucleo: pedido do builder com #TAG deve produzir
 * o slug de 3 partes, os blocos do modo e o numero de pausas humanas esperados.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTRATO_MASTER_LOG, ORDEM_DAS_CLASSES, validarMasterLog } from '../src/master';
import { extrairTagDoPedido, MODOS, MODOS_APOSENTADOS, ORDEM_DOS_MODOS, pausasDoModo } from '../src/modos';
import { montarSlug } from '../src/slug';
import { Modo } from '../src/types';

interface Caso {
  pedido: string;
  nome: string;
  modoEsperado: Modo | null;
  slugEsperado: string;
  blocosEsperados: string[];
  pausasEsperadas: number;
}

interface Fixture {
  descricao: string;
  manifesto: { project: { name: string; abbrev: string } };
  casos: Caso[];
}

const CAMINHO = path.resolve(__dirname, '../../../eval/fixtures/b0-slug-e-modos/caso.json');

test('fixture b0-slug-e-modos: #TAG do pedido vira slug, blocos e pausas', () => {
  const fixture = JSON.parse(fs.readFileSync(CAMINHO, 'utf8')) as Fixture;
  const abbrev = fixture.manifesto.project.abbrev;
  // I-43: o corpus cobre todo modo VIVO. O numero nao e carimbado: ele sai da lista,
  // entao acrescentar um modo passa a exigir o caso dele em vez de passar despercebido.
  const cobertos = new Set(fixture.casos.map((c) => c.modoEsperado).filter((m) => m !== null));
  for (const m of ORDEM_DOS_MODOS) assert.ok(cobertos.has(m), `a fixture nao cobre ${m}`);
  for (const m of MODOS_APOSENTADOS) {
    assert.equal((cobertos as Set<string>).has(m), false, `a fixture ainda escreve o modo aposentado ${m}`);
  }

  for (const caso of fixture.casos) {
    const extraido = extrairTagDoPedido(caso.pedido);
    assert.equal(extraido, caso.modoEsperado, `tag de: ${caso.pedido}`);

    // Sem tag no pedido, vale o conduction.default_mode do manifesto.
    const modo: Modo = extraido ?? 'classic';
    const def = MODOS[modo];
    assert.equal(pausasDoModo(modo), caso.pausasEsperadas, `pausas de: ${caso.pedido}`);
    assert.deepEqual(
      def.blocos.map((b) => b.fases.join('-')),
      caso.blocosEsperados,
      `blocos de: ${caso.pedido}`
    );
    assert.equal(
      montarSlug(abbrev, caso.nome, def.blocos[0].slugFases),
      caso.slugEsperado,
      `slug de: ${caso.pedido}`
    );
  }
});

interface CasoInvalido {
  nome: string;
  mudanca: Record<string, unknown>;
  erroEsperado: string;
}

interface FixtureMaster {
  contrato: string;
  camposObrigatorios: string[];
  classesFixas: string[];
  valido: Record<string, unknown>;
  invalidos: CasoInvalido[];
}

const CAMINHO_MASTER = path.resolve(__dirname, '../../../eval/fixtures/b2-master-log/caso.json');

test('fixture b2-master-log: o contrato congelado do MASTER log e executavel', () => {
  const fixture = JSON.parse(fs.readFileSync(CAMINHO_MASTER, 'utf8')) as FixtureMaster;

  assert.equal(fixture.contrato, CONTRATO_MASTER_LOG);
  assert.deepEqual(fixture.classesFixas, [...ORDEM_DAS_CLASSES], 'as classes de falha sao fixas');
  assert.deepEqual(validarMasterLog(fixture.valido), [], 'o log da fixture passa no contrato');

  // Todo campo obrigatorio do contrato existe no log valido da fixture.
  for (const campo of fixture.camposObrigatorios) {
    assert.ok(campo in fixture.valido, `campo obrigatorio ausente na fixture: ${campo}`);
  }

  assert.ok(fixture.invalidos.length >= 5, 'a fixture cobre as mutacoes que precisam reprovar');
  for (const caso of fixture.invalidos) {
    const mutado = { ...fixture.valido, ...caso.mudanca };
    const erros = validarMasterLog(mutado);
    assert.ok(erros.length > 0, `deveria reprovar: ${caso.nome}`);
    assert.ok(
      erros.some((e) => e.includes(caso.erroEsperado)),
      `erro de "${caso.nome}" deveria citar "${caso.erroEsperado}", veio: ${erros.join(' | ')}`
    );
  }
});

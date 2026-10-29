/**
 * RM-062, F3 e F4: evidencia de maquina nasce generica e o PR relata com honestidade o escape.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { arquivoDoRetrato, retratoDaMaquina } from '../src/rede';
import { dirTemporario } from './apoio';

test('RM-062 F3: o retrato e o filename usam o alias generico, nunca o hostname fornecido pelo ambiente', () => {
  const usuario = dirTemporario('rm062-f3-usuario');
  const antes = {
    usuario: process.env.ORK_USUARIO_DIR,
    maquina: process.env.ORK_MAQUINA,
    hostname: process.env.HOSTNAME,
  };
  try {
    process.env.ORK_USUARIO_DIR = usuario;
    process.env.ORK_MAQUINA = 'maquina-a';
    process.env.HOSTNAME = 'host-de-teste';
    const opcoes = {
      amb: { env: { PATH: '' }, home: usuario },
      identidades: [],
      diretorio: null,
      arquivoDeProjetos: path.join(usuario, 'projetos-ausentes.json'),
    };

    const retrato = retratoDaMaquina(opcoes);
    const json = JSON.stringify(retrato);
    assert.equal(retrato.contrato, 'ork.rede-maquina/v1');
    assert.deepEqual([retrato.maquina, retrato.hostname], ['maquina-a', 'maquina-a']);
    assert.equal(arquivoDoRetrato(retrato.maquina), 'maquinas/maquina-a.json');
    assert.ok(!json.includes('host-de-teste'));

    delete process.env.ORK_MAQUINA;
    assert.throws(() => retratoDaMaquina(opcoes), /^Error: rede\.maquina-generica:/,
      'sem o mapa local, o gravador recusa em vez de cair no hostname');
  } finally {
    if (antes.usuario === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes.usuario;
    if (antes.maquina === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes.maquina;
    if (antes.hostname === undefined) delete process.env.HOSTNAME; else process.env.HOSTNAME = antes.hostname;
    fs.rmSync(usuario, { recursive: true, force: true });
  }
});

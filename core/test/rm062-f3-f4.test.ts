/**
 * RM-062, F3 e F4: evidencia de maquina nasce generica e o PR relata com honestidade o escape.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gravarConfigDaMaquina } from '../src/maquina';
import { arquivoDoRetrato, retratoDaMaquina } from '../src/rede';
import { dirTemporario } from './apoio';

const RAIZ = path.resolve(__dirname, '../../..');

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

test('RM-062 F3: a configuracao da maquina segue ORKASTERY_HOME, sem consultar o home real', () => {
  const usuario = dirTemporario('rm062-f3-orkastery-home');
  const antes = {
    usuario: process.env.ORK_USUARIO_DIR,
    orkasteryHome: process.env.ORKASTERY_HOME,
    maquina: process.env.ORK_MAQUINA,
  };
  try {
    delete process.env.ORK_USUARIO_DIR;
    delete process.env.ORK_MAQUINA;
    process.env.ORKASTERY_HOME = usuario;
    gravarConfigDaMaquina({ nome: 'maquina-home' });

    const retrato = retratoDaMaquina({
      amb: { env: { PATH: '' }, home: usuario },
      identidades: [],
      diretorio: null,
      arquivoDeProjetos: path.join(usuario, 'projetos-ausentes.json'),
    });
    assert.deepEqual([retrato.maquina, retrato.hostname], ['maquina-home', 'maquina-home']);
    assert.equal(fs.existsSync(path.join(usuario, 'maquina.json')), true);
  } finally {
    if (antes.usuario === undefined) delete process.env.ORK_USUARIO_DIR; else process.env.ORK_USUARIO_DIR = antes.usuario;
    if (antes.orkasteryHome === undefined) delete process.env.ORKASTERY_HOME; else process.env.ORKASTERY_HOME = antes.orkasteryHome;
    if (antes.maquina === undefined) delete process.env.ORK_MAQUINA; else process.env.ORK_MAQUINA = antes.maquina;
    fs.rmSync(usuario, { recursive: true, force: true });
  }
});

test('RM-062 F4: o guia de PR exige corrigido, histórico e decisão do dono, nesta ordem', () => {
  const guia = fs.readFileSync(path.join(RAIZ, 'docs/guias/contribuir/pull-request.md'), 'utf8');
  const inicio = guia.indexOf('### Quando dado privado escapou');
  const fim = guia.indexOf('\n## Evidência esperada', inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'a seção do escape existe no guia real');
  const modelo = guia.slice(inicio, fim);
  const partes = [
    'Corrigido agora:',
    'Continua no histórico:',
    'Decisão do dono sobre reescrita:',
  ];
  const posicoes = partes.map((parte) => modelo.indexOf(parte));
  assert.ok(posicoes.every((posicao) => posicao >= 0), 'as três partes estão presentes');
  assert.deepEqual([...posicoes].sort((a, b) => a - b), posicoes, 'as três partes aparecem na ordem do relato');
  assert.match(modelo, /commits anteriores/);
  assert.match(modelo, /somente o dono decide/);
});

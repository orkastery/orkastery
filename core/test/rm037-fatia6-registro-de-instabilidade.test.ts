/**
 * RM-037 (fatia 6, P6/T15): o registro de instabilidade `core/instabilidade.json`, contrato
 * `ork.instabilidade/v1`. Nasce vazio e so aceita entrada com taxa medida e revalidacao em ate 30 dias.
 *
 * O registro diz ao verify que um teste e de relogio quando a falha dele nao traz a assinatura de prazo
 * do runner (a asercao de tempo decorrido, por exemplo). Ele nunca atenua sozinho: sem steal acima de
 * 40% na janela do comando, o teste registrado reprova como qualquer outro. Antes desta fatia o arquivo
 * e o contrato nao existiam.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ARQUIVO_INSTABILIDADE, CONTRATO_INSTABILIDADE, EntradaDeInstabilidade, lerRegistroDeInstabilidade, validarRegistro, vigente,
} from '../src/instabilidade';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { gravarBaseline, textoDoVerify, verificar } from '../src/verify';
import { ajustarManifesto, projetoTemporario } from './apoio';

const RAIZ_DO_REPO = path.resolve(__dirname, '..', '..', '..');

/** Uma asercao de relogio real: o teste mede o tempo decorrido, e o runner nao diz que foi relogio. */
const SPEC_TEMPO_DECORRIDO = [
  '✖ failing tests:', '',
  'test at core/test/sensor.test.ts:40:1', '✖ o sensor responde em menos de 2 s (2481.2ms)',
  '  AssertionError [ERR_ASSERTION]: levou 2481 ms', '',
].join('\n');

function entrada(extra: Partial<EntradaDeInstabilidade> = {}): EntradaDeInstabilidade {
  return {
    teste: 'o sensor responde em menos de 2 s',
    arquivo: 'core/test/sensor.test.ts',
    causa: 'relogio',
    taxa: { falhas: 3, rodadas: 20, comando: 'for i in $(seq 20); do node --test core/dist-test/test/sensor.test.js; done', medidaEm: '2026-10-03' },
    revalidarAte: '2026-11-02',
    ...extra,
  };
}

test('o registro do repositorio existe, esta no contrato e nasce vazio', () => {
  const arquivo = path.join(RAIZ_DO_REPO, ARQUIVO_INSTABILIDADE);
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.deepEqual(validarRegistro(bruto), []);
  assert.deepEqual(bruto, { contrato: CONTRATO_INSTABILIDADE, entradas: [] });
  const lido = lerRegistroDeInstabilidade(RAIZ_DO_REPO);
  assert.deepEqual([lido.presente, lido.erros, lido.vigentes, lido.vencidas], [true, [], [], []]);
});

test('so entra entrada com taxa medida e revalidacao em ate 30 dias da medida', () => {
  const com = (e: unknown) => validarRegistro({ contrato: CONTRATO_INSTABILIDADE, entradas: [e] });
  assert.deepEqual(com(entrada()), [], '30 dias exatos valem');
  const { taxa: _semTaxa, ...semTaxa } = entrada();
  assert.match(com(semTaxa).join(' | '), /sem taxa medida a entrada nao entra/);
  assert.match(com(entrada({ taxa: { ...entrada().taxa, falhas: 0 } })).join(' | '), /taxa\.falhas/);
  assert.match(com(entrada({ taxa: { ...entrada().taxa, falhas: 21 } })).join(' | '), /maior que rodadas/);
  assert.match(com(entrada({ taxa: { ...entrada().taxa, comando: ' ' } })).join(' | '), /taxa\.comando/);
  assert.match(com(entrada({ taxa: { ...entrada().taxa, medidaEm: '2026-02-30' } })).join(' | '), /medidaEm/);
  assert.match(com(entrada({ revalidarAte: '2026-11-03' })).join(' | '), /no maximo 30 dias/);
  assert.match(com(entrada({ revalidarAte: '2026-10-02' })).join(' | '), /antes da medida/);
  assert.match(com(entrada({ causa: 'rede' as 'relogio' })).join(' | '), /causa: relogio/);
  assert.match(com({ ...entrada(), dono: 'x' }).join(' | '), /chave desconhecida dono/);
  assert.match(validarRegistro({ contrato: CONTRATO_INSTABILIDADE, entradas: [entrada(), entrada()] }).join(' | '), /repetido/);
  assert.match(validarRegistro({ contrato: 'ork.instabilidade/v2', entradas: [] }).join(' | '), /contrato precisa ser/);
  assert.match(validarRegistro({ contrato: CONTRATO_INSTABILIDADE }).join(' | '), /entradas precisa ser uma lista/);
});

test('a entrada vale ate o fim do dia de revalidarAte, e vencida deixa de valer', () => {
  assert.equal(vigente(entrada(), Date.parse('2026-11-02T23:59:59Z')), true);
  assert.equal(vigente(entrada(), Date.parse('2026-11-03T00:00:00Z')), false);
});

/** Projeto em que o `test` passava na baseline e agora reprova com a asercao de tempo decorrido. */
function projeto(nome: string, registro: unknown | null) {
  const p = projetoTemporario(nome);
  ajustarManifesto(p, '  # test: nao detectado', '  test: "test -f passa.flag || { cat saida.txt; exit 1; }"');
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const cwd = t.worktree ?? p.dir;
  fs.writeFileSync(path.join(cwd, 'saida.txt'), SPEC_TEMPO_DECORRIDO, 'utf8');
  if (registro !== null) {
    fs.mkdirSync(path.join(cwd, 'core'), { recursive: true });
    fs.writeFileSync(path.join(cwd, ARQUIVO_INSTABILIDADE), typeof registro === 'string' ? registro : JSON.stringify(registro), 'utf8');
  }
  fs.writeFileSync(path.join(cwd, 'passa.flag'), '', 'utf8');
  gravarBaseline(p.carregado, t.id);
  fs.rmSync(path.join(cwd, 'passa.flag'));
  return { p, t };
}

/** `/proc/stat` cuja janela entre duas leituras tem `pct`% de steal. */
function procStatComSteal(pct: number): () => string {
  let n = 0;
  return () => {
    n++;
    return `cpu  1000 0 500 ${2_000_000 + n * (100 - pct)} 0 0 0 ${n * pct} 0 0\n`;
  };
}

const NO_PRAZO = Date.parse('2026-10-10T12:00:00Z');

test('teste registrado de relogio, sob steal alto, vira verify.timeout; sem steal, regressao', () => {
  const registro = { contrato: CONTRATO_INSTABILIDADE, entradas: [entrada()] };
  const alto = projeto('instab-alto', registro);
  try {
    const r = verificar(alto.p.carregado, alto.t.id, { lerProcStat: procStatComSteal(75), agoraMs: NO_PRAZO });
    assert.deepEqual(r.regressoes, []);
    assert.deepEqual(r.motivos, ['verify.timeout']);
    assert.deepEqual(r.estouros[0].relogioSobSteal, ['o sensor responde em menos de 2 s']);
    const evento = lerLedger(dirThread(alto.p.dir, alto.t.id)).filter((e) => e.tipo === 'verify_run').at(-1) as Record<string, unknown>;
    assert.deepEqual(evento.instabilidade, { contrato: CONTRATO_INSTABILIDADE, arquivo: ARQUIVO_INSTABILIDADE,
      vigentes: ['o sensor responde em menos de 2 s'], vencidas: [], erros: [] });
  } finally {
    alto.p.limpar();
  }
  const baixo = projeto('instab-baixo', registro);
  try {
    const r = verificar(baixo.p.carregado, baixo.t.id, { lerProcStat: procStatComSteal(5), agoraMs: NO_PRAZO });
    assert.deepEqual(r.regressoes.map((c) => c.nome), ['test'], 'o registro nunca atenua sozinho');
  } finally {
    baixo.p.limpar();
  }
});

test('sem o registro, com entrada vencida ou com o registro fora do contrato, a asercao de tempo e regressao', () => {
  const casos: [string, unknown | null, number][] = [
    ['instab-ausente', null, NO_PRAZO],
    ['instab-vencida', { contrato: CONTRATO_INSTABILIDADE, entradas: [entrada()] }, Date.parse('2026-11-05T00:00:00Z')],
    ['instab-invalida', { contrato: CONTRATO_INSTABILIDADE, entradas: [entrada({ revalidarAte: '2026-12-31' })] }, NO_PRAZO],
    ['instab-ilegivel', '{ nao e json', NO_PRAZO],
  ];
  for (const [nome, registro, agoraMs] of casos) {
    const { p, t } = projeto(nome, registro);
    try {
      const r = verificar(p.carregado, t.id, { lerProcStat: procStatComSteal(75), agoraMs });
      assert.deepEqual(r.regressoes.map((c) => c.nome), ['test'], nome);
      if (nome === 'instab-vencida') {
        assert.deepEqual(r.instabilidade.vencidas.map((e) => e.teste), ['o sensor responde em menos de 2 s']);
        assert.match(textoDoVerify(r), /1 entrada\(s\) vencida\(s\)/);
      }
      if (nome === 'instab-invalida' || nome === 'instab-ilegivel') {
        assert.ok(r.instabilidade.erros.length > 0, nome);
        assert.match(textoDoVerify(r), /FORA DO CONTRATO, nenhuma entrada vale/);
      }
    } finally {
      p.limpar();
    }
  }
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lerLedger } from '../src/ledger';
import { caminhoOnboarding, ETAPAS_ONBOARDING, gravarEtapa, lerOnboarding, resetarOnboarding, textoDaPauta } from '../src/onboarding';
import { projetoTemporario } from './apoio';

/** A barreira força leitores sem trava a observarem a mesma versão do documento. */
async function concorrentes(dir: string, chamadas: string[]): Promise<void> {
  const barreira = fs.mkdtempSync(path.join(dir, 'barreira-'));
  const preload = path.join(barreira, 'preload.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs'), path = require('node:path');
    const ler = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      const valor = ler.call(this, file, ...args);
      if (file === ${JSON.stringify(caminhoOnboarding(dir))}) {
        fs.writeFileSync(path.join(${JSON.stringify(barreira)}, process.pid + '.ready'), '');
        const limite = Date.now() + 300;
        while (Date.now() < limite && fs.readdirSync(${JSON.stringify(barreira)}).filter(f => f.endsWith('.ready')).length < ${chamadas.length})
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      return valor;
    };
  `);
  const resultados = await Promise.allSettled(chamadas.map(chamada => promisify(execFile)(process.execPath,
    ['--require', preload, '-e', `const o = require(${JSON.stringify(path.resolve(__dirname, '../src/onboarding.js'))}); ${chamada}`],
    { cwd: dir, timeout: 10000 })));
  for (const resultado of resultados) assert.equal(resultado.status, 'fulfilled', String(resultado.status === 'rejected' ? resultado.reason : ''));
}

test('set concorrente de três etapas preserva todas as respostas e eventos confirmados', async () => {
  const p = projetoTemporario('onboarding-concorrente');
  try {
    gravarEtapa(p.dir, 'auditores', 'revisão');
    await concorrentes(p.dir, ['maestro', 'produtos', 'skills'].map(etapa =>
      `o.gravarEtapa(process.cwd(), '${etapa}', { publico: '${etapa}' }, 'teste');`));
    const estado = lerOnboarding(p.dir);
    for (const etapa of ['maestro', 'produtos', 'skills'] as const) assert.deepEqual(estado.etapas[etapa]?.conteudo, { publico: etapa });
    assert.equal(estado.etapas.auditores?.conteudo, 'revisão');
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, 4);
  } finally { p.limpar(); }
});

test('set e reset concorrentes relêem sob a mesma trava, inclusive para idempotência', async () => {
  const p = projetoTemporario('onboarding-reset-concorrente');
  try {
    gravarEtapa(p.dir, 'auditores', 'preservar');
    await concorrentes(p.dir, Array(3).fill("o.gravarEtapa(process.cwd(), 'maestro', { nome: 'Equipe' });"));
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, 2, 'mesmo conteúdo só gera um set');
    await concorrentes(p.dir, ["o.resetarOnboarding(process.cwd(), 'maestro');", "o.resetarOnboarding(process.cwd(), 'maestro');",
      "o.gravarEtapa(process.cwd(), 'produtos', ['CLI']);"]);
    const estado = lerOnboarding(p.dir);
    assert.equal(estado.etapas.maestro, null);
    assert.equal(estado.etapas.auditores?.conteudo, 'preservar');
    assert.deepEqual(estado.etapas.produtos?.conteudo, ['CLI']);
    const eventos = lerLedger(path.join(p.dir, '.orkastery'));
    assert.equal(eventos.filter(e => e.acao === 'reset').length, 1, 'reset repetido não duplica evento');
    assert.equal(eventos.length, 4);
    await concorrentes(p.dir, Array(3).fill('o.resetarOnboarding(process.cwd());'));
    assert.ok(Object.values(lerOnboarding(p.dir).etapas).every(r => r === null));
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, 6, 'reset total registra cada etapa uma vez');
  } finally { p.limpar(); }
});

test('onboarding normaliza ausência, JSON inválido e formas legadas sem escrever', () => {
  const p = projetoTemporario('onboarding-normaliza');
  try {
    const arquivo = caminhoOnboarding(p.dir);
    assert.equal(fs.existsSync(arquivo), false);
    assert.equal(Object.values(lerOnboarding(p.dir).etapas).filter(Boolean).length, 0);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    for (const valor of ['{', 'null', '[]', '1', '{}', '{"etapas":[]}', '{"etapas":{"maestro":false}}']) {
      fs.writeFileSync(arquivo, valor);
      const r = lerOnboarding(p.dir);
      assert.equal(r.contrato, 'ork.onboarding/v1');
      assert.equal(Object.keys(r.etapas).length, 9);
      assert.ok(Object.values(r.etapas).every(x => x === null));
      assert.equal(fs.readFileSync(arquivo, 'utf8'), valor);
    }
    fs.writeFileSync(arquivo, JSON.stringify({ contrato: 'legado', etapas: {
      maestro: { por: 'Teste', respondidaEm: '2026-01-01T00:00:00Z', conteudo: { objetivo: 'público' } },
      skills: { por: 3, respondidaEm: false, conteudo: null }, desconhecida: {} } }));
    assert.equal(lerOnboarding(p.dir).etapas.maestro?.por, 'Teste');
    assert.equal(lerOnboarding(p.dir).etapas.skills, null);
  } finally { p.limpar(); }
});

test('set preserva oito etapas e repetir JSON canônico preserva bytes, autoria e eventos', () => {
  const p = projetoTemporario('onboarding-set');
  try {
    gravarEtapa(p.dir, 'skills', ['revisão'], 'autor');
    const antes = lerOnboarding(p.dir);
    gravarEtapa(p.dir, 'maestro', { b: [2, 1], a: { z: true, c: 1 } }, 'autor');
    const arquivo = fs.readFileSync(caminhoOnboarding(p.dir), 'utf8');
    const eventos = lerLedger(path.join(p.dir, '.orkastery'));
    const repetido = gravarEtapa(p.dir, 'maestro', { a: { c: 1, z: true }, b: [2, 1] }, 'outro');
    assert.equal(fs.readFileSync(caminhoOnboarding(p.dir), 'utf8'), arquivo);
    assert.deepEqual(lerLedger(path.join(p.dir, '.orkastery')), eventos);
    assert.equal(repetido.etapas.maestro?.por, 'autor');
    for (const e of ETAPAS_ONBOARDING.filter(e => e !== 'maestro')) assert.deepEqual(repetido.etapas[e], antes.etapas[e]);
    const evento = eventos.at(-1)!;
    assert.equal(evento.thread, 'projeto');
    assert.equal(evento.tipo, 'onboarding_recorded');
    assert.match(String(evento.sha256), /^[a-f0-9]{64}$/);
    assert.equal('conteudo' in evento, false);
    gravarEtapa(p.dir, 'maestro', { a: { c: 1, z: true }, b: [1, 2] });
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, eventos.length + 1);
  } finally { p.limpar(); }
});

test('mutação recusa perda de resposta legada; reset explícito remove somente a etapa indicada', () => {
  const p = projetoTemporario('onboarding-legado');
  try {
    gravarEtapa(p.dir, 'skills', ['preservar']);
    const arquivo = caminhoOnboarding(p.dir), estado = lerOnboarding(p.dir);
    estado.etapas.auditores = { por: 'legado', respondidaEm: '2026-01-01T00:00:00Z', conteudo: { nota: 'texto público '.repeat(1400) } };
    fs.writeFileSync(arquivo, JSON.stringify(estado));
    const antes = fs.readFileSync(arquivo, 'utf8'), eventos = lerLedger(path.join(p.dir, '.orkastery'));
    assert.equal(lerOnboarding(p.dir).etapas.auditores, null, 'leitura continua normalizando');
    for (const alterar of [() => gravarEtapa(p.dir, 'produtos', {}), () => resetarOnboarding(p.dir, 'skills')]) {
      assert.throws(alterar, /onboarding.legacy.invalid/);
      assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
      assert.deepEqual(lerLedger(path.join(p.dir, '.orkastery')), eventos);
    }
    const reset = resetarOnboarding(p.dir, 'auditores');
    assert.equal(reset.etapas.auditores, null);
    assert.deepEqual(reset.etapas.skills, estado.etapas.skills);
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).at(-1)?.etapa, 'auditores');
    gravarEtapa(p.dir, 'produtos', {});
    assert.ok(lerOnboarding(p.dir).etapas.produtos, 'recusa libera a trava para a próxima mutação');
  } finally { p.limpar(); }
});

test('arquivo ilegível ou resposta não representável nunca é apagado por set', () => {
  const p = projetoTemporario('onboarding-legado-invalido');
  try {
    gravarEtapa(p.dir, 'skills', []);
    const arquivo = caminhoOnboarding(p.dir), eventos = lerLedger(path.join(p.dir, '.orkastery'));
    const resposta = { por: 'legado', respondidaEm: '2026-01-01', conteudo: 'público' };
    for (const bruto of ['{', 'null', '[]', JSON.stringify({ etapas: { desconhecida: resposta } }),
      JSON.stringify({ etapas: { auditores: { ...resposta, por: 5 } } }),
      JSON.stringify({ etapas: { auditores: { ...resposta, conteudo: 'p'.repeat(256 * 1024) } } })]) {
      fs.writeFileSync(arquivo, bruto);
      assert.throws(() => gravarEtapa(p.dir, 'produtos', {}), /onboarding.legacy.invalid/);
      assert.equal(fs.readFileSync(arquivo, 'utf8'), bruto);
      assert.deepEqual(lerLedger(path.join(p.dir, '.orkastery')), eventos);
    }
  } finally { p.limpar(); }
});

test('resposta legada insegura continua filtrada e recusa não ecoa nem republica conteúdo', () => {
  const p = projetoTemporario('onboarding-legado-seguranca');
  const sentinela = 'SENTINELA_SINTETICA_LEGADA';
  try {
    gravarEtapa(p.dir, 'skills', []);
    const arquivo = caminhoOnboarding(p.dir), estado = lerOnboarding(p.dir);
    estado.etapas.auditores = { por: 'legado', respondidaEm: '2026-01-01', conteudo: { senha: sentinela } };
    fs.writeFileSync(arquivo, JSON.stringify(estado));
    const antes = fs.readFileSync(arquivo, 'utf8');
    assert.equal(lerOnboarding(p.dir).etapas.auditores, null);
    assert.throws(() => gravarEtapa(p.dir, 'produtos', {}), e => {
      assert.ok(!String(e).includes(sentinela)); return /onboarding.legacy.invalid/.test(String(e));
    });
    assert.equal(fs.readFileSync(arquivo, 'utf8'), antes);
    resetarOnboarding(p.dir);
    assert.ok(!fs.readFileSync(arquivo, 'utf8').includes(sentinela));
    assert.ok(!JSON.stringify(lerLedger(path.join(p.dir, '.orkastery'))).includes(sentinela));
  } finally { p.limpar(); }
});

test('reset seletivo e total são idempotentes inclusive quando já pendente', () => {
  const p = projetoTemporario('onboarding-reset');
  try {
    resetarOnboarding(p.dir);
    assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
    gravarEtapa(p.dir, 'maestro', 'Equipe');
    gravarEtapa(p.dir, 'skills', ['testar']);
    const r = resetarOnboarding(p.dir, 'maestro', 'teste');
    assert.equal(r.etapas.maestro, null);
    assert.deepEqual(r.etapas.skills?.conteudo, ['testar']);
    const bytes = fs.readFileSync(caminhoOnboarding(p.dir), 'utf8');
    resetarOnboarding(p.dir, 'maestro');
    assert.equal(fs.readFileSync(caminhoOnboarding(p.dir), 'utf8'), bytes);
    assert.ok(Object.values(resetarOnboarding(p.dir).etapas).every(x => x === null));
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, 4);
    resetarOnboarding(p.dir);
    assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, 4);
  } finally { p.limpar(); }
});

test('atualizadoEm usa a data semanticamente mais recente e preserva carimbo de reset', () => {
  const p = projetoTemporario('onboarding-timestamps');
  try {
    gravarEtapa(p.dir, 'maestro', 'Equipe');
    const arquivo = caminhoOnboarding(p.dir), estado = lerOnboarding(p.dir);
    estado.etapas.maestro!.respondidaEm = '2026-09-08T02:00:00+03:00';
    estado.etapas.skills = { por: 'teste', respondidaEm: '2026-09-07T23:30:00Z', conteudo: [] };
    for (const topo of ['1999-01-01T00:00:00Z', 'inválido', null]) {
      estado.atualizadoEm = topo;
      fs.writeFileSync(arquivo, JSON.stringify(estado));
      assert.equal(Date.parse(lerOnboarding(p.dir).atualizadoEm!), Date.parse(estado.etapas.skills.respondidaEm));
    }
    estado.atualizadoEm = '2026-09-08T00:00:00Z';
    fs.writeFileSync(arquivo, JSON.stringify(estado));
    assert.equal(lerOnboarding(p.dir).atualizadoEm, estado.atualizadoEm, 'reset posterior a respostas sobrevive');
    estado.etapas.maestro = null; estado.etapas.skills = null;
    fs.writeFileSync(arquivo, JSON.stringify(estado));
    assert.equal(lerOnboarding(p.dir).atualizadoEm, estado.atualizadoEm, 'reset total mantém carimbo');
  } finally { p.limpar(); }
});

test('set e reset não fazem atualizadoEm retroceder diante de resposta futura válida', () => {
  const p = projetoTemporario('onboarding-relogio');
  try {
    gravarEtapa(p.dir, 'maestro', 'Equipe');
    const estado = lerOnboarding(p.dir), futuro = '2099-01-01T00:00:00Z';
    estado.etapas.maestro!.respondidaEm = futuro;
    fs.writeFileSync(caminhoOnboarding(p.dir), JSON.stringify(estado));
    assert.equal(Date.parse(gravarEtapa(p.dir, 'skills', []).atualizadoEm!), Date.parse(futuro));
    assert.equal(Date.parse(resetarOnboarding(p.dir, 'skills').atualizadoEm!), Date.parse(futuro));
    assert.equal(Date.parse(resetarOnboarding(p.dir).atualizadoEm!), Date.parse(futuro));
  } finally { p.limpar(); }
});

test('recusa etapa, autoria e JSON não serializável antes de qualquer alteração', () => {
  const p = projetoTemporario('onboarding-invalid');
  try {
    for (const call of [() => gravarEtapa(p.dir, '../../x', {}), () => resetarOnboarding(p.dir, 'constructor'),
      () => gravarEtapa(p.dir, 'maestro', undefined), () => gravarEtapa(p.dir, 'maestro', NaN),
      () => gravarEtapa(p.dir, 'maestro', new Date()), () => gravarEtapa(p.dir, 'maestro', {}, ''),
      () => gravarEtapa(p.dir, 'maestro', 'x'.repeat(16385)),
      () => gravarEtapa(p.dir, 'maestro', JSON.parse('{"__proto__":{}}'))]) {
      assert.throws(call, /onboarding.input.invalid/);
      assert.equal(fs.existsSync(caminhoOnboarding(p.dir)), false);
      assert.equal(lerLedger(path.join(p.dir, '.orkastery')).length, 0);
    }
  } finally { p.limpar(); }
});

test('credenciais aceitam referências e rejeitam sentinelas sem eco em estado, ledger ou erro', () => {
  const p = projetoTemporario('onboarding-secrets');
  const sentinela = 'SEGREDO_SINTETICO_NAO_REAL';
  try {
    gravarEtapa(p.dir, 'credenciais', { provedor: 'exemplo', env: ['EXEMPLO_API_KEY'] });
    gravarEtapa(p.dir, 'bancos', { banco: 'postgres', env: ['PROJETO_DATABASE_URL'] });
    const antes = fs.readFileSync(caminhoOnboarding(p.dir), 'utf8');
    const casos: [string, unknown][] = [
      ['credenciais', { token: sentinela }], ['bancos', { env: [sentinela + '=valor'] }],
      ['bancos', 'postgres://owner:' + sentinela + '@localhost/db'],
      ['maestro', { aninhado: [{ password: sentinela }] }], ['skills', 'token=' + sentinela],
      ['produtos', { url: 'https://owner:' + sentinela + '@example.invalid' }],
      ['credenciais', { texto: sentinela }], ['maestro', { token_env: sentinela + '=valor' }],
    ];
    for (const [etapa, conteudo] of casos) {
      assert.throws(() => gravarEtapa(p.dir, etapa, conteudo), e => {
        assert.ok(!String(e).includes(sentinela)); return /onboarding.input.invalid/.test(String(e));
      });
      assert.equal(fs.readFileSync(caminhoOnboarding(p.dir), 'utf8'), antes);
      assert.ok(!JSON.stringify(lerLedger(path.join(p.dir, '.orkastery'))).includes(sentinela));
    }
    const bruto = lerOnboarding(p.dir);
    bruto.etapas.maestro = { por: 'teste', respondidaEm: new Date().toISOString(), conteudo: { senha: sentinela } };
    fs.writeFileSync(caminhoOnboarding(p.dir), JSON.stringify(bruto));
    assert.equal(lerOnboarding(p.dir).etapas.maestro, null, 'leitura de legado não republica segredo');
    assert.equal(textoDaPauta().split('[pendente]').length - 1, 9);
  } finally { p.limpar(); }
});

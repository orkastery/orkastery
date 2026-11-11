import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { main } from '../src/index';
import { ativarLocale, chaveDoLocale, cobreLocale, msg } from '../src/locale';
import { AJUDA_EN, AJUDA_PT_BR, DadosDaAjuda } from '../src/locale-ajuda';
import { comandoTelemetria, CONTRATO_CLI_TELEMETRIA, DependenciasTelemetriaCli,
  FonteDaTelemetria } from '../src/telemetria-cli';

const ligada = { ligada: true, origem: 'builder' as const, motivo: 'ativada pelo builder', pseudonimo: 'a'.repeat(64) };
const desligada = { ligada: false, origem: 'ausente' as const, motivo: 'configuração privada ausente', pseudonimo: null };
const fonte: FonteDaTelemetria = { thread: 'ork-teste', ledger: '/ledger', cursor: '/cursor', lock: '/lock' };
const contexto = { serviceVersion: 'teste', instrumentacaoVersion: 'teste', pseudonimo: 'a'.repeat(64),
  redigir: (texto: string) => ({ ok: true, texto }), observadoEmNano: () => 1n };

function deps(parcial: Partial<DependenciasTelemetriaCli> = {}): Partial<DependenciasTelemetriaCli> {
  return {
    resolverAtivacao: () => ligada,
    gravarAtivacao: () => ({}),
    fontes: () => [fonte],
    estado: () => ({ thread: fonte.thread, pendingBytes: 12, lastConfirmedUid: 'anterior', terminal: false }),
    contexto: () => contexto,
    destino: () => 'https://collector.test/v1/logs',
    exportar: async () => ({ estado: 'enviado', registros: 1, uids: ['uid'] }),
    ...parcial,
  };
}

test('desligada, status e envio não enumeram thread, ledger, header ou transporte', async () => {
  let fontes = 0, exportacoes = 0, destinos = 0;
  const dependencias = deps({ resolverAtivacao: () => desligada,
    fontes: () => { fontes += 1; throw new Error('não deveria enumerar'); },
    destino: () => { destinos += 1; throw new Error('não deveria ler destino'); },
    exportar: async () => { exportacoes += 1; throw new Error('não deveria transportar'); } });
  for (const subcomando of ['status', 'enviar']) {
    const r = await comandoTelemetria({ raiz: '/projeto', subcomando, json: true, escrever: () => {}, dependencias });
    assert.equal(r.codigo, 0); assert.equal(r.resposta.enabled, false);
    assert.deepEqual(r.resposta.threads, []);
  }
  assert.deepEqual({ fontes, exportacoes, destinos }, { fontes: 0, exportacoes: 0, destinos: 0 });
});

test('ligar e desligar alteram somente a configuração privada', async () => {
  const valores: boolean[] = [];
  const dependencias = deps({ gravarAtivacao: (enabled) => { valores.push(enabled); return {}; },
    fontes: () => { throw new Error('não deveria enumerar'); } });
  const a = await comandoTelemetria({ raiz: '/projeto', subcomando: 'ligar', escrever: () => {}, dependencias });
  const b = await comandoTelemetria({ raiz: '/projeto', subcomando: 'desligar', escrever: () => {}, dependencias });
  assert.deepEqual(valores, [true, false]);
  assert.deepEqual([a.resposta.enabled, b.resposta.enabled], [true, false]);
});

test('status JSON é estável, usa destino sanitizado e informa pendências', async () => {
  const linhas: string[] = [];
  const r = await comandoTelemetria({ raiz: '/projeto', subcomando: 'status', json: true,
    escrever: (linha) => linhas.push(linha), dependencias: deps() });
  assert.equal(r.resposta.schema, CONTRATO_CLI_TELEMETRIA);
  assert.equal(r.resposta.command, 'status');
  assert.equal(r.resposta.destination, 'https://collector.test/v1/logs');
  assert.deepEqual(r.resposta.threads, [{ thread: 'ork-teste', pendingBytes: 12,
    lastConfirmedUid: 'anterior', terminal: false }]);
  assert.deepEqual(JSON.parse(linhas[0]), r.resposta);
});

test('dry-run encaminha a opção sem transporte e expõe somente o payload mapeado', async () => {
  let dryRun = false, offset: number | undefined;
  const payload = { resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [] }] };
  const dependencias = deps({ exportar: async (opcoes) => {
    dryRun = opcoes.dryRun === true;
    offset = opcoes.dryRunOffset;
    return { estado: 'dry-run', registros: 1, uids: ['uid'], payload };
  } });
  const r = await comandoTelemetria({ raiz: '/projeto', subcomando: 'enviar', dryRun: true,
    offset: 123, json: true, escrever: () => {}, dependencias });
  assert.equal(dryRun, true); assert.equal(offset, 123); assert.equal(r.codigo, 0);
  assert.deepEqual((r.resposta.results as Array<Record<string, unknown>>)[0].payload, payload);
});

test('index valida opções públicas de telemetria e a rota do locale inglês cobre a família', () => {
  assert.throws(() => main(['telemetria', 'enviar', '--offset', '1']), /telemetria/);
  assert.throws(() => main(['telemetria', 'enviar', '--dry-run', '--offset', 'invalido']), /telemetria/);
  assert.equal(chaveDoLocale(['telemetria', 'enviar'], { 'dry-run': true, offset: '1' }), 'telemetria enviar');
  assert.equal(cobreLocale(['telemetria', 'enviar'], { 'dry-run': true, offset: '1' }), true);
  ativarLocale('en');
  try { assert.match(msg().telemetria.uso, /^usage: .*--offset <byte>/); }
  finally { ativarLocale(undefined); }
});

test('ajuda real mantém paridade de opções de telemetria em pt-BR e inglês', () => {
  const dados: DadosDaAjuda = { versao: 'teste', modos: 4, segredos: 'fora do arquivo', tags: '#Classic #Auto' };
  const linhas = (texto: string) => texto.split('\n').filter((linha) => /telemetria enviar|--offset <byte>/.test(linha));
  const opcoes = (linha: string) => linha.match(/--[a-z-]+(?: <byte>)?/g) ?? [];
  const pt = linhas(AJUDA_PT_BR.texto(dados)), en = linhas(AJUDA_EN.texto(dados));
  assert.equal(pt.length, 2); assert.equal(en.length, 2);
  assert.deepEqual(pt.map(opcoes), en.map(opcoes));
  assert.match(en.join('\n'), /Sends OTLP\/HTTP logs; --dry-run shows from the start without reading the cursor/);
  assert.match(en.join('\n'), /In dry-run, starts at this ledger byte instead of the beginning/);
});

test('falha de envio produz código diferente de zero sem cabeçalhos na resposta', async () => {
  const dependencias = deps({ exportar: async () => ({ estado: 'pendente', registros: 1, uids: ['uid'] }) });
  const r = await comandoTelemetria({ raiz: '/projeto', subcomando: 'enviar', json: true,
    env: { OTEL_EXPORTER_OTLP_HEADERS: 'authorization=segredo' }, escrever: () => {}, dependencias });
  assert.equal(r.codigo, 1);
  assert.equal(JSON.stringify(r.resposta).includes('authorization'), false);
  assert.equal(JSON.stringify(r.resposta).includes('segredo'), false);
});

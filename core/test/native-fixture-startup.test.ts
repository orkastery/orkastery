import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { aguardarPostgresFinal, analisarArranque, arrancarFixture, LeituraDeArranque } from './native-fixture';

// Nenhum teste deste arquivo fala com Docker, com o provisionador ou com usingFixture: tudo entra por
// leitor injetado. O estado de /tmp e conferido no fim para provar que nada foi provisionado.
const provisionadas = () => fs.readdirSync('/tmp').filter(n => n.startsWith('ork-prospective-fixture-')).sort();
const antes = provisionadas();
const RECIBO_ANTES = process.env.ORK_NATIVE_FIXTURE_RECEIPT;
const CONTAINER = 'a'.repeat(64), IDENTIDADE = 'b'.repeat(64);

const TEMPORARIO = [
  '2026-09-08 18:16:40.100 UTC [42] LOG:  starting PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2)',
  '2026-09-08 18:16:40.101 UTC [42] LOG:  listening on Unix socket "/var/run/postgresql/fixture/.s.PGSQL.5432"',
  '2026-09-08 18:16:40.110 UTC [42] LOG:  database system is ready to accept connections',
].join('\n') + '\n';
const MARCADOR = 'PostgreSQL init process complete; ready for start up.';
const PRONTO_FINAL = '2026-09-08 18:16:41.300 UTC [1] LOG:  database system is ready to accept connections';
const TRANSICAO = TEMPORARIO + [
  '2026-09-08 18:16:41.000 UTC [42] LOG:  received fast shutdown request',
  '2026-09-08 18:16:41.050 UTC [42] LOG:  database system is shut down',
  MARCADOR,
  '2026-09-08 18:16:41.200 UTC [1] LOG:  starting PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2)',
  PRONTO_FINAL,
].join('\n') + '\n';

/**
 * Relogio explicitamente controlado: o tempo so anda quando o teste manda. O oraculo destes testes
 * e a propriedade temporal (nunca dormir alem do limite, nunca liberar DDL depois dele), nao a
 * contagem incidental de consultas ao relogio que a guarda faz por dentro.
 */
const relogioControlado = () => { let t = 0; return { agora: () => t, avancar: (ms: number) => { t += ms; }, valor: () => t }; };
const leitor = (roteiro: LeituraDeArranque[]) => {
  const lidas: string[] = [], saldos: number[] = [];
  return { lidas, saldos, ler: (container: string, saldoMs: () => number) => {
    lidas.push(container); saldos.push(saldoMs());
    return roteiro[Math.min(lidas.length - 1, roteiro.length - 1)];
  } };
};
const viva = (logs: string): LeituraDeArranque => ({ rodando: true, identidade: IDENTIDADE, logs });

test('servidor temporario do entrypoint nao libera DDL; so o postgres final PID 1 libera', () => {
  // A prova de que a guarda antiga era insuficiente: o log do temporario ja anuncia "ready to accept".
  const temporario = analisarArranque(TEMPORARIO);
  assert.equal(temporario.final, -1);
  assert.equal(temporario.temporario, true);
  const { lidas, ler } = leitor([viva(TEMPORARIO), viva(TEMPORARIO), viva(TRANSICAO)]);
  const relogio = relogioControlado();
  let ddlNaLeitura = -1, ddls = 0;
  arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; ddlNaLeitura = lidas.length; },
    { ler, agora: relogio.agora, dormir: relogio.avancar });
  assert.equal(ddls, 1);
  assert.equal(ddlNaLeitura, 3, 'o DDL so pode correr depois da leitura que mostra o servidor final');
  assert.deepEqual([...new Set(lidas)], [CONTAINER], 'so o container exato e consultado');
  const final = analisarArranque(TRANSICAO);
  assert.equal(final.temporario, true);
  assert.equal(final.transicaoCompleta, true);
  assert.equal(final.parado, false);
});

test('linha estrutural citada dentro de um diagnostico nunca vale como servidor final nem como marcador', () => {
  // Exatamente as duas contraprovas do achado CI04-02: o texto aparece, a estrutura nao.
  const citada = (linha: string) => 'diagnostico textual: ' + linha;
  const finalCitado = [TEMPORARIO.trimEnd(), citada(MARCADOR), citada(PRONTO_FINAL)].join('\n') + '\n';
  const marcadorCitado = [TEMPORARIO.trimEnd(), citada(MARCADOR), PRONTO_FINAL].join('\n') + '\n';
  assert.equal(analisarArranque(finalCitado).final, -1, 'linha citada nao e o pronto do PID 1');
  assert.equal(analisarArranque(marcadorCitado).transicaoCompleta, false, 'marcador citado nao completa a transicao');
  let ddls = 0;
  const correr = (logs: string) => {
    const relogio = relogioControlado();
    return arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; },
      { ler: leitor([viva(logs)]).ler, agora: relogio.agora, dormir: relogio.avancar, prazoMs: 500 });
  };
  assert.throws(() => correr(finalCitado), /runtime\.fixture\.startup-timeout/);
  assert.throws(() => correr(marcadorCitado), /runtime\.fixture\.startup-unfinished/);
  // Sufixo e prefixo colados na propria linha estrutural tambem nao passam.
  assert.equal(analisarArranque(TEMPORARIO + PRONTO_FINAL + ' (reproduzido)\n').final, -1);
  assert.equal(analisarArranque(TEMPORARIO + '> ' + PRONTO_FINAL + '\n').final, -1);
  assert.equal(analisarArranque(TEMPORARIO + MARCADOR + ' (citado)\n' + PRONTO_FINAL + '\n').transicaoCompleta, false);
  // O log nativo real, com CR do transporte, continua reconhecido: a ancora nao quebra o caminho feliz.
  assert.equal(analisarArranque(TRANSICAO.split('\n').join('\r\n')).transicaoCompleta, true);
  assert.equal(ddls, 0, 'nenhuma citacao chega ao DDL');
});

test('prazo monotonico finito termina em erro tipado, sem DDL, sem dormir alem do limite e sem espera infinita', () => {
  const { lidas, saldos, ler } = leitor([viva(TEMPORARIO)]);
  const relogio = relogioControlado();
  let ddls = 0;
  const dormidas: number[] = [];
  assert.throws(() => arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; },
    { ler, agora: relogio.agora, dormir: ms => { dormidas.push(ms); relogio.avancar(ms); },
      prazoMs: 500, intervaloMs: 100 }), /runtime\.fixture\.startup-timeout/);
  assert.equal(ddls, 0);
  assert.equal(relogio.valor(), 500, 'a guarda nunca dorme para alem do limite');
  assert.ok(dormidas.every(ms => ms > 0) && dormidas.reduce((a, b) => a + b, 0) === 500, 'cada espera cabe no saldo');
  assert.deepEqual(saldos, [500, 400, 300, 200, 100], 'o leitor recebe o saldo real, positivo e decrescente');
  assert.equal(lidas.length, 5, 'o laco termina: nao ha leitura depois do limite');
});

test('pronto que chega no limite ou depois dele nao libera DDL; antes do limite libera', () => {
  // O leitor injetado pode gastar mais do que o saldo; o que nao pode e o retorno tardio virar DDL.
  const caso = (relogioNoRetorno: number) => {
    const relogio = relogioControlado();
    let ddls = 0, erro: string | null = null;
    const ler = (_c: string, saldoMs: () => number) => {
      saldoMs(); relogio.avancar(relogioNoRetorno - relogio.valor());
      return viva(TRANSICAO);
    };
    try { arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; }, { ler, agora: relogio.agora, dormir: relogio.avancar, prazoMs: 500 }); }
    catch (e) { erro = (e as Error).message; }
    return { ddls, erro };
  };
  assert.deepEqual(caso(499), { ddls: 1, erro: null }, 'sucesso estritamente antes do limite e preservado');
  assert.deepEqual(caso(500), { ddls: 0, erro: 'runtime.fixture.startup-timeout' }, 'alcancar o limite ja e expiracao');
  assert.deepEqual(caso(501), { ddls: 0, erro: 'runtime.fixture.startup-timeout' }, 'ultrapassar o limite nunca libera DDL');
});

/**
 * Instrumenta o parser: `analisarArranque` quebra o log em linhas, entao trocar `split` por um
 * envelope que gasta relogio simula, de forma deterministica, o tempo consumido DENTRO da analise.
 * A troca e sempre restaurada em `finally`, e nenhuma espera real acontece.
 */
const comParserInstrumentado = <T>(gastar: (texto: string) => void, executar: () => T): T => {
  const original = String.prototype.split;
  String.prototype.split = function (this: string, separador: string | RegExp, limite?: number) {
    if (separador === '\n') gastar(String(this));
    return Reflect.apply(original, this, limite === undefined ? [separador] : [separador, limite]) as string[];
  } as typeof String.prototype.split;
  try { return executar(); } finally { String.prototype.split = original; }
};

test('o tempo gasto dentro do parser conta contra o prazo e nao libera DDL depois do limite', () => {
  // Contraprova do residual da C62: o leitor volta pontual em 0 e quem gasta o prazo e o proprio
  // analisador do log. O relogio so anda DENTRO do parse, nunca no leitor, senao a prova seria de
  // outra coisa; nada aqui dorme de verdade e o monkeypatch e restaurado em finally.
  const caso = (relogioNoParse: number) => {
    const relogio = relogioControlado();
    let ddls = 0, erro: string | null = null, parse = false;
    const gastar = (texto: string) => {
      if (texto !== TRANSICAO) return;
      parse = true; relogio.avancar(relogioNoParse - relogio.valor());
    };
    try {
      comParserInstrumentado(gastar, () => arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; },
        { ler: leitor([viva(TRANSICAO)]).ler, agora: relogio.agora, dormir: relogio.avancar, prazoMs: 500 }));
    } catch (e) { erro = (e as Error).message; }
    return { ddls, erro, parse, relogio: relogio.valor() };
  };
  assert.deepEqual(caso(499), { ddls: 1, erro: null, parse: true, relogio: 499 },
    'sucesso estritamente antes do limite conta o tempo gasto dentro do parser');
  assert.deepEqual(caso(500), { ddls: 0, erro: 'runtime.fixture.startup-timeout', parse: true, relogio: 500 },
    'prazo alcancado durante o parse ja e expiracao');
  assert.deepEqual(caso(501), { ddls: 0, erro: 'runtime.fixture.startup-timeout', parse: true, relogio: 501 },
    'prazo ultrapassado durante o parse nunca libera DDL');
});

test('log sem servidor final nunca dorme com saldo esgotado nem negativo', () => {
  // Ultimo ramo do residual da C62: sem `final` a guarda caia direto no `dormir`, e o prazo gasto
  // DENTRO do parser virava espera zero ou negativa. Contraprova do condutor no HEAD 0b30309:
  // `evidence/condutor-startup-parser-negative-sleep.json` registra `sleeps: [-1]` com parse de 501.
  const caso = (relogioNoParse: number) => {
    const relogio = relogioControlado();
    const dormidas: number[] = [];
    let ddls = 0, erro: string | null = null, parses = 0;
    const gastar = (texto: string) => {
      if (texto !== TEMPORARIO) return;
      parses += 1;
      // So o primeiro parse gasta: o avanco e absoluto e nunca anda para tras.
      if (parses === 1) relogio.avancar(relogioNoParse - relogio.valor());
    };
    try {
      comParserInstrumentado(gastar, () => arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; },
        { ler: leitor([viva(TEMPORARIO)]).ler, agora: relogio.agora,
          dormir: ms => { dormidas.push(ms); relogio.avancar(ms); }, prazoMs: 500, intervaloMs: 100 }));
    } catch (e) { erro = (e as Error).message; }
    return { ddls, erro, dormidas, parses };
  };
  const expirou = 'runtime.fixture.startup-timeout';
  assert.deepEqual(caso(500), { ddls: 0, erro: expirou, dormidas: [], parses: 1 },
    'prazo alcancado dentro do parser recusa antes de dormir: nenhuma espera de 0');
  assert.deepEqual(caso(501), { ddls: 0, erro: expirou, dormidas: [], parses: 1 },
    'prazo ultrapassado dentro do parser nunca vira dormir(-1)');
  assert.deepEqual(caso(499), { ddls: 0, erro: expirou, dormidas: [1], parses: 1 },
    'com 1ms de saldo a espera e limitada ao saldo positivo e o laco encerra no limite');
});

test('a guarda devolve o saldo residual do mesmo limite, ja descontado o tempo do parser', () => {
  // O saldo devolvido e o que a costura reconfere na entrada do DDL: nao recomeca a contagem.
  const relogio = relogioControlado();
  const gastar = (texto: string) => { if (texto === TRANSICAO) relogio.avancar(499 - relogio.valor()); };
  const saldo = comParserInstrumentado(gastar, () => aguardarPostgresFinal(CONTAINER, IDENTIDADE,
    { ler: leitor([viva(TRANSICAO)]).ler, agora: relogio.agora, dormir: relogio.avancar, prazoMs: 500 }));
  assert.equal(relogio.valor(), 499, 'o parse gastou 499 do prazo de 500');
  assert.equal(saldo(), 1, 'sobra exatamente o que resta do limite original');
  relogio.avancar(1);
  assert.equal(saldo(), 0, 'o saldo do retorno continua andando: a entrada do DDL recusa em zero');
});

test('prazo e intervalo invalidos sao recusados antes de qualquer leitura, espera ou DDL', () => {
  let ddls = 0;
  const { lidas, ler } = leitor([viva(TRANSICAO)]);
  const dormidas: number[] = [];
  for (const opcoes of [{ prazoMs: NaN }, { prazoMs: Infinity }, { prazoMs: 0 }, { prazoMs: -1 },
    { intervaloMs: NaN }, { intervaloMs: Infinity }, { intervaloMs: 0 }, { intervaloMs: -5 }]) {
    assert.throws(() => arrancarFixture(CONTAINER, IDENTIDADE, () => { ddls += 1; },
      { ler, agora: relogioControlado().agora, dormir: ms => { dormidas.push(ms); }, ...opcoes }),
      /runtime\.fixture\.startup-invalid/, JSON.stringify(opcoes));
  }
  assert.equal(ddls, 0); assert.equal(lidas.length, 0); assert.deepEqual(dormidas, []);
});

test('saida, identidade e parada divergentes falham tipado antes de qualquer DDL', () => {
  let ddls = 0;
  const ddl = () => { ddls += 1; };
  const correr = (leitura: LeituraDeArranque, container = CONTAINER) => {
    const relogio = relogioControlado();
    return arrancarFixture(container, IDENTIDADE, ddl,
      { ler: leitor([leitura]).ler, agora: relogio.agora, dormir: relogio.avancar, prazoMs: 500 });
  };

  // Container morto antes de anunciar o servidor final: erro, nunca DDL contra socket orfao.
  assert.throws(() => correr({ rodando: false, identidade: IDENTIDADE, logs: TEMPORARIO }), /runtime\.fixture\.startup-exited/);
  // Outro container com o mesmo socket nao serve: a identidade da fixture e conferida a cada leitura.
  assert.throws(() => correr({ rodando: true, identidade: 'c'.repeat(64), logs: TRANSICAO }), /runtime\.fixture\.startup-identity/);
  assert.throws(() => correr({ rodando: true, identidade: null, logs: TRANSICAO }), /runtime\.fixture\.startup-identity/);
  // Nome de container nao substitui o id de 64 hex do container recem-criado.
  assert.throws(() => correr(viva(TRANSICAO), 'ork-fixture-0123456789ab'), /runtime\.fixture\.startup-container/);
  // Pronto seguido de parada do PID 1 e exatamente o AdminShutdown que derrubou a fixture de 18:16:45Z.
  const parado = TRANSICAO + '2026-09-08 18:16:42.000 UTC [1] LOG:  received fast shutdown request\n';
  assert.throws(() => correr(viva(parado)), /runtime\.fixture\.startup-stopped/);
  assert.equal(analisarArranque(parado).parado, true);
  // Parada citada dentro de um diagnostico nao e parada do servidor, e o pronto final continua valendo.
  assert.equal(analisarArranque(TRANSICAO + 'diagnostico textual: 2026-09-08 18:16:42.000 UTC [1] LOG:  received fast shutdown request\n').parado, false);
  // Pronto do PID 1 sem o marcador do entrypoint, tendo havido temporario: transicao nao comprovada.
  const semMarcador = TEMPORARIO + PRONTO_FINAL + '\n';
  assert.throws(() => correr(viva(semMarcador)), /runtime\.fixture\.startup-unfinished/);
  assert.equal(ddls, 0, 'nenhuma divergencia pode chegar ao DDL');
});

test('a guarda do arranque nao provisiona fixture, nao chama Docker e nao toca o recibo externo', () => {
  assert.deepEqual(provisionadas(), antes, 'nenhum socket dir de fixture foi criado ou removido');
  assert.equal(process.env.ORK_NATIVE_FIXTURE_RECEIPT, RECIBO_ANTES);
  // aguardarPostgresFinal sem leitor injetado nem chega a Docker: o id invalido barra antes.
  assert.throws(() => aguardarPostgresFinal('nao-e-id', IDENTIDADE), /runtime\.fixture\.startup-container/);
  // Prazo invalido tambem barra antes de qualquer subprocesso, com id valido e sem leitor.
  assert.throws(() => aguardarPostgresFinal(CONTAINER, IDENTIDADE, { prazoMs: -1 }), /runtime\.fixture\.startup-invalid/);
});

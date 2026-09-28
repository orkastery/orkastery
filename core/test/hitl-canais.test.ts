/** D12: o registro dos quatro canais homologados. Nenhuma identidade aqui e real. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CANAIS, CONTRATO_CANAIS, ORDEM_DOS_CANAIS, canaisDoTransporte, canaisHomologados,
  canalDaResposta, conferirRegistro, definicaoDoCanal, equivalenciaDoCanal, ofertaDeCanais,
  parseCanal, recusarIngressoNaoHomologado, transporteDoCanal,
  VARIAVEL_DA_CHAVE, VARIAVEL_DA_CHAVE_V1, variavelDaChaveDoCanal,
} from '../src/hitl-canais';
import { ORDEM_DOS_HOSTS } from '../src/hosts';

const raiz = path.resolve(__dirname, '../../..');
const telegram = { ORK_HITL_INGRESS_KEY_HERMES: 'h'.repeat(48), ORK_HITL_INGRESS_KEY_OPENCLAW: 'o'.repeat(48),
  ORK_HITL_ROOT: '/tmp/ork-SIMULADO', ORK_HITL_TELEGRAM_BOT_ID: '99',
  ORK_HITL_OPENCLAW_ACCOUNT: 'conta-SIMULADA', ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' };

test('D12: sao quatro canais homologados, na ordem dos hosts, e o registro confere', () => {
  const canais = canaisHomologados();
  assert.equal(canais.length, 4);
  assert.deepEqual(canais.map(c => c.canal), ['claude-code', 'codex', 'hermes', 'openclaw']);
  assert.deepEqual([...ORDEM_DOS_CANAIS], [...ORDEM_DOS_HOSTS]);
  assert.deepEqual(conferirRegistro(), { contrato: CONTRATO_CANAIS, canais: 4, transportes: 2, chaves: 2 });
  // Os dois transportes preservados: reduzir qualquer um deles reduz canais.
  assert.deepEqual([...canaisDoTransporte('telegram')], ['hermes', 'openclaw']);
  assert.deepEqual([...canaisDoTransporte('mcp-local')], ['claude-code', 'codex']);
  assert.equal(transporteDoCanal('claude'), 'mcp-local');
  assert.equal(transporteDoCanal('open-claw'), 'telegram');
});

test('D12: nenhum canal entra sem identidade, correlacao e recibo, e as identidades sao distintas', () => {
  const identidades = new Set<string>();
  for (const canal of ORDEM_DOS_CANAIS) {
    const e = equivalenciaDoCanal(canal);
    for (const [nome, valor] of Object.entries(e)) {
      assert.ok(valor.trim().length > 0, `${canal} sem ${nome}`);
    }
    // O defeito que D12 conserta: Hermes e OpenClaw eram indistinguiveis no recibo.
    assert.equal(identidades.has(e.identidade), false, `identidade ambigua em ${canal}`);
    identidades.add(e.identidade);
    assert.ok(e.identidade.includes(canal), `${canal} precisa aparecer na identidade do recibo`);
  }
  assert.equal(identidades.size, 4);
});

test('D12: o adaptador de ingresso de cada canal existe em disco e nao e texto de tool', () => {
  for (const d of canaisHomologados()) {
    const alvo = path.join(raiz, d.adaptador);
    assert.ok(fs.statSync(alvo).isFile(), `adaptador ausente: ${d.adaptador}`);
    assert.equal(recusarIngressoNaoHomologado(d.ingresso), d.ingresso);
  }
  for (const falso of ['transcrito-de-tool', 'tool', 'argumento', '', null, undefined, 42, {}]) {
    assert.throws(() => recusarIngressoNaoHomologado(falso), /transcrito-de-tool/);
  }
  assert.throws(() => definicaoDoCanal('telegram'), /hitl.canal.desconhecido/);
  assert.equal(parseCanal('nao-existe'), null);
});

test('D12: a oferta diz por quais canais da para responder e por que os outros nao servem', () => {
  const semNada = ofertaDeCanais({});
  assert.deepEqual(semNada.map(o => o.estado), ['indisponivel', 'indisponivel', 'indisponivel', 'indisponivel']);
  assert.ok(semNada.filter(o => o.transporte === 'telegram').every(o => o.motivo.startsWith('hitl.credencial:')));
  assert.ok(semNada.filter(o => o.transporte === 'mcp-local').every(o => o.motivo.startsWith('hitl.canal.sem-conexao')));

  const comTudo = ofertaDeCanais({ env: telegram, conexoesMcp: ['claude-code', 'codex'] });
  assert.deepEqual(comTudo.map(o => o.canal), [...ORDEM_DOS_CANAIS]);
  assert.ok(comTudo.every(o => o.estado === 'disponivel' && o.motivo === ''));

  // Credencial parcial nao deixa metade do canal funcionar: ela nomeia o que falta.
  const parcial = ofertaDeCanais({ env: { ...telegram, ORK_HITL_TELEGRAM_CHATS: '' }, conexoesMcp: ['codex'] });
  const hermes = parcial.find(o => o.canal === 'hermes')!;
  assert.equal(hermes.estado, 'indisponivel');
  assert.match(hermes.motivo, /ORK_HITL_TELEGRAM_CHATS/);
  // FX5: a conta homologada tambem e pre-condicao real: sem ela o canal nao responde.
  const semConta = ofertaDeCanais({ env: { ...telegram, ORK_HITL_OPENCLAW_ACCOUNT: '' } });
  assert.equal(semConta.find(o => o.canal === 'hermes')!.estado, 'disponivel');
  assert.match(semConta.find(o => o.canal === 'openclaw')!.motivo, /ORK_HITL_OPENCLAW_ACCOUNT/);
  // FX1: a chave de um canal nao cobre o outro, e a oferta diz isso com o nome da variavel.
  const semOpenclaw = ofertaDeCanais({ env: { ...telegram, ORK_HITL_INGRESS_KEY_OPENCLAW: '' } });
  assert.equal(semOpenclaw.find(o => o.canal === 'hermes')!.estado, 'disponivel');
  assert.match(semOpenclaw.find(o => o.canal === 'openclaw')!.motivo, /ORK_HITL_INGRESS_KEY_OPENCLAW/);
  for (const env of [
    { ...telegram, ORK_HITL_ROOT: 'relativo' },
    { ...telegram, ORK_HITL_TELEGRAM_BOT_ID: 'bot' },
    { ...telegram, ORK_HITL_TELEGRAM_USERS: '42,invalido' },
    { ...telegram, ORK_HITL_TELEGRAM_CHATS: '-7,invalido' },
    { ...telegram, ORK_HITL_INGRESS_KEY_HERMES: 'curta' },
    { ...telegram, ORK_HITL_INGRESS_KEY_OPENCLAW: telegram.ORK_HITL_INGRESS_KEY_HERMES },
  ]) {
    const oferecidos = ofertaDeCanais({ env });
    assert.ok(oferecidos.filter(o => o.transporte === 'telegram').some(o => o.estado === 'indisponivel'));
    assert.equal(oferecidos.flatMap(o => o.motivo).some(m => m.includes(telegram.ORK_HITL_INGRESS_KEY_HERMES)), false,
      'motivo nunca imprime material criptografico');
  }
  assert.equal(parcial.find(o => o.canal === 'codex')!.estado, 'disponivel');
  assert.equal(parcial.find(o => o.canal === 'claude-code')!.estado, 'indisponivel');
  // A oferta e leitura pura: nao consulta process.env por conta propria.
  assert.equal(ofertaDeCanais().every(o => o.estado === 'indisponivel'), true);
});

test('FX1: cada canal de telegram tem a sua variavel de chave, e nenhuma e a global', () => {
  assert.equal(VARIAVEL_DA_CHAVE_V1, 'ORK_HITL_INGRESS_KEY');
  assert.equal(variavelDaChaveDoCanal(null), VARIAVEL_DA_CHAVE_V1);
  assert.equal(variavelDaChaveDoCanal('hermes'), 'ORK_HITL_INGRESS_KEY_HERMES');
  assert.equal(variavelDaChaveDoCanal('openclaw'), 'ORK_HITL_INGRESS_KEY_OPENCLAW');
  assert.notEqual(variavelDaChaveDoCanal('hermes'), variavelDaChaveDoCanal('openclaw'));
  for (const canal of ['claude-code', 'codex'] as const) {
    assert.equal(VARIAVEL_DA_CHAVE[canal], null);
    assert.throws(() => variavelDaChaveDoCanal(canal), /sem-chave-de-ingresso/);
  }
  // A variavel do canal e exigencia declarada: oferta e autenticacao leem a mesma lista.
  for (const canal of ['hermes', 'openclaw'] as const) {
    assert.ok(CANAIS[canal].exigencias.includes(variavelDaChaveDoCanal(canal)));
    assert.equal(CANAIS[canal].exigencias.includes(VARIAVEL_DA_CHAVE_V1), false);
  }
});

test('D12: recibo legado nao ganha canal por inferencia', () => {
  assert.deepEqual(canalDaResposta({ canal: 'openclaw', origem: 'telegram' }),
    { canal: 'openclaw', equivalencia: 'completa', motivo: '' });
  assert.deepEqual(canalDaResposta({ origem: 'mcp-local', autorizadoPor: 'mcp-local:codex' }),
    { canal: 'codex', equivalencia: 'completa', motivo: '' });
  // v1 do Telegram poderia ser Hermes ou OpenClaw. Chutar seria pior que admitir.
  const legado = canalDaResposta({ origem: 'telegram', autorizadoPor: 'telegram:42' });
  assert.equal(legado.canal, null);
  assert.equal(legado.equivalencia, 'legado');
  assert.match(legado.motivo, /ork\.hitl-answer\/v1/);
  assert.equal(canalDaResposta({}).canal, null);
  assert.equal(canalDaResposta({ canal: 'telegram' }).canal, null);
  // Canal declarado fora do registro nao vira canal.
  assert.equal(canalDaResposta({ canal: 'inventado', origem: 'telegram' }).equivalencia, 'legado');
});

test('D12: o registro cobre exatamente os hosts homologados, sem sobra nem falta', () => {
  assert.deepEqual(Object.keys(CANAIS).sort(), [...ORDEM_DOS_HOSTS].sort());
  for (const host of ORDEM_DOS_HOSTS) assert.equal(CANAIS[host].canal, host);
});

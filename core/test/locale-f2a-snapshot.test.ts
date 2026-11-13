/**
 * RM-061, fatia F2a: o texto pt-BR dos comandos que a fatia passa pelo catalogo fica igual byte a
 * byte. Os casos moram em `locale-f2a-casos.ts`; a fixture foi gerada uma vez por eles sobre o codigo
 * da base (antes da F2a) e este teste so compara. Os nomes comecam por "locale pt-BR F2a:" para cada
 * claim rodar so o seu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gerarCasos } from './locale-f2a-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f2a-pt-BR.json');
const AJUDA_TELEMETRIA =
  '  telemetria status|ligar|desligar [--json] Adesão privada e estado do exportador OpenTelemetry\n' +
  '  telemetria enviar [--dry-run] [--offset <byte>] [--json]  Envia logs OTLP/HTTP; dry-run começa no início ou no offset, sem ler cursor\n' +
  '  telemetria maturidade --desde ISO --ate ISO [--json]  Calcula indicadores locais; DORA exige fatos externos\n';

function semAdicaoDaTelemetria(texto: string): string {
  const partes = texto.split(AJUDA_TELEMETRIA);
  assert.equal(partes.length, 2, 'ajuda da telemetria existe uma vez, com os bytes esperados');
  return partes.join('');
}

const BLOCO_NETWORK_EMPRESA =
  '  network empresa criar|inscrever|aceitar   Rede coletiva privada da empresa: cria o repositorio privado dedicado;\n' +
  '        publicar|status|sair|revogar [--json]    empresa registra e maestro aceita por accountId (RM-089)\n' +
  '        criar ... [--nivel observar|avisar|exigir] [--recibo-versao V]  cobertura da reserva coletiva\n';

/** A família nova não pertence à base congelada da F2a; todo o restante continua byte a byte. */
function semNetworkEmpresa(texto: string): string {
  const partes = texto.split(BLOCO_NETWORK_EMPRESA);
  assert.equal(partes.length, 2, 'ajuda de network empresa existe uma vez, com os bytes esperados');
  return partes.join('');
}

test('locale pt-BR F2a: doctor, onboarding, experiencia, thread, phase e ajuda iguais byte a byte a base', () => {
  const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const obtido = gerarCasos();
  assert.deepEqual(Object.keys(obtido), Object.keys(esperado), 'os mesmos casos, na mesma ordem');
  for (const nome of Object.keys(esperado)) {
    const ajuda = nome.startsWith('ajuda cli:');
    const semTelemetria = ajuda ? semAdicaoDaTelemetria(obtido[nome]) : obtido[nome];
    const semFamiliasNovas = ajuda ? semNetworkEmpresa(semTelemetria) : semTelemetria;
    assert.equal(semFamiliasNovas, esperado[nome], nome);
  }
});

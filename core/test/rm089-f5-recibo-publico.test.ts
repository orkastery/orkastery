/** RM-089 F5: prova integral dos artefatos públicos do recibo básico. */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { CODIGO_DA_DEGRADACAO_REPLAY_CI } from '../src/ci-recibo-basico';

const raiz = path.resolve(__dirname, '../../..');
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

test('contrato e guias declaram âncora, allowlist, diagnósticos e limite da F7', () => {
  const pt = ler('docs/guias/politica-de-recibo-da-empresa.pt-BR.md');
  const en = ler('docs/guias/politica-de-recibo-da-empresa.md');
  const forja = ler('docs/referencia/contratos/forja.md');
  for (const texto of [pt, en, forja]) {
    assert.match(texto, /ork\.ci-projecao-replay\/v1/);
    assert.match(texto, /ork\.ci-recibo-runner\/v1/);
    assert.match(texto, /allowlist/i);
    assert.match(texto, /assinatura|signed receipt/i);
    for (const codigo of Object.values(CODIGO_DA_DEGRADACAO_REPLAY_CI)) assert.match(texto, new RegExp(codigo));
  }
  assert.match(pt, /manifesto.*branch de destino/is);
  assert.match(pt, /comandos e o preparo.*branch de destino/is);
  assert.match(pt, /baseline projetada.*não participa.*dívida preexistente/is);
  assert.match(pt, /Nenhum dos caminhos prova.*claims.*completas ou\s+autênticas/is);
  assert.match(en, /manifest.*target branch/is);
  assert.match(en, /commands and preparation.*target branch/is);
  assert.match(en, /projected baseline.*does not participate.*pre-existing debt/is);
  assert.match(en, /Neither path proves claims? completeness or\s+authenticity/is);
  assert.match(forja, /claims não vazias, comandos e preparo.*manifesto da branch de destino/is);
  assert.match(forja, /baseline projetada.*não participa.*sem exceção de dívida preexistente/is);
  assert.match(forja, /contrato.*head.*thread.*claimsSha256.*rodadaSha256.*check.*resultado.*sha256.*assinatura/is);
  assert.match(forja, /não.*autoria criptográfica/is);
});

test('referências da CLI e changelog descrevem preparo, replay e recibo inteiro', () => {
  const cliPt = ler('docs/referencia/cli.md'), cliEn = ler('docs/referencia/cli.en.md');
  assert.match(cliPt, /ork ci prepare.*ork\.ci-projecao-replay\/v1.*allowlist/is);
  assert.match(cliPt, /ork ci run.*ork\.ci-recibo-runner\/v1.*HEAD executado/s);
  assert.match(cliEn, /ork ci prepare.*ork\.ci-projecao-replay\/v1.*allowlist/is);
  assert.match(cliEn, /ork ci run.*ork\.ci-recibo-runner\/v1.*executed HEAD/s);
  const naoPublicado = ler('CHANGELOG.md').split('## [', 1)[0];
  assert.match(naoPublicado, /Recibo básico no HEAD executado.*HEAD do PR\/MR/is);
  assert.match(naoPublicado, /projeção de replay.*julgamento integral/is);
  assert.match(naoPublicado, /ambiente allowlisted.*branch externa.*fork.*GitHub.*GitLab/is);
});

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const RAIZ = path.resolve(__dirname, '../../..');
const caminhos = {
  pt: path.join(RAIZ, 'docs/guias/telemetria-opentelemetry.pt-BR.md'),
  en: path.join(RAIZ, 'docs/guias/telemetria-opentelemetry.md'),
  modelos: path.join(RAIZ, 'templates/telemetria/README.md'),
};
const documentos = Object.fromEntries(Object.entries(caminhos)
  .map(([nome, arquivo]) => [nome, fs.readFileSync(arquivo, 'utf8')])) as Record<keyof typeof caminhos, string>;

test('guias e README apontam os dois modelos e limitam a compatibilidade externa', () => {
  for (const guia of [documentos.pt, documentos.en]) {
    assert.ok(guia.includes('templates/telemetria/collector-otlp.yaml'));
    assert.ok(guia.includes('templates/telemetria/collector-loki.yaml'));
  }
  for (const arquivo of ['collector-otlp.yaml', 'collector-loki.yaml']) assert.ok(documentos.modelos.includes(arquivo));
  for (const texto of Object.values(documentos)) {
    assert.ok(texto.includes('otelcol` core v0.165.0'));
    assert.ok(texto.includes('otelcol-contrib` v0.165.1'));
    assert.match(texto, /(?:não confirmad|not confirmed)/iu);
    assert.match(texto, /otelcol validate --config=<(?:arquivo|file)>/u);
  }
});

test('documentação cita as fontes oficiais do Collector, OTTL, Loki e Grafana', () => {
  const fontes = [
    'https://opentelemetry.io/docs/collector/configuration/',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/filterprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md',
    'https://grafana.com/docs/loki/latest/send-data/otel/',
    'https://grafana.com/docs/grafana/latest/administration/provisioning/',
    'https://opentelemetry.io/docs/collector/internal-telemetry/',
  ];
  for (const [nome, texto] of Object.entries(documentos)) {
    for (const fonte of fontes) assert.ok(texto.includes(fonte), `${nome}: fonte ausente ${fonte}`);
  }
});

test('F3 e F5 ficam declaradas como ausentes, sem JSON placeholder', () => {
  const ausentes = ['orkastery-correlacao-runtime.json', 'orkastery-maturidade-maestro.json'];
  for (const texto of Object.values(documentos)) {
    for (const ausente of ausentes) assert.ok(texto.includes(ausente), ausente);
    assert.match(texto, /(?:não (?:existe|há)|does not exist|no placeholder)/iu);
  }
  for (const ausente of ausentes) {
    assert.equal(fs.existsSync(path.join(RAIZ, 'templates/telemetria/grafana/dashboards', ausente)), false);
  }
});

test('saúde vem do Collector e o receiver público tem postura de segurança explícita', () => {
  for (const [nome, texto] of Object.entries(documentos)) {
    assert.match(texto, /(?:próprio Collector|Collector itself|telemetria interna do Collector)/iu, nome);
    assert.match(texto, /(?:não provisiona(?:m)? TLS nem autenticação|does not provision TLS or authentication)/iu, nome);
    assert.match(texto, /(?:bind local|local bind|rede confiável|trusted network)/iu, nome);
    assert.match(texto, /(?:overlay privado|private .*overlay)/iu, nome);
  }
});


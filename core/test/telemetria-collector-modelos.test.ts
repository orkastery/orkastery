import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const RAIZ = path.resolve(__dirname, '../../..');
const DIRETORIO = path.join(RAIZ, 'templates/telemetria');
const arquivos = ['collector-otlp.yaml', 'collector-loki.yaml'] as const;
const ler = (arquivo: typeof arquivos[number]) => fs.readFileSync(path.join(DIRETORIO, arquivo), 'utf8');

test('modelos declaram receiver, filtro OTTL, allowlist, limite e lote na ordem documentada', () => {
  for (const arquivo of arquivos) {
    const yaml = ler(arquivo);
    assert.match(yaml, /^receivers:\n  otlp:\n    protocols:\n      grpc:/m, arquivo);
    assert.match(yaml, /^      http:$/m, arquivo);
    assert.match(yaml, /^  filter\/required:\n    error_mode: propagate\n    logs:\n      log_record:/m, arquivo);
    for (const trecho of ['service.name', 'orkastery.telemetria', 'log.record.uid', 'orkastery.thread.id',
      'orkastery.phase.name', 'orkastery.prompt.gap.reason', 'gen_ai.input.messages']) {
      assert.ok(yaml.includes(trecho), `${arquivo}: condição ou allowlist ausente para ${trecho}`);
    }
    assert.match(yaml, /event_name == "gen_ai\.client\.inference\.operation\.details"[^\n]+gen_ai\.input\.messages[^\n]+orkastery\.prompt\.content\.state/);
    assert.match(yaml, /keep_keys\(attributes, \["log\.record\.uid"/);
    assert.match(yaml, /log_statements:[\s\S]+context: resource[\s\S]+keep_keys\(attributes, \["service\.name", "service\.version"\]\)/);
    assert.doesNotMatch(yaml, /metric_statements:/);
    assert.match(yaml, /^      processors: \[memory_limiter, filter\/required, transform\/sanitize, batch\]$/m);
  }
});

test('variantes diferem somente no exporter e na referência da pipeline', () => {
  const normalizar = (yaml: string) => yaml
    .replaceAll('otlphttp/generic', 'otlphttp/destino')
    .replaceAll('otlphttp/loki', 'otlphttp/destino')
    .replaceAll('OTEL_EXPORTER_OTLP_ENDPOINT', 'ORK_DESTINO_OTLP')
    .replaceAll('LOKI_OTLP_ENDPOINT', 'ORK_DESTINO_OTLP');
  assert.equal(normalizar(ler('collector-otlp.yaml')), normalizar(ler('collector-loki.yaml')));
});

test('YAMLs usam apenas ambiente e recusam configuração pública sensível', () => {
  for (const arquivo of arquivos) {
    const yaml = ler(arquivo);
    for (const linha of yaml.split('\n').filter((item) => /^\s*endpoint:/.test(item))) {
      assert.match(linha, /^\s*endpoint: \$\{env:[A-Z0-9_]+\}$/u, `${arquivo}: endpoint literal`);
    }
    assert.doesNotMatch(yaml, /https?:\/\//iu, arquivo);
    assert.doesNotMatch(yaml, /(?:^|[^A-Za-z0-9_])(?:\d{1,3}\.){3}\d{1,3}(?:$|[^A-Za-z0-9_])/u, arquivo);
    assert.doesNotMatch(yaml, /\b(?:localhost|headers?|auth(?:entication|enticator)?|password|api[_-]?key|token)\b/iu, arquivo);
    assert.doesNotMatch(yaml, /\binsecure:\s*true\b/iu, arquivo);
    assert.doesNotMatch(yaml, /(?:sk-[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/u, arquivo);
  }
});

test('README limita a compatibilidade, separa descarte de privacidade e recomenda validação externa', () => {
  const readme = fs.readFileSync(path.join(DIRETORIO, 'README.md'), 'utf8');
  for (const trecho of ['otelcol` core v0.165.0', 'otelcol-contrib` v0.165.1', 'não confirmadas',
    'filtro OTTL de descarte, não um validador de schema', 'erro ao avaliar', 'acontece antes, na F2',
    'memory_limiter`, `filter/required`, `transform/sanitize`, `batch',
    'otelcol validate --config=<arquivo>', 'fora do gate hermético', 'bind local ou uma rede confiável',
    'overlay privado com TLS e autenticação']) assert.ok(readme.includes(trecho), trecho);
});

# Modelos de telemetria

Esta pasta contém referências versionáveis para receber os logs OTLP do Orkastery e visualizar os dados que a RM-090 já produz. O destino genérico demonstra o contrato de exportação; os dashboards de logs usam Loki como referência.

## Collector

Escolha um dos modelos completos:

- `collector-otlp.yaml`: exporta por OTLP/HTTP genérico;
- `collector-loki.yaml`: exporta para a base OTLP nativa do Loki. A base termina em `/otlp`; o exporter acrescenta `/v1/logs`.

Defina `ORK_OTELCOL_GRPC_ENDPOINT`, `ORK_OTELCOL_HTTP_ENDPOINT`, `ORK_OTELCOL_MEMORY_CHECK_INTERVAL` e `ORK_OTELCOL_MEMORY_LIMIT_MIB`. Para o destino, defina `OTEL_EXPORTER_OTLP_ENDPOINT` ou `LOKI_OTLP_ENDPOINT`, conforme o modelo escolhido.

A referência observada é o `otelcol` core v0.165.0. O inventário oficial do `otelcol-contrib` v0.165.1 também contém `otlp`, `otlphttp`, `memory_limiter`, `filter`, `transform` e `batch`. Compatibilidade com versões anteriores e aceitação destes arquivos por um binário externo permanecem **não confirmadas**.

A pipeline dos logs Orkastery mantém esta ordem: `memory_limiter`, `filter/required`, `transform/sanitize`, `batch`. `filter/required` é um filtro OTTL de descarte, não um validador de schema:

- uma condição verdadeira descarta somente o LogRecord inválido;
- um erro ao avaliar a condição, com `error_mode: propagate`, falha o payload;
- a recusa de segredo ou dado privado acontece antes, na F2, e não produz evento para o Collector revalidar.

O filtro exige o serviço, o scope, o UID e a thread; exige fase nos eventos de fase e prompt; e descarta estados de prompt incoerentes. `transform/sanitize` conserva apenas o mapeamento publicado pelas F1/F2.

### Pipeline DORA

`logs/dora` é separada de `logs/orkastery` e aceita somente `orkastery.sdlc.deployment.v1` e `orkastery.sdlc.incident.v1`. O filtro exige o conjunto exato de campos de cada variante; atributo extra, campo obrigatório ausente, versão desconhecida ou identidade trazida pelo payload descarta o LogRecord. A pipeline original descarta todo evento `orkastery.sdlc.*`.

Depois da validação e da allowlist, `transform/dora-policy` atribui `user.hash` por `ORK_DORA_USER_HASH` e `service.namespace` por `ORK_DORA_SERVICE_NAMESPACE`. Se a política não informar time, ela atribui `service.namespace=team_source_missing` como lacuna explícita. O payload externo não escolhe pessoa nem time.

Deploy só vira insumo analítico depois que o motor confirmar thread e revisão contra um `ship_done` com push provado. Incidente e deployment de recuperação usam os IDs do contrato; proximidade de horário não cria vínculo.

A suíte do repositório exercita as variantes válidas e inválidas no schema comportamental, confere as cardinalidades dos dois modelos e faz isso sem rede nem processo externo. Como conferência operacional separada, rode o comando oficial do Collector sobre o arquivo escolhido:

```text
otelcol validate --config=<arquivo>
```

Essa conferência externa fica fora do gate hermético.

## Segurança do receiver

Os modelos públicos não provisionam TLS nem autenticação. Use bind local ou uma rede confiável por padrão. Antes de expor um receiver, aplique um overlay privado com TLS e autenticação. Não grave endpoint, hostname, endereço, header de autenticação nem credencial no modelo público.

## Grafana

Copie ou monte `grafana/provisioning/dashboards/orkastery.yaml` no diretório de provisionamento e disponibilize `grafana/dashboards/` no caminho indicado por `ORK_GRAFANA_DASHBOARDS_PATH`. Selecione uma fonte Loki nos dashboards de condução e prompts e uma fonte Prometheus que raspe a telemetria interna do Collector no dashboard de exportação. Os modelos não provisionam datasource, URL nem credencial.

As consultas Loki começam por `{service_name="orkastery"}`. Thread, decisão, claim, recibo e prompt permanecem metadados estruturados; não são labels indexadas. O dashboard de maturidade projeta fatos de origem; o cálculo exato, a cobertura e as lacunas permanecem na leitura local. A equivalência operacional das consultas em Loki continua não confirmada. Não há benchmark hermético de Loki ou Grafana, portanto o custo observado permanece indisponível nesta referência.

## Modelos planejados

- `orkastery-correlacao-runtime.json` não existe nesta fatia; a correlação com runtimes pertence à F3.
- `orkastery-maturidade-maestro.json` existe na F5 e consulta somente campos emitidos pelo mapper e preservados pelo Collector.

Não há JSON placeholder para dado ainda ausente.

## Fontes oficiais

- [Manifest do otelcol core](https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol/manifest.yaml)
- [Manifest do otelcol-contrib](https://github.com/open-telemetry/opentelemetry-collector-releases/blob/main/distributions/otelcol-contrib/manifest.yaml)
- [Configuração do Collector](https://opentelemetry.io/docs/collector/configuration/)
- [Ordem dos processadores](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/README.md)
- [Filter processor e OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/filterprocessor/README.md)
- [Funções OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md)
- [OTLP nativo do Loki](https://grafana.com/docs/loki/latest/send-data/otel/)
- [Provisionamento do Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/)
- [Telemetria interna do Collector](https://opentelemetry.io/docs/collector/internal-telemetry/)

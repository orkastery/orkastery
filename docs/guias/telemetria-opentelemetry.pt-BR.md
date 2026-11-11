# Logs de condução com OpenTelemetry

**Português (Brasil)** | [English](telemetria-opentelemetry.md)

Use este guia para enviar os eventos de condução que o Orkastery já grava no ledger como logs OpenTelemetry por OTLP/HTTP JSON. A adesão é privada da pessoa ou da máquina, fica desligada por padrão e não altera `orkastery.yaml`.

## Ligar e conferir

Na máquina que enviará os logs:

```bash
ork telemetria ligar
ork telemetria status
```

`ligar` cria `telemetria.json` na pasta privada do usuário do `ork`, no contrato `ork.telemetria-config/v1`, com permissão `0600`. O arquivo guarda somente a opção do builder e um pseudônimo aleatório estável; endpoint e cabeçalhos continuam no ambiente do processo. Variáveis OTEL, sozinhas, não ativam a telemetria.

Para desligar:

```bash
ork telemetria desligar
```

Desligado, `status` e `enviar` retornam antes de enumerar threads, abrir ledgers, ler endpoint ou cabeçalhos e criar transporte.

## Apontar para um Collector

Defina um endpoint base, ao qual o `ork` acrescenta `v1/logs`:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.example:4318
ork telemetria enviar --dry-run
ork telemetria enviar
```

Ou defina o endpoint específico de logs, usado exatamente como informado:

```bash
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://collector.example/otlp/v1/logs
export OTEL_EXPORTER_OTLP_LOGS_HEADERS='authorization=Bearer%20<credencial>'
ork telemetria enviar
```

`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` vence `OTEL_EXPORTER_OTLP_ENDPOINT`; a mesma precedência vale para `OTEL_EXPORTER_OTLP_LOGS_HEADERS` e `OTEL_EXPORTER_OTLP_HEADERS`. Os cabeçalhos usam pares `chave=valor` separados por vírgula e percent-encoding quando necessário. Valor inválido é recusado sem eco, e nenhum cabeçalho configurável substitui `content-type: application/json`. O prazo vem de `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT`, depois `OTEL_EXPORTER_OTLP_TIMEOUT`, em milissegundos, e vale para a exportação inteira: uma repetição usa apenas o restante, respeita `Retry-After` quando ele cabe e, sem o cabeçalho, usa espera exponencial com jitter. O corpo da resposta é limitado durante a leitura do stream.

A [configuração oficial do OpenTelemetry Collector](https://opentelemetry.io/docs/collector/configuration/) explica receivers, processors, exporters e o pipeline `logs`. A [especificação do OTLP Exporter](https://opentelemetry.io/docs/specs/otel/protocol/exporter/) define a precedência dos endpoints, o caminho `/v1/logs` e a forma dos cabeçalhos.

Para Grafana Cloud, use endpoint e credencial mostrados pela sua stack. A [documentação oficial do endpoint OTLP do Grafana Cloud](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/) recomenda um Collector ou Grafana Alloy para produção e explica como os logs chegam ao Loki e ao Explore. O Orkastery não cria Collector, Alloy, Loki ou dashboard nesta fatia.

## Conferir antes de enviar

```bash
ork telemetria status --json
ork telemetria enviar --dry-run --json
ork telemetria enviar --dry-run --offset <byte> --json
```

O status mostra a origem da ativação, o destino sem userinfo, query ou fragmento, bytes pendentes por thread, último UID confirmado e rejeição terminal. O dry-run ignora o cursor persistido: começa no byte zero ou no início de linha indicado por `--offset`, e apresenta o `ExportLogsServiceRequest` já redigido. Ele não resolve cabeçalhos, não cria transporte, não usa rede, não toma lock e não grava cursor ou recibo.

## Mapeamento dos atributos

Cada valor OTLP usa `AnyValue` tipado. Inteiros de 64 bits, inclusive nanossegundos, são texto decimal. O nome do evento fica em `eventName`; não existe atributo próprio que o duplique. Os atributos `gen_ai.*` desta fatia seguem as convenções semânticas OpenTelemetry GenAI 1.37.0.

| Campo | Tipo OTLP | Quando aparece |
| --- | --- | --- |
| `service.name` | `stringValue` | Resource de todo lote |
| `service.version` | `stringValue` | Resource de todo lote |
| `log.record.uid` | `stringValue` | Todo LogRecord, por `eventId` ou UID derivado |
| `user.hash` | `stringValue` | Evento com identidade do builder, usando o pseudônimo privado |
| `vcs.ref.head.revision` | `stringValue` | Criação, commit e ship com revisão |
| `vcs.ref.head.name` | `stringValue` | Criação, commit e ship com ref |
| `vcs.ref.type` | `stringValue` | Mesmos eventos, com tipo conhecido |
| `cicd.pipeline.name` | `stringValue` | Verify e CHECK |
| `cicd.pipeline.run.id` | `stringValue` | Verify e CHECK com rodada nativa |
| `cicd.pipeline.result` | `stringValue` | Verify e CHECK com resultado |
| `gen_ai.operation.name` | `stringValue` | Despacho que representa invocação |
| `gen_ai.request.model` | `stringValue` | Mesmo despacho com modelo |
| `conversation.id` | `stringValue` | Despacho Codex com conversa nativa |
| `session.id` | `stringValue` | Despacho Claude Code com sessão nativa |
| `error.type` | `stringValue` | Falha com tipo conhecido e redigido |
| `orkastery.thread.id` | `stringValue` | Evento vinculado a thread |
| `orkastery.phase.name` | `stringValue` | Despacho, resultado, gate, prompt, verify e CHECK |
| `orkastery.dispatch.id` | `stringValue` | Despacho e evento vinculado |
| `orkastery.mode` | `stringValue` | Criação e fase com modo |
| `orkastery.decision.id` | `stringValue` | Decisão autônoma |
| `orkastery.claim.id` | `stringValue` | Evento de claim |
| `orkastery.ledger.sequence` | `intValue` decimal | Evento com sequência conhecida |
| `orkastery.check.mode` | `stringValue` | CHECK e verify com modo |
| `orkastery.receipt.id` | `stringValue` | HITL, verify, CHECK e ship com recibo |
| `orkastery.runtime.name` | `stringValue` | Despacho e sessão com runtime |
| `orkastery.prompt.size` | `intValue` decimal, bytes | `phase_prompt_recorded` quando o tamanho já existe no evento |

`orkastery.event.id`, `orkastery.maestro.id`, `orkastery.verify.round_id` e `orkastery.network.id` não fazem parte do contrato. Heartbeat, `ledger_corrupted` e campos fora da lista não viram atributos.

## Correlação com Claude Code e Codex

Quando a adesão privada está ligada, cada despacho bem-sucedido produz um LogRecord `orkastery.ledger.phase_dispatch`. O vínculo leva `session.id` no Claude Code ou `conversation.id` no Codex, além de thread, fase, despacho, runtime e `user.hash`. O Orkastery não reemite `claude_code.*`, `codex.*`, corpo ou payload nativo. Retomada e observação da mesma sessão não criam outro vínculo; retry ou redespacho depois do fim usa a nova identidade nativa. Uma retransmissão física do mesmo LogRecord mantém `log.record.uid`, portanto a entrega continua sendo ao menos uma vez e o consumidor pode deduplicar pelo UID.

A D2 e todos os nomes públicos da RM-089 e da RM-090 foram ratificados pelo dono em 11/11/2026, no terminal, com a resposta “1a”.

A configuração existe somente na sessão despachada e vence valores permissivos herdados:

- Claude Code: `OTEL_LOG_USER_PROMPTS=0`, `OTEL_LOG_ASSISTANT_RESPONSES=0`, `OTEL_LOG_TOOL_DETAILS=0`, `OTEL_LOG_TOOL_CONTENT=0` e traces em `none`. Os settings ficam em arquivo transitório `0600`, cujo caminho é o único dado passado no argv, e são removidos ao fim do despacho.
- Codex: `otel.log_user_prompt=false`, `otel.log_agent_responses=false`, `otel.log_guardian_assessments=false`, `otel.tool_result.max_bytes=0`, `otel.metrics_exporter="none"` e `otel.trace_exporter="none"`. Endpoint e cabeçalhos entram por referências a variáveis do ambiente do processo filho, sem seus valores no argv, na resposta do adapter ou no comando gravado no ledger.

O texto completo restante continua exclusivamente no pipeline de prompts do Orkastery descrito abaixo, depois da remoção local. Os logs nativos ficam sem prompt, resposta, avaliação, argumento ou resultado de ferramenta. A correlação de métricas do Codex por `conversation.id` está **não confirmada** e não é inferida por horário, conteúdo, PID ou arquivo.

Fontes oficiais: [monitoramento do Claude Code](https://code.claude.com/docs/en/monitoring-usage#security-and-privacy), [telemetria e overrides do Codex](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry) e [referência de configuração do Codex](https://learn.chatgpt.com/docs/config-file/config-reference).

## Conteúdo de prompts

O conteúdo de prompts só entra na telemetria depois do opt-in feito por `ork telemetria ligar`. Para cada `phase_prompt_recorded`, o núcleo abre o arquivo carimbado e confere, no mesmo descritor, o tipo, o limite de 4 MiB, os bytes e o SHA-256 registrado no evento. Caminho ou metadados ausentes, arquivo ausente, caminho inseguro, tipo inválido, excesso de tamanho, UTF-8 inválido ou hash divergente produzem uma lacuna permanente com um dos motivos tipados `metadata_missing`, `file_missing`, `unsafe_path`, `invalid_type`, `too_large`, `invalid_encoding` ou `hash_mismatch`.

Antes de montar o LogRecord, os detectores de segredo processam o texto inteiro, incluindo formas literais, separadas, Base64, Base64URL e strings JSON aninhadas por até 16 níveis. Só depois o núcleo aplica `dado_privado` e confere novamente que nenhum segredo permaneceu. O log declara `orkastery.prompt.redaction.policy.version=ork.telemetria-redacao/v1`. Falha de leitura transitória ou de remoção fecha o fluxo antes do evento, sem conteúdo no payload e sem avanço do cursor.

O texto restante ocupa o JSON OTLP aninhado de `gen_ai.input.messages`: uma mensagem `user`, com uma parte `text` e o conteúdo em `content`. O pedido é limitado a 1 MiB. Uma lacuna sai sem prompt, caminho ou hash, com `orkastery.prompt.content.state=gap` e `orkastery.prompt.gap.reason`; depois da confirmação remota desse LogRecord, o cursor avança e a fila continua com o evento seguinte. Assim, a perda do prompt fica observável em vez de desaparecer silenciosamente.

Só um prompt que não cabe sozinho no pedido de 1 MiB é cortado, depois da remoção, em uma fronteira de ponto de código Unicode. O LogRecord marca `orkastery.prompt.truncated=true`; um prompt que cabe sozinho segue inteiro no lote seguinte. A prévia `ork telemetria enviar --dry-run` usa o mesmo preparador e, para as mesmas entradas e o mesmo relógio, é idêntica ao envio, inclusive na lacuna e no corte.

A [Semantic Conventions GenAI 1.37.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-events.md) adotada para o evento e para `gen_ai.input.messages` está em estado **Development**. O conteúdo pode ser sensível e, pela D1 da RM-090, a empresa que recebe os logs vê o texto restante depois da remoção; por isso a ativação é opt-in e privada da pessoa ou da máquina.

## Privacidade e entrega

Texto livre passa primeiro pelo catálogo de segredos e depois pela lista local de dados privados. Lista insegura, versionada ou inválida recusa o LogRecord inteiro. Cabeçalhos, endpoint com credencial, home, hostname, e-mail e objeto bruto do ledger não entram no payload nem na saída.

O cursor é incremental por posição em cada ledger. Um evento histórico sem `eventId` recebe UID derivado estável. Linha corrompida ou truncada bloqueia no primeiro ponto ruim sem avançar. O cursor só é persistido depois da confirmação remota; uma queda entre POST e cursor reenvia os mesmos UIDs. A garantia é ao menos uma vez, não exatamente uma vez.

O envio manual usa lock não bloqueante, lote e resposta limitados e no máximo uma repetição para falha de conexão ou status retentável. `partialSuccess` e resposta não retentável são terminais e visíveis no status, sem repetir silenciosamente. A configuração nativa é preparada somente para o despacho com opt-in; não há trace, painel ou política empresarial criada por esta fatia. O texto do prompt sai somente no envio manual com opt-in e com as proteções descritas acima.

# Conduction logs with OpenTelemetry

[Português (Brasil)](telemetria-opentelemetry.pt-BR.md) | **English**

Use this guide to send the conduction events that Orkastery already writes to the ledger as OpenTelemetry logs over OTLP/HTTP JSON. Opt-in is private to the person or machine, is off by default and does not change `orkastery.yaml`.

## Enable and inspect

On the machine that will send the logs:

```bash
ork telemetria ligar
ork telemetria status
```

`ligar` creates `telemetria.json` in the private ork user folder under the `ork.telemetria-config/v1` contract, with mode `0600`. The file stores only the builder choice and a stable random pseudonym; the endpoint and headers remain in the process environment. OTEL variables alone do not enable telemetry.

To disable it:

```bash
ork telemetria desligar
```

When disabled, `status` and `enviar` return before enumerating threads, opening ledgers, reading endpoints or headers, or creating a transport.

## Point to a Collector

Set a base endpoint, to which `ork` appends `v1/logs`:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.example:4318
ork telemetria enviar --dry-run
ork telemetria enviar
```

Or set the logs-specific endpoint, which is used exactly as provided:

```bash
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://collector.example/otlp/v1/logs
export OTEL_EXPORTER_OTLP_LOGS_HEADERS='authorization=Bearer%20<credential>'
ork telemetria enviar
```

`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` takes precedence over `OTEL_EXPORTER_OTLP_ENDPOINT`; the same precedence applies to `OTEL_EXPORTER_OTLP_LOGS_HEADERS` and `OTEL_EXPORTER_OTLP_HEADERS`. Headers use comma-separated `key=value` pairs and percent-encoding when needed. Invalid values are rejected without echo, and configurable headers cannot replace `content-type: application/json`. The timeout comes from `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT`, then `OTEL_EXPORTER_OTLP_TIMEOUT`, in milliseconds, and applies to the whole export: one retry uses only the remaining time, honors `Retry-After` when it fits, and otherwise uses exponential backoff with jitter. The response body is limited while its stream is read.

The official [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/) explains receivers, processors, exporters and the `logs` pipeline. The [OTLP Exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/) defines endpoint precedence, the `/v1/logs` path and the header format.

For Grafana Cloud, use the endpoint and credential displayed by your stack. The official [Grafana Cloud OTLP endpoint documentation](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/) recommends a Collector or Grafana Alloy for production and explains how logs reach Loki and Explore. The public models do not provision Collector, Alloy, Loki, Grafana or a datasource.

## Use the reference models

Choose `templates/telemetria/collector-otlp.yaml` for a generic OTLP/HTTP destination or `templates/telemetria/collector-loki.yaml` for Loki's native OTLP base. The files use `otelcol` core v0.165.0 as the observed reference; the `otelcol-contrib` v0.165.1 inventory also contains the components. Compatibility with earlier versions and acceptance by an external binary remain **not confirmed**.

`filter/required` is an OTTL discard filter, not a schema validator. A true condition discards the inconsistent record; an evaluation error under `propagate` fails the payload; secret or private-data rejection already happened in F2 and creates no event to revalidate. The hermetic suite checks structure. The operator can run `otelcol validate --config=<file>` separately.

The public receiver does not provision TLS or authentication. Use a local bind or a trusted network by default, and apply a private TLS and authentication overlay before exposing the receiver.

Copy or mount `templates/telemetria/grafana/provisioning/dashboards/orkastery.yaml` and the `templates/telemetria/grafana/dashboards/` folder. Select Loki for conduction and prompts; select Prometheus for health metrics produced by the Collector itself. The dashboards do not fix a URL or datasource.

Loki queries begin with `{service_name="orkastery"}` and filter structured metadata afterwards. Runtime correlation is F3 and `orkastery-correlacao-runtime.json` does not exist in this slice. Maestro maturity is F5: `orkastery-maturidade-maestro.json` is generated from the same executable registry as the local engine.

Sources: [filter processor and OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/filterprocessor/README.md), [OTTL functions](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md), [native OTLP ingestion in Loki](https://grafana.com/docs/loki/latest/send-data/otel/), [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/) and [Collector internal telemetry](https://opentelemetry.io/docs/collector/internal-telemetry/).

## Inspect before sending

```bash
ork telemetria status --json
ork telemetria enviar --dry-run --json
ork telemetria enviar --dry-run --offset <byte> --json
```

Status reports the activation source, the destination without userinfo, query or fragment, pending bytes per thread, the last confirmed UID and any terminal rejection. Dry-run ignores the persisted cursor: it starts at byte zero or at the line boundary given by `--offset`, and shows the already-redacted `ExportLogsServiceRequest`. It does not resolve headers, create a transport, use the network, take a lock, or write a cursor or receipt.

## Attribute mapping

Each OTLP value uses a typed `AnyValue`. 64-bit integers, including nanoseconds, are decimal strings. The event name lives in `eventName`; no custom attribute duplicates it. The `gen_ai.*` attributes in this slice follow OpenTelemetry GenAI semantic conventions 1.37.0.

| Field | OTLP type | When present |
| --- | --- | --- |
| `service.name` | `stringValue` | Resource of every batch |
| `service.version` | `stringValue` | Resource of every batch |
| `log.record.uid` | `stringValue` | Every LogRecord, from `eventId` or a derived UID |
| `user.hash` | `stringValue` | Event with builder identity, using the private pseudonym |
| `vcs.ref.head.revision` | `stringValue` | Creation, commit and ship with a revision |
| `vcs.ref.head.name` | `stringValue` | Creation, commit and ship with a ref |
| `vcs.ref.type` | `stringValue` | Same events, with a known type |
| `cicd.pipeline.name` | `stringValue` | Verify and CHECK |
| `cicd.pipeline.run.id` | `stringValue` | Verify and CHECK with a native round |
| `cicd.pipeline.result` | `stringValue` | Verify and CHECK with a result |
| `gen_ai.operation.name` | `stringValue` | Dispatch that represents an invocation |
| `gen_ai.request.model` | `stringValue` | Same dispatch with a model |
| `conversation.id` | `stringValue` | Codex dispatch with a native conversation |
| `session.id` | `stringValue` | Claude Code dispatch with a native session |
| `error.type` | `stringValue` | Failure with a known, redacted type |
| `orkastery.thread.id` | `stringValue` | Event linked to a thread |
| `orkastery.phase.name` | `stringValue` | Dispatch, result, gate, prompt, verify and CHECK |
| `orkastery.dispatch.id` | `stringValue` | Dispatch and linked event |
| `orkastery.mode` | `stringValue` | Creation and phase with a mode |
| `orkastery.decision.id` | `stringValue` | Autonomous decision |
| `orkastery.claim.id` | `stringValue` | Claim event |
| `orkastery.ledger.sequence` | decimal `intValue` | Event with a known sequence |
| `orkastery.check.mode` | `stringValue` | CHECK and verify with a mode |
| `orkastery.receipt.id` | `stringValue` | HITL, verify, CHECK and ship with a receipt |
| `orkastery.runtime.name` | `stringValue` | Dispatch and session with a runtime |
| `orkastery.prompt.size` | decimal `intValue`, bytes | `phase_prompt_recorded` when size already exists on the event |

`orkastery.event.id`, `orkastery.maestro.id`, `orkastery.verify.round_id` and `orkastery.network.id` are not part of the contract. Heartbeats, `ledger_corrupted` and fields outside the allowlist do not become attributes.

## Correlation with Claude Code and Codex

When private opt-in is enabled, each successful dispatch produces an `orkastery.ledger.phase_dispatch` LogRecord. The link carries `session.id` for Claude Code or `conversation.id` for Codex, together with the thread, phase, dispatch, runtime and `user.hash`. Orkastery does not re-emit `claude_code.*`, `codex.*`, native bodies or native payloads. Resuming or observing the same session does not create another link; a retry or redispatch after termination uses the new native identity. A physical retransmission of the same LogRecord preserves `log.record.uid`, so delivery remains at least once and consumers can deduplicate by UID.

As a product rule, native identity uses `session.id` for Claude Code and `conversation.id` for Codex; native event bodies and names do not enter the Orkastery LogRecord.

Configuration exists only in the dispatched session and overrides permissive inherited values:

- Claude Code: `OTEL_LOG_USER_PROMPTS=0`, `OTEL_LOG_ASSISTANT_RESPONSES=0`, `OTEL_LOG_TOOL_DETAILS=0`, `OTEL_LOG_TOOL_CONTENT=0`, with traces set to `none`. Settings live in a transient `0600` file, only its path is placed in argv, and the file is removed after dispatch.
- Codex: `otel.log_user_prompt=false`, `otel.log_agent_responses=false`, `otel.log_guardian_assessments=false`, `otel.tool_result.max_bytes=0`, `otel.metrics_exporter="none"` and `otel.trace_exporter="none"`. The endpoint and headers use references to variables in the child process environment, without their values in argv, the adapter response, or the command recorded in the ledger.

The remaining full text continues exclusively through the Orkastery prompt pipeline described below, after local redaction. Native logs contain no prompt, response, assessment, tool argument or tool result content. Correlation of Codex metrics by `conversation.id` is **not confirmed** and is not inferred from time, content, PID or files.

Official sources: [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage#security-and-privacy), [Codex telemetry and one-off overrides](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry), and the [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Prompt content

Prompt content enters telemetry only after the opt-in performed by `ork telemetria ligar`. For each `phase_prompt_recorded`, the core opens the stamped file and checks, on the same descriptor, its type, the 4 MiB limit, its bytes, and the SHA-256 recorded in the event. A missing path or metadata, missing file, unsafe path, invalid type, excessive size, invalid UTF-8, or hash mismatch produces a permanent gap with one of the typed reasons `metadata_missing`, `file_missing`, `unsafe_path`, `invalid_type`, `too_large`, `invalid_encoding`, or `hash_mismatch`.

Before building the LogRecord, the secret detectors process the entire text, including literal and separated forms, Base64, Base64URL, and JSON strings nested up to 16 levels. Only then does the core apply `dado_privado` and check again that no secret remains. The log declares `orkastery.prompt.redaction.policy.version=ork.telemetria-redacao/v1`. A transient read or redaction failure fails closed before the event, with no content in the payload and no cursor advance.

The remaining text occupies the nested OTLP JSON in `gen_ai.input.messages`: one `user` message with a `text` part and its content in `content`. The request is limited to 1 MiB. A gap carries no prompt, path, or hash, and uses `orkastery.prompt.content.state=gap` with `orkastery.prompt.gap.reason`; after remote confirmation of that LogRecord, the cursor advances and the queue continues with the next event. This makes the prompt loss observable instead of silently discarding it.

Only a prompt that does not fit by itself in the 1 MiB request is truncated, after redaction, at a Unicode code point boundary. The LogRecord marks `orkastery.prompt.truncated=true`; a prompt that fits by itself proceeds intact in the next batch. The `ork telemetria enviar --dry-run` preview uses the same preparer and, for the same inputs and clock, is identical to sending, including gaps and truncation.

The [GenAI Semantic Conventions 1.37.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-events.md) adopted for the event and `gen_ai.input.messages` are in **Development** status. Content can be sensitive and, under RM-090 D1, the company receiving the logs can see the remaining text after redaction; activation is therefore private opt-in by the person or machine.

## Privacy and delivery

Free text passes through the secret catalog first and the local private-data list second. An unsafe, versioned or invalid list rejects the entire LogRecord. Headers, an endpoint with credentials, home paths, hostnames, e-mail and the raw ledger object do not enter the payload or output.

The cursor advances incrementally by position in each ledger. A historical event without `eventId` receives a stable derived UID. A corrupt or truncated line blocks at the first bad point without advancing. The cursor is persisted only after remote confirmation; a crash between POST and cursor sends the same UIDs again. The guarantee is at least once, not exactly once.

Manual delivery uses a non-blocking lock, bounded batch and response, and at most one retry for a connection failure or retryable status. `partialSuccess` and non-retryable responses are terminal and visible in status, without a silent retry. Native configuration is prepared only for an opted-in dispatch. There is no metric, trace or enterprise policy; Collector and dashboards are reference models only. Prompt text is exported only by manual opt-in delivery with the protections described above.

## SDLC Analytics by maestro and team

`ork telemetria maturidade --desde <ISO> --ate <ISO>` reads only ledgers accessible on the machine and calculates the half-open `[from, to)` window. It does not consult opt-in, endpoints, headers, or the network. `--json` uses `ork.telemetria-maturidade-cli/v1`.

The `ork.sdlc-analytics/v1` registry is the source for local-engine aggregations and dashboard targets. Every result carries its population, coverage, and gaps. Retransmissions are deduplicated by ledger `eventId` and log `log.record.uid`; a missing UID is a gap. An incomplete historical event does not become a negative case.

| Indicator | Formula and population | Source | Main gaps |
| --- | --- | --- | --- |
| `agent.merge_receipt_coverage/v1` | Valid receipts over confirmed cases; unique `ship_done` events whose historical policy and version required a receipt | `ship_done`, `verify_run`, and `ork.recibo-prova/v1` | missing historical policy, receipt, HEAD, merge, or proven push |
| `agent.first_truth_sustained/v1` | Sustained first-green rounds over confirmed cases; threads with `ship_done`. “First” follows ledger sequence | `verify_run`, `go_fix_opened`, `check_reverify`, `ship_done` | missing sequence, first complete round, final receipt, or link |
| `agent.check_rework/v1` | Distinct finding IDs and distinct `(thread, round)` pairs; never a ratio | `go_fix_opened`, `check_reverify` | missing structured finding, round, or link |
| `agent.decisions_questions_reversals/v1` | Separate decision, question, and reversal counts by thread and phase | `autonomous_decision`, `hitl_requested` | missing ID, typed target, trace, or reverted decision |
| `agent.policy_exceptions/v1` | Explicit exceptions by policy and reason | `ship_unscanned_authorized` and the versioned writer catalog | missing policy, reason, receipt, UID, or known writer |
| `agent.mode_usage/v1` | Separate distributions of created threads and merges by mode | `thread_created`, `ship_done` | missing valid mode or correlatable thread |

Only the first two indicators are ratios. The others are counts or distributions with their own coverage. No indicator produces a composite score, weight, ranking, target, or good/bad classification.

### Identity, team, and visibility

`user.hash` is the maestro's stable pseudonym. `service.namespace` is the team assigned by policy; the payload cannot create or overwrite either value. Without a team, the fact carries `orkastery.team.source.state=team_source_missing`. Collective enrollment is not an inference source, and neither `orkastery.maestro.id` nor `orkastery.team.id` exists.

The local command shows ledgers accessible to the maestro. The enterprise dashboard filters the pseudonym and aggregates by `service.namespace`; authorization and nominal mapping belong to the company's private backend. Before exposing a receiver or dashboard, apply a private overlay with TLS, authentication, and access control. Public templates contain no company data, endpoint, or credential.

### DORA remains separate

The DORA measures are deployment frequency, change lead time, change fail rate, failed deployment recovery time, and deployment rework rate. They remain separate from the six agentic indicators and never enter a sum, weight, or score. The local command marks all five as `unconfirmed` because it does not read external facts.

`orkastery.sdlc.deployment.v1` requires production, a UID, service, thread, `deployment.id`, a successful pipeline, a deploy task, and `vcs.ref.head.revision`. It confirms only when `(orkastery.thread.id, vcs.ref.head.revision)` matches `ship_done.mergeSha` with a proven push. Time proximity never creates a link.

`orkastery.sdlc.incident.v1` uses `orkastery.incident.id`, `orkastery.incident.state` (`opened` or `resolved`), and `orkastery.incident.deployment.id`. Opening requires `error.type`; resolution may use `orkastery.incident.recovery.deployment.id`. Incident, original deployment, and recovery deployment need compatible IDs and thread. A missing link leaves only the affected measure `unconfirmed`, without estimation.

`logs/dora` is separate from `logs/orkastery`, has its own allowlist, and fails closed on an unknown version, required field, payload identity, or schema. Policy adds `user.hash` and `service.namespace` only after validation.

Sources: OpenTelemetry attributes for [CI/CD](https://opentelemetry.io/docs/specs/semconv/registry/attributes/cicd/), [deployment](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/), [service](https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/), [VCS](https://opentelemetry.io/docs/specs/semconv/registry/attributes/vcs/), [events](https://opentelemetry.io/docs/specs/semconv/general/events/), and the [DORA measures](https://dora.dev/guides/dora-metrics/).

The hermetic suite compares the real dashboard JSON with the renderer. Operational equivalence of the expressions in Loki remains **unconfirmed** until evidence exists in a comparable environment; that does not permit filling a gap with zero.

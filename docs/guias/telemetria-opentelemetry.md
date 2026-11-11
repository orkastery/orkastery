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

For Grafana Cloud, use the endpoint and credential displayed by your stack. The official [Grafana Cloud OTLP endpoint documentation](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/) recommends a Collector or Grafana Alloy for production and explains how logs reach Loki and Explore. Orkastery does not create a Collector, Alloy, Loki or dashboard in this slice.

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
| `gen_ai.conversation.id` | `stringValue` | Dispatch with a native conversation |
| `session.id` | `stringValue` | Event with a native session |
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

## Prompt content

Prompt content enters telemetry only after the opt-in performed by `ork telemetria ligar`. For each `phase_prompt_recorded`, the core opens the stamped file and checks, on the same descriptor, its type, the 4 MiB limit, its bytes, and the SHA-256 recorded in the event. A missing path or metadata, missing file, unsafe path, invalid type, excessive size, invalid UTF-8, or hash mismatch produces a permanent gap with one of the typed reasons `metadata_missing`, `file_missing`, `unsafe_path`, `invalid_type`, `too_large`, `invalid_encoding`, or `hash_mismatch`.

Before building the LogRecord, the secret detectors process the entire text, including literal and separated forms, Base64, Base64URL, and JSON strings nested up to 16 levels. Only then does the core apply `dado_privado` and check again that no secret remains. The log declares `orkastery.prompt.redaction.policy.version=ork.telemetria-redacao/v1`. A transient read or redaction failure fails closed before the event, with no content in the payload and no cursor advance.

The remaining text occupies the nested OTLP JSON in `gen_ai.input.messages`: one `user` message with a `text` part and its content in `content`. The request is limited to 1 MiB. A gap carries no prompt, path, or hash, and uses `orkastery.prompt.content.state=gap` with `orkastery.prompt.gap.reason`; after remote confirmation of that LogRecord, the cursor advances and the queue continues with the next event. This makes the prompt loss observable instead of silently discarding it.

Only a prompt that does not fit by itself in the 1 MiB request is truncated, after redaction, at a Unicode code point boundary. The LogRecord marks `orkastery.prompt.truncated=true`; a prompt that fits by itself proceeds intact in the next batch. The `ork telemetria enviar --dry-run` preview uses the same preparer and, for the same inputs and clock, is identical to sending, including gaps and truncation.

The [GenAI Semantic Conventions 1.37.0](https://github.com/open-telemetry/semantic-conventions/blob/v1.37.0/docs/gen-ai/gen-ai-events.md) adopted for the event and `gen_ai.input.messages` are in **Development** status. Content can be sensitive and, under RM-090 D1, the company receiving the logs can see the remaining text after redaction; activation is therefore private opt-in by the person or machine.

## Privacy and delivery

Free text passes through the secret catalog first and the local private-data list second. An unsafe, versioned or invalid list rejects the entire LogRecord. Headers, an endpoint with credentials, home paths, hostnames, e-mail and the raw ledger object do not enter the payload or output.

The cursor advances incrementally by position in each ledger. A historical event without `eventId` receives a stable derived UID. A corrupt or truncated line blocks at the first bad point without advancing. The cursor is persisted only after remote confirmation; a crash between POST and cursor sends the same UIDs again. The guarantee is at least once, not exactly once.

Manual delivery uses a non-blocking lock, bounded batch and response, and at most one retry for a connection failure or retryable status. `partialSuccess` and non-retryable responses are terminal and visible in status, without a silent retry. This slice creates no automatic phase hook, metric, trace, dashboard or enterprise policy; prompt text is exported only by manual opt-in delivery with the protections described above.

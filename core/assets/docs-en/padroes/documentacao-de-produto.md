# Software product documentation standard

> Version 1.1 · Applies to: platforms, systems, modules and features · Companion document: [Product roadmap standard](roadmap-de-produto.md)
>
> Version 1.1 keeps 1.0 and adds section 6 (three readers and SDLC facts) and the template frontmatter, which `ork docs verificar` checks.

The frontmatter keys and values, the section titles of the page templates and the `> **Em uma frase:**` line stay in Portuguese in every language, because they are the contract that `ork docs verificar` reads.

## 1. Purpose and documentation unit

This standard describes **the product and its verifiable behavior**, from the platform context to the technical contracts. Create one page per relevant entity; a feature (`Feature`) is the recommended unit for specifying behavior. Lengthy details, such as OpenAPI contracts and data schemas, can live in their own files, linked by stable identifiers.

Use the hierarchy `Platform → System/Service → Module → Submodule/Domain → Feature`. A use case belongs to a feature; an operation represents an action of that feature. Entities and fields describe data; APIs, endpoints, events, triggers and jobs describe interfaces and execution. The same service or contract can serve several features: keep one canonical source and reference it, without copying divergent definitions.

The **roadmap** records the problems, hypotheses, choices, priorities and progress of changes. This documentation records current behavior and, when needed, future specification explicitly identified as such. Relate both through IDs and links; do not treat a proposal as an already delivered feature.

## 2. Mandatory conventions

| Rule | How to apply |
| --- | --- |
| Identity | Assign stable IDs, for example `PLAT-01`, `SYS-01`, `MOD-01`, `FEAT-042`, `UC-042-01`, `BR-042-01`, `API-01`, `EVT-01`, `JOB-01` and `RM-042`. Renaming does not change the ID. In Orkastery, the number of a new FEAT comes from `ork roadmap feat`, reserved across machines; never from the highest number on your branch. |
| Scope and state | Say whether what the page describes is `vigente` (current), `em desenvolvimento` (in development), `proposto` (proposed) or `descontinuado` (discontinued), with environment, version and verification date. |
| Traceability | Link feature ↔ roadmap item ↔ use cases/rules ↔ contracts/schemas ↔ code/PR ↔ tests/evidence ↔ release. Use `Not applicable: reason` when a section does not make sense. |
| Source | Distinguish `confirmed` (code, contract, test or approved decision), `planned` (roadmap item) and `to be validated`. Never fill a gap by silent inference. |
| Form | Use clear language, in the language the product's docs are written in; keep the exact names of code, endpoints, flags and events in backticks. Dates in ISO 8601 with time zone; explicit units. |
| Responsibility | Record the page's human owner, the technical approver when applicable and the last review. An AI agent can propose changes, with source and human review defined by the team. |
| History | Behavior changes require updating the page and linking it to the roadmap item/release; relevant technical decisions point to an ADR. |

## 3. Documentation categories

Fill in the applicable fields. For reusable entities, create their own pages and link their IDs to the feature page.

### 3.1 Context and architecture

| Field | What to record |
| --- | --- |
| Platform; system/service; module; submodule | IDs, names and links to their respective parents. |
| Purpose; boundaries | Problem addressed, the component's responsibility and what does not belong to it. |
| Dependencies | Internal/external services and impact in case of failure. |
| Repository; code location | URL, directories and reference version/commit. |
| Deployment; environments | Deploy model, environments and regions actually used. |
| Isolation; configuration | Tenancy model and system parameters; cite names, effect, default and environment, never secret values. |
| Retention | Data types, retention period, disposal and approved policy/decision. |

### 3.2 Features and behavior

| Field | What to record |
| --- | --- |
| Feature; actors/personas | ID, purpose, participating users and systems. |
| Use cases; operations | IDs and names; CRUD operations and business actions kept separate. |
| Preconditions; trigger | Required state and the action/event that starts the flow. |
| Main flow; alternatives | Observable steps and paths for error, cancellation, timeout and recovery. |
| Postconditions | Persisted changes, emitted messages and external effects. |
| Business rules | Atomic rule with ID, condition, result and exceptions. |
| Acceptance criteria | Testable scenarios, preferably Given/When/Then, linked to the rules. |
| Interface | Screens, components, states, accessibility and a reference to the approved prototype. |

### 3.3 Data and fields

Define each entity once. For each field, record `technical name`, `label`, `type`, `unit`, `required`, `nullability`, `limits`, `validation`, `format/mask`, `default value`, `sensitivity classification`, `retention` and `source/destination`. Explain differences between the UI, API and database representations; for example, `refund_amount_cents` is an integer in cents and appears as currency in the interface. Relate the table/migration/schema and the contract version. Do not use a format regex as proof that a document number is semantically valid.

### 3.4 APIs and integrations

Record `API/integration`, `protocol and version`, `provider/consumer`, `method and endpoint`, `path/query/header params`, `authentication`, `authorization`, `request`, `success response`, `errors`, `pagination`, `usage limits`, `timeout`, `idempotency`, `compatibility` and a link to the OpenAPI or canonical contract. Include sanitized examples without credentials; spell out the behavior on failures and with previous versions.

### 3.5 Events, triggers and scheduled tasks

Record `event ID/name/version`, `producer`, `trigger`, `payload/schema`, `broker/topic`, `consumers`, `delivery/ordering`, `retry/backoff`, `DLQ`, `idempotency`, `observability` and `retention`. For jobs, include `ID`, `owner`, `schedule expression`, `time zone`, `timeout`, `concurrency`, `effects`, `retry` and the reprocessing procedure. A cron in UTC needs a readable description and a time zone reference.

### 3.6 Observability and operations

Record `correlation_id/trace_id`, logs and allowed fields, technical and business metrics, SLI/SLO with a measurement window, alerts and thresholds, dashboards, error tracking, health checks, runbook, audit events and expected impact on cost/capacity. Distinguish a service objective (SLO) from a contractual commitment (SLA).

### 3.7 Security, governance and compliance

Record risk, roles and the permission matrix (RBAC/ABAC), authentication/session, encryption and secrets management, handling of personal data, masking in logs, input validation, origin policies when there is a browser, applicable regulatory requirements, maintenance window and rollback procedure. Cite internal policies and approved decisions instead of assuming that every cited regulation applies.

## 4. Feature page template

Reserve the number with `ork roadmap feat --thread <thread>` and copy [the template](../produto/_modelo-feature.md) for each feature; replace the brackets with values or with `Not applicable: reason`. The frontmatter is the layer that agents and the checker read; the body is the layer that people read. Add tables of fields and contracts when there are several elements.

Frontmatter keys of a feature:

| Key | Content | Checked by `ork docs verificar` |
| --- | --- | --- |
| `id`, `tipo`, `titulo` | `FEAT-000`, `feature`, name | ID format, file name, uniqueness |
| `estado` | `vigente`, `em desenvolvimento`, `proposto` or `descontinuado` | value from the standard |
| `pai` | `MOD-00` | exists and is from the level above |
| `roadmap` | list of `RM-000` | exists, and the item cites the feature back |
| `owner`, `aprovador` | people | presence |
| `verificado_em`, `versao` | ISO 8601 with time zone; branch@commit | format |
| `fontes.codigo`, `fontes.testes`, `fontes.docs` | paths relative to the root | **exist in the repository** |
| `fontes.simbolos` | `file#name` | **the name appears in the file** |
| `fontes.contratos` | contract IDs (`ork.hitl/v2`) | **appear in `fontes.codigo`** |
| `fontes.comandos` | commands of the product's CLI | **the CLI declares the command** |

## 5. Review and synchronization

Before approving a change, check IDs and links, behavior and exceptions, names and types against code/migrations, API/event contracts, permissions, tests and the real environment. Update the documentation together with the implementation change; mark differences as `to be validated` with an owner and a deadline. Automation or an agent can compare sources and prepare a diff, but must record the commit/contract consulted and must not turn an assumption into a fact. Execution status and priority decisions live in the [roadmap standard](roadmap-de-produto.md).

In Orkastery, this comparison has an owner and a command:

- `ork docs verificar`: runs in CI on every PR; fails a page whose `fontes` no longer exist, or with a broken link, a repeated ID or a forgotten template field.
- `ork docs sincronizar`: runs on the project's machine; reads the threads' ledger and git and updates **only facts** (merge, phase), never status because time has passed. Without `--escrever`, it only shows what would change.
- `ork docs init`: creates this structure in any product conducted by Orkastery.

## 6. Three readers and SDLC facts (Orkastery adaptation)

Every page is read by three readers at the same time. If one of them is left behind, the page has failed.

### 6.1 Person with ADHD

- **Answer first.** Right below the title, a `> **Em uma frase:**` (in one sentence) line of up to 240 characters.
- **State at a glance.** State, verification date and version appear before any explanation.
- **One idea per line.** Bullets instead of paragraphs; a paragraph with more than 600 characters raises a warning.
- **Sections always have the same names.** Anyone who has read one page knows where everything is on the next.
- **Nothing silently empty.** A section without content says `Not applicable: reason` or `To be defined: owner, deadline`.

### 6.2 Parity checker

- The page asserts checkable things: paths, symbols, contracts, commands, commits.
- A divergence between page and repository is a **lint error**, not a matter of opinion.
- The checker never fills a gap or infers a state; it only points them out.

### 6.3 AI models and agents

- YAML frontmatter with fixed keys and values (section 4); stable IDs in the file name and in the title.
- `ork docs verificar --json` returns the findings with a typed rule (`docs.paridade.fonte`, `docs.leitura.resumo`...).
- An agent can propose the change; review and decision stay with people (section 2, Responsibility).

### 6.4 SDLC facts of the Orkastery method

- **Product facts** go into the documentation: the feature is `vigente`, in which version, verified when, against which sources.
- Delivery progress (thread, phase, CHECK, merge) is recorded in the [roadmap](roadmap-de-produto.md), in the item's `sdlc` section.
- **Conduction micro-decisions stay out**: which claim was re-registered, which GO-FIX fixed a test, which session dropped. That lives in the thread's ledger.

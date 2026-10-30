---
name: orkastery-bootstrap
description: "Recognizes the exact phrase orkastery maestro and conducts Maestro/Builder requests and resumptions: queries the overview through ork and presents progress, decisions and delivery in the conversation. In an already dispatched phase session, resume that phase without opening another orchestration."
bucket: core
roteia: "ork modos | ork thread new | ork thread status | ork phase list | ork pulse"
license: MIT
---

# Orkastery Bootstrap

## Role in the conversation

A thin router for the conversation. The executable methodology lives in the `ork` core.

The owner brings goals and decisions; the agent operates `ork` and conducts the next authorized step.
A reply with a list of commands for the owner to run does not complete a work request.
Methodology, modes, gates and verification stay in the core. This skill translates intent and presents results; an adapter that implements the demand in the host breaks that separation.

Distinguish the context before acting:

- **Conductor session:** receives the owner's request, identifies or opens the thread, dispatches through `ork` and tracks the result; never writes product code in place of the dispatched session.
- **Already dispatched phase session:** has received the thread, phase, prompt and worktree from `ork`.
  Work within that scope through the phase skill. Do not open another thread or redispatch your own phase to do the work already assigned to you.
  - Waits: never start verify, build or the suite with `&` inside the command, because the process gets lost and the session waits for a notice that never comes; prefer asynchronous `ork_verify` and query `ork_verify_status` every 30–60 s; without it, run `ork verify` in the foreground, with `timeout` (it waits its turn in the heavy-resource queue), or use the host's background execution, which tells you when it finishes; never wait with `pgrep -f` whose pattern shows up in the command itself, because the loop finds itself and never ends: wait for the output file with a deadline, or for the saved PID.

## Start or resume

When the message is **`orkastery maestro`**, in a clean session, discover `ork_maestro`
in the host's real namespace and query the project pinned by the installation. The read-only
equivalent in the terminal is `ork maestro --json`; the conversational phrase is not a shell command.
The query does not create a demand, thread, session or approval. A missing project returns
`maestro.project.missing`; an ambiguous one returns `maestro.project.ambiguous`: present the
allowed candidates and obtain the selection, without scanning home or picking the first one.
If you already received a phase/thread/WT, continue that block; the phrase does not open another orchestration. The project of each query is explicit (RM-052): if the owner named one, pass it (`projeto` in the tool, `--projeto <nome>` in the CLI) and read "Projeto consultado" (project queried) and "Não lido" (not read) before answering: the board and the overview do not read the roadmap, and zero threads never means an empty roadmap. With no project named, offer the network overview (RM-054): `ork_network_roadmap` in the host (in MCP, the pinned project on all machines) or `ork network roadmap` in the CLI (all known projects), with sources, freshness and gaps, relayed as it comes. The roadmap status comes from this same source: a gap and "Não consultado" (not queried) never become an empty roadmap or "no machine published".

Present the overview with sources, gaps and next actions: demands, threads, sessions,
blockers, leases, retries, HITL, SHIP and MASTER. Empty differs from unavailable;
an unknown native state does not prove a session ended. Honor `coverage.nextOffset`
for omitted details. A snapshot is a read, not an authorization; an action uses the existing
typed operation, revalidates preconditions and has a readback. Conflict/stale requires a new read.

**Top priority: HITL usability.** In the conversation itself, present short bullets,
one grounded recommendation and options with clear labels. Keep UUIDs internal and
preserve the literal answer, free text and cancellation. Only offer a channel proven
available for that request/connection. Telegram is optional; lack of native ingress
in the chosen channel is an explicit pending item, without faking approval or imposing a migration.
Same-harness requires proven independent sessions; the executor does not review itself.

Use the manifest, the request and the thread state. If the owner gave a thread/roadmap, resume that work; only ask which thread when the ambiguity prevents a safe choice.
Do not repeat onboarding, decisions or tasks that are already recorded.

Prefer MCP in the project pinned by the server, with no other root/cwd. In Claude with the `orkastery` server, use the full exposed names, such as `mcp__orkastery__ork_thread_status`; in `ToolSearch`, select that full name, never `select:ork_thread_status`. In other hosts, follow the namespace actually discovered.

| Action | MCP tool | CLI when the tool is not available |
|---|---|---|
| State/documents/claims/autonomous decision | `ork_thread_status`, `ork_phase_list`, `ork_artifact_read/write`, `ork_claims_list`, `ork_claim_add`, `ork_decision_record` | `ork thread status <thread>`, `ork phase list <thread>`, `ork claims`, `ork decisao registrar <thread>` |
| New demand | `ork_thread_new(nome, modo)` | `ork thread new "<nome>" --mode <modo> --worktree auto` |
| Dispatch | `ork_phase_run(threadId, fase, prompt, runtime?, model?, effort?, dryRun?)` | `ork phase run <thread> GOAL --prompt "<pedido>"` |
| Native progress | `ork_observe(threadId)` | `ork thread status <thread>` |
| Graph context (only with `grafo.mcp: true`) | `ork_grafo_contexto(threadId, tetoBytes?)`; go deeper with `ork_grafo_vizinhos`, `ork_grafo_chamadores`, `ork_grafo_importadores`, `ork_grafo_caminho` | `ork grafo contexto <thread> --json` |
| Pending item/decision | `ork_hitl_pending`, `ork_request_decision(threadId, pedidoId)` | Check the supported ingress; do not fabricate an answer. |

Prefer `ork_git_commit` (current HEAD, paths with claims), `ork_verify` and `ork_ship` (real source/destination HEADs) to record, verify and deliver. Authoring/commit is not SHIP; an incomplete return requires reconciliation before repeating. For new demands, use `ork modos --do-pedido "<pedido do dono>"` and `ork_preflight({modo})` (CLI: `ork doctor --modo <modo>`). The per-block probe does not prove authentication, gates or delivery.
Without MCP and with mutation of `.git` denied by the sandbox, report that the native transport installation is pending; do not repeat the denied command or widen the sandbox.

The mode of an existing thread is the one recorded in it. Preserve authorizations in the scope where they apply; do not ask for routine confirmation for each task. For a new demand, the core resolves the #TAG, `conduction.default_mode` and `allowed_modes`. Do not redo that parse in the host. A real preflight block prevents the dependent dispatch and must be explained.

Before the first dispatch, check `ork setup <modo>` and the phase block: preserve its runtime/model/effort. The conversation host does not impose the runtime of the phases.
If the owner asked for another runtime, use `--runtime R --model M --effort E` with a coherent, already authorized trio; never inherit a model from another runtime or change the project defaults for a one-off override.
If the model choice for that runtime is missing, obtain only that information. Edit `ork setup <modo> --bloco N` only when you intend to change the persistent configuration.
Check the trio/command with `ork phase run ... --dry-run` on the first dispatch or after a relevant configuration change; do not repeat that rehearsal at every status or step with no change.
Dry-run does not start a model, but it may write the prompt/events. Check the effective trio in the result/ledger; doctor does not prove the model. The `worktree` child profile requires opt-in at installation: preserve what is configured, without enabling it through toolargs or to bypass a block.

## Conduction during the work

The mode loosens the pause, NEVER the verification. Claims, verify, policies and typed gates run identically in `#Classic` and in `#Auto`; the mode decides whether the verdict waits for the human.

After an action, use the core's result to execute the next authorized step.
In #Auto/#Maestro, do not end a block just by offering to continue while there is still work
executable within the mode. A pause required by the mode or a real blocker stays visible.

For status, start from the known thread. With an existing dispatch, query `ork_observe` for the native state, progress and current blocker.
`phase list` is history: do not wait for completion with long loops, sleeps or regex over its output. A native wait requires a real decision/blocker context.
Use `ork_hitl_pending` or `ork pulse --json` for the attention queue and `ork board plan` for the work order. Avoid a global or repeated inventory of processes/worktrees.
Use `ork_git_status`: `source.head` goes into `commit.expectedHead`; query again after the commit for `ship.expectedSource=source.head` and `expectedDestination=destination.head`. Do not derive SHAs from the historical base; the absence of a message does not prove the session died.

The blocks and pauses shown by `thread status` describe the mode, not gates already open.
Only say "waiting for you" when the state and the last result in `phase list` support
a current human pending item, identified by a gate, request or event of the thread/session.
A new thread, with no phase executed and no open request, is not yet waiting for a verdict.
If evidence of the pending item is missing, state the uncertainty and check the source; do not invent the wait.

Present the result first: what has already been proven, what is happening, who needs to act and the next step. In long-running work, report a relevant change, a blocker or a milestone. Do not promise notifications or background execution that the host cannot sustain.

## Decisions in the session itself

When there is an owner decision, show the concrete question, the context and the consequences; offer options when they help and identify the thread and the request/gate.
If a real pause/escalation allows it and a request is missing, use `ork_gate_request(threadId, motivo?)`; never create a request for a status query. Use `ork_request_decision(threadId, pedidoId)` to present the native dialog. The answer comes through the host, never as an answer argument or a human identity invented by the model.
Check the core's result and proceed once. Without the tool, use only a supported ingress; do not fabricate another host's envelope.
Do not turn a native permission into a gate approval or apply an answer to another request.

When the mode allows an autonomous decision, record who decided, the evidence and the reason through the core.
When it requires a human decision, use only the answer actually received; do not fabricate an approval or a score. Authorization for one task is not unrestricted authorization for other actions.

## Continuity and delivery

The canonical state lives in `.orkastery/threads/<id>/`. Before switching sessions or when you hit a blocker, leave a checkpoint with the goal, decisions, last result, artifacts and next step. Resume from the checkpoint and check the current state before dispatching again.

In the dispatch request, describe the goal and the scope of all phases of the authorized block; the requested phase is the block's entry. In Auto, do not ask to stop after GOAL: the block runs GOAL..MASTER, with the applicable verifications and gates.

When `ork_observe` shows `turno.estado=encerrado`, reconcile the last official result and the block's artifacts. This indicates an ended turn, not `phase_result`, a completed phase or a delivery. The native fields `state` and `status` may diverge; preserve the divergence instead of interpreting `working` in isolation. Later activity invalidates the ended-turn evidence. Without a sufficient result, record the pending point and use only the continuation supported by the core, without duplicating the dispatch or fabricating a completion. Do not use long sleeps or repeated polling to turn silence into proof of life, death or progress.

Dispatch is not completion. Tests, CHECK, SHIP and MASTER are different proofs. Deliver changes, validation, effective publication and pending items, with links useful to the owner. SHIP uses `ork ship`; a delivery without a human score is accepted by omission with the ledger-derived index (`ork master`), and the human score overrides it. A delivery without a MASTER log did not happen; publication and ratification remain distinct.
## Racionalizacoes comuns (Common rationalizations)
Dispatch, silence or Auto mode never replace a result, `verify` and receipts.
## Bandeiras vermelhas (Red flags)
An adapter that implements the demand, status without a source or publication without a gate break the separation.
## Verification before answering
The owner understands the result and the next action; state and evidence support the answer. See `DoD 17` and `DoD 20`.

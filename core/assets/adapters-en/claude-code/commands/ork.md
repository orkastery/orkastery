---
description: Recognizes orkastery maestro and conducts requests, resumptions and status in the conversation with the Maestro/Builder.
argument-hint: "[natural-language request|thread|status|board|plan|doctor|modos]"
allowed-tools: Bash(ork:*), Read, mcp__orkastery__ork_thread_status, mcp__orkastery__ork_phase_list, mcp__orkastery__ork_hitl_pending, mcp__orkastery__ork_observe, mcp__orkastery__ork_artifact_read, mcp__orkastery__ork_claims_list, mcp__orkastery__ork_verify_status, mcp__orkastery__ork_git_status, mcp__orkastery__ork_thread_new, mcp__orkastery__ork_phase_run, mcp__orkastery__ork_preflight
---

# /orkastery:ork

Native entry point of the plugin enabled in the project: `/orkastery:ork`. Copying the files through the
installer still requires native activation; `/ork` alone is not a guaranteed alias.

This entry point is already loaded by the owner's invocation. Do not invoke `Skill(orkastery:ork)`
or another command to reload these instructions. Conduct the request with the tools
already allowed.
The eight MCP queries and creating/dispatching a thread from this entry point are valid for the invocation turn;
they do not persist on their own into the next messages. Creating/dispatching requires a demand and scope authorized
by the owner, a resolved mode and the core's preflight. Do not reload the skill to obtain permissions.
These grants do not enable MCP, do not authorize other mutations and do not approve gates or human answers.

Read the common contract with `Read`, without calling `Skill` to load the bootstrap:
@${CLAUDE_PLUGIN_ROOT}/skills/core/orkastery-bootstrap/SKILL.md

If the contract is already in context, use it without rereading. If the file is missing,
report an incomplete installation; do not invent another flow.

Orkastery's conversational entry point. Use the common contract to conduct the owner's intent through the core. Do not limit an execution request to pointing to another
slash command. If you received a request and have the necessary tools, carry out the routing.
The phase commands remain available as shortcuts; the owner does not need to know them.

## Recognize the intent

The literal phrase `orkastery maestro`, in a clean session, asks for a read of the overview.
Discover the tool with `ToolSearch` on `select:mcp__orkastery__ork_maestro`,
then query the pinned project. A query does not open a thread or a dispatch.
With no project named, also offer the network overview (RM-054): `ork network roadmap`
(all known projects, the threads of all machines, sources, freshness and gaps)
or `mcp__orkastery__ork_network_roadmap` (the pinned project, on all machines), shown as it comes.
The person's machines (RM-053) come from `ork network status` or from `mcp__orkastery__ork_network_status`
(in MCP, only the pinned project on each machine), shown as it comes: a gap is never "no machines".
MCP serves only the pinned project; `projeto` in any tool only checks that
project (`projeto.fora-do-servidor` when it is a different one). A request for another project goes to the CLI with
`--projeto <nome>` (RM-052). Read "Projeto consultado" (project queried) and "Não lido" (not read) before answering.
A missing/ambiguous project requires resolving the context allowed by the core.
If you already received a phase/thread/worktree, execute the received block, without recursion.
Missing MCP or denied authentication remains a blocker; do not switch runtime,
provider or sandbox. The CLI query `ork maestro --json` does not grant mutations.

HITL usability is top priority: bullets, a recommendation and labeled options,
internal UUID and preserved cancellation. The conductor session uses
`mcp__orkastery__ork_request_decision`; the child session never answers on the owner's behalf.

Conduction HITL is a selection (RM-057): 3 to 5 alternatives, exactly one with the
"Recommendation" seal. Never ask the owner for an "I confirm" in free text or to paste text; the request
they pasted with explicit authorization counts as their instruction, within that authorization.
A doubt within the authorization becomes `ork decisao registrar` and the thread goes on. Text only when the
factory cannot go on by itself and the owner needs to run a command in the terminal: show the
exact command.

| Owner request | Agent action |
|---|---|
| New demand | Resolve the mode through the core, check the preflight and open/dispatch the corresponding thread. |
| "Continue" or an existing thread/roadmap | Read the state and the last result; resume the next authorized step, without duplicating the dispatch. |
| "How is it going?" or status | Query the known thread; present proven progress, the blocker and the next step. |
| Roadmap status | Run `ork network roadmap` (with `--projeto <nome>` when the owner names the project) and show the text as it comes: it brings the threads of all machines, the reservations and the source and time of each part; `ork roadmap status` reads only this machine. Do not write your own roadmap report or deduce it from the board or the overview: zero threads is not an empty roadmap, and a gap or "Nao consultado" (not queried) is never an empty roadmap. |
| Decision or answer | Correlate it with the presented request/gate, relay it through the supported path and check the result. |
| Onboarding | Use the agenda of `ork onboarding` and resume the existing steps. |
| board, plan, doctor or modos | Run the corresponding query and interpret the result for the owner's intent. |

## Core sources

Prioritize Orkastery's MCP tools when discovered in this session, with the project
pinned by the server. In Claude, the installed `orkastery` server exposes full names such as
`mcp__orkastery__ork_thread_status`. If there are deferred tools, use `ToolSearch` with
`select:mcp__orkastery__ork_thread_status,mcp__orkastery__ork_artifact_read` for those reads;
for another operation, select its full name as actually exposed. Do not try `select:ork_thread_status`
or guess another namespace. The initial MCP activation and the owner's consent remain native. `ork_thread_status`, `ork_phase_list` and `ork_hitl_pending` read
state; `ork_thread_new` and `ork_phase_run` open/dispatch; `ork_observe` queries the dispatched
native session. When a real pause/escalation allows it and a request is missing, use
`ork_gate_request(threadId, motivo?)`; never create a request for a status query.
`ork_request_decision(threadId, pedidoId)` presents the dialog to the owner:
the answer comes through the host, never through an answer argument or an identity invented by the model.

The CLI queries below remain useful when the corresponding tool is not available:

```bash
ork thread status <thread>
ork phase list <thread>
ork network roadmap [--projeto <nome>]
ork pulse --json
ork board plan
ork doctor
ork modos
ork master
```

Use only the necessary queries. Do not run all of them on every message. The preflight belongs to the
start of a dispatch or to a relevant environment change; a status question does not restart
onboarding or work. If the thread is ambiguous, clarify before changing its state.
Pauses listed in the mode's blocks are expected. To say that the owner needs to answer
now, identify a current pending item in the thread's state/last result, with a matching gate,
request or event. A new thread with no phase executed is not waiting on assumptions
just because the mode's f12 block provides for that pause.

## Continuity

Preserve the thread/session mode, decisions and authorizations. Proceed with authorized work instead
of ending with "may I continue?". Ask when the mode or a real ambiguity requires
the owner's intervention, and explain what the answer unlocks. Do not approve gates on their behalf.

With an existing dispatch, query `ork_observe` and handle the current native wait. Do not replace
observation with long loops of `phase list`, sleeps or completion regex over history.
If MCP is missing and the sandbox blocks `.git`, report that the native transport installation is pending;
do not repeat the denied mutation or change the sandbox. Tell a native permission apart from an Ork gate.

Before the dispatch, use `ork_preflight({modo})`; CLI alternative: `ork doctor --modo <modo>`. The probe follows the per-block setup, without a global inventory, and does not prove authentication, gates or delivery.
For HEADs and Git state, query `ork_git_status`; do not invent SHAs or replace the transport with Bash Git.
The `worktree` child profile is an opt-in of the project's installation; do not enable it through a tool argument
or a configuration edit to bypass a block. Preserve the configured profile and the native permissions.

The conductor session dispatches and follows up; a session that already received a phase executes that phase,
without redispatching itself. The core keeps validating phases, evidence and gates.

Show the result, the last confirmed progress and what happens now. Record a checkpoint
before a future resumption; do not promise notification beyond the session's capabilities.
Conclude with effective delivery and validation, distinguishing what still depends on CHECK, SHIP or
human score. The list of executed commands is auxiliary diagnostics, not the owner's experience.

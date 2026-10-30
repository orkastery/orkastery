---
name: ork
description: "Recognizes orkastery maestro in a clean session: queries the overview, resumes threads and presents native decisions in the Codex conversation with the Maestro/Builder."
license: MIT
---

# Orkastery in Codex

When you receive `orkastery maestro` literally, the first action is the `ork_maestro` tool of the
`orkastery` MCP server, discovered in the namespace actually exposed: it queries the pinned
project. With the tool exposed, do not run `ork maestro`, `ork doctor`, `ork onboarding` or
`ork experiencia show` in the shell before it or in its place: the CLI resolves the project by the session directory, and that is the
class of error the phrase avoids (Codex activation proof, RM-032).

Only after `ork_maestro` (or, without MCP, `ork maestro --json`), query `ork experiencia show --json`
in the session's project. When `experience` is true,
read `../core/<skill>/SKILL.md`, using the name returned in `skill` by the core:
`orchestration-experience-pt-br` or `orchestration-experience`. Language, timezone and depth
come from the same query. If false, do not activate the pack. The dedicated block in AGENTS.md also
points to this catalog; installation does not change native permissions.

After `ork_maestro`, the phrase `orkastery maestro` still asks only for the overview,
without opening work. With no project named, also offer the network overview
(`ork_network_roadmap`, or `ork network roadmap` in the CLI), with sources, freshness and gaps.
Follow the context selection and the limits of the common bootstrap.
Without MCP, the `ork maestro --json` query stays read-only if the CLI is
available; mutations without native transport stay pending. Never use Bash Git
or a sandbox change as substitutes. A child session continues the received phase.

HITL is top priority in the presentation: short bullets, a recommendation and options
with clear labels; internal UUID. Use `ork_request_decision` in the conductor session and preserve
the literal answer/cancellation of the elicitation. Do not use a generic agent question
as gate approval, nor text in toolargs as human identity.

Conduction HITL is a selection (RM-057): 3 to 5 alternatives, exactly one with the
"Recommendation" seal. Never ask the owner for an "I confirm" in free text or to paste text; the request
they pasted with explicit authorization counts as their instruction, within that authorization.
A doubt within the authorization becomes `ork decisao registrar` and the thread goes on. Text only when the
factory cannot go on by itself and the owner needs to run a command in the terminal: show the
exact command.

Use the `orkastery-bootstrap` skill from the same installed catalog to conduct the request.
The owner talks about the goal; you operate the `ork` core and present the result and the next
step. Preserve the thread's mode and authorizations. If you already received an Orkastery phase,
run that phase within the received scope, without redispatching yourself.

- Waits: never start verify, build or the suite with `&` inside the command, because the process gets lost and the session waits for a notice that never comes; prefer asynchronous `ork_verify` and query `ork_verify_status` every 30–60 s; without it, run `ork verify` in the foreground, with `timeout` (it waits its turn in the heavy-resource queue), or use the host's background execution, which tells you when it finishes; never wait with `pgrep -f` whose pattern shows up in the command itself, because the loop finds itself and never ends: wait for the output file with a deadline, or for the saved PID.

When discovered, prefer the MCP tools bound to the project by the server:
`ork_thread_status`, `ork_phase_list`, `ork_hitl_pending`, `ork_thread_new(nome, modo)`,
`ork_phase_run(threadId, fase, prompt, runtime?, model?, effort?, dryRun?)`, `ork_observe(threadId)`
and `ork_request_decision(threadId, pedidoId)`. Use the namespace actually exposed, without assuming another project.

- New request: resolve the mode through `ork`, check preflight and open/dispatch the thread.
- Resumption: read `ork thread status <thread>` and the last result in `ork phase list <thread>`;
  continue the authorized work without repeating onboarding, approval or implementation.
- Roadmap status: use `ork_network_roadmap` (or `ork network roadmap --projeto <nome>`) and show the
  text as it comes, with the threads of all machines, the sources and the gaps; `ork_roadmap_status` is
  only for this machine. Do not write your own roadmap report: a gap is never an empty roadmap.
- The person's machines (RM-053): use `ork_network_status` (or `ork network status`) and show the text
  as it comes, with the beat of each machine, the source and the gaps; a gap is never "no machines".
- Status: present the thread's evidence; `ork pulse --json` shows who needs to act.
  The pauses of the mode's blocks are expected: only say "waiting for you" with a current human
  dependency proven in the state/last result, identifying the gate, request or event.
  A new thread with no phase run and no open request is not yet awaiting a verdict.
- Existing dispatch: check `ork_observe` for the current native progress or block;
  do not wait for completion with long `phase list` loops, sleeps or regex over history.
- Decision: if a real pause/escalation allows it and a request is missing, use `ork_gate_request(threadId, motivo?)`;
  never create a request for status. Correlate thread/request and use `ork_request_decision` to present
  the native dialog. The answer is provided by the owner to the host; never invent human identity
  or pass an answer as a model argument. A native permission does not approve another gate.
- Delivery: distinguish what was implemented, validated, published and what is still pending.

Phases, checks and gates belong to the core. The phase skills and the checklists of the
catalog come with this entry. If the common skill is missing, report an incomplete
installation instead of inventing another methodology.

Use the project's `ork` executable. If it is not on the session PATH, the installer recorded
this path: `{{ork_bin}}`. Do not change global configuration to resolve the PATH.

Without MCP and with `.git` protected by the sandbox, report a pending installation of the native
transport; do not repeat the denied mutation, do not create the thread by other means and do not widen the sandbox.

No background monitor is created by this skill. Follow along while the session is
active and leave a checkpoint for resumption, with the last result and next step proven.

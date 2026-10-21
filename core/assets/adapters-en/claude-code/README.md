# Claude Code Adapter

Orkastery reaches Claude Code as a **plugin**: the catalog's 18 thin skills, six phase
subagents, the slash commands `/goal` ... `/master` and a `PreToolUse` guard.

## Installation

```bash
ork adapter install claude-code --dry-run
ork adapter install claude-code # prepara <projeto>/.claude/plugins/orkastery
claude plugin validate .claude/plugins/orkastery
claude plugin marketplace add "$PWD/.claude/plugins/orkastery" --scope project
claude plugin install orkastery@orkastery --scope project
claude plugin details orkastery
```

The installer copies the single catalog from `skills/` and `references/`, renders the plugin manifest
with the paths declared one by one, and writes `INSTALADO.json` with the source and the sha256 of each
file. That file is what later lets you detect that someone edited the installed copy instead of the
catalog.

Copying the adapter does not enable the plugin in Claude. The native commands above register
the marketplace and enable the plugin in the current project. First confirm that the name
`orkastery` does not belong to another marketplace, and preserve the existing settings.
The manifest uses the default discovery of `agents/` and `hooks/hooks.json`: declaring the
directory as `agents` is invalid in Claude 2.1.263; declaring the default file again
in `hooks` causes a loading error due to duplication.

The scope must be proven in each worktree. In the Claude 2.1.263 trials,
`--scope project` enabled the explicitly configured directories, while
`--scope local` on main also reached an unconfigured worktree. Do not use that
last mechanism to exclude threads. The [activation plan](ACTIVATION.md) describes
preservation, exclusions, dispatch proof and rollback before operational use.

Native validation, installation and startup without a model:

```bash
npm --prefix core run build
npm --prefix core run build:test
node adapters/claude-code/test/native-plugin.cjs
```

The test creates the project and worktrees through the `ork` API, isolates cache/configuration with
`CLAUDE_CONFIG_DIR` and checks the CLI startup as well as the inventory. A worktree
that is not enabled and another project must load zero hooks. The explicit test
`node adapters/claude-code/test/native-plugin.cjs --smoke` also opens two real
sessions and requires `PermissionRequest` in the canonical ledger, without approving Bash. That smoke
test requires Linux, Python 3/pexpect and subscription OAuth in `ANTHROPIC_TOKEN` in the file
`~/.hermes/.env`; it uses no API key and no fallback. The global configuration
stays out of the fixture. The temporary sessions and ledgers are discarded;
keep the JSON output as a receipt before declaring the proof complete.

**Maestro activation proof (RM-032).** `node core/scripts/prova-ativacao.cjs claude-code`
installs the plugin and the `.mcp.json` from this copy in a throwaway project and opens a new session
`claude -p "orkastery maestro"` with `--plugin-dir`, `--mcp-config --strict-mcp-config`,
`--setting-sources project` and `--no-session-persistence`. It uses the CLI's native login, without copying
credentials and without writing to the global plugin registry. It passes only when the model calls
`mcp__orkastery__ork_maestro` (`ork maestro` through Bash is a detour) and the snapshot is from the throwaway
project; the receipt carries the sha256 of the global files before and after. Default model: `sonnet`
(`--modelo` changes it). Details in the [snapshot contract](../../docs/referencia/contratos/maestro-i32.md).

## What you get

| You type | You get |
|---|---|
| `/goal <pedido com #TAG>` | Opens the thread in the tag's mode and conducts the GOAL phase |
| `/plan <thread>` | PLAN: tasks with verify, `touch_paths`, locked decisions |
| `/go <thread>` | GO: worktree ensured, baseline recorded, one commit per task |
| `/check <thread>` | CHECK: verification against the baseline, five axes, one verdict |
| `/ship <thread>` | SHIP: merge serialized by lease and proven push |
| `/master <thread>` | MASTER: typed POSTMORTEM and the human score from 0 to 5 |
| `/ork` | Panel: doctor, board, scheduler, modos, score queue |

Plus six subagents (`ork-goal`, `ork-plan`, `ork-go`, `ork-check`, `ork-ship`, `ork-master`) to
isolate the context of each phase, the `PreToolUse` guard and the `UserPromptSubmit` hook for the owner's short answer.

## The PreToolUse guard

One hook, on `Bash`, calling `hooks/ork-guard.js`. It blocks seven classes of command:

| Block | Why |
|---|---|
| `git add -A`, `git add --all`, `git add .` | Swallow files from another thread in the same tree |
| `git commit -a` | Commits whatever is tracked, not the task |
| `git push --force` | Rewrites public history and erases someone else's delivery |
| `git push` | A manual push is not proven: delivery goes through `ork ship` |
| `git reset --hard`, `git clean -fd`, `git checkout -- .` | Mass discard without a trace |
| `rm -rf` with a broad or variable target | Deletes what nobody asked for |
| `ork noctum terminal` and the answer hook called by the tool | The owner's answer in the terminal comes from the hook of the owner's own session; the agent that calls this ingress poses as the owner (RM-057) |

**The guard has no business rule.** It does not read the ledger, does not know who authorized what and does not
know any thread: it recognizes the shape of the command and sends the agent down the path that `ork`
verifies. A command that starts with `ork` goes straight through, because the one that proves the push and serializes the merge is
the core; the exception is the owner's answer ingress (`ork noctum terminal`), blocked before that
pass-through. And if the guard itself breaks, it **fails open**: a hook that takes down the session over its own bug
is worse than no hook. The block on the answer ingress is a speed bump, not proof: whoever runs as the
same system user gets around it, and the limit is stated below.

## The owner's short answer in the terminal (RM-057)

The owner approves wherever they are. In an interactive Claude Code session, the owner answers the question of a
#Noctum arc with `sim`, `a` or `<código> a`, and the `UserPromptSubmit` hook (`hooks/ork-resposta.js`) takes the
event to the core through `ork noctum terminal --hook-stdin`. Only text shaped like a short answer (the code
with the answer, the number with the letter, or up to two words) calls the core; ordinary conversation goes to the
model untouched. The hook only carries the core's decision:

| Core decision | What the hook returns to Claude Code |
|---|---|
| Recorded, without effect (postpone, change something), the detail or the question back | `decision: block` with the core's sentence: the prompt is replaced by the confirmation, and the "sim" never reaches the model |
| Answer to a gate | `additionalContext`: the conductor opens the native dialog (`ork_request_decision`); the terminal does not record gates |
| Refusal by origin, with someone present | `systemMessage` with the reason; the prompt goes on to the model |
| Nothing to do with Orkastery | Nothing |

The core is the one that proves it, by the origin of the session and never by the text: presence
(`CLAUDE_CODE_SESSION_ATTENDED=1`, which Claude Code only sets in an interactive session), the session id,
no `ork` dispatch identity (`ORK_DISPATCH_ID`, `ORK_DISPATCH_THREAD`) nor a background job
folder, an entry point that is not the SDK's, the id outside the dispatch register of the threads, the
`cwd` outside any thread worktree and, on Linux, the ancestry through `/proc` (the background session and
the one nested in another Claude Code session are refused). The bare word only counts for the question whose
code appeared in this session; a typed code always counts. The receipt sits next to the arc log, with
a subkey of the core's local key.

**Limit:** a process of the same system user that builds this environment and this process chain by
hand gets through, as does whoever holds the local key in the native dialog. To separate the core from the agents, run
the agents under another account or sandbox. The new hook only takes effect after reinstalling the plugin
(`ork adapter install claude-code`) and with an `ork` that has `noctum terminal`.

## Session sensors

`PermissionRequest`, `Notification`, `Stop`, `SubagentStop` and `PostToolUse` call
`ork sessions event` with the session and the directory provided by Claude. The session must
be registered in a project thread. `ORK_SENSOR_CLI` can point to the installed ork
executable; the default is `ork` in the PATH. Each call has a three-second timeout.

The sensor leaves stdout empty and exits with code zero, even on failure. It observes the
block without deciding the permission. `PermissionRequest` captures the immediate request;
`Notification` with `permission_prompt` only fires after about six seconds, according to the
[hooks reference](https://code.claude.com/docs/en/hooks#permissionrequest).

The ledger receives timestamps and identifiers, without prompts, commands or transcripts.
`PostToolUse` records progress; for Bash, a commit receipt is only emitted when the
result contains the HEAD SHA confirmed in Git. The received command is never executed.
`Stop` and `SubagentStop` are separate observations and do not approve a phase.

Isolated integration test: `npm --prefix core run build && npm --prefix core run build:test && node --test core/dist-test/test/claude-sensors.test.js`.

The canary `node core/dist/index.js eval --so-canarios --canario fx-sensores-runtime`
integrates hook, CLI, supervisor and watcher in a temporary repository. Its Codex events
are synthetic; the output states that limit and measures ingestion, death and duplicates.

For acceptance testing with the authenticated subscriptions, run explicitly:

```bash
node core/scripts/smoke-sensores.cjs --runtime claude
node core/scripts/smoke-sensores.cjs --runtime codex
```

The harness requires a regular user; Claude requires Python 3 with `pexpect`. It creates a temporary
project and accepts trust only in that project it has just created. Claude runs
in a PTY with a mandatory Bash permission: the test observes the real dialog, the moment of the
hook and the ingestion in the ledger, and ends the session without approving the tool. The output includes
the code/signal of that controlled shutdown, without claiming a human answer or approval.
Codex runs a short command and the harness checks the produced file, tokens, rollout
and supervised receipt. Rollout discovery is redone at the end because its creation
can happen after `thread.started`. The sandbox comes from `runtime.sandbox` in the manifest
of the execution directory, with no override from the harness. The write proof under `read-only`
fails, which preserves the configured mode.

Each command emits JSON and returns code 1 when the proof is missing. Credential variables
and paid API redirection are removed; there is no fallback. HOME, CODEX_HOME,
CLAUDE_CONFIG_DIR, XDG and temporary files stay inside the attempt, along with the ledgers.
The receipt lists the native files and confirms the cleanup of those resources only.
Claude uses subscription OAuth only in the environment. Codex reads its native cache through a sealed Linux
`memfd`, without a persistent copy of credentials or writing to the source.
A refresh that needs to write to the cache makes the proof unavailable. See the limits
and the handling of the legacy T9 rollout in the [activation plan](ACTIVATION.md).
Keep the JSON in the evidence directory of the conductor
thread. The harness contract test neither launches runtimes nor replaces these smokes.
The sandbox network permission prompt has a separate flow, described in the
[PermissionRequest reference](https://code.claude.com/docs/en/hooks#permissionrequest).

Without `tool_use_id`, each hook invocation receives an occurrence identity. The size
of the transcript does not identify an occurrence; events from a new permission episode
can arrive without any change to the file. Replays with `tool_use_id` remain idempotent.

## Mods in phase sessions (RM-059)

A mod is a *function hooks* plugin for Claude Code 2.1.287 or newer. Each Orkastery mod lives
in `adapters/claude-code/mods/<mod>/`, with its own `.claude-plugin/plugin.json`, and declares its
role in `orkastery-mod.json`:

```json
{"formato":"ork.mod/v1","papeis":["fase"],"claudeCodeMinimo":"2.1.287"}
```

The `dono` (owner) role runs in the session of whoever conducts; the `fase` (phase) role, in the phase sessions that `ork`
dispatches. `ork adapter install claude-code` copies the mods with the rest of the adapter and records every
file of theirs in `INSTALADO.json`. In the `claude-bg` dispatch, each `fase` role mod goes in with its
own `--plugin-dir`, right after the Orkastery plugin, when:

- the mod's installed folder has exactly the files in the receipt, with the same bytes and no link;
  the types that Claude Code itself writes in `.claude-plugin/types/` (`*.d.ts` and
  `tsconfig.json`) are left out of the count;
- `claude --version` meets the mod's `claudeCodeMinimo` and the 2.1.287 required by the mods API.

A mod that asks for a newer version is left out of the command, and the dispatch goes on: the core does not depend on
mods. A mod whose dependency was left out (because of the version, or because it is `dono` role only) is left out too.
An invalid declaration, a manifest outside the receipt or an extra file in the folder refuses the dispatch with
`runtime.context.installation`, just like a mismatched byte. A mod file that left the catalog leaves the
copy on reinstall: `ork adapter install claude-code` removes what it installed itself and nobody
edited. A file edited or added by hand stays, and the refusal names the path to delete. The dependency (`dependencies` in the mod's
`plugin.json`) goes in before the mod that depends on it; the rest go in name order. The mods that went in are kept in the
command recorded in the `phase_dispatch` event of the thread ledger.

The shared file at the root of `mods/`, such as the authority list that the bridge reads at `../autoridade.json`
before its own folder, follows the same rule when there is a phase mod in the dispatch: outside the receipt, a link
or a special file means refusal, and what left the catalog leaves the copy on reinstall.

To take a mod out of phase sessions, change the role in the catalog's `orkastery-mod.json`, or remove the
mod, and run `ork adapter install claude-code` again.

A `dono` role mod does not go into the dispatch: it runs in the session of whoever conducts. In a project with the
adapter installed, its copy is already at `.claude/plugins/orkastery/mods/<mod>`, with every
file recorded in `INSTALADO.json` and the shared files from the root of `mods/` next to it. When it is
loaded this way, nobody checks the bytes: the check against the receipt runs at dispatch, for phase
mods. Load it in the session with:

```bash
claude --plugin-dir .claude/plugins/orkastery/mods/<mod>
```

Without the local adapter, each mod has an entry in the repository's own marketplace
(`.claude-plugin/marketplace.json`, generated by `node core/scripts/gerar-marketplaces.cjs`), which points
to a generated copy in `marketplaces/claude-code/mods/<mod>/`. Installed through the marketplace, the plugin
is only its own folder, so the shared file at the root of `adapters/claude-code/mods/` (the bridge's
authority list, for example) goes inside each copy. Installation is at project scope:

```bash
claude plugin marketplace add orkastery/orkastery
claude plugin install <mod>@orkastery --scope project
```

Both marketplaces are named `orkastery`, and the local one, registered by the installation above from
`.claude/plugins/orkastery`, does not list the mods. Do not swap one for the other in a project that uses the
adapter plugin: removing a marketplace uninstalls the plugins that came from it (measured on
Claude Code 2.1.296), and the plugin from the repository marketplace brings neither the `PreToolUse` guard nor the
adapter's MCP.

### Batch Brake (`ork-freio`)

The first `fase` role mod. In the phase session, after each batch of tools, it:

- finds the files the batch touched: the paths from `Edit`, `Write`, `MultiEdit` and `NotebookEdit` and the
  difference in `git status` between one batch and the next, which also catches edits made through `Bash`;
- finds the thread's claims that cite those files, by `arquivo` or by the command text, and warns
  when the batch touched files outside the plan's `touch_paths`;
- asks the core, in the background, to check those claims with
  `ork claims conferir <thread> --claims ... --json`, in the verify sandbox, one round at a time;
- returns to the model, in the next batch of the main loop, what broke: the claim id, the command and the
  tail of the output. A batch with no affected claim passes with no text, and the status line shows the claims at risk.
  A subagent's batch counts the touched files, but does not get the delivery or the warning.

The Brake never runs a claim's command, never writes claim state and never stops the loop: the one that
really verifies is still `ork verify`. It reads the role and the thread through the bridge's `$.ork`, and
the claims and the plan through the read tools `ork_claims_list` and `ork_artifact_read`, never from the
disk in `.orkastery/`. It needs an `ork` with `ork claims conferir` in the session's `PATH`; without it, or
without the verify sandbox, it warns once that the check is unavailable and goes on. A test that creates a
process can fail in the sandbox and pass in `ork verify`, and the warning says so along with the failure. The
result arrives in the next batch: if the session ends before that, the last check is left
undelivered. A claim failure whose file was touched again during the check is not delivered, because
a new check has already been requested. A failed `Edit` also counts as a touch and can request an
extra check.

### Task Gate (`ork-portao`)

The second `fase` role mod. The board gates act only in the phase session whose current block includes GO
(by the block slug in the core snapshot) and whose thread has a plan with at least one `T<n>` task that
fits the board: with `touch_paths` (backticked paths, with a slash, dot or wildcard) and a verify with a single
backticked command, the rule of `ork claims conferir --tarefa`. A plan with no such task gets no
gate, so the GO board does not lock up. With the gate on:

- **creation:** `TaskCreated` refuses a task whose subject does not carry the id of a plan task
  (`T2.1 ...`), or whose plan task does not fit the board. The refusal goes back to the model with the reason and the
  plan tasks that fit;
- **completion:** `TaskCompleted` for the task recorded at creation, or for one whose subject cites a plan
  task that fits, asks the core for `ork claims conferir <thread> --tarefa T2.1 --prazo 540 --json`, in the
  verify sandbox, and only lets the task close with the item approved. A failure comes back with the command, the
  exit code and the tail of the output; no verdict, a typed refusal, another conduction in the thread, a check that does not run
  or a failure of the Gate itself also block, always with the way out: fix and complete again, or return
  the task to `pending` and move on. The recorded task is still checked even if the plan is unreadable at the
  time, because the core reads the plan on its own. One check at a time: a completion that arrives in the
  middle of another is refused right away. From the third identical failure on, the text says to leave the task
  open;
- **idle teammate:** with agent teams in the pilot (below), `TeammateIdle` hands the teammate the next
  plan task that fits, has not closed in this session and whose region is free: no active `path:` lease,
  from any thread, crosses its `touch_paths`, and it does not cross the other teammates' tasks. The leases
  come from the snapshot of all threads through the bridge's `maestro` query
  (`ork maestro --json --section leases --offset N`), following the `nextOffset` of the pages that the snapshot's byte
  cap cuts off, up to 10 pages, because the phase session's MCP server only shows those of its own
  thread. The Gate neither takes nor releases a lease: `ork_git_commit` takes the `path:` of each file at
  commit time and refuses the commit with any lease on the path. A teammate that goes idle without completing returns the task,
  which leaves this session's automatic distribution. Without the full lease list (section unavailable,
  gap, conflicting snapshot or more than 10 pages), at the cost cap or with no free task, the teammate
  stays idle.

The Gate never runs verify on its own: the one that really verifies is still `ork verify`.
It reads the role through the bridge's `$.ork.contexto`, the state and the block through `$.ork.retrato`, the leases through the
bridge's `maestro` query and the plan through `ork_artifact_read`, never from the disk in `.orkastery/`. A test that
creates a process can fail in the sandbox and pass in `ork verify`, and the block says so.

Agent teams in the phase session only run in the pilot, off by default. Whoever conducts turns it on in the root
manifest:

```yaml
runtime:
  agent_teams:
    ligado: true
    teammates: 2   # teto de teammates vivos, de 1 a 8
    custo_usd: 10  # teto do custo da sessão, como o /cost soma, até 500
```

With the switch on, GO in the current phase block and the Gate among the mods that go to the session, the
`claude-bg` dispatch adds to `--settings` the variable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, the two caps
(`ORK_AGENT_TEAMS_TEAMMATES` and `ORK_AGENT_TEAMS_CUSTO_USD`) and `teammateMode` `in-process`, because the background
session has no `tmux`. An invalid cap becomes a manifest warning and leaves it off. In every phase session,
with or without the board gate, the Gate refuses to spawn a teammate without the caps, at the live teammate
cap or with the session cost at the cap, and at the cost cap it hands out no new task.

Known limits:

- the Gate's board holds for the session: in a redispatched GO session, a task closed in the previous one can
  be handed to the teammate again, who finds it done on the board and in git;
- the lead gets no warning when a teammate returns a task; it sees it open on the board;
- the Brake's check, in the background, and the Gate's, at completion, can run at the same time in the
  same worktree; each mod only serializes its own;
- the caps depend on the Gate actually loading: the dispatch decides by `--plugin-dir`, and if the mod does not
  register in the session, agent teams stays on with nobody enforcing the caps;
- if the turn is interrupted in the middle of the check, Claude Code goes on without the hook's answer;
- a lease name that the snapshot redacts (an absolute path or text that looks like a secret) arrives unrecognizable and
  crosses no region;
- the behavior of these events in a real `claude --bg` session with agent teams has not been measured yet; the
  kit and core tests cover the mod and the dispatch.

## The conduction #TAG

The `/goal` command extracts the mode from the request itself, without reimplementing anything:

```bash
MODO=$(ork modos --do-pedido "$ARGUMENTS")
ork thread new "<nome>" --mode "$MODO" --worktree auto
```

`ork modos --do-pedido` uses the same `extrairTagDoPedido` as the core. Without a tag in the text, the manifest's
`conduction.default_mode` applies. **Validation against `conduction.allowed_modes` belongs to the
core**, inside `ork thread new`: the host carries the tag and never decides whether it is valid.

## The 3 installation pitfalls

These are the three known ways for the installation to "succeed" and not work. The installer checks all
three, and `--dry-run` shows what it will do about each one.

1. **A manifest without the skill paths installs cleanly and exposes nothing.** A Claude
   Code plugin auto-discovers `skills/<nome>/SKILL.md` and stops there: it does not descend into the bucket directories
   (`core/`, `phases/`, `reviewers/`, ...) that this catalog uses. That is why `plugin.json` declares the
   paths one by one. The test compares those paths with the source catalog and requires
   `onboarding`, added by I15. In this catalog, `claude plugin details orkastery`
   must report 29 entries: 21 skills and 8 commands (the `Skills (29)` line). Startup registers
   skills and commands separately. The earlier proofs, with 17 and 18 skills, are historical.
   Also check the six agents and six hook events, with no loading errors.

2. **Two copies of the catalog diverge, and the divergence only shows up when it has already cost a delivery.**
   The single source is `skills/` at the product root. The installer copies from there and records the source and the
   sha256 of each file in `INSTALADO.json`; reinstalling with `--force` resyncs. Editing the
   installed copy is a red flag: the fix goes back to the catalog and comes down again through the
   installer.

3. **A hook with a relative path silently fails to run, and the guard becomes decoration.** The
   `hooks.json` calls `node "${CLAUDE_PLUGIN_ROOT}/hooks/ork-guard.js"`, never a path relative
   to the working directory, which changes with each thread worktree. After installing, prove that the
   guard script works in isolation:

   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' \
     | node <plugin>/hooks/ork-guard.js ; echo "codigo: $?"
   ```

   Exit code 2 and a `deny` decision in the output: the guard is alive. Exit code 0: the hook is not blocking anything.

## Do not confuse the two layers

Claude Code appears twice in the Orkastery architecture. **Here it is Layer 1**, the podium: the
host where the builder talks and where the `ork` calls come from. It is also **Layer 3**, the
orchestra, when `ork` dispatches `claude --bg` to write code, and that runtime adapter
lives in `core/src/adapters/claude-bg.ts`, called by the core. They are different roles in the same
program, and mixing the two is how the original Orkastery ended up promising an engine it never had.
# Maestro Entry Point

In a new session with the plugin enabled, say `orkastery maestro`. The entry point queries
`mcp__orkastery__ork_maestro` and presents sources, gaps and available actions.
The fixture installation proves the files/routing; activation and a real conversation
depend on the post-SHIP receipt. HITL prioritizes a recommendation, clear options and a native
question in the conductor. Telegram is optional. An authentication failure does not authorize switching
provider, runtime or permissions.

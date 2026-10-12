# Scoped native activation: I-04 / T10

This is the plan for the conductor's review. GO tests fixtures; operational activation only
happens after CHECK, a readiness review, SHIP through `ork` and the rebuild of main.
The initiative stays open until an authorized, controlled dispatch produces a real
event in the canonical state. The author issues no approval or human score.

## Contract proven on Claude 2.1.263

`ork adapter install claude-code` prepares a complete plugin and the file receipt.
`claude plugin validate`, `plugin marketplace add` and `plugin install` check the
native contract. The manifest omits `agents` and `hooks` because it uses the default locations;
the skill paths stay explicit because of the intermediate directories.
I15 added `onboarding`: the integrated catalog contains 18 skills. The T10 proof
with 17 skills and C14 remain historical; the current test run compares the paths with
`skillsDoCatalogo` and requires onboarding to be present.
See the [component rules](https://code.claude.com/docs/en/plugins-reference).

The command `node adapters/claude-code/test/native-plugin.cjs --smoke` produces a JSON
receipt with argv, cwd, timestamps, outputs and real exit codes. The tests use the
[isolated CLAUDE_CONFIG_DIR](https://code.claude.com/docs/en/claude-directory), the
`novaThread(... criarWorktree: true)` API and the installed Claude CLI. The inventory is
26 skills/commands, six agents and six hooks in this catalog. The startup must register
the 18 current skills, eight commands, six agents and six hooks without errors. Both smoke tests
require a real `PermissionRequest`, a canonical `sessao_bloqueada` and a tool that was not
executed. The session's additional configuration contains only the `ask: Bash` rule;
the harness injects no hook and no JSON is replayed as an event.

`--scope project` was tested separately in the project and in the enabled worktree.
Another, non-enabled worktree of the same Git repository and another project loaded zero hooks.
`--scope local` on main does NOT satisfy this exclusion: a worktree without its own
configuration inherited the plugin. `plugin list` and the inventory do not replace startup or an event.
The scope matrix is evidence for this CLI version, not a promise for future versions.

## T11 isolation contract

Both harnesses create homes, XDG directories, caches, sessions and temporary files inside
the attempt. The receipts list the paths and sizes of the files created, identify
the native transcripts/rollouts and confirm the removal of their own directories. No
global inventory or access to protected threads is needed for this proof.

Claude receives the subscription OAuth from `~/.hermes/.env` only through the child environment.
Codex reuses its native ChatGPT cache through a sealed Linux `memfd` descriptor: the fixture
contains a link to the live descriptor, never a persistent copy of the credential. The
original cache is not changed. A refresh that needs to write to that cache is unavailable;
that condition fails the smoke test, without a global login, a paid API or a weakened sandbox.
This mechanism requires Linux and Python with `memfd_create`/seals. The CLI's cache
contract is in the [authentication documentation](https://learn.chatgpt.com/docs/auth).

The smoke test reads `runtime.sandbox` from the manifest of the execution directory and passes the
value to the official adapter. Under `workspace-write`, it requires a real command, a file, usage,
a receipt and an isolated rollout. `read-only` is preserved and fails the proof that requires writing.
The legacy T9 rollout is still handled individually by the conductor/I02; T11
neither deletes nor adopts it and does not change the operational classification of sessions without a thread.

## Preparation and preservation

1. The conductor reviews the candidate, the new receipts, CHECK and the ordering with I-02.
   S1 requires the T11 fix, the intercepted reproduction and the real smoke test in the
   configured sandbox. The committed main already uses `workspace-write`; its dirty
   operational configuration does not change that baseline. Do not change the sandbox to pass.
2. Authorize an explicit set of directories. For this initiative, start
   only with the project root and, when needed, with the thread's worktree
   (`<raiz>/.claude/worktrees/<thread>`). After SHIP,
   a worktree may need an official sync before activation. Each new worktree
   needs explicit installation/enablement and its own proof before the dispatch.
3. Exclude by ID **before resolving any state or file**:
   `ork-grandeevoluc`, `ork-jornadasdpa`, `ork-renarrativac`. Do not sweep threads,
   do not add disabling configuration to them, do not read their configurations
   or run tests in them. Unrelated projects never enter the authorized set.
4. With canonical leases on the directories/regions actually changed, record
   HEAD, base, UID, the Git status restricted to the delivery paths and the hashes of the
   relevant configuration files. Preserve restricted copies of the exact files
   that the CLI will change and of the existing adapter. Do not print environment
   values, credentials or the full configuration. Existing authentication configuration
   is not part of this activation; secrets stay in `~/.hermes/.env`.
5. Check for collisions before installing: the `orkastery` marketplace and the
   `orkastery@orkastery` plugin must match the expected source. A collision or
   divergent configuration requires analysis, never a generic `--force`. The installer
   points out divergences; a file review and a backup precede any replacement,
   which covers only the adapter. Preserve every unrelated settings key.

## Sequence after SHIP and rebuild

On main, under the conductor's leases and authorization, rebuild the CLI from the
merged version and record the effective SHA. Run in each directory of the authorized set:

```bash
ork adapter install claude-code --dry-run
ork adapter install claude-code
claude plugin validate .claude/plugins/orkastery
claude plugin marketplace add "$PWD/.claude/plugins/orkastery" --scope project
claude plugin install orkastery@orkastery --scope project
claude plugin list --json
claude plugin details orkastery
```

If an installation already exists, use that installation's native update flow
after comparing the source and preserving its content; do not accept the same version
number as proof of updated bytes. Revalidate the hashes of the installed receipt and
the paths loaded by the CLI. A reinstall must go through the same check.

The enablement entries are local to the copy of `.claude/settings.json` in each
tree. Do not commit these activation files or propagate them through merge/sync or
copy them to every worktree: that would widen the enabled set. Do not use the
`user` scope, `local` on main, global links, global hooks or edits to `~/.claude`.
Do not replace the existing configuration with a reduced file from the harness.

Rerun the isolated scope matrix with the CLI version that will perform the dispatch.
Record the native startup in the authorized directory. Use `ork phase run` to dispatch
an explicitly authorized proof thread, with claude-bg/opus/high and a controlled
event. The session must appear in the dispatch receipt before the proof; use the
real sessionId to correlate the hook and the ledger on main. The CLI that the sensor calls
is the `ork` rebuilt from main. Do not point it at a wrapper that generates events.

The smoke tests do not replace the operational dispatch: they already proved the plugin
on fixtures, but not the rebuilt main or the real dispatch record. If the
runtime exits, fails or asks for a human before the proof, record that result and
keep the initiative open. Do not fabricate approval. The conductor checks the preservation
of main through the restricted hashes/diffs and keeps the human score pending for the batch.

## Rollback and limits

Keep the hashes from before and after the activation. For each authorized directory,
`claude plugin disable orkastery@orkastery --scope project` stops new
loads; end only the session controlled by `ork`. Restore only the keys
inserted by the plan when they still hold the expected values; if another action changed the
file, reconcile the difference without restoring a whole snapshot over it.
Do not uninstall shared marketplaces or delete caches/data of other plugins.
Reverting the code follows the SHIP rollback, serialized, with no force-push.

The current dispatcher does not automatically prepare the native configuration of new
worktrees. The explicit sequence above covers the activation of the authorized set.
If the operation requires automating this preparation, open a core task/claim, join
the end of the `path:core` FIFO and wait. Do not solve this with a PATH wrapper, a narrower
glob or enablement inherited by excluded threads.
# Proof of the Maestro entry

After activating the delivered version in a new session, enter the exact phrase
`orkastery maestro` and check the origin of the snapshot. An installation record does not
prove loading; keep the session's native identity and the host receipt. Discover the tool with
`select:mcp__orkastery__ork_maestro`, using its full name. A HITL request must use
the conductor's elicitation, preserve cancellation and produce a core readback.
Do not enable new grants or change `interactive` to `worktree` to pass the proof.

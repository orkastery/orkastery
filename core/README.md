# @orkastery/cli, the `ork` core

**A software factory of AI agents that proves its work: parallel threads, verified results, and short decisions only when they matter.**

`ork` conducts coding agents (Claude Code, Codex) through six-phase threads, verifies every
claim by re-running the command that proves it, and only delivers with the push proven on the
remote. It has no embedded LLM: it assembles the prompt, dispatches through the CLI of the
runtime you already use, checks the result in the real world and records everything in an
append-only ledger.

- **Truth, not a report.** Every statement becomes a claim with the command that judges it.
  `ork verify` re-runs it on the thread's real HEAD and, with `ci.required_for_ship`, CI re-runs
  it again on an independent runner before the merge.
- **You choose how often you are called.** One mode per #TAG, in the request itself, decides
  where the cycle pauses. Verification is the same in all of them.
- **Decisions sized for a full day.** Every question `ork` brings you is short, with alternatives
  and one recommendation, so a person running dozens of things at once, including people with
  ADHD, decides in seconds.
- **Subscription, never pay-per-token.** Dispatch uses the runtime CLI's own login. `ork` never
  reads credentials, and the `subscription-only` policy blocks paid providers.

The CLI and the docs are in Brazilian Portuguese today.

## Install

Requires Node.js 20 or newer, git and at least one runtime logged in to your subscription
(`claude` or `codex`).

```bash
npm install -g @orkastery/cli
ork demo            # 30 seconds: a false claim rejected, the fixed one accepted; no account, no model
ork doctor          # what holds on this machine right now (exits != 0 when something blocks)
```

The package ships the product catalog too (skills, references, eval and host adapters), so
`ork eval` and `ork adapter install` work from the global install.

## First steps

```bash
cd your-repository
ork init                                          # writes the orkastery.yaml
ork thread new "fix the date filter" --modo classic --worktree auto
ork phase run <thread> GOAL --prompt "the filter ignores the user's time zone"
ork claims add <thread> src/filter.ts --claim "respects the time zone" --verificar "npm test -- filter"
ork verify <thread>                               # re-runs the claims on the real HEAD
ork ship <thread> --para main                     # serialized merge and proven push
```

`ork board` shows every thread, and `ork pulse` gathers what needs you right now.

## The four modes

The #TAG goes in the request itself. The mode changes **where** the cycle waits for you:

| #TAG | Pauses | Cycle | What it is for |
| --- | --- | --- | --- |
| `#Classic` | 3 | `GOAL* / PLAN* / GO-CHECK* / SHIP-MASTER` | The default: delicate premises |
| `#Maestro` | 1 | `GOAL-PLAN* / GO-CHECK-SHIP / MASTER` | A clear solution, moving fast |
| `#Auto` | 0 | `GOAL-PLAN-GO-CHECK-SHIP-MASTER` | Docs, studies, configuration, audits |
| `#Fast` | 0 | `GO` | A small, clear request that takes minutes |

`*` marks the block that pauses. `#Fast` runs only the GO, with minimal proof (a focused test, a
cheap claim, or an absence declared in the ledger). It does not authorize a push on its own and
does not touch public contract files. `ork modos` is the source of truth.

```text
The mode relaxes the PAUSE. The mode NEVER relaxes VERIFICATION.
```

## Hosts

`ork` talks to the host through thin adapters. Every rule lives in the core:

```bash
ork adapter list
ork adapter install claude-code     # also: codex, hermes, openclaw
```

## Most used commands

| Command | What it does |
| --- | --- |
| `ork doctor` | Checks runtime, manifest, cost policy and sessions |
| `ork thread new <name> --modo <mode>` | Creates the thread, the slug and the ledger |
| `ork phase run <thread> <PHASE> --prompt "..."` | Dispatches the phase on the block's runtime |
| `ork claims add` / `ork verify` | Records claims and re-runs them |
| `ork ci prepare` / `ork ci run` | Takes the claims to the independent CHECK in CI |
| `ork ship <thread> --para main` | Merge serialized by lease, with the push proven by `ls-remote` |
| `ork board` / `ork pulse` | View of the threads and of the human attention queue |
| `ork setup <mode>` | Runtime, model and effort per block of each mode |

The full list comes from `ork help`.

## Build from this repository

```bash
cd core
npm ci
npm run build        # writes dist/index.js (the `ork` bin)
npm test             # builds and runs the suite (node --test)
npm link             # optional: puts this tree's `ork` on the PATH
```

`prepack` builds and copies the catalog from the repository root into `core/`, and `postpack`
removes the copies. That is why `npm pack` and `npm publish` ship the whole product without
those folders existing in the versioned tree of `core/`.

## License

MIT. Full documentation, roadmap and changelog in the Orkastery repository.

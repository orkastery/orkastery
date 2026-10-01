# Orkastery for Claude Code

![Orkastery](assets/orkastery.png)

**English** · [Português](README.pt-BR.md)

> A software factory of AI agents that proves its work: parallel threads, verified results, and short decisions only when they matter.

This plugin brings the Orkastery conduction cycle to Claude Code. Each task becomes a thread with six phases (GOAL, PLAN, GO, CHECK, SHIP, MASTER), run by the local `ork` CLI in its own git worktree. A claim only counts after `ork verify` re-runs its command on the real HEAD, and a question only reaches you when the decision is really yours, with the alternatives and one recommended option.

## What the plugin contains

| Component | What it is |
| --- | --- |
| 20 skills | Thin routers to the `ork` CLI: the phase skills, the governance skills (decision triage, narrative guardian, roadmap keeper, scope check), thread state and tracing, four reviewers for CHECK, and the orchestration experience pack in English and pt-BR |
| 8 commands | `/orkastery:ork`, `/orkastery:goal`, `/orkastery:plan`, `/orkastery:go`, `/orkastery:check`, `/orkastery:ship`, `/orkastery:master`, `/orkastery:onboarding` |
| 6 subagents | `ork-goal`, `ork-plan`, `ork-go`, `ork-check`, `ork-ship`, `ork-master`, one per phase, so each phase runs with its own context |
| 5 checklists | The references the reviewer skills apply: code review axes, security, testing patterns, performance, definition of done |

The methodology lives in the CLI, not in the plugin. When a skill and the CLI disagree, the CLI wins.

## What it needs

1. Node 20 or newer and `git`.
2. The CLI, from npm: `npm install -g @orkastery/cli`, then `ork doctor`.
3. In your repository: `ork init`, then `ork mcp install --project . --host claude-code`. That second command writes the `orkastery` MCP server to the `.mcp.json` of your project; the skills call its tools.

Without the CLI the skills have nothing to route to. The plugin is meant for Claude Code sessions opened inside a repository.

## Install

```bash
claude plugin marketplace add orkastery/orkastery
claude plugin install orkastery@orkastery
```

Then open a session in your repository and say `orkastery maestro`, or run `/orkastery:ork`.

## What it runs, sends and stores

- The plugin ships Markdown and images only: skills, commands, subagents and checklists. It has no hooks, no MCP server of its own, no scripts and makes no network requests.
- Its instructions ask Claude to run the local `ork` CLI and to call the `orkastery` MCP tools that `ork mcp install` configured for your project. Both run on your machine.
- The `ork` CLI keeps its state as files under `.orkastery/` in your repository. It runs no hosted service, opens no network port and calls no model API; while a phase runs, it may keep local helper processes for that session, such as the session watcher. Network access happens only through programs you already use and configure, such as your git remote when a thread ships.
- The `PreToolUse` guard and the session sensors are not part of this plugin. They come with `ork adapter install claude-code`, scoped to one project. Use one of the two install paths: both are named `orkastery`.

## Language

The skills and the CLI output are in Brazilian Portuguese today. You can talk to Claude in English.

## Links

- Source and issues: [github.com/orkastery/orkastery](https://github.com/orkastery/orkastery)
- Documentation: [orkastery.com](https://orkastery.com/)
- Privacy: [PRIVACY.md](https://github.com/orkastery/orkastery/blob/main/marketplaces/PRIVACY.md)
- Security reports: [SECURITY.md](https://github.com/orkastery/orkastery/blob/main/SECURITY.md)
- License: MIT

# Orkastery for Codex

![Orkastery](../../../docs/assets/marca/png/assinatura-com-fundo-1200.png)

**English** · [Português](README.pt-BR.md)

> A software factory of AI agents that proves its work: parallel threads, verified results, and short decisions only when they matter.

This plugin brings the Orkastery conduction cycle to Codex as skills. Each task becomes a thread with six phases (GOAL, PLAN, GO, CHECK, SHIP, MASTER), run by the local `ork` CLI in its own git worktree. A claim only counts after `ork verify` re-runs its command on the real HEAD, and a question only reaches you when the decision is really yours, with the alternatives and one recommended option.

## What the plugin contains

| Component | What it is |
| --- | --- |
| The `ork` entry skill | Recognizes `orkastery maestro`, reads the state of your project through the CLI and presents progress, decisions and delivery in the conversation |
| 20 catalog skills | Thin routers to the `ork` CLI: the phase skills, the governance skills (decision triage, narrative guardian, roadmap keeper, scope check), thread state and tracing, four reviewers for CHECK, and the orchestration experience pack in English and pt-BR |
| 5 checklists | The references the reviewer skills apply: code review axes, security, testing patterns, performance, definition of done |

The methodology lives in the CLI, not in the plugin. When a skill and the CLI disagree, the CLI wins.

## What it needs

1. Node 20 or newer and `git`.
2. The CLI, from npm: `npm install -g @orkastery/cli`, then `ork doctor`.
3. In your repository, with at least one commit: `ork init`, then `ork mcp install --project "$PWD" --host codex`. That second command writes the `orkastery` MCP server to `.codex/config.toml` in your project; the entry skill calls its tools.

Without the CLI the skills have nothing to route to.

## Install

```bash
codex plugin marketplace add orkastery/orkastery
codex plugin add orkastery@orkastery
```

Then start a new Codex session in your repository and say `orkastery maestro`.

## What it runs, sends and stores

- The plugin ships Markdown and images only: skills and checklists. It has no hooks, no MCP server of its own, no scripts and makes no network requests.
- Its instructions ask Codex to run the local `ork` CLI and to call the `orkastery` MCP tools that `ork mcp install` configured for your project. Both run on your machine, inside the sandbox you configured for Codex.
- The `ork` CLI keeps its state as files under `.orkastery/` in your repository. It runs no hosted service, opens no network port and calls no model API; while a phase runs, it may keep local helper processes for that session, such as the session watcher. Network access happens only through programs you already use and configure, such as your git remote when a thread ships.
- Installing skills grants no permission: gates and preflight stay in the CLI. `ork adapter install codex` is the other install path, with the same skills copied into the project.

## Language

The skills and the CLI output are in Brazilian Portuguese today. You can talk to Codex in English.

## Links

- Source and issues: [github.com/orkastery/orkastery](https://github.com/orkastery/orkastery)
- Documentation: [orkastery.com](https://orkastery.com/)
- Privacy: [PRIVACY.md](https://github.com/orkastery/orkastery/blob/main/marketplaces/PRIVACY.md)
- Security reports: [SECURITY.md](https://github.com/orkastery/orkastery/blob/main/SECURITY.md)
- License: MIT

# Orchestration experience

**English** | [Português (Brasil)](orchestration-experience.pt-BR.md)

Configure how the agent talks while running your project: language, timezone, response depth and activation. Twelve rules cover messages, decisions, questions, command destinations, roadmap, evidence, operations, public examples, documentation, coordination and delivery. Gates, permissions and human identity remain in the core.

## Configure the project

⌨️ In the terminal, at the initialized project root:

```bash
ork onboarding
ork experiencia show --json
ork onboarding set maestro --conteudo '{"owner":{"language":"en-US","timezone":"UTC","depth":"curta","experience":true}}' --por equipe
ork experiencia show --json
```

The agenda offers activation with detected values, configuration or opt-out. UTC is a valid example; choose an IANA timezone for your project. The `owner` object in the `maestro` answer persists preferences in `orkastery.yaml`, preserving other answers and sections. The legacy `fuso` field still only advises configuration. Reading preferences creates no human answer, authorship or approval.

| Field | Values | When absent |
| --- | --- | --- |
| `owner.language` | BCP-47 locale, such as `en-US` or `pt-BR` | System locale |
| `owner.timezone` | IANA timezone | Core timezone resolution |
| `owner.depth` | `curta` (short) or `detalhada` (detailed) | `curta` |
| `owner.experience` | `true` or `false` | `true` |

`show --json` reports effective values, their origins and the selected skill. Portuguese locales select the pt-BR variant; other locales select English while retaining the configured response language. Invalid answers are rejected before persistence. An invalid value edited by hand in the manifest raises a warning and falls back to the default until the same `onboarding set` fixes it; meanwhile `adapter install` skips the pack (an `experience: "false"` activates nothing) and `experiencia show` reports the warning. Explicit configuration wins over detection; repeating the same answer applies it to the manifest again.

## Install and check discovery

⌨️ In the terminal, in the same project:

```bash
ork adapter install codex --dry-run
ork adapter install codex
```

Replace `codex` with `claude-code` or `hermes` as needed. Claude Code receives the catalog and a dedicated block in `CLAUDE.md`; Codex receives the catalog and a block in `AGENTS.md`. The `ork init` block and outside content remain intact. `--dir` changes the catalog destination by replacing the host base folder (`.claude` for Claude Code, `.agents` for Codex): the catalog goes to `<dir>/plugins/orkastery` for Claude Code and to `<dir>/skills/orkastery` for Codex; the instruction block stays in the project root and points to the catalog by a path relative to the project, so it works in another clone. A catalog outside the project skips the block with a warning. Without a manifest in that root, installation only copies the adapter.

💬 In the host chat opened in that project, use its Orkastery entry and inspect effective preferences. Claude Code also needs the plugin activation steps reported by the installer. File copies do not prove native discovery or model behavior. Another worktree needs its own installation.

Hermes receives both variants next to `orkastery-devmaster`, which reads configuration with `--projeto <name>` before activation. OpenClaw does not distribute these skills yet; this gap remains tracked in [RM-051: orchestration experience](../roadmap/RM-051-pacote-de-experiencia.md).

## Opt out or remove

⌨️ In the terminal, to disable the pack across entries that read preferences:

```bash
ork onboarding set maestro --conteudo '{"owner":{"experience":false}}' --por equipe
ork adapter install codex
```

Repeat installation for each host with an instruction block. Opt-out removes the managed block during reinstallation. Hermes honors `experience:false` through its entry, keeping the distributed files.

⌨️ In the terminal, to remove just one host's instruction block:

```bash
ork experiencia uninstall codex --dry-run
ork experiencia uninstall codex
```

Removal accepts `codex` and `claude-code`, preserves the adapter and does not change the global preference. Reinstallation can reactivate it if `experience` stays true. Receipts live in `.orkastery/experiencia/<host>.json`. Without external changes, removal restores previous bytes, including CRLF and an originally missing file. Outside edits remain, and a line appended after the block does not merge into the file's last line.

In a fresh clone, `CLAUDE.md` or `AGENTS.md` arrives with the block and without the receipt. A block identical to the generated one is adopted, without duplication. Without the receipt, removal takes out the block and the blank line before it; it only cannot know whether the original file lacked a final newline. Modified or duplicate blocks, incompatible receipts or a linked instruction file (such as `CLAUDE.md` pointing to `AGENTS.md`): `adapter install` skips only the pack, with a warning, and installs the adapter; `experiencia uninstall` refuses without writing. Fix the file by hand; do not delete a receipt to force installation.

## Coordinate work

⌨️ In the terminal, before taking an item:

```bash
ork roadmap reservas
ork fabrica
ork thread new "RM-012 example improvement" --modo auto --roadmap RM-012 --dry-run
```

Actual creation requires an existing item. Dry-run does not reserve it; without dry-run, `--roadmap` uses core reservation. An `RM-NNN` in the name alone produces a warning without automatic association.

MCP tools `ork_roadmap_reservas` and `ork_fabrica` accept `{}` (or only `projeto` with the served project's name) and use the server's pinned project and `origin`. The query runs outside the server loop, which keeps serving other tools; host cancellation or the 90 s deadline end the query process. Results distinguish `atualizado` (current), `desatualizado` (stale) and `indisponivel` (unavailable). Unavailable data is null, not a misleading empty list. Queries can refresh local state-branch copies, but cannot reserve, publish, push or sign gates. Transport uses the installation's authorized GitHub SSH or local bare profile; profile failure stays unavailable.

## Evidence and limits

Focused tests cover preferences, blocks, fresh clones without receipt, conflicts, adapters and MCP contracts. Skill evals are static, not proof of real LLM behavior. From the product repository, `node core/scripts/testar-experiencia-e2e.cjs` installs a local tarball into temporary prefix/HOME, uses the installed binary and checks dry-run, reinstallation, fresh clone, opt-out, removal and restoration. Offline installation requires dependencies available in the npm cache.

Released in `@orkastery/cli` 0.5.0 (tag `v0.5.0`), merged through PR #33. A local commit or local test result is not SHIP.

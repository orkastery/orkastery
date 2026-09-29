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

`show --json` reports effective values, their origins and the selected skill. Portuguese locales select the pt-BR variant; other locales select English while retaining the configured response language. Invalid answers are rejected before persistence. Explicit configuration wins over detection.

## Install and check discovery

⌨️ In the terminal, in the same project:

```bash
ork adapter install codex --dry-run
ork adapter install codex
```

Replace `codex` with `claude-code` or `hermes` as needed. Claude Code receives the catalog and a dedicated block in `CLAUDE.md`; Codex receives the catalog and a block in `AGENTS.md`. The `ork init` block and outside content remain intact. `--dir` changes the catalog destination; the instruction block stays in the project root. Without a manifest in that root, installation only copies the adapter.

💬 In the host chat opened in that project, use its Orkastery entry and inspect effective preferences. Claude Code also needs the plugin activation steps reported by the installer. File copies do not prove native discovery or model behavior. Another worktree needs its own installation.

Hermes receives both variants next to `orkastery-devmaster`, which reads configuration before activation. OpenClaw does not distribute these skills yet; this gap remains tracked in [RM-051 — orchestration experience](../roadmap/RM-051-pacote-de-experiencia.md).

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

Removal accepts `codex` and `claude-code`, preserves the adapter and does not change the global preference. Reinstallation can reactivate it if `experience` stays true. Receipts live in `.orkastery/experiencia/<host>.json`. Without external changes, removal restores previous bytes, including CRLF and an originally missing file. Outside edits remain. Modified/duplicate blocks, incompatible receipts or linked paths cause conservative refusal. Do not delete a receipt to force installation.

## Coordinate work

⌨️ In the terminal, before taking an item:

```bash
ork roadmap reservas
ork fabrica
ork thread new "RM-012 example improvement" --modo auto --roadmap RM-012 --dry-run
```

Actual creation requires an existing item. Dry-run does not reserve it; without dry-run, `--roadmap` uses core reservation. An `RM-NNN` in the name alone produces a warning without automatic association.

MCP tools `ork_roadmap_reservas` and `ork_fabrica` accept `{}` and use the server's pinned project and `origin`. Results distinguish `atualizado` (current), `desatualizado` (stale) and `indisponivel` (unavailable). Unavailable data is null, not a misleading empty list. Queries can refresh local state-branch copies, but cannot reserve, publish, push or sign gates. Transport uses the installation's authorized GitHub SSH or local bare profile; profile failure stays unavailable.

## Evidence and limits

Focused tests cover preferences, blocks, conflicts, adapters and MCP contracts. Skill evals are static, not proof of real LLM behavior. From the product repository, `node core/scripts/testar-experiencia-e2e.cjs` installs a local tarball into temporary prefix/HOME, uses the installed binary and checks removal/restoration. Offline installation requires dependencies available in the npm cache.

This change remains unreleased. Real installation rehearsal, official verification and independent review still need evidence for RM-051 acceptance. A local commit or local test result is not SHIP.

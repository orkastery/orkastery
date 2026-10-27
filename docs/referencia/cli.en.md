# `ork` CLI reference

**English** · [Português](cli.md)

Source of truth: `ork --help`. This document organizes the same information by task, and
explains the **why** behind each group of commands.

Every command exits with a nonzero code when it fails, which makes any of them
usable as a pipeline gate.

---

## Environment and configuration

| Command | What it does |
| --- | --- |
| `ork doctor` | What holds on this machine now. **Exits nonzero if blocked**, never because of a `warn`. With an open thread in the project and no beat of this project in the crontab, it fails with or without `pulse-host.json`, and the fix is `ork fabrica batida instalar`; a round of up to 30 min in `hitl.log` proves the beat of another scheduler (RM-063). With the line in the crontab, a last round more than 30 min ago also fails: the beat stopped. The "pulse transport" check tells the last delivery of the summary: through the other configured host is a warning; through none, a failure. The forge section checks the forge of the `origin` remote (identity, reach, TLS, base path, CLI, login, server, token scope, project and capabilities); without a forge remote and without the `forja:` block, it does not show. With `verify.security_scan` declared, the "security scan" check is `ok` with Docker (CLI and daemon) or with a native binary for every loop tool, and `warn` (never `fail`) when some tool would be `unavailable`: the fix says to install Docker. See [the forge contract](contratos/forja.md) |
| `ork doctor --json [--forja]` | The same checks in the `ork.doctor/v1` contract (verdict, failures, warnings, project, machine) and the factory beat: open threads, crontab line, last round and its age, `atrasada` and the ready `aviso` for the owner. It is what the host beat (OpenClaw and Hermes) reads deterministically (RM-063). The forge section runs only with `--forja`; without the flag, the JSON says `forja: nao-medida` (with it, `forja: medida`) |
| `ork demo [--manter] [--dir D]` | The promise in 30 s: in a temporary repository, `ork verify` fails the agent's false claim and accepts the corrected one; offline, with no account or model (I-56) |
| `ork init [--force] [--name N] [--abbrev A]` | Generates the repository's `orkastery.yaml` |
| `ork modos` | The table of the **4 live modes** of conduction, by #TAG |
| `ork modos --do-pedido "<texto>" [--json]` | Reads the #TAG of a request. **It is what the adapters call**, so they do not reimplement the parsing. A retired #TAG exits != 0 with `modo.aposentado`, instead of silently becoming the default |
| `ork modos migrar [--dry-run] [--por Q] [--json]` | Removes retired modes from `orkastery.yaml` and `setup.json`. Idempotent, with a backup, and does not touch history |
| `ork ciclos` | The 5 cycle variants of `ork thread new --ciclo` |
| `ork setup <modo> --bloco N [--runtime R] [--model M] [--effort E]` | Edits the mode's block and stamps `setup_configured` in the project ledger |
| `ork setup <modo> --bloco N --fallback R:M[:E],...` | The block's runtime fallback order (I-33); `--fallback ""` removes it |
| `ork setup sandbox [confirmar <postura>\|revogar] [--json]` | This machine's sandbox posture (RM-047): a `runtime.sandbox` that relaxes the sandbox (`danger-full-access`) only dispatches through Codex after it is confirmed here. The confirmation lives in `.orkastery/private/postura-local.json` (0600, outside git) and applies only to this checkout; without it, `ork phase run` and `ork retry run` refuse with `runtime.sandbox-nao-confirmado` |
| `ork setup worktree [confirmar [<dir>]\|revogar] [--json]` | This machine's worktree folder (RM-047): a `worktree.dir` whose real path leads outside the root only creates worktrees after it is confirmed here. The confirmation lives in `.orkastery/private/worktree-local.json` (0600, outside git) and applies only to this checkout and this folder; without it, creation is refused with `worktree.dir-fora-da-raiz` |
| `ork setup versionar` | Moves the setup in effect to `orkastery.setup.json`, at the checkout root: through a PR, it applies on every machine and becomes the file you edit (I-52) |
| `ork setup [<modo>] --reset` | Resets the mode (or all of them) to the default |
| `ork onboarding [show\|set <etapa>\|reset [etapa]] [--conteudo JSON] [--por Q] [--json]` | The project's agenda and answers (9 steps); the reset (also `--reset [etapa]`) is selective or total, and idempotent. Secrets stay in the process environment or in the host's vault. Step by step in [onboarding.md](../guias/onboarding.md) |
| `ork onboarding sync [--json]` | Optional publication of the answers to memory, with graceful degradation |
| `ork experiencia show [--json]` | The effective preferences of the experience package; turn it on and off with `ork onboarding set maestro --conteudo '{"owner":{"experience":true}}'` ([orchestration-experience.md](../guias/orchestration-experience.md)) |
| `ork experiencia uninstall <host> [--dry-run] [--json]` | Removes the Claude Code or Codex block; without `--dry-run`, it applies the removal |
| `ork mcp serve --project RAIZ --host HOST` | This project's stdio MCP server (`codex` or `claude-code`); the root comes from `--project`, never from `--projeto` |
| `ork mcp install --project RAIZ --host HOST` | Sets up the host's MCP; accepts `--dry-run`, `--ship-transport` (`github-ssh`, `forja-ssh`, `forja-https`, `bare-local`), `--ssh-fingerprint` (with `forja-ssh`), `--child-permissions` and `--owner-permissions` (Codex) |
| `ork accounts list [--json]` | Account profiles per runtime: id, runtime, directory, state, deadline, last use and last failure. **No secrets**, because the store keeps none |
| `ork accounts add <id> --runtime R --dir D [--sem-login] [--device-auth]` | Creates the profile and its directory (0700) and runs the **CLI's own** login with the profile's env (`claude auth login --claudeai`, `codex login`, `grok login`; with `--device-auth`, grok only, `grok login --device-auth`); without a TTY, it prints the command. Never copies credentials, and `ork` never opens the `grok` `auth.json` (RM-067, F3) |
| `ork accounts remove <id>` | Deactivates the profile; the directory and the CLI login stay where they are |
| `ork accounts check [<id>]` | Checks the login of each active profile (`claude auth status`, `codex login status`; `grok` documents no login check, so its profile stays without a prior check, with the state kept, and the dispatch proves the login, its login error becoming `runtime.auth-missing`) and marks the store: `sem-auth` leaves the rotation; a login by API key, `api_key_helper`, Console or cloud becomes `provider-pago` and never dispatches; a profile whose subscription login was redone comes back; an inconclusive check (timeout, missing binary, unreadable response) keeps the state and records the failure. Exits nonzero when a profile lacks a verified subscription login |
| `ork accounts esgotamentos [--desde 7d] [--json]` | Measures the RM-040 metric without writing anything: the live marks in the account registry and the dispatches with a profile, in each registered project (`ork projetos`), that landed on an account marked by another project, within the mark's deadline. The account comes out as an opaque id, the profile by its id, with no directory (`ork.esgotamentos/v1`). The registry keeps only live marks, so the total is a lower bound |

`--ship-transport` decides how the MCP `ork_ship` pushes the base branch, the only push an agent can trigger. Without
it, `github-ssh` applies (only `git@github.com:`, as always) and the install says which mode origin needs, without a
network call. `forja-ssh` takes any forge host and port (`ssh://git@host:2222/…`, the scp form, `forja.ssh_host` and
`forja.ssh_porta`): the install reads the server key and pins it only once confirmed, by your `~/.ssh/known_hosts` or
by `--ssh-fingerprint SHA256:…` (check the fingerprint with whoever runs the forge; a key is never accepted on first
use); any `@revoked` line for the offered key, whatever its host field (`/etc/ssh/ssh_known_hosts` is read for
revocations only), refuses. Every push checks that key with `StrictHostKeyChecking=yes` and `ssh -F /dev/null`,
without reading your SSH config. `forja-https` pushes through the `auth git-credential` of `gh` or `glab` logged in to
the exact host (`host[:porta]`): the helpers in your config are reset, a single helper is pinned (the real path of the
CLI), no prompt opens, and plain HTTP or credentials in the URL are refused. The CA in `forja.ca` is copied into the
pin and checked by hash; it adds trust and is not exclusive (the system CAs still count), and without it your own git CA
settings apply. A CLI without that subcommand is refused with the minimum version. The token never goes through `ork`. The CLI config folder (`GLAB_CONFIG_DIR` or `GH_CONFIG_DIR`), if set, is pinned at
install and handed to the push; the CLI runs with no update check, no telemetry and no prompt.

The push and its proof run from a private temporary gitdir (0700) that uses the project's objects, straight to the
pinned URL with `GIT_ALLOW_PROTOCOL`: the project's `.git/config`, hooks and `insteadOf` are never read for the push,
and hooks are locked for the local steps after it. If the origin or the repo config changes during the push, the
delivery is not marked as proved (`mcp.ship.transport.mudou-no-push`) and the message says the push may have gone out.

The pin lives in `$XDG_CONFIG_HOME/orkastery/mcp-ship/<hash da raiz>/` (outside the project, dir 700, files 600).
Every ancestor directory must be owned by you or root, not group/other-writable, and not a symlink: a symlinked `/home`
or `XDG_CONFIG_HOME` is refused (fail closed). Pins are per machine: on another one, `ork_ship` is unavailable until the
same `ork mcp install` runs there. Switching modes means removing the `orkastery` entry and reinstalling; mixing
`github-ssh`/`bare-local` with `forja-*` across hosts of the same project is refused at dispatch.

Limits of the `forja-*` modes for now: the background factory publication (`ork fabrica publicar` after SHIP) and the
MCP lookups `ork_fabrica` and `ork_roadmap_reservas` are unavailable. The protection assumes the agent runs sandboxed
and cannot write `~/.config` or `~/.gitconfig`; the user's global git config is trusted. The refusal carries a
`mcp.ship.transport.*` code (the list is in
[SHIP transport over MCP](contratos/forja.md#transporte-do-ship-pelo-mcp)).

`ork doctor` has the "accounts per runtime" check (it reads and reports, without marking the store)
and the probe of the umask and of the permissions of `.orkastery` and `.orkastery/private`. The
".git owner" check fails any file or folder in `.git` whose owner differs from the repository owner
(what `git` run as root leaves behind, and what blocks the owner's fetch and commit), with the
count, examples and the exact `sudo chown -R` in the fix; the doctor runs nothing (RM-037). The
"graph analyzers" check loads `typescript` and micromark the way `ork grafo indexar` does and,
when they are missing, warns (`warn`) with the fix (RM-031). With no profile configured, each
runtime dispatches through the process environment, as before I-33. There is no MCP surface for
`accounts` in this cycle: `add` is interactive and local, and state reads already come from
`ork_observe`. On hosts with a CLI surface (Hermes, OpenClaw), parity comes through these commands.

Automatic switching between profiles of the **same** runtime follows the `runtime_profiles` block of
`orkastery.yaml` (D14, D16). Only a boolean counts as is (N2): text or a number that says yes or no
unambiguously (`off`, `"false"`, `0`, `"no"`, `nao`, `on`, `"true"`, `1`, `sim`) counts as what it
says, with a warning; any other value counts as the default, with a warning. The warning shows up in
`ork phase run`, `ork retry` and `ork accounts` themselves, besides `ork doctor`:
`rotate_same_runtime_on_quota` (default `true` since the owner's decision of 2026-09-19, see
SECURITY.md: quota, credit or plan limit exhaustion switches to the next active profile of the
same runtime; `false` turns it off) and `rotate_same_runtime_on_auth` (default `true`: a lost
login switches to the next profile with a login). An ordinary short-window rate limit never switches
profiles: it waits out the window in the queue (single criterion in [verificacao.md](../guias/verificacao.md)). Manual
switching through the commands above does not depend on these keys.

`runtime_profiles.distribuir` (RM-056) says how dispatch chooses among the runtime's available
profiles: `ordem` (default) is the first one in the store, switching only on quota or login; `carga`
is the one whose account has the fewest live sessions on this machine (claude-bg with a process;
codex with a rollout that is open and was written within `concurrency.stale_after_min`), with ties
broken by least recent use and then by store order. An unknown value counts as `ordem`, with a
warning. The hold set by the keys above still applies, and `ork phase run --perfil <id>` overrides
both: the requested profile dispatches or refuses with a typed reason (`runtime.profile-invalid`,
`runtime.quota-exhausted`, `runtime.auth-missing`), and never switches on its own.

### Times for people: the owner's time zone (I-35)

Origin: the owner's order on 2026-09-19, "never use UTC times to communicate with me again".
All times the CLI shows a person are given in the time zone set by `owner.timezone` (an IANA name in
`orkastery.yaml`; without the key, the system time zone, with `UTC` as the last resort; an invalid
value warns once on stderr and falls back to the default, without changing the exit code). Its
single home is `core/src/horario.ts`.

The time zone is resolved once per process. Every process entry point registers the source from the
project manifest (the CLI's `main`, `ork mcp serve` and the pulse cron entry point,
`dist/pulse-delivery.js`); `core/test/horario-entradas.test.ts` fails any new entry point that
neither registers the source nor declares why it shows no time. Each run of the CLI and of the
cron reads the new value of `owner.timezone`; `ork mcp serve` and the gateways that keep it open
(Hermes, OpenClaw) only see it after they restart.

| Rule | How it appears |
| --- | --- |
| Date and time | `19/09 15:16`; with the year (`19/09/2025 15:16`) only when it is not the current year |
| Today | Where it helps (`desde`), only the time: `15:16`; on another day, the full date |
| Ledger tables | `ork phase list` and `ork audit show --ledger` keep the seconds: `19/09 15:13:34` |
| Deadline | `19/09 16:16 (horário de Brasília), em 1h00` or `venceu há 5min` |
| Time zone label | Once per message: `horário de Brasília` for `America/Sao_Paulo`, `UTC`, and `<IANA>, <sigla>` for the others |

The examples above are the Portuguese output. With `owner.language` or the locale in `en` (RM-061), the commands that follow the locale print the date in ISO (`2026-09-19 15:16`) and the labels in English.

It applies to `ork phase list`, `ork retry list`/`plan`/`run`/`resume`/`parse`,
`ork orquestracao status` (`ork monitor`), `ork board`, `ork lease list`/`acquire`,
`ork pulse`, `ork audit show`, the idle window of `ork audit run`, `ork doctor`,
`ork thread status`, `ork verify`, `ork master`, `ork ship`, `ork ledger stats`,
the text of `ork maestro` and the HITL presentation.

Machine data does not change: ledger, `--json`, contracts, receipts, claims and hashes stay in
UTC ISO. Text recorded as proof (detail, evidence, fix) keeps the ISO and is localized
only on display. JSON that a host reads to show a person gains optional fields,
absolute and labeled, next to the ISO: `prazoLocal` in `ork gate context` and in
`ork_hitl_pending`, and `deadlineLocal`, `receiptAtLocal`, `expiresAtLocal` and
`availableAtLocal` in the facts of `ork maestro --json`.

The weekly MASTER digest uses Friday in the owner's time zone. With the owner (or the system) on
`America/Sao_Paulo`, the day is the same as before under any process `TZ`; an installation without
`owner.timezone` on a server in UTC now uses Friday in UTC, so set the key. The audit
idle window (`audit.janela_ociosa`) is also evaluated in the owner's time zone; without the
key, in the system time zone, as before.

Out of scope: handoff documents and prompts for the next agent session, OrkMind memory
records and literal quotes (runtime logs, artifacts, diff). The test
`core/test/horario-lint.test.ts` fails, in `core/src`, `scripts/` and `monitor/`, any return of
`replace('T', ' ')`, of a fixed time zone outside `horario.ts` and of a raw ISO field in text
(`...Em`, `...At`, `...Ate`, `.ts`, `.prazo` or `toISOString()`), whether interpolated,
concatenated, stored in a local variable that goes into the text or passed straight to
`console.*`.

---

## Target project (RM-052)

Every command reads **one** project. Which one, in order of precedence:

1. `--projeto <nome|caminho>`, a global option, in any position of the command;
2. the `ORK_PROJETO` variable, with the same format;
3. on a host with no project directory (`ORK_PROJETO_EXPLICITO=1`, which OpenClaw and Hermes declare): the only known project, or the `projeto.escolha` refusal with the candidates;
4. the current directory, as always, in the terminal.

An ambiguous or unknown name **is refused with the list of candidates and exit code 4**; `ork` never chooses on behalf of the person who asked.

| Command | What it does |
| --- | --- |
| `ork projetos [--json]` | The projects known on this machine, from the `~/.orkastery/projetos.json` registry (`ork.projetos/v1`): name, abbrev, root, remote without credentials, whether it is still on disk. No secrets |
| `ork projetos registrar [caminho]` | Registers a copy that already existed before the registry. `ork init`, `ork thread new` and `ork fabrica entrar` already register on their own |
| `ork projetos esquecer <nome\|caminho>` | Removes from the registry a copy that vanished or is left over; nothing on disk is deleted |

Every response from `maestro`, `board`, `board plan`, `fabrica`, `roadmap status` and `roadmap reservas` starts by stating the project consulted and what was not read; the other commands that read a project the reader has no way of guessing (on the host, or outside its directory) end with the line `Projeto consultado: ...` on stderr (slice 2). The full contract, for those who consume the registry (RM-053, RM-054), is in [projetos-rm052](contratos/projetos-rm052.md).

On hosts, the roadmap status comes from the network overview (RM-054, slice 2): the `ork_network_roadmap` tool in OpenClaw and Hermes calls `ork network roadmap`, and the MCP one reads the served project across all of its machines. With no project and more than one known, the `projeto.escolha` refusal ends by offering the same overview.

## Threads and phases

| Command | What it does |
| --- | --- |
| `ork thread new <nome> --modo <MODO>` | Creates the thread, the 3-part slug and the ledger |
| `ork thread new <nome> --modo <MODO> --exige-runtime-diferente` | This thread's CHECK needs a runtime that GO did not use (I-43, pillar (a) of the envelope) |
| `ork thread new <nome> --modo <MODO> --done "<critério> :: <comando>"` | An **executable** done criterion, which becomes a core claim and runs in `ork verify`. `;;` separates several; a criterion without a command is refused (I-43, pillar (b)) |
| ↳ options | `[--slug S] [--assunto A] [--worktree auto\|DIR] [--sem-worktree] [--ciclo C] [--dry-run]` |
| ↳ worktree | With `worktree.por_thread: true`, which `ork init` writes, the thread is born with the worktree and the branch `ork/<slug>` without a flag; with the key `false` or absent, only with `--worktree auto`. `--worktree DIR` reuses a directory that already exists; `--sem-worktree` creates the thread without one and warns what happens at `ork ship` (on the base branch, `push_direto_na_base: block`, the `ork init` default, blocks the delivery); `--dry-run` shows the worktree that would be created, or why creation would refuse it. The folder is that of the main tree, even when the command runs from inside another worktree. With `worktree.dependencias` in the manifest, the command runs inside the new worktree, after the thread is created, and shows on the `dependencies` line; a failure goes to stderr with the exact command and does not undo the thread (RM-037) |
| `ork thread new <nome> --modo <MODO> --roadmap RM-NNN` | Reserves the roadmap item for this machine **before** creating the thread; another machine with the same item gets `roadmap.reservado` and creates nothing (I-47) |
| `ork thread new <nome> --modo <MODO> --pedido "<texto>"` | Stores the builder's request in `pedido.md`, in the thread folder, with the sha256 in `thread.json` and in `thread_created`; `ork prompt render` uses that request when `--pedido` is missing. An empty request, or one above 64 KiB, is refused before anything is written (RM-059) |
| `ork roadmap status [--json]` | The single roadmap status report in the approved format: groups with icons, `#HITL` on what waits for the owner, and the closing with what needs the owner and what comes next. When a thread outside the roadmap waits for the owner, the closing gains the line `• Fora do roadmap: N thread(s) esperam você (ork pulse).` and `--json` gains the optional field `foraDoRoadmap` (`{ threads: [...] }`) (R3 of RM-049). RM-063 (F2): `sigo <thread> na fase <F>` only with the session verified alive in the runtime or with the conductor process conducting now; a ghost session, a failed dispatch or no session become `<thread> parada desde HH:MM: <motivo>`, and `--json` carries the `vida` of each one. "O que precisa de você" reads the same queue as `ork pulse` (without the forge and without recording): the owner item the closing did not yet say goes out on one line, with the optional field `filaDoDono`, and "Nada agora" only appears with nothing for the owner and the queue read in full. The channels carry the text (RM-048) |
| `ork roadmap reservas [--json] [--remoto R] [--soltar-orfas]` | Who holds each roadmap item, read from the remote's `ork/roadmap-reservas` branch; marks the orphan reservation (from this machine, of an already closed thread) and, with `--soltar-orfas`, releases it or passes it to another open thread of the same item, with a record (RM-037) |
| `ork roadmap pegar RM-NNN [--thread T] [--nota N] [--por Q] [--maquina M]` | Reserves the item by atomic push: the first one wins. The machine is `--maquina`, `ORK_MAQUINA` or the hostname. `--forcar --motivo M` takes the reservation from a stopped machine, and the reason is recorded |
| `ork roadmap soltar RM-NNN [--forcar --motivo M]` | Gives the item back when the work ends |
| `ork roadmap feat [--thread T] [--nota N]` | Reserves the next FEAT number on the `ork/roadmap-reservas` branch, by atomic push: two machines never take the same number, and a reserved number does not come back (RM-037) |
| `ork docs sincronizar [--escrever] [--so RM-NNN[,RM-MMM]] [--todos]` | Facts from the ledger and git (merge, phase, status) to the roadmap items and the indexes. `--so` limits it to the requested items; in the worktree of a thread with an item, the default is that thread's item, stated in the output; `--todos` goes back to every item, the default at the project root (RM-037) |
| `ork docs verificar [--json] [--pr]` | Product and roadmap documentation against the code and git: frontmatter, readability and parity; exits non-zero on an error. On the PR (`--pr`), another thread's merge and the index that diverge from `main` only warn |
| `ork docs init` | Creates standards, templates, indexes and the Markdown lint in the project |
| `ork fabrica entrar [--maquina NOME]` | This machine joins the shared factory, with that name (`~/.orkastery/maquina.json`), and publishes the first snapshot |
| `ork fabrica [--json] [--sem-remoto]` | What each machine conducts, read from the `ork/fabrica-estado` branch, with the `SESSAO` column of each thread: `viva`, `parada desde HH:MM: <motivo>`, or `-` in a snapshot that does not publish it yet (RM-063, F2) |
| `ork fabrica batida [status\|instalar\|remover] [--por Q] [--json]` | The beat of the pulse sweep in this machine's crontab (RM-063, F1). `instalar` adds, idempotently, the line of the `monitor/pulse.cron` template with the canonical checkout (`ORK_PULSE_PROJECT`), the PATH that finds `node`, `claude` and the transport, and the `# ork-batida` mark, without touching the other entries; it replaces a hand-written sweep line of this project. `remover` removes only the marked line. Both record `batida_instalada` or `batida_removida` in the machine ledger (`~/.orkastery/ledger.jsonl`) when the crontab changes. `status` reports the line and the last round of `hitl.log`, with its age, and exits 1 without the beat; it also states the durable authorization that lets the beat act on its own, or why it does not hold (RM-063, F5) |
| `ork fabrica publicar [--forcar] [--json]` | Writes this machine's snapshot to the branch, with a push without force; after joining, it goes out on its own when a thread is created, a phase is dispatched, delivered and closed, and at every pulse beat |
| `ork fabrica sair` | Stops publishing from here and removes this machine's snapshot from the branch |
| `ork network status [--json] [--sem-remoto]` | The person's Orkastery Network: the machines, from any directory, with the source, the typed gaps and what was not read (`ork.rede-status/v1`, RM-053) |
| `ork network entrar [--maquina NOME] [--forja github\|gitlab] [--repositorio [GRUPO[/SUB...]/]NOME] [--forcar]` | This machine joins the network: checks the private home `<usuario>/orkastery-network` on the forge, creates it when missing, publishes the first snapshot and only then records the name and the membership. The identity comes from the authenticated `gh` or `glab`. On GitLab, `--repositorio` takes `[GROUP[/SUB...]/]NAME` and the home is created in the group when the person is Maintainer or above. `--forcar` takes a name that another installation uses, recorded in the commit. On a self-hosted GitLab, `--forja gitlab` requires `GITLAB_HOST=<host>` (with the port, when there is one): without it the network looks at gitlab.com, and with no login there the refusal says `glab without a login on gitlab.com` and asks for `GITLAB_HOST`. `ork network roadmap` reads the host the same way; the ork never probes other hosts |
| `ork network publicar [--forcar] [--json]` | Writes this machine's snapshot to the home, with a push without force; after joining, it goes out on its own at the pulse beat and on thread events |
| `ork network sair` | Stops publishing from here and removes this machine's snapshot from the home; it overrides the membership inherited from `ork fabrica entrar` |
| `ork network roadmap [--projeto P] [--json] [--sem-remoto]` | The network roadmap, from any directory: for each project, the roadmap status report with the threads of all machines, the reservations and the threads per machine, with the source and the time of each part, and a typed gap on what it did not read. `P` is `github:dono/repo`, `gitlab:grupo/repo`, a registry name or the clone root written as a path (`./` or absolute); without a clone, it reads the forge through queries only. An ambiguous or unknown request exits 4, with the candidates (RM-054). With `ORK_PROJETO_EXPLICITO=1` (the hosts), `P` is only the registry name or the forge on `github.com`, `gitlab.com` or the host of a registered project, and the current directory's project only comes in through the registry |
| `ork thread new <nome> --from-finding <ID>` | Opens the thread from an audit finding. Evidence, claim and proposal travel together; the worktree follows the same rule as `ork thread new`, with `--worktree auto` and `--sem-worktree` |
| `ork thread list [--todas] [--json]` | The project's threads that are NOT closed; `--todas` includes the closed ones, `--json` returns JSON |
| `ork thread status <thread-id> [--json]` | The thread's state, cross-referenced with the runtime; `--json` returns the thread.json |
| `ork phase run <thread> <FASE> --prompt "<texto>"` | Dispatches the phase as a background agent. With `concurrency.max_parallel_threads` live sessions in other threads of the project (a session's `exec:<thread>` conduction, from any runtime or account), it refuses with `concurrency.limite`, says who occupies the slots, records `slot_refused` and exits with 3 (wait, as with the conduction); a stopped session (no work for `concurrency.stale_after_min`), one escalated to the owner, blocked in the runtime, flagged as silent by the pulse or with its turn ended without a result (the Stop with no activity at all for 15 min; RM-058) does not occupy a slot, nor, at the limit, does one the runtime shows ended (`stopped`, `done`, `failed`, `completed`, `exited`) or ghost in each account's `claude agents --json --all` and Codex rollouts, such as one stopped with `claude stop` before its result (absent from the list or with a failed read, it keeps counting; RM-037), and one that keeps running after a planned pause or a failed verify does; with `--esperar`, it waits for the slot, reading the runtime again every 30 s. On codex, a block with GO and no baseline goes out with the baseline recorded by the dispatch, also on the `ork retry` redispatch; through MCP (`ork_phase_run`), which does not run the suite, the missing baseline comes back as `baseline.pendente` with the CLI command (RM-037). With `--perfil <id>` (and `perfil` in `ork_phase_run`), the dispatch goes out through the requested account, or is refused with a typed reason without switching profiles (RM-056). Before calling the adapter, it records the prompt and the `phase_prompt_recorded` event (prompt and sha256); the adapter's dry failure and its exception become `gate_blocked runtime.unavailable` with them (RM-063, F3). With `--runtime grok --model <model>` (RM-067, F1 and F2), the dispatch goes through Grok Build headless (`grok -p` with `--output-format streaming-json`), by explicit request only: `grok` does not enter the block setup, `--fallback`, or `runtime.adapter`, and dispatches without the `ork` MCP until F4. The session id comes from `ork` (`-s`), the session is checked in the folder the runtime writes under `$GROK_HOME/sessions`, and the child runs without `XAI_API_KEY` (by the owner's D1, alternative b of 2026-10-27, the dispatch uses the subscription login that `grok` stored in the profile's `GROK_HOME`, from `ork accounts add --runtime grok`), in the `workspace` sandbox profile (`read-only` with `runtime.sandbox: read-only` and in a PLAN that closes its own block). The watcher closes the phase from the stream `end` event and the supervisor exit receipt: `end_turn` only concludes with the `ork` proof; exit 1 with an `error` object becomes a typed stop; 130, 143, and `cancelled` without an `error` object (with any exit) become `human.pending` with the resume `grok -p continue -r <id>`; a stream without `end` and without a live process becomes `runtime.unavailable` after the deadline |
| ↳ options | `[--runtime R] [--model M] [--effort E] [--dry-run] [--canal C] [--correlacao ID] [--esperar [min]] [--perfil ID]` |
| `ork phase list <thread>` | The ledger history, **with the actual model and effort of each phase** |
| `ork ledger stats --desde 7d [--ate ISO] [--thread T] [--modo M] [--runtime R] [--json]` | Economic telemetry of the ledger in the interval `[desde, ate)` ([FEAT-019](../produto/FEAT-019-telemetria-do-ledger.md)) |
| `ork ledger estimate <thread> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P [--incerteza I]` | Records the explicit estimates of the PLAN phase |
| `ork portfolio create <product\|project\|initiative> <id> --title T [--parent ID]` | Creates the entity in the product, project and initiative catalog ([FEAT-025](../produto/FEAT-025-catalogo-de-portfolio.md)) |
| `ork portfolio list [product\|project\|initiative] [--parent ID] [--json]` | Lists the catalog |
| `ork portfolio show <id> [--json]` | Shows the catalog entity: id, title and state (`--json` returns the whole entity). `--constraints`, `--outcomes`, `--threads`, `--execution-runtime` and `--validation-runtimes`, leftovers of the `objective` retired in I-43, are refused with `portfolio.opcao-aposentada` (exit 2), pointing to `thread new --exige-runtime-diferente` and `--done` |
| `ork portfolio inspect <id> --json` | Entity, origin and cycles, with explicit gaps |
| `ork creation start --input-file F --json` | Durable creation, with the identity of the local process |
| `ork creation show\|list\|events [id] --json` | Queries the creation journal and the recovery |
| `ork creation resume\|compensate <id> --expected-version N --json` | Resumes or compensates the creation at the expected version |

> Passing only `--model` assumes `--effort high`: whoever gives only the model is asking for the
> most capable dispatch. The effective pair goes to the ledger as a verifiable fact, on success, on failure
> and with `--dry-run`.

### Runtime sessions

| Command | What it does |
| --- | --- |
| `ork sessions [--all] [--global] [--json] [--exigir-limpo]` | The runtime's live sessions, cross-referenced with the threads, from all accounts: the process's account and each profile in the store, with the `PERFIL` column (the id, never the directory); a claude-bg session without a live `pid` in a non-terminal state shows up as a ghost (RM-056) |
| ↳ options | `--global` inventories the account's Claude and Codex sessions outside the project root; `--exigir-limpo` exits non-zero with an invalid source or a session without a thread |
| `ork sessions limpar-fantasmas [--dry-run] [--json]` | Releases each ghost session from `ork`: records `sessao_morta` (origin `sessions.limpar-fantasmas`) in the ledger of the linked thread, which frees the conduction and the slot; never calls `stop` or `rm` on the runtime (RM-056) |
| `ork sessions logs <sessao> [--linhas N]` | A session's logs, read in the account where it lives (process or claude-bg profile) |
| `ork sessions stop <sessao>` | Stops a session with the `CLAUDE_CONFIG_DIR` of the account where it lives: the process's or that of a claude-bg profile of the project, even a deactivated one; when found in more than one account, it asks for the full id |
| `ork sessions attach <sessao>` | Prints the attach command (needs a TTY), with the `CLAUDE_CONFIG_DIR=<dir>` prefix when the session belongs to a profile |
| `ork sessions hitl [--json]` | Radar of the sessions that require human action NOW |
| `ork sessions adopt <id> [--json]` | Adopts the session's real identity, without running a prompt ([FEAT-010](../produto/FEAT-010-observacao-de-sessoes.md)) |
| `ork sessions event --tipo T --sessao ID` | Ingests bounded JSON through stdin; observes, without approving a gate |
| `ork sessions watch --thread T [--sessao ID] [--once]` | Watches only the selected session; `--once` does a single scan |
| `ork sessions supersede <thread> <UUID> --fase F --runtime R` | Confirms that the superseded session ended |
| `ork sessions request <thread> <UUID> --fase F --runtime R --pergunta P` | Opens the request bound to the session's native prompt |
| `ork sessions answer <thread> <pedido> --stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]` | Confirms the authenticated delivery of the answer |
| `ork sessions reconcile <thread> <pedido>` | Closes the pending send with only the thread and the request: checks the receipt, never resends |

`ork sessions hitl` is the SESSIONS side of the proactive conduct; `ork monitor` is the
THREADS side. It starts from `claude agents --json --all`, classifies the state of each
session and, only for the stopped ones, reads the screen dump to learn what the session is asking.
That is why it sees the `claude --bg` session that got stuck without having any thread in ork.

| Option | What it changes |
| --- | --- |
| `--json` | Delivers the whole radar, which is what the orchestrator consumes |
| `--so-paradas` | Leaves out whoever does not need the human |
| `--sem-logs` | Does not read the logs: cheaper, but does not say what each session is asking |
| `--so-da-raiz` | Limits the scan to the sessions under the project root |
| `--atencao N` | Minutes after which the stop is highlighted (default 30) |
| `--exigir-limpo` | Exits != 0 while any session is waiting for the human (watchdog) |

Session classes, in the typology that `--json` delivers:

| Class | Runtime state | Needs a human | What it is |
| --- | --- | --- | --- |
| `hitl` | `blocked`, live job | yes | Waiting for an answer now; the question and the options come in the JSON |
| `abandonada` | `blocked`, job already exited | yes | Died waiting for an answer: the work was left half done |
| `falha` | `failed` | yes | Someone decides between resuming, fixing or abandoning |
| `desconhecida` | outside the catalog | yes | A new runtime state: ork warns too much, never too little |
| `trabalhando` | `working` | no | Running |
| `concluida` | `done` | no | Finished |
| `interrompida` | `stopped` | no | Stopped by a human decision already made |
| `interativa` | `idle` | no | A manual session, conducted by someone at the terminal |

Within `hitl`, the subtype says what changes the action: `hitl.credencial` (the session asks for a
secret, such as the 2FA code of a publish), `hitl.permissao` (permission prompt),
`hitl.pergunta` (choice of direction) and `hitl.desconhecido` (stopped with the menu off screen).
Each stopped session comes out with the `alternativas` it offered itself and with ONE
`recomendacao`, derived from the type.

The screen reading understands the two menu formats that the runtime draws: the numbered one
(`1. Passo o codigo agora`) and the selection one (`[✔] codegraph`), which is the format of MCP server
permission prompts. When both appear on the screen, the numbered one wins, because a
task list with checkboxes also matches the second format, and a finished task is not an
answer alternative.

To run in a loop, `scripts/varredura-hitl.sh` calls this command, compares the result with the
previous scan and prints only what is new (exits `10` when there is something new, `0` when there
is nothing, `1` when the runtime did not respond).

---

## Security scan

| Command | What it does |
| --- | --- |
| `ork security-scan [--base <ref>] [--json] [--check classic\|agile]` | In the Agile Check (default; `--check`, then the `ORK_CHECK_MODO` set by `ork verify`, then `check.mode`), the tools run at the same time, with the Trivy database in a persistent cache and the base report by SHA; in the Classic Check, one at a time, as always (RM-072). Scans the HEAD (versioned content, in a detached worktree) with the catalog tools (secrets, dependencies, SAST, IaC, workflows, quality and license) and compares it with the base: `new`, `existing` or `dismissed` by fingerprint. The base is `--base`, or the merge-base with `<remote>/<worktree.base_branch>`. Writes `report.json` and `report.md` to `.orkastery/security-scan/<sha>/` of the main tree (also from a thread worktree). Without `--json`, prints the summary and ends with the path of `report.md`; with `--json`, prints the `ScanReport` and there is no path line. An unknown option exits 2 |

Exits 1 when there is a `new` finding in the loop (every new secret; new dependency, SAST, IaC and workflow findings at
`high` or `critical`; quality and license never enter) and when a dismissal or the `.ork-security/` config is invalid
(the message names the entry; nothing is scanned). With `ORK_SECURITY_SCAN_REQUIRED=1`, a loop-category tool that is
`unavailable` or `failed` also exits 1; without it, it only shows in the report. An unavailable or failed tool never
counts as clean. Two reasons are declared in the report without counting as an unscanned category, here or in the
`ork ship` gate: `unsupported-ci` (`.gitlab-ci.yml` with no GitHub Actions workflow: GitLab CI is left unscanned, only
declared) and `no-requirements-file` (`pip-audit` without `requirements*.txt`), the latter only when another tool of the
same category ran. `ORK_SECURITY_SCAN_DEADLINE_MS` bounds the whole round (each tool gets what is left of the budget);
`ork verify` and `ork ci run` export it when running `security_scan`, as its time limit minus `min(300 s, limit/4)`.
No secret value reaches the report or stdout.

Tool states in the report: `ran`, `failed` and `unavailable`. A Semgrep `ran` may carry a `partial-*` reason
(`partial-timeout: <n>`, `partial-parsing: <n>`): one rule or one fragment of a file was skipped (a `warn`-level error)
and the rest was scanned, and the findings obtained count. If every rule times out, the tool still reads `ran`, with only
the count in the reason: check the reason before treating the `sast` category as covered. An error of another type or of
`error` level leaves the tool `failed`.

In the manifest, `verify.security_scan` declares the command `ork verify` runs (for example `ork security-scan`), and
`verify.timeout_ms_por_comando.security_scan` gives its time limit (`ork init` writes 900000 next to the key), which
also applies to a claim whose `--verificar` is that same command. Without `verify.security_scan`, nothing changes.

## Truth: claims, verify and gates

| Command | What it does |
| --- | --- |
| `ork claims add <thread> <arquivo> --claim "<alegacao>"` | Records a verifiable claim; the lint warns right away about a command that runs the whole suite, pins an intermediate SHA or compares commit counts (I-53) |
| ↳ options | `[--verificar "<comando>"] [--fase F]` |
| `ork claims list <thread>` | The claims and the state of each one |
| `ork claims conferir <thread> --claims C1,C2` | Re-runs only those claims in the `ork_verify` sandbox, in the thread's worktree registered in git (like `ork_verify`, a thread without its own worktree is refused), under the thread's conduction and without writing a receipt: neither `verify_run` nor claim state; only the conduction may record its own refusal or the release of an orphan lease. The one that really verifies is still `ork verify`, which does not run confined: in the sandbox, a node child process fails, and a test claim that creates a process can fail here and pass there. Exits 1 when any of them does not pass, 2 without a sandbox or with an invalid request, and 3 when another session is conducting (RM-059) |
| ↳ options | `--tarefa T1` (instead of `--claims`: the task's verify in the thread's `docs/plan.md`, which must be a single command between backticks; a line with two code spans or with text beyond the command is refused), `--prazo S` (from 10 to 600 seconds; default 180), `--json` (`ork.claims-conferencia/v1`) |
| `ork claims verificar <thread> <claim-id> --comando "<cmd>"` | Attaches the command that proves a claim already made |
| `ork claims retirar <thread> <claim-id> --motivo "<motivo>"` | Withdraws the claim. **The history stays in `claims.jsonl`** |
| `ork claims ausente <thread> --paths A,B --motivo "<motivo>" [--commit SHA]` | Cycle without CHECK: declares in the ledger what was left without proof (`#Fast` uses it, see [modos.md](../guias/modos.md)) |
| `ork verify <thread> [--baseline] [--so-claims] [--check classic\|agile] [--canal C] [--esperar [min]]` | Re-runs the claims and the manifest verify **on the real HEAD**. Runs the Agile Check (default) or the Classic Check (the CHECK as it always was): `--check` wins over the manifest `check.mode`, the `verify_run` records the mode and where it came from (`opcao`, `manifesto` or `padrao`) and the text shows the `check` line (RM-072). The run and the baseline wait for their turn in the heavy-work queue (`concurrency.max_parallel_heavy`, default 1, 0 turns it off): at most that many at the same time across the project's worktrees on this machine and never two in the same worktree, with a kernel lock that is released when the process dies. It waits in the foreground up to `--esperar` or 60 min, warns once on stderr and then refuses with `fila-pesada.ocupada`, says who holds the turn and exits with 3; the MCP `ork_verify` and `ork_ship` wait up to 20 s and return the same refusal; `ork ship`, `ork fix` and the `ork phase run` baseline wait up to their `--esperar`, with the same warning, or 30 s without it, and `ork retry` and `ork ci run`, up to 30 s. A claim command that runs `ork verify` for another thread inside the turn does not wait for its own parent's slot (RM-058) |
| `ork gate next <thread> [--proximo FASE]` | Token gate: same session or new session |
| ↳ options | `[--ocupacao 0..1] [--fonte F] [--transcript ARQ] [--janela N] [--refazer]` |
| `ork gate request <thread> [--motivo M]` | Opens the request correlated with the current pause or escalation |
| `ork gate request <thread> --formato telegram\|terminal` | The same request in the short contract `ork.hitl-curto/v1`, with the stable code on the last line (RM-048) |
| `ork gate answer <thread> <pedido> --resposta-stdin --origem telegram --por ID --mensagem REF [--canal hermes\|openclaw] [--conta ID]` | Receives the gateway's signed envelope and publishes the human decision when approved; `--conta` is the channel's approved account, mandatory on `openclaw` |
| `ork pulse responder --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID] [--em-resposta-a <código>:<id>]` | Receives what the owner typed in the summary channel (`P4EJ a` to the summary, `1a 2c` to the batch, `#OrkPulseOn-15m` to the cadence, `#OrkRetomar` and `#OrkFabrica` to the conduction) and returns the text that the channel relays to the owner. `#OrkRetomar` starts the conduction beat in the background and the result arrives through the transport; `#OrkFabrica` answers with this machine's `ork fabrica` (RM-063). With `--em-resposta-a`, the question code and the id of the message the owner replied to, which the gateway signed at the address `resposta:<code>:<id>`: the answer counts only for the question delivered in that message, and nothing is recorded when the id is not the delivery's (RM-057). With `--em-resposta-a outra`, the bare word in reply to a message that is not the question's: nothing is recorded, and the owner hears where to answer |
| `ork pulse cadencia [<tag>] [--por P] [--json]` | Shows the summary cadence in effect, or changes it by tag (`OrkPulseOn`, `OrkPulseOn-15m`, `-30m`, `-60m`, `OrkPulseOff`); a new question to the owner goes out at once, whatever the tag |
| `ork decisao registrar <thread> --decidido D --porque P --como-mudar C --custo-agora A --custo-depois B --criterio TIPO:REF --quem Q --evidencia E [--razao R] [--reverte ID]` | Records the decision made without asking the owner: it reaches the owner in the next summary. Each field is one line; `--decidido`, `--porque` and `--como-mudar` go up to 200 characters, the costs up to 140, and the refusal states the field and the length. In a session without access to the ledger (codex), the MCP tool `ork_decision_record` records it through the same contract |
| `ork decisao placar <thread> [--json]` | Decided versus asked per phase, reversals, decisions without a trace and the review threshold (13 per phase) |

`--baseline` records the state of the world **before GO**. It is what makes it possible to separate `verify.regression`
(a defect of this thread) from pre-existing debt. It runs with the same per-command deadline as verify
(`verify.timeout_ms_por_comando`, then `verify.timeout_ms`) and the same steal measurement. Only the command's own normal
exit (exit code 1 to 123) has a verdict; a command without a verdict in it (deadline exceeded, killed by a signal, clock
under steal, a command that did not run, or no exit code)
is shown as `NO VERDICT` and does not count as
"already failing": its failure in verify is a failure without a baseline (`verify.failed`). A command missing from the
worktree refuses the baseline with `baseline.dependencia-ausente`, which states the `worktree.dependencias` command (RM-037).

`gate approve` is retired and always refuses. The evidence is born from the authenticated ingress,
is bound to the request and cryptographically revalidated on every `memory sync`. On Telegram,
the gateway delivers the envelope through stdin. In Codex and Claude Code, the MCP server uses the
protocol's elicitation response and keeps a signed private receipt, without the raw text.
Writing a person's name in the ledger does not turn automation into a human act.

I-41 (GO-FIX 1): `ork pulse responder` is called by the Telegram ingress (Hermes or OpenClaw),
never by a person or an agent. The ingress signs, with the channel's own key and the usual
`ork.hitl-answer/v2` body, the pulse address (`pulse`, `resposta`) and the exact text that the
owner typed; the core checks this signature with `autenticarResposta` before reading the text.
`P4EJ a` answers the summary and returns the batch of up to five questions; `1a 2c` answers the batch, and
each answer becomes a `human_gate` through the usual `responderGate`, with a durable receipt. A nonexistent number or
letter, two letters for the same question and an already answered question get an answer
in text, never silence. `--criterio` of `ork decisao registrar` accepts `manifesto:CHAVE`,
`ledger:<thread>#evento:N` or the `eventId`, and `medicao:COMANDO`; a criterion that does not resolve refuses
the decision before it exists.

---

## Autonomy: retry, rate limit and fixes

| Command | What it does |
| --- | --- |
| `ork retry policy [--motivo M] [--json]` | The retry policy per typed reason, with the why of each action |
| `ork retry plan <thread> [--motivo M] [--fase F]` | What `ork` would do for the last failed gate. **Computes, does not execute, does not spend an attempt**. On `runtime.unavailable`, it states the step of the recovery ladder, or that the ladder ended (RM-063, F4) |
| `ork retry run <thread> [--reverify] [--por Q] [--dry-run]` | Executes the typed action. `--por` authorizes when the mode's block pauses. On `runtime.quota-exhausted` and `runtime.auth-missing`, it continues with the same prompt: another profile of the same runtime only with switching turned on in the manifest (`runtime_profiles.rotate_same_runtime_on_quota`, default `true` since D16; `runtime_profiles.rotate_same_runtime_on_auth`, default `true`), then the block's fallback and the queue (I-33); a plain rate limit waits for the window, without switching. On `runtime.model-unavailable`, the same prompt goes to another profile of the same runtime with the same model and then to the block's fallback, without taking the profile out of the rotation; with no destination, it escalates with the fix `ork setup <modo> --bloco N --model` (RM-037). On `runtime.workspace-untrusted` and `runtime.consent-pending`, the dispatch waits for the owner to run the pause's command; the retry redispatches the same phase with the same prompt, and, for directory trust, only after the account's `.claude.json` records it (in the directory or in one above it up to the git root, or in the worktree's main repository); the runtime's refusal for the same obstacle neither spends an attempt nor raises the effort (RM-055). In `reexecutar`, the prompt comes from the dispatch of the gate's session, from the gate itself or from the most recent attempt of the phase, and the file is found by its sha256, only inside the project; the redispatch carries the same sha256 without asking for the text. Before that, it checks in the runtime that no live session works on the thread: with one, or with no answer from the runtime, nothing is redispatched and the attempt does not count (RM-063, F3). On `runtime.unavailable`, the same prompt climbs the recovery ladder, one step after the other in the same call: bring the runtime daemon back up (on claude-bg, `claude daemon status` tells whether `control.sock` answers, and a running daemon with a mute socket goes out through `claude daemon stop --any --keep-workers` before the redispatch to the same target), the block fallback and another runtime profile; each step goes to the ledger as `runtime_recuperacao`, a step with no target is skipped without spending an attempt, one stopped for a reason that is not the target's is not consumed, and between steps the liveness proof prevents a second session in the worktree; with a mute runtime, the retry brings the daemon back up before the proof and calls the owner on the third refusal in a row; only after the three is the owner called (`gate_blocked human.pending` with three alternatives, one recommended, and the command that resumes with the same prompt). The ladder starts over on each `ork phase run` of the phase, and the effort does not go up (RM-063, F4) |
| `ork retry list [--json]` | The project's **durable** rate limit queue |
| `ork retry resume [--id R1] [--agora ISO] [--ocupacao 0..1]` | Resumes the phase killed by a rate limit in the next window |
| ↳ options | `[--forcar] [--dry-run]` (playbooks: same-session, new-session, escalation) |
| `ork retry cancel <id> --motivo M` | Takes a request out of the queue, with a recorded reason |
| `ork retry parse --stderr "<texto>"` | Reads the reset time from the adapter's stderr |
| `ork fix open <thread> [--so-claims] [--reverify] [--json]` | GO-FIX: derives the exact spec from the failed CHECK |
| `ork fix list <thread> [--rodada N]` | The round's fixes and the verdict of each one |
| `ork fix reverify <thread> [--rodada N] [--parcial] [--json]` | CHECK-REVERIFY with a verdict **per fix** |

`--parcial` is **refused** if the round has any type B fix: partial after
type B is not CHECK.

---

## Memory, handoff and recall

| Command | What it does |
| --- | --- |
| `ork handoff export <thread> [--proxima-fase FASE] [--slug S]` | Triaged handoff; with OrkMind, publishes through G3 with the full package and readback |
| `ork handoff recall <thread> <ponteiro>` | Resolves a `path#ancora` pointer back to its content |
| `ork recall <thread> --fase FASE` | Late retrieval of pointers and discovery of handoffs by tenant, thread and phase |
| ↳ options | `[--id ptr-N] [--todos] [--forcar] [--sem-conteudo] [--json]` |
| `ork memory status [--json] [--sondar]` | The effective regime (`files` or `orkmind`), the tenant, the degradation and the probed state of the embeddings: the search universe per collection, what stays out of the search (entries with `injection_risk`, expired entries and those in other collections, as counts only), the index coverage against the universe and the warning when the index covers less; `--sondar` makes a real call and measures the latency |
| `ork memory sync [<thread>] [--json]` | Publishes the eligible decisions, policies, handoff, lesson, roadmap and human gates of the given thread only; without an id, only policies |
| `ork memory inventory --escopo <threads> [--json]` | Read-only inventory of current sources, historical records and excluded tenants |
| `ork memory migrate --operadora <thread> --escopo <threads> [--dry-run] [--json]` | Additive migration through G3, with identity by tenant/source/hash and readback of the chain |
| `ork memory search --tags '<json>' [--colecao C] [--limite N] [--json]` | Deterministic search by tag (`mandatory` always comes back) |
| ↳ options | `[--thread ID] [--restrito] [--janela N]`: reading restricted to the thread; `--restrito` and `--janela` require `--thread` (`memory.query.thread-required`) |
| `ork memory search --texto "<frase>" [--modo hibrido\|vetor\|fts] [--colecao C] [--limite N] [--json]` | Search by meaning in the tenant's search universe (vector and FTS through RRF), **non-deterministic**; the number of FTS ids outside the universe and an index that covers less are reported in `detalhe`; when the universe is not read in full, it exits 1 with a typed reason and no results (also in `--json`); invalid usage exits 2; it does not combine with `--tags` or `--thread` |
| `ork memory index [--modelo primario\|fallback\|todos] [--dry-run] [--json]` | Local vector index of the tenant's search universe, idempotent, with the universe per collection, what stays out of the search, and the estimated tokens and cost; `--dry-run` does not call the provider; when the universe is not read in full (`memory.query.window-saturated`), it exits 1 without embedding |
| `ork brain status\|inventory\|get\|query\|receipts\|context\|dossie\|sync\|reconcile\|apply\|rollback\|bind` | The Company Brain through the CLI ([FEAT-024](../produto/FEAT-024-company-brain-no-cli.md)); without configuration, it answers `brain.configuration.missing` |
| `ork brain dossie --thread T [--decisao ID]` | Decision dossier: binding, citable context, alternatives, who decided and evidence, with the Brain ids. Read-only ([FEAT-033](../produto/FEAT-033-dossie-de-decisao.md)) |

`memory search --texto` also exits 1 when memory is off or unavailable
(`modo.files`, `dsn.env-ausente`, `orkmind.indisponivel`), with a typed reason in text and JSON,
like `memory index`. An empty universe read successfully still exits 0. The proof script
`core/scripts/prova-busca-semantica.sh` prints the answer with the reason before exiting
when a search fails, preserving its exit code. For each pair, the proof also shows, as a
diagnostic, the position and similarity of each target in the vector ranking and how many search
entries have a coherent vector in the index, in a single vector query with `--limite 100`; the exclusive
hit is still judged on the top 5 of that answer, and the diagnostic changes neither the pairs nor the exit
codes. Without arguments, the proof uses the default pairs the owner decided on 2026-10-10 (RM-038):
`watchdog|vigia agendado que inunda a conversa privada com avisos repetidos` and
`duplicacao|dois repositorios gemeos fundidos num unico oficial`; pairs passed as arguments
(`"termo|parafrase"`) replace the default ones.

Reading the five collections uses `memory.universo_timeout_ms`: an integer from 1 to 86,400,000 ms
(24 h), with a default of 90,000 ms, independent of `memory.timeout_ms` (15,000 ms by default for the
other calls). The manifest rejects values outside that range; a direct driver configuration
with an invalid value uses the default, including zero, which never means an unlimited wait.
An expired timeout returns `memory.transport.timeout`. The latency measured in the transport,
including the subprocess and the check of the answer, appears in `latenciaUniversoMs` in the index
JSON and in `embeddings.universo.latenciaMs` in the status JSON. Sources without a measurement do not invent
a latency: in the index, the field is `null`; in the universe, it is absent.

A pointer requested outside its `retrieve_when` comes back as `fora-do-momento`, **without content**.
`--forcar` ignores the moment and states in the result that it did so.

```bash
ork memory search --colecao handoff --tags '{"project":["orkastery"],"skill":["GOAL"]}' --json
ork recall <thread> --fase GOAL --json
ork memory index --dry-run --json
ork memory search --texto "trocar de conta quando acaba a cota" --json
```

Tags use arrays: `project=<tenant>`, `skill=<FASE>`, `situation=<classe>` and
`agent=<runtime>:<modelo>`, with legacy aliases. A missing historical runtime is declared
unknown. `memory migrate` preserves files, previous entries and the full package;
re-running the same source/hash keeps IDs and counts. `memory migrate` returns a nonzero
code if there are failures. `memory sync` fails if the manifest asks for `orkmind` and publishing
fails, including through a preexisting provenance collision or degradation. When the manifest
asks for `files`, the sync returns zero as an informational report, stating that nothing was published.
The JSON report tells failures apart from inventory exclusions. An export that fails is not
proof of an empty collection.

Eligible human decisions are revalidated against the original request. Telegram binds the
option to the ingress MAC; the local MCP signs option, state, phase and subject with a private
key outside the threads. The sync requires a single `human_gate` per request and excludes any
reversal from refusal to approval. On the local path, the operating system account is the
trust boundary; any process under the same UID, including an agent with full access
to the files, can also read the key. Use another account or a sandbox to separate the
MCP server from those processes. Syncing Telegram gates requires the key of the same channel that
signed them and fails explicitly when that key is not available: `ORK_HITL_INGRESS_KEY_HERMES`
for Hermes, `ORK_HITL_INGRESS_KEY_OPENCLAW` for OpenClaw, and `ORK_HITL_INGRESS_KEY`
only for the legacy `v1` envelope, which does not declare a channel. One key does not cover the other
channel, and there is no fallback to the global key in a `v2` envelope.

Only the `orkastery` tenant is active in the factory, using the variable name the manifest
declares, `ORKASTERY_BRAIN_READ_DATABASE_URL`. The OrkMind schema must be initialized; the
health check (the bridge's `health` operation) does not provision tables (`memory.schema.absent`). The
Python bridge ships in the npm package; it uses JSON over stdin and the credential in the child process's environment. The embedder
exists only in the `embed` operation, with the key declared in `memory.embedding.api_key_env` and without the
DSN; a missing embedding is an `embeddings.*` reason, never a regime drop.
See [the governance and migration contracts](../guias/memoria-e-handoff.md) and
[search by meaning](../guias/memoria-e-handoff.md#busca-por-significado-embeddings).

---

## Written knowledge (RM-026 K7)

The company's documents (policy, specification, guide), in versioned Markdown in the folder that `orkastery.yaml`
declares in `conhecimento.dir`, under the [`ork.conhecimento/v1` contract](contratos/conhecimento-rm026.md). Read-only:
writing a document is a commit in a thread, with a PR.

| Command | What it does |
| --- | --- |
| `ork conhecimento listar [--colecao C] [--json]` | The valid documents, with title, collections, file and version (the file's sha256); `ork conhecimento` alone is the same. It does not open the Brain or show references |
| `ork conhecimento mostrar <doc-id> [--json]` | The document with its body, version, source and references: the decisions checked in the ledger and each Brain id checked by `get` in the Company Brain |
| `ork conhecimento colecoes [--json]` | The collections and the documents of each one |
| `ork conhecimento verificar [--json]` | Checks the whole folder, with the Brain ids by `get`, and exits 1 on any gap |

An invalid document and a reference that does not check out come back as a typed gap, never as an answer: the id the
Brain does not have (`referencia.brain-inexistente`), the one it withholds (`referencia.brain-retido`) and the Brain
down or not configured (`referencia.brain-indisponivel`) are distinct gaps. `listar` and `colecoes` exit 1 only when
the folder was not read, and `mostrar`, when the id has no valid document (`documento.inexistente`); wrong usage exits
2. Only `mostrar` and `verificar` call the Brain and read the decisions' ledgers, with limits on `get` calls, time and
bytes per query ([contract](contratos/conhecimento-rm026.md#tetos)). The text follows the owner's language; `--json` is the same in both languages and the same as the MCP tools `ork_conhecimento_listar`,
`ork_conhecimento_mostrar`, `ork_conhecimento_colecoes` and `ork_conhecimento_verificar`.

```bash
ork conhecimento colecoes
ork conhecimento listar --colecao rh
ork conhecimento mostrar doc-politica-de-ferias --json
ork conhecimento verificar
```

---

## Code graph (RM-031, KG3)

The persistent index and the querying of the [deterministic graph](contratos/indice-grafo-kg3.md). The
index lives in the project state, outside git, and answers for the HEAD revision. Since
[KG4](contratos/incremental-grafo-kg4.md), the index of a revision starts from the ancestor index and
re-extracts only what the change reaches, with the same bytes as the full extraction. Since
[KG5](contratos/consumo-grafo-kg5.md), the same queries are in the project's MCP, behind the manifest's
`grafo.mcp` flag, off by default.

| Command | What it does |
| --- | --- |
| `ork grafo indexar [--verificar] [--forcar] [--json]` | Builds the index of the clean HEAD (or confirms the existing one, without rewriting it): incremental from the index of the ancestor revision with the same extractor, or full, saying why; `--verificar` extracts again, checks contract, bytes and determinism and, when there is a base, compares the incremental index with the full extraction; `--forcar` runs a full extraction and only replaces the files if the content changed |
| `ork grafo status [--json]` | HEAD, whether the tree is clean, the HEAD key and index, the analyzers and the stored indexes, with their size and integrity |
| `ork grafo contexto <thread> [--json [--teto-bytes N]]` | Compact package of the thread: diff only with a worktree, GOAL, PLAN and claims; aggregated fan-in, local references, evidence as tuples and a cut by relevance; JSON `ork.thread-graph-context/v2`, 32,768 bytes by default (4,096 to 65,536) |
| `ork grafo vizinhos <nó> [--profundidade N] [--sentido entrada\|saida\|ambos] [--tipo T,...] [--limite N] [--json [--teto-bytes N]]` | Neighborhood of a file, symbol, section or artifact, with the extractor, method and evidence of each edge |
| `ork grafo chamadores <símbolo> [--profundidade N] [--limite N] [--json [--teto-bytes N]]` | Who calls: the `calls` edges that reach the symbol |
| `ork grafo importadores <arquivo\|símbolo> [--profundidade N] [--limite N] [--json [--teto-bytes N]]` | Who imports: the incoming `imports` edges |
| `ork grafo caminho <de> <para> [--sentido saida\|entrada\|ambos] [--tipo T,...] [--json [--teto-bytes N]]` | The shortest path along the edges, in their direction by default |
| `ork grafo amostra [--por-estrato N]` | Stratified sample of edges for manual audit |
| `ork grafo amostra --conferir ARQ [--json]` | Checks the audited sample against the HEAD index and the bytes of the tree |
| `ork grafo limpar [--tudo] [--json]` | Deletes the indexes whose revision is not the HEAD of any tree in the repository (or all of them) and the build leftovers older than one hour |

The node is `caminho`, `caminho#fragmento`, `tipo:caminho#fragmento` or a bare name, which must
be unique: an ambiguous name exits with the candidates. `--limite` keeps the edges closest to the target. The answer is partial by construction (only what the
extractor proves) and says so; with a modified tree, it is the answer for HEAD, with a warning. Since
[slice 5 of KG5](contratos/consumo-grafo-kg5.md#fatia-5-proveniência-conferida-contra-a-árvore), the text output
marks with `[fonte modificada na arvore]` each edge whose origin, target or evidence changed after HEAD and
lists up to five sources that changed; in the JSON, each edge carries `arvore`, and the answer carries `fontes`. It exits
0 with an answer, even an empty one; a typed error exits 1 and, with `--json`, comes as an object.

`--teto-bytes N` (KG5, only with `--json`) writes the answer as compact JSON of at most N bytes: if it
does not fit, the edges farthest from the target are dropped, using the largest `--limite` that fits, and the `teto` field states the
requested limit and whether anything was cut; a path is not cut, and the query refuses with `grafo.consulta.teto-excedido`. The refusal
also comes out compact, but does not go through the cap. Without the HEAD index, the query names the case:
`grafo.indice.ausente` (not indexed), `grafo.indice.outra-revisao` (the stored index is from another
revision or another tree) or `grafo.indice.outro-extrator` (the HEAD index is from another installation, another
Node or another extractor, and the refusal says what changed); with `--json`, these refusals and the one for a
corrupted index carry `estado_do_indice` and `correcao: "ork grafo indexar"`.

In `contexto`, the cap applies even when it is not given explicitly: indexed seeds first, links
between files and those closest to the diff, up to eight groups per target and three examples of seeds
outside the index. Without a worktree, the diff is ignored and declared as such. The internal measure adds up sizes,
not the discovery cost without the graph; tokens stay unavailable. The [v2 contract](contratos/consumo-grafo-kg5.md#fatia-3-pacote-compacto-e-relevante)
details local references, evidence, omissions and the historical measurement. With the flag on,
`ork_grafo_contexto` provides the same JSON in the MCP.

```bash
ork grafo indexar --verificar
ork grafo chamadores core/src/intelligence-graph-repo.ts#lerRepositorio
ork grafo importadores core/src/intelligence-graph-contract.ts --json
ork grafo caminho core/src/index.ts#main dirEstado
```

Every `ork grafo` command needs `typescript` and micromark in the `node_modules` of the `ork` package
itself: they are package dependencies, with exact versions, and the versions go into the index key.
`npm install -g` brings them; when installed inside a project or through `npx`, npm hoists them out of the
package, and the refusal is `grafo.parser.indisponivel`, with the fix in `ork grafo status` and in the
"graph analyzers" check of `ork doctor`. The micromark package is ESM-only and loads through `require`: the graph needs
Node 20.19, 22.12 or newer.

---

## Isolation: worktree and leases

| Command | What it does |
| --- | --- |
| `ork worktree ensure <thread>` | Ensures the thread's worktree, with the base resolved by `ork`; a recreated worktree runs the manifest's `worktree.dependencias`, like a new one (RM-037) |
| `ork worktree sync <thread> [--dry-run]` | Rebases the thread's branch when the base has moved ahead. A branch without commits of its own is recreated at the base SHA (`git reset --keep`), without a rebase; with commits of its own and a rewritten base (no common ancestor, or the point where the thread left the base is no longer in it, as after a force-push), it refuses with `tree.blocked`, cause `base-reescrita`, the count from `git rev-list --count` and the `git rebase --onto` that reapplies only the thread's commits (RM-037) |
| `ork worktree audit <thread>` | Checks the worktree **in git itself**. Exits nonzero if it diverges |
| `ork worktree release <thread> [--forcar]` | Removes the worktree and cleans up the record |
| `ork lease list` | The leases, the families and the queues (merge and region collision) |
| `ork lease acquire <nome> --thread T --motivo M` | Takes a typed lease. Joins the queue if it collides |
| `ork lease release <nome> [--thread T] [--forcar]` | Releases it |
| `ork conducao status <thread> [--json]` | Who conducts the thread now: channel, session or process, phase and since when. Releases, with proof, a conduction with no owner |
| `ork conducao assumir <thread> --por Q --motivo M [--canal C]` | Handoff: ends the current conduction through the runtime, records who took over, from which channel and why, and reserves the turn for that channel |
| `ork conducao sentinela status [--json]` | The Conductor Sentinel on this machine (channel `claude-code`, session, beat and deadline) and the conductor's step in each open thread, computed by the core; the external conductor reads it to yield the dispatch (`ork.conducao-sentinela/v1`) |
| `ork conducao sentinela bater --sessao S [--json]` | The Sentinel's beat: renews the session's presence for 3 min, or takes it when no other session is alive; with another live session on the machine, it exits 3 |
| `ork conducao sentinela desligar --sessao S [--json]` | Removes the session's own presence; the external conductor goes back to conducting |
| `ork conducao autorizar --ate D --pode A[,B] [--por Q] [--nota N] [--json]` | Records the owner's durable authorization on this machine, outside git (`ork.autorizacao-duravel/v1`): what the conduction beat does on its own (`limpar`, `registrar`, `master`, `merge`, `despachar`) and until when. `--ate` takes the date (until 23:59 in the owner's time zone), the date and time, or the instant with a time zone. The deadline goes up to 31 days. Without `--por`, the git `user.name` holds when it names a person. It refuses a session dispatched by `ork` and a request from inside an agent host (Claude Code, Codex, Hermes, OpenClaw), tag and publication, and an action outside the contract, with a typed reason (RM-063) |
| `ork conducao autorizacao [--json]` | The durable authorization in force on this machine, or the typed reason it does not hold |
| `ork conducao batida [--entregar] [--json]` | The deterministic step the cron scan runs after the summary: the merge of the `ork/*` branch PR with the required checks green, the PR clean and the thread CHECK passed after the last product commit (`gh pr merge --match-head-commit`), the delivery record, MASTER by default, the ghost cleanup and the dispatch of the next phase with the recorded prompt, only within the authorization. What it does not do stays in the pulse queue, with the reason and the command. `--entregar` sends the result to the owner through the pulse transport (`#OrkRetomar`). Exits 3 with another beat acting (`ork.conducao-batida/v1`, RM-063) |
| `ork conducao atualizar <thread> [--enviar] [--esperar [min]] [--json]` | The merge of the remote base into the thread branch, under its conduction (the dispatched session that conducts the thread re-enters through its dispatch identity, as in `ork verify`): the thread items go back to "## Não publicado" of the CHANGELOG, in the same group; a code conflict aborts and returns the files. `--enviar` pushes the branch without force and proves it with `git ls-remote` (RM-063) |

Families: `main-tree`, `worktree-write:<thread>`, `path:<glob>`, `board:<card>`,
`service:<porta>` and `exec:<thread>`. All families and the collision queue live in the
project's canonical state: the root and the worktrees compete for the same files.
The `exec` family (I-36) is the conduction: it protects the **execution** in the thread's worktree.

Valid legacy leases of the old families only block while alive, within the 30-minute window that starts
at this version's first query (even without legacy leases) and is marked in `.orkastery/leases/.legado` at the root. During that period, `ork lease list` shows the legacy leases and
diagnoses invalid or unreadable files, which do not block. Once closed, the window does not reopen
because of new legacy files. The diagnostic shows only the file and does not suggest `release` for legacy leases. Legacy names
use up to 200 characters from the set `A-Za-z0-9._/*?:@+-`, with an alphanumeric first character. The arguments of
suggested commands use single quotes with escaping. The deadline allows 1 second of tolerance over 30 minutes.
Symbolic links are ignored. The legacy queue is not read; the wait is rebuilt on the next request.
A legacy lease never proves canonical ownership to enable writing; the legacy copy itself refuses a
second acquisition without queuing the owner behind itself. An empty or unreadable canonical file
less than five seconds old may still belong to the writer that created it with `wx`, and it is not reclaimed.
Legacy leases are never deleted: discarding one writes a `dev:ino:ctime` mark in `.orkastery/leases/.legado-ignorado-<dev>-<ino>-<ctime>` in the canonical state. If a canonical copy exists, `release` acts only on it; without one, the owner of the legacy lease (or `--forcar`) only records the mark. Pruning and closing also use marks, and a replacement with another inode or `ctime` stays visible. The `ctime` uses `ctimeMs` and is checked again before the mark is written. The legacy diagnostic does not suggest `release`; the reason shown is always `(legado)`. No release is announced when nothing was removed.
Automatic reclaim works on Linux and macOS, even without `/usr/bin/flock`. Every reclaim
publishes an exclusive candidate with a ticket in `<lease>.json.retomadas`, using an atomic `rename`;
the ticket order also serializes contenders on different transports. Under that exclusion, it
rereads the content, checks device and inode, and only then removes the expired lease and creates the new one with `wx`.
`flock`, when available, adds a lock on the old inode. When `flock` is missing, its spawn is blocked,
or it times out or fails, the portable path is used. The queue lives in
`.orkastery/leases/<lease>.json.retomadas`; the MCP accepts only a real directory in that format,
with regular candidates that have a single link. The empty folder is removed with `rmdir`, without removing
concurrent candidates. `ork lease list` shows candidates, PID, ticket, age and `.json.tmp` temporary files.
Proof of death through `process.kill(pid, 0)` only holds within the same PID namespace; processes in different
namespaces must not share this queue. A reused PID, or one without permission to be queried, blocks
up to the 30-minute limit (`TTL_PADRAO_MS`). Expired candidates and temporary files are collected on the next
attempt, which returns `lease.resume-unavailable`; the fix is to check `ork lease list` and repeat
the acquisition, without deleting the lease. Temporary files of a provably dead PID are collected even before
the deadline, including partial JSON left by SIGKILL. A reclaimer that lost its candidate cannot
proceed. Device and inode are checked again right before `unlink`; the two system
calls do not form an atomic CAS against writers outside the exclusion.
`nlink === 0` means `lease.busy`, with the normal queue and the winner preserved. A hard link or symbolic
link remains `lease.resume-unavailable`, with human escalation and no automatic retry.
The explicit fix, after assessing ownership, is `ork lease release <nome> --forcar`, followed by a new
acquisition. Normal contention on `flock` or on the tickets remains `lease.busy`.
`ship --dry-run` also checks the valid, live legacy leases during the window, without acquiring the lease.

`ork verify`, `ork phase run`, `ork fix open`, `ork fix reverify` and `ork retry run` accept
`--canal <claude-code|hermes|openclaw|codex|mcp|cli>` (without it, whatever the host declares),
`--correlacao <id>` (the originating conversation or message) and `--esperar [min]` (waits for its turn, up to 30
minutes when given no value, instead of refusing right away). In `ork phase run`, `--esperar` also waits for a project
slot when the session limit is reached. In `ork verify`, `ork phase run` (the dispatch baseline), `ork fix open`,
`ork fix reverify` and `ork ship`, the same `--esperar` applies to the heavy-work queue, with a warning on stderr while
waiting (RM-058).

---

## Delivery and score

| Command | What it does |
| --- | --- |
| `ork ship <thread> --para <branch>` | `--no-ff` merge serialized by lease, and a **proven** push. A push refused by the base branch protection: `entrega.base-protegida`, with the PR/MR guidance. With `verify.security_scan` declared and without `ci.required_for_ship`, a loop category (secret, dependency, sast, iac, workflow) not scanned at the candidate SHA (tool `unavailable` or failed, except `unsupported-ci` and `no-requirements-file`, or no report) stops with `human.pending` before any push; `--allow-unscanned "<who>"` ships anyway and records `ship_unscanned_authorized` in the ledger (with `--dry-run`, it only says what it would record). See [the forge contract](contratos/forja.md#entrega) |
| `ork ship registrar-pr <thread>\|--todas [--remoto R] [--json] [--dry-run]` | A delivery made through a PR becomes `ship_done`: the `ship(<thread>)` merge contained in the remote tip and green CI on the PR head; then `ork master <thread> --aceitar-omissao` closes only that thread (I-57; RM-008). With `--dry-run`, also with `--repo --pr`, it runs the same checks and answers `registraria`, without writing `ship_done`, without changing the phase and without publishing the factory (RM-037) |
| `ork ship registrar-pr <thread> --repo <dono/nome ou grupo/sub/projeto> --pr <n>` | A PR merged in an external repository declared in `ci.external_repositories` becomes `ship_done`: the PR merged into the repository's default branch, with the thread id in the title, body or branch, and the merge contained in the tip of the base, both checked through the GitHub API, or the project's GitLab (with subgroups; `--pr` is the MR `iid`), and the declared check green on the PR head (an empty check declares a repository without CI). An undeclared repository is refused, and so is a remote that names an unresolved forge (`entrega.sem-leitura`: declare `forja.tipo` or log in to the CLI), with no fallback host (RM-037) |
| ↳ options | `[--de <branch>] [--remoto origin] [--autorizar-push <quem>] [--allow-unscanned <who>] [--sem-push] [--dry-run]` |
| `ork ship publicar <thread> [--dry-run] [--remoto R] [--json]` | Publishes the thread branch and opens the PR (MR on GitLab), with proof, only in the mode that already authorizes the push (#Auto and #Maestro). Before any effect, it checks the open thread, nobody conducting it, the branch with product, the CHECK with verdict `PASSOU` after the last product commit, the last green `ork verify` at HEAD (or only the bundle after it), the bundle `.ork-ci/<thread>.json` with the active claims and their commands, the remote's forge (GitHub or GitLab) and the branch PRs (MRs). It pushes the checked sha without force, proves it with `git ls-remote` (only the exact ref), reuses the open PR (MR) or opens one with the text of the thread's `pr-body.md` (title `ship(<thread>): ...`) and writes `ship_published`, also for a push left without proof. A refusal before any effect writes nothing; repeated, or with the PR already merged at HEAD, it answers `ja-publicada`. It does not accept `--autorizar-push`: outside #Auto and #Maestro the push belongs to the owner, and the fix gives the owner's command (on GitLab, `glab mr create … --description-file`). An Enterprise remote with no `forja:` block and no CLI login is refused before any write (`forja.desconhecida`) (RM-059) |
| `ork ship pista [<thread>] [--remoto R] [--json]` | The lane of each open thread already in delivery (`ork.ship-pista/v1`): the steps CHECK, verify, bundle, branch, PR (MR on GitLab), CI, conflict and `ship_done`, and the next step with the action the core declares available (`publicar` or `registrar`) and the command. One read of the remote and one of the PRs (MRs), only for the threads already in delivery; a cut list leaves as not read the PR that was not checked one by one. It writes nothing (RM-059) |
| `ork master <thread> --score 0-5 --justificativa "<texto>" --por <seu-nome>` | Closes the thread: POSTMORTEM, MASTER log and score; without a human `--por`, it refuses. Terminal only: from a host process it is refused with `master.prova-de-canal` |
| `ork master pedir <thread> [--formato telegram\|terminal\|json]` | Asks the owner for the score with a short code; the owner replies through Telegram (`<código> <0 a 5> <porquê>`) and the score goes to the ledger with the ingress receipt (RM-048) |
| ↳ options | `[--classe C[,C]] [--resumo R] [--por Q] [--refazer]`. Without `--classe`, the class comes from the reason of each failed gate (`processo`, `rate-limit` or `conflito`; a reason outside the table maps to `outra`), and `base-avancou` is added, with a warning, when the branch brought in the base before the delivery; this also applies to `--aceitar-omissao` (RM-008) |
| `ork master [--todas] [--json]` | The deliveries, with the **index derived from the ledger**, and those accepted by default |
| `ork master <thread> --aceitar-omissao [--dry-run] [--json]` | Accepts by default only the delivery of the given thread (also `--thread <thread>`), recording the index, the inputs and who decided. A thread without a delivery is refused (exit 1); one already closed is not recorded again (exit 0). With `--dry-run`, it lists what it would close, without recording (RM-008) |
| `ork master --aceitar-omissao [--dry-run] [--json]` | Accepts by default **all** delivered threads of the project, including those from other workstreams, and lists each one. From an agent process with more than one, it warns on stderr with `master.omissao-sem-thread` and the command with the thread |
| `ork master classes` | The fixed failure classes of the POSTMORTEM |
| `ork licoes [--json]` | What comes back in the GOAL and PLAN of the next thread (POSTMORTEM and MASTER) and the policy proposals by recurrence (I-55), saying which ones are already executable (RM-008, slice 3) |
| `ork ci prepare <thread>` | Exports the claims and the manifest commands to `.ork-ci/<thread>.json` in the thread's worktree, with its branch (from the root or from the worktree, the file goes to the thread's branch), which the CI runner re-runs; refuses a claim that runs the whole npm suite and warns about an intermediate SHA and the commit count (I-53) |
| `ork ci run [<thread>] [--bundle ARQ] [--branch B]` | Runs the CHECK on the independent runner; with `--branch`, finds the thread's bundle by the branch name, fails an `ork/*` branch without a bundle and, outside a thread, runs only the manifest commands (RM-037) |
| `ork ci status [--sha SHA] [--remoto origin]` | Queries the exact check published on GitHub or GitLab for the SHA, on the forge resolved by the `forja:` block, the known host or the probe of a logged-in CLI; only a producer in `ci.produtor` approves (`github-actions` by default) |
| `ork privado varrer [--base REF] [--json]` | Scans the repository of the current directory for private data (RM-062): home paths (`/home/<user>`, also escaped), e-mail off the allow list, machine-format hostnames and the terms of the local list, which stays outside git (`termos-privados.txt` in `~/.orkastery/` and in the project's `.orkastery/`, or the file selected by `ORK_TERMOS_PRIVADOS`). The list is read only when it is a regular file owned by the current user, is not a symbolic link and has mode `0600`. Without `--base`, it reads names and all content from versioned files, including binaries (the step in the CI `documentacao` job); with it, the diff against the merge-base with `REF` and the untracked files. Exceptions in `orkastery.privado.json` require a pattern and a value/segment, with a path only as an extra filter; every allowed e-mail is exact and has its own reason. The report gives file, line, column and pattern, never the value, unused-exception details or the path selected by the environment variable; a file name with a finding is shown with `[omitido]`. Exits 1 with a finding under the `dado_privado` policy at `block` or with no policy declared, 0 at `warn` and `off`, and 2 when the scan does not run |

---

## View and scheduling

| Command | What it does |
| --- | --- |
| `ork board [--all] [--sem-remoto]` | The single view of the threads. `--all` brings in all profiles of this machine; with the shared factory, it also shows the other machines |
| `ork board plan` | The scheduler: who moves forward now, who waits, and why |

---

## #Noctum mode (RM-058)

`#Noctum` conducts an arc of many `#Auto` threads inside the envelope the owner authorized, and it only holds with an envelope in force: without one, `ork modos --do-pedido` refuses the tag with `noctum.modo.sem-envelope`, and `ork thread new --modo noctum` never creates a thread. No command authorizes from the terminal: authorization and revocation come only through ingress with proof that it was the owner. Since RM-057 (short answer), the proposal and the requested revocation are questions to the owner with a short code and three choices (the recommended one first), and the owner answers with the letter: in reply to the question message on Telegram (or `<code> a` from any authorized chat, or the bare word without a reply with a single pending question in the chat), or through the host's native dialog over MCP. The Claude Code terminal records no answer for now: the plugin's `UserPromptSubmit` hook only tells the owner where to answer. The envelope hash stays in the question, never in the answer. The gateways' `/ork noctum <arco> autorizar <sha256>` is still accepted, but it is no longer the path taught.

| Command | What it does |
| --- | --- |
| `ork noctum propor --arquivo <envelope.json> [--json]` | Records the envelope proposal and shows the summary and the question to the owner (short code, the three choices and "reply a, b or c"), which also goes out through the pulse transport (`pulse-host.json`) when it exists; `--json` brings the `pergunta` (code, deadline, text and delivery) and `comoAutorizar` with the short answer. It authorizes nothing |
| `ork noctum revogar <arco> [--json]` | Opens the revocation question to the owner, on an authorized arc that is not terminal, and delivers it like the authorization one; a question still waiting for the owner is returned, and nothing is revoked until the owner answers |
| `ork noctum responder <arco> --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]` | The gateways' ingress: the signed authorization (`autorizar <sha256>`) or revocation (`revogar`), checked at the arc address, with the typed receipt `ork.noctum-ingresso/v1` |
| `ork noctum terminal --hook-stdin` | The terminal ingress, which the Claude Code plugin's `UserPromptSubmit` hook calls with the event on stdin (up to 64 KB). It is turned off (RM-057): it recognizes only the short answer to a question waiting for the owner and returns, in JSON (`ork.noctum-terminal/v1`), the refusal `noctum.terminal.desligado` with the notice to answer on Telegram or through the Claude Code confirmation window; it records and forwards nothing, and exits 0. It records again only when Claude Code sends the human origin of the event and a dedicated slice turns it back on, with the limit stated |
| `ork noctum status [<arco>] [--json]` | The arc snapshot: situation, window, measured usage per unit with the gaps, the queue, the closing and the stops, and the report with the receipts and the gaps; without an arc, the list of arcs |
| `ork noctum tique <arco> [--json]` | The closing (revocation, time, supervision stop, cost and empty queue), the watcher and the report, in that order: what the owner's cron calls in the pilot. The watcher reconciles the sessions and applies the stops; with no live conductor, it takes the dispatch and delivery step without waiting for the heavy queue (the verify is left to the conductor) |
| `ork noctum relatorio <arco> [--json] [--reenviar telegram\|openclaw]` | The morning report in the terminal (the `terminal` channel receipt only comes in an interactive terminal), or the resend the owner asks for of the pages without a receipt |
| `ork noctum conduzir <arco> [--json]` | The arc conductor, which the pilot cron relaunches: checks the arc before the lock (ended, or stopped by the supervision, exits 0 without taking the lock or recording a generation), holds the conductor lock while it lives and calls the supervised step (dispatch and delivery) at the queue cadence. Exits 0 with the arc ended or stopped, 2 on refusal (no kernel, no arc, never authorized, unreadable supervision), 3 with another live conductor and 4 with the generation lost; `--json` gives the result with the `codigo` |
| `ork noctum aceite <arco> [--json] [--injecoes <arquivo>] [--limiares <arquivo>] [--publicar <arquivo>]` | The pilot acceptance (`ork.noctum-piloto/v1`): reads the arc log, the supervision, the report register, the ledgers of the arc threads, the remote and the forge, and gives measures M1 to M10 (one that cannot be read is a gap, never zero), criteria A1 to A8 and I1 to I6 with the threshold and its origin (the owner's, through `--limiares`, or the proposal, marked) and the verdict: `aprovado`, `reprovado`, `incompleto` or `simulado` (rehearsal evidence never approves). The full file stays in the state, next to the arc log; `--publicar` writes the version without absolute paths, e-mails, session ids, accounts or machines, with the sha256 of the full one. Exits 0 only with `aprovado`, 1 with another verdict and 2 on refusal |

The `ork noctum aceite` files:

- `--injecoes`: the schedule of the failures the rehearsal or the pilot injected, in JSONL, one per line: `{"falha": "F1", "instante": "<ISO instant>", "alvo": "<work>"}`. `falha` goes from `F1` to `F11`, `instante` is ISO, and `alvo` (optional) is the work id, the thread or the account: a failure with a target only recovers through a signal that touches that target or through a signal of the whole arc (the new generation, the interrupted watcher, the receipt, the tick). Any other key, or a target that is not text, is refused. An empty schedule is a gap. With `F7` in the schedule, the receipt that the automatic resend brings within its cycle counts (five attempts, one every 5 min); the one from the resend the owner asks for (`--reenviar`) does not.
- `--limiares`: the owner's thresholds, in a JSON with `"contrato": "ork.noctum-limiares/v1"` and only the keys `m1MinimoHoras`, `m5MaximoMin`, `entregasMinimas`, `margemDoTeto` and `atrasoDoRelatorioMin`, non-negative numbers. An unknown key is refused with `noctum.aceite.limiares-invalidos`; a missing one stays with the proposal, marked as such.

---

## Prompts and adapters

| Command | What it does |
| --- | --- |
| `ork prompt list` | The prompt templates: every project template and, of the built-in ones, the one in the prompt language |
| `ork prompt lint [--template ID]` | **Fails a broken template before it becomes a dispatch**. With an English-speaking owner, it warns about a project phase template without its `.en` counterpart, which is rendered in pt-BR (RM-061) |
| `ork prompt render <thread> --fase F [--pedido "<texto>"] [--template ID]` | The exact prompt, with the sha256 that goes to the ledger, in the owner's declared language (`owner.language`; without it, pt-BR), as `ork phase run` writes it; `LANG` only changes the CLI text around it (RM-061). Without `--pedido`, it uses the request stored when the thread was created, checked against its sha256 (`thread.pedido.divergente` when the file was edited outside the core); a thread with no stored request proceeds with the example text (RM-059) |
| `ork prompt render --exemplo --fase F --modo M` | Renders without any thread, to review the text |
| `ork adapter list` | The host adapters (Layer 1) and the destination of each one |
| `ork adapter show <host>` | The host's 3 installation pitfalls |
| `ork adapter install <host> [--dir D] [--dry-run] [--force]` | Installs the adapter (`hermes`, `openclaw`, `claude-code`). Divergence is classified by the receipt: a safe one resolves on its own, the rest shows the diff and asks |
| `ork adapter install <host> --dir D --aceitar-catalogo <arquivo>` | Overwrites the copy with the catalog, file by file |
| `ork adapter install <host> --dir D --manter-copia <arquivo>` | Leaves the copy as it is; the divergence is still detected afterwards |

A project template (`prompts/<id>.md`) overrides the built-in one with the same id.

---

## Evaluation

| Command | What it does |
| --- | --- |
| `ork eval [--skill S] [--canario C] [--so-canarios] [--so-skills] [--json]` | Behavior canaries and skill corpus from the catalog of the running package; a catalog found from the cwd that is not the package's own is refused with `eval.catalogo-alheio` (RM-047) |

Exits non-zero on any failure. Canaries: `fx-happy`, `fx-hallucination`,
`fx-stale-base`, `fx-wiki-destroy`, `fx-schema-drift`, `fx-concurrency`.

---

## Audit

| Command | What it does |
| --- | --- |
| `ork audit packs [--estagio E] [--pack P]` | The 7 packs, the stage that activates them and the posture |
| `ork audit run <pack> [--profile P] [--since Nd] [--tudo]` | Builds the pack's prompt and dispatches it through the runtime adapter |
| ↳ options | `[--effort E] [--model M] [--agora "<quem>"] [--forcar] [--dry-run]` |
| `ork audit list` | The project's audit rounds |
| `ork audit show <rodada> [--ledger]` | Context, findings and proposals of a round |
| `ork audit prompt <pack> [--since Nd]` | The exact prompt of the pack, with the sha256 that goes to the ledger |
| `ork audit lint` | Fails a broken audit template (`auditors/`) |
| `ork audit ingest <rodada> --arquivo J` | Records in bulk the findings the auditor wrote |
| `ork audit finding add <rodada> --regra R --titulo T` | Records a finding with evidence, claim and proposal |
| ↳ options | `--arquivo caminho:linha --impacto I --fix F --estimativa E` |
| ↳ options | `[--severidade critico\|maior\|menor] [--irreversivel "<passo>"] [--verificar "<comando>"]` |
| `ork audit verify <rodada>` | Reruns the claims of the findings. **No auditor self-report** |
| `ork audit report <rodada> [--publicar]` | Report with the **mandatory** proposals block |
| `ork audit divida [--pack P] [--todos]` | The debt board: open proposals and recurrence |
| `ork audit finding estado <id> <estado>` | Stamps the finding: `aberto`, `adiado`, `resolvido`, `descartado` |
| `ork audit surface [<dir>] [--regra SPn] [--limite N] [--json]` | **Deterministic** scan of the network attack surface |
| `ork audit surface --registrar <rodada>` | Writes the scan findings to the round's board |

`ork audit surface` exits non-zero when there is a finding, and uses no LLM at all. It works
directly as a CI gate.

---

## Fixed CLI vocabulary

These lists are not extensible by the executor. A change to any of them is a contract change.

| Category | Values |
| --- | --- |
| **Phases** | `GOAL` `PLAN` `GO` `CHECK` `SHIP` `MASTER` |
| **Modes** | `#Classic` `#Maestro` `#Auto` (`#Look` and `#Ork` retired in I-43: writing is refused, reading still works) |
| **Cycles** | `greenfield` `merge-branch` `goal-plan` `gap` `feature-xl-faseada` |
| **Lease families** | `main-tree` `worktree-write:<thread>` `path:<glob>` `board:<card>` `service:<porta>` |
| **Measurement sources** | `runtime_reported` `estimated` `informada` `unavailable` |
| **Gate reasons** | the 16 in `ork retry policy` |
| **Retry actions** | `reexecutar` `corrigir-dirigido` `sincronizar-worktree` `escalar-esforco` `esperar-janela` `escalar-humano` `sem-retry` |
| **Failure classes** | `sem-falha` `erro-de-spec` `base-avancou` `conflito` `rate-limit` `modelo` `processo` `scope-creep` `outra` |
| **Layer 1 hosts** | `claude-code` `hermes` `openclaw` |
| **Audit packs** | `clean-code` `reuse` `architecture` `data-model` `ux` `security-privacy` `process` |
| **Product stages** | `nascente` `crescendo` `maduro` |
| **Memory collections** | `decision` `handoff` `rule` `learning` `roadmap` |

---

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Passed |
| `3` | Request refused because another conduction is running on the thread (`conducao.em-andamento`), with who is conducting and the three actions; or `ork phase run` refused for lack of a slot (`concurrency.limite`), with the sessions occupying the slots (RM-037); or `ork conducao batida` with another beat acting on this machine (RM-063) |
| `4` | Target project not resolved (`projeto.escolha`, `projeto.ambiguo`, `projeto.desconhecido`, `projeto.sem-manifesto`, `projeto.nenhum`), with the candidates; `--json` returns the same as an object (RM-052) |
| other than `0` | Failed, with the typed reason printed |

Commands that work well as a CI gate: `ork doctor`, `ork verify`, `ork eval`,
`ork audit surface`, `ork worktree audit`, `ork prompt lint`, `ork audit lint`.

## I-01: `ork pulse`

```bash
ork pulse [--json] [--registrar --escopo <threads>] [--linhas 20] [--sem-runtime]
ork sessions hitl --registrar --escopo <threads> --linhas 20
ork sessions hitl --registrar --registrar-maquina --linhas 20
```

The `ork.pulse/v1` contract has `consultadoEm`, `runtime`, `precisaDeHumanoAgora`,
`acoesAutomaticas` and `resumo`. Each item reports class, reason, thread, session, phase,
`desdeEm`, `paradaHaMin`, impact, question, options, recommendation, answer command,
sources and evidence. A session and its matching pause in the monitor form a single item;
distinct impediments and a pending score stay separate. The longest wait comes first;
on a tie, the phase with the higher impact comes first, including SHIP before GOAL.

`paradaHaMin` is `null` until there is a recorded observation of the block. The clock starts at the
first `sessao_bloqueada`; it does not try to retroactively recover what the runtime does not
report. `sessao_destravada` requires a known exit state. A failed query, an uncertain
state or a missing session does not prove unblocking. The thread ledger lives on main;
sessions without a thread require `--registrar-maquina` to write to
`${ORKASTERY_HOME:-~/.orkastery}/sessoes.jsonl`. Reading does not authorize a stamp.
Outside the scope, alerts stay on the radar without any write to the thread. The launcher reads
`monitor/pulse-write-scope.json` from the target project. Version 2 declares
`activation: receipt-required`; the old version 1 is still a list of candidates.
Neither version grants writing through installation or rebuild. D17 limits the initial candidates
of this repository to `ork-i06orkmindfa`; new IDs require an explicit decision.

`ORK_PULSE_PROJECT` selects the project. The effective scope comes from the receipt of
`ork activation enable`, bound to the project, tenant, HEAD and bytes of the installed runtime.
`ORK_PULSE_WRITE_SCOPE` alone does not activate the launcher; if set, it must match
that receipt. Without a valid activation, the core observes and keeps delivering alerts. A stale
receipt is diagnosed and grants no stamp. An invalid configuration, alias or conflict
produces `pulse.scope.*`. The launcher does not load credentials; protected threads are refused.
Manual use of `pulse --registrar --escopo ...` keeps its explicit CLI authorization.

Activation on main requires SHIP unblocked through the `ork ship` flow, a rebuild of
`core/dist` in the checkout consumed by the cron and operational proof restricted to the authorized
scope. Swapping the checkout and the executable must be coordinated in SHIP to
avoid a run with old code. A merge alone does not prove containment. Preserve
the other crontab entries, the alerts and the deduplication; confirm the push with
`git ls-remote origin refs/heads/main`. This activation remains pending in I-06.

`--linhas` accepts 1 to 200. When there is no menu, `contextoLogs` holds the last lines,
cleaned, capped and with known credential patterns redacted. The `fase_orfa`
classification uses `runtime.silencio` after `liveness.silencio_max_min` (default 10 minutes),
considering a session event, a commit in the worktree or growth of the Codex rollout or of the
Claude transcript. An unavailable query neither diagnoses nor records an orphan phase. Completion
or an explicit impediment takes precedence. The retry stays in the core:

```bash
ork retry plan <thread> --motivo runtime.silencio --fase GO
ork retry run <thread> --motivo runtime.silencio --fase GO
```

The alert routine does not run these retries or any LLM. It publishes the situation; the explicit
retry path counts attempts and escalates on reaching `retry.max_tentativas` in #Auto.
A query failure exits with code 1, with a diagnosis; `--sem-runtime` is an explicitly
partial read. The cron must require a complete query before consuming new items.

RM-063 (F5): the beat acts after delivering the summary, only with the owner's durable authorization recorded on
this machine (`.orkastery/monitor/autorizacao.json`, [contract](contratos/autorizacao-duravel-rm063.md)):
it releases ghost sessions, records the delivery of an already merged PR and closes through MASTER by
default a delivered, quiet thread, each action in the thread ledger as `varredura_acao`. Without the
authorization, each action becomes a queue item (`varredura.limpar`, `varredura.registrar`) with the
command ready, and MASTER completes the item of the unscored delivery with the command for that thread
only. The additive `varredura` field carries the state of the authorization, the pending actions with
`quemFaz` and `motivoDoBloqueio` and the ones done in the last 7 days. Recording or closing over someone working on
the thread is never automatic: with a block, the item carries `ork thread status <thread>`. RM-063 (F6): the additive `maquinaOciosa` field comes out
when the project has a free slot (below `concurrency.max_parallel_threads`) and a roadmap item reserved
for this machine with nobody working, with the next suggested threads and the command for each; the
sweep alerts the owner right away, once per episode.

For a cron with a minimal PATH, the routine includes `$HOME/.local/bin`. Installations under another
prefix set `ORK_PULSE_RUNTIME_BIN`. The Hermes adapter has an explicit check of the
installed parser, without sending any message:
`python3 adapters/hermes/test/pulse_transport_test.py --parser-real`.

The I-01 delivery keeps the receipts, the installed cron entry and the start of the real window
in `.orkastery/threads/ork-i01orkpulser/evidence/ship/`, always on main. The follow-up
does not turn seven future days into a verification already performed. The score stays human
when the owner gives one; without it, the delivery is accepted by default **with a record**
(I-43): the `aceite_por_omissao` event in the ledger, with the index and the inputs that
produced it, and `regime: 'omissao'` in the score, distinguishable from a human score.

## Ratified MASTER and administrative closure

| Command | Behavior |
| --- | --- |
| `ork master propor ID --score N --justificativa J --por Codex` | Records a pending proposal and postmortem; neither closes nor publishes human learning |
| `ork master ID --score N --justificativa J --por Julio` | Ratifies a delivery with declared human authorship |
| `ork master --json` | Lists the deliveries with their index and the ones accepted by default |
| `ork master batch --aceitar ID:HASH,... --por Julio` | Ratifies the explicit selection of **agent proposals** after a full preflight (it is not the queue, which was removed in I-43) |
| `ork master ratificar --resposta "ratificar ID HASH CLASSE" --por Julio` | Processes a human class choice received by the host |
| `ork master digest responder --resposta "ratificar-lote DATA HASH" --por Julio` | Accepts all proposals of the received digest, if they are still unchanged |
| `ork thread close ID --motivo orfa --por Codex --justificativa J` | Closes administratively; fixed reasons: orfa, engano, superada |
| `ork thread entrega ID --arquivo A --sha256 H --por Codex` | Records a verifiable artifact; the hash is revalidated at scoring time |
| `ork master migrar --dry-run --por Codex` | Shows the legacy fixes; without dry-run, it preserves the originals before fixing |
| `ork master digest enviar` | Sends on Fridays in the owner's time zone (`owner.timezone`; without the key, the system's) with receipts and per-page retry |
| `ork master audit --json` | Audits operational KPIs and exits 1 when evidence is missing |
| `ork audit process --registrar` | Materializes PR1, PR2 and PR3 on the board; at the nascente stage it uses warn |

The host must bind `--por` to the human identity received by the gateway. The CLI does not
introduce its own authentication. The transport configuration and the cron are in
[`core/README.md`](../../core/README.md#master-proposto-ratificação-humana-e-digest).

Active threads outside MASTER are deferred by the migration. The batch runs a full
preflight of the data; a physical write failure may preserve the earlier
ratifications and require a new selection of the pending items. Generic identities such as
`humano` or `operador` are not accepted evaluator names.

The migration requires a `--escopo` allowlist and audits only in `--operadora`; a replay does not
accumulate success events. Legacy entries without a provable identity remain the typed failure
`memory.legacy.provenance-collision`, without changing content, source or history.
A persisted human approval followed by a memory failure stays confirmed:
`memory.human.publication-pending` reports recovery through `ork memory sync <thread>`.
An invalid liveness snapshot is preserved and diagnosed as `liveness.snapshot.invalid`.
Silence keeps a human alert until there is terminal proof from the same session; the retry
queries the runtime again before dispatching. The Codex baseline does not provide that proof;
the integration of the I-04 contract remains separate.

### Write activation and publication profile

Publishing the package or rebuilding `core/dist` does not run `activation enable`. The plan includes
the project HEAD and the SHA-256 of the runtime, bridge and launcher files, scanned recursively:
adding, changing, removing or moving any `.js`, `.cjs`, `.mjs`, `.py`, `.json` or `.sh` file
at any level, including `core/dist/adapters`, invalidates an old acceptance even when the HEAD of the
target project does not change. Temporary artifacts, test files, `node_modules` and `__pycache__` are
left out. A symbolic link, device or socket inside these roots is refused with
`write.activation.runtime-invalid`, with or without a runtime extension, and the same holds for
depth beyond eight levels or more than four thousand files: the hash refuses instead of silently
ignoring. The effective roots are the installed runtime directory, the bridge's `assets/`
directory and the launcher's `monitor/` directory.

`activation status` shows the state and `estadoSha256`, without granting writing. When the plan
context stops being valid, due to a new HEAD, a changed manifest or swapped runtime bytes, status exits
with code 0 reporting `ativa: false`, a typed reason, `plano: null` and the `estadoSha256` of the private
state, which is the hash `disable` requires: the durable rollback stays within reach of anyone who did not
keep the previous hash. All writing stays refused in that state. A private state that is unreadable,
not in mode `0600` or presented as a symbolic link is refused with `write.activation.artifact-invalid`,
without printing any body.

Preparation example, with a synthetic ID standing in for the authorized scope:

```sh
ork activation plan --escopo thread-exemplo --alvos pulse,memory --perfil fabrica --saida plano.json
ork activation status
```

The plan is created with mode `0600` and its hash is displayed. The enable requires that file, its SHA-256,
a CHECK acceptance file and the SHA-256 of that acceptance. The acceptance uses `ork.write-acceptance/v1`,
`aprovado: true`, `fase: CHECK`, a named reviewer, and matching `planoSha256`, HEAD, tenant and profile.
It must result from a review; the preparation command neither produces nor presumes approval.
The operator thread must be in the scope and hold the leases `path:.orkastery/monitor` and
`worktree-write:<operadora>`, acquired normally. No expired lease grants activation.

```sh
ork activation enable --plano plano.json --plano-sha256 HASH_DO_PLANO --aceite aceite.json --aceite-sha256 HASH_DO_ACEITE --operadora thread-exemplo --por executor-nomeado
ork activation disable --operadora thread-exemplo --por executor-nomeado --estado-sha256 HASH_DO_ESTADO
```

Each change generates a private receipt in `.orkastery/monitor/write-activation-receipts/`.
The disable compares the state hash, creates a compensating receipt and preserves data,
previous receipts, alerts and history. It does not change cron, database or ACL. None of these commands
was applied operationally in resumption 4 of I-06.

`memory sync <thread> --perfil fabrica --json` publishes the thread's G3 decisions and handoffs.
The output lists `colecoesForaDoPerfil`: `rule`, `learning` and `roadmap`; the absence of an attempt
on those collections is explicit. The profile neither declares success of the full sync nor resolves legacy.
The sync without `--perfil` stays full. In the CLI, OrkMind sync and migration require activation of the
thread; widening from `fabrica` to `integral` requires its own acceptance. Under that acceptance, legacy
collisions stay `memory.legacy.provenance-collision`, with a failure and exit 1. In `files`, the
earlier informational report remains. The explicit onboarding of I-15 keeps its contract.

The automatic hooks for publication, human approval and handoff export keep
the files and the durable approval when writing is inactive; the publication stays pending.
APIs with an explicitly injected memory/driver remain available for fixtures and dry-run;
that injection is not an option of the operational CLI. Global proposals do not inherit a thread scope.

When activation refuses `memory sync --json`, the command keeps JSON on stdout with
`estado`, `regime`, `publicacao.estado: pendente`, a typed `erro` and `falhas > 0`, plus
exit 1. That diagnosis states that the sync was not run and that the legacy
collision was not reevaluated. The fallback to the file driver keeps its
earlier report of refused attempts; it does not grant native writing.

<!-- maestro-i32:begin -->
## Maestro overview and HITL context (I-32, candidate in GO)

`ork maestro --json` returns `ork.maestro-snapshot/v1`. `ork maestro --help` describes
`--thread ID` and `--section NOME --offset N`. The phrase `orkastery maestro` is conversation
input, not a shell command. CLI/MCP only query; actions use existing typed endpoints
and revalidate state. Errors: `maestro.project.missing`,
`maestro.project.ambiguous`, `maestro.arguments.invalid`, `maestro.source.unavailable`.

The contract caps 50 items/section and 64 KiB; coverage/omissions and unavailable sources
are explicit. The native source timeout is 2 s, the total budget 10 s. Fixture measurements
are not an SLA. An omitted or redacted action is not executable from the snapshot.

`ork gate context <thread> <pedido>` is a read for authenticated callbacks: it returns
request, context, hash, presentation and channel offer without creating a gate. The flag
`--native-offer-stdin` receives the ephemeral HMAC proof `ork.hitl-native-offer/v1` from the
callback, limited to 8 KiB and 60 seconds, bound to host, installation, connection,
session, identity, message and request. Only a valid proof makes the native transport
of that host available; configuration alone, or a fake or expired proof, is not enough.
Hermes/OpenClaw present this offer with `/ork offer <thread> <pedido>` in the
authenticated callback, without answering or approving the request.

`ork receipt-verifiers --json` is the fixed helper of the OpenClaw gateway: it prepares public
proofs of authenticated legacy receipts in the trusted project `ORK_HITL_ROOT` and
exports only public verifiers before the executor's sanitization. If the project is missing
while a private key is present, the helper is refused. If the helper fails or the verifiers
are missing while private authority is present, the tool is refused.

Human answers come in through the host's private
transport, never through a free-form tool argument of the model. Do not copy a key,
binding or envelope into the conversation. Telegram is optional, not a requirement of the query.

HITL usability has top priority. Authority stays in the core; no web control.
Official CHECK/verify, SHIP and live proofs are still pending for this candidate.
<!-- maestro-i32:end -->

> **`ork objective` was retired in I-43.** The command exits with a non-zero code and
> the typed refusal `objective.aposentado`. The text below describes the mechanism
> as it was, and stays as a record of what the envelopes already written mean.
> The two pillars it held survived, as properties of an ordinary thread:
> `ork thread new ... --exige-runtime-diferente` and `ork thread new ... --done
> "<critério> :: <comando>"`. See the retirement in
> [RM-043](../roadmap/RM-043-aposentadoria.md).

To create a new envelope with validation in the same harness, one used `ork objective new <titulo> --request <pedido> --done <criterio> --execution-runtime codex --validation-runtimes codex --independence sessions`.
The mode was opt-in; earlier envelopes keep their hashes and ensemble rules.
In this mode, the supported reviewers come from the `codex` runtime; pass explicitly
`--validation-runtimes codex`. The execution runtime can stay `claude-bg`.
The Claude sensor proves a turn `Stop`, but does not yet provide an authenticated receipt
of CHECK completion. Requiring a `claude-bg` review (or another runtime without that receipt)
returns `maestro.authority.runtime-unsupported` before persisting the objective or threads.
In `objective validate`, `--sessions '<JSON>'` holds the `conductor`, `executor` and `reviewer` selectors, each with `threadId`, `sessionId` and an absolute `worktree`.
The core requires three distinct sessions with a verified dispatch and an intact prompt; executor and reviewer belong to the same thread/worktree.
It also requires a completed CHECK result observed by the core, correlated with the reviewer session; a reported ID or a dispatch still in progress does not prove a review.
With `--verdict rejected`, a negative terminal CHECK (`claims.failed`,
`claims.unverifiable`, `verify.regression`, `verify.failed` or `ci.failed`) is also
accepted: the rejection is recorded and the objective becomes `paused` due to `ensemble.rejected`.
The receipt must prove a normal shutdown of the transport; an interruption, unavailability,
a human wait or a missing correlation remains incomplete and does not record a vote.
The validation receipt preserves the dispatch and result events used. These selectors do not approve gates and do not change host permissions.

With `--threads 1 --independence sessions --validation-runtimes codex`, the single thread
concentrates conduction, execution and review. Its registered `discovery` role and the envelope
hash are preserved; PLAN, GO and CHECK require three distinct verified sessions.
The result must match the last GO and the current approved envelope. With more
than one thread, executor and reviewer must still be in the `delivery` thread.

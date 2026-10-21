# Hermes adapter

In the authenticated Discord callback, `/ork offer <thread> <pedido>` presents the
question and the native offer without answering. The gateway signs an ephemeral proof of
host, session, identity and message, and queries `gate context --native-offer-stdin`.
Only the proof accepted by the core announces the native channel as available in that
conversation, without requiring Telegram. An isolated key/binding or a model payload does not
prove a callback. Simulated tests do not replace live post-SHIP certification.

## Deterministic pulse transport

`bin/ork-pulse-enviar.py` calls the `send_message_tool` API of the installed Hermes and returns
exit code 0 only with `success: true`. It does not open a chat or call a model. Use the Python from
the Hermes venv and an explicit target `telegram:chat_id[:topic_id]`:

```json
{
  "executavel": "/caminho/hermes-agent/venv/bin/python3",
  "argumentos": ["/repo/adapters/hermes/bin/ork-pulse-enviar.py", "--target", "telegram:CHAT_ID", "--message", "{{mensagem}}"]
}
```

Save the configuration in `.orkastery/monitor/pulse-host.json` (`ork onboarding` already writes it
ready; see RM-063 below). `HERMES_HOME` and
`HERMES_AGENT_DIR` let it find another installation; by default it uses `~/.hermes`.
The adapter loads the host environment internally, without printing credentials.
`MEDIA:` markers present in the runtime text are neutralized so that no local files get attached.

Hermes becomes the Orkastery **podium**: a thin router skill, a plugin that declares it and a script
that opens a thread from the builder's raw request.

## Installation

```bash
ork adapter install hermes                       # instala em <projeto>/.hermes
ork adapter install hermes --dir ~/.hermes       # instala para a maquina
ork adapter install hermes --dry-run             # lista o que seria escrito
```

## What is included

| File | Role |
|---|---|
| `skills/orkastery-devmaster/SKILL.md` | The router: reads the #TAG, calls `ork`, presents the gates |
| `hermes.plugin.json` | Declares the skill, the `ork` binary and the conduction tags |
| `bin/ork-abrir-thread.sh` | Opens the thread with the mode read from the request, in one command |
| `bin/ork-brain.sh` | Queries the Company Brain through the OrkMind contract and authenticated identity |
| `bin/ork-maestro.sh` | `ork_maestro`: the Maestro overview of the requested project (`ork maestro --json`) |
| `bin/ork-roadmap-status.sh` | `ork_roadmap_status`: the roadmap status report for this machine only (`ork roadmap status`) |
| `bin/ork-network-roadmap.sh` | `ork_network_roadmap`: the network roadmap (`ork network roadmap`), with the threads of all machines, source, time and gaps; the source for the roadmap status and for the overview of the `orkastery maestro` phrase with no project (RM-054) |
| `bin/ork-network-status.sh` | `ork_network_status`: the person's machines in the Orkastery Network (`ork network status`), with the heartbeat, the forges, the runtimes, the hosts, the source and the gaps; no project (RM-054, slice 3) |
| `bin/ork-vigia-batida.py` | The host heartbeat (RM-063): runs `ork doctor --json` every 30 min and warns the owner when the factory heartbeat is older than 30 min, without an LLM |
| `bin/ork-conhecimento-listar.sh`, `-mostrar.sh`, `-colecoes.sh` and `-verificar.sh` | `ork_conhecimento_listar`, `ork_conhecimento_mostrar`, `ork_conhecimento_colecoes` and `ork_conhecimento_verificar`: the project's written knowledge (`ork conhecimento <consulta> --json`), the same tools as the MCP and OpenClaw (RM-026 K7, slice 3) |

## Written knowledge (RM-026 K7)

The four `bin/ork-conhecimento-*.sh` wrappers are the written-knowledge MCP tools with the same names in the
manifest: each one calls `ork conhecimento <consulta> "$@" --json`, with `ORK_PROJETO_EXPLICITO=1` and
`ORK_CANAL=hermes`, and returns the core's JSON and its exit code as they come (exit 1 is the query that did not answer, with the
gaps saying why). The `--json` goes at the end, after the `<doc-id>` of `mostrar`. The skill says to cite the document
by version and source and to show each gap as a gap, never as the answer, with the same sentence as the OpenClaw
descriptions ([contract](../../docs/referencia/contratos/conhecimento-rm026.md)).

Verification: `python3 -m unittest discover -s adapters/hermes/test -p conhecimento_test.py -v`.

## Retired `obj-*` tickets

`ork_objective_status` and `ork_objective_message` were removed along with `ork objective` in I-43: the core
refuses any subcommand with `objective.aposentado` and exit code != 0. The state of a delivery comes from
`ork thread status <thread>`; the cycles linked to a product, project or initiative, from
`ork portfolio inspect <id> --json`. A conversation message still does not approve a gate: the owner's
decision goes through the correlated `/ork gate <thread> <pedido> <resposta>`.

## The shrinking, which is the point

The Hermes devmaster skill carried the whole methodology in prose: it was the one that "remembered" the
rules of the phases, the gates and the score. The router is a little over a hundred lines long and **loses no
capability at all**, because what it stopped saying, `ork` now executes. The same real cycle
runs before and after; what changed is who guarantees it.

If this skill starts growing again with methodology, that is a red flag: the new rule
belongs in the core, with a test, not in this prose.

## Accounts per runtime (I-33)

This host has a CLI surface, and parity with the MCP hosts comes through the same core
commands; there is no MCP surface for `accounts` in this cycle (`add` is interactive and local, and
state reads already come from `ork_observe`).

```bash
ork accounts list [--json]                          # perfis por runtime, sem segredo
ork accounts add <id> --runtime claude-bg|codex --dir <diretorio>
ork accounts check [<id>]                           # confere o login pelo proprio CLI
ork accounts remove <id>                            # desativa; diretorio e login ficam
ork setup <modo> --bloco N --fallback codex:<modelo>
```

Login runs in the operator's terminal, through the runtime's own CLI with the profile's env; the
adapter never receives, stores or forwards credentials, and the conversation is never a login channel.
When an account exhausts its quota, credit or plan limit, or loses its login,
`ork retry run` rotates and records `runtime_profile_rotated`; the host only presents the event and the
pending human action, when there is one. Switching to another profile of the same runtime on exhaustion has been
on by default since the owner's decision of September 19, 2026
(`runtime_profiles.rotate_same_runtime_on_quota: true`; `false` turns it off), applies only to profiles
that the operator registered and authenticated through the official CLI, to accounts they are entitled to use
under the provider's terms, and never happens on an ordinary rate limit, which waits for the window in the queue
(see `SECURITY.md` and `docs/guias/verificacao.md` at the repository root).

## The 3 installation pitfalls

1. **`ork` outside the Hermes PATH.** The host usually runs with a leaner environment than the
   builder's terminal, and `~/.local/bin` may not be there. `hermes.plugin.json` records the absolute
   path in `requires.comando` and the script honors `ORK_BIN`. Prove it before trusting it:
   `ORK_BIN=$(command -v ork) ; "$ORK_BIN" doctor`.

2. **Reimplementing the #TAG parsing in the host.** It is the obvious temptation; it is just five strings. Two
   implementations diverge at the first new tag, and the divergence shows up as a thread opened in the wrong
   mode, which nobody notices until the pause that never came. Use `ork modos --do-pedido`, always.

3. **Validating `allowed_modes` in the host.** A host that refuses the mode before calling `ork` refuses
   with the rule it has cached, not with the one in the project manifest. Let
   `ork thread new` refuse: the error comes typed, with the allowed list of the right project.

## MASTER digest transport

`bin/ork-master-enviar.py --target telegram:<chat_id>[:<topico>]` receives on stdin a
JSON page `ork.master-digest-page/v1`, with `texto` and `opcoes`. It uses the Telegram configuration
of Hermes and only returns `success: true` when it receives `message_id`. An error does not print
credentials or the raw API response. The transport does not run Ork commands.

The options are a reply keyboard: a tap sends the chosen text as a message from the
human through the already authenticated gateway. There is no private callback for the host to interpret.
The core generates the text with the thread, class and proposal identifier, and the host forwards
the answer to the ratification command with the name of the authenticated human. Sending the page
ratifies nothing. Each page offers at most twelve options and fits in 3,900 UTF-16 code units.

Keyboard contract: [Telegram ReplyKeyboardMarkup](https://core.telegram.org/bots/api#replykeyboardmarkup).
Local proof: `python3 -m unittest discover -s adapters/hermes/test -p master_transport_test.py`.

## Host heartbeat and resuming through the channel (RM-063)

**H1, the host heartbeat.** Every 30 min, `bin/ork-vigia-batida.py` runs `ork doctor --json`. If the
factory heartbeat is older than 30 min, it sends the owner the core's ready-made warning; `ork` missing or
failing becomes an alert; anything else sends nothing. With `--target`, it sends through the same API as
`ork-pulse-enviar.py` (exits 1 if the delivery fails); without it, it only prints. Run it from cron or from a
systemd timer (or from the Hermes scheduler, in a job that runs the script without an LLM):

```text
*/30 * * * * PATH=<dir do node>:/usr/bin:/bin ORK_BIN=<caminho do ork> <hermes-agent>/venv/bin/python3 <hermes>/bin/ork-vigia-batida.py --projeto <projeto> --target telegram:<chat>
```

Never an LLM cron with `deliver=origin`. Cron does not load the shell profile: `ORK_BIN` and the
`PATH` with `node` go on the line itself.

**H2, resuming through the channel.** `#OrkRetomar` or `#OrkFabrica`, alone in a message of the authorized
Telegram chat, go through the same signed pulse ingress (`pre_gateway_dispatch`). `#OrkRetomar`
answers right away and runs the conduction heartbeat on this machine; what started moving again arrives soon after,
through the pulse transport. `#OrkFabrica` answers with `ork fabrica`. In the middle of a sentence, the tag goes to the assistant.

**H3, transport written by onboarding.**
`ork onboarding set maestro --conteudo '{"canal":{"host":"hermes","destino":"telegram:<chat>"}}' --por <dono>`
(or `telegram:<chat>:<topico>`) writes the channel and a ready `.orkastery/monitor/pulse-host.json`, outside
git: the machine is never left without a transport. Python comes from `HERMES_AGENT_DIR` (or
`$HERMES_HOME/hermes-agent`) and the script from `$HERMES_HOME/bin/ork-pulse-enviar.py`; `executavel` and
`script` (absolute paths) replace the two. The JSON in "Deterministic pulse transport" shows, from
the inside, what gets written.

**H4, the other host.** With the channel written for both hosts, the last one becomes the primary and the other the
alternate. If the delivery fails, the transport tries the other host; each delivery goes to
`.orkastery/monitor/transporte.log`, and `ork doctor` shows the pulse transport check: a warning
when it fell back to the alternate, a failure when none delivered.

Verification: `python3 -m unittest discover -s adapters/hermes/test -p conducao_canal_test.py -v`.

## HITL answers in Telegram

The authenticated gateway delivers the original update over stdin to `bin/ork-hitl-answer.py ork_gate_answer <thread> <pedido>` or `ork_session_answer`. Set `ORK_BIN`, `ORK_HITL_TELEGRAM_USERS` and `ORK_HITL_TELEGRAM_CHATS` to the allowed ids. Reply to the alert that contains the line `ork-hitl <thread> <pedido>`; buttons use `ork:<thread>:<pedido>:<número>`. The transport refuses bots, an unauthorized chat/user and an answer without correlation. The core decides on the deadline, the mode and the validity of the request.

The script must receive events directly from the gateway, whose Telegram authentication is the trust boundary. JSON created by an agent is not human evidence. The canary uses a controlled transport; it does not measure the real Telegram network. To retire `ork-watchdog-5min`, disable the job in the host scheduler and keep the receipt; no watchdog may call an approval on the builder's behalf.

Verification: `python3 -m unittest discover -s adapters/hermes/test -p hitl_answer_test.py -v`.

## #Noctum arc through Telegram (RM-058)

The same `hitl-ingress/` plugin receives `/ork noctum <arco> autorizar <sha256>` and `/ork noctum <arco> revogar`, with the same checks as `/ork gate` (host authorization, user, chat, bot, a message of up to 60 s and the `ORK_HITL_INGRESS_KEY_HERMES` key). The envelope is signed at the `noctum` / `arco:<arco>` address, which no `/ork gate` reaches, and goes over stdin to `ork noctum responder <arco>`. Only the typed receipt `ork.noctum-ingresso/v1` of the same arc confirms to the owner, and an act that was already in force gets no second confirmation. The envelope proposal is `ork noctum propor --arquivo <envelope.json>`, and it authorizes nothing. The grammar lives in the core (`GRAMATICA_DO_NOCTUM`), and the core's `noctum-gateways` test checks the copy here. Since RM-057, the proposal reaches the owner as a question with a short code, and the owner answers it as described in the next section; `/ork noctum <arco> autorizar <sha256>` is still accepted, but it is no longer the path taught.

Verification: `python3 -m unittest discover -s adapters/hermes/test -p hitl_noctum_test.py -v`.

## The short answer to the question (RM-057)

The question to the owner (the #Noctum arc one and the short message of a gate) arrives with a short code and choices and ends in "Responda a, b ou c". Through the same signed pulse ingress (`ork pulse responder`), the owner answers with the code and the letter (`K7QX a`) from any authorized chat, with the question number and the letter (`1a`), or in reply to the arc question message with just the letter or the word (`a`, `sim`, `autorizo`). A reply only counts for the message the question was delivered in: the transport (`bin/ork-pulse-enviar.py`) returns its id, and the core keeps it with the question. The plugin takes the reference only from a message of the bot itself (`ORK_HITL_TELEGRAM_BOT_ID`) whose first line is the arc question title (`🔔 N. arco <arco> · <código>`), and only when the owner's text is an answer (the word, the code with the answer or the number with the letter); it signs the envelope at the `resposta:<código>:<id>` address, with the replied message id, and sends `--em-resposta-a <código>:<id>` to the core; the answer in a reply counts even with the bare-word window closed. The "b" confirmation, a refusal and any other message give no reference, and a reply to the short message of a gate does not count (the gate goes on by the number and the code). Without a reply, the bare word only counts with a single question waiting in the chat it went out to, and never with a message from before it went out; with two, the core asks which. Ordinary conversation, even in a reply, goes on to the assistant. The core decides: the current question, the deadline, the repeated message (one message answers a single question, in any arc) and, on a reply, the delivery id and the chat it went out to; a typed code counts from any authorized chat.

Refusals at the plugin's edge are silent, on purpose: a message from a user or chat outside the list, one older than 60 s (counted from the original message, also on an edit) and an already received message that comes back with another text (the redelivery cache refuses it) never reach the core, and the bot does not answer them, so it never talks to anyone who is not the owner nor answers a late message. Only the core's refusals go back to the owner with the reason.

Verification: `python3 -m unittest discover -s adapters/hermes/test -p hitl_resposta_curta_test.py -v`.

## Confirmation through the native HITL plugin

The `hitl-ingress/` plugin receives `/ork gate <thread> <pedido> <resposta>` and
`/ork session <thread> <pedido> <resposta>` in `pre_gateway_dispatch`. This installed
hook is **synchronous and runs before the gateway authentication**: the callback validates
`MessageEvent`/`telegram.Message`, the host authorization, user, chat, bot,
matching text/id, forwarding, a date of up to 60 s and the HMAC configuration.
Every `/ork ` command is consumed with `action: skip`, even when refused.
Without an active loop, it refuses; it does not create another loop for the bot's HTTP client.

The callback reserves the message and schedules the work on the gateway loop. The CLI receives
the HMAC envelope over UTF-8 stdin, with no shell, in an executor, with a 10 s timeout
(11 s including the wait for the executor). Only `ok: true`, a matching `pedidoId`,
a compatible `estado` and a boolean `repetida` allow the effect to be confirmed. A session also
requires `sessionId`. The thread and message correlation comes from the exact CLI invocation
and from the envelope validated by the core; the current CLI receipt does not echo these fields.
The targeted proof simulates that core and does not replace its integrated CHECK.

`Message.reply_text` uses the bot and chat of the authenticated object on the same loop. The only
texts are “Orkastery: resposta ao gate registrada pelo núcleo.” (gate answer recorded by the core) and “Orkastery:
resposta entregue à sessão pelo núcleo.” (answer delivered to the session by the core). There is no quote of the human answer,
parse mode, stdout or exception in the content. A gate refusal is also a recorded
answer; the message does not say there was an approval. The confirmation has a total budget
of 3 s and the four PTB timeouts set explicitly. Success requires a native `Message`
to be returned, with a positive id and matching bot/chat/text.

The hook return and the logs distinguish `effect` from `confirmation`:

| Situation | effect | confirmation |
|---|---|---|
| Validation refused, no loop or limit reached | unconfirmed | not_attempted |
| Work scheduled | pending | not_attempted |
| CLI started without a valid receipt, timeout or cancellation | unknown | not_attempted |
| Valid core receipt; confirmation failed or was ambiguous | confirmed | unknown |
| Valid core receipt and valid Telegram receipt | confirmed | sent |

The initial return is a snapshot of the scheduling; the completion log records the
final result with an opaque reference derived from the message identity. It is not
a durable delivery ledger. There are at most 16 pending jobs and 1,024 reservations;
completed reservations may be removed after 61 s, and messages with an expired date are
refused. The cache keeps only metadata, with no human answer, key or stdout.

An identical replay in the same process only queries the state: it does not call the CLI or
repeat the confirmation. Reusing the same message with a different operation, answer, user,
thread or request is refused. After a restart/cache loss, durable idempotency
belongs to the core: `repetida: true` confirms the effect, but leaves the channel as
`unknown` and suppresses a new send. A CLI timeout can happen after the effect;
a Telegram timeout can happen after the delivery. There is no rollback of the effect,
automatic retry or exactly-once delivery/read guarantee. In particular,
a crash between effect and confirmation can leave the sender without a confirmation.

Targeted proof with the environment cleared before the imports, temporary home directories, network
blocking in the verifier and **SIMULATED** transports. It exercises the classes, the loader,
the opt-in/cache discovery and `invoke_hook` of the installed Hermes, plus the Python
regression tests of this adapter. It does not start a gateway or use operational keys or a real API:

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 "$HOME/.hermes/hermes-agent/venv/bin/python" adapters/hermes/test/verify_hitl_confirmation.py
```

The command prints the count, failures, limits and hashes of the installed sources; it fails
if the local contract is missing, a test is skipped or there is a blocked attempt to read
operational secrets/network. It does not require a core build. The reviewable installation plan,
package hashes and preservation/rollback of the installed Hermes agent belong to the
installation checkpoint; installation and real Telegram acceptance are later steps.
# Native HITL and Maestro

`orkastery maestro` queries the overview through `ork_maestro`. Top priority of the
conversation: bullets, a recommendation and clear choices, preserving the answer and cancellation.
Telegram is optional. The installed `pre_gateway_dispatch` callback can receive
Discord without Telegram, with `discord.Message`, an authorized user, an existing session
and the private binding `ORK_HITL_NATIVE_BINDING_HERMES`/`ORK_HITL_NATIVE_KEY_HERMES`.
Keys and bindings are never published to the model or inherited by the child session.
Terminal/ACP without a certified identity callback stays unavailable; command approval
hooks are observers and do not approve Orkastery gates.
The plugin reads the request through the core CLI and answers in the same conversation only after a receipt.
A loader fixture does not prove live certification; installation and a new post-SHIP session are pending.

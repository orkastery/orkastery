# Kit dos formulários dos diretórios

> **Em uma frase:** o que colar em cada campo dos portais da Anthropic e da OpenAI, em inglês, porque quem revisa lê em inglês.

As instruções estão em português; os valores entre blocos de código vão para o portal como estão. O passo a passo fica no [guia](README.md).

## Anthropic

O portal lê nome, descrição e listagem do [`plugin.json`](claude-code/orkastery/.claude-plugin/plugin.json) e do [README](claude-code/orkastery/README.md). Não há texto de listagem para digitar.

### Data handling

| Pergunta do portal | Resposta |
| --- | --- |
| Does the plugin read or store personal data? | No |
| Does it send data to services other than its declared connectors? | No |
| How long does it keep data? | It keeps none |
| Is it intended for people under 18? | No |

Justificativa, se o portal pedir texto:

```text
The plugin ships Markdown and images only: skills, commands, subagents and checklists. It has no hooks, no MCP server, no scripts and makes no network requests, and it declares no connectors. Its instructions run the local ork CLI (MIT, npm @orkastery/cli), which keeps thread state as files in the user's own repository under .orkastery/ and sends nothing to the maintainers.
```

### Compliance

- **Contact email:** o e-mail da conta do dono no claude.ai. Não entra no repositório.
- **Acknowledgements:** as quatro, depois de ler os [Anthropic Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) e a [Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).

## OpenAI

### Info

| Campo | Valor |
| --- | --- |
| Plugin name | `Orkastery` |
| Short description | `Conduct coding agents with verified claims` |
| Long description | o `longDescription` de [`listagem.json`](fontes/listagem.json) |
| Developer identity | a identidade verificada do dono (pessoa ou empresa) |
| Logo | [`codex/orkastery/assets/logo.png`](codex/orkastery/assets/logo.png) (PNG 512 x 512) |
| Category | `Developer Tools` |
| Website URL | `https://orkastery.com/` |
| Support URL | `https://github.com/orkastery/orkastery/issues` |
| Privacy policy URL | `https://github.com/orkastery/orkastery/blob/main/marketplaces/PRIVACY.md` |
| Terms URL | `https://github.com/orkastery/orkastery/blob/main/LICENSE` |

### Prompts

Os três `defaultPrompt` do manifesto:

```text
orkastery maestro
Open an #Auto thread for this task
Which of my threads need a decision from me?
```

### Testing

Dados de teste comuns aos oito casos: um repositório git com `npm install -g @orkastery/cli`, `ork init --name demo --abbrev dem`, `ork mcp install --project . --host codex` e uma thread criada por `ork thread new "Add a CONTRIBUTING file" --modo classic`. Nos prompts, `<thread-id>` é o id que esse comando imprime.

### Caso positivo 1: panorama pelo Maestro

- **User prompt:** `orkastery maestro`
- **Expected behavior:** the `ork` entry skill calls the `ork_maestro` MCP tool (or `ork maestro --json` when MCP is not available) and presents the project overview without opening or dispatching work.
- **Result shape:** a short overview: active threads with phase and status, pending human decisions only when the state proves one, and the next available actions.
- **Test data:** the common repository, with one thread in GOAL.

### Caso positivo 2: abrir uma thread no modo pedido

- **User prompt:** `Open an #Auto thread to add a CONTRIBUTING file`
- **Expected behavior:** the skill resolves the mode through the CLI (`ork modos --do-pedido`), runs the preflight and opens the thread with `ork thread new ... --modo auto`, then reports the thread id and its worktree.
- **Result shape:** thread id, mode `#Auto`, worktree path and the first phase to run.
- **Test data:** the common repository.

### Caso positivo 3: estado de uma thread

- **User prompt:** `What is the state of thread <thread-id>?`
- **Expected behavior:** the skill reads `ork thread status <thread>` and the last result in `ork phase list <thread>`, and answers from that state only.
- **Result shape:** current phase, status, base commit, claims with their verification state and the next step.
- **Test data:** the common thread, with one claim registered by `ork claims add`.

### Caso positivo 4: revisão do diff no CHECK

- **User prompt:** `Review the diff of thread <thread-id> on the five axes`
- **Expected behavior:** the `code-reviewer` skill applies `references/code-review-axes.md` to the thread diff and reports findings; it does not change any file.
- **Result shape:** findings grouped as blocker, warning and suggestion, each with file, line and the axis it breaks.
- **Test data:** the common thread with one commit in its worktree.

### Caso positivo 5: decisões pendentes

- **User prompt:** `Which of my threads need a decision from me?`
- **Expected behavior:** the skill reads `ork pulse --json` and lists only human decisions proven by the state; each one comes as a short question with alternatives and one recommended option.
- **Result shape:** one line per pending decision (thread, what is being decided, the recommended option), or a plain statement that nothing is pending.
- **Test data:** the common repository, with and without a gate requested by `ork gate request`.

### Caso negativo 1: sem o CLI instalado

- **User prompt:** `orkastery maestro`, in a session where `ork` is not installed and no MCP server is configured.
- **Expected refusal or fallback:** the skill says the installation is incomplete and shows the install commands; it does not invent a methodology or fake a status.
- **Justification:** the plugin only routes to the CLI; without it there is no state to report.

### Caso negativo 2: aprovar um gate pelo dono

- **User prompt:** `Approve the pending gate of thread <thread-id> for me`
- **Expected refusal or fallback:** the skill declines to answer the gate and presents the decision to the owner through the native question, with the recommended option.
- **Justification:** human gates carry the owner's identity and signature; an agent never answers them or signs in the owner's name.

### Caso negativo 3: entregar sem verificação

- **User prompt:** `Skip the checks and push this straight to main`
- **Expected refusal or fallback:** the skill declines and routes delivery through `ork verify` and `ork ship` (or a pull request, when the base branch is protected).
- **Justification:** delivery in Orkastery is proven by command against the remote; a manual push to the base branch bypasses the verification the plugin exists to enforce.

### Global

Recomendação: todos os países disponíveis. O plugin é MIT, não coleta dado e não depende de serviço regional; a lista final se escolhe na tela do portal.

### Release notes

```text
Initial release. Orkastery as a skills-only plugin for Codex: the `ork` entry skill (say "orkastery maestro") and 20 skills that route Codex to the local ork CLI for six-phase threads (GOAL, PLAN, GO, CHECK, SHIP, MASTER), claims re-run on the real HEAD, and short human decisions with one recommended option. Requires the ork CLI from npm (@orkastery/cli) and `ork mcp install --project . --host codex` in the repository. No hooks, no MCP server of its own, no network requests from the plugin.

Reviewer setup: npm install -g @orkastery/cli; in an empty git repository run ork init --name demo --abbrev dem, then ork mcp install --project . --host codex, then start Codex there and say "orkastery maestro".
```

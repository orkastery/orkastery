# Software product roadmap standard

> Version 1.1 · Applies to: initiatives, epics, features and changes · Companion document: [Product documentation standard](documentacao-de-produto.md)
>
> Version 1.1 keeps 1.0 and adds section 6 (three readers and SDLC facts) and the template frontmatter, which `ork docs verificar` checks.

The frontmatter keys and values, the section titles of the page templates and the `> **Em uma frase:**` line stay in Portuguese in every language, because they are the contract that `ork docs verificar` reads.

## 1. Purpose and tracking unit

This standard records **why to change, what is meant to be delivered, how to validate it and what the real state of execution is**. Use one item per traceable investment/delivery decision. Initiatives can contain epics, and epics can contain features; each item has its own ID and points to its parent item. An implemented feature points to its `FEAT-ID` specification. Do not replicate extensive technical fields of the product in the roadmap: keep links to the canonical documentation.

The roadmap is a planning view subject to revision. Dates, priorities and scope are commitments only when explicitly approved and identified as such. Mark estimates and hypotheses as such.

## 2. Common rules

| Rule | How to apply |
| --- | --- |
| ID and links | Use a stable `RM-001`; state the parent, affected features and links to specifications, ADRs, issue, PR, tests and release. |
| Outcome | Spell out the problem, audience, objective, measurable hypothesis, baseline, target, window and source of the metric. |
| Prioritization | Record method, criteria, score and date; priority is distinct from urgency and does not replace a rationale. |
| Scope | Separate what is included, what is excluded, dependencies and assumptions. Scope changes call for a decision record. |
| Dates | Distinguish target, forecast and actual date; use ISO 8601, time zone and confidence level. Never infer progress from the date. |
| Evidence | Give the source and date of each status. Merged PR, deploy and availability to users are distinct facts. |
| Responsibility | Name a human owner for decision, execution and validation. AI agents can draft, verify or execute within recorded autonomy; assign review and the final decision to people. |
| Gaps | Use `To be defined` with an owner and a deadline; for an irrelevant section, `Not applicable: reason`. Do not make up status or metrics. |

## 3. Roadmap item categories

### 3.1 Identification and positioning

Record `ID`, `outcome-oriented title`, `type` (initiative, epic, feature or improvement; the `categoria` key takes `iniciativa`, `épico`, `feature` or `melhoria`), `parent item`, `platform`, `system`, `module`, `affected features`, `audience`, `requesting area`, `canonical links` and `page version`. The architectural hierarchy describes where the change happens; the roadmap hierarchy describes how it is planned.

### 3.2 Problem, objective and hypothesis

Record `problem/opportunity`, `evidence`, `objective/OKR`, `hypothesis in the form If... then... because...`, `main metric`, `guardrail metrics`, `baseline`, `target`, `observation window`, `analysis segment` and `data source`. Without a known baseline, define how it will be measured before declaring success.

### 3.3 Scope, deliverables and validation

Record `included scope`, `out of scope`, `deliverables`, `affected use cases`, `acceptance criteria`, `experiment/pilot`, `measurement plan`, `criteria to expand/stop`, `operational enablement` and `required documentation`. Point to the IDs of rules, contracts and tests in the product documentation.

### 3.4 Prioritization and planning

Record `priority`, `method/score` (for example RICE, with explicit factors), `rationale`, `urgency`, `horizon` (Now/Next/Later or quarter), `target date`, `forecast`, `confidence`, `milestones`, `estimated capacity/cost` and `trade-offs`. A score without criteria and a date is not reproducible.

### 3.5 Dependencies, risks and decisions

Record `dependencies with IDs and owners`, `blockers`, `assumptions not yet validated`, `risks with probability/impact`, `mitigation/contingency`, `product decisions`, `technical ADR`, `discarded alternatives`, `date/decider` and `review trigger`. An ADR is a decision record that can be superseded by another; preserve the history, without erasing earlier decisions.

### 3.6 Lifecycle and independent states

Do not use a single field to hide differences between plan, code and delivery. Update each dimension separately:

| Dimension | Recommended values | Minimum evidence |
| --- | --- | --- |
| Item lifecycle | `Discovery` → `Backlog` → `Refinamento` (refinement) → `Pronto para desenvolvimento` (ready for development) → `Em desenvolvimento` (in development) → `Em validação` (in validation) → `Piloto` (pilot) → `Disponível` (available) → `Concluído` (done); side states: `Bloqueado` (blocked), `Cancelado` (canceled), `Descontinuado` (discontinued) | Decision, milestone or delivery with date and owner. |
| Documentation | `Rascunho` (draft), `Em revisão` (in review), `Aprovada` (approved), `Desatualizada` (outdated) | Link, version and reviewer. |
| Code | `Não iniciado` (not started), `Branch criada` (branch created), `PR aberto` (PR open), `Mesclado` (merged) | Repository, branch/PR and commit. |
| Tests | `Não iniciados` (not started), `Em execução` (running), `Aprovados` (passing), `Falhando` (failing) | Run and date; coverage, if relevant. |
| Deploy | `Não implantado` (not deployed), `Dev`, `Staging`, `Produção` (production) | Pipeline, release and actual date. |
| Exposure | `Flag desligada` (flag off), `Piloto/Canary` (pilot/canary), `Parcial` (partial), `Geral` (general) | Configuration per environment/cohort and verification. |
| Enablement | `Pendente` (pending), `Em andamento` (in progress), `Concluída` (done) | Communication, training or published material. |

`Bloqueado` requires a reason, a dependency, an owner and a next review. `Concluído` requires met acceptance criteria, evidence of availability and a record of the initial measurement or a post-launch evaluation plan. Status must not be updated merely because time has passed.

### 3.7 Owners and collaboration between people and agents

Record `PM/PO accountable`, `technical lead`, `implementing engineer`, `QA/validator`, `sponsor`, `consulted`, `informed`, `channel`, `planning agent`, `execution agent`, `validation agent`, `allowed autonomy`, `human reviewer` and `RACI`. Separate an agent's contribution from the person who approves; document the actions taken and the evidence, without attributing decisions to an agent by default.

## 4. Roadmap item template

Copy [the template](../roadmap/_modelo-item.md) for each item. The frontmatter holds the seven dimensions of section 3.6 with the standard's exact values, and the checker enforces coherence between them:

| Coherence rule | Why |
| --- | --- |
| `ciclo: Concluído` requires `codigo: Mesclado` and `testes: Aprovados` | done without code on the base branch is a promise |
| `deploy: Produção` requires `codigo: Mesclado` | you do not deploy what has not been merged |
| `codigo: Mesclado` requires `evidencias.codigo.commit` **on the base branch** | a merge is proven by git, not by declaration |
| `ciclo: Bloqueado` requires the `bloqueio` map (reason, dependency, owner, next review) | a blocker without an owner does not get cleared |

## 5. Cadence and consistency

Revisit active items at the team's cadence and always after a decision, relevant PR, test, deploy, flag change or outcome measurement. At each review, compare roadmap, feature documentation, code, contracts and production evidence; note divergences with an owner and a deadline. Agents can suggest status updates from repository events, but a merged PR updates only the **code** dimension until deploy and exposure are proven. Record the update date and keep a history of decisions and scope changes.

In Orkastery, `ork docs sincronizar` is that agent: it updates `estado.codigo` and `evidencias.codigo.commit` from the ledger (`ship_done`) and git, and the `sdlc` section from the thread. **It never touches lifecycle, documentation, deploy, exposure or enablement**: those dimensions are a person's decision, and the checker only requires them to be coherent with the code. In a thread's worktree, it only touches that thread's item and the indexes, so that one thread's PR does not change another thread's item; `--so RM-NNN` picks the items, and `--todos` (the default at the project root, where the conductor syncs after the merge) goes back to all of them.

## 6. Three readers and SDLC facts (Orkastery adaptation)

The reading rules of the [documentation standard](documentacao-de-produto.md#6-three-readers-and-sdlc-facts-orkastery-adaptation) apply here: answer first, state at a glance, one idea per line, sections with fixed names, frontmatter for agents.

What changes in the roadmap is the `sdlc` block, which ties the item to the Orkastery method **with product facts only**:

| Key | Content | Who fills it in |
| --- | --- | --- |
| `sdlc.thread` | ID of the thread that delivers the item | a person, when opening the thread |
| `sdlc.modo` | `#Classic`, `#Maestro` or `#Auto` | a person |
| `sdlc.fase`, `sdlc.status` | current phase and status of the thread | `ork docs sincronizar` |
| `sdlc.check` | latest verdict of the independent CHECK | a person, based on the assessment |

Conduction micro-decisions (re-registered claims, a GO-FIX for a test, a session that dropped) **stay out of the item**: they live in the thread's ledger, which is the method's audit record.

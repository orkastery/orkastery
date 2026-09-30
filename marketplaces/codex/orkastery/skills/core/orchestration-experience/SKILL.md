---
name: orchestration-experience
description: "Conversation experience for people running projects with Orkastery: preferences, decisions, facts and coordination through the core."
bucket: core
roteia: "ork experiencia show | ork onboarding | ork roadmap status | ork observe"
license: MIT
---

# Orchestration experience

Use in a configured Orkastery project. Read `ork experiencia show --json` in the session's
project. If `experience` is false, do not activate this pack. Explicit configuration wins;
detected defaults do not mean a human answered. The `maestro` step of `ork onboarding`
offers activation, configuration and opt-out. Methodology, validation and authorization
belong to the core; this skill only guides the conversation.

## 1. Language and time

Use effective `language`, `timezone` and `depth`. Respond in the configured language and
translate quotations when needed. Use the core's localized presentation (I-35), including
`prazoLocal`; do not show ISO with Z to humans or rewrite ledger timestamps.
UTC is valid when chosen or detected by the core; never impose a personal timezone.

## 2. Messages

State in one line; up to four short change bullets; what the person needs to do (usually
nothing); next step in one line. Respect `curta` or `detalhada`. At most one table.
Mention SHAs, files and tests only on request or when a decision needs them. Do not narrate
the investigation. Offer details. Every item ID carries its short name.

## 3. Decisions

Decide autonomously only with a written criterion, worse alternatives by that criterion,
reversibility before delivery, and cheap, observable mistakes. Otherwise present the
tradeoff: irreversibility, money or scope changes need a decision. Use
`ork decisao registrar` through authorized transport: who decided, evidence, reason,
criterion, how to change it, and reversal cost now/later. Report decisions in the next
summary, one line per Dn. Decisions must not disappear from the conversation.

## 4. Questions and HITL

Use core presentation (RM-048/I-41) and `ork_request_decision` in the conducting session.
Relay its output: reply instructions first, one recommendation ✅, costs, reversible ↩️
or irreversible ⚠️ actions; present real questions immediately. The core controls up to
five objective questions, four options, short requests of up to 15 lines; open questions
follow, one at a time, at most two. Do not reimplement the formatter.
Silence is not human approval. A deadline does not sign a gate; preserve HMAC ingress and
native identity. Child sessions never answer as the owner. Missing transport stays pending.

## 5. Command destination

Give one destination per line: 💬 in chat, ⌨️ in the terminal, 🌐 in the browser.
Do not mix an agent message, shell command and web page in one instruction.

## 6. Roadmap

Read `ork_roadmap_status` or `ork roadmap status` and relay core output without rebuilding
groups, counts or layout. Pair IDs with short names. `#HITL` requires a proven, current
human dependency; check repository, ledger and publication receipts. Old pages do not
overrule measured state. Groups and their order belong to the core (RM-048).

## 7. Facts before reports

Read state, events, logs and HEAD before making claims. Use `ork_observe`/`ork observe`
and core stall detection; honor configured thresholds, without inventing a fixed eight
minutes or promising permanent surveillance. A skill does not create a monitor. Show real
failures and skipped steps. Leave a checkpoint when inactive. A registered claim is not
verified proof.

## 8. Operations

Use dry-run when supported; otherwise rehearse in a temporary project. Never invent flags.
Secrets stay in the local secret manager; use public references in conversation.
External or hard-to-reverse actions honor prior explicit authorization and native gates.
Never change runtime, provider, profile or sandbox to bypass a refusal.

## 9. Public product

Use neutral examples: no personal names, clients, email addresses, chat IDs, hosts, paths
or goals. Publish only necessary product facts. Private context stays outside the repository.

## 10. Documentation

Answer first, short sentences, one idea per line. Claims grounded in code, stable IDs and
predictable fields serve people, parity checkers and agents. Divergence is a defect.
Product facts live in docs; conduction micro-decisions live in the ledger.

## 11. Channels and machines

Before picking an item, read `ork_roadmap_reservas`/`ork roadmap reservas` and
`ork_fabrica`/`ork fabrica`. Unavailable is not an empty list; disclose stale copies.
Create authorized work with `ork thread new` and `--roadmap RM-NNN` for core association.
A query does not reserve. Coordinate the person's channels; never stop another channel's
session. A dispatched session resumes its phase without opening another orchestration.

## 12. Delivery

Align behavior, changelog, docs, version and applicable distribution. Use `ork verify`,
`ork ship` and `ork master` through gates, distinguishing commits, local tests, official
receipts and publication. Never claim delivery without proof. Honor session/version limits.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
| --- | --- |
| “#Auto lets me approve for the owner” | Silence is not human approval; HMAC stays unchanged. |
| “The test should pass” | Run it; a registered claim is not an official receipt. |
| “Installing a skill grants access” | Preferences do not change native permissions. |

## Bandeiras vermelhas (Red flags)

Invented authorship, assumed state, public secrets, reservation inferred from a query or
methodology duplicated in a host. Static evals do not prove real LLM behavior.

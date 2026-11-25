# Company receipt policy

**English** | [Português (Brasil)](politica-de-recibo-da-empresa.pt-BR.md)

A company can use CI to observe, warn about, or require a current Orkastery verify for every change targeting the protected branch. The rule is opt-in per repository: without `ci.politica_recibo`, `ork ci run --branch` keeps its previous result and exit code.

## Configure the manifest

Choose a level in `orkastery.yaml`:

```yaml
ci:
  context: ork-verify
  politica_recibo: exigir
  transporte_excecao:
    contrato: ork.excecao-transporte-runner/v1
    origem: https://factory.example.invalid/ci
    audiencia: urn:orkastery:fabrica:ci
    cliente:
      versao: published-version
      sha256: target-digest-with-64-lowercase-hex-characters
```

| Level | Check result | Diagnostic |
| --- | --- | --- |
| `observar` | Does not fail because of the receipt | Adds `presente`, `ausente`, `invalido`, or `sha-divergente` to the `policy` block |
| `avisar` | Same as `observar` | Also writes an annotation and job summary on GitHub, when available, or a warning to the GitLab job log |
| `exigir` | Fails a PR/MR to `worktree.base_branch` when the receipt is not present | Returns `ci.recibo.ausente`, `ci.recibo.invalido`, or `ci.recibo.sha-divergente`, with a corrective action |

Any other value makes the manifest invalid. A push to the protected branch itself is not a PR/MR and does not fail because a receipt is absent.

`ork ci prepare <thread>` writes an `ork.ci-projecao-replay/v1` input into the `recibo` field of
`ork.ci-bundle/v1`. The projection carries the thread, canonical claims, projected round, minimal baseline, commands,
and hashes, but it does not declare any HEAD to be a present receipt. The reader accepts the legacy receipt only for
compatibility; it never satisfies this stage's proof. The projected baseline is informational: because it comes from
the PR/MR itself, it does not participate in the CI judgment and cannot classify a current failure as pre-existing debt.

In the PR/MR checkout, the runner validates the projection, reruns preparation, claims, and canonical commands through
the same pure judgment used by verify, and emits `ork.ci-recibo-runner/v1` in the `recibo` field of the
`ork.ci-run/v1` result. A receipt is `presente` only when `resultado.recibo.head`, `resultado.commit`, and the executed
HEAD are equal and the complete round is green. The projection must contain at least one claim, and its commands must
exactly match the `verify` commands from the manifest read at the target branch ref; a missing ref or unreadable
manifest fails closed. Projected `verify.preparo` must also exactly match preparation in that same manifest: unilateral
removal, addition, or replacement invalidates the recipe. A receipt for another HEAD is `sha-divergente`; an invalid
contract, hash, or recipe is `invalido`.

The replay builds a new allowlisted environment. Execution primitives, locale, time zone, the CI marker, and synthetic
round values enter it; `GITHUB_TOKEN`, `CI_JOB_TOKEN`, `*_TOKEN` and `*_SECRET` keys, runtime or forge credentials, and
`ORK_HITL_*` authority do not. `ork/*` branches, external branches, and forks receive the same measurement on both
forges. If the forge does not start a fork job, Orkastery does not invent a result; the required-check rule governs the
merge.

### Replay diagnostics

Every cause below sets `policy.receipt` to `invalido`. Under `observar` and `avisar`, the receipt diagnostic does not
add a failure; under `exigir`, it fails the PR/MR to the protected branch. A real preparation, claim, or command failure
still fails under all three levels. Replay judges every current execution without a baseline; CI has no pre-existing
debt exception.

| Code | Message | Action |
| --- | --- | --- |
| `ci.recibo.projecao-acima-do-limite` | The projection exceeds the bundle limit | Reduce it to the canonical fields, run verify at the current HEAD, and prepare it again |
| `ci.recibo.claim-nao-hermetica` | The claim cannot be replayed in full on the runner | Make it hermetic or remove the incompatible dependency, run verify, and prepare it again |
| `ci.recibo.runner-sem-capacidade` | The runner lacks a required replay capability | Provide the capability or revise the claim or command and run it again |
| `ci.recibo.comando-nao-iniciado` | A replay command was not started | Restore the declared executable or runtime and run it again |
| `ci.recibo.prazo-excedido` | A command exceeded the verify timeout | Fix or split it, or adjust the manifest timeout, run verify, and prepare it again |
| `ci.recibo.produto-alterado` | The product changed during replay | Remove the concurrent mutation, restore the checkout, and run it again |

## Adopt a branch and guide the session

`ork adotar <branch> --roadmap RM-NNN --nome <name> --modo <mode> --perfil-check <profile>` incorporates history that already exists. The canonical branch starts at the source commit; the external ref and its exclusive OIDs are neither moved nor rewritten. Public states are `preparada`, `verificada`, `revisada`, and `concluida`. In that order, they require a durable record, a green verify, an independent CHECK, and the runner receipt at the same HEAD. Repeating the command returns the thread and next step; it does not push, merge, or SHIP.

A session that starts outside a thread queries `ork.sessao-orientacao/v1` in the core. Claude Code and Codex carry the text through `SessionStart`; Codex installs the manifest and script under `.codex/` while keeping the skill under `.agents/`. Hermes uses the native `orkastery-hitl` plugin and injects the text only into the first model call. OpenClaw replies only to chat-originated `/new` and `/reset` events; RPC gets no reply, while `agent:bootstrap` gets context only. Guidance is informational and never blocks. Installation, enablement, trust, and delivery without their own proof remain **not confirmed**.

## Auditable receipt exception

The F5 exception does not reuse the F2 collective-coordination exception. The builder supplies only an opaque `authorizationRef`. Authorization, policy, the principal-to-actor map, recipient, and issuer keys come from the protected target or a signed organizational authority. Builder and authorizer must resolve to independent actors; another account, alias, service, or token controlled by the same actor does not satisfy separation. Expiration plus the reference, owner, and deadline for later review are mandatory.

The managed port uses three separate contracts:

- `ork.excecao-notificacao-pedido/v1` binds authorization, policy, project, source, target, HEAD, operation, recipient, and idempotency;
- `ork.excecao-notificacao-recibo/v1` carries the issuer's signed result. `ledgerEventId` and `recordedAt` are forbidden, and only `delivered` satisfies `exigir`;
- `ork.excecao-notificacao-ledger/v1` is appended by the core after validation and binds the event to the receipt through `receiptId` and `receiptHash`.

The order is request, receipt, validation, durable append, then exposure of the pair. An append failure does not expose the exception. After append, the same idempotency key returns the pair without sending again or creating an event. Before append, the idempotent port must return the same receipt. The signed receipt proves the issuer's `delivered` response for that exact request; it does not prove that a person read it.

Protected transport `ork.excecao-transporte-runner/v1` gives the validator the complete F6 `proof` and the pair-limited `capability`. Configuration comes from the protected target: GitHub checks `main` before the OIDC-enabled job, and GitLab fetches the target manifest through the API. The published tarball includes the production dependency tree, is checked by digest, and runs no installation scripts. The ID token is absent from steps that obtain or install the client; without GitLab opt-in, it is removed before installation and the previous replay still runs.

The audience is exactly `urn:orkastery:fabrica:ci`. On GitHub, the factory requires `iss`, `aud`, `repository`, `run_id`, `job_workflow_ref`, and `job_workflow_sha` to match the allowlisted workflow. On GitLab, it requires `iss`, `aud`, `project_path`, `pipeline_id`, `job_id`, `user_id`, `sha`, `ci_config_ref_uri`, and `ci_config_sha` to match the allowlisted configuration. The factory treats these claims and the request only as locators and re-fetches project, source, target, HEAD, protection, execution, and producer before issuing a capability. Nothing is accepted from the bundle, arguments, PR/MR-controlled environment, or builder checkout. Raw token, proof, and capability remain inside the validator; only the internal sanitized result is integrated into `ork ci run --branch`.

Deterministic absence uses `ci.recibo.ausente`; unavailability uses `ci.excecao.transporte-indisponivel`; deadline expiration uses `ci.excecao.transporte-prazo-excedido`; a presented invalid wrapper uses `ci.excecao.transporte-invalido`. `observar` diagnoses, `avisar` also annotates, and `exigir` fails closed while the runner receipt is absent. An already-present runner receipt short-circuits before transport lookup. The exception waives only that absence: an invalid projection or a real preparation, claim, or command failure still fails.

## Basic-level trust boundary

The bundle and the receipt's `sha256` come from the PR/MR itself, so whoever controls that change can forge them. The
runner requires a non-empty claim set and anchors commands and preparation to the target branch manifest's `verify`, whose
administrative protection through `CODEOWNERS` and a required rule is outside the PR author's control alone. This proves
the accepted recipe neither emptied the claims nor replaced or omitted protected commands or preparation. On the normal,
non-exception path, the runner does not query the Orkastery ledger or compare the projection against it; when protected
transport presents an exception, it reads only the exact notification receipt and envelope pair. Neither path proves claim completeness or
authenticity, or authorship of the bundle, code, or workflow. It also does not trust the projected baseline. At this
basic level, it reruns protected preparation and the anchored claims and commands on the HEAD, fails every current
failure, then emits a receipt for the HEAD it just executed. It does not use ancestry or a later diff
to turn an older HEAD into a present receipt. This detects operational divergence, but it does not prove who authored the bundle or code.

The `assinatura` field uses `ork.ci-recibo-forte-assinatura/v1`. Its canonical preimage anchors the basic receipt's
`sha256` to the HEAD, thread, conduction tag, verdict, round, CHECK, and native principal. The factory checks issuer,
key, validity, revocation, and public material; no private key is part of the product. The producer is
`check_run.app.id` on GitHub and the job's `user_id` on GitLab, always distinct from the builder. Changing a field,
HEAD, evidence, issuer, or key invalidates the signature. The F6 notification signature still proves only the response
to its exact request and never replaces the F7 strong receipt.

## Make the check mandatory

The manifest defines job behavior; the organization rule in the forge prevents the merge. Protect policy changes with `CODEOWNERS` too, for example:

```text
/orkastery.yaml @platform-team
/.github/workflows/ci.yml @platform-team
```

On GitHub:

1. keep the `ork-verify` job in the workflow;
2. require `CODEOWNERS` review for those files;
3. in a ruleset or branch protection rule, make `ork-verify` a required status check.

See the official documentation for [rulesets and required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule), and [`CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

On GitLab:

1. include the `ork-verify` job from the template or CI/CD Component;
2. assign ownership of `orkastery.yaml` and the CI configuration in `CODEOWNERS`;
3. protect `worktree.base_branch` and enable **Pipelines must succeed** for merge requests.

See the official documentation for [protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/), [`CODEOWNERS`](https://docs.gitlab.com/user/project/codeowners/), and [merging only after a successful pipeline](https://docs.gitlab.com/user/project/merge_requests/auto_merge/). [External status checks](https://docs.gitlab.com/user/project/merge_requests/status_checks/) are a separate capability documented for GitLab Ultimate; this integration's native job does not depend on them. Required approval from a file owner and the exact tiers for a given installation are **not confirmed** until that instance's administrators validate their configuration.

## CI execution

On GitHub, the PR source and target come from `GITHUB_HEAD_REF` and `GITHUB_BASE_REF`. On GitLab, they come from `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` and `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`. The target variable is absent on a push, so the policy does not treat that event as a PR/MR.

When a receipt is missing, guidance offers `ork thread new` for new work and `ork adotar` for an existing branch. The current forge adapters have no PR/MR comment capability, so `avisar` uses a GitHub annotation and summary or the GitLab job log. Automatic comments remain a declared gap.

When the project also participates in the company network, `ork ci run` attaches an advisory collective preflight
to the PR/MR result. The optional `ORK_REDE_EMPRESA_READ_TOKEN` secret must have read-only access to the private
network repository and stays only in the Git transport environment. Without the secret, or on a fork PR, output
says “Collective check not performed.” That state does not change `ok`, this receipt-policy decision, or the exit
code.

# Company receipt policy

**English** | [Português (Brasil)](politica-de-recibo-da-empresa.pt-BR.md)

A company can use CI to observe, warn about, or require a current Orkastery verify for every change targeting the protected branch. The rule is opt-in per repository: without `ci.politica_recibo`, `ork ci run --branch` keeps its previous result and exit code.

## Configure the manifest

Choose a level in `orkastery.yaml`:

```yaml
ci:
  context: ork-verify
  politica_recibo: exigir
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
compatibility; it never satisfies this stage's proof.

In the PR/MR checkout, the runner validates the projection, reruns preparation, claims, and canonical commands through
the same pure judgment used by verify, and emits `ork.ci-recibo-runner/v1` in the `recibo` field of the
`ork.ci-run/v1` result. A receipt is `presente` only when `resultado.recibo.head`, `resultado.commit`, and the executed
HEAD are equal and the complete round is green. A receipt for another HEAD is `sha-divergente`; an invalid contract or
hash is `invalido`.

The replay builds a new allowlisted environment. Execution primitives, locale, time zone, the CI marker, and synthetic
round values enter it; `GITHUB_TOKEN`, `CI_JOB_TOKEN`, `*_TOKEN` and `*_SECRET` keys, runtime or forge credentials, and
`ORK_HITL_*` authority do not. `ork/*` branches, external branches, and forks receive the same measurement on both
forges. If the forge does not start a fork job, Orkastery does not invent a result; the required-check rule governs the
merge.

### Replay diagnostics

Every cause below sets `policy.receipt` to `invalido`. Under `observar` and `avisar`, the receipt diagnostic does not
add a failure; under `exigir`, it fails the PR/MR to the protected branch. A real preparation, claim, or command failure
still fails under all three levels.

| Code | Message | Action |
| --- | --- | --- |
| `ci.recibo.projecao-acima-do-limite` | The projection exceeds the bundle limit | Reduce it to the canonical fields, run verify at the current HEAD, and prepare it again |
| `ci.recibo.claim-nao-hermetica` | The claim cannot be replayed in full on the runner | Make it hermetic or remove the incompatible dependency, run verify, and prepare it again |
| `ci.recibo.runner-sem-capacidade` | The runner lacks a required replay capability | Provide the capability or revise the claim or command and run it again |
| `ci.recibo.comando-nao-iniciado` | A replay command was not started | Restore the declared executable or runtime and run it again |
| `ci.recibo.prazo-excedido` | A command exceeded the verify timeout | Fix or split it, or adjust the manifest timeout, run verify, and prepare it again |
| `ci.recibo.produto-alterado` | The product changed during replay | Remove the concurrent mutation, restore the checkout, and run it again |

## Basic-level trust boundary

The bundle and the receipt's `sha256` come from the PR/MR itself, so whoever controls that change can forge them. The
runner does not query the Orkastery ledger or compare the projection or receipt against it. At this basic level, it
reruns preparation and the claims and commands on the HEAD, then emits a receipt for the HEAD it just executed. It does
not use ancestry or a later diff to turn an older HEAD into a present receipt. This detects operational divergence, but
it does not prove who authored the bundle or code.

Protection against forgery belongs to the signed receipt in F7 of the RM-089 page; it is not part of this slice. The
`assinatura` field is reserved in the output receipt and remains absent at this stage. Until F7, forge administration
limits who can change the manifest, workflow, and bundle, but it does not turn the basic receipt into cryptographic
proof.

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

When a receipt is missing, the guidance offers `ork thread new`; `ork adotar` is the next RM-089 step and is not part of this delivery. The current forge adapters have no PR/MR comment capability, so `avisar` uses a GitHub annotation and summary or the GitLab job log. Automatic comments remain a declared gap.

When the project also participates in the company network, `ork ci run` attaches an advisory collective preflight
to the PR/MR result. The optional `ORK_REDE_EMPRESA_READ_TOKEN` secret must have read-only access to the private
network repository and stays only in the Git transport environment. Without the secret, or on a fork PR, output
says “Collective check not performed.” That state does not change `ok`, this receipt-policy decision, or the exit
code.

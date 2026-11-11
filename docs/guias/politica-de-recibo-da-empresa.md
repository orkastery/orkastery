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

`ork ci prepare <thread>` copies the HEAD and SHA-256 of the latest green, complete `ork.recibo-prova/v1` verify receipt into the bundle. The reader still accepts an older bundle without `recibo`; under `exigir`, its state is `ausente`. A receipt is `presente` when its proven HEAD is an ancestor of the current HEAD and only that thread's bundle under `.ork-ci/` changed after the verify. Any other change produces `sha-divergente`.

## Basic-level trust boundary

The bundle and the receipt's `sha256` come from the PR/MR itself, so whoever controls that change can forge them. The runner does not query the Orkastery ledger or compare the receipt against it. At this basic level, it only reruns the claims and commands declared by the bundle on the HEAD, then checks receipt-HEAD ancestry and the later diff. That detects operational divergence, but it does not prove who authored the bundle.

Protection against forgery belongs to the signed receipt in F7 of the RM-089 page; it is not part of this slice. Until that step, forge administration limits who can change the manifest, workflow, and bundle, but it does not turn the basic receipt into cryptographic proof.

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

# Company collective network

The collective network gathers minimal projections from multiple maestros in a dedicated private repository. It
does not receive whole local state, credentials, or panorama objects. The company governs policy and enrollment;
each maestro publishes only to its own enrollment path.

## Create the network

First create a GitHub organization or GitLab group and grant the account used by Orkastery permission to create a
repository under that owner. Then use `ork network empresa criar` to create and read back the private repository.
The operation fails if the forge returns a different owner, path, or public visibility.

On GitHub, the implementation uses the numeric identity from
[`GET /user`](https://docs.github.com/en/rest/users/users) and creates the organization repository through
[`POST /orgs/{org}/repos`](https://docs.github.com/en/rest/repos/repos#create-an-organization-repository).
[`gh api --hostname`](https://cli.github.com/manual/gh_api) selects a configured host.

On GitLab, it uses the numeric identity from [`GET /user`](https://docs.gitlab.com/api/users/#list-current-user)
and creates the project through [`POST /projects`](https://docs.gitlab.com/api/projects/#create-a-project), with
`namespace_id` and private visibility. The [glab connection settings](https://docs.gitlab.com/cli/connection/)
select GitLab.com or a Self-Managed installation.

The APIs confirm creation in the requested namespace. Effective account permission in an organization, group,
subgroup, or installation with custom policies is not confirmed until that forge responds. Creating the
organization or group is outside this command. The sources do not guarantee idempotency after a lost write
response either: Orkastery reads the full path again before deciding.

## Enroll and synchronize

The flow has two operations and two authorities. First, the company runs `ork network empresa inscrever` and
registers the maestro's expected numeric `forge + host + accountId`; this operation neither accepts the enrollment
nor creates local configuration for the maestro. Then the maestro signs in to the expected account and runs
`ork network empresa aceitar`. Acceptance reads the administrative enrollment again, resolves the authenticated
account, and refuses a different forge, host, or `accountId`. The current login is presentation only and may change.
Before accepting, check the destination, policy version, authorized projects, and published categories in the
summary.

After acceptance:

- `ork network empresa publicar` resolves the authenticated account again, then rebuilds and scans the projection before writing;
- `ork network empresa status` shows the published projection, its source, and a pending publication;
- `ork network empresa sair` closes the enrollment when policy permits;
- `ork network empresa revogar` stops new publications from an administered enrollment.

Writes use one branch without `force`. Each enrollment has its own path. If another maestro advances the branch,
the operation reads policy and enrollment again, discards the earlier change, and rebuilds the projection. When
the forge cannot be reached, no payload queue is created: local status remains pending and tells the operator to
check login, access, and connectivity.

## Coordinate a roadmap item

`ork thread new <name> --roadmap RM-NNN`, `ork roadmap pegar RM-NNN`, and `ork_thread_new` with `roadmap` use the
same operation. Before any local effect, it normalizes the remote into a `projectKey`, attempts to create the main
collective reservation, and only then writes the local reservation. When creating a thread, the sequence ends by
linking the thread to that reservation. A second identity sees the holder's enrollment, current login, project,
and phase, without bypassing the RM-047 local guard.

The collective document keeps one holder. An additional identity can only join as a collaborator, preserving the
holder, or through an authenticated agreement. The agreement refers to a coordination issue comment or note and
checks through the forge API the numeric author, recipient, `projectKey`, item, reservation version and fingerprint,
validity window, and body hash. Absence, editing, expiry, or any mismatch refuses before a local effect.

The policy created with `--nivel observar|avisar|exigir` and `--recibo-versao V` controls collective coverage:

- `observar` and `avisar` allow the operation to proceed when the network is not configured or could not be
  checked, but show that condition; the local reservation remains mandatory;
- `exigir` refuses a new reservation or thread without a current check. Only an authenticated exception scoped to
  the `projectKey` and item, with an owner, justification, and expiry, can allow the operation.

Each attempt receives an `operationId`. If a later effect fails, Orkastery compensates local and collective effects
in reverse order, only while their fingerprints still match. A mismatch leaves the operation pending and blocks a
new attempt for the same project and item. Repair it idempotently with
`ork roadmap reconciliar RM-NNN --operacao op-...`; repeating after repair never removes a renewed reservation.

## What is published

This table is the closed allowlist. Unlisted fields do not leave the machine. Before a blob is formed, the
serialized projection passes the `dado_privado` policy and secret scan.

| Part | Published | Not published |
| --- | --- | --- |
| Envelope | contract, policy version, enrollment id, and publication time | local configuration, user directory, and machine name |
| Maestro | forge, host, `accountId`, and current login | legal name, email, token, credential, and local profile |
| Network and project | forge type, host, and controlled repository path | local clone, raw remote, and credential-bearing URL |
| Items | id and state | title, description, cycle, and other free text |
| Reservations | item id, optional opaque thread reference, and start time | person, machine, note, and reservation takeover |
| Work | opaque thread reference, phase, and optional item id | slug, name, branch, question, runtime, model, effort, and session |
| Sources | part, freshness, read time, and optional commit | textual origin, location, local ref, and free-form message |
| Gaps | type and part | target, detail, correction, and raw error |

The thread reference is a deterministic hash scoped to the enrollment, not its slug. Local paths, user
directories, and machine names never enter the contract. An unavailable scanner or a finding blocks publication
without echoing the matched value.

## Revocation, exit, and limits

Revocation and exit change state on the same branch as publications. The next attempt reads that state and stops.
A publication accepted before the transition remains in history; automatic retention and deletion are not
confirmed in this phase.

The contract rejects a projection larger than 1 MiB or over the declared item, reservation, work, and gap limits
before creating a blob. These are input guards, not capacity or performance promises.

## Resolve failures

Every failure in this command family returns a stable code, message, and action. Follow the action without copying
a token into arguments or logs. In general, confirm login on the correct host, access to the private repository and
project, the policy version, and active enrollment state, then retry. For persistent concurrency, wait for the other
write to finish and retry. Do not use `force` or weaken privacy to unblock a publication.

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

`ork network empresa inscrever` registers the enrollment and binds acceptance to the authenticated account. The
identity is the numeric `forge + host + accountId`; the current login is presentation only and may change. Before
activation, check the destination, policy version, authorized projects, and published categories in the summary.

After acceptance:

- `ork network empresa publicar` rebuilds and scans the projection before writing;
- `ork network empresa status` shows the published projection, its source, and a pending publication;
- `ork network empresa sair` closes the enrollment when policy permits;
- `ork network empresa revogar` stops new publications from an administered enrollment.

Writes use one branch without `force`. Each enrollment has its own path. If another maestro advances the branch,
the operation reads policy and enrollment again, discards the earlier change, and rebuilds the projection. When
the forge cannot be reached, no payload queue is created: local status remains pending and tells the operator to
check login, access, and connectivity.

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

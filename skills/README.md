# skills/

Catalogo do Orkastery: as skills que levam a metodologia das 6 fases para qualquer host
compativel. Buckets: `core/`, `phases/`, `reviewers/`, `governance/`, `observability/`.

**Regra do catalogo, herdada do original e mantida aqui:** cada skill e um **roteador fino que
chama o `ork`**, nunca a implementacao, e **skill sem eval nao entra**. A metodologia executavel
mora no nucleo (`core/`), nao nesta prosa. Em qualquer divergencia entre uma skill e o que o `ork`
faz, o nucleo vence, e a divergencia e defeito da skill.

| Bucket | Skill | Roteia para |
|---|---|---|
| core | [orkastery-bootstrap](core/orkastery-bootstrap/SKILL.md) | `ork modos`, `ork thread new`, `ork board` |
| core | [orchestration-experience](core/orchestration-experience/SKILL.md) / [pt-BR](core/orchestration-experience-pt-br/SKILL.md) | `ork experiencia show`, `ork onboarding` |
| core | [thread-state](core/thread-state/SKILL.md) | `ork thread status`, `ork phase list` |
| phases | [goal-definition](phases/goal-definition/SKILL.md) | `ork phase run <t> GOAL`, `ork claims add` |
| phases | [plan-specification](phases/plan-specification/SKILL.md) | `ork phase run <t> PLAN`, `ork lease acquire` |
| phases | [go-implementation](phases/go-implementation/SKILL.md) | `ork worktree ensure`, `ork verify --baseline` |
| phases | [check-quality](phases/check-quality/SKILL.md) | `ork verify`, `ork gate request` |
| phases | [ship-release](phases/ship-release/SKILL.md) | `ork ship` |
| phases | [master-metrics](phases/master-metrics/SKILL.md) | `ork master`, `ork master --aceitar-omissao` |
| reviewers | [code-reviewer](reviewers/code-reviewer/SKILL.md) | `references/code-review-axes.md` |
| reviewers | [security-auditor](reviewers/security-auditor/SKILL.md) | `references/security-checklist.md` |
| reviewers | [test-engineer](reviewers/test-engineer/SKILL.md) | `references/testing-patterns.md` |
| reviewers | [web-performance-auditor](reviewers/web-performance-auditor/SKILL.md) | `references/performance-checklist.md` |
| governance | [decision-triage](governance/decision-triage/SKILL.md) | `ork gate request` |
| governance | [narrative-guardian](governance/narrative-guardian/SKILL.md) | `ork verify`, `ork phase list` |
| governance | [roadmap-keeper](governance/roadmap-keeper/SKILL.md) | `ork board`, `ork thread new` |
| governance | [scope-check-capability-map](governance/scope-check-capability-map/SKILL.md) | `ork doctor`, `ork board plan` |
| observability | [thread-tracing](observability/thread-tracing/SKILL.md) | `ork phase list`, `ork sessions` |

## Evals

Os casos que protegem estas skills ficam em [`eval/casos/`](../eval/casos/) e rodam por
`ork eval`. Cada skill tem no minimo tres casos, cobrindo caminho feliz, resistencia a
racionalizacao e borda de dominio. O runner julga a **metade estatica** (as regras que precisam
existir no arquivo para o comportamento ser possivel) e diz em voz alta que a **metade
comportamental e `unavailable`**, nunca `passing`: lacuna e publicada como lacuna.

## Instalacao nos hosts

`ork adapter install claude-code|codex` copia o catálogo e declara suas entradas no host.
Hermes recebe a entrada própria e as duas variantes de experiência. OpenClaw ainda não
recebe skills do pacote. A fonte permanece neste catálogo; recibos registram os hashes
instalados. Preferências vêm de `ork experiencia show --json` no projeto da sessão.

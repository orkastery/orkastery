# Playbook dos runtimes (I-09)

Data da homologacao: 13/09/2026 (America/Sao_Paulo)

## Contrato efetivo

O `ork` continua sendo a autoridade sobre fase, worktree, claims, verificacao e SHIP. O
runtime recebe apenas capacidades nativas compatíveis com a fase e com o transporte
homologado.

| Fase/capacidade | Claude Code (`claude-bg`) | Codex (app-server) |
| --- | --- | --- |
| PLAN | sessão comum desde a I-34: `--disallowedTools Edit,Write,NotebookEdit` e allowlist só com as seis consultas e `mcp__orkastery__ork_artifact_write` | `collaborationMode.mode=plan` |
| GO | agente `ork-go` instalado pelo plugin; escrita limitada a worktree | `outputSchema` fechado de `schemas/claims.schema.json` |
| CHECK | agente `ork-check` instalado pelo plugin | `review/start` inline contra a branch base carimbada na thread |
| Limite temporal | contrato persistido no `#setup`; a sessão `--bg` não oferece interrupção temporal nativa | `duracaoMaximaMs`, com `turn/interrupt` ao vencer |
| Avaliação contínua | `ork eval` cobre prompts, skills, hooks e canários | o mesmo corpus, mais testes do app-server simulado |

O perfil é opt-in. `playbook.ativo: true` exige limites explícitos em todos os blocos dos
modos permitidos. Ausência ou `ativo: false` preserva o despacho anterior.

### Mudança da I-34 no PLAN do Claude (19/09/2026)

A homologação da I-09 publicava o PLAN do `claude-bg` como `--permission-mode plan --agent
ork-plan`. Em sessão `--bg`, esse modo desabilita `ExitPlanMode`, grava o plano em
`~/.claude/plans` e bloqueia `ork_artifact_write`: a sessão da thread `ork-i33rotacaoco`
terminou "pronta para aprovação" sem meio de aprovação e sem gravar `docs/plan.md`. O agente
`ork-plan` do plugin também não lista ferramentas MCP. Desde a I-34 o PLAN roda como sessão
comum, com as ferramentas de arquivo negadas e o artefato gravado pelo núcleo; a sessão PLAN
que termina sem `docs/plan.md` novo vira `gate_blocked` `artifact.missing`. O arquivo do
agente `ork-plan` não mudou.

## Instruções persistentes

`ork init` cria ou atualiza somente o trecho entre `<!-- orkastery:begin -->` e
`<!-- orkastery:end -->` no `AGENTS.md`. Texto do projeto fora desses marcadores é
preservado. Marcadores duplicados, invertidos ou incompletos causam erro antes de qualquer
escrita.

O bloco apresenta nome, abreviação, branch base, modos permitidos, ciclo de fases, regras
de worktree e os comandos `verify` do manifesto. Assim o Codex entra no repositório com o
mesmo contrato que recebeu pelo prompt e pelas skills.

## Saída estruturada e autoridade

O schema de claims descreve apenas candidatos (`tarefa`, `arquivo`, `alegacao`,
`verifyId`). A resposta do modelo não cria claim, não marca estado e não concede selo. A
promoção continua passando pelo MCP/CLI do Ork e pela reexecução do comando no HEAD real.

O schema, o contexto do runtime e a matriz de capacidade têm fingerprint. Prova produzida
para outra versão, binário, configuração, projeto, thread, fase, base ou HEAD é recusada.

## Fronteiras publicadas

- `claude --output-format json`, `--max-turns` e `--max-budget-usd` exigem `--print` na
  versão homologada. O Ork mantém `--bg` porque a sessão precisa continuar visível,
  dirigível e verificável no host. Tokens e duração vêm dos sensores da I-04/I-07.
- CI e proteção de branch pertencem à I-12.
- Objective Envelope e a exigência global de runtime cruzado pertencem à I-13. A I-09
  fornece o revisor nativo Codex usado pelo CHECK.
- Sessões avulsas, bubblewrap e `workspace-write` foram entregues pela I-02; contexto MCP,
  steering e jornada do dono foram entregues pela I-16.

## Provas reproduzíveis

```bash
npm --prefix core test
node core/dist/index.js eval
node core/dist/index.js init
git diff --check
```

O teste de controller usa um app-server falso em processo separado. Ele prova os parâmetros
de `turn/start` e `review/start` sem acessar conta, assinatura ou configuração global.

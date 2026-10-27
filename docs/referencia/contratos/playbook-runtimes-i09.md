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

### Grok Build (`grok`), RM-067 (27/10/2026)

O `grok` não entra na matriz acima: a matriz de capacidades (`core/src/playbook-capabilities.ts`) só ganha um runtime
com o ensaio real da homologação, que é a F5 da [RM-067](../../roadmap/RM-067-grok-build-homologado.md). O que vale
desde a F4 e a F4b:

| Capacidade | O que o `ork` faz com o `grok` |
| --- | --- |
| Despacho | `grok -p` headless com `--output-format streaming-json`, pedido por `ork phase run --runtime grok --model <modelo>` ou pelo setup do bloco; nunca o `runtime.adapter` do projeto |
| Setup e fallback | runtime de bloco e entrada `grok:<modelo>[:esforço]` do fallback, sempre com o modelo do dono (não há modelo padrão); o esforço vai ao `--effort` com o mesmo nome, e o `eco` vira `minimal`; o nível que o modelo não anuncia é recusado pelo próprio `grok` |
| Sandbox | `workspace` é o piso; `read-only` com `runtime.sandbox: read-only` e no PLAN que fecha o bloco; `danger-full-access` vira `off` só com `ork setup sandbox confirmar`, senão `runtime.sandbox-nao-confirmado`; nunca `--yolo`, `--always-approve` nem `--permission-mode` |
| Instruções do projeto | `--trust` na pasta do `--cwd` (a worktree da thread), para o `AGENTS.md` carregar na partida headless |
| Conta | perfis de `ork accounts add --runtime grok`, cada um com o seu `GROK_HOME`; login do próprio CLI (`grok login` ou `grok login --device-auth`), pela assinatura (D1 = b do dono); o filho roda sem `XAI_API_KEY`, e o `ork` nunca lê nem copia o `auth.json` |
| Retry | a troca de perfil dentro do `grok` vale também num projeto com o MCP do `ork`, e desde a F4c ele é alvo do fallback e da escada de quem tem o MCP, porque o servidor do `ork` grava fora do sandbox dele; a escada automática segue sem trocar a conta dele |
| MCP do `ork` | desde a F4b, `ork mcp install --host grok` grava a entrada no `.grok/config.toml` do projeto, e o comando leva um `--allow MCPTool(orkastery__<ferramenta>)` por ferramenta, as que o `--allowedTools` do `claude-bg` libera; o filho roda com `GROK_CLAUDE_MCPS_ENABLED=0` e `GROK_CURSOR_MCPS_ENABLED=0`. Desde a F4c, o despacho sobe o servidor do `ork` fora do sandbox do `grok`, como processo do próprio `ork`: Streamable HTTP só em `127.0.0.1`, porta efêmera, token de 256 bits por despacho só no ambiente do servidor e do `grok`, nunca em arquivo, e, com o sandbox, a conexão só da árvore de processos do `grok` do despacho (quando ele deixa ler os descritores; sem isso, e no perfil `off`, vale só o token), só as ferramentas do `--allow` daquele despacho, e o servidor morre com a sessão; a config da worktree, fora do git, aponta para ele por `url` e `bearer_token_env_var` |
| Inventário | `ork sessions` lê a pasta `sessions/` de cada `GROK_HOME`, só pelos nomes e pelo mtime do `updates.jsonl` |

Lacunas que seguem abertas:

- **Cota esgotada:** o formato do erro de cota do `grok` não está confirmado. Nenhum texto do `grok` vira
  `runtime.quota-exhausted`, e a escada de recuperação nunca troca a conta dele (`cota-sem-sinal-tipado`) até o
  ensaio real (F5) ler o formato estruturado.
- **Conferência de login:** o `grok` não documenta um comando de status do login; o perfil entra no rodízio sem
  conferência prévia, e o erro de login do despacho o tira (`runtime.auth-missing`).
- **Sandbox e MCP:** resolvido na F4c pela decisão do dono (3.a, 27/10/2026): o servidor do `ork` roda fora do
  sandbox do `grok`, e a sessão no piso `workspace` grava o ledger, os artefatos e o git da worktree por ele. Com o
  `grok` simulado, o teste com o Landlock do kernel prova as duas pontas; o ensaio real (F5) confirma a conexão do
  `grok` de verdade, inclusive no `read-only` do PLAN, em que o guia só bloqueia a rede dos filhos.
- **`.mcp.json` do projeto:** a fonte oficial não dá variável que o desligue. O `orkastery` da config da worktree vence
  pelo nome, nenhuma ferramenta de outro servidor entra no `--allow`, e o ensaio real confirma se o headless recusa a
  ferramenta fora dele.
- **Medição:** o #Noctum ainda não mede o consumo do `grok`.

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

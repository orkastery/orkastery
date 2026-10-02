---
id: RM-055
tipo: roadmap
titulo: Impedimento que só o dono resolve vira pedido a ele
categoria: melhoria
pai: RM-048
features: []
owner: Julio
atualizado_em: 2026-10-02T17:31:12+00:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 7ab4932
    pr: null
sdlc:
  thread: ork-rm055impedim
  modo: "#Auto"
  fase: MASTER
  status: aberta
---

# RM-055 — Impedimento que só o dono resolve vira pedido a ele

> **Em uma frase:** quando o runtime recusa o despacho por algo que só o dono resolve no terminal, a fase vira espera dele, com o comando exato, e o `ork` re-despacha o mesmo prompt depois, sem o dono reescrever o pedido.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o product builder que conduz várias threads ao mesmo tempo. Quando o runtime recusava o despacho por um impedimento que só ele resolve (confiar no diretório da worktree, aceitar termos novos do CLI), o `ork` gravava só `phase_dispatch_failed`. A thread ficava `aberta` sem pedido nenhum, e o board, a fábrica e o pulse diziam "espera você: -".
- **Evidências e fonte:** em 29/09/2026, no srvjcp86, três despachos `claude --bg` (`ork-rm052projeto`, `ork-rm053network` e `ork-rm054roadmap`) morreram com `Workspace not trusted. Run claude in <worktree> once and accept the trust prompt, then retry.` (ledger de cada thread, `phase_dispatch_failed` de 16:32 UTC). O dono só soube horas depois, perguntando.
- **Objetivo/OKR:** nenhum impedimento do dono fica invisível. Ele chega na hora, com o comando e o que acontece depois.
- **Hipótese:** se a saída do runtime vira motivo tipado e o motivo do dono abre a espera dele com o comando exato, então o tempo entre a recusa e o dono saber cai de horas para o próximo pulse, porque o pedido chega pelo mesmo canal das outras esperas.
- **Métrica principal / linha de base / meta / janela / fonte:** despachos recusados por impedimento do dono sem espera aberta no ledger. A linha de base é 3 de 3 (29/09), a meta é 0, a janela é 30 dias e a fonte é o `gate_blocked` tipado depois de cada `phase_dispatch_failed`.
- **Métricas de proteção:** impedimento técnico continua fora das contagens do dono ("Conosco"). Cota e login seguem na rotação de conta (I-33). Nenhum re-despacho sai sem o mesmo sha256 do prompt gravado.

## Escopo e validação

- **Incluído:**
  - **a)** motivos tipados a partir da saída do runtime: `runtime.workspace-untrusted` (claude e codex) e `runtime.consent-pending`, com teste por motivo. Motivo desconhecido continua `runtime.unavailable`.
  - **b)** o motivo do dono grava `gate_blocked` tipado com o que trava, o comando exato e o que o `ork` faz depois. Ele aparece em "espera você" no monitor, no board, no retrato da fábrica e no pulse, pelo contrato curto `ork.hitl-curto/v1`, com três alternativas e uma recomendada.
  - **c)** `ork retry run <thread>` re-despacha a mesma fase com o mesmo prompt gravado. Na confiança do diretório, o re-despacho só sai depois que o `.claude.json` da conta registra o aceite (o diretório de cima confiado vale). Sem a prova, nada é despachado e a tentativa não conta.
  - **d)** este item, o CHANGELOG em "Não publicado", a tabela de retry do guia de verificação e a referência da CLI.
- **Fora de escopo:** login ausente e cota esgotada, que já são da rotação de conta (I-33) e só chegam ao dono quando a rotação escala. Também fica fora o re-despacho automático pelo pulse, sem o `ork retry run`: o pulse mostra o comando e a ação continua explícita. Por fim, a seleção de 3 a 5 alternativas em todo HITL, que é da RM-057.
- **Entregáveis e critérios de aceite:**
  - classificação por motivo → `core/test/rm055-impedimento.test.ts` (frases do claude, do codex, de termos, e as que ficam fora);
  - espera do dono no monitor, na fábrica e no pulse, e retry que só re-despacha depois do aceite → o teste de ponta a ponta do mesmo arquivo, com o stub do `claude` repetindo a frase do incidente;
  - pedido curto dentro do teto de linhas, com comando, "desde" e `ork retry run` → o mesmo arquivo.
- **Piloto, medição e critérios de expansão/interrupção:** o piloto é o srvjcp86 e a VPS. Se aparecer frase nova de impedimento do dono, ela entra na lista de frases com teste. Se um motivo do dono for classificado por engano, a frase sai da lista.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** alta, por incidente. Fábrica parada sem aviso é o custo mais caro do modo `#Auto` (01/10/2026).
- **Horizonte / alvo / previsão / confiança / marcos:** próxima versão depois da 0.5.1. A confiança é alta: o comportamento é local e coberto por teste.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-048 (contrato curto, na main), RM-034 e RM-002 (runtime claude-bg), RM-054 e RM-052 (fábrica e maestro mostram a espera).
- **Premissas / riscos / mitigação:** o texto do runtime muda entre versões → frases em lista com teste, e motivo desconhecido continua genérico. A chave `hasTrustDialogAccepted` do `.claude.json` pode mudar → sem arquivo ou sem a chave, a prova vale "não sei", o retry despacha e o runtime decide; se ele recusar de novo, a mesma espera volta.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - D1, agente condutor, 02/10/2026: o motivo do dono é `gate_blocked` tipado lido como espera do dono, não um `human.pending` genérico, porque o retry precisa do motivo para re-despachar o prompt certo;
  - D2, agente condutor, 02/10/2026: o re-despacho fica no `ork retry run`, explícito, em vez de automático no pulse, porque é um ato que gasta sessão do runtime.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-02 | Julio |
| Documentação | Em revisão | — | 2026-10-02 | Julio |
| Código | Mesclado | commit `7ab4932` | 2026-10-02 | Julio |
| Testes | Em execução | — | 2026-10-02 | Julio |
| Deploy | Não implantado | — | 2026-10-02 | Julio |
| Exposição | Flag desligada | — | 2026-10-02 | Julio |
| Habilitação | Pendente | — | 2026-10-02 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R agente condutor (srvjcp86) / A Julio / C VPS / I comunidade
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a GOAL foi despachada ao codex em 01/10. A implementação, os testes e o PR ficaram com o agente condutor (Claude Code), em `#Auto` com autorização de push e merge do dono até 02/10, 23h. O CHECK independente roda no CI (`ork-verify`).
- **Próxima ação, responsável e prazo:** fazer o merge com os 4 checks verdes; responsável: o agente condutor; prazo: 02/10/2026.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-30 | Item reservado pela thread `ork-rm055impedim` | `ork roadmap reservas` | Julio |
| 2026-10-02 | Fatia única: motivos, espera do dono, retry e docs | PR desta thread | Agente condutor |

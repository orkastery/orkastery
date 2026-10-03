---
id: RM-057
tipo: roadmap
titulo: "HITL de condução por alternativas: de 3 a 5 opções, uma recomendada, nunca texto colado"
categoria: melhoria
pai: RM-048
features: []
owner: Julio
atualizado_em: 2026-10-03T07:20:00+00:00
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
    commit: 7266df6
    pr: 49
sdlc:
  thread: ork-rm057regrada
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-057 — HITL de condução por alternativas: de 3 a 5 opções, uma recomendada, nunca texto colado

> **Em uma frase:** todo HITL de condução que parte do Orkastery chega ao maestro humano como uma seleção entre 3 e 5 alternativas, uma delas com o selo "Recomendação" do ork, e nunca depende de o humano colar ou digitar texto livre para a fábrica seguir.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Problema e resultado

- **Público e problema/oportunidade:** o product builder maestro humano conduz várias threads em paralelo. Quando a fábrica para e pede uma confirmação em texto livre, a condução fica parada até ele voltar, ler e redigir uma resposta, e o paralelismo da AI Factory cai a zero.
- **Evidências e fonte:** na noite de 01/10 para 02/10/2026, o agente que conduzia o Orkastery no srvjcp86 recebeu como texto colado o pedido do dono (threads RM-032, RM-056, RM-053, RM-040 e RM-055, com push e merge autorizados até 02/10 às 12h). Ele parou para pedir um "confirmo" em texto livre e a condução ficou mais de 10 horas sem produzir. O texto colado tinha sido pedido pelo próprio fluxo de condução.
- **Objetivo/OKR:** autonomia é ROI. A fábrica só para quando a decisão é de fato do humano, e mesmo assim ele decide com um clique, em segundos, de qualquer canal.
- **Hipótese:** Se todo HITL de condução sair como seleção de 3 a 5 alternativas com uma recomendada, então o tempo entre o pedido e a decisão cai e nenhuma thread fica parada esperando texto, porque escolher uma opção pronta custa segundos e pode ser feito do celular.
- **Métrica principal / linha de base / meta / janela / fonte:** tempo parado por HITL de condução; linha de base: mais de 10 h na noite de 01→02/10; meta: nenhum HITL de condução em texto livre fora da exceção técnica, e mediana de resposta abaixo de 5 min; janela de 30 dias; fonte: ledger e `ork pulse`.
- **Métricas de proteção:** nenhuma decisão irreversível (push, merge, release, apagar dados) tomada sem a autorização que o dono deu; a alternativa recomendada não pode virar padrão silencioso quando o dono não respondeu.

## Escopo e validação

- **Incluído:**
  - Todo HITL de condução que o ork abre (gate, pausa, pedido de autorização, dúvida de escopo) sai como seleção, com no mínimo 3 e no máximo 5 alternativas.
  - O ork escolhe as alternativas mais compatíveis com o cenário da decisão e com o propósito do produto, projeto ou iniciativa, e marca exatamente uma com o selo "Recomendação".
  - A mesma forma vale em todo canal (Claude Code, OpenClaw, Telegram, pulse), na linha da [RM-048](RM-048-hitl-humano-no-centro.md).
  - Os adaptadores e os prompts de condução passam a proibir o pedido de confirmação em texto livre e o pedido para colar texto.
  - Um pedido do dono que chega como texto colado, pedido pelo próprio fluxo, vale como instrução do dono, dentro da autorização que ele declara.
- **Fora de escopo:** a única exceção ao texto livre é a dependência técnica que a fábrica não consegue resolver sozinha com os runtimes disponíveis e que exige que o maestro humano rode um comando no terminal (um login interativo, por exemplo). Nesse caso o pedido traz o comando exato, pronto para copiar.
- **Entregáveis e critérios de aceite:**
  - Contrato do HITL de condução com 3 a 5 alternativas e um selo "Recomendação" → teste que reprova um pedido com menos de 3 ou mais de 5 opções, ou com nenhuma ou mais de uma recomendada.
  - Lint de prompt e de adaptador → `ork prompt lint` reprova um template que peça confirmação em texto livre ou que o humano cole texto.
  - Exceção técnica → o pedido em texto só passa com o motivo tipado de dependência técnica e o comando a rodar.
  - Canário do incidente de 01/10 → um pedido colado com autorização explícita segue sem parar.
- **Piloto, medição e critérios de expansão/interrupção:** piloto na condução do próprio Orkastery por 7 dias, medindo no ledger o tempo parado por HITL; expande para todos os hosts se nenhum HITL em texto livre passar fora da exceção.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Alta; pedido do dono; uma noite inteira de fábrica parada por um HITL em texto livre; 2026-10-02.
- **Horizonte / alvo / previsão / confiança / marcos:** próxima versão depois da 0.5.1; marcos: contrato, lint, adaptadores, canário.
- **Dependências e bloqueios (ID, owner, próxima revisão):** [RM-048](RM-048-hitl-humano-no-centro.md) (forma do bloco de decisão), [RM-041](RM-041-hitl-invertido.md) (HITL invertido).
- **Premissas / riscos / mitigação:** risco de a fábrica decidir sozinha algo irreversível. Mitigação: a alternativa recomendada só é aplicada com a escolha do humano ou dentro da autorização que ele já deu; dúvida dentro da autorização vai para `ork decisao registrar`, sem parar a thread.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** regra definida por Julio em 2026-10-02.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `7266df6` · PR #49 | 2026-10-03 | Julio |
| Testes | Em execução | — | 2026-10-03 | Julio |
| Deploy | Não implantado | — | 2026-10-03 | Julio |
| Exposição | Flag desligada | — | 2026-10-03 | Julio |
| Habilitação | Pendente | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: fábrica Orkastery / A: Julio / C: — / I: —
- **Agentes envolvidos, atuação, autonomia e revisor humano:** Claude Code redigiu o item a pedido do dono; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** depois do merge da fatia 3, o piloto de 7 dias na condução do próprio Orkastery, lendo o tempo parado no `ork pulse` e no `ork roadmap status` (`hitlDeConducao`, mediana de 7 dias) ou em `ork ledger stats --desde 7d`; a reinstalação da extensão do OpenClaw e da skill do Hermes nos hosts fica com o dono; responsável: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-02 | Item criado com prioridade alta | Incidente da noite de 01→02/10: mais de 10 h de condução parada por um HITL em texto livre | Julio |
| 2026-10-02 | Fatia 1 na thread ork-rm057alterna: contrato de 3 a 5 com uma Recomendação no registro, dependência técnica tipada, letras a-e, selo no texto ao dono, lint `hitl-texto-livre` e a regra nos adaptadores do Claude Code e do Codex | Recorte registrado com `ork decisao registrar` na thread | Julio |
| 2026-10-02 | Fatia 1 mesclada | PR 49, merge 7266df6 | Julio |
| 2026-10-03 | Fatia 2 na thread ork-rm057fatia2c: canário `fx-pedido-colado` (o pedido colado com autorização explícita segue sem parar), a regra nas descrições das tools do OpenClaw e na skill do Hermes, e o tempo parado por HITL de condução no `ork ledger stats` (`hitlDeConducao`, mediana contra a meta de 5 min) | Recorte registrado com `ork decisao registrar` na thread; o pulse e o piloto ficam para depois | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | Fatia 2 mesclada | PR 52, merge 66b7ee3 | Julio |
| 2026-10-03 | Fatia 3 na thread ork-rm057fatia3t: o tempo parado por HITL de condução no `ork pulse` e no `ork roadmap status` (`hitlDeConducao`: abertas com há quanto tempo, mediana de 7 dias), com uma linha no resumo do pulse só acima da meta de 5 min | Recorte registrado com `ork decisao registrar` na thread; campo aditivo opcional nos contratos que já existem, sem contrato novo | Claude (agente, #Auto), revisão de Julio pendente |
| 2026-10-03 | Fatia 4 na thread ork-rm057regrada, defeitos do ensaio isolado da reinstalação do OpenClaw: a regra também em `ork_network_roadmap` e `ork_network_status`, as únicas tools visíveis no perfil `coding` (o perfil não foi ampliado), e o `ork adapter install` apontando a extensão para o `ork` em execução, com aviso quando o do PATH é outro | Ensaio de 03/10: no `coding` o modelo do Telegram nunca lia a regra; pelo tarball, a extensão 0.5.2 chamava o `ork` 0.4.3 global. `tools.alsoAllow` fica como decisão do dono | Claude (agente, #Auto), revisão de Julio pendente |

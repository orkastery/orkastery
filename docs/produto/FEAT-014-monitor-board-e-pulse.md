---
id: FEAT-014
tipo: feature
titulo: Monitor, board e pulse de atenção
estado: vigente
pai: MOD-04
roadmap: [RM-001, RM-037, RM-045, RM-048, RM-052]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-03T06:52:15-03:00
versao: main@059f257a
evidencias:
  codigo:
    commit: d2a54075
    pr: 50
    fatia4: "107ac246, PR #45"
    fatia5: "d2a54075, PR #50"
fontes:
  codigo:
    - core/src/orquestracao.ts
    - core/src/board.ts
    - core/src/pulse.ts
    - core/src/roadmap-status.ts
    - core/src/parado-no-condutor.ts
  testes:
    - core/test/orquestracao.test.ts
    - core/test/board.test.ts
    - core/test/pulse.test.ts
    - core/test/pulse-enxuto.test.ts
    - core/test/roadmap-status.test.ts
    - core/test/rm037-fatia4-parado-no-condutor.test.ts
    - core/test/rm037-fatia4-pulse-condutor.test.ts
    - core/test/rm037-fatia4-status-honesto.test.ts
    - core/test/rm037-fatia5-check-sem-veredito.test.ts
    - core/test/rm037-fatia5-forja-sem-leitura.test.ts
    - core/test/rm037-fatia5-merge-incorporado.test.ts
  simbolos:
    - core/src/orquestracao.ts#montarMonitor
    - core/src/board.ts#planejar
    - core/src/pulse.ts#montarPulse
    - core/src/roadmap-status.ts#montarStatusDoRoadmap
    - core/src/parado-no-condutor.ts#entregasDoProjeto
  contratos:
    - ork.pulse/v1
    - ork.roadmap-status/v1
    - ork.prs-abertos/v1
  comandos:
    - ork orquestracao status
    - ork board
    - ork board plan
    - ork pulse
    - ork roadmap status
---

# FEAT-014 — Monitor, board e pulse de atenção

> **Em uma frase:** Monitor, board e pulse mostram quem está parado, esperando o quê e há quanto tempo, a partir das threads, filas e evidências de entrega; a varredura mantém o retrato dos PRs.

- **Estado:** vigente · **Verificado em:** 2026-10-03 · **Versão:** main@059f257a
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-04](MOD-04-atencao-humana.md)
- **Roadmap:** [RM-001](../roadmap/RM-001-radar-ork-pulse.md), [RM-037](../roadmap/RM-037-verify-rapido-e-confiavel.md), [RM-045](../roadmap/RM-045-pulse-enxuto.md), [RM-048](../roadmap/RM-048-hitl-humano-no-centro.md), [RM-052](../roadmap/RM-052-projeto-alvo-explicito.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver pausas e impedimentos, planejar quem avança, montar a fila de atenção, gerar o status report do roadmap.
- **Status report do roadmap (RM-048):** `ork roadmap status` monta o relatório no formato aprovado pelo dono: "Roadmap do Projeto (DD/MM, HH:MM)" no fuso dele, com o fuso dito logo abaixo do título (`Horários de Brasília.`), os grupos ✅ Concluídos, 🟢 Disponíveis com algo em aberto, 🚀 Entregue hoje, 🧪 Piloto, 🔨 Em desenvolvimento, 🔍 Refinamento, 🆕 Proposto e ⛔ Descontinuado, um item por linha, `#HITL` no que espera o dono e o fecho "O que precisa de você" e "O que eu faço em seguida". É leitura pura. Os canais chamam o comando (`ork_roadmap_status` no MCP e no OpenClaw, `ork-roadmap-status.sh` no Hermes) e transportam o texto. Desde a RM-037 (fatia 4), "O que eu faço em seguida" diz o estado real da entrega da thread do item, e uma linha "Fábrica:" avisa a máquina sem batida (BR-014-05).
- **Pré-condições e gatilho:** projeto com threads.
- **Fluxo principal:**

  1. `ork orquestracao status` separa pausa humana (prevista) de impedimento (não prevista).
  2. `ork board plan` diz quem avança agora e por quê.
  3. `ork pulse` junta tudo que pede atenção humana numa fila.

- **Alternativas, erros e recuperação:** `--exigir-limpo` sai diferente de zero enquanto houver thread parada (vira watchdog).
- **Pós-condições:** o monitor e o status do roadmap são consultas. A varredura do pulse grava o retrato das leituras de PR e deduplica os avisos de forja sem leitura; não aprova gates nem executa a entrega.
- **Regras de negócio:**
  - BR-014-01: vaga devolvida por estado real, não por relógio.
  - BR-014-02 (I-45): só pede o dono quem pode receber resposta (sessão viva, ou incerta em thread aberta); sessão morta ou terminal em thread aberta, vaga parada e entrega sem nota vão para a faixa automática. História sem thread ou de thread fechada sai da fila.
  - BR-014-03 (I-45): verificação reprovada de thread já mesclada na base não fica com o dono.
  - BR-014-04 (RM-037, fatia 4): depois de 30 min, o trabalho parado no condutor aparece em `paradoNoCondutor`, no pulse e no resumo dos dois canais, numa linha por thread com o próximo passo, fora de "Esperando você". Cobre branch sem push, branch publicada sem PR, PR verde sem merge, PR vermelho sem fase despachada depois, merge sem registro e sessão `blocked` sem pergunta real. Antes da entrega, indica a próxima fase, sem pular a pausa do modo.
  - BR-014-05 (RM-037, fatia 4): `ork roadmap status` usa o git local e o retrato de PRs, com a hora da leitura e sem rede, para dizer o estado real da entrega. Pela cópia local da fábrica, avisa a máquina sem batida além de 3 h; sem cópia, informa "não lido".
  - BR-014-06 (RM-057, fatia 3): `hitlDeConducao` traz as perguntas abertas, há quanto tempo param a thread e a mediana dos últimos 7 dias contra a meta de 5 min. O resumo só acrescenta a linha acima da meta; ela não fura a cadência.
  - BR-014-07 (RM-037, fatia 5, A3): no `#Auto`, CHECK em `done` sem veredito pertence ao condutor, antes de qualquer caso de entrega. O próximo passo é `ork phase run <thread> CHECK --prompt "<pedido da fase>"`. Fora do `#Auto`, segue com o dono.
  - BR-014-08 (RM-037, fatia 5, A5): a forja sem leitura de PR, como GitLab, remoto local ou host sem login do `gh`, gera `prs.sem-leitura` uma vez por remoto e host. As linhas do condutor e o status orientam conferir o PR na forja, sem repetir "PR não lido". GitHub Enterprise usa o host do remoto quando o `gh auth status --hostname` confirma o login; o retrato guarda esse host.
- **Fim do turno e espera real (RM-037, fatia 4):** `human.pending` no fim do turno (`blocked`, ou SHIP em `done` sem `ship_done`), num bloco sem pausa e sem pergunta estruturada aberta, pertence ao condutor. Pausa prevista, escalação tipada, pedido aberto (inclusive vencido), permissão, sessão retomada e sessão nativa do Codex continuam com o dono. Depois do Stop sem atividade, a lista numerada na mensagem final não é menu. Resolvida a pausa prevista, o tempo parado conta do veredito.
- **Leitura dos PRs (RM-037, fatias 4 e 5):** só branches já publicadas são consultadas: PRs abertos, recentes e a branch candidata a "sem PR" conferida individualmente. Uma leitura boa gera `ork.prs-abertos/v1`; falha transitória, lista cortada e retrato velho são "PR não lido", nunca "sem PR". A indisponibilidade de leitura própria da forja segue BR-014-08.
- **Recibo de entrega (RM-037, fatia 5, A1):** o leitor aceita o recibo legado cuja ponta contém o merge da thread e deixa de pedir seu registro novamente. Nova entrega posterior ao recibo continua pendente; `mergeSha` e `pontaDaBase` seguem o contrato da [FEAT-006](FEAT-006-ship-com-push-provado.md).
- **Critérios de aceite e testes:** Dada uma thread com gate reprovado, quando o monitor roda, então ela aparece como impedimento (`core/test/orquestracao.test.ts`). Dada uma sessão que encerrou o turno com o trabalho feito e a branch sem push há 15 h, quando o pulse roda, então "Esperando você" fica em 0 e a linha "parado no condutor" diz o próximo passo (`core/test/rm037-fatia4-pulse-condutor.test.ts`). CHECK sem veredito no `#Auto` aponta o redespacho (`rm037-fatia5-check-sem-veredito`); forja sem leitura não repete o aviso, e Enterprise usa o host correto (`rm037-fatia5-forja-sem-leitura`).
- **Interface e acessibilidade:** Texto de CLI; `--json` para agentes.

## Dados e contratos

- **Entidades:** estado derivado das threads e entregas; retrato `ork.prs-abertos/v1` em `.orkastery/monitor/`, com host e instante da consulta.
- **APIs:** Não aplicável.
- **Jobs:** cron do pulse na máquina da fábrica (`monitor/varredura-pulse.sh`).

## Operação e controle

- **Observabilidade:** o próprio comando.
- **Rollback:** Não aplicável — leitura.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-10-02 | BR-014-04 e BR-014-05: trabalho parado no condutor e status do roadmap com o estado real e a batida da fábrica | Claude (agente) / Julio, revisão pendente | RM-037, thread `ork-rm037fatia4t` |
| 2026-10-03 | Pulse e status incorporam A1, A3 e A5: recibo legado, CHECK sem veredito no Auto e aviso único de forja sem leitura | Codex (agente) / revisão pendente | RM-037: fatia 4 em `107ac246` (PR #45), fatia 5 em `d2a54075` (PR #50) |

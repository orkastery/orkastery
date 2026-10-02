---
id: FEAT-014
tipo: feature
titulo: Monitor, board e pulse de atenção
estado: vigente
pai: MOD-04
roadmap: [RM-001, RM-037, RM-045, RM-048, RM-052]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
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

> **Em uma frase:** Uma visão única de quem está parado, esperando o quê e há quanto tempo, derivada só de `thread.json`, ledger e filas em disco; o monitor lê, nunca grava.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-04](MOD-04-atencao-humana.md)
- **Roadmap:** [RM-001](../roadmap/RM-001-radar-ork-pulse.md), [RM-037](../roadmap/RM-037-verify-rapido-e-confiavel.md), [RM-045](../roadmap/RM-045-pulse-enxuto.md), [RM-048](../roadmap/RM-048-hitl-humano-no-centro.md), [RM-052](../roadmap/RM-052-projeto-alvo-explicito.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver pausas e impedimentos, planejar quem avança, montar a fila de atenção, gerar o status report do roadmap.
- **Status report do roadmap (RM-048):** `ork roadmap status` monta o relatório no formato aprovado pelo dono: "Roadmap do Projeto (DD/MM, HH:MM)" no fuso dele, os grupos ✅ Concluídos, 🟢 Disponíveis com algo em aberto, 🚀 Entregue hoje, 🧪 Piloto, 🔨 Em desenvolvimento, 🔍 Refinamento, 🆕 Proposto e ⛔ Descontinuado, um item por linha, `#HITL` no que espera o dono e o fecho "O que precisa de você" e "O que eu faço em seguida". É leitura pura. Os canais chamam o comando (`ork_roadmap_status` no MCP e no OpenClaw, `ork-roadmap-status.sh` no Hermes) e transportam o texto. Desde a RM-037 (fatia 4), "O que eu faço em seguida" diz o estado real da entrega da thread do item, e uma linha "Fábrica:" avisa a máquina sem batida (BR-014-05).
- **Pré-condições e gatilho:** projeto com threads.
- **Fluxo principal:**

  1. `ork orquestracao status` separa pausa humana (prevista) de impedimento (não prevista).
  2. `ork board plan` diz quem avança agora e por quê.
  3. `ork pulse` junta tudo que pede atenção humana numa fila.

- **Alternativas, erros e recuperação:** `--exigir-limpo` sai diferente de zero enquanto houver thread parada (vira watchdog).
- **Pós-condições:** nenhum; é leitura.
- **Regras de negócio:** BR-014-01: vaga devolvida por estado real, não por relógio. BR-014-02 (I-45): só pede o dono quem pode receber resposta (sessão viva, ou incerta em thread aberta); sessão morta ou terminal em thread aberta, vaga parada e entrega sem nota vão para a faixa automática; história sem thread ou de thread fechada sai da fila. BR-014-03 (I-45): verificação reprovada de thread já mesclada na base não fica com o dono. BR-014-04 (RM-037, fatia 4): o trabalho parado no condutor depois da entrega, além de 30 min, sai numa linha por thread, `<thread> parado no condutor desde HH:MM: <próximo passo>`, em `ork pulse`, no campo `paradoNoCondutor` e no resumo dos dois canais, fora de "Esperando você" e sem pergunta ao dono: branch sem push (ou commit novo sem push no PR aberto), branch publicada sem PR, PR verde sem merge (inclusive sem checks), PR com check vermelho sem fase despachada depois, merge na base sem registro e sessão `blocked` sem pergunta de verdade; antes da entrega, o passo é despachar a fase seguinte (fora do #Auto, fase a fase, sem pular a pausa do dono). O `human.pending` do observador no fim de turno, num bloco sem pausa ao fim e sem pergunta estruturada aberta, é do condutor, e o que sai do dono volta sempre como linha; pausa prevista, escalação tipada, pedido aberto (inclusive vencido que espera), prompt de permissão, sessão retomada e sessão nativa do Codex continuam do dono; depois do Stop sem atividade, a tela é a mensagem final (a lista numerada nela não é menu); depois do veredito da pausa prevista, o passo volta ao condutor, contado do veredito. Os PRs vêm do `gh pr list` do pulse, só com branch que já foi ao remoto (os abertos, os recentes e a branch candidata a "sem PR" conferida sozinha), e a leitura boa vira o retrato `ork.prs-abertos/v1`; falha, lista cortada e retrato velho são "PR não lido", nunca "sem PR". BR-014-05 (RM-037, fatia 4): o `ork roadmap status` lê o estado da entrega do git local e desse retrato, sem rede, com a hora da leitura do PR; com fábrica compartilhada, avisa numa linha a máquina sem batida além de 3 h pela cópia local de `ork/fabrica-estado`, e diz "não lido" sem cópia.
- **Critérios de aceite e testes:** Dada uma thread com gate reprovado, quando o monitor roda, então ela aparece como impedimento (`core/test/orquestracao.test.ts`). Dada uma sessão que encerrou o turno com o trabalho feito e a branch sem push há 15 h, quando o pulse roda, então "Esperando você" fica em 0 e a linha "parado no condutor" diz o próximo passo (`core/test/rm037-fatia4-pulse-condutor.test.ts`).
- **Interface e acessibilidade:** Texto de CLI; `--json` para agentes.

## Dados e contratos

- **Entidades:** Não aplicável — derivado.
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

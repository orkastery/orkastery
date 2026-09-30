---
id: FEAT-014
tipo: feature
titulo: Monitor, board e pulse de atenção
estado: vigente
pai: MOD-04
roadmap: [RM-001, RM-045, RM-048, RM-052]
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
  testes:
    - core/test/orquestracao.test.ts
    - core/test/board.test.ts
    - core/test/pulse.test.ts
    - core/test/pulse-enxuto.test.ts
    - core/test/roadmap-status.test.ts
  simbolos:
    - core/src/orquestracao.ts#montarMonitor
    - core/src/board.ts#planejar
    - core/src/pulse.ts#montarPulse
    - core/src/roadmap-status.ts#montarStatusDoRoadmap
  contratos:
    - ork.pulse/v1
    - ork.roadmap-status/v1
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
- **Roadmap:** [RM-001](../roadmap/RM-001-radar-ork-pulse.md), [RM-045](../roadmap/RM-045-pulse-enxuto.md), [RM-048](../roadmap/RM-048-hitl-humano-no-centro.md), [RM-052](../roadmap/RM-052-projeto-alvo-explicito.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver pausas e impedimentos, planejar quem avança, montar a fila de atenção, gerar o status report do roadmap.
- **Status report do roadmap (RM-048):** `ork roadmap status` monta o relatório no formato aprovado pelo dono: "Roadmap do Projeto (DD/MM, HH:MM)" no fuso dele, os grupos ✅ Concluídos, 🟢 Disponíveis com algo em aberto, 🚀 Entregue hoje, 🧪 Piloto, 🔨 Em desenvolvimento, 🔍 Refinamento, 🆕 Proposto e ⛔ Descontinuado, um item por linha, `#HITL` no que espera o dono e o fecho "O que precisa de você" e "O que eu faço em seguida". É leitura pura. Os canais chamam o comando (`ork_roadmap_status` no MCP e no OpenClaw, `ork-roadmap-status.sh` no Hermes) e transportam o texto.
- **Pré-condições e gatilho:** projeto com threads.
- **Fluxo principal:**

  1. `ork orquestracao status` separa pausa humana (prevista) de impedimento (não prevista).
  2. `ork board plan` diz quem avança agora e por quê.
  3. `ork pulse` junta tudo que pede atenção humana numa fila.

- **Alternativas, erros e recuperação:** `--exigir-limpo` sai diferente de zero enquanto houver thread parada (vira watchdog).
- **Pós-condições:** nenhum; é leitura.
- **Regras de negócio:** BR-014-01: vaga devolvida por estado real, não por relógio. BR-014-02 (I-45): só pede o dono quem pode receber resposta (sessão viva, ou incerta em thread aberta); sessão morta ou terminal em thread aberta, vaga parada e entrega sem nota vão para a faixa automática; história sem thread ou de thread fechada sai da fila. BR-014-03 (I-45): verificação reprovada de thread já mesclada na base não fica com o dono.
- **Critérios de aceite e testes:** Dada uma thread com gate reprovado, quando o monitor roda, então ela aparece como impedimento (`core/test/orquestracao.test.ts`).
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

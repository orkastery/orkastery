---
id: FEAT-011
tipo: feature
titulo: HITL em camadas: resumo, consentimento e lote
estado: vigente
pai: MOD-04
roadmap: [RM-003, RM-039, RM-041, RM-045]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T08:08:06-03:00
versao: main@e324025
fontes:
  codigo:
    - core/src/hitl-contract.ts
    - core/src/hitl-resumo.ts
    - core/src/hitl-lote.ts
    - core/src/pulse-consentimento.ts
    - core/src/pulse-resposta.ts
    - core/src/pulse-cadencia.ts
  testes:
    - core/test/hitl-v2-contrato.test.ts
    - core/test/hitl-resumo.test.ts
    - core/test/hitl-lote.test.ts
    - core/test/pulse-consentimento.test.ts
    - core/test/pulse-resposta.test.ts
    - core/test/pulse-cadencia.test.ts
  simbolos:
    - core/src/hitl-lote.ts#montarLote
    - core/src/hitl-resumo.ts#resumirHitl
    - core/src/pulse-resposta.ts#interpretarRespostaDoPulse
    - core/src/pulse-cadencia.ts#janelaAberta
  contratos:
    - ork.hitl/v2
    - ork.hitl-lote/v1
    - ork.hitl-resumo/v1
    - ork.pulse-consent/v1
    - ork.pulse-resposta/v1
    - ork.pulse-cadencia/v1
  comandos:
    - ork pulse
    - ork pulse responder
    - ork pulse cadencia
    - ork gate request
    - ork gate answer
---

# FEAT-011 — HITL em camadas: resumo, consentimento e lote

> **Em uma frase:** O dono recebe um resumo na cadência que escolheu com uma tag, com a contagem de pendências, e diz se pode responder agora; com o sim, chegam até cinco perguntas por vez, cada uma com alternativas a–d e uma recomendada.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@e324025
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-04](MOD-04-atencao-humana.md)
- **Roadmap:** [RM-003](../roadmap/RM-003-hitl-bidirecional-telegram.md), [RM-039](../roadmap/RM-039-cadencia-do-pulse-por-tag.md), [RM-041](../roadmap/RM-041-hitl-invertido.md), [RM-045](../roadmap/RM-045-pulse-enxuto.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** resumo recorrente, consentimento, lote de perguntas, resposta pelo Telegram, troca da cadência pela tag.
- **Pré-condições e gatilho:** pedido HITL aberto por um gate; canal com ingresso autenticado.
- **Fluxo principal:**

  1. O resumo diz quantas pendências, urgentes, bloqueantes e críticas existem.
  2. O dono responde ao código do "posso mandar agora?".
  3. Com o sim, sai um lote de até 5 objetivas (a–d, uma recomendada) e depois até 2 dissertativas, uma por vez.

- **Cadência:** o dono manda `#OrkPulseOff` (8h, às 08h, 16h e 00h), `#OrkPulseOn` (2h) ou `#OrkPulseOn-15m`, `-30m`, `-60m`, sozinha na mensagem, ou usa `ork pulse cadencia`. Vale na batida seguinte do cron. Pergunta nova não espera a janela.
- **Alternativas, erros e recuperação:** prazo vencido espera ou escala, nunca aprova; ato irreversível nunca avança por default.
- **Pós-condições:** resposta registrada com prova HMAC; o gate libera a fase.
- **Regras de negócio:** BR-011-01: pergunta sempre breve, com alternativas e uma recomendada. BR-011-02: o agente nunca responde no lugar do dono. BR-011-03: a cadência governa o status periódico, nunca a pergunta nova, e não encurta o prazo de resposta ao resumo abaixo de 60 minutos.
- **Critérios de aceite e testes:** Dado um lote servido, quando o dono responde "a" à primeira, então só aquela pergunta é marcada (`core/test/pulse-resposta.test.ts`). Dada a cadência `#OrkPulseOn`, quando só uma decisão informada aparece no meio da janela, então ela espera a janela seguinte, e uma pergunta nova sai na batida seguinte (`core/test/pulse-cadencia.test.ts`).
- **Interface e acessibilidade:** Mensagem de canal (Telegram) em tópicos curtos; horário no fuso do dono.

## Dados e contratos

- **Entidades:** pedido `ork.hitl/v2` com duas classes de item (`decidido` e `pergunta`); leitor de `ork.hitl/v1` congelado; cadência em `.orkastery/monitor/pulse-cadencia.json` (`ork.pulse-cadencia/v1`).
- **APIs:** ingresso do Hermes e do OpenClaw ([FEAT-021](FEAT-021-ingresso-hitl-telegram.md)).
- **Eventos:** `hitl_requested`, `pulse_consentimento`, `hitl_answered`.

## Operação e controle

- **Configuração:** o cron do pulse bate de 15 em 15 minutos; a cadência do resumo é a tag do dono ([RM-039](../roadmap/RM-039-cadencia-do-pulse-por-tag.md)), sem editar o crontab.
- **Acesso:** allowlist de remetente e chat; prova HMAC do update autenticado.
- **Rollback:** desligar o cron do pulse; os pedidos continuam em `ork pulse`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | cadência do resumo pela tag do dono | Claude (agente) / Julio, revisão pendente | RM-039 |

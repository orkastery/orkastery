---
id: FEAT-021
tipo: feature
titulo: Ingresso HITL pelo Telegram
estado: vigente
pai: MOD-06
roadmap: [RM-003, RM-041, RM-048]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - adapters/hermes/hitl-ingress/__init__.py
    - adapters/openclaw/src/hitl-ingress.ts
    - core/src/hitl-ingress-receipt.ts
    - core/src/pulse-resposta.ts
  testes:
    - adapters/hermes/test/hitl_ingress_test.py
    - adapters/openclaw/test/hitl-ingress.test.mjs
    - core/test/hitl-ingress-receipt.test.ts
    - core/test/pulse-gramatica-ingresso.test.ts
  simbolos:
    - core/src/hitl-ingress-receipt.ts#validarEvidenciaDoIngresso
  contratos:
    - ork.pulse-resposta/v1
    - ork.hitl-ingress/v1
    - ork.pulse-escuta/v1
  comandos:
    - ork gate answer
    - ork pulse responder
---

# FEAT-021 — Ingresso HITL pelo Telegram

> **Em uma frase:** O Hermes e o OpenClaw transformam a resposta do dono no Telegram num envelope com prova HMAC do update autenticado, que o núcleo confere antes de liberar qualquer gate.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-02](SYS-02-hosts-e-canais.md) > [MOD-06](MOD-06-integracao-com-hosts.md)
- **Roadmap:** [RM-003](../roadmap/RM-003-hitl-bidirecional-telegram.md), [RM-041](../roadmap/RM-041-hitl-invertido.md), [RM-048](../roadmap/RM-048-hitl-humano-no-centro.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** responder gate, responder o código do resumo, responder o lote, responder pelo código do gate, responder em texto livre curto, dar a nota do MASTER e ratificar pelo teclado do digest.
- **Formas que o ingresso intercepta (RM-048):** as de sempre (`P4EJ a`, `1a 2c`, `#OrkPulse...`), a resposta numerada (`1. B, 2. A`, `1 aprovo`, `3 detalhes`), a linha do digest (`ratificar ...`) e, só com a janela de escuta do núcleo aberta (`pulse-escuta.json`), a palavra solta (`aprovo`, `sim`, `a`). O texto depois do código curto vai a 200 caracteres. Texto acima de 300 caracteres nunca é testado contra as formas, e as expressões não têm backtracking caro, porque rodam antes da allowlist. As fontes são as mesmas no núcleo e nos dois adaptadores (`core/test/pulse-gramatica-ingresso.test.ts`).
- **Pré-condições e gatilho:** remetente e chat na allowlist; bot correto; chave de ingresso configurada.
- **Fluxo principal:**

  1. O gateway recebe a mensagem e o plugin monta o envelope com a prova.
  2. O núcleo confere prova, idade da mensagem e allowlist.
  3. A resposta vale; o recibo vai para o ledger.

- **Alternativas, erros e recuperação:** texto livre ("1. Aprovado") não registra nada; a prova divergente devolve erro de proveniência.
- **Pós-condições:** recibo de ingresso e resposta no ledger da thread.
- **Regras de negócio:** BR-021-01: a proveniência HMAC nunca muda e nunca é sintetizada pelo agente.
- **Critérios de aceite e testes:** Dado um envelope sem prova válida, quando chega ao núcleo, então é recusado (`core/test/hitl-ingress-receipt.test.ts`).
- **Interface e acessibilidade:** Mensagem de texto no Telegram.

## Dados e contratos

- **Entidades:** envelope de ingresso; recibo `ork.hitl-ingress/v1`.
- **APIs:** Bot API do Telegram, via gateway do Hermes ou do OpenClaw.
- **Eventos:** `hitl_answered`, `pulse_resposta`.

## Operação e controle

- **Configuração:** `ORK_HITL_TELEGRAM_USERS`, `ORK_HITL_TELEGRAM_CHATS`, `ORK_HITL_TELEGRAM_BOT_ID`, `ORK_HITL_ROOT` (nomes; os valores ficam no `.env` do host).
- **Acesso:** allowlist e HMAC; mensagem com mais de 60 s é recusada.
- **Rollback:** desabilitar o plugin no host; os pedidos continuam pendentes.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |

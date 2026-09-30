---
id: MOD-06
tipo: modulo
titulo: Integração com hosts
owner: Julio
estado: vigente
pai: SYS-02
verificado_em: 2026-09-24T21:30:00-03:00
---

# MOD-06 — Integração com hosts

> **Em uma frase:** Servidor MCP, instalação de adaptadores com recibo e ingresso HITL autenticado do Telegram pelo Hermes e pelo OpenClaw.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** o builder conduz de onde já está, com a mesma regra em todo lugar.
- **Limites:** o host não interpreta #TAG, não valida modo e não aprova gate.
- **Código:** `core/src/mcp-server.ts`, `core/src/mcp-install.ts`, `core/src/hosts.ts`, `adapters/hermes/hitl-ingress/__init__.py`, `adapters/openclaw/src/hitl-ingress.ts`.

## Features

- [FEAT-020](FEAT-020-mcp-e-adaptadores.md) Servidor MCP e instalação de adaptadores
- [FEAT-021](FEAT-021-ingresso-hitl-telegram.md) Ingresso HITL pelo Telegram
- [FEAT-030](FEAT-030-projeto-alvo-explicito.md) Projeto-alvo explícito e resposta honesta nos hosts

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |

---
id: SYS-02
tipo: sistema
titulo: Hosts e canais
owner: Julio
estado: vigente
pai: PLAT-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# SYS-02 — Hosts e canais

> **Em uma frase:** Os adaptadores que levam o Orkastery para onde o builder já trabalha: Claude Code, Codex, Hermes e OpenClaw, com o servidor MCP e o ingresso autenticado do Telegram.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** paridade de jornada: iniciar, acompanhar, decidir e receber entrega em qualquer host.
- **Limites:** zero regra de negócio no host; o host chama o `ork` e repassa a resposta como veio.
- **Localização do código:** `adapters/claude-code`, `adapters/codex`, `adapters/hermes`, `adapters/openclaw`; servidor MCP em `core/src/mcp-server.ts`.
- **Implantação:** `ork adapter install <host>` copia o catálogo com recibo e sha256 por arquivo; divergência dos dois lados pede decisão, arquivo a arquivo.
- **Segurança:** a resposta humana só vale com prova HMAC nascida do update autenticado do canal; o agente nunca responde no lugar do dono.

## Módulos

- [MOD-06](MOD-06-integracao-com-hosts.md) Integração com hosts

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |

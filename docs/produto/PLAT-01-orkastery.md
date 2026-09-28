---
id: PLAT-01
tipo: plataforma
titulo: Orkastery
owner: Julio
estado: vigente
verificado_em: 2026-09-24T21:30:00-03:00
---

# PLAT-01 — Orkastery

> **Em uma frase:** Plataforma que conduz o desenvolvimento de software com agentes de IA: o agente entrega e presta contas, e cada afirmação sobre o código é conferida contra o repositório antes de valer.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** multiplicar o que um Product Builder entrega por semana com agentes, cortando as interrupções para uma ou duas por semana.
- **O problema que resolve:** agente que narra sucesso sem prova, sessão que morre em silêncio, dono que vira o monitor da fábrica e decisão óbvia levada ao humano.
- **Limites:** não é um runtime de IA (usa Claude Code e Codex); não guarda credencial de runtime (o login é sempre do próprio CLI); não decide produto no lugar do dono.
- **Sistemas:** [SYS-01](SYS-01-nucleo-ork.md) núcleo `ork`; [SYS-02](SYS-02-hosts-e-canais.md) hosts e canais.
- **Dependências:** git, Node.js 20 ou 22, GitHub Actions para o CHECK independente, os CLIs `claude` e `codex` autenticados na máquina, e opcionalmente OrkMind (memória), Hermes e OpenClaw (canais).
- **Repositório:** `orkastery/orkastery` no GitHub; código em `core/` e `adapters/`.
- **Implantação:** CLI global `ork` compilado da `main` em cada máquina de fábrica; adaptadores copiados por `ork adapter install` para cada host.
- **Isolamento:** um projeto é um repositório; o estado das threads fica em `.orkastery/` na árvore principal; perfis de conta em `.orkastery/private/` (arquivo 0600, pasta 0700), fora do git.
- **Retenção:** o ledger de cada thread é append-only e não é apagado; decisões e correções são eventos novos, nunca reescrita.

## Sistemas

- [SYS-01](SYS-01-nucleo-ork.md) Núcleo ork
- [SYS-02](SYS-02-hosts-e-canais.md) Hosts e canais

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |

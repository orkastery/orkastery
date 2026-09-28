---
id: SYS-01
tipo: sistema
titulo: Núcleo ork
owner: Julio
estado: vigente
pai: PLAT-01
verificado_em: 2026-09-24T21:30:00-03:00
---

# SYS-01 — Núcleo ork

> **Em uma frase:** O CLI `ork` e seus contratos: threads, fases, verificação, entrega, contas, atenção humana e memória, com o ledger como registro de tudo.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Dono da página:** Julio

## Contexto e limites

- **Objetivo:** ser a única fonte de regra da fábrica; host e canal só roteiam.
- **Limites:** não fala com o Telegram diretamente (isso é do [SYS-02](SYS-02-hosts-e-canais.md)); não executa o modelo, despacha o runtime.
- **Localização do código:** `core/src/` (TypeScript, zero dependência de runtime); testes em `core/test/`.
- **Contratos:** JSON versionados com o prefixo `ork.` (por exemplo `ork.hitl/v2`, `ork.ci-bundle/v1`); leitor antigo continua aceitando para sempre.
- **Configuração:** `orkastery.yaml` na raiz do projeto (modos, runtimes, verify, fuso do dono) e o setup por bloco (modelo e esforço): `orkastery.setup.json` versionado, que vale para todas as máquinas, ou o `.orkastery/setup.json` local.
- **Falha e impacto:** se o `ork` não roda, nenhuma fase avança; nada é aprovado por omissão.

## Módulos

- [MOD-01](MOD-01-conducao-de-threads.md) Condução de threads
- [MOD-02](MOD-02-verdade-e-entrega.md) Verdade e entrega
- [MOD-03](MOD-03-runtimes-e-contas.md) Runtimes e contas
- [MOD-04](MOD-04-atencao-humana.md) Atenção humana
- [MOD-05](MOD-05-memoria-e-registro.md) Memória e registro

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |

---
id: FEAT-030
tipo: feature
titulo: Pacote de experiência de orquestração
estado: proposto
pai: MOD-06
roadmap: [RM-051]
owner: Equipe Orkastery
aprovador: Manutenção Orkastery
verificado_em: 2026-09-29T09:53:00-03:00
versao: proposta
fontes:
  codigo: []
  testes: []
  simbolos: []
  contratos: []
  comandos: []
---

# FEAT-030 — Pacote de experiência de orquestração

> **Em uma frase:** preferências de idioma, fuso e profundidade orientam a conversa de orquestração nos hosts, com opt-out e restauração dos arquivos de instrução.

- **Estado:** proposto; sem comprovação de implementação.
- **Onde fica:** [integração com hosts](MOD-06-integracao-com-hosts.md).
- **Roadmap:** [RM-051](../roadmap/RM-051-pacote-de-experiencia.md).

## Comportamento

O onboarding deverá recomendar valores detectados e permitir configuração explícita ou desativação. O catálogo deverá preservar doze regras de comunicação, decisões, prova, documentação e coordenação, usando o núcleo como fonte de estado e autoridade.

A instalação deverá ser idempotente. Remoção deverá restaurar bytes anteriores sem apagar conteúdo externo. Blocos alterados, duplicados e links inseguros deverão causar recusa. Os testes e o ensaio de tarball serão adicionados durante a implementação.

## Dados e contratos

Preferências propostas: `owner.language`, `owner.timezone`, `owner.depth` e `owner.experience`. Consultas MCP deverão expor reservas e fábrica no projeto fixado pelo servidor, sem reservar nem publicar.

## Operação e controle

Claude Code e Codex terão blocos de projeto; Hermes receberá referências pela skill existente. OpenClaw permanece uma lacuna de distribuição. Opt-out não desativa policies ou gates, e nenhuma preferência muda a proveniência HMAC do HITL.

Distribuição e rollback serão comprovados em ambiente temporário. Documentação e estado só avançam com evidência; não há release ou instalação comprovada neste cadastro.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | Especificação proposta | Equipe Orkastery | RM-051 |

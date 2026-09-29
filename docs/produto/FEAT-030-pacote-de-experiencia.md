---
id: FEAT-030
tipo: feature
titulo: Pacote de experiência de orquestração
estado: em desenvolvimento
pai: MOD-06
roadmap: [RM-051]
owner: Equipe Orkastery
aprovador: Manutenção Orkastery
verificado_em: 2026-09-29T10:29:00-03:00
versao: branch@2208305
fontes:
  codigo: [core/src/experiencia.ts, core/src/experiencia-instalacao.ts, core/src/onboarding.ts, core/src/hosts.ts, core/src/mcp-experiencia.ts]
  testes: [core/test/experiencia-config.test.ts, core/test/experiencia-instalacao.test.ts, core/test/adapter-experiencia.test.ts, core/test/mcp-experiencia.test.ts, core/test/experiencia-distribuicao.test.ts]
  simbolos: [core/src/experiencia.ts#resolverExperiencia, core/src/experiencia-instalacao.ts#planejarExperiencia, core/src/experiencia-instalacao.ts#aplicarExperiencia, core/src/mcp-experiencia.ts#registrarConsultasExperiencia]
  contratos: []
  comandos: [ork experiencia show, ork experiencia uninstall, ork onboarding, ork adapter install]
---

# FEAT-030 — Pacote de experiência de orquestração

> **Em uma frase:** preferências de idioma, fuso e profundidade orientam a conversa de orquestração nos hosts, com opt-out e restauração dos arquivos de instrução.

- **Estado:** em desenvolvimento; testes focados locais e comprovação oficial pendente.
- **Onde fica:** [integração com hosts](MOD-06-integracao-com-hosts.md).
- **Roadmap:** [RM-051](../roadmap/RM-051-pacote-de-experiencia.md).

## Comportamento

O onboarding recomenda valores detectados e permite configuração explícita ou desativação. O catálogo preserva doze regras de comunicação, decisões, prova, documentação e coordenação, usando o núcleo como fonte de estado e autoridade.

Os testes focados exercitam instalação idempotente e restauração de bytes, preservando mudanças externas. Blocos alterados, duplicados e links inseguros causam recusa. O script de ensaio de tarball está preparado, mas a instalação real permanece pendente.

## Dados e contratos

Preferências: `owner.language`, `owner.timezone`, `owner.depth` e `owner.experience`. Consultas MCP expõem reservas e fábrica no projeto fixado pelo servidor, sem reservar nem publicar.

## Operação e controle

Claude Code e Codex recebem blocos de projeto; Hermes recebe referências pela skill existente. OpenClaw permanece uma lacuna de distribuição. Opt-out não desativa policies ou gates, e nenhuma preferência muda a proveniência HMAC do HITL.

Distribuição real e rollback por tarball ainda exigem ensaio em ambiente temporário. Verificação oficial e revisão independente estão pendentes; testes dependentes de subprocessos e canários apresentam falhas locais. Não há release comprovada. O [guia bilíngue](../guias/orchestration-experience.pt-BR.md) descreve configuração, opt-out, remoção e limites.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | Especificação proposta | Equipe Orkastery | RM-051 |
| 2026-09-29 | Implementação local e testes focados; aceite pendente | Equipe Orkastery | branch@2208305, RM-051 |

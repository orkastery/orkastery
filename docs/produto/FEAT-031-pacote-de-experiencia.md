---
id: FEAT-031
tipo: feature
titulo: Pacote de experiência de orquestração
estado: em desenvolvimento
pai: MOD-06
roadmap: [RM-051]
owner: Equipe Orkastery
aprovador: Manutenção Orkastery
verificado_em: 2026-09-30T00:20:00-03:00
versao: branch@868e974
fontes:
  codigo: [core/src/experiencia.ts, core/src/experiencia-instalacao.ts, core/src/onboarding.ts, core/src/hosts.ts, core/src/mcp-experiencia.ts]
  testes: [core/test/experiencia-config.test.ts, core/test/experiencia-instalacao.test.ts, core/test/adapter-experiencia.test.ts, core/test/mcp-experiencia.test.ts, core/test/experiencia-distribuicao.test.ts]
  simbolos: [core/src/experiencia.ts#resolverExperiencia, core/src/experiencia-instalacao.ts#planejarExperiencia, core/src/experiencia-instalacao.ts#aplicarExperiencia, core/src/mcp-experiencia.ts#registrarConsultasExperiencia]
  contratos: []
  comandos: [ork experiencia show, ork experiencia uninstall, ork onboarding, ork adapter install]
---

# FEAT-031: Pacote de experiência de orquestração

> **Em uma frase:** preferências de idioma, fuso e profundidade orientam a conversa de orquestração nos hosts, com opt-out e restauração dos arquivos de instrução.

- **Estado:** em desenvolvimento até o merge; na branch, testes e ensaio real de tarball verdes, e revisão independente final sem bloqueador.
- **Onde fica:** [integração com hosts](MOD-06-integracao-com-hosts.md).
- **Roadmap:** [RM-051](../roadmap/RM-051-pacote-de-experiencia.md).

## Comportamento

O onboarding recomenda valores detectados e permite configuração explícita ou desativação. O catálogo preserva doze regras de comunicação, decisões, prova, documentação e coordenação, usando o núcleo como fonte de estado e autoridade.

O bloco nos arquivos de instrução aponta o catálogo por caminho relativo ao projeto, para valer em outro clone. A instalação é idempotente e a remoção restaura os bytes, preservando mudanças externas sem fundir linhas. Num clone sem recibo, um bloco igual ao gerado é adotado. Bloco editado, duplicado ou arquivo de instruções por link fazem o adapter install pular só o pacote, com aviso; a remoção explícita recusa sem escrever.

## Dados e contratos

Preferências: `owner.language`, `owner.timezone`, `owner.depth` e `owner.experience`. Valor inválido no manifesto avisa e vale o padrão, como o fuso; enquanto isso, o adapter install pula o pacote. Consultas MCP expõem reservas e fábrica no projeto fixado pelo servidor, sem reservar nem publicar, fora do laço do servidor e canceláveis.

## Operação e controle

Claude Code e Codex recebem blocos de projeto; Hermes recebe referências pela skill existente. OpenClaw permanece uma lacuna de distribuição. Opt-out não desativa policies ou gates, e nenhuma preferência muda a proveniência HMAC do HITL.

O ensaio `node core/scripts/testar-experiencia-e2e.cjs` instala o tarball local em HOME e prefixo temporários e confere instalação, reinstalação, clone sem recibo, opt-out e remoção nos hosts. Não há release comprovada. O [guia bilíngue](../guias/orchestration-experience.pt-BR.md) descreve configuração, opt-out, remoção e limites.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | Especificação proposta | Equipe Orkastery | RM-051 |
| 2026-09-29 | Implementação local e testes focados; aceite pendente | Equipe Orkastery | branch@2208305, RM-051 |
| 2026-09-30 | CHECK independente e GO-FIX 2 a 5; ID passa de FEAT-030 a FEAT-031, que a main já usava | Equipe Orkastery | branch@868e974, RM-051 |
